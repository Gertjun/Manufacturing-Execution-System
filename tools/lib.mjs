// Gedeelde onderdelen voor de beheertools (migreer, backup, herstel, start-server).
// Werkt zowel in de repository (api/) als in het serverpakket (server/).

import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** De map met de server (pakket) of de API (repository); daar staat node_modules met pg. */
export const SERVER_MAP = existsSync(join(ROOT, "server", "package.json")) ? join(ROOT, "server") : join(ROOT, "api");
const require = createRequire(join(SERVER_MAP, "package.json"));
export const pg = require("pg");

export const VERSIE = existsSync(join(ROOT, "VERSIE")) ? readFileSync(join(ROOT, "VERSIE"), "utf8").trim() : "onbekend";

export function stop(tekst, code = 1) {
  console.error("\n" + tekst + "\n");
  process.exit(code);
}

/** Leest --sleutel waarde en --vlag uit de opdrachtregel. */
export function argumenten(argv = process.argv.slice(2)) {
  const opties = {};
  const los = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const naam = a.slice(2);
      if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") && ["instellingen", "map"].includes(naam)) opties[naam] = argv[++i];
      else opties[naam] = true;
    } else los.push(a);
  }
  return { opties, los };
}

/**
 * Instellingen uit instellingen.json (standaard naast de tools, in de hoofdmap van het pakket).
 * Andere plek: --instellingen <pad> of de omgevingsvariabele BATCHGUI_INSTELLINGEN.
 */
export function leesInstellingen(opties = {}) {
  const pad = resolve(opties.instellingen ?? process.env.BATCHGUI_INSTELLINGEN ?? join(ROOT, "instellingen.json"));
  if (!existsSync(pad)) stop(`Instellingen niet gevonden: ${pad}\nMaak dit bestand aan volgens docs/SERVER.md.`);
  const inst = JSON.parse(readFileSync(pad, "utf8"));
  if (!inst.db?.database) stop(`In ${pad} ontbreekt db.database.`);
  inst.db = { host: "localhost", port: 5432, ...inst.db };
  // Beheerdersverbinding (migraties, back-ups, herstel): zelfde server en database, andere gebruiker.
  inst.beheerDb = { ...inst.db, ...(inst.beheerDb ?? {}) };
  inst.pad = pad;
  return inst;
}

export async function verbind(conf, database = conf.database) {
  const c = new pg.Client({ ...conf, database });
  try {
    await c.connect();
  } catch (e) {
    if (e.code === "28P01") stop(`Wachtwoord van ${conf.user} voor PostgreSQL klopt niet.`);
    if (e.code === "3D000") throw e; // database bestaat niet: aan de aanroeper
    if (e.code === "ECONNREFUSED") stop(`PostgreSQL is niet bereikbaar op ${conf.host}:${conf.port}.`);
    stop(`Verbinden met PostgreSQL lukt niet: ${e.message}`);
  }
  return c;
}

/** Een PostgreSQL-programma (pg_dump, pg_restore) uit pgBin of het PATH. */
export function pgProgramma(inst, naam) {
  if (inst.pgBin) {
    const exe = join(inst.pgBin, process.platform === "win32" ? `${naam}.exe` : naam);
    if (!existsSync(exe)) stop(`${naam} niet gevonden in ${inst.pgBin} (instelling pgBin).`);
    return exe;
  }
  return naam;
}

/** Voert een programma uit met het wachtwoord in PGPASSWORD; geeft {code, uitvoer}. */
export function voerUit(programma, args, conf) {
  return new Promise((klaar) => {
    let uitvoer = "";
    const p = spawn(programma, args, { env: { ...process.env, PGPASSWORD: conf.password ?? "" }, windowsHide: true });
    p.stdout.on("data", (d) => (uitvoer += d));
    p.stderr.on("data", (d) => (uitvoer += d));
    p.on("error", (e) => klaar({ code: -1, uitvoer: `${programma} kon niet worden gestart: ${e.message}. Zet pgBin in de instellingen.` }));
    p.on("close", (code) => klaar({ code, uitvoer: uitvoer.trim() }));
  });
}

export const verbindingArgs = (conf, database = conf.database) => ["-h", conf.host, "-p", String(conf.port), "-U", conf.user, "-d", database];

/** Schrijft een regel in fabriek.onderhoud_log, als die tabel er is. Fouten hierbij zijn niet fataal. */
export async function logOnderhoud(inst, regel) {
  let c;
  try {
    c = await verbind(inst.beheerDb);
    await c.query(
      `INSERT INTO fabriek.onderhoud_log (soort, gestart_op, gelukt, bestand, grootte_bytes, versie, melding)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [regel.soort, regel.gestart_op, regel.gelukt, regel.bestand ?? null, regel.grootte_bytes ?? null, VERSIE, regel.melding ?? null],
    );
  } catch (e) {
    console.error(`Let op: kon niet in het onderhoudslogboek schrijven (${e.message}).`);
  } finally {
    await c?.end().catch(() => {});
  }
}

export function tijdstempel(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Leest een SQL-bestand zonder psql-opdrachten (regels met een backslash). */
export function sqlBestand(pad) {
  return readFileSync(pad, "utf8").split(/\r?\n/).filter((r) => !r.startsWith("\\")).join("\n");
}

/**
 * pg_restore moet dezelfde hoofdversie hebben als de server (of ouder): een nieuwere zet
 * instellingen in de back-up die een oudere server niet kent. Stopt met uitleg als dat niet klopt.
 */
export async function controleerPgVersie(inst, programma, conf) {
  const r = await voerUit(programma, ["--version"], conf);
  const client = Number(/(\d+)(\.\d+)?/.exec(r.uitvoer)?.[1]);
  const c = await verbind(conf, "postgres");
  const server = Math.floor(Number((await c.query("SHOW server_version_num")).rows[0].server_version_num) / 10000);
  await c.end();
  if (client && server && client > server) {
    stop(`${programma} is versie ${client}, de database-server versie ${server}. Gebruik de programma's van de server zelf: zet pgBin in de instellingen op de bin-map van PostgreSQL ${server}.`);
  }
}

