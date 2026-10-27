// Voix naturelles (IA) : ElevenLabs (clé sk_…) ou OpenAI (clé sk-…), directement
// ou via le relais familial. En cas d'échec, l'app reprend la voix de l'iPhone.

import { apiFetch, authMessage } from './api.js';

export class TtsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const TIMEOUT_MS = 15000;

/** Fournisseur déduit de la forme de la clé. */
export function ttsProviderFor(key) {
  const k = (key || '').trim();
  if (!k) return null;
  if (k.startsWith('sk-')) return 'openai';
  if (k.startsWith('sk_') || /^[0-9a-f]{32}$/i.test(k)) return 'elevenlabs';
  return null;
}

export const PROVIDER_NAMES = { elevenlabs: 'ElevenLabs', openai: 'OpenAI' };

// Voix prédéfinies, multilingues, disponibles pour tous les comptes.
const ELEVEN_VOICES = { female: 'EXAVITQu4vr4xnSDxMaL', male: 'JBFqnCBsd6RMkjVDRZzb' }; // Sarah, George
const OPENAI_VOICES = { female: 'coral', male: 'ash' };

// Langues du modèle ElevenLabs Multilingual v2, le plus naturel et expressif.
const ELEVEN_MULTI = new Set('en ja zh de hi fr ko pt it es id nl tr fil pl sv bg ro ar cs el fi hr ms sk da ta uk ru'.split(' '));
// Langues prises en charge par ElevenLabs Flash v2.5 (codes ISO 639-1).
const ELEVEN_LANGS = new Set('en ja zh de hi fr ko pt it es id nl tr fil pl sv bg ro ar cs el fi hr ms sk da ta uk ru hu no vi'.split(' '));
// Langues que les voix OpenAI prononcent correctement (langues de Whisper).
const OPENAI_LANGS = new Set('af ar hy az be bs bg ca zh hr cs da nl en et fi fr gl de el he hi hu is id it ja kn kk ko lv lt mk ms mr mi ne no fa pl pt ro ru sr sk sl es sw sv tl ta th tr uk ur vi cy'.split(' '));

const ISO = { iw: 'he', jw: 'jv', 'zh-CN': 'zh', 'zh-TW': 'zh', yue: 'zh', 'pt-PT': 'pt', 'en-GB': 'en', 'es-MX': 'es', 'fr-CA': 'fr', 'fa-AF': 'fa' };
const isoOf = code => ISO[code] || code.split('-')[0];

/** Le fournisseur sait-il parler cette langue ? */
export function ttsSupports(provider, langCode) {
  const iso = isoOf(langCode);
  if (provider === 'elevenlabs') return ELEVEN_LANGS.has(iso === 'tl' ? 'fil' : iso);
  if (provider === 'openai') return OPENAI_LANGS.has(iso);
  return false;
}

const cache = new Map();

/**
 * Génère l'audio (MP3) d'un texte.
 * @param {string} text
 * @param {object} o
 * @param {import('./api.js').Cred} o.cred  clé ou relais (elevenlabs ou openai)
 * @param {string} o.langCode  code de la langue (moteur de traduction)
 * @param {string} o.langName  nom de la langue (pour les consignes de diction)
 * @param {'female'|'male'} [o.gender]
 * @param {number} [o.rate]    vitesse (1 = normale)
 * @returns {Promise<ArrayBuffer>}
 */
export async function synthesize(text, { cred, langCode, langName, gender = 'female', rate = 1 }) {
  const provider = cred.provider;
  const cacheKey = `${provider}|${gender}|${rate}|${langCode}|${text}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey).slice(0);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = provider === 'elevenlabs'
      ? await elevenLabs(text, cred, langCode, gender, rate, ctrl.signal)
      : await openAi(text, cred, langName, gender, rate, ctrl.signal);
  } catch {
    throw new TtsError('network', 'Voix naturelle injoignable.');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401 || res.status === 403) throw new TtsError('key', authMessage(cred, PROVIDER_NAMES[provider]));
  if (res.status === 402 || res.status === 429) throw new TtsError('quota', `Crédit ${PROVIDER_NAMES[provider]} épuisé pour le moment.`);
  if (!res.ok) throw new TtsError('server', `Voix ${PROVIDER_NAMES[provider]} indisponible (${res.status}).`);

  const buf = await res.arrayBuffer();
  if (cache.size > 60) cache.delete(cache.keys().next().value);
  cache.set(cacheKey, buf);
  return buf.slice(0);
}

function elevenLabs(text, cred, langCode, gender, rate, signal) {
  const iso = isoOf(langCode) === 'tl' ? 'fil' : isoOf(langCode);
  // Multilingual v2 : voix la plus humaine ; Flash v2.5 pour les quelques langues qu'il est seul à parler.
  const multi = ELEVEN_MULTI.has(iso);
  return apiFetch(cred, `/v1/text-to-speech/${ELEVEN_VOICES[gender] || ELEVEN_VOICES.female}?output_format=mp3_44100_128`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: multi ? 'eleven_multilingual_v2' : 'eleven_flash_v2_5',
      language_code: iso,
      voice_settings: {
        stability: multi ? 0.38 : 0.45,
        similarity_boost: 0.8,
        style: multi ? 0.25 : 0,
        use_speaker_boost: true,
        speed: Math.min(1.2, Math.max(0.7, rate)),
      },
    }),
  });
}

function openAi(text, cred, langName, gender, rate, signal) {
  const pace = rate < 0.9 ? ' Speak a little slowly and clearly.' : rate > 1.1 ? ' Speak at a lively, slightly fast pace.' : '';
  return apiFetch(cred, '/v1/audio/speech', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts',
      voice: OPENAI_VOICES[gender] || OPENAI_VOICES.female,
      input: text,
      response_format: 'mp3',
      instructions: `Speak in ${langName} like a warm, friendly native speaker in a real face-to-face conversation: natural rhythm, relaxed intonation, light smile in the voice, never robotic or announcer-like.${pace}`,
    }),
  });
}
