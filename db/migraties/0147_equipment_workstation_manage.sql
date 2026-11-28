-- Migratie 0147: persoonlijk beheer werkstationkoppelingen (#115.4c).
SET search_path = fabriek, public;

CREATE FUNCTION resource_workstation_open(p_pc uuid,p_equipment uuid,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; target uuid;
BEGIN
    actor:=resource_catalog_actor();
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'Werkstationkoppeling vereist read committed' USING ERRCODE='25001';
    END IF;
    PERFORM id FROM pc WHERE id=p_pc FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Onbekend werkstation' USING ERRCODE='23503';
    END IF;
    IF resource_catalog_actor() IS DISTINCT FROM actor THEN
        RAISE EXCEPTION 'Persoonlijke bevoegdheid gewijzigd' USING ERRCODE='42501';
    END IF;
    INSERT INTO equipment_workstation(pc_id,equipment_id,opened_by,open_reason)
        VALUES (p_pc,p_equipment,actor,p_reason) RETURNING id INTO target;
    RETURN target;
END $$;

CREATE FUNCTION resource_workstation_close(p_assignment uuid,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; v_pc uuid; target uuid;
BEGIN
    actor:=resource_catalog_actor();
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'Werkstationkoppeling vereist read committed' USING ERRCODE='25001';
    END IF;
    SELECT pc_id INTO v_pc FROM equipment_workstation WHERE id=p_assignment AND closed_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Open werkstationkoppeling ontbreekt of is afgesloten' USING ERRCODE='40001';
    END IF;
    -- Zelfde lockvolgorde als bij openen: eerst pc, daarna koppeling.
    PERFORM id FROM pc WHERE id=v_pc FOR UPDATE;
    IF resource_catalog_actor() IS DISTINCT FROM actor THEN
        RAISE EXCEPTION 'Persoonlijke bevoegdheid gewijzigd' USING ERRCODE='42501';
    END IF;
    UPDATE equipment_workstation SET closed_by=actor,closed_at=clock_timestamp(),close_reason=p_reason
        WHERE id=p_assignment AND closed_at IS NULL RETURNING id INTO target;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Open werkstationkoppeling ontbreekt of is afgesloten' USING ERRCODE='40001';
    END IF;
    RETURN target;
END $$;

CREATE TRIGGER equipment_workstation_audit AFTER INSERT OR UPDATE ON equipment_workstation
    FOR EACH ROW EXECUTE FUNCTION log_config();
REVOKE ALL ON FUNCTION resource_workstation_open(uuid,uuid,text),
    resource_workstation_close(uuid,text) FROM PUBLIC;
