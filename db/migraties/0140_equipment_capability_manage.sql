-- Migratie 0140: persoonlijk beheer van getypeerde middelenkenmerken (#115.1c).
SET search_path = fabriek, public;

CREATE TRIGGER equipment_property_definition_audit AFTER INSERT ON equipment_property_definition
    FOR EACH ROW EXECUTE FUNCTION log_config();
CREATE TRIGGER equipment_capability_audit AFTER INSERT ON equipment_capability
    FOR EACH ROW EXECUTE FUNCTION log_config();
CREATE TRIGGER equipment_capability_revision_audit AFTER INSERT ON equipment_capability_revision
    FOR EACH ROW EXECUTE FUNCTION log_config();

-- Eigenschapsdefinities zijn globale referentiegegevens.
CREATE FUNCTION resource_property_create(p_code text,p_name text,p_kind uuid,p_unit uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE target uuid;
BEGIN
    PERFORM resource_catalog_actor();
    INSERT INTO equipment_property_definition(code,name,quantity_kind_id,measurement_unit_id)
        VALUES (p_code,p_name,p_kind,p_unit) RETURNING id INTO target;
    RETURN target;
END $$;

-- Identiteit en eerste revisie in dezelfde transactie; geen lege capability
-- via de applicatie. Een fout in de revisie draait ook de identiteit terug.
CREATE FUNCTION resource_capability_create(p_equipment uuid,p_property uuid,p_value numeric,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; target uuid;
BEGIN
    actor:=resource_scoped_actor(NULL,p_equipment);
    INSERT INTO equipment_capability(equipment_id,property_definition_id)
        VALUES (p_equipment,p_property) RETURNING id INTO target;
    INSERT INTO equipment_capability_revision(capability_id,revision,value,created_by,reason)
        VALUES (target,1,p_value,actor,p_reason);
    RETURN target;
END $$;

-- Autoriseer op de onveranderlijke, serverzijdig afgeleide middelcontext.
-- Onbekende doelen worden niet als globale scope behandeld.
CREATE FUNCTION resource_capability_revise(p_capability uuid,p_expected integer,p_value numeric,p_reason text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; v_equipment uuid; previous_revision integer; next_revision integer;
BEGIN
    SELECT equipment_id INTO v_equipment FROM equipment_capability WHERE id=p_capability;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Geen actuele middelenbeheerbevoegdheid voor deze scope' USING ERRCODE='42501';
    END IF;
    actor:=resource_scoped_actor(NULL,v_equipment);
    PERFORM id FROM equipment_capability WHERE id=p_capability FOR UPDATE;
    SELECT coalesce(max(revision),0) INTO previous_revision
        FROM equipment_capability_revision WHERE capability_id=p_capability;
    IF previous_revision=0 OR previous_revision IS DISTINCT FROM p_expected OR previous_revision=2147483647 THEN
        RAISE EXCEPTION 'Capability ontbreekt of revisie is verouderd' USING ERRCODE='40001';
    END IF;
    next_revision:=previous_revision+1;
    INSERT INTO equipment_capability_revision(capability_id,revision,value,created_by,reason)
        VALUES (p_capability,next_revision,p_value,actor,p_reason);
    RETURN next_revision;
END $$;

REVOKE ALL ON FUNCTION resource_property_create(text,text,uuid,uuid),
    resource_capability_create(uuid,uuid,numeric,text),
    resource_capability_revise(uuid,integer,numeric,text) FROM PUBLIC;
