-- Migratie 0137: persoonlijk beheer van expliciete scopemappings (#114.5d).
SET search_path = fabriek, public;
-- Afzonderlijke security-permissie, geen automatische grants of uitbreiding bestaande rollen.
INSERT INTO authorization_role(code,domain) VALUES ('resource_scope_administrator','security');
INSERT INTO authorization_permission(code,domain) VALUES ('resource.scope.manage','security');
INSERT INTO authorization_role_permission(role_code,permission_code)
VALUES ('resource_scope_administrator','resource.scope.manage');

CREATE FUNCTION resource_scope_actor() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid;
BEGIN
    actor:=execution_transaction_actor();
    IF authorization_permits(actor,'resource.scope.manage',NULL,NULL,NULL) IS NOT TRUE THEN
        RAISE EXCEPTION 'Geen globale persoonlijke scopemappingbevoegdheid' USING ERRCODE='42501';
    END IF;
    RETURN actor;
END $$;

CREATE FUNCTION resource_area_scope_create(p_code text,p_hierarchy uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE target uuid;
BEGIN
    PERFORM resource_scope_actor();
    INSERT INTO resource_area_scope(area_code,hierarchy_id) VALUES (p_code,p_hierarchy) RETURNING id INTO target;
    RETURN target;
END $$;

CREATE FUNCTION resource_equipment_scope_create(p_code text,p_equipment uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE target uuid;
BEGIN
    PERFORM resource_scope_actor();
    INSERT INTO resource_equipment_scope(equipment_code,equipment_id) VALUES (p_code,p_equipment) RETURNING id INTO target;
    RETURN target;
END $$;
REVOKE ALL ON FUNCTION resource_scope_actor(),resource_area_scope_create(text,uuid),
    resource_equipment_scope_create(text,uuid) FROM PUBLIC;
