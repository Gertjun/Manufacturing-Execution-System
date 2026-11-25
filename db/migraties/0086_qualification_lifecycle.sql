-- Migratie 0086: begrensde operationele kwalificaties met onafhankelijk bewijs (D89 P02/P04/P05).
SET search_path = fabriek, public;

INSERT INTO authorization_permission(code,domain) VALUES
 ('qualification.issue','operations'),('qualification.approve','operations'),('qualification.revoke','operations');
INSERT INTO authorization_role_permission(role_code,permission_code) VALUES
 ('manufacturing_manager','qualification.issue'),('manufacturing_manager','qualification.approve'),
 ('manufacturing_manager','qualification.revoke');

CREATE TABLE qualification_issue (
    qualification_id uuid PRIMARY KEY REFERENCES personnel_qualification(id),
    requested_by uuid NOT NULL REFERENCES gebruiker(id),
    approved_by uuid NOT NULL REFERENCES gebruiker(id),
    evidence text NOT NULL CHECK (btrim(evidence)<>''),
    issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (requested_by<>approved_by)
);
CREATE TABLE qualification_revocation (
    qualification_id uuid PRIMARY KEY REFERENCES personnel_qualification(id),
    revoked_by uuid NOT NULL REFERENCES gebruiker(id),
    reason text NOT NULL CHECK (btrim(reason)<>''),
    revoked_at timestamptz NOT NULL
);
CREATE TRIGGER qualification_issue_immutable BEFORE UPDATE OR DELETE ON qualification_issue
 FOR EACH ROW EXECUTE FUNCTION authorization_audit_immutable();
CREATE TRIGGER qualification_revocation_immutable BEFORE UPDATE OR DELETE ON qualification_revocation
 FOR EACH ROW EXECUTE FUNCTION authorization_audit_immutable();
REVOKE ALL ON qualification_issue,qualification_revocation FROM PUBLIC;

-- Alleen expliciet aan operationele activiteiten gekoppelde definities.
-- Andere domeinen en niet-geclassificeerde kwalificaties blijven gesloten.
CREATE FUNCTION qualification_is_operations(p_code text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,fabriek,pg_temp AS $$
 SELECT EXISTS (SELECT 1 FROM activity_qualification WHERE qualification_code=p_code)
 AND NOT EXISTS (SELECT 1 FROM activity_qualification a JOIN authorization_permission p ON p.code=a.permission_code
   WHERE a.qualification_code=p_code AND p.domain<>'operations')
$$;

CREATE FUNCTION qualification_issue_confirmed(p_user uuid,p_code text,p_from timestamptz,p_until timestamptz,
 p_requester uuid,p_approver uuid,p_evidence text,p_requester_password text,p_approver_password text)
RETURNS TABLE(status text,qualification_id uuid)
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_name text; v_login record; v_id uuid;
BEGIN
 IF current_user<>pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='fabriek.personnel_qualification'::regclass)) THEN
   RAISE EXCEPTION 'Kwalificatietoekenning vereist database-eigenaar';
 END IF;
 IF p_user IS NULL OR p_requester IS NULL OR p_approver IS NULL
   OR p_user=p_requester OR p_user=p_approver OR p_requester=p_approver
   OR p_from IS NULL OR NOT isfinite(p_from) OR p_until IS NULL OR NOT isfinite(p_until)
   OR p_until<=p_from OR p_until<=clock_timestamp() OR btrim(coalesce(p_evidence,''))='' THEN
   RAISE EXCEPTION 'Onafhankelijke identiteiten, eindige geldigheid en bewijs vereist';
 END IF;
 PERFORM id FROM gebruiker WHERE id IN(p_user,p_requester,p_approver) ORDER BY id FOR UPDATE;
 LOCK TABLE activity_qualification IN SHARE MODE;
 PERFORM id FROM operator WHERE gebruiker_id=p_user AND actief FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM gebruiker WHERE id=p_user AND actief AND NOT gedeeld AND NOT wachtwoord_wijzigen) THEN
   RAISE EXCEPTION 'Actief persoonlijk gekoppeld doelaccount vereist';
 END IF;
 IF NOT qualification_is_operations(p_code) THEN RAISE EXCEPTION 'Geen geclassificeerde operationele kwalificatie'; END IF;
 IF NOT authorization_permits(p_requester,'qualification.issue',NULL,NULL,NULL)
   OR NOT authorization_permits(p_approver,'qualification.approve',NULL,NULL,NULL) THEN
   RAISE EXCEPTION 'Onafhankelijke inhoudelijk bevoegde beoordelaars vereist';
 END IF;
 IF EXISTS(SELECT 1 FROM personnel_qualification WHERE user_id=p_user AND qualification_code=p_code
   AND revoked_at IS NULL AND tstzrange(valid_from,valid_until,'[)') && tstzrange(p_from,p_until,'[)')) THEN
   RAISE EXCEPTION 'Overlappende kwalificatie';
 END IF;
 SELECT gebruikersnaam INTO v_name FROM gebruiker WHERE id=p_requester;
 SELECT * INTO v_login FROM inloggen(v_name,p_requester_password,NULL);
 IF v_login.wacht_seconden IS NOT NULL THEN RETURN QUERY SELECT 'locked'::text,NULL::uuid; RETURN; END IF;
 IF v_login.id IS DISTINCT FROM p_requester THEN RETURN QUERY SELECT 'denied'::text,NULL::uuid; RETURN; END IF;
 SELECT gebruikersnaam INTO v_name FROM gebruiker WHERE id=p_approver;
 SELECT * INTO v_login FROM inloggen(v_name,p_approver_password,NULL);
 IF v_login.wacht_seconden IS NOT NULL THEN RETURN QUERY SELECT 'locked'::text,NULL::uuid; RETURN; END IF;
 IF v_login.id IS DISTINCT FROM p_approver THEN RETURN QUERY SELECT 'denied'::text,NULL::uuid; RETURN; END IF;
 INSERT INTO personnel_qualification(user_id,qualification_code,valid_from,valid_until)
 VALUES(p_user,p_code,p_from,p_until) RETURNING id INTO v_id;
 INSERT INTO qualification_issue(qualification_id,requested_by,approved_by,evidence)
 VALUES(v_id,p_requester,p_approver,p_evidence);
 RETURN QUERY SELECT 'issued'::text,v_id;
END $$;

-- Beperkende maatregel: geen tweede bevestiging nodig om onveilige toegang te stoppen.
CREATE FUNCTION qualification_revoke_confirmed(p_id uuid,p_actor uuid,p_reason text,p_password text)
RETURNS text LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_target uuid; v_q personnel_qualification%ROWTYPE; v_name text; v_login record; v_now timestamptz;
BEGIN
 IF current_user<>pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='fabriek.personnel_qualification'::regclass)) THEN
   RAISE EXCEPTION 'Kwalificatie-intrekking vereist database-eigenaar';
 END IF;
 SELECT user_id INTO v_target FROM personnel_qualification WHERE id=p_id;
 IF NOT FOUND OR p_actor IS NULL OR v_target=p_actor OR btrim(coalesce(p_reason,''))='' THEN
   RAISE EXCEPTION 'Onafhankelijke intrekking en reden vereist';
 END IF;
 PERFORM id FROM gebruiker WHERE id IN(v_target,p_actor) ORDER BY id FOR UPDATE;
 LOCK TABLE activity_qualification IN SHARE MODE;
 SELECT * INTO v_q FROM personnel_qualification WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR v_q.user_id IS DISTINCT FROM v_target OR v_q.revoked_at IS NOT NULL
   OR NOT qualification_is_operations(v_q.qualification_code) THEN
   RAISE EXCEPTION 'Geen intrekbare operationele kwalificatie';
 END IF;
 IF NOT authorization_permits(p_actor,'qualification.revoke',NULL,NULL,NULL) THEN
   RAISE EXCEPTION 'Geen inhoudelijke intrekkingsbevoegdheid';
 END IF;
 SELECT gebruikersnaam INTO v_name FROM gebruiker WHERE id=p_actor;
 SELECT * INTO v_login FROM inloggen(v_name,p_password,NULL);
 IF v_login.wacht_seconden IS NOT NULL THEN RETURN 'locked'; END IF;
 IF v_login.id IS DISTINCT FROM p_actor THEN RETURN 'denied'; END IF;
 v_now:=clock_timestamp();
 UPDATE personnel_qualification SET revoked_at=v_now WHERE id=p_id;
 INSERT INTO qualification_revocation(qualification_id,revoked_by,reason,revoked_at)
 VALUES(p_id,p_actor,p_reason,v_now);
 RETURN 'revoked';
END $$;

REVOKE ALL ON FUNCTION qualification_is_operations(text),
 qualification_issue_confirmed(uuid,text,timestamptz,timestamptz,uuid,uuid,text,text,text),
 qualification_revoke_confirmed(uuid,uuid,text,text) FROM PUBLIC;
