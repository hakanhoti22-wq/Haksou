// Transcription de l'audio enregistré (Whisper), via Groq (clé gsk_…) ou OpenAI (clé sk-…),
// directement ou via le relais familial.

import { apiFetch, authMessage } from './api.js';

export class SttError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const TIMEOUT_MS = 20000;

const PROVIDERS = {
  groq: { path: '/openai/v1/audio/transcriptions', model: 'whisper-large-v3-turbo' },
  openai: { path: '/v1/audio/transcriptions', model: 'whisper-1' },
};

export const providerFor = key => (key.trim().startsWith('gsk_') ? 'groq' : 'openai');

// Codes du moteur de traduction → codes ISO 639-1 attendus par Whisper.
const WHISPER_CODES = { iw: 'he', jw: 'jv', 'zh-CN': 'zh', 'zh-TW': 'zh', 'pt-PT': 'pt', 'fa-AF': 'fa', 'en-GB': 'en', 'es-MX': 'es', 'fr-CA': 'fr' };
const WHISPER_LANGS = new Set(('af am ar as az ba be bg bn bo br bs ca cs cy da de el en es et eu fa fi fo fr gl gu ha haw he hi hr ht hu hy id is it ja jv ka kk km kn ko la lb ln lo lt lv mg mi mk ml mn mr ms mt my ne nl nn no oc pa pl ps pt ro ru sa sd si sk sl sn so sq sr su sv sw ta te tg th tk tl tr tt uk ur uz vi yi yo yue zh').split(' '));

/** Phrases qu'invente parfois Whisper sur un enregistrement presque vide. */
const HALLUCINATIONS = [
  /sous-titr/i, /amara\.org/i, /merci d'avoir regardé/i, /thanks? (you )?for watching/i,
  /subtitles by/i, /please subscribe/i,
];

function whisperLanguage(code) {
  const c = WHISPER_CODES[code] || code.split('-')[0];
  return WHISPER_LANGS.has(c) ? c : null;
}

function extensionFor(type) {
  if (type.includes('mp4') || type.includes('m4a') || type.includes('aac')) return 'm4a';
  if (type.includes('ogg')) return 'ogg';
  if (type.includes('wav')) return 'wav';
  return 'webm';
}

/**
 * @param {Blob} blob   audio enregistré
 * @param {string} langCode  code de la langue parlée (moteur de traduction)
 * @param {import('./api.js').Cred} cred  clé ou relais (fournisseur groq ou openai)
 * @returns {Promise<string>} texte reconnu ('' si rien)
 */
export async function transcribe(blob, langCode, cred) {
  const provider = PROVIDERS[cred.provider];
  const language = whisperLanguage(langCode);

  const send = async (withLanguage) => {
    const form = new FormData();
    form.append('file', blob, `parole.${extensionFor(blob.type || '')}`);
    form.append('model', provider.model);
    form.append('response_format', 'json');
    form.append('temperature', '0');
    if (withLanguage && language) form.append('language', language);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await apiFetch(cred, provider.path, {
        method: 'POST',
        body: form,
        signal: ctrl.signal,
      });
    } catch {
      throw new SttError('network', navigator.onLine
        ? 'Le service de reconnaissance vocale ne répond pas. Réessayez.'
        : 'Pas de connexion internet.');
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401 || res.status === 403) throw new SttError('key', authMessage(cred, 'de reconnaissance vocale'));
    if (res.status === 429) throw new SttError('quota', 'Limite du service vocal atteinte. Réessayez dans une minute.');
    if (res.status === 400 && withLanguage && language) return send(false); // langue refusée : détection automatique
    if (!res.ok) throw new SttError('server', `Le service de reconnaissance vocale a échoué (${res.status}). Réessayez.`);
    const data = await res.json();
    return (data.text || '').trim();
  };

  let text;
  try {
    text = await send(true);
  } catch (err) {
    if (err.code !== 'network' && err.code !== 'server') throw err;
    text = await send(true); // une seconde tentative
  }
  if (HALLUCINATIONS.some(r => r.test(text))) return '';
  return text;
}
