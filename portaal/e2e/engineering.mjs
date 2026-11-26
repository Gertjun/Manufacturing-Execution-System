// #113.7b: functionele Process Engineering-regressie; uitsluitend fictieve database.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";
import pg from "pg";
const DB=process.env.DATABASE_URL, APP_DB=process.env.TEST_APP_DATABASE_URL;
assert.ok(DB && APP_DB && DB!==APP_DB,"Afzonderlijke test- en applicatieverbinding vereist");
const BASIS="http://localhost:3479";
const db=new pg.Client({connectionString:DB});
const api=spawn("npx",["tsx","src/index.ts"],{
  cwd:new URL("../../api/",import.meta.url).pathname,
  env:{...process.env,DATABASE_URL:APP_DB,JWT_GEHEIM:"e2e-".repeat(10),POORT:"3479",
    PORTAAL_MAP:new URL("../dist",import.meta.url).pathname,INVOER_MAP:new URL("../../invoer/dist",import.meta.url).pathname},
  stdio:["ignore","ignore","inherit"],detached:true
});
let browser,pageForDiagnostics;
const errors=[];
try {
  await db.connect();
  const {rows:[product]}=await db.query("SELECT id FROM fabriek.product WHERE code='PRD-A'");
  assert.ok(product);
  let ready=false;
  for(let i=0;i<80;i++){
    try{if((await fetch(BASIS+"/gezondheid")).ok){ready=true;break;}}catch{}
    await new Promise(r=>setTimeout(r,250));
  }
  assert.ok(ready,"API niet bereikbaar");
  async function request(method,path,token,body,expected){
    const response=await fetch(BASIS+path,{method,headers:{...(token?{authorization:"Bearer "+token}:{}),...(body?{"content-type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json();
    assert.equal(response.status,expected,method+" "+path+": "+JSON.stringify(data));
    return data;
  }
  const loginApi=async naam=>(await request("POST","/auth/login",null,{gebruikersnaam:naam,wachtwoord:"demo"},200)).token;
  const engineer=await loginApi("mes.engineer");
  const approver=await loginApi("mes.eng.approver");
  const qa=await loginApi("mes.quality.approver");
  const production=await loginApi("mes.manager");
  const scopedName="mes.e2e.recipe.scoped";
  await db.query("INSERT INTO fabriek.gebruiker(gebruikersnaam,rol,wachtwoord_hash) VALUES ($1,'analist',fabriek.wachtwoord_hash('demo'))",[scopedName]);
  await db.query("INSERT INTO fabriek.authorization_grant(user_id,role_code,product_id) SELECT id,'process_engineer',$2 FROM fabriek.gebruiker WHERE gebruikersnaam=$1",[scopedName,product.id]);
  browser=await chromium.launch({executablePath:"/usr/bin/google-chrome",args:["--no-sandbox"]});
  const context=await browser.newContext({viewport:{width:1440,height:900},locale:"nl-NL",timezoneId:"Europe/Amsterdam"});
  const page=await context.newPage();
  pageForDiagnostics=page;
  page.on("pageerror",e=>errors.push(e.message));
  page.setDefaultTimeout(15000);
  async function login(naam){
    await page.goto(BASIS+"/portaal/#/login");
    await page.evaluate(()=>localStorage.clear());
    await page.reload();
    await page.getByLabel("Gebruikersnaam").fill(naam);
    await page.getByLabel("Wachtwoord",{exact:true}).fill("demo");
    await page.getByRole("button",{name:"Inloggen",exact:true}).click();
    await page.waitForURL(u=>u.hash==="#/" || u.pathname.startsWith("/invoer/"));
    await page.waitForFunction(()=>location.pathname.startsWith("/invoer/") || !!document.querySelector("main h1")?.textContent?.startsWith("Welkom,"));
  }
  async function route(path,heading){
    const target=BASIS+"/portaal/#/engineering/"+path;
    if(page.url()===target) await page.reload();
    else await page.goto(target);
    await page.getByRole("heading",{name:heading,exact:true}).waitFor();
  }
  const available=await request("GET","/recipes/products",engineer,null,200);
  assert.ok(available.some(p=>p.id===product.id&&p.can_edit),"PRD-A moet beschikbaar zijn voor de persoonlijke engineering-identiteit");
  await login("mes.engineer");
  await page.locator(".starttegel-engineering").waitFor();
  await route("materialen","Materiaalstamgegevens");
  await route("eenheden","Eenhedencatalogus");
  await route("recepten","Master Recipes");
  await page.getByLabel("Product",{exact:true}).selectOption(product.id);
  const create=page.locator("section.blok").filter({has:page.getByRole("heading",{name:"Nieuwe Master Recipe",exact:true})});
  await create.getByText("Recept aanmaken",{exact:true}).click();
  await create.getByLabel("Receptcode").fill("E2E-PE");
  await create.getByLabel("Naam",{exact:true}).fill("Fictief schermrecept");
  await create.getByRole("button",{name:"Opslaan",exact:true}).click();
  const recipe=page.locator("section.blok").filter({has:page.getByRole("heading",{name:"E2E-PE",exact:true})});
  await recipe.getByText("Revisie 1 — Fictief schermrecept · Concept",{exact:true}).click();
  await recipe.getByText("Conceptheader wijzigen",{exact:true}).click();
  const edit=recipe.locator("summary").filter({hasText:/^Conceptheader wijzigen$/}).locator("..").locator("form");
  await edit.getByLabel("Naam",{exact:true}).fill("Fictief gewijzigd");
  await edit.getByRole("button",{name:"Opslaan",exact:true}).click();
  await recipe.getByText("Revisie 1 — Fictief gewijzigd · Concept",{exact:true}).waitFor();
  const {rows:[v]}=await db.query("SELECT v.id,v.change_no,v.lifecycle_status FROM fabriek.master_recipe_version v JOIN fabriek.master_recipe m ON m.id=v.master_recipe_id WHERE m.code='E2E-PE' AND m.product_id=$1",[product.id]);
  assert.equal(v.change_no,1);
  assert.equal(v.lifecycle_status,"draft");
  // Prepare review evidence through the real personal API, not privileged table writes.
  const base="/recipes/versions/"+v.id;
  const moc=await request("POST",base+"/moc",engineer,{expected_change_no:1,baseline_version_id:null,reason:"Fictieve invoer",impact_description:"Fictieve impact"},201);
  await request("POST",base+"/moc/impacts",engineer,{expected_change_no:2,request_id:moc.id,area:"header",explanation:"Fictieve impact"},201);
  const submission={expected_change_no:3,expected_baseline_change_no:null,password:"demo"};
  const first=await request("POST",base+"/reviews",engineer,submission,201);
  const firstPath="/recipes/reviews/"+first.round_id+"/decisions";
  await request("POST",firstPath,qa,{expected_change_no:3,domain:"quality",decision:"reject",reason:"Fictieve afwijzing",password:"demo"},201);
  const second=await request("POST",base+"/reviews",engineer,submission,201);
  await route("recepten","Master Recipes");
  await page.getByLabel("Product",{exact:true}).selectOption(product.id);
  await recipe.getByText("Revisie 1 — Fictief gewijzigd · Ter beoordeling",{exact:true}).click();
  await recipe.getByText("Deze revisie is niet wijzigbaar.",{exact:true}).waitFor();
  assert.equal(await recipe.getByText("Conceptheader wijzigen",{exact:true}).count(),0);
  await login("mes.eng.approver");
  await route("beoordelingen","Receptbeoordelingen");
  await page.getByLabel("Product",{exact:true}).selectOption(product.id);
  const rounds=page.locator("section.blok").filter({has:page.getByRole("heading",{name:/^E2E-PE · revisie 1/})});
  const historical=rounds.filter({has:page.locator("p.sub",{hasText:/· ronde 1$/})});
  const current=rounds.filter({has:page.locator("p.sub",{hasText:/· ronde 2$/})});
  await historical.getByRole("button",{name:"Vastgezet dossier laden / vernieuwen"}).click();
  await historical.getByText(/Historisch \/ niet actueel/).waitFor();
  assert.equal(await historical.getByRole("button",{name:"Beoordeling bevestigen"}).count(),0);
  await current.getByRole("button",{name:"Vastgezet dossier laden / vernieuwen"}).click();
  await current.getByLabel("Beoordelingsdomein").selectOption("engineering");
  await current.getByLabel("Besluit",{exact:true}).selectOption("approve");
  await current.getByLabel("Onderbouwing",{exact:true}).fill("Fictieve onafhankelijke beoordeling");
  await current.getByLabel("Ik heb het vastgezette dossier beoordeeld").check();
  await current.getByLabel("Persoonlijk wachtwoord").fill("demo");
  await current.getByRole("button",{name:"Beoordeling bevestigen"}).click();
  await current.getByText(/Goedgekeurd: Engineering/).waitFor();
  assert.equal(await current.getByRole("button",{name:"Formele vrijgave bevestigen"}).count(),0);
  // Complete the remaining independent domains through the real API.
  for(const [token,domain] of [[production,"production"],[qa,"quality"]]) {
    await request("POST","/recipes/reviews/"+second.round_id+"/decisions",token,{expected_change_no:3,domain,decision:"approve",reason:"Fictieve goedkeuring",password:"demo"},201);
  }
  await page.getByRole("button",{name:"Vernieuwen",exact:true}).click();
  await current.getByText(/Goedgekeurd · ronde 2/).waitFor();
  await current.getByRole("button",{name:"Vastgezet dossier laden / vernieuwen"}).click();
  await current.getByRole("button",{name:"Vrijgavevalidatie laden / vernieuwen"}).click();
  await current.getByText("Inhoudelijke vrijgave geblokkeerd.",{exact:true}).waitFor();
  await current.getByText(/missing_formula/).waitFor();
  assert.equal(await current.getByRole("button",{name:"Formele vrijgave bevestigen"}).count(),0);
  // 140.1: independent, complete fictitious recipe through personal APIs and formal UI decisions.
  const code="E2E-RELEASE";
  const releasedName="Fictieve formele vrijgave";
  const recipeId=(await request("POST","/recipes/",engineer,{
    product_id:product.id,code,name:releasedName,description:""
  },201)).id;
  const recipes=await request("GET","/recipes/?product_id="+product.id,engineer,null,200);
  const version=recipes.find(r=>r.id===recipeId).versions[0];
  assert.equal(version.revision,1);

  const dimension=await request("POST","/units/dimensions",engineer,{
    length_exp:0,mass_exp:1,time_exp:0,current_exp:0,temperature_exp:0,amount_exp:0,luminous_exp:0
  },201);
  const quantity=await request("POST","/units/quantity-kinds",engineer,{
    dimension_id:dimension.id,code:"E2E-MASS",name:"Massa",value_semantics:"ratio"
  },201);
  const unit=await request("POST","/units/units",engineer,{
    quantity_kind_id:quantity.id,code:"E2E-KG",symbol:"kg",name:"Kilogram"
  },201);

  const releaseBase="/recipes/versions/"+version.id;
  let changeNo=version.change_no;
  const editRecipe=(path, fields)=>request("POST",releaseBase+path,engineer,{
    ...fields,expected_change_no:changeNo++
  },201);
  let parent=null;
  for(const kind of ["procedure","unit_procedure","operation","phase"]){
    const element=await editRecipe("/procedure/elements",{
      parent_id:parent,kind,code:kind.toUpperCase(),name:kind,position:1,required:true
    });
    parent=element.id;
  }
  await editRecipe("/content/formulas",{reference_quantity:"1000.125",reference_unit:"kg",reference_unit_id:unit.id});
  await editRecipe("/requirements/lot-rules",{nominal_batch_count:6,deviation_approval_required:true});
  const releaseMoc=await editRecipe("/moc",{
    baseline_version_id:null,reason:"Fictieve receptwijziging",impact_description:"Fictieve impact"
  });
  await editRecipe("/moc/impacts",{request_id:releaseMoc.id,area:"formula",explanation:"Fictieve formule-impact"});

  const draftValidation=await request("GET",releaseBase+"/release-validation",engineer,null,200);
  assert.equal(draftValidation.change_no,changeNo);
  assert.equal(draftValidation.content_valid,true);
  assert.deepEqual(draftValidation.blockers,[]);

  const submitRound=()=>request("POST",releaseBase+"/reviews",engineer,{
    expected_change_no:changeNo,expected_baseline_change_no:null,password:"demo"
  },201);
  const decide=(round,token,domain,decision)=>request("POST","/recipes/reviews/"+round.round_id+"/decisions",token,{
    expected_change_no:changeNo,domain,decision,reason:"Fictief onafhankelijk besluit",password:"demo"
  },201);
  const rejected=await submitRound();
  await decide(rejected,qa,"quality","reject");
  const accepted=await submitRound();
  assert.notEqual(accepted.round_id,rejected.round_id);
  for(const [token,domain] of [[approver,"engineering"],[production,"production"],[qa,"quality"]]){
    await decide(accepted,token,domain,"approve");
  }

  const acceptedDossier="/recipes/reviews/"+accepted.round_id;
  const beforeRelease=await request("GET",acceptedDossier,approver,null,200);
  assert.equal(beforeRelease.lifecycle_status,"approved");
  assert.deepEqual(beforeRelease.decisions.map(d=>d.domain).sort(),["engineering","production","quality"]);
  assert.equal(new Set(beforeRelease.decisions.map(d=>d.reviewer_id)).size,3);
  const approvals=Object.fromEntries(beforeRelease.decisions.map(d=>[d.domain,d.reviewer_id]));
  assert.ok(!Object.values(approvals).includes(beforeRelease.round.created_by));

  await route("beoordelingen","Receptbeoordelingen");
  await page.getByLabel("Product",{exact:true}).selectOption(product.id);
  const releaseRounds=page.locator("section.blok").filter({
    has:page.getByRole("heading",{name:`${code} · revisie 1 — ${releasedName}`,exact:true})
  });
  const releaseRound=releaseRounds.filter({has:page.locator("p.sub",{hasText:/· ronde 2$/})});
  const oldReleaseRound=releaseRounds.filter({has:page.locator("p.sub",{hasText:/· ronde 1$/})});
  const loadDossier=round=>round.getByRole("button",{name:"Vastgezet dossier laden / vernieuwen"}).click();
  await loadDossier(oldReleaseRound);
  await oldReleaseRound.getByText(/Historisch \/ niet actueel/).waitFor();
  assert.equal(await oldReleaseRound.getByRole("button",{name:"Vrijgavevalidatie laden / vernieuwen"}).count(),0);
  await loadDossier(releaseRound);
  await releaseRound.getByRole("button",{name:"Vrijgavevalidatie laden / vernieuwen"}).click();
  await releaseRound.getByText("Geen inhoudelijke blokkades volgens de server. Dit is geen vrijgave.",{exact:true}).waitFor();
  await releaseRound.getByLabel(/^Ingangsdatum/).selectOption("now");
  const releaseReason="Fictief formeel vrijgavebesluit in de interface";
  async function confirmDecision(label,path,reason){
    const form=releaseRound.locator("form").filter({has:page.getByRole("button",{name:label,exact:true})});
    await form.getByLabel("Onderbouwing",{exact:true}).fill(reason);
    await form.getByLabel("Ik bevestig dit formele besluit").check();
    await form.getByLabel("Persoonlijk wachtwoord",{exact:true}).fill("demo");
    const [response]=await Promise.all([
      page.waitForResponse(r=>r.request().method()==="POST"&&new URL(r.url()).pathname===path),
      form.getByRole("button",{name:label,exact:true}).click()
    ]);
    assert.equal(response.status(),201,await response.text());
    return response.json();
  }
  const release=await confirmDecision("Formele vrijgave bevestigen",releaseBase+"/releases",releaseReason);
  assert.equal(release.status,"released");
  await releaseRound.getByText("Vrijgegeven · ronde 2",{exact:true}).waitFor();
  await loadDossier(releaseRound);
  await releaseRound.getByText("Vrijgave-ID: "+release.release_id,{exact:true}).waitFor();
  assert.equal(await releaseRound.getByRole("button",{name:"Formele vrijgave bevestigen"}).count(),0);
  const persisted=await request("GET",acceptedDossier,approver,null,200);
  assert.equal(persisted.round.snapshot_text,beforeRelease.round.snapshot_text);
  assert.deepEqual(
    [persisted.round.id,persisted.round.recipe_version_id,persisted.round.round_no,persisted.round.change_no],
    [accepted.round_id,version.id,2,changeNo]
  );
  assert.deepEqual(
    [persisted.release.id,persisted.release.master_recipe_id,persisted.release.recipe_version_id,
      persisted.release.round_id,persisted.release.released_by,persisted.release.reason],
    [release.release_id,recipeId,version.id,accepted.round_id,approvals.engineering,releaseReason]
  );
  assert.ok(Number.isFinite(Date.parse(persisted.release.released_at)));
  assert.equal(persisted.release.effective_from,persisted.release.released_at);
  const historicalRelease=await request("GET","/recipes/reviews/"+rejected.round_id,approver,null,200);
  assert.equal(historicalRelease.is_current,false);
  assert.equal(historicalRelease.release,null);

  await login("mes.engineer");
  await route("recepten","Master Recipes");
  await page.getByLabel("Product",{exact:true}).selectOption(product.id);
  const publishedRecipe=page.locator("section.blok").filter({has:page.getByRole("heading",{name:code,exact:true})});
  await publishedRecipe.getByText(`Revisie 1 — ${releasedName} · Formeel vrijgegeven`,{exact:true}).click();
  await publishedRecipe.getByText("Deze revisie is niet wijzigbaar.",{exact:true}).waitFor();
  assert.equal(await publishedRecipe.getByText("Conceptheader wijzigen",{exact:true}).count(),0);

  await login("mes.quality.approver");
  await route("beoordelingen","Receptbeoordelingen");
  await page.getByLabel("Product",{exact:true}).selectOption(product.id);
  await loadDossier(releaseRound);
  const withdrawalReason="Fictieve formele intrekking in de interface";
  const withdrawn=await confirmDecision("Intrekking bevestigen","/recipes/releases/"+release.release_id+"/withdrawals",withdrawalReason);
  assert.equal(withdrawn.status,"withdrawn");
  await releaseRound.getByText("Ingetrokken · ronde 2",{exact:true}).waitFor();
  await loadDossier(releaseRound);
  await releaseRound.getByText("Intrekkings-ID: "+withdrawn.withdrawal_id,{exact:true}).waitFor();
  assert.equal(await releaseRound.getByRole("button",{name:"Intrekking bevestigen"}).count(),0);
  const finalDossier=await request("GET",acceptedDossier,qa,null,200);
  assert.deepEqual(finalDossier.release,persisted.release);
  assert.deepEqual(
    [finalDossier.withdrawal.id,finalDossier.withdrawal.release_id,finalDossier.withdrawal.withdrawn_by,finalDossier.withdrawal.reason],
    [withdrawn.withdrawal_id,release.release_id,approvals.quality,withdrawalReason]
  );
  console.log("Positieve MBR-vrijgave en intrekking via Process Engineering geslaagd.");

  await login(scopedName);
  await route("recepten","Master Recipes");
  const allowed=await page.getByLabel("Product",{exact:true}).locator("option").evaluateAll(options=>options.map(o=>o.value).filter(Boolean));
  assert.deepEqual(allowed,[product.id]);
  await page.goto(BASIS+"/portaal/#/engineering/materialen");
  await page.waitForURL(u=>u.hash==="#/engineering");
  await page.getByRole("heading",{name:"Process Engineering",exact:true}).waitFor();
  assert.equal(await page.getByRole("heading",{name:"Materiaalstamgegevens",exact:true}).count(),0);
  // Direct URL must not expose unauthorized screens after identity change.
  for(const naam of ["mes.operator","mes.system"]){
    await login(naam);
    assert.equal(await page.locator(".starttegel-engineering").count(),0);
    await page.goto(BASIS+"/portaal/#/engineering/beoordelingen");
    await page.waitForURL(u=>u.hash==="#/" || u.pathname.startsWith("/invoer/"));
    await page.waitForFunction(()=>location.pathname.startsWith("/invoer/") || !!document.querySelector("main h1")?.textContent?.startsWith("Welkom,"));
    assert.equal(await page.getByRole("heading",{name:"Receptbeoordelingen",exact:true}).count(),0);
    assert.equal(await page.getByText(/E2E-PE · revisie/).count(),0);
  }
  assert.deepEqual(errors,[],"Browserfouten");
  console.log("Process Engineering: functionele schermregressies geslaagd.");
} catch(e) {
  console.error("Process Engineering schermtest:",e.message);
  if(browser) {
    console.error("Actuele route:",pageForDiagnostics?.url());
    console.error("Schermtekst:",await pageForDiagnostics?.locator("main").innerText({timeout:2000}).catch(()=>"(niet beschikbaar)"));
  }
  throw e;
} finally {
  if(browser)await browser.close();
  await db.end().catch(()=>{});
  try{process.kill(-api.pid);}catch{}
}
