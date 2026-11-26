// #138: echte gebouwde frontends, geïsoleerde fictieve API. Geen PostgreSQL of echte accounts.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(new URL("../portaal/package.json", import.meta.url));
const { chromium } = require("playwright-core");
const mime = { html: "text/html", js: "text/javascript", css: "text/css", svg: "image/svg+xml", woff2: "font/woff2", woff: "font/woff" };
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    const match = /^\/(portaal|invoer)\/([a-zA-Z0-9_./-]*)$/.exec(path);
    if (!match || match[2].split("/").includes("..")) { res.writeHead(404).end(); return; }
    const file = match[2] || "index.html";
    const data = await readFile(new URL("../" + match[1] + "/dist/" + file, import.meta.url));
    res.writeHead(200, { "Content-Type": mime[file.split(".").pop()] || "application/octet-stream" }).end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = "http://127.0.0.1:" + server.address().port;
const token = (sub, pc = false) => "test." + Buffer.from(JSON.stringify({ sub, naam: sub, rol: "operator", exp: Math.floor(Date.now()/1000)+3600, ...(pc ? { pcId: "pc1", operatorId: "persoon-"+sub } : {}) })).toString("base64url") + "." + Buffer.from("signature-" + sub + (pc ? "-pc" : "")).toString("base64url");
const A = token("mes.quality"), B = token("ander"), OLD = token("ander", true), BOUND = token("mes.quality", true);
// Fictieve JWT's moeten precies drie base64url-segmenten hebben, ook bij een gebruikersnaam met punt.
for (const t of [A, B, OLD, BOUND]) assert.match(t, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
const personal = (global = [], products = [], linkedPerson = true) => ({ personal: true, linkedPerson, global, products });
const quality = personal(["inspection.read"], [{ product: "P1", permission: "inspection.record" }]);
let projection = quality, binding = "ok", exchanges = 0, pending = null;
const veld = { code:"S3.2", naam:"Fictieve temperatuur", eenheid:"°C", soort:"procesparameter", stap:"PS3", grens_min:60, grens_max:90, tolerantie:5, tolerantie_soort:"absoluut" };
const meting = (dag, extra = {}) => ({ tijd: "2026-11-"+dag+"T10:00:00Z", setting:75, gemeten:75, markering:"ok", batch_of_lot:"FICTIEF-"+dag, operator:"Test", grens_min:60, grens_max:90, tolerantie:5, tolerantie_soort:"absoluut", product:"P1", ...extra });
let trendPunten = [meting("20",{gemeten:59,markering:"buiten_grens"}),meting("21",{setting:78,gemeten:85,markering:"buiten_tolerantie"}),meting("22",{gemeten:91,markering:"buiten_grens"})];
let browser;
try {
  browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("**/*", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith("/portaal/") || path.startsWith("/invoer/")) return route.continue();
    const json = (value, status = 200) => route.fulfill({ json: value, status });
    if (path === "/auth/permissions") return json(projection);
    if (path === "/auth/pc") {
      exchanges++;
      assert.equal(route.request().headers().authorization, "Bearer " + A);
      assert.equal(route.request().postDataJSON().pc, "PC-01");
      if (binding === "deny") return json({ fout: "Geweigerd" }, 403);
      if (binding === "delay") await new Promise(resolve => { pending = resolve; });
      return json({ token: BOUND, naamKiezen: false, operator: { id: "persoon-mes.quality", naam: "mes.quality" } });
    }
    if (path === "/gezondheid") return json({ ok: true });
    if (path === "/analyse/trend") return json({ veld, punten: trendPunten });
    return json([]);
  });
  const page = await context.newPage();
  const marker = "mes.portaloverdracht.v1";
  const set = async (p, values) => p.evaluate(values => {
    for (const [key, value] of Object.entries(values)) value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value);
  }, values);
  const stored = (p, key) => p.evaluate(key => localStorage.getItem(key), key);
  const ids = selector => page.locator(selector).evaluateAll(nodes => nodes.map(n => n.getAttribute("data-portaal")));
  const landing = async expected => {
    await page.goto(origin + "/portaal/#/");
    await page.reload();
    await page.getByRole("heading", { name: /^Welkom/ }).waitFor();
    assert.deepEqual(await ids(".starttegel[data-portaal]"), expected);
    assert.deepEqual(await ids("#menu .menu-portaal[data-portaal]"), expected);
    assert.equal(await page.locator("#menu .mes-merk").innerText(), "MES");
    assert.ok((await page.locator("#menu .mes-versie").innerText()).startsWith("Versie "));
    assert.ok((await page.locator("#menu .mes-gebruiker").innerText()).length > 0);
  };
  const checkAanmeldkaart = async () => {
    const card = page.locator(".mes-aanmeldkaart");
    await card.waitFor();
    assert.equal(await card.locator("h1").innerText(), "Inloggen");
    assert.equal(await card.locator(".mes-aanmeldmerk").innerText(), "MES · Manufacturing Execution System");
    const css = await card.evaluate(el => ({ bg: getComputedStyle(el).backgroundColor, top: getComputedStyle(el).borderTopColor, radius: getComputedStyle(el).borderTopLeftRadius, width: el.getBoundingClientRect().width }));
    assert.equal(css.bg, "rgb(255, 255, 255)");
    assert.equal(css.top, "rgb(11, 46, 89)");
    assert.equal(css.radius, "8px");
    assert.ok(css.width <= 440);
    assert.equal(await card.locator("input[type=password]").getAttribute("autocomplete"), "current-password");
  };
  await page.goto(origin + "/portaal/#/login");
  await checkAanmeldkaart();
  await set(page, { "portaal.token": A, "invoer.pc": "PC-01" });
  await landing(["invoer", "kwaliteit"]);
  console.log("OK P01/P02: kwaliteitsprojectie, identieke portalsets");
  projection = personal(["inspection.read"]);
  await landing(["kwaliteit"]);
  projection = personal(["inspection.read"], [{ product: "P1", permission: "inspection.record" }], false);
  await landing(["kwaliteit"]);
  projection = personal([], [{ product: "P1", permission: "recipe.draft.manage" }]);
  await landing(["engineering"]);
  assert.equal(await page.locator("#menu [data-portaal=beheer]").count(), 0);
  console.log("OK P03/P04: beperkte rechten, gekoppelde persoon, geen globaal materiaalbeheer");
  // Geïsoleerd schermbewijs voor Process Engineering, zonder mutaties of database.
  await page.goto(origin + "/portaal/#/engineering/recepten");
  await page.getByRole("heading",{name:"Master Recipes",exact:true}).waitFor();
  await page.getByText("Geen producten met actuele receptbeheerbevoegdheid.",{exact:true}).waitFor();
  console.log("OK 139.3c: receptscherm met beperkte productscope en lege API-respons");
  projection = quality;
  await landing(["invoer", "kwaliteit"]);
  await set(page, { "invoer.token": OLD, "invoer.operatornaam": "ander" });
  binding = "deny";
  const before = exchanges;
  await page.locator("#menu [data-portaal=invoer]").click();
  await page.getByLabel("Gebruikersnaam").waitFor();
  assert.equal(exchanges, before+1);
  assert.equal(await stored(page,"invoer.token"), null);
  assert.equal(await stored(page,"invoer.operatornaam"), null);
  await checkAanmeldkaart();
  assert.equal(await page.locator("#balk .mes-merk").innerText(), "MES");
  assert.ok((await page.locator("#balk .mes-versie").textContent()).startsWith("Versie "));
  assert.equal(await page.locator("#balk .mes-gebruiker").count(), 0);
  assert.ok((await page.locator(".mes-aanmeldcontext").innerText()).includes("PC-01"));
  console.log("OK 139.3a: gedeelde aanmeldkaart op beide frontends");
  console.log("OK P05: oude invoersessie gewist; geweigerde binding geen terugval");
  await landing(["invoer","kwaliteit"]);
  // Bewaar een geldige keuze, maar stop de standaardnavigatie om de randgevallen te testen.
  await page.locator(".starttegel-invoer").evaluate(el => {
    el.addEventListener("click", e => e.preventDefault(), { once: true }); el.click();
  });
  assert.ok(await page.evaluate(key => sessionStorage.getItem(key), marker));
  await page.evaluate(key => {
    const m = JSON.parse(sessionStorage.getItem(key)); m.tijd = Date.now()-120001; sessionStorage.setItem(key,JSON.stringify(m));
  }, marker);
  const expired = exchanges;
  await page.goto(origin+"/invoer/#/overstap");
  await page.getByLabel("Gebruikersnaam").waitFor();
  assert.equal(exchanges, expired);
  assert.equal(await page.evaluate(key => sessionStorage.getItem(key), marker), null);
  console.log("OK P06: verlopen keuze niet gebruikt en verbruikt");
  await landing(["invoer","kwaliteit"]);
  binding = "delay";
  await page.locator(".starttegel-invoer").click();
  for (let i=0; !pending && i<100; i++) await new Promise(resolve=>setTimeout(resolve,20));
  assert.ok(pending, "Geen vertraagd /auth/pc verzoek");
  await set(page, {"portaal.token": B});
  pending(); pending=null;
  await page.getByLabel("Gebruikersnaam").waitFor();
  assert.equal(await stored(page,"invoer.token"), null);
  assert.equal(await stored(page,"portaal.token"), B);
  console.log("OK P07: vertraagde binding herstelt geen oude identiteit");
  await set(page, {"portaal.token": A});
  projection = quality;
  await landing(["invoer","kwaliteit"]);
  projection = personal(["inspection.read"]);
  await landing(["kwaliteit"]);
  console.log("OK P08: intrekking verwijdert invoer uit beide navigaties");
  await page.getByRole("button",{name:"Afmelden"}).click();
  await page.getByLabel("Gebruikersnaam").waitFor();
  assert.equal(await stored(page,"portaal.token"), null);
  assert.equal(await stored(page,"invoer.token"), null);
  console.log("OK P10: centrale afmelding");
  // Werkelijk gebouwde trendgrafiek, met gecontroleerde historische meetwaarden.
  await set(page, {"portaal.token": A});
  projection = quality;
  const openTrend = async () => {
    await page.goto(origin+"/portaal/#/kwaliteit/trend/S3.2");
    await page.reload();
    await page.locator(".grafiek > svg").waitFor();
  };
  await openTrend();
  const zones = page.locator(".grafiek > svg rect[class^=trend-zone-]");
  assert.ok(await zones.count() >= 6, "Geneste historische zones ontbreken");
  assert.equal(await page.locator(".trend-zone-1").first().evaluate(el=>getComputedStyle(el).fill),"rgb(241, 248, 244)");
  assert.ok(await zones.evaluateAll(nodes=>nodes.every(el=>{
    const r=el.getBBox();return [r.x,r.y,r.width,r.height].every(Number.isFinite)&&r.width>0&&r.height>0&&r.x>=52-.01&&r.x+r.width<=744+.01&&r.y>=16-.01&&r.y+r.height<=286+.01;
  })), "Trendzones buiten plotgebied");
  const groen = await page.locator(".trend-zone-1").evaluateAll(nodes=>nodes.map(el=>el.getBBox().y));
  assert.ok(new Set(groen).size>1, "Historische setting moet zone verplaatsen");
  trendPunten = [meting("20"),meting("21",{product:"P2",grens_min:65})];
  await openTrend();
  assert.equal(await zones.count(),0,"Gemengde grenzen mogen geen zones krijgen");
  assert.equal(await page.locator(".grafiek .grenslijn, .grafiek .tolerantielijn").count(),0);
  trendPunten = [meting("20",{grens_min:null}),meting("21",{grens_min:null})];
  await openTrend();
  assert.equal(await zones.count(),0,"Ontbrekende grens mag geen zone krijgen");
  trendPunten = [meting("20",{tolerantie:30}),meting("21",{tolerantie:30})];
  await openTrend();
  assert.equal(await zones.count(),0,"Niet-geneste tolerantie mag geen zone krijgen");
  console.log("OK 139.3i: werkelijke historische trendzones, gemengde en ontbrekende grenzen");
  await context.close();
} finally {
  pending?.();
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
