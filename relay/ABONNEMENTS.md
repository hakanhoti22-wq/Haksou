# Haksou — activer l'essai gratuit et les abonnements

Résultat : toute personne qui ouvre l'app a **7 jours gratuits**, puis choisit
**0,95 CHF / mois** ou **9,95 CHF / an**. Ta famille, invitée par toi, a l'app **gratuite** sans rien configurer.
Tes clés (Groq, ElevenLabs) restent cachées sur ton relais Cloudflare.

> Commence en **mode test** de Stripe (faux paiements), vérifie que tout marche, puis passe en mode réel.

---

## Étape 1 — Stripe (paiements)

1. Crée un compte : **https://dashboard.stripe.com/register**
2. En haut, vérifie que l'interrupteur **Test mode** (ou « Sandbox ») est **activé**.
3. **Product catalog** → **+ Add product** :
   - **Name** : `Haksou`
   - **Pricing** : *Recurring* · **0.95** · **CHF** · **Monthly** → **Add product**
4. Dans la fiche du produit Haksou → **+ Add another price** :
   - *Recurring* · **9.95** · **CHF** · **Yearly** → **Save**
5. Copie l'**identifiant de chaque prix** (il commence par `price_…`, bouton ⋯ → *Copy price ID*) :
   - mensuel → pour `PRICE_MONTHLY`
   - annuel → pour `PRICE_YEARLY`
6. **Developers** → **API keys** → **Secret key** → *Reveal* → copie (`sk_test_…`) → pour `STRIPE_SECRET_KEY`.
7. **Settings** → **Billing** → **Customer portal** → **Activate** (autorise « Cancel subscriptions »).
   C'est la page où les abonnés gèrent ou résilient.

## Étape 2 — Cloudflare (base de données + nouveau relais)

1. **Base de données** : menu de gauche **Storage & Databases** → **KV** → **Create** (ou *Create namespace*) → nom `HAKSOU` → **Add**.
2. **Relier la base au relais** : **Workers & Pages** → **haksou-relais** → **Settings** → **Bindings** → **+ Add** → **KV namespace** :
   - **Variable name** : `HAKSOU`
   - **KV namespace** : `HAKSOU` → **Deploy** (ou *Save*)
3. **Nouveau code du relais** : **Edit code** → tout effacer → coller le contenu de
   https://raw.githubusercontent.com/hakanhoti22-wq/Haksou/claude/ios-translation-app-ipg6h5/relay/worker.js
   → **Deploy**.
4. **Settings** → **Variables and Secrets** → **+ Add** (type **Secret**) :

| Nom | Valeur |
| --- | --- |
| `STRIPE_SECRET_KEY` | `sk_test_…` (étape 1.6) |
| `PRICE_MONTHLY` | `price_…` du prix mensuel |
| `PRICE_YEARLY` | `price_…` du prix annuel |
| `ALLOWED_ORIGIN` | `https://hakanhoti22-wq.github.io` |

   (Garde `ACCESS_CODE`, `GROQ_KEY`, `ELEVENLABS_KEY` déjà présents.) → **Deploy**.

> 🔐 Si tu avais déjà envoyé l'ancien « lien famille » (avec ton code dedans), **change `ACCESS_CODE`** :
> ce code est maintenant ton **code propriétaire** (accès illimité + invitations).

## Étape 3 — Brancher l'app sur ton relais

Envoie-moi l'adresse de ton relais (`https://haksou-relais….workers.dev`) : je l'inscris dans l'app (`config.js`).
Ensuite, n'importe qui ouvrant **https://hakanhoti22-wq.github.io/Haksou/** verra l'écran « 7 jours gratuits ».

## Étape 4 — Ton accès propriétaire et la famille

1. Haksou → **⚙︎** → **Propriétaire** → colle l'adresse du relais + ton **code propriétaire** → « Propriétaire ✓ ».
2. **Inviter un proche (gratuit)** → prénom → envoie le lien (WhatsApp, SMS…).
3. Ton proche ouvre le lien **dans Safari** → « Bienvenue ! Accès familial gratuit activé » → **Partager → Sur l'écran d'accueil**.
4. Pour retirer un accès : **⚙︎** → **Propriétaire** → **Retirer** à côté du prénom.

## Étape 5 — Tester avec de faux paiements

1. Sur un autre téléphone (ou en navigation privée), ouvre l'app → entre un e-mail → essai gratuit.
2. **⚙︎** → **Mon abonnement** → **S'abonner** → choisis une formule → **Continuer**.
3. Carte de test Stripe : **4242 4242 4242 4242** · date future · CVC `123`.
4. Retour dans l'app : « Merci ! Votre abonnement Haksou est actif. 🎉 »

## Étape 6 — Passer en vrais paiements

1. Stripe → **Activate payments** : informations personnelles / entreprise + **IBAN** pour recevoir l'argent.
2. Désactive **Test mode**, puis **refais l'étape 1** (produit, 2 prix, clé `sk_live_…`, portail client) :
   les données de test et réelles sont séparées.
3. Cloudflare : remplace `STRIPE_SECRET_KEY`, `PRICE_MONTHLY`, `PRICE_YEARLY` par les valeurs **live** → **Deploy**.

---

## Bon à savoir

- **Frais Stripe** : environ 2,9 % + 0,30 CHF par paiement → l'annuel te rapporte bien plus que le mensuel.
- **Limite par personne** : 300 requêtes / jour par défaut (variable `DAILY_LIMIT` pour changer).
- **Durée de l'essai** : variable `TRIAL_DAYS` (défaut 7).
- **Code de récupération** (`HK-…`) : chaque abonné le trouve dans **⚙︎ → Mon abonnement** pour retrouver son abonnement sur un autre appareil.
- **Usage commercial** : passe à une offre payante ElevenLabs (l'offre gratuite l'interdit), vérifie les conditions de Groq,
  et prévois des conditions d'utilisation + une politique de confidentialité.
