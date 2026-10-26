# Haksou — Traduction

Application web de traduction pensée pour l'iPhone (installable sur l'écran d'accueil), au design épuré beige, brun et miel, avec des bulles façon iMessage.

## Fonctionnalités

- **Écrire pour traduire** : détection automatique de la langue, plus de 190 langues et variantes.
- **Parler pour traduire** : le micro affiche le texte en direct et **s'arrête tout seul** après un court silence (délai réglable de 0,6 à 3 s).
- **Lecture automatique** : après avoir parlé, la traduction est énoncée à voix haute (voix de l'iPhone, voix en ligne en secours pour les langues sans voix installée).
- **Mode Conversation (talk-to-talk)** : un micro par personne, chacun parle dans sa langue ; les bulles s'affichent de chaque côté avec la traduction et le texte d'origine. Option d'enchaînement automatique qui rouvre le micro de l'autre personne après la lecture.
- Fiabilité : délai maximal sur chaque requête, moteur de traduction de secours (Google → MyMemory), relance du micro si le moteur vocal s'interrompt, garde-fous si un événement vocal ne se déclenche pas, historique conservé sur l'appareil.
- Mode sombre automatique, fonctionne hors ligne pour l'interface.

## Mise en ligne (GitHub Pages)

Le micro exige une adresse **https** : il faut donc héberger l'app.

1. Sur GitHub : *Settings → Pages*.
2. *Source* : « Deploy from a branch », choisir la branche puis le dossier `/ (root)`, *Save*.
3. Après une minute, l'app est disponible à `https://<utilisateur>.github.io/<dépôt>/`.

## Installation sur iPhone

1. Ouvrir l'adresse dans **Safari**.
2. Bouton *Partager* → **Sur l'écran d'accueil**.
3. Au premier usage du micro, autoriser l'accès au micro et à la reconnaissance vocale.

> Si le micro refuse de démarrer : *Réglages → Siri* (ou *Siri & Recherche*) et vérifier que **Dictée** est activée (*Réglages → Général → Clavier → Activer Dictée*).

## Développement local

```sh
python3 -m http.server 8000
```

Puis ouvrir `http://localhost:8000`. Aucune dépendance, aucune étape de compilation.

## Structure

| Fichier | Rôle |
| --- | --- |
| `index.html` | Structure de l'interface |
| `styles.css` | Design (palette, bulles, feuilles, mode sombre) |
| `app.js` | Logique de l'app : modes, fil de messages, réglages |
| `speech.js` | Micro avec arrêt automatique au silence, synthèse vocale |
| `translator.js` | Traduction avec délai maximal, cache et moteur de secours |
| `languages.js` | Liste des langues et locales vocales |
| `sw.js`, `manifest.webmanifest`, `icons/` | Installation sur l'écran d'accueil et hors ligne |
