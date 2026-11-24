-- Fictieve testaccounts voor demo's en tests (wachtwoord steeds 'demo').
-- Nooit laden op een database met echte gegevens.
BEGIN;
SET LOCAL search_path = fabriek, public;
SELECT set_config('fabriek.gebruiker', 'seed', true);

-- Accounts.
-- Alle testaccounts hebben wachtwoord 'demo'.
INSERT INTO gebruiker (gebruikersnaam, rol, wachtwoord_hash)
SELECT naam, rol, fabriek.wachtwoord_hash('demo')
FROM (VALUES ('operator',     'operator'),
             ('ploegleider1', 'ploegleider'),
             ('ploegleider2', 'ploegleider'),
             ('kwaliteit1',   'kwaliteit'),
             ('beheerder1',   'beheerder'),
             ('analist1',     'analist'),
             ('planner1',     'planner'),
             ('productiemanager1', 'productiemanager'),
             ('scherm1',      'scherm'),
             ('operator.a',   'operator'),
             ('operator.b',   'operator'),
             ('operator.c',   'operator'),
             ('operator.d',   'operator')) v(naam, rol);

-- Alleen als negatieve regressiefixture: gedeelde login wordt geweigerd (D93).
UPDATE gebruiker SET gedeeld = true WHERE gebruikersnaam = 'operator';
-- Eigen accounts, gekoppeld aan een bestaande naam: hun invoer staat op Operator A en Operator B.
UPDATE operator SET gebruiker_id = (SELECT id FROM gebruiker WHERE gebruikersnaam = 'operator.a') WHERE naam = 'Operator A';
UPDATE operator SET gebruiker_id = (SELECT id FROM gebruiker WHERE gebruikersnaam = 'operator.b') WHERE naam = 'Operator B';

UPDATE operator SET gebruiker_id = (SELECT id FROM gebruiker WHERE gebruikersnaam = 'operator.c') WHERE naam = 'Operator C';
UPDATE operator SET gebruiker_id = (SELECT id FROM gebruiker WHERE gebruikersnaam = 'operator.d') WHERE naam = 'Operator D';

-- Nieuwe fictieve MES-identiteiten. De oude accountrol is voorlopig alleen
-- een compatibiliteitsveld; MES-grants zijn expliciet en afzonderlijk.
-- Security-accounts krijgen geen legacy beheerders- of productierol.
-- Deze accounts zijn uitsluitend voor een lege demo-/testdatabase.
INSERT INTO gebruiker(gebruikersnaam,rol,wachtwoord_hash)
SELECT naam,rol,fabriek.wachtwoord_hash('demo')
FROM (VALUES
 ('mes.operator','operator'),
 ('mes.supervisor','ploegleider'),
 ('mes.manager','productiemanager'),
 ('mes.planner','planner'),
 ('mes.engineer','analist'),
 ('mes.eng.approver','analist'),
 ('mes.quality','kwaliteit'),
 ('mes.quality.approver','kwaliteit'),
 ('mes.maintenance','analist'),
 ('mes.system','beheerder'),
 ('mes.security.a','analist'),
 ('mes.security.b','analist'),
 ('mes.analyst','analist'),
 ('mes.display','scherm')
) v(naam,rol);

-- Expliciete fictieve personeelskoppelingen; login maakt geen personen meer aan.
INSERT INTO operator(naam,gebruiker_id)
SELECT g.gebruikersnaam,g.id FROM gebruiker g
WHERE NOT g.gedeeld AND g.rol IN ('operator','ploegleider','kwaliteit')
AND NOT EXISTS (SELECT 1 FROM operator o WHERE o.gebruiker_id=g.id);

-- Uitsluitend door de database-eigenaar geladen demo-bootstrap.
-- Geen automatische toekenning tijdens upgrade van echte databases.
INSERT INTO authorization_grant(user_id,role_code)
SELECT g.id,v.role_code FROM (VALUES
 ('mes.operator','operator'),
 ('mes.supervisor','shift_supervisor'),
 ('mes.manager','manufacturing_manager'),
 ('mes.planner','production_planner'),
 ('mes.engineer','process_engineer'),
 ('mes.eng.approver','engineering_approver'),
 ('mes.quality','quality_technician'),
 ('mes.quality.approver','quality_approver'),
 ('mes.maintenance','maintenance_technician'),
 ('mes.system','system_administrator'),
 ('mes.security.a','security_administrator'),
 ('mes.security.b','security_administrator'),
 ('mes.analyst','analyst_management'),
 ('mes.display','display_integration'),
 ('mes.supervisor','operator')
) v(naam,role_code) JOIN gebruiker g ON g.gebruikersnaam=v.naam;

COMMIT;
