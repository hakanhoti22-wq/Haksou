# 🧪 Tests automatiques

Relance-les après chaque modification : en une minute, ils vérifient que rien n'est cassé.

## 1. L'appli dans un vrai navigateur (`e2e.js`)

Le test joue un scénario complet en mode démo : pointage et corrections, congés, planning, devis → facture → note de crédit, intervention avec photo et signature, stock, notes de frais, droits des employés. Il vérifie aussi que chaque **PDF** produit est un vrai fichier PDF.

```bash
npm install --no-save playwright
npx playwright install chromium
node gestion/tests/e2e.js
```

Résultat attendu : `✅ 39 vérifications réussies, aucune erreur JavaScript.`
Pour garder les PDF produits : `PDF_DIR=/un/dossier node gestion/tests/e2e.js`.

## 2. Les règles de sécurité de la base (`sql/`)

Ces tests rejouent `supabase/schema.sql` sur un PostgreSQL ordinaire, avec une petite simulation de Supabase. Ils n'ont **besoin d'aucun compte Supabase**. Ils vérifient :
- qu'une entreprise ne voit jamais les données d'une autre ;
- qu'un employé ne peut ni valider ses propres congés ou frais, ni modifier le planning ;
- qu'une facture émise ne peut être ni modifiée ni supprimée, et que la numérotation n'a pas de trous ;
- qu'une note de crédit annule la facture, et que chaque correction de pointage est journalisée avec son motif.

```bash
PSQL="psql -h localhost -U postgres" ./gestion/tests/sql/run.sh
```

Les lignes `ERROR` qui s'affichent sont **voulues** : ce sont les tentatives interdites, chacune annoncée par un commentaire `-- ERREUR` ou `-- doit échouer` dans le fichier de test.
