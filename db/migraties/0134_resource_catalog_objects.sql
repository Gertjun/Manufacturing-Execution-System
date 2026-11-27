-- Migratie 0134: persoonlijk beheer van hiërarchie, middelen en fysieke assets (#114.5b).
SET search_path = fabriek, public;

-- Identiteiten, ouders en locaties blijven onveranderlijk. Alleen expliciet globaal beheer.
ALTER TABLE equipment_hierarchy ADD COLUMN change_no integer NOT NULL DEFAULT 0 CHECK (change_no >= 0);
CREATE TRIGGER equipment_hierarchy_audit AFTER INSERT OR UPDATE ON equipment_hierarchy
    FOR EACH ROW EXECUTE FUNCTION log_config();

CREATE FUNCTION resource_hierarchy_create(p_code text,p_name text,p_level text,p_parent uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE target uuid;
BEGIN
    PERFORM resource_catalog_actor();
    INSERT INTO equipment_hierarchy(code,name,level,parent_id) VALUES (p_code,p_name,p_level,p_parent) RETURNING id INTO target;
    RETURN target;
END $$;

CREATE FUNCTION resource_hierarchy_rename(p_id uuid,p_expected integer,p_name text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer; result_no integer;
BEGIN
    PERFORM resource_catalog_actor();
    SELECT change_no INTO current_no FROM equipment_hierarchy WHERE id=p_id FOR UPDATE;
    IF NOT FOUND OR current_no IS DISTINCT FROM p_expected THEN
        RAISE EXCEPTION 'Catalogusobject ontbreekt of is gewijzigd' USING ERRCODE='40001';
    END IF;
    UPDATE equipment_hierarchy SET name=p_name,change_no=current_no+1
        WHERE id=p_id RETURNING change_no INTO result_no;
    RETURN result_no;
END $$;

ALTER TABLE equipment ADD COLUMN change_no integer NOT NULL DEFAULT 0 CHECK (change_no >= 0);
CREATE TRIGGER equipment_audit AFTER INSERT OR UPDATE ON equipment
    FOR EACH ROW EXECUTE FUNCTION log_config();

CREATE FUNCTION resource_equipment_create(p_code text,p_name text,p_hierarchy uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE target uuid;
BEGIN
    PERFORM resource_catalog_actor();
    INSERT INTO equipment(code,name,hierarchy_id) VALUES (p_code,p_name,p_hierarchy) RETURNING id INTO target;
    RETURN target;
END $$;

CREATE FUNCTION resource_equipment_rename(p_id uuid,p_expected integer,p_name text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer; result_no integer;
BEGIN
    PERFORM resource_catalog_actor();
    SELECT change_no INTO current_no FROM equipment WHERE id=p_id FOR UPDATE;
    IF NOT FOUND OR current_no IS DISTINCT FROM p_expected THEN
        RAISE EXCEPTION 'Catalogusobject ontbreekt of is gewijzigd' USING ERRCODE='40001';
    END IF;
    UPDATE equipment SET name=p_name,change_no=current_no+1
        WHERE id=p_id RETURNING change_no INTO result_no;
    RETURN result_no;
END $$;

ALTER TABLE physical_asset ADD COLUMN change_no integer NOT NULL DEFAULT 0 CHECK (change_no >= 0);
CREATE TRIGGER physical_asset_audit AFTER INSERT OR UPDATE ON physical_asset
    FOR EACH ROW EXECUTE FUNCTION log_config();

CREATE FUNCTION resource_asset_create(p_code text,p_name text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE target uuid;
BEGIN
    PERFORM resource_catalog_actor();
    INSERT INTO physical_asset(code,name) VALUES (p_code,p_name) RETURNING id INTO target;
    RETURN target;
END $$;

CREATE FUNCTION resource_asset_rename(p_id uuid,p_expected integer,p_name text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer; result_no integer;
BEGIN
    PERFORM resource_catalog_actor();
    SELECT change_no INTO current_no FROM physical_asset WHERE id=p_id FOR UPDATE;
    IF NOT FOUND OR current_no IS DISTINCT FROM p_expected THEN
        RAISE EXCEPTION 'Catalogusobject ontbreekt of is gewijzigd' USING ERRCODE='40001';
    END IF;
    UPDATE physical_asset SET name=p_name,change_no=current_no+1
        WHERE id=p_id RETURNING change_no INTO result_no;
    RETURN result_no;
END $$;

REVOKE ALL ON FUNCTION resource_hierarchy_create(text,text,text,uuid),
    resource_hierarchy_rename(uuid,integer,text),
    resource_equipment_create(text,text,uuid),
    resource_equipment_rename(uuid,integer,text),
    resource_asset_create(text,text),
    resource_asset_rename(uuid,integer,text) FROM PUBLIC;
