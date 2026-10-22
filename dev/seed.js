// Données fictives reprenant la structure exacte du classeur (aucune donnée client réelle).
'use strict';
const { FakeSheet } = require('./gas-shim');

const CLIENT_HEADERS = ['ETABLISSEMENT', 'TYPE DE CLIENTS', 'VILLE/SECTEUR', 'GROUPEMENT', 'CUISINIER', 'TELEPHONE', 'EMAIL',
  'TOURNEE', 'JOUR ET INDICATIONS LIVRAISON', 'REMARQUES', 'STATUT', 'ETAPE PROSPECTION', 'DATE DE DEMARCHAGE',
  'COUVERTS/JOUR', 'DESTOCKAGE', 'CODE ACCES', 'ID', 'COMMERCIAL', 'MAJ LE', 'MAJ PAR', 'VERSION'];
const VISIT_HEADERS = ['CLIENTS', 'VILLE', 'GROUPEMENT', 'DATE', 'TYPE DE CONTACT', 'SUJET', 'PRODUITS PRESENTES', 'REMARQUES',
  'ID', 'CLIENT_ID', 'COMMERCIAL', 'CREE LE', 'MAJ LE', 'VERSION'];
const TASK_HEADERS = ['CLIENT', 'VILLE', 'ACTION A FAIRE', 'DATE DE CREATION', 'DATE DE RELANCE', 'PRIORITE', 'STATUT',
  'RETARD (JOURS)', 'ID', 'CLIENT_ID', 'VISITE_ID', 'FAIT LE', 'COMMERCIAL', 'MAJ LE', 'VERSION'];

const TOURNEES = [['205 B', 'LUN/MAR/JEU/VEN/SAM', ['Dinard', 'Pleurtuit']], ['205 D', 'LUN/MAR/MER/JEU/VEN/SAM', ['St Malo', 'Cancale']],
  ['205 E', 'MAR/JEU/VEN', ['Fougères', 'Combourg']], ['205 I', 'MAR/MER/JEU/VEN/SAM', ['Rennes', 'Vitre']], ['205 L', 'MAR/JEU/VEN', ['Avranches', 'Granville']]];
const TYPES = ['COLLEGE', 'LYCEE', 'EHPAD', 'RESTAURANT SCO', 'CUISINE CENTRALE', 'RESTAURANT PRO'];
const GROUPS = ['SCA', 'PRO CLUB', 'BREIZH ACHAT', 'GOAL', 'CACIC', 'GENERAL', 'HORS MARCHE'];

function d(daysAgo) {
  const x = new Date();
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - daysAgo);
  return x;
}

function seed(ss, opts) {
  opts = opts || {};
  const now = new Date();
  const clients = [CLIENT_HEADERS];
  let n = 0;
  TOURNEES.forEach(([t, jours, villes], ti) => {
    for (let k = 0; k < 8; k++) {
      n++;
      const statut = k === 7 ? 'NON SUIVI' : (k >= 5 ? 'PROSPECT' : 'CLIENT');
      clients.push([`Établissement test ${n}`, TYPES[(n + ti) % TYPES.length], villes[k % 2], GROUPS[n % GROUPS.length],
        k % 3 ? '' : 'Chef ' + n, '02.99.00.00.' + String(n).padStart(2, '0'), '', t, jours, k === 2 ? 'Appeler si destock' : '',
        statut, statut === 'PROSPECT' ? 'Contacté' : '', statut === 'PROSPECT' ? d(30 + n) : '', k === 1 ? 300 + n * 10 : '',
        k === 2, '', 'CLI-' + String(n).padStart(4, '0'), opts.secondUser && n > 30 ? 'MARIE' : 'ELOANE', now, 'ELOANE', 1]);
    }
  });
  ss.sheets['CLIENTS'] = new FakeSheet('CLIENTS', clients);

  const visits = [VISIT_HEADERS];
  for (let v = 1; v <= 30; v++) {
    const c = clients[1 + (v * 7) % (clients.length - 1)];
    visits.push([c[0], c[2], c[3], d(v * 4), v % 5 ? 'VISITE' : 'APPEL', 'Compte rendu test ' + v, '', '',
      'VIS-' + String(v).padStart(4, '0'), c[16], c[17], now, now, 1]);
  }
  ss.sheets['VISITES'] = new FakeSheet('VISITES', visits);

  const tasks = [TASK_HEADERS];
  for (let t = 1; t <= 6; t++) {
    const c = clients[1 + t * 3];
    tasks.push([c[0], c[2], 'Rappeler pour rendez-vous ' + t, d(20), d(10 - t * 3), t % 2 ? 'HAUTE' : 'MOYENNE',
      t === 1 ? 'FAIT' : 'A FAIRE', '', 'TAC-' + String(t).padStart(4, '0'), c[16], '', '', c[17], now, 1]);
  }
  // Colonne RETARD calculée par une formule matricielle, comme dans le vrai classeur.
  ss.sheets['A FAIRE'] = new FakeSheet('A FAIRE', tasks, { '2,8': '=MAP(E2:E;G2:G;LAMBDA(d;s;IF(OR(s<>"A FAIRE";d="");;IF(d<TODAY();TODAY()-d;))))' });

  const users = [['CODE', 'NOM', 'EMAIL', 'ROLE', 'ACTIF'], ['ELOANE', 'Eloane', 'eloane@test.local', 'ADMIN', 'OUI']];
  if (opts.secondUser) {
    users.push(['MARIE', 'Marie', 'marie@test.local', 'COMMERCIAL', 'OUI']);
    users.push(['CHEF', 'Responsable', 'chef@test.local', 'RESPONSABLE', 'OUI']);
  }
  ss.sheets['COMMERCIAUX'] = new FakeSheet('COMMERCIAUX', users);
  return ss;
}

module.exports = { seed };
