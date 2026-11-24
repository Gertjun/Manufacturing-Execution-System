import { Type } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { persoonlijkeTransactie } from "../auth.js";
import { personalSession } from "../modules/authorization/access.js";
import { lees } from "../db.js";
import { ApiFout, niet } from "../fouten.js";

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

// Historische ontvangersmetadata, actuele globale MES-permissions.
const VOOR_MIJ = `notification_recipient($1,m.voor_rollen) AND m.aangemaakt_op > now() - interval '${BEWAARTERMIJN}'`;

const routes: FastifyPluginAsyncTypebox = async (app) => {
  const meldingsrecht = async (req: Parameters<typeof personalSession>[0]) => {
    await personalSession(req);
    const [r] = await lees<{allowed:boolean}>(app.db,
      "SELECT notification_recipient($1,ARRAY['ploegleider','kwaliteit','planner','productiemanager']) AS allowed",
      [req.user.sub]);
    if (!r?.allowed) throw new ApiFout(403,"Geen globale MES-meldingsbevoegdheid");
  };
  app.get(
    "/",
    {
      preHandler: meldingsrecht,
      schema: {
        tags: ["meldingen"],
        description: `Meldingen voor mijn actuele bevoegdheden van de laatste ${BEWAARTERMIJN.replace(" days", " dagen")}, nieuwste eerst.`,
        querystring: Type.Object({
          ongelezen: Type.Optional(Type.Boolean()),
          limiet: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, default: 100 })),
        }),
        response: { 200: Type.Object({ ongelezen: Type.Integer(), meldingen: Type.Array(Melding) }) },
      },
    },
    async (req) => {
      const p = [req.user.sub];
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
          WHERE ${VOOR_MIJ} AND (NOT $2 OR NOT EXISTS (SELECT 1 FROM melding_gelezen g WHERE g.melding_id = m.id AND g.gebruiker_id = $1))
          ORDER BY m.aangemaakt_op DESC LIMIT $3`,
        [...p, req.query.ongelezen ?? false, req.query.limiet ?? 100],
      );
      return { ongelezen: n, meldingen } as never;
    },
  );

  app.post(
    "/:id/gelezen",
    {
      preHandler: meldingsrecht,
      schema: { tags: ["meldingen"], params: Type.Object({ id: Type.String({ format: "uuid" }) }), response: { 204: Type.Null() } },
    },
    async (req, reply) => {
      await persoonlijkeTransactie(app.db, req, async (tx) => {
        const { rowCount } = await tx.query(`SELECT 1 FROM melding m WHERE id = $2 AND ${VOOR_MIJ}`, [req.user.sub,req.params.id]);
        if (!rowCount) throw niet("Melding");
        await tx.query("INSERT INTO melding_gelezen (melding_id, gebruiker_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [req.params.id, req.user.sub]);
      });
      return reply.status(204).send(null);
    },
  );

  app.post(
    "/alles-gelezen",
    { preHandler: meldingsrecht, schema: { tags: ["meldingen"], response: { 200: Type.Object({ gelezen: Type.Integer() }) } } },
    async (req) => {
      const n = await persoonlijkeTransactie(app.db, req, async (tx) => {
        const r = await tx.query(
          `INSERT INTO melding_gelezen (melding_id, gebruiker_id)
           SELECT m.id, $1 FROM melding m WHERE ${VOOR_MIJ}
           ON CONFLICT DO NOTHING`,
          [req.user.sub],
        );
        return r.rowCount ?? 0;
      });
      return { gelezen: n };
    },
  );
};

export default routes;
