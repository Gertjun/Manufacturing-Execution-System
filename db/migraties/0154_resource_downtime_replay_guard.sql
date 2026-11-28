-- Migratie 0154: hercontrole na wachten op middelstilstand-ID (#115.7a).
SET search_path = fabriek, public;

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
    -- Revalidate after the advisory lock, including the replay path.
    IF execution_transaction_actor() IS DISTINCT FROM actor
       OR authorization_permits(actor,'downtime.record',NULL,NULL,NULL) IS NOT TRUE THEN
        RAISE EXCEPTION 'Geen actuele globale stilstandbevoegdheid' USING ERRCODE='42501';
    END IF;
    PERFORM execution_transaction_workstation(p_pc);
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
