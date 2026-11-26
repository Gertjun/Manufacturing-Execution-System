-- 0128: historische beoordelingsrondes binnen bestaande persoonlijke productscope.
SET search_path = fabriek, public;

CREATE OR REPLACE FUNCTION recipe_review_inbox(p_product uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; result jsonb;
BEGIN
 actor:=execution_transaction_actor();
 IF recipe_review_read_permitted(actor,p_product) IS NOT TRUE THEN
   RAISE EXCEPTION 'Geen actuele MES-beoordelingsleestoegang' USING ERRCODE='42501';
 END IF;
 SELECT COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.recipe_code,q.revision DESC,q.round_no DESC),'[]'::jsonb) INTO result
 FROM (
 SELECT m.id AS master_recipe_id,m.code AS recipe_code,v.id AS recipe_version_id,v.revision,
 v.lifecycle_status,r.id AS round_id,r.round_no,r.change_no,
 r.snapshot->'current'->'header'->>'name' AS name,r.required_reviews,
 ARRAY(SELECT d.domain FROM recipe_review_decision d WHERE d.round_id=r.id AND d.decision='approve' ORDER BY d.domain) AS approved_domains,
 ARRAY(SELECT d FROM unnest(r.required_reviews) d
       WHERE v.lifecycle_status='in_review' AND r.change_no=v.change_no AND actor<>ALL(r.contributors)
       AND NOT EXISTS (SELECT 1 FROM recipe_review_round newer WHERE newer.recipe_version_id=v.id AND newer.round_no>r.round_no)
       AND authorization_permits(actor,'recipe.review.'||d,NULL,p_product,NULL) IS TRUE
       AND NOT EXISTS (SELECT 1 FROM recipe_review_decision x WHERE x.round_id=r.id AND (x.domain=d OR x.reviewer_id=actor))
       ORDER BY d) AS my_pending_domains
 FROM master_recipe m JOIN master_recipe_version v ON v.master_recipe_id=m.id
 JOIN recipe_review_round r ON r.recipe_version_id=v.id
 WHERE m.product_id=p_product
 ) q;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION recipe_review_inbox(uuid) FROM PUBLIC;
