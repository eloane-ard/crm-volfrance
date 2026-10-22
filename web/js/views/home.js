// Accueil : ce qui compte aujourd'hui, accessible en un geste.
import { h, icon, fmtDateLong } from '../ui.js';
import { state, todayStr, addDays, clientInfo, isFollowed } from '../store.js';
import { section, emptyState, clientRow } from '../components.js';
import { taskItem } from './taches.js';
import { visitItem } from './note.js';

export function homeView() {
  const today = todayStr();
  const soon = addDays(today, 7);
  const tasks = [...state.taches.values()].filter(t => t.statut !== 'FAIT' && t.dateRelance && t.dateRelance <= soon)
    .sort((a, b) => a.dateRelance.localeCompare(b.dateRelance));
  const plans = [...state.plans.values()].filter(p => !p.supprime && p.date === today);
  const urgent = [...state.clients.values()].filter(isFollowed).map(c => ({ c, info: clientInfo(c) }))
    .filter(x => x.info.priorite === 'Urgent').sort((a, b) => b.info.days - a.info.days).slice(0, 6);
  const recent = [...state.visites.values()].sort((a, b) => (b.creeLe || b.date || '').localeCompare(a.creeLe || a.date || '')).slice(0, 4);
  const prenom = state.user && state.user.nom ? state.user.nom.split(' ')[0] : '';

  const el = h('div', { class: 'stack' },
    h('div', { class: 'hello' }, h('h1', null, 'Bonjour' + (prenom ? ' ' + prenom : '')), h('p', { class: 'muted' }, fmtDateLong(today))),
    h('div', { class: 'quick' },
      h('a', { class: 'quick-btn primary', href: '#/note' }, icon('plus'), h('span', null, 'Nouvelle note')),
      h('a', { class: 'quick-btn', href: '#/clients' }, icon('search'), h('span', null, 'Trouver un client')),
      h('a', { class: 'quick-btn', href: '#/plan/new' }, icon('route'), h('span', null, 'Préparer une tournée')),
      h('a', { class: 'quick-btn', href: '#/prospect/new' }, icon('users'), h('span', null, 'Nouveau prospect'))),
    plans.length ? section('Tournée du jour', h('div', { class: 'list' }, plans.map(p => h('a', { class: 'row', href: '#/plan/' + encodeURIComponent(p.id) },
      h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, p.nom || 'Journée de prospection'), h('div', { class: 'row-sub' }, (p.clientIds || '').split(',').filter(Boolean).length + ' établissements')),
      icon('route'))))) : null,
    section('Relances (7 prochains jours)', tasks.length ? h('div', { class: 'list' }, tasks.slice(0, 12).map(t => taskItem(t))) : emptyState('Aucune relance prévue.'),
      tasks.length > 12 ? h('a', { class: 'more-link', href: '#/taches' }, 'Voir les ' + tasks.length + ' relances') : null),
    section('À revoir en priorité', urgent.length ? h('div', { class: 'list' }, urgent.map(x => clientRow(x.c))) : emptyState('Aucun client urgent.'),
      h('a', { class: 'more-link', href: '#/clients?prio=Urgent&tri=priorite' }, 'Tous les clients urgents')),
    recent.length ? section('Dernières notes', recent.map(v => visitItem(v)), h('a', { class: 'more-link', href: '#/carnet' }, 'Ouvrir le carnet')) : null);
  return { title: 'Accueil', el, live: true };
}
