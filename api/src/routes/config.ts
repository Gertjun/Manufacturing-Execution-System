import { Type } from "@fastify/type-provider-typebox";
import { NulGetal, NulGeheel } from "./schemas.js";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { requiresGlobalExecutionRead, requirePermission } from "../modules/authorization/access.js";
import { lees } from "../db.js";

export const Veld = Type.Object({
  code: Type.String(),
  naam: Type.String(),
  soort: Type.Union([Type.Literal("procesparameter"), Type.Literal("gewicht"), Type.Literal("overig")]),
  eenheid: Type.Union([Type.Null(), Type.String()]),
  grens_min: NulGetal(),
  grens_max: NulGetal(),
  tolerantie: NulGetal(),
  tolerantie_soort: Type.String(),
  volgnummer: Type.Integer(),
  verplicht: Type.Boolean(),
  op_certificaat: Type.Optional(Type.Boolean({ description: "Komt op het certificaat per lot (sinds 0.17.0)" })),
  decimalen: Type.Optional(NulGeheel({ description: "Aantal decimalen bij het tonen; leeg = automatisch (sinds 0.23.0)" })),
  gemeten_door: Type.Optional(Type.Union([Type.Literal("productie"), Type.Literal("kwaliteit")], { description: "Wie meet: de operator of Kwaliteit (sinds 0.37.0, #64)" })),
  actief: Type.Boolean(),
  per_product: Type.Optional(Type.Array(Type.Object({
    product: Type.String(), grens_min: NulGetal(), grens_max: NulGetal(), tolerantie: NulGetal(), tolerantie_soort: Type.String(),
  }), { description: "Eigen grenzen voor een product; die vervangen dan alle vier de waarden hierboven (sinds 0.29.0, D55)" })),
});

const Stap = Type.Object({
  code: Type.String(),
  naam: Type.String(),
  volgorde: Type.Integer(),
  niveau: Type.Union([Type.Literal("batch"), Type.Literal("lot")]),
  is_lot_stap: Type.Boolean(),
  soort: Type.Union([Type.Literal("proces"), Type.Literal("keuring")], { description: "keuring = tussen- of eindkeuring: alleen Kwaliteit start, meet en beslist (#80)" }),
  velden: Type.Array(Veld),
  grondstoffen: Type.Array(
    Type.Object({ code: Type.String(), naam: Type.String(), eenheid: Type.Union([Type.Null(), Type.String()]), verplicht: Type.Boolean() }),
    { description: "Grondstoffen die in deze stap worden ingevoerd (partijnummer en hoeveelheid)" },
  ),
});

export const STAPPEN_SQL = `
  SELECT s.code, s.naam, s.volgorde, s.niveau, s.is_lot_stap, s.soort,
         coalesce(json_agg(json_build_object(
           'code', v.code, 'naam', v.naam, 'soort', v.soort, 'eenheid', v.eenheid,
           'grens_min', v.grens_min, 'grens_max', v.grens_max, 'tolerantie', v.tolerantie,
           'tolerantie_soort', v.tolerantie_soort, 'volgnummer', v.volgnummer,
           'verplicht', v.verplicht, 'actief', v.actief, 'op_certificaat', v.op_certificaat, 'decimalen', v.decimalen,
           'gemeten_door', v.gemeten_door,
           'per_product', (SELECT coalesce(json_agg(json_build_object('product', p.code, 'grens_min', vp.grens_min, 'grens_max', vp.grens_max,
                                     'tolerantie', vp.tolerantie, 'tolerantie_soort', vp.tolerantie_soort) ORDER BY p.code), '[]')
                             FROM veld_product vp JOIN product p ON p.id = vp.product_id WHERE vp.veld_id = v.id)) ORDER BY v.volgnummer)
           FILTER (WHERE v.id IS NOT NULL AND (v.actief OR $1)), '[]') AS velden,
         coalesce((SELECT json_agg(json_build_object('code', g.code, 'naam', g.naam, 'eenheid', g.eenheid, 'verplicht', x.verplicht) ORDER BY g.code)
                     FROM stap_grondstof x JOIN grondstof g ON g.id = x.grondstof_id
                    WHERE x.processtap_id = s.id AND x.actief AND g.actief), '[]') AS grondstoffen
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
      preHandler: requiresGlobalExecutionRead,
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
      if (req.query.ookInactief) await requirePermission(app.db, req.user.sub, "process.parameter.manage");
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
