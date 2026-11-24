// Batch input GUI – proof of concept op een laptop (fictieve gegevens tenzij je zelf iets invoert).
//
//   node opstarten.mjs                  starten (eerste keer: database aanmaken en testdata laden)
//   node opstarten.mjs --opnieuw        database leegmaken en verse testdata laden, daarna starten
//   node opstarten.mjs --leeg           lege fabriek: alleen configuratie (stappen, velden, accounts), daarna starten
//   node opstarten.mjs --herstel        een back-up terugzetten (je kiest uit een lijst), daarna starten
//   node opstarten.mjs --beheerder      gecontroleerde bootstrap of alleen-lezen hersteldiagnose
//   node opstarten.mjs --geen-browser   browser niet automatisch openen
//
// Met de map postgres\ in dit pakket draait PostgreSQL ingebouwd: niets installeren; afzonderlijke databasewachtwoorden.
// Zonder die map (of met een eigen database in instellingen.json) gebruikt het een geïnstalleerde PostgreSQL.

import { createRequire } from "node:module";
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { networkInterfaces } from "node:os";
import { spawn, spawnSync } from "node:child_process";
import readline from "node:readline/promises";

const MAP = dirname(fileURLToPath(import.meta.url));
const INSTELLINGEN = join(MAP, "instellingen.json");
const DATA = join(MAP, "data");
const PGDATA = join(DATA, "pgdata");
const BACKUPS = join(DATA, "backups");
const BEWAAR_BACKUPS = 5;
const args = new Set(process.argv.slice(2));
const VERSIE = existsSync(join(MAP, "VERSIE")) ? readFileSync(join(MAP, "VERSIE"), "utf8").trim() : "";

const major = Number(process.versions.node.split(".")[0]);
if (major < 20) stop(`Node.js ${process.versions.node} is te oud. Gebruik START.bat, of installeer Node.js 26 LTS (nodejs.org).`);

const require = createRequire(join(MAP, "server", "package.json"));
const pg = require("pg");

function stop(tekst) {
  console.error("\n" + tekst + "\n");
  process.exit(1);
}

if (/onedrive/i.test(MAP)) {
  console.log("\nLet op: deze map staat in OneDrive. Het synchroniseren kan de database verstoren.");
  console.log("Zet de map liever ergens buiten OneDrive, bijvoorbeeld C:\\batch-gui.\n");
}

// ---------- 1. Ingebouwde PostgreSQL ----------
const EXE = process.platform === "win32" ? ".exe" : "";
const PG_BIN = join(MAP, "postgres", "bin");
const heeftIngebouwd = existsSync(join(PG_BIN, `pg_ctl${EXE}`));

function pgTool(naam, toolArgs, stil = false) {
  const r = spawnSync(join(PG_BIN, naam + EXE), toolArgs, { encoding: "utf8", windowsHide: true });
  if (!stil && r.status !== 0) {
    console.error((r.stdout ?? "") + (r.stderr ?? ""));
  }
  return r;
}
const draaitPostgres = () => existsSync(join(PGDATA, "PG_VERSION")) && pgTool("pg_ctl", ["status", "-D", PGDATA], true).status === 0;

function grootteMap(map) {
  let t = 0;
  for (const f of readdirSync(map, { withFileTypes: true })) {
    const p = join(map, f.name);
    t += f.isDirectory() ? grootteMap(p) : statSync(p).size;
  }
  return t;
}

function tijdstempel(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Back-up = kopie van de databasemap terwijl PostgreSQL uit staat. Bewaart de laatste 5. */
function maakBackup() {
  mkdirSync(BACKUPS, { recursive: true });
  const naam = `backup_${tijdstempel()}${VERSIE ? `_v${VERSIE}` : ""}`;
  const start = new Date();
  cpSync(PGDATA, join(BACKUPS, naam), { recursive: true, filter: (bron) => !/postmaster\.(pid|opts)$/.test(bron) });
  const lijst = readdirSync(BACKUPS).filter((f) => f.startsWith("backup_")).sort().reverse();
  for (const oud of lijst.slice(BEWAAR_BACKUPS)) rmSync(join(BACKUPS, oud), { recursive: true, force: true });
  return { naam, start, grootte: grootteMap(join(BACKUPS, naam)) };
}

function startPostgres(poort) {
  // Geen uitvoer opvangen: op Windows erft de database die verbinding en houdt hem open,
  // waardoor het wachten nooit zou eindigen. De meldingen staan in data\postgres.log.
  const r = spawnSync(join(PG_BIN, "pg_ctl" + EXE), ["start", "-D", PGDATA, "-l", join(DATA, "postgres.log"), "-w", "-t", "90", "-o", `-p ${poort}`], {
    stdio: "ignore",
    windowsHide: true,
    timeout: 120_000,
  });
  if (r.status !== 0) {
    let log = "";
    try { log = readFileSync(join(DATA, "postgres.log"), "utf8").split(/\r?\n/).slice(-15).join("\n"); } catch {}
    stop(`De ingebouwde database start niet.\n${log}\n\nIs de applicatie misschien al gestart in een ander venster? Of is poort ${poort} bezet (zie "databasepoort" in instellingen.json)?`);
  }
}

let inst = null;
let gestopt = false;
function stopPostgres() {
  if (gestopt || !heeftIngebouwd || !inst?.db?.ingebouwd) return;
  gestopt = true;
  if (draaitPostgres()) {
    console.log("\nDatabase netjes afsluiten …");
    pgTool("pg_ctl", ["stop", "-D", PGDATA, "-m", "fast", "-w", "-t", "30"], true);
  }
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
  try {
    process.on(sig, () => { stopPostgres(); process.exit(0); });
  } catch {}
}
process.on("exit", stopPostgres);

// ---------- 2. Instellingen ----------
async function vraagExterneInstellingen() {
  console.log("\nEr zit geen ingebouwde database in dit pakket. Een paar vragen over PostgreSQL op deze laptop (Enter = standaard).\n");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const regels = rl[Symbol.asyncIterator]();
  const vraag = async (t, std) => {
    process.stdout.write(`${t}${std ? ` [${std}]` : ""}: `);
    const { value, done } = await regels.next();
    if (done) stop("Invoer afgebroken.");
    return value.trim() || std;
  };
  const db = {
    host: await vraag("PostgreSQL-server", "localhost"),
    port: Number(await vraag("Poort", "5432")),
    user: await vraag("Gebruiker", "postgres"),
    password: await vraag("Wachtwoord (dat je bij de installatie van PostgreSQL koos)", ""),
    database: "batchgui",
  };
  rl.close();
  return db;
}

async function leesInstellingen() {
  if (existsSync(INSTELLINGEN)) return JSON.parse(readFileSync(INSTELLINGEN, "utf8"));
  const db = heeftIngebouwd
    ? { ingebouwd: true, host: "localhost", port: 54329, user: "postgres", password: "", database: "batchgui" }
    : await vraagExterneInstellingen();
  // poort 3000 = applicatie; adres 127.0.0.1 = alleen deze laptop (0.0.0.0 = ook tablets en pc's in het netwerk)
  return { db, poort: 3000, adres: "127.0.0.1", jwtGeheim: randomBytes(32).toString("hex") };
}

inst = await leesInstellingen();
const ingebouwd = !!inst.db.ingebouwd;
// Oude instellingen bevatten de beheerlogin in db. Behoud die voor onderhoud,
// maar geef de API een afzonderlijke verbinding.
if (!inst.beheerDb) {
  inst.beheerDb = { ...inst.db };
  inst.db = { ...inst.db, user: "mes_app", password: ingebouwd ? randomBytes(32).toString("hex") : "" };
}
inst.beheerDb = { ...inst.db, ...inst.beheerDb };
if (!ingebouwd && !inst.db.password) {
  // Bewaar de gekozen onderhoudsverbinding; IT richt de beperkte login in.
  if (!existsSync(INSTELLINGEN)) writeFileSync(INSTELLINGEN, JSON.stringify(inst, null, 2), { mode: 0o600 });
  stop("Configureer db met de beperkte MES-login en beheerDb met de afzonderlijke onderhoudslogin in instellingen.json.");
}
if (!["mes_app", "batchgui_app"].includes(inst.db.user) || inst.db.user === inst.beheerDb.user)
  stop("Afzonderlijke beperkte MES-databasegebruiker vereist (D24).");
if (ingebouwd && !heeftIngebouwd) stop("instellingen.json verwacht de ingebouwde database, maar de map postgres ontbreekt in dit pakket.");

// ---------- 3. Ingebouwde database starten (met back-up vooraf) ----------
let backupVoorLog = null;
if (ingebouwd) {
  mkdirSync(DATA, { recursive: true });
  if (draaitPostgres() && args.has("--herstel")) {
    pgTool("pg_ctl", ["stop", "-D", PGDATA, "-m", "fast", "-w"], true);
  }
  if (draaitPostgres()) {
    console.log("De database draait nog van de vorige keer; die wordt gebruikt.");
  } else if (!existsSync(join(PGDATA, "PG_VERSION"))) {
    console.log("Eerste keer: database aanmaken …");
    // Kleine WAL-bestanden (1 MB) houden de database en de back-ups klein.
    const r = pgTool("initdb", ["-D", PGDATA, "-U", "postgres", "-A", "trust", "-E", "UTF8", "--no-locale", "--wal-segsize=1"]);
    if (r.status !== 0) stop("De database kon niet worden aangemaakt (zie de melding hierboven).");
    // Alleen bereikbaar op deze laptop zelf.
    appendFileSync(join(PGDATA, "postgresql.conf"), "\n# Batch input GUI\nlisten_addresses = 'localhost'\nmax_connections = 30\nmin_wal_size = 4MB\nmax_wal_size = 32MB\n");
    startPostgres(inst.db.port);
  } else {
    if (args.has("--herstel")) await herstel();
    console.log("Back-up maken …");
    backupVoorLog = maakBackup();
    startPostgres(inst.db.port);
  }
}

async function herstel() {
  const lijst = existsSync(BACKUPS) ? readdirSync(BACKUPS).filter((f) => f.startsWith("backup_")).sort().reverse() : [];
  if (!lijst.length) stop("Er zijn nog geen back-ups in data\\backups.");
  console.log("\nBeschikbare back-ups (nieuwste bovenaan):");
  const leesbaar = (b) => {
    const m = /^backup_(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})(?:_v(.+))?$/.exec(b);
    return m ? `${Number(m[3])}-${Number(m[2])}-${m[1]} om ${m[4]}:${m[5]}${m[7] ? `  (versie ${m[7]})` : ""}` : b;
  };
  lijst.forEach((b, i) => console.log(`  ${i + 1}. ${leesbaar(b)}`));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  process.stdout.write("\nWelk nummer wil je terugzetten? (Enter = afbreken) ");
  const { value } = await rl[Symbol.asyncIterator]().next();
  rl.close();
  const keuze = Number((value ?? "").trim());
  if (!keuze || !lijst[keuze - 1]) stop("Afgebroken; er is niets veranderd.");
  const bewaar = join(DATA, `pgdata_voor_herstel_${tijdstempel()}`);
  renameSync(PGDATA, bewaar);
  cpSync(join(BACKUPS, lijst[keuze - 1]), PGDATA, { recursive: true });
  if (process.platform !== "win32") chmodSync(PGDATA, 0o700); // PostgreSQL eist een afgeschermde map
  console.log(`Back-up teruggezet. De database van daarvoor staat nog in data\\${bewaar.split(/[\\/]/).pop()}.`);
}

// ---------- 4. Verbinden ----------
async function verbind(database) {
  const c = new pg.Client({ ...inst.beheerDb, database });
  try {
    await c.connect();
  } catch (e) {
    if (e.code === "28P01") stop("Het wachtwoord voor PostgreSQL klopt niet. Pas het aan in instellingen.json of verwijder dat bestand en start opnieuw.");
    if (e.code === "ECONNREFUSED" || e.code === "ENOTFOUND")
      stop(ingebouwd ? "De ingebouwde database reageert niet. Sluit alle vensters van de applicatie en start opnieuw." : `PostgreSQL is niet bereikbaar op ${inst.db.host}:${inst.db.port}. Is PostgreSQL geïnstalleerd en gestart?`);
    stop(`Verbinden met de database lukt niet: ${e.message}`);
  }
  return c;
}

{
  const c = await verbind("postgres");
  const { rows } = await c.query("SHOW server_version_num");
  if (Number(rows[0].server_version_num) < 140000) stop("PostgreSQL 14 of nieuwer is nodig.");
  const su = await c.query("SELECT rolsuper FROM pg_roles WHERE rolname = current_user");
  if (!su.rows[0]?.rolsuper) stop(`Gebruiker ${inst.beheerDb.user} is geen superuser. Gebruik de gebruiker postgres.`);
  await c.end();
  writeFileSync(INSTELLINGEN, JSON.stringify(inst, null, 2), { mode: 0o600 });
}

// ---------- 5. Database vullen of bijwerken ----------
function sqlBestand(naam) {
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
  console.log(`Database ${naam} opnieuw aanmaken …`);
  await c.query(`DROP DATABASE IF EXISTS "${naam}" WITH (FORCE)`);
  await c.query(`CREATE DATABASE "${naam}" ENCODING 'UTF8' TEMPLATE template0`);
  await c.end();

  const d = await verbind(naam);
  console.log("Tabellen en regels laden …");
  await d.query(sqlBestand("schema.sql"));
  if (metTestdata) {
    console.log("Fictieve productiedata laden (90 dagen, ca. 540 batches) …");
    await d.query("BEGIN");
    await d.query("SET LOCAL session_replication_role = replica"); // regels zijn al toegepast bij het genereren
    await d.query(sqlBestand("testdata.sql"));
    await verschuifNaarNu(d);
    await d.query("COMMIT");
  } else {
    console.log("Lege fabriek: alleen configuratie (stappen, velden, accounts, operators, pc's) …");
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
    WHERE c.table_schema = 'fabriek' AND t.table_type = 'BASE TABLE' AND c.data_type = 'timestamp with time zone'
      AND c.table_name NOT IN ('schema_versie', 'onderhoud_log')`);
  const delen = kolommen.map((k) => `SELECT max("${k.column_name}") AS t FROM "${k.table_name}"`);
  const { rows } = await d.query(
    `SELECT v, ((m + v)::date - m::date) AS dagen FROM (SELECT max(t) AS m, now() - max(t) - interval '10 minutes' AS v FROM (${delen.join(" UNION ALL ")}) x) y`);
  const { v, dagen } = rows[0];
  if (!v) return;
  // Per tabel alle tijdkolommen in één keer, zodat regels als "einde na begin" blijven kloppen.
  const perTabel = new Map();
  for (const k of kolommen) perTabel.set(k.table_name, [...(perTabel.get(k.table_name) ?? []), k.column_name]);
  for (const [tabel, kols] of perTabel) {
    await d.query(`UPDATE "${tabel}" SET ${kols.map((c) => `"${c}" = "${c}" + $1::interval`).join(", ")}`, [v]);
  }
  // Planningsdagen (datums) schuiven evenveel kalenderdagen mee.
  const { rows: datums } = await d.query(`
    SELECT c.table_name, c.column_name FROM information_schema.columns c
    JOIN information_schema.tables t USING (table_schema, table_name)
    WHERE c.table_schema = 'fabriek' AND t.table_type = 'BASE TABLE' AND c.data_type = 'date'`);
  // Per tabel alle datumkolommen in één keer (zoals hierboven), zodat een regel als "tot niet vóór van" blijft kloppen.
  const datumsPerTabel = new Map();
  for (const k of datums) datumsPerTabel.set(k.table_name, [...(datumsPerTabel.get(k.table_name) ?? []), k.column_name]);
  for (const [tabel, kols] of datumsPerTabel) {
    await d.query(`UPDATE "${tabel}" SET ${kols.map((c) => `"${c}" = "${c}" + $1::int`).join(", ")}`, [dagen]);
  }
}

const opnieuw = args.has("--opnieuw") || args.has("--leeg");
if (opnieuw || !(await bestaatDatabase())) await bouwDatabase(!args.has("--leeg"));

// Bestaande database van een eerdere versie bijwerken (database-updates uit db/migraties).
{
  const r = spawnSync(process.execPath, [join(MAP, "tools", "migreer.mjs"), "--instellingen", INSTELLINGEN], { encoding: "utf8" });
  if (r.status !== 0) stop(`Database bijwerken mislukt:\n${r.stdout}${r.stderr}`);
  for (const x of r.stdout.split(/\r?\n/)) if (/^Migratie|uitgevoerd/.test(x)) console.log(x);
}

// Het migratieprogramma heeft mes_app en de expliciete grants ingericht.
// Alleen bij de eigen ingebouwde PoC-database beheren we het runtimewachtwoord.
if (ingebouwd) {
  const c = await verbind(inst.db.database);
  try {
    await c.query("SET password_encryption = 'scram-sha-256'");
    await c.query("ALTER ROLE " + pg.escapeIdentifier(inst.db.user) + " PASSWORD " + pg.escapeLiteral(inst.db.password));
  } finally { await c.end(); }
}

// Inlogpogingen (sinds 0.22.2) en geweigerde invoer (sinds 0.47.0) ouder dan 90 dagen opruimen.
{
  const c = await verbind(inst.db.database);
  await c.query("SELECT fabriek.ruim_inlogpogingen_op()").catch(() => {});
  await c.query("SELECT fabriek.ruim_weigeringen_op()").catch(() => {});
  await c.end();
}

// Back-up van deze start vastleggen, zodat Beheer → Server hem toont.
if (backupVoorLog) {
  const c = await verbind(inst.db.database);
  await c
    .query(
      "INSERT INTO fabriek.onderhoud_log (soort, gestart_op, gelukt, bestand, grootte_bytes, versie, melding) VALUES ('backup', $1, true, $2, $3, $4, 'Kopie van de database bij het starten (laptop)')",
      [backupVoorLog.start, backupVoorLog.naam, backupVoorLog.grootte, VERSIE || null],
    )
    .catch(() => {});
  await c.end();
}

// Eerste beheerder (lege fabriek) of noodsleutel (--beheerder).
{
  const { maakInvoer, eersteBeheerder, beheerderMenu } = await import(pathToFileURL(join(MAP, "tools", "beheerder.mjs")).href);
  const c = await verbind(inst.db.database);
  const io = maakInvoer();
  try {
    if (args.has("--beheerder")) await beheerderMenu(c, io);
    else await eersteBeheerder(c, io);
  } catch (e) {
    stop(e.message);
  } finally {
    io.sluit();
    await c.end();
  }
}

// ---------- 6. Applicatie starten ----------
process.env.DATABASE_URL =
  `postgres://${encodeURIComponent(inst.db.user)}:${encodeURIComponent(inst.db.password ?? "")}@${inst.db.host}:${inst.db.port}/${inst.db.database}`;
process.env.JWT_GEHEIM = inst.jwtGeheim;
process.env.POORT = String(inst.poort);
process.env.ADRES = inst.adres;
process.env.INVOER_MAP = join(MAP, "web", "invoer");
process.env.PORTAAL_MAP = join(MAP, "web", "portaal");
process.env.LOGNIVEAU ??= "warn";
// Op de laptop: back-up bij elke start, geen maandelijkse hersteltest.
process.env.BATCHGUI_OMGEVING = "laptop";

try {
  await import(pathToFileURL(join(MAP, "server", "dist", "index.js")).href);
} catch (e) {
  if (e.code === "EADDRINUSE") stop(`Poort ${inst.poort} is al in gebruik. Draait de applicatie al in een ander venster? Of kies een andere "poort" in instellingen.json.`);
  throw e;
}

const url = `http://localhost:${inst.poort}/`;
console.log(`\nBatch input GUI ${VERSIE} draait op ${url}`);
if (inst.adres === "0.0.0.0") {
  for (const lijst of Object.values(networkInterfaces()))
    for (const a of lijst ?? []) if (a.family === "IPv4" && !a.internal) console.log(`  vanaf een ander apparaat: http://${a.address}:${inst.poort}/`);
}
{
  const c = await verbind(inst.db.database);
  const { rowCount } = await c.query("SELECT 1 FROM fabriek.gebruiker WHERE gebruikersnaam = 'beheerder1' AND actief");
  await c.end();
  if (rowCount) console.log("Testaccounts: operator, ploegleider1, kwaliteit1, beheerder1, analist1 (wachtwoord: demo)");
  else console.log("Inloggen met je eigen beheerder; maak in Portaal Beheer de andere accounts aan.");
}
console.log("Stoppen: druk Ctrl+C in dit venster (of sluit het venster).\n");

if (!args.has("--geen-browser")) {
  const [cmd, cmdArgs] =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    spawn(cmd, cmdArgs, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  } catch {}
}
