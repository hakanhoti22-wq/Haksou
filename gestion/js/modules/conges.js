// Module 2 — Congés et absences.
import { db, session, memberName } from '../db.js';
import { STATUS } from '../meta.js';
import { $$, esc, isoDate, fmtDate, workdays, modal, toast, chip, empty } from '../utils.js';

const KINDS = ['Vacances', 'Maladie', 'Accident', 'Formation', 'Congé spécial', 'Sans solde', 'Autre'];
const st = s => chip(...(STATUS.leave[s] || [s]));
const period = l => l.start_date === l.end_date ? fmtDate(l.start_date) : `${fmtDate(l.start_date)} → ${fmtDate(l.end_date)}`;
const nb = l => { const n = workdays(l.start_date, l.end_date); return `${n} jour${n > 1 ? 's' : ''}`; };

export async function render(el, ctx) {
  const all = await db.list('leaves', { order: 'start_date', asc: false });
  const me = session.profile, today = isoDate(), year = String(new Date().getFullYear());
  const mine = all.filter(l => l.user_id === me.id);
  const pending = all.filter(l => l.status === 'en_attente');
  const upcoming = all.filter(l => l.status === 'approuve' && l.end_date >= today).sort((a, b) => a.start_date < b.start_date ? -1 : 1);
  const usedDays = uid => all.filter(l => l.user_id === uid && l.status === 'approuve' && l.kind === 'Vacances' && l.start_date.startsWith(year)).reduce((s, l) => s + workdays(l.start_date, l.end_date), 0);

  const row = (l, actions = '') => `<div class="item">
    <div class="grow"><b>${ctx.admin ? esc(memberName(l.user_id)) + ' · ' : ''}${esc(l.kind)}</b> ${st(l.status)}
      <div class="mut small">${period(l)} · ${nb(l)}${l.reason && (ctx.admin || l.user_id === me.id) ? ' · ' + esc(l.reason) : ''}</div></div>${actions}</div>`;

  el.innerHTML = `
    <div class="toolbar"><button class="primary" id="new">＋ Nouvelle demande</button></div>
    ${ctx.admin ? `
      <h2>À valider ${pending.length ? chip(pending.length, 'warn') : ''}</h2>
      <div class="card list">${pending.length ? pending.map(l => row(l, `<div class="row"><button class="sm ok" data-ok="${l.id}">✓ Accepter</button><button class="sm danger" data-ko="${l.id}">✕ Refuser</button></div>`)).join('') : empty('Aucune demande en attente 🎉')}</div>` : ''}
    <h2>Absences à venir (équipe)</h2>
    <div class="card list">${upcoming.length ? upcoming.map(l => row({ ...l, kind: (ctx.admin ? '' : memberName(l.user_id) + ' · ') + l.kind })).join('') : empty('Personne n\'est absent prochainement.')}</div>
    <h2>Mes demandes</h2>
    <div class="card list">${mine.length ? mine.map(l => row(l, l.status === 'en_attente' ? `<button class="sm ghost" data-cancel="${l.id}">Annuler</button>` : '')).join('') : empty('Tu n\'as encore fait aucune demande.')}</div>
    <h2>Vacances prises en ${year}</h2>
    <div class="card list">${(ctx.admin ? session.members : [me]).map(m => `<div class="item"><span class="grow">${esc(m.name)}</span><b>${usedDays(m.id)} j</b></div>`).join('')}</div>`;

  el.querySelector('#new').onclick = () => modal({
    title: 'Demande d\'absence',
    body: `
      ${ctx.admin ? `<label>Employé<select name="user_id">${session.members.map(m => `<option value="${m.id}" ${m.id === me.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>` : ''}
      <label>Type<select name="kind">${KINDS.map(k => `<option>${k}</option>`).join('')}</select></label>
      <div class="grid2"><label>Du<input type="date" name="start_date" value="${today}" required></label><label>Au<input type="date" name="end_date" value="${today}" required></label></div>
      <label>Commentaire<textarea name="reason" rows="2" placeholder="Facultatif"></textarea></label>
      ${ctx.admin ? '<label class="check"><input type="checkbox" name="approve" checked> Approuver directement</label>' : ''}`,
    submit: 'Envoyer la demande',
    onSubmit: async f => {
      if (f.end_date < f.start_date) throw new Error('La date de fin est avant la date de début.');
      await db.insert('leaves', { user_id: f.user_id || me.id, kind: f.kind, start_date: f.start_date, end_date: f.end_date, reason: f.reason, status: 'en_attente' })
        .then(l => f.approve ? db.update('leaves', l.id, { status: 'approuve', decided_by: me.id }) : l);
      toast(f.approve ? 'Absence enregistrée' : 'Demande envoyée à ton responsable'); ctx.refresh();
    },
  });
  const decide = (id, status) => async () => { await db.update('leaves', id, { status, decided_by: me.id }); toast(status === 'approuve' ? 'Demande acceptée' : 'Demande refusée'); ctx.refresh(); };
  $$('[data-ok]', el).forEach(b => b.onclick = decide(b.dataset.ok, 'approuve'));
  $$('[data-ko]', el).forEach(b => b.onclick = decide(b.dataset.ko, 'refuse'));
  $$('[data-cancel]', el).forEach(b => b.onclick = async () => { if (confirm('Annuler cette demande ?')) { await db.remove('leaves', b.dataset.cancel); ctx.refresh(); } });
}
