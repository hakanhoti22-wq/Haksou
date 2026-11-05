// Liste des modules (ordre du menu).
export const MODULES = [
  { id: 'pointage', icon: '⏱️', label: 'Pointage', desc: 'Arrivées, départs et heures de l\'équipe' },
  { id: 'conges', icon: '🌴', label: 'Congés', desc: 'Demandes d\'absence et validation' },
  { id: 'planning', icon: '📅', label: 'Planning', desc: 'Horaires de la semaine' },
  { id: 'interventions', icon: '🔧', label: 'Interventions', desc: 'Bons d\'intervention, photos, signature' },
  { id: 'factures', icon: '🧾', label: 'Devis & factures', desc: 'Devis, factures, paiements' },
  { id: 'clients', icon: '👥', label: 'Clients', desc: 'Carnet d\'adresses des clients' },
  { id: 'stock', icon: '📦', label: 'Stock', desc: 'Articles, entrées, sorties, alertes' },
  { id: 'frais', icon: '💳', label: 'Notes de frais', desc: 'Tickets, validation, remboursement' },
];

export const STATUS = {
  leave: { en_attente: ['En attente', 'warn'], approuve: ['Approuvé', 'ok'], refuse: ['Refusé', 'err'] },
  expense: { en_attente: ['À valider', 'warn'], validee: ['Validée', 'info'], refusee: ['Refusée', 'err'], remboursee: ['Remboursée', 'ok'] },
  intervention: { planifiee: ['Planifiée', 'info'], en_cours: ['En cours', 'warn'], terminee: ['Terminée', 'ok'] },
  devis: { brouillon: ['Brouillon', ''], envoye: ['Envoyé', 'info'], accepte: ['Accepté', 'ok'], refuse: ['Refusé', 'err'] },
  facture: { brouillon: ['Brouillon', ''], envoyee: ['Envoyée', 'info'], payee: ['Payée', 'ok'], retard: ['En retard', 'err'] },
};
