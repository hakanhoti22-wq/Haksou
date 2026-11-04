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

### 1. Google Sheet
1. Crée une Google Sheet vide.
2. **Extensions → Apps Script**, efface le contenu et colle `apps-script.gs`.
3. Remplace `TOKEN = 'change-moi-123'` par un mot de passe à toi.
4. **Déployer → Nouveau déploiement** → type **Application Web** → *Exécuter en tant que : Moi* → *Accès : Tout le monde* → **Déployer**, puis autorise l'accès.
5. Copie l'URL qui finit par `/exec`.

### 2. Héberger la web app
Avec GitHub Pages : dépôt → **Settings → Pages** → *Deploy from a branch* → `main` / `root`.
L'app est ensuite disponible sur `https://<utilisateur>.github.io/<dépôt>/pointage/`.
Sur l'iPhone, ouvre-la dans Safari → **Partager → Sur l'écran d'accueil**.

### 3. Configurer l'app
Onglet **Réglages** : colle l'URL `/exec` et le token → **Enregistrer et tester**. Vérifie le cercle sur la carte.

### 4. Automatisations iPhone (l'étape clé)
1. App **Raccourcis** → **Automatisation** → **+** → **Arrivée**.
2. **Lieu** → cherche « Marly Innovation Center », règle le rayon (150–250 m conseillé).
3. Choisis **Exécuter immédiatement**.
4. **Nouveau raccourci vide** → action **Obtenir le contenu de l'URL** → colle l'**URL arrivée** (copiée depuis Réglages).
5. Fais pareil avec **Départ** et l'**URL départ**.
6. **Réglages iOS → Confidentialité → Service de localisation → Raccourcis** : *Toujours* + *Position exacte*.

## Bon à savoir
- iOS peut déclencher l'automatisation avec 1 à 5 minutes de décalage. Tu peux corriger un pointage directement dans la Google Sheet.
- Sans réseau au moment du passage, le Raccourci échoue. Tu peux alors timbrer à la main dans l'app, qui garde le pointage et l'envoie plus tard.
- Les pointages en double (deux « Arrivée » de suite) sont ignorés automatiquement.
