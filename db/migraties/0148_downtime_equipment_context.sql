-- Migratie 0148: optionele middelcontext voor bestaande stilstand (#115.5b).
SET search_path = fabriek, public;

-- Historische registraties behouden NULL; geen afgeleide of verzonnen mapping.
ALTER TABLE stilstand ADD COLUMN equipment_id uuid REFERENCES equipment(id);
CREATE INDEX stilstand_equipment_idx ON stilstand(equipment_id) WHERE equipment_id IS NOT NULL;

-- Gefaseerde opening: ook interne schrijvers mogen nog geen middelcontext
-- registreren totdat autorisatie, cardinaliteit en replay zijn uitgewerkt.
ALTER TABLE stilstand ADD CONSTRAINT stilstand_equipment_pending CHECK (equipment_id IS NULL);

CREATE FUNCTION stilstand_equipment_context_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
    IF NEW.equipment_id IS DISTINCT FROM OLD.equipment_id THEN
        RAISE EXCEPTION 'Middelcontext van stilstand is onveranderlijk' USING ERRCODE='55000';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER stilstand_equipment_context_guard BEFORE UPDATE ON stilstand
    FOR EACH ROW EXECUTE FUNCTION stilstand_equipment_context_guard();
REVOKE ALL ON FUNCTION stilstand_equipment_context_guard() FROM PUBLIC;

-- Bestaande unieke index, persoonscontrole, melding en afsluiting ongewijzigd.
