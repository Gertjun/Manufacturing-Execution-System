-- D103: toon uitsluitend actuele MES-demo-identiteiten, zonder accounts of grants te wijzigen.
SET search_path = fabriek, public;
CREATE OR REPLACE FUNCTION demo_account_names(p_names text[]) RETURNS TABLE(gebruikersnaam text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog,fabriek,public,pg_temp AS $$
    SELECT g.gebruikersnaam FROM fabriek.gebruiker g
      WHERE g.actief AND NOT g.gedeeld AND lower(g.gebruikersnaam)=ANY(p_names)
        AND lower(g.gebruikersnaam) IN ('mes.operator','mes.supervisor','mes.manager','mes.planner','mes.engineer','mes.eng.approver','mes.quality','mes.quality.approver','mes.maintenance','mes.system','mes.security.a','mes.security.b','mes.analyst','mes.display')
        AND g.wachtwoord_hash=public.crypt('demo',g.wachtwoord_hash)
      ORDER BY g.gebruikersnaam
$$;
REVOKE ALL ON FUNCTION demo_account_names(text[]) FROM PUBLIC;
