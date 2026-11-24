-- Migratie 0072: begrens rechtstreekse statuswijzigingen.
SET search_path = fabriek, public;

-- Alleen gecontroleerde triggers/functies mogen de productie- of
-- kwaliteitsstatus veranderen. Planning krijgt een afzonderlijke overgang.
CREATE FUNCTION execution_object_status_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
 IF current_user = pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID)) OR NOT pg_has_role(current_user,'mes_app','MEMBER') THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='batch' THEN
   IF (NEW.status,NEW.lot_id,NEW.gestart_op,NEW.vervallen_reden)
      IS DISTINCT FROM (OLD.status,OLD.lot_id,OLD.gestart_op,OLD.vervallen_reden) THEN
      RAISE EXCEPTION 'Batchstatus uitsluitend via gecontroleerde overgang' USING ERRCODE='42501';
   END IF;
 ELSE
   IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Lotstatus uitsluitend via gecontroleerde overgang' USING ERRCODE='42501';
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER batch_00_status_guard BEFORE UPDATE ON batch
 FOR EACH ROW EXECUTE FUNCTION execution_object_status_guard();
CREATE TRIGGER lot_00_status_guard BEFORE UPDATE ON lot
 FOR EACH ROW EXECUTE FUNCTION execution_object_status_guard();

-- Deze triggers worden uitsluitend geactiveerd door registratie of besluit.
-- De bijbehorende registratieguard moet vóór de statusovergang uitvoeren.
ALTER FUNCTION start_geplande_batch() SECURITY DEFINER;
ALTER FUNCTION start_geplande_batch() SET search_path=pg_catalog,fabriek,pg_temp;
ALTER FUNCTION werk_lotstatus_bij() SECURITY DEFINER;
ALTER FUNCTION werk_lotstatus_bij() SET search_path=pg_catalog,fabriek,pg_temp;

CREATE FUNCTION execution_batch_hold(p_batch uuid,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_actor uuid; v_batch batch%ROWTYPE;
BEGIN
 v_actor:=execution_transaction_actor();
 SELECT * INTO v_batch FROM batch WHERE id=p_batch FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende batch'; END IF;
 IF length(btrim(coalesce(p_reason,'')))=0 THEN RAISE EXCEPTION 'Motivatie vereist'; END IF;
 IF NOT (authorization_permits(v_actor,'execution.hold',NULL,v_batch.product_id,NULL)
         OR authorization_permits(v_actor,'inspection.hold',NULL,v_batch.product_id,NULL)) THEN
    RAISE EXCEPTION 'Geen actuele blokkadebevoegdheid' USING ERRCODE='42501';
 END IF;
 INSERT INTO batch_besluit(batch_id,besluit,reden,besloten_door)
 VALUES(p_batch,'in_beoordeling',btrim(p_reason),v_actor);
END $$;

CREATE FUNCTION execution_cancel_planned_batch(p_number text,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_actor uuid; v_batch batch%ROWTYPE;
BEGIN
 v_actor:=execution_transaction_actor();
 SELECT * INTO v_batch FROM batch WHERE batchnummer=p_number FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF NOT authorization_permits(v_actor,'planning.manage',NULL,v_batch.product_id,NULL) THEN
   RAISE EXCEPTION 'Geen actuele planningsbevoegdheid' USING ERRCODE='42501';
 END IF;
 IF v_batch.status<>'gepland' OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 500 THEN
   RAISE EXCEPTION 'Alleen geplande batch met motivatie kan vervallen';
 END IF;
 UPDATE batch SET status='vervallen',vervallen_reden=btrim(p_reason) WHERE id=v_batch.id;
 RETURN v_batch.id;
END $$;

-- Lotsamenstelling via bestaande bedrijfsregels, maar alleen met een bewezen
-- persoonlijke actor en actuele bevoegdheid voor alle opgegeven batchleden.
CREATE FUNCTION execution_create_lot(p_number text,p_batches uuid[],p_pc uuid,p_operator uuid,
 p_lot_id uuid,p_registration_id uuid,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_actor uuid; v_batch batch%ROWTYPE; v_count int:=0;
BEGIN
 v_actor:=execution_transaction_actor();
 IF NOT EXISTS (SELECT 1 FROM operator WHERE id=p_operator AND gebruiker_id=v_actor AND actief)
 OR NOT EXISTS (SELECT 1 FROM pc WHERE id=p_pc AND actief) THEN
   RAISE EXCEPTION 'Persoonlijke operator en actief werkstation vereist' USING ERRCODE='42501';
 END IF;
 FOR v_batch IN SELECT * FROM batch WHERE id=ANY(p_batches) ORDER BY id FOR UPDATE LOOP
   v_count:=v_count+1;
   IF NOT authorization_permits(v_actor,'execution.lot.create',NULL,v_batch.product_id,NULL) THEN
     RAISE EXCEPTION 'Geen actuele lotsamenstellingsbevoegdheid' USING ERRCODE='42501';
   END IF;
 END LOOP;
 IF v_count=0 OR v_count<>cardinality(p_batches) THEN RAISE EXCEPTION 'Ongeldige batchleden'; END IF;
 RETURN maak_lot(p_number,p_batches,p_pc,p_operator,p_lot_id,p_registration_id,p_reason);
END $$;
REVOKE ALL ON FUNCTION execution_object_status_guard(),start_geplande_batch(),werk_lotstatus_bij(),
 execution_batch_hold(uuid,text),execution_cancel_planned_batch(text,text),execution_create_lot(text,uuid[],uuid,uuid,uuid,uuid,text),
 maak_lot(text,uuid[],uuid,uuid,uuid,uuid,text) FROM PUBLIC;
