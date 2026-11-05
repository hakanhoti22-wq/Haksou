// Module 5 — Devis et factures.
import { db, session } from '../db.js';
import { STATUS } from '../meta.js';
import { $, $$, esc, isoDate, addDays, fmtDate, money, round2, modal, toast, chip, empty, options, printHTML, printHeader, downloadCSV } from '../utils.js';
import { editClient } from './clients.js';

let tab = 'facture';
const cur = () => session.company.currency || 'CHF';

export function docTotals(d) {
  const ht = round2((d.lines || []).reduce((s, l) => s + (+l.qty || 0) * (+l.price || 0), 0));
  const tva = round2(ht * (+d.vat || 0) / 100);
  let ttc = round2(ht + tva);
  if (cur() === 'CHF') ttc = Math.round(ttc * 20) / 20; // arrondi aux 5 centimes
  return { ht, tva, ttc };
}
export const docStatus = d => d.kind === 'facture' && d.status === 'envoyee' && d.due_date && d.due_date < isoDate() ? 'retard' : d.status;
const stChip = d => chip(...(STATUS[d.kind][docStatus(d)] || [d.status]));
const label = k => k === 'devis' ? 'Devis' : 'Facture';

export async function nextNumber(kind) {
  const y = new Date().getFullYear(), pre = `${kind === 'devis' ? 'D' : 'F'}-${y}-`;
  const nums = (await db.list('documents', { eq: { kind } })).map(d => d.number?.startsWith(pre) ? +d.number.slice(pre.length) : 0);
  return pre + String(Math.max(0, ...nums) + 1).padStart(3, '0');
}

/** Crée un document et renvoie son id (utilisé aussi par Interventions). */
export async function createDoc(kind, extra = {}) {
  const c = session.company;
  return (await db.insert('documents', {
    kind, number: await nextNumber(kind), client_id: null, date: isoDate(),
    due_date: isoDate(addDays(new Date(), kind === 'devis' ? 30 : 30)), status: 'brouillon', vat: +c.vat || 0,
    lines: [], notes: kind === 'devis' ? 'Devis valable 30 jours.' : 'Merci pour votre confiance.', ...extra,
  })).id;
}

export async function render(el, ctx) {
  if (ctx.param) return editor(el, ctx, ctx.param);
  const [docs, clients] = await Promise.all([db.list('documents', { order: 'number', asc: false }), db.list('clients')]);
  const cname = id => clients.find(c => c.id === id)?.name || 'Sans client';
  const list = docs.filter(d => d.kind === tab);
  const facts = docs.filter(d => d.kind === 'facture');
  const sum = arr => arr.reduce((s, d) => s + docTotals(d).ttc, 0);
  const month = isoDate().slice(0, 7);
  const kpi = tab === 'facture' ? [
    ['À encaisser', sum(facts.filter(d => d.status === 'envoyee')), ''],
    ['Dont en retard', sum(facts.filter(d => docStatus(d) === 'retard')), 'bad'],
    ['Encaissé ce mois', sum(facts.filter(d => d.status === 'payee' && (d.paid_at || d.date).startsWith(month))), 'good'],
  ] : [
    ['En attente de réponse', sum(list.filter(d => d.status === 'envoye')), ''],
    ['Acceptés', sum(list.filter(d => d.status === 'accepte')), 'good'],
    ['Taux d\'acceptation', null, '', list.filter(d => ['accepte', 'refuse'].includes(d.status))],
  ];

  el.innerHTML = `
    <div class="toolbar">
      <div class="seg"><button data-t="devis" class="${tab === 'devis' ? 'on' : ''}">Devis</button><button data-t="facture" class="${tab === 'facture' ? 'on' : ''}">Factures</button></div>
      <span class="grow"></span><button class="sm ghost" id="csv">⬇︎ CSV</button>
      <button class="primary" id="new">＋ ${tab === 'devis' ? 'Nouveau devis' : 'Nouvelle facture'}</button>
    </div>
    <div class="tiles three">${kpi.map(([t, v, cls, dec]) => `<div class="card"><div class="mut">${t}</div><div class="num ${cls}">${v === null
      ? (dec.length ? Math.round(dec.filter(d => d.status === 'accepte').length / dec.length * 100) + ' %' : '–') : money(v, cur())}</div></div>`).join('')}</div>
    <div class="card list">${list.length ? list.map(d => `<div class="item click" data-id="${d.id}">
      <div class="grow"><b>${esc(d.number)}</b> · ${esc(cname(d.client_id))} ${stChip(d)}
      <div class="mut small">${fmtDate(d.date)}${d.due_date ? ` · ${d.kind === 'devis' ? 'valable jusqu\'au' : 'échéance'} ${fmtDate(d.due_date)}` : ''}</div></div>
      <b class="right">${money(docTotals(d).ttc, cur())}</b></div>`).join('') : empty(`Aucun ${tab === 'devis' ? 'devis' : 'facture'} pour l'instant.`)}</div>`;

  $$('[data-t]', el).forEach(b => b.onclick = () => { tab = b.dataset.t; ctx.refresh(); });
  $$('[data-id]', el).forEach(r => r.onclick = () => ctx.go('#/factures/' + r.dataset.id));
  $('#new', el).onclick = async () => ctx.go('#/factures/' + await createDoc(tab));
  $('#csv', el).onclick = () => downloadCSV(`${tab}s.csv`, [['Numéro', 'Date', 'Client', 'Statut', 'HT', 'TVA', 'TTC', 'Échéance'],
    ...list.map(d => { const t = docTotals(d); return [d.number, d.date, cname(d.client_id), STATUS[d.kind][docStatus(d)]?.[0], t.ht, t.tva, t.ttc, d.due_date || '']; })]);
}

// ── Éditeur ────────────────────────────────────────────────────
async function editor(el, ctx, id) {
  const [doc, clients, items] = await Promise.all([
    db.get('documents', id), db.list('clients', { order: 'name' }),
    session.company.modules.includes('stock') ? db.list('items', { order: 'name' }) : [],
  ]);
  if (!doc) { el.innerHTML = empty('Document introuvable.'); return; }
  const d = { ...doc, lines: [...(doc.lines || [])] };
  if (!d.lines.length) d.lines.push({ desc: '', qty: 1, price: 0 });
  let dirty = false;

  el.innerHTML = `
    <div class="toolbar">
      <a class="btn sm ghost" href="#/factures">‹ Retour</a>
      <b class="doc-no">${label(d.kind)} ${esc(d.number)}</b>
      <span class="grow"></span>
      <select id="status" class="sm">${Object.entries(STATUS[d.kind]).filter(([k]) => k !== 'retard').map(([k, [t]]) => `<option value="${k}" ${k === d.status ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <button class="sm" id="print">🖨 PDF</button>
      <button class="sm" id="mail">✉️ E-mail</button>
      ${d.kind === 'devis' ? '<button class="sm ok" id="convert">→ Facturer</button>' : ''}
      <button class="sm icon danger" id="del" title="Supprimer">🗑</button>
    </div>
    <div class="card">
      <div class="grid2">
        <label>Client<div class="row nowrap"><select id="client" class="grow">${options(clients, d.client_id, { blank: '— Choisir un client —' })}</select><button type="button" class="sm" id="newClient">＋</button></div></label>
        <label>Numéro<input id="number" value="${esc(d.number)}"></label>
        <label>Date<input type="date" id="date" value="${d.date || ''}"></label>
        <label>${d.kind === 'devis' ? 'Valable jusqu\'au' : 'Échéance de paiement'}<input type="date" id="due" value="${d.due_date || ''}"></label>
      </div>
    </div>
    <div class="card">
      <div class="scroll"><table class="tbl lines"><thead><tr><th>Désignation</th><th class="n">Qté</th><th class="n">Prix unit.</th><th class="n">Total</th><th></th></tr></thead><tbody id="lines"></tbody></table></div>
      <datalist id="itemlist">${items.map(i => `<option value="${esc(i.name)}">`).join('')}</datalist>
      <div class="row"><button class="sm" id="addLine">＋ Ligne</button>${items.length ? `<select id="addItem" class="sm"><option value="">＋ Article du stock…</option>${items.map(i => `<option value="${i.id}">${esc(i.name)} · ${money(i.price, cur())}</option>`).join('')}</select>` : ''}
        <button class="sm" id="addHour">＋ Heure de main d'œuvre</button></div>
      <div class="totals-wrap">
        <label>Notes (visibles sur le document)<textarea id="notes" rows="3">${esc(d.notes)}</textarea></label>
        <div class="totals"><div><span>Total HT</span><b id="ht"></b></div>
          <div><span>TVA <input id="vat" type="number" step="0.1" min="0" value="${d.vat}" class="xs"> %</span><b id="tva"></b></div>
          <div class="ttc"><span>Total TTC</span><b id="ttc"></b></div></div>
      </div>
    </div>
    <div class="savebar"><span class="mut small" id="saveState">Enregistré</span><button class="primary" id="save">Enregistrer</button></div>`;

  const setDirty = () => { dirty = true; $('#saveState').textContent = 'Modifications non enregistrées'; $('#saveState').classList.add('warn-t'); };
  const drawTotals = () => { const t = docTotals(d); $('#ht').textContent = money(t.ht, cur()); $('#tva').textContent = money(t.tva, cur()); $('#ttc').textContent = money(t.ttc, cur()); };
  const drawLines = () => {
    $('#lines').innerHTML = d.lines.map((l, i) => `<tr data-i="${i}">
      <td><input data-k="desc" list="itemlist" value="${esc(l.desc)}" placeholder="Description"></td>
      <td class="n"><input data-k="qty" type="number" step="any" class="xs" value="${l.qty}"></td>
      <td class="n"><input data-k="price" type="number" step="0.05" class="sm-in" value="${l.price}"></td>
      <td class="n lt">${money((+l.qty || 0) * (+l.price || 0), cur())}</td>
      <td><button class="icon sm ghost" data-rm="${i}" title="Retirer">✕</button></td></tr>`).join('');
    drawTotals();
  };
  drawLines();

  $('#lines').addEventListener('input', e => {
    const tr = e.target.closest('tr'), i = +tr.dataset.i, k = e.target.dataset.k;
    d.lines[i][k] = k === 'desc' ? e.target.value : e.target.value;
    if (k === 'desc') { const it = items.find(x => x.name === e.target.value); if (it && !+d.lines[i].price) { d.lines[i].price = it.price; $('[data-k=price]', tr).value = it.price; } }
    $('.lt', tr).textContent = money((+d.lines[i].qty || 0) * (+d.lines[i].price || 0), cur());
    drawTotals(); setDirty();
  });
  $('#lines').addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (b) { d.lines.splice(+b.dataset.rm, 1); drawLines(); setDirty(); } });
  $('#addLine').onclick = () => { d.lines.push({ desc: '', qty: 1, price: 0 }); drawLines(); setDirty(); $$('#lines [data-k=desc]').pop().focus(); };
  $('#addHour').onclick = () => { d.lines.push({ desc: 'Main d\'œuvre', qty: 1, price: +session.company.hourly_rate || 0 }); drawLines(); setDirty(); };
  $('#addItem')?.addEventListener('change', e => {
    const it = items.find(x => x.id === e.target.value); e.target.value = '';
    if (it) { d.lines.push({ desc: it.name, qty: 1, price: +it.price || 0 }); drawLines(); setDirty(); }
  });
  for (const [sel, k] of [['#client', 'client_id'], ['#number', 'number'], ['#date', 'date'], ['#due', 'due_date'], ['#notes', 'notes'], ['#vat', 'vat']])
    $(sel).addEventListener('input', e => { d[k] = k === 'vat' ? +e.target.value : e.target.value || null; if (k === 'vat') drawTotals(); setDirty(); });
  $('#newClient').onclick = () => editClient(null, c => { if (!c) return; clients.push(c); $('#client').innerHTML = options(clients, c.id, { blank: '— Choisir un client —' }); d.client_id = c.id; setDirty(); });

  const save = async (quiet) => {
    const patch = { client_id: d.client_id || null, number: d.number, date: d.date, due_date: d.due_date, notes: d.notes, vat: +d.vat || 0, status: d.status,
      lines: d.lines.filter(l => l.desc || +l.price).map(l => ({ desc: l.desc, qty: +l.qty || 0, price: +l.price || 0 })) };
    if (d.status === 'payee' && !d.paid_at) patch.paid_at = d.paid_at = isoDate();
    Object.assign(d, await db.update('documents', d.id, patch), { lines: d.lines });
    dirty = false; $('#saveState').textContent = 'Enregistré ✓'; $('#saveState').classList.remove('warn-t');
    if (!quiet) toast(`${label(d.kind)} enregistré${d.kind === 'facture' ? 'e' : ''}`);
  };
  $('#save').onclick = () => save().catch(e => toast(e.message, 'err'));
  $('#status').onchange = e => { d.status = e.target.value; save(true).then(() => toast('Statut : ' + e.target.selectedOptions[0].text)); };
  $('#del').onclick = async () => { if (!confirm(`Supprimer ${label(d.kind).toLowerCase()} ${d.number} ?`)) return; await db.remove('documents', d.id); toast('Supprimé'); ctx.go('#/factures'); };
  $('#print').onclick = async () => { if (dirty) await save(true); printHTML(printDoc(d, clients.find(c => c.id === d.client_id))); };
  $('#mail').onclick = async () => {
    if (dirty) await save(true);
    const c = clients.find(x => x.id === d.client_id), t = docTotals(d), co = session.company;
    if (!c?.email) toast('Ce client n\'a pas d\'e-mail : ajoute-le dans sa fiche.', 'err');
    const body = `Bonjour${c?.contact ? ' ' + c.contact : ''},\n\nVeuillez trouver ci-joint ${d.kind === 'devis' ? 'notre devis' : 'notre facture'} ${d.number} d'un montant de ${money(t.ttc, cur())} TTC.\n` +
      (d.kind === 'facture' ? `\nMerci de régler ce montant d'ici au ${fmtDate(d.due_date)}${co.iban ? ` sur le compte IBAN ${co.iban}` : ''}, en mentionnant la référence ${d.number}.\n` : `\nCe devis est valable jusqu'au ${fmtDate(d.due_date)}.\n`) +
      `\nMeilleures salutations\n${session.profile.name}\n${co.name}${co.phone ? '\n' + co.phone : ''}`;
    location.href = `mailto:${encodeURIComponent(c?.email || '')}?subject=${encodeURIComponent(`${label(d.kind)} ${d.number} – ${co.name}`)}&body=${encodeURIComponent(body)}`;
    if (d.status === 'brouillon') { d.status = d.kind === 'devis' ? 'envoye' : 'envoyee'; $('#status').value = d.status; await save(true); }
    toast('Pense à joindre le PDF (bouton 🖨 PDF → Enregistrer en PDF)', 'info');
  };
  $('#convert')?.addEventListener('click', async () => {
    if (dirty) await save(true);
    const fid = await createDoc('facture', { client_id: d.client_id, lines: d.lines, vat: d.vat, source_id: d.id, notes: `Selon devis ${d.number}.` });
    if (d.status !== 'accepte') await db.update('documents', d.id, { status: 'accepte' });
    toast('Facture créée à partir du devis'); ctx.go('#/factures/' + fid);
  });
  window.onbeforeunload = () => dirty ? true : undefined;
  window.addEventListener('hashchange', () => { window.onbeforeunload = null; }, { once: true });
}

function printDoc(d, c) {
  const co = session.company, t = docTotals(d);
  return `<div class="p-doc">
    ${printHeader(co, `${label(d.kind)} ${d.number}`, `<div>Date : ${fmtDate(d.date)}</div>${d.due_date ? `<div>${d.kind === 'devis' ? 'Valable jusqu\'au' : 'Échéance'} : ${fmtDate(d.due_date)}</div>` : ''}`)}
    <div class="p-client">${c ? `<b>${esc(c.name)}</b>${c.contact ? '<br>' + esc(c.contact) : ''}<br>${esc(c.address || '').replace(/\n/g, '<br>')}` : ''}</div>
    <table class="p-tbl"><thead><tr><th>Désignation</th><th class="n">Qté</th><th class="n">Prix unit.</th><th class="n">Total</th></tr></thead>
    <tbody>${d.lines.filter(l => l.desc || +l.price).map(l => `<tr><td>${esc(l.desc)}</td><td class="n">${l.qty}</td><td class="n">${money(l.price, cur())}</td><td class="n">${money(l.qty * l.price, cur())}</td></tr>`).join('')}</tbody></table>
    <table class="p-tot"><tr><td>Total HT</td><td class="n">${money(t.ht, cur())}</td></tr><tr><td>TVA ${d.vat} %</td><td class="n">${money(t.tva, cur())}</td></tr><tr class="g"><td>Total TTC</td><td class="n">${money(t.ttc, cur())}</td></tr></table>
    ${d.notes ? `<p class="p-notes">${esc(d.notes).replace(/\n/g, '<br>')}</p>` : ''}
    ${d.kind === 'facture' ? `<div class="p-pay"><b>Paiement</b> : ${money(t.ttc, cur())} d'ici au ${fmtDate(d.due_date)}${co.iban ? `<br>IBAN : ${esc(co.iban)} · ${esc(co.name)}` : ''}<br>Référence : ${esc(d.number)}</div>`
      : '<div class="p-sign"><div>Bon pour accord, date et signature :</div><div class="p-line"></div></div>'}
  </div>`;
}
