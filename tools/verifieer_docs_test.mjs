// D115: exact bewijs voor documentatie en schema; mergecontext blijft afzonderlijk gecontroleerd.
import {execFileSync} from "node:child_process";
import {pathToFileURL} from "node:url";
import {newestValid,completeList,latestAttempt} from "./ci_evidence.mjs";
export function validProof({run,job,head,base,step,mode}){
 return latestAttempt(run) && run.head_sha===head && run.event==="pull_request" && run.status==="completed" && run.conclusion==="success" &&
 job.conclusion==="success" && job.steps?.some(s=>s.name===`Docs-bewijs ${base} ${mode}` && s.conclusion==="success") &&
 job.steps?.some(s=>s.name===step && s.conclusion==="success");
}
export function mergeCandidate({parents,base,tree,parentTree}){
 return parents.length===2 && parents[0]===base && tree===parentTree ? parents[1] : null;
}
// Een latere werkelijk uitgevoerde mislukking in een andere workflow blokkeert ook hergebruik.
export function latestProof({attempts,head,base,mode}){
 const relevant=attempts.filter(({run,job,step})=>run.head_sha===head&&run.event==="pull_request"&&job.conclusion!=="skipped"&&(job.conclusion!=="success"||job.steps?.some(s=>s.name===step&&s.conclusion!=="skipped")));
 return newestValid(relevant,a=>validProof({...a,head,base,mode}));
}
async function main(){
 const [event,target,base,mode]=process.argv.slice(2);
 const repo=process.env.GITHUB_REPOSITORY;
 const git=(...args)=>execFileSync("git",args,{encoding:"utf8"}).trim();
 const gh=path=>JSON.parse(execFileSync("gh",["api",path],{encoding:"utf8"}));
 if(!repo||!["push","pull_request"].includes(event)||!["docs","schema"].includes(mode)||![target,base].every(s=>/^[a-f0-9]{40}$/.test(s??""))||git("rev-parse","HEAD")!==target)throw Error("Ongeldige context");
 let head=target;
 if(event==="push"){
  const parents=git("show","-s","--format=%P",target).split(" ");
  if(parents.length!==2){console.log(false);return;}
  head=mergeCandidate({parents,base,tree:git("rev-parse",target+"^{tree}"),parentTree:git("rev-parse",parents[1]+"^{tree}")});
  if(!head){console.log(false);return;}
 }
 git("merge-base","--is-ancestor",base,head);
 const sources=mode==="docs"?[["documentatie.yml","Documentatieconsistentie","Roadmap en changelog controleren"]]:[["documentatie.yml","Databasediagram controleren","Databasediagram vergelijken met schema"],["diagrammen.yml","Databasediagram bij gerichte diagramcontrole","Databasediagram vergelijken met schema"],["tests.yml","Volledige testsuite (Node.js 26)","Plaatje van de database bij (docs/DATABASE.md)"]];
 const attempts=[];
 for(const [workflow,name,step] of sources){
  const runs=completeList(gh(`repos/${repo}/actions/workflows/${workflow}/runs?head_sha=${head}&event=pull_request&status=completed&per_page=100`),"workflow_runs");
  if(!Array.isArray(runs))throw Error("Geen runbewijs");
  for(const run of runs){
   if(String(run.id)===process.env.GITHUB_RUN_ID||run.head_sha!==head)continue;
   const jobs=completeList(gh(`repos/${repo}/actions/runs/${run.id}/jobs?filter=all&per_page=100`),"jobs");
   if(!Array.isArray(jobs))throw Error("Geen jobbewijs");
   for(const job of jobs.filter(j=>j.name===name&&j.conclusion!=="skipped")) attempts.push({run,job,step});
  }
 }
 console.log(latestProof({attempts,head,base,mode}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);console.log(false)});
