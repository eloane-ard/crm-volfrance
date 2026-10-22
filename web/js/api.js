import { apiUrl } from './config.js';

export class ApiError extends Error {
  constructor(code, message, network) {
    super(message || code);
    this.code = code;
    this.network = !!network;
  }
}

const MESSAGES = {
  BAD_CODE: 'Code incorrect.',
  CODE_EXPIRED: 'Code expiré : demandez-en un nouveau.',
  TOO_MANY_REQUESTS: 'Trop de demandes. Réessayez dans une heure.',
  UNAUTHORIZED: 'Session expirée : reconnectez-vous.',
  FORBIDDEN: 'Accès refusé.',
  BUSY: 'Le serveur est occupé, nouvel essai automatique.',
  NETWORK: 'Pas de connexion au serveur.'
};

export function errorMessage(e) {
  return MESSAGES[e && e.code] || (e && e.message) || 'Erreur inconnue';
}

/** Appel POST en text/plain : pas de pré-requête CORS, compatible avec Apps Script. */
export async function call(action, payload = {}, token) {
  const url = apiUrl();
  if (!url) throw new ApiError('NO_SERVER', 'Adresse du serveur non configurée.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token, ...payload }),
      redirect: 'follow',
      cache: 'no-store',
      signal: ctrl.signal
    });
  } catch (e) {
    throw new ApiError('NETWORK', MESSAGES.NETWORK, true);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new ApiError('HTTP_' + res.status, 'Erreur serveur (' + res.status + ')', res.status >= 500);
  let data;
  try {
    data = await res.json();
  } catch (e) {
    // Apps Script renvoie une page HTML en cas d'erreur de déploiement.
    throw new ApiError('BAD_RESPONSE', 'Réponse inattendue du serveur (vérifiez le déploiement).', true);
  }
  if (!data.ok) throw new ApiError(data.error || 'SERVER_ERROR', MESSAGES[data.error] || data.message);
  return data;
}
