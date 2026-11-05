// Mini-Supabase local pour les tests : sert l'appli + imite les API REST (PostgREST) et Auth (GoTrue)
// sur un vrai PostgreSQL, avec les vraies règles de sécurité (RLS) de supabase/schema.sql.
// Il n'implémente que ce que l'appli utilise. Ce n'est PAS un serveur de production.
//
//   DATABASE_URL=postgres://postgres@localhost:5432/haksou node gestion/tests/supabase-local/server.js
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { Pool } = require('pg');

const ROOT = path.resolve(__dirname, '../..');           // dossier gestion/
const SECRET = 'secret-de-test-local';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

// ── JWT (HS256) ───────────────────────────────────────────────
const b64 = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
const sign = payload => { const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64(payload); return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`; };
function verify(token) {
  const [h, p, s] = String(token || '').split('.');
  if (!s || crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url') !== s) return null;
  const c = JSON.parse(Buffer.from(p, 'base64url'));
  return c.exp > Date.now() / 1000 ? c : null;
}
const hash = pw => crypto.createHash('sha256').update('sel:' + pw).digest('hex');
function session(user) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const u = { id: user.id, aud: 'authenticated', role: 'authenticated', email: user.email, email_confirmed_at: new Date().toISOString(), app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString() };
  return { access_token: sign({ sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', exp }), token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: sign({ sub: user.id, email: user.email, typ: 'refresh', exp: exp + 86400 * 30 }), user: u };
}

// ── Requêtes SQL avec l'identité de l'utilisateur ──────────────
async function asUser(claims, fn) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    if (claims) {
      await c.query(`select set_config('role', 'authenticated', true), set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [JSON.stringify(claims), claims.sub]);
    } else await c.query(`select set_config('role', 'anon', true)`);
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) { await c.query('rollback').catch(() => {}); throw e; }
  finally { c.release(); }
}
const ident = s => { if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw Object.assign(new Error('Nom invalide : ' + s), { status: 400 }); return `"${s}"`; };
const OPS = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };
function where(params, values, alias = '') {
  const parts = [], col = k => (alias ? alias + '.' : '') + ident(k);
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset', 'columns', 'on_conflict'].includes(k)) continue;
    const m = /^(eq|neq|gt|gte|lt|lte|is)\.(.*)$/s.exec(v);
    if (!m) throw Object.assign(new Error('Filtre non géré : ' + k + '=' + v), { status: 400 });
    if (m[1] === 'is') parts.push(`${col(k)} is ${m[2] === 'null' ? 'null' : m[2] === 'true' ? 'true' : 'false'}`);
    else { values.push(m[2]); parts.push(`${col(k)} ${OPS[m[1]]} $${values.length}`); }
  }
  return parts.length ? ' where ' + parts.join(' and ') : '';
}
const orderBy = o => o ? ' order by ' + o.split(',').map(x => { const [col, dir] = x.split('.'); return `${ident(col)} ${dir === 'desc' ? 'desc' : 'asc'}`; }).join(', ') : '';

async function rest(req, res, url, claims, body) {
  const parts = url.pathname.replace(/^\/rest\/v1\//, '').split('/');
  const single = /vnd\.pgrst\.object/.test(req.headers.accept || '');
  const wantRows = /return=representation/.test(req.headers.prefer || '') || req.method === 'GET';
  const send = rows => {
    if (single) {
      if (rows.length !== 1) return json(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${rows.length} rows` });
      return json(res, 200, rows[0]);
    }
    return wantRows ? json(res, req.method === 'POST' ? 201 : 200, rows) : (res.writeHead(204), res.end());
  };
  return asUser(claims, async c => {
    if (parts[0] === 'rpc') {
      const fn = parts[1], args = body || {};
      const info = (await c.query(`select proretset, prorettype::regtype::text as t from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace`, [fn])).rows[0];
      if (!info) return json(res, 404, { message: `Fonction ${fn} introuvable` });
      const keys = Object.keys(args), vals = keys.map(k => args[k]);
      const call = `public.${ident(fn)}(${keys.map((k, i) => `${ident(k)} => $${i + 1}`).join(', ')})`;
      if (info.proretset) return json(res, 200, (await c.query(`select * from ${call}`, vals)).rows);
      const v = (await c.query(`select ${call} as v`, vals)).rows[0].v;
      return json(res, 200, info.t === 'void' ? null : v);
    }
    const t = `public.${ident(parts[0])}`, values = [];
    if (req.method === 'GET') return send((await c.query(`select * from ${t}${where(url.searchParams, values)}${orderBy(url.searchParams.get('order'))}`, values)).rows);
    if (req.method === 'POST') {
      const rows = Array.isArray(body) ? body : [body];
      const cols = [...new Set(rows.flatMap(Object.keys))].map(ident).join(', ');
      // comme PostgREST : sans « return=representation », pas de RETURNING (les tables en écriture seule restent possibles)
      return send((await c.query(`insert into ${t} (${cols}) select ${cols} from json_populate_recordset(null::${t}, $1)${wantRows ? ' returning *' : ''}`, [JSON.stringify(rows)])).rows);
    }
    if (req.method === 'PATCH') {
      const sets = Object.keys(body).map(k => `${ident(k)} = r.${ident(k)}`).join(', ');
      const w = where(url.searchParams, values, 'x');
      values.push(JSON.stringify(body));
      const w2 = w ? w.replace(' where ', ' and ') : '';
      return send((await c.query(`update ${t} as x set ${sets} from json_populate_record(null::${t}, $${values.length}) as r where true${w2} returning x.*`, values)).rows);
    }
    if (req.method === 'DELETE') return send((await c.query(`delete from ${t}${where(url.searchParams, values)} returning *`, values)).rows);
    json(res, 405, { message: 'Méthode non gérée' });
  });
}

async function auth(req, res, url, body) {
  const route = url.pathname.replace(/^\/auth\/v1\//, '');
  const q = (sql, v) => pool.query(sql, v).then(r => r.rows);
  if (route === 'signup') {
    if (!body.password || body.password.length < 6) return json(res, 422, { code: 'weak_password', msg: 'Password should be at least 6 characters', message: 'Password should be at least 6 characters' });
    const ex = await q('select 1 from auth.users where email = $1', [body.email.toLowerCase()]);
    if (ex.length) return json(res, 422, { code: 'user_already_exists', msg: 'User already registered', message: 'User already registered' });
    const [u] = await q('insert into auth.users (email, encrypted_password) values ($1, $2) returning id, email', [body.email.toLowerCase(), hash(body.password)]);
    return json(res, 200, session(u));
  }
  if (route === 'token') {
    if (url.searchParams.get('grant_type') === 'refresh_token') {
      const c = verify(body.refresh_token);
      if (!c) return json(res, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token', message: 'Invalid Refresh Token' });
      return json(res, 200, session({ id: c.sub, email: c.email }));
    }
    const [u] = await q('select id, email from auth.users where email = $1 and encrypted_password = $2', [String(body.email).toLowerCase(), hash(body.password)]);
    if (!u) return json(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 'invalid_credentials', msg: 'Invalid login credentials', message: 'Invalid login credentials' });
    return json(res, 200, session(u));
  }
  if (route === 'user') {
    const c = verify((req.headers.authorization || '').replace(/^Bearer /, ''));
    return c ? json(res, 200, session({ id: c.sub, email: c.email }).user) : json(res, 401, { message: 'invalid JWT' });
  }
  if (route === 'logout' || route === 'recover') { res.writeHead(204); return res.end(); }
  json(res, 404, { message: 'Route auth non gérée : ' + route });
}

const json = (res, status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

function createServer({ config } = {}) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      let body = null;
      if (['POST', 'PATCH'].includes(req.method)) { const chunks = []; for await (const ch of req) chunks.push(ch); body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {}; }
      if (url.pathname.startsWith('/auth/v1/')) return await auth(req, res, url, body || {});
      if (url.pathname.startsWith('/rest/v1/')) {
        const claims = verify((req.headers.authorization || '').replace(/^Bearer /, ''));
        return await rest(req, res, url, claims && claims.role === 'authenticated' ? claims : null, body);
      }
      // fichiers de l'appli ; config.js est remplacé pour pointer vers ce serveur
      let p = decodeURIComponent(url.pathname);
      if (p === '/' ) p = '/index.html';
      if (p === '/js/config.js' && config) { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(config(req)); }
      const f = path.join(ROOT, p.endsWith('/') ? p + 'index.html' : p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    } catch (e) {
      // même forme d'erreur que PostgREST : { code, message, details, hint }
      json(res, e.status || (e.code === '42501' ? 403 : 400), { code: e.code, message: e.message, details: e.detail || null, hint: e.hint || null });
    }
  });
}

module.exports = { createServer, pool };

if (require.main === module) {
  const port = +process.env.PORT || 54321;
  createServer({ config: () => `export const SUPABASE_URL = 'http://localhost:${port}';\nexport const SUPABASE_ANON_KEY = 'cle-anon-locale';\n` })
    .listen(port, () => console.log(`Mini-Supabase + appli : http://localhost:${port}/`));
}
