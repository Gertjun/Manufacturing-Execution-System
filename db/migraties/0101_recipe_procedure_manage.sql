-- Migratie 0101: persoonlijk procedurebeheer met gezamenlijke MBR-wijzigingsteller.
SET search_path = fabriek, public;

-- Eén lock en één verwachte teller voor alle conceptonderdelen.
-- De statuspoort wordt hier later centraal toegevoegd, vóór vrijgave mogelijk is.
CREATE FUNCTION recipe_lock_draft(p_version uuid,p_expected integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE product uuid; current_no integer;
BEGIN
 SELECT r.product_id INTO product FROM master_recipe_version v
 JOIN master_recipe r ON r.id=v.master_recipe_id WHERE v.id=p_version;
 PERFORM recipe_draft_actor(product);
 SELECT change_no INTO current_no FROM master_recipe_version WHERE id=p_version FOR UPDATE;
 IF current_no IS NULL OR current_no IS DISTINCT FROM p_expected THEN
   RAISE EXCEPTION 'MBR-concept is ondertussen gewijzigd' USING ERRCODE='40001';
 END IF;
 RETURN current_no;
END $$;

CREATE OR REPLACE FUNCTION recipe_update_draft(p_version uuid,p_expected integer,p_name text,p_description text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer; result_no integer;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 UPDATE master_recipe_version SET name=p_name,description=p_description,change_no=current_no+1
 WHERE id=p_version RETURNING change_no INTO result_no;
 RETURN result_no;
END $$;

-- Audit van conceptverwijderingen is toegestaan voor uitsluitend deze twee
-- tabellen. Het bestaande log_config blijft ongewijzigd voor andere domeinen.
CREATE FUNCTION recipe_procedure_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE old_data jsonb; new_data jsonb; actor uuid; label text;
BEGIN
 IF TG_OP<>'INSERT' THEN old_data:=to_jsonb(OLD); END IF;
 IF TG_OP<>'DELETE' THEN new_data:=to_jsonb(NEW); END IF;
 actor:=execution_session_actor(current_setting('fabriek.execution_proof',true));
 IF actor IS NOT NULL THEN
   SELECT gebruikersnaam INTO label FROM gebruiker WHERE id=actor;
 ELSE
   label:='[niet persoonlijk bewezen]';
 END IF;
 INSERT INTO config_log(tabel,record_id,actie,oud,nieuw,gewijzigd_door,actor_user_id,actor_origin)
 VALUES(TG_TABLE_NAME,(coalesce(new_data,old_data)->>'id')::uuid,TG_OP,old_data,new_data,label,
        actor,CASE WHEN actor IS NULL THEN 'unverified' ELSE 'personal' END);
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recipe_element_audit AFTER INSERT OR UPDATE OR DELETE ON recipe_procedural_element
 FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();
CREATE TRIGGER recipe_dependency_audit AFTER INSERT OR UPDATE OR DELETE ON recipe_dependency
 FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();

CREATE FUNCTION recipe_procedure_list(p_version uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE product uuid; result jsonb;
BEGIN
 SELECT r.product_id INTO product FROM master_recipe_version v
 JOIN master_recipe r ON r.id=v.master_recipe_id WHERE v.id=p_version;
 PERFORM recipe_draft_actor(product);
 -- Eén statement/snapshot voor teller en inhoud.
 SELECT jsonb_build_object('change_no',v.change_no,
   'elements',COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.parent_id NULLS FIRST,e.position)
     FROM recipe_procedural_element e WHERE e.recipe_version_id=v.id),'[]'::jsonb),
   'dependencies',COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.predecessor_id,d.successor_id)
     FROM recipe_dependency d WHERE d.recipe_version_id=v.id),'[]'::jsonb))
 INTO result FROM master_recipe_version v WHERE v.id=p_version;
 RETURN result;
END $$;

-- Eén expliciete bewerking per transactie; bij fout rollen teller, audit en
-- inhoud samen terug. Parentsoort komt uit een vertrouwd record.
CREATE FUNCTION recipe_save_element(p_version uuid,p_expected integer,p_id uuid,p_parent uuid,
 p_kind text,p_code text,p_name text,p_position integer,p_required boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer; target uuid; parent_type text;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 IF p_parent IS NOT NULL THEN
   SELECT kind INTO parent_type FROM recipe_procedural_element WHERE recipe_version_id=p_version AND id=p_parent;
   IF NOT FOUND THEN RAISE EXCEPTION 'Onbekend procedureparent binnen deze versie' USING ERRCODE='23503'; END IF;
 END IF;
 IF p_id IS NULL THEN
   INSERT INTO recipe_procedural_element(recipe_version_id,parent_id,parent_kind,kind,code,name,position,required)
   VALUES(p_version,p_parent,parent_type,p_kind,p_code,p_name,p_position,p_required) RETURNING id INTO target;
 ELSE
   UPDATE recipe_procedural_element SET parent_id=p_parent,parent_kind=parent_type,
      code=p_code,name=p_name,position=p_position,required=p_required
   WHERE id=p_id AND recipe_version_id=p_version AND kind=p_kind RETURNING id INTO target;
   IF NOT FOUND THEN RAISE EXCEPTION 'Onbekend procedure-element of gewijzigd type' USING ERRCODE='23503'; END IF;
 END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN jsonb_build_object('id',target,'change_no',current_no+1);
END $$;

CREATE FUNCTION recipe_delete_element(p_version uuid,p_expected integer,p_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 DELETE FROM recipe_procedural_element WHERE recipe_version_id=p_version AND id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekend procedure-element binnen deze versie' USING ERRCODE='23503'; END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN current_no+1;
END $$;

CREATE FUNCTION recipe_add_dependency(p_version uuid,p_expected integer,p_predecessor uuid,p_successor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer; target uuid;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 INSERT INTO recipe_dependency(recipe_version_id,predecessor_id,successor_id)
 VALUES(p_version,p_predecessor,p_successor) RETURNING id INTO target;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN jsonb_build_object('id',target,'change_no',current_no+1);
END $$;

CREATE FUNCTION recipe_delete_dependency(p_version uuid,p_expected integer,p_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 DELETE FROM recipe_dependency WHERE recipe_version_id=p_version AND id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende afhankelijkheid binnen deze versie' USING ERRCODE='23503'; END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN current_no+1;
END $$;

REVOKE ALL ON FUNCTION recipe_lock_draft(uuid,integer),recipe_procedure_audit(),
 recipe_procedure_list(uuid),recipe_save_element(uuid,integer,uuid,uuid,text,text,text,integer,boolean),
 recipe_delete_element(uuid,integer,uuid),recipe_add_dependency(uuid,integer,uuid,uuid),
 recipe_delete_dependency(uuid,integer,uuid) FROM PUBLIC;
