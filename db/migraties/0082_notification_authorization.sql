-- D101: meldingen uit bestaande bedrijfsgebeurtenissen, geen oude accountrol.
SET search_path = fabriek, public;

-- Tijdelijke globale routering: historische ontvangerscategorieën zijn
-- berichtmetadata, nooit de rol van het ingelogde account. Hal is geen area.
CREATE FUNCTION notification_recipient(p_user uuid,p_roles text[])
RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,fabriek,pg_temp AS $$
 SELECT authorization_permits(p_user,'analysis.execution.read',NULL,NULL,NULL)
 OR ('ploegleider'=ANY(p_roles) AND authorization_permits(p_user,'execution.correct',NULL,NULL,NULL))
 OR ('kwaliteit'=ANY(p_roles) AND authorization_permits(p_user,'inspection.decide',NULL,NULL,NULL))
 OR ('planner'=ANY(p_roles) AND authorization_permits(p_user,'planning.manage',NULL,NULL,NULL))
 OR ('productiemanager'=ANY(p_roles) AND authorization_permits(p_user,'operations.rework.order',NULL,NULL,NULL))
$$;

CREATE FUNCTION notification_read_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid;
BEGIN
 IF current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID)) THEN RETURN NEW; END IF;
 actor:=execution_transaction_actor();
 IF NEW.gebruiker_id IS DISTINCT FROM actor OR NOT EXISTS (
    SELECT 1 FROM melding m WHERE m.id=NEW.melding_id
      AND m.aangemaakt_op>now()-interval '30 days' AND notification_recipient(actor,m.voor_rollen)
 ) THEN RAISE EXCEPTION 'Geen persoonlijke MES-meldingsbevoegdheid' USING ERRCODE='42501'; END IF;
 NEW.gelezen_op:=clock_timestamp();
 RETURN NEW;
END $$;
CREATE TRIGGER melding_gelezen_identity BEFORE INSERT ON melding_gelezen
 FOR EACH ROW EXECUTE FUNCTION notification_read_guard();

-- Alleen de vaste bestaande event-triggers mogen systeemmeldingen schrijven.
ALTER FUNCTION meld_waarde() SECURITY DEFINER;
ALTER FUNCTION meld_besluit() SECURITY DEFINER;
ALTER FUNCTION meld_lotvoorstel() SECURITY DEFINER;
ALTER FUNCTION meld_stilstand() SECURITY DEFINER;
ALTER FUNCTION meld_herbewerking() SECURITY DEFINER;
ALTER FUNCTION meld_keuring() SECURITY DEFINER;
ALTER FUNCTION meld_invoerconflict() SECURITY DEFINER;
ALTER FUNCTION meld_waarde() SET search_path=pg_catalog,fabriek,pg_temp;
ALTER FUNCTION meld_besluit() SET search_path=pg_catalog,fabriek,pg_temp;
ALTER FUNCTION meld_lotvoorstel() SET search_path=pg_catalog,fabriek,pg_temp;
ALTER FUNCTION meld_stilstand() SET search_path=pg_catalog,fabriek,pg_temp;
ALTER FUNCTION meld_herbewerking() SET search_path=pg_catalog,fabriek,pg_temp;
ALTER FUNCTION meld_keuring() SET search_path=pg_catalog,fabriek,pg_temp;
ALTER FUNCTION meld_invoerconflict() SET search_path=pg_catalog,fabriek,pg_temp;
REVOKE ALL ON FUNCTION notification_recipient(uuid,text[]),notification_read_guard(),
 meld_waarde(),meld_besluit(),meld_lotvoorstel(),meld_stilstand(),meld_herbewerking(),meld_keuring(),meld_invoerconflict() FROM PUBLIC;
