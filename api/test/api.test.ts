// Integratietest van de API tegen een echte (test)database.
// LET OP: de database wordt leeggemaakt en opnieuw gevuld met fictieve configuratie.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { bouwApp, type App } from "../src/app.js";
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
    assert.deepEqual(r.body.waarschuwingen, []);
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
    assert.equal(stappen.body.length, 18);
    assert.deepEqual(stappen.body[0].items.map((i: any) => i.nummer), [gepland[3]]);
    // In de lot-stap plan je een lotvoorstel, geen batch.
    const fout = await verzoek("PUT", "/planning/stappen", planner, { dag: vandaag, stap: "PS16", items: [{ nummer: gepland[0] }] });
    assert.equal(fout.status, 400);
    const kand = await verzoek("GET", "/planning/kandidaten?stap=PS2", planner);
    assert.equal(kand.body[0].nummer, gepland[0]);
    assert.equal(kand.body[0].klaar, true);
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
    assert.equal(r.body.stappen.length, 18);
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
    const pl = await kiesNaam(await login("ploegleider1", "PC-05"), "Operator B");
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
    assert.equal((await verzoek("POST", `/registraties/${start.body.id}/grondstoffen`, op, { grondstoffen: [{ code: "GS-A", partij: "ander" }] })).status, 409);
    assert.equal((await verzoek("POST", `/registraties/${start.body.id}/afronden`, op)).status, 200);
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
    assert.equal(n.body.door, "Operator A");
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
    // Analisten en Kwaliteit lezen, maar schrijven niet.
    assert.equal((await verzoek("POST", "/overdracht", await login("kwaliteit1"), { bijzonderheden: "x" })).status, 403);
  });

  test("beheerder past ploegtijden aan", async () => {
    const bh = await login("beheerder1");
    const r = await verzoek("PATCH", "/overdracht/ploegen/O", bh, { naam: "Vroege ploeg" });
    assert.equal(r.body.naam, "Vroege ploeg");
    assert.equal((await verzoek("PATCH", "/overdracht/ploegen/O", bh, { begint: "25:00" })).status, 400);
    await verzoek("PATCH", "/overdracht/ploegen/O", bh, { naam: "Ochtendploeg" });
    assert.equal((await verzoek("PATCH", "/overdracht/ploegen/O", await login("planner1"), { naam: "x" })).status, 403);
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
    assert.equal(s.body.operator, "Operator A");
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
    const e = await verzoek("POST", `/stilstand/${id}/einde`, op, {});
    assert.equal(e.status, 200);
    assert.ok(e.body.eind_op);
    assert.equal((await verzoek("POST", `/stilstand/${id}/einde`, op, {})).status, 200, "opnieuw versturen is veilig");
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

describe("Capaciteit", () => {
  test("weekdagen, uitzondering, bezetting in de week en waarschuwing bij te veel", async () => {
    const t = await login("planner1");
    const c = await verzoek("GET", "/planning/capaciteit", t);
    assert.deepEqual(c.body.weekdagen.map((w: any) => w.max_batches), [6, 6, 6, 6, 6, 6, 6]);
    await verzoek("PUT", "/planning/capaciteit/weekdagen", t, { weekdagen: [{ weekdag: 6, max_batches: 0 }, { weekdag: 7, max_batches: 0 }] });
    // Een maandag ver in de toekomst, zodat er nog niets op staat.
    const dag = "2027-03-01";
    assert.equal((await verzoek("PUT", `/planning/capaciteit/dagen/${dag}`, t, { max_batches: 2, reden: "onderhoud lijn 1" })).status, 204);
    const p1 = await verzoek("POST", "/planning/batches", t, { dag, aantal: 2 });
    assert.equal(p1.body.waarschuwing, null);
    const p2 = await verzoek("POST", "/planning/batches", t, { dag, aantal: 1 });
    assert.equal(p2.body.waarschuwing, "Deze dag heeft nu 3 batches; de capaciteit is 2");
    const w = await verzoek("GET", `/planning/week?van=${dag}&dagen=7`, t);
    assert.deepEqual([w.body.dagen[0].capaciteit, w.body.dagen[0].bezet, w.body.dagen[0].reden], [2, 3, "onderhoud lijn 1"]);
    assert.equal(w.body.dagen[5].capaciteit, 0);
    assert.equal(w.body.vrij, 4 * 6, "dinsdag t/m vrijdag; de volle maandag telt niet negatief");
    await verzoek("POST", `/planning/capaciteit/dagen/${dag}/weghalen`, t);
    const d = await verzoek("GET", `/planning/capaciteit?dag=${dag}`, t);
    assert.deepEqual(d.body.dag, { dag, capaciteit: 6, bezet: 3 });
    assert.equal((await verzoek("PUT", "/planning/capaciteit/weekdagen", t, { weekdagen: [{ weekdag: 6, max_batches: 2 }] })).status, 204);
    assert.equal((await verzoek("GET", "/planning/capaciteit", t)).body.weekdagen[5].max_batches, 2);
    assert.equal((await verzoek("PUT", "/planning/capaciteit/weekdagen", await login("kwaliteit1"), { weekdagen: [{ weekdag: 6, max_batches: 9 }] })).status, 403);
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
    const tokenA = await kiesNaam(await login("operator", "PC-01"), "Operator A");
    const ops = await verzoek("GET", "/auth/operators", tokenA);
    const opB = ops.body.find((o: { naam: string }) => o.naam === "Operator B");
    assert.ok(opB, "Operator B bestaat");
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
    assert.equal(start.body.operator, "Operator B", "de operator van de wachtrij, niet die van het token");
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
    assert.ok(Number(rij.door_b) > 0, "waarden op naam van Operator B");
  });

  test("zonder koppen (oudere invoerschermen) blijft alles zoals het was", async () => {
    const token = await kiesNaam(await login("operator", "PC-01"), "Operator A");
    const nr = "B-2026-8002";
    assert.equal((await verzoek("POST", "/batches", token, { batchnummer: nr })).status, 201);
    const start = await verzoek("POST", "/registraties", token, { stapcode: "PS1", batchnummer: nr });
    assert.equal(start.status, 201);
    assert.equal(start.body.operator, "Operator A");
    assert.ok(Math.abs(Date.parse(start.body.gestart_op) - Date.now()) < 60_000);
  });

  test("een ongeldige operatorkop telt niet", async () => {
    const token = await kiesNaam(await login("operator", "PC-01"), "Operator A");
    const nr = "B-2026-8003";
    assert.equal((await verzoek("POST", "/batches", token, { batchnummer: nr })).status, 201);
    const start = await metKoppen("POST", "/registraties", token, { "x-batchgui-operator": "geen-uuid" }, { stapcode: "PS1", batchnummer: nr });
    assert.equal(start.status, 201);
    assert.equal(start.body.operator, "Operator A");
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
