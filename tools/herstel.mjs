// Back-up terugzetten of controleren (beheerder).
//
//   node tools/herstel.mjs --controle [bestand]   hersteltest: zet de back-up (standaard de nieuwste)
//                                                  terug in een tijdelijke database, telt de gegevens
//                                                  en ruimt de tijdelijke database weer op. Maandelijks inplannen.
//   node tools/herstel.mjs <bestand>               ECHT herstel: de huidige database wordt bewaard onder
//                                                  een andere naam en de back-up wordt de nieuwe database.
//                                                  Stop eerst de applicatie. Vraagt om bevestiging (of --ja).
//   --instellingen <pad>                           ander instellingenbestand

import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import readline from "node:readline/promises";
import { randomBytes } from "node:crypto";
import { argumenten, controleerPgVersie, leesInstellingen, logOnderhoud, pg, pgProgramma, ROOT, sqlBestand, stop, tijdstempel, verbind, verbindingArgs, voerUit } from "./lib.mjs";

const { opties, los } = argumenten();
const inst = leesInstellingen(opties);
const DB = inst.beheerDb;
const start = new Date();

function nieuwsteBackup() {
  if (!inst.backupMap) stop("Geef een back-upbestand op, of zet backupMap in de instellingen.");
  const map = resolve(inst.backupMap);
  const lijst = existsSync(map)
    ? readdirSync(map).filter((f) => /^batchgui_.*\.dump$/.test(f)).map((f) => ({ f: join(map, f), t: statSync(join(map, f)).mtimeMs }))
    : [];
  if (!lijst.length) stop(`Geen back-ups gevonden in ${map}.`);
  return lijst.sort((a, b) => b.t - a.t)[0].f;
}

const bestand = resolve(los[0] ?? (opties.controle ? nieuwsteBackup() : stop("Geef het back-upbestand op dat je wilt terugzetten.")));
if (!existsSync(bestand)) stop(`Bestand niet gevonden: ${bestand}`);
// Een back-up van pg_dump (eigen formaat) begint met PGDMP. Controleer dat vóór er iets verandert.
{
  const kop = Buffer.alloc(5);
  const fd = openSync(bestand, "r");
  readSync(fd, kop, 0, 5, 0);
  closeSync(fd);
  if (kop.toString("latin1") !== "PGDMP") stop(`${basename(bestand)} is geen back-up van tools/backup.mjs (pg_dump, eigen formaat). Er is niets veranderd.`);
}

await controleerPgVersie(inst, pgProgramma(inst, "pg_restore"), DB);

async function zetTerug(database, aangemaakt = () => {}) {
  const beheer = await verbind(DB, "postgres");
  try {
    await beheer.query(`CREATE DATABASE ${pg.escapeIdentifier(database)} ENCODING 'UTF8' TEMPLATE template0`);
    aangemaakt();
  } finally { await beheer.end(); }
  const r = await voerUit(pgProgramma(inst, "pg_restore"), [...verbindingArgs(DB, database), "--no-owner", "--exit-on-error", bestand], DB);
  if (r.code !== 0) throw new Error(r.uitvoer.slice(0, 500) || `pg_restore stopte met code ${r.code}`);
}

async function tel(database) {
  const c = await verbind(DB, database);
  try {
  const { rows } = await c.query(`SELECT (SELECT count(*) FROM fabriek.batch)::int AS batches,
                                         (SELECT count(*) FROM fabriek.waarde)::int AS waarden,
                                         (SELECT count(*) FROM fabriek.lot)::int AS lots,
                                         (SELECT count(*) FROM fabriek.processtap)::int AS stappen,
                                         (SELECT max(nummer) FROM fabriek.schema_versie)::int AS schema`);
  return rows[0];
  } finally { await c.end(); }
}

async function verwijder(database) {
  const beheer = await verbind(DB, "postgres");
  try { await beheer.query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(database)} WITH (FORCE)`); }
  finally { await beheer.end(); }
}

if (opties.controle) {
  // Unieke korte naam; verwijder alleen een database die deze aanroep heeft gemaakt.
  const tijdelijk = `${DB.database.slice(0, 20)}_hersteltest_${randomBytes(12).toString("hex")}`;
  let gemaakt = false, melding, fout;
  try {
    await zetTerug(tijdelijk, () => { gemaakt = true; });
    const n = await tel(tijdelijk);
    if (!n.schema) throw new Error("de teruggezette database heeft geen schemaversie");
    if (n.stappen === 0) throw new Error("de teruggezette database bevat geen processtappen");
    melding = `${n.batches} batches, ${n.lots} lots, ${n.waarden} waarden teruggezet (schemaversie ${n.schema})`;
  } catch (e) {
    fout = e.message;
  } finally {
    if (gemaakt) {
      try { await verwijder(tijdelijk); }
      catch (e) { fout = [fout, `tijdelijke database ${tijdelijk} niet opgeruimd: ${e.message}`].filter(Boolean).join("; "); }
    }
  }
  await logOnderhoud(inst, { soort: "hersteltest", gestart_op: start, gelukt: !fout, bestand: basename(bestand), grootte_bytes: statSync(bestand).size, melding: fout ?? melding });
  if (fout) stop(`Hersteltest mislukt: ${fout}`);
  console.log(`Hersteltest geslaagd: ${melding} uit ${basename(bestand)}.`);
  process.exit(0);
}

// Echt herstel
let bewaarnaam = `${DB.database}_voor_herstel_${tijdstempel(start).replace(/-/g, "")}`;
{
  const c = await verbind(DB, "postgres");
  for (let i = 2; (await c.query("SELECT 1 FROM pg_database WHERE datname = $1", [bewaarnaam])).rowCount; i++) {
    bewaarnaam = `${DB.database}_voor_herstel_${tijdstempel(start).replace(/-/g, "")}_${i}`;
  }
  await c.end();
}
console.log(`\nDit zet ${basename(bestand)} terug als database ${DB.database}.`);
console.log(`De huidige database blijft bewaard als ${bewaarnaam}. Stop eerst de applicatie.`);
if (!opties.ja) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const antwoord = (await rl.question("Typ HERSTEL om door te gaan: ")).trim();
  rl.close();
  if (antwoord !== "HERSTEL") stop("Afgebroken; er is niets veranderd.", 0);
}

const beheer = await verbind(DB, "postgres");
const { rowCount } = await beheer.query("SELECT 1 FROM pg_database WHERE datname = $1", [DB.database]);
if (rowCount) {
  await beheer.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, [DB.database]);
  await beheer.query(`ALTER DATABASE ${pg.escapeIdentifier(DB.database)} RENAME TO ${pg.escapeIdentifier(bewaarnaam)}`);
}
await beheer.end();

try {
  await zetTerug(DB.database);
  const c = await verbind(DB);
  try {
    const bekend = new Set(readdirSync(join(ROOT, "db", "migraties"))
      .map(f => /^(\d{4})_/.exec(f)).filter(Boolean).map(m => Number(m[1])));
    const { rows } = await c.query("SELECT nummer FROM fabriek.schema_versie");
    const onbekend = rows.filter(r => !bekend.has(r.nummer));
    if (onbekend.length) throw new Error("Onbekende schemaversie in back-up; gebruik het bijbehorende applicatiepakket");
    await c.query(sqlBestand(join(ROOT, "db", "rechten.sql")));
  } finally { await c.end(); }
  const n = await tel(DB.database);
  const melding = `${n.batches} batches, ${n.lots} lots, ${n.waarden} waarden teruggezet; oude database bewaard als ${rowCount ? bewaarnaam : "(geen)"}`;
  await logOnderhoud(inst, { soort: "herstel", gestart_op: start, gelukt: true, bestand: basename(bestand), melding });
  console.log(`Herstel gelukt: ${melding}.`);
  console.log("Controleer of de database schemaversie klopt met: node tools/migreer.mjs --status. Start daarna de applicatie.");
} catch (e) {
  // Terug naar de oude toestand
  await verwijder(DB.database).catch(() => {});
  if (rowCount) {
    const b = await verbind(DB, "postgres");
    await b.query(`ALTER DATABASE ${pg.escapeIdentifier(bewaarnaam)} RENAME TO ${pg.escapeIdentifier(DB.database)}`);
    await b.end();
  }
  stop(`Herstel mislukt, de oude database is teruggezet: ${e.message}`);
}
