/**
 * Pointage MIC — backend Google Apps Script (gratuit).
 * 1. Crée une Google Sheet vide → Extensions → Apps Script → colle ce fichier.
 * 2. Change TOKEN ci-dessous (un mot de passe à toi).
 * 3. Déployer → Nouveau déploiement → Type « Application Web »
 *    Exécuter en tant que : Moi · Accès : Tout le monde → Déployer → copie l'URL (…/exec).
 */
const TOKEN = 'change-moi-123';
const SHEET = 'Pointages';
const TZ = 'Europe/Zurich';

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.token !== TOKEN) return json({ ok: false, error: 'Token invalide' });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = sheet_();
    const action = p.action || 'list';

    if (action === 'in' || action === 'out') {
      const last = lastEvent_(sh);
      // Anti-doublon : iOS peut déclencher deux fois la même automatisation.
      if (last && last.a === action && p.force !== '1') {
        return json({ ok: true, skipped: true, state: action });
      }
      const at = p.at ? new Date(p.at) : new Date();
      sh.appendRow([at, action === 'in' ? 'Arrivée' : 'Départ', p.src || 'manuel',
                    Utilities.formatDate(at, TZ, 'yyyy-MM-dd'), Utilities.formatDate(at, TZ, 'HH:mm')]);
      return json({ ok: true, state: action, at: at.toISOString() });
    }

    if (action === 'delete') {
      const row = Number(p.row);
      if (row >= 2 && row <= sh.getLastRow()) sh.deleteRow(row);
      return json({ ok: true });
    }

    // list
    const days = Number(p.days || 120);
    const since = Date.now() - days * 864e5;
    const n = sh.getLastRow() - 1;
    const rows = n > 0 ? sh.getRange(2, 1, n, 3).getValues() : [];
    const events = [];
    rows.forEach((r, i) => {
      const t = new Date(r[0]);
      if (isNaN(t) || t.getTime() < since) return;
      events.push({ row: i + 2, t: t.toISOString(), a: r[1] === 'Arrivée' ? 'in' : 'out', src: r[2] });
    });
    events.sort((x, y) => x.t < y.t ? -1 : 1);
    return json({ ok: true, events });
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

function lastEvent_(sh) {
  const n = sh.getLastRow();
  if (n < 2) return null;
  const r = sh.getRange(n, 1, 1, 2).getValues()[0];
  return { t: new Date(r[0]), a: r[1] === 'Arrivée' ? 'in' : 'out' };
}

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
