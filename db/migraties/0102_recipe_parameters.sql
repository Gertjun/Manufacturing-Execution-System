-- Migratie 0102: versiegebonden parameters en vijf afzonderlijke voorwaarden (#111, D89 T09).
SET search_path = fabriek, public;

CREATE TABLE recipe_parameter (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_version_id uuid NOT NULL REFERENCES master_recipe_version(id),
    procedural_element_id uuid NOT NULL,
    code text NOT NULL CHECK (code ~ '[^[:space:]]' AND length(code)<=100),
    name text NOT NULL CHECK (name ~ '[^[:space:]]' AND length(name)<=250),
    data_type text NOT NULL CHECK (data_type IN ('decimal','integer','boolean','text')),
    unit text CHECK (unit IS NULL OR (unit ~ '[^[:space:]]' AND length(unit)<=40)),
    frequency text NOT NULL CHECK (frequency ~ '[^[:space:]]'),
    required boolean NOT NULL,
    responsible_activity text NOT NULL CHECK (responsible_activity ~ '[^[:space:]]'),
    critical boolean NOT NULL,
    UNIQUE (recipe_version_id,id),
    UNIQUE (recipe_version_id,id,data_type),
    UNIQUE (recipe_version_id,code),
    FOREIGN KEY (recipe_version_id,procedural_element_id)
      REFERENCES recipe_procedural_element(recipe_version_id,id),
    CHECK (data_type IN ('decimal','integer') OR unit IS NULL)
);

-- Doelwaarde is een afzonderlijk getal, niet een impliciete onder-/bovengrens.
-- De overige categorieën zijn onafhankelijk en mogen eenzijdig begrensd zijn.
-- Geen stilzwijgende omzetting naar procenten of afgeleide SPC-grenzen.
CREATE TABLE recipe_parameter_limit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_version_id uuid NOT NULL,
    parameter_id uuid NOT NULL,
    data_type text NOT NULL CHECK (data_type IN ('decimal','integer')),
    category text NOT NULL CHECK (category IN ('target','operating_tolerance','process_limit','specification_limit','statistical_control_limit')),
    target_value numeric,
    lower_value numeric,
    upper_value numeric,
    FOREIGN KEY (recipe_version_id,parameter_id,data_type)
      REFERENCES recipe_parameter(recipe_version_id,id,data_type),
    UNIQUE (recipe_version_id,parameter_id,category),
    CHECK (
      (category='target' AND target_value IS NOT NULL AND lower_value IS NULL AND upper_value IS NULL)
      OR
      (category<>'target' AND target_value IS NULL AND (lower_value IS NOT NULL OR upper_value IS NOT NULL))
    ),
    CHECK (lower_value IS NULL OR upper_value IS NULL OR lower_value<=upper_value),
    CHECK (target_value IS NULL OR target_value NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
    CHECK (lower_value IS NULL OR lower_value NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
    CHECK (upper_value IS NULL OR upper_value NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
    CHECK (data_type<>'integer' OR
      ((target_value IS NULL OR target_value=trunc(target_value)) AND
       (lower_value IS NULL OR lower_value=trunc(lower_value)) AND
       (upper_value IS NULL OR upper_value=trunc(upper_value))))
);

-- Serialiseer conceptinhoud per versie; bestaande procedureguard heeft
-- specifieke edge-logica en wordt daarom niet hergebruikt voor parameters.
CREATE FUNCTION recipe_parameter_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v uuid;
BEGIN
 v:=CASE WHEN TG_OP='DELETE' THEN OLD.recipe_version_id ELSE NEW.recipe_version_id END;
 PERFORM 1 FROM master_recipe_version WHERE id=v FOR UPDATE;
 IF TG_OP='UPDATE' THEN
   IF NEW.id IS DISTINCT FROM OLD.id OR NEW.recipe_version_id IS DISTINCT FROM OLD.recipe_version_id THEN
     RAISE EXCEPTION 'Parameteridentiteit en versie zijn onveranderlijk' USING ERRCODE='55000';
   END IF;
   -- Eenheidswijzigingen mogen bestaande numerieke voorwaarden niet
   -- stilzwijgend een andere betekenis geven.
   IF TG_TABLE_NAME='recipe_parameter' THEN
     IF NEW.unit IS DISTINCT FROM OLD.unit AND EXISTS (
       SELECT 1 FROM recipe_parameter_limit WHERE recipe_version_id=v AND parameter_id=OLD.id
     ) THEN
       RAISE EXCEPTION 'Verwijder of herdefinieer eerst de voorwaarden bij eenheidswijziging' USING ERRCODE='23514';
     END IF;
   END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recipe_parameter_guard BEFORE INSERT OR UPDATE OR DELETE ON recipe_parameter
 FOR EACH ROW EXECUTE FUNCTION recipe_parameter_guard();
CREATE TRIGGER recipe_parameter_limit_guard BEFORE INSERT OR UPDATE OR DELETE ON recipe_parameter_limit
 FOR EACH ROW EXECUTE FUNCTION recipe_parameter_guard();
CREATE TRIGGER recipe_parameter_audit AFTER INSERT OR UPDATE OR DELETE ON recipe_parameter
 FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();
CREATE TRIGGER recipe_parameter_limit_audit AFTER INSERT OR UPDATE OR DELETE ON recipe_parameter_limit
 FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();

REVOKE ALL ON FUNCTION recipe_parameter_guard() FROM PUBLIC;
REVOKE ALL ON recipe_parameter,recipe_parameter_limit FROM PUBLIC;
-- Nog geen runtimefuncties of tabeltoegang. Frequentie en verantwoordelijke
-- zijn voorlopig expliciete conceptlabels, geen uitgevoerde regels of grants.
-- Niet-numerieke voorwaarden, schaalbeleid en vrijgavevalidatie volgen.
