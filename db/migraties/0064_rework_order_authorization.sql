-- Migratie 0064: bevestigde tijdelijke herbewerkingsopdrachten.
SET search_path = fabriek, public;

CREATE FUNCTION rework_order_permission(p_actor uuid,p_batch uuid,p_lot uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog,fabriek,pg_temp AS $$
 SELECT CASE WHEN p_batch IS NOT NULL AND p_lot IS NULL THEN
   EXISTS (SELECT 1 FROM batch b WHERE b.id=p_batch AND
     (authorization_permits(p_actor,'inspection.rework.order',NULL,b.product_id,NULL)
      OR authorization_permits(p_actor,'operations.rework.order',NULL,b.product_id,NULL)))
 WHEN p_lot IS NOT NULL AND p_batch IS NULL THEN
   EXISTS (SELECT 1 FROM lot WHERE id=p_lot)
   AND (
     (authorization_permits(p_actor,'inspection.rework.order',NULL,lot_product(p_lot),NULL)
      AND NOT EXISTS (SELECT 1 FROM batch b WHERE b.lot_id=p_lot AND NOT authorization_permits(p_actor,'inspection.rework.order',NULL,b.product_id,NULL)))
     OR
     (authorization_permits(p_actor,'operations.rework.order',NULL,lot_product(p_lot),NULL)
      AND NOT EXISTS (SELECT 1 FROM batch b WHERE b.lot_id=p_lot AND NOT authorization_permits(p_actor,'operations.rework.order',NULL,b.product_id,NULL)))
   )
 ELSE false END
$$;

CREATE FUNCTION rework_order_confirmed(p_actor uuid,p_session bigint,p_number text,p_step text,p_reason text,p_id uuid,p_password text)
RETURNS TABLE(status text,order_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,fabriek,public,pg_temp AS $$
DECLARE v_name text; v_login record; v_batch uuid; v_lot uuid; v_id uuid;
BEGIN
 SELECT gebruikersnaam INTO v_name FROM gebruiker WHERE id=p_actor AND session_version=p_session
 AND actief AND NOT gedeeld AND NOT wachtwoord_wijzigen FOR UPDATE;
 IF NOT FOUND THEN RETURN QUERY SELECT 'denied'::text,NULL::uuid; RETURN; END IF;
 SELECT id INTO v_batch FROM batch WHERE batchnummer=p_number FOR UPDATE;
 IF NOT FOUND THEN SELECT id INTO v_lot FROM lot WHERE lotnummer=p_number FOR UPDATE; END IF;
 IF NOT rework_order_permission(p_actor,v_batch,v_lot) THEN RETURN QUERY SELECT 'denied'::text,NULL::uuid; RETURN; END IF;
 SELECT * INTO v_login FROM inloggen(v_name,p_password,NULL);
 IF v_login.wacht_seconden IS NOT NULL THEN RETURN QUERY SELECT 'locked'::text,NULL::uuid; RETURN; END IF;
 IF v_login.id IS DISTINCT FROM p_actor THEN RETURN QUERY SELECT 'denied'::text,NULL::uuid; RETURN; END IF;
 v_id:=maak_herbewerking(p_number,p_step,p_reason,p_actor,p_id);
 RETURN QUERY SELECT 'created'::text,v_id;
END $$;

CREATE FUNCTION rework_cancel_confirmed(p_actor uuid,p_session bigint,p_id uuid,p_reason text,p_password text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,fabriek,public,pg_temp AS $$
DECLARE v_name text; v_login record; v_order herbewerking%ROWTYPE;
BEGIN
 SELECT gebruikersnaam INTO v_name FROM gebruiker WHERE id=p_actor AND session_version=p_session
 AND actief AND NOT gedeeld AND NOT wachtwoord_wijzigen FOR UPDATE;
 IF NOT FOUND THEN RETURN 'denied'; END IF;
 SELECT * INTO v_order FROM herbewerking WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR NOT rework_order_permission(p_actor,v_order.batch_id,v_order.lot_id) THEN RETURN 'denied'; END IF;
 SELECT * INTO v_login FROM inloggen(v_name,p_password,NULL);
 IF v_login.wacht_seconden IS NOT NULL THEN RETURN 'locked'; END IF;
 IF v_login.id IS DISTINCT FROM p_actor THEN RETURN 'denied'; END IF;
 PERFORM trek_herbewerking_in(p_id,p_reason,p_actor);
 RETURN 'cancelled';
END $$;

-- De gecontroleerde koppeling vanuit een stapregistratie blijft functioneren
-- nadat directe schrijfrechten op opdrachten worden ingetrokken.
ALTER FUNCTION koppel_herbewerking() SECURITY DEFINER;
CREATE FUNCTION rework_history_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Herbewerkingshistorie blijft bewaard'; END IF;
 IF OLD.status<>'open' OR NEW.status NOT IN ('gestart','ingetrokken')
 OR (NEW.id,NEW.batch_id,NEW.lot_id,NEW.processtap_id,NEW.reden,NEW.aangemaakt_door,NEW.aangemaakt_op)
 IS DISTINCT FROM (OLD.id,OLD.batch_id,OLD.lot_id,OLD.processtap_id,OLD.reden,OLD.aangemaakt_door,OLD.aangemaakt_op) THEN
   RAISE EXCEPTION 'Herbewerkingsopdracht is onveranderlijk';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER rework_history_guard BEFORE UPDATE OR DELETE ON herbewerking
 FOR EACH ROW EXECUTE FUNCTION rework_history_guard();
REVOKE ALL ON FUNCTION maak_herbewerking(text,text,text,uuid,uuid),trek_herbewerking_in(uuid,text,uuid),
 koppel_herbewerking(),rework_history_guard(),rework_order_permission(uuid,uuid,uuid),
 rework_order_confirmed(uuid,bigint,text,text,text,uuid,text),rework_cancel_confirmed(uuid,bigint,uuid,text,text) FROM PUBLIC;
