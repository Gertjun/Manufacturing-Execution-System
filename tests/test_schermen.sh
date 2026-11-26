#!/bin/sh
# Schermtests in Chrome: invoerscherm en alle portalen (PostgreSQL, D99).
# Gebruik: DATABASE_URL=postgres://postgres@localhost:5432/batchgui TEST_APP_DATABASE_URL=postgres://mes_app@localhost:5432/batchgui tests/test_schermen.sh
# LET OP: de database wordt meerdere keren leeggemaakt en opnieuw gevuld met fictieve gegevens.
# Vooraf nodig: npm ci in api, invoer en portaal; invoer en portaal gebouwd (npm run build);
# Google Chrome in /usr/bin/google-chrome; Python met psycopg.
set -e
set -f  # geen bestandsnamen uitbreiden (de verbindingstekst bevat een ?)
cd "$(dirname "$0")/.."
# Selectie vóór databaseverbinding of destructieve fixturevoorbereiding.
if [ "$#" -gt 1 ]; then echo "Gebruik: $0 [flow|formaten|formaten-uitgebreid|productie|meldingen|beheer|planning|sjabloon|engineering|overgang]" >&2; exit 2; fi
SELECTIE=${1:-}
case "$SELECTIE" in
  ""|flow|formaten|formaten-uitgebreid|productie|meldingen|beheer|planning|sjabloon|engineering|overgang) ;;
  *) echo "Onbekende of nog niet geïsoleerd beoordeelde schermtest: $SELECTIE" >&2; exit 2 ;;
esac
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

# Deze suite gebruikt een exclusieve fictieve testdatabase. Nooit clients beëindigen.
# Controleer ook transacties die nog server-side afronden na procesbeëindiging.
wachtOpDatabaseRust() {
  poging=0
  while [ "$poging" -lt 50 ]; do
    aantal=$($PSQL -At -c "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid()") || return 1
    if [ "$aantal" = 0 ]; then return 0; fi
    poging=$((poging + 1))
    sleep 0.2
  done
  echo "Testdatabase niet vrij na circa 10 seconden: $aantal andere clients; reset geweigerd." >&2
  $PSQL -c "SELECT pid,usename,application_name,state,wait_event_type FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid()" >&2
  return 1
}

leeg() {
  wachtOpDatabaseRust
  $PSQL -c "DROP SCHEMA IF EXISTS fabriek CASCADE" >/dev/null
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
  # Ook bij een mislukte test nooit de volgende fixture starten zolang clients actief zijn.
  wachtOpDatabaseRust
}

# Individuele ontwikkelregressie of gerichte overgang; volledige suite hieronder behoudt alle scripts.
wachtOpDatabaseRust
if [ -n "$SELECTIE" ]; then
  echo "Individuele schermtest: $SELECTIE (geen integraal acceptatiebewijs)"
  case "$SELECTIE" in
    flow) leeg; $PSQL -f db/seed_demo.sql >/dev/null; draai invoer flow.mjs ;;
    formaten) export MES_SCREEN_FORMATS=basis; testdata; draai portaal formaten.mjs ;;
    formaten-uitgebreid) export MES_SCREEN_FORMATS=uitgebreid; testdata; draai portaal formaten.mjs ;;
    productie|meldingen|beheer) testdata; draai portaal "$SELECTIE.mjs" ;;
    planning|sjabloon) draai portaal "$SELECTIE.mjs" ;;
    engineering) leeg; draai portaal engineering.mjs ;;
    overgang) wachtOpDatabaseRust; draai portaal sjabloon.mjs; leeg; draai portaal engineering.mjs ;;
  esac
  if [ "$FOUT" -gt 0 ]; then
    echo "Individuele schermtest mislukt: $SELECTIE" >&2
    exit 1
  fi
  echo "Individuele schermtest geslaagd: $SELECTIE"
  exit 0
fi

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
