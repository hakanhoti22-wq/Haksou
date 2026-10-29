# Haksou — Traduction

Application web de traduction pensée pour l'iPhone (installable sur l'écran d'accueil), au design épuré beige, brun et miel, avec des bulles façon iMessage.

## Fonctionnalités

- **Écrire pour traduire** : détection automatique de la langue, plus de 190 langues et variantes.
- **Parler pour traduire** : le micro affiche le texte en direct et **s'arrête tout seul** après un court silence (délai réglable de 0,6 à 3 s).
- **Lecture automatique** : après avoir parlé, la traduction est énoncée à voix haute (voix de l'iPhone, voix en ligne en secours pour les langues sans voix installée).
- **Mode Conversation (talk-to-talk)** : un micro par personne, chacun parle dans sa langue ; les bulles s'affichent de chaque côté avec la traduction et le texte d'origine. Option d'enchaînement automatique qui rouvre le micro de l'autre personne après la lecture.
- Fiabilité : délai maximal sur chaque requête, moteur de traduction de secours (Google → MyMemory), relance du micro si le moteur vocal s'interrompt, garde-fous si un événement vocal ne se déclenche pas, historique conservé sur l'appareil.
- Mode sombre automatique, fonctionne hors ligne pour l'interface.

## Micro fiable sur iPhone (recommandé)

Sur les iOS récents, la reconnaissance vocale intégrée à Safari devient « sourde » après la première dictée : il faut recharger la page pour reparler. C'est un bug d'Apple ([WebKit 321436](https://bugs.webkit.org/show_bug.cgi?id=321436)), que l'app ne peut pas corriger.

La solution : l'app enregistre elle-même la voix, détecte le silence, puis fait transcrire l'audio par **Whisper**.

1. Créer un compte gratuit sur [console.groq.com](https://console.groq.com/keys) et générer une clé (elle commence par `gsk_`).
2. Dans l'app : ⚙︎ Réglages → **Micro fiable (Whisper)** → coller la clé.

La clé reste sur le téléphone et n'est envoyée qu'à Groq. Elle sert aussi de traduction de secours si les services gratuits ne répondent pas. Une clé OpenAI (`sk-…`) fonctionne aussi.

## Relais familial (aucune clé chez vos proches)

Le dossier [`relay/`](relay/) contient un petit serveur gratuit (Cloudflare Worker) qui garde vos clés cachées. Vos proches ouvrent votre **lien famille** et le micro fiable + la voix naturelle fonctionnent sans clé.
Mise en place pas à pas : [`relay/LISEZMOI.md`](relay/LISEZMOI.md).
Essai gratuit de 7 jours, formules (3,50 CHF / 3 mois, 11 CHF / an, 23 CHF à vie) et invitations famille : [`relay/ABONNEMENTS.md`](relay/ABONNEMENTS.md).

## Voix naturelle (IA)

Pour une voix humaine, chaleureuse et pas robotique : ⚙︎ Réglages → **Voix naturelle (IA)** → coller une clé.

- **ElevenLabs** (clé `sk_…`) : la voix la plus naturelle. Offre gratuite limitée (environ 10 minutes de voix par mois), puis à partir de 6 $/mois.
- **OpenAI** (clé `sk-…`) : très naturelle, environ 0,015 $ par minute de voix.

Sans clé, ou si le service ne répond pas, l'app utilise la meilleure voix de l'iPhone. Pour une voix iPhone gratuite bien plus naturelle : Réglages → rechercher « Voix » (menu « Lire et énoncer » sur iOS 26, « Contenu énoncé » avant) → choisir la langue → télécharger une voix « Premium » ou « Améliorée ».

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
| `speech.js` | Reconnaissance vocale de Safari/Chrome, synthèse vocale |
| `recorder.js` | Enregistrement de la voix avec détection du silence |
| `stt.js` | Transcription Whisper (Groq ou OpenAI) |
| `tts.js` | Voix naturelles (ElevenLabs ou OpenAI) |
| `audio.js` | Moteur audio partagé (Web Audio) |
| `api.js` | Accès aux services d'IA (clé directe ou relais familial) |
| `account.js` | Compte : essai, abonnement, accès famille |
| `config.js` | Adresse du relais et prix affichés |
| `relay/worker.js` | Relais familial à déployer sur Cloudflare |
| `translator.js` | Traduction avec délai maximal, cache et moteur de secours |
| `languages.js` | Liste des langues et locales vocales |
| `sw.js`, `manifest.webmanifest`, `icons/` | Installation sur l'écran d'accueil et hors ligne |
