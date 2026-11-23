#!/bin/sh
# Controleert dat db/schema.sql precies hetzelfde oplevert als migratie 0001 + alle latere migraties.
# Gebruik: tests/test_migraties.sh   (PGHOST, PGPORT, PGUSER zoals voor psql; maakt twee tijdelijke databases)
set -e
cd "$(dirname "$0")/.."
A=batchgui_test_schema; B=batchgui_test_migraties
psql -q -c "DROP DATABASE IF EXISTS $A" -c "DROP DATABASE IF EXISTS $B" -c "CREATE DATABASE $A" -c "CREATE DATABASE $B" 2>/dev/null
psql -q -v ON_ERROR_STOP=1 -d $A -f db/schema.sql >/dev/null 2>&1
for f in db/migraties/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -d $B -f "$f" >/dev/null || { echo "Migratie $f mislukt"; exit 1; }
  # Vóór 0037: synthetische lots met 3 en 4 batches, om de historische backfill te testen.
  if [ "$(basename "$f")" = "0036_routeversies.sql" ]; then
    psql -q -v ON_ERROR_STOP=1 -d $B <<'SQL'
INSERT INTO fabriek.product (code, naam) VALUES ('MIG-TEST', 'Migratietest') RETURNING id AS fixture_product_id \gset
INSERT INTO fabriek.lot (lotnummer) VALUES ('L-2026-9998') RETURNING id AS fixture_lot_3 \gset
INSERT INTO fabriek.batch (batchnummer, status, lot_id, product_id)
SELECT 'B-2026-' || lpad((9990 + g)::text, 4, '0'), 'in_lot', :'fixture_lot_3', :'fixture_product_id'
FROM generate_series(1, 3) g;
INSERT INTO fabriek.lot (lotnummer) VALUES ('L-2026-9999') RETURNING id AS fixture_lot_4 \gset
INSERT INTO fabriek.batch (batchnummer, status, lot_id, product_id)
SELECT 'B-2026-' || lpad((9993 + g)::text, 4, '0'), 'in_lot', :'fixture_lot_4', :'fixture_product_id'
FROM generate_series(1, 4) g;
SQL
  fi
done
# Migraties zetten zelf geen regels in schema_versie (dat doet migreer.mjs); zet ze hier zoals migreer.mjs.
for f in db/migraties/*.sql; do n=$(basename "$f" | cut -c1-4); naam=$(basename "$f" .sql | cut -c6-); psql -q -d $B -c "INSERT INTO fabriek.schema_versie (nummer, naam) VALUES ($(echo $n | sed "s/^0*//"), '$naam') ON CONFLICT DO NOTHING"; done
# Alleen de opbouw vergelijken: commentaar, psql-opdrachten, lege regels en interne volgnummers
# die nieuwere pg_dump-versies per kolom meeschrijven (pg_attver) tellen niet mee.
schema() { pg_dump -d "$1" --schema-only --no-owner --no-privileges -n fabriek | grep -v '^--' | grep -v '^\\' | grep -v '^$' | grep -v 'pg_attver='; }
schema $A > /tmp/$A.sql; schema $B > /tmp/$B.sql
if ! diff -u /tmp/$A.sql /tmp/$B.sql; then echo "FOUT: schema.sql en de migraties lopen uiteen."; exit 1; fi
va=$(psql -Atc "SELECT string_agg(nummer || ' ' || naam, ', ' ORDER BY nummer) FROM fabriek.schema_versie" -d $A)
vb=$(psql -Atc "SELECT string_agg(nummer || ' ' || naam, ', ' ORDER BY nummer) FROM fabriek.schema_versie" -d $B)
[ "$va" = "$vb" ] || { echo "FOUT: schema_versie in schema.sql ($va) wijkt af van de migraties ($vb)."; exit 1; }
historisch=$(psql -At -d $B -c "SELECT batch_aantal_norm || '|' || batch_aantal || '|' || (length(afwijking_reden) >= 3) || '|' || (route_versie_id IS NULL) || '|' || (route_historie_status = 'historisch_onbekend') FROM fabriek.lot WHERE lotnummer = 'L-2026-9998'")
[ "$historisch" = "4|3|t|t|t" ] || { echo "FOUT: bestaand lot met 3 batches niet veilig gemigreerd: $historisch"; exit 1; }
exact=$(psql -At -d $B -c "SELECT batch_aantal_norm || '|' || batch_aantal || '|' || (afwijking_reden IS NULL) FROM fabriek.lot WHERE lotnummer = 'L-2026-9999'")
[ "$exact" = "4|4|t" ] || { echo "FOUT: bestaand lot met 4 batches niet correct gemigreerd: $exact"; exit 1; }
echo "Migratie 0037 behoudt bestaande lot-samenstelling (3 en 4 batches) en laat onbekende historische routes ongemoeid."
psql -q -c "DROP DATABASE $A" -c "DROP DATABASE $B"
echo "Schema en migraties gelijk ($va)."
