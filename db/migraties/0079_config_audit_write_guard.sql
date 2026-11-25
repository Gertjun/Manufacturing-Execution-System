-- Migratie 0079: alleen de configuratietrigger en gecontroleerde eigenaarpaden schrijven het logboek.
SET search_path = fabriek, public;
ALTER FUNCTION log_config() SECURITY DEFINER;
ALTER FUNCTION log_config() SET search_path = pg_catalog,fabriek,pg_temp;
REVOKE ALL ON FUNCTION log_config() FROM PUBLIC;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON fabriek.config_log FROM PUBLIC;
