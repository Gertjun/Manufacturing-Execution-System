-- Migratie 0156: expliciete middelklasse-identiteit in receptvereisten (#116.3a).
SET search_path = fabriek, public;

-- Geen backfill op basis van codes, geen wijziging van historische records.
-- NULL betekent niet gekoppeld; de bestaande vrijgaveblokkade blijft actief.
ALTER TABLE equipment_class ADD CONSTRAINT equipment_class_id_code_key UNIQUE (id,code);
ALTER TABLE recipe_equipment_requirement ADD COLUMN equipment_class_id uuid;
ALTER TABLE recipe_equipment_requirement ADD CONSTRAINT recipe_equipment_requirement_class_fk
    FOREIGN KEY (equipment_class_id,equipment_class_code) REFERENCES equipment_class(id,code);
CREATE INDEX recipe_equipment_requirement_class_idx ON recipe_equipment_requirement(equipment_class_id);

-- Bestaande lifecycle- en audittriggers blijven van toepassing.
-- Laat de nieuwe sleutel bij NULL weg uit historisch vergelijkings-/reviewbewijs,
-- zodat oude snapshots exact gelijk blijven; expliciete koppelingen tellen wel mee.
CREATE OR REPLACE FUNCTION recipe_comparison_rows(p_version uuid)
RETURNS TABLE(area text, entity text, item_key text, content jsonb)
LANGUAGE sql STABLE SET search_path=pg_catalog,fabriek,pg_temp AS $$
 SELECT 'header'::text,'master_recipe_version'::text,'header'::text,jsonb_build_object('name',v.name,'description',v.description)
 FROM master_recipe_version v WHERE v.id=p_version
 UNION ALL
 SELECT 'procedure'::text,'recipe_procedural_element'::text,(x.code)::text,(to_jsonb(x)-ARRAY['id','recipe_version_id','parent_id']) || jsonb_build_object('parent_code',(SELECT code FROM recipe_procedural_element WHERE id=x.parent_id)) FROM recipe_procedural_element x WHERE x.recipe_version_id=p_version
 UNION ALL
 SELECT 'procedure'::text,'recipe_dependency'::text,(jsonb_build_array((SELECT code FROM recipe_procedural_element WHERE id=x.predecessor_id),(SELECT code FROM recipe_procedural_element WHERE id=x.successor_id))::text)::text,(to_jsonb(x)-ARRAY['id','recipe_version_id','predecessor_id','successor_id']) || jsonb_build_object('predecessor_code',(SELECT code FROM recipe_procedural_element WHERE id=x.predecessor_id),'successor_code',(SELECT code FROM recipe_procedural_element WHERE id=x.successor_id)) FROM recipe_dependency x WHERE x.recipe_version_id=p_version
 UNION ALL
 SELECT 'parameters'::text,'recipe_parameter'::text,(x.code)::text,(to_jsonb(x)-ARRAY['id','recipe_version_id','procedural_element_id']) || jsonb_build_object('element_code',(SELECT code FROM recipe_procedural_element WHERE id=x.procedural_element_id)) FROM recipe_parameter x WHERE x.recipe_version_id=p_version
 UNION ALL
 SELECT 'parameters'::text,'recipe_parameter_limit'::text,(jsonb_build_array((SELECT code FROM recipe_parameter WHERE id=x.parameter_id),x.category)::text)::text,(to_jsonb(x)-ARRAY['id','recipe_version_id','parameter_id']) || jsonb_build_object('parameter_code',(SELECT code FROM recipe_parameter WHERE id=x.parameter_id)) FROM recipe_parameter_limit x WHERE x.recipe_version_id=p_version
 UNION ALL
 SELECT 'formula'::text,'recipe_formula'::text,('reference')::text,(to_jsonb(x)-ARRAY['id','recipe_version_id']) FROM recipe_formula x WHERE x.recipe_version_id=p_version
 UNION ALL
 SELECT 'materials'::text,'recipe_material_requirement'::text,(x.code)::text,(to_jsonb(x)-ARRAY['id','recipe_version_id','formula_id','procedural_element_id']) || jsonb_build_object('element_code',(SELECT code FROM recipe_procedural_element WHERE id=x.procedural_element_id)) FROM recipe_material_requirement x WHERE x.recipe_version_id=p_version
 UNION ALL
 SELECT 'equipment'::text,'recipe_equipment_requirement'::text,(x.code)::text,((CASE WHEN x.equipment_class_id IS NULL THEN to_jsonb(x)-'equipment_class_id' ELSE to_jsonb(x) END)-ARRAY['id','recipe_version_id','procedural_element_id']) || jsonb_build_object('element_code',(SELECT code FROM recipe_procedural_element WHERE id=x.procedural_element_id)) FROM recipe_equipment_requirement x WHERE x.recipe_version_id=p_version
 UNION ALL
 SELECT 'personnel'::text,'recipe_personnel_requirement'::text,(x.code)::text,(to_jsonb(x)-ARRAY['id','recipe_version_id','procedural_element_id']) || jsonb_build_object('element_code',(SELECT code FROM recipe_procedural_element WHERE id=x.procedural_element_id)) FROM recipe_personnel_requirement x WHERE x.recipe_version_id=p_version
 UNION ALL
 SELECT 'instructions'::text,'recipe_instruction'::text,(x.code)::text,(to_jsonb(x)-ARRAY['id','recipe_version_id','procedural_element_id']) || jsonb_build_object('element_code',(SELECT code FROM recipe_procedural_element WHERE id=x.procedural_element_id)) FROM recipe_instruction x WHERE x.recipe_version_id=p_version
 UNION ALL
 SELECT 'quality'::text,'recipe_specification_link'::text,(x.code)::text,(to_jsonb(x)-ARRAY['id','recipe_version_id','parameter_limit_id']) || jsonb_build_object('parameter_limit',(SELECT jsonb_build_array(p.code,l.category) FROM recipe_parameter_limit l JOIN recipe_parameter p ON p.id=l.parameter_id WHERE l.id=x.parameter_limit_id)) FROM recipe_specification_link x WHERE x.recipe_version_id=p_version
 UNION ALL
 SELECT 'lot'::text,'recipe_lot_rule'::text,('norm')::text,(to_jsonb(x)-ARRAY['id','recipe_version_id']) FROM recipe_lot_rule x WHERE x.recipe_version_id=p_version
 UNION ALL
 SELECT 'lot'::text,'recipe_compatibility_rule'::text,(x.other_recipe_version_id::text)::text,(to_jsonb(x)-ARRAY['id','recipe_version_id']) FROM recipe_compatibility_rule x WHERE x.recipe_version_id=p_version
 UNION ALL
 SELECT 'scaling'::text,'recipe_scaling_rule'::text,(x.code)::text,(to_jsonb(x)-ARRAY['id','recipe_version_id']) FROM recipe_scaling_rule x WHERE x.recipe_version_id=p_version
 UNION ALL
 SELECT 'scaling'::text,'recipe_scaling_input'::text,(jsonb_build_array((SELECT code FROM recipe_scaling_rule WHERE id=x.rule_id),x.code)::text)::text,(to_jsonb(x)-ARRAY['id','recipe_version_id','rule_id','parameter_id']) || jsonb_build_object('rule_code',(SELECT code FROM recipe_scaling_rule WHERE id=x.rule_id),'parameter_code',(SELECT code FROM recipe_parameter WHERE id=x.parameter_id)) FROM recipe_scaling_input x WHERE x.recipe_version_id=p_version
 UNION ALL
 SELECT 'scaling'::text,'recipe_scaling_binding'::text,(CASE WHEN x.parameter_limit_id IS NOT NULL THEN jsonb_build_array('parameter',(SELECT p.code FROM recipe_parameter_limit l JOIN recipe_parameter p ON p.id=l.parameter_id WHERE l.id=x.parameter_limit_id),(SELECT category FROM recipe_parameter_limit WHERE id=x.parameter_limit_id))::text ELSE jsonb_build_array('material',(SELECT code FROM recipe_material_requirement WHERE id=x.material_requirement_id))::text END)::text,(to_jsonb(x)-ARRAY['id','recipe_version_id','rule_id','parameter_limit_id','material_requirement_id']) || jsonb_build_object('rule_code',(SELECT code FROM recipe_scaling_rule WHERE id=x.rule_id)) FROM recipe_scaling_binding x WHERE x.recipe_version_id=p_version
 UNION ALL
 SELECT 'scaling'::text,'recipe_scaling_expression'::text,((SELECT code FROM recipe_scaling_rule WHERE id=x.rule_id))::text,(to_jsonb(x)-ARRAY['id','recipe_version_id','rule_id','tokens']) || jsonb_build_object('tokens',(SELECT jsonb_agg(CASE WHEN t.value->>'op'='input' THEN jsonb_build_object('op','input','code',(SELECT i.code FROM recipe_scaling_input i WHERE i.id=(t.value->>'id')::uuid AND i.rule_id=x.rule_id)) ELSE t.value END ORDER BY t.ordinality) FROM jsonb_array_elements(x.tokens) WITH ORDINALITY t(value,ordinality))) FROM recipe_scaling_expression x WHERE x.recipe_version_id=p_version
$$;

CREATE OR REPLACE FUNCTION recipe_review_snapshot(p_version uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,fabriek,pg_temp AS $$
 SELECT jsonb_build_object('header',to_jsonb(v)-'lifecycle_status',
 'recipe_procedural_element',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_procedural_element x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_dependency',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_dependency x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_parameter',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_parameter x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_parameter_limit',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_parameter_limit x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_formula',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_formula x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_material_requirement',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_material_requirement x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_equipment_requirement',COALESCE((SELECT jsonb_agg((CASE WHEN x.equipment_class_id IS NULL THEN to_jsonb(x)-'equipment_class_id' ELSE to_jsonb(x) END) ORDER BY x.id) FROM recipe_equipment_requirement x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_personnel_requirement',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_personnel_requirement x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_instruction',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_instruction x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_specification_link',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_specification_link x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_lot_rule',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_lot_rule x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_compatibility_rule',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_compatibility_rule x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_scaling_rule',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_scaling_rule x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_scaling_input',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_scaling_input x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_scaling_binding',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_scaling_binding x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_scaling_expression',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_scaling_expression x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_change_request',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_change_request x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_change_impact',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_change_impact x WHERE x.recipe_version_id=v.id),'[]'::jsonb)
 ) FROM master_recipe_version v WHERE v.id=p_version
$$;

-- Geen nieuwe app-mutatiefunctie, grants of vrijgave in deze slice.
