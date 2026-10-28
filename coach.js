// Coach de langue : un partenaire de conversation IA qui répond dans la langue
// apprise, corrige gentiment les erreurs et explique dans la langue de l'élève.
// IA gratuite : Llama 3.3 sur Groq (offre gratuite), via le relais ou une clé.

import { apiFetch } from './api.js';

export const LEVELS = {
  A: { label: 'Débutant', prompt: 'beginner (CEFR A1-A2): use very short, simple sentences, the most common words, mostly present tense, and speak slowly and clearly' },
  B: { label: 'Intermédiaire', prompt: 'intermediate (CEFR B1-B2): natural everyday sentences, common idioms, past and future tenses' },
  C: { label: 'Avancé', prompt: 'advanced (CEFR C1): fully natural, fluent speech with idioms and nuance, like a native speaker' },
};

export const SCENARIOS = {
  libre: { label: 'Discussion libre', prompt: 'a friendly free conversation about everyday life; show interest in the learner, their day, hobbies and plans' },
  resto: { label: 'Au restaurant', prompt: 'a role-play in a restaurant: you are the waiter, the learner is a customer who wants to order food and drinks' },
  hotel: { label: 'À l\'hôtel', prompt: 'a role-play at a hotel reception: you are the receptionist, the learner is checking in and asking questions' },
  chemin: { label: 'Demander son chemin', prompt: 'a role-play in the street: you are a friendly local, the learner is a tourist asking for directions' },
  courses: { label: 'Faire les courses', prompt: 'a role-play at a market or shop: you are the shop assistant, the learner wants to buy things and ask prices' },
  rencontre: { label: 'Faire connaissance', prompt: 'meeting a new friend at a party: introduce yourself and get to know each other' },
  medecin: { label: 'Chez le médecin', prompt: 'a role-play at the doctor: you are the doctor, the learner explains how they feel' },
  travail: { label: 'Entretien d\'embauche', prompt: 'a job interview: you are the interviewer, the learner is the candidate' },
};

const MODELS = {
  groq: { path: '/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile', fallback: 'llama-3.1-8b-instant' },
  openai: { path: '/v1/chat/completions', model: 'gpt-4o-mini' },
};

export class CoachError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function systemPrompt({ target, native, level, scenario }) {
  return [
    `You are "Haksou Coach", a warm, patient and encouraging ${target} conversation partner and language tutor.`,
    `The learner's native language is ${native}. Their level is ${LEVELS[level]?.prompt || LEVELS.A.prompt}.`,
    `Situation: ${SCENARIOS[scenario]?.prompt || SCENARIOS.libre.prompt}. Stay in this situation and keep the role-play going.`,
    'Rules:',
    `- "reply": always in ${target}, 1 or 2 short sentences, natural and friendly, and end with a question so the learner keeps talking.`,
    `- "translation": the ${native} translation of your reply.`,
    `- "correction": look at the learner's LAST message. If it has mistakes (grammar, vocabulary, spelling, word order) or is not in ${target}, give {"corrected": the correct natural ${target} sentence, "explanation": a very short, kind explanation in ${native} (max 20 words)}. If it is correct, or there is no learner message yet, use null. Ignore missing accents or punctuation that come from voice transcription.`,
    `- "praise": if the learner's last message was correct, a very short encouragement in ${native} (max 6 words), otherwise null.`,
    'Answer ONLY with a JSON object: {"reply": string, "translation": string, "correction": null | {"corrected": string, "explanation": string}, "praise": string | null}.',
  ].join('\n');
}

/** Extrait l'objet JSON de la réponse du modèle, même s'il est entouré de texte. */
function parseJson(text) {
  try { return JSON.parse(text); } catch { /* on cherche l'objet */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* invalide */ } }
  return { reply: text.trim(), translation: '', correction: null, praise: null };
}

/**
 * Un tour de conversation.
 * @param {object} o
 * @param {import('./api.js').Cred} o.cred   accès Groq ou OpenAI (relais ou clé)
 * @param {string} o.target   langue apprise (nom en anglais, ex. « Spanish »)
 * @param {string} o.native   langue de l'élève (nom en anglais)
 * @param {'A'|'B'|'C'} o.level
 * @param {string} o.scenario
 * @param {{ role: 'user'|'assistant', content: string }[]} o.turns  échanges précédents
 * @returns {Promise<{ reply: string, translation: string, correction: null | { corrected: string, explanation: string }, praise: string | null }>}
 */
export async function coachTurn({ cred, target, native, level, scenario, turns }) {
  const conf = MODELS[cred.provider] || MODELS.groq;
  const messages = [{ role: 'system', content: systemPrompt({ target, native, level, scenario }) }];
  if (!turns.length) {
    messages.push({ role: 'user', content: `(Start the conversation now: greet the learner in ${target} and ask a first simple question that fits the situation. No correction.)` });
  } else {
    messages.push(...turns.slice(-14));
  }

  const call = async (model) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      return await apiFetch(cred, conf.path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 400, response_format: { type: 'json_object' } }),
      });
    } catch {
      throw new CoachError('network', navigator.onLine ? 'Le coach ne répond pas. Réessayez.' : 'Pas de connexion internet.');
    } finally {
      clearTimeout(timer);
    }
  };

  let res = await call(conf.model);
  // Limite gratuite atteinte sur le grand modèle : on passe au modèle léger.
  if (res.status === 429 && conf.fallback) res = await call(conf.fallback);
  if (res.status === 402) throw new CoachError('payment', 'Abonnement requis.');
  if (res.status === 401 || res.status === 403) throw new CoachError('key', 'Accès au coach refusé (compte ou clé non reconnu).');
  if (res.status === 429) throw new CoachError('quota', 'Le coach est très demandé. Réessayez dans une minute.');
  if (!res.ok) throw new CoachError('server', `Le coach a rencontré un problème (${res.status}). Réessayez.`);

  const data = await res.json();
  const out = parseJson(data.choices?.[0]?.message?.content || '');
  if (!out.reply) throw new CoachError('server', 'Réponse du coach vide. Réessayez.');
  const c = out.correction;
  return {
    reply: String(out.reply).trim(),
    translation: String(out.translation || '').trim(),
    correction: c && c.corrected ? { corrected: String(c.corrected).trim(), explanation: String(c.explanation || '').trim() } : null,
    praise: out.praise ? String(out.praise).trim() : null,
  };
}
