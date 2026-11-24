-- Migratie 0053: bescherm alle bevoegde identiteiten tegen gewone accountresets.
SET search_path = fabriek, public;

CREATE OR REPLACE FUNCTION authorization_protect_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog,fabriek,pg_temp AS $$
BEGIN
    -- Alleen de vertrouwde eigenaar (inclusief gecontroleerde SECURITY DEFINER
    -- wachtwoordwijziging) valt buiten de blokkade. Een gewone app-login niet.
    IF current_user <> pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID))
       AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('mes_app','batchgui_app')
                    AND pg_has_role(current_user, oid, 'MEMBER'))
       AND (
         OLD.rol <> 'pending'
         OR EXISTS (SELECT 1 FROM authorization_grant g
                    WHERE g.user_id=OLD.id AND g.revoked_at IS NULL)
       )
       AND (NEW.wachtwoord_hash IS DISTINCT FROM OLD.wachtwoord_hash
         OR NEW.wachtwoord_wijzigen IS DISTINCT FROM OLD.wachtwoord_wijzigen
         OR NEW.rol IS DISTINCT FROM OLD.rol
         OR NEW.gebruikersnaam IS DISTINCT FROM OLD.gebruikersnaam
         OR NEW.gedeeld IS DISTINCT FROM OLD.gedeeld
         OR (NEW.actief IS DISTINCT FROM OLD.actief AND
             (NEW.actief OR EXISTS (SELECT 1 FROM authorization_grant g
                JOIN authorization_role r ON r.code=g.role_code
                WHERE g.user_id=OLD.id AND g.revoked_at IS NULL AND r.domain IN ('technical','security'))))) THEN
        RAISE EXCEPTION 'Kritisch account vereist gecontroleerd identiteitsbeheer';
    END IF;
    RETURN NEW;
END $$;

-- Een account met een door technisch beheer gekozen tijdelijk wachtwoord
-- mag geen nieuwe bevoegdheden krijgen voordat het persoonlijk is ingericht.
CREATE OR REPLACE FUNCTION authorization_decide(p_actor uuid, p_request uuid, p_approved boolean, p_reason text)
RETURNS uuid LANGUAGE plpgsql SET search_path = fabriek, public AS $$
DECLARE v authorization_request%ROWTYPE; v_grant uuid; v_domain text;
BEGIN
    -- Serialiseer besluiten voor hetzelfde doelaccount, ook uit verschillende aanvragen.
    SELECT * INTO v FROM authorization_request WHERE id=p_request FOR UPDATE;
    IF NOT FOUND OR p_actor IS NULL OR p_approved IS NULL OR
       p_actor = v.requested_by OR p_actor = v.user_id OR
       NOT authorization_permits(p_actor,'authorization.approve',NULL,NULL,NULL) THEN
        RAISE EXCEPTION 'Onafhankelijke bevoegde beoordelaar vereist';
    END IF;
    IF EXISTS (SELECT 1 FROM authorization_decision WHERE request_id=p_request) THEN
        RAISE EXCEPTION 'Aanvraag is al beoordeeld';
    END IF;
    PERFORM 1 FROM gebruiker WHERE id=v.user_id FOR UPDATE;
    IF p_approved THEN
        IF NOT authorization_permits(v.requested_by,'authorization.request',NULL,NULL,NULL) THEN
            RAISE EXCEPTION 'Aanvrager is niet meer bevoegd';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM gebruiker WHERE id=v.user_id AND actief AND NOT gedeeld AND NOT wachtwoord_wijzigen) THEN
            RAISE EXCEPTION 'Ongeldig persoonlijk doelaccount';
        END IF;
        IF v.valid_until IS NOT NULL AND v.valid_until <= clock_timestamp() THEN
            RAISE EXCEPTION 'Geldigheid is verlopen';
        END IF;
        SELECT domain INTO v_domain FROM authorization_role WHERE code=v.role_code;
        IF EXISTS (
            SELECT 1 FROM authorization_grant g JOIN authorization_role r ON r.code=g.role_code
            WHERE g.user_id=v.user_id AND g.revoked_at IS NULL
              AND tstzrange(g.valid_from,g.valid_until,'[)') && tstzrange(v.valid_from,v.valid_until,'[)')
              AND ((r.domain IN ('technical','security')) <> (v_domain IN ('technical','security'))
                OR (r.domain='display') <> (v_domain='display')
                OR (r.domain IN ('technical','security') AND v_domain IN ('technical','security') AND r.domain <> v_domain))
        ) THEN RAISE EXCEPTION 'Functiescheiding verhindert toekenning'; END IF;
        INSERT INTO authorization_grant (user_id,role_code,area_code,product_id,equipment_code,valid_from,valid_until)
        VALUES (v.user_id,v.role_code,v.area_code,v.product_id,v.equipment_code,v.valid_from,v.valid_until)
        RETURNING id INTO v_grant;
    END IF;
    INSERT INTO authorization_decision (request_id,decided_by,approved,reason,grant_id)
    VALUES (v.id,p_actor,p_approved,p_reason,v_grant);
    RETURN v_grant;
END $$;
