-- Migratie 0052: geen oude roltoekenning via de gewone applicatie (D99).
SET search_path = fabriek, public;

ALTER TABLE gebruiker DROP CONSTRAINT gebruiker_rol_check;
ALTER TABLE gebruiker ADD CONSTRAINT gebruiker_rol_check
    CHECK (rol IN ('pending','operator','ploegleider','kwaliteit','beheerder','analist','planner','scherm','productiemanager'));

CREATE FUNCTION authorization_guard_legacy_role() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog,fabriek,pg_temp AS $$
BEGIN
    IF NOT (current_user = pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID))) AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('mes_app','batchgui_app')
               AND pg_has_role(current_user,oid,'MEMBER')) THEN
        IF TG_OP = 'INSERT' THEN
            IF NEW.rol <> 'pending' OR NEW.gedeeld OR NOT NEW.wachtwoord_wijzigen THEN
                RAISE EXCEPTION 'Nieuw account vereist gecontroleerde roltoekenning';
            END IF;
        ELSE
            IF NEW.rol IS DISTINCT FROM OLD.rol OR NEW.gedeeld IS DISTINCT FROM OLD.gedeeld
               OR NEW.id IS DISTINCT FROM OLD.id THEN
                RAISE EXCEPTION 'Oude rol of identiteit mag niet rechtstreeks wijzigen';
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER authorization_guard_legacy_role BEFORE INSERT OR UPDATE ON gebruiker
    FOR EACH ROW EXECUTE FUNCTION authorization_guard_legacy_role();
REVOKE EXECUTE ON FUNCTION authorization_guard_legacy_role() FROM PUBLIC;
