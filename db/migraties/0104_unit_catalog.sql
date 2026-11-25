-- Migratie 0104: fysische dimensies, grootheden, eenheden en conversieversies (D106/#141).
SET search_path = fabriek, public;

-- SI-basisdimensies: lengte, massa, tijd, stroom, temperatuur,
-- hoeveelheid stof en lichtsterkte. Dimensionele gelijkheid alleen is
-- onvoldoende voor conversie (bv. energie/koppel of absolute/delta-temperatuur).
CREATE TABLE quantity_dimension (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    length_exp smallint NOT NULL,
    mass_exp smallint NOT NULL,
    time_exp smallint NOT NULL,
    current_exp smallint NOT NULL,
    temperature_exp smallint NOT NULL,
    amount_exp smallint NOT NULL,
    luminous_exp smallint NOT NULL,
    UNIQUE (length_exp,mass_exp,time_exp,current_exp,temperature_exp,amount_exp,luminous_exp)
);
CREATE TABLE quantity_kind (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dimension_id uuid NOT NULL REFERENCES quantity_dimension(id),
    code text NOT NULL UNIQUE CHECK (code ~ '[^[:space:]]' AND length(code)<=100),
    name text NOT NULL CHECK (name ~ '[^[:space:]]'),
    value_semantics text NOT NULL CHECK (value_semantics IN ('ratio','absolute','difference')),
    UNIQUE (id,value_semantics)
);
CREATE TABLE measurement_unit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    quantity_kind_id uuid NOT NULL REFERENCES quantity_kind(id),
    code text NOT NULL UNIQUE CHECK (code ~ '[^[:space:]]' AND length(code)<=100),
    symbol text NOT NULL CHECK (symbol ~ '[^[:space:]]' AND length(symbol)<=40),
    name text NOT NULL CHECK (name ~ '[^[:space:]]'),
    UNIQUE (quantity_kind_id,id)
);
CREATE TABLE unit_conversion (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    quantity_kind_id uuid NOT NULL REFERENCES quantity_kind(id),
    from_unit_id uuid NOT NULL,
    to_unit_id uuid NOT NULL,
    UNIQUE (from_unit_id,to_unit_id),
    UNIQUE (id,quantity_kind_id),
    FOREIGN KEY (quantity_kind_id,from_unit_id) REFERENCES measurement_unit(quantity_kind_id,id),
    FOREIGN KEY (quantity_kind_id,to_unit_id) REFERENCES measurement_unit(quantity_kind_id,id),
    CHECK (from_unit_id<>to_unit_id)
);
CREATE TABLE unit_conversion_version (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversion_id uuid NOT NULL,
    quantity_kind_id uuid NOT NULL,
    value_semantics text NOT NULL,
    revision integer NOT NULL CHECK (revision>0),
    factor_numerator numeric NOT NULL CHECK (factor_numerator>0 AND factor_numerator NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
    factor_denominator numeric NOT NULL CHECK (factor_denominator>0 AND factor_denominator NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
    additive_offset numeric NOT NULL CHECK (additive_offset NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
    source_reference text NOT NULL CHECK (source_reference ~ '[^[:space:]]'),
    created_by uuid NOT NULL REFERENCES gebruiker(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (conversion_id,quantity_kind_id) REFERENCES unit_conversion(id,quantity_kind_id),
    FOREIGN KEY (quantity_kind_id,value_semantics) REFERENCES quantity_kind(id,value_semantics),
    UNIQUE (conversion_id,revision),
    CHECK (value_semantics='absolute' OR additive_offset=0)
);

-- Catalogusidentiteiten zijn onveranderlijk; correctie vereist nieuwe
-- definitie of conversierevisie, nooit wijziging van een historisch record.
CREATE FUNCTION unit_catalog_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Eenhedencatalogus en conversieversies zijn onveranderlijk' USING ERRCODE='55000';
END $$;
CREATE TRIGGER quantity_dimension_immutable BEFORE UPDATE OR DELETE ON quantity_dimension
 FOR EACH ROW EXECUTE FUNCTION unit_catalog_immutable();
CREATE TRIGGER quantity_kind_immutable BEFORE UPDATE OR DELETE ON quantity_kind
 FOR EACH ROW EXECUTE FUNCTION unit_catalog_immutable();
CREATE TRIGGER measurement_unit_immutable BEFORE UPDATE OR DELETE ON measurement_unit
 FOR EACH ROW EXECUTE FUNCTION unit_catalog_immutable();
CREATE TRIGGER unit_conversion_immutable BEFORE UPDATE OR DELETE ON unit_conversion
 FOR EACH ROW EXECUTE FUNCTION unit_catalog_immutable();
CREATE TRIGGER unit_conversion_version_immutable BEFORE UPDATE OR DELETE ON unit_conversion_version
 FOR EACH ROW EXECUTE FUNCTION unit_catalog_immutable();

CREATE TRIGGER quantity_dimension_audit AFTER INSERT ON quantity_dimension FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();
CREATE TRIGGER quantity_kind_audit AFTER INSERT ON quantity_kind FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();
CREATE TRIGGER measurement_unit_audit AFTER INSERT ON measurement_unit FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();
CREATE TRIGGER unit_conversion_audit AFTER INSERT ON unit_conversion FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();
CREATE TRIGGER unit_conversion_version_audit AFTER INSERT ON unit_conversion_version FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();

-- Verbind de nieuwe catalogus expliciet met de bestaande conceptdefinities.
-- Onbekende legacy-eenheden worden niet automatisch op basis van tekst gekoppeld.
-- Tekst blijft tijdelijk behouden voor migratie en bestaande interfaces.
ALTER TABLE material_definition_version ADD COLUMN measurement_unit_id uuid REFERENCES measurement_unit(id);
ALTER TABLE recipe_parameter ADD COLUMN measurement_unit_id uuid REFERENCES measurement_unit(id);
ALTER TABLE recipe_parameter ADD CONSTRAINT recipe_parameter_numeric_unit
 CHECK (measurement_unit_id IS NULL OR data_type IN ('decimal','integer'));
ALTER TABLE recipe_formula ADD COLUMN reference_unit_id uuid REFERENCES measurement_unit(id);
ALTER TABLE recipe_material_requirement ADD COLUMN measurement_unit_id uuid REFERENCES measurement_unit(id);

-- Voorkom tegenstrijdige tekst en cataloguskoppeling. Bij materialen blijft
-- de exacte materiaalversie leidend; andere eenheid vereist later een
-- expliciete conversiedefinitie, niet een stilzwijgende aanpassing.
CREATE FUNCTION measurement_unit_link_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE uid uuid; label text; canonical text; material_uid uuid;
BEGIN
 IF TG_TABLE_NAME='recipe_formula' THEN
   uid:=NEW.reference_unit_id;
   label:=NEW.reference_unit;
   IF TG_OP='UPDATE' THEN
     IF NEW.reference_unit_id IS DISTINCT FROM OLD.reference_unit_id AND
        (EXISTS (SELECT 1 FROM recipe_material_requirement WHERE formula_id=OLD.id)
         OR EXISTS (SELECT 1 FROM recipe_parameter_limit WHERE recipe_version_id=OLD.recipe_version_id AND scaling='linear')) THEN
       RAISE EXCEPTION 'Herdefinieer eerst afhankelijke formulewaarden bij eenheidskoppeling' USING ERRCODE='23514';
     END IF;
   END IF;
 ELSE
   uid:=NEW.measurement_unit_id;
   label:=NEW.unit;
   IF TG_TABLE_NAME='recipe_parameter' AND TG_OP='UPDATE' THEN
     IF NEW.measurement_unit_id IS DISTINCT FROM OLD.measurement_unit_id AND
        EXISTS (SELECT 1 FROM recipe_parameter_limit WHERE recipe_version_id=OLD.recipe_version_id AND parameter_id=OLD.id) THEN
       RAISE EXCEPTION 'Herdefinieer eerst voorwaarden bij eenheidskoppeling' USING ERRCODE='23514';
     END IF;
   END IF;
 END IF;
 IF uid IS NOT NULL THEN
   SELECT symbol INTO canonical FROM measurement_unit WHERE id=uid;
   IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende eenheid' USING ERRCODE='23503'; END IF;
   IF canonical IS DISTINCT FROM label THEN
     RAISE EXCEPTION 'Eenheidstekst wijkt af van catalogusdefinitie' USING ERRCODE='23514';
   END IF;
 END IF;
 IF TG_TABLE_NAME='recipe_material_requirement' THEN
   SELECT measurement_unit_id INTO material_uid FROM material_definition_version WHERE id=NEW.material_version_id;
   IF material_uid IS DISTINCT FROM uid THEN
     RAISE EXCEPTION 'Materiaaleenheid vereist dezelfde cataloguskoppeling' USING ERRCODE='23514';
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER measurement_unit_link_guard BEFORE INSERT ON material_definition_version
 FOR EACH ROW EXECUTE FUNCTION measurement_unit_link_guard();
CREATE TRIGGER measurement_unit_link_guard BEFORE INSERT OR UPDATE ON recipe_parameter
 FOR EACH ROW EXECUTE FUNCTION measurement_unit_link_guard();
CREATE TRIGGER measurement_unit_link_guard BEFORE INSERT OR UPDATE ON recipe_formula
 FOR EACH ROW EXECUTE FUNCTION measurement_unit_link_guard();
CREATE TRIGGER measurement_unit_link_guard BEFORE INSERT OR UPDATE ON recipe_material_requirement
 FOR EACH ROW EXECUTE FUNCTION measurement_unit_link_guard();

REVOKE ALL ON FUNCTION unit_catalog_immutable(),measurement_unit_link_guard() FROM PUBLIC;
REVOKE ALL ON quantity_dimension,quantity_kind,measurement_unit,unit_conversion,unit_conversion_version FROM PUBLIC;

-- Geen standaardcatalogus, conversie-uitvoering of directe runtimewrites.
-- Persoonlijk beheer, versiecreatie, selectie van exacte conversieversies,
-- vrijgavecontrole en gecontroleerde bronmapping volgen binnen fase 2.
-- Contextafhankelijke conversies en de uitvoeringsengine volgen fase 6.
