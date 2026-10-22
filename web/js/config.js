// Adresse de l'API Apps Script (URL se terminant par /exec), renseignée après le déploiement.
// Elle peut aussi être saisie sur l'écran de connexion ; elle est alors mémorisée sur l'appareil.
export const CONFIG = {
  API_URL: '',
  APP_VERSION: '1.0.0'
};

export function apiUrl() {
  try {
    return localStorage.getItem('crm.apiUrl') || CONFIG.API_URL;
  } catch (e) {
    return CONFIG.API_URL;
  }
}

export function setApiUrl(url) {
  try { localStorage.setItem('crm.apiUrl', url); } catch (e) { /* stockage indisponible */ }
}
