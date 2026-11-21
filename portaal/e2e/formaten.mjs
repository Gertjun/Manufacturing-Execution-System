// Alle schermen in zes formaten (D64): telefoon staand en liggend, tablet staand en liggend, laptop en pc.
// Controleert dat geen pagina breder is dan het scherm, dat tabellen op een telefoon kaartjes zijn,
// en dat het invoerscherm op een staande telefoon de navigatie onderaan heeft.
// Gebruik: node e2e/formaten.mjs   (start zelf de API op poort 3472; vraagt testdata uit tools/genereer_testdata.py)
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const DB = process.env.DATABASE_URL ?? "postgres://postgres@localhost/batchgui?host=/tmp&port=5433";
const BASIS = "http://localhost:3472";

let fouten = 0;
const check = (naam, ok, extra = "") => {
  console.log(`${ok ? "  OK  " : "  FOUT"} ${naam}${!ok && extra ? `  [${extra}]` : ""}`);
  if (!ok) fouten++;
};

const FORMATEN = [
  { naam: "telefoon staand", width: 390, height: 844, mobiel: true },
  { naam: "telefoon liggend", width: 844, height: 390, mobiel: true },
  { naam: "tablet staand", width: 820, height: 1180, mobiel: true },
  { naam: "tablet liggend", width: 1180, height: 820, mobiel: true },
  { naam: "laptop", width: 1280, height: 800, mobiel: false },
  { naam: "pc", width: 1440, height: 900, mobiel: false },
];
const ROUTES = {
  kwaliteit1: ["#/", "#/kwaliteit/overzicht", "#/kwaliteit/beoordelen", "#/kwaliteit/lotpaspoort", "#/kwaliteit/lotpaspoort/L-2026-0131",
    "#/kwaliteit/certificaat/L-2026-0131", "#/kwaliteit/batch/B-2026-0235", "#/kwaliteit/grondstoffen", "#/kwaliteit/regelkaarten",
    "#/kwaliteit/regelkaarten/S3.2", "#/kwaliteit/afwijkingen", "#/kwaliteit/trend/S3.2", "#/kwaliteit/herbewerkingen"],
  ploegleider1: ["#/", "#/productie/overzicht", "#/productie/stap/PS3", "#/productie/doorlooptijden", "#/productie/week", "#/productie/correcties",
    "#/productie/overdracht", "#/productie/stilstand", "#/nainvoeren", "#/nainvoeren/formulier/PS3", "#/wandscherm", "#/hulp", "#/wachtwoord"],
  planner1: ["#/planning/week", "#/planning/dag", "#/planning/overzicht", "#/planning/route", "#/planning/lots", "#/planning/producten", "#/planning/capaciteit"],
  beheerder1: ["#/beheer/stappen", "#/beheer/accounts", "#/beheer/operators", "#/beheer/grondstoffen", "#/beheer/ploegen", "#/beheer/oorzaken",
    "#/beheer/bedrijf", "#/beheer/pcs", "#/beheer/opmerkingen", "#/beheer/logboek", "#/beheer/server"],
};
const INVOER = ["#/stappen", "#/stap/PS3", "#/zoek", "#/zoek/B-2026-0235", "#/overdracht", "#/wachtrij", "#/hulp", "#/stap/PS16"];

const api = spawn("npx", ["tsx", "src/index.ts"], {
  cwd: new URL("../../api/", import.meta.url).pathname,
  env: { ...process.env, DATABASE_URL: DB, JWT_GEHEIM: "e2e-".repeat(10), POORT: "3472", PORTAAL_MAP: new URL("../dist", import.meta.url).pathname },
  stdio: ["ignore", "ignore", "inherit"],
  detached: true,
});
const stopApi = () => { try { process.kill(-api.pid); } catch {} };
for (let i = 0; i < 40; i++) {
  try { if ((await fetch(`${BASIS}/gezondheid`)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 250));
}
const token = async (naam, pc) => (await (await fetch(`${BASIS}/auth/login`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ gebruikersnaam: naam, wachtwoord: "demo", ...(pc ? { pc } : {}) }),
})).json()).token;

/** Klaar met laden: geen "Laden..." meer in beeld. */
const klaar = (page) => page.waitForFunction(() => !document.querySelector("#scherm .laden"), null, { timeout: 8000 }).catch(() => {}).then(() => page.waitForTimeout(150));
/** Wat breder is dan het scherm, zonder wat bewust in een eigen schuifvak staat. */
const teBreed = (page, w) => page.evaluate((w) => {
  if (document.documentElement.scrollWidth <= w + 1) return null;
  const e = [...document.querySelectorAll("body *")].find((x) => x.getBoundingClientRect().right > w + 1 && ![...x.children].some((c) => c.getBoundingClientRect().right > w + 1));
  return `${document.documentElement.scrollWidth} px: ${e ? `${e.tagName.toLowerCase()}.${[...e.classList].join(".")} "${(e.textContent ?? "").trim().slice(0, 30)}"` : "?"}`;
}, w);

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
try {
  const tokens = Object.fromEntries(await Promise.all(Object.keys(ROUTES).map(async (n) => [n, await token(n)])));
  for (const f of FORMATEN) {
    console.log(`\n${f.naam} (${f.width} × ${f.height})`);
    const context = await browser.newContext({ viewport: { width: f.width, height: f.height }, isMobile: f.mobiel, hasTouch: f.mobiel, locale: "nl-NL", timezoneId: "Europe/Amsterdam" });
    const page = await context.newPage();
    const paginafouten = [];
    page.on("pageerror", (e) => paginafouten.push(e.message));

    // Portalen: elke pagina past in de breedte.
    const breed = [];
    await page.goto(`${BASIS}/portaal/#/login`);
    for (const [naam, routes] of Object.entries(ROUTES)) {
      await page.evaluate((t) => localStorage.setItem("portaal.token", t), tokens[naam]);
      for (const r of routes) {
        await page.goto(`${BASIS}/portaal/${r}`);
        await klaar(page);
        const b = await teBreed(page, f.width);
        if (b) breed.push(`${r} ${b}`);
      }
    }
    check(`Portalen: geen pagina breder dan het scherm (${Object.values(ROUTES).flat().length} pagina's)`, breed.length === 0, breed.slice(0, 3).join(" ; "));

    // Tabellen: op een staande telefoon kaartjes, anders een gewone tabel.
    await page.evaluate((t) => localStorage.setItem("portaal.token", t), tokens.kwaliteit1);
    await page.goto(`${BASIS}/portaal/#/kwaliteit/afwijkingen`);
    await page.locator(".tabel tbody tr").first().waitFor();
    const weergave = await page.locator(".tabel tbody tr").first().evaluate((tr) => getComputedStyle(tr).display);
    const kop = await page.locator(".tabel tbody td").first().evaluate((td) => getComputedStyle(td, "::before").content);
    if (f.width < 600) check("Tabel als kaartjes, met de kolomnaam bij elke waarde", weergave === "block" && kop.includes("Ingevoerd"), `${weergave} ${kop}`);
    else check("Tabel als gewone tabel", weergave === "table-row", weergave);

    // Menu: op een staande telefoon een paneel over het hele scherm.
    if (f.width < 600) {
      await page.locator(".menu-knop").click();
      const vlak = await page.locator("#menu").boundingBox();
      check("Open menu bedekt het hele scherm", !!vlak && vlak.width >= f.width - 1 && vlak.height >= f.height - 1, JSON.stringify(vlak));
      await page.locator(".menu-knop").click();
    }

    // Invoerscherm.
    const invoerBreed = [];
    await page.goto(`${BASIS}/invoer/`);
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${BASIS}/invoer/`);
    await page.getByRole("button", { name: /^PC-01/ }).click();
    await page.getByLabel("Gebruikersnaam").fill("operator.a");
    await page.getByLabel("Wachtwoord").fill("demo");
    await page.getByRole("button", { name: "Inloggen" }).click();
    await page.waitForURL(/#\/stappen/);
    for (const r of INVOER) {
      await page.goto(`${BASIS}/invoer/${r}`);
      await klaar(page);
      const b = await teBreed(page, f.width);
      if (b) invoerBreed.push(`${r} ${b}`);
    }
    check(`Invoerscherm: geen pagina breder dan het scherm (${INVOER.length} pagina's)`, invoerBreed.length === 0, invoerBreed.slice(0, 3).join(" ; "));
    const onder = await page.locator("#onderbalk").isVisible();
    const boven = await page.locator(".balk-nav").isVisible();
    if (f.width < 600) {
      check("Navigatie onderaan, niet bovenaan", onder && !boven);
      await page.getByRole("button", { name: "Meer" }).click();
      check("Meer toont Hulp, Iets melden en Afmelden",
        await page.locator(".meer-paneel").getByRole("button", { name: "Afmelden" }).isVisible()
        && await page.locator(".meer-paneel").getByRole("link", { name: "Hulp" }).isVisible());
      await page.locator(".meer-paneel").getByRole("link", { name: "Hulp" }).click();
      check("Na kiezen is Meer weer dicht en staat Hulp open", await page.locator(".meer-paneel").isHidden() && /#\/hulp/.test(page.url()));
    } else {
      check("Navigatie bovenaan, geen balk onderaan", boven && !onder);
    }
    check("Geen scriptfouten", paginafouten.length === 0, paginafouten.slice(0, 2).join(" ; "));
    await context.close();
  }
} catch (e) {
  console.log("  AFGEBROKEN", e.message);
  fouten++;
} finally {
  await browser.close();
  stopApi();
}
console.log(fouten ? `\n${fouten} fout(en)` : "\nAlles geslaagd");
process.exit(fouten ? 1 : 0);
