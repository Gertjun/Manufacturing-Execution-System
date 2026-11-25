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
};
export default routes;
