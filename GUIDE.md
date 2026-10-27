# Haksou — Guide complet

## 🔗 Tous les liens

| À quoi ça sert | Lien |
| --- | --- |
| **L'app Haksou** | https://hakanhoti22-wq.github.io/Haksou/ |
| Clé Groq (micro fiable, gratuit) | https://console.groq.com/keys |
| Relais familial (Cloudflare) | https://dash.cloudflare.com |
| Code du relais à copier | https://raw.githubusercontent.com/hakanhoti22-wq/Haksou/claude/ios-translation-app-ipg6h5/relay/worker.js |
| Clé OpenAI (voix naturelle, payant, quelques centimes/jour) | https://platform.openai.com/api-keys |
| Clé ElevenLabs (voix la plus humaine) | https://elevenlabs.io/app/settings/api-keys |
| Stripe (paiements) | https://dashboard.stripe.com |
| Réglages GitHub Pages (mise en ligne) | https://github.com/hakanhoti22-wq/Haksou/settings/pages |
| Mot de passe GitHub oublié | https://github.com/password_reset |

---

## 1. Installer l'app sur ton iPhone

1. Ouvre **https://hakanhoti22-wq.github.io/Haksou/** dans **Safari**.
2. Bouton **Partager** (carré avec flèche) → **Sur l'écran d'accueil** → **Ajouter**.
3. Au premier micro : **Autoriser**.

**Mise à jour de l'app** : ferme Haksou (balayer vers le haut), attends 2 minutes, rouvre.

---

## 2. Micro fiable (obligatoire sur iPhone)

Sans ça, le micro de l'iPhone se bloque après la 1ʳᵉ phrase (bug d'Apple).

1. **https://console.groq.com/keys** → connexion → **Create API Key** → nom `Haksou` → **Submit** → **Copy**.
2. Haksou → **⚙︎** → **Micro fiable (Whisper)** → bouton **Coller**.
3. L'étiquette affiche **Activé**.

> Si le relais familial est connecté (étape 3), inutile : l'étiquette affiche « Via le relais ».

---

## 3. Relais familial (pour que ta famille n'ait aucune clé)

### a) Créer le relais — dash.cloudflare.com (en anglais)
1. Compte gratuit sur **https://dash.cloudflare.com**.
2. **Workers & Pages** → **Create** → **Start with Hello World!** (⚠️ pas « Upload »).
3. Nom `haksou-relais` → **Deploy** → **Edit code**.
4. Ouvre le **lien « Code du relais »** ci-dessus → tout sélectionner → **Copier**.
5. Dans l'éditeur Cloudflare : tout effacer → coller → **Deploy**.

### b) Ajouter les secrets
1. Flèche ← pour quitter l'éditeur → onglet **Settings** → **Variables and Secrets** → **+ Add**.
2. Ajoute (type **Secret**, noms exactement en majuscules) :
   - `ACCESS_CODE` → ton code famille (ex. `soleil-2026`)
   - `GROQ_KEY` → ta clé `gsk_…`
   - `OPENAI_KEY` → ta clé `sk-…` *(facultatif, voix naturelle)*
3. **Deploy**.

### c) Trouver l'adresse du relais
**haksou-relais** → bouton **Visit ↗** (ou **Settings → Domains & Routes → workers.dev**).
La page doit afficher : **« Relais Haksou opérationnel. »** → copie l'adresse.

### d) Relier Haksou
1. Haksou → **⚙︎** → **Relais familial**.
2. Champ 1 → **Coller** l'adresse du relais.
3. Champ 2 → tape le code famille.
4. Message **« Relais familial connecté »** ✓

---

## 4. Partager avec la famille

1. Haksou → **⚙︎** → **Partager le lien famille** → WhatsApp / SMS.
2. Chez eux :
   - ouvrir le lien **dans Safari** (« Ouvrir dans Safari » depuis WhatsApp) ;
   - message **« Relais familial connecté »** ;
   - **Partager → Sur l'écran d'accueil**.

**Test avant de partir** : mode **Conversation**, Français ⇄ Espagnol, dire 2–3 phrases d'affilée.

---

## 5. Voix plus humaine (facultatif)

- **Avec clé** : Haksou → **⚙︎** → **Voix naturelle (IA)** → **Coller** la clé OpenAI ou ElevenLabs → **Féminin / Masculin** → **Écouter la voix**.
  *(Ou mets `OPENAI_KEY` sur le relais : toute la famille en profite.)*
- **Gratuit** : Réglages de l'iPhone → rechercher **« Voix »** → **Lire et énoncer › Voix** → **Espagnol** → télécharger **Mónica (Premium)** (le nuage ☁︎). Pareil pour le Français.

---

## 6. Abonnements et invitations famille

Guide complet : **relay/ABONNEMENTS.md** (Stripe, base de données Cloudflare, tests, passage en vrais paiements).

- Public : **7 jours gratuits**, puis **0,95 CHF / mois** ou **9,95 CHF / an**.
- Famille : **⚙︎ → Propriétaire → Inviter un proche (gratuit)** → envoyer le lien → rien à configurer chez eux.
- Retirer un proche : **⚙︎ → Propriétaire → Retirer**.

---

## 7. En cas de problème

| Message | Solution |
| --- | --- |
| « Code famille incorrect » | Le code dans Haksou doit être identique à `ACCESS_CODE` (majuscules, espaces). |
| « Relais injoignable » | Vérifie l'adresse collée (commence par `https://`). |
| « Je n'ai rien entendu » / micro bloqué | Active le micro fiable (étape 2) ou le relais (étape 3). |
| « Accès au micro refusé » | Réglages iPhone → Safari → Micro → Autoriser. |
| « Limite atteinte » | Attendre 1 minute (limite gratuite Groq : ~2 000 dictées/jour). |
| Rien ne change après une mise à jour | Fermer complètement l'app, attendre 2 min, rouvrir. |

**Couper l'accès à la famille** : changer `ACCESS_CODE` sur Cloudflare, puis repartager le lien.
