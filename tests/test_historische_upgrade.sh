#!/bin/sh
# D100/D101: werkelijk gevulde database van vóór MES-fase 1 upgraden.
# Alleen fictieve gegevens, geïsoleerde tijdelijke database en historisch vastgelegde bron.
set -eu
cd "$(dirname "$0")/.."
T=$(mktemp -d)
DB="batchgui_upgrade_$$"
H="${PGHOST:-localhost}"; P="${PGPORT:-5432}"; U="${PGUSER:-postgres}"
cleanup() {
  psql -q -d postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" >/dev/null 2>&1 || :
  rm -rf "$T"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
fout() { echo "FOUT historische upgrade: $1"; exit 1; }
# Werkelijke main-basis vóór fase 1, niet een teruggedraaide actuele database.
OUD=31c86973bf13848cba44fc38785084953fe65e39
git archive "$OUD" db/schema.sql db/seed_config.sql db/seed_accounts_demo.sql tools/genereer_testdata.py | tar -x -C "$T"
export PGHOST="$H" PGPORT="$P" PGUSER="$U" PGOPTIONS="-c timezone=UTC"
psql -v ON_ERROR_STOP=1 -q -d postgres -c "CREATE DATABASE $DB"
for f in schema seed_config seed_accounts_demo; do
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$T/db/$f.sql" >/dev/null
done
sql() { psql -v ON_ERROR_STOP=1 -At -d "$DB" -c "$1"; }
[ "$(sql 'SELECT max(nummer) FROM fabriek.schema_versie')" = 35 ] || fout "historische basis is niet 0035"
python3 "$T/tools/genereer_testdata.py" "host=$H port=$P user=$U dbname=$DB" --dagen 10 --seed 42 > "$T/generator.log" 2>&1 || { cat "$T/generator.log"; fout "historische generator"; }

# Hash alle bestaande kolommen en rijen per geselecteerde tabel, in vaste volgorde.
# Nieuwe kolommen mogen ontstaan; historische waarden, inclusief ID's en relaties,
# mogen niet veranderen. Geen hashes van wachtwoorden of individuele rijen in logs.
TABELLEN="gebruiker operator batch lot stapregistratie waarde grondstof_gebruik batch_besluit keuring herbewerking"
for t in $TABELLEN; do
  cols=$(sql "SELECT string_agg(quote_ident(attname),',' ORDER BY attnum) FROM pg_attribute WHERE attrelid='fabriek.$t'::regclass AND attnum>0 AND NOT attisdropped")
  [ -n "$cols" ] || fout "ontbrekende historische kolommen: $t"
  printf '%s\n' "$cols" > "$T/$t.cols"
  sql "SELECT count(*) || ':' || md5(coalesce(string_agg(to_jsonb(s)::text,E'\\n' ORDER BY id),'')) FROM (SELECT $cols FROM fabriek.$t) s" > "$T/$t.voor"
done
for t in gebruiker operator batch lot stapregistratie waarde grondstof_gebruik; do
  [ "$(sql "SELECT count(*) FROM fabriek.$t")" -gt 0 ] || fout "lege historische fixture: $t"
done
# De oude installatie had ruimere rechten; simuleer een expliciete historische ACL.
sql "GRANT SELECT ON fabriek.gebruiker TO mes_app" >/dev/null
cat > "$T/inst.json" <<JSON
{ "db":{"host":"$H","port":$P,"database":"$DB","user":"mes_app","password":""},
  "beheerDb":{"user":"$U","password":"${PGPASSWORD:-}"},"backupMap":"$T/backups" }
JSON
node tools/migreer.mjs --instellingen "$T/inst.json" > "$T/upgrade.log" 2>&1 || { tail -80 "$T/upgrade.log"; fout "migratie vanaf 0035"; }
LAATSTE=$(find db/migraties -name '[0-9][0-9][0-9][0-9]_*.sql' | sort | tail -1 | sed 's|.*/||;s/_.*//;s/^0*//')
[ "$(sql 'SELECT max(nummer) FROM fabriek.schema_versie')" = "$LAATSTE" ] || fout "actueel schema niet bereikt"
[ "$(sql 'SELECT count(*) FROM fabriek.schema_versie')" = "$LAATSTE" ] || fout "ontbrekende migratiemarkeringen"
ls "$T"/backups/*_voor-migratie-0036.dump >/dev/null || fout "geen pre-upgradebackup"
for t in $TABELLEN; do
  cols=$(cat "$T/$t.cols")
  sql "SELECT count(*) || ':' || md5(coalesce(string_agg(to_jsonb(s)::text,E'\\n' ORDER BY id),'')) FROM (SELECT $cols FROM fabriek.$t) s" > "$T/$t.na"
  cmp -s "$T/$t.voor" "$T/$t.na" || fout "historische inhoud gewijzigd: $t"
done
[ "$(sql 'SELECT count(*) FROM fabriek.authorization_grant')" = 0 ] || fout "automatische MES-grant"
[ "$(sql 'SELECT count(*) FROM fabriek.authorization_legacy_snapshot')" = "$(sql 'SELECT count(*) FROM fabriek.gebruiker')" ] || fout "legacy-identiteiten ontbreken in snapshot"
[ "$(sql 'SELECT count(*) FROM fabriek.gebruiker g LEFT JOIN fabriek.authorization_legacy_snapshot s ON s.user_id=g.id WHERE s.user_id IS NULL OR s.legacy_role IS DISTINCT FROM g.rol')" = 0 ] || fout "legacy-identiteit of rol gewijzigd"
[ "$(sql "SELECT has_column_privilege('mes_app','fabriek.gebruiker','wachtwoord_hash','SELECT')")" = f ] || fout "oude hashleestoegang behouden"
[ "$(sql "SELECT has_column_privilege('mes_app','fabriek.gebruiker','gebruikersnaam','SELECT')")" = t ] || fout "normale leesinterface ontbreekt"
[ "$(sql "SELECT count(*) FROM fabriek.gebruiker g CROSS JOIN fabriek.authorization_permission p WHERE fabriek.authorization_permits(g.id,p.code,NULL,NULL,NULL)")" = 0 ] || fout "legacy-rol verleent MES-permission"
echo "Historische upgrade 0035 -> $LAATSTE geslaagd: tien historische tabellen, legacy-snapshot, geen automatische grants, beperkte ACL en pre-upgradebackup."
