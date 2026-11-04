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

## Étape 5 — Automatisation « Arrivée »
1. Ouvre l'app **Raccourcis** → onglet **Automatisation** (en bas) → **+** (ou **Nouvelle automatisation**).
2. Choisis **Arrivée**.
3. **Lieu** → **Choisir** → dans la recherche, colle les **coordonnées** de l'étape 3. Ajuste le rayon en faisant glisser le cercle jusqu'à la valeur indiquée → **OK**.
4. **Heure** : « À tout moment ».
5. Coche **Exécuter immédiatement** et désactive **Me notifier lors de l'exécution** → **Suivant**.
6. **Nouveau raccourci vide**.
7. **Ajouter une action** → cherche **Obtenir le contenu** → **Obtenir le contenu de l'URL**.
8. Dans l'app Pointage, onglet Réglages, copie l'**URL ① arrivée**. Reviens dans Raccourcis, touche le champ bleu **URL** et colle-la.
9. **OK**.

## Étape 6 — Automatisation « Départ » (avec la question)
1. **Automatisation** → **+** → **Départ** → **même lieu, même rayon** → **Exécuter immédiatement** → **Suivant** → **Nouveau raccourci vide**.
2. Ajoute **Obtenir le contenu de l'URL** → colle l'**URL ② sortie**.
3. Ajoute l'action **Si**. iOS remplit automatiquement « Si *Contenu de l'URL* ». Touche **Condition** → **est**, puis touche **Texte** et écris `QUESTION` en majuscules.
4. Ajoute l'action **Choisir dans le menu**. Maintiens-la appuyée et **fais-la glisser** entre « Si » et « Sinon ».
   - Touche **Invite** et écris : `Trajet professionnel ?`
   - Renomme les deux choix **Un** → `Oui` et **Deux** → `Non`.
5. Ajoute **Obtenir le contenu de l'URL** → colle l'**URL ③ trajet pro** → fais-la glisser **sous « Oui »**.
6. Ajoute **Obtenir le contenu de l'URL** → colle l'**URL ④ détimbrer** → fais-la glisser **sous « Non »**.
7. Laisse **Sinon** vide. Le résultat doit ressembler à :

```
Obtenir le contenu de [URL ②]
Si [Contenu de l'URL] est QUESTION
    Choisir dans le menu « Trajet professionnel ? »
    Oui
        Obtenir le contenu de [URL ③]
    Non
        Obtenir le contenu de [URL ④]
    Fin du menu
Sinon
Fin de la condition
```
8. **OK**.

## Étape 7 — Premier test (important)
La première fois, iOS demande si le raccourci peut se connecter à **script.google.com**. Il faut répondre une fois à la main :
1. Dans **Automatisation**, touche « Arrivée » → ouvre le raccourci → touche **▶︎** (en bas).
2. Réponds **Toujours autoriser**.
3. Fais pareil avec « Départ ». Tu verras la question « Trajet professionnel ? » : réponds **Non**.
4. Ouvre l'app Pointage → **Historique** : tu vois l'arrivée et le départ du test. Supprime-les avec **✕**.

## C'est prêt
- En arrivant au MIC, l'arrivée est timbrée toute seule, même si toutes les apps sont fermées.
- En sortant entre 06:30 et 18:00, une notification demande « Trajet professionnel ? » : **touche-la** et réponds.
- En sortant après 18:00, tu es détimbré directement.

## Si ça ne marche pas
| Problème | Solution |
|---|---|
| Rien ne se passe à l'arrivée | Vérifie l'étape 4 (Localisation **Toujours** + **Position exacte**) et que l'automatisation est **activée**. |
| Le pointage arrive avec quelques minutes de retard | Normal sur iOS (1 à 5 min). Corrige dans l'historique si besoin. |
| « Token invalide » | Le mot de passe dans l'app ne correspond pas à celui du script. |
| Pas de notification pour la question | Étape 4.2 (notifications Raccourcis). La question est aussi affichée dans l'app. |
| Mode économie d'énergie actif | iOS peut retarder les automatisations. |
