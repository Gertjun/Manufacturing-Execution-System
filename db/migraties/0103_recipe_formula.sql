-- Migratie 0103: referentieformule, materiaalversies en expliciet schaalbeleid (#111).
SET search_path = fabriek, public;

CREATE TABLE recipe_formula (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_version_id uuid NOT NULL UNIQUE REFERENCES master_recipe_version(id),
    reference_quantity numeric NOT NULL CHECK (reference_quantity>0 AND reference_quantity NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
    reference_unit text NOT NULL CHECK (reference_unit ~ '[^[:space:]]' AND length(reference_unit)<=40),
    UNIQUE (recipe_version_id,id)
);

CREATE TABLE recipe_material_requirement (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_version_id uuid NOT NULL,
    formula_id uuid NOT NULL,
    procedural_element_id uuid,
    material_version_id uuid NOT NULL REFERENCES material_definition_version(id),
    code text NOT NULL CHECK (code ~ '[^[:space:]]' AND length(code)<=100),
    direction text NOT NULL CHECK (direction IN ('input','output')),
    quantity numeric NOT NULL CHECK (quantity>0 AND quantity NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
    unit text NOT NULL CHECK (unit ~ '[^[:space:]]' AND length(unit)<=40),
    scaling text NOT NULL CHECK (scaling IN ('fixed','linear')),
    UNIQUE (recipe_version_id,code),
    FOREIGN KEY (recipe_version_id,formula_id) REFERENCES recipe_formula(recipe_version_id,id),
    FOREIGN KEY (recipe_version_id,procedural_element_id) REFERENCES recipe_procedural_element(recipe_version_id,id)
);

-- Een parameter is standaard vast. Alleen een expliciete schaalkeuze
-- kan een numerieke voorwaarde later laten schalen in de Control Recipe.
ALTER TABLE recipe_parameter_limit ADD COLUMN scaling text NOT NULL DEFAULT 'fixed'
 CHECK (scaling IN ('fixed','linear'));

CREATE FUNCTION recipe_formula_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v uuid; material_unit text;
BEGIN
 v:=CASE WHEN TG_OP='DELETE' THEN OLD.recipe_version_id ELSE NEW.recipe_version_id END;
 PERFORM 1 FROM master_recipe_version WHERE id=v FOR UPDATE;
 IF TG_OP='UPDATE' THEN
   IF NEW.id IS DISTINCT FROM OLD.id OR NEW.recipe_version_id IS DISTINCT FROM OLD.recipe_version_id THEN
     RAISE EXCEPTION 'Formule-identiteit en versie zijn onveranderlijk' USING ERRCODE='55000';
   END IF;
   IF TG_TABLE_NAME='recipe_formula' THEN
     IF (NEW.reference_quantity,NEW.reference_unit) IS DISTINCT FROM (OLD.reference_quantity,OLD.reference_unit)
        AND (EXISTS (SELECT 1 FROM recipe_material_requirement WHERE formula_id=OLD.id)
             OR EXISTS (SELECT 1 FROM recipe_parameter_limit WHERE recipe_version_id=v AND scaling='linear')) THEN
       RAISE EXCEPTION 'Herdefinieer eerst formulehoeveelheden en schaalbare voorwaarden bij wijziging referentiegrootte' USING ERRCODE='23514';
     END IF;
   END IF;
 END IF;
 IF TG_TABLE_NAME='recipe_material_requirement' AND TG_OP<>'DELETE' THEN
   SELECT unit INTO material_unit FROM material_definition_version WHERE id=NEW.material_version_id;
   IF NOT FOUND THEN
     RAISE EXCEPTION 'Onbekende materiaalversie' USING ERRCODE='23503';
   END IF;
   IF material_unit IS NULL OR material_unit IS DISTINCT FROM NEW.unit THEN
     RAISE EXCEPTION 'Materiaaleenheid ontbreekt of wijkt af; geen impliciete conversie' USING ERRCODE='23514';
   END IF;
 END IF;
 IF TG_TABLE_NAME='recipe_formula' AND TG_OP='DELETE' THEN
   IF EXISTS (SELECT 1 FROM recipe_parameter_limit WHERE recipe_version_id=v AND scaling='linear') THEN
     RAISE EXCEPTION 'Schaalbare voorwaarden vereisen een referentieformule' USING ERRCODE='23514';
   END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recipe_formula_guard BEFORE INSERT OR UPDATE OR DELETE ON recipe_formula
 FOR EACH ROW EXECUTE FUNCTION recipe_formula_guard();
CREATE TRIGGER recipe_material_requirement_guard BEFORE INSERT OR UPDATE OR DELETE ON recipe_material_requirement
 FOR EACH ROW EXECUTE FUNCTION recipe_formula_guard();

CREATE FUNCTION recipe_limit_scaling_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
 PERFORM 1 FROM master_recipe_version WHERE id=NEW.recipe_version_id FOR UPDATE;
 IF NEW.scaling='linear' AND NOT EXISTS (SELECT 1 FROM recipe_formula WHERE recipe_version_id=NEW.recipe_version_id) THEN
   RAISE EXCEPTION 'Schaalbare voorwaarden vereisen een referentieformule' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recipe_limit_scaling_guard BEFORE INSERT OR UPDATE ON recipe_parameter_limit
 FOR EACH ROW EXECUTE FUNCTION recipe_limit_scaling_guard();

CREATE TRIGGER recipe_formula_audit AFTER INSERT OR UPDATE OR DELETE ON recipe_formula
 FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();
CREATE TRIGGER recipe_material_requirement_audit AFTER INSERT OR UPDATE OR DELETE ON recipe_material_requirement
 FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();

REVOKE ALL ON FUNCTION recipe_formula_guard(),recipe_limit_scaling_guard() FROM PUBLIC;
REVOKE ALL ON recipe_formula,recipe_material_requirement FROM PUBLIC;
-- Geen automatisch schalen tijdens uitvoering, geen eenhedenconverter,
-- geen veronderstelde massabalans of verplichte opbrengst. Conceptbeheer volgt.
