// Connexion, synchronisation, conflits et réglages.
import { h, icon, toast, field, fmtDateTime, download, badge } from '../ui.js';
import { state, sync, pendingCount, failedEntries, resolveConflict, retryFailed, discardFailed, exportPending, logout, requestCode, verifyCode, errorMessage } from '../store.js';
import { section, emptyState } from '../components.js';
import { apiUrl, setApiUrl, CONFIG } from '../config.js';

const ENTITY_LABEL = { client: 'Fiche client', visite: 'Note', tache: 'Tâche', plan: 'Journée de prospection' };
const FIELD_LABEL = { tel: 'Téléphone', email: 'E-mail', contact: 'Chef / contact', remarques: 'Remarques', nom: 'Nom', ville: 'Ville', statut: 'Statut', etape: 'Étape', sujet: 'Compte rendu', action: 'Action', dateRelance: 'Date de relance', statut2: 'Statut' };

function describe(o) {
  const rec = state[o.entity + 's'].get(o.id);
  const name = rec ? (rec.nom || rec.clientNom || rec.action || rec.sujet || '') : '';
  return ENTITY_LABEL[o.entity] + (o.op === 'create' ? ' (création)' : ' (modification)') + (name ? ' · ' + String(name).slice(0, 60) : '');
}

export function settingsView() {
  const pending = state.outbox.filter(o => o.status === 'pending');
  const failed = failedEntries();
  const el = h('div', { class: 'stack' },
    section('Synchronisation',
      h('p', null, state.lastSync ? 'Dernière synchronisation : ' + fmtDateTime(state.lastSync) : 'Jamais synchronisé.'),
      h('p', null, pending.length ? pending.length + ' modification' + (pending.length > 1 ? 's' : '') + ' en attente d\'envoi.' : 'Tout est envoyé.'),
      state.sync.error ? h('p', { class: 'red-text' }, state.sync.error) : null,
      state.sync.needsLogin ? h('p', null, h('a', { class: 'btn primary', href: '#/login' }, 'Se reconnecter'), ' Vos modifications en attente sont conservées.') : null,
      h('div', { class: 'action-grid' },
        h('button', { type: 'button', class: 'btn', onclick: async () => { await sync(); toast(state.sync.error || 'Synchronisation terminée', state.sync.error ? 'error' : 'ok'); } }, icon('sync'), 'Synchroniser'),
        h('button', { type: 'button', class: 'btn', onclick: () => download('crm-sauvegarde-' + new Date().toISOString().slice(0, 10) + '.json', exportPending()) }, 'Exporter mes modifications en attente')),
      pending.length ? h('details', { class: 'more' }, h('summary', null, 'Voir la file d\'attente'),
        h('ul', { class: 'plain' }, pending.map(o => h('li', null, describe(o), o.attempts ? h('span', { class: 'muted small' }, ' · ' + o.attempts + ' essai(s)') : null,
          o.message ? h('div', { class: 'red-text small' }, o.message) : null)))) : null),
    failed.length ? section('Modifications refusées par le serveur',
      h('p', { class: 'muted' }, 'Elles sont conservées sur l\'appareil. Réessayez, ou abandonnez-les après les avoir exportées.'),
      failed.map(o => h('div', { class: 'row' }, h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, describe(o)), h('div', { class: 'row-sub' }, errorMessage({ code: o.error }))),
        h('div', { class: 'row-actions' },
          h('button', { type: 'button', class: 'btn sm', onclick: () => retryFailed(o) }, 'Réessayer'),
          h('button', { type: 'button', class: 'btn sm', onclick: async () => { if (confirm('Abandonner définitivement cette modification ?')) await discardFailed(o); } }, 'Abandonner'))))) : null,
    state.conflicts.length ? section('Conflits à arbitrer',
      h('p', { class: 'muted' }, 'Le même champ a été modifié dans le classeur et dans l\'application. Rien n\'a été écrasé : choisissez la valeur à garder.'),
      state.conflicts.map(c => {
        const rec = state[c.entity + 's'].get(c.id);
        return h('div', { class: 'conflict' },
          h('div', { class: 'row-title' }, ENTITY_LABEL[c.entity] + ' · ' + ((rec && (rec.nom || rec.clientNom)) || c.id) + ' · ' + (FIELD_LABEL[c.field] || c.field)),
          h('div', { class: 'grid2' },
            h('div', { class: 'conflict-opt' }, h('div', { class: 'muted small' }, 'Dans le classeur'), h('p', null, String(c.server || '(vide)')),
              h('button', { type: 'button', class: 'btn sm', onclick: () => resolveConflict(c, false) }, 'Garder celle-ci')),
            h('div', { class: 'conflict-opt' }, h('div', { class: 'muted small' }, 'Votre saisie'), h('p', null, String(c.mine || '(vide)')),
              h('button', { type: 'button', class: 'btn sm primary', onclick: () => resolveConflict(c, true) }, 'Garder la mienne'))));
      })) : null,
    section('Compte',
      state.user ? h('p', null, state.user.nom || state.user.code, ' · ', state.user.email, ' ', badge(state.user.role, 'blue')) : null,
      h('p', { class: 'muted small' }, 'Seuils de priorité (réglés dans le classeur) : « À revoir » à ' + state.settings.seuilARevoir + ' jours, « Urgent » à ' + state.settings.seuilUrgent + ' jours.'),
      storageInfo(),
      installInfo(),
      h('button', { type: 'button', class: 'btn danger', onclick: async () => {
        const n = pendingCount();
        const msg = n ? 'ATTENTION : ' + n + ' modification(s) ne sont pas encore envoyées et seront perdues. Exportez-les d\'abord. Se déconnecter quand même ?' : 'Se déconnecter et effacer les données de cet appareil ?';
        if (confirm(msg)) await logout();
      } }, 'Se déconnecter et effacer les données de l\'appareil'),
      h('p', { class: 'muted small' }, 'Version ' + CONFIG.APP_VERSION)));
  return { title: 'Réglages', el, live: true };
}

function storageInfo() {
  const p = h('p', { class: 'muted small' });
  if (navigator.storage && navigator.storage.persisted) {
    navigator.storage.persisted().then(ok => {
      p.textContent = ok ? 'Stockage local protégé : le navigateur ne l\'effacera pas automatiquement.' : 'Stockage local non garanti : installez l\'application sur l\'écran d\'accueil.';
    });
  }
  return p;
}

function installInfo() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone) return null;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return h('div', { class: 'notice' },
    h('strong', null, 'Installer l\'application'),
    h('p', null, ios ? 'Sur iPhone : ouvrez ce site dans Safari, touchez le bouton Partager puis « Sur l\'écran d\'accueil ». Indispensable pour garder les données hors connexion.'
      : 'Dans le menu du navigateur, choisissez « Installer l\'application » ou « Ajouter à l\'écran d\'accueil ».'));
}

export function loginView() {
  let email = (state.user && state.user.email) || '';
  const needServer = !apiUrl();
  const el = h('div', { class: 'login' });
  const status = h('p', { class: 'muted', role: 'status' });

  const serverInput = h('input', { class: 'input', type: 'url', placeholder: 'https://script.google.com/macros/s/…/exec', value: apiUrl() });
  const emailInput = h('input', { class: 'input big', type: 'email', inputmode: 'email', autocomplete: 'email', placeholder: 'prenom.nom@exemple.fr', value: email, required: true });
  const codeInput = h('input', { class: 'input big code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, placeholder: '••••••', pattern: '[0-9]*' });

  const step1 = h('form', { class: 'stack' },
    needServer ? field('Adresse du serveur (fournie à l\'installation)', serverInput) : null,
    field('Votre adresse e-mail', emailInput),
    h('button', { type: 'submit', class: 'btn primary big block' }, 'Recevoir un code de connexion'));
  const step2 = h('form', { class: 'stack', hidden: true },
    h('p', null, 'Un code à 6 chiffres vient d\'être envoyé si cette adresse est autorisée. Il est valable 10 minutes.'),
    field('Code reçu par e-mail', codeInput),
    h('button', { type: 'submit', class: 'btn primary big block' }, 'Se connecter'),
    h('button', { type: 'button', class: 'link', onclick: () => { step2.hidden = true; step1.hidden = false; } }, 'Changer d\'adresse ou renvoyer un code'));

  step1.addEventListener('submit', async e => {
    e.preventDefault();
    if (needServer) {
      const u = serverInput.value.trim();
      if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(u) && !u.startsWith('/')) { status.textContent = 'Adresse du serveur invalide.'; return; }
      setApiUrl(u);
    }
    email = emailInput.value.trim().toLowerCase();
    if (!email) return;
    status.textContent = 'Envoi du code…';
    try {
      await requestCode(email);
      status.textContent = '';
      step1.hidden = true;
      step2.hidden = false;
      codeInput.focus();
    } catch (err) {
      status.textContent = errorMessage(err);
    }
  });
  step2.addEventListener('submit', async e => {
    e.preventDefault();
    status.textContent = 'Connexion et téléchargement des données…';
    try {
      await verifyCode(email, codeInput.value);
      if (state.sync.error) { status.textContent = state.sync.error; return; }
      toast('Connectée', 'ok');
      location.replace('#/');
    } catch (err) {
      status.textContent = errorMessage(err);
    }
  });

  el.append(h('div', { class: 'login-card card' },
    h('div', { class: 'brand' }, h('img', { src: 'icons/icon-192.png', alt: '', width: 56, height: 56 }), h('h1', null, 'CRM Volfrance')),
    h('p', { class: 'muted' }, 'Connexion sécurisée par code envoyé sur votre e-mail. Aucun mot de passe à retenir.'),
    step1, step2, status));
  return { title: 'Connexion', el, bare: true };
}
