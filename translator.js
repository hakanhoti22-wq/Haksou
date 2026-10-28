// Traduction : moteur principal Google (endpoint public), repli MyMemory,
// puis, si une clé Groq/OpenAI ou le relais familial est disponible, un modèle
// de langage en dernier recours.
// Chaque requête a un délai maximal et est retentée avant de basculer.

import { apiFetch } from './api.js';

const TIMEOUT_MS = 6000;
const GOOGLE_MAX = 1200;
const MYMEMORY_MAX = 480;

const cache = new Map();
let googleDownUntil = 0;

export class TranslationError extends Error {}

/**
 * Traduit `text` de `from` (code moteur ou 'auto') vers `to`.
 * @param {object} [opts]
 * @param {import('./api.js').Cred} [opts.cred]  accès Groq/OpenAI pour le dernier recours
 * @param {(code: string) => string} [opts.nameOf]  nom lisible d'une langue
 * @returns {Promise<{ text: string, detected: string|null }>}
 */
export async function translate(text, from, to, { cred = null, nameOf = c => c } = {}) {
  const clean = text.trim();
  if (!clean) return { text: '', detected: null };
  if (from !== 'auto' && from === to) return { text: clean, detected: from };

  const cacheKey = `${from}|${to}|${clean}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  // Après un échec du moteur principal, le secours passe en premier pendant quelques minutes.
  const googleFirst = Date.now() > googleDownUntil;
  const engines = googleFirst
    ? [() => google(clean, from, to), () => withRetry(() => myMemory(clean, from, to), 2)]
    : [() => myMemory(clean, from, to), () => google(clean, from, to)];
  if (cred) engines.push(() => llm(clean, from, to, cred, nameOf));

  let result;
  for (const [i, run] of engines.entries()) {
    try {
      result = await run();
      break;
    } catch {
      if (i === 0 && googleFirst) googleDownUntil = Date.now() + 5 * 60 * 1000;
    }
  }
  if (!result) {
    throw new TranslationError(navigator.onLine
      ? 'Le service de traduction ne répond pas. Réessayez.'
      : 'Pas de connexion internet.');
  }
  if (!googleFirst && result.engine === 'google') googleDownUntil = 0;

  if (cache.size > 300) cache.delete(cache.keys().next().value);
  cache.set(cacheKey, result);
  return result;
}

async function withRetry(fn, attempts) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (i < attempts - 1) await sleep(350 * (i + 1));
    }
  }
  throw last;
}

async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function google(text, from, to) {
  const parts = [];
  let detected = null;
  for (const chunk of splitText(text, GOOGLE_MAX)) {
    const params = new URLSearchParams({ client: 'gtx', sl: from, tl: to, dt: 't', dj: '1', ie: 'UTF-8', oe: 'UTF-8', q: chunk });
    const data = await fetchJson(`https://translate.googleapis.com/translate_a/single?${params}`);
    const out = (data.sentences || []).map(s => s.trans || '').join('');
    if (!out) throw new Error('Réponse vide');
    parts.push(out);
    detected = detected || data.src || null;
  }
  return { text: parts.join(' ').trim(), detected, engine: 'google' };
}

const LLM = {
  // GPT-OSS remplace Llama, retiré de l'offre gratuite de Groq (août 2026).
  groq: { path: '/openai/v1/chat/completions', model: 'openai/gpt-oss-120b', extra: { reasoning_effort: 'low', include_reasoning: false } },
  openai: { path: '/v1/chat/completions', model: 'gpt-4o-mini' },
};

async function llm(text, from, to, cred, nameOf) {
  const p = LLM[cred.provider];
  const source = from === 'auto' ? 'the source language (detect it)' : `${nameOf(from)} (${from})`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await apiFetch(cred, p.path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: p.model,
        temperature: 0,
        ...p.extra,
        messages: [
          { role: 'system', content: `You are a professional translator. Translate the user's text from ${source} into ${nameOf(to)} (${to}). Reply with the translation only, without quotes, notes or explanations.` },
          { role: 'user', content: text },
        ],
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const out = data.choices?.[0]?.message?.content?.trim();
    if (!out) throw new Error('Réponse vide');
    return { text: out, detected: from === 'auto' ? null : from, engine: 'llm' };
  } finally {
    clearTimeout(timer);
  }
}

const MM_CODES = { iw: 'he', jw: 'jv', tl: 'fil', 'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW', 'mni-Mtei': 'mni' };

async function myMemory(text, from, to) {
  const src = from === 'auto' ? 'autodetect' : (MM_CODES[from] || from);
  const tgt = MM_CODES[to] || to;
  const parts = [];
  let detected = from === 'auto' ? null : from;
  for (const chunk of splitText(text, MYMEMORY_MAX)) {
    const params = new URLSearchParams({ q: chunk, langpair: `${src}|${tgt}` });
    const data = await fetchJson(`https://api.mymemory.translated.net/get?${params}`);
    const out = data?.responseData?.translatedText;
    if (!out || data.responseStatus !== 200) throw new Error('MyMemory');
    parts.push(decodeEntities(out));
    detected = detected || data.responseData.detectedLanguage || null;
  }
  return { text: parts.join(' ').trim(), detected, engine: 'mymemory' };
}

function decodeEntities(s) {
  if (!/&[#a-z0-9]+;/i.test(s)) return s;
  const t = document.createElement('textarea');
  t.innerHTML = s;
  return t.value;
}

/** Découpe un texte long en morceaux, de préférence sur les fins de phrase. */
export function splitText(text, max) {
  if (text.length <= max) return [text];
  const sentences = text.match(/[^.!?。！？\n]+[.!?。！？\n]*\s*/g) || [text];
  const chunks = [];
  let current = '';
  for (const s of sentences) {
    if ((current + s).length > max && current) {
      chunks.push(current.trim());
      current = '';
    }
    if (s.length > max) {
      for (let i = 0; i < s.length; i += max) chunks.push(s.slice(i, i + max).trim());
    } else {
      current += s;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
