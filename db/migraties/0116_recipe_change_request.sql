-- Migratie 0116: versiegebonden Management of Change-concept (#112, D89).
SET search_path = fabriek, public;

-- Eén wijzigingsdossier per versie. De referentieversie is expliciet,
-- behoort tot dezelfde receptidentiteit en heeft een lager revisienummer.
-- De voorlopige classificatie is beschrijvend, geen beoordelingsmatrix.
CREATE TABLE recipe_change_request (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 recipe_version_id uuid NOT NULL UNIQUE REFERENCES master_recipe_version(id),
 baseline_version_id uuid REFERENCES master_recipe_version(id),
 change_kind text NOT NULL CHECK (change_kind IN ('initial','revision')),
 reason text NOT NULL CHECK (reason ~ '[^[:space:]]'),
 impact_description text NOT NULL CHECK (impact_description ~ '[^[:space:]]'),
 created_by uuid NOT NULL REFERENCES gebruiker(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(recipe_version_id,id),
 CHECK ((change_kind='initial')=(baseline_version_id IS NULL))
);
CREATE TABLE recipe_change_impact (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 recipe_version_id uuid NOT NULL,
 request_id uuid NOT NULL,
 area text NOT NULL CHECK (area IN ('header','procedure','parameters','formula','materials','equipment','personnel','instructions','quality','lot','scaling','other')),
 explanation text NOT NULL CHECK (explanation ~ '[^[:space:]]'),
 FOREIGN KEY(recipe_version_id,request_id) REFERENCES recipe_change_request(recipe_version_id,id),
 UNIQUE(request_id,area)
);

CREATE FUNCTION recipe_change_request_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE recipe uuid; rev integer; baseline_recipe uuid; baseline_rev integer;
BEGIN
 IF TG_OP='DELETE' THEN
   RAISE EXCEPTION 'MOC-dossier mag niet worden verwijderd' USING ERRCODE='55000';
 END IF;
 IF TG_OP='UPDATE' AND (NEW.id,NEW.recipe_version_id,NEW.baseline_version_id,NEW.change_kind,NEW.created_by,NEW.created_at)
   IS DISTINCT FROM (OLD.id,OLD.recipe_version_id,OLD.baseline_version_id,OLD.change_kind,OLD.created_by,OLD.created_at) THEN
   RAISE EXCEPTION 'MOC-identiteit en referentie zijn onveranderlijk' USING ERRCODE='55000';
 END IF;
 SELECT master_recipe_id,revision INTO recipe,rev FROM master_recipe_version WHERE id=NEW.recipe_version_id;
 IF NEW.change_kind='initial' THEN
   IF rev IS DISTINCT FROM 1 THEN
     RAISE EXCEPTION 'Initiële MOC vereist eerste receptrevisie' USING ERRCODE='23514';
   END IF;
 ELSE
   SELECT master_recipe_id,revision INTO baseline_recipe,baseline_rev FROM master_recipe_version WHERE id=NEW.baseline_version_id;
   IF baseline_recipe IS NULL OR baseline_recipe IS DISTINCT FROM recipe OR baseline_rev>=rev THEN
     RAISE EXCEPTION 'MOC vereist eerdere revisie van dezelfde receptidentiteit' USING ERRCODE='23514';
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recipe_change_request_00_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON recipe_change_request
 FOR EACH ROW EXECUTE FUNCTION recipe_lifecycle_content_guard();
CREATE TRIGGER recipe_change_request_guard BEFORE INSERT OR UPDATE OR DELETE ON recipe_change_request
 FOR EACH ROW EXECUTE FUNCTION recipe_change_request_guard();
CREATE TRIGGER recipe_change_request_audit AFTER INSERT OR UPDATE ON recipe_change_request
 FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();
CREATE TRIGGER recipe_change_impact_00_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON recipe_change_impact
 FOR EACH ROW EXECUTE FUNCTION recipe_lifecycle_content_guard();
CREATE TRIGGER recipe_change_impact_audit AFTER INSERT OR UPDATE OR DELETE ON recipe_change_impact
 FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();

CREATE FUNCTION recipe_change_list(p_version uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE product uuid; result jsonb;
BEGIN
 SELECT r.product_id INTO product FROM master_recipe_version v JOIN master_recipe r ON r.id=v.master_recipe_id WHERE v.id=p_version;
 PERFORM recipe_draft_actor(product);
 SELECT jsonb_build_object('change_no',v.change_no,'lifecycle_status',v.lifecycle_status,
   'request',(SELECT to_jsonb(c) FROM recipe_change_request c WHERE c.recipe_version_id=v.id),
   'impacts',COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.area) FROM recipe_change_impact i WHERE i.recipe_version_id=v.id),'[]'::jsonb))
 INTO result FROM master_recipe_version v WHERE v.id=p_version;
 RETURN result;
END $$;

CREATE FUNCTION recipe_create_change_request(p_version uuid,p_expected integer,p_baseline uuid,p_reason text,p_impact text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE n integer; actor uuid; target uuid;
BEGIN
 n:=recipe_lock_draft(p_version,p_expected);
 actor:=execution_transaction_actor();
 INSERT INTO recipe_change_request(recipe_version_id,baseline_version_id,change_kind,reason,impact_description,created_by)
 VALUES(p_version,p_baseline,CASE WHEN p_baseline IS NULL THEN 'initial' ELSE 'revision' END,p_reason,p_impact,actor)
 RETURNING id INTO target;
 UPDATE master_recipe_version SET change_no=n+1 WHERE id=p_version;
 RETURN jsonb_build_object('id',target,'change_no',n+1);
END $$;

CREATE FUNCTION recipe_update_change_request(p_version uuid,p_expected integer,p_id uuid,p_reason text,p_impact text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE n integer; target uuid;
BEGIN
 n:=recipe_lock_draft(p_version,p_expected);
 UPDATE recipe_change_request SET reason=p_reason,impact_description=p_impact
 WHERE recipe_version_id=p_version AND id=p_id RETURNING id INTO target;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekend MOC-dossier binnen deze versie' USING ERRCODE='23503'; END IF;
 UPDATE master_recipe_version SET change_no=n+1 WHERE id=p_version;
 RETURN jsonb_build_object('id',target,'change_no',n+1);
END $$;

CREATE FUNCTION recipe_save_change_impact(p_version uuid,p_expected integer,p_id uuid,p_request uuid,p_area text,p_explanation text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE n integer; target uuid;
BEGIN
 n:=recipe_lock_draft(p_version,p_expected);
 IF p_id IS NULL THEN
   INSERT INTO recipe_change_impact(recipe_version_id,request_id,area,explanation)
   VALUES(p_version,p_request,p_area,p_explanation) RETURNING id INTO target;
 ELSE
   UPDATE recipe_change_impact SET area=p_area,explanation=p_explanation
   WHERE recipe_version_id=p_version AND id=p_id AND request_id=p_request RETURNING id INTO target;
   IF NOT FOUND THEN RAISE EXCEPTION 'Onbekend MOC-impactrecord binnen dit dossier' USING ERRCODE='23503'; END IF;
 END IF;
 UPDATE master_recipe_version SET change_no=n+1 WHERE id=p_version;
 RETURN jsonb_build_object('id',target,'change_no',n+1);
END $$;

CREATE FUNCTION recipe_delete_change_impact(p_version uuid,p_expected integer,p_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE n integer;
BEGIN
 n:=recipe_lock_draft(p_version,p_expected);
 DELETE FROM recipe_change_impact WHERE recipe_version_id=p_version AND id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekend MOC-impactrecord binnen deze versie' USING ERRCODE='23503'; END IF;
 UPDATE master_recipe_version SET change_no=n+1 WHERE id=p_version;
 RETURN n+1;
END $$;

REVOKE ALL ON recipe_change_request,recipe_change_impact FROM PUBLIC;
REVOKE ALL ON FUNCTION recipe_change_request_guard(),recipe_change_list(uuid),
 recipe_create_change_request(uuid,integer,uuid,text,text),
 recipe_update_change_request(uuid,integer,uuid,text,text),
 recipe_save_change_impact(uuid,integer,uuid,uuid,text,text),
 recipe_delete_change_impact(uuid,integer,uuid) FROM PUBLIC;
-- Impactlabels vormen geen autorisatie of bewijs van volledigheid.
-- De beoordelingsmatrix en automatische vergelijking volgen; statuspoort blijft gesloten.
