import { Type } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { BEHEER, IEDEREEN, invoerTransactie, vereist } from "../auth.js";
import { inTransactie, lees } from "../db.js";

/**
 * "Iets melden" (#78, D62): iedereen typt kort wat misgaat of beter kan, ook zonder verbinding (via de wachtrij
 * van het invoerscherm, met een id van het apparaat). De beheerder ziet de lijst en handelt ze af.
 */
const Terugmelding = Type.Object({
  id: Type.String({ format: "uuid" }),
  gemeld_op: Type.String({ format: "date-time" }),
  gebruikersnaam: Type.String(),
  naam: Type.Union([Type.Null(), Type.String()], { description: "Naam bij de invoer, als die er is" }),
  pc: Type.Union([Type.Null(), Type.String()]),
  stapcode: Type.Union([Type.Null(), Type.String()]),
  scherm: Type.Union([Type.Null(), Type.String()], { description: "Waar in de schermen het gemeld werd" }),
  tekst: Type.String(),
  status: Type.Union([Type.Literal("open"), Type.Literal("afgehandeld")]),
  afgehandeld_door: Type.Union([Type.Null(), Type.String()]),
  afgehandeld_op: Type.Union([Type.Null(), Type.String({ format: "date-time" })]),
  notitie: Type.Union([Type.Null(), Type.String()]),
});

const routes: FastifyPluginAsyncTypebox = async (app) => {
  app.post(
    "/",
    {
      preHandler: vereist(...IEDEREEN),
      schema: {
        tags: ["terugmeldingen"],
        description: "Iets melden. Het id komt van het apparaat: opnieuw versturen maakt geen tweede melding. Tijd, pc en naam komen van de inlog en de wachtrij.",
        body: Type.Object({
          id: Type.String({ format: "uuid" }),
          tekst: Type.String({ minLength: 1, maxLength: 1000 }),
          stapcode: Type.Optional(Type.Union([Type.Null(), Type.String({ maxLength: 20 })])),
          scherm: Type.Optional(Type.Union([Type.Null(), Type.String({ maxLength: 100 })])),
        }, { additionalProperties: false }),
        response: { 201: Type.Object({ id: Type.String({ format: "uuid" }) }) },
      },
    },
    async (req, reply) => {
      const b = req.body;
      await invoerTransactie(app.db, req, (tx) =>
        tx.query("SELECT meld_iets($1, $2, $3, $4, $5, $6, $7)",
          [b.id, req.user.sub, req.user.operatorId ?? null, req.user.pcId ?? null, b.stapcode ?? null, b.scherm ?? null, b.tekst]));
      return reply.status(201).send({ id: b.id });
    },
  );

  app.get(
    "/",
    {
      preHandler: vereist(...BEHEER),
      schema: {
        tags: ["terugmeldingen"],
        description: "Wat gebruikers meldden, nieuwste eerst. Standaard alleen wat nog open staat.",
        querystring: Type.Object({ status: Type.Optional(Type.Union([Type.Literal("open"), Type.Literal("alle")])) }),
        response: { 200: Type.Array(Terugmelding) },
      },
    },
    async (req) =>
      (await lees(app.db, `
        SELECT t.id, t.gemeld_op, g.gebruikersnaam, o.naam, p.naam AS pc, t.stapcode, t.scherm, t.tekst, t.status,
               a.gebruikersnaam AS afgehandeld_door, t.afgehandeld_op, t.notitie
          FROM terugmelding t
          JOIN gebruiker g ON g.id = t.gebruiker_id
          LEFT JOIN operator o ON o.id = t.operator_id
          LEFT JOIN pc p ON p.id = t.pc_id
          LEFT JOIN gebruiker a ON a.id = t.afgehandeld_door
         WHERE $1 = 'alle' OR t.status = 'open'
         ORDER BY t.gemeld_op DESC
         LIMIT 500`, [req.query.status ?? "open"])) as never,
  );

  app.post(
    "/:id/afhandelen",
    {
      preHandler: vereist(...BEHEER),
      schema: {
        tags: ["terugmeldingen"],
        description: "Een melding afhandelen, met een notitie (bijvoorbeeld het roadmapnummer of wat er gedaan is).",
        params: Type.Object({ id: Type.String({ format: "uuid" }) }),
        body: Type.Object({ notitie: Type.Optional(Type.Union([Type.Null(), Type.String({ maxLength: 500 })])) }, { additionalProperties: false }),
        response: { 204: Type.Null() },
      },
    },
    async (req, reply) => {
      await inTransactie(app.db, req.user.naam, (tx) =>
        tx.query("SELECT handel_terugmelding_af($1, $2, $3)", [req.params.id, req.user.sub, req.body.notitie ?? null]));
      return reply.status(204).send(null);
    },
  );
};
export default routes;
