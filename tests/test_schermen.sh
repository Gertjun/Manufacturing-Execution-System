#!/bin/sh
# Schermtests in Chrome: invoerscherm en alle portalen (PostgreSQL, D99).
# Gebruik: DATABASE_URL=postgres://postgres@localhost:5432/batchgui TEST_APP_DATABASE_URL=postgres://mes_app@localhost:5432/batchgui tests/test_schermen.sh
# LET OP: de database wordt meerdere keren leeggemaakt en opnieuw gevuld met fictieve gegevens.
# Vooraf nodig: npm ci in api, invoer en portaal; invoer en portaal gebouwd (npm run build);
# Google Chrome in /usr/bin/google-chrome; Python met psycopg.
set -e
set -f  # geen bestandsnamen uitbreiden (de verbindingstekst bevat een ?)
cd "$(dirname "$0")/.."
: "${DATABASE_URL:=postgres://postgres@localhost/batchgui?host=/tmp&port=5433}"
export DATABASE_URL
: "${TEST_APP_DATABASE_URL:?Stel TEST_APP_DATABASE_URL in op de beperkte mes_app-testverbinding}"
export TEST_APP_DATABASE_URL
if [ "$DATABASE_URL" = "$TEST_APP_DATABASE_URL" ]; then
  echo "Testvoorbereiding en applicatie moeten afzonderlijke databaseverbindingen hebben." >&2
  exit 1
fi
PSQL="psql -q -v ON_ERROR_STOP=1 -d $DATABASE_URL"
FOUT=0

leeg() {
  $PSQL -c "DROP SCHEMA IF EXISTS fabriek CASCADE" >/dev/null 2>&1
  $PSQL -f db/schema.sql >/dev/null
  $PSQL -f db/rechten.sql >/dev/null
  $PSQL -f db/seed_config.sql >/dev/null
  $PSQL -f db/seed_accounts_demo.sql >/dev/null
  $PSQL -f tests/fixtures/scherm_grants.sql >/dev/null
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
# Beheer gebruikt de voorgaande fictieve dataset; planning en sjabloon initialiseren zelf.
draai portaal beheer.mjs
draai portaal planning.mjs
draai portaal sjabloon.mjs

# Process Engineering gebruikt een eigen schone fictieve dataset.
leeg
draai portaal engineering.mjs

# De historische browserdemo valt buiten de verplichte acceptatie (D99).

if [ "$FOUT" -gt 0 ]; then
  echo "Schermtests: $FOUT test(s) mislukt (zie /tmp/schermtest-*.log)."
  exit 1
fi
echo "Schermtests: alles geslaagd."
