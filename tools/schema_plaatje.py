#!/usr/bin/env python3
"""Maakt docs/DATABASE.md: een plaatje van de tabellen en hun verbanden, uit db/schema.sql (#100, D84).

De opbouw komt uit een tijdelijke database waarin schema.sql wordt geladen (zo tellen ook latere
ALTER TABLE-regels mee); de uitleg per tabel uit het commentaar (-- ...) direct boven CREATE TABLE.
Gebruik:  python3 tools/schema_plaatje.py "host=localhost user=postgres" [uitvoerbestand]
Zonder uitvoerbestand: docs/DATABASE.md. tests/test_schema_plaatje.sh controleert dat het bestand bij is.
"""
import pathlib
import re
import subprocess
import sys

import psycopg

ROOT = pathlib.Path(__file__).resolve().parent.parent
SCHEMA = ROOT / "db" / "schema.sql"
TIJDELIJK = "batchgui_schema_plaatje"


def uitleg_per_tabel(tekst: str) -> dict[str, str]:
    """Het commentaarblok direct boven elke CREATE TABLE, als één zin."""
    regels = tekst.splitlines()
    uit: dict[str, str] = {}
    for i, r in enumerate(regels):
        m = re.match(r"^CREATE TABLE (\w+) \(", r)
        if not m:
            continue
        blok: list[str] = []
        j = i - 1
        while j >= 0 and regels[j].startswith("--"):
            blok.insert(0, regels[j].lstrip("-").strip())
            j -= 1
        # Scheidingslijnen (----) tellen niet mee; houd het kort: tot de eerste punt, hoogstens 160 tekens.
        zin = re.sub(r"\s+", " ", " ".join(x for x in blok if x and not set(x) <= {"-"})).replace("|", "/").strip()
        eerste = re.match(r"^(.*?\.)(\s|$)", zin)
        zin = eerste.group(1) if eerste and len(eerste.group(1)) >= 20 else zin
        uit[m.group(1)] = zin if len(zin) <= 160 else zin[:157].rsplit(" ", 1)[0] + "…"
    return uit


KORT = {"timestamp with time zone": "timestamptz", "timestamp without time zone": "timestamp", "integer": "int",
        "boolean": "bool", "character varying": "varchar", "time without time zone": "time", "double precision": "float"}


def kort_type(t: str) -> str:
    return KORT.get(t.removesuffix("[]"), t.removesuffix("[]")) + ("[]" if t.endswith("[]") else "")


def main() -> None:
    verbinding = sys.argv[1] if len(sys.argv) > 1 else "host=localhost user=postgres"
    uitvoer = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "docs" / "DATABASE.md"
    with psycopg.connect(verbinding, dbname="postgres", autocommit=True) as c:
        c.execute(f"DROP DATABASE IF EXISTS {TIJDELIJK}")
        c.execute(f"CREATE DATABASE {TIJDELIJK}")
    try:
        params = psycopg.conninfo.conninfo_to_dict(verbinding)
        params["dbname"] = TIJDELIJK
        url = psycopg.conninfo.make_conninfo(**params)
        subprocess.run(["psql", "-q", "-v", "ON_ERROR_STOP=1", "-d", url, "-f", str(SCHEMA)],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        with psycopg.connect(url) as c:
            tabellen = [r[0] for r in c.execute(
                "SELECT relname FROM pg_class WHERE relnamespace = 'fabriek'::regnamespace AND relkind = 'r' ORDER BY relname")]
            kolommen = c.execute("""
                SELECT c.relname, a.attname, format_type(a.atttypid, NULL) AS type, a.attnotnull,
                       EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype = 'p' AND a.attnum = ANY (k.conkey)) AS pk,
                       EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype = 'f' AND a.attnum = ANY (k.conkey)) AS fk,
                       EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype = 'u' AND k.conkey = ARRAY[a.attnum]) AS uk
                  FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid
                 WHERE c.relnamespace = 'fabriek'::regnamespace AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
                 ORDER BY c.relname, a.attnum""").fetchall()
            verbanden = c.execute("""
                SELECT c.relname AS kind, p.relname AS ouder,
                       string_agg(a.attname, ', ' ORDER BY a.attnum) AS kolommen,
                       bool_and(a.attnotnull) AS verplicht,
                       EXISTS (SELECT 1 FROM pg_constraint u WHERE u.conrelid = c.oid AND u.contype IN ('u', 'p') AND u.conkey = k.conkey) AS uniek
                  FROM pg_constraint k
                  JOIN pg_class c ON c.oid = k.conrelid JOIN pg_class p ON p.oid = k.confrelid
                  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY (k.conkey)
                 WHERE k.contype = 'f' AND c.relnamespace = 'fabriek'::regnamespace
                 GROUP BY c.relname, p.relname, k.conkey, c.oid, k.conname
                 ORDER BY p.relname, c.relname, k.conname""").fetchall()
    finally:
        with psycopg.connect(verbinding, dbname="postgres", autocommit=True) as c:
            c.execute(f"DROP DATABASE IF EXISTS {TIJDELIJK}")

    uitleg = uitleg_per_tabel(SCHEMA.read_text(encoding="utf-8"))
    per_tabel: dict[str, list[tuple]] = {t: [] for t in tabellen}
    for rel, kol, typ, _, pk, fk, uk in kolommen:
        per_tabel[rel].append((kol, typ, pk, fk, uk))

    # Wie iets deed (gebruiker, operator, pc) staat in bijna elke tabel; die lijnen maken het plaatje onleesbaar.
    wie = {"gebruiker", "operator", "pc"}
    lijnen = [v for v in verbanden if v[1] not in wie or v[0] in wie]
    r = ["# Database – tabellen en verbanden", "",
         "> **Dit bestand:** een plaatje van de database, **automatisch gemaakt** uit `db/schema.sql` met",
         "> `tools/schema_plaatje.py` (#100, D84). Niet met de hand wijzigen: `tests/test_schema_plaatje.sh` faalt als het niet bij is.",
         "> Opnieuw maken: `python3 tools/schema_plaatje.py \"host=localhost user=postgres\"`.",
         "> **Niet hier:** de regels in de database en waarom → `db/schema.sql` en [`DECISIONS.md`](../DECISIONS.md).", "",
         f"Schema `fabriek`: {len(tabellen)} tabellen en {len(verbanden)} verbanden.", "",
         "## Overzicht", "",
         "Een lijn loopt van de tabel waarnaar verwezen wordt naar de tabel met de verwijzing, met de kolom erbij. "
         "`||` = altijd ingevuld, `|o` = mag leeg zijn, `o{` = nul of meer, `o|` = hoogstens één. "
         "Niet getekend, wel in de lijst hieronder: verwijzingen naar `gebruiker`, `operator` en `pc` (wie iets deed of waar).", "",
         "```mermaid", "erDiagram"]
    r += [f"    {t}" for t in tabellen]
    for kind, ouder, kols, verplicht, uniek in lijnen:
        links = "||" if verplicht else "|o"
        rechts = "o|" if uniek else "o{"
        r.append(f'    {ouder} {links}--{rechts} {kind} : "{kols}"')
    r += ["```", "", "## Tabellen", "", "| Tabel | Kolommen | Verwijst naar | Uitleg (uit `schema.sql`) |", "| --- | ---: | --- | --- |"]
    for t in tabellen:
        naar = sorted({o for k, o, *_ in verbanden if k == t and o != t})
        r.append(f"| [`{t}`](#{t}) | {len(per_tabel[t])} | {', '.join(f'`{x}`' for x in naar)} | {uitleg.get(t, '')} |")
    r += ["", "## Kolommen per tabel", "", "PK = sleutel, FK = verwijst naar een andere tabel, UK = uniek. Zonder \"leeg\" is de kolom altijd ingevuld.", ""]
    verwijzing = {}
    for kind, ouder, kols, *_ in verbanden:
        for k in kols.split(", "):
            verwijzing[(kind, k)] = ouder
    for t in tabellen:
        r += [f"### {t}", "", "| Kolom | Type | | Verwijst naar |", "| --- | --- | --- | --- |"]
        for kol, typ, pk, fk, uk in per_tabel[t]:
            leeg = next(x for x in kolommen if x[0] == t and x[1] == kol)[3] is False
            sleutels = " ".join(x for x, ja in (("PK", pk), ("FK", fk), ("UK", uk), ("leeg", leeg and not pk)) if ja)
            r.append(f"| `{kol}` | {kort_type(typ)} | {sleutels} | {f'`{verwijzing[(t, kol)]}`' if (t, kol) in verwijzing else ''} |")
        r.append("")
    uitvoer.write_text("\n".join(r).rstrip("\n") + "\n", encoding="utf-8")
    print(f"{uitvoer.relative_to(ROOT) if uitvoer.is_relative_to(ROOT) else uitvoer}: {len(tabellen)} tabellen, {len(verbanden)} verbanden")


if __name__ == "__main__":
    main()
