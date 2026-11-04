# 📱 Installer le pointage sur iPhone — pas à pas

Durée : environ 20 minutes, une seule fois.

## Étape 1 — La Google Sheet (sur un ordinateur, de préférence)
Suis la section « Installation → 1. Google Sheet » du [README](README.md).
À la fin, tu as deux choses à garder :
- l'**URL** qui finit par `/exec` ;
- ton **mot de passe** (le TOKEN).

> Sans ordinateur : dans Safari, touche **aA** → **Demander le site pour ordinateur** sur sheets.new. C'est faisable, mais petit et peu pratique.

## Étape 2 — Installer l'app sur l'écran d'accueil
1. Ouvre **Safari** (pas Chrome) : https://hakanhoti22-wq.github.io/Haksou/pointage/
2. Touche **Partager** (carré avec une flèche) → **Sur l'écran d'accueil** → **Ajouter**.
3. Ouvre l'app **Pointage** depuis l'écran d'accueil. À partir de maintenant, utilise toujours cette icône, pas Safari.

## Étape 3 — Configurer l'app
Onglet **Réglages** :
1. **Connexion Google Sheet** : colle l'URL `/exec` et ton mot de passe → **Enregistrer et tester** → « Connexion OK ✅ ».
2. **Plage horaire** : 06:30 → 18:00 → **Enregistrer la plage**.
3. **Zone du site** : **📍 Ma position** (pour centrer), puis **✏️ Dessiner la zone**. Touche les coins du site un par un → **✓ Terminer**.
4. Sous la carte, note le **cercle pour Raccourcis** : coordonnées (ex. `46.77814, 7.14999`) et rayon (ex. `150 m`).

## Étape 4 — Autorisations iOS
**Réglages** de l'iPhone :
1. **Confidentialité et sécurité → Service de localisation** : activé.
   → **Raccourcis** : **Toujours** (si proposé) et **Position exacte** activée.
2. **Notifications → Raccourcis** : **Autoriser les notifications**, style **Bannières**. C'est là qu'apparaîtra la question « Trajet professionnel ? ».

## Étape 5 — Automatisation « Arrivée » (1 seule action)
1. Ouvre l'app **Raccourcis** → onglet **Automatisation** (en bas) → **+**.
2. Choisis **Arrivée**.
3. **Lieu** → **Choisir** → écris **Marly Innovation Center** (ou colle les coordonnées affichées sous la carte de l'app) → règle le rayon indiqué dans l'app → **OK**.
4. Coche **Exécuter immédiatement** → **Suivant** → **Nouveau raccourci vide**.
5. **Ajouter une action** → cherche **URL** → touche **Obtenir le contenu de l'URL**.
6. Dans l'app Pointage → Réglages → **Copier ①**. Reviens dans Raccourcis, touche le mot bleu **URL**, colle → **OK**.

## Étape 6 — Automatisation « Départ » (pareil)
Refais exactement l'étape 5, mais choisis **Départ** au lieu d'Arrivée et colle l'**URL ②** (bouton **Copier ②**).

C'est tout. Tu n'as pas besoin de « Si » ni de « Menu ». Quand tu sors entre 06:30 et 18:00, l'app te demande « Trajet professionnel ? » à la prochaine ouverture. Si tu ne réponds pas :
- tu reviens sur le site le même jour → la sortie compte comme **trajet pro** ;
- tu ne reviens pas → tu es **détimbré à l'heure de ta sortie**.

> Option avancée (facultative) : pour recevoir la question directement en notification, voir « Option avancée » dans l'onglet Réglages de l'app.

## Étape 7 — Premier test (important)
La première fois, iOS demande si le raccourci peut se connecter à **script.google.com**. Il faut répondre une fois à la main :
1. Dans **Automatisation**, touche « Arrivée » → ouvre le raccourci → touche **▶︎** (en bas) → **Toujours autoriser**.
2. Fais pareil avec « Départ ».
3. Ouvre l'app Pointage → **Historique** : tu vois l'arrivée et la sortie du test. Supprime-les avec **✕**.

## C'est prêt
- En arrivant au MIC, l'arrivée est timbrée toute seule, même si toutes les apps sont fermées.
- En sortant entre 06:30 et 18:00 : l'app demande « Trajet professionnel ? » quand tu l'ouvres. Sans réponse, elle décide toute seule (voir étape 6).
- En sortant après 18:00, tu es détimbré directement.

## Si ça ne marche pas
| Problème | Solution |
|---|---|
| Rien ne se passe à l'arrivée | Vérifie l'étape 4 (Localisation **Toujours** + **Position exacte**) et que l'automatisation est **activée**. |
| Le pointage arrive avec quelques minutes de retard | Normal sur iOS (1 à 5 min). Corrige dans l'historique si besoin. |
| « Token invalide » | Le mot de passe dans l'app ne correspond pas à celui du script. |
| Mode économie d'énergie actif | iOS peut retarder les automatisations. |
