#!/usr/bin/env bash
# Vérifie les règles de sécurité de supabase/schema.sql sur un PostgreSQL local (aucun compte Supabase nécessaire).
# Usage :  PSQL="psql -h localhost -U postgres" ./gestion/tests/sql/run.sh
# Les lignes « ERROR » attendues sont annoncées par un commentaire « -- ERREUR » ou « -- doit échouer » dans les tests.
set -euo pipefail
cd "$(dirname "$0")"
PSQL=${PSQL:-psql}
for t in 1-isolation-et-droits.sql 2-factures-et-pointages.sql 3-proprietaire-et-support.sql; do
  db="haksou_test_$$"
  echo "════ $t"
  $PSQL -X -q -d postgres -c "create database $db"
  $PSQL -X -q -d "$db" -f 0-simulation-supabase.sql
  $PSQL -X -q -d "$db" -v ON_ERROR_STOP=1 -f ../../supabase/schema.sql 2>&1 | grep -v NOTICE || true
  $PSQL -X -q -d "$db" -f "$t" 2>&1 | grep -v '^CONTEXT' || true
  $PSQL -X -q -d postgres -c "drop database $db"
done
