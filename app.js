import { LANGUAGES, AUTO, findLanguage, engineCode, speechLocale, nativeName } from './languages.js';
import { translate } from './translator.js';
import { Listener, Speaker } from './speech.js';

const $ = id => document.getElementById(id);

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
let speakingId = null;
let voiceRun = 0; // incrémenté à chaque nouvelle action vocale pour ignorer les suites obsolètes

// ---------------------------------------------------------------------------
// Icônes
// ---------------------------------------------------------------------------

const ICON = {
  speaker: '<svg viewBox="0 0 24 24"><path d="M11 5 6.5 9H3.5v6h3L11 19z"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6M18.4 6.4a8 8 0 0 1 0 11.2"/></svg>',
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

function emptyState() {
  const conv = settings.mode === 'conv';
  const box = node('div', 'empty');
  box.innerHTML = `
    <div class="empty-icon">${conv ? ICON.people : ICON.sparkle}</div>
    <h3>${conv ? 'Conversation face à face' : 'Traduisez en un instant'}</h3>
    <p>${conv
      ? 'Chacun touche son micro et parle. La traduction s\'affiche et est lue à voix haute pour l\'autre personne.'
      : 'Écrivez ou touchez le micro. Plus de 180 langues, détection automatique de la langue.'}</p>`;
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

function renderMessage(m) {
  const wrap = node('div', 'exchange');
  wrap.dataset.id = m.id;

  if (m.kind === 'text') {
    // Bulle envoyée : le texte d'origine
    const sent = node('div', 'msg right');
    const fromLabel = m.auto ? `${langName(m.from)} · détecté` : langName(m.from);
    sent.append(node('div', 'msg-meta', escapeHtml(fromLabel)));
    const b1 = node('div', 'bubble');
    b1.textContent = m.original;
    sent.append(b1);
    wrap.append(sent);

    // Bulle reçue : la traduction
    const recv = node('div', 'msg left');
    recv.append(node('div', 'msg-meta', escapeHtml(langName(m.to))));
    recv.append(translationBubble(m, false));
    if (m.status === 'ok') recv.append(actions(m));
    wrap.append(recv);
  } else {
    const mine = m.side === 'a';
    const row = node('div', `msg ${mine ? 'right' : 'left other'}`);
    row.append(node('div', 'msg-meta', `${escapeHtml(langName(m.from))} → ${escapeHtml(langName(m.to))}`));
    row.append(translationBubble(m, true));
    if (m.status === 'ok') row.append(actions(m));
    wrap.append(row);
  }
  return wrap;
}

function translationBubble(m, withOriginal) {
  const b = node('div', 'bubble');
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
    const msg = node('span', withOriginal ? 'orig' : '', escapeHtml(m.error || 'Traduction impossible.'));
    b.append(msg, document.createElement('br'));
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
  const play = node('button', 'act' + (speakingId === m.id ? ' playing' : ''), ICON.speaker);
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
function liveBubble(side) {
  el.inner.querySelector('.empty')?.remove();
  const wrap = node('div', 'exchange live-exchange');
  const row = node('div', `msg ${side === 'left' ? 'left other' : 'right'}`);
  const b = node('div', 'bubble live', '<span class="typing"><i></i><i></i><i></i></span>');
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
    const res = await translate(m.original, m.auto ? 'auto' : engineCode(lang(m.from)), engineCode(lang(m.to)));
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
    await Speaker.speak(m.translation, { locale: speechLocale(target), engine: engineCode(target), rate: settings.rate });
  } finally {
    if (speakingId === m.id) {
      speakingId = null;
      refreshPlaying();
    }
  }
}

function stopSpeaking() {
  speakingId = null;
  Speaker.cancel();
  refreshPlaying();
}

function refreshPlaying() {
  el.inner.querySelectorAll('.exchange').forEach(ex => {
    ex.querySelector('.act')?.classList.toggle('playing', ex.dataset.id === speakingId);
  });
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
  if (listener.active) { listener.stop(); return; }
  stopSpeaking();
  const run = ++voiceRun;

  const spoken = lang(spokenSourceCode());
  const live = liveBubble('right');
  setListening(el.mic, true, `J'écoute en ${spoken.name.toLowerCase()}…`);

  let text = '';
  try {
    text = await listener.listen({
      lang: speechLocale(spoken),
      silenceMs: settings.silence * 1000,
      onText: t => { live.update(t); heard(el.mic); },
    });
  } catch (err) {
    live.remove();
    setListening(el.mic, false);
    if (run === voiceRun) toast(err.message);
    return;
  }
  live.remove();
  setListening(el.mic, false);
  if (run !== voiceRun) return;
  if (!text) { toast('Je n\'ai rien entendu. Touchez le micro et parlez.'); return; }
  await translateTyped(text, { from: spoken.code, spoken: true });
}

// ---------------------------------------------------------------------------
// Micro — mode Conversation
// ---------------------------------------------------------------------------

async function onMicConv(side) {
  Speaker.unlock();
  const btn = side === 'a' ? el.convA : el.convB;
  if (listener.active && btn.classList.contains('listening')) { listener.stop(); return; }
  listener.cancel();
  await converse(side, false);
}

async function converse(side, chained) {
  stopSpeaking();
  const run = ++voiceRun;
  const btn = side === 'a' ? el.convA : el.convB;
  const other = side === 'a' ? 'b' : 'a';
  const from = lang(settings[side]);
  const to = lang(settings[other]);

  setListening(el.convA, false);
  setListening(el.convB, false);
  const live = liveBubble(side === 'a' ? 'right' : 'left');
  setListening(btn, true, `J'écoute en ${from.name.toLowerCase()}…`);

  let text = '';
  try {
    text = await listener.listen({
      lang: speechLocale(from),
      silenceMs: settings.silence * 1000,
      onText: t => { live.update(t); heard(btn); },
    });
  } catch (err) {
    live.remove();
    setListening(btn, false);
    if (run !== voiceRun) return;
    toast(chained && err.code === 'not-allowed' ? 'Touchez le micro pour répondre.' : err.message);
    return;
  }
  live.remove();
  setListening(btn, false);
  if (run !== voiceRun) return;
  if (!text) {
    if (!chained) toast('Je n\'ai rien entendu. Touchez le micro et parlez.');
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
    el.srcLabel.textContent = langName(settings.b);
    el.tgtLabel.textContent = langName(settings.a);
    el.convLabelA.textContent = langName(settings.a);
    el.convLabelB.textContent = langName(settings.b);
    el.swap.disabled = false;
  } else {
    if (settings.src === 'auto') {
      el.srcLabel.innerHTML = settings.lastDetected
        ? `<svg class="auto-icon" viewBox="0 0 24 24" aria-label="Détection automatique"><path d="M12 2.5c.5 4.6 2.9 7 7.5 7.5-4.6.5-7 2.9-7.5 7.5-.5-4.6-2.9-7-7.5-7.5 4.6-.5 7-2.9 7.5-7.5Zm6.5 12c.25 2 1.25 3 3.25 3.25-2 .25-3 1.25-3.25 3.25-.25-2-1.25-3-3.25-3.25 2-.25 3-1.25 3.25-3.25Z"/></svg>${escapeHtml(langName(settings.lastDetected))}`
        : 'Détection auto';
    } else {
      el.srcLabel.textContent = langName(settings.src);
    }
    el.tgtLabel.textContent = langName(settings.tgt);
    el.swap.disabled = settings.src === 'auto' && !settings.lastDetected;
  }
}

function setMode(mode) {
  if (settings.mode === mode) return;
  listener.cancel();
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
  el.app.style.height = `${vv.height}px`;
  if (vv.offsetTop) window.scrollTo(0, 0);
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
    listener.cancel();
    stopSpeaking();
  });

  window.addEventListener('offline', () => toast('Hors connexion — la traduction reprendra au retour du réseau.'));

  if (window.visualViewport) {
    visualViewport.addEventListener('resize', fitViewport);
    visualViewport.addEventListener('scroll', fitViewport);
    el.input.addEventListener('focus', () => setTimeout(() => scrollToBottom(true), 300));
  }

  initSettings();
  applyMode();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* fonctionne sans */ });
  }
}

init();
