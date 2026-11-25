-- Migratie 0041: gecontroleerde intrekking en auditspoor van bevoegdheden.
SET search_path = fabriek, public;

INSERT INTO authorization_permission(code,domain) VALUES ('authorization.revoke','security');

-- Een intrekking bewaart de grant en de identiteit en motivatie van de beslisser.
CREATE TABLE authorization_revocation (
    grant_id uuid PRIMARY KEY REFERENCES authorization_grant(id),
    revoked_by uuid NOT NULL REFERENCES gebruiker(id),
    reason text NOT NULL CHECK (btrim(reason) <> ''),
    revoked_at timestamptz NOT NULL
);

-- Intrekking is een beperkende maatregel, geen toekenning. Geen zelfintrekking
-- via dit kanaal; bevoegde collega bevestigt de exacte grant en reden.
-- Eigenaar-only tot het beveiligde beheerkanaal en de tests gereed zijn.
CREATE FUNCTION authorization_revoke_confirmed(p_actor uuid,p_grant uuid,p_reason text,p_password text)
RETURNS text LANGUAGE plpgsql SET search_path = pg_catalog,fabriek,public,pg_temp AS $$
DECLARE v_name text; v_login record; v_target uuid; v_revoked timestamptz; v_now timestamptz;
BEGIN
    IF p_actor IS NULL OR NOT authorization_permits(p_actor,'authorization.revoke',NULL,NULL,NULL) THEN
        RAISE EXCEPTION 'Geen bevoegdheid voor intrekking';
    END IF;
    SELECT gebruikersnaam INTO v_name FROM gebruiker
        WHERE id=p_actor AND actief AND NOT gedeeld AND NOT wachtwoord_wijzigen FOR UPDATE;
    IF NOT FOUND THEN RETURN 'denied'; END IF;
    SELECT * INTO v_login FROM inloggen(v_name,p_password,NULL);
    IF v_login.wacht_seconden IS NOT NULL THEN RETURN 'locked'; END IF;
    IF v_login.id IS DISTINCT FROM p_actor THEN RETURN 'denied'; END IF;
    SELECT user_id INTO v_target FROM authorization_grant WHERE id=p_grant;
    IF NOT FOUND OR v_target=p_actor THEN RAISE EXCEPTION 'Onafhankelijke intrekking vereist'; END IF;
    PERFORM 1 FROM gebruiker WHERE id=v_target FOR UPDATE;
    SELECT revoked_at INTO v_revoked FROM authorization_grant WHERE id=p_grant FOR UPDATE;
    IF v_revoked IS NOT NULL THEN RAISE EXCEPTION 'Bevoegdheid is al ingetrokken'; END IF;
    IF NOT authorization_permits(p_actor,'authorization.revoke',NULL,NULL,NULL) THEN
        RAISE EXCEPTION 'Beoordelaar is niet meer bevoegd';
    END IF;
    v_now := clock_timestamp();
    UPDATE authorization_grant SET revoked_at=v_now WHERE id=p_grant;
    INSERT INTO authorization_revocation(grant_id,revoked_by,reason,revoked_at)
    VALUES(p_grant,p_actor,p_reason,v_now);
    RETURN 'revoked';
END $$;

-- Onveranderlijke besluitregistraties; ook onderhoud kan ze niet per ongeluk wijzigen.
CREATE FUNCTION authorization_audit_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog,fabriek,pg_temp AS $$
BEGIN
    RAISE EXCEPTION 'Autorisatiebesluiten zijn onveranderlijk';
END $$;
CREATE TRIGGER authorization_request_immutable BEFORE UPDATE OR DELETE ON authorization_request
    FOR EACH ROW EXECUTE FUNCTION authorization_audit_immutable();
CREATE TRIGGER authorization_decision_immutable BEFORE UPDATE OR DELETE ON authorization_decision
    FOR EACH ROW EXECUTE FUNCTION authorization_audit_immutable();
CREATE TRIGGER authorization_revocation_immutable BEFORE UPDATE OR DELETE ON authorization_revocation
    FOR EACH ROW EXECUTE FUNCTION authorization_audit_immutable();
REVOKE ALL ON authorization_revocation FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION authorization_revoke_confirmed(uuid,uuid,text,text),authorization_audit_immutable() FROM PUBLIC;

-- Expliciete veilige zoekpaden, ook na upgrade vanaf een oudere versie.
ALTER FUNCTION inloggen(text,text,text) SET search_path = pg_catalog,fabriek,public,pg_temp;
ALTER FUNCTION wijzig_eigen_wachtwoord(uuid,text,text) SET search_path = pg_catalog,fabriek,public,pg_temp;
ALTER FUNCTION demo_account_names(text[]) SET search_path = pg_catalog,fabriek,public,pg_temp;
