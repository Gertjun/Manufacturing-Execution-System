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
  check("21 stappen (18 processtappen en 3 keuringen)", (await page.locator(".wand-stap").count()) === 21);
  const bezig = Number((await q("SELECT count(*) FROM fabriek.stapregistratie WHERE status = 'open'"))[0].count);
  check("Alles wat bezig is staat erop", (await page.locator(".wr-bezig").count()) === Math.min(bezig, 999), `${bezig}`);
  check("Geen links naar andere hallen of portalen voor het schermaccount", (await page.locator(".wand-hallen").count()) === 0);
  check("Lopende storing staat op de kaart van PS7", (await page.locator(".wand-stap-stil").count()) === 1 && (await page.locator(".wand-stap-stil .wand-code").innerText()) === "7");
  await shot("01-wandscherm");
  await page.goto(`${BASIS}/portaal/#/kwaliteit`);
  await page.waitForFunction(() => location.hash === "#/wandscherm");
  check("Schermaccount kan niet naar een portaal", true);

  console.log("\nAltijd passend en eruit kunnen (#91)");
  const pastOpScherm = () => page.evaluate(() => { const s = document.getElementById("scherm"); return s.scrollHeight <= s.clientHeight + 1 && document.documentElement.scrollHeight <= innerHeight + 1; });
  await page.locator(".wand-stap").first().waitFor();
  check("Past zonder scrollen (groot scherm)", await pastOpScherm());
  for (const [b, hg] of [[1280, 720], [1024, 600]]) {
    await page.setViewportSize({ width: b, height: hg });
    await page.waitForTimeout(400);
    check(`Past zonder scrollen op ${b} × ${hg}`, await pastOpScherm(), await page.evaluate(() => `${document.getElementById("scherm").scrollHeight} > ${innerHeight}`));
  }
  await shot("01c-wandscherm-1024x600");
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.getByRole("button", { name: "Afmelden" }).click();
  await page.getByLabel("Gebruikersnaam").waitFor();
  check("Afmelden op het wandscherm: terug naar inloggen", page.url().includes("#/login"));
  await page.goto(`${BASIS}/`);
  await page.getByLabel("Gebruikersnaam").waitFor();
  check("Het adres van de server landt daarna op inloggen, niet op het wandscherm", !page.url().includes("wandscherm"), page.url());
  await inloggen("scherm1");
  await page.getByRole("heading", { name: "Vandaag in de fabriek" }).waitFor();

  console.log("\nPer stap (#54)");
  await page.goto(`${BASIS}/portaal/#/wandscherm/stappen/PS3,PS7`);
  await page.getByRole("heading", { name: "Vandaag in PS3, PS7" }).waitFor();
  check("Alleen PS3 en PS7, op grote kaarten", (await page.locator(".wand-stap").count()) === 2 && (await page.locator(".wand-raster.wand-n2").count()) === 1);
  const [{ n: bezig37 }] = await q(`SELECT count(*)::int AS n FROM fabriek.stapregistratie r JOIN fabriek.processtap s ON s.id = r.processtap_id
      WHERE r.status = 'open' AND s.code IN ('PS3','PS7')`);
  check("Cijfers gaan over deze stappen: bezig", Number(await page.locator(".wand-cijfer", { hasText: "bezig" }).locator(".wand-getal").innerText()) === bezig37, `${bezig37}`);
  await shot("01b-wandscherm-ps3-ps7");
  await page.goto(`${BASIS}/portaal/#/wandscherm`);
  await page.getByRole("heading", { name: "Vandaag in PS3, PS7" }).waitFor();
  check("De tv onthoudt de keuze (schermaccount)", page.url().endsWith("#/wandscherm/stappen/PS3,PS7"));
  await page.goto(`${BASIS}/portaal/#/wandscherm/stappen/PS99`);
  await page.locator(".wand-leeg", { hasText: "Onbekende" }).waitFor();
  check("Onbekende stap: duidelijke melding", true);
  await page.goto(`${BASIS}/portaal/#/wandscherm/alle`);
  await page.getByRole("heading", { name: "Vandaag in de fabriek" }).waitFor();
  await page.goto(`${BASIS}/portaal/#/wandscherm`);
  await page.getByRole("heading", { name: "Vandaag in de fabriek" }).waitFor();
  check("Met /alle vergeet de tv de keuze weer", (await page.locator(".wand-stap").count()) === 21);

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
  // Stappen kiezen via de knop onderin (#54).
  await page.goto(`${BASIS}/portaal/#/wandscherm`);
  await page.getByRole("button", { name: "Stappen kiezen" }).click();
  await page.getByRole("dialog").getByLabel("PS9 ", { exact: false }).first().check();
  await page.getByRole("dialog").getByRole("button", { name: "Tonen" }).click();
  await page.getByRole("heading", { name: /^Vandaag in PS9 / }).waitFor();
  check("Stappen kiezen: één stap op het hele scherm", (await page.locator(".wand-stap").count()) === 1 && page.url().endsWith("#/wandscherm/stappen/PS9"));
  await shot("02b-een-stap");
  await page.getByRole("link", { name: "Terug naar de portalen" }).click();
  await page.locator("#menu").waitFor({ state: "visible" });
  check("Terug naar de portalen toont het menu weer", true);
  await q("DELETE FROM fabriek.pc_stap WHERE pc_id IN (SELECT id FROM fabriek.pc WHERE locatie = 'Hal 1')");

  console.log("\nWandscherm Kwaliteit (#83)");
  await page.goto(`${BASIS}/portaal/#/wandscherm`);
  await page.getByRole("link", { name: "Kwaliteit", exact: true }).click();
  await page.getByRole("heading", { name: "Kwaliteit vandaag" }).waitFor();
  const [kw] = await q(`SELECT (SELECT count(*) FROM fabriek.keuring WHERE status = 'open')::int + (SELECT count(*) FROM fabriek.batch WHERE status = 'in_beoordeling')::int AS wacht,
                               (SELECT count(*) FROM fabriek.waarde_actueel WHERE ingevoerd_op >= current_date AND markering <> 'ok')::int AS afw`);
  const kaarten = page.locator(".wand-stap");
  check("Twee kaarten: wacht op Kwaliteit en afwijkingen vandaag", (await kaarten.count()) === 2);
  check("Wacht op Kwaliteit telt keuringen en beoordelingen", (await kaarten.nth(0).locator(".wand-voortgang").innerText()) === String(kw.wacht), JSON.stringify(kw));
  check("Afwijkingen vandaag kloppen met de database", (await kaarten.nth(1).locator(".wand-voortgang").innerText()) === String(kw.afw), JSON.stringify(kw));
  check("Kerncijfer wacht staat bovenaan", (await page.locator(".wand-cijfer").first().innerText()).startsWith(String(kw.wacht)));
  check("Hoogstens 10 regels per kaart", (await kaarten.nth(1).locator(".wr").count()) <= 10);
  await shot("04-kwaliteit");
  await page.getByRole("link", { name: "Fabriek" }).click();
  await page.getByRole("heading", { name: "Vandaag in de fabriek" }).waitFor();
  check("Terug naar het wandscherm van de fabriek", true);

  console.log("\nVerbinding weg");
  await page.goto(`${BASIS}/portaal/#/wandscherm`);
  await page.locator(".wand-stap").first().waitFor();
  await page.route("**/wandscherm*", (r) => r.abort());
  await page.locator(".wand-storing").waitFor({ timeout: 40000 });
  check("Melding 'Geen verbinding', de laatste stand blijft staan", (await page.locator(".wand-stap").count()) === 21);
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
