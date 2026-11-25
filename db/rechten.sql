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

-- D100: weiger afwijkende technische rollen vóór het opnieuw toekennen van ACLs.
-- Alleen de historische batchgui_app -> mes_app relatie is toegestaan.
-- Wijzig geen onbekende rollidmaatschappen of beheerdersinstellingen automatisch.
DO $$
DECLARE v_bad text;
BEGIN
 IF EXISTS (SELECT 1 FROM fabriek.schema_versie WHERE nummer=92) THEN
   SELECT string_agg(r.rolname::text, ', ' ORDER BY r.rolname) INTO v_bad
   FROM pg_catalog.pg_roles r
   WHERE r.rolname IN ('mes_app','batchgui_app','mes_security_channel')
     AND (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls
       OR (r.rolname='mes_security_channel' AND r.rolcanlogin)
       OR EXISTS (
         SELECT 1 FROM pg_catalog.pg_roles parent
         WHERE parent.oid<>r.oid
           AND NOT (r.rolname='batchgui_app' AND parent.rolname='mes_app')
           AND pg_catalog.pg_has_role(r.oid,parent.oid,'MEMBER')
       )
       OR EXISTS (
         SELECT 1 FROM pg_catalog.pg_auth_members m
         WHERE m.member=r.oid AND m.admin_option
       ));
   IF v_bad IS NOT NULL THEN
     RAISE EXCEPTION 'Onveilige technische MES-databaserol: %',v_bad;
   END IF;
 END IF;
END $$;

-- D100: herstel de expliciete ACL vanaf een schoon uitgangspunt, ook bij upgrades.
-- Tabel-REVOKE alleen verwijdert niet alle afzonderlijke kolomgrants.
-- CASCADE trekt ook rechten in die via een oude grant-optie zijn doorgegeven.
DO $$
DECLARE login text; grantee text; c record;
BEGIN
 IF EXISTS (SELECT 1 FROM fabriek.schema_versie WHERE nummer=92) THEN
   FOREACH login IN ARRAY ARRAY['PUBLIC','mes_app','batchgui_app','mes_security_channel'] LOOP
     IF login='PUBLIC' OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname=login) THEN
       grantee:=CASE WHEN login='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(login) END;
       EXECUTE format('REVOKE ALL PRIVILEGES ON SCHEMA fabriek FROM %s CASCADE',grantee);
       EXECUTE format('REVOKE ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA fabriek FROM %s CASCADE',grantee);
       EXECUTE format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA fabriek FROM %s CASCADE',grantee);
       FOR c IN SELECT cl.relname,a.attname FROM pg_attribute a
         JOIN pg_class cl ON cl.oid=a.attrelid JOIN pg_namespace n ON n.oid=cl.relnamespace
         WHERE n.nspname='fabriek' AND cl.relkind IN ('r','p','v','m','f')
           AND a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL
       LOOP
         EXECUTE format('REVOKE ALL PRIVILEGES (%I) ON fabriek.%I FROM %s CASCADE',c.attname,c.relname,grantee);
       END LOOP;
     END IF;
   END LOOP;
 END IF;
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
-- Oudere back-ups behouden hun bestaande interface tot de migratie.
-- Vanaf 0076 expliciete signatures, geen automatische overloads.
DO $$
DECLARE sig text; f regprocedure;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM fabriek.schema_versie WHERE nummer=76) THEN
   GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA fabriek TO mes_app;
 ELSE
   REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA fabriek FROM PUBLIC,mes_app;
   IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='batchgui_app') THEN
     REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA fabriek FROM batchgui_app;
   END IF;
   FOREACH sig IN ARRAY ARRAY[
     'apparaat_moment(timestamptz)',
     'authorization_permits(uuid,text,text,uuid,text)',
     'authorization_read_execution(uuid,uuid)',
     'authorization_read_lot(uuid,uuid)',
     'batch_klaar_voor_lot(uuid)',
     'batch_stap_gedaan(uuid,uuid)',
     'bereken_markering(numeric,numeric,numeric,numeric,numeric,text)',
     'bewaar_lot_voorstel(uuid,uuid[],text,uuid)',
     'capaciteit_afwijking_voor(uuid,uuid,date)',
     'capaciteit_stap_op(uuid,uuid,date)',
     'capaciteit_stap_voor(uuid,uuid)',
     'controleer_lot_voorstel(uuid)',
     'controleer_route(uuid)',
     'demo_account_names(text[])',
     'execution_batch_hold(uuid,text)',
     'execution_bind_transaction(text,uuid)',
     'execution_cancel_planned_batch(text,text)',
     'execution_create_legacy_batch(uuid,text,uuid)',
     'execution_create_lot(text,uuid[],uuid,uuid,uuid,uuid,text)',
     'execution_paper_entry(text,text,text[],uuid,uuid,timestamptz,timestamptz,text,jsonb,jsonb)',
     'execution_plan_legacy_batches(int,date,uuid,text)',
     'execution_resolve_conflict(uuid,text,text)',
     'execution_session_actor(text)',
     'execution_session_change_password(uuid,bigint,text,text)',
     'execution_session_login(text,text,text)',
     'execution_step_complete(uuid,uuid,uuid)',
     'execution_step_rework(uuid,text,text,uuid,uuid,uuid)',
     'execution_step_start(text,uuid,uuid,uuid,uuid,uuid)',
     'execution_transaction_actor()',
     'fabriekstijdzone()',
     'gewicht_per_item(uuid,uuid)',
     'grenzen_van(uuid,uuid)',
     'handel_terugmelding_af(uuid,uuid,text)',
     'heeft_apparaat_moment()',
     'in_route(uuid,uuid)',
     'leg_grondstofconflict_vast(uuid,uuid,text,numeric,uuid,uuid,uuid)',
     'leg_invoerconflict_vast(uuid,uuid,numeric,numeric,uuid,uuid,uuid)',
     'leg_weigering_vast(uuid,uuid,uuid,text,int,text,text,text)',
     'lot_product(uuid)',
     'mag_invoeren_namens(uuid,uuid,uuid)',
     'meld_iets(uuid,uuid,uuid,uuid,text,text,text)',
     'nieuwe_specificatie(uuid,uuid,uuid)',
     'operator_van_account(uuid)',
     'plan_stand(uuid)',
     'planning_vorige_stap(uuid,uuid,uuid,date)',
     'ploeg_van(timestamptz)',
     'ploegen_in_dienst(date,text)',
     'productie_uren_per_dag()',
     'quality_decision_confirmed(uuid,bigint,text,uuid,text,text,text,text)',
     'rework_cancel_confirmed(uuid,bigint,uuid,text,text)',
     'rework_order_confirmed(uuid,bigint,text,text,text,uuid,text)',
     'rooster_op(date)',
     'route(uuid)',
     'route_eerste(uuid,text)',
     'route_laatste(uuid,text)',
     'route_vorige(uuid,uuid)',
     'stap_belasting(uuid,date)',
     'stap_meet_kwaliteit(uuid)',
     'stel_specificatie_vast(uuid,uuid)',
     'wachtwoord_hash(text)',
     'werkvoorraad(text)',
     'zet_route(uuid,text[])'
   ] LOOP
     f:=to_regprocedure('fabriek.'||sig);
     IF f IS NULL THEN RAISE EXCEPTION 'Ontbrekende applicatiefunctie: %',sig; END IF;
     EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO mes_app',f);
   END LOOP;
 END IF;
END $$;

-- Tijdelijke compatibiliteit voor bestaande installaties: dezelfde beperkte rechten,
-- zonder wachtwoorden te wijzigen of een oude login automatisch uit te schakelen.
-- De oude login krijgt de rechten van mes_app via lidmaatschap; vanaf 0092
-- worden historische directe objectgrants vooraf ingetrokken.
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
  FOREACH t IN ARRAY ARRAY['authorization_role', 'authorization_permission', 'authorization_role_permission', 'authorization_grant', 'qualification', 'personnel_qualification', 'activity_qualification', 'authorization_legacy_snapshot', 'authorization_request', 'authorization_decision', 'authorization_revocation', 'authorization_bootstrap','authorization_recovery','authorization_channel_identity','authorization_channel_identity_revocation'] LOOP
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
           WHERE n.nspname='fabriek' AND p.proname IN ('authorization_submit','authorization_decide','authorization_decide_confirmed','authorization_protect_identity','authorization_revoke_confirmed','authorization_audit_immutable','authorization_guard_legacy_role','authorization_bootstrap_empty','authorization_recover_confirmed','authorization_session_version','authorization_recovery_readiness','authorization_personnel_identity_guard','authorization_channel_submit','authorization_channel_decide','authorization_channel_revoke','authorization_channel_actor','authorization_channel_requests','authorization_channel_grants','authorization_channel_role_safe','authorization_channel_bind','authorization_channel_unbind','quality_legacy_decision_guard','beslis_keuring','quality_rework_hold_guard','maak_herbewerking','trek_herbewerking_in','koppel_herbewerking','rework_history_guard','rework_order_permission','execution_session_cleanup','login_with_session','change_password_session','execution_registration_identity_guard','execution_measurement_identity_guard','execution_conflict_insert_guard','los_invoerconflict_op','lever_stap_na','execution_paper_metadata_guard','execution_object_status_guard','start_geplande_batch','werk_lotstatus_bij','maak_lot','plan_batches','execution_batch_metadata_guard','execution_step_permission','start_stap','rond_stap_af','start_herbewerking','inloggen','change_password_confirmed') LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', f.sig);
    FOREACH login IN ARRAY ARRAY['mes_app','batchgui_app'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=login) THEN
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM %I', f.sig, login);
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- Geen directe toegang tot wachtwoordhashes. Tabelbrede SELECT moet eerst weg;
-- PostgreSQL combineert tabel- en kolomgrants. Geldt ook voor oude login.
DO $$
DECLARE login text;
BEGIN
  IF to_regprocedure('fabriek.demo_account_names(text[])') IS NOT NULL THEN
    FOREACH login IN ARRAY ARRAY['mes_app','batchgui_app'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=login) THEN
        EXECUTE format('REVOKE SELECT ON fabriek.gebruiker FROM %I', login);
        EXECUTE format('REVOKE SELECT (wachtwoord_hash) ON fabriek.gebruiker FROM %I', login);
        EXECUTE format('GRANT SELECT (id,gebruikersnaam,rol,actief,gedeeld,wachtwoord_wijzigen) ON fabriek.gebruiker TO %I', login);
      END IF;
    END LOOP;
    REVOKE SELECT ON fabriek.gebruiker FROM PUBLIC;
    REVOKE SELECT (wachtwoord_hash) ON fabriek.gebruiker FROM PUBLIC;
  END IF;
END $$;

-- D94/D99: alleen de afgeschermde authenticatiefunctie mag inlogpogingen
-- toevoegen. Werkstationbinding mag een blokkade niet kunnen opheffen.
DO $$
DECLARE login text;
BEGIN
  IF to_regprocedure('fabriek.demo_account_names(text[])') IS NOT NULL THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON fabriek.inlogpoging FROM PUBLIC;
    FOREACH login IN ARRAY ARRAY['mes_app','batchgui_app'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=login) THEN
        EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON fabriek.inlogpoging FROM %I',login);
      END IF;
    END LOOP;
  END IF;
END $$;

-- Alleen de begrensde authenticatie-interface is beschikbaar voor applicatielogins.
DO $$
DECLARE login text; f record;
BEGIN
  IF to_regprocedure('fabriek.change_password_confirmed(uuid,text,text)') IS NOT NULL THEN
    FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='fabriek' AND p.proname IN ('controleer_login','wijzig_eigen_wachtwoord') LOOP
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC',f.sig);
      FOREACH login IN ARRAY ARRAY['mes_app','batchgui_app'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=login) THEN
          EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM %I',f.sig,login);
        END IF;
      END LOOP;
    END LOOP;
  END IF;
END $$;

-- Sessiegeneratie leesbaar, nooit rechtstreeks wijzigbaar. Oudere schemas blijven ondersteund.
DO $$
DECLARE login text;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='fabriek' AND table_name='gebruiker' AND column_name='session_version') THEN
    FOREACH login IN ARRAY ARRAY['mes_app','batchgui_app','PUBLIC'] LOOP
      IF login='PUBLIC' OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname=login) THEN
        EXECUTE format('REVOKE UPDATE, INSERT ON fabriek.gebruiker FROM %s', CASE WHEN login='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(login) END);
        EXECUTE format('REVOKE UPDATE (session_version), INSERT (session_version) ON fabriek.gebruiker FROM %s', CASE WHEN login='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(login) END);
        IF login<>'PUBLIC' THEN
          EXECUTE format('GRANT SELECT (session_version), UPDATE (gebruikersnaam,rol,actief,gedeeld,wachtwoord_hash,wachtwoord_wijzigen), INSERT (gebruikersnaam,rol,actief,gedeeld,wachtwoord_hash,wachtwoord_wijzigen) ON fabriek.gebruiker TO %I',login);
        END IF;
      END IF;
    END LOOP;
  END IF;
END $$;

-- Geen directe wijzigingen aan de koppeling tussen persoon en account.
DO $$
DECLARE login text;
BEGIN
  IF to_regprocedure('fabriek.authorization_personnel_identity_guard()') IS NOT NULL THEN
    FOREACH login IN ARRAY ARRAY['mes_app','batchgui_app','PUBLIC'] LOOP
      IF login='PUBLIC' OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname=login) THEN
        EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON fabriek.operator FROM %s', CASE WHEN login='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(login) END);
        EXECUTE format('REVOKE INSERT (gebruiker_id,id), UPDATE (gebruiker_id,id) ON fabriek.operator FROM %s', CASE WHEN login='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(login) END);
        IF login<>'PUBLIC' THEN
          EXECUTE format('GRANT INSERT (naam,actief,ploeg_id), UPDATE (naam,actief,ploeg_id) ON fabriek.operator TO %I',login);
        END IF;
      END IF;
    END LOOP;
  END IF;
END $$;

-- Bindingen zijn niet zichtbaar voor gewone applicatieaccounts.
DO $$
DECLARE login text;
BEGIN
 IF to_regclass('fabriek.authorization_channel_identity') IS NOT NULL THEN
   REVOKE ALL ON fabriek.authorization_channel_identity FROM PUBLIC;
   FOREACH login IN ARRAY ARRAY['mes_app','batchgui_app','mes_security_channel'] LOOP
     IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=login) THEN
       EXECUTE format('REVOKE ALL ON fabriek.authorization_channel_identity FROM %I',login);
     END IF;
   END LOOP;
 END IF;
END $$;

DO $$
DECLARE login text;
BEGIN
 IF to_regclass('fabriek.authorization_channel_identity_revocation') IS NOT NULL THEN
   REVOKE ALL ON fabriek.authorization_channel_identity_revocation FROM PUBLIC;
   FOREACH login IN ARRAY ARRAY['mes_app','batchgui_app','mes_security_channel'] LOOP
     IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=login) THEN
       EXECUTE format('REVOKE ALL ON fabriek.authorization_channel_identity_revocation FROM %I',login);
     END IF;
   END LOOP;
 END IF;
END $$;

DO $$
DECLARE login text;
BEGIN
 IF to_regprocedure('fabriek.quality_legacy_decision_guard()') IS NOT NULL THEN
   FOREACH login IN ARRAY ARRAY['mes_app','batchgui_app','PUBLIC'] LOOP
     IF login='PUBLIC' OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname=login) THEN
       EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON fabriek.keuring, fabriek.batch_besluit FROM %s', CASE WHEN login='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(login) END);
     END IF;
   END LOOP;
 END IF;
END $$;

DO $$
DECLARE login text;
BEGIN
 IF to_regprocedure('fabriek.rework_history_guard()') IS NOT NULL THEN
   FOREACH login IN ARRAY ARRAY['mes_app','batchgui_app','PUBLIC'] LOOP
     IF login='PUBLIC' OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname=login) THEN
       EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON fabriek.herbewerking FROM %s',CASE WHEN login='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(login) END);
     END IF;
   END LOOP;
 END IF;
END $$;

-- Sessiebewijzen en hun hashes zijn geen leesbare applicatiegegevens.
DO $$
DECLARE login text;
BEGIN
 IF to_regclass('fabriek.execution_session') IS NOT NULL THEN
   REVOKE ALL ON fabriek.execution_session FROM PUBLIC;
   FOREACH login IN ARRAY ARRAY['mes_app','batchgui_app','mes_security_channel'] LOOP
     IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=login) THEN
       EXECUTE format('REVOKE ALL ON fabriek.execution_session FROM %I',login);
     END IF;
   END LOOP;
 END IF;
END $$;

DO $$
DECLARE login text;
BEGIN
 IF to_regprocedure('fabriek.execution_resolve_conflict(uuid,text,text)') IS NOT NULL THEN
   FOREACH login IN ARRAY ARRAY['mes_app','batchgui_app','PUBLIC'] LOOP
     IF login='PUBLIC' OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname=login) THEN
       EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON fabriek.invoerconflict FROM %s',CASE WHEN login='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(login) END);
     END IF;
   END LOOP;
 END IF;
END $$;

DO $$
DECLARE login text;
BEGIN
 IF to_regprocedure('fabriek.execution_batch_hold(uuid,text)') IS NOT NULL THEN
   FOREACH login IN ARRAY ARRAY['mes_app','batchgui_app','PUBLIC'] LOOP
     IF login='PUBLIC' OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname=login) THEN
       EXECUTE format('REVOKE INSERT ON fabriek.batch_besluit, fabriek.lot FROM %s',CASE WHEN login='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(login) END);
     END IF;
   END LOOP;
 END IF;
END $$;

DO $$
DECLARE login text;
BEGIN
 IF to_regprocedure('fabriek.execution_create_legacy_batch(uuid,text,uuid)') IS NOT NULL THEN
   FOREACH login IN ARRAY ARRAY['mes_app','batchgui_app','PUBLIC'] LOOP
     IF login='PUBLIC' OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname=login) THEN
       EXECUTE format('REVOKE INSERT ON fabriek.batch FROM %s',CASE WHEN login='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(login) END);
     END IF;
   END LOOP;
 END IF;
END $$;

DO $$
DECLARE login text;
BEGIN
 IF to_regprocedure('fabriek.execution_step_complete(uuid,uuid,uuid)') IS NOT NULL THEN
   FOREACH login IN ARRAY ARRAY['mes_app','batchgui_app','PUBLIC'] LOOP
     IF login='PUBLIC' OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname=login) THEN
       EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON fabriek.stapregistratie FROM %s',CASE WHEN login='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(login) END);
     END IF;
   END LOOP;
 END IF;
END $$;

-- Vanaf 0077: verwijder de tijdelijke algemene tabelschrijfrechten en
-- herstel alleen expliciet benodigde legacy-writes. Kolomgrants voor
-- gebruiker/operator blijven afzonderlijk begrensd zoals hierboven.
DO $$
DECLARE login text;
BEGIN
 IF EXISTS (SELECT 1 FROM fabriek.schema_versie WHERE nummer=77) THEN
   REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON ALL TABLES IN SCHEMA fabriek FROM PUBLIC,mes_app;
   IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='batchgui_app') THEN
     REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON ALL TABLES IN SCHEMA fabriek FROM batchgui_app;
   END IF;
   GRANT INSERT ON fabriek.veld, fabriek.veld_product, fabriek.grondstof, fabriek.stap_grondstof, fabriek.pc, fabriek.pc_stap, fabriek.product, fabriek.stapplanning, fabriek.capaciteit_afwijking, fabriek.capaciteit_stap, fabriek.lot_voorstel, fabriek.lot_voorstel_batch, fabriek.waarde, fabriek.grondstof_gebruik, fabriek.invoerconflict, fabriek.specificatie, fabriek.specificatie_regel, fabriek.stilstand, fabriek.stilstand_oorzaak, fabriek.melding_gelezen, fabriek.overdracht, fabriek.rooster, fabriek.rooster_ploeg, fabriek.certificaat, fabriek.instelling, fabriek.terugmelding, fabriek.geweigerde_invoer, fabriek.product_stap, fabriek.config_log, fabriek.melding TO mes_app;
   GRANT UPDATE ON fabriek.veld, fabriek.veld_product, fabriek.processtap, fabriek.grondstof, fabriek.stap_grondstof, fabriek.pc, fabriek.product, fabriek.batch, fabriek.capaciteit_afwijking, fabriek.capaciteit_stap, fabriek.lot_voorstel, fabriek.specificatie, fabriek.specificatie_regel, fabriek.stilstand, fabriek.stilstand_oorzaak, fabriek.ploeg, fabriek.rooster, fabriek.rooster_ploeg, fabriek.instelling, fabriek.terugmelding TO mes_app;
   -- REVOKE op tabelniveau trekt ook kolomrechten in. Herstel uitsluitend
   -- de eerder begrensde account- en personeelsinterface, niet tabelbrede writes.
   GRANT INSERT (gebruikersnaam,rol,actief,gedeeld,wachtwoord_hash,wachtwoord_wijzigen),
         UPDATE (gebruikersnaam,rol,actief,gedeeld,wachtwoord_hash,wachtwoord_wijzigen) ON fabriek.gebruiker TO mes_app;
   GRANT INSERT (naam,actief,ploeg_id), UPDATE (naam,actief,ploeg_id) ON fabriek.operator TO mes_app;
   GRANT DELETE ON fabriek.pc_stap, fabriek.stapplanning, fabriek.lot_voorstel_batch, fabriek.product_stap, fabriek.veld_product, fabriek.capaciteit_stap, fabriek.specificatie, fabriek.specificatie_regel TO mes_app;
 END IF;
END $$;

-- Vanaf 0078: expliciete tijdelijke leesinterface. Geen automatische toegang tot nieuwe tabellen.
-- Bestaande operationele leesrechten blijven voorlopig behouden; productscope volgt via de API.
DO $$
DECLARE login text; c record; grantee text;
BEGIN
 IF EXISTS (SELECT 1 FROM fabriek.schema_versie WHERE nummer=78) THEN
   FOREACH login IN ARRAY ARRAY['PUBLIC','mes_app','batchgui_app'] LOOP
     IF login='PUBLIC' OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname=login) THEN
       grantee := CASE WHEN login='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(login) END;
       EXECUTE format('REVOKE SELECT ON ALL TABLES IN SCHEMA fabriek FROM %s',grantee);
       FOR c IN SELECT cl.relname, a.attname FROM pg_class cl
         JOIN pg_namespace n ON n.oid=cl.relnamespace
         JOIN pg_attribute a ON a.attrelid=cl.oid
         WHERE n.nspname='fabriek' AND cl.relkind IN ('r','p','v','m','f')
           AND a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL
       LOOP
         EXECUTE format('REVOKE SELECT (%I) ON fabriek.%I FROM %s',c.attname,c.relname,grantee);
       END LOOP;
     END IF;
   END LOOP;
   GRANT SELECT ON fabriek.operator, fabriek.pc, fabriek.processtap, fabriek.pc_stap, fabriek.veld, fabriek.config_log, fabriek.lot, fabriek.product, fabriek.product_stap, fabriek.batch, fabriek.batch_besluit, fabriek.veld_product, fabriek.specificatie, fabriek.specificatie_regel, fabriek.stapregistratie, fabriek.herbewerking, fabriek.keuring, fabriek.route_grenzen, fabriek.waarde, fabriek.waarde_actueel, fabriek.lotpaspoort, fabriek.lot_voorstel, fabriek.lot_voorstel_batch, fabriek.stapplanning, fabriek.grondstof, fabriek.stap_grondstof, fabriek.grondstof_gebruik, fabriek.grondstof_gebruik_actueel, fabriek.ploeg, fabriek.rooster, fabriek.rooster_ploeg, fabriek.overdracht, fabriek.melding, fabriek.melding_gelezen, fabriek.stilstand_oorzaak, fabriek.stilstand, fabriek.capaciteit_stap, fabriek.capaciteit_route, fabriek.capaciteit_afwijking, fabriek.instelling, fabriek.certificaat, fabriek.inlogpoging, fabriek.herbewerking_stand, fabriek.schema_versie, fabriek.onderhoud_log, fabriek.terugmelding, fabriek.geweigerde_invoer, fabriek.invoerconflict, fabriek.authorization_role, fabriek.authorization_permission, fabriek.authorization_role_permission, fabriek.authorization_grant, fabriek.qualification, fabriek.personnel_qualification, fabriek.activity_qualification, fabriek.authorization_legacy_snapshot, fabriek.authorization_request, fabriek.authorization_decision, fabriek.authorization_revocation, fabriek.authorization_bootstrap, fabriek.authorization_recovery TO mes_app;
   GRANT SELECT (id,gebruikersnaam,rol,actief,gedeeld,wachtwoord_wijzigen,session_version) ON fabriek.gebruiker TO mes_app;
 END IF;
END $$;

-- Vanaf 0079 geen directe auditwrites, ook niet via oude kolomgrants.
DO $$
DECLARE login text; grantee text; c record;
BEGIN
 IF EXISTS (SELECT 1 FROM fabriek.schema_versie WHERE nummer=79) THEN
   FOREACH login IN ARRAY ARRAY['PUBLIC','mes_app','batchgui_app'] LOOP
     IF login='PUBLIC' OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname=login) THEN
       grantee := CASE WHEN login='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(login) END;
       EXECUTE format('REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON fabriek.config_log FROM %s',grantee);
       EXECUTE format('REVOKE EXECUTE ON FUNCTION fabriek.log_config() FROM %s',grantee);
       FOR c IN SELECT attname FROM pg_attribute WHERE attrelid='fabriek.config_log'::regclass AND attnum>0 AND NOT attisdropped AND attacl IS NOT NULL LOOP
         EXECUTE format('REVOKE INSERT (%I), UPDATE (%I) ON fabriek.config_log FROM %s',c.attname,c.attname,grantee);
       END LOOP;
     END IF;
   END LOOP;
 END IF;
END $$;

-- D99/D101: uitgestelde kwaliteits- en pilotinterfaces zijn read-only voor applicatielogins.
-- Eigenaar behoudt historische fixtures en gecontroleerd technisch onderhoud.
DO $$
DECLARE login text; grantee text; t text; c record;
BEGIN
 IF EXISTS (SELECT 1 FROM fabriek.schema_versie WHERE nummer=81) THEN
   FOREACH login IN ARRAY ARRAY['PUBLIC','mes_app','batchgui_app'] LOOP
     IF login='PUBLIC' OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname=login) THEN
       grantee := CASE WHEN login='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(login) END;
       FOREACH t IN ARRAY ARRAY['specificatie','specificatie_regel','certificaat','instelling','terugmelding'] LOOP
         EXECUTE format('REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON fabriek.%I FROM %s',t,grantee);
         FOR c IN SELECT attname FROM pg_attribute WHERE attrelid=to_regclass('fabriek.'||t)
             AND attnum>0 AND NOT attisdropped AND attacl IS NOT NULL LOOP
           EXECUTE format('REVOKE INSERT (%I), UPDATE (%I) ON fabriek.%I FROM %s',c.attname,c.attname,t,grantee);
         END LOOP;
       END LOOP;
       EXECUTE format('REVOKE EXECUTE ON FUNCTION fabriek.nieuwe_specificatie(uuid,uuid,uuid), fabriek.stel_specificatie_vast(uuid,uuid), fabriek.meld_iets(uuid,uuid,uuid,uuid,text,text,text), fabriek.handel_terugmelding_af(uuid,uuid,text) FROM %s',grantee);
     END IF;
   END LOOP;
 END IF;
END $$;

-- D101/0082: alleen vaste eventtriggers schrijven meldingen; leesregistratie
-- blijft INSERT-only met persoonlijk bewijs en actuele ontvangersbevoegdheid.
DO $$
DECLARE login text; grantee text; c record;
BEGIN
 IF EXISTS (SELECT 1 FROM fabriek.schema_versie WHERE nummer=82) THEN
   FOREACH login IN ARRAY ARRAY['PUBLIC','mes_app','batchgui_app'] LOOP
     IF login='PUBLIC' OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname=login) THEN
       grantee := CASE WHEN login='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(login) END;
       EXECUTE format('REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON fabriek.melding FROM %s',grantee);
       EXECUTE format('REVOKE UPDATE,DELETE,TRUNCATE ON fabriek.melding_gelezen FROM %s',grantee);
       FOR c IN SELECT attrelid::regclass AS tabel,attname FROM pg_attribute
         WHERE attrelid IN ('fabriek.melding'::regclass,'fabriek.melding_gelezen'::regclass)
           AND attnum>0 AND NOT attisdropped AND attacl IS NOT NULL LOOP
         EXECUTE format('REVOKE UPDATE (%I) ON %s FROM %s',c.attname,c.tabel,grantee);
         IF c.tabel='fabriek.melding'::regclass THEN
           EXECUTE format('REVOKE INSERT (%I) ON %s FROM %s',c.attname,c.tabel,grantee);
         END IF;
       END LOOP;
       EXECUTE format('REVOKE EXECUTE ON FUNCTION fabriek.notification_read_guard(), fabriek.meld_waarde(), fabriek.meld_besluit(), fabriek.meld_lotvoorstel(), fabriek.meld_stilstand(), fabriek.meld_herbewerking(), fabriek.meld_keuring(), fabriek.meld_invoerconflict() FROM %s',grantee);
       IF login<>'mes_app' THEN
         EXECUTE format('REVOKE EXECUTE ON FUNCTION fabriek.notification_recipient(uuid,text[]) FROM %s',grantee);
       END IF;
     END IF;
   END LOOP;
   GRANT EXECUTE ON FUNCTION fabriek.notification_recipient(uuid,text[]) TO mes_app;
 END IF;
END $$;

-- 0084: alleen gecontroleerde persoonlijke wrappers wijzigen lotvoorstellen.
DO $$
DECLARE login text; grantee text; t text; c record;
BEGIN
 IF EXISTS (SELECT 1 FROM fabriek.schema_versie WHERE nummer=84) THEN
   FOREACH login IN ARRAY ARRAY['PUBLIC','mes_app','batchgui_app'] LOOP
     IF login='PUBLIC' OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname=login) THEN
       grantee := CASE WHEN login='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(login) END;
       FOREACH t IN ARRAY ARRAY['lot_voorstel','lot_voorstel_batch'] LOOP
         EXECUTE format('REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON fabriek.%I FROM %s',t,grantee);
         FOR c IN SELECT attname FROM pg_attribute WHERE attrelid=to_regclass('fabriek.'||t)
             AND attnum>0 AND NOT attisdropped AND attacl IS NOT NULL LOOP
           EXECUTE format('REVOKE INSERT (%I), UPDATE (%I) ON fabriek.%I FROM %s',c.attname,c.attname,t,grantee);
         END LOOP;
       END LOOP;
       EXECUTE format('REVOKE EXECUTE ON FUNCTION fabriek.bewaar_lot_voorstel(uuid,uuid[],text,uuid), fabriek.operations_write_guard(), fabriek.configuration_write_guard() FROM %s',grantee);
       IF login<>'mes_app' THEN
         EXECUTE format('REVOKE EXECUTE ON FUNCTION fabriek.planning_save_legacy_proposal(uuid,uuid[],text), fabriek.planning_cancel_legacy_proposal(int) FROM %s',grantee);
       END IF;
     END IF;
   END LOOP;
   GRANT EXECUTE ON FUNCTION fabriek.planning_save_legacy_proposal(uuid,uuid[],text), fabriek.planning_cancel_legacy_proposal(int) TO mes_app;
 END IF;
END $$;

-- 0085: uitsluitend eigenaarprocedure; geen directe app/security-toegang.
DO $$
DECLARE login text; grantee text;
BEGIN
 IF to_regclass('fabriek.authorization_personnel_link') IS NOT NULL THEN
   FOREACH login IN ARRAY ARRAY['PUBLIC','mes_app','batchgui_app','mes_security_channel'] LOOP
     IF login='PUBLIC' OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname=login) THEN
       grantee := CASE WHEN login='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(login) END;
       EXECUTE format('REVOKE ALL ON fabriek.authorization_personnel_link FROM %s',grantee);
       EXECUTE format('REVOKE ALL ON FUNCTION fabriek.authorization_link_personnel_confirmed(uuid,uuid,uuid,uuid,text,text,text) FROM %s',grantee);
     END IF;
   END LOOP;
 END IF;
END $$;

-- 0086: eigenaarprocedures; geen directe audit- of kwalificatiewrites.
DO $$
DECLARE login text; grantee text;
BEGIN
 IF to_regclass('fabriek.qualification_issue') IS NOT NULL THEN
   FOREACH login IN ARRAY ARRAY['PUBLIC','mes_app','batchgui_app','mes_security_channel'] LOOP
     IF login='PUBLIC' OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname=login) THEN
       grantee:=CASE WHEN login='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(login) END;
       EXECUTE format('REVOKE ALL ON fabriek.qualification_issue,fabriek.qualification_revocation FROM %s',grantee);
       EXECUTE format('REVOKE ALL ON FUNCTION fabriek.qualification_is_operations(text),fabriek.qualification_issue_confirmed(uuid,text,timestamptz,timestamptz,uuid,uuid,text,text,text),fabriek.qualification_revoke_confirmed(uuid,uuid,text,text) FROM %s',grantee);
     END IF;
   END LOOP;
 END IF;
END $$;

-- D24/D100: geen directe sequence-interface op het actuele MES-schema.
-- IDENTITY-kolommen genereren hun waarden via INSERT; de enige bigserial
-- (config_log.id) wordt door de eigenaartrigger gevuld. Oudere schemas
-- behouden hun historische interface totdat de migraties toegepast zijn.
DO $$
DECLARE login text; grantee text;
BEGIN
 IF EXISTS (SELECT 1 FROM fabriek.schema_versie WHERE nummer=92) THEN
   FOREACH login IN ARRAY ARRAY['PUBLIC','mes_app','batchgui_app','mes_security_channel'] LOOP
     IF login='PUBLIC' OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname=login) THEN
       grantee:=CASE WHEN login='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(login) END;
       EXECUTE format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA fabriek FROM %s CASCADE',grantee);
     END IF;
   END LOOP;
 END IF;
END $$;

-- D100: herbouw uitsluitend het bestaande persoonlijk gebonden securitykanaal.
-- Geen algemene functie-uitvoering of delegatie; oude overloads blijven eigenaar-only.
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM fabriek.schema_versie WHERE nummer=92) THEN
   GRANT USAGE ON SCHEMA fabriek TO mes_security_channel;
   GRANT EXECUTE ON FUNCTION
     fabriek.authorization_channel_submit(uuid,text,text,uuid,text,timestamptz,timestamptz,text,text),
     fabriek.authorization_channel_decide(uuid,boolean,text,text),
     fabriek.authorization_channel_revoke(uuid,text,text),
     fabriek.authorization_channel_requests(),
     fabriek.authorization_channel_grants()
   TO mes_security_channel;
 END IF;
END $$;

-- 0097: uitsluitend de persoonlijk gecontroleerde materiaalinterface.
-- De tabellen en interne autorisatiehelper blijven ontoegankelijk.
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM fabriek.schema_versie WHERE nummer=97) THEN
   GRANT EXECUTE ON FUNCTION fabriek.material_create_class(text,text),
     fabriek.material_create_definition(text,text,uuid,text,uuid,uuid),
     fabriek.material_append_version(uuid,integer,text,uuid,text),
     fabriek.material_list() TO mes_app;
 END IF;
END $$;

-- 0098: alleen productgebonden, persoonlijk gecontroleerde MBR-conceptfuncties.
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM fabriek.schema_versie WHERE nummer=98) THEN
   GRANT EXECUTE ON FUNCTION fabriek.recipe_create(uuid,text,text,text),
     fabriek.recipe_create_next_version(uuid,integer,text,text),fabriek.recipe_list(uuid) TO mes_app;
 END IF;
END $$;

-- 0099: gecontroleerde conceptheaderwijziging; geen directe tabelwrites.
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM fabriek.schema_versie WHERE nummer=99) THEN
   GRANT EXECUTE ON FUNCTION fabriek.recipe_update_draft(uuid,integer,text,text) TO mes_app;
 END IF;
END $$;

-- 0101: uitsluitend persoonlijke procedureinterface, interne lock/audit niet toegankelijk.
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM fabriek.schema_versie WHERE nummer=101) THEN
   GRANT EXECUTE ON FUNCTION fabriek.recipe_procedure_list(uuid),
     fabriek.recipe_save_element(uuid,integer,uuid,uuid,text,text,text,integer,boolean),
     fabriek.recipe_delete_element(uuid,integer,uuid),fabriek.recipe_add_dependency(uuid,integer,uuid,uuid),
     fabriek.recipe_delete_dependency(uuid,integer,uuid) TO mes_app;
 END IF;
END $$;

-- 0108: alleen de expliciete persoonlijke parameter-/formulefuncties.
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM fabriek.schema_versie WHERE nummer=108) THEN
   GRANT EXECUTE ON FUNCTION fabriek.recipe_content_list(uuid),
     fabriek.recipe_save_parameter(uuid,integer,uuid,uuid,text,text,text,text,text,boolean,text,boolean,uuid),
     fabriek.recipe_delete_parameter(uuid,integer,uuid),
     fabriek.recipe_save_parameter_limit(uuid,integer,uuid,uuid,text,text,numeric,numeric,numeric,text),
     fabriek.recipe_delete_parameter_limit(uuid,integer,uuid),
     fabriek.recipe_save_formula(uuid,integer,uuid,numeric,text,uuid),
     fabriek.recipe_delete_formula(uuid,integer,uuid),
     fabriek.recipe_save_material_requirement(uuid,integer,uuid,uuid,uuid,uuid,text,text,numeric,text,text,uuid),
     fabriek.recipe_delete_material_requirement(uuid,integer,uuid) TO mes_app;
 END IF;
END $$;

-- D100: controleer de geïnstalleerde SECURITY DEFINER-interface, niet alleen broncode.
-- Een afwijkende eigenaar wordt niet automatisch gewijzigd: IT moet dit beoordelen.
DO $$
DECLARE v_bad text;
BEGIN
 IF EXISTS (SELECT 1 FROM fabriek.schema_versie WHERE nummer=92) THEN
   SELECT string_agg(p.oid::regprocedure::text,', ' ORDER BY p.oid)
     INTO v_bad
     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='fabriek' AND p.prosecdef
       AND (p.proowner<>n.nspowner
         OR NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig,ARRAY[]::text[])) c
              WHERE replace(c,' ','') IN ('search_path=pg_catalog,fabriek,pg_temp',
                                          'search_path=pg_catalog,fabriek,public,pg_temp'))
         OR EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
                    WHERE a.grantee=0 AND a.privilege_type='EXECUTE'));
   IF v_bad IS NOT NULL THEN
     RAISE EXCEPTION 'Onveilige SECURITY DEFINER-interface: %',v_bad;
   END IF;
 END IF;
END $$;

-- D100/0093: controleer ook persoonlijke leden na herstel van de groeps-ACLs.
-- Onbekende persoonlijke rechten niet automatisch intrekken: IT moet de afwijking oplossen.
DO $$
DECLARE v_bad text;
BEGIN
 IF EXISTS (SELECT 1 FROM fabriek.schema_versie WHERE nummer=93) THEN
   SELECT string_agg(r.rolname::text,', ' ORDER BY r.rolname) INTO v_bad
   FROM pg_catalog.pg_roles r
   WHERE r.oid IN (
     WITH RECURSIVE leden(oid) AS (
       SELECT m.member FROM pg_catalog.pg_auth_members m
       JOIN pg_catalog.pg_roles g ON g.oid=m.roleid
       WHERE g.rolname='mes_security_channel'
       UNION
       SELECT m.member FROM pg_catalog.pg_auth_members m JOIN leden l ON l.oid=m.roleid
     ) SELECT oid FROM leden
   )
     AND NOT fabriek.authorization_channel_role_safe(r.oid);
   IF v_bad IS NOT NULL THEN
     RAISE EXCEPTION 'Onveilige persoonlijke MES-databaserol: %',v_bad;
   END IF;
 END IF;
END $$;

-- D100: public staat in zoekpaden vanwege pgcrypto. Alleen vertrouwde
-- installatie-eigenaren mogen daar objecten maken. Geen automatische ACL-wijziging.
DO $$
DECLARE v_bad boolean;
BEGIN
 IF EXISTS (SELECT 1 FROM fabriek.schema_versie WHERE nummer=93) THEN
   WITH vertrouwd AS (
     SELECT nspowner AS oid FROM pg_catalog.pg_namespace WHERE nspname='fabriek'
     UNION SELECT datdba FROM pg_catalog.pg_database WHERE datname=current_database()
     UNION SELECT oid FROM pg_catalog.pg_roles WHERE rolsuper OR rolname='pg_database_owner'
   )
   SELECT NOT EXISTS (
     SELECT 1 FROM pg_catalog.pg_namespace n
     WHERE n.nspname='public' AND n.nspowner IN (SELECT oid FROM vertrouwd)
   ) OR EXISTS (
     SELECT 1 FROM pg_catalog.pg_namespace n
     CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a
     WHERE n.nspname='public' AND a.privilege_type='CREATE'
       AND a.grantee NOT IN (SELECT oid FROM vertrouwd)
   ) OR NOT EXISTS (
     SELECT 1 FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace
     WHERE e.extname='pgcrypto' AND n.nspname='public'
       AND e.extowner IN (SELECT oid FROM vertrouwd)
   ) OR EXISTS (
     SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proowner NOT IN (SELECT oid FROM vertrouwd)
   ) INTO v_bad;
   IF v_bad THEN
     RAISE EXCEPTION 'Onvertrouwd public-schema of pgcrypto-eigendom';
   END IF;
 END IF;
END $$;

