-- Migratie 0141: expliciete technische capaciteitsaanwijzing (#115.2b).
SET search_path = fabriek, public;

-- Geen tweede waarde of eenheid: beide volgen uit de capability.
CREATE TABLE equipment_capacity (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    capability_id uuid NOT NULL UNIQUE REFERENCES equipment_capability(id)
);

CREATE FUNCTION equipment_capacity_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_value numeric;
BEGIN
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'Capaciteitsaanwijzing vereist read committed' USING ERRCODE='25001';
    END IF;
    PERFORM id FROM equipment_capability WHERE id=NEW.capability_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Onbekende capability' USING ERRCODE='23503';
    END IF;
    SELECT value INTO current_value FROM equipment_capability_revision
        WHERE capability_id=NEW.capability_id ORDER BY revision DESC LIMIT 1;
    IF NOT FOUND OR current_value<=0 OR current_value IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) THEN
        RAISE EXCEPTION 'Technische capaciteit vereist een positieve eindige actuele waarde' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER equipment_capacity_guard BEFORE INSERT ON equipment_capacity
    FOR EACH ROW EXECUTE FUNCTION equipment_capacity_guard();
CREATE TRIGGER equipment_capacity_immutable BEFORE UPDATE OR DELETE ON equipment_capacity
    FOR EACH ROW EXECUTE FUNCTION equipment_capability_immutable();

-- Gebruik dezelfde rijlock bij beide schrijfpaden. Read committed is nodig
-- voor een verse snapshot na de lock; hogere isolatieniveaus zijn hier niet
-- ondersteund omdat een aanwijzing anders buiten de snapshot kan vallen.
CREATE OR REPLACE FUNCTION equipment_capability_revision_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE previous_revision integer;
BEGIN
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'Capabilityrevisie vereist read committed' USING ERRCODE='25001';
    END IF;
    PERFORM id FROM equipment_capability WHERE id=NEW.capability_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Onbekende capability' USING ERRCODE='23503';
    END IF;
    SELECT coalesce(max(revision),0) INTO previous_revision
        FROM equipment_capability_revision WHERE capability_id=NEW.capability_id;
    IF NEW.revision::bigint <> previous_revision::bigint+1 THEN
        RAISE EXCEPTION 'Ongeldige of verouderde capabilityrevisie' USING ERRCODE='40001';
    END IF;
    IF EXISTS (SELECT 1 FROM equipment_capacity WHERE capability_id=NEW.capability_id)
       AND (NEW.value<=0 OR NEW.value IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)) THEN
        RAISE EXCEPTION 'Technische capaciteit vereist een positieve eindige waarde' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON equipment_capacity FROM PUBLIC;
REVOKE ALL ON FUNCTION equipment_capacity_guard(),equipment_capability_revision_guard() FROM PUBLIC;
