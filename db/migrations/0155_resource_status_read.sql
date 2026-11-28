-- Migratie 0155: afzonderlijke persoonlijke statusinzage (#116.1).
SET search_path = fabriek, public;

INSERT INTO authorization_role(code,domain) VALUES ('resource_status_reader','maintenance');
INSERT INTO authorization_permission(code,domain) VALUES ('resource.status.read','maintenance');
INSERT INTO authorization_role_permission(role_code,permission_code) VALUES ('resource_status_reader','resource.status.read');

CREATE FUNCTION resource_status_manage_visible(p_actor uuid,p_equipment uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,fabriek,pg_temp AS $$
    WITH RECURSIVE location AS (
        SELECT h.id,h.parent_id,h.level FROM equipment_hierarchy h
            JOIN equipment e ON e.hierarchy_id=h.id WHERE e.id=p_equipment
        UNION ALL
        SELECT h.id,h.parent_id,h.level FROM equipment_hierarchy h JOIN location l ON h.id=l.parent_id
    )
    SELECT EXISTS(SELECT 1 FROM location) AND authorization_permits(p_actor,'resource.status.manage',
        (SELECT s.area_code FROM location l JOIN resource_area_scope s ON s.hierarchy_id=l.id WHERE l.level='area'),
        NULL,
        (SELECT s.equipment_code FROM resource_equipment_scope s WHERE s.equipment_id=p_equipment))
$$;
REVOKE ALL ON FUNCTION resource_status_manage_visible(uuid,uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION resource_status_visible(p_actor uuid,p_equipment uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,fabriek,pg_temp AS $$
    WITH RECURSIVE location AS (
        SELECT h.id,h.parent_id,h.level FROM equipment_hierarchy h
            JOIN equipment e ON e.hierarchy_id=h.id WHERE e.id=p_equipment
        UNION ALL
        SELECT h.id,h.parent_id,h.level FROM equipment_hierarchy h JOIN location l ON h.id=l.parent_id
    )
    SELECT resource_status_manage_visible(p_actor,p_equipment) OR (EXISTS(SELECT 1 FROM location) AND authorization_permits(p_actor,'resource.status.read',
        (SELECT s.area_code FROM location l JOIN resource_area_scope s ON s.hierarchy_id=l.id WHERE l.level='area'),
        NULL,
        (SELECT s.equipment_code FROM resource_equipment_scope s WHERE s.equipment_id=p_equipment)))
$$;

CREATE OR REPLACE FUNCTION resource_status_list() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; v_global boolean; result jsonb;
BEGIN
    actor:=execution_transaction_actor();
    v_global:=coalesce(authorization_permits(actor,'resource.status.manage',NULL,NULL,NULL),false) OR coalesce(authorization_permits(actor,'resource.status.read',NULL,NULL,NULL),false);
    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id',e.id,'code',e.code,'name',e.name,'status',coalesce(r.status,'unknown'),
        'can_manage',coalesce(resource_status_manage_visible(actor,e.id),false),'revision',coalesce(r.revision,0),'reason',r.reason,'created_at',r.created_at,
        'created_by',r.created_by,'created_by_name',g.gebruikersnaam) ORDER BY e.code),'[]'::jsonb)
    INTO result
    FROM equipment e
    LEFT JOIN LATERAL (SELECT status,revision,reason,created_at,created_by FROM equipment_status_history
        WHERE equipment_id=e.id ORDER BY revision DESC LIMIT 1) r ON true
    LEFT JOIN gebruiker g ON g.id=r.created_by
    WHERE resource_status_visible(actor,e.id) IS TRUE;
    IF NOT coalesce(v_global,false) AND jsonb_array_length(result)=0 THEN
        RAISE EXCEPTION 'Geen actuele middelenstatuscontext' USING ERRCODE='42501';
    END IF;
    RETURN result;
END $$;

CREATE OR REPLACE FUNCTION resource_status_access() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid;
BEGIN
    actor:=execution_transaction_actor();
    RETURN coalesce(authorization_permits(actor,'resource.status.manage',NULL,NULL,NULL),false)
        OR coalesce(authorization_permits(actor,'resource.status.read',NULL,NULL,NULL),false)
        OR EXISTS(SELECT 1 FROM equipment e WHERE resource_status_visible(actor,e.id) IS TRUE);
END $$;
