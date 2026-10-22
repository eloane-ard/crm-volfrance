import { h, icon, badge, norm, prioKind, relDays, statutKind } from './ui.js';
import { state, clientInfo, isFollowed } from './store.js';

export function clientLabel(c) {
  return c ? c.nom + (c.ville ? ' — ' + c.ville : '') : '';
}

export function searchClients(q, opts) {
  opts = opts || {};
  const terms = norm(q).split(/\s+/).filter(Boolean);
  const list = [];
  state.clients.forEach(c => {
    if (!opts.all && !isFollowed(c) && !(opts.keep || []).includes(c.id)) return;
    const hay = norm([c.nom, c.ville, c.contact, c.groupement, c.tournee, c.type].join(' '));
    if (terms.every(t => hay.includes(t))) list.push(c);
  });
  list.sort((a, b) => (a.nom + a.ville).localeCompare(b.nom + b.ville, 'fr'));
  return list;
}

/** Sélecteur de client(s) avec recherche instantanée. */
export function clientPicker({ multiple, selected, onChange, placeholder, allowAll }) {
  let ids = (selected || []).filter(Boolean);
  const chips = h('div', { class: 'chips' });
  const input = h('input', { type: 'search', class: 'input', placeholder: placeholder || 'Rechercher un client (nom, ville, chef…)', autocomplete: 'off', enterkeyhint: 'search' });
  const results = h('div', { class: 'picker-results' });
  const wrap = h('div', { class: 'picker' }, chips, input, results);

  function renderChips() {
    chips.replaceChildren(...ids.map(id => {
      const c = state.clients.get(id);
      return h('span', { class: 'chip selected' }, clientLabel(c) || id,
        h('button', { type: 'button', class: 'chip-x', 'aria-label': 'Retirer', onclick: () => { ids = ids.filter(x => x !== id); update(); } }, icon('x')));
    }));
    input.hidden = !multiple && ids.length > 0;
  }

  function renderResults() {
    const q = input.value.trim();
    if (!q) { results.replaceChildren(); return; }
    const list = searchClients(q, { all: allowAll }).filter(c => !ids.includes(c.id)).slice(0, 25);
    results.replaceChildren(...(list.length ? list.map(c => h('button', {
      type: 'button', class: 'picker-item',
      onclick: () => { ids = multiple ? [...ids, c.id] : [c.id]; input.value = ''; update(); if (multiple) input.focus(); }
    }, h('strong', null, c.nom), h('span', { class: 'muted' }, ' ' + [c.ville, c.tournee].filter(Boolean).join(' · ')))) : [h('div', { class: 'muted pad' }, 'Aucun client trouvé')]));
  }

  function update() {
    renderChips();
    renderResults();
    onChange && onChange(ids.slice());
  }

  input.addEventListener('input', renderResults);
  renderChips();
  return { el: wrap, get: () => ids.slice(), set: v => { ids = v.slice(); update(); } };
}

/** Ligne de client utilisée dans les listes. */
export function clientRow(c, extra) {
  const info = clientInfo(c);
  return h('a', { class: 'row', href: '#/client/' + encodeURIComponent(c.id) },
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, c.nom, c._pending ? icon('clock', 'pending-icon') : null),
      h('div', { class: 'row-sub' }, [c.ville, c.tournee, c.type].filter(Boolean).join(' · '))),
    h('div', { class: 'row-side' },
      c.statut !== 'CLIENT' ? badge(c.statut === 'PROSPECT' ? 'Prospect' : c.statut, statutKind(c.statut)) : null,
      isFollowed(c) ? badge(info.priorite, prioKind(info.priorite)) : null,
      h('div', { class: 'row-meta' }, info.lastVisit ? relDays(info.days) : ''),
      extra || null));
}

export function emptyState(text, action) {
  return h('div', { class: 'empty' }, h('p', null, text), action || null);
}

export function section(title, ...children) {
  return h('section', { class: 'card' }, title ? h('h2', { class: 'card-title' }, title) : null, ...children);
}

export function pendingDot(rec) {
  return rec && rec._pending ? h('span', { class: 'pending-tag', title: 'En attente de synchronisation' }, icon('clock'), 'En attente') : null;
}
