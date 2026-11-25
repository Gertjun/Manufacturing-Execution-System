-- Migratie 0114: expliciete eenheidsselectie voor materiaalversies en receptconcepten.
SET search_path = fabriek, public;

-- Geselecteerde catalogus-ID is leidend; symbool wordt serverzijde afgeleid.
-- Geen automatische tekstmapping of retroactieve wijziging van materiaalversies.
CREATE FUNCTION material_create_definition_with_unit(p_code text,p_name text,p_class uuid,p_unit_id uuid,p_product uuid,p_raw_material uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; target uuid; symbol_value text;
BEGIN
 actor:=material_manage_actor();
 SELECT symbol INTO symbol_value FROM measurement_unit WHERE id=p_unit_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende cataloguseenheid' USING ERRCODE='23503'; END IF;
 INSERT INTO material_definition(code,product_id,raw_material_id)
 VALUES(p_code,p_product,p_raw_material) RETURNING id INTO target;
 INSERT INTO material_definition_version(material_definition_id,revision,name,material_class_id,unit,measurement_unit_id,created_by)
 VALUES(target,1,p_name,p_class,symbol_value,p_unit_id,actor);
 RETURN target;
END $$;

CREATE FUNCTION material_append_version_with_unit(p_id uuid,p_expected_revision integer,p_name text,p_class uuid,p_unit_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; target uuid; current_revision integer; symbol_value text;
BEGIN
 actor:=material_manage_actor();
 PERFORM 1 FROM material_definition WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende materiaalidentiteit' USING ERRCODE='23503'; END IF;
 SELECT max(revision) INTO current_revision FROM material_definition_version WHERE material_definition_id=p_id;
 IF current_revision IS NULL OR current_revision IS DISTINCT FROM p_expected_revision THEN
   RAISE EXCEPTION 'Materiaalrevisie is gewijzigd' USING ERRCODE='40001';
 END IF;
 SELECT symbol INTO symbol_value FROM measurement_unit WHERE id=p_unit_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende cataloguseenheid' USING ERRCODE='23503'; END IF;
 INSERT INTO material_definition_version(material_definition_id,revision,name,material_class_id,unit,measurement_unit_id,created_by)
 VALUES(p_id,current_revision+1,p_name,p_class,symbol_value,p_unit_id,actor) RETURNING id INTO target;
 RETURN target;
END $$;

-- Catalogusdefinities zijn gedeeld. Productgebonden conceptbeheer mag
-- deze gegevens uitsluitend lezen; de bestaande globale schrijfrechten blijven.
CREATE FUNCTION recipe_unit_catalog_list(p_product uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
 PERFORM recipe_draft_actor(p_product);
 RETURN jsonb_build_object(
 'dimensions',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM quantity_dimension x),'[]'::jsonb),
 'quantity_kinds',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.code) FROM quantity_kind x),'[]'::jsonb),
 'units',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.code) FROM measurement_unit x),'[]'::jsonb),
 'conversions',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM unit_conversion x),'[]'::jsonb),
 'versions',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.conversion_id,x.revision) FROM unit_conversion_version x),'[]'::jsonb));
END $$;

-- Een eenmaal expliciet gekoppelde materiaalidentiteit mag via de oude
-- tekstinterface geen volgende ongekoppelde revisie krijgen.
CREATE OR REPLACE FUNCTION material_append_version(p_id uuid,p_expected_revision integer,p_name text,p_class uuid,p_unit text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; target uuid; current_revision integer;
BEGIN
 actor:=material_manage_actor();
 PERFORM 1 FROM material_definition WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende materiaalidentiteit'; END IF;
 SELECT max(revision) INTO current_revision FROM material_definition_version WHERE material_definition_id=p_id;
 IF current_revision IS NULL OR current_revision IS DISTINCT FROM p_expected_revision THEN
   RAISE EXCEPTION 'Materiaalrevisie is gewijzigd' USING ERRCODE='40001';
 END IF;
 IF EXISTS (SELECT 1 FROM material_definition_version WHERE material_definition_id=p_id AND measurement_unit_id IS NOT NULL) THEN
   RAISE EXCEPTION 'Expliciete cataloguseenheid vereist voor nieuwe materiaalrevisie' USING ERRCODE='23514';
 END IF;
 INSERT INTO material_definition_version(material_definition_id,revision,name,material_class_id,unit,created_by)
 VALUES(p_id,current_revision+1,p_name,p_class,p_unit,actor) RETURNING id INTO target;
 RETURN target;
END $$;

REVOKE ALL ON FUNCTION material_create_definition_with_unit(text,text,uuid,uuid,uuid,uuid),
 material_append_version_with_unit(uuid,integer,text,uuid,uuid),recipe_unit_catalog_list(uuid),
 material_append_version(uuid,integer,text,uuid,text) FROM PUBLIC;
