-- Migratie 0014 (versie 0.22.2): oude inlogpogingen opruimen.
-- Inlogpogingen (sinds 0.21.0) worden 90 dagen bewaard. Het onderhoud (back-up op de server,
-- opstarten van de laptop) ruimt oudere op met deze functie; de applicatie zelf kan niets verwijderen.
SET search_path = fabriek, public;

CREATE FUNCTION ruim_inlogpogingen_op(p_dagen int DEFAULT 90) RETURNS int LANGUAGE plpgsql AS $$
DECLARE
    v_aantal int;
BEGIN
    IF p_dagen < 30 THEN
        RAISE EXCEPTION 'Inlogpogingen worden minstens 30 dagen bewaard';
    END IF;
    DELETE FROM inlogpoging WHERE op < clock_timestamp() - make_interval(days => p_dagen);
    GET DIAGNOSTICS v_aantal = ROW_COUNT;
    RETURN v_aantal;
END $$;
ALTER FUNCTION ruim_inlogpogingen_op(int) SET search_path = fabriek, public;
REVOKE EXECUTE ON FUNCTION ruim_inlogpogingen_op(int) FROM PUBLIC;
