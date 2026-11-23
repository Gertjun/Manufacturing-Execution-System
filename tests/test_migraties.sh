#!/bin/sh
# Controleert dat db/schema.sql precies hetzelfde oplevert als migratie 0001 + alle latere migraties.
# Gebruik: tests/test_migraties.sh   (PGHOST, PGPORT, PGUSER zoals voor psql; maakt twee tijdelijke databases)
set -e
cd "$(dirname "$0")/.."
A=batchgui_test_schema; B=batchgui_test_migraties
psql -q -c "DROP DATABASE IF EXISTS $A" -c "DROP DATABASE IF EXISTS $B" -c "CREATE DATABASE $A" -c "CREATE DATABASE $B" 2>/dev/null
psql -q -v ON_ERROR_STOP=1 -d $A -f db/schema.sql >/dev/null 2>&1
for f in db/migraties/*.sql; do psql -q -v ON_ERROR_STOP=1 -d $B -f "$f" >/dev/null || { echo "Migratie $f mislukt"; exit 1; }; done
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
psql -q -c "DROP DATABASE $A" -c "DROP DATABASE $B"
echo "Schema en migraties gelijk ($va)."
