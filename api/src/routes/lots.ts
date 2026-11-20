import { Type } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { IEDEREEN, INVOER, invoerContext, invoerTransactie, vereist } from "../auth.js";
import { inTransactie, lees } from "../db.js";
import { ApiFout, niet } from "../fouten.js";
import { registratieDetail } from "./registraties.js";
import { BatchNummer, LotNummer, PaspoortRegel, RegistratieDetail, RegistratieKort, REGISTRATIE_SQL, StapCode, NulGetal } from "./schemas.js";

const Lot = Type.Object({
  lotnummer: Type.String(),
  status: Type.String(),
  aangemaakt_op: Type.String({ format: "date-time" }),
  batches: Type.Array(Type.String()),
});

const LOT_SQL = `
  SELECT l.lotnummer, l.status, l.aangemaakt_op,
         coalesce(array_agg(b.batchnummer ORDER BY b.batchnummer) FILTER (WHERE b.id IS NOT NULL), '{}') AS batches
    FROM lot l LEFT JOIN batch b ON b.lot_id = l.id`;

const routes: FastifyPluginAsyncTypebox = async (app) => {
  // PS16: 4 batches samenvoegen tot een lot. Opent meteen de PS16-registratie.
  app.post(
    "/",
    {
      preHandler: vereist(...INVOER),
      schema: {
        tags: ["lots"],
        body: Type.Object({
          id: Type.Optional(Type.String({ format: "uuid", description: "Id voor het lot, door het apparaat gemaakt" })),
          registratieId: Type.Optional(Type.String({ format: "uuid", description: "Id voor de PS16-registratie" })),
          lotnummer: LotNummer,
          batchnummers: Type.Array(BatchNummer, { minItems: 4, maxItems: 4 }),
          afwijkingReden: Type.Optional(
            Type.Union([Type.Null(), Type.String({ minLength: 3, maxLength: 500, description: "Verplicht als de batches afwijken van een lotvoorstel" })]),
          ),
        }),
        response: {
          200: Type.Object({ lot: Lot, registratie: RegistratieDetail }),
          201: Type.Object({ lot: Lot, registratie: RegistratieDetail }),
        },
      },
    },
    async (req, reply) => {
      const { pcId, operatorId } = await invoerContext(app.db, req);
      const antwoord = async (status: 200 | 201) => {
        const [lot] = await lees(app.db, `${LOT_SQL} WHERE l.lotnummer = $1 GROUP BY l.id`, [req.body.lotnummer]);
        const [ps16] = await lees<{ id: string }>(app.db, `${REGISTRATIE_SQL} WHERE l.lotnummer = $1 AND s.is_lot_stap ORDER BY r.poging LIMIT 1`, [
          req.body.lotnummer,
        ]);
        return reply.status(status).send({ lot, registratie: await registratieDetail(app.db, ps16.id) } as never);
      };
      if (req.body.id) {
        const [bestaand] = await lees<{ lotnummer: string }>(app.db, "SELECT lotnummer FROM lot WHERE id = $1", [req.body.id]);
        if (bestaand) {
          if (bestaand.lotnummer !== req.body.lotnummer) throw new ApiFout(409, "Dit id hoort bij een ander lot");
          return antwoord(200);
        }
      }
      await invoerTransactie(app.db, req, async (tx) => {
        const { rows } = await tx.query("SELECT batchnummer, id FROM batch WHERE batchnummer = ANY($1)", [req.body.batchnummers]);
        const gevonden = new Map(rows.map((r) => [r.batchnummer as string, r.id as string]));
        const ontbreekt = req.body.batchnummers.filter((n) => !gevonden.has(n));
        if (ontbreekt.length) throw niet(`Batch ${ontbreekt.join(", ")}`);
        await tx.query("SELECT maak_lot($1, $2, $3, $4, $5, $6, $7)", [
          req.body.lotnummer,
          req.body.batchnummers.map((n) => gevonden.get(n)),
          pcId,
          operatorId,
          req.body.id ?? null,
          req.body.registratieId ?? null,
          req.body.afwijkingReden?.trim() || null,
        ]);
      });
      return antwoord(201);
    },
  );

  // Lots zoeken en bladeren (nieuwste eerst), met het aantal afwijkingen per lot.
  app.get(
    "/",
    {
      preHandler: vereist(...IEDEREEN),
      schema: {
        tags: ["lots"],
        querystring: Type.Object({
          zoek: Type.Optional(Type.String({ description: "Deel van een lot- of batchnummer" })),
          limiet: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, default: 50 })),
        }),
        response: {
          200: Type.Array(Type.Intersect([Lot, Type.Object({ afwijkingen: Type.Integer(), herbewerkingen: Type.Integer() })])),
        },
      },
    },
    async (req) => {
      const zoek = req.query.zoek ? `%${req.query.zoek.toUpperCase()}%` : null;
      return lees(
        app.db,
        `SELECT l.lotnummer, l.status, l.aangemaakt_op,
                (SELECT coalesce(array_agg(b.batchnummer ORDER BY b.batchnummer), '{}') FROM batch b WHERE b.lot_id = l.id) AS batches,
                (SELECT count(*) FROM lotpaspoort p WHERE p.lotnummer = l.lotnummer AND p.markering <> 'ok') AS afwijkingen,
                (SELECT count(*) FROM stapregistratie r WHERE r.lot_id = l.id AND r.herbewerking_start) AS herbewerkingen
           FROM lot l
          WHERE $1::text IS NULL OR l.lotnummer LIKE $1
             OR EXISTS (SELECT 1 FROM batch b WHERE b.lot_id = l.id AND b.batchnummer LIKE $1)
          ORDER BY l.aangemaakt_op DESC LIMIT $2`,
        [zoek, req.query.limiet ?? 50],
      ) as never;
    },
  );

  app.get(
    "/:lotnummer",
    {
      preHandler: vereist(...IEDEREEN),
      schema: {
        tags: ["lots"],
        params: Type.Object({ lotnummer: LotNummer }),
        response: { 200: Type.Intersect([Lot, Type.Object({ registraties: Type.Array(RegistratieKort) })]) },
      },
    },
    async (req) => {
      const [lot] = await lees(app.db, `${LOT_SQL} WHERE l.lotnummer = $1 GROUP BY l.id`, [req.params.lotnummer]);
      if (!lot) throw niet("Lot");
      const registraties = await lees(app.db, `${REGISTRATIE_SQL} WHERE l.lotnummer = $1 ORDER BY s.volgorde, r.poging`, [
        req.params.lotnummer,
      ]);
      return { ...lot, registraties } as never;
    },
  );

  // Herbewerking: lot terug naar een lot-stap; daarna alle volgende stappen opnieuw.
  app.post(
    "/:lotnummer/herbewerking",
    {
      preHandler: vereist(...INVOER),
      schema: {
        tags: ["lots"],
        params: Type.Object({ lotnummer: LotNummer }),
        body: Type.Object({
          id: Type.Optional(Type.String({ format: "uuid" })),
          stapcode: StapCode,
          reden: Type.String({ minLength: 1, examples: ["te nat na verpakken"] }),
        }),
        response: { 201: RegistratieDetail },
      },
    },
    async (req, reply) => {
      const { pcId, operatorId } = await invoerContext(app.db, req);
      const id = await invoerTransactie(app.db, req, async (tx) => {
        const { rows } = await tx.query("SELECT id FROM lot WHERE lotnummer = $1", [req.params.lotnummer]);
        if (!rows[0]) throw niet("Lot");
        const r = await tx.query("SELECT start_herbewerking($1, $2, $3, $4, $5, $6) AS id", [
          rows[0].id,
          req.body.stapcode,
          req.body.reden,
          pcId,
          operatorId,
          req.body.id ?? null,
        ]);
        return r.rows[0].id as string;
      });
      return reply.status(201).send((await registratieDetail(app.db, id)) as never);
    },
  );

  // Lotpaspoort: alle actuele waarden van het lot en zijn 4 batches.
  app.get(
    "/:lotnummer/paspoort",
    {
      preHandler: vereist(...IEDEREEN),
      schema: {
        tags: ["lots", "analyse"],
        params: Type.Object({ lotnummer: LotNummer }),
        querystring: Type.Object({ alleenAfwijkingen: Type.Optional(Type.Boolean()) }),
        response: {
          200: Type.Object({
            lotnummer: Type.String(),
            batches: Type.Array(Type.String()),
            aantal_afwijkingen: Type.Integer(),
            regels: Type.Array(PaspoortRegel),
            grondstoffen: Type.Array(Type.Object({
              batch_of_lot: Type.String(), stap: Type.String(), grondstof: Type.String(), grondstofnaam: Type.String(),
              partij: Type.String(), hoeveelheid: NulGetal(), eenheid: Type.Union([Type.Null(), Type.String()]),
              gecorrigeerd: Type.Boolean(),
            }), { description: "Gebruikte grondstofpartijen van het lot en zijn batches" }),
          }),
        },
      },
    },
    async (req) => {
      const [lot] = await lees<{ batches: string[] }>(app.db, `${LOT_SQL} WHERE l.lotnummer = $1 GROUP BY l.id`, [
        req.params.lotnummer,
      ]);
      if (!lot) throw niet("Lot");
      const regels = await lees<{ markering: string }>(
        app.db,
        `SELECT * FROM lotpaspoort WHERE lotnummer = $1 AND (NOT $2 OR markering <> 'ok')
          ORDER BY (markering = 'ok'), volgorde, batch_of_lot, poging, veld`,
        [req.params.lotnummer, req.query.alleenAfwijkingen ?? false],
      );
      const [{ n }] = await lees<{ n: number }>(
        app.db,
        "SELECT count(*) AS n FROM lotpaspoort WHERE lotnummer = $1 AND markering <> 'ok'",
        [req.params.lotnummer],
      );
      const grondstoffen = await lees(
        app.db,
        `SELECT coalesce(b.batchnummer, l.lotnummer) AS batch_of_lot, s.code AS stap, g.code AS grondstof, g.naam AS grondstofnaam,
                u.partij, u.hoeveelheid, g.eenheid, u.vervangt_id IS NOT NULL AS gecorrigeerd
           FROM grondstof_gebruik_actueel u
           JOIN grondstof g ON g.id = u.grondstof_id
           JOIN stapregistratie r ON r.id = u.stapregistratie_id
           JOIN processtap s ON s.id = r.processtap_id
           LEFT JOIN batch b ON b.id = r.batch_id
           LEFT JOIN lot l ON l.id = coalesce(r.lot_id, b.lot_id)
          WHERE l.lotnummer = $1
          ORDER BY s.volgorde, 1, g.code`,
        [req.params.lotnummer],
      );
      return { lotnummer: req.params.lotnummer, batches: lot.batches, aantal_afwijkingen: n, regels, grondstoffen } as never;
    },
  );
};

export default routes;
