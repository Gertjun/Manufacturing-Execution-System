import { Type, type FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { persoonlijkeTransactie } from "../auth.js";
import { personalSession } from "../modules/authorization/access.js";

const Id = Type.String({ format: "uuid" });
const NullId = Type.Unsafe<string | null>({ type: ["string", "null"], format: "uuid" });
const Code = Type.String({ minLength: 1, maxLength: 100, pattern: "\\S" });
const Name = Type.String({ minLength: 1, maxLength: 250, pattern: "\\S" });
const Level = Type.Union([Type.Literal("enterprise"), Type.Literal("site"), Type.Literal("area"), Type.Literal("cell"), Type.Literal("unit")]);
const Time = Type.String({ format: "date-time" });
const Change = Type.Integer({ minimum: 0, maximum: 2147483646 });
const Base = { id: Id, code: Code, name: Name, change_no: Change };
const Catalog = Type.Object({
  global: Type.Boolean(),
  hierarchy: Type.Array(Type.Object({ ...Base, level: Level, parent_id: NullId })),
  equipment: Type.Array(Type.Object({ ...Base, hierarchy_id: Id })),
  classes: Type.Array(Type.Object(Base)),
  assets: Type.Array(Type.Object(Base)),
  class_assignments: Type.Array(Type.Object({ id: Id, equipment_id: Id, equipment_class_id: Id })),
  asset_assignments: Type.Array(Type.Object({ id: Id, equipment_id: Id, physical_asset_id: Id, valid_from: Time, valid_until: Type.Union([Time, Type.Null()]) })),
});
const Mapping = Type.Object({
  areas: Type.Array(Type.Object({ id: Id, code: Code, name: Name })),
  equipment: Type.Array(Type.Object({ id: Id, code: Code, name: Name, hierarchy_id: Id })),
  area_scopes: Type.Array(Type.Object({ id: Id, area_code: Code, hierarchy_id: Id })),
  equipment_scopes: Type.Array(Type.Object({ id: Id, equipment_code: Code, equipment_id: Id })),
});
const Create = { code: Code, name: Name };
const Rename = Type.Object({ expected_change_no: Change, name: Name }, { additionalProperties: false });
const Params = Type.Object({ id: Id });
const Result = Type.Object({ id: Id });
const Changed = Type.Object({ change_no: Type.Integer({ minimum: 1 }) });
const tags = ["middelen"];
const strict = { additionalProperties: false } as const;

const NullText = Type.Union([Type.String(),Type.Null()]);
const NullTime = Type.Union([Time,Type.Null()]);
const Reason = Type.String({ minLength: 1, maxLength: 2000, pattern: "\\S" });
// Geen JSON-number: behoud exacte decimale waarde tot aan PostgreSQL.
const Decimal = Type.String({ minLength: 1, maxLength: 256, pattern: "^[+-]?[0-9]+(?:\\.[0-9]+)?$" });
const Revision = Type.Integer({ minimum: 1, maximum: 2147483647 });
const NextRevision = Type.Object({ revision: Revision });
const Status = Type.Union([Type.Literal("blocked"),Type.Literal("available")]);
const StatusEvidence = { revision: Revision, status: Status, reason: Reason, created_at: Time, created_by: Id, created_by_name: Type.String() };
const StatusRow = Type.Object({
  id: Id, code: Type.String(), name: Type.String(),
  revision: Type.Integer({ minimum: 0 }),
  status: Type.Union([Status,Type.Literal("unknown")]),
  reason: NullText, created_at: NullTime, created_by: NullId, created_by_name: NullText,
});
const Capabilities = Type.Object({
  global: Type.Boolean(),
  equipment: Type.Array(Type.Object({ ...Base, hierarchy_id: Id })),
  properties: Type.Array(Type.Object({ id: Id, code: Code, name: Name, quantity_kind_id: Id, measurement_unit_id: Id, unit: Type.String() })),
  capabilities: Type.Array(Type.Object({
    id: Id, equipment_id: Id, property_definition_id: Id,
    revision: Type.Union([Revision,Type.Null()]), value: NullText, reason: NullText, created_at: NullTime, capacity: Type.Boolean(),
  })),
});
const Workstations = Type.Object({
  workstations: Type.Array(Type.Object({ id: Id, name: Type.String(), location: NullText, active: Type.Boolean() })),
  equipment: Type.Array(Type.Object({ id: Id, code: Type.String(), name: Type.String() })),
  assignments: Type.Array(Type.Object({
    id: Id, pc_id: Id, equipment_id: Id, opened_at: Time, opened_by: Id, opened_by_name: Type.String(), open_reason: Reason,
    closed_at: NullTime, closed_by: NullId, closed_by_name: NullText, close_reason: NullText,
  })),
});

const routes: FastifyPluginAsyncTypebox = async app => {
  app.get("/capabilities", { preHandler: personalSession, schema: { tags, response: { 200: Capabilities } } },
    async req => persoonlijkeTransactie(app.db, req, async tx => (await tx.query("SELECT resource_capability_list() AS data")).rows[0].data));
  app.get("/statuses", { preHandler: personalSession, schema: { tags, response: { 200: Type.Array(StatusRow) } } },
    async req => persoonlijkeTransactie(app.db, req, async tx => (await tx.query("SELECT resource_status_list() AS data")).rows[0].data));
  app.get("/equipment/:id/status-history", { preHandler: personalSession, schema: { tags, params: Params, response: { 200: Type.Array(Type.Object(StatusEvidence)) } } },
    async req => persoonlijkeTransactie(app.db, req, async tx => (await tx.query("SELECT resource_status_history($1) AS data",[req.params.id])).rows[0].data));
  app.get("/workstations", { preHandler: personalSession, schema: { tags, response: { 200: Workstations } } },
    async req => persoonlijkeTransactie(app.db, req, async tx => (await tx.query("SELECT resource_workstation_list() AS data")).rows[0].data));

  app.post("/properties", { preHandler: personalSession, schema: { tags, body: Type.Object({ ...Create, quantity_kind_id: Id, measurement_unit_id: Id }, strict), response: { 201: Result } } },
    async (req,reply) => {
      const b=req.body;
      const r=await persoonlijkeTransactie(app.db,req,async tx => (await tx.query("SELECT resource_property_create($1,$2,$3,$4) AS id",[b.code,b.name,b.quantity_kind_id,b.measurement_unit_id])).rows[0]);
      return reply.code(201).send(r as {id:string});
    });
  app.post("/capabilities", { preHandler: personalSession, schema: { tags, body: Type.Object({ equipment_id: Id, property_definition_id: Id, value: Decimal, reason: Reason },strict), response: { 201: Result } } },
    async (req,reply) => {
      const b=req.body;
      const r=await persoonlijkeTransactie(app.db,req,async tx => (await tx.query("SELECT resource_capability_create($1,$2,$3::numeric,$4) AS id",[b.equipment_id,b.property_definition_id,b.value,b.reason])).rows[0]);
      return reply.code(201).send(r as {id:string});
    });
  app.post("/capabilities/:id/revisions", { preHandler: personalSession, schema: { tags, params: Params, body: Type.Object({ expected_revision: Revision, value: Decimal, reason: Reason },strict), response: { 200: NextRevision } } },
    async req => persoonlijkeTransactie(app.db,req,async tx => (await tx.query("SELECT resource_capability_revise($1,$2,$3::numeric,$4) AS revision",[req.params.id,req.body.expected_revision,req.body.value,req.body.reason])).rows[0]));
  app.post("/capabilities/:id/capacity", { preHandler: personalSession, schema: { tags, params: Params, body: Type.Object({ expected_revision: Revision },strict), response: { 201: Result } } },
    async (req,reply) => {
      const r=await persoonlijkeTransactie(app.db,req,async tx => (await tx.query("SELECT resource_capacity_designate($1,$2) AS id",[req.params.id,req.body.expected_revision])).rows[0]);
      return reply.code(201).send(r as {id:string});
    });
  app.post("/equipment/:id/status", { preHandler: personalSession, schema: { tags, params: Params, body: Type.Object({ expected_revision: Type.Integer({ minimum: 0, maximum: 2147483646 }), status: Status, reason: Reason },strict), response: { 200: NextRevision } } },
    async req => persoonlijkeTransactie(app.db,req,async tx => (await tx.query("SELECT resource_status_set($1,$2,$3,$4) AS revision",[req.params.id,req.body.expected_revision,req.body.status,req.body.reason])).rows[0]));
  app.post("/workstation-assignments", { preHandler: personalSession, schema: { tags, body: Type.Object({ pc_id: Id, equipment_id: Id, reason: Reason },strict), response: { 201: Result } } },
    async (req,reply) => {
      const b=req.body;
      const r=await persoonlijkeTransactie(app.db,req,async tx => (await tx.query("SELECT resource_workstation_open($1,$2,$3) AS id",[b.pc_id,b.equipment_id,b.reason])).rows[0]);
      return reply.code(201).send(r as {id:string});
    });
  app.post("/workstation-assignments/:id/close", { preHandler: personalSession, schema: { tags, params: Params, body: Type.Object({ reason: Reason },strict), response: { 200: Result } } },
    async req => persoonlijkeTransactie(app.db,req,async tx => (await tx.query("SELECT resource_workstation_close($1,$2) AS id",[req.params.id,req.body.reason])).rows[0]));

  // Geen actor, scope of rechten uit de HTTP-body. De persoonlijke transactie
  // bindt de identiteit; iedere DB-functie controleert de actuele doelcontext.
  app.get("/", { preHandler: personalSession, schema: { tags, response: { 200: Catalog } } },
    async req => persoonlijkeTransactie(app.db, req, async tx => (await tx.query("SELECT resource_catalog_list() AS data")).rows[0].data));
  app.get("/scopes", { preHandler: personalSession, schema: { tags, response: { 200: Mapping } } },
    async req => persoonlijkeTransactie(app.db, req, async tx => (await tx.query("SELECT resource_scope_list() AS data")).rows[0].data));

  app.post("/hierarchy", { preHandler: personalSession, schema: { tags, body: Type.Object({ ...Create, level: Level, parent_id: NullId }, strict), response: { 201: Result } } },
    async (req, reply) => {
      const b = req.body;
      const result = await persoonlijkeTransactie(app.db, req, async tx => (await tx.query("SELECT resource_hierarchy_create($1,$2,$3,$4) AS id", [b.code,b.name,b.level,b.parent_id])).rows[0]);
      return reply.code(201).send(result as {id:string});
    });
  app.post("/equipment", { preHandler: personalSession, schema: { tags, body: Type.Object({ ...Create, hierarchy_id: Id }, strict), response: { 201: Result } } },
    async (req, reply) => {
      const b = req.body;
      const result = await persoonlijkeTransactie(app.db, req, async tx => (await tx.query("SELECT resource_equipment_create($1,$2,$3) AS id", [b.code,b.name,b.hierarchy_id])).rows[0]);
      return reply.code(201).send(result as {id:string});
    });
  // Uitsluitend statische functie- en routekeuze; nooit SQL-identifiers uit clientinput.
  for (const [path, fn] of [["classes","class"],["assets","asset"]] as const) {
    app.post("/"+path, { preHandler: personalSession, schema: { tags, body: Type.Object(Create, strict), response: { 201: Result } } },
      async (req, reply) => {
        const b = req.body;
        const result = await persoonlijkeTransactie(app.db, req, async tx => (await tx.query("SELECT resource_"+fn+"_create($1,$2) AS id", [b.code,b.name])).rows[0]);
        return reply.code(201).send(result as {id:string});
      });
  }
  for (const [path, fn] of [["hierarchy","hierarchy"],["equipment","equipment"],["classes","class"],["assets","asset"]] as const) {
    app.patch("/"+path+"/:id", { preHandler: personalSession, schema: { tags, params: Params, body: Rename, response: { 200: Changed } } },
      async req => persoonlijkeTransactie(app.db, req, async tx => (await tx.query("SELECT resource_"+fn+"_rename($1,$2,$3) AS change_no", [req.params.id,req.body.expected_change_no,req.body.name])).rows[0]));
  }
  app.post("/class-assignments", { preHandler: personalSession, schema: { tags, body: Type.Object({ equipment_id: Id, equipment_class_id: Id }, strict), response: { 201: Result } } },
    async (req, reply) => {
      const b = req.body;
      const result = await persoonlijkeTransactie(app.db, req, async tx => (await tx.query("SELECT resource_class_assign($1,$2) AS id", [b.equipment_id,b.equipment_class_id])).rows[0]);
      return reply.code(201).send(result as {id:string});
    });
  app.post("/asset-assignments", { preHandler: personalSession, schema: { tags, body: Type.Object({ equipment_id: Id, physical_asset_id: Id, valid_from: Time }, strict), response: { 201: Result } } },
    async (req, reply) => {
      const b = req.body;
      const result = await persoonlijkeTransactie(app.db, req, async tx => (await tx.query("SELECT resource_asset_assign($1,$2,$3) AS id", [b.equipment_id,b.physical_asset_id,b.valid_from])).rows[0]);
      return reply.code(201).send(result as {id:string});
    });
  app.post("/asset-assignments/:id/close", { preHandler: personalSession, schema: { tags, params: Params, body: Type.Object({ valid_until: Time }, strict), response: { 200: Result } } },
    async req => persoonlijkeTransactie(app.db, req, async tx => (await tx.query("SELECT resource_asset_close($1,$2) AS id", [req.params.id,req.body.valid_until])).rows[0]));
  app.post("/scopes/areas", { preHandler: personalSession, schema: { tags, body: Type.Object({ area_code: Code, hierarchy_id: Id }, strict), response: { 201: Result } } },
    async (req, reply) => {
      const b = req.body;
      const result = await persoonlijkeTransactie(app.db, req, async tx => (await tx.query("SELECT resource_area_scope_create($1,$2) AS id", [b.area_code,b.hierarchy_id])).rows[0]);
      return reply.code(201).send(result as {id:string});
    });
  app.post("/scopes/equipment", { preHandler: personalSession, schema: { tags, body: Type.Object({ equipment_code: Code, equipment_id: Id }, strict), response: { 201: Result } } },
    async (req, reply) => {
      const b = req.body;
      const result = await persoonlijkeTransactie(app.db, req, async tx => (await tx.query("SELECT resource_equipment_scope_create($1,$2) AS id", [b.equipment_code,b.equipment_id])).rows[0]);
      return reply.code(201).send(result as {id:string});
    });
};
export default routes;
