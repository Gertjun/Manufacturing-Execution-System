import { Type } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { BEHEER, vereist, type Rol } from "../auth.js";
import { inTransactie, lees } from "../db.js";
import { ApiFout } from "../fouten.js";

/**
 * Pilotoverzicht (#77, D66): hoe de invoer in de pilot loopt, per dag en per pc, per veld, en wat de server
 * weigerde. Voor de beheerder en de productiemanager; alleen de beheerder past de instellingen aan.
 *
 * "Hoe laat binnen" is de tijd tussen het moment op de pc (gestart_op, afgerond_op, ingevoerd_op) en het
 * moment dat de server het ontving. Wat van papier is nageleverd telt daar niet in mee: dat is met opzet later.
 */
const KIJKEN: Rol[] = ["beheerder", "productiemanager"];
const Datum = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" });
const Getal = Type.Number();
const OptGetal = Type.Union([Type.Null(), Type.Number()]);
const OptTekst = Type.Union([Type.Null(), Type.String()]);

const Regel = Type.Object({
  dag: Type.Union([Type.Null(), Datum]),
  pc: Type.String(),
  gestart: Getal,
  afgerond: Getal,
  waarden: Getal,
  gemiddeld_minuten: OptGetal,
  langst_minuten: OptGetal,
  te_laat: Getal,
  nageleverd: Getal,
  geweigerd: Getal,
  opmerkingen: Getal,
});

const Overzicht = Type.Object({
  van: Datum,
  tot: Datum,
  pilot_start: Type.Union([Type.Null(), Datum]),
  te_laat_minuten: Getal,
  kerncijfers: Type.Object({
    afgerond: Getal,
    binnen_tijd: OptGetal,
    nageleverd: Getal,
    geweigerd: Getal,
    opmerkingen: Getal,
  }, { description: "binnen_tijd: deel (0–1) van de invoer dat binnen te_laat_minuten binnenkwam; null zonder invoer" }),
  per_dag_pc: Type.Array(Regel),
  per_pc: Type.Array(Regel, { description: "Per pc over de hele periode (dag is leeg)" }),
  per_dag: Type.Array(Regel, { description: "Per dag over alle pc's" }),
  per_veld: Type.Array(Type.Object({
    veld: Type.String(),
    naam: Type.String(),
    stap: Type.String(),
    verplicht: Type.Boolean(),
    keer: Getal,
    leeg: Getal,
    gecorrigeerd: Getal,
  }), { description: "Velden die leeg bleven of gecorrigeerd zijn, het vaakst eerst" }),
  geweigerd: Type.Array(Type.Object({
    op: Type.String({ format: "date-time" }),
    pc: OptTekst,
    naam: OptTekst,
    stapcode: OptTekst,
    batchnummer: OptTekst,
    fout: OptTekst,
  }), { description: "De laatste 100 geweigerde invoeren in de periode" }),
});

async function instellingen(db: Parameters<typeof lees>[0]) {
  const r = new Map((await lees<{ sleutel: string; waarde: string }>(db,
    "SELECT sleutel, waarde FROM instelling WHERE sleutel IN ('pilot_start', 'te_laat_minuten')")).map((x) => [x.sleutel, x.waarde]));
  return { pilot_start: r.get("pilot_start") || null, te_laat_minuten: Number(r.get("te_laat_minuten") ?? 15) };
}

const routes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/",
    {
      preHandler: vereist(...KIJKEN),
      schema: {
        tags: ["beheer"],
        description: "Pilotoverzicht van van tot en met tot (dagen in de tijdzone van de fabriek). Zonder van: vanaf de start van de pilot, of de laatste 7 dagen.",
        querystring: Type.Object({ van: Type.Optional(Datum), tot: Type.Optional(Datum) }),
        response: { 200: Overzicht },
      },
    },
    async (req) => {
      const inst = await instellingen(app.db);
      const [{ vandaag }] = await lees<{ vandaag: string }>(app.db, "SELECT current_date::text AS vandaag");
      const tot = req.query.tot ?? vandaag;
      const van = req.query.van ?? inst.pilot_start ?? (await lees<{ d: string }>(app.db, "SELECT ($1::date - 6)::text AS d", [tot]))[0].d;
      if (van > tot) throw new ApiFout(400, "De begindatum ligt na de einddatum");
      const p = [van, tot, inst.te_laat_minuten];

      const gebeurtenissen = `
        WITH g AS (
          SELECT r.gestart_op::date AS dag, r.pc_id, 'start' AS soort, r.nageleverd_door IS NOT NULL AS nageleverd,
                 extract(epoch FROM r.gestart_ontvangen_op - r.gestart_op) / 60 AS minuten
            FROM stapregistratie r WHERE r.gestart_op >= $1::date AND r.gestart_op < $2::date + 1
          UNION ALL
          SELECT r.afgerond_op::date, coalesce(r.afgerond_pc_id, r.pc_id), 'afgerond', r.nageleverd_door IS NOT NULL,
                 extract(epoch FROM r.afgerond_ontvangen_op - r.afgerond_op) / 60
            FROM stapregistratie r WHERE r.status = 'afgerond' AND r.afgerond_op >= $1::date AND r.afgerond_op < $2::date + 1
          UNION ALL
          -- Metingen van Kwaliteit horen niet bij de pc van de stap (lab-pc, D58): die tellen hier niet mee.
          SELECT w.ingevoerd_op::date, r.pc_id, 'waarde', r.nageleverd_door IS NOT NULL,
                 extract(epoch FROM w.ontvangen_op - w.ingevoerd_op) / 60
            FROM waarde w JOIN stapregistratie r ON r.id = w.stapregistratie_id JOIN veld v ON v.id = w.veld_id
           WHERE w.vervangt_waarde_id IS NULL AND v.gemeten_door = 'productie'
             AND w.ingevoerd_op >= $1::date AND w.ingevoerd_op < $2::date + 1
        ), t AS (
          -- Een negatieve tijd (klok van de pc net voor) telt als 0; zonder ontvangsttijd (oudere regels) telt hij niet.
          SELECT dag, pc_id, soort, nageleverd, CASE WHEN nageleverd OR minuten IS NULL THEN NULL ELSE greatest(minuten, 0) END AS minuten FROM g
        )`;

      const [kern] = await lees<{ afgerond: number; binnen_tijd: number | null; nageleverd: number; geweigerd: number; opmerkingen: number }>(app.db, `
        ${gebeurtenissen}
        SELECT count(*) FILTER (WHERE soort = 'afgerond')::int AS afgerond,
               (count(*) FILTER (WHERE minuten <= $3)::float / nullif(count(minuten), 0)) AS binnen_tijd,
               count(*) FILTER (WHERE soort = 'afgerond' AND nageleverd)::int AS nageleverd,
               (SELECT count(*) FROM geweigerde_invoer WHERE op >= $1::date AND op < $2::date + 1)::int AS geweigerd,
               (SELECT count(*) FROM terugmelding WHERE gemeld_op >= $1::date AND gemeld_op < $2::date + 1)::int AS opmerkingen
          FROM t`, p);

      // Dezelfde cijfers per dag en pc, per pc (hele periode) en per dag (alle pc's).
      const groep = (sleutel: "dag, pc_id" | "pc_id" | "dag") => {
        const d = sleutel.includes("dag"), c = sleutel.includes("pc_id");
        const kol = (x: string) => [d ? `${x}.dag` : null, c ? `${x}.pc_id` : null].filter(Boolean).join(", ");
        const gelijk = (x: string) => [d ? `${x}.dag = k.dag` : null, c ? `${x}.pc_id IS NOT DISTINCT FROM k.pc_id` : null].filter(Boolean).join(" AND ");
        return lees(app.db, `
        ${gebeurtenissen},
        invoer AS (
          SELECT ${kol("t")}, count(*) FILTER (WHERE soort = 'start') AS gestart, count(*) FILTER (WHERE soort = 'afgerond') AS afgerond,
                 count(*) FILTER (WHERE soort = 'waarde') AS waarden,
                 round(avg(minuten)::numeric, 1)::float AS gemiddeld_minuten, round(max(minuten)::numeric, 1)::float AS langst_minuten,
                 count(*) FILTER (WHERE minuten > $3) AS te_laat, count(*) FILTER (WHERE soort = 'afgerond' AND nageleverd) AS nageleverd
            FROM t GROUP BY ${kol("t")}),
        gw AS (SELECT ${kol("x")}, count(*) AS n FROM (SELECT op::date AS dag, pc_id FROM geweigerde_invoer
                 WHERE op >= $1::date AND op < $2::date + 1) x GROUP BY ${kol("x")}),
        opm AS (SELECT ${kol("x")}, count(*) AS n FROM (SELECT gemeld_op::date AS dag, pc_id FROM terugmelding
                 WHERE gemeld_op >= $1::date AND gemeld_op < $2::date + 1) x GROUP BY ${kol("x")}),
        sleutels AS (SELECT ${kol("invoer")} FROM invoer UNION SELECT ${kol("gw")} FROM gw UNION SELECT ${kol("opm")} FROM opm)
        SELECT ${d ? "k.dag::text" : "NULL::text AS dag"}, ${c ? "coalesce(pc.naam, '(geen pc)')" : "'(alle pc''s)'"} AS pc,
               coalesce(i.gestart, 0)::int AS gestart, coalesce(i.afgerond, 0)::int AS afgerond, coalesce(i.waarden, 0)::int AS waarden,
               i.gemiddeld_minuten, i.langst_minuten, coalesce(i.te_laat, 0)::int AS te_laat, coalesce(i.nageleverd, 0)::int AS nageleverd,
               coalesce(w.n, 0)::int AS geweigerd, coalesce(o.n, 0)::int AS opmerkingen
          FROM sleutels k ${c ? "LEFT JOIN pc ON pc.id = k.pc_id" : ""}
          LEFT JOIN invoer i ON ${gelijk("i")}
          LEFT JOIN gw w ON ${gelijk("w")}
          LEFT JOIN opm o ON ${gelijk("o")}
         ORDER BY ${[d ? "k.dag DESC" : null, c ? "pc.naam NULLS LAST" : null].filter(Boolean).join(", ")}`, p);
      };
      const [per_dag_pc, per_pc, per_dag] = await Promise.all([groep("dag, pc_id"), groep("pc_id"), groep("dag")]);

      // Velden van de operator (niet die van Kwaliteit): hoe vaak leeg bij een afgeronde stap, en hoe vaak gecorrigeerd.
      const per_veld = await lees(app.db, `
        WITH r AS (SELECT id, processtap_id FROM stapregistratie
                    WHERE status = 'afgerond' AND afgerond_op >= $1::date AND afgerond_op < $2::date + 1),
        cijfers AS (
          SELECT v.id, v.code AS veld, v.naam, s.code AS stap, s.volgorde, v.volgnummer, v.verplicht,
                 count(r.id)::int AS keer,
                 count(r.id) FILTER (WHERE NOT EXISTS (SELECT 1 FROM waarde w WHERE w.stapregistratie_id = r.id AND w.veld_id = v.id))::int AS leeg,
                 (SELECT count(*) FROM waarde w WHERE w.veld_id = v.id AND w.vervangt_waarde_id IS NOT NULL
                     AND w.ingevoerd_op >= $1::date AND w.ingevoerd_op < $2::date + 1)::int AS gecorrigeerd
            FROM veld v JOIN processtap s ON s.id = v.processtap_id
            LEFT JOIN r ON r.processtap_id = v.processtap_id
           WHERE v.actief AND v.gemeten_door = 'productie'
           GROUP BY v.id, s.code, s.volgorde)
        SELECT veld, naam, stap, verplicht, keer, leeg, gecorrigeerd FROM cijfers
         WHERE leeg > 0 OR gecorrigeerd > 0
         ORDER BY leeg::float / nullif(keer, 0) DESC NULLS LAST, gecorrigeerd DESC, volgorde, volgnummer`, [van, tot]);

      const geweigerd = await lees(app.db, `
        SELECT x.op, pc.naam AS pc, coalesce(o.naam, g.gebruikersnaam) AS naam, x.stapcode, x.batchnummer, x.fout
          FROM geweigerde_invoer x LEFT JOIN pc ON pc.id = x.pc_id LEFT JOIN operator o ON o.id = x.operator_id
          LEFT JOIN gebruiker g ON g.id = x.gebruiker_id
         WHERE x.op >= $1::date AND x.op < $2::date + 1
         ORDER BY x.op DESC LIMIT 100`, [van, tot]);

      return { van, tot, ...inst, kerncijfers: kern, per_dag_pc, per_pc, per_dag, per_veld, geweigerd } as never;
    },
  );

  app.put(
    "/instellingen",
    {
      preHandler: vereist(...BEHEER),
      schema: {
        tags: ["beheer"],
        description: "Startdatum van de pilot (leeg = geen) en vanaf hoeveel minuten invoer te laat binnenkomt.",
        body: Type.Object({
          pilot_start: Type.Union([Type.Null(), Datum]),
          te_laat_minuten: Type.Integer({ minimum: 1, maximum: 720 }),
        }, { additionalProperties: false }),
        response: { 204: Type.Null() },
      },
    },
    async (req, reply) => {
      await inTransactie(app.db, req.user.naam, async (tx) => {
        // Geen startdatum = lege waarde (verwijderen mag de applicatie niet, D24).
        for (const [sleutel, waarde] of [["pilot_start", req.body.pilot_start ?? ""], ["te_laat_minuten", String(req.body.te_laat_minuten)]]) {
          await tx.query(`INSERT INTO instelling (sleutel, waarde) VALUES ($1, $2)
                          ON CONFLICT (sleutel) DO UPDATE SET waarde = EXCLUDED.waarde WHERE instelling.waarde <> EXCLUDED.waarde`, [sleutel, waarde]);
        }
      });
      return reply.status(204).send(null);
    },
  );
};

export default routes;
