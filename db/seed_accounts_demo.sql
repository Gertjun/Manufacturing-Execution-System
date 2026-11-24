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

COMMIT;
