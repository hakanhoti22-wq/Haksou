// Moteur audio partagé (Web Audio) : utilisé pour mesurer le micro et pour
// lire les voix naturelles. Sur iPhone, Web Audio ne perturbe pas la
// reconnaissance vocale, contrairement aux éléments <audio>.

let ctx = null;

/** Renvoie l'AudioContext de l'app (créé à la demande). */
export function getAudioContext() {
  if (ctx && ctx.state !== 'closed') return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try { ctx = new AC(); } catch { ctx = null; }
  return ctx;
}

/**
 * À appeler pendant un geste de l'utilisateur : iOS ne laisse jouer le son
 * qu'à un AudioContext relancé lors d'un toucher.
 */
export function unlockAudio() {
  const c = getAudioContext();
  if (!c) return;
  c.resume?.().catch(() => {});
  try {
    // Un échantillon muet suffit à « débloquer » la sortie audio.
    const src = c.createBufferSource();
    src.buffer = c.createBuffer(1, 1, 22050);
    src.connect(c.destination);
    src.start(0);
  } catch { /* sans incidence */ }
}

/** Relance l'AudioContext s'il a été suspendu ; renvoie true s'il tourne. */
export async function ensureRunning() {
  const c = getAudioContext();
  if (!c) return false;
  if (c.state !== 'running') {
    try { await Promise.race([c.resume(), new Promise(r => setTimeout(r, 400))]); } catch { /* rien */ }
  }
  return c.state === 'running';
}
