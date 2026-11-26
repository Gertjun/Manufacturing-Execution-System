-- Migratie 0099: gecontroleerde conceptwijzigingen en persoonlijk auditspoor (#110).
SET search_path = fabriek, public;

ALTER TABLE master_recipe_version ADD COLUMN change_no integer NOT NULL DEFAULT 0 CHECK (change_no >= 0);

-- Hergebruik het bestaande, afgeschermde configuratielogboek.
CREATE TRIGGER master_recipe_audit AFTER INSERT ON master_recipe
 FOR EACH ROW EXECUTE FUNCTION log_config();
CREATE TRIGGER master_recipe_version_audit AFTER INSERT OR UPDATE ON master_recipe_version
 FOR EACH ROW EXECUTE FUNCTION log_config();

CREATE OR REPLACE FUNCTION master_recipe_version_identity_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN
   RAISE EXCEPTION 'MBR-versie mag niet worden verwijderd' USING ERRCODE='55000';
 END IF;
 IF (NEW.id,NEW.master_recipe_id,NEW.revision,NEW.created_at,NEW.created_by)
    IS DISTINCT FROM (OLD.id,OLD.master_recipe_id,OLD.revision,OLD.created_at,OLD.created_by) THEN
   RAISE EXCEPTION 'MBR-versie-identiteit is onveranderlijk' USING ERRCODE='55000';
 END IF;
 IF NEW.change_no IS DISTINCT FROM OLD.change_no+1 THEN
   RAISE EXCEPTION 'MBR-wijzigingsteller moet precies één toenemen' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;

-- Alleen de conceptheader is nu bewerkbaar. De statusbeveiliging en
-- gezamenlijke inhoudsteller voor kinderen volgen vóór beoordeling/vrijgave.
CREATE FUNCTION recipe_update_draft(p_version uuid,p_expected integer,p_name text,p_description text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE product uuid; current_no integer; result_no integer;
BEGIN
 SELECT r.product_id INTO product FROM master_recipe_version v
 JOIN master_recipe r ON r.id=v.master_recipe_id WHERE v.id=p_version;
 PERFORM recipe_draft_actor(product);
 SELECT change_no INTO current_no FROM master_recipe_version WHERE id=p_version FOR UPDATE;
 IF current_no IS NULL OR current_no IS DISTINCT FROM p_expected THEN
   RAISE EXCEPTION 'MBR-concept is ondertussen gewijzigd' USING ERRCODE='40001';
 END IF;
 UPDATE master_recipe_version SET name=p_name,description=p_description,change_no=current_no+1
 WHERE id=p_version RETURNING change_no INTO result_no;
 RETURN result_no;
END $$;
REVOKE ALL ON FUNCTION recipe_update_draft(uuid,integer,text,text) FROM PUBLIC;
