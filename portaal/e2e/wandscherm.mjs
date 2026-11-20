// Test van het wandscherm in Chrome, op data van tools/genereer_testdata.py.
// Gebruik: node e2e/wandscherm.mjs   (start zelf de API op poort 3463)
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import pg from "pg";

const DB = process.env.DATABASE_URL ?? "postgres://postgres@localhost/batchgui?host=/tmp&port=5433";
const SHOTS = process.env.SHOTS ?? "/tmp/shots-wandscherm";
const BASIS = "http://localhost:3463";
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
  env: { ...process.env, DATABASE_URL: DB, JWT_GEHEIM: "e2e-".repeat(10), POORT: "3463", PORTAAL_MAP: new URL("../dist", import.meta.url).pathname },
  stdio: ["ignore", "ignore", "inherit"],
  detached: true,
});
const stopApi = () => { try { process.kill(-api.pid); } catch {} };
for (let i = 0; i < 40; i++) {
  try { if ((await fetch(`${BASIS}/gezondheid`)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 250));
}

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: "nl-NL", timezoneId: "Europe/Amsterdam" });
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
  console.log("\nSchermaccount");
  await inloggen("scherm1");
  await page.getByRole("heading", { name: "Vandaag in de fabriek" }).waitFor();
  check("Schermaccount komt direct op het wandscherm", page.url().includes("#/wandscherm"));
  check("Geen menu op het wandscherm", !(await page.locator("#menu").isVisible()));
  check("18 stappen", (await page.locator(".wand-stap").count()) === 18);
  const bezig = Number((await q("SELECT count(*) FROM fabriek.stapregistratie WHERE status = 'open'"))[0].count);
  check("Alles wat bezig is staat erop", (await page.locator(".wr-bezig").count()) === Math.min(bezig, 999), `${bezig}`);
  check("Geen links naar andere hallen of portalen voor het schermaccount", (await page.locator(".wand-hallen").count()) === 0);
  check("Lopende storing staat op de kaart van PS7", (await page.locator(".wand-stap-stil").count()) === 1 && (await page.locator(".wand-stap-stil .wand-code").innerText()) === "7");
  await shot("01-wandscherm");
  await page.goto(`${BASIS}/portaal/#/kwaliteit`);
  await page.waitForFunction(() => location.hash === "#/wandscherm");
  check("Schermaccount kan niet naar een portaal", true);

  console.log("\nPer hal");
  await q(`INSERT INTO fabriek.pc_stap (pc_id, processtap_id)
           SELECT p.id, s.id FROM fabriek.pc p, fabriek.processtap s WHERE p.locatie = 'Hal 1' AND s.code IN ('PS1','PS2','PS3')`);
  await page.evaluate(() => localStorage.clear());
  await inloggen("ploegleider1");
  await page.getByRole("heading", { name: "Productie" }).first().waitFor();
  await page.goto(`${BASIS}/portaal/#/`);
  await page.locator(".starttegel-wandscherm").click();
  await page.getByRole("heading", { name: "Vandaag in de fabriek" }).waitFor();
  await page.getByRole("link", { name: "Hal 1" }).click();
  await page.getByRole("heading", { name: "Vandaag in Hal 1" }).waitFor();
  check("Hal 1 toont alleen de stappen van de pc's daar", (await page.locator(".wand-stap").count()) === 3);
  await shot("02-hal1");
  await page.getByRole("link", { name: "Terug naar de portalen" }).click();
  await page.locator("#menu").waitFor({ state: "visible" });
  check("Terug naar de portalen toont het menu weer", true);
  await q("DELETE FROM fabriek.pc_stap WHERE pc_id IN (SELECT id FROM fabriek.pc WHERE locatie = 'Hal 1')");

  console.log("\nVerbinding weg");
  await page.goto(`${BASIS}/portaal/#/wandscherm`);
  await page.locator(".wand-stap").first().waitFor();
  await page.route("**/wandscherm*", (r) => r.abort());
  await page.locator(".wand-storing").waitFor({ timeout: 40000 });
  check("Melding 'Geen verbinding', de laatste stand blijft staan", (await page.locator(".wand-stap").count()) === 18);
  await shot("03-geen-verbinding");
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
