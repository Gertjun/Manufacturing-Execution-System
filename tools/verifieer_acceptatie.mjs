// Bepaal of exact deze git-tree al beide suites heeft doorstaan.
// Alleen runs van deze Tests-workflow met expliciete checkout van de head tellen mee.
import { execFileSync } from "node:child_process";
const gh = (path) => JSON.parse(execFileSync("gh", ["api", path], { encoding: "utf8" }));
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const repo = process.env.GITHUB_REPOSITORY;
const target = process.argv[2];
if (!repo || !/^[0-9a-f]{40}$/.test(target ?? "")) throw Error("repository of commit ontbreekt");
const tree = git("rev-parse", target + "^{tree}");
const candidates = new Set([target, ...git("show", "-s", "--format=%P", target).split(" ").filter(Boolean)]);
const required = ["Node.js 22-compatibiliteit", "Volledige testsuite (Node.js 26)"];
for (const sha of candidates) {
  if (git("rev-parse", sha + "^{tree}") !== tree) continue;
  const runs = gh(`repos/${repo}/actions/workflows/tests.yml/runs?head_sha=${sha}&status=success&per_page=100`).workflow_runs;
  const found = new Set();
  for (const run of runs) {
    if (!["push", "pull_request"].includes(run.event) || run.head_sha !== sha) continue;
    const jobs = gh(`repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`).jobs;
    for (const job of jobs) {
      if (job.conclusion !== "success" || !required.includes(job.name)) continue;
      // Dit expliciete, geslaagde checkout-bewijs bestaat pas sinds de nieuwe werkwijze.
      if (!job.steps?.some(s => s.name === "Geteste tree vastleggen" && s.conclusion === "success")) continue;
      found.add(job.name);
    }
    if (required.every(n => found.has(n))) {
      console.log("true"); process.exit(0);
    }
  }
}
console.log("false");
