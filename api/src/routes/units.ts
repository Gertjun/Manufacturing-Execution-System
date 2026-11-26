import { Type, type FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { persoonlijkeTransactie } from "../auth.js";
import { personalSession } from "../modules/authorization/access.js";

const Id = Type.String({ format: "uuid" });
const Code = Type.String({ minLength: 1, maxLength: 100, pattern: "\\S" });
const Name = Type.String({ minLength: 1, maxLength: 250, pattern: "\\S" });
const Symbol = Type.String({ minLength: 1, maxLength: 40, pattern: "\\S" });
const Semantics = Type.Union([Type.Literal("ratio"), Type.Literal("absolute"), Type.Literal("difference")]);
const Exponent = Type.Integer({ minimum: -32768, maximum: 32767 });
// Exacte decimale tekst voorkomt IEEE-754-afronding op de HTTP-grens.
const Decimal = Type.String({ minLength: 1, maxLength: 100, pattern: "^-?[0-9]+(\\.[0-9]+)?$" });
const Source = Type.String({ minLength: 1, maxLength: 2000, pattern: "\\S" });
const Revision = Type.Integer({ minimum: 1, maximum: 2147483646 });
const Result = Type.Object({ id: Id });
const DimensionFields = {
  length_exp: Exponent, mass_exp: Exponent, time_exp: Exponent,
  current_exp: Exponent, temperature_exp: Exponent, amount_exp: Exponent, luminous_exp: Exponent,
};
const KindFields = { dimension_id: Id, code: Code, name: Name, value_semantics: Semantics };
const UnitFields = { quantity_kind_id: Id, code: Code, symbol: Symbol, name: Name };
const ConversionFields = { from_unit_id: Id, to_unit_id: Id };
const FactorFields = { factor_numerator: Decimal, factor_denominator: Decimal, additive_offset: Decimal, source_reference: Source };
const Catalog = Type.Object({
  dimensions: Type.Array(Type.Object({ id: Id, ...DimensionFields })),
  quantity_kinds: Type.Array(Type.Object({ id: Id, ...KindFields })),
  units: Type.Array(Type.Object({ id: Id, ...UnitFields })),
  conversions: Type.Array(Type.Object({ id: Id, quantity_kind_id: Id, ...ConversionFields })),
  versions: Type.Array(Type.Object({ id: Id, conversion_id: Id, quantity_kind_id: Id, value_semantics: Semantics,
    revision: Type.Integer({ minimum: 1 }), ...FactorFields, created_by: Id, created_at: Type.String() })),
});

// jsonb-getallen worden door de pg-driver als JavaScript-getal gelezen.
// Zet exacte conversiefactoren daarom in PostgreSQL om naar tekst vóór transport.
const catalogSql = (scoped: boolean) => `WITH c AS (SELECT ${scoped ? "recipe_unit_catalog_list($1)" : "unit_catalog_list()"} AS data)
 SELECT jsonb_set(data,'{versions}',COALESCE((
   SELECT jsonb_agg(v || jsonb_build_object(
     'factor_numerator',v->>'factor_numerator',
     'factor_denominator',v->>'factor_denominator',
     'additive_offset',v->>'additive_offset') ORDER BY v->>'conversion_id',(v->>'revision')::integer)
   FROM jsonb_array_elements(data->'versions') v
 ),'[]'::jsonb)) AS data FROM c`;

const routes: FastifyPluginAsyncTypebox = async app => {
  app.get("/", {
    preHandler: personalSession,
    schema: { tags: ["eenheden"], response: { 200: Catalog } },
  }, async req => persoonlijkeTransactie(app.db,req,async tx =>
    (await tx.query(catalogSql(false))).rows[0].data));
  app.get("/for-product/:productId", {
    preHandler: personalSession,
    schema: { tags: ["eenheden"], params: Type.Object({ productId: Id }), response: { 200: Catalog } },
  }, async req => persoonlijkeTransactie(app.db,req,async tx =>
    (await tx.query(catalogSql(true),[req.params.productId])).rows[0].data));

  app.post("/dimensions", {
    preHandler: personalSession,
    schema: { tags: ["eenheden"], body: Type.Object(DimensionFields,{ additionalProperties:false }), response: { 201: Result } },
  }, async (req,reply) => {
    const b=req.body;
    const result=await persoonlijkeTransactie(app.db,req,async tx =>
      (await tx.query("SELECT unit_catalog_create_dimension($1,$2,$3,$4,$5,$6,$7) AS id",
        [b.length_exp,b.mass_exp,b.time_exp,b.current_exp,b.temperature_exp,b.amount_exp,b.luminous_exp])).rows[0]);
    return reply.code(201).send(result as {id:string});
  });
  app.post("/quantity-kinds", {
    preHandler: personalSession,
    schema: { tags: ["eenheden"], body: Type.Object(KindFields,{ additionalProperties:false }), response: { 201: Result } },
  }, async (req,reply) => {
    const b=req.body;
    const result=await persoonlijkeTransactie(app.db,req,async tx =>
      (await tx.query("SELECT unit_catalog_create_kind($1,$2,$3,$4) AS id",[b.dimension_id,b.code,b.name,b.value_semantics])).rows[0]);
    return reply.code(201).send(result as {id:string});
  });
  app.post("/units", {
    preHandler: personalSession,
    schema: { tags: ["eenheden"], body: Type.Object(UnitFields,{ additionalProperties:false }), response: { 201: Result } },
  }, async (req,reply) => {
    const b=req.body;
    const result=await persoonlijkeTransactie(app.db,req,async tx =>
      (await tx.query("SELECT unit_catalog_create_unit($1,$2,$3,$4) AS id",[b.quantity_kind_id,b.code,b.symbol,b.name])).rows[0]);
    return reply.code(201).send(result as {id:string});
  });
  app.post("/conversions", {
    preHandler: personalSession,
    schema: { tags: ["eenheden"], body: Type.Object({...ConversionFields,...FactorFields},{ additionalProperties:false }), response: { 201: Result } },
  }, async (req,reply) => {
    const b=req.body;
    const result=await persoonlijkeTransactie(app.db,req,async tx =>
      (await tx.query("SELECT unit_catalog_create_conversion($1,$2,$3,$4,$5,$6) AS id",
        [b.from_unit_id,b.to_unit_id,b.factor_numerator,b.factor_denominator,b.additive_offset,b.source_reference])).rows[0]);
    return reply.code(201).send(result as {id:string});
  });
  app.post("/conversions/:id/versions", {
    preHandler: personalSession,
    schema: { tags: ["eenheden"], params: Type.Object({id:Id}),
      body: Type.Object({expected_revision:Revision,...FactorFields},{ additionalProperties:false }), response: { 201: Result } },
  }, async (req,reply) => {
    const b=req.body;
    const result=await persoonlijkeTransactie(app.db,req,async tx =>
      (await tx.query("SELECT unit_catalog_append_conversion($1,$2,$3,$4,$5,$6) AS id",
        [req.params.id,b.expected_revision,b.factor_numerator,b.factor_denominator,b.additive_offset,b.source_reference])).rows[0]);
    return reply.code(201).send(result as {id:string});
  });
};
export default routes;
