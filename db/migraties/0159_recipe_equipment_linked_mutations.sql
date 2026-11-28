-- Migratie 0159: persoonlijke catalogusgebonden receptmutaties (#116.3d.1).
SET search_path = fabriek, public;

-- De oude interfaces blijven bruikbaar voor ongekoppelde concepten, maar
-- mogen expliciete koppelingen niet stilzwijgend wijzigen of verliezen.
CREATE OR REPLACE FUNCTION recipe_save_equipment_requirement(p_version uuid,p_expected integer,p_id uuid,p_procedural_element_id uuid,p_code text,p_equipment_class_code text,p_description text,p_required_count integer,p_minimum_capacity numeric,p_capacity_unit_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer; target uuid;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 IF EXISTS (SELECT 1 FROM recipe_equipment_requirement WHERE recipe_version_id=p_version AND id=p_id
   AND (equipment_class_id IS NOT NULL OR capacity_property_definition_id IS NOT NULL)) THEN
   RAISE EXCEPTION 'Gebruik de expliciete middelencataloguskoppeling' USING ERRCODE='23514';
 END IF;
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

CREATE OR REPLACE FUNCTION recipe_save_scaling_input(p_version uuid,p_expected integer,p_id uuid,p_rule_id uuid,p_code text,p_source_kind text,p_parameter_id uuid,p_equipment_property text,p_constant_value numeric,p_unit_id uuid,p_conversion_version_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer; target uuid;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 IF EXISTS (SELECT 1 FROM recipe_scaling_input WHERE recipe_version_id=p_version AND id=p_id
   AND equipment_property_definition_id IS NOT NULL) THEN
   RAISE EXCEPTION 'Gebruik de expliciete eigenschapskoppeling' USING ERRCODE='23514';
 END IF;
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

CREATE FUNCTION recipe_save_equipment_requirement_linked(
 p_version uuid,p_expected integer,p_id uuid,p_procedural_element_id uuid,p_code text,
 p_equipment_class_id uuid,p_description text,p_required_count integer,
 p_minimum_capacity numeric,p_capacity_property_definition_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer; target uuid; class_code text; capacity_unit uuid;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 SELECT code INTO class_code FROM equipment_class WHERE id=p_equipment_class_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende middelklasse' USING ERRCODE='23503'; END IF;
 IF (p_minimum_capacity IS NULL) IS DISTINCT FROM (p_capacity_property_definition_id IS NULL) THEN
   RAISE EXCEPTION 'Minimumcapaciteit vereist een expliciete eigenschapsdefinitie' USING ERRCODE='23514';
 END IF;
 IF p_capacity_property_definition_id IS NOT NULL THEN
   SELECT measurement_unit_id INTO capacity_unit FROM equipment_property_definition WHERE id=p_capacity_property_definition_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende capaciteitseigenschap' USING ERRCODE='23503'; END IF;
 END IF;
 IF p_id IS NULL THEN
   INSERT INTO recipe_equipment_requirement(recipe_version_id,procedural_element_id,code,equipment_class_code,
     description,required_count,minimum_capacity,capacity_unit_id,equipment_class_id,capacity_property_definition_id)
   VALUES(p_version,p_procedural_element_id,p_code,class_code,p_description,p_required_count,
     p_minimum_capacity,capacity_unit,p_equipment_class_id,p_capacity_property_definition_id) RETURNING id INTO target;
 ELSE
   UPDATE recipe_equipment_requirement SET procedural_element_id=p_procedural_element_id,code=p_code,
     equipment_class_code=class_code,description=p_description,required_count=p_required_count,
     minimum_capacity=p_minimum_capacity,capacity_unit_id=capacity_unit,equipment_class_id=p_equipment_class_id,
     capacity_property_definition_id=p_capacity_property_definition_id
   WHERE recipe_version_id=p_version AND id=p_id RETURNING id INTO target;
   IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende receptinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN jsonb_build_object('id',target,'change_no',current_no+1);
END $$;

CREATE FUNCTION recipe_save_scaling_input_linked(
 p_version uuid,p_expected integer,p_id uuid,p_rule_id uuid,p_code text,
 p_equipment_property_definition_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer; target uuid; property_code text; property_unit uuid;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 SELECT code,measurement_unit_id INTO property_code,property_unit
   FROM equipment_property_definition WHERE id=p_equipment_property_definition_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende middeleneigenschap' USING ERRCODE='23503'; END IF;
 IF p_id IS NULL THEN
   INSERT INTO recipe_scaling_input(recipe_version_id,rule_id,code,source_kind,equipment_property,
     unit_id,equipment_property_definition_id)
   VALUES(p_version,p_rule_id,p_code,'equipment_property',property_code,property_unit,p_equipment_property_definition_id)
   RETURNING id INTO target;
 ELSE
   UPDATE recipe_scaling_input SET rule_id=p_rule_id,code=p_code,source_kind='equipment_property',
     parameter_id=NULL,equipment_property=property_code,constant_value=NULL,unit_id=property_unit,
     conversion_version_id=NULL,equipment_property_definition_id=p_equipment_property_definition_id
   WHERE recipe_version_id=p_version AND id=p_id RETURNING id INTO target;
   IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende schaalregelinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN jsonb_build_object('id',target,'change_no',current_no+1);
END $$;

REVOKE ALL ON FUNCTION recipe_save_equipment_requirement_linked(uuid,integer,uuid,uuid,text,uuid,text,integer,numeric,uuid),
 recipe_save_scaling_input_linked(uuid,integer,uuid,uuid,text,uuid) FROM PUBLIC;
