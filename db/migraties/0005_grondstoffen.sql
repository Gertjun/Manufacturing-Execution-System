-- Migratie 0005 (versie 0.11.0): grondstoffen per batch.
-- Welke grondstofpartij (partijnummer van de leverancier) is in welke stap van welke batch gebruikt.
-- Zo kun je van een lot terugzoeken naar de grondstoffen, en van een partij naar de batches en lots.
SET search_path = fabriek, public;

-- Grondstoffen (configuratie, door de beheerder beheerd).
CREATE TABLE grondstof (
    id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code     text NOT NULL UNIQUE CHECK (code ~ '^[A-Za-z0-9._-]{1,20}$'),
    naam     text NOT NULL,
    eenheid  text,
    actief   boolean NOT NULL DEFAULT true
);
CREATE TRIGGER grondstof_log BEFORE INSERT OR UPDATE OR DELETE ON grondstof
    FOR EACH ROW EXECUTE FUNCTION log_config();

-- In welke stap welke grondstof wordt ingevoerd, en of dat verplicht is.
CREATE TABLE stap_grondstof (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    processtap_id  uuid NOT NULL REFERENCES processtap(id),
    grondstof_id   uuid NOT NULL REFERENCES grondstof(id),
    verplicht      boolean NOT NULL DEFAULT true,
    actief         boolean NOT NULL DEFAULT true,
    UNIQUE (processtap_id, grondstof_id)
);
CREATE TRIGGER stap_grondstof_log BEFORE INSERT OR UPDATE OR DELETE ON stap_grondstof
    FOR EACH ROW EXECUTE FUNCTION log_config();

-- Gebruik: per registratie en grondstof één oorspronkelijke regel; correcties vervangen hem (zoals bij waarden).
CREATE TABLE grondstof_gebruik (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    stapregistratie_id  uuid NOT NULL REFERENCES stapregistratie(id),
    grondstof_id        uuid NOT NULL REFERENCES grondstof(id),
    partij              text NOT NULL CHECK (length(btrim(partij)) BETWEEN 1 AND 60),
    hoeveelheid         numeric CHECK (hoeveelheid > 0),
    vervangt_id         uuid UNIQUE REFERENCES grondstof_gebruik(id),
    correctie_reden     text,
    ingevoerd_door      uuid REFERENCES operator(id),
    gecorrigeerd_door   uuid REFERENCES gebruiker(id),
    ingevoerd_op        timestamptz NOT NULL DEFAULT now(),
    CHECK ((vervangt_id IS NULL) = (gecorrigeerd_door IS NULL)),
    CHECK (vervangt_id IS NULL OR length(trim(coalesce(correctie_reden,''))) > 0),
    CHECK (vervangt_id IS NOT NULL OR ingevoerd_door IS NOT NULL)
);
CREATE UNIQUE INDEX grondstof_gebruik_een_origineel ON grondstof_gebruik (stapregistratie_id, grondstof_id) WHERE vervangt_id IS NULL;
CREATE INDEX grondstof_gebruik_partij ON grondstof_gebruik (lower(partij));

CREATE FUNCTION verwerk_grondstof_gebruik() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_reg  stapregistratie%ROWTYPE;
    v_oud  grondstof_gebruik%ROWTYPE;
    v_rol  text;
BEGIN
    SELECT * INTO v_reg FROM stapregistratie WHERE id = NEW.stapregistratie_id;
    NEW.partij := btrim(NEW.partij);
    IF NEW.vervangt_id IS NULL THEN
        IF v_reg.status <> 'open' THEN
            RAISE EXCEPTION 'Stap is al afgerond; wijzigen kan alleen als correctie door een ploegleider';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM stap_grondstof x JOIN grondstof g ON g.id = x.grondstof_id
                        WHERE x.processtap_id = v_reg.processtap_id AND x.grondstof_id = NEW.grondstof_id AND x.actief AND g.actief) THEN
            RAISE EXCEPTION 'Deze grondstof hoort niet bij deze stap';
        END IF;
    ELSE
        SELECT * INTO v_oud FROM grondstof_gebruik WHERE id = NEW.vervangt_id;
        IF v_oud.stapregistratie_id <> NEW.stapregistratie_id OR v_oud.grondstof_id <> NEW.grondstof_id THEN
            RAISE EXCEPTION 'Een correctie hoort bij dezelfde registratie en grondstof';
        END IF;
        IF EXISTS (SELECT 1 FROM grondstof_gebruik WHERE vervangt_id = v_oud.id) THEN
            RAISE EXCEPTION 'Deze regel is al gecorrigeerd';
        END IF;
        SELECT rol INTO v_rol FROM gebruiker WHERE id = NEW.gecorrigeerd_door AND actief;
        IF v_rol IS NULL OR v_rol NOT IN ('ploegleider','beheerder') THEN
            RAISE EXCEPTION 'Alleen een ploegleider of beheerder kan corrigeren';
        END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER grondstof_gebruik_controle BEFORE INSERT ON grondstof_gebruik
    FOR EACH ROW EXECUTE FUNCTION verwerk_grondstof_gebruik();

CREATE FUNCTION grondstof_gebruik_onveranderlijk() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Grondstofregels worden niet gewijzigd of verwijderd; leg een correctie vast';
END $$;
CREATE TRIGGER grondstof_gebruik_vast BEFORE UPDATE OR DELETE ON grondstof_gebruik
    FOR EACH ROW EXECUTE FUNCTION grondstof_gebruik_onveranderlijk();

CREATE VIEW grondstof_gebruik_actueel AS
SELECT g.* FROM grondstof_gebruik g
WHERE NOT EXISTS (SELECT 1 FROM grondstof_gebruik c WHERE c.vervangt_id = g.id);

-- Afronden: ook alle verplichte grondstoffen van de stap moeten zijn ingevoerd.
CREATE OR REPLACE FUNCTION rond_stap_af(p_registratie uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_ontbreekt text;
    v_status    text;
BEGIN
    SELECT status INTO v_status FROM stapregistratie WHERE id = p_registratie FOR UPDATE;
    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Registratie bestaat niet';
    ELSIF v_status <> 'open' THEN
        RAISE EXCEPTION 'Deze stap is al afgerond of afgebroken';
    END IF;
    SELECT string_agg(x, ', ' ORDER BY n, v, x) INTO v_ontbreekt FROM (
        SELECT v.code AS x, 1 AS n, v.volgnummer AS v
          FROM stapregistratie r
          JOIN veld v ON v.processtap_id = r.processtap_id AND v.actief AND v.verplicht
         WHERE r.id = p_registratie
           AND NOT EXISTS (SELECT 1 FROM waarde w WHERE w.stapregistratie_id = r.id AND w.veld_id = v.id)
        UNION ALL
        SELECT 'grondstof ' || g.code, 2, 0
          FROM stapregistratie r
          JOIN stap_grondstof sg ON sg.processtap_id = r.processtap_id AND sg.actief AND sg.verplicht
          JOIN grondstof g ON g.id = sg.grondstof_id AND g.actief
         WHERE r.id = p_registratie
           AND NOT EXISTS (SELECT 1 FROM grondstof_gebruik u WHERE u.stapregistratie_id = r.id AND u.grondstof_id = g.id)
    ) o;
    IF v_ontbreekt IS NOT NULL THEN
        RAISE EXCEPTION 'Nog niet ingevuld: %', v_ontbreekt;
    END IF;
    UPDATE stapregistratie SET status = 'afgerond', afgerond_op = clock_timestamp()
     WHERE id = p_registratie AND status = 'open';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Registratie bestaat niet of is al afgerond';
    END IF;
END $$;

ALTER FUNCTION verwerk_grondstof_gebruik() SET search_path = fabriek, public;
ALTER FUNCTION grondstof_gebruik_onveranderlijk() SET search_path = fabriek, public;
ALTER FUNCTION rond_stap_af(uuid) SET search_path = fabriek, public;
