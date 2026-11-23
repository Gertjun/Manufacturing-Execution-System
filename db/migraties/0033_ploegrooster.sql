-- Migratie 0033 (versie 0.53.0): ploegen A tot en met E in twee divisies, met een rooster (#86, D76).
-- De bestaande tabel ploeg blijft de diensten bevatten (ochtend, middag, nacht); in de schermen heten die nu
-- "dienst". Nieuw: het roosterpatroon en de ploegen met de startdag van hun cyclus. Oudere invoerschermen: niets nodig.
SET search_path = fabriek, public;

-- In de schermen heten de tijdvakken nu diensten; de fictieve namen gaan mee.
UPDATE ploeg SET naam = replace(naam, 'ploeg', 'dienst') WHERE naam IN ('Ochtendploeg', 'Middagploeg', 'Nachtploeg');

-- Ploegen en rooster (sinds 0033, #86, D76). De tabel ploeg bevat de diensten (ochtend, middag, nacht: begin- en
-- eindtijd); de naam is gebleven omdat de API en oudere invoerschermen hem zo kennen. De ploegen zelf (A tot en
-- met E, per divisie) staan in rooster_ploeg. Elke ploeg volgt hetzelfde roosterpatroon (een rij dienstcodes,
-- '-' = vrij), vanaf de eigen startdag van zijn cyclus. Zo zie je per dag en dienst welke ploegen werken.
CREATE TABLE rooster (
    id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    enkel    boolean NOT NULL DEFAULT true UNIQUE CHECK (enkel),   -- er is maar één rooster
    patroon  text[] NOT NULL CHECK (cardinality(patroon) BETWEEN 1 AND 56)
);
CREATE TRIGGER rooster_log BEFORE INSERT OR UPDATE OR DELETE ON rooster
    FOR EACH ROW EXECUTE FUNCTION log_config();

CREATE FUNCTION controleer_rooster() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_fout text;
BEGIN
    SELECT string_agg(DISTINCT x, ', ') INTO v_fout
      FROM unnest(NEW.patroon) x
     WHERE x <> '-' AND NOT EXISTS (SELECT 1 FROM ploeg p WHERE p.code = x);
    IF v_fout IS NOT NULL THEN
        RAISE EXCEPTION 'Onbekende dienst in het rooster: % (gebruik de codes van de diensten, of - voor vrij)', v_fout;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM unnest(NEW.patroon) x WHERE x <> '-') THEN
        RAISE EXCEPTION 'Een rooster heeft minstens één dienst';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER rooster_controle BEFORE INSERT OR UPDATE ON rooster
    FOR EACH ROW EXECUTE FUNCTION controleer_rooster();

CREATE TABLE rooster_ploeg (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    letter        text NOT NULL CHECK (letter ~ '^[A-Z]$'),
    divisie       int  NOT NULL CHECK (divisie BETWEEN 1 AND 9),
    code          text GENERATED ALWAYS AS (letter || divisie::text) STORED UNIQUE,
    cyclus_start  date NOT NULL,       -- dag waarop deze ploeg de eerste dag van het patroon draait
    actief        boolean NOT NULL DEFAULT true
);
CREATE TRIGGER rooster_ploeg_log BEFORE INSERT OR UPDATE OR DELETE ON rooster_ploeg
    FOR EACH ROW EXECUTE FUNCTION log_config();

-- Welke ploegen op een dag welke dienst hebben (alleen actieve ploegen; vrije dagen niet).
CREATE FUNCTION rooster_op(p_dag date)
RETURNS TABLE (code text, letter text, divisie int, dienst text)
LANGUAGE sql STABLE AS $$
    SELECT rp.code, rp.letter, rp.divisie, r.patroon[1 + (((p_dag - rp.cyclus_start) % n.n) + n.n) % n.n]
      FROM rooster r
      CROSS JOIN LATERAL (SELECT cardinality(r.patroon) AS n) n
      JOIN rooster_ploeg rp ON rp.actief
     WHERE r.patroon[1 + (((p_dag - rp.cyclus_start) % n.n) + n.n) % n.n] <> '-'
     ORDER BY rp.divisie, rp.letter
$$;

-- De ploegen (codes, zoals A1 en A2) die een dienst draaien op een dag.
CREATE FUNCTION ploegen_in_dienst(p_dag date, p_dienst text) RETURNS text[]
LANGUAGE sql STABLE AS $$
    SELECT coalesce(array_agg(code ORDER BY divisie, letter), '{}') FROM rooster_op(p_dag) WHERE dienst = p_dienst
$$;

-- Standaardrooster voor bestaande installaties: elke dienst twee dagen (in de volgorde van de begintijden),
-- dan vier dagen vrij; ploegen A tot en met E in divisie 1 en 2, elk twee dagen na de vorige (D76).
INSERT INTO rooster (patroon)
SELECT array_agg(c ORDER BY o) || ARRAY['-','-','-','-']
  FROM (SELECT p.code AS c, row_number() OVER (ORDER BY p.begint) * 10 + k AS o
          FROM ploeg p CROSS JOIN generate_series(1, 2) k WHERE p.actief) x
HAVING count(*) > 0;
INSERT INTO rooster_ploeg (letter, divisie, cyclus_start)
SELECT l, d, date '2026-01-05' + 2 * (ascii(l) - ascii('A'))
  FROM unnest(ARRAY['A','B','C','D','E']) l CROSS JOIN generate_series(1, 2) d;

DO $$
DECLARE f record;
BEGIN
    FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'fabriek' LOOP
        EXECUTE format('ALTER FUNCTION %s SET search_path = fabriek, public', f.sig);
    END LOOP;
END $$;
