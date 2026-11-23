import { Type } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { IEDEREEN, INVOER, invoerContext, vereist } from "../auth.js";
import { inTransactie, lees } from "../db.js";
import { ApiFout, niet } from "../fouten.js";
import { Batch, BatchNummer, Besluit, PaspoortRegel, RegistratieKort, REGISTRATIE_SQL } from "./schemas.js";

const BATCH_SQL = `
  SELECT b.batchnummer, b.status, b.bron, l.lotnummer, b.aangemaakt_op,
         (SELECT s.code FROM stapregistratie r JOIN processtap s ON s.id = r.processtap_id
           WHERE r.batch_id = b.id AND r.status = 'afgerond' ORDER BY r.afgerond_op DESC LIMIT 1) AS laatst_afgeronde_stap,
         (SELECT s.code FROM stapregistratie r JOIN processtap s ON s.id = r.processtap_id
           WHERE r.batch_id = b.id AND r.status = 'open' LIMIT 1) AS open_stap,
         p.code AS product
    FROM batch b LEFT JOIN lot l ON l.id = b.lot_id LEFT JOIN product p ON p.id = b.product_id`;

const routes: FastifyPluginAsyncTypebox = async (app) => {
  // Batch aanmaken (in PS1, tot de planner-app er is).
  app.post(
    "/",
    {
      preHandler: vereist(...INVOER),
      schema: {
        tags: ["batches"],
        body: Type.Object({
          id: Type.Optional(Type.String({ format: "uuid", description: "Door het apparaat gemaakt; maakt opnieuw versturen veilig" })),
          batchnummer: BatchNummer,
          productId: Type.Optional(Type.Union([Type.Null(), Type.String({ format: "uuid" })])),
        }),
        response: { 200: Batch, 201: Batch },
      },
    },
    async (req, reply) => {
      const { operatorId } = await invoerContext(app.db, req);
      const { id, batchnummer } = req.body;
      if (id) {
        const [bestaand] = await lees<{ batchnummer: string }>(app.db, "SELECT batchnummer FROM batch WHERE id = $1", [id]);
        if (bestaand) {
          if (bestaand.batchnummer !== batchnummer) throw new ApiFout(409, "Dit id hoort bij een andere batch");
          const [batch] = await lees(app.db, `${BATCH_SQL} WHERE b.batchnummer = $1`, [batchnummer]);
          return reply.status(200).send(batch as never);
        }
      }
      await inTransactie(app.db, req.user.naam, (tx) =>
        tx.query("INSERT INTO batch (id, batchnummer, product_id, bron, aangemaakt_door) VALUES (coalesce($1, gen_random_uuid()), $2, $3, 'operator', $4)", [
          id ?? null,
          batchnummer,
          req.body.productId ?? null,
          operatorId,
        ]),
      );
      const [batch] = await lees(app.db, `${BATCH_SQL} WHERE b.batchnummer = $1`, [req.body.batchnummer]);
      return reply.status(201).send(batch as never);
    },
  );

  app.get(
    "/",
    {
      preHandler: vereist(...IEDEREEN),
      schema: {
        tags: ["batches"],
        querystring: Type.Object({
          status: Type.Optional(Type.String({ description: "gepland, in_productie, in_beoordeling, in_lot, afgekeurd" })),
          gereedVoorLot: Type.Optional(Type.Boolean({ description: "Alleen batches die de batchstappen van hun route afrondden en in productie zijn" })),
          limiet: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, default: 100 })),
        }),
        response: { 200: Type.Array(Batch) },
      },
    },
    async (req) => {
      const voorwaarden: string[] = [];
      const params: unknown[] = [];
      if (req.query.status) {
        params.push(req.query.status);
        voorwaarden.push(`b.status = $${params.length}`);
      }
      if (req.query.gereedVoorLot) {
        voorwaarden.push(`b.status = 'in_productie' AND batch_klaar_voor_lot(b.id)`);
      }
      params.push(req.query.limiet ?? 100);
      const where = voorwaarden.length ? `WHERE ${voorwaarden.join(" AND ")}` : "";
      return lees(app.db, `${BATCH_SQL} ${where} ORDER BY b.aangemaakt_op DESC LIMIT $${params.length}`, params) as never;
    },
  );

  app.get(
    "/:batchnummer",
    {
      preHandler: vereist(...IEDEREEN),
      schema: {
        tags: ["batches"],
        params: Type.Object({ batchnummer: BatchNummer }),
        response: {
          200: Type.Intersect([
            Batch,
            Type.Object({ registraties: Type.Array(RegistratieKort), besluiten: Type.Array(Besluit) }),
          ]),
        },
      },
    },
    async (req) => {
      const [batch] = await lees(app.db, `${BATCH_SQL} WHERE b.batchnummer = $1`, [req.params.batchnummer]);
      if (!batch) throw niet("Batch");
      const registraties = await lees(app.db, `${REGISTRATIE_SQL} WHERE b.batchnummer = $1 ORDER BY r.gestart_op, s.volgorde`, [
        req.params.batchnummer,
      ]);
      const besluiten = await lees(
        app.db,
        `SELECT d.besluit, d.reden, g.gebruikersnaam AS besloten_door, d.besloten_op
           FROM batch_besluit d JOIN batch b ON b.id = d.batch_id JOIN gebruiker g ON g.id = d.besloten_door
          WHERE b.batchnummer = $1 ORDER BY d.besloten_op`,
        [req.params.batchnummer],
      );
      return { ...batch, registraties, besluiten } as never;
    },
  );

  // Alle actuele waarden van één batch, afwijkingen eerst: de basis om een batch te keuren.
  app.get(
    "/:batchnummer/paspoort",
    {
      preHandler: vereist(...IEDEREEN),
      schema: {
        tags: ["batches", "analyse"],
        params: Type.Object({ batchnummer: BatchNummer }),
        response: {
          200: Type.Object({
            batchnummer: Type.String(),
            status: Type.String(),
            lotnummer: Type.Union([Type.Null(), Type.String()]),
            aantal_afwijkingen: Type.Integer(),
            besluiten: Type.Array(Besluit),
            regels: Type.Array(PaspoortRegel),
          }),
        },
      },
    },
    async (req) => {
      const [batch] = await lees<{ batchnummer: string; status: string; lotnummer: string | null }>(
        app.db, `${BATCH_SQL} WHERE b.batchnummer = $1`, [req.params.batchnummer]);
      if (!batch) throw niet("Batch");
      const regels = await lees<{ markering: string }>(
        app.db,
        `SELECT b.batchnummer AS batch_of_lot, s.code AS stap, r.poging, r.reden AS herbewerking_reden,
                v.code AS veld, v.naam AS veldnaam, v.eenheid, w.setting, w.gemeten, w.grens_min, w.grens_max,
                w.tolerantie, w.tolerantie_soort, w.markering, (w.vervangt_waarde_id IS NOT NULL) AS gecorrigeerd,
                o.naam AS operator, p.naam AS pc, r.afgerond_op
           FROM batch b
           JOIN stapregistratie r ON r.batch_id = b.id
           JOIN processtap s ON s.id = r.processtap_id
           JOIN waarde_actueel w ON w.stapregistratie_id = r.id
           JOIN veld v ON v.id = w.veld_id
           JOIN operator o ON o.id = r.operator_id
           JOIN pc p ON p.id = r.pc_id
          WHERE b.batchnummer = $1
          ORDER BY (w.markering = 'ok'), s.volgorde, r.poging, v.volgnummer`,
        [req.params.batchnummer],
      );
      const besluiten = await lees(
        app.db,
        `SELECT d.besluit, d.reden, g.gebruikersnaam AS besloten_door, d.besloten_op
           FROM batch_besluit d JOIN batch b ON b.id = d.batch_id JOIN gebruiker g ON g.id = d.besloten_door
          WHERE b.batchnummer = $1 ORDER BY d.besloten_op`,
        [req.params.batchnummer],
      );
      return {
        batchnummer: batch.batchnummer, status: batch.status, lotnummer: batch.lotnummer,
        aantal_afwijkingen: regels.filter((r) => r.markering !== "ok").length, besluiten, regels,
      } as never;
    },
  );

  // In beoordeling zetten (ploegleider of Kwaliteit); keurresultaat OK/NOK (alleen Kwaliteit).
  app.post(
    "/:batchnummer/besluiten",
    {
      preHandler: vereist("ploegleider", "kwaliteit", "productiemanager"),
      schema: {
        tags: ["batches"],
        description:
          "in_beoordeling: ploegleider, productiemanager of kwaliteit. vrijgegeven (keurresultaat OK) en afgekeurd (keurresultaat NOK): alleen kwaliteit.",
        params: Type.Object({ batchnummer: BatchNummer }),
        body: Type.Object({
          besluit: Type.Union([Type.Literal("in_beoordeling"), Type.Literal("vrijgegeven"), Type.Literal("afgekeurd")]),
          reden: Type.String({ minLength: 1 }),
        }),
        response: { 201: Batch },
      },
    },
    async (req, reply) => {
      await inTransactie(app.db, req.user.naam, async (tx) => {
        const { rows } = await tx.query("SELECT id FROM batch WHERE batchnummer = $1", [req.params.batchnummer]);
        if (!rows[0]) throw niet("Batch");
        await tx.query("INSERT INTO batch_besluit (batch_id, besluit, reden, besloten_door) VALUES ($1, $2, $3, $4)", [
          rows[0].id,
          req.body.besluit,
          req.body.reden,
          req.user.sub,
        ]);
      });
      const [batch] = await lees(app.db, `${BATCH_SQL} WHERE b.batchnummer = $1`, [req.params.batchnummer]);
      return reply.status(201).send(batch as never);
    },
  );
};

export default routes;
