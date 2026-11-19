-- Migratie 0012 (versie 0.20.1): vaste tijdzone en ploegen rond zomer- en wintertijd.
-- Ploegen, "vandaag" en weekindelingen volgden de tijdzone van de computer waarop PostgreSQL draait.
-- Op een server met UTC schoven de ploegen een of twee uur. Nu staat de tijdzone vast op die van de
-- fabriek. De opgeslagen tijden veranderen niet (die zijn altijd al met tijdzone bewaard).
SET search_path = fabriek, public;

-- De tijdzone van de fabriek. Op één plek, zodat hij later instelbaar kan worden.
CREATE FUNCTION fabriekstijdzone() RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'Europe/Amsterdam'::text $$;
ALTER FUNCTION fabriekstijdzone() SET search_path = fabriek, public;

-- Nieuwe verbindingen met deze database krijgen die tijdzone (de API zet hem ook per transactie).
DO $$ BEGIN
    EXECUTE format('ALTER DATABASE %I SET timezone = %L', current_database(), fabriek.fabriekstijdzone());
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'Tijdzone niet op de database gezet (geen eigenaar); de applicatie zet hem per transactie.';
END $$;

-- Welke ploeg werkt op moment p_t. Begin en eind zijn kloktijden in de fabriek: een nachtploeg
-- van 22:00 tot 06:00 duurt in de nacht van de wintertijd 9 uur en in de nacht van de zomertijd 7 uur.
CREATE OR REPLACE FUNCTION ploeg_van(p_t timestamptz)
RETURNS TABLE (ploeg_id uuid, code text, naam text, dag date, begin_op timestamptz, eind_op timestamptz)
LANGUAGE sql STABLE AS $$
    SELECT p.id, p.code, p.naam, d.dag, x.begin_op, x.eind_op
      FROM ploeg p
      CROSS JOIN LATERAL (VALUES ((p_t AT TIME ZONE fabriekstijdzone())::date),
                                 ((p_t AT TIME ZONE fabriekstijdzone())::date - 1)) d(dag)
      CROSS JOIN LATERAL (SELECT (d.dag + p.begint) AT TIME ZONE fabriekstijdzone() AS begin_op,
                                 ((d.dag + CASE WHEN p.eindigt > p.begint THEN 0 ELSE 1 END) + p.eindigt)
                                     AT TIME ZONE fabriekstijdzone() AS eind_op) x
     WHERE p.actief
       AND p_t >= x.begin_op
       AND p_t < x.eind_op
     ORDER BY x.begin_op DESC
     LIMIT 1
$$;
ALTER FUNCTION ploeg_van(timestamptz) SET search_path = fabriek, public;
