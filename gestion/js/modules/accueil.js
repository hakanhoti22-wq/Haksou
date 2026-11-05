// Tableau de bord : résumé de tous les modules activés.
import { db, session, memberName } from '../db.js';
import { MODULES } from '../meta.js';
import { $, esc, isoDate, addDays, startOfWeek, startOfDay, fmtMin, fmtLongDay, money, toast } from '../utils.js';
import { computeDays, isPresent } from './pointage.js';

export async function render(el, ctx) {
  const on = id => session.company.modules.includes(id);
  const me = session.profile, today = isoDate(), now = new Date(), cur = session.company.currency || 'CHF';
  const wk = startOfWeek(now);
  const safe = p => p.catch(() => []);
  const [punches, shifts, leaves, inter, docs, items, expenses] = await Promise.all([
    on('pointage') ? safe(db.list('punches', { gte: { at: (ctx.admin ? startOfDay(now) : wk).toISOString() } })) : [],
    on('planning') ? safe(db.list('shifts', { gte: { date: today }, lte: { date: isoDate(addDays(now, 6)) }, order: 'date' })) : [],
    on('conges') ? safe(db.list('leaves')) : [],
    on('interventions') ? safe(db.list('interventions', { eq: { date: today } })) : [],
    on('factures') && ctx.admin ? safe(db.list('documents', { eq: { kind: 'facture' } })) : [],
    on('stock') ? safe(db.list('items')) : [],
    on('frais') ? safe(db.list('expenses', { eq: { status: 'en_attente' } })) : [],
  ]);
  const { docTotals, docStatus } = on('factures') && ctx.admin ? await import('./factures.js') : {};

  const minePunches = punches.filter(p => p.user_id === me.id);
  const present = isPresent(minePunches);
  const myDays = computeDays(minePunches, now);
  const todayMin = myDays[today]?.min || 0;
  const weekMin = Object.values(myDays).reduce((s, d) => s + d.min, 0);
  const myShifts = shifts.filter(s => s.user_id === me.id);
  const hour = now.getHours();

  const tiles = [];
  const tile = (href, icon, label, value, sub = '', cls = '') => tiles.push(`<a class="card tile ${cls}" href="#/${href}"><span class="ti">${icon}</span><div><div class="mut">${label}</div><div class="num">${value}</div>${sub ? `<div class="mut small">${sub}</div>` : ''}</div></a>`);

  if (on('pointage')) {
    if (ctx.admin) { const p = session.members.filter(m => isPresent(punches.filter(x => x.user_id === m.id))); tile('pointage', '⏱️', 'Présents maintenant', `${p.length} / ${session.members.length}`, p.map(m => esc(m.name.split(' ')[0])).join(', ')); }
    else tile('pointage', '⏱️', 'Mes heures cette semaine', fmtMin(weekMin), `Aujourd'hui : ${fmtMin(todayMin)}`);
  }
  if (on('planning')) { const t = myShifts.find(s => s.date === today); tile('planning', '📅', 'Mon horaire aujourd\'hui', t ? `${t.start_time}–${t.end_time}` : 'Libre', t?.note ? esc(t.note) : `${myShifts.length} créneau(x) cette semaine`); }
  if (on('conges')) {
    if (ctx.admin) { const n = leaves.filter(l => l.status === 'en_attente').length; tile('conges', '🌴', 'Congés à valider', n, '', n ? 'warn' : ''); }
    const absent = leaves.filter(l => l.status === 'approuve' && l.start_date <= today && l.end_date >= today);
    tile('conges', '🏖', 'Absents aujourd\'hui', absent.length, absent.map(l => esc(memberName(l.user_id))).join(', '));
  }
  if (on('interventions')) { const mine = ctx.admin ? inter : inter.filter(i => i.user_id === me.id); tile('interventions', '🔧', ctx.admin ? 'Interventions du jour' : 'Mes interventions du jour', mine.length, `${mine.filter(i => i.status === 'terminee').length} terminée(s)`); }
  if (docTotals) {
    const unpaid = docs.filter(d => d.status === 'envoyee'), late = unpaid.filter(d => docStatus(d) === 'retard');
    tile('factures', '🧾', 'Factures à encaisser', money(unpaid.reduce((s, d) => s + docTotals(d).ttc, 0), cur), late.length ? `${late.length} en retard` : 'Aucune en retard', late.length ? 'bad' : '');
  }
  if (on('stock')) { const low = items.filter(i => +i.qty <= +i.min_qty); tile('stock', '📦', 'Articles en stock bas', low.length, low.slice(0, 3).map(i => esc(i.name)).join(', '), low.length ? 'warn' : ''); }
  if (on('frais')) tile('frais', '💳', ctx.admin ? 'Frais à valider' : 'Mes frais en attente', money(expenses.reduce((s, e) => s + +e.amount, 0), cur), `${expenses.length} note(s)`, expenses.length && ctx.admin ? 'warn' : '');

  el.innerHTML = `
    <div class="hello"><h2 class="h-big">${hour < 12 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir'} ${esc(me.name.split(' ')[0])} 👋</h2><p class="mut cap">${fmtLongDay(now)}</p></div>
    ${on('pointage') ? `<div class="card hero row between"><div class="status"><span class="dot ${present ? 'in' : ''}"></span><div><b>${present ? 'Tu es pointé' : 'Tu n\'es pas pointé'}</b><div class="mut small">Aujourd'hui : ${fmtMin(todayMin)}</div></div></div>
      <button class="${present ? 'out' : 'in'}" id="punch">${present ? '⏹ Départ' : '▶︎ Arrivée'}</button></div>` : ''}
    <div class="dash">${tiles.join('')}</div>
    ${!session.company.modules.length ? '<div class="card">Aucun module activé. Va dans <a href="#/reglages">Réglages</a> pour en choisir.</div>' : ''}
    <h2>Raccourcis</h2>
    <div class="quick">${MODULES.filter(m => on(m.id)).map(m => `<a href="#/${m.id}" class="q"><span>${m.icon}</span>${esc(m.label)}</a>`).join('')}</div>`;

  $('#punch')?.addEventListener('click', async e => {
    e.target.disabled = true;
    await db.insert('punches', { user_id: me.id, type: present ? 'out' : 'in', at: new Date().toISOString() });
    toast(present ? 'Départ enregistré 👋' : 'Arrivée enregistrée ✅'); ctx.refresh();
  });
}
