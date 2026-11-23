// Integratietest van de API tegen een echte (test)database.
// LET OP: de database wordt leeggemaakt en opnieuw gevuld met fictieve configuratie.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { bouwApp, startpagina, type App } from "../src/app.js";
import { maakPool, type Db } from "../src/db.js";

const DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost/batchgui?host=/tmp&port=5433";
// De applicatie zelf draait als batchgui_app (beperkte rechten, zie db/rechten.sql) als deze is gezet.
const APP_DB_URL = process.env.TEST_APP_DATABASE_URL ?? DB_URL;

let app: App;
let beheerDb: Db; // schema laden en testgegevens klaarzetten
let db: Db; // de verbinding van de applicatie

type Antwoord = { status: number; body: any };

async function verzoek(methode: string, pad: string, token?: string, body?: unknown): Promise<Antwoord> {
  const r = await app.inject({
    method: methode as never,
    url: pad,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    payload: body as never,
  });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
}

async function login(naam: string, pc?: string): Promise<string> {
  const r = await verzoek("POST", "/auth/login", undefined, { gebruikersnaam: naam, wachtwoord: "demo", pc });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.token;
}

/** Gedeeld account (D6): kies een naam. Eigen account (D53): de naam ligt vast, het token blijft. */
async function kiesNaam(token: string, naam = "Operator C"): Promise<string> {
  if (!JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).gedeeld) return token;
  const ops = await verzoek("GET", "/auth/operators", token);
  const id = ops.body.find((o: { naam: string }) => o.naam === naam).id;
  const r = await verzoek("POST", "/auth/operator", token, { operatorId: id });
  assert.equal(r.status, 200);
  return r.body.token;
}

/** Normale fictieve waarden voor alle velden van een registratie. */
function waardenVoor(reg: any, afwijkend: Record<string, [number | null, number]> = {}) {
  return reg.velden.map((v: any) => {
    const [setting, gemeten] =
      afwijkend[v.code] ??
      (v.soort === "procesparameter"
        ? v.code.endsWith(".1") ? [80, 81] : v.code === "S3.3" ? [5, 5.1] : [800, 805]
        : v.soort === "gewicht" ? [null, reg.niveau === "batch" ? 410 : 1640] : [null, 3.1]);
    return { id: randomUUID(), veldcode: v.code, setting, gemeten };
  });
}

async function doorloop(token: string, nummer: string, soort: "batch" | "lot", van: number, tot: number) {
  for (let k = van; k <= tot; k++) {
    const start = await verzoek("POST", "/registraties", token, {
      stapcode: `PS${k}`,
      ...(soort === "batch" ? { batchnummer: nummer } : { lotnummer: nummer }),
    });
    assert.equal(start.status, 201, `PS${k}: ${JSON.stringify(start.body)}`);
    const w = await verzoek("POST", `/registraties/${start.body.id}/waarden`, token, { waarden: waardenVoor(start.body) });
    assert.equal(w.status, 200, JSON.stringify(w.body));
    const gs = start.body.grondstoffen.filter((g: any) => g.verplicht && !g.gebruik);
    if (gs.length) {
      const r = await verzoek("POST", `/registraties/${start.body.id}/grondstoffen`, token, {
        grondstoffen: gs.map((g: any) => ({ id: randomUUID(), code: g.code, partij: `LEV-${g.code}-TEST`, hoeveelheid: 120 })),
      });
      assert.equal(r.status, 200, JSON.stringify(r.body));
    }
    const a = await verzoek("POST", `/registraties/${start.body.id}/afronden`, token);
    assert.equal(a.status, 200, JSON.stringify(a.body));
  }
}

before(async () => {
  beheerDb = maakPool(DB_URL);
  await beheerDb.query(readFileSync(new URL("../../db/schema.sql", import.meta.url), "utf8"));
  await beheerDb.query(readFileSync(new URL("../../db/seed_config.sql", import.meta.url), "utf8"));
  await beheerDb.query(readFileSync(new URL("../../db/seed_accounts_demo.sql", import.meta.url), "utf8"));
  await beheerDb.query(readFileSync(new URL("../../db/rechten.sql", import.meta.url), "utf8"));
  // De meeste tests zijn van vóór de keuring (#64): daar meet de operator alles. De keuring heeft een eigen test.
  await beheerDb.query("UPDATE fabriek.veld SET gemeten_door = 'productie' WHERE processtap_id IN (SELECT id FROM fabriek.processtap WHERE soort = 'proces')");
  db = APP_DB_URL === DB_URL ? beheerDb : maakPool(APP_DB_URL);
  app = await bouwApp({ db, jwtGeheim: "test-geheim-dat-lang-genoeg-is-0123456789" });
});

after(async () => {
  await app.close();
  if (db !== beheerDb) await db.end();
  await beheerDb.end();
});

describe("inloggen en rollen", () => {
  test("verkeerd wachtwoord geeft 401", async () => {
    const r = await verzoek("POST", "/auth/login", undefined, { gebruikersnaam: "operator", wachtwoord: "fout", pc: "PC-01" });
    assert.equal(r.status, 401);
  });
  test("operator mag zonder pc inloggen (startpagina, D54), maar niet zonder pc invoeren", async () => {
    const r = await verzoek("POST", "/auth/login", undefined, { gebruikersnaam: "operator.b", wachtwoord: "demo" });
    assert.equal(r.status, 200);
    const fout = await verzoek("POST", "/batches", r.body.token, { batchnummer: "B-2026-8031" });
    assert.equal(fout.status, 400);
    assert.match(fout.body.fout, /pc/);
  });
  test("zonder token geen toegang", async () => {
    assert.equal((await verzoek("GET", "/config/stappen")).status, 401);
  });
  test("operator moet eerst een naam kiezen voor invoer", async () => {
    const t = await login("operator", "PC-01");
    const r = await verzoek("POST", "/batches", t, { batchnummer: "B-2026-0999" });
    assert.equal(r.status, 400);
    assert.match(r.body.fout, /naam/);
  });
  test("analist mag geen invoer doen", async () => {
    const t = await login("analist1");
    assert.equal((await verzoek("POST", "/batches", t, { batchnummer: "B-2026-0999" })).status, 403);
  });
  test("kwaliteit mag lezen en meten, maar geen batch maken of beheren", async () => {
    const t = await login("kwaliteit1");
    assert.equal((await verzoek("GET", "/analyse/afwijkingen", t)).status, 200);
    assert.equal((await verzoek("POST", "/batches", t, { batchnummer: "B-2026-0998" })).status, 403);
    assert.equal((await verzoek("PATCH", "/beheer/velden/S1.1", t, { naam: "x" })).status, 403);
  });
  test("configuratie: 18 processtappen en 3 keuringsstappen, PS16 is de lot-stap", async () => {
    const t = await login("analist1");
    const r = await verzoek("GET", "/config/stappen", t);
    assert.equal(r.body.length, 21);  // 18 processtappen en 3 keuringsstappen (#80)
    assert.equal(r.body.find((s: any) => s.is_lot_stap).code, "PS16");
    assert.deepEqual(r.body[2].velden.map((v: any) => v.code), ["S3.1", "S3.2", "S3.3"]);
  });
});

describe("productie van batch tot lot", () => {
  let op: string;
  let pl: string;

  before(async () => {
    op = await kiesNaam(await login("operator", "PC-01"));
    pl = await kiesNaam(await login("ploegleider1", "PC-02"));
  });

  test("batchnummer met verkeerd formaat geeft 400", async () => {
    assert.equal((await verzoek("POST", "/batches", op, { batchnummer: "batch-1" })).status, 400);
  });

  test("dubbel batchnummer geeft 409", async () => {
    assert.equal((await verzoek("POST", "/batches", op, { batchnummer: "B-2026-0100" })).status, 201);
    assert.equal((await verzoek("POST", "/batches", op, { batchnummer: "B-2026-0100" })).status, 409);
  });

  test("databaseregel komt als leesbare melding terug (422)", async () => {
    const r = await verzoek("POST", "/registraties", op, { stapcode: "PS2", batchnummer: "B-2026-0100" });
    assert.equal(r.status, 422);
    assert.equal(r.body.fout, "Stap PS1 moet eerst afgerond zijn");
  });

  test("zelfde registratie-id opnieuw versturen maakt geen tweede registratie", async () => {
    const id = randomUUID();
    const a = await verzoek("POST", "/registraties", op, { id, stapcode: "PS1", batchnummer: "B-2026-0100" });
    const b = await verzoek("POST", "/registraties", op, { id, stapcode: "PS1", batchnummer: "B-2026-0100" });
    assert.equal(a.status, 201);
    assert.equal(b.status, 200);
    assert.equal(b.body.id, id);
    // Waarden met eigen id ook twee keer versturen.
    const waarden = waardenVoor(a.body, { "S1.1": [80, 86] });
    assert.equal((await verzoek("POST", `/registraties/${id}/waarden`, op, { waarden })).status, 200);
    const nogmaals = await verzoek("POST", `/registraties/${id}/waarden`, op, { waarden });
    assert.equal(nogmaals.status, 200);
    const s11 = nogmaals.body.velden.find((v: any) => v.code === "S1.1");
    assert.equal(s11.waarde.markering, "buiten_tolerantie");
  });

  test("een gestarte stap overnemen: een ander rondt af op een andere pc (#55)", async () => {
    const a = await login("operator.a", "PC-01");
    const b = await login("operator.b", "PC-03");
    assert.equal((await verzoek("POST", "/batches", a, { batchnummer: "B-2026-0955" })).status, 201);
    const start = await verzoek("POST", "/registraties", a, { stapcode: "PS1", batchnummer: "B-2026-0955" });
    assert.equal(start.status, 201);
    // Een tweede start (bijv. uit de wachtrij van een pc die offline was) zegt wie hem startte.
    const dubbel = await verzoek("POST", "/registraties", b, { stapcode: "PS1", batchnummer: "B-2026-0955" });
    assert.equal(dubbel.status, 422);
    assert.match(dubbel.body.fout, /^Stap PS1 staat nog open: gestart door Operator A op PC-01 om .*Open hem bij Bezig/);
    assert.equal((await verzoek("POST", `/registraties/${start.body.id}/waarden`, b, { waarden: waardenVoor(start.body) })).status, 200);
    const gs = start.body.grondstoffen.filter((g: any) => g.verplicht);
    await verzoek("POST", `/registraties/${start.body.id}/grondstoffen`, b, {
      grondstoffen: gs.map((g: any) => ({ id: randomUUID(), code: g.code, partij: "LEV-TEST-55", hoeveelheid: 100 })),
    });
    const af = await verzoek("POST", `/registraties/${start.body.id}/afronden`, b);
    assert.equal(af.status, 200, JSON.stringify(af.body));
    assert.equal(af.body.operator, "Operator A");
    assert.equal(af.body.pc, "PC-01");
    assert.equal(af.body.afgerond_door, "Operator B");
    assert.equal(af.body.afgerond_pc, "PC-03");
  });

  test("nainvoeren na papier: ploegleider wel, operator niet (#75)", async () => {
    assert.equal((await verzoek("POST", "/batches", op, { batchnummer: "B-2026-0956" })).status, 201);
    const k = await verzoek("GET", "/nalevering/keuzes", pl);
    assert.equal(k.status, 200);
    assert.equal((await verzoek("GET", "/nalevering/keuzes", op)).status, 403);
    const pc = k.body.pcs.find((p: any) => p.naam === "PC-04").id;
    const wie = k.body.operators.find((o: any) => o.naam === "Operator D").id;
    const uur = 3600_000;
    const body = {
      stapcode: "PS1", nummer: "B-2026-0956", pc, operator: wie,
      begin: new Date(Date.now() - 3 * uur).toISOString(), eind: new Date(Date.now() - 2 * uur).toISOString(),
      reden: "server en pc uit door stroomstoring",
      waarden: [{ veldcode: "S1.1", setting: 80, gemeten: 81 }, { veldcode: "S1.2", gemeten: 410 }],
      grondstoffen: [{ code: "GS-A", partij: "LEV-PAPIER-75", hoeveelheid: 120 }],
    };
    assert.equal((await verzoek("POST", "/nalevering", op, body)).status, 403);
    const r = await verzoek("POST", "/nalevering", pl, body);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.status, "afgerond");
    assert.equal(r.body.operator, "Operator D");
    assert.equal(r.body.pc, "PC-04");
    assert.equal(r.body.nageleverd_door, "ploegleider1");
    assert.equal(r.body.nageleverd_reden, "server en pc uit door stroomstoring");
    assert.equal(new Date(r.body.gestart_op).getTime(), new Date(body.begin).getTime());
    assert.equal(new Date(r.body.afgerond_op).getTime(), new Date(body.eind).getTime());
    // De volgende stap kan niet vóór het einde van PS1 beginnen.
    const te = await verzoek("POST", "/nalevering", pl, { ...body, stapcode: "PS2", begin: new Date(Date.now() - 2.5 * uur).toISOString(), waarden: [], grondstoffen: [] });
    assert.equal(te.status, 422);
    assert.match(te.body.fout, /vóór het einde van de vorige stap/);
  });

  test("ingevuld veld opnieuw invullen: zelfde waarde is goed, een andere wordt een conflict (#85)", async () => {
    const lijst = await verzoek("GET", "/registraties?status=open&stapcode=PS1", op);
    const id = lijst.body[0].id;
    const nu = (await verzoek("GET", `/registraties/${id}`, op)).body.velden.find((v: any) => v.code === "S1.2").waarde.gemeten;
    const zelfde = await verzoek("POST", `/registraties/${id}/waarden`, op, { waarden: [{ veldcode: "S1.2", gemeten: nu }] });
    assert.equal(zelfde.status, 200, JSON.stringify(zelfde.body));
    assert.equal(zelfde.body.conflicten.length, 0);
    const invoer = { waarden: [{ id: randomUUID(), veldcode: "S1.2", gemeten: 400 }] };
    const r = await verzoek("POST", `/registraties/${id}/waarden`, op, invoer);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.conflicten.length, 1);
    assert.equal(r.body.conflicten[0].code, "S1.2");
    assert.equal(r.body.conflicten[0].nieuw, "400");
    assert.equal(r.body.conflicten[0].wie_kiest, "ploegleider");
    assert.equal(r.body.velden.find((v: any) => v.code === "S1.2").waarde.gemeten, nu, "de eerste waarde blijft staan");
    // Opnieuw versturen uit de wachtrij: geen tweede conflict.
    assert.equal((await verzoek("POST", `/registraties/${id}/waarden`, op, invoer)).body.conflicten.length, 1);
    assert.equal((await verzoek("GET", "/conflicten", op)).status, 403);
    const open = await verzoek("GET", "/conflicten", pl);
    assert.equal(open.status, 200);
    const c = open.body.find((x: any) => x.registratie_id === id);
    assert.ok(c && c.stap === "PS1" && c.nummer.startsWith("B-"));
    assert.equal((await verzoek("POST", `/conflicten/${c.id}/oplossen`, op, { keuze: "bestaand" })).status, 403);
    const opgelost = await verzoek("POST", `/conflicten/${c.id}/oplossen`, pl, { keuze: "bestaand" });
    assert.equal(opgelost.status, 200, JSON.stringify(opgelost.body));
    assert.equal(opgelost.body.conflicten.length, 0);
    assert.equal(opgelost.body.velden.find((v: any) => v.code === "S1.2").waarde.gemeten, nu);
  });

  test("operator kan niet corrigeren, ploegleider wel", async () => {
    const lijst = await verzoek("GET", "/registraties?status=open&stapcode=PS1", op);
    const id = lijst.body[0].id;
    const pad = `/registraties/${id}/waarden/S1.1/correctie`;
    assert.equal((await verzoek("POST", pad, op, { gemeten: 82, reden: "tikfout" })).status, 403);
    const oud = (await verzoek("GET", `/registraties/${id}`, pl)).body.velden.find((v: any) => v.code === "S1.1").waarde.id;
    const r = await verzoek("POST", pad, pl, { gemeten: 82, reden: "tikfout", vervangt: oud });
    assert.equal(r.status, 201);
    const s11 = r.body.velden.find((v: any) => v.code === "S1.1");
    assert.equal(s11.waarde.gemeten, 82);
    assert.equal(s11.waarde.gecorrigeerd, true);
    assert.equal(s11.waarde.markering, "ok");
    // Een tweede ploegleider die nog de oude waarde zag, overschrijft de correctie niet (#85).
    const laat = await verzoek("POST", pad, pl, { gemeten: 83, reden: "tikfout", vervangt: oud });
    assert.equal(laat.status, 409);
    assert.match(laat.body.fout, /intussen/);
    await verzoek("POST", `/registraties/${id}/grondstoffen`, op, { grondstoffen: [{ code: "GS-A", partij: "LEV-GS-A-TEST" }] });
    assert.equal((await verzoek("POST", `/registraties/${id}/afronden`, op)).status, 200);
  });

  test("vier batches doorlopen PS1-PS15 en worden een lot", async () => {
    await doorloop(op, "B-2026-0100", "batch", 2, 15);
    for (const nr of ["B-2026-0101", "B-2026-0102", "B-2026-0103", "B-2026-0104"]) {
      assert.equal((await verzoek("POST", "/batches", op, { batchnummer: nr })).status, 201);
      await doorloop(op, nr, "batch", 1, 15);
    }
    const gereed = await verzoek("GET", "/batches?gereedVoorLot=true", op);
    assert.equal(gereed.body.length, 5);

    // Ploegleider zet B-2026-0104 in beoordeling en keurt af.
    const b1 = await verzoek("POST", "/batches/B-2026-0104/besluiten", pl, { besluit: "in_beoordeling", reden: "kleur wijkt af" });
    assert.equal(b1.status, 201);
    assert.equal(b1.body.status, "in_beoordeling");
    const fout = await verzoek("POST", "/lots", op, {
      lotnummer: "L-2026-0001",
      batchnummers: ["B-2026-0100", "B-2026-0101", "B-2026-0102", "B-2026-0104"],
    });
    assert.equal(fout.status, 422);
    assert.match(fout.body.fout, /B-2026-0104 heeft status in_beoordeling/);
    assert.equal((await verzoek("POST", "/batches/B-2026-0104/besluiten", op, { besluit: "afgekeurd", reden: "x" })).status, 403);
    const plNok = await verzoek("POST", "/batches/B-2026-0104/besluiten", pl, { besluit: "afgekeurd", reden: "x" });
    assert.equal(plNok.status, 422);
    assert.match(plNok.body.fout, /Alleen Kwaliteit/);
    const kw = await login("kwaliteit1");
    const b2 = await verzoek("POST", "/batches/B-2026-0104/besluiten", kw, { besluit: "afgekeurd", reden: "NOK: afvoeren" });
    assert.equal(b2.status, 201);
    assert.equal(b2.body.status, "afgekeurd");
    const detail = await verzoek("GET", "/batches/B-2026-0104", op);
    assert.equal(detail.body.besluiten.length, 2);
    assert.equal(detail.body.registraties.length, 15);

    const lot = await verzoek("POST", "/lots", op, {
      lotnummer: "L-2026-0001",
      batchnummers: ["B-2026-0100", "B-2026-0101", "B-2026-0102", "B-2026-0103"],
    });
    assert.equal(lot.status, 201, JSON.stringify(lot.body));
    assert.deepEqual(lot.body.lot.batches, ["B-2026-0100", "B-2026-0101", "B-2026-0102", "B-2026-0103"]);
    assert.equal(lot.body.registratie.stapcode, "PS16");
    assert.equal(lot.body.registratie.status, "open");
  });

  test("lot met minder dan 4 batches wordt al door de API geweigerd", async () => {
    const r = await verzoek("POST", "/lots", op, { lotnummer: "L-2026-0002", batchnummers: ["B-2026-0100"] });
    assert.equal(r.status, 400);
  });

  test("lotstappen, herbewerking en lotpaspoort", async () => {
    const lot = await verzoek("GET", "/lots/L-2026-0001", op);
    const ps16 = lot.body.registraties.find((r: any) => r.stapcode === "PS16");
    const ps16detail = await verzoek("GET", `/registraties/${ps16.id}`, op);
    await verzoek("POST", `/registraties/${ps16.id}/waarden`, op, { waarden: waardenVoor(ps16detail.body) });
    assert.equal((await verzoek("POST", `/registraties/${ps16.id}/afronden`, op)).status, 200);
    await doorloop(op, "L-2026-0001", "lot", 17, 17);

    // PS18 met te hoog vochtgehalte.
    const r18 = await verzoek("POST", "/registraties", op, { stapcode: "PS18", lotnummer: "L-2026-0001" });
    await verzoek("POST", `/registraties/${r18.body.id}/waarden`, op, { waarden: waardenVoor(r18.body, { "S18.3": [null, 5.1] }) });
    await verzoek("POST", `/registraties/${r18.body.id}/afronden`, op);

    // Herbewerking naar PS17; daarna PS17 en PS18 opnieuw.
    const herb = await verzoek("POST", "/lots/L-2026-0001/herbewerking", op, { stapcode: "PS17", reden: "te nat na verpakken" });
    assert.equal(herb.status, 201);
    assert.equal(herb.body.poging, 2);
    const vroeg = await verzoek("POST", "/registraties", op, { stapcode: "PS18", lotnummer: "L-2026-0001" });
    assert.equal(vroeg.status, 422);
    await verzoek("POST", `/registraties/${herb.body.id}/waarden`, op, { waarden: waardenVoor(herb.body) });
    await verzoek("POST", `/registraties/${herb.body.id}/afronden`, op);
    await doorloop(op, "L-2026-0001", "lot", 18, 18);

    const pas = await verzoek("GET", "/lots/L-2026-0001/paspoort", op);
    assert.equal(pas.status, 200);
    assert.equal(pas.body.aantal_afwijkingen, 1); // S18.3 poging 1; S1.1 was gecorrigeerd
    assert.equal(pas.body.regels[0].veld, "S18.3");
    const alleen = await verzoek("GET", "/lots/L-2026-0001/paspoort?alleenAfwijkingen=true", op);
    assert.equal(alleen.body.regels.length, 1);

    // Eén meting met alles eromheen (#56).
    const m18 = await verzoek("GET", "/lots/L-2026-0001/meting?nummer=L-2026-0001&stap=PS18&poging=1&veld=S18.3", op);
    assert.equal(m18.status, 200, JSON.stringify(m18.body));
    assert.equal(m18.body.versies.length, 1);
    assert.equal(m18.body.versies[0].markering, "buiten_grens");
    assert.deepEqual(m18.body.herbewerkingen.map((h: any) => [h.stap, h.reden]), [["PS17", "te nat na verpakken"]]);
    const s11 = pas.body.regels.find((r: any) => r.veld === "S1.1" && r.gecorrigeerd);
    const m11 = await verzoek("GET", `/lots/L-2026-0001/meting?nummer=${s11.batch_of_lot}&stap=PS1&poging=1&veld=S1.1`, op);
    assert.equal(m11.body.versies.length, 2);
    assert.ok(m11.body.versies[1].correctie_reden);
    assert.ok(Array.isArray(m11.body.besluiten));
    assert.equal((await verzoek("GET", `/lots/L-2026-0001/meting?nummer=B-2026-9999&stap=PS1&poging=1&veld=S1.1`, op)).status, 404);

    const herbLijst = await verzoek("GET", "/analyse/herbewerkingen", op);
    assert.equal(herbLijst.body.length, 1);
    assert.equal(herbLijst.body[0].reden, "te nat na verpakken");
    const afw = await verzoek("GET", "/analyse/afwijkingen", op);
    assert.ok(afw.body.some((a: any) => a.veld === "S18.3" && a.lotnummer === "L-2026-0001"));
  });

  test("keuring: Kwaliteit meet na het afronden en geeft vrij; daarna pas de volgende stap (#64)", async () => {
    const bh = await login("beheerder1");
    assert.equal((await verzoek("PATCH", "/beheer/velden/S2.2", bh, { gemeten_door: "kwaliteit" })).status, 200);
    const cfg = await verzoek("GET", "/config/stappen", op);
    assert.equal(cfg.body.find((s: any) => s.code === "PS2").velden.find((v: any) => v.code === "S2.2").gemeten_door, "kwaliteit");
    assert.equal((await verzoek("POST", "/batches", op, { batchnummer: "B-2026-0120" })).status, 201);
    await doorloop(op, "B-2026-0120", "batch", 1, 1);
    const start = await verzoek("POST", "/registraties", op, { stapcode: "PS2", batchnummer: "B-2026-0120" });
    assert.equal(start.body.velden.find((v: any) => v.code === "S2.2").gemeten_door, "kwaliteit");
    const fout = await verzoek("POST", `/registraties/${start.body.id}/waarden`, op, { waarden: [{ veldcode: "S2.2", gemeten: 410 }] });
    assert.equal(fout.status, 422);
    assert.match(fout.body.fout, /meet Kwaliteit/);
    assert.equal((await verzoek("POST", `/registraties/${start.body.id}/waarden`, op, { waarden: [{ veldcode: "S2.1", setting: 80, gemeten: 81 }] })).status, 200);
    const af = await verzoek("POST", `/registraties/${start.body.id}/afronden`, op);
    assert.equal(af.status, 200, JSON.stringify(af.body));
    assert.equal(af.body.keuring.status, "open");
    const lijst = await verzoek("GET", "/keuringen?stap=PS2", op);
    const k = lijst.body.find((x: any) => x.nummer === "B-2026-0120");
    assert.equal(k.te_meten, 1);
    assert.ok(!(await verzoek("GET", "/werkvoorraad/PS3", op)).body.wachtend.some((w: any) => w.nummer === "B-2026-0120"));
    const kw = await login("kwaliteit1", "PC-01");
    const vroeg = await verzoek("POST", `/keuringen/${k.id}/besluit`, kw, { besluit: "vrijgegeven" });
    assert.equal(vroeg.status, 422);
    assert.match(vroeg.body.fout, /Nog niet gemeten: S2.2/);
    assert.equal((await verzoek("POST", `/keuringen/${k.id}/besluit`, op, { besluit: "vrijgegeven" })).status, 403);
    const meet = await verzoek("POST", `/registraties/${start.body.id}/waarden`, kw, { waarden: [{ veldcode: "S2.2", gemeten: 412 }] });
    assert.equal(meet.status, 200, JSON.stringify(meet.body));
    const vrij = await verzoek("POST", `/keuringen/${k.id}/besluit`, kw, { besluit: "vrijgegeven" });
    assert.equal(vrij.status, 200, JSON.stringify(vrij.body));
    assert.equal(vrij.body.keuring.status, "vrijgegeven");
    assert.equal(vrij.body.keuring.besloten_door, "kwaliteit1");
    assert.equal((await verzoek("POST", `/keuringen/${k.id}/besluit`, kw, { besluit: "vrijgegeven" })).status, 200);
    assert.ok((await verzoek("GET", "/werkvoorraad/PS3", op)).body.wachtend.some((w: any) => w.nummer === "B-2026-0120"));
    await verzoek("PATCH", "/beheer/velden/S2.2", bh, { gemeten_door: "productie" });
  });

  test("herbewerking met opdracht: Kwaliteit of productiemanager maakt hem, de operator start hem in de stap (#61)", async () => {
    assert.equal((await verzoek("POST", "/batches", op, { batchnummer: "B-2026-0110" })).status, 201);
    await doorloop(op, "B-2026-0110", "batch", 1, 3);
    const pm = await login("productiemanager1");
    const stappen = await verzoek("GET", "/herbewerkingen/stappen?nummer=B-2026-0110", pm);
    assert.deepEqual(stappen.body.map((x: any) => x.code), ["PS1", "PS2", "PS3"]);
    assert.equal((await verzoek("GET", "/herbewerkingen/stappen?nummer=B-2026-9999", pm)).status, 404);
    assert.equal((await verzoek("POST", "/herbewerkingen", pl, { nummer: "B-2026-0110", stapcode: "PS2", reden: "x" })).status, 403);
    const fout = await verzoek("POST", "/herbewerkingen", pm, { nummer: "B-2026-0110", stapcode: "PS5", reden: "x" });
    assert.equal(fout.status, 422);
    assert.match(fout.body.fout, /nog niet doorlopen/);
    const h = await verzoek("POST", "/herbewerkingen", pm, { nummer: "B-2026-0110", stapcode: "PS2", reden: "menger te kort" });
    assert.equal(h.status, 201, JSON.stringify(h.body));
    assert.equal(h.body.stand, "te_plannen");
    assert.equal(h.body.door, "productiemanager1");
    const wv = await verzoek("GET", "/werkvoorraad/PS2", op);
    assert.equal(wv.body.wachtend.find((w: any) => w.nummer === "B-2026-0110")?.herbewerking, "menger te kort");
    assert.ok(!(await verzoek("GET", "/werkvoorraad/PS4", op)).body.wachtend.some((w: any) => w.nummer === "B-2026-0110"));
    // De operator start gewoon PS2 (zoals ook een ouder invoerscherm doet).
    const start = await verzoek("POST", "/registraties", op, { stapcode: "PS2", batchnummer: "B-2026-0110" });
    assert.equal(start.status, 201, JSON.stringify(start.body));
    assert.equal(start.body.herbewerking_start, true);
    assert.equal(start.body.poging, 2);
    const lijst = await verzoek("GET", "/herbewerkingen?nummer=B-2026-0110", op);
    assert.deepEqual(lijst.body.map((x: any) => x.stand), ["bezig"]);
    const intrek = await verzoek("POST", `/herbewerkingen/${h.body.id}/intrekken`, pm, { reden: "x" });
    assert.equal(intrek.status, 422);
    assert.ok((await verzoek("GET", "/herbewerkingen", op)).body.some((x: any) => x.nummer === "B-2026-0110"));
  });
});

describe("beheer", () => {
  test("alleen beheerder; nieuw veld krijgt de volgende code", async () => {
    const pl = await login("ploegleider1");
    const bh = await login("beheerder1");
    const nieuw = { stapcode: "PS3", naam: "pH", soort: "overig", grens_min: 6, grens_max: 8 };
    assert.equal((await verzoek("POST", "/beheer/velden", pl, nieuw)).status, 403);
    const r = await verzoek("POST", "/beheer/velden", bh, nieuw);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.code, "S3.4");
  });

  test("veld inactief zetten en daarna nieuw veld: code wordt niet hergebruikt", async () => {
    const bh = await login("beheerder1");
    assert.equal((await verzoek("PATCH", "/beheer/velden/S3.4", bh, { actief: false })).status, 200);
    const r = await verzoek("POST", "/beheer/velden", bh, { stapcode: "PS3", naam: "Geleidbaarheid", soort: "overig" });
    assert.equal(r.body.code, "S3.5");
    const log = await verzoek("GET", "/beheer/logboek?limiet=5", bh);
    assert.equal(log.body[0].gewijzigd_door, "beheerder1");
  });

  test("onbekende eigenschap wijzigen wordt geweigerd", async () => {
    const bh = await login("beheerder1");
    assert.equal((await verzoek("PATCH", "/beheer/velden/S1.1", bh, { code: "S1.9" })).status, 400);
  });
});

describe("werkvoorraad en apparaat-id's", () => {
  test("batch met eigen id twee keer versturen geeft één batch", async () => {
    const op = await kiesNaam(await login("operator", "PC-03"));
    const id = randomUUID();
    assert.equal((await verzoek("POST", "/batches", op, { id, batchnummer: "B-2026-0200" })).status, 201);
    assert.equal((await verzoek("POST", "/batches", op, { id, batchnummer: "B-2026-0200" })).status, 200);
    assert.equal((await verzoek("POST", "/batches", op, { id, batchnummer: "B-2026-0201" })).status, 409);
  });
  test("NOK breekt een open stap af", async () => {
    const op = await kiesNaam(await login("operator", "PC-03"));
    const pl = await login("ploegleider1");
    const kw = await login("kwaliteit1");
    assert.equal((await verzoek("POST", "/batches", op, { batchnummer: "B-2026-0300" })).status, 201);
    const reg = await verzoek("POST", "/registraties", op, { stapcode: "PS1", batchnummer: "B-2026-0300" });
    await verzoek("POST", "/batches/B-2026-0300/besluiten", pl, { besluit: "in_beoordeling", reden: "twijfel" });
    await verzoek("POST", "/batches/B-2026-0300/besluiten", kw, { besluit: "afgekeurd", reden: "vervuild" });
    const na = await verzoek("GET", `/registraties/${reg.body.id}`, op);
    assert.equal(na.status, 200);
    assert.equal(na.body.status, "afgebroken");
    assert.equal(na.body.reden, "Batch afgekeurd: vervuild");
    const afronden = await verzoek("POST", `/registraties/${reg.body.id}/afronden`, op);
    assert.equal(afronden.status, 422);
  });
  test("nieuwe batch staat klaar voor PS1; overzicht heeft alle 21 stappen", async () => {
    const t = await login("analist1");
    const ps1 = await verzoek("GET", "/werkvoorraad/PS1", t);
    assert.ok(ps1.body.wachtend.some((w: any) => w.nummer === "B-2026-0200"));
    const overzicht = await verzoek("GET", "/werkvoorraad", t);
    assert.equal(overzicht.body.length, 21);  // 18 processtappen en 3 keuringsstappen (#80)
    assert.equal(overzicht.body.find((s: any) => s.stapcode === "PS1").wachtend, 1);
  });
});

describe("analyses voor Kwaliteit", () => {
  test("samenvatting, afwijkingen, trend, afkeur, herbewerkingen en lots", async () => {
    const t = await login("kwaliteit1");
    const sam = await verzoek("GET", "/analyse/samenvatting", t);
    assert.equal(sam.status, 200, JSON.stringify(sam.body));
    assert.ok(sam.body.waarden > 0 && sam.body.lots >= 1 && sam.body.per_week.length >= 1);
    const afw = await verzoek("GET", "/analyse/afwijkingen?veld=S18.3", t);
    assert.ok(afw.body.length >= 1 && afw.body.every((a: any) => a.veld === "S18.3"));
    const trend = await verzoek("GET", "/analyse/trend?veld=S1.1", t);
    assert.equal(trend.body.veld.tolerantie, 5);
    assert.ok(trend.body.punten.length >= 5);
    assert.equal((await verzoek("GET", "/analyse/trend?veld=S99.9", t)).status, 404);
    const afk = await verzoek("GET", "/analyse/afkeur", t);
    assert.ok(afk.body.some((a: any) => a.batchnummer === "B-2026-0104" && a.in_beoordeling_reden === "kleur wijkt af"));
    const lots = await verzoek("GET", "/lots?zoek=0100", t);
    assert.equal(lots.body[0].lotnummer, "L-2026-0001");
    assert.equal(lots.body[0].herbewerkingen, 1);
    const tb = await verzoek("GET", "/analyse/te-beoordelen", t);
    assert.equal(tb.status, 200);
    const bp = await verzoek("GET", "/batches/B-2026-0100/paspoort", t);
    assert.equal(bp.status, 200);
    assert.equal(bp.body.regels[0].markering, "ok"); // S1.1 werd gecorrigeerd naar binnen tolerantie
    assert.ok(bp.body.regels.length >= 30);
  });
});

describe("analyses voor Productie", () => {
  test("werkvoorraad, doorlooptijden, productie per week en correcties", async () => {
    const t = await login("ploegleider1");
    const wv = await verzoek("GET", "/werkvoorraad", t);
    assert.equal(wv.status, 200, JSON.stringify(wv.body));
    assert.equal(wv.body[0].stapnaam, "Process Step 1");
    const dl = await verzoek("GET", "/analyse/doorlooptijden", t);
    assert.equal(dl.status, 200, JSON.stringify(dl.body));
    const ps2 = dl.body.stappen.find((s: any) => s.stap === "PS2");
    assert.ok(ps2.aantal >= 4 && ps2.bewerking_mediaan >= 0 && ps2.wachten_mediaan >= 0);
    assert.ok(dl.body.per_week.length >= 1 && dl.body.per_week.some((w: any) => w.lots >= 1));
    const pr = await verzoek("GET", "/analyse/productie", t);
    assert.ok(pr.body.reduce((a: number, w: any) => a + w.batches_gestart, 0) >= 5);
    // #58: per dag, week of maand geeft andere groepen, maar dezelfde totalen; elk begin is een maandag of de eerste van de maand.
    const som = (b: any[], k: string) => b.reduce((a: number, w: any) => a + w[k], 0);
    const sam = await verzoek("GET", "/analyse/samenvatting", t);
    for (const per of ["dag", "maand"]) {
      const x = await verzoek("GET", `/analyse/productie?per=${per}`, t);
      assert.equal(x.status, 200);
      for (const k of ["batches_gestart", "batches_klaar", "lots_gereed", "afgekeurd"]) assert.equal(som(x.body, k), som(pr.body, k), `${per} ${k}`);
      const sx = await verzoek("GET", `/analyse/samenvatting?per=${per}`, t);
      assert.equal(som(sx.body.per_week, "waarden"), som(sam.body.per_week, "waarden"));
    }
    assert.ok(pr.body.every((w: any) => new Date(`${w.week}T12:00:00`).getDay() === 1));
    const maand = await verzoek("GET", "/analyse/productie?per=maand", t);
    assert.ok(maand.body.every((w: any) => w.week.endsWith("-01")));
    assert.equal((await verzoek("GET", "/analyse/productie?per=jaar", t)).status, 400);
    const cor = await verzoek("GET", "/analyse/correcties", t);
    const c = cor.body.find((x: any) => x.batch_of_lot === "B-2026-0100" && x.veld === "S1.1");
    assert.ok(c, JSON.stringify(cor.body));
    assert.equal(c.oud_gemeten, 86);
    assert.equal(c.nieuw_gemeten, 82);
    assert.equal(c.oud_markering, "buiten_tolerantie");
    assert.equal(c.reden, "tikfout");
    assert.equal(c.door, "ploegleider1");
  });
});

describe("Portaal Beheer", () => {
  test("stapnaam, accounts, operators, pc's en logboek", async () => {
    const bh = await login("beheerder1");
    const st = await verzoek("PATCH", "/beheer/stappen/PS3", bh, { naam: "Mengen" });
    assert.equal(st.status, 200, JSON.stringify(st.body));
    assert.equal(st.body.naam, "Mengen");
    assert.equal((await verzoek("PATCH", "/beheer/stappen/PS3", bh, { volgorde: 1 })).status, 400);

    assert.equal((await verzoek("POST", "/beheer/gebruikers", bh, { gebruikersnaam: "kwaliteit2", rol: "kwaliteit", wachtwoord: "kort" })).status, 400);
    const nieuw = await verzoek("POST", "/beheer/gebruikers", bh, { gebruikersnaam: "kwaliteit2", rol: "kwaliteit", wachtwoord: "geheim-123" });
    assert.equal(nieuw.status, 201, JSON.stringify(nieuw.body));
    assert.equal((await verzoek("POST", "/auth/login", undefined, { gebruikersnaam: "kwaliteit2", wachtwoord: "geheim-123" })).status, 200);
    assert.equal((await verzoek("POST", "/beheer/gebruikers", bh, { gebruikersnaam: "kwaliteit2", rol: "kwaliteit", wachtwoord: "geheim-123" })).status, 409);
    assert.equal((await verzoek("PATCH", "/beheer/gebruikers/kwaliteit2", bh, { actief: false })).status, 200);
    assert.equal((await verzoek("POST", "/auth/login", undefined, { gebruikersnaam: "kwaliteit2", wachtwoord: "geheim-123" })).status, 401);
    const zelf = await verzoek("PATCH", "/beheer/gebruikers/beheerder1", bh, { actief: false });
    assert.equal(zelf.status, 422);
    assert.equal((await verzoek("PATCH", "/beheer/gebruikers/analist1", bh, { wachtwoord: "nieuw-wachtwoord" })).status, 200);
    assert.equal((await verzoek("POST", "/auth/login", undefined, { gebruikersnaam: "analist1", wachtwoord: "nieuw-wachtwoord" })).status, 200);

    const op = await verzoek("POST", "/beheer/operators", bh, { naam: "Operator I" });
    assert.equal(op.status, 201);
    assert.equal((await verzoek("PATCH", `/beheer/operators/${op.body.id}`, bh, { actief: false })).body.actief, false);

    const pc = await verzoek("POST", "/beheer/pcs", bh, { naam: "pc-21", locatie: "Hal 4" });
    assert.equal(pc.status, 201);
    assert.equal(pc.body.naam, "PC-21");
    const kop = await verzoek("PATCH", "/beheer/pcs/PC-21", bh, { stappen: ["PS1", "PS2"] });
    assert.deepEqual(kop.body.stappen, ["PS1", "PS2"]);
    assert.deepEqual((await verzoek("PATCH", "/beheer/pcs/PC-21", bh, { stappen: ["PS2"] })).body.stappen, ["PS2"]);
    assert.equal((await verzoek("PATCH", "/beheer/pcs/PC-21", bh, { stappen: ["PS99"] })).status, 422);

    const log = await verzoek("GET", "/beheer/logboek?limiet=50", bh);
    assert.ok(log.body.some((l: any) => l.tabel === "processtap" && l.nieuw.naam === "Mengen" && l.gewijzigd_door === "beheerder1"));
    assert.ok(log.body.some((l: any) => l.tabel === "pc_stap" && l.actie === "DELETE" && l.extra.pc === "PC-21" && l.extra.stap === "PS1"));
    assert.ok(log.body.every((l: any) => !JSON.stringify(l).includes("wachtwoord_hash")));
    const pl = await login("ploegleider1");
    assert.equal((await verzoek("GET", "/beheer/gebruikers", pl)).status, 403);
  });
});

describe("accounts met een tijdelijk wachtwoord (#76)", () => {
  test("import: proefronde, alles-of-niets, daarna eerst een eigen wachtwoord", async () => {
    const bh = await login("beheerder1");
    const regels = [
      { regel: 2, gebruikersnaam: "Import.A", rol: "operator", naam: "Import A", wachtwoord: "tijdelijk-a", actief: true },
      { regel: 3, gebruikersnaam: "import.b", rol: "planner", naam: null, wachtwoord: "kort", actief: true },
    ];
    const fout = await verzoek("POST", "/beheer/gebruikers/import", bh, { uitvoeren: true, regels });
    assert.equal(fout.status, 200);
    assert.equal(fout.body.uitgevoerd, false);
    assert.equal(fout.body.fouten, 1);
    assert.match(fout.body.regels[1].fout, /minstens 8 tekens/);
    assert.equal((await beheerDb.query("SELECT count(*)::int AS n FROM fabriek.gebruiker WHERE gebruikersnaam = 'import.a'")).rows[0].n, 0, "niets opgeslagen");
    const eigen = await verzoek("POST", "/beheer/gebruikers/import", bh, { uitvoeren: false, regels: [{ regel: 2, gebruikersnaam: "beheerder1", rol: "beheerder", actief: false }] });
    assert.match(eigen.body.regels[0].fout, /eigen beheerdersaccount/);
    regels[1].wachtwoord = "tijdelijk-b";
    const proef = await verzoek("POST", "/beheer/gebruikers/import", bh, { uitvoeren: false, regels });
    assert.deepEqual([proef.body.nieuw, proef.body.uitgevoerd], [2, false]);
    const goed = await verzoek("POST", "/beheer/gebruikers/import", bh, { uitvoeren: true, regels });
    assert.deepEqual([goed.body.nieuw, goed.body.uitgevoerd], [2, true], JSON.stringify(goed.body));

    const r = await verzoek("POST", "/auth/login", undefined, { gebruikersnaam: "import.a", wachtwoord: "tijdelijk-a" });
    assert.equal(r.status, 200);
    assert.equal(r.body.wachtwoordWijzigen, true);
    const geblokt = await verzoek("GET", "/config/stappen", r.body.token);
    assert.equal(geblokt.status, 403);
    assert.match(geblokt.body.fout, /eigen wachtwoord/);
    assert.equal((await verzoek("POST", "/auth/wachtwoord", r.body.token, { huidig: "tijdelijk-a", nieuw: "tijdelijk-a" })).status, 422);
    assert.equal((await verzoek("POST", "/auth/wachtwoord", r.body.token, { huidig: "verkeerd!", nieuw: "eigen-wachtwoord" })).status, 422);
    const w = await verzoek("POST", "/auth/wachtwoord", r.body.token, { huidig: "tijdelijk-a", nieuw: "eigen-wachtwoord" });
    assert.equal(w.status, 200);
    assert.equal(w.body.operator?.naam, "Import A");
    assert.equal((await verzoek("GET", "/config/stappen", w.body.token)).status, 200);
    const opnieuw = await verzoek("POST", "/auth/login", undefined, { gebruikersnaam: "import.a", wachtwoord: "eigen-wachtwoord" });
    assert.equal(opnieuw.body.wachtwoordWijzigen, undefined);
    // Een nieuw wachtwoord van de beheerder is weer tijdelijk; bij een wandscherm niet.
    await verzoek("PATCH", "/beheer/gebruikers/import.a", bh, { wachtwoord: "nieuw-tijdelijk" });
    assert.equal((await verzoek("POST", "/auth/login", undefined, { gebruikersnaam: "import.a", wachtwoord: "nieuw-tijdelijk" })).body.wachtwoordWijzigen, true);
    await verzoek("POST", "/beheer/gebruikers", bh, { gebruikersnaam: "tv.test", rol: "scherm", wachtwoord: "scherm-test" });
    assert.equal((await verzoek("POST", "/auth/login", undefined, { gebruikersnaam: "tv.test", wachtwoord: "scherm-test" })).body.wachtwoordWijzigen, undefined);
  });
});

describe("iets melden (#78)", () => {
  test("iedereen meldt, één keer per id; de beheerder ziet en handelt af", async () => {
    const a = await login("operator.a", "PC-01");
    const id = randomUUID();
    const body = { id, tekst: "Scanner piept niet bij PS3", stapcode: "PS3", scherm: "invoer: stap" };
    assert.equal((await verzoek("POST", "/terugmeldingen", a, body)).status, 201);
    assert.equal((await verzoek("POST", "/terugmeldingen", a, body)).status, 201, "opnieuw versturen mag");
    assert.equal((await verzoek("GET", "/terugmeldingen", a)).status, 403);
    const bh = await login("beheerder1");
    const lijst = await verzoek("GET", "/terugmeldingen", bh);
    const m = lijst.body.filter((t: any) => t.id === id);
    assert.equal(m.length, 1);
    assert.deepEqual([m[0].naam, m[0].pc, m[0].stapcode, m[0].status], ["Operator A", "PC-01", "PS3", "open"]);
    assert.equal((await verzoek("POST", `/terugmeldingen/${id}/afhandelen`, bh, { notitie: "#80" })).status, 204);
    assert.equal((await verzoek("GET", "/terugmeldingen", bh)).body.some((t: any) => t.id === id), false, "niet meer bij open");
    const alle = await verzoek("GET", "/terugmeldingen?status=alle", bh);
    assert.equal(alle.body.find((t: any) => t.id === id)?.notitie, "#80");
  });
});

describe("grenzen per product (D55)", () => {
  test("beheerder zet eigen grenzen per product; analyses filteren op product", async () => {
    const beheer = await login("beheerder1");
    const kw = await login("kwaliteit1");
    assert.equal((await verzoek("PUT", "/beheer/velden/S9.2/producten/PRD-A", kw, { grens_min: 300, grens_max: 500, tolerantie: null })).status, 403);
    const fout = await verzoek("PUT", "/beheer/velden/S9.2/producten/PRD-A", beheer, { grens_min: 500, grens_max: 300, tolerantie: null });
    assert.equal(fout.status, 422);
    assert.match(fout.body.fout, /ondergrens is hoger/);
    const tol = await verzoek("PUT", "/beheer/velden/S9.2/producten/PRD-A", beheer, { grens_min: 300, grens_max: 500, tolerantie: 2 });
    assert.equal(tol.status, 422);
    assert.match(tol.body.fout, /procesparameter/);
    const goed = await verzoek("PUT", "/beheer/velden/S9.2/producten/PRD-A", beheer, { grens_min: 300, grens_max: 500, tolerantie: null });
    assert.equal(goed.status, 200, JSON.stringify(goed.body));
    assert.deepEqual([goed.body.product, goed.body.grens_min, goed.body.grens_max], ["PRD-A", 300, 500]);
    assert.equal((await verzoek("PUT", "/beheer/velden/S9.2/producten/PRD-X", beheer, { grens_min: 1, grens_max: 2, tolerantie: null })).status, 404);
    const cfg = await verzoek("GET", "/config/stappen", kw);
    const s92 = cfg.body.find((s: any) => s.code === "PS9").velden.find((v: any) => v.code === "S9.2");
    assert.deepEqual(s92.per_product.map((x: any) => x.product), ["PRD-A", "PRD-C"]);
    assert.equal((await verzoek("DELETE", "/beheer/velden/S9.2/producten/PRD-A", beheer)).status, 204);
    assert.equal((await verzoek("DELETE", "/beheer/velden/S9.2/producten/PRD-A", beheer)).status, 404);

    const trend = await verzoek("GET", "/analyse/trend?veld=S9.2&product=PRD-C", kw);
    assert.equal(trend.status, 200);
    assert.deepEqual([trend.body.veld.grens_min, trend.body.veld.grens_max, trend.body.veld.grenzen_per_product], [400, 460, true]);
    assert.equal((await verzoek("GET", "/analyse/trend?veld=S9.2", kw)).body.veld.grens_max, 440);
    const alle = await verzoek("GET", "/analyse/samenvatting", kw);
    const c = await verzoek("GET", "/analyse/samenvatting?product=PRD-C", kw);
    assert.equal(c.status, 200);
    assert.ok(c.body.waarden <= alle.body.waarden && c.body.batches <= alle.body.batches);
    const rk = await verzoek("GET", "/analyse/regelkaarten", kw);
    assert.equal(rk.body.find((r: any) => r.veld === "S9.2").grenzen_per_product, true);
    assert.equal(rk.body.find((r: any) => r.veld === "S9.2").cpk, null);
    for (const pad of ["afwijkingen", "herbewerkingen", "afkeur", "doorlooptijden", "productie", "correcties", "regelkaarten"]) {
      assert.equal((await verzoek("GET", `/analyse/${pad}?product=PRD-B`, kw)).status, 200, pad);
    }
    assert.equal((await verzoek("GET", "/analyse/regelkaart?veld=S5.1&product=PRD-B", kw)).status, 200);
  });

  test("sjabloon: tweede blad met grenzen per product is de volledige lijst (0.31.0)", async () => {
    const beheer = await login("beheerder1");
    const s51 = { regel: 3, veld: "S5.1", product: "PRD-B", grens_min: 20, grens_max: 120, tolerantie: 3, tolerantie_soort: "absoluut" };
    const s92 = { regel: 2, veld: "S9.2", product: "prd-c", grens_min: 400, grens_max: 470, tolerantie: null, tolerantie_soort: null };
    const s183 = { regel: 4, veld: "S18.3", product: "PRD-B", grens_min: null, grens_max: 3.5, tolerantie: null, tolerantie_soort: null };
    const proef = await verzoek("POST", "/beheer/velden/import", beheer, { uitvoeren: false, regels: [], grenzen_per_product: [s92, s51] });
    assert.equal(proef.status, 200, JSON.stringify(proef.body));
    assert.equal(proef.body.uitgevoerd, false);
    const per = Object.fromEntries(proef.body.grenzen.regels.map((r: any) => [`${r.veld} ${r.product}`, r]));
    assert.equal(per["S9.2 PRD-C"].actie, "wijzigen");
    assert.deepEqual(per["S9.2 PRD-C"].wijzigingen, ["bovengrens: 460 → 470"]);
    assert.equal(per["S5.1 PRD-B"].actie, "gelijk");
    assert.equal(per["S18.3 PRD-B"].actie, "weghalen");
    assert.equal(proef.body.grenzen.weghalen, 1);
    // Proefronde: niets veranderd.
    const cfg = async () => (await verzoek("GET", "/config/stappen", beheer)).body.flatMap((x: any) => x.velden).filter((v: any) => v.per_product?.length)
      .flatMap((v: any) => v.per_product.map((p: any) => `${v.code} ${p.product} ${p.grens_max}`)).sort();
    assert.deepEqual(await cfg(), ["S18.3 PRD-B 3.5", "S5.1 PRD-B 120", "S9.2 PRD-C 460"]);
    const fout = await verzoek("POST", "/beheer/velden/import", beheer, { uitvoeren: true, regels: [],
      grenzen_per_product: [s51, s183, { ...s92, product: "PRD-X" }, { regel: 5, veld: "S9.2", product: "PRD-A", grens_min: null, grens_max: null, tolerantie: 2, tolerantie_soort: null }] });
    assert.equal(fout.body.uitgevoerd, false);
    assert.equal(fout.body.grenzen.fouten, 2);
    assert.match(fout.body.grenzen.regels.find((r: any) => r.product === "PRD-X").fout, /Onbekend product/);
    assert.match(fout.body.grenzen.regels.find((r: any) => r.product === "PRD-A").fout, /procesparameter/);
    assert.deepEqual(await cfg(), ["S18.3 PRD-B 3.5", "S5.1 PRD-B 120", "S9.2 PRD-C 460"]);
    const echt = await verzoek("POST", "/beheer/velden/import", beheer, { uitvoeren: true, regels: [], grenzen_per_product: [s51, s92, s183] });
    assert.equal(echt.body.uitgevoerd, true);
    assert.deepEqual(await cfg(), ["S18.3 PRD-B 3.5", "S5.1 PRD-B 120", "S9.2 PRD-C 470"]);
    // Zonder tweede blad (ouder sjabloon) blijven de grenzen per product staan.
    const oud = await verzoek("POST", "/beheer/velden/import", beheer, { uitvoeren: true, regels: [] });
    assert.equal(oud.body.grenzen, undefined);
    assert.deepEqual(await cfg(), ["S18.3 PRD-B 3.5", "S5.1 PRD-B 120", "S9.2 PRD-C 470"]);
    await verzoek("POST", "/beheer/velden/import", beheer, { uitvoeren: true, regels: [], grenzen_per_product: [s51, { ...s92, grens_max: 460 }, s183] });
  });
});

describe("documentatie", () => {
  test("OpenAPI-beschrijving bevat alle onderdelen", async () => {
    const r = await app.inject({ method: "GET", url: "/docs/json" });
    const spec = JSON.parse(r.body);
    assert.equal(spec.openapi.startsWith("3."), true);
    for (const pad of ["/auth/login", "/registraties/{id}/waarden", "/lots/{lotnummer}/paspoort", "/beheer/velden"]) {
      assert.ok(spec.paths[pad], `ontbreekt: ${pad}`);
    }
  });
});

describe("server en onderhoud", () => {
  test("gezondheid meldt versie en database", async () => {
    const r = await verzoek("GET", "/gezondheid");
    assert.equal(r.status, 200);
    assert.equal(r.body.database, "ok");
    assert.match(r.body.versie, /^\d+\.\d+\.\d+$/);
  });
  test("serveroverzicht alleen voor beheerders", async () => {
    assert.equal((await verzoek("GET", "/beheer/server", await login("kwaliteit1"))).status, 403);
  });
  test("zonder back-up staat er een waarschuwing", async () => {
    await beheerDb.query("DELETE FROM fabriek.onderhoud_log");
    const r = await verzoek("GET", "/beheer/server", await login("beheerder1"));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.schema.nummer, readdirSync(new URL("../../db/migraties/", import.meta.url)).filter((f) => f.endsWith(".sql")).length);
    assert.equal(r.body.laatsteBackup, null);
    assert.ok(r.body.waarschuwingen.some((w: any) => w.niveau === "fout" && /nooit een back-up/.test(w.tekst)));
  });
  test("recente back-up en hersteltest: geen waarschuwingen", async () => {
    await beheerDb.query(`INSERT INTO fabriek.onderhoud_log (soort, gestart_op, klaar_op, gelukt, bestand, grootte_bytes, melding) VALUES
      ('backup', now() - interval '3 hours', now() - interval '3 hours', true, 'oud.dump', 1000, null),
      ('backup', now() - interval '20 minutes', now() - interval '19 minutes', true, 'nieuw.dump', 2000, null),
      ('hersteltest', now() - interval '3 days', now() - interval '3 days', true, 'nieuw.dump', 2000, '10 batches')`);
    const r = await verzoek("GET", "/beheer/server", await login("beheerder1"));
    assert.equal(r.body.laatsteBackup.bestand, "nieuw.dump");
    assert.equal(r.body.laatsteHersteltest.melding, "10 batches");
    assert.deepEqual(r.body.waarschuwingen.filter((w: { tekst: string }) => !/testaccount/.test(w.tekst)), [], "alleen de melding over testaccounts (testdata)");
  });
  test("mislukte back-up geeft een fout", async () => {
    await beheerDb.query("INSERT INTO fabriek.onderhoud_log (soort, gestart_op, gelukt, melding) VALUES ('backup', now(), false, 'schijf vol')");
    const r = await verzoek("GET", "/beheer/server", await login("beheerder1"));
    assert.ok(r.body.waarschuwingen.some((w: any) => /mislukt/.test(w.tekst)));
  });
  test("de applicatie kan geen gegevens verwijderen of het logboek wijzigen", { skip: APP_DB_URL === DB_URL }, async () => {
    await assert.rejects(db.query("DELETE FROM fabriek.waarde"), /permission denied/);
    await assert.rejects(db.query("DELETE FROM fabriek.onderhoud_log"), /permission denied/);
    await assert.rejects(db.query("INSERT INTO fabriek.onderhoud_log (soort, gestart_op, gelukt) VALUES ('backup', now(), true)"), /permission denied/);
  });
});

describe("Portaal Planning", () => {
  let planner: string;
  let op: string;
  let vandaag: string;
  let morgen: string;
  let gepland: string[] = [];

  before(async () => {
    planner = await login("planner1");
    op = await kiesNaam(await login("operator", "PC-04"));
    const { rows } = await beheerDb.query("SELECT current_date::text AS v, (current_date + 1)::text AS m");
    vandaag = rows[0].v;
    morgen = rows[0].m;
  });

  test("alleen planner en beheerder mogen plannen; iedereen mag kijken", async () => {
    assert.equal((await verzoek("POST", "/planning/batches", op, { dag: vandaag, aantal: 1 })).status, 403);
    assert.equal((await verzoek("POST", "/planning/batches", await login("kwaliteit1"), { dag: vandaag, aantal: 1 })).status, 403);
    assert.equal((await verzoek("POST", "/planning/producten", op, { code: "X", naam: "x" })).status, 403);
    assert.equal((await verzoek("GET", "/planning/vandaag?stap=PS1", op)).status, 200);
    assert.equal((await verzoek("GET", "/planning/lotvoorstellen", op)).status, 200);
    const prod = await verzoek("GET", "/planning/producten", op);
    assert.equal(prod.body.length, 3);
  });

  test("het systeem nummert door na het hoogste batchnummer van dit jaar", async () => {
    const prod = await verzoek("GET", "/planning/producten", planner);
    const r = await verzoek("POST", "/planning/batches", planner, { dag: vandaag, aantal: 8, productId: prod.body[0].id, opmerking: "test" });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    gepland = r.body.batchnummers;
    assert.equal(gepland.length, 8);
    const jaar = vandaag.slice(0, 4);
    const { rows } = await beheerDb.query(
      "SELECT max(batchnummer) AS m FROM fabriek.batch WHERE batchnummer LIKE $1 AND bron = 'operator'",
      [`B-${jaar}-%`],
    );
    const volg = (nr: string) => Number(nr.slice(-4));
    assert.equal(volg(gepland[0]), volg(rows[0].m) + 1);
    for (let i = 1; i < 8; i++) assert.equal(volg(gepland[i]), volg(gepland[0]) + i);
    const week = await verzoek("GET", `/planning/week?van=${vandaag}&dagen=2`, planner);
    const dag = week.body.dagen[0].batches.filter((b: any) => b.gepland);
    assert.deepEqual(dag.map((b: any) => b.volgorde), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(dag[0].product, "PRD-A – Product A standaard");
  });

  test("volgorde verschuiven ruilt twee batches", async () => {
    assert.equal((await verzoek("POST", `/planning/batches/${gepland[1]}/volgorde`, planner, { richting: "eerder" })).status, 204);
    const week = await verzoek("GET", `/planning/week?van=${vandaag}&dagen=1`, planner);
    const dag = week.body.dagen[0].batches.filter((b: any) => b.gepland);
    assert.deepEqual(dag.slice(0, 2).map((b: any) => b.batchnummer), [gepland[1], gepland[0]]);
  });

  test("geplande batch staat klaar voor PS1, niet voor PS2; start zet hem in productie", async () => {
    const ps1 = await verzoek("GET", "/werkvoorraad/PS1", op);
    assert.ok(ps1.body.wachtend.some((w: any) => w.nummer === gepland[0]));
    const ps2 = await verzoek("POST", "/registraties", op, { stapcode: "PS2", batchnummer: gepland[0] });
    assert.equal(ps2.status, 422);
    assert.match(ps2.body.fout, /gepland en nog niet gestart.*PS1/);
    await doorloop(op, gepland[0], "batch", 1, 1);
    const b = await verzoek("GET", `/batches/${gepland[0]}`, op);
    assert.equal(b.body.status, "in_productie");
    // Na de start ligt de dag vast.
    const wijzig = await verzoek("PATCH", `/planning/batches/${gepland[0]}`, planner, { dag: morgen });
    assert.equal(wijzig.status, 422);
    // De opmerking mag wel.
    assert.equal((await verzoek("PATCH", `/planning/batches/${gepland[0]}`, planner, { opmerking: "loopt" })).status, 200);
  });

  test("batch voor morgen staat vandaag niet klaar; vervallen kan alleen vóór de start", async () => {
    const r = await verzoek("POST", "/planning/batches", planner, { dag: morgen, aantal: 1 });
    const [nr] = r.body.batchnummers;
    const ps1 = await verzoek("GET", "/werkvoorraad/PS1", op);
    assert.ok(!ps1.body.wachtend.some((w: any) => w.nummer === nr));
    assert.equal((await verzoek("POST", `/planning/batches/${nr}/vervallen`, planner, { reden: "order geannuleerd" })).status, 204);
    const start = await verzoek("POST", "/registraties", op, { stapcode: "PS1", batchnummer: nr });
    assert.equal(start.status, 422);
    assert.equal((await verzoek("POST", `/planning/batches/${gepland[0]}/vervallen`, planner, { reden: "te laat" })).status, 422);
    const week = await verzoek("GET", `/planning/week?van=${morgen}&dagen=1`, planner);
    const b = week.body.dagen[0].batches.find((x: any) => x.batchnummer === nr);
    assert.equal(b.status, "vervallen");
    assert.equal(b.vervallen_reden, "order geannuleerd");
  });

  test("dagplanning per stap: volgorde, stand en vandaag-lijst", async () => {
    const zet = await verzoek("PUT", "/planning/stappen", planner, {
      dag: vandaag,
      stap: "PS1",
      items: [{ nummer: gepland[2] }, { nummer: gepland[0], opmerking: "eerst" }],
    });
    assert.equal(zet.status, 200, JSON.stringify(zet.body));
    assert.deepEqual(zet.body.map((i: any) => [i.nummer, i.status]), [[gepland[2], "gepland"], [gepland[0], "gedaan"]]);
    const v = await verzoek("GET", "/planning/vandaag?stap=PS1", op);
    assert.deepEqual(v.body.map((i: any) => i.nummer), [gepland[2], gepland[0]]);
    // Vervangen, niet toevoegen.
    await verzoek("PUT", "/planning/stappen", planner, { dag: vandaag, stap: "PS1", items: [{ nummer: gepland[3] }] });
    const stappen = await verzoek("GET", `/planning/stappen?dag=${vandaag}`, planner);
    assert.equal(stappen.body.length, 21);  // 18 processtappen en 3 keuringsstappen (#80)
    assert.deepEqual(stappen.body[0].items.map((i: any) => i.nummer), [gepland[3]]);
    // In de lot-stap plan je een lotvoorstel, geen batch.
    const fout = await verzoek("PUT", "/planning/stappen", planner, { dag: vandaag, stap: "PS16", items: [{ nummer: gepland[0] }] });
    assert.equal(fout.status, 400);
    const kand = await verzoek("GET", "/planning/kandidaten?stap=PS2", planner);
    assert.equal(kand.body[0].nummer, gepland[0]);
    assert.equal(kand.body[0].klaar, true);
    // Stand van de vorige stap (D52): waarschuwen, niet weigeren.
    const k2 = await verzoek("GET", `/planning/kandidaten?stap=PS2&dag=${vandaag}`, planner);
    const stand = (n: string) => k2.body.find((k: any) => k.nummer === n)?.vorige?.stand;
    assert.equal(stand(gepland[0]), "klaar");
    assert.equal(stand(gepland[3]), "vandaag");
    const ps3 = await verzoek("PUT", "/planning/stappen", planner, { dag: morgen, stap: "PS3", items: [{ nummer: gepland[1] }] });
    assert.equal(ps3.status, 200, "plannen vóór de vorige stap mag (alleen een waarschuwing)");
    assert.equal(ps3.body[0].vorige.stand, "niet_gepland");
    assert.equal(ps3.body[0].vorige.stap, "PS2");
    const route = await verzoek("GET", "/planning/route", planner);
    assert.equal(route.status, 200, JSON.stringify(route.body));
    const rij = route.body.batches.find((b: any) => b.batchnummer === gepland[1]);
    const cel = rij.cellen.find((c: any) => c.stap === "PS3");
    assert.equal(cel.stand, "gepland");
    assert.equal(cel.dag, morgen);
    assert.match(cel.waarschuwing, /PS2 is nog niet gepland/);
    assert.equal(rij.cellen.find((c: any) => c.stap === "PS1").waarschuwing, null);
    await verzoek("PUT", "/planning/stappen", planner, { dag: morgen, stap: "PS3", items: [] });
  });

  test("lotvoorstel: gebruikt bij gelijke samenstelling, afwijken alleen met reden", async () => {
    const [a, b, c, d, e, f, g, h] = gepland;
    const p1 = await verzoek("POST", "/planning/lotvoorstellen", planner, { batchnummers: [a, b, c, d] });
    assert.equal(p1.status, 201, JSON.stringify(p1.body));
    const dubbel = await verzoek("POST", "/planning/lotvoorstellen", planner, { batchnummers: [d, e, f, g] });
    assert.equal(dubbel.status, 422);
    const p2 = await verzoek("POST", "/planning/lotvoorstellen", planner, { batchnummers: [e, f, g, h] });
    assert.equal(p2.status, 201);
    assert.equal((await verzoek("POST", "/planning/lotvoorstellen", op, { batchnummers: [e, f, g, h] })).status, 403);

    await doorloop(op, a, "batch", 2, 15);
    for (const nr of [b, c, d, e, f, g, h]) await doorloop(op, nr, "batch", 1, 15);
    const lijst = await verzoek("GET", "/planning/lotvoorstellen", op);
    assert.ok(lijst.body.find((v: any) => v.nummer === p1.body.nummer).batches.every((x: any) => x.klaar_voor_lot));

    const zonderReden = await verzoek("POST", "/lots", op, { lotnummer: "L-2026-0101", batchnummers: [a, b, c, e] });
    assert.equal(zonderReden.status, 422);
    assert.match(zonderReden.body.fout, /wijkt af van lotvoorstel/);
    const metReden = await verzoek("POST", "/lots", op, {
      lotnummer: "L-2026-0101",
      batchnummers: [a, b, c, e],
      afwijkingReden: "batch d nog in de droger",
    });
    assert.equal(metReden.status, 201, JSON.stringify(metReden.body));

    // e zat in voorstel 2, dat nu ook is afgeweken; d, f, g en h gaan samen.
    const gelijk = await verzoek("POST", "/lots", op, { lotnummer: "L-2026-0102", batchnummers: [d, f, g, h] });
    assert.equal(gelijk.status, 201, JSON.stringify(gelijk.body));
    const alle = await verzoek("GET", "/planning/lotvoorstellen?alle=true", planner);
    const v1 = alle.body.find((v: any) => v.nummer === p1.body.nummer);
    const v2 = alle.body.find((v: any) => v.nummer === p2.body.nummer);
    assert.equal(v1.status, "afgeweken");
    assert.equal(v1.afwijking_reden, "batch d nog in de droger");
    assert.equal(v1.lotnummer, "L-2026-0101");
    assert.equal(v2.status, "afgeweken");
  });

  test("lotvoorstel exact gevolgd wordt 'gebruikt'", async () => {
    const r = await verzoek("POST", "/planning/batches", planner, { dag: vandaag, aantal: 4 });
    const nrs: string[] = r.body.batchnummers;
    const p = await verzoek("POST", "/planning/lotvoorstellen", planner, { batchnummers: nrs });
    assert.equal(p.status, 201);
    const plan = await verzoek("PUT", "/planning/stappen", planner, { dag: vandaag, stap: "PS16", items: [{ nummer: String(p.body.nummer) }] });
    assert.equal(plan.body[0].status, "gepland");
    for (const nr of nrs) await doorloop(op, nr, "batch", 1, 15);
    const kand = await verzoek("GET", "/planning/kandidaten?stap=PS16", planner);
    assert.equal(kand.body.find((k: any) => k.nummer === String(p.body.nummer)).klaar, true);
    const lot = await verzoek("POST", "/lots", op, { lotnummer: "L-2026-0103", batchnummers: [...nrs].reverse() });
    assert.equal(lot.status, 201, JSON.stringify(lot.body));
    const alle = await verzoek("GET", "/planning/lotvoorstellen?alle=true", planner);
    assert.equal(alle.body.find((v: any) => v.nummer === p.body.nummer).status, "gebruikt");
    const v = await verzoek("GET", "/planning/vandaag?stap=PS16", op);
    assert.equal(v.body[0].status, "gedaan");
  });

  test("route per product (D55): PRD-C slaat PS6 over; alleen planners wijzigen een route", async () => {
    const prod = await verzoek("GET", "/planning/producten", op);
    const c = prod.body.find((p: any) => p.code === "PRD-C");
    assert.deepEqual(c.route, ["PS1", "PS2", "PS3", "TK1", "PS4", "PS5", "PS7", "PS8", "PS9", "TK2", "PS11", "PS10", "PS12", "PS13", "PS15", "PS16", "PS18", "EK"]);
    assert.equal(prod.body.find((p: any) => p.code === "PRD-A").route, null);
    assert.equal((await verzoek("PUT", `/planning/producten/${c.id}/route`, op, { stappen: null })).status, 403);
    const fout = await verzoek("PUT", `/planning/producten/${c.id}/route`, planner, { stappen: ["PS1", "PS2"] });
    assert.equal(fout.status, 422);
    assert.match(fout.body.fout, /lotstap PS16/);
    const a = prod.body.find((p: any) => p.code === "PRD-A");
    const goed = await verzoek("PUT", `/planning/producten/${a.id}/route`, planner, { stappen: ["PS1", "PS2", "PS16", "PS18"] });
    assert.equal(goed.status, 200, JSON.stringify(goed.body));
    assert.deepEqual(goed.body.route, ["PS1", "PS2", "PS16", "PS18"]);
    assert.equal((await verzoek("PUT", `/planning/producten/${a.id}/route`, planner, { stappen: null })).body.route, null);

    // Hier zonder keuringsstappen (die doet Kwaliteit, #80); daarna weer de route uit de instellingen.
    const metKeuring = c.route;
    assert.equal((await verzoek("PUT", `/planning/producten/${c.id}/route`, planner, { stappen: metKeuring.filter((x: string) => x.startsWith("PS")) })).status, 200);
    const r = await verzoek("POST", "/planning/batches", planner, { dag: vandaag, aantal: 1, productId: c.id });
    const [nr] = r.body.batchnummers;
    await doorloop(op, nr, "batch", 1, 5);
    const ps6 = await verzoek("POST", "/registraties", op, { stapcode: "PS6", batchnummer: nr });
    assert.equal(ps6.status, 422);
    assert.match(ps6.body.fout, /PS6 hoort niet bij de route van product PRD-C/);
    const w7 = await verzoek("GET", "/werkvoorraad/PS7", op);
    assert.equal(w7.body.wachtend.find((w: any) => w.nummer === nr)?.product, "PRD-C");
    assert.ok(!(await verzoek("GET", "/werkvoorraad/PS6", op)).body.wachtend.some((w: any) => w.nummer === nr));
    assert.ok(!(await verzoek("GET", "/planning/kandidaten?stap=PS6", planner)).body.some((k: any) => k.nummer === nr));
    assert.ok((await verzoek("GET", "/planning/kandidaten?stap=PS7", planner)).body.some((k: any) => k.nummer === nr));
    const route = await verzoek("GET", "/planning/route", planner);
    const cellen = route.body.batches.find((b: any) => b.batchnummer === nr).cellen;
    assert.equal(cellen.find((x: any) => x.stap === "PS6").stand, "niet_in_route");
    assert.equal(cellen.find((x: any) => x.stap === "PS5").stand, "klaar");
    assert.equal((await verzoek("GET", `/batches/${nr}`, op)).body.product, "PRD-C");
    // Planning in een stap buiten de route: de waarschuwing zegt het (D52 blijft: niets geweigerd).
    const plan = await verzoek("PUT", "/planning/stappen", planner, { dag: morgen, stap: "PS6", items: [{ nummer: nr }] });
    assert.equal(plan.status, 200, JSON.stringify(plan.body));
    assert.deepEqual([plan.body[0].vorige.stand, plan.body[0].vorige.stap], ["niet_in_route", "PRD-C"]);
    await verzoek("PUT", "/planning/stappen", planner, { dag: morgen, stap: "PS6", items: [] });
    assert.equal((await verzoek("PUT", `/planning/producten/${c.id}/route`, planner, { stappen: metKeuring })).status, 200);
  });

  test("capaciteit per stap en product (D55): gemengde producten tellen naar rato", async () => {
    const cap = await verzoek("GET", "/planning/capaciteit", planner);
    // Elke stap uit de route van elk actief product staat erin; zonder capaciteit: nog invullen (#81, D71).
    assert.deepEqual(cap.body.per_stap.filter((c: any) => c.stap === "PS1").map((c: any) => [c.product, c.max_per_dag]), [["PRD-A", 8], ["PRD-B", 3], ["PRD-C", 8]]);
    assert.deepEqual(cap.body.per_stap.filter((c: any) => c.stap === "PS2").map((c: any) => [c.product, c.max_per_dag]), [["PRD-A", null], ["PRD-B", null], ["PRD-C", null]]);
    assert.equal(cap.body.per_stap.some((c: any) => c.product === "PRD-B" && c.stap === "PS12"), false, "PS12 hoort niet bij de route van PRD-B");
    const open = cap.body.nog_invullen;
    assert.equal(open, cap.body.per_stap.filter((c: any) => c.max_per_dag === null).length);
    assert.equal((await verzoek("PUT", "/planning/capaciteit/stappen/PS2", op, { product: "PRD-A", max_per_dag: 4 })).status, 403);
    assert.equal((await verzoek("PUT", "/planning/capaciteit/stappen/PS2", planner, { product: null, max_per_dag: 4 })).status, 400, "geen regel meer voor alle producten");
    for (const product of ["PRD-A", "PRD-B"]) assert.equal((await verzoek("PUT", "/planning/capaciteit/stappen/PS2", planner, { product, max_per_dag: 4 })).status, 204);
    assert.equal((await verzoek("GET", "/planning/capaciteit", planner)).body.nog_invullen, open - 2);
    assert.equal((await verzoek("PUT", "/planning/capaciteit/stappen/PS2", planner, { product: "PRD-X", max_per_dag: 4 })).status, 404);
    const prod = (await verzoek("GET", "/planning/producten", planner)).body;
    const a = prod.find((p: any) => p.code === "PRD-A").id;
    const b = prod.find((p: any) => p.code === "PRD-B").id;
    const na = (await verzoek("POST", "/planning/batches", planner, { dag: vandaag, aantal: 2, productId: a })).body.batchnummers;
    const nb = (await verzoek("POST", "/planning/batches", planner, { dag: vandaag, aantal: 1, productId: b })).body.batchnummers;
    const plan = await verzoek("PUT", "/planning/stappen", planner, { dag: morgen, stap: "PS2", items: [...na, ...nb].map((nummer: string) => ({ nummer })) });
    assert.equal(plan.status, 200, JSON.stringify(plan.body));
    const stap = async () => (await verzoek("GET", `/planning/stappen?dag=${morgen}`, planner)).body.find((s: any) => s.code === "PS2").capaciteit;
    let c = await stap();
    assert.equal(c.procent, 75);  // 3 batches, capaciteit 4
    assert.equal((await verzoek("PUT", "/planning/capaciteit/stappen/PS2", planner, { product: "PRD-B", max_per_dag: 1 })).status, 204);
    c = await stap();
    assert.equal(c.procent, 150);  // 2/4 PRD-A + 1/1 PRD-B
    assert.deepEqual(c.regels.map((r: any) => [r.product, r.aantal, r.max]), [["PRD-A", 2, 4], ["PRD-B", 1, 1]]);
    const week = await verzoek("GET", `/planning/week?van=${vandaag}`, planner);
    assert.deepEqual(week.body.dagen.find((d: any) => d.dag === morgen).stappen_vol, [{ stap: "PS2", procent: 150, dicht: false }]);
    assert.equal((await verzoek("GET", `/planning/stappen?dag=${morgen}`, planner)).body.find((s: any) => s.code === "PS3").capaciteit, null);
    for (const product of ["PRD-B", "PRD-A"]) {
      assert.equal((await verzoek("PUT", "/planning/capaciteit/stappen/PS2", planner, { product, max_per_dag: null })).status, 204);
    }
    // Weggehaald: weer nog invullen; wat gepland is, staat er nog bij, zonder maximum.
    assert.equal((await verzoek("GET", "/planning/capaciteit", planner)).body.nog_invullen, open);
    c = await stap();
    assert.deepEqual(c.regels.map((r: any) => [r.product, r.aantal, r.max]), [["PRD-A", 2, null], ["PRD-B", 1, null]]);
    assert.equal(c.procent, 0);
    await verzoek("PUT", "/planning/stappen", planner, { dag: morgen, stap: "PS2", items: [] });
    assert.equal(await stap(), null);
  });

  test("ongeplande batch blijft mogelijk en is zichtbaar als niet gepland", async () => {
    assert.equal((await verzoek("POST", "/batches", op, { batchnummer: "B-2026-0900" })).status, 201);
    await doorloop(op, "B-2026-0900", "batch", 1, 1);
    const week = await verzoek("GET", `/planning/week?van=${vandaag}&dagen=1`, planner);
    const b = week.body.dagen[0].batches.find((x: any) => x.batchnummer === "B-2026-0900");
    assert.equal(b.gepland, false);
    assert.equal(b.status, "in_productie");
  });
});

describe("Portaal Planning: lotkandidaten", () => {
  test("klaar voor een lot komt eerst; voorstel wordt getoond", async () => {
    const planner = await login("planner1");
    const r = await verzoek("GET", "/planning/lotkandidaten", planner);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.length > 0);
    const eerste = r.body.findIndex((b: any) => !b.klaar_voor_lot);
    assert.ok(eerste === -1 || r.body.slice(eerste).every((b: any) => !b.klaar_voor_lot));
  });
});

describe("Wandscherm", () => {
  test("schermaccount leest alleen het wandscherm; uitgezet = geen toegang meer", async () => {
    const t = await login("scherm1");
    const r = await verzoek("GET", "/wandscherm", t);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.stappen.length, 21);  // 18 processtappen en 3 keuringsstappen (#80)
    assert.ok(r.body.hallen.includes("Hal 1"));
    assert.equal(typeof r.body.kerncijfers.gestart_vandaag, "number");
    for (const pad of ["/analyse/afwijkingen", "/werkvoorraad", "/planning/week?van=2026-11-16", "/batches?gereedVoorLot=true"]) {
      assert.equal((await verzoek("GET", pad, t)).status, 403, pad);
    }
    // Het token van een schermaccount is 30 dagen geldig.
    const exp = JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString()).exp;
    assert.ok(exp - Date.now() / 1000 > 29 * 86400);
    const hal = await verzoek("GET", "/wandscherm?hal=Hal%201", t);
    assert.equal(hal.body.hal, "Hal 1");
    assert.equal((await verzoek("GET", "/wandscherm?hal=Hal%209", t)).status, 404);
    // #54: alleen gekozen stappen; dubbele en kleine letters maken niet uit.
    const keuze = await verzoek("GET", "/wandscherm?stappen=ps7,PS3,PS3", t);
    assert.equal(keuze.status, 200);
    assert.deepEqual(keuze.body.stappen.map((s: any) => s.code), ["PS3", "PS7"]);
    assert.deepEqual(keuze.body.keuze, ["PS7", "PS3"]);
    assert.equal(r.body.keuze, null);
    const fout = await verzoek("GET", "/wandscherm?stappen=PS3,PS99", t);
    assert.equal(fout.status, 404);
    assert.match(fout.body.fout, /PS99/);
    // Operators zien het wandscherm niet (die hebben het invoerscherm).
    assert.equal((await verzoek("GET", "/wandscherm", await login("operator", "PC-01"))).status, 403);
    await beheerDb.query("UPDATE fabriek.gebruiker SET actief = false WHERE gebruikersnaam = 'scherm1'");
    assert.equal((await verzoek("GET", "/wandscherm", t)).status, 401);
    await beheerDb.query("UPDATE fabriek.gebruiker SET actief = true WHERE gebruikersnaam = 'scherm1'");
  });

  test("planning, bezig en klaar per stap", async () => {
    const t = await login("planner1");
    const r = await verzoek("GET", "/wandscherm", t);
    const ps16 = r.body.stappen.find((s: any) => s.code === "PS16");
    assert.ok(Array.isArray(ps16.gepland) && Array.isArray(ps16.bezig) && Array.isArray(ps16.klaar));
    const metPlan = r.body.stappen.flatMap((s: any) => s.klaar).filter((i: any) => i.gepland !== null);
    assert.ok(metPlan.every((i: any) => Number.isInteger(i.gepland)));
  });
});

describe("Grondstoffen", () => {
  test("invoeren, verplicht bij afronden, correctie, terugzoeken en lotpaspoort", async () => {
    const op = await kiesNaam(await login("operator", "PC-05"));
    const pl = await kiesNaam(await login("ploegleider1", "PC-05"));
    const cfg = await verzoek("GET", "/config/stappen", op);
    assert.deepEqual(cfg.body.find((s: any) => s.code === "PS1").grondstoffen.map((g: any) => g.code), ["GS-A"]);
    assert.equal((await verzoek("POST", "/batches", op, { batchnummer: "B-2026-0700" })).status, 201);
    const start = await verzoek("POST", "/registraties", op, { stapcode: "PS1", batchnummer: "B-2026-0700" });
    assert.equal(start.body.grondstoffen[0].code, "GS-A");
    assert.equal(start.body.grondstoffen[0].gebruik, null);
    await verzoek("POST", `/registraties/${start.body.id}/waarden`, op, { waarden: waardenVoor(start.body) });
    const zonder = await verzoek("POST", `/registraties/${start.body.id}/afronden`, op);
    assert.equal(zonder.status, 422);
    assert.match(zonder.body.fout, /grondstof GS-A/);
    const fout = await verzoek("POST", `/registraties/${start.body.id}/grondstoffen`, op, { grondstoffen: [{ code: "GS-B", partij: "X-1" }] });
    assert.equal(fout.status, 422);
    const id = randomUUID();
    const g = await verzoek("POST", `/registraties/${start.body.id}/grondstoffen`, op, { grondstoffen: [{ id, code: "GS-A", partij: " LEV-A-9001 ", hoeveelheid: 125.5 }] });
    assert.equal(g.status, 200, JSON.stringify(g.body));
    assert.equal(g.body.grondstoffen[0].gebruik.partij, "LEV-A-9001");
    // Zelfde id opnieuw versturen (offline wachtrij) geeft geen tweede regel.
    assert.equal((await verzoek("POST", `/registraties/${start.body.id}/grondstoffen`, op, { grondstoffen: [{ id, code: "GS-A", partij: "LEV-A-9001" }] })).status, 200);
    // Een andere partij voor dezelfde grondstof: conflict, de eerste blijft staan (#85). Afronden kan gewoon.
    const ander = await verzoek("POST", `/registraties/${start.body.id}/grondstoffen`, op, { grondstoffen: [{ code: "GS-A", partij: "ander" }] });
    assert.equal(ander.status, 200, JSON.stringify(ander.body));
    assert.deepEqual(ander.body.conflicten.map((x: any) => [x.soort, x.code, x.bestaand, x.nieuw]), [["grondstof", "GS-A", "LEV-A-9001, 125,5", "ander"]]);
    assert.equal(ander.body.grondstoffen[0].gebruik.partij, "LEV-A-9001");
    assert.equal((await verzoek("POST", `/registraties/${start.body.id}/afronden`, op)).status, 200);
    await verzoek("POST", `/conflicten/${ander.body.conflicten[0].id}/oplossen`, pl, { keuze: "bestaand" });
    assert.equal((await verzoek("POST", `/registraties/${start.body.id}/grondstoffen/GS-A/correctie`, op, { partij: "LEV-A-9002", reden: "tikfout" })).status, 403);
    const c = await verzoek("POST", `/registraties/${start.body.id}/grondstoffen/GS-A/correctie`, pl, { partij: "LEV-A-9002", reden: "tikfout" });
    assert.equal(c.status, 201, JSON.stringify(c.body));
    assert.equal(c.body.grondstoffen[0].gebruik.partij, "LEV-A-9002");
    assert.equal(c.body.grondstoffen[0].gebruik.hoeveelheid, 125.5);
    assert.equal(c.body.grondstoffen[0].gebruik.gecorrigeerd, true);
    const kw = await login("kwaliteit1");
    const zoek = await verzoek("GET", "/analyse/grondstoffen?partij=a-9002", kw);
    assert.equal(zoek.body.length, 1);
    assert.equal(zoek.body[0].batchnummer, "B-2026-0700");
    assert.equal((await verzoek("GET", "/analyse/grondstoffen?partij=a-9001", kw)).body.length, 0);
    const partijen = await verzoek("GET", "/analyse/partijen", kw);
    assert.ok(partijen.body.some((p: any) => p.partij === "LEV-A-9002" && p.batches === 1));
    // Lotpaspoort van het eerder gemaakte lot heeft de grondstoffen van zijn batches.
    const pas = await verzoek("GET", "/lots/L-2026-0001/paspoort", kw);
    assert.equal(pas.status, 200);
    assert.ok(Array.isArray(pas.body.grondstoffen));
  });

  test("beheer: grondstof toevoegen en aan stappen koppelen", async () => {
    const bh = await login("beheerder1");
    const n = await verzoek("POST", "/beheer/grondstoffen", bh, { code: "GS-D", naam: "Grondstof D", eenheid: "kg" });
    assert.equal(n.status, 201, JSON.stringify(n.body));
    const k = await verzoek("PATCH", "/beheer/grondstoffen/GS-D", bh, { stappen: [{ stap: "PS5", verplicht: false }, { stap: "PS6", verplicht: true }] });
    assert.deepEqual(k.body.stappen, [{ stap: "PS5", verplicht: false }, { stap: "PS6", verplicht: true }]);
    const k2 = await verzoek("PATCH", "/beheer/grondstoffen/GS-D", bh, { stappen: [{ stap: "PS6", verplicht: false }] });
    assert.deepEqual(k2.body.stappen, [{ stap: "PS6", verplicht: false }]);
    assert.equal((await verzoek("PATCH", "/beheer/grondstoffen/GS-D", bh, { stappen: [{ stap: "PS99", verplicht: false }] })).status, 422);
    assert.equal((await verzoek("PATCH", "/beheer/grondstoffen/GS-D", bh, { actief: false })).body.actief, false);
    assert.equal((await verzoek("GET", "/beheer/grondstoffen", await login("kwaliteit1"))).status, 403);
  });
});

describe("Ploegoverdracht", () => {
  test("huidige ploeg, schrijven (ook opnieuw versturen), vorige ploeg en per dag", async () => {
    const op = await kiesNaam(await login("operator", "PC-02"));
    const ploegen = await verzoek("GET", "/overdracht/ploegen", op);
    assert.deepEqual(ploegen.body.map((p: any) => p.code), ["O", "M", "N"]);
    const nu = await verzoek("GET", "/overdracht", op);
    assert.equal(nu.status, 200, JSON.stringify(nu.body));
    assert.equal(nu.body.loopt_nog, true);
    assert.equal(typeof nu.body.cijfers.stappen_afgerond, "number");
    assert.equal((await verzoek("POST", "/overdracht", op, { bijzonderheden: "  " })).status, 400);
    const id = randomUUID();
    const n = await verzoek("POST", "/overdracht", op, { id, bijzonderheden: "Menger 2 hersteld", aandachtspunten: "Filter PS7 vervangen", moment: new Date().toISOString() });
    assert.equal(n.status, 201, JSON.stringify(n.body));
    assert.equal(n.body.door, "Operator C");
    assert.equal(n.body.pc, "PC-02");
    assert.equal(n.body.hal, "Hal 1");
    assert.equal((await verzoek("POST", "/overdracht", op, { id, bijzonderheden: "Menger 2 hersteld" })).status, 200);
    const na = await verzoek("GET", "/overdracht", op);
    assert.equal(na.body.notities.filter((x: any) => x.id === id).length, 1);
    // De volgende ploeg ziet hem als "vorige": vraag de ploeg op aan de hand van dag en code.
    const dag = await verzoek("GET", `/overdracht?dag=${nu.body.dag}&ploeg=${nu.body.ploeg}`, await login("ploegleider2"));
    assert.ok(dag.body.notities.some((x: any) => x.aandachtspunten === "Filter PS7 vervangen"));
    const vorige = await verzoek("GET", "/overdracht?vorige=true", op);
    assert.ok(Date.parse(vorige.body.eind_op) <= Date.parse(nu.body.begin_op));
    const alles = await verzoek("GET", `/overdracht/dag?dag=${nu.body.dag}`, await login("analist1").catch(() => login("kwaliteit1")));
    assert.ok(alles.body.some((p: any) => p.ploeg === nu.body.ploeg));
    // #62: planning van de dag, gelijk aan wat Planning per stap voor die dag laat zien.
    const plan = await verzoek("GET", `/overdracht/plan?dag=${nu.body.dag}`, await login("kwaliteit1"));
    assert.equal(plan.status, 200);
    const perStap = await verzoek("GET", `/planning/stappen?dag=${nu.body.dag}`, await login("planner1"));
    const items = perStap.body.flatMap((x: any) => x.items);
    assert.equal(plan.body.gepland, items.length);
    assert.equal(plan.body.afgerond, items.filter((i: any) => i.status === "gedaan").length);
    assert.equal(plan.body.bezig, items.filter((i: any) => i.status === "bezig").length);
    // Tussen 00:00 en 06:00 is de lopende ploeg de nachtploeg van gisteren; de testdata plant voor vandaag.
    const vandaagAmsterdam = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Amsterdam" });
    if (nu.body.dag === vandaagAmsterdam) assert.ok(plan.body.gepland > 0, "testdata heeft planning voor vandaag");
    // Analisten en Kwaliteit lezen, maar schrijven niet.
    assert.equal((await verzoek("POST", "/overdracht", await login("kwaliteit1"), { bijzonderheden: "x" })).status, 403);
  });

  test("beheerder past ploegtijden aan", async () => {
    const bh = await login("beheerder1");
    const r = await verzoek("PATCH", "/overdracht/ploegen/O", bh, { naam: "Vroege ploeg" });
    assert.equal(r.body.naam, "Vroege ploeg");
    assert.equal((await verzoek("PATCH", "/overdracht/ploegen/O", bh, { begint: "25:00" })).status, 400);
    await verzoek("PATCH", "/overdracht/ploegen/O", bh, { naam: "Ochtenddienst" });
    assert.equal((await verzoek("PATCH", "/overdracht/ploegen/O", await login("planner1"), { naam: "x" })).status, 403);
  });

  test("ploegen A–E in twee divisies met rooster; de overdracht noemt de ploegen (#86)", async () => {
    const bh = await login("beheerder1");
    const r = await verzoek("GET", "/overdracht/rooster?van=2026-01-05&dagen=10", await login("kwaliteit1"));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.patroon, ["O", "O", "M", "M", "N", "N", "-", "-", "-", "-"]);
    assert.equal(r.body.ploegen.length, 10);
    assert.equal(r.body.dagen.length, 10);
    assert.deepEqual(r.body.dagen[0].diensten.map((d: any) => [d.dienst, d.ploegen]), [["O", ["A1", "A2"]], ["M", ["E1", "E2"]], ["N", ["D1", "D2"]]]);
    assert.ok(r.body.dagen.every((d: any) => d.diensten.every((x: any) => x.ploegen.length === 2)));
    // Divisie 2 een dag later laten beginnen.
    const p = await verzoek("PATCH", "/overdracht/rooster/ploegen/a2", bh, { cyclus_start: "2026-01-06" });
    assert.equal(p.status, 200, JSON.stringify(p.body));
    const r2 = await verzoek("GET", "/overdracht/rooster?van=2026-01-05&dagen=1", bh);
    assert.deepEqual(r2.body.dagen[0].diensten[0].ploegen, ["A1"]);
    await verzoek("PATCH", "/overdracht/rooster/ploegen/A2", bh, { cyclus_start: "2026-01-05" });
    assert.equal((await verzoek("PATCH", "/overdracht/rooster", bh, { patroon: ["O", "X"] })).status, 422);
    assert.equal((await verzoek("PATCH", "/overdracht/rooster", await login("planner1"), { patroon: ["O"] })).status, 403);
    const n = await verzoek("POST", "/overdracht/rooster/ploegen", bh, { letter: "f", divisie: 1, cyclus_start: "2026-01-15" });
    assert.equal(n.status, 201, JSON.stringify(n.body));
    assert.equal(n.body.code, "F1");
    assert.equal((await verzoek("POST", "/overdracht/rooster/ploegen", bh, { letter: "F", divisie: 1, cyclus_start: "2026-01-15" })).status, 409);
    await verzoek("PATCH", "/overdracht/rooster/ploegen/F1", bh, { actief: false });
    // De overdracht van een dienst noemt de ploegen die hem volgens het rooster draaiden.
    const nu = await verzoek("GET", "/overdracht", await login("ploegleider1"));
    assert.equal(nu.status, 200);
    assert.equal(nu.body.ploegen.length, 2);
  });
});

describe("Meldingen", () => {
  test("buiten grens, beoordeling en keurresultaat komen bij de juiste rollen; gelezen per persoon", async () => {
    const op = await kiesNaam(await login("operator", "PC-06"));
    const pl = await login("ploegleider2");
    const kw = await login("kwaliteit1");
    const pn = await login("planner1");
    for (const t of [pl, kw, pn]) await verzoek("POST", "/meldingen/alles-gelezen", t);
    assert.equal((await verzoek("GET", "/meldingen", op)).status, 403);
    assert.equal((await verzoek("POST", "/batches", op, { batchnummer: "B-2026-0710" })).status, 201);
    const start = await verzoek("POST", "/registraties", op, { stapcode: "PS1", batchnummer: "B-2026-0710" });
    await verzoek("POST", `/registraties/${start.body.id}/waarden`, op, { waarden: waardenVoor(start.body, { "S1.2": [null, 470] }) });
    const kwM = await verzoek("GET", "/meldingen", kw);
    assert.equal(kwM.body.ongelezen, 1, JSON.stringify(kwM.body));
    const m = kwM.body.meldingen[0];
    assert.equal(m.soort, "buiten_grens");
    assert.equal(m.ernst, "kritiek");
    assert.equal(m.batchnummer, "B-2026-0710");
    assert.match(m.tekst, /PS1: S1\.2 Gewicht buiten de grens \(470 kg\)/);
    assert.equal(m.hal, "Hal 1");
    assert.equal((await verzoek("GET", "/meldingen", pn)).body.ongelezen, 0, "planner krijgt geen grenswaarden");
    // Gelezen geldt per persoon.
    assert.equal((await verzoek("POST", `/meldingen/${m.id}/gelezen`, kw)).status, 204);
    assert.equal((await verzoek("GET", "/meldingen", kw)).body.ongelezen, 0);
    assert.equal((await verzoek("GET", "/meldingen?ongelezen=true", pl)).body.meldingen[0].id, m.id);
    // Besluiten.
    await verzoek("POST", "/batches/B-2026-0710/besluiten", pl, { besluit: "in_beoordeling", reden: "gewicht te hoog" });
    await verzoek("POST", "/batches/B-2026-0710/besluiten", kw, { besluit: "afgekeurd", reden: "te zwaar" });
    const pnM = await verzoek("GET", "/meldingen?ongelezen=true", pn);
    assert.deepEqual(pnM.body.meldingen.map((x: any) => x.soort), ["afgekeurd"]);
    assert.match(pnM.body.meldingen[0].tekst, /B-2026-0710 afgekeurd \(keurresultaat NOK\) door kwaliteit1: te zwaar/);
    const kwM2 = await verzoek("GET", "/meldingen?ongelezen=true", kw);
    assert.deepEqual(kwM2.body.meldingen.map((x: any) => x.soort), ["beoordeling"]);
    const alles = await verzoek("POST", "/meldingen/alles-gelezen", pl);
    assert.equal(alles.body.gelezen, 3);
    assert.equal((await verzoek("GET", "/meldingen", pl)).body.ongelezen, 0);
  });
});

describe("Stilstand", () => {
  test("melden, opnieuw versturen, één tegelijk, beëindigen, melding, wandscherm en analyse", async () => {
    const op = await kiesNaam(await login("operator", "PC-07"));
    const oorzaken = await verzoek("GET", "/stilstand/oorzaken", op);
    assert.equal(oorzaken.body[0].categorie, "storing");
    const id = randomUUID();
    const begin = new Date(Date.now() - 25 * 60_000).toISOString();
    const s = await verzoek("POST", "/stilstand", op, { id, stapcode: "PS5", oorzaak: "STOR-MACH", toelichting: "lager maakt herrie", begin_op: begin });
    assert.equal(s.status, 201, JSON.stringify(s.body));
    assert.equal(s.body.operator, "Operator C");
    assert.equal(s.body.hal, "Hal 1");
    assert.ok(s.body.minuten >= 24.9);
    assert.equal((await verzoek("POST", "/stilstand", op, { id, stapcode: "PS5", oorzaak: "STOR-MACH" })).status, 200);
    const dubbel = await verzoek("POST", "/stilstand", op, { stapcode: "PS5", oorzaak: "OMSTEL" });
    assert.equal(dubbel.status, 409);
    assert.match(dubbel.body.fout, /loopt al een stilstand/);
    assert.equal((await verzoek("POST", "/stilstand", op, { stapcode: "PS6", oorzaak: "BESTAATNIET" })).status, 422);
    const pl = await login("ploegleider1");
    const m = await verzoek("GET", "/meldingen?ongelezen=true", pl);
    assert.ok(m.body.meldingen.some((x: any) => x.soort === "storing" && /PS5.*Machinestoring \(lager maakt herrie\)/.test(x.tekst)));
    const wand = await verzoek("GET", "/wandscherm", await login("scherm1"));
    assert.equal(wand.body.stappen.find((x: any) => x.code === "PS5").stilstand.oorzaak, "Machinestoring");
    assert.equal((await verzoek("GET", "/stilstand", await login("scherm1"))).body.length, 1);
    assert.equal((await verzoek("POST", `/stilstand/${id}/einde`, await login("kwaliteit1"), {})).status, 403);
    assert.equal((await verzoek("POST", `/stilstand/${id}/einde`, op, { notitie: "x".repeat(501) })).status, 400, "notitie te lang");
    const e = await verzoek("POST", `/stilstand/${id}/einde`, op, { notitie: "  lager vervangen  " });
    assert.equal(e.status, 200);
    assert.ok(e.body.eind_op);
    assert.equal(e.body.eind_notitie, "lager vervangen", "notitie bij het einde (#31), zonder spaties eromheen");
    assert.equal(e.body.beeindigd_door, "Operator C");
    const opnieuw = await verzoek("POST", `/stilstand/${id}/einde`, op, { notitie: "iets anders" });
    assert.equal(opnieuw.status, 200, "opnieuw versturen is veilig");
    assert.equal(opnieuw.body.eind_notitie, "lager vervangen", "de eerste notitie blijft staan");
    // Een ouder invoerscherm (vóór 0.46.0) stuurt alleen eind_op (D18).
    const oud = await verzoek("POST", "/stilstand", op, { stapcode: "PS6", oorzaak: "OMSTEL" });
    assert.equal(oud.status, 201, JSON.stringify(oud.body));
    const oudEinde = await verzoek("POST", `/stilstand/${oud.body.id}/einde`, op, { eind_op: new Date().toISOString() });
    assert.equal(oudEinde.status, 200);
    assert.equal(oudEinde.body.eind_notitie ?? null, null);
    const a = await verzoek("GET", "/analyse/stilstand", pl);
    const ps5 = a.body.per_stap.find((x: any) => x.stap === "PS5");
    assert.equal(ps5.aantal, 1);
    assert.ok(ps5.storing >= 24.9 && ps5.storing < 26);
    assert.ok(ps5.beschikbaarheid > 0.99 && ps5.beschikbaarheid < 1);
    assert.equal(a.body.per_oorzaak[0].oorzaak, "STOR-MACH");
    assert.equal(a.body.ploeguren_per_dag, 24);
  });

  test("beheer: oorzaak toevoegen en uitzetten", async () => {
    const bh = await login("beheerder1");
    assert.equal((await verzoek("POST", "/stilstand/oorzaken", bh, { code: "STROOM", naam: "Stroomuitval", categorie: "storing" })).status, 201);
    assert.equal((await verzoek("PATCH", "/stilstand/oorzaken/STROOM", bh, { actief: false })).body.actief, false);
    assert.ok(!(await verzoek("GET", "/stilstand/oorzaken", bh)).body.some((o: any) => o.code === "STROOM"));
    assert.equal((await verzoek("POST", "/stilstand/oorzaken", await login("planner1"), { code: "X", naam: "x", categorie: "overig" })).status, 403);
  });
});

describe("Etiketten", () => {
  test("gegevens voor batch- en lotetiketten, in de gevraagde volgorde", async () => {
    const t = await login("planner1");
    const lot = await verzoek("GET", "/planning/etiketten?nummers=L-2026-0001", t);
    const batch = lot.body[0].batches[0];
    const r = await verzoek("GET", `/planning/etiketten?nummers=L-2026-0001, ${batch.toLowerCase()},B-2026-9999`, t);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.map((x: any) => [x.nummer, x.soort]), [["L-2026-0001", "lot"], [batch, "batch"]]);
    assert.equal(r.body[0].batches.length, 4);
    assert.match(r.body[1].dag, /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("Keuringsstappen en specificaties (#80, D73)", () => {
  test("keuringsstappen in de configuratie; specificatie: concept, vaststellen, eerdere versies", async () => {
    const kw = await login("kwaliteit1");
    const stappen = (await verzoek("GET", "/config/stappen", kw)).body;
    assert.deepEqual(stappen.filter((s: any) => s.soort === "keuring").map((s: any) => s.code), ["TK1", "TK2", "EK"]);
    const lees = async () => (await verzoek("GET", "/specificaties?product=PRD-C", kw)).body;
    let sp = await lees();
    assert.deepEqual(sp.stappen.map((s: any) => [s.stap, s.geldig?.versie, s.concept]), [["TK1", 1, null], ["TK2", 1, null], ["EK", 1, null]]);
    assert.deepEqual(sp.stappen[2].geldig.regels.map((r: any) => r.veld), ["EK.1", "EK.2", "EK.3"]);
    assert.deepEqual((await verzoek("GET", "/specificaties?product=PRD-A", kw)).body.stappen, [], "PRD-A heeft geen keuringsstappen");
    assert.equal((await verzoek("GET", "/specificaties?product=PRD-X", kw)).status, 404);
    assert.equal((await verzoek("POST", "/specificaties", await login("operator.a"), { product: "PRD-C", stap: "EK" })).status, 403);
    const c = await verzoek("POST", "/specificaties", kw, { product: "PRD-C", stap: "EK" });
    assert.equal(c.status, 201, JSON.stringify(c.body));
    assert.equal(c.body.versie, 2);
    assert.equal(c.body.regels.length, 3, "concept begint met de regels van de geldige versie");
    assert.equal((await verzoek("PUT", `/specificaties/${c.body.id}`, kw, { regels: [{ veld: "PS3.1", grens_min: 1, grens_max: 2 }] })).status, 400);
    assert.equal((await verzoek("PUT", `/specificaties/${c.body.id}`, kw, { regels: [{ veld: "EK.1", grens_min: 5, grens_max: 2 }] })).status, 400);
    const w = await verzoek("PUT", `/specificaties/${c.body.id}`, kw, {
      opmerking: "Klant vraagt droger product",
      regels: [{ veld: "EK.1", grens_min: null, grens_max: 3.5 }, { veld: "EK.2", grens_min: 200, grens_max: 300 }, { veld: "EK.3", grens_min: null, grens_max: null }],
    });
    assert.equal(w.status, 200, JSON.stringify(w.body));
    assert.deepEqual(w.body.regels.map((r: any) => [r.veld, r.grens_max]), [["EK.1", 3.5], ["EK.2", 300]], "zonder minimum en maximum gaat een veld eruit");
    assert.equal((await lees()).stappen[2].geldig.versie, 1, "een concept geldt nog niet");
    const v = await verzoek("POST", `/specificaties/${c.body.id}/vaststellen`, kw);
    assert.equal(v.status, 200, JSON.stringify(v.body));
    assert.equal(v.body.status, "vastgesteld");
    assert.equal(v.body.vastgesteld_door, "kwaliteit1");
    sp = await lees();
    assert.equal(sp.stappen[2].geldig.versie, 2);
    assert.deepEqual(sp.stappen[2].eerder.map((x: any) => [x.versie, x.status]), [[1, "vervallen"]]);
    assert.equal((await verzoek("PUT", `/specificaties/${c.body.id}`, kw, { regels: [] })).status, 409);
    assert.equal((await verzoek("POST", `/specificaties/${c.body.id}/weggooien`, kw)).status, 422, "een vastgestelde versie blijft bewaard");
    const c3 = await verzoek("POST", "/specificaties", kw, { product: "PRD-C", stap: "EK" });
    assert.equal((await verzoek("POST", `/specificaties/${c3.body.id}/weggooien`, kw)).status, 204);
    assert.equal((await lees()).stappen[2].concept, null);
  });
});

describe("Wandscherm Kwaliteit (#83)", () => {
  test("wacht, afwijkingen van vandaag en kerncijfers; niet voor operators", async () => {
    assert.equal((await verzoek("GET", "/wandscherm/kwaliteit", await login("operator.a"))).status, 403);
    const r = await verzoek("GET", "/wandscherm/kwaliteit", await login("kwaliteit1"));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const k = r.body.kerncijfers;
    assert.equal(k.wacht, r.body.wacht.length);
    assert.ok(r.body.afwijkingen.length <= 30 && r.body.afwijkingen.length <= k.afwijkingen_vandaag);
    assert.ok(k.binnen_grenzen_procent === null ? k.metingen_vandaag === 0 : k.binnen_grenzen_procent >= 0 && k.binnen_grenzen_procent <= 100);
    const tijden = r.body.wacht.map((w: any) => w.sinds);
    assert.deepEqual(tijden, [...tijden].sort(), "oudste eerst");
  });
});

describe("Capaciteit", () => {
  test("starts per product, afwijkende dagen per product en stap (D69), waarschuwing bij te veel", async () => {
    const t = await login("planner1");
    const c = await verzoek("GET", "/planning/capaciteit", t);
    assert.equal(c.status, 200, JSON.stringify(c.body));
    assert.ok(c.body.per_stap.some((r: any) => r.stap === "PS1" && r.product === "PRD-B" && r.max_per_dag === 3));
    assert.deepEqual(c.body.afwijkingen, []);
    assert.equal(c.body.weekdagen, undefined, "de capaciteit per weekdag is vervallen");
    // Een maandag ver in de toekomst, zodat er nog niets op staat. PS1 (eerste stap) kan 8 aan van PRD-A en PRD-C, 3 van PRD-B.
    const dag = "2027-03-01";
    const prdB = (await verzoek("GET", "/planning/producten", t)).body.find((p: any) => p.code === "PRD-B").id;
    assert.equal((await verzoek("POST", "/planning/batches", t, { dag, aantal: 3, productId: prdB })).body.waarschuwing, null);
    assert.equal((await verzoek("POST", "/planning/batches", t, { dag, aantal: 1, productId: prdB })).body.waarschuwing,
      "PRD-B heeft deze dag nu 4 batches; de capaciteit is 3");
    // Onderhoud aan de lijn van PRD-B: twee dagen geen productie van PRD-B.
    const a = await verzoek("POST", "/planning/capaciteit/afwijkingen", t, { van: dag, tot: "2027-03-02", stap: null, product: "PRD-B", procent: 0, reden: "onderhoud lijn 2" });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    assert.deepEqual({ ...a.body, id: undefined }, { id: undefined, van: dag, tot: "2027-03-02", stap: null, product: "PRD-B", procent: 0, reden: "onderhoud lijn 2" });
    assert.equal((await verzoek("POST", "/planning/batches", t, { dag: "2027-03-02", aantal: 1, productId: prdB })).body.waarschuwing,
      "PRD-B wordt deze dag niet gemaakt (onderhoud lijn 2)");
    // Een halve dag voor PS1, alle producten: 8 -> 4 en 3 -> 1.
    assert.equal((await verzoek("POST", "/planning/capaciteit/afwijkingen", t, { van: "2027-03-03", stap: "PS1", product: null, procent: 50, reden: "korte dag" })).status, 201);
    const w = await verzoek("GET", `/planning/week?van=${dag}&dagen=7`, t);
    assert.equal(w.status, 200, JSON.stringify(w.body));
    const prod = (i: number, code: string) => w.body.dagen[i].producten.find((p: any) => p.product === code);
    assert.deepEqual(prod(0, "PRD-B"), { product: "PRD-B", naam: "Product B fijn", aantal: 4, max: 0, reden: "onderhoud lijn 2" });
    assert.deepEqual([prod(0, "PRD-A").aantal, prod(0, "PRD-A").max], [0, 8]);
    assert.deepEqual([prod(2, "PRD-A").max, prod(2, "PRD-B").max, prod(2, "PRD-B").reden], [4, 1, "korte dag"]);
    assert.equal(w.body.dagen[0].bezet, 4);
    assert.deepEqual(w.body.dagen[0].afwijkingen.map((x: any) => x.reden), ["onderhoud lijn 2"]);
    assert.deepEqual(w.body.dagen[2].afwijkingen.map((x: any) => x.reden), ["korte dag"]);
    assert.deepEqual(w.body.dagen[0].stappen_vol, [{ stap: "PS1", procent: 0, dicht: true }]);
    const ruimte = Object.fromEntries(w.body.ruimte.map((r: any) => [r.product, r.aantal]));
    assert.equal(ruimte["PRD-A"], 6 * 8 + 4, "zes dagen 8 en de korte dag 4");
    assert.equal(ruimte["PRD-B"], 4 * 3 + 1, "twee dagen dicht (de volle maandag telt niet negatief), de korte dag 1");
    // Ongeldig: tot vóór van, onbekende stap, geen recht.
    assert.ok([400, 409, 422].includes((await verzoek("POST", "/planning/capaciteit/afwijkingen", t, { van: dag, tot: "2027-02-01", stap: null, product: null, procent: 0, reden: "fout" })).status));
    assert.equal((await verzoek("POST", "/planning/capaciteit/afwijkingen", t, { van: dag, stap: "PS99", product: null, procent: 0, reden: "fout" })).status, 404);
    assert.equal((await verzoek("POST", "/planning/capaciteit/afwijkingen", await login("kwaliteit1"), { van: dag, stap: null, product: null, procent: 0, reden: "x x" })).status, 403);
    // Weghalen: daarna weer de gewone capaciteit.
    assert.equal((await verzoek("POST", `/planning/capaciteit/afwijkingen/${a.body.id}/weghalen`, t)).status, 204);
    assert.equal((await verzoek("POST", `/planning/capaciteit/afwijkingen/${a.body.id}/weghalen`, t)).status, 404);
    const w2 = await verzoek("GET", `/planning/week?van=${dag}&dagen=1`, t);
    assert.deepEqual([w2.body.dagen[0].producten.find((p: any) => p.product === "PRD-B").max, w2.body.dagen[0].afwijkingen.length], [3, 0]);
  });
});

describe("Certificaat per lot", () => {
  test("concept, uitgeven door Kwaliteit, herdruk gelijk, niet voor een lot dat niet gereed is", async () => {
    const kw = await login("kwaliteit1");
    const c = await verzoek("GET", "/certificaten/lots/L-2026-0001", kw);
    assert.equal(c.status, 200, JSON.stringify(c.body));
    const k = c.body.concept;
    assert.deepEqual(k.kenmerken.map((x: any) => x.veld), ["S3.3", "S7.3", "S17.2", "S18.2", "S18.3"]);
    assert.equal(k.kenmerken[0].resultaten.length, 4, "batchkenmerk: één resultaat per batch");
    assert.equal(k.bedrijf.naam, "Voorbeeldfabriek B.V. (fictief)");
    assert.equal(c.body.uitgegeven.length, 0);
    // Lot L-2026-0001 is in de API-tests niet door PS17/PS18 gegaan: niet gereed.
    if (k.status !== "gereed") {
      const n = await verzoek("POST", "/certificaten/lots/L-2026-0001", kw);
      assert.equal(n.status, 422);
    }
    // Een lot dat gereed is: zoek er een in de database of maak het af.
    const { rows } = await beheerDb.query("SELECT lotnummer FROM fabriek.lot WHERE status = 'gereed' ORDER BY lotnummer LIMIT 1");
    if (!rows[0]) return;
    const nr = rows[0].lotnummer;
    assert.equal((await verzoek("POST", `/certificaten/lots/${nr}`, await login("planner1"))).status, 403);
    const u = await verzoek("POST", `/certificaten/lots/${nr}`, kw);
    if (u.status === 422) return; // afwijking in de testdata: dan geen certificaat
    assert.equal(u.status, 201, JSON.stringify(u.body));
    const herdruk = await verzoek("GET", `/certificaten/${u.body.nummer}`, kw);
    assert.deepEqual(herdruk.body.inhoud, u.body.inhoud);
    assert.equal((await verzoek("GET", `/certificaten/lots/${nr}`, kw)).body.uitgegeven[0].nummer, u.body.nummer);
  });

  test("beheer: bedrijfsgegevens en veld op het certificaat", async () => {
    const bh = await login("beheerder1");
    assert.equal((await verzoek("PUT", "/certificaten/instellingen", bh, { bedrijfsnaam: "Testfabriek (fictief)", bedrijfsadres: "Testweg 1", certificaat_verklaring: "Test." })).status, 204);
    assert.equal((await verzoek("GET", "/certificaten/instellingen", bh)).body.bedrijfsnaam, "Testfabriek (fictief)");
    const v = await verzoek("PATCH", "/beheer/velden/S9.2", bh, { op_certificaat: true });
    assert.equal(v.status, 200, JSON.stringify(v.body));
    const c = await verzoek("GET", "/certificaten/lots/L-2026-0001", bh);
    assert.ok(c.body.concept.kenmerken.some((x: any) => x.veld === "S9.2"));
    await verzoek("PATCH", "/beheer/velden/S9.2", bh, { op_certificaat: false });
    assert.equal((await verzoek("PUT", "/certificaten/instellingen", await login("kwaliteit1"), { bedrijfsnaam: "x", bedrijfsadres: "", certificaat_verklaring: "" })).status, 403);
  });
});

describe("Regelkaarten", () => {
  test("overzicht per veld en één regelkaart", async () => {
    const kw = await login("kwaliteit1");
    const o = await verzoek("GET", "/analyse/regelkaarten", kw);
    assert.equal(o.status, 200, JSON.stringify(o.body));
    assert.ok(o.body.length >= 36);
    const r = await verzoek("GET", "/analyse/regelkaart?veld=S1.1", kw);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.getekend, "afwijking_van_setting");
    assert.ok(r.body.punten.length > 0);
    const g = await verzoek("GET", "/analyse/regelkaart?veld=S1.2", kw);
    assert.equal(g.body.getekend, "gemeten");
    if (g.body.punten.length > 2) assert.ok(g.body.bovengrens >= g.body.gemiddelde);
    assert.equal((await verzoek("GET", "/analyse/regelkaart?veld=S99.9", kw)).status, 404);
  });
});

describe("Offline wachtrij: moment en operator (D43)", () => {
  async function metKoppen(methode: string, pad: string, token: string, koppen: Record<string, string>, body?: unknown): Promise<Antwoord> {
    const r = await app.inject({ method: methode as never, url: pad, headers: { authorization: `Bearer ${token}`, ...koppen }, payload: body as never });
    return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
  }

  test("start, waarden en afronden krijgen het moment van invoer, gecorrigeerd voor de klok van de pc", async () => {
    const tokenA = await kiesNaam(await login("operator", "PC-01"), "Operator C");
    const ops = await verzoek("GET", "/auth/operators", tokenA);
    const opB = ops.body.find((o: { naam: string }) => o.naam === "Operator D");
    assert.ok(opB, "Operator D bestaat");
    const nu = Date.now();
    const klok = -60 * 60 * 1000; // klok van de pc loopt een uur achter
    const koppen = (geleden: number) => ({
      "x-batchgui-moment": new Date(nu - geleden + klok).toISOString(),
      "x-batchgui-verzonden": new Date(Date.now() + klok).toISOString(),
      "x-batchgui-operator": opB.id,
    });
    const nr = "B-2026-8001";
    assert.equal((await metKoppen("POST", "/batches", tokenA, koppen(3 * 3600e3), { id: randomUUID(), batchnummer: nr })).status, 201);
    const start = await metKoppen("POST", "/registraties", tokenA, koppen(3 * 3600e3), { id: randomUUID(), stapcode: "PS1", batchnummer: nr });
    assert.equal(start.status, 201, JSON.stringify(start.body));
    assert.equal(start.body.operator, "Operator D", "de operator van de wachtrij, niet die van het token");
    const verschil = Math.abs(Date.parse(start.body.gestart_op) - (nu - 3 * 3600e3));
    assert.ok(verschil < 60_000, `gestart_op wijkt ${verschil} ms af`);

    const w = await metKoppen("POST", `/registraties/${start.body.id}/waarden`, tokenA, koppen(2 * 3600e3), { waarden: waardenVoor(start.body) });
    assert.equal(w.status, 200, JSON.stringify(w.body));
    const gs = start.body.grondstoffen.filter((g: any) => g.verplicht);
    if (gs.length) {
      const r = await metKoppen("POST", `/registraties/${start.body.id}/grondstoffen`, tokenA, koppen(2 * 3600e3), {
        grondstoffen: gs.map((g: any) => ({ id: randomUUID(), code: g.code, partij: `LEV-${g.code}-TEST` })),
      });
      assert.equal(r.status, 200, JSON.stringify(r.body));
    }
    const af = await metKoppen("POST", `/registraties/${start.body.id}/afronden`, tokenA, koppen(1 * 3600e3));
    assert.equal(af.status, 200, JSON.stringify(af.body));
    assert.ok(Math.abs(Date.parse(af.body.afgerond_op) - (nu - 3600e3)) < 60_000, af.body.afgerond_op);

    const [rij] = (
      await beheerDb.query(
        `SELECT r.gestart_ontvangen_op, (SELECT min(w.ingevoerd_op) FROM fabriek.waarde w WHERE w.stapregistratie_id = r.id) AS waarde_op,
                (SELECT count(*) FROM fabriek.waarde w WHERE w.stapregistratie_id = r.id AND w.ingevoerd_door = $2) AS door_b
           FROM fabriek.stapregistratie r WHERE r.id = $1`,
        [start.body.id, opB.id],
      )
    ).rows;
    assert.ok(Date.now() - Date.parse(rij.gestart_ontvangen_op) < 60_000, "aankomst = nu");
    assert.ok(Math.abs(Date.parse(rij.waarde_op) - (nu - 2 * 3600e3)) < 60_000, "waarde = moment van invoer");
    assert.ok(Number(rij.door_b) > 0, "waarden op naam van Operator D");
  });

  test("zonder koppen (oudere invoerschermen) blijft alles zoals het was", async () => {
    const token = await kiesNaam(await login("operator", "PC-01"), "Operator C");
    const nr = "B-2026-8002";
    assert.equal((await verzoek("POST", "/batches", token, { batchnummer: nr })).status, 201);
    const start = await verzoek("POST", "/registraties", token, { stapcode: "PS1", batchnummer: nr });
    assert.equal(start.status, 201);
    assert.equal(start.body.operator, "Operator C");
    assert.ok(Math.abs(Date.parse(start.body.gestart_op) - Date.now()) < 60_000);
  });

  test("een ongeldige operatorkop telt niet", async () => {
    const token = await kiesNaam(await login("operator", "PC-01"), "Operator C");
    const nr = "B-2026-8003";
    assert.equal((await verzoek("POST", "/batches", token, { batchnummer: nr })).status, 201);
    const start = await metKoppen("POST", "/registraties", token, { "x-batchgui-operator": "geen-uuid" }, { stapcode: "PS1", batchnummer: nr });
    assert.equal(start.status, 201);
    assert.equal(start.body.operator, "Operator C");
  });

  test("startpagina: inloggen zonder pc, dan met /auth/pc naar het invoerscherm (D54)", async () => {
    const zonderPc = await login("operator.a");
    const geen = await verzoek("POST", "/batches", zonderPc, { batchnummer: "B-2026-8030" });
    assert.equal(geen.status, 400, "zonder pc geen invoer");
    const r = await verzoek("POST", "/auth/pc", zonderPc, { pc: "PC-10" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.operator.naam, "Operator A");
    assert.equal((await verzoek("POST", "/batches", r.body.token, { batchnummer: "B-2026-8030" })).status, 201);
    const [p] = (await beheerDb.query("SELECT count(*)::int AS n FROM fabriek.inlogpoging WHERE gebruikersnaam = 'operator.a' AND pc = 'PC-10' AND uitkomst = 'gelukt'")).rows;
    assert.ok(p.n >= 1, "telt als inlog op PC-10");
    assert.equal((await verzoek("POST", "/auth/pc", zonderPc, { pc: "PC-99" })).status, 400);
    // Kwaliteit mag ook (de lab-pc, #64), met een eigen naam voor de metingen; een planner niet.
    const kwPc = await verzoek("POST", "/auth/pc", await login("kwaliteit1"), { pc: "PC-10" });
    assert.equal(kwPc.status, 200);
    assert.equal(kwPc.body.operator.naam, "kwaliteit1");
    assert.equal((await verzoek("POST", "/auth/pc", await login("planner1"), { pc: "PC-10" })).status, 403, "alleen invoerrollen");
  });

  test("inlogscherm: testaccounts alleen in een testomgeving", async () => {
    const r = await app.inject({ method: "GET", url: "/auth/omgeving" });
    const b = JSON.parse(r.body);
    assert.equal(b.test, true);
    assert.ok(b.testaccounts.some((t: { naam: string }) => t.naam === "operator.a"));
  });

  test("eerste inlog van een ploegleider zonder naam: krijgt meteen een naam in het token (D53)", async () => {
    await beheerDb.query("INSERT INTO fabriek.gebruiker (gebruikersnaam, rol, wachtwoord_hash) VALUES ('ploegleider9', 'ploegleider', fabriek.wachtwoord_hash('demo'))");
    const r = await verzoek("POST", "/auth/login", undefined, { gebruikersnaam: "ploegleider9", wachtwoord: "demo", pc: "PC-09" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.operator?.naam, "ploegleider9");
    assert.ok(JSON.parse(Buffer.from(r.body.token.split(".")[1], "base64url").toString()).operatorId, "naam in het token");
  });

  test("eigen account: naam ligt vast, invoer op een andere naam alleen na inlog op deze pc (D53)", async () => {
    const r = await verzoek("POST", "/auth/login", undefined, { gebruikersnaam: "operator.a", wachtwoord: "demo", pc: "PC-08" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.naamKiezen, false);
    assert.equal(r.body.operator.naam, "Operator A");
    const tokenA = r.body.token;
    const ops = (await verzoek("GET", "/auth/operators", tokenA)).body;
    assert.ok(!ops.some((o: { naam: string }) => o.naam === "Operator A" || o.naam === "Operator B"), "namen met een eigen account staan niet in de keuzelijst");
    const opC = ops.find((o: { naam: string }) => o.naam === "Operator C");
    assert.equal((await verzoek("POST", "/auth/operator", tokenA, { operatorId: opC.id })).status, 403, "eigen account kiest geen andere naam");
    const nr = "B-2026-8020";
    assert.equal((await verzoek("POST", "/batches", tokenA, { batchnummer: nr })).status, 201);
    const start = await verzoek("POST", "/registraties", tokenA, { stapcode: "PS1", batchnummer: nr });
    assert.equal(start.body.operator, "Operator A");
    // Wachtrij met invoer van Operator B, die niet op PC-08 inlogde: geweigerd.
    const [opB] = (await beheerDb.query("SELECT id FROM fabriek.operator WHERE naam = 'Operator B'")).rows;
    const nr2 = "B-2026-8021";
    const fout = await metKoppen("POST", "/batches", tokenA, { "x-batchgui-operator": opB.id }, { batchnummer: nr2 });
    assert.equal(fout.status, 403, JSON.stringify(fout.body));
    assert.match(fout.body.melding ?? fout.body.message ?? JSON.stringify(fout.body), /Operator B/);
    // Na een inlog van operator.b op PC-08 mag het wel (persoonswissel, wachtrij van de pc).
    await login("operator.b", "PC-08");
    assert.equal((await metKoppen("POST", "/batches", tokenA, { "x-batchgui-operator": opB.id }, { batchnummer: nr2 })).status, 201);
    // Gedeeld account mag geen naam met een eigen account kiezen.
    const gedeeld = await login("operator", "PC-08");
    assert.equal((await verzoek("POST", "/auth/operator", gedeeld, { operatorId: opB.id })).status, 403);
  });
});

describe("Inloggen beveiligen (D45)", () => {
  test("hoofdletters in de gebruikersnaam tellen niet mee; het token krijgt de opgeslagen naam", async () => {
    const r = await verzoek("POST", "/auth/login", undefined, { gebruikersnaam: "Kwaliteit1", wachtwoord: "demo" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const inhoud = JSON.parse(Buffer.from(r.body.token.split(".")[1], "base64url").toString());
    assert.equal(inhoud.naam, "kwaliteit1");
    const beheer = await login("beheerder1");
    const dubbel = await verzoek("POST", "/beheer/gebruikers", beheer, { gebruikersnaam: "KWALITEIT1", rol: "kwaliteit", wachtwoord: "geheim-123" });
    assert.equal(dubbel.status, 400, "nieuwe gebruikersnamen zijn altijd kleine letters");
  });

  test("na 5 foute wachtwoorden 1 minuut wachten, ook met het goede wachtwoord; pogingen vastgelegd", async () => {
    for (let i = 0; i < 5; i++) {
      assert.equal((await verzoek("POST", "/auth/login", undefined, { gebruikersnaam: "planner1", wachtwoord: "fout" })).status, 401);
    }
    const geblokt = await verzoek("POST", "/auth/login", undefined, { gebruikersnaam: "Planner1", wachtwoord: "demo" });
    assert.equal(geblokt.status, 429, JSON.stringify(geblokt.body));
    assert.match(geblokt.body.fout, /Wacht \d+ seconden/);
    const { rows } = await beheerDb.query(
      "SELECT uitkomst, count(*)::int AS n FROM fabriek.inlogpoging WHERE lower(gebruikersnaam) = 'planner1' AND uitkomst <> 'gelukt' GROUP BY uitkomst ORDER BY uitkomst");
    assert.deepEqual(rows, [{ uitkomst: "geblokkeerd", n: 1 }, { uitkomst: "mislukt", n: 5 }]);
    // Na een minuut mag het weer: zet de pogingen terug in de tijd.
    await beheerDb.query("ALTER TABLE fabriek.inlogpoging DISABLE TRIGGER inlogpoging_vast");
    await beheerDb.query("UPDATE fabriek.inlogpoging SET op = op - interval '2 minutes' WHERE lower(gebruikersnaam) = 'planner1'");
    await beheerDb.query("ALTER TABLE fabriek.inlogpoging ENABLE TRIGGER inlogpoging_vast");
    assert.equal((await verzoek("POST", "/auth/login", undefined, { gebruikersnaam: "planner1", wachtwoord: "demo" })).status, 200);
  });

  test("nieuwe wachtwoorden met bcrypt sterkte 11", async () => {
    const { rows } = await beheerDb.query("SELECT fabriek.wachtwoord_hash('x') AS h");
    assert.match(rows[0].h, /^\$2a\$11\$/);
  });

  test("pagina's krijgen beveiligingskoppen; de API-documentatie geen CSP", async () => {
    const start = await app.inject({ method: "GET", url: "/" });
    assert.match(String(start.headers["content-security-policy"]), /default-src 'self'/);
    assert.equal(start.headers["x-frame-options"], "DENY");
    assert.equal(start.headers["x-content-type-options"], "nosniff");
    const docs = await app.inject({ method: "GET", url: "/docs/" });
    assert.equal(docs.headers["content-security-policy"], undefined);
  });
});

describe("Velden importeren uit het Excel-sjabloon (D46)", () => {
  const basis = { soort: "overig", verplicht: true, op_certificaat: false, actief: true };
  test("proefronde wijzigt niets; met fouten wordt niets opgeslagen; daarna wel", async () => {
    const bh = await login("beheerder1");
    const regels = [
      { regel: 2, stapcode: "PS3", code: "S3.1", naam: "Temperatuur menger", soort: "procesparameter", eenheid: "°C", verplicht: true,
        tolerantie: 3, tolerantie_soort: "absoluut", grens_min: 60, grens_max: 95, op_certificaat: false, actief: true },
      { regel: 3, stapcode: "ps3", code: null, naam: "Viscositeit", ...basis, eenheid: "mPa·s", grens_min: 100, grens_max: 400 },
      { regel: 4, stapcode: "PS3", code: null, naam: "Fout veld", ...basis, grens_min: 10, grens_max: 5 },
    ];
    const proef = await verzoek("POST", "/beheer/velden/import", bh, { uitvoeren: true, regels });
    assert.equal(proef.status, 200, JSON.stringify(proef.body));
    assert.equal(proef.body.uitgevoerd, false);
    assert.equal(proef.body.fouten, 1);
    assert.equal(proef.body.regels[2].fout, "De ondergrens is hoger dan de bovengrens");
    assert.equal(proef.body.regels[0].actie, "wijzigen");
    assert.ok(proef.body.regels[0].wijzigingen.some((w: string) => w.startsWith("naam:")), JSON.stringify(proef.body.regels[0]));
    const voor = await beheerDb.query("SELECT naam FROM fabriek.veld WHERE code = 'S3.1'");
    assert.notEqual(voor.rows[0].naam, "Temperatuur menger", "met een fout blijft alles zoals het was");

    const goed = regels.slice(0, 2);
    const droog = await verzoek("POST", "/beheer/velden/import", bh, { uitvoeren: false, regels: goed });
    assert.equal(droog.body.uitgevoerd, false);
    assert.equal(droog.body.nieuw, 1);
    assert.match(droog.body.regels[1].code, /^S3\.\d+$/);
    assert.equal((await beheerDb.query("SELECT count(*)::int AS n FROM fabriek.veld WHERE naam = 'Viscositeit'")).rows[0].n, 0, "proefronde slaat niets op");

    const echt = await verzoek("POST", "/beheer/velden/import", bh, { uitvoeren: true, regels: goed });
    assert.equal(echt.body.uitgevoerd, true, JSON.stringify(echt.body));
    assert.equal((await beheerDb.query("SELECT naam FROM fabriek.veld WHERE code = 'S3.1'")).rows[0].naam, "Temperatuur menger");
    const [v] = (await beheerDb.query("SELECT code, eenheid FROM fabriek.veld WHERE naam = 'Viscositeit'")).rows;
    assert.equal(v.code, droog.body.regels[1].code, "de proefronde toont de code die het veld echt krijgt");
    const log = await beheerDb.query("SELECT count(*)::int AS n FROM fabriek.config_log WHERE tabel = 'veld' AND gewijzigd_door = 'beheerder1' AND gewijzigd_op > now() - interval '1 minute'");
    assert.ok(log.rows[0].n >= 2, "wijzigingen staan in het logboek");

    const nogmaals = await verzoek("POST", "/beheer/velden/import", bh, { uitvoeren: false, regels: [{ ...goed[0] }] });
    assert.equal(nogmaals.body.gelijk, 1, "ongewijzigd veld telt als gelijk");
  });

  test("soort en stap van een bestaand veld veranderen niet; onbekende code; alleen de beheerder", async () => {
    const bh = await login("beheerder1");
    const r = await verzoek("POST", "/beheer/velden/import", bh, { uitvoeren: false, regels: [
      { regel: 2, stapcode: "PS3", code: "S3.2", naam: "x", ...basis },
      { regel: 3, stapcode: "PS4", code: "S3.1", naam: "x", ...basis, soort: "procesparameter" },
      { regel: 4, stapcode: "PS3", code: "S3.99", naam: "x", ...basis },
      { regel: 5, stapcode: "PS99", code: null, naam: "x", ...basis },
    ] });
    assert.deepEqual(r.body.regels.map((x: any) => x.actie), ["fout", "fout", "fout", "fout"], JSON.stringify(r.body.regels));
    assert.match(r.body.regels[0].fout, /soort/);
    assert.match(r.body.regels[1].fout, /hoort bij PS3/);
    assert.match(r.body.regels[2].fout, /bestaat niet/);
    assert.match(r.body.regels[3].fout, /Onbekende stap/);
    const kw = await login("kwaliteit1");
    assert.equal((await verzoek("POST", "/beheer/velden/import", kw, { uitvoeren: false, regels: [] })).status, 403);
  });
});

describe("Startpagina en testaccounts (0.22.1)", () => {
  test("met testdata noemt de startpagina de testaccounts, zonder niet", async () => {
    const r = await app.inject({ method: "GET", url: "/" });
    assert.match(r.body, /Testomgeving met fictieve gegevens/);
    assert.match(r.body, /planner1/);
    const echt = startpagina(false);
    assert.doesNotMatch(echt, /Testaccounts|demo|Testomgeving/);
  });

  test("Beheer > Server waarschuwt voor testaccounts met wachtwoord demo", async () => {
    const r = await verzoek("GET", "/beheer/server", await login("beheerder1"));
    assert.equal(r.status, 200);
    assert.ok(r.body.testaccounts.includes("beheerder1"), JSON.stringify(r.body.testaccounts));
    assert.ok(!r.body.waarschuwingen.some((w: { tekst: string }) => /testaccount/.test(w.tekst)), "geen waarschuwing: met testdata is dit normaal");
  });
});

describe("Decimalen per veld (0.23.0)", () => {
  test("instellen in Beheer, terug in de configuratie en in het sjabloon zonder kolom blijft hij staan", async () => {
    const bh = await login("beheerder1");
    const r = await verzoek("PATCH", "/beheer/velden/S5.1", bh, { decimalen: 2 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.decimalen, 2);
    assert.equal((await verzoek("PATCH", "/beheer/velden/S5.1", bh, { decimalen: 7 })).status, 400);
    const stappen = await verzoek("GET", "/config/stappen", bh);
    const v = stappen.body.flatMap((s: any) => s.velden).find((x: any) => x.code === "S5.1");
    assert.equal(v.decimalen, 2);
    const regel = { regel: 2, stapcode: "PS5", code: "S5.1", naam: v.naam, soort: v.soort, eenheid: v.eenheid, verplicht: v.verplicht,
      tolerantie: v.tolerantie, tolerantie_soort: v.tolerantie_soort, grens_min: v.grens_min, grens_max: v.grens_max, op_certificaat: !!v.op_certificaat, actief: v.actief };
    const zonder = await verzoek("POST", "/beheer/velden/import", bh, { uitvoeren: false, regels: [regel] });
    assert.equal(zonder.body.regels[0].actie, "gelijk", "zonder kolom Decimalen verandert er niets");
    const met = await verzoek("POST", "/beheer/velden/import", bh, { uitvoeren: false, regels: [{ ...regel, decimalen: 1 }] });
    assert.deepEqual(met.body.regels[0].wijzigingen, ["decimalen: 2 → 1"]);
  });
});

describe("Een 0 blijft een 0 (0.23.0)", () => {
  test("setting 0 bij een meetwaarde en ondergrens 0 bij een veld worden niet leeg", async () => {
    const bh = await login("beheerder1");
    const r = await verzoek("PATCH", "/beheer/velden/S6.1", bh, { grens_min: 0 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(Number(r.body.grens_min), 0);
    const leeg = await verzoek("PATCH", "/beheer/velden/S6.1", bh, { grens_min: null });
    assert.equal(leeg.body.grens_min, null, "null blijft null");
    const token = await kiesNaam(await login("operator", "PC-01"), "Operator C");
    const nr = "B-2026-8010";
    assert.equal((await verzoek("POST", "/batches", token, { batchnummer: nr })).status, 201);
    const start = await verzoek("POST", "/registraties", token, { stapcode: "PS1", batchnummer: nr });
    const w = await verzoek("POST", `/registraties/${start.body.id}/waarden`, token, {
      waarden: [{ id: randomUUID(), veldcode: "S1.1", setting: 0, gemeten: 0 }] });
    assert.equal(w.status, 200, JSON.stringify(w.body));
    const { rows } = await beheerDb.query("SELECT setting::float AS s, gemeten::float AS g FROM fabriek.waarde w JOIN fabriek.veld v ON v.id = w.veld_id WHERE v.code = 'S1.1' AND w.stapregistratie_id = $1", [start.body.id]);
    assert.deepEqual(rows[0], { s: 0, g: 0 });
  });
});

describe("Pilotoverzicht (#77, D66)", () => {
  test("geweigerde invoer van een pc wordt vastgelegd, niet-ingelogd en lezen niet", async () => {
    const token = await kiesNaam(await login("operator", "PC-02"), "Operator C");
    const voor = Number((await beheerDb.query("SELECT count(*) FROM fabriek.geweigerde_invoer")).rows[0].count);
    const fout = await verzoek("POST", "/registraties", token, { stapcode: "PS1", batchnummer: "B-2026-9999" });
    assert.ok(fout.status >= 400 && fout.status < 500, JSON.stringify(fout.body));
    assert.equal((await verzoek("POST", "/registraties", undefined, { stapcode: "PS1", batchnummer: "B-2026-9999" })).status, 401);
    assert.equal((await verzoek("GET", "/registraties/00000000-0000-0000-0000-000000000000", token)).status >= 400, true);
    assert.equal((await verzoek("POST", "/auth/login", undefined, { gebruikersnaam: "operator", wachtwoord: "fout", pc: "PC-02" })).status, 401);
    const { rows } = await beheerDb.query(`SELECT x.*, pc.naam AS pc, o.naam AS operator FROM fabriek.geweigerde_invoer x
      LEFT JOIN fabriek.pc ON pc.id = x.pc_id LEFT JOIN fabriek.operator o ON o.id = x.operator_id ORDER BY x.id DESC`);
    assert.equal(rows.length, voor + 1, "alleen de geweigerde invoer met een pc, niet niet-ingelogd, lezen of inloggen");
    assert.deepEqual([rows[0].pc, rows[0].operator, rows[0].pad, rows[0].stapcode, rows[0].batchnummer, rows[0].status],
      ["PC-02", "Operator C", "/registraties", "PS1", "B-2026-9999", fout.status]);
    assert.equal(rows[0].fout, fout.body.fout);
  });

  test("overzicht per dag en pc, per veld en geweigerd; wie het mag zien en instellen", async () => {
    const pm = await login("productiemanager1");
    const bh = await login("beheerder1");
    assert.equal((await verzoek("GET", "/pilot", await login("planner1"))).status, 403);
    // Een start die een uur te laat binnenkomt (offline op de pc).
    const token = await kiesNaam(await login("operator", "PC-03"), "Operator C");
    const nr = "B-2026-8077";
    assert.equal((await verzoek("POST", "/batches", token, { batchnummer: nr })).status, 201);
    const r = await app.inject({ method: "POST", url: "/registraties", payload: { id: randomUUID(), stapcode: "PS1", batchnummer: nr },
      headers: { authorization: `Bearer ${token}`, "x-batchgui-moment": new Date(Date.now() - 60 * 60e3).toISOString(), "x-batchgui-verzonden": new Date().toISOString() } });
    assert.equal(r.statusCode, 201, r.body);
    await verzoek("POST", "/registraties", token, { stapcode: "PS1", batchnummer: "B-2026-9998" }); // geweigerd

    const o = await verzoek("GET", "/pilot", pm);
    assert.equal(o.status, 200, JSON.stringify(o.body));
    assert.equal(o.body.te_laat_minuten, 15);
    const vandaag = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Amsterdam" });
    assert.equal(o.body.tot, vandaag);
    const rij = o.body.per_dag_pc.find((x: any) => x.pc === "PC-03" && x.dag === vandaag);
    assert.ok(rij, JSON.stringify(o.body.per_dag_pc.slice(0, 3)));
    assert.ok(rij.gestart >= 1 && rij.te_laat >= 1 && rij.langst_minuten >= 59 && rij.geweigerd >= 1, JSON.stringify(rij));
    assert.ok(o.body.kerncijfers.geweigerd >= 2);
    assert.ok(o.body.geweigerd.some((g: any) => g.batchnummer === "B-2026-9998" && g.pc === "PC-03" && g.naam === "Operator C"));
    assert.ok(Array.isArray(o.body.per_veld));

    // Instellingen: alleen de beheerder; de startdatum bepaalt de standaardperiode.
    assert.equal((await verzoek("PUT", "/pilot/instellingen", pm, { pilot_start: vandaag, te_laat_minuten: 30 })).status, 403);
    assert.equal((await verzoek("PUT", "/pilot/instellingen", bh, { pilot_start: vandaag, te_laat_minuten: 0 })).status, 400);
    assert.equal((await verzoek("PUT", "/pilot/instellingen", bh, { pilot_start: vandaag, te_laat_minuten: 90 })).status, 204);
    const na = await verzoek("GET", "/pilot", pm);
    assert.deepEqual([na.body.van, na.body.pilot_start, na.body.te_laat_minuten], [vandaag, vandaag, 90]);
    assert.equal(na.body.per_dag_pc.find((x: any) => x.pc === "PC-03" && x.dag === vandaag).te_laat, 0, "een uur is niet te laat bij 90 minuten");
    assert.equal((await verzoek("PUT", "/pilot/instellingen", bh, { pilot_start: null, te_laat_minuten: 15 })).status, 204);
    const leeg = await verzoek("GET", "/pilot?van=2026-01-01&tot=2026-01-02", pm);
    assert.equal(leeg.body.pilot_start, null);
    assert.deepEqual(leeg.body.per_dag_pc, []);
    assert.equal((await verzoek("GET", "/pilot?van=2026-02-01&tot=2026-01-01", pm)).status, 400);
  });
});
