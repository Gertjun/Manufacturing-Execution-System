-- Migratie 0038: onafhankelijke beoordeling van roltoekenning (D89 P01-P05).
-- Uitbreidingsfase: uitsluitend database-eigenaar; geen toegang voor de applicatie.
SET search_path = fabriek, public;

-- Vastgelegde aanvraag met exacte inhoud en onafhankelijke beoordelaar.
CREATE TABLE authorization_request (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    requested_by uuid NOT NULL REFERENCES gebruiker(id),
    user_id uuid NOT NULL REFERENCES gebruiker(id),
    role_code text NOT NULL REFERENCES authorization_role(code),
    area_code text CHECK (btrim(area_code) <> ''),
    product_id uuid REFERENCES product(id),
    equipment_code text CHECK (btrim(equipment_code) <> ''),
    valid_from timestamptz NOT NULL,
    valid_until timestamptz CHECK (valid_until > valid_from),
    reason text NOT NULL CHECK (btrim(reason) <> ''),
    requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (requested_by <> user_id)
);

-- Een besluit per aanvraag; inhoud blijft in de oorspronkelijke aanvraag.
CREATE TABLE authorization_decision (
    request_id uuid PRIMARY KEY REFERENCES authorization_request(id),
    decided_by uuid NOT NULL REFERENCES gebruiker(id),
    approved boolean NOT NULL,
    reason text NOT NULL CHECK (btrim(reason) <> ''),
    decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    grant_id uuid UNIQUE REFERENCES authorization_grant(id),
    CHECK (approved = (grant_id IS NOT NULL))
);

-- Deze technische permissies worden niet automatisch aan bestaande accounts toegekend.
INSERT INTO authorization_permission (code, domain)
VALUES ('authorization.request','security'), ('authorization.approve','security');

-- De eigenaar moet deze functies via een gecontroleerd kanaal aanroepen.
-- Geen SECURITY DEFINER en geen vertrouwen in een vrij opgegeven actor vanuit de app.
CREATE FUNCTION authorization_submit(p_actor uuid, p_user uuid, p_role text,
    p_area text, p_product uuid, p_equipment text, p_from timestamptz,
    p_until timestamptz, p_reason text) RETURNS uuid
LANGUAGE plpgsql SET search_path = fabriek, public AS $$
DECLARE v_id uuid;
BEGIN
    IF p_actor IS NULL OR p_user IS NULL OR p_actor = p_user OR
       NOT authorization_permits(p_actor,'authorization.request',NULL,NULL,NULL) THEN
        RAISE EXCEPTION 'Geen bevoegdheid voor aanvraag';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM gebruiker WHERE id=p_user AND actief AND NOT gedeeld) THEN
        RAISE EXCEPTION 'Ongeldig persoonlijk doelaccount';
    END IF;
    IF p_until IS NOT NULL AND p_until <= clock_timestamp() THEN
        RAISE EXCEPTION 'Geldigheid is verlopen';
    END IF;
    INSERT INTO authorization_request (requested_by,user_id,role_code,area_code,product_id,equipment_code,valid_from,valid_until,reason)
    VALUES (p_actor,p_user,p_role,p_area,p_product,p_equipment,p_from,p_until,p_reason)
    RETURNING id INTO v_id;
    RETURN v_id;
END $$;

CREATE FUNCTION authorization_decide(p_actor uuid, p_request uuid, p_approved boolean, p_reason text)
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
                OR (r.domain='display') <> (v_domain='display'))
        ) THEN RAISE EXCEPTION 'Functiescheiding verhindert toekenning'; END IF;
        INSERT INTO authorization_grant (user_id,role_code,area_code,product_id,equipment_code,valid_from,valid_until)
        VALUES (v.user_id,v.role_code,v.area_code,v.product_id,v.equipment_code,v.valid_from,v.valid_until)
        RETURNING id INTO v_grant;
    END IF;
    INSERT INTO authorization_decision (request_id,decided_by,approved,reason,grant_id)
    VALUES (v.id,p_actor,p_approved,p_reason,v_grant);
    RETURN v_grant;
END $$;

REVOKE ALL ON authorization_request, authorization_decision FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION authorization_submit(uuid,uuid,text,text,uuid,text,timestamptz,timestamptz,text),
    authorization_decide(uuid,uuid,boolean,text) FROM PUBLIC;
