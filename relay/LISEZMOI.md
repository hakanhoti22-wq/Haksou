# Relais familial Haksou — mise en place (10 minutes, gratuit)

Le relais garde **vos clés cachées sur un serveur Cloudflare gratuit**.
Vos proches ouvrent simplement votre **lien famille** : le micro fiable et la voix naturelle marchent chez eux **sans aucune clé**.

> Plus confortable sur un ordinateur, mais faisable sur iPhone (Safari, mode « Version pour ordinateur » si l'écran est tronqué).

---

## Étape 1 — Créer le relais

1. Aller sur **https://dash.cloudflare.com/sign-up** et créer un compte gratuit (e-mail + mot de passe), puis valider l'e-mail.
2. Dans le menu de gauche : **Compute (Workers)** → **Workers & Pages**
   (selon la version : directement **Workers & Pages**).
3. Bouton **Create** → **Start with Hello World!** (ou « Create Worker »).
4. Nom : **`haksou-relais`** → **Deploy**.
5. Bouton **Edit code**.
6. **Tout effacer** dans l'éditeur, puis **coller tout le contenu du fichier `worker.js`**.
7. Bouton **Deploy** en haut à droite.
8. Notez l'adresse affichée, du type :
   **`https://haksou-relais.VOTRE-NOM.workers.dev`**

## Étape 2 — Ajouter le code famille et les clés

Dans votre worker : **Settings** → **Variables and Secrets** → **+ Add**.
Pour chaque ligne, choisir le type **Secret** :

| Nom (exactement) | Valeur | |
| --- | --- | --- |
| `ACCESS_CODE` | un code famille de votre choix, ex. `soleil-2026` | **obligatoire** |
| `GROQ_KEY` | votre clé Groq `gsk_…` | micro fiable + traduction de secours |
| `OPENAI_KEY` | votre clé OpenAI `sk-…` | voix naturelle (facultatif) |
| `ELEVENLABS_KEY` | votre clé ElevenLabs `sk_…` | voix naturelle (facultatif) |

Puis **Deploy** (ou « Save and deploy »).

**Vérifier** : ouvrir l'adresse du relais dans Safari → la page affiche « Relais Haksou opérationnel. »

## Étape 3 — Relier votre app et partager

1. Ouvrir **Haksou** → **⚙︎ Réglages** → **Relais familial**.
2. Coller l'**adresse du relais** puis le **code famille**.
   L'étiquette passe à **Connecté** et un message confirme « micro fiable ✓ · voix naturelle ✓ ».
3. Toucher **Partager le lien famille** et l'envoyer (SMS, WhatsApp…).

## Chez vos proches

1. Ouvrir le lien **dans Safari** (« Ouvrir dans Safari » depuis WhatsApp).
2. Message « Relais familial connecté » → c'est prêt.
3. **Partager → Sur l'écran d'accueil** : l'icône garde la configuration.

---

## Bon à savoir

- **Coût** : Cloudflare Workers gratuit jusqu'à 100 000 requêtes/jour — largement suffisant.
  Groq gratuit (~2 000 dictées/jour pour toute la famille). OpenAI : quelques centimes par jour de voix.
- **Sécurité** : vos clés ne quittent jamais Cloudflare. Seuls ceux qui ont le code famille peuvent utiliser le relais.
  Pour couper l'accès : changer `ACCESS_CODE`, puis repartager le nouveau lien.
- **Facultatif** : variable `ALLOWED_ORIGIN` = `https://hakanhoti22-wq.github.io` pour n'autoriser que votre app.
- **Si une clé est aussi saisie dans les réglages d'un téléphone**, elle est utilisée en priorité sur le relais.
