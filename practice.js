// Progression : série de jours, objectif quotidien et « Mes mots » (révision espacée).
// Tout reste sur l'appareil (stockage local).

const KEY = 'haksou.practice';
const WORDS_KEY = 'haksou.words';

const load = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};
const save = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* stockage indisponible */ }
};

/** Date locale « AAAA-MM-JJ » (décalage de jours possible). */
export function dayKey(offset = 0, from = new Date()) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const GOALS = [3, 5, 10, 20];

// ---------------------------------------------------------------------------
// Série de jours
// ---------------------------------------------------------------------------

export const Practice = {
  state: { goal: 5, days: {}, best: 0, reminder: false, ...load(KEY, {}) },

  persist() {
    // On ne garde que les 120 derniers jours.
    const keep = Object.keys(this.state.days).sort().slice(-120);
    this.state.days = Object.fromEntries(keep.map(k => [k, this.state.days[k]]));
    save(KEY, this.state);
  },

  today() { return this.state.days[dayKey()] || 0; },
  goal() { return this.state.goal; },
  done(key = dayKey()) { return (this.state.days[key] || 0) >= this.state.goal; },

  /** Jours d'affilée où l'objectif est atteint (aujourd'hui compte s'il est atteint, sinon la série d'hier tient encore). */
  streak() {
    let n = 0;
    let offset = this.done() ? 0 : -1;
    while (this.done(dayKey(offset))) { n++; offset--; }
    return n;
  },

  /** Ajoute de la pratique. Renvoie true si l'objectif du jour vient d'être atteint. */
  add(points = 1) {
    const k = dayKey();
    const before = this.done();
    this.state.days[k] = (this.state.days[k] || 0) + points;
    const reached = !before && this.done();
    this.state.best = Math.max(this.state.best || 0, this.streak());
    this.persist();
    return reached;
  },

  setGoal(goal) {
    this.state.goal = goal;
    this.state.best = Math.max(this.state.best || 0, this.streak());
    this.persist();
  },

  setReminder(on) { this.state.reminder = on; this.persist(); },

  /** Les 7 derniers jours (du plus ancien à aujourd'hui). */
  week() {
    return Array.from({ length: 7 }, (_, i) => {
      const k = dayKey(i - 6);
      const [y, m, d] = k.split('-').map(Number);
      return { key: k, date: new Date(y, m - 1, d), count: this.state.days[k] || 0, done: this.done(k), today: i === 6 };
    });
  },
};

// ---------------------------------------------------------------------------
// Mes mots : cartes de révision (système de Leitner)
// ---------------------------------------------------------------------------

const DAY = 864e5;
// Intervalle avant la prochaine révision, selon la boîte (0 = nouvelle carte).
const INTERVALS = [0, 1 * DAY, 3 * DAY, 7 * DAY, 16 * DAY, 35 * DAY, 90 * DAY];

const norm = s => String(s || '').trim().toLowerCase().replace(/[.!?¡¿,;:"«»]/g, '').replace(/\s+/g, ' ');

export const Words = {
  list: load(WORDS_KEY, []),

  persist() { save(WORDS_KEY, this.list.slice(-1000)); },

  find(front, lang) { return this.list.find(w => w.lang === lang && norm(w.front) === norm(front)); },
  has(front, lang) { return Boolean(this.find(front, lang)); },

  /**
   * Ajoute une carte (ignore les doublons).
   * @param {{ front: string, back: string, lang: string, backLang: string, source?: string }} card
   * @returns {boolean} true si la carte est nouvelle
   */
  add({ front, back, lang, backLang, source = 'manual' }) {
    if (!front?.trim() || this.has(front, lang)) return false;
    this.list.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      front: front.trim(), back: (back || '').trim(), lang, backLang, source,
      box: 0, due: Date.now(), added: Date.now(), reviews: 0,
    });
    this.persist();
    return true;
  },

  remove(id) {
    this.list = this.list.filter(w => w.id !== id);
    this.persist();
  },

  toggle(card) {
    const existing = this.find(card.front, card.lang);
    if (existing) { this.remove(existing.id); return false; }
    this.add(card);
    return true;
  },

  due(now = Date.now()) { return this.list.filter(w => w.due <= now).sort((a, b) => a.due - b.due); },
  dueCount() { return this.due().length; },

  /** Résultat d'une révision : la carte monte d'une boîte, ou revient au début. */
  grade(id, knew) {
    const w = this.list.find(x => x.id === id);
    if (!w) return;
    w.reviews = (w.reviews || 0) + 1;
    w.box = knew ? Math.min(w.box + 1, INTERVALS.length - 1) : 0;
    w.due = Date.now() + (knew ? INTERVALS[w.box] : 0);
    this.persist();
  },

  /** Cartes « apprises » : revues avec succès au moins 3 fois d'affilée. */
  learned() { return this.list.filter(w => w.box >= 3).length; },
};
