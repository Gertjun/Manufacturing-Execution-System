import { Type } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { vereist, type Rol } from "../auth.js";
import { lees } from "../db.js";
import { ApiFout } from "../fouten.js";

/** Wie het wandscherm mag zien: het schermaccount en iedereen met een persoonlijk account. */
export const WANDSCHERM: Rol[] = ["scherm", "ploegleider", "kwaliteit", "beheerder", "analist", "planner"];

const Item = Type.Object({
  nummer: Type.String(),
  sinds: Type.Union([Type.Null(), Type.String({ format: "date-time" })]),
  lang: Type.Boolean({ description: "Wacht of loopt langer dan 90% van de keren in de laatste 30 dagen" }),
  gepland: Type.Union([Type.Null(), Type.Integer()], { description: "Plek in de dagplanning van deze stap" }),
  opmerking: Type.Union([Type.Null(), Type.String()]),
});

const routes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/",
    {
      preHandler: vereist(...WANDSCHERM),
      schema: {
        tags: ["wandscherm"],
        description:
          "Alles voor het wandscherm in één keer: per stap de planning van vandaag, wat bezig is en wat klaarstaat, en de kerncijfers van vandaag. Met hal alleen de stappen van de pc's in die hal.",
        querystring: Type.Object({ hal: Type.Optional(Type.String({ maxLength: 100 })) }),
        response: {
          200: Type.Object({
            tijd: Type.String({ format: "date-time" }),
            hal: Type.Union([Type.Null(), Type.String()]),
            hallen: Type.Array(Type.String()),
            kerncijfers: Type.Object({
              gepland_vandaag: Type.Integer(),
              gestart_vandaag: Type.Integer(),
              lots_gereed_vandaag: Type.Integer(),
              in_beoordeling: Type.Integer(),
            }),
            stappen: Type.Array(
              Type.Object({
                code: Type.String(),
                naam: Type.String(),
                niveau: Type.String(),
                gepland: Type.Array(
                  Type.Object({ nummer: Type.String(), volgorde: Type.Integer(), status: Type.String(), opmerking: Type.Union([Type.Null(), Type.String()]) }),
                ),
                bezig: Type.Array(Item),
                klaar: Type.Array(Item),
              }),
            ),
          }),
        },
      },
    },
    async (req) => {
      // Een schermaccount heeft een lang geldig token; controleer bij elke vraag of het nog actief is.
      if (req.user.rol === "scherm") {
        const [g] = await lees(app.db, "SELECT 1 FROM gebruiker WHERE id = $1 AND actief", [req.user.sub]);
        if (!g) throw new ApiFout(401, "Dit schermaccount is uitgezet");
      }
      const hal = req.query.hal?.trim() || null;
      const hallen = (await lees<{ locatie: string }>(app.db, "SELECT DISTINCT locatie FROM pc WHERE actief AND locatie IS NOT NULL ORDER BY locatie")).map(
        (r) => r.locatie,
      );
      if (hal && !hallen.includes(hal)) throw new ApiFout(404, `Onbekende hal: ${hal}`);

      // Stappen van de hal: wat de pc's daar bedienen. Een pc zonder keuze bedient alle stappen.
      const stappen = await lees<{ id: string; code: string; naam: string; niveau: string }>(
        app.db,
        `SELECT s.id, s.code, s.naam, s.niveau FROM processtap s
          WHERE s.actief AND ($1::text IS NULL
             OR EXISTS (SELECT 1 FROM pc WHERE pc.actief AND pc.locatie = $1
                          AND (NOT EXISTS (SELECT 1 FROM pc_stap x WHERE x.pc_id = pc.id)
                               OR EXISTS (SELECT 1 FROM pc_stap x WHERE x.pc_id = pc.id AND x.processtap_id = s.id))))
          ORDER BY s.volgorde`,
        [hal],
      );

      // Wat "lang" is per stap: 90% van de wacht- en bewerkingstijden van de laatste 30 dagen.
      const normen = await lees<{ code: string; wachten_p90: number | null; bewerking_p90: number | null }>(
        app.db,
        `WITH r AS (
           SELECT s.code, r.gestart_op, r.afgerond_op,
                  lag(r.afgerond_op) OVER (PARTITION BY coalesce(r.batch_id, r.lot_id) ORDER BY r.gestart_op) AS vorige
             FROM stapregistratie r JOIN processtap s ON s.id = r.processtap_id
            WHERE r.status = 'afgerond' AND r.gestart_op > now() - interval '30 days')
         SELECT code,
                percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM gestart_op - vorige)) FILTER (WHERE vorige IS NOT NULL) AS wachten_p90,
                percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM afgerond_op - gestart_op)) AS bewerking_p90
           FROM r GROUP BY code`,
      );
      const norm = new Map(normen.map((n) => [n.code, n]));
      const nu = Date.now();
      const isLang = (sinds: string | Date | null, p90: number | null | undefined) =>
        sinds !== null && p90 !== null && p90 !== undefined && (nu - new Date(sinds).getTime()) / 1000 > Math.max(p90, 15 * 60);

      const plan = await lees<{ stap: string; nummer: string; volgorde: number; status: string; opmerking: string | null }>(
        app.db,
        `SELECT s.code AS stap, coalesce(b.batchnummer, l.lotnummer, 'Lotvoorstel ' || v.nummer) AS nummer, sp.volgorde, sp.opmerking,
                CASE
                  WHEN sp.voorstel_id IS NOT NULL THEN CASE WHEN v.status IN ('gebruikt','afgeweken') THEN 'gedaan' ELSE 'gepland' END
                  ELSE coalesce((SELECT CASE r.status WHEN 'afgerond' THEN 'gedaan' WHEN 'open' THEN 'bezig' ELSE 'gepland' END
                                   FROM stapregistratie r
                                  WHERE r.processtap_id = sp.processtap_id AND (r.batch_id = sp.batch_id OR r.lot_id = sp.lot_id)
                                    AND r.status <> 'afgebroken'
                                  ORDER BY r.poging DESC LIMIT 1), 'gepland')
                END AS status
           FROM stapplanning sp JOIN processtap s ON s.id = sp.processtap_id
           LEFT JOIN batch b ON b.id = sp.batch_id LEFT JOIN lot l ON l.id = sp.lot_id LEFT JOIN lot_voorstel v ON v.id = sp.voorstel_id
          WHERE sp.dag = current_date ORDER BY s.volgorde, sp.volgorde`,
      );
      const open = await lees<{ stap: string; nummer: string; sinds: string }>(
        app.db,
        `SELECT s.code AS stap, coalesce(b.batchnummer, l.lotnummer) AS nummer, r.gestart_op AS sinds
           FROM stapregistratie r JOIN processtap s ON s.id = r.processtap_id
           LEFT JOIN batch b ON b.id = r.batch_id LEFT JOIN lot l ON l.id = r.lot_id
          WHERE r.status = 'open' ORDER BY r.gestart_op`,
      );
      const klaar = await lees<{ stap: string; nummer: string; sinds: string | null }>(
        app.db,
        `SELECT s.code AS stap, w.nummer, w.sinds FROM processtap s CROSS JOIN LATERAL werkvoorraad(s.code) w WHERE s.actief ORDER BY w.sinds NULLS LAST`,
      );
      const [k] = await lees<{ gepland_vandaag: number; gestart_vandaag: number; lots_gereed_vandaag: number; in_beoordeling: number }>(
        app.db,
        `SELECT (SELECT count(*) FROM batch WHERE geplande_dag = current_date AND status <> 'vervallen')::int AS gepland_vandaag,
                (SELECT count(*) FROM batch WHERE gestart_op >= current_date)::int AS gestart_vandaag,
                (SELECT count(*) FROM stapregistratie r JOIN processtap s ON s.id = r.processtap_id
                  WHERE s.id = (SELECT id FROM processtap WHERE actief AND niveau = 'lot' ORDER BY volgorde DESC LIMIT 1)
                    AND r.status = 'afgerond' AND r.afgerond_op >= current_date)::int AS lots_gereed_vandaag,
                (SELECT count(*) FROM batch WHERE status = 'in_beoordeling')::int AS in_beoordeling`,
      );

      return {
        tijd: new Date().toISOString(),
        hal,
        hallen,
        kerncijfers: k,
        stappen: stappen.map((s) => {
          const p = plan.filter((x) => x.stap === s.code);
          const plek = new Map(p.map((x) => [x.nummer, x]));
          const n = norm.get(s.code);
          const item = (x: { nummer: string; sinds: string | null }, p90: number | null | undefined) => ({
            nummer: x.nummer,
            sinds: x.sinds ? new Date(x.sinds).toISOString() : null,
            lang: isLang(x.sinds, p90),
            gepland: plek.get(x.nummer)?.volgorde ?? null,
            opmerking: plek.get(x.nummer)?.opmerking ?? null,
          });
          const wacht = klaar.filter((x) => x.stap === s.code).map((x) => item(x, n?.wachten_p90));
          // Gepland eerst, in de volgorde van de planner; daarna de rest op wachttijd.
          wacht.sort((a, b) => (a.gepland ?? 1e6) - (b.gepland ?? 1e6));
          return {
            code: s.code,
            naam: s.naam,
            niveau: s.niveau,
            gepland: p.map(({ nummer, volgorde, status, opmerking }) => ({ nummer, volgorde, status, opmerking })),
            bezig: open.filter((x) => x.stap === s.code).map((x) => item(x, n?.bewerking_p90)),
            klaar: wacht,
          };
        }),
      } as never;
    },
  );
};

export default routes;
