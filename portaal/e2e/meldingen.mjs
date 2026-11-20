// Test van meldingen in Chrome, op data van tools/genereer_testdata.py.
// Gebruik: node e2e/meldingen.mjs   (start zelf de API op poort 3465)
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import pg from "pg";

const DB = process.env.DATABASE_URL ?? "postgres://postgres@localhost/batchgui?host=/tmp&port=5433";
const SHOTS = process.env.SHOTS ?? "/tmp/shots-meldingen";
const BASIS = "http://localhost:3465";
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
  env: { ...process.env, DATABASE_URL: DB, JWT_GEHEIM: "e2e-".repeat(10), POORT: "3465", PORTAAL_MAP: new URL("../dist", import.meta.url).pathname },
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
  // Na het inloggen de startpagina (D54); de test gaat verder in het portaal van de rol.
  if (await page.locator(".startpagina").waitFor({ timeout: 8000 }).then(() => true, () => false)) await page.locator(`.starttegel-${await page.evaluate(() => {
    const rol = JSON.parse(atob(localStorage.getItem("portaal.token").split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).rol;
    return { ploegleider: "productie", beheerder: "beheer", planner: "planning" }[rol] ?? "kwaliteit";
  })}`).click();
};

try {
  console.log("\nKwaliteit");
  await inloggen("kwaliteit1");
  await page.locator(".menu-meldingen").waitFor();
  const [{ n }] = await q(`SELECT count(*)::int AS n FROM fabriek.melding m WHERE m.voor_rollen @> ARRAY['kwaliteit'] AND m.aangemaakt_op > now() - interval '30 days'
                             AND NOT EXISTS (SELECT 1 FROM fabriek.melding_gelezen g JOIN fabriek.gebruiker u ON u.id = g.gebruiker_id WHERE g.melding_id = m.id AND u.gebruikersnaam = 'kwaliteit1')`);
  await page.waitForFunction((x) => document.querySelector(".menu-meldingen .teller")?.textContent === String(x), n);
  check(`Teller in het menu toont ${n} ongelezen`, n > 0, String(n));
  await page.locator(".menu-meldingen").click();
  await page.getByRole("heading", { name: "Meldingen" }).waitFor();
  await page.locator(".melding-rij").first().waitFor();
  check("Lijst met ongelezen meldingen", (await page.locator(".melding-rij").count()) === Math.min(n, 200));
  await page.screenshot({ path: `${SHOTS}/01-meldingen.png`, fullPage: true });
  await page.locator(".melding-rij").first().getByRole("button", { name: "Gelezen" }).click();
  await page.waitForFunction((x) => document.querySelector(".menu-meldingen .teller")?.textContent === String(x - 1) || (x === 1 && document.querySelector(".menu-meldingen .teller")?.textContent === ""), n);
  check("Gelezen: teller één lager", true);

  console.log("\nNieuwe melding");
  const [b] = await q("SELECT batchnummer FROM fabriek.batch WHERE status = 'in_productie' ORDER BY batchnummer LIMIT 1");
  await q(`INSERT INTO fabriek.batch_besluit (batch_id, besluit, reden, besloten_door)
           SELECT b.id, 'in_beoordeling', 'e2e: kleur wijkt af', g.id FROM fabriek.batch b, fabriek.gebruiker g
            WHERE b.batchnummer = $1 AND g.gebruikersnaam = 'ploegleider1'`, [b.batchnummer]);
  await page.goto(`${BASIS}/portaal/#/kwaliteit/overzicht`);
  await page.locator("#melding", { hasText: "Nieuwe melding" }).waitFor({ timeout: 10000 });
  check("Nieuwe melding verschijnt onderin beeld", (await page.locator("#melding").innerText()).includes(b.batchnummer));
  await page.locator(".menu-meldingen").click();
  await page.locator(".melding-rij", { hasText: "e2e: kleur wijkt af" }).getByRole("link", { name: "Bekijken" }).click();
  await page.waitForFunction((nr) => location.hash === `#/kwaliteit/batch/${nr}`, b.batchnummer);
  check("Bekijken opent de batch", true);
  await page.locator(".menu-meldingen").click();
  await page.getByRole("button", { name: "Alles gelezen" }).click();
  await page.getByText("Geen ongelezen meldingen.").waitFor();
  check("Alles gelezen: lijst leeg, teller weg", (await page.locator(".menu-meldingen .teller").innerText()) === "");

  console.log("\nRollen");
  await page.evaluate(() => localStorage.clear());
  await inloggen("beheerder1");
  await page.getByRole("heading", { name: "Stappen en velden" }).waitFor();
  check("Beheerder ziet ook meldingen", await page.locator(".menu-meldingen").isVisible());
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
