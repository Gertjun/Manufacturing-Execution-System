-- Migratie 0087: oude beheerdersrol is geen beschikbaarheidsvoorwaarde (D101).
SET search_path = fabriek, public;

-- Geen legacy-rol als voorwaarde voor accountdeactivering. De afzonderlijke
-- MES-guards voor kritieke identiteiten, grants en sessies blijven gelden.
CREATE OR REPLACE FUNCTION bewaak_beheerder() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
    IF NEW.gebruikersnaam <> OLD.gebruikersnaam THEN
        RAISE EXCEPTION 'Een gebruikersnaam verandert niet; maak een nieuw account';
    END IF;
    RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION bewaak_beheerder() FROM PUBLIC;
