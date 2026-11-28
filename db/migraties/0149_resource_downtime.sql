-- Migratie 0149: interne persoonlijke middelstilstand (#115.5e).
SET search_path = fabriek, public;

-- Legacy schrijvers blijven beperkt tot stapniveau; de eigenaarinterface
-- hieronder valideert zelf de persoonlijke identiteit en bevoegdheid.
CREATE FUNCTION stilstand_equipment_write_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
    IF NEW.equipment_id IS NOT NULL
       AND current_user <> pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID)) THEN
        RAISE EXCEPTION 'Middelstilstand vereist de gecontroleerde interface' USING ERRCODE='42501';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER stilstand_equipment_write_guard BEFORE INSERT OR UPDATE ON stilstand
    FOR EACH ROW EXECUTE FUNCTION stilstand_equipment_write_guard();
REVOKE ALL ON FUNCTION stilstand_equipment_write_guard() FROM PUBLIC;

DROP INDEX stilstand_een_lopend;
CREATE UNIQUE INDEX stilstand_een_lopend ON stilstand(processtap_id)
    WHERE eind_op IS NULL AND equipment_id IS NULL;
CREATE UNIQUE INDEX stilstand_equipment_een_lopend ON stilstand(equipment_id)
    WHERE eind_op IS NULL AND equipment_id IS NOT NULL;
ALTER TABLE stilstand DROP CONSTRAINT stilstand_equipment_pending;

CREATE FUNCTION resource_downtime_open(p_id uuid,p_pc uuid,p_step uuid,p_equipment uuid,p_reason uuid,p_note text)
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
    -- p_pc is uitsluitend voor de toekomstige vertrouwde API-sessieadapter;
    -- deze functie krijgt in 0149 bewust nog geen applicatie-EXECUTE.
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
    INSERT INTO stilstand(id,processtap_id,oorzaak_id,toelichting,begin_op,pc_id,operator_id,gemeld_door,equipment_id)
        VALUES (p_id,p_step,p_reason,v_note,clock_timestamp(),p_pc,v_operator,actor,p_equipment)
        RETURNING id INTO target;
    RETURN target;
END $$;

CREATE FUNCTION resource_downtime_close(p_id uuid,p_note text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; v_operator uuid; existing stilstand%ROWTYPE;
    v_note text:=nullif(btrim(p_note),'');
BEGIN
    actor:=execution_transaction_actor();
    IF authorization_permits(actor,'downtime.record',NULL,NULL,NULL) IS NOT TRUE THEN
        RAISE EXCEPTION 'Geen actuele globale stilstandbevoegdheid' USING ERRCODE='42501';
    END IF;
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'Middelstilstand vereist read committed' USING ERRCODE='25001';
    END IF;
    IF length(v_note)>500 THEN
        RAISE EXCEPTION 'Ongeldige eindnotitie' USING ERRCODE='22023';
    END IF;
    SELECT id INTO v_operator FROM operator WHERE gebruiker_id=actor AND actief FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Actieve persoonlijke operator vereist' USING ERRCODE='42501';
    END IF;
    SELECT * INTO existing FROM stilstand WHERE id=p_id AND equipment_id IS NOT NULL FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Middelstilstand ontbreekt' USING ERRCODE='P0002';
    END IF;
    IF execution_transaction_actor() IS DISTINCT FROM actor
       OR authorization_permits(actor,'downtime.record',NULL,NULL,NULL) IS NOT TRUE THEN
        RAISE EXCEPTION 'Geen actuele globale stilstandbevoegdheid' USING ERRCODE='42501';
    END IF;
    IF existing.eind_op IS NOT NULL THEN
        IF existing.beeindigd_door IS DISTINCT FROM v_operator OR existing.eind_notitie IS DISTINCT FROM v_note THEN
            RAISE EXCEPTION 'Middelstilstand is al anders afgesloten' USING ERRCODE='40001';
        END IF;
        RETURN p_id;
    END IF;
    UPDATE stilstand SET eind_op=greatest(clock_timestamp(),begin_op),beeindigd_door=v_operator,eind_notitie=v_note
        WHERE id=p_id;
    RETURN p_id;
END $$;

CREATE TRIGGER stilstand_equipment_audit AFTER INSERT OR UPDATE ON stilstand
    FOR EACH ROW WHEN (NEW.equipment_id IS NOT NULL) EXECUTE FUNCTION log_config();

CREATE OR REPLACE FUNCTION meld_stilstand() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v record; v_equipment text;
BEGIN
    SELECT s.code AS stap, s.naam AS stapnaam, o.naam AS oorzaak, o.categorie, pc.locatie AS hal
      INTO v
      FROM processtap s, stilstand_oorzaak o LEFT JOIN pc ON pc.id = NEW.pc_id
     WHERE s.id = NEW.processtap_id AND o.id = NEW.oorzaak_id;
    SELECT code INTO v_equipment FROM equipment WHERE id=NEW.equipment_id;
    IF v.categorie = 'storing' THEN
        INSERT INTO melding (soort, ernst, tekst, hal, voor_rollen, bron_id)
        VALUES ('storing', 'kritiek', format('Stilstand %s %s: %s%s%s', v.stap, v.stapnaam, v.oorzaak,
                coalesce(' (' || NEW.toelichting || ')', ''),coalesce(' [middel ' || v_equipment || ']', '')),
                v.hal, ARRAY['ploegleider'], NEW.id);
    END IF;
    RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION meld_stilstand(),resource_downtime_open(uuid,uuid,uuid,uuid,uuid,text),
    resource_downtime_close(uuid,text) FROM PUBLIC;
-- Geen EXECUTE voor mes_app totdat het vertrouwde API-contextcontract is afgerond.
