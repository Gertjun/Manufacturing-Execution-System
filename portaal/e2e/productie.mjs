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
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "nl-NL" });
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("  PAGINAFOUT", e.message); fouten++; });
const shot = (naam, fullPage = true) => page.screenshot({ path: `${SHOTS}/${naam}.png`, fullPage });

try {
  console.log("\nWerkvoorraad");
  await page.goto(`${BASIS}/portaal/#/login`);
  await page.getByLabel("Gebruikersnaam").fill("ploegleider1");
  await page.getByLabel("Wachtwoord").fill("demo");
  await page.getByRole("button", { name: "Inloggen" }).click();
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
  check("Alle correcties staan erin", (await page.locator(".tabel tbody tr").count()) === c, String(c));

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
