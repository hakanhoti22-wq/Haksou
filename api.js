// Accès aux services d'IA (Groq, OpenAI, ElevenLabs), soit directement avec
// une clé enregistrée sur l'appareil, soit via le relais familial qui garde
// les clés sur un serveur (seul le code famille est alors nécessaire).

const BASES = {
  groq: 'https://api.groq.com',
  openai: 'https://api.openai.com',
  elevenlabs: 'https://api.elevenlabs.io',
};

/**
 * @typedef {object} Cred
 * @property {'groq'|'openai'|'elevenlabs'} provider
 * @property {string} [key]    clé directe
 * @property {{ url: string, code: string }} [relay]  relais familial
 */

/** Envoie une requête au service, directement ou via le relais. */
export function apiFetch(cred, path, init = {}) {
  const headers = new Headers(init.headers || {});
  let url;
  if (cred.key) {
    url = BASES[cred.provider] + path;
    if (cred.provider === 'elevenlabs') headers.set('xi-api-key', cred.key.trim());
    else headers.set('Authorization', `Bearer ${cred.key.trim()}`);
  } else if (cred.relay?.url) {
    url = `${cred.relay.url.replace(/\/+$/, '')}/${cred.provider}${path}`;
    headers.set('X-Haksou-Code', cred.relay.code || '');
  } else {
    return Promise.reject(new Error('Aucune clé ni relais configuré.'));
  }
  return fetch(url, { ...init, headers });
}

/** Interroge le relais : quels services propose-t-il ? */
export async function relayStatus(relay) {
  const res = await fetch(`${relay.url.replace(/\/+$/, '')}/status`, {
    headers: { 'X-Haksou-Code': relay.code || '' },
    cache: 'no-store',
  });
  if (res.status === 401) throw new Error('Code famille incorrect.');
  if (!res.ok) throw new Error(`Relais injoignable (${res.status}).`);
  return res.json();
}

/** Message clair pour un refus d'accès (clé ou code famille). */
export const authMessage = (cred, name) => (cred.relay
  ? 'Code famille incorrect, ou clé manquante sur le relais.'
  : `Clé ${name} invalide. Vérifiez-la dans les réglages.`);
