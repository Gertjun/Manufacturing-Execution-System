// Integratietest van de API tegen een echte (test)database.
// LET OP: de database wordt leeggemaakt en opnieuw gevuld met fictieve configuratie.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { bouwApp, type App } from "../src/app.js";
import { maakPool, type Db } from "../src/db.js";

const DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost/batchgui?host=/tmp&port=5433";

let app: App;
let db: Db;

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

async function kiesNaam(token: string, naam = "Operator A"): Promise<string> {
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
    const a = await verzoek("POST", `/registraties/${start.body.id}/afronden`, token);
    assert.equal(a.status, 200, JSON.stringify(a.body));
  }
}

before(async () => {
  db = maakPool(DB_URL);
  await db.query(readFileSync(new URL("../../db/schema.sql", import.meta.url), "utf8"));
  await db.query(readFileSync(new URL("../../db/seed_config.sql", import.meta.url), "utf8"));
  app = await bouwApp({ db, jwtGeheim: "test-geheim-dat-lang-genoeg-is-0123456789" });
});

after(async () => {
  await app.close();
  await db.end();
});

describe("inloggen en rollen", () => {
  test("verkeerd wachtwoord geeft 401", async () => {
    const r = await verzoek("POST", "/auth/login", undefined, { gebruikersnaam: "operator", wachtwoord: "fout", pc: "PC-01" });
    assert.equal(r.status, 401);
  });
  test("operator moet vanaf een pc inloggen", async () => {
    const r = await verzoek("POST", "/auth/login", undefined, { gebruikersnaam: "operator", wachtwoord: "demo" });
    assert.equal(r.status, 400);
    assert.match(r.body.fout, /pc/);
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
  test("kwaliteit mag lezen maar niet invoeren of beheren", async () => {
    const t = await login("kwaliteit1");
    assert.equal((await verzoek("GET", "/analyse/afwijkingen", t)).status, 200);
    assert.equal((await verzoek("POST", "/batches", t, { batchnummer: "B-2026-0998" })).status, 403);
    assert.equal((await verzoek("PATCH", "/beheer/velden/S1.1", t, { naam: "x" })).status, 403);
  });
  test("configuratie: 18 stappen, PS16 is de lot-stap", async () => {
    const t = await login("analist1");
    const r = await verzoek("GET", "/config/stappen", t);
    assert.equal(r.body.length, 18);
    assert.equal(r.body.find((s: any) => s.is_lot_stap).code, "PS16");
    assert.deepEqual(r.body[2].velden.map((v: any) => v.code), ["S3.1", "S3.2", "S3.3"]);
  });
});

describe("productie van batch tot lot", () => {
  let op: string;
  let pl: string;

  before(async () => {
    op = await kiesNaam(await login("operator", "PC-01"));
    pl = await kiesNaam(await login("ploegleider1", "PC-02"), "Operator B");
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

  test("ingevuld veld opnieuw invullen geeft 409 met uitleg", async () => {
    const lijst = await verzoek("GET", "/registraties?status=open&stapcode=PS1", op);
    const r = await verzoek("POST", `/registraties/${lijst.body[0].id}/waarden`, op, {
      waarden: [{ veldcode: "S1.2", gemeten: 400 }],
    });
    assert.equal(r.status, 409);
    assert.match(r.body.fout, /ploegleider/);
  });

  test("operator kan niet corrigeren, ploegleider wel", async () => {
    const lijst = await verzoek("GET", "/registraties?status=open&stapcode=PS1", op);
    const id = lijst.body[0].id;
    const pad = `/registraties/${id}/waarden/S1.1/correctie`;
    assert.equal((await verzoek("POST", pad, op, { gemeten: 82, reden: "tikfout" })).status, 403);
    const r = await verzoek("POST", pad, pl, { gemeten: 82, reden: "tikfout" });
    assert.equal(r.status, 201);
    const s11 = r.body.velden.find((v: any) => v.code === "S1.1");
    assert.equal(s11.waarde.gemeten, 82);
    assert.equal(s11.waarde.gecorrigeerd, true);
    assert.equal(s11.waarde.markering, "ok");
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

    const herbLijst = await verzoek("GET", "/analyse/herbewerkingen", op);
    assert.equal(herbLijst.body.length, 1);
    assert.equal(herbLijst.body[0].reden, "te nat na verpakken");
    const afw = await verzoek("GET", "/analyse/afwijkingen", op);
    assert.ok(afw.body.some((a: any) => a.veld === "S18.3" && a.lotnummer === "L-2026-0001"));
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
  test("nieuwe batch staat klaar voor PS1; overzicht heeft 18 stappen", async () => {
    const t = await login("analist1");
    const ps1 = await verzoek("GET", "/werkvoorraad/PS1", t);
    assert.ok(ps1.body.wachtend.some((w: any) => w.nummer === "B-2026-0200"));
    const overzicht = await verzoek("GET", "/werkvoorraad", t);
    assert.equal(overzicht.body.length, 18);
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
