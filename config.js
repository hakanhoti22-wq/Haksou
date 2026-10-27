// Réglages de publication de l'app.
//
// RELAY_URL : adresse de votre relais Cloudflare (ex. https://haksou-relais.votre-nom.workers.dev).
// Une fois remplie, l'app s'y connecte toute seule : essai gratuit, abonnements,
// invitations famille, micro fiable et voix naturelle, sans rien à configurer.
// Laissez vide pour utiliser l'app avec des clés saisies dans les réglages.
export const RELAY_URL = '';

// Prix affichés (doivent correspondre aux prix créés dans Stripe).
export const PRICES = {
  monthly: { label: '0,95 CHF', period: 'par mois' },
  yearly: { label: '9,95 CHF', period: 'par an', badge: '−13 %' },
};
