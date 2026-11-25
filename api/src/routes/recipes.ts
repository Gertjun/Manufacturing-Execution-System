import { Type, type FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { persoonlijkeTransactie } from "../auth.js";
import { personalSession } from "../modules/authorization/access.js";

const Id = Type.String({ format: "uuid" });
const Code = Type.String({ minLength: 1, maxLength: 100, pattern: "\\S" });
const Naam = Type.String({ minLength: 1, maxLength: 250, pattern: "\\S" });
const Beschrijving = Type.String({ maxLength: 10000 });
const Result = Type.Object({ id: Id });
const Versie = Type.Object({
  id: Id, master_recipe_id: Id, revision: Type.Integer({ minimum: 1 }),
  name: Naam, description: Beschrijving, created_at: Type.String(), created_by: Id,
  change_no: Type.Integer({ minimum: 0 }),
});
const Recept = Type.Object({
  id: Id, product_id: Id, code: Code, created_at: Type.String(), created_by: Id,
  versions: Type.Array(Versie),
});
const Kind = Type.Union([Type.Literal("procedure"),Type.Literal("unit_procedure"),Type.Literal("operation"),Type.Literal("phase")]);
const OptId = Type.Union([Id,Type.Null()]);
const Expected = Type.Integer({ minimum: 0, maximum: 2147483646 });
const Change = Type.Object({ change_no: Type.Integer({ minimum: 1 }) });
const ChangedId = Type.Object({ id: Id, change_no: Type.Integer({ minimum: 1 }) });
const Element = Type.Object({
  id: Id, recipe_version_id: Id, parent_id: OptId, parent_kind: Type.Union([Kind,Type.Null()]),
  kind: Kind, code: Code, name: Naam, position: Type.Integer({ minimum: 1 }), required: Type.Boolean(),
});
const Dependency = Type.Object({ id: Id, recipe_version_id: Id, predecessor_id: Id, successor_id: Id });
const ElementBody = Type.Object({
  expected_change_no: Expected, parent_id: OptId, kind: Kind, code: Code, name: Naam,
  position: Type.Integer({ minimum: 1, maximum: 2147483647 }), required: Type.Boolean(),
}, { additionalProperties: false });
const routes: FastifyPluginAsyncTypebox = async (app) => {
  app.get("/", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], querystring: Type.Object({ product_id: Id }, { additionalProperties: false }),
      response: { 200: Type.Array(Recept) } },
  }, async req => persoonlijkeTransactie(app.db, req, async tx =>
    (await tx.query("SELECT recipe_list($1) AS data", [req.query.product_id])).rows[0].data));

  app.post("/", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], body: Type.Object({
      product_id: Id, code: Code, name: Naam, description: Beschrijving,
    }, { additionalProperties: false }), response: { 201: Result } },
  }, async (req, reply) => {
    const b = req.body;
    const result = await persoonlijkeTransactie(app.db, req, async tx =>
      (await tx.query("SELECT recipe_create($1,$2,$3,$4) AS id", [b.product_id,b.code,b.name,b.description])).rows[0]);
    return reply.code(201).send(result as { id: string });
  });

  app.post("/:id/versions", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id }), body: Type.Object({
      expected_revision: Type.Integer({ minimum: 1, maximum: 2147483646 }),
      name: Naam, description: Beschrijving,
    }, { additionalProperties: false }), response: { 201: Result } },
  }, async (req, reply) => {
    const b = req.body;
    const result = await persoonlijkeTransactie(app.db, req, async tx =>
      (await tx.query("SELECT recipe_create_next_version($1,$2,$3,$4) AS id",
        [req.params.id,b.expected_revision,b.name,b.description])).rows[0]);
    return reply.code(201).send(result as { id: string });
  });

  app.patch("/versions/:id", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id }), body: Type.Object({
      expected_change_no: Type.Integer({ minimum: 0, maximum: 2147483646 }),
      name: Naam, description: Beschrijving,
    }, { additionalProperties: false }), response: { 200: Type.Object({ change_no: Type.Integer({ minimum: 1 }) }) } },
  }, async req => {
    const b = req.body;
    return persoonlijkeTransactie(app.db, req, async tx =>
      (await tx.query("SELECT recipe_update_draft($1,$2,$3,$4) AS change_no",
        [req.params.id,b.expected_change_no,b.name,b.description])).rows[0]);
  });
  app.get("/versions/:id/procedure", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id }),
      response: { 200: Type.Object({ change_no: Type.Integer({ minimum: 0 }),
        elements: Type.Array(Element), dependencies: Type.Array(Dependency) }) } },
  }, async req => persoonlijkeTransactie(app.db, req, async tx =>
    (await tx.query("SELECT recipe_procedure_list($1) AS data",[req.params.id])).rows[0].data));

  app.post("/versions/:id/procedure/elements", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id }), body: ElementBody,
      response: { 201: ChangedId } },
  }, async (req,reply) => {
    const b = req.body;
    const result = await persoonlijkeTransactie(app.db,req,async tx =>
      (await tx.query("SELECT recipe_save_element($1,$2,NULL,$3,$4,$5,$6,$7,$8) AS data",
        [req.params.id,b.expected_change_no,b.parent_id,b.kind,b.code,b.name,b.position,b.required])).rows[0].data);
    return reply.code(201).send(result);
  });

  app.patch("/versions/:id/procedure/elements/:elementId", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id, elementId: Id }), body: ElementBody,
      response: { 200: ChangedId } },
  }, async req => {
    const b = req.body;
    return persoonlijkeTransactie(app.db,req,async tx =>
      (await tx.query("SELECT recipe_save_element($1,$2,$3,$4,$5,$6,$7,$8,$9) AS data",
        [req.params.id,b.expected_change_no,req.params.elementId,b.parent_id,b.kind,b.code,b.name,b.position,b.required])).rows[0].data);
  });

  app.delete("/versions/:id/procedure/elements/:elementId", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id, elementId: Id }),
      querystring: Type.Object({ expected_change_no: Expected }, { additionalProperties: false }),
      response: { 200: Change } },
  }, async req => persoonlijkeTransactie(app.db,req,async tx =>
    (await tx.query("SELECT recipe_delete_element($1,$2,$3) AS change_no",
      [req.params.id,req.query.expected_change_no,req.params.elementId])).rows[0]));

  app.post("/versions/:id/procedure/dependencies", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id }),
      body: Type.Object({ expected_change_no: Expected, predecessor_id: Id, successor_id: Id }, { additionalProperties: false }),
      response: { 201: ChangedId } },
  }, async (req,reply) => {
    const b = req.body;
    const result = await persoonlijkeTransactie(app.db,req,async tx =>
      (await tx.query("SELECT recipe_add_dependency($1,$2,$3,$4) AS data",
        [req.params.id,b.expected_change_no,b.predecessor_id,b.successor_id])).rows[0].data);
    return reply.code(201).send(result);
  });

  app.delete("/versions/:id/procedure/dependencies/:dependencyId", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id, dependencyId: Id }),
      querystring: Type.Object({ expected_change_no: Expected }, { additionalProperties: false }),
      response: { 200: Change } },
  }, async req => persoonlijkeTransactie(app.db,req,async tx =>
    (await tx.query("SELECT recipe_delete_dependency($1,$2,$3) AS change_no",
      [req.params.id,req.query.expected_change_no,req.params.dependencyId])).rows[0]));

};
export default routes;
