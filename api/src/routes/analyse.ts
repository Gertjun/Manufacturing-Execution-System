import { Type } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { IEDEREEN, vereist } from "../auth.js";
import { lees } from "../db.js";
import { niet } from "../fouten.js";
import { Markering, StapCode } from "./schemas.js";

// Analyses voor de portalen. Elke analyse is een eigen route, zodat een portaal
// kan kiezen welke het toont.

const Periode = {
  van: Type.Optional(Type.String({ format: "date", description: "Vanaf (inclusief), bv. 2026-11-01" })),
  tot: Type.Optional(Type.String({ format: "date", description: "Tot (exclusief)" })),
};
const Tijd = Type.String({ format: "date-time" });
const OptTekst = Type.Union([Type.Null(), Type.String()]);
const OptGetal = Type.Union([Type.Null(), Type.Number()]);

/** Basis: alle actuele waarden met hun context. */
const WAARDEN_SQL = `
  SELECT w.id, coalesce(b.batchnummer, l.lotnummer) AS batch_of_lot,
         coalesce(l.lotnummer, lb.lotnummer) AS lotnummer,
         s.code AS stap, s.volgorde, r.poging, v.code AS veld, v.naam AS veldnaam, v.eenheid,
         w.setting, w.gemeten, w.grens_min, w.grens_max, w.tolerantie, w.tolerantie_soort,
         w.markering, w.ingevoerd_op, o.naam AS operator, p.naam AS pc,
         (w.vervangt_waarde_id IS NOT NULL) AS gecorrigeerd
    FROM waarde_actueel w
    JOIN stapregistratie r ON r.id = w.stapregistratie_id
    JOIN processtap s ON s.id = r.processtap_id
    JOIN veld v ON v.id = w.veld_id
    JOIN operator o ON o.id = r.operator_id
    JOIN pc p ON p.id = r.pc_id
    LEFT JOIN batch b ON b.id = r.batch_id
    LEFT JOIN lot lb ON lb.id = b.lot_id
    LEFT JOIN lot l ON l.id = r.lot_id`;

const PERIODE_SQL = (kolom: string, a: number, b: number) =>
  `($${a}::date IS NULL OR ${kolom} >= $${a}::date) AND ($${b}::date IS NULL OR ${kolom} < $${b}::date)`;

const routes: FastifyPluginAsyncTypebox = async (app) => {
  // ---------- Overzicht ----------
  app.get(
    "/samenvatting",
    {
      preHandler: vereist(...IEDEREEN),
      schema: {
        tags: ["analyse"],
        description: "Kerncijfers over een periode, plus afwijkingen per week en de velden met de meeste afwijkingen.",
        querystring: Type.Object(Periode),
        response: {
          200: Type.Object({
            batches: Type.Integer(),
            lots: Type.Integer(),
            waarden: Type.Integer(),
            buiten_tolerantie: Type.Integer(),
            buiten_grens: Type.Integer(),
            herbewerkingen: Type.Integer(),
            afgekeurd: Type.Integer(),
            te_beoordelen: Type.Integer(),
            per_week: Type.Array(
              Type.Object({ week: Type.String({ format: "date" }), waarden: Type.Integer(), buiten_tolerantie: Type.Integer(), buiten_grens: Type.Integer() }),
            ),
            top_velden: Type.Array(
              Type.Object({ veld: Type.String(), veldnaam: Type.String(), stap: Type.String(), afwijkend: Type.Integer(), waarden: Type.Integer() }),
            ),
          }),
        },
      },
    },
    async (req) => {
      const p = [req.query.van ?? null, req.query.tot ?? null];
      const [k] = await lees<Record<string, number>>(
        app.db,
        `SELECT
           (SELECT count(*) FROM batch WHERE ${PERIODE_SQL("aangemaakt_op", 1, 2)}) AS batches,
           (SELECT count(*) FROM lot WHERE ${PERIODE_SQL("aangemaakt_op", 1, 2)}) AS lots,
           (SELECT count(*) FROM waarde_actueel WHERE ${PERIODE_SQL("ingevoerd_op", 1, 2)}) AS waarden,
           (SELECT count(*) FROM waarde_actueel WHERE markering = 'buiten_tolerantie' AND ${PERIODE_SQL("ingevoerd_op", 1, 2)}) AS buiten_tolerantie,
           (SELECT count(*) FROM waarde_actueel WHERE markering = 'buiten_grens' AND ${PERIODE_SQL("ingevoerd_op", 1, 2)}) AS buiten_grens,
           (SELECT count(*) FROM stapregistratie WHERE herbewerking_start AND ${PERIODE_SQL("gestart_op", 1, 2)}) AS herbewerkingen,
           (SELECT count(*) FROM batch_besluit WHERE besluit = 'afgekeurd' AND ${PERIODE_SQL("besloten_op", 1, 2)}) AS afgekeurd,
           (SELECT count(*) FROM batch WHERE status = 'in_beoordeling') AS te_beoordelen`,
        p,
      );
      const per_week = await lees(
        app.db,
        `SELECT date_trunc('week', ingevoerd_op)::date AS week, count(*) AS waarden,
                count(*) FILTER (WHERE markering = 'buiten_tolerantie') AS buiten_tolerantie,
                count(*) FILTER (WHERE markering = 'buiten_grens') AS buiten_grens
           FROM waarde_actueel WHERE ${PERIODE_SQL("ingevoerd_op", 1, 2)}
          GROUP BY 1 ORDER BY 1`,
        p,
      );
      const top_velden = await lees(
        app.db,
        `SELECT v.code AS veld, v.naam AS veldnaam, s.code AS stap,
                count(*) FILTER (WHERE w.markering <> 'ok') AS afwijkend, count(*) AS waarden
           FROM waarde_actueel w JOIN veld v ON v.id = w.veld_id JOIN processtap s ON s.id = v.processtap_id
          WHERE ${PERIODE_SQL("w.ingevoerd_op", 1, 2)}
          GROUP BY v.code, v.naam, s.code, v.volgnummer, s.volgorde
         HAVING count(*) FILTER (WHERE w.markering <> 'ok') > 0
          ORDER BY 4 DESC, s.volgorde, v.volgnummer LIMIT 8`,
        p,
      );
      return { ...k, per_week, top_velden } as never;
    },
  );

  // ---------- Te beoordelen ----------
  app.get(
    "/te-beoordelen",
    {
      preHandler: vereist(...IEDEREEN),
      schema: {
        tags: ["analyse"],
        description: "Batches die in beoordeling staan en wachten op het keurresultaat van Kwaliteit.",
        response: {
          200: Type.Array(
            Type.Object({
              batchnummer: Type.String(),
              sinds: Tijd,
              reden: Type.String(),
              door: Type.String(),
              laatst_afgeronde_stap: OptTekst,
              afwijkingen: Type.Integer(),
            }),
          ),
        },
      },
    },
    async () =>
      lees(
        app.db,
        `SELECT b.batchnummer, d.besloten_op AS sinds, d.reden, g.gebruikersnaam AS door,
                (SELECT s.code FROM stapregistratie r JOIN processtap s ON s.id = r.processtap_id
                  WHERE r.batch_id = b.id AND r.status = 'afgerond' ORDER BY s.volgorde DESC LIMIT 1) AS laatst_afgeronde_stap,
                (SELECT count(*) FROM waarde_actueel w JOIN stapregistratie r ON r.id = w.stapregistratie_id
                  WHERE r.batch_id = b.id AND w.markering <> 'ok') AS afwijkingen
           FROM batch b
           JOIN LATERAL (SELECT * FROM batch_besluit x WHERE x.batch_id = b.id ORDER BY x.besloten_op DESC LIMIT 1) d ON true
           JOIN gebruiker g ON g.id = d.besloten_door
          WHERE b.status = 'in_beoordeling'
          ORDER BY d.besloten_op`,
      ) as never,
  );

  // ---------- Afwijkingen ----------
  app.get(
    "/afwijkingen",
    {
      preHandler: vereist(...IEDEREEN),
      schema: {
        tags: ["analyse"],
        description: "Actuele waarden buiten tolerantie of grens, nieuwste eerst.",
        querystring: Type.Object({
          ...Periode,
          stapcode: Type.Optional(StapCode),
          veld: Type.Optional(Type.String({ examples: ["S5.1"] })),
          markering: Type.Optional(Type.Union([Type.Literal("buiten_tolerantie"), Type.Literal("buiten_grens")])),
          limiet: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000, default: 500 })),
        }),
        response: {
          200: Type.Array(
            Type.Object({
              batch_of_lot: Type.String(),
              lotnummer: OptTekst,
              stap: Type.String(),
              poging: Type.Integer(),
              veld: Type.String(),
              veldnaam: Type.String(),
              eenheid: OptTekst,
              setting: OptGetal,
              gemeten: Type.Number(),
              grens_min: OptGetal,
              grens_max: OptGetal,
              tolerantie: OptGetal,
              tolerantie_soort: OptTekst,
              markering: Markering,
              operator: Type.String(),
              pc: Type.String(),
              gecorrigeerd: Type.Boolean(),
              ingevoerd_op: Tijd,
            }),
          ),
        },
      },
    },
    async (req) => {
      const q = req.query;
      return lees(
        app.db,
        `SELECT * FROM (${WAARDEN_SQL}) x
          WHERE markering <> 'ok' AND ${PERIODE_SQL("ingevoerd_op", 1, 2)}
            AND ($3::text IS NULL OR stap = $3) AND ($4::text IS NULL OR veld = $4) AND ($5::text IS NULL OR markering = $5)
          ORDER BY ingevoerd_op DESC LIMIT $6`,
        [q.van ?? null, q.tot ?? null, q.stapcode ?? null, q.veld ?? null, q.markering ?? null, q.limiet ?? 500],
      ) as never;
    },
  );

  // ---------- Trend per veld ----------
  app.get(
    "/trend",
    {
      preHandler: vereist(...IEDEREEN),
      schema: {
        tags: ["analyse"],
        description: "Alle actuele waarden van één veld door de tijd, met de huidige grenzen van het veld.",
        querystring: Type.Object({ ...Periode, veld: Type.String({ examples: ["S5.1"] }) }),
        response: {
          200: Type.Object({
            veld: Type.Object({
              code: Type.String(),
              naam: Type.String(),
              stap: Type.String(),
              soort: Type.String(),
              eenheid: OptTekst,
              grens_min: OptGetal,
              grens_max: OptGetal,
              tolerantie: OptGetal,
              tolerantie_soort: Type.String(),
            }),
            punten: Type.Array(
              Type.Object({
                tijd: Tijd,
                setting: OptGetal,
                gemeten: Type.Number(),
                markering: Markering,
                batch_of_lot: Type.String(),
                operator: Type.String(),
              }),
            ),
          }),
        },
      },
    },
    async (req) => {
      const [veld] = await lees(
        app.db,
        `SELECT v.code, v.naam, s.code AS stap, v.soort, v.eenheid, v.grens_min, v.grens_max, v.tolerantie, v.tolerantie_soort
           FROM veld v JOIN processtap s ON s.id = v.processtap_id WHERE v.code = $1`,
        [req.query.veld],
      );
      if (!veld) throw niet("Veld");
      const punten = await lees(
        app.db,
        `SELECT ingevoerd_op AS tijd, setting, gemeten, markering, batch_of_lot, operator
           FROM (${WAARDEN_SQL}) x WHERE veld = $3 AND ${PERIODE_SQL("ingevoerd_op", 1, 2)}
          ORDER BY ingevoerd_op LIMIT 5000`,
        [req.query.van ?? null, req.query.tot ?? null, req.query.veld],
      );
      return { veld, punten } as never;
    },
  );

  // ---------- Herbewerkingen ----------
  app.get(
    "/herbewerkingen",
    {
      preHandler: vereist(...IEDEREEN),
      schema: {
        tags: ["analyse"],
        querystring: Type.Object(Periode),
        response: {
          200: Type.Array(
            Type.Object({ lotnummer: Type.String(), stap: Type.String(), poging: Type.Integer(), reden: Type.String(), gestart_op: Tijd }),
          ),
        },
      },
    },
    async (req) =>
      lees(
        app.db,
        `SELECT l.lotnummer, s.code AS stap, r.poging, r.reden, r.gestart_op
           FROM stapregistratie r JOIN lot l ON l.id = r.lot_id JOIN processtap s ON s.id = r.processtap_id
          WHERE r.herbewerking_start AND ${PERIODE_SQL("r.gestart_op", 1, 2)}
          ORDER BY r.gestart_op DESC`,
        [req.query.van ?? null, req.query.tot ?? null],
      ) as never,
  );

  // ---------- Afkeur ----------
  app.get(
    "/afkeur",
    {
      preHandler: vereist(...IEDEREEN),
      schema: {
        tags: ["analyse"],
        description: "Afgekeurde batches (keurresultaat NOK) met reden en verloop.",
        querystring: Type.Object(Periode),
        response: {
          200: Type.Array(
            Type.Object({
              batchnummer: Type.String(),
              reden: Type.String(),
              door: Type.String(),
              afgekeurd_op: Tijd,
              in_beoordeling_reden: OptTekst,
              in_beoordeling_op: Type.Union([Type.Null(), Tijd]),
              laatst_afgeronde_stap: OptTekst,
            }),
          ),
        },
      },
    },
    async (req) =>
      lees(
        app.db,
        `SELECT b.batchnummer, d.reden, g.gebruikersnaam AS door, d.besloten_op AS afgekeurd_op,
                ib.reden AS in_beoordeling_reden, ib.besloten_op AS in_beoordeling_op,
                (SELECT s.code FROM stapregistratie r JOIN processtap s ON s.id = r.processtap_id
                  WHERE r.batch_id = b.id AND r.status = 'afgerond' ORDER BY s.volgorde DESC LIMIT 1) AS laatst_afgeronde_stap
           FROM batch_besluit d
           JOIN batch b ON b.id = d.batch_id
           JOIN gebruiker g ON g.id = d.besloten_door
           LEFT JOIN LATERAL (SELECT * FROM batch_besluit x WHERE x.batch_id = b.id AND x.besluit = 'in_beoordeling'
                               AND x.besloten_op <= d.besloten_op ORDER BY x.besloten_op DESC LIMIT 1) ib ON true
          WHERE d.besluit = 'afgekeurd' AND ${PERIODE_SQL("d.besloten_op", 1, 2)}
          ORDER BY d.besloten_op DESC`,
        [req.query.van ?? null, req.query.tot ?? null],
      ) as never,
  );

  // ---------- Productie: doorlooptijden ----------
  app.get(
    "/doorlooptijden",
    {
      preHandler: vereist(...IEDEREEN),
      schema: {
        tags: ["analyse"],
        description:
          "Per stap de bewerkingstijd (gestart tot afgerond) en de wachttijd ervoor (vorige afgeronde stap tot start), in minuten; plus de doorlooptijd van batches (PS1 tot de laatste batchstap) en lots (lot-stap tot gereed) per week, in uren. Medianen, zodat uitschieters het beeld niet vertekenen.",
        querystring: Type.Object(Periode),
        response: {
          200: Type.Object({
            stappen: Type.Array(
              Type.Object({
                stap: Type.String(),
                stapnaam: Type.String(),
                niveau: Type.String(),
                aantal: Type.Integer(),
                bewerking_mediaan: Type.Number(),
                bewerking_p90: Type.Number(),
                wachten_mediaan: Type.Union([Type.Null(), Type.Number()]),
                wachten_p90: Type.Union([Type.Null(), Type.Number()]),
              }),
            ),
            per_week: Type.Array(
              Type.Object({
                week: Type.String({ format: "date" }),
                batches: Type.Integer(),
                batch_uren_mediaan: Type.Union([Type.Null(), Type.Number()]),
                lots: Type.Integer(),
                lot_uren_mediaan: Type.Union([Type.Null(), Type.Number()]),
              }),
            ),
          }),
        },
      },
    },
    async (req) => {
      const p = [req.query.van ?? null, req.query.tot ?? null];
      const stappen = await lees(
        app.db,
        `WITH alle AS (
           -- Vorige afgeronde registratie van dezelfde batch of hetzelfde lot (stappen lopen na elkaar).
           SELECT r.*, s.code, s.naam, s.niveau, s.volgorde, s.is_lot_stap,
                  lag(r.afgerond_op) OVER (PARTITION BY coalesce(r.batch_id, r.lot_id) ORDER BY r.gestart_op) AS vorige_klaar
             FROM stapregistratie r JOIN processtap s ON s.id = r.processtap_id),
         lot_klaar AS (
           -- Voor de eerste lotstap: wanneer de laatste van de 4 batches klaar was.
           SELECT b.lot_id, max(x.afgerond_op) AS klaar
             FROM stapregistratie x JOIN batch b ON b.id = x.batch_id
            WHERE b.lot_id IS NOT NULL AND x.status = 'afgerond' GROUP BY b.lot_id),
         r AS (
           SELECT a.code, a.naam, a.niveau, a.volgorde,
                  extract(epoch FROM a.afgerond_op - a.gestart_op) / 60 AS bewerking,
                  extract(epoch FROM a.gestart_op - coalesce(a.vorige_klaar, CASE WHEN a.is_lot_stap THEN lk.klaar END)) / 60 AS wachten
             FROM alle a LEFT JOIN lot_klaar lk ON lk.lot_id = a.lot_id
            WHERE a.status = 'afgerond' AND ${PERIODE_SQL("a.afgerond_op", 1, 2)})
         SELECT code AS stap, naam AS stapnaam, niveau, count(*) AS aantal,
                round(percentile_cont(0.5) WITHIN GROUP (ORDER BY bewerking)::numeric, 1) AS bewerking_mediaan,
                round(percentile_cont(0.9) WITHIN GROUP (ORDER BY bewerking)::numeric, 1) AS bewerking_p90,
                round(percentile_cont(0.5) WITHIN GROUP (ORDER BY wachten)::numeric, 1) AS wachten_mediaan,
                round(percentile_cont(0.9) WITHIN GROUP (ORDER BY wachten)::numeric, 1) AS wachten_p90
           FROM r GROUP BY code, naam, niveau, volgorde ORDER BY volgorde`,
        p,
      );
      const per_week = await lees(
        app.db,
        `WITH laatste_batchstap AS (SELECT id FROM processtap WHERE actief AND niveau = 'batch' ORDER BY volgorde DESC LIMIT 1),
              eerste_batchstap AS (SELECT id FROM processtap WHERE actief AND niveau = 'batch' ORDER BY volgorde LIMIT 1),
              laatste_lotstap AS (SELECT id FROM processtap WHERE actief AND niveau = 'lot' ORDER BY volgorde DESC LIMIT 1),
              b AS (
                SELECT date_trunc('week', e.afgerond_op)::date AS week,
                       extract(epoch FROM e.afgerond_op - s.gestart_op) / 3600 AS uren
                  FROM stapregistratie e
                  JOIN stapregistratie s ON s.batch_id = e.batch_id AND s.processtap_id = (SELECT id FROM eerste_batchstap)
                 WHERE e.processtap_id = (SELECT id FROM laatste_batchstap) AND e.status = 'afgerond'
                   AND ${PERIODE_SQL("e.afgerond_op", 1, 2)}),
              l AS (
                SELECT date_trunc('week', g.klaar)::date AS week, extract(epoch FROM g.klaar - lot.aangemaakt_op) / 3600 AS uren
                  FROM lot
                  JOIN LATERAL (SELECT max(r.afgerond_op) AS klaar FROM stapregistratie r
                                 WHERE r.lot_id = lot.id AND r.processtap_id = (SELECT id FROM laatste_lotstap) AND r.status = 'afgerond') g ON g.klaar IS NOT NULL
                 WHERE lot.status = 'gereed' AND ${PERIODE_SQL("g.klaar", 1, 2)}),
              weken AS (SELECT week FROM b UNION SELECT week FROM l)
         SELECT w.week,
                (SELECT count(*) FROM b WHERE b.week = w.week) AS batches,
                (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY uren)::numeric, 1) FROM b WHERE b.week = w.week) AS batch_uren_mediaan,
                (SELECT count(*) FROM l WHERE l.week = w.week) AS lots,
                (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY uren)::numeric, 1) FROM l WHERE l.week = w.week) AS lot_uren_mediaan
           FROM weken w ORDER BY w.week`,
        p,
      );
      return { stappen, per_week } as never;
    },
  );

  // ---------- Productie per week ----------
  app.get(
    "/productie",
    {
      preHandler: vereist(...IEDEREEN),
      schema: {
        tags: ["analyse"],
        description: "Per week: batches gestart, batches klaar met de batchstappen, lots gereed en batches afgekeurd.",
        querystring: Type.Object(Periode),
        response: {
          200: Type.Array(
            Type.Object({
              week: Type.String({ format: "date" }),
              batches_gestart: Type.Integer(),
              batches_klaar: Type.Integer(),
              lots_gereed: Type.Integer(),
              afgekeurd: Type.Integer(),
            }),
          ),
        },
      },
    },
    async (req) =>
      lees(
        app.db,
        `WITH laatste_batchstap AS (SELECT id FROM processtap WHERE actief AND niveau = 'batch' ORDER BY volgorde DESC LIMIT 1),
              laatste_lotstap AS (SELECT id FROM processtap WHERE actief AND niveau = 'lot' ORDER BY volgorde DESC LIMIT 1),
              g AS (
                SELECT 'gestart' AS soort, aangemaakt_op AS t FROM batch
                UNION ALL
                SELECT 'klaar', r.afgerond_op FROM stapregistratie r
                 WHERE r.processtap_id = (SELECT id FROM laatste_batchstap) AND r.status = 'afgerond'
                UNION ALL
                SELECT 'lot', r.afgerond_op FROM stapregistratie r
                 WHERE r.processtap_id = (SELECT id FROM laatste_lotstap) AND r.status = 'afgerond' AND r.poging = 1
                UNION ALL
                SELECT 'afgekeurd', besloten_op FROM batch_besluit WHERE besluit = 'afgekeurd')
         SELECT date_trunc('week', t)::date AS week,
                count(*) FILTER (WHERE soort = 'gestart') AS batches_gestart,
                count(*) FILTER (WHERE soort = 'klaar') AS batches_klaar,
                count(*) FILTER (WHERE soort = 'lot') AS lots_gereed,
                count(*) FILTER (WHERE soort = 'afgekeurd') AS afgekeurd
           FROM g WHERE ${PERIODE_SQL("t", 1, 2)}
          GROUP BY 1 ORDER BY 1`,
        [req.query.van ?? null, req.query.tot ?? null],
      ) as never,
  );

  // ---------- Correcties ----------
  app.get(
    "/correcties",
    {
      preHandler: vereist(...IEDEREEN),
      schema: {
        tags: ["analyse"],
        description: "Alle correcties van waarden: oude en nieuwe waarde, reden en wie corrigeerde. Nieuwste eerst.",
        querystring: Type.Object(Periode),
        response: {
          200: Type.Array(
            Type.Object({
              gecorrigeerd_op: Tijd,
              batch_of_lot: Type.String(),
              stap: Type.String(),
              poging: Type.Integer(),
              veld: Type.String(),
              veldnaam: Type.String(),
              eenheid: OptTekst,
              oud_setting: OptGetal,
              oud_gemeten: Type.Number(),
              oud_markering: Markering,
              nieuw_setting: OptGetal,
              nieuw_gemeten: Type.Number(),
              nieuw_markering: Markering,
              reden: Type.String(),
              door: Type.String(),
              ingevoerd_door: OptTekst,
            }),
          ),
        },
      },
    },
    async (req) =>
      lees(
        app.db,
        `SELECT n.ingevoerd_op AS gecorrigeerd_op, coalesce(b.batchnummer, l.lotnummer) AS batch_of_lot,
                s.code AS stap, r.poging, v.code AS veld, v.naam AS veldnaam, v.eenheid,
                o.setting AS oud_setting, o.gemeten AS oud_gemeten, o.markering AS oud_markering,
                n.setting AS nieuw_setting, n.gemeten AS nieuw_gemeten, n.markering AS nieuw_markering,
                n.correctie_reden AS reden, g.gebruikersnaam AS door, op.naam AS ingevoerd_door
           FROM waarde n
           JOIN waarde o ON o.id = n.vervangt_waarde_id
           JOIN stapregistratie r ON r.id = n.stapregistratie_id
           JOIN processtap s ON s.id = r.processtap_id
           JOIN veld v ON v.id = n.veld_id
           JOIN gebruiker g ON g.id = n.gecorrigeerd_door
           LEFT JOIN operator op ON op.id = o.ingevoerd_door
           LEFT JOIN batch b ON b.id = r.batch_id
           LEFT JOIN lot l ON l.id = r.lot_id
          WHERE ${PERIODE_SQL("n.ingevoerd_op", 1, 2)}
          ORDER BY n.ingevoerd_op DESC`,
        [req.query.van ?? null, req.query.tot ?? null],
      ) as never,
  );
};

export default routes;
