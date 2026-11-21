import { Type } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { BEHEER, IEDEREEN, vereist, type Rol } from "../auth.js";
import { inTransactie, lees, type Db } from "../db.js";
import { ApiFout, niet } from "../fouten.js";
import { LotNummer, NulGetal, NulGeheel } from "./schemas.js";

const UITGEVEN: Rol[] = ["kwaliteit", "beheerder"];
const OptTekst = Type.Union([Type.Null(), Type.String()]);
const OptGetal = NulGetal();

const Inhoud = Type.Object({
  lotnummer: Type.String(),
  status: Type.String(),
  gereed_op: Type.Union([Type.Null(), Type.String({ format: "date-time" })]),
  producten: Type.Array(Type.String()),
  batches: Type.Array(Type.String()),
  bedrijf: Type.Object({ naam: Type.String(), adres: Type.String(), verklaring: Type.String() }),
  kenmerken: Type.Array(Type.Object({
    veld: Type.String(),
    naam: Type.String(),
    stap: Type.String(),
    niveau: Type.String(),
    eenheid: OptTekst,
    decimalen: NulGeheel(),
    spec_min: OptGetal,
    spec_max: OptGetal,
    resultaten: Type.Array(Type.Object({ nummer: Type.String(), waarde: Type.Number() })),
    min: OptGetal,
    max: OptGetal,
    gemiddelde: OptGetal,
    voldoet: Type.Union([Type.Null(), Type.Boolean()], { description: "null = geen meting" }),
  })),
  grondstoffen: Type.Array(Type.Object({ grondstof: Type.String(), naam: Type.String(), partijen: Type.Array(Type.String()) })),
  voldoet: Type.Boolean({ description: "Alle kenmerken gemeten en binnen de specificatie, en geen batch afgekeurd" }),
});
const Uitgegeven = Type.Object({ nummer: Type.Integer(), door: Type.String(), uitgegeven_op: Type.String({ format: "date-time" }) });

/** De inhoud van het certificaat zoals die nu uit de gegevens volgt. */
async function maakInhoud(db: Db, lotnummer: string) {
  const [lot] = await lees<{ id: string; status: string; gereed_op: string | null; batches: string[]; producten: string[]; afgekeurd: boolean }>(
    db,
    `SELECT l.id, l.status,
            (SELECT max(r.afgerond_op) FROM stapregistratie r WHERE r.lot_id = l.id AND r.status = 'afgerond') AS gereed_op,
            coalesce((SELECT array_agg(b.batchnummer ORDER BY b.batchnummer) FROM batch b WHERE b.lot_id = l.id), '{}') AS batches,
            coalesce((SELECT array_agg(DISTINCT p.code || ' ' || p.naam) FROM batch b JOIN product p ON p.id = b.product_id WHERE b.lot_id = l.id), '{}') AS producten,
            EXISTS (SELECT 1 FROM batch b WHERE b.lot_id = l.id AND b.status = 'afgekeurd') AS afgekeurd
       FROM lot l WHERE l.lotnummer = $1`,
    [lotnummer],
  );
  if (!lot) throw niet("Lot");
  const instellingen = new Map((await lees<{ sleutel: string; waarde: string }>(db, "SELECT sleutel, waarde FROM instelling")).map((r) => [r.sleutel, r.waarde]));
  // Per kenmerk: de laatste afgeronde meting per batch (of van het lot), met correcties verwerkt.
  const regels = await lees<{ veld: string; naam: string; stap: string; niveau: string; eenheid: string | null; decimalen: number | null; spec_min: number | null; spec_max: number | null; nummer: string | null; waarde: number | null; markering: string | null }>(
    db,
    // Alleen kenmerken van stappen in de route van het product, met de grenzen van dat product (D55).
    `SELECT v.code AS veld, v.naam, s.code AS stap, s.niveau, v.eenheid, v.decimalen, g.grens_min::float AS spec_min, g.grens_max::float AS spec_max,
            m.nummer, m.gemeten::float AS waarde, m.markering
       FROM veld v JOIN processtap s ON s.id = v.processtap_id
       CROSS JOIN LATERAL grenzen_van(v.id, lot_product($1)) g
       LEFT JOIN LATERAL (
         SELECT DISTINCT ON (coalesce(r.batch_id, r.lot_id)) coalesce(b.batchnummer, l.lotnummer) AS nummer, w.gemeten, w.markering
           FROM stapregistratie r
           JOIN waarde_actueel w ON w.stapregistratie_id = r.id AND w.veld_id = v.id
           LEFT JOIN batch b ON b.id = r.batch_id
           LEFT JOIN lot l ON l.id = r.lot_id
          WHERE r.status = 'afgerond' AND (r.lot_id = $1 OR b.lot_id = $1)
          ORDER BY coalesce(r.batch_id, r.lot_id), r.poging DESC, r.afgerond_op DESC
       ) m ON true
      WHERE v.op_certificaat AND v.actief AND (lot_product($1) IS NULL OR in_route(lot_product($1), s.id))
      ORDER BY s.volgorde, v.volgnummer, m.nummer`,
    [lot.id],
  );
  const kenmerken: Record<string, unknown>[] = [];
  for (const r of regels) {
    let k = kenmerken.find((x) => x.veld === r.veld) as { resultaten: { nummer: string; waarde: number }[]; markeringen: string[] } | undefined;
    if (!k) {
      k = { veld: r.veld, naam: r.naam, stap: r.stap, niveau: r.niveau, eenheid: r.eenheid, decimalen: r.decimalen, spec_min: r.spec_min, spec_max: r.spec_max, resultaten: [], markeringen: [] } as never;
      kenmerken.push(k as never);
    }
    if (r.nummer !== null && r.waarde !== null) {
      k!.resultaten.push({ nummer: r.nummer, waarde: r.waarde });
      k!.markeringen.push(r.markering ?? "ok");
    }
  }
  for (const k of kenmerken as { resultaten: { waarde: number }[]; markeringen?: string[]; min: number | null; max: number | null; gemiddelde: number | null; voldoet: boolean | null }[]) {
    const w = k.resultaten.map((r) => r.waarde);
    k.min = w.length ? Math.min(...w) : null;
    k.max = w.length ? Math.max(...w) : null;
    k.gemiddelde = w.length ? Math.round((w.reduce((a, b) => a + b, 0) / w.length) * 1000) / 1000 : null;
    k.voldoet = w.length ? !k.markeringen!.includes("buiten_grens") : null;
    delete k.markeringen;
  }
  const grondstoffen = await lees(
    db,
    `SELECT g.code AS grondstof, g.naam, array_agg(DISTINCT u.partij ORDER BY u.partij) AS partijen
       FROM grondstof_gebruik_actueel u JOIN grondstof g ON g.id = u.grondstof_id
       JOIN stapregistratie r ON r.id = u.stapregistratie_id LEFT JOIN batch b ON b.id = r.batch_id
      WHERE r.lot_id = $1 OR b.lot_id = $1
      GROUP BY g.code, g.naam ORDER BY g.code`,
    [lot.id],
  );
  const voldoet = !lot.afgekeurd && kenmerken.every((k) => (k as { voldoet: boolean | null }).voldoet === true);
  return {
    lot_id: lot.id,
    inhoud: {
      lotnummer,
      status: lot.status,
      gereed_op: lot.gereed_op,
      producten: lot.producten,
      batches: lot.batches,
      bedrijf: {
        naam: instellingen.get("bedrijfsnaam") ?? "",
        adres: instellingen.get("bedrijfsadres") ?? "",
        verklaring: instellingen.get("certificaat_verklaring") ?? "",
      },
      kenmerken,
      grondstoffen,
      voldoet,
    },
  };
}

const routes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/lots/:lotnummer",
    {
      preHandler: vereist(...IEDEREEN),
      schema: {
        tags: ["certificaat"],
        description: "Het certificaat zoals het nu zou worden uitgegeven (concept), en de certificaten die al zijn uitgegeven.",
        params: Type.Object({ lotnummer: LotNummer }),
        response: { 200: Type.Object({ concept: Inhoud, uitgegeven: Type.Array(Uitgegeven) }) },
      },
    },
    async (req) => {
      const { lot_id, inhoud } = await maakInhoud(app.db, req.params.lotnummer);
      const uitgegeven = await lees(app.db,
        `SELECT c.nummer, g.gebruikersnaam AS door, c.uitgegeven_op FROM certificaat c JOIN gebruiker g ON g.id = c.uitgegeven_door
          WHERE c.lot_id = $1 ORDER BY c.nummer DESC`, [lot_id]);
      return { concept: inhoud, uitgegeven } as never;
    },
  );

  app.post(
    "/lots/:lotnummer",
    {
      preHandler: vereist(...UITGEVEN),
      schema: {
        tags: ["certificaat"],
        description: "Certificaat uitgeven: krijgt een volgnummer en de inhoud wordt bewaard zoals hij nu is.",
        params: Type.Object({ lotnummer: LotNummer }),
        response: { 201: Type.Intersect([Uitgegeven, Type.Object({ inhoud: Inhoud })]) },
      },
    },
    async (req, reply) => {
      const { lot_id, inhoud } = await maakInhoud(app.db, req.params.lotnummer);
      if (!inhoud.voldoet) throw new ApiFout(422, "Dit lot voldoet niet aan de specificatie (of een kenmerk is niet gemeten); een certificaat kan niet");
      const nummer = await inTransactie(app.db, req.user.naam, async (tx) =>
        (await tx.query("INSERT INTO certificaat (lot_id, inhoud, uitgegeven_door) VALUES ($1, $2, $3) RETURNING nummer",
          [lot_id, JSON.stringify(inhoud), req.user.sub])).rows[0].nummer as number);
      const [c] = await lees(app.db,
        `SELECT c.nummer, g.gebruikersnaam AS door, c.uitgegeven_op, c.inhoud FROM certificaat c JOIN gebruiker g ON g.id = c.uitgegeven_door WHERE c.nummer = $1`, [nummer]);
      return reply.status(201).send(c as never);
    },
  );

  app.get(
    "/:nummer",
    {
      preHandler: vereist(...IEDEREEN),
      schema: {
        tags: ["certificaat"],
        description: "Een uitgegeven certificaat, precies zoals het is uitgegeven (voor een herdruk).",
        params: Type.Object({ nummer: Type.Integer() }),
        response: { 200: Type.Intersect([Uitgegeven, Type.Object({ inhoud: Inhoud })]) },
      },
    },
    async (req) => {
      const [c] = await lees(app.db,
        `SELECT c.nummer, g.gebruikersnaam AS door, c.uitgegeven_op, c.inhoud FROM certificaat c JOIN gebruiker g ON g.id = c.uitgegeven_door WHERE c.nummer = $1`,
        [req.params.nummer]);
      if (!c) throw niet("Certificaat");
      return c as never;
    },
  );

  // ---------- Beheer: bedrijfsgegevens ----------
  app.get(
    "/instellingen",
    {
      preHandler: vereist(...BEHEER),
      schema: { tags: ["certificaat", "beheer"], response: { 200: Type.Object({ bedrijfsnaam: Type.String(), bedrijfsadres: Type.String(), certificaat_verklaring: Type.String() }) } },
    },
    async () => {
      const r = new Map((await lees<{ sleutel: string; waarde: string }>(app.db, "SELECT sleutel, waarde FROM instelling")).map((x) => [x.sleutel, x.waarde]));
      return { bedrijfsnaam: r.get("bedrijfsnaam") ?? "", bedrijfsadres: r.get("bedrijfsadres") ?? "", certificaat_verklaring: r.get("certificaat_verklaring") ?? "" };
    },
  );
  app.put(
    "/instellingen",
    {
      preHandler: vereist(...BEHEER),
      schema: {
        tags: ["certificaat", "beheer"],
        body: Type.Object({
          bedrijfsnaam: Type.String({ minLength: 1, maxLength: 120 }),
          bedrijfsadres: Type.String({ maxLength: 300 }),
          certificaat_verklaring: Type.String({ maxLength: 1500 }),
        }, { additionalProperties: false }),
        response: { 204: Type.Null() },
      },
    },
    async (req, reply) => {
      await inTransactie(app.db, req.user.naam, async (tx) => {
        for (const [k, v] of Object.entries(req.body)) {
          await tx.query(
            `INSERT INTO instelling (sleutel, waarde) VALUES ($1, $2)
             ON CONFLICT (sleutel) DO UPDATE SET waarde = EXCLUDED.waarde WHERE instelling.waarde <> EXCLUDED.waarde`,
            [k, (v as string).trim()],
          );
        }
      });
      return reply.status(204).send(null);
    },
  );
};

export default routes;
