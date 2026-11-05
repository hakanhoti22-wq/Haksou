// Module 4 — Bons d'intervention (photos, signature du client, PDF).
import { db, session, memberName } from '../db.js';
import { STATUS } from '../meta.js';
import { $, $$, esc, isoDate, fmtDate, fmtLongDay, fmtTime, modal, toast, chip, empty, options, compressImage, signaturePad } from '../utils.js';
import { createPDF, downloadFile, sendFile } from '../pdf.js';
import { editClient } from './clients.js';

let filter = 'actives';
const st = s => chip(...(STATUS.intervention[s] || [s]));

export async function render(el, ctx) {
  if (ctx.param) return detail(el, ctx, ctx.param);
  const me = session.profile;
  const [list, clients] = await Promise.all([db.list('interventions', { order: 'date', asc: false }), db.list('clients', { order: 'name' })]);
  const cname = id => clients.find(c => c.id === id)?.name || 'Sans client';
  const today = isoDate();
  const shown = list.filter(i => filter === 'toutes' || (filter === 'miennes' ? i.user_id === me.id : i.status !== 'terminee'))
    .sort((a, b) => filter === 'actives' ? (a.date < b.date ? -1 : 1) : 0);

  el.innerHTML = `
    <div class="toolbar">
      <div class="seg">${[['actives', 'À faire'], ['miennes', 'Les miennes'], ['toutes', 'Toutes']].map(([k, t]) => `<button data-f="${k}" class="${filter === k ? 'on' : ''}">${t}</button>`).join('')}</div>
      <span class="grow"></span><button class="primary" id="new">＋ Intervention</button>
    </div>
    <div class="card list">${shown.length ? shown.map(i => `<div class="item click" data-id="${i.id}">
      <div class="date-box ${i.date === today ? 'today' : i.date < today && i.status !== 'terminee' ? 'late' : ''}"><b>${i.date ? +i.date.slice(8) : '?'}</b><small>${i.date ? new Date(i.date + 'T12:00').toLocaleDateString('fr-CH', { month: 'short' }) : ''}</small></div>
      <div class="grow"><b>${esc(i.title)}</b> ${st(i.status)}<div class="mut small">${esc(cname(i.client_id))} · ${esc(memberName(i.user_id))}${i.photos?.length ? ` · 📷 ${i.photos.length}` : ''}${i.signature ? ' · ✍️ signé' : ''}</div></div>
      <span class="mut">›</span></div>`).join('') : empty('Aucune intervention ici.')}</div>`;

  $$('[data-f]', el).forEach(b => b.onclick = () => { filter = b.dataset.f; ctx.refresh(); });
  $$('[data-id]', el).forEach(r => r.onclick = () => ctx.go('#/interventions/' + r.dataset.id));
  $('#new', el).onclick = () => modal({
    title: 'Nouvelle intervention',
    body: `
      <label>Titre *<input name="title" placeholder="Ex. Fuite sous évier" required></label>
      <label>Client<div class="row nowrap"><select name="client_id" id="cl" class="grow">${options(clients, '', { blank: '— Choisir —' })}</select><button type="button" class="sm" id="nc">＋</button></div></label>
      <div class="grid2"><label>Date<input type="date" name="date" value="${today}"></label>
      <label>Technicien<select name="user_id">${options(session.members, me.id)}</select></label></div>
      <label>Demande du client<textarea name="description" rows="3"></textarea></label>`,
    submit: 'Créer',
    onMount: w => { $('#nc', w).onclick = () => editClient(null, c => { if (c) { clients.push(c); $('#cl', w).innerHTML = options(clients, c.id, { blank: '— Choisir —' }); } }); },
    onSubmit: async f => {
      const i = await db.insert('interventions', { ...f, client_id: f.client_id || null, status: 'planifiee', hours: 0, work_done: '', materials: '', photos: [], signature: null, signer_name: '', signed_at: null });
      ctx.go('#/interventions/' + i.id);
    },
  });
}

async function detail(el, ctx, id) {
  const [i, clients] = await Promise.all([db.get('interventions', id), db.list('clients', { order: 'name' })]);
  if (!i) { el.innerHTML = empty('Intervention introuvable.'); return; }
  i.photos ||= [];
  const client = () => clients.find(c => c.id === i.client_id);
  const save = async (patch, msg) => { Object.assign(i, await db.update('interventions', i.id, patch)); if (msg) toast(msg); };
  const c = client();

  el.innerHTML = `
    <div class="toolbar">
      <a class="btn sm ghost" href="#/interventions">‹ Retour</a><span class="grow"></span>
      <button class="sm" id="pdf">📄 Bon PDF</button><button class="sm" id="send">📤 Envoyer</button>
      ${session.company.modules.includes('factures') ? '<button class="sm" id="invoice">🧾 Facturer</button>' : ''}
      <button class="sm icon danger" id="del" title="Supprimer">🗑</button>
    </div>
    <form class="card" id="f">
      <div class="grid2">
        <label>Titre<input name="title" value="${esc(i.title)}" required></label>
        <label>Statut<select name="status">${Object.entries(STATUS.intervention).map(([k, [t]]) => `<option value="${k}" ${k === i.status ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label>Client<select name="client_id">${options(clients, i.client_id, { blank: '— Aucun —' })}</select></label>
        <label>Technicien<select name="user_id">${options(session.members, i.user_id)}</select></label>
        <label>Date<input type="date" name="date" value="${i.date || ''}"></label>
        <label>Durée (heures)<input type="number" step="0.25" min="0" name="hours" value="${i.hours || 0}"></label>
      </div>
      ${c ? `<div class="client-box"><b>${esc(c.name)}</b> ${c.phone ? `· <a href="tel:${esc(c.phone)}">📞 ${esc(c.phone)}</a>` : ''} ${c.address ? `· <a target="_blank" rel="noopener" href="https://maps.google.com/?q=${encodeURIComponent(c.address)}">🗺 ${esc(c.address.replace(/\n/g, ', '))}</a>` : ''}${c.notes ? `<div class="mut small">📝 ${esc(c.notes)}</div>` : ''}</div>` : ''}
      <label>Demande du client<textarea name="description" rows="2">${esc(i.description)}</textarea></label>
      <label>Travaux réalisés<textarea name="work_done" rows="3" placeholder="Ce qui a été fait…">${esc(i.work_done)}</textarea></label>
      <label>Matériel utilisé<textarea name="materials" rows="2">${esc(i.materials)}</textarea></label>
      <button class="primary" type="submit">Enregistrer</button>
    </form>
    <h2>Photos</h2>
    <div class="card"><div class="photos" id="photos"></div>
      <label class="btn">📷 Ajouter des photos<input type="file" accept="image/*" multiple id="addPhoto" hidden></label></div>
    <h2>Signature du client</h2>
    <div class="card" id="sig"></div>`;

  $('#f').onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    await save({ ...f, hours: +f.hours || 0, client_id: f.client_id || null }, 'Intervention enregistrée');
    ctx.refresh();
  };
  const drawPhotos = () => {
    $('#photos').innerHTML = i.photos.length ? i.photos.map((p, k) => `<figure><img src="${p}" alt="Photo ${k + 1}" data-k="${k}"><button class="icon sm danger" data-rm="${k}">✕</button></figure>`).join('') : '<p class="mut small">Aucune photo. Prends une photo avant et après le travail.</p>';
    $$('[data-rm]', el).forEach(b => b.onclick = async () => { if (!confirm('Supprimer cette photo ?')) return; i.photos.splice(+b.dataset.rm, 1); await save({ photos: i.photos }); drawPhotos(); });
    $$('#photos img', el).forEach(img => img.onclick = () => modal({ title: 'Photo', body: `<img src="${img.src}" style="width:100%;border-radius:12px">` }));
  };
  drawPhotos();
  $('#addPhoto').onchange = async e => {
    try {
      for (const file of e.target.files) i.photos.push(await compressImage(file, 1280, 0.7));
      await save({ photos: i.photos }, 'Photo ajoutée'); drawPhotos();
    } catch (err) { i.photos = (await db.get('interventions', i.id)).photos || []; toast(err.message, 'err'); }
    e.target.value = '';
  };

  const drawSig = () => {
    const box = $('#sig');
    if (i.signature) {
      box.innerHTML = `<img class="sig-img" src="${i.signature}" alt="Signature"><p class="mut small">Signé par <b>${esc(i.signer_name || '—')}</b>${i.signed_at ? ` le ${fmtDate(i.signed_at)} à ${fmtTime(i.signed_at)}` : ''}</p><button class="sm ghost" id="resign">Refaire la signature</button>`;
      $('#resign').onclick = async () => { if (confirm('Effacer la signature ?')) { await save({ signature: null, signed_at: null }); drawSig(); } };
      return;
    }
    box.innerHTML = `<p class="mut small">Fais signer le client directement sur l'écran pour valider la fin de l'intervention.</p>
      <canvas id="pad" class="pad"></canvas>
      <div class="row"><input id="signer" placeholder="Nom du signataire" value="${esc(i.signer_name || c?.contact || c?.name || '')}" class="grow"><button class="sm ghost" id="clear">Effacer</button><button class="ok" id="sign">✍️ Valider la signature</button></div>`;
    const pad = signaturePad($('#pad'));
    $('#clear').onclick = () => pad.clear();
    $('#sign').onclick = async () => {
      if (pad.isEmpty()) return toast('Le client doit d\'abord signer', 'err');
      await save({ signature: pad.toDataURL(), signer_name: $('#signer').value.trim(), signed_at: new Date().toISOString(), status: 'terminee' }, 'Intervention signée et terminée ✅');
      ctx.refresh();
    };
  };
  drawSig();

  $('#del').onclick = async () => { if (!confirm('Supprimer cette intervention ?')) return; await db.remove('interventions', i.id); toast('Supprimée'); ctx.go('#/interventions'); };
  $('#pdf').onclick = async () => { try { downloadFile(await pdfBon(i, client())); } catch (e) { toast(e.message, 'err'); } };
  $('#send').onclick = async () => {
    try {
      const c = client(), co = session.company;
      await sendFile(await pdfBon(i, c), { to: c?.email, subject: `Bon d'intervention du ${fmtDate(i.date)} – ${co.name}`,
        body: `Bonjour${c?.contact ? ' ' + c.contact : ''},\n\nVous trouverez ci-joint le bon d'intervention « ${i.title} » du ${fmtDate(i.date)}.\n\nMeilleures salutations\n${session.profile.name}\n${co.name}` });
    } catch (e) { toast(e.message, 'err'); }
  };
  $('#invoice')?.addEventListener('click', async () => {
    const { createDoc } = await import('./factures.js');
    const lines = [{ desc: `Intervention : ${i.title} (${fmtDate(i.date)})`, qty: +i.hours || 1, price: +session.company.hourly_rate || 0 }];
    if (i.materials) lines.push({ desc: 'Matériel : ' + i.materials.replace(/\n/g, ', '), qty: 1, price: 0 });
    const id = await createDoc('facture', { client_id: i.client_id, lines, notes: `Bon d'intervention du ${fmtDate(i.date)}.` });
    toast('Facture créée : complète les prix si besoin'); ctx.go('#/factures/' + id);
  });
}

/** Bon d'intervention en PDF (avec photos et signature). */
async function pdfBon(i, c) {
  const p = await createPDF();
  p.header('Bon d\'intervention', [fmtLongDay(i.date).replace(/^./, x => x.toUpperCase()), `Technicien : ${memberName(i.user_id)}`]);
  p.address([c?.name, c?.contact, ...String(c?.address || '').split('\n'), c?.phone]);
  p.text(i.title, { size: 13, bold: true, after: 3 });
  for (const [t, v] of [['Demande du client', i.description], ['Travaux réalisés', i.work_done], ['Matériel utilisé', i.materials]].filter(([, v]) => v)) {
    p.text(t, { bold: true, after: 0.5 }); p.text(v, { after: 3.5 });
  }
  p.text(`Durée : ${i.hours || 0} h`, { bold: true, after: 5 });
  if (i.photos?.length) { p.ensure(60); p.text('Photos', { bold: true, after: 2 }); p.photos(i.photos); }
  p.ensure(45); p.space(4);
  p.text(`Signature du client${i.signer_name ? ` (${i.signer_name})` : ''}${i.signed_at ? ` – ${fmtDate(i.signed_at)} ${fmtTime(i.signed_at)}` : ''} :`, { after: 2 });
  if (i.signature) p.y += p.image(i.signature, p.M, p.y, 70, 30) + 2;
  else { p.space(16); p.doc.setDrawColor(0); p.doc.setLineWidth(0.3); p.doc.line(p.M, p.y, p.M + 75, p.y); }
  return p.finish(`bon-intervention-${i.date || ''}-${i.title}.pdf`);
}
