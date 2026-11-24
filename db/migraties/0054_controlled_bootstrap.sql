-- Migratie 0054: expliciete bootstrap uitsluitend op een lege identiteitsadministratie.
SET search_path = fabriek, public;

CREATE TABLE authorization_bootstrap (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    system_user uuid NOT NULL REFERENCES gebruiker(id),
    security_user_a uuid NOT NULL REFERENCES gebruiker(id),
    security_user_b uuid NOT NULL REFERENCES gebruiker(id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    database_actor text NOT NULL,
    reason text NOT NULL CHECK (btrim(reason) <> ''),
    CHECK (system_user <> security_user_a AND system_user <> security_user_b AND security_user_a <> security_user_b)
);

CREATE FUNCTION authorization_bootstrap_empty(p_system text,p_system_password text,
    p_a text,p_a_password text,p_b text,p_b_password text,p_reason text)
RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog,fabriek,public,pg_temp AS $$
DECLARE v_system uuid; v_a uuid; v_b uuid;
BEGIN
    IF current_user <> pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='fabriek.gebruiker'::regclass)) THEN
        RAISE EXCEPTION 'Bootstrap vereist database-eigenaar';
    END IF;
    LOCK TABLE gebruiker IN SHARE ROW EXCLUSIVE MODE;
    IF EXISTS (SELECT 1 FROM gebruiker) OR EXISTS (SELECT 1 FROM authorization_bootstrap) THEN
        RAISE EXCEPTION 'Bootstrap uitsluitend op lege identiteitsadministratie';
    END IF;
    IF p_system IS NULL OR p_a IS NULL OR p_b IS NULL
       OR p_system !~ '^[a-z0-9._-]{3,40}$' OR p_a !~ '^[a-z0-9._-]{3,40}$' OR p_b !~ '^[a-z0-9._-]{3,40}$'
       OR p_system=p_a OR p_system=p_b OR p_a=p_b
       OR length(coalesce(p_system_password,'')) < 8 OR length(coalesce(p_a_password,'')) < 8
       OR length(coalesce(p_b_password,'')) < 8
       OR p_system_password=p_a_password OR p_system_password=p_b_password OR p_a_password=p_b_password
       OR btrim(coalesce(p_reason,''))='' THEN
        RAISE EXCEPTION 'Drie afzonderlijke identiteiten, wachtwoorden en reden vereist';
    END IF;
    INSERT INTO gebruiker(gebruikersnaam,rol,wachtwoord_hash)
      VALUES(p_system,'beheerder',wachtwoord_hash(p_system_password)) RETURNING id INTO v_system;
    INSERT INTO gebruiker(gebruikersnaam,rol,wachtwoord_hash)
      VALUES(p_a,'pending',wachtwoord_hash(p_a_password)) RETURNING id INTO v_a;
    INSERT INTO gebruiker(gebruikersnaam,rol,wachtwoord_hash)
      VALUES(p_b,'pending',wachtwoord_hash(p_b_password)) RETURNING id INTO v_b;
    INSERT INTO authorization_grant(user_id,role_code) VALUES
      (v_system,'system_administrator'),(v_a,'security_administrator'),(v_b,'security_administrator');
    INSERT INTO authorization_bootstrap(system_user,security_user_a,security_user_b,database_actor,reason)
      VALUES(v_system,v_a,v_b,current_user,p_reason);
END $$;
CREATE TRIGGER authorization_bootstrap_immutable BEFORE UPDATE OR DELETE ON authorization_bootstrap
    FOR EACH ROW EXECUTE FUNCTION authorization_audit_immutable();
REVOKE ALL ON authorization_bootstrap FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION authorization_bootstrap_empty(text,text,text,text,text,text,text) FROM PUBLIC;
