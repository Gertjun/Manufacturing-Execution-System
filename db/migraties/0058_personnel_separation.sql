-- Migratie 0058: scheid operationeel personeelsbeheer en accountbeheer.
SET search_path = fabriek, public;
INSERT INTO authorization_permission(code,domain) VALUES
 ('personnel.read','operations'), ('personnel.manage','operations');
INSERT INTO authorization_role_permission(role_code,permission_code) VALUES
 ('manufacturing_manager','personnel.read'), ('manufacturing_manager','personnel.manage');

-- Alleen een bestaande actieve persoonlijke koppeling teruggeven.
-- Inloggen creëert nooit meer een personeelsidentiteit.
CREATE OR REPLACE FUNCTION operator_van_account(p_gebruiker uuid)
RETURNS uuid LANGUAGE sql STABLE SET search_path = pg_catalog,fabriek,pg_temp AS $$
    SELECT o.id FROM operator o JOIN gebruiker g ON g.id=o.gebruiker_id
    WHERE g.id=p_gebruiker AND g.actief AND NOT g.gedeeld AND o.actief
$$;

-- Historische koppelingen blijven intact; koppelen is een aparte gecontroleerde
-- handeling, voorlopig alleen door de vertrouwde eigenaar. Geen vrije app-write.
CREATE FUNCTION authorization_personnel_identity_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog,fabriek,pg_temp AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('mes_app','batchgui_app')
               AND pg_has_role(current_user,oid,'MEMBER')) THEN
        IF TG_OP='INSERT' THEN
            IF NEW.gebruiker_id IS NOT NULL THEN
                RAISE EXCEPTION 'Personeelskoppeling vereist gecontroleerd identiteitsbeheer';
            END IF;
        ELSIF NEW.gebruiker_id IS DISTINCT FROM OLD.gebruiker_id OR NEW.id IS DISTINCT FROM OLD.id THEN
            RAISE EXCEPTION 'Personeelskoppeling vereist gecontroleerd identiteitsbeheer';
        END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER authorization_personnel_identity_guard BEFORE INSERT OR UPDATE ON operator
    FOR EACH ROW EXECUTE FUNCTION authorization_personnel_identity_guard();
REVOKE EXECUTE ON FUNCTION authorization_personnel_identity_guard() FROM PUBLIC;
