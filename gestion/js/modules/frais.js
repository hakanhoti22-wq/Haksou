// Module 7 — Notes de frais.
import { db, session, memberName } from '../db.js';
import { STATUS } from '../meta.js';
import { $, $$, esc, isoDate, fmtDate, fmtMonth, money, modal, toast, chip, empty, compressImage, downloadCSV, printHTML, printHeader, startOfMonth } from '../utils.js';

const CATS = ['Repas', 'Transport', 'Carburant', 'Parking', 'Hébergement', 'Matériel', 'Téléphone', 'Autre'];
const cur = () => session.company.currency || 'CHF';
const st = s => chip(...(STATUS.expense[s] || [s]));
let month = isoDate(startOfMonth(new Date())).slice(0, 7);

export async function render(el, ctx) {
  const all = await db.list('expenses', { order: 'date', asc: false });
  const me = session.profile;
  const pending = all.filter(e => e.status === 'en_attente');
  const toPay = all.filter(e => e.status === 'validee');
  const inMonth = all.filter(e => e.date?.startsWith(month));
  const sum = a => a.reduce((s, e) => s + (+e.amount || 0), 0);
  const [y, mo] = month.split('-').map(Number);
  const shift = n => { const d = new Date(y, mo - 1 + n, 1); month = isoDate(d).slice(0, 7); ctx.refresh(); };

  const row = (e, actions = '') => `<div class="item">
    ${e.receipt ? `<img class="thumb click" src="${e.receipt}" data-img="${e.id}" alt="Ticket">` : '<div class="thumb none">🧾</div>'}
    <div class="grow click" data-edit="${e.id}"><b>${money(e.amount, cur())}</b> · ${esc(e.category)} ${st(e.status)}
      <div class="mut small">${fmtDate(e.date)}${ctx.admin ? ' · ' + esc(memberName(e.user_id)) : ''}${e.description ? ' · ' + esc(e.description) : ''}</div></div>${actions}</div>`;

  el.innerHTML = `
    <div class="toolbar"><button class="primary" id="new">📷 Nouvelle note de frais</button></div>
    ${ctx.admin ? `
      <div class="tiles three">
        <div class="card"><div class="mut">À valider</div><div class="num">${money(sum(pending), cur())}</div></div>
        <div class="card"><div class="mut">À rembourser</div><div class="num">${money(sum(toPay), cur())}</div></div>
        <div class="card"><div class="mut">Ce mois-ci</div><div class="num">${money(sum(all.filter(e => e.date?.startsWith(isoDate().slice(0, 7)) && e.status !== 'refusee')), cur())}</div></div>
      </div>
      <h2>À valider ${pending.length ? chip(pending.length, 'warn') : ''}</h2>
      <div class="card list">${pending.length ? pending.map(e => row(e, `<div class="row nowrap"><button class="sm ok" data-st="validee" data-id="${e.id}">✓</button><button class="sm danger" data-st="refusee" data-id="${e.id}">✕</button></div>`)).join('') : empty('Rien à valider 🎉')}</div>
      <h2>À rembourser</h2>
      <div class="card list">${toPay.length ? toPay.map(e => row(e, `<button class="sm" data-st="remboursee" data-id="${e.id}">💸 Remboursé</button>`)).join('') : empty('Aucun remboursement en attente.')}</div>` : `
      <div class="tiles"><div class="card"><div class="mut">En attente de validation</div><div class="num">${money(sum(pending), cur())}</div></div>
      <div class="card"><div class="mut">Validé, à me rembourser</div><div class="num">${money(sum(toPay), cur())}</div></div></div>`}
    <div class="section-h"><div class="weeknav"><button class="sm icon" id="prev">‹</button><b class="cap">${fmtMonth(month + '-01')}</b><button class="sm icon" id="next">›</button></div>
      <div class="row"><button class="sm ghost" id="csv">⬇︎ CSV</button><button class="sm ghost" id="print">🖨 Rapport</button></div></div>
    <div class="card list">${inMonth.length ? inMonth.map(e => row(e)).join('') : empty('Aucune note de frais ce mois-ci.')}</div>
    ${inMonth.length ? `<div class="card"><h3>Résumé du mois</h3>${summary(inMonth, ctx.admin)}</div>` : ''}`;

  $('#new', el).onclick = () => edit(null, ctx);
  $('#prev', el).onclick = () => shift(-1);
  $('#next', el).onclick = () => shift(1);
  $$('[data-edit]', el).forEach(b => b.onclick = () => edit(all.find(e => e.id === b.dataset.edit), ctx));
  $$('[data-img]', el).forEach(b => b.onclick = () => modal({ title: 'Ticket', body: `<img src="${b.src}" style="width:100%;border-radius:12px">` }));
  $$('[data-st]', el).forEach(b => b.onclick = async () => { await db.update('expenses', b.dataset.id, { status: b.dataset.st }); toast(STATUS.expense[b.dataset.st][0]); ctx.refresh(); });
  $('#csv', el).onclick = () => downloadCSV(`frais-${month}.csv`, [['Date', 'Employé', 'Catégorie', 'Description', 'Montant', 'Statut'],
    ...inMonth.map(e => [e.date, memberName(e.user_id), e.category, e.description, e.amount, STATUS.expense[e.status]?.[0]])]);
  $('#print', el).onclick = () => printHTML(`<div class="p-doc">${printHeader(session.company, 'Notes de frais', `<div class="cap">${fmtMonth(month + '-01')}</div>${ctx.admin ? '' : '<div>' + esc(me.name) + '</div>'}`)}
    <table class="p-tbl"><thead><tr><th>Date</th><th>Employé</th><th>Catégorie</th><th>Description</th><th>Statut</th><th class="n">Montant</th></tr></thead>
    <tbody>${inMonth.map(e => `<tr><td>${fmtDate(e.date)}</td><td>${esc(memberName(e.user_id))}</td><td>${esc(e.category)}</td><td>${esc(e.description)}</td><td>${STATUS.expense[e.status]?.[0]}</td><td class="n">${money(e.amount, cur())}</td></tr>`).join('')}</tbody></table>
    ${summary(inMonth, ctx.admin)}
    <div class="p-photos">${inMonth.filter(e => e.receipt).map(e => `<figure><img src="${e.receipt}"><figcaption>${fmtDate(e.date)} · ${money(e.amount, cur())}</figcaption></figure>`).join('')}</div></div>`);
}

function summary(list, admin) {
  const ok = list.filter(e => e.status !== 'refusee');
  const group = key => Object.entries(ok.reduce((m, e) => { m[key(e)] = (m[key(e)] || 0) + +e.amount; return m; }, {})).sort((a, b) => b[1] - a[1]);
  const tbl = (t, rows) => `<table class="p-tbl small-tbl"><thead><tr><th>${t}</th><th class="n">Total</th></tr></thead><tbody>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n">${money(v, cur())}</td></tr>`).join('')}</tbody></table>`;
  return `<div class="grid2">${tbl('Catégorie', group(e => e.category))}${admin ? tbl('Employé', group(e => memberName(e.user_id))) : ''}</div>
    <p><b>Total (hors refusés) : ${money(ok.reduce((s, e) => s + +e.amount, 0), cur())}</b></p>`;
}

function edit(e, ctx) {
  const mine = !e || e.user_id === session.profile.id;
  const locked = e && e.status !== 'en_attente' && !ctx.admin;
  let receipt = e?.receipt || null;
  const m = modal({
    title: e ? 'Note de frais' : 'Nouvelle note de frais',
    body: `
      <label class="receipt" id="rc">${receipt ? `<img src="${receipt}">` : '<span>📷 Photographier le ticket</span>'}<input type="file" accept="image/*" capture="environment" hidden id="file" ${locked ? 'disabled' : ''}></label>
      <div class="grid2"><label>Montant (${cur()}) *<input type="number" step="0.05" min="0" name="amount" value="${e?.amount ?? ''}" inputmode="decimal" required ${locked ? 'disabled' : ''}></label>
      <label>Date<input type="date" name="date" value="${e?.date || isoDate()}" ${locked ? 'disabled' : ''}></label></div>
      <label>Catégorie<select name="category" ${locked ? 'disabled' : ''}>${CATS.map(c => `<option ${c === e?.category ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      <label>Description<input name="description" value="${esc(e?.description)}" placeholder="Ex. Repas client, plein camionnette…" ${locked ? 'disabled' : ''}></label>
      ${e ? `<p>Statut : ${st(e.status)} ${!mine ? '· ' + esc(memberName(e.user_id)) : ''}</p>` : ''}
      ${locked ? '<p class="mut small">Cette note a déjà été traitée par ton responsable : elle n\'est plus modifiable.</p>' : ''}`,
    submit: e ? 'Enregistrer' : 'Envoyer',
    footer: e && (!locked || ctx.admin) ? '<button type="button" class="danger" id="del">Supprimer</button>' : '',
    onSubmit: locked ? undefined : async f => {
      const data = { amount: +f.amount, date: f.date, category: f.category, description: f.description, receipt };
      if (!(data.amount > 0)) throw new Error('Indique le montant');
      if (e) await db.update('expenses', e.id, data);
      else await db.insert('expenses', { ...data, status: 'en_attente' });
      toast(e ? 'Note de frais enregistrée' : 'Note de frais envoyée pour validation'); ctx.refresh();
    },
  });
  $('#file', m.el)?.addEventListener('change', async ev => {
    const file = ev.target.files[0]; if (!file) return;
    try { receipt = await compressImage(file, 1400, 0.7); $('#rc', m.el).querySelector('img, span').outerHTML = `<img src="${receipt}">`; }
    catch (err) { toast(err.message, 'err'); }
  });
  $('#del', m.el)?.addEventListener('click', async () => { if (!confirm('Supprimer cette note de frais ?')) return; await db.remove('expenses', e.id); m.close(); toast('Supprimée'); ctx.refresh(); });
}
