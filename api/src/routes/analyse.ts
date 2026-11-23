import { Type } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { IEDEREEN, vereist } from "../auth.js";
import { lees } from "../db.js";
import { niet } from "../fouten.js";
import { Markering, StapCode, NulGetal, NulGeheel } from "./schemas.js";
import { Stilstand, STILSTAND_SQL } from "./stilstand.js";
import { cpk, regelkaart, REGELS, MIN_PUNTEN } from "../regelkaart.js";

// Analyses voor de portalen. Elke analyse is een eigen route, zodat een portaal
// kan kiezen welke het toont.

const Periode = {
  van: Type.Optional(Type.String({ format: "date", description: "Vanaf (inclusief), bv. 2026-11-01" })),
  tot: Type.Optional(Type.String({ format: "date", description: "Tot (exclusief)" })),
};
/** Periode plus product (D55): leeg = alle producten. */
const Filter = {
  ...Periode,
  product: Type.Optional(Type.String({ description: "Productcode, bijvoorbeeld PRD-B. Leeg = alle producten (D55)" })),
};
/** Resolutie van de grafieken met tijd (#58). Het veld heet in de antwoorden "week" (zo blijft het gelijk voor wie het al gebruikt); het is het begin van de dag, week of maand. */
const Per = { per: Type.Optional(Type.Union([Type.Literal("dag"), Type.Literal("week"), Type.Literal("maand")], { description: "Groeperen per dag, week (standaard) of maand" })) };
const TRUNC = { dag: "day", week: "week", maand: "month" } as const;
/** Begin van de dag, week (maandag) of maand van een tijdstip; per is door het schema al gecontroleerd. */
const perBegin = (per: keyof typeof TRUNC | undefined, kolom: string) => `date_trunc('${TRUNC[per ?? "week"]}', ${kolom})::date`;
const Tijd = Type.String({ format: "date-time" });
const OptTekst = Type.Union([Type.Null(), Type.String()]);
const OptGetal = NulGetal();

/** Basis: alle actuele waarden met hun context. */
const WAARDEN_SQL = `
  SELECT w.id, coalesce(b.batchnummer, l.lotnummer) AS batch_of_lot,
         coalesce(l.lotnummer, lb.lotnummer) AS lotnummer,
         s.code AS stap, s.volgorde, r.poging, v.code AS veld, v.naam AS veldnaam, v.eenheid, v.decimalen,
         w.setting, w.gemeten, w.grens_min, w.grens_max, w.tolerantie, w.tolerantie_soort,
         w.markering, w.ingevoerd_op, o.naam AS operator, p.naam AS pc,
         (w.vervangt_waarde_id IS NOT NULL) AS gecorrigeerd,
         r.product_id, pr.code AS product
    FROM waarde_actueel w
    JOIN stapregistratie r ON r.id = w.stapregistratie_id
    LEFT JOIN product pr ON pr.id = r.product_id
    JOIN processtap s ON s.id = r.processtap_id
    JOIN veld v ON v.id = w.veld_id
    JOIN operator o ON o.id = r.operator_id
    JOIN pc p ON p.id = r.pc_id
    LEFT JOIN batch b ON b.id = r.batch_id
    LEFT JOIN lot lb ON lb.id = b.lot_id
    LEFT JOIN lot l ON l.id = r.lot_id`;

const PERIODE_SQL = (kolom: string, a: number, b: number) =>
  `($${a}::date IS NULL OR ${kolom} >= $${a}::date) AND ($${b}::date IS NULL OR ${kolom} < $${b}::date)`;
/** Alleen dit product ($n = productcode of NULL voor alle producten). */
const PRODUCT_SQL = (kolom: string, n: number) =>
  `($${n}::text IS NULL OR ${kolom} = (SELECT id FROM product WHERE code = $${n}))`;

const routes: FastifyPluginAsyncTypebox = async (app) => {
  // ---------- Overzicht ----------
  app.get(
    "/samenvatting",
    {
      preHandler: vereist(...IEDEREEN),
      schema: {
        tags: ["analyse"],
        description: "Kerncijfers over een periode, plus afwijkingen per week (of per dag of maand, met per) en de velden met de meeste afwijkingen.",
        querystring: Type.Object({ ...Filter, ...Per }),
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
      const p = [req.query.van ?? null, req.query.tot ?? null, req.query.product ?? null];
      // Waarden met hun registratie, zodat er op product gefilterd kan worden.
      const W = `(SELECT w.* FROM waarde_actueel w JOIN stapregistratie r ON r.id = w.stapregistratie_id WHERE ${PRODUCT_SQL("r.product_id", 3)})`;
      const [k] = await lees<Record<string, number>>(
        app.db,
        `SELECT
           (SELECT count(*) FROM batch WHERE gestart_op IS NOT NULL AND ${PERIODE_SQL("gestart_op", 1, 2)} AND ${PRODUCT_SQL("product_id", 3)}) AS batches,
           (SELECT count(*) FROM lot WHERE ${PERIODE_SQL("aangemaakt_op", 1, 2)} AND ${PRODUCT_SQL("lot_product(lot.id)", 3)}) AS lots,
           (SELECT count(*) FROM ${W} x WHERE ${PERIODE_SQL("ingevoerd_op", 1, 2)}) AS waarden,
           (SELECT count(*) FROM ${W} x WHERE markering = 'buiten_tolerantie' AND ${PERIODE_SQL("ingevoerd_op", 1, 2)}) AS buiten_tolerantie,
           (SELECT count(*) FROM ${W} x WHERE markering = 'buiten_grens' AND ${PERIODE_SQL("ingevoerd_op", 1, 2)}) AS buiten_grens,
           (SELECT count(*) FROM stapregistratie WHERE herbewerking_start AND ${PERIODE_SQL("gestart_op", 1, 2)} AND ${PRODUCT_SQL("product_id", 3)}) AS herbewerkingen,
           (SELECT count(*) FROM batch_besluit d JOIN batch b ON b.id = d.batch_id
             WHERE d.besluit = 'afgekeurd' AND ${PERIODE_SQL("d.besloten_op", 1, 2)} AND ${PRODUCT_SQL("b.product_id", 3)}) AS afgekeurd,
           (SELECT count(*) FROM batch WHERE status = 'in_beoordeling' AND ${PRODUCT_SQL("product_id", 3)}) AS te_beoordelen`,
        p,
      );
      const per_week = await lees(
        app.db,
        `SELECT ${perBegin(req.query.per, "ingevoerd_op")} AS week, count(*) AS waarden,
                count(*) FILTER (WHERE markering = 'buiten_tolerantie') AS buiten_tolerantie,
                count(*) FILTER (WHERE markering = 'buiten_grens') AS buiten_grens
           FROM ${W} x WHERE ${PERIODE_SQL("ingevoerd_op", 1, 2)}
          GROUP BY 1 ORDER BY 1`,
        p,
      );
      const top_velden = await lees(
        app.db,
        `SELECT v.code AS veld, v.naam AS veldnaam, s.code AS stap,
                count(*) FILTER (WHERE w.markering <> 'ok') AS afwijkend, count(*) AS waarden
           FROM ${W} w JOIN veld v ON v.id = w.veld_id JOIN processtap s ON s.id = v.processtap_id
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
          ...Filter,
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
              decimalen: Type.Optional(NulGeheel()),
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
              product: Type.Optional(OptTekst),
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
            AND ${PRODUCT_SQL("product_id", 7)}
          ORDER BY ingevoerd_op DESC LIMIT $6`,
        [q.van ?? null, q.tot ?? null, q.stapcode ?? null, q.veld ?? null, q.markering ?? null, q.limiet ?? 500, q.product ?? null],
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
        description:
          "Alle actuele waarden van één veld door de tijd, met de grenzen die nu gelden: van het gekozen product, anders van het veld. " +
          "grenzen_per_product = er zijn producten met eigen grenzen (D55); zonder gekozen product passen de getoonde grenzen dan niet op elke meting.",
        querystring: Type.Object({ ...Filter, veld: Type.String({ examples: ["S5.1"] }) }),
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
              decimalen: NulGeheel(),
              grenzen_per_product: Type.Optional(Type.Boolean()),
            }),
            punten: Type.Array(
              Type.Object({
                tijd: Tijd,
                setting: OptGetal,
                gemeten: Type.Number(),
                markering: Markering,
                batch_of_lot: Type.String(),
                operator: Type.String(),
                // De grenzen waaraan deze meting is getoetst (sinds 0.56.0, #89): per product en per moment kunnen ze verschillen.
                grens_min: Type.Optional(OptGetal),
                grens_max: Type.Optional(OptGetal),
                tolerantie: Type.Optional(OptGetal),
                tolerantie_soort: Type.Optional(OptTekst),
                product: Type.Optional(OptTekst),
              }),
            ),
          }),
        },
      },
    },
    async (req) => {
      const [veld] = await lees(
        app.db,
        `SELECT v.code, v.naam, s.code AS stap, v.soort, v.eenheid, g.grens_min, g.grens_max, g.tolerantie, g.tolerantie_soort, v.decimalen,
                (EXISTS (SELECT 1 FROM veld_product vp WHERE vp.veld_id = v.id)
                 OR EXISTS (SELECT 1 FROM specificatie_regel sr WHERE sr.veld_id = v.id)) AS grenzen_per_product
           FROM veld v JOIN processtap s ON s.id = v.processtap_id
           CROSS JOIN LATERAL grenzen_van(v.id, (SELECT id FROM product WHERE code = $2)) g
          WHERE v.code = $1`,
        [req.query.veld, req.query.product ?? null],
      );
      if (!veld) throw niet("Veld");
      const punten = await lees(
        app.db,
        `SELECT * FROM (
           SELECT ingevoerd_op AS tijd, setting, gemeten, markering, batch_of_lot, operator,
                  grens_min, grens_max, tolerantie, tolerantie_soort, product
             FROM (${WAARDEN_SQL}) x WHERE veld = $3 AND ${PERIODE_SQL("ingevoerd_op", 1, 2)} AND ${PRODUCT_SQL("product_id", 4)}
            ORDER BY ingevoerd_op DESC LIMIT 5000) n
          ORDER BY tijd`,
        [req.query.van ?? null, req.query.tot ?? null, req.query.veld, req.query.product ?? null],
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
        querystring: Type.Object(Filter),
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
          WHERE r.herbewerking_start AND ${PERIODE_SQL("r.gestart_op", 1, 2)} AND ${PRODUCT_SQL("r.product_id", 3)}
          ORDER BY r.gestart_op DESC`,
        [req.query.van ?? null, req.query.tot ?? null, req.query.product ?? null],
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
        querystring: Type.Object(Filter),
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
          WHERE d.besluit = 'afgekeurd' AND ${PERIODE_SQL("d.besloten_op", 1, 2)} AND ${PRODUCT_SQL("b.product_id", 3)}
          ORDER BY d.besloten_op DESC`,
        [req.query.van ?? null, req.query.tot ?? null, req.query.product ?? null],
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
          "Per stap de bewerkingstijd (gestart tot afgerond) en de wachttijd ervoor (vorige afgeronde stap tot start), in minuten; plus de doorlooptijd van batches (PS1 tot de laatste batchstap) en lots (lot-stap tot gereed) per week (of per dag of maand, met per), in uren. Medianen, zodat uitschieters het beeld niet vertekenen.",
        querystring: Type.Object({ ...Filter, ...Per }),
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
                wachten_mediaan: NulGetal(),
                wachten_p90: NulGetal(),
              }),
            ),
            per_week: Type.Array(
              Type.Object({
                week: Type.String({ format: "date" }),
                batches: Type.Integer(),
                batch_uren_mediaan: NulGetal(),
                lots: Type.Integer(),
                lot_uren_mediaan: NulGetal(),
                wacht_op_lot_uren_mediaan: Type.Optional(NulGetal({ description: "Gemiddeld per lot hoe lang de batches na hun laatste batchstap op het samenstellen wachtten; mediaan over de lots (#99)" })),
                totaal_uren_mediaan: Type.Optional(NulGetal({ description: "Eerste batch gestart tot lot gereed; mediaan over de lots (#99). Niet de som van de andere medianen." })),
              }),
            ),
          }),
        },
      },
    },
    async (req) => {
      const p = [req.query.van ?? null, req.query.tot ?? null, req.query.product ?? null];
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
            WHERE a.status = 'afgerond' AND ${PERIODE_SQL("a.afgerond_op", 1, 2)} AND ${PRODUCT_SQL("a.product_id", 3)})
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
        `WITH grens AS (SELECT * FROM route_grenzen),  -- eerste en laatste stap per product (D55)
              b AS (
                SELECT ${perBegin(req.query.per, "e.afgerond_op")} AS week,
                       extract(epoch FROM e.afgerond_op - s.gestart_op) / 3600 AS uren
                  FROM stapregistratie e
                  JOIN batch bt ON bt.id = e.batch_id
                  JOIN grens g ON g.product_id IS NOT DISTINCT FROM bt.product_id AND e.processtap_id = g.laatste_batchstap
                  JOIN stapregistratie s ON s.batch_id = e.batch_id AND s.processtap_id = g.eerste_batchstap
                 WHERE e.status = 'afgerond'
                   AND ${PERIODE_SQL("e.afgerond_op", 1, 2)} AND ${PRODUCT_SQL("bt.product_id", 3)}),
              l AS (
                SELECT ${perBegin(req.query.per, "g.klaar")} AS week, extract(epoch FROM g.klaar - lot.aangemaakt_op) / 3600 AS uren,
                       -- #99: hoe lang de batches gemiddeld op het lot wachtten (klaar met hun laatste batchstap tot samenstellen),
                       -- en de hele doorlooptijd: eerste batch gestart tot lot gereed.
                       bw.wacht AS wacht_uren, extract(epoch FROM g.klaar - bw.begin) / 3600 AS totaal_uren
                  FROM lot
                  JOIN LATERAL (SELECT max(r.afgerond_op) AS klaar FROM stapregistratie r
                                 WHERE r.lot_id = lot.id AND r.processtap_id = route_laatste(lot_product(lot.id), 'lot')
                                   AND r.status = 'afgerond') g ON g.klaar IS NOT NULL
                  LEFT JOIN LATERAL (
                    SELECT avg(greatest(0, extract(epoch FROM lot.aangemaakt_op - x.klaar) / 3600)) AS wacht, min(x.begin) AS begin
                      FROM (SELECT max(r.afgerond_op) AS klaar, min(r.gestart_op) AS begin
                              FROM batch bb JOIN stapregistratie r ON r.batch_id = bb.id
                             WHERE bb.lot_id = lot.id AND r.status = 'afgerond' GROUP BY bb.id) x) bw ON true
                 WHERE lot.status = 'gereed' AND ${PERIODE_SQL("g.klaar", 1, 2)} AND ${PRODUCT_SQL("lot_product(lot.id)", 3)}),
              weken AS (SELECT week FROM b UNION SELECT week FROM l)
         SELECT w.week,
                (SELECT count(*) FROM b WHERE b.week = w.week) AS batches,
                (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY uren)::numeric, 1) FROM b WHERE b.week = w.week) AS batch_uren_mediaan,
                (SELECT count(*) FROM l WHERE l.week = w.week) AS lots,
                (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY uren)::numeric, 1) FROM l WHERE l.week = w.week) AS lot_uren_mediaan,
                (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY wacht_uren)::numeric, 1) FROM l WHERE l.week = w.week) AS wacht_op_lot_uren_mediaan,
                (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY totaal_uren)::numeric, 1) FROM l WHERE l.week = w.week) AS totaal_uren_mediaan
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
        description: "Per week (of per dag of maand, met per): batches gestart, batches klaar met de batchstappen, lots gereed en batches afgekeurd.",
        querystring: Type.Object({ ...Filter, ...Per }),
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
        `WITH grens AS (SELECT * FROM route_grenzen),  -- laatste stap per product (D55)
              lotgrens AS (SELECT l.id AS lot_id, gr.laatste_lotstap FROM lot l JOIN grens gr ON gr.product_id IS NOT DISTINCT FROM lot_product(l.id)),
              g AS (
                SELECT 'gestart' AS soort, gestart_op AS t FROM batch WHERE gestart_op IS NOT NULL AND ${PRODUCT_SQL("product_id", 3)}
                UNION ALL
                SELECT 'klaar', r.afgerond_op FROM stapregistratie r
                  JOIN batch bt ON bt.id = r.batch_id
                  JOIN grens gr ON gr.product_id IS NOT DISTINCT FROM bt.product_id AND r.processtap_id = gr.laatste_batchstap
                 WHERE r.status = 'afgerond' AND ${PRODUCT_SQL("bt.product_id", 3)}
                UNION ALL
                SELECT 'lot', r.afgerond_op FROM stapregistratie r
                  JOIN lotgrens lg ON lg.lot_id = r.lot_id AND r.processtap_id = lg.laatste_lotstap
                 WHERE r.status = 'afgerond' AND r.poging = 1 AND ${PRODUCT_SQL("r.product_id", 3)}
                UNION ALL
                SELECT 'afgekeurd', d.besloten_op FROM batch_besluit d JOIN batch bd ON bd.id = d.batch_id
                 WHERE d.besluit = 'afgekeurd' AND ${PRODUCT_SQL("bd.product_id", 3)})
         SELECT ${perBegin(req.query.per, "t")} AS week,
                count(*) FILTER (WHERE soort = 'gestart') AS batches_gestart,
                count(*) FILTER (WHERE soort = 'klaar') AS batches_klaar,
                count(*) FILTER (WHERE soort = 'lot') AS lots_gereed,
                count(*) FILTER (WHERE soort = 'afgekeurd') AS afgekeurd
           FROM g WHERE ${PERIODE_SQL("t", 1, 2)}
          GROUP BY 1 ORDER BY 1`,
        [req.query.van ?? null, req.query.tot ?? null, req.query.product ?? null],
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
        querystring: Type.Object(Filter),
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
          WHERE ${PERIODE_SQL("n.ingevoerd_op", 1, 2)} AND ${PRODUCT_SQL("r.product_id", 3)}
          ORDER BY n.ingevoerd_op DESC`,
        [req.query.van ?? null, req.query.tot ?? null, req.query.product ?? null],
      ) as never,
  );

  // ---------- Grondstoffen: terugzoeken ----------
  const GrondstofRegel = Type.Object({
    grondstof: Type.String(),
    grondstofnaam: Type.String(),
    partij: Type.String(),
    hoeveelheid: NulGetal(),
    eenheid: Type.Union([Type.Null(), Type.String()]),
    batchnummer: Type.Union([Type.Null(), Type.String()]),
    batchstatus: Type.Union([Type.Null(), Type.String()]),
    lotnummer: Type.Union([Type.Null(), Type.String()]),
    lotstatus: Type.Union([Type.Null(), Type.String()]),
    stap: Type.String(),
    ingevoerd_op: Type.String({ format: "date-time" }),
    gecorrigeerd: Type.Boolean(),
  });
  app.get(
    "/grondstoffen",
    {
      preHandler: vereist(...IEDEREEN),
      schema: {
        tags: ["analyse"],
        description: "Terugzoeken: op partijnummer (deel van het nummer mag) welke batches en lots die partij bevatten; of met lotnummer of batchnummer welke grondstofpartijen erin zitten.",
        querystring: Type.Object({
          partij: Type.Optional(Type.String({ minLength: 2, maxLength: 60 })),
          lotnummer: Type.Optional(Type.String()),
          batchnummer: Type.Optional(Type.String()),
        }),
        response: { 200: Type.Array(GrondstofRegel) },
      },
    },
    async (req) => {
      const { partij, lotnummer, batchnummer } = req.query;
      if (!partij && !lotnummer && !batchnummer) return [] as never;
      return (await lees(
        app.db,
        `SELECT g.code AS grondstof, g.naam AS grondstofnaam, u.partij, u.hoeveelheid, g.eenheid,
                b.batchnummer, b.status AS batchstatus, coalesce(l.lotnummer, bl.lotnummer) AS lotnummer,
                coalesce(l.status, bl.status) AS lotstatus, s.code AS stap, u.ingevoerd_op, u.vervangt_id IS NOT NULL AS gecorrigeerd
           FROM grondstof_gebruik_actueel u
           JOIN grondstof g ON g.id = u.grondstof_id
           JOIN stapregistratie r ON r.id = u.stapregistratie_id
           JOIN processtap s ON s.id = r.processtap_id
           LEFT JOIN batch b ON b.id = r.batch_id
           LEFT JOIN lot bl ON bl.id = b.lot_id
           LEFT JOIN lot l ON l.id = r.lot_id
          WHERE ($1::text IS NULL OR lower(u.partij) LIKE '%' || lower($1) || '%')
            AND ($2::text IS NULL OR coalesce(l.lotnummer, bl.lotnummer) = $2)
            AND ($3::text IS NULL OR b.batchnummer = $3)
          ORDER BY u.ingevoerd_op DESC
          LIMIT 1000`,
        [partij?.trim() || null, lotnummer || null, batchnummer || null],
      )) as never;
    },
  );

  app.get(
    "/partijen",
    {
      preHandler: vereist(...IEDEREEN),
      schema: {
        tags: ["analyse"],
        description: "Alle grondstofpartijen met het aantal batches en de periode waarin ze zijn gebruikt (nieuwste eerst).",
        response: {
          200: Type.Array(Type.Object({
            grondstof: Type.String(), grondstofnaam: Type.String(), partij: Type.String(), batches: Type.Integer(),
            eerste: Type.String({ format: "date-time" }), laatste: Type.String({ format: "date-time" }),
          })),
        },
      },
    },
    async () =>
      (await lees(
        app.db,
        `SELECT g.code AS grondstof, g.naam AS grondstofnaam, u.partij, count(DISTINCT r.batch_id)::int AS batches,
                min(u.ingevoerd_op) AS eerste, max(u.ingevoerd_op) AS laatste
           FROM grondstof_gebruik_actueel u JOIN grondstof g ON g.id = u.grondstof_id JOIN stapregistratie r ON r.id = u.stapregistratie_id
          GROUP BY g.code, g.naam, u.partij ORDER BY max(u.ingevoerd_op) DESC LIMIT 500`,
      )) as never,
  );

  // ---------- Productie: stilstand en beschikbaarheid ----------
  app.get(
    "/stilstand",
    {
      preHandler: vereist(...IEDEREEN),
      schema: {
        tags: ["analyse"],
        description:
          "Stilstand per stap en per oorzaak in de periode (standaard de laatste 30 dagen), in minuten. Beschikbaarheid per stap = (geplande productietijd - ongeplande stilstand) / geplande productietijd, waarbij de geplande productietijd = de ploeguren min geplande stilstand (omstellen, schoonmaken, onderhoud). Kwaliteit = deel van de gestarte batches dat niet is afgekeurd. Samen het begin van OEE; de prestatie (snelheid) vraagt normtijden per stap en ontbreekt nog.",
        querystring: Type.Object(Periode),
        response: {
          200: Type.Object({
            van: Type.String({ format: "date" }),
            tot: Type.String({ format: "date" }),
            ploeguren_per_dag: Type.Number(),
            kwaliteit: OptGetal,
            per_stap: Type.Array(Type.Object({
              stap: Type.String(), stapnaam: Type.String(), aantal: Type.Integer(),
              storing: Type.Number(), wachten: Type.Number(), gepland: Type.Number(), overig: Type.Number(),
              beschikbaarheid: OptGetal,
            })),
            per_oorzaak: Type.Array(Type.Object({ oorzaak: Type.String(), oorzaaknaam: Type.String(), categorie: Type.String(), aantal: Type.Integer(), minuten: Type.Number() })),
            lijst: Type.Array(Stilstand),
          }),
        },
      },
    },
    async (req) => {
      const [p] = await lees<{ van: string; tot: string; dagen: number; uren: number }>(
        app.db,
        `SELECT coalesce($1::date, current_date - 29)::text AS van, coalesce($2::date, current_date + 1)::text AS tot,
                (coalesce($2::date, current_date + 1) - coalesce($1::date, current_date - 29)) AS dagen,
                coalesce((SELECT sum(extract(epoch FROM CASE WHEN eindigt > begint THEN eindigt - begint ELSE eindigt - begint + interval '24 hours' END)) / 3600
                            FROM ploeg WHERE actief), 24)::float AS uren`,
        [req.query.van ?? null, req.query.tot ?? null],
      );
      const t = [p.van, p.tot];
      // Elke stilstand telt alleen mee voor het deel binnen de periode.
      const BINNEN = `greatest(0, extract(epoch FROM least(coalesce(x.eind_op, now()), $2::date::timestamptz) - greatest(x.begin_op, $1::date::timestamptz)) / 60)`;
      const per_stap = await lees<{ stap: string; storing: number; wachten: number; gepland: number; overig: number }>(
        app.db,
        `SELECT s.code AS stap, s.naam AS stapnaam, count(x.id)::int AS aantal,
                coalesce(sum(${BINNEN}) FILTER (WHERE o.categorie = 'storing'), 0)::float AS storing,
                coalesce(sum(${BINNEN}) FILTER (WHERE o.categorie = 'wachten'), 0)::float AS wachten,
                coalesce(sum(${BINNEN}) FILTER (WHERE o.categorie = 'gepland'), 0)::float AS gepland,
                coalesce(sum(${BINNEN}) FILTER (WHERE o.categorie = 'overig'), 0)::float AS overig
           FROM processtap s
           LEFT JOIN stilstand x ON x.processtap_id = s.id AND x.begin_op < $2::date::timestamptz AND coalesce(x.eind_op, now()) > $1::date::timestamptz
           LEFT JOIN stilstand_oorzaak o ON o.id = x.oorzaak_id
          WHERE s.actief
          GROUP BY s.id ORDER BY s.volgorde`,
        t,
      );
      const plan = p.dagen * p.uren * 60;
      const per_oorzaak = await lees(
        app.db,
        `SELECT o.code AS oorzaak, o.naam AS oorzaaknaam, o.categorie, count(*)::int AS aantal, round(sum(${BINNEN})::numeric, 1)::float AS minuten
           FROM stilstand x JOIN stilstand_oorzaak o ON o.id = x.oorzaak_id
          WHERE x.begin_op < $2::date::timestamptz AND coalesce(x.eind_op, now()) > $1::date::timestamptz
          GROUP BY o.code, o.naam, o.categorie ORDER BY 5 DESC`,
        t,
      );
      const lijst = await lees(
        app.db,
        `${STILSTAND_SQL} WHERE x.begin_op < $2::date::timestamptz AND coalesce(x.eind_op, now()) > $1::date::timestamptz ORDER BY x.begin_op DESC LIMIT 200`,
        t,
      );
      const [k] = await lees<{ gestart: number; afgekeurd: number }>(
        app.db,
        `SELECT (SELECT count(*) FROM batch WHERE gestart_op >= $1::date AND gestart_op < $2::date)::int AS gestart,
                (SELECT count(*) FROM batch WHERE status = 'afgekeurd' AND gestart_op >= $1::date AND gestart_op < $2::date)::int AS afgekeurd`,
        t,
      );
      return {
        van: p.van,
        tot: p.tot,
        ploeguren_per_dag: p.uren,
        kwaliteit: k.gestart ? 1 - k.afgekeurd / k.gestart : null,
        per_stap: per_stap.map((x) => {
          const productietijd = plan - x.gepland;
          const r = (n: number) => Math.round(n * 10) / 10;
          return {
            ...x, storing: r(x.storing), wachten: r(x.wachten), gepland: r(x.gepland), overig: r(x.overig),
            beschikbaarheid: productietijd > 0 ? Math.max(0, (productietijd - x.storing - x.wachten - x.overig) / productietijd) : null,
          };
        }),
        per_oorzaak,
        lijst,
      } as never;
    },
  );

  // ---------- Kwaliteit: regelkaarten ----------
  // Bij een procesparameter tekenen we het verschil tussen gemeten en setting (de setting kan per batch anders zijn);
  // bij andere velden de gemeten waarde zelf.
  const REEKS_SQL = `
    SELECT v.code AS veld, w.gemeten::float AS gemeten, w.setting::float AS setting, w.ingevoerd_op AS tijd,
           coalesce(b.batchnummer, l.lotnummer) AS nummer, w.markering
      FROM waarde_actueel w
      JOIN veld v ON v.id = w.veld_id
      JOIN stapregistratie r ON r.id = w.stapregistratie_id
      LEFT JOIN batch b ON b.id = r.batch_id
      LEFT JOIN lot l ON l.id = r.lot_id
     WHERE v.actief AND r.status = 'afgerond' AND ($1::text IS NULL OR v.code = $1)
       AND ${PERIODE_SQL("w.ingevoerd_op", 2, 3)} AND ${PRODUCT_SQL("r.product_id", 4)}
     ORDER BY v.code, w.ingevoerd_op`;
  type Rij = { veld: string; gemeten: number; setting: number | null; tijd: string; nummer: string; markering: string };
  const reeks = (rijen: Rij[], soort: string) =>
    rijen.map((r) => ({ ...r, waarde: soort === "procesparameter" && r.setting !== null ? r.gemeten - r.setting : r.gemeten }));

  app.get(
    "/regelkaarten",
    {
      preHandler: vereist(...IEDEREEN),
      schema: {
        tags: ["analyse"],
        description:
          "Per veld: aantal metingen, signalen volgens de Western Electric-regels en het procesvermogen (Cpk) in de periode. Velden met signalen eerst. " +
          "Heeft een veld eigen grenzen per product (D55), dan staat er alleen een Cpk als er één product gekozen is.",
        querystring: Type.Object(Filter),
        response: {
          200: Type.Array(Type.Object({
            veld: Type.String(), naam: Type.String(), stap: Type.String(), soort: Type.String(), eenheid: OptTekst,
            n: Type.Integer(), voorlopig: Type.Boolean({ description: "Minder dan 20 metingen: nog geen betrouwbare grenzen, geen Cpk" }),
            signalen: Type.Integer(), laatste_signaal: Type.Union([Type.Null(), Tijd]), cpk: OptGetal,
            grenzen_per_product: Type.Optional(Type.Boolean()),
          })),
        },
      },
    },
    async (req) => {
      const velden = await lees<{ code: string; naam: string; stap: string; soort: string; eenheid: string | null; grens_min: number | null; grens_max: number | null; grenzen_per_product: boolean }>(
        app.db,
        `SELECT v.code, v.naam, s.code AS stap, v.soort, v.eenheid, g.grens_min::float AS grens_min, g.grens_max::float AS grens_max,
                EXISTS (SELECT 1 FROM veld_product vp WHERE vp.veld_id = v.id) AS grenzen_per_product
           FROM veld v JOIN processtap s ON s.id = v.processtap_id
           CROSS JOIN LATERAL grenzen_van(v.id, (SELECT id FROM product WHERE code = $1)) g
          WHERE v.actief ORDER BY s.volgorde, v.volgnummer`,
        [req.query.product ?? null],
      );
      const rijen = await lees<Rij>(app.db, REEKS_SQL, [null, req.query.van ?? null, req.query.tot ?? null, req.query.product ?? null]);
      const perVeld = new Map<string, Rij[]>();
      for (const r of rijen) perVeld.set(r.veld, [...(perVeld.get(r.veld) ?? []), r]);
      const uit = velden.map((v) => {
        const p = reeks(perVeld.get(v.code) ?? [], v.soort);
        const k = regelkaart(p.map((x) => x.waarde));
        const laatste = k.signalen.at(-1);
        // Cpk alleen voor velden waar de gemeten waarde zelf getekend wordt (de specificatie gaat over de gemeten waarde).
        // en pas vanaf MIN_PUNTEN metingen.
        // Met eigen grenzen per product en alle producten door elkaar is er geen eenduidige specificatie: geen Cpk (D55).
        const c = v.soort === "procesparameter" || k.voorlopig || (v.grenzen_per_product && !req.query.product) ? null : cpk(k.gemiddelde, k.sigma, v.grens_min, v.grens_max);
        return { veld: v.code, naam: v.naam, stap: v.stap, soort: v.soort, eenheid: v.eenheid, n: k.n, voorlopig: k.voorlopig, signalen: k.signalen.length,
          laatste_signaal: laatste ? new Date(p[laatste.index].tijd).toISOString() : null, cpk: c, grenzen_per_product: v.grenzen_per_product };
      });
      uit.sort((a, b) => (b.signalen > 0 ? 1 : 0) - (a.signalen > 0 ? 1 : 0) || (b.laatste_signaal ?? "").localeCompare(a.laatste_signaal ?? ""));
      return uit as never;
    },
  );

  app.get(
    "/regelkaart",
    {
      preHandler: vereist(...IEDEREEN),
      schema: {
        tags: ["analyse"],
        description: "Regelkaart van één veld: punten, middenlijn, regelgrenzen (3 sigma), bewegend bereik en signalen.",
        querystring: Type.Object({ ...Filter, veld: Type.String({ examples: ["S5.1"] }) }),
        response: {
          200: Type.Object({
            veld: Type.Object({ code: Type.String(), naam: Type.String(), stap: Type.String(), soort: Type.String(), eenheid: OptTekst, grens_min: OptGetal, grens_max: OptGetal, decimalen: NulGeheel(),
              grenzen_per_product: Type.Optional(Type.Boolean()) }),
            getekend: Type.Union([Type.Literal("gemeten"), Type.Literal("afwijking_van_setting")]),
            punten: Type.Array(Type.Object({ tijd: Tijd, nummer: Type.String(), waarde: Type.Number(), signaal: NulGeheel() })),
            gemiddelde: OptGetal, sigma: OptGetal, bovengrens: OptGetal, ondergrens: OptGetal,
            mr_gemiddeld: OptGetal, mr_bovengrens: OptGetal, cpk: OptGetal,
            voorlopig: Type.Boolean({ description: "Minder dan 20 metingen: nog geen betrouwbare grenzen, geen Cpk" }),
            min_metingen: Type.Integer(),
            regels: Type.Record(Type.String(), Type.String()),
          }),
        },
      },
    },
    async (req) => {
      const [v] = await lees<{ code: string; naam: string; stap: string; soort: string; eenheid: string | null; grens_min: number | null; grens_max: number | null; decimalen: number | null; grenzen_per_product: boolean }>(
        app.db,
        `SELECT v.code, v.naam, s.code AS stap, v.soort, v.eenheid, g.grens_min::float AS grens_min, g.grens_max::float AS grens_max, v.decimalen,
                EXISTS (SELECT 1 FROM veld_product vp WHERE vp.veld_id = v.id) AS grenzen_per_product
           FROM veld v JOIN processtap s ON s.id = v.processtap_id
           CROSS JOIN LATERAL grenzen_van(v.id, (SELECT id FROM product WHERE code = $2)) g
          WHERE v.code = $1`,
        [req.query.veld, req.query.product ?? null],
      );
      if (!v) throw niet("Veld");
      const p = reeks(await lees<Rij>(app.db, REEKS_SQL, [v.code, req.query.van ?? null, req.query.tot ?? null, req.query.product ?? null]), v.soort);
      const k = regelkaart(p.map((x) => x.waarde));
      const sig = new Map(k.signalen.map((s) => [s.index, s.regel]));
      return {
        veld: v,
        getekend: v.soort === "procesparameter" ? "afwijking_van_setting" : "gemeten",
        punten: p.map((x, i) => ({ tijd: new Date(x.tijd).toISOString(), nummer: x.nummer, waarde: x.waarde, signaal: sig.get(i) ?? null })),
        gemiddelde: k.gemiddelde, sigma: k.sigma, bovengrens: k.bovengrens, ondergrens: k.ondergrens,
        mr_gemiddeld: k.mr_gemiddeld, mr_bovengrens: k.mr_bovengrens,
        cpk: v.soort === "procesparameter" || k.voorlopig || (v.grenzen_per_product && !req.query.product) ? null : cpk(k.gemiddelde, k.sigma, v.grens_min, v.grens_max),
        voorlopig: k.voorlopig, min_metingen: MIN_PUNTEN,
        regels: REGELS,
      } as never;
    },
  );
};

export default routes;
