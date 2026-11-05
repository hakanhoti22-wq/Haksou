# ⏱️ Pointage MIC Marly

Timbre automatiquement l'arrivée et le départ au **Marly Innovation Center** (Route de l'Ancienne-Papeterie, 1723 Marly), même quand toutes les apps sont fermées sur l'iPhone.

## Comment ça marche

| Élément | Rôle |
|---|---|
| **Raccourcis iOS** (automatisations Arrivée/Départ) | Détecte l'entrée et la sortie de la zone en arrière-plan, même si l'app est retirée des apps récentes, et envoie le pointage. |
| **Google Sheet + Apps Script** (`apps-script.gs`) | Enregistre les pointages (gratuit, dans ton compte Google). Ignore les doublons. |
| **Web app** (`index.html`) | Affiche le statut, les heures du jour et de la semaine, l'historique et l'export CSV. Permet aussi de timbrer à la main et de régler la zone sur une carte. |

> Pourquoi pas uniquement une web app ? Safari sur iPhone coupe le GPS dès que la page n'est plus à l'écran. Seul iOS lui-même (Raccourcis) peut surveiller une zone en permanence.

## Installation (≈ 10 min)

📱 **Guide détaillé pour iPhone : [IPHONE.md](IPHONE.md)**

### 1. Google Sheet
1. Crée une Google Sheet vide.
2. **Extensions → Apps Script**, efface le contenu et colle `apps-script.gs`.
3. Remplace `TOKEN = 'change-moi-123'` par un mot de passe à toi.
4. **Déployer → Nouveau déploiement** → type **Application Web** → *Exécuter en tant que : Moi* → *Accès : Tout le monde* → **Déployer**, puis autorise l'accès.
5. Copie l'URL qui finit par `/exec`.

### 2. Ouvrir la web app
L'app est déjà en ligne sur https://hakanhoti22-wq.github.io/Haksou/pointage/ (à côté de l'app de traduction, sans la toucher).
⚠️ Ne change pas les réglages GitHub Pages : ils servent l'app de traduction.
Sur l'iPhone, ouvre l'adresse dans Safari → **Partager → Sur l'écran d'accueil**.

### 3. Configurer l'app (onglet Réglages)
1. Colle l'URL `/exec` et le token → **Enregistrer et tester**.
2. **Plage horaire** : 06:30 – 18:00 par défaut → **Enregistrer la plage**.
3. **Zone du site** : touche **✏️ Dessiner la zone**, pose les coins du site sur la carte, puis **Terminer**. Tu peux ensuite déplacer chaque coin.
   L'app affiche le **cercle pour Raccourcis** (coordonnées + rayon) qui englobe ta zone.

> iOS ne surveille en arrière-plan que des **cercles**. La zone dessinée sert quand l'app est ouverte. Le cercle calculé (zone + 30 m) sert à l'app Raccourcis.

### 4. Automatisations iPhone (l'étape clé)
Deux automatisations dans l'app **Raccourcis**, avec **une seule action chacune** (« Obtenir le contenu de l'URL ») :
- **Arrivée** au MIC → URL ①
- **Départ** du MIC → URL ②

Les URL sont dans **Réglages** de l'app. Le pas à pas est dans [IPHONE.md](IPHONE.md).

## Règles de pointage
| Situation | Résultat |
|---|---|
| Entrée sur le site | Arrivée |
| Sortie **pendant la plage horaire** | Question « Trajet professionnel ? » |
| → Oui | Sortie pro, le timbrage continue |
| → Non | Départ, à l'heure réelle de la sortie |
| → pas de réponse | Retour sur le site le même jour = trajet pro. Sinon = départ à l'heure de la sortie. |
| Sortie **hors plage horaire** | Départ direct |
| Journée jamais fermée (sortie pro sans retour, oubli) | Départ automatique à l'heure de fin de plage, à vérifier |

## Bon à savoir
- iOS peut déclencher l'automatisation avec 1 à 5 minutes de décalage. Tu peux corriger un pointage dans l'historique (✕) ou dans la Google Sheet.
- Sans réseau au moment du passage, le raccourci échoue. Tu peux alors timbrer à la main dans l'app, qui garde le pointage et l'envoie plus tard.
- Après une modification de `apps-script.gs` : Déployer → Gérer les déploiements → Modifier → **Nouvelle version**.

## Partager avec un collègue
Chacun a **sa propre Google Sheet** : tes heures restent privées et chacun a son propre mot de passe.
1. Dans l'app : **Réglages → 📤 Partager l'app**. Envoie le lien par WhatsApp, SMS ou e-mail.
2. Ton collègue ouvre le lien dans **Safari** et accepte l'import : la zone dessinée et la plage horaire sont déjà réglées.
3. Il ajoute l'app à son écran d'accueil (**Partager → Sur l'écran d'accueil**).
4. Il suit les étapes **1, 3 et 4** de ce guide (sa Google Sheet, sa connexion, ses automatisations Raccourcis).

## Corriger l'historique
Dans l'onglet **Historique** :
- **Touche un pointage** (ou ✏️) pour changer sa date, son heure ou son type.
- **＋** ajoute un pointage oublié.
- **☑︎ Sélectionner** permet de supprimer plusieurs pointages ou des journées entières.

> Modifier et ajouter demandent la version du script du 5 novembre 2026 ou plus récente. Recolle `apps-script.gs` (en gardant ton TOKEN), puis Déployer → Gérer les déploiements → ✏️ → **Nouvelle version**.
