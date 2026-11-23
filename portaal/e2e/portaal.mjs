// Test van het Portaal Kwaliteit in Chrome, op data van tools/genereer_testdata.py.
// Gebruik: node e2e/portaal.mjs   (start zelf de API op poort 3457)
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import pg from "pg";

const DB = process.env.DATABASE_URL ?? "postgres://postgres@localhost/batchgui?host=/tmp&port=5433";
const SHOTS = process.env.SHOTS ?? "/tmp/shots-portaal";
const BASIS = "http://localhost:3457";
mkdirSync(SHOTS, { recursive: true });

let fouten = 0;
const check = (naam, ok, extra = "") => {
  console.log(`${ok ? "  OK  " : "  FOUT"} ${naam}${!ok && extra ? `  [${extra}]` : ""}`);
  if (!ok) fouten++;
};

const api = spawn("npx", ["tsx", "src/index.ts"], {
  cwd: new URL("../../api/", import.meta.url).pathname,
  env: { ...process.env, DATABASE_URL: DB, JWT_GEHEIM: "e2e-".repeat(10), POORT: "3457",
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
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "nl-NL", timezoneId: "Europe/Amsterdam" });
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("  PAGINAFOUT", e.message); fouten++; });
const shot = (naam, fullPage = true) => page.screenshot({ path: `${SHOTS}/${naam}.png`, fullPage });

async function login(naam) {
  await page.goto(`${BASIS}/portaal/#/login`);
  await page.getByLabel("Gebruikersnaam").fill(naam);
  await page.getByLabel("Wachtwoord").fill("demo");
  await page.getByRole("button", { name: "Inloggen" }).click();
  // Na het inloggen de startpagina (D54); de test gaat verder in het portaal van de rol.
  if (await page.locator(".startpagina").waitFor({ timeout: 8000 }).then(() => true, () => false)) await page.locator(`.starttegel-${await page.evaluate(() => {
    const rol = JSON.parse(atob(localStorage.getItem("portaal.token").split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).rol;
    return { ploegleider: "productie", productiemanager: "productie", beheerder: "beheer", planner: "planning" }[rol] ?? "kwaliteit";
  })}`).click();
}

try {
  console.log("\nInloggen");
  await login("operator.a");
  await page.getByRole("heading", { name: "Welke pc is dit?" }).waitFor();
  check("Operator met alleen het invoerscherm gaat daar meteen heen", page.url().includes("/invoer/"));
  await page.evaluate(() => localStorage.clear());

  await login("kwaliteit1");
  await page.getByRole("heading", { name: "Kwaliteit", exact: true }).waitFor();
  await page.locator(".tegel").first().waitFor();
  await page.locator(".grafiek > svg").first().waitFor();
  await page.waitForTimeout(300);
  await shot("01-overzicht");
  check("Kop boven een getalkolom staat rechts (#43)", (await page.locator("th.rechts", { hasText: "Afwijkend" }).count()) === 1);
  check("Kop boven een tekstkolom staat links", (await page.locator("th.rechts", { hasText: "Veld" }).count()) === 0);
  await page.getByRole("link", { name: /Te beoordelen/ }).locator(".teller:not(:empty)").waitFor();
  const inBeoordeling = Number((await q("SELECT count(*) AS n FROM fabriek.batch WHERE status = 'in_beoordeling'"))[0].n);
  const keuringOpen = Number((await q("SELECT count(*) AS n FROM fabriek.keuring WHERE status = 'open'"))[0].n);
  check(`Teller in het menu: ${inBeoordeling} in beoordeling + ${keuringOpen} wacht op Kwaliteit (#64)`, inBeoordeling >= 2 && keuringOpen >= 1
    && (await page.getByRole("link", { name: /Te beoordelen/ }).locator(".teller:not(:empty)").innerText()) === String(inBeoordeling + keuringOpen));
  check("Grafiek afwijkingen per week staat er", (await page.locator(".grafiek > svg path").count()) > 3);
  check("S5.1 staat bovenaan bij de velden met afwijkingen", (await page.locator(".tabel tbody tr").first().innerText()).includes("S5.1"));
  // #59: een week kiezen geeft de lijst met afwijkingen van die week.
  const week = page.locator(".grafiek rect.kiesbaar").last();
  const weekLabel = await week.getAttribute("aria-label");
  const [, wTol, wGr] = weekLabel.match(/(\d+) buiten tolerantie, (\d+) buiten grens/);
  await week.click();
  await page.locator(".week-lijst h3").waitFor();
  const weekRijen = await page.locator(".week-lijst tbody tr").count();
  check("Klik op een week: lijst met precies de afwijkingen van die week (#59)", weekRijen === Number(wTol) + Number(wGr), `${weekRijen} vs ${weekLabel}`);
  check("De gekozen week is gemarkeerd", (await page.locator(".grafiek rect.gekozen[aria-pressed='true']").count()) === 1);
  await page.locator(".week-lijst").scrollIntoViewIfNeeded();
  await shot("01b-overzicht-week-gekozen");
  await page.locator(".grafiek rect.kiesbaar").first().focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction((l) => document.querySelector(".week-lijst h3") && document.querySelector(".grafiek rect.gekozen")?.getAttribute("aria-label") !== l, weekLabel);
  check("Ook met het toetsenbord een week kiezen", true);
  // #58: per dag; een dag kiezen geeft de afwijkingen van die dag.
  await page.selectOption("#per", "dag");
  await page.getByRole("heading", { name: "Afwijkingen per dag" }).waitFor();
  const dagen = await page.locator(".grafiek rect[tabindex]").count();
  check("Per dag: elke dag van de periode een staaf, ook zonder afwijkingen (#58)", dagen === 30, `${dagen}`);
  const dag = page.locator(".grafiek rect.kiesbaar").last();
  const dagLabel = await dag.getAttribute("aria-label");
  const [, dTol, dGr] = dagLabel.match(/(\d+) buiten tolerantie, (\d+) buiten grens/);
  await dag.click();
  await page.waitForFunction(() => document.querySelector(".week-lijst h3"));
  await page.waitForFunction((n) => document.querySelectorAll(".week-lijst tbody tr").length === n, Number(dTol) + Number(dGr), { timeout: 5000 }).catch(() => {});
  check("Klik op een dag: de afwijkingen van die dag", (await page.locator(".week-lijst tbody tr").count()) === Number(dTol) + Number(dGr), dagLabel);
  await shot("01c-overzicht-per-dag");
  await page.selectOption("#per", "week");
  await page.getByRole("heading", { name: "Afwijkingen per week" }).waitFor();
  await page.selectOption("#periode", "90");
  await page.locator(".tegel").first().waitFor();
  await page.waitForTimeout(400);
  await shot("02-overzicht-90-dagen");

  console.log("\nTrend per veld");
  await page.locator(".tabel tbody tr").first().getByRole("link", { name: "Trend bekijken" }).click();
  await page.locator(".grafiek > svg").waitFor();
  await page.waitForTimeout(300);
  const box = await page.locator(".grafiek > svg").boundingBox();
  await page.mouse.move(box.x + box.width * 0.93, box.y + box.height * 0.5);
  await page.locator(".tip:not([hidden])").waitFor();
  await shot("03-trend-S5.1", false);
  check("Tooltip toont batch en meting", /B-\d{4}-\d{4}/.test(await page.locator(".tip").innerText()));
  const rechts = await page.locator(".tip").innerText();
  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.5);
  await page.waitForFunction((r) => document.querySelector(".tip:not([hidden])")?.textContent !== r.replace(/\n/g, ""), rechts, { timeout: 3000 }).catch(() => {});
  const links = await page.locator(".tip").innerText();
  check("Tooltip volgt de muis: links een andere meting dan rechts", links !== rechts, `${links} | ${rechts}`);
  check("Tooltip zegt 'instelling', niet 'setting'", !/setting/.test(links + rechts));
  const feiten = await page.locator(".feiten").innerText();
  check("Trend laat zien dat S5.1 oploopt (gemiddelde eind hoger dan begin)", (() => {
    const m = feiten.match(/([\d,]+) °C naar ([\d,]+) °C/); return m && parseFloat(m[2].replace(",", ".")) > parseFloat(m[1].replace(",", ".")) + 2;
  })(), feiten);
  await page.selectOption("#f-veld", "S9.2");
  await page.locator(".grafiek > svg").waitFor();
  await page.waitForTimeout(300);
  await shot("04-trend-S9.2", false);

  console.log("\nProductkiezer en grenzen per product (D55)");
  const metingen = async () => Number((await page.locator(".feiten div", { hasText: "Metingen" }).locator("dd").innerText()).trim());
  const alleN = await metingen();
  // #89: producten met verschillende grenzen door elkaar: geen grens- of tolerantielijnen, wel uitleg.
  check("Alle producten: bij S9.2 geen grenslijnen en uitleg over de verschillende grenzen",
    (await page.locator(".grafiek > svg .grenslijn").count()) === 0 && (await page.locator("main p", { hasText: "producten met verschillende grenzen" }).count()) === 1);
  // #93: de productkeuze staat geel in de filterbalk, niet meer in het menu.
  check("Productkeuze in de filterbalk, niet in het menu", (await page.locator(".filters .filter-product #product-keuze").count()) === 1
    && (await page.locator("#menu #product-keuze").count()) === 0);
  const oudeFilter = await page.$(".filter-product");
  await page.selectOption("#product-keuze", "PRD-C");
  await page.waitForFunction((el) => !el.isConnected, oudeFilter);
  check("Gekozen product: voller geel", await page.locator(".filter-product.gekozen").waitFor({ timeout: 10000 }).then(() => true, () => false));
  await page.locator(".grafiek > svg").waitFor();
  const cN = await metingen();
  const [db9] = await q(`SELECT count(*)::int AS n FROM fabriek.waarde_actueel w JOIN fabriek.veld v ON v.id = w.veld_id
                          JOIN fabriek.stapregistratie r ON r.id = w.stapregistratie_id JOIN fabriek.product p ON p.id = r.product_id
                         WHERE v.code = 'S9.2' AND p.code = 'PRD-C' AND w.ingevoerd_op >= current_date - 89`);
  check("PRD-C: alleen de metingen van dat product", cN > 0 && cN < alleN && cN === db9.n, `${cN} van ${alleN}, database ${db9.n}`);
  check("PRD-C: grenslijnen van PRD-C en geen uitleg", (await page.locator(".grafiek > svg .grenslijn").count()) === 2
    && (await page.locator("main p", { hasText: "producten met verschillende grenzen" }).count()) === 0);
  await page.waitForTimeout(300);
  await shot("04b-trend-S9.2-PRD-C", false);
  await page.getByRole("link", { name: "Regelkaarten" }).click();
  await page.locator(".tabel tbody tr").first().waitFor();
  check("Productkiezer onthouden bij een ander scherm", (await page.locator("#product-keuze").inputValue()) === "PRD-C");
  const rij92 = await page.locator(".tabel tbody tr", { hasText: "S9.2 Gewicht" }).innerText();
  check("Regelkaarten met PRD-C: S9.2 heeft een Cpk", /\d,\d/.test(rij92) && !rij92.includes("kies een product"), rij92);
  await page.reload();
  await page.locator(".tabel tbody tr").first().waitFor();
  check("Ook na herladen nog PRD-C", (await page.locator("#product-keuze").inputValue()) === "PRD-C");
  await page.selectOption("#product-keuze", "");
  await page.locator(".tabel tbody tr", { hasText: "kies een product" }).first().waitFor();
  check("Alle producten: bij S9.2 staat 'kies een product' in plaats van een Cpk",
    (await page.locator(".tabel tbody tr", { hasText: "S9.2 Gewicht" }).innerText()).includes("kies een product"));
  await page.getByRole("link", { name: "Lotpaspoort" }).click();
  await page.getByRole("heading", { name: "Lotpaspoort" }).waitFor();
  await page.locator(".tabel tbody tr").first().waitFor();
  const alleLots = await page.locator(".tabel tbody tr").count();
  await page.selectOption("#product-keuze", "PRD-C");
  await page.waitForFunction((n) => document.querySelectorAll(".tabel tbody tr").length !== n || [...document.querySelectorAll(".tabel tbody tr")].every((r) => r.children[1]?.textContent === "PRD-C"), alleLots);
  const lotProducten = await page.locator(".tabel tbody tr td:nth-child(2)").allInnerTexts();
  check("Lotpaspoort: productkeuze toont alleen lots van PRD-C (#93)", lotProducten.length > 0 && lotProducten.every((t) => t === "PRD-C"), lotProducten.join(","));
  await page.selectOption("#product-keuze", "");

  console.log("\nTe beoordelen");
  await page.getByRole("link", { name: /Te beoordelen/ }).click();
  await page.getByRole("heading", { name: "Te beoordelen" }).waitFor();
  await page.locator(".tabel tbody tr").first().waitFor();
  await shot("05-te-beoordelen");
  // Eerste tabel: batches in beoordeling; daaronder wat op een meting van Kwaliteit wacht (#64).
  const tabelBeoordeling = page.locator("main .tabel").first();
  const rijen = await tabelBeoordeling.locator("tbody tr").count();
  check("Alle batches in beoordeling staan in de lijst", rijen === inBeoordeling, String(rijen));
  check("Wacht op meting van Kwaliteit staat eronder", (await page.locator("section", { hasText: "Wacht op meting van Kwaliteit" }).locator("tbody tr").count()) === keuringOpen);
  const eerste = (await page.locator(".tabel tbody tr").first().locator("a").innerText()).trim();
  const tweede = (await page.locator(".tabel tbody tr").nth(1).locator("a").innerText()).trim();
  await page.locator(".tabel tbody tr").first().getByRole("button", { name: "OK", exact: true }).click();
  await page.getByLabel("Toelichting").fill("binnen specificatie na hermeting");
  await page.getByRole("button", { name: "OK: vrijgeven" }).click();
  await page.waitForFunction((n) => document.querySelector("main .tabel")?.querySelectorAll("tbody tr").length === n, inBeoordeling - 1);
  await page.locator(".tabel tbody tr").first().getByRole("button", { name: "NOK", exact: true }).click();
  await page.getByLabel("Reden van afkeur").fill("kleur buiten specificatie");
  await page.getByRole("button", { name: "NOK: afkeuren" }).click();
  if (inBeoordeling === 2) await page.getByText("Er staan geen batches in beoordeling.").waitFor();
  else await page.waitForFunction((n) => document.querySelector("main .tabel")?.querySelectorAll("tbody tr").length === n, inBeoordeling - 2);
  const st = Object.fromEntries((await q("SELECT batchnummer, status FROM fabriek.batch WHERE batchnummer = ANY($1)", [[eerste, tweede]])).map((r) => [r.batchnummer, r.status]));
  check("OK: batch weer in productie", st[eerste] === "in_productie", JSON.stringify(st));
  check("NOK: batch afgekeurd", st[tweede] === "afgekeurd", JSON.stringify(st));

  await page.goto(`${BASIS}/portaal/#/kwaliteit/batch/${tweede}`);
  await page.getByRole("heading", { name: "Besluiten" }).waitFor();
  await shot("06-batch-afgekeurd");

  console.log("\nHerbewerkingen met stand (#61)");
  await page.getByRole("link", { name: "Herbewerkingen en afkeur" }).click();
  await page.getByRole("heading", { name: /Lopende herbewerkingen/ }).waitFor();
  const [hs] = await q(`SELECT count(*) FILTER (WHERE stand = 'te_plannen')::int AS t, count(*) FILTER (WHERE stand = 'gepland')::int AS g FROM fabriek.herbewerking_stand`);
  const tegelGetal = async (t) => Number(await page.locator(".tegel", { hasText: t }).locator(".tegel-getal").innerText());
  check("Tegels: nog te plannen en gepland zoals in de database", (await tegelGetal("nog te plannen")) === hs.t && (await tegelGetal("herbewerkingen gepland")) === hs.g && hs.t >= 1 && hs.g >= 1, JSON.stringify(hs));
  check("Lopende herbewerking met stand en wie hem aanmaakte",
    (await page.locator("section", { hasText: "Lopende herbewerkingen" }).innerText()).includes("productiemanager1")
    && (await page.locator(".label-stand-te_plannen").count()) >= 1);
  await shot("11b-herbewerkingen");
  // Kwaliteit maakt een herbewerking aan bij een batch in productie.
  const [hbatch] = await q(`SELECT b.batchnummer FROM fabriek.batch b WHERE b.status = 'in_productie'
      AND NOT EXISTS (SELECT 1 FROM fabriek.herbewerking h WHERE h.batch_id = b.id AND h.status = 'open')
      AND (SELECT count(*) FROM fabriek.stapregistratie r WHERE r.batch_id = b.id AND r.status = 'afgerond') >= 2 ORDER BY b.batchnummer DESC LIMIT 1`);
  await page.goto(`${BASIS}/portaal/#/kwaliteit/batch/${hbatch.batchnummer}`);
  await page.getByRole("button", { name: "Herbewerking", exact: true }).click();
  await page.locator("#v-stap").selectOption({ index: 0 });
  await page.locator("#v-reden").fill("test: opnieuw mengen");
  await shot("11c-herbewerking-aanmaken");
  await page.getByRole("button", { name: "Herbewerking aanmaken" }).click();
  await page.getByRole("heading", { name: "Herbewerkingen" }).waitFor();
  const [nieuwH] = await q("SELECT stand, door FROM fabriek.herbewerking_stand WHERE nummer = $1 AND stand <> 'ingetrokken'", [hbatch.batchnummer]);
  check("Herbewerking aangemaakt door kwaliteit1, nog te plannen", nieuwH?.stand === "te_plannen" && nieuwH?.door === "kwaliteit1", JSON.stringify(nieuwH));
  check("Knop Herbewerking weg zolang er een open herbewerking is", (await page.getByRole("button", { name: "Herbewerking", exact: true }).count()) === 0);
  await page.getByRole("button", { name: "Intrekken" }).click();
  await page.locator("#v-reden").fill("test klaar");
  await page.getByRole("dialog").getByRole("button", { name: "Intrekken" }).click();
  await page.locator(".label-stand-ingetrokken").waitFor();
  check("Intrekken: stand ingetrokken", true);

  console.log("\nLotpaspoort");
  const [herb] = await q("SELECT l.lotnummer FROM fabriek.lot l JOIN fabriek.stapregistratie r ON r.lot_id = l.id WHERE r.herbewerking_start ORDER BY l.aangemaakt_op DESC LIMIT 1");
  await page.getByRole("link", { name: "Lotpaspoort" }).click();
  await page.getByRole("heading", { name: "Lotpaspoort", exact: true }).waitFor();
  await page.getByLabel("Zoeken").fill(herb.lotnummer.slice(-4));
  await page.waitForTimeout(600);
  await shot("07-lots-zoeken");
  await page.getByRole("link", { name: herb.lotnummer }).click();
  await page.getByRole("heading", { name: `Lotpaspoort ${herb.lotnummer}` }).waitFor();
  await shot("08-lotpaspoort");
  check("Lotpaspoort toont de herbewerking", (await page.locator(".feiten").innerText()).includes("te nat na verpakken"));
  check("Afwijking (vochtgehalte) bovenaan", (await page.locator(".blok").first().innerText()).includes("S18.3"));
  // #56: klik op een resultaat voor de meting, correcties en het keurresultaat.
  const knopMeting = page.locator(".blok").first().locator("button.label-knop").first();
  await knopMeting.click();
  await page.locator("tr.meting-detail .feiten").first().waitFor();
  const detail = await page.locator("tr.meting-detail").first().innerText();
  check("Resultaat openklikken: meting met grenzen van toen en wie het invoerde (#56)", detail.includes("Grenzen toen") && detail.includes("Ingevoerd"), detail.slice(0, 200));
  check("Knop zegt dat hij open is", (await knopMeting.getAttribute("aria-expanded")) === "true");
  await shot("08b-lotpaspoort-meting");
  await knopMeting.click();
  check("Nog een klik: weer dicht", (await page.locator("tr.meting-detail").count()) === 0);
  const [n] = await q("SELECT count(*)::int AS n FROM fabriek.lotpaspoort WHERE lotnummer = $1", [herb.lotnummer]);
  await page.getByText(/metingen binnen grenzen tonen/).click();
  const getoond = await page.locator(".blok", { hasNot: page.getByRole("heading", { name: /^(Grondstoffen|Herbewerkingen)$/ }) }).locator(".tabel tbody tr").count();
  check("Alle metingen van lot en batches staan erin", getoond === n.n, `${getoond} vs ${n.n}`);
  await page.emulateMedia({ media: "print" });
  await shot("09-lotpaspoort-afdruk");
  await page.emulateMedia({ media: "screen" });

  console.log("\nAfwijkingen en herbewerkingen");
  await page.getByRole("link", { name: "Afwijkingen" }).click();
  await page.locator(".tabel tbody tr").first().waitFor();
  await page.selectOption("#f-soort", "buiten_grens");
  await page.waitForTimeout(500);
  const soorten = await page.locator(".tabel tbody tr .label").allInnerTexts();
  check("Filter 'buiten grens' werkt", soorten.length > 0 && soorten.every((t) => t === "Buiten grens"), soorten.slice(0, 3).join("|"));
  await shot("10-afwijkingen");

  console.log("\nSorteren en filteren per kolom (#94)");
  const kolom = async (naam) => page.locator(`.tabel tbody tr:not([hidden]) td[data-kop="${naam}"]`).allInnerTexts();
  const getal = (t) => { const m = /([−-]?)([\d.]+)(?:,(\d+))?/.exec(t); return m ? (m[1] ? -1 : 1) * Number(`${m[2].replace(/\./g, "")}.${m[3] ?? 0}`) : NaN; };
  await page.selectOption("#f-soort", "");
  await page.waitForFunction(() => document.querySelectorAll(".tabel tbody tr").length > 10);
  await page.getByRole("button", { name: "Filteren" }).waitFor();
  const voor = await kolom("Ingevoerd");
  await page.locator("th", { hasText: "Gemeten" }).getByRole("button").click();
  const op = (await kolom("Gemeten")).map(getal);
  check("Klik op Gemeten: oplopend", op.length > 1 && op.every((x, i) => i === 0 || op[i - 1] <= x) && (await page.locator('th[aria-sort="ascending"]').innerText()).includes("Gemeten"), op.slice(0, 5).join(","));
  await page.locator("th", { hasText: "Gemeten" }).getByRole("button").click();
  const af = (await kolom("Gemeten")).map(getal);
  check("Nog een klik: aflopend", af.every((x, i) => i === 0 || af[i - 1] >= x) && (await page.locator('th[aria-sort="descending"]').count()) === 1);
  await page.locator("th", { hasText: "Gemeten" }).getByRole("button").click();
  check("Derde klik: weer de oorspronkelijke volgorde", JSON.stringify(await kolom("Ingevoerd")) === JSON.stringify(voor) && (await page.locator("th[aria-sort]").count()) === 0);
  await page.locator("th", { hasText: "Ingevoerd" }).getByRole("button").click();
  const opTijd = await kolom("Ingevoerd");
  // De lijst staat nieuwste eerst; oplopend op tijd begint dus bij de oudste.
  check("Sorteren op datum: oudste eerst", opTijd[0] === voor[voor.length - 1] && opTijd[opTijd.length - 1] === voor[0], `${opTijd[0]} / ${voor[voor.length - 1]}`);
  await page.locator("th", { hasText: "Ingevoerd" }).getByRole("button").click();
  await page.locator("th", { hasText: "Ingevoerd" }).getByRole("button").click();
  const operators = await kolom("Operator");
  const deel = operators[0];
  await page.getByRole("button", { name: "Filteren" }).click();
  await page.locator(".tabel-filters").waitFor();
  const opVeld = page.locator(".tabel-filters").getByLabel("Operator");
  // Weinig verschillende waarden: een keuzelijst; veel: een zoekveld.
  if ((await opVeld.evaluate((el) => el.tagName)) === "SELECT") await opVeld.selectOption(operators[0]); else await opVeld.fill(deel);
  const gefilterd = await kolom("Operator");
  const verwacht = operators.filter((o) => o.toLowerCase().includes(deel.toLowerCase())).length;
  check("Filter per kolom: alleen regels met die operator", gefilterd.length === verwacht && gefilterd.every((o) => o.toLowerCase().includes(deel.toLowerCase())), `${gefilterd.length} / ${verwacht}`);
  check("De knop zegt hoeveel regels je ziet", verwacht === operators.length || (await page.getByRole("button", { name: /^Filteren \(\d+ van \d+\)$/ }).count()) === 1);
  await page.getByRole("button", { name: "Filters wissen" }).click();
  check("Filters wissen: alles weer zichtbaar", (await kolom("Operator")).length === operators.length);
  await shot("10b-afwijkingen-filteren");
  await page.getByRole("link", { name: "Herbewerkingen en afkeur" }).click();
  await page.getByRole("heading", { name: /Afgekeurde batches/ }).waitFor();
  await shot("11-herbewerkingen-afkeur");

  console.log("\nPloegleider");
  await page.getByRole("button", { name: "Afmelden" }).click();
  await login("ploegleider1");
  await page.getByRole("heading", { name: "Productie", exact: true }).waitFor();
  check("Ploegleider start in Productie en ziet ook Kwaliteit", (await page.locator(".menu-portaal", { hasText: "Kwaliteit" }).count()) === 1);
  await page.goto(`${BASIS}/portaal/#/kwaliteit/batch/${eerste}`);
  await page.getByRole("button", { name: "In beoordeling zetten" }).waitFor();
  check("Ploegleider kan in beoordeling zetten maar niet keuren", (await page.getByRole("button", { name: "NOK", exact: true }).count()) === 0);
  check("Ploegleider maakt geen herbewerking aan (#61)", (await page.getByRole("button", { name: "Herbewerking", exact: true }).count()) === 0);

  console.log("\nProductiemanager (#61)");
  await page.getByRole("button", { name: "Afmelden" }).click();
  await login("productiemanager1");
  await page.getByRole("heading", { name: "Productie", exact: true }).waitFor();
  check("Productiemanager start in Productieanalyse en ziet Kwaliteit en Planning",
    (await page.locator(".menu-portaal", { hasText: "Kwaliteit" }).count()) === 1 && (await page.locator(".menu-portaal", { hasText: "Planning" }).count()) === 1);
  await page.goto(`${BASIS}/portaal/#/kwaliteit/batch/${hbatch.batchnummer}`);
  await page.getByRole("button", { name: "Herbewerking", exact: true }).waitFor();
  check("Productiemanager kan een herbewerking aanmaken en in beoordeling zetten, niet keuren",
    (await page.getByRole("button", { name: "In beoordeling zetten" }).count()) === 1 && (await page.getByRole("button", { name: "NOK", exact: true }).count()) === 0);

  await page.setViewportSize({ width: 820, height: 1000 });
  await page.goto(`${BASIS}/portaal/#/kwaliteit/overzicht`);
  await page.locator(".grafiek > svg").waitFor();
  await shot("12-smal");
  // Smal scherm: menu dicht achter een knop, inhoud meteen in beeld (#44).
  check("Smal: menu staat dicht", !(await page.getByRole("link", { name: "Lotpaspoort" }).isVisible()));
  // Onder het menu staan Meldingen en (bij analyses) de productkiezer (D55): samen nog geen kwart van het scherm.
  check("Smal: titel boven in beeld", (await page.getByRole("heading", { level: 1 }).boundingBox()).y < 250);
  await page.getByRole("button", { name: /^Menu/ }).click();
  check("Smal: menu gaat open", await page.getByRole("link", { name: "Lotpaspoort" }).isVisible());
  await page.getByRole("link", { name: "Lotpaspoort" }).click();
  await page.waitForFunction(() => location.hash.includes("lotpaspoort") || location.hash.includes("lots"));
  // Het menu wordt na de navigatie opnieuw getekend; wacht daarop in plaats van meteen te kijken.
  const dicht = await page.getByRole("link", { name: "Afwijkingen" }).waitFor({ state: "hidden", timeout: 5000 }).then(() => true, () => false);
  check("Smal: na kiezen is het menu weer dicht", dicht);
  await page.setViewportSize({ width: 1440, height: 900 });
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
