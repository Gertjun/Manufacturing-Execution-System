#!/bin/sh
# Controleert dat db/schema.sql precies hetzelfde oplevert als migratie 0001 + alle latere migraties.
# Gebruik: tests/test_migraties.sh   (PGHOST, PGPORT, PGUSER zoals voor psql; maakt drie tijdelijke databases)
set -e
cd "$(dirname "$0")/.."
A=batchgui_test_schema; B=batchgui_test_migraties; C=batchgui_test_migratie_afwijking
psql -q -c "DROP DATABASE IF EXISTS $A" -c "DROP DATABASE IF EXISTS $B" -c "DROP DATABASE IF EXISTS $C" -c "CREATE DATABASE $A" -c "CREATE DATABASE $B" 2>/dev/null
psql -q -v ON_ERROR_STOP=1 -d $A -f db/schema.sql >/dev/null 2>&1
for f in db/migraties/*.sql; do
  # De afwijkende historische fixture wordt getest op een kopie van de database vóór 0037.
  if [ "$(basename "$f")" = "0037_lotgrootte_per_product.sql" ]; then
    psql -q -c "CREATE DATABASE $C TEMPLATE $B"
    psql -q -v ON_ERROR_STOP=1 -d $C <<'SQL'
INSERT INTO fabriek.product (code, naam) VALUES ('MIG-AFWIJKING', 'Migratietest afwijking') RETURNING id AS fixture_product_id \gset
INSERT INTO fabriek.lot (lotnummer) VALUES ('L-2026-9997') RETURNING id AS fixture_lot \gset
INSERT INTO fabriek.batch (batchnummer, status, lot_id, product_id)
SELECT 'B-2026-' || lpad((9980 + g)::text, 4, '0'), 'in_lot', :'fixture_lot', :'fixture_product_id'
FROM generate_series(1, 3) g;
SQL
    if psql -q -v ON_ERROR_STOP=1 -d $C -f "$f" >/tmp/batchgui_migratie_0037_afwijking.log 2>&1; then
      echo "FOUT: migratie 0037 accepteerde een historisch lot met 3 batches."
      exit 1
    fi
    grep -q "Migratie 0037 gestopt: een historisch lot bevat niet precies vier batches" /tmp/batchgui_migratie_0037_afwijking.log || {
      cat /tmp/batchgui_migratie_0037_afwijking.log
      echo "FOUT: migratie 0037 stopte om een andere reden dan de historische lotafwijking."
      exit 1
    }
  fi
  psql -q -v ON_ERROR_STOP=1 -d $B -f "$f" >/dev/null || { echo "Migratie $f mislukt"; exit 1; }
  # Vóór 0037: één bestaand lot met exact vier batches.
  if [ "$(basename "$f")" = "0036_routeversies.sql" ]; then
    psql -q -v ON_ERROR_STOP=1 -d $B <<'SQL'
INSERT INTO fabriek.product (code, naam) VALUES ('MIG-TEST', 'Migratietest') RETURNING id AS fixture_product_id \gset
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
historisch=$(psql -At -d $B -c "SELECT batch_aantal_norm || '|' || batch_aantal || '|' || (afwijking_reden IS NULL) || '|' || (route_versie_id IS NULL) || '|' || (route_historie_status = 'historisch_onbekend') FROM fabriek.lot WHERE lotnummer = 'L-2026-9999'")
[ "$historisch" = "4|4|true|true|true" ] || { echo "FOUT: bestaand lot met 4 batches niet correct gemigreerd: $historisch"; exit 1; }
echo "Migratie 0037 legt bestaande vier-batchslots vast en weigert afwijkende historische lots."
psql -q -c "DROP DATABASE $A" -c "DROP DATABASE $B" -c "DROP DATABASE $C"
echo "Schema en migraties gelijk ($va)."
