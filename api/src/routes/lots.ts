import { Type } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { invoerContext, invoerTransactie } from "../auth.js";
import { personalSession, requireTransactionPermission } from "../modules/authorization/access.js";
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
      preHandler: personalSession,
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
      let opnieuw = false;
      await invoerTransactie(app.db, req, async (tx) => {
        const { rows } = await tx.query("SELECT batchnummer,id,product_id,lot_id FROM batch WHERE batchnummer = ANY($1) ORDER BY id FOR UPDATE", [req.body.batchnummers]);
        const gevonden = new Map(rows.map((r) => [r.batchnummer as string, r.id as string]));
        const ontbreekt = req.body.batchnummers.filter((n) => !gevonden.has(n));
        if (ontbreekt.length) throw niet(`Batch ${ontbreekt.join(", ")}`);
        if (new Set(req.body.batchnummers).size !== req.body.batchnummers.length) throw new ApiFout(422,"Dubbele batch");
        for (const row of rows) await requireTransactionPermission(tx,req.user.sub,"execution.lot.create",{product:row.product_id ?? undefined});
        if (req.body.id) {
          const { rows: [existing] } = await tx.query("SELECT l.lotnummer,(SELECT count(*)::int FROM batch WHERE lot_id=l.id) AS n FROM lot l WHERE id=$1", [req.body.id]);
          if (existing) {
            if (existing.lotnummer !== req.body.lotnummer || existing.n !== rows.length || rows.some(row=>row.lot_id!==req.body.id)) throw new ApiFout(409,"Dit id hoort bij een ander lot");
            const { rows: [original] } = await tx.query("SELECT operator_id FROM stapregistratie r JOIN processtap s ON s.id=r.processtap_id WHERE r.lot_id=$1 AND s.is_lot_stap ORDER BY r.poging LIMIT 1",[req.body.id]);
            if (original?.operator_id !== operatorId) throw new ApiFout(409,"Dit lot is door een andere operator geregistreerd");
            opnieuw=true; return;
          }
        }
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
      return antwoord(opnieuw ? 200 : 201);
    },
  );

  // Lots zoeken en bladeren (nieuwste eerst), met het aantal afwijkingen per lot.
  app.get(
    "/",
    {
      preHandler: personalSession,
      schema: {
        tags: ["lots"],
        querystring: Type.Object({
          zoek: Type.Optional(Type.String({ description: "Deel van een lot- of batchnummer" })),
          product: Type.Optional(Type.String({ description: "Alleen lots van dit product (productcode, D55). Leeg = alle producten" })),
          limiet: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, default: 50 })),
        }),
        response: {
          200: Type.Array(Type.Intersect([Lot, Type.Object({ afwijkingen: Type.Integer(), herbewerkingen: Type.Integer(), product: Type.Union([Type.String(), Type.Null()]) })])),
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
                (SELECT count(*) FROM stapregistratie r WHERE r.lot_id = l.id AND r.herbewerking_start) AS herbewerkingen,
                (SELECT min(pr.code) FROM batch b JOIN product pr ON pr.id = b.product_id WHERE b.lot_id = l.id) AS product
           FROM lot l
          WHERE ($1::text IS NULL OR l.lotnummer LIKE $1
             OR EXISTS (SELECT 1 FROM batch b WHERE b.lot_id = l.id AND b.batchnummer LIKE $1))
            AND ($3::text IS NULL OR EXISTS (SELECT 1 FROM batch b JOIN product pr ON pr.id = b.product_id
                                              WHERE b.lot_id = l.id AND pr.code = $3))
            AND authorization_read_lot($4,l.id)
          ORDER BY l.aangemaakt_op DESC LIMIT $2`,
        [zoek, req.query.limiet ?? 50, req.query.product || null,req.user.sub],
      ) as never;
    },
  );

  app.get(
    "/:lotnummer",
    {
      preHandler: personalSession,
      schema: {
        tags: ["lots"],
        params: Type.Object({ lotnummer: LotNummer }),
        response: { 200: Type.Intersect([Lot, Type.Object({ registraties: Type.Array(RegistratieKort) })]) },
      },
    },
    async (req) => {
      const [lot] = await lees(app.db, `${LOT_SQL} WHERE l.lotnummer = $1 AND authorization_read_lot($2,l.id) GROUP BY l.id`, [req.params.lotnummer,req.user.sub]);
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
      preHandler: personalSession,
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
        const { rows } = await tx.query("SELECT id FROM lot WHERE lotnummer = $1 FOR UPDATE", [req.params.lotnummer]);
        if (!rows[0]) throw niet("Lot");
        const { rows: members } = await tx.query<{product_id:string|null}>("SELECT product_id FROM batch WHERE lot_id=$1", [rows[0].id]);
        for (const member of members.length ? members : [{product_id:null}]) await requireTransactionPermission(tx,req.user.sub,"execution.rework",{product:member.product_id ?? undefined});
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

  // Eén meting uit het lotpaspoort met alles eromheen (0.32.0, #56): de versies (met correcties), wie wat deed,
  // en het keurresultaat van de batch of de herbewerkingen van het lot.
  const OptT = Type.Union([Type.Null(), Type.String()]);
  const OptN = Type.Union([Type.Null(), Type.Number()]);
  app.get(
    "/:lotnummer/meting",
    {
      preHandler: personalSession,
      schema: {
        tags: ["lots", "analyse"],
        description: "Eén meting uit het lotpaspoort: alle versies (de laatste geldt), en het keurresultaat van de batch of de herbewerkingen van het lot.",
        params: Type.Object({ lotnummer: LotNummer }),
        querystring: Type.Object({ nummer: Type.String({ description: "Batch- of lotnummer zoals in het lotpaspoort" }), stap: StapCode, poging: Type.Integer({ minimum: 1 }), veld: Type.String() }),
        response: {
          200: Type.Object({
            batch_of_lot: Type.String(), stap: Type.String(), stapnaam: Type.String(), poging: Type.Integer(), herbewerking_reden: OptT,
            veld: Type.String(), veldnaam: Type.String(), soort: Type.String(), eenheid: OptT, decimalen: Type.Union([Type.Null(), Type.Integer()]),
            operator: Type.String(), pc: Type.String(), gestart_op: Type.String({ format: "date-time" }), afgerond_op: Type.Union([Type.Null(), Type.String({ format: "date-time" })]),
            product: OptT,
            versies: Type.Array(Type.Object({
              setting: OptN, gemeten: Type.Number(), grens_min: OptN, grens_max: OptN, tolerantie: OptN, tolerantie_soort: OptT,
              markering: Type.String(), ingevoerd_op: Type.String({ format: "date-time" }), door: Type.String(), correctie_reden: OptT,
            }), { description: "Oudste eerst; de laatste geldt" }),
            besluiten: Type.Array(Type.Object({ besluit: Type.String(), reden: Type.String(), besloten_door: Type.String(), besloten_op: Type.String({ format: "date-time" }) })),
            herbewerkingen: Type.Array(Type.Object({ stap: Type.String(), poging: Type.Integer(), reden: OptT, gestart_op: Type.String({ format: "date-time" }) })),
          }),
        },
      },
    },
    async (req) => {
      const q = req.query;
      const [r] = await lees<{ id: string; batch_id: string | null; lot_id: string }>(
        app.db,
        `SELECT r.id, r.batch_id, l.id AS lot_id, coalesce(b.batchnummer, l.lotnummer) AS batch_of_lot, s.code AS stap, s.naam AS stapnaam,
                r.poging, r.reden AS herbewerking_reden, v.code AS veld, v.naam AS veldnaam, v.soort, v.eenheid, v.decimalen,
                -- Wie de oorspronkelijke waarde invoerde; bij een overgenomen stap (#55) is dat niet altijd wie startte.
                coalesce((SELECT io.naam FROM waarde w0 JOIN operator io ON io.id = w0.ingevoerd_door
                           WHERE w0.stapregistratie_id = r.id AND w0.veld_id = v.id AND w0.vervangt_waarde_id IS NULL), o.naam) AS operator,
                p.naam AS pc, r.gestart_op, r.afgerond_op, pr.code AS product
           FROM lot l
           JOIN stapregistratie r ON r.lot_id = l.id OR r.batch_id IN (SELECT id FROM batch WHERE lot_id = l.id)
           LEFT JOIN batch b ON b.id = r.batch_id
           JOIN processtap s ON s.id = r.processtap_id
           JOIN veld v ON v.processtap_id = s.id AND v.code = $5
           JOIN operator o ON o.id = r.operator_id
           JOIN pc p ON p.id = r.pc_id
           LEFT JOIN product pr ON pr.id = r.product_id
          WHERE l.lotnummer = $1 AND authorization_read_lot($6,l.id) AND coalesce(b.batchnummer, l.lotnummer) = $2 AND s.code = $3 AND r.poging = $4`,
        [req.params.lotnummer, q.nummer, q.stap, q.poging, q.veld,req.user.sub],
      );
      if (!r) throw niet("Meting");
      const versies = await lees(
        app.db,
        `SELECT w.setting, w.gemeten, w.grens_min, w.grens_max, w.tolerantie, w.tolerantie_soort, w.markering, w.ingevoerd_op,
                coalesce(g.gebruikersnaam, o.naam, '?') AS door, w.correctie_reden
           FROM waarde w JOIN veld v ON v.id = w.veld_id
           LEFT JOIN operator o ON o.id = w.ingevoerd_door LEFT JOIN gebruiker g ON g.id = w.gecorrigeerd_door
          WHERE w.stapregistratie_id = $1 AND v.code = $2
          ORDER BY w.ingevoerd_op, w.vervangt_waarde_id NULLS FIRST`,
        [r.id, q.veld],
      );
      const besluiten = r.batch_id
        ? await lees(app.db,
            `SELECT d.besluit, d.reden, g.gebruikersnaam AS besloten_door, d.besloten_op
               FROM batch_besluit d JOIN gebruiker g ON g.id = d.besloten_door WHERE d.batch_id = $1 ORDER BY d.besloten_op`, [r.batch_id])
        : [];
      const herbewerkingen = r.batch_id
        ? []
        : await lees(app.db,
            `SELECT s.code AS stap, x.poging, x.reden, x.gestart_op FROM stapregistratie x JOIN processtap s ON s.id = x.processtap_id
              WHERE x.lot_id = $1 AND x.herbewerking_start ORDER BY x.gestart_op`, [r.lot_id]);
      const { id: _id, batch_id: _b, lot_id: _l, ...rest } = r;
      return { ...rest, versies, besluiten, herbewerkingen } as never;
    },
  );

  // Lotpaspoort: alle actuele waarden van het lot en zijn 4 batches.
  app.get(
    "/:lotnummer/paspoort",
    {
      preHandler: personalSession,
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
      const [lot] = await lees<{ batches: string[] }>(app.db, `${LOT_SQL} WHERE l.lotnummer = $1 AND authorization_read_lot($2,l.id) GROUP BY l.id`, [
        req.params.lotnummer,req.user.sub,
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
