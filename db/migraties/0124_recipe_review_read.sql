-- Migratie 0124: persoonlijke read-only toegang tot MBR-beoordelingsbewijs.
SET search_path = fabriek, public;

CREATE FUNCTION recipe_review_read_permitted(p_actor uuid,p_product uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,fabriek,pg_temp AS $$
 SELECT p_product IS NOT NULL AND EXISTS (
   SELECT 1 FROM unnest(ARRAY['recipe.draft.manage','recipe.review.engineering',
     'recipe.review.production','recipe.review.quality','recipe.release',
     'recipe.withdraw.engineering','recipe.withdraw.quality']) AS perm(code)
   WHERE authorization_permits(p_actor,perm.code,NULL,p_product,NULL) IS TRUE
 )
$$;

-- Geen algemene toegang tot concepten. Alleen versies waarvoor een
-- beoordelingsronde bestaat; actuele inhoud uitsluitend voor auteurs via
-- bestaande conceptinterface. Historische rondes blijven raadpleegbaar.
CREATE FUNCTION recipe_review_inbox(p_product uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; result jsonb;
BEGIN
 actor:=execution_transaction_actor();
 IF recipe_review_read_permitted(actor,p_product) IS NOT TRUE THEN
   RAISE EXCEPTION 'Geen actuele MES-beoordelingsleestoegang' USING ERRCODE='42501';
 END IF;
 SELECT COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.recipe_code,q.revision DESC),'[]'::jsonb) INTO result
 FROM (
 SELECT m.id AS master_recipe_id,m.code AS recipe_code,v.id AS recipe_version_id,v.revision,
 v.lifecycle_status,r.id AS round_id,r.round_no,r.change_no,
 r.snapshot->'current'->'header'->>'name' AS name,r.required_reviews,
 ARRAY(SELECT d.domain FROM recipe_review_decision d WHERE d.round_id=r.id AND d.decision='approve' ORDER BY d.domain) AS approved_domains,
 ARRAY(SELECT d FROM unnest(r.required_reviews) d
       WHERE v.lifecycle_status='in_review' AND actor<>ALL(r.contributors)
       AND authorization_permits(actor,'recipe.review.'||d,NULL,p_product,NULL) IS TRUE
       AND NOT EXISTS (SELECT 1 FROM recipe_review_decision x WHERE x.round_id=r.id AND (x.domain=d OR x.reviewer_id=actor))
       ORDER BY d) AS my_pending_domains
 FROM master_recipe m JOIN master_recipe_version v ON v.master_recipe_id=m.id
 JOIN LATERAL (SELECT rr.* FROM recipe_review_round rr WHERE rr.recipe_version_id=v.id ORDER BY rr.round_no DESC LIMIT 1) r ON true
 WHERE m.product_id=p_product
 ) q;
 RETURN result;
END $$;

-- Exacte snapshot als TEXT: de JSONB-getallen mogen niet ongemerkt door
-- JavaScript Number worden afgerond. HTTP retourneert deze tekst expliciet.
CREATE FUNCTION recipe_review_dossier(p_round uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; product uuid; r recipe_review_round%ROWTYPE; v master_recipe_version%ROWTYPE; result jsonb;
BEGIN
 actor:=execution_transaction_actor();
 SELECT m.product_id INTO product FROM recipe_review_round rr JOIN master_recipe_version x ON x.id=rr.recipe_version_id
 JOIN master_recipe m ON m.id=x.master_recipe_id WHERE rr.id=p_round;
 IF recipe_review_read_permitted(actor,product) IS NOT TRUE THEN
   RAISE EXCEPTION 'Geen actuele MES-beoordelingsleestoegang' USING ERRCODE='42501';
 END IF;
 SELECT * INTO STRICT r FROM recipe_review_round WHERE id=p_round;
 SELECT * INTO STRICT v FROM master_recipe_version WHERE id=r.recipe_version_id FOR SHARE;
 SELECT jsonb_build_object(
 'round', (to_jsonb(r)-'snapshot') || jsonb_build_object('snapshot_text',r.snapshot::text),
 'lifecycle_status',v.lifecycle_status,
 'is_current',v.lifecycle_status IN ('in_review','approved','released','withdrawn')
     AND v.change_no=r.change_no
     AND NOT EXISTS (SELECT 1 FROM recipe_review_round x WHERE x.recipe_version_id=v.id AND x.round_no>r.round_no),
 'decisions',COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.decided_at,d.id) FROM recipe_review_decision d WHERE d.round_id=r.id),'[]'::jsonb),
 'release',(SELECT to_jsonb(z) FROM recipe_release z WHERE z.round_id=r.id),
 'withdrawal',(SELECT to_jsonb(w) FROM recipe_release z JOIN recipe_release_withdrawal w ON w.release_id=z.id WHERE z.round_id=r.id)
 ) INTO result;
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION recipe_review_read_permitted(uuid,uuid),recipe_review_inbox(uuid),recipe_review_dossier(uuid) FROM PUBLIC;
-- Uitsluitend leestoegang; conceptmutaties en besluiten blijven onder de
-- bestaande afzonderlijke capabilities en herbevestiging.
