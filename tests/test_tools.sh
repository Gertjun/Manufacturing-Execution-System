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
  "backupMap": "$T/backups", "jwtGeheim": "uitsluitend-fictieve-test-sleutel-1234567890" }
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
# Een echte mislukte herstelcontrole moet ook de tijdelijke database opruimen.
if node tools/herstel.mjs --controle "$T/half.dump" > "$T/half-controle.txt" 2>&1; then
  fout "onvolledige dump slaagt als herstelcontrole"
fi
grep -q "Hersteltest mislukt" "$T/half-controle.txt" || { cat "$T/half-controle.txt"; fout "herstelcontrole meldt verkeerde fout"; }
[ -z "$(psql -Atc "SELECT datname FROM pg_database WHERE datname LIKE '${DB}_hersteltest%'")" ] || fout "tijdelijke database na mislukte controle niet opgeruimd"
[ "$(psql -At -d "$DB" -c "SELECT count(*) FROM fabriek.waarde")" = "$N" ] || fout "actieve database gewijzigd door herstelcontrole"
[ "$(psql -At -d "$DB" -c "SELECT EXISTS (SELECT 1 FROM fabriek.onderhoud_log WHERE soort='hersteltest' AND NOT gelukt AND bestand='half.dump')")" = "t" ] || fout "mislukte herstelcontrole ontbreekt in log"
node tools/herstel.mjs "$T/half.dump" --ja >/dev/null 2>&1 && fout "half bestand zou moeten mislukken"
[ "$(psql -Atc "SELECT count(*) FROM fabriek.waarde" -d $DB)" = "$N" ] || fout "na mislukt herstel is de oude database niet terug"

# D100: een ouder pakket mag een nieuwere database niet wijzigen, ook niet de ACLs.
TOEKOMST=$(psql -At -d "$DB" -c "SELECT max(nummer)+1 FROM fabriek.schema_versie")
psql -q -d "$DB" -c "INSERT INTO fabriek.schema_versie (nummer,naam) VALUES ($TOEKOMST,'fictieve toekomstige migratie'); GRANT SELECT ON fabriek.gebruiker TO mes_app"
# Serverstart weigert het toekomstige schema voordat de API wordt geladen.
if node tools/start-server.mjs > "$T/start-toekomst.txt" 2>&1; then
  fout "server start met onbekend schema"
fi
grep -q "Onbekende schemaversie(s): $TOEKOMST" "$T/start-toekomst.txt" || { cat "$T/start-toekomst.txt"; fout "server weigert toekomstschema niet expliciet"; }
node tools/migreer.mjs > "$T/toekomst.txt" 2>&1 && fout "onbekende schemaversie geaccepteerd"
grep -q "Onbekende schemaversie" "$T/toekomst.txt" || fout "onbekende schemaversie niet expliciet geweigerd"
[ "$(psql -At -d "$DB" -c "SELECT has_table_privilege('mes_app','fabriek.gebruiker','SELECT')")" = "t" ] || fout "rechten gewijzigd op nieuwere database"
[ "$(psql -At -d "$DB" -c "SELECT max(nummer) FROM fabriek.schema_versie")" = "$TOEKOMST" ] || fout "schemaversie gewijzigd"
[ "$(psql -At -d "$DB" -c "SELECT count(*) FROM fabriek.waarde")" = "$N" ] || fout "historie gewijzigd op nieuwere database"
# Maak een dump van de fictieve toekomstige database. Herstel daarna de
# ondersteunde bron en controleer dat de onbekende dump niet actief blijft.
pg_dump -h "$H" -p "$P" -U "$U" -d "$DB" -Fc -f "$T/toekomst.dump"
# Uitsluitend de opzettelijke afwijkingen in deze fictieve test ongedaan maken.
psql -q -d "$DB" -c "REVOKE SELECT ON fabriek.gebruiker FROM mes_app; DELETE FROM fabriek.schema_versie WHERE nummer=$TOEKOMST"
node tools/herstel.mjs "$T/toekomst.dump" --ja > "$T/toekomst-herstel.txt" 2>&1 && fout "onbekende backup geaccepteerd"
grep -q "Onbekende schemaversie in back-up" "$T/toekomst-herstel.txt" || fout "onbekend backupschema niet expliciet geweigerd"
[ "$(psql -At -d "$DB" -c "SELECT max(nummer) FROM fabriek.schema_versie")" = "$((TOEKOMST-1))" ] || fout "actieve schemaversie niet hersteld"
[ "$(psql -At -d "$DB" -c "SELECT has_table_privilege('mes_app','fabriek.gebruiker','SELECT')")" = "f" ] || fout "actieve ACL niet hersteld"
[ "$(psql -At -d "$DB" -c "SELECT count(*) FROM fabriek.waarde")" = "$N" ] || fout "historie gewijzigd bij geweigerd herstel"


# Een gat in de inventaris met onveranderd maximum mag niet starten.
psql -v ON_ERROR_STOP=1 -q -d "$DB" -c "CREATE TABLE public.test_migratiemarkering AS SELECT * FROM fabriek.schema_versie WHERE nummer=36; DELETE FROM fabriek.schema_versie WHERE nummer=36"
if node tools/start-server.mjs > "$T/start-gat.txt" 2>&1; then
  fout "server start met ontbrekende tussenmigratie"
fi
grep -q "Ontbrekende migratie(s): 36;" "$T/start-gat.txt" || { cat "$T/start-gat.txt"; fout "server weigert ontbrekende migratie niet expliciet"; }
psql -v ON_ERROR_STOP=1 -q -d "$DB" -c "INSERT INTO fabriek.schema_versie SELECT * FROM public.test_migratiemarkering; DROP TABLE public.test_migratiemarkering"
[ "$(psql -At -d "$DB" -c "SELECT count(*) FROM fabriek.waarde")" = "$N" ] || fout "servercontrole wijzigde historie"

# Database-update: gebruik een geïsoleerde kopie van de echte migratietool
# met een opzettelijk falende testmigratie. Geen aanpassing aan productiemigraties.
mkdir -p "$T/pakket/tools" "$T/pakket/db/migraties"
cp tools/migreer.mjs tools/lib.mjs "$T/pakket/tools/"
cp db/migraties/*.sql "$T/pakket/db/migraties/"
cp db/rechten.sql "$T/pakket/db/"
cp VERSIE "$T/pakket/"
ln -s "$(pwd)/api" "$T/pakket/api"
TESTNUMMER=$(printf '%04d' "$TOEKOMST")
cat > "$T/pakket/db/migraties/${TESTNUMMER}_test_rollback.sql" <<'SQL'
CREATE TABLE fabriek.test_migratie_rollback (id integer);
INSERT INTO fabriek.test_migratie_rollback VALUES (1);
DO $$ BEGIN RAISE EXCEPTION 'MES_TEST_OPZETTELIJKE_ROLLBACK'; END $$;
SQL
if node "$T/pakket/tools/migreer.mjs" > "$T/migreer.txt" 2>&1; then
  cat "$T/migreer.txt"; fout "opzettelijk falende migratie geaccepteerd"
fi
grep -q "Back-up vóór de database-update" "$T/migreer.txt" || fout "geen back-up vóór de database-update"
grep -q "MES_TEST_OPZETTELIJKE_ROLLBACK" "$T/migreer.txt" || { cat "$T/migreer.txt"; fout "verkeerde oorzaak migratiefout"; }
grep -q "De database staat nog op de vorige versie" "$T/migreer.txt" || fout "mislukte migratie niet gemeld"
ls "$T"/backups/batchgui_*_voor-migratie-"${TESTNUMMER}".dump >/dev/null || fout "geen back-upbestand vóór de migratie"
[ "$(psql -At -d "$DB" -c "SELECT to_regclass('fabriek.test_migratie_rollback') IS NULL")" = "t" ] || fout "DDL niet teruggedraaid"
[ "$(psql -At -d "$DB" -c "SELECT max(nummer) FROM fabriek.schema_versie")" = "$((TOEKOMST-1))" ] || fout "mislukte migratie gemarkeerd"
[ "$(psql -At -d "$DB" -c "SELECT count(*) FROM fabriek.waarde")" = "$N" ] || fout "na de mislukte migratie klopt het aantal waarden niet"
[ "$(psql -At -d "$DB" -c "SELECT EXISTS (SELECT 1 FROM fabriek.onderhoud_log WHERE soort='migratie' AND NOT gelukt AND melding LIKE '%MES_TEST_OPZETTELIJKE_ROLLBACK%')")" = "t" ] || fout "mislukte migratie ontbreekt in onderhoudslogboek"

L=$(psql -Atc "SELECT string_agg(soort || ':' || gelukt, ' ' ORDER BY id) FROM fabriek.onderhoud_log" -d $DB)
echo "$L" | grep -q "herstel:t" || fout "onderhoudslogboek mist het herstel ($L)"

for d in $(psql -Atc "SELECT datname FROM pg_database WHERE datname LIKE '${DB}%'"); do psql -q -c "DROP DATABASE \"$d\" WITH (FORCE)"; done
rm -rf "$T"
echo "Beheertools: alle controles geslaagd ($N waarden, geblokkeerde noodsleutel en hersteldiagnose, back-up, hersteltest, herstel, terugval, back-up vóór database-update, oude inlogpogingen opruimen)."
