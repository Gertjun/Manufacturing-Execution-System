-- Migratie 0084: persoonlijke operationele wijzigingen (D100/D101).
SET search_path = fabriek, public;

CREATE FUNCTION operations_write_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid;
BEGIN
 IF current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID)) THEN
   IF TG_OP='DELETE' THEN RETURN OLD; END IF;
   RETURN NEW;
 END IF;
 actor:=execution_transaction_actor();
 IF NOT authorization_permits(actor,TG_ARGV[0],NULL,NULL,NULL) THEN
   RAISE EXCEPTION 'Geen actuele MES-operationele bevoegdheid: %',TG_ARGV[0] USING ERRCODE='42501';
 END IF;
 IF TG_TABLE_NAME='stilstand' THEN
   IF TG_OP='INSERT' THEN
     IF NEW.gemeld_door IS DISTINCT FROM actor OR NEW.eind_op IS NOT NULL OR NEW.beeindigd_door IS NOT NULL OR NEW.eind_notitie IS NOT NULL
       OR (NEW.operator_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM operator WHERE id=NEW.operator_id AND gebruiker_id=actor AND actief)) THEN
       RAISE EXCEPTION 'Ongeldige persoonlijke stilstandmelding' USING ERRCODE='42501';
     END IF;
   ELSIF TG_OP='UPDATE' THEN
     IF NEW.id IS DISTINCT FROM OLD.id OR NEW.eind_op IS NULL
       OR (NEW.beeindigd_door IS NOT NULL AND NOT EXISTS (SELECT 1 FROM operator WHERE id=NEW.beeindigd_door AND gebruiker_id=actor AND actief)) THEN
       RAISE EXCEPTION 'Ongeldige persoonlijke stilstandbeëindiging' USING ERRCODE='42501';
     END IF;
   END IF;
 ELSIF TG_TABLE_NAME='overdracht' AND TG_OP='INSERT' THEN
   IF NEW.gebruiker_id IS DISTINCT FROM actor
     OR (NEW.operator_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM operator WHERE id=NEW.operator_id AND gebruiker_id=actor AND actief)) THEN
     RAISE EXCEPTION 'Ongeldige persoonlijke overdracht' USING ERRCODE='42501';
   END IF;
 ELSIF TG_TABLE_NAME='stapplanning' AND TG_OP='INSERT' THEN
   IF NEW.aangemaakt_door IS DISTINCT FROM actor THEN
     RAISE EXCEPTION 'Ongeldige persoonlijke stapplanning' USING ERRCODE='42501';
   END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION operations_write_guard() FROM PUBLIC;
CREATE TRIGGER stilstand_0_mes_permission BEFORE INSERT OR UPDATE ON stilstand
 FOR EACH ROW EXECUTE FUNCTION operations_write_guard('downtime.record');
CREATE TRIGGER overdracht_0_mes_permission BEFORE INSERT ON overdracht
 FOR EACH ROW EXECUTE FUNCTION operations_write_guard('handover.record');
CREATE TRIGGER stapplanning_0_mes_permission BEFORE INSERT OR DELETE ON stapplanning
 FOR EACH ROW EXECUTE FUNCTION operations_write_guard('planning.manage');

-- Alleen de bestaande gecontroleerde opslaanfuctie mag voorstelleden wijzigen.
-- Geen nieuw lotmodel: de bestaande PoC-regels blijven voorlopig gelden.
CREATE FUNCTION planning_save_legacy_proposal(p_id uuid,p_batches uuid[],p_note text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid;
BEGIN
 actor:=execution_transaction_actor();
 IF NOT authorization_permits(actor,'planning.manage',NULL,NULL,NULL) THEN
   RAISE EXCEPTION 'Geen actuele MES-planningsbevoegdheid' USING ERRCODE='42501';
 END IF;
 -- Serialiseer tijdelijke voorstelwijzigingen en vergrendel bestaande voorstellen.
 PERFORM pg_advisory_xact_lock(84001);
 IF p_id IS NOT NULL THEN
   PERFORM 1 FROM lot_voorstel WHERE id=p_id FOR UPDATE;
 END IF;
 RETURN bewaar_lot_voorstel(p_id,p_batches,p_note,actor);
END $$;

CREATE FUNCTION planning_cancel_legacy_proposal(p_number int)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; target uuid;
BEGIN
 actor:=execution_transaction_actor();
 IF NOT authorization_permits(actor,'planning.manage',NULL,NULL,NULL) THEN
   RAISE EXCEPTION 'Geen actuele MES-planningsbevoegdheid' USING ERRCODE='42501';
 END IF;
 PERFORM pg_advisory_xact_lock(84001);
 UPDATE lot_voorstel SET status='vervallen',afgesloten_op=now()
 WHERE nummer=p_number AND status='open' RETURNING id INTO target;
 IF target IS NOT NULL THEN DELETE FROM stapplanning WHERE voorstel_id=target; END IF;
 RETURN target;
END $$;
REVOKE ALL ON FUNCTION planning_save_legacy_proposal(uuid,uuid[],text),planning_cancel_legacy_proposal(int) FROM PUBLIC;
