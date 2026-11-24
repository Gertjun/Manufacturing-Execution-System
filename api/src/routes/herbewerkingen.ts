import { Type } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { personalSession } from "../modules/authorization/access.js";
import { inTransactie, lees } from "../db.js";
import { ApiFout, niet } from "../fouten.js";

const Datum = Type.String({ format: "date" });
const Tijd = Type.String({ format: "date-time" });
const OptTekst = Type.Union([Type.Null(), Type.String()]);
const Stand = Type.Union(["te_plannen", "gepland", "bezig", "klaar", "gestopt", "ingetrokken"].map((x) => Type.Literal(x)));

const Herbewerking = Type.Object({
  id: Type.String({ format: "uuid" }),
  soort: Type.Union([Type.Literal("batch"), Type.Literal("lot")]),
  nummer: Type.String(),
  product: OptTekst,
  stap: Type.String(),
  stapnaam: Type.String(),
  reden: Type.String(),
  door: Type.Union([Type.Null(), Type.String()], { description: "Leeg = zonder opdracht gestart (ouder invoerscherm of van vóór 0.35.0)" }),
  aangemaakt_op: Tijd,
  gepland_op: Type.Union([Type.Null(), Datum]),
  gestart_op: Type.Union([Type.Null(), Tijd]),
  stand: Stand,
  ingetrokken_reden: OptTekst,
  ingetrokken_door: OptTekst,
});
const SELECT_SQL = `
  SELECT h.id, h.soort, h.nummer, p.code AS product, h.stap, h.stapnaam, h.reden, h.door, h.aangemaakt_op,
         to_char(h.gepland_op, 'YYYY-MM-DD') AS gepland_op, h.gestart_op, h.stand, h.ingetrokken_reden, h.ingetrokken_door
    FROM herbewerking_stand h LEFT JOIN product p ON p.id = h.product_id`;

const routes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/",
    {
      preHandler: personalSession,
      schema: {
        tags: ["herbewerkingen"],
        description:
          "Herbewerkingen met hun stand (#61). Wat nog niet klaar is (te plannen, gepland, bezig) staat er altijd in; de rest als hij in de periode is aangemaakt. Met nummer: alleen die batch of dat lot.",
        querystring: Type.Object({
          van: Type.Optional(Datum),
          tot: Type.Optional(Datum),
          product: Type.Optional(Type.String()),
          nummer: Type.Optional(Type.String()),
        }),
        response: { 200: Type.Array(Herbewerking) },
      },
    },
    async (req) =>
      lees(
        app.db,
        `${SELECT_SQL}
          WHERE authorization_read_execution($5,h.product_id) AND ($4::text IS NULL OR h.nummer = $4)
            AND ($3::text IS NULL OR p.code = $3)
            AND ($4::text IS NOT NULL OR h.stand IN ('te_plannen', 'gepland', 'bezig')
                 OR (($1::date IS NULL OR h.aangemaakt_op >= $1::date) AND ($2::date IS NULL OR h.aangemaakt_op < $2::date)))
          ORDER BY CASE h.stand WHEN 'te_plannen' THEN 1 WHEN 'gepland' THEN 2 WHEN 'bezig' THEN 3 ELSE 4 END, h.aangemaakt_op DESC
          LIMIT 1000`,
        [req.query.van ?? null, req.query.tot ?? null, req.query.product ?? null, req.query.nummer ?? null,req.user.sub],
      ) as never,
  );

  app.get(
    "/stappen",
    {
      preHandler: personalSession,
      schema: {
        tags: ["herbewerkingen"],
        description: "Naar welke stappen een batch of lot terug kan: stappen van hetzelfde niveau in de route die al doorlopen zijn.",
        querystring: Type.Object({ nummer: Type.String() }),
        response: { 200: Type.Array(Type.Object({ code: Type.String(), naam: Type.String() })) },
      },
    },
    async (req) => {
      const rijen = await lees<{ code: string; naam: string }>(
        app.db,
        `WITH x AS (SELECT b.id AS batch_id, NULL::uuid AS lot_id, b.product_id, 'batch' AS niveau FROM batch b WHERE b.batchnummer = $1
                    UNION ALL
                    SELECT NULL, l.id, lot_product(l.id), 'lot' FROM lot l WHERE l.lotnummer = $1)
         SELECT s.code, s.naam
           FROM x CROSS JOIN LATERAL route(x.product_id) r JOIN processtap s ON s.id = r.processtap_id AND s.niveau = x.niveau
          WHERE (authorization_permits($2,'inspection.rework.order',NULL,x.product_id,NULL) OR authorization_permits($2,'operations.rework.order',NULL,x.product_id,NULL)) AND EXISTS (SELECT 1 FROM stapregistratie g WHERE g.processtap_id = s.id AND g.status = 'afgerond'
                          AND (g.batch_id = x.batch_id OR g.lot_id = x.lot_id))
          ORDER BY r.plek`,
        [req.query.nummer,req.user.sub],
      );
      const [bestaat] = await lees(app.db, "SELECT 1 FROM batch WHERE batchnummer = $1 UNION ALL SELECT 1 FROM lot WHERE lotnummer = $1", [req.query.nummer]);
      if (!bestaat) throw niet("Batch of lot");
      return rijen as never;
    },
  );

  app.post(
    "/",
    {
      preHandler: personalSession,
      schema: {
        tags: ["herbewerkingen"],
        description:
          "Een batch (nog niet in een lot) of een lot terug naar een stap die al doorlopen is. Een batch in beoordeling: alleen Kwaliteit, en dat is dan het keurresultaat herbewerken.",
        body: Type.Object({
          id: Type.Optional(Type.String({ format: "uuid" })),
          nummer: Type.String({ examples: ["B-2026-0123", "L-2026-0042"] }),
          stapcode: Type.String({ examples: ["PS3"] }),
          reden: Type.String({ minLength: 1, maxLength: 500 }),
          wachtwoord: Type.String({ minLength: 1, maxLength: 200 }),
        }),
        response: { 201: Herbewerking },
      },
    },
    async (req, reply) => {
      const result = await inTransactie(app.db, req.user.naam, async (tx) => {
        const { rows: [target] } = await tx.query<{allowed:boolean}>(
          "SELECT authorization_permits($2,'inspection.rework.order',NULL,product_id,NULL) OR (status <> 'in_beoordeling' AND authorization_permits($2,'operations.rework.order',NULL,product_id,NULL)) AS allowed FROM batch WHERE batchnummer=$1 UNION ALL SELECT authorization_permits($2,'inspection.rework.order',NULL,lot_product(id),NULL) OR authorization_permits($2,'operations.rework.order',NULL,lot_product(id),NULL) FROM lot WHERE lotnummer=$1",[req.body.nummer,req.user.sub]);
        if (!target) throw niet("Batch of lot");
        if (!target.allowed) throw new ApiFout(403,"Geen bevoegdheid voor herbewerking");
        return (await tx.query<{status:string;order_id:string|null}>("SELECT * FROM rework_order_confirmed($1,$2,$3,$4,$5,$6,$7)",[req.user.sub,req.user.sessionVersion,req.body.nummer,req.body.stapcode,req.body.reden,req.body.id ?? null,req.body.wachtwoord])).rows[0];
      });
      if (result?.status === "locked") throw new ApiFout(429,"Te veel wachtwoordpogingen");
      if (result?.status !== "created" || !result.order_id) throw new ApiFout(403,"Persoonlijke bevestiging geweigerd");
      const [h] = await lees(app.db, `${SELECT_SQL} WHERE h.id = $1`, [result.order_id]);
      return reply.status(201).send(h as never);
    },
  );

  app.post(
    "/:id/intrekken",
    {
      preHandler: personalSession,
      schema: {
        tags: ["herbewerkingen"],
        description: "Een herbewerking die nog niet gestart is, intrekken.",
        params: Type.Object({ id: Type.String({ format: "uuid" }) }),
        body: Type.Object({ reden: Type.String({ minLength: 1, maxLength: 500 }), wachtwoord: Type.String({ minLength: 1, maxLength: 200 }) }),
        response: { 200: Herbewerking },
      },
    },
    async (req) => {
      const status = await inTransactie(app.db, req.user.naam, async (tx) => {
        const { rows: [target] } = await tx.query<{allowed:boolean}>("SELECT authorization_permits($2,'inspection.rework.order',NULL,product_id,NULL) OR authorization_permits($2,'operations.rework.order',NULL,product_id,NULL) AS allowed FROM herbewerking_stand WHERE id=$1",[req.params.id,req.user.sub]);
        if (!target) throw niet("Herbewerking");
        if (!target.allowed) throw new ApiFout(403,"Geen bevoegdheid voor herbewerking");
        return (await tx.query<{status:string}>("SELECT rework_cancel_confirmed($1,$2,$3,$4,$5) AS status",[req.user.sub,req.user.sessionVersion,req.params.id,req.body.reden,req.body.wachtwoord])).rows[0]?.status;
      });
      if (status === "locked") throw new ApiFout(429,"Te veel wachtwoordpogingen");
      if (status !== "cancelled") throw new ApiFout(403,"Persoonlijke bevestiging geweigerd");
      const [h] = await lees(app.db, `${SELECT_SQL} WHERE h.id = $1`, [req.params.id]);
      if (!h) throw niet("Herbewerking");
      return h as never;
    },
  );
};

export default routes;
