// Test van Nainvoeren na papier (#75, D60) in Chrome: een stap van papier invoeren en de lege formulieren afdrukken.
// Gebruik: node e2e/nalevering.mjs   (start zelf de API op poort 3471; vraagt de testaccounts van seed_accounts_demo.sql)
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import pg from "pg";
import { chromium } from "playwright-core";

const DB = process.env.DATABASE_URL ?? "postgres://postgres@localhost/batchgui?host=/tmp&port=5433";
const APP_DB = process.env.TEST_APP_DATABASE_URL;
if (!APP_DB || APP_DB === DB) throw new Error("TEST_APP_DATABASE_URL moet een afzonderlijke beperkte MES-testverbinding zijn");
const SHOTS = process.env.SHOTS ?? "/tmp/shots-nalevering";
const BASIS = "http://localhost:3471";
mkdirSync(SHOTS, { recursive: true });

let fouten = 0;
const check = (naam, ok, extra = "") => {
  console.log(`${ok ? "  OK  " : "  FOUT"} ${naam}${!ok && extra ? `  [${extra}]` : ""}`);
  if (!ok) fouten++;
};

const api = spawn("npx", ["tsx", "src/index.ts"], {
  cwd: new URL("../../api/", import.meta.url).pathname,
  env: { ...process.env, DATABASE_URL: APP_DB, JWT_GEHEIM: "e2e-".repeat(10), POORT: "3471", PORTAAL_MAP: new URL("../dist", import.meta.url).pathname },
  stdio: ["ignore", "ignore", "inherit"],
  detached: true,
});
const stopApi = () => { try { process.kill(-api.pid); } catch {} };
for (let i = 0; i < 40; i++) {
  try { if ((await fetch(`${BASIS}/gezondheid`)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
const db = new pg.Client({ connectionString: DB });
await db.connect();
await db.query("SET search_path = fabriek");

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "nl-NL", timezoneId: "Europe/Amsterdam" });
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("  PAGINAFOUT", e.message); fouten++; });
const paginas = (pdf) => (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
// datetime-local in de tijdzone van de browser (Europe/Amsterdam)
const lokaal = (ms) => new Date(ms).toLocaleString("sv-SE", { timeZone: "Europe/Amsterdam" }).replace(" ", "T").slice(0, 16);

try {
  // Een nieuwe batch, alsof hij aan het begin van de storing in het systeem stond.
  const login = await (await fetch(`${BASIS}/auth/login`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ gebruikersnaam: "operator.a", wachtwoord: "demo", pc: "PC-01" }) })).json();
  const nieuw = await fetch(`${BASIS}/batches`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${login.token}` },
    body: JSON.stringify({ batchnummer: "B-2026-9075" }) });
  check("Testbatch aangemaakt", nieuw.status === 201, String(nieuw.status));

  console.log("\nStartpagina");
  await page.goto(`${BASIS}/portaal/#/login`);
  await page.getByLabel("Gebruikersnaam").fill("ploegleider1");
  await page.getByLabel("Wachtwoord").fill("demo");
  await page.getByRole("button", { name: "Inloggen" }).click();
  await page.locator(".startpagina").waitFor();
  check("Ploegleider ziet de tegel Nainvoeren (papier)", (await page.locator(".starttegel-nainvoeren").count()) === 1);
  await page.locator(".starttegel-nainvoeren").click();
  await page.getByRole("heading", { name: "Nainvoeren van papier" }).waitFor();

  console.log("\nEen stap van papier nainvoeren");
  await page.selectOption("#na-stap", "PS1");
  await page.locator("#na-nummer").fill("b-2026-9075");
  await page.locator("#na-s-S1\\.1").fill("80");
  await page.locator("#na-g-S1\\.1").fill("81,5");
  await page.locator("#na-g-S1\\.2").fill("410");
  await page.locator("#na-p-GS-A").fill("LEV-PAPIER-E2E");
  await page.locator("#na-h-GS-A").fill("120");
  await page.selectOption("#na-wie", { label: "Operator D" });
  await page.selectOption("#na-pc", { label: "PC-04" });
  const nu = Date.now();
  const begin = lokaal(nu - 3 * 3600_000), eind = lokaal(nu - 2 * 3600_000);
  await page.locator("#na-begin").fill(begin);
  await page.locator("#na-eind").fill(eind);
  if (process.env.MES_SCREENSHOTS === "review") await page.screenshot({ path: `${SHOTS}/nainvoeren.png`, fullPage: true });
  await page.getByRole("button", { name: "Nainvoeren" }).click();
  await page.getByText("Geef een reden").waitFor();
  check("Zonder reden: melding, niets opgeslagen", true);
  await page.locator("#na-reden").fill("server en pc uit door stroomstoring");
  await page.getByRole("button", { name: "Nainvoeren" }).click();
  await page.getByText("PS1 van B-2026-9075 is nageleverd").waitFor();
  const { rows: [r] } = await db.query(`
    SELECT r.status, o.naam AS operator, p.naam AS pc, g.gebruikersnaam AS door, r.nageleverd_reden AS reden,
           to_char(r.gestart_op AT TIME ZONE 'Europe/Amsterdam', 'YYYY-MM-DD"T"HH24:MI') AS begin,
           to_char(r.afgerond_op AT TIME ZONE 'Europe/Amsterdam', 'YYYY-MM-DD"T"HH24:MI') AS eind,
           (SELECT gemeten FROM waarde w JOIN veld v ON v.id = w.veld_id WHERE w.stapregistratie_id = r.id AND v.code = 'S1.1')::float AS s11
      FROM stapregistratie r JOIN batch b ON b.id = r.batch_id JOIN processtap s ON s.id = r.processtap_id
      JOIN operator o ON o.id = r.operator_id JOIN pc p ON p.id = r.pc_id JOIN gebruiker g ON g.id = r.nageleverd_door
     WHERE b.batchnummer = 'B-2026-9075' AND s.code = 'PS1'`);
  check("In de database: afgerond, met naam, pc en tijden van het papier",
    r?.status === "afgerond" && r.operator === "Operator D" && r.pc === "PC-04" && r.begin === begin && r.eind === eind && r.s11 === 81.5, JSON.stringify(r));
  check("Nageleverd door ploegleider1, met de reden", r?.door === "ploegleider1" && r.reden === "server en pc uit door stroomstoring");
  check("Daarna staat de volgende stap klaar, met hetzelfde batchnummer en begin = vorig einde",
    (await page.locator("#na-stap").inputValue()) === "PS2" && (await page.locator("#na-nummer").inputValue()) === "B-2026-9075"
      && (await page.locator("#na-begin").inputValue()) === eind);
  // De volgende stap kan niet beginnen vóór het einde van de vorige.
  await page.locator("#na-begin").fill(lokaal(nu - 2.5 * 3600_000));
  await page.locator("#na-eind").fill(lokaal(nu - 3600_000));
  await page.getByRole("button", { name: "Nainvoeren" }).click();
  await page.getByText("vóór het einde van de vorige stap").waitFor();
  check("Begin vóór het einde van de vorige stap: melding van de database", true);

  console.log("\nLege formulieren");
  await page.getByRole("link", { name: "Lege formulieren afdrukken" }).click();
  await page.getByRole("heading", { name: "Lege formulieren" }).waitFor();
  const aantal = await page.locator(".papier").count();
  check("Alle stappen: één formulier per stap", aantal === 18, String(aantal));
  await page.emulateMedia({ media: "print" });
  let pdf = await page.pdf({ format: "A4", preferCSSPageSize: true });
  writeFileSync(`${SHOTS}/formulieren-alle.pdf`, pdf);
  check("Afgedrukt: één A4 per stap", paginas(pdf) === 18, `${paginas(pdf)} pagina's`);
  await page.emulateMedia({ media: "screen" });
  await page.selectOption("#form-stap", "PS16");
  await page.waitForFunction(() => document.querySelectorAll(".papier").length === 1);
  check("Formulier van de lot-stap vraagt lotnummer en 4 batches",
    (await page.locator(".papier").innerText()).includes("Nieuw lotnummer") && (await page.locator(".papier-vier .invul").count()) === 4);
  if (process.env.MES_SCREENSHOTS === "review") await page.screenshot({ path: `${SHOTS}/formulier-ps16.png`, fullPage: true });
  await page.emulateMedia({ media: "print" });
  pdf = await page.pdf({ format: "A4", preferCSSPageSize: true });
  writeFileSync(`${SHOTS}/formulier-ps16.pdf`, pdf);
  check("Eén stap: één A4", paginas(pdf) === 1, `${paginas(pdf)} pagina's`);
  await page.emulateMedia({ media: "screen" });

  console.log("\nRechten");
  await page.goto(`${BASIS}/portaal/#/start`);
  await page.getByRole("button", { name: "Afmelden" }).click();
  await page.getByLabel("Gebruikersnaam").fill("productiemanager1");
  await page.getByLabel("Wachtwoord").fill("demo");
  await page.getByRole("button", { name: "Inloggen" }).click();
  await page.locator(".startpagina").waitFor();
  check("Productiemanager ziet de tegel niet", (await page.locator(".starttegel-nainvoeren").count()) === 0);
  await page.goto(BASIS+"/portaal/#/nainvoeren");
  await page.waitForFunction(()=>location.hash==="#/");
  check("Rechtstreekse naleveringsroute geblokkeerd",await page.getByRole("heading",{name:"Nainvoeren van papier"}).count()===0);
} catch (e) {
  console.log("  AFGEBROKEN", e.message.split("\n")[0]);
  await page.screenshot({ path: `${SHOTS}/fout.png` }).catch(() => {});
  fouten++;
} finally {
  if (fouten > 0) await page.screenshot({ path: `${SHOTS}/fout-eind.png` }).catch(() => {});
  await browser.close();
  await db.end();
  stopApi();
}
console.log(fouten ? `\n${fouten} fout(en)` : "\nAlles geslaagd");
process.exit(fouten ? 1 : 0);
