import { stopTestApi } from "../../tests/screen-api-lifecycle.mjs";
// Test van het Portaal Planning in Chrome.
// Zet de database opnieuw klaar (schema.sql + seed_config.sql + seed_accounts_demo.sql) met fictieve gegevens.
// Gebruik: node e2e/planning.mjs (API op poort 3462).
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright-core";
import pg from "pg";

const DB = process.env.DATABASE_URL ?? "postgres://postgres@localhost/batchgui?host=/tmp&port=5433";
const APP_DB = process.env.TEST_APP_DATABASE_URL;
if (!APP_DB || APP_DB === DB) throw new Error("TEST_APP_DATABASE_URL moet een afzonderlijke beperkte MES-testverbinding zijn");
const SHOTS = process.env.SHOTS ?? "/tmp/shots-planning";
const BASIS = "http://localhost:3462";
mkdirSync(SHOTS, { recursive: true });

let fouten = 0;
const check = (naam, ok, extra = "") => {
  console.log(`${ok ? "  OK  " : "  FOUT"} ${naam}${!ok && extra ? `  [${extra}]` : ""}`);
  if (!ok) fouten++;
};

const db = new pg.Client({ connectionString: DB });
await db.connect();
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
await db.query("DROP SCHEMA IF EXISTS fabriek CASCADE");
for (const f of ["schema.sql", "rechten.sql", "seed_config.sql", "seed_accounts_demo.sql"]) execFileSync("psql",["-q","-v","ON_ERROR_STOP=1","-d",DB,"-f",new URL(`../../db/${f}`,import.meta.url).pathname],{stdio:"inherit"});

await db.query(readFileSync(new URL("../../tests/fixtures/scherm_grants.sql", import.meta.url), "utf8"));

const api = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
  cwd: new URL("../../api/", import.meta.url).pathname,
  env: { ...process.env, DATABASE_URL: APP_DB, JWT_GEHEIM: "e2e-".repeat(10), POORT: "3462",
    PORTAAL_MAP: new URL("../dist", import.meta.url).pathname, INVOER_MAP: new URL("../../invoer/dist", import.meta.url).pathname },
  stdio: ["ignore", "ignore", "inherit"],
  detached: true,
});
const stopApi = () => stopTestApi(api);
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
const inloggen = async (naam) => {
  await page.goto(`${BASIS}/portaal/#/login`);
  await page.getByLabel("Gebruikersnaam").fill(naam);
  await page.getByLabel("Wachtwoord").fill("demo");
  await page.getByRole("button", { name: "Inloggen" }).click();
  await page.locator(".starttegel-planning").click();
};

try {
  console.log("\nBatches plannen");
  await inloggen("planner1");
  await page.getByRole("heading", { name: /^Week van/ }).waitFor();
  check("Planner komt in het Portaal Planning", page.url().includes("#/planning"));

  await page.locator(".kop").getByRole("button", { name: "Batches plannen" }).click();
  await dialoog().getByLabel("Aantal batches").fill("6");
  await dialoog().getByLabel(/Product/).selectOption({ label: "PRD-A – Product A standaard" });
  await dialoog().getByRole("button", { name: "Plannen" }).click();
  await page.locator("#melding", { hasText: "gepland" }).waitFor();
  await page.locator(".dagkaart.vandaag .planrij").nth(5).waitFor();
  const nummers = await page.locator(".dagkaart.vandaag .planrij .sterk").allInnerTexts();
  check("Zes batches vandaag, doorlopend genummerd", nummers.length === 6 && /^B-\d{4}-0001$/.test(nummers[0]) && nummers[5].endsWith("0006"), nummers.join(" "));

  await page.getByRole("button", { name: `${nummers[1]} eerder` }).click();
  await page.locator("#melding", { hasText: "eerder" }).waitFor();
  await page.waitForFunction((n) => document.querySelector(".dagkaart.vandaag .planrij .sterk")?.textContent === n, nummers[1]);
  check("Volgorde verschoven", true);

  await page.locator(".planrij", { hasText: nummers[5] }).getByRole("button", { name: "Vervallen" }).click();
  await dialoog().getByLabel("Reden").fill("Order geannuleerd");
  await dialoog().getByRole("button", { name: "Laten vervallen" }).click();
  await page.locator(".planrij.vervallen", { hasText: nummers[5] }).waitFor();
  check("Batch vervallen, met reden zichtbaar", (await page.locator(".planrij.vervallen").innerText()).includes("Order geannuleerd"));
  await shot("01-week");

  console.log("\nEtiketten");
  await page.locator(".dagkaart.vandaag").getByRole("link", { name: "Etiketten" }).click();
  await page.getByRole("heading", { name: "5 etiketten" }).waitFor();
  const eerste = page.locator(".etiket").first();
  await eerste.screenshot({ path: `${SHOTS}/04-etiket.png`, scale: "device" });
  const gelezen = execFileSync("python3", ["-c", `
import sys
from PIL import Image
from pyzbar.pyzbar import decode
img = Image.open(sys.argv[1]).convert("L")
img = img.resize((img.width * 3, img.height * 3))
print(",".join(d.data.decode() for d in decode(img)))`, `${SHOTS}/04-etiket.png`]).toString().trim();
  check("Barcode op het etiket is leesbaar en klopt", gelezen === nummers[1], `${gelezen} / ${nummers[1]}`);
  await page.getByLabel("Formaat").selectOption("a4");
  await page.locator(".etiket-a4").first().waitFor();
  await page.evaluate(() => { window.print = () => { window.__geprint = document.querySelectorAll("#print-etiketten .etiketten-vel-a4 .etiket").length; }; });
  await page.getByRole("button", { name: "Afdrukken" }).click();
  check("Afdrukken op A4: 5 etiketten op één vel", (await page.evaluate(() => window.__geprint)) === 5);
  await page.emulateMedia({ media: "print" });
  await shot("05-etiketten-print", false);
  await page.emulateMedia({ media: "screen" });
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await page.goto(`${BASIS}/portaal/#/planning/week`);
  await page.getByRole("heading", { name: /^Week van/ }).waitFor();

  console.log("\nCapaciteit per product (D69)");
  // PS1 (eerste stap van de route) kan 8 batches per dag aan voor alle producten zonder eigen regel.
  const prdA = () => page.locator(".dagkaart.vandaag .startrij", { hasText: "PRD-A" });
  check("Vandaag PRD-A 5 van de 8 (vervallen telt niet)", (await prdA().locator(".bezetting").innerText()) === "5 / 8");
  check("Kop van de dag: 5 batches", (await page.locator(".dagkaart.vandaag .dagkaart-kop .bezetting").innerText()) === "5 batches");
  await page.locator(".kop").getByRole("button", { name: "Batches plannen" }).click();
  await page.getByRole("dialog").getByLabel("Aantal batches").fill("4");
  await page.getByRole("dialog").getByLabel(/Product/).selectOption({ label: "PRD-A – Product A standaard" });
  await page.getByRole("dialog").getByRole("button", { name: "Plannen" }).click();
  await page.getByRole("dialog").getByRole("heading", { name: "Meer dan de capaciteit?" }).waitFor();
  check("Waarschuwing vóór het plannen boven de capaciteit", (await page.getByRole("dialog").innerText()).includes("PRD-A heeft op"));
  await page.getByRole("dialog").getByRole("button", { name: "Toch plannen" }).click();
  await page.locator(".dagkaart.vandaag.te-vol").waitFor();
  check("PRD-A staat als te vol", (await prdA().locator(".bezetting").innerText()) === "⚠ 9 / 8");
  await shot("05b-te-vol");

  console.log("\nAfwijkende dagen (D69)");
  await page.getByRole("link", { name: "Capaciteit" }).click();
  await page.getByRole("heading", { name: "Afwijkende dagen" }).waitFor();
  check("Geen blok per weekdag meer", (await page.getByRole("heading", { name: "Per weekdag" }).count()) === 0);
  await page.getByRole("button", { name: "Afwijking toevoegen" }).click();
  await dialoog().locator("#v-product").selectOption("PRD-A");
  await dialoog().getByLabel("Reden").fill("onderhoud lijn 1");
  await dialoog().getByRole("button", { name: "Opslaan" }).click();
  await page.locator("tr", { hasText: "onderhoud lijn 1" }).waitFor();
  const [af] = await q("SELECT a.procent, a.van = current_date AND a.tot = current_date AS vandaag, a.processtap_id, p.code FROM fabriek.capaciteit_afwijking a JOIN fabriek.product p ON p.id = a.product_id WHERE a.actief");
  check("Afwijking opgeslagen: PRD-A, alle stappen, vandaag, 0 %", af?.procent === 0 && af.vandaag && af.processtap_id === null && af.code === "PRD-A", JSON.stringify(af));
  check("In de tabel: Geen productie", (await page.locator("tr", { hasText: "onderhoud lijn 1" }).innerText()).includes("Geen productie"));
  await shot("05d-afwijkende-dagen");
  await page.getByRole("link", { name: "Batches plannen" }).click();
  await page.getByRole("heading", { name: /^Week van/ }).waitFor();
  check("Batches plannen: PRD-A vandaag dicht", (await prdA().locator(".bezetting").innerText()) === "⚠ 9 / dicht");
  check("Batches plannen: reden van de afwijking", (await page.locator(".dagkaart.vandaag .afwijking-tekst").innerText()).includes("PRD-A, alle stappen: geen productie (onderhoud lijn 1)"));
  check("Batches plannen: PS1 dicht", (await page.locator(".dagkaart.vandaag .stap-vol").innerText()).includes("PS1 dicht"));
  await page.getByRole("link", { name: "Capaciteit" }).click();
  await page.getByRole("button", { name: /onderhoud lijn 1 weghalen/ }).click();
  await page.locator("#melding", { hasText: "Weggehaald" }).waitFor();
  check("Afwijking weggehaald", (await q("SELECT count(*)::int AS n FROM fabriek.capaciteit_afwijking WHERE actief"))[0].n === 0);

  console.log("\nCapaciteit per stap en product (D55, D71)");
  const blokB = page.locator(".cap-product", { has: page.getByRole("heading", { name: /^PRD-B / }) });
  const ps1B = await blokB.locator("tr", { hasText: /^PS1 Process/ }).innerText();
  // #90: in kilogram per uur, dag en maand, en hoeveel batches dat zijn bij 410 kg per batch.
  check("Regels uit de instellingen in kg, met batches per dag", ps1B.includes("51,3 kg") && ps1B.includes("1.230 kg") && ps1B.includes("37.413 kg") && ps1B.includes("3 batches"), ps1B);
  check("Gewicht per batch bij het product", (await blokB.innerText()).includes("Gewicht per batch 410 kg, een lot 1.640 kg"));
  check("Stap uit de route zonder capaciteit: nog invullen (#81)", (await blokB.locator("tr", { hasText: /^PS2 Process/ }).innerText()).includes("Nog invullen"));
  check("Stap buiten de route van PRD-B staat er niet bij", (await blokB.locator("tr", { hasText: /^PS12 Process/ }).count()) === 0);
  check("Melding: stappen zonder capaciteit", (await page.locator(".let-op-blok", { hasText: "nog geen capaciteit" }).count()) === 1);
  const capTeller = () => page.evaluate(() => Number(document.querySelector('a[href="#/planning/capaciteit"] .teller')?.textContent || 0));
  await page.waitForFunction(() => !!document.querySelector('a[href="#/planning/capaciteit"] .teller')?.textContent);
  const voor = await capTeller();
  check("Menu telt de stappen zonder capaciteit", voor > 0, String(voor));
  await page.getByRole("button", { name: "Capaciteit PS1 PRD-A wijzigen" }).click();
  // 85,5 kg per uur × 24 uur = 2052 kg per dag = 5 batches van 410 kg.
  await dialoog().getByLabel("Capaciteit (kg)").fill("85,5");
  await dialoog().locator("#v-per").selectOption("uur");
  await dialoog().getByRole("button", { name: "Opslaan" }).click();
  await page.locator("#melding", { hasText: "Capaciteit opgeslagen" }).waitFor();
  const [cs] = await q(`SELECT c.kg_per_dag::float AS kg, fabriek.capaciteit_stap_voor(s.id, p.id) AS max FROM fabriek.capaciteit_stap c JOIN fabriek.processtap s ON s.id = c.processtap_id
                         JOIN fabriek.product p ON p.id = c.product_id WHERE s.code = 'PS1' AND p.code = 'PRD-A'`);
  check("Capaciteit PS1 voor PRD-A: 85,5 kg per uur = 2052 kg per dag = 5 batches", cs?.kg === 2052 && cs?.max === 5, JSON.stringify(cs));
  // Alle open stappen van één product in één venster; leeg blijft nog invullen.
  await page.getByRole("button", { name: "Invullen voor PRD-C" }).click();
  await dialoog().locator("#v-PS2").fill("1640");
  await dialoog().locator("#v-PS3").fill("2460");
  await dialoog().getByRole("button", { name: "Opslaan" }).click();
  await page.locator("#melding", { hasText: "2 stappen opgeslagen" }).waitFor();
  const [c2] = await q(`SELECT count(*)::int AS n FROM fabriek.capaciteit_stap c JOIN fabriek.processtap s ON s.id = c.processtap_id
                         JOIN fabriek.product p ON p.id = c.product_id WHERE p.code = 'PRD-C' AND s.code IN ('PS2', 'PS3')`);
  check("Invullen voor PRD-C: twee stappen opgeslagen", c2.n === 2);
  await page.reload();
  await page.waitForFunction((n) => document.querySelector('a[href="#/planning/capaciteit"] .teller')?.textContent === String(n), voor - 2, { timeout: 10000 })
    .then(() => check("Teller twee lager", true), () => check("Teller twee lager", false));
  await shot("05c-capaciteit-per-stap");
  // Wat de database als belasting van PS1 vandaag geeft (elk product naar rato van zijn capaciteit).
  const belastingPS1 = async () => (await q(`SELECT round(100 * sum(aantal::numeric / max_per_dag))::int AS p
      FROM fabriek.stap_belasting((SELECT id FROM fabriek.processtap WHERE code = 'PS1'), current_date) WHERE max_per_dag IS NOT NULL`))[0].p;
  let verwacht = await belastingPS1();
  await page.goto(`${BASIS}/portaal/#/planning/week`);
  await page.getByRole("heading", { name: /^Week van/ }).waitFor();
  const vol = (await page.locator(".dagkaart.vandaag .stap-vol").count()) ? await page.locator(".dagkaart.vandaag .stap-vol").innerText() : "";
  check("Weekplanning: vandaag PS1 te vol", verwacht > 100 && vol.includes(`PS1 ${verwacht} %`), `${verwacht}: ${vol}`);

  console.log("\nStappen plannen");
  await page.locator(".dagkaart.vandaag").getByRole("link", { name: "Stappen plannen" }).click();
  await page.locator(".stappenlijst a").filter({ has: page.locator(".code", { hasText: /^PS1$/ }) }).click();
  await page.getByRole("heading", { name: /^PS1 / }).waitFor();
  await page.getByRole("button", { name: "Toevoegen" }).click();
  await dialoog().getByLabel(new RegExp(nummers[0])).check();
  await dialoog().getByLabel(new RegExp(nummers[2])).check();
  await dialoog().getByRole("button", { name: "Kiezen" }).click();
  await page.locator("tr", { hasText: nummers[2] }).waitFor();
  await page.getByRole("button", { name: `${nummers[0]} later` }).click();
  await page.locator("#melding", { hasText: "Volgorde" }).waitFor();
  await page.waitForFunction((n) => document.querySelector("tbody tr strong")?.textContent === n, nummers[2]);
  const rijen = await page.locator("tbody tr strong").allInnerTexts();
  check("PS1 heeft 2 batches in de gekozen volgorde", rijen.join() === [nummers[2], nummers[0]].join(), rijen.join());
  check("Teller in de stappenlijst", (await page.locator(".stappenlijst a").filter({ has: page.locator(".code", { hasText: /^PS1$/ }) }).innerText()).includes("2"));
  verwacht = await belastingPS1();
  check("Stappen plannen: capaciteit van PS1 met waarschuwing", (await page.locator(".capaciteit-stap").innerText()).includes(`${verwacht} % van de capaciteit: te vol`),
    await page.locator(".capaciteit-stap").innerText());
  await shot("02-per-stap");

  console.log("\nWaarschuwing: vorige stap niet op tijd (D52)");
  await page.locator(".stappenlijst a").filter({ has: page.locator(".code", { hasText: /^PS3$/ }) }).click();
  await page.getByRole("heading", { name: /^PS3 / }).waitFor();
  await page.getByRole("button", { name: "Toevoegen" }).click();
  await dialoog().locator(".keuzegroep-let-op").waitFor();
  check("Keuzevenster: groep 'Vorige stap niet op tijd'", (await dialoog().locator(".keuzegroep-let-op").innerText()).includes("Vorige stap niet op tijd"));
  await shot("02b-toevoegen-groepen", false);
  await dialoog().getByLabel(new RegExp(nummers[1])).check();
  await dialoog().getByRole("button", { name: "Kiezen" }).click();
  await page.locator("#melding", { hasText: "let op" }).waitFor();
  check("Plannen vóór de vorige stap mag, met waarschuwing", (await page.locator("tr", { hasText: nummers[1] }).innerText()).includes("PS2 is nog niet gepland"));
  check("⚠ bij PS3 in de stappenlijst", (await page.locator(".stappenlijst a").filter({ has: page.locator(".code", { hasText: /^PS3$/ }) }).innerText()).includes("⚠"));
  await shot("02c-per-stap-waarschuwing");

  console.log("\nDagoverzicht en Batchroute (#48: allebei, zonder proef)");
  await page.getByRole("link", { name: "Dagoverzicht", exact: true }).click();
  await page.locator(".dagoverzicht").waitFor();
  check("Dagoverzicht toont alle 21 stappen", (await page.locator(".dagoverzicht tbody tr").count()) === 21);
  check("Geen proefmelding meer (#48)", (await page.locator(".proef-melding").count()) === 0);
  // #97: naar een dag springen met de kalender.
  const verder = new Date(Date.now() + 9 * 864e5).toLocaleDateString("sv-SE", { timeZone: "Europe/Amsterdam" });
  await page.locator(".dag-kiezer input").fill(verder);
  await page.waitForFunction((d) => location.hash === `#/planning/overzicht/${d}`, verder);
  await page.locator(".dagoverzicht").waitFor();
  check("Kalender: naar een dag springen", (await page.locator(".dag-kiezer input").inputValue()) === verder);
  await page.getByRole("link", { name: "Vandaag" }).click();
  await page.waitForFunction((d) => document.querySelector(".dag-kiezer input")?.value !== d && !!document.querySelector(".dagoverzicht"), verder);
  await page.locator("main p", { hasText: "niet op tijd" }).first().waitFor({ timeout: 5000 }).catch(() => {});
  check("Dagoverzicht telt de waarschuwing", (await page.locator("main p", { hasText: "niet op tijd" }).count()) >= 1);
  await shot("06-dagoverzicht");
  await page.getByRole("link", { name: "Batchroute", exact: true }).click();
  await page.locator(".route-tabel").waitFor();
  const letOpCel = page.locator(".route-tabel tr", { hasText: nummers[1] }).locator("td.route-let-op");
  check("Batchroute: geplande PS3 met ⚠", (await letOpCel.count()) === 1 && (await letOpCel.getAttribute("title")).includes("PS2 is nog niet gepland"));
  await shot("07-batchroute");
  const metWaarschuwing = Number((await page.getByRole("link", { name: /^Met waarschuwing/ }).innerText()).match(/\((\d+)\)/)[1]);
  await page.getByRole("link", { name: /^Met waarschuwing/ }).click();
  await page.waitForFunction(() => location.hash.endsWith("/let-op"));
  // Wacht tot het gefilterde overzicht er staat (de oude tabel heeft dezelfde opmaak).
  await page.waitForFunction((n) => document.querySelectorAll(".route-tabel tbody tr").length === n, metWaarschuwing);
  check("Batchroute: filter alleen met waarschuwing", (await page.locator(".route-tabel tbody tr").count()) >= 1 && (await page.locator(".route-tabel tbody tr", { hasText: nummers[1] }).count()) === 1);
  // Weer weghalen, zodat de rest van de test niet verandert.
  await letOpCel.locator("a").click();
  await page.getByRole("heading", { name: /^PS3 / }).waitFor();
  await page.locator("tr", { hasText: nummers[1] }).getByRole("button", { name: "Weghalen" }).click();
  await page.locator("#melding", { hasText: "uit de planning gehaald" }).waitFor();

  console.log("\nLotvoorstellen");
  await page.getByRole("link", { name: "Lotvoorstellen" }).click();
  await page.getByRole("button", { name: "Nieuw lotvoorstel" }).click();
  const kies = dialoog().getByRole("button", { name: "Kiezen" });
  check("Kiezen pas mogelijk bij 4 batches", await kies.isDisabled());
  for (const n of nummers.slice(0, 4)) await dialoog().getByLabel(new RegExp(n)).check();
  await kies.click();
  await dialoog().getByRole("button", { name: "Voorstel maken" }).click();
  await page.getByRole("heading", { name: "Lotvoorstel 1" }).waitFor();
  check("Voorstel 1 met 4 batches", (await page.locator(".voorstel-batches li").count()) === 4);
  await shot("03-lotvoorstellen");

  console.log("\nProducten: planner leest, engineer beheert");
  await page.getByRole("link", { name: "Producten" }).click();
  await page.getByRole("heading", { name: "Producten", exact: true }).waitFor();
  await page.locator("tr", { hasText: "PRD-A" }).waitFor();
  check("Planner heeft geen productbeheerknoppen", await page.getByRole("button", { name: "Product toevoegen" }).count() === 0 && await page.getByRole("button", { name: "Naam wijzigen" }).count() === 0);
  const plannerToken = await page.evaluate(() => localStorage.getItem("portaal.token"));
  const [prodA] = await q("SELECT id FROM fabriek.product WHERE code = 'PRD-A'");
  const write = (method,pad,token,body) => fetch(BASIS+pad,{method,headers:{authorization:"Bearer "+token,"content-type":"application/json"},body:JSON.stringify(body)});
  check("Planner mag geen product toevoegen via API",(await write("POST","/planning/producten",plannerToken,{code:"PRD-D",naam:"Niet toegestaan"})).status===403);
  check("Planner mag geen route wijzigen via API",(await write("PUT","/planning/producten/"+prodA.id+"/route",plannerToken,{stappen:null})).status===403);
  await page.locator("tr",{hasText:"PRD-A"}).getByRole("link",{name:"Route bekijken"}).click();
  await page.getByRole("heading",{name:"Route van PRD-A"}).waitFor();
  await page.locator(".route-stap").first().waitFor();
  check("Planner ziet route zonder wijzigingsknoppen",await page.getByRole("button",{name:/Route opslaan|weghalen uit de route|eerder|later/}).count()===0);
  await page.getByRole("button",{name:"Afmelden"}).click();
  await inloggen("mes.engineer");
  await page.getByRole("heading",{name:/^Week van/}).waitFor();
  await page.locator(".dagkaart").first().waitFor();
  check("Engineer ziet planning zonder planningsknop",await page.getByRole("button",{name:"Batches plannen"}).count()===0);
  const engineerToken = await page.evaluate(()=>localStorage.getItem("portaal.token"));
  const [dag] = await q("SELECT current_date::text AS vandaag");
  check("Engineer mag geen batches plannen via API",(await write("POST","/planning/batches",engineerToken,{dag:dag.vandaag,aantal:1})).status===403);
  await page.getByRole("link", { name: "Producten" }).click();
  await page.getByRole("button", { name: "Product toevoegen" }).click();
  await dialoog().getByLabel("Code").fill("PRD-D");
  await dialoog().getByLabel("Naam").fill("Product D proef");
  await dialoog().getByRole("button", { name: "Toevoegen" }).click();
  await page.locator("tr", { hasText: "PRD-D" }).waitFor();
  check("Product toegevoegd", (await q("SELECT count(*)::int AS n FROM fabriek.product"))[0].n === 4);

  console.log("\nRoute per product (D55)");
  const routeTekst = async (code) => (await page.locator("tr", { hasText: code }).locator(".product-route").innerText()).trim();
  check("Producten: route als samenvatting",
    (await routeTekst("PRD-A")) === "Alle stappen" && (await routeTekst("PRD-C")) === "15 stappen, zonder PS6, PS14 en PS17, eigen volgorde, met keuringen TK1, TK2 en EK",
    `${await routeTekst("PRD-A")} | ${await routeTekst("PRD-C")}`);
  await page.locator("tr", { hasText: "PRD-D" }).getByRole("link", { name: "Route wijzigen" }).click();
  await page.getByRole("heading", { name: "Route van PRD-D" }).waitFor();
  await page.locator(".routelijst-buiten").waitFor();
  check("Nieuw product: alle processtappen; alleen de keuringen staan erbuiten (#80)",
    (await page.locator(".routelijst-buiten .route-stap strong").allInnerTexts()).join(",") === "TK1,TK2,EK" && (await page.getByRole("button", { name: "Route opslaan" }).isDisabled()),
    (await page.locator(".routelijst-buiten .route-stap strong").allInnerTexts()).join(","));
  await page.getByRole("button", { name: "PS6 weghalen uit de route" }).click();
  check("Na weghalen staat de focus op Toevoegen van die stap",
    await page.evaluate(() => document.activeElement?.getAttribute("aria-label")) === "PS6 toevoegen aan de route");
  await page.getByRole("button", { name: "PS7 weghalen uit de route" }).click();
  await page.getByRole("button", { name: "PS11 eerder" }).click();
  check("Na Eerder blijft de focus op die knop", await page.evaluate(() => document.activeElement?.getAttribute("aria-label")) === "PS11 eerder");
  check("PS15 kan niet later dan de lotstap", await page.getByRole("button", { name: "PS15 later" }).isDisabled());
  check("De lotstap kun je niet weghalen", (await page.getByRole("button", { name: "PS16 weghalen uit de route" }).count()) === 0);
  await page.getByRole("button", { name: "PS7 toevoegen aan de route" }).click();
  await shot("08-route");
  const volgorde = await page.locator(".routelijst").first().locator(".route-stap strong").allInnerTexts();
  check("Toevoegen zet de stap op zijn eigen plek", volgorde.slice(4, 10).join(",") === "PS5,PS7,PS8,PS9,PS11,PS10", volgorde.join(","));
  await page.getByRole("button", { name: "Route opslaan" }).click();
  await page.getByRole("heading", { name: "Producten" }).waitFor();
  await page.locator("tr", { hasText: "PRD-D" }).locator(".product-route", { hasText: "17 stappen" }).waitFor();
  const [rd] = await q(`SELECT array_agg(s.code ORDER BY ps.plek) AS r FROM fabriek.product_stap ps JOIN fabriek.processtap s ON s.id = ps.processtap_id
                         JOIN fabriek.product p ON p.id = ps.product_id WHERE p.code = 'PRD-D'`);
  check("Route opgeslagen in de database", rd.r.join(",") === "PS1,PS2,PS3,PS4,PS5,PS7,PS8,PS9,PS11,PS10,PS12,PS13,PS14,PS15,PS16,PS17,PS18", rd.r.join(","));

  console.log("\nPloegleider kijkt mee");
  await page.evaluate(() => localStorage.clear());
  await inloggen("ploegleider1");
  await page.goto(`${BASIS}/portaal/#/planning/week`);
  await page.getByRole("heading", { name: /^Week van/ }).waitFor();
  check("Ploegleider ziet de planning zonder knoppen om te plannen",
    (await page.getByRole("button", { name: "Batches plannen" }).count()) === 0 && (await page.locator(".planrij").count()) === 10, "10 batches: 6 + 4 van PRD-A");
} catch (e) {
  console.log("  AFGEBROKEN", e.message.split("\n").slice(0, 8).join(" | "));
  await shot("fout").catch(() => {});
  fouten++;
} finally {
  if (fouten > 0) await page.screenshot({ path: `${SHOTS}/fout-eind.png` }).catch(() => {});
  await browser.close();
  await db.end();
  await stopApi();
}
console.log(fouten ? `\n${fouten} fout(en)` : "\nAlles geslaagd");
process.exit(fouten ? 1 : 0);
