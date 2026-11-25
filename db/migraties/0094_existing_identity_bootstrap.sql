-- Migratie 0094: eenmalige gecontroleerde eerste MES-rechten op bestaande administratie.
SET search_path = fabriek, public;

-- Hergebruik het onveranderlijke singleton-bootstraprecord als permanente blokkade.
-- Geen automatische vertaling van legacy-rollen en geen wijziging van historische accounts.
CREATE FUNCTION authorization_bootstrap_existing(p_system uuid,p_system_password text,
    p_a uuid,p_a_password text,p_b uuid,p_b_password text,p_reason text)
RETURNS text LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v record; v_login record;
BEGIN
    IF current_user <> pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='fabriek.gebruiker'::regclass)) THEN
        RAISE EXCEPTION 'Overgang vereist database-eigenaar';
    END IF;
    LOCK TABLE gebruiker IN SHARE ROW EXCLUSIVE MODE;
    LOCK TABLE authorization_grant, authorization_bootstrap IN SHARE ROW EXCLUSIVE MODE;
    IF NOT EXISTS (SELECT 1 FROM gebruiker)
       OR EXISTS (SELECT 1 FROM authorization_bootstrap)
       OR EXISTS (SELECT 1 FROM authorization_grant)
       OR EXISTS (SELECT 1 FROM authorization_request) THEN
        RAISE EXCEPTION 'Overgang uitsluitend op bestaande administratie zonder MES-rechtenhistorie';
    END IF;
    IF p_system IS NULL OR p_a IS NULL OR p_b IS NULL
       OR p_system=p_a OR p_system=p_b OR p_a=p_b
       OR btrim(coalesce(p_reason,''))=''
       OR length(coalesce(p_system_password,''))=0 OR length(coalesce(p_a_password,''))=0
       OR length(coalesce(p_b_password,''))=0
       OR p_system_password=p_a_password OR p_system_password=p_b_password OR p_a_password=p_b_password THEN
        RAISE EXCEPTION 'Drie afzonderlijke persoonlijke identiteiten, bevestigingen en referentie vereist';
    END IF;
    IF (SELECT count(*) FROM gebruiker WHERE id IN (p_system,p_a,p_b)
        AND actief AND NOT gedeeld AND NOT wachtwoord_wijzigen AND rol<>'scherm'
        AND wachtwoord_hash IS NOT NULL) <> 3 THEN
        RAISE EXCEPTION 'Ongeschikte persoonlijke overgangsidentiteit';
    END IF;
    FOR v IN SELECT g.id,g.gebruikersnaam,CASE g.id WHEN p_system THEN p_system_password
        WHEN p_a THEN p_a_password ELSE p_b_password END AS wachtwoord
        FROM gebruiker g WHERE g.id IN (p_system,p_a,p_b) ORDER BY g.id
    LOOP
        SELECT * INTO v_login FROM inloggen(v.gebruikersnaam,v.wachtwoord,NULL);
        IF v_login.id IS DISTINCT FROM v.id THEN
            RETURN CASE WHEN coalesce(v_login.wacht_seconden,0)>0 THEN 'locked' ELSE 'denied' END;
        END IF;
    END LOOP;
    -- Bestaande sessies mogen de nieuwe bevoegdheden niet ongemerkt verkrijgen.
    UPDATE gebruiker SET session_version=session_version+1 WHERE id IN (p_system,p_a,p_b);
    INSERT INTO authorization_grant(user_id,role_code) VALUES
      (p_system,'system_administrator'),(p_a,'security_administrator'),(p_b,'security_administrator');
    INSERT INTO authorization_bootstrap(system_user_id,security_user_a,security_user_b,database_actor,reason)
      VALUES(p_system,p_a,p_b,current_user,'Gecontroleerde overgang bestaande administratie: '||p_reason);
    RETURN 'initialized';
END $$;
REVOKE ALL ON FUNCTION authorization_bootstrap_existing(uuid,text,uuid,text,uuid,text,text) FROM PUBLIC;

-- De vertrouwde eigenaar mag expliciet exact één sessiegeneratie verhogen.
-- Runtime kan deze kolom niet schrijven; gewone accountwijzigingen houden hun bestaande gedrag.
CREATE OR REPLACE FUNCTION authorization_session_version() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
    IF TG_OP='INSERT' THEN
        NEW.session_version := 1;
    ELSIF NEW.wachtwoord_hash IS DISTINCT FROM OLD.wachtwoord_hash
       OR NEW.wachtwoord_wijzigen IS DISTINCT FROM OLD.wachtwoord_wijzigen
       OR NEW.actief IS DISTINCT FROM OLD.actief OR NEW.rol IS DISTINCT FROM OLD.rol
       OR NEW.gedeeld IS DISTINCT FROM OLD.gedeeld
       OR NEW.gebruikersnaam IS DISTINCT FROM OLD.gebruikersnaam
       OR (current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID))
           AND NEW.session_version=OLD.session_version+1) THEN
        NEW.session_version := OLD.session_version + 1;
    ELSE
        NEW.session_version := OLD.session_version;
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION authorization_session_version() FROM PUBLIC;
