import { Type } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { BEHEER, IEDEREEN, vereist, type Rol, operatorVan } from "../auth.js";
import { inTransactie, lees, type Db } from "../db.js";
import { ApiFout, niet } from "../fouten.js";
import { StapCode } from "./schemas.js";

/** Stilstand melden en beëindigen: wie op de vloer werkt. */
const VLOER: Rol[] = ["operator", "ploegleider"];
const Tijd = Type.String({ format: "date-time" });
const OptTekst = Type.Union([Type.Null(), Type.String()]);

const Oorzaak = Type.Object({ code: Type.String(), naam: Type.String(), categorie: Type.String(), actief: Type.Boolean() });
export const Stilstand = Type.Object({
  id: Type.String(),
  stap: Type.String(),
  stapnaam: Type.String(),
  oorzaak: Type.String(),
  oorzaaknaam: Type.String(),
  categorie: Type.String(),
  toelichting: OptTekst,
  begin_op: Tijd,
  eind_op: Type.Union([Type.Null(), Tijd]),
  minuten: Type.Number({ description: "Duur tot het einde, of tot nu als hij nog loopt" }),
  pc: OptTekst,
  operator: OptTekst,
  hal: OptTekst,
  eind_notitie: Type.Optional(Type.Union([Type.Null(), Type.String()], { description: "Wat het was en wat er is gedaan, ingevuld bij het einde (#31)" })),
  beeindigd_door: OptTekst,
});
export const STILSTAND_SQL = `
  SELECT x.id::text, s.code AS stap, s.naam AS stapnaam, o.code AS oorzaak, o.naam AS oorzaaknaam, o.categorie, x.toelichting,
         x.begin_op, x.eind_op, round(extract(epoch FROM coalesce(x.eind_op, now()) - x.begin_op) / 60, 1)::float AS minuten,
         pc.naam AS pc, op.naam AS operator, pc.locatie AS hal, x.eind_notitie, eo.naam AS beeindigd_door
    FROM stilstand x JOIN processtap s ON s.id = x.processtap_id JOIN stilstand_oorzaak o ON o.id = x.oorzaak_id
    LEFT JOIN pc ON pc.id = x.pc_id LEFT JOIN operator op ON op.id = x.operator_id LEFT JOIN operator eo ON eo.id = x.beeindigd_door`;

const eenStilstand = async (db: Db, id: string) => (await lees(db, `${STILSTAND_SQL} WHERE x.id = $1`, [id]))[0];
/** Een tijdstip van het apparaat; in de toekomst (verkeerde klok) telt als nu. */
const tijdstip = (t?: string) => (t && Date.parse(t) < Date.now() ? t : new Date().toISOString());

const routes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/oorzaken",
    {
      preHandler: vereist(...IEDEREEN),
      schema: { tags: ["stilstand"], querystring: Type.Object({ ookInactief: Type.Optional(Type.Boolean()) }), response: { 200: Type.Array(Oorzaak) } },
    },
    async (req) =>
      (await lees(app.db, `SELECT code, naam, categorie, actief FROM stilstand_oorzaak ${req.query.ookInactief ? "" : "WHERE actief"}
                            ORDER BY CASE categorie WHEN 'storing' THEN 1 WHEN 'wachten' THEN 2 WHEN 'gepland' THEN 3 ELSE 4 END, naam`)) as never,
  );

  app.get(
    "/",
    {
      preHandler: vereist(...IEDEREEN, "scherm"),
      schema: { tags: ["stilstand"], description: "Stilstand die nu loopt, per stap.", response: { 200: Type.Array(Stilstand) } },
    },
    async () => (await lees(app.db, `${STILSTAND_SQL} WHERE x.eind_op IS NULL ORDER BY s.volgorde`)) as never,
  );

  app.post(
    "/",
    {
      preHandler: vereist(...VLOER),
      schema: {
        tags: ["stilstand"],
        description: "Stilstand melden voor een stap. Met een eigen id is opnieuw versturen veilig (offline wachtrij).",
        body: Type.Object({
          id: Type.Optional(Type.String({ format: "uuid" })),
          stapcode: StapCode,
          oorzaak: Type.String(),
          toelichting: Type.Optional(Type.Union([Type.Null(), Type.String({ maxLength: 500 })])),
          begin_op: Type.Optional(Tijd),
        }),
        response: { 200: Stilstand, 201: Stilstand },
      },
    },
    async (req, reply) => {
      if (req.body.id) {
        const al = await eenStilstand(app.db, req.body.id);
        if (al) return reply.status(200).send(al as never);
      }
      const id = await inTransactie(app.db, req.user.naam, async (tx) => {
        const { rows: s } = await tx.query("SELECT id FROM processtap WHERE code = $1 AND actief", [req.body.stapcode]);
        if (!s[0]) throw niet("Stap");
        const { rows: o } = await tx.query("SELECT id FROM stilstand_oorzaak WHERE code = $1 AND actief", [req.body.oorzaak]);
        if (!o[0]) throw new ApiFout(422, `Onbekende oorzaak ${req.body.oorzaak}`);
        try {
          await tx.query("SAVEPOINT s");
          const r = await tx.query(
            `INSERT INTO stilstand (id, processtap_id, oorzaak_id, toelichting, begin_op, pc_id, operator_id, gemeld_door)
             VALUES (coalesce($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [req.body.id ?? null, s[0].id, o[0].id, req.body.toelichting?.trim() || null, tijdstip(req.body.begin_op),
              req.user.pcId ?? null, operatorVan(req) ?? null, req.user.sub],
          );
          return r.rows[0].id as string;
        } catch (e) {
          if ((e as { constraint?: string }).constraint === "stilstand_een_lopend") {
            throw new ApiFout(409, `In ${req.body.stapcode} loopt al een stilstand; beëindig die eerst`);
          }
          throw e;
        }
      });
      return reply.status(201).send((await eenStilstand(app.db, id)) as never);
    },
  );

  app.post(
    "/:id/einde",
    {
      preHandler: vereist(...VLOER),
      schema: {
        tags: ["stilstand"],
        params: Type.Object({ id: Type.String({ format: "uuid" }) }),
        // notitie is nieuw in 0.46.0; oudere invoerschermen sturen alleen eind_op (D18).
        body: Type.Object({ eind_op: Type.Optional(Tijd), notitie: Type.Optional(Type.String({ maxLength: 500 })) }),
        response: { 200: Stilstand },
      },
    },
    async (req) => {
      const al = await eenStilstand(app.db, req.params.id);
      if (!al) throw niet("Stilstand");
      if ((al as { eind_op: string | null }).eind_op) return al as never; // al beëindigd (opnieuw verstuurd)
      await inTransactie(app.db, req.user.naam, (tx) =>
        tx.query("UPDATE stilstand SET eind_op = greatest($2::timestamptz, begin_op), beeindigd_door = $3, eind_notitie = nullif(btrim($4), '') WHERE id = $1",
          [req.params.id, tijdstip(req.body.eind_op), operatorVan(req) ?? null, req.body.notitie ?? null]));
      return (await eenStilstand(app.db, req.params.id)) as never;
    },
  );

  // ---------- Beheer: oorzaken ----------
  app.post(
    "/oorzaken",
    {
      preHandler: vereist(...BEHEER),
      schema: {
        tags: ["stilstand", "beheer"],
        body: Type.Object({
          code: Type.String({ pattern: "^[A-Za-z0-9._-]{1,20}$" }),
          naam: Type.String({ minLength: 1, maxLength: 100 }),
          categorie: Type.Union([Type.Literal("storing"), Type.Literal("gepland"), Type.Literal("wachten"), Type.Literal("overig")]),
        }, { additionalProperties: false }),
        response: { 201: Oorzaak },
      },
    },
    async (req, reply) => {
      const r = await inTransactie(app.db, req.user.naam, (tx) =>
        tx.query("INSERT INTO stilstand_oorzaak (code, naam, categorie) VALUES ($1, $2, $3) RETURNING code, naam, categorie, actief",
          [req.body.code.trim(), req.body.naam.trim(), req.body.categorie]));
      return reply.status(201).send(r.rows[0]);
    },
  );
  app.patch(
    "/oorzaken/:code",
    {
      preHandler: vereist(...BEHEER),
      schema: {
        tags: ["stilstand", "beheer"],
        params: Type.Object({ code: Type.String() }),
        body: Type.Object({
          naam: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
          categorie: Type.Optional(Type.Union([Type.Literal("storing"), Type.Literal("gepland"), Type.Literal("wachten"), Type.Literal("overig")])),
          actief: Type.Optional(Type.Boolean()),
        }, { additionalProperties: false, minProperties: 1 }),
        response: { 200: Oorzaak },
      },
    },
    async (req) => {
      const r = await inTransactie(app.db, req.user.naam, (tx) =>
        tx.query(`UPDATE stilstand_oorzaak SET naam = coalesce($2, naam), categorie = coalesce($3, categorie), actief = coalesce($4, actief)
                   WHERE code = $1 RETURNING code, naam, categorie, actief`,
          [req.params.code, req.body.naam?.trim() ?? null, req.body.categorie ?? null, req.body.actief ?? null]));
      if (!r.rows[0]) throw niet("Oorzaak");
      return r.rows[0];
    },
  );
};

export default routes;
