-- Migratie 0076: expliciete functie-interface.
SET search_path = fabriek, public;

-- Geen impliciete PUBLIC-uitvoering voor de functies in deze installatie.
-- De rechteninstallatie kent de expliciete applicatie-interface daarna toe.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA fabriek FROM PUBLIC;
