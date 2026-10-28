// Lecture du texte d'une photo (menu, panneau, capture d'écran) par une IA qui voit les images.
// IA gratuite : Qwen sur Groq, via le relais ou une clé. La traduction se fait ensuite
// avec le moteur habituel de l'app.

import { apiFetch } from './api.js';

const MODELS = {
  groq: { path: '/openai/v1/chat/completions', model: 'qwen/qwen3.8-27b' },
  openai: { path: '/v1/chat/completions', model: 'gpt-4o-mini' },
};

const MAX_SIDE = 1600;      // assez net pour lire un menu, assez léger pour le réseau
const THUMB_SIDE = 220;     // vignette gardée dans l'historique

export class VisionError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

async function loadImage(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* repli <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function toJpeg(img, maxSide, quality) {
  const w = img.width, h = img.height;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

/** Image allégée pour l'IA et petite vignette pour l'historique. */
export async function prepareImage(file) {
  const img = await loadImage(file).catch(() => null);
  if (!img) throw new VisionError('image', 'Image illisible. Essayez une autre photo.');
  return { data: toJpeg(img, MAX_SIDE, 0.82), thumb: toJpeg(img, THUMB_SIDE, 0.7) };
}

const PROMPT = [
  'Read ALL the text visible in this image (menu, sign, label, document, chat screenshot…), exactly as written, in its original language.',
  'Keep the reading order and line breaks. For a chat screenshot, keep only the message texts (no times, no names, no interface buttons).',
  'Do not translate, do not describe the image, do not add comments.',
  'Answer ONLY with JSON: {"text": "the text", "language": "ISO 639-1 code of the main language"}. If there is no readable text, answer {"text": "", "language": ""}.',
].join('\n');

function parse(content) {
  const clean = String(content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const m = clean.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const j = JSON.parse(m[0]);
      return { text: String(j.text || '').trim(), language: String(j.language || '').trim().toLowerCase() };
    } catch { /* texte brut */ }
  }
  return { text: clean, language: '' };
}

/**
 * @param {string} dataUrl  image JPEG (data URL)
 * @param {import('./api.js').Cred} cred
 * @returns {Promise<{ text: string, language: string }>}
 */
export async function readImage(dataUrl, cred) {
  const conf = MODELS[cred.provider] || MODELS.groq;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 40000);
  let res;
  try {
    res = await apiFetch(cred, conf.path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: conf.model,
        temperature: 0,
        max_completion_tokens: 3000,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        }],
      }),
    });
  } catch {
    throw new VisionError('network', navigator.onLine ? 'La lecture de la photo a pris trop de temps. Réessayez.' : 'Pas de connexion internet.');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 402) throw new VisionError('payment', 'Abonnement requis.');
  if (res.status === 401 || res.status === 403) throw new VisionError('key', 'Accès refusé (compte ou clé non reconnu).');
  if (res.status === 413) throw new VisionError('size', 'Photo trop lourde. Essayez une capture plus petite.');
  if (res.status === 429) throw new VisionError('quota', 'Trop de photos pour le moment. Réessayez dans une minute.');
  if (!res.ok) throw new VisionError('server', `La lecture de la photo a échoué (${res.status}). Réessayez.`);
  const data = await res.json();
  return parse(data.choices?.[0]?.message?.content);
}
