#!/bin/sh
# Test van de beheertools: migreer, backup, herstel (--controle en echt), met een tijdelijke database.
# Gebruik: tests/test_tools.sh   (PGHOST, PGPORT, PGUSER zoals voor psql; PGUSER moet superuser zijn)
set -e
cd "$(dirname "$0")/.."
T=$(mktemp -d); DB=batchgui_test_tools
H="${PGHOST:-localhost}"; P="${PGPORT:-5432}"; U="${PGUSER:-postgres}"
cat > "$T/inst.json" <<JSON
{ "db": {"host":"$H","port":$P,"database":"$DB","user":"mes_app","password":""},
  "beheerDb": {"user":"$U","password":"${PGPASSWORD:-}"},
  "backupMap": "$T/backups" }
JSON
export BATCHGUI_INSTELLINGEN="$T/inst.json"
fout() { echo "FOUT: $1"; exit 1; }
psql -q -c "DROP DATABASE IF EXISTS $DB" 2>/dev/null
for d in $(psql -Atc "SELECT datname FROM pg_database WHERE datname LIKE '${DB}_%'"); do psql -q -c "DROP DATABASE \"$d\""; done

node tools/migreer.mjs | grep -q "Nieuwe database aangemaakt op schemaversie" || fout "migreer maakt geen nieuwe database"
node tools/migreer.mjs | grep -q "Niets te doen" || fout "tweede migreer zou niets moeten doen"
psql -q -d $DB -f db/seed_config.sql >/dev/null && psql -q -d $DB -f db/seed_accounts_demo.sql >/dev/null
python3 tools/genereer_testdata.py "host=$H port=$P user=$U dbname=$DB" --dagen 5 >/dev/null
N=$(psql -Atc "SELECT count(*) FROM fabriek.waarde" -d $DB)

# D101: oude noodsleutel is uitgeschakeld; diagnose mag niets wijzigen.
# Vergelijk gevoelige account- en autorisatiestatus alleen binnen SQL; geen hashes in logs.
psql -q -d "$DB" -c "CREATE TABLE public.test_recovery_accounts AS SELECT * FROM fabriek.gebruiker; CREATE TABLE public.test_recovery_grants AS SELECT * FROM fabriek.authorization_grant; CREATE TABLE public.test_recovery_records AS SELECT * FROM fabriek.authorization_recovery"
printf '%s\n' beheerder1 nieuwwachtwoord nieuwwachtwoord | node tools/beheerder.mjs > "$T/diagnose.txt" || fout "hersteldiagnose mislukt"
grep -q "Oude noodsleutel uitgeschakeld" "$T/diagnose.txt" || fout "oude noodsleutel niet expliciet geblokkeerd"
grep -q "Er is niets gewijzigd" "$T/diagnose.txt" || fout "diagnose niet afgerond"
for pair in "gebruiker test_recovery_accounts" "authorization_grant test_recovery_grants" "authorization_recovery test_recovery_records"; do
  set -- $pair
  [ "$(psql -At -d "$DB" -c "SELECT count(*) FROM ((SELECT * FROM fabriek.$1 EXCEPT ALL SELECT * FROM public.$2) UNION ALL (SELECT * FROM public.$2 EXCEPT ALL SELECT * FROM fabriek.$1)) d")" = "0" ] || fout "diagnose wijzigde $1"
done
psql -q -d "$DB" -c "DROP TABLE public.test_recovery_accounts, public.test_recovery_grants, public.test_recovery_records"

psql -q -d $DB -c "INSERT INTO fabriek.inlogpoging (gebruikersnaam, uitkomst, op) VALUES ('oud', 'mislukt', now() - interval '100 days'), ('recent', 'mislukt', now() - interval '10 days')"
node tools/backup.mjs | grep -q "Back-up gemaakt.*1 oude inlogpogingen opgeruimd" || fout "back-up (met opruimen van oude inlogpogingen)"
[ "$(psql -Atc "SELECT string_agg(gebruikersnaam, ',') FROM fabriek.inlogpoging" -d $DB)" = "recent" ] || fout "oude inlogpoging niet opgeruimd of recente weg"
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

# Database-update: eerst een back-up. Doe alsof de laatste migratie nog open staat; die mislukt dan
# (de onderdelen bestaan al), maar de back-up ervoor moet er zijn en de database blijft ongewijzigd.
LAATSTE=$(psql -Atc "SELECT max(nummer) FROM fabriek.schema_versie" -d $DB)
psql -q -d $DB -c "DELETE FROM fabriek.schema_versie WHERE nummer = $LAATSTE"
node tools/migreer.mjs > "$T/migreer.txt" 2>&1 && fout "dubbele migratie zou moeten mislukken"
grep -q "Back-up vóór de database-update" "$T/migreer.txt" || fout "geen back-up vóór de database-update"
ls "$T"/backups/batchgui_*_voor-migratie-*.dump >/dev/null || fout "geen back-upbestand vóór de migratie"
grep -q "De database staat nog op de vorige versie" "$T/migreer.txt" || fout "mislukte migratie niet gemeld"
psql -q -d $DB -c "INSERT INTO fabriek.schema_versie (nummer, naam) SELECT $LAATSTE, 'terug'"
[ "$(psql -Atc "SELECT count(*) FROM fabriek.waarde" -d $DB)" = "$N" ] || fout "na de mislukte migratie klopt het aantal waarden niet"

L=$(psql -Atc "SELECT string_agg(soort || ':' || gelukt, ' ' ORDER BY id) FROM fabriek.onderhoud_log" -d $DB)
echo "$L" | grep -q "herstel:t" || fout "onderhoudslogboek mist het herstel ($L)"

for d in $(psql -Atc "SELECT datname FROM pg_database WHERE datname LIKE '${DB}%'"); do psql -q -c "DROP DATABASE \"$d\" WITH (FORCE)"; done
rm -rf "$T"
echo "Beheertools: alle controles geslaagd ($N waarden, geblokkeerde noodsleutel en hersteldiagnose, back-up, hersteltest, herstel, terugval, back-up vóór database-update, oude inlogpogingen opruimen)."
