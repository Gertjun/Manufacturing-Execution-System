-- Migratie 0111: persoonlijk conceptbeheer van schaalregels (D106/#141).
SET search_path = fabriek, public;

-- Geen evaluatie of formule-engine. Alle wijzigingen vallen onder dezelfde
-- productscope, conceptlock en teller als de andere MBR-onderdelen.
CREATE FUNCTION recipe_scaling_list(p_version uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE product uuid; result jsonb;
BEGIN
 SELECT r.product_id INTO product FROM master_recipe_version v
 JOIN master_recipe r ON r.id=v.master_recipe_id WHERE v.id=p_version;
 PERFORM recipe_draft_actor(product);
 SELECT jsonb_build_object('change_no',v.change_no,
   'rules',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_scaling_rule x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
   'inputs',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_scaling_input x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
   'bindings',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_scaling_binding x WHERE x.recipe_version_id=v.id),'[]'::jsonb))
 INTO result FROM master_recipe_version v WHERE v.id=p_version;
 RETURN result;
END $$;

CREATE FUNCTION recipe_save_scaling_rule(p_version uuid,p_expected integer,p_id uuid,p_code text,p_description text,p_rule_kind text,p_output_unit_id uuid,p_source_reference text,p_applicability text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer; target uuid;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 IF p_id IS NULL THEN
   INSERT INTO recipe_scaling_rule(recipe_version_id,code,description,rule_kind,output_unit_id,source_reference,applicability)
   VALUES(p_version,p_code,p_description,p_rule_kind,p_output_unit_id,p_source_reference,p_applicability) RETURNING id INTO target;
 ELSE
   UPDATE recipe_scaling_rule SET code=p_code,description=p_description,rule_kind=p_rule_kind,output_unit_id=p_output_unit_id,source_reference=p_source_reference,applicability=p_applicability
   WHERE recipe_version_id=p_version AND id=p_id RETURNING id INTO target;
   IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende schaalregelinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN jsonb_build_object('id',target,'change_no',current_no+1);
END $$;

CREATE FUNCTION recipe_delete_scaling_rule(p_version uuid,p_expected integer,p_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 DELETE FROM recipe_scaling_rule WHERE recipe_version_id=p_version AND id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende schaalregelinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN current_no+1;
END $$;

CREATE FUNCTION recipe_save_scaling_input(p_version uuid,p_expected integer,p_id uuid,p_rule_id uuid,p_code text,p_source_kind text,p_parameter_id uuid,p_equipment_property text,p_constant_value numeric,p_unit_id uuid,p_conversion_version_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer; target uuid;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 IF p_id IS NULL THEN
   INSERT INTO recipe_scaling_input(recipe_version_id,rule_id,code,source_kind,parameter_id,equipment_property,constant_value,unit_id,conversion_version_id)
   VALUES(p_version,p_rule_id,p_code,p_source_kind,p_parameter_id,p_equipment_property,p_constant_value,p_unit_id,p_conversion_version_id) RETURNING id INTO target;
 ELSE
   UPDATE recipe_scaling_input SET rule_id=p_rule_id,code=p_code,source_kind=p_source_kind,parameter_id=p_parameter_id,equipment_property=p_equipment_property,constant_value=p_constant_value,unit_id=p_unit_id,conversion_version_id=p_conversion_version_id
   WHERE recipe_version_id=p_version AND id=p_id RETURNING id INTO target;
   IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende schaalregelinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN jsonb_build_object('id',target,'change_no',current_no+1);
END $$;

CREATE FUNCTION recipe_delete_scaling_input(p_version uuid,p_expected integer,p_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 DELETE FROM recipe_scaling_input WHERE recipe_version_id=p_version AND id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende schaalregelinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN current_no+1;
END $$;

CREATE FUNCTION recipe_save_scaling_binding(p_version uuid,p_expected integer,p_id uuid,p_rule_id uuid,p_parameter_limit_id uuid,p_material_requirement_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer; target uuid;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 IF p_id IS NULL THEN
   INSERT INTO recipe_scaling_binding(recipe_version_id,rule_id,parameter_limit_id,material_requirement_id)
   VALUES(p_version,p_rule_id,p_parameter_limit_id,p_material_requirement_id) RETURNING id INTO target;
 ELSE
   UPDATE recipe_scaling_binding SET rule_id=p_rule_id,parameter_limit_id=p_parameter_limit_id,material_requirement_id=p_material_requirement_id
   WHERE recipe_version_id=p_version AND id=p_id RETURNING id INTO target;
   IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende schaalregelinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN jsonb_build_object('id',target,'change_no',current_no+1);
END $$;

CREATE FUNCTION recipe_delete_scaling_binding(p_version uuid,p_expected integer,p_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 DELETE FROM recipe_scaling_binding WHERE recipe_version_id=p_version AND id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende schaalregelinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN current_no+1;
END $$;

REVOKE ALL ON FUNCTION recipe_scaling_list(uuid),
 recipe_save_scaling_rule(uuid,integer,uuid,text,text,text,uuid,text,text),
 recipe_delete_scaling_rule(uuid,integer,uuid),
 recipe_save_scaling_input(uuid,integer,uuid,uuid,text,text,uuid,text,numeric,uuid,uuid),
 recipe_delete_scaling_input(uuid,integer,uuid),
 recipe_save_scaling_binding(uuid,integer,uuid,uuid,uuid,uuid),
 recipe_delete_scaling_binding(uuid,integer,uuid) FROM PUBLIC;
