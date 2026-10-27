// Haksou — relais familial (Cloudflare Worker)
//
// Garde vos clés secrètes sur le serveur : l'app de votre famille passe par
// ce relais et n'a besoin d'aucune clé, seulement du code famille.
//
// Variables à créer dans Cloudflare (Settings → Variables and Secrets) :
//   ACCESS_CODE      (obligatoire) code famille, ex. « soleil-2026 »
//   GROQ_KEY         (recommandé)  clé Groq gsk_… → micro fiable + traduction de secours
//   OPENAI_KEY       (facultatif)  clé OpenAI sk-… → voix naturelle (et micro si pas de Groq)
//   ELEVENLABS_KEY   (facultatif)  clé ElevenLabs sk_… → voix naturelle
//   TTS_PROVIDER     (facultatif)  « openai » ou « elevenlabs » si les deux clés sont présentes
//   ALLOWED_ORIGIN   (facultatif)  ex. https://votre-nom.github.io pour n'autoriser que votre app

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
  elevenlabs: {
    base: 'https://api.elevenlabs.io',
    secret: 'ELEVENLABS_KEY',
    auth: key => ({ 'xi-api-key': key }),
    paths: [/^\/v1\/text-to-speech\/[A-Za-z0-9]+$/],
  },
};

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    if (url.pathname === '/' && request.method === 'GET') {
      return text('Relais Haksou opérationnel.', 200, cors);
    }

    // Code famille
    if (!env.ACCESS_CODE) return json({ error: 'ACCESS_CODE manquant dans les variables du relais.' }, 500, cors);
    if (!safeEqual(request.headers.get('X-Haksou-Code') || '', env.ACCESS_CODE)) {
      return json({ error: 'Code famille incorrect.' }, 401, cors);
    }

    // Ce que le relais sait faire
    if (url.pathname === '/status') {
      const stt = env.GROQ_KEY ? 'groq' : env.OPENAI_KEY ? 'openai' : null;
      let tts = null;
      if (env.TTS_PROVIDER === 'elevenlabs' && env.ELEVENLABS_KEY) tts = 'elevenlabs';
      else if (env.TTS_PROVIDER === 'openai' && env.OPENAI_KEY) tts = 'openai';
      else tts = env.OPENAI_KEY ? 'openai' : env.ELEVENLABS_KEY ? 'elevenlabs' : null;
      return json({ ok: true, stt, tts }, 200, cors);
    }

    // /groq/…, /openai/…, /elevenlabs/… → service correspondant
    const [, provider, ...rest] = url.pathname.split('/');
    const up = UPSTREAMS[provider];
    const path = '/' + rest.join('/');
    if (!up || request.method !== 'POST' || !up.paths.some(r => r.test(path))) {
      return json({ error: 'Chemin non autorisé.' }, 404, cors);
    }
    const key = env[up.secret];
    if (!key) return json({ error: `${up.secret} manquant dans les variables du relais.` }, 501, cors);

    const headers = new Headers(up.auth(key));
    const type = request.headers.get('Content-Type');
    if (type) headers.set('Content-Type', type);
    const accept = request.headers.get('Accept');
    if (accept) headers.set('Accept', accept);

    const upstream = await fetch(up.base + path + url.search, { method: 'POST', headers, body: request.body });
    const out = new Headers(cors);
    const outType = upstream.headers.get('Content-Type');
    if (outType) out.set('Content-Type', outType);
    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
};

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '*';
  const allowed = env.ALLOWED_ORIGIN ? env.ALLOWED_ORIGIN.replace(/\/+$/, '') : '*';
  return {
    'Access-Control-Allow-Origin': allowed === '*' ? '*' : (origin === allowed ? origin : allowed),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, X-Haksou-Code',
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
