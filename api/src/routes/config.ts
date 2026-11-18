import { Type } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { IEDEREEN, vereist } from "../auth.js";
import { lees } from "../db.js";

export const Veld = Type.Object({
  code: Type.String(),
  naam: Type.String(),
  soort: Type.Union([Type.Literal("procesparameter"), Type.Literal("gewicht"), Type.Literal("overig")]),
  eenheid: Type.Union([Type.Null(), Type.String()]),
  grens_min: Type.Union([Type.Null(), Type.Number()]),
  grens_max: Type.Union([Type.Null(), Type.Number()]),
  tolerantie: Type.Union([Type.Null(), Type.Number()]),
  tolerantie_soort: Type.String(),
  volgnummer: Type.Integer(),
  verplicht: Type.Boolean(),
  actief: Type.Boolean(),
});

const Stap = Type.Object({
  code: Type.String(),
  naam: Type.String(),
  volgorde: Type.Integer(),
  niveau: Type.Union([Type.Literal("batch"), Type.Literal("lot")]),
  is_lot_stap: Type.Boolean(),
  velden: Type.Array(Veld),
});

export const STAPPEN_SQL = `
  SELECT s.code, s.naam, s.volgorde, s.niveau, s.is_lot_stap,
         coalesce(json_agg(json_build_object(
           'code', v.code, 'naam', v.naam, 'soort', v.soort, 'eenheid', v.eenheid,
           'grens_min', v.grens_min, 'grens_max', v.grens_max, 'tolerantie', v.tolerantie,
           'tolerantie_soort', v.tolerantie_soort, 'volgnummer', v.volgnummer,
           'verplicht', v.verplicht, 'actief', v.actief) ORDER BY v.volgnummer)
           FILTER (WHERE v.id IS NOT NULL AND (v.actief OR $1)), '[]') AS velden
    FROM processtap s
    LEFT JOIN veld v ON v.processtap_id = s.id
   WHERE s.actief OR $1
   GROUP BY s.id
   ORDER BY s.volgorde`;

const routes: FastifyPluginAsyncTypebox = async (app) => {
  // Stappen met hun velden: hieruit bouwt de invoerapplicatie haar formulieren.
  app.get(
    "/stappen",
    {
      preHandler: vereist(...IEDEREEN),
      schema: {
        tags: ["configuratie"],
        querystring: Type.Object({
          voorDezePc: Type.Optional(Type.Boolean({ description: "Alleen stappen die aan de pc van het token gekoppeld zijn (indien ingesteld)" })),
          ookInactief: Type.Optional(Type.Boolean({ description: "Ook inactieve velden (voor beheer)" })),
        }),
        response: { 200: Type.Array(Stap) },
      },
    },
    async (req) => {
      const stappen = await lees<{ code: string } & Record<string, unknown>>(app.db, STAPPEN_SQL, [req.query.ookInactief ?? false]);
      if (!req.query.voorDezePc || !req.user.pcId) return stappen as never;
      const toegestaan = await lees<{ code: string }>(
        app.db,
        "SELECT s.code FROM pc_stap ps JOIN processtap s ON s.id = ps.processtap_id WHERE ps.pc_id = $1",
        [req.user.pcId],
      );
      // Geen koppeling ingesteld = alle stappen.
      if (toegestaan.length === 0) return stappen as never;
      const codes = new Set(toegestaan.map((r) => r.code));
      return stappen.filter((s) => codes.has(s.code)) as never;
    },
  );

  app.get(
    "/pcs",
    {
      schema: {
        tags: ["configuratie"],
        security: [],
        description: "Lijst van pc's, om een pc bij de eerste keer te koppelen.",
        response: { 200: Type.Array(Type.Object({ naam: Type.String(), locatie: Type.Union([Type.Null(), Type.String()]) })) },
      },
    },
    async () => (await lees(app.db, "SELECT naam, locatie FROM pc WHERE actief ORDER BY naam")) as never,
  );
};

export default routes;
