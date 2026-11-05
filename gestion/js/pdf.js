// Génération de vrais fichiers PDF (jsPDF, inclus dans vendor/) + téléchargement ou partage.
import { session } from './db.js';
import { toast, modal, esc } from './utils.js';

let Lib = null;
async function lib() {
  if (Lib) return Lib;
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = new URL('../vendor/jspdf.umd.min.js', import.meta.url).href;
    s.onload = res; s.onerror = () => rej(new Error('Impossible de charger le générateur PDF.'));
    document.head.appendChild(s);
  });
  return (Lib = window.jspdf.jsPDF);
}

/** Les polices PDF standard ne connaissent que l'alphabet latin : on remplace le reste. */
export const T = s => String(s ?? '')
  .replace(/[    ]/g, ' ').replace(/[’‘]/g, "'").replace(/[“”«»]/g, '"')
  .replace(/→/g, '->').replace(/[^\x09\x0A\x20-\x7E\xA1-\xFF€œŒ–—•…]/g, '');

const GREY = [90, 90, 90], LINE = [190, 190, 190];
const lh = size => size * 0.3528 * 1.3; // hauteur de ligne en mm

/** Crée un document A4 avec quelques outils de mise en page. */
export async function createPDF({ landscape = false } = {}) {
  const J = await lib();
  const doc = new J({ unit: 'mm', format: 'a4', orientation: landscape ? 'landscape' : 'portrait', compress: true });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 16;
  const p = { doc, W, H, M, y: M };
  const font = (size, bold, color = [0, 0, 0]) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(...color); };
  p.ensure = h => { if (p.y + h > H - M - 6) { doc.addPage(); p.y = M; return true; } return false; };

  /** Paragraphe avec retour à la ligne automatique. */
  p.text = (str, { size = 10, bold = false, color, x = M, w = W - 2 * M, align = 'left', after = 1.5 } = {}) => {
    font(size, bold, color);
    for (const line of doc.splitTextToSize(T(str), w)) {
      p.ensure(lh(size));
      doc.text(line, align === 'right' ? x + w : x, p.y + lh(size) * 0.75, { align });
      p.y += lh(size);
    }
    p.y += after;
  };
  p.space = h => { p.y += h; };
  p.rule = (width = 0.3, color = LINE) => { doc.setDrawColor(...color); doc.setLineWidth(width); doc.line(M, p.y, W - M, p.y); };

  /** En-tête : entreprise à gauche, titre et infos à droite. */
  p.header = (title, sub = []) => {
    const c = session.company, top = p.y;
    font(15, true); doc.text(T(c.name), M, top + 6);
    font(8.5, false, GREY);
    const left = [...String(c.address || '').split('\n'), c.phone, c.email].filter(Boolean);
    left.forEach((l, i) => doc.text(T(l), M, top + 11.5 + i * 4));
    font(17, true); doc.text(T(title), W - M, top + 6.5, { align: 'right' });
    font(10); sub.filter(Boolean).forEach((l, i) => doc.text(T(l), W - M, top + 13 + i * 5, { align: 'right' }));
    p.y = top + Math.max(12 + left.length * 4, 14 + sub.length * 5) + 2;
    p.rule(0.6, [0, 0, 0]); p.y += 8;
  };

  /** Bloc adresse du client (à droite, pour les enveloppes à fenêtre). */
  p.address = lines => {
    const x = W * 0.55, start = p.y;
    lines.filter(Boolean).forEach((l, i) => { font(10.5, i === 0); doc.text(T(l), x, p.y + 4); p.y += 5; });
    p.y = Math.max(p.y, start + 24) + 6;
  };

  /**
   * Tableau. cols = [{ label, w (mm, ou '*' pour le reste), align: 'right' }], rows = [[...cellules]]
   * Une ligne peut être { cells, bold: true } pour les totaux.
   */
  p.table = (cols, rows, { size = 9.5 } = {}) => {
    const fixed = cols.reduce((s, c) => s + (c.w === '*' ? 0 : c.w), 0), flex = cols.filter(c => c.w === '*').length;
    const ws = cols.map(c => c.w === '*' ? (W - 2 * M - fixed) / flex : c.w);
    const xs = ws.map((_, i) => M + ws.slice(0, i).reduce((a, b) => a + b, 0));
    const pad = 1.6;
    const head = () => {
      font(7.8, true);
      cols.forEach((c, i) => doc.text(T(c.label).toUpperCase(), c.align === 'right' ? xs[i] + ws[i] - pad : xs[i] + pad, p.y + 4, { align: c.align || 'left' }));
      p.y += 6; p.rule(0.5, [0, 0, 0]);
    };
    p.ensure(14); head();
    for (const r of rows) {
      const cells = Array.isArray(r) ? r : r.cells, bold = !Array.isArray(r) && r.bold;
      font(size, bold);
      const split = cells.map((v, i) => doc.splitTextToSize(T(v), ws[i] - 2 * pad));
      const h = Math.max(...split.map(s => s.length)) * lh(size) + 2.6;
      if (p.ensure(h)) head();
      font(size, bold);
      split.forEach((lines, i) => lines.forEach((l, k) =>
        doc.text(l, cols[i].align === 'right' ? xs[i] + ws[i] - pad : xs[i] + pad, p.y + 1.6 + lh(size) * (k + 0.78), { align: cols[i].align || 'left' })));
      p.y += h; p.rule(0.2);
    }
    p.y += 4;
  };

  /** Lignes « libellé ... montant » alignées à droite (totaux). */
  p.totals = (rows) => {
    const x = W * 0.55;
    p.ensure(rows.length * 7 + 4);
    rows.forEach(([label, value, strong]) => {
      if (strong) { doc.setDrawColor(0); doc.setLineWidth(0.6); doc.line(x, p.y, W - M, p.y); p.y += 1; }
      font(strong ? 12 : 10, strong);
      doc.text(T(label), x + 1.5, p.y + 5); doc.text(T(value), W - M - 1.5, p.y + 5, { align: 'right' });
      p.y += strong ? 8 : 6.5;
    });
    p.y += 4;
  };

  /** Image (data-URL) contenue dans un cadre w × h. */
  p.image = (src, x, y, w, h) => {
    try {
      const fmt = src.startsWith('data:image/png') ? 'PNG' : 'JPEG';
      const { width, height } = doc.getImageProperties(src);
      const k = Math.min(w / width, h / height);
      doc.addImage(src, fmt, x, y, width * k, height * k);
      return height * k;
    } catch { return 0; }
  };
  /** Grille de photos avec légendes facultatives. */
  p.photos = (list, { perRow = 3, h = 52, captions = [] } = {}) => {
    const gap = 4, w = (W - 2 * M - gap * (perRow - 1)) / perRow;
    list.forEach((src, i) => {
      if (i % perRow === 0) { if (i) p.y += h + (captions.length ? 6 : 0) + gap; p.ensure(h + 8); }
      const x = M + (i % perRow) * (w + gap);
      p.image(src, x, p.y, w, h);
      if (captions[i]) { font(8, false, GREY); doc.text(T(captions[i]), x, p.y + h + 4); }
    });
    if (list.length) p.y += h + (captions.length ? 6 : 0) + gap;
  };

  /** Bas de page (numéros de page) puis fichier final. */
  p.finish = (filename) => {
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i); font(8, false, GREY);
      doc.text(T(session.company.name), M, H - 8);
      if (n > 1) doc.text(`Page ${i} / ${n}`, W - M, H - 8, { align: 'right' });
    }
    const name = String(filename).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.\- ]+/g, '-');
    const blob = doc.output('blob');
    return new File([blob], name, { type: 'application/pdf' });
  };
  return p;
}

/** Télécharge le PDF. */
export function downloadFile(file) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/**
 * Envoie le PDF : sur téléphone, ouvre le partage (Mail, WhatsApp…) avec le PDF en pièce jointe.
 * Sur ordinateur : télécharge le PDF et ouvre un e-mail prérempli.
 */
export async function sendFile(file, { to = '', subject = '', body = '' } = {}) {
  if (navigator.canShare?.({ files: [file] })) {
    const share = () => navigator.share({ files: [file], title: subject, text: body });
    try { await share(); return 'shared'; }
    catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
      // Safari exige un toucher « frais » : on propose un bouton de partage
      if (e.name === 'NotAllowedError') return new Promise(res => modal({
        title: 'PDF prêt',
        body: `<p>📄 <b>${esc(file.name)}</b></p><button type="button" class="primary huge" id="shareNow">📤 Partager le PDF</button>`,
        onMount: (w, close) => { w.querySelector('#shareNow').onclick = () => share().then(() => res('shared'), () => res('cancelled')).finally(close); },
      }));
    }
  }
  downloadFile(file);
  location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  toast('PDF téléchargé : glisse-le dans l\'e-mail qui vient de s\'ouvrir.', 'info');
  return 'mailto';
}
