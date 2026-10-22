// Tournées : journées de prospection libres et tournées de livraison fixes (consultation).
import { h, icon, toast, field, fmtDate, fmtDateLong, badge, prioKind, relDays } from '../ui.js';
import { state, mutate, genId, todayStr, clientInfo, visitIndex } from '../store.js';
import { section, emptyState, pendingDot, clientLabel } from '../components.js';
import { filterBar, filterClients, distinct } from './clients.js';

const JOURS = [['LUN', 'Lundi'], ['MAR', 'Mardi'], ['MER', 'Mercredi'], ['JEU', 'Jeudi'], ['VEN', 'Vendredi'], ['SAM', 'Samedi']];

function planIds(p) { return (p.clientIds || '').split(',').filter(Boolean); }
function planDone(p) {
  const faits = new Set((p.faits || '').split(',').filter(Boolean));
  // Un client est aussi considéré vu si une note a été saisie pour lui le jour de la tournée.
  const { byClient } = visitIndex();
  planIds(p).forEach(id => { if ((byClient.get(id) || []).some(v => v.date === p.date)) faits.add(id); });
  return faits;
}

export function tourneesView(params, query) {
  const tab = query.get('tab') || 'prospection';
  const el = h('div', { class: 'stack' },
    h('div', { class: 'tabs' },
      h('a', { class: 'tab' + (tab === 'prospection' ? ' active' : ''), href: '#/tournees?tab=prospection' }, 'Prospection'),
      h('a', { class: 'tab' + (tab === 'livraison' ? ' active' : ''), href: '#/tournees?tab=livraison' }, 'Livraison')),
    tab === 'livraison' ? livraison(query) : prospection());
  return { title: 'Tournées', el, live: true };
}

function prospection() {
  const today = todayStr();
  const plans = [...state.plans.values()].filter(p => !p.supprime).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const upcoming = plans.filter(p => p.date >= today);
  const past = plans.filter(p => p.date < today).reverse().slice(0, 15);
  const card = p => {
    const ids = planIds(p);
    const done = planDone(p);
    return h('a', { class: 'row', href: '#/plan/' + encodeURIComponent(p.id) },
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title' }, (p.date === today ? "Aujourd'hui · " : '') + fmtDateLong(p.date), pendingDot(p)),
        h('div', { class: 'row-sub' }, (p.nom ? p.nom + ' · ' : '') + ids.length + ' établissement' + (ids.length > 1 ? 's' : ''))),
      h('div', { class: 'row-side' }, badge(done.size + '/' + ids.length + ' vus', done.size === ids.length && ids.length ? 'green' : '')));
  };
  return h('div', { class: 'stack' },
    h('p', { class: 'muted' }, 'Préparez librement vos journées : filtrez par secteur, priorité ou dernière visite, puis cochez au fil de la journée.'),
    h('a', { class: 'btn primary big block', href: '#/plan/new' }, icon('plus'), 'Préparer une journée de prospection'),
    section('À venir', upcoming.length ? h('div', { class: 'list' }, upcoming.map(card)) : emptyState('Aucune journée prévue.')),
    past.length ? section('Passées', h('div', { class: 'list' }, past.map(card))) : null);
}

function livraison(query) {
  const tournees = distinct('tournee');
  const t = query.get('t') || tournees[0] || '';
  const jour = query.get('jour') || '';
  const list = [...state.clients.values()].filter(c => c.tournee === t && c.statut === 'CLIENT' &&
    (!jour || String(c.livraison || '').toUpperCase().includes(jour)))
    .sort((a, b) => a.ville.localeCompare(b.ville, 'fr') || a.nom.localeCompare(b.nom, 'fr'));
  const link = (k, v) => { const p = new URLSearchParams({ tab: 'livraison', t, jour }); p.set(k, v); return '#/tournees?' + p; };
  return h('div', { class: 'stack' },
    h('p', { class: 'muted' }, 'Jours de livraison fixes, pour information. Ils n\'imposent pas vos déplacements commerciaux.'),
    h('div', { class: 'chips' }, tournees.map(x => h('a', { class: 'chip' + (x === t ? ' selected' : ''), href: link('t', x) }, x))),
    h('div', { class: 'chips' }, h('a', { class: 'chip' + (!jour ? ' selected' : ''), href: link('jour', '') }, 'Tous les jours'),
      JOURS.map(([k, l]) => h('a', { class: 'chip' + (jour === k ? ' selected' : ''), href: link('jour', k) }, l))),
    section(t + ' · ' + list.length + ' client' + (list.length > 1 ? 's' : ''),
      list.length ? h('div', { class: 'list' }, list.map(c => h('a', { class: 'row', href: '#/client/' + encodeURIComponent(c.id) },
        h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, c.nom), h('div', { class: 'row-sub' }, c.ville + ' · ' + (c.livraison || 'jours non renseignés')))))) : emptyState('Aucun client.')));
}

export function planEditView(params, query) {
  const isNew = params.id === 'new';
  const p = isNew ? { date: todayStr(), nom: '', clientIds: '' } : state.plans.get(params.id);
  if (!p) return { title: 'Journée', el: emptyState('Journée introuvable.'), back: true };
  let selected = planIds(p);
  const f = { q: '', statut: 'suivis', tournee: '', type: '', groupement: '', ville: '', prio: '', destock: false, tri: 'priorite', commercial: '' };
  const date = h('input', { type: 'date', class: 'input', value: p.date });
  const nom = h('input', { class: 'input', value: p.nom || '', placeholder: 'Ex. Secteur Fougères' });
  const chosen = h('div', { class: 'list' });
  const results = h('div', { class: 'list' });
  const count = h('span', { class: 'muted' });

  function renderChosen() {
    count.textContent = selected.length + ' sélectionné' + (selected.length > 1 ? 's' : '');
    chosen.replaceChildren(...(selected.length ? selected.map((id, i) => {
      const c = state.clients.get(id);
      return h('div', { class: 'row' },
        h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, (i + 1) + '. ' + (c ? c.nom : id)), h('div', { class: 'row-sub' }, c ? c.ville : '')),
        h('div', { class: 'row-actions' },
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Monter', disabled: i === 0, onclick: () => { [selected[i - 1], selected[i]] = [selected[i], selected[i - 1]]; renderChosen(); } }, icon('up')),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Descendre', disabled: i === selected.length - 1, onclick: () => { [selected[i + 1], selected[i]] = [selected[i], selected[i + 1]]; renderChosen(); } }, icon('down')),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Retirer', onclick: () => { selected.splice(i, 1); renderChosen(); renderResults(); } }, icon('x'))));
    }) : [emptyState('Ajoutez des établissements depuis la liste ci-dessous.')]));
  }

  function renderResults() {
    const list = filterClients(f).filter(x => !selected.includes(x.c.id)).slice(0, 60);
    results.replaceChildren(...(list.length ? list.map(({ c, info }) => h('button', {
      type: 'button', class: 'row as-button', onclick: () => { selected.push(c.id); renderChosen(); renderResults(); }
    },
      h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, c.nom), h('div', { class: 'row-sub' }, [c.ville, c.tournee, c.type].filter(Boolean).join(' · '))),
      h('div', { class: 'row-side' }, badge(info.priorite, prioKind(info.priorite)), h('div', { class: 'row-meta' }, info.lastVisit ? relDays(info.days) : ''), icon('plus')))) : [emptyState('Aucun résultat.')]));
  }

  const save = h('button', { type: 'button', class: 'btn primary big block', onclick: async () => {
    if (!date.value) { toast('Choisissez une date.', 'error'); return; }
    if (!selected.length) { toast('Ajoutez au moins un établissement.', 'error'); return; }
    const fields = { date: date.value, nom: nom.value.trim(), clientIds: selected.join(',') };
    if (isNew) {
      const id = genId('PLN');
      await mutate('plan', 'create', id, { ...fields, faits: '' });
      location.replace('#/plan/' + encodeURIComponent(id));
    } else {
      Object.keys(fields).forEach(k => { if (fields[k] === p[k]) delete fields[k]; });
      if (Object.keys(fields).length) await mutate('plan', 'update', p.id, fields);
      history.back();
    }
    toast('Journée enregistrée', 'ok');
  } }, icon('check'), 'Enregistrer la journée');

  const el = h('div', { class: 'stack plan-edit' },
    section(null, h('div', { class: 'grid2' }, field('Date', date), field('Nom (facultatif)', nom))),
    section('Ma journée', h('div', { class: 'page-head' }, count), chosen),
    section('Ajouter des établissements', filterBar(f, () => renderResults()), results),
    h('div', { class: 'sticky-actions' }, save));
  renderChosen();
  renderResults();
  return { title: isNew ? 'Préparer une journée' : 'Modifier la journée', el, back: true };
}

export function planView(params) {
  const p = state.plans.get(params.id);
  if (!p || p.supprime) return { title: 'Journée', el: emptyState('Journée introuvable.'), back: true };
  const ids = planIds(p);
  const done = planDone(p);
  const clients = ids.map(id => state.clients.get(id)).filter(Boolean);
  // Itinéraire Google Maps : ouvert seulement si vous appuyez sur le bouton.
  const route = 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + encodeURIComponent(clients.length ? clients[clients.length - 1].nom + ' ' + clients[clients.length - 1].ville : '') +
    (clients.length > 1 ? '&waypoints=' + encodeURIComponent(clients.slice(0, -1).slice(0, 9).map(c => c.nom + ' ' + c.ville).join('|')) : '');

  async function toggle(id) {
    const faits = new Set((p.faits || '').split(',').filter(Boolean));
    faits.has(id) ? faits.delete(id) : faits.add(id);
    await mutate('plan', 'update', p.id, { faits: [...faits].join(',') });
  }

  const el = h('div', { class: 'stack' },
    h('section', { class: 'card' },
      h('h1', null, fmtDateLong(p.date)),
      p.nom ? h('p', { class: 'muted' }, p.nom) : null,
      h('div', { class: 'progress' }, h('div', { class: 'progress-bar', style: null })),
      h('p', null, done.size + ' / ' + ids.length + ' établissements vus'),
      h('div', { class: 'action-grid' },
        clients.length ? h('a', { class: 'btn big', href: route, target: '_blank', rel: 'noopener' }, icon('map'), 'Itinéraire') : null,
        h('a', { class: 'btn big', href: '#/plan/' + encodeURIComponent(p.id) + '/edit' }, icon('edit'), 'Modifier'),
        h('button', { type: 'button', class: 'btn big', onclick: async () => {
          if (!confirm('Supprimer cette journée de prospection ?')) return;
          await mutate('plan', 'update', p.id, { supprime: true });
          location.replace('#/tournees');
        } }, icon('x'), 'Supprimer'))),
    h('div', { class: 'card list' }, clients.map((c, i) => {
      const info = clientInfo(c);
      const isDone = done.has(c.id);
      const tel = (c.tel || '').replace(/[^\d+]/g, '');
      return h('div', { class: 'stop' + (isDone ? ' done' : '') },
        h('button', { type: 'button', class: 'check' + (isDone ? ' on' : ''), 'aria-label': 'Vu', onclick: () => toggle(c.id) }, icon('check')),
        h('a', { class: 'stop-body', href: '#/client/' + encodeURIComponent(c.id) },
          h('div', { class: 'row-title' }, (i + 1) + '. ' + c.nom),
          h('div', { class: 'row-sub' }, [c.ville, c.contact, info.lastVisit ? 'vu ' + relDays(info.days).toLowerCase() : 'jamais visité'].filter(Boolean).join(' · '))),
        h('div', { class: 'row-actions' },
          tel ? h('a', { class: 'icon-btn', href: 'tel:' + tel, 'aria-label': 'Appeler' }, icon('phone')) : null,
          h('a', { class: 'btn primary sm', href: '#/note?client=' + encodeURIComponent(c.id) + '&plan=' + encodeURIComponent(p.id) }, icon('plus'), 'Note')));
    })));
  const bar = el.querySelector('.progress-bar');
  bar.style.width = (ids.length ? Math.round(done.size * 100 / ids.length) : 0) + '%';
  return { title: 'Journée de prospection', el, back: true, live: true };
}

export { clientLabel };
