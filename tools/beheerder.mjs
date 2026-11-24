// Gecontroleerde MES-bootstrap of alleen-lezen hersteldiagnose.
// Bootstrap uitsluitend bij een lege identiteitsadministratie.
// De oude noodsleutel is geblokkeerd; --herstel-account vereist persoonlijke bevestiging.
//
//   node tools/beheerder.mjs [--instellingen <pad>]
//
// Het laptoppakket gebruikt dezelfde functies (opstarten.mjs).

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

// Alleen via een expliciete interactieve eigenaarssessie. De DB controleert
// bevoegdheden en onafhankelijkheid opnieuw, onder lock, bij uitvoering.
export async function herstelAccount(c, io) {
  const zoek = async (label) => {
    const name = (await io.vraag(label)).toLowerCase();
    if (!NAAM.test(name)) throw new Error("Ongeldige gebruikersnaam.");
    const { rows: [r] } = await c.query(
      "SELECT id FROM fabriek.gebruiker WHERE lower(gebruikersnaam)=$1 AND actief AND NOT gedeeld", [name]);
    if (!r) throw new Error("Geen actief persoonlijk account.");
    return { id: r.id, name };
  };
  const target = await zoek("Doelaccount: ");
  const { rows: [status] } = await c.query("SELECT * FROM fabriek.authorization_recovery_readiness($1)", [target.id]);
  if (Number(status.independent_pairs) === 0) throw new Error("Geen onafhankelijk bevoegd paar; volg het noodherstelprotocol.");
  const requester = await zoek("Persoonlijke aanvrager: ");
  const approver = await zoek("Onafhankelijke beoordelaar: ");
  if (new Set([target.id, requester.id, approver.id]).size !== 3)
    throw new Error("Drie verschillende persoonlijke identiteiten vereist.");
  const reason = await io.vraag("Reden en goedkeuringsreferentie: ");
  if (!reason.trim()) throw new Error("Reden vereist.");
  console.log("Herstel van " + target.name + " door " + requester.name + " en " + approver.name + ".");
  if (await io.vraag("Typ HERSTEL om deze concrete handeling te bevestigen: ") !== "HERSTEL") {
    console.log("Afgebroken; er is niets gewijzigd.");
    return false;
  }
  const a = await io.wachtwoord("Aanvrager, bevestig persoonlijk uw MES-wachtwoord: ");
  const b = await io.wachtwoord("Beoordelaar, bevestig persoonlijk uw MES-wachtwoord: ");
  console.log("Doelaccounthouder: kies persoonlijk een tijdelijk wachtwoord.");
  const temporary = await kiesWachtwoord(io);
  // Autocommit is bewust: mislukte bevestigingen moeten in de loginhistorie blijven.
  // Geen queryparameters of DB-foutdetails met mogelijke credentials tonen.
  let result;
  try {
    ({ rows: [result] } = await c.query(
      "SELECT fabriek.authorization_recover_confirmed($1,$2,$3,$4,$5,$6,$7) AS status",
      [target.id, requester.id, approver.id, reason, a, b, temporary]));
  } catch {
    throw new Error("Herstel geweigerd of technische fout; controleer de status voordat u opnieuw probeert.");
  }
  if (result?.status !== "recovered") {
    console.log("Herstel niet uitgevoerd; persoonlijke bevestiging geweigerd of tijdelijk geblokkeerd.");
    return false;
  }
  console.log("Gecontroleerd herstel voltooid. De accounthouder moet het tijdelijke wachtwoord wijzigen.");
  return true;
}

// IT registreert uitsluitend een vooraf ingerichte, afzonderlijk goedgekeurde login.
// Geen CREATE ROLE, wachtwoordreset, roltoekenning of automatische herbinding.
export async function securityBinding(c, io, intrekken) {
  const role = (await io.vraag("Persoonlijke PostgreSQL-rolnaam: ")).trim();
  if (!/^[a-zA-Z0-9_.-]{1,63}$/.test(role)) throw new Error("Ongeldige rolnaam.");
  let target;
  if (!intrekken) {
    const name = (await io.vraag("Persoonlijk MES-doelaccount: ")).toLowerCase();
    if (!NAAM.test(name)) throw new Error("Ongeldige gebruikersnaam.");
    const { rows: [r] } = await c.query(
      "SELECT id FROM fabriek.gebruiker WHERE lower(gebruikersnaam)=$1 AND actief AND NOT gedeeld AND NOT wachtwoord_wijzigen", [name]);
    if (!r) throw new Error("Geen geschikt persoonlijk MES-account.");
    target = r.id;
    console.log("Voorgenomen binding: " + role + " -> " + name + " (" + target + ").");
    console.log("IT moet afzonderlijk de effectieve objectprivileges, persoonlijke authenticatie en TLS hebben gecontroleerd.");
  } else {
    console.log("Voorgenomen intrekking van binding voor " + role + ". Historie blijft behouden.");
  }
  const reason = (await io.vraag("Reden en goedkeuringsreferentie: ")).trim();
  if (!reason) throw new Error("Reden vereist.");
  if (await io.vraag("Typ BEVESTIG om deze handeling uit te voeren: ") !== "BEVESTIG") return false;
  const sql = intrekken
    ? "SELECT fabriek.authorization_channel_unbind($1::name,$2::text) AS oid"
    : "SELECT fabriek.authorization_channel_bind($1::name,$2::uuid,$3::text) AS oid";
  const { rows: [result] } = await c.query(sql, intrekken ? [role, reason] : [role, target, reason]);
  if (result?.oid == null) throw new Error("Geen bevestigd bindingsresultaat.");
  console.log(intrekken ? "Binding ingetrokken. IT moet de database-login afzonderlijk buiten gebruik stellen." : "Binding geregistreerd. Geen MES-grants gewijzigd.");
  return true;
}

// Eerste personeelskoppeling: eigenaar faciliteert; DB vereist twee bevoegde
// persoonlijke bevestigingen. De organisatie verifieert de werkelijke identiteit.
export async function koppelPersoneel(c, io) {
  const id = (await io.vraag("Personeels-UUID: ")).trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    throw new Error("Ongeldige personeels-UUID.");
  const { rows: [person] } = await c.query(
    "SELECT id,naam FROM fabriek.operator WHERE id=$1 AND actief AND gebruiker_id IS NULL", [id]);
  if (!person) throw new Error("Geen actieve ongekoppelde personeelsidentiteit.");
  const zoek = async (label) => {
    const name = (await io.vraag(label)).toLowerCase();
    if (!NAAM.test(name)) throw new Error("Ongeldige gebruikersnaam.");
    const { rows: [r] } = await c.query(
      "SELECT id,gebruikersnaam FROM fabriek.gebruiker WHERE lower(gebruikersnaam)=$1 AND actief AND NOT gedeeld AND NOT wachtwoord_wijzigen", [name]);
    if (!r) throw new Error("Geen geschikt persoonlijk account.");
    return r;
  };
  const target = await zoek("Doelaccount: ");
  const manager = await zoek("Personeelsbeheerder: ");
  const security = await zoek("Onafhankelijke securitybeoordelaar: ");
  if (new Set([target.id,manager.id,security.id]).size !== 3)
    throw new Error("Drie verschillende persoonlijke identiteiten vereist.");
  const reason = (await io.vraag("Reden en referentie van geverifieerde identiteitscontrole: ")).trim();
  if (!reason) throw new Error("Reden vereist.");
  console.log(JSON.stringify({ personeel: person, doelaccount: target, aanvrager: manager, beoordelaar: security, reason }));
  if (await io.vraag("Typ KOPPEL als de identiteit is gecontroleerd en beide personen instemmen: ") !== "KOPPEL") return false;
  const a = await io.wachtwoord("Personeelsbeheerder, bevestig persoonlijk uw MES-wachtwoord: ");
  const b = await io.wachtwoord("Securitybeoordelaar, bevestig persoonlijk uw MES-wachtwoord: ");
  let result;
  try {
    ({ rows: [result] } = await c.query(
      "SELECT fabriek.authorization_link_personnel_confirmed($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::text,$7::text) AS status",
      [person.id,target.id,manager.id,security.id,reason,a,b]));
  } catch {
    throw new Error("Koppeling geweigerd of technische fout; controleer de actuele status voordat u opnieuw probeert.");
  }
  if (result?.status !== "linked") {
    console.log("Koppeling niet uitgevoerd; persoonlijke bevestiging geweigerd of tijdelijk geblokkeerd.");
    return false;
  }
  console.log("Personeelskoppeling geregistreerd. Geen MES-grants gewijzigd.");
  return true;
}

// Los gestart: node tools/beheerder.mjs
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { argumenten, leesInstellingen, stop, verbind } = await import("./lib.mjs");
  const { opties } = argumenten();
  const acties = ['herstel-account', 'security-binden', 'security-intrekken', 'personeel-koppelen'].filter(a => opties[a]);
  if (acties.length > 1) stop('Kies precies één beheerdershandeling.');
  if (acties.length && (!process.stdin.isTTY || !process.stdout.isTTY)) stop('Deze beheerdershandeling vereist een persoonlijk interactief terminalvenster.');
  const inst = leesInstellingen(opties);
  const c = await verbind(inst.beheerDb);
  const io = maakInvoer();
  try {
    if (opties['herstel-account']) {
      if (!await herstelAccount(c, io)) process.exitCode = 1;
    } else if (opties['security-binden'] || opties['security-intrekken']) {
      if (!await securityBinding(c, io, !!opties['security-intrekken'])) process.exitCode = 1;
    } else if (opties['personeel-koppelen']) {
      if (!await koppelPersoneel(c, io)) process.exitCode = 1;
    } else await beheerderMenu(c, io);
  } catch (e) {
    stop(e.message);
  } finally {
    io.sluit();
    await c.end();
  }
}
