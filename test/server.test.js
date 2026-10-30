'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createGas } = require('../dev/gas-shim');
const { seed } = require('../dev/seed');

function login(gas, email) {
  assert.deepStrictEqual(gas.post({ action: 'requestCode', email }), { ok: true });
  const mail = gas.mails[gas.mails.length - 1];
  const code = mail.subject.match(/(\d{6})/)[1];
  const res = gas.post({ action: 'verifyCode', email, code, device: 'test' });
  assert.ok(res.ok, JSON.stringify(res));
  return res.token;
}

test('connexion par code : adresse inconnue, mauvais code, bon code', () => {
  const gas = createGas();
  seed(gas.ss);
  assert.deepStrictEqual(gas.post({ action: 'requestCode', email: 'inconnu@test.local' }), { ok: true });
  assert.strictEqual(gas.mails.length, 0, 'aucun e-mail pour une adresse non autorisée');

  gas.post({ action: 'requestCode', email: 'Eloane@Test.local ' });
  assert.strictEqual(gas.mails.length, 1);
  assert.strictEqual(gas.post({ action: 'verifyCode', email: 'eloane@test.local', code: '000000' }).error, 'BAD_CODE');
  const code = gas.mails[0].subject.match(/(\d{6})/)[1];
  const ok = gas.post({ action: 'verifyCode', email: 'eloane@test.local', code });
  assert.ok(ok.token && ok.token.length >= 64);
  assert.strictEqual(ok.user.role, 'ADMIN');
  // Le code ne peut pas être réutilisé.
  assert.strictEqual(gas.post({ action: 'verifyCode', email: 'eloane@test.local', code }).error, 'CODE_EXPIRED');
  // Le jeton n'est jamais stocké en clair.
  const stored = gas.ss.sheets['_SESSIONS'].data.flat().join('|');
  assert.ok(!stored.includes(ok.token));
});

test('accès refusé sans jeton valide et après déconnexion', () => {
  const gas = createGas();
  seed(gas.ss);
  assert.strictEqual(gas.post({ action: 'pull' }).error, 'UNAUTHORIZED');
  assert.strictEqual(gas.post({ action: 'pull', token: 'faux' }).error, 'UNAUTHORIZED');
  const token = login(gas, 'eloane@test.local');
  assert.ok(gas.post({ action: 'pull', token }).ok);
  gas.post({ action: 'logout', token });
  assert.strictEqual(gas.post({ action: 'pull', token }).error, 'UNAUTHORIZED');
});

test('lecture : un commercial ne voit que son portefeuille, la responsable voit tout', () => {
  const gas = createGas();
  seed(gas.ss, { secondUser: true });
  const marie = gas.post({ action: 'pull', token: login(gas, 'marie@test.local') });
  assert.ok(marie.clients.length > 0);
  assert.ok(marie.clients.every(c => c.commercial === 'MARIE'));
  assert.ok(marie.visites.every(v => v.commercial === 'MARIE'));
  const chef = gas.post({ action: 'pull', token: login(gas, 'chef@test.local') });
  assert.strictEqual(chef.clients.length, 40);
  assert.strictEqual(chef.commerciaux.length, 3);
  const c = chef.clients[0];
  assert.match(c.majLe, /^\d{4}-\d{2}-\d{2}T/);
  const v = chef.visites[0];
  assert.match(v.date, /^\d{4}-\d{2}-\d{2}$/);
});

test('création de visite + tâche, rejouée deux fois sans doublon', () => {
  const gas = createGas();
  seed(gas.ss);
  const token = login(gas, 'eloane@test.local');
  const muts = [
    { mid: 'm1', entity: 'visite', op: 'create', id: 'VIS-abc123', fields: { clientId: 'CLI-0003', date: '2026-10-22', type: 'VISITE', sujet: 'Catalogue Noël' } },
    { mid: 'm2', entity: 'tache', op: 'create', id: 'TAC-abc123', fields: { clientId: 'CLI-0003', visiteId: 'VIS-abc123', action: 'Rappeler', dateRelance: '2026-11-05', priorite: 'HAUTE' } }
  ];
  const r1 = gas.post({ action: 'push', token, mutations: muts });
  assert.deepStrictEqual(r1.results.map(r => r.status), ['applied', 'applied']);
  const r2 = gas.post({ action: 'push', token, mutations: muts });
  assert.deepStrictEqual(r2.results.map(r => r.status), ['applied', 'applied']);
  assert.ok(r2.results.every(r => r.replay));
  // Même identifiant avec un autre mid (ex. après réinstallation) : pas de doublon non plus.
  const r3 = gas.post({ action: 'push', token, mutations: [{ ...muts[0], mid: 'm3' }] });
  assert.ok(r3.results[0].duplicate);

  const visits = gas.ss.sheets['VISITES'].data;
  assert.strictEqual(visits.filter(r => r[8] === 'VIS-abc123').length, 1);
  const row = visits.find(r => r[8] === 'VIS-abc123');
  assert.strictEqual(row[0], 'Établissement test 3', 'nom du client recopié');
  assert.ok(row[3] instanceof Date);

  const tasks = gas.ss.sheets['A FAIRE'];
  const trow = tasks.data.find(r => r[8] === 'TAC-abc123');
  assert.strictEqual(trow[6], 'A FAIRE');
  assert.strictEqual(trow[7], undefined, 'colonne RETARD (formule) jamais écrite');
  assert.strictEqual(tasks.data.indexOf(trow), 7, 'ajoutée juste après la dernière tâche');
});

test('modification : fusion champ par champ et conflit sans perte', () => {
  const gas = createGas();
  seed(gas.ss);
  const token = login(gas, 'eloane@test.local');
  const before = gas.post({ action: 'pull', token }).clients.find(c => c.id === 'CLI-0002');

  // Quelqu'un modifie le téléphone dans le classeur.
  gas.ss.sheets['CLIENTS'].data[2][5] = '06.00.00.00.00';

  const res = gas.post({ action: 'push', token, mutations: [{
    mid: 'u1', entity: 'client', op: 'update', id: 'CLI-0002',
    fields: { tel: '07.11.11.11.11', remarques: 'Nouveau chef', couverts: 450 },
    base: { tel: before.tel, remarques: before.remarques, couverts: before.couverts }
  }] });
  const r = res.results[0];
  assert.strictEqual(r.status, 'conflict');
  assert.deepStrictEqual(r.conflicts.map(c => c.field), ['tel']);
  assert.strictEqual(r.record.tel, '06.00.00.00.00', 'la valeur du classeur est conservée');
  assert.strictEqual(r.record.remarques, 'Nouveau chef', 'les autres champs sont appliqués');
  assert.strictEqual(r.record.couverts, 450);
  assert.strictEqual(r.record.version, 2);
  const conf = gas.ss.sheets['_CONFLITS'].data;
  assert.strictEqual(conf.length, 2);
  assert.strictEqual(conf[1][6], '07.11.11.11.11', 'la valeur saisie dans l\'application est gardée');
});

test('tâche marquée FAIT : date de réalisation remplie', () => {
  const gas = createGas();
  seed(gas.ss);
  const token = login(gas, 'eloane@test.local');
  const r = gas.post({ action: 'push', token, mutations: [{ mid: 'f1', entity: 'tache', op: 'update', id: 'TAC-0002', fields: { statut: 'FAIT' }, base: { statut: 'A FAIRE' } }] });
  assert.strictEqual(r.results[0].status, 'applied');
  assert.match(r.results[0].record.faitLe, /^\d{4}-\d{2}-\d{2}$/);
});

test('un commercial ne peut pas modifier le client d\'un autre', () => {
  const gas = createGas();
  seed(gas.ss, { secondUser: true });
  const token = login(gas, 'marie@test.local');
  const r = gas.post({ action: 'push', token, mutations: [{ mid: 'x1', entity: 'client', op: 'update', id: 'CLI-0001', fields: { remarques: 'x' } }] });
  assert.strictEqual(r.results[0].error, 'FORBIDDEN');
});

test('création de prospect et texte commençant par = neutralisé', () => {
  const gas = createGas();
  seed(gas.ss);
  const token = login(gas, 'eloane@test.local');
  const r = gas.post({ action: 'push', token, mutations: [{ mid: 'p1', entity: 'client', op: 'create', id: 'CLI-newp01', fields: { nom: 'Mairie Test', ville: 'Rennes', remarques: '=IMPORTXML("x")', commercial: 'PIRATE', version: 99 } }] });
  const rec = r.results[0].record;
  assert.strictEqual(rec.statut, 'PROSPECT');
  assert.strictEqual(rec.version, 1);
  assert.strictEqual(rec.commercial, 'ELOANE');
  const row = gas.ss.sheets['CLIENTS'].data.find(x => x[16] === 'CLI-newp01');
  assert.strictEqual(row[9], '=IMPORTXML("x")'.replace(/^/, ''), 'stocké comme texte (apostrophe retirée par Sheets)');
});

test('plans de prospection : onglet créé automatiquement', () => {
  const gas = createGas();
  seed(gas.ss);
  const token = login(gas, 'eloane@test.local');
  const r = gas.post({ action: 'push', token, mutations: [{ mid: 'pl1', entity: 'plan', op: 'create', id: 'PLN-a1b2c3', fields: { date: '2026-10-24', nom: 'Secteur Rennes', clientIds: 'CLI-0025,CLI-0026' } }] });
  assert.strictEqual(r.results[0].status, 'applied');
  const pull = gas.post({ action: 'pull', token });
  assert.strictEqual(pull.plans.length, 1);
  assert.strictEqual(pull.plans[0].clientIds, 'CLI-0025,CLI-0026');
});

test('écriture refusée par le classeur : seule la modification concernée échoue, puis passe au renvoi', () => {
  const gas = createGas();
  seed(gas.ss);
  // Cases à cocher décochées sur des centaines de lignes vides (comme la colonne DESTOCKAGE).
  const clients = gas.ss.sheets['CLIENTS'];
  for (let r = clients.data.length; r < 600; r++) { const row = new Array(21).fill(''); row[14] = false; clients.data.push(row); }
  // Validation stricte : la colonne CLIENTS de VISITES refuse un nom inconnu.
  gas.ss.sheets['VISITES'].reject = (r, c, v) => c === 0 && v === 'Résidence Nouvelle';
  const token = login(gas, 'eloane@test.local');
  const muts = [
    { mid: 'w1', entity: 'client', op: 'create', id: 'CLI-NEW001', fields: { nom: 'Résidence Nouvelle', ville: 'Bécherel', statut: 'PROSPECT' } },
    { mid: 'w2', entity: 'visite', op: 'create', id: 'VIS-NEW001', fields: { clientId: 'CLI-NEW001', date: '2026-10-30', type: 'VISITE', sujet: 'Première visite' } },
    { mid: 'w3', entity: 'visite', op: 'create', id: 'VIS-NEW002', fields: { clientId: 'CLI-0002', date: '2026-10-30', type: 'VISITE', sujet: 'Autre visite' } }
  ];
  const r1 = gas.post({ action: 'push', token, mutations: muts });
  assert.ok(r1.ok);
  assert.deepStrictEqual(r1.results.map(r => r.status), ['applied', 'error', 'applied']);
  assert.strictEqual(r1.results[1].error, 'WRITE_FAILED');
  assert.match(r1.results[1].message, /validation/);
  const rowIdx = clients.data.findIndex(r => r[16] === 'CLI-NEW001');
  assert.strictEqual(rowIdx, 41, 'nouveau client juste après les données, pas après les cases vides');
  const visits = gas.ss.sheets['VISITES'].data;
  assert.ok(!visits.some(r => r[8] === 'VIS-NEW001'), 'aucune ligne partielle');
  assert.ok(visits.some(r => r[8] === 'VIS-NEW002'));

  // La règle est assouplie : le renvoi de la même modification passe, sans doublon.
  gas.ss.sheets['VISITES'].reject = null;
  const r2 = gas.post({ action: 'push', token, mutations: muts });
  assert.deepStrictEqual(r2.results.map(r => r.status), ['applied', 'applied', 'applied']);
  assert.strictEqual(visits.filter(r => r[8] === 'VIS-NEW001').length, 1);
  assert.strictEqual(visits.filter(r => r[8] === 'VIS-NEW002').length, 1);
});
