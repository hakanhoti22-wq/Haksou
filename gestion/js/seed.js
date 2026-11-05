// Données d'exemple du mode démo (générées autour de la date du jour).
import { isoDate } from './utils.js';

export const ALL_MODULES = ['pointage', 'conges', 'planning', 'interventions', 'factures', 'clients', 'stock', 'frais'];

export function buildSeed(newId) {
  const now = new Date(), stamp = now.toISOString(), Y = now.getFullYear();
  const cid = newId();
  const row = r => ({ id: newId(), company_id: cid, created_at: stamp, ...r });
  const day = n => { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d; };
  const at = (n, h, m) => { const d = day(n); d.setHours(h, m, 0, 0); return d.toISOString(); };
  const rnd = n => Math.floor(Math.random() * n);

  const company = {
    id: cid, created_at: stamp, name: 'Démo Services Sàrl', join_code: 'DEMO42',
    address: 'Route de l\'Ancienne-Papeterie 1\n1723 Marly', phone: '026 000 00 00', email: 'contact@demo-services.ch',
    iban: 'CH93 0076 2011 6238 5295 7', currency: 'CHF', vat: 8.1, hourly_rate: 95, week_hours: 42, punch_self_edit: true, status: 'actif', support_allowed: true,
    modules: [...ALL_MODULES],
  };
  const [boss, lea, karim] = [
    { name: 'Hakan (patron)', role: 'admin', email: 'hakan@demo.ch' },
    { name: 'Léa Martin', role: 'employe', email: 'lea@demo.ch' },
    { name: 'Karim Benali', role: 'employe', email: 'karim@demo.ch' },
  ].map(p => row(p));

  // Pointages des 10 derniers jours ouvrés (+ aujourd'hui pour les employés)
  const punches = [];
  for (let n = -12; n <= 0; n++) {
    const wd = day(n).getDay();
    if (wd === 0 || wd === 6) continue;
    for (const u of [boss, lea, karim]) {
      if (n === 0) {
        if (u !== boss && now.getHours() >= 8) punches.push(row({ user_id: u.id, type: 'in', at: at(0, 7, 50 + rnd(15)) }));
        continue;
      }
      if (u === lea && n === -4) continue; // absente
      punches.push(row({ user_id: u.id, type: 'in', at: at(n, 7, 45 + rnd(20)) }));
      punches.push(row({ user_id: u.id, type: 'out', at: at(n, 12, rnd(10)) }));
      punches.push(row({ user_id: u.id, type: 'in', at: at(n, 12, 50 + rnd(15)) }));
      punches.push(row({ user_id: u.id, type: 'out', at: at(n, 17, rnd(40)) }));
    }
  }

  // Planning de la semaine courante
  const mon = -((now.getDay() + 6) % 7);
  const shifts = [];
  for (let i = 0; i < 5; i++) {
    const date = isoDate(day(mon + i));
    shifts.push(row({ user_id: lea.id, date, start_time: '08:00', end_time: '17:00', note: 'Atelier' }));
    shifts.push(row({ user_id: karim.id, date, start_time: '07:00', end_time: '16:00', note: 'Chantiers' }));
  }
  shifts.push(row({ user_id: karim.id, date: isoDate(day(mon + 5)), start_time: '08:00', end_time: '12:00', note: 'Permanence' }));

  const leaves = [
    row({ user_id: lea.id, kind: 'Vacances', start_date: isoDate(day(14)), end_date: isoDate(day(18)), reason: 'Vacances en famille', status: 'en_attente' }),
    row({ user_id: karim.id, kind: 'Maladie', start_date: isoDate(day(-20)), end_date: isoDate(day(-20)), reason: '', status: 'approuve' }),
  ];

  const clients = [
    row({ name: 'Boulangerie du Centre', contact: 'M. Rossier', email: 'info@boulangerie-centre.ch', phone: '026 111 22 33', address: 'Rue de Lausanne 12\n1700 Fribourg', notes: '' }),
    row({ name: 'Garage Rapide SA', contact: 'Mme Favre', email: 'atelier@garage-rapide.ch', phone: '026 444 55 66', address: 'Route de Fribourg 8\n1723 Marly', notes: 'Accès par l\'arrière' }),
    row({ name: 'Sophie Dubois', contact: '', email: 'sophie.dubois@example.ch', phone: '079 123 45 67', address: 'Chemin des Prés 3\n1630 Bulle', notes: '' }),
  ];

  const items = [
    row({ name: 'Tube cuivre 15 mm', ref: 'CU-15', barcode: '7612345000011', qty: 40, min_qty: 10, unit: 'm', price: 6.5 }),
    row({ name: 'Raccord laiton 1/2"', ref: 'RL-12', barcode: '7612345000028', qty: 8, min_qty: 20, unit: 'pce', price: 3.2 }),
    row({ name: 'Robinet mitigeur', ref: 'MIT-01', barcode: '7612345000035', qty: 5, min_qty: 2, unit: 'pce', price: 89 }),
    row({ name: 'Joints fibre (sachet)', ref: 'JF-50', barcode: '7612345000042', qty: 3, min_qty: 5, unit: 'sachet', price: 4.9 }),
    row({ name: 'Silicone sanitaire', ref: 'SIL-B', barcode: '7612345000059', qty: 14, min_qty: 6, unit: 'pce', price: 9.8 }),
  ];
  const movements = [
    row({ item_id: items[0].id, user_id: boss.id, delta: 50, reason: 'Livraison fournisseur', at: at(-9, 9, 0) }),
    row({ item_id: items[0].id, user_id: karim.id, delta: -10, reason: 'Chantier Garage Rapide', at: at(-3, 14, 0) }),
    row({ item_id: items[1].id, user_id: karim.id, delta: -12, reason: 'Chantier Boulangerie', at: at(-2, 10, 30) }),
  ];

  const documents = [
    row({ kind: 'devis', number: `D-${Y}-001`, client_id: clients[1].id, date: isoDate(day(-15)), due_date: isoDate(day(15)), status: 'accepte', vat: 8.1, notes: 'Devis valable 30 jours.',
      lines: [{ desc: 'Remplacement colonne d\'eau', qty: 1, price: 680 }, { desc: 'Tube cuivre 15 mm', qty: 12, price: 6.5 }, { desc: 'Main d\'œuvre', qty: 6, price: 95 }] }),
    row({ kind: 'facture', number: `F-${Y}-001`, client_id: clients[0].id, date: isoDate(day(-25)), due_date: isoDate(day(5)), status: 'payee', vat: 8.1, notes: 'Merci pour votre confiance.',
      lines: [{ desc: 'Dépannage fuite cuisine', qty: 1, price: 150 }, { desc: 'Main d\'œuvre', qty: 2, price: 95 }] }),
    row({ kind: 'facture', number: `F-${Y}-002`, client_id: clients[2].id, date: isoDate(day(-40)), due_date: isoDate(day(-10)), status: 'envoyee', vat: 8.1, notes: '',
      lines: [{ desc: 'Installation robinet mitigeur', qty: 1, price: 89 }, { desc: 'Main d\'œuvre', qty: 1.5, price: 95 }] }),
  ];

  const interventions = [
    row({ title: 'Fuite sous évier', client_id: clients[0].id, user_id: lea.id, date: isoDate(day(-1)), status: 'terminee', hours: 1.5,
      description: 'Le client signale une fuite sous l\'évier de la cuisine.', work_done: 'Remplacement du siphon et des joints. Test d\'étanchéité OK.',
      materials: 'Siphon, 2 joints fibre', photos: [], signature: null, signer_name: 'M. Rossier', signed_at: at(-1, 15, 20) }),
    row({ title: 'Contrôle chauffe-eau', client_id: clients[1].id, user_id: karim.id, date: isoDate(day(0)), status: 'planifiee', hours: 0,
      description: 'Contrôle annuel du chauffe-eau de l\'atelier.', work_done: '', materials: '', photos: [], signature: null, signer_name: '', signed_at: null }),
  ];

  const expenses = [
    row({ user_id: karim.id, date: isoDate(day(-2)), amount: 72.4, category: 'Carburant', description: 'Plein camionnette', receipt: null, status: 'en_attente' }),
    row({ user_id: lea.id, date: isoDate(day(-6)), amount: 24.5, category: 'Repas', description: 'Repas chantier Bulle', receipt: null, status: 'validee' }),
    row({ user_id: karim.id, date: isoDate(day(-12)), amount: 8, category: 'Parking', description: 'Parking Fribourg centre', receipt: null, status: 'remboursee' }),
  ];

  // Exemple de correction : Karim a oublié de pointer son départ avant-hier
  const audit_log = [];
  const fix = punches.filter(p => p.user_id === karim.id && p.type === 'out').slice(-2)[0];
  if (fix) {
    const before = fix.at, after = new Date(new Date(fix.at).getTime() - 25 * 6e4).toISOString();
    Object.assign(fix, { at: after, edited: true, note: 'Oublié de pointer en partant du chantier' });
    audit_log.push(row({ actor_id: karim.id, table_name: 'punches', row_id: fix.id, action: 'modification', at: stamp,
      details: { user_id: karim.id, type_avant: 'out', type: 'out', at_avant: before, at: after, note: fix.note } }));
  }

  // Deuxième entreprise cliente (en essai) et propriétaire de la plateforme, pour la console
  const c2 = { ...company, id: newId(), name: 'Boulangerie Rossier', join_code: 'PAIN77', admin_code: null, address: 'Rue de Lausanne 12\n1700 Fribourg',
    phone: '026 111 22 33', email: 'info@boulangerie-rossier.ch', iban: '', status: 'essai', trial_ends_at: isoDate(day(12)), modules: ['pointage', 'conges', 'planning', 'stock'] };
  const c2row = r => ({ ...row(r), company_id: c2.id });
  const marc = c2row({ name: 'Marc Rossier', role: 'admin', email: 'marc@boulangerie-rossier.ch' });
  const sofia = c2row({ name: 'Sofia Lopes', role: 'employe', email: 'sofia@boulangerie-rossier.ch' });
  for (let n = -3; n <= -1; n++) for (const u of [marc, sofia]) {
    punches.push(c2row({ user_id: u.id, type: 'in', at: at(n, 5, 30 + rnd(10)) }), c2row({ user_id: u.id, type: 'out', at: at(n, 13, rnd(20)) }));
  }
  const owner = { id: newId(), created_at: stamp, company_id: null, name: 'Hakan (propriétaire Haksou)', role: 'employe', email: 'hakan@haksou.ch', platform: true };
  const support_tickets = [
    c2row({ user_id: sofia.id, message: 'Bonjour, je ne trouve pas comment corriger mon pointage d\'hier, j\'ai oublié de pointer en partant.', context: '#/pointage · v1.2.0', status: 'ouvert', reply: '', replied_at: null }),
    row({ user_id: lea.id, message: 'Comment ajouter notre logo sur les factures ?', context: '#/factures · v1.2.0', status: 'resolu', reply: 'Bonne idée, c\'est prévu dans une prochaine version. En attendant, le nom et l\'adresse de l\'entreprise apparaissent en haut.', replied_at: at(-2, 10, 5) }),
  ];
  const error_reports = [
    c2row({ user_id: marc.id, message: 'TypeError: Cannot read properties of undefined (reading \'qty\')', stack: 'TypeError: Cannot read properties of undefined (reading \'qty\')\n    at stock.js:41:22', url: '#/stock · écran stock', user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X)', app_version: '1.1.0', resolved: false, at: at(-1, 6, 12) }),
  ];

  return { support_tickets, error_reports, support_sessions: [], platform_notes: [{ company_id: c2.id, notes: 'Rencontré au marché de Fribourg. Intéressé par le planning. Prix évoqué : 9 CHF/employé/mois.', updated_at: stamp }],
    audit_log, companies: [company, c2], profiles: [boss, lea, karim, marc, sofia, owner], punches, shifts, leaves, clients, items, movements, documents, interventions, expenses };
}
