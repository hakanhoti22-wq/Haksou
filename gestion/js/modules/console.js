// Console du propriétaire de Haksou Pro : toutes les entreprises clientes, accès support, demandes d'aide, erreurs.
import { platform, session } from '../db.js';
import { $, $$, esc, fmtDate, fmtTime, modal, toast, chip, empty } from '../utils.js';

let tab = 'entreprises';
const STATUS = { essai: ['Essai', 'info'], actif: ['Actif', 'ok'], suspendu: ['Suspendu', 'err'] };
const ago = d => {
  if (!d) return 'jamais';
  const m = (Date.now() - new Date(d)) / 6e4;
  return m < 60 ? `il y a ${Math.max(1, Math.round(m))} min` : m < 1440 ? `il y a ${Math.round(m / 60)} h` : `il y a ${Math.round(m / 1440)} j`;
};
const trialLeft = c => c.status === 'essai' && c.trial_ends_at ? Math.ceil((new Date(c.trial_ends_at + 'T23:59') - Date.now()) / 864e5) : null;

export async function render(el, ctx) {
  if (!session.owner) { el.innerHTML = empty('Réservé au propriétaire de la plateforme.'); return; }
  const [companies, tickets, errors] = await Promise.all([platform.overview(), platform.tickets(), platform.errors()]);
  const openT = tickets.filter(t => t.status === 'ouvert');
  const week = Date.now() - 7 * 864e5;
  const groups = Object.values(errors.filter(e => !e.resolved).reduce((g, e) => {
    const x = g[e.message] ||= { message: e.message, count: 0, last: e.at, companies: new Set(), sample: e };
    x.count++; if (e.at > x.last) { x.last = e.at; x.sample = e; } x.companies.add(e.company_name); return g;
  }, {})).sort((a, b) => a.last < b.last ? 1 : -1);
  const count = s => companies.filter(c => c.status === s).length;

  el.innerHTML = `
    ${session.support ? `<div class="card notice">Tu es en mode support chez <b>${esc(session.support.company_name)}</b>. Le menu à gauche montre son appli.</div>` : ''}
    <div class="tiles four">
      <div class="card"><div class="mut">Entreprises</div><div class="num">${companies.length}</div><div class="mut small">${count('actif')} active${count('actif') > 1 ? 's' : ''} · ${count('essai')} en essai · ${count('suspendu')} suspendue${count('suspendu') > 1 ? 's' : ''}</div></div>
      <div class="card"><div class="mut">Utilisateurs</div><div class="num">${companies.reduce((s, c) => s + c.members, 0)}</div><div class="mut small">${companies.filter(c => c.last_activity && new Date(c.last_activity) > week).length} entreprises actives cette semaine</div></div>
      <div class="card click" data-goto="aide"><div class="mut">Demandes d'aide ouvertes</div><div class="num ${openT.length ? 'warn-t' : 'good'}">${openT.length}</div></div>
      <div class="card click" data-goto="erreurs"><div class="mut">Erreurs (7 jours)</div><div class="num ${groups.length ? 'bad' : 'good'}">${errors.filter(e => new Date(e.at) > week).length}</div><div class="mut small">${groups.length} problème(s) à traiter</div></div>
    </div>
    <div class="toolbar">
      <div class="seg">${[['entreprises', 'Entreprises'], ['aide', `Demandes d'aide${openT.length ? ` (${openT.length})` : ''}`], ['erreurs', `Erreurs${groups.length ? ` (${groups.length})` : ''}`]].map(([k, t]) => `<button data-t="${k}" class="${tab === k ? 'on' : ''}">${t}</button>`).join('')}</div>
      <span class="grow"></span>
      ${tab === 'entreprises' ? '<button class="primary" id="new">Nouvelle entreprise cliente</button>' : ''}
    </div>
    <div id="tab"></div>`;

  const box = $('#tab', el);
  if (tab === 'entreprises') {
    box.innerHTML = `<div class="card list">${companies.length ? companies.map(c => {
      const left = trialLeft(c);
      return `<div class="item">
        <div class="avatar">${esc(c.name[0] || '?')}</div>
        <div class="grow"><b>${esc(c.name)}</b> ${chip(...STATUS[c.status])} ${left !== null ? chip(left < 0 ? 'Essai expiré' : `${left} j d'essai`, left < 3 ? 'err' : 'warn') : ''}
          ${!c.support_allowed ? chip('Support refusé', '') : ''} ${c.open_tickets ? chip(`${c.open_tickets} demande${c.open_tickets > 1 ? 's' : ''} d'aide`, 'warn') : ''} ${c.errors_7d ? chip(`${c.errors_7d} erreur${c.errors_7d > 1 ? 's' : ''}`, 'err') : ''}
          <div class="mut small">${c.members} utilisateur(s) · ${c.punches_7d} pointages / 7 j · ${c.documents_30d} documents / 30 j · activité ${ago(c.last_activity)}
          ${c.admin_code ? ` · <b>code responsable à envoyer : ${esc(c.admin_code)}</b>` : ''}</div>
          ${c.notes ? `<div class="mut small">${esc(c.notes)}</div>` : ''}</div>
        <div class="row nowrap"><button class="sm" data-manage="${c.id}">Gérer</button><button class="sm primary" data-enter="${c.id}" ${c.support_allowed ? '' : 'disabled'}>Accéder</button></div>
      </div>`;
    }).join('') : empty('Aucune entreprise cliente pour l\'instant. Crée la première !')}</div>
    <p class="mut small"><b>Accéder</b> ouvre l'appli de l'entreprise avec les droits de son responsable, pendant 2 heures maximum. Le motif et chaque action sont enregistrés et visibles par l'entreprise dans Réglages.</p>`;
    $$('[data-enter]', box).forEach(b => b.onclick = () => enter(companies.find(c => c.id === b.dataset.enter), ctx));
    $$('[data-manage]', box).forEach(b => b.onclick = () => manage(companies.find(c => c.id === b.dataset.manage), ctx));
  }

  if (tab === 'aide') {
    box.innerHTML = `<div class="card list">${tickets.length ? tickets.map(t => `<div class="item">
      <div class="grow">${t.status === 'ouvert' ? chip('Ouverte', 'warn') : chip('Résolue', 'ok')} <b>${esc(t.company_name || '—')}</b> · ${esc(t.user_name || '—')}${t.user_email ? ` <a href="mailto:${esc(t.user_email)}">${esc(t.user_email)}</a>` : ''}
        <span class="mut small">· ${fmtDate(t.created_at)} ${fmtTime(t.created_at)}</span>
        <div class="msg">${esc(t.message)}</div>
        ${t.context ? `<div class="mut small">${esc(t.context)}</div>` : ''}
        ${t.reply ? `<div class="reply">${esc(t.reply)}</div>` : ''}</div>
      <div class="row nowrap"><button class="sm" data-reply="${t.id}">Répondre</button>${companies.find(c => c.id === t.company_id)?.support_allowed ? `<button class="sm ghost" data-enter="${t.company_id}" data-reason="${esc('Demande d\'aide : ' + t.message.slice(0, 80))}"></button>` : ''}</div>
    </div>`).join('') : empty('Aucune demande d\'aide.')}</div>`;
    $$('[data-reply]', box).forEach(b => b.onclick = () => reply(tickets.find(t => t.id === b.dataset.reply), ctx));
    $$('[data-enter]', box).forEach(b => b.onclick = () => enter(companies.find(c => c.id === b.dataset.enter), ctx, b.dataset.reason));
  }

  if (tab === 'erreurs') {
    box.innerHTML = `<p class="mut small">Les erreurs techniques rencontrées par les utilisateurs remontent ici automatiquement, regroupées par problème. Les messages normaux (champ manquant, droit refusé, pas de réseau) ne sont pas comptés.</p>
    <div class="card list">${groups.length ? groups.map((g, i) => `<div class="item">
      <div class="grow"><b class="bad">${esc(g.message)}</b>
        <div class="mut small">${g.count} fois · dernière ${ago(g.last)} · ${[...g.companies].map(esc).join(', ')} · écran ${esc(g.sample.url || '?')} · v${esc(g.sample.app_version || '?')}</div>
        <details><summary class="mut small">Détails techniques</summary><pre class="stack">${esc(g.sample.stack || '(pas de trace)')}\n\n${esc(g.sample.user_agent || '')}\nUtilisateur : ${esc(g.sample.user_name || '—')}</pre></details></div>
      <button class="sm ok" data-resolve="${i}">Marquer corrigé</button></div>`).join('') : empty('Aucune erreur à traiter')}</div>`;
    $$('[data-resolve]', box).forEach(b => b.onclick = async () => { await platform.resolveErrors(groups[+b.dataset.resolve].message); toast('Marqué comme corrigé'); ctx.refresh(); });
  }

  $$('[data-t]', el).forEach(b => b.onclick = () => { tab = b.dataset.t; ctx.refresh(); });
  $$('[data-goto]', el).forEach(b => b.onclick = () => { tab = b.dataset.goto; ctx.refresh(); });
  $('#new', el)?.addEventListener('click', () => create(ctx));
}

function enter(c, ctx, reason = '') {
  modal({
    title: `Accéder à ${c.name}`,
    body: `<p class="mut small">Tu vas voir et modifier l'appli de cette entreprise avec les droits de son responsable, pendant 2 heures maximum. Le motif et chacune de tes actions seront visibles par l'entreprise.</p>
      <label>Motif *<input name="reason" required value="${esc(reason)}" placeholder="Ex. Appel de M. Favre : facture bloquée" maxlength="200"></label>`,
    submit: 'Ouvrir l\'accès support',
    onSubmit: async f => {
      await platform.startSupport(c.id, f.reason);
      toast(`Mode support : ${c.name}`);
      location.hash = '#/accueil';
      window.dispatchEvent(new Event('haksou:restart'));
    },
  });
}

function manage(c, ctx) {
  modal({
    title: c.name,
    body: `
      <div class="grid2"><label>Statut<select name="status">${Object.entries(STATUS).map(([k, [t]]) => `<option value="${k}" ${k === c.status ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Fin de l'essai<input type="date" name="trial" value="${c.trial_ends_at || ''}"></label></div>
      <p class="mut small">« Suspendu » bloque l'accès de toute l'entreprise (ses données sont conservées). Utile en cas d'impayé.</p>
      <label>Notes internes (jamais visibles par le client)<textarea name="notes" rows="3" placeholder="Contact, prix convenu, historique…">${esc(c.notes)}</textarea></label>
      <p class="mut small">Créée le ${fmtDate(c.created_at)} · ${c.members} utilisateur(s) dont ${c.admins} responsable(s)${c.admin_code ? ` · code responsable pas encore utilisé : <b>${esc(c.admin_code)}</b>` : ''}</p>`,
    onSubmit: async f => {
      if (f.status === 'suspendu' && c.status !== 'suspendu' && !confirm(`Suspendre ${c.name} ? Plus personne de l'entreprise ne pourra se connecter.`)) return false;
      await platform.setCompany(c.id, f.status, f.trial || null, f.notes);
      toast('Entreprise mise à jour'); ctx.refresh();
    },
  });
}

function create(ctx) {
  modal({
    title: 'Nouvelle entreprise cliente',
    body: `<label>Nom de l'entreprise *<input name="name" required placeholder="Ex. Garage Favre Sàrl"></label>
      <label>Période d'essai<select name="days"><option value="30">30 jours</option><option value="14">14 jours</option><option value="60">60 jours</option><option value="0">Pas d'essai (client actif)</option></select></label>`,
    submit: 'Créer',
    onSubmit: async f => {
      const r = await platform.createCompany(f.name, +f.days);
      const link = location.href.split('#')[0];
      const text = `Bonjour,\n\nVotre espace Haksou Pro « ${f.name} » est prêt.\n\n1. Ouvrez ${link}\n2. Créez votre compte (e-mail + mot de passe)\n3. Choisissez « Rejoindre une entreprise » et entrez ce code responsable : ${r.admin_code}\n\nCe code est à usage unique et fait de vous le responsable. Vous pourrez ensuite inviter vos employés depuis le menu Équipe.\n\nÀ votre disposition pour toute question.`;
      setTimeout(() => modal({
        title: 'Entreprise créée',
        body: `<p>Envoie ce message au patron de <b>${esc(f.name)}</b> :</p><textarea rows="11" readonly id="welcome">${esc(text)}</textarea>`,
        footer: '<button type="button" class="primary" id="copyW">Copier</button>',
        onMount: w => { w.querySelector('#copyW').onclick = async () => { try { await navigator.clipboard.writeText(text); toast('Message copié'); } catch { w.querySelector('#welcome').select(); } }; },
      }), 50);
      ctx.refresh();
    },
  });
}

function reply(t, ctx) {
  modal({
    title: `Répondre à ${t.user_name || 'l\'utilisateur'} (${t.company_name})`,
    body: `<div class="msg card">${esc(t.message)}</div>
      <label>Ta réponse (visible dans son bouton Aide)<textarea name="reply" rows="4" required>${esc(t.reply || '')}</textarea></label>
      <label class="check"><input type="checkbox" name="resolved" ${t.status === 'ouvert' ? 'checked' : ''}> Marquer comme résolue</label>
      ${t.user_email ? `<p class="mut small">Tu peux aussi lui écrire directement : <a href="mailto:${esc(t.user_email)}?subject=${encodeURIComponent('Votre demande Haksou Pro')}">${esc(t.user_email)}</a></p>` : ''}`,
    submit: 'Envoyer la réponse',
    onSubmit: async f => { await platform.replyTicket(t.id, f.reply, !!f.resolved); toast('Réponse envoyée'); ctx.refresh(); },
  });
}

