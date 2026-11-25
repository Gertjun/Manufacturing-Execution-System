-- Migratie 0118: D108 beoordelingsmatrix en onafhankelijke rollen (#112).
SET search_path = fabriek, public;

-- Nieuwe domeinpermissions; geen nieuwe persoonlijke grants.
INSERT INTO authorization_permission(code,domain) VALUES
 ('recipe.review.engineering','engineering'),
 ('recipe.review.production','operations'),
 ('recipe.review.quality','quality');
INSERT INTO authorization_role_permission(role_code,permission_code) VALUES
 ('engineering_approver','recipe.review.engineering'),
 ('manufacturing_manager','recipe.review.production'),
 ('quality_approver','recipe.review.quality');

-- Matrixversie 1 is een vaste, reproduceerbare projectregel. De unie
-- van opgegeven en afgeleide impactgebieden bepaalt alle vereisten.
-- Onbekende gebieden en initiële recepten vereisen alle drie domeinen.
CREATE FUNCTION recipe_review_matrix_v1(p_initial boolean,p_areas text[]) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,fabriek,pg_temp AS $$
 SELECT ARRAY['engineering']::text[]
 || CASE WHEN p_initial IS DISTINCT FROM false OR p_areas IS NULL OR EXISTS (
   SELECT 1 FROM unnest(p_areas) a WHERE a IS NULL OR a NOT IN ('header','quality')
 ) THEN ARRAY['production']::text[] ELSE ARRAY[]::text[] END
 || CASE WHEN p_initial IS DISTINCT FROM false OR p_areas IS NULL OR EXISTS (
   SELECT 1 FROM unnest(p_areas) a WHERE a IS NULL OR a NOT IN ('header','personnel')
 ) THEN ARRAY['quality']::text[] ELSE ARRAY[]::text[] END
$$;

CREATE FUNCTION recipe_review_requirements(p_version uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE diff jsonb; req recipe_change_request%ROWTYPE; areas text[]; reviewers text[];
BEGIN
 -- Vergelijkingsfunctie controleert persoonlijke productscope en neemt
 -- de gedeelde locks op huidige en referentierevisie.
 diff:=recipe_compare_change(p_version);
 SELECT * INTO STRICT req FROM recipe_change_request WHERE recipe_version_id=p_version;
 SELECT COALESCE(array_agg(a ORDER BY a),ARRAY[]::text[]) INTO areas FROM (
   SELECT area AS a FROM recipe_change_impact WHERE recipe_version_id=p_version
   UNION
   SELECT value->>'area' FROM jsonb_array_elements(diff->'differences')
 ) s;
 reviewers:=recipe_review_matrix_v1(req.change_kind='initial',areas);
 RETURN jsonb_build_object('matrix_version',1,'recipe_version_id',p_version,
   'change_no',diff->'change_no','baseline_version_id',diff->'baseline_version_id',
   'baseline_change_no',diff->'baseline_change_no','impact_areas',to_jsonb(areas),
   'required_reviews',to_jsonb(reviewers));
END $$;

-- Intern hulpmiddel voor latere persoonlijke reviewtransacties. Niet
-- uitvoerbaar voor mes_app. Werkelijke review vereist bovendien een
-- vastgezette beoordelingsronde, auteurscontrole en identiteitbevestiging.
CREATE FUNCTION recipe_review_actor(p_version uuid,p_domain text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; product uuid; permission_code text;
BEGIN
 actor:=execution_transaction_actor();
 permission_code:=CASE p_domain WHEN 'engineering' THEN 'recipe.review.engineering'
   WHEN 'production' THEN 'recipe.review.production' WHEN 'quality' THEN 'recipe.review.quality' ELSE NULL END;
 SELECT r.product_id INTO product FROM master_recipe_version v JOIN master_recipe r ON r.id=v.master_recipe_id WHERE v.id=p_version;
 IF permission_code IS NULL OR product IS NULL OR authorization_permits(actor,permission_code,NULL,product,NULL) IS NOT TRUE THEN
   RAISE EXCEPTION 'Geen actuele MES-receptbeoordelingsbevoegdheid' USING ERRCODE='42501';
 END IF;
 RETURN actor;
END $$;
REVOKE ALL ON FUNCTION recipe_review_matrix_v1(boolean,text[]),recipe_review_requirements(uuid),recipe_review_actor(uuid,text) FROM PUBLIC;
-- Geen statusovergang of registratie van een goedkeuringsbesluit.
