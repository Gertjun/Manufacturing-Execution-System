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
    return { ploegleider: "productie", beheerder: "beheer", planner: "planning" }[rol] ?? "kwaliteit";
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
  check(`Teller in het menu toont ${inBeoordeling} te beoordelen`, inBeoordeling >= 2 && (await page.getByRole("link", { name: /Te beoordelen/ }).locator(".teller:not(:empty)").innerText()) === String(inBeoordeling));
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
  check("Alle producten: uitleg over grenzen per product bij S9.2", (await page.locator("main p", { hasText: "eigen grenzen per product" }).count()) === 1);
  await page.selectOption("#product-keuze", "PRD-C");
  await page.locator(".filter-product", { hasText: "PRD-C" }).waitFor();
  await page.locator(".grafiek > svg").waitFor();
  const cN = await metingen();
  const [db9] = await q(`SELECT count(*)::int AS n FROM fabriek.waarde_actueel w JOIN fabriek.veld v ON v.id = w.veld_id
                          JOIN fabriek.stapregistratie r ON r.id = w.stapregistratie_id JOIN fabriek.product p ON p.id = r.product_id
                         WHERE v.code = 'S9.2' AND p.code = 'PRD-C' AND w.ingevoerd_op >= current_date - 89`);
  check("PRD-C: alleen de metingen van dat product", cN > 0 && cN < alleN && cN === db9.n, `${cN} van ${alleN}, database ${db9.n}`);
  check("PRD-C: geen uitleg meer nodig, de grenzen zijn die van PRD-C", (await page.locator("main p", { hasText: "eigen grenzen per product" }).count()) === 0);
  await page.waitForTimeout(300);
  await shot("04b-trend-S9.2-PRD-C", false);
  await page.getByRole("link", { name: "Regelkaarten" }).click();
  await page.locator(".tabel tbody tr").first().waitFor();
  check("Productkiezer onthouden bij een ander scherm", (await page.locator("#product-keuze").inputValue()) === "PRD-C");
  const rij92 = await page.locator(".tabel tbody tr", { hasText: "S9.2 Gewicht" }).innerText();
  check("Regelkaarten met PRD-C: S9.2 heeft een Cpk", /\d,\d\d/.test(rij92) && !rij92.includes("kies een product"), rij92);
  await page.reload();
  await page.locator(".tabel tbody tr").first().waitFor();
  check("Ook na herladen nog PRD-C", (await page.locator("#product-keuze").inputValue()) === "PRD-C");
  await page.selectOption("#product-keuze", "");
  await page.locator(".tabel tbody tr", { hasText: "kies een product" }).first().waitFor();
  check("Alle producten: bij S9.2 staat 'kies een product' in plaats van een Cpk",
    (await page.locator(".tabel tbody tr", { hasText: "S9.2 Gewicht" }).innerText()).includes("kies een product"));
  await page.getByRole("link", { name: "Lotpaspoort" }).click();
  await page.getByRole("heading", { name: "Lotpaspoort" }).waitFor();
  check("Geen productkiezer bij het lotpaspoort", (await page.locator("#product-keuze").count()) === 0);

  console.log("\nTe beoordelen");
  await page.getByRole("link", { name: /Te beoordelen/ }).click();
  await page.getByRole("heading", { name: "Te beoordelen" }).waitFor();
  await page.locator(".tabel tbody tr").first().waitFor();
  await shot("05-te-beoordelen");
  const rijen = await page.locator(".tabel tbody tr").count();
  check("Alle batches in beoordeling staan in de lijst", rijen === inBeoordeling, String(rijen));
  const eerste = (await page.locator(".tabel tbody tr").first().locator("a").innerText()).trim();
  const tweede = (await page.locator(".tabel tbody tr").nth(1).locator("a").innerText()).trim();
  await page.locator(".tabel tbody tr").first().getByRole("button", { name: "OK", exact: true }).click();
  await page.getByLabel("Toelichting").fill("binnen specificatie na hermeting");
  await page.getByRole("button", { name: "OK: vrijgeven" }).click();
  await page.waitForFunction((n) => document.querySelectorAll(".tabel tbody tr").length === n, inBeoordeling - 1);
  await page.locator(".tabel tbody tr").first().getByRole("button", { name: "NOK", exact: true }).click();
  await page.getByLabel("Reden van afkeur").fill("kleur buiten specificatie");
  await page.getByRole("button", { name: "NOK: afkeuren" }).click();
  if (inBeoordeling === 2) await page.getByText("Er staan geen batches in beoordeling.").waitFor();
  else await page.waitForFunction((n) => document.querySelectorAll(".tabel tbody tr").length === n, inBeoordeling - 2);
  const st = Object.fromEntries((await q("SELECT batchnummer, status FROM fabriek.batch WHERE batchnummer = ANY($1)", [[eerste, tweede]])).map((r) => [r.batchnummer, r.status]));
  check("OK: batch weer in productie", st[eerste] === "in_productie", JSON.stringify(st));
  check("NOK: batch afgekeurd", st[tweede] === "afgekeurd", JSON.stringify(st));

  await page.goto(`${BASIS}/portaal/#/kwaliteit/batch/${tweede}`);
  await page.getByRole("heading", { name: "Besluiten" }).waitFor();
  await shot("06-batch-afgekeurd");

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
  const getoond = await page.locator(".blok", { hasNot: page.getByRole("heading", { name: "Grondstoffen", exact: true }) }).locator(".tabel tbody tr").count();
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
