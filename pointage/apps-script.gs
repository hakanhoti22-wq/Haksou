/**
 * Pointage MIC — backend Google Apps Script (gratuit).
 * 1. Crée une Google Sheet vide → Extensions → Apps Script → colle ce fichier.
 * 2. Change TOKEN ci-dessous (un mot de passe à toi).
 * 3. Déployer → Nouveau déploiement → Type « Application Web »
 *    Exécuter en tant que : Moi · Accès : Tout le monde → Déployer → copie l'URL (…/exec).
 *    (Après une modification du code : Déployer → Gérer les déploiements → Modifier → Nouvelle version.)
 *
 * Actions (paramètre action=) :
 *   in     arrivée sur le site (ou retour d'une sortie pro)
 *   leave  sortie du site : pendant la plage horaire → « Sortie (à confirmer) » + réponse QUESTION,
 *          hors plage → Départ + réponse DETIMBRE
 *   pro    la sortie à confirmer était professionnelle → le timbrage continue
 *   out    départ (ou la sortie à confirmer n'était PAS pro → départ à l'heure de la sortie)
 *   edit   modifie un pointage (row=, at= nouvelle heure ISO, type=in|out|pro|back)
 *   add    ajoute un pointage oublié (type=, at=)
 *   config lit / enregistre la plage horaire (start=06:30&end=18:00)
 *   list   historique (JSON)          delete  supprime une ligne (row=)
 * Ajoute fmt=text pour une réponse en texte simple (utilisé par l'app Raccourcis).
 */
const TOKEN = 'change-moi-123';
const SHEET = 'Pointages';
const TZ = 'Europe/Zurich';
const LABEL = { in: 'Arrivée', out: 'Départ', leave: 'Sortie (à confirmer)', pro: 'Sortie pro', back: 'Retour' };
const CODE = {}; Object.keys(LABEL).forEach(k => CODE[LABEL[k]] = k);

function doGet(e) {
  const p = (e && e.parameter) || {};
  const reply = (o, txt) => p.fmt === 'text'
    ? ContentService.createTextOutput(txt || (o.ok ? 'OK' : 'ERREUR ' + o.error))
    : ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
  if (p.token !== TOKEN) return reply({ ok: false, error: 'Token invalide' });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = sheet_();
    const now = p.at ? new Date(p.at) : new Date();
    const hours = hours_();
    const last = last_(sh);
    const st = state_(last);
    const add = (code, src, at) => {
      const t = at || now;
      sh.appendRow([t, LABEL[code], src || p.src || 'manuel', day_(t), Utilities.formatDate(t, TZ, 'HH:mm')]);
    };
    const setLast = code => sh.getRange(last.row, 2).setValue(LABEL[code]);

    switch (p.action) {
      case 'in': {
        // Journée précédente jamais fermée → on la ferme d'abord.
        if (last && st !== 'out' && day_(last.t) !== day_(now)) {
          if (st === 'pending') setLast('out');
          else add('out', 'auto-fin-journee', endOfDay_(last.t, hours));
          add('in');
          return reply({ ok: true, state: 'in' }, 'ARRIVEE');
        }
        if (st === 'out') { add('in'); return reply({ ok: true, state: 'in' }, 'ARRIVEE'); }
        if (st === 'pending') { setLast('pro'); add('back'); return reply({ ok: true, state: 'in' }, 'RETOUR'); }
        if (last.a === 'pro') { add('back'); return reply({ ok: true, state: 'in' }, 'RETOUR'); }
        return reply({ ok: true, skipped: true, state: 'in' }, 'DEJA');
      }
      case 'leave': {
        if (st !== 'in' || last.a === 'pro') return reply({ ok: true, skipped: true, state: st }, 'OK');
        if (inHours_(now, hours)) { add('leave'); return reply({ ok: true, ask: true, state: 'pending' }, 'QUESTION'); }
        add('out');
        return reply({ ok: true, state: 'out' }, 'DETIMBRE');
      }
      case 'pro': {
        if (st !== 'pending') return reply({ ok: true, skipped: true, state: st }, 'OK');
        setLast('pro');
        return reply({ ok: true, state: 'in' }, 'PRO');
      }
      case 'out': {
        if (st === 'pending') { setLast('out'); return reply({ ok: true, state: 'out' }, 'DETIMBRE'); }
        if (st === 'in') { add('out'); return reply({ ok: true, state: 'out' }, 'DETIMBRE'); }
        return reply({ ok: true, skipped: true, state: st }, 'OK');
      }
      case 'delete': {
        const row = Number(p.row);
        if (row >= 2 && row <= sh.getLastRow()) sh.deleteRow(row);
        return reply({ ok: true });
      }
      case 'edit': {
        const row = Number(p.row);
        if (!(row >= 2 && row <= sh.getLastRow())) return reply({ ok: false, error: 'Ligne introuvable' });
        if (p.at) {
          const t = new Date(p.at);
          if (isNaN(t)) return reply({ ok: false, error: 'Heure invalide' });
          sh.getRange(row, 1).setValue(t);
          sh.getRange(row, 4, 1, 2).setValues([[day_(t), Utilities.formatDate(t, TZ, 'HH:mm')]]);
        }
        if (LABEL[p.type]) sh.getRange(row, 2).setValue(LABEL[p.type]);
        sort_(sh);
        return reply({ ok: true, edited: true });
      }
      case 'add': {
        const t = new Date(p.at);
        if (!LABEL[p.type] || isNaN(t)) return reply({ ok: false, error: 'Type ou heure invalide' });
        add(p.type, 'ajout manuel', t);
        sort_(sh);
        return reply({ ok: true, added: true });
      }
      case 'config': {
        const ok = s => /^\d\d:\d\d$/.test(s || '');
        if (ok(p.start) && ok(p.end)) PropertiesService.getScriptProperties().setProperties({ start: p.start, end: p.end });
        return reply({ ok: true, hours: hours_() });
      }
      default: { // list
        const since = Date.now() - Number(p.days || 120) * 864e5;
        const n = sh.getLastRow() - 1;
        const rows = n > 0 ? sh.getRange(2, 1, n, 3).getValues() : [];
        const events = [];
        rows.forEach((r, i) => {
          const t = new Date(r[0]);
          if (isNaN(t) || t.getTime() < since || !CODE[r[1]]) return;
          events.push({ row: i + 2, t: t.toISOString(), a: CODE[r[1]], src: r[2] });
        });
        events.sort((x, y) => x.t < y.t ? -1 : 1);
        return reply({ ok: true, events, hours });
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
    sh.appendRow(['Horodatage', 'Type', 'Source', 'Date', 'Heure']);
    sh.setFrozenRows(1);
  }
  return sh;
}
// Garde la feuille dans l'ordre chronologique (le dernier pointage = la dernière ligne).
function sort_(sh) {
  const n = sh.getLastRow() - 1;
  if (n > 1) sh.getRange(2, 1, n, 5).sort({ column: 1, ascending: true });
}
function last_(sh) {
  const n = sh.getLastRow();
  if (n < 2) return null;
  const r = sh.getRange(n, 1, 1, 2).getValues()[0];
  return { row: n, t: new Date(r[0]), a: CODE[r[1]] || 'out' };
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
function endOfDay_(t, h) {
  const end = Utilities.parseDate(day_(t) + ' ' + h.end, TZ, 'yyyy-MM-dd HH:mm');
  return end > t ? end : new Date(t.getTime() + 60000);
}
