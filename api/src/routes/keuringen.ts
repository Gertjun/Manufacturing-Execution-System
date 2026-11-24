import { Type } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { personalSession, requireTransactionPermission } from "../modules/authorization/access.js";
import { inTransactie, lees } from "../db.js";
import { ApiFout, niet } from "../fouten.js";
import { registratieDetail } from "./registraties.js";
import { RegistratieDetail } from "./schemas.js";

/** Keuring door Kwaliteit (#64, D58): wat op een meting van Kwaliteit wacht, en het besluit. */
const routes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/",
    {
      preHandler: personalSession,
      schema: {
        tags: ["keuringen"],
        description: "Stappen die op Kwaliteit wachten (status open), oudste eerst; met stap alleen die stap.",
        querystring: Type.Object({ stap: Type.Optional(Type.String()) }),
        response: {
          200: Type.Array(Type.Object({
            id: Type.String({ format: "uuid" }),
            registratie_id: Type.String({ format: "uuid" }),
            soort: Type.Union([Type.Literal("batch"), Type.Literal("lot")]),
            nummer: Type.String(),
            product: Type.Union([Type.Null(), Type.String()]),
            stap: Type.String(),
            stapnaam: Type.String(),
            sinds: Type.String({ format: "date-time" }),
            te_meten: Type.Integer({ description: "Verplichte velden van Kwaliteit die nog niet zijn ingevuld" }),
            afwijkingen: Type.Integer({ description: "Afwijkende metingen in deze stap" }),
          })),
        },
      },
    },
    async (req) =>
      lees(
        app.db,
        `SELECT k.id, r.id AS registratie_id, CASE WHEN r.batch_id IS NOT NULL THEN 'batch' ELSE 'lot' END AS soort,
                coalesce(b.batchnummer, l.lotnummer) AS nummer, p.code AS product, s.code AS stap, s.naam AS stapnaam,
                coalesce(r.afgerond_op, k.aangemaakt_op) AS sinds,
                (SELECT count(*) FROM veld v WHERE v.processtap_id = s.id AND v.actief AND v.verplicht AND v.gemeten_door = 'kwaliteit'
                    AND NOT EXISTS (SELECT 1 FROM waarde w WHERE w.stapregistratie_id = r.id AND w.veld_id = v.id))::int AS te_meten,
                (SELECT count(*) FROM waarde_actueel w WHERE w.stapregistratie_id = r.id AND w.markering <> 'ok')::int AS afwijkingen
           FROM keuring k JOIN stapregistratie r ON r.id = k.stapregistratie_id JOIN processtap s ON s.id = r.processtap_id
           LEFT JOIN batch b ON b.id = r.batch_id LEFT JOIN lot l ON l.id = r.lot_id LEFT JOIN product p ON p.id = r.product_id
          WHERE k.status = 'open' AND ($1::text IS NULL OR s.code = $1)
            AND authorization_read_execution($2,r.product_id)
          ORDER BY sinds`,
        [req.query.stap ?? null,req.user.sub],
      ) as never,
  );


  app.post(
    "/:id/besluit",
    {
      preHandler: personalSession,
      schema: {
        tags: ["keuringen"],
        description:
          "Kwaliteit beslist: vrijgegeven (alle verplichte metingen van Kwaliteit zijn er), herbewerken (met reden, terug naar stapcode of deze stap) " +
          "of afgekeurd (met reden). Hetzelfde besluit opnieuw versturen (offline wachtrij) geeft gewoon de stand terug.",
        params: Type.Object({ id: Type.String({ format: "uuid" }) }),
        body: Type.Object({
          besluit: Type.Union([Type.Literal("vrijgegeven"), Type.Literal("herbewerken"), Type.Literal("afgekeurd")]),
          reden: Type.Optional(Type.Union([Type.Null(), Type.String({ maxLength: 500 })])),
          stapcode: Type.Optional(Type.String({ description: "Bij herbewerken: terug naar deze stap (standaard de stap van de keuring)" })),
        }),
        response: { 200: RegistratieDetail },
      },
    },
    async (req) => {
      const [k] = await lees<{ stapregistratie_id: string }>(app.db, "SELECT stapregistratie_id FROM keuring WHERE id = $1", [req.params.id]);
      if (!k) throw niet("Keuring");
      try {
        await inTransactie(app.db, req.user.naam, async (tx) => {
          const { rows: [target] } = await tx.query<{product_id: string | null}>("SELECT r.product_id FROM keuring k JOIN stapregistratie r ON r.id=k.stapregistratie_id WHERE k.id=$1", [req.params.id]);
          if (!target) throw niet("Keuring");
          await requireTransactionPermission(tx, req.user.sub, "inspection.decide", { product: target.product_id ?? undefined });
          await tx.query("SELECT beslis_keuring($1, $2, $3, $4, $5)", [req.params.id, req.body.besluit, req.body.reden ?? null, req.user.sub, req.body.stapcode ?? null]);
        });
      } catch (e) {
        // Twee mensen van Kwaliteit op dezelfde keuring (#85): het eerste besluit telt; zeg wie dat nam.
        if (!String((e as Error).message).includes("al beslist")) throw e;
        const [b] = await lees<{ status: string; door: string | null }>(app.db,
          "SELECT k.status, g.gebruikersnaam AS door FROM keuring k LEFT JOIN gebruiker g ON g.id = k.besloten_door WHERE k.id = $1", [req.params.id]);
        const wat = { vrijgegeven: "vrijgegeven", herbewerken: "herbewerken", afgekeurd: "afgekeurd" }[b?.status ?? ""] ?? b?.status;
        throw new ApiFout(409, `Over deze stap is al beslist door ${b?.door ?? "iemand anders"}: ${wat}`);
      }
      return (await registratieDetail(app.db, k.stapregistratie_id)) as never;
    },
  );
};

export default routes;
