-- Migratie 0117: inhoudelijke MBR-versievergelijking (#112).
SET search_path = fabriek, public;

-- Interne projectie: stabiele codes voor lokale verwijzingen, exacte
-- externe revisie/catalogus-ID's behouden. Geen impliciete conversie.
-- MOC-metadata, status, auteurs en tellers zijn geen receptinhoud.
CREATE FUNCTION recipe_comparison_rows(p_version uuid)
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
 SELECT 'equipment'::text,'recipe_equipment_requirement'::text,(x.code)::text,(to_jsonb(x)-ARRAY['id','recipe_version_id','procedural_element_id']) || jsonb_build_object('element_code',(SELECT code FROM recipe_procedural_element WHERE id=x.procedural_element_id)) FROM recipe_equipment_requirement x WHERE x.recipe_version_id=p_version
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

CREATE FUNCTION recipe_compare_change(p_version uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE product uuid; baseline uuid; baseline_no integer; current_no integer; result jsonb;
BEGIN
 SELECT r.product_id INTO product FROM master_recipe_version v JOIN master_recipe r ON r.id=v.master_recipe_id WHERE v.id=p_version;
 PERFORM recipe_draft_actor(product);
 -- Eén lockvolgorde voor beide versies, inclusief eerste lezing van
 -- onveranderlijke baselineverwijzing. Geen statusmutatie.
 SELECT baseline_version_id INTO baseline FROM recipe_change_request WHERE recipe_version_id=p_version;
 IF NOT FOUND THEN RAISE EXCEPTION 'MOC-dossier ontbreekt' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM master_recipe_version WHERE id=p_version OR id=baseline ORDER BY id FOR SHARE;
 SELECT change_no INTO current_no FROM master_recipe_version WHERE id=p_version;
 SELECT change_no INTO baseline_no FROM master_recipe_version WHERE id=baseline;
 WITH old_rows AS (SELECT * FROM recipe_comparison_rows(baseline)),
 new_rows AS (SELECT * FROM recipe_comparison_rows(p_version)),
 differences AS (
 SELECT COALESCE(n.area,o.area) AS area,COALESCE(n.entity,o.entity) AS entity,COALESCE(n.item_key,o.item_key) AS item_key,
 CASE WHEN o.item_key IS NULL THEN 'added' WHEN n.item_key IS NULL THEN 'removed' ELSE 'changed' END AS change,
 o.content AS before,n.content AS after
 FROM old_rows o FULL JOIN new_rows n USING(area,entity,item_key)
 WHERE o.content IS DISTINCT FROM n.content
 )
 SELECT jsonb_build_object('recipe_version_id',p_version,'change_no',current_no,'baseline_version_id',baseline,
 'baseline_change_no',baseline_no,'differences',COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.area,d.entity,d.item_key),'[]'::jsonb))
 INTO result FROM differences d;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION recipe_comparison_rows(uuid),recipe_compare_change(uuid) FROM PUBLIC;
-- Alleen vergelijking, geen goedkeuring, geen vrijgave of bewijs dat
-- handmatig opgegeven impact volledig is. Exacte snapshot volgt bij review.
