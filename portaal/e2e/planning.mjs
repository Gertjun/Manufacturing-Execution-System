// Test van het Portaal Planning in Chrome.
// Zet de database opnieuw klaar (schema.sql + seed_config.sql + seed_accounts_demo.sql) met fictieve gegevens.
// Gebruik: node e2e/planning.mjs (API op poort 3462).
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright-core";
import pg from "pg";

const DB = process.env.DATABASE_URL ?? "postgres://postgres@localhost/batchgui?host=/tmp&port=5433";
const SHOTS = process.env.SHOTS ?? "/tmp/shots-planning";
const BASIS = "http://localhost:3462";
mkdirSync(SHOTS, { recursive: true });

let fouten = 0;
const check = (naam, ok, extra = "") => {
  console.log(`${ok ? "  OK  " : "  FOUT"} ${naam}${!ok && extra ? `  [${extra}]` : ""}`);
  if (!ok) fouten++;
};

const db = new pg.Client({ connectionString: DB });
await db.connect();
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
for (const f of ["schema.sql", "seed_config.sql", "seed_accounts_demo.sql"]) await db.query(readFileSync(new URL(`../../db/${f}`, import.meta.url), "utf8"));

const api = spawn("npx", ["tsx", "src/index.ts"], {
  cwd: new URL("../../api/", import.meta.url).pathname,
  env: { ...process.env, DATABASE_URL: DB, JWT_GEHEIM: "e2e-".repeat(10), POORT: "3462",
    PORTAAL_MAP: new URL("../dist", import.meta.url).pathname, INVOER_MAP: new URL("../../invoer/dist", import.meta.url).pathname },
  stdio: ["ignore", "ignore", "inherit"],
  detached: true,
});
const stopApi = () => { try { process.kill(-api.pid); } catch {} };
for (let i = 0; i < 40; i++) {
  try { if ((await fetch(`${BASIS}/gezondheid`)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 250));
}

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "nl-NL" });
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("  PAGINAFOUT", e.message); fouten++; });
const shot = (naam, fullPage = true) => page.screenshot({ path: `${SHOTS}/${naam}.png`, fullPage });
const dialoog = () => page.getByRole("dialog");
const inloggen = async (naam) => {
  await page.goto(`${BASIS}/portaal/#/login`);
  await page.getByLabel("Gebruikersnaam").fill(naam);
  await page.getByLabel("Wachtwoord").fill("demo");
  await page.getByRole("button", { name: "Inloggen" }).click();
};

try {
  console.log("\nPer week");
  await inloggen("planner1");
  await page.getByRole("heading", { name: /^Week van/ }).waitFor();
  check("Planner komt in het Portaal Planning", page.url().includes("#/planning"));

  await page.locator(".kop").getByRole("button", { name: "Batches plannen" }).click();
  await dialoog().getByLabel("Aantal batches").fill("6");
  await dialoog().getByLabel(/Product/).selectOption({ label: "PRD-A – Product A standaard" });
  await dialoog().getByRole("button", { name: "Plannen" }).click();
  await page.locator("#melding", { hasText: "gepland" }).waitFor();
  await page.locator(".dagkaart.vandaag .planrij").nth(5).waitFor();
  const nummers = await page.locator(".dagkaart.vandaag .planrij .sterk").allInnerTexts();
  check("Zes batches vandaag, doorlopend genummerd", nummers.length === 6 && /^B-\d{4}-0001$/.test(nummers[0]) && nummers[5].endsWith("0006"), nummers.join(" "));

  await page.getByRole("button", { name: `${nummers[1]} eerder` }).click();
  await page.locator("#melding", { hasText: "eerder" }).waitFor();
  await page.waitForFunction((n) => document.querySelector(".dagkaart.vandaag .planrij .sterk")?.textContent === n, nummers[1]);
  check("Volgorde verschoven", true);

  await page.locator(".planrij", { hasText: nummers[5] }).getByRole("button", { name: "Vervallen" }).click();
  await dialoog().getByLabel("Reden").fill("Order geannuleerd");
  await dialoog().getByRole("button", { name: "Laten vervallen" }).click();
  await page.locator(".planrij.vervallen", { hasText: nummers[5] }).waitFor();
  check("Batch vervallen, met reden zichtbaar", (await page.locator(".planrij.vervallen").innerText()).includes("Order geannuleerd"));
  await shot("01-week");

  console.log("\nEtiketten");
  await page.locator(".dagkaart.vandaag").getByRole("link", { name: "Etiketten" }).click();
  await page.getByRole("heading", { name: "5 etiketten" }).waitFor();
  const eerste = page.locator(".etiket").first();
  await eerste.screenshot({ path: `${SHOTS}/04-etiket.png`, scale: "device" });
  const gelezen = execFileSync("python3", ["-c", `
import sys
from PIL import Image
from pyzbar.pyzbar import decode
img = Image.open(sys.argv[1]).convert("L")
img = img.resize((img.width * 3, img.height * 3))
print(",".join(d.data.decode() for d in decode(img)))`, `${SHOTS}/04-etiket.png`]).toString().trim();
  check("Barcode op het etiket is leesbaar en klopt", gelezen === nummers[1], `${gelezen} / ${nummers[1]}`);
  await page.getByLabel("Formaat").selectOption("a4");
  await page.locator(".etiket-a4").first().waitFor();
  await page.evaluate(() => { window.print = () => { window.__geprint = document.querySelectorAll("#print-etiketten .etiketten-vel-a4 .etiket").length; }; });
  await page.getByRole("button", { name: "Afdrukken" }).click();
  check("Afdrukken op A4: 5 etiketten op één vel", (await page.evaluate(() => window.__geprint)) === 5);
  await page.emulateMedia({ media: "print" });
  await shot("05-etiketten-print", false);
  await page.emulateMedia({ media: "screen" });
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await page.goto(`${BASIS}/portaal/#/planning/week`);
  await page.getByRole("heading", { name: /^Week van/ }).waitFor();

  console.log("\nPer stap");
  await page.locator(".dagkaart.vandaag").getByRole("link", { name: "Per stap" }).click();
  await page.locator(".stappenlijst a").filter({ has: page.locator(".code", { hasText: /^PS1$/ }) }).click();
  await page.getByRole("heading", { name: /^PS1 / }).waitFor();
  await page.getByRole("button", { name: "Toevoegen" }).click();
  await dialoog().getByLabel(new RegExp(nummers[0])).check();
  await dialoog().getByLabel(new RegExp(nummers[2])).check();
  await dialoog().getByRole("button", { name: "Kiezen" }).click();
  await page.locator("tr", { hasText: nummers[2] }).waitFor();
  await page.getByRole("button", { name: `${nummers[0]} later` }).click();
  await page.locator("#melding", { hasText: "Volgorde" }).waitFor();
  await page.waitForFunction((n) => document.querySelector("tbody tr strong")?.textContent === n, nummers[2]);
  const rijen = await page.locator("tbody tr strong").allInnerTexts();
  check("PS1 heeft 2 batches in de gekozen volgorde", rijen.join() === [nummers[2], nummers[0]].join(), rijen.join());
  check("Teller in de stappenlijst", (await page.locator(".stappenlijst a").filter({ has: page.locator(".code", { hasText: /^PS1$/ }) }).innerText()).includes("2"));
  await shot("02-per-stap");

  console.log("\nLotvoorstellen");
  await page.getByRole("link", { name: "Lotvoorstellen" }).click();
  await page.getByRole("button", { name: "Nieuw lotvoorstel" }).click();
  const kies = dialoog().getByRole("button", { name: "Kiezen" });
  check("Kiezen pas mogelijk bij 4 batches", await kies.isDisabled());
  for (const n of nummers.slice(0, 4)) await dialoog().getByLabel(new RegExp(n)).check();
  await kies.click();
  await dialoog().getByRole("button", { name: "Voorstel maken" }).click();
  await page.getByRole("heading", { name: "Lotvoorstel 1" }).waitFor();
  check("Voorstel 1 met 4 batches", (await page.locator(".voorstel-batches li").count()) === 4);
  await shot("03-lotvoorstellen");

  console.log("\nProducten");
  await page.getByRole("link", { name: "Producten" }).click();
  await page.getByRole("button", { name: "Product toevoegen" }).click();
  await dialoog().getByLabel("Code").fill("PRD-D");
  await dialoog().getByLabel("Naam").fill("Product D proef");
  await dialoog().getByRole("button", { name: "Toevoegen" }).click();
  await page.locator("tr", { hasText: "PRD-D" }).waitFor();
  check("Product toegevoegd", (await q("SELECT count(*)::int AS n FROM fabriek.product"))[0].n === 4);

  console.log("\nPloegleider kijkt mee");
  await page.evaluate(() => localStorage.clear());
  await inloggen("ploegleider1");
  await page.getByRole("heading", { name: "Productie" }).first().waitFor();
  await page.goto(`${BASIS}/portaal/#/planning/week`);
  await page.getByRole("heading", { name: /^Week van/ }).waitFor();
  check("Ploegleider ziet de planning zonder knoppen om te plannen",
    (await page.getByRole("button", { name: "Batches plannen" }).count()) === 0 && (await page.locator(".planrij").count()) === 6);
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
