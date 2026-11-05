// Carnet de clients (partagé par Devis/Factures et Interventions).
import { db, session } from '../db.js';
import { $, $$, esc, modal, toast, empty, money } from '../utils.js';
import { docTotals } from './factures.js';

let q = '';

export async function render(el, ctx) {
  const on = session.company.modules;
  const [clients, docs, inter] = await Promise.all([
    db.list('clients', { order: 'name' }),
    on.includes('factures') ? db.list('documents', { eq: { kind: 'facture' } }) : [],
    on.includes('interventions') ? db.list('interventions') : [],
  ]);
  el.innerHTML = `
    <div class="toolbar"><input type="search" id="q" placeholder="🔍 Rechercher un client…" value="${esc(q)}"><button class="primary" id="new">＋ Client</button></div>
    <div class="card list" id="list"></div>`;
  const draw = () => {
    const s = q.toLowerCase();
    const list = clients.filter(c => !s || [c.name, c.contact, c.email, c.phone, c.address].join(' ').toLowerCase().includes(s));
    $('#list', el).innerHTML = list.length ? list.map(c => {
      const ca = docs.filter(d => d.client_id === c.id && d.status === 'payee').reduce((t, d) => t + docTotals(d).ttc, 0);
      const n = inter.filter(i => i.client_id === c.id).length;
      return `<div class="item click" data-id="${c.id}"><div class="avatar">${esc(c.name[0] || '?')}</div><div class="grow"><b>${esc(c.name)}</b>
        <div class="mut small">${[c.contact, c.phone, c.email].filter(Boolean).map(esc).join(' · ')}</div></div>
        <div class="right small mut">${on.includes('factures') ? money(ca, session.company.currency) + '<br>' : ''}${on.includes('interventions') ? n + ' interv.' : ''}</div></div>`;
    }).join('') : empty(clients.length ? 'Aucun résultat.' : 'Aucun client. Ajoute ton premier client !');
    $$('[data-id]', el).forEach(r => r.onclick = () => editClient(clients.find(c => c.id === r.dataset.id), ctx.refresh));
  };
  draw();
  $('#q', el).oninput = e => { q = e.target.value; draw(); };
  $('#new', el).onclick = () => editClient(null, ctx.refresh);
}

/** Formulaire client réutilisable. onSaved(client) est appelé après enregistrement. */
export function editClient(c, onSaved) {
  const m = modal({
    title: c ? c.name : 'Nouveau client',
    body: `
      <label>Nom / entreprise *<input name="name" value="${esc(c?.name)}" required></label>
      <label>Personne de contact<input name="contact" value="${esc(c?.contact)}"></label>
      <div class="grid2"><label>E-mail<input type="email" name="email" value="${esc(c?.email)}"></label><label>Téléphone<input type="tel" name="phone" value="${esc(c?.phone)}"></label></div>
      <label>Adresse<textarea name="address" rows="2">${esc(c?.address)}</textarea></label>
      <label>Notes<textarea name="notes" rows="2">${esc(c?.notes)}</textarea></label>
      ${c ? `<div class="row">${c.phone ? `<a class="btn sm" href="tel:${esc(c.phone)}">📞 Appeler</a>` : ''}${c.email ? `<a class="btn sm" href="mailto:${esc(c.email)}">✉️ E-mail</a>` : ''}${c.address ? `<a class="btn sm" target="_blank" rel="noopener" href="https://maps.google.com/?q=${encodeURIComponent(c.address)}">🗺 Itinéraire</a>` : ''}</div>` : ''}`,
    footer: c ? '<button type="button" class="danger" id="del">Supprimer</button>' : '',
    onSubmit: async f => {
      const saved = c ? await db.update('clients', c.id, f) : await db.insert('clients', f);
      toast('Client enregistré'); onSaved?.(saved);
    },
  });
  $('#del', m.el)?.addEventListener('click', async () => {
    if (!confirm(`Supprimer le client « ${c.name} » ?`)) return;
    try { await db.remove('clients', c.id); m.close(); toast('Client supprimé'); onSaved?.(null); }
    catch { toast('Impossible : ce client a des factures ou interventions.', 'err'); }
  });
}
