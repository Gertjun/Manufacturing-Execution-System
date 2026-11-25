-- Migratie 0085: uitsluitend eerste, onafhankelijk bevestigde personeelskoppeling.
SET search_path = fabriek, public;

CREATE TABLE authorization_personnel_link (
    personnel_id uuid PRIMARY KEY REFERENCES operator(id),
    user_id uuid NOT NULL UNIQUE REFERENCES gebruiker(id),
    requested_by uuid NOT NULL REFERENCES gebruiker(id),
    approved_by uuid NOT NULL REFERENCES gebruiker(id),
    reason text NOT NULL CHECK (btrim(reason)<>''),
    linked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (user_id<>requested_by AND user_id<>approved_by AND requested_by<>approved_by)
);
CREATE TRIGGER authorization_personnel_link_immutable BEFORE UPDATE OR DELETE ON authorization_personnel_link
    FOR EACH ROW EXECUTE FUNCTION authorization_audit_immutable();
REVOKE ALL ON authorization_personnel_link FROM PUBLIC;

-- Eigenaar faciliteert de handeling; twee actuele MES-permissions en twee
-- persoonlijke wachtwoordbevestigingen zijn vereist. Geen grants of historische
-- registraties wijzigen. De organisatie verifieert dat beide IDs dezelfde persoon betreffen.
CREATE FUNCTION authorization_link_personnel_confirmed(p_personnel uuid,p_user uuid,p_requester uuid,p_approver uuid,
    p_reason text,p_requester_password text,p_approver_password text)
RETURNS text LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_a text; v_b text; v_login record;
BEGIN
    IF current_user <> pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='fabriek.operator'::regclass)) THEN
        RAISE EXCEPTION 'Personeelskoppeling vereist database-eigenaar';
    END IF;
    IF p_personnel IS NULL OR p_user IS NULL OR p_requester IS NULL OR p_approver IS NULL
       OR p_user=p_requester OR p_user=p_approver OR p_requester=p_approver
       OR btrim(coalesce(p_reason,''))='' THEN
        RAISE EXCEPTION 'Onafhankelijke identiteiten en reden vereist';
    END IF;
    PERFORM id FROM gebruiker WHERE id IN (p_user,p_requester,p_approver) ORDER BY id FOR UPDATE;
    PERFORM id FROM operator WHERE id=p_personnel FOR UPDATE;
    IF NOT EXISTS (SELECT 1 FROM gebruiker WHERE id=p_user AND actief AND NOT gedeeld AND NOT wachtwoord_wijzigen)
       OR NOT EXISTS (SELECT 1 FROM operator WHERE id=p_personnel AND actief AND gebruiker_id IS NULL)
       OR EXISTS (SELECT 1 FROM operator WHERE gebruiker_id=p_user)
       OR EXISTS (SELECT 1 FROM authorization_personnel_link WHERE personnel_id=p_personnel OR user_id=p_user) THEN
        RAISE EXCEPTION 'Uitsluitend eerste koppeling van actieve persoonlijke identiteiten toegestaan';
    END IF;
    IF NOT authorization_permits(p_requester,'personnel.manage',NULL,NULL,NULL)
       OR NOT authorization_permits(p_approver,'authorization.approve',NULL,NULL,NULL) THEN
        RAISE EXCEPTION 'Onafhankelijke bevoegde personeelsbeheerder en securitybeoordelaar vereist';
    END IF;
    SELECT gebruikersnaam INTO v_a FROM gebruiker WHERE id=p_requester;
    SELECT gebruikersnaam INTO v_b FROM gebruiker WHERE id=p_approver;
    SELECT * INTO v_login FROM inloggen(v_a,p_requester_password,NULL);
    IF v_login.wacht_seconden IS NOT NULL THEN RETURN 'locked'; END IF;
    IF v_login.id IS DISTINCT FROM p_requester THEN RETURN 'denied'; END IF;
    SELECT * INTO v_login FROM inloggen(v_b,p_approver_password,NULL);
    IF v_login.wacht_seconden IS NOT NULL THEN RETURN 'locked'; END IF;
    IF v_login.id IS DISTINCT FROM p_approver THEN RETURN 'denied'; END IF;
    UPDATE operator SET gebruiker_id=p_user WHERE id=p_personnel;
    INSERT INTO authorization_personnel_link(personnel_id,user_id,requested_by,approved_by,reason)
      VALUES(p_personnel,p_user,p_requester,p_approver,p_reason);
    RETURN 'linked';
END $$;
REVOKE ALL ON FUNCTION authorization_link_personnel_confirmed(uuid,uuid,uuid,uuid,text,text,text) FROM PUBLIC;
