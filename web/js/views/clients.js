// Liste des clients et prospects, fiche client, modification et création de prospect.
import { h, icon, toast, field, select, badge, fmtDate, relDays, norm, prioKind, statutKind } from '../ui.js';
import { state, mutate, genId, clientInfo, isFollowed, visitIndex, todayStr } from '../store.js';
import { clientRow, emptyState, section, pendingDot } from '../components.js';
import { visitItem } from './note.js';
import { taskItem } from './taches.js';

export const STATUTS = ['CLIENT', 'PROSPECT', 'PERDU', 'NON SUIVI'];
export const ETAPES = ['', 'Nouveau', 'Contacté', 'Tarifs donné', 'Relance effectuée', 'Converti', 'Perdu'];
const PRIOS = ['Urgent', 'À revoir', 'Jamais visité', 'OK'];

export function distinct(field) {
  const s = new Set();
  state.clients.forEach(c => { if (c[field]) s.add(c[field]); });
  return [...s].sort((a, b) => a.localeCompare(b, 'fr'));
}

export function filterClients(f) {
  const terms = norm(f.q).split(/\s+/).filter(Boolean);
  const list = [];
  state.clients.forEach(c => {
    if (f.statut === 'suivis' ? !isFollowed(c) : (f.statut && f.statut !== 'tous' && c.statut !== f.statut)) return;
    if (f.tournee && (f.tournee === '-' ? c.tournee : c.tournee !== f.tournee)) return;
    if (f.type && c.type !== f.type) return;
    if (f.groupement && c.groupement !== f.groupement) return;
    if (f.ville && c.ville !== f.ville) return;
    if (f.destock && !c.destockage) return;
    if (f.commercial && c.commercial !== f.commercial) return;
    const info = clientInfo(c);
    if (f.prio && info.priorite !== f.prio) return;
    if (terms.length) {
      const hay = norm([c.nom, c.ville, c.contact, c.groupement, c.tournee, c.type, c.remarques].join(' '));
      if (!terms.every(t => hay.includes(t))) return;
    }
    list.push({ c, info });
  });
  const prioOrder = { 'Urgent': 0, 'À revoir': 1, 'Jamais visité': 2, 'OK': 3 };
  const sorters = {
    nom: (a, b) => a.c.nom.localeCompare(b.c.nom, 'fr') || a.c.ville.localeCompare(b.c.ville, 'fr'),
    ville: (a, b) => a.c.ville.localeCompare(b.c.ville, 'fr') || a.c.nom.localeCompare(b.c.nom, 'fr'),
    visite: (a, b) => (a.info.lastVisit || '0').localeCompare(b.info.lastVisit || '0'),
    priorite: (a, b) => (prioOrder[a.info.priorite] - prioOrder[b.info.priorite]) || ((b.info.days || 0) - (a.info.days || 0))
  };
  list.sort(sorters[f.tri] || sorters.nom);
  return list;
}

export function readFilters(query) {
  return {
    q: query.get('q') || '', statut: query.get('statut') || 'suivis', tournee: query.get('tournee') || '',
    type: query.get('type') || '', groupement: query.get('groupement') || '', ville: query.get('ville') || '',
    prio: query.get('prio') || '', destock: query.get('destock') === '1', tri: query.get('tri') || 'nom',
    commercial: query.get('commercial') || ''
  };
}

export function filterBar(f, onChange) {
  const set = (k, v) => { f[k] = v; onChange(f); };
  const search = h('input', { type: 'search', class: 'input grow', placeholder: 'Nom, ville, chef, groupement…', value: f.q, oninput: e => { f.q = e.target.value; debounce(() => onChange(f)); } });
  const canSeeAll = state.user && (state.user.role === 'ADMIN' || state.user.role === 'RESPONSABLE');
  return h('div', { class: 'filters' },
    h('div', { class: 'toolbar' }, h('div', { class: 'search-wrap' }, icon('search'), search)),
    h('div', { class: 'filter-row' },
      select({ class: 'input sm', 'aria-label': 'Statut', onchange: e => set('statut', e.target.value) },
        [['suivis', 'Clients + prospects'], ['CLIENT', 'Clients'], ['PROSPECT', 'Prospects'], ['PERDU', 'Perdus'], ['NON SUIVI', 'Non suivis'], ['tous', 'Tous']], f.statut),
      select({ class: 'input sm', 'aria-label': 'Tournée', onchange: e => set('tournee', e.target.value) }, [['', 'Toutes tournées'], ...distinct('tournee'), ['-', 'Sans tournée']], f.tournee),
      select({ class: 'input sm', 'aria-label': 'Priorité', onchange: e => set('prio', e.target.value) }, [['', 'Toute priorité'], ...PRIOS], f.prio),
      select({ class: 'input sm', 'aria-label': 'Type', onchange: e => set('type', e.target.value) }, [['', 'Tous types'], ...distinct('type')], f.type),
      select({ class: 'input sm', 'aria-label': 'Groupement', onchange: e => set('groupement', e.target.value) }, [['', 'Tous groupements'], ...distinct('groupement')], f.groupement),
      select({ class: 'input sm', 'aria-label': 'Ville', onchange: e => set('ville', e.target.value) }, [['', 'Toutes villes'], ...distinct('ville')], f.ville),
      canSeeAll && state.commerciaux.length > 1 ? select({ class: 'input sm', 'aria-label': 'Commercial', onchange: e => set('commercial', e.target.value) }, [['', 'Tous commerciaux'], ...state.commerciaux.map(c => [c.code, c.nom || c.code])], f.commercial) : null,
      select({ class: 'input sm', 'aria-label': 'Tri', onchange: e => set('tri', e.target.value) }, [['nom', 'Tri : nom'], ['ville', 'Tri : ville'], ['priorite', 'Tri : priorité'], ['visite', 'Tri : dernière visite']], f.tri),
      h('label', { class: 'chip toggle' + (f.destock ? ' selected' : '') }, h('input', { type: 'checkbox', checked: f.destock, onchange: e => set('destock', e.target.checked) }), 'Déstockage')));
}

let debTimer;
function debounce(fn) { clearTimeout(debTimer); debTimer = setTimeout(fn, 250); }

function toQuery(f) {
  const p = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => {
    if (v === true) p.set(k, '1');
    else if (v && !(k === 'statut' && v === 'suivis') && !(k === 'tri' && v === 'nom')) p.set(k, v);
  });
  return p.toString();
}

export function clientsView(params, query) {
  const f = readFilters(query);
  const el = h('div', { class: 'stack' });
  const results = h('div');
  const count = h('span', { class: 'muted' });

  function renderList() {
    const list = filterClients(f);
    count.textContent = list.length + ' établissement' + (list.length > 1 ? 's' : '');
    const desktop = window.matchMedia('(min-width: 900px)').matches;
    if (!list.length) { results.replaceChildren(emptyState('Aucun établissement ne correspond aux filtres.')); return; }
    if (desktop) {
      results.replaceChildren(h('div', { class: 'table-wrap card' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, ['Établissement', 'Ville', 'Type', 'Groupement', 'Tournée', 'Statut', 'Dernière visite', 'Priorité'].map(t => h('th', null, t)))),
        h('tbody', null, list.slice(0, 500).map(({ c, info }) => h('tr', { class: 'clickable', onclick: () => { location.hash = '#/client/' + encodeURIComponent(c.id); } },
          h('td', null, h('a', { href: '#/client/' + encodeURIComponent(c.id) }, c.nom), c._pending ? icon('clock', 'pending-icon') : null, c.destockage ? badge('Déstock', 'amber') : null),
          h('td', null, c.ville), h('td', null, c.type), h('td', null, c.groupement), h('td', null, c.tournee),
          h('td', null, badge(c.statut === 'PROSPECT' && c.etape ? 'Prospect · ' + c.etape : c.statut, statutKind(c.statut))),
          h('td', null, info.lastVisit ? fmtDate(info.lastVisit) : '—'),
          h('td', null, isFollowed(c) ? badge(info.priorite + (info.days ? ' (' + info.days + ' j)' : ''), prioKind(info.priorite)) : '')))))));
    } else {
      results.replaceChildren(h('div', { class: 'card list' }, list.slice(0, 300).map(({ c }) => clientRow(c))));
    }
  }

  el.append(
    h('div', { class: 'page-head' }, count, h('a', { class: 'btn', href: '#/prospect/new' }, icon('plus'), 'Prospect')),
    filterBar(f, nf => { history.replaceState(null, '', '#/clients?' + toQuery(nf)); renderList(); }),
    results);
  renderList();
  return { title: 'Clients', el, live: true, refresh: renderList };
}

export function clientView(params) {
  const c = state.clients.get(params.id);
  if (!c) return { title: 'Client', el: emptyState('Fiche introuvable (peut-être pas encore synchronisée).'), back: true };
  const info = clientInfo(c);
  const { byClient } = visitIndex();
  const visits = byClient.get(c.id) || [];
  const tasks = [...state.taches.values()].filter(t => t.clientId === c.id && t.statut !== 'FAIT')
    .sort((a, b) => (a.dateRelance || '9').localeCompare(b.dateRelance || '9'));
  const mapsUrl = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(c.nom + ' ' + c.ville);
  const tel = (c.tel || '').replace(/[^\d+]/g, '');
  const codeBtn = c.codeAcces ? h('button', { type: 'button', class: 'link', onclick: e => { e.target.replaceWith(h('strong', null, c.codeAcces)); } }, 'Afficher') : null;

  const el = h('div', { class: 'stack' },
    h('section', { class: 'card client-head' },
      h('div', { class: 'client-title' }, h('h1', null, c.nom), pendingDot(c)),
      h('p', { class: 'muted' }, [c.type, c.ville, c.groupement].filter(Boolean).join(' · ')),
      h('div', { class: 'badges' },
        badge(c.statut === 'PROSPECT' && c.etape ? 'Prospect · ' + c.etape : c.statut, statutKind(c.statut)),
        isFollowed(c) ? badge(info.priorite, prioKind(info.priorite)) : null,
        c.destockage ? badge('Intéressé déstockage', 'amber') : null,
        h('span', { class: 'muted small' }, 'Dernier contact : ' + (info.lastVisit ? fmtDate(info.lastVisit) + ' (' + relDays(info.days).toLowerCase() + ')' : 'jamais'))),
      h('div', { class: 'action-grid' },
        h('a', { class: 'btn primary big', href: '#/note?client=' + encodeURIComponent(c.id) }, icon('plus'), 'Note'),
        tel ? h('a', { class: 'btn big', href: 'tel:' + tel }, icon('phone'), 'Appeler') : null,
        c.email ? h('a', { class: 'btn big', href: 'mailto:' + c.email }, icon('mail'), 'Mail') : null,
        h('a', { class: 'btn big', href: mapsUrl, target: '_blank', rel: 'noopener' }, icon('map'), 'Itinéraire'),
        h('a', { class: 'btn big', href: '#/client/' + encodeURIComponent(c.id) + '/edit' }, icon('edit'), 'Modifier'))),
    section('Informations', h('dl', { class: 'info-grid' },
      info2('Chef / contact', c.contact), info2('Téléphone', c.tel), info2('E-mail', c.email),
      info2('Tournée', c.tournee), info2('Livraison', c.livraison), info2('Couverts/jour', c.couverts),
      c.statut !== 'CLIENT' ? info2('Étape prospection', c.etape) : null,
      c.dateDemarchage ? info2('Date de démarchage', fmtDate(c.dateDemarchage)) : null,
      c.codeAcces ? info2('Code d\'accès', codeBtn) : null,
      info2('Remarques', c.remarques))),
    tasks.length ? section('Actions à faire', tasks.map(t => taskItem(t, { hideClient: true }))) : null,
    section('Historique (' + visits.length + ')', visits.length ? visits.map(v => visitItem(v, { hideClient: true })) : emptyState('Aucun compte rendu pour ce client.')));
  return { title: c.nom, el, back: true, live: true };
}

function info2(label, value) {
  if (value === '' || value === null || value === undefined) return null;
  return [h('dt', null, label), h('dd', null, value)];
}

export function clientEditView(params) {
  const isNew = !params.id;
  const c = isNew ? { statut: 'PROSPECT', etape: 'Nouveau', dateDemarchage: todayStr() } : state.clients.get(params.id);
  if (!c) return { title: 'Modifier', el: emptyState('Fiche introuvable.'), back: true };
  const data = {};
  const input = (k, attrs) => h('input', { class: 'input', value: c[k] === undefined ? '' : c[k], oninput: e => { data[k] = e.target.value; }, ...(attrs || {}) });
  const datalist = (id, values) => h('datalist', { id }, values.map(v => h('option', { value: v })));

  const statut = select({ class: 'input', onchange: e => { data.statut = e.target.value; } }, STATUTS, c.statut);
  const etape = select({ class: 'input', onchange: e => { data.etape = e.target.value; } }, ETAPES.map(v => [v, v || '—']), c.etape || '');
  const destock = h('input', { type: 'checkbox', checked: !!c.destockage, onchange: e => { data.destockage = e.target.checked; } });

  const el = h('form', { class: 'stack', novalidate: true },
    datalist('dl-type', distinct('type')), datalist('dl-groupement', distinct('groupement')), datalist('dl-ville', distinct('ville')), datalist('dl-tournee', distinct('tournee')),
    section('Établissement',
      field('Nom *', input('nom', { required: true, autocomplete: 'off' })),
      h('div', { class: 'grid2' }, field('Ville *', input('ville', { list: 'dl-ville' })), field('Type', input('type', { list: 'dl-type' }))),
      h('div', { class: 'grid2' }, field('Groupement', input('groupement', { list: 'dl-groupement' })), field('Statut', statut)),
      h('div', { class: 'grid2' }, field('Étape prospection', etape), field('Date de démarchage', input('dateDemarchage', { type: 'date' })))),
    section('Contact',
      field('Chef / contact', input('contact')),
      h('div', { class: 'grid2' }, field('Téléphone', input('tel', { type: 'tel', inputmode: 'tel' })), field('E-mail', input('email', { type: 'email', inputmode: 'email' })))),
    section('Livraison et potentiel',
      h('div', { class: 'grid2' }, field('Tournée', input('tournee', { list: 'dl-tournee' })), field('Jours et indications de livraison', input('livraison'))),
      h('div', { class: 'grid2' }, field('Couverts/jour', input('couverts', { type: 'number', inputmode: 'numeric', min: 0 })), field('Code d\'accès (portail)', input('codeAcces', { autocomplete: 'off' }))),
      h('label', { class: 'inline-check' }, destock, ' Intéressé par le déstockage (à appeler)'),
      field('Remarques', h('textarea', { class: 'input', rows: 3, oninput: e => { data.remarques = e.target.value; } }, c.remarques || ''))),
    h('div', { class: 'sticky-actions' }, h('button', { type: 'submit', class: 'btn primary big block' }, icon('check'), isNew ? 'Créer le prospect' : 'Enregistrer')));

  el.addEventListener('submit', async e => {
    e.preventDefault();
    const merged = { ...c, ...data };
    if (!String(merged.nom || '').trim() || !String(merged.ville || '').trim()) { toast('Le nom et la ville sont obligatoires.', 'error'); return; }
    if (data.couverts !== undefined) data.couverts = data.couverts === '' ? '' : Number(data.couverts);
    Object.keys(data).forEach(k => { if (typeof data[k] === 'string') data[k] = data[k].trim(); if (!isNew && data[k] === c[k]) delete data[k]; });
    try {
      if (isNew) {
        const id = genId('CLI');
        await mutate('client', 'create', id, { statut: 'PROSPECT', etape: 'Nouveau', dateDemarchage: todayStr(), ...data });
        toast('Prospect créé', 'ok');
        location.replace('#/client/' + encodeURIComponent(id));
      } else {
        if (Object.keys(data).length) await mutate('client', 'update', c.id, data);
        toast('Fiche enregistrée', 'ok');
        history.back();
      }
    } catch (err) {
      toast('Erreur : ' + err.message, 'error');
    }
  });
  return { title: isNew ? 'Nouveau prospect' : 'Modifier la fiche', el, back: true };
}
