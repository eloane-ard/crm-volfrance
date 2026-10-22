// Serveur de développement : sert l'application et exécute le vrai Code.gs sur des données fictives.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createGas } = require('./gas-shim');
const { seed } = require('./seed');

const PORT = Number(process.env.PORT || 8080);
const ROOT = path.join(__dirname, '..', 'web');
const gas = createGas();
seed(gas.ss, { secondUser: true });
let offline = false;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api' && req.method === 'POST') {
    if (offline) { req.socket.destroy(); return; }
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const out = gas.sandbox.doPost({ postData: { contents: body } });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(out.getContent());
    });
    return;
  }
  // Points de contrôle réservés aux tests automatiques.
  if (url.pathname === '/__test/mails') { res.end(JSON.stringify(gas.mails)); return; }
  if (url.pathname === '/__test/offline') { offline = url.searchParams.get('v') === '1'; res.end('ok'); return; }
  if (url.pathname === '/__test/sheet') { res.end(JSON.stringify(gas.ss.sheets[url.searchParams.get('name')].data)); return; }
  if (url.pathname === '/__test/set') {
    const s = gas.ss.sheets[url.searchParams.get('name')];
    s.data[Number(url.searchParams.get('r'))][Number(url.searchParams.get('c'))] = url.searchParams.get('v');
    res.end('ok');
    return;
  }
  let file = path.normalize(path.join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  if (url.pathname === '/js/config.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    res.end(fs.readFileSync(file, 'utf8').replace(/API_URL: '[^']*'/, "API_URL: '/api'"));
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}).listen(PORT, () => console.log('CRM dev : http://localhost:' + PORT + '  (connexion : eloane@test.local, code affiché dans /__test/mails)'));
