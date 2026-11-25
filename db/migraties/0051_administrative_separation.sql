-- Migratie 0051: afzonderlijke technische en security-identiteiten (D89/D99).
SET search_path = fabriek, public;

CREATE OR REPLACE FUNCTION authorization_permits(p_user uuid, p_permission text, p_area text, p_product uuid, p_equipment text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = fabriek, public AS $$
    WITH grants AS (
      SELECT g.*, r.domain FROM authorization_grant g JOIN authorization_role r ON r.code = g.role_code
       WHERE g.user_id = p_user AND g.valid_from <= now()
         AND (g.valid_until IS NULL OR now() < g.valid_until) AND g.revoked_at IS NULL
    )
    SELECT EXISTS (SELECT 1 FROM gebruiker WHERE id = p_user AND actief AND NOT gedeeld AND NOT wachtwoord_wijzigen)
       AND NOT (EXISTS (SELECT 1 FROM grants WHERE domain IN ('technical','security'))
                AND EXISTS (SELECT 1 FROM grants WHERE domain NOT IN ('technical','security')))
       AND NOT (EXISTS (SELECT 1 FROM grants WHERE domain = 'technical')
                AND EXISTS (SELECT 1 FROM grants WHERE domain = 'security'))
       AND NOT (EXISTS (SELECT 1 FROM grants WHERE domain = 'display')
                AND EXISTS (SELECT 1 FROM grants WHERE domain <> 'display'))
       AND EXISTS (
         SELECT 1 FROM grants g JOIN authorization_role_permission rp ON rp.role_code = g.role_code
         JOIN authorization_permission p ON p.code = rp.permission_code AND p.domain = g.domain
         WHERE p.code = p_permission
           AND (g.area_code IS NULL OR g.area_code = p_area)
           AND (g.product_id IS NULL OR g.product_id = p_product)
           AND (g.equipment_code IS NULL OR g.equipment_code = p_equipment))
       AND NOT EXISTS (
         SELECT 1 FROM activity_qualification aq WHERE aq.permission_code = p_permission
           AND NOT EXISTS (SELECT 1 FROM personnel_qualification q WHERE q.user_id = p_user
             AND q.qualification_code = aq.qualification_code AND q.valid_from <= now()
             AND (q.valid_until IS NULL OR now() < q.valid_until) AND q.revoked_at IS NULL))
$$;

CREATE OR REPLACE FUNCTION authorization_decide(p_actor uuid, p_request uuid, p_approved boolean, p_reason text)
RETURNS uuid LANGUAGE plpgsql SET search_path = fabriek, public AS $$
DECLARE v authorization_request%ROWTYPE; v_grant uuid; v_domain text;
BEGIN
    -- Serialiseer besluiten voor hetzelfde doelaccount, ook uit verschillende aanvragen.
    SELECT * INTO v FROM authorization_request WHERE id=p_request FOR UPDATE;
    IF NOT FOUND OR p_actor IS NULL OR p_approved IS NULL OR
       p_actor = v.requested_by OR p_actor = v.user_id OR
       NOT authorization_permits(p_actor,'authorization.approve',NULL,NULL,NULL) THEN
        RAISE EXCEPTION 'Onafhankelijke bevoegde beoordelaar vereist';
    END IF;
    IF EXISTS (SELECT 1 FROM authorization_decision WHERE request_id=p_request) THEN
        RAISE EXCEPTION 'Aanvraag is al beoordeeld';
    END IF;
    PERFORM 1 FROM gebruiker WHERE id=v.user_id FOR UPDATE;
    IF p_approved THEN
        IF NOT authorization_permits(v.requested_by,'authorization.request',NULL,NULL,NULL) THEN
            RAISE EXCEPTION 'Aanvrager is niet meer bevoegd';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM gebruiker WHERE id=v.user_id AND actief AND NOT gedeeld) THEN
            RAISE EXCEPTION 'Ongeldig persoonlijk doelaccount';
        END IF;
        IF v.valid_until IS NOT NULL AND v.valid_until <= clock_timestamp() THEN
            RAISE EXCEPTION 'Geldigheid is verlopen';
        END IF;
        SELECT domain INTO v_domain FROM authorization_role WHERE code=v.role_code;
        IF EXISTS (
            SELECT 1 FROM authorization_grant g JOIN authorization_role r ON r.code=g.role_code
            WHERE g.user_id=v.user_id AND g.revoked_at IS NULL
              AND tstzrange(g.valid_from,g.valid_until,'[)') && tstzrange(v.valid_from,v.valid_until,'[)')
              AND ((r.domain IN ('technical','security')) <> (v_domain IN ('technical','security'))
                OR (r.domain='display') <> (v_domain='display')
                OR (r.domain IN ('technical','security') AND v_domain IN ('technical','security') AND r.domain <> v_domain))
        ) THEN RAISE EXCEPTION 'Functiescheiding verhindert toekenning'; END IF;
        INSERT INTO authorization_grant (user_id,role_code,area_code,product_id,equipment_code,valid_from,valid_until)
        VALUES (v.user_id,v.role_code,v.area_code,v.product_id,v.equipment_code,v.valid_from,v.valid_until)
        RETURNING id INTO v_grant;
    END IF;
    INSERT INTO authorization_decision (request_id,decided_by,approved,reason,grant_id)
    VALUES (v.id,p_actor,p_approved,p_reason,v_grant);
    RETURN v_grant;
END $$;
