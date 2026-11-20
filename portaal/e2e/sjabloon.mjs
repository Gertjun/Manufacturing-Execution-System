// Test van het Excel-sjabloon voor velden (Beheer), op de fictieve configuratie.
// Gebruik: node e2e/sjabloon.mjs   (start zelf de API op poort 3469; zet zelf de database klaar)
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import pg from "pg";

const DB = process.env.DATABASE_URL ?? "postgres://postgres@localhost/batchgui?host=/tmp&port=5433";
const SHOTS = process.env.SHOTS ?? "/tmp/shots-sjabloon";
const BASIS = "http://localhost:3469";
mkdirSync(SHOTS, { recursive: true });

let fouten = 0;
const check = (naam, ok, extra = "") => {
  console.log(`${ok ? "  OK  " : "  FOUT"} ${naam}${!ok && extra ? `  [${extra}]` : ""}`);
  if (!ok) fouten++;
};
const db = new pg.Client({ connectionString: DB });
await db.connect();
const q = async (sql, p = []) => (await db.query(sql, p)).rows;

const api = spawn("npx", ["tsx", "src/index.ts"], {
  cwd: new URL("../../api/", import.meta.url).pathname,
  env: { ...process.env, DATABASE_URL: DB, JWT_GEHEIM: "e2e-".repeat(10), POORT: "3469", PORTAAL_MAP: new URL("../dist", import.meta.url).pathname },
  stdio: ["ignore", "ignore", "inherit"],
  detached: true,
});
const stopApi = () => { try { process.kill(-api.pid); } catch {} };
for (let i = 0; i < 40; i++) {
  try { if ((await fetch(`${BASIS}/gezondheid`)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 250));
}

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "nl-NL", acceptDownloads: true });
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("  PAGINAFOUT", e.message); fouten++; });
const shot = (naam) => page.screenshot({ path: `${SHOTS}/${naam}.png` });
const inloggen = async (naam) => {
  await page.goto(`${BASIS}/portaal/#/login`);
  await page.getByLabel("Gebruikersnaam").fill(naam);
  await page.getByLabel("Wachtwoord").fill("demo");
  await page.getByRole("button", { name: "Inloggen" }).click();
};

const leesXlsx = (pad) => JSON.parse(execFileSync("python3", ["-c", `
import sys, json, openpyxl
wb = openpyxl.load_workbook(sys.argv[1])
ws = wb.active
print(json.dumps({"blad": ws.title, "rijen": [[c for c in r] for r in ws.iter_rows(values_only=True)]}, default=str))`, pad]).toString());
// Zelf de database klaarzetten: alleen configuratie en testaccounts.
const PSQL = (bestand) => execFileSync("psql", ["-q", "-v", "ON_ERROR_STOP=1", "-d", DB, "-f", new URL(`../../db/${bestand}`, import.meta.url).pathname], { stdio: "ignore" });
const bewerk = (pad, uit, python) => execFileSync("python3", ["-c", `
import sys, openpyxl
wb = openpyxl.load_workbook(sys.argv[1])
ws = wb.active
${python}
wb.save(sys.argv[2])`, pad, uit]);

try {
  await db.query("DROP SCHEMA IF EXISTS fabriek CASCADE");
  PSQL("schema.sql");
  try { PSQL("rechten.sql"); } catch {}
  PSQL("seed_config.sql");
  PSQL("seed_accounts_demo.sql");

  console.log("\nSjabloon downloaden");
  await inloggen("beheerder1");
  await page.getByRole("link", { name: "Stappen en velden" }).click();
  await page.getByRole("heading", { name: "Stappen en velden" }).waitFor();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Sjabloon downloaden" }).click()]);
  const pad = `${SHOTS}/${dl.suggestedFilename()}`;
  await dl.saveAs(pad);
  check("Bestandsnaam met de datum", /^Velden per stap \d{4}-\d{2}-\d{2}\.xlsx$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  const x = leesXlsx(pad);
  const [{ n }] = await q("SELECT count(*)::int AS n FROM fabriek.veld");
  check("Alle velden staan erin, ook uitgezette", x.rijen.length === n + 1, `${x.rijen.length - 1} / ${n}`);
  check("Kolommen van het sjabloon", x.rijen[0].join("|") === "Stap|Code|Naam|Soort|Eenheid|Verplicht|Tolerantie|Tolerantie in|Ondergrens|Bovengrens|Decimalen|Op certificaat|Actief", x.rijen[0].join("|"));
  const s51 = x.rijen.find((r) => r[1] === "S5.1");
  check("Grenzen zijn getallen in Excel", typeof s51[8] === "number" || s51[8] === null, JSON.stringify(s51));

  console.log("\nBestand met een fout");
  const fout1 = `${SHOTS}/met-fout.xlsx`;
  bewerk(pad, fout1, `
for r in ws.iter_rows(min_row=2):
    if r[1].value == "S3.1": r[2].value = "Temperatuur menger"
ws.append(["PS3", None, "Viscositeit", "overig", "mPa·s", "nee", None, None, 100, 400, None, "ja", "ja"])
ws.append(["PS4", None, "Verkeerde grenzen", "overig", None, "ja", None, None, 10, 5, None, "nee", "ja"])`);
  await page.locator("#sjabloon-bestand").setInputFiles(fout1);
  await page.getByRole("heading", { name: "Sjabloon inlezen" }).waitFor();
  await page.getByText("Er wordt niets opgeslagen zolang er een regel met een fout is").waitFor();
  check("Foute regel staat bovenaan met de reden", (await page.locator("tbody tr").first().innerText()).includes("De ondergrens is hoger dan de bovengrens"));
  check("Geen knop om op te slaan", (await page.getByRole("button", { name: /opslaan/ }).count()) === 0);
  await shot("01-met-fout");
  const [{ v0 }] = await q("SELECT count(*)::int AS v0 FROM fabriek.veld WHERE naam = 'Viscositeit'");
  check("Er is niets opgeslagen", v0 === 0);

  console.log("\nGoed bestand");
  await page.getByRole("link", { name: "Annuleren" }).click();
  await page.getByRole("heading", { name: "Stappen en velden" }).waitFor();
  const goed = `${SHOTS}/goed.xlsx`;
  bewerk(pad, goed, `
for r in ws.iter_rows(min_row=2):
    if r[1].value == "S3.1": r[2].value = "Temperatuur menger"
ws.append(["PS3", None, "Viscositeit", "overig", "mPa·s", "nee", None, None, "100", "400,5", 1, "ja", "ja"])`);
  await page.locator("#sjabloon-bestand").setInputFiles(goed);
  await page.getByRole("button", { name: "2 wijzigingen opslaan" }).waitFor();
  check("Controle toont 1 nieuw en 1 gewijzigd", (await page.locator(".tegel").first().innerText()).startsWith("1") && (await page.locator(".tegel").nth(1).innerText()).startsWith("1"));
  check("Wijziging met oude en nieuwe naam", (await page.locator("tr", { hasText: "S3.1" }).innerText()).includes("→ Temperatuur menger"));
  await shot("02-controle");
  await page.getByRole("button", { name: "2 wijzigingen opslaan" }).click();
  await page.getByRole("heading", { name: "Stappen en velden" }).waitFor();
  await page.waitForTimeout(500);
  const [nieuw] = await q("SELECT code, eenheid, verplicht, grens_min::float, grens_max::float, op_certificaat, decimalen FROM fabriek.veld WHERE naam = 'Viscositeit'");
  check("Nieuw veld opgeslagen met alle gegevens", nieuw?.eenheid === "mPa·s" && nieuw.verplicht === false && nieuw.grens_min === 100 && nieuw.grens_max === 400.5 && nieuw.op_certificaat === true && nieuw.decimalen === 1, JSON.stringify(nieuw));
  const [s31] = await q("SELECT naam FROM fabriek.veld WHERE code = 'S3.1'");
  check("Bestaand veld hernoemd", s31.naam === "Temperatuur menger");
  const [log] = await q("SELECT count(*)::int AS n FROM fabriek.config_log WHERE tabel = 'veld' AND gewijzigd_door = 'beheerder1'");
  check("Wijzigingen in het logboek", log.n >= 2, String(log.n));
  await shot("03-opgeslagen");
} catch (e) {
  console.log("  AFGEBROKEN", e.message.split("\n")[0]);
  await shot("fout").catch(() => {});
  fouten++;
} finally {
  await browser.close();
  await db.end();
  stopApi();
}
console.log(fouten ? `\n${fouten} fout(en)` : "\nAlles geslaagd");
process.exit(fouten ? 1 : 0);
