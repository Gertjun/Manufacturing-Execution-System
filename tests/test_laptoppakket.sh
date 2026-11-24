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
# Werkelijke TCP-authenticatie met beide rollen, zonder geheime waarden te loggen.
node --input-type=commonjs <<'JS' || fout "SCRAM/runtime-rollen"
const fs = require("node:fs");
const { Client } = require("./server/node_modules/pg");
const assert = require("node:assert/strict");
const i = JSON.parse(fs.readFileSync("instellingen.json", "utf8"));
(async () => {
  assert.equal(i.db.user, "mes_app");
  assert.equal(i.beheerDb.user, "postgres");
  assert.ok(i.db.password && i.beheerDb.password && i.db.password !== i.beheerDb.password);
  for (const config of [i.db, i.beheerDb]) {
    const c = new Client(config);
    await c.connect();
    try {
      const {rows:[row]} = await c.query("SELECT current_user AS naam, rolsuper FROM pg_roles WHERE rolname=current_user");
      assert.equal(row.naam, config.user);
      assert.equal(row.rolsuper, config.user === "postgres");
    } finally { await c.end(); }
    const verkeerd = new Client({...config, password:"opzettelijk-verkeerd-testwachtwoord"});
    try { await assert.rejects(verkeerd.connect(), {code:"28P01"}); }
    finally { await verkeerd.end(); }
  }
  const beheer = new Client(i.beheerDb);
  await beheer.connect();
  try {
    const {rows} = await beheer.query("SELECT auth_method,error FROM pg_hba_file_rules WHERE type IS NOT NULL");
    assert.ok(rows.length >= 2);
    assert.ok(rows.every(r => r.auth_method === "scram-sha-256" && !r.error));
    const {rows:[r]} = await beheer.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename='mes_app' AND datname=current_database()");
    assert.ok(r.n > 0, "API heeft een echte mes_app-verbinding");
  } finally { await beheer.end(); }
})().catch(e => { console.error(e.message); process.exitCode=1; });
JS

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
wacht() { for i in $(seq 1 90); do curl -sf localhost:3000/gezondheid >/dev/null && return 0; sleep 1; done; fout "applicatie start niet"; }
login() { curl -s -o /dev/null -w "%{http_code}" -X POST localhost:3000/auth/login -H 'content-type: application/json' -d "{\"gebruikersnaam\":\"$1\",\"wachtwoord\":\"$2\"}"; }

# Lege fabriek: drie afzonderlijke fictieve beheeridentiteiten.
printf 'Testreferentie\nmes.test.system\nwachtwoord123\nwachtwoord123\nmes.test.security.a\nsecurity123a\nsecurity123a\nmes.test.security.b\nsecurity123b\nsecurity123b\n' | node opstarten.mjs --geen-browser --leeg > /tmp/laptoptest.log 2>&1 &
wacht
grep -q "MES-bootstrap voltooid" /tmp/laptoptest.log || fout "geen gecontroleerde bootstrap"
[ "$(login mes.test.system wachtwoord123)" = "200" ] || fout "system administrator kan niet inloggen"
[ "$(login mes.test.security.a security123a)" = "200" ] || fout "security A kan niet inloggen"
[ "$(login mes.test.security.b security123b)" = "200" ] || fout "security B kan niet inloggen"
[ "$(login beheerder1 demo)" = "401" ] || fout "testaccount bestaat nog in de lege fabriek"
stopApp

# Oude noodsleutel is uitsluitend diagnose; credentials blijven gelijk.
printf 'mes.test.system\n' | node opstarten.mjs --geen-browser --beheerder > /tmp/laptoptest.log 2>&1 &
wacht
grep -q "Oude noodsleutel uitgeschakeld" /tmp/laptoptest.log || fout "oude noodsleutel niet geblokkeerd"
[ "$(login mes.test.system wachtwoord123)" = "200" ] || fout "diagnose heeft bestaand wachtwoord gewijzigd"
[ "$(login mes.test.system nieuwwachtwoord)" = "401" ] || fout "diagnose heeft een nieuw wachtwoord ingesteld"
stopApp
pgDraait && fout "database draait nog aan het eind"
echo "Laptoppakket: controles geslaagd (SCRAM, runtime, eerste start, stoppen, back-up, harde stop, terugzetten, bootstrap, hersteldiagnose)."
