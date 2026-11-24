-- Migratie 0040: afscherming wachtwoordhashes en gecontroleerde accountwijziging.
SET search_path = fabriek, public;

-- Alleen bestaande loginfuncties mogen hashes intern lezen.
ALTER FUNCTION inloggen(text,text,text) SECURITY DEFINER;
ALTER FUNCTION inloggen(text,text,text) SET search_path = pg_catalog,fabriek,public;
ALTER FUNCTION wijzig_eigen_wachtwoord(uuid,text,text) SECURITY DEFINER;
ALTER FUNCTION wijzig_eigen_wachtwoord(uuid,text,text) SET search_path = pg_catalog,fabriek,public;
-- Eigen wachtwoord wijzigen blijft mogelijk met het huidige wachtwoord; de
-- eigenaar-only triggerbescherming van 0039 blijft gelden voor directe resets.
REVOKE EXECUTE ON FUNCTION inloggen(text,text,text), wijzig_eigen_wachtwoord(uuid,text,text) FROM PUBLIC;

-- Alleen de demo-indicatie, nooit de hash. Beperkt tot expliciete demoaccounts.
CREATE FUNCTION demo_account_names(p_names text[]) RETURNS TABLE(gebruikersnaam text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog,fabriek,public AS $$
    SELECT g.gebruikersnaam FROM fabriek.gebruiker g
      WHERE g.actief AND NOT g.gedeeld AND lower(g.gebruikersnaam)=ANY(p_names)
        AND lower(g.gebruikersnaam) IN ('operator.a','operator.b','operator.c','operator.d','ploegleider1','kwaliteit1','planner1','beheerder1','analist1','scherm1')
        AND g.wachtwoord_hash=public.crypt('demo',g.wachtwoord_hash)
      ORDER BY g.gebruikersnaam
$$;
REVOKE EXECUTE ON FUNCTION demo_account_names(text[]) FROM PUBLIC;

-- Vervang de oude updatequery (die de hash moest lezen) door twee varianten
-- in de API: zonder wachtwoordwijziging en met een expliciete nieuwe hash.
-- Rechten worden bij iedere migratie opnieuw afgedwongen in rechten.sql.
