// Voix naturelles (IA) : Microsoft Azure (gratuit, via le relais), ElevenLabs (clé sk_…)
// ou OpenAI (clé sk-…). En cas d'échec, l'app reprend la voix de l'iPhone.

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

export const PROVIDER_NAMES = { azure: 'Microsoft Azure', elevenlabs: 'ElevenLabs', openai: 'OpenAI' };

// Voix prédéfinies, multilingues, disponibles pour tous les comptes.
const ELEVEN_VOICES = { female: 'EXAVITQu4vr4xnSDxMaL', male: 'JBFqnCBsd6RMkjVDRZzb' }; // Sarah, George
const OPENAI_VOICES = { female: 'coral', male: 'ash' };

// Langues prises en charge par ElevenLabs Flash v2.5 (codes ISO 639-1).
const ELEVEN_LANGS = new Set('en ja zh de hi fr ko pt it es id nl tr fil pl sv bg ro ar cs el fi hr ms sk da ta uk ru hu no vi'.split(' '));
// Langues que les voix OpenAI prononcent correctement (langues de Whisper).
const OPENAI_LANGS = new Set('af ar hy az be bs bg ca zh hr cs da nl en et fi fr gl de el he hi hu is id it ja kn kk ko lv lt mk ms mr mi ne no fa pl pt ro ru sr sk sl es sw sv tl ta th tr uk ur vi cy'.split(' '));

const ISO = { iw: 'he', jw: 'jv', 'zh-CN': 'zh', 'zh-TW': 'zh', yue: 'zh', 'pt-PT': 'pt', 'en-GB': 'en', 'es-MX': 'es', 'fr-CA': 'fr', 'fa-AF': 'fa' };
const isoOf = code => ISO[code] || code.split('-')[0];

// Voix Azure par langue : [féminine, masculine]. Le nom contient la région linguistique.
const AZURE_VOICES = {
  af: ['af-ZA-AdriNeural', 'af-ZA-WillemNeural'], am: ['am-ET-MekdesNeural', 'am-ET-AmehaNeural'],
  ar: ['ar-SA-ZariyahNeural', 'ar-SA-HamedNeural'], as: ['as-IN-YashicaNeural', 'as-IN-PriyomNeural'],
  az: ['az-AZ-BanuNeural', 'az-AZ-BabekNeural'], bg: ['bg-BG-KalinaNeural', 'bg-BG-BorislavNeural'],
  bn: ['bn-BD-NabanitaNeural', 'bn-BD-PradeepNeural'], bs: ['bs-BA-VesnaNeural', 'bs-BA-GoranNeural'],
  ca: ['ca-ES-JoanaNeural', 'ca-ES-EnricNeural'], cs: ['cs-CZ-VlastaNeural', 'cs-CZ-AntoninNeural'],
  cy: ['cy-GB-NiaNeural', 'cy-GB-AledNeural'], da: ['da-DK-ChristelNeural', 'da-DK-JeppeNeural'],
  de: ['de-DE-SeraphinaMultilingualNeural', 'de-DE-FlorianMultilingualNeural'], el: ['el-GR-AthinaNeural', 'el-GR-NestorasNeural'],
  en: ['en-US-AvaMultilingualNeural', 'en-US-AndrewMultilingualNeural'], 'en-GB': ['en-GB-SoniaNeural', 'en-GB-RyanNeural'],
  es: ['es-ES-ElviraNeural', 'es-ES-AlvaroNeural'], 'es-MX': ['es-MX-DaliaNeural', 'es-MX-JorgeNeural'],
  et: ['et-EE-AnuNeural', 'et-EE-KertNeural'], eu: ['eu-ES-AinhoaNeural', 'eu-ES-AnderNeural'],
  fa: ['fa-IR-DilaraNeural', 'fa-IR-FaridNeural'], fi: ['fi-FI-NooraNeural', 'fi-FI-HarriNeural'],
  tl: ['fil-PH-BlessicaNeural', 'fil-PH-AngeloNeural'], fr: ['fr-FR-VivienneMultilingualNeural', 'fr-FR-RemyMultilingualNeural'],
  'fr-CA': ['fr-CA-SylvieNeural', 'fr-CA-JeanNeural'], ga: ['ga-IE-OrlaNeural', 'ga-IE-ColmNeural'],
  gl: ['gl-ES-SabelaNeural', 'gl-ES-RoiNeural'], gu: ['gu-IN-DhwaniNeural', 'gu-IN-NiranjanNeural'],
  he: ['he-IL-HilaNeural', 'he-IL-AvriNeural'], hi: ['hi-IN-SwaraNeural', 'hi-IN-MadhurNeural'],
  hr: ['hr-HR-GabrijelaNeural', 'hr-HR-SreckoNeural'], hu: ['hu-HU-NoemiNeural', 'hu-HU-TamasNeural'],
  hy: ['hy-AM-AnahitNeural', 'hy-AM-HaykNeural'], id: ['id-ID-GadisNeural', 'id-ID-ArdiNeural'],
  is: ['is-IS-GudrunNeural', 'is-IS-GunnarNeural'], it: ['it-IT-ElsaNeural', 'it-IT-DiegoNeural'],
  ja: ['ja-JP-NanamiNeural', 'ja-JP-KeitaNeural'], jv: ['jv-ID-SitiNeural', 'jv-ID-DimasNeural'],
  ka: ['ka-GE-EkaNeural', 'ka-GE-GiorgiNeural'], kk: ['kk-KZ-AigulNeural', 'kk-KZ-DauletNeural'],
  km: ['km-KH-SreymomNeural', 'km-KH-PisethNeural'], kn: ['kn-IN-SapnaNeural', 'kn-IN-GaganNeural'],
  ko: ['ko-KR-SunHiNeural', 'ko-KR-InJoonNeural'], lo: ['lo-LA-KeomanyNeural', 'lo-LA-ChanthavongNeural'],
  lt: ['lt-LT-OnaNeural', 'lt-LT-LeonasNeural'], lv: ['lv-LV-EveritaNeural', 'lv-LV-NilsNeural'],
  mk: ['mk-MK-MarijaNeural', 'mk-MK-AleksandarNeural'], ml: ['ml-IN-SobhanaNeural', 'ml-IN-MidhunNeural'],
  mn: ['mn-MN-YesuiNeural', 'mn-MN-BataaNeural'], mr: ['mr-IN-AarohiNeural', 'mr-IN-ManoharNeural'],
  ms: ['ms-MY-YasminNeural', 'ms-MY-OsmanNeural'], mt: ['mt-MT-GraceNeural', 'mt-MT-JosephNeural'],
  my: ['my-MM-NilarNeural', 'my-MM-ThihaNeural'], no: ['nb-NO-PernilleNeural', 'nb-NO-FinnNeural'],
  ne: ['ne-NP-HemkalaNeural', 'ne-NP-SagarNeural'], nl: ['nl-NL-FennaNeural', 'nl-NL-MaartenNeural'],
  or: ['or-IN-SubhasiniNeural', 'or-IN-SukantNeural'], pa: ['pa-IN-VaaniNeural', 'pa-IN-OjasNeural'],
  pl: ['pl-PL-ZofiaNeural', 'pl-PL-MarekNeural'], ps: ['ps-AF-LatifaNeural', 'ps-AF-GulNawazNeural'],
  pt: ['pt-BR-FranciscaNeural', 'pt-BR-AntonioNeural'], 'pt-PT': ['pt-PT-RaquelNeural', 'pt-PT-DuarteNeural'],
  ro: ['ro-RO-AlinaNeural', 'ro-RO-EmilNeural'], ru: ['ru-RU-SvetlanaNeural', 'ru-RU-DmitryNeural'],
  si: ['si-LK-ThiliniNeural', 'si-LK-SameeraNeural'], sk: ['sk-SK-ViktoriaNeural', 'sk-SK-LukasNeural'],
  sl: ['sl-SI-PetraNeural', 'sl-SI-RokNeural'], so: ['so-SO-UbaxNeural', 'so-SO-MuuseNeural'],
  sq: ['sq-AL-AnilaNeural', 'sq-AL-IlirNeural'], sr: ['sr-RS-SophieNeural', 'sr-RS-NicholasNeural'],
  su: ['su-ID-TutiNeural', 'su-ID-JajangNeural'], sv: ['sv-SE-SofieNeural', 'sv-SE-MattiasNeural'],
  sw: ['sw-KE-ZuriNeural', 'sw-KE-RafikiNeural'], ta: ['ta-IN-PallaviNeural', 'ta-IN-ValluvarNeural'],
  te: ['te-IN-ShrutiNeural', 'te-IN-MohanNeural'], th: ['th-TH-PremwadeeNeural', 'th-TH-NiwatNeural'],
  tr: ['tr-TR-EmelNeural', 'tr-TR-AhmetNeural'], uk: ['uk-UA-PolinaNeural', 'uk-UA-OstapNeural'],
  ur: ['ur-PK-UzmaNeural', 'ur-PK-AsadNeural'], uz: ['uz-UZ-MadinaNeural', 'uz-UZ-SardorNeural'],
  vi: ['vi-VN-HoaiMyNeural', 'vi-VN-NamMinhNeural'], 'zh-CN': ['zh-CN-XiaoxiaoNeural', 'zh-CN-YunxiNeural'],
  'zh-TW': ['zh-TW-HsiaoChenNeural', 'zh-TW-YunJheNeural'], yue: ['zh-HK-HiuMaanNeural', 'zh-HK-WanLungNeural'],
  zu: ['zu-ZA-ThandoNeural', 'zu-ZA-ThembaNeural'],
};
// Voix multilingues : parlent une quarantaine de langues, utilisées si la voix locale échoue.
const AZURE_MULTI = ['en-US-AvaMultilingualNeural', 'en-US-AndrewMultilingualNeural'];
const AZURE_ALIASES = { iw: 'he', jw: 'jv', fil: 'tl', nb: 'no', 'fa-AF': 'ps' };

function azureVoice(langCode, gender) {
  const code = AZURE_ALIASES[langCode] || langCode;
  const pair = AZURE_VOICES[code] || AZURE_VOICES[code.split('-')[0]];
  return pair ? pair[gender === 'male' ? 1 : 0] : null;
}

/** Le fournisseur sait-il parler cette langue ? */
export function ttsSupports(provider, langCode) {
  if (provider === 'azure') return Boolean(azureVoice(langCode, 'female'));
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
export async function synthesize(text, { cred, backup = null, langCode, langName, gender = 'female', rate = 1 }) {
  try {
    return await synthesizeWith(text, cred, langCode, langName, gender, rate);
  } catch (err) {
    // Voix gratuite épuisée pour le mois (ou en panne) : on passe à la voix de secours.
    if (!backup || err.code === 'key' || !ttsSupports(backup.provider, langCode)) throw err;
    return synthesizeWith(text, backup, langCode, langName, gender, rate);
  }
}

async function synthesizeWith(text, cred, langCode, langName, gender, rate) {
  const provider = cred.provider;
  const cacheKey = `${provider}|${gender}|${rate}|${langCode}|${text}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey).slice(0);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    if (provider === 'azure') {
      res = await azure(text, cred, azureVoice(langCode, gender), rate, ctrl.signal);
      // Voix locale refusée : on retente avec une voix multilingue.
      if (res.status === 400) res = await azure(text, cred, AZURE_MULTI[gender === 'male' ? 1 : 0], rate, ctrl.signal, azureVoice(langCode, gender));
    } else {
      res = provider === 'elevenlabs'
        ? await elevenLabs(text, cred, langCode, gender, rate, ctrl.signal)
        : await openAi(text, cred, langName, gender, rate, ctrl.signal);
    }
  } catch {
    throw new TtsError('network', 'Voix naturelle injoignable.');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401 || res.status === 403) throw new TtsError('key', authMessage(cred, PROVIDER_NAMES[provider]));
  if (res.status === 402 || res.status === 429) throw new TtsError('quota', `Crédit ${PROVIDER_NAMES[provider]} épuisé pour le moment.`);
  if (res.status === 501) throw new TtsError('server', 'Voix naturelle non configurée sur le relais.');
  if (!res.ok) throw new TtsError('server', `Voix ${PROVIDER_NAMES[provider]} indisponible (${res.status}).`);

  const buf = await res.arrayBuffer();
  if (cache.size > 60) cache.delete(cache.keys().next().value);
  cache.set(cacheKey, buf);
  return buf.slice(0);
}

const xml = s => String(s).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '\'': '&apos;', '"': '&quot;' }[c]));

/**
 * Microsoft Azure (SSML). `localVoice` : voix locale d'origine, dont on garde la langue
 * pour guider une voix multilingue.
 */
function azure(text, cred, voice, rate, signal, localVoice = null) {
  const locale = (localVoice || voice).split('-').slice(0, 2).join('-');
  const pct = Math.round((Math.min(1.5, Math.max(0.5, rate)) - 1) * 100);
  let body = `<prosody rate="${pct >= 0 ? '+' : ''}${pct}%">${xml(text)}</prosody>`;
  if (localVoice) body = `<lang xml:lang="${locale}">${body}</lang>`;
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${locale}"><voice name="${voice}">${body}</voice></speak>`;
  return apiFetch(cred, '/cognitiveservices/v1', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/ssml+xml', Accept: 'audio/mpeg' },
    body: ssml,
  });
}

function elevenLabs(text, cred, langCode, gender, rate, signal) {
  const iso = isoOf(langCode) === 'tl' ? 'fil' : isoOf(langCode);
  return apiFetch(cred, `/v1/text-to-speech/${ELEVEN_VOICES[gender] || ELEVEN_VOICES.female}?output_format=mp3_44100_128`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text,
      // Flash v2.5 : le modèle le plus économe en crédits, voix naturelle.
      model_id: 'eleven_flash_v2_5',
      language_code: iso,
      voice_settings: {
        stability: 0.35,          // un peu plus bas = intonation plus vivante, moins monotone
        similarity_boost: 0.8,
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
