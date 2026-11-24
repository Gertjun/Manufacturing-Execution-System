import { Type } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { invoerTransactie } from "../auth.js";
import { personalSession, requiresPermission } from "../modules/authorization/access.js";
import { lees } from "../db.js";
import { ApiFout } from "../fouten.js";
import { registratieDetail } from "./registraties.js";
import { BatchNummer, RegistratieDetail, StapCode } from "./schemas.js";

/**
 * Nainvoeren na papier (#75, D60): lag de invoer stil, dan voert een bevoegd persoonlijk account de stap
 * later in met de tijden van het papier (tot 7 dagen terug). De regels staan in lever_stap_na.
 */
const routes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/keuzes",
    {
      preHandler: requiresPermission("execution.correct"),
      schema: {
        tags: ["nalevering"],
        description: "Actieve pc's en namen om te kiezen bij het nainvoeren.",
        response: {
          200: Type.Object({
            pcs: Type.Array(Type.Object({ id: Type.String({ format: "uuid" }), naam: Type.String() })),
            operators: Type.Array(Type.Object({ id: Type.String({ format: "uuid" }), naam: Type.String() })),
          }),
        },
      },
    },
    async () => ({
      pcs: await lees(app.db, "SELECT id, naam FROM pc WHERE actief ORDER BY naam"),
      operators: await lees(app.db, "SELECT id, naam FROM operator WHERE actief ORDER BY naam"),
    }) as never,
  );

  app.post(
    "/",
    {
      preHandler: personalSession,
      schema: {
        tags: ["nalevering"],
        description:
          "Een stap van papier nainvoeren: starten en afronden met de tijden van het papier, met de waarden en grondstoffen. " +
          "In de lot-stap is nummer het nieuwe lotnummer en batches de 4 batchnummers. Kan alleen met verbinding (niet via de wachtrij).",
        body: Type.Object({
          stapcode: StapCode,
          nummer: Type.String({ pattern: "^[BL]-[0-9]{4}-[0-9]{4}$", description: "Batchnummer, of lotnummer bij een lotstap" }),
          batches: Type.Optional(Type.Array(BatchNummer, { minItems: 4, maxItems: 4, description: "Alleen in de lot-stap" })),
          pc: Type.String({ format: "uuid" }),
          operator: Type.String({ format: "uuid", description: "Wie het op papier deed" }),
          begin: Type.String({ format: "date-time" }),
          eind: Type.String({ format: "date-time" }),
          reden: Type.String({ minLength: 1, maxLength: 500 }),
          waarden: Type.Array(Type.Object({
            veldcode: Type.String(),
            setting: Type.Optional(Type.Union([Type.Null(), Type.Number()])),
            gemeten: Type.Number(),
          })),
          grondstoffen: Type.Array(Type.Object({
            code: Type.String(),
            partij: Type.String({ minLength: 1, maxLength: 100 }),
            hoeveelheid: Type.Optional(Type.Union([Type.Null(), Type.Number()])),
          })),
        }),
        response: { 201: RegistratieDetail },
      },
    },
    async (req, reply) => {
      const b = req.body;
      const [stap] = await lees<{ is_lot_stap: boolean }>(app.db, "SELECT is_lot_stap FROM processtap WHERE code = $1", [b.stapcode]);
      if (stap?.is_lot_stap && !b.batches) throw new ApiFout(400, "Geef de 4 batchnummers van het lot");
      const id = await invoerTransactie(app.db, req, async (tx) => {
        const { rows } = await tx.query(
          "SELECT execution_paper_entry($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) AS id",
          [b.stapcode, b.nummer, stap?.is_lot_stap ? b.batches : null, b.pc, b.operator, b.begin, b.eind, b.reden,
           JSON.stringify(b.waarden), JSON.stringify(b.grondstoffen)],
        );
        return rows[0].id as string;
      });
      return reply.status(201).send((await registratieDetail(app.db, id)) as never);
    },
  );
};

export default routes;
