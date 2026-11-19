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

-- Fictieve producten (de planner kan ze aanpassen in Portaal Planning).
INSERT INTO product (code, naam) VALUES
  ('PRD-A', 'Product A standaard'),
  ('PRD-B', 'Product B fijn'),
  ('PRD-C', 'Product C grof');

-- Fictieve grondstoffen en in welke stap ze worden ingevoerd (sinds 0.11.0).
INSERT INTO grondstof (code, naam, eenheid) VALUES
  ('GS-A', 'Grondstof A', 'kg'),
  ('GS-B', 'Grondstof B', 'kg'),
  ('HS-C', 'Hulpstof C', 'l');
INSERT INTO stap_grondstof (processtap_id, grondstof_id, verplicht)
SELECT s.id, g.id, v.verplicht
  FROM (VALUES ('PS1', 'GS-A', true), ('PS3', 'GS-B', true), ('PS9', 'HS-C', false)) v(stap, gs, verplicht)
  JOIN processtap s ON s.code = v.stap JOIN grondstof g ON g.code = v.gs;

-- Fictieve ploegen (sinds 0.12.0).
INSERT INTO ploeg (code, naam, begint, eindigt) VALUES
  ('O', 'Ochtendploeg', '06:00', '14:00'),
  ('M', 'Middagploeg', '14:00', '22:00'),
  ('N', 'Nachtploeg', '22:00', '06:00');

-- Fictieve oorzaken van stilstand (sinds 0.14.0).
INSERT INTO stilstand_oorzaak (code, naam, categorie) VALUES
  ('STOR-MACH', 'Machinestoring', 'storing'),
  ('STOR-ELEK', 'Elektrische storing', 'storing'),
  ('WACHT-GS', 'Wachten op grondstof', 'wachten'),
  ('WACHT-KW', 'Wachten op Kwaliteit', 'wachten'),
  ('OMSTEL', 'Omstellen', 'gepland'),
  ('SCHOON', 'Schoonmaken', 'gepland'),
  ('ONDERH', 'Gepland onderhoud', 'gepland'),
  ('OVERIG', 'Overig', 'overig');

-- Fictieve capaciteit: 6 batches per dag, ook in het weekend (de fictieve fabriek draait 24/7; sinds 0.16.0).
INSERT INTO capaciteit (weekdag, max_batches) VALUES (1, 6), (2, 6), (3, 6), (4, 6), (5, 6), (6, 6), (7, 6);

COMMIT;
