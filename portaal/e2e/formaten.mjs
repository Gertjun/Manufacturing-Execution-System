// Alle schermen in acht CSS-viewports (D64): telefoon, tablet, laptop, pc, Full HD en 4K UHD.
// Controleert dat geen pagina breder is dan het scherm, dat tabellen op een telefoon kaartjes zijn,
// en dat het invoerscherm op een staande telefoon de navigatie onderaan heeft.
// Gebruik: node e2e/formaten.mjs   (start zelf de API op poort 3472; vraagt testdata uit tools/genereer_testdata.py)
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";
import { FORMATEN, BASISFORMATEN } from "../../tests/screen-formats.mjs";

const formaatModus = process.env.MES_SCREEN_FORMATS ?? "uitgebreid";
if (!["basis","uitgebreid"].includes(formaatModus)) throw new Error("Onbekende formaatmodus: "+formaatModus);
const geselecteerd = formaatModus === "basis" ? BASISFORMATEN : FORMATEN;

const DB = process.env.DATABASE_URL ?? "postgres://postgres@localhost/batchgui?host=/tmp&port=5433";
const APP_DB = process.env.TEST_APP_DATABASE_URL;
if (!APP_DB || APP_DB === DB) throw new Error("TEST_APP_DATABASE_URL moet een afzonderlijke beperkte MES-testverbinding zijn");
const BASIS = "http://localhost:3472";

let fouten = 0;
const check = (naam, ok, extra = "") => {
  console.log(`${ok ? "  OK  " : "  FOUT"} ${naam}${!ok && extra ? `  [${extra}]` : ""}`);
  if (!ok) fouten++;
};

const ROUTES = {
  kwaliteit1: ["#/", "#/kwaliteit/overzicht", "#/kwaliteit/beoordelen", "#/kwaliteit/lotpaspoort", "#/kwaliteit/lotpaspoort/L-2026-0131",
    "#/kwaliteit/certificaat/L-2026-0131", "#/kwaliteit/batch/B-2026-0235", "#/kwaliteit/grondstoffen", "#/kwaliteit/regelkaarten",
    "#/kwaliteit/regelkaarten/S3.2", "#/kwaliteit/afwijkingen", "#/kwaliteit/trend/S3.2", "#/kwaliteit/herbewerkingen", "#/kwaliteit/specificaties/PRD-C"],
  ploegleider1: ["#/", "#/productie/overzicht", "#/productie/stap/PS3", "#/productie/doorlooptijden", "#/productie/week", "#/productie/correcties",
    "#/productie/overdracht", "#/productie/stilstand", "#/nainvoeren", "#/nainvoeren/formulier/PS3", "#/hulp", "#/wachtwoord"],
  planner1: ["#/planning/week", "#/planning/dag", "#/planning/overzicht", "#/planning/route", "#/planning/lots", "#/planning/producten", "#/planning/capaciteit"],
  beheerder1: ["#/beheer/accounts", "#/beheer/pcs", "#/beheer/logboek", "#/beheer/server"],
  "mes.engineer": ["#/engineering/overzicht", "#/engineering/materialen", "#/engineering/eenheden", "#/engineering/recepten", "#/engineering/beoordelingen", "#/beheer/stappen", "#/beheer/grondstoffen"],
  productiemanager1: ["#/beheer/operators", "#/beheer/ploegen", "#/beheer/oorzaken", "#/kwaliteit/herbewerkingen"],
  scherm1: ["#/wandscherm"],
};
const INVOER = ["#/stappen", "#/stap/PS3", "#/zoek", "#/zoek/B-2026-0235", "#/overdracht", "#/wachtrij", "#/hulp", "#/stap/PS16"];

const api = spawn("npx", ["tsx", "src/index.ts"], {
  cwd: new URL("../../api/", import.meta.url).pathname,
  env: { ...process.env, DATABASE_URL: APP_DB, JWT_GEHEIM: "e2e-".repeat(10), POORT: "3472", PORTAAL_MAP: new URL("../dist", import.meta.url).pathname },
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
const klaar = (page) => page.waitForFunction(() => { const el=document.querySelector("#scherm"); return el && el.children.length && !el.querySelector(".laden") && !el.textContent.includes("Bevoegdheden ophalen…"); }, null, { timeout: 15000 });
/** Wat breder is dan het scherm, zonder wat bewust in een eigen schuifvak staat. */
const teBreed = (page, w) => page.evaluate((w) => {
  if (document.documentElement.scrollWidth <= w + 1) return null;
  const e = [...document.querySelectorAll("body *")].find((x) => x.getBoundingClientRect().right > w + 1 && ![...x.children].some((c) => c.getBoundingClientRect().right > w + 1));
  return `${document.documentElement.scrollWidth} px: ${e ? `${e.tagName.toLowerCase()}.${[...e.classList].join(".")} "${(e.textContent ?? "").trim().slice(0, 30)}"` : "?"}`;
}, w);

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
try {
  const tokens = Object.fromEntries(await Promise.all(Object.keys(ROUTES).map(async (n) => [n, await token(n)])));
  console.log(`Formaatmatrix: ${formaatModus} (${geselecteerd.length})`);
  for (const f of geselecteerd) {
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
        await page.reload();
        await klaar(page);
        check(naam+" bereikt "+r, new URL(page.url()).hash===r && (await page.locator("#scherm .foutmelding").allInnerTexts()).every(s=>!s.trim()), page.url());
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
      check("Invoer bereikt "+r,new URL(page.url()).hash===r && await page.locator("#scherm .foutmelding").count()===0,page.url());
      const b = await teBreed(page, f.width);
      if (b) invoerBreed.push(`${r} ${b}`);
    }
    check(`Invoerscherm: geen pagina breder dan het scherm (${INVOER.length} pagina's)`, invoerBreed.length === 0, invoerBreed.slice(0, 3).join(" ; "));
    const onder = await page.locator("#onderbalk").isVisible();
    const boven = await page.locator(".balk-nav").isVisible();
    if (f.width < 600) {
      check("Navigatie onderaan, niet bovenaan", onder && !boven);
      // Wacht op de definitieve PS16-weergave, niet op de vorige route of laadkop.
      await page.locator("#scherm .kop h1").waitFor();
      await page.waitForFunction(() => location.hash === "#/stap/PS16" && document.querySelector("#scherm .kop h1")?.textContent !== "PS16" && !!document.querySelector("#scherm .kop h1") && !document.querySelector("#scherm .laden"));
      await page.getByRole("button", { name: "Meer" }).click();
      check("Meer toont leesbare versie", await page.locator(".meer-paneel .mes-versie").isVisible() && await page.locator(".meer-paneel .mes-versie").evaluate(el => (() => { const probe = document.createElement("span"); probe.style.color = "var(--inkt-zacht)"; el.append(probe); const match = getComputedStyle(el).color === getComputedStyle(probe).color; probe.remove(); return match; })()));
      check("Meer toont Hulp en Afmelden",
        await page.locator(".meer-paneel").getByRole("button", { name: "Afmelden" }).isVisible()
        && await page.locator(".meer-paneel").getByRole("link", { name: "Hulp" }).isVisible());
      // D103: lok echte statuscallbacks uit zonder op toevallige polltiming te vertrouwen.
      const hulp = page.locator(".meer-paneel").getByRole("link", { name: "Hulp" });
      await hulp.focus();
      check("Hulp heeft focus vóór statusverversing", await hulp.evaluate(el => document.activeElement === el));
      const oorspronkelijk = await hulp.elementHandle();
      if (!oorspronkelijk) throw new Error("Hulp-link ontbreekt");
      await page.evaluate(() => window.dispatchEvent(new Event("offline")));
      await page.waitForFunction(() => document.querySelector(".verbinding")?.classList.contains("uit"));
      check("Meer en focus blijven behouden na statusverversing",
        await oorspronkelijk.evaluate(el => el.isConnected && document.activeElement === el)
        && await page.locator(".meer-knop").getAttribute("aria-expanded") === "true"
        && await hulp.isVisible());
      // Herstel de status via de bestaande online-handler en de echte health-request.
      const gezond = page.waitForResponse(r => new URL(r.url()).pathname === "/gezondheid" && r.ok());
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await gezond;
      await page.waitForFunction(() => {
        const el = document.querySelector(".verbinding");
        return !!el && !el.classList.contains("uit");
      });
      // De terug-online-handler start ook een asynchrone routeverversing.
      // Controleer focus pas nadat die werkelijk de werkvoorraad heeft gerenderd.
      await page.waitForFunction(() => !!document.querySelector("#scherm .kop h1") && !document.querySelector("#scherm .laden"));
      check("Meer blijft open na herstel van verbinding",
        await oorspronkelijk.evaluate(el => el.isConnected && document.activeElement === el)
        && await hulp.isVisible(), JSON.stringify(await oorspronkelijk.evaluate(el => ({ verbonden:el.isConnected, focus:document.activeElement?.tagName, focusTekst:document.activeElement?.textContent?.slice(0,50), open:!document.querySelector(".meer-paneel")?.hidden }))));
      await oorspronkelijk.dispose();
      await hulp.click();
      await page.waitForURL(/#\/hulp$/);
      check("Na kiezen is Meer weer dicht en staat Hulp open", await page.locator(".meer-paneel").isHidden() && /#\/hulp/.test(page.url()));
      await page.getByRole("button", { name: "Meer" }).click();
      await page.locator(".meer-paneel").getByRole("link", { name: "Hulp" }).press("Escape");
      check("Escape sluit Meer en herstelt focus op knop",
        await page.locator(".meer-paneel").isHidden()
        && await page.locator(".meer-knop").evaluate(el => document.activeElement === el));
      await page.getByRole("button", { name: "Meer" }).click();
      await page.locator("#onderbalk > a[href='#/stappen']").click();
      await page.waitForURL(/#\/stappen$/);
      // wacht op de nieuwe route, niet op de nog aanwezige inhoud van Hulp.
      await page.waitForFunction(() => document.querySelector("#onderbalk > a[href='#/stappen']")?.getAttribute("aria-current") === "page");
      await page.locator(".meer-paneel").waitFor({ state: "hidden" });
      check("Navigatie sluit Meer", await page.locator(".meer-paneel").isHidden()
        && await page.locator(".meer-knop").getAttribute("aria-expanded") === "false");
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
