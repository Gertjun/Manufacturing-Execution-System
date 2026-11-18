import { Type } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { IEDEREEN, vereist } from "../auth.js";
import { lees } from "../db.js";
import { RegistratieKort, REGISTRATIE_SQL, StapCode } from "./schemas.js";

const routes: FastifyPluginAsyncTypebox = async (app) => {
  // Per stap: hoeveel staat er open en hoeveel staat klaar.
  app.get(
    "/",
    {
      preHandler: vereist(...IEDEREEN),
      schema: {
        tags: ["werkvoorraad"],
        response: {
          200: Type.Array(
            Type.Object({
              stapcode: Type.String(),
              stapnaam: Type.String(),
              niveau: Type.String(),
              open: Type.Integer(),
              wachtend: Type.Integer(),
              oudste_open: Type.Union([Type.Null(), Type.String({ format: "date-time" })]),
              oudste_wachtend: Type.Union([Type.Null(), Type.String({ format: "date-time" })]),
            }),
          ),
        },
      },
    },
    async () =>
      (await lees(
        app.db,
        `SELECT s.code AS stapcode, s.naam AS stapnaam, s.niveau,
                (SELECT count(*) FROM stapregistratie r WHERE r.processtap_id = s.id AND r.status = 'open') AS open,
                w.n AS wachtend,
                (SELECT min(r.gestart_op) FROM stapregistratie r WHERE r.processtap_id = s.id AND r.status = 'open') AS oudste_open,
                w.oudste AS oudste_wachtend
           FROM processtap s
           CROSS JOIN LATERAL (SELECT count(*) AS n, min(sinds) AS oudste FROM werkvoorraad(s.code)) w
          WHERE s.actief ORDER BY s.volgorde`,
      )) as never,
  );

  // Voor één stap: open registraties en wat klaarstaat om te starten.
  app.get(
    "/:stapcode",
    {
      preHandler: vereist(...IEDEREEN),
      schema: {
        tags: ["werkvoorraad"],
        params: Type.Object({ stapcode: StapCode }),
        response: {
          200: Type.Object({
            open: Type.Array(RegistratieKort),
            wachtend: Type.Array(
              Type.Object({
                soort: Type.Union([Type.Literal("batch"), Type.Literal("lot")]),
                nummer: Type.String(),
                sinds: Type.Union([Type.Null(), Type.String({ format: "date-time" })]),
              }),
            ),
          }),
        },
      },
    },
    async (req) => {
      const open = await lees(app.db, `${REGISTRATIE_SQL} WHERE s.code = $1 AND r.status = 'open' ORDER BY r.gestart_op`, [
        req.params.stapcode,
      ]);
      const wachtend = await lees(app.db, "SELECT * FROM werkvoorraad($1)", [req.params.stapcode]);
      return { open, wachtend } as never;
    },
  );
};

export default routes;
