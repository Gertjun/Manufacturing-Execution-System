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

const Nonblank = Type.String({ minLength: 1, maxLength: 10000, pattern: "\\S" });
const Unit = Type.String({ minLength: 1, maxLength: 40, pattern: "\\S" });
const NullableUnit = Type.Union([Unit,Type.Null()]);
const Decimal = Type.String({ minLength: 1, maxLength: 100, pattern: "^-?[0-9]+(\\.[0-9]+)?$" });
const NullableDecimal = Type.Union([Decimal,Type.Null()]);
const NumericType = Type.Union([Type.Literal("decimal"),Type.Literal("integer")]);
const DataType = Type.Union([Type.Literal("decimal"),Type.Literal("integer"),Type.Literal("boolean"),Type.Literal("text")]);
const Category = Type.Union([Type.Literal("target"),Type.Literal("operating_tolerance"),Type.Literal("process_limit"),Type.Literal("specification_limit"),Type.Literal("statistical_control_limit")]);
const Scaling = Type.Union([Type.Literal("fixed"),Type.Literal("linear")]);
const Direction = Type.Union([Type.Literal("input"),Type.Literal("output")]);
const ParameterFields = { procedural_element_id: Id, code: Code, name: Naam, data_type: DataType, unit: NullableUnit, frequency: Nonblank, required: Type.Boolean(), responsible_activity: Nonblank, critical: Type.Boolean(), measurement_unit_id: OptId };
const ParameterBody = Type.Object({ expected_change_no: Expected, ...ParameterFields }, { additionalProperties: false });
const ParameterRecord = Type.Object({ id: Id, recipe_version_id: Id, ...ParameterFields });
const ParameterLimitFields = { parameter_id: Id, data_type: NumericType, category: Category, target_value: NullableDecimal, lower_value: NullableDecimal, upper_value: NullableDecimal, scaling: Scaling };
const ParameterLimitBody = Type.Object({ expected_change_no: Expected, ...ParameterLimitFields }, { additionalProperties: false });
const ParameterLimitRecord = Type.Object({ id: Id, recipe_version_id: Id, ...ParameterLimitFields });
const FormulaFields = { reference_quantity: Decimal, reference_unit: Unit, reference_unit_id: OptId };
const FormulaBody = Type.Object({ expected_change_no: Expected, ...FormulaFields }, { additionalProperties: false });
const FormulaRecord = Type.Object({ id: Id, recipe_version_id: Id, ...FormulaFields });
const MaterialRequirementFields = { formula_id: Id, procedural_element_id: OptId, material_version_id: Id, code: Code, direction: Direction, quantity: Decimal, unit: Unit, scaling: Scaling, measurement_unit_id: OptId };
const MaterialRequirementBody = Type.Object({ expected_change_no: Expected, ...MaterialRequirementFields }, { additionalProperties: false });
const MaterialRequirementRecord = Type.Object({ id: Id, recipe_version_id: Id, ...MaterialRequirementFields });
const Content = Type.Object({
  change_no: Type.Integer({ minimum: 0 }),
  parameters: Type.Array(ParameterRecord), parameter_limits: Type.Array(ParameterLimitRecord),
  formulas: Type.Array(FormulaRecord), material_requirements: Type.Array(MaterialRequirementRecord),
});

// Cast numeric JSON fields to exact decimal text before the pg driver parses JSON.
const contentSql = `WITH c AS (SELECT recipe_content_list($1) AS data)
 SELECT data || jsonb_build_object(
 'parameter_limits',COALESCE((SELECT jsonb_agg(x || jsonb_build_object(
   'target_value',x->>'target_value','lower_value',x->>'lower_value','upper_value',x->>'upper_value') ORDER BY x->>'id')
   FROM jsonb_array_elements(data->'parameter_limits') x),'[]'::jsonb),
 'formulas',COALESCE((SELECT jsonb_agg(x || jsonb_build_object('reference_quantity',x->>'reference_quantity') ORDER BY x->>'id')
   FROM jsonb_array_elements(data->'formulas') x),'[]'::jsonb),
 'material_requirements',COALESCE((SELECT jsonb_agg(x || jsonb_build_object('quantity',x->>'quantity') ORDER BY x->>'id')
   FROM jsonb_array_elements(data->'material_requirements') x),'[]'::jsonb)
 ) AS data FROM c`;
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

  app.get("/versions/:id/content", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id }), response: { 200: Content } },
  }, async req => persoonlijkeTransactie(app.db,req,async tx =>
    (await tx.query(contentSql,[req.params.id])).rows[0].data));

  app.post("/versions/:id/content/parameters", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id }), body: ParameterBody, response: { 201: ChangedId } },
  }, async (req,reply) => {
    const b=req.body;
    const result=await persoonlijkeTransactie(app.db,req,async tx =>
      (await tx.query("SELECT recipe_save_parameter($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS data",
        [req.params.id,b.expected_change_no,b.procedural_element_id,b.code,b.name,b.data_type,b.unit,b.frequency,b.required,b.responsible_activity,b.critical,b.measurement_unit_id])).rows[0].data);
    return reply.code(201).send(result);
  });

  app.patch("/versions/:id/content/parameters/:recordId", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id, recordId: Id }), body: ParameterBody, response: { 200: ChangedId } },
  }, async req => {
    const b=req.body;
    return persoonlijkeTransactie(app.db,req,async tx =>
      (await tx.query("SELECT recipe_save_parameter($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) AS data",
        [req.params.id,b.expected_change_no,req.params.recordId,b.procedural_element_id,b.code,b.name,b.data_type,b.unit,b.frequency,b.required,b.responsible_activity,b.critical,b.measurement_unit_id])).rows[0].data);
  });

  app.delete("/versions/:id/content/parameters/:recordId", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id, recordId: Id }),
      querystring: Type.Object({ expected_change_no: Expected }, { additionalProperties: false }), response: { 200: Change } },
  }, async req => persoonlijkeTransactie(app.db,req,async tx =>
    (await tx.query("SELECT recipe_delete_parameter($1,$2,$3) AS change_no",
      [req.params.id,req.query.expected_change_no,req.params.recordId])).rows[0]));

  app.post("/versions/:id/content/parameter-limits", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id }), body: ParameterLimitBody, response: { 201: ChangedId } },
  }, async (req,reply) => {
    const b=req.body;
    const result=await persoonlijkeTransactie(app.db,req,async tx =>
      (await tx.query("SELECT recipe_save_parameter_limit($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9) AS data",
        [req.params.id,b.expected_change_no,b.parameter_id,b.data_type,b.category,b.target_value,b.lower_value,b.upper_value,b.scaling])).rows[0].data);
    return reply.code(201).send(result);
  });

  app.patch("/versions/:id/content/parameter-limits/:recordId", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id, recordId: Id }), body: ParameterLimitBody, response: { 200: ChangedId } },
  }, async req => {
    const b=req.body;
    return persoonlijkeTransactie(app.db,req,async tx =>
      (await tx.query("SELECT recipe_save_parameter_limit($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS data",
        [req.params.id,b.expected_change_no,req.params.recordId,b.parameter_id,b.data_type,b.category,b.target_value,b.lower_value,b.upper_value,b.scaling])).rows[0].data);
  });

  app.delete("/versions/:id/content/parameter-limits/:recordId", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id, recordId: Id }),
      querystring: Type.Object({ expected_change_no: Expected }, { additionalProperties: false }), response: { 200: Change } },
  }, async req => persoonlijkeTransactie(app.db,req,async tx =>
    (await tx.query("SELECT recipe_delete_parameter_limit($1,$2,$3) AS change_no",
      [req.params.id,req.query.expected_change_no,req.params.recordId])).rows[0]));

  app.post("/versions/:id/content/formulas", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id }), body: FormulaBody, response: { 201: ChangedId } },
  }, async (req,reply) => {
    const b=req.body;
    const result=await persoonlijkeTransactie(app.db,req,async tx =>
      (await tx.query("SELECT recipe_save_formula($1,$2,NULL,$3,$4,$5) AS data",
        [req.params.id,b.expected_change_no,b.reference_quantity,b.reference_unit,b.reference_unit_id])).rows[0].data);
    return reply.code(201).send(result);
  });

  app.patch("/versions/:id/content/formulas/:recordId", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id, recordId: Id }), body: FormulaBody, response: { 200: ChangedId } },
  }, async req => {
    const b=req.body;
    return persoonlijkeTransactie(app.db,req,async tx =>
      (await tx.query("SELECT recipe_save_formula($1,$2,$3,$4,$5,$6) AS data",
        [req.params.id,b.expected_change_no,req.params.recordId,b.reference_quantity,b.reference_unit,b.reference_unit_id])).rows[0].data);
  });

  app.delete("/versions/:id/content/formulas/:recordId", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id, recordId: Id }),
      querystring: Type.Object({ expected_change_no: Expected }, { additionalProperties: false }), response: { 200: Change } },
  }, async req => persoonlijkeTransactie(app.db,req,async tx =>
    (await tx.query("SELECT recipe_delete_formula($1,$2,$3) AS change_no",
      [req.params.id,req.query.expected_change_no,req.params.recordId])).rows[0]));

  app.post("/versions/:id/content/material-requirements", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id }), body: MaterialRequirementBody, response: { 201: ChangedId } },
  }, async (req,reply) => {
    const b=req.body;
    const result=await persoonlijkeTransactie(app.db,req,async tx =>
      (await tx.query("SELECT recipe_save_material_requirement($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS data",
        [req.params.id,b.expected_change_no,b.formula_id,b.procedural_element_id,b.material_version_id,b.code,b.direction,b.quantity,b.unit,b.scaling,b.measurement_unit_id])).rows[0].data);
    return reply.code(201).send(result);
  });

  app.patch("/versions/:id/content/material-requirements/:recordId", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id, recordId: Id }), body: MaterialRequirementBody, response: { 200: ChangedId } },
  }, async req => {
    const b=req.body;
    return persoonlijkeTransactie(app.db,req,async tx =>
      (await tx.query("SELECT recipe_save_material_requirement($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS data",
        [req.params.id,b.expected_change_no,req.params.recordId,b.formula_id,b.procedural_element_id,b.material_version_id,b.code,b.direction,b.quantity,b.unit,b.scaling,b.measurement_unit_id])).rows[0].data);
  });

  app.delete("/versions/:id/content/material-requirements/:recordId", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id, recordId: Id }),
      querystring: Type.Object({ expected_change_no: Expected }, { additionalProperties: false }), response: { 200: Change } },
  }, async req => persoonlijkeTransactie(app.db,req,async tx =>
    (await tx.query("SELECT recipe_delete_material_requirement($1,$2,$3) AS change_no",
      [req.params.id,req.query.expected_change_no,req.params.recordId])).rows[0]));

};
export default routes;
