// Test van de export naar Excel in Chrome, op data van tools/genereer_testdata.py.
// Gebruik: node e2e/excel.mjs   (start zelf de API op poort 3468)
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import pg from "pg";

const DB = process.env.DATABASE_URL ?? "postgres://postgres@localhost/batchgui?host=/tmp&port=5433";
const SHOTS = process.env.SHOTS ?? "/tmp/shots-excel";
const BASIS = "http://localhost:3468";
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
  env: { ...process.env, DATABASE_URL: DB, JWT_GEHEIM: "e2e-".repeat(10), POORT: "3468", PORTAAL_MAP: new URL("../dist", import.meta.url).pathname },
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
const libre = (pad) => execFileSync("soffice", ["--headless", "--convert-to", "csv", "--outdir", SHOTS, pad], { timeout: 120000 }).toString();
try {
  console.log("\nProductie: stilstand per stap");
  await inloggen("ploegleider1");
  await page.getByRole("heading", { name: "Productie" }).first().waitFor();
  await page.goto(`${BASIS}/portaal/#/productie/stilstand`);
  await page.getByRole("heading", { name: "Stilstand per stap" }).waitFor();
  const blok = page.locator("section", { hasText: "Stilstand per stap" });
  const [dl] = await Promise.all([page.waitForEvent("download"), blok.getByRole("button", { name: "Naar Excel" }).click()]);
  const pad = `${SHOTS}/${dl.suggestedFilename()}`;
  await dl.saveAs(pad);
  check("Bestandsnaam met de kop en de datum", /^Stilstand per stap \d{4}-\d{2}-\d{2}\.xlsx$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  const x = leesXlsx(pad);
  check("Blad heet zoals de tabel", x.blad === "Stilstand per stap", x.blad);
  check("Koppen en 18 stappen", x.rijen[0][0] === "Stap" && x.rijen.length === 19, JSON.stringify(x.rijen[0]));
  check("Aantallen zijn getallen in Excel", typeof x.rijen[1][1] === "number", JSON.stringify(x.rijen[1]));
  const csv = libre(pad);
  check("LibreOffice opent het bestand", /convert/.test(csv), csv.trim());

  console.log("\nKwaliteit: afwijkingen");
  await page.evaluate(() => localStorage.clear());
  await inloggen("kwaliteit1");
  await page.getByRole("heading", { name: "Kwaliteit", exact: true }).waitFor();
  await page.getByRole("link", { name: "Afwijkingen" }).click();
  await page.locator("tbody tr").first().waitFor();
  const zichtbaar = await page.locator("tbody tr").count();
  const [dl2] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Naar Excel" }).first().click()]);
  const pad2 = `${SHOTS}/${dl2.suggestedFilename()}`;
  await dl2.saveAs(pad2);
  const y = leesXlsx(pad2);
  check("Alle zichtbare regels in Excel", y.rijen.length - 1 === zichtbaar, `${y.rijen.length - 1} / ${zichtbaar}`);
  check("Geen knoppen in de export", !JSON.stringify(y.rijen).includes("Naar Excel"));
  await page.screenshot({ path: `${SHOTS}/01-afwijkingen.png` });
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
