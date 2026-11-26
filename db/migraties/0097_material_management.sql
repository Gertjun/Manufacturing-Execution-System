-- Migratie 0097: persoonlijk geautoriseerde materiaalstamdata (#109).
SET search_path = fabriek, public;

-- Classificatie en bronkoppeling mogen een bestaande versie niet indirect wijzigen.
-- Correcties aan materiaalinhoud gebeuren met een nieuwe versie.
CREATE TRIGGER material_class_immutable BEFORE UPDATE OR DELETE ON material_class
 FOR EACH ROW EXECUTE FUNCTION material_version_immutable();
CREATE TRIGGER material_definition_immutable BEFORE UPDATE OR DELETE ON material_definition
 FOR EACH ROW EXECUTE FUNCTION material_version_immutable();

-- Een materiaal kan in meerdere producten gebruikt worden. Tot expliciete
-- materiaal-scope bestaat, vereist beheer een globale engineeringgrant.
CREATE FUNCTION material_manage_actor() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid;
BEGIN
 actor:=execution_transaction_actor();
 IF NOT authorization_permits(actor,'material.definition.manage',NULL,NULL,NULL) THEN
   RAISE EXCEPTION 'Geen actuele MES-materiaalbeheerbevoegdheid' USING ERRCODE='42501';
 END IF;
 RETURN actor;
END $$;

CREATE FUNCTION material_create_class(p_code text,p_name text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE target uuid;
BEGIN
 PERFORM material_manage_actor();
 INSERT INTO material_class(code,name) VALUES(p_code,p_name) RETURNING id INTO target;
 RETURN target;
END $$;

CREATE FUNCTION material_create_definition(p_code text,p_name text,p_class uuid,p_unit text,p_product uuid,p_raw_material uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; target uuid;
BEGIN
 actor:=material_manage_actor();
 INSERT INTO material_definition(code,product_id,raw_material_id)
 VALUES(p_code,p_product,p_raw_material) RETURNING id INTO target;
 INSERT INTO material_definition_version(material_definition_id,revision,name,material_class_id,unit,created_by)
 VALUES(target,1,p_name,p_class,p_unit,actor);
 RETURN target;
END $$;

-- Vergrendel de identiteit vóór de revisiebepaling; twee schrijvers kunnen
-- niet hetzelfde revisienummer krijgen. Verwachte revisie voorkomt verloren edits.
CREATE FUNCTION material_append_version(p_id uuid,p_expected_revision integer,p_name text,p_class uuid,p_unit text)
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
 INSERT INTO material_definition_version(material_definition_id,revision,name,material_class_id,unit,created_by)
 VALUES(p_id,current_revision+1,p_name,p_class,p_unit,actor) RETURNING id INTO target;
 RETURN target;
END $$;

CREATE FUNCTION material_list() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
 PERFORM material_manage_actor();
 RETURN jsonb_build_object(
   'classes',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.code) FROM material_class c),'[]'::jsonb),
   'definitions',COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.code) FROM material_definition d),'[]'::jsonb),
   'versions',COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.material_definition_id,v.revision) FROM material_definition_version v),'[]'::jsonb)
 );
END $$;

REVOKE ALL ON FUNCTION material_manage_actor(),material_create_class(text,text),
 material_create_definition(text,text,uuid,text,uuid,uuid),
 material_append_version(uuid,integer,text,uuid,text),material_list() FROM PUBLIC;
