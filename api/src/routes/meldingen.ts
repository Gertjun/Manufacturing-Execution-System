import { Type } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { vereist, type Rol } from "../auth.js";
import { inTransactie, lees } from "../db.js";
import { niet } from "../fouten.js";

/** Meldingen zijn er voor de mensen die iets moeten doen; operators en het wandscherm niet. */
const MET_MELDINGEN: Rol[] = ["ploegleider", "kwaliteit", "planner", "beheerder", "analist"];
const BEWAARTERMIJN = "30 days";

const Melding = Type.Object({
  id: Type.String(),
  soort: Type.String(),
  ernst: Type.Union([Type.Literal("info"), Type.Literal("let_op"), Type.Literal("kritiek")]),
  tekst: Type.String(),
  batchnummer: Type.Union([Type.Null(), Type.String()]),
  lotnummer: Type.Union([Type.Null(), Type.String()]),
  hal: Type.Union([Type.Null(), Type.String()]),
  aangemaakt_op: Type.String({ format: "date-time" }),
  gelezen: Type.Boolean(),
});

// Beheerder en analist zien alle meldingen; de anderen die voor hun rol.
const VOOR_MIJ = `(m.voor_rollen @> ARRAY[$2::text] OR $2 IN ('beheerder','analist')) AND m.aangemaakt_op > now() - interval '${BEWAARTERMIJN}'`;

const routes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/",
    {
      preHandler: vereist(...MET_MELDINGEN),
      schema: {
        tags: ["meldingen"],
        description: `Meldingen voor mijn rol van de laatste ${BEWAARTERMIJN.replace(" days", " dagen")}, nieuwste eerst.`,
        querystring: Type.Object({
          ongelezen: Type.Optional(Type.Boolean()),
          limiet: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, default: 100 })),
        }),
        response: { 200: Type.Object({ ongelezen: Type.Integer(), meldingen: Type.Array(Melding) }) },
      },
    },
    async (req) => {
      const p = [req.user.sub, req.user.rol];
      const [{ n }] = await lees<{ n: number }>(
        app.db,
        `SELECT count(*)::int AS n FROM melding m
          WHERE ${VOOR_MIJ} AND NOT EXISTS (SELECT 1 FROM melding_gelezen g WHERE g.melding_id = m.id AND g.gebruiker_id = $1)`,
        p,
      );
      const meldingen = await lees(
        app.db,
        `SELECT m.id::text, m.soort, m.ernst, m.tekst, m.batchnummer, m.lotnummer, m.hal, m.aangemaakt_op,
                EXISTS (SELECT 1 FROM melding_gelezen g WHERE g.melding_id = m.id AND g.gebruiker_id = $1) AS gelezen
           FROM melding m
          WHERE ${VOOR_MIJ} AND (NOT $3 OR NOT EXISTS (SELECT 1 FROM melding_gelezen g WHERE g.melding_id = m.id AND g.gebruiker_id = $1))
          ORDER BY m.aangemaakt_op DESC LIMIT $4`,
        [...p, req.query.ongelezen ?? false, req.query.limiet ?? 100],
      );
      return { ongelezen: n, meldingen } as never;
    },
  );

  app.post(
    "/:id/gelezen",
    {
      preHandler: vereist(...MET_MELDINGEN),
      schema: { tags: ["meldingen"], params: Type.Object({ id: Type.String({ format: "uuid" }) }), response: { 204: Type.Null() } },
    },
    async (req, reply) => {
      await inTransactie(app.db, req.user.naam, async (tx) => {
        const { rowCount } = await tx.query("SELECT 1 FROM melding WHERE id = $1", [req.params.id]);
        if (!rowCount) throw niet("Melding");
        await tx.query("INSERT INTO melding_gelezen (melding_id, gebruiker_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [req.params.id, req.user.sub]);
      });
      return reply.status(204).send(null);
    },
  );

  app.post(
    "/alles-gelezen",
    { preHandler: vereist(...MET_MELDINGEN), schema: { tags: ["meldingen"], response: { 200: Type.Object({ gelezen: Type.Integer() }) } } },
    async (req) => {
      const n = await inTransactie(app.db, req.user.naam, async (tx) => {
        const r = await tx.query(
          `INSERT INTO melding_gelezen (melding_id, gebruiker_id)
           SELECT m.id, $1 FROM melding m WHERE ${VOOR_MIJ}
           ON CONFLICT DO NOTHING`,
          [req.user.sub, req.user.rol],
        );
        return r.rowCount ?? 0;
      });
      return { gelezen: n };
    },
  );
};

export default routes;
