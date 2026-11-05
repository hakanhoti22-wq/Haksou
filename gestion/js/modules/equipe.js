// Gestion de l'équipe (responsables uniquement).
import { DEMO, session, team } from '../db.js';
import { icon } from '../icons.js';
import { $, $$, esc, modal, toast } from '../utils.js';

export async function render(el, ctx) {
  const c = session.company, me = session.profile;
  const link = location.href.split('#')[0];
  el.innerHTML = `
    <div class="card">
      <h3>Inviter un employé</h3>
      ${DEMO ? '<p class="mut small">En mode démo, ajoute directement un employé fictif. Avec Supabase, chaque employé crée son compte et entre le code ci-dessous.</p>' : '<p class="mut small">Envoie ce lien et ce code à ton employé. Il crée son compte, puis choisit « Rejoindre une entreprise ».</p>'}
      <div class="code-box"><span class="code">${esc(c.join_code)}</span><button class="sm" id="copy">Copier l'invitation</button><button class="sm ghost" id="regen">Nouveau code</button></div>
      ${DEMO ? '<button class="primary" id="add">Ajouter un employé (démo)</button>' : ''}
    </div>
    <h2>Membres (${session.members.length})</h2>
    <div class="card list">${session.members.map(m => `<div class="item">
      <div class="avatar">${esc(m.name[0] || '?')}</div>
      <div class="grow"><b>${esc(m.name)}</b>${m.id === me.id ? ' <span class="mut small">(toi)</span>' : ''}<div class="mut small">${esc(m.email || '')}</div></div>
      <select class="sm" data-role="${m.id}"><option value="employe" ${m.role === 'employe' ? 'selected' : ''}>Employé</option><option value="admin" ${m.role === 'admin' ? 'selected' : ''}>Responsable</option></select>
      ${m.id !== me.id ? `<button class="sm icon danger" data-rm="${m.id}" title="Retirer de l'entreprise">${icon('x', 15)}</button>` : ''}
    </div>`).join('')}</div>
    <p class="mut small">Un <b>responsable</b> voit les pointages, congés et frais de toute l'équipe, valide les demandes et gère le planning. Un <b>employé</b> ne voit que ses propres données.</p>`;

  $('#copy').onclick = async () => {
    const txt = `Rejoins ${c.name} sur Haksou Pro : ${link}\nCode entreprise : ${c.join_code}`;
    try { await navigator.clipboard.writeText(txt); toast('Invitation copiée'); }
    catch { prompt('Copie ce texte :', txt); }
  };
  $('#regen').onclick = async () => { if (!confirm('Créer un nouveau code ? L\'ancien ne fonctionnera plus.')) return; await team.regenCode(); toast('Nouveau code créé'); ctx.refresh(); };
  $('#add')?.addEventListener('click', () => modal({
    title: 'Ajouter un employé',
    body: `<label>Nom *<input name="name" required></label><label>Rôle<select name="role"><option value="employe">Employé</option><option value="admin">Responsable</option></select></label>`,
    submit: 'Ajouter',
    onSubmit: async f => { await team.addDemoMember(f.name, f.role); toast(`${f.name} ajouté`); ctx.refresh(); },
  }));
  $$('[data-role]', el).forEach(s => s.onchange = async () => {
    try { await team.setRole(s.dataset.role, s.value); toast('Rôle mis à jour'); if (s.dataset.role === me.id) ctx.reloadMenu(); }
    catch (e) { toast(e.message, 'err'); ctx.refresh(); }
  });
  $$('[data-rm]', el).forEach(b => b.onclick = async () => {
    const m = session.members.find(x => x.id === b.dataset.rm);
    if (!confirm(`Retirer ${m.name} de l'entreprise ? Son historique est conservé.`)) return;
    try { await team.remove(m.id); toast(`${m.name} a été retiré`); ctx.refresh(); } catch (e) { toast(e.message, 'err'); }
  });
}
