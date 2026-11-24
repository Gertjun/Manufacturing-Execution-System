-- Migratie 0074: gecontroleerde processtart en afronding.
SET search_path = fabriek, public;

CREATE FUNCTION execution_step_permission(p_actor uuid,p_batch uuid,p_lot uuid,p_permission text,p_completion boolean)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_batch batch%ROWTYPE; v_status text; v_count int:=0;
BEGIN
 IF (p_batch IS NULL)=(p_lot IS NULL) THEN RAISE EXCEPTION 'Kies batch of lot'; END IF;
 IF p_batch IS NOT NULL THEN
   SELECT * INTO v_batch FROM batch WHERE id=p_batch FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende batch'; END IF;
   IF v_batch.status NOT IN ('gepland','in_productie') OR (p_completion AND v_batch.status<>'in_productie') THEN
     RAISE EXCEPTION 'Batchstatus blokkeert proceshandeling';
   END IF;
   IF NOT authorization_permits(p_actor,p_permission,NULL,v_batch.product_id,NULL) THEN
     RAISE EXCEPTION 'Geen actuele procesbevoegdheid' USING ERRCODE='42501';
   END IF;
 ELSE
   SELECT status INTO v_status FROM lot WHERE id=p_lot FOR UPDATE;
   IF NOT FOUND OR v_status='geblokkeerd' OR (p_completion AND v_status<>'in_productie') THEN
     RAISE EXCEPTION 'Lotstatus blokkeert proceshandeling';
   END IF;
   FOR v_batch IN SELECT * FROM batch WHERE lot_id=p_lot ORDER BY id FOR SHARE LOOP
     v_count:=v_count+1;
     IF v_batch.status<>'in_lot' OR NOT authorization_permits(p_actor,p_permission,NULL,v_batch.product_id,NULL) THEN
       RAISE EXCEPTION 'Batchlid blokkeert proceshandeling of scope' USING ERRCODE='42501';
     END IF;
   END LOOP;
   IF v_count=0 THEN RAISE EXCEPTION 'Lot zonder batchleden'; END IF;
 END IF;
END $$;

CREATE FUNCTION execution_step_start(p_code text,p_batch uuid,p_lot uuid,p_pc uuid,p_operator uuid,p_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_actor uuid; v_stap processtap%ROWTYPE;
BEGIN
 v_actor:=execution_transaction_actor();
 IF NOT EXISTS (SELECT 1 FROM operator WHERE id=p_operator AND gebruiker_id=v_actor AND actief)
 OR NOT EXISTS (SELECT 1 FROM pc WHERE id=p_pc AND actief) THEN
   RAISE EXCEPTION 'Persoonlijke operator en actief werkstation vereist' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_stap FROM processtap WHERE code=p_code AND actief;
 IF NOT FOUND OR v_stap.is_lot_stap THEN RAISE EXCEPTION 'Onbekende stap of afzonderlijke lotsamenstelling vereist'; END IF;
 PERFORM execution_step_permission(v_actor,p_batch,p_lot,
    CASE WHEN v_stap.soort='keuring' THEN 'inspection.start' ELSE 'execution.start' END,false);
 RETURN start_stap(p_code,p_batch,p_lot,p_pc,p_operator,p_id);
END $$;

CREATE FUNCTION execution_step_complete(p_registration uuid,p_operator uuid,p_pc uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_actor uuid; v_reg stapregistratie%ROWTYPE;
BEGIN
 v_actor:=execution_transaction_actor();
 IF NOT EXISTS (SELECT 1 FROM operator WHERE id=p_operator AND gebruiker_id=v_actor AND actief)
 OR NOT EXISTS (SELECT 1 FROM pc WHERE id=p_pc AND actief) THEN
   RAISE EXCEPTION 'Persoonlijke operator en actief werkstation vereist' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_reg FROM stapregistratie WHERE id=p_registration FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende registratie'; END IF;
 PERFORM execution_step_permission(v_actor,v_reg.batch_id,v_reg.lot_id,'execution.complete',true);
 IF EXISTS (SELECT 1 FROM invoerconflict WHERE stapregistratie_id=p_registration AND status='open') THEN
   RAISE EXCEPTION 'Open invoerconflict blokkeert afronding';
 END IF;
 PERFORM rond_stap_af(p_registration,p_operator,p_pc);
END $$;

CREATE FUNCTION execution_step_rework(p_lot uuid,p_code text,p_reason text,p_pc uuid,p_operator uuid,p_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_actor uuid;
BEGIN
 v_actor:=execution_transaction_actor();
 IF NOT EXISTS (SELECT 1 FROM operator WHERE id=p_operator AND gebruiker_id=v_actor AND actief)
 OR NOT EXISTS (SELECT 1 FROM pc WHERE id=p_pc AND actief) THEN
   RAISE EXCEPTION 'Persoonlijke operator en actief werkstation vereist' USING ERRCODE='42501';
 END IF;
 PERFORM execution_step_permission(v_actor,NULL,p_lot,'execution.rework',false);
 RETURN start_herbewerking(p_lot,p_code,p_reason,p_pc,p_operator,p_id);
END $$;

REVOKE ALL ON FUNCTION execution_step_permission(uuid,uuid,uuid,text,boolean),
 execution_step_start(text,uuid,uuid,uuid,uuid,uuid),execution_step_complete(uuid,uuid,uuid),
 execution_step_rework(uuid,text,text,uuid,uuid,uuid),start_stap(text,uuid,uuid,uuid,uuid,uuid),
 rond_stap_af(uuid,uuid,uuid),start_herbewerking(uuid,text,text,uuid,uuid,uuid) FROM PUBLIC;
