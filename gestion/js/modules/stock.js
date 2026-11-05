// Module 6 — Stock : articles, entrées/sorties, alertes, scan de code-barres.
import { db, session, memberName } from '../db.js';
import { $, $$, esc, fmtDate, fmtTime, money, modal, toast, chip, empty, downloadCSV, isoDate } from '../utils.js';

let q = '', onlyLow = false;
const cur = () => session.company.currency || 'CHF';
const low = i => +i.qty <= +i.min_qty;

export async function render(el, ctx) {
  const items = await db.list('items', { order: 'name' });
  const alerts = items.filter(low);
  const value = items.reduce((s, i) => s + (+i.qty || 0) * (+i.price || 0), 0);

  el.innerHTML = `
    <div class="tiles three">
      <div class="card"><div class="mut">Articles</div><div class="num">${items.length}</div></div>
      <div class="card click" id="alerts"><div class="mut">Stock bas</div><div class="num ${alerts.length ? 'bad' : 'good'}">${alerts.length}</div></div>
      <div class="card"><div class="mut">Valeur du stock</div><div class="num">${money(value, cur())}</div></div>
    </div>
    <div class="toolbar">
      <input type="search" id="q" placeholder="🔍 Nom, référence, code-barres…" value="${esc(q)}">
      <button id="scan">📷 Scanner</button><button class="primary" id="new">＋ Article</button>
    </div>
    <div class="row" style="margin-bottom:8px"><label class="check"><input type="checkbox" id="low" ${onlyLow ? 'checked' : ''}> Seulement le stock bas</label><span class="grow"></span><button class="sm ghost" id="csv">⬇︎ Inventaire CSV</button></div>
    <div class="card list" id="list"></div>`;

  const draw = () => {
    const s = q.toLowerCase();
    const list = items.filter(i => (!onlyLow || low(i)) && (!s || [i.name, i.ref, i.barcode].join(' ').toLowerCase().includes(s)));
    $('#list', el).innerHTML = list.length ? list.map(i => `<div class="item">
      <div class="grow click" data-edit="${i.id}"><b>${esc(i.name)}</b> ${low(i) ? chip('Stock bas', 'err') : ''}
        <div class="mut small">${[i.ref, i.barcode && '▥ ' + i.barcode, money(i.price, cur()) + ' / ' + (i.unit || 'pce')].filter(Boolean).map(esc).join(' · ')}</div></div>
      <div class="qty ${low(i) ? 'bad' : ''}"><b>${+i.qty}</b><small>${esc(i.unit || 'pce')} · min ${+i.min_qty}</small></div>
      <div class="row nowrap"><button class="sm icon" data-out="${i.id}" title="Sortie">−</button><button class="sm icon" data-in="${i.id}" title="Entrée">＋</button></div>
    </div>`).join('') : empty(items.length ? 'Aucun article trouvé.' : 'Aucun article. Ajoute ton premier article !');
    $$('[data-edit]', el).forEach(b => b.onclick = () => editItem(items.find(i => i.id === b.dataset.edit), ctx));
    $$('[data-in]', el).forEach(b => b.onclick = () => move(items.find(i => i.id === b.dataset.in), 1, ctx));
    $$('[data-out]', el).forEach(b => b.onclick = () => move(items.find(i => i.id === b.dataset.out), -1, ctx));
  };
  draw();
  $('#q', el).oninput = e => { q = e.target.value; draw(); };
  $('#low', el).onchange = e => { onlyLow = e.target.checked; draw(); };
  $('#alerts', el).onclick = () => { onlyLow = true; $('#low', el).checked = true; draw(); };
  $('#new', el).onclick = () => editItem(null, ctx);
  $('#csv', el).onclick = () => downloadCSV(`inventaire-${isoDate()}.csv`, [['Article', 'Référence', 'Code-barres', 'Quantité', 'Unité', 'Minimum', 'Prix', 'Valeur'],
    ...items.map(i => [i.name, i.ref, i.barcode, i.qty, i.unit, i.min_qty, i.price, round(i.qty * i.price)])]);
  $('#scan', el).onclick = () => scan(code => {
    const it = items.find(i => i.barcode === code || i.ref === code);
    if (it) move(it, -1, ctx, 'Article trouvé : ' + it.name);
    else if (confirm(`Code ${code} inconnu. Créer un nouvel article ?`)) editItem({ barcode: code }, ctx);
  });
}
const round = v => Math.round((+v || 0) * 100) / 100;

function move(it, sign, ctx, title) {
  modal({
    title: title || (sign > 0 ? `Entrée : ${it.name}` : `Sortie : ${it.name}`),
    body: `<p class="mut">En stock : <b>${+it.qty} ${esc(it.unit || 'pce')}</b></p>
      <div class="seg" id="dir"><button type="button" data-s="-1" class="${sign < 0 ? 'on' : ''}">− Sortie</button><button type="button" data-s="1" class="${sign > 0 ? 'on' : ''}">＋ Entrée</button></div>
      <input type="hidden" name="sign" value="${sign}">
      <label>Quantité<input type="number" name="qty" min="0" step="any" value="1" required inputmode="decimal"></label>
      <label>Motif<input name="reason" placeholder="${sign > 0 ? 'Livraison fournisseur…' : 'Chantier, client, casse…'}"></label>`,
    submit: 'Valider',
    onMount: w => $$('[data-s]', w).forEach(b => b.onclick = () => { $$('[data-s]', w).forEach(x => x.classList.toggle('on', x === b)); w.querySelector('[name=sign]').value = b.dataset.s; }),
    onSubmit: async f => {
      const delta = (+f.sign) * Math.abs(+f.qty);
      if (!delta) throw new Error('Indique une quantité');
      const fresh = await db.get('items', it.id);
      const qty = round(+fresh.qty + delta);
      if (qty < 0 && !confirm(`Le stock deviendra négatif (${qty}). Continuer ?`)) return false;
      await db.update('items', it.id, { qty });
      await db.insert('movements', { item_id: it.id, user_id: session.profile.id, delta, reason: f.reason, at: new Date().toISOString() });
      toast(`${it.name} : ${qty} ${it.unit || 'pce'}${qty <= +it.min_qty ? ' ⚠️ stock bas' : ''}`, qty <= +it.min_qty ? 'info' : 'ok');
      ctx.refresh();
    },
  });
}

async function editItem(it, ctx) {
  const moves = it?.id ? (await db.list('movements', { eq: { item_id: it.id }, order: 'at', asc: false })).slice(0, 15) : [];
  const m = modal({
    title: it?.id ? it.name : 'Nouvel article',
    body: `
      <label>Nom *<input name="name" value="${esc(it?.name)}" required></label>
      <div class="grid2"><label>Référence<input name="ref" value="${esc(it?.ref)}"></label>
      <label>Code-barres<div class="row nowrap"><input name="barcode" value="${esc(it?.barcode)}" class="grow"><button type="button" class="sm" id="scanB">📷</button></div></label>
      ${it?.id ? '' : `<label>Quantité initiale<input type="number" step="any" name="qty" value="0"></label>`}
      <label>Stock minimum (alerte)<input type="number" step="any" name="min_qty" value="${it?.min_qty ?? 0}"></label>
      <label>Unité<input name="unit" value="${esc(it?.unit || 'pce')}" list="units"></label>
      <label>Prix de vente (${cur()})<input type="number" step="0.05" name="price" value="${it?.price ?? 0}"></label></div>
      <datalist id="units"><option>pce</option><option>m</option><option>kg</option><option>l</option><option>sachet</option><option>carton</option><option>h</option></datalist>
      ${it?.id ? `<h4>Derniers mouvements</h4><div class="list compact">${moves.length ? moves.map(x => `<div class="item"><span class="grow small">${fmtDate(x.at)} ${fmtTime(x.at)} · ${esc(memberName(x.user_id))}${x.reason ? ' · ' + esc(x.reason) : ''}</span><b class="${x.delta < 0 ? 'bad' : 'good'}">${x.delta > 0 ? '+' : ''}${x.delta}</b></div>`).join('') : '<p class="mut small">Aucun mouvement.</p>'}</div>` : ''}`,
    footer: it?.id ? '<button type="button" class="danger" id="del">Supprimer</button>' : '',
    onMount: w => { $('#scanB', w).onclick = () => scan(code => { w.querySelector('[name=barcode]').value = code; }); },
    onSubmit: async f => {
      const data = { name: f.name, ref: f.ref, barcode: f.barcode, unit: f.unit, min_qty: +f.min_qty || 0, price: +f.price || 0 };
      if (it?.id) await db.update('items', it.id, data);
      else {
        const n = await db.insert('items', { ...data, qty: +f.qty || 0 });
        if (+f.qty) await db.insert('movements', { item_id: n.id, user_id: session.profile.id, delta: +f.qty, reason: 'Stock initial', at: new Date().toISOString() });
      }
      toast('Article enregistré'); ctx.refresh();
    },
  });
  $('#del', m.el)?.addEventListener('click', async () => {
    if (!confirm(`Supprimer « ${it.name} » ?`)) return;
    for (const x of await db.list('movements', { eq: { item_id: it.id } })) await db.remove('movements', x.id);
    await db.remove('items', it.id); m.close(); toast('Article supprimé'); ctx.refresh();
  });
}

/** Scanner de code-barres par la caméra (avec saisie manuelle en secours). */
export function scan(onCode) {
  let stop = () => {}, done = false;
  const finish = code => { if (done) return; done = true; stop(); m.close(); navigator.vibrate?.(80); onCode(code); };
  const m = modal({
    title: 'Scanner un code-barres',
    body: `<div class="scanner"><video id="vid" playsinline muted></video><div class="aim"></div></div>
      <p class="mut small" id="scanMsg">Démarrage de la caméra…</p>
      <div class="row nowrap"><input id="manual" placeholder="…ou tape le code" inputmode="numeric" class="grow"><button type="button" id="ok">OK</button></div>`,
    onMount: async w => {
      $('#ok', w).onclick = () => { const v = $('#manual', w).value.trim(); if (v) finish(v); };
      $('#manual', w).onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); $('#ok', w).click(); } };
      const video = $('#vid', w), msg = $('#scanMsg', w);
      new MutationObserver((_, o) => { if (!w.isConnected) { stop(); o.disconnect(); } }).observe(document.body, { childList: true });
      try {
        if ('BarcodeDetector' in window) {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
          stop = () => stream.getTracks().forEach(t => t.stop());
          if (!w.isConnected) return stop();
          video.srcObject = stream; await video.play();
          const det = new BarcodeDetector();
          msg.textContent = 'Vise le code-barres.';
          const loop = async () => {
            if (done || !w.isConnected) return;
            try { const r = await det.detect(video); if (r[0]) return finish(r[0].rawValue); } catch { /* image pas prête */ }
            requestAnimationFrame(loop);
          };
          loop();
        } else {
          const { BrowserMultiFormatReader } = await import('https://esm.sh/@zxing/browser@0.1.5');
          if (!w.isConnected) return;
          const controls = await new BrowserMultiFormatReader().decodeFromVideoDevice(undefined, video, r => { if (r) finish(r.getText()); });
          stop = () => controls.stop();
          if (!w.isConnected) stop();
          msg.textContent = 'Vise le code-barres.';
        }
      } catch (e) {
        console.warn(e);
        msg.textContent = 'Caméra indisponible (autorise l\'accès à la caméra) : tape le code à la main.';
      }
    },
  });
}
