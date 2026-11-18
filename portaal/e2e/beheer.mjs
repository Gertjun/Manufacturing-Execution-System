// Test van het Portaal Beheer in Chrome, plus de doorwerking op het invoerscherm.
// Verwacht: database met schema.sql + seed_config.sql (+ eventueel seed_demo.sql),
// en een gebouwd invoerscherm. Gebruik: node e2e/beheer.mjs (API op poort 3461).
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import pg from "pg";

const DB = process.env.DATABASE_URL ?? "postgres://postgres@localhost/batchgui?host=/tmp&port=5433";
const SHOTS = process.env.SHOTS ?? "/tmp/shots-beheer";
const BASIS = "http://localhost:3461";
mkdirSync(SHOTS, { recursive: true });

let fouten = 0;
const check = (naam, ok, extra = "") => {
  console.log(`${ok ? "  OK  " : "  FOUT"} ${naam}${!ok && extra ? `  [${extra}]` : ""}`);
  if (!ok) fouten++;
};

const api = spawn("npx", ["tsx", "src/index.ts"], {
  cwd: new URL("../../api/", import.meta.url).pathname,
  env: { ...process.env, DATABASE_URL: DB, JWT_GEHEIM: "e2e-".repeat(10), POORT: "3461",
    PORTAAL_MAP: new URL("../dist", import.meta.url).pathname, INVOER_MAP: new URL("../../invoer/dist", import.meta.url).pathname },
  stdio: ["ignore", "ignore", "inherit"],
  detached: true,
});
const stopApi = () => { try { process.kill(-api.pid); } catch {} };
const db = new pg.Client({ connectionString: DB });
await db.connect();
const q = async (sql, p = []) => (await db.query(sql, p)).rows;

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

try {
  console.log("\nStappen en velden");
  await page.goto(`${BASIS}/portaal/#/login`);
  await page.getByLabel("Gebruikersnaam").fill("beheerder1");
  await page.getByLabel("Wachtwoord").fill("demo");
  await page.getByRole("button", { name: "Inloggen" }).click();
  await page.getByRole("heading", { name: "Stappen en velden" }).waitFor();
  check("Beheerder komt in het Portaal Beheer", page.url().includes("#/beheer"));

  await page.locator(".stappenlijst a", { hasText: "PS3" }).click();
  await page.getByRole("heading", { name: "PS3 Process Step 3" }).waitFor();
  await page.getByRole("button", { name: "Naam wijzigen" }).click();
  await dialoog().getByLabel("Naam").fill("Mengen");
  await dialoog().getByRole("button", { name: "Opslaan" }).click();
  await page.getByRole("heading", { name: "PS3 Mengen" }).waitFor();
  check("Stap PS3 heet nu Mengen", true);

  await page.getByRole("button", { name: "Veld toevoegen" }).click();
  await dialoog().getByLabel("Soort veld").selectOption("overig");
  await dialoog().getByRole("button", { name: "Verder" }).click();
  await dialoog().getByLabel("Naam").fill("pH");
  await dialoog().getByLabel(/Ondergrens/).fill("8");
  await dialoog().getByLabel(/Bovengrens/).fill("6");
  await dialoog().getByRole("button", { name: "Veld toevoegen" }).click();
  await page.locator("#melding", { hasText: "ondergrens is hoger" }).waitFor();
  check("Ondergrens boven bovengrens wordt geweigerd", true);
  await page.getByRole("button", { name: "Veld toevoegen" }).click();
  await dialoog().getByLabel("Soort veld").selectOption("overig");
  await dialoog().getByRole("button", { name: "Verder" }).click();
  await dialoog().getByLabel("Naam").fill("pH");
  await dialoog().getByLabel(/Ondergrens/).fill("6");
  await dialoog().getByLabel(/Bovengrens/).fill("8,5");
  await dialoog().getByRole("button", { name: "Veld toevoegen" }).click();
  await page.locator("tr", { hasText: "S3.4" }).waitFor();
  check("Nieuw veld kreeg code S3.4", (await page.locator("tr", { hasText: "S3.4" }).innerText()).includes("6 tot 8,5"));

  await page.locator("tr", { hasText: "S3.1" }).getByRole("button", { name: "Wijzigen" }).click();
  await dialoog().getByLabel(/Tolerantie \(/).fill("8");
  await dialoog().getByRole("button", { name: "Opslaan" }).click();
  await page.locator("tr", { hasText: "S3.1" }).getByText("±8 °C").waitFor();
  check("Tolerantie S3.1 is 8", true);

  await page.locator("tr", { hasText: "S3.4" }).getByRole("button", { name: "Uitzetten" }).click();
  await dialoog().getByRole("button", { name: "Uitzetten" }).click();
  await page.locator("tr", { hasText: "S3.4" }).getByRole("button", { name: "Weer aanzetten" }).waitFor();
  await shot("01-stappen-en-velden");
  check("S3.4 staat uit", (await page.locator("tr", { hasText: "S3.4" }).innerText()).includes("(uit)"));

  console.log("\nAccounts");
  await page.getByRole("link", { name: "Accounts" }).click();
  await page.getByRole("button", { name: "Account toevoegen" }).click();
  await dialoog().getByLabel("Gebruikersnaam").fill("Kwaliteit 2");
  await dialoog().getByLabel("Rol").selectOption("kwaliteit");
  await dialoog().getByLabel("Wachtwoord").fill("geheim-123");
  await dialoog().getByRole("button", { name: "Account toevoegen" }).click();
  check("Ongeldige gebruikersnaam wordt meteen gemeld", await dialoog().isVisible());
  await dialoog().getByLabel("Gebruikersnaam").fill("kwaliteit2");
  await dialoog().getByRole("button", { name: "Account toevoegen" }).click();
  await page.locator("tr", { hasText: "kwaliteit2" }).waitFor();
  check("Eigen account kan zichzelf niet uitzetten", await page.locator("tr", { hasText: "beheerder1" }).getByRole("button", { name: "Uitzetten" }).isDisabled());
  await page.locator("tr", { hasText: "kwaliteit2" }).getByRole("button", { name: "Uitzetten" }).click();
  await dialoog().getByRole("button", { name: "Uitzetten" }).click();
  await page.locator("tr", { hasText: "kwaliteit2" }).getByRole("button", { name: "Weer aanzetten" }).waitFor();
  await shot("02-accounts");
  const [acc] = await q("SELECT actief FROM fabriek.gebruiker WHERE gebruikersnaam = 'kwaliteit2'");
  check("kwaliteit2 bestaat en staat uit", acc && acc.actief === false);

  console.log("\nOperators en pc's");
  await page.getByRole("link", { name: "Operators" }).click();
  await page.getByRole("button", { name: "Operator toevoegen" }).click();
  await dialoog().getByLabel("Naam").fill("Operator I");
  await dialoog().getByRole("button", { name: "Toevoegen" }).click();
  await page.locator("tr", { hasText: "Operator I" }).waitFor();
  await page.locator("tr", { hasText: "Operator H" }).getByRole("button", { name: "Uit de lijst halen" }).click();
  await page.locator("tr", { hasText: "Operator H" }).getByRole("button", { name: "Weer in de lijst" }).waitFor();
  check("Operator toegevoegd en een andere uit de lijst gehaald", true);

  await page.getByRole("link", { name: "Pc's" }).click();
  await page.locator("tr", { hasText: "PC-01" }).getByRole("button", { name: "Stappen kiezen" }).click();
  await dialoog().getByLabel(/PS3 Mengen/).check();
  await dialoog().getByLabel(/PS4 /).check();
  await dialoog().getByRole("button", { name: "Opslaan" }).click();
  await page.locator("tr", { hasText: "PC-01" }).getByText("PS3, PS4").waitFor();
  await shot("03-pcs");
  check("PC-01 bedient PS3 en PS4", true);

  console.log("\nLogboek");
  await page.getByRole("link", { name: "Logboek" }).click();
  await page.locator(".tabel tbody tr").first().waitFor();
  await shot("04-logboek");
  const log = await page.locator(".tabel").innerText();
  check("Logboek: naamwijziging stap", log.includes("naam: Process Step 3 naar Mengen"));
  check("Logboek: tolerantie 5 naar 8", log.includes("tolerantie: 5 naar 8"));
  check("Logboek: pc-koppeling", log.includes("PC-01: PS3") && log.includes("Stap toegevoegd aan de pc"));
  check("Logboek toont geen wachtwoord-hash", !log.includes("$2a$") && !log.includes("hash"));

  console.log("\nDoorwerking op het invoerscherm");
  const invoer = await context.newPage();
  await invoer.goto(`${BASIS}/invoer/`);
  await invoer.getByRole("button", { name: /^PC-01/ }).click();
  await invoer.getByLabel("Gebruikersnaam").fill("operator");
  await invoer.getByLabel("Wachtwoord").fill("demo");
  await invoer.getByRole("button", { name: "Inloggen" }).click();
  await invoer.getByRole("heading", { name: "Wie ben je?" }).waitFor();
  await invoer.getByRole("button", { name: "Operator A" }).waitFor();
  check("Operator I staat in de namenlijst, Operator H niet",
    (await invoer.getByRole("button", { name: "Operator I" }).count()) === 1 && (await invoer.getByRole("button", { name: "Operator H" }).count()) === 0);
  await invoer.getByRole("button", { name: "Operator I" }).click();
  await invoer.locator(".tegel").first().waitFor();
  const tegels = await invoer.locator(".tegel").allInnerTexts();
  check("PC-01 toont alleen PS3 (Mengen) en PS4", tegels.length === 2 && tegels[0].includes("Mengen"), tegels.join(" | "));
  await invoer.screenshot({ path: `${SHOTS}/05-invoer-pc01.png` });
  await invoer.close();
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
