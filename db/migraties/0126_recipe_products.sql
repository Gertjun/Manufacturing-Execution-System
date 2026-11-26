-- 0126: persoonlijke productkeuze voor MBR-concepten en beoordelingsdossiers.
SET search_path = fabriek, public;
CREATE FUNCTION recipe_products() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid;
BEGIN
 actor:=execution_transaction_actor();
 RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'code',p.code,'name',p.naam,
 'can_edit',authorization_permits(actor,'recipe.draft.manage',NULL,p.id,NULL) IS TRUE,
 'can_review',recipe_review_read_permitted(actor,p.id) IS TRUE) ORDER BY p.code)
 FROM product p WHERE p.actief AND recipe_review_read_permitted(actor,p.id) IS TRUE),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION recipe_products() FROM PUBLIC;
