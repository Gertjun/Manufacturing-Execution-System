-- Migratie 0025 (versie 0.41.0): accounts in één keer aanmaken met een tijdelijk wachtwoord (#76, D61).
-- Een wachtwoord dat de beheerder kiest, is tijdelijk: bij de volgende inlog kiest de gebruiker eerst een eigen
-- wachtwoord. Bestaande accounts houden hun wachtwoord zoals het is.
SET search_path = fabriek, public;

ALTER TABLE gebruiker ADD COLUMN wachtwoord_wijzigen boolean NOT NULL DEFAULT false;

-- Eigen wachtwoord wijzigen (sinds migratie 0025, #76, D61): met het huidige wachtwoord, minstens 8 tekens,
-- en niet gelijk aan het huidige. Daarna is het wachtwoord niet meer tijdelijk.
CREATE FUNCTION wijzig_eigen_wachtwoord(p_gebruiker uuid, p_huidig text, p_nieuw text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM gebruiker WHERE id = p_gebruiker AND actief
                      AND wachtwoord_hash = public.crypt(p_huidig, wachtwoord_hash)) THEN
        RAISE EXCEPTION 'Het huidige wachtwoord klopt niet';
    END IF;
    IF length(coalesce(p_nieuw, '')) < 8 THEN
        RAISE EXCEPTION 'Het nieuwe wachtwoord moet minstens 8 tekens hebben';
    END IF;
    IF p_nieuw = p_huidig THEN
        RAISE EXCEPTION 'Kies een ander wachtwoord dan het tijdelijke';
    END IF;
    UPDATE gebruiker SET wachtwoord_hash = wachtwoord_hash(p_nieuw), wachtwoord_wijzigen = false WHERE id = p_gebruiker;
END $$;

-- Elke functie werkt in schema fabriek (zoals in 0001).
DO $$
DECLARE f record;
BEGIN
    FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'fabriek' LOOP
        EXECUTE format('ALTER FUNCTION %s SET search_path = fabriek, public', f.sig);
    END LOOP;
END $$;
