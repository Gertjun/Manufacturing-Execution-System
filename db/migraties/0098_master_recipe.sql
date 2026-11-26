-- Migratie 0098: MBR-identiteit en conceptversies (D89 R01-R05, #109-110).
SET search_path = fabriek, public;

-- Eén product kan meerdere stabiele receptidentiteiten hebben.
CREATE TABLE master_recipe (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id uuid NOT NULL REFERENCES product(id),
    code text NOT NULL CHECK (btrim(code) <> ''),
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by uuid NOT NULL REFERENCES gebruiker(id),
    UNIQUE (product_id, code)
);

-- Conceptversie; inhoud en gecontroleerde statusovergangen volgen in fase 2.
-- Geen vrijgavestatus zolang beoordeling en vrijgave nog niet bestaan.
CREATE TABLE master_recipe_version (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    master_recipe_id uuid NOT NULL REFERENCES master_recipe(id),
    revision integer NOT NULL CHECK (revision > 0),
    name text NOT NULL CHECK (btrim(name) <> ''),
    description text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by uuid NOT NULL REFERENCES gebruiker(id),
    UNIQUE (master_recipe_id, revision)
);

-- De identiteit en het product van een recept mogen niet wijzigen.
CREATE FUNCTION master_recipe_identity_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'MBR-identiteit is onveranderlijk' USING ERRCODE='55000';
END $$;
CREATE TRIGGER master_recipe_identity_guard BEFORE UPDATE OR DELETE ON master_recipe
 FOR EACH ROW EXECUTE FUNCTION master_recipe_identity_guard();

-- Revisie-identiteit en oorspronkelijke auteur blijven behouden.
-- Inhoudelijke conceptwijzigingen worden pas via een gecontroleerde functie geopend.
CREATE FUNCTION master_recipe_version_identity_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN
   RAISE EXCEPTION 'MBR-versie mag niet worden verwijderd' USING ERRCODE='55000';
 END IF;
 IF (NEW.id,NEW.master_recipe_id,NEW.revision,NEW.created_at,NEW.created_by)
    IS DISTINCT FROM (OLD.id,OLD.master_recipe_id,OLD.revision,OLD.created_at,OLD.created_by) THEN
   RAISE EXCEPTION 'MBR-versie-identiteit is onveranderlijk' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER master_recipe_version_identity_guard BEFORE UPDATE OR DELETE ON master_recipe_version
 FOR EACH ROW EXECUTE FUNCTION master_recipe_version_identity_guard();

REVOKE ALL ON master_recipe,master_recipe_version FROM PUBLIC;
REVOKE ALL ON FUNCTION master_recipe_identity_guard(),master_recipe_version_identity_guard() FROM PUBLIC;

-- Eigen domeinpermission; geen nieuwe persoonlijke grants.
INSERT INTO authorization_permission(code,domain) VALUES ('recipe.draft.manage','engineering');
INSERT INTO authorization_role_permission(role_code,permission_code) VALUES ('process_engineer','recipe.draft.manage');

-- Productcontext komt uit de receptidentiteit of uit de gevalideerde product-FK.
CREATE FUNCTION recipe_draft_actor(p_product uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid;
BEGIN
 actor:=execution_transaction_actor();
 IF p_product IS NULL OR NOT authorization_permits(actor,'recipe.draft.manage',NULL,p_product,NULL) THEN
   RAISE EXCEPTION 'Geen actuele MES-receptbevoegdheid' USING ERRCODE='42501';
 END IF;
 RETURN actor;
END $$;

CREATE FUNCTION recipe_create(p_product uuid,p_code text,p_name text,p_description text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; target uuid;
BEGIN
 actor:=recipe_draft_actor(p_product);
 INSERT INTO master_recipe(product_id,code,created_by)
 VALUES(p_product,p_code,actor) RETURNING id INTO target;
 INSERT INTO master_recipe_version(master_recipe_id,revision,name,description,created_by)
 VALUES(target,1,p_name,p_description,actor);
 RETURN target;
END $$;

-- Voorlopig uitsluitend lege conceptheaders. Kopiëren van volledige
-- receptinhoud volgt zodra alle versiegebonden kinderen bestaan.
CREATE FUNCTION recipe_create_next_version(p_recipe uuid,p_expected integer,p_name text,p_description text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; target uuid; product uuid; latest integer;
BEGIN
 SELECT product_id INTO product FROM master_recipe WHERE id=p_recipe;
 actor:=recipe_draft_actor(product);
 PERFORM 1 FROM master_recipe WHERE id=p_recipe FOR UPDATE;
 SELECT max(revision) INTO latest FROM master_recipe_version WHERE master_recipe_id=p_recipe;
 IF latest IS NULL OR latest IS DISTINCT FROM p_expected THEN
   RAISE EXCEPTION 'MBR-revisie is gewijzigd' USING ERRCODE='40001';
 END IF;
 INSERT INTO master_recipe_version(master_recipe_id,revision,name,description,created_by)
 VALUES(p_recipe,latest+1,p_name,p_description,actor) RETURNING id INTO target;
 RETURN target;
END $$;

CREATE FUNCTION recipe_list(p_product uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
 PERFORM recipe_draft_actor(p_product);
 RETURN COALESCE((SELECT jsonb_agg(to_jsonb(r)||jsonb_build_object('versions',
   COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.revision) FROM master_recipe_version v WHERE v.master_recipe_id=r.id),'[]'::jsonb))
   ORDER BY r.code) FROM master_recipe r WHERE r.product_id=p_product),'[]'::jsonb);
END $$;

REVOKE ALL ON FUNCTION recipe_draft_actor(uuid),recipe_create(uuid,text,text,text),
 recipe_create_next_version(uuid,integer,text,text),recipe_list(uuid) FROM PUBLIC;
