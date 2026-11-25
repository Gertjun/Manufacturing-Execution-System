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

# 0094: uitsluitend na bewijs dat de migratie zelf geen grants heeft gegeven.
# Drie aparte fictieve wachtwoorden: de oude demoaccounts delen wachtwoord demo.
psql -v ON_ERROR_STOP=1 -q -d "$DB" <<'SQL'
SET search_path=fabriek,public;
INSERT INTO gebruiker(gebruikersnaam,rol,wachtwoord_hash) VALUES
 ('overgang.system','pending',wachtwoord_hash('fictief-system-94')),
 ('overgang.a','pending',wachtwoord_hash('fictief-security-a-94')),
 ('overgang.b','pending',wachtwoord_hash('fictief-security-b-94'));
CREATE TEMP TABLE overgang_voor AS SELECT id,session_version FROM gebruiker;
DO $$
DECLARE s uuid; a uuid; b uuid; gedeeld_id uuid; status text;
BEGIN
 SELECT id INTO STRICT s FROM gebruiker WHERE gebruikersnaam='overgang.system';
 SELECT id INTO STRICT a FROM gebruiker WHERE gebruikersnaam='overgang.a';
 SELECT id INTO STRICT b FROM gebruiker WHERE gebruikersnaam='overgang.b';
 SELECT id INTO STRICT gedeeld_id FROM gebruiker WHERE gedeeld LIMIT 1;
 IF has_function_privilege('mes_app','fabriek.authorization_bootstrap_existing(uuid,text,uuid,text,uuid,text,text)','EXECUTE') THEN
   RAISE EXCEPTION 'Runtime kan eerste rechten toekennen';
 END IF;
 BEGIN
   PERFORM authorization_bootstrap_existing(s,'fictief-system-94',a,'fictief-security-a-94',a,'fictief-security-b-94','test');
   RAISE EXCEPTION 'TEST_ONVERWACHT_SUCCES';
 EXCEPTION WHEN raise_exception THEN
   IF SQLERRM NOT LIKE 'Drie afzonderlijke persoonlijke%' THEN RAISE; END IF;
 END;
 BEGIN
   PERFORM authorization_bootstrap_existing(gedeeld_id,'demo',a,'fictief-security-a-94',b,'fictief-security-b-94','test');
   RAISE EXCEPTION 'TEST_ONVERWACHT_SUCCES';
 EXCEPTION WHEN raise_exception THEN
   IF SQLERRM NOT LIKE 'Ongeschikte persoonlijke%' THEN RAISE; END IF;
 END;
 status := authorization_bootstrap_existing(s,'fout',a,'fictief-security-a-94',b,'fictief-security-b-94','test');
 IF status IS DISTINCT FROM 'denied' OR EXISTS(SELECT 1 FROM authorization_grant) OR EXISTS(SELECT 1 FROM authorization_bootstrap) THEN
   RAISE EXCEPTION 'Verkeerde bevestiging gaf rechten of onjuiste status';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM inlogpoging WHERE gebruikersnaam='overgang.system' AND uitkomst='mislukt') THEN
   RAISE EXCEPTION 'Mislukte bevestiging niet geregistreerd';
 END IF;
 status := authorization_bootstrap_existing(s,'fictief-system-94',a,'fictief-security-a-94',b,'fictief-security-b-94','fictieve goedkeuringsreferentie');
 IF status IS DISTINCT FROM 'initialized' OR (SELECT count(*) FROM authorization_grant)<>3
    OR NOT authorization_permits(s,'system.read',NULL,NULL,NULL)
    OR NOT authorization_permits(a,'authorization.request',NULL,NULL,NULL)
    OR NOT authorization_permits(b,'authorization.approve',NULL,NULL,NULL)
    OR authorization_permits(s,'authorization.approve',NULL,NULL,NULL)
    OR authorization_permits(a,'system.read',NULL,NULL,NULL) THEN
   RAISE EXCEPTION 'Onjuiste eerste grants';
 END IF;
 IF EXISTS(SELECT 1 FROM gebruiker g JOIN overgang_voor v USING(id)
   WHERE g.session_version <> v.session_version + CASE WHEN g.id IN(s,a,b) THEN 1 ELSE 0 END) THEN
   RAISE EXCEPTION 'Onjuiste sessie-intrekking';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM authorization_bootstrap WHERE system_user_id=s AND security_user_a=a AND security_user_b=b AND reason LIKE '%fictieve goedkeuringsreferentie') THEN
   RAISE EXCEPTION 'Bootstrap-audit ontbreekt';
 END IF;
 BEGIN
   PERFORM authorization_bootstrap_existing(s,'fictief-system-94',a,'fictief-security-a-94',b,'fictief-security-b-94','test');
   RAISE EXCEPTION 'TEST_ONVERWACHT_SUCCES';
 EXCEPTION WHEN raise_exception THEN
   IF SQLERRM NOT LIKE 'Overgang uitsluitend%' THEN RAISE; END IF;
 END;
END $$;
SQL
echo "Eenmalige overgang 0094: negatieve bevestigingen, functiescheiding, drie grants, sessie-intrekking en herhaling geslaagd."
