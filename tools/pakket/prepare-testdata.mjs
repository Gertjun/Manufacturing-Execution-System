// Past de historische fictieve testdump aan op de verplichte lotgroottekolommen uit migratie 0037.
// De dump is bewust ouder dan de actuele schema.sql; alle bestaande demo-lots zijn met vier batches gemaakt.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function pasTestdataAan(sql) {
  const marker = "-- Data for Name: lot;";
  const start = sql.indexOf(marker);
  const end = sql.indexOf("-- Data for Name:", start + marker.length);
  if (start < 0 || end < 0) throw new Error("Testdata bevat geen herkenbaar lot-blok");
  let blok = sql.slice(start, end);
  const oud = "INSERT INTO fabriek.lot VALUES";
  if (!blok.includes(oud)) {
    if (blok.includes("batch_aantal_norm")) return sql; // al bijgewerkt
    throw new Error("Lot-insert in testdata heeft een onverwacht formaat");
  }
  blok = blok.replace(oud,
    "INSERT INTO fabriek.lot (id, lotnummer, status, aangemaakt_op, batch_aantal_norm, batch_aantal, afwijking_reden) VALUES");
  let aantal = 0;
  blok = blok.replace(/^(\\s*\\('[0-9a-f-]{36}',\\s*'L-[^']+',\\s*'[^']+',\\s*'[^']+'\\))([,;])$/gm,
    (_regel, waarden, einde) => { aantal++; return `${waarden}, 4, 4, NULL)${einde}`; });
  if (aantal === 0) throw new Error("Geen historische lotregels gevonden in testdata");
  return sql.slice(0, start) + blok + sql.slice(end);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const pad = process.argv[2];
  if (!pad) throw new Error("Gebruik: node prepare-testdata.mjs <testdata.sql>");
  const origineel = readFileSync(pad, "utf8");
  const aangepast = pasTestdataAan(origineel);
  writeFileSync(pad, aangepast);
  console.log("Historische lotregels aangevuld met norm en werkelijk aantal (4).");
}
