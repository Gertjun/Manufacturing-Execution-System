// Persoonlijke MES-securitybediening. Geen eigenaarverbinding of vrije actor-ID.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { maakInvoer } from "./beheerder.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tijd = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;
export async function securityActie(c, io, actie, toon = console.log) {
  const required = async (label) => {
    const v = (await io.vraag(label)).trim();
    if (!v) throw new Error("Verplicht veld ontbreekt.");
    return v;
  };
  const uuid = async (label, optional = false) => {
    const v = (await io.vraag(label)).trim();
    if (!v && optional) return null;
    if (!UUID.test(v)) throw new Error("Ongeldige UUID.");
    return v;
  };
  const datum = async (label, optional = false) => {
    const v = (await io.vraag(label)).trim();
    if (!v && optional) return null;
    if (!tijd.test(v) || !Number.isFinite(Date.parse(v))) throw new Error("Datum/tijd met expliciete tijdzone vereist.");
    return v;
  };
  if (actie === "aanvragen" || actie === "grants") {
    const sql = actie === "aanvragen"
      ? "SELECT * FROM fabriek.authorization_channel_requests()"
      : "SELECT * FROM fabriek.authorization_channel_grants()";
    toon(JSON.stringify((await c.query(sql)).rows, null, 2));
    return true;
  }
  let sql, params;
  if (actie === "aanvragen-indienen") {
    const target = await uuid("UUID doelaccount: ");
    const role = await required("MES-rolcode: ");
    const area = (await io.vraag("Area-code (leeg = geen beperking): ")).trim() || null;
    const product = await uuid("Product-UUID (leeg = geen beperking): ", true);
    const equipment = (await io.vraag("Equipment-code (leeg = geen beperking): ")).trim() || null;
    const from = await datum("Geldig vanaf (ISO 8601 met tijdzone): ");
    const until = await datum("Geldig tot (ISO 8601 met tijdzone; leeg = onbepaald): ", true);
    if (until && Date.parse(until) <= Date.parse(from)) throw new Error("Einddatum moet na begindatum liggen.");
    params = [target, role, area, product, equipment, from, until, await required("Reden en referentie: ")];
    sql = "SELECT * FROM fabriek.authorization_channel_submit($1::uuid,$2::text,$3::text,$4::uuid,$5::text,$6::timestamptz,$7::timestamptz,$8::text,$9::text)";
  } else if (actie === "goedkeuren" || actie === "afwijzen") {
    params = [await uuid("Aanvraag-UUID: "), actie === "goedkeuren", await required("Reden en referentie: ")];
    sql = "SELECT * FROM fabriek.authorization_channel_decide($1::uuid,$2::boolean,$3::text,$4::text)";
  } else if (actie === "intrekken") {
    params = [await uuid("Grant-UUID: "), await required("Reden en referentie: ")];
    sql = "SELECT fabriek.authorization_channel_revoke($1::uuid,$2::text,$3::text) AS status";
  } else throw new Error("Onbekende securityhandeling.");
  toon(JSON.stringify({ actie, parameters: params }, null, 2));
  if (await io.vraag("Typ BEVESTIG om deze handeling uit te voeren: ") !== "BEVESTIG") return false;
  const password = await io.wachtwoord("Bevestig persoonlijk uw MES-wachtwoord: ");
  // Autocommit: geweigerde wachtwoordpogingen moeten bewaard blijven.
  const { rows: [result] } = await c.query(sql, [...params, password]);
  toon(JSON.stringify(result));
  return ["submitted", "approved", "rejected", "revoked"].includes(result?.status);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { argumenten, leesInstellingen, pg } = await import("./lib.mjs");
  const { opties, los } = argumenten();
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("Securitybediening vereist een persoonlijk interactief terminalvenster.");
    process.exitCode = 1;
  } else {
    const io = maakInvoer();
    let c;
    try {
      const inst = leesInstellingen(opties);
      const user = await io.vraag("Persoonlijke PostgreSQL-login: ");
      if (!user.trim()) throw new Error("Login ontbreekt.");
      const password = await io.wachtwoord("Persoonlijk PostgreSQL-wachtwoord: ");
      if (!password) throw new Error("Wachtwoord ontbreekt.");
      // Alleen expliciete verbindingsparameters; nooit beheerDb, omgevingscredentials
      // of een onbeveiligde TLS-configuratie overnemen.
      c = new pg.Client({ host: inst.db.host, port: inst.db.port, database: inst.db.database,
        user, password, ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 10000 });
      await c.connect();
      // Verifieer de actuele persoonlijke binding vóór de bediening.
      await c.query("SELECT * FROM fabriek.authorization_channel_requests() LIMIT 0");
      if (!await securityActie(c, io, los[0])) process.exitCode = 1;
    } catch {
      console.error("Securityhandeling geweigerd of technische fout; controleer de actuele status voordat u opnieuw probeert.");
      process.exitCode = 1;
    } finally {
      io.sluit();
      await c?.end().catch(() => {});
    }
  }
}
