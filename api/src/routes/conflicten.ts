import { Type } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { vereist } from "../auth.js";
import { inTransactie, lees } from "../db.js";
import { niet } from "../fouten.js";
import { CONFLICT_SQL, registratieDetail } from "./registraties.js";
import { Conflict, RegistratieDetail } from "./schemas.js";

/** Conflicten bij gelijktijdige invoer (#85, D75): wat twee keer is ingevuld, en de keuze welke blijft. */
const routes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/",
    {
      preHandler: vereist("ploegleider", "kwaliteit", "beheerder"),
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
    async () =>
      (await lees(
        app.db,
        `SELECT x.*, r.id AS registratie_id, s.code AS stap, coalesce(b.batchnummer, l.lotnummer) AS nummer
           FROM (${CONFLICT_SQL} WHERE c.status = 'open') x
           JOIN invoerconflict c ON c.id = x.id
           JOIN stapregistratie r ON r.id = c.stapregistratie_id JOIN processtap s ON s.id = r.processtap_id
           LEFT JOIN batch b ON b.id = r.batch_id LEFT JOIN lot l ON l.id = r.lot_id
          ORDER BY c.ontvangen_op`,
      )) as never,
  );

  app.post(
    "/:id/oplossen",
    {
      preHandler: vereist("ploegleider", "kwaliteit", "beheerder"),
      schema: {
        tags: ["conflicten"],
        description:
          "Kies welke invoer blijft: bestaand (wat er staat) of nieuw (de tweede invoer, als correctie met reden; het origineel blijft bewaard). " +
          "Een veld van Kwaliteit: Kwaliteit of de beheerder; anders een ploegleider of de beheerder. Dezelfde keuze opnieuw versturen geeft de stand terug.",
        params: Type.Object({ id: Type.String({ format: "uuid" }) }),
        body: Type.Object({
          keuze: Type.Union([Type.Literal("bestaand"), Type.Literal("nieuw")]),
          reden: Type.Optional(Type.Union([Type.Null(), Type.String({ maxLength: 500 })])),
        }),
        response: { 200: RegistratieDetail },
      },
    },
    async (req) => {
      const [c] = await lees<{ stapregistratie_id: string }>(app.db, "SELECT stapregistratie_id FROM invoerconflict WHERE id = $1", [req.params.id]);
      if (!c) throw niet("Conflict");
      await inTransactie(app.db, req.user.naam, (tx) =>
        tx.query("SELECT los_invoerconflict_op($1, $2, $3, $4)", [req.params.id, req.body.keuze, req.user.sub, req.body.reden ?? null]));
      return (await registratieDetail(app.db, c.stapregistratie_id)) as never;
    },
  );
};

export default routes;
