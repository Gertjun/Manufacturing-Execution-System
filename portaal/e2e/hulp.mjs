import { stopTestApi } from "../../tests/screen-api-lifecycle.mjs";
// Regressie bestaande hulpweergave (D59); inhoudelijke MES-rolhandleidingen uitgesteld naar fase 9 (D99).
// Gebruik: node e2e/hulp.mjs   (start zelf de API op poort 3470; vraagt de testaccounts van seed_accounts_demo.sql)
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const DB = process.env.DATABASE_URL ?? "postgres://postgres@localhost/batchgui?host=/tmp&port=5433";
const APP_DB = process.env.TEST_APP_DATABASE_URL;
if (!APP_DB || APP_DB === DB) throw new Error("TEST_APP_DATABASE_URL moet een afzonderlijke beperkte MES-testverbinding zijn");
const SHOTS = process.env.SHOTS ?? "/tmp/shots-hulp";
const BASIS = "http://localhost:3470";
mkdirSync(SHOTS, { recursive: true });

let fouten = 0;
const check = (naam, ok, extra = "") => {
  console.log(`${ok ? "  OK  " : "  FOUT"} ${naam}${!ok && extra ? `  [${extra}]` : ""}`);
  if (!ok) fouten++;
};

const api = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
  cwd: new URL("../../api/", import.meta.url).pathname,
  env: { ...process.env, DATABASE_URL: APP_DB, JWT_GEHEIM: "e2e-".repeat(10), POORT: "3470", PORTAAL_MAP: new URL("../dist", import.meta.url).pathname },
  stdio: ["ignore", "ignore", "inherit"],
  detached: true,
});
const stopApi = () => stopTestApi(api);
for (let i = 0; i < 40; i++) {
  try { if ((await fetch(`${BASIS}/gezondheid`)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 250));
}

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "nl-NL", timezoneId: "Europe/Amsterdam" });
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("  PAGINAFOUT", e.message); fouten++; });
const paginas = (pdf) => (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;

try {
  console.log("\nPortalen: hulp per rol");
  await page.goto(`${BASIS}/portaal/#/login`);
  await page.getByLabel("Gebruikersnaam").fill("beheerder1");
  await page.getByLabel("Wachtwoord").fill("demo");
  await page.getByRole("button", { name: "Inloggen" }).click();
  await page.locator(".startpagina").waitFor();
  await page.getByRole("link", { name: "Hulp voor jouw rol" }).click();
  await page.locator(".hulp h1").waitFor();
  check("Vanaf de startpagina: hulp voor de eigen rol", (await page.locator(".hulp h1").innerText()) === "Hulp voor de beheerder");
  check("Hulp staat ook in het menu", (await page.locator("#menu a", { hasText: "Hulp" }).count()) === 1);
  const rollen = await page.locator("#hulp-rol option").evaluateAll((os) => os.map((o) => o.value));
  check("Keuze uit alle rollen met hulp", rollen.join(",") === "operator,ploegleider,kwaliteit,productiemanager,planner,beheerder,analist", rollen.join(","));
  await page.selectOption("#hulp-rol", "planner");
  await page.waitForFunction(() => location.hash === "#/hulp/planner");
  check("Andere rol kiezen", (await page.locator(".hulp h1").innerText()) === "Hulp voor de planner");
  for (const rol of rollen) {
    await page.selectOption("#hulp-rol", rol);
    await page.waitForFunction((r) => location.hash === `#/hulp/${r}` && document.querySelector("#hulp-rol")?.value === r, rol);
    const pdf = await page.pdf({ format: "A4", preferCSSPageSize: true, printBackground: false });
    writeFileSync(`${SHOTS}/hulp-${rol}.pdf`, pdf);
    const n = paginas(pdf);
    check(`Afgedrukt: hulp voor ${rol} past op één A4`, n === 1, `${n} pagina's`);
  }
  if (process.env.MES_SCREENSHOTS === "review") await page.screenshot({ path: `${SHOTS}/portaal-hulp.png`, fullPage: true });

  console.log("\nInvoerscherm: hulp, ook zonder inlog");
  await page.goto(`${BASIS}/portaal/#/start`);
  await page.locator(".startpagina").waitFor();
  await page.getByRole("button", { name: "Afmelden" }).click();
  await page.getByLabel("Gebruikersnaam").waitFor();
  await page.goto(`${BASIS}/invoer/`);
  const pc = page.getByRole("button", { name: /^PC-01/ });
  await Promise.race([pc.waitFor(), page.getByLabel("Gebruikersnaam").waitFor()]);
  if (await pc.isVisible()) await pc.click();
  await page.getByLabel("Gebruikersnaam").waitFor();
  await page.getByRole("link", { name: "Hulp" }).click();
  await page.locator(".hulp h1").waitFor();
  check("Vanaf het inlogscherm: hulp voor operators", (await page.locator(".hulp h1").innerText()) === "Hulp voor operators");
  await page.getByRole("button", { name: "Terug" }).click();
  await page.getByLabel("Gebruikersnaam").fill("ploegleider1");
  await page.getByLabel("Wachtwoord").fill("demo");
  await page.getByRole("button", { name: "Inloggen" }).click();
  await page.locator(".balk-nav").waitFor();
  await page.locator(".balk-nav").getByRole("link", { name: "Hulp" }).click();
  await page.locator(".hulp h1").waitFor();
  check("Ingelogd als ploegleider: hulp voor ploegleiders", (await page.locator(".hulp h1").innerText()) === "Hulp voor ploegleiders");
  if (process.env.MES_SCREENSHOTS === "review") await page.screenshot({ path: `${SHOTS}/invoer-hulp.png`, fullPage: true });
  await page.emulateMedia({ media: "print" });
  check("Bij afdrukken staan balk en knoppen er niet op", !(await page.locator("#balk").isVisible()) && !(await page.locator(".hulp-keuze").isVisible()));
  await page.emulateMedia({ media: "screen" });

  console.log("\nInvoerscherm: hulp zonder verbinding");
  await context.setOffline(true);
  await page.getByRole("button", { name: "Terug" }).click();
  await page.locator(".balk-nav").waitFor();
  await page.locator(".balk-nav").getByRole("link", { name: "Hulp" }).click();
  await page.locator(".hulp h1").waitFor();
  check("Hulp opent zonder verbinding", (await page.locator(".hulp h1").innerText()) === "Hulp voor ploegleiders");
  await context.setOffline(false);
} catch (e) {
  console.log("  AFGEBROKEN", e.message.split("\n")[0]);
  await page.screenshot({ path: `${SHOTS}/fout.png` }).catch(() => {});
  fouten++;
} finally {
  if (fouten > 0) await page.screenshot({ path: `${SHOTS}/fout-eind.png` }).catch(() => {});
  await browser.close();
  await stopApi();
}
console.log(fouten ? `\n${fouten} fout(en)` : "\nAlles geslaagd");
process.exit(fouten ? 1 : 0);
