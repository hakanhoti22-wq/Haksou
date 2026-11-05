# 🏢 Haksou Pro

Une seule appli pour gérer une petite entreprise, sur téléphone comme sur ordinateur.

| Module | Ce qu'il fait |
|---|---|
| ⏱️ **Pointage** | Arrivée et départ en un clic, heures du jour et de la semaine, pointages oubliés. Le responsable voit qui est présent, un tableau des heures de la semaine, et peut exporter le mois (CSV pour Excel ou la paie). |
| 🌴 **Congés** | Demandes d'absence (vacances, maladie…), validation par le responsable, absences à venir, jours de vacances pris dans l'année. |
| 📅 **Planning** | Horaires de la semaine par employé, répétition du lundi au vendredi, copie de la semaine précédente, congés affichés, impression. |
| 🔧 **Interventions** | Bons d'intervention : client, technicien, travaux, matériel, **photos**, **signature du client sur l'écran**, PDF, et transformation en facture en un clic. |
| 🧾 **Devis & factures** | Lignes, articles du stock, heures de main d'œuvre, TVA, arrondi à 5 centimes en CHF, numérotation automatique (D-2026-001, F-2026-001), statuts, factures en retard, devis transformé en facture, PDF et e-mail. |
| 👥 **Clients** | Carnet d'adresses partagé (appel, e-mail, itinéraire). |
| 📦 **Stock** | Articles, entrées et sorties avec historique, alertes de stock bas, valeur du stock, **scan de code-barres** par la caméra, inventaire CSV. |
| 💳 **Notes de frais** | Photo du ticket, validation, remboursement, résumé mensuel par catégorie et par employé, rapport PDF et CSV. |

En plus : un **tableau de bord** qui résume tout, la gestion de l'**équipe** (rôles responsable et employé, code d'invitation) et des **réglages** (infos de l'entreprise, monnaie, TVA, tarif horaire, modules activés).

Chaque entreprise **active seulement les modules dont elle a besoin** : un restaurant prendra Pointage, Planning et Stock, un plombier Interventions, Devis et Frais.

---

## 🧪 1. Essayer tout de suite (mode démo)

L'appli fonctionne **sans rien configurer**, en mode démo : les données restent dans le navigateur, avec des exemples déjà remplis.

- En ligne (une fois la branche fusionnée dans `main`) : **https://hakanhoti22-wq.github.io/Haksou/gestion/**
- Sur ton ordinateur : `python3 -m http.server` à la racine du dépôt, puis ouvre http://localhost:8000/gestion/

Choisis **Hakan (patron)** pour tout voir, ou **Léa** / **Karim** pour voir l'appli côté employé.

> ⚠️ Il faut ouvrir l'appli par une adresse `http(s)://`, pas en double-cliquant sur `index.html`.

## 🚀 2. Passer en vrai (Supabase, gratuit pour commencer)

Le mode démo est fait pour tester. Pour une vraie équipe, avec plusieurs téléphones qui partagent les données :

1. Crée un compte sur **https://supabase.com**, puis **New project** (choisis la région *Central EU (Zurich)* ou *Frankfurt*).
2. Va dans **SQL Editor → New query**, colle tout le contenu de [`supabase/schema.sql`](supabase/schema.sql), puis clique **Run**.
3. Va dans **Project Settings → API** et copie **Project URL** et la clé **anon public**.
4. Colle-les dans [`js/config.js`](js/config.js) :
   ```js
   export const SUPABASE_URL = 'https://xxxx.supabase.co';
   export const SUPABASE_ANON_KEY = 'eyJhbGciOi...';
   ```
5. Dans **Authentication → URL Configuration**, mets l'adresse de l'appli dans *Site URL* (ex. `https://hakanhoti22-wq.github.io/Haksou/gestion/`).
6. Publie (commit + push). C'est prêt !

**Ensuite :**
- Le patron crée son compte, puis **Créer mon entreprise**. Il devient responsable.
- Dans **Équipe**, il copie l'invitation (lien + code à 6 lettres) et l'envoie à ses employés.
- Chaque employé crée son compte, puis **Rejoindre une entreprise** avec le code.

> La clé *anon* peut être publique : la sécurité est assurée par les règles du fichier `schema.sql`. Une entreprise ne voit jamais les données d'une autre, un employé ne voit que ses propres pointages et frais, et seul un responsable valide les congés et les frais ou modifie le planning.

> Par défaut, Supabase demande de confirmer son e-mail à l'inscription. Pour tester plus vite, tu peux désactiver *Confirm email* dans **Authentication → Providers → Email**.

## 📱 Installer sur le téléphone
- **iPhone** : Safari → Partager → **Sur l'écran d'accueil**
- **Android** : Chrome → menu ⋮ → **Installer l'application**

## 🗂 Organisation du code

```
gestion/
├── index.html             page unique
├── css/app.css            design (thème sombre, mobile d'abord, mise en page des PDF)
├── js/
│   ├── config.js          ← clés Supabase (vide = mode démo)
│   ├── app.js             connexion, menu, navigation
│   ├── db.js              données : même code pour la démo et pour Supabase
│   ├── seed.js            données d'exemple de la démo
│   ├── meta.js            liste des modules et des statuts
│   ├── utils.js           dates, argent, fenêtres, photos, signature, impression
│   └── modules/           un fichier par module
│       ├── accueil.js  pointage.js  conges.js  planning.js
│       ├── interventions.js  factures.js  clients.js
│       └── stock.js  frais.js  equipe.js  reglages.js
├── supabase/schema.sql    tables + règles de sécurité + fonctions
├── manifest.webmanifest   installation sur l'écran d'accueil
└── sw.js                  ouverture hors ligne
```

Pas de framework et pas de compilation : du HTML, du CSS et du JavaScript moderne, comme l'appli Pointage.

## ℹ️ Limites actuelles (pistes pour la suite)
- **PDF** : produit avec « Imprimer → Enregistrer en PDF » du téléphone ou de l'ordinateur. Le bouton E-mail prépare le message, mais le PDF est à joindre à la main.
- **Photos et signatures** : réduites puis enregistrées dans la base. C'est parfait pour démarrer. Pour des milliers de photos, il faudra passer sur *Supabase Storage*.
- **Mode démo** : la mémoire du navigateur est limitée (environ 5 Mo), donc pas trop de photos.
- Idées pour plus tard : QR-facture suisse, rappels automatiques des factures impayées, notifications push, géolocalisation du pointage, export comptable, abonnement payant par entreprise.
