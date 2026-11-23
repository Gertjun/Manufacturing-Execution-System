import { Type } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { IEDEREEN, vereist, type Rol } from "../auth.js";
import { inTransactie, lees } from "../db.js";
import { ApiFout, niet } from "../fouten.js";
import { BatchNummer, StapCode, NulGeheel } from "./schemas.js";

/** Plannen mag de planner (en de beheerder); kijken mag iedereen. */
export const PLANNEN: Rol[] = ["planner", "beheerder"];

const Dag = Type.String({ format: "date", examples: ["2026-11-20"] });
const OptTekst = Type.Union([Type.Null(), Type.String()]);

const Product = Type.Object({
  id: Type.String(), code: Type.String(), naam: Type.String(), actief: Type.Boolean(),
  route: Type.Optional(Type.Union([Type.Null(), Type.Array(Type.String())], {
    description: "Stappen van het product in volgorde (D55); null = de standaardroute, alle actieve stappen",
  })),
});
/** Product met zijn route: de stapcodes in volgorde, of null bij de standaardroute. */
const PRODUCT_SQL = `
  SELECT p.id::text, p.code, p.naam, p.actief,
         (SELECT array_agg(s.code ORDER BY ps.plek) FROM product_stap ps JOIN processtap s ON s.id = ps.processtap_id
           WHERE ps.product_id = p.id AND s.actief) AS route
    FROM product p`;

const BatchPlan = Type.Object({
  batchnummer: Type.String(),
  status: Type.String(),
  gepland: Type.Boolean({ description: "false = door een operator aangemaakt, niet gepland" }),
  dag: Type.Union([Type.Null(), Dag]),
  volgorde: NulGeheel(),
  product_id: OptTekst,
  product: OptTekst,
  opmerking: OptTekst,
  vervallen_reden: OptTekst,
  laatste_stap: OptTekst,
  lotnummer: OptTekst,
  voorstel: NulGeheel(),
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

/** Hoe de vorige stap ervoor staat (D52). Een waarschuwing, geen weigering: de planning blijft een richtlijn (D29). */
const Vorige = Type.Object(
  {
    stand: Type.Union(["eerste", "klaar", "bezig", "vandaag", "eerder", "achter", "later", "niet_gepland", "niet_klaar", "niet_in_route"].map((x) => Type.Literal(x))),
    stap: OptTekst,
    dag: Type.Union([Type.Null(), Dag]),
    nr: NulGeheel(),
  },
  {
    description:
      "achter/later/niet_gepland (en bij een lotvoorstel niet_klaar) = de vorige stap is niet op tijd: waarschuwen. " +
      "niet_in_route = de stap hoort niet bij de route van het product (D55); 'stap' is dan de productcode.",
  },
);

/** SQL voor de kolom "vorige": stapId, batchId, lotId, voorstelId en dag als SQL-uitdrukkingen. */
function vorigeSql(stap: string, batch: string, lot: string, voorstel: string, dag: string) {
  return `CASE WHEN ${voorstel} IS NOT NULL THEN
            json_build_object(
              'stand', CASE WHEN EXISTS (
                         SELECT 1 FROM lot_voorstel_batch vx JOIN batch vb ON vb.id = vx.batch_id
                          WHERE vx.voorstel_id = ${voorstel}
                            AND NOT batch_klaar_voor_lot(vb.id))
                       THEN 'niet_klaar' ELSE 'klaar' END,
              'stap', (SELECT code FROM processtap WHERE id = route_laatste(
                         (SELECT vb.product_id FROM lot_voorstel_batch vx JOIN batch vb ON vb.id = vx.batch_id
                           WHERE vx.voorstel_id = ${voorstel} LIMIT 1), 'batch')),
              'dag', NULL, 'nr', NULL)
          ELSE (SELECT json_build_object('stand', x.stand, 'stap', x.vorige, 'dag', to_char(x.dag, 'YYYY-MM-DD'), 'nr', x.nr)
                  FROM planning_vorige_stap(${stap}, ${batch}, ${lot}, ${dag}) x)
          END`;
}

const PlanItem = Type.Object({
  id: Type.String(),
  soort: Type.Union([Type.Literal("batch"), Type.Literal("lot"), Type.Literal("voorstel")]),
  nummer: Type.String({ description: "Batch- of lotnummer, of het nummer van het lotvoorstel" }),
  volgorde: Type.Integer(),
  opmerking: OptTekst,
  status: Type.Union([Type.Literal("gepland"), Type.Literal("bezig"), Type.Literal("gedaan")]),
  batches: Type.Array(Type.String(), { description: "Bij een lotvoorstel: de 4 batches" }),
  vorige: Type.Optional(Type.Union([Type.Null(), Vorige])),
});

/** Geplande items per stap op een dag, met hun stand (gepland, bezig, gedaan). */
const PLAN_ITEMS_SQL = `
  SELECT sp.id::text, s.code AS stap,
         CASE WHEN sp.batch_id IS NOT NULL THEN 'batch' WHEN sp.lot_id IS NOT NULL THEN 'lot' ELSE 'voorstel' END AS soort,
         coalesce(b.batchnummer, l.lotnummer, v.nummer::text) AS nummer,
         sp.volgorde, sp.opmerking,
         plan_stand(sp.id) AS status,  -- met herbewerkingen meegerekend (#61)
         coalesce((SELECT array_agg(bb.batchnummer ORDER BY bb.batchnummer) FROM lot_voorstel_batch x JOIN batch bb ON bb.id = x.batch_id
                    WHERE x.voorstel_id = sp.voorstel_id), '{}') AS batches,
         ${vorigeSql("sp.processtap_id", "sp.batch_id", "sp.lot_id", "sp.voorstel_id", "sp.dag")} AS vorige
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
                   'klaar_voor_lot', b.status = 'in_productie' AND batch_klaar_voor_lot(b.id),
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

/**
 * Starts per product per dag (D69): hoeveel batches van een product op die dag starten (gepland, of gestart als ze niet
 * gepland waren; zonder vervallen) en de capaciteit van de eerste stap van zijn route op die dag. Per dag van $1 tot en
 * met $1 + $2 - 1: elk actief product met capaciteit, en elk product (ook geen product) met batches op die dag.
 */
const STARTS_SQL = `
  WITH d AS (SELECT g::date AS dag FROM generate_series($1::date, $1::date + ($2::int - 1), interval '1 day') g),
       st AS (SELECT coalesce(b.geplande_dag, coalesce(b.gestart_op, b.aangemaakt_op)::date) AS dag, b.product_id, count(*)::int AS aantal
                FROM batch b
               WHERE b.status <> 'vervallen'
                 AND coalesce(b.geplande_dag, coalesce(b.gestart_op, b.aangemaakt_op)::date) BETWEEN $1::date AND $1::date + ($2::int - 1)
               GROUP BY 1, 2),
       pr AS (SELECT p.id, p.code, p.naam FROM product p WHERE p.actief OR p.id IN (SELECT product_id FROM st)
              UNION ALL SELECT NULL, NULL, NULL),
       x AS (SELECT d.dag, pr.id, pr.code, pr.naam, coalesce(st.aantal, 0) AS aantal, route_eerste(pr.id, 'batch') AS stap
               FROM d CROSS JOIN pr LEFT JOIN st ON st.dag = d.dag AND st.product_id IS NOT DISTINCT FROM pr.id)
  SELECT to_char(x.dag, 'YYYY-MM-DD') AS dag, x.code AS product, x.naam, x.aantal,
         capaciteit_stap_op(x.stap, x.id, x.dag) AS max,
         (SELECT a.reden FROM capaciteit_afwijking_voor(x.stap, x.id, x.dag) a) AS reden,
         x.dag >= current_date AS komt
    FROM x
   WHERE x.aantal > 0 OR (x.id IS NOT NULL AND capaciteit_stap_op(x.stap, x.id, x.dag) IS NOT NULL)
   ORDER BY x.dag, x.code NULLS LAST`;
/** Dag (JJJJ-MM-DD) plus een aantal dagen, zonder tijdzone. */
function plusDagenIso(dag: string, n: number): string {
  const d = new Date(`${dag}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
interface StartRij { dag: string; product: string | null; naam: string | null; aantal: number; max: number | null; reden: string | null; komt: boolean }

/** Afwijkende capaciteit die op een dag geldt, voor de uitleg in Batches plannen. */
const AFWIJKING_SQL = `
  SELECT a.id, to_char(a.van, 'YYYY-MM-DD') AS van, to_char(a.tot, 'YYYY-MM-DD') AS tot, s.code AS stap, p.code AS product, a.procent, a.reden
    FROM capaciteit_afwijking a LEFT JOIN processtap s ON s.id = a.processtap_id LEFT JOIN product p ON p.id = a.product_id
   WHERE a.actief`;
const Afwijking = Type.Object({
  id: Type.String({ format: "uuid" }),
  van: Dag,
  tot: Dag,
  stap: Type.Union([Type.Null(), Type.String()], { description: "null = alle stappen" }),
  product: Type.Union([Type.Null(), Type.String()], { description: "null = alle producten" }),
  procent: Type.Integer({ description: "Percentage van de gewone capaciteit; 0 = geen productie" }),
  reden: Type.String(),
});
const ProductStart = Type.Object({
  product: Type.Union([Type.Null(), Type.String()], { description: "Productcode; null = batches zonder product" }),
  naam: Type.Union([Type.Null(), Type.String()]),
  aantal: Type.Integer({ description: "Batches van dit product die deze dag starten, zonder vervallen" }),
  max: NulGeheel({ description: "Capaciteit van de eerste stap van de route op deze dag; 0 = die dag geen productie; null = niet ingesteld" }),
  reden: Type.Union([Type.Null(), Type.String()], { description: "Reden van een afwijkende capaciteit op deze dag" }),
});

/** Waarschuwing na het plannen: de producten die op die dag nu boven hun capaciteit zitten. */
function startWaarschuwing(rijen: StartRij[]): string | null {
  const te = rijen.filter((r) => r.max !== null && r.aantal > r.max);
  if (!te.length) return null;
  return te.map((r) => {
    const naam = r.product ?? "Zonder product";
    return r.max === 0
      ? `${naam} wordt deze dag niet gemaakt${r.reden ? ` (${r.reden})` : ""}`
      : `${naam} heeft deze dag nu ${r.aantal} batches; de capaciteit is ${r.max}${r.reden ? ` (${r.reden})` : ""}`;
  }).join(". ");
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
      lees(app.db, `${PRODUCT_SQL} ${req.query.ookInactief ? "" : "WHERE p.actief"} ORDER BY p.code`) as never,
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
        const { rows } = await tx.query("INSERT INTO product (code, naam) VALUES ($1, $2) RETURNING id::text, code, naam, actief, NULL::text[] AS route", [
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
          `UPDATE product SET naam = coalesce($2, naam), actief = coalesce($3, actief) WHERE id = $1
           RETURNING id::text, code, naam, actief,
                     (SELECT array_agg(s.code ORDER BY ps.plek) FROM product_stap ps JOIN processtap s ON s.id = ps.processtap_id
                       WHERE ps.product_id = product.id AND s.actief) AS route`,
          [req.params.id, req.body.naam?.trim() ?? null, req.body.actief ?? null],
        );
        if (!rows[0]) throw niet("Product");
        return rows[0];
      }),
  );

  app.put(
    "/producten/:id/route",
    {
      preHandler: vereist(...PLANNEN),
      schema: {
        tags: ["planning"],
        description:
          "Zet de route van een product (D55): de stapcodes in volgorde. Eerst batchstappen, dan de lotstap, dan lotstappen. " +
          "null of een lege lijst = de standaardroute (alle actieve stappen). Lopende batches volgen de nieuwe route meteen.",
        params: Type.Object({ id: Type.String({ format: "uuid" }) }),
        body: Type.Object({ stappen: Type.Union([Type.Null(), Type.Array(StapCode, { maxItems: 100 })]) }),
        response: { 200: Product },
      },
    },
    async (req) =>
      inTransactie(app.db, req.user.naam, async (tx) => {
        await tx.query("SELECT zet_route($1, $2)", [req.params.id, req.body.stappen?.length ? req.body.stappen : null]);
        await tx.query("SET CONSTRAINTS ALL IMMEDIATE");
        const { rows } = await tx.query(`${PRODUCT_SQL} WHERE p.id = $1`, [req.params.id]);
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
            dagen: Type.Array(Type.Object({
              dag: Dag,
              batches: Type.Array(BatchPlan),
              bezet: Type.Integer({ description: "Batches op deze dag, zonder vervallen" }),
              producten: Type.Array(ProductStart, { description: "Per product de starts en de capaciteit van de eerste stap van zijn route (D69)" }),
              afwijkingen: Type.Array(Afwijking, { description: "Afwijkende capaciteit die deze dag geldt (D69)" }),
              stappen_vol: Type.Optional(Type.Array(Type.Object({
                stap: Type.String(),
                procent: Type.Integer(),
                dicht: Type.Boolean({ description: "Er is iets gepland in een stap die deze dag dicht is (0 %)" }),
              }), { description: "Stappen die deze dag boven hun capaciteit per stap en product zitten (D55)" })),
            })),
            achterstand: Type.Array(BatchPlan),
            ruimte: Type.Array(Type.Object({ product: Type.String(), aantal: Type.Integer() }), {
              description: "Per product hoeveel batches er in deze periode vanaf vandaag nog kunnen starten (dagen boven de capaciteit tellen niet negatief mee)",
            }),
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
      const starts = await lees<StartRij>(app.db, STARTS_SQL, [req.query.van, dagen]);
      const afwijkingen = await lees<{ van: string; tot: string } & Record<string, unknown>>(app.db,
        `${AFWIJKING_SQL} AND a.tot >= $1::date AND a.van <= $1::date + ($2::int - 1) ORDER BY a.procent, a.van`, [req.query.van, dagen]);
      const vol = await lees<{ dag: string; stap: string; procent: number; dicht: boolean }>(
        app.db,
        `SELECT to_char(d, 'YYYY-MM-DD') AS dag, s.code AS stap,
                coalesce(round(100 * sum(b.aantal::numeric / nullif(b.max_per_dag, 0))), 0)::int AS procent,
                bool_or(b.max_per_dag = 0) AS dicht
           FROM generate_series($1::date, $1::date + ($2 - 1), interval '1 day') d
           CROSS JOIN processtap s
           CROSS JOIN LATERAL stap_belasting(s.id, d::date) b
          WHERE s.actief AND b.max_per_dag IS NOT NULL
          GROUP BY d, s.code, s.volgorde
         HAVING bool_or(b.max_per_dag = 0) OR sum(b.aantal::numeric / nullif(b.max_per_dag, 0)) > 1
          ORDER BY d, s.volgorde`,
        [req.query.van, dagen],
      );
      const lijst = Array.from({ length: dagen }, (_, i) => {
        const dag = plusDagenIso(req.query.van, i);
        const batches = rijen.filter((r) => r.dag === dag);
        return {
          dag, batches, bezet: batches.filter((b) => b.status !== "vervallen").length,
          producten: starts.filter((r) => r.dag === dag).map(({ product, naam, aantal, max, reden }) => ({ product, naam, aantal, max, reden })),
          afwijkingen: afwijkingen.filter((a) => a.van <= dag && a.tot >= dag),
          stappen_vol: vol.filter((v) => v.dag === dag).map(({ stap, procent, dicht }) => ({ stap, procent, dicht })),
        };
      });
      const ruimte = new Map<string, number>();
      for (const r of starts) {
        if (r.komt && r.product && r.max !== null) ruimte.set(r.product, (ruimte.get(r.product) ?? 0) + Math.max(0, r.max - r.aantal));
      }
      return { dagen: lijst, achterstand, ruimte: [...ruimte].map(([product, aantal]) => ({ product, aantal })) } as never;
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
        response: {
          201: Type.Object({
            batchnummers: Type.Array(Type.String()),
            waarschuwing: Type.Union([Type.Null(), Type.String()], { description: "Gezet als een product die dag nu boven de capaciteit van de eerste stap van zijn route zit (D69)" }),
          }),
        },
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
      const starts = await lees<StartRij & { id?: string }>(app.db,
        `SELECT * FROM (${STARTS_SQL}) s WHERE s.product IS NOT DISTINCT FROM (SELECT code FROM product WHERE id = $3::uuid)`,
        [req.body.dag, 1, req.body.productId ?? null]);
      return reply.status(201).send({ batchnummers: nummers, waarschuwing: startWaarschuwing(starts) });
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

  // ---------- Capaciteit per stap en product (D55) ----------
  const StapCapaciteit = Type.Union([
    Type.Null(),
    Type.Object({
      procent: Type.Integer({ description: "Hoe vol de stap is: de som van aantal/max per product, in procenten (producten met max 0 tellen niet mee)" }),
      dicht: Type.Boolean({ description: "Er is iets gepland voor een product waarvoor de stap deze dag dicht is (0 %, D69)" }),
      regels: Type.Array(Type.Object({
        product: OptTekst,
        aantal: Type.Integer(),
        van_week: Type.Integer({ description: "Batches die deze dag starten volgens de weekplanning (alleen bij hun eerste stap)" }),
        max: NulGeheel({ description: "Capaciteit op deze dag voor dit product, met een afwijking verrekend (D69); 0 = dicht; null = nog niet ingevuld (telt niet mee, #81)" }),
        reden: Type.Union([Type.Null(), Type.String()], { description: "Reden van een afwijkende capaciteit op deze dag" }),
      })),
    }),
  ], { description: "Capaciteit van de stap op deze dag; null als er voor de stap geen capaciteit is ingevuld en niets gepland is" });
  /** Per actieve stap de belasting op dag $1 (zie stap_belasting). */
  const STAP_CAPACITEIT_SQL = `
    SELECT s.code,
           CASE WHEN EXISTS (SELECT 1 FROM capaciteit_stap c WHERE c.processtap_id = s.id)
                  OR EXISTS (SELECT 1 FROM stap_belasting(s.id, $1::date) b) THEN json_build_object(
             'procent', coalesce((SELECT round(100 * sum(b.aantal::numeric / nullif(b.max_per_dag, 0))) FROM stap_belasting(s.id, $1::date) b
                                   WHERE b.max_per_dag IS NOT NULL), 0)::int,
             'dicht', coalesce((SELECT bool_or(b.max_per_dag = 0) FROM stap_belasting(s.id, $1::date) b), false),
             'regels', coalesce((SELECT json_agg(json_build_object('product', p.code, 'aantal', b.aantal, 'van_week', b.van_week, 'max', b.max_per_dag, 'reden', b.reden)
                                                 ORDER BY p.code NULLS LAST)
                                   FROM stap_belasting(s.id, $1::date) b LEFT JOIN product p ON p.id = b.product_id), '[]'))
           END AS capaciteit
      FROM processtap s WHERE s.actief`;

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
            Type.Object({
              code: Type.String(), naam: Type.String(), niveau: Type.String(), is_lot_stap: Type.Boolean(), items: Type.Array(PlanItem),
              capaciteit: Type.Optional(StapCapaciteit),
            }),
          ),
        },
      },
    },
    async (req) => {
      const stappen = await lees<{ code: string }>(app.db, "SELECT code, naam, niveau, is_lot_stap FROM processtap WHERE actief ORDER BY volgorde");
      const items = await lees<{ stap: string }>(app.db, `${PLAN_ITEMS_SQL} WHERE sp.dag = $1 ORDER BY s.volgorde, sp.volgorde`, [req.query.dag]);
      const cap = new Map((await lees<{ code: string; capaciteit: unknown }>(app.db, STAP_CAPACITEIT_SQL, [req.query.dag])).map((c) => [c.code, c.capaciteit]));
      return stappen.map((s) => ({ ...s, items: items.filter((i) => i.stap === s.code), capaciteit: cap.get(s.code) ?? null })) as never;
    },
  );

  app.get(
    "/route",
    {
      preHandler: vereist(...IEDEREEN),
      schema: {
        tags: ["planning"],
        description:
          "Proef (D52): per batch die nog niet in een lot zit de stand van elke batchstap: klaar (met dag), bezig, gepland (met dag) of niets; " +
          "niet_in_route als de stap niet bij de route van het product hoort (D55). " +
          "'waarschuwing' = gepland terwijl de vorige stap niet op tijd is. De lotstap toont het lotvoorstel.",
        response: {
          200: Type.Object({
            stappen: Type.Array(Type.Object({ code: Type.String(), naam: Type.String(), is_lot_stap: Type.Boolean() })),
            batches: Type.Array(Type.Object({
              batchnummer: Type.String(), status: Type.String(), product: OptTekst, startdag: Type.Union([Type.Null(), Dag]), voorstel: NulGeheel(),
              cellen: Type.Array(Type.Object({
                stap: Type.String(),
                stand: Type.Union([Type.Null(), Type.Literal("klaar"), Type.Literal("bezig"), Type.Literal("gepland"), Type.Literal("niet_in_route")]),
                dag: Type.Union([Type.Null(), Dag]),
                waarschuwing: OptTekst,
              })),
            })),
          }),
        },
      },
    },
    async () => {
      const stappen = await lees<{ code: string }>(app.db,
        "SELECT code, naam, is_lot_stap FROM processtap WHERE actief AND (niveau = 'batch' OR is_lot_stap) ORDER BY volgorde");
      const rijen = await lees<{ batchnummer: string; stap: string; stand: string | null; dag: string | null; waarschuwing: string | null }>(
        app.db,
        `WITH bb AS (
           SELECT b.id, b.batchnummer, b.status, b.geplande_dag, b.volgorde, b.aangemaakt_op, p.code AS product, b.product_id,
                  (SELECT v.nummer FROM lot_voorstel_batch x JOIN lot_voorstel v ON v.id = x.voorstel_id
                    WHERE x.batch_id = b.id AND v.status = 'open' LIMIT 1) AS voorstel
             FROM batch b LEFT JOIN product p ON p.id = b.product_id
            WHERE b.status IN ('gepland', 'in_productie', 'in_beoordeling') AND b.lot_id IS NULL
         ), st AS (
           SELECT id, code, volgorde FROM processtap WHERE actief AND niveau = 'batch'
         ), cel AS (
           SELECT bb.*, st.id AS stap_id, st.code AS stap, st.volgorde AS stapvolgorde,
                  in_route(bb.product_id, st.id) AS in_route,
                  (SELECT r.status FROM stapregistratie r
                    WHERE r.batch_id = bb.id AND r.processtap_id = st.id AND r.status <> 'afgebroken'
                    ORDER BY r.poging DESC LIMIT 1) AS reg,
                  (SELECT (r.afgerond_op AT TIME ZONE fabriekstijdzone())::date FROM stapregistratie r
                    WHERE r.batch_id = bb.id AND r.processtap_id = st.id AND r.status = 'afgerond'
                    ORDER BY r.poging DESC LIMIT 1) AS klaar_op,
                  (SELECT min(d) FROM (SELECT sp.dag AS d FROM stapplanning sp WHERE sp.batch_id = bb.id AND sp.processtap_id = st.id
                                        UNION ALL SELECT bb.geplande_dag WHERE st.id = route_eerste(bb.product_id, 'batch')) z) AS plandag
             FROM bb CROSS JOIN st
         )
         SELECT batchnummer, status, product, voorstel, to_char(coalesce(geplande_dag, aangemaakt_op::date), 'YYYY-MM-DD') AS startdag,
                stap,
                CASE reg WHEN 'afgerond' THEN 'klaar' WHEN 'open' THEN 'bezig'
                  ELSE CASE WHEN NOT in_route THEN 'niet_in_route' WHEN plandag IS NOT NULL THEN 'gepland' END END AS stand,
                to_char(CASE reg WHEN 'afgerond' THEN klaar_op WHEN 'open' THEN NULL ELSE plandag END, 'YYYY-MM-DD') AS dag,
                CASE WHEN reg IS NULL AND plandag IS NOT NULL AND in_route THEN
                  (SELECT CASE x.stand
                            WHEN 'achter' THEN x.vorige || ' stond op ' || to_char(x.dag, 'DD-MM') || ' en is nog niet klaar'
                            WHEN 'later' THEN x.vorige || ' is pas gepland op ' || to_char(x.dag, 'DD-MM')
                            WHEN 'niet_gepland' THEN x.vorige || ' is nog niet gepland'
                          END
                     FROM planning_vorige_stap(stap_id, id, NULL, plandag) x)
                END AS waarschuwing
           FROM cel
          ORDER BY coalesce(geplande_dag, aangemaakt_op::date), volgorde NULLS LAST, batchnummer, stapvolgorde`,
      );
      const batches = new Map<string, { batchnummer: string; status: string; product: string | null; startdag: string | null; voorstel: number | null; cellen: unknown[] }>();
      for (const r of rijen as never as { batchnummer: string; status: string; product: string | null; startdag: string; voorstel: number | null; stap: string; stand: string | null; dag: string | null; waarschuwing: string | null }[]) {
        if (!batches.has(r.batchnummer)) batches.set(r.batchnummer, { batchnummer: r.batchnummer, status: r.status, product: r.product, startdag: r.startdag, voorstel: r.voorstel, cellen: [] });
        batches.get(r.batchnummer)!.cellen.push({ stap: r.stap, stand: r.stand, dag: r.dag, waarschuwing: r.waarschuwing });
      }
      return { stappen, batches: [...batches.values()] } as never;
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
        description: "Wat je in deze stap kunt plannen. 'klaar' = staat nu in de werkvoorraad van de stap. 'vorige' = hoe de vorige stap ervoor staat als je het op 'dag' plant (standaard vandaag).",
        querystring: Type.Object({ stap: StapCode, dag: Type.Optional(Dag) }),
        response: {
          200: Type.Array(Type.Object({ soort: Type.String(), nummer: Type.String(), klaar: Type.Boolean(), toelichting: OptTekst, vorige: Type.Optional(Type.Union([Type.Null(), Vorige])) })),
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
      const dag = req.query.dag ?? null;
      if (stap.is_lot_stap) {
        return lees(
          app.db,
          `SELECT 'voorstel' AS soort, v.nummer::text AS nummer,
                  NOT EXISTS (SELECT 1 FROM lot_voorstel_batch x JOIN batch b ON b.id = x.batch_id
                               WHERE x.voorstel_id = v.id AND b.batchnummer NOT IN (SELECT nummer FROM werkvoorraad($1))) AS klaar,
                  (SELECT string_agg(b.batchnummer, ', ' ORDER BY b.batchnummer) FROM lot_voorstel_batch x JOIN batch b ON b.id = x.batch_id
                    WHERE x.voorstel_id = v.id) AS toelichting,
                  ${vorigeSql("$2::uuid", "NULL::uuid", "NULL::uuid", "v.id", "coalesce($3::date, current_date)")} AS vorige
             FROM lot_voorstel v WHERE v.status = 'open' ORDER BY v.nummer`,
          [req.query.stap, stap.id, dag],
        ) as never;
      }
      if (stap.niveau === "lot") {
        return lees(
          app.db,
          `SELECT 'lot' AS soort, l.lotnummer AS nummer, l.lotnummer IN (SELECT nummer FROM werkvoorraad($1)) AS klaar, NULL AS toelichting,
                  ${vorigeSql("$2::uuid", "NULL::uuid", "l.id", "NULL::uuid", "coalesce($3::date, current_date)")} AS vorige
             FROM lot l
            WHERE in_route(lot_product(l.id), $2)
              AND (l.status = 'in_productie'
                   OR EXISTS (SELECT 1 FROM herbewerking h WHERE h.lot_id = l.id AND h.status = 'open' AND h.processtap_id = $2))
            ORDER BY 3 DESC, l.lotnummer`,
          [req.query.stap, stap.id, dag],
        ) as never;
      }
      return lees(
        app.db,
        `SELECT 'batch' AS soort, b.batchnummer AS nummer, b.batchnummer IN (SELECT nummer FROM werkvoorraad($1)) AS klaar,
                concat_ws(' · ', p.code, CASE WHEN b.status = 'gepland' THEN 'gepland voor ' || to_char(b.geplande_dag, 'DD-MM') END) AS toelichting,
                ${vorigeSql("$2::uuid", "b.id", "NULL::uuid", "NULL::uuid", "coalesce($3::date, current_date)")} AS vorige
           FROM batch b LEFT JOIN product p ON p.id = b.product_id
          WHERE b.status IN ('gepland', 'in_productie', 'in_beoordeling')
            AND in_route(b.product_id, $2)
            AND (NOT batch_stap_gedaan(b.id, $2)   -- ook een batch die na een herbewerking deze stap opnieuw doet (#61)
                 OR EXISTS (SELECT 1 FROM herbewerking h WHERE h.batch_id = b.id AND h.status = 'open' AND h.processtap_id = $2))
          ORDER BY 3 DESC, coalesce(b.geplande_dag, b.aangemaakt_op::date), b.volgorde NULLS LAST, b.batchnummer`,
        [req.query.stap, stap.id, dag],
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

  // ---------- Capaciteit ----------
  app.get(
    "/capaciteit",
    {
      preHandler: vereist(...IEDEREEN),
      schema: {
        tags: ["planning"],
        description:
          "Capaciteit per product voor elke stap van zijn route (D55, D71): stappen zonder capaciteit staan erbij met max_per_dag null (nog invullen, #81). " +
          "Plus de afwijkende capaciteit die vandaag of later geldt, of tot 30 dagen geleden eindigde (D69).",
        response: {
          200: Type.Object({
            per_stap: Type.Array(Type.Object({
              product: Type.String(), productnaam: Type.String(), stap: Type.String(), stapnaam: Type.String(),
              niveau: Type.String({ description: "batch of lot: wat de capaciteit telt" }),
              max_per_dag: NulGeheel({ description: "Per dag; null = nog niet ingevuld" }),
            }), { description: "Per actief product elke stap van zijn route, in de volgorde van de route" }),
            nog_invullen: Type.Integer({ description: "Aantal stappen uit een route zonder capaciteit" }),
            afwijkingen: Type.Array(Afwijking),
          }),
        },
      },
    },
    async () => {
      const per_stap = await lees<{ max_per_dag: number | null }>(app.db,
        `SELECT p.code AS product, p.naam AS productnaam, s.code AS stap, s.naam AS stapnaam, s.niveau, c.max_per_dag
           FROM capaciteit_route c JOIN processtap s ON s.id = c.processtap_id JOIN product p ON p.id = c.product_id
          ORDER BY p.code, c.plek`);
      const afwijkingen = await lees(app.db, `${AFWIJKING_SQL} AND a.tot >= current_date - 30 ORDER BY a.van, a.tot, s.volgorde NULLS FIRST, p.code NULLS FIRST`);
      return { per_stap, nog_invullen: per_stap.filter((r) => r.max_per_dag === null).length, afwijkingen } as never;
    },
  );

  app.post(
    "/capaciteit/afwijkingen",
    {
      preHandler: vereist(...PLANNEN),
      schema: {
        tags: ["planning"],
        description:
          "Afwijkende capaciteit in een periode (D69), bijvoorbeeld onderhoud of een feestdag. Stap null = alle stappen, product null = alle producten. " +
          "procent is het deel van de gewone capaciteit; 0 = geen productie. Gelden er meer regels tegelijk, dan telt het laagste percentage.",
        body: Type.Object({
          van: Dag,
          tot: Type.Optional(Dag),
          stap: Type.Union([Type.Null(), StapCode]),
          product: Type.Union([Type.Null(), Type.String({ maxLength: 40 })]),
          procent: Type.Integer({ minimum: 0, maximum: 100 }),
          reden: Type.String({ minLength: 2, maxLength: 200 }),
        }),
        response: { 201: Afwijking },
      },
    },
    async (req, reply) => {
      const rij = await inTransactie(app.db, req.user.naam, async (tx) => {
        const stap = req.body.stap
          ? (await tx.query("SELECT id FROM processtap WHERE code = $1 AND actief", [req.body.stap])).rows[0]?.id
          : null;
        if (req.body.stap && !stap) throw niet("Stap");
        const product = req.body.product
          ? (await tx.query("SELECT id FROM product WHERE code = $1", [req.body.product])).rows[0]?.id
          : null;
        if (req.body.product && !product) throw niet("Product");
        const { rows } = await tx.query(
          `INSERT INTO capaciteit_afwijking (van, tot, processtap_id, product_id, procent, reden)
           VALUES ($1::date, coalesce($2::date, $1::date), $3, $4, $5, $6) RETURNING id`,
          [req.body.van, req.body.tot ?? null, stap, product, req.body.procent, req.body.reden.trim()],
        );
        return (await tx.query(`${AFWIJKING_SQL} AND a.id = $1`, [rows[0].id])).rows[0];
      });
      return reply.status(201).send(rij);
    },
  );

  app.post(
    "/capaciteit/afwijkingen/:id/weghalen",
    {
      preHandler: vereist(...PLANNEN),
      schema: { tags: ["planning"], params: Type.Object({ id: Type.String({ format: "uuid" }) }), response: { 204: Type.Null() } },
    },
    async (req, reply) => {
      const n = await inTransactie(app.db, req.user.naam, async (tx) =>
        (await tx.query("UPDATE capaciteit_afwijking SET actief = false WHERE id = $1 AND actief", [req.params.id])).rowCount);
      if (!n) throw niet("Afwijking");
      return reply.status(204).send(null);
    },
  );

  app.put(
    "/capaciteit/stappen/:stap",
    {
      preHandler: vereist(...PLANNEN),
      schema: {
        tags: ["planning"],
        description:
          "Capaciteit van een stap per dag voor één product (D55, D71). max_per_dag null haalt de regel weg (de stap staat dan weer op nog invullen). " +
          "Bij gemengde producten telt elk item voor zijn deel van de capaciteit.",
        params: Type.Object({ stap: StapCode }),
        body: Type.Object({
          product: Type.String({ minLength: 1, maxLength: 40 }),
          max_per_dag: Type.Union([Type.Null(), Type.Integer({ minimum: 1, maximum: 500 })]),
        }),
        response: { 204: Type.Null() },
      },
    },
    async (req, reply) => {
      await inTransactie(app.db, req.user.naam, async (tx) => {
        const { rows } = await tx.query(
          `SELECT s.id AS stap, p.id AS product FROM processtap s LEFT JOIN product p ON p.code = $2 WHERE s.code = $1 AND s.actief`,
          [req.params.stap, req.body.product],
        );
        if (!rows[0]) throw niet("Stap");
        if (!rows[0].product) throw niet("Product");
        if (req.body.max_per_dag === null) {
          await tx.query("DELETE FROM capaciteit_stap WHERE processtap_id = $1 AND product_id = $2", [rows[0].stap, rows[0].product]);
        } else {
          await tx.query(
            `INSERT INTO capaciteit_stap (processtap_id, product_id, max_per_dag) VALUES ($1, $2, $3)
             ON CONFLICT (processtap_id, product_id) DO UPDATE SET max_per_dag = EXCLUDED.max_per_dag`,
            [rows[0].stap, rows[0].product, req.body.max_per_dag],
          );
        }
      });
      return reply.status(204).send(null);
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
            laatste_stap: OptTekst, klaar_voor_lot: Type.Boolean(), voorstel: NulGeheel(),
          })),
        },
      },
    },
    async () =>
      lees(
        app.db,
        `SELECT x.batchnummer, x.status, x.product, x.dag, x.laatste_stap, x.voorstel,
                x.status = 'in_productie' AND batch_klaar_voor_lot((SELECT id FROM batch WHERE batchnummer = x.batchnummer)) AS klaar_voor_lot
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
