// Pointage fiable : si le réseau manque, le pointage est gardé sur le téléphone puis envoyé automatiquement.
import { db, session, newId, DEMO } from './db.js';
import { toast } from './utils.js';

const KEY = 'haksou-punch-queue';
const TIMEOUT = 6000;
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
const write = q => localStorage.setItem(KEY, JSON.stringify(q));
const isNetwork = e => !navigator.onLine || /failed to fetch|load failed|networkerror|network request|délai dépassé|fetch/i.test(e?.message || '');
const isDuplicate = e => /duplicate key|punches_pkey|23505/i.test(e?.message || '');
const withTimeout = p => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('Délai dépassé')), TIMEOUT))]);

/** Pointages en attente d'envoi pour l'utilisateur connecté (affichés comme s'ils étaient enregistrés). */
export const pending = () => read().filter(q => q.company_id === session.company?.id && q.user_id === session.profile?.id)
  .map(q => ({ ...q, pending: true }));

/**
 * Pointe maintenant. Renvoie { queued: true } si le pointage a été gardé pour plus tard.
 * L'identifiant est créé sur le téléphone : un pointage ne peut jamais être enregistré deux fois.
 */
export async function punchNow(type) {
  const item = { id: newId(), user_id: session.profile.id, company_id: session.company.id, type, at: new Date().toISOString() };
  if (!DEMO && !navigator.onLine) { write([...read(), item]); return { queued: true }; }
  try {
    await withTimeout(db.insert('punches', { id: item.id, user_id: item.user_id, type }));
    return { queued: false };
  } catch (e) {
    if (isDuplicate(e)) return { queued: false };      // la première tentative était bien arrivée
    if (!isNetwork(e)) throw e;                         // vraie erreur (droits…) : on l'affiche
    write([...read(), item]);
    return { queued: true };
  }
}

let flushing = null;
/** Envoie les pointages en attente. Appelé au démarrage, au retour du réseau et toutes les 30 s. */
export function flush() {
  if (flushing || !session.company || !read().length || !navigator.onLine) return flushing || Promise.resolve(0);
  flushing = (async () => {
    let sent = 0;
    for (const q of read()) {
      if (q.company_id !== session.company?.id || q.user_id !== session.profile?.id) continue;
      try { await withTimeout(db.insert('punches', { id: q.id, user_id: q.user_id, type: q.type, at: q.at, offline: true })); sent++; }
      catch (e) {
        if (isNetwork(e)) break;                        // toujours pas de réseau : on réessaiera
        if (!isDuplicate(e)) toast(`Pointage du ${new Date(q.at).toLocaleString('fr-CH')} refusé : ${e.message}`, 'err');
        else sent++;
      }
      write(read().filter(x => x.id !== q.id));
    }
    if (sent) { toast(`${sent} pointage${sent > 1 ? 's' : ''} hors ligne envoyé${sent > 1 ? 's' : ''} ✅`); window.dispatchEvent(new Event('haksou:synced')); }
    return sent;
  })().finally(() => { flushing = null; });
  return flushing;
}

window.addEventListener('online', () => flush());
setInterval(() => flush(), 30000);

// Derniers pointages connus, pour afficher l'écran même sans réseau
const CACHE = 'haksou-punch-cache';
export const isOffline = e => isNetwork(e);
/** Lit depuis le serveur, sans jamais rester bloqué plus de 6 s (réseau absent ou très mauvais). */
export const fetchOrFail = p => navigator.onLine ? withTimeout(p) : Promise.reject(new Error('Failed to fetch (hors ligne)'));
export function cacheMine(list) { try { localStorage.setItem(CACHE, JSON.stringify({ user: session.profile?.id, list: list.filter(p => !p.pending) })); } catch { /* plein */ } }
export function cachedMine() { try { const c = JSON.parse(localStorage.getItem(CACHE)); return c?.user === session.profile?.id ? c.list : []; } catch { return []; } }
