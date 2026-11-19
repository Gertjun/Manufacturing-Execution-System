// Test van de browserdemo (demo/dist via een statische server op DEMO_URL).
import { chromium } from "playwright-core";
const URL_ = process.env.DEMO_URL ?? "http://localhost:4173/";
const SHOTS = process.env.SHOTS ?? "/home/claude/shots-demo";
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome" });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const fouten = [];
p.on("pageerror", (e) => fouten.push(String(e)));
let ok = 0, mis = 0;
const check = (c, t) => { c ? ok++ : mis++; console.log(c ? "  OK " : "  FOUT", t); };

const t0 = Date.now();
await p.goto(URL_);
await p.waitForFunction(() => document.getElementById("laden").style.display === "none", null, { timeout: 120000 });
check(true, `opgestart in ${Date.now() - t0} ms`);
check(await p.locator("#uitleg").evaluate((d) => d.open), "uitleg verschijnt de eerste keer");
await p.getByRole("button", { name: "Sluiten" }).click();

// Portaal Kwaliteit
const port = p.frameLocator("#if-portaal");
await port.getByRole("heading", { name: "Inloggen" }).waitFor();
await port.getByLabel("Gebruikersnaam").fill("kwaliteit1");
await port.getByLabel("Wachtwoord").fill("demo");
await port.getByRole("button", { name: "Inloggen" }).click();
await port.getByText("te beoordelen", { exact: false }).first().waitFor({ timeout: 20000 });
await p.waitForTimeout(800);
await p.screenshot({ path: `${SHOTS}/01-kwaliteit.png` });
check(true, "Portaal Kwaliteit toont overzicht");

// Trend
await port.getByRole("link", { name: "Trend bekijken" }).first().click();
await p.waitForTimeout(1500);
await p.screenshot({ path: `${SHOTS}/02-trend.png` });
check(await port.locator("svg").count() > 0, "trendgrafiek getekend");

// Naast elkaar: invoer links, een nieuwe batch met afwijking invoeren
await p.getByRole("button", { name: "Naast elkaar" }).click();
const inv = p.frameLocator("#if-invoer");
await inv.getByRole("heading", { name: "Welke pc is dit?" }).waitFor({ timeout: 20000 });
await inv.getByRole("button", { name: /^PC-01/ }).click();
await inv.getByLabel("Gebruikersnaam").fill("operator");
await inv.getByLabel("Wachtwoord").fill("demo");
await inv.getByRole("button", { name: "Inloggen" }).click();
await inv.getByRole("heading", { name: "Wie ben je?" }).waitFor();
await inv.getByRole("button", { name: "Operator A" }).click();
await inv.getByRole("heading", { name: "Kies een stap" }).waitFor();
await inv.locator(".tegel", { hasText: "Process Step 1" }).first().click();
await inv.getByText("Ongeplande batch aanmaken").click();
await inv.getByLabel("Nieuwe batch").fill("b-2026-9001");
await inv.getByRole("button", { name: "Aanmaken en starten" }).click();
await inv.getByRole("heading", { name: "B-2026-9001" }).waitFor();
await inv.locator("#s-S1\\.1").fill("80");
await inv.locator("#g-S1\\.1").fill("86,5");
await inv.locator("#g-S1\\.2").fill("410");
await inv.getByRole("button", { name: "Opslaan" }).click();
await inv.getByRole("dialog").getByRole("button", { name: "Opslaan" }).click();
await p.waitForTimeout(1500);
await inv.getByRole("button", { name: "Stap afronden" }).click();
await inv.getByRole("dialog").getByRole("button", { name: "Afronden" }).click();
await inv.getByRole("heading", { name: "Process Step 1" }).waitFor();
await p.waitForTimeout(800);
const reg = await p.evaluate(async () => {
  const api = window.demoApi;
  const l = JSON.parse((await api({ methode: "POST", url: "/auth/login", headers: {}, body: JSON.stringify({ gebruikersnaam: "kwaliteit1", wachtwoord: "demo" }) })).body);
  return JSON.parse((await api({ methode: "GET", url: "/batches/B-2026-9001/paspoort", headers: { authorization: "Bearer " + l.token } })).body);
});
const txt = JSON.stringify(reg);
check(/afgerond/.test(txt) && /buiten_tolerantie/.test(txt), "nieuwe batch in PS1 afgerond, 86,5 als buiten tolerantie gemarkeerd");
// Databaseregel: lot met maar 1 batch kan niet
const regel = await p.evaluate(async () => {
  const api = window.demoApi;
  const l = JSON.parse((await api({ methode: "POST", url: "/auth/login", headers: {}, body: JSON.stringify({ gebruikersnaam: "ploegleider1", wachtwoord: "demo", pc: "PC-16" }) })).body);
  const ops = JSON.parse((await api({ methode: "GET", url: "/auth/operators", headers: { authorization: "Bearer " + l.token } })).body);
  const t2 = JSON.parse((await api({ methode: "POST", url: "/auth/operator", headers: { authorization: "Bearer " + l.token }, body: JSON.stringify({ operatorId: ops[0].id }) })).body).token;
  return api({ methode: "POST", url: "/lots", headers: { authorization: "Bearer " + t2 }, body: JSON.stringify({ lotnummer: "L-2026-9999", batchnummers: ["B-2026-9001", "B-2026-0540", "B-2026-0541", "B-2026-0542"], id: crypto.randomUUID(), registratieId: crypto.randomUUID() }) });
});
check(regel.status === 422, `databaseregels gelden ook in de demo (${regel.status}: ${regel.body.slice(0, 120)})`);
await port.getByRole("link", { name: "Overzicht" }).click();
await p.waitForTimeout(1500);
await p.screenshot({ path: `${SHOTS}/03-naast-elkaar.png` });

// Serveroverzicht in de demo (fictieve back-ups)
const srv = await p.evaluate(async () => {
  const api = window.demoApi;
  const l = JSON.parse((await api({ methode: "POST", url: "/auth/login", headers: {}, body: JSON.stringify({ gebruikersnaam: "beheerder1", wachtwoord: "demo" }) })).body);
  return JSON.parse((await api({ methode: "GET", url: "/beheer/server", headers: { authorization: "Bearer " + l.token } })).body);
});
check(srv.schema?.nummer >= 4 && srv.laatsteBackup && srv.waarschuwingen.length === 0, `serveroverzicht in de demo zonder waarschuwingen (${JSON.stringify(srv.waarschuwingen)})`);

// Planning: vandaag gepland en lotvoorstellen open
const plan = await p.evaluate(async () => {
  const api = window.demoApi;
  const l = JSON.parse((await api({ methode: "POST", url: "/auth/login", headers: {}, body: JSON.stringify({ gebruikersnaam: "planner1", wachtwoord: "demo" }) })).body);
  const h = { authorization: "Bearer " + l.token };
  const d = new Date();
  const vandaag = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const stappen = JSON.parse((await api({ methode: "GET", url: `/planning/stappen?dag=${vandaag}`, headers: h })).body);
  const voorstellen = JSON.parse((await api({ methode: "GET", url: "/planning/lotvoorstellen", headers: h })).body);
  const week = JSON.parse((await api({ methode: "GET", url: `/planning/week?van=${vandaag}&dagen=7`, headers: h })).body);
  return { items: stappen.reduce((a, s) => a + s.items.length, 0), voorstellen: voorstellen.length, vooruit: week.dagen.slice(1).reduce((a, x) => a + x.batches.length, 0) };
});
check(plan.items > 0 && plan.voorstellen > 0 && plan.vooruit > 0, `planning in de demo: ${JSON.stringify(plan)}`);
await p.getByRole("button", { name: "Portalen", exact: true }).click();
await port.getByRole("button", { name: "Afmelden" }).click();
await port.getByLabel("Gebruikersnaam").fill("planner1");
await port.getByLabel("Wachtwoord").fill("demo");
await port.getByRole("button", { name: "Inloggen" }).click();
await port.getByRole("heading", { name: /^Week van/ }).waitFor({ timeout: 20000 }).catch(async (e) => { await p.screenshot({ path: `${SHOTS}/fout.png` }); throw e; });
await p.waitForTimeout(800);
await p.screenshot({ path: `${SHOTS}/04-planning.png` });
check(true, "Portaal Planning opent voor planner1");

// herladen: gegevens bewaard
await p.reload();
await p.waitForFunction(() => document.getElementById("laden").style.display === "none", null, { timeout: 60000 });
check(!(await p.locator("#uitleg").evaluate((d) => d.open)), "na herladen geen uitleg meer");
const r = await p.evaluate(async () => (await window.demoApi({ methode: "GET", url: "/gezondheid", headers: {} })).body);
check(/"demo":true/.test(r), "server in de browser antwoordt na herladen (uit browseropslag)");

check(fouten.length === 0, "geen scriptfouten" + (fouten.length ? ": " + fouten.join(" | ") : ""));
console.log(mis ? `${mis} fout(en)` : "Alles geslaagd");
await b.close();
process.exit(mis ? 1 : 0);
