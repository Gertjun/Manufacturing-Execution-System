import { Type } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { BEHEER, IEDEREEN, vereist, type Rol, operatorVan } from "../auth.js";
import { inTransactie, lees, type Db } from "../db.js";
import { ApiFout, niet } from "../fouten.js";

/** Een overdracht schrijven mogen de mensen op de vloer en de ploegleider. */
const SCHRIJVEN: Rol[] = ["operator", "ploegleider", "beheerder"];
const Dag = Type.String({ format: "date" });
const OptTekst = Type.Union([Type.Null(), Type.String()]);

const Ploeg = Type.Object({ code: Type.String(), naam: Type.String(), begint: Type.String(), eindigt: Type.String(), actief: Type.Boolean() });
const Notitie = Type.Object({
  id: Type.String(),
  hal: OptTekst,
  bijzonderheden: OptTekst,
  aandachtspunten: OptTekst,
  door: Type.String({ description: "Operatornaam, of de gebruikersnaam als er geen operator is gekozen" }),
  pc: OptTekst,
  geschreven_op: Type.String({ format: "date-time" }),
});
const Samenvatting = Type.Object({
  ploeg: Type.String(),
  ploegnaam: Type.String(),
  dag: Dag,
  begin_op: Type.String({ format: "date-time" }),
  eind_op: Type.String({ format: "date-time" }),
  loopt_nog: Type.Boolean(),
  cijfers: Type.Object({
    stappen_afgerond: Type.Integer(),
    batches_gestart: Type.Integer(),
    lots_gemaakt: Type.Integer(),
    afwijkingen: Type.Integer(),
    correcties: Type.Integer(),
    in_beoordeling_gezet: Type.Integer(),
  }),
  per_stap: Type.Array(Type.Object({ stap: Type.String(), stapnaam: Type.String(), afgerond: Type.Integer() })),
  nog_open: Type.Array(Type.Object({ stap: Type.String(), nummer: Type.String(), sinds: Type.String({ format: "date-time" }), operator: Type.String() })),
  notities: Type.Array(Notitie),
});

interface Periode { ploeg_id: string; code: string; naam: string; dag: string; begin_op: string; eind_op: string }

/** Cijfers, open werk en notities van één ploeg. Met hal: alleen notities van die hal en van de hele fabriek. */
async function samenvatting(db: Db, p: Periode, hal: string | null) {
  const t = [p.begin_op, p.eind_op];
  const [c] = await lees<Record<string, number>>(
    db,
    `SELECT (SELECT count(*) FROM stapregistratie WHERE status = 'afgerond' AND afgerond_op >= $1 AND afgerond_op < $2)::int AS stappen_afgerond,
            (SELECT count(*) FROM batch WHERE gestart_op >= $1 AND gestart_op < $2)::int AS batches_gestart,
            (SELECT count(*) FROM lot WHERE aangemaakt_op >= $1 AND aangemaakt_op < $2)::int AS lots_gemaakt,
            (SELECT count(*) FROM waarde WHERE vervangt_waarde_id IS NULL AND markering <> 'ok' AND ingevoerd_op >= $1 AND ingevoerd_op < $2)::int AS afwijkingen,
            (SELECT count(*) FROM waarde WHERE vervangt_waarde_id IS NOT NULL AND ingevoerd_op >= $1 AND ingevoerd_op < $2)::int AS correcties,
            (SELECT count(*) FROM batch_besluit WHERE besluit = 'in_beoordeling' AND besloten_op >= $1 AND besloten_op < $2)::int AS in_beoordeling_gezet`,
    t,
  );
  const per_stap = await lees(
    db,
    `SELECT s.code AS stap, s.naam AS stapnaam, count(*)::int AS afgerond
       FROM stapregistratie r JOIN processtap s ON s.id = r.processtap_id
      WHERE r.status = 'afgerond' AND r.afgerond_op >= $1 AND r.afgerond_op < $2
      GROUP BY s.code, s.naam, s.volgorde ORDER BY s.volgorde`,
    t,
  );
  // Wat aan het eind van de ploeg (of nu) nog open stond en in deze ploeg of eerder is gestart.
  const nog_open = await lees(
    db,
    `SELECT s.code AS stap, coalesce(b.batchnummer, l.lotnummer) AS nummer, r.gestart_op AS sinds, o.naam AS operator
       FROM stapregistratie r JOIN processtap s ON s.id = r.processtap_id JOIN operator o ON o.id = r.operator_id
       LEFT JOIN batch b ON b.id = r.batch_id LEFT JOIN lot l ON l.id = r.lot_id
      WHERE r.gestart_op < least($1::timestamptz, now())
        AND (r.status = 'open' OR r.afgerond_op >= least($1::timestamptz, now()))
      ORDER BY s.volgorde, r.gestart_op`,
    [p.eind_op],
  );
  const notities = await lees(
    db,
    `SELECT n.id::text, n.hal, n.bijzonderheden, n.aandachtspunten, coalesce(o.naam, g.gebruikersnaam) AS door, pc.naam AS pc, n.geschreven_op
       FROM overdracht n JOIN gebruiker g ON g.id = n.gebruiker_id
       LEFT JOIN operator o ON o.id = n.operator_id LEFT JOIN pc ON pc.id = n.pc_id
      WHERE n.ploeg_id = $1 AND n.dag = $2 AND ($3::text IS NULL OR n.hal IS NULL OR n.hal = $3)
      ORDER BY n.geschreven_op`,
    [p.ploeg_id, p.dag, hal],
  );
  return {
    ploeg: p.code,
    ploegnaam: p.naam,
    dag: p.dag,
    begin_op: p.begin_op,
    eind_op: p.eind_op,
    loopt_nog: Date.parse(p.eind_op) > Date.now() && Date.parse(p.begin_op) <= Date.now(),
    cijfers: c,
    per_stap,
    nog_open,
    notities,
  };
}

const PERIODE_SQL = "SELECT ploeg_id::text, code, naam, dag::text, begin_op, eind_op FROM ploeg_van($1)";

/** De hal van de pc in het token (als die er is). */
async function halVan(db: Db, pcId?: string) {
  if (!pcId) return null;
  const [r] = await lees<{ locatie: string | null }>(db, "SELECT locatie FROM pc WHERE id = $1", [pcId]);
  return r?.locatie ?? null;
}

const routes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/ploegen",
    { preHandler: vereist(...IEDEREEN), schema: { tags: ["overdracht"], response: { 200: Type.Array(Ploeg) } } },
    async () =>
      (await lees(app.db, "SELECT code, naam, to_char(begint, 'HH24:MI') AS begint, to_char(eindigt, 'HH24:MI') AS eindigt, actief FROM ploeg ORDER BY begint")) as never,
  );

  app.get(
    "/",
    {
      preHandler: vereist(...IEDEREEN),
      schema: {
        tags: ["overdracht"],
        description:
          "Samenvatting van een ploeg: cijfers, afgeronde stappen, wat nog open stond, en de notities. Zonder parameters: de huidige ploeg. Met vorige=true: de ploeg daarvoor. Met dag en ploeg: die ploeg.",
        querystring: Type.Object({
          dag: Type.Optional(Dag),
          ploeg: Type.Optional(Type.String()),
          vorige: Type.Optional(Type.Boolean()),
          hal: Type.Optional(Type.String()),
        }),
        response: { 200: Type.Union([Samenvatting, Type.Null()]) },
      },
    },
    async (req) => {
      const hal = req.query.hal ?? (await halVan(app.db, req.user.pcId));
      let p: Periode | undefined;
      if (req.query.dag && req.query.ploeg) {
        // Begin van die ploeg op die dag; ploeg_van geeft dan precies die ploeg.
        [p] = await lees<Periode>(
          app.db,
          `SELECT x.* FROM ploeg pl CROSS JOIN LATERAL (${PERIODE_SQL.replace("$1", "($1::date + pl.begint)::timestamptz")}) x WHERE pl.code = $2 AND x.code = pl.code`,
          [req.query.dag, req.query.ploeg],
        );
        if (!p) throw niet("Ploeg");
      } else {
        [p] = await lees<Periode>(app.db, PERIODE_SQL, [new Date().toISOString()]);
        if (p && req.query.vorige) [p] = await lees<Periode>(app.db, PERIODE_SQL, [new Date(Date.parse(p.begin_op) - 60_000).toISOString()]);
      }
      if (!p) return null as never;
      return (await samenvatting(app.db, p, hal)) as never;
    },
  );

  app.get(
    "/dag",
    {
      preHandler: vereist(...IEDEREEN),
      schema: {
        tags: ["overdracht"],
        description: "Alle ploegen van een dag, met hun samenvatting (voor het portaal).",
        querystring: Type.Object({ dag: Dag }),
        response: { 200: Type.Array(Samenvatting) },
      },
    },
    async (req) => {
      const ploegen = await lees<Periode>(
        app.db,
        `SELECT x.* FROM ploeg pl CROSS JOIN LATERAL (${PERIODE_SQL.replace("$1", "($1::date + pl.begint)::timestamptz")}) x
          WHERE pl.actief AND x.code = pl.code ORDER BY x.begin_op`,
        [req.query.dag],
      );
      const nu = Date.now();
      const uit = [];
      for (const p of ploegen) if (Date.parse(p.begin_op) <= nu) uit.push(await samenvatting(app.db, p, null));
      return uit as never;
    },
  );

  app.get(
    "/plan",
    {
      preHandler: vereist(...IEDEREEN),
      schema: {
        tags: ["overdracht"],
        description:
          "Hoeveel stappen er op een dag gepland zijn en hoeveel daarvan klaar of bezig zijn (#62). Een geplande stap is klaar als de batch of het lot die stap heeft afgerond " +
          "(ook als dat op een andere dag was); een lotvoorstel is klaar als het lot is samengesteld.",
        querystring: Type.Object({ dag: Dag }),
        response: { 200: Type.Object({ dag: Dag, gepland: Type.Integer(), afgerond: Type.Integer(), bezig: Type.Integer() }) },
      },
    },
    async (req) => {
      const [r] = await lees(
        app.db,
        `WITH x AS (
           SELECT CASE
                    WHEN sp.voorstel_id IS NOT NULL THEN
                      CASE WHEN (SELECT v.status FROM lot_voorstel v WHERE v.id = sp.voorstel_id) IN ('gebruikt', 'afgeweken') THEN 'afgerond' ELSE 'gepland' END
                    ELSE coalesce((SELECT r.status FROM stapregistratie r
                                    WHERE r.processtap_id = sp.processtap_id AND (r.batch_id = sp.batch_id OR r.lot_id = sp.lot_id) AND r.status <> 'afgebroken'
                                    ORDER BY r.poging DESC LIMIT 1), 'gepland')
                  END AS stand
             FROM stapplanning sp WHERE sp.dag = $1)
         SELECT to_char($1::date, 'YYYY-MM-DD') AS dag, count(*)::int AS gepland,
                count(*) FILTER (WHERE stand = 'afgerond')::int AS afgerond, count(*) FILTER (WHERE stand = 'open')::int AS bezig
           FROM x`,
        [req.query.dag],
      );
      return r as never;
    },
  );

  app.post(
    "/",
    {
      preHandler: vereist(...SCHRIJVEN),
      schema: {
        tags: ["overdracht"],
        description: "Overdracht schrijven voor de ploeg van 'moment' (standaard nu). Met een eigen id is opnieuw versturen veilig (offline wachtrij).",
        body: Type.Object({
          id: Type.Optional(Type.String({ format: "uuid" })),
          bijzonderheden: Type.Optional(Type.Union([Type.Null(), Type.String({ maxLength: 2000 })])),
          aandachtspunten: Type.Optional(Type.Union([Type.Null(), Type.String({ maxLength: 2000 })])),
          moment: Type.Optional(Type.String({ format: "date-time", description: "Wanneer geschreven (op het apparaat); bepaalt de ploeg" })),
        }),
        response: { 200: Notitie, 201: Notitie },
      },
    },
    async (req, reply) => {
      const tekst = (t?: string | null) => t?.trim() || null;
      const bijz = tekst(req.body.bijzonderheden), aand = tekst(req.body.aandachtspunten);
      if (!bijz && !aand) throw new ApiFout(400, "Vul bijzonderheden of aandachtspunten in");
      const lees1 = async (id: string) =>
        (await lees(app.db,
          `SELECT n.id::text, n.hal, n.bijzonderheden, n.aandachtspunten, coalesce(o.naam, g.gebruikersnaam) AS door, pc.naam AS pc, n.geschreven_op
             FROM overdracht n JOIN gebruiker g ON g.id = n.gebruiker_id LEFT JOIN operator o ON o.id = n.operator_id LEFT JOIN pc ON pc.id = n.pc_id
            WHERE n.id = $1`, [id]))[0];
      if (req.body.id) {
        const al = await lees1(req.body.id);
        if (al) return reply.status(200).send(al as never);
      }
      // Een tijdstip uit de toekomst (verkeerde klok) telt als nu.
      const moment = req.body.moment && Date.parse(req.body.moment) < Date.now() ? req.body.moment : new Date().toISOString();
      const hal = await halVan(app.db, req.user.pcId);
      const id = await inTransactie(app.db, req.user.naam, async (tx) => {
        const { rows } = await tx.query("SELECT ploeg_id, dag FROM ploeg_van($1)", [moment]);
        if (!rows[0]) throw new ApiFout(422, "Er is geen ploeg ingesteld voor dit tijdstip");
        const r = await tx.query(
          `INSERT INTO overdracht (id, dag, ploeg_id, hal, bijzonderheden, aandachtspunten, gebruiker_id, operator_id, pc_id, geschreven_op)
           VALUES (coalesce($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
          [req.body.id ?? null, rows[0].dag, rows[0].ploeg_id, hal, bijz, aand, req.user.sub, operatorVan(req) ?? null, req.user.pcId ?? null, moment],
        );
        return r.rows[0].id as string;
      });
      return reply.status(201).send((await lees1(id)) as never);
    },
  );

  // ---------- Beheer: ploegtijden ----------
  app.patch(
    "/ploegen/:code",
    {
      preHandler: vereist(...BEHEER),
      schema: {
        tags: ["overdracht", "beheer"],
        params: Type.Object({ code: Type.String() }),
        body: Type.Object({
          naam: Type.Optional(Type.String({ minLength: 1, maxLength: 60 })),
          begint: Type.Optional(Type.String({ pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" })),
          eindigt: Type.Optional(Type.String({ pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" })),
          actief: Type.Optional(Type.Boolean()),
        }, { additionalProperties: false, minProperties: 1 }),
        response: { 200: Ploeg },
      },
    },
    async (req) => {
      const r = await inTransactie(app.db, req.user.naam, (tx) =>
        tx.query(
          `UPDATE ploeg SET naam = coalesce($2, naam), begint = coalesce($3::time, begint), eindigt = coalesce($4::time, eindigt), actief = coalesce($5, actief)
            WHERE code = $1 RETURNING code, naam, to_char(begint, 'HH24:MI') AS begint, to_char(eindigt, 'HH24:MI') AS eindigt, actief`,
          [req.params.code, req.body.naam?.trim() ?? null, req.body.begint ?? null, req.body.eindigt ?? null, req.body.actief ?? null],
        ));
      if (!r.rows[0]) throw niet("Ploeg");
      return r.rows[0];
    },
  );
};

export default routes;
