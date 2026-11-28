-- Migratie 0133: expliciet persoonlijk catalogusbeheer (#114.5a).
SET search_path = fabriek, public;
INSERT INTO authorization_role(code,domain) VALUES ('resource_catalog_manager','maintenance');
INSERT INTO authorization_permission(code,domain) VALUES ('resource.catalog.manage','maintenance');
INSERT INTO authorization_role_permission(role_code,permission_code)
VALUES ('resource_catalog_manager','resource.catalog.manage');

-- Alleen expliciet globale grants; geen impliciete interpretatie van legacy-scopes.
CREATE FUNCTION resource_catalog_actor() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid;
BEGIN
    actor:=execution_transaction_actor();
    IF authorization_permits(actor,'resource.catalog.manage',NULL,NULL,NULL) IS NOT TRUE THEN
        RAISE EXCEPTION 'Geen actuele globale middelenbeheerbevoegdheid' USING ERRCODE='42501';
    END IF;
    RETURN actor;
END $$;

ALTER TABLE equipment_class ADD COLUMN change_no integer NOT NULL DEFAULT 0 CHECK (change_no >= 0);
CREATE TRIGGER equipment_class_audit AFTER INSERT OR UPDATE ON equipment_class
    FOR EACH ROW EXECUTE FUNCTION log_config();

CREATE FUNCTION resource_class_create(p_code text,p_name text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE target uuid;
BEGIN
    PERFORM resource_catalog_actor();
    INSERT INTO equipment_class(code,name) VALUES (p_code,p_name) RETURNING id INTO target;
    RETURN target;
END $$;

CREATE FUNCTION resource_class_rename(p_id uuid,p_expected integer,p_name text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer; result_no integer;
BEGIN
    PERFORM resource_catalog_actor();
    SELECT change_no INTO current_no FROM equipment_class WHERE id=p_id FOR UPDATE;
    IF NOT FOUND OR current_no IS DISTINCT FROM p_expected THEN
        RAISE EXCEPTION 'Equipmentklasse ontbreekt of is gewijzigd' USING ERRCODE='40001';
    END IF;
    UPDATE equipment_class SET name=p_name,change_no=current_no+1
        WHERE id=p_id RETURNING change_no INTO result_no;
    RETURN result_no;
END $$;
REVOKE ALL ON FUNCTION resource_catalog_actor(),resource_class_create(text,text),resource_class_rename(uuid,integer,text) FROM PUBLIC;
