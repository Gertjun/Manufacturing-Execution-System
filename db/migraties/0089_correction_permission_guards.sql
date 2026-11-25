-- Migratie 0089: correcties en conflictbesluiten onafhankelijk van legacy-rollen (D101).
SET search_path = fabriek, public;

CREATE OR REPLACE FUNCTION verwerk_waarde() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,public,pg_temp AS $$
DECLARE
    v_veld  veld%ROWTYPE;
    v_reg   stapregistratie%ROWTYPE;
    v_oud   waarde%ROWTYPE;
    v_permission text;
    v_grens record;
BEGIN
    SELECT * INTO v_veld FROM veld WHERE id = NEW.veld_id;
    SELECT * INTO v_reg  FROM stapregistratie WHERE id = NEW.stapregistratie_id;

    IF v_veld.processtap_id <> v_reg.processtap_id THEN
        RAISE EXCEPTION 'Veld % hoort niet bij deze stap', v_veld.code;
    END IF;
    IF v_veld.soort = 'procesparameter' AND NEW.setting IS NULL THEN
        RAISE EXCEPTION 'Veld % is een procesparameter: setting is verplicht', v_veld.code;
    END IF;
    IF v_veld.soort <> 'procesparameter' AND NEW.setting IS NOT NULL THEN
        RAISE EXCEPTION 'Veld % heeft geen setting', v_veld.code;
    END IF;

    IF NEW.vervangt_waarde_id IS NULL THEN
        -- Een veld dat Kwaliteit meet (sinds 0022, #64): alleen door iemand van Kwaliteit, in een open stap
        -- of zolang de stap op Kwaliteit wacht.
        IF v_veld.gemeten_door = 'kwaliteit' THEN
            IF NOT EXISTS (
                SELECT 1 FROM operator o WHERE o.id=NEW.ingevoerd_door AND o.actief
                  AND authorization_permits(o.gebruiker_id,'inspection.record',NULL,v_reg.product_id,NULL)
                  AND (v_reg.lot_id IS NULL OR NOT EXISTS (
                      SELECT 1 FROM batch b WHERE b.lot_id=v_reg.lot_id
                        AND NOT authorization_permits(o.gebruiker_id,'inspection.record',NULL,b.product_id,NULL)))
            ) THEN
                RAISE EXCEPTION 'Veld % meet Kwaliteit; actuele MES-meetbevoegdheid vereist', v_veld.code USING ERRCODE='42501';
            END IF;
            IF v_reg.status <> 'open' AND NOT EXISTS (SELECT 1 FROM keuring k WHERE k.stapregistratie_id = v_reg.id AND k.status = 'open') THEN
                RAISE EXCEPTION 'Stap wacht niet meer op Kwaliteit; wijzigen kan alleen als correctie';
            END IF;
        -- Gewone invoer: alleen in een open stap, met actief veld.
        ELSIF v_reg.status <> 'open' THEN
            RAISE EXCEPTION 'Stap is al afgerond; wijzigen kan alleen als correctie door een ploegleider';
        END IF;
        IF NOT v_veld.actief THEN
            RAISE EXCEPTION 'Veld % is inactief', v_veld.code;
        END IF;
        -- Grenzen kopiëren zoals ze nu gelden, voor het product van de batch of het lot (sinds 0019).
        SELECT * INTO v_grens FROM grenzen_van(NEW.veld_id, v_reg.product_id);
        NEW.grens_min := v_grens.grens_min;  NEW.grens_max := v_grens.grens_max;
        NEW.tolerantie := v_grens.tolerantie; NEW.tolerantie_soort := v_grens.tolerantie_soort;
        NEW.specificatie_id := (SELECT x.id FROM specificatie x JOIN specificatie_regel r ON r.specificatie_id = x.id
                                 WHERE r.veld_id = NEW.veld_id AND x.product_id = v_reg.product_id AND x.status = 'vastgesteld');
    ELSE
        -- Correctie: ploegleider of hoger, zelfde registratie en veld,
        -- alleen de nieuwste waarde kan vervangen worden. Kwaliteit lost een conflict op in een veld dat
        -- Kwaliteit meet (sinds 0032, #85): alleen via los_invoerconflict_op.
        IF v_veld.gemeten_door='kwaliteit' THEN
            IF current_user <> pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID))
               OR current_setting('fabriek.conflict',true) IS DISTINCT FROM 'aan' THEN
                RAISE EXCEPTION 'Kwaliteitscorrectie vereist gecontroleerde conflictafhandeling' USING ERRCODE='42501';
            END IF;
            v_permission:='inspection.decide';
        ELSE
            v_permission:='execution.correct';
        END IF;
        IF NOT authorization_permits(NEW.gecorrigeerd_door,v_permission,NULL,v_reg.product_id,NULL)
           OR (v_reg.lot_id IS NOT NULL AND EXISTS (
               SELECT 1 FROM batch b WHERE b.lot_id=v_reg.lot_id
                 AND NOT authorization_permits(NEW.gecorrigeerd_door,v_permission,NULL,b.product_id,NULL))) THEN
            RAISE EXCEPTION 'Geen actuele MES-correctiebevoegdheid' USING ERRCODE='42501';
        END IF;
        SELECT * INTO v_oud FROM waarde WHERE id = NEW.vervangt_waarde_id;
        IF v_oud.stapregistratie_id <> NEW.stapregistratie_id OR v_oud.veld_id <> NEW.veld_id THEN
            RAISE EXCEPTION 'Een correctie hoort bij dezelfde registratie en hetzelfde veld';
        END IF;
        -- Grenzen van de oorspronkelijke meting blijven gelden.
        NEW.grens_min := v_oud.grens_min;  NEW.grens_max := v_oud.grens_max;
        NEW.tolerantie := v_oud.tolerantie; NEW.tolerantie_soort := v_oud.tolerantie_soort;
        NEW.specificatie_id := v_oud.specificatie_id;
    END IF;

    NEW.markering := bereken_markering(NEW.setting, NEW.gemeten, NEW.grens_min, NEW.grens_max,
                                       NEW.tolerantie, NEW.tolerantie_soort);
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION verwerk_grondstof_gebruik() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,public,pg_temp AS $$
DECLARE
    v_reg  stapregistratie%ROWTYPE;
    v_oud  grondstof_gebruik%ROWTYPE;
BEGIN
    SELECT * INTO v_reg FROM stapregistratie WHERE id = NEW.stapregistratie_id;
    NEW.partij := btrim(NEW.partij);
    IF NEW.vervangt_id IS NULL THEN
        IF v_reg.status <> 'open' THEN
            RAISE EXCEPTION 'Stap is al afgerond; wijzigen kan alleen als correctie door een ploegleider';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM stap_grondstof x JOIN grondstof g ON g.id = x.grondstof_id
                        WHERE x.processtap_id = v_reg.processtap_id AND x.grondstof_id = NEW.grondstof_id AND x.actief AND g.actief) THEN
            RAISE EXCEPTION 'Deze grondstof hoort niet bij deze stap';
        END IF;
    ELSE
        SELECT * INTO v_oud FROM grondstof_gebruik WHERE id = NEW.vervangt_id;
        IF v_oud.stapregistratie_id <> NEW.stapregistratie_id OR v_oud.grondstof_id <> NEW.grondstof_id THEN
            RAISE EXCEPTION 'Een correctie hoort bij dezelfde registratie en grondstof';
        END IF;
        IF EXISTS (SELECT 1 FROM grondstof_gebruik WHERE vervangt_id = v_oud.id) THEN
            RAISE EXCEPTION 'Deze regel is al gecorrigeerd';
        END IF;
        IF NOT authorization_permits(NEW.gecorrigeerd_door,'execution.correct',NULL,v_reg.product_id,NULL)
           OR (v_reg.lot_id IS NOT NULL AND EXISTS (
               SELECT 1 FROM batch b WHERE b.lot_id=v_reg.lot_id
                 AND NOT authorization_permits(NEW.gecorrigeerd_door,'execution.correct',NULL,b.product_id,NULL))) THEN
            RAISE EXCEPTION 'Geen actuele MES-correctiebevoegdheid' USING ERRCODE='42501';
        END IF;
    END IF;
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION los_invoerconflict_op(p_conflict uuid, p_keuze text, p_door uuid, p_reden text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,public,pg_temp AS $$
DECLARE
    v_c     invoerconflict%ROWTYPE;
    v_reg stapregistratie%ROWTYPE;
    v_permission text;
    v_kw    boolean := false;
    v_naam  text;
    v_door  text;
    v_reden text;
BEGIN
    IF p_keuze NOT IN ('bestaand', 'nieuw') THEN
        RAISE EXCEPTION 'Kies bestaand of nieuw';
    END IF;
    SELECT * INTO v_c FROM invoerconflict WHERE id = p_conflict FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Dit conflict bestaat niet'; END IF;
    IF v_c.status = p_keuze THEN RETURN; END IF;   -- opnieuw verstuurd
    IF v_c.status <> 'open' THEN
        SELECT gebruikersnaam INTO v_door FROM gebruiker WHERE id = v_c.opgelost_door;
        RAISE EXCEPTION 'Dit conflict is al opgelost door %', v_door;
    END IF;
    IF v_c.veld_id IS NOT NULL THEN
        v_kw := (SELECT gemeten_door = 'kwaliteit' FROM veld WHERE id = v_c.veld_id);
    END IF;
    SELECT * INTO STRICT v_reg FROM stapregistratie WHERE id=v_c.stapregistratie_id;
    v_permission:=CASE WHEN v_kw THEN 'inspection.decide' ELSE 'execution.correct' END;
    IF NOT authorization_permits(p_door,v_permission,NULL,v_reg.product_id,NULL)
           OR (v_reg.lot_id IS NOT NULL AND EXISTS (
               SELECT 1 FROM batch b WHERE b.lot_id=v_reg.lot_id
                 AND NOT authorization_permits(p_door,v_permission,NULL,b.product_id,NULL))) THEN
        RAISE EXCEPTION 'Geen actuele MES-conflictbeslisbevoegdheid' USING ERRCODE='42501';
    END IF;
    IF p_keuze = 'nieuw' THEN
        SELECT naam INTO v_naam FROM operator WHERE id = v_c.ingevoerd_door;
        v_reden := 'Twee keer ingevuld, gekozen voor de invoer van ' || v_naam
                   || coalesce(': ' || nullif(btrim(p_reden), ''), '');
        IF v_c.veld_id IS NOT NULL THEN
            PERFORM set_config('fabriek.conflict', 'aan', true);
            INSERT INTO waarde (stapregistratie_id, veld_id, setting, gemeten, vervangt_waarde_id, correctie_reden, gecorrigeerd_door)
            SELECT v_c.stapregistratie_id, v_c.veld_id, v_c.setting, v_c.gemeten, w.id, v_reden, p_door
              FROM waarde_actueel w WHERE w.stapregistratie_id = v_c.stapregistratie_id AND w.veld_id = v_c.veld_id;
            PERFORM set_config('fabriek.conflict', 'uit', true);
        ELSE
            INSERT INTO grondstof_gebruik (stapregistratie_id, grondstof_id, partij, hoeveelheid, vervangt_id, correctie_reden, gecorrigeerd_door)
            SELECT v_c.stapregistratie_id, v_c.grondstof_id, v_c.partij, v_c.hoeveelheid, u.id, v_reden, p_door
              FROM grondstof_gebruik_actueel u WHERE u.stapregistratie_id = v_c.stapregistratie_id AND u.grondstof_id = v_c.grondstof_id;
        END IF;
    END IF;
    UPDATE invoerconflict SET status = p_keuze, opgelost_door = p_door, opgelost_op = now(),
                              reden = left(nullif(btrim(p_reden), ''), 500)
     WHERE id = p_conflict;
END $$;

REVOKE EXECUTE ON FUNCTION verwerk_waarde(),verwerk_grondstof_gebruik(),los_invoerconflict_op(uuid,text,uuid,text) FROM PUBLIC;
