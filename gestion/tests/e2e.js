// Test de bout en bout de Haksou Pro (mode démo), dans un vrai navigateur.
// Lancer depuis la racine du dépôt :   node gestion/tests/e2e.js
// Prérequis : Node.js et Playwright (npm i -D playwright && npx playwright install chromium)
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

let passed = 0;
const ok = m => { passed++; console.log('  ✓', m); };
const check = (cond, m) => { if (!cond) throw new Error('ÉCHEC : ' + m); ok(m); };

(async () => {
  await new Promise(r => server.listen(0, r));
  const U = `http://localhost:${server.address().port}/`;
  const IMG = fs.readFileSync(path.join(ROOT, 'icon-192.png'));
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  p.on('dialog', d => d.accept());
  // pas de vrai client e-mail dans le test
  await p.addInitScript(() => { Object.defineProperty(navigator, 'canShare', { value: undefined }); });
  p.on('request', r => { if (r.url().startsWith('mailto:')) r.abort?.(); });

  const go = async h => { await p.goto(U + h); await p.waitForTimeout(350); };
  const text = async s => (await p.textContent(s)) || '';
  const toastText = async () => { await p.waitForTimeout(250); return (await p.$$eval('.toast', ts => ts.map(t => t.textContent).join(' | '))); };
  /** Clique et vérifie qu'un vrai PDF est téléchargé. */
  const pdf = async (sel, label) => {
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.click(sel)]);
    const file = await dl.path(), buf = fs.readFileSync(file);
    check(buf.slice(0, 5).toString() === '%PDF-' && buf.length > 2000, `${label} : PDF « ${dl.suggestedFilename()} » (${Math.round(buf.length / 1024)} Ko)`);
    if (process.env.PDF_DIR) fs.copyFileSync(file, path.join(process.env.PDF_DIR, dl.suggestedFilename()));
  };
  const login = async who => {
    await go(''); await p.evaluate(() => localStorage.removeItem('haksou-pro-demo-user')); await p.reload();
    await p.waitForSelector('.user-btn'); await p.click(`.user-btn >> text=${who}`); await p.waitForSelector('#view .hello, #view .tiles, .auth-card h1'); await p.waitForTimeout(300);
  };

  await p.goto(U); await p.evaluate(() => localStorage.clear());
  console.log('\nConnexion');
  await login('Hakan'); ok('patron connecté');

  console.log('\n1. Pointage');
  await go('#/pointage'); await p.click('#punch'); await p.waitForTimeout(300);
  check((await text('.hero')).includes('Au travail'), 'arrivée pointée');
  await p.click('#add'); await p.fill('.modal [name=time]', '07:30'); await p.click('.modal [type=submit]');
  check((await toastText()).includes('Remplis'), 'pointage oublié refusé sans motif');
  await p.fill('.modal [name=note]', 'Oubli le matin'); await p.click('.modal [type=submit]'); await p.waitForTimeout(300);
  check((await text('#hist')).includes('✎'), 'pointage oublié ajouté et marqué ✎');
  check((await text('#team')).includes('Oubli le matin'), 'visible dans le journal des corrections');
  await p.click('.pill >> nth=1'); await p.fill('.modal [name=note]', 'Doublon'); await p.click('.modal #del'); await p.waitForTimeout(300);
  check((await text('#team')).includes('suppression'), 'suppression tracée dans le journal');
  await pdf('#pdf', 'relevé d\'heures mensuel');

  console.log('\n2. Congés');
  await go('#/conges'); await p.click('#new'); await p.selectOption('.modal [name=user_id]', { label: 'Karim Benali' });
  await p.uncheck('.modal [name=approve]'); await p.click('.modal [type=submit]'); await p.waitForTimeout(300);
  const pend = await p.$$('[data-ok]'); check(pend.length === 2, 'demande en attente de validation');
  await pend[0].click(); await p.waitForTimeout(300); ok('demande acceptée');

  console.log('\n3. Planning');
  await go('#/planning'); await p.click('tbody tr:nth-child(1) td.cell >> nth=2'); await p.check('.modal [name=week]'); await p.click('.modal [type=submit]'); await p.waitForTimeout(400);
  check((await p.$$('tbody tr:nth-child(1) .shift')).length >= 5, 'horaires du lundi au vendredi ajoutés');
  await pdf('#pdf', 'planning');

  console.log('\n5. Devis, factures, notes de crédit');
  await go('#/factures'); await p.click('[data-t=facture]'); await p.waitForTimeout(250); await p.click('#new'); await p.waitForSelector('#lines');
  check((await p.inputValue('#number')).includes('émission'), 'nouvelle facture = brouillon sans numéro');
  await p.fill('[data-k=desc]', 'Réparation'); await p.fill('[data-k=price]', '200');
  await p.click('#issue'); check((await toastText()).includes('client'), 'émission refusée sans client');
  await p.selectOption('#client', { label: 'Garage Rapide SA' });
  await p.click('#issue'); await p.waitForTimeout(500);
  const num = (await text('.doc-no')).trim();
  check(/^Facture F-\d{4}-003$/.test(num), `facture émise avec le numéro suivant : ${num}`);
  check(await p.isDisabled('#notes') && !(await p.$('#del')) && !(await p.$('#save')), 'facture émise verrouillée (ni modification ni suppression)');
  check(await p.evaluate(async () => { const { db } = await import('./js/db.js'); const d = (await db.list('documents')).find(x => x.number?.endsWith('-003')); try { await db.update('documents', d.id, { lines: [] }); return false; } catch { return true; } }),
    'verrou aussi dans la couche de données (pas seulement l\'écran)');
  await pdf('#pdf', 'facture');
  await p.click('#credit'); await p.waitForSelector('#issue');
  check((await text('.doc-no')).includes('Note de crédit'), 'note de crédit créée en brouillon');
  await p.click('#issue'); await p.waitForTimeout(500);
  check((await text('.doc-no')).includes('NC-'), 'note de crédit émise : ' + (await text('.doc-no')).trim());
  await pdf('#pdf', 'note de crédit');
  await p.click('.notice a'); await p.waitForTimeout(400);
  check((await text('.toolbar')).includes('Annulée'), 'facture d\'origine annulée par la note de crédit');
  check((await text('#view')).includes('Émission'), 'historique de la facture affiché');
  // brouillon supprimé : pas de trou dans la numérotation
  await go('#/factures'); await p.click('[data-t=facture]'); await p.waitForTimeout(250); await p.click('#new'); await p.waitForSelector('#del');
  await p.click('#del'); await p.waitForTimeout(300);
  await p.click('[data-t=devis]'); await p.waitForTimeout(250); await p.click('#new'); await p.waitForSelector('#lines');
  await p.selectOption('#client', { label: 'Sophie Dubois' }); await p.fill('[data-k=desc]', 'Pose chauffe-eau'); await p.fill('[data-k=price]', '1200');
  await p.click('#save'); await p.waitForTimeout(250);
  await pdf('#pdf', 'devis');
  await p.click('#convert'); await p.waitForSelector('#issue'); await p.click('#issue'); await p.waitForTimeout(500);
  check((await text('.doc-no')).trim().endsWith('-004'), 'devis → facture : numéro 004, sans trou malgré le brouillon supprimé');

  console.log('\n4. Interventions');
  await go('#/interventions'); await p.click('#new'); await p.fill('.modal [name=title]', 'Réparation chaudière');
  await p.selectOption('.modal [name=client_id]', { label: 'Sophie Dubois' }); await p.click('.modal [type=submit]'); await p.waitForSelector('#pad');
  await p.fill('[name=work_done]', 'Changement du thermostat'); await p.fill('[name=hours]', '2'); await p.click('#f [type=submit]'); await p.waitForTimeout(400);
  await p.setInputFiles('#addPhoto', { name: 'a.png', mimeType: 'image/png', buffer: IMG }); await p.waitForTimeout(500);
  check((await p.$$('#photos img')).length === 1, 'photo ajoutée');
  await p.locator('#pad').scrollIntoViewIfNeeded(); const box = await p.locator('#pad').boundingBox();
  await p.mouse.move(box.x + 30, box.y + 100); await p.mouse.down(); await p.mouse.move(box.x + 120, box.y + 40, { steps: 8 }); await p.mouse.move(box.x + 220, box.y + 120, { steps: 8 }); await p.mouse.up();
  await p.click('#sign'); await p.waitForTimeout(400);
  check(!!(await p.$('.sig-img')), 'signature du client enregistrée');
  await pdf('#pdf', 'bon d\'intervention (photo + signature)');
  await p.click('#invoice'); await p.waitForTimeout(500);
  check((await text('.doc-no')).includes('brouillon'), 'facture brouillon créée depuis l\'intervention');

  console.log('\n6. Stock');
  await go('#/stock'); await p.click('[data-out] >> nth=0'); await p.fill('.modal [name=qty]', '2'); await p.click('.modal [type=submit]'); await p.waitForTimeout(300); ok('sortie de stock');
  await p.click('#scan'); await p.waitForTimeout(400); await p.fill('#manual', '7612345000035'); await p.click('.modal #ok'); await p.waitForTimeout(300);
  check((await text('.modal h3')).includes('Robinet'), 'code-barres reconnu'); await p.click('.modal [data-close] >> nth=0');

  console.log('\n7. Notes de frais');
  await go('#/frais'); await p.click('#new'); await p.fill('.modal [name=amount]', '45.50'); await p.fill('.modal [name=description]', 'Repas client');
  await p.setInputFiles('#file', { name: 't.png', mimeType: 'image/png', buffer: IMG }); await p.waitForTimeout(300);
  await p.click('.modal [type=submit]'); await p.waitForTimeout(300);
  await p.click('[data-st=validee] >> nth=0'); await p.waitForTimeout(250); await p.click('[data-st=remboursee] >> nth=0'); await p.waitForTimeout(250); ok('note créée, validée, remboursée');
  await pdf('#pdf', 'rapport de frais (avec justificatifs)');

  console.log('\nDroits des employés');
  await go('#/pointage'); await p.uncheck('#selfEdit'); await p.waitForTimeout(300); ok('le patron bloque les corrections');
  await login('Karim');
  await go('#/pointage');
  check(!(await p.$('#add')) && (await text('#hist')).includes('responsable'), 'employé : plus de bouton « Pointage oublié »');
  check(await p.evaluate(async () => { const { db, session } = await import('./js/db.js'); try { await db.insert('punches', { user_id: session.profile.id, type: 'in', at: new Date(Date.now() - 864e5).toISOString(), note: 'x' }); return false; } catch { return true; } }),
    'employé : correction refusée aussi par la couche de données');
  await p.click('#punch'); await p.waitForTimeout(300); check((await toastText()).includes('enregistré'), 'employé : pointage normal toujours possible');
  check(!(await text('#links')).includes('Équipe'), 'employé : pas de menu Équipe');
  await go('#/frais'); check(!(await text('#view')).includes('Léa'), 'employé : ne voit que ses frais');
  await go('#/planning'); check(!(await p.$('#copy')), 'employé : planning en lecture seule');
  check(!(await text('#links')).includes('Console'), 'employé : pas d\'accès à la console du propriétaire');
  await p.click('#helpBtn'); await p.fill('.modal [name=message]', 'Le bouton PDF ne marche pas chez moi'); await p.click('.modal [type=submit]');
  check((await toastText()).includes('Demande envoyée'), 'employé : demande d\'aide envoyée depuis le bouton 🆘');
  await p.evaluate(() => { setTimeout(() => { throw new Error('Bug de test volontaire'); }); }); await p.waitForTimeout(300);
  errors.length = errors.filter(e => !e.includes('Bug de test volontaire')).length;   // erreur provoquée exprès

  console.log('\nPropriétaire de la plateforme');
  await login('propriétaire');
  check((await text('#links')).trim().startsWith('Console') && (await text('.tiles')).includes('Entreprises'), 'console du propriétaire affichée');
  check((await text('#tab')).includes('Démo Services') && (await text('#tab')).includes('Boulangerie Rossier'), 'toutes les entreprises clientes listées');
  await p.click('[data-t=erreurs]'); await p.waitForTimeout(300);
  check((await text('#tab')).includes('Bug de test volontaire'), 'erreur JavaScript remontée automatiquement dans la console');
  await p.click('[data-resolve] >> nth=0'); await p.waitForTimeout(300); ok('erreur marquée comme corrigée');
  await p.click('[data-t=aide]'); await p.waitForTimeout(300);
  check((await text('#tab')).includes('Le bouton PDF ne marche pas'), 'demande d\'aide reçue avec le nom de l\'entreprise');
  await p.click('[data-reply] >> nth=0'); await p.fill('.modal [name=reply]', 'Mets à jour l\'appli, c\'est corrigé !'); await p.click('.modal [type=submit]'); await p.waitForTimeout(300); ok('réponse envoyée');
  await p.click('[data-t=entreprises]'); await p.waitForTimeout(300);
  await p.click('#new'); await p.fill('.modal [name=name]', 'Garage Favre Sàrl'); await p.click('.modal [type=submit]'); await p.waitForTimeout(400);
  const welcome = await p.inputValue('#welcome');
  check(/code responsable : [A-Z0-9]{8}/.test(welcome), 'nouvelle entreprise cliente créée avec un message d\'accueil et un code responsable');
  await p.click('.modal [data-close] >> nth=0'); await p.waitForTimeout(200);
  // accès support
  await p.click('[data-enter] >> nth=-1'); await p.click('.modal [type=submit]');
  check((await toastText()).includes('Remplis'), 'accès support refusé sans motif');
  await p.click('.modal [data-close] >> nth=0');
  check(await p.evaluate(async () => { try { await (await import('./js/db.js')).platform.startSupport((await (await import('./js/db.js')).platform.overview())[0].id, '  '); return false; } catch { return true; } }), 'motif vide refusé aussi par la couche de données');
  const demoId = await p.evaluate(async () => (await (await import('./js/db.js')).platform.overview()).find(c => c.name === 'Démo Services Sàrl').id);
  await p.click(`[data-enter="${demoId}"]`); await p.fill('.modal [name=reason]', 'Appel de Hakan : test du support'); await p.click('.modal [type=submit]'); await p.waitForTimeout(600);
  check((await text('#supportBar')).includes('Mode support') && (await text('#links')).includes('factures'), 'mode support : appli du client ouverte avec bandeau orange');
  await go('#/clients'); await p.click('#new'); await p.fill('.modal [name=name]', 'Client ajouté par le support'); await p.click('.modal [type=submit]'); await p.waitForTimeout(300);
  check((await text('#list')).includes('Client ajouté par le support'), 'mode support : correction faite dans l\'appli du client');
  await p.click('#endSupport'); await p.waitForTimeout(500);
  check(!(await p.$('#supportBar')) && (await text('.tiles')).includes('Entreprises'), 'fin du mode support, retour à la console');
  // suspension
  const bakeryId = await p.evaluate(async () => (await (await import('./js/db.js')).platform.overview()).find(c => c.name === 'Boulangerie Rossier').id);
  await p.click(`[data-manage="${bakeryId}"]`); await p.selectOption('.modal [name=status]', 'suspendu'); await p.click('.modal [type=submit]'); await p.waitForTimeout(300);
  await login('Sofia');
  check((await text('#app')).includes('Compte suspendu'), 'entreprise suspendue : ses utilisateurs voient l\'écran « Compte suspendu »');
  await login('Hakan (patron)');
  await p.click('#helpBtn'); await p.waitForTimeout(300);
  check((await text('.modal')).includes('Mets à jour l\'appli'), 'le client voit la réponse du support dans son bouton Aide');
  await p.click('.modal [data-close] >> nth=0');
  await go('#/reglages');
  check((await text('#view')).includes('Appel de Hakan : test du support'), 'le patron voit l\'accès du support (motif, heure) dans ses Réglages');
  await p.uncheck('#supportAllowed'); await p.waitForTimeout(300);
  await login('propriétaire');
  check(await p.isDisabled(`[data-enter="${demoId}"]`), 'support refusé par le client : bouton « Accéder » désactivé');

  await b.close(); server.close();
  if (errors.length) { console.log('\n❌ Erreurs JavaScript :\n' + errors.join('\n')); process.exit(1); }
  console.log(`\n✅ ${passed} vérifications réussies, aucune erreur JavaScript.\n`);
})().catch(async e => { console.error('\n❌', e.message || e); server.close(); process.exit(1); });
