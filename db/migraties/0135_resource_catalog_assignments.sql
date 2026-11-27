-- Migratie 0135: persoonlijk beheer van klassekoppelingen en assettoewijzingen (#114.5c).
SET search_path = fabriek, public;

-- Permanente auditidentiteit naast de bestaande samengestelde primaire sleutel.
ALTER TABLE equipment_class_assignment ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE;
CREATE TRIGGER equipment_class_assignment_audit AFTER INSERT ON equipment_class_assignment
    FOR EACH ROW EXECUTE FUNCTION log_config();
CREATE TRIGGER equipment_asset_assignment_audit AFTER INSERT OR UPDATE ON equipment_asset_assignment
    FOR EACH ROW EXECUTE FUNCTION log_config();

CREATE FUNCTION resource_class_assign(p_equipment uuid,p_class uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE target uuid;
BEGIN
    PERFORM resource_catalog_actor();
    INSERT INTO equipment_class_assignment(equipment_id,equipment_class_id)
        VALUES (p_equipment,p_class) RETURNING id INTO target;
    RETURN target;
END $$;

CREATE FUNCTION resource_asset_assign(p_equipment uuid,p_asset uuid,p_from timestamptz) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE target uuid;
BEGIN
    PERFORM resource_catalog_actor();
    INSERT INTO equipment_asset_assignment(equipment_id,physical_asset_id,valid_from)
        VALUES (p_equipment,p_asset,p_from) RETURNING id INTO target;
    RETURN target;
END $$;

CREATE FUNCTION resource_asset_close(p_assignment uuid,p_until timestamptz) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE target uuid;
BEGIN
    PERFORM resource_catalog_actor();
    IF p_until IS NULL THEN
        RAISE EXCEPTION 'Afsluitmoment is verplicht' USING ERRCODE='22004';
    END IF;
    UPDATE equipment_asset_assignment SET valid_until=p_until
        WHERE id=p_assignment AND valid_until IS NULL RETURNING id INTO target;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Open assettoewijzing ontbreekt of is reeds afgesloten' USING ERRCODE='40001';
    END IF;
    RETURN target;
END $$;

REVOKE ALL ON FUNCTION resource_class_assign(uuid,uuid),
    resource_asset_assign(uuid,uuid,timestamptz),
    resource_asset_close(uuid,timestamptz) FROM PUBLIC;
