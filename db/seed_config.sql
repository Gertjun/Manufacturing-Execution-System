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

-- Fictieve routes (D55): PRD-A volgt de standaardroute (alle stappen); PRD-B slaat PS12 en PS13 over;
-- PRD-C slaat PS6, PS14 en PS17 over en doet PS11 vóór PS10.
SELECT zet_route(id, ARRAY['PS1','PS2','PS3','PS4','PS5','PS6','PS7','PS8','PS9','PS10','PS11','PS14','PS15','PS16','PS17','PS18'])
  FROM product WHERE code = 'PRD-B';
SELECT zet_route(id, ARRAY['PS1','PS2','PS3','PS4','PS5','PS7','PS8','PS9','PS11','PS10','PS12','PS13','PS15','PS16','PS18'])
  FROM product WHERE code = 'PRD-C';

-- Fictieve grenzen per product (D55): PRD-B fijn heeft een krappere temperatuur in PS5 en mag minder vocht
-- bevatten; PRD-C grof is zwaarder na PS9. De andere velden en producten volgen de grenzen van het veld.
INSERT INTO veld_product (veld_id, product_id, grens_min, grens_max, tolerantie, tolerantie_soort)
SELECT v.id, p.id, x.min, x.max, x.tol, 'absoluut'
  FROM (VALUES ('S5.1', 'PRD-B', 20, 120, 3), ('S18.3', 'PRD-B', NULL, 3.5, NULL), ('S9.2', 'PRD-C', 400, 460, NULL))
       x(veld, product, min, max, tol)
  JOIN veld v ON v.code = x.veld JOIN product p ON p.code = x.product;

-- Fictieve capaciteit per stap en product (D55): PS1 kan 8 batches per dag aan, of 3 van PRD-B; PS9 6 batches;
-- PS16 2 lots per dag.
INSERT INTO capaciteit_stap (processtap_id, product_id, max_per_dag)
SELECT s.id, p.id, x.max
  FROM (VALUES ('PS1', NULL, 8), ('PS1', 'PRD-B', 3), ('PS9', NULL, 6), ('PS16', NULL, 2)) x(stap, product, max)
  JOIN processtap s ON s.code = x.stap LEFT JOIN product p ON p.code = x.product;

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

-- Certificaat (sinds 0.17.0): fictieve bedrijfsgegevens en welke velden op het certificaat komen.
INSERT INTO instelling (sleutel, waarde) VALUES
  ('bedrijfsnaam', 'Voorbeeldfabriek B.V. (fictief)'),
  ('bedrijfsadres', 'Fabrieksweg 1, 1234 AB Voorbeeldstad'),
  ('certificaat_verklaring', 'Wij verklaren dat dit lot is geproduceerd en gecontroleerd volgens onze procedures, en dat de hieronder genoemde kenmerken binnen de specificatie vallen.');
UPDATE veld SET op_certificaat = true WHERE code IN ('S3.3', 'S7.3', 'S17.2', 'S18.2', 'S18.3');
-- Decimalen bij het tonen (sinds 0.23.0); gewichten blijven automatisch.
UPDATE veld SET decimalen = 1 WHERE code LIKE 'S%.1';
UPDATE veld SET decimalen = 2 WHERE code IN ('S3.3', 'S18.3');
UPDATE veld SET decimalen = 0 WHERE code = 'S7.3';

COMMIT;
