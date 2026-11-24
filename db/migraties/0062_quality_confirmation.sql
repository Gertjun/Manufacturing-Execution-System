-- Migratie 0062: persoonlijke bevestiging van tijdelijke legacy-kwaliteitsbesluiten.
SET search_path = fabriek, public;

-- De oude uitvoeringsfuncties blijven uitsluitend voor de eigenaar en de
-- bevestigde ingang beschikbaar. Een reguliere keuring is geen MES Quality Release.
CREATE FUNCTION quality_decision_confirmed(p_actor uuid,p_session bigint,p_kind text,
 p_target uuid,p_decision text,p_reason text,p_step text,p_password text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,fabriek,public,pg_temp AS $$
DECLARE v_name text; v_login record; v_product uuid; v_lot uuid;
BEGIN
 SELECT gebruikersnaam INTO v_name FROM gebruiker
 WHERE id=p_actor AND session_version=p_session AND actief AND NOT gedeeld AND NOT wachtwoord_wijzigen FOR UPDATE;
 IF NOT FOUND THEN RETURN 'denied'; END IF;
 IF p_decision IS NULL OR p_decision NOT IN ('vrijgegeven','afgekeurd') THEN
   RAISE EXCEPTION 'Alleen vrijgave of afkeuring; herbewerking vereist een afzonderlijke opdracht';
 END IF;
 IF p_kind='inspection' THEN
   SELECT r.product_id,r.lot_id INTO v_product,v_lot FROM keuring k
   JOIN stapregistratie r ON r.id=k.stapregistratie_id WHERE k.id=p_target FOR UPDATE OF k,r;
   IF NOT FOUND THEN RAISE EXCEPTION 'Keuring bestaat niet'; END IF;
   IF NOT authorization_permits(p_actor,'inspection.decide',NULL,v_product,NULL)
     OR (v_lot IS NOT NULL AND EXISTS (SELECT 1 FROM batch b WHERE b.lot_id=v_lot
         AND NOT authorization_permits(p_actor,'inspection.decide',NULL,b.product_id,NULL))) THEN
     RETURN 'denied';
   END IF;
 ELSIF p_kind='batch' THEN
   SELECT product_id INTO v_product FROM batch WHERE id=p_target FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Batch bestaat niet'; END IF;
   IF NOT authorization_permits(p_actor,'inspection.batch.decide',NULL,v_product,NULL) THEN RETURN 'denied'; END IF;
 ELSE RAISE EXCEPTION 'Onbekend besluitobject';
 END IF;
 SELECT * INTO v_login FROM inloggen(v_name,p_password,NULL);
 IF v_login.wacht_seconden IS NOT NULL THEN RETURN 'locked'; END IF;
 IF v_login.id IS DISTINCT FROM p_actor THEN RETURN 'denied'; END IF;
 IF p_kind='inspection' THEN
   IF EXISTS (SELECT 1 FROM keuring WHERE id=p_target AND status<>'open') THEN
     RAISE EXCEPTION 'Over deze stap is al beslist';
   END IF;
   PERFORM beslis_keuring(p_target,p_decision,p_reason,p_actor,NULL);
 ELSE
   INSERT INTO batch_besluit(batch_id,besluit,reden,besloten_door)
   VALUES(p_target,p_decision,p_reason,p_actor);
 END IF;
 RETURN 'decided';
END $$;
REVOKE ALL ON FUNCTION quality_decision_confirmed(uuid,bigint,text,uuid,text,text,text,text) FROM PUBLIC;

-- Bescherm besluiten ook wanneer een oude route rechtstreeks een tabel benadert.
CREATE FUNCTION quality_legacy_decision_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog,fabriek,pg_temp AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('mes_app','batchgui_app')
            AND pg_has_role(current_user,oid,'MEMBER')) THEN
   IF TG_TABLE_NAME='batch_besluit' THEN
     IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Besluitregistratie is onveranderlijk'; END IF;
     IF NEW.besluit <> 'in_beoordeling' THEN RAISE EXCEPTION 'Persoonlijke kwaliteitsbevestiging vereist'; END IF;
   ELSE
     IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Persoonlijke kwaliteitsbevestiging vereist'; END IF;
     IF NEW.status <> 'open' OR NEW.besloten_door IS NOT NULL OR NEW.besloten_op IS NOT NULL THEN
       RAISE EXCEPTION 'Persoonlijke kwaliteitsbevestiging vereist';
     END IF;
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER quality_guard_batch BEFORE INSERT OR UPDATE ON batch_besluit
 FOR EACH ROW EXECUTE FUNCTION quality_legacy_decision_guard();
CREATE TRIGGER quality_guard_inspection BEFORE INSERT OR UPDATE ON keuring
 FOR EACH ROW EXECUTE FUNCTION quality_legacy_decision_guard();
REVOKE ALL ON FUNCTION quality_legacy_decision_guard(),beslis_keuring(uuid,text,text,uuid,text) FROM PUBLIC;
