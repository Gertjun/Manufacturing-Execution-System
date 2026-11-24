-- Migratie 0059: persoonlijk bevestigd autorisatiekanaal, zonder eigenaarlogin.
SET search_path = fabriek, public;

-- Afzonderlijke NOLOGIN-groepsrol. IT maakt persoonlijke database-logins
-- uitsluitend na organisatorische goedkeuring; geen automatische leden.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mes_security_channel') THEN
        CREATE ROLE mes_security_channel NOLOGIN;
    END IF;
END $$;

-- Elke handeling verifieert opnieuw de persoonlijke MES-identiteit.
-- Onjuiste wachtwoorden retourneren status zodat de poging gecommit kan worden.
CREATE FUNCTION authorization_channel_submit(p_actor uuid,p_user uuid,p_role text,
    p_area text,p_product uuid,p_equipment text,p_from timestamptz,p_until timestamptz,
    p_reason text,p_password text)
RETURNS TABLE(status text,request_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,fabriek,public,pg_temp AS $$
DECLARE v_name text; v_login record; v_id uuid;
BEGIN
    SELECT gebruikersnaam INTO v_name FROM gebruiker
      WHERE id=p_actor AND actief AND NOT gedeeld AND NOT wachtwoord_wijzigen FOR UPDATE;
    IF NOT FOUND THEN RETURN QUERY SELECT 'denied'::text,NULL::uuid; RETURN; END IF;
    SELECT * INTO v_login FROM inloggen(v_name,p_password,NULL);
    IF v_login.wacht_seconden IS NOT NULL THEN RETURN QUERY SELECT 'locked'::text,NULL::uuid; RETURN; END IF;
    IF v_login.id IS DISTINCT FROM p_actor THEN RETURN QUERY SELECT 'denied'::text,NULL::uuid; RETURN; END IF;
    v_id := authorization_submit(p_actor,p_user,p_role,p_area,p_product,p_equipment,p_from,p_until,p_reason);
    RETURN QUERY SELECT 'submitted'::text,v_id;
END $$;

CREATE FUNCTION authorization_channel_decide(p_actor uuid,p_request uuid,p_approved boolean,p_reason text,p_password text)
RETURNS TABLE(status text,grant_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog,fabriek,public,pg_temp AS $$
    SELECT * FROM authorization_decide_confirmed(p_actor,p_request,p_approved,p_reason,p_password)
$$;
CREATE FUNCTION authorization_channel_revoke(p_actor uuid,p_grant uuid,p_reason text,p_password text)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog,fabriek,public,pg_temp AS $$
    SELECT authorization_revoke_confirmed(p_actor,p_grant,p_reason,p_password)
$$;

-- Alleen voor de aparte groepsrol; gewone applicatie en PUBLIC nooit.
REVOKE ALL ON FUNCTION authorization_channel_submit(uuid,uuid,text,text,uuid,text,timestamptz,timestamptz,text,text),
 authorization_channel_decide(uuid,uuid,boolean,text,text),
 authorization_channel_revoke(uuid,uuid,text,text) FROM PUBLIC;
GRANT USAGE ON SCHEMA fabriek TO mes_security_channel;
GRANT EXECUTE ON FUNCTION authorization_channel_submit(uuid,uuid,text,text,uuid,text,timestamptz,timestamptz,text,text),
 authorization_channel_decide(uuid,uuid,boolean,text,text),
 authorization_channel_revoke(uuid,uuid,text,text) TO mes_security_channel;
