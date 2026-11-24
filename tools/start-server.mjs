// Start de applicatie op de fabrieksserver met de instellingen uit instellingen.json.
// Wordt gestart door de Windows-service (WinSW) of systemd, zie docs/SERVER.md.
//
//   node tools/start-server.mjs [--instellingen <pad>]
//
// Controleert vooraf of de database op de juiste schemaversie staat; zo niet, dan stopt hij
// met een duidelijke melding (voer dan eerst tools/migreer.mjs uit).

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { argumenten, leesInstellingen, ROOT, SERVER_MAP, stop, verbind, VERSIE } from "./lib.mjs";

const { opties } = argumenten();
const inst = leesInstellingen(opties);
if (!inst.jwtGeheim || inst.jwtGeheim.length < 32) stop("Zet jwtGeheim in de instellingen: een willekeurige tekst van minstens 32 tekens.");

// Schemaversie controleren
const nieuwste = Math.max(...readdirSync(join(ROOT, "db", "migraties")).map((f) => Number(/^(\d{4})_/.exec(f)?.[1] ?? 0)));
{
  const c = await verbind(inst.db).catch((e) => stop(`Database ${inst.db.database} niet gevonden (${e.message}). Voer eerst tools/migreer.mjs uit.`));
  const { rows } = await c.query("SELECT to_regclass('fabriek.schema_versie') IS NOT NULL AS er").catch(() => ({ rows: [{ er: false }] }));
  const huidig = rows[0].er ? Number((await c.query("SELECT max(nummer) AS n FROM fabriek.schema_versie")).rows[0].n) : 1;
  await c.end();
  if (huidig < nieuwste) stop(`De database staat op schemaversie ${huidig}, versie ${VERSIE} heeft ${nieuwste} nodig. Voer eerst tools/migreer.mjs uit.`);
  const c2 = await verbind(inst.db);
  try {
    const { rows: b } = await c2.query(`
      SELECT EXISTS (
        SELECT 1 FROM fabriek.gebruiker g
        WHERE g.actief AND NOT g.gedeeld AND NOT g.wachtwoord_wijzigen
          AND g.rol <> 'scherm'
          AND fabriek.authorization_permits(g.id,'system.read',NULL,NULL,NULL)
      ) AS beschikbaar
    `);
    if (!b[0]?.beschikbaar) console.log("Let op: geen actieve persoonlijke identiteit met globale MES-bevoegdheid system.read. Laat de identiteitsadministratie gecontroleerd beoordelen; geen automatische roltoekenning.");
  } finally { await c2.end(); }
  if (huidig > nieuwste) stop(`De database (schemaversie ${huidig}) is nieuwer dan deze applicatie (${VERSIE}, schemaversie ${nieuwste}). Gebruik de nieuwere versie.`);
}

const d = inst.db;
process.env.DATABASE_URL = `postgres://${encodeURIComponent(d.user)}:${encodeURIComponent(d.password ?? "")}@${encodeURIComponent(d.host)}:${d.port}/${encodeURIComponent(d.database)}`;
process.env.JWT_GEHEIM = inst.jwtGeheim;
process.env.POORT = String(inst.poort ?? (inst.https ? 443 : 3000));
process.env.ADRES = inst.adres ?? "0.0.0.0";
process.env.LOGNIVEAU ??= inst.logniveau ?? "info";
const web = existsSync(join(ROOT, "web")) ? join(ROOT, "web") : null;
process.env.INVOER_MAP = web ? join(web, "invoer") : join(ROOT, "invoer", "dist");
process.env.PORTAAL_MAP = web ? join(web, "portaal") : join(ROOT, "portaal", "dist");
if (inst.https?.pfx) {
  process.env.HTTPS_PFX = inst.https.pfx;
  if (inst.https.wachtwoord) process.env.HTTPS_PFX_WACHTWOORD = inst.https.wachtwoord;
} else if (inst.https) {
  process.env.HTTPS_CERT = inst.https.cert;
  process.env.HTTPS_KEY = inst.https.key;
}

console.log(`Batch input GUI ${VERSIE} start op poort ${process.env.POORT} (${inst.https ? "https" : "http"}).`);
await import(pathToFileURL(join(SERVER_MAP, "dist", "index.js")).href);
