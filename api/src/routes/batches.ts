import { Type } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { invoerContext, invoerTransactie } from "../auth.js";
import { personalSession, requiresPermission, requireTransactionPermission } from "../modules/authorization/access.js";
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
      preHandler: requiresPermission("execution.batch.create"),
      schema: {
        tags: ["batches"],
        body: Type.Object({
          id: Type.Optional(Type.String({ format: "uuid", description: "Door het apparaat gemaakt; maakt opnieuw versturen veilig" })),
          batchnummer: BatchNummer,
        }),
        response: { 200: Batch, 201: Batch },
      },
    },
    async (req, reply) => {
      const { operatorId } = await invoerContext(app.db, req);
      const { id, batchnummer } = req.body;
      if (id) {
        const [bestaand] = await lees<{ batchnummer: string; aangemaakt_door: string | null }>(app.db, "SELECT batchnummer,aangemaakt_door FROM batch WHERE id = $1", [id]);
        if (bestaand) {
          if (bestaand.batchnummer !== batchnummer || bestaand.aangemaakt_door !== operatorId) throw new ApiFout(409, "Dit id hoort bij een andere batch");
          const [batch] = await lees(app.db, `${BATCH_SQL} WHERE b.batchnummer = $1`, [batchnummer]);
          return reply.status(200).send(batch as never);
        }
      }
      await inTransactie(app.db, req.user.naam, (tx) =>
        tx.query("INSERT INTO batch (id, batchnummer, bron, aangemaakt_door) VALUES (coalesce($1, gen_random_uuid()), $2, 'operator', $3)", [
          id ?? null,
          batchnummer,
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
      preHandler: personalSession,
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
      const voorwaarden: string[] = ["authorization_read_execution($1,b.product_id)"];
      const params: unknown[] = [req.user.sub];
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
      preHandler: personalSession,
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
      const [batch] = await lees(app.db, `${BATCH_SQL} WHERE b.batchnummer = $1 AND authorization_read_execution($2,b.product_id)`, [req.params.batchnummer,req.user.sub]);
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
      preHandler: personalSession,
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
        app.db, `${BATCH_SQL} WHERE b.batchnummer = $1 AND authorization_read_execution($2,b.product_id)`, [req.params.batchnummer,req.user.sub]);
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
      preHandler: personalSession,
      schema: {
        tags: ["batches"],
        description:
          "in_beoordeling: ploegleider, productiemanager of kwaliteit. vrijgegeven (keurresultaat OK) en afgekeurd (keurresultaat NOK): alleen kwaliteit.",
        params: Type.Object({ batchnummer: BatchNummer }),
        body: Type.Object({
          besluit: Type.Union([Type.Literal("in_beoordeling"), Type.Literal("vrijgegeven"), Type.Literal("afgekeurd")]),
          reden: Type.String({ minLength: 1 }),
          wachtwoord: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
        }),
        response: { 201: Batch },
      },
    },
    async (req, reply) => {
      const status = await invoerTransactie(app.db, req, async (tx) => {
        const { rows } = await tx.query<{id:string;product_id:string|null}>("SELECT id,product_id FROM batch WHERE batchnummer = $1 FOR UPDATE", [req.params.batchnummer]);
        if (!rows[0]) throw niet("Batch");
        const target = {product: rows[0].product_id ?? undefined};
        if (req.body.besluit === "in_beoordeling") {
          const { rows: [permission] } = await tx.query<{allowed:boolean}>("SELECT authorization_permits($1,'execution.hold',NULL,$2,NULL) OR authorization_permits($1,'inspection.hold',NULL,$2,NULL) AS allowed", [req.user.sub,rows[0].product_id]);
          if (!permission?.allowed) throw new ApiFout(403,"Geen bevoegdheid voor blokkade");
        } else {
          await requireTransactionPermission(tx, req.user.sub,"inspection.batch.decide",target);
          if (!req.body.wachtwoord) throw new ApiFout(422,"Persoonlijke bevestiging vereist");
          const { rows: [result] } = await tx.query<{status:string}>("SELECT quality_decision_confirmed($1,$2,'batch',$3,$4,$5,NULL,$6) AS status",[req.user.sub,req.user.sessionVersion,rows[0].id,req.body.besluit,req.body.reden,req.body.wachtwoord]);
          return result?.status;
        }
        await tx.query("SELECT execution_batch_hold($1,$2)", [rows[0].id, req.body.reden]);
        return "decided";
      });
      if (status === "locked") throw new ApiFout(429,"Te veel wachtwoordpogingen");
      if (status !== "decided") throw new ApiFout(403,"Persoonlijke bevestiging geweigerd");
      const [batch] = await lees(app.db, `${BATCH_SQL} WHERE b.batchnummer = $1 AND authorization_read_execution($2,b.product_id)`, [req.params.batchnummer,req.user.sub]);
      return reply.status(201).send(batch as never);
    },
  );
};

export default routes;
