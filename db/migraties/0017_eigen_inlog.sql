-- Migratie 0017 (versie 0.27.0): eigen inlog per persoon (D53).
-- Bestaande operatoraccounts waren gedeeld (D6): ze krijgen het kenmerk gedeeld en werken zoals voorheen
-- (naam kiezen) tot de beheerder ze uitzet. Ploegleiders krijgen bij hun eerstvolgende inlog een eigen naam.
SET search_path = fabriek, public;
ALTER TABLE gebruiker ADD COLUMN gedeeld boolean NOT NULL DEFAULT false;
ALTER TABLE operator ADD COLUMN gebruiker_id uuid UNIQUE REFERENCES gebruiker(id);
SELECT set_config('fabriek.gebruiker', 'migratie 0017', true);
UPDATE gebruiker SET gedeeld = true WHERE rol = 'operator';

-- Eigen inlog per persoon (sinds migratie 0017, D53). Een invoeraccount (operator of ploegleider) is
-- gekoppeld aan één naam uit de namenlijst; die naam komt bij alles wat het account invoert.
-- Een gedeeld account (het oude operatoraccount, D6) kiest nog een naam tot de beheerder het uitzet.
CREATE FUNCTION operator_van_account(p_gebruiker uuid) RETURNS uuid LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    v_g     gebruiker%ROWTYPE;
    v_id    uuid;
    v_naam  text;
    v_n     int := 1;
BEGIN
    SELECT * INTO v_g FROM gebruiker WHERE id = p_gebruiker AND actief;
    IF NOT FOUND OR v_g.gedeeld OR v_g.rol NOT IN ('operator', 'ploegleider') THEN RETURN NULL; END IF;
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

-- Mag dit account invoer versturen op naam van deze operator? (D53)
-- Ja als het de eigen naam is; als het account gedeeld is (naam kiezen, zoals voorheen); of als het
-- invoer uit de wachtrij van deze pc is: de persoon van die naam logde de laatste 7 dagen op deze pc in,
-- of het is een naam zonder account en er was de laatste 7 dagen een gedeeld account op deze pc.
CREATE FUNCTION mag_invoeren_namens(p_gebruiker uuid, p_operator uuid, p_pc uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM gebruiker g WHERE g.id = p_gebruiker AND g.gedeeld)
        OR EXISTS (SELECT 1 FROM operator o WHERE o.id = p_operator AND o.gebruiker_id = p_gebruiker)
        OR EXISTS (SELECT 1 FROM operator o
                     JOIN gebruiker g ON g.id = o.gebruiker_id
                     JOIN inlogpoging p ON lower(p.gebruikersnaam) = lower(g.gebruikersnaam)
                     JOIN pc ON pc.naam = p.pc
                    WHERE o.id = p_operator AND pc.id = p_pc AND p.uitkomst = 'gelukt'
                      AND p.op > clock_timestamp() - interval '7 days')
        OR EXISTS (SELECT 1 FROM operator o
                    WHERE o.id = p_operator AND o.gebruiker_id IS NULL
                      AND EXISTS (SELECT 1 FROM inlogpoging p
                                    JOIN gebruiker g ON lower(g.gebruikersnaam) = lower(p.gebruikersnaam) AND g.gedeeld
                                    JOIN pc ON pc.naam = p.pc
                                   WHERE pc.id = p_pc AND p.uitkomst = 'gelukt'
                                     AND p.op > clock_timestamp() - interval '7 days'))
$$;
ALTER FUNCTION operator_van_account(uuid) SET search_path = fabriek, public;
ALTER FUNCTION mag_invoeren_namens(uuid, uuid, uuid) SET search_path = fabriek, public;
