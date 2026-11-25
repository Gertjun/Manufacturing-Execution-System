-- Migratie 0107: versiegebonden lotnorm en expliciete incompatibiliteit (D89 R07/R08).
SET search_path = fabriek, public;

-- Geen standaard vier batches. De norm is expliciete receptinhoud.
-- Afwijkingsreden altijd verplicht bij uitvoering; deze vlag bepaalt
-- uitsluitend of daarnaast onafhankelijke goedkeuring vereist is.
CREATE TABLE recipe_lot_rule (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 recipe_version_id uuid NOT NULL UNIQUE REFERENCES master_recipe_version(id),
 nominal_batch_count integer NOT NULL CHECK (nominal_batch_count BETWEEN 1 AND 50),
 deviation_approval_required boolean NOT NULL,
 deviation_reason_required boolean NOT NULL DEFAULT true CHECK (deviation_reason_required)
);

-- Incompatibiliteit is een verbod vanuit één exacte MBR-revisie naar
-- een andere. Bij lotvorming geldt een verbod in ELKE richting.
-- De eigenaar van de regel is de eerste revisie; een nieuw concept kan
-- een oudere versie uitsluiten zonder die oudere versie te muteren.
CREATE TABLE recipe_compatibility_rule (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 recipe_version_id uuid NOT NULL REFERENCES master_recipe_version(id),
 other_recipe_version_id uuid NOT NULL REFERENCES master_recipe_version(id),
 reason text NOT NULL CHECK (reason ~ '[^[:space:]]'),
 UNIQUE (recipe_version_id,other_recipe_version_id),
 CHECK (recipe_version_id<>other_recipe_version_id)
);

CREATE FUNCTION recipe_lot_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v uuid; p uuid; other_p uuid;
BEGIN
 v:=CASE WHEN TG_OP='DELETE' THEN OLD.recipe_version_id ELSE NEW.recipe_version_id END;
 PERFORM 1 FROM master_recipe_version WHERE id=v FOR UPDATE;
 IF TG_OP='UPDATE' THEN
   IF NEW.id IS DISTINCT FROM OLD.id OR NEW.recipe_version_id IS DISTINCT FROM OLD.recipe_version_id THEN
     RAISE EXCEPTION 'Lotregelidentiteit en versie zijn onveranderlijk' USING ERRCODE='55000';
   END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF TG_TABLE_NAME='recipe_compatibility_rule' THEN
   SELECT r.product_id INTO p FROM master_recipe_version x JOIN master_recipe r ON r.id=x.master_recipe_id WHERE x.id=v;
   SELECT r.product_id INTO other_p FROM master_recipe_version x JOIN master_recipe r ON r.id=x.master_recipe_id WHERE x.id=NEW.other_recipe_version_id;
   IF p IS NULL OR other_p IS NULL OR p IS DISTINCT FROM other_p THEN
     RAISE EXCEPTION 'Incompatibiliteitsregel vereist twee receptversies van hetzelfde product' USING ERRCODE='23514';
   END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE TRIGGER recipe_lot_rule_guard BEFORE INSERT OR UPDATE OR DELETE ON recipe_lot_rule
 FOR EACH ROW EXECUTE FUNCTION recipe_lot_guard();
CREATE TRIGGER recipe_compatibility_rule_guard BEFORE INSERT OR UPDATE OR DELETE ON recipe_compatibility_rule
 FOR EACH ROW EXECUTE FUNCTION recipe_lot_guard();
CREATE TRIGGER recipe_lot_rule_audit AFTER INSERT OR UPDATE OR DELETE ON recipe_lot_rule
 FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();
CREATE TRIGGER recipe_compatibility_rule_audit AFTER INSERT OR UPDATE OR DELETE ON recipe_compatibility_rule
 FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();

REVOKE ALL ON FUNCTION recipe_lot_guard() FROM PUBLIC;
REVOKE ALL ON recipe_lot_rule,recipe_compatibility_rule FROM PUBLIC;

-- Geen lotcreatie, dispatch, goedkeuringshandeling of wijziging van
-- historische loten. Vrijgavepoort en persoonlijke conceptmutaties volgen.
-- Verschillende nominale normen bij gemengde revisies vereisen later
-- expliciete keuze en vastlegging in het lot-Control Recipe; geen
-- impliciete keuze voor de eerste, laatste of grootste norm.
