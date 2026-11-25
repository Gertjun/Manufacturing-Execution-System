-- Migratie 0125: vrijgavevalidatie voor bevoegde beoordelaars.
SET search_path = fabriek, public;

CREATE OR REPLACE FUNCTION recipe_release_validation(p_version uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE product uuid; actor uuid; n integer; state text; blockers jsonb;
BEGIN
 actor:=execution_transaction_actor();
 SELECT r.product_id INTO product FROM master_recipe_version v JOIN master_recipe r ON r.id=v.master_recipe_id WHERE v.id=p_version;
 IF product IS NULL THEN
   RAISE EXCEPTION 'Geen actuele MES-vrijgaveleestoegang' USING ERRCODE='42501';
 END IF;
 SELECT change_no,lifecycle_status INTO n,state FROM master_recipe_version WHERE id=p_version FOR SHARE;
 -- Geen leestoegang tot niet-ingediende of opnieuw geopende concepten
 -- voor beoordelaars; auteurs behouden hun bestaande conceptrecht.
 IF authorization_permits(actor,'recipe.draft.manage',NULL,product,NULL) IS NOT TRUE AND
   (state='draft' OR recipe_review_read_permitted(actor,product) IS NOT TRUE OR
    NOT EXISTS (SELECT 1 FROM recipe_review_round WHERE recipe_version_id=p_version)) THEN
   RAISE EXCEPTION 'Geen actuele MES-vrijgaveleestoegang' USING ERRCODE='42501';
 END IF;
 SELECT COALESCE(jsonb_agg(to_jsonb(b) ORDER BY b.code,b.record_id),'[]'::jsonb) INTO blockers FROM recipe_release_blockers(p_version) b;
 RETURN jsonb_build_object('recipe_version_id',p_version,'change_no',n,'lifecycle_status',state,
 'content_valid',jsonb_array_length(blockers)=0,'blockers',blockers);
END $$;
REVOKE ALL ON FUNCTION recipe_release_validation(uuid) FROM PUBLIC;
-- Bestaande mes_app-executerechten blijven behouden; geen nieuwe grants.
