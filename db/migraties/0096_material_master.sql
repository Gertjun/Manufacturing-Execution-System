-- Migratie 0096: relationeel materiaalstamdatafundament (D89 M01-M05).
SET search_path = fabriek, public;

-- Stabiele materiaalclassificatie; geen automatisch afgeleide classificaties.
CREATE TABLE material_class (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL UNIQUE CHECK (btrim(code) <> ''),
    name text NOT NULL CHECK (btrim(name) <> '')
);

-- Materiaalidentiteit met expliciete koppelingen naar behouden PoC-identiteiten.
CREATE TABLE material_definition (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL UNIQUE CHECK (btrim(code) <> ''),
    product_id uuid UNIQUE REFERENCES product(id),
    raw_material_id uuid UNIQUE REFERENCES grondstof(id)
);

-- Onveranderlijke materiaalversie; ontbrekende classificatie of eenheid blijft onbekend.
CREATE TABLE material_definition_version (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    material_definition_id uuid NOT NULL REFERENCES material_definition(id),
    revision integer NOT NULL CHECK (revision > 0),
    name text NOT NULL CHECK (btrim(name) <> ''),
    material_class_id uuid REFERENCES material_class(id),
    unit text CHECK (unit IS NULL OR btrim(unit) <> ''),
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by uuid NOT NULL REFERENCES gebruiker(id),
    UNIQUE (material_definition_id, revision)
);

CREATE FUNCTION material_version_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
    RAISE EXCEPTION 'Materiaalversie is onveranderlijk' USING ERRCODE='55000';
END $$;
CREATE TRIGGER material_version_immutable BEFORE UPDATE OR DELETE ON material_definition_version
 FOR EACH ROW EXECUTE FUNCTION material_version_immutable();
REVOKE ALL ON FUNCTION material_version_immutable() FROM PUBLIC;

-- Geen directe app-toegang. De bestaande ACL-allowlists verlenen geen
-- rechten aan deze tabellen. Gecontroleerde persoonlijke functies volgen
-- vóór de eerste API; migratie van brongegevens volgt onder #113.
REVOKE ALL ON material_class, material_definition, material_definition_version FROM PUBLIC;
