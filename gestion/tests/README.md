# 🧪 Tests automatiques

À relancer **avant chaque mise en ligne**. En quelques minutes, ils vérifient que rien n'est cassé.

```bash
cd gestion/tests
npm install                       # une seule fois
npx playwright install chromium   # une seule fois
```

| Commande | Ce qui est testé | Résultat attendu |
|---|---|---|
| `npm run demo` | Toute l'appli en **mode démo** dans un vrai navigateur : pointage, congés, planning, factures et notes de crédit, interventions, stock, frais, droits des employés, console du propriétaire, accès support, suspension. Chaque PDF est vérifié. | `✅ 57 vérifications réussies` |
| `PGURL=postgres://postgres@localhost:5432 npm run supabase` | Le **vrai mode Supabase** : vraie base PostgreSQL, vraies règles de sécurité, vraie bibliothèque supabase-js. Trois navigateurs séparés (propriétaire, patron, employé) jouent toute la vie d'un client : création de l'entreprise, inscriptions, pointage **sans réseau**, factures, demande d'aide, accès support, suspension. | `✅ 44 vérifications réussies en mode Supabase` |
| `PSQL="psql -h localhost -U postgres" npm run sql` | Les **règles de sécurité** de `supabase/schema.sql`, une par une. | Seulement des `ERROR` annoncées par un commentaire `-- ERREUR` ou `-- doit échouer` (ce sont les tentatives interdites) |

Les deux derniers tests ont besoin d'un **PostgreSQL local**, mais **d'aucun compte Supabase**. Le dossier `supabase-local/` contient un petit serveur qui imite les API de Supabase utilisées par l'appli. Il sert **uniquement aux tests**, jamais en production.

Pour garder les PDF produits par le test démo : `PDF_DIR=/un/dossier npm run demo`.
