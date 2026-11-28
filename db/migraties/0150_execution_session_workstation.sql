-- Migratie 0150: geregistreerde werkstationcontext in sessiebewijs (#115.5g1).
SET search_path = fabriek, public;

-- NULL bij bestaande sessies, wachtwoordwisseling en login zonder pc.
-- Geen afleiding uit historische inlogpogingen of clientheaders.
ALTER TABLE execution_session ADD COLUMN pc_id uuid REFERENCES pc(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION execution_session_login(p_name text,p_password text,p_pc text)
RETURNS TABLE(id uuid,rol text,gebruikersnaam text,wacht_seconden int,session_version bigint,ww boolean,session_proof text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v record; v_proof text; v_now timestamptz:=clock_timestamp(); v_pc uuid;
BEGIN
    SELECT * INTO v FROM login_with_session(p_name,p_password,p_pc);
    IF v.id IS NOT NULL AND NOT coalesce(v.ww,true) THEN
        PERFORM 1 FROM gebruiker g WHERE g.id=v.id AND g.session_version=v.session_version
            AND g.actief AND NOT g.gedeeld AND NOT g.wachtwoord_wijzigen AND g.rol<>'scherm' FOR SHARE;
        IF FOUND THEN
            v_proof:=encode(public.gen_random_bytes(32),'hex');
            SELECT p.id INTO v_pc FROM pc p WHERE p.naam=p_pc AND p.actief;
            INSERT INTO execution_session(proof_hash,user_id,session_version,issued_at,expires_at,pc_id)
            VALUES(public.digest(v_proof,'sha256'),v.id,v.session_version,v_now,v_now+interval '12 hours',v_pc);
        END IF;
    END IF;
    RETURN QUERY SELECT v.id,v.rol,v.gebruikersnaam,v.wacht_seconden,v.session_version,v.ww,v_proof;
END $$;

-- Nieuwe credential voor de gekozen actieve pc; originele credential en
-- oorspronkelijke maximale geldigheid blijven onveranderd.
-- De volgende slice koppelt dit aan /auth/pc; nog geen app-EXECUTE.
CREATE FUNCTION execution_session_workstation(p_proof text,p_pc uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; v_version bigint; v_expiry timestamptz; v_now timestamptz; v_new text;
BEGIN
    actor:=execution_session_actor(p_proof);
    IF actor IS NULL OR p_pc IS NULL THEN
        RAISE EXCEPTION 'Geldig persoonlijk werkstationbewijs vereist' USING ERRCODE='42501';
    END IF;
    PERFORM 1 FROM operator WHERE gebruiker_id=actor AND actief FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Actieve persoonlijke operator vereist' USING ERRCODE='42501';
    END IF;
    PERFORM id FROM pc WHERE id=p_pc AND actief FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Actief geregistreerd werkstation vereist' USING ERRCODE='42501';
    END IF;
    SELECT session_version,expires_at INTO v_version,v_expiry FROM execution_session
        WHERE proof_hash=public.digest(p_proof,'sha256') AND user_id=actor;
    v_now:=clock_timestamp();
    IF NOT FOUND OR v_expiry<=v_now OR execution_session_actor(p_proof) IS DISTINCT FROM actor THEN
        RAISE EXCEPTION 'Persoonlijk sessiebewijs verlopen' USING ERRCODE='42501';
    END IF;
    v_new:=encode(public.gen_random_bytes(32),'hex');
    INSERT INTO execution_session(proof_hash,user_id,session_version,issued_at,expires_at,pc_id)
        VALUES(public.digest(v_new,'sha256'),actor,v_version,v_now,v_expiry,p_pc);
    RETURN v_new;
END $$;

CREATE FUNCTION execution_transaction_workstation(p_expected uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; v_pc uuid; v_proof text:=current_setting('fabriek.execution_proof',true);
BEGIN
    actor:=execution_transaction_actor();
    SELECT s.pc_id INTO v_pc FROM execution_session s JOIN pc p ON p.id=s.pc_id AND p.actief
        WHERE s.proof_hash=public.digest(v_proof,'sha256') AND s.user_id=actor;
    IF v_pc IS NULL OR v_pc IS DISTINCT FROM p_expected THEN
        RAISE EXCEPTION 'Werkstation komt niet overeen met persoonlijk sessiebewijs' USING ERRCODE='42501';
    END IF;
    RETURN v_pc;
END $$;
REVOKE ALL ON FUNCTION execution_session_workstation(text,uuid),execution_transaction_workstation(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION resource_downtime_open(p_id uuid,p_pc uuid,p_step uuid,p_equipment uuid,p_reason uuid,p_note text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; v_operator uuid; existing stilstand%ROWTYPE; target uuid;
    v_note text:=nullif(btrim(p_note),'');
BEGIN
    actor:=execution_transaction_actor();
    IF authorization_permits(actor,'downtime.record',NULL,NULL,NULL) IS NOT TRUE THEN
        RAISE EXCEPTION 'Geen actuele globale stilstandbevoegdheid' USING ERRCODE='42501';
    END IF;
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'Middelstilstand vereist read committed' USING ERRCODE='25001';
    END IF;
    IF p_id IS NULL OR p_pc IS NULL OR p_step IS NULL OR p_equipment IS NULL OR p_reason IS NULL
       OR length(v_note)>500 THEN
        RAISE EXCEPTION 'Ongeldige middelstilstandcontext' USING ERRCODE='22023';
    END IF;
    PERFORM execution_transaction_workstation(p_pc);
    SELECT id INTO v_operator FROM operator WHERE gebruiker_id=actor AND actief FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Actieve persoonlijke operator vereist' USING ERRCODE='42501';
    END IF;
    -- Serialiseer dezelfde clientidentiteit binnen deze interface.
    PERFORM pg_advisory_xact_lock(hashtextextended('resource-downtime:'||p_id::text,0));
    SELECT * INTO existing FROM stilstand WHERE id=p_id;
    IF FOUND THEN
        IF (existing.gemeld_door,existing.pc_id,existing.processtap_id,existing.equipment_id,existing.oorzaak_id,existing.toelichting)
           IS DISTINCT FROM (actor,p_pc,p_step,p_equipment,p_reason,v_note) THEN
            RAISE EXCEPTION 'Dit id hoort bij een andere stilstandmelding' USING ERRCODE='23505';
        END IF;
        RETURN p_id;
    END IF;
    -- De pc komt overeen met het persoonlijk sessiebewijs.
    PERFORM id FROM pc WHERE id=p_pc AND actief FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Actief werkstation vereist' USING ERRCODE='42501';
    END IF;
    PERFORM 1 FROM pc_stap WHERE pc_id=p_pc AND processtap_id=p_step FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Geen expliciete werkstation-stapkoppeling' USING ERRCODE='42501';
    END IF;
    PERFORM id FROM equipment_workstation
        WHERE pc_id=p_pc AND equipment_id=p_equipment AND closed_at IS NULL FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Geen actieve werkstation-middelenkoppeling' USING ERRCODE='42501';
    END IF;
    PERFORM id FROM processtap WHERE id=p_step AND actief AND soort='proces' FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Actieve processtap vereist' USING ERRCODE='23514';
    END IF;
    PERFORM id FROM stilstand_oorzaak WHERE id=p_reason AND actief FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Actieve stilstandoorzaak vereist' USING ERRCODE='23514';
    END IF;
    IF execution_transaction_actor() IS DISTINCT FROM actor
       OR authorization_permits(actor,'downtime.record',NULL,NULL,NULL) IS NOT TRUE THEN
        RAISE EXCEPTION 'Geen actuele globale stilstandbevoegdheid' USING ERRCODE='42501';
    END IF;
    PERFORM execution_transaction_workstation(p_pc);
    INSERT INTO stilstand(id,processtap_id,oorzaak_id,toelichting,begin_op,pc_id,operator_id,gemeld_door,equipment_id)
        VALUES (p_id,p_step,p_reason,v_note,clock_timestamp(),p_pc,v_operator,actor,p_equipment)
        RETURNING id INTO target;
    RETURN target;
END $$;
REVOKE ALL ON FUNCTION resource_downtime_open(uuid,uuid,uuid,uuid,uuid,text) FROM PUBLIC;
