-- Migratie 0075: behoud expliciete zoekpaden en beperk oude authenticatie-ingangen.
SET search_path = fabriek, public;

-- Ook functies die door een SECURITY DEFINER worden aangeroepen mogen
-- geen impliciet voorrang gevend pg_temp-zoekpad hebben.
DO $$
DECLARE f record;
BEGIN
 FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
 JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='fabriek' AND p.prokind='f'
 AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig,ARRAY[]::text[])) c
                 WHERE c LIKE 'search_path=%' AND c LIKE '%pg_temp')
 LOOP
   EXECUTE format('ALTER FUNCTION %s SET search_path=pg_catalog,fabriek,public,pg_temp',f.sig);
 END LOOP;
END $$;

REVOKE EXECUTE ON FUNCTION inloggen(text,text,text),change_password_confirmed(uuid,text,text) FROM PUBLIC;
