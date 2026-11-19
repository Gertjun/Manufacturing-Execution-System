-- Migratie 0004 (versie 0.10.0): wandscherm.
-- Nieuwe rol 'scherm': een account voor een tv in de hal dat alleen het wandscherm mag lezen.
SET search_path = fabriek, public;

ALTER TABLE gebruiker DROP CONSTRAINT gebruiker_rol_check;
ALTER TABLE gebruiker ADD CONSTRAINT gebruiker_rol_check
    CHECK (rol IN ('operator','ploegleider','kwaliteit','beheerder','analist','planner','scherm'));
