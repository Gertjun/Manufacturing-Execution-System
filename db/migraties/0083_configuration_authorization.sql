-- Migratie 0083: configuratiewrites vereisen actuele persoonlijke MES-autorisatie (D100/D101).
SET search_path = fabriek, public;

-- Globale bevoegdheid conform de bestaande API-contracten. Geen scope
-- afleiden uit een clientwaarde. De eigenaar blijft voor gecontroleerd
-- onderhoud en bestaande SECURITY DEFINER-processen verantwoordelijk.
CREATE FUNCTION configuration_write_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_actor uuid;
BEGIN
 IF current_user <> pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID)) THEN
   v_actor:=execution_transaction_actor();
   IF NOT authorization_permits(v_actor,TG_ARGV[0],NULL,NULL,NULL) THEN
     RAISE EXCEPTION 'Geen actuele MES-configuratiebevoegdheid: %',TG_ARGV[0] USING ERRCODE='42501';
   END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION configuration_write_guard() FROM PUBLIC;

-- Na bestaande identiteitstriggers; vóór log_config en overige wijzigingen.
CREATE TRIGGER processtap_0_mes_permission BEFORE INSERT OR UPDATE OR DELETE ON processtap
 FOR EACH ROW EXECUTE FUNCTION configuration_write_guard('process.parameter.manage');
CREATE TRIGGER veld_0_mes_permission BEFORE INSERT OR UPDATE OR DELETE ON veld
 FOR EACH ROW EXECUTE FUNCTION configuration_write_guard('process.parameter.manage');
CREATE TRIGGER veld_product_0_mes_permission BEFORE INSERT OR UPDATE OR DELETE ON veld_product
 FOR EACH ROW EXECUTE FUNCTION configuration_write_guard('process.parameter.manage');
CREATE TRIGGER product_0_mes_permission BEFORE INSERT OR UPDATE OR DELETE ON product
 FOR EACH ROW EXECUTE FUNCTION configuration_write_guard('engineering.product.manage');
CREATE TRIGGER product_stap_0_mes_permission BEFORE INSERT OR UPDATE OR DELETE ON product_stap
 FOR EACH ROW EXECUTE FUNCTION configuration_write_guard('engineering.product.manage');
CREATE TRIGGER grondstof_0_mes_permission BEFORE INSERT OR UPDATE OR DELETE ON grondstof
 FOR EACH ROW EXECUTE FUNCTION configuration_write_guard('material.definition.manage');
CREATE TRIGGER stap_grondstof_0_mes_permission BEFORE INSERT OR UPDATE OR DELETE ON stap_grondstof
 FOR EACH ROW EXECUTE FUNCTION configuration_write_guard('material.definition.manage');
CREATE TRIGGER pc_0_mes_permission BEFORE INSERT OR UPDATE OR DELETE ON pc
 FOR EACH ROW EXECUTE FUNCTION configuration_write_guard('workstation.manage');
CREATE TRIGGER pc_stap_0_mes_permission BEFORE INSERT OR UPDATE OR DELETE ON pc_stap
 FOR EACH ROW EXECUTE FUNCTION configuration_write_guard('workstation.manage');
CREATE TRIGGER gebruiker_0_mes_permission BEFORE INSERT OR UPDATE OR DELETE ON gebruiker
 FOR EACH ROW EXECUTE FUNCTION configuration_write_guard('account.manage');
CREATE TRIGGER operator_0_mes_permission BEFORE INSERT OR UPDATE OR DELETE ON operator
 FOR EACH ROW EXECUTE FUNCTION configuration_write_guard('personnel.manage');
CREATE TRIGGER ploeg_0_mes_permission BEFORE INSERT OR UPDATE OR DELETE ON ploeg
 FOR EACH ROW EXECUTE FUNCTION configuration_write_guard('shift.manage');
CREATE TRIGGER rooster_0_mes_permission BEFORE INSERT OR UPDATE OR DELETE ON rooster
 FOR EACH ROW EXECUTE FUNCTION configuration_write_guard('shift.manage');
CREATE TRIGGER rooster_ploeg_0_mes_permission BEFORE INSERT OR UPDATE OR DELETE ON rooster_ploeg
 FOR EACH ROW EXECUTE FUNCTION configuration_write_guard('shift.manage');
CREATE TRIGGER stilstand_oorzaak_0_mes_permission BEFORE INSERT OR UPDATE OR DELETE ON stilstand_oorzaak
 FOR EACH ROW EXECUTE FUNCTION configuration_write_guard('downtime.reason.manage');
CREATE TRIGGER capaciteit_stap_0_mes_permission BEFORE INSERT OR UPDATE OR DELETE ON capaciteit_stap
 FOR EACH ROW EXECUTE FUNCTION configuration_write_guard('planning.manage');
CREATE TRIGGER capaciteit_afwijking_0_mes_permission BEFORE INSERT OR UPDATE OR DELETE ON capaciteit_afwijking
 FOR EACH ROW EXECUTE FUNCTION configuration_write_guard('planning.manage');
