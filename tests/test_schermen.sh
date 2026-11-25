#!/bin/sh
# Schermtests in Chrome: invoerscherm en alle portalen (PostgreSQL, D99).
# Gebruik: DATABASE_URL=postgres://postgres@localhost:5432/batchgui tests/test_schermen.sh
# LET OP: de database wordt meerdere keren leeggemaakt en opnieuw gevuld met fictieve gegevens.
# Vooraf nodig: npm ci in api, invoer en portaal; invoer en portaal gebouwd (npm run build);
# Google Chrome in /usr/bin/google-chrome; Python met psycopg.
set -e
set -f  # geen bestandsnamen uitbreiden (de verbindingstekst bevat een ?)
cd "$(dirname "$0")/.."
: "${DATABASE_URL:=postgres://postgres@localhost/batchgui?host=/tmp&port=5433}"
export DATABASE_URL
PSQL="psql -q -v ON_ERROR_STOP=1 -d $DATABASE_URL"
FOUT=0

leeg() {
  $PSQL -c "DROP SCHEMA IF EXISTS fabriek CASCADE" >/dev/null 2>&1
  $PSQL -f db/schema.sql >/dev/null 2>&1
  $PSQL -f db/rechten.sql >/dev/null 2>&1 || true
  $PSQL -f db/seed_config.sql >/dev/null
  $PSQL -f db/seed_accounts_demo.sql >/dev/null
}
testdata() {
  leeg
  python3 tools/genereer_testdata.py "$DATABASE_URL" >/dev/null
}
draai() { # map, script
  echo "== $1/e2e/$2"
  if (cd "$1" && node "e2e/$2") > "/tmp/schermtest-$2.log" 2>&1; then
    tail -1 "/tmp/schermtest-$2.log"
  else
    cat "/tmp/schermtest-$2.log"
    FOUT=$((FOUT + 1))
  fi
}

# Invoerscherm: kleine fictieve productie.
leeg
$PSQL -f db/seed_demo.sql >/dev/null
draai invoer flow.mjs

# Portalen op maanden testdata. Deze tests veranderen de gegevens; in deze volgorde passen ze bij elkaar.
testdata
for t in formaten portaal productie wandscherm grondstoffen meldingen certificaat regelkaarten excel hulp nalevering specificaties; do
  draai portaal "$t.mjs"
done
# Beheer en planning zetten zelf hun database klaar.
draai portaal beheer.mjs
draai portaal planning.mjs
draai portaal sjabloon.mjs

# De historische browserdemo valt buiten de verplichte acceptatie (D99).

if [ "$FOUT" -gt 0 ]; then
  echo "Schermtests: $FOUT test(s) mislukt (zie /tmp/schermtest-*.log)."
  exit 1
fi
echo "Schermtests: alles geslaagd."
