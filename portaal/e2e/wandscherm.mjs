// Test van het wandscherm in Chrome, op data van tools/genereer_testdata.py.
// Gebruik: node e2e/wandscherm.mjs   (start zelf de API op poort 3463)
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import pg from "pg";

const DB = process.env.DATABASE_URL ?? "postgres://postgres@localhost/batchgui?host=/tmp&port=5433";
const APP_DB = process.env.TEST_APP_DATABASE_URL;
if (!APP_DB || APP_DB === DB) throw new Error("TEST_APP_DATABASE_URL moet een afzonderlijke beperkte MES-testverbinding zijn");
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
  env: { ...process.env, DATABASE_URL: APP_DB, JWT_GEHEIM: "e2e-".repeat(10), POORT: "3463", PORTAAL_MAP: new URL("../dist", import.meta.url).pathname },
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

};

try {
  // D99: uitgebreide productie-/kwaliteitsschermen zijn uitgesteld, niet de actieve stilstandweergave.
  await inloggen("scherm1");
  await page.getByRole("heading", { name: "Actieve stilstand", exact: true }).waitFor();
  check("Display opent uitsluitend het beperkte scherm", page.url().endsWith("#/wandscherm"));
  const verwacht = await q(`SELECT s.code AS stap,s.naam AS stapnaam,o.naam AS oorzaaknaam
    FROM fabriek.stilstand x JOIN fabriek.processtap s ON s.id=x.processtap_id
    JOIN fabriek.stilstand_oorzaak o ON o.id=x.oorzaak_id WHERE x.eind_op IS NULL ORDER BY s.volgorde`);
  check("Fictieve dataset bevat actieve stilstand", verwacht.length > 0);
  const regels = await page.locator("#scherm ul li").allInnerTexts();
  check("Actieve stilstanden komen overeen met database", regels.length === verwacht.length &&
    verwacht.every((r,i) => regels[i].startsWith([r.stap,r.stapnaam,r.oorzaaknaam].join(" · ")+" · ")), JSON.stringify(regels));
  check("Geen bedrijfsportalen voor display", await page.locator("#menu .menu-groep").count() === 0);
  await shot("01-beperkt-display");
  for (const pad of ["kwaliteit","productie","planning","beheer","wandscherm/stappen/PS3,PS7","wandscherm/kwaliteit","wandscherm/alle"]) {
    await page.goto(BASIS+"/portaal/#/"+pad);
    await page.waitForFunction(() => location.hash === "#/wandscherm");
    await page.getByRole("heading", { name: "Actieve stilstand" }).waitFor();
    check("Displayroute afgeschermd: "+pad, await page.locator("#menu .menu-groep").count() === 0);
  }
  const token = await page.evaluate(() => localStorage.getItem("portaal.token"));
  const headers = { authorization: "Bearer "+token, "content-type": "application/json" };
  for (const pad of ["/wandscherm","/wandscherm/kwaliteit","/analyse/afwijkingen","/werkvoorraad"]) {
    check("API weigert display: "+pad, (await fetch(BASIS+pad,{headers})).status === 403);
  }
  check("Display kan geen stilstand melden", (await fetch(BASIS+"/stilstand",{method:"POST",headers,body:JSON.stringify({stapcode:"PS1",oorzaak:"TEST"})})).status === 403);
  for (const [width,height] of [[1280,720],[1024,600]]) {
    await page.setViewportSize({width,height});
    check("Actieve stilstand blijft zichtbaar op "+width, await page.getByRole("heading",{name:"Actieve stilstand"}).isVisible());
  }
  await page.route("**/stilstand",r => r.abort());
  await page.getByRole("button",{name:"Vernieuwen"}).click();
  await page.locator("#scherm .foutmelding").waitFor();
  check("Verbindingsfout zichtbaar, geen verouderde actieve lijst", await page.locator("#scherm ul li").count() === 0);
  await page.unroute("**/stilstand");
  await page.reload();
  await page.getByRole("heading",{name:"Actieve stilstand"}).waitFor();
  await page.getByRole("button",{name:"Afmelden"}).click();
  await page.getByLabel("Gebruikersnaam").waitFor();
  check("Afmelden verwijdert displaytoken", await page.evaluate(() => localStorage.getItem("portaal.token") === null));
  await inloggen("ploegleider1");
  await page.locator(".starttegel-productie").waitFor();
  check("Persoonlijke ploegleider heeft geen displaytegel", await page.locator(".starttegel-wandscherm").count() === 0);
  await page.goto(BASIS+"/portaal/#/wandscherm");
  await page.waitForFunction(() => location.hash === "#/");
  await page.locator(".starttegel-productie").waitFor();
  check("Persoonlijke identiteit kan niet naar displayroute", await page.locator(".starttegel-productie").isVisible());
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
