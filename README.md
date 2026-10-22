# CRM Volfrance

Application commerciale hors connexion (PWA) dont la base de données reste le classeur Google Sheets.

- **Installation pas à pas :** [INSTALLATION.md](INSTALLATION.md)
- `apps-script/` : serveur Google Apps Script (connexion par code e-mail, lecture filtrée par commerciale, file de modifications idempotente, gestion des conflits champ par champ).
- `web/` : application (HTML/CSS/JavaScript sans dépendance) : IndexedDB pour les données, service worker pour le fonctionnement hors ligne.
- `dev/` : simulateur local qui exécute le vrai `Code.gs` sur des données fictives.
- `test/` : tests du serveur et test de bout en bout dans Chromium (hors connexion, rechargement, synchronisation, conflit).

## Développement

```
npm run dev     # http://localhost:8080, compte de test : eloane@test.local (code visible sur /__test/mails)
npm test        # nécessite Playwright
```
