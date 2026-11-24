-- Migratie 0068: transactionele identiteitsbinding voor productie-invoer.
SET search_path = fabriek, public;

-- Een GUC bevat alleen het bewijs, nooit een vertrouwde actor-ID. Iedere
-- beschermde operatie valideert opnieuw het bewijs en de actuele koppeling.
CREATE FUNCTION execution_transaction_actor()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_actor uuid;
BEGIN
    v_actor:=execution_session_actor(current_setting('fabriek.execution_proof',true));
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Geldig persoonlijk uitvoeringsbewijs vereist' USING ERRCODE='42501';
    END IF;
    RETURN v_actor;
END $$;

CREATE FUNCTION execution_bind_transaction(p_proof text,p_expected uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_actor uuid;
BEGIN
    v_actor:=execution_session_actor(p_proof);
    IF v_actor IS NULL OR v_actor IS DISTINCT FROM p_expected THEN
        RAISE EXCEPTION 'Persoonlijke uitvoeringssessie ongeldig' USING ERRCODE='42501';
    END IF;
    PERFORM set_config('fabriek.execution_proof',p_proof,true);
    RETURN v_actor;
END $$;

-- Gebruik SESSION_USER niet als uitzondering: SET ROLE door een eigenaar
-- moet in regressietests dezelfde beperkingen ondervinden als de app.
-- De invoker-trigger ziet de effectieve rol vóór een SECURITY DEFINER call.
CREATE FUNCTION execution_registration_identity_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_actor uuid; v_operator uuid;
BEGIN
    IF current_user = pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID)) OR NOT pg_has_role(current_user,'mes_app','MEMBER') THEN RETURN NEW; END IF;
    v_actor:=execution_transaction_actor();
    IF TG_OP='INSERT' THEN
        v_operator:=NEW.operator_id;
    ELSE
        IF NEW.operator_id IS DISTINCT FROM OLD.operator_id THEN
            RAISE EXCEPTION 'Oorspronkelijke operator mag niet wijzigen' USING ERRCODE='42501';
        END IF;
        IF NEW.afgerond_door IS DISTINCT FROM OLD.afgerond_door THEN
            v_operator:=NEW.afgerond_door;
        END IF;
    END IF;
    IF (TG_OP='INSERT' OR v_operator IS NOT NULL) AND NOT EXISTS (
        SELECT 1 FROM operator o WHERE o.id=v_operator AND o.gebruiker_id=v_actor AND o.actief
    ) THEN
        RAISE EXCEPTION 'Operator komt niet overeen met bewezen identiteit' USING ERRCODE='42501';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER stapregistratie_00_identity BEFORE INSERT OR UPDATE ON stapregistratie
 FOR EACH ROW EXECUTE FUNCTION execution_registration_identity_guard();

REVOKE ALL ON FUNCTION execution_transaction_actor(),execution_bind_transaction(text,uuid),execution_registration_identity_guard() FROM PUBLIC;
