// Point d'entrée : connexion, menu et navigation entre les modules.
import { DEMO, auth, session, isAdmin } from './db.js';
import { MODULES } from './meta.js';
import { $, $$, esc, toast } from './utils.js';

const app = $('#app');
const loaders = {
  accueil: () => import('./modules/accueil.js'),
  pointage: () => import('./modules/pointage.js'),
  conges: () => import('./modules/conges.js'),
  planning: () => import('./modules/planning.js'),
  interventions: () => import('./modules/interventions.js'),
  factures: () => import('./modules/factures.js'),
  clients: () => import('./modules/clients.js'),
  stock: () => import('./modules/stock.js'),
  frais: () => import('./modules/frais.js'),
  equipe: () => import('./modules/equipe.js'),
  reglages: () => import('./modules/reglages.js'),
};

function menu() {
  const on = session.company?.modules || [];
  return [
    { id: 'accueil', icon: '🏠', label: 'Accueil' },
    ...MODULES.filter(m => on.includes(m.id)),
    ...(isAdmin() ? [{ id: 'equipe', icon: '🧑‍🤝‍🧑', label: 'Équipe' }] : []),
    { id: 'reglages', icon: '⚙️', label: 'Réglages' },
  ];
}

// ── Écrans de connexion ────────────────────────────────────────
function loginDemo() {
  const users = auth.demoUsers().filter(u => u.company_id);
  app.innerHTML = `<div class="auth"><div class="auth-card">
    <div class="logo">H</div><h1>Haksou Pro</h1>
    <p class="mut">Mode démo : les données restent dans ce navigateur. Choisis qui tu veux être pour tester l'appli.</p>
    <div class="stack">${users.map(u => `<button class="user-btn" data-id="${u.id}"><b>${esc(u.name)}</b><span>${u.role === 'admin' ? 'Patron · voit tout' : 'Employé'}</span></button>`).join('')}</div>
    <button class="ghost sm" id="reset" style="margin-top:18px">↺ Réinitialiser les données de démo</button>
  </div></div>`;
  $$('.user-btn').forEach(b => b.onclick = async () => { await auth.demoLogin(b.dataset.id); start(); });
  $('#reset').onclick = () => { if (confirm('Effacer toutes les données de démo et repartir de zéro ?')) { auth.resetDemo(); loginDemo(); } };
}

function loginRemote(mode = 'login') {
  app.innerHTML = `<div class="auth"><form class="auth-card" id="f">
    <div class="logo">H</div><h1>Haksou Pro</h1>
    <div class="seg"><button type="button" data-m="login" class="${mode === 'login' ? 'on' : ''}">Connexion</button><button type="button" data-m="signup" class="${mode === 'signup' ? 'on' : ''}">Créer un compte</button></div>
    <label>E-mail<input name="email" type="email" autocomplete="email" required></label>
    <label>Mot de passe<input name="password" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" minlength="6" required></label>
    <button class="primary" type="submit">${mode === 'login' ? 'Se connecter' : 'Créer mon compte'}</button>
    ${mode === 'login' ? '<button type="button" class="ghost sm" id="forgot">Mot de passe oublié ?</button>' : ''}
    <p class="mut small" id="msg"></p>
  </form></div>`;
  $$('[data-m]').forEach(b => b.onclick = () => loginRemote(b.dataset.m));
  const f = $('#f');
  $('#forgot')?.addEventListener('click', async () => {
    if (!f.email.value) return toast('Indique ton e-mail', 'err');
    try { await auth.resetPassword(f.email.value); $('#msg').textContent = 'E-mail de réinitialisation envoyé.'; } catch (e) { toast(e.message, 'err'); }
  });
  f.onsubmit = async e => {
    e.preventDefault();
    const btn = $('[type=submit]', f); btn.disabled = true;
    try {
      if (mode === 'login') { await auth.signIn(f.email.value, f.password.value); start(); }
      else if (await auth.signUp(f.email.value, f.password.value)) start();
      else $('#msg').textContent = '✉️ Compte créé ! Clique sur le lien reçu par e-mail, puis reviens te connecter.';
    } catch (err) { toast(err.message, 'err'); }
    btn.disabled = false;
  };
}

function onboarding() {
  app.innerHTML = `<div class="auth"><div class="auth-card wide">
    <div class="logo">H</div><h1>Bienvenue !</h1>
    <p class="mut">Dernière étape : crée ton entreprise, ou rejoins celle de ton employeur avec son code.</p>
    <label>Ton nom (visible par l'équipe)<input id="me" placeholder="Prénom Nom" value="${esc(session.profile?.name || '')}"></label>
    <div class="grid2">
      <form class="card" id="create"><h3>🏢 Créer mon entreprise</h3><p class="mut small">Tu seras le responsable (patron).</p>
        <input name="name" placeholder="Nom de l'entreprise" required><button class="primary" type="submit">Créer</button></form>
      <form class="card" id="join"><h3>🔑 Rejoindre une entreprise</h3><p class="mut small">Demande le code à ton responsable.</p>
        <input name="code" placeholder="Code (ex. AB12CD)" required style="text-transform:uppercase"><button type="submit">Rejoindre</button></form>
    </div>
    <button class="ghost sm" id="out">Se déconnecter</button>
  </div></div>`;
  const name = () => { const v = $('#me').value.trim(); if (!v) { $('#me').focus(); throw new Error('Indique ton nom'); } return v; };
  $('#create').onsubmit = async e => { e.preventDefault(); try { await auth.createCompany(e.target.name.value.trim(), name()); start(); } catch (err) { toast(err.message, 'err'); } };
  $('#join').onsubmit = async e => { e.preventDefault(); try { await auth.joinCompany(e.target.code.value.trim().toUpperCase(), name()); start(); } catch (err) { toast(err.message, 'err'); } };
  $('#out').onclick = async () => { await auth.signOut(); start(); };
}

// ── Application ────────────────────────────────────────────────
function shell() {
  app.innerHTML = `
    <aside id="nav">
      <div class="brand"><div class="logo sm">H</div><div><b>Haksou Pro</b><small>${esc(session.company.name)}</small></div></div>
      <nav id="links"></nav>
      <div class="me"><b>${esc(session.profile.name)}</b><small>${isAdmin() ? 'Responsable' : 'Employé'}${DEMO ? ' · démo' : ''}</small></div>
    </aside>
    <div id="scrim"></div>
    <main>
      <header class="top"><button class="icon" id="menuBtn" aria-label="Menu">☰</button><h1 id="title"></h1>${DEMO ? '<a class="chip info" href="#/reglages">Démo</a>' : ''}</header>
      <div id="view"></div>
    </main>`;
  $('#menuBtn').onclick = () => document.body.classList.toggle('nav-open');
  $('#scrim').onclick = () => document.body.classList.remove('nav-open');
  drawMenu();
}
function drawMenu() {
  $('#links').innerHTML = menu().map(m => `<a href="#/${m.id}" data-id="${m.id}"><span>${m.icon}</span>${esc(m.label)}</a>`).join('');
}

let token = 0;
async function route(keep) {
  keep = keep === true;
  if (!session.company) return;
  const [id, ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  const items = menu();
  const m = items.find(x => x.id === id) || items[0];
  if (m.id !== id) { history.replaceState(null, '', '#/' + m.id); }
  document.body.classList.remove('nav-open');
  $$('#links a').forEach(a => a.classList.toggle('on', a.dataset.id === m.id));
  $('#title').textContent = m.label;
  document.title = `${m.label} · Haksou Pro`;
  const view = $('#view'), my = ++token;
  const y = window.scrollY;
  if (!keep) view.innerHTML = '<div class="loading">Chargement…</div>';
  try {
    const mod = await loaders[m.id]();
    if (my !== token) return;
    const ctx = {
      admin: isAdmin(), param: rest.join('/') || null,
      go: h => { location.hash = h; },
      refresh: () => route(true),
      reloadMenu: () => { shell(); route(); },
      alive: () => my === token,
    };
    if (keep) view.style.minHeight = view.offsetHeight + 'px';
    view.innerHTML = '';
    await mod.render(view, ctx);
    view.style.minHeight = '';
    if (keep) window.scrollTo(0, y);
    if (my === token && !keep) window.scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    if (my === token) view.innerHTML = `<div class="card err-box"><b>Oups, une erreur est survenue.</b><p class="mut">${esc(e.message || e)}</p><button id="retry">Réessayer</button></div>`;
    $('#retry')?.addEventListener('click', () => route());
  }
}

async function start() {
  if (!session.profile) return DEMO ? loginDemo() : loginRemote();
  if (!session.company) return onboarding();
  shell();
  route();
}

window.addEventListener('hashchange', route);
window.addEventListener('haksou:logout', async () => { await auth.signOut(); location.hash = ''; start(); });

(async () => {
  try { await auth.init(); }
  catch (e) { console.error(e); app.innerHTML = `<div class="auth"><div class="auth-card"><h1>Connexion impossible</h1><p class="mut">${esc(e.message)}</p><button onclick="location.reload()">Réessayer</button></div></div>`; return; }
  start();
})();

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
