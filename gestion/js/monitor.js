// Supervision : chaque erreur inattendue est envoyée à la console du propriétaire (sans jamais gêner l'utilisateur).
import { storeError } from './db.js';
import { APP_VERSION } from './meta.js';

const seen = new Map();
let total = 0;
/** Erreurs « normales » (règles métier, réseau) : affichées à l'utilisateur, pas remontées comme bugs. */
const EXPECTED = /Remplis|Indique|Choisis|Ajoute|Réservé|refus|interdit|désactivé|Failed to fetch|Load failed|NetworkError|Délai dépassé|ne peut|déjà|introuvable|invalid login|incorrect/i;

export function reportError(err, where = '') {
  try {
    const message = String(err?.message || err || 'Erreur inconnue').slice(0, 2000);
    if (EXPECTED.test(message)) return;
    const last = seen.get(message);
    if ((last && Date.now() - last < 60000) || ++total > 30) return;   // pas plus d'une fois par minute, 30 par visite
    seen.set(message, Date.now());
    storeError({
      message,
      stack: String(err?.stack || '').slice(0, 8000),
      url: (location.hash || '#/') .slice(0, 300) + (where ? ' · ' + where : ''),
      user_agent: navigator.userAgent.slice(0, 500),
      app_version: APP_VERSION,
    }).catch(() => {});
  } catch { /* la supervision ne doit jamais provoquer d'erreur */ }
}

window.addEventListener('error', e => reportError(e.error || e.message, 'window'));
window.addEventListener('unhandledrejection', e => reportError(e.reason, 'promise'));
