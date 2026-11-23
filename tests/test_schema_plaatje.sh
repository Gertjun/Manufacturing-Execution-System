#!/bin/sh
# Controleert dat docs/DATABASE.md (het plaatje van de database, #100, D84) bij is met db/schema.sql.
# Gebruik: tests/test_schema_plaatje.sh   (PGHOST, PGPORT, PGUSER zoals voor psql; maakt een tijdelijke database)
set -e
cd "$(dirname "$0")/.."
NIEUW=$(mktemp)
python3 tools/schema_plaatje.py "host=${PGHOST:-localhost} port=${PGPORT:-5432} user=${PGUSER:-postgres}" "$NIEUW" >/dev/null
if ! diff -u docs/DATABASE.md "$NIEUW" >/dev/null; then
  diff -u docs/DATABASE.md "$NIEUW" | head -40
  rm -f "$NIEUW"
  echo "FOUT: docs/DATABASE.md is niet bij. Maak hem opnieuw: python3 tools/schema_plaatje.py \"host=localhost user=postgres\""
  exit 1
fi
rm -f "$NIEUW"
# Het plaatje moet alle tabellen uit schema.sql noemen.
n=$(grep -c '^CREATE TABLE' db/schema.sql)
m=$(grep -c '^### ' docs/DATABASE.md)
[ "$n" = "$m" ] || { echo "FOUT: schema.sql heeft $n tabellen, het plaatje $m."; exit 1; }
echo "Plaatje van de database is bij ($m tabellen)."
