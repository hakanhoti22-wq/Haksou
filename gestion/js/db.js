// Couche de données : même interface en mode démo (localStorage) et avec Supabase.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { buildSeed } from './seed.js';

export const DEMO = !SUPABASE_URL || !SUPABASE_ANON_KEY;

/** Session courante : profil connecté, entreprise et membres de l'équipe. */
export const session = { profile: null, company: null, members: [] };
export const isAdmin = () => session.profile?.role === 'admin';
export const memberName = id => session.members.find(m => m.id === id)?.name || '—';

const LS = 'haksou-pro-db', LS_USER = 'haksou-pro-demo-user';
/** Tables où un employé ne voit que ses propres lignes (le patron voit tout). */
const OWNED = new Set(['punches', 'leaves', 'expenses']);
const newId = () => crypto.randomUUID?.() || 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
const clone = o => JSON.parse(JSON.stringify(o));

let sb = null, mem = null;

// ── Mode démo ──────────────────────────────────────────────────
function load() {
  if (mem) return mem;
  try { mem = JSON.parse(localStorage.getItem(LS)); } catch { mem = null; }
  if (!mem) { mem = buildSeed(newId); save(); }
  return mem;
}
function save() {
  try { localStorage.setItem(LS, JSON.stringify(mem)); }
  catch { throw new Error('Mémoire du navigateur pleine : supprime des photos ou passe sur Supabase.'); }
}
function filter(rows, o = {}) {
  let r = rows.filter(x => {
    for (const [k, v] of Object.entries(o.eq || {})) if (x[k] !== v) return false;
    for (const [k, v] of Object.entries(o.gte || {})) if (x[k] == null || x[k] < v) return false;
    for (const [k, v] of Object.entries(o.lte || {})) if (x[k] == null || x[k] > v) return false;
    return true;
  });
  if (o.order) {
    const k = o.order, dir = o.asc === false ? -1 : 1;
    r = [...r].sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * dir);
  }
  return r;
}

const local = {
  async list(t, o) {
    const cid = session.company?.id;
    let rows = (load()[t] || []).filter(r => t === 'companies' ? r.id === cid : r.company_id === cid);
    // Même règle que la sécurité Supabase : un employé voit ses lignes (et les congés approuvés de l'équipe).
    if (OWNED.has(t) && !isAdmin()) rows = rows.filter(r => r.user_id === session.profile.id || (t === 'leaves' && r.status === 'approuve'));
    return clone(filter(rows, o));
  },
  async get(t, id) { return (await this.list(t)).find(r => r.id === id) || null; },
  async insert(t, obj) {
    const d = load();
    const row = { id: newId(), created_at: new Date().toISOString(), company_id: session.company?.id, ...obj };
    if (OWNED.has(t) && !row.user_id) row.user_id = session.profile.id;
    (d[t] ||= []).push(row); save();
    return clone(row);
  },
  async update(t, id, patch) {
    const r = (load()[t] || []).find(x => x.id === id);
    if (!r) throw new Error('Élément introuvable');
    Object.assign(r, patch); save();
    return clone(r);
  },
  async remove(t, id) { const d = load(); d[t] = (d[t] || []).filter(x => x.id !== id); save(); },
};

// ── Supabase ───────────────────────────────────────────────────
const fr = e => {
  const m = e?.message || String(e);
  const map = {
    'Invalid login credentials': 'E-mail ou mot de passe incorrect.',
    'User already registered': 'Un compte existe déjà avec cet e-mail.',
    'Email not confirmed': 'Confirme d\'abord ton e-mail (regarde ta boîte de réception).',
    'Password should be at least 6 characters': 'Le mot de passe doit faire au moins 6 caractères.',
  };
  return new Error(Object.entries(map).find(([k]) => m.includes(k))?.[1] || m);
};
const ok = ({ data, error }) => { if (error) throw fr(error); return data; };

const remote = {
  async list(t, o = {}) {
    let q = sb.from(t).select('*');
    if (t !== 'companies') q = q.eq('company_id', session.company.id);
    for (const [k, v] of Object.entries(o.eq || {})) q = q.eq(k, v);
    for (const [k, v] of Object.entries(o.gte || {})) q = q.gte(k, v);
    for (const [k, v] of Object.entries(o.lte || {})) q = q.lte(k, v);
    if (o.order) q = q.order(o.order, { ascending: o.asc !== false });
    return ok(await q);
  },
  async get(t, id) { return ok(await sb.from(t).select('*').eq('id', id).maybeSingle()); },
  async insert(t, obj) { return ok(await sb.from(t).insert({ company_id: session.company.id, ...obj }).select().single()); },
  async update(t, id, patch) { return ok(await sb.from(t).update(patch).eq('id', id).select().single()); },
  async remove(t, id) { ok(await sb.from(t).delete().eq('id', id)); },
};

/** db.list(table, {eq, gte, lte, order, asc}) · get · insert · update · remove */
export const db = DEMO ? local : remote;

// ── Connexion ──────────────────────────────────────────────────
async function setProfile(p) {
  session.profile = p || null;
  session.company = null; session.members = [];
  if (!p?.company_id) return;
  session.company = DEMO ? clone(load().companies.find(c => c.id === p.company_id))
    : ok(await sb.from('companies').select('*').eq('id', p.company_id).single());
  await refreshMembers();
}
export async function refreshMembers() { session.members = await db.list('profiles', { order: 'name' }); }

export const auth = {
  user: null,
  async init() {
    if (DEMO) {
      const id = localStorage.getItem(LS_USER);
      await setProfile(load().profiles.find(p => p.id === id));
      return;
    }
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data } = await sb.auth.getSession();
    if (data.session) await this.loadProfile(data.session.user);
  },
  async loadProfile(user) {
    this.user = user;
    await setProfile(ok(await sb.from('profiles').select('*').eq('id', user.id).maybeSingle()));
  },
  // démo
  demoUsers: () => load().profiles,
  async demoLogin(id) { localStorage.setItem(LS_USER, id); await setProfile(load().profiles.find(p => p.id === id)); },
  resetDemo() { localStorage.removeItem(LS); localStorage.removeItem(LS_USER); mem = null; },
  // supabase
  async signIn(email, password) { const d = ok(await sb.auth.signInWithPassword({ email, password })); await this.loadProfile(d.user); },
  async signUp(email, password) {
    const d = ok(await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.href.split('#')[0] } }));
    if (d.session) { await this.loadProfile(d.user); return true; }
    return false; // e-mail de confirmation envoyé
  },
  async resetPassword(email) { ok(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split('#')[0] })); },
  async signOut() {
    if (DEMO) localStorage.removeItem(LS_USER); else await sb.auth.signOut();
    await setProfile(null);
  },
  async createCompany(name, userName) { ok(await sb.rpc('create_company', { p_name: name, p_user_name: userName })); await this.loadProfile(this.user); },
  async joinCompany(code, userName) { ok(await sb.rpc('join_company', { p_code: code, p_user_name: userName })); await this.loadProfile(this.user); },
};

// ── Équipe et entreprise ───────────────────────────────────────
export const team = {
  async updateCompany(patch) {
    session.company = await db.update('companies', session.company.id, patch);
  },
  async regenCode() {
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    await this.updateCompany({ join_code: code });
    return code;
  },
  async setMyName(name) {
    if (DEMO) await local.update('profiles', session.profile.id, { name });
    else ok(await sb.rpc('update_my_name', { p_name: name }));
    session.profile.name = name; await refreshMembers();
  },
  async setRole(id, role) {
    if (id === session.profile.id && role !== 'admin' && session.members.filter(m => m.role === 'admin').length < 2)
      throw new Error('Il faut au moins un responsable dans l\'entreprise.');
    await db.update('profiles', id, { role });
    if (id === session.profile.id) session.profile.role = role;
    await refreshMembers();
  },
  async remove(id) {
    if (id === session.profile.id) throw new Error('Tu ne peux pas te retirer toi-même.');
    if (DEMO) await local.update('profiles', id, { company_id: null });
    else ok(await sb.rpc('remove_member', { p_user: id }));
    await refreshMembers();
  },
  /** Démo uniquement : en vrai, l'employé crée son compte avec le code d'entreprise. */
  async addDemoMember(name, role) {
    await local.insert('profiles', { name, role, email: '' });
    await refreshMembers();
  },
};
