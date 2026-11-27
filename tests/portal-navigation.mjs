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
const resourceItem = (id,code,name) => ({id,code,name,change_no:0});
const resourceArea = {...resourceItem("area-1","FICT-AREA","Fictief gebied"),level:"area",parent_id:null};
const resourceEquipment = {...resourceItem("equipment-1","FICT-E1","Fictief middel"),hierarchy_id:resourceArea.id};
const resourceClass = resourceItem("class-1","FICT-CLASS","Fictieve klasse");
const resourceAsset = resourceItem("asset-1","FICT-ASSET","Fictieve asset");
let resourceGlobal = false, resourceRequests = 0, scopeRequests = 0, scopeWrites = 0;
const exact="9007199254740993.123456789";
const property={id:"property-1",code:"FICT-VOL",name:"Fictief volume",quantity_kind_id:"kind-1",measurement_unit_id:"unit-1",unit:"L"};
const capability={id:"cap-1",equipment_id:resourceEquipment.id,property_definition_id:property.id,revision:1,value:exact,reason:"Fictief",created_at:"2026-01-01T10:00:00Z",capacity:false};
const technicalStatus={...resourceEquipment,status:"unknown",revision:0,reason:null,created_at:null,created_by_name:null};
let capRequests=0,statusRequests=0,referenceRequests=0,capWrites=0,statusWrites=0;
const scopeFixture = {areas:[resourceArea],equipment:[resourceEquipment],area_scopes:[],equipment_scopes:[]};
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
    if (path === "/resources/") {
      resourceRequests++;
      if (!projection.resourceCatalog && !projection.global.includes("resource.catalog.manage")) return json({fout:"Geweigerd"},403);
      return json({global:resourceGlobal,hierarchy:[resourceArea],equipment:[resourceEquipment],classes:[resourceClass],assets:[resourceAsset],class_assignments:[],asset_assignments:[{id:"assignment-1",equipment_id:resourceEquipment.id,physical_asset_id:resourceAsset.id,valid_from:"2026-01-01T10:00:00Z",valid_until:null}]});
    }
    if (path === "/resources/capabilities") {
      capRequests++;
      if (!projection.resourceCatalog&&!projection.global.includes("resource.catalog.manage")) return json({fout:"Geweigerd"},403);
      return json({global:resourceGlobal,equipment:[resourceEquipment],properties:[property],capabilities:[capability]});
    }
    if (path === "/resources/property-references") {
      referenceRequests++;
      if (!projection.global.includes("resource.catalog.manage")) return json({fout:"Geweigerd"},403);
      return json({quantity_kinds:[{id:"kind-1",code:"VOL",name:"Volume"},{id:"kind-2",code:"MASS",name:"Massa"}],units:[{id:"unit-1",quantity_kind_id:"kind-1",code:"L",symbol:"L",name:"Liter"},{id:"unit-2",quantity_kind_id:"kind-2",code:"KG",symbol:"kg",name:"Kilogram"}]});
    }
    if (path === "/resources/capabilities/cap-1/revisions"&&route.request().method()==="POST") {
      assert.ok(projection.resourceCatalog);
      assert.deepEqual(route.request().postDataJSON(),{expected_revision:1,value:"9007199254740993.123456790",reason:"Precisie"});
      capWrites++;capability.value=route.request().postDataJSON().value;capability.revision=2;
      return json({revision:2});
    }
    if (path === "/resources/statuses") {
      statusRequests++;
      return projection.resourceStatus?json([technicalStatus]):json({fout:"Geweigerd"},403);
    }
    if (path === "/resources/equipment/equipment-1/status"&&route.request().method()==="POST") {
      assert.ok(projection.resourceStatus);
      assert.deepEqual(route.request().postDataJSON(),{expected_revision:0,status:"blocked",reason:"Inspectie vereist"});
      statusWrites++;Object.assign(technicalStatus,{status:"blocked",revision:1,reason:"Inspectie vereist",created_at:"2026-01-01T10:00:00Z",created_by_name:"mes.quality"});
      return json({revision:1});
    }
    if (path === "/resources/equipment/equipment-1/status-history") {
      return projection.resourceStatus?json([{revision:1,status:"blocked",reason:"Inspectie vereist",created_at:"2026-01-01T10:00:00Z",created_by_name:"mes.quality"}]):json({fout:"Geweigerd"},403);
    }
    if (path === "/resources/scopes") {
      scopeRequests++;
      return projection.global.includes("resource.scope.manage")?json(scopeFixture):json({fout:"Geweigerd"},403);
    }
    if (path === "/resources/scopes/areas" && route.request().method()==="POST") {
      assert.ok(projection.global.includes("resource.scope.manage"));
      assert.deepEqual(route.request().postDataJSON(),{area_code:"FICT-GRANT",hierarchy_id:resourceArea.id});
      scopeWrites++;
      scopeFixture.area_scopes.push({id:"map-1",area_code:"FICT-GRANT",hierarchy_id:resourceArea.id});
      return json({id:"map-1"},201);
    }
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
  // #114.6: native middelenbeheer en onafhankelijke securitybediening.
  projection = {...personal(),resourceCatalog:true};
  resourceGlobal=false;
  await landing(["maintenance"]);
  await page.goto(origin+"/portaal/#/maintenance/middelen");
  await page.getByRole("heading",{name:"Middelenbeheer",exact:true}).waitFor();
  await page.getByText("Fictief middel",{exact:true}).waitFor();
  assert.equal(await page.getByText("Klasse toevoegen",{exact:true}).count(),0);
  assert.equal(await page.getByText("Asset toevoegen",{exact:true}).count(),0);
  assert.equal(await page.getByText("Asset toewijzen",{exact:true}).count(),0);
  assert.equal(await page.getByText("Klasse koppelen",{exact:true}).count(),1);
  assert.equal(await page.getByText("Afsluiten",{exact:true}).count(),1);
  const scopeBefore=scopeRequests;
  await page.goto(origin+"/portaal/#/beheer/scopemapping");
  await page.getByRole("heading",{name:/^Welkom/}).waitFor();
  assert.equal(scopeRequests,scopeBefore);
  projection={...personal(["resource.catalog.manage"]),resourceCatalog:true};
  resourceGlobal=true;
  await landing(["maintenance"]);
  await page.goto(origin+"/portaal/#/maintenance/middelen");
  await page.getByText("Asset toewijzen",{exact:true}).waitFor();
  assert.equal(await page.getByText("Klasse toevoegen",{exact:true}).count(),1);
  assert.equal(await page.getByText("Asset toevoegen",{exact:true}).count(),1);
  projection=personal(["resource.scope.manage"]);
  await landing(["beheer"]);
  const resourcesBefore=resourceRequests;
  await page.goto(origin+"/portaal/#/maintenance/middelen");
  await page.getByRole("heading",{name:/^Welkom/}).waitFor();
  assert.equal(resourceRequests,resourcesBefore);
  await page.goto(origin+"/portaal/#/beheer/scopemapping");
  await page.getByRole("heading",{name:"Scopemapping middelen",exact:true}).waitFor();
  const areaBlock=page.locator("section").filter({has:page.getByRole("heading",{name:"Gebiedsmappings",exact:true})});
  await areaBlock.getByText("Nieuwe mapping toevoegen",{exact:true}).click();
  await areaBlock.getByLabel("Exacte autorisatiecode").fill("FICT-GRANT");
  await areaBlock.getByLabel("Catalogusobject").selectOption(resourceArea.id);
  await areaBlock.getByRole("button",{name:"Mapping vastleggen"}).click();
  assert.equal(scopeWrites,0);
  await areaBlock.getByRole("checkbox").check();
  await areaBlock.getByRole("button",{name:"Mapping vastleggen"}).click();
  await areaBlock.getByText("FICT-GRANT",{exact:true}).waitFor();
  assert.equal(scopeWrites,1);
  assert.equal(await areaBlock.getByText("Nieuwe mapping toevoegen",{exact:true}).count(),0);
  projection=personal();
  await landing([]);
  console.log("OK F4-114: begrensd/globaal middelenbeheer, directe routeweigering, onafhankelijke mapping en bevestiging");
  // #115.6d: gescheiden portaalroutes, precieze waarde en statusovergang.
  projection={...personal(),resourceCatalog:true};resourceGlobal=false;
  await landing(["maintenance"]);
  const refsBefore=referenceRequests;
  await page.goto(origin+"/portaal/#/maintenance/capaciteiten");
  await page.getByRole("heading",{name:"Eigenschappen en capaciteit",exact:true}).waitFor();
  await page.getByText(exact,{exact:true}).waitFor();
  assert.equal(referenceRequests,refsBefore);
  assert.equal(await page.getByText("Eigenschap definiëren",{exact:true}).count(),0);
  const revision=page.locator("details").filter({has:page.getByText("Revisie toevoegen",{exact:true})});
  await revision.getByText("Revisie toevoegen",{exact:true}).click();
  await revision.getByLabel("Exacte waarde").fill("9007199254740993.123456790");
  await revision.getByLabel("Reden").fill("Precisie");
  await revision.getByRole("button",{name:"Opslaan"}).click();
  await page.getByText("9007199254740993.123456790",{exact:true}).waitFor();
  assert.equal(capWrites,1);
  const noStatus=statusRequests;
  await page.goto(origin+"/portaal/#/maintenance/status");
  await page.getByRole("heading",{name:"Middelenbeheer",exact:true}).waitFor();
  assert.equal(statusRequests,noStatus);
  projection={...personal(["resource.catalog.manage"]),resourceCatalog:true};resourceGlobal=true;
  await landing(["maintenance"]);
  await page.goto(origin+"/portaal/#/maintenance/capaciteiten");
  const definition=page.locator("details").filter({has:page.getByText("Eigenschap definiëren",{exact:true})});
  await definition.getByText("Eigenschap definiëren",{exact:true}).click();
  await definition.getByLabel("Grootheid").selectOption("kind-1");
  assert.deepEqual(await definition.getByLabel("Eenheid").locator("option").evaluateAll(xs=>xs.map(x=>x.value)),["","unit-1"]);
  await definition.getByLabel("Eenheid").selectOption("unit-1");
  await definition.getByLabel("Grootheid").selectOption("kind-2");
  assert.deepEqual(await definition.getByLabel("Eenheid").locator("option").evaluateAll(xs=>xs.map(x=>x.value)),["","unit-2"]);
  assert.equal(await definition.getByLabel("Eenheid").inputValue(),"");
  projection={...personal(),resourceStatus:true};
  await landing(["maintenance"]);
  const noCatalog=capRequests;
  await page.goto(origin+"/portaal/#/maintenance/capaciteiten");
  await page.getByRole("heading",{name:"Technische middelenstatus",exact:true}).waitFor();
  assert.equal(capRequests,noCatalog);
  await page.getByRole("cell",{name:"Onbekend",exact:true}).waitFor();
  const transition=page.locator("details").filter({has:page.getByText("Status wijzigen",{exact:true})});
  await transition.getByText("Status wijzigen",{exact:true}).click();
  await transition.getByLabel("Nieuwe technische status").selectOption("blocked");
  await transition.getByLabel("Reden").fill("Inspectie vereist");
  await transition.getByRole("button",{name:"Opslaan"}).click();
  await page.getByRole("cell",{name:"Geblokkeerd",exact:true}).waitFor();
  assert.equal(statusWrites,1);
  await page.getByText("Historie",{exact:true}).click();
  await page.getByRole("button",{name:"Historie ophalen"}).click();
  await page.locator("details table").getByRole("cell",{name:"Inspectie vereist",exact:true}).waitFor();
  projection=personal();
  await landing([]);
  const deniedStatus=statusRequests;
  await page.goto(origin+"/portaal/#/maintenance/status");
  await page.getByRole("heading",{name:/^Welkom/}).waitFor();
  assert.equal(statusRequests,deniedStatus);
  console.log("OK F4-115: exacte waarde, eenhedenfilter, statusovergang, historie en onafhankelijke directe routeweigering");
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
