// Test de bout en bout dans Chromium : connexion, saisie hors connexion, rechargement hors ligne, synchronisation.
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');
const { chromium, devices } = require(process.env.PW_PATH || 'playwright');

const PORT = 8099;
const BASE = 'http://localhost:' + PORT;
const SHOTS = path.join(__dirname, 'screens');

async function main() {
  const server = spawn('node', [path.join(__dirname, '..', 'dev', 'server.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'inherit' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch();
  const errors = [];
  try {
    const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'fr-FR', timezoneId: 'Europe/Paris' });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

    // 1. Connexion
    await page.goto(BASE + '/');
    await page.waitForSelector('text=Recevoir un code');
    await page.screenshot({ path: path.join(SHOTS, '01-connexion.png') });
    await page.fill('input[type=email]', 'eloane@test.local');
    await page.click('text=Recevoir un code');
    await page.waitForSelector('input.code');
    const mails = await (await fetch(BASE + '/__test/mails')).json();
    const code = mails[mails.length - 1].subject.match(/(\d{6})/)[1];
    await page.fill('input.code', code);
    await page.click('button:has-text("Se connecter")');
    await page.waitForSelector('text=Bonjour');
    await page.waitForSelector('.sync-pill:has-text("À jour")');
    await page.screenshot({ path: path.join(SHOTS, '02-accueil.png'), fullPage: true });

    // 2. Liste clients + filtre
    await page.click('.tab-link:has-text("Clients")');
    await page.waitForSelector('.card.list .row');
    const n = await page.locator('.card.list .row').count();
    assert.ok(n > 20, 'liste clients affichée (' + n + ')');
    await page.fill('input[type=search]', 'test 3');
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, '03-clients.png') });
    await page.click('.card.list .row >> nth=0');
    await page.waitForSelector('text=Historique');
    await page.screenshot({ path: path.join(SHOTS, '04-fiche.png'), fullPage: true });
    const clientUrl = page.url();

    // 3. Passage hors connexion, saisie d'une note avec relance
    await fetch(BASE + '/__test/offline?v=1');
    await ctx.setOffline(true);
    await page.waitForSelector('.sync-pill:has-text("Hors ligne")');
    await page.click('.client-head a.btn:has-text("Note")');
    await page.waitForSelector('textarea');
    await page.fill('textarea', 'Visite hors connexion : catalogue Noël déposé');
    await page.fill('input[placeholder^="Ex. rappeler"]', 'Rappeler pour la commande de Noël');
    await page.click('button.chip:has-text("+2 sem.")');
    await page.screenshot({ path: path.join(SHOTS, '05-note.png'), fullPage: true });
    await page.click('button:has-text("Enregistrer")');
    await page.waitForSelector('.sync-pill:has-text("2 en attente")');

    // 4. Rechargement complet hors ligne : l'application et les données sont toujours là
    await page.reload();
    await page.waitForSelector('.sync-pill:has-text("Hors ligne · 2 en attente")', { timeout: 10000 });
    await page.goto(clientUrl);
    await page.waitForSelector('text=Visite hors connexion');
    await page.waitForSelector('.pending-tag');
    await page.screenshot({ path: path.join(SHOTS, '06-hors-ligne.png'), fullPage: true });

    // 5. Retour du réseau : synchronisation automatique, aucune perte, aucun doublon
    await fetch(BASE + '/__test/offline?v=0');
    await ctx.setOffline(false);
    await page.waitForSelector('.sync-pill:has-text("À jour")', { timeout: 20000 });
    let visits = await (await fetch(BASE + '/__test/sheet?name=VISITES')).json();
    assert.strictEqual(visits.filter(r => String(r[5]).startsWith('Visite hors connexion')).length, 1, 'visite écrite une seule fois');
    const tasks = await (await fetch(BASE + '/__test/sheet?name=A%20FAIRE')).json();
    const t = tasks.find(r => r[2] === 'Rappeler pour la commande de Noël');
    assert.ok(t, 'tâche créée dans A FAIRE');
    assert.ok(t[7] === null || t[7] === undefined, 'formule RETARD intacte');

    // 6. Conflit : modification simultanée classeur + application
    await page.goto(clientUrl + '/edit');
    await page.waitForSelector('text=Enregistrer');
    const id = decodeURIComponent(clientUrl.split('/client/')[1]);
    const rowIndex = Number(id.split('-')[1]); // CLI-0003 -> ligne 3 (index 3 avec l'en-tête)
    await fetch(BASE + '/__test/set?name=CLIENTS&r=' + rowIndex + '&c=4&v=' + encodeURIComponent('Chef modifié dans Sheets'));
    await page.fill('input[autocomplete=off] >> nth=0', await page.inputValue('input[autocomplete=off] >> nth=0'));
    const contact = page.locator('label:has-text("Chef / contact") input');
    await contact.fill('Chef saisi sur téléphone');
    await page.click('button:has-text("Enregistrer")');
    await page.waitForSelector('.sync-pill:has-text("conflit")', { timeout: 20000 });
    await page.goto(BASE + '/#/reglages');
    await page.waitForSelector('text=Conflits à arbitrer');
    await page.screenshot({ path: path.join(SHOTS, '07-conflit.png'), fullPage: true });
    await page.click('button:has-text("Garder la mienne")');
    let clients;
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(500);
      clients = await (await fetch(BASE + '/__test/sheet?name=CLIENTS')).json();
      if (clients[rowIndex][4] === 'Chef saisi sur téléphone') break;
    }
    assert.strictEqual(clients[rowIndex][4], 'Chef saisi sur téléphone', 'valeur choisie appliquée');
    await page.waitForSelector('.sync-pill:has-text("À jour")', { timeout: 20000 });

    // 7. Journée de prospection
    await page.goto(BASE + '/#/plan/new');
    await page.waitForSelector('text=Ajouter des établissements');
    await page.click('.plan-edit button.row.as-button >> nth=0');
    await page.click('.plan-edit button.row.as-button >> nth=0');
    await page.screenshot({ path: path.join(SHOTS, '08a-preparation.png') });
    await page.click('button:has-text("Enregistrer la journée")');
    await page.waitForSelector('text=établissements vus');
    await page.screenshot({ path: path.join(SHOTS, '08-journee.png'), fullPage: true });

    // 8. Tableau de bord et tâches
    await page.goto(BASE + '/#/dashboard');
    await page.waitForSelector('text=Comptes rendus de la semaine');
    await page.screenshot({ path: path.join(SHOTS, '09-tableau-de-bord.png'), fullPage: true });
    await page.goto(BASE + '/#/taches');
    await page.waitForSelector('.task');
    await page.screenshot({ path: path.join(SHOTS, '10-taches.png'), fullPage: true });

    // 9. Version ordinateur
    const desk = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: 'fr-FR' });
    const dp = await desk.newPage();
    dp.on('pageerror', e => errors.push(e.message));
    await dp.goto(BASE + '/');
    await dp.fill('input[type=email]', 'chef@test.local');
    await dp.click('text=Recevoir un code');
    await dp.waitForSelector('input.code');
    const m2 = await (await fetch(BASE + '/__test/mails')).json();
    await dp.fill('input.code', m2[m2.length - 1].subject.match(/(\d{6})/)[1]);
    await dp.click('button:has-text("Se connecter")');
    await dp.waitForSelector('text=Bonjour');
    await dp.goto(BASE + '/#/dashboard');
    await dp.waitForSelector('.kpis');
    await dp.screenshot({ path: path.join(SHOTS, '11-ordinateur-tableau-de-bord.png'), fullPage: true });
    await dp.goto(BASE + '/#/clients');
    await dp.waitForSelector('table.table');
    await dp.screenshot({ path: path.join(SHOTS, '12-ordinateur-clients.png') });

    assert.deepStrictEqual(errors, [], 'aucune erreur JavaScript');
    console.log('E2E OK');
  } finally {
    await browser.close();
    server.kill();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
