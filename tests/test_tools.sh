#!/bin/sh
# Test van de beheertools: migreer, backup, herstel (--controle en echt), met een tijdelijke database.
# Gebruik: tests/test_tools.sh   (PGHOST, PGPORT, PGUSER zoals voor psql; PGUSER moet superuser zijn)
set -e
cd "$(dirname "$0")/.."
T=$(mktemp -d); DB=batchgui_test_tools
H="${PGHOST:-localhost}"; P="${PGPORT:-5432}"; U="${PGUSER:-postgres}"
cat > "$T/inst.json" <<JSON
{ "db": {"host":"$H","port":$P,"database":"$DB","user":"batchgui_app","password":""},
  "beheerDb": {"user":"$U","password":"${PGPASSWORD:-}"},
  "backupMap": "$T/backups" }
JSON
export BATCHGUI_INSTELLINGEN="$T/inst.json"
fout() { echo "FOUT: $1"; exit 1; }
psql -q -c "DROP DATABASE IF EXISTS $DB" 2>/dev/null
for d in $(psql -Atc "SELECT datname FROM pg_database WHERE datname LIKE '${DB}_%'"); do psql -q -c "DROP DATABASE \"$d\""; done

node tools/migreer.mjs | grep -q "Nieuwe database aangemaakt op schemaversie" || fout "migreer maakt geen nieuwe database"
node tools/migreer.mjs | grep -q "Niets te doen" || fout "tweede migreer zou niets moeten doen"
psql -q -d $DB -f db/seed_config.sql >/dev/null
python3 tools/genereer_testdata.py "host=$H port=$P user=$U dbname=$DB" --dagen 5 >/dev/null
N=$(psql -Atc "SELECT count(*) FROM fabriek.waarde" -d $DB)

node tools/backup.mjs | grep -q "Back-up gemaakt" || fout "back-up"
ls "$T"/backups/batchgui_*.dump >/dev/null || fout "geen back-upbestand"
node tools/herstel.mjs --controle | grep -q "Hersteltest geslaagd" || fout "hersteltest"
[ -z "$(psql -Atc "SELECT datname FROM pg_database WHERE datname LIKE '${DB}_hersteltest%'")" ] || fout "tijdelijke database niet opgeruimd"

echo kapot > "$T/kapot.dump"
node tools/herstel.mjs "$T/kapot.dump" --ja 2>&1 | grep -q "Er is niets veranderd" || fout "kapot bestand niet geweigerd"

psql -q -d $DB -c "SET session_replication_role = replica; DELETE FROM fabriek.waarde"
B=$(ls "$T"/backups/batchgui_*.dump | head -1)
node tools/herstel.mjs "$B" --ja | grep -q "Herstel gelukt" || fout "herstel"
[ "$(psql -Atc "SELECT count(*) FROM fabriek.waarde" -d $DB)" = "$N" ] || fout "na herstel klopt het aantal waarden niet"
[ -n "$(psql -Atc "SELECT datname FROM pg_database WHERE datname LIKE '${DB}_voor_herstel%'")" ] || fout "oude database niet bewaard"

head -c 3000 "$B" > "$T/half.dump"
node tools/herstel.mjs "$T/half.dump" --ja >/dev/null 2>&1 && fout "half bestand zou moeten mislukken"
[ "$(psql -Atc "SELECT count(*) FROM fabriek.waarde" -d $DB)" = "$N" ] || fout "na mislukt herstel is de oude database niet terug"

L=$(psql -Atc "SELECT string_agg(soort || ':' || gelukt, ' ' ORDER BY id) FROM fabriek.onderhoud_log" -d $DB)
echo "$L" | grep -q "herstel:t" || fout "onderhoudslogboek mist het herstel ($L)"

for d in $(psql -Atc "SELECT datname FROM pg_database WHERE datname LIKE '${DB}%'"); do psql -q -c "DROP DATABASE \"$d\" WITH (FORCE)"; done
rm -rf "$T"
echo "Beheertools: alle controles geslaagd ($N waarden, back-up, hersteltest, herstel, terugval)."
