-- Migratie 0123: D109 persoonlijke formele vrijgave en intrekking.
SET search_path = fabriek, public;

-- Afzonderlijke bevoegdheden in bestaande domeinen, geen persoonlijke grants.
INSERT INTO authorization_permission(code,domain) VALUES
 ('recipe.release','engineering'),
 ('recipe.withdraw.engineering','engineering'),
 ('recipe.withdraw.quality','quality');
INSERT INTO authorization_role_permission(role_code,permission_code) VALUES
 ('engineering_approver','recipe.release'),
 ('engineering_approver','recipe.withdraw.engineering'),
 ('quality_approver','recipe.withdraw.quality');

CREATE FUNCTION recipe_release_actor(p_product uuid,p_withdraw boolean) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; allowed boolean;
BEGIN
 actor:=execution_transaction_actor();
 allowed:=CASE WHEN p_withdraw THEN
   authorization_permits(actor,'recipe.withdraw.engineering',NULL,p_product,NULL)
   OR authorization_permits(actor,'recipe.withdraw.quality',NULL,p_product,NULL)
 ELSE authorization_permits(actor,'recipe.release',NULL,p_product,NULL) END;
 IF p_product IS NULL OR allowed IS NOT TRUE THEN
   RAISE EXCEPTION 'Geen actuele MES-vrijgave- of intrekkingsbevoegdheid' USING ERRCODE='42501';
 END IF;
 RETURN actor;
END $$;

-- Alle vrijgaven binnen dezelfde receptidentiteit worden geserialiseerd.
-- Conservatief: uitsluitend oplopende revisie/ingangsdatum, en referentie
-- moet de laatste vrijgegeven revisie zijn (ook bij intrekking).
CREATE FUNCTION recipe_release_insert_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v master_recipe_version%ROWTYPE; r recipe_review_round%ROWTYPE;
 product uuid; previous uuid; previous_revision integer; previous_from timestamptz; actor uuid;
BEGIN
 SELECT product_id INTO product FROM master_recipe WHERE id=NEW.master_recipe_id FOR UPDATE;
 actor:=recipe_release_actor(product,false);
 SELECT * INTO STRICT v FROM master_recipe_version WHERE id=NEW.recipe_version_id FOR UPDATE;
 SELECT * INTO STRICT r FROM recipe_review_round WHERE id=NEW.round_id;
 IF v.master_recipe_id<>NEW.master_recipe_id OR r.recipe_version_id<>v.id OR v.lifecycle_status<>'approved'
   OR r.change_no<>v.change_no OR r.snapshot->'current' IS DISTINCT FROM recipe_review_snapshot(v.id)
   OR EXISTS (SELECT 1 FROM recipe_review_round x WHERE x.recipe_version_id=v.id AND x.round_no>r.round_no) THEN
   RAISE EXCEPTION 'Actuele goedgekeurde MBR-ronde vereist' USING ERRCODE='40001';
 END IF;
 IF actor IS DISTINCT FROM NEW.released_by OR actor=ANY(r.contributors) THEN
   RAISE EXCEPTION 'Onafhankelijke persoonlijke vrijgever vereist' USING ERRCODE='42501';
 END IF;
 IF EXISTS (SELECT 1 FROM unnest(r.required_reviews) d WHERE NOT EXISTS (
   SELECT 1 FROM recipe_review_decision x WHERE x.round_id=r.id AND x.domain=d AND x.decision='approve'
 )) THEN RAISE EXCEPTION 'Niet alle verplichte beoordelingen zijn goedgekeurd' USING ERRCODE='23514'; END IF;
 SELECT z.recipe_version_id,p.revision,z.effective_from INTO previous,previous_revision,previous_from
 FROM recipe_release z JOIN master_recipe_version p ON p.id=z.recipe_version_id
 WHERE z.master_recipe_id=v.master_recipe_id ORDER BY z.effective_from DESC LIMIT 1;
 IF r.baseline_version_id IS DISTINCT FROM previous OR
    (previous IS NOT NULL AND (v.revision<=previous_revision OR NEW.effective_from<=previous_from)) THEN
   RAISE EXCEPTION 'Vrijgave vereist laatste vrijgegeven referentie en oplopende revisie en ingangsdatum' USING ERRCODE='23514';
 END IF;
 IF r.baseline_version_id IS NOT NULL AND
    r.snapshot->'baseline' IS DISTINCT FROM recipe_review_snapshot(r.baseline_version_id) THEN
   RAISE EXCEPTION 'Referentie-inhoud wijkt af' USING ERRCODE='40001';
 END IF;
 IF NEW.released_at IS NULL OR NEW.effective_from IS NULL OR NOT isfinite(NEW.effective_from)
   OR NEW.effective_from<NEW.released_at THEN
   RAISE EXCEPTION 'Geldige niet-teruggedateerde ingangsdatum vereist' USING ERRCODE='23514';
 END IF;
 PERFORM recipe_assert_release_content(v.id);
 RETURN NEW;
END $$;

CREATE FUNCTION recipe_withdrawal_insert_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE rel recipe_release%ROWTYPE; product uuid; actor uuid;
BEGIN
 SELECT * INTO STRICT rel FROM recipe_release WHERE id=NEW.release_id;
 SELECT product_id INTO product FROM master_recipe WHERE id=rel.master_recipe_id FOR UPDATE;
 PERFORM 1 FROM master_recipe_version WHERE id=rel.recipe_version_id FOR UPDATE;
 actor:=recipe_release_actor(product,true);
 IF actor IS DISTINCT FROM NEW.withdrawn_by OR NEW.withdrawn_at<rel.released_at THEN
   RAISE EXCEPTION 'Persoonlijk geldig intrekkingsbesluit vereist' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER recipe_release_closed ON recipe_release;
DROP TRIGGER recipe_release_withdrawal_closed ON recipe_release_withdrawal;
CREATE TRIGGER recipe_release_guard BEFORE INSERT ON recipe_release
 FOR EACH ROW EXECUTE FUNCTION recipe_release_insert_guard();
CREATE TRIGGER recipe_withdrawal_guard BEFORE INSERT ON recipe_release_withdrawal
 FOR EACH ROW EXECUTE FUNCTION recipe_withdrawal_insert_guard();

-- Status released betekent formeel vrijgegeven (eventueel toekomstig).
-- Effectieve vervanging wordt afgeleid uit het geldigheidsinterval;
-- geen timer, geen overschrijving van historische releasegegevens.
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
 ELSIF OLD.lifecycle_status='approved' AND NEW.lifecycle_status='released' THEN
   IF NOT EXISTS (SELECT 1 FROM recipe_release WHERE recipe_version_id=OLD.id AND round_id=r.id) THEN
     RAISE EXCEPTION 'Formeel vrijgavebewijs vereist' USING ERRCODE='55000';
   END IF;
 ELSIF OLD.lifecycle_status='released' AND NEW.lifecycle_status='withdrawn' THEN
   IF NOT EXISTS (SELECT 1 FROM recipe_release z JOIN recipe_release_withdrawal w ON w.release_id=z.id WHERE z.recipe_version_id=OLD.id) THEN
     RAISE EXCEPTION 'Formeel intrekkingsbewijs vereist' USING ERRCODE='55000';
   END IF;
 ELSE
   RAISE EXCEPTION 'MBR-statusovergang nog niet beschikbaar' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION recipe_release_confirmed(p_version uuid,p_round uuid,p_expected integer,p_effective timestamptz,p_reason text,p_password text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; name text; login record; recipe uuid; product uuid; v master_recipe_version%ROWTYPE; r recipe_review_round%ROWTYPE; target uuid; stamp timestamptz;
BEGIN
 actor:=execution_transaction_actor();
 SELECT gebruikersnaam INTO name FROM gebruiker WHERE id=actor AND actief AND NOT gedeeld AND NOT wachtwoord_wijzigen FOR UPDATE;
 IF NOT FOUND OR execution_transaction_actor() IS DISTINCT FROM actor THEN RETURN jsonb_build_object('status','denied'); END IF;
 SELECT m.id,m.product_id INTO recipe,product FROM master_recipe_version x JOIN master_recipe m ON m.id=x.master_recipe_id WHERE x.id=p_version;
 PERFORM recipe_release_actor(product,false);
 PERFORM 1 FROM master_recipe WHERE id=recipe FOR UPDATE;
 SELECT * INTO STRICT v FROM master_recipe_version WHERE id=p_version FOR UPDATE;
 SELECT * INTO r FROM recipe_review_round WHERE id=p_round AND recipe_version_id=p_version;
 IF NOT FOUND OR v.lifecycle_status<>'approved' OR v.change_no IS DISTINCT FROM p_expected OR r.change_no<>v.change_no THEN
   RAISE EXCEPTION 'Actuele goedgekeurde MBR-ronde vereist' USING ERRCODE='40001';
 END IF;
 IF actor=ANY(r.contributors) THEN RAISE EXCEPTION 'Onafhankelijke persoonlijke vrijgever vereist' USING ERRCODE='42501'; END IF;
 IF btrim(coalesce(p_reason,''))='' OR (p_effective IS NOT NULL AND (NOT isfinite(p_effective) OR p_effective<clock_timestamp())) THEN
   RAISE EXCEPTION 'Reden en niet-teruggedateerde ingangsdatum vereist' USING ERRCODE='23514';
 END IF;
 PERFORM recipe_assert_release_content(p_version);
 SELECT * INTO login FROM inloggen(name,p_password,NULL);
 IF login.wacht_seconden IS NOT NULL THEN RETURN jsonb_build_object('status','locked'); END IF;
 IF login.id IS DISTINCT FROM actor THEN RETURN jsonb_build_object('status','denied'); END IF;
 stamp:=clock_timestamp();
 INSERT INTO recipe_release(master_recipe_id,recipe_version_id,round_id,effective_from,released_at,released_by,reason)
 VALUES(recipe,p_version,p_round,coalesce(p_effective,stamp),stamp,actor,p_reason) RETURNING id INTO target;
 UPDATE master_recipe_version SET lifecycle_status='released' WHERE id=p_version;
 RETURN jsonb_build_object('status','released','release_id',target);
END $$;

CREATE FUNCTION recipe_withdraw_confirmed(p_release uuid,p_reason text,p_password text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; name text; login record; rel recipe_release%ROWTYPE; product uuid; target uuid;
BEGIN
 actor:=execution_transaction_actor();
 SELECT gebruikersnaam INTO name FROM gebruiker WHERE id=actor AND actief AND NOT gedeeld AND NOT wachtwoord_wijzigen FOR UPDATE;
 IF NOT FOUND OR execution_transaction_actor() IS DISTINCT FROM actor THEN RETURN jsonb_build_object('status','denied'); END IF;
 SELECT * INTO rel FROM recipe_release WHERE id=p_release;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende vrijgave' USING ERRCODE='23503'; END IF;
 SELECT product_id INTO product FROM master_recipe WHERE id=rel.master_recipe_id;
 PERFORM recipe_release_actor(product,true);
 PERFORM 1 FROM master_recipe WHERE id=rel.master_recipe_id FOR UPDATE;
 PERFORM 1 FROM master_recipe_version WHERE id=rel.recipe_version_id FOR UPDATE;
 IF EXISTS (SELECT 1 FROM recipe_release_withdrawal WHERE release_id=p_release) THEN
   RAISE EXCEPTION 'Vrijgave is al ingetrokken' USING ERRCODE='23505';
 END IF;
 IF btrim(coalesce(p_reason,''))='' THEN RAISE EXCEPTION 'Intrekkingsreden vereist' USING ERRCODE='23514'; END IF;
 SELECT * INTO login FROM inloggen(name,p_password,NULL);
 IF login.wacht_seconden IS NOT NULL THEN RETURN jsonb_build_object('status','locked'); END IF;
 IF login.id IS DISTINCT FROM actor THEN RETURN jsonb_build_object('status','denied'); END IF;
 INSERT INTO recipe_release_withdrawal(release_id,withdrawn_by,reason)
 VALUES(p_release,actor,p_reason) RETURNING id INTO target;
 UPDATE master_recipe_version SET lifecycle_status='withdrawn' WHERE id=rel.recipe_version_id;
 RETURN jsonb_build_object('status','withdrawn','withdrawal_id',target);
END $$;
REVOKE ALL ON FUNCTION recipe_release_actor(uuid,boolean),recipe_release_insert_guard(),recipe_withdrawal_insert_guard(),
 recipe_release_confirmed(uuid,uuid,integer,timestamptz,text,text),recipe_withdraw_confirmed(uuid,text,text) FROM PUBLIC;
-- De selector is nog intern; CR-koppeling volgt fase 6.
