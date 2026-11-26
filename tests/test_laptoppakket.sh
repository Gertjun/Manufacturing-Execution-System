#!/bin/sh
# Test van het laptoppakket met ingebouwde PostgreSQL (Linux-variant van het Windows-pakket).
# Draai als gewone gebruiker (PostgreSQL weigert root). Poorten: 3000 (applicatie), 54329 (database).
#   tests/test_laptoppakket.sh [pakketmap]   (standaard bouwt hij er zelf een in een tijdelijke map)
set -e
cd "$(dirname "$0")/.."
P="${1:-}"
if [ -z "$P" ]; then T=$(mktemp -d); tools/maak_laptoppakket.sh "$T/pakket" linux; P="$T/pakket"; fi
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

# D103: alle actuele fictieve identiteiten kunnen inloggen; de historische
# accounts blijven alleen als inactieve referenties in de fictieve dataset.
node --input-type=commonjs <<'JS' || fout "MES-demoaccounts en historische identiteiten"
const fs = require("node:fs");
const {Client}=require("./server/node_modules/pg");
const assert=require("node:assert/strict");
const names=["mes.operator","mes.supervisor","mes.manager","mes.planner","mes.engineer","mes.eng.approver","mes.quality","mes.quality.approver","mes.maintenance","mes.system","mes.security.a","mes.security.b","mes.analyst","mes.display"];
(async()=>{
  const i=JSON.parse(fs.readFileSync("instellingen.json","utf8"));
  const c=new Client(i.beheerDb);
  await c.connect();
  try {
    const {rows}=await c.query("SELECT gebruikersnaam FROM fabriek.gebruiker WHERE actief ORDER BY gebruikersnaam");
    assert.deepEqual(rows.map(r=>r.gebruikersnaam), [...names].sort());
    const {rows:[g]}=await c.query("SELECT count(*)::int AS n FROM fabriek.authorization_grant WHERE revoked_at IS NULL");
    assert.equal(g.n,15);
    const {rows:[v]}=await c.query("SELECT count(*)::int AS n FROM fabriek.operator o JOIN fabriek.gebruiker g ON g.id=o.gebruiker_id WHERE g.actief");
    assert.equal(v.n,4);
  } finally {await c.end();}
  for(const gebruikersnaam of names){
    const r=await fetch("http://localhost:3000/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({gebruikersnaam,wachtwoord:"demo"})});
    assert.equal(r.status,200,gebruikersnaam);
  }
  for(const gebruikersnaam of ["operator","operator.a","beheerder1","mes.laptop.system"]){
    const r=await fetch("http://localhost:3000/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({gebruikersnaam,wachtwoord:"demo"})});
    assert.equal(r.status,401,gebruikersnaam);
  }
  const r=await fetch("http://localhost:3000/auth/omgeving");
  assert.equal(r.status,200);
  const o=await r.json();
  assert.equal(o.test,true);
  assert.deepEqual(o.testaccounts.map(x=>x.naam).sort(),[...names].sort());
})().catch(e=>{console.error(e.message);process.exitCode=1;});
JS

TOK=$(curl -fsS -X POST localhost:3000/auth/login -H 'content-type: application/json' -d '{"gebruikersnaam":"mes.system","wachtwoord":"demo"}' | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const t=JSON.parse(s).token;if(!t)process.exit(1);console.log(t)})') || fout "technische MES-testlogin mislukt"
curl -fsS localhost:3000/beheer/server -H "authorization: Bearer $TOK" | grep -q '"postgres":"18' || fout "serverinformatie niet beschikbaar voor technische MES-testidentiteit of verkeerde PostgreSQL-versie"
stopApp
pgDraait && fout "database draait nog na Ctrl+C"

# Simuleer de oude pakketconfiguratie op een kopie van de fictieve database:
# authenticatie en instellingen zijn legacy; schema blijft 0086.
# Leg vóór en na de omzetting alle batch-ID's en nummers vast.
oudeInstellingen() {
  node --input-type=commonjs <<'JS'
const fs=require("node:fs");
const i=JSON.parse(fs.readFileSync("instellingen.json","utf8"));
i.db={...i.db,user:"postgres",password:""};
delete i.beheerDb;
fs.writeFileSync("instellingen.json",JSON.stringify(i,null,2),{mode:0o600});
JS
  printf 'local all all trust\nhost all all 127.0.0.1/32 trust\nhost all all ::1/128 trust\n' > data/pgdata/pg_hba.conf
}
batchBewijs() {
  node --input-type=commonjs <<'JS'
const fs=require("node:fs");
const {Client}=require("./server/node_modules/pg");
const i=JSON.parse(fs.readFileSync("instellingen.json","utf8"));
(async()=>{
  const c=new Client(i.beheerDb ?? i.db);
  await c.connect();
  try {
    const {rows:[r]}=await c.query("SELECT count(*)::int AS n, md5(string_agg(id::text,',' ORDER BY id)) AS bewijs FROM fabriek.batch");
    if(!r.n) throw Error("Geen historische fictieve batches");
    console.log(JSON.stringify(r));
  } finally {await c.end();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
JS
}
# Start uitsluitend de testdatabase in oude configuratie om het referentiebewijs
# te meten; geen API starten met de oude verbinding.
oudeInstellingen
postgres/bin/pg_ctl start -D data/pgdata -l /tmp/laptop-legacy-pg.log -w -o "-p 54329" >/dev/null
VOOR=$(batchBewijs) || fout "historisch referentiebewijs"
postgres/bin/pg_ctl stop -D data/pgdata -m fast -w >/dev/null
start
NA=$(batchBewijs) || fout "historisch bewijs na omzetting"
[ "$VOOR" = "$NA" ] || fout "batchhistorie gewijzigd bij upgrade"
! grep -Eq '^[[:space:]]*[^#].*[[:space:]]trust([[:space:]]|$)' data/pgdata/pg_hba.conf || fout "trust na upgrade"
stopApp
# De automatisch gemaakte pre-upgradeback-up bevat nog trust. Herstel die
# en controleer dat de omzetting opnieuw plaatsvindt zonder batchverlies.
printf '1\n' | node opstarten.mjs --herstel --geen-browser > /tmp/laptoptest.log 2>&1 &
for i in $(seq 1 90); do curl -sf localhost:3000/gezondheid >/dev/null && break; sleep 1; done
curl -sf localhost:3000/gezondheid >/dev/null || fout "legacy-back-up start niet"
[ "$(batchBewijs)" = "$VOOR" ] || fout "batchhistorie gewijzigd bij legacy-herstel"
! grep -Eq '^[[:space:]]*[^#].*[[:space:]]trust([[:space:]]|$)' data/pgdata/pg_hba.conf || fout "trust na herstel"
stopApp
# Begin de bestaande back-uprotatieproef met een lege lijst van uitsluitend
# fictieve testback-ups; de actuele database blijft behouden.
rm -rf data/backups

start
grep -q "Back-up maken" /tmp/laptoptest.log || fout "geen back-up bij tweede start"
[ "$(ls data/backups | wc -l)" = "1" ] || fout "back-upmap klopt niet"
TOK=$(curl -fsS -X POST localhost:3000/auth/login -H 'content-type: application/json' -d '{"gebruikersnaam":"mes.system","wachtwoord":"demo"}' | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const t=JSON.parse(s).token;if(!t)process.exit(1);console.log(t)})') || fout "technische MES-testlogin mislukt"
curl -fsS localhost:3000/beheer/server -H "authorization: Bearer $TOK" | grep -q '"waarschuwingen":\[\]' || fout "waarschuwingen na back-up"
pkill -9 -f "node opstarten.mjs"; sleep 1
start
grep -q "draait nog van de vorige keer" /tmp/laptoptest.log || fout "database van harde stop niet hergebruikt"
stopApp

printf '1\n' | node opstarten.mjs --herstel --geen-browser > /tmp/laptoptest.log 2>&1 &
for i in $(seq 1 90); do curl -sf localhost:3000/gezondheid >/dev/null && break; sleep 1; done
curl -sf localhost:3000/gezondheid >/dev/null || fout "beveiligde back-up start niet"
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
