# 🏢 Haksou Pro

Une seule appli pour gérer une petite entreprise, sur téléphone comme sur ordinateur.

| Module | Ce qu'il fait |
|---|---|
| ⏱️ **Pointage** | Arrivée et départ en un clic (heure fixée par le serveur), heures du jour et de la semaine. Corrections avec **motif obligatoire** et **journal** visible par le responsable, qui peut aussi les interdire. Tableau des heures de l'équipe, **relevé d'heures mensuel en PDF**, export CSV. |
| 🌴 **Congés** | Demandes d'absence (vacances, maladie…), validation par le responsable, absences à venir, jours de vacances pris dans l'année. |
| 📅 **Planning** | Horaires de la semaine par employé, répétition du lundi au vendredi, copie de la semaine précédente, congés affichés, PDF. |
| 🔧 **Interventions** | Bons d'intervention : client, technicien, travaux, matériel, **photos**, **signature du client sur l'écran**, PDF, et transformation en facture en un clic. |
| 🧾 **Devis & factures** | Lignes, articles du stock, heures de main d'œuvre, TVA, arrondi à 5 centimes en CHF, devis transformé en facture, factures en retard. **Factures conformes** : numéro définitif à l'émission (aucun trou), facture émise **verrouillée** (ni modification ni suppression), **notes de crédit** pour corriger ou annuler, historique de chaque document. Vrais **PDF**, envoyés en pièce jointe. |
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
│   ├── utils.js           dates, argent, fenêtres, photos, signature
│   ├── pdf.js             création des PDF, téléchargement et partage
│   └── modules/           un fichier par module
│       ├── accueil.js  pointage.js  conges.js  planning.js
│       ├── interventions.js  factures.js  clients.js
│       └── stock.js  frais.js  equipe.js  reglages.js
├── vendor/jspdf…          générateur PDF (licence MIT), inclus pour marcher hors ligne
├── supabase/schema.sql    tables + règles de sécurité + fonctions
├── tests/                 tests automatiques (navigateur + base de données)
├── manifest.webmanifest   installation sur l'écran d'accueil
└── sw.js                  ouverture hors ligne
```

Pas de framework et pas de compilation : du HTML, du CSS et du JavaScript moderne, comme l'appli Pointage.

## 🔒 Règles importantes
| Règle | Pourquoi |
|---|---|
| Une facture brouillon n'a **pas de numéro**. Il est attribué au clic sur **Émettre** (F-2026-001, F-2026-002…). | La numérotation des factures doit être continue, sans trous. |
| Une facture émise ne peut plus être **modifiée ni supprimée**. On peut seulement changer son statut (payée). | Les factures doivent être conservées telles quelles pendant 10 ans. |
| Pour corriger une facture émise : **Note de crédit** (NC-2026-001), puis **Dupliquer** pour refaire une facture juste. Une note de crédit totale annule la facture. | C'est la méthode comptable correcte. |
| Un pointage n'est **jamais effacé** : une suppression le masque, et chaque ajout après coup, correction ou suppression est **journalisé avec son motif**. | Le patron peut contrôler, et l'enregistrement du temps de travail est obligatoire. |
| Ces règles sont appliquées **par la base de données** elle-même, pas seulement par l'écran. | Personne ne peut les contourner, même en bricolant l'appli. |

## 📄 PDF et envoi
Chaque document a un bouton **📄 PDF**, qui télécharge un vrai fichier. Sur les devis, factures et bons d'intervention, le bouton **📤 Envoyer** fonctionne ainsi :
- sur **téléphone**, il ouvre le partage (Mail, WhatsApp…) avec le PDF déjà en pièce jointe ;
- sur **ordinateur**, il télécharge le PDF et ouvre un e-mail prérempli, dans lequel il suffit de glisser le fichier.

## 🧪 Tests
- **Automatiques** : voir [`tests/README.md`](tests/README.md). Il y a 39 vérifications dans le navigateur, plus les tests des règles de sécurité de la base.
- **Avec de vrais utilisateurs** : voir le guide [`TESTS-UTILISATEURS.md`](TESTS-UTILISATEURS.md).

## 🔄 Mettre à jour une base Supabase existante
Relance simplement tout `supabase/schema.sql` dans le SQL Editor. Il est prévu pour être relancé : il ajoute ce qui manque sans rien effacer.

## ℹ️ Limites actuelles (pistes pour la suite)
- **Photos et signatures** : réduites puis enregistrées dans la base. C'est parfait pour démarrer. Pour des milliers de photos, il faudra passer sur *Supabase Storage*.
- **Mode démo** : la mémoire du navigateur est limitée (environ 5 Mo), donc pas trop de photos.
- Idées pour plus tard : QR-facture suisse, rappels automatiques des factures impayées, notifications push, géolocalisation du pointage, export comptable, abonnement payant par entreprise.
