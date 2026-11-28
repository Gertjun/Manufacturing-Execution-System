import { Type, type FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { persoonlijkeTransactie } from "../auth.js";
import { ApiFout } from "../fouten.js";
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
  lifecycle_status: Type.Union([Type.Literal("draft"),Type.Literal("in_review"),Type.Literal("approved"),Type.Literal("released"),Type.Literal("superseded"),Type.Literal("withdrawn")]),
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

const PositiveCount = Type.Integer({ minimum: 1, maximum: 2147483647 });
const LotCount = Type.Integer({ minimum: 1, maximum: 50 });
const EquipmentRequirementFields = { procedural_element_id: Id, code: Code, equipment_class_code: Code, description: Nonblank, required_count: PositiveCount, minimum_capacity: NullableDecimal, capacity_unit_id: OptId };
const EquipmentRequirementBody = Type.Object({ expected_change_no: Expected, ...EquipmentRequirementFields }, { additionalProperties: false });
const EquipmentRequirementRecord = Type.Object({ id: Id, recipe_version_id: Id, ...EquipmentRequirementFields, equipment_class_id: OptId, capacity_property_definition_id: OptId });
const LinkedEquipmentRequirementBody = Type.Object({
  expected_change_no: Expected, procedural_element_id: Id, code: Code, equipment_class_id: Id,
  description: Nonblank, required_count: PositiveCount, minimum_capacity: NullableDecimal,
  capacity_property_definition_id: OptId
}, { additionalProperties: false });
const PersonnelRequirementFields = { procedural_element_id: Id, code: Code, qualification_code: Code, required_count: PositiveCount };
const PersonnelRequirementBody = Type.Object({ expected_change_no: Expected, ...PersonnelRequirementFields }, { additionalProperties: false });
const PersonnelRequirementRecord = Type.Object({ id: Id, recipe_version_id: Id, ...PersonnelRequirementFields, qualification_description: Nonblank });
const InstructionFields = { procedural_element_id: Id, code: Code, position: PositiveCount, instruction_text: Nonblank, confirmation_required: Type.Boolean() };
const InstructionBody = Type.Object({ expected_change_no: Expected, ...InstructionFields }, { additionalProperties: false });
const InstructionRecord = Type.Object({ id: Id, recipe_version_id: Id, ...InstructionFields });
const SpecificationLinkFields = { parameter_limit_id: Id, code: Code, description: Nonblank };
const SpecificationLinkBody = Type.Object({ expected_change_no: Expected, ...SpecificationLinkFields }, { additionalProperties: false });
const SpecificationLinkRecord = Type.Object({ id: Id, recipe_version_id: Id, ...SpecificationLinkFields });
const LotRuleFields = { nominal_batch_count: LotCount, deviation_approval_required: Type.Boolean() };
const LotRuleBody = Type.Object({ expected_change_no: Expected, ...LotRuleFields }, { additionalProperties: false });
const LotRuleRecord = Type.Object({ id: Id, recipe_version_id: Id, ...LotRuleFields, deviation_reason_required: Type.Literal(true) });
const CompatibilityRuleFields = { other_recipe_version_id: Id, reason: Nonblank };
const CompatibilityRuleBody = Type.Object({ expected_change_no: Expected, ...CompatibilityRuleFields }, { additionalProperties: false });
const CompatibilityRuleRecord = Type.Object({ id: Id, recipe_version_id: Id, ...CompatibilityRuleFields });
const Requirements = Type.Object({
  change_no: Type.Integer({ minimum: 0 }),
  equipment_requirements: Type.Array(EquipmentRequirementRecord),
  personnel_requirements: Type.Array(PersonnelRequirementRecord),
  instructions: Type.Array(InstructionRecord),
  specification_links: Type.Array(SpecificationLinkRecord),
  lot_rules: Type.Array(LotRuleRecord),
  compatibility_rules: Type.Array(CompatibilityRuleRecord),
});

// Preserve exact minimum capacity before the pg driver parses JSON.
const requirementsSql = `WITH c AS (SELECT recipe_requirements_list($1) AS data)
 SELECT data || jsonb_build_object('equipment_requirements',
 COALESCE((SELECT jsonb_agg(x || jsonb_build_object('minimum_capacity',x->>'minimum_capacity') ORDER BY x->>'id')
 FROM jsonb_array_elements(data->'equipment_requirements') x),'[]'::jsonb)) AS data FROM c`;

const RuleKind = Type.Union([Type.Literal("nonlinear"),Type.Literal("parameter_dependent"),Type.Literal("equipment_dependent")]);
const SourceKind = Type.Union([Type.Literal("batch_quantity"),Type.Literal("parameter"),Type.Literal("equipment_property"),Type.Literal("constant")]);
const OperatorCode = Type.Union([Type.Literal("add"),Type.Literal("subtract"),Type.Literal("multiply"),Type.Literal("divide"),Type.Literal("power")]);
const Token = Type.Union([
  Type.Object({ op: Type.Literal("input"), id: Id }, { additionalProperties: false }),
  Type.Object({ op: OperatorCode }, { additionalProperties: false }),
]);
const Tokens = Type.Array(Token, { minItems: 1, maxItems: 128 });
const ExpressionBody = Type.Object({ expected_change_no: Expected, tokens: Tokens }, { additionalProperties: false });
const ExpressionRecord = Type.Object({ id: Id, recipe_version_id: Id, rule_id: Id, grammar_version: Type.Literal(1), tokens: Tokens });
const ScalingRuleFields = { code: Code, description: Nonblank, rule_kind: RuleKind, output_unit_id: Id, source_reference: Nonblank, applicability: Nonblank };
const ScalingRuleBody = Type.Object({ expected_change_no: Expected, ...ScalingRuleFields }, { additionalProperties: false });
const ScalingRuleRecord = Type.Object({ id: Id, recipe_version_id: Id, ...ScalingRuleFields });
const ScalingInputFields = { rule_id: Id, code: Code, source_kind: SourceKind, parameter_id: OptId, equipment_property: Type.Union([Nonblank,Type.Null()]), constant_value: NullableDecimal, unit_id: Id, conversion_version_id: OptId };
const ScalingInputBody = Type.Object({ expected_change_no: Expected, ...ScalingInputFields }, { additionalProperties: false });
const ScalingInputRecord = Type.Object({ id: Id, recipe_version_id: Id, ...ScalingInputFields, equipment_property_definition_id: OptId });
const LinkedScalingInputBody = Type.Object({ expected_change_no: Expected, rule_id: Id, code: Code, equipment_property_definition_id: Id }, { additionalProperties: false });
const ScalingBindingFields = { rule_id: Id, parameter_limit_id: OptId, material_requirement_id: OptId };
const ScalingBindingBody = Type.Object({ expected_change_no: Expected, ...ScalingBindingFields }, { additionalProperties: false });
const ScalingBindingRecord = Type.Object({ id: Id, recipe_version_id: Id, ...ScalingBindingFields });
const ScalingContent = Type.Object({
  change_no: Type.Integer({ minimum: 0 }),
  rules: Type.Array(ScalingRuleRecord), inputs: Type.Array(ScalingInputRecord),
  bindings: Type.Array(ScalingBindingRecord), expressions: Type.Array(ExpressionRecord),
});

// Preserve exact numeric constants before parsing JSON in JavaScript.
const scalingSql = `WITH c AS (SELECT recipe_scaling_list($1) AS data)
 SELECT data || jsonb_build_object('inputs',
 COALESCE((SELECT jsonb_agg(x || jsonb_build_object('constant_value',x->>'constant_value') ORDER BY x->>'id')
 FROM jsonb_array_elements(data->'inputs') x),'[]'::jsonb)) AS data FROM c`;

const Lifecycle = Type.Union([Type.Literal("draft"),Type.Literal("in_review"),Type.Literal("approved"),Type.Literal("released"),Type.Literal("superseded"),Type.Literal("withdrawn")]);
const ImpactArea = Type.Union([Type.Literal("header"),Type.Literal("procedure"),Type.Literal("parameters"),Type.Literal("formula"),Type.Literal("materials"),Type.Literal("equipment"),Type.Literal("personnel"),Type.Literal("instructions"),Type.Literal("quality"),Type.Literal("lot"),Type.Literal("scaling"),Type.Literal("other")]);
const ReviewDomain = Type.Union([Type.Literal("engineering"),Type.Literal("production"),Type.Literal("quality")]);
const ReviewDecision = Type.Union([Type.Literal("approve"),Type.Literal("reject")]);
const MOCFields = { reason: Nonblank, impact_description: Nonblank };
const MOCRecord = Type.Object({ id: Id, recipe_version_id: Id, baseline_version_id: OptId,
  change_kind: Type.Union([Type.Literal("initial"),Type.Literal("revision")]), ...MOCFields,
  created_by: Id, created_at: Type.String() });
const ImpactFields = { area: ImpactArea, explanation: Nonblank };
const ImpactRecord = Type.Object({ id: Id, recipe_version_id: Id, request_id: Id, ...ImpactFields });
const MOCContent = Type.Object({ change_no: Expected, lifecycle_status: Lifecycle,
  request: Type.Union([MOCRecord,Type.Null()]), impacts: Type.Array(ImpactRecord) });
const MOCBody = Type.Object({ expected_change_no: Expected, baseline_version_id: OptId, ...MOCFields }, { additionalProperties: false });
const MOCUpdate = Type.Object({ expected_change_no: Expected, ...MOCFields }, { additionalProperties: false });
const ImpactBody = Type.Object({ expected_change_no: Expected, request_id: Id, ...ImpactFields }, { additionalProperties: false });
const ReviewRequirements = Type.Object({ matrix_version: Type.Literal(1), recipe_version_id: Id, change_no: Expected,
  baseline_version_id: OptId, baseline_change_no: Type.Union([Expected,Type.Null()]),
  impact_areas: Type.Array(Type.String()), required_reviews: Type.Array(ReviewDomain) });
const Comparison = Type.Object({ comparison_text: Type.String({ description: "Exacte JSON-tekst; gebruik verliesvrije numerieke verwerking." }) });
const Inbox = Type.Array(Type.Object({ master_recipe_id: Id, recipe_code: Code, recipe_version_id: Id,
  revision: PositiveCount, lifecycle_status: Lifecycle, round_id: Id, round_no: PositiveCount,
  change_no: Expected, name: Naam, required_reviews: Type.Array(ReviewDomain),
  approved_domains: Type.Array(ReviewDomain), my_pending_domains: Type.Array(ReviewDomain) }));
const ReleaseRecord = Type.Object({ id: Id, master_recipe_id: Id, recipe_version_id: Id, round_id: Id,
  effective_from: Type.String(), released_at: Type.String(), released_by: Id, reason: Nonblank });
const WithdrawalRecord = Type.Object({ id: Id, release_id: Id, withdrawn_at: Type.String(), withdrawn_by: Id, reason: Nonblank });
const Dossier = Type.Object({ round: Type.Object({ id: Id, recipe_version_id: Id, round_no: PositiveCount, change_no: Expected,
  baseline_version_id: OptId, baseline_change_no: Type.Union([Expected,Type.Null()]), matrix_version: Type.Literal(1),
  required_reviews: Type.Array(ReviewDomain), contributors: Type.Array(Id), created_by: Id, created_at: Type.String(), snapshot_text: Type.String() }),
  lifecycle_status: Lifecycle, is_current: Type.Boolean(),
  decisions: Type.Array(Type.Object({ id: Id, round_id: Id, domain: ReviewDomain, decision: ReviewDecision, reason: Nonblank, reviewer_id: Id, decided_at: Type.String() })),
  release: Type.Union([ReleaseRecord,Type.Null()]), withdrawal: Type.Union([WithdrawalRecord,Type.Null()]) });
const ConfirmationPassword = Type.String({ minLength: 1, maxLength: 1024 });
const SubmitReview = Type.Object({ expected_change_no: Expected, expected_baseline_change_no: Type.Integer({ minimum: 0, maximum: 2147483646, nullable: true }), password: ConfirmationPassword }, { additionalProperties: false });
const DecideReview = Type.Object({ expected_change_no: Expected, domain: ReviewDomain, decision: ReviewDecision, reason: Nonblank, password: ConfirmationPassword }, { additionalProperties: false });
const SubmitResult = Type.Object({ status: Type.Literal("submitted"), round_id: Id });
const DecideResult = Type.Object({ status: Type.Literal("decided"), decision_id: Id, lifecycle_status: Lifecycle });

// Called only AFTER persoonlijkeTransactie has committed. Otherwise a
// failed password attempt would be rolled back with the HTTP error.
function confirmedReviewResult(result: { status: string }) {
  if (result.status === "locked") throw new ApiFout(429,"Wachtwoordbevestiging tijdelijk geblokkeerd");
  if (result.status === "denied") throw new ApiFout(403,"Wachtwoordbevestiging geweigerd");
}


const ReleaseValidation = Type.Object({ recipe_version_id: Id, change_no: Expected, lifecycle_status: Lifecycle,
  content_valid: Type.Boolean(), blockers: Type.Array(Type.Object({ code: Type.String(), record_id: Id, detail: Type.String() })) });
const ReleaseBody = Type.Object({ round_id: Id, expected_change_no: Expected,
  effective_from: Type.Union([Type.String({ format: "date-time" }),Type.Null()]),
  reason: Nonblank, password: ConfirmationPassword }, { additionalProperties: false });
const WithdrawBody = Type.Object({ reason: Nonblank, password: ConfirmationPassword }, { additionalProperties: false });
const ReleaseResult = Type.Object({ status: Type.Literal("released"), release_id: Id });
const WithdrawResult = Type.Object({ status: Type.Literal("withdrawn"), withdrawal_id: Id });

const routes: FastifyPluginAsyncTypebox = async (app) => {
  app.get("/references/:productId", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ productId: Id }),
      response: { 200: Type.Object({
        materials: Type.Array(Type.Object({ id: Id, material_code: Type.String(),
          revision: Type.Integer({minimum:1}), name: Type.String(),
          unit: Type.Union([Type.String(),Type.Null()]), measurement_unit_id: Type.Union([Id,Type.Null()]) })),
        qualifications: Type.Array(Type.Object({ code: Type.String(), description: Type.String() })),
        equipment_classes: Type.Array(Type.Object({ id: Id, code: Type.String(), name: Type.String() })),
        equipment_properties: Type.Array(Type.Object({ id: Id, code: Type.String(), name: Type.String(), quantity_kind_id: Id, measurement_unit_id: Id }))
      }) } },
  }, async req => persoonlijkeTransactie(app.db,req,async tx =>
    (await tx.query("SELECT recipe_reference_catalog($1) AS data",[req.params.productId])).rows[0].data));

  app.get("/products", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], response: { 200: Type.Array(Type.Object({
      id: Id, code: Type.String(), name: Type.String(), can_edit: Type.Boolean(), can_review: Type.Boolean()
    })) } },
  }, async req => persoonlijkeTransactie(app.db,req,async tx =>
    (await tx.query("SELECT recipe_products() AS data")).rows[0].data));

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

  app.get("/versions/:id/requirements", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id }), response: { 200: Requirements } },
  }, async req => persoonlijkeTransactie(app.db,req,async tx =>
    (await tx.query(requirementsSql,[req.params.id])).rows[0].data));

  app.post("/versions/:id/requirements/linked-equipment-requirements", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id }), body: LinkedEquipmentRequirementBody, response: { 201: ChangedId } },
  }, async (req,reply) => {
    const b=req.body;
    const result=await persoonlijkeTransactie(app.db,req,async tx =>
      (await tx.query("SELECT recipe_save_equipment_requirement_linked($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9) AS data",
        [req.params.id,b.expected_change_no,b.procedural_element_id,b.code,b.equipment_class_id,b.description,b.required_count,b.minimum_capacity,b.capacity_property_definition_id])).rows[0].data);
    return reply.code(201).send(result);
  });

  app.patch("/versions/:id/requirements/linked-equipment-requirements/:recordId", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id, recordId: Id }), body: LinkedEquipmentRequirementBody, response: { 200: ChangedId } },
  }, async req => {
    const b=req.body;
    return persoonlijkeTransactie(app.db,req,async tx =>
      (await tx.query("SELECT recipe_save_equipment_requirement_linked($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS data",
        [req.params.id,b.expected_change_no,req.params.recordId,b.procedural_element_id,b.code,b.equipment_class_id,b.description,b.required_count,b.minimum_capacity,b.capacity_property_definition_id])).rows[0].data);
  });

  app.post("/versions/:id/requirements/equipment-requirements", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id }), body: EquipmentRequirementBody, response: { 201: ChangedId } },
  }, async (req,reply) => {
    const b=req.body;
    const result=await persoonlijkeTransactie(app.db,req,async tx =>
      (await tx.query("SELECT recipe_save_equipment_requirement($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9) AS data",
        [req.params.id,b.expected_change_no,b.procedural_element_id,b.code,b.equipment_class_code,b.description,b.required_count,b.minimum_capacity,b.capacity_unit_id])).rows[0].data);
    return reply.code(201).send(result);
  });

  app.patch("/versions/:id/requirements/equipment-requirements/:recordId", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id, recordId: Id }), body: EquipmentRequirementBody, response: { 200: ChangedId } },
  }, async req => {
    const b=req.body;
    return persoonlijkeTransactie(app.db,req,async tx =>
      (await tx.query("SELECT recipe_save_equipment_requirement($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS data",
        [req.params.id,b.expected_change_no,req.params.recordId,b.procedural_element_id,b.code,b.equipment_class_code,b.description,b.required_count,b.minimum_capacity,b.capacity_unit_id])).rows[0].data);
  });

  app.delete("/versions/:id/requirements/equipment-requirements/:recordId", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id, recordId: Id }),
      querystring: Type.Object({ expected_change_no: Expected }, { additionalProperties: false }), response: { 200: Change } },
  }, async req => persoonlijkeTransactie(app.db,req,async tx =>
    (await tx.query("SELECT recipe_delete_equipment_requirement($1,$2,$3) AS change_no",
      [req.params.id,req.query.expected_change_no,req.params.recordId])).rows[0]));

  app.post("/versions/:id/requirements/personnel-requirements", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id }), body: PersonnelRequirementBody, response: { 201: ChangedId } },
  }, async (req,reply) => {
    const b=req.body;
    const result=await persoonlijkeTransactie(app.db,req,async tx =>
      (await tx.query("SELECT recipe_save_personnel_requirement($1,$2,NULL,$3,$4,$5,$6) AS data",
        [req.params.id,b.expected_change_no,b.procedural_element_id,b.code,b.qualification_code,b.required_count])).rows[0].data);
    return reply.code(201).send(result);
  });

  app.patch("/versions/:id/requirements/personnel-requirements/:recordId", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id, recordId: Id }), body: PersonnelRequirementBody, response: { 200: ChangedId } },
  }, async req => {
    const b=req.body;
    return persoonlijkeTransactie(app.db,req,async tx =>
      (await tx.query("SELECT recipe_save_personnel_requirement($1,$2,$3,$4,$5,$6,$7) AS data",
        [req.params.id,b.expected_change_no,req.params.recordId,b.procedural_element_id,b.code,b.qualification_code,b.required_count])).rows[0].data);
  });

  app.delete("/versions/:id/requirements/personnel-requirements/:recordId", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id, recordId: Id }),
      querystring: Type.Object({ expected_change_no: Expected }, { additionalProperties: false }), response: { 200: Change } },
  }, async req => persoonlijkeTransactie(app.db,req,async tx =>
    (await tx.query("SELECT recipe_delete_personnel_requirement($1,$2,$3) AS change_no",
      [req.params.id,req.query.expected_change_no,req.params.recordId])).rows[0]));

  app.post("/versions/:id/requirements/instructions", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id }), body: InstructionBody, response: { 201: ChangedId } },
  }, async (req,reply) => {
    const b=req.body;
    const result=await persoonlijkeTransactie(app.db,req,async tx =>
      (await tx.query("SELECT recipe_save_instruction($1,$2,NULL,$3,$4,$5,$6,$7) AS data",
        [req.params.id,b.expected_change_no,b.procedural_element_id,b.code,b.position,b.instruction_text,b.confirmation_required])).rows[0].data);
    return reply.code(201).send(result);
  });

  app.patch("/versions/:id/requirements/instructions/:recordId", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id, recordId: Id }), body: InstructionBody, response: { 200: ChangedId } },
  }, async req => {
    const b=req.body;
    return persoonlijkeTransactie(app.db,req,async tx =>
      (await tx.query("SELECT recipe_save_instruction($1,$2,$3,$4,$5,$6,$7,$8) AS data",
        [req.params.id,b.expected_change_no,req.params.recordId,b.procedural_element_id,b.code,b.position,b.instruction_text,b.confirmation_required])).rows[0].data);
  });

  app.delete("/versions/:id/requirements/instructions/:recordId", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id, recordId: Id }),
      querystring: Type.Object({ expected_change_no: Expected }, { additionalProperties: false }), response: { 200: Change } },
  }, async req => persoonlijkeTransactie(app.db,req,async tx =>
    (await tx.query("SELECT recipe_delete_instruction($1,$2,$3) AS change_no",
      [req.params.id,req.query.expected_change_no,req.params.recordId])).rows[0]));

  app.post("/versions/:id/requirements/specification-links", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id }), body: SpecificationLinkBody, response: { 201: ChangedId } },
  }, async (req,reply) => {
    const b=req.body;
    const result=await persoonlijkeTransactie(app.db,req,async tx =>
      (await tx.query("SELECT recipe_save_specification_link($1,$2,NULL,$3,$4,$5) AS data",
        [req.params.id,b.expected_change_no,b.parameter_limit_id,b.code,b.description])).rows[0].data);
    return reply.code(201).send(result);
  });

  app.patch("/versions/:id/requirements/specification-links/:recordId", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id, recordId: Id }), body: SpecificationLinkBody, response: { 200: ChangedId } },
  }, async req => {
    const b=req.body;
    return persoonlijkeTransactie(app.db,req,async tx =>
      (await tx.query("SELECT recipe_save_specification_link($1,$2,$3,$4,$5,$6) AS data",
        [req.params.id,b.expected_change_no,req.params.recordId,b.parameter_limit_id,b.code,b.description])).rows[0].data);
  });

  app.delete("/versions/:id/requirements/specification-links/:recordId", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id, recordId: Id }),
      querystring: Type.Object({ expected_change_no: Expected }, { additionalProperties: false }), response: { 200: Change } },
  }, async req => persoonlijkeTransactie(app.db,req,async tx =>
    (await tx.query("SELECT recipe_delete_specification_link($1,$2,$3) AS change_no",
      [req.params.id,req.query.expected_change_no,req.params.recordId])).rows[0]));

  app.post("/versions/:id/requirements/lot-rules", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id }), body: LotRuleBody, response: { 201: ChangedId } },
  }, async (req,reply) => {
    const b=req.body;
    const result=await persoonlijkeTransactie(app.db,req,async tx =>
      (await tx.query("SELECT recipe_save_lot_rule($1,$2,NULL,$3,$4) AS data",
        [req.params.id,b.expected_change_no,b.nominal_batch_count,b.deviation_approval_required])).rows[0].data);
    return reply.code(201).send(result);
  });

  app.patch("/versions/:id/requirements/lot-rules/:recordId", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id, recordId: Id }), body: LotRuleBody, response: { 200: ChangedId } },
  }, async req => {
    const b=req.body;
    return persoonlijkeTransactie(app.db,req,async tx =>
      (await tx.query("SELECT recipe_save_lot_rule($1,$2,$3,$4,$5) AS data",
        [req.params.id,b.expected_change_no,req.params.recordId,b.nominal_batch_count,b.deviation_approval_required])).rows[0].data);
  });

  app.delete("/versions/:id/requirements/lot-rules/:recordId", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id, recordId: Id }),
      querystring: Type.Object({ expected_change_no: Expected }, { additionalProperties: false }), response: { 200: Change } },
  }, async req => persoonlijkeTransactie(app.db,req,async tx =>
    (await tx.query("SELECT recipe_delete_lot_rule($1,$2,$3) AS change_no",
      [req.params.id,req.query.expected_change_no,req.params.recordId])).rows[0]));

  app.post("/versions/:id/requirements/compatibility-rules", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id }), body: CompatibilityRuleBody, response: { 201: ChangedId } },
  }, async (req,reply) => {
    const b=req.body;
    const result=await persoonlijkeTransactie(app.db,req,async tx =>
      (await tx.query("SELECT recipe_save_compatibility_rule($1,$2,NULL,$3,$4) AS data",
        [req.params.id,b.expected_change_no,b.other_recipe_version_id,b.reason])).rows[0].data);
    return reply.code(201).send(result);
  });

  app.patch("/versions/:id/requirements/compatibility-rules/:recordId", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id, recordId: Id }), body: CompatibilityRuleBody, response: { 200: ChangedId } },
  }, async req => {
    const b=req.body;
    return persoonlijkeTransactie(app.db,req,async tx =>
      (await tx.query("SELECT recipe_save_compatibility_rule($1,$2,$3,$4,$5) AS data",
        [req.params.id,b.expected_change_no,req.params.recordId,b.other_recipe_version_id,b.reason])).rows[0].data);
  });

  app.delete("/versions/:id/requirements/compatibility-rules/:recordId", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id, recordId: Id }),
      querystring: Type.Object({ expected_change_no: Expected }, { additionalProperties: false }), response: { 200: Change } },
  }, async req => persoonlijkeTransactie(app.db,req,async tx =>
    (await tx.query("SELECT recipe_delete_compatibility_rule($1,$2,$3) AS change_no",
      [req.params.id,req.query.expected_change_no,req.params.recordId])).rows[0]));

  app.get("/versions/:id/scaling", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id }), response: { 200: ScalingContent } },
  }, async req => persoonlijkeTransactie(app.db,req,async tx =>
    (await tx.query(scalingSql,[req.params.id])).rows[0].data));

  app.post("/versions/:id/scaling/rules", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id }), body: ScalingRuleBody, response: { 201: ChangedId } },
  }, async (req,reply) => {
    const b=req.body;
    const result=await persoonlijkeTransactie(app.db,req,async tx =>
      (await tx.query("SELECT recipe_save_scaling_rule($1,$2,NULL,$3,$4,$5,$6,$7,$8) AS data",
        [req.params.id,b.expected_change_no,b.code,b.description,b.rule_kind,b.output_unit_id,b.source_reference,b.applicability])).rows[0].data);
    return reply.code(201).send(result);
  });

  app.patch("/versions/:id/scaling/rules/:recordId", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id, recordId: Id }), body: ScalingRuleBody, response: { 200: ChangedId } },
  }, async req => {
    const b=req.body;
    return persoonlijkeTransactie(app.db,req,async tx =>
      (await tx.query("SELECT recipe_save_scaling_rule($1,$2,$3,$4,$5,$6,$7,$8,$9) AS data",
        [req.params.id,b.expected_change_no,req.params.recordId,b.code,b.description,b.rule_kind,b.output_unit_id,b.source_reference,b.applicability])).rows[0].data);
  });

  app.delete("/versions/:id/scaling/rules/:recordId", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id, recordId: Id }),
      querystring: Type.Object({ expected_change_no: Expected }, { additionalProperties: false }), response: { 200: Change } },
  }, async req => persoonlijkeTransactie(app.db,req,async tx =>
    (await tx.query("SELECT recipe_delete_scaling_rule($1,$2,$3) AS change_no",
      [req.params.id,req.query.expected_change_no,req.params.recordId])).rows[0]));

  app.post("/versions/:id/scaling/linked-equipment-inputs", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id }), body: LinkedScalingInputBody, response: { 201: ChangedId } },
  }, async (req,reply) => {
    const b=req.body;
    const result=await persoonlijkeTransactie(app.db,req,async tx =>
      (await tx.query("SELECT recipe_save_scaling_input_linked($1,$2,NULL,$3,$4,$5) AS data",
        [req.params.id,b.expected_change_no,b.rule_id,b.code,b.equipment_property_definition_id])).rows[0].data);
    return reply.code(201).send(result);
  });

  app.patch("/versions/:id/scaling/linked-equipment-inputs/:recordId", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id, recordId: Id }), body: LinkedScalingInputBody, response: { 200: ChangedId } },
  }, async req => {
    const b=req.body;
    return persoonlijkeTransactie(app.db,req,async tx =>
      (await tx.query("SELECT recipe_save_scaling_input_linked($1,$2,$3,$4,$5,$6) AS data",
        [req.params.id,b.expected_change_no,req.params.recordId,b.rule_id,b.code,b.equipment_property_definition_id])).rows[0].data);
  });

  app.post("/versions/:id/scaling/inputs", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id }), body: ScalingInputBody, response: { 201: ChangedId } },
  }, async (req,reply) => {
    const b=req.body;
    const result=await persoonlijkeTransactie(app.db,req,async tx =>
      (await tx.query("SELECT recipe_save_scaling_input($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10) AS data",
        [req.params.id,b.expected_change_no,b.rule_id,b.code,b.source_kind,b.parameter_id,b.equipment_property,b.constant_value,b.unit_id,b.conversion_version_id])).rows[0].data);
    return reply.code(201).send(result);
  });

  app.patch("/versions/:id/scaling/inputs/:recordId", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id, recordId: Id }), body: ScalingInputBody, response: { 200: ChangedId } },
  }, async req => {
    const b=req.body;
    return persoonlijkeTransactie(app.db,req,async tx =>
      (await tx.query("SELECT recipe_save_scaling_input($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS data",
        [req.params.id,b.expected_change_no,req.params.recordId,b.rule_id,b.code,b.source_kind,b.parameter_id,b.equipment_property,b.constant_value,b.unit_id,b.conversion_version_id])).rows[0].data);
  });

  app.delete("/versions/:id/scaling/inputs/:recordId", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id, recordId: Id }),
      querystring: Type.Object({ expected_change_no: Expected }, { additionalProperties: false }), response: { 200: Change } },
  }, async req => persoonlijkeTransactie(app.db,req,async tx =>
    (await tx.query("SELECT recipe_delete_scaling_input($1,$2,$3) AS change_no",
      [req.params.id,req.query.expected_change_no,req.params.recordId])).rows[0]));

  app.post("/versions/:id/scaling/bindings", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id }), body: ScalingBindingBody, response: { 201: ChangedId } },
  }, async (req,reply) => {
    const b=req.body;
    const result=await persoonlijkeTransactie(app.db,req,async tx =>
      (await tx.query("SELECT recipe_save_scaling_binding($1,$2,NULL,$3,$4,$5) AS data",
        [req.params.id,b.expected_change_no,b.rule_id,b.parameter_limit_id,b.material_requirement_id])).rows[0].data);
    return reply.code(201).send(result);
  });

  app.patch("/versions/:id/scaling/bindings/:recordId", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id, recordId: Id }), body: ScalingBindingBody, response: { 200: ChangedId } },
  }, async req => {
    const b=req.body;
    return persoonlijkeTransactie(app.db,req,async tx =>
      (await tx.query("SELECT recipe_save_scaling_binding($1,$2,$3,$4,$5,$6) AS data",
        [req.params.id,b.expected_change_no,req.params.recordId,b.rule_id,b.parameter_limit_id,b.material_requirement_id])).rows[0].data);
  });

  app.delete("/versions/:id/scaling/bindings/:recordId", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id, recordId: Id }),
      querystring: Type.Object({ expected_change_no: Expected }, { additionalProperties: false }), response: { 200: Change } },
  }, async req => persoonlijkeTransactie(app.db,req,async tx =>
    (await tx.query("SELECT recipe_delete_scaling_binding($1,$2,$3) AS change_no",
      [req.params.id,req.query.expected_change_no,req.params.recordId])).rows[0]));

  // One expression per rule; PUT replaces its complete token list.
  // Explicit JSON serialization is necessary: node-postgres otherwise encodes arrays as SQL arrays.
  app.put("/versions/:id/scaling/rules/:ruleId/expression", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id, ruleId: Id }), body: ExpressionBody, response: { 200: ChangedId } },
  }, async req => persoonlijkeTransactie(app.db,req,async tx =>
    (await tx.query("SELECT recipe_save_scaling_expression($1,$2,$3,$4::jsonb) AS data",
      [req.params.id,req.body.expected_change_no,req.params.ruleId,JSON.stringify(req.body.tokens)])).rows[0].data));

  app.delete("/versions/:id/scaling/rules/:ruleId/expression", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id, ruleId: Id }),
      querystring: Type.Object({ expected_change_no: Expected }, { additionalProperties: false }), response: { 200: Change } },
  }, async req => persoonlijkeTransactie(app.db,req,async tx =>
    (await tx.query("SELECT recipe_delete_scaling_expression($1,$2,$3) AS change_no",
      [req.params.id,req.query.expected_change_no,req.params.ruleId])).rows[0]));


  // MOC concept and exact comparison.
  app.get("/versions/:id/moc", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id }), response: { 200: MOCContent } },
  }, async req => persoonlijkeTransactie(app.db,req,async tx =>
    (await tx.query("SELECT recipe_change_list($1) AS data",[req.params.id])).rows[0].data));

  app.post("/versions/:id/moc", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id }), body: MOCBody, response: { 201: ChangedId } },
  }, async (req,reply) => {
    const b=req.body;
    const result=await persoonlijkeTransactie(app.db,req,async tx =>
      (await tx.query("SELECT recipe_create_change_request($1,$2,$3,$4,$5) AS data",
        [req.params.id,b.expected_change_no,b.baseline_version_id,b.reason,b.impact_description])).rows[0].data);
    return reply.code(201).send(result);
  });

  app.patch("/versions/:id/moc/:recordId", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id, recordId: Id }), body: MOCUpdate, response: { 200: ChangedId } },
  }, async req => persoonlijkeTransactie(app.db,req,async tx =>
    (await tx.query("SELECT recipe_update_change_request($1,$2,$3,$4,$5) AS data",
      [req.params.id,req.body.expected_change_no,req.params.recordId,req.body.reason,req.body.impact_description])).rows[0].data));

  app.post("/versions/:id/moc/impacts", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id }), body: ImpactBody, response: { 201: ChangedId } },
  }, async (req,reply) => {
    const b=req.body;
    const result=await persoonlijkeTransactie(app.db,req,async tx =>
      (await tx.query("SELECT recipe_save_change_impact($1,$2,NULL,$3,$4,$5) AS data",
        [req.params.id,b.expected_change_no,b.request_id,b.area,b.explanation])).rows[0].data);
    return reply.code(201).send(result);
  });

  app.patch("/versions/:id/moc/impacts/:recordId", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id, recordId: Id }), body: ImpactBody, response: { 200: ChangedId } },
  }, async req => persoonlijkeTransactie(app.db,req,async tx =>
    (await tx.query("SELECT recipe_save_change_impact($1,$2,$3,$4,$5,$6) AS data",
      [req.params.id,req.body.expected_change_no,req.params.recordId,req.body.request_id,req.body.area,req.body.explanation])).rows[0].data));

  app.delete("/versions/:id/moc/impacts/:recordId", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id, recordId: Id }),
      querystring: Type.Object({ expected_change_no: Expected }, { additionalProperties: false }), response: { 200: Change } },
  }, async req => persoonlijkeTransactie(app.db,req,async tx =>
    (await tx.query("SELECT recipe_delete_change_impact($1,$2,$3) AS change_no",
      [req.params.id,req.query.expected_change_no,req.params.recordId])).rows[0]));

  app.get("/versions/:id/moc/comparison", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id }), response: { 200: Comparison } },
  }, async req => persoonlijkeTransactie(app.db,req,async tx =>
    (await tx.query("SELECT recipe_compare_change($1)::text AS comparison_text",[req.params.id])).rows[0]));

  app.get("/versions/:id/review-requirements", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id }), response: { 200: ReviewRequirements } },
  }, async req => persoonlijkeTransactie(app.db,req,async tx =>
    (await tx.query("SELECT recipe_review_requirements($1) AS data",[req.params.id])).rows[0].data));

  app.get("/reviews", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], querystring: Type.Object({ product_id: Id }, { additionalProperties: false }), response: { 200: Inbox } },
  }, async req => persoonlijkeTransactie(app.db,req,async tx =>
    (await tx.query("SELECT recipe_review_inbox($1) AS data",[req.query.product_id])).rows[0].data));

  app.get("/reviews/:roundId", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ roundId: Id }), response: { 200: Dossier } },
  }, async req => persoonlijkeTransactie(app.db,req,async tx =>
    (await tx.query("SELECT recipe_review_dossier($1) AS data",[req.params.roundId])).rows[0].data));

  app.post("/versions/:id/reviews", {
    // AJV coerceert een null in een integer-first anyOf naar 0. Een initiële
    // beoordeling heeft juist geen referentierevisie; 0 is een echte teller.
    preValidation: async req => {
      const value = req.body?.expected_baseline_change_no;
      if (value !== null && (typeof value !== "number" || !Number.isInteger(value))) {
        throw new ApiFout(400,"Referentiewijzigingsteller moet een geheel getal of null zijn");
      }
    },
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id }), body: SubmitReview, response: { 201: SubmitResult } },
  }, async (req,reply) => {
    const b=req.body;
    const result=await persoonlijkeTransactie(app.db,req,async tx =>
      (await tx.query("SELECT recipe_submit_review_confirmed($1,$2,$3,$4) AS data",
        [req.params.id,b.expected_change_no,b.expected_baseline_change_no,b.password])).rows[0].data);
    confirmedReviewResult(result);
    return reply.code(201).send(result);
  });

  app.post("/reviews/:roundId/decisions", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ roundId: Id }), body: DecideReview, response: { 201: DecideResult } },
  }, async (req,reply) => {
    const b=req.body;
    const result=await persoonlijkeTransactie(app.db,req,async tx =>
      (await tx.query("SELECT recipe_decide_review_confirmed($1,$2,$3,$4,$5,$6) AS data",
        [req.params.roundId,b.expected_change_no,b.domain,b.decision,b.reason,b.password])).rows[0].data);
    confirmedReviewResult(result);
    return reply.code(201).send(result);
  });


  app.get("/versions/:id/release-validation", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id }), response: { 200: ReleaseValidation } },
  }, async req => persoonlijkeTransactie(app.db,req,async tx =>
    (await tx.query("SELECT recipe_release_validation($1) AS data",[req.params.id])).rows[0].data));

  app.post("/versions/:id/releases", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ id: Id }), body: ReleaseBody, response: { 201: ReleaseResult } },
  }, async (req,reply) => {
    const b=req.body;
    const result=await persoonlijkeTransactie(app.db,req,async tx =>
      (await tx.query("SELECT recipe_release_confirmed($1,$2,$3,$4::timestamptz,$5,$6) AS data",
        [req.params.id,b.round_id,b.expected_change_no,b.effective_from,b.reason,b.password])).rows[0].data);
    confirmedReviewResult(result);
    return reply.code(201).send(result);
  });

  app.post("/releases/:releaseId/withdrawals", {
    preHandler: personalSession,
    schema: { tags: ["recepten"], params: Type.Object({ releaseId: Id }), body: WithdrawBody, response: { 201: WithdrawResult } },
  }, async (req,reply) => {
    const result=await persoonlijkeTransactie(app.db,req,async tx =>
      (await tx.query("SELECT recipe_withdraw_confirmed($1,$2,$3) AS data",
        [req.params.releaseId,req.body.reason,req.body.password])).rows[0].data);
    confirmedReviewResult(result);
    return reply.code(201).send(result);
  });

};
export default routes;
