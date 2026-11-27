-- Migratie 0132: fysieke assets en historische middeltoewijzing (#114.4).
SET search_path = fabriek, public;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;

CREATE TABLE physical_asset (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL UNIQUE CHECK (code = btrim(code) AND code ~ '[^[:space:]]'),
    name text NOT NULL CHECK (name ~ '[^[:space:]]')
);
CREATE TRIGGER physical_asset_identity_guard
    BEFORE UPDATE OR DELETE ON physical_asset
    FOR EACH ROW EXECUTE FUNCTION equipment_catalog_identity_guard();

-- Een asset kan op een gegeven moment maar aan één functioneel middel
-- gekoppeld zijn. Een middel kan meerdere afzonderlijke assets bevatten.
-- Halfopen intervallen: aansluitende toewijzingen zijn toegestaan.
CREATE TABLE equipment_asset_assignment (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    equipment_id uuid NOT NULL REFERENCES equipment(id),
    physical_asset_id uuid NOT NULL REFERENCES physical_asset(id),
    valid_from timestamptz NOT NULL CHECK (isfinite(valid_from)),
    valid_until timestamptz,
    CHECK (valid_until IS NULL OR (isfinite(valid_until) AND valid_until > valid_from)),
    EXCLUDE USING gist (
        physical_asset_id WITH =,
        tstzrange(valid_from,valid_until,'[)') WITH &&
    )
);
CREATE INDEX equipment_asset_assignment_equipment_idx ON equipment_asset_assignment(equipment_id);

CREATE FUNCTION equipment_asset_assignment_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION 'Assettoewijzing mag niet worden verwijderd' USING ERRCODE='55000';
    END IF;
    IF (NEW.id,NEW.equipment_id,NEW.physical_asset_id,NEW.valid_from)
        IS DISTINCT FROM (OLD.id,OLD.equipment_id,OLD.physical_asset_id,OLD.valid_from)
       OR OLD.valid_until IS NOT NULL OR NEW.valid_until IS NULL THEN
        RAISE EXCEPTION 'Assettoewijzing mag uitsluitend eenmaal worden afgesloten' USING ERRCODE='55000';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER equipment_asset_assignment_guard
    BEFORE UPDATE OR DELETE ON equipment_asset_assignment
    FOR EACH ROW EXECUTE FUNCTION equipment_asset_assignment_guard();

-- Alleen intern fundament; persoonlijke afsluitinterface en audit volgen.
REVOKE ALL ON physical_asset, equipment_asset_assignment FROM PUBLIC;
REVOKE ALL ON FUNCTION equipment_asset_assignment_guard() FROM PUBLIC;
