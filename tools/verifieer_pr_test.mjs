// D115: uitsluitend bewijs voor exact PR-head, base en testmodus; geen vervanging van integrale acceptatie.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
const individual = ["scherm-flow-test","scherm-formaten-test","scherm-formaten-uitgebreid-test","scherm-meldingen-test","scherm-beheer-test","scherm-productie-test","scherm-planning-test","scherm-sjabloon-test","scherm-engineering-test","scherm-overgang-test"];
function jobFor(mode) {
 if(mode==="compatibiliteit-test") return "Node.js 22-compatibiliteit";
 if(mode==="scherm-test") return "Gerichte Chrome-schermregressies (Node.js 26)";
 if(individual.includes(mode)) return `Individuele Chrome-regressie (${mode})`;
 if(mode==="database-baseline") return "Gerichte PostgreSQL-baseline (D100)";
 if(mode==="laptop-security") return "Gerichte laptoppakketbeveiliging (D24/D100)";
 return null;
}
export async function findEvidence({head,base,mode,currentRun,runs,listJobs}) {
 const name=jobFor(mode);
 if(!name||!/^[a-f0-9]{40}$/.test(head)||!/^[a-f0-9]{40}$/.test(base))return false;
 const acceptable=mode==="compatibiliteit-test"?[mode,"acceptatie-test"]:[mode];
 const marker=m=>`PR-bewijs ${base} ${m}`;
 for(const run of [...runs].sort((a,b)=>Number(b.id)-Number(a.id))){
  if(String(run.id)===String(currentRun)||run.head_sha!==head||run.event!=="pull_request"||run.status!=="completed")continue;
  const jobs=await listJobs(run.id);
  if(!Array.isArray(jobs))return false;
  for(const job of jobs.filter(j=>j.name===name&&j.conclusion!=="skipped")){
   const matches=job.steps?.some(s=>acceptable.some(m=>s.name===marker(m)));
   if(!matches){
    if(mode==="scherm-test"&&job.steps?.some(s=>s.name.startsWith("PR-bewijs ")&&s.name.endsWith(" scherm-review-test")))continue;
    return false;
   }
   if(run.conclusion!=="success"||job.conclusion!=="success"||!job.steps.some(s=>acceptable.some(m=>s.name===marker(m))&&s.conclusion==="success"))return false;
   return true;
  }
 }
 return false;
}
async function main(){
 const [head,base,mode]=process.argv.slice(2);
 const repo=process.env.GITHUB_REPOSITORY;
 if(!repo||!jobFor(mode)||!/^([a-f0-9]{40})$/.test(head??"")||!/^([a-f0-9]{40})$/.test(base??""))throw Error("Ongeldige bewijscontext");
 const git=(...args)=>execFileSync("git",args,{encoding:"utf8"}).trim();
 if(git("rev-parse","HEAD")!==head)throw Error("Verkeerde checkout");
 git("merge-base","--is-ancestor",base,head);
 const gh=path=>JSON.parse(execFileSync("gh",["api",path],{encoding:"utf8"}));
 const runs=gh(`repos/${repo}/actions/workflows/tests.yml/runs?head_sha=${head}&event=pull_request&status=completed&per_page=100`).workflow_runs;
 if(!Array.isArray(runs))throw Error("Geen runbewijs");
 console.log(await findEvidence({head,base,mode,currentRun:process.env.GITHUB_RUN_ID,runs,listJobs:id=>gh(`repos/${repo}/actions/runs/${id}/jobs?per_page=100`).jobs}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);console.log("false")});
