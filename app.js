import { LANGUAGES, AUTO, findLanguage, engineCode, speechLocale, nativeName, flagOf } from './languages.js';
import { translate } from './translator.js';
import { Listener, Speaker } from './speech.js';
import { VoiceRecorder } from './recorder.js';
import { transcribe, providerFor } from './stt.js';
import { relayStatus } from './api.js';
import { Account, adminCall } from './account.js';
import { RELAY_URL, PRICES } from './config.js';
import { ttsProviderFor, ttsSupports, PROVIDER_NAMES } from './tts.js';

const $ = id => document.getElementById(id);

export const APP_VERSION = '14';

// ---------------------------------------------------------------------------
// Stockage local
// ---------------------------------------------------------------------------

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem('haksou.' + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('haksou.' + key, JSON.stringify(value)); } catch { /* stockage indisponible */ }
  },
};

const deviceLang = findLanguage(navigator.language)?.code || 'fr';
const otherDefault = deviceLang === 'en' ? 'fr' : 'en';

const settings = {
  mode: 'text',
  src: 'auto',
  tgt: otherDefault,
  a: deviceLang,       // conversation : moi (à droite)
  b: otherDefault,     // conversation : interlocuteur (à gauche)
  autoSpeak: true,
  rate: 1,
  silence: 1.2,
  autoChain: false,
  recents: [],
  lastDetected: null,
  sttKey: '',
  ttsKey: '',
  voiceGender: 'female',
  relayUrl: '',
  relayCode: '',
  relayInfo: null,
  ...store.get('settings', {}),
};
const saveSettings = () => store.set('settings', settings);

const MAX_HISTORY = 150;
const history = {
  text: store.get('history.text', []),
  conv: store.get('history.conv', []),
};
const saveHistory = mode => store.set('history.' + mode, history[mode].slice(-MAX_HISTORY));

// Les traductions interrompues (fermeture de l'app) sont marquées en erreur.
for (const list of Object.values(history)) {
  for (const m of list) if (m.status === 'pending') m.status = 'error';
}

const lang = code => findLanguage(code) || findLanguage('en');
const langName = code => lang(code).name;

// ---------------------------------------------------------------------------
// Éléments
// ---------------------------------------------------------------------------

const el = {
  app: $('app'),
  thread: $('thread'),
  inner: $('threadInner'),
  input: $('input'),
  send: $('sendBtn'),
  mic: $('micBtn'),
  srcBtn: $('srcBtn'),
  tgtBtn: $('tgtBtn'),
  srcLabel: $('srcLabel'),
  tgtLabel: $('tgtLabel'),
  srcFlag: $('srcFlag'),
  tgtFlag: $('tgtFlag'),
  srcCaption: $('srcCaption'),
  tgtCaption: $('tgtCaption'),
  convFlagA: $('convFlagA'),
  convFlagB: $('convFlagB'),
  swap: $('swapBtn'),
  composerText: $('composerText'),
  composerConv: $('composerConv'),
  convA: $('convBtnA'),
  convB: $('convBtnB'),
  convLabelA: $('convLabelA'),
  convLabelB: $('convLabelB'),
  status: $('status'),
  statusText: $('statusText'),
  toast: $('toast'),
};

const listener = new Listener();
const recorder = new VoiceRecorder();
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let speakingId = null;
let voiceRun = 0; // incrémenté à chaque nouvelle action vocale pour ignorer les suites obsolètes

// ---------------------------------------------------------------------------
// Icônes
// ---------------------------------------------------------------------------

const ICON = {
  speaker: '<svg class="spk" viewBox="0 0 24 24"><path d="M11 5 6.5 9H3.5v6h3L11 19z"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6M18.4 6.4a8 8 0 0 1 0 11.2"/></svg><span class="eq"><i></i><i></i><i></i><i></i></span>',
  copy: '<svg viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>',
  sparkle: '<svg viewBox="0 0 24 24"><path d="M4 6h9M8.5 4v2m2.5 0c-.6 3.6-3 6.6-6 8m2.2-4.5c1 1.7 2.6 3 4.3 3.8"/><path d="m12.5 20 4-9 4 9m-6.8-2.6h5.6"/></svg>',
  people: '<svg viewBox="0 0 24 24"><path d="M4 8.5A3.5 3.5 0 0 1 7.5 5h5A3.5 3.5 0 0 1 16 8.5v2A3.5 3.5 0 0 1 12.5 14H10l-3 2.5V14a3.5 3.5 0 0 1-3-3.5z"/><path d="M19 10.5a2.5 2.5 0 0 1 1 2v2a2.5 2.5 0 0 1-2 2.45V19l-2.5-2h-2a2.5 2.5 0 0 1-2-1"/></svg>',
};

// ---------------------------------------------------------------------------
// Rendu du fil
// ---------------------------------------------------------------------------

const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

function stampLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(Date.now() - 864e5);
  const same = (x, y) => x.toDateString() === y.toDateString();
  const day = same(d, today) ? 'Aujourd\'hui' : same(d, yesterday) ? 'Hier' : dayFmt.format(d);
  return `${day} ${timeFmt.format(d)}`;
}

function needsStamp(prev, msg) {
  return !prev || msg.ts - prev.ts > 45 * 60 * 1000;
}

function node(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}

function renderAll() {
  el.inner.replaceChildren();
  const list = history[settings.mode];
  if (!list.length) {
    el.inner.append(emptyState());
    return;
  }
  let prev = null;
  for (const m of list) {
    if (needsStamp(prev, m)) el.inner.append(node('div', 'day-sep', stampLabel(m.ts)));
    el.inner.append(renderMessage(m));
    prev = m;
  }
  scrollToBottom(false);
}

const QUICK_PHRASES = ['Bonjour, comment allez-vous ?', 'Où sont les toilettes ?', 'L\'addition, s\'il vous plaît', 'Combien ça coûte ?'];

function emptyState() {
  const conv = settings.mode === 'conv';
  const box = node('div', 'empty');
  box.innerHTML = `
    <div class="empty-orb"></div>
    <h3>${conv ? 'Face à face,<br><em>sans barrière.</em>' : 'Parlez.<br><em>Le monde vous comprend.</em>'}</h3>
    <p>${conv
      ? 'Chacun touche son micro et parle dans sa langue. La traduction s\'affiche et se fait entendre.'
      : 'Écrivez, parlez, ou essayez une phrase :'}</p>`;
  if (!conv) {
    const chips = node('div', 'empty-chips');
    for (const phrase of QUICK_PHRASES) {
      const c = node('button', 'chip');
      c.textContent = phrase;
      c.addEventListener('click', () => { Speaker.unlock(); if (ensureAccess()) translateTyped(phrase, { from: 'fr', spoken: true }); });
      chips.append(c);
    }
    box.append(chips);
  }
  return box;
}

function appendMessage(m) {
  const list = history[settings.mode];
  el.inner.querySelector('.empty')?.remove();
  const prev = list[list.length - 2];
  if (needsStamp(prev, m)) el.inner.append(node('div', 'day-sep', stampLabel(m.ts)));
  el.inner.append(renderMessage(m));
  scrollToBottom(true);
}

function updateMessage(m) {
  const old = el.inner.querySelector(`[data-id="${m.id}"]`);
  if (old) old.replaceWith(renderMessage(m));
  scrollToBottom(true);
}

const metaHtml = (...codes) => codes
  .map(c => `<span class="f">${flagOf(c)}</span>${escapeHtml(langName(c))}`)
  .join(' <span aria-hidden="true">→</span> ');

function renderMessage(m) {
  const wrap = node('div', 'exchange');
  wrap.dataset.id = m.id;

  if (m.kind === 'text') {
    // Bulle envoyée : le texte d'origine
    const sent = node('div', 'msg right');
    sent.append(node('div', 'msg-meta', metaHtml(m.from) + (m.auto ? ' · auto' : '')));
    const b1 = node('div', 'bubble');
    b1.textContent = m.original;
    sent.append(b1);
    wrap.append(sent);

    // Bulle reçue : la traduction
    const recv = node('div', 'msg left delayed');
    recv.append(node('div', 'msg-meta', metaHtml(m.to)));
    recv.append(translationBubble(m, false));
    if (m.status === 'ok') recv.append(actions(m));
    wrap.append(recv);
  } else {
    const mine = m.side === 'a';
    const row = node('div', `msg ${mine ? 'right' : 'left other'}`);
    row.append(node('div', 'msg-meta', metaHtml(m.from, m.to)));
    row.append(translationBubble(m, true));
    if (m.status === 'ok') row.append(actions(m));
    wrap.append(row);
  }
  return wrap;
}

function translationBubble(m, withOriginal) {
  const b = node('div', 'bubble translation' + (speakingId === m.id ? ' speaking' : ''));
  if (m.status === 'pending') {
    if (withOriginal) {
      b.textContent = m.original;
      b.append(node('span', 'orig', '<span class="typing"><i></i><i></i><i></i></span>'));
    } else {
      b.innerHTML = '<span class="typing" aria-label="Traduction en cours"><i></i><i></i><i></i></span>';
    }
  } else if (m.status === 'error') {
    b.classList.add('error');
    b.textContent = withOriginal ? m.original : '';
    b.append(node('span', 'err', escapeHtml(m.error || 'Traduction impossible.')));
    const retry = node('button', 'retry', 'Réessayer');
    retry.addEventListener('click', () => retryMessage(m));
    b.append(retry);
  } else {
    b.lang = lang(m.to).iso || m.to;
    b.textContent = m.translation;
    if (withOriginal) {
      const o = node('span', 'orig');
      o.lang = lang(m.from).iso || m.from;
      o.textContent = m.original;
      b.append(o);
    }
  }
  return b;
}

function actions(m) {
  const box = node('div', 'actions');
  const play = node('button', 'act' + (speakingId === m.id ? ' playing' : ''), ICON.speaker + 'Écouter');
  play.setAttribute('aria-label', 'Écouter');
  play.addEventListener('click', () => {
    Speaker.unlock();
    if (speakingId === m.id) { stopSpeaking(); return; }
    speakMessage(m);
  });
  const copy = node('button', 'act', ICON.copy);
  copy.setAttribute('aria-label', 'Copier');
  copy.addEventListener('click', async () => {
    await copyText(m.translation);
    copy.innerHTML = ICON.check;
    toast('Traduction copiée');
    setTimeout(() => { copy.innerHTML = ICON.copy; }, 1500);
  });
  box.append(play, copy);
  return box;
}

function scrollToBottom(smooth) {
  requestAnimationFrame(() => {
    el.thread.scrollTo({ top: el.thread.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  });
}

/** Bulle provisoire affichant la parole reconnue en direct. */
const TYPING = '<span class="typing"><i></i><i></i><i></i></span>';
const WAVE = '<span class="wave" aria-label="Enregistrement"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>';

function liveBubble(side, recording) {
  el.inner.querySelector('.empty')?.remove();
  const wrap = node('div', 'exchange live-exchange');
  const row = node('div', `msg ${side === 'left' ? 'left other' : 'right'}`);
  const b = node('div', 'bubble live', recording ? WAVE : TYPING);
  row.append(b);
  wrap.append(row);
  el.inner.append(wrap);
  scrollToBottom(true);
  return {
    update(text) {
      b.textContent = text;
      b.append(node('span', 'caret'));
      scrollToBottom(false);
    },
    level(v) {
      b.style.setProperty('--l', v.toFixed(2));
    },
    pending() {
      b.innerHTML = TYPING;
    },
    remove() {
      wrap.remove();
      if (!history[settings.mode].length && !el.inner.children.length) el.inner.append(emptyState());
    },
  };
}

// ---------------------------------------------------------------------------
// Traduction
// ---------------------------------------------------------------------------

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function pushMessage(mode, m) {
  history[mode].push(m);
  if (history[mode].length > MAX_HISTORY) history[mode].splice(0, history[mode].length - MAX_HISTORY);
  if (settings.mode === mode) appendMessage(m);
}

/** Exécute la traduction d'un message et met à jour l'affichage. */
async function runTranslation(mode, m) {
  m.status = 'pending';
  try {
    const res = await translate(m.original, m.auto ? 'auto' : engineCode(lang(m.from)), engineCode(lang(m.to)), {
      cred: sttCred(),
      nameOf: code => findLanguage(code)?.name || code,
    });
    if (m.auto && res.detected) {
      const detected = findLanguage(res.detected);
      if (detected) {
        m.from = detected.code;
        if (detected.code !== m.to) settings.lastDetected = detected.code;
        saveSettings();
        if (settings.mode === 'text') renderLangbar();
      }
    }
    m.translation = res.text;
    m.status = 'ok';
  } catch (err) {
    m.status = 'error';
    m.error = err.message;
  }
  saveHistory(mode);
  if (settings.mode === mode) updateMessage(m);
  return m.status === 'ok';
}

async function translateTyped(text, { from = null, spoken = false } = {}) {
  const original = text.trim();
  if (!original) return;
  const auto = !from && settings.src === 'auto';
  const m = {
    id: newId(),
    kind: 'text',
    ts: Date.now(),
    auto,
    from: from || (auto ? (settings.lastDetected || deviceLang) : settings.src),
    to: settings.tgt,
    original,
    status: 'pending',
  };
  pushMessage('text', m);
  const run = voiceRun;
  const ok = await runTranslation('text', m);
  // Texte déjà écrit dans la langue cible : on traduit vers l'autre langue la plus probable.
  if (ok && m.from === m.to && auto) {
    m.to = m.from === deviceLang ? otherDefault : deviceLang;
    await runTranslation('text', m);
  }
  if (ok && spoken && settings.autoSpeak && run === voiceRun) await speakMessage(m, 250);
}

async function retryMessage(m) {
  const mode = m.kind === 'text' ? 'text' : 'conv';
  updateMessage(Object.assign(m, { status: 'pending' }));
  await runTranslation(mode, m);
}

// ---------------------------------------------------------------------------
// Lecture à voix haute
// ---------------------------------------------------------------------------

async function speakMessage(m, delay = 0) {
  const target = lang(m.to);
  speakingId = m.id;
  refreshPlaying();
  if (delay) await sleep(delay); // laisse iOS rebasculer du micro vers le haut-parleur
  if (speakingId !== m.id) return;
  try {
    await Speaker.speak(m.translation, {
      locale: speechLocale(target),
      engine: engineCode(target),
      rate: settings.rate,
      neural: neuralVoiceFor(target),
    });
  } finally {
    if (speakingId === m.id) {
      speakingId = null;
      refreshPlaying();
    }
  }
}

// ---------------------------------------------------------------------------
// Accès aux services d'IA : clé sur l'appareil, sinon relais familial
// ---------------------------------------------------------------------------

const relayBase = () => (settings.relayUrl || RELAY_URL || '').trim();
const account = new Account(relayBase);
const isOwner = () => Boolean(settings.relayCode && settings.relayInfo?.owner);

/** Accès au relais : code propriétaire, sinon compte (essai, abonné, famille). */
function relay() {
  const url = relayBase();
  if (!url) return null;
  if (isOwner()) return { url, code: settings.relayCode };
  if (account.token) return { url, token: account.token };
  return null;
}

/** Accès pour le micro fiable (Whisper) et la traduction de secours. */
function sttCred() {
  if (settings.sttKey) return { provider: providerFor(settings.sttKey), key: settings.sttKey };
  if (relay() && settings.relayInfo?.stt) return { provider: settings.relayInfo.stt, relay: relay() };
  return null;
}

/** Accès pour la voix naturelle. */
function ttsCred() {
  const key = voiceKey();
  const provider = ttsProviderFor(key);
  if (provider) return { provider, key };
  if (relay() && settings.relayInfo?.tts) return { provider: settings.relayInfo.tts, relay: relay() };
  return null;
}

/** Interroge le relais et mémorise ce qu'il propose. */
async function connectRelay({ quiet = false } = {}) {
  const url = relayBase();
  if (!url) { settings.relayInfo = null; saveSettings(); refreshSettingsStatus(); return null; }
  try {
    const info = await relayStatus({ url, code: settings.relayCode });
    settings.relayInfo = {
      stt: info.stt || null,
      tts: info.tts || null,
      billing: Boolean(info.billing),
      family: Boolean(info.family),
      trialDays: info.trialDays ?? 7,
      plans: info.plans || {},
      owner: Boolean(info.owner),
    };
    saveSettings();
    if (!quiet) {
      if (settings.relayCode && !info.owner) toast('Code propriétaire incorrect.');
      else if (isOwner()) {
        const parts = [info.stt ? 'micro fiable ✓' : 'micro fiable ✗', info.tts ? 'voix naturelle ✓' : 'voix naturelle ✗'];
        toast(`Propriétaire connecté : ${parts.join(' · ')}`);
      } else toast('Relais connecté.');
    }
    return settings.relayInfo;
  } catch (err) {
    if (!quiet) toast(err.message || 'Relais injoignable.');
    return null;
  } finally {
    refreshSettingsStatus();
  }
}

// ---------------------------------------------------------------------------
// Abonnement : essai gratuit, paiement, accès famille
// ---------------------------------------------------------------------------

/** Les abonnements s'appliquent-ils à cet appareil ? */
const billingOn = () => Boolean(relayBase() && settings.relayInfo?.billing && !isOwner());

/** Cet appareil peut-il utiliser l'app ? Sinon, ouvre l'accueil ou l'abonnement. */
function ensureAccess() {
  if (!billingOn()) return true;
  if (account.token && account.info?.active) return true;
  openAccountSheet(account.token ? 'paywall' : 'welcome');
  return false;
}

/** Le relais a refusé un appel (abonnement expiré) : on met à jour et on propose l'abonnement. */
async function onPaymentRequired() {
  await account.refresh().catch(() => {});
  refreshSettingsStatus();
  openAccountSheet('paywall');
}

const appUrl = () => location.origin + location.pathname;

/** Lien d'invitation famille (contient l'adresse du relais si elle diffère de config.js). */
function inviteLink(code) {
  const params = new URLSearchParams({ invite: code });
  if (relayBase() !== RELAY_URL) params.set('relais', relayBase());
  return `${appUrl()}#${params}`;
}

/** Traite les liens entrants : invitation famille, ancien lien relais, retour de paiement. */
async function handleIncomingLinks() {
  const hash = new URLSearchParams(location.hash.slice(1));
  const linkRelay = hash.get('relais');
  if (linkRelay) {
    settings.relayUrl = linkRelay;
    // Ancien lien famille (#relais=…&code=…) : accès par code
    if (hash.get('code')) settings.relayCode = hash.get('code');
    saveSettings();
  }
  if (!relayBase()) { await offerInstall(); return; }
  await connectRelay({ quiet: true });

  // Invitation famille : le lien reste dans l'adresse pour l'icône de l'écran d'accueil.
  const invite = hash.get('invite');
  if (invite && !isOwner()) {
    const wasFamily = account.info?.kind === 'family';
    try {
      const data = await account.joinFamily(invite);
      if (!wasFamily) toast(`Bienvenue${data.account?.name ? ' ' + data.account.name : ''} ! Accès familial gratuit activé.`);
    } catch (err) {
      toast(err.message);
    }
  }

  // Retour de Stripe après paiement
  const query = new URLSearchParams(location.search);
  const paid = query.get('paid');
  if (paid) {
    window.history.replaceState(null, '', location.pathname + location.hash);
    if (account.token) {
      try {
        await account.confirm(paid);
        toast('Merci ! Votre abonnement Haksou est actif. 🎉');
      } catch (err) {
        toast(err.message);
      }
    }
  } else if (billingOn() && account.token && !invite) {
    await account.refresh().catch(() => {});
  }
  refreshSettingsStatus();
  await offerInstall();
  if (billingOn() && !account.token) openAccountSheet('welcome');
}

const STATUS_LABELS = { trial: 'Essai', monthly: 'Mensuel', yearly: 'Annuel', family: 'Famille', expired: 'Expiré' };

/** Tableau de bord du propriétaire : chiffres clés et liste des comptes. */
async function renderStats() {
  accountSheet.title.textContent = 'Statistiques';
  const body = accountSheet.body;
  body.innerHTML = '<div class="acct-hero"><span class="typing"><i></i><i></i><i></i></span></div>';
  let data;
  try {
    data = await adminCall(relayBase(), settings.relayCode, '/admin/stats');
  } catch (err) {
    body.innerHTML = `<div class="acct-hero"><p>${escapeHtml(err.message)}</p></div>`;
    return;
  }
  const c = data.counts;
  const day = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
  const paying = c.monthly + c.yearly;
  const revenue = (c.monthly * 0.95 + c.yearly * 9.95 / 12).toFixed(2).replace('.', ',');
  body.innerHTML = `
    <div class="stats-grid">
      <div class="stat hl"><b>${c.total}</b><span>Utilisateurs</span></div>
      <div class="stat"><b>${c.newThisWeek}</b><span>Nouveaux (7 j)</span></div>
      <div class="stat hl"><b>${paying}</b><span>Abonnés</span></div>
      <div class="stat"><b>${c.trial}</b><span>En essai</span></div>
      <div class="stat"><b>${c.monthly} / ${c.yearly}</b><span>Mensuel / Annuel</span></div>
      <div class="stat"><b>${c.family}</b><span>Famille</span></div>
    </div>
    <p class="fine" style="margin:0 0 12px">≈ ${revenue} CHF de revenus par mois (avant frais Stripe) · ${c.expired} essai(s) expiré(s)</p>
    <input class="text-input stats-search" id="statsSearch" type="search" placeholder="Rechercher un e-mail" autocomplete="off" autocapitalize="off">
    <div class="group" id="statsList"></div>`;
  const list = $('statsList');
  const detail = u => {
    if (u.status === 'trial' && u.trialEndsAt) return `Essai jusqu'au ${day.format(new Date(u.trialEndsAt))}`;
    if ((u.status === 'monthly' || u.status === 'yearly') && u.periodEnd) return `${u.cancelAtPeriodEnd ? 'Se termine' : 'Renouvellement'} le ${day.format(new Date(u.periodEnd))}`;
    if (u.status === 'family') return u.name ? `Invité : ${u.name}` : 'Invité';
    return u.created ? `Inscrit le ${day.format(new Date(u.created))}` : '';
  };
  const draw = (q = '') => {
    const rows = data.users.filter(u => !q || (u.email || u.name || '').toLowerCase().includes(q));
    if (!rows.length) { list.innerHTML = '<div class="no-result">Aucun utilisateur</div>'; return; }
    list.replaceChildren(...rows.map(u => {
      const row = node('div', 'row user-row');
      const txt = node('span', 'row-text');
      txt.append(node('span', '', escapeHtml(u.email || u.name || 'Proche invité')), node('small', '', escapeHtml(detail(u))));
      const right = node('span', 'lang-tags');
      right.append(node('span', `badge ${u.status}`, STATUS_LABELS[u.status] || u.status));
      const del = node('button', 'small-btn', '✕');
      del.setAttribute('aria-label', 'Supprimer ce compte');
      del.addEventListener('click', async () => {
        if (!confirm(`Supprimer définitivement le compte ${u.email || u.name || ''} et ses données ?`)) return;
        try {
          await adminCall(relayBase(), settings.relayCode, '/admin/delete', { token: u.token });
          toast('Compte supprimé.');
          renderStats();
        } catch (err) { toast(err.message); }
      });
      right.append(del);
      row.append(txt, right);
      return row;
    }));
  };
  $('statsSearch').addEventListener('input', e => draw(e.target.value.trim().toLowerCase()));
  draw();
}

// ---------------------------------------------------------------------------
// Installer sur l'écran d'accueil (première visite)
// ---------------------------------------------------------------------------

const isStandalone = () => window.navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
const isMobile = isIOS || /Android/i.test(navigator.userAgent);
const isInAppBrowser = /FBAN|FBAV|Instagram|Line\/|Snapchat|TikTok|LinkedInApp/i.test(navigator.userAgent);
let installPromptEvent = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPromptEvent = e; });

/** Faut-il proposer l'installation ? (mobile, pas déjà installée, pas refusée) */
function shouldOfferInstall() {
  if (isStandalone() || !isMobile) return false;
  const pref = store.get('installHint', null);
  if (pref?.never) return false;
  return !(pref?.until && Date.now() < pref.until);
}

/** Affiche la marche à suivre ; se résout quand la personne la ferme. */
function offerInstall() {
  if (!shouldOfferInstall()) return Promise.resolve();
  const sheet = $('installSheet');
  const backdrop = $('installBackdrop');
  $('installInApp').hidden = !isInAppBrowser;
  $('installShareWhere').textContent = /CriOS/.test(navigator.userAgent) ? '(en haut, dans la barre d\'adresse)'
    : /Android/i.test(navigator.userAgent) ? '(menu ⋮ du navigateur → « Installer l\'application »)'
    : '(en bas de Safari)';
  // Android/Chrome : installation directe possible
  $('installNow').hidden = !installPromptEvent;
  $('installSteps').hidden = Boolean(installPromptEvent);
  $('installOk').hidden = Boolean(installPromptEvent);
  openSheet(sheet, backdrop);
  return new Promise(resolve => {
    const done = (choice) => {
      if (choice === 'never') store.set('installHint', { never: true });
      else store.set('installHint', { until: Date.now() + (choice === 'later' ? 2 : 7) * 864e5 });
      [backdrop, $('installClose'), $('installLater'), $('installNever'), $('installOk'), $('installNow')].forEach(b => { b.onclick = null; });
      closeSheet(sheet, backdrop);
      setTimeout(resolve, 260);
    };
    backdrop.onclick = () => done('later');
    $('installClose').onclick = () => done('later');
    $('installLater').onclick = () => done('later');
    $('installNever').onclick = () => done('never');
    $('installOk').onclick = () => done('ok');
    $('installNow').onclick = async () => {
      try { installPromptEvent.prompt(); await installPromptEvent.userChoice; } catch { /* annulé */ }
      installPromptEvent = null;
      done('ok');
    };
  });
}

const accountSheet = { sheet: $('accountSheet'), backdrop: $('accountBackdrop'), body: $('accountBody'), title: $('accountTitle') };
let selectedPlan = 'yearly';

function openAccountSheet(view) {
  renderAccount(view);
  openSheet(accountSheet.sheet, accountSheet.backdrop);
}
const closeAccountSheet = () => closeSheet(accountSheet.sheet, accountSheet.backdrop);

function renderAccount(view) {
  const info = settings.relayInfo || {};
  const body = accountSheet.body;
  const days = info.trialDays ?? 7;

  if (view === 'welcome') {
    accountSheet.title.textContent = 'Bienvenue';
    body.innerHTML = `
      <div class="acct-hero">
        <div class="empty-orb"></div>
        <h3>Essayez Haksou<br><em>${days} jours gratuits</em></h3>
        <p>Sans carte bancaire. Ensuite ${PRICES.monthly.label} ${PRICES.monthly.period} ou ${PRICES.yearly.label} ${PRICES.yearly.period}.</p>
      </div>
      <ul class="acct-perks">
        <li>Micro fiable qui s'arrête tout seul</li>
        <li>Voix naturelle, humaine et chaleureuse</li>
        <li>193 langues et mode conversation</li>
      </ul>
      <input class="text-input" id="acctEmail" type="email" inputmode="email" placeholder="Votre e-mail" autocomplete="email" autocapitalize="off" autocorrect="off" spellcheck="false">
      <button class="cta" id="acctStart">Commencer l'essai gratuit</button>
      <button class="link-btn" id="acctToRestore">J'ai déjà un compte</button>
      <p class="fine">En continuant, vous acceptez la <a href="privacy.html" target="_blank" rel="noopener">politique de confidentialité</a>.</p>
      <p class="fine">Astuce iPhone : ajoutez d'abord Haksou à l'écran d'accueil (Partager → Sur l'écran d'accueil), puis lancez l'essai depuis l'icône.</p>`;
    const start = $('acctStart');
    start.addEventListener('click', async () => {
      const email = $('acctEmail').value.trim();
      if (!email) { toast('Entrez votre e-mail.'); return; }
      start.disabled = true;
      try {
        const data = await account.start(email);
        closeAccountSheet();
        refreshSettingsStatus();
        toast(data.account?.active ? `C'est parti ! ${days} jours gratuits.` : 'Votre essai est terminé : choisissez une formule.');
        if (!data.account?.active) setTimeout(() => openAccountSheet('paywall'), 400);
      } catch (err) {
        toast(err.message);
      } finally {
        start.disabled = false;
      }
    });
    $('acctToRestore').addEventListener('click', () => renderAccount('restore'));
    return;
  }

  if (view === 'restore') {
    accountSheet.title.textContent = 'Restaurer';
    body.innerHTML = `
      <div class="acct-hero"><p>Entrez votre code de récupération (il commence par <b>HK-</b>). Vous le trouvez dans Réglages → Mon abonnement sur votre ancien appareil.</p></div>
      <div class="key-field">
        <input class="text-input" id="acctCode" type="text" placeholder="HK-XXXX-XXXX-XXXX-XXXX" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false">
        <button class="paste-btn" data-paste="acctCode" type="button">Coller</button>
      </div>
      <button class="cta" id="acctRestore">Restaurer mon compte</button>`;
    body.querySelector('[data-paste]').addEventListener('click', () => pasteInto($('acctCode')));
    const btn = $('acctRestore');
    btn.addEventListener('click', async () => {
      const code = $('acctCode').value.trim();
      if (!code) { toast('Entrez votre code.'); return; }
      btn.disabled = true;
      try {
        const data = await account.restore(code);
        refreshSettingsStatus();
        if (data.account?.active) { closeAccountSheet(); toast('Compte restauré ✓'); } else renderAccount('paywall');
      } catch (err) {
        toast(err.status === 401 ? 'Code de récupération inconnu.' : err.message);
      } finally {
        btn.disabled = false;
      }
    });
    return;
  }

  if (view === 'stats') {
    renderStats();
    return;
  }

  // Abonnement
  accountSheet.title.textContent = 'Abonnement';
  const plans = ['yearly', 'monthly'].filter(p => info.plans?.[p] !== false);
  if (!plans.includes(selectedPlan)) selectedPlan = plans[0];
  const expired = account.info && !account.info.active;
  body.innerHTML = `
    <div class="acct-hero">
      <div class="empty-orb"></div>
      <h3>${expired ? 'Votre essai est terminé.<br><em>Continuez avec Haksou.</em>' : 'Haksou,<br><em>sans limite.</em>'}</h3>
      <p>Micro fiable, voix naturelle et 193 langues. Résiliable à tout moment.</p>
    </div>
    <div class="plans" role="radiogroup" aria-label="Formule">
      ${plans.map(p => `
        <button class="plan" role="radio" data-plan="${p}" aria-checked="${p === selectedPlan}">
          ${PRICES[p].badge ? `<span class="plan-badge">${PRICES[p].badge}</span>` : ''}
          <span><span class="plan-name">${p === 'yearly' ? 'Annuel' : 'Mensuel'}</span><br><span class="plan-sub">${p === 'yearly' ? 'Le meilleur prix' : 'Sans engagement'}</span></span>
          <span class="plan-price">${PRICES[p].label}<br><small>${PRICES[p].period}</small></span>
        </button>`).join('')}
    </div>
    <button class="cta" id="acctPay">Continuer</button>
    <button class="link-btn" id="acctToRestore">Restaurer un abonnement</button>
    <p class="fine">Paiement sécurisé par Stripe (carte, Apple Pay, Google Pay). Gérer ou résilier : Réglages → Mon abonnement.</p>`;
  body.querySelectorAll('.plan').forEach(btn => btn.addEventListener('click', () => {
    selectedPlan = btn.dataset.plan;
    body.querySelectorAll('.plan').forEach(b => b.setAttribute('aria-checked', String(b === btn)));
  }));
  const pay = $('acctPay');
  pay.addEventListener('click', async () => {
    if (!account.token) { renderAccount('welcome'); return; }
    pay.disabled = true;
    pay.textContent = 'Ouverture du paiement…';
    try {
      location.href = await account.checkoutUrl(selectedPlan, appUrl());
    } catch (err) {
      toast(err.message);
      pay.disabled = false;
      pay.textContent = 'Continuer';
    }
  });
  $('acctToRestore').addEventListener('click', () => renderAccount('restore'));
}

let refreshSettingsStatus = () => {};

/** Clé de voix naturelle : celle des réglages, ou la clé OpenAI du micro. */
function voiceKey() {
  if (settings.ttsKey) return settings.ttsKey;
  return ttsProviderFor(settings.sttKey) === 'openai' ? settings.sttKey : '';
}

const englishNames = (() => { try { return new Intl.DisplayNames(['en'], { type: 'language' }); } catch { return null; } })();

/** Paramètres de la voix IA pour une langue, ou null (voix de l'appareil). */
function neuralVoiceFor(language) {
  const cred = ttsCred();
  if (!cred || !ttsSupports(cred.provider, language.code)) return null;
  let langName = language.name;
  try { langName = englishNames?.of(language.iso || language.code.split('-')[0]) || langName; } catch { /* nom français */ }
  return { cred, langCode: language.code, langName, gender: settings.voiceGender };
}

let neuralErrorShown = false;
Speaker.onNeuralError = (err) => {
  if (neuralErrorShown) return;
  neuralErrorShown = true;
  toast(`${err.message} Voix de l'iPhone utilisée à la place.`);
};

function stopSpeaking() {
  speakingId = null;
  Speaker.cancel();
  refreshPlaying();
}

function refreshPlaying() {
  el.inner.querySelectorAll('.exchange').forEach(ex => {
    const on = ex.dataset.id === speakingId;
    ex.querySelector('.act')?.classList.toggle('playing', on);
    ex.querySelector('.bubble.translation')?.classList.toggle('speaking', on);
  });
}

// ---------------------------------------------------------------------------
// Capture de la voix
// ---------------------------------------------------------------------------

/**
 * Deux moteurs :
 *  - Whisper (si une clé est enregistrée) : on enregistre l'audio et on le
 *    fait transcrire. Fiable sur iPhone, où la reconnaissance de Safari
 *    devient « sourde » après la première dictée (bug d'iOS) ;
 *  - sinon, la reconnaissance vocale intégrée au navigateur.
 */
const useWhisper = () => Boolean(sttCred()) && VoiceRecorder.supported;
const voiceActive = () => listener.active || recorder.active;
function voiceStop() { listener.stop(); recorder.stop(); }
function voiceCancel() { listener.cancel(); recorder.cancel(); }

const orbOf = btn => btn.querySelector('.orb') || btn;

async function captureSpeech(language, live, btn, deafMs) {
  const silenceMs = settings.silence * 1000;
  if (useWhisper()) {
    const res = await recorder.record({
      silenceMs,
      onLevel: v => { live.level(v); orbOf(btn).style.setProperty('--l', v.toFixed(2)); },
      onSpeech: () => heard(btn),
    });
    if (!res || !res.speech) return '';
    setListening(btn, false);
    live.pending();
    showStatus('Transcription…');
    try {
      return await transcribe(res.blob, language.code, sttCred());
    } finally {
      if (!document.querySelector('.listening')) hideStatus();
    }
  }
  return listener.listen({
    lang: speechLocale(language),
    silenceMs,
    deafMs,
    onText: t => { live.update(t); heard(btn); },
  });
}

/** Message affiché quand rien n'a été entendu. */
function nothingHeard() {
  if (isIOS && !useWhisper()) {
    toast('Le micro de Safari s\'est bloqué (bug d\'iOS). Pour un micro fiable, activez « Micro fiable (Whisper) » dans les réglages ⚙︎.');
  } else {
    toast('Je n\'ai rien entendu. Touchez le micro et parlez.');
  }
}

// ---------------------------------------------------------------------------
// Micro — mode Traduire
// ---------------------------------------------------------------------------

/**
 * Langue écoutée par le micro en mode Traduire. En détection automatique,
 * on suppose que l'on parle la langue de l'appareil, sauf si c'est la cible.
 */
function spokenSourceCode() {
  if (settings.src !== 'auto') return settings.src;
  if (settings.tgt !== deviceLang) return deviceLang;
  return settings.lastDetected && settings.lastDetected !== settings.tgt ? settings.lastDetected : otherDefault;
}

async function onMicText() {
  Speaker.unlock();
  if (voiceActive()) { voiceStop(); return; }
  if (!ensureAccess()) return;
  const deafMs = Speaker.playedRecently() ? 1300 : 2500;
  stopSpeaking();
  const run = ++voiceRun;

  const spoken = lang(spokenSourceCode());
  const live = liveBubble('right', useWhisper());
  setListening(el.mic, true, `J'écoute en ${spoken.name.toLowerCase()}…`);

  let text = '';
  try {
    text = await captureSpeech(spoken, live, el.mic, deafMs);
  } catch (err) {
    live.remove();
    setListening(el.mic, false);
    if (run !== voiceRun) return;
    if (err.code === 'payment') onPaymentRequired(); else toast(err.message);
    return;
  }
  live.remove();
  setListening(el.mic, false);
  if (run !== voiceRun) return;
  if (!text) { nothingHeard(); return; }
  await translateTyped(text, { from: spoken.code, spoken: true });
}

// ---------------------------------------------------------------------------
// Micro — mode Conversation
// ---------------------------------------------------------------------------

async function onMicConv(side) {
  Speaker.unlock();
  const btn = side === 'a' ? el.convA : el.convB;
  if (voiceActive() && btn.classList.contains('listening')) { voiceStop(); return; }
  if (!ensureAccess()) return;
  voiceCancel();
  await converse(side, false);
}

async function converse(side, chained) {
  const deafMs = Speaker.playedRecently() ? 1300 : 2500;
  stopSpeaking();
  const run = ++voiceRun;
  const btn = side === 'a' ? el.convA : el.convB;
  const other = side === 'a' ? 'b' : 'a';
  const from = lang(settings[side]);
  const to = lang(settings[other]);

  setListening(el.convA, false);
  setListening(el.convB, false);
  const live = liveBubble(side === 'a' ? 'right' : 'left', useWhisper());
  setListening(btn, true, `J'écoute en ${from.name.toLowerCase()}…`);

  let text = '';
  try {
    text = await captureSpeech(from, live, btn, deafMs);
  } catch (err) {
    live.remove();
    setListening(btn, false);
    if (run !== voiceRun) return;
    if (err.code === 'payment') { onPaymentRequired(); return; }
    toast(chained && err.code === 'not-allowed' ? 'Touchez le micro pour répondre.' : err.message);
    return;
  }
  live.remove();
  setListening(btn, false);
  if (run !== voiceRun) return;
  if (!text) {
    if (!chained) nothingHeard();
    return;
  }

  const m = { id: newId(), kind: 'conv', ts: Date.now(), side, from: from.code, to: to.code, original: text, status: 'pending' };
  pushMessage('conv', m);
  const ok = await runTranslation('conv', m);
  if (!ok || run !== voiceRun) return;

  if (settings.autoSpeak) await speakMessage(m, 250);
  if (settings.autoChain && run === voiceRun && settings.mode === 'conv' && !document.hidden) {
    await converse(other, true);
  }
}

// ---------------------------------------------------------------------------
// États du micro
// ---------------------------------------------------------------------------

function setListening(btn, on, label) {
  btn.classList.toggle('listening', on);
  if (!on) orbOf(btn).style.setProperty('--l', 0);
  btn.classList.remove('heard');
  if (on) showStatus(label);
  else if (!document.querySelector('.listening')) hideStatus();
}

let heardTimer;
function heard(btn) {
  btn.classList.add('heard');
  clearTimeout(heardTimer);
  heardTimer = setTimeout(() => btn.classList.remove('heard'), 400);
}

function showStatus(text) {
  el.statusText.textContent = text;
  el.status.hidden = false;
}
function hideStatus() { el.status.hidden = true; }

// ---------------------------------------------------------------------------
// Barre de langues et modes
// ---------------------------------------------------------------------------

function renderLangbar() {
  const conv = settings.mode === 'conv';
  if (conv) {
    // Disposition spatiale : interlocuteur à gauche, moi à droite.
    el.srcCaption.textContent = 'En face';
    el.tgtCaption.textContent = 'Vous';
    el.srcLabel.textContent = langName(settings.b);
    el.tgtLabel.textContent = langName(settings.a);
    el.srcFlag.textContent = flagOf(settings.b);
    el.tgtFlag.textContent = flagOf(settings.a);
    el.convLabelA.textContent = langName(settings.a);
    el.convLabelB.textContent = langName(settings.b);
    el.convFlagA.textContent = flagOf(settings.a);
    el.convFlagB.textContent = flagOf(settings.b);
    el.swap.disabled = false;
  } else {
    el.srcCaption.textContent = settings.src === 'auto' ? '✦ Auto' : 'Depuis';
    el.tgtCaption.textContent = 'Vers';
    if (settings.src === 'auto') {
      el.srcLabel.textContent = settings.lastDetected ? langName(settings.lastDetected) : 'Automatique';
      el.srcFlag.textContent = settings.lastDetected ? flagOf(settings.lastDetected) : flagOf('auto');
    } else {
      el.srcLabel.textContent = langName(settings.src);
      el.srcFlag.textContent = flagOf(settings.src);
    }
    el.tgtLabel.textContent = langName(settings.tgt);
    el.tgtFlag.textContent = flagOf(settings.tgt);
    el.swap.disabled = settings.src === 'auto' && !settings.lastDetected;
  }
}

function setMode(mode) {
  if (settings.mode === mode) return;
  voiceCancel();
  stopSpeaking();
  voiceRun++;
  setListening(el.mic, false);
  setListening(el.convA, false);
  setListening(el.convB, false);
  settings.mode = mode;
  saveSettings();
  applyMode();
}

function applyMode() {
  const conv = settings.mode === 'conv';
  el.app.dataset.mode = settings.mode;
  document.querySelectorAll('.segmented [role="tab"]').forEach(t => t.setAttribute('aria-selected', String(t.dataset.mode === settings.mode)));
  el.composerText.hidden = conv;
  el.composerConv.hidden = !conv;
  renderLangbar();
  renderAll();
}

function swapLanguages() {
  if (settings.mode === 'conv') {
    [settings.a, settings.b] = [settings.b, settings.a];
  } else {
    const src = settings.src === 'auto' ? settings.lastDetected : settings.src;
    if (!src) return;
    settings.src = settings.tgt;
    settings.tgt = src;
  }
  el.swap.classList.toggle('spin');
  saveSettings();
  renderLangbar();
}

// ---------------------------------------------------------------------------
// Feuille de choix de langue
// ---------------------------------------------------------------------------

const langSheet = {
  sheet: $('langSheet'),
  backdrop: $('langBackdrop'),
  list: $('langList'),
  search: $('langSearch'),
  title: $('langSheetTitle'),
  key: null,
};

const normalize = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function openLangSheet(key) {
  langSheet.key = key;
  langSheet.title.textContent = {
    src: 'Traduire depuis', tgt: 'Traduire vers', a: 'Votre langue', b: 'Langue de l\'interlocuteur',
  }[key];
  langSheet.search.value = '';
  renderLangList();
  openSheet(langSheet.sheet, langSheet.backdrop);
  langSheet.list.scrollTop = 0;
}

function renderLangList() {
  const key = langSheet.key;
  const current = settings[key];
  const q = normalize(langSheet.search.value.trim());
  const frag = document.createDocumentFragment();

  const row = (l) => {
    const btn = node('button', 'row lang-row' + (l.code === current ? ' selected' : ''));
    btn.append(node('span', 'lang-flag', flagOf(l.code)));
    const native = l.code === 'auto' ? '' : nativeName(l);
    const text = node('span', 'row-text');
    text.append(node('span', 'lang-name', escapeHtml(l.name)));
    if (native && normalize(native) !== normalize(l.name)) text.append(node('span', 'lang-native', escapeHtml(native)));
    const tags = node('span', 'lang-tags');
    if (l.speech) tags.innerHTML = ICON.mic;
    if (l.code === current) tags.insertAdjacentHTML('beforeend', ICON.check.replace('<svg', '<svg class="check"'));
    btn.append(text, tags);
    btn.addEventListener('click', () => pickLanguage(l.code));
    return btn;
  };

  const all = LANGUAGES.filter(l => !q || normalize(l.name).includes(q) || normalize(nativeName(l)).includes(q) || l.code.toLowerCase() === q);

  if (!q) {
    const top = [];
    if (key === 'src') top.push(AUTO);
    const recents = settings.recents.map(findLanguage).filter(l => l && l.code !== 'auto').slice(0, 5);
    if (top.length || recents.length) {
      if (recents.length) frag.append(node('div', 'group-title', 'Récentes'));
      const g = node('div', 'group');
      [...top, ...recents].forEach(l => g.append(row(l)));
      frag.append(g);
    }
    frag.append(node('div', 'group-title', 'Toutes les langues'));
  }

  if (all.length) {
    const g = node('div', 'group');
    all.forEach(l => g.append(row(l)));
    frag.append(g);
  } else {
    frag.append(node('div', 'no-result', 'Aucune langue trouvée'));
  }
  langSheet.list.replaceChildren(frag);
}

function pickLanguage(code) {
  const key = langSheet.key;
  const pairs = { src: 'tgt', tgt: 'src', a: 'b', b: 'a' };
  const otherKey = pairs[key];
  if (code === settings[otherKey]) {
    settings[otherKey] = settings[key] === 'auto' ? (settings.lastDetected || deviceLang) : settings[key];
  }
  settings[key] = code;
  if (code !== 'auto') settings.recents = [code, ...settings.recents.filter(c => c !== code)].slice(0, 8);
  saveSettings();
  renderLangbar();
  closeSheet(langSheet.sheet, langSheet.backdrop);
}

// ---------------------------------------------------------------------------
// Feuilles : ouverture, fermeture, glisser pour fermer
// ---------------------------------------------------------------------------

function openSheet(sheet, backdrop) {
  sheet.classList.remove('closing');
  backdrop.classList.remove('closing');
  sheet.style.transform = '';
  sheet.hidden = false;
  backdrop.hidden = false;
}

function closeSheet(sheet, backdrop) {
  if (sheet.hidden) return;
  document.activeElement?.blur?.();
  sheet.classList.add('closing');
  backdrop.classList.add('closing');
  setTimeout(() => {
    sheet.hidden = true;
    backdrop.hidden = true;
    sheet.classList.remove('closing');
    backdrop.classList.remove('closing');
    sheet.style.transform = '';
  }, 230);
}

function bindSheet(sheet, backdrop) {
  backdrop.addEventListener('click', () => closeSheet(sheet, backdrop));
  sheet.querySelector('[data-close]').addEventListener('click', () => closeSheet(sheet, backdrop));
  const handle = [sheet.querySelector('.sheet-grabber'), sheet.querySelector('.sheet-head')];
  let startY = null;
  let dy = 0;
  handle.forEach(h => {
    h.addEventListener('touchstart', e => { startY = e.touches[0].clientY; dy = 0; sheet.style.transition = 'none'; }, { passive: true });
    h.addEventListener('touchmove', e => {
      if (startY == null) return;
      dy = Math.max(0, e.touches[0].clientY - startY);
      sheet.style.transform = `translateY(${dy}px)`;
    }, { passive: true });
    h.addEventListener('touchend', () => {
      sheet.style.transition = '';
      if (dy > 110) closeSheet(sheet, backdrop);
      else sheet.style.transform = '';
      startY = null;
    });
  });
}

// ---------------------------------------------------------------------------
// Réglages
// ---------------------------------------------------------------------------

const settingsSheet = { sheet: $('settingsSheet'), backdrop: $('settingsBackdrop') };

function initSettings() {
  const autoSpeak = $('optAutoSpeak');
  const autoChain = $('optAutoChain');
  const rate = $('optRate');
  const silence = $('optSilence');

  const fill = input => input.style.setProperty('--fill', `${((input.value - input.min) / (input.max - input.min)) * 100}%`);
  const rateText = v => v < 0.85 ? 'Lente' : v > 1.12 ? 'Rapide' : v > 1.02 ? 'Un peu rapide' : v < 0.95 ? 'Posée' : 'Normale';
  const show = () => {
    $('rateValue').textContent = rateText(+rate.value);
    $('silenceValue').textContent = `${(+silence.value).toLocaleString('fr-FR', { minimumFractionDigits: 1 })} s`;
    fill(rate);
    fill(silence);
  };

  autoSpeak.checked = settings.autoSpeak;
  autoChain.checked = settings.autoChain;
  rate.value = settings.rate;
  silence.value = settings.silence;
  show();

  autoSpeak.addEventListener('change', () => { settings.autoSpeak = autoSpeak.checked; saveSettings(); });
  autoChain.addEventListener('change', () => { settings.autoChain = autoChain.checked; saveSettings(); });
  rate.addEventListener('input', () => { settings.rate = +rate.value; show(); saveSettings(); });
  silence.addEventListener('input', () => { settings.silence = +silence.value; show(); saveSettings(); });

  const sttKey = $('optSttKey');
  const sttStatus = $('sttStatus');
  const sttDefaultDesc = $('sttDesc').textContent;
  const showStt = () => {
    const cred = sttCred();
    // Fourni par le relais Haksou : rien à configurer, on masque le champ de clé.
    const included = Boolean(relayBase() && settings.relayInfo?.stt && !settings.sttKey);
    sttStatus.textContent = cred ? (cred.relay ? 'Inclus ✓' : 'Activé') : included ? 'Inclus' : 'Désactivé';
    sttStatus.classList.toggle('on', Boolean(cred || included));
    $('sttDesc').textContent = included ? 'Inclus dans Haksou : rien à configurer.' : sttDefaultDesc;
    $('sttKeyField').hidden = included;
    $('sttLinks').hidden = included;
  };
  sttKey.value = settings.sttKey;
  showStt();
  sttKey.addEventListener('input', () => {
    settings.sttKey = sttKey.value.trim();
    saveSettings();
    showStt();
  });
  if (!VoiceRecorder.supported) sttKey.disabled = true;

  // Voix naturelle
  const ttsKey = $('optTtsKey');
  const ttsStatus = $('ttsStatus');
  const ttsDefaultDesc = $('ttsDesc').textContent;
  const showTts = () => {
    const cred = ttsCred();
    const included = Boolean(relayBase() && settings.relayInfo?.tts && !settings.ttsKey);
    // App publiée avec un relais : seul le propriétaire saisit des clés.
    const keysHidden = included || Boolean(relayBase() && !isOwner() && !settings.ttsKey);
    ttsStatus.textContent = cred
      ? (cred.relay ? 'Incluse ✓' : PROVIDER_NAMES[cred.provider])
      : included ? 'Incluse' : (settings.ttsKey ? 'Clé non reconnue' : 'Voix de l\'iPhone');
    ttsStatus.classList.toggle('on', Boolean(cred || included));
    $('ttsDesc').textContent = included
      ? 'Voix naturelle incluse dans Haksou : rien à configurer.'
      : keysHidden ? 'La voix de l\'iPhone est utilisée. Astuce ci-dessous pour une voix plus naturelle.' : ttsDefaultDesc;
    $('ttsKeyField').hidden = keysHidden;
    $('ttsLinks').hidden = keysHidden;
  };
  ttsKey.value = settings.ttsKey;
  showTts();
  ttsKey.addEventListener('input', () => {
    settings.ttsKey = ttsKey.value.trim();
    neuralErrorShown = false;
    saveSettings();
    showTts();
  });
  sttKey.addEventListener('input', showTts);

  // Propriétaire
  const relayUrl = $('optRelayUrl');
  const relayCode = $('optRelayCode');
  const relayState = $('relayStatus');
  const inviteBtn = $('inviteBtn');
  const familyList = $('familyList');
  const showRelay = () => {
    const info = settings.relayInfo;
    relayState.textContent = !relayBase() ? 'Non configuré'
      : isOwner() ? 'Propriétaire ✓'
      : settings.relayCode && info ? 'Code incorrect'
      : info ? 'Connecté' : 'Non connecté';
    relayState.classList.toggle('on', Boolean(info && (isOwner() || !settings.relayCode)));
    inviteBtn.hidden = !(isOwner() && info?.family);
    $('statsBtn').hidden = inviteBtn.hidden;
    if (inviteBtn.hidden) familyList.replaceChildren();
    // Propriétaire sans base de données : on explique ce qui manque sur Cloudflare.
    $('relayHint').hidden = !(isOwner() && info && !info.family);
  };
  relayUrl.value = settings.relayUrl || RELAY_URL;
  relayCode.value = settings.relayCode;
  const onRelayChange = () => {
    const url = relayUrl.value.trim();
    settings.relayUrl = url === RELAY_URL ? '' : url;
    settings.relayCode = relayCode.value.trim();
    settings.relayInfo = null;
    saveSettings();
    showRelay();
    if (relayBase()) connectRelay().then(() => isOwner() && loadFamily());
  };
  relayUrl.addEventListener('change', onRelayChange);
  relayCode.addEventListener('change', onRelayChange);

  // Famille : inviter, lister, retirer
  const loadFamily = async () => {
    if (!isOwner() || !settings.relayInfo?.family) return;
    try {
      const { invites } = await adminCall(relayBase(), settings.relayCode, '/admin/family');
      familyList.replaceChildren(...invites.map(inv => {
        const row = node('div', 'row family-row');
        const txt = node('span', 'row-text');
        txt.append(node('span', '', escapeHtml(inv.name)), node('small', '', inv.devices ? `${inv.devices} appareil${inv.devices > 1 ? 's' : ''}` : 'Invitation pas encore ouverte'));
        const share = node('button', 'small-btn', 'Lien');
        share.style.color = 'var(--amber)';
        share.addEventListener('click', () => shareInvite(inv.name, inv.code));
        const remove = node('button', 'small-btn', 'Retirer');
        remove.addEventListener('click', async () => {
          if (!confirm(`Retirer l'accès gratuit de ${inv.name} ?`)) return;
          try { await adminCall(relayBase(), settings.relayCode, '/admin/revoke', { code: inv.code }); toast('Accès retiré.'); loadFamily(); } catch (err) { toast(err.message); }
        });
        const actions = node('span', 'lang-tags');
        actions.append(share, remove);
        row.append(txt, actions);
        return row;
      }));
    } catch (err) {
      toast(err.message);
    }
  };
  const shareInvite = async (name, code) => {
    const link = inviteLink(code);
    const message = `${name}, voici Haksou, mon traducteur, offert ! Ouvre ce lien dans Safari, puis Partager → Sur l'écran d'accueil.`;
    if (navigator.share) {
      try { await navigator.share({ title: 'Haksou', text: message, url: link }); return; } catch { /* partage annulé : on copie */ }
    }
    await copyText(link);
    toast('Lien d\'invitation copié. Envoie-le à ton proche !');
  };
  inviteBtn.addEventListener('click', async () => {
    const name = prompt('Prénom du proche à inviter ?');
    if (name == null) return;
    try {
      const { invite } = await adminCall(relayBase(), settings.relayCode, '/admin/invite', { name: name.trim() || 'Proche' });
      await shareInvite(invite.name, invite.code);
      loadFamily();
    } catch (err) {
      toast(err.message);
    }
  });
  // À l'ouverture des réglages : resynchronise avec le relais (nouvelles options, famille, abonnement).
  $('settingsBtn').addEventListener('click', async () => {
    if (relayBase()) await connectRelay({ quiet: true });
    loadFamily();
    if (billingOn() && account.token) account.refresh().then(showSub, () => {});
  });

  // Mon abonnement
  const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const showSub = () => {
    $('subSection').hidden = !billingOn();
    const i = account.info;
    const pill = $('subStatus');
    const kind = !account.token ? 'none' : i?.kind || 'none';
    pill.textContent = { none: 'Aucun compte', trial: 'Essai gratuit', sub: i?.plan === 'yearly' ? 'Annuel' : 'Mensuel', family: 'Famille', revoked: 'Accès retiré', expired: 'Expiré' }[kind];
    pill.classList.toggle('on', Boolean(i?.active));
    const daysLeft = i?.trialEndsAt ? Math.max(0, Math.ceil((i.trialEndsAt - Date.now()) / 864e5)) : 0;
    $('subDetail').textContent = {
      none: 'Commencez l\'essai gratuit pour utiliser Haksou.',
      trial: `${daysLeft} jour${daysLeft > 1 ? 's' : ''} d'essai restant${daysLeft > 1 ? 's' : ''}.`,
      sub: i?.periodEnd ? `${i.cancelAtPeriodEnd ? 'Se termine' : 'Renouvellement'} le ${dateFmt.format(new Date(i.periodEnd))}.` : 'Abonnement actif.',
      family: `Accès familial gratuit${i?.name ? ` (${i.name})` : ''}. Merci qui ? 😉`,
      revoked: 'L\'accès familial a été retiré. Vous pouvez vous abonner.',
      expired: 'Abonnez-vous pour continuer à utiliser Haksou.',
    }[kind];
    $('subscribeBtn').hidden = kind === 'sub' || kind === 'family';
    $('subscribeBtn').textContent = kind === 'none' ? 'Commencer l\'essai gratuit' : 'S\'abonner';
    $('manageSubBtn').hidden = !i?.canManage;
    $('copyRecoveryBtn').hidden = !account.token;
    $('deleteAccountBtn').hidden = !account.token;
  };
  $('subscribeBtn').addEventListener('click', () => openAccountSheet(account.token ? 'paywall' : 'welcome'));
  $('statsBtn').addEventListener('click', () => openAccountSheet('stats'));
  $('deleteAccountBtn').addEventListener('click', async () => {
    if (!confirm('Supprimer définitivement votre compte Haksou et vos données (e-mail, essai, statut) ? Cette action est irréversible.')) return;
    try {
      await account.call('/account/delete', {});
      account.forget();
      store.set('history.text', []);
      store.set('history.conv', []);
      toast('Compte et données supprimés.');
      setTimeout(() => location.reload(), 1200);
    } catch (err) {
      toast(err.message);
    }
  });
  $('restoreBtn').addEventListener('click', () => openAccountSheet('restore'));
  $('copyRecoveryBtn').addEventListener('click', async () => {
    await copyText(account.token);
    toast(`Code copié : ${account.token}`);
  });
  $('manageSubBtn').addEventListener('click', async () => {
    try { location.href = await account.portalUrl(appUrl()); } catch (err) { toast(err.message); }
  });

  refreshSettingsStatus = () => { showRelay(); showStt(); showTts(); showSub(); };
  refreshSettingsStatus();

  const genderButtons = [...document.querySelectorAll('#optGender [role="radio"]')];
  const showGender = () => genderButtons.forEach(b => b.setAttribute('aria-checked', String(b.dataset.value === settings.voiceGender)));
  genderButtons.forEach(b => b.addEventListener('click', () => {
    settings.voiceGender = b.dataset.value;
    saveSettings();
    showGender();
  }));
  showGender();

  const SAMPLES = {
    es: '¡Hola! Encantada de conocerte. ¿Te apetece tomar un café conmigo?',
    en: 'Hi there! Lovely to meet you. Would you like to grab a coffee with me?',
    fr: 'Bonjour ! Ravie de vous rencontrer. On prend un café ensemble ?',
    it: 'Ciao! Piacere di conoscerti. Ti va di prendere un caffè insieme?',
    de: 'Hallo! Schön, dich kennenzulernen. Wollen wir zusammen einen Kaffee trinken?',
    pt: 'Olá! Prazer em conhecer você. Vamos tomar um café juntos?',
  };
  $('testVoiceBtn').addEventListener('click', () => {
    Speaker.unlock();
    neuralErrorShown = false;
    const target = lang(settings.mode === 'conv' ? settings.b : settings.tgt);
    const base = engineCode(target).split('-')[0];
    const sample = SAMPLES[base] || SAMPLES.en;
    const sampleLang = SAMPLES[base] ? target : lang('en');
    speakMessage({ id: 'sample', to: sampleLang.code, translation: sample });
  });

  $('clearBtn').addEventListener('click', () => {
    const mode = settings.mode;
    if (!history[mode].length) { closeSheet(settingsSheet.sheet, settingsSheet.backdrop); return; }
    if (!confirm('Effacer tous les messages de ce mode ?')) return;
    stopSpeaking();
    history[mode] = [];
    saveHistory(mode);
    renderAll();
    closeSheet(settingsSheet.sheet, settingsSheet.backdrop);
    toast('Conversation effacée');
  });

  const notes = [];
  if (!Listener.supported) notes.push('La reconnaissance vocale n\'est pas disponible dans ce navigateur : utilisez Safari sur iPhone ou Chrome.');
  if (!window.speechSynthesis) notes.push('La synthèse vocale de l\'appareil est indisponible : une voix en ligne sera utilisée.');
  notes.push(`${LANGUAGES.length} langues disponibles en traduction. L'icône micro indique les langues reconnues à l'oral.`);
  notes.push(`Version ${APP_VERSION}.`);
  $('envNote').textContent = notes.join(' ');

}

// ---------------------------------------------------------------------------
// Saisie
// ---------------------------------------------------------------------------

function autosize() {
  el.input.style.height = 'auto';
  el.input.style.height = Math.min(el.input.scrollHeight, 140) + 'px';
  el.send.hidden = !el.input.value.trim();
}

function submitInput() {
  const text = el.input.value;
  if (!text.trim()) return;
  if (!ensureAccess()) return;
  el.input.value = '';
  autosize();
  stopSpeaking();
  translateTyped(text);
}

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

let toastTimer;
function toast(text) {
  el.toast.textContent = text;
  el.toast.hidden = false;
  el.toast.style.animation = 'none';
  void el.toast.offsetWidth;
  el.toast.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, Math.min(6000, 1800 + text.length * 45));
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = document.createElement('textarea');
    t.value = text;
    t.setAttribute('readonly', '');
    t.style.position = 'fixed';
    t.style.opacity = '0';
    document.body.append(t);
    t.select();
    try { document.execCommand('copy'); } catch { /* rien */ }
    t.remove();
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Hauteur réelle de l'écran quand le clavier iOS est ouvert.
function fitViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  if (vv.offsetTop) window.scrollTo(0, 0);
  // Hauteur cachée par le clavier : les feuilles (réglages, langues) remontent au-dessus.
  const kb = Math.max(0, Math.round(window.innerHeight - vv.height));
  const root = document.documentElement.style;
  root.setProperty('--vvh', `${vv.height}px`);
  root.setProperty('--kb', `${kb}px`);
  document.querySelectorAll('.sheet').forEach(sh => sh.classList.toggle('kb-open', kb > 80));
  el.app.style.height = `${vv.height}px`;
}

/** Garde le champ touché visible au-dessus du clavier, dans une feuille. */
function revealField(e) {
  const field = e.target;
  if (!field.matches?.('input, textarea') || !field.closest('.sheet')) return;
  setTimeout(() => field.scrollIntoView({ block: 'center', behavior: 'smooth' }), 350);
}

/** Boutons « Coller » : remplit le champ depuis le presse-papiers, sans clavier. */
async function pasteInto(input) {
  try {
    const text = (await navigator.clipboard.readText()).trim();
    if (!text) { toast('Le presse-papiers est vide. Copiez d\'abord la clé.'); return; }
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    toast('Collé ✓');
  } catch {
    input.focus();
    toast('Touchez le champ, puis « Coller ».');
  }
}

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------

function init() {
  document.querySelectorAll('.segmented [role="tab"]').forEach(t => t.addEventListener('click', () => setMode(t.dataset.mode)));

  el.srcBtn.addEventListener('click', () => openLangSheet(settings.mode === 'conv' ? 'b' : 'src'));
  el.tgtBtn.addEventListener('click', () => openLangSheet(settings.mode === 'conv' ? 'a' : 'tgt'));
  el.swap.addEventListener('click', swapLanguages);

  el.input.addEventListener('input', autosize);
  el.input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submitInput();
    }
  });
  el.send.addEventListener('click', () => { Speaker.unlock(); submitInput(); el.input.focus(); });
  el.mic.addEventListener('click', onMicText);
  el.convA.addEventListener('click', () => onMicConv('a'));
  el.convB.addEventListener('click', () => onMicConv('b'));

  langSheet.search.addEventListener('input', renderLangList);
  document.addEventListener('focusin', revealField);
  document.querySelectorAll('[data-paste]').forEach(btn => btn.addEventListener('click', () => pasteInto($(btn.dataset.paste))));
  bindSheet(langSheet.sheet, langSheet.backdrop);
  bindSheet(settingsSheet.sheet, settingsSheet.backdrop);
  $('settingsBtn').addEventListener('click', () => openSheet(settingsSheet.sheet, settingsSheet.backdrop));
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    closeSheet(langSheet.sheet, langSheet.backdrop);
    closeSheet(settingsSheet.sheet, settingsSheet.backdrop);
  });

  // Mise en arrière-plan : on coupe le micro et la voix.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    voiceRun++;
    voiceCancel();
    stopSpeaking();
  });

  window.addEventListener('offline', () => toast('Hors connexion — la traduction reprendra au retour du réseau.'));

  if (window.visualViewport) {
    visualViewport.addEventListener('resize', fitViewport);
    visualViewport.addEventListener('scroll', fitViewport);
    el.input.addEventListener('focus', () => setTimeout(() => scrollToBottom(true), 300));
  }

  bindSheet(accountSheet.sheet, accountSheet.backdrop);
  initSettings();
  applyMode();
  handleIncomingLinks();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // Une nouvelle version prend le relais : on recharge une fois pour l'afficher.
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded || voiceActive()) return;
      reloaded = true;
      location.reload();
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .then(reg => {
        reg.update().catch(() => {});
        document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
      })
      .catch(() => { /* fonctionne sans */ });
  }
}

init();
