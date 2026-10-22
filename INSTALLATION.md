# Installation de l'application CRM

Comptez 20 à 30 minutes, une seule fois. Faites-le d'abord sur la **copie de test** du CRM.

## Étape 1 : installer le serveur dans le classeur (Apps Script)

1. Ouvrez la copie de test du CRM dans Google Sheets.
2. Menu **Extensions → Apps Script**. Un éditeur s'ouvre dans un nouvel onglet.
3. Dans le fichier `Code.gs`, effacez tout et collez le contenu du fichier [`apps-script/Code.gs`](apps-script/Code.gs).
4. Cliquez sur l'engrenage **Paramètres du projet** (à gauche) et cochez **Afficher le fichier manifeste "appsscript.json" dans l'éditeur**.
5. Revenez à l'éditeur (icône `< >`), ouvrez `appsscript.json`, effacez tout et collez le contenu de [`apps-script/appsscript.json`](apps-script/appsscript.json).
6. Enregistrez (icône disquette).
7. En haut, choisissez la fonction **installer** puis cliquez sur **Exécuter**.
   - Google demande une autorisation : choisissez votre compte.
   - Si un écran indique « Google n'a pas validé cette application », cliquez sur **Paramètres avancés** puis **Accéder à … (non sécurisé)**. C'est normal : c'est votre propre script, il n'a pas été soumis à Google.
   - Les autorisations demandées : lire et modifier **ce classeur uniquement**, et envoyer des e-mails en votre nom (pour les codes de connexion).
8. L'exécution crée les onglets techniques masqués `_SESSIONS`, `_JOURNAL`, `_CONFLITS` et l'onglet `PROSPECTION`.

## Étape 2 : publier le serveur

1. En haut à droite : **Déployer → Nouveau déploiement**.
2. Roue dentée à côté de « Sélectionner le type » → **Application Web**.
3. Description : `CRM v1`. **Exécuter en tant que : Moi**. **Qui a accès : Tout le monde**.
   - « Tout le monde » veut dire que l'adresse répond à Internet, mais elle ne donne **aucune donnée** sans connexion : il faut un code reçu sur une adresse listée dans l'onglet COMMERCIAUX.
4. Cliquez sur **Déployer** et copiez l'**URL de l'application Web** (elle se termine par `/exec`).

Pour une mise à jour future du code : **Déployer → Gérer les déploiements → crayon → Version : Nouvelle version → Déployer**. L'URL reste la même.

## Étape 3 : publier l'application (GitHub Pages, gratuit)

1. Dans le dépôt GitHub : **Settings → Pages → Source : GitHub Actions**.
2. Chaque modification du dossier `web/` publie automatiquement l'application. L'adresse s'affiche dans **Settings → Pages** (forme `https://VOTRE-IDENTIFIANT.github.io/crm-volaille/`).
3. Facultatif : collez l'URL `/exec` de l'étape 2 dans `web/js/config.js` (`API_URL`). Sinon, l'application la demande à la première connexion.

Le dépôt ne contient que le code de l'application, jamais de données clients. Les données restent dans votre classeur et sur votre téléphone.

## Étape 4 : installer sur le téléphone

**iPhone (Safari obligatoire) :**
1. Ouvrez l'adresse de l'application dans **Safari**.
2. Saisissez l'adresse du serveur (si demandée) et votre e-mail, puis le code reçu.
3. Touchez **Partager** (carré avec une flèche) → **Sur l'écran d'accueil** → **Ajouter**.
4. Ouvrez désormais le CRM depuis l'icône de l'écran d'accueil. **Important :** c'est l'application installée qui garde les données hors connexion ; si vous l'utilisez seulement dans Safari, iOS peut effacer les données après 7 jours sans utilisation.

**Android (Chrome) :** ouvrez l'adresse, connectez-vous, puis menu ⋮ → **Installer l'application**.

**Ordinateur (Chrome ou Edge) :** ouvrez l'adresse ; une icône d'installation apparaît dans la barre d'adresse.

## Ajouter une commerciale ou une responsable (plus tard)

Dans l'onglet **COMMERCIAUX** du classeur, ajoutez une ligne :

| CODE | NOM | EMAIL | ROLE | ACTIF |
|---|---|---|---|---|
| MARIE | Marie Dupont | marie.dupont@… | COMMERCIAL | OUI |
| RESP | Prénom Nom | responsable@… | RESPONSABLE | OUI |

- **COMMERCIAL** : voit uniquement les clients, notes et tâches dont la colonne COMMERCIAL porte son code.
- **RESPONSABLE** : voit tout, avec un filtre par commerciale et les comptes rendus de la semaine.
- **ADMIN** : comme RESPONSABLE, et peut attribuer un client à une commerciale.
- Pour retirer un accès : `ACTIF` = `NON`. Pour déconnecter un appareil perdu : dans l'onglet masqué `_SESSIONS`, écrivez `REVOQUEE` dans la colonne REVOQUEE de la ligne concernée.

## Ce qui fonctionne hors connexion

- Consulter clients, fiches, historique, tournées préparées, tâches, tableau de bord.
- Créer des notes (avec ou sans client, ou pour plusieurs clients à la fois), des tâches, des prospects, des journées de prospection ; modifier une fiche.
- Tout est enregistré immédiatement sur l'appareil, puis envoyé au classeur dès que la connexion revient **et que l'application est ouverte** (sur iPhone, pas d'envoi en arrière-plan quand elle est fermée).

L'indicateur en haut de l'écran affiche : **À jour**, **N en attente**, **Hors ligne**, **Erreur** ou **conflit**. Touchez-le pour voir le détail.

## Et si deux modifications se croisent ?

- Notes, tâches et prospects sont des créations : elles ne peuvent pas entrer en conflit, et un envoi répété ne crée jamais de doublon (chaque saisie porte un identifiant unique).
- Si un même champ d'une fiche a été modifié à la fois dans le classeur et dans l'application, rien n'est écrasé : l'application vous montre les deux valeurs dans **Réglages → Conflits à arbitrer**, et l'onglet masqué `_CONFLITS` en garde la trace.
- Les modifications faites à la main dans le classeur sont horodatées automatiquement et redescendent dans l'application à la synchronisation suivante.
