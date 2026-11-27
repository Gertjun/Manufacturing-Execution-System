// Integratietest van de API tegen een echte (test)database.
// LET OP: de database wordt leeggemaakt en opnieuw gevuld met fictieve configuratie.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { bouwApp, startpagina, type App } from "../src/app.js";
import { maakPool, controleerRuntimeRechten, type Db } from "../src/db.js";

const DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost/batchgui?host=/tmp&port=5433";
// De applicatie zelf draait als mes_app (beperkte rechten, zie db/rechten.sql) als deze is gezet.
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
  // Alleen fictieve API-regressieaccounts: expliciete actuele MES-grants,
  // geen productie-upgrade of automatische mapping van oude rollen.
  // Technisch beheer krijgt geen engineering- of securityrecht.
  await beheerDb.query(`
    INSERT INTO fabriek.authorization_grant(user_id,role_code)
    SELECT g.id,v.role_code FROM (VALUES
      ('operator.a','operator'),('operator.b','operator'),
      ('operator.c','operator'),('operator.d','operator'),
      ('ploegleider1','shift_supervisor'),('ploegleider2','shift_supervisor'),
      ('kwaliteit1','quality_approver'),
      ('beheerder1','system_administrator'),('analist1','analyst_management'),
      ('planner1','production_planner'),('productiemanager1','manufacturing_manager'),
      ('scherm1','display_integration')
    ) v(naam,role_code)
    JOIN fabriek.gebruiker g ON g.gebruikersnaam=v.naam
    WHERE NOT g.gedeeld
  `);

  await beheerDb.query(readFileSync(new URL("../../db/rechten.sql", import.meta.url), "utf8"));
  // De meeste tests zijn van vóór de keuring (#64): daar meet de operator alles. De keuring heeft een eigen test.
  await beheerDb.query("UPDATE fabriek.veld SET gemeten_door = 'productie' WHERE processtap_id IN (SELECT id FROM fabriek.processtap WHERE soort = 'proces')");
  db = APP_DB_URL === DB_URL ? beheerDb : maakPool(APP_DB_URL);
  app = await bouwApp({ db, jwtGeheim: "test-geheim-dat-lang-genoeg-is-0123456789" });
});

after(async () => {
  if (app) await app.close();
  if (db && db !== beheerDb) await db.end();
  if (beheerDb) await beheerDb.end();
});

describe("D24 effectieve runtime-rechten", () => {
  test("database-eigenaar wordt geweigerd", async () => {
    await assert.rejects(controleerRuntimeRechten(beheerDb), /beperkte MES-databasegebruiker/);
  });
  test("beperkte applicatielogin wordt geaccepteerd", async () => {
    assert.notEqual(APP_DB_URL, DB_URL, "TEST_APP_DATABASE_URL moet een afzonderlijke login zijn");
    await controleerRuntimeRechten(db);
  });
  test("indirecte verhoogde rechten worden geweigerd", async () => {
    await beheerDb.query("GRANT pg_read_all_data TO mes_app");
    try {
      await assert.rejects(controleerRuntimeRechten(db), /beperkte MES-databasegebruiker/);
    } finally {
      await beheerDb.query("REVOKE pg_read_all_data FROM mes_app");
    }
    await controleerRuntimeRechten(db);
  });
  test("CREATE-recht op database wordt geweigerd", async () => {
    const { rows } = await beheerDb.query("SELECT quote_ident(current_database()) AS naam");
    const naam = rows[0].naam;
    await beheerDb.query(`GRANT CREATE ON DATABASE ${naam} TO mes_app`);
    try {
      await assert.rejects(controleerRuntimeRechten(db), /beperkte MES-databasegebruiker/);
    } finally {
      await beheerDb.query(`REVOKE CREATE ON DATABASE ${naam} FROM mes_app`);
    }
    await controleerRuntimeRechten(db);
  });
  test("CREATE-recht in publiek schema wordt geweigerd", async () => {
    await beheerDb.query("GRANT CREATE ON SCHEMA public TO mes_app");
    try {
      await assert.rejects(controleerRuntimeRechten(db), /beperkte MES-databasegebruiker/);
    } finally {
      await beheerDb.query("REVOKE CREATE ON SCHEMA public FROM mes_app");
    }
    await controleerRuntimeRechten(db);
  });
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
  test("gedeeld account kan niet inloggen", async () => {
    const r = await verzoek("POST", "/auth/login", undefined, { gebruikersnaam: "operator", wachtwoord: "demo", pc: "PC-01" });
    assert.equal(r.status, 401);
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
  test("D101: fabriekbrede overzichten vereisen actuele globale MES-leesrechten", async () => {
    const system = await login("mes.system");
    const security = await login("mes.security.a");
    const reader = await login("mes.analyst");
    const name = "mes.scope.overview";
    await beheerDb.query("INSERT INTO fabriek.gebruiker(gebruikersnaam,rol,wachtwoord_hash) VALUES ($1,'analist',fabriek.wachtwoord_hash('demo'))", [name]);
    await beheerDb.query("INSERT INTO fabriek.authorization_grant(user_id,role_code,product_id) SELECT g.id,'analyst_management',p.id FROM fabriek.gebruiker g CROSS JOIN fabriek.product p WHERE g.gebruikersnaam=$1 AND p.code='PRD-A'", [name]);
    const scoped = await login(name);
    for (const path of ["/planning/producten", "/werkvoorraad", "/analyse/samenvatting", "/config/stappen"]) {
      for (const token of [system, security, scoped]) {
        assert.equal((await verzoek("GET", path, token)).status, 403, path);
      }
      assert.equal((await verzoek("GET", path, reader)).status, 200, path);
    }
  });
  test("D101: permissionprojectie is persoonlijk, actueel en scopebewust", async () => {
    assert.equal((await verzoek("GET","/auth/permissions")).status,401);
    const system = await verzoek("GET","/auth/permissions",await login("mes.system"));
    assert.equal(system.status,200,JSON.stringify(system.body));
    assert.ok(system.body.global.includes("account.manage"));
    assert.ok(!system.body.global.includes("process.parameter.manage"));
    assert.equal(system.body.personal,true);
    const display = await verzoek("GET","/auth/permissions",await login("mes.display"));
    assert.equal(display.status,200);
    assert.equal(display.body.personal,false);
    assert.equal(display.body.linkedPerson,false);
    assert.ok(display.body.global.includes("display.downtime.read"));
    assert.ok(!display.body.global.includes("execution.read"));
    const token = await login("mes.scope.overview");
    const scoped = await verzoek("GET","/auth/permissions",token);
    assert.equal(scoped.status,200,JSON.stringify(scoped.body));
    assert.ok(!scoped.body.global.includes("analysis.execution.read"));
    assert.deepEqual(scoped.body.products.filter((p: any)=>p.permission==="analysis.execution.read"),[{permission:"analysis.execution.read",product:"PRD-A"}]);
    await beheerDb.query("UPDATE fabriek.authorization_grant SET revoked_at=now() WHERE user_id=(SELECT id FROM fabriek.gebruiker WHERE gebruikersnaam='mes.scope.overview')");
    const revoked = await verzoek("GET","/auth/permissions",token);
    assert.equal(revoked.status,200);
    assert.deepEqual(revoked.body.products,[]);
    assert.deepEqual(revoked.body.global,[]);
  });
  test("D101: inactieve configuratie vereist engineeringbeheer", async () => {
    const op = await login("mes.operator");
    const engineer = await login("mes.engineer");
    assert.equal((await verzoek("GET", "/config/stappen?ookInactief=true", op)).status,403);
    const r = await verzoek("GET", "/config/stappen?ookInactief=true", engineer);
    assert.equal(r.status,200,JSON.stringify(r.body));
  });
  test("D101: werkstationbinding volgt grants en persoonlijke koppeling, niet legacyrol", async () => {
    const name = "mes.pc.scope";
    await beheerDb.query("INSERT INTO fabriek.gebruiker(gebruikersnaam,rol,wachtwoord_hash) VALUES ($1,'analist',fabriek.wachtwoord_hash('demo'))",[name]);
    await beheerDb.query("INSERT INTO fabriek.operator(naam,gebruiker_id) SELECT gebruikersnaam,id FROM fabriek.gebruiker WHERE gebruikersnaam=$1",[name]);
    const token = await login(name);
    assert.equal((await verzoek("POST","/auth/pc",token,{pc:"PC-01"})).status,403);
    const {rows:[grant]} = await beheerDb.query("INSERT INTO fabriek.authorization_grant(user_id,role_code,product_id) SELECT g.id,'operator',p.id FROM fabriek.gebruiker g CROSS JOIN fabriek.product p WHERE g.gebruikersnaam=$1 AND p.code='PRD-A' RETURNING id",[name]);
    const bound = await verzoek("POST","/auth/pc",token,{pc:"PC-01"});
    assert.equal(bound.status,200,JSON.stringify(bound.body));
    assert.equal(bound.body.operator.naam,name);
    assert.equal(bound.body.naamKiezen,false);
    await beheerDb.query("UPDATE fabriek.authorization_grant SET revoked_at=now() WHERE id=$1",[grant.id]);
    assert.equal((await verzoek("POST","/auth/pc",token,{pc:"PC-01"})).status,403);
    for (const account of ["mes.system","mes.security.a","mes.display"]) {
      assert.equal((await verzoek("POST","/auth/pc",await login(account),{pc:"PC-01"})).status,403);
    }
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
    op = await login("operator.c", "PC-01");
    pl = await login("ploegleider1", "PC-02");
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
    assert.equal((await verzoek("GET", "/nalevering/keuzes", await login("mes.system"))).status, 403);
    assert.equal((await verzoek("GET", "/nalevering/keuzes", await login("mes.supervisor"))).status, 200);
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
    assert.equal((await verzoek("GET", "/conflicten", await login("mes.system"))).status, 403);
    assert.equal((await verzoek("GET", "/conflicten", await login("mes.quality"))).status, 403);
    const qualityConflicts = await verzoek("GET", "/conflicten", await login("mes.quality.approver"));
    assert.equal(qualityConflicts.status, 200);
    assert.ok(!qualityConflicts.body.some((x: any) => x.registratie_id === id), "kwaliteitsbeslisrecht geeft geen productiecorrectierecht");
    const open = await verzoek("GET", "/conflicten", pl);
    assert.equal(open.status, 200);
    const c = open.body.find((x: any) => x.registratie_id === id);
    assert.ok(c && c.stap === "PS1" && c.nummer.startsWith("B-"));
    assert.equal((await verzoek("POST", `/conflicten/${c.id}/oplossen`, op, { keuze: "bestaand", reden: "Eerste invoer gecontroleerd" })).status, 403);
    const opgelost = await verzoek("POST", `/conflicten/${c.id}/oplossen`, pl, { keuze: "bestaand", reden: "Eerste invoer gecontroleerd" });
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
    assert.equal(plNok.status, 403);
    const kw = await login("kwaliteit1");
    const b2 = await verzoek("POST", "/batches/B-2026-0104/besluiten", kw, { besluit: "afgekeurd", reden: "NOK: afvoeren", wachtwoord: "demo" });
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
    const zonder = await verzoek("POST", "/lots/L-2026-0001/herbewerking", op, { stapcode: "PS17", reden: "te nat na verpakken" });
    assert.equal(zonder.status, 422, JSON.stringify(zonder.body));
    assert.match(zonder.body.fout, /Vooraf geregistreerde herbewerkingsopdracht vereist/);
    const opdracht = await verzoek("POST", "/herbewerkingen", await login("kwaliteit1"), { nummer: "L-2026-0001", stapcode: "PS17", reden: "te nat na verpakken", wachtwoord: "demo" });
    assert.equal(opdracht.status, 201, JSON.stringify(opdracht.body));
    const herb = await verzoek("POST", "/lots/L-2026-0001/herbewerking", op, { stapcode: "PS17", reden: "te nat na verpakken" });
    assert.equal(herb.status, 201, JSON.stringify(herb.body));
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
    const bh = await login("mes.engineer");
    assert.equal((await verzoek("PATCH", "/beheer/velden/S2.2", bh, { gemeten_door: "kwaliteit" })).status, 200);
    const cfg = await verzoek("GET", "/config/stappen", op);
    assert.equal(cfg.body.find((s: any) => s.code === "PS2").velden.find((v: any) => v.code === "S2.2").gemeten_door, "kwaliteit");
    assert.equal((await verzoek("POST", "/batches", op, { batchnummer: "B-2026-0120" })).status, 201);
    await doorloop(op, "B-2026-0120", "batch", 1, 1);
    const start = await verzoek("POST", "/registraties", op, { stapcode: "PS2", batchnummer: "B-2026-0120" });
    assert.equal(start.body.velden.find((v: any) => v.code === "S2.2").gemeten_door, "kwaliteit");
    const fout = await verzoek("POST", `/registraties/${start.body.id}/waarden`, op, { waarden: [{ veldcode: "S2.2", gemeten: 410 }] });
    assert.equal(fout.status, 403);
    assert.equal((await verzoek("POST", `/registraties/${start.body.id}/waarden`, op, { waarden: [{ veldcode: "S2.1", setting: 80, gemeten: 81 }] })).status, 200);
    const af = await verzoek("POST", `/registraties/${start.body.id}/afronden`, op);
    assert.equal(af.status, 200, JSON.stringify(af.body));
    assert.equal(af.body.keuring.status, "open");
    const lijst = await verzoek("GET", "/keuringen?stap=PS2", op);
    const k = lijst.body.find((x: any) => x.nummer === "B-2026-0120");
    assert.equal(k.te_meten, 1);
    assert.ok(!(await verzoek("GET", "/werkvoorraad/PS3", op)).body.wachtend.some((w: any) => w.nummer === "B-2026-0120"));
    const kw = await login("kwaliteit1", "PC-01");
    const vroeg = await verzoek("POST", `/keuringen/${k.id}/besluit`, kw, { besluit: "vrijgegeven", wachtwoord: "demo" });
    assert.equal(vroeg.status, 422);
    assert.match(vroeg.body.fout, /Nog niet gemeten: S2.2/);
    assert.equal((await verzoek("POST", `/keuringen/${k.id}/besluit`, op, { besluit: "vrijgegeven", wachtwoord: "demo" })).status, 403);
    const meet = await verzoek("POST", `/registraties/${start.body.id}/waarden`, kw, { waarden: [{ veldcode: "S2.2", gemeten: 412 }] });
    assert.equal(meet.status, 200, JSON.stringify(meet.body));
    const vrij = await verzoek("POST", `/keuringen/${k.id}/besluit`, kw, { besluit: "vrijgegeven", wachtwoord: "demo" });
    assert.equal(vrij.status, 200, JSON.stringify(vrij.body));
    assert.equal(vrij.body.keuring.status, "vrijgegeven");
    assert.equal(vrij.body.keuring.besloten_door, "kwaliteit1");
    assert.equal((await verzoek("POST", `/keuringen/${k.id}/besluit`, kw, { besluit: "vrijgegeven", wachtwoord: "demo" })).status, 409);
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
    assert.equal((await verzoek("POST", "/herbewerkingen", pl, { nummer: "B-2026-0110", stapcode: "PS2", reden: "x", wachtwoord: "demo" })).status, 403);
    const fout = await verzoek("POST", "/herbewerkingen", pm, { nummer: "B-2026-0110", stapcode: "PS5", reden: "x", wachtwoord: "demo" });
    assert.equal(fout.status, 422);
    assert.match(fout.body.fout, /nog niet doorlopen/);
    const h = await verzoek("POST", "/herbewerkingen", pm, { nummer: "B-2026-0110", stapcode: "PS2", reden: "menger te kort", wachtwoord: "demo" });
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
    const intrek = await verzoek("POST", `/herbewerkingen/${h.body.id}/intrekken`, pm, { reden: "x", wachtwoord: "demo" });
    assert.equal(intrek.status, 422);
    assert.ok((await verzoek("GET", "/herbewerkingen", op)).body.some((x: any) => x.nummer === "B-2026-0110"));
  });
});

describe("beheer", () => {
  test("alleen bevoegde Process Engineer; nieuw veld krijgt de volgende code", async () => {
    const pl = await login("ploegleider1");
    const bh = await login("mes.engineer");
    const nieuw = { stapcode: "PS3", naam: "pH", soort: "overig", grens_min: 6, grens_max: 8 };
    assert.equal((await verzoek("POST", "/beheer/velden", pl, nieuw)).status, 403);
    assert.equal((await verzoek("POST", "/beheer/velden", await login("beheerder1"), nieuw)).status, 403);
    const r = await verzoek("POST", "/beheer/velden", bh, nieuw);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.code, "S3.4");
  });

  test("veld inactief zetten en daarna nieuw veld: code wordt niet hergebruikt", async () => {
    const bh = await login("mes.engineer");
    assert.equal((await verzoek("PATCH", "/beheer/velden/S3.4", bh, { actief: false })).status, 200);
    const r = await verzoek("POST", "/beheer/velden", bh, { stapcode: "PS3", naam: "Geleidbaarheid", soort: "overig" });
    assert.equal(r.body.code, "S3.5");
    const log = await verzoek("GET", "/beheer/logboek?limiet=5", await login("beheerder1"));
    assert.equal(log.body[0].gewijzigd_door, "mes.engineer");
  });

  test("onbekende eigenschap wijzigen wordt geweigerd", async () => {
    const bh = await login("mes.engineer");
    assert.equal((await verzoek("PATCH", "/beheer/velden/S1.1", bh, { code: "S1.9" })).status, 400);
  });
});

describe("werkvoorraad en apparaat-id's", () => {
  test("batch met eigen id twee keer versturen geeft één batch", async () => {
    const op = await login("operator.c", "PC-03");
    const id = randomUUID();
    assert.equal((await verzoek("POST", "/batches", op, { id, batchnummer: "B-2026-0200" })).status, 201);
    assert.equal((await verzoek("POST", "/batches", op, { id, batchnummer: "B-2026-0200" })).status, 200);
    assert.equal((await verzoek("POST", "/batches", op, { id, batchnummer: "B-2026-0201" })).status, 409);
  });
  test("NOK breekt een open stap af", async () => {
    const op = await login("operator.c", "PC-03");
    const pl = await login("ploegleider1");
    const kw = await login("kwaliteit1");
    assert.equal((await verzoek("POST", "/batches", op, { batchnummer: "B-2026-0300" })).status, 201);
    const reg = await verzoek("POST", "/registraties", op, { stapcode: "PS1", batchnummer: "B-2026-0300" });
    await verzoek("POST", "/batches/B-2026-0300/besluiten", pl, { besluit: "in_beoordeling", reden: "twijfel" });
    await verzoek("POST", "/batches/B-2026-0300/besluiten", kw, { besluit: "afgekeurd", reden: "vervuild", wachtwoord: "demo" });
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
    // #93: lots per product; een ander product geeft niets.
    assert.deepEqual((await verzoek("GET", "/lots?zoek=0100&product=BESTAATNIET", t)).body, []);
    if (lots.body[0].product) assert.equal((await verzoek("GET", `/lots?zoek=0100&product=${lots.body[0].product}`, t)).body[0].lotnummer, "L-2026-0001");
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
    // #99: wachten op het lot en de totale doorlooptijd per lot; het totaal is minstens zo lang als het lotdeel.
    const metLot = dl.body.per_week.find((w: any) => w.lots >= 1);
    assert.ok(metLot.totaal_uren_mediaan !== null && metLot.wacht_op_lot_uren_mediaan !== null, JSON.stringify(metLot));
    assert.ok(metLot.totaal_uren_mediaan >= metLot.lot_uren_mediaan, JSON.stringify(metLot));
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
    const engineer = await login("mes.engineer");
    const manager = await login("productiemanager1");
    assert.equal((await verzoek("PATCH", "/beheer/stappen/PS3", bh, { naam: "Mengen" })).status, 403);
    const st = await verzoek("PATCH", "/beheer/stappen/PS3", engineer, { naam: "Mengen" });
    assert.equal(st.status, 200, JSON.stringify(st.body));
    assert.equal(st.body.naam, "Mengen");
    assert.equal((await verzoek("PATCH", "/beheer/stappen/PS3", engineer, { volgorde: 1 })).status, 400);

    assert.equal((await verzoek("POST", "/beheer/gebruikers", bh, { gebruikersnaam: "kwaliteit2", rol: "kwaliteit", wachtwoord: "kort" })).status, 400);
    assert.equal((await verzoek("POST", "/beheer/gebruikers", bh, { gebruikersnaam: "kwaliteit2", rol: "kwaliteit", wachtwoord: "geheim-123" })).status, 422);
    const nieuw = await verzoek("POST", "/beheer/gebruikers", bh, { gebruikersnaam: "kwaliteit2", wachtwoord: "geheim-123" });
    assert.equal(nieuw.status, 201, JSON.stringify(nieuw.body));
    assert.equal(nieuw.body.rol, "pending");
    assert.equal((await verzoek("POST", "/auth/login", undefined, { gebruikersnaam: "kwaliteit2", wachtwoord: "geheim-123" })).status, 200);
    assert.equal((await verzoek("POST", "/beheer/gebruikers", bh, { gebruikersnaam: "kwaliteit2", wachtwoord: "geheim-123" })).status, 409);
    assert.equal((await verzoek("PATCH", "/beheer/gebruikers/kwaliteit2", bh, { actief: false })).status, 200);
    assert.equal((await verzoek("POST", "/auth/login", undefined, { gebruikersnaam: "kwaliteit2", wachtwoord: "geheim-123" })).status, 401);
    const zelf = await verzoek("PATCH", "/beheer/gebruikers/beheerder1", bh, { actief: false });
    assert.equal(zelf.status, 422);
    assert.equal((await verzoek("PATCH", "/beheer/gebruikers/analist1", bh, { wachtwoord: "nieuw-wachtwoord" })).status, 422);
    assert.equal((await verzoek("POST", "/auth/login", undefined, { gebruikersnaam: "analist1", wachtwoord: "demo" })).status, 200);

    assert.equal((await verzoek("POST", "/beheer/operators", bh, { naam: "Operator I" })).status, 403);
    const op = await verzoek("POST", "/beheer/operators", manager, { naam: "Operator I" });
    assert.equal(op.status, 201);
    assert.equal((await verzoek("PATCH", `/beheer/operators/${op.body.id}`, manager, { actief: false })).body.actief, false);

    const pc = await verzoek("POST", "/beheer/pcs", bh, { naam: "pc-21", locatie: "Hal 4" });
    assert.equal(pc.status, 201);
    assert.equal(pc.body.naam, "PC-21");
    const kop = await verzoek("PATCH", "/beheer/pcs/PC-21", bh, { stappen: ["PS1", "PS2"] });
    assert.deepEqual(kop.body.stappen, ["PS1", "PS2"]);
    assert.deepEqual((await verzoek("PATCH", "/beheer/pcs/PC-21", bh, { stappen: ["PS2"] })).body.stappen, ["PS2"]);
    assert.equal((await verzoek("PATCH", "/beheer/pcs/PC-21", bh, { stappen: ["PS99"] })).status, 422);

    const log = await verzoek("GET", "/beheer/logboek?limiet=50", bh);
    assert.ok(log.body.some((l: any) => l.tabel === "processtap" && l.nieuw.naam === "Mengen" && l.gewijzigd_door === "mes.engineer"));
    assert.ok(log.body.some((l: any) => l.tabel === "pc_stap" && l.actie === "DELETE" && l.extra.pc === "PC-21" && l.extra.stap === "PS1"));
    assert.ok(log.body.every((l: any) => !JSON.stringify(l).includes("wachtwoord_hash")));
    const pl = await login("ploegleider1");
    assert.equal((await verzoek("GET", "/beheer/gebruikers", pl)).status, 403);
  });
});

describe("Medewerkers in een ploeg (#87)", () => {
  test("personeelsindeling staat los van technisch accountbeheer (#87, D99)", async () => {
    const bh = await login("beheerder1");
    const manager = await login("productiemanager1");
    const n = await verzoek("POST", "/beheer/gebruikers", bh, { gebruikersnaam: "operator.z", rol: "operator", wachtwoord: "geheim-123", naam: "Operator Z", ploeg: "d2" });
    assert.equal(n.status, 422, JSON.stringify(n.body));
    const account = await verzoek("POST", "/beheer/gebruikers", bh, { gebruikersnaam: "operator.z", wachtwoord: "geheim-123" });
    assert.equal(account.status, 201, JSON.stringify(account.body));
    assert.equal(account.body.rol, "pending");
    assert.equal((await verzoek("PATCH", "/beheer/gebruikers/kwaliteit1", bh, { ploeg: "A1" })).status, 422);
    assert.equal((await verzoek("GET", "/beheer/operators", bh)).status, 403);
    const ops = await verzoek("GET", "/beheer/operators", manager);
    assert.equal(ops.status, 200, JSON.stringify(ops.body));
    const c = ops.body.find((o: any) => o.naam === "Operator C");
    assert.equal(c.ploeg, "C1");
    const p = await verzoek("PATCH", `/beheer/operators/${c.id}`, manager, { ploeg: "E2" });
    assert.equal(p.status, 200, JSON.stringify(p.body));
    assert.equal(p.body.ploeg, "E2");
    const z = await verzoek("POST", "/beheer/operators", manager, { naam: "Operator Z", ploeg: "d2" });
    assert.equal(z.status, 201, JSON.stringify(z.body));
    assert.deepEqual([z.body.naam, z.body.account, z.body.ploeg], ["Operator Z", null, "D2"]);
    assert.equal((await verzoek("POST", "/beheer/gebruikers/import", bh, { uitvoeren: true, regels: [] })).status, 404);
  });
});

describe("accounts met een tijdelijk wachtwoord (#76)", () => {
  test("persoonlijk account: daarna eerst een eigen wachtwoord", async () => {
    const bh = await login("beheerder1");
    const nieuw = await verzoek("POST", "/beheer/gebruikers", bh, { gebruikersnaam: "import.a", wachtwoord: "tijdelijk-a" });
    assert.equal(nieuw.status, 201, JSON.stringify(nieuw.body));

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
    assert.equal(w.body.operator, null);
    assert.equal((await verzoek("GET", "/config/stappen", w.body.token)).status, 403);
    const opnieuw = await verzoek("POST", "/auth/login", undefined, { gebruikersnaam: "import.a", wachtwoord: "eigen-wachtwoord" });
    assert.equal(opnieuw.body.wachtwoordWijzigen, undefined);
    // Een reset van een onbevoegd pending-account is opnieuw tijdelijk.
    assert.equal((await verzoek("PATCH", "/beheer/gebruikers/import.a", bh, { wachtwoord: "nieuw-tijdelijk" })).status, 200);
    assert.equal((await verzoek("POST", "/auth/login", undefined, { gebruikersnaam: "import.a", wachtwoord: "nieuw-tijdelijk" })).body.wachtwoordWijzigen, true);
    assert.equal((await verzoek("POST", "/beheer/gebruikers", bh, { gebruikersnaam: "tv.test", rol: "scherm", wachtwoord: "scherm-test" })).status, 422);
  });
});

describe("Pilotfeedback uitgesteld (D99/D101)", () => {
  test("geen legacy-feedbackwrites of inzage via oude rol", async () => {
    const id = randomUUID();
    for (const token of [await login("operator.a"), await login("mes.system")]) {
      assert.equal((await verzoek("POST", "/terugmeldingen", token, { id, tekst: "Test" })).status, 403);
      assert.equal((await verzoek("GET", "/terugmeldingen", token)).status, 403);
      assert.equal((await verzoek("POST", `/terugmeldingen/${id}/afhandelen`, token, {})).status, 403);
    }
    assert.equal((await beheerDb.query("SELECT 1 FROM fabriek.terugmelding WHERE id=$1",[id])).rowCount,0);
  });
});

describe("grenzen per product (D55)", () => {
  test("Process Engineer zet eigen grenzen per product; analyses filteren op product", async () => {
    const beheer = await login("mes.engineer");
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
    // #89: elk punt heeft de grenzen waaraan het getoetst is, en zijn product.
    for (const pt of trend.body.punten) assert.ok("grens_max" in pt && pt.product === "PRD-C", JSON.stringify(pt));
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
    const beheer = await login("mes.engineer");
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
    op = await login("operator.c", "PC-04");
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

  test("route per product (D55): PRD-C slaat PS6 over; alleen Process Engineers wijzigen een route", async () => {
    const engineer = await login("mes.engineer");
    const prod = await verzoek("GET", "/planning/producten", op);
    const c = prod.body.find((p: any) => p.code === "PRD-C");
    assert.deepEqual(c.route, ["PS1", "PS2", "PS3", "TK1", "PS4", "PS5", "PS7", "PS8", "PS9", "TK2", "PS11", "PS10", "PS12", "PS13", "PS15", "PS16", "PS18", "EK"]);
    assert.equal(prod.body.find((p: any) => p.code === "PRD-A").route, null);
    assert.equal((await verzoek("PUT", `/planning/producten/${c.id}/route`, op, { stappen: null })).status, 403);
    assert.equal((await verzoek("PUT", `/planning/producten/${c.id}/route`, planner, { stappen: null })).status, 403);
    const fout = await verzoek("PUT", `/planning/producten/${c.id}/route`, engineer, { stappen: ["PS1", "PS2"] });
    assert.equal(fout.status, 422);
    assert.match(fout.body.fout, /lotstap PS16/);
    const a = prod.body.find((p: any) => p.code === "PRD-A");
    const goed = await verzoek("PUT", `/planning/producten/${a.id}/route`, engineer, { stappen: ["PS1", "PS2", "PS16", "PS18"] });
    assert.equal(goed.status, 200, JSON.stringify(goed.body));
    assert.deepEqual(goed.body.route, ["PS1", "PS2", "PS16", "PS18"]);
    assert.equal((await verzoek("PUT", `/planning/producten/${a.id}/route`, engineer, { stappen: null })).body.route, null);

    // Hier zonder keuringsstappen (die doet Kwaliteit, #80); daarna weer de route uit de instellingen.
    const metKeuring = c.route;
    assert.equal((await verzoek("PUT", `/planning/producten/${c.id}/route`, engineer, { stappen: metKeuring.filter((x: string) => x.startsWith("PS")) })).status, 200);
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
    assert.equal((await verzoek("PUT", `/planning/producten/${c.id}/route`, engineer, { stappen: metKeuring })).status, 200);
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

describe("Beperkte display-identiteit (D99/D101)", () => {
  test("alleen afzonderlijk stilstandleesrecht, geen uitgebreide schermen", async () => {
    const t = await login("scherm1");
    assert.equal((await verzoek("GET", "/stilstand", t)).status, 200);
    for (const pad of ["/wandscherm", "/wandscherm/kwaliteit", "/analyse/afwijkingen", "/werkvoorraad", "/planning/week?van=2026-11-16", "/batches?gereedVoorLot=true"]) {
      assert.equal((await verzoek("GET", pad, t)).status, 403, pad);
    }
    assert.equal((await verzoek("POST", "/stilstand", t, { stapcode: "PS1", oorzaak: "TEST" })).status, 403);
    await beheerDb.query("UPDATE fabriek.gebruiker SET actief=false WHERE gebruikersnaam='scherm1'");
    try { assert.equal((await verzoek("GET", "/stilstand", t)).status, 401); }
    finally { await beheerDb.query("UPDATE fabriek.gebruiker SET actief=true WHERE gebruikersnaam='scherm1'"); }
  });
});

describe("Grondstoffen", () => {
  test("invoeren, verplicht bij afronden, correctie, terugzoeken en lotpaspoort", async () => {
    const op = await login("operator.c", "PC-05");
    const pl = await login("ploegleider1", "PC-05");
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
    // Een andere partij voor dezelfde grondstof: conflict, de eerste blijft staan (#85). Afronden wacht op een gemotiveerd besluit.
    const ander = await verzoek("POST", `/registraties/${start.body.id}/grondstoffen`, op, { grondstoffen: [{ code: "GS-A", partij: "ander" }] });
    assert.equal(ander.status, 200, JSON.stringify(ander.body));
    assert.deepEqual(ander.body.conflicten.map((x: any) => [x.soort, x.code, x.bestaand, x.nieuw]), [["grondstof", "GS-A", "LEV-A-9001, 125,5", "ander"]]);
    assert.equal(ander.body.grondstoffen[0].gebruik.partij, "LEV-A-9001");
    const geblokkeerd = await verzoek("POST", `/registraties/${start.body.id}/afronden`, op);
    assert.equal(geblokkeerd.status, 422, JSON.stringify(geblokkeerd.body));
    assert.match(geblokkeerd.body.fout, /Open invoerconflict blokkeert afronding/);
    const besluit = await verzoek("POST", `/conflicten/${ander.body.conflicten[0].id}/oplossen`, pl, { keuze: "bestaand", reden: "Partijnummer gecontroleerd tegen bronregistratie" });
    assert.equal(besluit.status, 200, JSON.stringify(besluit.body));
    assert.equal(besluit.body.conflicten.length, 0);
    assert.equal(besluit.body.grondstoffen[0].gebruik.partij, "LEV-A-9001");
    const afgerond = await verzoek("POST", `/registraties/${start.body.id}/afronden`, op);
    assert.equal(afgerond.status, 200, JSON.stringify(afgerond.body));
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
    const bh = await login("mes.engineer");
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
    const op = await login("operator.c", "PC-02");
    const ploegen = await verzoek("GET", "/overdracht/ploegen", op);
    assert.deepEqual(ploegen.body.map((p: any) => p.code), ["O", "M", "N"]);
    const nu = await verzoek("GET", "/overdracht", op);
    assert.equal(nu.status, 200, JSON.stringify(nu.body));
    assert.equal(nu.body.loopt_nog, true);
    assert.equal(typeof nu.body.cijfers.stappen_afgerond, "number");
    // #98: welke afwijkingen, met hoogstens 50 en evenveel als het cijfer (tot 50).
    assert.ok(Array.isArray(nu.body.afwijkingen));
    assert.equal(nu.body.afwijkingen.length, Math.min(50, nu.body.cijfers.afwijkingen));
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
    const alles = await verzoek("GET", `/overdracht/dag?dag=${nu.body.dag}`, await login("productiemanager1"));
    assert.ok(alles.body.some((p: any) => p.ploeg === nu.body.ploeg));
    // #62: planning van de dag, gelijk aan wat Planning per stap voor die dag laat zien.
    const plan = await verzoek("GET", `/overdracht/plan?dag=${nu.body.dag}`, await login("planner1"));
    assert.equal(plan.status, 200);
    const perStap = await verzoek("GET", `/planning/stappen?dag=${nu.body.dag}`, await login("planner1"));
    const items = perStap.body.flatMap((x: any) => x.items);
    assert.equal(plan.body.gepland, items.length);
    assert.equal(plan.body.afgerond, items.filter((i: any) => i.status === "gedaan").length);
    assert.equal(plan.body.bezig, items.filter((i: any) => i.status === "bezig").length);
    // Tussen 00:00 en 06:00 is de lopende ploeg de nachtploeg van gisteren; de testdata plant voor vandaag.
    const vandaagAmsterdam = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Amsterdam" });
    if (nu.body.dag === vandaagAmsterdam) assert.ok(plan.body.gepland > 0, "testdata heeft planning voor vandaag");
    // Kwaliteit heeft geen impliciet schrijfrecht.
    assert.equal((await verzoek("POST", "/overdracht", await login("kwaliteit1"), { bijzonderheden: "x" })).status, 403);
  });

  test("Manufacturing Manager past ploegtijden aan", async () => {
    const bh = await login("productiemanager1");
    const r = await verzoek("PATCH", "/overdracht/ploegen/O", bh, { naam: "Vroege ploeg" });
    assert.equal(r.body.naam, "Vroege ploeg");
    assert.equal((await verzoek("PATCH", "/overdracht/ploegen/O", bh, { begint: "25:00" })).status, 400);
    await verzoek("PATCH", "/overdracht/ploegen/O", bh, { naam: "Ochtenddienst" });
    assert.equal((await verzoek("PATCH", "/overdracht/ploegen/O", await login("planner1"), { naam: "x" })).status, 403);
  });

  test("ploegen A–E in twee divisies met rooster; de overdracht noemt de ploegen (#86)", async () => {
    const bh = await login("productiemanager1");
    const r = await verzoek("GET", "/overdracht/rooster?van=2026-01-05&dagen=10", await login("ploegleider1"));
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
    const op = await login("operator.c", "PC-06");
    const pl = await login("ploegleider2");
    const kw = await login("kwaliteit1");
    const pn = await login("planner1");
    for (const t of [pl, kw, pn]) await verzoek("POST", "/meldingen/alles-gelezen", t);
    assert.equal((await verzoek("GET", "/meldingen", op)).status, 403);
    for (const name of ["mes.system","mes.security.a","mes.quality"]) {
      const t = await login(name);
      assert.equal((await verzoek("GET", "/meldingen", t)).status, 403);
      assert.equal((await verzoek("POST", "/meldingen/alles-gelezen", t)).status, 403);
    }
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
    assert.equal((await verzoek("POST", `/meldingen/${m.id}/gelezen`, pn)).status, 404, "planner kan een niet-zichtbare melding niet markeren");
    const before = await beheerDb.query("SELECT gebruiker_id FROM fabriek.melding_gelezen WHERE melding_id=$1",[m.id]);
    assert.equal(before.rowCount,0);
    assert.equal((await verzoek("POST", `/meldingen/${m.id}/gelezen`, kw)).status, 204);
    assert.equal((await verzoek("GET", "/meldingen", kw)).body.ongelezen, 0);
    assert.equal((await verzoek("GET", "/meldingen?ongelezen=true", pl)).body.meldingen[0].id, m.id);
    // Besluiten.
    await verzoek("POST", "/batches/B-2026-0710/besluiten", pl, { besluit: "in_beoordeling", reden: "gewicht te hoog" });
    await verzoek("POST", "/batches/B-2026-0710/besluiten", kw, { besluit: "afgekeurd", reden: "te zwaar", wachtwoord: "demo" });
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
    const op = await login("operator.c", "PC-07");
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
    assert.equal(wand.status, 403);
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
    const bh = await login("productiemanager1");
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
  test("keuringsstappen en historische specificaties lezen; legacy-writes geblokkeerd (D101)", async () => {
    const kw = await login("kwaliteit1");
    const stappen = (await verzoek("GET", "/config/stappen", kw)).body;
    assert.deepEqual(stappen.filter((s: any) => s.soort === "keuring").map((s: any) => s.code), ["TK1", "TK2", "EK"]);
    const lees = async () => (await verzoek("GET", "/specificaties?product=PRD-C", kw)).body;
    const sp = await lees();
    assert.deepEqual(sp.stappen.map((s: any) => [s.stap, s.geldig?.versie, s.concept]), [["TK1", 1, null], ["TK2", 1, null], ["EK", 1, null]]);
    assert.deepEqual(sp.stappen[2].geldig.regels.map((r: any) => r.veld), ["EK.1", "EK.2", "EK.3"]);
    assert.deepEqual((await verzoek("GET", "/specificaties?product=PRD-A", kw)).body.stappen, [], "PRD-A heeft geen keuringsstappen");
    assert.equal((await verzoek("GET", "/specificaties?product=PRD-X", kw)).status, 404);
    assert.equal((await verzoek("POST", "/specificaties", await login("operator.a"), { product: "PRD-C", stap: "EK" })).status, 403);
    const qa = await login("mes.quality.approver");
    const system = await login("mes.system");
    assert.equal((await verzoek("GET", "/specificaties?product=PRD-C", system)).status, 403);
    const { rows: [existing] } = await beheerDb.query("SELECT x.id FROM fabriek.specificatie x JOIN fabriek.product p ON p.id=x.product_id JOIN fabriek.processtap s ON s.id=x.processtap_id WHERE p.code='PRD-C' AND s.code='EK' AND x.status='vastgesteld'");
    for (const token of [qa, system]) {
      assert.equal((await verzoek("POST", "/specificaties", token, { product: "PRD-C", stap: "EK" })).status, 403);
      assert.equal((await verzoek("PUT", `/specificaties/${existing.id}`, token, { regels: [] })).status, 403);
      assert.equal((await verzoek("POST", `/specificaties/${existing.id}/vaststellen`, token)).status, 403);
      assert.equal((await verzoek("POST", `/specificaties/${existing.id}/weggooien`, token)).status, 403);
    }
    assert.deepEqual(await lees(), sp, "geblokkeerde writes laten specificaties intact");
  });
});

describe("Geen voorspelling van toekomstige keuringen (D96)", () => {
  test("de uitgestelde voorspelling is niet beschikbaar via de API", async () => {
    const r = await verzoek("GET", "/keuringen/verwacht?uren=48", await login("mes.quality"));
    assert.equal(r.status, 404, JSON.stringify(r.body));
  });
});

describe("Uitgebreid kwaliteitswandscherm uitgesteld (D99)", () => {
  test("geen omweg via persoonlijke accountrol", async () => {
    for (const name of ["operator.a","kwaliteit1","mes.system"]) {
      assert.equal((await verzoek("GET", "/wandscherm/kwaliteit", await login(name))).status,403);
    }
  });
});

describe("Capaciteit in kilogram (#90)", () => {
  test("kg per uur, dag of maand; batches per dag uit het gewicht per batch; zonder gewicht nog invullen", async () => {
    const t = await login("planner1");
    const engineer = await login("mes.engineer");
    const lees = async () => (await verzoek("GET", "/planning/capaciteit", t)).body;
    let c = await lees();
    assert.equal(c.uren_per_dag, 24);
    assert.ok(Math.abs(c.dagen_per_maand - 365 / 12) < 1e-9);
    const regel = (b: any, stap: string, prod: string) => b.per_stap.find((x: any) => x.stap === stap && x.product === prod);
    assert.deepEqual([regel(c, "PS2", "PRD-A").kg_per_dag, regel(c, "PS2", "PRD-A").gewicht], [null, 410]);
    // 200 kg per uur × 24 uur = 4800 kg per dag = 11 batches van 410 kg.
    assert.equal((await verzoek("PUT", "/planning/capaciteit/stappen/PS2", t, { product: "PRD-A", kg: 200, per: "uur" })).status, 204);
    c = await lees();
    assert.deepEqual([regel(c, "PS2", "PRD-A").kg_per_dag, regel(c, "PS2", "PRD-A").max_per_dag], [4800, 11]);
    // Per maand: 146000 kg / (365/12) = 4800 kg per dag.
    await verzoek("PUT", "/planning/capaciteit/stappen/PS2", t, { product: "PRD-A", kg: 146000, per: "maand" });
    assert.equal(regel(await lees(), "PS2", "PRD-A").kg_per_dag, 4800);
    // Lotstap: een lot weegt 4 batches.
    assert.equal(regel(c, "PS16", "PRD-A").gewicht, 1640);
    // Zonder gewicht per batch: nog invullen.
    const prod = (await verzoek("GET", "/planning/producten", t)).body.find((x: any) => x.code === "PRD-A");
    assert.equal(prod.batchgewicht_kg, 410);
    assert.equal((await verzoek("PATCH", `/planning/producten/${prod.id}`, engineer, { batchgewicht_kg: null })).body.batchgewicht_kg, null);
    c = await lees();
    assert.equal(regel(c, "PS2", "PRD-A").max_per_dag, null);
    assert.ok(c.nog_invullen > 0);
    assert.equal((await verzoek("PATCH", `/planning/producten/${prod.id}`, engineer, { batchgewicht_kg: 410 })).body.batchgewicht_kg, 410);
    assert.equal((await verzoek("PUT", "/planning/capaciteit/stappen/PS2", t, { product: "PRD-A", kg: null })).status, 204);
    assert.equal(regel(await lees(), "PS2", "PRD-A").kg_per_dag, null);
    assert.equal((await verzoek("PUT", "/planning/capaciteit/stappen/PS2", t, { product: "PRD-A" })).status, 400);
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
  test("concept raadplegen, nieuwe uitgifte geblokkeerd (D101)", async () => {
    const kw = await login("kwaliteit1");
    const c = await verzoek("GET", "/certificaten/lots/L-2026-0001", kw);
    assert.equal(c.status, 200, JSON.stringify(c.body));
    const k = c.body.concept;
    assert.deepEqual(k.kenmerken.map((x: any) => x.veld), ["S3.3", "S7.3", "S17.2", "S18.2", "S18.3"]);
    assert.equal(k.kenmerken[0].resultaten.length, 4, "batchkenmerk: één resultaat per batch");
    assert.equal(k.bedrijf.naam, "Voorbeeldfabriek B.V. (fictief)");
    assert.equal(c.body.uitgegeven.length, 0);
    const qa = await login("mes.quality.approver");
    const system = await login("mes.system");
    for (const token of [kw, qa, system]) {
      assert.equal((await verzoek("POST", "/certificaten/lots/L-2026-0001", token)).status, 403);
    }
    assert.equal((await verzoek("GET", "/certificaten/lots/L-2026-0001", system)).status, 403);
    assert.equal((await verzoek("GET", "/certificaten/lots/L-2026-0001", qa)).body.uitgegeven.length, 0);
  });

  test("Historische herdruk vereist actuele lotscope (D101)", async () => {
    const kw = await login("kwaliteit1");
    const concept = await verzoek("GET", "/certificaten/lots/L-2026-0001", kw);
    assert.equal(concept.status,200);
    // Fictieve historische fixture, uitsluitend eigenaar; geen nieuwe API-uitgifte.
    const { rows: [cert] } = await beheerDb.query(`
      INSERT INTO fabriek.certificaat(lot_id,inhoud,uitgegeven_door)
      SELECT l.id,$1::jsonb,g.id FROM fabriek.lot l CROSS JOIN fabriek.gebruiker g
      WHERE l.lotnummer='L-2026-0001' AND g.gebruikersnaam='kwaliteit1' RETURNING nummer
    `, [JSON.stringify(concept.body.concept)]);
    assert.ok(cert);
    const r = await verzoek("GET", `/certificaten/${cert.nummer}`, kw);
    assert.equal(r.status,200,JSON.stringify(r.body));
    assert.deepEqual(r.body.inhoud,concept.body.concept);
    assert.equal((await verzoek("GET", `/certificaten/${cert.nummer}`, await login("mes.system"))).status,404);
    assert.equal((await verzoek("GET", `/certificaten/${cert.nummer}`, await login("mes.security.a"))).status,404);
  });

  test("certificaatinstellingen read-only, bestaande veldconfiguratie zichtbaar", async () => {
    const kw = await login("kwaliteit1");
    const bh = await login("mes.system");
    assert.equal((await verzoek("GET", "/certificaten/instellingen", bh)).status, 403);
    assert.equal((await verzoek("PUT", "/certificaten/instellingen", bh, { bedrijfsnaam: "Testfabriek (fictief)", bedrijfsadres: "Testweg 1", certificaat_verklaring: "Test." })).status, 403);
    assert.equal((await verzoek("GET", "/certificaten/instellingen", kw)).body.bedrijfsnaam, "Voorbeeldfabriek B.V. (fictief)");
    const v = await verzoek("PATCH", "/beheer/velden/S9.2", await login("mes.engineer"), { op_certificaat: true });
    assert.equal(v.status, 200, JSON.stringify(v.body));
    const c = await verzoek("GET", "/certificaten/lots/L-2026-0001", kw);
    assert.ok(c.body.concept.kenmerken.some((x: any) => x.veld === "S9.2"));
    await verzoek("PATCH", "/beheer/velden/S9.2", await login("mes.engineer"), { op_certificaat: false });
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
    const tokenA = await login("operator.d", "PC-01");
    const [opB] = (await beheerDb.query("SELECT id FROM fabriek.operator WHERE naam = 'Operator D'")).rows;
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
    assert.equal(start.body.operator, "Operator D", "persoonlijke operator van de wachtrij");
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
    const token = await login("operator.c", "PC-01");
    const nr = "B-2026-8002";
    assert.equal((await verzoek("POST", "/batches", token, { batchnummer: nr })).status, 201);
    const start = await verzoek("POST", "/registraties", token, { stapcode: "PS1", batchnummer: nr });
    assert.equal(start.status, 201);
    assert.equal(start.body.operator, "Operator C");
    assert.ok(Math.abs(Date.parse(start.body.gestart_op) - Date.now()) < 60_000);
  });

  test("een ongeldige operatorkop wordt geweigerd", async () => {
    const token = await login("operator.c", "PC-01");
    const nr = "B-2026-8003";
    assert.equal((await verzoek("POST", "/batches", token, { batchnummer: nr })).status, 201);
    const start = await metKoppen("POST", "/registraties", token, { "x-batchgui-operator": "geen-uuid" }, { stapcode: "PS1", batchnummer: nr });
    assert.equal(start.status, 403);
  });

  test("startpagina: inloggen zonder pc, dan met /auth/pc naar het invoerscherm (D54)", async () => {
    const zonderPc = await login("operator.a");
    const geen = await verzoek("POST", "/batches", zonderPc, { batchnummer: "B-2026-8030" });
    assert.equal(geen.status, 400, "zonder pc geen invoer");
    const [voorPc] = (await beheerDb.query("SELECT count(*)::int AS n FROM fabriek.inlogpoging WHERE gebruikersnaam = 'operator.a' AND pc = 'PC-10' AND uitkomst = 'gelukt'")).rows;
    const r = await verzoek("POST", "/auth/pc", zonderPc, { pc: "PC-10" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.operator.naam, "Operator A");
    const payload = (token: string) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    const original = payload(zonderPc), bound = payload(r.body.token);
    assert.notEqual(bound.sessionProof, original.sessionProof);
    const context = async (proof: string) => (await beheerDb.query(
      "SELECT s.pc_id,p.naam,s.expires_at FROM fabriek.execution_session s LEFT JOIN fabriek.pc p ON p.id=s.pc_id WHERE s.proof_hash=public.digest($1,'sha256')", [proof])).rows[0];
    const oldContext = await context(original.sessionProof), newContext = await context(bound.sessionProof);
    assert.equal(oldContext.pc_id, null);
    assert.equal(newContext.pc_id, bound.pcId);
    assert.equal(newContext.naam, "PC-10");
    assert.deepEqual(newContext.expires_at, oldContext.expires_at);
    const direct = payload(await login("operator.a","PC-01"));
    assert.equal((await context(direct.sessionProof)).pc_id, direct.pcId);
    const switched = await verzoek("POST","/auth/pc",r.body.token,{pc:"PC-01"});
    assert.equal(switched.status,200);
    const switchedPayload = payload(switched.body.token);
    assert.equal((await context(switchedPayload.sessionProof)).naam,"PC-01");
    assert.equal((await context(bound.sessionProof)).naam,"PC-10");
    assert.deepEqual((await context(switchedPayload.sessionProof)).expires_at,oldContext.expires_at);
    assert.equal((await verzoek("POST", "/batches", r.body.token, { batchnummer: "B-2026-8030" })).status, 201);
    const [p] = (await beheerDb.query("SELECT count(*)::int AS n FROM fabriek.inlogpoging WHERE gebruikersnaam = 'operator.a' AND pc = 'PC-10' AND uitkomst = 'gelukt'")).rows;
    assert.equal(p.n, voorPc.n, "werkstationbinding is geen wachtwoordlogin");
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
    assert.ok(b.testaccounts.some((t: { naam: string }) => t.naam === "mes.operator"));
  });

  test("eerste inlog van een ploegleider zonder naam: maakt geen personeelsidentiteit aan (D99)", async () => {
    await beheerDb.query("INSERT INTO fabriek.gebruiker (gebruikersnaam, rol, wachtwoord_hash) VALUES ('ploegleider9', 'ploegleider', fabriek.wachtwoord_hash('demo'))");
    const r = await verzoek("POST", "/auth/login", undefined, { gebruikersnaam: "ploegleider9", wachtwoord: "demo", pc: "PC-09" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.operator, null);
    assert.equal(JSON.parse(Buffer.from(r.body.token.split(".")[1], "base64url").toString()).operatorId, undefined);
    assert.equal((await beheerDb.query("SELECT count(*)::int AS n FROM fabriek.operator o JOIN fabriek.gebruiker g ON g.id=o.gebruiker_id WHERE g.gebruikersnaam=\x27ploegleider9\x27")).rows[0].n, 0);
  });

  test("eigen account: naam ligt vast, andere identiteit ook na login geweigerd (D94)", async () => {
    const r = await verzoek("POST", "/auth/login", undefined, { gebruikersnaam: "operator.a", wachtwoord: "demo", pc: "PC-08" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.naamKiezen, false);
    assert.equal(r.body.operator.naam, "Operator A");
    const tokenA = r.body.token;
    assert.equal((await verzoek("GET", "/auth/operators", tokenA)).status, 404);
    assert.equal((await verzoek("POST", "/auth/operator", tokenA, { operatorId: randomUUID() })).status, 404);
    const nr = "B-2026-8020";
    assert.equal((await verzoek("POST", "/batches", tokenA, { batchnummer: nr })).status, 201);
    const start = await verzoek("POST", "/registraties", tokenA, { stapcode: "PS1", batchnummer: nr });
    assert.equal(start.body.operator, "Operator A");
    // Wachtrij met invoer van Operator B, die niet op PC-08 inlogde: geweigerd.
    const [opB] = (await beheerDb.query("SELECT id FROM fabriek.operator WHERE naam = 'Operator B'")).rows;
    const nr2 = "B-2026-8021";
    const fout = await metKoppen("POST", "/batches", tokenA, { "x-batchgui-operator": opB.id }, { batchnummer: nr2 });
    assert.equal(fout.status, 403, JSON.stringify(fout.body));

    // Een eerdere login geeft geen bevoegdheid namens een andere persoon.
    await login("operator.b", "PC-08");
    assert.equal((await metKoppen("POST", "/batches", tokenA, { "x-batchgui-operator": opB.id }, { batchnummer: nr2 })).status, 403);

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
    const bh = await login("mes.engineer");
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
    const log = await beheerDb.query("SELECT count(*)::int AS n FROM fabriek.config_log WHERE tabel = 'veld' AND gewijzigd_door = 'mes.engineer' AND gewijzigd_op > now() - interval '1 minute'");
    assert.ok(log.rows[0].n >= 2, "wijzigingen staan in het logboek");

    const nogmaals = await verzoek("POST", "/beheer/velden/import", bh, { uitvoeren: false, regels: [{ ...goed[0] }] });
    assert.equal(nogmaals.body.gelijk, 1, "ongewijzigd veld telt als gelijk");
  });

  test("soort en stap van een bestaand veld veranderen niet; onbekende code; alleen de Process Engineer", async () => {
    const bh = await login("mes.engineer");
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
    assert.match(r.body, /mes\.planner/);
    const echt = startpagina(false);
    assert.doesNotMatch(echt, /Testaccounts|demo|Testomgeving/);
  });

  test("Beheer > Server waarschuwt voor testaccounts met wachtwoord demo", async () => {
    const r = await verzoek("GET", "/beheer/server", await login("beheerder1"));
    assert.equal(r.status, 200);
    assert.ok(r.body.testaccounts.includes("mes.system"), JSON.stringify(r.body.testaccounts));
    assert.ok(!r.body.waarschuwingen.some((w: { tekst: string }) => /testaccount/.test(w.tekst)), "geen waarschuwing: met testdata is dit normaal");
  });
});

describe("Decimalen per veld (0.23.0)", () => {
  test("instellen in Beheer, terug in de configuratie en in het sjabloon zonder kolom blijft hij staan", async () => {
    const bh = await login("mes.engineer");
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
    const bh = await login("mes.engineer");
    const r = await verzoek("PATCH", "/beheer/velden/S6.1", bh, { grens_min: 0 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(Number(r.body.grens_min), 0);
    const leeg = await verzoek("PATCH", "/beheer/velden/S6.1", bh, { grens_min: null });
    assert.equal(leeg.body.grens_min, null, "null blijft null");
    const token = await login("operator.c", "PC-01");
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
    const token = await login("operator.c", "PC-02");
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

  test("pilotrapportage en instellingen uitgesteld; instellingen blijven intact", async () => {
    const voor = (await beheerDb.query("SELECT sleutel,waarde FROM fabriek.instelling ORDER BY sleutel")).rows;
    for (const name of ["productiemanager1","mes.system","planner1"]) {
      const token = await login(name);
      assert.equal((await verzoek("GET", "/pilot", token)).status,403);
      assert.equal((await verzoek("PUT", "/pilot/instellingen", token, { pilot_start: null, te_laat_minuten: 90 })).status,403);
    }
    assert.deepEqual((await beheerDb.query("SELECT sleutel,waarde FROM fabriek.instelling ORDER BY sleutel")).rows,voor);
  });
});

 test("sessiegeneratie: oude tokens herleven niet na wijziging of deactivatie", async () => {
  await beheerDb.query("INSERT INTO fabriek.gebruiker(gebruikersnaam,rol,wachtwoord_hash) VALUES ('session.test','operator',fabriek.wachtwoord_hash('demo'))");
  await beheerDb.query("INSERT INTO fabriek.operator(naam,gebruiker_id) SELECT 'session.test',id FROM fabriek.gebruiker WHERE gebruikersnaam='session.test'");
  await beheerDb.query("INSERT INTO fabriek.authorization_grant(user_id,role_code) SELECT id,'operator' FROM fabriek.gebruiker WHERE gebruikersnaam='session.test'");
  const old = await login("session.test");
  const changed = await verzoek("POST","/auth/wachtwoord",old,{huidig:"demo",nieuw:"session-new-password"});
  assert.equal(changed.status,200);
  assert.equal((await verzoek("POST","/auth/pc",old,{pc:"PC-01"})).status,401);
  assert.equal((await verzoek("POST","/auth/pc",changed.body.token,{pc:"PC-01"})).status,200);
  await beheerDb.query("UPDATE fabriek.gebruiker SET actief=false WHERE gebruikersnaam='session.test'");
  await beheerDb.query("UPDATE fabriek.gebruiker SET actief=true WHERE gebruikersnaam='session.test'");
  assert.equal((await verzoek("POST","/auth/pc",changed.body.token,{pc:"PC-01"})).status,401);
});

describe("#109 materiaal-API", () => {
  test("persoonlijke toegang, actuele grants en onveranderlijke revisies", async () => {
    const engineer = await login("mes.engineer");
    const operator = await login("mes.operator");
    const system = await login("mes.system");
    const approver = await login("mes.eng.approver");
    const legacy = await login("analist1");
    const base = "/materials/";
    const payload = { code:"API-MAT",name:"Fictief",material_class_id:null,unit:"kg",product_id:null,raw_material_id:null };
    assert.equal((await verzoek("GET",base)).status,401);
    for (const token of [operator,system,approver,legacy]) {
      assert.equal((await verzoek("GET",base,token)).status,403);
      assert.equal((await verzoek("POST",base+"definitions",token,payload)).status,403);
    }
    assert.equal((await verzoek("POST",base+"definitions",engineer,{...payload,created_by:randomUUID()})).status,400);
    assert.equal((await verzoek("POST",base+"definitions",engineer,{...payload,name:"   "})).status,400);
    const klasse = await verzoek("POST",base+"classes",engineer,{code:"API-MAT-C",name:"Fictieve klasse"});
    assert.equal(klasse.status,201,JSON.stringify(klasse.body));
    const created = await verzoek("POST",base+"definitions",engineer,{...payload,material_class_id:klasse.body.id});
    assert.equal(created.status,201,JSON.stringify(created.body));
    const url = base+"definitions/"+created.body.id+"/versions";
    const change = {expected_revision:1,name:"Fictief 2",material_class_id:klasse.body.id,unit:"kg"};
    assert.equal((await verzoek("POST",url,engineer,change)).status,201);
    assert.equal((await verzoek("POST",url,engineer,change)).status,409);
    assert.equal((await verzoek("POST",base+"definitions",engineer,payload)).status,409);
    assert.equal((await verzoek("POST",base+"definitions",engineer,{...payload,code:"API-MAT-BAD",material_class_id:randomUUID()})).status,422);
    const result = await verzoek("GET",base,engineer);
    assert.equal(result.status,200,JSON.stringify(result.body));
    const versions = result.body.versions.filter((v:any)=>v.material_definition_id===created.body.id);
    assert.deepEqual(versions.map((v:any)=>v.revision),[1,2]);
    const {rows:[actor]} = await beheerDb.query("SELECT id FROM fabriek.gebruiker WHERE gebruikersnaam='mes.engineer'");
    assert.ok(versions.every((v:any)=>v.created_by===actor.id));
    assert.ok(!result.body.definitions.some((d:any)=>d.code==="API-MAT-BAD"));
  });
  test("ingetrokken grant blokkeert een nog geldig token", async () => {
    const naam = "mes.material.revoked";
    await beheerDb.query("INSERT INTO fabriek.gebruiker(gebruikersnaam,rol,wachtwoord_hash) VALUES ($1,'analist',fabriek.wachtwoord_hash('demo'))",[naam]);
    const {rows:[g]} = await beheerDb.query("INSERT INTO fabriek.authorization_grant(user_id,role_code) SELECT id,'process_engineer' FROM fabriek.gebruiker WHERE gebruikersnaam=$1 RETURNING id",[naam]);
    const token = await login(naam);
    assert.equal((await verzoek("GET","/materials/",token)).status,200);
    await beheerDb.query("UPDATE fabriek.authorization_grant SET revoked_at=now() WHERE id=$1",[g.id]);
    assert.equal((await verzoek("GET","/materials/",token)).status,403);
    assert.equal((await verzoek("POST","/materials/classes",token,{code:"REVOKED",name:"Geweigerd"})).status,403);
  });
});

describe("#110 MBR-API", () => {
  test("productscope, revisies en persoonlijke conceptaudit", async () => {
    const engineer = await login("mes.engineer");
    const op = await login("mes.operator");
    const system = await login("mes.system");
    const { rows: products } = await beheerDb.query("SELECT id,code FROM fabriek.product WHERE code IN ('PRD-A','PRD-B')");
    const pa = products.find(p=>p.code==="PRD-A").id;
    const pb = products.find(p=>p.code==="PRD-B").id;
    const naam = "mes.recipe.scoped";
    await beheerDb.query("INSERT INTO fabriek.gebruiker(gebruikersnaam,rol,wachtwoord_hash) VALUES ($1,'analist',fabriek.wachtwoord_hash('demo'))",[naam]);
    const {rows:[grant]} = await beheerDb.query("INSERT INTO fabriek.authorization_grant(user_id,role_code,product_id) SELECT id,'process_engineer',$2 FROM fabriek.gebruiker WHERE gebruikersnaam=$1 RETURNING id",[naam,pa]);
    const scoped = await login(naam);
    const base = "/recipes/";
    const listA = base+"?product_id="+pa;
    const listB = base+"?product_id="+pb;
    const payload = {product_id:pa,code:"API-MBR-A",name:"Fictief A",description:""};
    assert.equal((await verzoek("GET",listA)).status,401);
    for(const token of [op,system]) {
      assert.equal((await verzoek("GET",listA,token)).status,403);
      assert.equal((await verzoek("POST",base,token,payload)).status,403);
    }
    assert.equal((await verzoek("GET",listB,scoped)).status,403);
    assert.equal((await verzoek("POST",base,scoped,{...payload,product_id:pb})).status,403);
    const a = await verzoek("POST",base,scoped,payload);
    assert.equal(a.status,201,JSON.stringify(a.body));
    const b = await verzoek("POST",base,engineer,{...payload,product_id:pb,code:"API-MBR-B"});
    assert.equal(b.status,201,JSON.stringify(b.body));
    assert.equal((await verzoek("POST",base,scoped,payload)).status,409);
    assert.equal((await verzoek("POST",base,scoped,{...payload,created_by:randomUUID()})).status,400);
    const next = {expected_revision:1,name:"Fictief A2",description:""};
    assert.equal((await verzoek("POST",base+b.body.id+"/versions",scoped,next)).status,403);
    const version = await verzoek("POST",base+a.body.id+"/versions",scoped,next);
    assert.equal(version.status,201,JSON.stringify(version.body));
    assert.equal((await verzoek("POST",base+a.body.id+"/versions",scoped,next)).status,409);
    const target = base+"versions/"+version.body.id;
    const edit = {expected_change_no:0,name:"Fictief gewijzigd",description:"Test"};
    const edited = await verzoek("PATCH",target,scoped,edit);
    assert.equal(edited.status,200,JSON.stringify(edited.body));
    assert.equal(edited.body.change_no,1);
    assert.equal((await verzoek("PATCH",target,scoped,edit)).status,409);
    const other = await verzoek("GET",listB,engineer);
    assert.equal(other.status,200,JSON.stringify(other.body));
    const otherVersion = other.body.find((x:any)=>x.id===b.body.id).versions[0].id;
    assert.equal((await verzoek("PATCH",base+"versions/"+otherVersion,scoped,edit)).status,403);
    const listing = await verzoek("GET",listA,scoped);
    assert.equal(listing.status,200,JSON.stringify(listing.body));
    const versions = listing.body.find((x:any)=>x.id===a.body.id).versions;
    assert.deepEqual(versions.map((x:any)=>[x.revision,x.name,x.change_no]),[[1,"Fictief A",0],[2,"Fictief gewijzigd",1]]);
    const {rows:[audit]} = await beheerDb.query("SELECT l.actor_origin,g.gebruikersnaam,l.oud,l.nieuw FROM fabriek.config_log l JOIN fabriek.gebruiker g ON g.id=l.actor_user_id WHERE l.tabel='master_recipe_version' AND l.record_id=$1 AND l.actie='UPDATE'",[version.body.id]);
    assert.equal(audit.actor_origin,"personal");
    assert.equal(audit.gebruikersnaam,naam);
    assert.equal(audit.oud.name,"Fictief A2");
    assert.equal(audit.nieuw.name,"Fictief gewijzigd");
    await beheerDb.query("UPDATE fabriek.authorization_grant SET revoked_at=now() WHERE id=$1",[grant.id]);
    assert.equal((await verzoek("PATCH",target,scoped,{...edit,expected_change_no:1})).status,403);
  });
});

describe("#103/110 procedure-API", () => {
  test("versiegebonden boom, productscope, audit en gezamenlijke teller", async () => {
    const engineer = await login("mes.engineer");
    const op = await login("mes.operator");
    const system = await login("mes.system");
    const {rows:products} = await beheerDb.query("SELECT id,code FROM fabriek.product WHERE code IN ('PRD-A','PRD-B')");
    const pa = products.find(p=>p.code==="PRD-A").id;
    const pb = products.find(p=>p.code==="PRD-B").id;
    const naam = "mes.procedure.scoped";
    await beheerDb.query("INSERT INTO fabriek.gebruiker(gebruikersnaam,rol,wachtwoord_hash) VALUES ($1,'analist',fabriek.wachtwoord_hash('demo'))",[naam]);
    const {rows:[grant]} = await beheerDb.query("INSERT INTO fabriek.authorization_grant(user_id,role_code,product_id) SELECT id,'process_engineer',$2 FROM fabriek.gebruiker WHERE gebruikersnaam=$1 RETURNING id",[naam,pa]);
    const scoped = await login(naam);
    const make = async (product_id:string,code:string) => {
      const made = await verzoek("POST","/recipes/",engineer,{product_id,code,name:code,description:""});
      assert.equal(made.status,201,JSON.stringify(made.body));
      const list = await verzoek("GET","/recipes/?product_id="+product_id,engineer);
      assert.equal(list.status,200,JSON.stringify(list.body));
      return list.body.find((r:any)=>r.id===made.body.id).versions[0].id as string;
    };
    const version = await make(pa,"API-PROC-A");
    const other = await make(pb,"API-PROC-B");
    const base = "/recipes/versions/"+version+"/procedure";
    const otherBase = "/recipes/versions/"+other+"/procedure";
    const body = (expected_change_no:number,parent_id:string|null,kind:string,code:string,position:number,required=true) =>
      ({expected_change_no,parent_id,kind,code,name:code,position,required});
    const add = async (n:number,parent:string|null,kind:string,code:string,pos:number,required=true) => {
      const r = await verzoek("POST",base+"/elements",scoped,body(n,parent,kind,code,pos,required));
      assert.equal(r.status,201,JSON.stringify(r.body));
      assert.equal(r.body.change_no,n+1);
      return r.body.id as string;
    };
    assert.equal((await verzoek("GET",base)).status,401);
    for (const token of [op,system]) {
      assert.equal((await verzoek("GET",base,token)).status,403);
      assert.equal((await verzoek("POST",base+"/elements",token,body(0,null,"procedure","NO",1))).status,403);
    }
    assert.equal((await verzoek("GET",otherBase,scoped)).status,403);
    assert.equal((await verzoek("POST",otherBase+"/elements",scoped,body(0,null,"procedure","NO",1))).status,403);
    assert.equal((await verzoek("POST",base+"/elements",scoped,{...body(0,null,"procedure","NO",1),parent_kind:"procedure"})).status,400);
    const root = await add(0,null,"procedure","ROOT",1);
    const up = await add(1,root,"unit_procedure","UP",1);
    const operation = await add(2,up,"operation","OP",1);
    const first = await add(3,operation,"phase","P1",1);
    const second = await add(4,operation,"phase","P2",2,false);
    assert.equal((await verzoek("PATCH","/recipes/versions/"+version,scoped,{expected_change_no:0,name:"Oud",description:""})).status,409);
    const edge = await verzoek("POST",base+"/dependencies",scoped,{expected_change_no:5,predecessor_id:first,successor_id:second});
    assert.equal(edge.status,201,JSON.stringify(edge.body));
    assert.equal(edge.body.change_no,6);
    assert.equal((await verzoek("POST",base+"/dependencies",scoped,{expected_change_no:6,predecessor_id:second,successor_id:first})).status,422);
    assert.equal((await verzoek("DELETE",base+"/elements/"+first+"?expected_change_no=6",scoped)).status,422);
    assert.equal((await verzoek("PATCH",base+"/elements/"+second,scoped,body(5,operation,"phase","OLD",2))).status,409);
    const changed = await verzoek("PATCH",base+"/elements/"+second,scoped,body(6,operation,"phase","P2-EDIT",2,false));
    assert.equal(changed.status,200,JSON.stringify(changed.body));
    assert.equal(changed.body.id,second);
    assert.equal(changed.body.change_no,7);
    const delEdge = await verzoek("DELETE",base+"/dependencies/"+edge.body.id+"?expected_change_no=7",scoped);
    assert.equal(delEdge.status,200,JSON.stringify(delEdge.body));
    assert.equal(delEdge.body.change_no,8);
    const del = await verzoek("DELETE",base+"/elements/"+second+"?expected_change_no=8",scoped);
    assert.equal(del.status,200,JSON.stringify(del.body));
    assert.equal(del.body.change_no,9);
    const list = await verzoek("GET",base,scoped);
    assert.equal(list.status,200,JSON.stringify(list.body));
    assert.equal(list.body.change_no,9);
    assert.equal(list.body.elements.length,4);
    assert.deepEqual(list.body.dependencies,[]);
    const {rows:[audit]} = await beheerDb.query("SELECT l.actor_origin,g.gebruikersnaam,l.oud,l.nieuw FROM fabriek.config_log l JOIN fabriek.gebruiker g ON g.id=l.actor_user_id WHERE l.tabel='recipe_procedural_element' AND l.record_id=$1 AND l.actie='DELETE'",[second]);
    assert.equal(audit.actor_origin,"personal");
    assert.equal(audit.gebruikersnaam,naam);
    assert.equal(audit.oud.code,"P2-EDIT");
    assert.equal(audit.nieuw,null);
    await beheerDb.query("UPDATE fabriek.authorization_grant SET revoked_at=now() WHERE id=$1",[grant.id]);
    assert.equal((await verzoek("GET",base,scoped)).status,403);
    assert.equal((await verzoek("DELETE",base+"/elements/"+first+"?expected_change_no=9",scoped)).status,403);
  });
});

describe("#114 middelenbeheer en scopemapping API", () => {
  test("persoonlijke catalogus, scope, functiescheiding en intrekking", async () => {
    const prefix="mes.resources.";
    for (const [name,role,area] of [
      ["manager","resource_catalog_manager",null],
      ["scoped","resource_catalog_manager","API-AREA"],
      ["mapper","resource_scope_administrator",null],
    ] as const) {
      await beheerDb.query("INSERT INTO fabriek.gebruiker(gebruikersnaam,rol,wachtwoord_hash) VALUES ($1,'pending',fabriek.wachtwoord_hash('demo'))",[prefix+name]);
      await beheerDb.query("INSERT INTO fabriek.authorization_grant(user_id,role_code,area_code) SELECT id,$2,$3 FROM fabriek.gebruiker WHERE gebruikersnaam=$1",[prefix+name,role,area]);
    }
    const manager=await login(prefix+"manager"), scoped=await login(prefix+"scoped"), mapper=await login(prefix+"mapper");
    const operator=await login("mes.operator");
    const get=async(path:string,token:string,status=200)=>{
      const r=await verzoek("GET",path,token);assert.equal(r.status,status,JSON.stringify(r.body));return r.body;
    };
    const post=async(path:string,token:string,body:object,status=201)=>{
      const r=await verzoek("POST",path,token,body);assert.equal(r.status,status,JSON.stringify(r.body));return r.body.id as string;
    };
    assert.equal((await verzoek("GET","/resources/")).status,401);
    await get("/resources/",operator,403);
    await get("/resources/",mapper,403);
    await get("/resources/scopes",manager,403);
    await get("/resources/",scoped,403);
    assert.equal((await get("/auth/permissions",scoped)).resourceCatalog,false);
    const root=await post("/resources/hierarchy",manager,{code:"API-ENT",name:"Enterprise",level:"enterprise",parent_id:null});
    const site=await post("/resources/hierarchy",manager,{code:"API-SITE",name:"Site",level:"site",parent_id:root});
    const area=await post("/resources/hierarchy",manager,{code:"API-AREA",name:"Area",level:"area",parent_id:site});
    const other=await post("/resources/hierarchy",manager,{code:"API-OTHER",name:"Other area",level:"area",parent_id:site});
    const e=await post("/resources/equipment",manager,{code:"API-E1",name:"Middel",hierarchy_id:area});
    const e2=await post("/resources/equipment",manager,{code:"API-E2",name:"Ander middel",hierarchy_id:other});
    await post("/resources/scopes/areas",manager,{area_code:"API-AREA",hierarchy_id:area},403);
    await post("/resources/scopes/areas",mapper,{area_code:"API-AREA",hierarchy_id:area});
    const p=await get("/auth/permissions",scoped);
    assert.equal(p.resourceCatalog,true);
    assert.ok(!p.global.includes("resource.catalog.manage"));
    const c=await get("/resources/",scoped);
    assert.equal(c.global,false);
    assert.deepEqual(c.equipment.map((x:any)=>x.id),[e]);
    assert.deepEqual(c.hierarchy.map((x:any)=>x.id),[area]);
    const cls=await post("/resources/classes",manager,{code:"API-CLASS",name:"Klasse"});
    await post("/resources/classes",scoped,{code:"API-DENIED",name:"Geen"},403);
    await post("/resources/class-assignments",scoped,{equipment_id:e,equipment_class_id:cls});
    await post("/resources/class-assignments",scoped,{equipment_id:e2,equipment_class_id:cls},403);
    const asset=await post("/resources/assets",manager,{code:"API-ASSET",name:"Asset"});
    const assignment=await post("/resources/asset-assignments",manager,{equipment_id:e,physical_asset_id:asset,valid_from:"2026-01-01T00:00:00Z"});
    await post("/resources/asset-assignments",manager,{equipment_id:e2,physical_asset_id:asset,valid_from:"2026-01-02T00:00:00Z"},409);
    await post("/resources/asset-assignments/"+assignment+"/close",scoped,{valid_until:"2026-01-02T00:00:00Z"},200);
    await post("/resources/asset-assignments/"+assignment+"/close",scoped,{valid_until:"2026-01-03T00:00:00Z"},409);
    const rename={expected_change_no:0,name:"Nieuwe naam"};
    assert.equal((await verzoek("PATCH","/resources/equipment/"+e,scoped,rename)).status,200);
    assert.equal((await verzoek("PATCH","/resources/equipment/"+e,scoped,rename)).status,409);
    assert.equal((await verzoek("PATCH","/resources/equipment/"+e2,scoped,rename)).status,403);
    await post("/resources/classes",manager,{code:"API-UNKNOWN",name:"Geen",actor_id:randomUUID()},400);
    const security=await get("/resources/scopes",mapper);
    assert.deepEqual(Object.keys(security).sort(),["area_scopes","areas","equipment","equipment_scopes"]);
    await beheerDb.query("UPDATE fabriek.authorization_grant SET revoked_at=now() WHERE user_id=(SELECT id FROM fabriek.gebruiker WHERE gebruikersnaam=$1)",[prefix+"scoped"]);
    assert.equal((await get("/auth/permissions",scoped)).resourceCatalog,false);
    await get("/resources/",scoped,403);
  });
});

describe("#141 eenhedencatalogus en materiaal-eenheidsAPI", () => {
  test("exacte conversierevisies, persoonlijke scope en onveranderlijke materiaalversies", async () => {
    const engineer=await login("mes.engineer");
    const operator=await login("mes.operator");
    const {rows:products}=await beheerDb.query("SELECT id,code FROM fabriek.product WHERE code IN ('PRD-A','PRD-B')");
    const pa=products.find(p=>p.code==="PRD-A").id;
    const pb=products.find(p=>p.code==="PRD-B").id;
    const naam="mes.units.scoped";
    await beheerDb.query("INSERT INTO fabriek.gebruiker(gebruikersnaam,rol,wachtwoord_hash) VALUES ($1,'analist',fabriek.wachtwoord_hash('demo'))",[naam]);
    const {rows:[grant]}=await beheerDb.query("INSERT INTO fabriek.authorization_grant(user_id,role_code,product_id) SELECT id,'process_engineer',$2 FROM fabriek.gebruiker WHERE gebruikersnaam=$1 RETURNING id",[naam,pa]);
    const scoped=await login(naam);
    const dim={length_exp:0,mass_exp:1,time_exp:0,current_exp:0,temperature_exp:0,amount_exp:0,luminous_exp:0};
    assert.equal((await verzoek("GET","/units/")).status,401);
    assert.equal((await verzoek("GET","/units/",operator)).status,403);
    assert.equal((await verzoek("POST","/units/dimensions",scoped,dim)).status,403);
    const post=async (path:string,body:object) => {
      const res=await verzoek("POST",path,engineer,body);
      assert.equal(res.status,201,JSON.stringify(res.body));
      return res.body.id as string;
    };
    const d=await post("/units/dimensions",dim);
    const k=await post("/units/quantity-kinds",{dimension_id:d,code:"API-MASS",name:"Massa",value_semantics:"ratio"});
    const kg=await post("/units/units",{quantity_kind_id:k,code:"API-KG",symbol:"kg",name:"Kilogram"});
    const g=await post("/units/units",{quantity_kind_id:k,code:"API-G",symbol:"g",name:"Gram"});
    const factors={factor_numerator:"1000",factor_denominator:"1",additive_offset:"0",source_reference:"Fictieve bron"};
    const c=await post("/units/conversions",{from_unit_id:kg,to_unit_id:g,...factors});
    const revision="/units/conversions/"+c+"/versions";
    const precise="9007199254740993";
    await post(revision,{expected_revision:1,...factors,factor_numerator:precise});
    assert.equal((await verzoek("POST",revision,engineer,{expected_revision:1,...factors})).status,409);
    assert.equal((await verzoek("POST",revision,engineer,{expected_revision:2,...factors,factor_denominator:"0"})).status,422);
    assert.equal((await verzoek("GET","/units/",scoped)).status,403);
    assert.equal((await verzoek("GET","/units/for-product/"+pb,scoped)).status,403);
    const data=await verzoek("GET","/units/for-product/"+pa,scoped);
    assert.equal(data.status,200,JSON.stringify(data.body));
    assert.deepEqual(data.body.versions.filter((v:any)=>v.conversion_id===c).map((v:any)=>v.factor_numerator),["1000",precise]);
    const mat=await post("/materials/definitions/with-unit",{code:"API-MAT-UNIT",name:"Fictief",material_class_id:null,measurement_unit_id:kg,product_id:null,raw_material_id:null});
    await post("/materials/definitions/"+mat+"/versions/with-unit",{expected_revision:1,name:"Fictief 2",material_class_id:null,measurement_unit_id:g});
    assert.equal((await verzoek("POST","/materials/definitions/"+mat+"/versions",engineer,{expected_revision:2,name:"Fictief 3",material_class_id:null,unit:"kg"})).status,422);
    const mats=await verzoek("GET","/materials/",engineer);
    assert.equal(mats.status,200,JSON.stringify(mats.body));
    assert.deepEqual(mats.body.versions.filter((v:any)=>v.material_definition_id===mat).map((v:any)=>[v.revision,v.unit,v.measurement_unit_id]),[[1,"kg",kg],[2,"g",g]]);
    await beheerDb.query("UPDATE fabriek.authorization_grant SET revoked_at=now() WHERE id=$1",[grant.id]);
    assert.equal((await verzoek("GET","/units/for-product/"+pa,scoped)).status,403);
  });
});

describe("#111 receptinhoud-API", () => {
  test("persoonlijke productscope, exacte hoeveelheden, gezamenlijke teller en gecontroleerde mutaties", async () => {
    const engineer=await login("mes.engineer");
    const operator=await login("mes.operator");
    const {rows:products}=await beheerDb.query("SELECT id,code FROM fabriek.product WHERE code IN ('PRD-A','PRD-B')");
    const pa=products.find(p=>p.code==="PRD-A").id;
    const pb=products.find(p=>p.code==="PRD-B").id;
    const naam="mes.content.scoped";
    await beheerDb.query("INSERT INTO fabriek.gebruiker(gebruikersnaam,rol,wachtwoord_hash) VALUES ($1,'analist',fabriek.wachtwoord_hash('demo'))",[naam]);
    const {rows:[grant]}=await beheerDb.query("INSERT INTO fabriek.authorization_grant(user_id,role_code,product_id) SELECT id,'process_engineer',$2 FROM fabriek.gebruiker WHERE gebruikersnaam=$1 RETURNING id",[naam,pa]);
    const scoped=await login(naam);
    const make=async (product_id:string,code:string) => {
      const r=await verzoek("POST","/recipes/",engineer,{product_id,code,name:code,description:""});
      assert.equal(r.status,201,JSON.stringify(r.body));
      const list=await verzoek("GET","/recipes/?product_id="+product_id,engineer);
      assert.equal(list.status,200,JSON.stringify(list.body));
      return list.body.find((x:any)=>x.id===r.body.id).versions[0].id as string;
    };
    const v=await make(pa,"API-CONTENT-A");
    const other=await make(pb,"API-CONTENT-B");
    const base="/recipes/versions/"+v+"/content";
    const otherBase="/recipes/versions/"+other+"/content";
    const root=await verzoek("POST","/recipes/versions/"+v+"/procedure/elements",scoped,{expected_change_no:0,parent_id:null,kind:"procedure",code:"ROOT",name:"Root",position:1,required:true});
    assert.equal(root.status,201,JSON.stringify(root.body));
    const {rows:[mv]}=await beheerDb.query("WITH m AS (INSERT INTO fabriek.material_definition(code) VALUES ('API-CONTENT-MAT') RETURNING id) INSERT INTO fabriek.material_definition_version(material_definition_id,revision,name,unit,created_by) SELECT m.id,1,'Fictief','kg',g.id FROM m CROSS JOIN fabriek.gebruiker g WHERE g.gebruikersnaam='mes.engineer' RETURNING id");
    const parameter={expected_change_no:1,procedural_element_id:root.body.id,code:"TEMP",name:"Temperatuur",data_type:"decimal",unit:"degC",frequency:"per batch",required:true,responsible_activity:"productie",critical:true,measurement_unit_id:null};
    assert.equal((await verzoek("GET",base)).status,401);
    assert.equal((await verzoek("GET",base,operator)).status,403);
    assert.equal((await verzoek("GET",otherBase,scoped)).status,403);
    assert.equal((await verzoek("POST",otherBase+"/parameters",scoped,parameter)).status,403);
    assert.equal((await verzoek("POST",base+"/parameters",scoped,{...parameter,created_by:randomUUID()})).status,400);
    const add=async (path:string,body:object) => {
      const res=await verzoek("POST",base+"/"+path,scoped,body);
      assert.equal(res.status,201,JSON.stringify(res.body));
      return res.body;
    };
    const p=await add("parameters",parameter);
    const precise="9007199254740993.125";
    const limit={expected_change_no:2,parameter_id:p.id,data_type:"decimal",category:"target",target_value:precise,lower_value:null,upper_value:null,scaling:"fixed"};
    const l=await add("parameter-limits",limit);
    const f=await add("formulas",{expected_change_no:3,reference_quantity:"1000.125",reference_unit:"kg",reference_unit_id:null});
    const m=await add("material-requirements",{expected_change_no:4,formula_id:f.id,procedural_element_id:root.body.id,material_version_id:mv.id,code:"INPUT",direction:"input",quantity:"600.125",unit:"kg",scaling:"linear",measurement_unit_id:null});
    const data=await verzoek("GET",base,scoped);
    assert.equal(data.status,200,JSON.stringify(data.body));
    assert.equal(data.body.change_no,5);
    assert.equal(data.body.parameter_limits[0].target_value,precise);
    assert.equal(data.body.formulas[0].reference_quantity,"1000.125");
    assert.equal(data.body.material_requirements[0].quantity,"600.125");
    assert.equal((await verzoek("PATCH",base+"/parameter-limits/"+l.id,scoped,limit)).status,409);
    assert.equal((await verzoek("POST",base+"/parameter-limits",scoped,{...limit,expected_change_no:5,category:"process_limit",target_value:null,lower_value:"10",upper_value:"1"})).status,422);
    assert.equal((await verzoek("DELETE",base+"/parameters/"+p.id+"?expected_change_no=5",scoped)).status,422);
    const updated=await verzoek("PATCH",base+"/parameter-limits/"+l.id,scoped,{...limit,expected_change_no:5,target_value:"91.125"});
    assert.equal(updated.status,200,JSON.stringify(updated.body));
    assert.equal(updated.body.id,l.id);
    assert.equal(updated.body.change_no,6);
    let n=6;
    for(const [path,id] of [["material-requirements",m.id],["formulas",f.id],["parameter-limits",l.id],["parameters",p.id]]) {
      const deleted=await verzoek("DELETE",base+"/"+path+"/"+id+"?expected_change_no="+n,scoped);
      assert.equal(deleted.status,200,JSON.stringify(deleted.body));
      assert.equal(deleted.body.change_no,++n);
    }
    const final=await verzoek("GET",base,scoped);
    assert.equal(final.status,200,JSON.stringify(final.body));
    assert.equal(final.body.change_no,10);
    for(const key of ["parameters","parameter_limits","formulas","material_requirements"]) assert.deepEqual(final.body[key],[]);
    await beheerDb.query("UPDATE fabriek.authorization_grant SET revoked_at=now() WHERE id=$1",[grant.id]);
    assert.equal((await verzoek("GET",base,scoped)).status,403);
  });
});

describe("#111 receptvereisten-API", () => {
  test("persoonlijke productscope, zes vereisten, lotnorm, vertrouwde kwalificatie en exacte capaciteit", async () => {
    const engineer=await login("mes.engineer");
    const operator=await login("mes.operator");
    const {rows:products}=await beheerDb.query("SELECT id,code FROM fabriek.product WHERE code IN ('PRD-A','PRD-B')");
    const pa=products.find(p=>p.code==="PRD-A").id;
    const pb=products.find(p=>p.code==="PRD-B").id;
    const naam="mes.requirements.scoped";
    await beheerDb.query("INSERT INTO fabriek.gebruiker(gebruikersnaam,rol,wachtwoord_hash) VALUES ($1,'analist',fabriek.wachtwoord_hash('demo'))",[naam]);
    const {rows:[grant]}=await beheerDb.query("INSERT INTO fabriek.authorization_grant(user_id,role_code,product_id) SELECT id,'process_engineer',$2 FROM fabriek.gebruiker WHERE gebruikersnaam=$1 RETURNING id",[naam,pa]);
    const scoped=await login(naam);
    const make=async (product_id:string,code:string) => {
      const r=await verzoek("POST","/recipes/",engineer,{product_id,code,name:code,description:""});
      assert.equal(r.status,201,JSON.stringify(r.body));
      const list=await verzoek("GET","/recipes/?product_id="+product_id,engineer);
      assert.equal(list.status,200,JSON.stringify(list.body));
      return list.body.find((x:any)=>x.id===r.body.id).versions[0].id as string;
    };
    const v=await make(pa,"API-REQ-A");
    const compatible=await make(pa,"API-REQ-C");
    const other=await make(pb,"API-REQ-B");
    const prefix="/recipes/versions/"+v;
    const base=prefix+"/requirements";
    const root=await verzoek("POST",prefix+"/procedure/elements",scoped,{expected_change_no:0,parent_id:null,kind:"procedure",code:"ROOT",name:"Root",position:1,required:true});
    assert.equal(root.status,201,JSON.stringify(root.body));
    const parameter=await verzoek("POST",prefix+"/content/parameters",scoped,{expected_change_no:1,procedural_element_id:root.body.id,code:"Q",name:"Quality",data_type:"decimal",unit:"kg",frequency:"per batch",required:true,responsible_activity:"kwaliteit",critical:true,measurement_unit_id:null});
    assert.equal(parameter.status,201,JSON.stringify(parameter.body));
    const limit=await verzoek("POST",prefix+"/content/parameter-limits",scoped,{expected_change_no:2,parameter_id:parameter.body.id,data_type:"decimal",category:"specification_limit",target_value:null,lower_value:"1",upper_value:"2",scaling:"fixed"});
    assert.equal(limit.status,201,JSON.stringify(limit.body));
    await beheerDb.query("INSERT INTO fabriek.qualification(code,description) VALUES ('api_req_training','Fictieve training')");
    await beheerDb.query("INSERT INTO fabriek.quantity_dimension(length_exp,mass_exp,time_exp,current_exp,temperature_exp,amount_exp,luminous_exp) VALUES (0,1,0,0,0,0,0) ON CONFLICT DO NOTHING");
    const {rows:[dim]}=await beheerDb.query("SELECT id FROM fabriek.quantity_dimension WHERE length_exp=0 AND mass_exp=1 AND time_exp=0 AND current_exp=0 AND temperature_exp=0 AND amount_exp=0 AND luminous_exp=0");
    const {rows:[kind]}=await beheerDb.query("INSERT INTO fabriek.quantity_kind(dimension_id,code,name,value_semantics) VALUES ($1,'API-REQ-MASS','Massa','ratio') RETURNING id",[dim.id]);
    const {rows:[unit]}=await beheerDb.query("INSERT INTO fabriek.measurement_unit(quantity_kind_id,code,symbol,name) VALUES ($1,'API-REQ-KG','kg','Kilogram') RETURNING id",[kind.id]);
    assert.equal((await verzoek("GET",base)).status,401);
    assert.equal((await verzoek("GET",base,operator)).status,403);
    assert.equal((await verzoek("GET","/recipes/versions/"+other+"/requirements",scoped)).status,403);
    assert.equal((await verzoek("POST","/recipes/versions/"+other+"/requirements/lot-rules",scoped,{expected_change_no:0,nominal_batch_count:6,deviation_approval_required:true})).status,403);
    const add=async (path:string,body:object) => {
      const res=await verzoek("POST",base+"/"+path,scoped,body);
      assert.equal(res.status,201,JSON.stringify(res.body));
      return res.body;
    };
    const precise="9007199254740993.125";
    const eq=await add("equipment-requirements",{expected_change_no:3,procedural_element_id:root.body.id,code:"EQ",equipment_class_code:"MIXER",description:"Fictief",required_count:1,minimum_capacity:precise,capacity_unit_id:unit.id});
    const perBody={expected_change_no:4,procedural_element_id:root.body.id,code:"PERSON",qualification_code:"api_req_training",required_count:2};
    assert.equal((await verzoek("POST",base+"/personnel-requirements",scoped,{...perBody,qualification_description:"vervalst"})).status,400);
    const per=await add("personnel-requirements",perBody);
    const ins=await add("instructions",{expected_change_no:5,procedural_element_id:root.body.id,code:"I",position:1,instruction_text:"Fictief",confirmation_required:true});
    const spec=await add("specification-links",{expected_change_no:6,parameter_limit_id:limit.body.id,code:"S",description:"Fictieve eis"});
    const lotBody={expected_change_no:7,nominal_batch_count:6,deviation_approval_required:true};
    assert.equal((await verzoek("POST",base+"/lot-rules",scoped,{...lotBody,deviation_reason_required:false})).status,400);
    const lot=await add("lot-rules",lotBody);
    assert.equal((await verzoek("POST",base+"/compatibility-rules",scoped,{expected_change_no:8,other_recipe_version_id:other,reason:"Fictief"})).status,422);
    const comp=await add("compatibility-rules",{expected_change_no:8,other_recipe_version_id:compatible,reason:"Fictieve incompatibiliteit"});
    const data=await verzoek("GET",base,scoped);
    assert.equal(data.status,200,JSON.stringify(data.body));
    assert.equal(data.body.change_no,9);
    for(const key of ["equipment_requirements","personnel_requirements","instructions","specification_links","lot_rules","compatibility_rules"]) assert.equal(data.body[key].length,1);
    assert.equal(data.body.equipment_requirements[0].minimum_capacity,precise);
    assert.equal(data.body.personnel_requirements[0].qualification_description,"Fictieve training");
    assert.equal(data.body.lot_rules[0].deviation_reason_required,true);
    assert.equal((await verzoek("PATCH",base+"/lot-rules/"+lot.id,scoped,lotBody)).status,409);
    assert.equal((await verzoek("PATCH",base+"/lot-rules/"+lot.id,scoped,{...lotBody,expected_change_no:9,nominal_batch_count:51})).status,400);
    const changed=await verzoek("PATCH",base+"/lot-rules/"+lot.id,scoped,{...lotBody,expected_change_no:9,nominal_batch_count:8});
    assert.equal(changed.status,200,JSON.stringify(changed.body));
    assert.equal(changed.body.id,lot.id);
    assert.equal(changed.body.change_no,10);
    let n=10;
    for(const [path,id] of [["compatibility-rules",comp.id],["lot-rules",lot.id],["specification-links",spec.id],["instructions",ins.id],["personnel-requirements",per.id],["equipment-requirements",eq.id]]) {
      const deleted=await verzoek("DELETE",base+"/"+path+"/"+id+"?expected_change_no="+n,scoped);
      assert.equal(deleted.status,200,JSON.stringify(deleted.body));
      assert.equal(deleted.body.change_no,++n);
    }
    const final=await verzoek("GET",base,scoped);
    assert.equal(final.status,200,JSON.stringify(final.body));
    assert.equal(final.body.change_no,16);
    for(const key of ["equipment_requirements","personnel_requirements","instructions","specification_links","lot_rules","compatibility_rules"]) assert.deepEqual(final.body[key],[]);
    await beheerDb.query("UPDATE fabriek.authorization_grant SET revoked_at=now() WHERE id=$1",[grant.id]);
    assert.equal((await verzoek("GET",base,scoped)).status,403);
  });
});

describe("#141 schaalregel-API", () => {
  test("persoonlijke productscope, exacte constante, formulevalidatie en gedeelde teller", async () => {
    const engineer=await login("mes.engineer");
    const operator=await login("mes.operator");
    const {rows:products}=await beheerDb.query("SELECT id,code FROM fabriek.product WHERE code IN ('PRD-A','PRD-B')");
    const pa=products.find(p=>p.code==="PRD-A").id;
    const pb=products.find(p=>p.code==="PRD-B").id;
    const naam="mes.scaling.scoped";
    await beheerDb.query("INSERT INTO fabriek.gebruiker(gebruikersnaam,rol,wachtwoord_hash) VALUES ($1,'analist',fabriek.wachtwoord_hash('demo'))",[naam]);
    const {rows:[grant]}=await beheerDb.query("INSERT INTO fabriek.authorization_grant(user_id,role_code,product_id) SELECT id,'process_engineer',$2 FROM fabriek.gebruiker WHERE gebruikersnaam=$1 RETURNING id",[naam,pa]);
    const scoped=await login(naam);
    const make=async (product_id:string,code:string) => {
      const r=await verzoek("POST","/recipes/",engineer,{product_id,code,name:code,description:""});
      assert.equal(r.status,201,JSON.stringify(r.body));
      const list=await verzoek("GET","/recipes/?product_id="+product_id,engineer);
      assert.equal(list.status,200,JSON.stringify(list.body));
      return list.body.find((x:any)=>x.id===r.body.id).versions[0].id as string;
    };
    const v=await make(pa,"API-SCALE-A");
    const other=await make(pb,"API-SCALE-B");
    const prefix="/recipes/versions/"+v;
    const base=prefix+"/scaling";
    await beheerDb.query("INSERT INTO fabriek.quantity_dimension(length_exp,mass_exp,time_exp,current_exp,temperature_exp,amount_exp,luminous_exp) VALUES (0,1,0,0,0,0,0) ON CONFLICT DO NOTHING");
    const {rows:[dim]}=await beheerDb.query("SELECT id FROM fabriek.quantity_dimension WHERE (length_exp,mass_exp,time_exp,current_exp,temperature_exp,amount_exp,luminous_exp)=(0,1,0,0,0,0,0)");
    const {rows:[kind]}=await beheerDb.query("INSERT INTO fabriek.quantity_kind(dimension_id,code,name,value_semantics) VALUES ($1,'API-SCALE-MASS','Massa','ratio') RETURNING id",[dim.id]);
    const {rows:[kg]}=await beheerDb.query("INSERT INTO fabriek.measurement_unit(quantity_kind_id,code,symbol,name) VALUES ($1,'API-SCALE-KG','kg','Kilogram') RETURNING id",[kind.id]);
    const {rows:[g]}=await beheerDb.query("INSERT INTO fabriek.measurement_unit(quantity_kind_id,code,symbol,name) VALUES ($1,'API-SCALE-G','g','Gram') RETURNING id",[kind.id]);
    const root=await verzoek("POST",prefix+"/procedure/elements",scoped,{expected_change_no:0,parent_id:null,kind:"procedure",code:"ROOT",name:"Root",position:1,required:true});
    assert.equal(root.status,201,JSON.stringify(root.body));
    const parameter=await verzoek("POST",prefix+"/content/parameters",scoped,{expected_change_no:1,procedural_element_id:root.body.id,code:"Q",name:"Massa",data_type:"decimal",unit:"kg",frequency:"per batch",required:true,responsible_activity:"productie",critical:true,measurement_unit_id:kg.id});
    assert.equal(parameter.status,201,JSON.stringify(parameter.body));
    const limit=await verzoek("POST",prefix+"/content/parameter-limits",scoped,{expected_change_no:2,parameter_id:parameter.body.id,data_type:"decimal",category:"target",target_value:"2",lower_value:null,upper_value:null,scaling:"fixed"});
    assert.equal(limit.status,201,JSON.stringify(limit.body));
    assert.equal((await verzoek("GET",base)).status,401);
    assert.equal((await verzoek("GET",base,operator)).status,403);
    assert.equal((await verzoek("GET","/recipes/versions/"+other+"/scaling",scoped)).status,403);
    const ruleBody={expected_change_no:3,code:"R",description:"Fictief",rule_kind:"nonlinear",output_unit_id:kg.id,source_reference:"Bron",applicability:"Test"};
    assert.equal((await verzoek("POST","/recipes/versions/"+other+"/scaling/rules",scoped,{...ruleBody,expected_change_no:0})).status,403);
    const add=async (path:string,body:object) => {
      const res=await verzoek("POST",base+"/"+path,scoped,body);
      assert.equal(res.status,201,JSON.stringify(res.body));
      return res.body;
    };
    const r=await add("rules",ruleBody);
    const precise="9007199254740993.125";
    const inputBody={expected_change_no:4,rule_id:r.id,code:"A",source_kind:"constant",parameter_id:null,equipment_property:null,constant_value:precise,unit_id:kg.id,conversion_version_id:null};
    const a=await add("inputs",inputBody);
    const b=await add("inputs",{...inputBody,expected_change_no:5,code:"B",unit_id:g.id});
    const binding=await add("bindings",{expected_change_no:6,rule_id:r.id,parameter_limit_id:limit.body.id,material_requirement_id:null});
    const expr=base+"/rules/"+r.id+"/expression";
    const token={op:"input",id:a.id};
    assert.equal((await verzoek("PUT",expr,scoped,{expected_change_no:7,tokens:[{op:"eval",script:"1+1"}]})).status,400);
    assert.equal((await verzoek("PUT",expr,scoped,{expected_change_no:7,tokens:[token,{op:"add"}]})).status,422);
    assert.equal((await verzoek("PUT",expr,scoped,{expected_change_no:7,tokens:[token,{op:"input",id:b.id},{op:"add"}]})).status,422);
    assert.equal((await verzoek("POST",base+"/inputs",scoped,{...inputBody,expected_change_no:7,code:"CYCLE",source_kind:"parameter",parameter_id:parameter.body.id,constant_value:null})).status,422);
    const saved=await verzoek("PUT",expr,scoped,{expected_change_no:7,tokens:[token,token,{op:"add"}]});
    assert.equal(saved.status,200,JSON.stringify(saved.body));
    assert.equal(saved.body.change_no,8);
    const data=await verzoek("GET",base,scoped);
    assert.equal(data.status,200,JSON.stringify(data.body));
    assert.equal(data.body.change_no,8);
    assert.equal(data.body.inputs.find((x:any)=>x.id===a.id).constant_value,precise);
    assert.equal(data.body.bindings[0].id,binding.id);
    assert.equal(data.body.expressions[0].grammar_version,1);
    assert.deepEqual(data.body.expressions[0].tokens,[token,token,{op:"add"}]);
    assert.equal((await verzoek("PUT",expr,scoped,{expected_change_no:7,tokens:[token]})).status,409);
    assert.equal((await verzoek("DELETE",base+"/inputs/"+a.id+"?expected_change_no=8",scoped)).status,422);
    const updated=await verzoek("PUT",expr,scoped,{expected_change_no:8,tokens:[token]});
    assert.equal(updated.status,200,JSON.stringify(updated.body));
    assert.equal(updated.body.id,saved.body.id);
    assert.equal(updated.body.change_no,9);
    const deletedExpr=await verzoek("DELETE",expr+"?expected_change_no=9",scoped);
    assert.equal(deletedExpr.status,200,JSON.stringify(deletedExpr.body));
    assert.equal(deletedExpr.body.change_no,10);
    let n=10;
    for(const [path,id] of [["bindings",binding.id],["inputs",a.id],["inputs",b.id],["rules",r.id]]) {
      const deleted=await verzoek("DELETE",base+"/"+path+"/"+id+"?expected_change_no="+n,scoped);
      assert.equal(deleted.status,200,JSON.stringify(deleted.body));
      assert.equal(deleted.body.change_no,++n);
    }
    const final=await verzoek("GET",base,scoped);
    assert.equal(final.status,200,JSON.stringify(final.body));
    assert.equal(final.body.change_no,14);
    for(const key of ["rules","inputs","bindings","expressions"]) assert.deepEqual(final.body[key],[]);
    await beheerDb.query("UPDATE fabriek.authorization_grant SET revoked_at=now() WHERE id=$1",[grant.id]);
    assert.equal((await verzoek("GET",base,scoped)).status,403);
  });
});

describe("#112 MOC- en beoordelings-API", () => {
  test("persoonlijke scope, MOC, exacte vergelijking en bevestigde beoordelingsronde", async () => {
    const engineer=await login("mes.engineer");
    const operator=await login("mes.operator");
    const approver=await login("mes.eng.approver");
    const {rows:[p]}=await beheerDb.query("SELECT id FROM fabriek.product WHERE code='PRD-A'");
    const made=await verzoek("POST","/recipes/",engineer,{product_id:p.id,code:"API-MOC-REVIEW",name:"Fictief",description:""});
    assert.equal(made.status,201,JSON.stringify(made.body));
    const list=await verzoek("GET","/recipes/?product_id="+p.id,engineer);
    assert.equal(list.status,200,JSON.stringify(list.body));
    const v=list.body.find((x:any)=>x.id===made.body.id).versions[0].id;
    const base="/recipes/versions/"+v;
    assert.equal((await verzoek("GET",base+"/moc")).status,401);
    assert.equal((await verzoek("GET",base+"/moc",operator)).status,403);
    assert.equal((await verzoek("GET",base+"/moc",approver)).status,403);
    const validation=await verzoek("GET",base+"/release-validation",engineer);
    assert.equal(validation.status,200,JSON.stringify(validation.body));
    assert.equal(validation.body.content_valid,false);
    assert.ok(validation.body.blockers.some((x:any)=>x.code==="missing_moc"));
    assert.equal((await verzoek("GET",base+"/release-validation",approver)).status,403);
    assert.equal((await verzoek("GET",base+"/release-validation",operator)).status,403);
    assert.equal((await verzoek("GET",base+"/release-validation")).status,401);
    const moc=await verzoek("POST",base+"/moc",engineer,{expected_change_no:0,baseline_version_id:null,reason:"Initiële invoer",impact_description:"Fictief"});
    assert.equal(moc.status,201,JSON.stringify(moc.body));
    const impact=await verzoek("POST",base+"/moc/impacts",engineer,{expected_change_no:1,request_id:moc.body.id,area:"header",explanation:"Fictief"});
    assert.equal(impact.status,201,JSON.stringify(impact.body));
    assert.equal((await verzoek("PATCH",base+"/moc/"+moc.body.id,engineer,{expected_change_no:1,reason:"Verouderd",impact_description:"Fictief"})).status,409);
    const diff=await verzoek("GET",base+"/moc/comparison",engineer);
    assert.equal(diff.status,200,JSON.stringify(diff.body));
    assert.equal(JSON.parse(diff.body.comparison_text).change_no,2);
    const plan=await verzoek("GET",base+"/review-requirements",engineer);
    assert.equal(plan.status,200,JSON.stringify(plan.body));
    assert.deepEqual(plan.body.required_reviews,["engineering","production","quality"]);
    const {rows:[before]}=await beheerDb.query("SELECT count(*)::int AS n FROM fabriek.inlogpoging WHERE gebruikersnaam='mes.engineer' AND uitkomst='mislukt'");
    assert.equal((await verzoek("POST",base+"/reviews",engineer,{expected_change_no:2,expected_baseline_change_no:null,password:"onjuist"})).status,403);
    const {rows:[after]}=await beheerDb.query("SELECT count(*)::int AS n FROM fabriek.inlogpoging WHERE gebruikersnaam='mes.engineer' AND uitkomst='mislukt'");
    assert.equal(after.n,before.n+1);
    // Een werkelijke referentieteller 0 is niet hetzelfde als geen referentie.
    assert.equal((await verzoek("POST",base+"/reviews",engineer,{expected_change_no:2,expected_baseline_change_no:0,password:"demo"})).status,409);
    assert.equal((await verzoek("POST",base+"/reviews",engineer,{expected_change_no:2,expected_baseline_change_no:false,password:"demo"})).status,400);
    const submitted=await verzoek("POST",base+"/reviews",engineer,{expected_change_no:2,expected_baseline_change_no:null,password:"demo"});
    assert.equal(submitted.status,201,JSON.stringify(submitted.body));
    const round=submitted.body.round_id;
    assert.equal((await verzoek("GET","/recipes/reviews/"+round,operator)).status,403);
    const inbox=await verzoek("GET","/recipes/reviews?product_id="+p.id,approver);
    assert.equal(inbox.status,200,JSON.stringify(inbox.body));
    assert.deepEqual(inbox.body.find((x:any)=>x.round_id===round).my_pending_domains,["engineering"]);
    const dossier=await verzoek("GET","/recipes/reviews/"+round,approver);
    assert.equal(dossier.status,200,JSON.stringify(dossier.body));
    assert.equal(JSON.parse(dossier.body.round.snapshot_text).current.recipe_change_request[0].id,moc.body.id);
    const body={expected_change_no:2,domain:"engineering",decision:"approve",reason:"Fictief",password:"demo"};
    assert.equal((await verzoek("POST","/recipes/reviews/"+round+"/decisions",engineer,body)).status,403);
    assert.equal((await verzoek("POST","/recipes/reviews/"+round+"/decisions",approver,{...body,password:"onjuist"})).status,403);
    const decision=await verzoek("POST","/recipes/reviews/"+round+"/decisions",approver,body);
    assert.equal(decision.status,201,JSON.stringify(decision.body));
    assert.equal(decision.body.lifecycle_status,"in_review");
    const blocked=await verzoek("GET",base+"/release-validation",approver);
    assert.equal(blocked.status,200,JSON.stringify(blocked.body));
    assert.equal(blocked.body.content_valid,false);
    assert.ok(blocked.body.blockers.some((x:any)=>x.code==="missing_formula"));
    const releaseBody={round_id:round,expected_change_no:2,effective_from:null,reason:"Fictief",password:"demo"};
    assert.equal((await verzoek("POST",base+"/releases",engineer,releaseBody)).status,403);
    assert.equal((await verzoek("POST",base+"/releases",approver,releaseBody)).status,409);
    assert.equal((await verzoek("POST",base+"/releases",approver,{...releaseBody,effective_from:"ongeldig"})).status,400);
    assert.equal((await verzoek("POST","/recipes/releases/"+round+"/withdrawals",approver,{reason:"Fictief",password:"demo"})).status,422);
    assert.equal((await verzoek("POST","/recipes/reviews/"+round+"/decisions",approver,body)).status,409);
    assert.equal((await verzoek("PATCH",base+"/moc/"+moc.body.id,engineer,{expected_change_no:2,reason:"Bevroren",impact_description:"Fictief"})).status,409);
    // Reject the first round and resubmit unchanged: equal counters alone must not make old rounds actionable.
    const qa=await login("mes.quality.approver");
    const reject=await verzoek("POST","/recipes/reviews/"+round+"/decisions",qa,{...body,domain:"quality",decision:"reject"});
    assert.equal(reject.status,201,JSON.stringify(reject.body));
    assert.equal(reject.body.lifecycle_status,"draft");
    const second=await verzoek("POST",base+"/reviews",engineer,{expected_change_no:2,expected_baseline_change_no:null,password:"demo"});
    assert.equal(second.status,201,JSON.stringify(second.body));
    const secondRound=second.body.round_id;
    const history=await verzoek("GET","/recipes/reviews?product_id="+p.id,approver);
    assert.equal(history.status,200,JSON.stringify(history.body));
    const rounds=history.body.filter((x:any)=>x.recipe_version_id===v);
    assert.deepEqual(rounds.map((x:any)=>x.round_id),[secondRound,round]);
    assert.deepEqual(rounds[0].my_pending_domains,["engineering"]);
    assert.deepEqual(rounds[1].my_pending_domains,[]);
    const historical=await verzoek("GET","/recipes/reviews/"+round,approver);
    assert.equal(historical.status,200);
    assert.equal(historical.body.is_current,false);
    assert.equal(historical.body.round.snapshot_text,dossier.body.round.snapshot_text);
    assert.equal(historical.body.decisions.length,2);
    assert.equal((await verzoek("POST","/recipes/reviews/"+round+"/decisions",approver,body)).status,409);
    assert.equal((await verzoek("POST",base+"/releases",approver,releaseBody)).status,409);
    assert.equal((await verzoek("GET","/recipes/reviews/"+round,operator)).status,403);
    assert.equal((await verzoek("GET","/recipes/reviews?product_id="+p.id,operator)).status,403);
  });
});

describe("#112 formele vrijgave en effectieve geldigheid (D109)", () => {
  test("persoonlijke vrijgave, toekomstige vervanging, intrekking en historisch bewijs", async () => {
    const engineer=await login("mes.engineer");
    const approver=await login("mes.eng.approver");
    const qa=await login("mes.quality.approver");
    const production=await login("mes.manager");
    const {rows:[p]}=await beheerDb.query("SELECT id FROM fabriek.product WHERE code='PRD-A'");
    // Gebruik de expliciete cataloguseenheid uit de eerdere catalogusfixture.
    const {rows:[unit]}=await beheerDb.query("SELECT id,symbol FROM fabriek.measurement_unit WHERE code='API-KG'");
    assert.ok(unit,"Expliciete fictieve cataloguseenheid vereist");
    const post=async (path:string,token:string,body:object) => {
      const res=await verzoek("POST",path,token,body);
      assert.equal(res.status,201,path+": "+JSON.stringify(res.body));
      return res.body;
    };
    const recipe=await post("/recipes/",engineer,{product_id:p.id,code:"API-RELEASE",name:"Fictief",description:""});
    const list=await verzoek("GET","/recipes/?product_id="+p.id,engineer);
    assert.equal(list.status,200);
    const first=list.body.find((x:any)=>x.id===recipe.id).versions[0].id as string;
    async function prepare(v:string,baseline:string|null,baselineCounter:number|null) {
      const base="/recipes/versions/"+v;
      let n=0;
      let parent:string|null=null;
      for(const kind of ["procedure","unit_procedure","operation","phase"]) {
        const el=await post(base+"/procedure/elements",engineer,{expected_change_no:n++,parent_id:parent,kind,code:kind.toUpperCase(),name:kind,position:1,required:true});
        parent=el.id;
      }
      await post(base+"/content/formulas",engineer,{expected_change_no:n++,reference_quantity:"1000.125",reference_unit:unit.symbol,reference_unit_id:unit.id});
      await post(base+"/requirements/lot-rules",engineer,{expected_change_no:n++,nominal_batch_count:6,deviation_approval_required:true});
      const moc=await post(base+"/moc",engineer,{expected_change_no:n++,baseline_version_id:baseline,reason:"Fictief besluit",impact_description:"Fictieve impact"});
      await post(base+"/moc/impacts",engineer,{expected_change_no:n++,request_id:moc.id,area:"formula",explanation:"Fictief"});
      const validation=await verzoek("GET",base+"/release-validation",engineer);
      assert.equal(validation.status,200);
      assert.deepEqual(validation.body.blockers,[]);
      assert.equal(validation.body.content_valid,true);
      const round=await post(base+"/reviews",engineer,{expected_change_no:n,expected_baseline_change_no:baselineCounter,password:"demo"});
      const decisionPath="/recipes/reviews/"+round.round_id+"/decisions";
      // Twee gelijktijdige identieke besluiten: precies één mag slagen.
      const decision={expected_change_no:n,domain:"engineering",decision:"approve",reason:"Fictief",password:"demo"};
      const duplicate=await Promise.all([verzoek("POST",decisionPath,approver,decision),verzoek("POST",decisionPath,approver,decision)]);
      assert.deepEqual(duplicate.map(x=>x.status).sort(),[201,409]);
      await post(decisionPath,production,{...decision,domain:"production"});
      const approved=await post(decisionPath,qa,{...decision,domain:"quality"});
      assert.equal(approved.lifecycle_status,"approved");
      return {base,n,round:round.round_id};
    }
    const a=await prepare(first,null,null);
    const releaseBody={round_id:a.round,expected_change_no:a.n,effective_from:null,reason:"Fictief vrijgavebesluit",password:"demo"};
    assert.equal((await verzoek("POST",a.base+"/releases",qa,releaseBody)).status,403);
    assert.equal((await verzoek("POST",a.base+"/releases",approver,{...releaseBody,expected_change_no:a.n-1})).status,409);
    const parallel=await Promise.all([verzoek("POST",a.base+"/releases",approver,releaseBody),verzoek("POST",a.base+"/releases",approver,releaseBody)]);
    assert.deepEqual(parallel.map(x=>x.status).sort(),[201,409]);
    const rel=parallel.find(x=>x.status===201)!.body.release_id;
    const {rows:[evidence]}=await beheerDb.query("SELECT effective_from::text,released_at::text FROM fabriek.recipe_release WHERE id=$1",[rel]);
    const selected=async (at:string,known:string) => (await beheerDb.query("SELECT fabriek.recipe_effective_release($1,$2,$3) AS id",[recipe.id,at,known])).rows[0].id;
    assert.equal(await selected(evidence.effective_from,evidence.released_at),first);
    const next=await post("/recipes/"+recipe.id+"/versions",engineer,{expected_revision:1,name:"Fictief 2",description:""});
    const b=await prepare(next.id,first,a.n);
    const future=new Date(Date.now()+86400000).toISOString();
    const second=await post(b.base+"/releases",approver,{round_id:b.round,expected_change_no:b.n,effective_from:future,reason:"Fictieve vervanging",password:"demo"});
    const {rows:[secondEvidence]}=await beheerDb.query("SELECT effective_from::text,released_at::text FROM fabriek.recipe_release WHERE id=$1",[second.release_id]);
    assert.equal(await selected(evidence.effective_from,secondEvidence.released_at),first);
    assert.equal(await selected(future,secondEvidence.released_at),next.id);
    assert.equal(await selected(future,evidence.released_at),first);
    const withdrawn=await post("/recipes/releases/"+second.release_id+"/withdrawals",qa,{reason:"Fictieve intrekking vóór ingang",password:"demo"});
    const {rows:[w]}=await beheerDb.query("SELECT withdrawn_at::text FROM fabriek.recipe_release_withdrawal WHERE id=$1",[withdrawn.withdrawal_id]);
    assert.equal(await selected(future,w.withdrawn_at),null,"Geen automatische terugval na intrekking");
    assert.equal(await selected(future,secondEvidence.released_at),next.id,"Historische kennisgrens blijft behouden");
    const intervals=await beheerDb.query("SELECT recipe_version_id,valid_from=valid_until AS empty FROM fabriek.recipe_release_intervals($1,$2)",[recipe.id,w.withdrawn_at]);
    assert.equal(intervals.rows.find(x=>x.recipe_version_id===next.id).empty,true);
    const dossier=await verzoek("GET","/recipes/reviews/"+b.round,qa);
    assert.equal(dossier.status,200);
    assert.equal(dossier.body.release.id,second.release_id);
    assert.equal(dossier.body.withdrawal.id,withdrawn.withdrawal_id);
  });
});

describe("#113 persoonlijke receptproductkeuze", () => {
  test("uitsluitend actuele productscope, geen impliciet conceptrecht", async () => {
    const {rows:[p]}=await beheerDb.query("SELECT id FROM fabriek.product WHERE code='PRD-A'");
    const naam="mes.recipe.product.scope";
    await beheerDb.query("INSERT INTO fabriek.gebruiker(gebruikersnaam,rol,wachtwoord_hash) VALUES ($1,'analist',fabriek.wachtwoord_hash('demo'))",[naam]);
    const {rows:[grant]}=await beheerDb.query("INSERT INTO fabriek.authorization_grant(user_id,role_code,product_id) SELECT id,'quality_approver',$2 FROM fabriek.gebruiker WHERE gebruikersnaam=$1 RETURNING id",[naam,p.id]);
    const token=await login(naam);
    const result=await verzoek("GET","/recipes/products",token);
    assert.equal(result.status,200,JSON.stringify(result.body));
    assert.deepEqual(result.body.map((x:any)=>[x.id,x.can_edit,x.can_review]),[[p.id,false,true]]);
    await beheerDb.query("UPDATE fabriek.authorization_grant SET revoked_at=now() WHERE id=$1",[grant.id]);
    const empty=await verzoek("GET","/recipes/products",token);
    assert.equal(empty.status,200);
    assert.deepEqual(empty.body,[]);
    assert.equal((await verzoek("GET","/recipes/products")).status,401);
  });
});

describe("#113.4c.1 beperkte referentiecatalogus", () => {
  test("persoonlijke productscope geeft uitsluitend referentielezing, geen globaal materiaalbeheer", async () => {
    const {rows:products}=await beheerDb.query("SELECT id,code FROM fabriek.product WHERE code IN ('PRD-A','PRD-B')");
    const pa=products.find(p=>p.code==="PRD-A").id;
    const pb=products.find(p=>p.code==="PRD-B").id;
    const naam="mes.recipe.references.scope";
    await beheerDb.query("INSERT INTO fabriek.gebruiker(gebruikersnaam,rol,wachtwoord_hash) VALUES ($1,'analist',fabriek.wachtwoord_hash('demo'))",[naam]);
    const {rows:[grant]}=await beheerDb.query("INSERT INTO fabriek.authorization_grant(user_id,role_code,product_id) SELECT id,'process_engineer',$2 FROM fabriek.gebruiker WHERE gebruikersnaam=$1 RETURNING id",[naam,pa]);
    const token=await login(naam);
    const pad="/recipes/references/"+pa;
    const result=await verzoek("GET",pad,token);
    assert.equal(result.status,200,JSON.stringify(result.body));
    assert.ok(Array.isArray(result.body.materials));
    assert.ok(Array.isArray(result.body.qualifications));
    assert.ok(result.body.materials.every((m:any)=>Object.keys(m).sort().join(",")==="id,material_code,measurement_unit_id,name,revision,unit"));
    assert.ok(result.body.qualifications.every((q:any)=>Object.keys(q).sort().join(",")==="code,description"));
    assert.equal((await verzoek("GET","/recipes/references/"+pb,token)).status,403);
    assert.equal((await verzoek("GET","/materials/",token)).status,403);
    assert.equal((await verzoek("POST","/materials/classes",token,{code:"DENIED-127",name:"Niet toegestaan"})).status,403);
    assert.equal((await verzoek("GET",pad)).status,401);
    await beheerDb.query("UPDATE fabriek.authorization_grant SET revoked_at=now() WHERE id=$1",[grant.id]);
    assert.equal((await verzoek("GET",pad,token)).status,403);
  });
});


describe("#115.5 middelstilstand online", () => {
  test("F4-115-E01–E05: persoonlijke context, replay, scheiding en audit", async () => {
    const {rows:[person]}=await beheerDb.query("SELECT id FROM fabriek.gebruiker WHERE gebruikersnaam='operator.a'");
    const {rows:[station]}=await beheerDb.query("INSERT INTO fabriek.pc(naam) VALUES ('F115-API-PC') RETURNING id");
    const {rows:[step]}=await beheerDb.query("INSERT INTO fabriek.processtap(code,naam,volgorde,niveau) VALUES ('PS9155','Fictief',(SELECT max(volgorde)+1 FROM fabriek.processtap),'batch') RETURNING id");
    await beheerDb.query("INSERT INTO fabriek.pc_stap(pc_id,processtap_id) VALUES ($1,$2)",[station.id,step.id]);
    const {rows:[hierarchy]}=await beheerDb.query("INSERT INTO fabriek.equipment_hierarchy(code,name,level) VALUES ('F115-API-ENT','Fictief','enterprise') RETURNING id");
    const {rows:equipment}=await beheerDb.query("INSERT INTO fabriek.equipment(code,name,hierarchy_id) SELECT code,'Fictief',$1 FROM unnest(ARRAY['F115-API-A','F115-API-B','F115-API-C']) AS t(code) RETURNING id,code",[hierarchy.id]);
    const a=equipment.find(x=>x.code==="F115-API-A")!.id;
    const b=equipment.find(x=>x.code==="F115-API-B")!.id;
    const c=equipment.find(x=>x.code==="F115-API-C")!.id;
    for(const id of [a,b]) await beheerDb.query("INSERT INTO fabriek.equipment_workstation(pc_id,equipment_id,opened_by,open_reason) VALUES ($1,$2,$3,'Test')",[station.id,id,person.id]);
    const op=await login("operator.a","F115-API-PC");
    const other=await login("operator.b","F115-API-PC");
    const pl=await login("ploegleider1");
    const path="/stilstand/middelen";
    const close=(id:string)=>path+"/"+id+"/einde";
    const body={id:randomUUID(),stapcode:"PS9155",equipmentId:a,oorzaak:"STOR-MACH",toelichting:"Fictieve storing"};
    const second={...body,id:randomUUID(),equipmentId:b};
    assert.equal((await verzoek("POST",path,undefined,body)).status,401);
    assert.equal((await verzoek("POST",path,await login("kwaliteit1","F115-API-PC"),body)).status,403);
    assert.equal((await verzoek("POST",path,await login("operator.a"),body)).status,400);
    assert.equal((await verzoek("POST",path,await login("operator.a","PC-01"),body)).status,403);
    assert.equal((await verzoek("POST",path,op,{...body,equipmentId:c})).status,403);
    assert.equal((await verzoek("POST",path,op,{...body,stapcode:"PS1"})).status,403);
    assert.equal((await verzoek("POST",path,op,{...body,oorzaak:"ONBEKEND"})).status,422);
    const legacy={id:randomUUID(),stapcode:body.stapcode,oorzaak:body.oorzaak};
    assert.equal((await verzoek("POST","/stilstand",op,legacy)).status,201);
    const baseline=await verzoek("GET","/analyse/stilstand",pl);
    assert.equal(baseline.status,200);
    const before=(await beheerDb.query("SELECT count(*)::int AS n FROM fabriek.equipment_status_history")).rows[0].n;
    const both=await Promise.all([verzoek("POST",path,op,body),verzoek("POST",path,op,body)]);
    for(const r of both){assert.equal(r.status,200,JSON.stringify(r.body));assert.deepEqual(r.body,{id:body.id});}
    assert.deepEqual((await verzoek("POST",path,op,second)).body,{id:second.id});
    assert.equal((await verzoek("POST",path,op,{...body,id:randomUUID()})).status,409);
    assert.equal((await verzoek("POST",path,other,body)).status,409);
    assert.equal((await verzoek("POST",path,op,{...body,toelichting:"Anders"})).status,409);
    assert.equal((await verzoek("POST",path,op,{...body,id:legacy.id})).status,409);
    assert.equal((await verzoek("POST","/stilstand",op,{...legacy,id:body.id})).status,409);
    assert.equal((await verzoek("POST","/stilstand/"+body.id+"/einde",op,{})).status,404);
    assert.equal((await verzoek("POST",close(legacy.id),op,{})).status,404);
    const list=await verzoek("GET","/stilstand",op);
    assert.equal(list.status,200);
    assert.deepEqual(list.body.filter((x:any)=>x.stap===body.stapcode).map((x:any)=>x.id),[legacy.id]);
    const display=await verzoek("GET","/stilstand",await login("scherm1"));
    assert.equal(display.status,200);
    assert.deepEqual(display.body.filter((x:any)=>x.stap===body.stapcode).map((x:any)=>x.id),[legacy.id]);
    const analysis=await verzoek("GET","/analyse/stilstand",pl);
    assert.equal(analysis.status,200);
    assert.equal(analysis.body.per_stap.find((x:any)=>x.stap===body.stapcode).aantal,1);
    assert.deepEqual(analysis.body.per_oorzaak.map((x:any)=>[x.oorzaak,x.aantal]).sort(),baseline.body.per_oorzaak.map((x:any)=>[x.oorzaak,x.aantal]).sort());
    assert.ok(!analysis.body.lijst.some((x:any)=>x.id===body.id||x.id===second.id));
    await beheerDb.query("UPDATE fabriek.equipment_workstation SET closed_by=$1,closed_at=clock_timestamp(),close_reason='Ontkoppeld' WHERE pc_id=$2 AND equipment_id=$3",[person.id,station.id,a]);
    const end=await Promise.all([verzoek("POST",close(body.id),op,{notitie:"Hersteld"}),verzoek("POST",close(body.id),op,{notitie:"Hersteld"})]);
    for(const r of end){assert.equal(r.status,200,JSON.stringify(r.body));assert.deepEqual(r.body,{id:body.id});}
    assert.equal((await verzoek("POST",close(body.id),op,{notitie:"Anders"})).status,409);
    assert.equal((await verzoek("POST",close(body.id),other,{notitie:"Hersteld"})).status,409);
    assert.equal((await verzoek("POST",close(second.id),await login("kwaliteit1"),{})).status,403);
    assert.equal((await verzoek("POST",close(randomUUID()),op,{})).status,404);
    assert.equal((await verzoek("POST",close(second.id),op,{})).status,200);
    assert.equal((await verzoek("POST","/stilstand/"+legacy.id+"/einde",op,{})).status,200);
    const {rows:[evidence]}=await beheerDb.query("SELECT (SELECT count(*)::int FROM fabriek.stilstand WHERE id IN ($1,$2) AND eind_op IS NOT NULL AND equipment_id IS NOT NULL) AS records,(SELECT count(*)::int FROM fabriek.melding WHERE bron_id IN ($1,$2)) AS messages,(SELECT count(*)::int FROM fabriek.config_log WHERE tabel='stilstand' AND record_id IN ($1,$2) AND actor_origin='personal' AND actor_user_id=$3) AS audits,(SELECT count(*)::int FROM fabriek.equipment_status_history) AS statuses",[body.id,second.id,person.id]);
    assert.deepEqual(evidence,{records:2,messages:2,audits:4,statuses:before});
  });
});


describe("#115.6 middelenprojecties en beheercontracten", () => {
  test("F4-115-F01–F06: exacte decimalen, gescheiden rechten en werkstationkeuze", async () => {
    const prefix="mes.resources.f115.";
    const accounts=[
      ["catalog","resource_catalog_manager",null],
      ["scoped","resource_catalog_manager","API-AREA"],
      ["status","resource_status_manager",null],
      ["statusScoped","resource_status_manager","API-AREA"],
      ["maintenance","maintenance_technician",null],
    ] as const;
    for(const [name,role,area] of accounts){
      await beheerDb.query("INSERT INTO fabriek.gebruiker(gebruikersnaam,rol,wachtwoord_hash) VALUES ($1,'pending',fabriek.wachtwoord_hash('demo'))",[prefix+name]);
      await beheerDb.query("INSERT INTO fabriek.authorization_grant(user_id,role_code,area_code) SELECT id,$2,$3 FROM fabriek.gebruiker WHERE gebruikersnaam=$1",[prefix+name,role,area]);
    }
    const catalog=await login(prefix+"catalog"), scoped=await login(prefix+"scoped"), status=await login(prefix+"status"), statusScoped=await login(prefix+"statusScoped"), maintenance=await login(prefix+"maintenance");
    const op=await login("operator.a","F115-API-PC");
    const display=await login("scherm1");
    const get=async(path:string,token:string,status=200)=>{
      const r=await verzoek("GET",path,token); assert.equal(r.status,status,JSON.stringify(r.body));return r.body;
    };
    const post=async(path:string,token:string,body:object,status=201)=>{
      const r=await verzoek("POST",path,token,body); assert.equal(r.status,status,JSON.stringify(r.body));return r.body;
    };
    const perms=async(token:string)=>get("/auth/permissions",token);
    assert.deepEqual([(await perms(catalog)).resourceCatalog,(await perms(catalog)).resourceStatus],[true,false]);
    assert.deepEqual([(await perms(status)).resourceCatalog,(await perms(status)).resourceStatus],[false,true]);
    assert.equal((await perms(statusScoped)).resourceStatus,true);
    assert.equal((await perms(scoped)).resourceCatalog,true);
    assert.equal((await perms(display)).resourceStatus,false);
    assert.equal((await perms(op)).resourceStatus,false);
    const {rows:equipment}=await beheerDb.query("SELECT id,code FROM fabriek.equipment WHERE code IN ('API-E1','API-E2','F115-API-B')");
    const e=equipment.find(x=>x.code==="API-E1")!.id, outside=equipment.find(x=>x.code==="API-E2")!.id;
    const linked=equipment.find(x=>x.code==="F115-API-B")!.id;
    const {rows:[station]}=await beheerDb.query("SELECT id FROM fabriek.pc WHERE naam='F115-API-PC'");
    const {rows:[dim]}=await beheerDb.query("SELECT id FROM fabriek.quantity_dimension WHERE (length_exp,mass_exp,time_exp,current_exp,temperature_exp,amount_exp,luminous_exp)=(0,1,0,0,0,0,0)");
    const {rows:[kind]}=await beheerDb.query("INSERT INTO fabriek.quantity_kind(dimension_id,code,name,value_semantics) VALUES ($1,'F115-HTTP-MASS','Fictief','ratio') RETURNING id",[dim.id]);
    const {rows:[unit]}=await beheerDb.query("INSERT INTO fabriek.measurement_unit(quantity_kind_id,code,symbol,name) VALUES ($1,'F115-HTTP-KG','kg','Fictief') RETURNING id",[kind.id]);
    const references=await get("/resources/property-references",catalog);
    assert.ok(references.quantity_kinds.some((x:any)=>x.id===kind.id));
    assert.ok(references.units.some((x:any)=>x.id===unit.id&&x.quantity_kind_id===kind.id));
    assert.deepEqual(Object.keys(references).sort(),["quantity_kinds","units"]);
    await get("/resources/property-references",scoped,403);
    await get("/resources/property-references",status,403);
    await get("/resources/property-references",op,403);
    const prop=(await post("/resources/properties",catalog,{code:"F115-HTTP-P",name:"Fictieve capaciteit",quantity_kind_id:kind.id,measurement_unit_id:unit.id})).id;
    const base={equipment_id:e,property_definition_id:prop,value:"9007199254740993.123456789",reason:"Exact"};
    for(const value of [9007199254740992,"1e3","NaN","Infinity","",null]){
      await post("/resources/capabilities",catalog,{...base,value},400);
    }
    await post("/resources/capabilities",catalog,{...base,actor_id:randomUUID()},400);
    await post("/resources/capabilities",status,base,403);
    await post("/resources/capabilities",scoped,{...base,equipment_id:outside},403);
    const cap=(await post("/resources/capabilities",scoped,base)).id;
    await post("/resources/capabilities/"+cap+"/capacity",scoped,{expected_revision:1});
    const caps=await get("/resources/capabilities",scoped);
    assert.deepEqual(caps.equipment.map((x:any)=>x.id),[e]);
    assert.equal(caps.capabilities.find((x:any)=>x.id===cap).value,base.value);
    assert.equal(caps.capabilities.find((x:any)=>x.id===cap).capacity,true);
    await post("/resources/capabilities/"+cap+"/revisions",scoped,{expected_revision:1,value:0,reason:"Geen"},400);
    await post("/resources/capabilities/"+cap+"/revisions",scoped,{expected_revision:1,value:"0",reason:"Geen"},422);
    const rev={expected_revision:1,value:"9007199254740993.123456790",reason:"Revisie"};
    assert.equal((await post("/resources/capabilities/"+cap+"/revisions",scoped,rev,200)).revision,2);
    await post("/resources/capabilities/"+cap+"/revisions",scoped,rev,409);
    assert.equal((await get("/resources/capabilities",scoped)).capabilities.find((x:any)=>x.id===cap).value,rev.value);
    await get("/resources/capabilities",status,403);
    await get("/resources/statuses",catalog,403);
    const unknown=(await get("/resources/statuses",status)).find((x:any)=>x.id===outside);
    assert.equal(unknown.status,"unknown");assert.equal(unknown.revision,0);
    const statusPath="/resources/equipment/"+e+"/status";
    await post(statusPath,catalog,{expected_revision:0,status:"blocked",reason:"Geen"},403);
    assert.equal((await post(statusPath,statusScoped,{expected_revision:0,status:"blocked",reason:"Test"},200)).revision,1);
    await post(statusPath,statusScoped,{expected_revision:0,status:"available",reason:"Oud"},409);
    await post("/resources/equipment/"+outside+"/status",statusScoped,{expected_revision:0,status:"blocked",reason:"Geen"},403);
    assert.equal((await post(statusPath,statusScoped,{expected_revision:1,status:"available",reason:"Hersteld"},200)).revision,2);
    const statuses=await get("/resources/statuses",statusScoped);
    assert.deepEqual(statuses.map((x:any)=>x.id),[e]);
    assert.equal(statuses[0].status,"available");
    const history=await get("/resources/equipment/"+e+"/status-history",statusScoped);
    assert.deepEqual(history.map((x:any)=>x.revision),[2,1]);
    assert.equal(history[0].created_by_name,prefix+"statusScoped");
    await get("/resources/equipment/"+outside+"/status-history",statusScoped,403);
    await get("/resources/workstations",scoped,403);
    const assignment=(await post("/resources/workstation-assignments",catalog,{pc_id:station.id,equipment_id:e,reason:"Test"})).id;
    assert.ok((await get("/resources/workstations",catalog)).assignments.some((x:any)=>x.id===assignment&&x.closed_at===null));
    const choices="/stilstand/middelen/keuzes?stapcode=PS9155";
    assert.deepEqual((await get(choices,op)).map((x:any)=>x.id).sort(),[e,linked].sort());
    await get(choices,await login("operator.a","PC-01"),403);
    await get(choices,maintenance,403);
    await get("/stilstand/middelen",catalog,403);
    await get("/stilstand/middelen",display,403);
    const downtime={id:randomUUID(),stapcode:"PS9155",equipmentId:e,oorzaak:"STOR-MACH"};
    await post("/stilstand/middelen",op,{...downtime,pcId:station.id},400);
    await post("/stilstand/middelen",op,{...downtime,begin_op:"2020-01-01T00:00:00Z"},400);
    await post("/stilstand/middelen",op,downtime,200);
    assert.ok((await get("/stilstand/middelen",maintenance)).some((x:any)=>x.id===downtime.id));
    assert.equal((await get(choices,op)).find((x:any)=>x.id===e).open_downtime_id,downtime.id);
    await post("/resources/workstation-assignments/"+assignment+"/close",catalog,{reason:"Ontkoppeld"},200);
    assert.deepEqual((await get(choices,op)).map((x:any)=>x.id),[linked]);
    await post("/stilstand/middelen/"+downtime.id+"/einde",op,{},200);
    assert.ok(!(await get("/stilstand/middelen",maintenance)).some((x:any)=>x.id===downtime.id));
    await beheerDb.query("UPDATE fabriek.authorization_grant SET revoked_at=now() WHERE user_id=(SELECT id FROM fabriek.gebruiker WHERE gebruikersnaam=$1)",[prefix+"statusScoped"]);
    assert.equal((await perms(statusScoped)).resourceStatus,false);
    await get("/resources/statuses",statusScoped,403);
  });
});
