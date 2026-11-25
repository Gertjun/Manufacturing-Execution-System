-- Migratie 0061: append-only levenscyclus van persoonlijke securitybindingen.
SET search_path = fabriek, public;

-- Een oude rol-OID en naam blijven gereserveerd; een vervangende login heeft
-- een nieuwe naam/OID. Een MES-account mag na intrekking opnieuw worden gebonden.
ALTER TABLE authorization_channel_identity DROP CONSTRAINT authorization_channel_identity_user_id_key;
CREATE TABLE authorization_channel_identity_revocation (
    database_role_oid oid PRIMARY KEY REFERENCES authorization_channel_identity(database_role_oid),
    revoked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    revoked_by name NOT NULL DEFAULT session_user,
    reason text NOT NULL CHECK (btrim(reason)<>'')
);
CREATE TRIGGER authorization_channel_identity_revocation_immutable BEFORE UPDATE OR DELETE
    ON authorization_channel_identity_revocation FOR EACH ROW EXECUTE FUNCTION authorization_audit_immutable();
REVOKE ALL ON authorization_channel_identity_revocation FROM PUBLIC;

-- Geen andere directe of indirecte groepsrollen, ook geen beheeroptie
-- op de toegestane groep. Rechtstreeks toegekende objectprivileges en
-- andere databases vallen buiten deze toets en vereisen IT-controle.
CREATE FUNCTION authorization_channel_role_safe(p_role oid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog,pg_temp AS $$
 SELECT EXISTS (SELECT 1 FROM pg_roles r WHERE r.oid=p_role AND r.rolcanlogin
    AND NOT r.rolsuper AND NOT r.rolcreaterole AND NOT r.rolcreatedb
    AND NOT r.rolreplication AND NOT r.rolbypassrls)
 AND pg_has_role(p_role,'mes_security_channel','MEMBER')
 AND NOT EXISTS (SELECT 1 FROM pg_roles r WHERE r.oid<>p_role AND r.rolname<>'mes_security_channel'
                 AND pg_has_role(p_role,r.oid,'MEMBER'))
 AND NOT EXISTS (SELECT 1 FROM pg_auth_members a WHERE a.member=p_role AND a.admin_option)
$$;

-- Eigenaar-only registratie van een reeds apart door IT ingerichte login.
-- Geen CREATE ROLE, wachtwoordbeheer of automatische MES-grants.
CREATE FUNCTION authorization_channel_bind(p_role name,p_user uuid,p_reason text)
RETURNS oid LANGUAGE plpgsql SET search_path = pg_catalog,fabriek,pg_temp AS $$
DECLARE v_oid oid;
BEGIN
 IF current_user <> pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='fabriek.authorization_channel_identity'::regclass)) THEN
    RAISE EXCEPTION 'Binding vereist database-eigenaar';
 END IF;
 IF btrim(coalesce(p_reason,''))='' THEN RAISE EXCEPTION 'Reden en goedkeuringsreferentie vereist'; END IF;
 SELECT oid INTO v_oid FROM pg_roles WHERE rolname=p_role;
 IF v_oid IS NULL OR NOT authorization_channel_role_safe(v_oid) THEN
    RAISE EXCEPTION 'Ongeschikte persoonlijke database-login';
 END IF;
 PERFORM 1 FROM gebruiker WHERE id=p_user FOR UPDATE;
 IF NOT FOUND OR NOT authorization_permits(p_user,'authorization.read',NULL,NULL,NULL) THEN
    RAISE EXCEPTION 'Geen bevoegde persoonlijke security-identiteit';
 END IF;
 IF EXISTS (SELECT 1 FROM authorization_channel_identity i WHERE i.user_id=p_user
     AND NOT EXISTS (SELECT 1 FROM authorization_channel_identity_revocation v WHERE v.database_role_oid=i.database_role_oid)) THEN
    RAISE EXCEPTION 'MES-identiteit heeft al een actieve binding';
 END IF;
 INSERT INTO authorization_channel_identity(database_role_oid,database_role_name,user_id,reason)
 VALUES(v_oid,p_role,p_user,p_reason);
 RETURN v_oid;
END $$;

CREATE FUNCTION authorization_channel_unbind(p_role name,p_reason text)
RETURNS oid LANGUAGE plpgsql SET search_path = pg_catalog,fabriek,pg_temp AS $$
DECLARE v_oid oid; v_user uuid;
BEGIN
 IF current_user <> pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='fabriek.authorization_channel_identity'::regclass)) THEN
    RAISE EXCEPTION 'Intrekking vereist database-eigenaar';
 END IF;
 IF btrim(coalesce(p_reason,''))='' THEN RAISE EXCEPTION 'Reden vereist'; END IF;
 SELECT database_role_oid,user_id INTO v_oid,v_user FROM authorization_channel_identity WHERE database_role_name=p_role;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende binding'; END IF;
 PERFORM 1 FROM gebruiker WHERE id=v_user FOR UPDATE;
 INSERT INTO authorization_channel_identity_revocation(database_role_oid,reason) VALUES(v_oid,p_reason);
 RETURN v_oid;
END $$;

CREATE OR REPLACE FUNCTION authorization_channel_actor(p_permission text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog,fabriek,pg_temp AS $$
DECLARE v_actor uuid;
BEGIN
    SELECT i.user_id INTO v_actor
    FROM authorization_channel_identity i JOIN pg_roles r ON r.oid=i.database_role_oid
    WHERE r.rolname=session_user AND r.rolname=i.database_role_name
      AND r.rolcanlogin AND NOT r.rolsuper AND NOT r.rolcreaterole AND NOT r.rolcreatedb
      AND NOT r.rolreplication AND NOT r.rolbypassrls
      AND pg_has_role(r.oid,'mes_security_channel','MEMBER')
      AND NOT EXISTS (SELECT 1 FROM pg_roles a WHERE a.rolname IN ('mes_app','batchgui_app')
                     AND pg_has_role(r.oid,a.oid,'MEMBER'))
      AND NOT EXISTS (SELECT 1 FROM authorization_channel_identity_revocation v WHERE v.database_role_oid=i.database_role_oid)
      AND authorization_channel_role_safe(r.oid)
      AND authorization_permits(i.user_id,p_permission,NULL,NULL,NULL);
    IF v_actor IS NULL THEN RAISE EXCEPTION 'Geen gebonden bevoegde security-identiteit'; END IF;
    RETURN v_actor;
END $$;

REVOKE ALL ON FUNCTION authorization_channel_role_safe(oid),authorization_channel_bind(name,uuid,text),
 authorization_channel_unbind(name,text) FROM PUBLIC;
