-- Migratie 0067: nieuw uitvoeringsbewijs bij bevestigde wachtwoordwijziging.
SET search_path = fabriek, public;
CREATE FUNCTION execution_session_change_password(p_user uuid,p_version bigint,p_current text,p_new text)
RETURNS TABLE(status text,session_version bigint,session_proof text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v record; v_proof text; v_now timestamptz;
BEGIN
    SELECT * INTO v FROM change_password_session(p_user,p_version,p_current,p_new);
    IF v.status='changed' THEN
        PERFORM 1 FROM gebruiker g WHERE g.id=p_user AND g.session_version=v.session_version
            AND g.actief AND NOT g.gedeeld AND NOT g.wachtwoord_wijzigen AND g.rol<>'scherm' FOR SHARE;
        IF FOUND THEN
            v_now:=clock_timestamp();
            v_proof:=encode(public.gen_random_bytes(32),'hex');
            INSERT INTO execution_session(proof_hash,user_id,session_version,issued_at,expires_at)
            VALUES(public.digest(v_proof,'sha256'),p_user,v.session_version,v_now,v_now+interval '12 hours');
        END IF;
    END IF;
    RETURN QUERY SELECT v.status,v.session_version,v_proof;
END $$;
REVOKE ALL ON FUNCTION execution_session_change_password(uuid,bigint,text,text) FROM PUBLIC;
