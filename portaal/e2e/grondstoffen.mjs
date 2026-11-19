// Test van grondstoffen in Chrome (Beheer en Kwaliteit), op data van tools/genereer_testdata.py.
// Gebruik: node e2e/grondstoffen.mjs   (start zelf de API op poort 3464)
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import pg from "pg";

const DB = process.env.DATABASE_URL ?? "postgres://postgres@localhost/batchgui?host=/tmp&port=5433";
const SHOTS = process.env.SHOTS ?? "/tmp/shots-grondstoffen";
const BASIS = "http://localhost:3464";
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
  env: { ...process.env, DATABASE_URL: DB, JWT_GEHEIM: "e2e-".repeat(10), POORT: "3464", PORTAAL_MAP: new URL("../dist", import.meta.url).pathname },
  stdio: ["ignore", "ignore", "inherit"],
  detached: true,
});
const stopApi = () => { try { process.kill(-api.pid); } catch {} };
for (let i = 0; i < 40; i++) {
  try { if ((await fetch(`${BASIS}/gezondheid`)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 250));
}

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: "nl-NL" });
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("  PAGINAFOUT", e.message); fouten++; });
const shot = (naam) => page.screenshot({ path: `${SHOTS}/${naam}.png` });
const inloggen = async (naam) => {
  await page.goto(`${BASIS}/portaal/#/login`);
  await page.getByLabel("Gebruikersnaam").fill(naam);
  await page.getByLabel("Wachtwoord").fill("demo");
  await page.getByRole("button", { name: "Inloggen" }).click();
};

try {
  console.log("\nBeheer");
  await inloggen("beheerder1");
  await page.getByRole("link", { name: "Grondstoffen" }).click();
  await page.getByRole("heading", { name: "Grondstoffen" }).waitFor();
  check("Drie fictieve grondstoffen", (await page.locator("tbody tr").count()) === 3);
  await page.getByRole("button", { name: "Grondstof toevoegen" }).click();
  await page.getByRole("dialog").getByLabel("Code").fill("GS-D");
  await page.getByRole("dialog").getByLabel("Naam").fill("Grondstof D");
  await page.getByRole("dialog").getByLabel(/Eenheid/).fill("kg");
  await page.getByRole("dialog").getByRole("button", { name: "Toevoegen" }).click();
  await page.locator("tr", { hasText: "GS-D" }).waitFor();
  await page.locator("tr", { hasText: "GS-D" }).getByRole("button", { name: "Stappen kiezen" }).click();
  await page.getByRole("dialog").getByLabel("PS5 Process Step 5").selectOption("verplicht");
  await page.getByRole("dialog").getByLabel("PS6 Process Step 6").selectOption("mag");
  await page.getByRole("dialog").getByRole("button", { name: "Opslaan" }).click();
  await page.locator("tr", { hasText: "GS-D" }).getByText("PS5, PS6 (mag)").waitFor();
  check("GS-D in PS5 (verplicht) en PS6 (mag)", true);
  await page.screenshot({ path: `${SHOTS}/01-beheer.png`, fullPage: true });
  const [cfg] = await q("SELECT count(*)::int AS n FROM fabriek.stap_grondstof x JOIN fabriek.grondstof g ON g.id = x.grondstof_id WHERE g.code = 'GS-D' AND x.actief");
  check("Koppeling in de database", cfg.n === 2);
  const [log] = await q("SELECT count(*)::int AS n FROM fabriek.config_log WHERE tabel IN ('grondstof', 'stap_grondstof') AND gewijzigd_door = 'beheerder1'");
  check("Wijzigingen staan in het logboek", log.n >= 3);

  console.log("\nKwaliteit");
  await page.evaluate(() => localStorage.clear());
  await inloggen("kwaliteit1");
  await page.getByRole("link", { name: "Grondstoffen terugzoeken" }).click();
  await page.getByRole("heading", { name: "Laatst gebruikte partijen" }).waitFor();
  const partij = (await q("SELECT partij FROM fabriek.grondstof_gebruik ORDER BY ingevoerd_op LIMIT 1"))[0].partij;
  const [verwacht] = await q(`SELECT count(DISTINCT r.batch_id)::int AS b FROM fabriek.grondstof_gebruik u JOIN fabriek.stapregistratie r ON r.id = u.stapregistratie_id WHERE u.partij = $1`, [partij]);
  await page.getByLabel("Partijnummer").fill(partij);
  await page.locator(".tegel", { hasText: /batch/ }).first().waitFor();
  const tegel = await page.locator(".tegel").first().innerText();
  check(`Partij ${partij}: aantal batches klopt`, tegel.startsWith(String(verwacht.b)), tegel);
  await page.screenshot({ path: `${SHOTS}/02-terugzoeken.png`, fullPage: true });
  await page.locator("tbody tr a[href*='lotpaspoort']").first().click();
  await page.getByRole("heading", { name: "Grondstoffen" }).waitFor();
  check("Lotpaspoort toont 4 batches x 3 grondstoffen", (await page.locator("section", { hasText: "Grondstoffen" }).locator("tbody tr").count()) === 12);
  await page.locator("section", { hasText: "Grondstoffen" }).screenshot({ path: `${SHOTS}/03-lotpaspoort.png` });
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
