import { Type } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { BEHEER, vereist } from "../auth.js";
import { inTransactie, lees } from "../db.js";
import { ApiFout, niet } from "../fouten.js";
import { Veld } from "./config.js";
import { StapCode } from "./schemas.js";

const OptGetal = Type.Optional(Type.Union([Type.Null(), Type.Number()]));

const routes: FastifyPluginAsyncTypebox = async (app) => {
  // Nieuw veld bij een stap. De code (S3.4) wordt uitgegeven en nooit hergebruikt.
  app.post(
    "/velden",
    {
      preHandler: vereist(...BEHEER),
      schema: {
        tags: ["beheer"],
        body: Type.Object({
          stapcode: StapCode,
          naam: Type.String({ minLength: 1 }),
          soort: Type.Union([Type.Literal("procesparameter"), Type.Literal("gewicht"), Type.Literal("overig")]),
          eenheid: Type.Optional(Type.String()),
          grens_min: OptGetal,
          grens_max: OptGetal,
          tolerantie: OptGetal,
          tolerantie_soort: Type.Optional(Type.Union([Type.Literal("absoluut"), Type.Literal("procent")])),
          verplicht: Type.Optional(Type.Boolean()),
        }),
        response: { 201: Veld },
      },
    },
    async (req, reply) => {
      const b = req.body;
      const code = await inTransactie(app.db, req.user.naam, async (tx) => {
        const { rows } = await tx.query("SELECT id, volgorde FROM processtap WHERE code = $1 FOR UPDATE", [b.stapcode]);
        if (!rows[0]) throw niet("Stap");
        const stap = rows[0];
        // Hoogste nummer ooit uitgegeven voor deze stap, ook inactieve velden.
        const { rows: m } = await tx.query(
          `SELECT coalesce(max(split_part(code, '.', 2)::int), 0) + 1 AS nr, coalesce(max(volgnummer), 0) + 1 AS volg
             FROM veld WHERE processtap_id = $1`,
          [stap.id],
        );
        const code = `S${stap.volgorde}.${m[0].nr}`;
        await tx.query(
          `INSERT INTO veld (processtap_id, code, naam, soort, eenheid, grens_min, grens_max, tolerantie, tolerantie_soort, volgnummer, verplicht)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,coalesce($9,'absoluut'),$10,coalesce($11,true))`,
          [stap.id, code, b.naam, b.soort, b.eenheid ?? null, b.grens_min ?? null, b.grens_max ?? null, b.tolerantie ?? null,
            b.tolerantie_soort ?? null, m[0].volg, b.verplicht ?? null],
        );
        return code;
      });
      const [veld] = await lees(app.db, "SELECT * FROM veld WHERE code = $1", [code]);
      return reply.status(201).send(veld as never);
    },
  );

  // Veld aanpassen: naam, grenzen, tolerantie, verplicht, actief. De code verandert nooit.
  app.patch(
    "/velden/:code",
    {
      preHandler: vereist(...BEHEER),
      schema: {
        tags: ["beheer"],
        params: Type.Object({ code: Type.String() }),
        body: Type.Object(
          {
            naam: Type.Optional(Type.String({ minLength: 1 })),
            eenheid: Type.Optional(Type.Union([Type.Null(), Type.String()])),
            grens_min: OptGetal,
            grens_max: OptGetal,
            tolerantie: OptGetal,
            tolerantie_soort: Type.Optional(Type.Union([Type.Literal("absoluut"), Type.Literal("procent")])),
            verplicht: Type.Optional(Type.Boolean()),
            actief: Type.Optional(Type.Boolean()),
          },
          { additionalProperties: false, minProperties: 1 },
        ),
        response: { 200: Veld },
      },
    },
    async (req) => {
      const kolommen = Object.keys(req.body);
      const toegestaan = ["naam", "eenheid", "grens_min", "grens_max", "tolerantie", "tolerantie_soort", "verplicht", "actief"];
      if (kolommen.length === 0) throw new ApiFout(400, "Niets te wijzigen");
      if (kolommen.some((k) => !toegestaan.includes(k))) throw new ApiFout(400, "Onbekend veld in wijziging");
      const waarden = kolommen.map((k) => (req.body as Record<string, unknown>)[k]);
      const set = kolommen.map((k, i) => `${k} = $${i + 2}`).join(", ");
      const n = await inTransactie(app.db, req.user.naam, async (tx) => {
        const r = await tx.query(`UPDATE veld SET ${set} WHERE code = $1`, [req.params.code, ...waarden]);
        return r.rowCount;
      });
      if (!n) throw niet("Veld");
      const [veld] = await lees(app.db, "SELECT * FROM veld WHERE code = $1", [req.params.code]);
      return veld as never;
    },
  );

  app.get(
    "/logboek",
    {
      preHandler: vereist(...BEHEER),
      schema: {
        tags: ["beheer"],
        description: "Alle wijzigingen in de configuratie, nieuwste eerst. Wachtwoorden staan er nooit in; alleen dat ze gewijzigd zijn.",
        querystring: Type.Object({
          tabel: Type.Optional(Type.Union(["processtap", "veld", "gebruiker", "operator", "pc", "pc_stap"].map((t) => Type.Literal(t)))),
          limiet: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, default: 100 })),
        }),
        response: {
          200: Type.Array(
            Type.Object({
              tabel: Type.String(),
              actie: Type.String(),
              oud: Type.Unknown(),
              nieuw: Type.Unknown(),
              extra: Type.Unknown(),
              gewijzigd_door: Type.String(),
              gewijzigd_op: Type.String({ format: "date-time" }),
            }),
          ),
        },
      },
    },
    async (req) =>
      lees(
        app.db,
        `SELECT c.tabel, c.actie, c.oud, c.nieuw, c.gewijzigd_door, c.gewijzigd_op,
                CASE WHEN c.tabel = 'pc_stap' THEN jsonb_build_object(
                       'pc', (SELECT naam FROM pc WHERE id = c.record_id),
                       'stap', (SELECT code FROM processtap WHERE id = (coalesce(c.nieuw, c.oud) ->> 'processtap_id')::uuid))
                     WHEN c.tabel = 'veld' THEN jsonb_build_object(
                       'stap', (SELECT code FROM processtap WHERE id = (coalesce(c.nieuw, c.oud) ->> 'processtap_id')::uuid)) END AS extra
           FROM config_log c
          WHERE $1::text IS NULL OR c.tabel = $1
          ORDER BY c.id DESC LIMIT $2`,
        [req.query.tabel ?? null, req.query.limiet ?? 100],
      ) as never,
  );

  // ---------- Stappen ----------
  // Alleen de naam is aan te passen; volgorde, niveau en de lot-stap liggen vast in het proces.
  app.patch(
    "/stappen/:code",
    {
      preHandler: vereist(...BEHEER),
      schema: {
        tags: ["beheer"],
        params: Type.Object({ code: StapCode }),
        body: Type.Object({ naam: Type.String({ minLength: 1, maxLength: 60 }) }, { additionalProperties: false }),
        response: { 200: Type.Object({ code: Type.String(), naam: Type.String() }) },
      },
    },
    async (req) => {
      const r = await inTransactie(app.db, req.user.naam, (tx) =>
        tx.query("UPDATE processtap SET naam = $2 WHERE code = $1 RETURNING code, naam", [req.params.code, req.body.naam.trim()]));
      if (!r.rows[0]) throw niet("Stap");
      return r.rows[0];
    },
  );

  // ---------- Accounts ----------
  const Rol = Type.Union(["operator", "ploegleider", "kwaliteit", "beheerder", "analist", "planner"].map((r) => Type.Literal(r)));
  const Account = Type.Object({ gebruikersnaam: Type.String(), rol: Type.String(), actief: Type.Boolean() });
  const Wachtwoord = Type.String({ minLength: 8, description: "Minstens 8 tekens" });

  app.get(
    "/gebruikers",
    { preHandler: vereist(...BEHEER), schema: { tags: ["beheer"], response: { 200: Type.Array(Account) } } },
    async () => (await lees(app.db, "SELECT gebruikersnaam, rol, actief FROM gebruiker ORDER BY actief DESC, rol, gebruikersnaam")) as never,
  );

  app.post(
    "/gebruikers",
    {
      preHandler: vereist(...BEHEER),
      schema: {
        tags: ["beheer"],
        body: Type.Object({
          gebruikersnaam: Type.String({ pattern: "^[a-z0-9._-]{3,40}$", description: "Kleine letters, cijfers, punt, streepje; 3 tot 40 tekens" }),
          rol: Rol,
          wachtwoord: Wachtwoord,
        }, { additionalProperties: false }),
        response: { 201: Account },
      },
    },
    async (req, reply) => {
      const r = await inTransactie(app.db, req.user.naam, (tx) =>
        tx.query(
          "INSERT INTO gebruiker (gebruikersnaam, rol, wachtwoord_hash) VALUES ($1, $2, public.crypt($3, public.gen_salt('bf'))) RETURNING gebruikersnaam, rol, actief",
          [req.body.gebruikersnaam, req.body.rol, req.body.wachtwoord]));
      return reply.status(201).send(r.rows[0]);
    },
  );

  app.patch(
    "/gebruikers/:gebruikersnaam",
    {
      preHandler: vereist(...BEHEER),
      schema: {
        tags: ["beheer"],
        params: Type.Object({ gebruikersnaam: Type.String() }),
        body: Type.Object({ rol: Type.Optional(Rol), actief: Type.Optional(Type.Boolean()), wachtwoord: Type.Optional(Wachtwoord) },
          { additionalProperties: false, minProperties: 1 }),
        response: { 200: Account },
      },
    },
    async (req) => {
      const { rol, actief, wachtwoord } = req.body;
      if (req.params.gebruikersnaam === req.user.naam && (actief === false || (rol && rol !== "beheerder"))) {
        throw new ApiFout(422, "Je kunt je eigen beheerdersaccount niet uitzetten of een andere rol geven");
      }
      const r = await inTransactie(app.db, req.user.naam, (tx) =>
        tx.query(
          `UPDATE gebruiker SET rol = coalesce($2, rol), actief = coalesce($3, actief),
                  wachtwoord_hash = CASE WHEN $4::text IS NULL THEN wachtwoord_hash ELSE public.crypt($4, public.gen_salt('bf')) END
            WHERE gebruikersnaam = $1 RETURNING gebruikersnaam, rol, actief`,
          [req.params.gebruikersnaam, rol ?? null, actief ?? null, wachtwoord ?? null]));
      if (!r.rows[0]) throw niet("Account");
      return r.rows[0];
    },
  );

  // ---------- Operators (namenlijst op het invoerscherm) ----------
  const Operator = Type.Object({ id: Type.String({ format: "uuid" }), naam: Type.String(), actief: Type.Boolean() });
  app.get(
    "/operators",
    { preHandler: vereist(...BEHEER), schema: { tags: ["beheer"], response: { 200: Type.Array(Operator) } } },
    async () => (await lees(app.db, "SELECT id, naam, actief FROM operator ORDER BY actief DESC, naam")) as never,
  );
  app.post(
    "/operators",
    {
      preHandler: vereist(...BEHEER),
      schema: { tags: ["beheer"], body: Type.Object({ naam: Type.String({ minLength: 1, maxLength: 60 }) }, { additionalProperties: false }), response: { 201: Operator } },
    },
    async (req, reply) => {
      const r = await inTransactie(app.db, req.user.naam, (tx) =>
        tx.query("INSERT INTO operator (naam) VALUES ($1) RETURNING id, naam, actief", [req.body.naam.trim()]));
      return reply.status(201).send(r.rows[0]);
    },
  );
  app.patch(
    "/operators/:id",
    {
      preHandler: vereist(...BEHEER),
      schema: {
        tags: ["beheer"],
        params: Type.Object({ id: Type.String({ format: "uuid" }) }),
        body: Type.Object({ naam: Type.Optional(Type.String({ minLength: 1, maxLength: 60 })), actief: Type.Optional(Type.Boolean()) },
          { additionalProperties: false, minProperties: 1 }),
        response: { 200: Operator },
      },
    },
    async (req) => {
      const r = await inTransactie(app.db, req.user.naam, (tx) =>
        tx.query("UPDATE operator SET naam = coalesce($2, naam), actief = coalesce($3, actief) WHERE id = $1 RETURNING id, naam, actief",
          [req.params.id, req.body.naam?.trim() ?? null, req.body.actief ?? null]));
      if (!r.rows[0]) throw niet("Operator");
      return r.rows[0];
    },
  );

  // ---------- Pc's en welke stappen ze bedienen ----------
  const Pc = Type.Object({
    naam: Type.String(),
    locatie: Type.Union([Type.Null(), Type.String()]),
    actief: Type.Boolean(),
    stappen: Type.Array(Type.String(), { description: "Leeg = alle stappen" }),
  });
  const PC_SQL = `SELECT p.naam, p.locatie, p.actief,
                         coalesce(array_agg(s.code ORDER BY s.volgorde) FILTER (WHERE s.id IS NOT NULL), '{}') AS stappen
                    FROM pc p LEFT JOIN pc_stap ps ON ps.pc_id = p.id LEFT JOIN processtap s ON s.id = ps.processtap_id`;
  app.get(
    "/pcs",
    { preHandler: vereist(...BEHEER), schema: { tags: ["beheer"], response: { 200: Type.Array(Pc) } } },
    async () => (await lees(app.db, `${PC_SQL} GROUP BY p.id ORDER BY p.naam`)) as never,
  );
  app.post(
    "/pcs",
    {
      preHandler: vereist(...BEHEER),
      schema: {
        tags: ["beheer"],
        body: Type.Object({ naam: Type.String({ pattern: "^[A-Za-z0-9-]{2,20}$", examples: ["PC-21"] }), locatie: Type.Optional(Type.String()) }, { additionalProperties: false }),
        response: { 201: Pc },
      },
    },
    async (req, reply) => {
      await inTransactie(app.db, req.user.naam, (tx) =>
        tx.query("INSERT INTO pc (naam, locatie) VALUES ($1, $2)", [req.body.naam.toUpperCase(), req.body.locatie ?? null]));
      const [pc] = await lees(app.db, `${PC_SQL} WHERE p.naam = $1 GROUP BY p.id`, [req.body.naam.toUpperCase()]);
      return reply.status(201).send(pc as never);
    },
  );
  app.patch(
    "/pcs/:naam",
    {
      preHandler: vereist(...BEHEER),
      schema: {
        tags: ["beheer"],
        params: Type.Object({ naam: Type.String() }),
        body: Type.Object({
          locatie: Type.Optional(Type.Union([Type.Null(), Type.String()])),
          actief: Type.Optional(Type.Boolean()),
          stappen: Type.Optional(Type.Array(StapCode, { description: "Vervangt de koppeling; leeg = alle stappen" })),
        }, { additionalProperties: false, minProperties: 1 }),
        response: { 200: Pc },
      },
    },
    async (req) => {
      await inTransactie(app.db, req.user.naam, async (tx) => {
        const { rows } = await tx.query("SELECT id FROM pc WHERE naam = $1", [req.params.naam]);
        if (!rows[0]) throw niet("Pc");
        const id = rows[0].id;
        if ("locatie" in req.body || req.body.actief !== undefined) {
          await tx.query("UPDATE pc SET locatie = CASE WHEN $2 THEN $3 ELSE locatie END, actief = coalesce($4, actief) WHERE id = $1",
            [id, "locatie" in req.body, req.body.locatie ?? null, req.body.actief ?? null]);
        }
        if (req.body.stappen) {
          const gewenst = new Set(req.body.stappen);
          const { rows: bekend } = await tx.query("SELECT id, code FROM processtap WHERE code = ANY($1)", [[...gewenst]]);
          if (bekend.length !== gewenst.size) throw new ApiFout(422, "Onbekende stap in de lijst");
          const { rows: nu } = await tx.query("SELECT processtap_id FROM pc_stap WHERE pc_id = $1", [id]);
          const nuSet = new Set(nu.map((r) => r.processtap_id as string));
          const wilSet = new Set(bekend.map((r) => r.id as string));
          for (const weg of [...nuSet].filter((x) => !wilSet.has(x))) await tx.query("DELETE FROM pc_stap WHERE pc_id = $1 AND processtap_id = $2", [id, weg]);
          for (const erbij of [...wilSet].filter((x) => !nuSet.has(x))) await tx.query("INSERT INTO pc_stap (pc_id, processtap_id) VALUES ($1, $2)", [id, erbij]);
        }
      });
      const [pc] = await lees(app.db, `${PC_SQL} WHERE p.naam = $1 GROUP BY p.id`, [req.params.naam]);
      return pc as never;
    },
  );
};

export default routes;
