// Releases voor de Batch input GUI (gebruikt door .github/workflows/release.yml).
//
//   node tools/release.mjs ontbrekend   → per regel "<versie> <commit>" voor elke versie uit
//                                         CHANGELOG.md die nog geen tag heeft
//   node tools/release.mjs notities <v> → de tekst van versie <v> uit CHANGELOG.md
//
// De commit van een versie is de laatste commit waarin het bestand VERSIE die versie bevatte.
// Bestaande tags worden nooit aangeraakt (D19).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim();
const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
const versies = [...changelog.matchAll(/^## (\d+\.\d+\.\d+)\b/gm)].map((m) => m[1]);

const [opdracht, arg] = process.argv.slice(2);

if (opdracht === "ontbrekend") {
  const tags = new Set(git("tag", "--list", "v*").split("\n").filter(Boolean));
  const commits = git("log", "--format=%H", "main", "--", "VERSIE").split("\n").filter(Boolean);
  const versieVan = new Map(); // versie -> nieuwste commit met die waarde
  for (const c of commits) {
    let v;
    try { v = git("show", `${c}:VERSIE`).trim(); } catch { continue; }
    if (!versieVan.has(v)) versieVan.set(v, c);
  }
  // VERSIE kan in een commit zijn gezet en in latere commits ongewijzigd zijn gebleven:
  // neem dan de laatste commit vóór de volgende versiewijziging.
  const opMain = git("rev-list", "main").split("\n");
  for (const v of versies.slice().reverse()) {
    if (tags.has(`v${v}`) || !versieVan.has(v)) continue;
    const start = versieVan.get(v);
    let laatste = start;
    for (const c of opMain) {
      if (c === start) break;
      let w;
      try { w = git("show", `${c}:VERSIE`).trim(); } catch { continue; }
      if (w === v) { laatste = c; break; }
    }
    console.log(`${v} ${laatste}`);
  }
} else if (opdracht === "notities") {
  const m = new RegExp(`^## ${arg.replace(/\./g, "\\.")}\\b.*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m").exec(changelog);
  if (!m) throw new Error(`Versie ${arg} staat niet in CHANGELOG.md`);
  process.stdout.write(m[1].trim() + "\n\nAlle gegevens in deze versie zijn fictief.\n");
} else {
  console.error("Gebruik: node tools/release.mjs ontbrekend | notities <versie>");
  process.exit(1);
}
