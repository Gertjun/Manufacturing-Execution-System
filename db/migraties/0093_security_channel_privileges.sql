-- Migratie 0093: toets effectieve persoonlijke rechten in de MES-database (D100).
CREATE OR REPLACE FUNCTION fabriek.authorization_channel_role_safe(p_role oid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog,pg_temp AS $$
 SELECT EXISTS (SELECT 1 FROM pg_roles r WHERE r.oid=p_role AND r.rolcanlogin
    AND NOT r.rolsuper AND NOT r.rolcreaterole AND NOT r.rolcreatedb
    AND NOT r.rolreplication AND NOT r.rolbypassrls)
 AND pg_has_role(p_role,'mes_security_channel','MEMBER')
 AND NOT EXISTS (SELECT 1 FROM pg_roles r WHERE r.oid<>p_role AND r.rolname<>'mes_security_channel'
                 AND pg_has_role(p_role,r.oid,'MEMBER'))
 AND NOT EXISTS (SELECT 1 FROM pg_auth_members a WHERE a.member=p_role AND a.admin_option)
 AND NOT EXISTS (
   SELECT 1 FROM pg_database d WHERE d.datname=current_database()
     AND (d.datdba=p_role OR has_database_privilege(p_role,d.oid,'CREATE'))
 )
 AND NOT EXISTS (
   SELECT 1 FROM pg_namespace n WHERE n.nspname IN ('fabriek','public')
     AND (n.nspowner=p_role OR has_schema_privilege(p_role,n.oid,'CREATE'))
 )
 AND NOT EXISTS (
   SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='fabriek' AND
     (c.relowner=p_role OR CASE
       WHEN c.relkind IN ('r','p','v','m','f') THEN
         has_any_column_privilege(p_role,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')
         OR has_table_privilege(p_role,c.oid,'DELETE,TRUNCATE,TRIGGER')
       WHEN c.relkind='S' THEN has_sequence_privilege(p_role,c.oid,'SELECT,USAGE,UPDATE')
       ELSE false END)
 )
 AND NOT EXISTS (
   SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='fabriek'
     AND (p.proowner=p_role
       OR has_function_privilege(p_role,p.oid,'EXECUTE WITH GRANT OPTION')
       OR (has_function_privilege(p_role,p.oid,'EXECUTE')
           AND NOT has_function_privilege('mes_security_channel',p.oid,'EXECUTE')))
 )
$;
