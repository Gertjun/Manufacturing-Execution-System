-- Fictieve testaccounts voor demo's en tests (wachtwoord steeds 'demo').
-- Nooit laden op een database met echte gegevens.
BEGIN;
SET LOCAL search_path = fabriek, public;
SELECT set_config('fabriek.gebruiker', 'seed', true);

-- Accounts.
-- Alle testaccounts hebben wachtwoord 'demo'.
INSERT INTO gebruiker (gebruikersnaam, rol, wachtwoord_hash)
SELECT naam, rol, public.crypt('demo', public.gen_salt('bf'))
FROM (VALUES ('operator',     'operator'),
             ('ploegleider1', 'ploegleider'),
             ('ploegleider2', 'ploegleider'),
             ('kwaliteit1',   'kwaliteit'),
             ('beheerder1',   'beheerder'),
             ('analist1',     'analist'),
             ('planner1',     'planner')) v(naam, rol);

COMMIT;
