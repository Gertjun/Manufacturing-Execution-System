-- Migratie 0142: persoonlijke technische capaciteitsaanwijzing (#115.2c).
SET search_path = fabriek, public;

CREATE TRIGGER equipment_capacity_audit AFTER INSERT ON equipment_capacity
    FOR EACH ROW EXECUTE FUNCTION log_config();

-- Scope uit de onveranderlijke capability, geen door de client gekozen scope.
-- Verlang de expliciet beoordeelde revisie, ook als de nieuwe waarde positief is.
CREATE FUNCTION resource_capacity_designate(p_capability uuid,p_expected integer) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_equipment uuid; current_revision integer; target uuid;
BEGIN
    SELECT equipment_id INTO v_equipment FROM equipment_capability WHERE id=p_capability;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Geen actuele middelenbeheerbevoegdheid voor deze scope' USING ERRCODE='42501';
    END IF;
    PERFORM resource_scoped_actor(NULL,v_equipment);
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'Capaciteitsaanwijzing vereist read committed' USING ERRCODE='25001';
    END IF;
    PERFORM id FROM equipment_capability WHERE id=p_capability FOR UPDATE;
    SELECT max(revision) INTO current_revision
        FROM equipment_capability_revision WHERE capability_id=p_capability;
    IF current_revision IS NULL OR current_revision IS DISTINCT FROM p_expected THEN
        RAISE EXCEPTION 'Capability ontbreekt of revisie is verouderd' USING ERRCODE='40001';
    END IF;
    INSERT INTO equipment_capacity(capability_id)
        VALUES (p_capability) RETURNING id INTO target;
    RETURN target;
END $$;
REVOKE ALL ON FUNCTION resource_capacity_designate(uuid,integer) FROM PUBLIC;
