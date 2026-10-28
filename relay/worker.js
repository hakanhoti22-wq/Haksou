// Haksou — relais (Cloudflare Worker)
//
// • Garde vos clés secrètes sur le serveur : l'app n'en contient aucune.
// • Gère les comptes : essai gratuit, abonnements Stripe (mensuel / annuel),
//   accès familial gratuit par lien d'invitation, et votre accès propriétaire.
//
// ── Variables (Settings → Variables and Secrets, type « Secret ») ────────────
//   ACCESS_CODE        (obligatoire) votre code propriétaire, ex. « soleil-2026 »
//   GROQ_KEY           clé Groq gsk_…        → micro fiable + traduction de secours
//   ELEVENLABS_KEY     clé ElevenLabs sk_…   → voix naturelle
//   OPENAI_KEY         clé OpenAI sk-…       → voix naturelle (ou micro si pas de Groq)
//   AZURE_SPEECH_KEY   clé Microsoft Azure Speech (offre gratuite F0) → voix naturelle gratuite
//   AZURE_SPEECH_REGION région du service Azure, ex. « westeurope » (avec la clé ci-dessus)
//   TTS_PROVIDER       « azure », « elevenlabs » ou « openai » pour forcer la voix principale
//   STRIPE_SECRET_KEY  clé secrète Stripe sk_live_… (ou sk_test_… pour essayer)
//   PRICE_MONTHLY      identifiant du prix mensuel Stripe (price_…)
//   PRICE_YEARLY       identifiant du prix annuel Stripe (price_…)
//   TRIAL_DAYS         durée de l'essai gratuit (défaut : 7)
//   DAILY_LIMIT        requêtes par personne et par jour (défaut : 300)
//   STRIPE_API_VERSION version de l'API Stripe (défaut : 2025-03-31.basil)
//   ALLOWED_ORIGIN     ex. https://votre-nom.github.io (n'autorise que votre app)
//
// ── Liaison (Settings → Bindings → Add → KV namespace) ───────────────────────
//   HAKSOU             un espace KV (base de données) nommé « HAKSOU »
//
// Sans STRIPE_SECRET_KEY ni HAKSOU, le relais fonctionne comme avant :
// seul le code propriétaire (ACCESS_CODE) donne accès.

const UPSTREAMS = {
  groq: {
    base: 'https://api.groq.com',
    secret: 'GROQ_KEY',
    auth: key => ({ Authorization: `Bearer ${key}` }),
    paths: [/^\/openai\/v1\/audio\/transcriptions$/, /^\/openai\/v1\/chat\/completions$/],
  },
  openai: {
    base: 'https://api.openai.com',
    secret: 'OPENAI_KEY',
    auth: key => ({ Authorization: `Bearer ${key}` }),
    paths: [/^\/v1\/audio\/transcriptions$/, /^\/v1\/audio\/speech$/, /^\/v1\/chat\/completions$/],
  },
  azure: {
    // Voix neuronales Microsoft (offre gratuite F0 : 500 000 caractères par mois, jamais facturée).
    base: env => `https://${String(env.AZURE_SPEECH_REGION || '').trim().toLowerCase()}.tts.speech.microsoft.com`,
    secret: 'AZURE_SPEECH_KEY',
    auth: key => ({
      'Ocp-Apim-Subscription-Key': key,
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      'User-Agent': 'Haksou',
    }),
    paths: [/^\/cognitiveservices\/v1$/],
  },
  elevenlabs: {
    base: 'https://api.elevenlabs.io',
    secret: 'ELEVENLABS_KEY',
    auth: key => ({ 'xi-api-key': key }),
    paths: [/^\/v1\/text-to-speech\/[A-Za-z0-9]+$/],
  },
};

const DAY = 24 * 60 * 60 * 1000;
const ACTIVE_SUB = new Set(['active', 'trialing', 'past_due']);
const MAX_INVITE_DEVICES = 4;

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    const reply = (data, status = 200) => json(data, status, cors);

    try {
      if (url.pathname === '/' && request.method === 'GET') return text('Relais Haksou opérationnel.', 200, cors);
      if (!env.ACCESS_CODE) return reply({ error: 'ACCESS_CODE manquant dans les variables du relais.' }, 500);

      const isOwner = safeEqual(request.headers.get('X-Haksou-Code') || '', env.ACCESS_CODE);
      const token = (request.headers.get('X-Haksou-Token') || '').trim();

      // Ce que le relais sait faire (public)
      if (url.pathname === '/status') {
        return reply({ ok: true, ...capabilities(env), owner: isOwner });
      }

      // Comptes et abonnements
      if (url.pathname.startsWith('/account') || url.pathname.startsWith('/billing')) {
        if (!billingReady(env)) return reply({ error: 'Abonnements non configurés sur le relais.' }, 501);
        return await accountRoutes(url.pathname, request, env, token, reply);
      }

      // Espace propriétaire : invitations famille
      if (url.pathname.startsWith('/admin')) {
        if (!isOwner) return reply({ error: 'Code propriétaire incorrect.' }, 401);
        if (!env.HAKSOU) return reply({ error: 'Espace KV « HAKSOU » non relié au relais.' }, 501);
        return await adminRoutes(url.pathname, request, env, reply);
      }

      // Services d'IA : /groq/…, /openai/…, /elevenlabs/…
      const [, provider, ...rest] = url.pathname.split('/');
      const up = UPSTREAMS[provider];
      const path = '/' + rest.join('/');
      if (!up || request.method !== 'POST' || !up.paths.some(r => r.test(path))) {
        return reply({ error: 'Chemin non autorisé.' }, 404);
      }

      if (!isOwner) {
        if (!token || !env.HAKSOU) return reply({ error: 'Code famille incorrect.' }, 401);
        const user = await getUser(env, token);
        if (!user) return reply({ error: 'Compte inconnu.' }, 401);
        const access = await computeAccess(env, user);
        if (!access.active) return reply({ error: 'Abonnement requis.', account: publicAccount(user, access) }, 402);
        if (!(await withinDailyLimit(env, token))) return reply({ error: 'Limite quotidienne atteinte. Réessayez demain.' }, 429);
      }

      const key = env[up.secret];
      if (!key) return reply({ error: `${up.secret} manquant dans les variables du relais.` }, 501);
      if (provider === 'azure' && !env.AZURE_SPEECH_REGION) return reply({ error: 'AZURE_SPEECH_REGION manquant dans les variables du relais.' }, 501);
      return await forward(up, key, path, url, request, cors, env);
    } catch (err) {
      return reply({ error: err.message || 'Erreur du relais.' }, 500);
    }
  },
};

// ---------------------------------------------------------------------------
// Services d'IA
// ---------------------------------------------------------------------------

async function forward(up, key, path, url, request, cors, env) {
  const headers = new Headers(up.auth(key));
  const type = request.headers.get('Content-Type');
  if (type) headers.set('Content-Type', type);
  const accept = request.headers.get('Accept');
  if (accept) headers.set('Accept', accept);
  const base = typeof up.base === 'function' ? up.base(env) : up.base;
  const upstream = await fetch(base + path + url.search, { method: 'POST', headers, body: request.body });
  const out = new Headers(cors);
  const outType = upstream.headers.get('Content-Type');
  if (outType) out.set('Content-Type', outType);
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

function capabilities(env) {
  const stt = env.GROQ_KEY ? 'groq' : env.OPENAI_KEY ? 'openai' : null;
  // Voix disponibles, la gratuite (Azure) d'abord ; la suivante sert de secours si la première est épuisée.
  const voices = [
    env.AZURE_SPEECH_KEY && env.AZURE_SPEECH_REGION && 'azure',
    env.ELEVENLABS_KEY && 'elevenlabs',
    env.OPENAI_KEY && 'openai',
  ].filter(Boolean);
  const forced = voices.indexOf(String(env.TTS_PROVIDER || '').trim());
  if (forced > 0) voices.unshift(...voices.splice(forced, 1));
  return {
    stt,
    tts: voices[0] || null,
    ttsBackup: voices[1] || null,
    billing: billingReady(env),
    family: Boolean(env.HAKSOU),
    trialDays: trialDays(env),
    plans: { monthly: Boolean(env.PRICE_MONTHLY), yearly: Boolean(env.PRICE_YEARLY) },
  };
}

const billingReady = env => Boolean(env.HAKSOU && env.STRIPE_SECRET_KEY && (env.PRICE_MONTHLY || env.PRICE_YEARLY));
const trialDays = env => Math.max(0, parseInt(env.TRIAL_DAYS || '7', 10) || 0);

// ---------------------------------------------------------------------------
// Comptes
// ---------------------------------------------------------------------------
// KV :
//   user:<token>     → { token, kind, email, name, created, trialEndsAt, invite,
//                        customer, subscription, subStatus, periodEnd, plan, checkedAt }
//   email:<email>    → token
//   invite:<code>    → { code, name, created, devices: [token…], revoked }
//   usage:<token>:<jour> → nombre de requêtes

async function accountRoutes(path, request, env, token, reply) {
  const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};

  // Démarrer l'essai gratuit avec un e-mail
  if (path === '/account/start' && request.method === 'POST') {
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply({ error: 'Adresse e-mail invalide.' }, 400);
    const existingToken = await env.HAKSOU.get(`email:${email}`);
    if (existingToken) {
      const existing = await getUser(env, existingToken);
      if (existing) {
        // Un compte payant ne se récupère qu'avec son code de récupération.
        if (existing.subscription) return reply({ error: 'Cet e-mail a déjà un abonnement. Utilisez « Restaurer » avec votre code de récupération.' }, 409);
        const access = await computeAccess(env, existing);
        return reply({ token: existingToken, account: publicAccount(existing, access) });
      }
    }
    const user = {
      token: newToken(),
      kind: 'trial',
      email,
      created: Date.now(),
      trialEndsAt: Date.now() + trialDays(env) * DAY,
    };
    await putUser(env, user);
    await env.HAKSOU.put(`email:${email}`, user.token);
    return reply({ token: user.token, account: publicAccount(user, await computeAccess(env, user)) });
  }

  // Rejoindre la famille avec un lien d'invitation
  if (path === '/account/invite' && request.method === 'POST') {
    const code = String(body.code || '').trim();
    const invite = code && await env.HAKSOU.get(`invite:${code}`, 'json');
    if (!invite || invite.revoked) return reply({ error: 'Invitation invalide ou retirée.' }, 404);
    let user = token ? await getUser(env, token) : null;
    if (user && user.invite === code) {
      return reply({ token: user.token, account: publicAccount(user, await computeAccess(env, user)) });
    }
    if (invite.devices.length >= MAX_INVITE_DEVICES) return reply({ error: 'Cette invitation a déjà été utilisée sur trop d\'appareils.' }, 409);
    user = user || { token: newToken(), created: Date.now() };
    Object.assign(user, { kind: 'family', invite: code, name: invite.name });
    await putUser(env, user);
    invite.devices.push(user.token);
    await env.HAKSOU.put(`invite:${code}`, JSON.stringify(invite));
    return reply({ token: user.token, account: publicAccount(user, await computeAccess(env, user)) });
  }

  // Toutes les autres routes demandent un compte
  const user = token ? await getUser(env, token) : null;
  if (!user) return reply({ error: 'Compte inconnu. Utilisez votre code de récupération.' }, 401);

  if (path === '/account' || path === '/account/restore') {
    return reply({ token: user.token, account: publicAccount(user, await computeAccess(env, user, { force: true })) });
  }

  // Ouvrir la page de paiement Stripe
  if (path === '/billing/checkout' && request.method === 'POST') {
    const price = body.plan === 'yearly' ? env.PRICE_YEARLY : env.PRICE_MONTHLY;
    if (!price) return reply({ error: 'Formule indisponible.' }, 400);
    const returnUrl = safeReturnUrl(body.returnUrl, request, env);
    const params = {
      mode: 'subscription',
      'line_items[0][price]': price,
      'line_items[0][quantity]': '1',
      client_reference_id: user.token,
      success_url: `${returnUrl}?paid={CHECKOUT_SESSION_ID}`,
      cancel_url: returnUrl,
      allow_promotion_codes: 'true',
      locale: 'auto',
      'metadata[token]': user.token,
      'subscription_data[metadata][token]': user.token,
    };
    if (user.customer) params.customer = user.customer;
    else if (user.email) params.customer_email = user.email;
    const session = await stripe(env, 'POST', '/checkout/sessions', params);
    return reply({ url: session.url });
  }

  // Retour du paiement : on vérifie la session auprès de Stripe
  if (path === '/billing/confirm' && request.method === 'POST') {
    const id = String(body.sessionId || '');
    if (!/^cs_[A-Za-z0-9_]+$/.test(id)) return reply({ error: 'Session de paiement invalide.' }, 400);
    const session = await stripe(env, 'GET', `/checkout/sessions/${id}?expand[]=subscription`);
    if (session.client_reference_id !== user.token) return reply({ error: 'Ce paiement ne correspond pas à ce compte.' }, 403);
    if (session.status !== 'complete' || !session.subscription) return reply({ error: 'Paiement non finalisé.' }, 402);
    user.customer = session.customer;
    applySubscription(user, session.subscription, env);
    user.kind = 'sub';
    await putUser(env, user);
    return reply({ token: user.token, account: publicAccount(user, await computeAccess(env, user)) });
  }

  // Supprimer son compte et ses données (droit à l'effacement)
  if (path === '/account/delete' && request.method === 'POST') {
    const access = await computeAccess(env, user, { force: true });
    if (access.kind === 'sub' && !user.cancelAtPeriodEnd) {
      return reply({ error: 'Résiliez d\'abord votre abonnement (Gérer ou résilier), puis supprimez le compte.' }, 409);
    }
    await deleteUser(env, user);
    return reply({ ok: true });
  }

  // Gérer / résilier l'abonnement (portail Stripe)
  if (path === '/billing/portal' && request.method === 'POST') {
    if (!user.customer) return reply({ error: 'Aucun abonnement à gérer.' }, 400);
    const portal = await stripe(env, 'POST', '/billing_portal/sessions', {
      customer: user.customer,
      return_url: safeReturnUrl(body.returnUrl, request, env),
    });
    return reply({ url: portal.url });
  }

  return reply({ error: 'Chemin non autorisé.' }, 404);
}

/** Calcule si le compte a accès ; rafraîchit l'abonnement auprès de Stripe si besoin. */
async function computeAccess(env, user, { force = false } = {}) {
  const now = Date.now();
  if (user.kind === 'family') {
    const invite = user.invite && await env.HAKSOU.get(`invite:${user.invite}`, 'json');
    const active = Boolean(invite && !invite.revoked);
    return { active, kind: active ? 'family' : 'revoked' };
  }
  if (user.subscription && env.STRIPE_SECRET_KEY) {
    const stale = force ? now - (user.checkedAt || 0) > 60 * 1000 : now - (user.checkedAt || 0) > 6 * 60 * 60 * 1000;
    if (stale || (user.periodEnd && user.periodEnd < now)) {
      try {
        const sub = await stripe(env, 'GET', `/subscriptions/${user.subscription}`);
        applySubscription(user, sub, env);
        await putUser(env, user);
      } catch { /* Stripe injoignable : on garde l'état connu */ }
    }
    if (ACTIVE_SUB.has(user.subStatus) && (!user.periodEnd || user.periodEnd + 3 * DAY > now)) {
      return { active: true, kind: 'sub' };
    }
  }
  if (user.trialEndsAt && user.trialEndsAt > now) return { active: true, kind: 'trial' };
  return { active: false, kind: 'expired' };
}

function applySubscription(user, sub, env) {
  const item = sub.items?.data?.[0];
  const priceId = item?.price?.id;
  const end = sub.current_period_end || item?.current_period_end;
  user.subscription = sub.id;
  user.subStatus = sub.status;
  user.periodEnd = end ? end * 1000 : null;
  user.cancelAtPeriodEnd = Boolean(sub.cancel_at_period_end);
  user.plan = priceId && priceId === env.PRICE_YEARLY ? 'yearly' : 'monthly';
  user.checkedAt = Date.now();
}

function publicAccount(user, access) {
  return {
    kind: access.kind,
    active: access.active,
    email: user.email || null,
    name: user.name || null,
    trialEndsAt: user.trialEndsAt || null,
    plan: user.plan || null,
    periodEnd: user.periodEnd || null,
    cancelAtPeriodEnd: Boolean(user.cancelAtPeriodEnd),
    canManage: Boolean(user.customer),
    recovery: user.token,
  };
}

// ---------------------------------------------------------------------------
// Espace propriétaire : invitations famille
// ---------------------------------------------------------------------------

async function adminRoutes(path, request, env, reply) {
  const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};

  // Tableau de bord : nombre d'utilisateurs par statut et liste des comptes
  if (path === '/admin/stats') {
    const now = Date.now();
    const invites = new Map();
    for (const k of await listAll(env, 'invite:')) {
      const inv = await env.HAKSOU.get(k, 'json');
      if (inv) invites.set(inv.code, inv);
    }
    const counts = { total: 0, trial: 0, monthly: 0, yearly: 0, family: 0, expired: 0, newThisWeek: 0 };
    const users = [];
    for (const k of await listAll(env, 'user:')) {
      const u = await env.HAKSOU.get(k, 'json');
      if (!u) continue;
      const status = quickStatus(u, invites, now);
      counts.total++;
      counts[status]++;
      if (u.created && now - u.created < 7 * DAY) counts.newThisWeek++;
      users.push({
        token: u.token,
        email: u.email || null,
        name: u.name || null,
        status,
        created: u.created || null,
        trialEndsAt: u.trialEndsAt || null,
        periodEnd: u.periodEnd || null,
        cancelAtPeriodEnd: Boolean(u.cancelAtPeriodEnd),
      });
    }
    users.sort((a, b) => (b.created || 0) - (a.created || 0));
    return reply({ counts, users });
  }

  // Supprimer le compte d'une personne (à sa demande)
  if (path === '/admin/delete' && request.method === 'POST') {
    const user = await getUser(env, String(body.token || ''));
    if (!user) return reply({ error: 'Compte introuvable.' }, 404);
    await deleteUser(env, user);
    return reply({ ok: true });
  }

  if (path === '/admin/invite' && request.method === 'POST') {
    const name = String(body.name || '').trim().slice(0, 40) || 'Proche';
    const invite = { code: newToken(), name, created: Date.now(), devices: [], revoked: false };
    await env.HAKSOU.put(`invite:${invite.code}`, JSON.stringify(invite));
    return reply({ invite });
  }

  if (path === '/admin/family') {
    const list = await env.HAKSOU.list({ prefix: 'invite:' });
    const invites = [];
    for (const k of list.keys) {
      const inv = await env.HAKSOU.get(k.name, 'json');
      if (inv && !inv.revoked) invites.push({ code: inv.code, name: inv.name, created: inv.created, devices: inv.devices.length });
    }
    invites.sort((a, b) => b.created - a.created);
    return reply({ invites });
  }

  if (path === '/admin/revoke' && request.method === 'POST') {
    const code = String(body.code || '');
    const inv = await env.HAKSOU.get(`invite:${code}`, 'json');
    if (!inv) return reply({ error: 'Invitation introuvable.' }, 404);
    inv.revoked = true;
    await env.HAKSOU.put(`invite:${code}`, JSON.stringify(inv));
    return reply({ ok: true });
  }

  return reply({ error: 'Chemin non autorisé.' }, 404);
}

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

async function getUser(env, token) {
  if (!env.HAKSOU || !/^[A-Z0-9-]{8,40}$/.test(token)) return null;
  return env.HAKSOU.get(`user:${token}`, 'json');
}
const putUser = (env, user) => env.HAKSOU.put(`user:${user.token}`, JSON.stringify(user));

/** Statut d'un compte sans appeler Stripe (pour le tableau de bord). */
function quickStatus(u, invites, now) {
  if (u.kind === 'family') {
    const inv = invites.get(u.invite);
    return inv && !inv.revoked ? 'family' : 'expired';
  }
  if (u.subscription && ACTIVE_SUB.has(u.subStatus) && (!u.periodEnd || u.periodEnd + 3 * DAY > now)) {
    return u.plan === 'yearly' ? 'yearly' : 'monthly';
  }
  if (u.trialEndsAt && u.trialEndsAt > now) return 'trial';
  return 'expired';
}

/** Toutes les clés KV d'un préfixe (avec pagination). */
async function listAll(env, prefix) {
  const names = [];
  let cursor;
  do {
    const page = await env.HAKSOU.list({ prefix, cursor });
    names.push(...page.keys.map(k => k.name));
    cursor = page.list_complete === false ? page.cursor : undefined;
  } while (cursor);
  return names;
}

/** Efface un compte et l'e-mail associé. */
async function deleteUser(env, user) {
  await env.HAKSOU.delete(`user:${user.token}`);
  if (user.email && (await env.HAKSOU.get(`email:${user.email}`)) === user.token) {
    await env.HAKSOU.delete(`email:${user.email}`);
  }
}

async function withinDailyLimit(env, token) {
  const limit = parseInt(env.DAILY_LIMIT || '300', 10) || 300;
  const key = `usage:${token}:${new Date().toISOString().slice(0, 10)}`;
  const count = parseInt(await env.HAKSOU.get(key) || '0', 10);
  if (count >= limit) return false;
  await env.HAKSOU.put(key, String(count + 1), { expirationTtl: 2 * 24 * 3600 });
  return true;
}

/** Code lisible et difficile à deviner : HK-XXXX-XXXX-XXXX-XXXX. */
function newToken() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const chars = [...bytes].map(b => alphabet[b % alphabet.length]).join('');
  return `HK-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}-${chars.slice(12, 16)}`;
}

async function stripe(env, method, path, params) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      // Version récente requise notamment par Stripe Managed Payments.
      'Stripe-Version': env.STRIPE_API_VERSION || '2025-03-31.basil',
    },
    body: params ? new URLSearchParams(params) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Stripe : ${data.error?.message || res.status}`);
  return data;
}

function safeReturnUrl(value, request, env) {
  const fallback = env.ALLOWED_ORIGIN || request.headers.get('Origin') || '';
  try {
    const u = new URL(value);
    const allowed = env.ALLOWED_ORIGIN ? new URL(env.ALLOWED_ORIGIN).origin : request.headers.get('Origin');
    if (allowed && u.origin !== allowed) return fallback;
    return u.origin + u.pathname;
  } catch {
    return fallback;
  }
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '*';
  const allowed = env.ALLOWED_ORIGIN ? env.ALLOWED_ORIGIN.replace(/\/+$/, '') : '*';
  return {
    'Access-Control-Allow-Origin': allowed === '*' ? '*' : (origin === allowed ? origin : allowed),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, X-Haksou-Code, X-Haksou-Token',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const json = (data, status, headers) => new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } });
const text = (body, status, headers) => new Response(body, { status, headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' } });
