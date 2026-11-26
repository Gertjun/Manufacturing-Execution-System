// Test van het certificaat per lot in Chrome, op data van tools/genereer_testdata.py.
// Gebruik: node e2e/certificaat.mjs   (start zelf de API op poort 3466)
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import pg from "pg";

const DB = process.env.DATABASE_URL ?? "postgres://postgres@localhost/batchgui?host=/tmp&port=5433";
const APP_DB = process.env.TEST_APP_DATABASE_URL;
if (!APP_DB || APP_DB === DB) throw new Error("TEST_APP_DATABASE_URL moet een afzonderlijke beperkte MES-testverbinding zijn");
const SHOTS = process.env.SHOTS ?? "/tmp/shots-certificaat";
const BASIS = "http://localhost:3466";
mkdirSync(SHOTS, { recursive: true });

let fouten = 0;
const check = (naam, ok, extra = "") => {
  console.log(`${ok ? "  OK  " : "  FOUT"} ${naam}${!ok && extra ? `  [${extra}]` : ""}`);
  if (!ok) fouten++;
};
const db = new pg.Client({ connectionString: DB });
await db.connect();
const q = async (sql, p = []) => (await db.query(sql, p)).rows;

const api = spawn("npx", ["tsx", "src/index.ts"], {
  cwd: new URL("../../api/", import.meta.url).pathname,
  env: { ...process.env, DATABASE_URL: APP_DB, JWT_GEHEIM: "e2e-".repeat(10), POORT: "3466", PORTAAL_MAP: new URL("../dist", import.meta.url).pathname },
  stdio: ["ignore", "ignore", "inherit"],
  detached: true,
});
const stopApi = () => { try { process.kill(-api.pid); } catch {} };
for (let i = 0; i < 40; i++) {
  try { if ((await fetch(`${BASIS}/gezondheid`)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 250));
}

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: "nl-NL", timezoneId: "Europe/Amsterdam" });
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("  PAGINAFOUT", e.message); fouten++; });
const shot = (naam) => page.screenshot({ path: `${SHOTS}/${naam}.png` });
const inloggen = async (naam) => {
  await page.goto(`${BASIS}/portaal/#/login`);
  await page.getByLabel("Gebruikersnaam").fill(naam);
  await page.getByLabel("Wachtwoord").fill("demo");
  await page.getByRole("button", { name: "Inloggen" }).click();

};

try {
  console.log("\nKwaliteit raadpleegt een certificaatconcept");
  // Een lot dat gereed is en waarvan alle kenmerken binnen de specificatie vallen.
  const goedLot = `SELECT l.lotnummer FROM fabriek.lot l WHERE l.status = 'gereed'
      AND NOT EXISTS (SELECT 1 FROM fabriek.batch b WHERE b.lot_id = l.id AND b.status = 'afgekeurd')
      AND NOT EXISTS (SELECT 1 FROM fabriek.waarde_actueel w JOIN fabriek.stapregistratie r ON r.id = w.stapregistratie_id
                        JOIN fabriek.veld v ON v.id = w.veld_id LEFT JOIN fabriek.batch b ON b.id = r.batch_id
                       WHERE v.op_certificaat AND w.markering = 'buiten_grens' AND (r.lot_id = l.id OR b.lot_id = l.id))
        AND (SELECT p.code FROM fabriek.product p WHERE p.id = fabriek.lot_product(l.id)) = $1
      ORDER BY l.lotnummer DESC LIMIT 1`;
  const [lot] = await q(goedLot, ["PRD-A"]);
  await inloggen("kwaliteit1");
  await page.locator(".starttegel-kwaliteit").click();
  await page.goto(`${BASIS}/portaal/#/kwaliteit/lotpaspoort/${lot.lotnummer}`);
  await page.getByRole("link", { name: "Certificaat" }).click();
  await page.getByRole("heading", { name: `Certificaat ${lot.lotnummer} (concept)` }).waitFor();
  check("Concept met 5 kenmerken", (await page.locator(".cert-tabel tbody tr").count()) === 5);
  check("Alle kenmerken voldoen", (await page.locator(".cert-tabel td", { hasText: "✓ Ja" }).count()) === 5);
  check("Concept-watermerk", await page.locator(".certificaat.concept").isVisible());
  check("Geen uitgifteknop in fase 1", await page.getByRole("button", { name: "Uitgeven", exact: true }).count() === 0);
  await page.getByText("Nieuwe certificaatuitgifte wacht op de MES-kwaliteitsvrijgave in fase 7.", { exact: false }).waitFor();
  const token = await page.evaluate(() => localStorage.getItem("portaal.token"));
  const headers = { authorization: "Bearer "+token };
  const pad = "/certificaten/lots/"+lot.lotnummer;
  const response = await fetch(BASIS+pad,{headers});
  if (!response.ok) throw new Error("Concept ophalen mislukt: "+response.status);
  const concept = (await response.json()).concept;
  const [voor] = await q("SELECT count(*)::int AS n FROM fabriek.certificaat");
  check("Nieuwe uitgifte via API geweigerd", (await fetch(BASIS+pad,{method:"POST",headers})).status === 403);
  check("Geen certificaat toegevoegd", (await q("SELECT count(*)::int AS n FROM fabriek.certificaat"))[0].n === voor.n);
  // Historische fictieve fixture via database-eigenaar, geen nieuwe applicatie-uitgifte.
  const [c] = await q(`INSERT INTO fabriek.certificaat(lot_id,inhoud,uitgegeven_door)
    SELECT l.id,$2::jsonb,g.id FROM fabriek.lot l CROSS JOIN fabriek.gebruiker g
    WHERE l.lotnummer=$1 AND g.gebruikersnaam='kwaliteit1' RETURNING nummer`,[lot.lotnummer,JSON.stringify(concept)]);
  await page.goto(BASIS+"/portaal/#/kwaliteit/certificaat/"+lot.lotnummer+"/"+c.nummer);
  await page.getByRole("heading", { name: "Certificaat nr. "+c.nummer }).waitFor();
  check("Historische herdruk met oorspronkelijk nummer en zonder conceptwatermerk", await page.locator(".certificaat.concept").count() === 0 && await page.locator(".cert-nummer").innerText() === "Nr. "+c.nummer);
  const herdruk = await fetch(BASIS+"/certificaten/"+c.nummer,{headers});
  check("Historische inhoud ongewijzigd", herdruk.ok && (await q("SELECT $1::jsonb = $2::jsonb AS gelijk",[JSON.stringify((await herdruk.json()).inhoud),JSON.stringify(concept)]))[0].gelijk === true);
  await page.emulateMedia({ media: "print" });
  await page.screenshot({ path: `${SHOTS}/01-certificaat-print.png`, fullPage: true });
  check("Bij afdrukken alleen het certificaat (geen menu of knoppen)", !(await page.locator("#menu").isVisible()) && !(await page.getByRole("button", { name: "Afdrukken of pdf" }).isVisible()));
  check("Historische afdruk behoudt tabel, nummer en printstijl", await page.locator(".certificaat").evaluate(el=>getComputedStyle(el).boxShadow==="none" && getComputedStyle(el).borderTopWidth==="0px" && el.querySelectorAll(".cert-tabel tbody tr").length===5 && !!el.querySelector(".cert-nummer")?.textContent?.trim()));
  const pdf = await page.pdf({path:`${SHOTS}/01-certificaat.pdf`,preferCSSPageSize:true,printBackground:true});
  check("Chromium genereert historische PDF", pdf.subarray(0,5).toString()==="%PDF-" && pdf.length>1000);
  await page.emulateMedia({ media: "screen" });

  console.log("\nLot van een product met een andere route (D55)");
  // PRD-C slaat PS17 over: het kenmerk uit PS17 hoort dan niet op het certificaat.
  const [lotC] = await q(goedLot, ["PRD-C"]);
  const [{ n: nC }] = await q(`SELECT count(*)::int AS n FROM fabriek.veld v WHERE v.op_certificaat AND v.actief
      AND fabriek.in_route((SELECT id FROM fabriek.product WHERE code = 'PRD-C'), v.processtap_id)`);
  await page.goto(`${BASIS}/portaal/#/kwaliteit/certificaat/${lotC.lotnummer}`);
  await page.getByRole("heading", { name: `Certificaat ${lotC.lotnummer} (concept)` }).waitFor();
  // 4 kenmerken uit de processtappen plus de 3 van de eindkeuring (#80).
  check(`PRD-C: alleen de ${nC} kenmerken uit zijn route, en ze voldoen allemaal`, nC === 7 && (await page.locator(".cert-tabel tbody tr").count()) === nC
    && (await page.locator(".cert-tabel td", { hasText: "✓ Ja" }).count()) === nC);
  check("PRD-C: getoetst aan de specificaties, met versie", (await page.locator(".certificaat").innerText()).includes("specificatie Eindkeuring versie 1"));
  check("PRD-C: geen PS17 op het certificaat", !(await page.locator(".cert-tabel").innerText()).includes("PS17"));

  console.log("\nLot dat niet gereed is");
  const [open] = await q("SELECT lotnummer FROM fabriek.lot WHERE status = 'in_productie' LIMIT 1");
  if (open) {
    await page.goto(`${BASIS}/portaal/#/kwaliteit/certificaat/${open.lotnummer}`);
    await page.getByRole("heading", { name: `Certificaat ${open.lotnummer} (concept)` }).waitFor();
    check("Uitgeven kan niet als het lot niet gereed is", await page.getByRole("button", { name: "Uitgeven", exact: true }).count() === 0);
  }

  console.log("\nCertificaatinstellingen en historische bescherming");
  const instellingen = { bedrijfsnaam:"Testfabriek (fictief)", bedrijfsadres:"Testweg 1", certificaat_verklaring:"Test." };
  check("Kwaliteit kan bedrijfsgegevens niet wijzigen", (await fetch(BASIS+"/certificaten/instellingen",{method:"PUT",headers:{...headers,"content-type":"application/json"},body:JSON.stringify(instellingen)})).status === 403);
  await page.evaluate(() => localStorage.clear());
  await inloggen("beheerder1");
  await page.locator(".starttegel-beheer").click();
  await page.getByRole("heading",{name:"Accounts",exact:true}).waitFor();
  check("Technisch beheer heeft geen bedrijfsgegevensmenu", await page.getByRole("link",{name:"Bedrijfsgegevens"}).count() === 0);
  const beheerToken = await page.evaluate(() => localStorage.getItem("portaal.token"));
  const beheerHeaders = {...headers,authorization:"Bearer "+beheerToken};
  check("Technisch beheer mag certificaatinstellingen niet wijzigen", (await fetch(BASIS+"/certificaten/instellingen",{method:"PUT",headers:{...beheerHeaders,"content-type":"application/json"},body:JSON.stringify(instellingen)})).status === 403);
  check("Technisch beheer heeft geen historische lotscope", (await fetch(BASIS+"/certificaten/"+c.nummer,{headers:beheerHeaders})).status === 404);
  const [historie] = await q("SELECT inhoud = $2::jsonb AS gelijk FROM fabriek.certificaat WHERE nummer=$1",[c.nummer,JSON.stringify(concept)]);
  check("Historische inhoud ongewijzigd na geweigerde handelingen", historie.gelijk === true);
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
