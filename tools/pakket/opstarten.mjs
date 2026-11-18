// Batch input GUI – opstarten op een laptop (testomgeving met fictieve gegevens).
//
//   node opstarten.mjs               starten (eerste keer: vragen stellen en database vullen)
//   node opstarten.mjs --opnieuw     database leegmaken en verse testdata laden, daarna starten
//   node opstarten.mjs --leeg        database zonder productiedata (alleen configuratie), daarna starten
//   node opstarten.mjs --geen-browser  browser niet automatisch openen
//
// Nodig: Node.js 20 of nieuwer en PostgreSQL 14 of nieuwer op deze laptop.

import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { networkInterfaces } from "node:os";
import { spawn } from "node:child_process";
import readline from "node:readline/promises";

const MAP = dirname(fileURLToPath(import.meta.url));
const INSTELLINGEN = join(MAP, "instellingen.json");
const args = new Set(process.argv.slice(2));

const major = Number(process.versions.node.split(".")[0]);
if (major < 20) stop(`Node.js ${process.versions.node} is te oud. Installeer Node.js 22 LTS (nodejs.org).`);

const require = createRequire(join(MAP, "server", "package.json"));
const pg = require("pg");

function stop(tekst) {
  console.error("\n" + tekst + "\n");
  process.exit(1);
}

// ---------- 1. Instellingen ----------
async function leesInstellingen() {
  if (existsSync(INSTELLINGEN)) return JSON.parse(readFileSync(INSTELLINGEN, "utf8"));
  console.log("\nEerste keer opstarten. Een paar vragen over PostgreSQL op deze laptop (Enter = standaard).\n");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const regels = rl[Symbol.asyncIterator]();
  const vraag = async (t, std) => {
    process.stdout.write(`${t}${std ? ` [${std}]` : ""}: `);
    const { value, done } = await regels.next();
    if (done) stop("Invoer afgebroken.");
    return value.trim() || std;
  };
  const inst = {
    db: {
      host: await vraag("PostgreSQL-server", "localhost"),
      port: Number(await vraag("Poort", "5432")),
      user: await vraag("Gebruiker", "postgres"),
      password: await vraag("Wachtwoord (dat je bij de installatie van PostgreSQL koos)", ""),
      database: "batchgui",
    },
    poort: Number(await vraag("Poort voor de applicatie", "3000")),
    // 127.0.0.1 = alleen deze laptop. Zet op 0.0.0.0 om ook vanaf een tablet of andere pc te testen.
    adres: "127.0.0.1",
    jwtGeheim: randomBytes(32).toString("hex"),
  };
  rl.close();
  return inst;
}

let inst = await leesInstellingen();

async function verbind(database) {
  const c = new pg.Client({ ...inst.db, database });
  try {
    await c.connect();
  } catch (e) {
    if (e.code === "28P01") {
      if (existsSync(INSTELLINGEN)) stop("Het wachtwoord voor PostgreSQL klopt niet. Pas het aan in instellingen.json of verwijder dat bestand en start opnieuw.");
      stop("Het wachtwoord voor PostgreSQL klopt niet. Start opnieuw en vul het goede wachtwoord in.");
    }
    if (e.code === "ECONNREFUSED" || e.code === "ENOTFOUND")
      stop(`PostgreSQL is niet bereikbaar op ${inst.db.host}:${inst.db.port}. Is PostgreSQL geïnstalleerd en gestart? (Windows: Services → postgresql-x64-…)`);
    stop(`Verbinden met PostgreSQL lukt niet: ${e.message}`);
  }
  return c;
}

// Controleer de verbinding voordat de instellingen worden bewaard.
{
  const c = await verbind("postgres");
  const { rows } = await c.query("SHOW server_version_num");
  if (Number(rows[0].server_version_num) < 140000) stop("PostgreSQL 14 of nieuwer is nodig. Installeer PostgreSQL 16 of 17.");
  const su = await c.query("SELECT rolsuper FROM pg_roles WHERE rolname = current_user");
  if (!su.rows[0]?.rolsuper) stop(`Gebruiker ${inst.db.user} is geen superuser. Gebruik de gebruiker postgres.`);
  await c.end();
  if (!existsSync(INSTELLINGEN)) {
    writeFileSync(INSTELLINGEN, JSON.stringify(inst, null, 2));
    console.log("Instellingen bewaard in instellingen.json.");
  }
}

// ---------- 2. Database ----------
function sqlBestand(naam) {
  // psql-opdrachten (regels met een backslash) kan de Node-client niet uitvoeren.
  return readFileSync(join(MAP, "db", naam), "utf8").split(/\r?\n/).filter((r) => !r.startsWith("\\")).join("\n");
}

async function bestaatDatabase() {
  const c = await verbind("postgres");
  const { rowCount } = await c.query("SELECT 1 FROM pg_database WHERE datname = $1", [inst.db.database]);
  await c.end();
  return rowCount > 0;
}

async function bouwDatabase(metTestdata) {
  const naam = inst.db.database;
  const c = await verbind("postgres");
  console.log(`Database ${naam} opnieuw aanmaken ...`);
  await c.query(`DROP DATABASE IF EXISTS "${naam}" WITH (FORCE)`);
  await c.query(`CREATE DATABASE "${naam}" ENCODING 'UTF8' TEMPLATE template0`);
  await c.end();

  const d = await verbind(naam);
  console.log("Tabellen en regels laden ...");
  await d.query(sqlBestand("schema.sql"));
  if (metTestdata) {
    console.log("Fictieve productiedata laden (90 dagen, ca. 540 batches) ...");
    await d.query("BEGIN");
    await d.query("SET LOCAL session_replication_role = replica"); // regels zijn al toegepast bij het genereren
    await d.query(sqlBestand("testdata.sql"));
    await verschuifNaarNu(d);
    await d.query("COMMIT");
  } else {
    console.log("Alleen configuratie laden (stappen, velden, accounts, operators, pc's) ...");
    await d.query(sqlBestand("seed_config.sql"));
  }
  await d.query("ANALYZE");
  await d.end();
  console.log("Database klaar.");
}

// De testdata eindigt op de dag dat hij gemaakt is. Schuif alle tijdstippen op zodat hij tot nu loopt.
async function verschuifNaarNu(d) {
  await d.query("SET LOCAL search_path = fabriek, public");
  const { rows: kolommen } = await d.query(`
    SELECT c.table_name, c.column_name FROM information_schema.columns c
    JOIN information_schema.tables t USING (table_schema, table_name)
    WHERE c.table_schema = 'fabriek' AND t.table_type = 'BASE TABLE' AND c.data_type = 'timestamp with time zone'`);
  const delen = kolommen.map((k) => `SELECT max("${k.column_name}") AS t FROM "${k.table_name}"`);
  const { rows } = await d.query(`SELECT now() - max(t) - interval '10 minutes' AS v FROM (${delen.join(" UNION ALL ")}) x`);
  const v = rows[0].v;
  if (!v) return;
  for (const k of kolommen) {
    await d.query(`UPDATE "${k.table_name}" SET "${k.column_name}" = "${k.column_name}" + $1::interval WHERE "${k.column_name}" IS NOT NULL`, [v]);
  }
}

const opnieuw = args.has("--opnieuw") || args.has("--leeg");
if (opnieuw || !(await bestaatDatabase())) await bouwDatabase(!args.has("--leeg"));

// ---------- 3. Server starten ----------
process.env.DATABASE_URL =
  `postgres://${encodeURIComponent(inst.db.user)}:${encodeURIComponent(inst.db.password)}@${inst.db.host}:${inst.db.port}/${inst.db.database}`;
process.env.JWT_GEHEIM = inst.jwtGeheim;
process.env.POORT = String(inst.poort);
process.env.ADRES = inst.adres;
process.env.INVOER_MAP = join(MAP, "web", "invoer");
process.env.PORTAAL_MAP = join(MAP, "web", "portaal");
process.env.LOGNIVEAU ??= "warn";

try {
  await import(pathToFileURL(join(MAP, "server", "dist", "index.js")).href);
} catch (e) {
  if (e.code === "EADDRINUSE") stop(`Poort ${inst.poort} is al in gebruik. Draait de applicatie al in een ander venster? Of kies een andere poort in instellingen.json.`);
  throw e;
}

const url = `http://localhost:${inst.poort}/`;
console.log(`\nBatch input GUI draait op ${url}`);
if (inst.adres === "0.0.0.0") {
  for (const lijst of Object.values(networkInterfaces()))
    for (const a of lijst ?? []) if (a.family === "IPv4" && !a.internal) console.log(`  vanaf een ander apparaat: http://${a.address}:${inst.poort}/`);
}
console.log("Testaccounts: operator, ploegleider1, kwaliteit1, beheerder1, analist1 (wachtwoord: demo)");
console.log("Stoppen: dit venster sluiten of Ctrl+C.\n");

if (!args.has("--geen-browser")) {
  const [cmd, cmdArgs] =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    spawn(cmd, cmdArgs, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  } catch {}
}
