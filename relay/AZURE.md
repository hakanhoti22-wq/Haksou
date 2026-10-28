# Voix naturelle gratuite avec Microsoft Azure

Azure offre **500 000 caractères de voix naturelle par mois, gratuitement** (offre « Free F0 »),
dans plus de 140 langues. Quand le quota du mois est atteint, Azure **ne facture rien** : Haksou passe
simplement à la voix de secours (ElevenLabs si sa clé est encore dans le relais, sinon la voix de l'iPhone).

L'interface d'Azure est en anglais : les noms des boutons sont écrits tels quels ci-dessous.

---

## 1. Créer le compte Azure (une seule fois)

1. Ouvrez **https://azure.microsoft.com/free** → **Start free** (ou **Try Azure for free**).
2. Connectez-vous avec un compte Microsoft (Outlook, Hotmail…) ou créez-en un.
3. Remplissez le formulaire. Azure demande une **carte bancaire uniquement pour vérifier votre identité** :
   l'offre F0 ne la débite jamais.

> Si, après 30 jours, Azure vous propose de passer en « Pay-as-you-go », vous pouvez accepter :
> la voix F0 reste gratuite et plafonnée. Pour être tranquille, ajoutez une alerte de budget à 1 CHF
> (Cost Management → Budgets).

## 2. Créer le service de voix

1. Allez sur **https://portal.azure.com**.
2. En haut, dans la barre de recherche, tapez **Speech services** et ouvrez-le.
3. Cliquez **+ Create**.
4. Remplissez :
   - **Subscription** : celle proposée.
   - **Resource group** : **Create new** → `haksou` → OK.
   - **Region** : **West Europe** (ou Switzerland North).
   - **Name** : `haksou-voix` (ou un autre nom libre).
   - **Pricing tier** : **Free F0** ← important.
5. **Review + create** → **Create**. Attendez « Your deployment is complete » → **Go to resource**.

## 3. Copier la clé et la région

Dans le service, menu de gauche : **Resource Management → Keys and Endpoint**.

- **KEY 1** → copiez-la (icône de copie à droite).
- **Location/Region** → notez-la, par ex. `westeurope` (en minuscules, sans espace).

## 4. Les ajouter au relais Cloudflare

1. **https://dash.cloudflare.com** → **Workers & Pages** → votre relais `haksou`.
2. **Settings** → **Variables and Secrets** → **+ Add** :
   - Type **Secret**, nom `AZURE_SPEECH_KEY`, valeur : la KEY 1.
   - **+ Add** encore : Type **Text**, nom `AZURE_SPEECH_REGION`, valeur : `westeurope` (votre région).
3. **Deploy**.

## 5. Mettre à jour le code du relais

1. Dans votre relais : bouton **</> Edit code** (en haut à droite).
2. Effacez tout le code, collez le nouveau `relay/worker.js`, puis **Deploy**.

## 6. Vérifier

Ouvrez `https://haksou.hakan-hoti-22.workers.dev/status` : vous devez voir
`"tts":"azure"` et `"ttsBackup":"elevenlabs"`.

Dans Haksou, touchez **Écouter** sur une traduction : c'est la voix Azure.

---

### Rester 100 % gratuit

- Gardez `ELEVENLABS_KEY` dans le relais : ElevenLabs ne sert qu'en secours, quand Azure est épuisé pour le mois.
- Supprimez `ELEVENLABS_KEY` : plus aucun crédit consommé. Haksou utilise alors la voix de l'iPhone en secours.
- Pour revenir à ElevenLabs en voix principale : ajoutez la variable `TTS_PROVIDER` = `elevenlabs`.
