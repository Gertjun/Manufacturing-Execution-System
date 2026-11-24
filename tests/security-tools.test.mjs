import test from "node:test";
import assert from "node:assert/strict";
import { securityActie } from "../tools/security.mjs";
import { koppelPersoneel, herstelAccount, securityBinding, kwalificatieActie } from "../tools/beheerder.mjs";
const id="11111111-1111-4111-8111-111111111111";
const product="22222222-2222-4222-8222-222222222222";
function io(answers, passwords=[]) {
  return { vraag: async()=>{assert.ok(answers.length,"onverwachte vraag");return answers.shift();},
    wachtwoord: async()=>{assert.ok(passwords.length,"onverwachte wachtwoordvraag");return passwords.shift();} };
}
function db(handler) {
  const calls=[];
  return { calls, query: async(sql,params=[])=>{calls.push({sql,params});return {rows:handler(sql,params)};} };
}
test("aanvraag draagt exacte scope en geen actor over",async()=>{
  const c=db(()=>[{status:"submitted",request_id:id}]), output=[];
  assert.equal(await securityActie(c,io([id,"operator","area",product,"equipment","2026-11-24T12:00:00Z","","test","BEVESTIG"],["fictief"]), "aanvragen-indienen",v=>output.push(v)),true);
  assert.equal(c.calls.length,1);
  assert.match(c.calls[0].sql,/authorization_channel_submit/);
  assert.deepEqual(c.calls[0].params,[id,"operator","area",product,"equipment","2026-11-24T12:00:00Z",null,"test","fictief"]);
  assert.ok(output.every(x=>!x.includes("fictief")));
});
test("besluit gebruikt echte status en exacte keuze",async()=>{
  for(const [actie,keuze] of [["goedkeuren",true],["afwijzen",false]]) {
    const c=db(()=>[{status:"decided",grant_id:keuze?id:null}]);
    assert.equal(await securityActie(c,io([id,"test","BEVESTIG"],["demo"]),actie,()=>{}),true);
    assert.deepEqual(c.calls[0].params,[id,keuze,"test","demo"]);
  }
});
test("annuleren, verkeerde UUID en ongeldige tijd voeren geen query uit",async()=>{
  const c=db(()=>{throw Error("geen query verwacht")});
  assert.equal(await securityActie(c,io([id,"test","STOP"]),"intrekken",()=>{}),false);
  await assert.rejects(securityActie(c,io(["geen-uuid"]),"goedkeuren",()=>{}),/UUID/);
  await assert.rejects(securityActie(c,io([id,"operator","","","","2026-11-24"]),"aanvragen-indienen",()=>{}),/tijdzone/);
  assert.equal(c.calls.length,0);
});
test("geweigerde en geblokkeerde bevestiging zijn geen succes",async()=>{
  for(const status of ["denied","locked"]) {
    const c=db(()=>[{status}]);
    assert.equal(await securityActie(c,io([id,"test","BEVESTIG"],["demo"]),"intrekken",()=>{}),false);
  }
});
test("leesacties gebruiken alleen vaste kanaalfuncties",async()=>{
  const c=db(()=>[]);
  for(const actie of ["aanvragen","grants"]) assert.equal(await securityActie(c,io([]),actie,()=>{}),true);
  assert.deepEqual(c.calls.map(x=>x.sql),["SELECT * FROM fabriek.authorization_channel_requests()","SELECT * FROM fabriek.authorization_channel_grants()"]);
});
function people(sql,params) {
  if(sql.includes("FROM fabriek.operator")) return [{id,naam:"Testpersoon"}];
  if(sql.includes("FROM fabriek.gebruiker")) return [{id:params[0],gebruikersnaam:params[0]}];
  if(sql.includes("recovery_readiness")) return [{independent_pairs:2}];
  throw Error("onverwachte query");
}
test("personeelskoppeling bindt exacte identiteit en beide wachtwoorden",async()=>{
  const c=db((sql,p)=>sql.includes("authorization_link_personnel_confirmed")?[{status:"linked"}]:people(sql,p));
  assert.equal(await koppelPersoneel(c,io([id,"doel","manager","security","test","KOPPEL"],["a","b"])),true);
  assert.deepEqual(c.calls.at(-1).params,[id,"doel","manager","security","test","a","b"]);
});
test("personeelskoppeling weigert dubbele identiteit en annulering",async()=>{
  const c=db(people);
  await assert.rejects(koppelPersoneel(c,io([id,"doel","manager","manager"])),/Drie verschillende/);
  assert.equal(await koppelPersoneel(c,io([id,"doel","manager","security","test","STOP"])),false);
  assert.ok(c.calls.every(x=>!x.sql.includes("authorization_link_personnel_confirmed")));
});
test("herstel gebruikt twee bevestigingen en tijdelijk wachtwoord",async()=>{
  const c=db((sql,p)=>sql.includes("authorization_recover_confirmed")?[{status:"recovered"}]:people(sql,p));
  assert.equal(await herstelAccount(c,io(["doel","manager","security","test","HERSTEL"],["a","b","tijdelijk","tijdelijk"])),true);
  assert.deepEqual(c.calls.at(-1).params,["doel","manager","security","test","a","b","tijdelijk"]);
});
test("binding en intrekking gebruiken bestaande eigenaarfuncties",async()=>{
  const c=db((sql,p)=>sql.includes("authorization_channel_")?[{oid:123}]:people(sql,p));
  assert.equal(await securityBinding(c,io(["db_security","security","test","BEVESTIG"]),false),true);
  assert.deepEqual(c.calls.at(-1).params,["db_security","security","test"]);
  assert.equal(await securityBinding(c,io(["db_security","test","BEVESTIG"]),true),true);
  assert.deepEqual(c.calls.at(-1).params,["db_security","test"]);
});

test("kwalificatie: exacte geldigheid, bewijs en twee persoonlijke bevestigingen",async()=>{
  const c=db((sql,p)=>sql.includes("qualification_issue_confirmed")?[{status:"issued",qualification_id:id}]:people(sql,p)), output=[];
  const from="2026-11-24T12:00:00Z", until="2027-11-24T12:00:00Z";
  assert.equal(await kwalificatieActie(c,io(["doel","opleiding",from,until,"manager","beoordelaar","bewijs","BEVESTIG"],["geheim-a","geheim-b"]),"toekennen",v=>output.push(v)),true);
  assert.deepEqual(c.calls.at(-1).params,["doel","opleiding",from,until,"manager","beoordelaar","bewijs","geheim-a","geheim-b"]);
  assert.ok(output.every(x=>!x.includes("geheim-")));
});
test("kwalificatie: annulering en ontbrekende onafhankelijkheid blokkeren toekenning",async()=>{
  const c=db(people),from="2026-11-24T12:00:00Z",until="2027-11-24T12:00:00Z";
  await assert.rejects(kwalificatieActie(c,io(["doel","opleiding",from,until,"manager","manager"]),"toekennen",()=>{}),/Drie verschillende/);
  assert.equal(await kwalificatieActie(c,io(["doel","opleiding",from,until,"manager","beoordelaar","bewijs","STOP"]),"toekennen",()=>{}),false);
  assert.ok(c.calls.every(x=>!x.sql.includes("qualification_issue_confirmed")));
});
test("kwalificatie: intrekking exacte registratie en status",async()=>{
  for(const status of ["revoked","denied","locked"]) {
    const c=db((sql,p)=>sql.includes("qualification_revoke_confirmed")?[{status}]:sql.includes("FROM fabriek.personnel_qualification")?[{id,user_id:"doel",qualification_code:"opleiding"}]:people(sql,p));
    assert.equal(await kwalificatieActie(c,io([id,"manager","bewijs","BEVESTIG"],["demo"]),"intrekken",()=>{}),status==="revoked");
    assert.deepEqual(c.calls.at(-1).params,[id,"manager","bewijs","demo"]);
  }
});
