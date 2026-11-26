-- Migratie 0129: consistente accountlock bij persoonlijk gebonden transacties.
SET search_path = fabriek, public;

-- Sessiebewijs blijft ongewijzigd gevalideerd. Neem de exclusieve accountlock
-- meteen bij het binden, vóór een objectlock of gedeelde accountlock.
-- Anders kunnen twee bevestigde besluiten van dezelfde gebruiker beide
-- FOR SHARE vasthouden en vervolgens bij FOR UPDATE op elkaar wachten.
-- Alleen gebonden transacties per account worden geserialiseerd; de losse
-- sessiecontrole execution_session_actor blijft een gedeelde read-lock.
CREATE OR REPLACE FUNCTION execution_bind_transaction(p_proof text,p_expected uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_actor uuid;
BEGIN
    IF p_proof IS NULL OR length(p_proof)<>64 OR p_proof !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'Persoonlijke uitvoeringssessie ongeldig' USING ERRCODE='42501';
    END IF;
    SELECT g.id INTO v_actor FROM execution_session s JOIN gebruiker g ON g.id=s.user_id
       WHERE s.proof_hash=public.digest(p_proof,'sha256')
         AND s.issued_at<=clock_timestamp() AND s.expires_at>clock_timestamp()
         AND s.session_version=g.session_version AND g.actief AND NOT g.gedeeld
         AND NOT g.wachtwoord_wijzigen AND g.rol<>'scherm'
         AND g.id=p_expected
       FOR UPDATE OF g;
    IF v_actor IS NULL OR v_actor IS DISTINCT FROM p_expected THEN
        RAISE EXCEPTION 'Persoonlijke uitvoeringssessie ongeldig' USING ERRCODE='42501';
    END IF;
    PERFORM set_config('fabriek.execution_proof',p_proof,true);
    RETURN v_actor;
END $$;
REVOKE ALL ON FUNCTION execution_bind_transaction(text,uuid) FROM PUBLIC;
