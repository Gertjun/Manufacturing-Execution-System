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
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "nl-NL" });
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("  PAGINAFOUT", e.message); fouten++; });
const shot = (naam, fullPage = true) => page.screenshot({ path: `${SHOTS}/${naam}.png`, fullPage });

async function login(naam) {
  await page.goto(`${BASIS}/portaal/#/login`);
  await page.getByLabel("Gebruikersnaam").fill(naam);
  await page.getByLabel("Wachtwoord").fill("demo");
  await page.getByRole("button", { name: "Inloggen" }).click();
}

try {
  console.log("\nInloggen");
  await login("operator");
  await page.getByText("Het operator-account is voor het invoerscherm").waitFor();
  check("Operator-account wordt naar het invoerscherm verwezen", true);

  await login("kwaliteit1");
  await page.getByRole("heading", { name: "Kwaliteit", exact: true }).waitFor();
  await page.locator(".tegel").first().waitFor();
  await page.locator(".grafiek > svg").first().waitFor();
  await page.waitForTimeout(300);
  await shot("01-overzicht");
  await page.locator(".teller:not(:empty)").waitFor();
  check("Teller in het menu toont 2 te beoordelen", (await page.locator(".teller:not(:empty)").innerText()) === "2");
  check("Grafiek afwijkingen per week staat er", (await page.locator(".grafiek > svg path").count()) > 3);
  check("S5.1 staat bovenaan bij de velden met afwijkingen", (await page.locator(".tabel tbody tr").first().innerText()).includes("S5.1"));
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
  const feiten = await page.locator(".feiten").innerText();
  check("Trend laat zien dat S5.1 oploopt (gemiddelde eind hoger dan begin)", (() => {
    const m = feiten.match(/([\d,]+) °C naar ([\d,]+) °C/); return m && parseFloat(m[2].replace(",", ".")) > parseFloat(m[1].replace(",", ".")) + 2;
  })(), feiten);
  await page.selectOption("#f-veld", "S9.2");
  await page.locator(".grafiek > svg").waitFor();
  await page.waitForTimeout(300);
  await shot("04-trend-S9.2", false);

  console.log("\nTe beoordelen");
  await page.getByRole("link", { name: /Te beoordelen/ }).click();
  await page.getByRole("heading", { name: "Te beoordelen" }).waitFor();
  await page.locator(".tabel tbody tr").first().waitFor();
  await shot("05-te-beoordelen");
  const rijen = await page.locator(".tabel tbody tr").count();
  check("Twee batches in beoordeling", rijen === 2, String(rijen));
  const eerste = (await page.locator(".tabel tbody tr").first().locator("a").innerText()).trim();
  const tweede = (await page.locator(".tabel tbody tr").nth(1).locator("a").innerText()).trim();
  await page.locator(".tabel tbody tr").first().getByRole("button", { name: "OK", exact: true }).click();
  await page.getByLabel("Toelichting").fill("binnen specificatie na hermeting");
  await page.getByRole("button", { name: "OK: vrijgeven" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".tabel tbody tr").length === 1);
  await page.locator(".tabel tbody tr").first().getByRole("button", { name: "NOK", exact: true }).click();
  await page.getByLabel("Reden van afkeur").fill("kleur buiten specificatie");
  await page.getByRole("button", { name: "NOK: afkeuren" }).click();
  await page.getByText("Er staan geen batches in beoordeling.").waitFor();
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
  const [n] = await q("SELECT count(*)::int AS n FROM fabriek.lotpaspoort WHERE lotnummer = $1", [herb.lotnummer]);
  await page.getByText(/metingen binnen grenzen tonen/).click();
  const getoond = await page.locator(".blok .tabel tbody tr").count();
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
