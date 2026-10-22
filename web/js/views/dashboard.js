// Tableau de bord : indicateurs (mêmes règles que l'onglet TABLEAU DE BORD) et comptes rendus de la semaine.
import { h, select, fmtDate, download } from '../ui.js';
import { state, todayStr, addDays, clientInfo, isFollowed } from '../store.js';
import { section, emptyState } from '../components.js';
import { visitItem } from './note.js';
import { distinct } from './clients.js';

function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = (d.getDay() + 6) % 7;
  return addDays(dateStr, -day);
}

export function dashboardView(params, query) {
  const canSeeAll = state.user && (state.user.role === 'ADMIN' || state.user.role === 'RESPONSABLE');
  const com = query.get('com') || '';
  const today = todayStr();
  const week = query.get('semaine') || mondayOf(today);
  const keep = r => !com || r.commercial === com;

  const clients = [...state.clients.values()].filter(keep);
  const followed = clients.filter(isFollowed).map(c => ({ c, info: clientInfo(c) }));
  const count = p => followed.filter(x => x.info.priorite === p).length;
  const visites = [...state.visites.values()].filter(keep);
  const monthStart = today.slice(0, 8) + '01';
  const tasksLate = [...state.taches.values()].filter(keep).filter(t => t.statut !== 'FAIT' && t.dateRelance && t.dateRelance <= today);
  const prospects = clients.filter(c => c.etape);
  const prospectsOpen = prospects.filter(c => c.etape !== 'Converti' && c.etape !== 'Perdu');

  const kpis = [
    ['Clients suivis', followed.length, ''], ['Jamais visités', count('Jamais visité'), 'blue'], ['Urgents', count('Urgent'), 'red'],
    ['À revoir', count('À revoir'), 'amber'], ['Contacts ce mois-ci', visites.filter(v => v.type !== 'NOTE' && v.date >= monthStart && v.date <= today).length, 'green'],
    ['Actions échues', tasksLate.length, 'red'], ['Prospects en cours', prospectsOpen.length, 'blue']
  ];

  const tournees = distinct('tournee');
  const byTournee = [...tournees, ''].map(t => {
    const xs = followed.filter(x => (x.c.tournee || '') === t);
    return [t || 'Sans tournée', xs.length, ...['Jamais visité', 'Urgent', 'À revoir', 'OK'].map(p => xs.filter(x => x.info.priorite === p).length)];
  }).filter(r => r[1] > 0);

  const etapes = ['Nouveau', 'Contacté', 'Tarifs donné', 'Relance effectuée', 'Converti', 'Perdu'].map(e => [e, prospects.filter(c => c.etape === e).length]);

  // 12 derniers mois
  const months = [];
  const d0 = new Date(today.slice(0, 7) + '-01T00:00:00');
  for (let i = 11; i >= 0; i--) {
    const d = new Date(d0.getFullYear(), d0.getMonth() - i, 1);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    const vs = visites.filter(v => (v.date || '').startsWith(key) && v.type !== 'NOTE');
    months.push({ label: d.toLocaleDateString('fr-FR', { month: 'short' }), visites: vs.filter(v => v.type === 'VISITE').length, autres: vs.filter(v => v.type !== 'VISITE').length });
  }
  const max = Math.max(1, ...months.map(m => m.visites + m.autres));

  // Comptes rendus de la semaine
  const weekEnd = addDays(week, 6);
  const weekVisits = visites.filter(v => v.date >= week && v.date <= weekEnd).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const byCom = new Map();
  weekVisits.forEach(v => { const k = v.commercial || '—'; if (!byCom.has(k)) byCom.set(k, []); byCom.get(k).push(v); });
  const comName = code => (state.commerciaux.find(c => c.code === code) || {}).nom || code;
  const link = (k, v) => { const p = new URLSearchParams({ com, semaine: week }); p.set(k, v); return '#/dashboard?' + p; };

  const chart = h('div', { class: 'bars', role: 'img', 'aria-label': 'Contacts par mois sur 12 mois' }, months.map(m => {
    const col = h('div', { class: 'bar-col', title: m.label + ' : ' + m.visites + ' visites, ' + m.autres + ' appels/mails' },
      h('div', { class: 'bar-stack' }, h('div', { class: 'bar autres' }), h('div', { class: 'bar visites' })),
      h('div', { class: 'bar-val' }, String(m.visites + m.autres)),
      h('div', { class: 'bar-label' }, m.label));
    col.querySelector('.bar.visites').style.height = (m.visites * 100 / max) + '%';
    col.querySelector('.bar.autres').style.height = (m.autres * 100 / max) + '%';
    return col;
  }));

  const el = h('div', { class: 'stack' },
    canSeeAll && state.commerciaux.length > 1 ? h('div', { class: 'toolbar' }, select({ class: 'input sm', onchange: e => { location.hash = link('com', e.target.value); } },
      [['', 'Toute l\'équipe'], ...state.commerciaux.map(c => [c.code, c.nom || c.code])], com)) : null,
    h('div', { class: 'kpis' }, kpis.map(([l, v, k]) => h('div', { class: 'kpi ' + k }, h('div', { class: 'kpi-val' }, String(v)), h('div', { class: 'kpi-label' }, l)))),
    h('div', { class: 'grid-2col' },
      section('Suivi par tournée', h('div', { class: 'table-wrap' }, h('table', { class: 'table compact' },
        h('thead', null, h('tr', null, ['Tournée', 'Suivis', 'Jamais', 'Urgent', 'À revoir', 'OK'].map((t, i) => h('th', { class: i ? 'num' : null }, t)))),
        h('tbody', null, byTournee.map(r => h('tr', null, r.map((v, i) => h('td', { class: i ? 'num' : '' }, i === 0 ? h('a', { href: '#/clients?tournee=' + encodeURIComponent(r[0] === 'Sans tournée' ? '-' : r[0]) }, v) : String(v))))))))),
      section('Prospects par étape', h('table', { class: 'table compact' }, h('tbody', null, etapes.map(([e, n]) => h('tr', null, h('td', null, e), h('td', { class: 'num' }, String(n)))))))),
    section('Contacts des 12 derniers mois', chart, h('div', { class: 'legend' }, h('span', { class: 'dot visites' }), 'Visites', h('span', { class: 'dot autres' }), 'Appels, mails, messages')),
    section('Comptes rendus de la semaine',
      h('div', { class: 'week-nav' },
        h('a', { class: 'btn sm', href: link('semaine', addDays(week, -7)) }, '‹ Précédente'),
        h('strong', null, 'Du ' + fmtDate(week) + ' au ' + fmtDate(weekEnd)),
        h('a', { class: 'btn sm', href: link('semaine', addDays(week, 7)) }, 'Suivante ›'),
        weekVisits.length ? h('button', { type: 'button', class: 'btn sm', onclick: () => exportWeek(weekVisits, week, comName) }, 'Exporter (CSV)') : null),
      weekVisits.length ? [...byCom.entries()].map(([code, vs]) => h('div', { class: 'week-group' },
        canSeeAll ? h('h3', null, comName(code) + ' · ' + vs.length + ' compte' + (vs.length > 1 ? 's' : '') + ' rendu' + (vs.length > 1 ? 's' : '')) : null,
        vs.map(v => h('div', null, h('div', { class: 'muted small' }, fmtDate(v.date)), visitItem(v))))) : emptyState('Aucun compte rendu cette semaine.')));
  return { title: 'Tableau de bord', el, live: true };
}

function exportWeek(list, week, comName) {
  const esc = s => '"' + String(s === undefined || s === null ? '' : s).replace(/"/g, '""') + '"';
  const rows = [['Date', 'Commercial', 'Client', 'Ville', 'Type', 'Compte rendu', 'Produits', 'Remarques']]
    .concat(list.map(v => [v.date, comName(v.commercial), v.clientNom, v.ville, v.type, v.sujet, v.produits, v.remarques]));
  download('comptes-rendus-semaine-' + week + '.csv', '﻿' + rows.map(r => r.map(esc).join(';')).join('\r\n'), 'text/csv');
}
