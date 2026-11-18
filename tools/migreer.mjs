// Database aanmaken of bijwerken naar de nieuwste versie (beheerder).
//
//   node tools/migreer.mjs              aanmaken als hij niet bestaat, anders openstaande migraties uitvoeren
//   node tools/migreer.mjs --status     alleen tonen welke migraties zijn uitgevoerd en welke nog open staan
//   --instellingen <pad>                ander instellingenbestand dan instellingen.json
//
// Een nieuwe, lege database krijgt db/schema.sql (altijd het nieuwste schema) en daarna worden
// alle migraties als uitgevoerd gemarkeerd. Een bestaande database krijgt alleen de migraties
// uit db/migraties/ die nog niet in fabriek.schema_versie staan, elk in een eigen transactie.
// Een database van vóór versie 0.6.0 (zonder schema_versie) staat op migratie 0001.
// Na afloop worden de rechten uit db/rechten.sql opnieuw toegepast.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { argumenten, leesInstellingen, logOnderhoud, pg, ROOT, sqlBestand, stop, verbind, VERSIE } from "./lib.mjs";

const { opties } = argumenten();
const inst = leesInstellingen(opties);
const DB = inst.beheerDb;

export function migraties() {
  return readdirSync(join(ROOT, "db", "migraties"))
    .map((f) => /^(\d{4})_(.+)\.sql$/.exec(f))
    .filter(Boolean)
    .map((m) => ({ nummer: Number(m[1]), naam: m[2], bestand: join(ROOT, "db", "migraties", m[0]) }))
    .sort((a, b) => a.nummer - b.nummer);
}

async function databaseBestaat() {
  const c = await verbind(DB, "postgres");
  const { rowCount } = await c.query("SELECT 1 FROM pg_database WHERE datname = $1", [DB.database]);
  if (!rowCount && !opties.status) {
    console.log(`Database ${DB.database} bestaat niet; wordt aangemaakt.`);
    await c.query(`CREATE DATABASE ${pg.escapeIdentifier(DB.database)} ENCODING 'UTF8' TEMPLATE template0`);
  }
  await c.end();
  return rowCount > 0;
}

async function uitgevoerd(c) {
  const { rows: s } = await c.query("SELECT to_regclass('fabriek.schema_versie') AS t, to_regclass('fabriek.batch') AS b");
  if (!s[0].b) return null; // leeg
  if (!s[0].t) return new Set([1]); // van vóór 0.6.0
  const { rows } = await c.query("SELECT nummer FROM fabriek.schema_versie");
  return new Set(rows.map((r) => r.nummer));
}

async function markeer(c, lijst) {
  for (const m of lijst) {
    await c.query("INSERT INTO fabriek.schema_versie (nummer, naam) VALUES ($1, $2) ON CONFLICT (nummer) DO NOTHING", [m.nummer, m.naam]);
  }
}

const alle = migraties();
const bestond = await databaseBestaat();
if (!bestond && opties.status) stop(`Database ${DB.database} bestaat (nog) niet.`, 0);

const c = await verbind(DB);
const gedaan = await uitgevoerd(c);
const start = new Date();

if (opties.status) {
  console.log(`Database ${DB.database}, applicatieversie ${VERSIE}`);
  for (const m of alle) console.log(`  ${gedaan?.has(m.nummer) ? "uitgevoerd " : "open       "} ${String(m.nummer).padStart(4, "0")} ${m.naam}`);
  await c.end();
  process.exit(0);
}

let melding;
if (gedaan === null) {
  console.log("Lege database: volledig schema laden …");
  await c.query(sqlBestand(join(ROOT, "db", "schema.sql")));
  await markeer(c, alle);
  melding = `Nieuwe database aangemaakt op schemaversie ${alle.at(-1).nummer}`;
} else {
  const open = alle.filter((m) => !gedaan.has(m.nummer));
  if (open.length === 0) {
    console.log(`Database is bijgewerkt (schemaversie ${Math.max(...gedaan)}). Niets te doen.`);
  }
  for (const m of open) {
    console.log(`Migratie ${String(m.nummer).padStart(4, "0")} ${m.naam} …`);
    try {
      await c.query("BEGIN");
      await c.query(sqlBestand(m.bestand));
      await c.query("SET search_path = fabriek, public");
      await markeer(c, alle.filter((x) => x.nummer <= m.nummer && (gedaan.has(x.nummer) || x.nummer === m.nummer)));
      await c.query("COMMIT");
      gedaan.add(m.nummer);
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      await c.end();
      await logOnderhoud(inst, { soort: "migratie", gestart_op: start, gelukt: false, melding: `Migratie ${m.nummer} mislukt: ${e.message}` });
      stop(`Migratie ${m.nummer} (${m.naam}) mislukt en teruggedraaid: ${e.message}\nDe database staat nog op de vorige versie.`);
    }
  }
  if (open.length) melding = `Migraties ${open.map((m) => m.nummer).join(", ")} uitgevoerd`;
}

console.log("Rechten voor de applicatie toepassen …");
await c.query(sqlBestand(join(ROOT, "db", "rechten.sql")));
await c.end();
if (melding) {
  await logOnderhoud(inst, { soort: "migratie", gestart_op: start, gelukt: true, melding });
  console.log(melding + ".");
}
console.log("Klaar.");
