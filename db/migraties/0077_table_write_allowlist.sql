-- Migratie 0077: expliciete schrijfrechten voor de tijdelijke applicatie-interface.
SET search_path = fabriek, public;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON ALL TABLES IN SCHEMA fabriek FROM PUBLIC;
-- Bestaande directe app-grants worden bij db/rechten.sql vervangen door
-- een expliciete lijst. Leesrechten worden in een afzonderlijke stap beperkt.
