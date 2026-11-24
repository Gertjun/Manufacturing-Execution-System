// Releases voor de Batch input GUI (gebruikt door .github/workflows/release.yml).
//
//   node tools/release.mjs controle <v> → valideer de releaseversie
//   node tools/release.mjs notities <v> → release-notities
// Bestaande tags worden nooit aangeraakt (D19).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim();
const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
const versies = [...changelog.matchAll(/^## (\d+\.\d+\.\d+)\b/gm)].map((m) => m[1]);

const [opdracht, arg] = process.argv.slice(2);

if (opdracht === "controle") {
  if (!/^\d+\.\d+\.\d+$/.test(arg ?? "") || versies[0] !== arg) throw Error("Versie moet de nieuwste versiekop zijn");
  const unreleased = /^## Unreleased[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(changelog);
  if (unreleased && unreleased[1].trim()) throw Error("Verplaats alle Unreleased-wijzigingen naar de releaseversie");
} else if (opdracht === "notities") {
  const m = new RegExp(`^## ${arg.replace(/\./g, "\\.")}\\b.*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m").exec(changelog);
  if (!m) throw new Error(`Versie ${arg} staat niet in CHANGELOG.md`);
  process.stdout.write(m[1].trim() + "\n\nAlle gegevens in deze versie zijn fictief.\n");
} else {
  console.error("Gebruik: node tools/release.mjs controle <versie> | notities <versie>");
  process.exit(1);
}
