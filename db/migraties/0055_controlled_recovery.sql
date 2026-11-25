-- Migratie 0055: eigenaar-only herstel met twee persoonlijk bevestigde security-identiteiten.
SET search_path = fabriek, public;

CREATE TABLE authorization_recovery (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES gebruiker(id),
    requested_by uuid NOT NULL REFERENCES gebruiker(id),
    approved_by uuid NOT NULL REFERENCES gebruiker(id),
    reason text NOT NULL CHECK (btrim(reason) <> ''),
    recovered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (user_id <> requested_by AND user_id <> approved_by AND requested_by <> approved_by)
);
CREATE TRIGGER authorization_recovery_immutable BEFORE UPDATE OR DELETE ON authorization_recovery
    FOR EACH ROW EXECUTE FUNCTION authorization_audit_immutable();

-- Beide bevestigingen gelden voor dezelfde concrete herstelhandeling.
-- Geen automatisch activeren, geen nieuwe grants, geen herstel van gedeelde accounts.
-- De eigenaar begeleidt de persoonlijke overdracht; het wachtwoord wordt niet gelogd.
CREATE FUNCTION authorization_recover_confirmed(p_target uuid,p_requester uuid,p_approver uuid,
    p_reason text,p_requester_password text,p_approver_password text,p_new_password text)
RETURNS text LANGUAGE plpgsql SET search_path = pg_catalog,fabriek,public,pg_temp AS $$
DECLARE v_a text; v_b text; v_login record;
BEGIN
    IF current_user <> pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='fabriek.gebruiker'::regclass)) THEN
        RAISE EXCEPTION 'Herstel vereist database-eigenaar';
    END IF;
    IF p_target IS NULL OR p_requester IS NULL OR p_approver IS NULL
       OR p_target=p_requester OR p_target=p_approver OR p_requester=p_approver
       OR btrim(coalesce(p_reason,''))='' OR length(coalesce(p_new_password,''))<8 THEN
        RAISE EXCEPTION 'Onafhankelijke herstelidentiteiten, reden en wachtwoord vereist';
    END IF;
    -- Vaste vergrendelvolgorde voorkomt onderlinge blokkades bij gelijktijdig herstel.
    PERFORM id FROM gebruiker WHERE id IN (p_target,p_requester,p_approver) ORDER BY id FOR UPDATE;
    IF NOT EXISTS (SELECT 1 FROM gebruiker WHERE id=p_target AND actief AND NOT gedeeld)
       OR NOT authorization_permits(p_requester,'authorization.request',NULL,NULL,NULL)
       OR NOT authorization_permits(p_approver,'authorization.approve',NULL,NULL,NULL) THEN
        RAISE EXCEPTION 'Geen bevoegdheid voor gecontroleerd herstel';
    END IF;
    SELECT gebruikersnaam INTO v_a FROM gebruiker WHERE id=p_requester;
    SELECT gebruikersnaam INTO v_b FROM gebruiker WHERE id=p_approver;
    SELECT * INTO v_login FROM inloggen(v_a,p_requester_password,NULL);
    IF v_login.wacht_seconden IS NOT NULL THEN RETURN 'locked'; END IF;
    IF v_login.id IS DISTINCT FROM p_requester THEN RETURN 'denied'; END IF;
    SELECT * INTO v_login FROM inloggen(v_b,p_approver_password,NULL);
    IF v_login.wacht_seconden IS NOT NULL THEN RETURN 'locked'; END IF;
    IF v_login.id IS DISTINCT FROM p_approver THEN RETURN 'denied'; END IF;
    -- Herstel blokkeert normale toegang totdat de accounthouder het wachtwoord wijzigt.
    UPDATE gebruiker SET wachtwoord_hash=wachtwoord_hash(p_new_password),wachtwoord_wijzigen=true
      WHERE id=p_target;
    INSERT INTO authorization_recovery(user_id,requested_by,approved_by,reason)
      VALUES(p_target,p_requester,p_approver,p_reason);
    RETURN 'recovered';
END $$;
REVOKE ALL ON authorization_recovery FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION authorization_recover_confirmed(uuid,uuid,uuid,text,text,text,text) FROM PUBLIC;
