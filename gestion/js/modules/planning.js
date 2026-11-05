// Module 3 — Planning d'équipe (semaine).
import { db, session } from '../db.js';
import { $, $$, esc, isoDate, addDays, startOfWeek, fmtDay, hhmmToMin, fmtMin, modal, toast } from '../utils.js';
import { createPDF, downloadFile } from '../pdf.js';

let offset = 0;
const dur = s => { let d = hhmmToMin(s.end_time) - hhmmToMin(s.start_time); if (d < 0) d += 1440; return d; };

export async function render(el, ctx) {
  const wk = addDays(startOfWeek(new Date()), offset * 7);
  const dates = [...Array(7)].map((_, i) => isoDate(addDays(wk, i)));
  const [shifts, leaves] = await Promise.all([
    db.list('shifts', { gte: { date: dates[0] }, lte: { date: dates[6] }, order: 'start_time' }),
    session.company.modules.includes('conges') ? db.list('leaves', { eq: { status: 'approuve' }, lte: { start_date: dates[6] } }) : [],
  ]);
  const me = session.profile, today = isoDate();
  const off = (uid, d) => leaves.find(l => l.user_id === uid && l.start_date <= d && l.end_date >= d);
  const members = [...session.members].sort((a, b) => (b.id === me.id) - (a.id === me.id));

  el.innerHTML = `
    <div class="toolbar">
      <div class="weeknav"><button class="sm icon" id="prev">‹</button><b>Semaine du ${fmtDay(wk)}</b><button class="sm icon" id="next">›</button></div>
      <span class="grow"></span>
      ${offset ? '<button class="sm ghost" id="now">Aujourd\'hui</button>' : ''}
      ${ctx.admin ? '<button class="sm" id="copy">⧉ Copier la semaine précédente</button>' : ''}
      <button class="sm" id="pdf">📄 PDF</button>
    </div>
    <div class="card scroll"><table class="tbl plan"><thead><tr><th>Employé</th>${dates.map(d => `<th class="${d === today ? 'today' : ''}">${fmtDay(d)}</th>`).join('')}<th class="n">Total</th></tr></thead>
    <tbody>${members.map(m => {
      const mine = shifts.filter(s => s.user_id === m.id);
      return `<tr class="${m.id === me.id ? 'mine' : ''}"><td><b>${esc(m.name)}</b></td>${dates.map(d => {
        const l = off(m.id, d);
        return `<td class="cell ${d === today ? 'today' : ''} ${ctx.admin ? 'click' : ''}" data-u="${m.id}" data-d="${d}">
          ${l ? `<div class="shift leave">🌴 ${esc(l.kind)}</div>` : ''}
          ${mine.filter(s => s.date === d).map(s => `<div class="shift" data-s="${s.id}" title="${esc(s.note || '')}">${s.start_time}–${s.end_time}${s.note ? `<small>${esc(s.note)}</small>` : ''}</div>`).join('')}
        </td>`;
      }).join('')}<td class="n"><b>${fmtMin(mine.reduce((t, s) => t + dur(s), 0))}</b></td></tr>`;
    }).join('')}</tbody></table></div>
    <p class="mut small">${ctx.admin ? 'Touche une case pour ajouter un horaire, ou un horaire pour le modifier.' : 'Ta ligne est en surbrillance. Seul un responsable peut modifier le planning.'}</p>`;

  $('#prev').onclick = () => { offset--; ctx.refresh(); };
  $('#next').onclick = () => { offset++; ctx.refresh(); };
  $('#now')?.addEventListener('click', () => { offset = 0; ctx.refresh(); });
  $('#pdf').onclick = async () => {
    try {
      const p = await createPDF({ landscape: true });
      p.header('Planning', [`Semaine du ${fmtDay(wk)} au ${fmtDay(dates[6])}`]);
      p.table([{ label: 'Employé', w: 38 }, ...dates.map(d => ({ label: fmtDay(d), w: '*' })), { label: 'Total', w: 18, align: 'right' }],
        members.map(m => {
          const mine = shifts.filter(s => s.user_id === m.id);
          return [m.name, ...dates.map(d => [off(m.id, d) ? 'Congé : ' + off(m.id, d).kind : '', ...mine.filter(s => s.date === d).map(s => `${s.start_time}-${s.end_time}${s.note ? ' ' + s.note : ''}`)].filter(Boolean).join('\n')),
            fmtMin(mine.reduce((t, s) => t + dur(s), 0))];
        }), { size: 8.5 });
      downloadFile(p.finish(`planning-${dates[0]}.pdf`));
    } catch (e) { toast(e.message, 'err'); }
  };
  if (!ctx.admin) return;

  $$('.cell', el).forEach(c => c.onclick = e => {
    const s = e.target.closest('[data-s]');
    edit(s ? shifts.find(x => x.id === s.dataset.s) : { user_id: c.dataset.u, date: c.dataset.d }, ctx);
  });
  $('#copy').onclick = async () => {
    const prev = await db.list('shifts', { gte: { date: isoDate(addDays(wk, -7)) }, lte: { date: isoDate(addDays(wk, -1)) } });
    if (!prev.length) return toast('La semaine précédente est vide', 'err');
    if (shifts.length && !confirm('Cette semaine contient déjà des horaires. Ajouter quand même ceux de la semaine précédente ?')) return;
    for (const s of prev) await db.insert('shifts', { user_id: s.user_id, date: isoDate(addDays(new Date(s.date + 'T12:00'), 7)), start_time: s.start_time, end_time: s.end_time, note: s.note });
    toast(`${prev.length} horaires copiés`); ctx.refresh();
  };
}

function edit(s, ctx) {
  const last = JSON.parse(localStorage.getItem('haksou-last-shift') || '{"start":"08:00","end":"17:00"}');
  const m = modal({
    title: s.id ? 'Modifier l\'horaire' : 'Nouvel horaire',
    body: `
      <label>Employé<select name="user_id">${session.members.map(x => `<option value="${x.id}" ${x.id === s.user_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      <label>Date<input type="date" name="date" value="${s.date}" required></label>
      <div class="grid2"><label>Début<input type="time" name="start" value="${s.start_time || last.start}" required></label><label>Fin<input type="time" name="end" value="${s.end_time || last.end}" required></label></div>
      <label>Note / poste<input name="note" value="${esc(s.note || '')}" placeholder="Ex. Caisse, Chantier Bulle…"></label>
      ${s.id ? '' : '<label class="check"><input type="checkbox" name="week"> Répéter du lundi au vendredi</label>'}`,
    footer: s.id ? '<button type="button" class="danger" id="del">Supprimer</button>' : '',
    onSubmit: async f => {
      localStorage.setItem('haksou-last-shift', JSON.stringify({ start: f.start, end: f.end }));
      const data = { user_id: f.user_id, date: f.date, start_time: f.start, end_time: f.end, note: f.note };
      if (s.id) await db.update('shifts', s.id, data);
      else if (f.week) {
        const mon = startOfWeek(new Date(f.date + 'T12:00'));
        for (let i = 0; i < 5; i++) await db.insert('shifts', { ...data, date: isoDate(addDays(mon, i)) });
      } else await db.insert('shifts', data);
      toast('Planning mis à jour'); ctx.refresh();
    },
  });
  $('#del', m.el)?.addEventListener('click', async () => { await db.remove('shifts', s.id); m.close(); toast('Horaire supprimé'); ctx.refresh(); });
}
