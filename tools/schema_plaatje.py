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


# Expliciete semantische indeling D114; onbekende tabellen vereisen bewuste classificatie.
DIAGRAM_KLASSEN = {
    "structuur": set("activity_qualification authorization_permission authorization_role authorization_role_permission capaciteit_stap gebruiker grondstof instelling master_recipe master_recipe_version material_class material_definition material_definition_version measurement_unit operator pc pc_stap ploeg processtap product product_stap qualification quantity_dimension quantity_kind recipe_compatibility_rule recipe_dependency recipe_equipment_requirement recipe_formula recipe_instruction recipe_lot_rule recipe_material_requirement recipe_parameter recipe_parameter_limit recipe_personnel_requirement recipe_procedural_element recipe_scaling_binding recipe_scaling_expression recipe_scaling_input recipe_scaling_rule recipe_specification_link rooster rooster_ploeg specificatie specificatie_regel stap_grondstof stilstand_oorzaak unit_conversion unit_conversion_version veld veld_product".split()),
    "uitvoering": set("authorization_decision authorization_grant authorization_personnel_link authorization_request authorization_revocation batch batch_besluit capaciteit_afwijking certificaat execution_session geweigerde_invoer grondstof_gebruik herbewerking invoerconflict keuring lot lot_voorstel lot_voorstel_batch melding melding_gelezen overdracht personnel_qualification qualification_issue qualification_revocation recipe_change_impact recipe_change_request recipe_release recipe_release_withdrawal recipe_review_decision recipe_review_round stapplanning stapregistratie stilstand terugmelding waarde".split()),
    "ondersteuning": set("authorization_bootstrap authorization_channel_identity authorization_channel_identity_revocation authorization_legacy_snapshot authorization_recovery config_log inlogpoging onderhoud_log schema_versie".split()),
}
DIAGRAM_INIT = '%%{init: {"theme":"base","themeVariables":{"lineColor":"#6B7785","primaryTextColor":"#1B2430","fontFamily":"Arial, sans-serif"}}}%%'
DIAGRAM_LEGENDA = "Legenda B+: structuur (blauw), uitvoering en besluiten (oranje), technische ondersteuning (grijs). Alle relaties zijn fysieke FK-verwijzingen, geen procespijlen. Kleur is aanvullend; de tabelnamen en relatiekolommen blijven bepalend."


def diagram_stijl(tabellen):
    toegewezen = set().union(*DIAGRAM_KLASSEN.values())
    if toegewezen != set(tabellen) or sum(map(len, DIAGRAM_KLASSEN.values())) != len(tabellen):
        raise ValueError(f"ERD-classificatie ontbreekt of is verouderd: {sorted(toegewezen ^ set(tabellen))}")
    return [
        "    classDef structuur fill:#E7EEF6,stroke:#0B2E59,color:#0B2E59",
        "    classDef uitvoering fill:#FDEBD9,stroke:#B45309,color:#1B2430",
        "    classDef ondersteuning fill:#F4F7F9,stroke:#6B7785,color:#1B2430",
        *[f"    class {','.join(sorted(namen))} {klasse}" for klasse, namen in DIAGRAM_KLASSEN.items()],
    ]


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
            schema_versie = c.execute("SELECT max(nummer) FROM fabriek.schema_versie").fetchone()[0]
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

    r = ["# Database – tabellen en verbanden", "",
         "> **Dit bestand:** een plaatje van de database, **automatisch gemaakt** uit `db/schema.sql` met",
         "> `tools/schema_plaatje.py` (#100, D84). Niet met de hand wijzigen: `tests/test_schema_plaatje.sh` faalt als het niet bij is.",
         "> Opnieuw maken: `python3 tools/schema_plaatje.py \"host=localhost user=postgres\"`.",
         "> **Niet hier:** de regels in de database en waarom → `db/schema.sql` en [`DECISIONS.md`](../DECISIONS.md).",
         f"> **Momentopname schema {schema_versie:04d}:** tijdens conceptontwikkeling kan het actuele SQL-schema voorlopen; bij faseacceptatie en release wordt dit overzicht geverifieerd.", "",
         f"Schema `fabriek`: {len(tabellen)} tabellen en {len(verbanden)} verbanden.", "",
         "## Overzicht", "",
         "Een lijn loopt van de tabel waarnaar verwezen wordt naar de tabel met de verwijzing, met de kolom erbij. "
         "`||` = altijd ingevuld, `|o` = mag leeg zijn, `o{` = nul of meer, `o|` = hoogstens één. "
         "De Mermaid-bron hieronder bevat alle foreign keys, inclusief verwijzingen naar `gebruiker`, `operator` en `pc`.", "",
         DIAGRAM_LEGENDA, "",
         "[Open het fysieke overzicht met alle tabellen](diagrams/rendered/physical-erd.svg). Het overzicht laat de meeste "
         "verwijzingen naar gebruikers, operators en werkstations weg voor de leesbaarheid.", "",
         "## Fysieke domeindiagrammen", "",
         "De zes diagrammen tonen samen alle foreign keys. Elke relatie staat bij de tabel die de foreign key bevat. "
         "Gestippelde lijnen en blokken markeren een verwijzing naar een tabel in een ander domein. "
         "Open een SVG op volledig formaat om de labels te lezen.", "",
         "- [Autorisaties en identiteit](diagrams/rendered/physical-identity.svg)",
         "- [Master Data en Recipe Management](diagrams/rendered/physical-master-data.svg)",
         "- [Productie-uitvoering](diagrams/rendered/physical-execution.svg)",
         "- [Planning en lotvorming](diagrams/rendered/physical-planning.svg)",
         "- [Kwaliteit en metingen](diagrams/rendered/physical-quality.svg)",
         "- [Technische ondersteuning](diagrams/rendered/physical-support.svg)", "",
         "<details>", "<summary>Mermaid-bron met alle foreign keys</summary>", "",
         "```mermaid", DIAGRAM_INIT, "erDiagram"]
    r += [f"    {t}" for t in tabellen]
    for kind, ouder, kols, verplicht, uniek in verbanden:
        links = "||" if verplicht else "|o"
        rechts = "o|" if uniek else "o{"
        r.append(f'    {ouder} {links}--{rechts} {kind} : "{kols}"')
    r += diagram_stijl(tabellen)
    r += ["```", "", "</details>", "", "## Tabellen", "", "| Tabel | Kolommen | Verwijst naar | Uitleg (uit `schema.sql`) |", "| --- | ---: | --- | --- |"]
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
