-- Migratie 0139: intern fundament voor getypeerde numerieke middelenkenmerken (#115.1).
SET search_path = fabriek, public;

CREATE TABLE equipment_property_definition (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL UNIQUE CHECK (code = btrim(code) AND code ~ '[^[:space:]]' AND length(code)<=100),
    name text NOT NULL CHECK (name ~ '[^[:space:]]' AND length(name)<=250),
    quantity_kind_id uuid NOT NULL REFERENCES quantity_kind(id),
    measurement_unit_id uuid NOT NULL,
    FOREIGN KEY (quantity_kind_id,measurement_unit_id) REFERENCES measurement_unit(quantity_kind_id,id)
);

CREATE TABLE equipment_capability (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    equipment_id uuid NOT NULL REFERENCES equipment(id),
    property_definition_id uuid NOT NULL REFERENCES equipment_property_definition(id),
    UNIQUE (equipment_id,property_definition_id)
);
CREATE INDEX equipment_capability_property_idx ON equipment_capability(property_definition_id);

CREATE TABLE equipment_capability_revision (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    capability_id uuid NOT NULL REFERENCES equipment_capability(id),
    revision integer NOT NULL CHECK (revision>0),
    value numeric NOT NULL CHECK (value NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
    created_by uuid NOT NULL REFERENCES gebruiker(id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(created_at)),
    reason text NOT NULL CHECK (reason ~ '[^[:space:]]' AND length(reason)<=2000),
    UNIQUE (capability_id,revision)
);

-- Eerste slice: identiteit en historie append-only, ook voor de eigenaar.
-- Naamcorrectie en persoonlijke actorbinding volgen in de beheerinterface.
CREATE FUNCTION equipment_capability_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
    RAISE EXCEPTION 'Middeleneigenschap of revisie is onveranderlijk' USING ERRCODE='55000';
END $$;
CREATE TRIGGER equipment_property_definition_immutable
    BEFORE UPDATE OR DELETE ON equipment_property_definition
    FOR EACH ROW EXECUTE FUNCTION equipment_capability_immutable();
CREATE TRIGGER equipment_capability_immutable
    BEFORE UPDATE OR DELETE ON equipment_capability
    FOR EACH ROW EXECUTE FUNCTION equipment_capability_immutable();
CREATE TRIGGER equipment_capability_revision_immutable
    BEFORE UPDATE OR DELETE ON equipment_capability_revision
    FOR EACH ROW EXECUTE FUNCTION equipment_capability_immutable();

-- Volgorde en serialisatie per capability. De persoonlijke beheerfunctie
-- controleert later bovendien de door de gebruiker verwachte vorige revisie.
CREATE FUNCTION equipment_capability_revision_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE previous_revision integer;
BEGIN
    PERFORM id FROM equipment_capability WHERE id=NEW.capability_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Onbekende capability' USING ERRCODE='23503';
    END IF;
    SELECT coalesce(max(revision),0) INTO previous_revision
        FROM equipment_capability_revision WHERE capability_id=NEW.capability_id;
    IF NEW.revision::bigint <> previous_revision::bigint+1 THEN
        RAISE EXCEPTION 'Ongeldige of verouderde capabilityrevisie' USING ERRCODE='40001';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER equipment_capability_revision_guard
    BEFORE INSERT ON equipment_capability_revision
    FOR EACH ROW EXECUTE FUNCTION equipment_capability_revision_guard();

REVOKE ALL ON equipment_property_definition,equipment_capability,equipment_capability_revision FROM PUBLIC;
REVOKE ALL ON FUNCTION equipment_capability_immutable(),equipment_capability_revision_guard() FROM PUBLIC;
