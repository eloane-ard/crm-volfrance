/**
 * CRM Volaille - API de synchronisation (Google Apps Script lié au classeur).
 *
 * Le classeur reste la base principale. L'application (PWA) appelle ce script en POST :
 *   requestCode  -> envoie un code de connexion à 6 chiffres par e-mail
 *   verifyCode   -> échange ce code contre un jeton de session
 *   pull         -> renvoie les données autorisées pour l'utilisateur
 *   push         -> applique une file de modifications (idempotent, gestion des conflits)
 *   logout       -> révoque la session courante
 */

var APP = {
  SESSION_DAYS: 90,
  OTP_MINUTES: 10,
  OTP_MAX_TRIES: 5,
  OTP_MAX_SENDS_PER_HOUR: 5,
  LOCK_MS: 25000,
  SHEETS_USER: 'SHEETS'
};

// Correspondance champs de l'application <-> en-têtes du classeur.
var ENTITIES = {
  client: {
    sheet: 'CLIENTS',
    fields: {
      nom: 'ETABLISSEMENT', type: 'TYPE DE CLIENTS', ville: 'VILLE/SECTEUR', groupement: 'GROUPEMENT',
      contact: 'CUISINIER', tel: 'TELEPHONE', email: 'EMAIL', tournee: 'TOURNEE',
      livraison: 'JOUR ET INDICATIONS LIVRAISON', remarques: 'REMARQUES', statut: 'STATUT',
      etape: 'ETAPE PROSPECTION', dateDemarchage: 'DATE DE DEMARCHAGE', couverts: 'COUVERTS/JOUR',
      destockage: 'DESTOCKAGE', codeAcces: 'CODE ACCES', id: 'ID', commercial: 'COMMERCIAL',
      majLe: 'MAJ LE', majPar: 'MAJ PAR', version: 'VERSION'
    },
    dates: ['dateDemarchage'],
    booleans: ['destockage'],
    numbers: ['couverts']
  },
  visite: {
    sheet: 'VISITES',
    fields: {
      clientNom: 'CLIENTS', ville: 'VILLE', groupement: 'GROUPEMENT', date: 'DATE', type: 'TYPE DE CONTACT',
      sujet: 'SUJET', produits: 'PRODUITS PRESENTES', remarques: 'REMARQUES', id: 'ID', clientId: 'CLIENT_ID',
      commercial: 'COMMERCIAL', creeLe: 'CREE LE', majLe: 'MAJ LE', majPar: 'MAJ PAR', version: 'VERSION'
    },
    dates: ['date'],
    booleans: [],
    numbers: []
  },
  tache: {
    sheet: 'A FAIRE',
    fields: {
      clientNom: 'CLIENT', ville: 'VILLE', action: 'ACTION A FAIRE', dateCreation: 'DATE DE CREATION',
      dateRelance: 'DATE DE RELANCE', priorite: 'PRIORITE', statut: 'STATUT', id: 'ID', clientId: 'CLIENT_ID',
      visiteId: 'VISITE_ID', faitLe: 'FAIT LE', commercial: 'COMMERCIAL', majLe: 'MAJ LE', majPar: 'MAJ PAR',
      version: 'VERSION'
    },
    dates: ['dateCreation', 'dateRelance', 'faitLe'],
    booleans: [],
    numbers: []
  },
  plan: {
    sheet: 'PROSPECTION',
    fields: {
      id: 'ID', date: 'DATE', nom: 'NOM', clientIds: 'CLIENTS', faits: 'FAITS', commercial: 'COMMERCIAL',
      supprime: 'SUPPRIME', majLe: 'MAJ LE', majPar: 'MAJ PAR', version: 'VERSION'
    },
    dates: ['date'],
    booleans: ['supprime'],
    numbers: []
  }
};

// Champs que l'application n'a jamais le droit d'écrire directement.
var TECH_FIELDS = ['id', 'commercial', 'majLe', 'majPar', 'version', 'creeLe'];

// ---------------------------------------------------------------------------
// Point d'entrée HTTP
// ---------------------------------------------------------------------------

function doGet() {
  return json_({ ok: true, app: 'crm-volaille', time: new Date().toISOString() });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'BAD_JSON' });
  }
  try {
    return json_(route_(req));
  } catch (err) {
    var code = err && err.code ? err.code : 'SERVER_ERROR';
    if (code === 'SERVER_ERROR') console.error(err && err.stack ? err.stack : err);
    return json_({ ok: false, error: code, message: String(err && err.message || err) });
  }
}

function route_(req) {
  switch (req.action) {
    case 'requestCode': return requestCode_(req);
    case 'verifyCode': return verifyCode_(req);
    case 'pull': return pull_(auth_(req));
    case 'push': return push_(auth_(req), req.mutations || []);
    case 'logout': return logout_(req);
    case 'ping': return { ok: true, user: publicUser_(auth_(req)) };
    default: throw err_('UNKNOWN_ACTION');
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function err_(code, message) {
  var e = new Error(message || code);
  e.code = code;
  return e;
}

// ---------------------------------------------------------------------------
// Authentification : code à usage unique par e-mail puis jeton de session
// ---------------------------------------------------------------------------

function normEmail_(email) {
  return String(email || '').trim().toLowerCase();
}

function findUser_(email) {
  email = normEmail_(email);
  if (!email) return null;
  var rows = readObjects_(sheet_('COMMERCIAUX'));
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (normEmail_(r['EMAIL']) === email && String(r['ACTIF'] || '').toUpperCase() !== 'NON') {
      return {
        email: email,
        code: String(r['CODE'] || '').trim(),
        nom: String(r['NOM'] || '').trim(),
        role: String(r['ROLE'] || 'COMMERCIAL').trim().toUpperCase()
      };
    }
  }
  return null;
}

function publicUser_(u) {
  return { email: u.email, code: u.code, nom: u.nom, role: u.role };
}

function requestCode_(req) {
  var email = normEmail_(req.email);
  var cache = CacheService.getScriptCache();
  var sendKey = 'otpsend:' + email;
  var sends = Number(cache.get(sendKey) || 0);
  if (sends >= APP.OTP_MAX_SENDS_PER_HOUR) throw err_('TOO_MANY_REQUESTS');
  cache.put(sendKey, String(sends + 1), 3600);

  var user = findUser_(email);
  // Même réponse que l'adresse soit autorisée ou non : on ne révèle pas la liste.
  if (!user) return { ok: true };

  var code = String(100000 + Math.floor(Math.random() * 900000));
  cache.put('otp:' + email, JSON.stringify({ h: sha256_(code + '|' + email), tries: 0 }), APP.OTP_MINUTES * 60);
  MailApp.sendEmail({
    to: email,
    subject: 'Code de connexion CRM : ' + code,
    body: 'Votre code de connexion à l\'application CRM est : ' + code + '\n\n' +
      'Il est valable ' + APP.OTP_MINUTES + ' minutes. Si vous n\'avez rien demandé, ignorez ce message.'
  });
  return { ok: true };
}

function verifyCode_(req) {
  var email = normEmail_(req.email);
  var code = String(req.code || '').replace(/\D/g, '');
  var cache = CacheService.getScriptCache();
  var raw = cache.get('otp:' + email);
  if (!raw) throw err_('CODE_EXPIRED');
  var otp = JSON.parse(raw);
  if (otp.tries >= APP.OTP_MAX_TRIES) {
    cache.remove('otp:' + email);
    throw err_('CODE_EXPIRED');
  }
  if (sha256_(code + '|' + email) !== otp.h) {
    otp.tries++;
    cache.put('otp:' + email, JSON.stringify(otp), APP.OTP_MINUTES * 60);
    throw err_('BAD_CODE');
  }
  cache.remove('otp:' + email);
  var user = findUser_(email);
  if (!user) throw err_('FORBIDDEN');

  var token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  var now = new Date();
  var exp = new Date(now.getTime() + APP.SESSION_DAYS * 86400000);
  sheet_('_SESSIONS').appendRow([sha256_(token), email, now, exp, now, String(req.device || '').slice(0, 120), '']);
  return { ok: true, token: token, user: publicUser_(user), expires: exp.toISOString() };
}

function auth_(req) {
  var token = String(req.token || '');
  if (!token) throw err_('UNAUTHORIZED');
  var h = sha256_(token);
  var sh = sheet_('_SESSIONS');
  var values = sh.getDataRange().getValues();
  var now = new Date();
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (row[0] !== h) continue;
    if (row[6]) throw err_('UNAUTHORIZED'); // révoquée
    if (new Date(row[3]).getTime() < now.getTime()) throw err_('UNAUTHORIZED');
    var user = findUser_(row[1]);
    if (!user) throw err_('UNAUTHORIZED');
    // Session glissante : prolongée à chaque utilisation.
    var exp = new Date(now.getTime() + APP.SESSION_DAYS * 86400000);
    sh.getRange(i + 1, 4, 1, 2).setValues([[exp, now]]);
    return user;
  }
  throw err_('UNAUTHORIZED');
}

function logout_(req) {
  var h = sha256_(String(req.token || ''));
  var sh = sheet_('_SESSIONS');
  var values = sh.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === h) sh.getRange(i + 1, 7).setValue('REVOQUEE ' + new Date().toISOString());
  }
  return { ok: true };
}

function sha256_(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

function canSeeAll_(user) {
  return user.role === 'ADMIN' || user.role === 'RESPONSABLE';
}

function pull_(user) {
  var all = canSeeAll_(user);
  var out = { ok: true, serverTime: new Date().toISOString(), user: publicUser_(user) };
  ['client', 'visite', 'tache', 'plan'].forEach(function (name) {
    var list = readEntities_(name).filter(function (o) {
      if (!o.id) return false;
      return all || o.commercial === user.code;
    });
    if (name === 'plan') list = list.filter(function (o) { return !o.supprime; });
    out[name + 's'] = list;
  });
  out.commerciaux = all ? readObjects_(sheet_('COMMERCIAUX')).map(function (r) {
    return { code: String(r['CODE'] || ''), nom: String(r['NOM'] || ''), role: String(r['ROLE'] || '') };
  }).filter(function (c, i, arr) {
    return c.code && arr.findIndex(function (x) { return x.code === c.code; }) === i;
  }) : [{ code: user.code, nom: user.nom, role: user.role }];
  out.settings = readSettings_();
  return out;
}

function readSettings_() {
  var s = { seuilARevoir: 40, seuilUrgent: 57 };
  try {
    var ss = SpreadsheetApp.getActive();
    var a = ss.getRangeByName && ss.getRangeByName('SEUIL_A_REVOIR');
    var u = ss.getRangeByName && ss.getRangeByName('SEUIL_URGENT');
    if (a && Number(a.getValue())) s.seuilARevoir = Number(a.getValue());
    if (u && Number(u.getValue())) s.seuilUrgent = Number(u.getValue());
  } catch (e) { /* valeurs par défaut */ }
  return s;
}

function readEntities_(name) {
  var def = ENTITIES[name];
  var sh = sheet_(def.sheet);
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var idx = headerIndex_(values[0]);
  var list = [];
  for (var i = 1; i < values.length; i++) {
    var o = rowToEntity_(def, idx, values[i]);
    if (o.id) list.push(o);
  }
  return list;
}

function rowToEntity_(def, idx, row) {
  var o = {};
  Object.keys(def.fields).forEach(function (f) {
    var c = idx[def.fields[f]];
    o[f] = fromCell_(def, f, c === undefined ? '' : row[c]);
  });
  return o;
}

function fromCell_(def, field, v) {
  if (def.booleans.indexOf(field) >= 0) return v === true || String(v).toUpperCase() === 'TRUE' || String(v).toUpperCase() === 'OUI';
  if (v instanceof Date) {
    if (field === 'majLe' || field === 'creeLe') return v.toISOString();
    return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
  }
  if (field === 'version') return Number(v) || 0;
  if (def.numbers.indexOf(field) >= 0) return v === '' || v === null ? '' : Number(v);
  return v === null || v === undefined ? '' : String(v).trim();
}

function toCell_(def, field, v) {
  if (def.booleans.indexOf(field) >= 0) return v === true || v === 'true';
  if (def.dates.indexOf(field) >= 0) {
    if (!v) return '';
    var m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return '';
  }
  if (def.numbers.indexOf(field) >= 0) return v === '' || v === null || isNaN(Number(v)) ? '' : Number(v);
  if (v === null || v === undefined) return '';
  var s = String(v);
  // Empêche qu'un texte commençant par = + - @ soit interprété comme une formule.
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function tz_() {
  return Session.getScriptTimeZone() || 'Europe/Paris';
}

// ---------------------------------------------------------------------------
// Écriture : file de modifications
// ---------------------------------------------------------------------------

function push_(user, mutations) {
  if (!Array.isArray(mutations)) throw err_('BAD_REQUEST');
  if (mutations.length > 200) throw err_('BATCH_TOO_LARGE');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(APP.LOCK_MS)) throw err_('BUSY');
  try {
    var journal = sheet_('_JOURNAL');
    var done = loadJournal_(journal);
    var ctx = { cache: {}, user: user, now: new Date() };
    var results = [];
    var journalRows = [];
    mutations.forEach(function (m) {
      var res;
      if (!m || !m.mid) {
        res = { mid: m && m.mid, status: 'error', error: 'BAD_MUTATION' };
      } else if (done[m.mid]) {
        res = done[m.mid];
        res.mid = m.mid;
        res.replay = true;
      } else {
        try {
          res = applyMutation_(ctx, m);
        } catch (e) {
          res = { status: 'error', error: e.code || 'SERVER_ERROR', message: String(e.message || e) };
        }
        res.mid = m.mid;
        if (res.status !== 'error' || res.error !== 'SERVER_ERROR') {
          var summary = { status: res.status, error: res.error, duplicate: res.duplicate };
          journalRows.push([m.mid, ctx.now, user.email, m.entity, m.id, m.op, res.status, JSON.stringify(summary)]);
          done[m.mid] = summary;
        }
      }
      results.push(res);
    });
    flushCache_(ctx);
    if (journalRows.length) {
      journal.getRange(journal.getLastRow() + 1, 1, journalRows.length, journalRows[0].length).setValues(journalRows);
    }
    return { ok: true, results: results, serverTime: new Date().toISOString() };
  } finally {
    lock.releaseLock();
  }
}

function loadJournal_(journal) {
  var map = {};
  var last = journal.getLastRow();
  if (last < 2) return map;
  var values = journal.getRange(2, 1, last - 1, 8).getValues();
  values.forEach(function (r) {
    var res;
    try { res = JSON.parse(r[7]); } catch (e) { res = { status: r[6] }; }
    map[r[0]] = res;
  });
  return map;
}

/** Charge une feuille en mémoire une seule fois par lot de modifications. */
function table_(ctx, name) {
  if (ctx.cache[name]) return ctx.cache[name];
  var def = ENTITIES[name];
  var sh = sheet_(def.sheet);
  var lastCol = sh.getLastColumn();
  var lastRow = sh.getLastRow();
  var header = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var idx = headerIndex_(header);
  var values = lastRow > 1 ? sh.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];
  // Colonnes calculées par une formule matricielle (ex. RETARD) : ne jamais écrire dedans.
  var formulas = lastRow > 1 ? sh.getRange(2, 1, 1, lastCol).getFormulas()[0] : [];
  var idCol = idx['ID'];
  var rowById = {};
  // Dernière ligne réellement remplie (les formules matricielles allongent getLastRow).
  var dataEnd = 0;
  values.forEach(function (r, i) {
    if (r[idCol]) rowById[r[idCol]] = i;
    for (var c = 0; c < r.length; c++) {
      if (r[c] !== '' && r[c] !== null && !(formulas[c] && /^=\s*(MAP|ARRAYFORMULA|BYROW)/i.test(formulas[c]))) {
        dataEnd = i + 1;
        break;
      }
    }
  });
  ctx.cache[name] = {
    def: def, sheet: sh, header: header, idx: idx, values: values, rowById: rowById,
    skipCols: formulas.map(function (f) { return /^=\s*(MAP|ARRAYFORMULA|BYROW)/i.test(f || ''); }),
    dirty: {}, dataEnd: dataEnd
  };
  return ctx.cache[name];
}

function flushCache_(ctx) {
  Object.keys(ctx.cache).forEach(function (name) {
    var t = ctx.cache[name];
    Object.keys(t.dirty).forEach(function (k) {
      var i = Number(k);
      writeRow_(t, i);
    });
  });
}

function writeRow_(t, i) {
  var row = t.values[i];
  // Écrit des blocs contigus en sautant les colonnes calculées.
  var c = 0;
  while (c < row.length) {
    if (t.skipCols[c]) { c++; continue; }
    var start = c;
    while (c < row.length && !t.skipCols[c]) c++;
    t.sheet.getRange(i + 2, start + 1, 1, c - start).setValues([row.slice(start, c)]);
  }
}

function applyMutation_(ctx, m) {
  var def = ENTITIES[m.entity];
  if (!def) throw err_('UNKNOWN_ENTITY');
  if (!m.id || !/^[A-Za-z0-9_-]{3,64}$/.test(m.id)) throw err_('BAD_ID');
  var t = table_(ctx, m.entity);
  var user = ctx.user;
  var fields = sanitize_(def, m.fields || {});

  if (m.op === 'create') {
    if (t.rowById[m.id] !== undefined) {
      return { status: 'applied', duplicate: true, record: entityAt_(t, t.rowById[m.id]) };
    }
    var rec = {};
    Object.keys(fields).forEach(function (f) { rec[f] = fields[f]; });
    rec.id = m.id;
    rec.commercial = user.code;
    if (canSeeAll_(user) && m.fields && m.fields.commercial && isCommercialCode_(ctx, m.fields.commercial)) {
      rec.commercial = String(m.fields.commercial);
    }
    rec.version = 1;
    rec.majLe = ctx.now;
    rec.majPar = user.code;
    if (def.fields.creeLe) rec.creeLe = ctx.now;
    if (m.entity === 'client' && !rec.statut) rec.statut = 'PROSPECT';
    if (m.entity === 'tache') {
      if (!rec.statut) rec.statut = 'A FAIRE';
      if (!rec.dateCreation) rec.dateCreation = Utilities.formatDate(ctx.now, tz_(), 'yyyy-MM-dd');
    }
    denormalize_(ctx, m.entity, rec);
    var row = new Array(t.header.length);
    for (var c = 0; c < row.length; c++) row[c] = '';
    Object.keys(rec).forEach(function (f) {
      var col = t.idx[def.fields[f]];
      if (col === undefined) return;
      row[col] = (f === 'majLe' || f === 'creeLe' || f === 'version' || f === 'commercial' || f === 'majPar' || f === 'id')
        ? rec[f] : toCell_(def, f, rec[f]);
    });
    var i = t.dataEnd;
    t.values[i] = row;
    t.dataEnd = i + 1;
    t.rowById[m.id] = i;
    t.dirty[i] = true;
    return { status: 'applied', record: entityAt_(t, i) };
  }

  if (m.op === 'update') {
    var ri = t.rowById[m.id];
    if (ri === undefined) throw err_('NOT_FOUND');
    var current = entityAt_(t, ri);
    if (!canSeeAll_(user) && current.commercial !== user.code) throw err_('FORBIDDEN');
    var base = m.base || {};
    var conflicts = [];
    var changed = false;
    if (m.entity === 'tache' && fields.statut === 'FAIT' && current.statut !== 'FAIT' && !fields.faitLe) {
      fields.faitLe = Utilities.formatDate(ctx.now, tz_(), 'yyyy-MM-dd');
    }
    Object.keys(fields).forEach(function (f) {
      var col = t.idx[def.fields[f]];
      if (col === undefined) return;
      var cur = norm_(current[f]);
      var mine = norm_(fields[f]);
      if (cur === mine) return;
      var hasBase = Object.prototype.hasOwnProperty.call(base, f);
      if (!hasBase || cur === norm_(base[f])) {
        t.values[ri][col] = toCell_(def, f, fields[f]);
        changed = true;
      } else {
        conflicts.push({ field: f, server: current[f], mine: fields[f], base: base[f] });
      }
    });
    if ((m.entity === 'visite' || m.entity === 'tache') && fields.clientId !== undefined && norm_(fields.clientId) !== norm_(current.clientId)) {
      var rec2 = { clientId: fields.clientId };
      denormalize_(ctx, m.entity, rec2);
      ['clientNom', 'ville', 'groupement'].forEach(function (f) {
        if (!def.fields[f]) return;
        t.values[ri][t.idx[def.fields[f]]] = toCell_(def, f, rec2[f] || '');
      });
      changed = true;
    }
    if (changed) {
      t.values[ri][t.idx['VERSION']] = (Number(t.values[ri][t.idx['VERSION']]) || 0) + 1;
      t.values[ri][t.idx['MAJ LE']] = ctx.now;
      if (t.idx['MAJ PAR'] !== undefined) t.values[ri][t.idx['MAJ PAR']] = user.code;
      t.dirty[ri] = true;
    }
    if (conflicts.length) logConflicts_(ctx, m, conflicts);
    return { status: conflicts.length ? 'conflict' : 'applied', conflicts: conflicts, record: entityAt_(t, ri) };
  }

  throw err_('UNKNOWN_OP');
}

function isCommercialCode_(ctx, code) {
  if (!ctx.codes) {
    ctx.codes = readObjects_(sheet_('COMMERCIAUX')).map(function (r) { return String(r['CODE'] || '').trim(); });
  }
  return ctx.codes.indexOf(String(code)) >= 0;
}

function sanitize_(def, input) {
  var out = {};
  Object.keys(input).forEach(function (f) {
    if (!def.fields[f] || TECH_FIELDS.indexOf(f) >= 0) return;
    var v = input[f];
    if (typeof v === 'string') v = v.slice(0, 5000);
    out[f] = v;
  });
  return out;
}

/** Recopie nom, ville et groupement du client dans la visite ou la tâche (lisibilité du classeur). */
function denormalize_(ctx, entity, rec) {
  if ((entity !== 'visite' && entity !== 'tache') || !rec.clientId) return;
  var ct = table_(ctx, 'client');
  var ci = ct.rowById[rec.clientId];
  if (ci === undefined) return;
  var c = entityAt_(ct, ci);
  rec.clientNom = c.nom;
  rec.ville = c.ville;
  if (entity === 'visite') rec.groupement = c.groupement;
}

function entityAt_(t, i) {
  return rowToEntity_(t.def, t.idx, t.values[i]);
}

function norm_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v).trim();
}

function logConflicts_(ctx, m, conflicts) {
  var sh = sheet_('_CONFLITS');
  var rows = conflicts.map(function (c) {
    return [ctx.now, ctx.user.code, m.entity, m.id, c.field, String(c.server), String(c.mine), ''];
  });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

// ---------------------------------------------------------------------------
// Utilitaires classeur
// ---------------------------------------------------------------------------

function sheet_(name) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(name);
  if (sh) return sh;
  var headers = {
    '_SESSIONS': ['TOKEN_HASH', 'EMAIL', 'CREE LE', 'EXPIRE LE', 'VU LE', 'APPAREIL', 'REVOQUEE'],
    '_JOURNAL': ['MUTATION_ID', 'DATE', 'EMAIL', 'ENTITE', 'ID', 'OPERATION', 'RESULTAT', 'DETAIL'],
    '_CONFLITS': ['DATE', 'COMMERCIAL', 'ENTITE', 'ID', 'CHAMP', 'VALEUR CLASSEUR', 'VALEUR APPLICATION', 'TRAITE'],
    'PROSPECTION': ['ID', 'DATE', 'NOM', 'CLIENTS', 'FAITS', 'COMMERCIAL', 'SUPPRIME', 'MAJ LE', 'MAJ PAR', 'VERSION'],
    'COMMERCIAUX': ['CODE', 'NOM', 'EMAIL', 'ROLE', 'ACTIF']
  }[name];
  if (!headers) throw err_('MISSING_SHEET', 'Onglet introuvable : ' + name);
  sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sh.setFrozenRows(1);
  if (name.charAt(0) === '_') sh.hideSheet();
  return sh;
}

function headerIndex_(header) {
  var idx = {};
  header.forEach(function (h, i) {
    var k = String(h || '').trim();
    if (k && idx[k] === undefined) idx[k] = i;
  });
  return idx;
}

function readObjects_(sh) {
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var header = values[0].map(function (h) { return String(h || '').trim(); });
  return values.slice(1).map(function (r) {
    var o = {};
    header.forEach(function (h, i) { if (h) o[h] = r[i]; });
    return o;
  });
}

// ---------------------------------------------------------------------------
// Installation et saisie manuelle dans le classeur
// ---------------------------------------------------------------------------

/** À lancer une fois depuis l'éditeur Apps Script : crée les onglets et colonnes manquants. */
function installer() {
  ['_SESSIONS', '_JOURNAL', '_CONFLITS', 'PROSPECTION', 'COMMERCIAUX'].forEach(sheet_);
  Object.keys(ENTITIES).forEach(function (name) {
    var def = ENTITIES[name];
    var sh = sheet_(def.sheet);
    var header = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0];
    var idx = headerIndex_(header);
    Object.keys(def.fields).forEach(function (f) {
      var h = def.fields[f];
      if (idx[h] === undefined) {
        var col = sh.getLastColumn() + 1;
        if (col > sh.getMaxColumns()) sh.insertColumnAfter(sh.getMaxColumns());
        sh.getRange(1, col).setValue(h);
        idx[h] = col - 1;
      }
    });
  });
  return 'Installation terminée';
}

var WATCHED_SHEETS = { 'CLIENTS': 'CLI', 'VISITES': 'VIS', 'A FAIRE': 'TAC', 'PROSPECTION': 'PLN' };

/**
 * Déclencheur simple : quand vous modifiez une ligne à la main dans le classeur,
 * il horodate la ligne et lui donne un identifiant si elle n'en a pas.
 * L'application récupère ainsi vos modifications à la prochaine synchronisation.
 */
function onEdit(e) {
  try {
    var sh = e.range.getSheet();
    var prefix = WATCHED_SHEETS[sh.getName()];
    if (!prefix) return;
    var r0 = e.range.getRow();
    var nr = e.range.getNumRows();
    if (r0 + nr - 1 < 2) return;
    var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var idx = headerIndex_(header);
    var techCols = ['ID', 'MAJ LE', 'MAJ PAR', 'VERSION', 'COMMERCIAL', 'CREE LE'].map(function (h) { return idx[h]; });
    var c0 = e.range.getColumn() - 1;
    var onlyTech = true;
    for (var c = c0; c < c0 + e.range.getNumColumns(); c++) if (techCols.indexOf(c) < 0) onlyTech = false;
    if (onlyTech) return;
    var start = Math.max(2, r0);
    var rows = sh.getRange(start, 1, r0 + nr - start, header.length).getValues();
    var now = new Date();
    var defaultCode = defaultCommercial_();
    rows.forEach(function (row, k) {
      var filled = row.some(function (v, c) { return v !== '' && techCols.indexOf(c) < 0; });
      if (!filled) return;
      var r = start + k;
      if (idx['ID'] !== undefined && !row[idx['ID']]) {
        sh.getRange(r, idx['ID'] + 1).setValue(prefix + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 10).toUpperCase());
      }
      if (idx['COMMERCIAL'] !== undefined && !row[idx['COMMERCIAL']] && defaultCode) {
        sh.getRange(r, idx['COMMERCIAL'] + 1).setValue(defaultCode);
      }
      if (idx['MAJ LE'] !== undefined) sh.getRange(r, idx['MAJ LE'] + 1).setValue(now);
      if (idx['MAJ PAR'] !== undefined) sh.getRange(r, idx['MAJ PAR'] + 1).setValue(APP.SHEETS_USER);
      if (idx['VERSION'] !== undefined) sh.getRange(r, idx['VERSION'] + 1).setValue((Number(row[idx['VERSION']]) || 0) + 1);
      if (sh.getName() === 'A FAIRE' && idx['FAIT LE'] !== undefined && idx['STATUT'] !== undefined &&
          String(row[idx['STATUT']]).toUpperCase() === 'FAIT' && !row[idx['FAIT LE']]) {
        sh.getRange(r, idx['FAIT LE'] + 1).setValue(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
      }
    });
  } catch (err) {
    console.error(err);
  }
}

/** Code du commercial attribué aux lignes saisies à la main (le premier ADMIN de COMMERCIAUX). */
function defaultCommercial_() {
  var rows = readObjects_(sheet_('COMMERCIAUX'));
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i]['ROLE']).toUpperCase() === 'ADMIN') return String(rows[i]['CODE'] || '');
  }
  return rows.length ? String(rows[0]['CODE'] || '') : '';
}
