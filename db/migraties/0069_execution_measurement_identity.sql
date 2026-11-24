-- Migratie 0069: identiteitsbinding bij metingen en grondstofverbruik.
SET search_path = fabriek, public;

CREATE FUNCTION execution_measurement_identity_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_actor uuid; v_reg stapregistratie%ROWTYPE; v_permission text; v_quality boolean; v_correction boolean;
BEGIN
    IF NOT pg_has_role(current_user,'mes_app','MEMBER') THEN RETURN NEW; END IF;
    v_actor:=execution_transaction_actor();
    SELECT * INTO v_reg FROM stapregistratie WHERE id=NEW.stapregistratie_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende stapregistratie'; END IF;
    IF TG_TABLE_NAME='waarde' THEN
        SELECT gemeten_door='kwaliteit' INTO v_quality FROM veld WHERE id=NEW.veld_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'Onbekend meetveld'; END IF;
        v_correction:=NEW.vervangt_waarde_id IS NOT NULL;
    ELSE
        v_quality:=false;
        v_correction:=NEW.vervangt_id IS NOT NULL;
    END IF;
    IF v_correction THEN
        IF NEW.gecorrigeerd_door IS DISTINCT FROM v_actor THEN
            RAISE EXCEPTION 'Correctie komt niet overeen met bewezen identiteit' USING ERRCODE='42501';
        END IF;
        -- Kwaliteitsconflicten krijgen een afzonderlijk gecontroleerd pad;
        -- geen impliciet correctierecht op kwaliteitsmetingen.
        IF v_quality THEN
            RAISE EXCEPTION 'Kwaliteitscorrectie vereist gecontroleerde conflictafhandeling' USING ERRCODE='42501';
        END IF;
        v_permission:='execution.correct';
    ELSE
        IF NOT EXISTS (SELECT 1 FROM operator o WHERE o.id=NEW.ingevoerd_door AND o.gebruiker_id=v_actor AND o.actief) THEN
            RAISE EXCEPTION 'Invoerder komt niet overeen met bewezen identiteit' USING ERRCODE='42501';
        END IF;
        v_permission:=CASE WHEN v_quality THEN 'inspection.record' ELSE 'execution.record' END;
    END IF;
    IF NOT authorization_permits(v_actor,v_permission,NULL,v_reg.product_id,NULL)
       OR (v_reg.lot_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM batch b WHERE b.lot_id=v_reg.lot_id
           AND NOT authorization_permits(v_actor,v_permission,NULL,b.product_id,NULL))) THEN
        RAISE EXCEPTION 'Geen actuele meet- of correctiebevoegdheid' USING ERRCODE='42501';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER waarde_00_identity BEFORE INSERT ON waarde
 FOR EACH ROW EXECUTE FUNCTION execution_measurement_identity_guard();
CREATE TRIGGER grondstof_gebruik_00_identity BEFORE INSERT ON grondstof_gebruik
 FOR EACH ROW EXECUTE FUNCTION execution_measurement_identity_guard();
REVOKE ALL ON FUNCTION execution_measurement_identity_guard() FROM PUBLIC;
