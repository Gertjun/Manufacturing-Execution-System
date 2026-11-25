-- Migratie 0119: onveranderlijke beoordelingsronde en bijdragers (#112/D108).
SET search_path = fabriek, public;

-- Ronde is historisch bewijs; nog geen statusovergang of beslisfunctie.
CREATE TABLE recipe_review_round (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 recipe_version_id uuid NOT NULL REFERENCES master_recipe_version(id),
 round_no integer NOT NULL CHECK(round_no>0),
 change_no integer NOT NULL CHECK(change_no>=0),
 baseline_version_id uuid REFERENCES master_recipe_version(id),
 baseline_change_no integer CHECK(baseline_change_no>=0),
 matrix_version integer NOT NULL CHECK(matrix_version=1),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 required_reviews text[] NOT NULL CHECK(cardinality(required_reviews) BETWEEN 1 AND 3 AND required_reviews @> ARRAY['engineering']::text[] AND required_reviews <@ ARRAY['engineering','production','quality']::text[] AND array_position(required_reviews,NULL) IS NULL),
 contributors uuid[] NOT NULL CHECK(cardinality(contributors)>0 AND array_position(contributors,NULL) IS NULL),
 created_by uuid NOT NULL REFERENCES gebruiker(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(recipe_version_id,round_no),
 UNIQUE(id,recipe_version_id),
 CHECK((baseline_version_id IS NULL)=(baseline_change_no IS NULL))
);

-- Een besluit kan later uitsluitend aan een exacte ronde worden gekoppeld.
-- Eén persoon kan nooit twee verplichte domeinen voor dezelfde ronde aftekenen.
CREATE TABLE recipe_review_decision (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 round_id uuid NOT NULL REFERENCES recipe_review_round(id),
 domain text NOT NULL CHECK(domain IN ('engineering','production','quality')),
 decision text NOT NULL CHECK(decision IN ('approve','reject')),
 reason text NOT NULL CHECK(reason ~ '[^[:space:]]'),
 reviewer_id uuid NOT NULL REFERENCES gebruiker(id),
 decided_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(round_id,domain),
 UNIQUE(round_id,reviewer_id)
);

CREATE FUNCTION recipe_review_evidence_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Beoordelingsbewijs is onveranderlijk' USING ERRCODE='55000';
END $$;
CREATE TRIGGER recipe_review_round_immutable BEFORE UPDATE OR DELETE ON recipe_review_round
 FOR EACH ROW EXECUTE FUNCTION recipe_review_evidence_immutable();
CREATE TRIGGER recipe_review_decision_immutable BEFORE UPDATE OR DELETE ON recipe_review_decision
 FOR EACH ROW EXECUTE FUNCTION recipe_review_evidence_immutable();

-- Neem alle persoonlijke mutaties mee, ook verwijderde inhoud en MOC.
-- Niet bewezen herkomst blokkeert beoordeling; geen verzonnen auteurs.
CREATE FUNCTION recipe_review_contributors(p_version uuid) RETURNS uuid[]
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE people uuid[]; unknown_count bigint;
BEGIN
 WITH entries AS (
 SELECT actor_user_id,actor_origin FROM config_log
 WHERE (tabel='master_recipe_version' AND record_id=p_version
   AND (actie='INSERT' OR (oud->>'name',oud->>'description') IS DISTINCT FROM (nieuw->>'name',nieuw->>'description')
      OR (oud->>'change_no') IS DISTINCT FROM (nieuw->>'change_no')))
 OR (tabel IN ('recipe_procedural_element','recipe_dependency','recipe_parameter','recipe_parameter_limit','recipe_formula','recipe_material_requirement','recipe_equipment_requirement','recipe_personnel_requirement','recipe_instruction','recipe_specification_link','recipe_lot_rule','recipe_compatibility_rule','recipe_scaling_rule','recipe_scaling_input','recipe_scaling_binding','recipe_scaling_expression','recipe_change_request','recipe_change_impact')
   AND COALESCE(nieuw->>'recipe_version_id',oud->>'recipe_version_id')=p_version::text)
 )
 SELECT count(*) FILTER (WHERE actor_origin IS DISTINCT FROM 'personal' OR actor_user_id IS NULL)
 INTO unknown_count FROM entries;
 IF unknown_count>0 THEN
   RAISE EXCEPTION 'MBR bevat niet persoonlijk bewezen wijzigingen' USING ERRCODE='23514';
 END IF;
 SELECT ARRAY(SELECT DISTINCT actor FROM (
 SELECT created_by AS actor FROM master_recipe_version WHERE id=p_version
 UNION ALL SELECT created_by FROM recipe_change_request WHERE recipe_version_id=p_version
 UNION ALL SELECT actor_user_id FROM config_log
 WHERE (tabel='master_recipe_version' AND record_id=p_version
   AND (actie='INSERT' OR (oud->>'name',oud->>'description') IS DISTINCT FROM (nieuw->>'name',nieuw->>'description')
      OR (oud->>'change_no') IS DISTINCT FROM (nieuw->>'change_no')))
 OR (tabel IN ('recipe_procedural_element','recipe_dependency','recipe_parameter','recipe_parameter_limit','recipe_formula','recipe_material_requirement','recipe_equipment_requirement','recipe_personnel_requirement','recipe_instruction','recipe_specification_link','recipe_lot_rule','recipe_compatibility_rule','recipe_scaling_rule','recipe_scaling_input','recipe_scaling_binding','recipe_scaling_expression','recipe_change_request','recipe_change_impact')
   AND COALESCE(nieuw->>'recipe_version_id',oud->>'recipe_version_id')=p_version::text)
 ) s WHERE actor IS NOT NULL ORDER BY actor) INTO people;
 RETURN people;
END $$;

-- Volledige exacte snapshot met lokale ID's (naast genormaliseerde diff).
-- Expliciete externe referenties worden behouden, geen afgeronde JS-getallen.
CREATE FUNCTION recipe_review_snapshot(p_version uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,fabriek,pg_temp AS $$
 SELECT jsonb_build_object('header',to_jsonb(v)-'lifecycle_status',
 'recipe_procedural_element',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_procedural_element x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_dependency',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_dependency x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_parameter',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_parameter x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_parameter_limit',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_parameter_limit x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_formula',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_formula x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_material_requirement',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_material_requirement x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_equipment_requirement',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_equipment_requirement x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_personnel_requirement',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_personnel_requirement x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_instruction',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_instruction x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_specification_link',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_specification_link x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_lot_rule',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_lot_rule x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_compatibility_rule',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_compatibility_rule x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_scaling_rule',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_scaling_rule x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_scaling_input',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_scaling_input x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_scaling_binding',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_scaling_binding x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_scaling_expression',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_scaling_expression x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_change_request',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_change_request x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_change_impact',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_change_impact x WHERE x.recipe_version_id=v.id),'[]'::jsonb)
 ) FROM master_recipe_version v WHERE v.id=p_version
$$;

-- Intern; nog geen app-grant. Eerst identiteitbevestiging en statusworkflow.
-- Lock beide versies in vaste volgorde voordat inhoud wordt gelezen.
CREATE FUNCTION recipe_prepare_review_round(p_version uuid,p_expected integer,p_baseline_expected integer) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE baseline uuid; state text; baseline_state text; n integer; b integer; actor uuid; plan jsonb; diff jsonb; people uuid[]; required text[]; target uuid; seq integer;
BEGIN
 SELECT baseline_version_id INTO baseline FROM recipe_change_request WHERE recipe_version_id=p_version;
 IF NOT FOUND THEN RAISE EXCEPTION 'MOC-dossier ontbreekt' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM master_recipe_version WHERE id=p_version OR id=baseline ORDER BY id FOR UPDATE;
 n:=recipe_lock_draft(p_version,p_expected);
 actor:=execution_transaction_actor();
 SELECT change_no,lifecycle_status INTO b,baseline_state FROM master_recipe_version WHERE id=baseline;
 IF b IS DISTINCT FROM p_baseline_expected THEN
   RAISE EXCEPTION 'MBR-referentie is ondertussen gewijzigd' USING ERRCODE='40001';
 END IF;
 -- Een revisie mag de beoordelingsmatrix niet omzeilen via een willekeurig
 -- concept als referentie. Alleen eerder vrijgegeven historie is geldig.
 IF baseline IS NOT NULL AND baseline_state NOT IN ('released','superseded') THEN
   RAISE EXCEPTION 'Beoordeling vereist eerder vrijgegeven referentierevisie' USING ERRCODE='23514';
 END IF;
 plan:=recipe_review_requirements(p_version);
 diff:=recipe_compare_change(p_version);
 people:=recipe_review_contributors(p_version);
 SELECT ARRAY(SELECT DISTINCT x FROM unnest(people||ARRAY[actor]) x ORDER BY x) INTO people;
 SELECT ARRAY(SELECT jsonb_array_elements_text(plan->'required_reviews')) INTO required;
 SELECT COALESCE(max(round_no),0)+1 INTO seq FROM recipe_review_round WHERE recipe_version_id=p_version;
 INSERT INTO recipe_review_round(recipe_version_id,round_no,change_no,baseline_version_id,baseline_change_no,matrix_version,snapshot,required_reviews,contributors,created_by)
 VALUES(p_version,seq,n,baseline,b,1,jsonb_build_object('current',recipe_review_snapshot(p_version),'baseline',recipe_review_snapshot(baseline),'comparison',diff,'requirements',plan),required,people,actor)
 RETURNING id INTO target;
 RETURN target;
END $$;

-- Onafhankelijke relationele beveiliging voor toekomstige besluiten.
-- Tot de identiteitbevestiging bestaat, is elke INSERT expliciet geblokkeerd.
CREATE FUNCTION recipe_review_decision_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE r recipe_review_round%ROWTYPE;
BEGIN
 SELECT * INTO STRICT r FROM recipe_review_round WHERE id=NEW.round_id FOR SHARE;
 IF NEW.reviewer_id=ANY(r.contributors) THEN
   RAISE EXCEPTION 'Zelfgoedkeuring of beoordeling door bijdrager niet toegestaan' USING ERRCODE='42501';
 END IF;
 IF NOT (NEW.domain=ANY(r.required_reviews)) THEN
   RAISE EXCEPTION 'Beoordelingsdomein niet vereist voor deze ronde' USING ERRCODE='23514';
 END IF;
 RAISE EXCEPTION 'Beoordelingsbesluiten wachten op identiteitbevestiging' USING ERRCODE='55000';
END $$;
CREATE TRIGGER recipe_review_decision_guard BEFORE INSERT ON recipe_review_decision
 FOR EACH ROW EXECUTE FUNCTION recipe_review_decision_guard();
REVOKE ALL ON recipe_review_round,recipe_review_decision FROM PUBLIC;
REVOKE ALL ON FUNCTION recipe_review_evidence_immutable(),recipe_review_contributors(uuid),
 recipe_review_snapshot(uuid),recipe_prepare_review_round(uuid,integer,integer),recipe_review_decision_guard() FROM PUBLIC;
