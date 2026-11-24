-- Migratie 0070: persoonlijk gebonden conflictregistratie en gecontroleerd besluit.
SET search_path = fabriek, public;

CREATE FUNCTION execution_conflict_insert_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_actor uuid; v_reg stapregistratie%ROWTYPE; v_permission text;
BEGIN
 IF NOT pg_has_role(current_user,'mes_app','MEMBER') THEN RETURN NEW; END IF;
 v_actor:=execution_transaction_actor();
 IF NEW.status<>'open' OR NEW.opgelost_door IS NOT NULL OR NEW.opgelost_op IS NOT NULL OR NEW.reden IS NOT NULL
 OR NOT EXISTS (SELECT 1 FROM operator WHERE id=NEW.ingevoerd_door AND gebruiker_id=v_actor AND actief) THEN
   RAISE EXCEPTION 'Ongeldige persoonlijke conflictinvoer' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_reg FROM stapregistratie WHERE id=NEW.stapregistratie_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende stapregistratie'; END IF;
 IF NEW.veld_id IS NOT NULL THEN
   SELECT CASE WHEN gemeten_door='kwaliteit' THEN 'inspection.record' ELSE 'execution.record' END INTO v_permission
     FROM veld WHERE id=NEW.veld_id AND processtap_id=v_reg.processtap_id;
   IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM waarde WHERE id=NEW.bestaand_waarde_id AND stapregistratie_id=v_reg.id AND veld_id=NEW.veld_id) THEN
     RAISE EXCEPTION 'Conflict verwijst niet naar oorspronkelijke meetinvoer';
   END IF;
 ELSE
   v_permission:='execution.record';
   IF NOT EXISTS (SELECT 1 FROM grondstof_gebruik WHERE id=NEW.bestaand_gebruik_id AND stapregistratie_id=v_reg.id AND grondstof_id=NEW.grondstof_id) THEN
     RAISE EXCEPTION 'Conflict verwijst niet naar oorspronkelijk grondstofverbruik';
   END IF;
 END IF;
 IF NOT authorization_permits(v_actor,v_permission,NULL,v_reg.product_id,NULL)
 OR (v_reg.lot_id IS NOT NULL AND EXISTS (SELECT 1 FROM batch b WHERE b.lot_id=v_reg.lot_id
      AND NOT authorization_permits(v_actor,v_permission,NULL,b.product_id,NULL))) THEN
    RAISE EXCEPTION 'Geen actuele conflictinvoerbevoegdheid' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER invoerconflict_00_identity BEFORE INSERT ON invoerconflict
 FOR EACH ROW EXECUTE FUNCTION execution_conflict_insert_guard();

-- Een gecontroleerd besluit is geen vrijgave. Bewaar de oorspronkelijke
-- conflictgegevens en pas nooit een inmiddels vervangen waarde stilzwijgend aan.
CREATE FUNCTION execution_resolve_conflict(p_conflict uuid,p_choice text,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_actor uuid; v_c invoerconflict%ROWTYPE; v_reg stapregistratie%ROWTYPE; v_permission text;
BEGIN
 v_actor:=execution_transaction_actor();
 IF p_choice IS NULL OR p_choice NOT IN ('bestaand','nieuw') OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Keuze en motivatie vereist';
 END IF;
 SELECT * INTO v_c FROM invoerconflict WHERE id=p_conflict FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekend conflict'; END IF;
 SELECT * INTO v_reg FROM stapregistratie WHERE id=v_c.stapregistratie_id FOR UPDATE;
 v_permission:=CASE WHEN EXISTS (SELECT 1 FROM veld WHERE id=v_c.veld_id AND gemeten_door='kwaliteit')
                    THEN 'inspection.decide' ELSE 'execution.correct' END;
 IF NOT authorization_permits(v_actor,v_permission,NULL,v_reg.product_id,NULL)
 OR (v_reg.lot_id IS NOT NULL AND EXISTS (SELECT 1 FROM batch b WHERE b.lot_id=v_reg.lot_id
      AND NOT authorization_permits(v_actor,v_permission,NULL,b.product_id,NULL))) THEN
    RAISE EXCEPTION 'Geen actuele conflictbeslisbevoegdheid' USING ERRCODE='42501';
 END IF;
 IF v_c.status<>'open' THEN
    IF v_c.status=p_choice AND v_c.opgelost_door=v_actor AND v_c.reden=btrim(p_reason) THEN RETURN; END IF;
    RAISE EXCEPTION 'Conflict is al opgelost';
 END IF;
 IF v_c.veld_id IS NOT NULL THEN
   PERFORM 1 FROM waarde WHERE id=v_c.bestaand_waarde_id FOR UPDATE;
   IF NOT EXISTS (SELECT 1 FROM waarde_actueel WHERE id=v_c.bestaand_waarde_id) THEN
     RAISE EXCEPTION 'Oorspronkelijke waarde is intussen gewijzigd; herbeoordeling vereist';
   END IF;
 ELSE
   PERFORM 1 FROM grondstof_gebruik WHERE id=v_c.bestaand_gebruik_id FOR UPDATE;
   IF NOT EXISTS (SELECT 1 FROM grondstof_gebruik_actueel WHERE id=v_c.bestaand_gebruik_id) THEN
     RAISE EXCEPTION 'Oorspronkelijke grondstofregel is intussen gewijzigd; herbeoordeling vereist';
   END IF;
 END IF;
 PERFORM los_invoerconflict_op(p_conflict,p_choice,v_actor,btrim(p_reason));
END $$;
REVOKE ALL ON FUNCTION execution_conflict_insert_guard(),execution_resolve_conflict(uuid,text,text),los_invoerconflict_op(uuid,text,uuid,text) FROM PUBLIC;
