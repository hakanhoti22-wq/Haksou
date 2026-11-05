// Module 1 — Pointage multi-employés.
import { db, session, team, memberName } from '../db.js';
import { createPDF, downloadFile } from '../pdf.js';
import { punchNow, pending, flush, cacheMine, cachedMine, isOffline, fetchOrFail } from '../punch.js';
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
  await flush();
  const waiting = pending();
  let fromServer, offline = false;
  try { fromServer = await fetchOrFail(db.list('punches', { eq: { user_id: me.id }, gte: { at: since }, order: 'at' })); cacheMine(fromServer); }
  catch (e) { if (!isOffline(e)) throw e; fromServer = cachedMine(); offline = true; }
  const mine = [...fromServer, ...waiting];
  const days = computeDays(mine, now);
  const today = days[isoDate(now)] || { min: 0, list: [] };
  const present = isPresent(mine);
  const wk = startOfWeek(now);
  const weekMin = Object.entries(days).filter(([d]) => parseDate(d) >= wk).reduce((s, [, d]) => s + d.min, 0);
  const goal = (+session.company.week_hours || 42) * 60;
  const last = mine[mine.length - 1];
  const canEdit = ctx.admin || session.company.punch_self_edit !== false;

  el.innerHTML = `
    ${session.support ? '<div class="card notice">🛟 Mode support : tu vois ici les heures de l\'équipe et le journal. Ton propre pointage n\'est pas proposé.</div>' : ''}
    <div class="card hero" ${session.support ? 'hidden' : ''}>
      <div class="status"><span class="dot ${present ? 'in' : ''}"></span><div>
        <div class="big">${present ? 'Au travail' : 'Absent'}</div>
        <div class="mut">${last ? `Dernier pointage : ${last.type === 'in' ? 'arrivée' : 'départ'} ${isoDate(last.at) === isoDate(now) ? 'à' : 'le ' + fmtDay(last.at) + ' à'} ${fmtTime(last.at)}` : 'Aucun pointage pour l\'instant'}</div>
      </div></div>
      <button class="${present ? 'out' : 'in'} huge" id="punch">${present ? '⏹ Pointer mon départ' : '▶︎ Pointer mon arrivée'}</button>
    </div>
    ${offline ? '<div class="card notice">📶 <b>Pas de connexion</b> : tu peux quand même pointer, l\'envoi se fera automatiquement.</div>' : ''}
    ${waiting.length ? `<div class="card notice">⏳ <b>${waiting.length} pointage${waiting.length > 1 ? 's' : ''} en attente d'envoi</b> (pas de réseau). ${waiting.length > 1 ? 'Ils partiront' : 'Il partira'} automatiquement dès le retour de la connexion : tu peux fermer l'appli.</div>` : ''}
    <div class="tiles">
      <div class="card"><div class="mut">Aujourd'hui</div><div class="num" id="todayMin">${fmtMin(today.min)}</div></div>
      <div class="card"><div class="mut">Cette semaine</div><div class="num">${fmtMin(weekMin)}</div>
        <div class="bar ${weekMin > goal ? 'over' : ''}"><i style="width:${Math.min(100, weekMin / goal * 100)}%"></i></div><div class="mut small">Objectif ${fmtMin(goal)}</div></div>
    </div>
    <div id="team"></div>
    <div class="section-h"><h2>Mon historique</h2>${canEdit ? '<button class="sm" id="add">＋ Pointage oublié</button>' : ''}</div>
    <div class="card" id="hist">${histHTML(days)}
      <p class="mut small">${canEdit ? 'Touche un pointage pour le corriger. ✎ = corrigé ou ajouté après coup : chaque correction est enregistrée avec son motif et visible par ton responsable.' : '🔒 Les corrections sont faites par ton responsable : signale-lui une erreur ou un oubli.'}</p></div>`;

  $('#punch').onclick = async () => {
    $('#punch').disabled = true;
    try {
      const r = await punchNow(present ? 'out' : 'in');
      toast((present ? 'Départ enregistré 👋' : 'Arrivée enregistrée ✅') + (r.queued ? ' · pas de réseau : envoi automatique dès le retour de la connexion' : ''), r.queued ? 'info' : 'ok');
      ctx.refresh();
    } catch (e) { toast(e.message, 'err'); $('#punch').disabled = false; }
  };
  $('#add')?.addEventListener('click', () => editPunch(null, ctx, me.id));
  if (canEdit) $$('[data-punch]', el).forEach(b => b.onclick = () => editPunch(mine.find(p => p.id === b.dataset.punch), ctx));
  if (present) timer = setInterval(() => { if (!ctx.alive()) return clearInterval(timer); $('#todayMin').textContent = fmtMin(computeDays(mine)[isoDate(new Date())]?.min); }, 30000);

  if (ctx.admin && !offline) await renderTeam($('#team'), ctx).catch(e => { if (!isOffline(e)) throw e; });
}

function histHTML(days) {
  const list = Object.entries(days).sort((a, b) => a[0] < b[0] ? 1 : -1).slice(0, 14);
  if (!list.length) return empty('Aucun pointage ces dernières semaines.');
  return list.map(([date, d]) => `<div class="day">
    <div class="between"><b>${fmtDay(date)}</b><span>${d.missing ? chip('Départ oublié', 'err') : ''} <b>${fmtMin(d.min)}</b></span></div>
    <div class="punches">${d.list.map(p => `<button class="pill p-${p.type}" ${p.pending ? 'disabled title="En attente d\'envoi"' : `data-punch="${p.id}"`} title="${p.manual || p.edited ? esc('Corrigé' + (p.note ? ' : ' + p.note : '')) : p.offline ? 'Pointé hors ligne' : ''}">${p.type === 'in' ? '▶︎' : '⏹'} ${fmtTime(p.at)}${p.manual || p.edited ? ' ✎' : ''}${p.pending ? ' ⏳' : p.offline ? ' 📶' : ''}</button>`).join('')}</div>
  </div>`).join('');
}

function editPunch(p, ctx, userId) {
  const d = p ? new Date(p.at) : new Date();
  const m = modal({
    title: p ? 'Corriger le pointage' : 'Ajouter un pointage oublié',
    body: `
      ${!p && ctx.admin ? `<label>Employé<select name="user_id">${session.members.map(x => `<option value="${x.id}" ${x.id === userId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>` : ''}
      ${p ? `<p class="mut small">Enregistré : ${p.type === 'in' ? 'arrivée' : 'départ'} le ${fmtDay(p.at)} à ${fmtTime(p.at)}${p.note ? ` · dernier motif : « ${esc(p.note)} »` : ''}</p>` : ''}
      <div class="grid2"><label>Date<input type="date" name="date" value="${isoDate(d)}" required></label>
      <label>Heure<input type="time" name="time" value="${timeInput(d)}" required></label></div>
      <label>Type<select name="type"><option value="in" ${p?.type === 'in' ? 'selected' : ''}>▶︎ Arrivée</option><option value="out" ${p?.type === 'out' ? 'selected' : ''}>⏹ Départ</option></select></label>
      <label>Motif *<input name="note" required placeholder="Ex. oubli de pointer, badge en panne, erreur…" maxlength="200"></label>
      <p class="mut small">📋 La correction et son motif sont enregistrés dans le journal${ctx.admin ? '' : ' que voit ton responsable'}.</p>`,
    footer: p ? '<button type="button" class="danger" id="del">Supprimer</button>' : '',
    onSubmit: async f => {
      const [y, mo, da] = f.date.split('-').map(Number), [h, mi] = f.time.split(':').map(Number);
      const at = new Date(y, mo - 1, da, h, mi).toISOString();
      if (p) {
        if (at === new Date(p.at).toISOString() && f.type === p.type) throw new Error('Rien n\'a changé.');
        await db.update('punches', p.id, { at, type: f.type, note: f.note });
      } else await db.insert('punches', { user_id: f.user_id || userId, at, type: f.type, note: f.note });
      toast('Correction enregistrée'); ctx.refresh();
    },
  });
  $('#del', m.el)?.addEventListener('click', async () => {
    const note = $('[name=note]', m.el).value.trim();
    if (!note) { $('[name=note]', m.el).focus(); return toast('Indique le motif de la suppression', 'err'); }
    if (!confirm('Supprimer ce pointage ? Il restera visible dans le journal.')) return;
    try { await db.update('punches', p.id, { deleted: true, note }); m.close(); toast('Pointage supprimé'); ctx.refresh(); }
    catch (e) { toast(e.message, 'err'); }
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
  const log = (await db.list('audit_log', { eq: { table_name: 'punches' }, order: 'at', asc: false })).slice(0, 40);

  box.innerHTML = `
    <div class="section-h"><h2>Équipe</h2><div class="row"><button class="sm" id="csv">⬇︎ CSV du mois</button><button class="sm" id="pdf">📄 Relevé d'heures du mois</button></div></div>
    <div class="card"><div class="mut">Présents maintenant</div>
      <div class="chips">${presentNow.length ? presentNow.map(r => chip('● ' + r.m.name, 'ok')).join('') : '<span class="mut">Personne</span>'}</div></div>
    <div class="card">
      <div class="weeknav"><button class="sm icon" id="prev">‹</button><b>Semaine du ${fmtDay(wk)}</b><button class="sm icon" id="next">›</button></div>
      <div class="scroll"><table class="tbl"><thead><tr><th>Employé</th>${dates.map(d => `<th class="n">${fmtDay(d)}</th>`).join('')}<th class="n">Total</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td>${esc(r.m.name)}</td>${dates.map(d => { const x = r.days[d]; return `<td class="n ${x?.missing ? 'bad' : ''}">${x ? fmtMin(x.min) : '<span class="mut">–</span>'}</td>`; }).join('')}<td class="n"><b>${fmtMin(r.tot)}</b></td></tr>`).join('')}</tbody></table></div>
      <p class="mut small">En rouge : départ non pointé. Pour corriger, ajoute le pointage manquant (bouton « Pointage oublié »).</p>
    </div>
    <div class="section-h"><h2>Journal des corrections</h2>
      <label class="check" style="margin:0"><input type="checkbox" id="selfEdit" ${session.company.punch_self_edit !== false ? 'checked' : ''}> Les employés peuvent corriger leurs pointages</label></div>
    <div class="card list compact">${log.length ? log.map(l => `<div class="item small"><div class="grow">
        <b>${esc(memberName(l.details?.user_id))}</b> · ${esc(logText(l))}${l.details?.note ? ` <span class="mut">· « ${esc(l.details.note)} »</span>` : ''}
        <div class="mut">${fmtDay(l.at)} ${fmtTime(l.at)} par ${esc(memberName(l.actor_id))}</div></div></div>`).join('')
      : empty('Aucune correction pour l\'instant. Les pointages ajoutés après coup, modifiés ou supprimés apparaîtront ici.')}</div>`;
  $('#prev').onclick = () => { weekOffset--; renderTeam(box, ctx); };
  $('#next').onclick = () => { weekOffset++; renderTeam(box, ctx); };
  $('#csv').onclick = () => exportMonth(wk);
  $('#pdf').onclick = () => monthReport(wk).catch(e => toast(e.message, 'err'));
  $('#selfEdit').onchange = async e => {
    try { await team.updateCompany({ punch_self_edit: e.target.checked }); toast(e.target.checked ? 'Les employés peuvent corriger (tout est enregistré)' : 'Seuls les responsables peuvent corriger'); }
    catch (err) { toast(err.message, 'err'); e.target.checked = !e.target.checked; }
  };
}

const TYPE = t => t === 'in' ? 'arrivée' : 'départ';
function logText(l) {
  const d = l.details || {};
  if (l.action === 'ajout') return `ajout ${TYPE(d.type)} ${fmtDay(d.at)} ${fmtTime(d.at)}`;
  if (l.action === 'suppression') return `suppression ${TYPE(d.type)} ${fmtDay(d.at)} ${fmtTime(d.at)}`;
  const t = d.type_avant !== d.type ? `${TYPE(d.type_avant)} → ${TYPE(d.type)}, ` : '';
  return `correction ${t}${fmtDay(d.at_avant)} ${fmtTime(d.at_avant)} → ${isoDate(d.at) !== isoDate(d.at_avant) ? fmtDay(d.at) + ' ' : ''}${fmtTime(d.at)}`;
}

/** Relevé d'heures mensuel en PDF (une ligne par jour et par employé). */
async function monthReport(ref) {
  const a = startOfMonth(ref), b = new Date(a.getFullYear(), a.getMonth() + 1, 1);
  const list = await db.list('punches', { gte: { at: a.toISOString() }, lte: { at: b.toISOString() }, order: 'at' });
  const p = await createPDF();
  p.header('Relevé d\'heures', [fmtMonth(a).replace(/^./, c => c.toUpperCase())]);
  const summary = [];
  for (const m of session.members) {
    const days = Object.entries(computeDays(list.filter(x => x.user_id === m.id))).sort();
    if (!days.length) continue;
    const tot = days.reduce((s, [, d]) => s + d.min, 0);
    summary.push([m.name, String(days.length), fmtMin(tot)]);
    p.ensure(30); p.text(m.name, { size: 12, bold: true, after: 1 });
    p.table([{ label: 'Jour', w: 38 }, { label: 'Pointages', w: '*' }, { label: 'Heures', w: 24, align: 'right' }],
      [...days.map(([date, d]) => [fmtDay(date), d.list.map(x => `${x.type === 'in' ? 'A' : 'D'} ${fmtTime(x.at)}${x.manual || x.edited ? '*' : ''}`).join('  ') + (d.missing ? '  (départ manquant)' : ''), fmtMin(d.min)]),
        { cells: ['Total', '', fmtMin(tot)], bold: true }]);
  }
  if (!summary.length) throw new Error('Aucun pointage ce mois-ci.');
  p.ensure(30); p.text('Récapitulatif', { size: 12, bold: true, after: 1 });
  p.table([{ label: 'Employé', w: '*' }, { label: 'Jours', w: 22, align: 'right' }, { label: 'Heures', w: 28, align: 'right' }], summary);
  p.text('A = arrivée · D = départ · * = pointage corrigé ou ajouté après coup (détail dans le journal des corrections).', { size: 8, color: [90, 90, 90] });
  downloadFile(p.finish(`releve-heures-${isoDate(a).slice(0, 7)}.pdf`));
}

async function exportMonth(ref) {
  const a = startOfMonth(ref), b = new Date(a.getFullYear(), a.getMonth() + 1, 1);
  const list = await db.list('punches', { gte: { at: a.toISOString() }, lte: { at: b.toISOString() }, order: 'at' });
  const rows = [['Employé', 'Date', 'Pointages', 'Heures (décimal)', 'Heures', 'Corrigé']];
  for (const m of session.members) {
    const days = computeDays(list.filter(p => p.user_id === m.id));
    let tot = 0;
    for (const [date, d] of Object.entries(days).sort()) {
      tot += d.min;
      rows.push([m.name, date, d.list.map(p => (p.type === 'in' ? 'A ' : 'D ') + fmtTime(p.at)).join(' / '), (d.min / 60).toFixed(2).replace('.', ','), fmtMin(d.min), d.list.some(p => p.manual || p.edited) ? 'oui' : '']);
    }
    if (tot) rows.push([m.name, 'TOTAL', '', (tot / 60).toFixed(2).replace('.', ','), fmtMin(tot)]);
  }
  downloadCSV(`pointages-${isoDate(a).slice(0, 7)}.csv`, rows);
  toast(`Export de ${fmtMonth(a)} téléchargé`);
}

