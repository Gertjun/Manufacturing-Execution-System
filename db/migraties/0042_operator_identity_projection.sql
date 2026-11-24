-- Migratie 0042: operatoridentiteit zonder wachtwoordhash.
SET search_path = fabriek, public;
CREATE OR REPLACE FUNCTION operator_van_account(p_gebruiker uuid) RETURNS uuid LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    v_g     record;
    v_id    uuid;
    v_naam  text;
    v_n     int := 1;
BEGIN
    SELECT gebruikersnaam, gedeeld, rol INTO v_g FROM gebruiker WHERE id = p_gebruiker AND actief;
    IF NOT FOUND OR v_g.gedeeld OR v_g.rol NOT IN ('operator', 'ploegleider', 'kwaliteit') THEN RETURN NULL; END IF;
    SELECT id INTO v_id FROM operator WHERE gebruiker_id = p_gebruiker;
    IF FOUND THEN RETURN v_id; END IF;
    -- Nog geen naam: maak er een met de gebruikersnaam (de beheerder kan hem later wijzigen).
    v_naam := v_g.gebruikersnaam;
    WHILE EXISTS (SELECT 1 FROM operator WHERE lower(naam) = lower(v_naam)) LOOP
        v_n := v_n + 1;
        v_naam := v_g.gebruikersnaam || ' (' || v_n || ')';
    END LOOP;
    INSERT INTO operator (naam, gebruiker_id) VALUES (v_naam, p_gebruiker) RETURNING id INTO v_id;
    RETURN v_id;
END $$;
ALTER FUNCTION operator_van_account(uuid) SET search_path = fabriek, public;
