// Back-up van de database (beheerder). Elk uur inplannen, zie docs/SERVER.md.
//
//   node tools/backup.mjs                 back-up maken en oude back-ups opruimen
//   node tools/backup.mjs --niet-opruimen alleen een back-up maken
//   --instellingen <pad>                  ander instellingenbestand
//
// Het bestand komt in backupMap (instelling) als batchgui_<datum_tijd>_v<versie>.dump
// (pg_dump, eigen formaat). Opruimen volgt tools/rotatie.mjs: 48 uur, 30 dagen, 12 maanden.
// Het resultaat staat in fabriek.onderhoud_log en is te zien in Portaal Beheer → Server.

import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { argumenten, leesInstellingen, logOnderhoud, pgProgramma, stop, tijdstempel, verbind, verbindingArgs, VERSIE, voerUit } from "./lib.mjs";
import { teBewaren } from "./rotatie.mjs";

const PATROON = /^batchgui_.*\.dump$/;

const { opties } = argumenten();
const inst = leesInstellingen(opties);
if (!inst.backupMap) stop("Zet backupMap in de instellingen (de map voor back-ups).");
const map = resolve(inst.backupMap);
mkdirSync(map, { recursive: true });

const start = new Date();
const naam = `batchgui_${tijdstempel(start)}_v${VERSIE}.dump`;
const doel = join(map, naam);
const tijdelijk = doel + ".bezig";

const r = await voerUit(pgProgramma(inst, "pg_dump"), [...verbindingArgs(inst.beheerDb), "-Fc", "-f", tijdelijk], inst.beheerDb);
if (r.code !== 0) {
  rmSync(tijdelijk, { force: true });
  await logOnderhoud(inst, { soort: "backup", gestart_op: start, gelukt: false, bestand: naam, melding: r.uitvoer.slice(0, 500) });
  stop(`Back-up mislukt:\n${r.uitvoer}`);
}
renameSync(tijdelijk, doel);
const grootte = statSync(doel).size;

let opgeruimd = 0;
if (!opties["niet-opruimen"]) {
  const bestanden = readdirSync(map)
    .filter((f) => PATROON.test(f))
    .map((f) => ({ naam: f, tijd: statSync(join(map, f)).mtime }));
  const blijft = teBewaren(bestanden);
  for (const b of bestanden) {
    if (!blijft.has(b.naam)) {
      rmSync(join(map, b.naam));
      opgeruimd++;
    }
  }
}

// Inlogpogingen ouder dan 90 dagen opruimen (sinds 0.22.2; op een oudere database bestaat de functie nog niet).
let pogingen = 0;
if (!opties["niet-opruimen"]) {
  const c = await verbind(inst.beheerDb);
  try {
    const { rows } = await c.query(
      "SELECT CASE WHEN to_regprocedure('fabriek.ruim_inlogpogingen_op(integer)') IS NULL THEN 0 ELSE fabriek.ruim_inlogpogingen_op() END AS n");
    pogingen = rows[0].n;
  } catch (e) {
    console.log(`Let op: oude inlogpogingen opruimen lukte niet: ${e.message}`);
  } finally {
    await c.end();
  }
}

const opmerkingen = [opgeruimd ? `${opgeruimd} oude back-up(s) opgeruimd` : "", pogingen ? `${pogingen} oude inlogpoging(en) opgeruimd` : ""].filter(Boolean);
await logOnderhoud(inst, {
  soort: "backup",
  gestart_op: start,
  gelukt: true,
  bestand: naam,
  grootte_bytes: grootte,
  melding: opmerkingen.length ? opmerkingen.join("; ") : null,
});
console.log(`Back-up gemaakt: ${doel} (${(grootte / 1024).toFixed(0)} kB)${opgeruimd ? `, ${opgeruimd} oude opgeruimd` : ""}${pogingen ? `, ${pogingen} oude inlogpogingen opgeruimd` : ""}.`);
