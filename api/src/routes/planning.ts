import { Type } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { IEDEREEN, vereist, type Rol } from "../auth.js";
import { inTransactie, lees } from "../db.js";
import { ApiFout, niet } from "../fouten.js";
import { BatchNummer, StapCode } from "./schemas.js";

/** Plannen mag de planner (en de beheerder); kijken mag iedereen. */
export const PLANNEN: Rol[] = ["planner", "beheerder"];

const Dag = Type.String({ format: "date", examples: ["2026-11-20"] });
const OptTekst = Type.Union([Type.Null(), Type.String()]);

const Product = Type.Object({ id: Type.String(), code: Type.String(), naam: Type.String(), actief: Type.Boolean() });

const BatchPlan = Type.Object({
  batchnummer: Type.String(),
  status: Type.String(),
  gepland: Type.Boolean({ description: "false = door een operator aangemaakt, niet gepland" }),
  dag: Type.Union([Type.Null(), Dag]),
  volgorde: Type.Union([Type.Null(), Type.Integer()]),
  product_id: OptTekst,
  product: OptTekst,
  opmerking: OptTekst,
  vervallen_reden: OptTekst,
  laatste_stap: OptTekst,
  lotnummer: OptTekst,
  voorstel: Type.Union([Type.Null(), Type.Integer()]),
});

const BATCH_PLAN_SQL = `
  SELECT b.batchnummer, b.status, b.bron = 'planner' AS gepland,
         to_char(coalesce(b.geplande_dag, coalesce(b.gestart_op, b.aangemaakt_op)::date), 'YYYY-MM-DD') AS dag,
         b.volgorde, b.product_id::text, p.code || ' – ' || p.naam AS product, b.opmerking, b.vervallen_reden,
         (SELECT s.code FROM stapregistratie r JOIN processtap s ON s.id = r.processtap_id
           WHERE r.batch_id = b.id ORDER BY r.gestart_op DESC LIMIT 1) AS laatste_stap,
         l.lotnummer,
         (SELECT v.nummer FROM lot_voorstel_batch x JOIN lot_voorstel v ON v.id = x.voorstel_id
           WHERE x.batch_id = b.id AND v.status = 'open' LIMIT 1) AS voorstel
    FROM batch b
    LEFT JOIN product p ON p.id = b.product_id
    LEFT JOIN lot l ON l.id = b.lot_id`;

const PlanItem = Type.Object({
  id: Type.String(),
  soort: Type.Union([Type.Literal("batch"), Type.Literal("lot"), Type.Literal("voorstel")]),
  nummer: Type.String({ description: "Batch- of lotnummer, of het nummer van het lotvoorstel" }),
  volgorde: Type.Integer(),
  opmerking: OptTekst,
  status: Type.Union([Type.Literal("gepland"), Type.Literal("bezig"), Type.Literal("gedaan")]),
  batches: Type.Array(Type.String(), { description: "Bij een lotvoorstel: de 4 batches" }),
});

/** Geplande items per stap op een dag, met hun stand (gepland, bezig, gedaan). */
const PLAN_ITEMS_SQL = `
  SELECT sp.id::text, s.code AS stap,
         CASE WHEN sp.batch_id IS NOT NULL THEN 'batch' WHEN sp.lot_id IS NOT NULL THEN 'lot' ELSE 'voorstel' END AS soort,
         coalesce(b.batchnummer, l.lotnummer, v.nummer::text) AS nummer,
         sp.volgorde, sp.opmerking,
         CASE
           WHEN sp.voorstel_id IS NOT NULL THEN CASE WHEN v.status IN ('gebruikt','afgeweken') THEN 'gedaan' ELSE 'gepland' END
           ELSE coalesce((SELECT CASE r.status WHEN 'afgerond' THEN 'gedaan' WHEN 'open' THEN 'bezig' ELSE 'gepland' END
                            FROM stapregistratie r
                           WHERE r.processtap_id = sp.processtap_id
                             AND (r.batch_id = sp.batch_id OR r.lot_id = sp.lot_id)
                             AND r.status <> 'afgebroken'
                           ORDER BY r.poging DESC LIMIT 1), 'gepland')
         END AS status,
         coalesce((SELECT array_agg(bb.batchnummer ORDER BY bb.batchnummer) FROM lot_voorstel_batch x JOIN batch bb ON bb.id = x.batch_id
                    WHERE x.voorstel_id = sp.voorstel_id), '{}') AS batches
    FROM stapplanning sp
    JOIN processtap s ON s.id = sp.processtap_id
    LEFT JOIN batch b ON b.id = sp.batch_id
    LEFT JOIN lot l ON l.id = sp.lot_id
    LEFT JOIN lot_voorstel v ON v.id = sp.voorstel_id`;

const Voorstel = Type.Object({
  nummer: Type.Integer(),
  status: Type.String(),
  opmerking: OptTekst,
  aangemaakt_op: Type.String({ format: "date-time" }),
  door: Type.String(),
  lotnummer: OptTekst,
  afwijking_reden: OptTekst,
  batches: Type.Array(
    Type.Object({ batchnummer: Type.String(), status: Type.String(), klaar_voor_lot: Type.Boolean(), laatste_stap: OptTekst }),
  ),
});

const VOORSTEL_SQL = `
  SELECT v.nummer, v.status, v.opmerking, v.aangemaakt_op, g.gebruikersnaam AS door, l.lotnummer, v.afwijking_reden,
         (SELECT json_agg(json_build_object(
                   'batchnummer', b.batchnummer, 'status', b.status,
                   'klaar_voor_lot', b.status = 'in_productie' AND NOT EXISTS (
                       SELECT 1 FROM processtap s WHERE s.actief AND s.niveau = 'batch'
                          AND NOT EXISTS (SELECT 1 FROM stapregistratie r WHERE r.batch_id = b.id AND r.processtap_id = s.id AND r.status = 'afgerond')),
                   'laatste_stap', (SELECT s.code FROM stapregistratie r JOIN processtap s ON s.id = r.processtap_id
                                     WHERE r.batch_id = b.id ORDER BY r.gestart_op DESC LIMIT 1))
                   ORDER BY b.batchnummer)
            FROM lot_voorstel_batch x JOIN batch b ON b.id = x.batch_id WHERE x.voorstel_id = v.id) AS batches
    FROM lot_voorstel v
    JOIN gebruiker g ON g.id = v.aangemaakt_door
    LEFT JOIN lot l ON l.id = v.lot_id`;

async function batchIds(tx: { query: (s: string, p?: unknown[]) => Promise<{ rows: any[] }> }, nummers: string[]) {
  const { rows } = await tx.query("SELECT batchnummer, id FROM batch WHERE batchnummer = ANY($1)", [nummers]);
  const kaart = new Map(rows.map((r) => [r.batchnummer as string, r.id as string]));
  const ontbreekt = nummers.filter((n) => !kaart.has(n));
  if (ontbreekt.length) throw new ApiFout(404, `Onbekende batch: ${ontbreekt.join(", ")}`);
  return nummers.map((n) => kaart.get(n)!);
}

const routes: FastifyPluginAsyncTypebox = async (app) => {
  // ---------- Producten ----------
  app.get(
    "/producten",
    {
      preHandler: vereist(...IEDEREEN),
      schema: {
        tags: ["planning"],
        querystring: Type.Object({ ookInactief: Type.Optional(Type.Boolean()) }),
        response: { 200: Type.Array(Product) },
      },
    },
    async (req) =>
      lees(app.db, `SELECT id::text, code, naam, actief FROM product ${req.query.ookInactief ? "" : "WHERE actief"} ORDER BY code`) as never,
  );

  app.post(
    "/producten",
    {
      preHandler: vereist(...PLANNEN),
      schema: {
        tags: ["planning"],
        body: Type.Object({ code: Type.String({ pattern: "^[A-Za-z0-9._-]{1,20}$" }), naam: Type.String({ minLength: 1, maxLength: 100 }) }),
        response: { 201: Product },
      },
    },
    async (req, reply) => {
      const p = await inTransactie(app.db, req.user.naam, async (tx) => {
        const { rows } = await tx.query("INSERT INTO product (code, naam) VALUES ($1, $2) RETURNING id::text, code, naam, actief", [
          req.body.code.trim(),
          req.body.naam.trim(),
        ]);
        return rows[0];
      });
      return reply.status(201).send(p);
    },
  );

  app.patch(
    "/producten/:id",
    {
      preHandler: vereist(...PLANNEN),
      schema: {
        tags: ["planning"],
        params: Type.Object({ id: Type.String({ format: "uuid" }) }),
        body: Type.Object({ naam: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })), actief: Type.Optional(Type.Boolean()) }),
        response: { 200: Product },
      },
    },
    async (req) =>
      inTransactie(app.db, req.user.naam, async (tx) => {
        const { rows } = await tx.query(
          "UPDATE product SET naam = coalesce($2, naam), actief = coalesce($3, actief) WHERE id = $1 RETURNING id::text, code, naam, actief",
          [req.params.id, req.body.naam?.trim() ?? null, req.body.actief ?? null],
        );
        if (!rows[0]) throw niet("Product");
        return rows[0];
      }),
  );

  // ---------- Batches plannen ----------
  app.get(
    "/week",
    {
      preHandler: vereist(...IEDEREEN),
      schema: {
        tags: ["planning"],
        description: "Batches per dag: geplande batches op hun geplande dag, niet-geplande op de dag dat ze startten. Plus achterstand: geplande batches van eerdere dagen die nog niet gestart zijn.",
        querystring: Type.Object({ van: Dag, dagen: Type.Optional(Type.Integer({ minimum: 1, maximum: 31, default: 7 })) }),
        response: {
          200: Type.Object({
            dagen: Type.Array(Type.Object({ dag: Dag, batches: Type.Array(BatchPlan) })),
            achterstand: Type.Array(BatchPlan),
          }),
        },
      },
    },
    async (req) => {
      const dagen = req.query.dagen ?? 7;
      const rijen = await lees<{ dag: string } & Record<string, unknown>>(
        app.db,
        `${BATCH_PLAN_SQL}
          WHERE coalesce(b.geplande_dag, coalesce(b.gestart_op, b.aangemaakt_op)::date) BETWEEN $1::date AND $1::date + ($2 - 1)
          ORDER BY coalesce(b.geplande_dag, coalesce(b.gestart_op, b.aangemaakt_op)::date), b.bron DESC, b.volgorde NULLS LAST, b.batchnummer`,
        [req.query.van, dagen],
      );
      const achterstand = await lees(
        app.db,
        `${BATCH_PLAN_SQL} WHERE b.status = 'gepland' AND b.geplande_dag < least($1::date, current_date) ORDER BY b.geplande_dag, b.volgorde`,
        [req.query.van],
      );
      const lijst = Array.from({ length: dagen }, (_, i) => {
        const d = new Date(`${req.query.van}T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() + i);
        const dag = d.toISOString().slice(0, 10);
        return { dag, batches: rijen.filter((r) => r.dag === dag) };
      });
      return { dagen: lijst, achterstand } as never;
    },
  );

  app.post(
    "/batches",
    {
      preHandler: vereist(...PLANNEN),
      schema: {
        tags: ["planning"],
        description: "Plant een aantal batches op een dag. Het systeem geeft de volgende vrije batchnummers.",
        body: Type.Object({
          dag: Dag,
          aantal: Type.Integer({ minimum: 1, maximum: 50 }),
          productId: Type.Optional(Type.Union([Type.Null(), Type.String({ format: "uuid" })])),
          opmerking: Type.Optional(Type.Union([Type.Null(), Type.String({ maxLength: 500 })])),
        }),
        response: { 201: Type.Object({ batchnummers: Type.Array(Type.String()) }) },
      },
    },
    async (req, reply) => {
      const nummers = await inTransactie(app.db, req.user.naam, async (tx) => {
        const { rows } = await tx.query("SELECT plan_batches($1, $2, $3, $4, $5) AS nr", [
          req.body.aantal,
          req.body.dag,
          req.body.productId ?? null,
          req.body.opmerking ?? null,
          req.user.sub,
        ]);
        return rows.map((r) => r.nr as string);
      });
      return reply.status(201).send({ batchnummers: nummers });
    },
  );

  app.patch(
    "/batches/:batchnummer",
    {
      preHandler: vereist(...PLANNEN),
      schema: {
        tags: ["planning"],
        description: "Dag, product of opmerking van een geplande batch wijzigen. Na de start ligt alles behalve de opmerking vast.",
        params: Type.Object({ batchnummer: BatchNummer }),
        body: Type.Object({
          dag: Type.Optional(Dag),
          productId: Type.Optional(Type.Union([Type.Null(), Type.String({ format: "uuid" })])),
          opmerking: Type.Optional(Type.Union([Type.Null(), Type.String({ maxLength: 500 })])),
        }),
        response: { 200: BatchPlan },
      },
    },
    async (req) => {
      await inTransactie(app.db, req.user.naam, async (tx) => {
        const { rows } = await tx.query("SELECT id, geplande_dag::text AS dag, bron FROM batch WHERE batchnummer = $1 FOR UPDATE", [req.params.batchnummer]);
        const b = rows[0];
        if (!b) throw niet("Batch");
        if (b.bron !== "planner") throw new ApiFout(422, "Deze batch is niet gepland (door een operator aangemaakt)");
        const zet: string[] = [];
        const p: unknown[] = [b.id];
        if (req.body.dag !== undefined && req.body.dag !== b.dag) {
          p.push(req.body.dag);
          zet.push(`geplande_dag = $${p.length}`, `volgorde = (SELECT coalesce(max(volgorde), 0) + 1 FROM batch WHERE geplande_dag = $${p.length})`);
        }
        if (req.body.productId !== undefined) { p.push(req.body.productId); zet.push(`product_id = $${p.length}`); }
        if (req.body.opmerking !== undefined) { p.push(req.body.opmerking?.trim() || null); zet.push(`opmerking = $${p.length}`); }
        if (zet.length) await tx.query(`UPDATE batch SET ${zet.join(", ")} WHERE id = $1`, p);
      });
      const [r] = await lees(app.db, `${BATCH_PLAN_SQL} WHERE b.batchnummer = $1`, [req.params.batchnummer]);
      return r as never;
    },
  );

  app.post(
    "/batches/:batchnummer/volgorde",
    {
      preHandler: vereist(...PLANNEN),
      schema: {
        tags: ["planning"],
        description: "Een geplande batch één plaats eerder of later op zijn dag zetten.",
        params: Type.Object({ batchnummer: BatchNummer }),
        body: Type.Object({ richting: Type.Union([Type.Literal("eerder"), Type.Literal("later")]) }),
        response: { 204: Type.Null() },
      },
    },
    async (req, reply) => {
      await inTransactie(app.db, req.user.naam, async (tx) => {
        const { rows } = await tx.query("SELECT id, geplande_dag, volgorde, status FROM batch WHERE batchnummer = $1 FOR UPDATE", [req.params.batchnummer]);
        const b = rows[0];
        if (!b) throw niet("Batch");
        if (b.status !== "gepland") throw new ApiFout(422, "Alleen geplande batches die nog niet gestart zijn, kun je verschuiven");
        const eerder = req.body.richting === "eerder";
        const { rows: buur } = await tx.query(
          `SELECT id, volgorde FROM batch WHERE geplande_dag = $1 AND status = 'gepland' AND volgorde ${eerder ? "<" : ">"} $2
            ORDER BY volgorde ${eerder ? "DESC" : "ASC"} LIMIT 1 FOR UPDATE`,
          [b.geplande_dag, b.volgorde],
        );
        if (!buur[0]) return;
        await tx.query("UPDATE batch SET volgorde = $2 WHERE id = $1", [b.id, buur[0].volgorde]);
        await tx.query("UPDATE batch SET volgorde = $2 WHERE id = $1", [buur[0].id, b.volgorde]);
      });
      return reply.status(204).send(null);
    },
  );

  app.post(
    "/batches/:batchnummer/vervallen",
    {
      preHandler: vereist(...PLANNEN),
      schema: {
        tags: ["planning"],
        description: "Een geplande batch die nog niet gestart is laten vervallen (hij blijft bewaard).",
        params: Type.Object({ batchnummer: BatchNummer }),
        body: Type.Object({ reden: Type.String({ minLength: 3, maxLength: 500 }) }),
        response: { 204: Type.Null() },
      },
    },
    async (req, reply) => {
      await inTransactie(app.db, req.user.naam, async (tx) => {
        const { rowCount } = await tx.query(
          "UPDATE batch SET status = 'vervallen', vervallen_reden = $2 WHERE batchnummer = $1 RETURNING id",
          [req.params.batchnummer, req.body.reden.trim()],
        );
        if (!rowCount) throw niet("Batch");
        // Uit een open lotvoorstel halen kan niet stil: het voorstel wordt dan ongeldig.
        const { rows } = await tx.query(
          `SELECT v.nummer FROM lot_voorstel v JOIN lot_voorstel_batch x ON x.voorstel_id = v.id JOIN batch b ON b.id = x.batch_id
            WHERE b.batchnummer = $1 AND v.status = 'open'`,
          [req.params.batchnummer],
        );
        if (rows[0]) throw new ApiFout(422, `Deze batch staat in lotvoorstel ${rows[0].nummer}; pas eerst dat voorstel aan of laat het vervallen`);
        await tx.query("DELETE FROM stapplanning WHERE batch_id = (SELECT id FROM batch WHERE batchnummer = $1)", [req.params.batchnummer]);
      });
      return reply.status(204).send(null);
    },
  );

  // ---------- Dagplanning per stap ----------
  app.get(
    "/stappen",
    {
      preHandler: vereist(...IEDEREEN),
      schema: {
        tags: ["planning"],
        description: "Per actieve stap de items die op deze dag gepland zijn, met hun stand.",
        querystring: Type.Object({ dag: Dag }),
        response: {
          200: Type.Array(
            Type.Object({ code: Type.String(), naam: Type.String(), niveau: Type.String(), is_lot_stap: Type.Boolean(), items: Type.Array(PlanItem) }),
          ),
        },
      },
    },
    async (req) => {
      const stappen = await lees<{ code: string }>(app.db, "SELECT code, naam, niveau, is_lot_stap FROM processtap WHERE actief ORDER BY volgorde");
      const items = await lees<{ stap: string }>(app.db, `${PLAN_ITEMS_SQL} WHERE sp.dag = $1 ORDER BY s.volgorde, sp.volgorde`, [req.query.dag]);
      return stappen.map((s) => ({ ...s, items: items.filter((i) => i.stap === s.code) })) as never;
    },
  );

  app.get(
    "/vandaag",
    {
      preHandler: vereist(...IEDEREEN),
      schema: {
        tags: ["planning"],
        description: "Voor het invoerscherm: wat er vandaag in deze stap gepland is, in volgorde.",
        querystring: Type.Object({ stap: StapCode }),
        response: { 200: Type.Array(PlanItem) },
      },
    },
    async (req) =>
      lees(app.db, `${PLAN_ITEMS_SQL} WHERE sp.dag = current_date AND s.code = $1 ORDER BY sp.volgorde`, [req.query.stap]) as never,
  );

  app.get(
    "/kandidaten",
    {
      preHandler: vereist(...IEDEREEN),
      schema: {
        tags: ["planning"],
        description: "Wat je in deze stap kunt plannen. 'klaar' = staat nu in de werkvoorraad van de stap.",
        querystring: Type.Object({ stap: StapCode }),
        response: {
          200: Type.Array(Type.Object({ soort: Type.String(), nummer: Type.String(), klaar: Type.Boolean(), toelichting: OptTekst })),
        },
      },
    },
    async (req) => {
      const [stap] = await lees<{ id: string; niveau: string; is_lot_stap: boolean }>(
        app.db,
        "SELECT id, niveau, is_lot_stap FROM processtap WHERE code = $1 AND actief",
        [req.query.stap],
      );
      if (!stap) throw niet("Stap");
      if (stap.is_lot_stap) {
        return lees(
          app.db,
          `SELECT 'voorstel' AS soort, v.nummer::text AS nummer,
                  NOT EXISTS (SELECT 1 FROM lot_voorstel_batch x JOIN batch b ON b.id = x.batch_id
                               WHERE x.voorstel_id = v.id AND b.batchnummer NOT IN (SELECT nummer FROM werkvoorraad($1))) AS klaar,
                  (SELECT string_agg(b.batchnummer, ', ' ORDER BY b.batchnummer) FROM lot_voorstel_batch x JOIN batch b ON b.id = x.batch_id
                    WHERE x.voorstel_id = v.id) AS toelichting
             FROM lot_voorstel v WHERE v.status = 'open' ORDER BY v.nummer`,
          [req.query.stap],
        ) as never;
      }
      if (stap.niveau === "lot") {
        return lees(
          app.db,
          `SELECT 'lot' AS soort, l.lotnummer AS nummer, l.lotnummer IN (SELECT nummer FROM werkvoorraad($1)) AS klaar, NULL AS toelichting
             FROM lot l WHERE l.status = 'in_productie' ORDER BY 3 DESC, l.lotnummer`,
          [req.query.stap],
        ) as never;
      }
      return lees(
        app.db,
        `SELECT 'batch' AS soort, b.batchnummer AS nummer, b.batchnummer IN (SELECT nummer FROM werkvoorraad($1)) AS klaar,
                concat_ws(' · ', p.code, CASE WHEN b.status = 'gepland' THEN 'gepland voor ' || to_char(b.geplande_dag, 'DD-MM') END) AS toelichting
           FROM batch b LEFT JOIN product p ON p.id = b.product_id
          WHERE b.status IN ('gepland', 'in_productie', 'in_beoordeling')
            AND NOT EXISTS (SELECT 1 FROM stapregistratie r WHERE r.batch_id = b.id AND r.processtap_id = $2 AND r.status = 'afgerond')
          ORDER BY 3 DESC, coalesce(b.geplande_dag, b.aangemaakt_op::date), b.volgorde NULLS LAST, b.batchnummer`,
        [req.query.stap, stap.id],
      ) as never;
    },
  );

  app.put(
    "/stappen",
    {
      preHandler: vereist(...PLANNEN),
      schema: {
        tags: ["planning"],
        description: "Zet de planning van één stap op één dag: de items in deze volgorde (vervangt wat er stond).",
        body: Type.Object({
          dag: Dag,
          stap: StapCode,
          items: Type.Array(Type.Object({ nummer: Type.String({ minLength: 1 }), opmerking: Type.Optional(Type.Union([Type.Null(), Type.String({ maxLength: 300 })])) }), {
            maxItems: 100,
          }),
        }),
        response: { 200: Type.Array(PlanItem) },
      },
    },
    async (req) => {
      await inTransactie(app.db, req.user.naam, async (tx) => {
        const { rows } = await tx.query("SELECT id, niveau, is_lot_stap FROM processtap WHERE code = $1 AND actief", [req.body.stap]);
        const stap = rows[0];
        if (!stap) throw niet("Stap");
        await tx.query("DELETE FROM stapplanning WHERE dag = $1 AND processtap_id = $2", [req.body.dag, stap.id]);
        let volgorde = 0;
        for (const item of req.body.items) {
          volgorde++;
          let kolom: string;
          let sql: string;
          if (stap.is_lot_stap) { kolom = "voorstel_id"; sql = "SELECT id FROM lot_voorstel WHERE nummer = $1::int"; }
          else if (stap.niveau === "lot") { kolom = "lot_id"; sql = "SELECT id FROM lot WHERE lotnummer = $1"; }
          else { kolom = "batch_id"; sql = "SELECT id FROM batch WHERE batchnummer = $1"; }
          if (stap.is_lot_stap && !/^\d+$/.test(item.nummer)) throw new ApiFout(400, `Voor deze stap plan je een lotvoorstel (nummer), niet ${item.nummer}`);
          const { rows: gevonden } = await tx.query(sql, [item.nummer]);
          if (!gevonden[0]) throw new ApiFout(404, `Onbekend: ${item.nummer}`);
          await tx.query(
            `INSERT INTO stapplanning (dag, processtap_id, ${kolom}, volgorde, opmerking, aangemaakt_door) VALUES ($1, $2, $3, $4, $5, $6)`,
            [req.body.dag, stap.id, gevonden[0].id, volgorde, item.opmerking?.trim() || null, req.user.sub],
          );
        }
      });
      return lees(app.db, `${PLAN_ITEMS_SQL} WHERE sp.dag = $1 AND s.code = $2 ORDER BY sp.volgorde`, [req.body.dag, req.body.stap]) as never;
    },
  );

  // ---------- Etiketten ----------
  app.get(
    "/etiketten",
    {
      preHandler: vereist(...IEDEREEN),
      schema: {
        tags: ["planning"],
        description: "Gegevens voor etiketten van batches of lots (in de gevraagde volgorde). Onbekende nummers worden overgeslagen.",
        querystring: Type.Object({ nummers: Type.String({ description: "Batch- of lotnummers, gescheiden door komma's", maxLength: 2000 }) }),
        response: {
          200: Type.Array(Type.Object({
            nummer: Type.String(), soort: Type.Union([Type.Literal("batch"), Type.Literal("lot")]),
            product: OptTekst, dag: Type.Union([Type.Null(), Dag]), batches: Type.Array(Type.String()),
          })),
        },
      },
    },
    async (req) => {
      const nummers = [...new Set(req.query.nummers.split(",").map((n) => n.trim().toUpperCase()).filter(Boolean))].slice(0, 200);
      const rijen = await lees<{ nummer: string }>(
        app.db,
        `SELECT b.batchnummer AS nummer, 'batch' AS soort, p.code || ' ' || p.naam AS product,
                to_char(coalesce(b.geplande_dag, coalesce(b.gestart_op, b.aangemaakt_op)::date), 'YYYY-MM-DD') AS dag, '{}'::text[] AS batches
           FROM batch b LEFT JOIN product p ON p.id = b.product_id WHERE b.batchnummer = ANY($1)
         UNION ALL
         SELECT l.lotnummer, 'lot', (SELECT string_agg(DISTINCT p.code || ' ' || p.naam, ', ') FROM batch x JOIN product p ON p.id = x.product_id WHERE x.lot_id = l.id),
                to_char(l.aangemaakt_op, 'YYYY-MM-DD'), coalesce((SELECT array_agg(x.batchnummer ORDER BY x.batchnummer) FROM batch x WHERE x.lot_id = l.id), '{}')
           FROM lot l WHERE l.lotnummer = ANY($1)`,
        [nummers],
      );
      return nummers.map((n) => rijen.find((r) => r.nummer === n)).filter(Boolean) as never;
    },
  );

  // ---------- Lotvoorstellen ----------
  app.get(
    "/lotvoorstellen",
    {
      preHandler: vereist(...IEDEREEN),
      schema: {
        tags: ["planning"],
        querystring: Type.Object({ alle: Type.Optional(Type.Boolean({ description: "ook gebruikte, afgeweken en vervallen (laatste 50)" })) }),
        response: { 200: Type.Array(Voorstel) },
      },
    },
    async (req) =>
      lees(
        app.db,
        req.query.alle
          ? `${VOORSTEL_SQL} ORDER BY (v.status = 'open') DESC, v.nummer DESC LIMIT 50`
          : `${VOORSTEL_SQL} WHERE v.status = 'open' ORDER BY v.nummer`,
      ) as never,
  );

  app.get(
    "/lotkandidaten",
    {
      preHandler: vereist(...IEDEREEN),
      schema: {
        tags: ["planning"],
        description: "Batches die je in een lotvoorstel kunt zetten: nog geen lot, niet afgekeurd of vervallen. 'voorstel' = staat al in dit open voorstel.",
        response: {
          200: Type.Array(Type.Object({
            batchnummer: Type.String(), status: Type.String(), product: OptTekst, dag: Type.Union([Type.Null(), Dag]),
            laatste_stap: OptTekst, klaar_voor_lot: Type.Boolean(), voorstel: Type.Union([Type.Null(), Type.Integer()]),
          })),
        },
      },
    },
    async () =>
      lees(
        app.db,
        `SELECT x.batchnummer, x.status, x.product, x.dag, x.laatste_stap, x.voorstel,
                x.status = 'in_productie' AND NOT EXISTS (
                  SELECT 1 FROM processtap s WHERE s.actief AND s.niveau = 'batch'
                     AND NOT EXISTS (SELECT 1 FROM stapregistratie r JOIN batch b ON b.id = r.batch_id
                                      WHERE b.batchnummer = x.batchnummer AND r.processtap_id = s.id AND r.status = 'afgerond')) AS klaar_voor_lot
           FROM (${BATCH_PLAN_SQL} WHERE b.status IN ('gepland', 'in_productie', 'in_beoordeling')) x
          ORDER BY 7 DESC, x.dag, x.volgorde NULLS LAST, x.batchnummer`,
      ) as never,
  );

  const VoorstelInvoer = Type.Object({
    batchnummers: Type.Array(BatchNummer, { minItems: 4, maxItems: 4 }),
    opmerking: Type.Optional(Type.Union([Type.Null(), Type.String({ maxLength: 300 })])),
  });

  app.post(
    "/lotvoorstellen",
    {
      preHandler: vereist(...PLANNEN),
      schema: { tags: ["planning"], body: VoorstelInvoer, response: { 201: Voorstel } },
    },
    async (req, reply) => {
      const id = await inTransactie(app.db, req.user.naam, async (tx) => {
        const ids = await batchIds(tx, req.body.batchnummers);
        const { rows } = await tx.query("SELECT bewaar_lot_voorstel(NULL, $1, $2, $3) AS id", [ids, req.body.opmerking ?? null, req.user.sub]);
        return rows[0].id as string;
      });
      const [v] = await lees(app.db, `${VOORSTEL_SQL} WHERE v.id = $1`, [id]);
      return reply.status(201).send(v as never);
    },
  );

  app.put(
    "/lotvoorstellen/:nummer",
    {
      preHandler: vereist(...PLANNEN),
      schema: { tags: ["planning"], params: Type.Object({ nummer: Type.Integer() }), body: VoorstelInvoer, response: { 200: Voorstel } },
    },
    async (req) => {
      await inTransactie(app.db, req.user.naam, async (tx) => {
        const { rows } = await tx.query("SELECT id FROM lot_voorstel WHERE nummer = $1 FOR UPDATE", [req.params.nummer]);
        if (!rows[0]) throw niet("Lotvoorstel");
        const ids = await batchIds(tx, req.body.batchnummers);
        await tx.query("SELECT bewaar_lot_voorstel($1, $2, $3, $4)", [rows[0].id, ids, req.body.opmerking ?? null, req.user.sub]);
      });
      const [v] = await lees(app.db, `${VOORSTEL_SQL} WHERE v.nummer = $1`, [req.params.nummer]);
      return v as never;
    },
  );

  app.post(
    "/lotvoorstellen/:nummer/vervallen",
    {
      preHandler: vereist(...PLANNEN),
      schema: { tags: ["planning"], params: Type.Object({ nummer: Type.Integer() }), response: { 204: Type.Null() } },
    },
    async (req, reply) => {
      await inTransactie(app.db, req.user.naam, async (tx) => {
        const { rows } = await tx.query(
          "UPDATE lot_voorstel SET status = 'vervallen', afgesloten_op = now() WHERE nummer = $1 AND status = 'open' RETURNING id",
          [req.params.nummer],
        );
        if (!rows[0]) throw new ApiFout(422, "Alleen een open voorstel kan vervallen");
        await tx.query("DELETE FROM stapplanning WHERE voorstel_id = $1", [rows[0].id]);
      });
      return reply.status(204).send(null);
    },
  );
};

export default routes;
