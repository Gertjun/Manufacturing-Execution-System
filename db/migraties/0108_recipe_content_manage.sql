-- Migratie 0108: persoonlijk, productgebonden parameter- en formulebeheer (#111/#141).
SET search_path = fabriek, public;

-- Alle conceptmutaties gebruiken dezelfde lock, actuele bevoegdheid en
-- verwachte change_no als procedure en header. Geen dynamische SQL.
CREATE OR REPLACE FUNCTION recipe_draft_actor(p_product uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid;
BEGIN
 actor:=execution_transaction_actor();
 IF p_product IS NULL OR authorization_permits(actor,'recipe.draft.manage',NULL,p_product,NULL) IS NOT TRUE THEN
   RAISE EXCEPTION 'Geen actuele MES-receptbevoegdheid' USING ERRCODE='42501';
 END IF;
 RETURN actor;
END $$;

CREATE FUNCTION recipe_content_list(p_version uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE product uuid; result jsonb;
BEGIN
 SELECT r.product_id INTO product FROM master_recipe_version v
 JOIN master_recipe r ON r.id=v.master_recipe_id WHERE v.id=p_version;
 PERFORM recipe_draft_actor(product);
 SELECT jsonb_build_object('change_no',v.change_no,
   'parameters',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_parameter x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
   'parameter_limits',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_parameter_limit x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
   'formulas',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_formula x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
   'material_requirements',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_material_requirement x WHERE x.recipe_version_id=v.id),'[]'::jsonb)
 ) INTO result FROM master_recipe_version v WHERE v.id=p_version;
 RETURN result;
END $$;

CREATE FUNCTION recipe_save_parameter(p_version uuid,p_expected integer,p_id uuid,p_procedural_element_id uuid,p_code text,p_name text,p_data_type text,p_unit text,p_frequency text,p_required boolean,p_responsible_activity text,p_critical boolean,p_measurement_unit_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer; target uuid;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 IF p_id IS NULL THEN
   INSERT INTO recipe_parameter(recipe_version_id,procedural_element_id,code,name,data_type,unit,frequency,required,responsible_activity,critical,measurement_unit_id)
   VALUES(p_version,p_procedural_element_id,p_code,p_name,p_data_type,p_unit,p_frequency,p_required,p_responsible_activity,p_critical,p_measurement_unit_id) RETURNING id INTO target;
 ELSE
   UPDATE recipe_parameter SET procedural_element_id=p_procedural_element_id,code=p_code,name=p_name,data_type=p_data_type,unit=p_unit,frequency=p_frequency,required=p_required,responsible_activity=p_responsible_activity,critical=p_critical,measurement_unit_id=p_measurement_unit_id
   WHERE recipe_version_id=p_version AND id=p_id RETURNING id INTO target;
   IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende receptinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN jsonb_build_object('id',target,'change_no',current_no+1);
END $$;

CREATE FUNCTION recipe_delete_parameter(p_version uuid,p_expected integer,p_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 DELETE FROM recipe_parameter WHERE recipe_version_id=p_version AND id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende receptinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN current_no+1;
END $$;

CREATE FUNCTION recipe_save_parameter_limit(p_version uuid,p_expected integer,p_id uuid,p_parameter_id uuid,p_data_type text,p_category text,p_target_value numeric,p_lower_value numeric,p_upper_value numeric,p_scaling text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer; target uuid;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 IF p_id IS NULL THEN
   INSERT INTO recipe_parameter_limit(recipe_version_id,parameter_id,data_type,category,target_value,lower_value,upper_value,scaling)
   VALUES(p_version,p_parameter_id,p_data_type,p_category,p_target_value,p_lower_value,p_upper_value,p_scaling) RETURNING id INTO target;
 ELSE
   UPDATE recipe_parameter_limit SET parameter_id=p_parameter_id,data_type=p_data_type,category=p_category,target_value=p_target_value,lower_value=p_lower_value,upper_value=p_upper_value,scaling=p_scaling
   WHERE recipe_version_id=p_version AND id=p_id RETURNING id INTO target;
   IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende receptinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN jsonb_build_object('id',target,'change_no',current_no+1);
END $$;

CREATE FUNCTION recipe_delete_parameter_limit(p_version uuid,p_expected integer,p_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 DELETE FROM recipe_parameter_limit WHERE recipe_version_id=p_version AND id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende receptinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN current_no+1;
END $$;

CREATE FUNCTION recipe_save_formula(p_version uuid,p_expected integer,p_id uuid,p_reference_quantity numeric,p_reference_unit text,p_reference_unit_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer; target uuid;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 IF p_id IS NULL THEN
   INSERT INTO recipe_formula(recipe_version_id,reference_quantity,reference_unit,reference_unit_id)
   VALUES(p_version,p_reference_quantity,p_reference_unit,p_reference_unit_id) RETURNING id INTO target;
 ELSE
   UPDATE recipe_formula SET reference_quantity=p_reference_quantity,reference_unit=p_reference_unit,reference_unit_id=p_reference_unit_id
   WHERE recipe_version_id=p_version AND id=p_id RETURNING id INTO target;
   IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende receptinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN jsonb_build_object('id',target,'change_no',current_no+1);
END $$;

CREATE FUNCTION recipe_delete_formula(p_version uuid,p_expected integer,p_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 DELETE FROM recipe_formula WHERE recipe_version_id=p_version AND id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende receptinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN current_no+1;
END $$;

CREATE FUNCTION recipe_save_material_requirement(p_version uuid,p_expected integer,p_id uuid,p_formula_id uuid,p_procedural_element_id uuid,p_material_version_id uuid,p_code text,p_direction text,p_quantity numeric,p_unit text,p_scaling text,p_measurement_unit_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer; target uuid;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 IF p_id IS NULL THEN
   INSERT INTO recipe_material_requirement(recipe_version_id,formula_id,procedural_element_id,material_version_id,code,direction,quantity,unit,scaling,measurement_unit_id)
   VALUES(p_version,p_formula_id,p_procedural_element_id,p_material_version_id,p_code,p_direction,p_quantity,p_unit,p_scaling,p_measurement_unit_id) RETURNING id INTO target;
 ELSE
   UPDATE recipe_material_requirement SET formula_id=p_formula_id,procedural_element_id=p_procedural_element_id,material_version_id=p_material_version_id,code=p_code,direction=p_direction,quantity=p_quantity,unit=p_unit,scaling=p_scaling,measurement_unit_id=p_measurement_unit_id
   WHERE recipe_version_id=p_version AND id=p_id RETURNING id INTO target;
   IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende receptinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN jsonb_build_object('id',target,'change_no',current_no+1);
END $$;

CREATE FUNCTION recipe_delete_material_requirement(p_version uuid,p_expected integer,p_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 DELETE FROM recipe_material_requirement WHERE recipe_version_id=p_version AND id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende receptinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN current_no+1;
END $$;

REVOKE ALL ON FUNCTION recipe_content_list(uuid),
 recipe_save_parameter(uuid,integer,uuid,uuid,text,text,text,text,text,boolean,text,boolean,uuid),
 recipe_delete_parameter(uuid,integer,uuid),
 recipe_save_parameter_limit(uuid,integer,uuid,uuid,text,text,numeric,numeric,numeric,text),
 recipe_delete_parameter_limit(uuid,integer,uuid),
 recipe_save_formula(uuid,integer,uuid,numeric,text,uuid),
 recipe_delete_formula(uuid,integer,uuid),
 recipe_save_material_requirement(uuid,integer,uuid,uuid,uuid,uuid,text,text,numeric,text,text,uuid),
 recipe_delete_material_requirement(uuid,integer,uuid) FROM PUBLIC;
