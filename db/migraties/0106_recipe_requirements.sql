-- Migratie 0106: receptgebonden middelen-, personeels- en registratievereisten (#111).
SET search_path = fabriek, public;

-- Voorlopig expliciete equipmentklasse-eis; definitieve resourcecatalogus
-- en fysieke toewijzing volgen fase 4. Geen verwijzing naar een legacy-pc.
CREATE TABLE recipe_equipment_requirement (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 recipe_version_id uuid NOT NULL REFERENCES master_recipe_version(id),
 procedural_element_id uuid NOT NULL,
 code text NOT NULL CHECK (code ~ '[^[:space:]]'),
 equipment_class_code text NOT NULL CHECK (equipment_class_code ~ '[^[:space:]]'),
 description text NOT NULL CHECK (description ~ '[^[:space:]]'),
 required_count integer NOT NULL CHECK (required_count>0),
 minimum_capacity numeric,
 capacity_unit_id uuid REFERENCES measurement_unit(id),
 FOREIGN KEY (recipe_version_id,procedural_element_id) REFERENCES recipe_procedural_element(recipe_version_id,id),
 UNIQUE (recipe_version_id,code),
 CHECK ((minimum_capacity IS NULL)=(capacity_unit_id IS NULL)),
 CHECK (minimum_capacity IS NULL OR (minimum_capacity>0 AND minimum_capacity NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)))
);

-- Een kwalificatie-eis is geen toekenning van een kwalificatie of permission.
-- Bewaar de omschrijving bij de receptversie; definitieve kwalificatiecontrole
-- vindt plaats bij toewijzing en uitvoering.
CREATE TABLE recipe_personnel_requirement (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 recipe_version_id uuid NOT NULL REFERENCES master_recipe_version(id),
 procedural_element_id uuid NOT NULL,
 code text NOT NULL CHECK (code ~ '[^[:space:]]'),
 qualification_code text NOT NULL REFERENCES qualification(code),
 qualification_description text NOT NULL CHECK (qualification_description ~ '[^[:space:]]'),
 required_count integer NOT NULL CHECK (required_count>0),
 FOREIGN KEY (recipe_version_id,procedural_element_id) REFERENCES recipe_procedural_element(recipe_version_id,id),
 UNIQUE (recipe_version_id,code),
 UNIQUE (recipe_version_id,procedural_element_id,qualification_code)
);

CREATE TABLE recipe_instruction (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 recipe_version_id uuid NOT NULL REFERENCES master_recipe_version(id),
 procedural_element_id uuid NOT NULL,
 code text NOT NULL CHECK (code ~ '[^[:space:]]'),
 position integer NOT NULL CHECK (position>0),
 instruction_text text NOT NULL CHECK (instruction_text ~ '[^[:space:]]'),
 confirmation_required boolean NOT NULL,
 FOREIGN KEY (recipe_version_id,procedural_element_id) REFERENCES recipe_procedural_element(recipe_version_id,id),
 UNIQUE (recipe_version_id,code),
 UNIQUE (recipe_version_id,procedural_element_id,position)
);

-- Kwaliteitseis verwijst naar de exacte versiegebonden specificatiegrens
-- binnen het MBR, niet naar een dynamische 'laatste' PoC-specificatie.
-- Een afzonderlijke definitieve kwaliteitscatalogus volgt waar nodig;
-- bronmapping van oude specificaties onder #113, geen verzonnen historie.
CREATE TABLE recipe_specification_link (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 recipe_version_id uuid NOT NULL REFERENCES master_recipe_version(id),
 parameter_limit_id uuid NOT NULL,
 code text NOT NULL CHECK (code ~ '[^[:space:]]'),
 description text NOT NULL CHECK (description ~ '[^[:space:]]'),
 FOREIGN KEY (recipe_version_id,parameter_limit_id) REFERENCES recipe_parameter_limit(recipe_version_id,id),
 UNIQUE (recipe_version_id,code),
 UNIQUE (recipe_version_id,parameter_limit_id)
);

CREATE FUNCTION recipe_requirement_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v uuid; expected_description text;
BEGIN
 v:=CASE WHEN TG_OP='DELETE' THEN OLD.recipe_version_id ELSE NEW.recipe_version_id END;
 PERFORM 1 FROM master_recipe_version WHERE id=v FOR UPDATE;
 IF TG_OP='UPDATE' THEN
   IF NEW.id IS DISTINCT FROM OLD.id OR NEW.recipe_version_id IS DISTINCT FROM OLD.recipe_version_id THEN
     RAISE EXCEPTION 'Receptvereiste-identiteit en versie zijn onveranderlijk' USING ERRCODE='55000';
   END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF TG_TABLE_NAME='recipe_personnel_requirement' THEN
   SELECT description INTO expected_description FROM qualification WHERE code=NEW.qualification_code FOR SHARE;
   IF NOT FOUND OR expected_description IS DISTINCT FROM NEW.qualification_description THEN
     RAISE EXCEPTION 'Kwalificatie-eis vereist exacte bekende kwalificatieomschrijving' USING ERRCODE='23514';
   END IF;
 ELSIF TG_TABLE_NAME='recipe_specification_link' THEN
   IF NOT EXISTS (
     SELECT 1 FROM recipe_parameter_limit WHERE recipe_version_id=v AND id=NEW.parameter_limit_id AND category='specification_limit'
   ) THEN
     RAISE EXCEPTION 'Kwaliteitseis vereist een specificatiegrens in dezelfde receptversie' USING ERRCODE='23514';
   END IF;
 END IF;
 RETURN NEW;
END $$;

-- Een grens mag niet van categorie veranderen zolang een kwaliteitseis
-- naar die grens verwijst. Receptversie en scope worden elders beschermd.
CREATE FUNCTION recipe_specification_category_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
 PERFORM 1 FROM master_recipe_version WHERE id=OLD.recipe_version_id FOR UPDATE;
 IF NEW.category IS DISTINCT FROM OLD.category AND EXISTS (
   SELECT 1 FROM recipe_specification_link WHERE recipe_version_id=OLD.recipe_version_id AND parameter_limit_id=OLD.id
 ) THEN
   RAISE EXCEPTION 'Gekoppelde kwaliteitseis vereist specificatiegrens' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recipe_specification_category_guard BEFORE UPDATE ON recipe_parameter_limit
 FOR EACH ROW EXECUTE FUNCTION recipe_specification_category_guard();

CREATE TRIGGER recipe_equipment_requirement_guard BEFORE INSERT OR UPDATE OR DELETE ON recipe_equipment_requirement
 FOR EACH ROW EXECUTE FUNCTION recipe_requirement_guard();
CREATE TRIGGER recipe_equipment_requirement_audit AFTER INSERT OR UPDATE OR DELETE ON recipe_equipment_requirement
 FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();
CREATE TRIGGER recipe_personnel_requirement_guard BEFORE INSERT OR UPDATE OR DELETE ON recipe_personnel_requirement
 FOR EACH ROW EXECUTE FUNCTION recipe_requirement_guard();
CREATE TRIGGER recipe_personnel_requirement_audit AFTER INSERT OR UPDATE OR DELETE ON recipe_personnel_requirement
 FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();
CREATE TRIGGER recipe_instruction_guard BEFORE INSERT OR UPDATE OR DELETE ON recipe_instruction
 FOR EACH ROW EXECUTE FUNCTION recipe_requirement_guard();
CREATE TRIGGER recipe_instruction_audit AFTER INSERT OR UPDATE OR DELETE ON recipe_instruction
 FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();
CREATE TRIGGER recipe_specification_link_guard BEFORE INSERT OR UPDATE OR DELETE ON recipe_specification_link
 FOR EACH ROW EXECUTE FUNCTION recipe_requirement_guard();
CREATE TRIGGER recipe_specification_link_audit AFTER INSERT OR UPDATE OR DELETE ON recipe_specification_link
 FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();

REVOKE ALL ON FUNCTION recipe_requirement_guard(),recipe_specification_category_guard() FROM PUBLIC;
REVOKE ALL ON recipe_equipment_requirement,recipe_personnel_requirement,recipe_instruction,recipe_specification_link FROM PUBLIC;
-- Geen runtimewrites, fysieke toewijzingen, kwalificatietoekenning,
-- kwaliteitsvrijgave of uitvoeringsregistraties. Equipmentklasse en
-- kwalificatiebetekenis vereisen latere gecontroleerde resourcevalidatie.
