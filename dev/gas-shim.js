// Simulateur minimal des services Google Apps Script utilisés par apps-script/Code.gs.
// Permet d'exécuter le vrai code serveur en local pour les tests (aucune donnée réelle).
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

class FakeRange {
  constructor(sheet, row, col, nr, nc) {
    Object.assign(this, { sheet, row, col, nr, nc });
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.nr; r++) {
      const line = [];
      for (let c = 0; c < this.nc; c++) {
        const v = (this.sheet.data[this.row - 1 + r] || [])[this.col - 1 + c];
        line.push(v === undefined || v === null ? '' : v);
      }
      out.push(line);
    }
    return out;
  }
  getValue() { return this.getValues()[0][0]; }
  getFormulas() {
    const out = [];
    for (let r = 0; r < this.nr; r++) {
      const line = [];
      for (let c = 0; c < this.nc; c++) line.push(this.sheet.formulas[(this.row + r) + ',' + (this.col + c)] || '');
      out.push(line);
    }
    return out;
  }
  setValues(vals) {
    if (vals.length !== this.nr || vals[0].length !== this.nc) throw new Error('Dimensions incorrectes');
    for (let r = 0; r < this.nr; r++) {
      for (let c = 0; c < this.nc; c++) {
        const rr = this.row - 1 + r, cc = this.col - 1 + c;
        if (this.sheet.formulas[(rr + 1) + ',' + (cc + 1)]) throw new Error('Écriture sur une formule en ' + (rr + 1) + ',' + (cc + 1));
        while (this.sheet.data.length <= rr) this.sheet.data.push([]);
        let v = vals[r][c];
        if (typeof v === 'string' && v.startsWith("'")) v = v.slice(1);
        this.sheet.data[rr][cc] = v;
      }
    }
    this.sheet.writes++;
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  setFontWeight() { return this; }
  getRow() { return this.row; }
  getColumn() { return this.col; }
  getNumRows() { return this.nr; }
  getNumColumns() { return this.nc; }
  getSheet() { return this.sheet; }
}

class FakeSheet {
  constructor(name, data, formulas) {
    this.name = name;
    this.data = data || [];
    this.formulas = formulas || {};
    this.hidden = false;
    this.writes = 0;
  }
  getName() { return this.name; }
  getLastRow() {
    for (let r = this.data.length - 1; r >= 0; r--) {
      if ((this.data[r] || []).some(v => v !== '' && v !== null && v !== undefined)) return r + 1;
    }
    return 0;
  }
  getLastColumn() {
    let m = 0;
    this.data.forEach(r => { for (let c = r.length - 1; c >= 0; c--) if (r[c] !== '' && r[c] !== undefined && r[c] !== null) { m = Math.max(m, c + 1); break; } });
    return m;
  }
  getMaxColumns() { return Math.max(26, this.getLastColumn()); }
  insertColumnAfter() {}
  getRange(row, col, nr, nc) { return new FakeRange(this, row, col, nr || 1, nc || 1); }
  getDataRange() { return new FakeRange(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  appendRow(row) { this.data.push(row.slice()); this.writes++; }
  setFrozenRows() {}
  hideSheet() { this.hidden = true; }
}

class FakeSpreadsheet {
  constructor() { this.sheets = {}; this.named = {}; }
  getSheetByName(n) { return this.sheets[n] || null; }
  insertSheet(n) { this.sheets[n] = new FakeSheet(n); return this.sheets[n]; }
  getRangeByName(n) { return this.named[n] || null; }
}

function createGas() {
  const ss = new FakeSpreadsheet();
  const cache = new Map();
  const mails = [];
  let locked = false;
  const sandbox = {
    console,
    SpreadsheetApp: { getActive: () => ss },
    CacheService: {
      getScriptCache: () => ({
        get: k => { const e = cache.get(k); if (!e || e.exp < Date.now()) return null; return e.v; },
        put: (k, v, s) => cache.set(k, { v: String(v), exp: Date.now() + (s || 600) * 1000 }),
        remove: k => cache.delete(k)
      })
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => { if (locked) return false; locked = true; return true; },
        releaseLock: () => { locked = false; }
      })
    },
    MailApp: { sendEmail: m => mails.push(m) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: s => ({ content: s, setMimeType() { return this; }, getContent() { return s; } })
    },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(s, 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
      formatDate: (d, tz, fmt) => {
        const p = new Intl.DateTimeFormat('fr-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
        if (fmt !== 'yyyy-MM-dd') throw new Error('format non simulé ' + fmt);
        return p;
      }
    },
    Session: { getScriptTimeZone: () => 'Europe/Paris' },
    Date, JSON, Math, String, Number, Array, Object, Error, isNaN, RegExp
  };
  vm.createContext(sandbox);
  const code = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  vm.runInContext(code, sandbox, { filename: 'Code.gs' });
  return {
    ss, mails, sandbox,
    post(body) {
      const out = sandbox.doPost({ postData: { contents: JSON.stringify(body) } });
      return JSON.parse(out.getContent());
    }
  };
}

module.exports = { createGas, FakeSheet };
