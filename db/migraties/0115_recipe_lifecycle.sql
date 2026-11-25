-- Migratie 0115: MBR-levenscyclus en inhoudsbeveiliging (#112, D89).
SET search_path = fabriek, public;

-- Bestaande versies zijn uitsluitend concepten. Geen impliciete vrijgave.
-- Status staat apart van inhoud; wijzigingsteller blijft inhoudsteller.
ALTER TABLE master_recipe_version ADD COLUMN lifecycle_status text NOT NULL DEFAULT 'draft'
 CHECK (lifecycle_status IN ('draft','in_review','approved','released','superseded','withdrawn'));

CREATE FUNCTION recipe_lifecycle_header_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN
   IF NEW.lifecycle_status IS DISTINCT FROM 'draft' THEN
     RAISE EXCEPTION 'Nieuwe MBR-versie moet een concept zijn' USING ERRCODE='55000';
   END IF;
   RETURN NEW;
 END IF;
 -- 0115 opent bewust nog geen enkele statusovergang.
 -- De latere gecontroleerde MOC-migratie vervangt deze statuspoort.
 IF NEW.lifecycle_status IS DISTINCT FROM OLD.lifecycle_status THEN
   RAISE EXCEPTION 'MBR-statusovergang nog niet beschikbaar' USING ERRCODE='55000';
 END IF;
 IF OLD.lifecycle_status IS DISTINCT FROM 'draft' THEN
   RAISE EXCEPTION 'MBR-inhoud is alleen wijzigbaar in conceptstatus' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER master_recipe_version_lifecycle_guard BEFORE INSERT OR UPDATE ON master_recipe_version
 FOR EACH ROW EXECUTE FUNCTION recipe_lifecycle_header_guard();

CREATE OR REPLACE FUNCTION recipe_lock_draft(p_version uuid,p_expected integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE product uuid; current_no integer; state text;
BEGIN
 SELECT r.product_id INTO product FROM master_recipe_version v
 JOIN master_recipe r ON r.id=v.master_recipe_id WHERE v.id=p_version;
 PERFORM recipe_draft_actor(product);
 SELECT change_no,lifecycle_status INTO current_no,state FROM master_recipe_version WHERE id=p_version FOR UPDATE;
 IF current_no IS NULL OR current_no IS DISTINCT FROM p_expected THEN
   RAISE EXCEPTION 'MBR-concept is ondertussen gewijzigd' USING ERRCODE='40001';
 END IF;
 IF state IS DISTINCT FROM 'draft' THEN
   RAISE EXCEPTION 'MBR-inhoud is alleen wijzigbaar in conceptstatus' USING ERRCODE='55000';
 END IF;
 RETURN current_no;
END $$;

-- Onafhankelijke databaseguard voor alle huidige versiegebonden inhoud.
-- De lock is dezelfde als voor de header en de toekomstige MOC-overgang.
CREATE FUNCTION recipe_lifecycle_content_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v uuid; state text;
BEGIN
 v:=CASE WHEN TG_OP='DELETE' THEN OLD.recipe_version_id ELSE NEW.recipe_version_id END;
 IF TG_OP='UPDATE' AND NEW.recipe_version_id IS DISTINCT FROM OLD.recipe_version_id THEN
   RAISE EXCEPTION 'MBR-inhoud kan niet naar een andere versie worden verplaatst' USING ERRCODE='55000';
 END IF;
 SELECT lifecycle_status INTO state FROM master_recipe_version WHERE id=v FOR UPDATE;
 IF state IS DISTINCT FROM 'draft' THEN
   RAISE EXCEPTION 'MBR-inhoud is alleen wijzigbaar in conceptstatus' USING ERRCODE='55000';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recipe_procedural_element_00_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON recipe_procedural_element
 FOR EACH ROW EXECUTE FUNCTION recipe_lifecycle_content_guard();
CREATE TRIGGER recipe_dependency_00_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON recipe_dependency
 FOR EACH ROW EXECUTE FUNCTION recipe_lifecycle_content_guard();
CREATE TRIGGER recipe_parameter_00_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON recipe_parameter
 FOR EACH ROW EXECUTE FUNCTION recipe_lifecycle_content_guard();
CREATE TRIGGER recipe_parameter_limit_00_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON recipe_parameter_limit
 FOR EACH ROW EXECUTE FUNCTION recipe_lifecycle_content_guard();
CREATE TRIGGER recipe_formula_00_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON recipe_formula
 FOR EACH ROW EXECUTE FUNCTION recipe_lifecycle_content_guard();
CREATE TRIGGER recipe_material_requirement_00_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON recipe_material_requirement
 FOR EACH ROW EXECUTE FUNCTION recipe_lifecycle_content_guard();
CREATE TRIGGER recipe_equipment_requirement_00_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON recipe_equipment_requirement
 FOR EACH ROW EXECUTE FUNCTION recipe_lifecycle_content_guard();
CREATE TRIGGER recipe_personnel_requirement_00_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON recipe_personnel_requirement
 FOR EACH ROW EXECUTE FUNCTION recipe_lifecycle_content_guard();
CREATE TRIGGER recipe_instruction_00_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON recipe_instruction
 FOR EACH ROW EXECUTE FUNCTION recipe_lifecycle_content_guard();
CREATE TRIGGER recipe_specification_link_00_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON recipe_specification_link
 FOR EACH ROW EXECUTE FUNCTION recipe_lifecycle_content_guard();
CREATE TRIGGER recipe_lot_rule_00_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON recipe_lot_rule
 FOR EACH ROW EXECUTE FUNCTION recipe_lifecycle_content_guard();
CREATE TRIGGER recipe_compatibility_rule_00_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON recipe_compatibility_rule
 FOR EACH ROW EXECUTE FUNCTION recipe_lifecycle_content_guard();
CREATE TRIGGER recipe_scaling_rule_00_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON recipe_scaling_rule
 FOR EACH ROW EXECUTE FUNCTION recipe_lifecycle_content_guard();
CREATE TRIGGER recipe_scaling_input_00_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON recipe_scaling_input
 FOR EACH ROW EXECUTE FUNCTION recipe_lifecycle_content_guard();
CREATE TRIGGER recipe_scaling_binding_00_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON recipe_scaling_binding
 FOR EACH ROW EXECUTE FUNCTION recipe_lifecycle_content_guard();
CREATE TRIGGER recipe_scaling_expression_00_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON recipe_scaling_expression
 FOR EACH ROW EXECUTE FUNCTION recipe_lifecycle_content_guard();
REVOKE ALL ON FUNCTION recipe_lifecycle_header_guard(),recipe_lifecycle_content_guard(),recipe_lock_draft(uuid,integer) FROM PUBLIC;
-- Geen statusovergang, goedkeuringsrecht, vrijgave of uitvoeringsrecht in 0115.
