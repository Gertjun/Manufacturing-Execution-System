-- Alleen fictieve schermtestaccounts; nooit in een productie-installatie of migratie.
-- Expliciete toekenning per naam, gelijk aan de gevalideerde API-fixture.
BEGIN;
SET LOCAL search_path = fabriek, public;
SELECT set_config('fabriek.gebruiker', 'seed', true);
INSERT INTO authorization_grant(user_id,role_code)
SELECT g.id,v.role_code FROM (VALUES
  ('operator.a','operator'),('operator.b','operator'),
  ('operator.c','operator'),('operator.d','operator'),
  ('ploegleider1','shift_supervisor'),('ploegleider2','shift_supervisor'),
  ('kwaliteit1','quality_approver'),
  ('beheerder1','system_administrator'),('analist1','analyst_management'),
  ('planner1','production_planner'),('productiemanager1','manufacturing_manager'),
  ('scherm1','display_integration')
) v(naam,role_code) JOIN gebruiker g ON g.gebruikersnaam=v.naam
WHERE NOT g.gedeeld;
COMMIT;
