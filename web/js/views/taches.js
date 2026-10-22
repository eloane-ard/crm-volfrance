// Tâches et relances (onglet A FAIRE du classeur).
import { h, icon, toast, field, select, fmtDate, badge } from '../ui.js';
import { state, mutate, genId, todayStr, addDays, daysBetween } from '../store.js';
import { clientPicker, section, emptyState, pendingDot } from '../components.js';

export function taskItem(t, opts) {
  opts = opts || {};
  const today = todayStr();
  const late = t.statut !== 'FAIT' && t.dateRelance && t.dateRelance < today;
  const done = t.statut === 'FAIT';
  const check = h('button', {
    type: 'button', class: 'check' + (done ? ' on' : ''), 'aria-label': done ? 'Marquer à faire' : 'Marquer fait',
    onclick: async e => {
      e.preventDefault();
      e.stopPropagation();
      await mutate('tache', 'update', t.id, done ? { statut: 'A FAIRE', faitLe: '' } : { statut: 'FAIT', faitLe: todayStr() });
      toast(done ? 'Tâche rouverte' : 'Tâche faite', 'ok');
    }
  }, icon('check'));
  return h('div', { class: 'task' + (done ? ' done' : '') + (late ? ' late' : '') },
    check,
    h('a', { class: 'task-body', href: '#/tache/' + encodeURIComponent(t.id) },
      h('div', { class: 'task-title' }, t.action),
      h('div', { class: 'task-sub' },
        !opts.hideClient && t.clientNom ? h('span', null, t.clientNom + (t.ville ? ' — ' + t.ville : '')) : null,
        t.dateRelance ? h('span', { class: late ? 'red-text' : '' }, (late ? 'En retard de ' + daysBetween(t.dateRelance, today) + ' j · ' : 'Relance ') + fmtDate(t.dateRelance)) : null,
        t.priorite === 'HAUTE' ? badge('Haute', 'red') : null,
        pendingDot(t))));
}

export function tachesView(params, query) {
  const tab = query.get('tab') || 'afaire';
  const today = todayStr();
  const all = [...state.taches.values()];
  const open = all.filter(t => t.statut !== 'FAIT');
  const lists = {
    afaire: open.sort((a, b) => (a.dateRelance || '9999').localeCompare(b.dateRelance || '9999')),
    retard: open.filter(t => t.dateRelance && t.dateRelance <= today),
    faites: all.filter(t => t.statut === 'FAIT').sort((a, b) => (b.faitLe || b.majLe || '').localeCompare(a.faitLe || a.majLe || '')).slice(0, 100)
  };
  const tabs = [['afaire', 'À faire (' + lists.afaire.length + ')'], ['retard', 'Échues (' + lists.retard.length + ')'], ['faites', 'Faites']];
  const el = h('div', { class: 'stack' },
    h('div', { class: 'page-head' },
      h('div', { class: 'tabs' }, tabs.map(([k, l]) => h('a', { class: 'tab' + (k === tab ? ' active' : ''), href: '#/taches?tab=' + k }, l))),
      h('a', { class: 'btn primary', href: '#/tache/new' }, icon('plus'), 'Tâche')),
    h('div', { class: 'card list' }, lists[tab].length ? lists[tab].map(t => taskItem(t)) : emptyState(tab === 'faites' ? 'Aucune tâche terminée.' : 'Rien à faire. Bravo !')));
  return { title: 'Tâches', el, live: true };
}

export function tacheEditView(params, query) {
  const isNew = params.id === 'new';
  const t = isNew ? { clientId: query.get('client') || '', action: '', dateRelance: addDays(todayStr(), 7), priorite: 'MOYENNE', statut: 'A FAIRE' } : state.taches.get(params.id);
  if (!t) return { title: 'Tâche', el: emptyState('Tâche introuvable.'), back: true };
  const data = {};
  const picker = clientPicker({ selected: t.clientId ? [t.clientId] : [], onChange: ids => { data.clientId = ids[0] || ''; }, allowAll: true });
  const el = h('form', { class: 'stack', novalidate: true },
    section(null,
      field('Client (facultatif)', picker.el),
      field('Action', h('textarea', { class: 'input', rows: 3, required: true, oninput: e => { data.action = e.target.value; } }, t.action || '')),
      h('div', { class: 'grid2' },
        field('Date de relance', h('input', { type: 'date', class: 'input', value: t.dateRelance || '', oninput: e => { data.dateRelance = e.target.value; } })),
        field('Priorité', select({ class: 'input', onchange: e => { data.priorite = e.target.value; } }, [['HAUTE', 'Haute'], ['MOYENNE', 'Moyenne'], ['BASSE', 'Basse']], t.priorite))),
      isNew ? null : field('Statut', select({ class: 'input', onchange: e => { data.statut = e.target.value; } }, [['A FAIRE', 'À faire'], ['FAIT', 'Fait']], t.statut)),
      !isNew && t.dateCreation ? h('p', { class: 'muted small' }, 'Créée le ' + fmtDate(t.dateCreation) + (t.faitLe ? ' · faite le ' + fmtDate(t.faitLe) : '')) : null),
    h('div', { class: 'sticky-actions' }, h('button', { type: 'submit', class: 'btn primary big block' }, icon('check'), 'Enregistrer')));
  el.addEventListener('submit', async e => {
    e.preventDefault();
    const action = (data.action !== undefined ? data.action : t.action || '').trim();
    if (!action) { toast('Décrivez l\'action.', 'error'); return; }
    if (data.action !== undefined) data.action = action;
    if (isNew) {
      await mutate('tache', 'create', genId('TAC'), { clientId: t.clientId, dateRelance: t.dateRelance, priorite: t.priorite, statut: 'A FAIRE', dateCreation: todayStr(), ...data });
    } else {
      if (data.statut === 'FAIT' && t.statut !== 'FAIT') data.faitLe = todayStr();
      Object.keys(data).forEach(k => { if (data[k] === t[k]) delete data[k]; });
      if (Object.keys(data).length) await mutate('tache', 'update', t.id, data);
    }
    toast('Tâche enregistrée', 'ok');
    history.back();
  });
  return { title: isNew ? 'Nouvelle tâche' : 'Tâche', el, back: true };
}
