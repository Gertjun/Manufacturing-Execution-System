// Test van het Portaal Productie in Chrome, op data van tools/genereer_testdata.py.
// Gebruik: node e2e/productie.mjs   (start zelf de API op poort 3460)
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import pg from "pg";

const DB = process.env.DATABASE_URL ?? "postgres://postgres@localhost/batchgui?host=/tmp&port=5433";
const SHOTS = process.env.SHOTS ?? "/tmp/shots-productie";
const BASIS = "http://localhost:3460";
mkdirSync(SHOTS, { recursive: true });

let fouten = 0;
const check = (naam, ok, extra = "") => {
  console.log(`${ok ? "  OK  " : "  FOUT"} ${naam}${!ok && extra ? `  [${extra}]` : ""}`);
  if (!ok) fouten++;
};

const api = spawn("npx", ["tsx", "src/index.ts"], {
  cwd: new URL("../../api/", import.meta.url).pathname,
  env: { ...process.env, DATABASE_URL: DB, JWT_GEHEIM: "e2e-".repeat(10), POORT: "3460", PORTAAL_MAP: new URL("../dist", import.meta.url).pathname },
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

try {
  console.log("\nWerkvoorraad");
  await page.goto(`${BASIS}/portaal/#/login`);
  await page.getByLabel("Gebruikersnaam").fill("ploegleider1");
  await page.getByLabel("Wachtwoord").fill("demo");
  await page.getByRole("button", { name: "Inloggen" }).click();
  // Na het inloggen de startpagina (D54); de test gaat verder in het portaal van de rol.
  if (await page.locator(".startpagina").waitFor({ timeout: 8000 }).then(() => true, () => false)) await page.locator(`.starttegel-${await page.evaluate(() => {
    const rol = JSON.parse(atob(localStorage.getItem("portaal.token").split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).rol;
    return { ploegleider: "productie", beheerder: "beheer", planner: "planning" }[rol] ?? "kwaliteit";
  })}`).click();
  await page.getByRole("heading", { name: "Productie", exact: true }).waitFor();
  await page.locator(".staptegel").first().waitFor();
  await shot("01-werkvoorraad");
  check("Ploegleider komt in het Portaal Productie", page.url().includes("#/productie"));
  check("18 stappen in de werkvoorraad", (await page.locator(".staptegel").count()) === 18);
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
  check("Tabel per stap heeft 18 rijen", (await page.locator(".blok").nth(1).locator("tbody tr").count()) === 18);

  console.log("\nProductie per week");
  await page.getByRole("link", { name: "Productie per week" }).click();
  await page.locator(".grafiek > svg").waitFor();
  await page.selectOption("#periode", "90");
  await page.waitForTimeout(500);
  await shot("04-per-week");
  const lots = Number((await page.locator(".tegel").nth(2).locator(".tegel-getal").innerText()).trim());
  const [{ gereed }] = await q("SELECT count(*)::int AS gereed FROM fabriek.lot WHERE aangemaakt_op >= now() - interval '91 days'");
  check("Lots gereed (90 dagen) ongeveer gelijk aan aantal lots", Math.abs(lots - gereed) <= 2, `${lots} vs ${gereed}`);

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
  await page.getByRole("heading", { name: "Ochtendploeg" }).waitFor();
  check("Drie ploegen op een hele dag", (await page.locator("section.ploeg").count()) === 3);
  const [nOd] = await q("SELECT count(*)::int AS n FROM fabriek.overdracht WHERE dag = $1", [gisteren.d]);
  check("Alle overdrachten van die dag staan erbij", (await page.locator("section.ploeg .notities li").count()) === nOd.n, `${nOd.n}`);
  await shot("07-overdracht");
  await page.getByRole("link", { name: "Vandaag" }).click();
  await page.locator("section.ploeg-nu, .leeg").first().waitFor();
  check("Vandaag: de lopende ploeg is gemarkeerd", (await page.locator("section.ploeg-nu").count()) <= 1);

  console.log("\nStilstand");
  await page.goto(`${BASIS}/portaal/#/productie/stilstand`);
  await page.getByRole("heading", { name: "Stilstand per stap" }).waitFor();
  check("Nu stil: de lopende storing in PS7", (await page.locator("section", { hasText: "Nu stil" }).locator("tbody tr", { hasText: "PS7" }).count()) === 1);
  const rijPs7 = await page.locator("section", { hasText: "Stilstand per stap" }).locator("tbody tr", { hasText: "PS7 " }).innerText();
  check("PS7 heeft de laagste beschikbaarheid", (await page.locator(".tegel", { hasText: "laagste beschikbaarheid" }).innerText()).includes("PS7"), rijPs7);
  check("Grafiek getekend", (await page.locator("svg[aria-label='Stilstand per stap'] path").count()) > 10);
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
  check("Ploegleider: invoerscherm, portalen en wandscherm als tegels",
    tegels[0] === "Invoerscherm" && tegels.includes("Productieanalyse") && tegels.includes("Wandscherm") && !tegels.includes("Beheer"), tegels.join(", "));
  await shot("09-startpagina");
  await page.locator(".starttegel-invoer").click();
  await page.getByRole("heading", { name: "Welke pc is dit?" }).waitFor();
  await page.getByRole("button", { name: /^PC-03/ }).click();
  await page.getByRole("heading", { name: "Kies een stap" }).waitFor();
  check("Invoerscherm zonder opnieuw in te loggen, met de eigen naam", (await page.locator(".balk-eigen-naam").innerText()) === "ploegleider1");
  const [pcInlog] = await q("SELECT count(*)::int AS n FROM fabriek.inlogpoging WHERE gebruikersnaam = 'ploegleider1' AND pc = 'PC-03' AND uitkomst = 'gelukt'");
  check("Telt als inlog op PC-03", pcInlog.n >= 1);
  await page.getByRole("link", { name: "Portalen" }).click();
  await page.locator(".startpagina").waitFor();
  await page.getByRole("button", { name: "Afmelden" }).click();
  await page.getByLabel("Gebruikersnaam").waitFor();
  await page.goto(`${BASIS}/invoer/`);
  await page.getByLabel("Gebruikersnaam").waitFor();
  check("Afmelden in de portalen meldt ook het invoerscherm af", true);
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
