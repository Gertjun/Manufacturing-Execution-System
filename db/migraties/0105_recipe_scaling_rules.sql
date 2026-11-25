-- Migratie 0105: getypeerde, versiegebonden schaalregeldefinities (D106/#141).
SET search_path = fabriek, public;

-- Een regel is een conceptdefinitie binnen één MBR-revisie. Een gewijzigde
-- regel valt onder dezelfde MBR-wijzigingsteller en toekomstige vrijgavepoort.
-- Geen uitvoerbare tekst, SQL, scripts of impliciete formulekeuze.
CREATE TABLE recipe_scaling_rule (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 recipe_version_id uuid NOT NULL REFERENCES master_recipe_version(id),
 code text NOT NULL CHECK (code ~ '[^[:space:]]' AND length(code)<=100),
 description text NOT NULL CHECK (description ~ '[^[:space:]]'),
 rule_kind text NOT NULL CHECK (rule_kind IN ('nonlinear','parameter_dependent','equipment_dependent')),
 output_unit_id uuid NOT NULL REFERENCES measurement_unit(id),
 source_reference text NOT NULL CHECK (source_reference ~ '[^[:space:]]'),
 applicability text NOT NULL CHECK (applicability ~ '[^[:space:]]'),
 UNIQUE (recipe_version_id,id),
 UNIQUE (recipe_version_id,code)
);

ALTER TABLE recipe_parameter_limit ADD UNIQUE (recipe_version_id,id);
ALTER TABLE recipe_material_requirement ADD UNIQUE (recipe_version_id,id);

-- Getypeerde invoerbronnen. Een equipment-eigenschap is voorlopig een
-- expliciete vereiste, niet een verwijzing naar een nog niet bestaand asset.
CREATE TABLE recipe_scaling_input (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 recipe_version_id uuid NOT NULL,
 rule_id uuid NOT NULL,
 code text NOT NULL CHECK (code ~ '[^[:space:]]' AND length(code)<=100),
 source_kind text NOT NULL CHECK (source_kind IN ('batch_quantity','parameter','equipment_property','constant')),
 parameter_id uuid,
 equipment_property text,
 constant_value numeric,
 unit_id uuid NOT NULL REFERENCES measurement_unit(id),
 conversion_version_id uuid REFERENCES unit_conversion_version(id),
 FOREIGN KEY (recipe_version_id,rule_id) REFERENCES recipe_scaling_rule(recipe_version_id,id),
 FOREIGN KEY (recipe_version_id,parameter_id) REFERENCES recipe_parameter(recipe_version_id,id),
 UNIQUE (recipe_version_id,rule_id,code),
 CHECK (
   (source_kind='batch_quantity' AND parameter_id IS NULL AND equipment_property IS NULL AND constant_value IS NULL)
   OR (source_kind='parameter' AND parameter_id IS NOT NULL AND equipment_property IS NULL AND constant_value IS NULL)
   OR (source_kind='equipment_property' AND parameter_id IS NULL AND equipment_property IS NOT NULL AND equipment_property ~ '[^[:space:]]' AND constant_value IS NULL)
   OR (source_kind='constant' AND parameter_id IS NULL AND equipment_property IS NULL AND constant_value IS NOT NULL)
 ),
 CHECK (constant_value IS NULL OR constant_value NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric')),
 CHECK (source_kind NOT IN ('constant','equipment_property') OR conversion_version_id IS NULL)
);

-- Voorbereide uitgaande koppeling. Fixed/linear blijven de enige
-- uitvoerbare basiskeuzes; een complexe definitie mag niet stilzwijgend
-- als fixed/linear worden geïnterpreteerd. Vrijgavepoort volgt in 2.5.
CREATE TABLE recipe_scaling_binding (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 recipe_version_id uuid NOT NULL,
 rule_id uuid NOT NULL,
 parameter_limit_id uuid,
 material_requirement_id uuid,
 FOREIGN KEY (recipe_version_id,rule_id) REFERENCES recipe_scaling_rule(recipe_version_id,id),
 FOREIGN KEY (recipe_version_id,parameter_limit_id) REFERENCES recipe_parameter_limit(recipe_version_id,id),
 FOREIGN KEY (recipe_version_id,material_requirement_id) REFERENCES recipe_material_requirement(recipe_version_id,id),
 UNIQUE (recipe_version_id,parameter_limit_id),
 UNIQUE (recipe_version_id,material_requirement_id),
 CHECK ((parameter_limit_id IS NOT NULL)::integer+(material_requirement_id IS NOT NULL)::integer=1)
);

-- Alle schrijvers in deze conceptgrafiek worden per receptversie geserialiseerd.
-- De bestaande parameter/formuleguards blijven van kracht.
CREATE FUNCTION recipe_scaling_graph_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v uuid; source_unit uuid; output_unit uuid; conv_from uuid; conv_to uuid;
BEGIN
 v:=CASE WHEN TG_OP='DELETE' THEN OLD.recipe_version_id ELSE NEW.recipe_version_id END;
 PERFORM 1 FROM master_recipe_version WHERE id=v FOR UPDATE;
 IF TG_OP='UPDATE' THEN
   IF NEW.id IS DISTINCT FROM OLD.id OR NEW.recipe_version_id IS DISTINCT FROM OLD.recipe_version_id THEN
     RAISE EXCEPTION 'Schaalregelidentiteit en versie zijn onveranderlijk' USING ERRCODE='55000';
   END IF;
   IF TG_TABLE_NAME='recipe_scaling_rule' THEN
     IF NEW.output_unit_id IS DISTINCT FROM OLD.output_unit_id AND EXISTS (
       SELECT 1 FROM recipe_scaling_binding WHERE rule_id=OLD.id
     ) THEN
       RAISE EXCEPTION 'Verwijder eerst de uitvoerkoppelingen bij eenheidswijziging' USING ERRCODE='23514';
     END IF;
   END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF TG_TABLE_NAME='recipe_scaling_input' THEN
   IF NEW.source_kind='batch_quantity' THEN
     SELECT reference_unit_id INTO source_unit FROM recipe_formula WHERE recipe_version_id=v;
   ELSIF NEW.source_kind='parameter' THEN
     SELECT measurement_unit_id INTO source_unit FROM recipe_parameter
       WHERE recipe_version_id=v AND id=NEW.parameter_id AND data_type IN ('decimal','integer');
   ELSE
     source_unit:=NEW.unit_id;
   END IF;
   IF source_unit IS NULL THEN
     RAISE EXCEPTION 'Schaalinvoer vereist een bekende numerieke bron en cataloguseenheid' USING ERRCODE='23514';
   END IF;
   IF NEW.conversion_version_id IS NULL THEN
     IF source_unit IS DISTINCT FROM NEW.unit_id THEN
       RAISE EXCEPTION 'Expliciete conversieversie vereist voor schaalinvoer' USING ERRCODE='23514';
     END IF;
   ELSE
     SELECT c.from_unit_id,c.to_unit_id INTO conv_from,conv_to
       FROM unit_conversion_version cv JOIN unit_conversion c ON c.id=cv.conversion_id
       WHERE cv.id=NEW.conversion_version_id;
     IF conv_from IS DISTINCT FROM source_unit OR conv_to IS DISTINCT FROM NEW.unit_id THEN
       RAISE EXCEPTION 'Conversieversie past niet bij schaalinvoer' USING ERRCODE='23514';
     END IF;
   END IF;
 ELSIF TG_TABLE_NAME='recipe_scaling_binding' THEN
   SELECT output_unit_id INTO output_unit FROM recipe_scaling_rule WHERE recipe_version_id=v AND id=NEW.rule_id;
   IF NEW.parameter_limit_id IS NOT NULL THEN
     SELECT p.measurement_unit_id INTO source_unit FROM recipe_parameter_limit l JOIN recipe_parameter p
       ON p.recipe_version_id=l.recipe_version_id AND p.id=l.parameter_id
       WHERE l.recipe_version_id=v AND l.id=NEW.parameter_limit_id;
   ELSE
     SELECT measurement_unit_id INTO source_unit FROM recipe_material_requirement
       WHERE recipe_version_id=v AND id=NEW.material_requirement_id;
   END IF;
   IF source_unit IS NULL OR source_unit IS DISTINCT FROM output_unit THEN
     RAISE EXCEPTION 'Schaaluitvoer vereist dezelfde bekende cataloguseenheid als doel' USING ERRCODE='23514';
   END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE TRIGGER recipe_scaling_rule_guard BEFORE INSERT OR UPDATE OR DELETE ON recipe_scaling_rule
 FOR EACH ROW EXECUTE FUNCTION recipe_scaling_graph_guard();
CREATE TRIGGER recipe_scaling_input_guard BEFORE INSERT OR UPDATE OR DELETE ON recipe_scaling_input
 FOR EACH ROW EXECUTE FUNCTION recipe_scaling_graph_guard();
CREATE TRIGGER recipe_scaling_binding_guard BEFORE INSERT OR UPDATE OR DELETE ON recipe_scaling_binding
 FOR EACH ROW EXECUTE FUNCTION recipe_scaling_graph_guard();

-- Conservatief conceptmodel: voorkom zelfafhankelijkheid en cycli tussen
-- regeluitvoer (parameter) en andere parameterinvoer. Alleen structurele
-- validatie, geen berekening of evaluatie van gebruikersformules.
CREATE FUNCTION recipe_scaling_check_cycles() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v uuid;
BEGIN
 v:=CASE WHEN TG_OP='DELETE' THEN OLD.recipe_version_id ELSE NEW.recipe_version_id END;
 IF EXISTS (
   WITH RECURSIVE edges(a,b) AS (
     SELECT b.rule_id,i.rule_id
       FROM recipe_scaling_binding b
       JOIN recipe_parameter_limit l ON l.recipe_version_id=b.recipe_version_id AND l.id=b.parameter_limit_id
       JOIN recipe_scaling_input i ON i.recipe_version_id=b.recipe_version_id AND i.parameter_id=l.parameter_id
       WHERE b.recipe_version_id=v AND i.source_kind='parameter'
   ), reach(a,b) AS (
     SELECT a,b FROM edges UNION SELECT r.a,e.b FROM reach r JOIN edges e ON e.a=r.b
   ) SELECT 1 FROM reach WHERE a=b
 ) THEN
   RAISE EXCEPTION 'Circulaire afhankelijkheid in schaalregels' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recipe_scaling_input_cycles AFTER INSERT OR UPDATE ON recipe_scaling_input
 FOR EACH ROW EXECUTE FUNCTION recipe_scaling_check_cycles();
CREATE TRIGGER recipe_scaling_binding_cycles AFTER INSERT OR UPDATE ON recipe_scaling_binding
 FOR EACH ROW EXECUTE FUNCTION recipe_scaling_check_cycles();

-- Voorkom dat bestaande bronnen/targets hun fysische betekenis verliezen.
CREATE FUNCTION recipe_scaling_source_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v uuid;
BEGIN
 v:=OLD.recipe_version_id;
 PERFORM 1 FROM master_recipe_version WHERE id=v FOR UPDATE;
 IF TG_TABLE_NAME='recipe_formula' THEN
   IF EXISTS (SELECT 1 FROM recipe_scaling_input WHERE recipe_version_id=v AND source_kind='batch_quantity') THEN
     IF TG_OP='DELETE' THEN
       RAISE EXCEPTION 'Referentieformule is schaalinvoer' USING ERRCODE='23514';
     ELSIF (NEW.reference_quantity,NEW.reference_unit,NEW.reference_unit_id) IS DISTINCT FROM
       (OLD.reference_quantity,OLD.reference_unit,OLD.reference_unit_id) THEN
       RAISE EXCEPTION 'Herdefinieer eerst schaalinvoer bij wijziging referentieformule' USING ERRCODE='23514';
     END IF;
   END IF;
 ELSIF TG_TABLE_NAME='recipe_parameter' THEN
   IF (NEW.data_type,NEW.unit,NEW.measurement_unit_id) IS DISTINCT FROM
      (OLD.data_type,OLD.unit,OLD.measurement_unit_id) AND (
      EXISTS (SELECT 1 FROM recipe_scaling_input WHERE recipe_version_id=v AND parameter_id=OLD.id)
      OR EXISTS (SELECT 1 FROM recipe_scaling_binding b JOIN recipe_parameter_limit l
        ON l.recipe_version_id=b.recipe_version_id AND l.id=b.parameter_limit_id
        WHERE l.recipe_version_id=v AND l.parameter_id=OLD.id)
   ) THEN
     RAISE EXCEPTION 'Herdefinieer eerst gekoppelde schaalregels bij parameterwijziging' USING ERRCODE='23514';
   END IF;
 ELSIF TG_TABLE_NAME='recipe_parameter_limit' THEN
   IF NEW.parameter_id IS DISTINCT FROM OLD.parameter_id AND EXISTS (
     SELECT 1 FROM recipe_scaling_binding WHERE recipe_version_id=v AND parameter_limit_id=OLD.id
   ) THEN
     RAISE EXCEPTION 'Gekoppelde schaaluitvoer kan niet naar andere parameter' USING ERRCODE='23514';
   END IF;
 ELSIF TG_TABLE_NAME='recipe_material_requirement' THEN
   IF (NEW.unit,NEW.measurement_unit_id) IS DISTINCT FROM (OLD.unit,OLD.measurement_unit_id) AND EXISTS (
     SELECT 1 FROM recipe_scaling_binding WHERE recipe_version_id=v AND material_requirement_id=OLD.id
   ) THEN
     RAISE EXCEPTION 'Herdefinieer eerst gekoppelde schaaluitvoer bij materiaaleenheidswijziging' USING ERRCODE='23514';
   END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recipe_formula_scaling_source_guard BEFORE UPDATE OR DELETE ON recipe_formula
 FOR EACH ROW EXECUTE FUNCTION recipe_scaling_source_guard();
CREATE TRIGGER recipe_parameter_scaling_source_guard BEFORE UPDATE ON recipe_parameter
 FOR EACH ROW EXECUTE FUNCTION recipe_scaling_source_guard();
CREATE TRIGGER recipe_limit_scaling_source_guard BEFORE UPDATE ON recipe_parameter_limit
 FOR EACH ROW EXECUTE FUNCTION recipe_scaling_source_guard();
CREATE TRIGGER recipe_material_scaling_source_guard BEFORE UPDATE ON recipe_material_requirement
 FOR EACH ROW EXECUTE FUNCTION recipe_scaling_source_guard();

CREATE TRIGGER recipe_scaling_rule_audit AFTER INSERT OR UPDATE OR DELETE ON recipe_scaling_rule
 FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();
CREATE TRIGGER recipe_scaling_input_audit AFTER INSERT OR UPDATE OR DELETE ON recipe_scaling_input
 FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();
CREATE TRIGGER recipe_scaling_binding_audit AFTER INSERT OR UPDATE OR DELETE ON recipe_scaling_binding
 FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();

REVOKE ALL ON FUNCTION recipe_scaling_graph_guard(),recipe_scaling_check_cycles(),recipe_scaling_source_guard() FROM PUBLIC;
REVOKE ALL ON recipe_scaling_rule,recipe_scaling_input,recipe_scaling_binding FROM PUBLIC;
-- Complexe regels zijn hier uitsluitend conceptmetadata. De ontbrekende
-- getypeerde formuledefinitie, validatie en vrijgaveblokkade moeten vóór
-- formele fase-2-acceptatie worden ingevuld. Evaluatie pas in fase 6.
