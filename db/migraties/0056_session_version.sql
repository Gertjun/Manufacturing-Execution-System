-- Migratie 0056: sessiegeneratie bij identiteitswijzigingen.
SET search_path = fabriek, public;
ALTER TABLE gebruiker ADD COLUMN session_version bigint NOT NULL DEFAULT 1 CHECK (session_version > 0);
CREATE FUNCTION authorization_session_version() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog,fabriek,pg_temp AS $$
BEGIN
    IF TG_OP='INSERT' THEN
        NEW.session_version := 1;
    ELSIF NEW.wachtwoord_hash IS DISTINCT FROM OLD.wachtwoord_hash
       OR NEW.wachtwoord_wijzigen IS DISTINCT FROM OLD.wachtwoord_wijzigen
       OR NEW.actief IS DISTINCT FROM OLD.actief OR NEW.rol IS DISTINCT FROM OLD.rol
       OR NEW.gedeeld IS DISTINCT FROM OLD.gedeeld
       OR NEW.gebruikersnaam IS DISTINCT FROM OLD.gebruikersnaam THEN
        NEW.session_version := OLD.session_version + 1;
    ELSE
        NEW.session_version := OLD.session_version;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER authorization_session_version BEFORE INSERT OR UPDATE ON gebruiker
    FOR EACH ROW EXECUTE FUNCTION authorization_session_version();
REVOKE EXECUTE ON FUNCTION authorization_session_version() FROM PUBLIC;

-- Neem de generatie onder dezelfde accountlock als de wachtwoordcontrole op.
CREATE FUNCTION login_with_session(p_name text,p_password text,p_pc text)
RETURNS TABLE(id uuid,rol text,gebruikersnaam text,wacht_seconden int,session_version bigint,ww boolean)
LANGUAGE plpgsql SET search_path = pg_catalog,fabriek,public,pg_temp AS $$
DECLARE v record;
BEGIN
    SELECT * INTO v FROM inloggen(p_name,p_password,p_pc);
    IF v.id IS NULL THEN
        RETURN QUERY SELECT NULL::uuid,NULL::text,NULL::text,v.wacht_seconden,NULL::bigint,NULL::boolean;
    ELSE
        RETURN QUERY SELECT v.id,v.rol,v.gebruikersnaam,v.wacht_seconden,g.session_version,g.wachtwoord_wijzigen
            FROM gebruiker g WHERE g.id=v.id;
    END IF;
END $$;

-- De oude token-generatie moet ook binnen de wijzigingstransactie kloppen.
CREATE FUNCTION change_password_session(p_user uuid,p_version bigint,p_current text,p_new text)
RETURNS TABLE(status text,session_version bigint)
LANGUAGE plpgsql SET search_path = pg_catalog,fabriek,public,pg_temp AS $$
DECLARE v_status text;
BEGIN
    PERFORM 1 FROM gebruiker g WHERE g.id=p_user AND g.session_version=p_version FOR UPDATE;
    IF NOT FOUND THEN RETURN QUERY SELECT 'stale'::text,NULL::bigint; RETURN; END IF;
    v_status := change_password_confirmed(p_user,p_current,p_new);
    RETURN QUERY SELECT v_status,g.session_version FROM gebruiker g WHERE g.id=p_user;
END $$;
REVOKE EXECUTE ON FUNCTION login_with_session(text,text,text),change_password_session(uuid,bigint,text,text) FROM PUBLIC;
