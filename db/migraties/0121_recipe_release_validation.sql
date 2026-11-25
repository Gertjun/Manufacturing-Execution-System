-- Migratie 0121: conservatieve inhoudelijke vrijgavepoort (#112/#141).
SET search_path = fabriek, public;

-- Alleen vaste controles, geen uitvoeringsengine of impliciete conversie.
-- De database rapporteert alle bekende blokkades; een lege lijst is
-- noodzakelijk, maar op zichzelf geen vrijgavebesluit.
CREATE FUNCTION recipe_release_blockers(p_version uuid)
RETURNS TABLE(code text, record_id uuid, detail text)
LANGUAGE sql STABLE SET search_path=pg_catalog,fabriek,pg_temp AS $$
 SELECT 'missing_version'::text,p_version,'Onbekende receptversie'::text
 WHERE NOT EXISTS (SELECT 1 FROM master_recipe_version WHERE id=p_version)
 UNION ALL
 SELECT 'missing_moc',p_version,'MOC-dossier ontbreekt'
 WHERE NOT EXISTS (SELECT 1 FROM recipe_change_request WHERE recipe_version_id=p_version)
 UNION ALL
 SELECT 'missing_root',p_version,'Procedure-root ontbreekt'
 WHERE NOT EXISTS (SELECT 1 FROM recipe_procedural_element WHERE recipe_version_id=p_version AND kind='procedure')
 UNION ALL
 SELECT 'empty_procedure_branch',x.id,'Procedure-element heeft geen onderliggend element'
 FROM recipe_procedural_element x
 WHERE x.recipe_version_id=p_version AND x.kind<>'phase'
 AND NOT EXISTS (SELECT 1 FROM recipe_procedural_element c WHERE c.recipe_version_id=p_version AND c.parent_id=x.id)
 UNION ALL
 SELECT 'missing_formula',p_version,'Referentieformule ontbreekt'
 WHERE NOT EXISTS (SELECT 1 FROM recipe_formula WHERE recipe_version_id=p_version)
 UNION ALL
 SELECT 'unmapped_formula_unit',f.id,'Referentie-eenheid niet expliciet gekoppeld'
 FROM recipe_formula f WHERE f.recipe_version_id=p_version AND f.reference_unit_id IS NULL
 UNION ALL
 SELECT 'unmapped_material_unit',m.id,'Materiaaleenheid niet expliciet gekoppeld'
 FROM recipe_material_requirement m JOIN material_definition_version v ON v.id=m.material_version_id
 WHERE m.recipe_version_id=p_version AND (m.measurement_unit_id IS NULL OR v.measurement_unit_id IS DISTINCT FROM m.measurement_unit_id OR v.unit IS DISTINCT FROM m.unit)
 UNION ALL
 SELECT 'unmapped_parameter_unit',p.id,'Numerieke parametereenheid niet expliciet gekoppeld'
 FROM recipe_parameter p WHERE p.recipe_version_id=p_version AND p.data_type IN ('decimal','integer')
 AND p.measurement_unit_id IS NULL
 UNION ALL
 SELECT 'missing_lot_rule',p_version,'Expliciete lotnorm ontbreekt'
 WHERE NOT EXISTS (SELECT 1 FROM recipe_lot_rule WHERE recipe_version_id=p_version)
 UNION ALL
 SELECT 'unverified_linear_parameter',l.id,'Lineaire schaling vereist bewezen ratio-eenheid en gehele-waardebeleid'
 FROM recipe_parameter_limit l JOIN recipe_parameter p ON p.id=l.parameter_id
 LEFT JOIN measurement_unit u ON u.id=p.measurement_unit_id LEFT JOIN quantity_kind k ON k.id=u.quantity_kind_id
 WHERE l.recipe_version_id=p_version AND l.scaling='linear' AND (k.value_semantics IS DISTINCT FROM 'ratio' OR p.data_type='integer')
 UNION ALL
 SELECT 'unverified_linear_material',m.id,'Lineaire materiaalschaling vereist bewezen ratio-eenheid'
 FROM recipe_material_requirement m LEFT JOIN measurement_unit u ON u.id=m.measurement_unit_id LEFT JOIN quantity_kind k ON k.id=u.quantity_kind_id
 WHERE m.recipe_version_id=p_version AND m.scaling='linear' AND k.value_semantics IS DISTINCT FROM 'ratio'
 UNION ALL
 SELECT 'unverified_reference_scaling',f.id,'Referentiegrootte voor lineaire schaling vereist ratio-eenheid'
 FROM recipe_formula f LEFT JOIN measurement_unit u ON u.id=f.reference_unit_id LEFT JOIN quantity_kind k ON k.id=u.quantity_kind_id
 WHERE f.recipe_version_id=p_version AND k.value_semantics IS DISTINCT FROM 'ratio'
 AND (EXISTS (SELECT 1 FROM recipe_material_requirement m WHERE m.recipe_version_id=p_version AND m.scaling='linear')
 OR EXISTS (SELECT 1 FROM recipe_parameter_limit l WHERE l.recipe_version_id=p_version AND l.scaling='linear'))
 UNION ALL
 SELECT 'complex_scaling_unproven',r.id,'Complexe schaalregel nog niet aantoonbaar uitvoerbaar; geen fixed/linear fallback'
 FROM recipe_scaling_rule r WHERE r.recipe_version_id=p_version
 UNION ALL
 SELECT 'equipment_class_unverified',e.id,'Equipmentklasse en capaciteit vereisen gevalideerde resourcecatalogus'
 FROM recipe_equipment_requirement e WHERE e.recipe_version_id=p_version
 UNION ALL
 SELECT 'qualification_changed',p.id,'Kwalificatiebetekenis wijkt af van vastgelegde eis'
 FROM recipe_personnel_requirement p LEFT JOIN qualification q ON q.code=p.qualification_code
 WHERE p.recipe_version_id=p_version AND q.description IS DISTINCT FROM p.qualification_description
$$;

-- Preview voor de bestaande persoonlijke conceptscopecapability.
-- De toekomstige releasefunctie roept de interne poort opnieuw aan onder
-- dezelfde receptlock als de statusovergang, nooit op basis van clientdata.
CREATE FUNCTION recipe_release_validation(p_version uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE product uuid; n integer; state text; blockers jsonb;
BEGIN
 SELECT r.product_id INTO product FROM master_recipe_version v JOIN master_recipe r ON r.id=v.master_recipe_id WHERE v.id=p_version;
 PERFORM recipe_draft_actor(product);
 SELECT change_no,lifecycle_status INTO n,state FROM master_recipe_version WHERE id=p_version FOR SHARE;
 SELECT COALESCE(jsonb_agg(to_jsonb(b) ORDER BY b.code,b.record_id),'[]'::jsonb) INTO blockers FROM recipe_release_blockers(p_version) b;
 RETURN jsonb_build_object('recipe_version_id',p_version,'change_no',n,'lifecycle_status',state,
 'content_valid',jsonb_array_length(blockers)=0,'blockers',blockers);
END $$;

CREATE FUNCTION recipe_assert_release_content(p_version uuid) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE failure text;
BEGIN
 PERFORM 1 FROM master_recipe_version WHERE id=p_version FOR UPDATE;
 SELECT string_agg(DISTINCT code,', ' ORDER BY code) INTO failure FROM recipe_release_blockers(p_version);
 IF failure IS NOT NULL THEN
   RAISE EXCEPTION 'MBR-vrijgave geblokkeerd: %',failure USING ERRCODE='23514';
 END IF;
END $$;

REVOKE ALL ON FUNCTION recipe_release_blockers(uuid),recipe_release_validation(uuid),recipe_assert_release_content(uuid) FROM PUBLIC;
-- Geen statusovergang, vrijgavepermission of uitvoeringsrecht in 0121.
-- De projectkeuzes voor minimale receptstructuur, dimensieloze eenheden,
-- integerafronding en resourcevalidatie worden bij de integrale review getoetst.
