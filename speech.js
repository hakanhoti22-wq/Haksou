// Voix : reconnaissance (micro) et synthèse (lecture des traductions).

import { splitText } from './translator.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export class SpeechError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const ERROR_MESSAGES = {
  'not-allowed': 'Accès au micro refusé. Autorisez le micro et la reconnaissance vocale dans les réglages de Safari.',
  'service-not-allowed': 'La reconnaissance vocale est désactivée. Activez Siri & Dictée dans les réglages de l\'iPhone.',
  'audio-capture': 'Aucun micro disponible.',
  'network': 'La reconnaissance vocale nécessite une connexion internet.',
  'language-not-supported': 'La reconnaissance vocale n\'est pas disponible pour cette langue.',
  'unsupported': 'La reconnaissance vocale n\'est pas prise en charge par ce navigateur. Utilisez Safari sur iPhone.',
};

/**
 * Écoute une prise de parole et s'arrête seule après un silence.
 *
 * Fonctionnement :
 *  - écoute continue avec résultats intermédiaires (affichage en direct) ;
 *  - un minuteur de silence est relancé à chaque mot reconnu : à son terme,
 *    l'écoute est arrêtée et le texte final renvoyé ;
 *  - si personne ne parle, l'écoute s'arrête au bout de `noSpeechMs` ;
 *  - sur iPhone, juste après une lecture à voix haute, le micro peut démarrer
 *    « sourd » ou échouer : la session est alors relancée automatiquement,
 *    en conservant ce qui a déjà été reconnu ;
 *  - si le moteur ne confirme pas l'arrêt, le texte déjà reconnu est conservé.
 */
export class Listener {
  static get supported() { return Boolean(SR); }

  constructor() {
    this.session = null;
  }

  get active() { return Boolean(this.session); }

  /**
   * @param {object} opts
   * @param {string} opts.lang         locale BCP-47
   * @param {number} opts.silenceMs    délai de silence avant arrêt automatique
   * @param {number} [opts.deafMs]     délai sans aucun son avant de relancer le micro
   * @param {(text: string) => void} [opts.onText]   texte reconnu en direct
   * @returns {Promise<string>} texte reconnu ('' si rien)
   */
  listen({ lang, silenceMs = 1200, noSpeechMs = 10000, maxMs = 90000, deafMs = 2500, onText }) {
    if (!SR) return Promise.reject(new SpeechError('unsupported', ERROR_MESSAGES.unsupported));
    this.cancel();

    return new Promise((resolve, reject) => {
      const MAX_RESTARTS = 6;
      const s = {
        rec: null,
        base: '',       // texte des sessions précédentes (après relance)
        current: '',    // texte de la session en cours
        settled: false,
        stopping: false,
        restarts: 0,
        timers: {},
        get text() { return [this.base, this.current].filter(Boolean).join(' ').trim(); },
      };
      this.session = s;

      const clear = name => { clearTimeout(s.timers[name]); delete s.timers[name]; };
      const clearAll = () => Object.keys(s.timers).forEach(clear);

      const release = (rec, abort) => {
        if (!rec) return;
        rec.onresult = rec.onend = rec.onerror = rec.onaudiostart = rec.onsoundstart = rec.onspeechstart = null;
        if (abort && !rec._ended) { try { rec.abort(); } catch { /* déjà arrêté */ } }
        rec._ended = true;
      };

      const settle = (err) => {
        if (s.settled) return;
        s.settled = true;
        clearAll();
        if (this.session === s) this.session = null;
        release(s.rec, true);
        if (err && !s.text) reject(err); else resolve(s.text);
      };

      const finish = () => {
        if (s.settled || s.stopping) return;
        s.stopping = true;
        clearAll();
        if (s.rec._ended) { settle(); return; }
        try { s.rec.stop(); } catch { settle(); return; }
        // Le moteur doit confirmer l'arrêt (onend) ; sinon on garde ce qui a été entendu.
        s.timers.fallback = setTimeout(() => settle(), 1500);
      };
      s.finish = finish;
      s.settle = settle;

      const armSilence = () => {
        clear('silence');
        clear('noSpeech');
        s.timers.silence = setTimeout(finish, silenceMs);
      };

      // Relance une nouvelle session micro en gardant le texte déjà reconnu.
      const restart = (delay, err) => {
        if (s.settled || s.stopping) return;
        if (s.restarts >= MAX_RESTARTS) { settle(err); return; }
        s.restarts++;
        s.base = s.text;
        s.current = '';
        const old = s.rec;
        release(old, true);
        clear('deaf');
        s.timers.restart = setTimeout(() => {
          if (s.settled || s.stopping) return;
          try {
            s.rec = create();
            s.rec.start();
            armDeaf();
          } catch {
            restart(400, new SpeechError('start', 'Impossible de démarrer le micro. Réessayez.'));
          }
        }, delay);
      };

      // Micro « sourd » : aucun son capté peu après le démarrage → on relance.
      const armDeaf = () => {
        clear('deaf');
        s.timers.deaf = setTimeout(() => {
          if (!s.rec._heard && !s.current) restart(150);
        }, deafMs);
      };

      const create = () => {
        const rec = new SR();
        rec.lang = lang;
        rec.continuous = true;
        rec.interimResults = true;
        rec.maxAlternatives = 1;

        const heard = () => { rec._heard = true; clear('deaf'); };
        rec.onaudiostart = () => { /* le micro est ouvert, mais il peut encore être sourd */ };
        rec.onsoundstart = heard;
        rec.onspeechstart = heard;

        rec.onresult = (e) => {
          heard();
          const text = assemble(e.results);
          if (!text || text === s.current) return;
          s.current = text;
          onText?.(s.text);
          if (!s.stopping) armSilence();
        };

        rec.onerror = (e) => {
          if (s.rec !== rec || e.error === 'aborted') return;
          if (e.error === 'no-speech') return; // géré par onend
          const err = new SpeechError(e.error, ERROR_MESSAGES[e.error] || `La reconnaissance vocale a échoué (${e.error}). Réessayez.`);
          // Erreurs définitives : inutile d'insister.
          if (e.error === 'language-not-supported') { settle(err); return; }
          if ((e.error === 'not-allowed' || e.error === 'service-not-allowed') && s.restarts >= 1) { settle(err); return; }
          // Sur iPhone, ces erreurs sont souvent passagères (micro encore pris par la lecture).
          restart(450, err);
        };

        rec.onend = () => {
          rec._ended = true;
          if (s.settled || s.rec !== rec) return;
          if (s.stopping) { settle(); return; }
          // Arrêt spontané du moteur : on relance tant que l'écoute doit continuer.
          // (Le minuteur de silence ou de non-parole décidera de la fin.)
          restart(250);
        };
        return rec;
      };

      try {
        s.rec = create();
        s.rec.start();
      } catch {
        restart(400, new SpeechError('start', 'Impossible de démarrer le micro. Réessayez.'));
      }
      armDeaf();

      s.timers.noSpeech = setTimeout(finish, noSpeechMs);
      s.timers.max = setTimeout(finish, maxMs);
    });
  }

  /** Arrête l'écoute et conserve le texte reconnu. */
  stop() { this.session?.finish(); }

  /** Interrompt l'écoute et ignore le texte. */
  cancel() {
    const s = this.session;
    if (!s) return;
    s.base = '';
    s.current = '';
    s.settle();
  }
}

/**
 * Reconstruit le texte complet à partir des résultats.
 * Certaines versions de Safari renvoient, en mode continu, des résultats
 * cumulatifs (chaque résultat reprend les précédents) : on les fusionne
 * pour éviter les doublons.
 */
function assemble(results) {
  let text = '';
  for (let i = 0; i < results.length; i++) {
    const t = results[i][0]?.transcript?.trim();
    if (!t) continue;
    if (!text) text = t;
    else if (t.toLowerCase().startsWith(text.toLowerCase())) text = t;
    else if (!text.toLowerCase().endsWith(t.toLowerCase())) text += ' ' + t;
  }
  return text.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Synthèse vocale
// ---------------------------------------------------------------------------

const synth = window.speechSynthesis;
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

class SpeakerImpl {
  constructor() {
    this.voices = [];
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.token = 0;
    this.unlocked = false;
    this.lastSound = 0;
    this.loadVoices();
    synth?.addEventListener?.('voiceschanged', () => this.loadVoices());
  }

  loadVoices() {
    this.voices = synth?.getVoices() || [];
  }

  /**
   * À appeler pendant un geste de l'utilisateur (toucher) : iOS n'autorise
   * la lecture audio qu'après une première lecture déclenchée par un geste.
   */
  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    try {
      if (synth) {
        const u = new SpeechSynthesisUtterance(' ');
        u.volume = 0;
        synth.speak(u);
      }
    } catch { /* sans incidence */ }
    try {
      this.audio.src = SILENT_WAV;
      this.audio.play().catch(() => {});
    } catch { /* sans incidence */ }
  }

  /** Meilleure voix disponible pour une locale, ou null. */
  voiceFor(locale) {
    if (!this.voices.length) this.loadVoices();
    const want = locale.toLowerCase().replace('_', '-');
    const base = want.split('-')[0];
    let best = null;
    let bestScore = 0;
    for (const v of this.voices) {
      const vl = v.lang.toLowerCase().replace('_', '-');
      let score = 0;
      if (vl === want) score = 10;
      else if (vl.split('-')[0] === base) score = 5;
      else continue;
      if (/premium|enhanced|améliorée|siri|neural|natural/i.test(v.name)) score += 3;
      if (v.localService) score += 1;
      if (v.default) score += 0.5;
      if (/\b(compact|novelty|bells|bad news|bahh|boing|bubbles|cellos|whisper|zarvox|trinoids|organ|jester|superstar|wobble|good news|albert|fred|junior|ralph|grandma|grandpa|eddy|flo|reed|rocko|sandy|shelley)\b/i.test(v.name)) score -= 4;
      if (score > bestScore) { best = v; bestScore = score; }
    }
    return best;
  }

  get speaking() { return this.current != null; }

  cancel() {
    this.token++;
    if (this.current != null) this.lastSound = Date.now();
    this.current = null;
    try { synth?.cancel(); } catch { /* rien */ }
    this.releaseAudio();
  }

  /** Libère le lecteur audio pour que le micro retrouve la main (iPhone). */
  releaseAudio() {
    try {
      if (!this.audio.paused) this.audio.pause();
      if (this.audio.src && !this.audio.src.startsWith('data:')) {
        this.audio.removeAttribute('src');
        this.audio.load();
      }
    } catch { /* rien */ }
  }

  /** Une lecture vient-elle d'avoir lieu ? */
  playedRecently(ms = 3000) {
    return this.current != null || Date.now() - this.lastSound < ms;
  }

  /**
   * Lit `text` dans la langue `locale`. Utilise une voix de l'appareil quand
   * elle existe, sinon une voix en ligne.
   * @returns {Promise<void>} résolue à la fin de la lecture (ou à l'annulation)
   */
  async speak(text, { locale, engine, rate = 1 } = {}) {
    this.cancel();
    const token = this.token;
    this.current = token;
    const voice = synth ? this.voiceFor(locale) : null;
    try {
      if (voice) {
        try {
          await this.speakNative(text, voice, locale, rate, token);
        } catch {
          if (token === this.token) await this.speakOnline(text, engine, rate, token);
        }
      } else {
        await this.speakOnline(text, engine, rate, token);
      }
    } finally {
      if (this.current === token) {
        this.current = null;
        this.lastSound = Date.now();
        this.releaseAudio();
      }
    }
  }

  async speakNative(text, voice, locale, rate, token) {
    // Les textes longs sont lus par morceaux : certains moteurs coupent au-delà.
    await sleep(60);
    for (const chunk of splitText(text, 220)) {
      if (token !== this.token) return;
      await new Promise((resolve, reject) => {
        const u = new SpeechSynthesisUtterance(chunk);
        try { u.voice = voice; } catch { /* voix non transmissible : la langue suffit */ }
        u.lang = voice.lang || locale;
        u.rate = rate;
        u.pitch = 1;
        let done = false;
        const end = (err) => {
          if (done) return;
          done = true;
          clearTimeout(guard);
          err ? reject(err) : resolve();
        };
        // Garde-fou : certains navigateurs n'émettent jamais « end ».
        const guard = setTimeout(() => end(), 4000 + (chunk.length * 95) / rate);
        u.onend = () => end();
        u.onerror = (e) => end(e.error === 'interrupted' || e.error === 'canceled' ? null : new Error(e.error));
        synth.speak(u);
      });
    }
  }

  async speakOnline(text, engine, rate, token) {
    for (const chunk of splitText(text, 190)) {
      if (token !== this.token) return;
      const params = new URLSearchParams({ ie: 'UTF-8', client: 'tw-ob', tl: engine, q: chunk });
      await new Promise((resolve) => {
        const a = this.audio;
        let done = false;
        const end = () => {
          if (done) return;
          done = true;
          clearTimeout(guard);
          a.onended = a.onerror = null;
          resolve();
        };
        const guard = setTimeout(end, 8000 + chunk.length * 120);
        a.onended = end;
        a.onerror = end;
        a.src = `https://translate.google.com/translate_tts?${params}`;
        a.playbackRate = rate;
        a.play().catch(end);
      });
    }
  }
}

export const Speaker = new SpeakerImpl();

const sleep = ms => new Promise(r => setTimeout(r, ms));
