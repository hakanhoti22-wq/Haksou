// Réglages : profil, entreprise, modules, mode démo.
import { DEMO, auth, session, team } from '../db.js';
import { MODULES } from '../meta.js';
import { $, esc, toast } from '../utils.js';

export async function render(el, ctx) {
  const c = session.company, me = session.profile;
  el.innerHTML = `
    <form class="card" id="profile"><h3>👤 Mon profil</h3>
      <label>Mon nom<input name="name" value="${esc(me.name)}" required></label>
      <button type="submit">Enregistrer</button></form>

    ${ctx.admin ? `
    <form class="card" id="company"><h3>🏢 Entreprise</h3>
      <p class="mut small">Ces informations apparaissent sur les devis, factures et bons d'intervention.</p>
      <label>Nom<input name="name" value="${esc(c.name)}" required></label>
      <label>Adresse<textarea name="address" rows="2">${esc(c.address)}</textarea></label>
      <div class="grid2">
        <label>Téléphone<input name="phone" value="${esc(c.phone)}"></label>
        <label>E-mail<input type="email" name="email" value="${esc(c.email)}"></label>
        <label>IBAN<input name="iban" value="${esc(c.iban)}"></label>
        <label>Monnaie<select name="currency">${['CHF', 'EUR', 'USD', 'CAD', 'MAD', 'XOF'].map(x => `<option ${x === c.currency ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label>TVA par défaut (%)<input type="number" step="0.1" name="vat" value="${c.vat ?? 0}"></label>
        <label>Tarif horaire (${esc(c.currency)})<input type="number" step="0.05" name="hourly_rate" value="${c.hourly_rate ?? 0}"></label>
        <label>Heures par semaine (objectif)<input type="number" step="0.5" name="week_hours" value="${c.week_hours ?? 42}"></label>
      </div>
      <button type="submit" class="primary">Enregistrer l'entreprise</button></form>

    <form class="card" id="mods"><h3>🧩 Modules activés</h3>
      <p class="mut small">Active seulement ce dont ton entreprise a besoin : le menu s'adapte pour toute l'équipe.</p>
      <div class="mods">${MODULES.map(m => `<label class="mod"><input type="checkbox" name="${m.id}" ${c.modules.includes(m.id) ? 'checked' : ''}><span>${m.icon}</span><div><b>${m.label}</b><small>${m.desc}</small></div></label>`).join('')}</div>
      <button type="submit" class="primary">Enregistrer les modules</button></form>` : ''}

    <div class="card"><h3>📱 Installer l'appli</h3>
      <p class="mut small"><b>iPhone</b> : ouvre cette page dans Safari → bouton Partager → « Sur l'écran d'accueil ».<br>
      <b>Android</b> : menu ⋮ de Chrome → « Installer l'application ».<br><b>Ordinateur</b> : icône d'installation dans la barre d'adresse de Chrome ou Edge.</p></div>

    <div class="card"><h3>${DEMO ? '🧪 Mode démo' : '🔐 Compte'}</h3>
      ${DEMO ? `<p class="mut small">Les données sont enregistrées uniquement dans ce navigateur. Pour l'utiliser avec une vraie équipe, configure Supabase (voir le fichier README).</p>
        <div class="row"><button id="switch">👥 Changer d'utilisateur</button><button class="danger" id="reset">↺ Réinitialiser la démo</button></div>`
      : `<p class="mut small">Connecté : ${esc(auth.user?.email || '')}</p><button class="danger" id="logout">Se déconnecter</button>`}
    </div>
    <p class="mut small center">Haksou Pro · v1.0</p>`;

  $('#profile').onsubmit = async e => { e.preventDefault(); await team.setMyName(e.target.name.value.trim()); toast('Profil enregistré'); ctx.reloadMenu(); };
  $('#company')?.addEventListener('submit', async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    for (const k of ['vat', 'hourly_rate', 'week_hours']) f[k] = +f[k] || 0;
    try { await team.updateCompany(f); toast('Entreprise enregistrée'); ctx.reloadMenu(); } catch (err) { toast(err.message, 'err'); }
  });
  $('#mods')?.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try { await team.updateCompany({ modules: MODULES.map(m => m.id).filter(id => fd.has(id)) }); toast('Modules mis à jour'); ctx.reloadMenu(); } catch (err) { toast(err.message, 'err'); }
  });
  const logout = () => window.dispatchEvent(new Event('haksou:logout'));
  $('#switch')?.addEventListener('click', logout);
  $('#logout')?.addEventListener('click', logout);
  $('#reset')?.addEventListener('click', () => { if (confirm('Effacer toutes les données de démo et repartir des exemples ?')) { auth.resetDemo(); location.hash = ''; location.reload(); } });
}
