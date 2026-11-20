// Test van de regelkaarten in Chrome, op data van tools/genereer_testdata.py.
// Gebruik: node e2e/regelkaarten.mjs   (start zelf de API op poort 3467)
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import pg from "pg";

const DB = process.env.DATABASE_URL ?? "postgres://postgres@localhost/batchgui?host=/tmp&port=5433";
const SHOTS = process.env.SHOTS ?? "/tmp/shots-regelkaarten";
const BASIS = "http://localhost:3467";
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
  env: { ...process.env, DATABASE_URL: DB, JWT_GEHEIM: "e2e-".repeat(10), POORT: "3467", PORTAAL_MAP: new URL("../dist", import.meta.url).pathname },
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
  console.log("\nOverzicht");
  await inloggen("kwaliteit1");
  await page.getByRole("heading", { name: "Kwaliteit", exact: true }).waitFor();
  await page.getByRole("link", { name: "Regelkaarten" }).click();
  await page.getByRole("heading", { name: "Regelkaarten" }).waitFor();
  await page.locator("tbody tr").first().waitFor();
  const [{ n }] = await q("SELECT count(*)::int AS n FROM fabriek.veld WHERE actief");
  check("Eén regel per actief veld", (await page.locator("tbody tr").count()) === n, String(n));
  await page.screenshot({ path: `${SHOTS}/01-overzicht.png`, fullPage: true });
  const eerste = page.locator("tbody tr").first();
  const signalen = Number(await eerste.locator("td").nth(3).innerText());
  check("Velden met signalen staan bovenaan", signalen > 0, String(signalen));

  console.log("\nEén regelkaart");
  await eerste.locator("a").click();
  await page.getByRole("heading", { name: /^Regelkaart S/ }).waitFor();
  await page.locator("svg.regelkaart").waitFor();
  const ruitjes = await page.locator("svg.regelkaart .rk-signaal").count();
  check("Signalen op de kaart als ruitjes", ruitjes === signalen, `${ruitjes} / ${signalen}`);
  check("Tabel met signalen", (await page.locator("section", { hasText: "Signalen" }).locator("tbody tr").count()) === Math.min(50, signalen));
  // Punten liggen soms dicht op elkaar; het raakvlak van de buurman mag erover liggen.
  await page.locator("svg.regelkaart .raakvlak").nth(0).hover({ force: true });
  await page.screenshot({ path: `${SHOTS}/02-regelkaart.png`, fullPage: true });
  await page.goto(`${BASIS}/portaal/#/kwaliteit/regelkaarten/S18.3`);
  await page.getByRole("heading", { name: /^Regelkaart S18\.3/ }).waitFor();
  await page.locator("svg.regelkaart").waitFor();
  check("Vochtgehalte: specificatie en Cpk", (await page.locator(".tegel", { hasText: "Cpk" }).count()) === 1);
  await page.screenshot({ path: `${SHOTS}/03-vocht.png`, fullPage: true });
  await page.getByLabel("Periode").selectOption("7");
  await page.getByText(/^Voorlopig: nog maar \d+ metingen/).waitFor();
  check("Weinig metingen (7 dagen): kaart is voorlopig en zonder Cpk", (await page.locator(".tegel", { hasText: "Cpk" }).count()) === 0);
  await page.screenshot({ path: `${SHOTS}/04-voorlopig.png`, fullPage: true });
  await page.getByLabel("Periode").selectOption("30");
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
