// Eerste beheerder aanmaken, of een beheerder een nieuw wachtwoord geven ("noodsleutel").
// Werkt alleen op de computer met de database zelf; elke wijziging komt in het logboek.
//
//   node tools/beheerder.mjs [--instellingen <pad>]
//
// Is er nog geen actieve beheerder, dan vraagt hij meteen om de eerste. Anders kies je:
// een bestaande beheerder een nieuw wachtwoord geven (en weer aanzetten), of een nieuwe beheerder.
// Het laptoppakket gebruikt dezelfde functies (opstarten.mjs, BEHEERDER HERSTELLEN.bat).

import readline from "node:readline";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const NAAM = /^[a-z0-9._-]{3,40}$/;
const MIN_WACHTWOORD = 8;

/** Vragen in het venster. Wachtwoorden worden niet getoond (sterretjes) als het een echt venster is. */
export function maakInvoer() {
  const tty = !!process.stdin.isTTY;
  let rl = null;
  let regels = null;
  const regel = async () => {
    if (!rl) {
      rl = readline.createInterface({ input: process.stdin, terminal: false });
      regels = rl[Symbol.asyncIterator]();
    }
    const { value, done } = await regels.next();
    if (done) throw new Error("Invoer afgebroken.");
    return value.trim();
  };
  const vraag = async (tekst) => {
    process.stdout.write(tekst);
    return regel();
  };
  const wachtwoord = async (tekst) => {
    if (!tty) return vraag(tekst);
    if (rl) { rl.close(); rl = null; regels = null; }
    process.stdout.write(tekst);
    return new Promise((klaar, fout) => {
      let w = "";
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding("utf8");
      const op = (s) => {
        for (const t of s) {
          if (t === "\r" || t === "\n") {
            process.stdin.setRawMode(false);
            process.stdin.pause();
            process.stdin.off("data", op);
            process.stdout.write("\n");
            return klaar(w);
          }
          if (t === "\u0003") { process.stdin.setRawMode(false); process.stdout.write("\n"); return fout(new Error("Afgebroken.")); }
          if (t === "\u0008" || t === "\u007f") { if (w.length) { w = w.slice(0, -1); process.stdout.write("\b \b"); } continue; }
          if (t >= " ") { w += t; process.stdout.write("*"); }
        }
      };
      process.stdin.on("data", op);
    });
  };
  const sluit = () => { rl?.close(); };
  return { vraag, wachtwoord, sluit };
}

async function kiesWachtwoord(io) {
  for (;;) {
    const w1 = await io.wachtwoord(`Wachtwoord (minstens ${MIN_WACHTWOORD} tekens): `);
    if (w1.length < MIN_WACHTWOORD) { console.log(`Te kort; gebruik minstens ${MIN_WACHTWOORD} tekens.`); continue; }
    const w2 = await io.wachtwoord("Nog een keer, ter controle: ");
    if (w1 !== w2) { console.log("De twee wachtwoorden zijn niet gelijk; probeer opnieuw."); continue; }
    return w1;
  }
}

async function metLogboek(c, door, fn) {
  await c.query("BEGIN");
  try {
    await c.query("SELECT set_config('fabriek.gebruiker', $1, true)", [door]);
    await fn();
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  }
}

export async function aantalBeheerders(c) {
  const { rows } = await c.query("SELECT count(*)::int AS n FROM fabriek.gebruiker WHERE rol = 'beheerder' AND actief");
  return rows[0].n;
}

async function nieuweBeheerder(c, io, door) {
  let naam;
  for (;;) {
    naam = (await io.vraag("Gebruikersnaam (kleine letters, cijfers, punt, streepje; bijv. geert): ")).toLowerCase();
    if (!NAAM.test(naam)) { console.log("Gebruik 3 tot 40 tekens: a-z, 0-9, punt, liggend streepje of streepje."); continue; }
    const { rowCount } = await c.query("SELECT 1 FROM fabriek.gebruiker WHERE gebruikersnaam = $1", [naam]);
    if (rowCount) { console.log("Die gebruikersnaam bestaat al. Kies een andere, of geef die gebruiker een nieuw wachtwoord."); continue; }
    break;
  }
  const w = await kiesWachtwoord(io);
  await metLogboek(c, door, () =>
    c.query("INSERT INTO fabriek.gebruiker (gebruikersnaam, rol, wachtwoord_hash) VALUES ($1, 'beheerder', fabriek.wachtwoord_hash($2))", [naam, w]),
  );
  console.log(`\nBeheerder ${naam} is aangemaakt. Log in op Portaal Beheer met deze gebruikersnaam en dit wachtwoord.\n`);
  return naam;
}

/** Vraagt om de eerste beheerder als er nog geen actieve beheerder is. Geeft true als er één is aangemaakt. */
export async function eersteBeheerder(c, io) {
  if ((await aantalBeheerders(c)) > 0) return false;
  console.log("\nEr is nog geen beheerder. Maak nu de eerste beheerder aan; daarmee richt je in Portaal Beheer");
  console.log("de rest in (accounts, operators, pc's, stappen en velden).\n");
  await nieuweBeheerder(c, io, "eerste start (op de computer zelf)");
  return true;
}

/** Noodsleutel: bestaande beheerder een nieuw wachtwoord geven, of een nieuwe beheerder aanmaken. */
export async function beheerderMenu(c, io) {
  if (await eersteBeheerder(c, io)) return;
  const { rows } = await c.query("SELECT id, gebruikersnaam, actief FROM fabriek.gebruiker WHERE rol = 'beheerder' ORDER BY gebruikersnaam");
  console.log("\nBeheerders:");
  rows.forEach((r, i) => console.log(`  ${i + 1}. ${r.gebruikersnaam}${r.actief ? "" : "  (uitgezet)"}`));
  console.log(`  ${rows.length + 1}. Nieuwe beheerder aanmaken`);
  const keuze = Number(await io.vraag("\nKies een nummer (Enter = niets doen): "));
  if (!keuze) { console.log("Er is niets veranderd.\n"); return; }
  if (keuze === rows.length + 1) { await nieuweBeheerder(c, io, "noodsleutel (op de computer zelf)"); return; }
  const g = rows[keuze - 1];
  if (!g) { console.log("Onbekend nummer; er is niets veranderd.\n"); return; }
  console.log(`Nieuw wachtwoord voor ${g.gebruikersnaam}:`);
  const w = await kiesWachtwoord(io);
  await metLogboek(c, "noodsleutel (op de computer zelf)", () =>
    c.query("UPDATE fabriek.gebruiker SET wachtwoord_hash = fabriek.wachtwoord_hash($2), actief = true WHERE id = $1", [g.id, w]),
  );
  console.log(`\nHet wachtwoord van ${g.gebruikersnaam} is gewijzigd${g.actief ? "" : " en het account staat weer aan"}. Dit staat in het logboek.\n`);
}

// Los gestart: node tools/beheerder.mjs
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { argumenten, leesInstellingen, stop, verbind } = await import("./lib.mjs");
  const { opties } = argumenten();
  const inst = leesInstellingen(opties);
  const c = await verbind(inst.beheerDb);
  const io = maakInvoer();
  try {
    await beheerderMenu(c, io);
  } catch (e) {
    stop(e.message);
  } finally {
    io.sluit();
    await c.end();
  }
}
