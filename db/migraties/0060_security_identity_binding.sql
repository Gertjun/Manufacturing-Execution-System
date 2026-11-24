-- Migratie 0060: bind de persoonlijke PostgreSQL-login aan precies één MES-identiteit.
SET search_path = fabriek, public;
CREATE TABLE authorization_channel_identity (
    database_role_oid oid PRIMARY KEY,
    database_role_name name NOT NULL UNIQUE,
    user_id uuid NOT NULL UNIQUE REFERENCES gebruiker(id),
    registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    registered_by name NOT NULL DEFAULT session_user,
    reason text NOT NULL CHECK (btrim(reason)<>'')
);
REVOKE ALL ON authorization_channel_identity FROM PUBLIC;
CREATE TRIGGER authorization_channel_identity_immutable
    BEFORE UPDATE OR DELETE ON authorization_channel_identity
    FOR EACH ROW EXECUTE FUNCTION authorization_audit_immutable();

-- SESSION_USER blijft de oorspronkelijke database-login, ook in SECURITY DEFINER
-- en na SET ROLE. Een heraangemaakte rol met dezelfde naam heeft een andere OID.
CREATE FUNCTION authorization_channel_actor(p_permission text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog,fabriek,pg_temp AS $$
DECLARE v_actor uuid;
BEGIN
    SELECT i.user_id INTO v_actor
    FROM authorization_channel_identity i JOIN pg_roles r ON r.oid=i.database_role_oid
    WHERE r.rolname=session_user AND r.rolname=i.database_role_name
      AND r.rolcanlogin AND NOT r.rolsuper AND NOT r.rolcreaterole AND NOT r.rolcreatedb
      AND NOT r.rolreplication AND NOT r.rolbypassrls
      AND pg_has_role(r.oid,'mes_security_channel','MEMBER')
      AND NOT EXISTS (SELECT 1 FROM pg_roles a WHERE a.rolname IN ('mes_app','batchgui_app')
                     AND pg_has_role(r.oid,a.oid,'MEMBER'))
      AND authorization_permits(i.user_id,p_permission,NULL,NULL,NULL);
    IF v_actor IS NULL THEN RAISE EXCEPTION 'Geen gebonden bevoegde security-identiteit'; END IF;
    RETURN v_actor;
END $$;
REVOKE ALL ON FUNCTION authorization_channel_actor(text) FROM PUBLIC;

-- Geen vrije actoridentiteit meer in de publieke interface. Oude signatures
-- blijven eigenaar-only voor compatibiliteit van migratie/diagnose, niet voor kanaalleden.
REVOKE EXECUTE ON FUNCTION authorization_channel_submit(uuid,uuid,text,text,uuid,text,timestamptz,timestamptz,text,text),
 authorization_channel_decide(uuid,uuid,boolean,text,text), authorization_channel_revoke(uuid,uuid,text,text)
 FROM mes_security_channel;
CREATE FUNCTION authorization_channel_submit(p_user uuid,p_role text,p_area text,p_product uuid,p_equipment text,
 p_from timestamptz,p_until timestamptz,p_reason text,p_password text)
RETURNS TABLE(status text,request_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog,fabriek,public,pg_temp AS $$
 SELECT * FROM authorization_channel_submit(authorization_channel_actor('authorization.request'),
   p_user,p_role,p_area,p_product,p_equipment,p_from,p_until,p_reason,p_password)
$$;
CREATE FUNCTION authorization_channel_decide(p_request uuid,p_approved boolean,p_reason text,p_password text)
RETURNS TABLE(status text,grant_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog,fabriek,public,pg_temp AS $$
 SELECT * FROM authorization_channel_decide(authorization_channel_actor('authorization.approve'),
   p_request,p_approved,p_reason,p_password)
$$;
CREATE FUNCTION authorization_channel_revoke(p_grant uuid,p_reason text,p_password text)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog,fabriek,public,pg_temp AS $$
 SELECT authorization_channel_revoke(authorization_channel_actor('authorization.revoke'),p_grant,p_reason,p_password)
$$;

CREATE FUNCTION authorization_channel_requests()
RETURNS TABLE(request_id uuid,requested_by uuid,requester_name text,user_id uuid,user_name text,role_code text,
 area_code text,product_id uuid,equipment_code text,valid_from timestamptz,valid_until timestamptz,
 reason text,requested_at timestamptz,decided_by uuid,approved boolean,decision_reason text,decided_at timestamptz,grant_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog,fabriek,pg_temp AS $$
BEGIN
 PERFORM authorization_channel_actor('authorization.read');
 RETURN QUERY SELECT q.id,q.requested_by,a.gebruikersnaam,q.user_id,u.gebruikersnaam,q.role_code,
 q.area_code,q.product_id,q.equipment_code,q.valid_from,q.valid_until,q.reason,q.requested_at,
 d.decided_by,d.approved,d.reason,d.decided_at,d.grant_id
 FROM authorization_request q JOIN gebruiker a ON a.id=q.requested_by JOIN gebruiker u ON u.id=q.user_id
 LEFT JOIN authorization_decision d ON d.request_id=q.id ORDER BY q.requested_at DESC,q.id;
END $$;
CREATE FUNCTION authorization_channel_grants()
RETURNS TABLE(grant_id uuid,user_id uuid,user_name text,role_code text,area_code text,product_id uuid,equipment_code text,
 valid_from timestamptz,valid_until timestamptz,revoked_at timestamptz,revoked_by uuid,revocation_reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog,fabriek,pg_temp AS $$
BEGIN
 PERFORM authorization_channel_actor('authorization.read');
 RETURN QUERY SELECT g.id,g.user_id,u.gebruikersnaam,g.role_code,g.area_code,g.product_id,g.equipment_code,
 g.valid_from,g.valid_until,g.revoked_at,r.revoked_by,r.reason
 FROM authorization_grant g JOIN gebruiker u ON u.id=g.user_id
 LEFT JOIN authorization_revocation r ON r.grant_id=g.id ORDER BY g.valid_from DESC,g.id;
END $$;
REVOKE ALL ON FUNCTION authorization_channel_submit(uuid,text,text,uuid,text,timestamptz,timestamptz,text,text),
 authorization_channel_decide(uuid,boolean,text,text),authorization_channel_revoke(uuid,text,text),
 authorization_channel_requests(),authorization_channel_grants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authorization_channel_submit(uuid,text,text,uuid,text,timestamptz,timestamptz,text,text),
 authorization_channel_decide(uuid,boolean,text,text),authorization_channel_revoke(uuid,text,text),
 authorization_channel_requests(),authorization_channel_grants() TO mes_security_channel;
