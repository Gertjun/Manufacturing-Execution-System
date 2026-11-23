import { Type } from "@fastify/type-provider-typebox";
import { NulGeheel } from "./schemas.js";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { vereist, type Rol } from "../auth.js";
import { lees } from "../db.js";
import { ApiFout } from "../fouten.js";

/** Wie het wandscherm mag zien: het schermaccount en iedereen met een persoonlijk account. */
export const WANDSCHERM: Rol[] = ["scherm", "ploegleider", "kwaliteit", "beheerder", "analist", "planner", "productiemanager"];

const Item = Type.Object({
  nummer: Type.String(),
  sinds: Type.Union([Type.Null(), Type.String({ format: "date-time" })]),
  lang: Type.Boolean({ description: "Wacht of loopt langer dan 90% van de keren in de laatste 30 dagen" }),
  gepland: NulGeheel({ description: "Plek in de dagplanning van deze stap" }),
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
          "Alles voor het wandscherm in één keer: per stap de planning van vandaag, wat bezig is en wat klaarstaat, en de kerncijfers van vandaag. Met hal alleen de stappen van de pc's in die hal; met stappen alleen die stappen (#54).",
        querystring: Type.Object({
          hal: Type.Optional(Type.String({ maxLength: 100 })),
          stappen: Type.Optional(Type.String({ maxLength: 300, description: "Stapcodes met komma's, bijvoorbeeld PS3,PS4", examples: ["PS3,PS4"] })),
        }),
        response: {
          200: Type.Object({
            tijd: Type.String({ format: "date-time" }),
            hal: Type.Union([Type.Null(), Type.String()]),
            keuze: Type.Union([Type.Null(), Type.Array(Type.String())], { description: "De gekozen stappen, of leeg voor alle (#54)" }),
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
                stilstand: Type.Union([Type.Null(), Type.Object({ oorzaak: Type.String(), categorie: Type.String(), sinds: Type.String({ format: "date-time" }), toelichting: Type.Union([Type.Null(), Type.String()]) })]),
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
      // #54: alleen de gekozen stappen (bijvoorbeeld een tv bij PS3 en PS4).
      const keuze = req.query.stappen ? [...new Set(req.query.stappen.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean))] : null;
      if (keuze) {
        const bekend = new Set((await lees<{ code: string }>(app.db, "SELECT code FROM processtap WHERE actief AND code = ANY($1)", [keuze])).map((r) => r.code));
        const onbekend = keuze.filter((x) => !bekend.has(x));
        if (onbekend.length) throw new ApiFout(404, `Onbekende of uitgezette stap: ${onbekend.join(", ")}`);
      }

      // Stappen van de hal: wat de pc's daar bedienen. Een pc zonder keuze bedient alle stappen.
      const stappen = await lees<{ id: string; code: string; naam: string; niveau: string }>(
        app.db,
        `SELECT s.id, s.code, s.naam, s.niveau FROM processtap s
          WHERE s.actief AND ($2::text[] IS NULL OR s.code = ANY($2))
            AND ($1::text IS NULL
             OR EXISTS (SELECT 1 FROM pc WHERE pc.actief AND pc.locatie = $1
                          AND (NOT EXISTS (SELECT 1 FROM pc_stap x WHERE x.pc_id = pc.id)
                               OR EXISTS (SELECT 1 FROM pc_stap x WHERE x.pc_id = pc.id AND x.processtap_id = s.id))))
          ORDER BY s.volgorde`,
        [hal, keuze],
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
                plan_stand(sp.id) AS status  -- zoals Planning per stap, met herbewerkingen (#61)
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
      const stil = await lees<{ stap: string; oorzaak: string; categorie: string; sinds: Date; toelichting: string | null }>(
        app.db,
        `SELECT s.code AS stap, o.naam AS oorzaak, o.categorie, x.begin_op AS sinds, x.toelichting
           FROM stilstand x JOIN processtap s ON s.id = x.processtap_id JOIN stilstand_oorzaak o ON o.id = x.oorzaak_id
          WHERE x.eind_op IS NULL`,
      );
      const [k] = await lees<{ gepland_vandaag: number; gestart_vandaag: number; lots_gereed_vandaag: number; in_beoordeling: number }>(
        app.db,
        `SELECT (SELECT count(*) FROM batch WHERE geplande_dag = current_date AND status <> 'vervallen')::int AS gepland_vandaag,
                (SELECT count(*) FROM batch WHERE gestart_op >= current_date)::int AS gestart_vandaag,
                (SELECT count(*) FROM stapregistratie r
                  WHERE r.lot_id IS NOT NULL AND r.status = 'afgerond' AND r.afgerond_op >= current_date
                    AND r.processtap_id = route_laatste(lot_product(r.lot_id), 'lot'))::int AS lots_gereed_vandaag,
                (SELECT count(*) FROM batch WHERE status = 'in_beoordeling')::int AS in_beoordeling`,
      );

      return {
        tijd: new Date().toISOString(),
        hal,
        keuze,
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
            stilstand: (() => {
              const x = stil.find((y) => y.stap === s.code);
              return x ? { oorzaak: x.oorzaak, categorie: x.categorie, sinds: new Date(x.sinds).toISOString(), toelichting: x.toelichting } : null;
            })(),
          };
        }),
      } as never;
    },
  );

  // ---------- Wandscherm Kwaliteit (#83) ----------
  const Wacht = Type.Object({
    soort: Type.Union([Type.Literal("keuring"), Type.Literal("beoordeling")], { description: "keuring = wacht op een meting of besluit van Kwaliteit na een stap (D58); beoordeling = batch in beoordeling (D7)" }),
    nummer: Type.String(),
    product: Type.Union([Type.Null(), Type.String()]),
    stap: Type.Union([Type.Null(), Type.String()]),
    stapnaam: Type.Union([Type.Null(), Type.String()]),
    sinds: Type.String({ format: "date-time" }),
    lang: Type.Boolean({ description: "Wacht langer dan 90% van de keuringen in de laatste 30 dagen (minstens een kwartier)" }),
    te_meten: Type.Integer({ description: "Verplichte velden van Kwaliteit die nog leeg zijn (0 bij een beoordeling)" }),
    afwijkingen: Type.Integer({ description: "Afwijkende metingen in die stap (0 bij een beoordeling)" }),
    reden: Type.Union([Type.Null(), Type.String()], { description: "Reden van de beoordeling" }),
  });
  app.get(
    "/kwaliteit",
    {
      preHandler: vereist(...WANDSCHERM),
      schema: {
        tags: ["wandscherm"],
        description:
          "Wandscherm voor Kwaliteit (#83): wat op Kwaliteit wacht (keuringen en batches in beoordeling, oudste eerst), " +
          "de afwijkende metingen van vandaag (nieuwste eerst, hoogstens 30) en de kerncijfers van vandaag.",
        response: {
          200: Type.Object({
            tijd: Type.String({ format: "date-time" }),
            kerncijfers: Type.Object({
              wacht: Type.Integer({ description: "Keuringen open plus batches in beoordeling" }),
              vrijgegeven_vandaag: Type.Integer(),
              herbewerken_vandaag: Type.Integer(),
              afgekeurd_vandaag: Type.Integer(),
              metingen_vandaag: Type.Integer(),
              afwijkingen_vandaag: Type.Integer(),
              binnen_grenzen_procent: NulGeheel({ description: "Deel van de metingen van vandaag zonder afwijking; null zonder metingen" }),
            }),
            wacht: Type.Array(Wacht),
            afwijkingen: Type.Array(Type.Object({
              tijd: Type.String({ format: "date-time" }),
              nummer: Type.String(),
              stap: Type.String(),
              veld: Type.String(),
              veldnaam: Type.String(),
              gemeten: Type.Number(),
              eenheid: Type.Union([Type.Null(), Type.String()]),
              markering: Type.Union([Type.Literal("buiten_tolerantie"), Type.Literal("buiten_grens")]),
            })),
          }),
        },
      },
    },
    async (req) => {
      if (req.user.rol === "scherm") {
        const [g] = await lees(app.db, "SELECT 1 FROM gebruiker WHERE id = $1 AND actief", [req.user.sub]);
        if (!g) throw new ApiFout(401, "Dit schermaccount is uitgezet");
      }
      const [norm] = await lees<{ p90: number | null }>(app.db,
        `SELECT percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM k.besloten_op - coalesce(r.afgerond_op, k.aangemaakt_op))) AS p90
           FROM keuring k JOIN stapregistratie r ON r.id = k.stapregistratie_id
          WHERE k.besloten_op > now() - interval '30 days'`);
      const nu = Date.now();
      const lang = (sinds: Date | string) => norm?.p90 != null && (nu - new Date(sinds).getTime()) / 1000 > Math.max(norm.p90, 15 * 60);
      const wacht = await lees<{ sinds: Date }>(app.db,
        `SELECT 'keuring' AS soort, coalesce(b.batchnummer, l.lotnummer) AS nummer, p.code AS product, s.code AS stap, s.naam AS stapnaam,
                coalesce(r.afgerond_op, k.aangemaakt_op) AS sinds,
                (SELECT count(*) FROM veld v WHERE v.processtap_id = s.id AND v.actief AND v.verplicht AND v.gemeten_door = 'kwaliteit'
                    AND NOT EXISTS (SELECT 1 FROM waarde w WHERE w.stapregistratie_id = r.id AND w.veld_id = v.id))::int AS te_meten,
                (SELECT count(*) FROM waarde_actueel w WHERE w.stapregistratie_id = r.id AND w.markering <> 'ok')::int AS afwijkingen,
                NULL::text AS reden
           FROM keuring k JOIN stapregistratie r ON r.id = k.stapregistratie_id JOIN processtap s ON s.id = r.processtap_id
           LEFT JOIN batch b ON b.id = r.batch_id LEFT JOIN lot l ON l.id = r.lot_id LEFT JOIN product p ON p.id = r.product_id
          WHERE k.status = 'open'
         UNION ALL
         SELECT 'beoordeling', b.batchnummer, p.code, NULL, NULL, x.besloten_op, 0, 0, x.reden
           FROM batch b LEFT JOIN product p ON p.id = b.product_id
          CROSS JOIN LATERAL (SELECT bb.besloten_op, bb.reden FROM batch_besluit bb
                               WHERE bb.batch_id = b.id AND bb.besluit = 'in_beoordeling' ORDER BY bb.besloten_op DESC LIMIT 1) x
          WHERE b.status = 'in_beoordeling'
         ORDER BY sinds`);
      const afwijkingen = await lees(app.db,
        `SELECT w.ingevoerd_op AS tijd, coalesce(b.batchnummer, l.lotnummer) AS nummer, s.code AS stap, v.code AS veld, v.naam AS veldnaam,
                w.gemeten::float AS gemeten, v.eenheid, w.markering
           FROM waarde_actueel w JOIN veld v ON v.id = w.veld_id JOIN stapregistratie r ON r.id = w.stapregistratie_id
           JOIN processtap s ON s.id = r.processtap_id LEFT JOIN batch b ON b.id = r.batch_id LEFT JOIN lot l ON l.id = r.lot_id
          WHERE w.ingevoerd_op >= current_date AND w.markering <> 'ok'
          ORDER BY w.ingevoerd_op DESC LIMIT 30`);
      const [k] = await lees<Record<string, number | null>>(app.db,
        `WITH m AS (SELECT markering FROM waarde_actueel WHERE ingevoerd_op >= current_date),
              besluit AS (SELECT status AS b FROM keuring WHERE besloten_op >= current_date
                          UNION ALL SELECT besluit FROM batch_besluit WHERE besloten_op >= current_date AND besluit <> 'in_beoordeling')
         SELECT (SELECT count(*) FROM keuring WHERE status = 'open')::int + (SELECT count(*) FROM batch WHERE status = 'in_beoordeling')::int AS wacht,
                (SELECT count(*) FROM besluit WHERE b = 'vrijgegeven')::int AS vrijgegeven_vandaag,
                (SELECT count(*) FROM besluit WHERE b = 'herbewerken')::int AS herbewerken_vandaag,
                (SELECT count(*) FROM besluit WHERE b = 'afgekeurd')::int AS afgekeurd_vandaag,
                (SELECT count(*) FROM m)::int AS metingen_vandaag,
                (SELECT count(*) FROM m WHERE markering <> 'ok')::int AS afwijkingen_vandaag,
                (SELECT round(100.0 * count(*) FILTER (WHERE markering = 'ok') / nullif(count(*), 0)) FROM m)::int AS binnen_grenzen_procent`);
      return {
        tijd: new Date().toISOString(),
        kerncijfers: k,
        wacht: wacht.map((x) => ({ ...x, sinds: new Date(x.sinds).toISOString(), lang: lang(x.sinds) })),
        afwijkingen: afwijkingen.map((x: any) => ({ ...x, tijd: new Date(x.tijd).toISOString() })),
      } as never;
    },
  );
};

export default routes;
