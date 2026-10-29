// Réglages de publication de l'app.
//
// RELAY_URL : adresse de votre relais Cloudflare (ex. https://haksou-relais.votre-nom.workers.dev).
// Une fois remplie, l'app s'y connecte toute seule : essai gratuit, abonnements,
// invitations famille, micro fiable et voix naturelle, sans rien à configurer.
// Laissez vide pour utiliser l'app avec des clés saisies dans les réglages.
export const RELAY_URL = 'https://haksou.hakan-hoti-22.workers.dev';

// Prix affichés (doivent correspondre aux prix créés dans Stripe).
// amount : prix en CHF ; months : durée couverte (sans durée = paiement unique, à vie).
export const PRICES = {
  quarterly: { label: '3,50 CHF', period: 'tous les 3 mois', amount: 3.5, months: 3 },
  yearly: { label: '11 CHF', period: 'par an', badge: '−21 %', amount: 11, months: 12 },
  lifetime: { label: '23 CHF', period: 'une seule fois', badge: 'Sans abonnement', amount: 23 },
  monthly: { label: '0,95 CHF', period: 'par mois', amount: 0.95, months: 1 }, // ancienne formule
};
