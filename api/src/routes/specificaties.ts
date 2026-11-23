import { Type } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { IEDEREEN, vereist, type Rol } from "../auth.js";
import { inTransactie, lees } from "../db.js";
import { ApiFout, niet } from "../fouten.js";
import { NulGetal, StapCode } from "./schemas.js";

/** Wie specificaties beheert (D73): Kwaliteit en de beheerder. Lezen mag iedereen met een persoonlijk account. */
const BEHEREN: Rol[] = ["kwaliteit", "beheerder"];

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
      preHandler: vereist(...IEDEREEN),
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

  app.post(
    "/",
    {
      preHandler: vereist(...BEHEREN),
      schema: {
        tags: ["specificaties"],
        description: "Nieuwe versie als concept, met de regels van de geldige versie. Bestaat er al een concept, dan komt dat terug.",
        body: Type.Object({ product: Type.String({ maxLength: 40 }), stap: StapCode }),
        response: { 201: Versie },
      },
    },
    async (req, reply) => {
      const id = await inTransactie(app.db, req.user.naam, async (tx) => {
        const { rows } = await tx.query(
          `SELECT p.id AS product, s.id AS stap FROM product p, processtap s WHERE p.code = $1 AND s.code = $2 AND s.actief`,
          [req.body.product, req.body.stap]);
        if (!rows[0]) throw niet("Product of stap");
        return (await tx.query("SELECT nieuwe_specificatie($1, $2, $3) AS id", [rows[0].product, rows[0].stap, req.user.sub])).rows[0].id as string;
      });
      const [v] = await lees<{ vastgesteld_op: Date | null }>(app.db, `${VERSIES_SQL} WHERE x.id = $1`, [id]);
      return reply.status(201).send(metTijd(v) as never);
    },
  );

  app.put(
    "/:id",
    {
      preHandler: vereist(...BEHEREN),
      schema: {
        tags: ["specificaties"],
        description:
          "De regels en de opmerking van een concept. De lijst is volledig: een veld dat ontbreekt, of zonder minimum en maximum, gaat uit het concept.",
        params: Type.Object({ id: Type.String({ format: "uuid" }) }),
        body: Type.Object({
          opmerking: Type.Optional(Type.Union([Type.Null(), Type.String({ maxLength: 500 })])),
          regels: Type.Array(Regel, { maxItems: 100 }),
        }),
        response: { 200: Versie },
      },
    },
    async (req) => {
      await inTransactie(app.db, req.user.naam, async (tx) => {
        const { rows } = await tx.query("SELECT status, processtap_id FROM specificatie WHERE id = $1 FOR UPDATE", [req.params.id]);
        if (!rows[0]) throw niet("Specificatie");
        if (rows[0].status !== "concept") throw new ApiFout(409, "Een vastgestelde specificatie verandert niet; maak een nieuwe versie");
        const regels = req.body.regels.filter((r) => r.grens_min !== null || r.grens_max !== null);
        const velden = new Map((await tx.query("SELECT code, id FROM veld WHERE processtap_id = $1", [rows[0].processtap_id])).rows.map((r) => [r.code, r.id]));
        const onbekend = regels.filter((r) => !velden.has(r.veld)).map((r) => r.veld);
        if (onbekend.length) throw new ApiFout(400, `Dit veld hoort niet bij de keuringsstap: ${onbekend.join(", ")}`);
        for (const r of regels) {
          if (r.grens_min !== null && r.grens_max !== null && r.grens_min > r.grens_max) throw new ApiFout(400, `${r.veld}: het minimum is groter dan het maximum`);
        }
        await tx.query("DELETE FROM specificatie_regel WHERE specificatie_id = $1 AND NOT (veld_id = ANY($2::uuid[]))",
          [req.params.id, regels.map((r) => velden.get(r.veld))]);
        for (const r of regels) {
          await tx.query(
            `INSERT INTO specificatie_regel (specificatie_id, veld_id, grens_min, grens_max) VALUES ($1, $2, $3, $4)
             ON CONFLICT (specificatie_id, veld_id) DO UPDATE SET grens_min = EXCLUDED.grens_min, grens_max = EXCLUDED.grens_max`,
            [req.params.id, velden.get(r.veld), r.grens_min, r.grens_max]);
        }
        if (req.body.opmerking !== undefined) {
          await tx.query("UPDATE specificatie SET opmerking = $2 WHERE id = $1", [req.params.id, req.body.opmerking?.trim() || null]);
        }
      });
      const [v] = await lees<{ vastgesteld_op: Date | null }>(app.db, `${VERSIES_SQL} WHERE x.id = $1`, [req.params.id]);
      return metTijd(v) as never;
    },
  );

  app.post(
    "/:id/vaststellen",
    {
      preHandler: vereist(...BEHEREN),
      schema: {
        tags: ["specificaties"],
        description: "Het concept geldt vanaf nu; de vorige versie vervalt. Metingen van daarvoor houden hun eigen versie.",
        params: Type.Object({ id: Type.String({ format: "uuid" }) }),
        response: { 200: Versie },
      },
    },
    async (req) => {
      await inTransactie(app.db, req.user.naam, (tx) => tx.query("SELECT stel_specificatie_vast($1, $2)", [req.params.id, req.user.sub]));
      const [v] = await lees<{ vastgesteld_op: Date | null }>(app.db, `${VERSIES_SQL} WHERE x.id = $1`, [req.params.id]);
      return metTijd(v) as never;
    },
  );

  app.post(
    "/:id/weggooien",
    {
      preHandler: vereist(...BEHEREN),
      schema: {
        tags: ["specificaties"],
        description: "Een concept weggooien; een vastgestelde of vervallen versie blijft altijd bewaard.",
        params: Type.Object({ id: Type.String({ format: "uuid" }) }),
        response: { 204: Type.Null() },
      },
    },
    async (req, reply) => {
      const n = await inTransactie(app.db, req.user.naam, (tx) => tx.query("DELETE FROM specificatie WHERE id = $1", [req.params.id]));
      if (!n.rowCount) throw niet("Specificatie");
      return reply.status(204).send(null);
    },
  );
};

export default routes;
