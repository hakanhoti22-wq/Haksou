// Compte Haksou auprès du relais : essai gratuit, abonnement, accès famille.
// Le jeton du compte (aussi « code de récupération ») est gardé sur l'appareil.

const TOKEN_KEY = 'haksou.token';
const ACCOUNT_KEY = 'haksou.account';

const read = (k, fallback) => { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } };
const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ } };

export class AccountError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export class Account {
  /** @param {() => string} relayUrl  adresse du relais */
  constructor(relayUrl) {
    this.relayUrl = relayUrl;
    this.token = read(TOKEN_KEY, null);
    this.info = read(ACCOUNT_KEY, null);
  }

  get known() { return Boolean(this.token); }

  save(token, info) {
    if (token) { this.token = token; write(TOKEN_KEY, token); }
    if (info) { this.info = { ...info, savedAt: Date.now() }; write(ACCOUNT_KEY, this.info); }
    return this.info;
  }

  forget() {
    this.token = null;
    this.info = null;
    write(TOKEN_KEY, null);
    write(ACCOUNT_KEY, null);
  }

  async call(path, body, token = this.token) {
    const base = this.relayUrl().replace(/\/+$/, '');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['X-Haksou-Token'] = token;
    let res;
    try {
      res = await fetch(base + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
      });
    } catch {
      throw new AccountError(0, 'Connexion impossible. Vérifiez internet.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new AccountError(res.status, data.error || `Erreur ${res.status}`);
    if (data.token || data.account) this.save(data.token, data.account);
    return data;
  }

  /** Met à jour l'état du compte. */
  refresh() { return this.call('/account'); }

  /** Démarre l'essai gratuit. */
  start(email) { return this.call('/account/start', { email }); }

  /** Rejoint la famille avec un lien d'invitation. */
  joinFamily(code) { return this.call('/account/invite', { code }); }

  /** Retrouve un compte avec son code de récupération. */
  async restore(code) {
    const clean = code.trim().toUpperCase();
    const data = await this.call('/account/restore', undefined, clean);
    this.save(clean, data.account);
    return data;
  }

  /** Adresse de la page de paiement Stripe. */
  async checkoutUrl(plan, returnUrl) { return (await this.call('/billing/checkout', { plan, returnUrl })).url; }

  /** Confirme un paiement au retour de Stripe. */
  confirm(sessionId) { return this.call('/billing/confirm', { sessionId }); }

  /** Adresse du portail Stripe (gérer / résilier). */
  async portalUrl(returnUrl) { return (await this.call('/billing/portal', { returnUrl })).url; }
}

/** Appels de l'espace propriétaire (code propriétaire requis). */
export async function adminCall(relayUrl, code, path, body) {
  const res = await fetch(relayUrl.replace(/\/+$/, '') + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Haksou-Code': code },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AccountError(res.status, data.error || `Erreur ${res.status}`);
  return data;
}
