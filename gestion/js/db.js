// Couche de données : même interface en mode démo (localStorage) et avec Supabase.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { buildSeed } from './seed.js';
import { isoDate } from './utils.js';

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

// ── Règles métier du mode démo : copie des déclencheurs SQL de supabase/schema.sql ──
const isInvoice = r => r.kind === 'facture' || r.kind === 'avoir';
const LOCKED = ['number', 'client_id', 'date', 'due_date', 'lines', 'vat', 'notes', 'source_id'];
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const err = m => { throw new Error(m); };
const canEditPunch = () => isAdmin() || session.company?.punch_self_edit !== false;
const punchChanged = (o, n) => o.at !== n.at || o.type !== n.type || !!o.deleted !== !!n.deleted;
function audit(table, row, action, details = {}) {
  (load().audit_log ||= []).push({ id: newId(), company_id: row.company_id, actor_id: session.profile?.id, table_name: table, row_id: row.id, action, details, at: new Date().toISOString() });
}
const LOCK_MSG = 'Facture émise : elle ne peut plus être modifiée. Pour la corriger, crée une note de crédit.';
const rules = {
  punches: {
    insert(r) {
      r.deleted = false; r.edited = false; r.at ||= new Date().toISOString();
      r.manual = Math.abs(new Date(r.at) - Date.now()) > 300000;
      if (r.manual && !canEditPunch()) err('Ton responsable a désactivé les corrections de pointage.');
      if (r.manual && !r.note?.trim()) err('Indique le motif de ce pointage oublié.');
    },
    afterInsert(r) { if (r.manual) audit('punches', r, 'ajout', { user_id: r.user_id, type: r.type, at: r.at, note: r.note }); },
    update(o, n) {
      if (!canEditPunch()) err('Ton responsable a désactivé les corrections de pointage.');
      if (o.deleted && !isAdmin()) err('Ce pointage a été supprimé.');
      if (punchChanged(o, n) && !n.note?.trim()) err('Indique le motif de la correction.');
      n.user_id = o.user_id; n.company_id = o.company_id; n.manual = o.manual;
      n.edited = !!o.edited || o.at !== n.at || o.type !== n.type;
    },
    afterUpdate(o, n) {
      if (punchChanged(o, n)) audit('punches', n, n.deleted && !o.deleted ? 'suppression' : 'modification',
        { user_id: n.user_id, type_avant: o.type, type: n.type, at_avant: o.at, at: n.at, note: n.note });
    },
    remove() { err('Un pointage ne s\'efface jamais : il est marqué comme supprimé.'); },
  },
  documents: {
    insert(r) { if (isInvoice(r)) { r.number = null; r.status = 'brouillon'; } },
    afterInsert(r) { audit('documents', r, 'creation', { kind: r.kind, number: r.number }); },
    update(o, n) {
      if (n.kind !== o.kind) err('Le type de document ne peut pas changer.');
      if (!isInvoice(o)) return;
      if (!o.number && n.number) err('Utilise « Émettre » pour numéroter une facture.');
      if (o.number && LOCKED.some(k => !same(o[k], n[k]))) err(LOCK_MSG);
      if (!o.number && n.status !== 'brouillon') err('Émets d\'abord la facture.');
    },
    afterUpdate(o, n) { if (o.status !== n.status) audit('documents', n, 'statut', { avant: o.status, apres: n.status }); },
    remove(o) { if (isInvoice(o) && o.number) err('Une facture émise ne peut pas être supprimée (obligation de conservation). Crée une note de crédit.'); },
    afterRemove(o) { audit('documents', o, 'suppression', { kind: o.kind, number: o.number }); },
  },
};

const local = {
  async list(t, o) {
    const cid = session.company?.id;
    let rows = (load()[t] || []).filter(r => t === 'companies' ? r.id === cid : r.company_id === cid);
    // Même règle que la sécurité Supabase : un employé voit ses lignes (et les congés approuvés de l'équipe).
    if (OWNED.has(t) && !isAdmin()) rows = rows.filter(r => r.user_id === session.profile.id || (t === 'leaves' && r.status === 'approuve'));
    if (t === 'audit_log' && !isAdmin()) rows = rows.filter(r => r.actor_id === session.profile.id || r.details?.user_id === session.profile.id);
    if (t === 'punches' && !o?.withDeleted) rows = rows.filter(r => !r.deleted);
    return clone(filter(rows, o));
  },
  async get(t, id) { return (await this.list(t)).find(r => r.id === id) || null; },
  async insert(t, obj) {
    const d = load();
    const row = { id: newId(), created_at: new Date().toISOString(), company_id: session.company?.id, ...obj };
    if (OWNED.has(t) && !row.user_id) row.user_id = session.profile.id;
    rules[t]?.insert?.(row);
    (d[t] ||= []).push(row);
    rules[t]?.afterInsert?.(row); save();
    return clone(row);
  },
  async update(t, id, patch) {
    const r = (load()[t] || []).find(x => x.id === id);
    if (!r) throw new Error('Élément introuvable');
    const old = clone(r), next = { ...clone(r), ...clone(patch) };
    rules[t]?.update?.(old, next);
    Object.assign(r, next);
    rules[t]?.afterUpdate?.(old, r); save();
    return clone(r);
  },
  async remove(t, id) {
    const d = load(), old = (d[t] || []).find(x => x.id === id);
    if (old) rules[t]?.remove?.(old);
    d[t] = (d[t] || []).filter(x => x.id !== id);
    if (old) rules[t]?.afterRemove?.(old);
    save();
  },
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
    if (t === 'punches' && !o.withDeleted) q = q.eq('deleted', false);
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

/** Émet une facture ou une note de crédit : numéro définitif (sans trou), puis verrouillage. */
export async function issueDocument(id) {
  if (!DEMO) return ok(await sb.rpc('issue_document', { p_id: id }));
  const all = load().documents, d = all.find(x => x.id === id && x.company_id === session.company.id);
  if (!d) err('Document introuvable.');
  if (!isInvoice(d)) err('Seules les factures et notes de crédit s\'émettent.');
  if (d.number) err(`Ce document est déjà émis (${d.number}).`);
  if (!d.client_id) err('Choisis un client avant d\'émettre.');
  if (!d.lines?.length) err('Ajoute au moins une ligne.');
  d.date ||= isoDate();
  const prefix = `${d.kind === 'facture' ? 'F' : 'NC'}-${d.date.slice(0, 4)}-`;
  const n = Math.max(0, ...all.filter(x => x.company_id === d.company_id && x.number?.startsWith(prefix)).map(x => +x.number.slice(prefix.length) || 0)) + 1;
  d.number = prefix + String(n).padStart(3, '0');
  d.status = d.kind === 'facture' ? 'envoyee' : 'emise';
  audit('documents', d, 'emission', { number: d.number });
  if (d.kind === 'avoir' && d.source_id) {
    const ht = x => (x.lines || []).reduce((s, l) => s + (+l.qty || 0) * (+l.price || 0), 0);
    const src = all.find(x => x.id === d.source_id);
    const credited = all.filter(x => x.kind === 'avoir' && x.source_id === d.source_id && x.number).reduce((s, x) => s + ht(x), 0);
    if (src && credited >= ht(src) && src.status !== 'annulee') { audit('documents', src, 'statut', { avant: src.status, apres: 'annulee' }); src.status = 'annulee'; }
  }
  save();
  return d.number;
}

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
