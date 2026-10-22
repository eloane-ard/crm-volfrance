// Carnet commercial : saisie rapide d'une note / compte rendu, et historique.
import { h, icon, toast, field, select, fmtDate, fmtDateLong, norm, badge, fill } from '../ui.js';
import { state, mutate, genId, todayStr, addDays } from '../store.js';
import { clientPicker, section, emptyState, pendingDot } from '../components.js';
import * as db from '../db.js';

export const TYPES = [['VISITE', 'Visite'], ['APPEL', 'Appel'], ['MAIL', 'Mail'], ['MESSAGE', 'Message'], ['NOTE', 'Note']];
const DRAFT_KEY = 'draft:note';

export function noteView(params, query) {
  const preset = query.get('client') ? query.get('client').split(',') : [];
  const planId = query.get('plan');
  const form = {
    clientIds: preset,
    date: todayStr(),
    type: preset.length ? 'VISITE' : 'NOTE',
    sujet: '',
    produits: '',
    remarques: '',
    action: '',
    relance: '',
    priorite: 'MOYENNE'
  };

  const el = h('form', { class: 'stack note-form', novalidate: true });
  const multi = h('input', { type: 'checkbox' });
  let picker = makePicker(false);

  function makePicker(multiple) {
    return clientPicker({ multiple, selected: form.clientIds, onChange: ids => { form.clientIds = ids; if (ids.length && form.type === 'NOTE') setType('VISITE'); saveDraft(); } });
  }
  const pickerSlot = h('div', null, picker.el);
  multi.addEventListener('change', () => {
    picker = makePicker(multi.checked);
    pickerSlot.replaceChildren(picker.el);
  });

  const typeChips = h('div', { class: 'chips' });
  function setType(t) {
    form.type = t;
    typeChips.replaceChildren(...TYPES.map(([v, l]) => h('button', { type: 'button', class: 'chip' + (form.type === v ? ' selected' : ''), onclick: () => { setType(v); saveDraft(); } }, l)));
  }
  setType(form.type);

  const date = h('input', { type: 'date', class: 'input', value: form.date, required: true, oninput: e => { form.date = e.target.value; saveDraft(); } });
  const sujet = h('textarea', { class: 'input big', rows: 5, placeholder: 'Compte rendu : ce qui a été dit, commandes, besoins…', oninput: e => { form.sujet = e.target.value; saveDraft(); } });
  const produits = h('input', { class: 'input', placeholder: 'Ex. escalope, cuisse, sauté', oninput: e => { form.produits = e.target.value; saveDraft(); } });
  const remarques = h('input', { class: 'input', placeholder: 'Information à retenir', oninput: e => { form.remarques = e.target.value; saveDraft(); } });
  const action = h('input', { class: 'input', placeholder: 'Ex. rappeler pour le catalogue de Noël', oninput: e => { form.action = e.target.value; saveDraft(); } });
  const relance = h('input', { type: 'date', class: 'input', oninput: e => { form.relance = e.target.value; saveDraft(); } });
  const prio = select({ class: 'input', onchange: e => { form.priorite = e.target.value; } }, [['HAUTE', 'Haute'], ['MOYENNE', 'Moyenne'], ['BASSE', 'Basse']], form.priorite);
  const quick = h('div', { class: 'chips' }, [['+1 sem.', 7], ['+2 sem.', 14], ['+1 mois', 30], ['+3 mois', 91]].map(([l, n]) =>
    h('button', { type: 'button', class: 'chip', onclick: () => { form.relance = addDays(form.date || todayStr(), n); relance.value = form.relance; saveDraft(); } }, l)));

  const details = h('details', { class: 'more' }, h('summary', null, 'Produits présentés, remarque'),
    field('Produits présentés', produits), field('Remarque', remarques));

  const submit = h('button', { type: 'submit', class: 'btn primary big block' }, icon('check'), 'Enregistrer');

  el.append(
    section(null,
      field('Client', pickerSlot, null),
      h('label', { class: 'inline-check' }, multi, ' Plusieurs clients (même compte rendu)'),
      h('div', { class: 'grid2' }, field('Date', date), h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Type'), typeChips)),
      field('Compte rendu', sujet),
      details),
    section('Prochaine action (facultatif)',
      field('Action', action),
      field('Date de relance', h('div', null, relance, quick)),
      field('Priorité', prio)),
    h('div', { class: 'sticky-actions' }, submit));

  // Restaure un brouillon non enregistré (application fermée en cours de saisie).
  db.getMeta(DRAFT_KEY, null).then(d => {
    if (!d || preset.length || (!d.sujet && !d.action)) return;
    Object.assign(form, d);
    picker.set(form.clientIds || []);
    date.value = form.date; sujet.value = form.sujet; produits.value = form.produits || ''; remarques.value = form.remarques || '';
    action.value = form.action || ''; relance.value = form.relance || ''; setType(form.type);
    toast('Brouillon restauré');
  });

  let draftTimer;
  function saveDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => db.setMeta(DRAFT_KEY, form), 400);
  }

  el.addEventListener('submit', async e => {
    e.preventDefault();
    if (!form.sujet.trim()) { toast('Écrivez au moins quelques mots de compte rendu.', 'error'); sujet.focus(); return; }
    if (!form.date) { toast('Indiquez la date.', 'error'); return; }
    if (form.action.trim() && !form.relance) form.relance = addDays(form.date, 7);
    submit.disabled = true;
    try {
      const targets = form.clientIds.length ? form.clientIds : [''];
      for (const clientId of targets) {
        const visiteId = genId('VIS');
        await mutate('visite', 'create', visiteId, {
          clientId, date: form.date, type: form.type, sujet: form.sujet.trim(), produits: form.produits.trim(), remarques: form.remarques.trim()
        });
        if (form.action.trim()) {
          await mutate('tache', 'create', genId('TAC'), {
            clientId, visiteId, action: form.action.trim(), dateCreation: todayStr(), dateRelance: form.relance, priorite: form.priorite, statut: 'A FAIRE'
          });
        }
      }
      if (planId && state.plans.get(planId)) {
        const p = state.plans.get(planId);
        const faits = new Set((p.faits || '').split(',').filter(Boolean));
        form.clientIds.forEach(id => faits.add(id));
        await mutate('plan', 'update', planId, { faits: [...faits].join(',') });
      }
      await db.setMeta(DRAFT_KEY, null);
      toast(targets.length > 1 ? targets.length + ' comptes rendus enregistrés' : 'Note enregistrée', 'ok');
      history.length > 1 ? history.back() : (location.hash = '#/');
    } catch (err) {
      submit.disabled = false;
      toast('Erreur d\'enregistrement : ' + err.message, 'error');
    }
  });

  setTimeout(() => { if (!preset.length) picker.el.querySelector('input').focus(); else sujet.focus(); }, 50);
  return { title: 'Nouvelle note', el, back: true };
}

export function carnetView(params, query) {
  const q = query.get('q') || '';
  const type = query.get('type') || '';
  const el = h('div', { class: 'stack' });
  const search = h('input', { type: 'search', class: 'input', placeholder: 'Rechercher dans les comptes rendus', value: q });
  const typeSel = select({ class: 'input' }, [['', 'Tous les types'], ...TYPES], type);
  const go = () => { location.replace('#/carnet?' + new URLSearchParams({ q: search.value, type: typeSel.value })); };
  search.addEventListener('change', go);
  typeSel.addEventListener('change', go);

  const terms = norm(q).split(/\s+/).filter(Boolean);
  const list = [...state.visites.values()].filter(v => {
    if (type && v.type !== type) return false;
    if (!terms.length) return true;
    const hay = norm([v.clientNom, v.ville, v.sujet, v.produits, v.remarques].join(' '));
    return terms.every(t => hay.includes(t));
  }).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.creeLe || '').localeCompare(a.creeLe || ''));

  const groups = new Map();
  list.slice(0, 300).forEach(v => {
    if (!groups.has(v.date)) groups.set(v.date, []);
    groups.get(v.date).push(v);
  });

  fill(el,
    h('div', { class: 'toolbar' }, search, typeSel, h('a', { class: 'btn primary', href: '#/note' }, icon('plus'), 'Note')),
    list.length ? null : emptyState('Aucun compte rendu.'),
    [...groups.entries()].map(([d, vs]) => h('section', { class: 'card' },
      h('h2', { class: 'card-title' }, fmtDateLong(d)),
      vs.map(visitItem))));
  if (list.length > 300) el.append(h('p', { class: 'muted center' }, 'Affichage limité aux 300 plus récents : affinez la recherche.'));
  return { title: 'Carnet', el, live: true };
}

export function visitItem(v, opts) {
  opts = opts || {};
  return h('div', { class: 'visit' },
    h('div', { class: 'visit-head' },
      badge((TYPES.find(t => t[0] === v.type) || [v.type, v.type])[1], v.type === 'NOTE' ? 'grey' : 'blue'),
      opts.hideClient ? h('span', { class: 'muted' }, fmtDate(v.date)) :
        (v.clientId ? h('a', { href: '#/client/' + encodeURIComponent(v.clientId), class: 'visit-client' }, v.clientNom || 'Client', v.ville ? ' — ' + v.ville : '') : h('span', { class: 'muted' }, 'Note libre')),
      pendingDot(v)),
    h('p', { class: 'visit-text' }, v.sujet),
    v.produits ? h('p', { class: 'muted small' }, 'Produits : ' + v.produits) : null,
    v.remarques ? h('p', { class: 'muted small' }, 'Remarque : ' + v.remarques) : null);
}
