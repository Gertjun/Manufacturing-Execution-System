import { Type } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { personalSession, requireTransactionPermission } from "../modules/authorization/access.js";
import { inTransactie, lees } from "../db.js";
import { ApiFout, niet } from "../fouten.js";
import { registratieDetail } from "./registraties.js";
import { RegistratieDetail } from "./schemas.js";

/** Keuring door Kwaliteit (#64, D58): wat op een meting van Kwaliteit wacht, en het besluit. */
const routes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/",
    {
      preHandler: personalSession,
      schema: {
        tags: ["keuringen"],
        description: "Stappen die op Kwaliteit wachten (status open), oudste eerst; met stap alleen die stap.",
        querystring: Type.Object({ stap: Type.Optional(Type.String()) }),
        response: {
          200: Type.Array(Type.Object({
            id: Type.String({ format: "uuid" }),
            registratie_id: Type.String({ format: "uuid" }),
            soort: Type.Union([Type.Literal("batch"), Type.Literal("lot")]),
            nummer: Type.String(),
            product: Type.Union([Type.Null(), Type.String()]),
            stap: Type.String(),
            stapnaam: Type.String(),
            sinds: Type.String({ format: "date-time" }),
            te_meten: Type.Integer({ description: "Verplichte velden van Kwaliteit die nog niet zijn ingevuld" }),
            afwijkingen: Type.Integer({ description: "Afwijkende metingen in deze stap" }),
          })),
        },
      },
    },
    async (req) =>
      lees(
        app.db,
        `SELECT k.id, r.id AS registratie_id, CASE WHEN r.batch_id IS NOT NULL THEN 'batch' ELSE 'lot' END AS soort,
                coalesce(b.batchnummer, l.lotnummer) AS nummer, p.code AS product, s.code AS stap, s.naam AS stapnaam,
                coalesce(r.afgerond_op, k.aangemaakt_op) AS sinds,
                (SELECT count(*) FROM veld v WHERE v.processtap_id = s.id AND v.actief AND v.verplicht AND v.gemeten_door = 'kwaliteit'
                    AND NOT EXISTS (SELECT 1 FROM waarde w WHERE w.stapregistratie_id = r.id AND w.veld_id = v.id))::int AS te_meten,
                (SELECT count(*) FROM waarde_actueel w WHERE w.stapregistratie_id = r.id AND w.markering <> 'ok')::int AS afwijkingen
           FROM keuring k JOIN stapregistratie r ON r.id = k.stapregistratie_id JOIN processtap s ON s.id = r.processtap_id
           LEFT JOIN batch b ON b.id = r.batch_id LEFT JOIN lot l ON l.id = r.lot_id LEFT JOIN product p ON p.id = r.product_id
          WHERE k.status = 'open' AND ($1::text IS NULL OR s.code = $1)
            AND authorization_read_execution($2,r.product_id)
          ORDER BY sinds`,
        [req.query.stap ?? null,req.user.sub],
      ) as never,
  );


  // Wat Kwaliteit vandaag en morgen kan verwachten (#88, D78): per batch en lot de volgende keuringsstap (TK, EK)
  // of processtap met een meting van Kwaliteit, met een schatting wanneer hij daar is. De schatting telt vanaf de
  // stap waar de batch of het lot nu is de mediaan van wachten en bewerken per stap (laatste 90 dagen) op.
  app.get(
    "/verwacht",
    {
      preHandler: personalSession,
      schema: {
        tags: ["keuringen"],
        description:
          "Komende keuringen en metingen van Kwaliteit: klaar = de batch of het lot staat klaar voor de keuringsstap; " +
          "verwacht_op = schatting uit de mediaan van wachten en bewerken per stap (laatste 90 dagen; zonder historie 30 en 60 minuten). " +
          "Alleen binnen 'uren' (standaard 48). Batches en lots die op Kwaliteit wachten, in beoordeling staan of een open herbewerking hebben, staan er niet in.",
        querystring: Type.Object({ uren: Type.Optional(Type.Integer({ minimum: 1, maximum: 168, default: 48 })) }),
        response: {
          200: Type.Array(Type.Object({
            stap: Type.String(),
            stapnaam: Type.String(),
            soort: Type.Union([Type.Literal("keuring"), Type.Literal("meting")], { description: "keuring = keuringsstap (TK, EK); meting = processtap waarin Kwaliteit meet" }),
            niveau: Type.Union([Type.Literal("batch"), Type.Literal("lot")]),
            nummer: Type.String(),
            product: Type.Union([Type.Null(), Type.String()]),
            nu_in: Type.Union([Type.Null(), Type.String()], { description: "Stap waar de batch of het lot nu is (leeg: nog niet begonnen)" }),
            nu_bezig: Type.Boolean({ description: "Die stap loopt nog" }),
            stappen_ertussen: Type.Integer({ description: "Stappen tussen nu en de keuring" }),
            klaar: Type.Boolean({ description: "Staat nu klaar voor deze keuring" }),
            verwacht_op: Type.String({ format: "date-time" }),
            gepland: Type.Union([Type.Null(), Type.String({ format: "date" })], { description: "Dag waarop de keuring in Stappen plannen staat" }),
          })),
        },
      },
    },
    async (req) =>
      (await lees(
        app.db,
        `WITH duur AS (
           SELECT processtap_id, percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM afgerond_op - gestart_op) / 60) AS bewerking
             FROM stapregistratie WHERE status = 'afgerond' AND afgerond_op > now() - interval '90 days' GROUP BY 1),
         wacht AS (
           SELECT processtap_id, percentile_cont(0.5) WITHIN GROUP (ORDER BY greatest(0, extract(epoch FROM gestart_op - vorige) / 60)) AS wachten
             FROM (SELECT processtap_id, gestart_op,
                          lag(afgerond_op) OVER (PARTITION BY coalesce(batch_id, lot_id) ORDER BY gestart_op) AS vorige
                     FROM stapregistratie WHERE gestart_op > now() - interval '90 days') x
            WHERE vorige IS NOT NULL GROUP BY 1),
         stap AS (
           SELECT s.id, s.code, s.naam, s.niveau, s.soort,
                  coalesce(d.bewerking, CASE WHEN s.soort = 'keuring' THEN 0 ELSE 60 END) AS bewerking,
                  coalesce(w.wachten, 30) AS wachten,
                  (s.soort = 'keuring' OR EXISTS (SELECT 1 FROM veld v WHERE v.processtap_id = s.id AND v.actief AND v.gemeten_door = 'kwaliteit')) AS kwaliteit
             FROM processtap s LEFT JOIN duur d ON d.processtap_id = s.id LEFT JOIN wacht w ON w.processtap_id = s.id),
         item AS (
           SELECT 'batch'::text AS niveau, b.id, b.batchnummer AS nummer, b.product_id,
                  CASE WHEN b.status = 'gepland' THEN greatest(now(), b.geplande_dag::timestamptz) ELSE now() END AS begin
             FROM batch b
            WHERE (b.status = 'in_productie' OR (b.status = 'gepland' AND b.geplande_dag <= current_date + 2))
              AND NOT EXISTS (SELECT 1 FROM herbewerking h WHERE h.batch_id = b.id AND h.status = 'open')
              AND NOT EXISTS (SELECT 1 FROM keuring k JOIN stapregistratie r ON r.id = k.stapregistratie_id WHERE r.batch_id = b.id AND k.status = 'open')
           UNION ALL
           SELECT 'lot', l.id, l.lotnummer, lot_product(l.id), now()
             FROM lot l
            WHERE l.status = 'in_productie'
              AND NOT EXISTS (SELECT 1 FROM herbewerking h WHERE h.lot_id = l.id AND h.status = 'open')
              AND NOT EXISTS (SELECT 1 FROM keuring k JOIN stapregistratie r ON r.id = k.stapregistratie_id WHERE r.lot_id = l.id AND k.status = 'open')),
         rt AS (
           SELECT i.id AS item, r.plek, st.* FROM item i CROSS JOIN LATERAL route(i.product_id) r JOIN stap st ON st.id = r.processtap_id
            WHERE st.niveau = i.niveau),
         nu AS (
           -- De laatste stap die het item (op zijn eigen niveau) begon, met zijn plek in de route.
           SELECT DISTINCT ON (i.id) i.id AS item, x.plek, x.code, r.status, r.gestart_op, r.afgerond_op, x.bewerking
             FROM item i
             JOIN stapregistratie r ON (i.niveau = 'batch' AND r.batch_id = i.id) OR (i.niveau = 'lot' AND r.lot_id = i.id)
             JOIN rt x ON x.item = i.id AND x.id = r.processtap_id
            ORDER BY i.id, r.gestart_op DESC),
         basis AS (
           SELECT i.*, coalesce(n.plek, 0) AS plek, n.code AS nu_in, coalesce(n.status = 'open', false) AS nu_bezig,
                  CASE WHEN n.status = 'open' THEN greatest(now(), n.gestart_op + make_interval(mins => n.bewerking::int))
                       WHEN n.status IS NOT NULL THEN greatest(now(), n.afgerond_op)
                       ELSE i.begin END AS vanaf
             FROM item i LEFT JOIN nu n ON n.item = i.id),
         doel AS (
           SELECT b.*, t.code AS stap, t.naam AS stapnaam, t.soort, t.id AS stap_id,
                  (SELECT count(*) FROM rt m WHERE m.item = b.id AND m.plek > b.plek AND m.plek < t.plek)::int AS stappen_ertussen,
                  b.vanaf + make_interval(mins => (coalesce((SELECT sum(m.wachten + m.bewerking) FROM rt m
                                                             WHERE m.item = b.id AND m.plek > b.plek AND m.plek < t.plek), 0) + t.wachten)::int) AS verwacht_op
             FROM basis b JOIN rt t ON t.item = b.id AND t.plek > b.plek AND t.kwaliteit)
         SELECT d.stap, d.stapnaam, CASE WHEN d.soort = 'keuring' THEN 'keuring' ELSE 'meting' END AS soort, d.niveau, d.nummer,
                p.code AS product, d.nu_in, d.nu_bezig, d.stappen_ertussen,
                (d.soort = 'keuring' AND d.stappen_ertussen = 0 AND NOT d.nu_bezig AND d.nu_in IS NOT NULL) AS klaar,
                CASE WHEN d.soort = 'keuring' AND d.stappen_ertussen = 0 AND NOT d.nu_bezig AND d.nu_in IS NOT NULL THEN d.vanaf ELSE d.verwacht_op END AS verwacht_op,
                (SELECT min(sp.dag)::text FROM stapplanning sp WHERE sp.processtap_id = d.stap_id
                    AND ((d.niveau = 'batch' AND sp.batch_id = d.id) OR (d.niveau = 'lot' AND sp.lot_id = d.id))) AS gepland
           FROM doel d LEFT JOIN product p ON p.id = d.product_id
          WHERE authorization_read_execution($2,d.product_id)
            AND (d.verwacht_op <= now() + make_interval(hours => $1::int)
             OR (d.soort = 'keuring' AND d.stappen_ertussen = 0 AND NOT d.nu_bezig AND d.nu_in IS NOT NULL))
          ORDER BY 10 DESC, 11, d.nummer`,
        [req.query.uren ?? 48,req.user.sub],
      )) as never,
  );

  app.post(
    "/:id/besluit",
    {
      preHandler: personalSession,
      schema: {
        tags: ["keuringen"],
        description:
          "Kwaliteit beslist: vrijgegeven (alle verplichte metingen van Kwaliteit zijn er), herbewerken (met reden, terug naar stapcode of deze stap) " +
          "of afgekeurd (met reden). Hetzelfde besluit opnieuw versturen (offline wachtrij) geeft gewoon de stand terug.",
        params: Type.Object({ id: Type.String({ format: "uuid" }) }),
        body: Type.Object({
          besluit: Type.Union([Type.Literal("vrijgegeven"), Type.Literal("herbewerken"), Type.Literal("afgekeurd")]),
          reden: Type.Optional(Type.Union([Type.Null(), Type.String({ maxLength: 500 })])),
          stapcode: Type.Optional(Type.String({ description: "Bij herbewerken: terug naar deze stap (standaard de stap van de keuring)" })),
        }),
        response: { 200: RegistratieDetail },
      },
    },
    async (req) => {
      const [k] = await lees<{ stapregistratie_id: string }>(app.db, "SELECT stapregistratie_id FROM keuring WHERE id = $1", [req.params.id]);
      if (!k) throw niet("Keuring");
      try {
        await inTransactie(app.db, req.user.naam, async (tx) => {
          const { rows: [target] } = await tx.query<{product_id: string | null}>("SELECT r.product_id FROM keuring k JOIN stapregistratie r ON r.id=k.stapregistratie_id WHERE k.id=$1", [req.params.id]);
          if (!target) throw niet("Keuring");
          await requireTransactionPermission(tx, req.user.sub, "inspection.decide", { product: target.product_id ?? undefined });
          await tx.query("SELECT beslis_keuring($1, $2, $3, $4, $5)", [req.params.id, req.body.besluit, req.body.reden ?? null, req.user.sub, req.body.stapcode ?? null]);
        });
      } catch (e) {
        // Twee mensen van Kwaliteit op dezelfde keuring (#85): het eerste besluit telt; zeg wie dat nam.
        if (!String((e as Error).message).includes("al beslist")) throw e;
        const [b] = await lees<{ status: string; door: string | null }>(app.db,
          "SELECT k.status, g.gebruikersnaam AS door FROM keuring k LEFT JOIN gebruiker g ON g.id = k.besloten_door WHERE k.id = $1", [req.params.id]);
        const wat = { vrijgegeven: "vrijgegeven", herbewerken: "herbewerken", afgekeurd: "afgekeurd" }[b?.status ?? ""] ?? b?.status;
        throw new ApiFout(409, `Over deze stap is al beslist door ${b?.door ?? "iemand anders"}: ${wat}`);
      }
      return (await registratieDetail(app.db, k.stapregistratie_id)) as never;
    },
  );
};

export default routes;
