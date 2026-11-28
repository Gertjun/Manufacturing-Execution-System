-- Migratie 0160: beperkte middelencatalogusreferenties voor receptconcepten (#116.3d.2).
SET search_path = fabriek, public;

-- Bestaande persoonlijke productscope blijft vereist. Alleen definities,
-- geen fysieke middelen, actuele waarden, statussen of beheerbevoegdheden.
CREATE OR REPLACE FUNCTION recipe_reference_catalog(p_product uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
 PERFORM recipe_draft_actor(p_product);
 RETURN jsonb_build_object(
   'materials', COALESCE((SELECT jsonb_agg(jsonb_build_object(
     'id',v.id,'material_code',d.code,'revision',v.revision,'name',v.name,
     'unit',v.unit,'measurement_unit_id',v.measurement_unit_id)
     ORDER BY d.code,v.revision DESC)
     FROM material_definition_version v JOIN material_definition d ON d.id=v.material_definition_id),'[]'::jsonb),
   'qualifications', COALESCE((SELECT jsonb_agg(jsonb_build_object('code',q.code,'description',q.description)
     ORDER BY q.code) FROM qualification q),'[]'::jsonb),
   'equipment_classes', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'code',c.code,'name',c.name)
     ORDER BY c.code) FROM equipment_class c),'[]'::jsonb),
   'equipment_properties', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'code',p.code,'name',p.name,
     'quantity_kind_id',p.quantity_kind_id,'measurement_unit_id',p.measurement_unit_id)
     ORDER BY p.code) FROM equipment_property_definition p),'[]'::jsonb)
 );
END $$;
REVOKE ALL ON FUNCTION recipe_reference_catalog(uuid) FROM PUBLIC;
