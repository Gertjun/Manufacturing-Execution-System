-- Migratie 0151: gescheiden persoonlijke middelenleesprojecties (#115.6b).
SET search_path = fabriek, public;

CREATE FUNCTION resource_capability_list() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; catalog jsonb; result jsonb;
BEGIN
    actor:=execution_transaction_actor();
    -- Hergebruik de bestaande catalogusautoriteit, inclusief lege globale context.
    catalog:=resource_catalog_list();
    WITH visible AS MATERIALIZED (
        SELECT e.id FROM equipment e WHERE resource_catalog_visible(actor,NULL,e.id) IS TRUE
    )
    SELECT jsonb_build_object(
        'global',catalog->'global',
        'equipment',catalog->'equipment',
        'properties',coalesce((SELECT jsonb_agg(jsonb_build_object(
            'id',d.id,'code',d.code,'name',d.name,'quantity_kind_id',d.quantity_kind_id,
            'measurement_unit_id',d.measurement_unit_id,'unit',u.symbol) ORDER BY d.code)
            FROM equipment_property_definition d JOIN measurement_unit u ON u.id=d.measurement_unit_id),'[]'::jsonb),
        'capabilities',coalesce((SELECT jsonb_agg(jsonb_build_object(
            'id',c.id,'equipment_id',c.equipment_id,'property_definition_id',c.property_definition_id,
            'revision',r.revision,'value',r.value::text,'reason',r.reason,'created_at',r.created_at,
            'capacity',EXISTS(SELECT 1 FROM equipment_capacity x WHERE x.capability_id=c.id))
            ORDER BY c.equipment_id,c.property_definition_id)
            FROM equipment_capability c JOIN visible e ON e.id=c.equipment_id
            LEFT JOIN LATERAL (SELECT revision,value,reason,created_at FROM equipment_capability_revision
                WHERE capability_id=c.id ORDER BY revision DESC LIMIT 1) r ON true),'[]'::jsonb)
    ) INTO result;
    RETURN result;
END $$;

-- Interne helper: dezelfde vertrouwde context als resource_status_set,
-- uitsluitend statusbeheerrecht; geen verbreding via catalogusrecht.
CREATE FUNCTION resource_status_visible(p_actor uuid,p_equipment uuid) RETURNS boolean
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

CREATE FUNCTION resource_status_list() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; v_global boolean; result jsonb;
BEGIN
    actor:=execution_transaction_actor();
    v_global:=authorization_permits(actor,'resource.status.manage',NULL,NULL,NULL);
    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id',e.id,'code',e.code,'name',e.name,'status',coalesce(r.status,'unknown'),
        'revision',coalesce(r.revision,0),'reason',r.reason,'created_at',r.created_at,
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

CREATE FUNCTION resource_status_history(p_equipment uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; result jsonb;
BEGIN
    actor:=execution_transaction_actor();
    IF resource_status_visible(actor,p_equipment) IS NOT TRUE THEN
        RAISE EXCEPTION 'Geen actuele middelenstatuscontext' USING ERRCODE='42501';
    END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object('revision',r.revision,'status',r.status,'reason',r.reason,
        'created_at',r.created_at,'created_by',r.created_by,'created_by_name',g.gebruikersnaam)
        ORDER BY r.revision DESC),'[]'::jsonb)
    INTO result FROM equipment_status_history r JOIN gebruiker g ON g.id=r.created_by
        WHERE r.equipment_id=p_equipment;
    RETURN result;
END $$;
REVOKE ALL ON FUNCTION resource_capability_list(),resource_status_visible(uuid,uuid),
    resource_status_list(),resource_status_history(uuid) FROM PUBLIC;
