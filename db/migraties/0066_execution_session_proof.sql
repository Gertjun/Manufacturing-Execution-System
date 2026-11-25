-- Migratie 0066: database-uitgegeven persoonlijk sessiebewijs.
SET search_path = fabriek, public;

CREATE TABLE execution_session (
    proof_hash bytea PRIMARY KEY CHECK (octet_length(proof_hash)=32),
    user_id uuid NOT NULL REFERENCES gebruiker(id),
    session_version bigint NOT NULL,
    issued_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    CHECK (expires_at > issued_at AND expires_at <= issued_at + interval '12 hours')
);
CREATE INDEX execution_session_expiry ON execution_session(expires_at);
REVOKE ALL ON execution_session FROM PUBLIC;

-- Alleen na succesvolle wachtwoordauthenticatie; geen functie die een
-- sessiebewijs uitgeeft op basis van een los opgegeven gebruikers-ID.
CREATE FUNCTION execution_session_login(p_name text,p_password text,p_pc text)
RETURNS TABLE(id uuid,rol text,gebruikersnaam text,wacht_seconden int,session_version bigint,ww boolean,session_proof text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v record; v_proof text; v_now timestamptz:=clock_timestamp();
BEGIN
    SELECT * INTO v FROM login_with_session(p_name,p_password,p_pc);
    IF v.id IS NOT NULL AND NOT coalesce(v.ww,true) THEN
        PERFORM 1 FROM gebruiker g WHERE g.id=v.id AND g.session_version=v.session_version
            AND g.actief AND NOT g.gedeeld AND NOT g.wachtwoord_wijzigen AND g.rol<>'scherm' FOR SHARE;
        IF FOUND THEN
            v_proof:=encode(public.gen_random_bytes(32),'hex');
            INSERT INTO execution_session(proof_hash,user_id,session_version,issued_at,expires_at)
            VALUES(public.digest(v_proof,'sha256'),v.id,v.session_version,v_now,v_now+interval '12 hours');
        END IF;
    END IF;
    RETURN QUERY SELECT v.id,v.rol,v.gebruikersnaam,v.wacht_seconden,v.session_version,v.ww,v_proof;
END $$;

-- Een bewijs is een bearer credential. Geen gebruikers-ID vertrouwen uit
-- GUC, HTTP-header of functieargument zonder dit bewijs te valideren.
CREATE FUNCTION execution_session_actor(p_proof text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_actor uuid;
BEGIN
    IF p_proof IS NULL OR length(p_proof)<>64 OR p_proof !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
    SELECT g.id INTO v_actor FROM execution_session s JOIN gebruiker g ON g.id=s.user_id
       WHERE s.proof_hash=public.digest(p_proof,'sha256')
         AND s.issued_at<=clock_timestamp() AND s.expires_at>clock_timestamp()
         AND s.session_version=g.session_version AND g.actief AND NOT g.gedeeld
         AND NOT g.wachtwoord_wijzigen AND g.rol<>'scherm'
       FOR SHARE OF g;
    RETURN v_actor;
END $$;

-- Alleen de eigenaar ruimt verlopen bewijzen op. Geen productiehistorie.
CREATE FUNCTION execution_session_cleanup() RETURNS bigint
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_count bigint;
BEGIN
    DELETE FROM execution_session WHERE expires_at<=clock_timestamp();
    GET DIAGNOSTICS v_count=ROW_COUNT;
    RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION execution_session_login(text,text,text),execution_session_actor(text),execution_session_cleanup() FROM PUBLIC;
