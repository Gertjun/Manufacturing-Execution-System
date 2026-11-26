-- Migratie 0120: persoonlijke herbevestiging en gecontroleerde MBR-review (D108).
SET search_path = fabriek, public;

-- Statusovergangen veranderen de inhoudsteller niet. Identiteits- en
-- inhoudsmutaties blijven gescheiden. Vrijgave blijft gesloten.
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
 IF NEW.lifecycle_status IS DISTINCT FROM OLD.lifecycle_status THEN
   IF (NEW.name,NEW.description,NEW.change_no) IS DISTINCT FROM (OLD.name,OLD.description,OLD.change_no) THEN
     RAISE EXCEPTION 'Statusovergang mag inhoud niet wijzigen' USING ERRCODE='55000';
   END IF;
 ELSIF NEW.change_no IS DISTINCT FROM OLD.change_no+1 THEN
   RAISE EXCEPTION 'MBR-wijzigingsteller moet precies één toenemen' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;

-- Geen vrijgave in deze migratie. Een ronde is exact gekoppeld aan de
-- huidige inhoud en blijft historisch behouden na terugkeer naar draft.
CREATE OR REPLACE FUNCTION recipe_lifecycle_header_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE r recipe_review_round%ROWTYPE;
BEGIN
 IF TG_OP='INSERT' THEN
   IF NEW.lifecycle_status IS DISTINCT FROM 'draft' THEN
     RAISE EXCEPTION 'Nieuwe MBR-versie moet een concept zijn' USING ERRCODE='55000';
   END IF;
   RETURN NEW;
 END IF;
 IF NEW.lifecycle_status IS NOT DISTINCT FROM OLD.lifecycle_status THEN
   IF OLD.lifecycle_status<>'draft' THEN
     RAISE EXCEPTION 'MBR-inhoud is alleen wijzigbaar in conceptstatus' USING ERRCODE='55000';
   END IF;
   RETURN NEW;
 END IF;
 SELECT * INTO r FROM recipe_review_round WHERE recipe_version_id=OLD.id ORDER BY round_no DESC LIMIT 1;
 IF NOT FOUND OR r.change_no IS DISTINCT FROM OLD.change_no OR r.snapshot->'current' IS DISTINCT FROM recipe_review_snapshot(OLD.id) THEN
   RAISE EXCEPTION 'Actuele exacte beoordelingsronde vereist' USING ERRCODE='55000';
 END IF;
 IF OLD.lifecycle_status='draft' AND NEW.lifecycle_status='in_review' THEN
   IF EXISTS (SELECT 1 FROM recipe_review_decision WHERE round_id=r.id) THEN
     RAISE EXCEPTION 'Nieuwe beoordelingsronde vereist' USING ERRCODE='55000';
   END IF;
 ELSIF OLD.lifecycle_status='in_review' AND NEW.lifecycle_status='approved' THEN
   IF EXISTS (SELECT 1 FROM unnest(r.required_reviews) d WHERE NOT EXISTS (
     SELECT 1 FROM recipe_review_decision x WHERE x.round_id=r.id AND x.domain=d AND x.decision='approve')) THEN
     RAISE EXCEPTION 'Niet alle verplichte beoordelingen zijn goedgekeurd' USING ERRCODE='55000';
   END IF;
 ELSIF OLD.lifecycle_status='in_review' AND NEW.lifecycle_status='draft' THEN
   IF NOT EXISTS (SELECT 1 FROM recipe_review_decision WHERE round_id=r.id AND decision='reject') THEN
     RAISE EXCEPTION 'Afwijzing vereist' USING ERRCODE='55000';
   END IF;
 ELSE
   RAISE EXCEPTION 'MBR-statusovergang nog niet beschikbaar' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;

-- De indiener en beoordelaar komen uitsluitend uit de persoonlijke sessie.
-- Lock het account vóór de receptlock; hergebruik begrensde logincontrole.
-- Retourneer denied/locked zonder uitzondering zodat de caller de
-- geregistreerde inlogpoging kan COMMITten; geen wachtwoord in bewijs.
CREATE FUNCTION recipe_submit_review_confirmed(p_version uuid,p_expected integer,p_baseline_expected integer,p_password text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; name text; login record; target uuid;
BEGIN
 actor:=execution_transaction_actor();
 SELECT gebruikersnaam INTO name FROM gebruiker WHERE id=actor AND actief AND NOT gedeeld AND NOT wachtwoord_wijzigen FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','denied'); END IF;
 IF execution_transaction_actor() IS DISTINCT FROM actor THEN RETURN jsonb_build_object('status','denied'); END IF;
 SELECT * INTO login FROM inloggen(name,p_password,NULL);
 IF login.wacht_seconden IS NOT NULL THEN RETURN jsonb_build_object('status','locked'); END IF;
 IF login.id IS DISTINCT FROM actor THEN RETURN jsonb_build_object('status','denied'); END IF;
 target:=recipe_prepare_review_round(p_version,p_expected,p_baseline_expected);
 UPDATE master_recipe_version SET lifecycle_status='in_review' WHERE id=p_version;
 RETURN jsonb_build_object('status','submitted','round_id',target);
END $$;

-- Interne controle onder receptlock. Status, laatste ronde, exacte
-- snapshot, beide tellers, vereiste domeinen en bijdragers blijven leidend.
CREATE OR REPLACE FUNCTION recipe_review_decision_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE r recipe_review_round%ROWTYPE; v master_recipe_version%ROWTYPE; actor uuid;
BEGIN
 SELECT * INTO STRICT r FROM recipe_review_round WHERE id=NEW.round_id;
 SELECT * INTO STRICT v FROM master_recipe_version WHERE id=r.recipe_version_id FOR UPDATE;
 IF NEW.reviewer_id=ANY(r.contributors) THEN
   RAISE EXCEPTION 'Zelfgoedkeuring of beoordeling door bijdrager niet toegestaan' USING ERRCODE='42501';
 END IF;
 IF NOT (NEW.domain=ANY(r.required_reviews)) THEN
   RAISE EXCEPTION 'Beoordelingsdomein niet vereist voor deze ronde' USING ERRCODE='23514';
 END IF;
 IF v.lifecycle_status<>'in_review' OR r.change_no<>v.change_no
   OR EXISTS (SELECT 1 FROM recipe_review_round x WHERE x.recipe_version_id=v.id AND x.round_no>r.round_no)
   OR r.snapshot->'current' IS DISTINCT FROM recipe_review_snapshot(v.id) THEN
   RAISE EXCEPTION 'Beoordelingsronde is niet actueel' USING ERRCODE='40001';
 END IF;
 actor:=recipe_review_actor(v.id,NEW.domain);
 IF actor IS DISTINCT FROM NEW.reviewer_id THEN
   RAISE EXCEPTION 'Persoonlijke beoordelaar vereist' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION recipe_decide_review_confirmed(p_round uuid,p_expected integer,p_domain text,p_decision text,p_reason text,p_password text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE r recipe_review_round%ROWTYPE; v master_recipe_version%ROWTYPE; actor uuid; name text; login record; target uuid; state text;
BEGIN
 actor:=execution_transaction_actor();
 SELECT gebruikersnaam INTO name FROM gebruiker WHERE id=actor AND actief AND NOT gedeeld AND NOT wachtwoord_wijzigen FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','denied'); END IF;
 IF execution_transaction_actor() IS DISTINCT FROM actor THEN RETURN jsonb_build_object('status','denied'); END IF;
 SELECT * INTO r FROM recipe_review_round WHERE id=p_round;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende beoordelingsronde' USING ERRCODE='23503'; END IF;
 PERFORM recipe_review_actor(r.recipe_version_id,p_domain);
 SELECT * INTO STRICT v FROM master_recipe_version WHERE id=r.recipe_version_id FOR UPDATE;
 IF v.lifecycle_status<>'in_review' OR p_expected IS DISTINCT FROM v.change_no OR r.change_no<>v.change_no
   OR EXISTS (SELECT 1 FROM recipe_review_round x WHERE x.recipe_version_id=v.id AND x.round_no>r.round_no)
   OR r.snapshot->'current' IS DISTINCT FROM recipe_review_snapshot(v.id) THEN
   RAISE EXCEPTION 'Beoordelingsronde is niet actueel' USING ERRCODE='40001';
 END IF;
 IF actor=ANY(r.contributors) THEN RAISE EXCEPTION 'Zelfgoedkeuring of beoordeling door bijdrager niet toegestaan' USING ERRCODE='42501'; END IF;
 IF p_domain IS NULL OR NOT (p_domain=ANY(r.required_reviews)) OR p_decision IS NULL OR p_decision NOT IN ('approve','reject')
   OR btrim(coalesce(p_reason,''))='' THEN
   RAISE EXCEPTION 'Geldig vereist domein, besluit en reden vereist' USING ERRCODE='23514';
 END IF;
 IF EXISTS (SELECT 1 FROM recipe_review_decision WHERE round_id=p_round AND (domain=p_domain OR reviewer_id=actor)) THEN
   RAISE EXCEPTION 'Domein of persoon heeft al beoordeeld' USING ERRCODE='23505';
 END IF;
 SELECT * INTO login FROM inloggen(name,p_password,NULL);
 IF login.wacht_seconden IS NOT NULL THEN RETURN jsonb_build_object('status','locked'); END IF;
 IF login.id IS DISTINCT FROM actor THEN RETURN jsonb_build_object('status','denied'); END IF;
 -- Hercontrole in de trigger; geen directe app-insert, geen vrije actor.
 INSERT INTO recipe_review_decision(round_id,domain,decision,reason,reviewer_id)
 VALUES(p_round,p_domain,p_decision,p_reason,actor) RETURNING id INTO target;
 state:='in_review';
 IF p_decision='reject' THEN
   state:='draft';
 ELSIF NOT EXISTS (SELECT 1 FROM unnest(r.required_reviews) d WHERE NOT EXISTS (
   SELECT 1 FROM recipe_review_decision x WHERE x.round_id=p_round AND x.domain=d AND x.decision='approve')) THEN
   state:='approved';
 END IF;
 IF state<>'in_review' THEN UPDATE master_recipe_version SET lifecycle_status=state WHERE id=v.id; END IF;
 RETURN jsonb_build_object('status','decided','decision_id',target,'lifecycle_status',state);
END $$;

-- Geen vrijgave of mutatie van goedgekeurde recepten. Intrekken van
-- goedkeuring en expliciete vrijgave volgen in afzonderlijke migratie.
REVOKE ALL ON FUNCTION recipe_submit_review_confirmed(uuid,integer,integer,text),
 recipe_decide_review_confirmed(uuid,integer,text,text,text,text) FROM PUBLIC;
