import test from "node:test";
import assert from "node:assert/strict";
import {findEvidence} from "../tools/verifieer_pr_test.mjs";
const head="a".repeat(40),base="b".repeat(40);
const run={id:1,head_sha:head,event:"pull_request",status:"completed",conclusion:"success"};
const job={name:"Node.js 22-compatibiliteit",conclusion:"success",steps:[{name:`PR-bewijs ${base} acceptatie-test`,conclusion:"success"}]};
const check=opts=>findEvidence({head,base,mode:"compatibiliteit-test",currentRun:99,runs:[run],listJobs:async()=>[job],...opts});
test("exacte head/base en compatibiliteit uit integrale acceptatie",async()=>assert.equal(await check({}),true));
test("andere base/head/modus, huidig run-ID en ontbrekend bewijs",async()=>{for(const opts of [{base:"c".repeat(40)},{head:"c".repeat(40)},{mode:"scherm-test"},{currentRun:1},{listJobs:async()=>[{...job,steps:[]}]},{mode:"acceptatie-test"}])assert.equal(await check(opts),false)});
test("mislukte run/job/marker en nieuwer falend bewijs",async()=>{for(const opts of [{runs:[{...run,conclusion:"failure"}]},{listJobs:async()=>[{...job,conclusion:"failure"}]},{listJobs:async()=>[{...job,steps:[{...job.steps[0],conclusion:"failure"}]}]},{runs:[run,{...run,id:2,conclusion:"failure"}]}])assert.equal(await check(opts),false)});
test("overgeslagen jobs zijn geen bewijs en verdringen geen geslaagd bewijs",async()=>{assert.equal(await check({listJobs:async()=>[{...job,conclusion:"skipped"}]}),false);assert.equal(await check({runs:[run,{...run,id:2}],listJobs:async id=>id===2?[{...job,conclusion:"skipped"}]:[job]}),true)});
test("gerichte modi hebben eigen bewijs; review-output nooit hergebruiken",async()=>{const j={name:"Gerichte Chrome-schermregressies (Node.js 26)",conclusion:"success",steps:[{name:`PR-bewijs ${base} scherm-test`,conclusion:"success"}]};assert.equal(await check({mode:"scherm-test",listJobs:async()=>[j]}),true);assert.equal(await check({mode:"scherm-review-test",listJobs:async()=>[j]}),false);assert.equal(await check({mode:"scherm-test",listJobs:async()=>[{...j,steps:[{name:`PR-bewijs ${base} scherm-review-test`,conclusion:"success"}]}]}),false)});

import {validProof,mergeCandidate} from "../tools/verifieer_docs_test.mjs";
test("documentatiebewijs vereist werkelijke geslaagde inhoudelijke stap",()=>{
 const j={conclusion:"success",steps:[{name:`Docs-bewijs ${base} docs`,conclusion:"success"},{name:"Roadmap en changelog controleren",conclusion:"success"}]};
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
