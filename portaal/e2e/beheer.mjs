// Test van het Portaal Beheer in Chrome, plus de doorwerking op het invoerscherm.
// Verwacht: database met schema.sql + seed_config.sql + seed_accounts_demo.sql (+ eventueel seed_demo.sql),
// en een gebouwd invoerscherm. Gebruik: node e2e/beheer.mjs (API op poort 3461).
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright-core";
import pg from "pg";

const DB = process.env.DATABASE_URL ?? "postgres://postgres@localhost/batchgui?host=/tmp&port=5433";
const APP_DB = process.env.TEST_APP_DATABASE_URL;
if (!APP_DB || APP_DB === DB) throw new Error("TEST_APP_DATABASE_URL moet een afzonderlijke beperkte MES-testverbinding zijn");
const SHOTS = process.env.SHOTS ?? "/tmp/shots-beheer";
const BASIS = "http://localhost:3461";
mkdirSync(SHOTS, { recursive: true });

let fouten = 0;
const check = (naam, ok, extra = "") => {
  console.log(`${ok ? "  OK  " : "  FOUT"} ${naam}${!ok && extra ? `  [${extra}]` : ""}`);
  if (!ok) fouten++;
};

const api = spawn("npx", ["tsx", "src/index.ts"], {
  cwd: new URL("../../api/", import.meta.url).pathname,
  env: { ...process.env, DATABASE_URL: APP_DB, JWT_GEHEIM: "e2e-".repeat(10), POORT: "3461",
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
const shot = (naam, fullPage = true) => (naam === "fout" || process.env.MES_SCREENSHOTS === "review") ? page.screenshot({ path: `${SHOTS}/${naam}.png`, fullPage }) : Promise.resolve();
const dialoog = () => page.getByRole("dialog");
const inloggen = async naam => {
  if (page.url().startsWith(BASIS)) {
    await page.getByRole("button",{name:"Afmelden",exact:true}).click();
  } else {
    await page.goto(BASIS+"/portaal/#/login");
  }
  await page.getByRole("heading",{name:"Inloggen",exact:true}).waitFor();
  await page.getByLabel("Gebruikersnaam").fill(naam);
  await page.getByLabel("Wachtwoord").fill("demo");
  const login = page.waitForResponse(r=>new URL(r.url()).pathname==="/auth/login" && r.request().method()==="POST");
  await page.getByRole("button",{name:"Inloggen",exact:true}).click();
  const response = await login;
  if (!response.ok()) throw new Error("Aanmelding "+naam+": HTTP "+response.status());
  const result = await response.json();
  if (result.wachtwoordWijzigen) throw new Error("Onverwacht tijdelijk wachtwoord: "+naam);
  await page.getByRole("heading",{name:"Welkom, "+naam,exact:true}).waitFor();
  await page.locator(".starttegel-beheer").click();
};
const token = () => page.evaluate(()=>localStorage.getItem("portaal.token"));
const verzoek = (method,pad,t,body) => fetch(BASIS+pad,{method,headers:{authorization:"Bearer "+t,...(body===undefined?{}:{"content-type":"application/json"})},...(body===undefined?{}:{body:JSON.stringify(body)})});

try {
  console.log("\nStappen en velden");
  await inloggen("mes.engineer");
  await page.getByRole("heading", { name: "Stappen en velden" }).waitFor();
  check("Process Engineer komt in het configuratieportaal", page.url().includes("#/beheer"));

  await page.locator(".stappenlijst a", { hasText: "PS3" }).click();
  await page.getByRole("heading", { name: "PS3 Process Step 3" }).waitFor();
  await page.getByRole("button", { name: "Naam wijzigen" }).click();
  await dialoog().getByLabel("Naam").fill("Mengen");
  await dialoog().getByRole("button", { name: "Opslaan" }).click();
  await page.getByRole("heading", { name: "PS3 Mengen" }).waitFor();
  check("Stap PS3 heet nu Mengen", true);

  await page.getByRole("button", { name: "Veld toevoegen" }).click();
  await dialoog().getByLabel("Soort veld").selectOption("overig");
  await dialoog().getByRole("button", { name: "Verder" }).click();
  await dialoog().getByLabel("Naam").fill("pH");
  await dialoog().getByLabel(/Ondergrens/).fill("8");
  await dialoog().getByLabel(/Bovengrens/).fill("6");
  await dialoog().getByRole("button", { name: "Veld toevoegen" }).click();
  await page.locator("#melding", { hasText: "ondergrens is hoger" }).waitFor();
  check("Ondergrens boven bovengrens wordt geweigerd", true);
  await page.getByRole("button", { name: "Veld toevoegen" }).click();
  await dialoog().getByLabel("Soort veld").selectOption("overig");
  await dialoog().getByRole("button", { name: "Verder" }).click();
  await dialoog().getByLabel("Naam").fill("pH");
  await dialoog().getByLabel(/Ondergrens/).fill("6");
  await dialoog().getByLabel(/Bovengrens/).fill("8,5");
  await dialoog().getByRole("button", { name: "Veld toevoegen" }).click();
  await page.locator("tr", { hasText: "S3.4" }).waitFor();
  const s34 = page.locator("tr", { hasText: "S3.4" });
  check("Nieuw veld kreeg code S3.4, grenzen in twee kolommen (#96)", (await s34.locator('td[data-kop="Ondergrens"]').innerText()).trim() === "6"
    && (await s34.locator('td[data-kop="Bovengrens"]').innerText()).trim() === "8,5");

  await page.locator("tr", { hasText: "S3.1" }).getByRole("button", { name: "Wijzigen" }).click();
  await dialoog().getByLabel(/Tolerantie \(/).fill("8");
  await dialoog().getByRole("button", { name: "Opslaan" }).click();
  await page.locator("tr", { hasText: "S3.1" }).getByText("±8 °C").waitFor();
  check("Tolerantie S3.1 is 8", true);
  // #64: wie meet. Het nieuwe veld S3.4 laat Kwaliteit meten.
  await page.locator("tr", { hasText: "S3.4" }).getByRole("button", { name: "Wijzigen" }).click();
  await dialoog().getByLabel("Wie meet").selectOption("kwaliteit");
  await dialoog().getByRole("button", { name: "Opslaan" }).click();
  await page.locator("tr", { hasText: "S3.4" }).getByText("Kwaliteit", { exact: true }).waitFor();
  const [{ door }] = await q("SELECT gemeten_door AS door FROM fabriek.veld WHERE code = 'S3.4'");
  check("Wie meet: Kwaliteit opgeslagen (#64)", door === "kwaliteit");

  // Uitzetten is terug te draaien: geen vraag vooraf, wel "Ongedaan maken" in de melding (#44, D50).
  await page.locator("tr", { hasText: "S3.4" }).getByRole("button", { name: "Uitzetten" }).click();
  await page.locator("tr", { hasText: "S3.4" }).getByRole("button", { name: "Weer aanzetten" }).waitFor();
  check("Uitzetten zonder vraag vooraf", (await dialoog().count()) === 0);
  await page.locator("#melding").getByRole("button", { name: "Ongedaan maken" }).click();
  await page.locator("tr", { hasText: "S3.4" }).getByRole("button", { name: "Uitzetten" }).waitFor();
  check("Ongedaan maken zet S3.4 weer aan", !(await page.locator("tr", { hasText: "S3.4" }).innerText()).includes("(uit)"));
  await page.locator("tr", { hasText: "S3.4" }).getByRole("button", { name: "Uitzetten" }).click();
  await page.locator("tr", { hasText: "S3.4" }).getByRole("button", { name: "Weer aanzetten" }).waitFor();
  await shot("01-stappen-en-velden");
  check("S3.4 staat uit", (await page.locator("tr", { hasText: "S3.4" }).innerText()).includes("(uit)"));

  console.log("\nGrenzen per product (D55, #96: eerst het product kiezen)");
  check("Geen knop 'Per product' meer bij elk veld", (await page.getByRole("button", { name: "Per product" }).count()) === 0);
  // #95: de knoppen van het stapblok staan bij elke stap op dezelfde plek.
  const knopPlek = async () => { const b = await page.getByRole("button", { name: "Veld toevoegen" }).boundingBox(); return `${Math.round(b.x)},${Math.round(b.y)}`; };
  const plekPS3 = await knopPlek();
  await page.getByRole("link", { name: /PS1\b/ }).first().click();
  await page.getByRole("heading", { name: /^PS1 / }).waitFor();
  check("Knoppen van het stapblok op dezelfde plek (#95)", (await knopPlek()) === plekPS3, `${plekPS3} / ${await knopPlek()}`);
  await page.goto(`${BASIS}/portaal/#/beheer/stappen/PS3`);
  await page.getByRole("heading", { name: "PS3 Mengen" }).waitFor();
  await page.locator("#stap-product").selectOption("PRD-B");
  await page.locator(".filter-product.gekozen").waitFor();
  await page.locator("tr", { hasText: "S3.1" }).getByRole("button", { name: "S3.1 grenzen voor PRD-B" }).click();
  check("Grenzen voor PRD-B: voorgevuld met de grenzen van het veld", (await dialoog().getByLabel(/Tolerantie \(/).inputValue()) === "8");
  await dialoog().getByLabel(/Tolerantie \(/).fill("2,5");
  await dialoog().getByLabel("Bovengrens").fill("100");
  await dialoog().getByRole("button", { name: "Opslaan" }).click();
  await page.locator("tr", { hasText: "S3.1" }).getByText("±2,5 °C").waitFor();
  const s31 = page.locator("tr", { hasText: "S3.1" });
  check("PRD-B heeft eigen grenzen voor S3.1", (await s31.locator('td[data-kop="Bovengrens"]').innerText()).trim() === "100 °C"
    && (await s31.locator(".eigen-grens").count()) === 1);
  const [vp] = await q(`SELECT vp.tolerantie::float AS t, vp.grens_max::float AS m FROM fabriek.veld_product vp JOIN fabriek.veld v ON v.id = vp.veld_id
                         JOIN fabriek.product p ON p.id = vp.product_id WHERE v.code = 'S3.1' AND p.code = 'PRD-B'`);
  check("Tabel past in de breedte, knoppen zichtbaar (#95)", await page.locator(".stap-blok .tabel-kader").evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
  check("Opgeslagen in de database", vp?.t === 2.5 && vp?.m === 100, JSON.stringify(vp));
  await shot("01b-grenzen-per-product");
  await page.locator("#stap-product").selectOption("");
  await page.locator("tr", { hasText: "S3.1" }).getByText("Eigen grenzen: PRD-B").waitFor();
  check("Alle producten: bij het veld staat welke producten eigen grenzen hebben", true);
  await page.locator("#stap-product").selectOption("PRD-B");
  await page.locator(".filter-product.gekozen").waitFor();
  await page.locator("tr", { hasText: "S3.1" }).getByRole("button", { name: "S3.1 grenzen voor PRD-B" }).click();
  await dialoog().getByLabel("Grenzen voor dit product").selectOption("veld");
  await dialoog().getByRole("button", { name: "Opslaan" }).click();
  await page.locator("#melding", { hasText: "volgt weer de grenzen" }).waitFor();
  await page.waitForFunction(() => !document.querySelector(".eigen-grens"));
  check("Zelfde als het veld: eigen grenzen weg", (await q("SELECT count(*)::int AS n FROM fabriek.veld_product vp JOIN fabriek.veld v ON v.id = vp.veld_id WHERE v.code = 'S3.1'"))[0].n === 0);
  // Een product met een eigen route toont alleen zijn eigen stappen (PRD-C slaat PS6 over, D55).
  await page.locator("#stap-product").selectOption("PRD-C");
  await page.locator(".filter-product.gekozen").waitFor();
  await page.waitForFunction(() => document.querySelector("#stap-product")?.value === "PRD-C");
  check("PRD-C: PS6 staat niet in de stappenlijst", (await page.locator(".stappenlijst a .code", { hasText: /^PS6$/ }).count()) === 0
    && (await page.locator(".stappenlijst a .code", { hasText: /^PS5$/ }).count()) === 1);
  await page.locator("#stap-product").selectOption("");
  await page.waitForFunction(() => !document.querySelector(".filter-product.gekozen"));

  console.log("\nGescheiden account- en personeelsbeheer");
  const engineer = await token();
  check("Engineer heeft geen account- of personeelsmenu",await page.getByRole("link",{name:"Accounts",exact:true}).count()===0 && await page.getByRole("link",{name:"Personeel",exact:true}).count()===0);
  check("Engineer mag geen accounts lezen",(await verzoek("GET","/beheer/gebruikers",engineer)).status===403);
  await inloggen("mes.system");
  await page.getByRole("heading",{name:"Accounts",exact:true}).waitFor();
  await page.locator("tr",{hasText:"mes.system"}).waitFor();
  const system=await token();
  check("System Administrator heeft geen personeels- of engineeringmenu",await page.getByRole("link",{name:"Personeel",exact:true}).count()===0 && await page.getByRole("link",{name:"Stappen en velden",exact:true}).count()===0);
  check("Eigen account heeft geen uitzetknop",await page.locator("tr",{hasText:"mes.system"}).getByRole("button",{name:"Uitzetten"}).count()===0);
  check("Historisch gedeeld account is als geblokkeerd gemarkeerd",await page.locator("tr",{hasText:"Historisch gedeeld (login geblokkeerd)"}).count()>=1);
  await page.getByRole("button",{name:"Account aanmaken"}).click();
  await dialoog().getByLabel("Gebruikersnaam").fill("Kwaliteit 2");
  await dialoog().getByLabel("Tijdelijk wachtwoord").fill("geheim-123");
  await dialoog().getByRole("button",{name:"Aanmaken",exact:true}).click();
  check("Ongeldige gebruikersnaam wordt geweigerd",await dialoog().isVisible());
  await dialoog().getByLabel("Gebruikersnaam").fill("kwaliteit2");
  await dialoog().getByRole("button",{name:"Aanmaken",exact:true}).click();
  await page.locator("tr",{hasText:"kwaliteit2"}).waitFor();
  const [account]=await q("SELECT g.id,g.rol,g.wachtwoord_wijzigen,(SELECT count(*)::int FROM fabriek.authorization_grant a WHERE a.user_id=g.id) AS grants,(SELECT count(*)::int FROM fabriek.operator o WHERE o.gebruiker_id=g.id) AS personen FROM fabriek.gebruiker g WHERE g.gebruikersnaam='kwaliteit2'");
  check("Account pending, tijdelijk wachtwoord, geen grants of personeelskoppeling",account.rol==="pending"&&account.wachtwoord_wijzigen&&account.grants===0&&account.personen===0,JSON.stringify(account));
  check("Legacy roltoekenning geweigerd",(await verzoek("PATCH","/beheer/gebruikers/kwaliteit2",system,{rol:"kwaliteit"})).status===422);
  check("Technisch beheer mag geen personeel aanmaken",(await verzoek("POST","/beheer/operators",system,{naam:"Onbevoegd"})).status===403);
  check("Technisch beheer mag geen meetveld wijzigen",(await verzoek("PATCH","/beheer/velden/S3.1",system,{tolerantie:9})).status===403);
  await page.locator("tr",{hasText:"kwaliteit2"}).getByRole("button",{name:"Uitzetten"}).click();
  await dialoog().getByRole("button",{name:"Uitzetten"}).click();
  await page.locator("tr",{hasText:"kwaliteit2"}).getByRole("button",{name:"Activeren"}).waitFor();
  check("Account uitgezet",(await q("SELECT actief FROM fabriek.gebruiker WHERE id=$1",[account.id]))[0].actief===false);
  await shot("02-accounts");
  await inloggen("mes.manager");
  await page.getByRole("link",{name:"Personeel",exact:true}).click();
  await page.locator("tr",{hasText:"Operator A"}).waitFor();
  const manager=await token();
  check("Manufacturing Manager ziet bestaande persoonlijke koppeling", (await page.locator("tr",{hasText:"Operator A"}).innerText()).includes("operator.a"));
  check("Manager heeft geen technisch accountmenu",await page.getByRole("link",{name:"Accounts",exact:true}).count()===0);
  check("Manager mag geen account aanmaken",(await verzoek("POST","/beheer/gebruikers",manager,{gebruikersnaam:"onbevoegd.test",wachtwoord:"geheim-123"})).status===403);
  await page.getByRole("button",{name:"Persoon toevoegen"}).click();
  await dialoog().getByLabel("Naam", {exact:true}).fill("Operator I");
  const roosterRes = await verzoek("GET","/overdracht/rooster?dagen=1",manager);
  if (!roosterRes.ok) throw new Error("Ploegen ophalen als manager: "+roosterRes.status+" "+await roosterRes.text());
  const roosterData = await roosterRes.json();
  const verwachtPloegen = roosterData.ploegen.filter(p=>p.actief).map(p=>p.code).sort();
  const ploegSelect = dialoog().locator("select#v-ploeg");
  if (await ploegSelect.count() !== 1) throw new Error("Ploegkeuzelijst ontbreekt; actieve ploegen: "+JSON.stringify(verwachtPloegen)+"; dialoog: "+await dialoog().innerText());
  const opties = await ploegSelect.locator("option").evaluateAll(els=>els.map(el=>el.value).filter(Boolean).sort());
  check("Ploegkeuze bevat alle actieve ploegen", JSON.stringify(opties)===JSON.stringify(verwachtPloegen) && opties.includes("B1") && opties.includes("D2"),JSON.stringify(opties));
  await ploegSelect.selectOption("B1");
  await dialoog().getByRole("button",{name:"Opslaan"}).click();
  await page.locator("tr",{hasText:"Operator I"}).waitFor();
  const [persoon]=await q("SELECT id,gebruiker_id FROM fabriek.operator WHERE naam='Operator I'");
  check("Personeelsidentiteit zonder account",persoon.gebruiker_id===null);
  await page.locator("tr",{hasText:"Operator I"}).getByRole("button",{name:"Wijzigen"}).click();
  await dialoog().locator("select#v-ploeg").selectOption("D2");
  await dialoog().getByRole("button",{name:"Opslaan"}).click();
  await page.locator("tr",{hasText:"Operator I"}).getByText("D2",{exact:true}).waitFor();
  const [ploeg]=await q("SELECT p.code FROM fabriek.operator o JOIN fabriek.rooster_ploeg p ON p.id=o.ploeg_id WHERE o.id=$1",[persoon.id]);
  check("Ploeg gewijzigd",ploeg.code==="D2");
  check("Geen koppeling via personeels-API", (await verzoek("PATCH","/beheer/operators/"+persoon.id,manager,{gebruiker_id:account.id})).status===400);
  await page.locator("tr",{hasText:"Operator I"}).getByRole("button",{name:"Uitzetten"}).click();
  await dialoog().getByRole("button",{name:"Uitzetten"}).click();
  await page.locator("tr",{hasText:"Operator I"}).getByRole("button",{name:"Activeren"}).waitFor();
  check("Personeelsidentiteit uitgezet zonder accountwijziging",(await q("SELECT actief FROM fabriek.operator WHERE id=$1",[persoon.id]))[0].actief===false);
  await shot("02-personeel");
  await inloggen("mes.system");
  await page.getByRole("link", { name: "Pc's" }).click();
  await page.locator("tr", { hasText: "PC-01" }).getByRole("button", { name: "Stappen kiezen" }).click();
  await dialoog().getByLabel(/PS3 Mengen/).check();
  await dialoog().getByLabel(/PS4 /).check();
  await dialoog().getByRole("button", { name: "Opslaan" }).click();
  await page.locator("tr", { hasText: "PC-01" }).getByText("PS3, PS4").waitFor();
  await shot("03-pcs");
  check("PC-01 bedient PS3 en PS4", true);

  console.log("\nPilotfeedback uitgesteld");
  check("Geen pilotfeedbackknop of opmerkingenmenu",await page.getByRole("button",{name:"Iets melden"}).count()===0 && await page.getByRole("link",{name:/Opmerkingen/}).count()===0);
  check("Feedbackinzage geweigerd",(await verzoek("GET","/terugmeldingen",await token())).status===403);
  console.log("\nLogboek");
  // Wacht op de echte logboekrespons en de specifieke logboekweergave, niet op een oude tabel.
  const logRespons = page.waitForResponse(r => new URL(r.url()).pathname === "/beheer/logboek" && r.request().method() === "GET");
  await page.getByRole("link", { name: "Logboek" }).click();
  const logRes = await logRespons;
  if (!logRes.ok()) throw new Error("Logboek HTTP "+logRes.status());
  await page.getByRole("heading", { name: "Logboek", exact: true }).waitFor();
  await page.locator("#f-onderdeel").waitFor();
  const logTabel = page.locator("main .tabel");
  await logTabel.getByRole("columnheader", { name: "Wijziging", exact: true }).waitFor();
  await logTabel.locator("tbody tr").first().waitFor();
  const log = await logTabel.innerText();
  await shot("04-logboek");
  check("Logboek: naamwijziging stap", log.includes("naam: Process Step 3 naar Mengen"), log.slice(0,1200));
  check("Logboek: tolerantie 5 naar 8", log.includes("tolerantie: 5 naar 8"), log.slice(0,1200));
  check("Logboek: pc-koppeling", log.includes("PC-01: PS3") && log.includes("Stap toegevoegd aan de pc"), log.slice(0,1200));
  check("Logboek toont geen wachtwoord-hash", !log.includes("$2a$") && !log.includes("hash"));

  console.log("\nServer");
  await q("DELETE FROM fabriek.onderhoud_log");
  await page.getByRole("link", { name: "Server" }).click();
  await page.getByRole("heading", { name: "Server", exact: true }).waitFor();
  await page.locator(".tegels").waitFor();
  check("Server: waarschuwing zonder back-up", await page.getByText("Er is nog nooit een back-up gemaakt.").isVisible());
  await q(`INSERT INTO fabriek.onderhoud_log (soort, gestart_op, klaar_op, gelukt, bestand, grootte_bytes, melding) VALUES
    ('migratie', now() - interval '2 days', now() - interval '2 days', true, null, null, 'Nieuwe database aangemaakt op schemaversie 2'),
    ('hersteltest', now() - interval '6 days', now() - interval '6 days', true, 'batchgui_2026-11-12_0300_v0.6.0.dump', 1310000, '543 batches, 135 lots, 18093 waarden teruggezet'),
    ('backup', now() - interval '62 minutes', now() - interval '61 minutes', true, 'batchgui_2026-11-18_2000_v0.6.0.dump', 1312000, null),
    ('backup', now() - interval '2 minutes', now() - interval '1 minutes', true, 'batchgui_2026-11-18_2100_v0.6.0.dump', 1313000, '1 oude back-up(s) opgeruimd')`);
  await page.reload();
  await page.locator(".serverstatus-ok").waitFor();
  await page.waitForTimeout(300);
  await shot("06-server");
  const srv = await page.locator("main, body").first().innerText();
  check("Server: in orde na recente back-up en hersteltest", srv.includes("In orde") && srv.includes("1 min geleden"));
  // Vergelijk de UI met de nieuwste aanwezige migratie én de applicatieversie.
  const schemaVersie = Math.max(...readdirSync(new URL("../../db/migraties/", import.meta.url))
    .map(naam => /^(\d{4})_.+\.sql$/.exec(naam)).filter(Boolean).map(m => Number(m[1])));
  const appVersie = readFileSync(new URL("../../VERSIE", import.meta.url), "utf8").trim();
  const schemaPatroon = new RegExp(`schemaversie ${schemaVersie}\\b`);
  check("Server: versie en schemaversie zichtbaar",
    Number.isFinite(schemaVersie) && schemaPatroon.test(srv) && srv.includes(appVersie),
    `verwacht ${appVersie}, schema ${schemaVersie}`);
  check("Server: onderhoudstabel met hersteltest", srv.includes("Hersteltest") && srv.includes("543 batches"));

  console.log("\nDoorwerking op het invoerscherm");
  const invoer = await context.newPage();
  await invoer.goto(`${BASIS}/invoer/`);
  await invoer.getByRole("button", { name: /^PC-01/ }).click();
  await invoer.getByLabel("Gebruikersnaam").fill("operator");
  await invoer.getByLabel("Wachtwoord").fill("demo");
  const weigering=invoer.waitForResponse(r=>new URL(r.url()).pathname==="/auth/login"&&r.request().method()==="POST");
  await invoer.getByRole("button",{name:"Inloggen"}).click();
  check("Historisch gedeeld account wordt geweigerd",(await weigering).status()===401);
  await invoer.getByRole("alert").filter({hasText:"Onjuiste gebruikersnaam of wachtwoord"}).waitFor();
  await invoer.getByLabel("Gebruikersnaam").fill("operator.a");
  await invoer.getByLabel("Wachtwoord").fill("demo");
  await invoer.getByRole("button",{name:"Inloggen"}).click();
  await invoer.locator(".tegel").first().waitFor();
  const tegels = await invoer.locator(".tegel").allInnerTexts();
  check("PC-01 toont alleen PS3 (Mengen) en PS4", tegels.length === 2 && tegels[0].includes("Mengen"), tegels.join(" | "));
  if (process.env.MES_SCREENSHOTS === "review") await invoer.screenshot({ path: `${SHOTS}/05-invoer-pc01.png` });
  await invoer.close();

  console.log("\nDiensten en ploegen (#86)");
  await inloggen("mes.manager");
  await page.goto(`${BASIS}/portaal/#/beheer/ploegen`);
  await page.getByRole("heading", { name: "Diensten en ploegen", level: 1 }).waitFor();
  const komend = page.locator("section", { has: page.getByRole("heading", { name: "Komende 14 dagen" }) });
  await komend.locator("tbody tr").first().waitFor();
  const cellen = await komend.locator("tbody td:not(:first-child)").allInnerTexts();
  check("14 dagen, elke dienst twee ploegen (één per divisie)", cellen.length === 42 && cellen.every((c) => c.split(",").length === 2), cellen.slice(0, 6).join(" | "));
  check("Rooster: 10 dagen, 4 vrij", (await page.locator(".rooster-patroon li").count()) === 10 && (await page.locator(".rooster-patroon li.vrij").count()) === 4);
  await shot("06-diensten-en-ploegen");
  await page.getByRole("button", { name: "Rooster wijzigen" }).click();
  await dialoog().getByLabel("Rooster, dag voor dag").fill("O O M M N N - - - X");
  await dialoog().getByRole("button", { name: "Opslaan" }).click();
  const melding = await dialoog().getByLabel("Rooster, dag voor dag").evaluate((el) => el.validationMessage);
  check("Onbekende dienst in het rooster wordt meteen gemeld", melding.includes("Onbekende dienst: X"), melding);
  await dialoog().getByRole("button", { name: "Terug" }).click();
  await page.locator("tr", { hasText: "A2" }).getByRole("button", { name: "Wijzigen" }).click();
  await dialoog().getByLabel("Eerste dag van de cyclus").fill("2026-01-06");
  await dialoog().getByRole("button", { name: "Opslaan" }).click();
  await page.locator("#melding", { hasText: "Ploeg A2 opgeslagen" }).waitFor();
  await komend.locator("tbody tr").first().waitFor();
  const na = await komend.locator("tbody td:not(:first-child)").allInnerTexts();
  check("A2 een dag later: nu draaien er diensten met één ploeg", na.some((c) => c.split(",").length === 1), na.slice(0, 6).join(" | "));
} catch (e) {
  console.log("  AFGEBROKEN", e.message);
  await shot("fout").catch(() => {});
  fouten++;
} finally {
  if (fouten > 0) await page.screenshot({ path: `${SHOTS}/fout-eind.png` }).catch(() => {});
  await browser.close();
  await db.end();
  stopApi();
}
console.log(fouten ? `\n${fouten} fout(en)` : "\nAlles geslaagd");
process.exit(fouten ? 1 : 0);
