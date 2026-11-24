-- Migratie 0073: gecontroleerde tijdelijke batchcreatie (D98).
SET search_path = fabriek, public;

-- Tijdelijke PoC-route zonder productieopdracht of productspecificatie.
-- Geen extra planningsfunctionaliteit; vervalt bij de Job Order-integratie.
CREATE FUNCTION execution_create_legacy_batch(p_id uuid,p_number text,p_operator uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_actor uuid; v_id uuid; v_existing batch%ROWTYPE;
BEGIN
 v_actor:=execution_transaction_actor();
 IF NOT authorization_permits(v_actor,'execution.batch.create',NULL,NULL,NULL)
 OR NOT EXISTS (SELECT 1 FROM operator WHERE id=p_operator AND gebruiker_id=v_actor AND actief) THEN
   RAISE EXCEPTION 'Geen bevoegdheid voor tijdelijke batchcreatie' USING ERRCODE='42501';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtext('fabriek.batchnummer'));
 IF p_id IS NOT NULL THEN
   SELECT * INTO v_existing FROM batch WHERE id=p_id FOR UPDATE;
   IF FOUND THEN
     IF v_existing.batchnummer IS DISTINCT FROM p_number OR v_existing.bron<>'operator'
        OR v_existing.aangemaakt_door IS DISTINCT FROM p_operator THEN
        RAISE EXCEPTION 'Dit id hoort bij een andere batch';
     END IF;
     RETURN v_existing.id;
   END IF;
 END IF;
 INSERT INTO batch(id,batchnummer,bron,aangemaakt_door)
 VALUES(coalesce(p_id,gen_random_uuid()),p_number,'operator',p_operator) RETURNING id INTO v_id;
 RETURN v_id;
END $$;

CREATE FUNCTION execution_plan_legacy_batches(p_count int,p_day date,p_product uuid,p_note text)
RETURNS SETOF text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_actor uuid;
BEGIN
 v_actor:=execution_transaction_actor();
 IF NOT authorization_permits(v_actor,'planning.manage',NULL,p_product,NULL) THEN
   RAISE EXCEPTION 'Geen actuele planningsbevoegdheid' USING ERRCODE='42501';
 END IF;
 RETURN QUERY SELECT * FROM plan_batches(p_count,p_day,p_product,p_note,v_actor);
END $$;

-- Beperk directe wijziging van de herkomst en van planningscontext.
CREATE FUNCTION execution_batch_metadata_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_actor uuid;
BEGIN
 IF NOT pg_has_role(current_user,'mes_app','MEMBER') THEN RETURN NEW; END IF;
 IF (NEW.id,NEW.batchnummer,NEW.bron,NEW.aangemaakt_op,NEW.aangemaakt_door,NEW.gepland_door)
 IS DISTINCT FROM (OLD.id,OLD.batchnummer,OLD.bron,OLD.aangemaakt_op,OLD.aangemaakt_door,OLD.gepland_door) THEN
   RAISE EXCEPTION 'Oorspronkelijke batchherkomst mag niet wijzigen' USING ERRCODE='42501';
 END IF;
 IF (NEW.geplande_dag,NEW.volgorde,NEW.product_id,NEW.opmerking)
 IS DISTINCT FROM (OLD.geplande_dag,OLD.volgorde,OLD.product_id,OLD.opmerking) THEN
   v_actor:=execution_transaction_actor();
   IF NOT authorization_permits(v_actor,'planning.manage',NULL,OLD.product_id,NULL)
      OR NOT authorization_permits(v_actor,'planning.manage',NULL,NEW.product_id,NULL) THEN
     RAISE EXCEPTION 'Geen actuele planningsbevoegdheid' USING ERRCODE='42501';
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER batch_01_metadata BEFORE UPDATE ON batch
 FOR EACH ROW EXECUTE FUNCTION execution_batch_metadata_guard();

REVOKE ALL ON FUNCTION execution_create_legacy_batch(uuid,text,uuid),execution_plan_legacy_batches(int,date,uuid,text),
 execution_batch_metadata_guard(),plan_batches(int,date,uuid,text,uuid) FROM PUBLIC;
