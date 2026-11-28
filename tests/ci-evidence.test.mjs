import test from "node:test";
import assert from "node:assert/strict";
import {findEvidence} from "../tools/verifieer_pr_test.mjs";
const head="a".repeat(40),base="b".repeat(40);
const run={id:1,run_attempt:1,head_sha:head,event:"pull_request",status:"completed",conclusion:"success"};
const times={started_at:"2026-01-01T10:00:00Z",completed_at:"2026-01-01T10:01:00Z"};
const later={started_at:"2026-01-01T10:02:00Z",completed_at:"2026-01-01T10:03:00Z"};
const job={...times,name:"Node.js 22-compatibiliteit",conclusion:"success",steps:[{name:`PR-bewijs ${base} acceptatie-test`,conclusion:"success"}]};
const check=opts=>findEvidence({head,base,mode:"compatibiliteit-test",currentRun:99,runs:[run],listJobs:async()=>[job],...opts});
test("exacte head/base en compatibiliteit uit integrale acceptatie",async()=>assert.equal(await check({}),true));
test("andere base/head/modus, huidig run-ID en ontbrekend bewijs",async()=>{for(const opts of [{base:"c".repeat(40)},{head:"c".repeat(40)},{mode:"scherm-test"},{currentRun:1},{listJobs:async()=>[{...job,steps:[]}]},{mode:"acceptatie-test"}])assert.equal(await check(opts),false)});
test("mislukte run/job/marker en nieuwer falend bewijs",async()=>{for(const opts of [{runs:[{...run,conclusion:"failure"}]},{listJobs:async()=>[{...job,conclusion:"failure"}]},{listJobs:async()=>[{...job,steps:[{...job.steps[0],conclusion:"failure"}]}]},{runs:[run,{...run,id:2,conclusion:"failure"}]}])assert.equal(await check(opts),false)});
test("overgeslagen jobs zijn geen bewijs en verdringen geen geslaagd bewijs",async()=>{assert.equal(await check({listJobs:async()=>[{...job,conclusion:"skipped"}]}),false);assert.equal(await check({runs:[run,{...run,id:2}],listJobs:async id=>id===2?[{...job,conclusion:"skipped"}]:[job]}),true)});
test("gerichte modi hebben eigen bewijs; review-output nooit hergebruiken",async()=>{const j={...times,name:"Gerichte Chrome-schermregressies (Node.js 26)",conclusion:"success",steps:[{name:`PR-bewijs ${base} scherm-test`,conclusion:"success"}]};assert.equal(await check({mode:"scherm-test",listJobs:async()=>[j]}),true);assert.equal(await check({mode:"scherm-review-test",listJobs:async()=>[j]}),false);assert.equal(await check({mode:"scherm-test",listJobs:async()=>[{...j,steps:[{name:`PR-bewijs ${base} scherm-review-test`,conclusion:"success"}]}]}),false)});

import {validProof,mergeCandidate} from "../tools/verifieer_docs_test.mjs";
test("documentatiebewijs vereist werkelijke geslaagde inhoudelijke stap",()=>{
 const j={...times,conclusion:"success",steps:[{name:`Docs-bewijs ${base} docs`,conclusion:"success"},{name:"Roadmap en changelog controleren",conclusion:"success"}]};
 const args={run,job:j,head,base,mode:"docs",step:"Roadmap en changelog controleren"};
 assert.equal(validProof(args),true);
 assert.equal(validProof({...args,base:"c".repeat(40)}),false);
 assert.equal(validProof({...args,head:"c".repeat(40)}),false);
 assert.equal(validProof({...args,job:{...j,steps:[j.steps[0]]}}),false);
 assert.equal(validProof({...args,job:{...j,steps:[j.steps[0],{...j.steps[1],conclusion:"skipped"}]}}),false);
 assert.equal(validProof({...args,run:{...run,conclusion:"failure"}}),false);
});
test("mergebewijs vereist twee ouders, exacte oude main en identieke tree",()=>{
 const args={parents:[base,head],base,tree:"t",parentTree:"t"};
 assert.equal(mergeCandidate(args),head);
 assert.equal(mergeCandidate({...args,parentTree:"u"}),null);
 assert.equal(mergeCandidate({...args,parents:[head,base]}),null);
 assert.equal(mergeCandidate({...args,parents:[head]}),null);
});

import {selectPackages} from "../tools/selecteer_laptoppakketten.mjs";
test("Windows-pakketselectie beschermt bestaande en uitgesloten releases",()=>{
 const row=(v,assets=[],extra={})=>({tag_name:"v"+v,draft:false,prerelease:false,assets,...extra});
 const rows=[row("0.64.0",[{name:"batch-gui-laptop-0.64.0-windows.zip"}]),row("0.63.0"),row("0.14.0"),row("0.15.0"),row("0.6.0"),row("0.65.0",[],{draft:true}),row("0.66.0",[],{prerelease:true}),row("0.9.0")];
 assert.deepEqual(selectPackages(rows),["0.9.0","0.63.0"]);
 assert.deepEqual(selectPackages(rows,"0.64.0"),[]);
 assert.deepEqual(selectPackages(rows,"0.14.0 0.63.0"),["0.63.0"]);
 assert.throws(()=>selectPackages(rows,"0.99.0"));
 assert.throws(()=>selectPackages(rows,"invalid"));
 assert.throws(()=>selectPackages([row("0.63.0",null)]));
});

import {latestProof} from "../tools/verifieer_docs_test.mjs";
test("schemabewijs: latere fout in andere workflow blokkeert ouder groen",()=>{
 const step="Databasediagram vergelijken met schema";
 const j={...times,conclusion:"success",steps:[{name:`Docs-bewijs ${base} schema`,conclusion:"success"},{name:step,conclusion:"success"}]};
 const good={run,job:j,step};
 const bad={run:{...run,id:2,conclusion:"failure"},job:{...j,...later,conclusion:"failure"},step};
 const args={head,base,mode:"schema"};
 assert.equal(latestProof({...args,attempts:[good]}),true);
 assert.equal(latestProof({...args,attempts:[good,bad]}),false);
 assert.equal(latestProof({...args,attempts:[good,{...bad,run:{...bad.run,conclusion:"success"},job:{...j,steps:[{name:step,conclusion:"skipped"}]}}]}),true);
 assert.equal(latestProof({...args,attempts:[good,{...bad,job:{conclusion:"failure",steps:[]}}]}),false);
});

test("schermbundel hergebruik alleen als volledige bundel",async()=>{
 const bundle={...job,name:"Individuele Chrome-regressie (scherm-bundel-test)",steps:[{name:`PR-bewijs ${base} scherm-bundel-test`,conclusion:"success"}]};
 assert.equal(await check({mode:"scherm-bundel-test",listJobs:async()=>[bundle]}),true);
 assert.equal(await check({mode:"scherm-productie-test",listJobs:async()=>[bundle]}),false);
});
test("herstart oudere run met latere fout blokkeert groen",async()=>{
 const old={...run,id:1,run_attempt:2,conclusion:"failure"};
 const green={...run,id:2};
 assert.equal(await check({runs:[green,old],listJobs:async id=>id===1?[{...job,...later,conclusion:"failure"}]:[job]}),false);
 assert.equal(await check({runs:[green,{...old,conclusion:"success"}],listJobs:async id=>id===1?[{...job,...later}]:[job]}),false);
 assert.equal(await check({listJobs:async()=>[{...job,started_at:null}]}),false);
});
import {completeList} from "../tools/ci_evidence.mjs";
test("onvolledige API-pagina wordt geweigerd",()=>{
 assert.throws(()=>completeList({total_count:2,jobs:[job]},"jobs"));
 assert.deepEqual(completeList({total_count:1,jobs:[job]},"jobs"),[job]);
});

import {acceptanceProof,diagramProof} from "../tools/verifieer_acceptatie.mjs";
test("mergebewijs vereist beide suites en expliciet checkoutbewijs",()=>{
 const a={run,job:{...job,steps:[{name:"Geteste tree vastleggen",conclusion:"success"}]}};
 const b={run,job:{...a.job,name:"Volledige testsuite (Node.js 26)",steps:[...a.job.steps,{name:"Plaatje van de database bij (docs/DATABASE.md)",conclusion:"success"}]}};
 assert.equal(acceptanceProof([a,b]),true);
 assert.equal(acceptanceProof([a]),false);
 assert.equal(acceptanceProof([a,{...b,job:{...b.job,steps:[]}}]),false);
 assert.equal(acceptanceProof([a,{...b,job:{...b.job,conclusion:"skipped"}}]),false);
});
test("mergebewijs: recentere fout, herstart of ontbrekende tijd blokkeert oud groen",()=>{
 const a={run,job:{...job,steps:[{name:"Geteste tree vastleggen",conclusion:"success"}]}};
 const b={run,job:{...a.job,name:"Volledige testsuite (Node.js 26)",steps:[...a.job.steps,{name:"Plaatje van de database bij (docs/DATABASE.md)",conclusion:"success"}]}};
 const bad={run:{...run,id:2,conclusion:"failure"},job:{...b.job,...later,conclusion:"failure"}};
 assert.equal(acceptanceProof([a,b,bad]),false);
 assert.equal(acceptanceProof([a,b,{run:{...run,run_attempt:2},job:{...b.job,...later}}]),false);
 assert.equal(acceptanceProof([a,b,{run,job:{...b.job,started_at:null}}]),false);
 assert.equal(acceptanceProof([a,b,{...bad,job:{...bad.job,conclusion:"skipped"}}]),true);
});

test("acceptatie vereist werkelijk uitgevoerde schema-documentatievergelijking",()=>{
 const a={run,job:{...job,steps:[{name:"Geteste tree vastleggen",conclusion:"success"}]}};
 const b={run,job:{...a.job,name:"Volledige testsuite (Node.js 26)"}};
 assert.equal(acceptanceProof([a,b]),false);
 assert.equal(acceptanceProof([a,{...b,job:{...b.job,steps:[...b.job.steps,{name:"Plaatje van de database bij (docs/DATABASE.md)",conclusion:"skipped"}]}}]),false);
});
test("release-diagrambewijs vereist werkelijke checkout en vergelijking, latere fout blokkeert",()=>{
 const d={run,job:{...job,name:"Diagrammen voor technische acceptatie",steps:[{name:"Geteste commit en roadmap-SVG vastleggen",conclusion:"success"},{name:"Genereer technische diagrammen en controleer gepubliceerde SVG’s",conclusion:"success"}]}};
 assert.equal(diagramProof([d]),true);
 assert.equal(diagramProof([]),false);
 assert.equal(diagramProof([{...d,job:{...d.job,steps:d.job.steps.slice(0,1)}}]),false);
 assert.equal(diagramProof([d,{run:{...run,id:2,conclusion:"failure"},job:{...d.job,...later,conclusion:"failure"}}]),false);
});

import {readFileSync} from "node:fs";
test("D115: concept-PR stelt alleen afgeleide schema-documentatie uit",()=>{
 const doc=readFileSync(new URL("../.github/workflows/documentatie.yml",import.meta.url),"utf8");
 const ci=readFileSync(new URL("../.github/workflows/tests.yml",import.meta.url),"utf8");
 const diagram=readFileSync(new URL("../.github/workflows/diagrammen.yml",import.meta.url),"utf8");
 const release=readFileSync(new URL("../.github/workflows/release.yml",import.meta.url),"utf8");
 assert.ok(doc.includes("DRAFT: ${{ github.event_name == 'pull_request' && github.event.pull_request.draft }}"));
 assert.match(doc,/if schema and os\.environ\["DRAFT"\] == "true":[\s\S]*?schema = False/);
 assert.ok(ci.includes("run: tests/test_schema_plaatje.sh"));
 const baseline=ci.slice(ci.indexOf("  database-baseline:"),ci.indexOf("  laptop-security:"));
 assert.ok(baseline.includes("run: tests/test_migraties.sh")&&baseline.includes("tests/test_regels.py")&&baseline.includes("tests/test_historische_upgrade.sh"));
 assert.ok(!baseline.includes("tools/schema_plaatje.py")&&baseline.includes("npm run openapi"));
 assert.ok(diagram.includes("github.event.label.name == 'schema-generatie'")&&diagram.includes("mes-schema-documentatie"));
 assert.ok(diagram.includes("diff -r docs/diagrams/rendered /tmp/mes-diagrams")&&diagram.includes("tests/test_schema_plaatje.sh"));
 assert.ok(release.includes('--require-diagrams'));
});
