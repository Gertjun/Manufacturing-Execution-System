-- Fictieve configuratie: 18 processtappen met voorbeeldvelden,
-- operators en pc's. Geen accounts: de eerste beheerder maak je met tools/beheerder.mjs
-- (of de laptop vraagt erom bij de eerste start). Fictieve testaccounts: seed_accounts_demo.sql.
BEGIN;
SET search_path = fabriek;
SELECT set_config('fabriek.gebruiker', 'seed', true);

-- Processtappen: PS1-PS15 per batch, PS16 lot-stap, PS17-PS18 per lot.
INSERT INTO processtap (code, naam, volgorde, niveau, is_lot_stap)
SELECT 'PS' || n, 'Process Step ' || n, n,
       CASE WHEN n >= 16 THEN 'lot' ELSE 'batch' END,
       n = 16
FROM generate_series(1, 18) n;

-- Elke stap: Sn.1 Temperatuur (setting + gemeten), Sn.2 Gewicht.
INSERT INTO veld (processtap_id, code, naam, soort, eenheid, grens_min, grens_max, tolerantie, volgnummer)
SELECT s.id, 'S' || s.volgorde || '.1', 'Temperatuur', 'procesparameter', '°C', 20, 120, 5, 1
FROM processtap s;

INSERT INTO veld (processtap_id, code, naam, soort, eenheid, grens_min, grens_max, volgnummer)
SELECT s.id, 'S' || s.volgorde || '.2', 'Gewicht', 'gewicht', 'kg',
       CASE WHEN s.niveau = 'batch' THEN 380 ELSE 1520 END,
       CASE WHEN s.niveau = 'batch' THEN 440 ELSE 1760 END, 2
FROM processtap s;

-- Een paar extra velden om variatie te laten zien.
INSERT INTO veld (processtap_id, code, naam, soort, eenheid, grens_min, grens_max, tolerantie, tolerantie_soort, volgnummer)
SELECT id, 'S3.3', 'Druk', 'procesparameter', 'bar', 1, 8, 10, 'procent', 3 FROM processtap WHERE code = 'PS3';
INSERT INTO veld (processtap_id, code, naam, soort, eenheid, grens_min, grens_max, tolerantie, volgnummer)
SELECT id, 'S7.3', 'Toerental', 'procesparameter', 'rpm', 200, 1500, 50, 3 FROM processtap WHERE code = 'PS7';
INSERT INTO veld (processtap_id, code, naam, soort, eenheid, grens_max, volgnummer)
SELECT id, 'S18.3', 'Vochtgehalte', 'overig', '%', 4.0, 3 FROM processtap WHERE code = 'PS18';

-- Operators (namenlijst na gedeelde login).
INSERT INTO operator (naam) SELECT 'Operator ' || chr(64 + n) FROM generate_series(1, 8) n;

-- 20 pc's.
INSERT INTO pc (naam, locatie)
SELECT 'PC-' || lpad(n::text, 2, '0'), 'Hal ' || (1 + (n - 1) / 7) FROM generate_series(1, 20) n;

COMMIT;
