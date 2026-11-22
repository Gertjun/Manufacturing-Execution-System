-- Migratie 0028 (versie 0.47.0): pilotoverzicht (#77, D66).
-- Een nieuwe tabel voor geweigerde invoer en twee instellingen. Niets bestaands verandert:
-- oudere invoerschermen merken er niets van.
SET search_path = fabriek, public;

-- Geweigerde invoer van een pc (#77, D66): de server legt vast wat hij weigerde, zodat het pilotoverzicht
-- kan laten zien wat er misging. Vastgelegd door de API buiten de transactie van de invoer zelf.
CREATE TABLE geweigerde_invoer (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    op            timestamptz NOT NULL DEFAULT clock_timestamp(),
    pc_id         uuid REFERENCES pc(id),
    gebruiker_id  uuid REFERENCES gebruiker(id),
    operator_id   uuid REFERENCES operator(id),
    pad           text NOT NULL CHECK (char_length(pad) BETWEEN 1 AND 200),
    status        int  NOT NULL CHECK (status BETWEEN 400 AND 599),
    fout          text CHECK (char_length(fout) <= 500),
    stapcode      text CHECK (char_length(stapcode) <= 20),
    batchnummer   text CHECK (char_length(batchnummer) <= 40)
);
CREATE INDEX geweigerde_invoer_op ON geweigerde_invoer (op);

CREATE FUNCTION geweigerde_invoer_vast() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Geweigerde invoer wordt niet gewijzigd';
END $$;
CREATE TRIGGER geweigerde_invoer_vast BEFORE UPDATE ON geweigerde_invoer
    FOR EACH ROW EXECUTE FUNCTION geweigerde_invoer_vast();

-- Vastleggen; onbekende pc, gebruiker of operator blijft leeg in plaats van een fout te geven,
-- en te lange teksten worden ingekort: het vastleggen zelf mag nooit mislukken.
CREATE FUNCTION leg_weigering_vast(p_pc uuid, p_gebruiker uuid, p_operator uuid, p_pad text, p_status int,
                                   p_fout text, p_stapcode text, p_batchnummer text) RETURNS void LANGUAGE sql AS $$
    INSERT INTO geweigerde_invoer (pc_id, gebruiker_id, operator_id, pad, status, fout, stapcode, batchnummer)
    VALUES ((SELECT id FROM pc WHERE id = p_pc), (SELECT id FROM gebruiker WHERE id = p_gebruiker),
            (SELECT id FROM operator WHERE id = p_operator), left(coalesce(nullif(p_pad, ''), '?'), 200),
            least(greatest(p_status, 400), 599), left(p_fout, 500), left(nullif(btrim(p_stapcode), ''), 20),
            left(nullif(btrim(p_batchnummer), ''), 40));
$$;

-- 90 dagen bewaren, zoals de inlogpogingen; het onderhoud roept dit aan (back-up, opstarten van de laptop).
CREATE FUNCTION ruim_weigeringen_op(p_dagen int DEFAULT 90) RETURNS int LANGUAGE plpgsql AS $$
DECLARE
    v_aantal int;
BEGIN
    IF p_dagen < 30 THEN
        RAISE EXCEPTION 'Geweigerde invoer wordt minstens 30 dagen bewaard';
    END IF;
    DELETE FROM geweigerde_invoer WHERE op < clock_timestamp() - make_interval(days => p_dagen);
    GET DIAGNOSTICS v_aantal = ROW_COUNT;
    RETURN v_aantal;
END $$;
REVOKE EXECUTE ON FUNCTION ruim_weigeringen_op(int) FROM PUBLIC;

-- Instellingen van het pilotoverzicht: de startdatum van de pilot en vanaf hoeveel minuten invoer "te laat" binnenkomt.
ALTER TABLE instelling ADD CONSTRAINT instelling_pilot CHECK (
    (sleutel <> 'pilot_start' OR waarde = '' OR waarde ~ '^\d{4}-\d{2}-\d{2}$')
    AND (sleutel <> 'te_laat_minuten' OR (waarde ~ '^\d{1,3}$' AND waarde::int BETWEEN 1 AND 720)));

-- Elke functie werkt in schema fabriek (zoals in 0001).
DO $$
DECLARE f record;
BEGIN
    FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'fabriek' LOOP
        EXECUTE format('ALTER FUNCTION %s SET search_path = fabriek, public', f.sig);
    END LOOP;
END $$;
