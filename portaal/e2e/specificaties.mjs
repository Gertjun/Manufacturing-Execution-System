// Test van keuringsstappen en specificaties (#80, D73) in Chrome, op data van tools/genereer_testdata.py.
// Historische specificaties alleen lezen; tussenkeuring tegen bestaande versie en persoonlijke vrijgave.
// Gebruik: node e2e/specificaties.mjs   (start zelf de API op poort 3471)
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import pg from "pg";

const DB = process.env.DATABASE_URL ?? "postgres://postgres@localhost/batchgui?host=/tmp&port=5433";
const APP_DB = process.env.TEST_APP_DATABASE_URL;
if (!APP_DB || APP_DB === DB) throw new Error("TEST_APP_DATABASE_URL moet een afzonderlijke beperkte MES-testverbinding zijn");
const SHOTS = process.env.SHOTS ?? "/tmp/shots-specificaties";
const BASIS = "http://localhost:3471";
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
  env: { ...process.env, DATABASE_URL: APP_DB, JWT_GEHEIM: "e2e-".repeat(10), POORT: "3471", PORTAAL_MAP: new URL("../dist", import.meta.url).pathname },
  stdio: ["ignore", "ignore", "inherit"],
  detached: true,
});
const stopApi = () => { try { process.kill(-api.pid); } catch {} };
for (let i = 0; i < 40; i++) {
  try { if ((await fetch(`${BASIS}/gezondheid`)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 250));
}

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "nl-NL", timezoneId: "Europe/Amsterdam" });
const page = await context.newPage();
page.on("pageerror", (e) => { console.log("  PAGINAFOUT", e.message); fouten++; });
const shot = (naam) => page.screenshot({ path: `${SHOTS}/${naam}.png`, fullPage: true });
const dialoog = () => page.getByRole("dialog");
const inloggen = async (naam) => {
  await page.goto(`${BASIS}/portaal/#/login`);
  await page.getByLabel("Gebruikersnaam").fill(naam);
  await page.getByLabel("Wachtwoord").fill("demo");
  await page.getByRole("button", { name: "Inloggen" }).click();
};

try {
  console.log("\nSpecificaties in het portaal Kwaliteit");
  await inloggen("kwaliteit1");
  await page.locator(".startpagina").waitFor();
  await page.goto(`${BASIS}/portaal/#/kwaliteit/specificaties/PRD-C`);
  await page.getByRole("heading", { name: "TK1 Tussenkeuring 1" }).waitFor();
  check("PRD-C: drie keuringsstappen in de volgorde van de route",
    (await page.locator(".spec-stap h2").allInnerTexts()).join(",") === "TK1 Tussenkeuring 1,TK2 Tussenkeuring 2,EK Eindkeuring");
  const tk1 = page.locator(".spec-stap", { has: page.getByRole("heading", { name: "TK1 Tussenkeuring 1" }) });
  check("Geldige versie 1 met de grenzen", (await tk1.innerText()).includes("versie 1") && (await tk1.locator("tr", { hasText: "TK1.1" }).innerText()).includes("≤ 4"));
  await page.getByText("Alleen-lezen: bestaande specificaties en versies blijven raadpleegbaar.",{exact:false}).waitFor();
  check("Geen nieuwe versie of vaststelling via scherm", await page.getByRole("button",{name:/Nieuwe versie|vaststellen/i}).count() === 0);
  const token = await page.evaluate(() => localStorage.getItem("portaal.token"));
  const headers = {authorization:"Bearer "+token,"content-type":"application/json"};
  const lees = async () => { const r=await fetch(BASIS+"/specificaties?product=PRD-C",{headers}); if(!r.ok) throw new Error("Specificaties ophalen: "+r.status); return r.json(); };
  const voor = await lees();
  const id = voor.stappen.find(s=>s.stap==="TK1").geldig.id;
  for(const [method,pad,body] of [
    ["POST","/specificaties",{product:"PRD-C",stap:"TK1"}],
    ["PUT","/specificaties/"+id,{regels:[]}],
    ["POST","/specificaties/"+id+"/vaststellen",undefined],
    ["POST","/specificaties/"+id+"/weggooien",undefined]
  ]) {
    check("Specificaties: geweigerd "+method+" "+pad,(await fetch(BASIS+pad,{method,headers:body===undefined?{authorization:headers.authorization}:headers,...(body===undefined?{}:{body:JSON.stringify(body)})})).status===403);
  }
  check("Historische specificaties ongewijzigd",JSON.stringify(await lees())===JSON.stringify(voor));
  await shot("01-historische-specificatie");
  await page.goto(`${BASIS}/portaal/#/kwaliteit/specificaties/PRD-A`);
  await page.locator(".leeg", { hasText: "geen keuringsstappen" }).waitFor();
  check("PRD-A zonder keuringsstappen: uitleg waar je ze toevoegt", true);

  console.log("\nTussenkeuring op de lab-pc (invoerscherm)");
  // Een nieuwe batch van PRD-C door PS1–PS3, met gewone fictieve waarden; daarna staat hij klaar voor TK1.
  const stap = "TK1", nr = `B-2026-9${String(Date.now()).slice(-3)}`;  // nieuw nummer, ook bij een tweede run op dezelfde data
  await q(`DO $$
    DECLARE b uuid; r uuid; s text; op uuid := (SELECT id FROM fabriek.operator WHERE naam = 'operator.a' OR gebruiker_id = (SELECT id FROM fabriek.gebruiker WHERE gebruikersnaam = 'operator.a') LIMIT 1);
            pc uuid := (SELECT id FROM fabriek.pc ORDER BY naam LIMIT 1);
    BEGIN
      SET LOCAL search_path = fabriek, public;
      INSERT INTO batch (batchnummer, aangemaakt_door, product_id) VALUES ('${nr}', op, (SELECT id FROM product WHERE code = 'PRD-C')) RETURNING id INTO b;
      FOREACH s IN ARRAY ARRAY['PS1','PS2','PS3'] LOOP
        r := start_stap(s, b, NULL, pc, op);
        INSERT INTO grondstof_gebruik (stapregistratie_id, grondstof_id, partij, ingevoerd_door)
        SELECT r, x.grondstof_id, 'LEV-TEST-01', op FROM stap_grondstof x JOIN processtap p ON p.id = x.processtap_id WHERE p.code = s AND x.verplicht;
        INSERT INTO waarde (stapregistratie_id, veld_id, setting, gemeten, ingevoerd_door)
        SELECT r, v.id, CASE WHEN v.soort = 'procesparameter' THEN (v.grens_min + v.grens_max) / 2 END, (v.grens_min + v.grens_max) / 2, op
          FROM veld v JOIN processtap p ON p.id = v.processtap_id WHERE p.code = s AND v.actief AND v.gemeten_door = 'productie';
        PERFORM rond_stap_af(r);
      END LOOP;
    END $$`);
  check("Er staat een batch klaar voor TK1", (await q("SELECT nummer FROM fabriek.werkvoorraad('TK1') WHERE nummer = $1", [nr])).length === 1);
  await page.goto(`${BASIS}/portaal/#/`);
  await page.locator(".starttegel-invoer").click();
  const pc = page.getByRole("button", { name: /^PC-20/ });
  // Kwaliteit opent op Keuringen (#88).
  const start = page.getByRole("heading", { name: "Keuringen", level: 1 });
  await Promise.race([pc.waitFor(), start.waitFor()]);
  if (await pc.isVisible()) await pc.click();
  await start.waitFor();
  await page.locator(".route.keuring .tegel").first().waitFor();
  const groep = [await page.getByRole("heading", { name: "Keuringsstappen", exact: true }).count(), await page.locator(".route.keuring .tegel").count()];
  check("Kwaliteit ziet de keuringsstappen als eigen groep", groep[0] === 1 && groep[1] === 3, JSON.stringify(groep));
  check("Nog niet gestarte keuring staat niet tussen openstaande besluiten", !(await page.locator(".keuring-blok").first().innerText()).includes(nr));
  await page.goto(`${BASIS}/invoer/#/stap/${stap}`);
  const rij = page.locator(".rij", { hasText: nr });
  await rij.getByRole("button", { name: "Keuring starten" }).waitFor();
  check("Batch staat klaar voor TK1 in de werkvoorraad",await rij.getByRole("button", { name: "Keuring starten" }).isVisible());
  await rij.getByRole("button", { name: "Keuring starten" }).click();
  // Zodra de start bij de server is, ververst het scherm: afgerond en de keuring staat open.
  await page.getByText("Wacht op Kwaliteit").first().waitFor({ timeout: 15000 });
  check("Na de start: keuring open, grens uit versie 1 zichtbaar", (await page.locator("body").innerText()).includes("Maximaal 4"));
  const velden = stap === "TK1" ? [["TK1.1", "3,9"], ["TK1.2", "260"]] : [["TK2.1", "620"]];
  for (const [code, w] of velden) await page.locator(`[id="g-${code}"]`).fill(w);
  await page.getByRole("button", { name: "Opslaan" }).click();
  await dialoog().getByRole("button", { name: "Opslaan" }).click();
  await page.getByRole("button", { name: "Vrijgeven" }).and(page.locator(":not([disabled])")).waitFor({ timeout: 15000 });
  await shot("02-keuring");
  await page.getByRole("button", { name: "Vrijgeven" }).click();
  await dialoog().getByRole("button", { name: "Vrijgeven" }).click();
  await dialoog().getByLabel("Je eigen wachtwoord").fill("demo");
  await dialoog().getByRole("button", { name: "Besluit bevestigen" }).click();
  await page.locator(".label-keuring-vrijgegeven").waitFor();
  let k = null;
  for (let i = 0; i < 20 && k?.status !== "vrijgegeven"; i++) {
    [k] = await q(`SELECT k.status, r.status AS reg FROM fabriek.keuring k JOIN fabriek.stapregistratie r ON r.id = k.stapregistratie_id
                    JOIN fabriek.processtap s ON s.id = r.processtap_id JOIN fabriek.batch b ON b.id = r.batch_id
                   WHERE s.code = $1 AND b.batchnummer = $2`, [stap, nr]);
    if (k?.status !== "vrijgegeven") await page.waitForTimeout(250);
  }
  check("Keuring gestart (meteen afgerond) en vrijgegeven", k?.status === "vrijgegeven" && k?.reg === "afgerond", JSON.stringify(k));
  if (stap === "TK1") {
    const [m] = await q(`SELECT w.markering, w.grens_max::float AS max, x.versie FROM fabriek.waarde w JOIN fabriek.veld v ON v.id = w.veld_id
                          JOIN fabriek.specificatie x ON x.id = w.specificatie_id
                          JOIN fabriek.stapregistratie r ON r.id = w.stapregistratie_id JOIN fabriek.batch b ON b.id = r.batch_id
                         WHERE v.code = 'TK1.1' AND b.batchnummer = $1`, [nr]);
    check("3,9 % is binnen versie 1 (max 4), en de meting bewaart versie 1", m?.markering === "ok" && m?.max === 4 && m?.versie === 1, JSON.stringify(m));
  }

  console.log("\nOperator ziet geen keuringsstappen");
  await page.goto(`${BASIS}/invoer/#/stappen`);
  await page.getByRole("button", { name: "Afmelden" }).click();
  // Staat er nog iets in de wachtrij, dan vraagt het invoerscherm eerst of je toch wilt afmelden.
  const nogEven = dialoog().getByRole("button", { name: "Afmelden" });
  if (await nogEven.waitFor({ timeout: 2000 }).then(() => true, () => false)) await nogEven.click();
  await page.getByLabel("Gebruikersnaam").fill("operator.a");
  await page.getByLabel("Wachtwoord").fill("demo");
  await page.getByRole("button", { name: "Inloggen" }).click();
  await page.getByRole("heading", { name: "Kies een stap" }).waitFor();
  await page.locator(".route .tegel").first().waitFor();
  check("Geen keuringstegels voor een operator", (await page.locator(".route.keuring").count()) === 0 && (await page.locator(".tegel").count()) === 18);
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
