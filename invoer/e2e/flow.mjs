import { stopTestApi } from "../../tests/screen-api-lifecycle.mjs";
// End-to-end test van het invoerscherm in Chrome, inclusief offline invoer.
// Verwacht: database met seed_config.sql + seed_accounts_demo.sql + seed_demo.sql, en een gebouwde app (npm run build).
// Gebruik: node e2e/flow.mjs   (start zelf de API op poort 3456)
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import pg from "pg";

const DB = process.env.DATABASE_URL ?? "postgres://postgres@localhost/batchgui?host=/tmp&port=5433";
const APP_DB = process.env.TEST_APP_DATABASE_URL;
if (!APP_DB || APP_DB === DB) throw new Error("TEST_APP_DATABASE_URL moet een afzonderlijke beperkte MES-testverbinding zijn");
const SHOTS = process.env.SHOTS ?? "/tmp/shots";
const BASIS = "http://localhost:3456";
mkdirSync(SHOTS, { recursive: true });

let fouten = 0;
const check = (naam, ok, extra = "") => {
  console.log(`${ok ? "  OK  " : "  FOUT"} ${naam}${!ok && extra ? `  [${extra}]` : ""}`);
  if (!ok) fouten++;
};

const api = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
  cwd: new URL("../../api/", import.meta.url).pathname,
  env: { ...process.env, DATABASE_URL: APP_DB, JWT_GEHEIM: "e2e-".repeat(10), POORT: "3456", INVOER_MAP: new URL("../dist", import.meta.url).pathname },
  stdio: ["ignore", "ignore", "inherit"],
  detached: true,
});
const stopApi = () => stopTestApi(api);
const db = new pg.Client({ connectionString: DB });
await db.connect();
const q = async (sql, p = []) => (await db.query(`SET search_path = fabriek; ${sql}`.includes("$") ? sql : sql, p)).rows;
await db.query("SET search_path = fabriek");

for (let i = 0; i < 40; i++) {
  try { if ((await fetch(`${BASIS}/gezondheid`)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 250));
}

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: "nl-NL", timezoneId: "Europe/Amsterdam" });
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("  PAGINAFOUT", e.message); fouten++; });
const shot = (naam) => (naam === "fout" || process.env.MES_SCREENSHOTS === "review") ? page.screenshot({ path: `${SHOTS}/${naam}.png`, fullPage: true }) : Promise.resolve();

try {
  console.log("\nStarten en inloggen");
  await page.goto(`${BASIS}/invoer/`);
  await page.getByRole("heading", { name: "Welke pc is dit?" }).waitFor();
  await shot("01-pc-kiezen");
  await page.getByRole("button", { name: /^PC-01/ }).click();
  // D93: gedeelde identiteit krijgt geen sessie, ook niet op een gekoppelde pc.
  await page.getByLabel("Gebruikersnaam").fill("operator");
  await page.getByLabel("Wachtwoord").fill("demo");
  await shot("02-inloggen");
  const geweigerd = page.waitForResponse(r => r.url().endsWith("/auth/login") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Inloggen" }).click();
  check("Gedeeld account: login geweigerd", (await geweigerd).status() === 401);
  await page.getByRole("alert").filter({ hasText: "Onjuiste gebruikersnaam of wachtwoord" }).waitFor();
  check("Gedeeld account: geen invoertoken", await page.evaluate(() => localStorage.getItem("invoer.token") === null));
  await page.getByRole("heading", { name: "Inloggen" }).waitFor();
  // Eigen account (D53): meteen naar de stappen, naam vast in de balk.
  await page.getByLabel("Gebruikersnaam").fill("operator.a");
  await page.getByLabel("Wachtwoord").fill("demo");
  await page.getByRole("button", { name: "Inloggen" }).click();
  await page.getByRole("heading", { name: "Kies een stap" }).waitFor();
  check("Eigen account: geen naam kiezen, naam in de balk", (await page.locator(".balk-eigen-naam").innerText()) === "Operator A");
  await page.locator(".verbinding", { hasText: "Verbonden" }).waitFor();
  await page.locator(".tegel").first().waitFor();
  await shot("04-stappen");
  check("Stappenoverzicht toont 18 stappen", (await page.locator(".tegel").count()) === 18);
  check("PS7 staat als bezig", (await page.locator(".tegel.bezig").count()) === 1);
  // Een tegel met werk dat loopt moet klikbaar blijven (de klasse "bezig" van knoppen blokkeert klikken).
  await page.locator(".tegel.bezig").click();
  await page.getByRole("heading", { name: "Process Step 7" }).waitFor({ timeout: 5000 });
  check("Tegel van een stap die bezig is opent de stap", true);

  console.log("\nEen gestarte stap overnemen (#55)");
  const bezigRij = page.locator(".rij", { hasText: "B-2026-0005" });
  check("Bij Bezig: wie startte en op welke pc", (await bezigRij.innerText()).includes("Operator C op PC-05"), await bezigRij.innerText());
  check("Gestart door een ander: knop Afmaken", (await bezigRij.locator(".knop", { hasText: "Afmaken" }).count()) === 1);
  await bezigRij.click();
  await page.locator(".overname").waitFor();
  await shot("04b-stap-overnemen");
  check("In de stap: je maakt de stap af die Operator C startte", (await page.locator(".overname").innerText()).includes("Operator C startte"));
  // Afronden door een ander staat in de API-test; deze PS7 blijft open voor het keurresultaat verderop.
  await page.getByRole("link", { name: "Stappen" }).click();
  await page.getByRole("heading", { name: "Kies een stap" }).waitFor();

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
  // Handscanner: typt de code heel snel en drukt op Enter.
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.type("B-2026-0007", { delay: 5 });
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "B-2026-0007" }).waitFor();
  check("Scannen van een geplande batch start hem", page.url().includes("#/reg/"));
  await page.goto(`${BASIS}/invoer/#/stap/PS1`);
  await page.locator(".plan-bezig", { hasText: "B-2026-0007" }).waitFor();
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.type("B-2026-0007", { delay: 5 });
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "B-2026-0007" }).waitFor();
  check("Scannen van een batch die bezig is opent hem", true);
  await page.evaluate(() => { window.print = () => { window.__geprint = document.querySelectorAll("#print-etiketten .etiket").length; }; });
  await page.getByRole("button", { name: "Etiket printen" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Printen" }).click();
  await page.waitForFunction(() => window.__geprint !== undefined);
  check("Etiket printen maakt één etiket", (await page.evaluate(() => window.__geprint)) === 1);
  await page.keyboard.type("b-2026-0005", { delay: 5 });
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => location.hash.startsWith("#/zoek/B-2026-0005"));
  check("Scannen buiten een stap zoekt de batch op", true);
  await page.goto(`${BASIS}/invoer/#/stap/PS1`);

  console.log("\nHerbewerking met opdracht (#61)");
  // B-2026-0004 heeft alle batchstappen gedaan; de productiemanager stuurt hem terug naar PS15 (en trekt dat daarna in,
  // zodat het lot verderop gewoon kan worden samengesteld).
  const pmLogin = await (await fetch(`${BASIS}/auth/login`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ gebruikersnaam: "productiemanager1", wachtwoord: "demo" }) })).json();
  const pm = { "content-type": "application/json", authorization: `Bearer ${pmLogin.token}` };
  const aanmaak = await fetch(`${BASIS}/herbewerkingen`, { method: "POST", headers: pm, body: JSON.stringify({ nummer: "B-2026-0004", stapcode: "PS15", reden: "test: opnieuw", wachtwoord: "demo" }) });
  const hb = await aanmaak.json();
  check("Productiemanager maakt een herbewerking aan", aanmaak.status === 201, `${aanmaak.status} ${JSON.stringify(hb)}`);
  await page.goto(`${BASIS}/invoer/#/stap/PS15`);
  const rij = page.locator(".rij", { hasText: "B-2026-0004" });
  await rij.waitFor();
  check("Invoerscherm: de batch staat klaar in PS15, met 'Herbewerking' en de reden",
    (await rij.locator(".label-herbewerking").count()) === 1 && (await rij.innerText()).includes("test: opnieuw"));
  await shot("04c-herbewerking-klaar");
  await page.goto(`${BASIS}/invoer/#/stap/PS16`);
  await page.getByRole("heading", { name: "Process Step 16" }).waitFor();
  check("... en zolang hij niet gedaan is, niet klaar voor een lot", !(await page.locator("main").innerText()).includes("B-2026-0004"));
  const intrek = await fetch(`${BASIS}/herbewerkingen/${hb.id}/intrekken`, { method: "POST", headers: pm, body: JSON.stringify({ reden: "test klaar", wachtwoord: "demo" }) });
  check("Herbewerking ingetrokken", intrek.status === 200);
  await page.goto(`${BASIS}/invoer/#/stap/PS1`);
  await page.getByRole("heading", { name: "Gepland voor vandaag" }).waitFor();

  console.log("\nNieuwe batch in PS1 met een afwijking");
  await page.getByText("Ongeplande batch aanmaken").click();
  await page.getByLabel("Nieuwe batch").fill("b-2026-0100");
  await page.getByRole("button", { name: "Aanmaken en starten" }).click();
  await page.getByRole("heading", { name: "B-2026-0100" }).waitFor();
  // Foutmelding onder het veld: niet tijdens het typen, wel na het verlaten van de rij (#43, D50).
  await page.locator("#s-S1\\.1").fill("8x");
  check("Geen foutmelding tijdens het typen", (await page.locator("#f-S1\\.1").textContent()) === "");
  await page.locator("#g-S1\\.2").focus();
  check("Foutmelding onder het veld na verlaten", (await page.locator("#f-S1\\.1").textContent())?.includes("Vul een getal in"));
  check("Veld gemarkeerd als ongeldig", (await page.locator("#s-S1\\.1").getAttribute("aria-invalid")) === "true");
  await page.locator("#s-S1\\.1").fill("80");
  await page.locator("#g-S1\\.1").fill("86,5");
  check("Foutmelding weg na verbeteren", (await page.locator("#f-S1\\.1").textContent()) === "");
  await page.locator("#g-S1\\.2").fill("410");
  await page.locator("#p-GS-A").fill("LEV-GS-A-E2E-01");
  await page.locator("#h-GS-A").fill("118,5");
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
  const [gs] = await q(`SELECT u.partij, u.hoeveelheid FROM fabriek.grondstof_gebruik u JOIN fabriek.stapregistratie r ON r.id = u.stapregistratie_id
      JOIN fabriek.batch b ON b.id = r.batch_id WHERE b.batchnummer = 'B-2026-0100'`);
  check("Grondstofpartij en hoeveelheid in de database", gs?.partij === "LEV-GS-A-E2E-01" && Number(gs?.hoeveelheid) === 118.5, JSON.stringify(gs));

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
  // D99: pilotfeedback is uitgesteld; uitsluitend de drie productieacties mogen in de wachtrij.
  check("Geen pilotfeedbackknop", await page.getByRole("button", { name: "Iets melden" }).count() === 0);
  // Wacht op de asynchrone opslag én statuspublicatie; screenshot is geen synchronisatie.
  const offlineStatus = page.locator(".verbinding.uit");
  await page.waitForFunction(() => document.querySelector(".verbinding.uit")?.textContent?.trim() === "Geen verbinding, 3 wachten", null, {timeout: 10000}).catch(() => {});
  const statusTekst = await offlineStatus.innerText();
  check("Statusbalk meldt drie wachtende productieacties", statusTekst.trim() === "Geen verbinding, 3 wachten", statusTekst);
  await shot("08-offline-wachtrij");
  const [voor] = await q("SELECT count(*) AS n FROM fabriek.stapregistratie r JOIN fabriek.processtap s ON s.id = r.processtap_id JOIN fabriek.batch b ON b.id = r.batch_id WHERE b.batchnummer = 'B-2026-0100' AND s.code = 'PS2'");
  check("Zonder verbinding nog niets in de database", Number(voor.n) === 0);

  // Pagina herladen zonder verbinding: app opent uit de cache en de wachtrij blijft.
  await page.reload();
  await page.locator(".verbinding.uit").waitFor({ timeout: 8000 });
  check("App opent zonder verbinding na herladen", await page.locator("#balk").isVisible());
  await page.goto(`${BASIS}/invoer/#/wachtrij`).catch(() => {});
  await page.getByRole("heading", { name: "Verzenden" }).waitFor();
  await shot("09-wachtrij-scherm");
  await page.waitForTimeout(3000); // een tijdje offline, zodat invoer en versturen duidelijk verschillen

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.locator(".verbinding", { hasText: "Verbonden" }).waitFor({ timeout: 15000 });
  const [na] = await q(`SELECT r.status, (SELECT count(*) FROM fabriek.waarde w WHERE w.stapregistratie_id = r.id) AS n
      FROM fabriek.stapregistratie r JOIN fabriek.processtap s ON s.id = r.processtap_id JOIN fabriek.batch b ON b.id = r.batch_id
      WHERE b.batchnummer = 'B-2026-0100' AND s.code = 'PS2'`);
  check("Na herstel van de verbinding staat PS2 afgerond in de database", na?.status === "afgerond" && Number(na?.n) === 2, JSON.stringify(na));
  const [tijden] = await q(`SELECT extract(epoch FROM r.gestart_ontvangen_op - r.gestart_op)::float AS start,
                                   extract(epoch FROM r.afgerond_ontvangen_op - r.afgerond_op)::float AS af
      FROM fabriek.stapregistratie r JOIN fabriek.processtap s ON s.id = r.processtap_id JOIN fabriek.batch b ON b.id = r.batch_id
      WHERE b.batchnummer = 'B-2026-0100' AND s.code = 'PS2'`);
  check("Offline stap kreeg het moment van invoer, niet van versturen", tijden.start > 3 && tijden.af > 3, JSON.stringify(tijden));

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

  console.log("\nStilstand");
  await page.goto(`${BASIS}/invoer/#/stap/PS4`);
  await page.getByRole("button", { name: "Stilstand melden" }).click();
  await page.getByRole("dialog").getByLabel("Oorzaak").selectOption("STOR-MACH");
  await page.getByRole("dialog").getByLabel(/Toelichting/).fill("transportband loopt vast");
  await page.getByRole("dialog").getByRole("button", { name: "Stilstand melden" }).click();
  await page.getByRole("heading", { name: "⛔ Stilstand: Machinestoring" }).waitFor();
  await page.waitForTimeout(1200);
  const [stil1] = await q("SELECT x.eind_op, o.code FROM fabriek.stilstand x JOIN fabriek.stilstand_oorzaak o ON o.id = x.oorzaak_id JOIN fabriek.processtap s ON s.id = x.processtap_id WHERE s.code = 'PS4'");
  check("Stilstand loopt in de database", stil1?.code === "STOR-MACH" && stil1.eind_op === null, JSON.stringify(stil1));
  await shot("10b-stilstand");
  await page.getByRole("button", { name: "Stilstand beëindigen" }).click();
  await page.getByRole("dialog").getByLabel(/Wat was het en wat is er gedaan/).fill("band opnieuw uitgelijnd");
  await page.getByRole("dialog").getByRole("button", { name: "Beëindigen" }).click();
  await page.getByRole("button", { name: "Stilstand melden" }).waitFor();
  await page.waitForTimeout(1200);
  const [stil2] = await q("SELECT x.eind_op, x.eind_notitie FROM fabriek.stilstand x JOIN fabriek.processtap s ON s.id = x.processtap_id WHERE s.code = 'PS4'");
  check("Stilstand beëindigd, met wat er is gedaan (#31)", stil2?.eind_op !== null && stil2.eind_notitie === "band opnieuw uitgelijnd", JSON.stringify(stil2));

  console.log("\nF4-115-G: middelstilstand via het volledige operatorstapscherm");
  const [resourceActor] = await q("SELECT id FROM gebruiker WHERE gebruikersnaam='operator.a'");
  const [resourceStation] = await q("SELECT id FROM pc WHERE naam='PC-01'");
  const [resourceHierarchy] = await q("INSERT INTO equipment_hierarchy(code,name,level) VALUES ('F115-FLOW-ENT','Fictief','enterprise') RETURNING id");
  const [resourceEquipment] = await q("INSERT INTO equipment(code,name,hierarchy_id) VALUES ('F115-FLOW-E','Fictief testmiddel',$1) RETURNING id",[resourceHierarchy.id]);
  await q("INSERT INTO equipment_workstation(pc_id,equipment_id,opened_by,open_reason) VALUES ($1,$2,$3,'Fictieve schermtest')",[resourceStation.id,resourceEquipment.id,resourceActor.id]);
  // The preceding legacy close has already rendered PS4 with no linked equipment.
  // Leave the route before returning so the SPA requests a fresh projection.
  await page.getByRole("link",{name:"Stappen",exact:true}).click();
  await page.getByRole("heading",{name:"Kies een stap",exact:true}).waitFor();
  const resourceChoices=page.waitForResponse(r=>r.url().includes("/stilstand/middelen/keuzes?stapcode=PS4")&&r.request().method()==="GET");
  await page.goto(`${BASIS}/invoer/#/stap/PS4`);
  const choicesResponse=await resourceChoices;
  const choicesBody=await choicesResponse.json();
  if(choicesResponse.status()!==200||!Array.isArray(choicesBody)||!choicesBody.some(x=>x.id===resourceEquipment.id))
    throw new Error("F4-115-G actuele middelkeuze: "+choicesResponse.status()+" "+JSON.stringify(choicesBody));
  const resourceSection = page.locator("section").filter({has:page.getByRole("heading",{name:"Middelstilstand (online)",exact:true})});
  const resourceRow = resourceSection.locator(".rij").filter({hasText:"F115-FLOW-E"});
  await resourceRow.getByRole("button",{name:"Melden",exact:true}).waitFor();
  check("F4-115-G stap- en middelbediening afzonderlijk",await page.getByRole("button",{name:"Stilstand melden",exact:true}).isVisible());
  await resourceRow.getByRole("button",{name:"Melden",exact:true}).click();
  await page.getByRole("dialog").getByLabel("Oorzaak").selectOption("STOR-MACH");
  await page.getByRole("dialog").getByLabel(/Toelichting/).fill("Fictieve middelstoring");
  const resourceOpen = page.waitForResponse(r=>r.url().endsWith("/stilstand/middelen")&&r.request().method()==="POST");
  await page.getByRole("dialog").getByRole("button",{name:"Melden",exact:true}).click();
  const resourceResponse = await resourceOpen;
  check("F4-115-G echte API-opening",resourceResponse.status()===200);
  const resourceRecord = await resourceResponse.json();
  await resourceRow.getByRole("button",{name:"Beëindigen",exact:true}).waitFor();
  const [resourceStored] = await q("SELECT equipment_id,gemeld_door,eind_op FROM stilstand WHERE id=$1",[resourceRecord.id]);
  check("F4-115-G juiste middelcontext en actor",resourceStored?.equipment_id===resourceEquipment.id&&resourceStored?.gemeld_door===resourceActor.id&&resourceStored?.eind_op===null);
  check("F4-115-G middelstoring blokkeert geen stapbediening",await page.getByRole("button",{name:"Stilstand melden",exact:true}).isVisible());
  await resourceRow.getByRole("button",{name:"Beëindigen",exact:true}).click();
  await page.getByRole("dialog").getByLabel("Wat is er gedaan?").fill("Fictief hersteld");
  const resourceClose = page.waitForResponse(r=>r.url().endsWith("/stilstand/middelen/"+resourceRecord.id+"/einde")&&r.request().method()==="POST");
  await page.getByRole("dialog").getByRole("button",{name:"Beëindigen",exact:true}).click();
  check("F4-115-G echte API-afsluiting",(await resourceClose).status()===200);
  await resourceRow.getByRole("button",{name:"Melden",exact:true}).waitFor();
  const [resourceClosed] = await q("SELECT eind_op,eind_notitie FROM stilstand WHERE id=$1",[resourceRecord.id]);
  check("F4-115-G afgesloten registratie met notitie",resourceClosed?.eind_op!=null&&resourceClosed.eind_notitie==="Fictief hersteld");
  const [resourceStatus] = await q("SELECT count(*)::int AS n FROM equipment_status_history WHERE equipment_id=$1",[resourceEquipment.id]);
  check("F4-115-G geen automatische technische vrijgave",resourceStatus.n===0);

  console.log("\nPloegoverdracht");
  await page.goto(`${BASIS}/invoer/#/overdracht`);
  await page.getByRole("heading", { name: /^Overdracht \w+dienst$/ }).waitFor();
  check("Overdracht noemt de ploegen volgens het rooster (#86)", /ploegen [A-E][12] en [A-E][12]/.test(await page.locator(".kop .sub").first().innerText()));
  await page.getByLabel(/Bijzonderheden/).fill("Menger 2 hersteld na storing");
  await page.getByLabel(/Aandachtspunten/).fill("Filter PS7 morgen vervangen");
  await page.getByRole("button", { name: "Overdracht opslaan" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Opslaan" }).click();
  await page.locator(".notitie", { hasText: "Filter PS7" }).waitFor();
  await page.waitForTimeout(1200);
  const [od] = await q("SELECT o.aandachtspunten, op.naam FROM fabriek.overdracht o JOIN fabriek.operator op ON op.id = o.operator_id ORDER BY geschreven_op DESC LIMIT 1");
  check("Overdracht in de database, met de operatornaam", od?.aandachtspunten === "Filter PS7 morgen vervangen" && od?.naam === "Operator A", JSON.stringify(od));
  await context.setOffline(true);
  await page.getByLabel(/Bijzonderheden/).fill("Aanvulling zonder verbinding");
  await page.getByRole("button", { name: "Overdracht opslaan" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Opslaan" }).click();
  await page.locator(".notitie", { hasText: "Aanvulling zonder verbinding" }).getByText("Nog niet verstuurd").waitFor();
  check("Zonder verbinding: overdracht staat klaar om te versturen", true);
  await shot("11-overdracht");
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.locator(".verbinding", { hasText: "Verbonden" }).waitFor({ timeout: 15000 });
  const [n] = await q("SELECT count(*)::int AS n FROM fabriek.overdracht");
  check("Na herstel van de verbinding staan beide overdrachten in de database", n.n === 2, JSON.stringify(n));

  console.log("\nAfmelden met wachtende acties");
  await page.goto(`${BASIS}/invoer/#/stap/PS3`);
  await page.locator(".rij", { hasText: "B-2026-0100" }).waitFor();
  await context.setOffline(true);
  await page.locator(".rij", { hasText: "B-2026-0100" }).getByRole("button", { name: "Start" }).click();
  await page.getByRole("heading", { name: "B-2026-0100" }).waitFor();
  await page.getByRole("button", { name: "Afmelden" }).click();
  await page.getByRole("dialog").getByText("1 actie klaar om te versturen").waitFor();
  check("Afmelden met een wachtende actie vraagt eerst om bevestiging", true);
  await shot("10b-afmelden-met-wachtrij");
  await page.getByRole("dialog").getByRole("button", { name: "Afmelden" }).click();
  await page.getByLabel("Gebruikersnaam").waitFor();
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));

  console.log("\nPloegleider: correctie en besluit");
  await page.getByLabel("Gebruikersnaam").fill("ploegleider1");
  await page.getByLabel("Wachtwoord").fill("demo");
  await page.getByRole("button", { name: "Inloggen" }).click();
  await page.locator(".balk-eigen-naam", { hasText: "ploegleider1" }).waitFor();

  const leesWachtrij = () => new Promise((resolve,reject) => {
    const req = indexedDB.open("batch-invoer",1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const read = db.transaction("wachtrij","readonly").objectStore("wachtrij").getAll();
      read.onerror = () => { db.close(); reject(read.error); };
      read.onsuccess = () => { db.close(); resolve(read.result); };
    };
  });
  const [oorsprong] = await q("SELECT g.id::text AS gebruiker,o.id::text AS operator FROM fabriek.gebruiker g JOIN fabriek.operator o ON o.gebruiker_id=g.id WHERE g.gebruikersnaam='operator.a'");
  const herken = a => a.status === "beoordeling" && a.userId === oorsprong.gebruiker && a.operatorId === oorsprong.operator && a.pad === "/registraties" && a.body?.stapcode === "PS3" && a.body?.batchnummer === "B-2026-0100";
  await page.waitForFunction(({gebruiker,operator}) => new Promise((resolve,reject) => {
    const req=indexedDB.open("batch-invoer",1);
    req.onerror=()=>reject(req.error);
    req.onsuccess=()=>{
      const db=req.result;
      const read=db.transaction("wachtrij","readonly").objectStore("wachtrij").getAll();
      read.onerror=()=>{db.close();reject(read.error);};
      read.onsuccess=()=>{db.close();resolve(read.result.some(a=>a.status==="beoordeling" && a.userId===gebruiker && a.operatorId===operator && a.pad==="/registraties" && a.body?.stapcode==="PS3" && a.body?.batchnummer==="B-2026-0100"));};
    };
  }), oorsprong, {timeout:15000});
  const bewaard=await page.evaluate(leesWachtrij);
  check("Actie bewaard met oorspronkelijke identiteit voor beoordeling",bewaard.some(herken),JSON.stringify(bewaard));
  const [ps3] = await q(`SELECT o.naam FROM fabriek.stapregistratie r JOIN fabriek.processtap s ON s.id = r.processtap_id
      JOIN fabriek.batch b ON b.id = r.batch_id JOIN fabriek.operator o ON o.id = r.operator_id
      WHERE b.batchnummer = 'B-2026-0100' AND s.code = 'PS3'`);
  check("Andere sessie verstuurt de wachtende start niet", ps3 === undefined, JSON.stringify(ps3));
  await page.getByRole("link", { name: "Zoeken" }).click();
  await page.getByLabel("Batch- of lotnummer").fill("B-2026-0100");
  await page.getByRole("button", { name: "Zoeken" }).click();
  await page.getByRole("heading", { name: "Geschiedenis van de batch" }).waitFor();
  await shot("11-batch-zoeken");
  await page.locator("a.rij", { hasText: "Process Step 1" }).click();
  await page.locator(".veld", { hasText: "S1.1" }).getByRole("button", { name: "Corrigeer" }).click();
  await page.getByLabel(/Instelling/).fill("80");
  await page.getByLabel(/Gemeten/).fill("82");
  await page.getByLabel("Reden van de correctie").fill("verkeerd afgelezen");
  await page.getByRole("button", { name: "Correctie opslaan" }).click();
  await page.locator(".label", { hasText: "Gecorrigeerd" }).waitFor();
  await shot("12-gecorrigeerd");
  const [corr] = await q("SELECT gemeten, markering FROM fabriek.waarde_actueel w JOIN fabriek.veld v ON v.id = w.veld_id JOIN fabriek.stapregistratie r ON r.id = w.stapregistratie_id JOIN fabriek.batch b ON b.id = r.batch_id WHERE b.batchnummer = 'B-2026-0100' AND v.code = 'S1.1'");
  check("Correctie in de database, nu binnen tolerantie", Number(corr.gemeten) === 82 && corr.markering === "ok");

  console.log("\nTwee keer ingevuld (#85)");
  // Een tweede pc vulde S1.2 ook in, met een andere waarde: de server bewaart dat als conflict.
  await q(`SELECT fabriek.leg_invoerconflict_vast(r.id, v.id, NULL, 999, (SELECT id FROM fabriek.operator WHERE naam = 'Operator B'),
             (SELECT id FROM fabriek.pc WHERE naam = 'PC-02'))
             FROM fabriek.stapregistratie r JOIN fabriek.batch b ON b.id = r.batch_id JOIN fabriek.processtap s ON s.id = r.processtap_id
             JOIN fabriek.veld v ON v.processtap_id = s.id
            WHERE b.batchnummer = 'B-2026-0100' AND s.code = 'PS1' AND v.code = 'S1.2'`);
  await page.reload();
  const conflict = page.locator(".veld", { hasText: "S1.2" }).locator(".conflict");
  await conflict.waitFor();
  check("Conflict bij het veld: wat er staat en wat Operator B invulde", (await conflict.innerText()).includes("999") && (await conflict.innerText()).includes("Operator B"));
  check("Bovenaan: twee keer ingevuld", (await page.locator(".waarschuwing", { hasText: "Twee keer ingevuld: S1.2" }).count()) === 1);
  await shot("12b-conflict");
  await conflict.getByRole("button", { name: "999 nemen" }).click();
  await page.getByRole("dialog").getByLabel("Reden van de keuze").fill("Tweede meting Operator B gecontroleerd");
  await page.getByRole("dialog").getByRole("button", { name: "999 nemen" }).click();
  await page.locator(".conflict").waitFor({ state: "detached" });
  const [s12] = await q("SELECT gemeten, correctie_reden FROM fabriek.waarde_actueel w JOIN fabriek.veld v ON v.id = w.veld_id JOIN fabriek.stapregistratie r ON r.id = w.stapregistratie_id JOIN fabriek.batch b ON b.id = r.batch_id WHERE b.batchnummer = 'B-2026-0100' AND v.code = 'S1.2'");
  check("Gekozen voor de tweede: nu 999, als correctie met de naam erbij", Number(s12.gemeten) === 999 && s12.correctie_reden.includes("Operator B"), JSON.stringify(s12));

  await page.goto(`${BASIS}/invoer/#/zoek/B-2026-0005`);
  await page.getByRole("button", { name: "In beoordeling zetten" }).click();
  await page.getByLabel("Reden").fill("kleur wijkt af");
  await page.getByRole("dialog").getByRole("button", { name: "In beoordeling zetten" }).click();
  await page.getByText("wacht op het keurresultaat van Kwaliteit").waitFor();
  await shot("13-in-beoordeling");
  const [st] = await q("SELECT status FROM fabriek.batch WHERE batchnummer = 'B-2026-0005'");
  check("Batch staat in beoordeling", st.status === "in_beoordeling");
  check("Ploegleider ziet geen knoppen voor het keurresultaat", (await page.getByRole("button", { name: /Keurresultaat/ }).count()) === 0);
  await page.getByRole("link", { name: /^Meldingen/ }).click();
  await page.locator(".rij", { hasText: "B-2026-0005 in beoordeling gezet" }).waitFor();
  check("Ploegleider ziet de melding van de beoordeling", true);

  console.log("\nKwaliteit: keurresultaat");
  await page.getByRole("button", { name: "Afmelden" }).click();
  await page.getByLabel("Gebruikersnaam").fill("kwaliteit1");
  await page.getByLabel("Wachtwoord").fill("demo");
  await page.getByRole("button", { name: "Inloggen" }).click();
  // Afmelden landt op de startpagina (#82); Kwaliteit kiest daar zelf het invoerscherm (lab-pc, D58).
  check("Afmelden in het invoerscherm landt op de startpagina", page.url().includes("/portaal/"), page.url());
  await page.locator(".starttegel-invoer").click();
  // Kwaliteit heeft een eigen startscherm (#88): wat nu te doen is en wat eraan komt, zonder aantallen per processtap.
  await page.getByRole("heading", { name: "Keuringen", level: 1 }).waitFor();
  await page.getByRole("heading", { name: /^Nu te doen/ }).waitFor();
  check("Kwaliteit: Nu te doen, geen uitgestelde voorspelling of tegels per processtap",
    (await page.getByRole("heading", { name: "Verwacht", exact: true }).count()) === 0 && (await page.getByRole("heading", { name: "Per batch" }).count()) === 0);
  await shot("13b-kwaliteit-start");
  await page.goto(`${BASIS}/invoer/#/stap/PS1`);
  await page.getByRole("heading", { name: "Process Step 1" }).waitFor();
  check("Kwaliteit kan geen batch aanmaken", (await page.getByLabel("Nieuwe batch").count()) === 0);
  await page.goto(`${BASIS}/invoer/#/zoek/B-2026-0005`);
  await page.getByRole("button", { name: "Keurresultaat NOK" }).click();
  await page.getByLabel("Reden").fill("kleur buiten specificatie");
  await page.getByLabel("Bevestig met je eigen wachtwoord").fill("demo");
  await page.getByRole("dialog").getByRole("button", { name: "NOK: afkeuren" }).click();
  await page.getByText("Keurresultaat NOK, afgekeurd").waitFor();
  await shot("14-keurresultaat-nok");
  const [st2] = await q("SELECT status FROM fabriek.batch WHERE batchnummer = 'B-2026-0005'");
  check("Keurresultaat NOK: batch afgekeurd", st2.status === "afgekeurd");
  const [ps7] = await q("SELECT r.status, r.reden FROM fabriek.stapregistratie r JOIN fabriek.processtap s ON s.id = r.processtap_id JOIN fabriek.batch b ON b.id = r.batch_id WHERE b.batchnummer = 'B-2026-0005' AND s.code = 'PS7'");
  check("Open PS7 is afgebroken met de reden", ps7.status === "afgebroken" && ps7.reden === "Batch afgekeurd: kleur buiten specificatie", JSON.stringify(ps7));
  check("Geschiedenis toont 'Afgebroken'", (await page.locator(".rij", { hasText: "Process Step 7" }).getByText("Afgebroken").count()) === 1);

  console.log("\nKwaliteit meet en geeft vrij op de lab-pc (#64)");
  const api = async (methode, pad, token, body) => {
    const r = await fetch(`${BASIS}${pad}`, { method: methode, headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const bh = (await api("POST", "/auth/login", null, { gebruikersnaam: "beheerder1", wachtwoord: "demo" })).body.token;
  const engineer = (await api("POST", "/auth/login", null, { gebruikersnaam: "mes.engineer", wachtwoord: "demo" })).body.token;
  check("Process Engineer zet S2.2 op 'Kwaliteit meet'", (await api("PATCH", "/beheer/velden/S2.2", engineer, { gemeten_door: "kwaliteit" })).status === 200);
  // B-2026-0006 staat nog voor PS1: de operator doet PS1, en PS2 zonder S2.2.
  const kb = { batchnummer: "B-2026-0006" };
  const opT = (await api("POST", "/auth/login", null, { gebruikersnaam: "operator.a", wachtwoord: "demo", pc: "PC-02" })).body.token;
  const regPs1 = await api("POST", "/registraties", opT, { stapcode: "PS1", batchnummer: kb.batchnummer });
  await api("POST", `/registraties/${regPs1.body.id}/waarden`, opT, { waarden: [{ veldcode: "S1.1", setting: 80, gemeten: 81 }, { veldcode: "S1.2", gemeten: 410 }] });
  await api("POST", `/registraties/${regPs1.body.id}/grondstoffen`, opT, { grondstoffen: [{ code: "GS-A", partij: "LEV-TEST-01" }] });
  await api("POST", `/registraties/${regPs1.body.id}/afronden`, opT);
  const regPs2 = await api("POST", "/registraties", opT, { stapcode: "PS2", batchnummer: kb.batchnummer });
  await api("POST", `/registraties/${regPs2.body.id}/waarden`, opT, { waarden: [{ veldcode: "S2.1", setting: 80, gemeten: 81 }] });
  const afPs2 = await api("POST", `/registraties/${regPs2.body.id}/afronden`, opT);
  check("Operator rondt PS2 af zonder S2.2; de stap wacht op Kwaliteit", afPs2.body?.keuring?.status === "open", JSON.stringify([regPs1.status, regPs2.status, regPs2.body?.fout, afPs2.body?.fout ?? afPs2.body?.keuring]));
  await page.goto(`${BASIS}/invoer/#/stappen`);
  await page.getByRole("heading", { name: /^Nu te doen \(\d+\)$/ }).waitFor();
  check("Lab-pc: wat op Kwaliteit wacht staat bij Nu te doen", (await page.locator(".keuring-blok").first().innerText()).includes(kb.batchnummer));
  await shot("14c-wacht-op-kwaliteit");
  await page.locator(".keuring-blok a", { hasText: kb.batchnummer }).first().click();
  await page.locator("#g-S2\\.2").fill("412");
  check("Vrijgeven kan pas als alles gemeten is", await page.getByRole("button", { name: "Vrijgeven" }).isDisabled());
  await page.getByRole("button", { name: "Opslaan" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Opslaan" }).click();
  await page.getByRole("button", { name: "Vrijgeven" }).and(page.locator(":not([disabled])")).waitFor();
  await shot("14d-meting-kwaliteit");
  await page.getByRole("button", { name: "Vrijgeven" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Vrijgeven" }).click();
  await page.getByRole("dialog").getByLabel("Je eigen wachtwoord").fill("demo");
  await page.getByRole("dialog").getByRole("button", { name: "Besluit bevestigen" }).click();
  await page.locator(".label-keuring-vrijgegeven").waitFor();
  let vrij = null;
  for (let i = 0; i < 20 && vrij?.status !== "vrijgegeven"; i++) {
    [vrij] = await q("SELECT k.status FROM fabriek.keuring k WHERE k.stapregistratie_id = $1", [regPs2.body.id]);
    if (vrij?.status !== "vrijgegeven") await page.waitForTimeout(250);
  }
  check("Vrijgegeven, ook in de database (online persoonlijk besluit)", vrij?.status === "vrijgegeven", JSON.stringify(vrij));
  await api("PATCH", "/beheer/velden/S2.2", engineer, { gemeten_door: "productie" });

  console.log("\nTijdelijk wachtwoord op het invoerscherm (#76)");
  const nieuwAcc = await api("POST", "/beheer/gebruikers", bh, { gebruikersnaam: "operator.f", wachtwoord: "tijdelijk-1" });
  check("Beheerder maakt een onbevoegd persoonlijk account met tijdelijk wachtwoord", nieuwAcc.status === 201 && nieuwAcc.body.tijdelijk === true && nieuwAcc.body.rol === "pending", JSON.stringify(nieuwAcc.body));
  // Alleen fictieve fixture: aparte eigenaar bereidt een persoonlijke koppeling en expliciete grant voor.
  // Accountaanmaak zelf verleent geen van beide.
  const [pending] = await q("SELECT g.id, (SELECT count(*)::int FROM fabriek.authorization_grant a WHERE a.user_id=g.id) AS grants, (SELECT count(*)::int FROM fabriek.operator o WHERE o.gebruiker_id=g.id) AS personen FROM fabriek.gebruiker g WHERE g.gebruikersnaam=$1", ["operator.f"]);
  check("Geen automatische grant of personeelskoppeling", pending.grants === 0 && pending.personen === 0);
  await q("INSERT INTO fabriek.operator(naam,gebruiker_id) VALUES ($1,$2)", ["Operator Nieuw",pending.id]);
  await q("INSERT INTO fabriek.authorization_grant(user_id,role_code) VALUES ($1,'operator')",[pending.id]);
  await page.goto(`${BASIS}/invoer/#/stappen`);
  await page.getByRole("button", { name: "Afmelden" }).click();
  const bevestigAf = page.getByRole("dialog").getByRole("button", { name: "Afmelden" });
  if (await bevestigAf.isVisible().catch(() => false)) await bevestigAf.click();
  await page.waitForURL(u => u.pathname.startsWith("/portaal/") && u.hash === "#/login");
  await page.goto(`${BASIS}/invoer/#/login`);
  await page.getByLabel("Gebruikersnaam").fill("operator.f");
  await page.getByLabel("Wachtwoord").fill("tijdelijk-1");
  await page.getByRole("button", { name: "Inloggen" }).click();
  await page.getByRole("heading", { name: "Kies een eigen wachtwoord" }).waitFor();
  check("Eerst een eigen wachtwoord; het tijdelijke token is niet bewaard", (await page.evaluate(() => localStorage.getItem("invoer.token"))) === null);
  await page.locator("#ww-nieuw").fill("eigen-ww-f");
  await page.locator("#ww-nogmaals").fill("eigen-ww-f");
  await shot("14e-eigen-wachtwoord");
  const gewijzigd = page.waitForResponse(r => new URL(r.url()).pathname === "/auth/wachtwoord" && r.request().method() === "POST");
  await page.getByRole("button", { name: "Opslaan en verder" }).click();
  const gewijzigdRes = await gewijzigd;
  check("Eigen wachtwoord door server bevestigd", gewijzigdRes.status() === 200);
  await page.getByRole("heading", { name: "Kies een stap" }).waitFor();
  check("Daarna de stappen, met de eigen naam", (await page.locator(".balk-eigen-naam").innerText()) === "Operator Nieuw");

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
  if (fouten > 0) await page.screenshot({ path: `${SHOTS}/fout-eind.png` }).catch(() => {});
  await browser.close();
  await db.end();
  await stopApi();
}
console.log(fouten ? `\n${fouten} fout(en)` : "\nAlles geslaagd");
process.exit(fouten ? 1 : 0);
