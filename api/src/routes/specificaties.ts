import { Type } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { personalSession } from "../modules/authorization/access.js";
import { lees } from "../db.js";
import { ApiFout, niet } from "../fouten.js";
import { NulGetal } from "./schemas.js";

const Regel = Type.Object({ veld: Type.String(), grens_min: NulGetal(), grens_max: NulGetal() });
const Versie = Type.Object({
  id: Type.String({ format: "uuid" }),
  versie: Type.Integer(),
  status: Type.Union([Type.Literal("concept"), Type.Literal("vastgesteld"), Type.Literal("vervallen")]),
  opmerking: Type.Union([Type.Null(), Type.String()]),
  aangemaakt_door: Type.Union([Type.Null(), Type.String()]),
  vastgesteld_door: Type.Union([Type.Null(), Type.String()]),
  vastgesteld_op: Type.Union([Type.Null(), Type.String({ format: "date-time" })]),
  regels: Type.Array(Regel),
});

const VERSIES_SQL = `
  SELECT x.id, x.versie, x.status, x.opmerking, a.gebruikersnaam AS aangemaakt_door, d.gebruikersnaam AS vastgesteld_door, x.vastgesteld_op,
         coalesce((SELECT json_agg(json_build_object('veld', v.code, 'grens_min', r.grens_min, 'grens_max', r.grens_max) ORDER BY v.volgnummer)
                     FROM specificatie_regel r JOIN veld v ON v.id = r.veld_id WHERE r.specificatie_id = x.id), '[]') AS regels
    FROM specificatie x LEFT JOIN gebruiker a ON a.id = x.aangemaakt_door LEFT JOIN gebruiker d ON d.id = x.vastgesteld_door`;

const metTijd = <T extends { vastgesteld_op: Date | string | null }>(x: T) =>
  ({ ...x, vastgesteld_op: x.vastgesteld_op ? new Date(x.vastgesteld_op).toISOString() : null });

/** Specificaties per product en keuringsstap (#80, D73): concept → vastgesteld → vervallen. */
const routes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/",
    {
      preHandler: personalSession,
      schema: {
        tags: ["specificaties"],
        description:
          "Per keuringsstap in de route van het product: de velden, de geldige versie, een concept (als dat er is) en de eerdere versies. " +
          "Getallen in regels zijn null als er geen minimum of maximum is.",
        querystring: Type.Object({ product: Type.String({ maxLength: 40 }) }),
        response: {
          200: Type.Object({
            product: Type.String(),
            productnaam: Type.String(),
            stappen: Type.Array(Type.Object({
              stap: Type.String(),
              stapnaam: Type.String(),
              niveau: Type.String(),
              velden: Type.Array(Type.Object({ code: Type.String(), naam: Type.String(), eenheid: Type.Union([Type.Null(), Type.String()]) })),
              geldig: Type.Union([Type.Null(), Versie]),
              concept: Type.Union([Type.Null(), Versie]),
              eerder: Type.Array(Versie, { description: "Vervallen versies, nieuwste eerst" }),
            })),
          }),
        },
      },
    },
    async (req) => {
      const [p] = await lees<{ id: string; code: string; naam: string }>(app.db, "SELECT id, code, naam FROM product WHERE code = $1", [req.query.product]);
      if (!p) throw niet("Product");
      const [recht] = await lees<{ allowed: boolean }>(app.db, "SELECT authorization_read_execution($1,$2) AS allowed", [req.user.sub,p.id]);
      if (!recht?.allowed) throw new ApiFout(403, "Geen MES-leesbevoegdheid voor dit product");
      const stappen = await lees<{ id: string; stap: string; stapnaam: string; niveau: string; velden: unknown[] }>(
        app.db,
        `SELECT s.id, s.code AS stap, s.naam AS stapnaam, s.niveau,
                coalesce((SELECT json_agg(json_build_object('code', v.code, 'naam', v.naam, 'eenheid', v.eenheid) ORDER BY v.volgnummer)
                            FROM veld v WHERE v.processtap_id = s.id AND v.actief), '[]') AS velden
           FROM route($1) r JOIN processtap s ON s.id = r.processtap_id
          WHERE s.soort = 'keuring' ORDER BY r.plek`,
        [p.id],
      );
      const versies = await lees<{ id: string; status: string; processtap_id: string; versie: number; vastgesteld_op: Date | null }>(
        app.db, `${VERSIES_SQL.replace("SELECT x.id,", "SELECT x.processtap_id, x.id,")} WHERE x.product_id = $1 ORDER BY x.versie DESC`, [p.id]);
      return {
        product: p.code,
        productnaam: p.naam,
        stappen: stappen.map(({ id, ...s }) => {
          const eigen = versies.filter((v) => v.processtap_id === id).map(({ processtap_id: _, ...v }) => metTijd(v));
          return {
            ...s,
            geldig: eigen.find((v) => v.status === "vastgesteld") ?? null,
            concept: eigen.find((v) => v.status === "concept") ?? null,
            eerder: eigen.filter((v) => v.status === "vervallen"),
          };
        }),
      } as never;
    },
  );

  // D99/D101: geen legacy-vaststelling of conceptbeheer zonder de
  // toekomstige gecontroleerde wijzigings- en vrijgaveworkflow (fase 2).
  const geblokkeerd = async () => { throw new ApiFout(403, "Specificatiebeheer tijdelijk geblokkeerd tot de gecontroleerde MES-workflow"); };
  app.post("/", { preHandler: personalSession }, geblokkeerd);
  app.put("/:id", { preHandler: personalSession }, geblokkeerd);
  app.post("/:id/vaststellen", { preHandler: personalSession }, geblokkeerd);
  app.post("/:id/weggooien", { preHandler: personalSession }, geblokkeerd);
};

export default routes;
