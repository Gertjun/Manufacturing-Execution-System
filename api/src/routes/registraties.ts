import { Type } from "@fastify/type-provider-typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { IEDEREEN, INVOER, LEIDING, invoerContext, invoerTransactie, vereist } from "../auth.js";
import { inTransactie, lees, type Db } from "../db.js";
import { ApiFout, niet } from "../fouten.js";
import { BatchNummer, LotNummer, RegistratieDetail, RegistratieKort, REGISTRATIE_SQL, StapCode, NulGetal } from "./schemas.js";

const Id = Type.Object({ id: Type.String({ format: "uuid" }) });

export async function registratieDetail(db: Db, id: string) {
  const [reg] = await lees(db, `${REGISTRATIE_SQL} WHERE r.id = $1`, [id]);
  if (!reg) throw niet("Registratie");
  const velden = await lees(
    db,
    `SELECT v.code, v.naam, v.soort, v.eenheid, v.decimalen, v.gemeten_door,
            -- Grenzen van de meting als die er is, anders wat nu geldt voor het product (D55).
            CASE WHEN w.id IS NULL THEN g.grens_min ELSE w.grens_min END AS grens_min,
            CASE WHEN w.id IS NULL THEN g.grens_max ELSE w.grens_max END AS grens_max,
            CASE WHEN w.id IS NULL THEN g.tolerantie ELSE w.tolerantie END AS tolerantie,
            coalesce(CASE WHEN w.id IS NULL THEN g.tolerantie_soort ELSE w.tolerantie_soort END, v.tolerantie_soort) AS tolerantie_soort,
            v.verplicht,
            CASE WHEN w.id IS NULL THEN NULL ELSE json_build_object(
              'id', w.id, 'setting', w.setting, 'gemeten', w.gemeten, 'markering', w.markering,
              'gecorrigeerd', w.vervangt_waarde_id IS NOT NULL, 'ingevoerd_op', w.ingevoerd_op) END AS waarde
       FROM stapregistratie r
       JOIN veld v ON v.processtap_id = r.processtap_id
       CROSS JOIN LATERAL grenzen_van(v.id, r.product_id) g
       LEFT JOIN waarde_actueel w ON w.stapregistratie_id = r.id AND w.veld_id = v.id
      WHERE r.id = $1 AND (v.actief OR w.id IS NOT NULL)
      ORDER BY v.volgnummer`,
    [id],
  );
  const grondstoffen = await lees(
    db,
    `SELECT g.code, g.naam, g.eenheid, coalesce(x.verplicht AND x.actief, false) AS verplicht,
            CASE WHEN u.id IS NULL THEN NULL ELSE json_build_object(
              'id', u.id, 'partij', u.partij, 'hoeveelheid', u.hoeveelheid,
              'gecorrigeerd', u.vervangt_id IS NOT NULL, 'ingevoerd_op', u.ingevoerd_op) END AS gebruik
       FROM stapregistratie r
       JOIN grondstof g ON true
       LEFT JOIN stap_grondstof x ON x.processtap_id = r.processtap_id AND x.grondstof_id = g.id
       LEFT JOIN grondstof_gebruik_actueel u ON u.stapregistratie_id = r.id AND u.grondstof_id = g.id
      WHERE r.id = $1 AND ((x.actief AND g.actief) OR u.id IS NOT NULL)
      ORDER BY g.code`,
    [id],
  );
  const [keuring] = await lees(
    db,
    `SELECT k.id, k.status, k.reden, g.gebruikersnaam AS besloten_door, k.besloten_op
       FROM keuring k LEFT JOIN gebruiker g ON g.id = k.besloten_door WHERE k.stapregistratie_id = $1`,
    [id],
  );
  return { ...reg, velden, grondstoffen, keuring: keuring ?? null };
}

const routes: FastifyPluginAsyncTypebox = async (app) => {
  // Een stap starten voor een batch (PS1-PS15) of een lot (PS17-PS18).
  // Met een eigen id (UUID van het apparaat) is opnieuw versturen veilig.
  app.post(
    "/",
    {
      preHandler: vereist(...INVOER, "kwaliteit"),
      schema: {
        tags: ["registraties"],
        description:
          "Start een stap. PS16 start via POST /lots, herbewerking via POST /lots/{lotnummer}/herbewerking. " +
          "Kwaliteit start alleen een keuringsstap (#80); die is meteen afgerond en de keuring staat dan open.",
        body: Type.Object({
          id: Type.Optional(Type.String({ format: "uuid", description: "Door het apparaat gemaakt; maakt opnieuw versturen veilig" })),
          stapcode: StapCode,
          batchnummer: Type.Optional(BatchNummer),
          lotnummer: Type.Optional(LotNummer),
        }),
        response: { 200: RegistratieDetail, 201: RegistratieDetail },
      },
    },
    async (req, reply) => {
      const { pcId, operatorId } = await invoerContext(app.db, req);
      const { id, stapcode, batchnummer, lotnummer } = req.body;
      if (!batchnummer === !lotnummer) throw new ApiFout(400, "Geef een batchnummer óf een lotnummer");
      if (req.user.rol === "kwaliteit") {
        const [st] = await lees<{ soort: string }>(app.db, "SELECT soort FROM processtap WHERE code = $1", [stapcode]);
        if (st?.soort !== "keuring") throw new ApiFout(403, "Kwaliteit start alleen keuringen");
      }

      if (id) {
        const [bestaand] = await lees<{ code: string }>(
          app.db,
          "SELECT s.code FROM stapregistratie r JOIN processtap s ON s.id = r.processtap_id WHERE r.id = $1",
          [id],
        );
        if (bestaand) {
          if (bestaand.code !== stapcode) throw new ApiFout(409, "Dit id hoort bij een andere stap");
          return reply.status(200).send((await registratieDetail(app.db, id)) as never);
        }
      }

      const nieuwId = await invoerTransactie(app.db, req, async (tx) => {
        let batchId: string | null = null;
        let lotId: string | null = null;
        if (batchnummer) {
          const { rows } = await tx.query("SELECT id FROM batch WHERE batchnummer = $1", [batchnummer]);
          if (!rows[0]) throw niet("Batch");
          batchId = rows[0].id;
        } else {
          const { rows } = await tx.query("SELECT id FROM lot WHERE lotnummer = $1", [lotnummer]);
          if (!rows[0]) throw niet("Lot");
          lotId = rows[0].id;
        }
        const { rows } = await tx.query("SELECT start_stap($1, $2, $3, $4, $5, $6) AS id", [
          stapcode,
          batchId,
          lotId,
          pcId,
          operatorId,
          id ?? null,
        ]);
        return rows[0].id as string;
      });
      return reply.status(201).send((await registratieDetail(app.db, nieuwId)) as never);
    },
  );

  app.get(
    "/",
    {
      preHandler: vereist(...IEDEREEN),
      schema: {
        tags: ["registraties"],
        querystring: Type.Object({
          status: Type.Optional(Type.Union([Type.Literal("open"), Type.Literal("afgerond"), Type.Literal("afgebroken")])),
          stapcode: Type.Optional(StapCode),
          limiet: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, default: 100 })),
        }),
        response: { 200: Type.Array(RegistratieKort) },
      },
    },
    async (req) => {
      const params: unknown[] = [req.query.status ?? null, req.query.stapcode ?? null, req.query.limiet ?? 100];
      return lees(
        app.db,
        `${REGISTRATIE_SQL} WHERE ($1::text IS NULL OR r.status = $1) AND ($2::text IS NULL OR s.code = $2)
          ORDER BY r.gestart_op DESC LIMIT $3`,
        params,
      ) as never;
    },
  );

  app.get(
    "/:id",
    { preHandler: vereist(...IEDEREEN), schema: { tags: ["registraties"], params: Id, response: { 200: RegistratieDetail } } },
    async (req) => (await registratieDetail(app.db, req.params.id)) as never,
  );

  // Waarden invullen. Meerdere tegelijk; elke waarde mag een eigen id meekrijgen.
  app.post(
    "/:id/waarden",
    {
      // Kwaliteit vult de velden in die Kwaliteit meet (sinds 0.37.0, #64); de database bewaakt welke dat zijn.
      preHandler: vereist(...INVOER, "kwaliteit"),
      schema: {
        tags: ["registraties"],
        params: Id,
        body: Type.Object({
          waarden: Type.Array(
            Type.Object({
              id: Type.Optional(Type.String({ format: "uuid" })),
              veldcode: Type.String({ examples: ["S3.1"] }),
              setting: Type.Optional(NulGetal()),
              gemeten: Type.Number(),
            }),
            { minItems: 1 },
          ),
        }),
        response: { 200: RegistratieDetail },
      },
    },
    async (req) => {
      const { operatorId } = await invoerContext(app.db, req);
      await invoerTransactie(app.db, req, async (tx) => {
        for (const w of req.body.waarden) {
          if (w.id) {
            const { rows } = await tx.query("SELECT stapregistratie_id FROM waarde WHERE id = $1", [w.id]);
            if (rows[0]) {
              if (rows[0].stapregistratie_id !== req.params.id) throw new ApiFout(409, "Dit waarde-id hoort bij een andere registratie");
              continue; // al ontvangen
            }
          }
          const veld = await tx.query(
            `SELECT v.id FROM veld v JOIN stapregistratie r ON r.processtap_id = v.processtap_id
              WHERE r.id = $1 AND v.code = $2`,
            [req.params.id, w.veldcode],
          );
          if (!veld.rows[0]) throw new ApiFout(422, `Veld ${w.veldcode} hoort niet bij deze registratie`);
          try {
            await tx.query("SAVEPOINT w");
            await tx.query(
              `INSERT INTO waarde (id, stapregistratie_id, veld_id, setting, gemeten, ingevoerd_door)
               VALUES (coalesce($1, gen_random_uuid()), $2, $3, $4, $5, $6)`,
              [w.id ?? null, req.params.id, veld.rows[0].id, w.setting ?? null, w.gemeten, operatorId],
            );
          } catch (e) {
            if ((e as { constraint?: string }).constraint === "waarde_een_origineel") {
              throw new ApiFout(409, `Veld ${w.veldcode} is al ingevuld; een ploegleider kan corrigeren`);
            }
            throw e;
          }
        }
      });
      return (await registratieDetail(app.db, req.params.id)) as never;
    },
  );

  app.post(
    "/:id/afronden",
    { preHandler: vereist(...INVOER), schema: { tags: ["registraties"], params: Id, response: { 200: RegistratieDetail } } },
    async (req) => {
      // Wie afrondt, kan een ander zijn dan wie startte (ploegwissel, #55).
      const { pcId, operatorId } = await invoerContext(app.db, req);
      await invoerTransactie(app.db, req, (tx) => tx.query("SELECT rond_stap_af($1, $2, $3)", [req.params.id, operatorId, pcId]));
      return (await registratieDetail(app.db, req.params.id)) as never;
    },
  );

  // Grondstoffen: partijnummer (en eventueel hoeveelheid) per grondstof van de stap.
  app.post(
    "/:id/grondstoffen",
    {
      preHandler: vereist(...INVOER),
      schema: {
        tags: ["registraties"],
        params: Id,
        body: Type.Object({
          grondstoffen: Type.Array(
            Type.Object({
              id: Type.Optional(Type.String({ format: "uuid" })),
              code: Type.String({ examples: ["GS-A"] }),
              partij: Type.String({ minLength: 1, maxLength: 60, examples: ["LEV-GS-A-2611-03"] }),
              hoeveelheid: Type.Optional(NulGetal({ exclusiveMinimum: 0 })),
            }),
            { minItems: 1 },
          ),
        }),
        response: { 200: RegistratieDetail },
      },
    },
    async (req) => {
      const { operatorId } = await invoerContext(app.db, req);
      await invoerTransactie(app.db, req, async (tx) => {
        for (const g of req.body.grondstoffen) {
          if (g.id) {
            const { rows } = await tx.query("SELECT stapregistratie_id FROM grondstof_gebruik WHERE id = $1", [g.id]);
            if (rows[0]) {
              if (rows[0].stapregistratie_id !== req.params.id) throw new ApiFout(409, "Dit id hoort bij een andere registratie");
              continue; // al ontvangen
            }
          }
          const { rows: gs } = await tx.query("SELECT id FROM grondstof WHERE code = $1", [g.code]);
          if (!gs[0]) throw new ApiFout(422, `Onbekende grondstof ${g.code}`);
          try {
            await tx.query("SAVEPOINT g");
            await tx.query(
              `INSERT INTO grondstof_gebruik (id, stapregistratie_id, grondstof_id, partij, hoeveelheid, ingevoerd_door)
               VALUES (coalesce($1, gen_random_uuid()), $2, $3, $4, $5, $6)`,
              [g.id ?? null, req.params.id, gs[0].id, g.partij, g.hoeveelheid ?? null, operatorId],
            );
          } catch (e) {
            if ((e as { constraint?: string }).constraint === "grondstof_gebruik_een_origineel") {
              throw new ApiFout(409, `Grondstof ${g.code} is al ingevuld; een ploegleider kan corrigeren`);
            }
            throw e;
          }
        }
      });
      return (await registratieDetail(app.db, req.params.id)) as never;
    },
  );

  app.post(
    "/:id/grondstoffen/:code/correctie",
    {
      preHandler: vereist(...LEIDING),
      schema: {
        tags: ["registraties"],
        params: Type.Object({ id: Type.String({ format: "uuid" }), code: Type.String() }),
        body: Type.Object({
          partij: Type.String({ minLength: 1, maxLength: 60 }),
          hoeveelheid: Type.Optional(NulGetal({ exclusiveMinimum: 0 })),
          reden: Type.String({ minLength: 1 }),
        }),
        response: { 201: RegistratieDetail },
      },
    },
    async (req, reply) => {
      await inTransactie(app.db, req.user.naam, async (tx) => {
        const { rows } = await tx.query(
          `SELECT u.id, u.grondstof_id, u.hoeveelheid FROM grondstof_gebruik_actueel u JOIN grondstof g ON g.id = u.grondstof_id
            WHERE u.stapregistratie_id = $1 AND g.code = $2`,
          [req.params.id, req.params.code],
        );
        if (!rows[0]) throw niet("Grondstofregel");
        await tx.query(
          `INSERT INTO grondstof_gebruik (stapregistratie_id, grondstof_id, partij, hoeveelheid, vervangt_id, correctie_reden, gecorrigeerd_door)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [req.params.id, rows[0].grondstof_id, req.body.partij, req.body.hoeveelheid === undefined ? rows[0].hoeveelheid : req.body.hoeveelheid,
            rows[0].id, req.body.reden, req.user.sub],
        );
      });
      return reply.status(201).send((await registratieDetail(app.db, req.params.id)) as never);
    },
  );

  // Correctie van een waarde (ploegleider of hoger). Het origineel blijft bewaard.
  app.post(
    "/:id/waarden/:veldcode/correctie",
    {
      preHandler: vereist(...LEIDING),
      schema: {
        tags: ["registraties"],
        params: Type.Object({ id: Type.String({ format: "uuid" }), veldcode: Type.String() }),
        body: Type.Object({
          setting: Type.Optional(NulGetal()),
          gemeten: Type.Number(),
          reden: Type.String({ minLength: 1 }),
        }),
        response: { 201: RegistratieDetail },
      },
    },
    async (req, reply) => {
      await inTransactie(app.db, req.user.naam, async (tx) => {
        const { rows } = await tx.query(
          `SELECT w.id, w.veld_id, w.setting FROM waarde_actueel w JOIN veld v ON v.id = w.veld_id
            WHERE w.stapregistratie_id = $1 AND v.code = $2`,
          [req.params.id, req.params.veldcode],
        );
        if (!rows[0]) throw niet("Waarde");
        const setting = req.body.setting === undefined ? rows[0].setting : req.body.setting;
        await tx.query(
          `INSERT INTO waarde (stapregistratie_id, veld_id, setting, gemeten, vervangt_waarde_id, correctie_reden, gecorrigeerd_door)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [req.params.id, rows[0].veld_id, setting, req.body.gemeten, rows[0].id, req.body.reden, req.user.sub],
        );
      });
      return reply.status(201).send((await registratieDetail(app.db, req.params.id)) as never);
    },
  );
};

export default routes;
