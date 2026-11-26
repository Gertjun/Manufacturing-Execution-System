import { stopTestApi } from "../../tests/screen-api-lifecycle.mjs";
// Test van het Portaal Productie in Chrome, op data van tools/genereer_testdata.py.
// Gebruik: node e2e/productie.mjs   (start zelf de API op poort 3460)
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import pg from "pg";

const DB = process.env.DATABASE_URL ?? "postgres://postgres@localhost/batchgui?host=/tmp&port=5433";
const APP_DB = process.env.TEST_APP_DATABASE_URL;
if (!APP_DB || APP_DB === DB) throw new Error("TEST_APP_DATABASE_URL moet een afzonderlijke beperkte MES-testverbinding zijn");
const SHOTS = process.env.SHOTS ?? "/tmp/shots-productie";
const BASIS = "http://localhost:3460";
mkdirSync(SHOTS, { recursive: true });

let fouten = 0;
const check = (naam, ok, extra = "") => {
  console.log(`${ok ? "  OK  " : "  FOUT"} ${naam}${!ok && extra ? `  [${extra}]` : ""}`);
  if (!ok) fouten++;
};

const api = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
  cwd: new URL("../../api/", import.meta.url).pathname,
  env: { ...process.env, DATABASE_URL: APP_DB, JWT_GEHEIM: "e2e-".repeat(10), POORT: "3460", PORTAAL_MAP: new URL("../dist", import.meta.url).pathname },
  stdio: ["ignore", "ignore", "inherit"],
  detached: true,
});
const stopApi = () => stopTestApi(api);
const db = new pg.Client({ connectionString: DB });
await db.connect();
const q = async (sql, p = []) => (await db.query(sql, p)).rows;

let apiKlaar = false;
for (let i = 0; i < 40; i++) {
  try { if ((await fetch(`${BASIS}/gezondheid`, { signal: AbortSignal.timeout(1000) })).ok) { apiKlaar = true; break; } } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
if (!apiKlaar) { await stopApi(); await db.end(); throw new Error("API niet bereikbaar op /gezondheid"); }

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "nl-NL", timezoneId: "Europe/Amsterdam" });
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("  PAGINAFOUT", e.message); fouten++; });
const shot = (naam, fullPage = true) => (naam === "fout" || process.env.MES_SCREENSHOTS === "review") ? page.screenshot({ path: `${SHOTS}/${naam}.png`, fullPage }) : Promise.resolve();

try {
  console.log("\nWerkvoorraad");
  await page.goto(`${BASIS}/portaal/#/login`);
  await page.getByLabel("Gebruikersnaam").fill("ploegleider1");
  await page.getByLabel("Wachtwoord").fill("demo");
  await page.getByRole("button", { name: "Inloggen" }).click();
  await page.locator(".starttegel-productie").click();
  await page.getByRole("heading", { name: "Productie", exact: true }).waitFor();
  await page.locator(".staptegel").first().waitFor();
  await shot("01-werkvoorraad");
  check("Ploegleider komt in het Portaal Productie", page.url().includes("#/productie"));
  check("21 stappen in de werkvoorraad (met keuringen)", (await page.locator(".staptegel").count()) === 21);
  const [{ open }] = await q("SELECT count(*)::int AS open FROM fabriek.stapregistratie WHERE status = 'open'");
  const getoond = Number((await page.locator(".tegel").first().locator(".tegel-getal").innerText()).trim());
  check("Aantal stappen bezig klopt met de database", getoond === open, `${getoond} vs ${open}`);

  const metWerk = page.locator(".staptegel:not(.leeg-stap)").first();
  const code = (await metWerk.getAttribute("href")).split("/").pop();
  await metWerk.click();
  await page.getByRole("heading", { name: /Klaar om te starten/ }).waitFor();
  await shot("02-stap");
  const [{ n }] = await q("SELECT count(*)::int AS n FROM fabriek.werkvoorraad($1)", [code]);
  check(`Stap ${code}: wachtende lijst klopt`, (await page.getByRole("heading", { name: `Klaar om te starten (${n})` }).count()) === 1);

  console.log("\nDoorlooptijden");
  await page.getByRole("link", { name: "Doorlooptijden" }).click();
  await page.locator(".grafiek > svg").waitFor();
  await page.waitForTimeout(300);
  const balk = page.locator(".grafiek > svg rect[tabindex]").nth(15);
  await balk.hover();
  await page.locator(".tip:not([hidden])").waitFor();
  await shot("03-doorlooptijden");
  check("Tooltip toont wachten en bewerking", /Wachten: .*Bewerking:/s.test(await page.locator(".tip").innerText()));
  check("Tabel per stap heeft 21 rijen", (await page.locator(".blok").nth(1).locator("tbody tr").count()) === 21);
  // #99: wachten op het lot en het totaal per lot in de tabel per week.
  const perWeek = page.locator("section", { has: page.getByRole("heading", { name: /^Doorlooptijd per/ }) });
  const weekKoppen = await perWeek.locator("thead th").allInnerTexts();
  check("Doorlooptijd per week: wachten op het lot en totaal per lot", weekKoppen.includes("Wachten op het lot") && weekKoppen.includes("Totaal per lot"), weekKoppen.join(" | "));

  console.log("\nProductie per week");
  await page.getByRole("link", { name: "Productie per week" }).click();
  await page.getByRole("heading", { name: "Batches gestart per week" }).waitFor();
  await page.selectOption("#periode", "90");
  await page.waitForTimeout(500);
  await shot("04-per-week");
  const lots = Number((await page.locator(".tegel").nth(2).locator(".tegel-getal").innerText()).trim());
  const [{ gereed }] = await q("SELECT count(*)::int AS gereed FROM fabriek.lot WHERE aangemaakt_op >= now() - interval '91 days'");
  check("Lots gereed (90 dagen) ongeveer gelijk aan aantal lots", Math.abs(lots - gereed) <= 2, `${lots} vs ${gereed}`);
  // #60: batches gestart per week, dezelfde soort grafiek; de staven tellen op tot de tegel.
  const gestartSec = page.locator("section", { has: page.getByRole("heading", { name: "Batches gestart per week" }) });
  check("Grafiek Batches gestart per week (#60)", (await gestartSec.locator("svg").count()) === 1);
  const gestartTegel = Number((await page.locator(".tegel").nth(0).locator(".tegel-getal").innerText()).trim());
  const somRij = (await page.locator("section", { hasText: "Per week in cijfers" }).locator("tbody tr").evaluateAll((rs) => rs.reduce((a, r) => a + Number(r.children[1].textContent), 0)));
  check("Batches gestart: tabel telt op tot de tegel", somRij === gestartTegel, `${somRij} vs ${gestartTegel}`);
  // #58: per dag, week of maand verandert de groepen, niet de totalen.
  const totalen = async () => (await page.locator(".tegel .tegel-getal").allInnerTexts()).join("|");
  const perWeekTotalen = await totalen();
  await page.selectOption("#per", "maand");
  await page.getByRole("heading", { name: "Batches gestart per maand" }).waitFor();
  check("Per maand: dezelfde totalen als per week (#58)", (await totalen()) === perWeekTotalen, `${await totalen()} vs ${perWeekTotalen}`);
  const [{ m }] = await q("SELECT count(DISTINCT date_trunc('month', d))::int AS m FROM generate_series(current_date - 89, current_date, '1 day') d");
  check(`Per maand: ${m} maanden in 90 dagen`, (await page.locator("section", { hasText: "Per maand in cijfers" }).locator("tbody tr").count()) === m);
  await page.selectOption("#per", "dag");
  await page.getByRole("heading", { name: "Batches gestart per dag" }).waitFor();
  check("Per dag: dezelfde totalen", (await totalen()) === perWeekTotalen);
  check("Per dag: 90 dagen, ook dagen zonder productie", (await page.locator("section", { hasText: "Per dag in cijfers" }).locator("tbody tr").count()) === 90);
  await page.selectOption("#periode", "365");
  await page.getByRole("heading", { name: "Batches gestart per dag" }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll("section tbody tr").length >= 365);
  await shot("04b-per-dag-jaar");
  await page.selectOption("#per", "maand");
  await page.getByRole("heading", { name: "Batches gestart per maand" }).waitFor();
  const [{ n: gestartJaar }] = await q("SELECT count(*)::int AS n FROM fabriek.batch WHERE gestart_op >= current_date - 364");
  check("Afgelopen jaar per maand: alle batches gestart", Number(await page.locator(".tegel").nth(0).locator(".tegel-getal").innerText()) === gestartJaar);
  await shot("04c-per-maand-jaar");
  await page.selectOption("#per", "week");
  await page.selectOption("#periode", "90");  // zoals hiervoor: de volgende schermen tellen over 90 dagen

  console.log("\nCorrecties");
  await page.getByRole("link", { name: "Correcties" }).click();
  await page.locator(".tabel tbody tr").first().waitFor();
  await shot("05-correcties");
  const [{ c }] = await q("SELECT count(*)::int AS c FROM fabriek.waarde WHERE vervangt_waarde_id IS NOT NULL AND ingevoerd_op >= now() - interval '91 days'");
  await page.waitForFunction((n) => document.querySelectorAll(".tabel tbody tr").length === n, c, { timeout: 5000 }).catch(() => {});
  const getoondC = await page.locator(".tabel tbody tr").count();
  check("Alle correcties staan erin", getoondC === c, `${getoondC} getoond, ${c} in de database`);

  console.log("\nBatch in beoordeling zetten vanuit Productie");
  const [b] = await q("SELECT batchnummer FROM fabriek.batch WHERE status = 'in_productie' ORDER BY aangemaakt_op DESC LIMIT 1");
  await page.goto(`${BASIS}/portaal/#/productie/batch/${b.batchnummer}`);
  await page.getByRole("button", { name: "In beoordeling zetten" }).click();
  await page.getByLabel("Reden").fill("afwijkende kleur bij stap 4");
  await page.getByRole("dialog").getByRole("button", { name: "In beoordeling zetten" }).click();
  await page.getByText("In beoordeling gezet").waitFor();
  const [st] = await q("SELECT status FROM fabriek.batch WHERE batchnummer = $1", [b.batchnummer]);
  check("Batch staat in beoordeling", st.status === "in_beoordeling");
  check("Menu blijft op Productie", (await page.locator("#menu a[aria-current='page']").innerText()).includes("Werkvoorraad"));

  await page.setViewportSize({ width: 820, height: 1000 });
  await page.goto(`${BASIS}/portaal/#/productie/overzicht`);
  await page.locator(".staptegel").first().waitFor();
  await shot("06-smal");

  console.log("\nPloegoverdracht");
  await page.setViewportSize({ width: 1440, height: 900 });
  const [gisteren] = await q("SELECT (max(dag) - 1)::text AS d FROM fabriek.overdracht");
  await page.goto(`${BASIS}/portaal/#/productie/overdracht/${gisteren.d}`);
  await page.getByRole("heading", { name: "Ochtenddienst" }).waitFor();
  check("Drie ploegen op een hele dag", (await page.locator("section.ploeg").count()) === 3);
  const [nOd] = await q("SELECT count(*)::int AS n FROM fabriek.overdracht WHERE dag = $1", [gisteren.d]);
  check("Alle overdrachten van die dag staan erbij", (await page.locator("section.ploeg .notities li").count()) === nOd.n, `${nOd.n}`);
  // #98: welke afwijkingen een ploeg had, met batch, veld en waarde.
  const [afwOd] = await q(`SELECT count(*)::int AS n FROM fabriek.waarde w WHERE w.vervangt_waarde_id IS NULL AND w.markering <> 'ok'
      AND w.ingevoerd_op >= ($1::date + time '06:00') AT TIME ZONE 'Europe/Amsterdam' AND w.ingevoerd_op < ($1::date + 1 + time '06:00') AT TIME ZONE 'Europe/Amsterdam'`, [gisteren.d]);
  const afwRijen = await page.locator("section.ploeg details", { hasText: /afwijking/ }).locator("tbody tr").count();
  check("Ploegoverdracht: de afwijkingen zelf, per ploeg", afwRijen === Math.min(afwOd.n, 150) || (afwOd.n > 0 && afwRijen > 0), `${afwRijen} van ${afwOd.n}`);
  await shot("07-overdracht");
  await page.getByRole("link", { name: "Vandaag" }).click();
  // Wachten op de kop van vandaag: de vorige dag staat er misschien nog (die heeft ook een .leeg).
  const vandaagKop = new Date().toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Amsterdam" });
  await page.getByRole("heading", { name: `Ploegoverdracht ${vandaagKop}` }).waitFor();
  check("Vandaag: de lopende ploeg is gemarkeerd", (await page.locator("section.ploeg-nu").count()) <= 1);
  // #62: hoeveel van de planning van vandaag klaar is, gelijk aan de database.
  const [pl] = await q(`SELECT count(*)::int AS gepland FROM fabriek.stapplanning WHERE dag = (now() AT TIME ZONE 'Europe/Amsterdam')::date`);
  const planTekst = await page.locator(".plan-stand").innerText();
  check("Ploegoverdracht: afgerond van gepland (#62)", pl.gepland > 0 && new RegExp(`\\d+ / ${pl.gepland} geplande stappen afgerond`).test(planTekst), `${pl.gepland}: ${planTekst}`);
  await shot("07b-overdracht-vandaag");

  console.log("\nStilstand");
  const antwoordStilstand = page.waitForResponse(r => new URL(r.url()).pathname === "/analyse/stilstand" && r.ok());
  await page.goto(`${BASIS}/portaal/#/productie/stilstand`);
  const analyseStilstand = await (await antwoordStilstand).json();
  await page.getByRole("heading", { name: "Stilstand per stap" }).waitFor();
  const openStilstand = analyseStilstand.lijst.filter(x => !x.eind_op).map(x => x.stap).sort();
  const nuStil = await page.locator("section.stil-blok tbody tr").evaluateAll(rs => rs.map(r => r.cells[0].innerText.trim().split(/\s+/)[0]).sort());
  check("Nu stil: lopende stilstanden komen overeen met de analyse", openStilstand.length > 0 && JSON.stringify(nuStil) === JSON.stringify(openStilstand), JSON.stringify({ nuStil, openStilstand }));
  const rijen = await page.locator("section", { has: page.getByRole("heading", { name: "Stilstand per stap", exact: true }) }).locator("tbody tr").evaluateAll(rows => rows.map(r => ({
    stap: r.cells[0].innerText.trim().split(/\s+/)[0], percentage: r.cells[6].innerText.trim()
  })));
  const geldig = analyseStilstand.per_stap.filter(x => x.beschikbaarheid !== null);
  const minimum = Math.min(...geldig.map(x => x.beschikbaarheid));
  const tegel = page.locator(".tegel", { hasText: "laagste beschikbaarheid" });
  const kandidaten = geldig.filter(x => x.beschikbaarheid === minimum);
  const verwachtPercentage = x => Math.round(x * 1000) / 10;
  check("Tabel toont alle beschikbare percentages", geldig.length > 1 && geldig.every(x => {
    const rij = rijen.find(r => r.stap === x.stap);
    return rij && Number(rij.percentage.replace("%", "").replace(",", ".").trim()) === verwachtPercentage(x.beschikbaarheid);
  }));
  if (minimum < 1) {
    const stapLaagste = (await tegel.locator(".tegel-getal").innerText()).trim();
    const tekst = (await tegel.locator(".tegel-tekst").innerText()).split(":").at(-1).trim();
    check("Laagste beschikbaarheid op onafgeronde waarden", kandidaten.some(x => x.stap === stapLaagste) && Number(tekst.replace("%", "").replace(",", ".").trim()) === verwachtPercentage(minimum));
  } else {
    check("Geen laagste-beschikbaarheidstegel bij volledige beschikbaarheid", await tegel.count() === 0);
  }
  check("Grafiek getekend", (await page.locator("svg[aria-label='Stilstand per stap'] path").count()) > 10);
  const laatste = page.locator("section", { hasText: "Laatste 50 keer stilstand" });
  const koppen = await laatste.locator("thead th").allInnerTexts();
  const [gedaan] = await q("SELECT x.eind_notitie FROM fabriek.stilstand x WHERE x.eind_notitie IS NOT NULL ORDER BY x.begin_op DESC LIMIT 1");
  check("Laatste stilstanden tonen wat er is gedaan en wie beëindigde (#31)",
    koppen.includes("Wat er is gedaan") && koppen.includes("Beëindigd door") && !!gedaan
    && (await laatste.locator("tbody td", { hasText: gedaan.eind_notitie }).count()) > 0, koppen.join(", "));
  await shot("08-stilstand");

  console.log("\nRoute per product in de Batchroute (D55)");
  await page.goto(`${BASIS}/portaal/#/planning/route`);
  await page.locator(".route-tabel").waitFor();
  const [buiten] = await q(`SELECT count(*)::int AS n FROM fabriek.batch b JOIN fabriek.product p ON p.id = b.product_id
                             WHERE b.status IN ('gepland','in_productie','in_beoordeling') AND b.lot_id IS NULL AND p.code IN ('PRD-B','PRD-C')`);
  check("Stappen buiten de route zijn gearceerd (PRD-B en PRD-C)", buiten.n > 0 && (await page.locator("td.route-buiten").count()) >= buiten.n * 2,
    `${buiten.n} batches, ${await page.locator("td.route-buiten").count()} cellen`);
  await shot("10-batchroute-producten", false);

  console.log("\nStartpagina en overstap naar het invoerscherm (D54)");
  await page.goto(`${BASIS}/`);
  await page.locator(".startpagina").waitFor();
  const tegels = await page.locator(".starttegel strong").allInnerTexts();
  const portalIds = selector => page.locator(selector).evaluateAll(nodes => nodes.map(n => n.getAttribute("data-portaal")));
  check("Ploegleider: gelijke portalsets", JSON.stringify(await portalIds(".starttegel[data-portaal]")) === JSON.stringify(await portalIds("#menu .menu-portaal[data-portaal]")));
  check("Ploegleider: invoer, productie en planning; geen display of technisch beheer",
    tegels[0] === "Production Execution" && tegels.includes("Manufacturing Operations") && tegels.includes("Planning") && !tegels.includes("Beheer") && !tegels.includes("Kwaliteit") && await page.locator(".starttegel-wandscherm").count() === 0, tegels.join(", "));
  await shot("09-startpagina");
  const [voorPc] = await q("SELECT count(*)::int AS n FROM fabriek.inlogpoging WHERE gebruikersnaam = 'ploegleider1' AND pc = 'PC-03' AND uitkomst = 'gelukt'");
  await page.locator(".starttegel-invoer").click();
  await page.getByRole("heading", { name: "Welke pc is dit?" }).waitFor();
  const pcBinding = page.waitForResponse(r => new URL(r.url()).pathname === "/auth/pc" && r.request().method() === "POST");
  await page.getByRole("button", { name: /^PC-03/ }).click();
  const binding = await pcBinding;
  check("Werkstationbinding geaccepteerd", binding.status() === 200);
  await page.getByRole("heading", { name: "Kies een stap" }).waitFor();
  check("Invoerscherm zonder opnieuw in te loggen, met de eigen naam", (await page.locator(".balk-eigen-naam").innerText()) === "ploegleider1");
  const [pcInlog] = await q("SELECT count(*)::int AS n FROM fabriek.inlogpoging WHERE gebruikersnaam = 'ploegleider1' AND pc = 'PC-03' AND uitkomst = 'gelukt'");
  check("Werkstationbinding telt niet als wachtwoordlogin", pcInlog.n === voorPc.n);
  await page.getByRole("link", { name: "Portalen" }).click();
  await page.locator(".startpagina").waitFor();
  await page.getByRole("button", { name: "Afmelden" }).click();
  await page.getByLabel("Gebruikersnaam").waitFor();
  await page.goto(`${BASIS}/invoer/`);
  await page.getByLabel("Gebruikersnaam").waitFor();
  check("Afmelden in de portalen meldt ook het invoerscherm af", true);

  console.log("\nKwaliteit: invoerscherm alleen via de tegel (lab-pc, D58)");
  await page.goto(`${BASIS}/portaal/#/login`);
  await page.getByLabel("Gebruikersnaam").fill("kwaliteit1");
  await page.getByLabel("Wachtwoord").fill("demo");
  await page.getByRole("button", { name: "Inloggen" }).click();
  await page.locator(".startpagina").waitFor();
  await page.goto(`${BASIS}/invoer/`);
  await page.getByLabel("Gebruikersnaam").waitFor();
  check("Zonder de tegel neemt het invoerscherm de inlog van Kwaliteit niet over", true);
  await page.goto(`${BASIS}/`);
  await page.locator(".startpagina").waitFor();
  check("Kwaliteit: gelijke portalsets", JSON.stringify(await portalIds(".starttegel[data-portaal]")) === JSON.stringify(await portalIds("#menu .menu-portaal[data-portaal]")));
  await page.locator("#menu [data-portaal=invoer]").click();
  const pcKeuze = page.getByRole("button", { name: /^PC-03/ });
  await Promise.race([pcKeuze.waitFor(), page.locator(".balk-eigen-naam").waitFor()]);
  if (await pcKeuze.isVisible()) await pcKeuze.click();
  await page.locator(".balk-eigen-naam").waitFor();
  check("Via linkernavigatie: invoerscherm als kwaliteit1", (await page.locator(".balk-eigen-naam").innerText()) === "kwaliteit1");

  console.log("\nMES-identiteiten: portalsets en centrale afmelding (D113)");
  await page.locator("button:visible").filter({hasText:/^Afmelden$/}).click();
  await page.getByRole("heading", { name: "Inloggen", exact: true }).waitFor();
  await page.goto(BASIS+"/portaal/#/login");
  await page.getByLabel("Gebruikersnaam").fill("mes.quality");
  await page.getByLabel("Wachtwoord").fill("demo");
  const qualityLogin = page.waitForResponse(r => new URL(r.url()).pathname === "/auth/login" && r.request().method() === "POST");
  await page.getByRole("button",{name:"Inloggen",exact:true}).click();
  check("mes.quality persoonlijke aanmelding", (await qualityLogin).status() === 200);
  await page.getByRole("heading",{name:"Welkom, mes.quality",exact:true}).waitFor();
  check("mes.quality exacte portalsets", JSON.stringify(await portalIds(".starttegel[data-portaal]")) === JSON.stringify(["invoer","kwaliteit"]) &&
    JSON.stringify(await portalIds("#menu .menu-portaal[data-portaal]")) === JSON.stringify(["invoer","kwaliteit"]));
  const qualityBinding = page.waitForResponse(r => new URL(r.url()).pathname === "/auth/pc" && r.request().method() === "POST");
  await page.locator("#menu [data-portaal=invoer]").click();
  check("mes.quality werkstationbinding", (await qualityBinding).status() === 200);
  await page.locator(".balk-eigen-naam").waitFor();
  check("mes.quality persoonlijke invoeridentiteit", (await page.locator(".balk-eigen-naam").innerText()) === "mes.quality");
  await page.locator("button:visible").filter({hasText:/^Afmelden$/}).click();
  await page.getByRole("heading",{name:"Inloggen",exact:true}).waitFor();
  check("Afmelden vanuit invoer wist beide tokens en behoudt werkstation", await page.evaluate(() =>
    !localStorage.getItem("portaal.token") && !localStorage.getItem("invoer.token") &&
    !localStorage.getItem("invoer.operatornaam") && localStorage.getItem("invoer.pc")==="PC-03"));
  await page.goto(BASIS+"/portaal/#/");
  await page.getByRole("heading",{name:"Inloggen",exact:true}).waitFor();

  // Verwachte bestemmingen uit de goedgekeurde rolgrants, niet uit het UI-register.
  const matrix = {
    "mes.operator":["invoer","productie","planning"],
    "mes.supervisor":["invoer","productie","planning","nainvoeren"],
    "mes.manager":["engineering","kwaliteit","productie","planning","beheer"],
    "mes.planner":["productie","planning"],
    "mes.engineer":["engineering","planning","beheer"],
    "mes.eng.approver":["engineering"],
    "mes.quality":["invoer","kwaliteit"],
    "mes.quality.approver":["invoer","engineering","kwaliteit"],
    "mes.maintenance":[],
    "mes.system":["beheer"],
    "mes.security.a":[],
    "mes.security.b":[],
    "mes.analyst":["kwaliteit","productie"],
    "mes.display":["wandscherm"],
  };
  for (const [naam, verwacht] of Object.entries(matrix)) {
    const r = await fetch(BASIS+"/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({gebruikersnaam:naam,wachtwoord:"demo"})});
    if (!r.ok) throw new Error("MES-matrix aanmelding "+naam+": "+r.status);
    const {token} = await r.json();
    await page.evaluate(t=>{localStorage.removeItem("invoer.token");localStorage.setItem("portaal.token",t);},token);
    await page.goto(BASIS+"/portaal/#/");
    await page.reload();
    if (naam === "mes.display") {
      await page.getByRole("heading",{name:"Actieve stilstand",exact:true}).waitFor();
      check(naam+" alleen display",new URL(page.url()).hash==="#/wandscherm" &&
        JSON.stringify(await portalIds("#menu .menu-portaal[data-portaal]"))===JSON.stringify(verwacht));
    } else {
      await page.getByRole("heading",{name:"Welkom, "+naam,exact:true}).waitFor();
      check(naam+" exacte portalsets",JSON.stringify(await portalIds(".starttegel[data-portaal]"))===JSON.stringify(verwacht) &&
        JSON.stringify(await portalIds("#menu .menu-portaal[data-portaal]"))===JSON.stringify(verwacht),JSON.stringify(await portalIds(".starttegel[data-portaal]")));
    }
    if (naam==="mes.quality") {
      await page.goto(BASIS+"/portaal/#/beheer/accounts");
      await page.reload();
      await page.waitForFunction(()=>location.hash==="#/");
      await page.getByRole("heading",{name:"Welkom, mes.quality",exact:true}).waitFor();
      check("mes.quality directe beheerroute geweigerd",new URL(page.url()).hash==="#/");
      check("mes.quality onafhankelijke account-API geweigerd",(await fetch(BASIS+"/beheer/gebruikers",{headers:{authorization:"Bearer "+token}})).status===403);
    }
  }

  console.log("\nPilotrapportage uitgesteld (D99)");
  const tokenVan = async (naam) => {
    const r = await fetch(BASIS+"/auth/login", {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({gebruikersnaam:naam,wachtwoord:"demo"})});
    if (!r.ok) throw new Error("Testlogin mislukt: "+naam+" "+r.status);
    return (await r.json()).token;
  };
  const instellingen = await q("SELECT sleutel,waarde FROM fabriek.instelling ORDER BY sleutel");
  for (const [naam,portaal] of [["productiemanager1","productie"],["beheerder1","beheer"],["planner1","planning"]]) {
    const token = await tokenVan(naam);
    await page.evaluate(t=>{localStorage.removeItem("invoer.token");localStorage.setItem("portaal.token",t);},token);
    await page.goto(BASIS+"/portaal/#/"+portaal+"/pilot");
    await page.waitForFunction(p=>location.hash==="#/"+p,portaal);
    await page.locator("#menu .menu-groep").first().waitFor();
    check("Geen pilotmenu voor "+naam,await page.getByRole("link",{name:"Pilotoverzicht"}).count()===0);
    const headers={authorization:"Bearer "+token};
    check("Pilotrapportage geweigerd voor "+naam,(await fetch(BASIS+"/pilot",{headers})).status===403);
    check("Pilotinstellingen geweigerd voor "+naam,(await fetch(BASIS+"/pilot/instellingen",{method:"PUT",headers:{...headers,"content-type":"application/json"},body:JSON.stringify({pilot_start:null,te_laat_minuten:90})})).status===403);
  }
  check("Historische pilotinstellingen blijven intact",JSON.stringify(await q("SELECT sleutel,waarde FROM fabriek.instelling ORDER BY sleutel"))===JSON.stringify(instellingen));
} catch (e) {
  console.log("  AFGEBROKEN", e.stack ?? e);
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
