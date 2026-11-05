# 🚀 Mettre Haksou Pro en service, étape par étape

Compte environ **1 h 30** pour les phases 1 à 4, que tu peux faire seul ce week-end. Les phases 5 et 6 concernent la vente et la vie de l'appli.

> ✅ = à cocher quand c'est fait.

---

## Phase 1 — Mettre l'appli en ligne (10 min)

L'appli est prête sur la branche `claude/haksou-pro`. Pour la publier, il faut la fusionner dans `main` : GitHub Pages publie automatiquement ce qui se trouve sur `main`.

1. ☐ Sur GitHub, ouvre ton dépôt **Haksou**, puis **Pull requests → New pull request**. Choisis `base: main` ← `compare: claude/haksou-pro` → **Create pull request** → **Merge pull request**. *(Ou demande à Claude de créer la pull request.)*
2. ☐ Attends 1 à 2 minutes, puis ouvre **https://hakanhoti22-wq.github.io/Haksou/gestion/**. L'appli s'ouvre en **mode démo**.
3. ☐ Essaie-la avec les comptes de démo (patron, employé, propriétaire).

> ⚠️ Ne touche pas aux réglages GitHub Pages : ils servent aussi tes autres applis.

---

## Phase 2 — Créer la base de données Supabase (20 min)

### 2.1 Créer le projet
1. ☐ Va sur **https://supabase.com** → **Start your project** → connecte-toi avec GitHub.
2. ☐ **New project** :
   - **Name** : `haksou-production`
   - **Database password** : clique sur *Generate*, puis **garde-le précieusement** (gestionnaire de mots de passe).
   - **Region** : **Zurich** si elle est proposée, sinon **Frankfurt** (Europe = argument nLPD).
   - Plan **Free** pour l'instant.
3. ☐ Attends environ 2 minutes que le projet soit prêt.

### 2.2 Installer la base
1. ☐ Menu de gauche → **SQL Editor** → **New query**.
2. ☐ Ouvre le fichier `gestion/supabase/schema.sql` sur GitHub, bouton **Raw**, puis **copie tout** (Ctrl+A, Ctrl+C).
3. ☐ Colle-le dans l'éditeur → **Run**. Le résultat attendu est « Success. No rows returned ». Des messages *NOTICE* sont normaux.

### 2.3 Régler la connexion des utilisateurs
1. ☐ **Authentication → URL Configuration** :
   - **Site URL** : `https://hakanhoti22-wq.github.io/Haksou/gestion/`
   - **Redirect URLs** → *Add URL* : la même adresse.
2. ☐ **Authentication → Providers → Email** : laisse **Confirm email** activé. C'est plus sérieux : chaque utilisateur confirme son e-mail.
3. ☐ **Authentication → Email Templates** : traduis en français au moins *Confirm signup* et *Reset password* (sujet + texte). Par exemple : « Confirme ton inscription à Haksou Pro ».

> ⚠️ **Limite importante** : le service d'e-mails intégré à Supabase n'envoie que **très peu d'e-mails par heure**. Il suffit pour tester, pas pour des clients. Avant ton premier client, configure un vrai service d'envoi dans **Project Settings → Authentication → SMTP Settings**. Quelques possibilités : Brevo, Resend, ou ta messagerie Infomaniak si tu as un domaine.

---

## Phase 3 — Brancher l'appli sur Supabase (10 min)

1. ☐ Dans Supabase, ouvre **Project Settings → API** et copie :
   - **Project URL** (ex. `https://abcd1234.supabase.co`)
   - la clé **anon public** (longue clé qui commence par `eyJ…`). ⚠️ **Jamais** la clé `service_role` !
2. ☐ Sur GitHub, ouvre `gestion/js/config.js` → icône ✏️ (modifier), puis remplis :
   ```js
   export const SUPABASE_URL = 'https://abcd1234.supabase.co';
   export const SUPABASE_ANON_KEY = 'eyJhbGciOi...';
   export const SUPPORT_CONTACT = { name: 'Haksou', email: 'ton.email@exemple.ch', phone: '079 123 45 67' };
   ```
3. ☐ **Commit changes** (sur `main`). Attends 1 à 2 minutes, puis recharge l'appli : l'écran **Connexion / Créer un compte** remplace le mode démo.

> La clé *anon* peut être visible publiquement : c'est prévu ainsi. La sécurité est assurée par les règles de `schema.sql`.

---

## Phase 4 — Devenir propriétaire et tout tester (30 min)

### 4.1 Ton compte propriétaire
1. ☐ Dans l'appli, **Créer un compte** avec **ton** e-mail, puis confirme-le avec le lien reçu par e-mail.
2. ☐ Connecte-toi. L'écran « Bienvenue » s'affiche : **ne crée pas d'entreprise**.
3. ☐ Dans Supabase → **SQL Editor**, exécute (avec ton e-mail) :
   ```sql
   insert into platform_admins (user_id) select id from auth.users where email = 'ton.email@exemple.ch';
   ```
4. ☐ Recharge l'appli : **Console Haksou** apparaît.

### 4.2 Répétition générale avec une fausse entreprise
Utilise un 2e et un 3e e-mail (ou des alias, du genre `ton.email+patron@gmail.com` et `ton.email+employe@gmail.com`), et un autre navigateur ou une fenêtre privée pour chaque personne.

1. ☐ **Console → Nouvelle entreprise cliente** : « Entreprise Test ». Copie le message d'accueil.
2. ☐ **Patron** : crée le compte, puis **Rejoindre une entreprise** avec le **code responsable**. Remplis **Réglages → Entreprise** (adresse, IBAN, TVA).
3. ☐ **Employé** : dans **Équipe**, le patron copie l'invitation. L'employé crée son compte et rejoint avec le **code employé**.
4. ☐ Teste sur **ton téléphone** : installe l'appli (Safari → Partager → *Sur l'écran d'accueil*). Pointe, passe en **mode avion**, pointe encore, puis remets le réseau : le pointage part tout seul.
5. ☐ Le patron crée une **facture**, l'**émet**, télécharge le **PDF**, puis fait une **note de crédit**.
6. ☐ L'employé envoie une **demande d'aide**, et tu lui réponds depuis la **Console**.
7. ☐ Dans la console, **Accéder** à l'entreprise test (avec un motif), corrige quelque chose, puis **Quitter le mode support**. Côté patron, vérifie que l'accès apparaît dans **Réglages**.
8. ☐ **Suspends**, puis **réactive** l'entreprise test.

Si tout marche : **félicitations, ta plateforme est opérationnelle** 🎉. Si quelque chose bloque, note le message exact et l'écran, puis demande à Claude.

---

## Phase 5 — Avant le premier client payant

### Technique
- ☐ **Supabase plan Pro** (≈ 25 $/mois) : **Organization → Billing → Upgrade**. Indispensable : pas de mise en pause automatique, et des sauvegardes quotidiennes.
- ☐ **SMTP** configuré (voir 2.3).
- ☐ **Projet de test** : crée un 2e projet Supabase `haksou-test` (gratuit), avec le même `schema.sql`, pour essayer les nouveautés sans toucher aux clients.
- ☐ *(Recommandé)* **Ton propre nom de domaine**, par exemple `haksou.ch` (environ 10 à 20 CHF/an chez Infomaniak ou Hostpoint), avec l'appli sur `app.haksou.ch`. Le plus simple est d'utiliser **Cloudflare Pages** ou **Netlify** (gratuits) : connecte le dépôt GitHub, dossier de publication `gestion`, puis ajoute ton domaine. N'oublie pas de mettre à jour la *Site URL* dans Supabase (2.3).

### Administratif et juridique (Suisse)
- ☐ **Statut** : une *raison individuelle* suffit pour commencer. Annonce-toi comme indépendant à ta **caisse AVS**, qui te confirmera ton statut.
- ☐ **TVA** : obligatoire seulement au-delà de **100 000 CHF** de chiffre d'affaires par an.
- ☐ **Contrat d'abonnement** (conditions générales) : prix, durée, résiliation, disponibilité, responsabilité limitée, export des données en fin de contrat, **accès support tracé**.
- ☐ **Politique de confidentialité** (nLPD) : quelles données, où elles sont hébergées (Supabase, Europe), combien de temps, qui y accède.
- ☐ Fais relire ces deux documents par une **fiduciaire** ou un **juriste**, ou utilise un modèle d'une association professionnelle. *(Claude peut t'aider à préparer un premier brouillon.)*

### Commercial
- ☐ **Prix** : par exemple 5 à 15 CHF par employé et par mois, avec un **essai gratuit de 30 jours** (déjà géré dans la console).
- ☐ Une **page de présentation** simple (ce que fait l'appli, prix, contact).
- ☐ **3 à 5 entreprises test** avec le guide `TESTS-UTILISATEURS.md`, avant de démarcher plus largement.
- ☐ Facture tes clients… **avec ta propre appli** (module Devis & factures).

---

## Phase 6 — Faire vivre l'appli

### Au quotidien (5 min par jour)
- ☐ Ouvre la **Console** : demandes d'aide ouvertes, **erreurs** remontées, essais qui se terminent.
- ☐ Réponds aux demandes d'aide dans la journée. C'est ce qui fait ta réputation.

### Quand un client appelle
1. Console → l'entreprise → **Accéder** → indique le motif (« Appel de M. X : … »).
2. Regarde et corrige, comme si tu étais le patron.
3. **Quitter le mode support** dès que c'est fini (sinon il se ferme tout seul après 2 h).

### Pour chaque nouvelle version
1. Fais les changements sur une **branche**, jamais directement sur `main`.
2. Lance les **tests automatiques** (`gestion/tests/README.md`), qui doivent être tous verts, puis essaie sur le **projet Supabase de test**.
3. Si `schema.sql` a changé : relance-le **en entier** sur le projet test, puis sur la production. Il est prévu pour être relancé sans rien effacer.
4. Augmente le numéro de version dans `gestion/js/meta.js` (`APP_VERSION`) et dans `gestion/sw.js` (`haksou-pro-v4` → `v5`), pour que les téléphones prennent la nouvelle version.
5. Fusionne dans `main`. Les utilisateurs l'ont dans les minutes qui suivent.

### Sauvegardes
- Le plan Pro sauvegarde chaque jour automatiquement (**Database → Backups**).
- Une fois par mois, par sécurité : **Database → Backups → Download**, ou fais un export depuis le *Table Editor*.

---

## 🆘 En cas de problème

| Problème | Solution |
|---|---|
| L'appli reste en mode démo après la phase 3 | Vérifie `config.js` (les guillemets, aucune ligne vide entre les guillemets), attends 2 minutes, puis vide le cache (rechargement forcé). |
| « E-mail ou mot de passe incorrect » alors qu'il est juste | L'e-mail n'est peut-être pas confirmé : regarde dans les spams. |
| Les e-mails de confirmation n'arrivent plus | Tu as atteint la limite du service d'e-mails intégré : configure un SMTP (2.3). |
| Pas de menu « Console Haksou » | Refais l'étape 4.1-3 avec **exactement** ton e-mail de connexion, puis déconnecte-toi et reconnecte-toi. |
| « Code d'entreprise inconnu » | Le code responsable ne sert qu'**une fois**. Le code employé se trouve dans **Équipe**. |
| Projet Supabase « Paused » | Plan gratuit inactif depuis une semaine : clique sur **Restore** (et passe au plan Pro pour les clients). |
| Un client voit « Compte suspendu » | Console → **Gérer** → statut **Actif**. |
