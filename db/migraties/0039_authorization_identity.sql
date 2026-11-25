-- Migratie 0039: bescherming van security-identiteiten en besluitgebonden herbevestiging.
SET search_path = fabriek, public;

-- Ook toekomstige en verlopen, niet-ingetrokken security-grants beschermen:
-- herstel van een kritisch account vereist een afzonderlijk gecontroleerd kanaal.
CREATE FUNCTION authorization_protect_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = fabriek, public AS $$
BEGIN
    IF (EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('mes_app','batchgui_app')
                    AND pg_has_role(current_user, oid, 'MEMBER')))
       AND EXISTS (
           SELECT 1 FROM authorization_grant g JOIN authorization_role r ON r.code=g.role_code
           WHERE g.user_id=OLD.id AND g.revoked_at IS NULL AND r.domain='security')
       AND (NEW.wachtwoord_hash IS DISTINCT FROM OLD.wachtwoord_hash
         OR NEW.wachtwoord_wijzigen IS DISTINCT FROM OLD.wachtwoord_wijzigen
         OR NEW.rol IS DISTINCT FROM OLD.rol
         OR NEW.gebruikersnaam IS DISTINCT FROM OLD.gebruikersnaam
         OR NEW.gedeeld IS DISTINCT FROM OLD.gedeeld
         OR NEW.actief IS DISTINCT FROM OLD.actief) THEN
        RAISE EXCEPTION 'Kritisch account vereist gecontroleerd identiteitsbeheer';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER authorization_protect_identity BEFORE UPDATE ON gebruiker
    FOR EACH ROW EXECUTE FUNCTION authorization_protect_identity();

-- Een persoonlijke herbevestiging en het specifieke besluit in dezelfde aanroep.
-- Nog eigenaar-only. Een fout wachtwoord retourneert een status in plaats van
-- een exception, zodat de inlogpoging bij COMMIT behouden blijft.
CREATE FUNCTION authorization_decide_confirmed(p_actor uuid, p_request uuid,
    p_approved boolean, p_reason text, p_password text)
RETURNS TABLE (status text, grant_id uuid)
LANGUAGE plpgsql SET search_path = fabriek, public AS $$
DECLARE v_name text; v_login record; v_grant uuid;
BEGIN
    SELECT gebruikersnaam INTO v_name FROM gebruiker
      WHERE id=p_actor AND actief AND NOT gedeeld AND NOT wachtwoord_wijzigen
      FOR UPDATE;
    IF NOT FOUND THEN RETURN QUERY SELECT 'denied'::text, NULL::uuid; RETURN; END IF;
    SELECT * INTO v_login FROM inloggen(v_name,p_password,NULL);
    IF v_login.wacht_seconden IS NOT NULL THEN
        RETURN QUERY SELECT 'locked'::text, NULL::uuid; RETURN;
    END IF;
    IF v_login.id IS DISTINCT FROM p_actor THEN
        RETURN QUERY SELECT 'denied'::text, NULL::uuid; RETURN;
    END IF;
    v_grant := authorization_decide(p_actor,p_request,p_approved,p_reason);
    RETURN QUERY SELECT 'decided'::text, v_grant;
END $$;
REVOKE EXECUTE ON FUNCTION authorization_decide_confirmed(uuid,uuid,boolean,text,text) FROM PUBLIC;
