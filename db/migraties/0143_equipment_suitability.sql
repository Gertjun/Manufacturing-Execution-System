-- Migratie 0143: interne technische geschiktheidsvergelijking (#115.2d).
SET search_path = fabriek, public;

-- Eén klasse en optioneel één expliciet numeriek criterium per vergelijking.
-- Geen beschikbaarheids-, allocatie-, veiligheids- of vrijgavebesluit.
CREATE FUNCTION equipment_suitability(
    p_equipment uuid,p_class uuid,p_property uuid DEFAULT NULL,
    p_unit uuid DEFAULT NULL,p_operator text DEFAULT NULL,
    p_limit numeric DEFAULT NULL,p_capacity boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE
    class_status text; property_status text; property_reason text;
    result_status text; v_revision uuid; v_value numeric;
    v_unit uuid; v_designated boolean; v_match boolean;
BEGIN
    IF p_equipment IS NULL OR p_class IS NULL OR p_capacity IS NULL
       OR (p_property IS NULL AND (p_unit IS NOT NULL OR p_operator IS NOT NULL OR p_limit IS NOT NULL OR p_capacity))
       OR (p_property IS NOT NULL AND (p_unit IS NULL OR p_operator IS NULL
           OR p_operator NOT IN ('minimum','maximum','equal') OR p_limit IS NULL
           OR p_limit IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric')
           OR (p_capacity AND (p_operator<>'minimum' OR p_limit<=0)))) THEN
        RAISE EXCEPTION 'Ongeldig technisch geschiktheidscriterium' USING ERRCODE='22023';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM equipment WHERE id=p_equipment)
       OR NOT EXISTS (SELECT 1 FROM equipment_class WHERE id=p_class) THEN
        class_status:='unknown';
    ELSIF EXISTS (SELECT 1 FROM equipment_class_assignment
                  WHERE equipment_id=p_equipment AND equipment_class_id=p_class) THEN
        class_status:='suitable';
    ELSE
        class_status:='unsuitable';
    END IF;

    IF p_property IS NOT NULL THEN
        property_status:='unknown';
        SELECT d.measurement_unit_id INTO v_unit FROM equipment_property_definition d WHERE d.id=p_property;
        IF NOT FOUND THEN
            property_reason:='unknown_property';
        ELSIF v_unit IS DISTINCT FROM p_unit THEN
            property_reason:='unit_mismatch';
        ELSE
            SELECT v.id,v.value,EXISTS(SELECT 1 FROM equipment_capacity x WHERE x.capability_id=c.id)
                INTO v_revision,v_value,v_designated
                FROM equipment_capability c
                JOIN LATERAL (SELECT id,value FROM equipment_capability_revision
                    WHERE capability_id=c.id ORDER BY revision DESC LIMIT 1) v ON true
                WHERE c.equipment_id=p_equipment AND c.property_definition_id=p_property;
            IF NOT FOUND THEN
                property_reason:='missing_capability';
            ELSIF p_capacity AND NOT v_designated THEN
                property_reason:='missing_capacity_designation';
            ELSE
                v_match:=CASE p_operator WHEN 'minimum' THEN v_value>=p_limit
                    WHEN 'maximum' THEN v_value<=p_limit ELSE v_value=p_limit END;
                property_status:=CASE WHEN v_match THEN 'suitable' ELSE 'unsuitable' END;
                property_reason:=CASE WHEN v_match THEN 'criterion_met' ELSE 'criterion_not_met' END;
            END IF;
        END IF;
    END IF;

    -- Een bewezen negatief criterium heeft voorrang op onbekende gegevens.
    result_status:=CASE WHEN class_status='unsuitable' OR property_status='unsuitable' THEN 'unsuitable'
        WHEN class_status='unknown' OR property_status='unknown' THEN 'unknown'
        ELSE 'suitable' END;
    RETURN jsonb_build_object('status',result_status,'equipment_id',p_equipment,
        'class',jsonb_build_object('id',p_class,'status',class_status),
        'property',CASE WHEN p_property IS NULL THEN NULL ELSE jsonb_build_object(
            'id',p_property,'status',property_status,'reason',property_reason,
            'required_unit_id',p_unit,'actual_unit_id',v_unit,'operator',p_operator,
            'limit',p_limit::text,'capacity_required',p_capacity,
            'revision_id',v_revision,'actual_value',v_value::text) END);
END $$;

REVOKE ALL ON FUNCTION equipment_suitability(uuid,uuid,uuid,uuid,text,numeric,boolean) FROM PUBLIC;
