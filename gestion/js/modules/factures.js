// Module 5 — Devis, factures et notes de crédit.
// Règle légale : une facture reçoit son numéro définitif quand on l'émet, puis elle est verrouillée.
// Pour la corriger, on crée une note de crédit (qui l'annule en tout ou en partie).
import { db, session, issueDocument, memberName } from '../db.js';
import { icon } from '../icons.js';
import { STATUS } from '../meta.js';
import { $, $$, esc, isoDate, addDays, fmtDate, fmtTime, money, round2, toast, chip, empty, options, downloadCSV } from '../utils.js';
import { editClient } from './clients.js';
import { createPDF, downloadFile, sendFile } from '../pdf.js';

let tab = 'facture';
const cur = () => session.company.currency || 'CHF';
const isInvoice = d => d.kind === 'facture' || d.kind === 'avoir';
const isLocked = d => isInvoice(d) && !!d.number;
const LABEL = { devis: 'Devis', facture: 'Facture', avoir: 'Note de crédit' };
const title = d => `${LABEL[d.kind]} ${d.number || '(brouillon)'}`;

export function docTotals(d) {
  const ht = round2((d.lines || []).reduce((s, l) => s + (+l.qty || 0) * (+l.price || 0), 0));
  const tva = round2(ht * (+d.vat || 0) / 100);
  let ttc = round2(ht + tva);
  if (cur() === 'CHF') ttc = Math.round(ttc * 20) / 20; // arrondi aux 5 centimes
  return { ht, tva, ttc };
}
export const docStatus = d => d.kind === 'facture' && d.status === 'envoyee' && d.due_date && d.due_date < isoDate() ? 'retard' : d.status;
const stChip = d => chip(...(STATUS[d.kind][docStatus(d)] || [d.status]));
/** Montant déjà crédité (notes de crédit émises) sur une facture. */
const credited = (docs, id) => docs.filter(a => a.kind === 'avoir' && a.source_id === id && a.number).reduce((s, a) => s + docTotals(a).ttc, 0);
/** Ce qui reste à encaisser sur une facture. */
export const outstanding = (docs, d) => ['envoyee'].includes(d.status) ? Math.max(0, round2(docTotals(d).ttc - credited(docs, d.id))) : 0;

async function nextQuoteNumber() {
  const pre = `D-${new Date().getFullYear()}-`;
  const nums = (await db.list('documents', { eq: { kind: 'devis' } })).map(d => d.number?.startsWith(pre) ? +d.number.slice(pre.length) || 0 : 0);
  return pre + String(Math.max(0, ...nums) + 1).padStart(3, '0');
}

/** Crée un document (brouillon) et renvoie son id. Utilisé aussi par Interventions. */
export async function createDoc(kind, extra = {}) {
  const c = session.company;
  return (await db.insert('documents', {
    kind, number: kind === 'devis' ? await nextQuoteNumber() : null, client_id: null, date: isoDate(),
    due_date: kind === 'avoir' ? null : isoDate(addDays(new Date(), 30)), status: 'brouillon', vat: +c.vat || 0, lines: [],
    notes: { devis: 'Devis valable 30 jours.', facture: 'Merci pour votre confiance.', avoir: '' }[kind], ...extra,
  })).id;
}

// ── Liste ──────────────────────────────────────────────────────
export async function render(el, ctx) {
  if (ctx.param) return editor(el, ctx, ctx.param);
  const [docs, clients] = await Promise.all([db.list('documents', { order: 'created_at', asc: false }), db.list('clients')]);
  const cname = id => clients.find(c => c.id === id)?.name || 'Sans client';
  const list = docs.filter(d => d.kind === tab).sort((a, b) => (!a.number) - (!b.number) || (b.number || '').localeCompare(a.number || ''));
  const facts = docs.filter(d => d.kind === 'facture');
  const month = isoDate().slice(0, 7), year = month.slice(0, 4);
  const sum = arr => arr.reduce((s, d) => s + docTotals(d).ttc, 0);
  const kpi = {
    facture: [
      ['À encaisser', facts.reduce((s, d) => s + outstanding(docs, d), 0), ''],
      ['Dont en retard', facts.filter(d => docStatus(d) === 'retard').reduce((s, d) => s + outstanding(docs, d), 0), 'bad'],
      ['Encaissé ce mois', sum(facts.filter(d => d.status === 'payee' && (d.paid_at || d.date || '').startsWith(month))), 'good'],
    ],
    devis: [
      ['En attente de réponse', sum(list.filter(d => d.status === 'envoye')), ''],
      ['Acceptés', sum(list.filter(d => d.status === 'accepte')), 'good'],
      ['Brouillons', sum(list.filter(d => d.status === 'brouillon')), ''],
    ],
    avoir: [
      ['Crédité en ' + year, sum(list.filter(d => d.number && (d.date || '').startsWith(year))), ''],
      ['Notes émises', null, '', list.filter(d => d.number).length],
      ['Brouillons', null, '', list.filter(d => !d.number).length],
    ],
  }[tab];

  el.innerHTML = `
    <div class="toolbar">
      <div class="seg">${[['devis', 'Devis'], ['facture', 'Factures'], ['avoir', 'Notes de crédit']].map(([k, t]) => `<button data-t="${k}" class="${tab === k ? 'on' : ''}">${t}</button>`).join('')}</div>
      <span class="grow"></span><button class="sm ghost" id="csv">CSV</button>
      ${tab !== 'avoir' ? `<button class="primary" id="new">${tab === 'devis' ? 'Nouveau devis' : 'Nouvelle facture'}</button>` : ''}
    </div>
    <div class="tiles three">${kpi.map(([t, v, cls, n]) => `<div class="card"><div class="mut">${t}</div><div class="num ${cls}">${v === null ? n : money(v, cur())}</div></div>`).join('')}</div>
    ${tab === 'avoir' ? '<p class="mut small">Une note de crédit se crée depuis une facture émise (bouton « Note de crédit »).</p>' : ''}
    <div class="card list">${list.length ? list.map(d => `<div class="item click" data-id="${d.id}">
      <div class="grow"><b>${esc(d.number || 'Brouillon')}</b> · ${esc(cname(d.client_id))} ${stChip(d)}
      <div class="mut small">${fmtDate(d.date)}${d.due_date && d.kind !== 'avoir' ? ` · ${d.kind === 'devis' ? 'valable jusqu\'au' : 'échéance'} ${fmtDate(d.due_date)}` : ''}${d.kind === 'facture' && credited(docs, d.id) ? ` · crédité ${money(credited(docs, d.id), cur())}` : ''}</div></div>
      <b class="right">${money(docTotals(d).ttc, cur())}</b></div>`).join('') : empty(`Aucun document pour l'instant.`)}</div>`;

  $$('[data-t]', el).forEach(b => b.onclick = () => { tab = b.dataset.t; ctx.refresh(); });
  $$('[data-id]', el).forEach(r => r.onclick = () => ctx.go('#/factures/' + r.dataset.id));
  $('#new', el)?.addEventListener('click', async () => ctx.go('#/factures/' + await createDoc(tab)));
  $('#csv', el).onclick = () => downloadCSV(`${tab}s.csv`, [['Numéro', 'Date', 'Client', 'Statut', 'HT', 'TVA', 'TTC', 'Échéance'],
    ...list.map(d => { const t = docTotals(d); return [d.number || 'brouillon', d.date, cname(d.client_id), STATUS[d.kind][docStatus(d)]?.[0], t.ht, t.tva, t.ttc, d.due_date || '']; })]);
}

// ── Éditeur ────────────────────────────────────────────────────
async function editor(el, ctx, id) {
  const [doc, clients, items, docs, log] = await Promise.all([
    db.get('documents', id), db.list('clients', { order: 'name' }),
    session.company.modules.includes('stock') ? db.list('items', { order: 'name' }) : [],
    db.list('documents'), db.list('audit_log', { eq: { row_id: id }, order: 'at', asc: false }),
  ]);
  if (!doc) { el.innerHTML = empty('Document introuvable.'); return; }
  const d = { ...doc, lines: [...(doc.lines || [])] };
  const locked = isLocked(d), ro = locked ? 'disabled' : '';
  const src = d.source_id ? docs.find(x => x.id === d.source_id) : null;
  const credits = docs.filter(x => x.kind === 'avoir' && x.source_id === d.id);
  if (!d.lines.length && !locked) d.lines.push({ desc: '', qty: 1, price: 0 });
  let dirty = false;
  const statuses = Object.entries(STATUS[d.kind]).filter(([k]) => k !== 'retard' && (d.kind === 'devis' || (k !== 'brouillon' && k !== 'annulee') || k === d.status));

  el.innerHTML = `
    <div class="toolbar">
      <a class="btn sm ghost" href="#/factures">‹ Retour</a>
      <b class="doc-no">${esc(title(d))}</b> ${stChip(d)}
      <span class="grow"></span>
      ${(d.kind === 'devis' || (locked && d.kind === 'facture' && d.status !== 'annulee')) ? `<select id="status" class="sm">${statuses.map(([k, [t]]) => `<option value="${k}" ${k === d.status ? 'selected' : ''}>${t}</option>`).join('')}</select>` : ''}
      <button class="sm" id="pdf">PDF</button>
      ${d.kind === 'devis' || locked ? '<button class="sm" id="send">Envoyer</button>' : ''}
      ${d.kind === 'devis' ? '<button class="sm ok" id="convert">→ Facturer</button>' : ''}
      ${locked && d.kind === 'facture' && d.status !== 'annulee' ? '<button class="sm" id="credit">Note de crédit</button>' : ''}
      ${d.kind !== 'avoir' ? '<button class="sm ghost" id="dup" title="Créer une copie modifiable">Dupliquer</button>' : ''}
      ${!locked ? `<button class="sm icon danger" id="del" title="Supprimer">${icon('trash', 16)}</button>` : ''}
    </div>
    ${locked ? `<div class="card notice"><b>${LABEL[d.kind]} émise : elle ne peut plus être modifiée ni supprimée</b> (obligation de conservation 10 ans).
      ${d.kind === 'facture' ? 'Pour corriger une erreur, crée une <b>note de crédit</b> puis, si besoin, une nouvelle facture avec « Dupliquer ».' : ''}</div>`
      : isInvoice(d) ? `<div class="card notice info"><b>Brouillon</b> : modifiable librement. Le numéro définitif sera attribué quand tu cliqueras sur <b>Émettre</b>.</div>` : ''}
    ${src ? `<div class="card notice">Note de crédit sur la <a href="#/factures/${src.id}">facture ${esc(src.number)}</a> (${money(docTotals(src).ttc, cur())}).</div>` : ''}
    ${credits.length ? `<div class="card notice">Notes de crédit : ${credits.map(a => `<a href="#/factures/${a.id}">${esc(a.number || 'brouillon')}</a> (${money(docTotals(a).ttc, cur())})`).join(', ')}</div>` : ''}
    <div class="card">
      <div class="grid2">
        <label>Client<div class="row nowrap"><select id="client" class="grow" ${ro || (src ? 'disabled' : '')}>${options(clients, d.client_id, { blank: '— Choisir un client —' })}</select>${locked || src ? '' : '<button type="button" class="sm" id="newClient">+</button>'}</div></label>
        <label>Numéro<input value="${esc(d.number || (isInvoice(d) ? 'attribué à l\'émission' : ''))}" id="number" ${isInvoice(d) ? 'disabled' : ''}></label>
        <label>Date<input type="date" id="date" value="${d.date || ''}" ${ro}></label>
        ${d.kind !== 'avoir' ? `<label>${d.kind === 'devis' ? 'Valable jusqu\'au' : 'Échéance de paiement'}<input type="date" id="due" value="${d.due_date || ''}" ${ro}></label>` : ''}
      </div>
    </div>
    <div class="card">
      <div class="scroll"><table class="tbl lines"><thead><tr><th>Désignation</th><th class="n">Qté</th><th class="n">Prix unit.</th><th class="n">Total</th>${locked ? '' : '<th></th>'}</tr></thead><tbody id="lines"></tbody></table></div>
      ${locked ? '' : `<datalist id="itemlist">${items.map(i => `<option value="${esc(i.name)}">`).join('')}</datalist>
      <div class="row"><button class="sm" id="addLine">Ajouter une ligne</button>${items.length ? `<select id="addItem" class="sm"><option value="">Article du stock…</option>${items.map(i => `<option value="${i.id}">${esc(i.name)} · ${money(i.price, cur())}</option>`).join('')}</select>` : ''}
        <button class="sm" id="addHour">Heure de main d'œuvre</button></div>`}
      <div class="totals-wrap">
        <label>Notes (visibles sur le document)<textarea id="notes" rows="3" ${ro}>${esc(d.notes)}</textarea></label>
        <div class="totals"><div><span>Total HT</span><b id="ht"></b></div>
          <div><span>TVA <input id="vat" type="number" step="0.1" min="0" value="${d.vat}" class="xs" ${ro}> %</span><b id="tva"></b></div>
          <div class="ttc"><span>${d.kind === 'avoir' ? 'Montant crédité' : 'Total TTC'}</span><b id="ttc"></b></div></div>
      </div>
    </div>
    ${log.length ? `<h2>Historique</h2><div class="card list compact">${log.map(l => `<div class="item small"><span class="mut">${fmtDate(l.at)} ${fmtTime(l.at)}</span><span class="grow">${esc(logText(l, d))}</span><span class="mut">${esc(memberName(l.actor_id))}</span></div>`).join('')}</div>` : ''}
    ${locked ? '' : `<div class="savebar"><span class="mut small" id="saveState">Enregistré</span><button id="save">Enregistrer</button>${isInvoice(d) ? `<button class="primary" id="issue">Émettre ${d.kind === 'avoir' ? 'la note de crédit' : 'la facture'}</button>` : ''}</div>`}`;

  const setDirty = () => { dirty = true; $('#saveState').textContent = 'Modifications non enregistrées'; $('#saveState').classList.add('warn-t'); };
  const drawTotals = () => { const t = docTotals(d); $('#ht').textContent = money(t.ht, cur()); $('#tva').textContent = money(t.tva, cur()); $('#ttc').textContent = money(t.ttc, cur()); };
  const drawLines = () => {
    $('#lines').innerHTML = locked
      ? d.lines.map(l => `<tr><td>${esc(l.desc)}</td><td class="n">${l.qty}</td><td class="n">${money(l.price, cur())}</td><td class="n">${money(l.qty * l.price, cur())}</td></tr>`).join('')
      : d.lines.map((l, i) => `<tr data-i="${i}">
      <td><input data-k="desc" list="itemlist" value="${esc(l.desc)}" placeholder="Description"></td>
      <td class="n"><input data-k="qty" type="number" step="any" class="xs" value="${l.qty}"></td>
      <td class="n"><input data-k="price" type="number" step="0.05" class="sm-in" value="${l.price}"></td>
      <td class="n lt">${money((+l.qty || 0) * (+l.price || 0), cur())}</td>
      <td><button class="icon sm ghost" data-rm="${i}" title="Retirer">${icon('x', 15)}</button></td></tr>`).join('');
    drawTotals();
  };
  drawLines();

  const save = async (quiet) => {
    const patch = { client_id: d.client_id || null, date: d.date, due_date: d.due_date || null, notes: d.notes, vat: +d.vat || 0, status: d.status,
      lines: d.lines.filter(l => l.desc || +l.price).map(l => ({ desc: l.desc, qty: +l.qty || 0, price: +l.price || 0 })) };
    if (d.kind === 'devis') patch.number = d.number;
    Object.assign(d, await db.update('documents', d.id, patch), { lines: d.lines });
    dirty = false;
    if ($('#saveState')) { $('#saveState').textContent = 'Enregistré'; $('#saveState').classList.remove('warn-t'); }
    if (!quiet) toast('Enregistré');
  };
  const client = () => clients.find(c => c.id === d.client_id);

  if (!locked) {
    $('#lines').addEventListener('input', e => {
      const tr = e.target.closest('tr'), i = +tr.dataset.i, k = e.target.dataset.k;
      d.lines[i][k] = e.target.value;
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
      $(sel)?.addEventListener('input', e => { d[k] = k === 'vat' ? +e.target.value : e.target.value || null; if (k === 'vat') drawTotals(); setDirty(); });
    $('#newClient')?.addEventListener('click', () => editClient(null, c => { if (!c) return; clients.push(c); $('#client').innerHTML = options(clients, c.id, { blank: '— Choisir un client —' }); d.client_id = c.id; setDirty(); }));
    $('#save').onclick = () => save().catch(e => toast(e.message, 'err'));
    $('#del').onclick = async () => { if (!confirm(`Supprimer ce ${d.kind === 'devis' ? 'devis' : 'brouillon'} ?`)) return; await db.remove('documents', d.id); toast('Supprimé'); ctx.go('#/factures'); };
    $('#issue')?.addEventListener('click', async () => {
      try {
        await save(true);
        if (!d.client_id) throw new Error('Choisis un client avant d\'émettre.');
        if (!d.lines.some(l => l.desc || +l.price)) throw new Error('Ajoute au moins une ligne.');
        if (!confirm(`Émettre ${d.kind === 'avoir' ? 'cette note de crédit' : 'cette facture'} de ${money(docTotals(d).ttc, cur())} ?\n\nElle recevra son numéro définitif et ne pourra plus être modifiée.`)) return;
        const num = await issueDocument(d.id);
        toast(`${LABEL[d.kind]} ${num} émise`); ctx.refresh();
      } catch (e) { toast(e.message, 'err'); }
    });
  }

  $('#status')?.addEventListener('change', async e => {
    const status = e.target.value, patch = { status };
    if (status === 'payee' && !d.paid_at) patch.paid_at = isoDate();
    try {
      if (d.kind === 'devis') { d.status = status; await save(true); } else await db.update('documents', d.id, patch);
      toast('Statut : ' + e.target.selectedOptions[0].text); ctx.refresh();
    } catch (err) { toast(err.message, 'err'); ctx.refresh(); }
  });
  const makeFile = async () => { if (dirty) await save(true); return pdfDocument(d, client(), src); };
  $('#pdf').onclick = async () => { try { downloadFile(await makeFile()); } catch (e) { toast(e.message, 'err'); } };
  $('#send')?.addEventListener('click', async () => {
    try {
      const file = await makeFile(), c = client(), t = docTotals(d), co = session.company;
      const body = `Bonjour${c?.contact ? ' ' + c.contact : ''},\n\nVeuillez trouver ci-joint ${{ devis: 'notre devis', facture: 'notre facture', avoir: 'notre note de crédit' }[d.kind]} ${d.number} d'un montant de ${money(t.ttc, cur())}.\n` +
        (d.kind === 'facture' ? `\nMerci de régler ce montant d'ici au ${fmtDate(d.due_date)}${co.iban ? ` sur le compte IBAN ${co.iban}` : ''}, en mentionnant la référence ${d.number}.\n` : d.kind === 'devis' ? `\nCe devis est valable jusqu'au ${fmtDate(d.due_date)}.\n` : '') +
        `\nMeilleures salutations\n${session.profile.name}\n${co.name}${co.phone ? '\n' + co.phone : ''}`;
      if (!c?.email) toast('Ce client n\'a pas d\'e-mail dans sa fiche.', 'info');
      const how = await sendFile(file, { to: c?.email, subject: `${title(d)} – ${co.name}`, body });
      if (how !== 'cancelled' && d.kind === 'devis' && d.status === 'brouillon') { d.status = 'envoye'; await save(true); ctx.refresh(); }
    } catch (e) { toast(e.message, 'err'); }
  });
  $('#convert')?.addEventListener('click', async () => {
    if (dirty) await save(true);
    const fid = await createDoc('facture', { client_id: d.client_id, lines: d.lines, vat: d.vat, source_id: d.id, notes: `Selon devis ${d.number}.` });
    if (d.status !== 'accepte') await db.update('documents', d.id, { status: 'accepte' });
    toast('Facture (brouillon) créée à partir du devis'); ctx.go('#/factures/' + fid);
  });
  $('#credit')?.addEventListener('click', async () => {
    const left = round2(docTotals(d).ttc - credited(docs, d.id));
    if (!confirm(`Créer une note de crédit sur la facture ${d.number} ?\n\nElle reprend toutes les lignes (annulation totale${left < docTotals(d).ttc ? ', moins ce qui est déjà crédité à ajuster' : ''}). Tu peux les modifier avant d'émettre pour un crédit partiel.`)) return;
    const aid = await createDoc('avoir', { client_id: d.client_id, source_id: d.id, lines: d.lines.map(l => ({ ...l })), vat: d.vat, notes: `Note de crédit sur la facture ${d.number} du ${fmtDate(d.date)}.` });
    tab = 'avoir'; toast('Note de crédit (brouillon) créée'); ctx.go('#/factures/' + aid);
  });
  $('#dup')?.addEventListener('click', async () => {
    const nid = await createDoc(d.kind, { client_id: d.client_id, lines: d.lines.map(l => ({ ...l })), vat: d.vat, notes: d.notes });
    toast('Copie créée (brouillon)'); ctx.go('#/factures/' + nid);
  });
  window.onbeforeunload = () => dirty ? true : undefined;
  window.addEventListener('hashchange', () => { window.onbeforeunload = null; }, { once: true });
}

function logText(l, d) {
  const st = k => STATUS[d.kind][k]?.[0] || k;
  return { creation: 'Création du brouillon', emission: `Émission : n° ${l.details?.number}`, statut: `Statut : ${st(l.details?.avant)} → ${st(l.details?.apres)}`, suppression: 'Suppression' }[l.action] || l.action;
}

/** PDF du devis, de la facture ou de la note de crédit. */
async function pdfDocument(d, c, src) {
  const p = await createPDF(), co = session.company, t = docTotals(d);
  const lines = d.lines.filter(l => l.desc || +l.price);
  p.header(title(d).replace('(brouillon)', '– BROUILLON'), [
    `Date : ${fmtDate(d.date)}`,
    d.kind === 'devis' && d.due_date ? `Valable jusqu'au : ${fmtDate(d.due_date)}` : '',
    d.kind === 'facture' && d.due_date ? `Échéance : ${fmtDate(d.due_date)}` : '',
    src && d.kind === 'avoir' ? `Facture d'origine : ${src.number}` : '',
  ]);
  if (isInvoice(d) && !d.number) { p.doc.setTextColor(225); p.doc.setFontSize(70); p.doc.text('BROUILLON', p.W / 2, p.H / 2 + 20, { align: 'center', angle: 35 }); }
  p.address([c?.name, c?.contact, ...String(c?.address || '').split('\n')]);
  p.table([{ label: 'Désignation', w: '*' }, { label: 'Qté', w: 18, align: 'right' }, { label: 'Prix unit.', w: 30, align: 'right' }, { label: 'Total', w: 32, align: 'right' }],
    lines.map(l => [l.desc, String(l.qty), money(l.price, cur()), money(l.qty * l.price, cur())]));
  p.totals([['Total HT', money(t.ht, cur())], [`TVA ${d.vat} %`, money(t.tva, cur())], [d.kind === 'avoir' ? 'Montant crédité' : 'Total TTC', money(t.ttc, cur()), true]]);
  if (d.notes) p.text(d.notes, { after: 5 });
  if (d.kind === 'facture') {
    p.ensure(22); p.text('Paiement', { bold: true, after: 0.5 });
    p.text(`${money(t.ttc, cur())} d'ici au ${fmtDate(d.due_date)}`, { after: 0.5 });
    if (co.iban) p.text(`IBAN : ${co.iban} · ${co.name}`, { after: 0.5 });
    p.text(`Référence : ${d.number || '(attribuée à l\'émission)'}`);
  } else if (d.kind === 'avoir') {
    p.text('Ce montant sera remboursé ou déduit de votre prochaine facture.');
  } else {
    p.ensure(32); p.space(8); p.text('Bon pour accord, date et signature :');
    p.space(16); p.doc.setDrawColor(0); p.doc.setLineWidth(0.3); p.doc.line(p.M, p.y, p.M + 75, p.y);
  }
  return p.finish(`${title(d).replace(' (brouillon)', '-brouillon')}.pdf`);
}
