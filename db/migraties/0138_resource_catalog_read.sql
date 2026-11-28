-- Migratie 0138: persoonlijke beperkte leesinterface (#114.6a).
SET search_path = fabriek, public;

-- Dezelfde vertrouwde context als bij de mutaties. Interne helper, geen app-ACL.
CREATE FUNCTION resource_catalog_visible(p_actor uuid,p_hierarchy uuid,p_equipment uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,fabriek,pg_temp AS $$
    WITH RECURSIVE location AS (
        SELECT h.id,h.parent_id,h.level FROM equipment_hierarchy h
        WHERE h.id=CASE WHEN p_equipment IS NULL THEN p_hierarchy
                        ELSE (SELECT e.hierarchy_id FROM equipment e WHERE e.id=p_equipment) END
        UNION ALL
        SELECT h.id,h.parent_id,h.level FROM equipment_hierarchy h JOIN location l ON h.id=l.parent_id
    )
    SELECT authorization_permits(p_actor,'resource.catalog.manage',
        (SELECT s.area_code FROM location l JOIN resource_area_scope s ON s.hierarchy_id=l.id WHERE l.level='area'),
        NULL,
        (SELECT s.equipment_code FROM resource_equipment_scope s WHERE s.equipment_id=p_equipment))
$$;

-- Expliciete projectie; geen directe tabeltoegang of client-scope.
-- Voor begrensde beheerders alleen toegestane middelen en hun eigen historie.
-- Globale klassen mogen als referentie worden gelezen, maar alleen wanneer
-- ten minste één concrete cataloguscontext is toegestaan.
CREATE FUNCTION resource_catalog_list() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; v_global boolean; result jsonb;
BEGIN
    actor:=execution_transaction_actor();
    v_global:=authorization_permits(actor,'resource.catalog.manage',NULL,NULL,NULL);
    WITH visible_equipment AS MATERIALIZED (
        SELECT e.id,e.code,e.name,e.hierarchy_id,e.change_no FROM equipment e
        WHERE resource_catalog_visible(actor,NULL,e.id)
    ), visible_hierarchy AS MATERIALIZED (
        SELECT h.id,h.code,h.name,h.level,h.parent_id,h.change_no FROM equipment_hierarchy h
        WHERE resource_catalog_visible(actor,h.id,NULL)
    ), visible_assignments AS MATERIALIZED (
        SELECT a.id,a.equipment_id,a.physical_asset_id,a.valid_from,a.valid_until
        FROM equipment_asset_assignment a JOIN visible_equipment e ON e.id=a.equipment_id
    )
    SELECT jsonb_build_object(
        'global',v_global,
        'hierarchy',coalesce((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.code) FROM visible_hierarchy h),'[]'::jsonb),
        'equipment',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.code) FROM visible_equipment e),'[]'::jsonb),
        'classes',coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'code',c.code,'name',c.name,'change_no',c.change_no) ORDER BY c.code)
            FROM equipment_class c WHERE v_global OR EXISTS (SELECT 1 FROM visible_equipment) OR EXISTS (SELECT 1 FROM visible_hierarchy)),'[]'::jsonb),
        'class_assignments',coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'equipment_id',a.equipment_id,'equipment_class_id',a.equipment_class_id) ORDER BY a.id)
            FROM equipment_class_assignment a JOIN visible_equipment e ON e.id=a.equipment_id),'[]'::jsonb),
        'assets',coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'code',a.code,'name',a.name,'change_no',a.change_no) ORDER BY a.code)
            FROM physical_asset a WHERE v_global OR EXISTS (SELECT 1 FROM visible_assignments x WHERE x.physical_asset_id=a.id)),'[]'::jsonb),
        'asset_assignments',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.valid_from,a.id) FROM visible_assignments a),'[]'::jsonb)
    ) INTO result;
    IF NOT v_global AND jsonb_array_length(result->'hierarchy')=0 AND jsonb_array_length(result->'equipment')=0 THEN
        RAISE EXCEPTION 'Geen actuele zichtbare middelenbeheercontext' USING ERRCODE='42501';
    END IF;
    RETURN result;
END $$;

-- Security mag alleen identifiers en namen lezen die voor mapping nodig zijn;
-- geen classificatie, assethistorie of inhoudelijke mutatie.
CREATE FUNCTION resource_scope_list() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
    PERFORM resource_scope_actor();
    RETURN jsonb_build_object(
        'areas',coalesce((SELECT jsonb_agg(jsonb_build_object('id',h.id,'code',h.code,'name',h.name) ORDER BY h.code)
            FROM equipment_hierarchy h WHERE h.level='area'),'[]'::jsonb),
        'equipment',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'code',e.code,'name',e.name,'hierarchy_id',e.hierarchy_id) ORDER BY e.code)
            FROM equipment e),'[]'::jsonb),
        'area_scopes',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'area_code',s.area_code,'hierarchy_id',s.hierarchy_id) ORDER BY s.area_code)
            FROM resource_area_scope s),'[]'::jsonb),
        'equipment_scopes',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'equipment_code',s.equipment_code,'equipment_id',s.equipment_id) ORDER BY s.equipment_code)
            FROM resource_equipment_scope s),'[]'::jsonb)
    );
END $$;
REVOKE ALL ON FUNCTION resource_catalog_visible(uuid,uuid,uuid),resource_catalog_list(),resource_scope_list() FROM PUBLIC;
