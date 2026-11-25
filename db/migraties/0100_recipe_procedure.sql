-- Migratie 0100: versiegebonden procedureboom en lineaire afhankelijkheden (#103/110).
SET search_path = fabriek, public;

-- Een concept mag nog onvolledig zijn; volledigheid is een latere vrijgave-eis.
-- Parenttype wordt relationeel afgedwongen, zonder recursieve parentmutaties.
CREATE TABLE recipe_procedural_element (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_version_id uuid NOT NULL REFERENCES master_recipe_version(id),
    parent_id uuid,
    parent_kind text,
    kind text NOT NULL CHECK (kind IN ('procedure','unit_procedure','operation','phase')),
    code text NOT NULL CHECK (btrim(code) <> ''),
    name text NOT NULL CHECK (btrim(name) <> ''),
    position integer NOT NULL CHECK (position > 0),
    required boolean NOT NULL DEFAULT true,
    UNIQUE (recipe_version_id,id),
    UNIQUE (recipe_version_id,id,kind),
    UNIQUE (recipe_version_id,code),
    UNIQUE NULLS NOT DISTINCT (recipe_version_id,parent_id,position),
    FOREIGN KEY (recipe_version_id,parent_id,parent_kind)
      REFERENCES recipe_procedural_element(recipe_version_id,id,kind) MATCH SIMPLE,
    CHECK (
      (kind='procedure' AND parent_id IS NULL AND parent_kind IS NULL)
      OR (parent_id IS NOT NULL AND parent_kind IS NOT NULL AND (
        (kind='unit_procedure' AND parent_kind='procedure')
        OR (kind='operation' AND parent_kind='unit_procedure')
        OR (kind='phase' AND parent_kind='operation')
      ))
    )
);
CREATE UNIQUE INDEX recipe_one_procedure_root ON recipe_procedural_element(recipe_version_id)
 WHERE kind='procedure';

-- Expliciete voorganger/opvolger; voorlopig alleen binnen dezelfde siblinggroep.
-- Geen uitvoering van conditionele/parallelle logica in deze migratie.
CREATE TABLE recipe_dependency (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_version_id uuid NOT NULL REFERENCES master_recipe_version(id),
    predecessor_id uuid NOT NULL,
    successor_id uuid NOT NULL,
    UNIQUE (recipe_version_id,predecessor_id,successor_id),
    FOREIGN KEY (recipe_version_id,predecessor_id) REFERENCES recipe_procedural_element(recipe_version_id,id),
    FOREIGN KEY (recipe_version_id,successor_id) REFERENCES recipe_procedural_element(recipe_version_id,id),
    CHECK (predecessor_id <> successor_id)
);

-- Serialiseer alle procedurewijzigingen per receptversie. Een afhankelijkheid
-- moet voorwaarts lopen binnen één siblinggroep; zo zijn cycli uitgesloten.
-- Ook wijziging van een positie/parent mag bestaande edges niet ongeldig maken.
CREATE FUNCTION recipe_procedure_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE version_id uuid; a recipe_procedural_element%ROWTYPE; b recipe_procedural_element%ROWTYPE;
BEGIN
 version_id:=CASE WHEN TG_OP='DELETE' THEN OLD.recipe_version_id ELSE NEW.recipe_version_id END;
 PERFORM 1 FROM master_recipe_version WHERE id=version_id FOR UPDATE;
 IF TG_OP='UPDATE' THEN
   IF NEW.id IS DISTINCT FROM OLD.id OR NEW.recipe_version_id IS DISTINCT FROM OLD.recipe_version_id THEN
     RAISE EXCEPTION 'Procedure-identiteit en versie zijn onveranderlijk' USING ERRCODE='55000';
   END IF;
 END IF;
 IF TG_TABLE_NAME='recipe_dependency' AND TG_OP<>'DELETE' THEN
   SELECT * INTO a FROM recipe_procedural_element WHERE recipe_version_id=version_id AND id=NEW.predecessor_id;
   SELECT * INTO b FROM recipe_procedural_element WHERE recipe_version_id=version_id AND id=NEW.successor_id;
   IF a.id IS NULL OR b.id IS NULL OR a.parent_id IS DISTINCT FROM b.parent_id OR a.position>=b.position THEN
     RAISE EXCEPTION 'Procedureafhankelijkheid moet voorwaarts binnen dezelfde groep lopen' USING ERRCODE='23514';
   END IF;
 ELSIF TG_TABLE_NAME='recipe_procedural_element' AND TG_OP='UPDATE' THEN
   IF EXISTS (
     SELECT 1 FROM recipe_dependency d JOIN recipe_procedural_element other
       ON other.recipe_version_id=d.recipe_version_id AND other.id=d.successor_id
     WHERE d.recipe_version_id=version_id AND d.predecessor_id=NEW.id
       AND (other.parent_id IS DISTINCT FROM NEW.parent_id OR other.position<=NEW.position)
   ) OR EXISTS (
     SELECT 1 FROM recipe_dependency d JOIN recipe_procedural_element other
       ON other.recipe_version_id=d.recipe_version_id AND other.id=d.predecessor_id
     WHERE d.recipe_version_id=version_id AND d.successor_id=NEW.id
       AND (other.parent_id IS DISTINCT FROM NEW.parent_id OR other.position>=NEW.position)
   ) THEN
     RAISE EXCEPTION 'Procedurewijziging maakt afhankelijkheid ongeldig' USING ERRCODE='23514';
   END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recipe_element_guard BEFORE INSERT OR UPDATE OR DELETE ON recipe_procedural_element
 FOR EACH ROW EXECUTE FUNCTION recipe_procedure_guard();
CREATE TRIGGER recipe_dependency_guard BEFORE INSERT OR UPDATE OR DELETE ON recipe_dependency
 FOR EACH ROW EXECUTE FUNCTION recipe_procedure_guard();
REVOKE ALL ON FUNCTION recipe_procedure_guard() FROM PUBLIC;
REVOKE ALL ON recipe_procedural_element,recipe_dependency FROM PUBLIC;

-- Nog geen runtimewrites of API: gecontroleerde gezamenlijke change_no,
-- persoonlijke audit en statuspoort volgen vóór opening van de interface.
