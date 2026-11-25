// Test van het certificaat per lot in Chrome, op data van tools/genereer_testdata.py.
// Gebruik: node e2e/certificaat.mjs   (start zelf de API op poort 3466)
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import pg from "pg";

const DB = process.env.DATABASE_URL ?? "postgres://postgres@localhost/batchgui?host=/tmp&port=5433";
const APP_DB = process.env.TEST_APP_DATABASE_URL;
if (!APP_DB || APP_DB === DB) throw new Error("TEST_APP_DATABASE_URL moet een afzonderlijke beperkte MES-testverbinding zijn");
const SHOTS = process.env.SHOTS ?? "/tmp/shots-certificaat";
const BASIS = "http://localhost:3466";
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
  env: { ...process.env, DATABASE_URL: APP_DB, JWT_GEHEIM: "e2e-".repeat(10), POORT: "3466", PORTAAL_MAP: new URL("../dist", import.meta.url).pathname },
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
  console.log("\nKwaliteit geeft een certificaat uit");
  // Een lot dat gereed is en waarvan alle kenmerken binnen de specificatie vallen.
  const goedLot = `SELECT l.lotnummer FROM fabriek.lot l WHERE l.status = 'gereed'
      AND NOT EXISTS (SELECT 1 FROM fabriek.batch b WHERE b.lot_id = l.id AND b.status = 'afgekeurd')
      AND NOT EXISTS (SELECT 1 FROM fabriek.waarde_actueel w JOIN fabriek.stapregistratie r ON r.id = w.stapregistratie_id
                        JOIN fabriek.veld v ON v.id = w.veld_id LEFT JOIN fabriek.batch b ON b.id = r.batch_id
                       WHERE v.op_certificaat AND w.markering = 'buiten_grens' AND (r.lot_id = l.id OR b.lot_id = l.id))
        AND (SELECT p.code FROM fabriek.product p WHERE p.id = fabriek.lot_product(l.id)) = $1
      ORDER BY l.lotnummer DESC LIMIT 1`;
  const [lot] = await q(goedLot, ["PRD-A"]);
  await inloggen("kwaliteit1");
  await page.getByRole("heading", { name: "Kwaliteit", exact: true }).waitFor();
  await page.goto(`${BASIS}/portaal/#/kwaliteit/lotpaspoort/${lot.lotnummer}`);
  await page.getByRole("link", { name: "Certificaat" }).click();
  await page.getByRole("heading", { name: `Certificaat ${lot.lotnummer} (concept)` }).waitFor();
  check("Concept met 5 kenmerken", (await page.locator(".cert-tabel tbody tr").count()) === 5);
  check("Alle kenmerken voldoen", (await page.locator(".cert-tabel td", { hasText: "✓ Ja" }).count()) === 5);
  check("Concept-watermerk", await page.locator(".certificaat.concept").isVisible());
  await page.getByRole("button", { name: "Uitgeven" }).click();
  await page.getByRole("heading", { name: /^Certificaat nr\. \d+$/ }).waitFor();
  const [c] = await q("SELECT nummer, (inhoud->>'lotnummer') AS lot FROM fabriek.certificaat ORDER BY nummer DESC LIMIT 1");
  check("Uitgegeven en bewaard in de database", c.lot === lot.lotnummer);
  check("Uitgegeven certificaat zonder watermerk, met nummer", !(await page.locator(".certificaat.concept").count()) && (await page.locator(".cert-nummer").innerText()) === `Nr. ${c.nummer}`);
  await page.emulateMedia({ media: "print" });
  await page.screenshot({ path: `${SHOTS}/01-certificaat-print.png`, fullPage: true });
  check("Bij afdrukken alleen het certificaat (geen menu of knoppen)", !(await page.locator("#menu").isVisible()) && !(await page.getByRole("button", { name: "Afdrukken of pdf" }).isVisible()));
  await page.emulateMedia({ media: "screen" });

  console.log("\nLot van een product met een andere route (D55)");
  // PRD-C slaat PS17 over: het kenmerk uit PS17 hoort dan niet op het certificaat.
  const [lotC] = await q(goedLot, ["PRD-C"]);
  const [{ n: nC }] = await q(`SELECT count(*)::int AS n FROM fabriek.veld v WHERE v.op_certificaat AND v.actief
      AND fabriek.in_route((SELECT id FROM fabriek.product WHERE code = 'PRD-C'), v.processtap_id)`);
  await page.goto(`${BASIS}/portaal/#/kwaliteit/certificaat/${lotC.lotnummer}`);
  await page.getByRole("heading", { name: `Certificaat ${lotC.lotnummer} (concept)` }).waitFor();
  // 4 kenmerken uit de processtappen plus de 3 van de eindkeuring (#80).
  check(`PRD-C: alleen de ${nC} kenmerken uit zijn route, en ze voldoen allemaal`, nC === 7 && (await page.locator(".cert-tabel tbody tr").count()) === nC
    && (await page.locator(".cert-tabel td", { hasText: "✓ Ja" }).count()) === nC);
  check("PRD-C: getoetst aan de specificaties, met versie", (await page.locator(".certificaat").innerText()).includes("specificatie Eindkeuring versie 1"));
  check("PRD-C: geen PS17 op het certificaat", !(await page.locator(".cert-tabel").innerText()).includes("PS17"));

  console.log("\nLot dat niet gereed is");
  const [open] = await q("SELECT lotnummer FROM fabriek.lot WHERE status = 'in_productie' LIMIT 1");
  if (open) {
    await page.goto(`${BASIS}/portaal/#/kwaliteit/certificaat/${open.lotnummer}`);
    await page.getByRole("heading", { name: `Certificaat ${open.lotnummer} (concept)` }).waitFor();
    check("Uitgeven kan niet als het lot niet gereed is", await page.getByRole("button", { name: "Uitgeven" }).isDisabled());
  }

  console.log("\nBeheer");
  await page.evaluate(() => localStorage.clear());
  await inloggen("beheerder1");
  await page.getByRole("heading", { name: "Stappen en velden" }).waitFor();
  await page.getByRole("link", { name: "Bedrijfsgegevens" }).click();
  await page.getByLabel("Bedrijfsnaam").fill("Testfabriek (fictief)");
  await page.getByRole("button", { name: "Opslaan" }).click();
  await page.locator("#melding", { hasText: "Opgeslagen" }).waitFor();
  await page.goto(`${BASIS}/portaal/#/kwaliteit/certificaat/${lot.lotnummer}`);
  await page.locator(".cert-bedrijf", { hasText: "Testfabriek (fictief)" }).waitFor();
  check("Nieuwe bedrijfsnaam op het concept", true);
  await page.goto(`${BASIS}/portaal/#/kwaliteit/certificaat/${lot.lotnummer}/${c.nummer}`);
  await page.locator(".cert-bedrijf").waitFor();
  check("Uitgegeven certificaat blijft zoals het was", (await page.locator(".cert-bedrijf").innerText()) === "Voorbeeldfabriek B.V. (fictief)");
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
