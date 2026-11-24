-- Rechten voor de applicatie (versie 0.6.0).
-- De applicatie logt in als mes_app: gegevens lezen en invoeren mag, de structuur
-- van de database wijzigen niet. Migraties, back-ups en herstel draaien als beheerder.
-- Dit bestand kan steeds opnieuw worden uitgevoerd (tools/migreer.mjs doet dat na elke migratie).
-- Het wachtwoord zet IT apart:  ALTER ROLE mes_app PASSWORD '...';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mes_app') THEN
    CREATE ROLE mes_app LOGIN;
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO mes_app', current_database());
END $$;

GRANT USAGE ON SCHEMA fabriek TO mes_app;

-- Lezen en invoeren op alle tabellen en views; nooit tabellen leegmaken of wijzigen.
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA fabriek TO mes_app;
-- Verwijderen alleen waar de regels dat toestaan: de stapkoppeling van een pc.
REVOKE DELETE ON ALL TABLES IN SCHEMA fabriek FROM mes_app;
GRANT DELETE ON fabriek.pc_stap TO mes_app;
-- Planning mag de planner herschikken: de dagplanning per stap en de batches in een open lotvoorstel.
-- (Voorwaardelijk: een teruggezette oudere back-up heeft deze tabellen nog niet tot migreer.mjs draait.)
DO $$
BEGIN
  IF to_regclass('fabriek.stapplanning') IS NOT NULL THEN
    GRANT DELETE ON fabriek.stapplanning, fabriek.lot_voorstel_batch TO mes_app;
  END IF;
END $$;
-- Een route vervangen (sinds 0.28.0) en grenzen per product weghalen (sinds 0.29.0).
DO $$
BEGIN
  IF to_regclass('fabriek.product_stap') IS NOT NULL THEN
    GRANT DELETE ON fabriek.product_stap TO mes_app;
  END IF;
  IF to_regclass('fabriek.veld_product') IS NOT NULL THEN
    GRANT DELETE ON fabriek.veld_product TO mes_app;   -- terug naar de grenzen van het veld (sinds 0.29.0)
  END IF;
  IF to_regclass('fabriek.capaciteit_stap') IS NOT NULL THEN
    GRANT DELETE ON fabriek.capaciteit_stap TO mes_app;   -- capaciteit per stap weghalen (sinds 0.30.0)
  END IF;
  IF to_regclass('fabriek.specificatie') IS NOT NULL THEN
    -- Een concept-specificatie weggooien en regels uit een concept halen (sinds 0.51.0, #80); de database
    -- weigert dat voor een vastgestelde specificatie.
    GRANT DELETE ON fabriek.specificatie, fabriek.specificatie_regel TO mes_app;
  END IF;
END $$;
-- Inlogpogingen alleen vastleggen, niet wijzigen.
DO $$
BEGIN
  IF to_regclass('fabriek.inlogpoging') IS NOT NULL THEN
    REVOKE UPDATE ON fabriek.inlogpoging FROM mes_app;
  END IF;
END $$;
-- Het onderhoudslogboek en de schemaversie zijn alleen te lezen.
REVOKE INSERT, UPDATE ON fabriek.onderhoud_log, fabriek.schema_versie FROM mes_app;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA fabriek TO mes_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA fabriek TO mes_app;

-- Tijdelijke compatibiliteit voor bestaande installaties: dezelfde beperkte rechten,
-- zonder wachtwoorden te wijzigen of een oude login automatisch uit te schakelen.
-- De oude login krijgt de rechten van mes_app via lidmaatschap; directe oude grants
-- blijven tijdens de overgang bestaan en moeten bij nieuwe beschermde tabellen
-- eveneens expliciet worden ingetrokken.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'batchgui_app') THEN
    GRANT mes_app TO batchgui_app;
  END IF;
END $$;

-- Autorisaties en kwalificaties: geen directe wijzigingen door de applicatie.
DO $$
DECLARE t text; login text;
BEGIN
  FOREACH t IN ARRAY ARRAY['authorization_role', 'authorization_permission', 'authorization_role_permission', 'authorization_grant', 'qualification', 'personnel_qualification', 'activity_qualification', 'authorization_legacy_snapshot', 'authorization_request', 'authorization_decision'] LOOP
    IF to_regclass('fabriek.' || t) IS NOT NULL THEN
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON fabriek.%I FROM PUBLIC', t);
      FOREACH login IN ARRAY ARRAY['mes_app','batchgui_app'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = login) THEN
          EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON fabriek.%I FROM %I', t, login);
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END $$;

-- De onafhankelijke aanvraag- en besluitprocedures blijven eigenaar-only totdat
-- de persoonlijke herbevestiging en het beveiligde beheerkanaal zijn geaccepteerd.
DO $$
DECLARE login text; f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='fabriek' AND p.proname IN ('authorization_submit','authorization_decide','authorization_decide_confirmed','authorization_protect_identity') LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', f.sig);
    FOREACH login IN ARRAY ARRAY['mes_app','batchgui_app'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=login) THEN
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM %I', f.sig, login);
      END IF;
    END LOOP;
  END LOOP;
END $$;
