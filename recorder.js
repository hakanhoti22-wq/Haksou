// Enregistrement de la voix au micro, avec détection du silence.
//
// Alternative fiable à la reconnaissance vocale de Safari (qui, sur les iOS
// récents, devient « sourde » après la première dictée) : on enregistre
// l'audio nous-mêmes, on détecte la fin de la parole grâce au volume, puis
// l'audio est transcrit par un service en ligne (voir stt.js).
//
// Le micro n'est ouvert que pendant l'écoute : l'iPhone repasse ensuite en
// mode haut-parleur pour lire la traduction.

export class RecorderError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const TICK_MS = 50;

function pickMimeType() {
  if (!window.MediaRecorder?.isTypeSupported) return '';
  return ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
    .find(t => MediaRecorder.isTypeSupported(t)) || '';
}

export class VoiceRecorder {
  static get supported() {
    return Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  }

  constructor() {
    this.session = null;
    this.ctx = null;
  }

  get active() { return Boolean(this.session); }

  /**
   * Enregistre une prise de parole. S'arrête seul après `silenceMs` de silence
   * suivant la parole, ou après `noSpeechMs` si personne ne parle.
   * Doit être appelé pendant un geste de l'utilisateur (toucher).
   *
   * @returns {Promise<{ blob: Blob, speech: boolean } | null>} null si annulé
   */
  record({ silenceMs = 1200, noSpeechMs = 8000, maxMs = 60000, onLevel, onSpeech } = {}) {
    this.cancel();
    const s = { cancelled: false, done: null };
    this.session = s;

    // L'AudioContext doit être créé/relancé pendant le geste (iOS).
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC && (!this.ctx || this.ctx.state === 'closed')) this.ctx = new AC();
      this.ctx?.resume?.().catch(() => {});
    } catch { this.ctx = null; }

    const promise = (async () => {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
        });
      } catch (err) {
        if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') {
          throw new RecorderError('not-allowed', 'Accès au micro refusé. Sur iPhone : Réglages → Apps → Safari → Micro → Autoriser.');
        }
        throw new RecorderError('audio-capture', 'Impossible d\'ouvrir le micro. Réessayez.');
      }
      if (s.cancelled) { stream.getTracks().forEach(t => t.stop()); return null; }
      return this.capture(s, stream, { silenceMs, noSpeechMs, maxMs, onLevel, onSpeech });
    })();

    return promise.finally(() => { if (this.session === s) this.session = null; });
  }

  capture(s, stream, { silenceMs, noSpeechMs, maxMs, onLevel, onSpeech }) {
    return new Promise((resolve, reject) => {
      const mimeType = pickMimeType();
      let rec;
      try {
        rec = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 64000 } : undefined);
      } catch {
        stream.getTracks().forEach(t => t.stop());
        reject(new RecorderError('recorder', 'L\'enregistrement audio n\'est pas pris en charge.'));
        return;
      }
      const chunks = [];
      rec.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };

      // Mesure du volume pour détecter la parole et le silence.
      let analyser = null;
      let source = null;
      try {
        if (this.ctx) {
          source = this.ctx.createMediaStreamSource(stream);
          analyser = this.ctx.createAnalyser();
          analyser.fftSize = 1024;
          source.connect(analyser);
        }
      } catch { analyser = null; }
      const buf = analyser ? new Float32Array(analyser.fftSize) : null;

      const startedAt = Date.now();
      let floor = null;        // bruit ambiant
      let voicedMs = 0;
      let speaking = false;
      let lastVoice = 0;
      let suspendedMs = 0;
      let vadBroken = !analyser;
      let finished = false;

      const finish = (keep) => {
        if (finished) return;
        finished = true;
        clearInterval(timer);
        clearTimeout(maxTimer);
        const cleanup = () => {
          stream.getTracks().forEach(t => t.stop());
          try { source?.disconnect(); } catch { /* rien */ }
        };
        if (!keep) {
          rec.onstop = null;
          try { rec.stop(); } catch { /* rien */ }
          cleanup();
          resolve(null);
          return;
        }
        rec.onstop = () => {
          cleanup();
          resolve({ blob: new Blob(chunks, { type: rec.mimeType || mimeType || 'audio/mp4' }), speech: speaking || vadBroken });
        };
        try { rec.stop(); } catch { cleanup(); resolve(null); }
      };
      s.finish = finish;

      const tick = () => {
        const now = Date.now();
        if (s.cancelled) { finish(false); return; }
        if (vadBroken) {
          // Pas de mesure du volume possible : on enregistre jusqu'au toucher suivant.
          if (!speaking) { speaking = true; onSpeech?.(); }
          onLevel?.(0.35 + 0.25 * Math.sin(now / 160));
          return;
        }
        // Moteur audio à l'arrêt (iOS) : on le relance ; s'il refuse, plus de mesure possible.
        if (this.ctx.state !== 'running') {
          this.ctx.resume?.().catch(() => {});
          suspendedMs += TICK_MS;
          if (suspendedMs >= 1000 && !speaking) vadBroken = true;
          return;
        }
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);

        if (floor == null) floor = rms;
        const threshold = Math.max(0.012, floor * 2.6);
        if (rms > threshold) {
          voicedMs += TICK_MS;
          if (voicedMs >= 150) {
            if (!speaking) { speaking = true; onSpeech?.(); }
            lastVoice = now;
          }
        } else {
          voicedMs = Math.max(0, voicedMs - TICK_MS / 2);
          floor = floor * 0.94 + rms * 0.06; // suit le bruit ambiant
        }
        onLevel?.(Math.min(1, rms / (threshold * 3)));

        if (speaking && now - lastVoice > silenceMs) finish(true);
        else if (!speaking && now - startedAt > noSpeechMs) finish(true);
      };

      rec.start(250);
      const timer = setInterval(tick, TICK_MS);
      const maxTimer = setTimeout(() => finish(true), maxMs);
    });
  }

  /** Termine l'enregistrement et garde l'audio. */
  stop() { this.session?.finish?.(true); }

  /** Abandonne l'enregistrement. */
  cancel() {
    const s = this.session;
    if (!s) return;
    s.cancelled = true;
    s.finish?.(false);
    this.session = null;
  }
}
