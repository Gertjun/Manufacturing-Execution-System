// D115: exact dezelfde tree en beide suites; geen terugval op ouder groen bewijs.
import {execFileSync} from "node:child_process";
import {pathToFileURL} from "node:url";
import {newestValid,completeList,latestAttempt} from "./ci_evidence.mjs";
const required=["Node.js 22-compatibiliteit","Volledige testsuite (Node.js 26)"];
export function acceptanceProof(attempts) {
  return required.every(name=>newestValid(
    attempts.filter(({job})=>job.name===name&&job.conclusion!=="skipped"),
    ({run,job})=>latestAttempt(run)&&run.status==="completed"&&run.conclusion==="success"&&job.conclusion==="success"&&
      job.steps?.some(s=>s.name==="Geteste tree vastleggen"&&s.conclusion==="success")&&
      (name!==required[1]||job.steps?.some(s=>s.name==="Plaatje van de database bij (docs/DATABASE.md)"&&s.conclusion==="success"))
  ));
}
export function diagramProof(attempts) {
  return newestValid(attempts.filter(({job})=>job.name==="Diagrammen voor technische acceptatie"&&job.conclusion!=="skipped"),
    ({run,job})=>latestAttempt(run)&&run.status==="completed"&&run.conclusion==="success"&&job.conclusion==="success"&&
      ["Geteste commit en roadmap-SVG vastleggen","Genereer technische diagrammen en controleer gepubliceerde SVG’s"].every(name=>job.steps?.some(s=>s.name===name&&s.conclusion==="success")));
}
function main() {
  const gh=path=>JSON.parse(execFileSync("gh",["api",path],{encoding:"utf8"}));
  const git=(...args)=>execFileSync("git",args,{encoding:"utf8"}).trim();
  const repo=process.env.GITHUB_REPOSITORY,target=process.argv[2];
  if(!repo||!/^[a-f0-9]{40}$/.test(target??"")||git("rev-parse","HEAD")!==target)throw Error("Ongeldige bewijscontext");
  const tree=git("rev-parse",target+"^{tree}");
  const candidates=new Set([target,...git("show","-s","--format=%P",target).split(" ").filter(Boolean)]);
  const attempts=[],diagrams=[];
  const requireDiagrams=process.argv.includes("--require-diagrams");
  for(const sha of candidates){
    if(git("rev-parse",sha+"^{tree}")!==tree)continue;
    const runs=completeList(gh(`repos/${repo}/actions/workflows/tests.yml/runs?head_sha=${sha}&status=completed&per_page=100`),"workflow_runs");
    for(const run of runs){
      if(String(run.id)===process.env.GITHUB_RUN_ID||!["push","pull_request"].includes(run.event)||run.head_sha!==sha)continue;
      const jobs=completeList(gh(`repos/${repo}/actions/runs/${run.id}/jobs?filter=all&per_page=100`),"jobs");
      for(const job of jobs)if(required.includes(job.name)&&job.conclusion!=="skipped")attempts.push({run,job});
    }
    if(requireDiagrams){
      const runs=completeList(gh(`repos/${repo}/actions/workflows/diagrammen.yml/runs?head_sha=${sha}&status=completed&per_page=100`),"workflow_runs");
      for(const run of runs){
        if(run.event!=="pull_request"||run.head_sha!==sha)continue;
        const jobs=completeList(gh(`repos/${repo}/actions/runs/${run.id}/jobs?filter=all&per_page=100`),"jobs");
        for(const job of jobs)if(job.name==="Diagrammen voor technische acceptatie"&&job.conclusion!=="skipped")diagrams.push({run,job});
      }
    }
  }
  console.log(acceptanceProof(attempts)&&(!requireDiagrams||diagramProof(diagrams)));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{main()}catch(e){console.error(e.message);console.log(false)}
}
