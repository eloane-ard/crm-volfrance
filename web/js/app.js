import { h, icon, toast } from './ui.js';
import { state, load, subscribe, sync, scheduleSync, pendingCount } from './store.js';
import { homeView } from './views/home.js';
import { clientsView, clientView, clientEditView } from './views/clients.js';
import { noteView, carnetView } from './views/note.js';
import { tourneesView, planEditView, planView } from './views/tournees.js';
import { tachesView, tacheEditView } from './views/taches.js';
import { dashboardView } from './views/dashboard.js';
import { settingsView, loginView } from './views/settings.js';

const ROUTES = [
  [/^\/?$/, homeView],
  [/^\/clients$/, clientsView],
  [/^\/client\/([^/]+)$/, clientView, ['id']],
  [/^\/client\/([^/]+)\/edit$/, clientEditView, ['id']],
  [/^\/prospect\/new$/, clientEditView],
  [/^\/note$/, noteView],
  [/^\/carnet$/, carnetView],
  [/^\/tournees$/, tourneesView],
  [/^\/plan\/new$/, planEditView, [], { id: 'new' }],
  [/^\/plan\/([^/]+)\/edit$/, planEditView, ['id']],
  [/^\/plan\/([^/]+)$/, planView, ['id']],
  [/^\/taches$/, tachesView],
  [/^\/tache\/([^/]+)$/, tacheEditView, ['id']],
  [/^\/dashboard$/, dashboardView],
  [/^\/reglages$/, settingsView],
  [/^\/login$/, loginView]
];

const NAV = [
  ['#/', 'home', 'Accueil', true],
  ['#/clients', 'users', 'Clients', true],
  ['#/note', 'plus', 'Note', true],
  ['#/tournees', 'route', 'Tournées', true],
  ['#/taches', 'check', 'Tâches', true],
  ['#/carnet', 'book', 'Carnet', false],
  ['#/dashboard', 'chart', 'Tableau de bord', false],
  ['#/reglages', 'gear', 'Réglages', false]
];

const app = document.getElementById('app');
const shell = {};
let current = null;

function buildShell() {
  shell.title = h('h1', { class: 'top-title' });
  shell.back = h('button', { type: 'button', class: 'icon-btn back', 'aria-label': 'Retour', onclick: () => history.length > 1 ? history.back() : (location.hash = '#/') }, icon('back'));
  shell.pill = h('a', { class: 'sync-pill', href: '#/reglages', 'aria-live': 'polite' });
  shell.menu = h('a', { class: 'icon-btn top-menu', href: '#/reglages', 'aria-label': 'Plus' }, icon('gear'));
  shell.top = h('header', { class: 'topbar' }, shell.back, shell.title, shell.pill, h('a', { class: 'icon-btn top-dash', href: '#/dashboard', 'aria-label': 'Tableau de bord' }, icon('chart')), shell.menu);
  shell.main = h('main', { id: 'main', tabindex: '-1' });
  shell.side = h('nav', { class: 'sidebar', 'aria-label': 'Navigation' },
    h('div', { class: 'side-brand' }, h('img', { src: 'icons/icon-192.png', alt: '', width: 32, height: 32 }), 'CRM Volaille'),
    h('a', { class: 'btn primary block side-note', href: '#/note' }, icon('plus'), 'Nouvelle note'),
    NAV.filter(n => n[0] !== '#/note').map(([href, ic, label]) => h('a', { class: 'side-link', href }, icon(ic), label)));
  shell.tabs = h('nav', { class: 'tabbar', 'aria-label': 'Navigation' }, NAV.filter(n => n[3]).map(([href, ic, label]) =>
    h('a', { class: 'tab-link' + (href === '#/note' ? ' tab-note' : ''), href }, icon(ic), h('span', null, label))));
  app.replaceChildren(shell.side, h('div', { class: 'content' }, shell.top, shell.main), shell.tabs);
}

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  return { path, query: new URLSearchParams(qs || '') };
}

function render() {
  if (!state.ready) return;
  const { path, query } = parseHash();
  if (!state.token && path !== '/login') { location.replace('#/login'); return; }
  let view = null;
  for (const [re, fn, names, extra] of ROUTES) {
    const m = path.match(re);
    if (m) {
      const params = { ...(extra || {}) };
      (names || []).forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
      view = fn(params, query);
      break;
    }
  }
  if (!view) view = { title: 'Page introuvable', el: h('p', null, 'Cette page n\'existe pas.'), back: true };
  current = { view, hash: location.hash };
  document.body.classList.toggle('bare', !!view.bare);
  shell.title.textContent = view.title;
  document.title = view.title + ' · CRM';
  shell.back.hidden = !view.back;
  shell.main.replaceChildren(view.el);
  const base = '#' + path.split('/').slice(0, 2).join('/');
  document.querySelectorAll('.side-link, .tab-link').forEach(a => {
    const href = a.getAttribute('href');
    a.classList.toggle('active', href === base || (href === '#/' && path === '/') || (href === '#/clients' && path.startsWith('/client')) || (href === '#/tournees' && path.startsWith('/plan')) || (href === '#/taches' && path.startsWith('/tache')));
  });
  updatePill();
}

function onStoreChange() {
  updatePill();
  if (!current || !current.view.live) return;
  const active = document.activeElement;
  // Ne pas redessiner sous les doigts de l'utilisatrice pendant une saisie.
  if (active && shell.main.contains(active) && /INPUT|TEXTAREA|SELECT/.test(active.tagName)) {
    if (current.view.refresh) current.view.refresh();
    return;
  }
  const y = window.scrollY;
  render();
  window.scrollTo(0, y);
}

function updatePill() {
  const n = pendingCount();
  const s = state.sync;
  let cls = 'ok', text;
  if (!navigator.onLine) { cls = 'offline'; text = 'Hors ligne' + (n ? ' · ' + n + ' en attente' : ''); }
  else if (s.needsLogin) { cls = 'error'; text = 'Reconnexion requise'; }
  else if (s.status === 'syncing') { cls = 'syncing'; text = 'Synchro…'; }
  else if (s.status === 'error') { cls = 'error'; text = 'Erreur' + (n ? ' · ' + n + ' en attente' : ''); }
  else if (n) { cls = 'pending'; text = n + ' en attente'; }
  else { text = 'À jour'; }
  if (state.conflicts.length) { cls = 'error'; text += ' · ' + state.conflicts.length + ' conflit' + (state.conflicts.length > 1 ? 's' : ''); }
  shell.pill.className = 'sync-pill ' + cls;
  shell.pill.replaceChildren(h('span', { class: 'dot' }), text);
  shell.pill.title = state.lastSync ? 'Dernière synchronisation : ' + new Date(state.lastSync).toLocaleString('fr-FR') : 'Jamais synchronisé';
}

async function start() {
  buildShell();
  try {
    await load();
  } catch (e) {
    app.replaceChildren(h('div', { class: 'login' }, h('div', { class: 'card login-card' }, h('h1', null, 'Stockage local indisponible'),
      h('p', null, 'Le navigateur refuse le stockage local (navigation privée ?). L\'application ne peut pas fonctionner hors connexion dans ce mode.'),
      h('p', { class: 'muted small' }, String(e && e.message || e)))));
    return;
  }
  subscribe(onStoreChange);
  window.addEventListener('hashchange', () => { render(); shell.main.focus({ preventScroll: true }); window.scrollTo(0, 0); });
  window.addEventListener('online', () => { updatePill(); scheduleSync(500); });
  window.addEventListener('offline', updatePill);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleSync(300); });
  setInterval(() => { if (document.visibilityState === 'visible') sync().catch(() => {}); }, 120000);
  render();
  if (state.token) scheduleSync(200);
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  registerSw();
}

function registerSw() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w && w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) {
          const bar = h('div', { class: 'update-bar' }, 'Nouvelle version disponible.',
            h('button', { type: 'button', class: 'btn sm primary', onclick: () => { w.postMessage('SKIP_WAITING'); } }, 'Mettre à jour'));
          document.body.append(bar);
        }
      });
    });
  }).catch(() => toast('Mode hors connexion indisponible sur ce navigateur.', 'error'));
  // Rechargement uniquement après une mise à jour acceptée, jamais à la première installation.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
}

start();
