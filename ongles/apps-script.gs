/**
 * Studio Ongles — backend Google Apps Script (gratuit).
 *
 * 1. Crée une Google Sheet vide → Extensions → Apps Script → colle ce fichier.
 * 2. Change TOKEN ci-dessous (un mot de passe à toi : lettres et chiffres).
 * 3. Menu du haut : choisis la fonction « installer » → ▶ Exécuter → autorise l'accès.
 *    (Crée les onglets, le rappel automatique de 18h, et autorise e-mails + Agenda.)
 * 4. Déployer → Nouveau déploiement → type « Application Web »
 *    Exécuter en tant que : Moi · Accès : Tout le monde → Déployer → copie l'URL (…/exec).
 *    Après une modification du code : Déployer → Gérer les déploiements → ✏️ → Nouvelle version.
 *
 * Actions publiques (page de réservation) : public, book, lookup, cancel
 * Actions protégées par TOKEN (espace pro) : ping, all, saveConfig, saveServices, saveTaches,
 *   saveClientes, saveRdv, deleteRdv
 */
const TOKEN = 'change-moi-123';
const TZ = 'Europe/Zurich';
const MAIL_PRO = '';     // e-mail qui reçoit les nouvelles réservations (vide = ton compte Google)
const AGENDA = true;     // true = chaque RDV apparaît dans ton Google Agenda
const RAPPEL_HEURE = 18; // heure d'envoi des e-mails de rappel pour le lendemain

const RDV = 'Rendez-vous', DATA = 'Données';
const COLS = ['id', 'code', 'date', 'debut', 'fin', 'services', 'prestations', 'duree', 'prix', 'nom', 'tel', 'email', 'note', 'statut', 'source', 'cree', 'notes', 'paye', 'modePaiement', 'debutReel', 'finReel', 'eventId'];
const HEAD = ['ID', 'Code', 'Date', 'Début', 'Fin', 'IDs prestations', 'Prestations', 'Durée (min)', 'Prix', 'Cliente', 'Téléphone', 'E-mail', 'Message cliente', 'Statut', 'Source', 'Créé le', 'Notes', 'Payé', 'Paiement', 'Début réel', 'Fin réel', 'Agenda'];
const STATUTS = { attente: 'En attente', confirme: 'Confirmé', encours: 'En cours', termine: 'Terminé', absente: 'Absente', annule: 'Annulé' };
const STATUT_CODE = {}; Object.keys(STATUTS).forEach(k => STATUT_CODE[STATUTS[k]] = k);
const EDITABLE = ['date', 'debut', 'duree', 'prix', 'services', 'prestations', 'nom', 'tel', 'email', 'note', 'statut', 'notes', 'paye', 'modePaiement', 'debutReel', 'finReel'];

const DEFAULT_CONFIG = {
  nom: 'Mon Studio Ongles', slogan: 'Gel, semi-permanent & nail art 💅', adresse: '', telephone: '', instagram: '', devise: 'CHF', indicatif: '41',
  message: "Merci de venir avec des ongles propres, sans vernis. Au-delà de 15 min de retard, le rendez-vous peut être annulé.",
  horaires: { 0: [], 1: [], 2: [['09:00', '12:00'], ['13:30', '18:30']], 3: [['09:00', '12:00'], ['13:30', '18:30']], 4: [['09:00', '12:00'], ['13:30', '18:30']], 5: [['09:00', '12:00'], ['13:30', '18:30']], 6: [['09:00', '15:00']] },
  fermetures: [], pas: 15, tampon: 10, delaiMin: 12, joursMax: 45, validation: 'auto', annulationH: 24
};
const DEFAULT_SERVICES = [
  { id: 's1', nom: 'Semi-permanent mains', categorie: 'Mains', duree: 45, prix: 40, description: 'Vernis semi-permanent, tient 2 à 3 semaines.', actif: true },
  { id: 's2', nom: 'Gel sur ongles naturels', categorie: 'Mains', duree: 75, prix: 60, description: 'Renforcement en gel, finition couleur ou naturelle.', actif: true },
  { id: 's3', nom: 'Pose capsules + gel', categorie: 'Mains', duree: 120, prix: 80, description: 'Rallongement avec capsules, forme au choix.', actif: true },
  { id: 's4', nom: 'Remplissage gel', categorie: 'Mains', duree: 90, prix: 55, description: 'Toutes les 3 à 4 semaines.', actif: true },
  { id: 's5', nom: 'Manucure classique', categorie: 'Mains', duree: 30, prix: 30, description: 'Limage, cuticules, soin, sans vernis.', actif: true },
  { id: 's6', nom: 'Semi-permanent pieds', categorie: 'Pieds', duree: 45, prix: 45, description: '', actif: true },
  { id: 's7', nom: 'Dépose', categorie: 'Options', duree: 20, prix: 15, description: 'Retrait du gel ou du semi-permanent.', actif: true },
  { id: 's8', nom: 'Nail art (2 ongles)', categorie: 'Options', duree: 15, prix: 10, description: 'Déco, strass, french, baby boomer…', actif: true }
];

/* ---------- Entrées ---------- */
function doGet(e) { return out(handle((e && e.parameter) || {})); }
function doPost(e) { let p = {}; try { p = JSON.parse(e.postData.contents); } catch (err) { } return out(handle(p)); }
function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function handle(p) {
  try {
    const a = p.action;
    if (a === 'public') return pub();
    if (a === 'book') return withLock(() => book(p));
    if (a === 'lookup') return lookup(p.code);
    if (a === 'cancel') return withLock(() => cancelByCode(p.code));
    if (String(p.token || '') !== TOKEN) return { ok: false, error: 'Mot de passe incorrect.' };
    switch (a) {
      case 'ping': return { ok: true };
      case 'all': return { ok: true, config: getConfig(), services: getServices(), taches: getData('taches', []), clientes: getData('clientes', {}), rdv: readRdv().map(clean) };
      case 'saveConfig': setData('config', p.config || {}); return { ok: true };
      case 'saveServices': setData('services', p.services || []); return { ok: true };
      case 'saveTaches': setData('taches', p.taches || []); return { ok: true };
      case 'saveClientes': setData('clientes', p.clientes || {}); return { ok: true };
      case 'saveRdv': return withLock(() => saveRdv(p.rdv || {}));
      case 'deleteRdv': return withLock(() => deleteRdv(p.id));
    }
    return { ok: false, error: 'Action inconnue : ' + a };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}
function withLock(fn) { const l = LockService.getScriptLock(); l.waitLock(20000); try { return fn(); } finally { l.releaseLock(); } }

/* ---------- Feuilles ---------- */
function book_() { return SpreadsheetApp.getActive(); }
function sheetRdv() {
  let sh = book_().getSheetByName(RDV);
  if (!sh) {
    sh = book_().insertSheet(RDV, 0);
    sh.getRange('A:Z').setNumberFormat('@');
    sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]).setFontWeight('bold').setBackground('#f9e4e8');
    sh.setFrozenRows(1);
  }
  return sh;
}
function sheetData() {
  let sh = book_().getSheetByName(DATA);
  if (!sh) {
    sh = book_().insertSheet(DATA);
    sh.getRange('A:B').setNumberFormat('@');
    sh.getRange(1, 1, 1, 2).setValues([['Clé', 'Valeur (ne pas modifier à la main)']]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}
function getData(k, def) {
  const v = sheetData().getDataRange().getValues();
  for (let i = 1; i < v.length; i++) if (v[i][0] === k) { try { return JSON.parse(v[i][1]); } catch (e) { } }
  return def;
}
function setData(k, val) {
  const sh = sheetData(), v = sh.getDataRange().getValues(), s = JSON.stringify(val);
  if (s.length > 49000) throw new Error('Trop de données pour « ' + k + ' » : supprime quelques éléments anciens.');
  for (let i = 1; i < v.length; i++) if (v[i][0] === k) { sh.getRange(i + 1, 2).setValue(s); return; }
  sh.getRange(sh.getLastRow() + 1, 1, 1, 2).setValues([[k, s]]);
}
function getConfig() {
  const c = Object.assign({}, DEFAULT_CONFIG, getData('config', {}));
  c.horaires = Object.assign({}, DEFAULT_CONFIG.horaires, c.horaires || {});
  return c;
}
function getServices() { return getData('services', DEFAULT_SERVICES); }

const txt = v => { v = v == null ? '' : String(v); return /^[=+\-@]/.test(v) ? "'" + v : v; };
function readRdv() {
  const sh = sheetRdv(), n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, COLS.length).getValues().map((row, i) => {
    const o = { _row: i + 2 };
    COLS.forEach((c, j) => {
      let x = row[j];
      if (x instanceof Date) x = Utilities.formatDate(x, TZ, c === 'date' ? 'yyyy-MM-dd' : c === 'cree' ? "yyyy-MM-dd'T'HH:mm:ss" : 'HH:mm');
      o[c] = x == null ? '' : String(x);
    });
    o.duree = Number(o.duree) || 0; o.prix = Number(o.prix) || 0;
    o.paye = o.paye === 'oui';
    o.statut = STATUT_CODE[o.statut] || o.statut || 'confirme';
    o.services = o.services ? o.services.split(',') : [];
    return o;
  }).filter(o => o.id);
}
function writeRdv(o) {
  const sh = sheetRdv(), row = o._row || sh.getLastRow() + 1;
  sh.getRange(row, 1, 1, COLS.length).setValues([COLS.map(c => {
    let v = o[c];
    if (c === 'services') v = (Array.isArray(v) ? v : String(v || '').split(',')).filter(Boolean).join(',');
    if (c === 'paye') v = o.paye === true || o.paye === 'true' ? 'oui' : 'non';
    if (c === 'statut') v = STATUTS[v] || v;
    return txt(v);
  })]);
  o._row = row;
}
function clean(o) { const c = Object.assign({}, o); delete c._row; delete c.eventId; return c; }
function pubRdv(r) { return { code: r.code, date: r.date, debut: r.debut, fin: r.fin, prestations: r.prestations, prix: r.prix, nom: r.nom, statut: r.statut }; }

/* ---------- Temps & créneaux (même calcul que common.js) ---------- */
const pad = n => String(n).padStart(2, '0');
const toMin = s => { const a = String(s || '0:0').split(':').map(Number); return a[0] * 60 + (a[1] || 0); };
const toHM = m => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
const utc = s => { const a = String(s).split('-').map(Number); return Date.UTC(a[0], a[1] - 1, a[2]); };
const diffDays = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);
const dow = s => new Date(utc(s)).getUTCDay();
const addDays = (s, n) => Utilities.formatDate(new Date(utc(s) + n * 864e5), 'UTC', 'yyyy-MM-dd');
function now_() { const d = new Date(); return { today: Utilities.formatDate(d, TZ, 'yyyy-MM-dd'), nowMin: Number(Utilities.formatDate(d, TZ, 'H')) * 60 + Number(Utilities.formatDate(d, TZ, 'm')) }; }
const isClosed = (cfg, date) => (cfg.fermetures || []).some(f => f.du && date >= f.du && date <= (f.au || f.du));
function slots(cfg, busy, date, duree, today, nowMin) {
  const dd = diffDays(today, date);
  if (dd < 0 || dd > (Number(cfg.joursMax) || 60) || isClosed(cfg, date) || !duree) return [];
  const plages = (cfg.horaires || {})[dow(date)] || [];
  const step = Number(cfg.pas) || 15, tampon = Number(cfg.tampon) || 0, limite = nowMin + (Number(cfg.delaiMin) || 0) * 60;
  const b = busy.filter(x => x.date === date).map(x => [toMin(x.debut), toMin(x.fin)]);
  const res = [];
  plages.forEach(p => {
    const S = toMin(p[0]), E = toMin(p[1]);
    for (let t = S; t + duree <= E; t += step) {
      if (dd * 1440 + t < limite) continue;
      if (b.some(x => t < x[1] + tampon && x[0] < t + duree + tampon)) continue;
      res.push(toHM(t));
    }
  });
  return res;
}
const busyOf = (all, from) => all.filter(r => r.statut !== 'annule' && r.date >= from).map(r => ({ date: r.date, debut: r.debut, fin: r.fin }));
const fmtDate = s => { const J = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'], M = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']; const a = s.split('-').map(Number); return J[dow(s)] + ' ' + a[2] + ' ' + M[a[1] - 1]; };
const prix = (p, cfg) => (Number(p) || 0) + ' ' + (cfg.devise || 'CHF');
const cut = (s, n) => String(s == null ? '' : s).trim().slice(0, n);

/* ---------- Public ---------- */
function pub() {
  const n = now_();
  return { ok: true, config: getConfig(), services: getServices().filter(s => s.actif !== false), busy: busyOf(readRdv(), addDays(n.today, -1)), today: n.today, nowMin: n.nowMin };
}

function book(p) {
  const cfg = getConfig(), services = getServices(), n = now_();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date || '') || !/^\d{2}:\d{2}$/.test(p.debut || '')) return { ok: false, error: 'Date ou heure invalide.' };
  const ch = (p.services || []).map(id => services.find(s => s.id === id && s.actif !== false)).filter(Boolean);
  if (!ch.length) return { ok: false, error: 'Choisis au moins une prestation.' };
  const nom = cut(p.nom, 80), tel = cut(p.tel, 30), email = cut(p.email, 120);
  if (!nom || tel.replace(/\D/g, '').length < 8) return { ok: false, error: 'Nom et téléphone obligatoires.' };
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'Adresse e-mail invalide.' };
  const all = readRdv(), digits = tel.replace(/\D/g, '').slice(-9);
  if (all.filter(r => r.statut !== 'annule' && r.date >= n.today && String(r.tel).replace(/\D/g, '').slice(-9) === digits).length >= 3)
    return { ok: false, error: 'Tu as déjà 3 rendez-vous à venir. Contacte-moi directement pour en ajouter.' };
  const duree = ch.reduce((a, s) => a + Number(s.duree), 0);
  if (slots(cfg, busyOf(all, n.today), p.date, duree, n.today, n.nowMin).indexOf(p.debut) < 0)
    return { ok: false, error: "Ce créneau vient d'être pris, choisis-en un autre." };
  const codes = all.map(r => r.code);
  let code; do { code = newCode(); } while (codes.indexOf(code) >= 0);
  const r = {
    id: Utilities.getUuid(), code, date: p.date, debut: p.debut, fin: toHM(toMin(p.debut) + duree), services: ch.map(s => s.id),
    prestations: ch.map(s => s.nom).join(' + '), duree, prix: ch.reduce((a, s) => a + Number(s.prix), 0), nom, tel, email,
    note: cut(p.note, 500), statut: cfg.validation === 'manuelle' ? 'attente' : 'confirme', source: 'en ligne',
    cree: Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss"), notes: '', paye: false, modePaiement: '', debutReel: '', finReel: '', eventId: ''
  };
  if (/^https:\/\/[^\s]{5,300}$/.test(p.page || '') && getData('page', '') !== p.page) setData('page', p.page);
  syncCal(r);
  writeRdv(r);
  mailClient(r, cfg, r.statut);
  mailPro('💅 Nouveau RDV' + (r.statut === 'attente' ? ' à valider' : '') + ' : ' + r.nom + ', ' + fmtDate(r.date) + ' à ' + r.debut,
    r.nom + ' (' + r.tel + (r.email ? ', ' + r.email : '') + ')\n' + fmtDate(r.date) + ', ' + r.debut + ' – ' + r.fin + '\n' + r.prestations + ' · ' + prix(r.prix, cfg) + (r.note ? '\n\nMessage : ' + r.note : '') + (r.statut === 'attente' ? "\n\n→ Ouvre l'app pour accepter ou refuser." : ''));
  return { ok: true, rdv: pubRdv(r) };
}
function newCode() { const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 6; i++) s += c[Math.floor(Math.random() * c.length)]; return s; }

function canCancel(cfg, r) {
  const n = now_();
  return r.statut !== 'annule' && r.statut !== 'termine' && diffDays(n.today, r.date) * 1440 + toMin(r.debut) - n.nowMin >= (Number(cfg.annulationH) || 0) * 60;
}
function lookup(code) {
  const r = readRdv().find(x => x.code === String(code || '').toUpperCase().trim());
  if (!r) return { ok: false, error: 'Rendez-vous introuvable.' };
  const cfg = getConfig();
  return { ok: true, rdv: pubRdv(r), canCancel: canCancel(cfg, r), config: cfg };
}
function cancelByCode(code) {
  const r = readRdv().find(x => x.code === String(code || '').toUpperCase().trim());
  if (!r) return { ok: false, error: 'Rendez-vous introuvable.' };
  const cfg = getConfig();
  if (!canCancel(cfg, r)) return { ok: false, error: 'Il est trop tard pour annuler en ligne : contacte-moi directement.' };
  r.statut = 'annule'; syncCal(r); writeRdv(r);
  mailClient(r, cfg, 'annule');
  mailPro('❌ RDV annulé par ' + r.nom + ' : ' + fmtDate(r.date) + ' à ' + r.debut, r.nom + ' (' + r.tel + ') a annulé en ligne :\n' + r.prestations + '\n\nLe créneau est de nouveau libre.');
  return { ok: true, rdv: pubRdv(r) };
}

/* ---------- Espace pro ---------- */
function saveRdv(r) {
  const cfg = getConfig(), all = readRdv(), old = r.id ? all.find(x => x.id === r.id) : null;
  const n = Object.assign({}, old || { id: Utilities.getUuid(), code: newCode(), source: 'manuel', cree: Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss"), eventId: '' });
  EDITABLE.forEach(k => { if (r[k] !== undefined) n[k] = r[k]; });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(n.date || '') || !/^\d{2}:\d{2}$/.test(n.debut || '')) return { ok: false, error: 'Date ou heure invalide.' };
  n.duree = Number(n.duree) || 0; n.prix = Number(n.prix) || 0; n.paye = n.paye === true || n.paye === 'true';
  n.fin = toHM(toMin(n.debut) + n.duree);
  const key = x => [x.date, x.debut, x.fin, x.statut, x.nom, x.prestations, x.tel, x.note].join('|');
  if (!old || key(old) !== key(n)) syncCal(n);
  writeRdv(n);
  if (old && old.statut === 'attente' && n.statut === 'confirme') mailClient(n, cfg, 'confirme');
  if (old && old.statut === 'attente' && n.statut === 'annule') mailClient(n, cfg, 'refus');
  return { ok: true, rdv: clean(n) };
}
function deleteRdv(id) {
  const r = readRdv().find(x => x.id === id);
  if (!r) return { ok: true };
  r.statut = 'annule'; syncCal(r);
  sheetRdv().deleteRow(r._row);
  return { ok: true };
}

/* ---------- Google Agenda ---------- */
function syncCal(r) {
  if (!AGENDA) return;
  try {
    const cal = CalendarApp.getDefaultCalendar();
    let ev = r.eventId ? cal.getEventById(r.eventId) : null;
    if (r.statut === 'annule' || r.statut === 'absente') { if (ev) ev.deleteEvent(); r.eventId = ''; return; }
    const s = Utilities.parseDate(r.date + ' ' + r.debut, TZ, 'yyyy-MM-dd HH:mm'), e = Utilities.parseDate(r.date + ' ' + r.fin, TZ, 'yyyy-MM-dd HH:mm');
    const title = '💅 ' + r.nom + ' – ' + r.prestations + (r.statut === 'attente' ? ' (à valider)' : '');
    const desc = 'Tél : ' + r.tel + (r.note ? '\nMessage : ' + r.note : '') + '\nPrix : ' + r.prix;
    if (ev) { ev.setTime(s, e); ev.setTitle(title); ev.setDescription(desc); }
    else { ev = cal.createEvent(title, s, e, { description: desc }); r.eventId = ev.getId(); }
  } catch (err) { console.warn('Agenda : ' + err); }
}

/* ---------- E-mails ---------- */
function ownerMail() { return MAIL_PRO || Session.getEffectiveUser().getEmail(); }
function mailPro(subject, body) { try { MailApp.sendEmail({ to: ownerMail(), subject, body }); } catch (e) { console.warn(e); } }
function mailClient(r, cfg, kind) {
  if (!r.email || !/@/.test(r.email)) return;
  const prenom = String(r.nom).split(/\s+/)[0], page = getData('page', '');
  const quand = fmtDate(r.date) + ' à ' + r.debut;
  const recap = '📅 ' + quand + ' (jusqu\'à ' + r.fin + ')\n💅 ' + r.prestations + '\n💰 ' + prix(r.prix, cfg) + (cfg.adresse ? '\n📍 ' + cfg.adresse : '');
  const lien = page ? '\n\nPour annuler : ' + page + '?code=' + r.code : '\n\nCode de réservation : ' + r.code;
  const T = {
    confirme: ['Ton rendez-vous est confirmé ✅', 'Bonjour ' + prenom + ',\n\nTon rendez-vous est confirmé :\n\n' + recap + (cfg.message ? '\n\nℹ️ ' + cfg.message : '') + lien],
    attente: ['Demande de rendez-vous reçue ⏳', 'Bonjour ' + prenom + ',\n\nMerci ! J\'ai bien reçu ta demande, je te la confirme très vite :\n\n' + recap + lien],
    refus: ['Ta demande de rendez-vous', 'Bonjour ' + prenom + ',\n\nDésolée, je ne suis pas disponible le ' + quand + '. N\'hésite pas à choisir un autre créneau' + (page ? ' : ' + page : '.') ],
    annule: ['Rendez-vous annulé', 'Bonjour ' + prenom + ',\n\nTon rendez-vous du ' + quand + ' est bien annulé.' + (page ? '\n\nPour en reprendre un : ' + page : '')],
    rappel: ['Rappel : ton rendez-vous demain à ' + r.debut + ' 💅', 'Coucou ' + prenom + ' !\n\nPetit rappel pour demain :\n\n' + recap + (cfg.message ? '\n\nℹ️ ' + cfg.message : '') + lien]
  }[kind];
  if (!T) return;
  try { MailApp.sendEmail({ to: r.email, subject: T[0] + ' · ' + cfg.nom, body: T[1] + '\n\nÀ bientôt,\n' + cfg.nom + (cfg.telephone ? '\n' + cfg.telephone : ''), name: cfg.nom, replyTo: ownerMail() }); }
  catch (e) { console.warn(e); }
}

/** Envoyé chaque jour vers RAPPEL_HEURE : rappel par e-mail pour les RDV du lendemain. */
function rappels() {
  const cfg = getConfig(), dem = addDays(now_().today, 1);
  readRdv().filter(r => r.date === dem && r.statut === 'confirme' && r.email).forEach(r => mailClient(r, cfg, 'rappel'));
}

/** À exécuter une fois : crée les onglets, le rappel quotidien, et demande les autorisations. */
function installer() {
  sheetRdv(); sheetData();
  if (!getData('config', null)) setData('config', DEFAULT_CONFIG);
  if (!getData('services', null)) setData('services', DEFAULT_SERVICES);
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'rappels').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('rappels').timeBased().everyDays(1).atHour(RAPPEL_HEURE).inTimezone(TZ).create();
  if (AGENDA) CalendarApp.getDefaultCalendar();
  console.log('Installation OK. E-mails envoyés à : ' + ownerMail() + ' · quota e-mails restant aujourd\'hui : ' + MailApp.getRemainingDailyQuota());
}
