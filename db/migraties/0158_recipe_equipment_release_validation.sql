-- Migratie 0158: expliciete definitiegeldigheid middelenvereisten (#116.3c).
SET search_path = fabriek, public;

-- Definitiegeldigheid is geen bewijs van fysieke geschiktheid of beschikbaarheid.
-- 0156/0157 dwingen de referentie, code en exacte eenheid af; de identiteit
-- blijft stabiel. Geen actuele capaciteit, klassebezetting, status of stilstand
-- opnemen in de formele receptvrijgave. Aantal blijft een definitiecriterium.
-- Complexe schaalregels blijven integraal geblokkeerd tot fase 6.
CREATE OR REPLACE FUNCTION recipe_release_blockers(p_version uuid)
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
 SELECT 'equipment_class_unverified',e.id,'Middelklasse vereist een expliciete cataloguskoppeling'
 FROM recipe_equipment_requirement e WHERE e.recipe_version_id=p_version
 AND e.equipment_class_id IS NULL
 UNION ALL
 SELECT 'equipment_capacity_unverified',e.id,'Capaciteit vereist een expliciete eigenschapsdefinitie met dezelfde cataloguseenheid'
 FROM recipe_equipment_requirement e WHERE e.recipe_version_id=p_version
 AND e.minimum_capacity IS NOT NULL AND e.capacity_property_definition_id IS NULL
 UNION ALL
 SELECT 'qualification_changed',p.id,'Kwalificatiebetekenis wijkt af van vastgelegde eis'
 FROM recipe_personnel_requirement p LEFT JOIN qualification q ON q.code=p.qualification_code
 WHERE p.recipe_version_id=p_version AND q.description IS DISTINCT FROM p.qualification_description
$$;

-- Geen nieuwe statusovergang, mutatie-interface of app-grant.
-- Bestaande formele vrijgavecontrole, MOC-snapshot, teller en audit blijven leidend.
