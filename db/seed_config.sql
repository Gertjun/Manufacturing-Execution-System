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

-- Keuringsstappen (sinds 0.51.0, #80): twee tussenkeuringen per batch en de eindkeuring per lot. Ze staan alleen
-- in de route van PRD-C (de standaardroute heeft geen keuringsstappen). Alleen Kwaliteit meet erin.
INSERT INTO processtap (code, naam, volgorde, niveau, soort) VALUES
  ('TK1', 'Tussenkeuring 1', 19, 'batch', 'keuring'),
  ('TK2', 'Tussenkeuring 2', 20, 'batch', 'keuring'),
  ('EK',  'Eindkeuring',     21, 'lot',   'keuring');
INSERT INTO veld (processtap_id, code, naam, soort, eenheid, volgnummer, gemeten_door, op_certificaat)
SELECT s.id, x.code, x.naam, 'overig', x.eenheid, x.nr, 'kwaliteit', s.code = 'EK'
  FROM (VALUES ('TK1', 'TK1.1', 'Vochtgehalte', '%', 1), ('TK1', 'TK1.2', 'Deeltjesgrootte', 'µm', 2),
               ('TK2', 'TK2.1', 'Bulkdichtheid', 'g/l', 1),
               ('EK', 'EK.1', 'Vochtgehalte', '%', 1), ('EK', 'EK.2', 'Deeltjesgrootte', 'µm', 2), ('EK', 'EK.3', 'Bulkdichtheid', 'g/l', 3))
       x(stap, code, naam, eenheid, nr)
  JOIN processtap s ON s.code = x.stap;

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

-- Fictieve routes (D55): PRD-A volgt de standaardroute (alle processtappen); PRD-B slaat PS12 en PS13 over;
-- PRD-C slaat PS6, PS14 en PS17 over, doet PS11 vóór PS10 en heeft keuringsstappen TK1, TK2 en EK (#80).
SELECT zet_route(id, ARRAY['PS1','PS2','PS3','PS4','PS5','PS6','PS7','PS8','PS9','PS10','PS11','PS14','PS15','PS16','PS17','PS18'])
  FROM product WHERE code = 'PRD-B';
SELECT zet_route(id, ARRAY['PS1','PS2','PS3','TK1','PS4','PS5','PS7','PS8','PS9','TK2','PS11','PS10','PS12','PS13','PS15','PS16','PS18','EK'])
  FROM product WHERE code = 'PRD-C';

-- Fictieve specificaties voor PRD-C (#80, D73): versie 1, vastgesteld (in de seed zonder account).
INSERT INTO specificatie (product_id, processtap_id, versie, opmerking)
SELECT p.id, s.id, 1, 'Fictieve specificatie'
  FROM product p, processtap s WHERE p.code = 'PRD-C' AND s.soort = 'keuring';
INSERT INTO specificatie_regel (specificatie_id, veld_id, grens_min, grens_max)
SELECT x.id, v.id, r.min, r.max
  FROM (VALUES ('TK1.1', NULL, 4.0), ('TK1.2', 150, 350), ('TK2.1', 560, 680),
               ('EK.1', NULL, 3.8), ('EK.2', 200, 300), ('EK.3', 580, 660)) r(veld, min, max)
  JOIN veld v ON v.code = r.veld
  JOIN specificatie x ON x.processtap_id = v.processtap_id AND x.product_id = (SELECT id FROM product WHERE code = 'PRD-C');
UPDATE specificatie SET status = 'vastgesteld', vastgesteld_op = now() WHERE status = 'concept';

-- Fictieve grenzen per product (D55): PRD-B fijn heeft een krappere temperatuur in PS5 en mag minder vocht
-- bevatten; PRD-C grof is zwaarder na PS9. De andere velden en producten volgen de grenzen van het veld.
INSERT INTO veld_product (veld_id, product_id, grens_min, grens_max, tolerantie, tolerantie_soort)
SELECT v.id, p.id, x.min, x.max, x.tol, 'absoluut'
  FROM (VALUES ('S5.1', 'PRD-B', 20, 120, 3), ('S18.3', 'PRD-B', NULL, 3.5, NULL), ('S9.2', 'PRD-C', 400, 460, NULL))
       x(veld, product, min, max, tol)
  JOIN veld v ON v.code = x.veld JOIN product p ON p.code = x.product;

-- Fictieve capaciteit per stap en product (D55, D71): PS1 kan 8 batches per dag aan van PRD-A en PRD-C, 3 van PRD-B;
-- PS9 6 batches; PS16 2 lots per dag. De andere stappen staan in Planning → Capaciteit als "nog invullen".
INSERT INTO capaciteit_stap (processtap_id, product_id, max_per_dag)
SELECT s.id, p.id, x.max
  FROM (VALUES ('PS1', 8), ('PS9', 6), ('PS16', 2)) x(stap, max)
  JOIN processtap s ON s.code = x.stap CROSS JOIN product p
 WHERE in_route(p.id, s.id);
UPDATE capaciteit_stap SET max_per_dag = 3
 WHERE processtap_id = (SELECT id FROM processtap WHERE code = 'PS1') AND product_id = (SELECT id FROM product WHERE code = 'PRD-B');

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
  ('O', 'Ochtenddienst', '06:00', '14:00'),
  ('M', 'Middagdienst', '14:00', '22:00'),
  ('N', 'Nachtdienst', '22:00', '06:00');

-- Fictief rooster (sinds 0.53.0, #86, D76): 2 ochtend, 2 middag, 2 nacht, 4 vrij; ploegen A–E in divisie 1 en 2,
-- elke ploeg twee dagen na de vorige. Zo draait per divisie elke dienst precies één ploeg.
INSERT INTO rooster (patroon) VALUES (ARRAY['O','O','M','M','N','N','-','-','-','-']);
INSERT INTO rooster_ploeg (letter, divisie, cyclus_start)
SELECT l, d, date '2026-01-05' + 2 * (ascii(l) - ascii('A'))
  FROM unnest(ARRAY['A','B','C','D','E']) l CROSS JOIN generate_series(1, 2) d;

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
-- Het vochtgehalte meet Kwaliteit in het lab (fictief, #64): na PS18 wacht het lot op de keuring.
UPDATE veld SET gemeten_door = 'kwaliteit' WHERE code = 'S18.3';

COMMIT;
