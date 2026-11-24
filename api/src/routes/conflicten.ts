import { Type } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { invoerTransactie } from "../auth.js";
import { personalSession } from "../modules/authorization/access.js";
import { lees } from "../db.js";
import { ApiFout, niet } from "../fouten.js";
import { CONFLICT_SQL, registratieDetail } from "./registraties.js";
import { Conflict, RegistratieDetail } from "./schemas.js";

/** Conflicten bij gelijktijdige invoer (#85, D75): wat twee keer is ingevuld, en de keuze welke blijft. */
const routes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/",
    {
      preHandler: personalSession,
      schema: {
        tags: ["conflicten"],
        description: "Open conflicten, oudste eerst, met de stap en de batch of het lot erbij.",
        response: {
          200: Type.Array(Type.Intersect([
            Conflict,
            Type.Object({
              registratie_id: Type.String({ format: "uuid" }),
              stap: Type.String(),
              nummer: Type.String({ description: "Batch- of lotnummer" }),
            }),
          ])),
        },
      },
    },
    async (req) => {
      // Productgebonden grants gelden uitsluitend voor het eigen product.
      const [gate] = await lees<{ allowed: boolean }>(app.db, `SELECT EXISTS (
        SELECT 1 FROM authorization_grant g
        CROSS JOIN (VALUES ('execution.correct'), ('inspection.decide')) p(permission)
        WHERE g.user_id=$1 AND authorization_permits($1,p.permission,NULL,g.product_id,NULL)
      ) AS allowed`, [req.user.sub]);
      if (!gate?.allowed) throw new ApiFout(403, "Geen geldige MES-bevoegdheid voor conflictbeoordeling");
      return (await lees(
        app.db,
        `SELECT x.*, r.id AS registratie_id, s.code AS stap, coalesce(b.batchnummer, l.lotnummer) AS nummer
           FROM (${CONFLICT_SQL} WHERE c.status = 'open') x
           JOIN invoerconflict c ON c.id = x.id
           JOIN stapregistratie r ON r.id = c.stapregistratie_id JOIN processtap s ON s.id = r.processtap_id
           LEFT JOIN batch b ON b.id = r.batch_id LEFT JOIN lot l ON l.id = r.lot_id
          CROSS JOIN LATERAL (SELECT CASE WHEN EXISTS (SELECT 1 FROM veld v WHERE v.id=c.veld_id AND v.gemeten_door='kwaliteit')
            THEN 'inspection.decide' ELSE 'execution.correct' END AS permission) p
          WHERE authorization_permits($1,p.permission,NULL,r.product_id,NULL)
            AND (r.lot_id IS NULL OR NOT EXISTS (SELECT 1 FROM batch lb WHERE lb.lot_id=r.lot_id
              AND NOT authorization_permits($1,p.permission,NULL,lb.product_id,NULL)))
          ORDER BY c.ontvangen_op`, [req.user.sub],
      )) as never;
    },
  );

  app.post(
    "/:id/oplossen",
    {
      preHandler: personalSession,
      schema: {
        tags: ["conflicten"],
        description:
          "Kies welke invoer blijft: bestaand (wat er staat) of nieuw (de tweede invoer, als correctie met reden; het origineel blijft bewaard). " +
          "Een kwaliteitsveld vereist inspection.decide; andere conflicten execution.correct. Dezelfde keuze opnieuw versturen geeft de stand terug.",
        params: Type.Object({ id: Type.String({ format: "uuid" }) }),
        body: Type.Object({
          keuze: Type.Union([Type.Literal("bestaand"), Type.Literal("nieuw")]),
          reden: Type.String({ minLength: 1, maxLength: 500 }),
        }),
        response: { 200: RegistratieDetail },
      },
    },
    async (req) => {
      const [c] = await lees<{ stapregistratie_id: string }>(app.db, "SELECT stapregistratie_id FROM invoerconflict WHERE id = $1", [req.params.id]);
      if (!c) throw niet("Conflict");
      await invoerTransactie(app.db, req, (tx) =>
        tx.query("SELECT execution_resolve_conflict($1, $2, $3)", [req.params.id, req.body.keuze, req.body.reden]));
      return (await registratieDetail(app.db, c.stapregistratie_id)) as never;
    },
  );
};

export default routes;
