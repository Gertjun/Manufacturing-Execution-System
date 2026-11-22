-- Migratie 0027 (versie 0.46.0): notitie bij het einde van een stilstand (#31, D65).
-- Bij "Stilstand beëindigen" kan de operator kort opschrijven wat het was en wat er is gedaan.
-- Alleen een nieuwe kolom die leeg mag blijven: oudere invoerschermen sturen hem niet mee en blijven werken.
SET search_path = fabriek, public;

ALTER TABLE stilstand ADD COLUMN eind_notitie text
    CHECK (eind_notitie IS NULL OR (eind_notitie = btrim(eind_notitie) AND char_length(eind_notitie) BETWEEN 1 AND 500));

-- De notitie mag alleen samen met het einde worden ingevuld; daarna ligt de stilstand vast (zoals sinds 0008).
CREATE OR REPLACE FUNCTION bewaak_stilstand() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Een stilstand wordt niet verwijderd';
    END IF;
    IF OLD.eind_op IS NOT NULL THEN
        RAISE EXCEPTION 'Deze stilstand is al beëindigd';
    END IF;
    IF (NEW.processtap_id, NEW.oorzaak_id, NEW.begin_op, NEW.pc_id, NEW.operator_id, NEW.gemeld_door, NEW.toelichting)
       IS DISTINCT FROM (OLD.processtap_id, OLD.oorzaak_id, OLD.begin_op, OLD.pc_id, OLD.operator_id, OLD.gemeld_door, OLD.toelichting) THEN
        RAISE EXCEPTION 'Van een stilstand kan alleen het einde worden ingevuld';
    END IF;
    IF NEW.eind_notitie IS NOT NULL AND NEW.eind_op IS NULL THEN
        RAISE EXCEPTION 'Een notitie bij een stilstand hoort bij het einde';
    END IF;
    RETURN NEW;
END $$;

-- Elke functie werkt in schema fabriek (zoals in 0001).
DO $$
DECLARE f record;
BEGIN
    FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'fabriek' LOOP
        EXECUTE format('ALTER FUNCTION %s SET search_path = fabriek, public', f.sig);
    END LOOP;
END $$;
