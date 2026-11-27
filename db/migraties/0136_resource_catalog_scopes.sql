-- Migratie 0136: expliciete scopes voor middelenbeheer (#114.5d).
SET search_path = fabriek, public;
CREATE TABLE resource_area_scope (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    area_code text NOT NULL UNIQUE CHECK (area_code=btrim(area_code) AND area_code ~ '[^[:space:]]'),
    hierarchy_id uuid NOT NULL UNIQUE,
    hierarchy_level text GENERATED ALWAYS AS ('area'::text) STORED,
    FOREIGN KEY (hierarchy_id,hierarchy_level) REFERENCES equipment_hierarchy(id,level)
);
CREATE TABLE resource_equipment_scope (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    equipment_code text NOT NULL UNIQUE CHECK (equipment_code=btrim(equipment_code) AND equipment_code ~ '[^[:space:]]'),
    equipment_id uuid NOT NULL UNIQUE REFERENCES equipment(id)
);
REVOKE ALL ON resource_area_scope,resource_equipment_scope FROM PUBLIC;
CREATE TRIGGER resource_area_scope_audit AFTER INSERT ON resource_area_scope
    FOR EACH ROW EXECUTE FUNCTION log_config();
CREATE TRIGGER resource_equipment_scope_audit AFTER INSERT ON resource_equipment_scope
    FOR EACH ROW EXECUTE FUNCTION log_config();
CREATE FUNCTION resource_scope_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
    RAISE EXCEPTION 'Scopemapping is onveranderlijk; gecontroleerde lifecycle vereist' USING ERRCODE='55000';
END $$;
CREATE TRIGGER resource_area_scope_guard BEFORE UPDATE OR DELETE ON resource_area_scope
    FOR EACH ROW EXECUTE FUNCTION resource_scope_guard();
CREATE TRIGGER resource_equipment_scope_guard BEFORE UPDATE OR DELETE ON resource_equipment_scope
    FOR EACH ROW EXECUTE FUNCTION resource_scope_guard();

-- Context wordt uitsluitend uit de catalogus afgeleid. Geen productcontext.
CREATE FUNCTION resource_scoped_actor(p_hierarchy uuid,p_equipment uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; v_hierarchy uuid; v_area text; v_equipment text;
BEGIN
    actor:=execution_transaction_actor();
    IF p_equipment IS NOT NULL THEN
        SELECT hierarchy_id INTO v_hierarchy FROM equipment WHERE id=p_equipment;
        SELECT equipment_code INTO v_equipment FROM resource_equipment_scope WHERE equipment_id=p_equipment;
    ELSE
        v_hierarchy:=p_hierarchy;
    END IF;
    WITH RECURSIVE ancestors AS (
        SELECT id,parent_id,level FROM equipment_hierarchy WHERE id=v_hierarchy
        UNION ALL
        SELECT h.id,h.parent_id,h.level FROM equipment_hierarchy h JOIN ancestors a ON h.id=a.parent_id
    )
    SELECT s.area_code INTO v_area FROM ancestors a JOIN resource_area_scope s ON s.hierarchy_id=a.id
        WHERE a.level='area';
    IF authorization_permits(actor,'resource.catalog.manage',v_area,NULL,v_equipment) IS NOT TRUE THEN
        RAISE EXCEPTION 'Geen actuele middelenbeheerbevoegdheid voor deze scope' USING ERRCODE='42501';
    END IF;
    RETURN actor;
END $$;
REVOKE ALL ON FUNCTION resource_scope_guard(),resource_scoped_actor(uuid,uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION resource_hierarchy_create(p_code text,p_name text,p_level text,p_parent uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE target uuid;
BEGIN
    PERFORM resource_scoped_actor(p_parent,NULL);
    INSERT INTO equipment_hierarchy(code,name,level,parent_id) VALUES (p_code,p_name,p_level,p_parent) RETURNING id INTO target;
    RETURN target;
END $$;

CREATE OR REPLACE FUNCTION resource_hierarchy_rename(p_id uuid,p_expected integer,p_name text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer; result_no integer;
BEGIN
    PERFORM resource_scoped_actor(p_id,NULL);
    SELECT change_no INTO current_no FROM equipment_hierarchy WHERE id=p_id FOR UPDATE;
    IF NOT FOUND OR current_no IS DISTINCT FROM p_expected THEN
        RAISE EXCEPTION 'Catalogusobject ontbreekt of is gewijzigd' USING ERRCODE='40001';
    END IF;
    UPDATE equipment_hierarchy SET name=p_name,change_no=current_no+1
        WHERE id=p_id RETURNING change_no INTO result_no;
    RETURN result_no;
END $$;

CREATE OR REPLACE FUNCTION resource_equipment_create(p_code text,p_name text,p_hierarchy uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE target uuid;
BEGIN
    PERFORM resource_scoped_actor(p_hierarchy,NULL);
    INSERT INTO equipment(code,name,hierarchy_id) VALUES (p_code,p_name,p_hierarchy) RETURNING id INTO target;
    RETURN target;
END $$;

CREATE OR REPLACE FUNCTION resource_equipment_rename(p_id uuid,p_expected integer,p_name text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer; result_no integer;
BEGIN
    PERFORM resource_scoped_actor(NULL,p_id);
    SELECT change_no INTO current_no FROM equipment WHERE id=p_id FOR UPDATE;
    IF NOT FOUND OR current_no IS DISTINCT FROM p_expected THEN
        RAISE EXCEPTION 'Catalogusobject ontbreekt of is gewijzigd' USING ERRCODE='40001';
    END IF;
    UPDATE equipment SET name=p_name,change_no=current_no+1
        WHERE id=p_id RETURNING change_no INTO result_no;
    RETURN result_no;
END $$;

CREATE OR REPLACE FUNCTION resource_class_assign(p_equipment uuid,p_class uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE target uuid;
BEGIN
    PERFORM resource_scoped_actor(NULL,p_equipment);
    INSERT INTO equipment_class_assignment(equipment_id,equipment_class_id)
        VALUES (p_equipment,p_class) RETURNING id INTO target;
    RETURN target;
END $$;

CREATE OR REPLACE FUNCTION resource_asset_close(p_assignment uuid,p_until timestamptz) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE target uuid;
BEGIN
    PERFORM resource_scoped_actor(NULL,(SELECT equipment_id FROM equipment_asset_assignment WHERE id=p_assignment));
    IF p_until IS NULL THEN
        RAISE EXCEPTION 'Afsluitmoment is verplicht' USING ERRCODE='22004';
    END IF;
    UPDATE equipment_asset_assignment SET valid_until=p_until
        WHERE id=p_assignment AND valid_until IS NULL RETURNING id INTO target;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Open assettoewijzing ontbreekt of is reeds afgesloten' USING ERRCODE='40001';
    END IF;
    RETURN target;
END $$;
