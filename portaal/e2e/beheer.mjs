// Test van het Portaal Beheer in Chrome, plus de doorwerking op het invoerscherm.
// Verwacht: database met schema.sql + seed_config.sql + seed_accounts_demo.sql (+ eventueel seed_demo.sql),
// en een gebouwd invoerscherm. Gebruik: node e2e/beheer.mjs (API op poort 3461).
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
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
const shot = (naam, fullPage = true) => page.screenshot({ path: `${SHOTS}/${naam}.png`, fullPage });
const dialoog = () => page.getByRole("dialog");

try {
  console.log("\nStappen en velden");
  await page.goto(`${BASIS}/portaal/#/login`);
  await page.getByLabel("Gebruikersnaam").fill("beheerder1");
  await page.getByLabel("Wachtwoord").fill("demo");
  await page.getByRole("button", { name: "Inloggen" }).click();
  // Na het inloggen de startpagina (D54); de test gaat verder in het portaal van de rol.
  if (await page.locator(".startpagina").waitFor({ timeout: 8000 }).then(() => true, () => false)) await page.locator(`.starttegel-${await page.evaluate(() => {
    const rol = JSON.parse(atob(localStorage.getItem("portaal.token").split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).rol;
    return { ploegleider: "productie", beheerder: "beheer", planner: "planning" }[rol] ?? "kwaliteit";
  })}`).click();
  await page.getByRole("heading", { name: "Stappen en velden" }).waitFor();
  check("Beheerder komt in het Portaal Beheer", page.url().includes("#/beheer"));

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

  console.log("\nMedewerkers (#87)");
  await page.getByRole("link", { name: "Medewerkers" }).click();
  await page.getByRole("heading", { name: "Medewerkers", level: 1 }).waitFor();
  const vloer = page.locator("section", { has: page.getByRole("heading", { name: "Operators en ploegleiders" }) });
  const kwaliteit = page.locator("section", { has: page.getByRole("heading", { name: "Kwaliteit", exact: true }) });
  const overig = page.locator("section", { has: page.getByRole("heading", { name: "Overige accounts" }) });
  await vloer.locator("tr", { hasText: "Operator A" }).waitFor();
  check("Operator A: ploeg A1 en account operator.a", /A1/.test(await vloer.locator("tr", { hasText: "Operator A" }).innerText()) && /operator\.a/.test(await vloer.locator("tr", { hasText: "Operator A" }).innerText()));
  check("Kwaliteit in een eigen blok", (await kwaliteit.locator("tr", { hasText: "kwaliteit1" }).count()) === 1 && (await vloer.locator("tr", { hasText: "kwaliteit1" }).count()) === 0);
  check("Overige accounts: beheerder1 en planner1", (await overig.locator("tr", { hasText: "beheerder1" }).count()) === 1 && (await overig.locator("tr", { hasText: "planner1" }).count()) === 1);
  await page.getByRole("button", { name: "Medewerker toevoegen" }).click();
  await dialoog().getByLabel("Naam bij de invoer").fill("Kwaliteit Twee");
  await dialoog().getByLabel("Rol").selectOption("kwaliteit");
  await dialoog().locator("#v-ploeg").selectOption("B1");
  await dialoog().locator("#v-gebruikersnaam").fill("Kwaliteit 2");
  await dialoog().getByLabel("Wachtwoord").fill("geheim-123");
  await dialoog().getByRole("button", { name: "Medewerker toevoegen" }).click();
  check("Ongeldige gebruikersnaam wordt meteen gemeld", await dialoog().isVisible());
  await dialoog().locator("#v-gebruikersnaam").fill("kwaliteit2");
  await dialoog().getByRole("button", { name: "Medewerker toevoegen" }).click();
  await kwaliteit.locator("tr", { hasText: "Kwaliteit Twee" }).waitFor();
  check("Nieuwe medewerker van Kwaliteit met ploeg B1", (await kwaliteit.locator("tr", { hasText: "Kwaliteit Twee" }).innerText()).includes("B1"));
  check("Eigen account kan zichzelf niet uitzetten", await overig.locator("tr", { hasText: "beheerder1" }).getByRole("button", { name: "Uitzetten" }).isDisabled());
  await kwaliteit.locator("tr", { hasText: "Kwaliteit Twee" }).getByRole("button", { name: "Uitzetten" }).click();
  await dialoog().getByRole("button", { name: "Uitzetten" }).click();
  await kwaliteit.locator("tr", { hasText: "Kwaliteit Twee" }).getByRole("button", { name: "Weer aanzetten" }).waitFor();
  const [acc] = await q("SELECT actief FROM fabriek.gebruiker WHERE gebruikersnaam = 'kwaliteit2'");
  check("kwaliteit2 bestaat en staat uit", acc && acc.actief === false);
  check("Waarschuwing: gedeeld account nog actief", (await page.locator(".proef-melding", { hasText: "Gedeeld account nog actief" }).count()) === 1);
  // Een naam zonder account krijgt een eigen account: de geschiedenis blijft op dezelfde naam (D53).
  await vloer.locator("tr", { hasText: "Operator E" }).getByRole("button", { name: "Account geven" }).click();
  await dialoog().locator("#v-gebruikersnaam").fill("operator.e");
  await dialoog().getByLabel("Wachtwoord").fill("geheim-123");
  await dialoog().getByRole("button", { name: "Account aanmaken" }).click();
  await vloer.locator("tr", { hasText: "operator.e" }).waitFor();
  const [kop] = await q("SELECT o.naam FROM fabriek.operator o JOIN fabriek.gebruiker g ON g.id = o.gebruiker_id WHERE g.gebruikersnaam = 'operator.e'");
  check("Operator E is gekoppeld aan operator.e", kop?.naam === "Operator E");
  // Ploeg wijzigen.
  await vloer.locator("tr", { hasText: "Operator E" }).getByRole("button", { name: "Wijzigen" }).click();
  await dialoog().locator("#v-ploeg").selectOption("D2");
  await dialoog().getByRole("button", { name: "Opslaan" }).click();
  await page.locator("#melding", { hasText: "Opgeslagen" }).waitFor();
  const [pe] = await q("SELECT rp.code FROM fabriek.operator o JOIN fabriek.rooster_ploeg rp ON rp.id = o.ploeg_id WHERE o.naam = 'Operator E'");
  check("Operator E staat nu in ploeg D2", pe?.code === "D2");
  await vloer.locator("tr", { hasText: "Operator E" }).waitFor();
  await shot("02-medewerkers");

  console.log("\nNamen zonder account en pc's");
  await page.getByRole("button", { name: "Naam zonder account" }).click();
  await dialoog().getByLabel("Naam", { exact: true }).fill("Operator I");
  await dialoog().getByRole("button", { name: "Toevoegen" }).click();
  await vloer.locator("tr", { hasText: "Operator I" }).waitFor();
  await vloer.locator("tr", { hasText: "Operator H" }).getByRole("button", { name: "Uitzetten" }).click();
  await dialoog().getByRole("button", { name: "Uitzetten" }).click();
  await vloer.locator("tr", { hasText: "Operator H" }).getByRole("button", { name: "Weer aanzetten" }).waitFor();
  check("Naam zonder account toegevoegd en een andere uitgezet", true);

  await page.getByRole("link", { name: "Pc's" }).click();
  await page.locator("tr", { hasText: "PC-01" }).getByRole("button", { name: "Stappen kiezen" }).click();
  await dialoog().getByLabel(/PS3 Mengen/).check();
  await dialoog().getByLabel(/PS4 /).check();
  await dialoog().getByRole("button", { name: "Opslaan" }).click();
  await page.locator("tr", { hasText: "PC-01" }).getByText("PS3, PS4").waitFor();
  await shot("03-pcs");
  check("PC-01 bedient PS3 en PS4", true);

  console.log("\nIets melden en Opmerkingen (#78)");
  await page.getByRole("button", { name: "Iets melden" }).click();
  await page.locator("#v-tekst").fill("Graag een zoekveld bij de accounts");
  await page.getByRole("dialog").getByRole("button", { name: "Versturen" }).click();
  await page.getByText("Bedankt, je melding is verstuurd").waitFor();
  await page.getByRole("link", { name: /Opmerkingen/ }).click();
  await page.getByRole("heading", { name: "Opmerkingen" }).waitFor();
  const rij = page.locator("tr", { hasText: "Graag een zoekveld bij de accounts" });
  check("Melding staat bij Opmerkingen, met de plek", (await rij.innerText()).includes("portaal: beheer, pcs"), await rij.innerText());
  check("Teller in het menu", /Opmerkingen\s*1/.test(await page.locator("#menu").innerText()));
  await rij.getByRole("button", { name: "Afhandelen" }).click();
  await page.locator("#v-notitie").fill("#80");
  await page.getByRole("dialog").getByRole("button", { name: "Afhandelen" }).click();
  await page.getByText("Er staat niets open.").waitFor();
  await page.locator("#opm-alle").check();
  await page.getByText("Afgehandeld door beheerder1: #80").waitFor();
  check("Afgehandeld met notitie, te zien bij Ook afgehandelde", true);
  await shot("03b-opmerkingen");

  console.log("\nLogboek");
  await page.getByRole("link", { name: "Logboek" }).click();
  await page.locator(".tabel tbody tr").first().waitFor();
  await shot("04-logboek");
  const log = await page.locator(".tabel").innerText();
  check("Logboek: naamwijziging stap", log.includes("naam: Process Step 3 naar Mengen"));
  check("Logboek: tolerantie 5 naar 8", log.includes("tolerantie: 5 naar 8"));
  check("Logboek: pc-koppeling", log.includes("PC-01: PS3") && log.includes("Stap toegevoegd aan de pc"));
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
  check("Server: versie en schemaversie zichtbaar", /schemaversie 2/.test(srv));
  check("Server: onderhoudstabel met hersteltest", srv.includes("Hersteltest") && srv.includes("543 batches"));

  console.log("\nDoorwerking op het invoerscherm");
  const invoer = await context.newPage();
  await invoer.goto(`${BASIS}/invoer/`);
  await invoer.getByRole("button", { name: /^PC-01/ }).click();
  await invoer.getByLabel("Gebruikersnaam").fill("operator");
  await invoer.getByLabel("Wachtwoord").fill("demo");
  await invoer.getByRole("button", { name: "Inloggen" }).click();
  await invoer.getByRole("heading", { name: "Wie ben je?" }).waitFor();
  await invoer.getByRole("button", { name: "Operator C" }).waitFor();
  check("Operator I staat in de namenlijst, Operator H niet",
    (await invoer.getByRole("button", { name: "Operator I" }).count()) === 1 && (await invoer.getByRole("button", { name: "Operator H" }).count()) === 0);
  await invoer.getByRole("button", { name: "Operator I" }).click();
  await invoer.locator(".tegel").first().waitFor();
  const tegels = await invoer.locator(".tegel").allInnerTexts();
  check("PC-01 toont alleen PS3 (Mengen) en PS4", tegels.length === 2 && tegels[0].includes("Mengen"), tegels.join(" | "));
  await invoer.screenshot({ path: `${SHOTS}/05-invoer-pc01.png` });
  await invoer.close();

  console.log("\nDiensten en ploegen (#86)");
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
