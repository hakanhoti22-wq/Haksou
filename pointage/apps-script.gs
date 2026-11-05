/**
 * Pointage MIC — backend Google Apps Script (gratuit).
 * 1. Crée une Google Sheet vide → Extensions → Apps Script → colle ce fichier.
 * 2. Change TOKEN ci-dessous (un mot de passe à toi : lettres et chiffres).
 * 3. Déployer → Nouveau déploiement → Type « Application Web »
 *    Exécuter en tant que : Moi · Accès : Tout le monde → Déployer → copie l'URL (…/exec).
 *    (Après une modification du code : Déployer → Gérer les déploiements → ✏️ → Nouvelle version.)
 *
 * Actions (paramètre action=) :
 *   in       arrivée sur le site (ou retour d'une sortie pro)
 *   leave    sortie du site : pendant la plage horaire → « Sortie (à confirmer) » + réponse QUESTION,
 *            hors plage → Départ + réponse DETIMBRE
 *   pro      la sortie à confirmer était professionnelle → le timbrage continue
 *   out      départ (ou la sortie à confirmer n'était PAS pro → départ à l'heure de la sortie)
 *   edit     modifie une ligne (row=, at=, type=, hours= pour une absence)
 *   add      ajoute un pointage oublié (type=in|out|pro|back, at=)
 *   absence  ajoute des jours d'absence (type=conge|maladie|ferie|formation, from=, to=, hours=, skipWe=1)
 *   delete   supprime des lignes (row= ou rows=2,5,9)
 *   config   lit / enregistre la plage horaire (start=06:30&end=18:00)
 *   summary  reconstruit l'onglet « Résumé »
 *   toggle   bouton « Timbrer » : arrivée si tu n'es pas timbré, départ sinon
 *   today    bilan du jour et de la semaine (goal= objectif hebdo en heures)
 *   mail     envoie le relevé PDF du mois en cours maintenant (test)
 * Ajoute say=1 pour une phrase lisible (widget, Siri).
 *
 * Relevé mensuel par mail : exécute UNE FOIS la fonction « installerMail » (menu en haut → ▶ Exécuter)
 * et autorise l'accès. Le relevé du mois précédent part ensuite le 1er de chaque mois vers 7h.
 *   list     historique (JSON)
 * Ajoute fmt=text pour une réponse en texte simple (utilisé par l'app Raccourcis).
 */
const TOKEN = 'change-moi-123';
const SHEET = 'Pointages';
const SUMMARY = 'Résumé';
const TZ = 'Europe/Zurich';
const LABEL = { in: 'Arrivée', out: 'Départ', leave: 'Sortie (à confirmer)', pro: 'Sortie pro', back: 'Retour' };
const ABS = { conge: 'Congé', maladie: 'Maladie', ferie: 'Férié', formation: 'Formation' };
const CODE = {}; Object.keys(LABEL).forEach(k => CODE[LABEL[k]] = k);
const ACODE = {}; Object.keys(ABS).forEach(k => ACODE[ABS[k]] = k);
const COLS = 6; // Horodatage · Type · Source · Date · Heure · Durée absence (h)

function doGet(e) {
  const p = (e && e.parameter) || {};
  let sayFn = null; // phrase lisible (say=1), calculée au moment de répondre
  const reply = (o, txt) => {
    if (p.say === '1') return ContentService.createTextOutput(o.ok ? (sayFn ? sayFn(txt) : txt || 'OK') : 'Erreur : ' + o.error);
    return p.fmt === 'text'
      ? ContentService.createTextOutput(txt || (o.ok ? 'OK' : 'ERREUR ' + o.error))
      : ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
  };
  if (p.token !== TOKEN) return reply({ ok: false, error: 'Token invalide' });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = sheet_();
    const now = p.at ? new Date(p.at) : new Date();
    const hours = hours_();
    const last = last_(sh, now);
    const st = state_(last);
    const add = (code, src, at) => {
      const t = at || now;
      sh.appendRow([t, LABEL[code], src || p.src || 'manuel', day_(t), Utilities.formatDate(t, TZ, 'HH:mm'), '']);
    };
    const setLast = code => sh.getRange(last.row, 2).setValue(LABEL[code]);
    const done = (o, txt) => { summary_(sh); return reply(o, txt); }; // après chaque écriture : Résumé à jour

    let action = p.action;
    if (action === 'toggle') action = st === 'in' && last.a !== 'pro' && day_(last.t) === day_(now) ? 'out' : 'in';
    if (p.say === '1') sayFn = code => {
      const t = hm_(now), tot = () => fmtH_(todayMs_(sh));
      return ({
        ARRIVEE: `Arrivée timbrée à ${t} ✅`, RETOUR: `Retour timbré à ${t} ✅`,
        DEJA: `Tu es déjà timbré depuis ${last ? hm_(last.t) : t}`,
        DETIMBRE: `Départ timbré à ${t} ✅ Aujourd’hui : ${tot()}`,
        QUESTION: `Sortie notée à ${t}. Trajet pro ? Réponds dans l’app Pointage.`,
        PRO: 'Trajet pro noté, le timbrage continue', OK: action === 'out' ? 'Tu n’étais pas timbré' : 'OK'
      })[code] || code || 'OK';
    };

    switch (action) {
      case 'in': {
        // Journée précédente jamais fermée → on la ferme d'abord.
        if (last && st !== 'out' && day_(last.t) !== day_(now)) {
          if (st === 'pending') setLast('out');
          else add('out', 'auto-fin-journee', endOfDay_(last.t, hours));
          add('in');
          return done({ ok: true, state: 'in' }, 'ARRIVEE');
        }
        if (st === 'out') { add('in'); return done({ ok: true, state: 'in' }, 'ARRIVEE'); }
        if (st === 'pending') { setLast('pro'); add('back'); return done({ ok: true, state: 'in' }, 'RETOUR'); }
        if (last.a === 'pro') { add('back'); return done({ ok: true, state: 'in' }, 'RETOUR'); }
        return reply({ ok: true, skipped: true, state: 'in' }, 'DEJA');
      }
      case 'leave': {
        if (st !== 'in' || last.a === 'pro') return reply({ ok: true, skipped: true, state: st }, 'OK');
        if (inHours_(now, hours)) { add('leave'); return done({ ok: true, ask: true, state: 'pending' }, 'QUESTION'); }
        add('out');
        return done({ ok: true, state: 'out' }, 'DETIMBRE');
      }
      case 'pro': {
        if (st !== 'pending') return reply({ ok: true, skipped: true, state: st }, 'OK');
        setLast('pro');
        return done({ ok: true, state: 'in' }, 'PRO');
      }
      case 'out': {
        if (st === 'pending') { setLast('out'); return done({ ok: true, state: 'out' }, 'DETIMBRE'); }
        if (st === 'in') { add('out'); return done({ ok: true, state: 'out' }, 'DETIMBRE'); }
        return reply({ ok: true, skipped: true, state: st }, 'OK');
      }
      case 'delete': { // row=5 ou rows=5,8,9 (suppression groupée)
        const max = sh.getLastRow();
        const list = String(p.rows || p.row || '').split(',').map(Number).filter(r => r >= 2 && r <= max);
        const uniq = list.filter((r, i) => list.indexOf(r) === i).sort((a, b) => b - a); // du bas vers le haut
        uniq.forEach(r => sh.deleteRow(r));
        return done({ ok: true, deleted: uniq.length });
      }
      case 'edit': {
        const row = Number(p.row);
        if (!(row >= 2 && row <= sh.getLastRow())) return reply({ ok: false, error: 'Ligne introuvable' });
        const isAbs = !!ACODE[sh.getRange(row, 2).getValue()];
        if (p.at) {
          const t = new Date(p.at);
          if (isNaN(t)) return reply({ ok: false, error: 'Heure invalide' });
          sh.getRange(row, 1).setValue(t);
          sh.getRange(row, 4, 1, 2).setValues([[day_(t), isAbs ? '' : Utilities.formatDate(t, TZ, 'HH:mm')]]);
        }
        if (isAbs) {
          if (ABS[p.type]) sh.getRange(row, 2).setValue(ABS[p.type]);
          if (Number(p.hours) > 0) sh.getRange(row, 6).setValue(Number(p.hours));
        } else if (LABEL[p.type]) sh.getRange(row, 2).setValue(LABEL[p.type]);
        sort_(sh);
        return done({ ok: true, edited: true });
      }
      case 'add': {
        const t = new Date(p.at);
        if (!LABEL[p.type] || isNaN(t)) return reply({ ok: false, error: 'Type ou heure invalide' });
        add(p.type, 'ajout manuel', t);
        sort_(sh);
        return done({ ok: true, added: 1 });
      }
      case 'absence': {
        const kind = ABS[p.type], h = Number(p.hours), re = /^\d{4}-\d\d-\d\d$/;
        const from = p.from, to = p.to || p.from;
        if (!kind || !(h > 0 && h <= 24)) return reply({ ok: false, error: 'Type ou durée invalide' });
        if (!re.test(from) || !re.test(to) || to < from) return reply({ ok: false, error: 'Dates invalides' });
        let d = new Date(from + 'T12:00:00Z'), n = 0;
        const end = new Date(to + 'T12:00:00Z');
        for (let i = 0; d <= end && i < 93; i++, d = new Date(d.getTime() + 864e5)) {
          const wd = d.getUTCDay(), key = d.toISOString().slice(0, 10);
          if (p.skipWe === '1' && (wd === 0 || wd === 6)) continue;
          sh.appendRow([Utilities.parseDate(key + ' 12:00', TZ, 'yyyy-MM-dd HH:mm'), kind, 'absence', key, '', h]);
          n++;
        }
        sort_(sh);
        return done({ ok: true, added: n });
      }
      case 'config': {
        const ok = s => /^\d\d:\d\d$/.test(s || ''), pr = PropertiesService.getScriptProperties();
        if (ok(p.start) && ok(p.end)) pr.setProperties({ start: p.start, end: p.end });
        const m = {};
        ['mailTo', 'mailCc', 'name', 'mailOn'].forEach(k => { if (p[k] !== undefined) m[k] = String(p[k]).trim(); });
        if (Object.keys(m).length) pr.setProperties(m);
        return reply({ ok: true, hours: hours_(), mail: mailCfg_() });
      }
      case 'today': {
        const days = computeDays_(sh), t = day_(new Date()), mon = monday_(t), goal = Number(p.goal) || 0;
        let w = 0;
        Object.keys(days).forEach(k => { if (k >= mon && k <= t) w += days[k].work + days[k].abs; });
        const d = days[t], todayMs = d ? d.work + d.abs : 0;
        let txt = st === 'in' ? `Tu es au travail depuis ${hm_(firstToday_(days, t) || last.t)}. ` : st === 'pending' ? 'Sortie à confirmer dans l’app. ' : 'Tu n’es pas timbré. ';
        txt += `Aujourd’hui : ${fmtH_(todayMs)}. Cette semaine : ${fmtH_(w)}`;
        if (goal) txt += w >= goal * 36e5 ? `, objectif de ${goal} h atteint (+${fmtH_(w - goal * 36e5)}).` : ` sur ${goal} h, il reste ${fmtH_(goal * 36e5 - w)}.`;
        else txt += '.';
        return p.say === '1' || p.fmt === 'text' ? ContentService.createTextOutput(txt) : reply({ ok: true, text: txt, today: todayMs, week: w });
      }
      case 'mail': {
        try {
          const r = sendReport_(Utilities.formatDate(new Date(), TZ, 'yyyy-MM'));
          return reply({ ok: true, sent: true, to: r.to, cc: r.cc });
        } catch (err) {
          return reply({ ok: false, error: /autoris|permission|authoriz/i.test(String(err)) ? 'Autorisation manquante : dans Apps Script, exécute une fois la fonction « installerMail »' : 'Envoi impossible : ' + err });
        }
      }
      case 'summary': return done({ ok: true, summary: true });
      default: { // list
        const since = Date.now() - Number(p.days || 120) * 864e5;
        const n = sh.getLastRow() - 1;
        const rows = n > 0 ? sh.getRange(2, 1, n, COLS).getValues() : [];
        const events = [];
        rows.forEach((r, i) => {
          const t = new Date(r[0]);
          if (isNaN(t) || t.getTime() < since) return;
          if (CODE[r[1]]) events.push({ row: i + 2, t: t.toISOString(), a: CODE[r[1]], src: r[2] });
          else if (ACODE[r[1]]) events.push({ row: i + 2, t: t.toISOString(), a: 'abs', kind: ACODE[r[1]], hours: Number(r[5]) || 0, src: 'absence' });
        });
        events.sort((x, y) => x.t < y.t ? -1 : 1);
        return reply({ ok: true, events, hours, v: 3 });
      }
    }
  } finally {
    lock.releaseLock();
  }
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET);
  if (!sh) {
    sh = ss.insertSheet(SHEET);
    sh.appendRow(['Horodatage', 'Type', 'Source', 'Date', 'Heure', 'Durée absence (h)']);
    sh.setFrozenRows(1);
  } else if (!sh.getRange(1, 6).getValue()) sh.getRange(1, 6).setValue('Durée absence (h)');
  return sh;
}
// Garde la feuille dans l'ordre chronologique.
function sort_(sh) {
  const n = sh.getLastRow() - 1;
  if (n > 1) sh.getRange(2, 1, n, COLS).sort({ column: 1, ascending: true });
}
// Dernier pointage réel (on ignore les absences et ce qui est dans le futur).
function last_(sh, now) {
  const n = sh.getLastRow();
  if (n < 2) return null;
  const k = Math.min(n - 1, 80), first = n - k + 1, vals = sh.getRange(first, 1, k, 2).getValues();
  const lim = Math.max(Date.now(), now.getTime()) + 120000;
  for (let i = k - 1; i >= 0; i--) {
    const t = new Date(vals[i][0]), a = CODE[vals[i][1]];
    if (a && !isNaN(t) && t.getTime() <= lim) return { row: first + i, t, a };
  }
  return null;
}
// out = pas au travail · in = au travail (y c. sortie pro) · pending = sortie à confirmer
function state_(last) {
  if (!last || last.a === 'out') return 'out';
  return last.a === 'leave' ? 'pending' : 'in';
}
function hours_() {
  const pr = PropertiesService.getScriptProperties();
  return { start: pr.getProperty('start') || '06:30', end: pr.getProperty('end') || '18:00' };
}
function inHours_(t, h) {
  const hm = Utilities.formatDate(t, TZ, 'HH:mm');
  return hm >= h.start && hm < h.end;
}
function day_(t) { return Utilities.formatDate(t, TZ, 'yyyy-MM-dd'); }
function hm_(t) { return Utilities.formatDate(t, TZ, 'HH:mm'); }
function endOfDay_(t, h) {
  const end = Utilities.parseDate(day_(t) + ' ' + h.end, TZ, 'yyyy-MM-dd HH:mm');
  return end > t ? end : new Date(t.getTime() + 60000);
}

/* ---------- onglet « Résumé » : un tableau lisible, mis à jour automatiquement ---------- */
// Par jour : première arrivée, dernier départ, temps de travail (ms), absences (ms), remarques.
function computeDays_(sh) {
    const n = sh.getLastRow() - 1;
    const rows = n > 0 ? sh.getRange(2, 1, n, COLS).getValues() : [];
    const today = day_(new Date());
    const days = {}, get = k => days[k] = days[k] || { first: null, last: null, work: 0, abs: 0, notes: [] };
    let open = null, pro = null;
    rows.forEach(r => {
      const t = new Date(r[0]);
      if (isNaN(t)) return;
      const k = day_(t);
      if (ACODE[r[1]]) { const d = get(k); d.abs += (Number(r[5]) || 0) * 36e5; d.notes.push(r[1]); return; }
      const a = CODE[r[1]];
      if (!a) return;
      const d = get(k);
      if ((a === 'in' || a === 'back') && !open) { open = t; if (!d.first) d.first = t; }
      if (a === 'pro' || a === 'leave') pro = t;
      if (a === 'back' && pro) { d.notes.push('Sortie pro ' + hm_(pro) + '–' + hm_(t)); pro = null; }
      if (a === 'out' || (a === 'leave' && k !== today)) { // sortie jamais confirmée d'un jour passé = départ
        if (open) { get(day_(open)).work += t - open; open = null; }
        d.last = t; pro = null;
      }
    });
    if (open && day_(open) === today) get(today).work += Date.now() - open;
    return days;
}
const MOIS_ = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const hmD_ = ms => { const m = Math.round(ms / 6e4); return Math.floor(m / 60) + ':' + ('0' + m % 60).slice(-2); };
function fmtH_(ms) { const m = Math.max(0, Math.round(ms / 6e4)); return Math.floor(m / 60) + ' h ' + ('0' + m % 60).slice(-2); }
function isoWeek_(key) { const d = new Date(key + 'T12:00:00Z'), wd = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - wd + 3); const y = new Date(Date.UTC(d.getUTCFullYear(), 0, 4)); return 1 + Math.round((d - y) / 6048e5); }
function monday_(key) { const d = new Date(key + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7); return d.toISOString().slice(0, 10); }
function todayMs_(sh) { const d = computeDays_(sh)[day_(new Date())]; return d ? d.work + d.abs : 0; }
function firstToday_(days, t) { return days[t] && days[t].first; }

function summary_(sh) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const rs = ss.getSheetByName(SUMMARY) || ss.insertSheet(SUMMARY);
    const days = computeDays_(sh);
    const MOIS = MOIS_, JOURS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'], hmD = hmD_, isoWeek = isoWeek_;
    const dec = ms => Math.round(ms / 36e3) / 100;

    const out = [['Date', 'Jour', 'Arrivée', 'Départ', 'Remarques', 'Travail', 'Absence', 'Total', 'Total (h)']];
    const weekRows = [], monthRows = [];
    let wk = null, wT = [0, 0], mo = null, mT = [0, 0];
    const flushW = () => { if (wk !== null) { out.push(['', 'Semaine ' + wk, '', '', '', hmD(wT[0]), hmD(wT[1]), hmD(wT[0] + wT[1]), dec(wT[0] + wT[1])]); weekRows.push(out.length); } wT = [0, 0]; };
    const flushM = () => { if (mo !== null) { const [y, m] = mo.split('-').map(Number); out.push(['', 'Total ' + MOIS[m - 1] + ' ' + y, '', '', '', hmD(mT[0]), hmD(mT[1]), hmD(mT[0] + mT[1]), dec(mT[0] + mT[1])]); monthRows.push(out.length); out.push(['', '', '', '', '', '', '', '', '']); } mT = [0, 0]; };
    Object.keys(days).sort().forEach(k => {
      const d = days[k], w = isoWeek(k), m = k.slice(0, 7);
      if (m !== mo) { flushW(); flushM(); mo = m; wk = w; }
      else if (w !== wk) { flushW(); wk = w; }
      const [y, mm, dd] = k.split('-');
      out.push([dd + '.' + mm + '.' + y, JOURS[new Date(k + 'T12:00:00Z').getUTCDay()], d.first ? hm_(d.first) : '', d.last ? hm_(d.last) : '',
        d.notes.join(' · '), hmD(d.work), d.abs ? hmD(d.abs) : '', hmD(d.work + d.abs), dec(d.work + d.abs)]);
      wT[0] += d.work; wT[1] += d.abs; mT[0] += d.work; mT[1] += d.abs;
    });
    flushW(); flushM();

    rs.clear();
    rs.getRange(1, 1, out.length, 8).setNumberFormat('@'); // texte : « 8:24 » reste lisible
    rs.getRange(1, 1, out.length, 9).setValues(out);
    rs.getRange(1, 1, 1, 9).setFontWeight('bold').setBackground('#1e293b').setFontColor('#ffffff');
    weekRows.forEach(r => rs.getRange(r, 1, 1, 9).setFontWeight('bold').setBackground('#f1f5f9'));
    monthRows.forEach(r => rs.getRange(r, 1, 1, 9).setFontWeight('bold').setBackground('#dbeafe'));
    rs.setFrozenRows(1);
  } catch (err) { console.error('Résumé : ' + err); } // le pointage n'est jamais bloqué par le résumé
}

/* ---------- relevé mensuel PDF par mail ---------- */
function mailCfg_() {
  const pr = PropertiesService.getScriptProperties();
  let me = '';
  try { me = Session.getEffectiveUser().getEmail(); } catch (e) {}
  return { mailTo: pr.getProperty('mailTo') || '', mailCc: pr.getProperty('mailCc') || '', name: pr.getProperty('name') || '', mailOn: pr.getProperty('mailOn') !== '0', me };
}
// Déclencheur : le 1er du mois, relevé du mois précédent.
function monthlyReport() {
  if (!mailCfg_().mailOn) return;
  const now = new Date(), prev = new Date(now.getFullYear(), now.getMonth() - 1, 15);
  sendReport_(Utilities.formatDate(prev, TZ, 'yyyy-MM'));
}
// À exécuter UNE FOIS depuis l'éditeur Apps Script (▶ Exécuter) pour autoriser les mails et programmer l'envoi.
function installerMail() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'monthlyReport').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('monthlyReport').timeBased().onMonthDay(1).atHour(7).inTimezone(TZ).create();
  console.log('✅ Relevé mensuel programmé : le 1er de chaque mois vers 7h, vers ' + (mailCfg_().mailTo || mailCfg_().me));
}
function sendReport_(month) {
  const c = mailCfg_(), to = c.mailTo || c.me;
  if (!to) throw new Error('aucune adresse e-mail');
  const rep = reportHtml_(month, c.name, computeDays_(sheet_()));
  const [y, m] = month.split('-').map(Number), title = MOIS_[m - 1] + ' ' + y;
  const pdf = Utilities.newBlob(rep.html, 'text/html', 'releve.html').getAs('application/pdf').setName('Releve-heures-' + month + (c.name ? '-' + c.name.replace(/\s+/g, '-') : '') + '.pdf');
  MailApp.sendEmail({
    to, cc: c.mailCc || '', name: 'Pointage MIC',
    subject: 'Relevé d’heures – ' + title + (c.name ? ' – ' + c.name : ''),
    htmlBody: 'Bonjour,<br><br>Voici le relevé d’heures de <b>' + title + '</b>' + (c.name ? ' de ' + c.name : '') + ' : <b>' + fmtH_(rep.total) + '</b> sur ' + rep.days + ' jour(s).<br><br>Le détail est dans le PDF joint.<br><br><i>Envoyé automatiquement par l’app Pointage MIC.</i>',
    attachments: [pdf]
  });
  return { to, cc: c.mailCc || '', total: rep.total };
}
function reportHtml_(month, name, days) {
  const esc = t => String(t).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const JOURS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
  const [y, m] = month.split('-').map(Number);
  let rows = '', total = 0, wk = 0, wkNo = null, n = 0;
  const flushW = () => { if (wkNo !== null) rows += '<tr class="wk"><td colspan="4">Total semaine ' + wkNo + '</td><td class="n">' + fmtH_(wk) + '</td></tr>'; wk = 0; };
  Object.keys(days).filter(k => k.slice(0, 7) === month).sort().forEach(k => {
    const d = days[k], w = isoWeek_(k), tot = d.work + d.abs;
    if (w !== wkNo) { flushW(); wkNo = w; }
    const [, mm, dd] = k.split('-');
    rows += '<tr><td>' + JOURS[new Date(k + 'T12:00:00Z').getUTCDay()] + ' ' + dd + '.' + mm + '.</td><td class="n">' + (d.first ? hm_(d.first) : '–') + '</td><td class="n">' + (d.last ? hm_(d.last) : '–') +
      '</td><td>' + esc(d.notes.join(' · ')) + '</td><td class="n">' + fmtH_(tot) + '</td></tr>';
    total += tot; wk += tot; n++;
  });
  flushW();
  const html = '<html><head><meta charset="utf-8"><style>' +
    'body{font-family:Helvetica,Arial,sans-serif;font-size:10.5pt;color:#000;margin:0}h1{font-size:17pt;margin:0 0 4px}.sub{color:#444;margin-bottom:16px}' +
    'table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #bbb;padding:5px 4px;text-align:left;vertical-align:top}' +
    'th{border-bottom:2px solid #000;font-size:9pt;text-transform:uppercase}.n{text-align:right}tr.wk td{background:#f1f1f1;font-weight:bold}' +
    'tfoot td{border-top:2px solid #000;border-bottom:0;font-weight:bold;font-size:12pt}.sign{margin-top:50px;color:#444}' +
    '</style></head><body><h1>Relevé d’heures — ' + MOIS_[m - 1] + ' ' + y + '</h1>' +
    '<div class="sub">' + (name ? esc(name) + ' · ' : '') + 'Marly Innovation Center · généré le ' + Utilities.formatDate(new Date(), TZ, 'dd.MM.yyyy') + '</div>' +
    '<table><thead><tr><th>Jour</th><th class="n">Arrivée</th><th class="n">Départ</th><th>Remarques</th><th class="n">Total</th></tr></thead><tbody>' +
    (rows || '<tr><td colspan="5">Aucun pointage ce mois-ci.</td></tr>') + '</tbody><tfoot><tr><td colspan="4">Total du mois · ' + n + ' jour(s)</td><td class="n">' + fmtH_(total) + '</td></tr></tfoot></table>' +
    '<table class="sign"><tr><td style="border:0">Signature collaborateur : ____________________</td><td style="border:0;text-align:right">Visa : ____________________</td></tr></table></body></html>';
  return { html, total, days: n };
}
