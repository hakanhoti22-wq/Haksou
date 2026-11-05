// Test de bout en bout en mode Supabase : vraie base PostgreSQL + vraies règles de sécurité + vraie bibliothèque supabase-js.
// Trois navigateurs séparés (propriétaire, patron, employé) jouent un scénario complet de vente et d'utilisation.
//
//   cd gestion/tests && npm install && npx playwright install chromium
//   PGURL=postgres://postgres@localhost:5432 node e2e-supabase.js
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const { Client } = require('pg');

const PGURL = (process.env.PGURL || 'postgres://postgres@localhost:5432').replace(/\/$/, '');
const DB = 'haksou_e2e_' + process.pid;
const SQL = f => fs.readFileSync(path.join(__dirname, f), 'utf8');

let passed = 0;
const ok = m => { passed++; console.log('  ✓', m); };
const check = (cond, m) => { if (!cond) throw new Error('ÉCHEC : ' + m); ok(m); };

(async () => {
  // ── Base neuve : simulation Supabase + schema.sql ──
  const admin = new Client({ connectionString: PGURL + '/postgres' }); await admin.connect();
  await admin.query(`create database ${DB}`);
  const pg = new Client({ connectionString: `${PGURL}/${DB}` }); await pg.connect();
  await pg.query(SQL('sql/0-simulation-supabase.sql').replace(/insert into auth\.users[\s\S]*?;\s*$/m, ''));
  await pg.query(SQL('../supabase/schema.sql'));
  await pg.query(SQL('../supabase/schema.sql'));   // relançable sans erreur
  ok('schema.sql installé (et relancé une 2e fois sans erreur)');
  const one = async (q, v) => (await pg.query(q, v)).rows[0];

  process.env.DATABASE_URL = `${PGURL}/${DB}`;
  const { createServer, pool } = require('./supabase-local/server.js');
  let port;
  const server = createServer({ config: () => `export const SUPABASE_URL = 'http://localhost:${port}';\nexport const SUPABASE_ANON_KEY = 'cle-anon-locale';\nexport const SUPPORT_CONTACT = { name: 'Haksou', email: 'support@haksou.ch', phone: '079 000 00 00' };\n` });
  await new Promise(r => server.listen(0, r)); port = server.address().port;
  const U = `http://localhost:${port}/`;

  const browser = await chromium.launch();
  const errors = [];
  async function user(label) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(`[${label}] ${e.message}`));
    p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED|net::ERR/.test(m.text())) errors.push(`[${label}] ${m.text()}`); });
    p.on('dialog', d => d.accept());
    p.ctx = ctx;
    return p;
  }
  const go = async (p, h) => { await p.goto(U + h); await p.reload(); await p.waitForSelector('#view > *:not(.loading), .auth-card'); await p.waitForTimeout(250); };
  const text = async (p, s) => (await p.textContent(s)) || '';
  const toasts = async p => { await p.waitForTimeout(300); return p.$$eval('.toast', ts => ts.map(t => t.textContent).join(' | ')); };
  async function signup(p, email, label) {
    await p.goto(U); await p.waitForSelector('#f');
    await p.click('[data-m=signup]'); await p.fill('[name=email]', email); await p.fill('[name=password]', 'motdepasse123');
    await p.click('#f [type=submit]'); await p.waitForSelector('#me, #view');
    ok(`${label} : compte créé (${email})`);
  }

  console.log('\nPropriétaire');
  const owner = await user('propriétaire');
  await signup(owner, 'hakan@haksou.ch', 'propriétaire');
  await pg.query(`insert into platform_admins (user_id) select id from auth.users where email = 'hakan@haksou.ch'`);
  await owner.reload(); await owner.waitForSelector('#view .tiles');
  check((await text(owner, '#links')).includes('Console'), 'propriétaire déclaré dans platform_admins → console visible');
  await owner.click('#new'); await owner.fill('.modal [name=name]', 'Garage Favre Sàrl'); await owner.click('.modal [type=submit]');
  await owner.waitForSelector('#welcome');
  const adminCode = /code responsable : ([A-Z0-9]{8})/.exec(await owner.inputValue('#welcome'))[1];
  check(!!adminCode, `entreprise cliente créée, code responsable ${adminCode}`);
  await owner.click('.modal [data-close] >> nth=0');

  console.log('\nPatron');
  const boss = await user('patron');
  await signup(boss, 'favre@garage-favre.ch', 'patron');
  await boss.fill('#me', 'Jean Favre'); await boss.fill('#join [name=code]', adminCode); await boss.click('#join [type=submit]');
  await boss.waitForSelector('#view .hello');
  check((await text(boss, '.me')).includes('Responsable'), 'patron devenu responsable grâce au code (usage unique)');
  check((await one(`select admin_code from companies`)).admin_code === null, 'code responsable effacé après usage');
  await go(boss, '#/equipe');
  const joinCode = (await text(boss, '.code')).trim();
  await go(boss, '#/reglages');
  await boss.fill('#company [name=address]', 'Route de Fribourg 8\n1723 Marly'); await boss.fill('#company [name=iban]', 'CH93 0076 2011 6238 5295 7');
  await boss.click('#company [type=submit]'); await boss.waitForTimeout(400);
  check((await one(`select iban from companies`)).iban.startsWith('CH93'), 'informations de l\'entreprise enregistrées');

  console.log('\nEmployé');
  const emp = await user('employé');
  await signup(emp, 'karim@garage-favre.ch', 'employé');
  await emp.fill('#me', 'Karim Benali'); await emp.fill('#join [name=code]', joinCode); await emp.click('#join [type=submit]');
  await emp.waitForSelector('#view .hello');
  check((await text(emp, '.me')).includes('Employé'), 'employé a rejoint avec le code d\'invitation');
  await go(emp, '#/pointage');
  const t0 = Date.now(); await emp.click('#punch'); await emp.waitForSelector('.dot.in');
  check((await one(`select count(*)::int n from punches where offline = false`)).n === 1, `pointage enregistré en base en ${Date.now() - t0} ms`);
  // hors ligne
  await emp.ctx.setOffline(true);
  await emp.click('#punch'); await emp.waitForTimeout(1500);
  check((await text(emp, '#view')).includes('en attente d\'envoi'), 'sans réseau : pointage gardé sur le téléphone (bandeau « en attente »)');
  check((await one(`select count(*)::int n from punches`)).n === 1, 'sans réseau : rien n\'est encore arrivé en base');
  await emp.ctx.setOffline(false);
  await emp.evaluate(() => window.dispatchEvent(new Event('online'))); await emp.waitForTimeout(1500);
  const off = await one(`select count(*)::int n, bool_or(offline) o from punches`);
  check(off.n === 2 && off.o, 'retour du réseau : pointage envoyé automatiquement (marqué hors ligne)');
  await emp.evaluate(() => window.dispatchEvent(new Event('online'))); await emp.waitForTimeout(800);
  check((await one(`select count(*)::int n from punches`)).n === 2, 'aucun doublon après un 2e envoi');
  await go(emp, '#/pointage');
  await emp.click('#add'); await emp.fill('.modal [name=time]', '07:00'); await emp.fill('.modal [name=date]', new Date(Date.now() - 864e5).toISOString().slice(0, 10));
  await emp.fill('.modal [name=note]', 'Oubli hier matin'); await emp.click('.modal [type=submit]'); await emp.waitForTimeout(500);
  check((await one(`select count(*)::int n from audit_log where action = 'ajout' and details->>'note' = 'Oubli hier matin'`)).n === 1, 'pointage oublié journalisé en base avec son motif');
  await go(emp, '#/conges'); await emp.click('#new'); await emp.fill('.modal [name=reason]', 'Mariage'); await emp.click('.modal [type=submit]'); await emp.waitForTimeout(400);
  await go(emp, '#/frais'); await emp.click('#new'); await emp.fill('.modal [name=amount]', '32.50'); await emp.click('.modal [type=submit]'); await emp.waitForTimeout(400);
  check((await one(`select count(*)::int n from expenses where status = 'en_attente'`)).n === 1, 'note de frais envoyée');
  check(await emp.evaluate(async () => { const { db } = await import('./js/db.js'); const [e] = await db.list('expenses'); try { await db.update('expenses', e.id, { status: 'remboursee' }); return false; } catch { return true; } }),
    'sécurité : l\'employé ne peut pas valider sa propre note de frais (refusé par la base)');
  check(await emp.evaluate(async () => { const { db } = await import('./js/db.js'); try { await db.insert('shifts', { user_id: (await db.list('profiles'))[0].id, date: '2030-01-01', start_time: '08:00', end_time: '09:00' }); return false; } catch { return true; } }),
    'sécurité : l\'employé ne peut pas modifier le planning (refusé par la base)');
  await emp.click('#helpBtn'); await emp.fill('.modal [name=message]', 'Comment je corrige un pointage ?'); await emp.click('.modal [type=submit]'); await emp.waitForTimeout(400);
  check((await one(`select count(*)::int n from support_tickets`)).n === 1, 'demande d\'aide envoyée');

  console.log('\nPatron au travail');
  await go(boss, '#/conges'); await boss.click('[data-ok]'); await boss.waitForTimeout(400);
  check((await one(`select status from leaves`)).status === 'approuve', 'congé de l\'employé approuvé');
  await go(boss, '#/frais'); await boss.click('[data-st=validee]'); await boss.waitForTimeout(400);
  await go(boss, '#/pointage');
  check((await text(boss, '#team')).includes('Oubli hier matin'), 'le patron voit la correction dans le journal');
  await go(boss, '#/clients'); await boss.click('#new'); await boss.fill('.modal [name=name]', 'Boulangerie du Centre'); await boss.fill('.modal [name=email]', 'info@boulangerie.ch'); await boss.click('.modal [type=submit]'); await boss.waitForTimeout(400);
  await go(boss, '#/factures'); await boss.click('[data-t=facture]'); await boss.waitForTimeout(300); await boss.click('#new'); await boss.waitForSelector('#lines');
  await boss.selectOption('#client', { label: 'Boulangerie du Centre' }); await boss.fill('[data-k=desc]', 'Dépannage'); await boss.fill('[data-k=price]', '150');
  await boss.click('#addHour'); await boss.click('#issue'); await boss.waitForSelector('.notice'); await boss.waitForTimeout(300);
  const y = new Date().getFullYear();
  check((await text(boss, '.doc-no')).includes(`F-${y}-001`), `facture émise par la base : F-${y}-001`);
  check(await boss.evaluate(async () => { const { db } = await import('./js/db.js'); const d = (await db.list('documents'))[0]; try { await db.remove('documents', d.id); return false; } catch { return true; } }),
    'sécurité : facture émise impossible à supprimer (refusé par la base)');
  const [dl] = await Promise.all([boss.waitForEvent('download'), boss.click('#pdf')]);
  check(fs.readFileSync(await dl.path()).slice(0, 5).toString() === '%PDF-', 'PDF de la facture téléchargé');
  await boss.click('#credit'); await boss.waitForSelector('#issue'); await boss.click('#issue'); await boss.waitForTimeout(500);
  check((await one(`select status from documents where kind = 'facture'`)).status === 'annulee', `note de crédit NC-${y}-001 émise → facture annulée`);
  await go(boss, '#/planning'); await boss.click('tbody tr td.cell >> nth=1'); await boss.click('.modal [type=submit]'); await boss.waitForTimeout(400);
  check((await one(`select count(*)::int n from shifts`)).n === 1, 'horaire ajouté au planning');
  await go(boss, '#/stock'); await boss.click('#new'); await boss.fill('.modal [name=name]', 'Huile moteur 5W30'); await boss.fill('.modal [name=qty]', '12'); await boss.click('.modal [type=submit]'); await boss.waitForTimeout(400);
  await boss.click('[data-out]'); await boss.fill('.modal [name=qty]', '3'); await boss.click('.modal [type=submit]'); await boss.waitForTimeout(400);
  check(+(await one(`select qty from items`)).qty === 9, 'stock : 12 − 3 = 9 en base');
  await go(boss, '#/interventions'); await boss.click('#new'); await boss.fill('.modal [name=title]', 'Vidange'); await boss.click('.modal [type=submit]'); await boss.waitForSelector('#pad');
  check((await one(`select count(*)::int n from interventions`)).n === 1, 'intervention créée');
  await go(emp, '#/frais');
  check((await text(emp, '#view')).includes('Validée'), 'l\'employé voit sa note de frais validée');

  await emp.evaluate(() => { setTimeout(() => { throw new Error('Erreur de test chez le client'); }); }); await emp.waitForTimeout(800);
  check((await one(`select count(*)::int n from error_reports where message like '%Erreur de test chez le client%'`)).n === 1, 'erreur chez le client enregistrée automatiquement en base');
  for (let i = errors.length - 1; i >= 0; i--) if (errors[i].includes('Erreur de test chez le client')) errors.splice(i, 1);   // provoquée exprès

  console.log('\nSupervision par le propriétaire');
  await go(owner, '#/console');
  await owner.click('[data-t=erreurs]'); await owner.waitForTimeout(300);
  check((await text(owner, '#tab')).includes('Erreur de test chez le client') && (await text(owner, '#tab')).includes('Garage Favre'), 'console : l\'erreur apparaît avec le nom de l\'entreprise');
  await owner.click('[data-resolve]'); await owner.waitForTimeout(400);
  check((await one(`select bool_and(resolved) r from error_reports`)).r, 'erreur marquée comme corrigée');
  await owner.click('[data-t=entreprises]'); await owner.waitForTimeout(300);
  check(/2 utilisateur/.test(await text(owner, '#tab')), 'console : Garage Favre, 2 utilisateurs, activité visible');
  await owner.click('[data-t=aide]'); await owner.waitForTimeout(300);
  check((await text(owner, '#tab')).includes('Comment je corrige un pointage'), 'console : demande d\'aide reçue');
  await owner.click('[data-reply]'); await owner.fill('.modal [name=reply]', 'Touche le pointage dans ton historique.'); await owner.click('.modal [type=submit]'); await owner.waitForTimeout(400);
  check((await one(`select status from support_tickets`)).status === 'resolu', 'réponse envoyée, demande résolue');
  await owner.click('[data-t=entreprises]'); await owner.waitForTimeout(300);
  check(await owner.evaluate(async () => { const { db, session } = await import('./js/db.js'); session.company = { id: (await (await import('./js/db.js')).platform.overview())[0].id }; return (await db.list('clients')).length === 0; }),
    'sécurité : sans session de support, le propriétaire ne voit aucune donnée du client');
  await owner.reload(); await owner.waitForSelector('#view .tiles');
  await owner.click('[data-enter]'); await owner.fill('.modal [name=reason]', 'Appel de M. Favre : facture'); await owner.click('.modal [type=submit]');
  await owner.waitForSelector('#supportBar');
  await go(owner, '#/clients');
  check((await text(owner, '#list')).includes('Boulangerie du Centre'), 'mode support : le propriétaire voit les données du client');
  await owner.click('.item.click'); await owner.fill('.modal [name=phone]', '026 111 22 33'); await owner.click('.modal [type=submit]'); await owner.waitForTimeout(400);
  check((await one(`select phone from clients`)).phone === '026 111 22 33', 'mode support : correction enregistrée chez le client');
  await owner.click('#endSupport'); await owner.waitForSelector('#view .tiles'); await owner.waitForTimeout(300);
  check((await one(`select count(*)::int n from support_sessions where ended_at is not null`)).n === 1, 'session de support terminée');
  await go(boss, '#/reglages');
  check((await text(boss, '#view')).includes('Appel de M. Favre'), 'le patron voit l\'accès du support dans ses Réglages');
  await owner.click('[data-manage]'); await owner.selectOption('.modal [name=status]', 'suspendu'); await owner.fill('.modal [name=notes]', 'Impayé'); await owner.click('.modal [type=submit]'); await owner.waitForTimeout(400);
  await emp.reload(); await emp.waitForSelector('.auth-card');
  check((await text(emp, '.auth-card')).includes('Compte suspendu') && (await text(emp, '.auth-card')).includes('079 000 00 00'), 'suspension : l\'employé voit « Compte suspendu » et ton numéro');
  check(await emp.evaluate(async () => { const { db } = await import('./js/db.js'); try { await db.insert('punches', { type: 'in' }); return false; } catch { return true; } }), 'suspension : écriture refusée par la base');
  await owner.click('[data-manage]'); await owner.selectOption('.modal [name=status]', 'actif'); await owner.click('.modal [type=submit]'); await owner.waitForTimeout(400);
  await go(emp, '#/accueil'); await emp.waitForSelector('#view .hello');
  ok('réactivation : l\'employé retrouve son appli');

  await browser.close(); server.close(); await pool.end(); await pg.end();
  await admin.query(`drop database ${DB}`); await admin.end();
  if (errors.length) { console.log('\n❌ Erreurs JavaScript :\n' + errors.join('\n')); process.exit(1); }
  console.log(`\n✅ ${passed} vérifications réussies en mode Supabase, aucune erreur JavaScript.\n`);
  process.exit(0);
})().catch(e => { console.error('\n❌', e.stack || e); process.exit(1); });
