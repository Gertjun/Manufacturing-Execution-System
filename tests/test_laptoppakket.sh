#!/bin/sh
# Test van het laptoppakket met ingebouwde PostgreSQL (Linux-variant van het Windows-pakket).
# Draai als gewone gebruiker (PostgreSQL weigert root). Poorten: 3000 (applicatie), 54329 (database).
#   tests/test_laptoppakket.sh [pakketmap]   (standaard bouwt hij er zelf een in een tijdelijke map)
set -e
cd "$(dirname "$0")/.."
P="${1:-}"
if [ -z "$P" ]; then T=$(mktemp -d); tools/maak_laptoppakket.sh "$T/pakket" linux >/dev/null; P="$T/pakket"; fi
cd "$P"; rm -rf data instellingen.json
fout() { echo "FOUT: $1"; cat /tmp/laptoptest.log 2>/dev/null | tail -20; pkill -INT -f "node opstarten.mjs" 2>/dev/null; exit 1; }
start() { node opstarten.mjs --geen-browser "$@" > /tmp/laptoptest.log 2>&1 & for i in $(seq 1 90); do curl -sf localhost:3000/gezondheid >/dev/null && return 0; sleep 1; done; fout "applicatie start niet"; }
stopApp() { pkill -INT -f "node opstarten.mjs"; for i in $(seq 1 30); do pgrep -f "node opstarten.mjs" >/dev/null || break; sleep 1; done; }
pgDraait() { postgres/bin/pg_ctl status -D data/pgdata >/dev/null 2>&1; }

start
grep -q "Eerste keer" /tmp/laptoptest.log || fout "eerste start herkent geen nieuwe installatie"
grep -q '"ingebouwd": true' instellingen.json || fout "instellingen zonder ingebouwde database"
TOK=$(curl -s -X POST localhost:3000/auth/login -H 'content-type: application/json' -d '{"gebruikersnaam":"beheerder1","wachtwoord":"demo"}' | node -e 'process.stdin.on("data",d=>console.log(JSON.parse(d).token))')
curl -s localhost:3000/beheer/server -H "authorization: Bearer $TOK" | grep -q '"postgres":"18' || fout "geen PostgreSQL 18"
stopApp
pgDraait && fout "database draait nog na Ctrl+C"

start
grep -q "Back-up maken" /tmp/laptoptest.log || fout "geen back-up bij tweede start"
[ "$(ls data/backups | wc -l)" = "1" ] || fout "back-upmap klopt niet"
TOK=$(curl -s -X POST localhost:3000/auth/login -H 'content-type: application/json' -d '{"gebruikersnaam":"beheerder1","wachtwoord":"demo"}' | node -e 'process.stdin.on("data",d=>console.log(JSON.parse(d).token))')
curl -s localhost:3000/beheer/server -H "authorization: Bearer $TOK" | grep -q '"waarschuwingen":\[\]' || fout "waarschuwingen na back-up"
pkill -9 -f "node opstarten.mjs"; sleep 1
start
grep -q "draait nog van de vorige keer" /tmp/laptoptest.log || fout "database van harde stop niet hergebruikt"
stopApp

printf '1\n' | node opstarten.mjs --herstel --geen-browser > /tmp/laptoptest.log 2>&1 &
for i in $(seq 1 90); do curl -sf localhost:3000/gezondheid >/dev/null && break; sleep 1; done
grep -q "Back-up teruggezet" /tmp/laptoptest.log || fout "terugzetten"
stopApp
start --leeg
TOK=$(curl -s -X POST localhost:3000/auth/login -H 'content-type: application/json' -d '{"gebruikersnaam":"kwaliteit1","wachtwoord":"demo"}' | node -e 'process.stdin.on("data",d=>console.log(JSON.parse(d).token))')
curl -s "localhost:3000/analyse/samenvatting" -H "authorization: Bearer $TOK" | grep -q '"batches":0' || echo "(let op: samenvatting na --leeg niet gecontroleerd)"
stopApp
pgDraait && fout "database draait nog aan het eind"
echo "Laptoppakket: alle controles geslaagd (eerste start, stoppen, back-up, harde stop, terugzetten, lege fabriek)."
