-- Migratie 0011 (versie 0.20.0): tijdstip van het apparaat.
-- Een stap, meetwaarde of grondstof die offline is ingevoerd, krijgt het moment van invoer op de pc
-- in plaats van het moment van versturen. De API zet dat moment in de instelling `fabriek.moment`
-- (alleen binnen de transactie). De database begrenst het: niet in de toekomst, niet ouder dan
-- 7 dagen, en niet vóór de vorige stap of het starten van de stap. Het moment van aankomst op de
-- server wordt apart bewaard. Zonder `fabriek.moment` (oudere invoerschermen, tools) blijft alles
-- zoals het was.
SET search_path = fabriek, public;

-- Aankomst op de server. Bestaande regels blijven leeg (onbekend); nieuwe krijgen de servertijd.
ALTER TABLE stapregistratie ADD COLUMN gestart_ontvangen_op timestamptz;
ALTER TABLE stapregistratie ALTER COLUMN gestart_ontvangen_op SET DEFAULT clock_timestamp();
ALTER TABLE stapregistratie ADD COLUMN afgerond_ontvangen_op timestamptz;
ALTER TABLE waarde ADD COLUMN ontvangen_op timestamptz;
ALTER TABLE waarde ALTER COLUMN ontvangen_op SET DEFAULT clock_timestamp();
ALTER TABLE grondstof_gebruik ADD COLUMN ontvangen_op timestamptz;
ALTER TABLE grondstof_gebruik ALTER COLUMN ontvangen_op SET DEFAULT clock_timestamp();

CREATE OR REPLACE VIEW waarde_actueel AS
SELECT w.* FROM waarde w
WHERE NOT EXISTS (SELECT 1 FROM waarde c WHERE c.vervangt_waarde_id = w.id);

CREATE OR REPLACE VIEW grondstof_gebruik_actueel AS
SELECT g.* FROM grondstof_gebruik g
WHERE NOT EXISTS (SELECT 1 FROM grondstof_gebruik c WHERE c.vervangt_id = g.id);

-- Het moment van het apparaat, begrensd. Zonder moment: de servertijd.
CREATE FUNCTION apparaat_moment(p_ondergrens timestamptz DEFAULT NULL) RETURNS timestamptz LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    v_nu    timestamptz := clock_timestamp();
    v_tekst text := nullif(current_setting('fabriek.moment', true), '');
    v_t     timestamptz;
BEGIN
    IF v_tekst IS NULL THEN
        RETURN v_nu;
    END IF;
    BEGIN
        v_t := v_tekst::timestamptz;
    EXCEPTION WHEN others THEN
        RETURN v_nu;
    END;
    -- Klok vooruit, of zo lang offline dat het moment niet meer te vertrouwen is: servertijd.
    IF v_t > v_nu OR v_t < v_nu - interval '7 days' THEN
        RETURN v_nu;
    END IF;
    IF p_ondergrens IS NOT NULL AND v_t < p_ondergrens THEN
        v_t := least(p_ondergrens, v_nu);
    END IF;
    RETURN v_t;
END $$;

CREATE FUNCTION heeft_apparaat_moment() RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('fabriek.moment', true), '') IS NOT NULL
$$;

-- Starten: niet eerder dan de laatst afgeronde stap van dezelfde batch of hetzelfde lot
-- (bij een lot ook de stappen van zijn batches).
CREATE FUNCTION zet_moment_start() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_vorige timestamptz;
BEGIN
    IF heeft_apparaat_moment() THEN
        SELECT max(r.afgerond_op) INTO v_vorige FROM stapregistratie r
         WHERE (NEW.batch_id IS NOT NULL AND r.batch_id = NEW.batch_id)
            OR (NEW.lot_id IS NOT NULL AND (r.lot_id = NEW.lot_id
                                            OR r.batch_id IN (SELECT b.id FROM batch b WHERE b.lot_id = NEW.lot_id)));
        NEW.gestart_op := apparaat_moment(v_vorige);
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER stapregistratie_0_moment BEFORE INSERT ON stapregistratie
    FOR EACH ROW EXECUTE FUNCTION zet_moment_start();

-- Afronden of afbreken: aankomst op de server vastleggen.
CREATE FUNCTION zet_ontvangen_afronden() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.afgerond_op IS NOT NULL AND OLD.afgerond_op IS NULL THEN
        NEW.afgerond_ontvangen_op := clock_timestamp();
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER stapregistratie_ontvangen BEFORE UPDATE ON stapregistratie
    FOR EACH ROW EXECUTE FUNCTION zet_ontvangen_afronden();

-- Meetwaarde of grondstof: niet eerder dan het starten van de stap.
CREATE FUNCTION zet_moment_invoer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF heeft_apparaat_moment() THEN
        NEW.ingevoerd_op := apparaat_moment((SELECT r.gestart_op FROM stapregistratie r WHERE r.id = NEW.stapregistratie_id));
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER waarde_0_moment BEFORE INSERT ON waarde
    FOR EACH ROW EXECUTE FUNCTION zet_moment_invoer();
CREATE TRIGGER grondstof_gebruik_0_moment BEFORE INSERT ON grondstof_gebruik
    FOR EACH ROW EXECUTE FUNCTION zet_moment_invoer();

-- Afronden met het moment van het apparaat (niet vóór het starten).
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
    UPDATE stapregistratie SET status = 'afgerond', afgerond_op = apparaat_moment(gestart_op)
     WHERE id = p_registratie AND status = 'open';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Registratie bestaat niet of is al afgerond';
    END IF;
END $$;

ALTER FUNCTION apparaat_moment(timestamptz) SET search_path = fabriek, public;
ALTER FUNCTION heeft_apparaat_moment() SET search_path = fabriek, public;
ALTER FUNCTION zet_moment_start() SET search_path = fabriek, public;
ALTER FUNCTION zet_ontvangen_afronden() SET search_path = fabriek, public;
ALTER FUNCTION zet_moment_invoer() SET search_path = fabriek, public;
ALTER FUNCTION rond_stap_af(uuid) SET search_path = fabriek, public;
