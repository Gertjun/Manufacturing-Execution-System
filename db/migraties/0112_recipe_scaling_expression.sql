-- Migratie 0112: begrensde getypeerde schaalformuledefinities (D106/#141).
SET search_path = fabriek, public;

-- Postfix-notatie (RPN), grammatica v1. Alleen invoer-ID's en vaste
-- operatorcodes, nooit uitvoerbare tekst. Geen evaluatie in fase 2.
CREATE TABLE recipe_scaling_expression (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 recipe_version_id uuid NOT NULL,
 rule_id uuid NOT NULL,
 grammar_version integer NOT NULL DEFAULT 1 CHECK (grammar_version=1),
 tokens jsonb NOT NULL,
 UNIQUE(recipe_version_id,rule_id),
 FOREIGN KEY(recipe_version_id,rule_id) REFERENCES recipe_scaling_rule(recipe_version_id,id)
);

CREATE FUNCTION recipe_scaling_expression_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE token jsonb; op text; input_id uuid; depth integer:=0; v uuid;
BEGIN
 v:=CASE WHEN TG_OP='DELETE' THEN OLD.recipe_version_id ELSE NEW.recipe_version_id END;
 PERFORM 1 FROM master_recipe_version WHERE id=v FOR UPDATE;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF TG_OP='UPDATE' AND (NEW.id,NEW.recipe_version_id,NEW.rule_id) IS DISTINCT FROM (OLD.id,OLD.recipe_version_id,OLD.rule_id) THEN
   RAISE EXCEPTION 'Formule-identiteit is onveranderlijk' USING ERRCODE='55000';
 END IF;
 IF jsonb_typeof(NEW.tokens) IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'Schaalformule vereist een tokenlijst' USING ERRCODE='23514';
 END IF;
 IF jsonb_array_length(NEW.tokens) NOT BETWEEN 1 AND 128 THEN
   RAISE EXCEPTION 'Schaalformule vereist 1 tot 128 tokens' USING ERRCODE='23514';
 END IF;
 FOR token IN SELECT value FROM jsonb_array_elements(NEW.tokens) LOOP
   IF jsonb_typeof(token) IS DISTINCT FROM 'object' THEN
     RAISE EXCEPTION 'Ongeldig schaalformuletoken' USING ERRCODE='23514';
   END IF;
   op:=token->>'op';
   IF op='input' AND jsonb_typeof(token->'id')='string' AND token= jsonb_build_object('op','input','id',token->>'id') THEN
     BEGIN
       input_id:=(token->>'id')::uuid;
     EXCEPTION WHEN invalid_text_representation THEN
       RAISE EXCEPTION 'Ongeldige schaalinvoer-ID' USING ERRCODE='23514';
     END;
     IF NOT EXISTS (SELECT 1 FROM recipe_scaling_input i WHERE i.id=input_id AND i.recipe_version_id=v AND i.rule_id=NEW.rule_id) THEN
       RAISE EXCEPTION 'Schaalformule vereist invoer uit dezelfde regel' USING ERRCODE='23514';
     END IF;
     depth:=depth+1;
   ELSIF op IN ('add','subtract','multiply','divide','power') AND token=jsonb_build_object('op',op) THEN
     IF depth<2 THEN RAISE EXCEPTION 'Onvoldoende operanden in schaalformule' USING ERRCODE='23514'; END IF;
     depth:=depth-1;
   ELSE
     RAISE EXCEPTION 'Onbekend of ongeldig schaalformuletoken' USING ERRCODE='23514';
   END IF;
 END LOOP;
 IF depth<>1 THEN RAISE EXCEPTION 'Schaalformule vereist precies één resultaat' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recipe_scaling_expression_guard BEFORE INSERT OR UPDATE OR DELETE ON recipe_scaling_expression
 FOR EACH ROW EXECUTE FUNCTION recipe_scaling_expression_guard();
CREATE TRIGGER recipe_scaling_expression_audit AFTER INSERT OR UPDATE OR DELETE ON recipe_scaling_expression
 FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();

-- Voorkom stille herinterpretatie van bestaande formules. Verwijder
-- eerst de formule voordat invoer of uitvoereenheid wordt gewijzigd.
CREATE FUNCTION recipe_scaling_expression_dependency_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
 IF TG_TABLE_NAME='recipe_scaling_input' THEN
   PERFORM 1 FROM master_recipe_version WHERE id=OLD.recipe_version_id FOR UPDATE;
   IF EXISTS (SELECT 1 FROM recipe_scaling_expression e WHERE e.recipe_version_id=OLD.recipe_version_id AND e.rule_id=OLD.rule_id) THEN
     RAISE EXCEPTION 'Verwijder eerst de schaalformule bij wijziging van invoer' USING ERRCODE='23514';
   END IF;
 ELSE
   IF NEW.output_unit_id IS DISTINCT FROM OLD.output_unit_id AND EXISTS
     (SELECT 1 FROM recipe_scaling_expression e WHERE e.recipe_version_id=OLD.recipe_version_id AND e.rule_id=OLD.id) THEN
     RAISE EXCEPTION 'Verwijder eerst de schaalformule bij wijziging van uitvoereenheid' USING ERRCODE='23514';
   END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recipe_scaling_expression_input_guard BEFORE UPDATE OR DELETE ON recipe_scaling_input
 FOR EACH ROW EXECUTE FUNCTION recipe_scaling_expression_dependency_guard();
CREATE TRIGGER recipe_scaling_expression_output_guard BEFORE UPDATE ON recipe_scaling_rule
 FOR EACH ROW EXECUTE FUNCTION recipe_scaling_expression_dependency_guard();

CREATE FUNCTION recipe_save_scaling_expression(p_version uuid,p_expected integer,p_rule uuid,p_tokens jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer; target uuid;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 INSERT INTO recipe_scaling_expression(recipe_version_id,rule_id,tokens)
 VALUES(p_version,p_rule,p_tokens)
 ON CONFLICT(recipe_version_id,rule_id) DO UPDATE SET tokens=EXCLUDED.tokens RETURNING id INTO target;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN jsonb_build_object('id',target,'change_no',current_no+1);
END $$;
CREATE FUNCTION recipe_delete_scaling_expression(p_version uuid,p_expected integer,p_rule uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 DELETE FROM recipe_scaling_expression WHERE recipe_version_id=p_version AND rule_id=p_rule;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende schaalformule binnen deze versie' USING ERRCODE='23503'; END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN current_no+1;
END $$;
CREATE OR REPLACE FUNCTION recipe_scaling_list(p_version uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE product uuid; result jsonb;
BEGIN
 SELECT r.product_id INTO product FROM master_recipe_version v
 JOIN master_recipe r ON r.id=v.master_recipe_id WHERE v.id=p_version;
 PERFORM recipe_draft_actor(product);
 SELECT jsonb_build_object('change_no',v.change_no,
   'rules',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_scaling_rule x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
   'inputs',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_scaling_input x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
   'bindings',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_scaling_binding x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
   'expressions',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_scaling_expression x WHERE x.recipe_version_id=v.id),'[]'::jsonb))
 INTO result FROM master_recipe_version v WHERE v.id=p_version;
 RETURN result;
END $$;
REVOKE ALL ON recipe_scaling_expression FROM PUBLIC;
REVOKE ALL ON FUNCTION recipe_scaling_expression_guard(),recipe_scaling_expression_dependency_guard(),
 recipe_save_scaling_expression(uuid,integer,uuid,jsonb),recipe_delete_scaling_expression(uuid,integer,uuid),
 recipe_scaling_list(uuid) FROM PUBLIC;
-- Alleen structurele validatie. Dimensionele/semantische formulevalidatie
-- en expliciete vrijgaveblokkade voor complexe regels blijven verplicht.
