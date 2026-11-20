-- Rechten voor de applicatie (versie 0.6.0).
-- De applicatie logt in als batchgui_app: gegevens lezen en invoeren mag, de structuur
-- van de database wijzigen niet. Migraties, back-ups en herstel draaien als beheerder.
-- Dit bestand kan steeds opnieuw worden uitgevoerd (tools/migreer.mjs doet dat na elke migratie).
-- Het wachtwoord zet IT apart:  ALTER ROLE batchgui_app PASSWORD '...';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'batchgui_app') THEN
    CREATE ROLE batchgui_app LOGIN;
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO batchgui_app', current_database());
END $$;

GRANT USAGE ON SCHEMA fabriek TO batchgui_app;

-- Lezen en invoeren op alle tabellen en views; nooit tabellen leegmaken of wijzigen.
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA fabriek TO batchgui_app;
-- Verwijderen alleen waar de regels dat toestaan: de stapkoppeling van een pc.
REVOKE DELETE ON ALL TABLES IN SCHEMA fabriek FROM batchgui_app;
GRANT DELETE ON fabriek.pc_stap TO batchgui_app;
-- Planning mag de planner herschikken: de dagplanning per stap en de batches in een open lotvoorstel.
-- (Voorwaardelijk: een teruggezette oudere back-up heeft deze tabellen nog niet tot migreer.mjs draait.)
DO $$
BEGIN
  IF to_regclass('fabriek.stapplanning') IS NOT NULL THEN
    GRANT DELETE ON fabriek.stapplanning, fabriek.lot_voorstel_batch TO batchgui_app;
  END IF;
END $$;
-- Een route vervangen (sinds 0.28.0) en grenzen per product weghalen (sinds 0.29.0).
DO $$
BEGIN
  IF to_regclass('fabriek.product_stap') IS NOT NULL THEN
    GRANT DELETE ON fabriek.product_stap TO batchgui_app;
  END IF;
  IF to_regclass('fabriek.veld_product') IS NOT NULL THEN
    GRANT DELETE ON fabriek.veld_product TO batchgui_app;   -- terug naar de grenzen van het veld (sinds 0.29.0)
  END IF;
END $$;
-- Inlogpogingen alleen vastleggen, niet wijzigen.
DO $$
BEGIN
  IF to_regclass('fabriek.inlogpoging') IS NOT NULL THEN
    REVOKE UPDATE ON fabriek.inlogpoging FROM batchgui_app;
  END IF;
END $$;
-- Het onderhoudslogboek en de schemaversie zijn alleen te lezen.
REVOKE INSERT, UPDATE ON fabriek.onderhoud_log, fabriek.schema_versie FROM batchgui_app;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA fabriek TO batchgui_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA fabriek TO batchgui_app;
