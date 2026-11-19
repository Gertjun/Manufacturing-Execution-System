// End-to-end test van het invoerscherm in Chrome, inclusief offline invoer.
// Verwacht: database met seed_config.sql + seed_accounts_demo.sql + seed_demo.sql, en een gebouwde app (npm run build).
// Gebruik: node e2e/flow.mjs   (start zelf de API op poort 3456)
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import pg from "pg";

const DB = process.env.DATABASE_URL ?? "postgres://postgres@localhost/batchgui?host=/tmp&port=5433";
const SHOTS = process.env.SHOTS ?? "/tmp/shots";
const BASIS = "http://localhost:3456";
mkdirSync(SHOTS, { recursive: true });

let fouten = 0;
const check = (naam, ok, extra = "") => {
  console.log(`${ok ? "  OK  " : "  FOUT"} ${naam}${!ok && extra ? `  [${extra}]` : ""}`);
  if (!ok) fouten++;
};

const api = spawn("npx", ["tsx", "src/index.ts"], {
  cwd: new URL("../../api/", import.meta.url).pathname,
  env: { ...process.env, DATABASE_URL: DB, JWT_GEHEIM: "e2e-".repeat(10), POORT: "3456", INVOER_MAP: new URL("../dist", import.meta.url).pathname },
  stdio: ["ignore", "ignore", "inherit"],
  detached: true,
});
const stopApi = () => { try { process.kill(-api.pid); } catch {} };
const db = new pg.Client({ connectionString: DB });
await db.connect();
const q = async (sql, p = []) => (await db.query(`SET search_path = fabriek; ${sql}`.includes("$") ? sql : sql, p)).rows;
await db.query("SET search_path = fabriek");

for (let i = 0; i < 40; i++) {
  try { if ((await fetch(`${BASIS}/gezondheid`)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 250));
}

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: "nl-NL" });
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("  PAGINAFOUT", e.message); fouten++; });
const shot = (naam) => page.screenshot({ path: `${SHOTS}/${naam}.png`, fullPage: true });

try {
  console.log("\nStarten en inloggen");
  await page.goto(`${BASIS}/invoer/`);
  await page.getByRole("heading", { name: "Welke pc is dit?" }).waitFor();
  await shot("01-pc-kiezen");
  await page.getByRole("button", { name: /^PC-01/ }).click();
  await page.getByLabel("Gebruikersnaam").fill("operator");
  await page.getByLabel("Wachtwoord").fill("demo");
  await shot("02-inloggen");
  await page.getByRole("button", { name: "Inloggen" }).click();
  await page.getByRole("heading", { name: "Wie ben je?" }).waitFor();
  await shot("03-naam-kiezen");
  await page.getByRole("button", { name: "Operator A" }).click();
  await page.getByRole("heading", { name: "Kies een stap" }).waitFor();
  await page.locator(".verbinding", { hasText: "Verbonden" }).waitFor();
  await page.locator(".tegel").first().waitFor();
  await shot("04-stappen");
  check("Stappenoverzicht toont 18 stappen", (await page.locator(".tegel").count()) === 18);
  check("PS7 staat als bezig", (await page.locator(".tegel.bezig").count()) === 1);

  console.log("\nPlanning in PS1");
  await page.locator(".tegel", { hasText: "Process Step 1" }).first().click();
  await page.getByRole("heading", { name: "Gepland voor vandaag" }).waitFor();
  const plan = await page.locator(".plan .planlijst li").allInnerTexts();
  check("Planning van vandaag in volgorde, met opmerking", plan.length === 2 && plan[0].includes("B-2026-0008") && plan[0].includes("Spoed"), plan.join(" | "));
  const klaar = await page.locator("ul.lijst .rij-hoofd").allInnerTexts();
  check("Geplande batches staan klaar, in de volgorde van de planning", klaar[0]?.startsWith("B-2026-0008") && klaar[1]?.startsWith("B-2026-0007"), klaar.join(" | "));
  check("Ongeplande batch zit achter een uitklapper", !(await page.getByLabel("Nieuwe batch").isVisible()));
  await shot("04b-ps1-planning");
  await page.locator(".rij", { hasText: "B-2026-0008" }).getByRole("button", { name: "Start" }).click();
  await page.getByRole("heading", { name: "B-2026-0008" }).waitFor();
  await page.waitForTimeout(1200);
  const [gestart] = await q("SELECT status, gestart_op IS NOT NULL AS g FROM fabriek.batch WHERE batchnummer = 'B-2026-0008'");
  check("Geplande batch gestart: in productie", gestart.status === "in_productie" && gestart.g);
  await page.goto(`${BASIS}/invoer/#/stap/PS1`);
  await page.locator(".plan-bezig", { hasText: "B-2026-0008" }).waitFor();
  check("Planning toont de batch als bezig", true);

  console.log("\nNieuwe batch in PS1 met een afwijking");
  await page.getByText("Ongeplande batch aanmaken").click();
  await page.getByLabel("Nieuwe batch").fill("b-2026-0100");
  await page.getByRole("button", { name: "Aanmaken en starten" }).click();
  await page.getByRole("heading", { name: "B-2026-0100" }).waitFor();
  await page.locator("#s-S1\\.1").fill("80");
  await page.locator("#g-S1\\.1").fill("86,5");
  await page.locator("#g-S1\\.2").fill("410");
  await page.locator(".veld[data-markering='buiten_tolerantie']").waitFor();
  check("Afwijking zichtbaar tijdens typen", (await page.locator(".label-buiten_tolerantie", { hasText: "Buiten tolerantie" }).count()) === 1);
  await shot("05-formulier-ingevuld");
  await page.getByRole("button", { name: "Opslaan" }).click();
  await page.getByRole("dialog").waitFor();
  check("Bevestiging waarschuwt voor afwijking", await page.getByText("1 waarde wijkt af").isVisible());
  await shot("06-bevestigen");
  await page.getByRole("dialog").getByRole("button", { name: "Opslaan" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".label-wacht").length === 0, null, { timeout: 8000 }).catch(() => {});
  await page.getByRole("button", { name: "Stap afronden" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Afronden" }).click();
  await page.getByRole("heading", { name: "Process Step 1" }).waitFor();
  await page.waitForTimeout(1200);
  const [ps1] = await q(`SELECT r.status, (SELECT count(*) FROM fabriek.waarde w WHERE w.stapregistratie_id = r.id) AS n,
      (SELECT markering FROM fabriek.waarde w JOIN fabriek.veld v ON v.id = w.veld_id WHERE w.stapregistratie_id = r.id AND v.code = 'S1.1') AS m
      FROM fabriek.stapregistratie r JOIN fabriek.batch b ON b.id = r.batch_id WHERE b.batchnummer = 'B-2026-0100'`);
  check("PS1 afgerond in de database met 2 waarden", ps1?.status === "afgerond" && Number(ps1?.n) === 2, JSON.stringify(ps1));
  check("Database markeert 86,5 als buiten tolerantie", ps1?.m === "buiten_tolerantie");

  console.log("\nLot samenstellen in PS16");
  await page.goto(`${BASIS}/invoer/#/stap/PS16`);
  await page.getByRole("heading", { name: "Batches klaar voor een lot" }).waitFor();
  check("Lotvoorstel zichtbaar, nog niet te kiezen (B-2026-0005 niet klaar)",
    (await page.locator(".plan .rij", { hasText: "Lotvoorstel 1" }).locator(".label-wacht", { hasText: "Nog niet klaar" }).count()) === 1);
  for (const n of ["B-2026-0001", "B-2026-0002", "B-2026-0003", "B-2026-0004"]) await page.locator("label.rij", { hasText: n }).click();
  await page.getByLabel("Lotnummer").fill("L-2026-0001");
  await shot("07-lot-samenstellen");
  await page.getByRole("button", { name: "Lot samenstellen" }).click();
  await page.getByRole("dialog").getByRole("heading", { name: "Afwijken van lotvoorstel 1?" }).waitFor();
  check("Afwijken van het voorstel vraagt een reden", true);
  await page.getByRole("dialog").getByLabel("Reden").fill("B-2026-0005 nog niet klaar");
  await page.getByRole("dialog").getByRole("button", { name: "Verder" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Samenstellen" }).click();
  await page.getByRole("heading", { name: "L-2026-0001" }).waitFor();
  await page.waitForTimeout(1200);
  const [lot] = await q("SELECT count(*) AS n FROM fabriek.batch b JOIN fabriek.lot l ON l.id = b.lot_id WHERE l.lotnummer = 'L-2026-0001'");
  check("Lot met 4 batches in de database", Number(lot.n) === 4);
  const [vs] = await q("SELECT status, afwijking_reden FROM fabriek.lot_voorstel WHERE nummer = 1");
  check("Lotvoorstel staat als afgeweken, met de reden", vs.status === "afgeweken" && vs.afwijking_reden === "B-2026-0005 nog niet klaar", JSON.stringify(vs));

  console.log("\nOffline invoer");
  await page.goto(`${BASIS}/invoer/#/stap/PS2`);
  await page.locator(".rij", { hasText: "B-2026-0100" }).waitFor();
  await context.setOffline(true);
  await page.locator(".rij", { hasText: "B-2026-0100" }).getByRole("button", { name: "Start" }).click();
  await page.getByRole("heading", { name: "B-2026-0100" }).waitFor();
  await page.locator("#s-S2\\.1").fill("80");
  await page.locator("#g-S2\\.1").fill("79");
  await page.locator("#g-S2\\.2").fill("412");
  await page.getByRole("button", { name: "Opslaan" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Opslaan" }).click();
  await page.getByRole("button", { name: "Stap afronden" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Afronden" }).click();
  await page.locator(".verbinding.uit").waitFor();
  await page.waitForTimeout(300);
  await shot("08-offline-wachtrij");
  check("Statusbalk meldt wachtende acties", /Geen verbinding, 3 wachten/.test(await page.locator(".verbinding").innerText()));
  const [voor] = await q("SELECT count(*) AS n FROM fabriek.stapregistratie r JOIN fabriek.processtap s ON s.id = r.processtap_id JOIN fabriek.batch b ON b.id = r.batch_id WHERE b.batchnummer = 'B-2026-0100' AND s.code = 'PS2'");
  check("Zonder verbinding nog niets in de database", Number(voor.n) === 0);

  // Pagina herladen zonder verbinding: app opent uit de cache en de wachtrij blijft.
  await page.reload();
  await page.locator(".verbinding.uit").waitFor({ timeout: 8000 });
  check("App opent zonder verbinding na herladen", await page.locator("#balk").isVisible());
  await page.goto(`${BASIS}/invoer/#/wachtrij`).catch(() => {});
  await page.getByRole("heading", { name: "Verzenden" }).waitFor();
  await shot("09-wachtrij-scherm");

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.locator(".verbinding", { hasText: "Verbonden" }).waitFor({ timeout: 15000 });
  const [na] = await q(`SELECT r.status, (SELECT count(*) FROM fabriek.waarde w WHERE w.stapregistratie_id = r.id) AS n
      FROM fabriek.stapregistratie r JOIN fabriek.processtap s ON s.id = r.processtap_id JOIN fabriek.batch b ON b.id = r.batch_id
      WHERE b.batchnummer = 'B-2026-0100' AND s.code = 'PS2'`);
  check("Na herstel van de verbinding staat PS2 afgerond in de database", na?.status === "afgerond" && Number(na?.n) === 2, JSON.stringify(na));

  console.log("\nGeweigerde invoer");
  await page.goto(`${BASIS}/invoer/#/stap/PS1`);
  await page.getByText("Ongeplande batch aanmaken").click();
  await page.getByLabel("Nieuwe batch").fill("B-2026-0100");
  await page.getByRole("button", { name: "Aanmaken en starten" }).click();
  await page.locator("#melding", { hasText: "bestaat al" }).waitFor();
  check("Bestaand batchnummer wordt meteen gemeld", true);
  // Zonder verbinding kan dat niet; dan weigert de server later en staat het in de lijst.
  await context.setOffline(true);
  await page.getByRole("button", { name: "Aanmaken en starten" }).click();
  await page.getByRole("heading", { name: "B-2026-0100" }).waitFor();
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.locator(".verbinding.probleem").waitFor({ timeout: 15000 });
  await page.goto(`${BASIS}/invoer/#/wachtrij`);
  await page.getByRole("heading", { name: "Geweigerd door de server" }).waitFor();
  await shot("10-geweigerd");
  check("Dubbel batchnummer staat als geweigerd met uitleg", (await page.locator(".rij", { hasText: "Dit batchnummer bestaat al" }).count()) === 1);
  while (await page.getByRole("button", { name: "Verwijderen" }).count()) {
    await page.getByRole("button", { name: "Verwijderen" }).first().click();
    await page.waitForTimeout(200);
  }
  await page.locator(".verbinding", { hasText: "Verbonden" }).waitFor();

  console.log("\nPloegleider: correctie en besluit");
  await page.getByRole("button", { name: "Afmelden" }).click();
  await page.getByLabel("Gebruikersnaam").fill("ploegleider1");
  await page.getByLabel("Wachtwoord").fill("demo");
  await page.getByRole("button", { name: "Inloggen" }).click();
  await page.getByRole("button", { name: "Operator B" }).click();
  await page.getByRole("link", { name: "Zoeken" }).click();
  await page.getByLabel("Batch- of lotnummer").fill("B-2026-0100");
  await page.getByRole("button", { name: "Zoeken" }).click();
  await page.getByRole("heading", { name: "Geschiedenis van de batch" }).waitFor();
  await shot("11-batch-zoeken");
  await page.locator("a.rij", { hasText: "Process Step 1" }).click();
  await page.locator(".veld", { hasText: "S1.1" }).getByRole("button", { name: "Corrigeer" }).click();
  await page.getByLabel(/Setting/).fill("80");
  await page.getByLabel(/Gemeten/).fill("82");
  await page.getByLabel("Reden van de correctie").fill("verkeerd afgelezen");
  await page.getByRole("button", { name: "Correctie opslaan" }).click();
  await page.locator(".label", { hasText: "Gecorrigeerd" }).waitFor();
  await shot("12-gecorrigeerd");
  const [corr] = await q("SELECT gemeten, markering FROM fabriek.waarde_actueel w JOIN fabriek.veld v ON v.id = w.veld_id JOIN fabriek.stapregistratie r ON r.id = w.stapregistratie_id JOIN fabriek.batch b ON b.id = r.batch_id WHERE b.batchnummer = 'B-2026-0100' AND v.code = 'S1.1'");
  check("Correctie in de database, nu binnen tolerantie", Number(corr.gemeten) === 82 && corr.markering === "ok");

  await page.goto(`${BASIS}/invoer/#/zoek/B-2026-0005`);
  await page.getByRole("button", { name: "In beoordeling zetten" }).click();
  await page.getByLabel("Reden").fill("kleur wijkt af");
  await page.getByRole("dialog").getByRole("button", { name: "In beoordeling zetten" }).click();
  await page.getByText("wacht op het keurresultaat van Kwaliteit").waitFor();
  await shot("13-in-beoordeling");
  const [st] = await q("SELECT status FROM fabriek.batch WHERE batchnummer = 'B-2026-0005'");
  check("Batch staat in beoordeling", st.status === "in_beoordeling");
  check("Ploegleider ziet geen knoppen voor het keurresultaat", (await page.getByRole("button", { name: /Keurresultaat/ }).count()) === 0);

  console.log("\nKwaliteit: keurresultaat");
  await page.getByRole("button", { name: "Afmelden" }).click();
  await page.getByLabel("Gebruikersnaam").fill("kwaliteit1");
  await page.getByLabel("Wachtwoord").fill("demo");
  await page.getByRole("button", { name: "Inloggen" }).click();
  await page.getByRole("heading", { name: "Kies een stap" }).waitFor();
  await page.goto(`${BASIS}/invoer/#/stap/PS1`);
  await page.getByRole("heading", { name: "Process Step 1" }).waitFor();
  check("Kwaliteit kan geen batch aanmaken", (await page.getByLabel("Nieuwe batch").count()) === 0);
  await page.goto(`${BASIS}/invoer/#/zoek/B-2026-0005`);
  await page.getByRole("button", { name: "Keurresultaat NOK" }).click();
  await page.getByLabel("Reden").fill("kleur buiten specificatie");
  await page.getByRole("dialog").getByRole("button", { name: "NOK: afkeuren" }).click();
  await page.getByText("Keurresultaat NOK, afgekeurd").waitFor();
  await shot("14-keurresultaat-nok");
  const [st2] = await q("SELECT status FROM fabriek.batch WHERE batchnummer = 'B-2026-0005'");
  check("Keurresultaat NOK: batch afgekeurd", st2.status === "afgekeurd");
  const [ps7] = await q("SELECT r.status, r.reden FROM fabriek.stapregistratie r JOIN fabriek.processtap s ON s.id = r.processtap_id JOIN fabriek.batch b ON b.id = r.batch_id WHERE b.batchnummer = 'B-2026-0005' AND s.code = 'PS7'");
  check("Open PS7 is afgebroken met de reden", ps7.status === "afgebroken" && ps7.reden === "Batch afgekeurd: kleur buiten specificatie", JSON.stringify(ps7));
  check("Geschiedenis toont 'Afgebroken'", (await page.locator(".rij", { hasText: "Process Step 7" }).getByText("Afgebroken").count()) === 1);

  // Smal scherm
  await page.setViewportSize({ width: 420, height: 860 });
  await page.goto(`${BASIS}/invoer/#/stappen`);
  await page.locator(".tegel").first().waitFor();
  await shot("15-smal");
} catch (e) {
  console.log("  AFGEBROKEN", e.message);
  await shot("fout").catch(() => {});
  fouten++;
} finally {
  await browser.close();
  await db.end();
  stopApi();
}
console.log(fouten ? `\n${fouten} fout(en)` : "\nAlles geslaagd");
process.exit(fouten ? 1 : 0);
