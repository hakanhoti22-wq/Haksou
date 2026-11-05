# 💅 Studio Ongles : rendez-vous en ligne + organisation

Deux pages :

| Page | Pour qui | Adresse |
|---|---|---|
| **Réservation** (`index.html`) | Les clientes | https://hakanhoti22-wq.github.io/Haksou/ongles/ |
| **Espace pro** (`pro.html`) | Ta femme (à installer sur son téléphone) | https://hakanhoti22-wq.github.io/Haksou/ongles/pro.html |

Les données sont enregistrées dans **sa Google Sheet** (gratuit, rien à payer). Sans Google Sheet, l'app tourne en **mode démo** avec des données fictives, pour essayer.

## Ce que ça fait

**Pour les clientes**
- Choisir une ou plusieurs prestations (prix et durée affichés)
- Voir seulement les créneaux vraiment libres, calculés selon la durée totale, les horaires, les pauses et les congés
- Réserver avec nom et téléphone (e-mail facultatif) → e-mail de confirmation + bouton « Ajouter à mon agenda »
- Annuler seule avec son lien (jusqu'à 24 h avant, réglable)

**Pour ta femme**
- ☀️ **Aujourd'hui** : programme du jour, temps libre entre deux clientes, prochaine cliente avec compte à rebours, **chrono** pendant la pose (alerte si elle dépasse et que la cliente suivante arrive), demandes à valider, rappels WhatsApp pour demain
- 📅 **Agenda** de la semaine, ajout d'un RDV pris par téléphone ou Insta (avec les créneaux libres proposés)
- 👩 **Fiches clientes** : historique, total dépensé, absences, notes (allergies, forme préférée…), clientes à relancer pour le remplissage
- ✅ **Tâches** : liste avec dates et tâches répétées (désinfecter les outils chaque jour, compta chaque mois…)
- 📊 **Statistiques** : chiffre d'affaires, panier moyen, nouvelles clientes, prestations favorites, paiements (espèces / TWINT / carte), **durée réelle vs prévue** (pour savoir s'il faut rallonger un créneau), export Excel
- ⚙️ Prestations et prix, horaires avec pause, congés, validation automatique ou manuelle, pause entre deux clientes
- Google Agenda : chaque RDV y apparaît automatiquement. E-mail de rappel la veille à 18h

## Installation (≈ 15 min, une seule fois, sur un ordinateur de préférence)

### 1. La Google Sheet
1. Avec le compte Google de ta femme, crée une Google Sheet vide (https://sheets.new), nomme-la « Studio Ongles ».
2. **Extensions → Apps Script**, efface le contenu et colle tout le fichier `apps-script.gs`.
3. Ligne `const TOKEN = 'change-moi-123';` → remplace par un mot de passe à vous (lettres et chiffres).
4. Vérifie `TZ = 'Europe/Zurich'` (fuseau horaire) et, si besoin, `MAIL_PRO` (e-mail qui reçoit les nouvelles réservations).
5. 💾 Enregistre. En haut, choisis la fonction **installer** → **▶ Exécuter** → **Autoriser l'accès** (Google affiche « application non validée » : **Paramètres avancés → Accéder à … (non sécurisé)**, c'est normal, c'est votre propre script).
6. **Déployer → Nouveau déploiement** → ⚙️ type **Application Web** → *Exécuter en tant que : Moi* → *Accès : Tout le monde* → **Déployer**.
7. Copie l'**URL** qui finit par `/exec`.

> Après une modification du script : **Déployer → Gérer les déploiements → ✏️ → Version : Nouvelle version → Déployer** (l'URL ne change pas).

### 2. Brancher l'app
1. Sur le téléphone de ta femme, ouvre https://hakanhoti22-wq.github.io/Haksou/ongles/pro.html dans **Safari**.
2. **Partager → Sur l'écran d'accueil**. Ouvre ensuite l'app depuis l'icône.
3. **Plus → Connexion Google Sheet** : colle l'URL `/exec` et le mot de passe → **Enregistrer et tester**.
4. **Plus → Mon salon**, **Prestations & prix**, **Horaires & congés**, **Règles de réservation** : à adapter.

### 3. Le lien pour les clientes
- **Plus → Mon lien de réservation** donne le lien à mettre dans la bio Instagram ou à envoyer sur WhatsApp. Il fonctionne tout de suite.
- Pour un lien plus court (`…/Haksou/ongles/`), colle l'URL `/exec` dans `ongles/config.js` :
  ```js
  window.ONGLES_API = 'https://script.google.com/macros/s/XXXX/exec';
  ```
  (L'URL `/exec` n'est pas secrète. Le mot de passe, lui, ne doit **jamais** être mis dans ce fichier.)

## Bon à savoir
- **Sécurité** : seules les actions « voir les créneaux, réserver, annuler son RDV » sont publiques. Tout le reste demande le mot de passe. Les clientes ne voient jamais les noms des autres.
- Une même cliente (même numéro) ne peut pas avoir plus de 3 rendez-vous à venir (anti-abus).
- **Rappels SMS / WhatsApp** : Google n'envoie pas de SMS gratuitement. L'app prépare donc le message WhatsApp et ta femme n'a qu'à appuyer sur « Envoyer » (section « Rappels pour demain »).
- Gmail gratuit : environ 100 e-mails par jour au maximum, largement suffisant.
- L'onglet **Rendez-vous** de la Google Sheet est lisible (et exportable). Évite seulement de modifier l'onglet **Données** à la main.
