-- Migratie 0026 (versie 0.42.0): "Iets melden" (#78, D62).
-- Gebruikers melden kort wat misgaat of beter kan; de beheerder handelt het af. Alleen een nieuwe tabel en
-- nieuwe functies: oudere invoerschermen merken er niets van.
SET search_path = fabriek, public;

CREATE TABLE terugmelding (
    id               uuid PRIMARY KEY,
    gemeld_op        timestamptz NOT NULL DEFAULT clock_timestamp(),
    gebruiker_id     uuid NOT NULL REFERENCES gebruiker(id),
    operator_id      uuid REFERENCES operator(id),
    pc_id            uuid REFERENCES pc(id),
    stapcode         text,
    scherm           text,
    tekst            text NOT NULL CHECK (length(btrim(tekst)) BETWEEN 3 AND 1000),
    status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'afgehandeld')),
    afgehandeld_door uuid REFERENCES gebruiker(id),
    afgehandeld_op   timestamptz,
    notitie          text,
    CHECK ((status = 'afgehandeld') = (afgehandeld_op IS NOT NULL))
);
CREATE INDEX terugmelding_open ON terugmelding (status, gemeld_op DESC);

CREATE FUNCTION meld_iets(p_id uuid, p_gebruiker uuid, p_operator uuid, p_pc uuid, p_stapcode text, p_scherm text, p_tekst text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF length(btrim(coalesce(p_tekst, ''))) < 3 THEN
        RAISE EXCEPTION 'Schrijf kort wat er is (minstens 3 tekens)';
    END IF;
    INSERT INTO terugmelding (id, gemeld_op, gebruiker_id, operator_id, pc_id, stapcode, scherm, tekst)
    VALUES (p_id, apparaat_moment(), p_gebruiker, p_operator, p_pc, nullif(btrim(p_stapcode), ''), nullif(btrim(p_scherm), ''), btrim(p_tekst))
    ON CONFLICT (id) DO NOTHING;
END $$;

CREATE FUNCTION handel_terugmelding_af(p_id uuid, p_gebruiker uuid, p_notitie text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    UPDATE terugmelding SET status = 'afgehandeld', afgehandeld_door = p_gebruiker, afgehandeld_op = clock_timestamp(),
                            notitie = nullif(btrim(p_notitie), '')
     WHERE id = p_id AND status = 'open';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Deze melding bestaat niet of is al afgehandeld';
    END IF;
END $$;

-- Elke functie werkt in schema fabriek (zoals in 0001).
DO $$
DECLARE f record;
BEGIN
    FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'fabriek' LOOP
        EXECUTE format('ALTER FUNCTION %s SET search_path = fabriek, public', f.sig);
    END LOOP;
END $$;
