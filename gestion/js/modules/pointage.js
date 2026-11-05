// Module 1 — Pointage multi-employés.
import { db, session } from '../db.js';
import { $, $$, esc, isoDate, addDays, startOfWeek, startOfDay, startOfMonth, fmtTime, fmtMin, fmtDay, fmtMonth, timeInput, modal, toast, downloadCSV, empty, chip, parseDate } from '../utils.js';

/** Regroupe des pointages (d'un employé) par jour et calcule les minutes travaillées. */
export function computeDays(punches, now = new Date()) {
  const days = {};
  for (const p of [...punches].sort((a, b) => a.at < b.at ? -1 : 1)) (days[isoDate(p.at)] ||= { list: [], min: 0 }).list.push(p);
  const today = isoDate(now);
  for (const [date, d] of Object.entries(days)) {
    let start = null;
    for (const p of d.list) {
      if (p.type === 'in') start = start || new Date(p.at);
      else if (start) { d.min += (new Date(p.at) - start) / 6e4; start = null; }
    }
    d.open = !!start;
    if (start && date === today) d.min += (now - start) / 6e4;
    d.missing = !!start && date !== today; // départ oublié
  }
  return days;
}
export const isPresent = punches => { const t = isoDate(new Date()); const l = punches.filter(p => isoDate(p.at) === t).sort((a, b) => a.at < b.at ? -1 : 1).pop(); return l?.type === 'in'; };

let weekOffset = 0;
let timer = null;

export async function render(el, ctx) {
  clearInterval(timer);
  const me = session.profile, now = new Date();
  const since = addDays(startOfWeek(now), -21).toISOString();
  const mine = await db.list('punches', { eq: { user_id: me.id }, gte: { at: since }, order: 'at' });
  const days = computeDays(mine, now);
  const today = days[isoDate(now)] || { min: 0, list: [] };
  const present = isPresent(mine);
  const wk = startOfWeek(now);
  const weekMin = Object.entries(days).filter(([d]) => parseDate(d) >= wk).reduce((s, [, d]) => s + d.min, 0);
  const goal = (+session.company.week_hours || 42) * 60;
  const last = mine[mine.length - 1];

  el.innerHTML = `
    <div class="card hero">
      <div class="status"><span class="dot ${present ? 'in' : ''}"></span><div>
        <div class="big">${present ? 'Au travail' : 'Absent'}</div>
        <div class="mut">${last ? `Dernier pointage : ${last.type === 'in' ? 'arrivée' : 'départ'} ${isoDate(last.at) === isoDate(now) ? 'à' : 'le ' + fmtDay(last.at) + ' à'} ${fmtTime(last.at)}` : 'Aucun pointage pour l\'instant'}</div>
      </div></div>
      <button class="${present ? 'out' : 'in'} huge" id="punch">${present ? '⏹ Pointer mon départ' : '▶︎ Pointer mon arrivée'}</button>
    </div>
    <div class="tiles">
      <div class="card"><div class="mut">Aujourd'hui</div><div class="num" id="todayMin">${fmtMin(today.min)}</div></div>
      <div class="card"><div class="mut">Cette semaine</div><div class="num">${fmtMin(weekMin)}</div>
        <div class="bar ${weekMin > goal ? 'over' : ''}"><i style="width:${Math.min(100, weekMin / goal * 100)}%"></i></div><div class="mut small">Objectif ${fmtMin(goal)}</div></div>
    </div>
    <div id="team"></div>
    <div class="section-h"><h2>Mon historique</h2><button class="sm" id="add">＋ Pointage oublié</button></div>
    <div class="card" id="hist">${histHTML(days)}</div>`;

  $('#punch').onclick = async () => {
    $('#punch').disabled = true;
    try {
      await db.insert('punches', { user_id: me.id, type: present ? 'out' : 'in', at: new Date().toISOString() });
      toast(present ? 'Départ enregistré 👋' : 'Arrivée enregistrée ✅');
      ctx.refresh();
    } catch (e) { toast(e.message, 'err'); $('#punch').disabled = false; }
  };
  $('#add').onclick = () => editPunch(null, ctx, me.id);
  $$('[data-punch]', el).forEach(b => b.onclick = () => editPunch(mine.find(p => p.id === b.dataset.punch), ctx));
  if (present) timer = setInterval(() => { if (!ctx.alive()) return clearInterval(timer); $('#todayMin').textContent = fmtMin(computeDays(mine)[isoDate(new Date())]?.min); }, 30000);

  if (ctx.admin) await renderTeam($('#team'), ctx);
}

function histHTML(days) {
  const list = Object.entries(days).sort((a, b) => a[0] < b[0] ? 1 : -1).slice(0, 14);
  if (!list.length) return empty('Aucun pointage ces dernières semaines.');
  return list.map(([date, d]) => `<div class="day">
    <div class="between"><b>${fmtDay(date)}</b><span>${d.missing ? chip('Départ oublié', 'err') : ''} <b>${fmtMin(d.min)}</b></span></div>
    <div class="punches">${d.list.map(p => `<button class="pill p-${p.type}" data-punch="${p.id}">${p.type === 'in' ? '▶︎' : '⏹'} ${fmtTime(p.at)}</button>`).join('')}</div>
  </div>`).join('');
}

function editPunch(p, ctx, userId) {
  const d = p ? new Date(p.at) : new Date();
  const m = modal({
    title: p ? 'Modifier le pointage' : 'Ajouter un pointage oublié',
    body: `
      ${!p && ctx.admin ? `<label>Employé<select name="user_id">${session.members.map(x => `<option value="${x.id}" ${x.id === userId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>` : ''}
      <div class="grid2"><label>Date<input type="date" name="date" value="${isoDate(d)}" required></label>
      <label>Heure<input type="time" name="time" value="${timeInput(d)}" required></label></div>
      <label>Type<select name="type"><option value="in" ${p?.type === 'in' ? 'selected' : ''}>▶︎ Arrivée</option><option value="out" ${p?.type === 'out' ? 'selected' : ''}>⏹ Départ</option></select></label>`,
    footer: p ? '<button type="button" class="danger" id="del">Supprimer</button>' : '',
    onSubmit: async f => {
      const [y, mo, da] = f.date.split('-').map(Number), [h, mi] = f.time.split(':').map(Number);
      const at = new Date(y, mo - 1, da, h, mi).toISOString();
      if (p) await db.update('punches', p.id, { at, type: f.type });
      else await db.insert('punches', { user_id: f.user_id || userId, at, type: f.type });
      toast('Pointage enregistré'); ctx.refresh();
    },
  });
  $('#del', m.el)?.addEventListener('click', async () => {
    if (!confirm('Supprimer ce pointage ?')) return;
    await db.remove('punches', p.id); m.close(); toast('Pointage supprimé'); ctx.refresh();
  });
}

// ── Vue responsable ────────────────────────────────────────────
async function renderTeam(box, ctx) {
  const wk = addDays(startOfWeek(new Date()), weekOffset * 7), end = addDays(wk, 7);
  const todayStart = startOfDay(new Date());
  const from = wk < todayStart ? wk : todayStart;
  const all = await db.list('punches', { gte: { at: from.toISOString() }, lte: { at: (end > new Date() ? end : new Date()).toISOString() }, order: 'at' });
  const byUser = id => all.filter(p => p.user_id === id);
  const dates = [...Array(7)].map((_, i) => isoDate(addDays(wk, i)));
  const rows = session.members.map(m => {
    const days = computeDays(byUser(m.id).filter(p => p.at >= wk.toISOString() && p.at < end.toISOString()));
    const tot = dates.reduce((s, d) => s + (days[d]?.min || 0), 0);
    return { m, days, tot, present: isPresent(byUser(m.id)) };
  });
  const presentNow = rows.filter(r => r.present);

  box.innerHTML = `
    <div class="section-h"><h2>Équipe</h2><button class="sm" id="csv">⬇︎ Export du mois</button></div>
    <div class="card"><div class="mut">Présents maintenant</div>
      <div class="chips">${presentNow.length ? presentNow.map(r => chip('● ' + r.m.name, 'ok')).join('') : '<span class="mut">Personne</span>'}</div></div>
    <div class="card">
      <div class="weeknav"><button class="sm icon" id="prev">‹</button><b>Semaine du ${fmtDay(wk)}</b><button class="sm icon" id="next">›</button></div>
      <div class="scroll"><table class="tbl"><thead><tr><th>Employé</th>${dates.map(d => `<th class="n">${fmtDay(d)}</th>`).join('')}<th class="n">Total</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td>${esc(r.m.name)}</td>${dates.map(d => { const x = r.days[d]; return `<td class="n ${x?.missing ? 'bad' : ''}">${x ? fmtMin(x.min) : '<span class="mut">–</span>'}</td>`; }).join('')}<td class="n"><b>${fmtMin(r.tot)}</b></td></tr>`).join('')}</tbody></table></div>
      <p class="mut small">En rouge : départ non pointé. Pour corriger, ajoute le pointage manquant (bouton « Pointage oublié »).</p>
    </div>`;
  $('#prev').onclick = () => { weekOffset--; renderTeam(box, ctx); };
  $('#next').onclick = () => { weekOffset++; renderTeam(box, ctx); };
  $('#csv').onclick = () => exportMonth(wk);
}

async function exportMonth(ref) {
  const a = startOfMonth(ref), b = new Date(a.getFullYear(), a.getMonth() + 1, 1);
  const list = await db.list('punches', { gte: { at: a.toISOString() }, lte: { at: b.toISOString() }, order: 'at' });
  const rows = [['Employé', 'Date', 'Pointages', 'Heures (décimal)', 'Heures']];
  for (const m of session.members) {
    const days = computeDays(list.filter(p => p.user_id === m.id));
    let tot = 0;
    for (const [date, d] of Object.entries(days).sort()) {
      tot += d.min;
      rows.push([m.name, date, d.list.map(p => (p.type === 'in' ? 'A ' : 'D ') + fmtTime(p.at)).join(' / '), (d.min / 60).toFixed(2).replace('.', ','), fmtMin(d.min)]);
    }
    if (tot) rows.push([m.name, 'TOTAL', '', (tot / 60).toFixed(2).replace('.', ','), fmtMin(tot)]);
  }
  downloadCSV(`pointages-${isoDate(a).slice(0, 7)}.csv`, rows);
  toast(`Export de ${fmtMonth(a)} téléchargé`);
}

