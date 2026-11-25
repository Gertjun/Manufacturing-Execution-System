-- Migratie 0109: persoonlijk conceptbeheer van receptvereisten en lotregels (#111).
SET search_path = fabriek, public;

CREATE FUNCTION recipe_requirements_list(p_version uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE product uuid; result jsonb;
BEGIN
 SELECT r.product_id INTO product FROM master_recipe_version v
 JOIN master_recipe r ON r.id=v.master_recipe_id WHERE v.id=p_version;
 PERFORM recipe_draft_actor(product);
 SELECT jsonb_build_object('change_no',v.change_no,
   'equipment_requirements',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_equipment_requirement x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
   'personnel_requirements',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_personnel_requirement x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
   'instructions',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_instruction x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
   'specification_links',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_specification_link x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
   'lot_rules',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_lot_rule x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
   'compatibility_rules',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_compatibility_rule x WHERE x.recipe_version_id=v.id),'[]'::jsonb)
 ) INTO result FROM master_recipe_version v WHERE v.id=p_version;
 RETURN result;
END $$;

CREATE FUNCTION recipe_save_equipment_requirement(p_version uuid,p_expected integer,p_id uuid,p_procedural_element_id uuid,p_code text,p_equipment_class_code text,p_description text,p_required_count integer,p_minimum_capacity numeric,p_capacity_unit_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer; target uuid;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 IF p_id IS NULL THEN
   INSERT INTO recipe_equipment_requirement(recipe_version_id,procedural_element_id,code,equipment_class_code,description,required_count,minimum_capacity,capacity_unit_id)
   VALUES(p_version,p_procedural_element_id,p_code,p_equipment_class_code,p_description,p_required_count,p_minimum_capacity,p_capacity_unit_id) RETURNING id INTO target;
 ELSE
   UPDATE recipe_equipment_requirement SET procedural_element_id=p_procedural_element_id,code=p_code,equipment_class_code=p_equipment_class_code,description=p_description,required_count=p_required_count,minimum_capacity=p_minimum_capacity,capacity_unit_id=p_capacity_unit_id
   WHERE recipe_version_id=p_version AND id=p_id RETURNING id INTO target;
   IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende receptinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN jsonb_build_object('id',target,'change_no',current_no+1);
END $$;

CREATE FUNCTION recipe_delete_equipment_requirement(p_version uuid,p_expected integer,p_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 DELETE FROM recipe_equipment_requirement WHERE recipe_version_id=p_version AND id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende receptinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN current_no+1;
END $$;

CREATE FUNCTION recipe_save_personnel_requirement(p_version uuid,p_expected integer,p_id uuid,p_procedural_element_id uuid,p_code text,p_qualification_code text,p_required_count integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer; target uuid; q_description text;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 SELECT description INTO q_description FROM qualification WHERE code=p_qualification_code FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende kwalificatie' USING ERRCODE='23503'; END IF;
 IF p_id IS NULL THEN
   INSERT INTO recipe_personnel_requirement(recipe_version_id,procedural_element_id,code,qualification_code,required_count,qualification_description)
   VALUES(p_version,p_procedural_element_id,p_code,p_qualification_code,p_required_count,q_description) RETURNING id INTO target;
 ELSE
   UPDATE recipe_personnel_requirement SET procedural_element_id=p_procedural_element_id,code=p_code,qualification_code=p_qualification_code,required_count=p_required_count,qualification_description=q_description
   WHERE recipe_version_id=p_version AND id=p_id RETURNING id INTO target;
   IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende receptinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN jsonb_build_object('id',target,'change_no',current_no+1);
END $$;

CREATE FUNCTION recipe_delete_personnel_requirement(p_version uuid,p_expected integer,p_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 DELETE FROM recipe_personnel_requirement WHERE recipe_version_id=p_version AND id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende receptinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN current_no+1;
END $$;

CREATE FUNCTION recipe_save_instruction(p_version uuid,p_expected integer,p_id uuid,p_procedural_element_id uuid,p_code text,p_position integer,p_instruction_text text,p_confirmation_required boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer; target uuid;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 IF p_id IS NULL THEN
   INSERT INTO recipe_instruction(recipe_version_id,procedural_element_id,code,position,instruction_text,confirmation_required)
   VALUES(p_version,p_procedural_element_id,p_code,p_position,p_instruction_text,p_confirmation_required) RETURNING id INTO target;
 ELSE
   UPDATE recipe_instruction SET procedural_element_id=p_procedural_element_id,code=p_code,position=p_position,instruction_text=p_instruction_text,confirmation_required=p_confirmation_required
   WHERE recipe_version_id=p_version AND id=p_id RETURNING id INTO target;
   IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende receptinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN jsonb_build_object('id',target,'change_no',current_no+1);
END $$;

CREATE FUNCTION recipe_delete_instruction(p_version uuid,p_expected integer,p_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 DELETE FROM recipe_instruction WHERE recipe_version_id=p_version AND id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende receptinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN current_no+1;
END $$;

CREATE FUNCTION recipe_save_specification_link(p_version uuid,p_expected integer,p_id uuid,p_parameter_limit_id uuid,p_code text,p_description text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer; target uuid;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 IF p_id IS NULL THEN
   INSERT INTO recipe_specification_link(recipe_version_id,parameter_limit_id,code,description)
   VALUES(p_version,p_parameter_limit_id,p_code,p_description) RETURNING id INTO target;
 ELSE
   UPDATE recipe_specification_link SET parameter_limit_id=p_parameter_limit_id,code=p_code,description=p_description
   WHERE recipe_version_id=p_version AND id=p_id RETURNING id INTO target;
   IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende receptinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN jsonb_build_object('id',target,'change_no',current_no+1);
END $$;

CREATE FUNCTION recipe_delete_specification_link(p_version uuid,p_expected integer,p_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 DELETE FROM recipe_specification_link WHERE recipe_version_id=p_version AND id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende receptinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN current_no+1;
END $$;

CREATE FUNCTION recipe_save_lot_rule(p_version uuid,p_expected integer,p_id uuid,p_nominal_batch_count integer,p_deviation_approval_required boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer; target uuid;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 IF p_id IS NULL THEN
   INSERT INTO recipe_lot_rule(recipe_version_id,nominal_batch_count,deviation_approval_required)
   VALUES(p_version,p_nominal_batch_count,p_deviation_approval_required) RETURNING id INTO target;
 ELSE
   UPDATE recipe_lot_rule SET nominal_batch_count=p_nominal_batch_count,deviation_approval_required=p_deviation_approval_required
   WHERE recipe_version_id=p_version AND id=p_id RETURNING id INTO target;
   IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende receptinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN jsonb_build_object('id',target,'change_no',current_no+1);
END $$;

CREATE FUNCTION recipe_delete_lot_rule(p_version uuid,p_expected integer,p_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 DELETE FROM recipe_lot_rule WHERE recipe_version_id=p_version AND id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende receptinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN current_no+1;
END $$;

CREATE FUNCTION recipe_save_compatibility_rule(p_version uuid,p_expected integer,p_id uuid,p_other_recipe_version_id uuid,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer; target uuid;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 IF p_id IS NULL THEN
   INSERT INTO recipe_compatibility_rule(recipe_version_id,other_recipe_version_id,reason)
   VALUES(p_version,p_other_recipe_version_id,p_reason) RETURNING id INTO target;
 ELSE
   UPDATE recipe_compatibility_rule SET other_recipe_version_id=p_other_recipe_version_id,reason=p_reason
   WHERE recipe_version_id=p_version AND id=p_id RETURNING id INTO target;
   IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende receptinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN jsonb_build_object('id',target,'change_no',current_no+1);
END $$;

CREATE FUNCTION recipe_delete_compatibility_rule(p_version uuid,p_expected integer,p_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 DELETE FROM recipe_compatibility_rule WHERE recipe_version_id=p_version AND id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende receptinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN current_no+1;
END $$;

REVOKE ALL ON FUNCTION recipe_requirements_list(uuid),
 recipe_save_equipment_requirement(uuid,integer,uuid,uuid,text,text,text,integer,numeric,uuid),
 recipe_delete_equipment_requirement(uuid,integer,uuid),
 recipe_save_personnel_requirement(uuid,integer,uuid,uuid,text,text,integer),
 recipe_delete_personnel_requirement(uuid,integer,uuid),
 recipe_save_instruction(uuid,integer,uuid,uuid,text,integer,text,boolean),
 recipe_delete_instruction(uuid,integer,uuid),
 recipe_save_specification_link(uuid,integer,uuid,uuid,text,text),
 recipe_delete_specification_link(uuid,integer,uuid),
 recipe_save_lot_rule(uuid,integer,uuid,integer,boolean),
 recipe_delete_lot_rule(uuid,integer,uuid),
 recipe_save_compatibility_rule(uuid,integer,uuid,uuid,text),
 recipe_delete_compatibility_rule(uuid,integer,uuid) FROM PUBLIC;
