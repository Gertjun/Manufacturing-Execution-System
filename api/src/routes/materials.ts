import { Type, type FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { persoonlijkeTransactie } from "../auth.js";
import { personalSession } from "../modules/authorization/access.js";

const Id = Type.String({ format: "uuid" });
const Code = Type.String({ minLength: 1, maxLength: 100, pattern: "\\S" });
const Naam = Type.String({ minLength: 1, maxLength: 250, pattern: "\\S" });
const OptId = Type.Union([Id, Type.Null()]);
const Eenheid = Type.Union([Type.String({ minLength: 1, maxLength: 40, pattern: "\\S" }), Type.Null()]);
const Uitkomst = Type.Object({ id: Id });
const Klasse = Type.Object({ id: Id, code: Code, name: Naam });
const Definitie = Type.Object({ id: Id, code: Code, product_id: OptId, raw_material_id: OptId });
const Versie = Type.Object({
  id: Id, material_definition_id: Id, revision: Type.Integer({ minimum: 1 }),
  name: Naam, material_class_id: OptId, unit: Eenheid, measurement_unit_id: OptId,
  created_at: Type.String(), created_by: Id,
});

// Alle vier functies controleren opnieuw de persoonlijke actor en de actuele
// globale material.definition.manage in PostgreSQL. Geen directe tabeltoegang.
const routes: FastifyPluginAsyncTypebox = async (app) => {
  app.get("/", {
    preHandler: personalSession,
    schema: { tags: ["materialen"], response: { 200: Type.Object({
      classes: Type.Array(Klasse), definitions: Type.Array(Definitie), versions: Type.Array(Versie),
    }) } },
  }, async (req) => persoonlijkeTransactie(app.db, req, async tx =>
    (await tx.query("SELECT material_list() AS data")).rows[0].data));

  app.post("/classes", {
    preHandler: personalSession,
    schema: { tags: ["materialen"], body: Type.Object({ code: Code, name: Naam }, { additionalProperties: false }),
      response: { 201: Uitkomst } },
  }, async (req, reply) => {
    const { code, name } = req.body;
    const result = await persoonlijkeTransactie(app.db, req, async tx =>
      (await tx.query("SELECT material_create_class($1,$2) AS id", [code, name])).rows[0]);
    return reply.code(201).send(result as { id: string });
  });

  app.post("/definitions", {
    preHandler: personalSession,
    schema: { tags: ["materialen"], body: Type.Object({
      code: Code, name: Naam, material_class_id: OptId, unit: Eenheid,
      product_id: OptId, raw_material_id: OptId,
    }, { additionalProperties: false }), response: { 201: Uitkomst } },
  }, async (req, reply) => {
    const b = req.body;
    const result = await persoonlijkeTransactie(app.db, req, async tx =>
      (await tx.query("SELECT material_create_definition($1,$2,$3,$4,$5,$6) AS id",
        [b.code,b.name,b.material_class_id,b.unit,b.product_id,b.raw_material_id])).rows[0]);
    return reply.code(201).send(result as { id: string });
  });

  app.post("/definitions/:id/versions", {
    preHandler: personalSession,
    schema: { tags: ["materialen"], params: Type.Object({ id: Id }), body: Type.Object({
      expected_revision: Type.Integer({ minimum: 1, maximum: 2147483646 }),
      name: Naam, material_class_id: OptId, unit: Eenheid,
    }, { additionalProperties: false }), response: { 201: Uitkomst } },
  }, async (req, reply) => {
    const b = req.body;
    const result = await persoonlijkeTransactie(app.db, req, async tx =>
      (await tx.query("SELECT material_append_version($1,$2,$3,$4,$5) AS id",
        [req.params.id,b.expected_revision,b.name,b.material_class_id,b.unit])).rows[0]);
    return reply.code(201).send(result as { id: string });
  });
  app.post("/definitions/with-unit", {
    preHandler: personalSession,
    schema: { tags: ["materialen"], body: Type.Object({
      code: Code, name: Naam, material_class_id: OptId, measurement_unit_id: Id,
      product_id: OptId, raw_material_id: OptId,
    }, { additionalProperties: false }), response: { 201: Uitkomst } },
  }, async (req, reply) => {
    const b = req.body;
    const result = await persoonlijkeTransactie(app.db, req, async tx =>
      (await tx.query("SELECT material_create_definition_with_unit($1,$2,$3,$4,$5,$6) AS id",
        [b.code,b.name,b.material_class_id,b.measurement_unit_id,b.product_id,b.raw_material_id])).rows[0]);
    return reply.code(201).send(result as { id: string });
  });

  app.post("/definitions/:id/versions/with-unit", {
    preHandler: personalSession,
    schema: { tags: ["materialen"], params: Type.Object({ id: Id }), body: Type.Object({
      expected_revision: Type.Integer({ minimum: 1, maximum: 2147483646 }),
      name: Naam, material_class_id: OptId, measurement_unit_id: Id,
    }, { additionalProperties: false }), response: { 201: Uitkomst } },
  }, async (req, reply) => {
    const b = req.body;
    const result = await persoonlijkeTransactie(app.db, req, async tx =>
      (await tx.query("SELECT material_append_version_with_unit($1,$2,$3,$4,$5) AS id",
        [req.params.id,b.expected_revision,b.name,b.material_class_id,b.measurement_unit_id])).rows[0]);
    return reply.code(201).send(result as { id: string });
  });

};

export default routes;
