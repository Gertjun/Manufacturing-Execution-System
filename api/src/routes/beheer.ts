import { Type } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { BEHEER, vereist } from "../auth.js";
import { inTransactie, lees, type Tx } from "../db.js";
import { TESTACCOUNTS } from "../testaccounts.js";
import { ApiFout, leesbaar, niet } from "../fouten.js";
import { Veld } from "./config.js";
import { StapCode, NulGetal, NulGeheel } from "./schemas.js";
import { VERSIE } from "../versie.js";

const OptGetal = Type.Optional(NulGetal());

const routes: FastifyPluginAsyncTypebox = async (app) => {
  // Nieuw veld bij een stap. De code (S3.4) wordt uitgegeven en nooit hergebruikt.
  app.post(
    "/velden",
    {
      preHandler: vereist(...BEHEER),
      schema: {
        tags: ["beheer"],
        body: Type.Object({
          stapcode: StapCode,
          naam: Type.String({ minLength: 1 }),
          soort: Type.Union([Type.Literal("procesparameter"), Type.Literal("gewicht"), Type.Literal("overig")]),
          eenheid: Type.Optional(Type.String()),
          grens_min: OptGetal,
          grens_max: OptGetal,
          tolerantie: OptGetal,
          tolerantie_soort: Type.Optional(Type.Union([Type.Literal("absoluut"), Type.Literal("procent")])),
          verplicht: Type.Optional(Type.Boolean()),
          decimalen: Type.Optional(NulGeheel({ minimum: 0, maximum: 6, description: "Aantal decimalen bij het tonen; leeg = automatisch" })),
    gemeten_door: Type.Optional(Type.Union([Type.Literal("productie"), Type.Literal("kwaliteit")], { description: "Wie meet: de operator of Kwaliteit (sinds 0.37.0, #64)" })),
        }),
        response: { 201: Veld },
      },
    },
    async (req, reply) => {
      const b = req.body;
      const code = await inTransactie(app.db, req.user.naam, async (tx) => {
        const { rows } = await tx.query("SELECT id, volgorde FROM processtap WHERE code = $1 FOR UPDATE", [b.stapcode]);
        if (!rows[0]) throw niet("Stap");
        const stap = rows[0];
        // Hoogste nummer ooit uitgegeven voor deze stap, ook inactieve velden.
        const { rows: m } = await tx.query(
          `SELECT coalesce(max(split_part(code, '.', 2)::int), 0) + 1 AS nr, coalesce(max(volgnummer), 0) + 1 AS volg
             FROM veld WHERE processtap_id = $1`,
          [stap.id],
        );
        const code = `S${stap.volgorde}.${m[0].nr}`;
        await tx.query(
          `INSERT INTO veld (processtap_id, code, naam, soort, eenheid, grens_min, grens_max, tolerantie, tolerantie_soort, volgnummer, verplicht, decimalen, gemeten_door)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,coalesce($9,'absoluut'),$10,coalesce($11,true),$12,coalesce($13,'productie'))`,
          [stap.id, code, b.naam, b.soort, b.eenheid ?? null, b.grens_min ?? null, b.grens_max ?? null, b.tolerantie ?? null,
            b.tolerantie_soort ?? null, m[0].volg, b.verplicht ?? null, b.decimalen ?? null, b.gemeten_door ?? null],
        );
        return code;
      });
      const [veld] = await lees(app.db, "SELECT * FROM veld WHERE code = $1", [code]);
      return reply.status(201).send(veld as never);
    },
  );

  // Veld aanpassen: naam, grenzen, tolerantie, verplicht, actief. De code verandert nooit.
  app.patch(
    "/velden/:code",
    {
      preHandler: vereist(...BEHEER),
      schema: {
        tags: ["beheer"],
        params: Type.Object({ code: Type.String() }),
        body: Type.Object(
          {
            naam: Type.Optional(Type.String({ minLength: 1 })),
            eenheid: Type.Optional(Type.Union([Type.Null(), Type.String()])),
            grens_min: OptGetal,
            grens_max: OptGetal,
            tolerantie: OptGetal,
            tolerantie_soort: Type.Optional(Type.Union([Type.Literal("absoluut"), Type.Literal("procent")])),
            verplicht: Type.Optional(Type.Boolean()),
            actief: Type.Optional(Type.Boolean()),
            op_certificaat: Type.Optional(Type.Boolean()),
            decimalen: Type.Optional(NulGeheel({ minimum: 0, maximum: 6, description: "Aantal decimalen bij het tonen; leeg = automatisch" })),
    gemeten_door: Type.Optional(Type.Union([Type.Literal("productie"), Type.Literal("kwaliteit")], { description: "Wie meet: de operator of Kwaliteit (sinds 0.37.0, #64)" })),
          },
          { additionalProperties: false, minProperties: 1 },
        ),
        response: { 200: Veld },
      },
    },
    async (req) => {
      const kolommen = Object.keys(req.body);
      const toegestaan = ["naam", "eenheid", "grens_min", "grens_max", "tolerantie", "tolerantie_soort", "verplicht", "actief", "op_certificaat", "decimalen", "gemeten_door"];
      if (kolommen.length === 0) throw new ApiFout(400, "Niets te wijzigen");
      if (kolommen.some((k) => !toegestaan.includes(k))) throw new ApiFout(400, "Onbekend veld in wijziging");
      const waarden = kolommen.map((k) => (req.body as Record<string, unknown>)[k]);
      const set = kolommen.map((k, i) => `${k} = $${i + 2}`).join(", ");
      const n = await inTransactie(app.db, req.user.naam, async (tx) => {
        const r = await tx.query(`UPDATE veld SET ${set} WHERE code = $1`, [req.params.code, ...waarden]);
        return r.rowCount;
      });
      if (!n) throw niet("Veld");
      const [veld] = await lees(app.db, "SELECT * FROM veld WHERE code = $1", [req.params.code]);
      return veld as never;
    },
  );

  // Grenzen per product (0.29.0, D55): een regel vervangt voor dat product alle vier de grenswaarden van het veld.
  const GrensPerProduct = Type.Object({
    product: Type.String(), grens_min: NulGetal(), grens_max: NulGetal(), tolerantie: NulGetal(), tolerantie_soort: Type.String(),
  });
  const VeldProduct = Type.Object({ code: Type.String(), product: Type.String() });
  app.put(
    "/velden/:code/producten/:product",
    {
      preHandler: vereist(...BEHEER),
      schema: {
        tags: ["beheer"],
        description: "Eigen grenzen en tolerantie van een veld voor één product. Geldt voor metingen vanaf nu; eerdere metingen houden hun grenzen.",
        params: VeldProduct,
        body: Type.Object({
          grens_min: NulGetal(), grens_max: NulGetal(), tolerantie: NulGetal(),
          tolerantie_soort: Type.Optional(Type.Union([Type.Literal("absoluut"), Type.Literal("procent")])),
        }, { additionalProperties: false }),
        response: { 200: GrensPerProduct },
      },
    },
    async (req) =>
      inTransactie(app.db, req.user.naam, async (tx) => {
        const { rows } = await tx.query(
          `INSERT INTO veld_product (veld_id, product_id, grens_min, grens_max, tolerantie, tolerantie_soort)
           SELECT v.id, p.id, $3, $4, $5, $6 FROM veld v, product p WHERE v.code = $1 AND p.code = $2
           ON CONFLICT (veld_id, product_id) DO UPDATE
              SET grens_min = EXCLUDED.grens_min, grens_max = EXCLUDED.grens_max,
                  tolerantie = EXCLUDED.tolerantie, tolerantie_soort = EXCLUDED.tolerantie_soort
           RETURNING $2::text AS product, grens_min, grens_max, tolerantie, tolerantie_soort`,
          [req.params.code, req.params.product, req.body.grens_min, req.body.grens_max, req.body.tolerantie, req.body.tolerantie_soort ?? "absoluut"],
        );
        if (!rows[0]) throw niet("Veld of product");
        return rows[0];
      }),
  );

  app.delete(
    "/velden/:code/producten/:product",
    {
      preHandler: vereist(...BEHEER),
      schema: {
        tags: ["beheer"],
        description: "Eigen grenzen voor een product weghalen: daarna gelden de grenzen van het veld.",
        params: VeldProduct,
        response: { 204: Type.Null() },
      },
    },
    async (req, reply) => {
      const n = await inTransactie(app.db, req.user.naam, async (tx) =>
        (await tx.query(
          `DELETE FROM veld_product vp USING veld v, product p
            WHERE vp.veld_id = v.id AND vp.product_id = p.id AND v.code = $1 AND p.code = $2`,
          [req.params.code, req.params.product],
        )).rowCount);
      if (!n) throw niet("Eigen grenzen voor dit product");
      return reply.status(204).send(null);
    },
  );

  // Velden importeren uit het Excel-sjabloon (0.22.0, D46). Eerst altijd een proefronde: alles wordt in een
  // transactie uitgevoerd (dus ook door de databaseregels gecontroleerd) en teruggedraaid. Pas met
  // uitvoeren=true en zonder fouten blijft het staan. Velden die niet in het bestand staan, blijven ongewijzigd.
  const ImportRegel = Type.Object({
    regel: Type.Integer({ description: "Regelnummer in het bestand, voor de meldingen" }),
    stapcode: Type.String(),
    code: Type.Optional(Type.Union([Type.Null(), Type.String()])),
    naam: Type.String(),
    soort: Type.String(),
    eenheid: Type.Optional(Type.Union([Type.Null(), Type.String()])),
    verplicht: Type.Boolean(),
    tolerantie: OptGetal,
    tolerantie_soort: Type.Optional(Type.Union([Type.Null(), Type.String()])),
    grens_min: OptGetal,
    grens_max: OptGetal,
    op_certificaat: Type.Boolean(),
    actief: Type.Boolean(),
    decimalen: Type.Optional(NulGeheel({ minimum: 0, maximum: 6, description: "Aantal decimalen bij het tonen; leeg = automatisch" })),
    gemeten_door: Type.Optional(Type.Union([Type.Null(), Type.String()], { description: "Productie of Kwaliteit (sinds 0.37.0); leeg of zonder kolom = zoals het is" })),
  }, { additionalProperties: false });
  const ImportUitkomst = Type.Object({
    regel: Type.Integer(), stapcode: Type.String(), code: Type.Union([Type.Null(), Type.String()]), naam: Type.String(),
    actie: Type.Union([Type.Literal("nieuw"), Type.Literal("wijzigen"), Type.Literal("gelijk"), Type.Literal("fout")]),
    wijzigingen: Type.Array(Type.String()), fout: Type.Union([Type.Null(), Type.String()]),
  });
  type ImportRij = { regel: number; stapcode: string; code: string | null; naam: string; actie: "nieuw" | "wijzigen" | "gelijk" | "fout"; wijzigingen: string[]; fout: string | null };
  // Tweede blad "Grenzen per product" (0.31.0, D55). Staat het blad in het bestand, dan is het de volledige lijst:
  // eigen grenzen die er niet (meer) in staan, worden weggehaald. Zonder blad (ouder sjabloon) blijven ze staan.
  const GrensRegel = Type.Object({
    regel: Type.Integer(), veld: Type.String(), product: Type.String(),
    grens_min: OptGetal, grens_max: OptGetal, tolerantie: OptGetal,
    tolerantie_soort: Type.Optional(Type.Union([Type.Null(), Type.String()])),
  }, { additionalProperties: false });
  const GrensUitkomst = Type.Object({
    regel: Type.Integer({ description: "0 = staat niet in het bestand (weghalen)" }), veld: Type.String(), product: Type.String(),
    actie: Type.Union(["nieuw", "wijzigen", "gelijk", "weghalen", "fout"].map((a) => Type.Literal(a))),
    wijzigingen: Type.Array(Type.String()), fout: Type.Union([Type.Null(), Type.String()]),
  });
  type GrensRij = { regel: number; veld: string; product: string; actie: "nieuw" | "wijzigen" | "gelijk" | "weghalen" | "fout"; wijzigingen: string[]; fout: string | null };
  class Terugdraaien extends Error { constructor(public rijen: ImportRij[], public grenzen: GrensRij[]) { super("terugdraaien"); } }
  const KOLOMMEN: [string, string][] = [
    ["naam", "naam"], ["eenheid", "eenheid"], ["verplicht", "verplicht"], ["tolerantie", "tolerantie"], ["tolerantie_soort", "tolerantie in"],
    ["grens_min", "ondergrens"], ["grens_max", "bovengrens"], ["decimalen", "decimalen"], ["op_certificaat", "op certificaat"], ["actief", "actief"],
    ["gemeten_door", "gemeten door"],
  ];
  const toonWaarde = (w: unknown) => (w === null || w === undefined || w === "" ? "leeg" : typeof w === "boolean" ? (w ? "ja" : "nee") : String(w).replace(".", ","));

  app.post(
    "/velden/import",
    {
      preHandler: vereist(...BEHEER),
      schema: {
        tags: ["beheer"],
        description:
          "Velden toevoegen en wijzigen vanuit het Excel-sjabloon. uitvoeren=false is een proefronde (niets wordt opgeslagen). " +
          "Met grenzen_per_product (tweede blad, sinds 0.31.0) is dat de volledige lijst eigen grenzen per product: wat er niet in staat, wordt weggehaald.",
        body: Type.Object({
          uitvoeren: Type.Boolean(),
          regels: Type.Array(ImportRegel, { maxItems: 2000 }),
          grenzen_per_product: Type.Optional(Type.Array(GrensRegel, { maxItems: 5000 })),
        }, { additionalProperties: false }),
        response: {
          200: Type.Object({
            uitgevoerd: Type.Boolean(), nieuw: Type.Integer(), gewijzigd: Type.Integer(), gelijk: Type.Integer(), fouten: Type.Integer(), regels: Type.Array(ImportUitkomst),
            grenzen: Type.Optional(Type.Object({
              nieuw: Type.Integer(), gewijzigd: Type.Integer(), gelijk: Type.Integer(), weghalen: Type.Integer(), fouten: Type.Integer(), regels: Type.Array(GrensUitkomst),
            })),
          }),
        },
      },
    },
    async (req) => {
      const { uitvoeren, regels } = req.body;
      const verwerk = async (tx: Tx): Promise<ImportRij[]> => {
        const uit: ImportRij[] = [];
        const gezien = new Set<string>();
        for (const r of regels) {
          const rij: ImportRij = { regel: r.regel, stapcode: r.stapcode, code: r.code?.trim() || null, naam: r.naam, actie: "gelijk", wijzigingen: [], fout: null };
          uit.push(rij);
          await tx.query("SAVEPOINT rij");
          try {
            const soort = r.soort.trim().toLowerCase();
            if (!["procesparameter", "gewicht", "overig"].includes(soort)) throw new ApiFout(422, `Onbekende soort "${r.soort}" (procesparameter, gewicht of overig)`);
            const tsoort = (r.tolerantie_soort ?? "absoluut").trim().toLowerCase() || "absoluut";
            if (!["absoluut", "procent"].includes(tsoort)) throw new ApiFout(422, `Tolerantie in "${r.tolerantie_soort}" is onbekend (absoluut of procent)`);
            if (!r.naam.trim()) throw new ApiFout(422, "Naam ontbreekt");
            const door = r.gemeten_door?.trim().toLowerCase() || undefined;
            if (door !== undefined && !["productie", "kwaliteit"].includes(door)) throw new ApiFout(422, `Gemeten door "${r.gemeten_door}" is onbekend (Productie of Kwaliteit)`);
            const { rows: st } = await tx.query("SELECT id, volgorde FROM processtap WHERE code = $1 FOR UPDATE", [r.stapcode.trim().toUpperCase()]);
            if (!st[0]) throw new ApiFout(422, `Onbekende stap "${r.stapcode}"`);
            const nieuw = {
              naam: r.naam.trim(), eenheid: r.eenheid?.trim() || null, verplicht: r.verplicht, tolerantie: r.tolerantie ?? null,
              tolerantie_soort: tsoort, grens_min: r.grens_min ?? null, grens_max: r.grens_max ?? null, op_certificaat: r.op_certificaat, actief: r.actief,
              // Zonder kolom Decimalen (sjabloon van vóór 0.23.0) blijft de instelling zoals hij is.
              decimalen: r.decimalen,
              // Zonder kolom Gemeten door (sjabloon van vóór 0.37.0) blijft het zoals het is.
              gemeten_door: door,
            };
            if (rij.code) {
              if (gezien.has(rij.code)) throw new ApiFout(422, `${rij.code} staat twee keer in het bestand`);
              gezien.add(rij.code);
              const { rows: v } = await tx.query(
                `SELECT v.*, s.code AS stapcode FROM veld v JOIN processtap s ON s.id = v.processtap_id WHERE v.code = $1`, [rij.code]);
              if (!v[0]) throw new ApiFout(422, `Veld ${rij.code} bestaat niet; laat de code leeg voor een nieuw veld`);
              if (v[0].stapcode !== r.stapcode.trim().toUpperCase()) throw new ApiFout(422, `${rij.code} hoort bij ${v[0].stapcode}; een veld verhuist niet naar een andere stap`);
              if (v[0].soort !== soort) throw new ApiFout(422, `De soort van ${rij.code} is ${v[0].soort}; die verandert niet (maak een nieuw veld)`);
              const anders = KOLOMMEN.filter(([k]) => {
                if (k === "decimalen" && nieuw.decimalen === undefined) return false;
                if (k === "gemeten_door" && nieuw.gemeten_door === undefined) return false;
                const a = (v[0] as Record<string, unknown>)[k], b = (nieuw as Record<string, unknown>)[k];
                return typeof a === "number" || typeof b === "number" ? (a === null ? null : Number(a)) !== (b === null ? null : Number(b)) : (a ?? null) !== (b ?? null);
              });
              if (anders.length) {
                rij.actie = "wijzigen";
                rij.wijzigingen = anders.map(([k, label]) => `${label}: ${toonWaarde((v[0] as Record<string, unknown>)[k])} → ${toonWaarde((nieuw as Record<string, unknown>)[k])}`);
                const set = anders.map(([k], i) => `${k} = $${i + 2}`).join(", ");
                await tx.query(`UPDATE veld SET ${set} WHERE code = $1`, [rij.code, ...anders.map(([k]) => (nieuw as Record<string, unknown>)[k])]);
              }
            } else {
              const { rows: m } = await tx.query(
                `SELECT coalesce(max(split_part(code, '.', 2)::int), 0) + 1 AS nr, coalesce(max(volgnummer), 0) + 1 AS volg FROM veld WHERE processtap_id = $1`,
                [st[0].id]);
              rij.code = `S${st[0].volgorde}.${m[0].nr}`;
              rij.actie = "nieuw";
              await tx.query(
                `INSERT INTO veld (processtap_id, code, naam, soort, eenheid, grens_min, grens_max, tolerantie, tolerantie_soort, volgnummer, verplicht, op_certificaat, actief, decimalen, gemeten_door)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,coalesce($15,'productie'))`,
                [st[0].id, rij.code, nieuw.naam, soort, nieuw.eenheid, nieuw.grens_min, nieuw.grens_max, nieuw.tolerantie, nieuw.tolerantie_soort,
                  m[0].volg, nieuw.verplicht, nieuw.op_certificaat, nieuw.actief, nieuw.decimalen ?? null, nieuw.gemeten_door ?? null]);
            }
            await tx.query("RELEASE SAVEPOINT rij");
          } catch (e) {
            await tx.query("ROLLBACK TO SAVEPOINT rij");
            rij.actie = "fout";
            rij.wijzigingen = [];
            rij.fout = leesbaar(e);
          }
        }
        return uit;
      };
      // Na de velden, zodat een in hetzelfde bestand gewijzigd veld al zijn nieuwe soort en naam heeft.
      const verwerkGrenzen = async (tx: Tx): Promise<GrensRij[]> => {
        const lijst = req.body.grenzen_per_product;
        if (!lijst) return [];
        const uit: GrensRij[] = [];
        const gezien = new Set<string>();
        for (const r of lijst) {
          const veld = r.veld.trim().toUpperCase(), product = r.product.trim().toUpperCase();
          const rij: GrensRij = { regel: r.regel, veld, product, actie: "gelijk", wijzigingen: [], fout: null };
          uit.push(rij);
          await tx.query("SAVEPOINT grens");
          try {
            const sleutel = `${veld}|${product}`;
            if (gezien.has(sleutel)) throw new ApiFout(422, `${veld} voor ${product} staat twee keer in het blad`);
            gezien.add(sleutel);
            const tsoort = (r.tolerantie_soort ?? "absoluut").trim().toLowerCase() || "absoluut";
            if (!["absoluut", "procent"].includes(tsoort)) throw new ApiFout(422, `Tolerantie in "${r.tolerantie_soort}" is onbekend (absoluut of procent)`);
            const { rows: v } = await tx.query("SELECT id FROM veld WHERE code = $1", [veld]);
            if (!v[0]) throw new ApiFout(422, `Veld ${veld} bestaat niet. Een nieuw veld krijgt pas bij opslaan een code: sla eerst de velden op en lees het bestand daarna opnieuw in`);
            const { rows: p } = await tx.query("SELECT id FROM product WHERE upper(code) = $1", [product]);
            if (!p[0]) throw new ApiFout(422, `Onbekend product ${product}; voeg het eerst toe in Planning → Producten`);
            const nieuw = { grens_min: r.grens_min ?? null, grens_max: r.grens_max ?? null, tolerantie: r.tolerantie ?? null, tolerantie_soort: tsoort };
            const { rows: oud } = await tx.query(
              "SELECT grens_min::float, grens_max::float, tolerantie::float, tolerantie_soort FROM veld_product WHERE veld_id = $1 AND product_id = $2",
              [v[0].id, p[0].id]);
            const labels: [keyof typeof nieuw, string][] = [["grens_min", "ondergrens"], ["grens_max", "bovengrens"], ["tolerantie", "tolerantie"], ["tolerantie_soort", "tolerantie in"]];
            if (!oud[0]) rij.actie = "nieuw";
            else {
              const anders = labels.filter(([k]) => (k === "tolerantie_soort" && nieuw.tolerantie === null && oud[0].tolerantie === null ? false : (oud[0][k] ?? null) !== (nieuw[k] ?? null)));
              if (anders.length) {
                rij.actie = "wijzigen";
                rij.wijzigingen = anders.map(([k, label]) => `${label}: ${toonWaarde(oud[0][k])} → ${toonWaarde(nieuw[k])}`);
              }
            }
            if (rij.actie !== "gelijk") {
              await tx.query(
                `INSERT INTO veld_product (veld_id, product_id, grens_min, grens_max, tolerantie, tolerantie_soort) VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (veld_id, product_id) DO UPDATE SET grens_min = EXCLUDED.grens_min, grens_max = EXCLUDED.grens_max,
                   tolerantie = EXCLUDED.tolerantie, tolerantie_soort = EXCLUDED.tolerantie_soort`,
                [v[0].id, p[0].id, nieuw.grens_min, nieuw.grens_max, nieuw.tolerantie, nieuw.tolerantie_soort]);
            }
            await tx.query("RELEASE SAVEPOINT grens");
          } catch (e) {
            await tx.query("ROLLBACK TO SAVEPOINT grens");
            rij.actie = "fout";
            rij.wijzigingen = [];
            rij.fout = leesbaar(e);
          }
        }
        // Wat niet in het blad staat, gaat weg (het blad is de volledige lijst).
        const { rows: weg } = await tx.query(
          `DELETE FROM veld_product vp USING veld v, product p
            WHERE vp.veld_id = v.id AND vp.product_id = p.id AND NOT ((v.code || '|' || upper(p.code)) = ANY($1::text[]))
          RETURNING v.code AS veld, p.code AS product`,
          [[...gezien]]);
        for (const w of weg) uit.push({ regel: 0, veld: w.veld, product: w.product, actie: "weghalen", wijzigingen: ["eigen grenzen weg; daarna gelden die van het veld"], fout: null });
        return uit;
      };
      let rijen: ImportRij[];
      let grenzen: GrensRij[];
      try {
        [rijen, grenzen] = await inTransactie(app.db, req.user.naam, async (tx) => {
          const uit = await verwerk(tx);
          const gr = await verwerkGrenzen(tx);
          if (!uitvoeren || uit.some((x) => x.actie === "fout") || gr.some((x) => x.actie === "fout")) throw new Terugdraaien(uit, gr);
          return [uit, gr] as const;
        });
      } catch (e) {
        if (!(e instanceof Terugdraaien)) throw e;
        rijen = e.rijen;
        grenzen = e.grenzen;
      }
      const tel = (a: ImportRij["actie"]) => rijen.filter((x) => x.actie === a).length;
      const telG = (a: GrensRij["actie"]) => grenzen.filter((x) => x.actie === a).length;
      return {
        uitgevoerd: uitvoeren && tel("fout") === 0 && telG("fout") === 0,
        nieuw: tel("nieuw"), gewijzigd: tel("wijzigen"), gelijk: tel("gelijk"), fouten: tel("fout"), regels: rijen,
        ...(req.body.grenzen_per_product
          ? { grenzen: { nieuw: telG("nieuw"), gewijzigd: telG("wijzigen"), gelijk: telG("gelijk"), weghalen: telG("weghalen"), fouten: telG("fout"), regels: grenzen } }
          : {}),
      } as never;
    },
  );

  app.get(
    "/logboek",
    {
      preHandler: vereist(...BEHEER),
      schema: {
        tags: ["beheer"],
        description: "Alle wijzigingen in de configuratie, nieuwste eerst. Wachtwoorden staan er nooit in; alleen dat ze gewijzigd zijn.",
        querystring: Type.Object({
          tabel: Type.Optional(Type.Union(["processtap", "veld", "gebruiker", "operator", "pc", "pc_stap", "nalevering"].map((t) => Type.Literal(t)))),
          limiet: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, default: 100 })),
        }),
        response: {
          200: Type.Array(
            Type.Object({
              tabel: Type.String(),
              actie: Type.String(),
              oud: Type.Unknown(),
              nieuw: Type.Unknown(),
              extra: Type.Unknown(),
              gewijzigd_door: Type.String(),
              gewijzigd_op: Type.String({ format: "date-time" }),
            }),
          ),
        },
      },
    },
    async (req) =>
      lees(
        app.db,
        `SELECT c.tabel, c.actie, c.oud, c.nieuw, c.gewijzigd_door, c.gewijzigd_op,
                CASE WHEN c.tabel = 'pc_stap' THEN jsonb_build_object(
                       'pc', (SELECT naam FROM pc WHERE id = c.record_id),
                       'stap', (SELECT code FROM processtap WHERE id = (coalesce(c.nieuw, c.oud) ->> 'processtap_id')::uuid))
                     WHEN c.tabel = 'veld' THEN jsonb_build_object(
                       'stap', (SELECT code FROM processtap WHERE id = (coalesce(c.nieuw, c.oud) ->> 'processtap_id')::uuid)) END AS extra
           FROM config_log c
          WHERE $1::text IS NULL OR c.tabel = $1
          ORDER BY c.id DESC LIMIT $2`,
        [req.query.tabel ?? null, req.query.limiet ?? 100],
      ) as never,
  );

  // ---------- Stappen ----------
  // Alleen de naam is aan te passen; volgorde, niveau en de lot-stap liggen vast in het proces.
  app.patch(
    "/stappen/:code",
    {
      preHandler: vereist(...BEHEER),
      schema: {
        tags: ["beheer"],
        params: Type.Object({ code: StapCode }),
        body: Type.Object({ naam: Type.String({ minLength: 1, maxLength: 60 }) }, { additionalProperties: false }),
        response: { 200: Type.Object({ code: Type.String(), naam: Type.String() }) },
      },
    },
    async (req) => {
      const r = await inTransactie(app.db, req.user.naam, (tx) =>
        tx.query("UPDATE processtap SET naam = $2 WHERE code = $1 RETURNING code, naam", [req.params.code, req.body.naam.trim()]));
      if (!r.rows[0]) throw niet("Stap");
      return r.rows[0];
    },
  );

  // ---------- Accounts ----------
  const Rol = Type.Union(["operator", "ploegleider", "kwaliteit", "beheerder", "analist", "planner", "scherm", "productiemanager"].map((r) => Type.Literal(r)));
  const Account = Type.Object({
    gebruikersnaam: Type.String(), rol: Type.String(), actief: Type.Boolean(),
    naam: Type.Optional(Type.Union([Type.Null(), Type.String()], { description: "Naam bij de invoer (operator en ploegleider, D53)" })),
    gedeeld: Type.Optional(Type.Boolean({ description: "Het oude gedeelde operatoraccount: kiest een naam (D6); uitzetten zodra iedereen een eigen account heeft" })),
    tijdelijk: Type.Optional(Type.Boolean({ description: "Het wachtwoord is tijdelijk: de gebruiker kiest bij de volgende inlog een eigen wachtwoord (#76)" })),
    ploeg: Type.Optional(Type.Union([Type.Null(), Type.String()], { description: "Ploeg van de medewerker, zoals A1 (sinds 0.54.0, #87)" })),
  });
  const ACCOUNT_SQL = `SELECT g.gebruikersnaam, g.rol, g.actief, g.gedeeld, o.naam, g.wachtwoord_wijzigen AS tijdelijk, rp.code AS ploeg
                         FROM gebruiker g LEFT JOIN operator o ON o.gebruiker_id = g.id LEFT JOIN rooster_ploeg rp ON rp.id = o.ploeg_id`;
  const PloegCode = Type.Union([Type.Null(), Type.String({ pattern: "^[A-Za-z][1-9]$" })], { description: "Ploeg zoals A1 (letter en divisie, D76); null = geen ploeg" });
  /** Zet de ploeg van een medewerker; een onbekende ploeg is een fout. */
  async function zetPloeg(tx: Tx, operatorId: string, ploeg: string | null) {
    const r = await tx.query(
      "UPDATE operator SET ploeg_id = (SELECT id FROM rooster_ploeg WHERE code = upper($2)) WHERE id = $1 RETURNING ploeg_id", [operatorId, ploeg]);
    if (ploeg !== null && !r.rows[0]?.ploeg_id) throw new ApiFout(422, `Onbekende ploeg ${ploeg}; de ploegen staan bij Beheer, Diensten en ploegen`);
  }
  const Wachtwoord = Type.String({ minLength: 8, description: "Minstens 8 tekens" });

  app.get(
    "/gebruikers",
    { preHandler: vereist(...BEHEER), schema: { tags: ["beheer"], response: { 200: Type.Array(Account) } } },
    async () => (await lees(app.db, `${ACCOUNT_SQL} ORDER BY g.actief DESC, g.rol, g.gebruikersnaam`)) as never,
  );

  app.post(
    "/gebruikers",
    {
      preHandler: vereist(...BEHEER),
      schema: {
        tags: ["beheer"],
        body: Type.Object({
          gebruikersnaam: Type.String({ pattern: "^[a-z0-9._-]{3,40}$", description: "Kleine letters, cijfers, punt, streepje; 3 tot 40 tekens" }),
          rol: Rol,
          wachtwoord: Wachtwoord,
          naam: Type.Optional(Type.String({ minLength: 1, maxLength: 60, description: "Operator en ploegleider: nieuwe naam bij de invoer (leeg = de gebruikersnaam)" })),
          bestaandeNaam: Type.Optional(Type.String({ format: "uuid", description: "Operator en ploegleider: koppel aan een bestaande naam zonder account, zodat de geschiedenis doorloopt" })),
          ploeg: Type.Optional(PloegCode),
        }, { additionalProperties: false }),
        response: { 201: Account },
      },
    },
    async (req, reply) => {
      const { gebruikersnaam, rol, wachtwoord, naam, bestaandeNaam, ploeg } = req.body;
      // Kwaliteit heeft ook een naam bij de invoer (D58); een eigen naam kiezen kan sinds 0.54.0 ook voor Kwaliteit (#87).
      const invoer = rol === "operator" || rol === "ploegleider" || rol === "kwaliteit";
      const r = await inTransactie(app.db, req.user.naam, async (tx) => {
        const { rows: [g] } = await tx.query<{ id: string }>(
          // Een wachtwoord van de beheerder is tijdelijk (#76, D61); niet voor een wandscherm (daar typt niemand).
          "INSERT INTO gebruiker (gebruikersnaam, rol, wachtwoord_hash, wachtwoord_wijzigen) VALUES ($1, $2, wachtwoord_hash($3), $2 <> 'scherm') RETURNING id",
          [gebruikersnaam, rol, wachtwoord]);
        if (invoer && bestaandeNaam) {
          const k = await tx.query("UPDATE operator SET gebruiker_id = $1, actief = true WHERE id = $2 AND gebruiker_id IS NULL", [g.id, bestaandeNaam]);
          if (!k.rowCount) throw new ApiFout(422, "Deze naam bestaat niet of hoort al bij een ander account");
        } else if (invoer && naam) {
          await tx.query("INSERT INTO operator (naam, gebruiker_id) VALUES ($1, $2)", [naam.trim(), g.id]);
        }
        if (ploeg) {
          if (!invoer) throw new ApiFout(422, "Een ploeg hoort alleen bij operator, ploegleider of kwaliteit");
          const { rows: [o] } = await tx.query<{ id: string }>("SELECT operator_van_account($1) AS id", [g.id]);
          await zetPloeg(tx, o.id, ploeg);
        }
        return tx.query(`${ACCOUNT_SQL} WHERE g.id = $1`, [g.id]);
      });
      return reply.status(201).send(r.rows[0]);
    },
  );

  app.patch(
    "/gebruikers/:gebruikersnaam",
    {
      preHandler: vereist(...BEHEER),
      schema: {
        tags: ["beheer"],
        params: Type.Object({ gebruikersnaam: Type.String() }),
        body: Type.Object({ rol: Type.Optional(Rol), actief: Type.Optional(Type.Boolean()), wachtwoord: Type.Optional(Wachtwoord), ploeg: Type.Optional(PloegCode) },
          { additionalProperties: false, minProperties: 1 }),
        response: { 200: Account },
      },
    },
    async (req) => {
      const { rol, actief, wachtwoord, ploeg } = req.body;
      if (req.params.gebruikersnaam === req.user.naam && (actief === false || (rol && rol !== "beheerder"))) {
        throw new ApiFout(422, "Je kunt je eigen beheerdersaccount niet uitzetten of een andere rol geven");
      }
      const r = await inTransactie(app.db, req.user.naam, (tx) =>
        tx.query(
          `UPDATE gebruiker SET rol = coalesce($2, rol), actief = coalesce($3, actief),
                  wachtwoord_hash = CASE WHEN $4::text IS NULL THEN wachtwoord_hash ELSE wachtwoord_hash($4) END,
                  wachtwoord_wijzigen = CASE WHEN $4::text IS NULL THEN wachtwoord_wijzigen ELSE coalesce($2, rol) <> 'scherm' END
            WHERE gebruikersnaam = $1 RETURNING id, gebruikersnaam`,
          [req.params.gebruikersnaam, rol ?? null, actief ?? null, wachtwoord ?? null]).then(async (u) => {
          // De ploeg hoort bij de naam bij de invoer; die wordt zo nodig aangemaakt, zoals bij de eerste inlog (D53).
          if (u.rows[0] && ploeg !== undefined) {
            const { rows: [o] } = await tx.query<{ id: string | null }>("SELECT operator_van_account($1) AS id", [u.rows[0].id]);
            if (!o.id) throw new ApiFout(422, "Een ploeg hoort alleen bij een actief account van een operator, ploegleider of kwaliteit");
            await zetPloeg(tx, o.id, ploeg);
          }
          return u;
        }));
      if (!r.rows[0]) throw niet("Account");
      return (await lees(app.db, `${ACCOUNT_SQL} WHERE g.gebruikersnaam = $1`, [req.params.gebruikersnaam]))[0] as never;
    },
  );

  // ---------- Operators (namenlijst op het invoerscherm) ----------
  const Operator = Type.Object({
    id: Type.String({ format: "uuid" }), naam: Type.String(), actief: Type.Boolean(),
    account: Type.Optional(Type.Union([Type.Null(), Type.String()], { description: "Gebruikersnaam van het eigen account (D53); leeg = alleen een naam" })),
    rol: Type.Optional(Type.Union([Type.Null(), Type.String()], { description: "Rol van het eigen account (sinds 0.54.0)" })),
    ploeg: Type.Optional(Type.Union([Type.Null(), Type.String()], { description: "Ploeg, zoals A1 (sinds 0.54.0, #87)" })),
  });
  const OPERATOR_SQL = `SELECT o.id, o.naam, o.actief, g.gebruikersnaam AS account, g.rol, rp.code AS ploeg
                          FROM operator o LEFT JOIN gebruiker g ON g.id = o.gebruiker_id LEFT JOIN rooster_ploeg rp ON rp.id = o.ploeg_id`;
  app.get(
    "/operators",
    { preHandler: vereist(...BEHEER), schema: { tags: ["beheer"], response: { 200: Type.Array(Operator) } } },
    async () => (await lees(app.db, `${OPERATOR_SQL} ORDER BY o.actief DESC, o.naam`)) as never,
  );
  app.post(
    "/operators",
    {
      preHandler: vereist(...BEHEER),
      schema: { tags: ["beheer"], body: Type.Object({ naam: Type.String({ minLength: 1, maxLength: 60 }), ploeg: Type.Optional(PloegCode) }, { additionalProperties: false }), response: { 201: Operator } },
    },
    async (req, reply) => {
      const r = await inTransactie(app.db, req.user.naam, async (tx) => {
        const { rows: [o] } = await tx.query<{ id: string }>("INSERT INTO operator (naam) VALUES ($1) RETURNING id", [req.body.naam.trim()]);
        if (req.body.ploeg) await zetPloeg(tx, o.id, req.body.ploeg);
        return tx.query(`${OPERATOR_SQL} WHERE o.id = $1`, [o.id]);
      });
      return reply.status(201).send(r.rows[0]);
    },
  );
  app.patch(
    "/operators/:id",
    {
      preHandler: vereist(...BEHEER),
      schema: {
        tags: ["beheer"],
        params: Type.Object({ id: Type.String({ format: "uuid" }) }),
        body: Type.Object({ naam: Type.Optional(Type.String({ minLength: 1, maxLength: 60 })), actief: Type.Optional(Type.Boolean()), ploeg: Type.Optional(PloegCode) },
          { additionalProperties: false, minProperties: 1 }),
        response: { 200: Operator },
      },
    },
    async (req) => {
      const r = await inTransactie(app.db, req.user.naam, async (tx) => {
        const u = await tx.query("UPDATE operator SET naam = coalesce($2, naam), actief = coalesce($3, actief) WHERE id = $1 RETURNING id",
          [req.params.id, req.body.naam?.trim() ?? null, req.body.actief ?? null]);
        if (!u.rows[0]) throw niet("Operator");
        if (req.body.ploeg !== undefined) await zetPloeg(tx, req.params.id, req.body.ploeg);
        return tx.query(`${OPERATOR_SQL} WHERE o.id = $1`, [req.params.id]);
      });
      return r.rows[0];
    },
  );

  // ---------- Grondstoffen en in welke stap ze worden ingevoerd ----------
  const Grondstof = Type.Object({
    id: Type.String(),
    code: Type.String(),
    naam: Type.String(),
    eenheid: Type.Union([Type.Null(), Type.String()]),
    actief: Type.Boolean(),
    stappen: Type.Array(Type.Object({ stap: Type.String(), verplicht: Type.Boolean() })),
  });
  const GRONDSTOF_SQL = `SELECT g.id::text, g.code, g.naam, g.eenheid, g.actief,
           coalesce((SELECT json_agg(json_build_object('stap', s.code, 'verplicht', x.verplicht) ORDER BY s.volgorde)
                       FROM stap_grondstof x JOIN processtap s ON s.id = x.processtap_id
                      WHERE x.grondstof_id = g.id AND x.actief), '[]') AS stappen
      FROM grondstof g`;
  app.get(
    "/grondstoffen",
    { preHandler: vereist(...BEHEER), schema: { tags: ["beheer"], response: { 200: Type.Array(Grondstof) } } },
    async () => (await lees(app.db, `${GRONDSTOF_SQL} ORDER BY g.actief DESC, g.code`)) as never,
  );
  app.post(
    "/grondstoffen",
    {
      preHandler: vereist(...BEHEER),
      schema: {
        tags: ["beheer"],
        body: Type.Object({
          code: Type.String({ pattern: "^[A-Za-z0-9._-]{1,20}$" }),
          naam: Type.String({ minLength: 1, maxLength: 100 }),
          eenheid: Type.Optional(Type.Union([Type.Null(), Type.String({ maxLength: 20 })])),
        }, { additionalProperties: false }),
        response: { 201: Grondstof },
      },
    },
    async (req, reply) => {
      const id = await inTransactie(app.db, req.user.naam, async (tx) =>
        (await tx.query("INSERT INTO grondstof (code, naam, eenheid) VALUES ($1, $2, $3) RETURNING id",
          [req.body.code.trim(), req.body.naam.trim(), req.body.eenheid?.trim() || null])).rows[0].id);
      const [g] = await lees(app.db, `${GRONDSTOF_SQL} WHERE g.id = $1`, [id]);
      return reply.status(201).send(g as never);
    },
  );
  app.patch(
    "/grondstoffen/:code",
    {
      preHandler: vereist(...BEHEER),
      schema: {
        tags: ["beheer"],
        description: "Naam, eenheid of actief wijzigen, en/of de stappen waarin de grondstof wordt ingevoerd (vervangt de lijst).",
        params: Type.Object({ code: Type.String() }),
        body: Type.Object({
          naam: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
          eenheid: Type.Optional(Type.Union([Type.Null(), Type.String({ maxLength: 20 })])),
          actief: Type.Optional(Type.Boolean()),
          stappen: Type.Optional(Type.Array(Type.Object({ stap: Type.String(), verplicht: Type.Boolean() }))),
        }, { additionalProperties: false, minProperties: 1 }),
        response: { 200: Grondstof },
      },
    },
    async (req) => {
      await inTransactie(app.db, req.user.naam, async (tx) => {
        const { rows } = await tx.query(
          `UPDATE grondstof SET naam = coalesce($2, naam), eenheid = CASE WHEN $4 THEN $3 ELSE eenheid END, actief = coalesce($5, actief)
            WHERE code = $1 RETURNING id`,
          [req.params.code, req.body.naam?.trim() ?? null, req.body.eenheid?.trim() || null, req.body.eenheid !== undefined, req.body.actief ?? null],
        );
        if (!rows[0]) throw niet("Grondstof");
        if (req.body.stappen) {
          const gid = rows[0].id;
          const nieuw = new Map(req.body.stappen.map((s) => [s.stap, s.verplicht]));
          const { rows: stappen } = await tx.query("SELECT id, code FROM processtap WHERE code = ANY($1)", [[...nieuw.keys()]]);
          if (stappen.length !== nieuw.size) throw new ApiFout(422, "Onbekende stap in de lijst");
          // Niets verwijderen: koppelingen gaan uit of aan.
          await tx.query("UPDATE stap_grondstof SET actief = false WHERE grondstof_id = $1 AND actief AND processtap_id <> ALL($2)",
            [gid, stappen.map((s) => s.id)]);
          for (const s of stappen) {
            await tx.query(
              `INSERT INTO stap_grondstof (processtap_id, grondstof_id, verplicht) VALUES ($1, $2, $3)
               ON CONFLICT (processtap_id, grondstof_id) DO UPDATE SET verplicht = EXCLUDED.verplicht, actief = true
               WHERE stap_grondstof.verplicht IS DISTINCT FROM EXCLUDED.verplicht OR NOT stap_grondstof.actief`,
              [s.id, gid, nieuw.get(s.code)],
            );
          }
        }
      });
      const [g] = await lees(app.db, `${GRONDSTOF_SQL} WHERE g.code = $1`, [req.params.code]);
      return g as never;
    },
  );

  // ---------- Pc's en welke stappen ze bedienen ----------
  const Pc = Type.Object({
    naam: Type.String(),
    locatie: Type.Union([Type.Null(), Type.String()]),
    actief: Type.Boolean(),
    stappen: Type.Array(Type.String(), { description: "Leeg = alle stappen" }),
  });
  const PC_SQL = `SELECT p.naam, p.locatie, p.actief,
                         coalesce(array_agg(s.code ORDER BY s.volgorde) FILTER (WHERE s.id IS NOT NULL), '{}') AS stappen
                    FROM pc p LEFT JOIN pc_stap ps ON ps.pc_id = p.id LEFT JOIN processtap s ON s.id = ps.processtap_id`;
  app.get(
    "/pcs",
    { preHandler: vereist(...BEHEER), schema: { tags: ["beheer"], response: { 200: Type.Array(Pc) } } },
    async () => (await lees(app.db, `${PC_SQL} GROUP BY p.id ORDER BY p.naam`)) as never,
  );
  app.post(
    "/pcs",
    {
      preHandler: vereist(...BEHEER),
      schema: {
        tags: ["beheer"],
        body: Type.Object({ naam: Type.String({ pattern: "^[A-Za-z0-9-]{2,20}$", examples: ["PC-21"] }), locatie: Type.Optional(Type.String()) }, { additionalProperties: false }),
        response: { 201: Pc },
      },
    },
    async (req, reply) => {
      await inTransactie(app.db, req.user.naam, (tx) =>
        tx.query("INSERT INTO pc (naam, locatie) VALUES ($1, $2)", [req.body.naam.toUpperCase(), req.body.locatie ?? null]));
      const [pc] = await lees(app.db, `${PC_SQL} WHERE p.naam = $1 GROUP BY p.id`, [req.body.naam.toUpperCase()]);
      return reply.status(201).send(pc as never);
    },
  );
  app.patch(
    "/pcs/:naam",
    {
      preHandler: vereist(...BEHEER),
      schema: {
        tags: ["beheer"],
        params: Type.Object({ naam: Type.String() }),
        body: Type.Object({
          locatie: Type.Optional(Type.Union([Type.Null(), Type.String()])),
          actief: Type.Optional(Type.Boolean()),
          stappen: Type.Optional(Type.Array(StapCode, { description: "Vervangt de koppeling; leeg = alle stappen" })),
        }, { additionalProperties: false, minProperties: 1 }),
        response: { 200: Pc },
      },
    },
    async (req) => {
      await inTransactie(app.db, req.user.naam, async (tx) => {
        const { rows } = await tx.query("SELECT id FROM pc WHERE naam = $1", [req.params.naam]);
        if (!rows[0]) throw niet("Pc");
        const id = rows[0].id;
        if ("locatie" in req.body || req.body.actief !== undefined) {
          await tx.query("UPDATE pc SET locatie = CASE WHEN $2 THEN $3 ELSE locatie END, actief = coalesce($4, actief) WHERE id = $1",
            [id, "locatie" in req.body, req.body.locatie ?? null, req.body.actief ?? null]);
        }
        if (req.body.stappen) {
          const gewenst = new Set(req.body.stappen);
          const { rows: bekend } = await tx.query("SELECT id, code FROM processtap WHERE code = ANY($1)", [[...gewenst]]);
          if (bekend.length !== gewenst.size) throw new ApiFout(422, "Onbekende stap in de lijst");
          const { rows: nu } = await tx.query("SELECT processtap_id FROM pc_stap WHERE pc_id = $1", [id]);
          const nuSet = new Set(nu.map((r) => r.processtap_id as string));
          const wilSet = new Set(bekend.map((r) => r.id as string));
          for (const weg of [...nuSet].filter((x) => !wilSet.has(x))) await tx.query("DELETE FROM pc_stap WHERE pc_id = $1 AND processtap_id = $2", [id, weg]);
          for (const erbij of [...wilSet].filter((x) => !nuSet.has(x))) await tx.query("INSERT INTO pc_stap (pc_id, processtap_id) VALUES ($1, $2)", [id, erbij]);
        }
      });
      const [pc] = await lees(app.db, `${PC_SQL} WHERE p.naam = $1 GROUP BY p.id`, [req.params.naam]);
      return pc as never;
    },
  );

  // Serveroverzicht: versie, database, back-ups en hersteltests (versie 0.6.0).
  const Onderhoud = Type.Object({
    soort: Type.String(),
    gestart_op: Type.String({ format: "date-time" }),
    klaar_op: Type.String({ format: "date-time" }),
    gelukt: Type.Boolean(),
    bestand: Type.Union([Type.Null(), Type.String()]),
    grootte_bytes: NulGetal(),
    versie: Type.Union([Type.Null(), Type.String()]),
    melding: Type.Union([Type.Null(), Type.String()]),
  });
  app.get(
    "/server",
    {
      preHandler: vereist(...BEHEER),
      schema: {
        tags: ["beheer"],
        description:
          "Stand van de server: applicatie- en schemaversie, database, laatste back-up en hersteltest, en waarschuwingen (back-up ouder dan 2 uur of mislukt, hersteltest ouder dan 35 dagen of mislukt).",
        response: {
          200: Type.Object({
            versie: Type.String(),
            node: Type.String(),
            servertijd: Type.String({ format: "date-time" }),
            schema: Type.Union([Type.Null(), Type.Object({ nummer: Type.Integer(), naam: Type.String(), uitgevoerd_op: Type.String({ format: "date-time" }) })]),
            database: Type.Object({ naam: Type.String(), grootte_bytes: Type.Number(), postgres: Type.String() }),
            laatsteBackup: Type.Union([Type.Null(), Onderhoud]),
            laatsteHersteltest: Type.Union([Type.Null(), Onderhoud]),
            recent: Type.Array(Onderhoud),
            waarschuwingen: Type.Array(Type.Object({ niveau: Type.Union([Type.Literal("let_op"), Type.Literal("fout")]), tekst: Type.String() })),
            testaccounts: Type.Array(Type.String(), { description: "Actieve testaccounts met wachtwoord demo (sinds 0.22.1); hoort leeg te zijn in een echte installatie" }),
          }),
        },
      },
    },
    async () => {
      const [db] = await lees<{ naam: string; grootte_bytes: number; postgres: string }>(
        app.db,
        "SELECT current_database() AS naam, pg_database_size(current_database())::float8 AS grootte_bytes, current_setting('server_version') AS postgres",
      );
      const [schema] = await lees<{ nummer: number; naam: string; uitgevoerd_op: Date }>(
        app.db,
        "SELECT nummer, naam, uitgevoerd_op FROM schema_versie ORDER BY nummer DESC LIMIT 1",
      );
      const recent = await lees<Record<string, unknown> & { soort: string; gelukt: boolean; klaar_op: Date }>(
        app.db,
        "SELECT soort, gestart_op, klaar_op, gelukt, bestand, grootte_bytes::float8 AS grootte_bytes, versie, melding FROM onderhoud_log ORDER BY klaar_op DESC, id DESC LIMIT 15",
      );
      const [laatsteBackup] = await lees<{ gelukt: boolean; klaar_op: Date }>(
        app.db,
        "SELECT soort, gestart_op, klaar_op, gelukt, bestand, grootte_bytes::float8 AS grootte_bytes, versie, melding FROM onderhoud_log WHERE soort = 'backup' ORDER BY klaar_op DESC, id DESC LIMIT 1",
      );
      const [laatsteHersteltest] = await lees<{ gelukt: boolean; klaar_op: Date }>(
        app.db,
        "SELECT soort, gestart_op, klaar_op, gelukt, bestand, grootte_bytes::float8 AS grootte_bytes, versie, melding FROM onderhoud_log WHERE soort = 'hersteltest' ORDER BY klaar_op DESC, id DESC LIMIT 1",
      );
      const nu = Date.now();
      // Op een laptop (proof of concept) is er een back-up bij elke start en geen maandelijkse hersteltest.
      const laptop = typeof process !== "undefined" && process.env?.BATCHGUI_OMGEVING === "laptop";
      const maxUren = laptop ? 7 * 24 : 2;
      const uren = (d: Date) => (nu - new Date(d).getTime()) / 3600e3;
      const waarschuwingen: { niveau: "let_op" | "fout"; tekst: string }[] = [];
      if (!laatsteBackup)
        waarschuwingen.push(
          laptop
            ? { niveau: "let_op", tekst: "Er is nog geen back-up; de eerste wordt gemaakt bij de volgende start." }
            : { niveau: "fout", tekst: "Er is nog nooit een back-up gemaakt." },
        );
      else if (!laatsteBackup.gelukt) waarschuwingen.push({ niveau: "fout", tekst: "De laatste back-up is mislukt." });
      else if (uren(laatsteBackup.klaar_op) > maxUren)
        waarschuwingen.push({
          niveau: laptop ? "let_op" : "fout",
          tekst: laptop
            ? `De laatste back-up is ${Math.floor(uren(laatsteBackup.klaar_op) / 24)} dagen oud; start de applicatie opnieuw voor een nieuwe back-up.`
            : `De laatste back-up is ${Math.floor(uren(laatsteBackup.klaar_op))} uur oud; verwacht elk uur.`,
        });
      if (laptop) {
        // geen hersteltest op de laptop
      } else if (!laatsteHersteltest) waarschuwingen.push({ niveau: "let_op", tekst: "Er is nog geen hersteltest gedaan." });
      else if (!laatsteHersteltest.gelukt) waarschuwingen.push({ niveau: "fout", tekst: "De laatste hersteltest is mislukt." });
      else if (uren(laatsteHersteltest.klaar_op) > 35 * 24)
        waarschuwingen.push({ niveau: "let_op", tekst: `De laatste hersteltest is ${Math.floor(uren(laatsteHersteltest.klaar_op) / 24)} dagen oud; verwacht elke maand.` });
      // Veel mislukte inlogpogingen: iemand probeert wachtwoorden, of een account zit vast (D45).
      const [pogingen] = await lees<{ n: number; namen: string | null }>(
        app.db,
        `SELECT count(*)::int AS n, string_agg(DISTINCT gebruikersnaam, ', ') AS namen FROM inlogpoging
          WHERE uitkomst <> 'gelukt' AND op > now() - interval '24 hours'`,
      );
      // Testaccounts met wachtwoord "demo" horen niet in een echte installatie (D28).
      const demo = await lees<{ gebruikersnaam: string }>(
        app.db,
        `SELECT gebruikersnaam FROM gebruiker WHERE actief AND lower(gebruikersnaam) = ANY($1)
            AND wachtwoord_hash = public.crypt('demo', wachtwoord_hash) ORDER BY gebruikersnaam`,
        [TESTACCOUNTS.map(([n]) => n)],
      );
      if (pogingen && pogingen.n >= 20)
        waarschuwingen.push({ niveau: "let_op", tekst: `${pogingen.n} mislukte inlogpogingen in de laatste 24 uur (${(pogingen.namen ?? "").slice(0, 200)}).` });
      return {
        versie: VERSIE,
        node: typeof process !== "undefined" && process.version ? process.version : "browser (demo)",
        servertijd: new Date().toISOString(),
        schema: schema ?? null,
        database: db,
        laatsteBackup: laatsteBackup ?? null,
        laatsteHersteltest: laatsteHersteltest ?? null,
        recent,
        waarschuwingen,
        testaccounts: demo.map((d) => d.gebruikersnaam),
      } as never;
    },
  );
};

export default routes;
