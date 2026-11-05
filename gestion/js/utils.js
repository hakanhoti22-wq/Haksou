// Petites fonctions partagées par tous les modules.

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const pad = n => String(n).padStart(2, '0');

// ── Dates ──────────────────────────────────────────────────────
export const isoDate = (d = new Date()) => { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const parseDate = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const startOfWeek = d => { const x = startOfDay(d); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return x; };
export const startOfMonth = d => new Date(new Date(d).getFullYear(), new Date(d).getMonth(), 1);
const asDate = s => (typeof s === 'string' && s.length === 10) ? parseDate(s) : new Date(s);
export const fmtDate = s => s ? asDate(s).toLocaleDateString('fr-CH') : '';
export const fmtDay = d => asDate(d).toLocaleDateString('fr-CH', { weekday: 'short', day: 'numeric', month: 'short' });
export const fmtLongDay = d => asDate(d).toLocaleDateString('fr-CH', { weekday: 'long', day: 'numeric', month: 'long' });
export const fmtMonth = d => asDate(d).toLocaleDateString('fr-CH', { month: 'long', year: 'numeric' });
export const fmtTime = s => new Date(s).toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' });
export const timeInput = s => { const d = new Date(s); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const fmtMin = m => { m = Math.round(m || 0); const s = m < 0 ? '-' : ''; m = Math.abs(m); return `${s}${Math.floor(m / 60)}h${pad(m % 60)}`; };
export const hhmmToMin = s => { const [h, m] = String(s || '0:0').split(':').map(Number); return h * 60 + (m || 0); };

/** Jours ouvrés (lun–ven) entre deux dates incluses. */
export function workdays(a, b) {
  let n = 0;
  for (let d = parseDate(a); d <= parseDate(b); d = addDays(d, 1)) if (d.getDay() % 6) n++;
  return n;
}

// ── Argent ─────────────────────────────────────────────────────
export const money = (v, cur = 'CHF') => new Intl.NumberFormat('fr-CH', { style: 'currency', currency: cur || 'CHF' }).format(+v || 0);
export const round2 = v => Math.round((+v || 0) * 100) / 100;

// ── Interface ──────────────────────────────────────────────────
export function toast(msg, kind = 'ok') {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = 'toast ' + kind; t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.classList.add('out'), 2800);
  setTimeout(() => t.remove(), 3300);
}

export const chip = (txt, kind = '') => `<span class="chip ${kind}">${esc(txt)}</span>`;
export const empty = (txt) => `<div class="empty">${esc(txt)}</div>`;

/**
 * Fenêtre modale avec formulaire.
 * onSubmit(data, form) : renvoyer false pour garder la fenêtre ouverte.
 */
export function modal({ title, body, submit = 'Enregistrer', onSubmit, onMount, footer = '' }) {
  const wrap = document.createElement('div');
  wrap.className = 'modal';
  wrap.innerHTML = `<form class="sheet" novalidate>
    <div class="sheet-h"><h3>${esc(title)}</h3><button type="button" class="icon" data-close aria-label="Fermer">✕</button></div>
    <div class="sheet-b">${body}</div>
    <div class="sheet-f">${footer}<span class="grow"></span>
      ${onSubmit ? `<button type="button" class="ghost" data-close>Annuler</button><button type="submit" class="primary">${esc(submit)}</button>` : '<button type="button" data-close>Fermer</button>'}
    </div></form>`;
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
  wrap.addEventListener('click', e => { if (e.target.closest('[data-close]')) close(); });
  const form = $('form', wrap);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!onSubmit) return;
    const missing = $$('[required]', form).find(i => !String(i.value).trim());
    if (missing) { missing.focus(); toast('Remplis les champs obligatoires', 'err'); return; }
    const data = {};
    for (const [k, v] of new FormData(form)) if (!(v instanceof File)) data[k] = typeof v === 'string' ? v.trim() : v;
    const btn = $('[type=submit]', form); btn.disabled = true;
    try { if (await onSubmit(data, form) !== false) close(); }
    catch (err) { console.error(err); toast(err.message || String(err), 'err'); }
    finally { btn.disabled = false; }
  });
  document.body.appendChild(wrap);
  onMount?.(wrap, close);
  setTimeout(() => $('input:not([type=hidden]):not([type=file]),select,textarea', wrap)?.focus({ preventScroll: true }), 50);
  return { el: wrap, close };
}

export const options = (list, sel, { value = 'id', label = 'name', blank } = {}) =>
  (blank !== undefined ? `<option value="">${esc(blank)}</option>` : '') +
  list.map(o => `<option value="${esc(o[value])}" ${String(o[value]) === String(sel ?? '') ? 'selected' : ''}>${esc(o[label])}</option>`).join('');

// ── Fichiers ───────────────────────────────────────────────────
export function download(name, content, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
/** CSV compatible Excel (séparateur ; et BOM UTF-8). */
export function downloadCSV(name, rows) {
  const cell = v => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  download(name, '﻿' + rows.map(r => r.map(cell).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
}

/** Réduit une photo avant de l'enregistrer (renvoie une data-URL JPEG). */
export function compressImage(file, max = 1280, quality = 0.72) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      res(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => rej(new Error('Image illisible'));
    img.src = URL.createObjectURL(file);
  });
}

/** Imprime (ou enregistre en PDF) un bloc HTML. */
export function printHTML(html) {
  const p = $('#print-area');
  p.innerHTML = html;
  const imgs = $$('img', p).filter(i => !i.complete);
  Promise.all(imgs.map(i => new Promise(r => { i.onload = i.onerror = r; }))).then(() => {
    // vidé seulement après l'impression : sur iPhone, print() n'est pas bloquant
    window.addEventListener('afterprint', () => { p.innerHTML = ''; }, { once: true });
    window.print();
  });
}

/** Zone de signature au doigt / à la souris. */
export function signaturePad(canvas) {
  const ctx = canvas.getContext('2d');
  let drawing = false, dirty = false, last = null;
  const fit = () => {
    const r = canvas.getBoundingClientRect(), k = window.devicePixelRatio || 1;
    canvas.width = r.width * k; canvas.height = r.height * k;
    ctx.scale(k, k); ctx.lineWidth = 2.2; ctx.lineCap = ctx.lineJoin = 'round'; ctx.strokeStyle = '#0b1220';
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, r.width, r.height);
  };
  fit();
  const pos = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', e => { drawing = true; last = pos(e); canvas.setPointerCapture(e.pointerId); e.preventDefault(); });
  canvas.addEventListener('pointermove', e => {
    if (!drawing) return;
    const p = pos(e);
    ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(...p); ctx.stroke();
    last = p; dirty = true;
  });
  const end = () => { drawing = false; };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  return { clear: () => { dirty = false; fit(); }, isEmpty: () => !dirty, toDataURL: () => canvas.toDataURL('image/png') };
}

/** Styles communs des documents imprimés. */
export const printHeader = (company, title, sub = '') => `
  <div class="p-head">
    <div><div class="p-co">${esc(company.name)}</div>
      <div class="p-small">${esc(company.address || '').replace(/\n/g, '<br>')}${company.phone ? '<br>' + esc(company.phone) : ''}${company.email ? '<br>' + esc(company.email) : ''}</div></div>
    <div class="p-title"><h1>${esc(title)}</h1>${sub}</div>
  </div>`;
