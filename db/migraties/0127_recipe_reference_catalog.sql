-- 0127: beperkte gedeelde referentiecatalogus voor productgebonden MBR-beheer.
SET search_path = fabriek, public;

CREATE FUNCTION recipe_reference_catalog(p_product uuid) RETURNS jsonb
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
     ORDER BY q.code) FROM qualification q),'[]'::jsonb)
 );
END $$;
REVOKE ALL ON FUNCTION recipe_reference_catalog(uuid) FROM PUBLIC;
