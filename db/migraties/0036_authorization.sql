-- Migratie 0036: uitbreidingsmodel autorisaties en kwalificaties (D89 P01–P05, M08).
-- Nog geen omschakeling van bestaande routes en geen automatische nieuwe rechten.
SET search_path = fabriek, public;

-- MES-rollen met gescheiden verantwoordelijkheidsdomeinen.
CREATE TABLE authorization_role (
    code text PRIMARY KEY CHECK (btrim(code) <> ''),
    domain text NOT NULL CHECK (domain IN ('technical','security','operations','quality','engineering','maintenance','analysis','display'))
);

-- Concrete bevoegdheden binnen een domein.
CREATE TABLE authorization_permission (
    code text PRIMARY KEY CHECK (btrim(code) <> ''),
    domain text NOT NULL CHECK (domain IN ('technical','security','operations','quality','engineering','maintenance','analysis','display'))
);

-- Koppeling tussen rollen en concrete bevoegdheden.
CREATE TABLE authorization_role_permission (
    role_code text REFERENCES authorization_role(code),
    permission_code text REFERENCES authorization_permission(code),
    PRIMARY KEY (role_code, permission_code)
);

-- Persoonlijke roltoekenning met geldigheid en begrensde scope.
CREATE TABLE authorization_grant (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES gebruiker(id),
    role_code text NOT NULL REFERENCES authorization_role(code),
    area_code text CHECK (btrim(area_code) <> ''),
    product_id uuid REFERENCES product(id),
    equipment_code text CHECK (btrim(equipment_code) <> ''),
    valid_from timestamptz NOT NULL DEFAULT now(),
    valid_until timestamptz CHECK (valid_until > valid_from),
    revoked_at timestamptz
);

-- Definitie van een personeelskwalificatie.
CREATE TABLE qualification (
    code text PRIMARY KEY CHECK (btrim(code) <> ''),
    description text NOT NULL CHECK (btrim(description) <> '')
);

-- Persoonlijke kwalificatie met geldigheid en intrekking.
CREATE TABLE personnel_qualification (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES gebruiker(id),
    qualification_code text NOT NULL REFERENCES qualification(code),
    valid_from timestamptz NOT NULL DEFAULT now(),
    valid_until timestamptz CHECK (valid_until > valid_from),
    revoked_at timestamptz
);

-- Verplichte kwalificatie voor een concrete activiteit.
CREATE TABLE activity_qualification (
    permission_code text REFERENCES authorization_permission(code),
    qualification_code text REFERENCES qualification(code),
    PRIMARY KEY (permission_code, qualification_code)
);

-- Momentopname van de oude rol bij migratie, zonder extra rechten.
CREATE TABLE authorization_legacy_snapshot (
    user_id uuid PRIMARY KEY REFERENCES gebruiker(id),
    legacy_role text NOT NULL,
    captured_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO authorization_legacy_snapshot (user_id, legacy_role)
SELECT id, rol FROM gebruiker;

CREATE INDEX authorization_grant_user ON authorization_grant(user_id);
CREATE INDEX personnel_qualification_user ON personnel_qualification(user_id);

-- Alleen vertrouwde servercontext; NULL is geen match voor een begrensde scope.
-- Dezelfde grant moet de permission en alle scopevoorwaarden bevatten.
CREATE FUNCTION authorization_permits(p_user uuid, p_permission text, p_area text, p_product uuid, p_equipment text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = fabriek, public AS $$
    WITH grants AS (
      SELECT g.*, r.domain FROM authorization_grant g JOIN authorization_role r ON r.code = g.role_code
       WHERE g.user_id = p_user AND g.valid_from <= now()
         AND (g.valid_until IS NULL OR now() < g.valid_until) AND g.revoked_at IS NULL
    )
    SELECT EXISTS (SELECT 1 FROM gebruiker WHERE id = p_user AND actief AND NOT gedeeld AND NOT wachtwoord_wijzigen)
       AND NOT (EXISTS (SELECT 1 FROM grants WHERE domain IN ('technical','security'))
                AND EXISTS (SELECT 1 FROM grants WHERE domain NOT IN ('technical','security')))
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
