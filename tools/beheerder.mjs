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

// Geen automatische bootstrap op een bestaande database, ook niet als alle accounts uit staan.
export async function eersteBeheerder(c, io) {
  const { rows: [r] } = await c.query("SELECT count(*)::int AS n FROM fabriek.gebruiker");
  if (r.n > 0) return false;
  console.log("Lege identiteitsadministratie: gecontroleerde MES-bootstrap vereist.");
  console.log("De drie verschillende accounthouders kiezen persoonlijk hun eigen wachtwoord.");
  const reason = await io.vraag("Reden en referentie van de goedgekeurde inrichting: ");
  if (!reason) throw new Error("Bootstrap afgebroken: reden vereist.");
  const values = [];
  for (const label of ["System Administrator", "Security Administrator A", "Security Administrator B"]) {
    const name = (await io.vraag(label + " gebruikersnaam: ")).toLowerCase();
    if (!NAAM.test(name)) throw new Error("Ongeldige gebruikersnaam; niets gewijzigd.");
    values.push(name, await kiesWachtwoord(io));
  }
  await metLogboek(c, "gecontroleerde MES-bootstrap", () =>
    c.query("SELECT fabriek.authorization_bootstrap_empty($1,$2,$3,$4,$5,$6,$7)", [...values, reason]));
  console.log("MES-bootstrap voltooid; drie afzonderlijke beheeridentiteiten ingericht.");
  return true;
}

export async function beheerderMenu(c, io) {
  if (await eersteBeheerder(c, io)) return;
  console.log("Oude noodsleutel uitgeschakeld. Alleen herstel-diagnose; geen accounts worden gewijzigd.");
  const name = (await io.vraag("Gebruikersnaam voor herstel-diagnose (Enter = stoppen): ")).toLowerCase();
  if (!name) return;
  const { rows: [target] } = await c.query("SELECT id,actief,gedeeld FROM fabriek.gebruiker WHERE lower(gebruikersnaam)=$1",[name]);
  if (!target || !target.actief || target.gedeeld) {
    console.log("Geen actief persoonlijk doelaccount; afzonderlijke beoordeling vereist.");
    return;
  }
  const { rows: [status] } = await c.query("SELECT * FROM fabriek.authorization_recovery_readiness($1)",[target.id]);
  console.log("Technisch bevoegde onafhankelijke paren: " + status.independent_pairs);
  if (Number(status.independent_pairs) === 0) {
    console.log("Regulier herstel niet mogelijk. Escaleer naar organisatieverantwoordelijke en IT volgens het noodherstelprotocol.");
  } else {
    console.log("Regulier herstel kan mogelijk zijn. Controleer daadwerkelijke beschikbaarheid en persoonlijke identiteit.");
  }
  console.log("Er is niets gewijzigd.");
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
