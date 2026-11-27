-- Migratie 0131: intern middelen- en classificatiefundament (#114.3).
SET search_path = fabriek, public;

-- Permanente classificatie-identiteit; nog geen receptvrijgavebewijs.
CREATE TABLE equipment_class (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL UNIQUE CHECK (code = btrim(code) AND code ~ '[^[:space:]]'),
    name text NOT NULL CHECK (name ~ '[^[:space:]]')
);

-- Functionele identiteit, los van de later toegewezen fysieke asset.
CREATE TABLE equipment (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL UNIQUE CHECK (code = btrim(code) AND code ~ '[^[:space:]]'),
    name text NOT NULL CHECK (name ~ '[^[:space:]]'),
    hierarchy_id uuid NOT NULL REFERENCES equipment_hierarchy(id)
);
CREATE INDEX equipment_hierarchy_id_idx ON equipment(hierarchy_id);

-- N:M classificatie; wijziging en intrekking vereisen later een lifecyclecontract.
CREATE TABLE equipment_class_assignment (
    equipment_id uuid NOT NULL REFERENCES equipment(id),
    equipment_class_id uuid NOT NULL REFERENCES equipment_class(id),
    PRIMARY KEY (equipment_id, equipment_class_id)
);
CREATE INDEX equipment_class_assignment_class_idx ON equipment_class_assignment(equipment_class_id);

CREATE FUNCTION equipment_catalog_identity_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION 'Middel of klasse mag niet worden verwijderd' USING ERRCODE='55000';
    END IF;
    IF (NEW.id,NEW.code) IS DISTINCT FROM (OLD.id,OLD.code) THEN
        RAISE EXCEPTION 'Middel- of klasse-identiteit is onveranderlijk' USING ERRCODE='55000';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER equipment_class_identity_guard
    BEFORE UPDATE OR DELETE ON equipment_class
    FOR EACH ROW EXECUTE FUNCTION equipment_catalog_identity_guard();
CREATE TRIGGER equipment_identity_guard
    BEFORE UPDATE OR DELETE ON equipment
    FOR EACH ROW EXECUTE FUNCTION equipment_catalog_identity_guard();

CREATE FUNCTION equipment_location_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
    IF NEW.hierarchy_id IS DISTINCT FROM OLD.hierarchy_id THEN
        RAISE EXCEPTION 'Middelenlocatie vereist gecontroleerde verplaatsing' USING ERRCODE='55000';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER equipment_location_guard BEFORE UPDATE ON equipment
    FOR EACH ROW EXECUTE FUNCTION equipment_location_guard();

CREATE FUNCTION equipment_class_assignment_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
    RAISE EXCEPTION 'Klassekoppeling vereist gecontroleerde lifecycle' USING ERRCODE='55000';
END $$;
CREATE TRIGGER equipment_class_assignment_guard
    BEFORE UPDATE OR DELETE ON equipment_class_assignment
    FOR EACH ROW EXECUTE FUNCTION equipment_class_assignment_guard();

-- Geen applicatie-interface of automatische historische mapping.
-- De bestaande 0077/0078 ACL-allowlists kennen deze tabellen geen rechten toe.
REVOKE ALL ON equipment_class, equipment, equipment_class_assignment FROM PUBLIC;
REVOKE ALL ON FUNCTION equipment_catalog_identity_guard(), equipment_location_guard(), equipment_class_assignment_guard() FROM PUBLIC;
