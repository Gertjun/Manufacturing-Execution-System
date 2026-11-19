-- Fictieve productiedata om de schermen mee te bekijken en te testen.
-- Na seed_config.sql uitvoeren. Maakt:
--   B-2026-0001 t/m 0004: PS1-PS15 afgerond (klaar voor een lot)
--   B-2026-0005: tot en met PS6, PS7 staat open
--   B-2026-0006: aangemaakt, nog niet gestart
--   B-2026-0007 en 0008: door planner1 gepland voor vandaag (product PRD-A)
--   Lotvoorstel 1: B-2026-0001, 0002, 0003 en 0005 (0005 is nog niet klaar)
--   Dagplanning van vandaag voor PS1: eerst B-2026-0008, dan B-2026-0007
DO $$
DECLARE
    v_pc   uuid := (SELECT id FROM fabriek.pc WHERE naam = 'PC-05');
    v_op   uuid := (SELECT id FROM fabriek.operator WHERE naam = 'Operator C');
    v_b    uuid;
    v_reg  uuid;
    v_veld record;
    v_nr   int;
    v_tot  int;
BEGIN
    SET LOCAL search_path = fabriek, public;
    FOR v_nr IN 1..6 LOOP
        INSERT INTO batch (batchnummer, aangemaakt_door)
        VALUES ('B-2026-' || lpad(v_nr::text, 4, '0'), v_op) RETURNING id INTO v_b;
        v_tot := CASE WHEN v_nr <= 4 THEN 15 WHEN v_nr = 5 THEN 7 ELSE 0 END;
        FOR k IN 1..v_tot LOOP
            v_reg := start_stap('PS' || k, v_b, NULL, v_pc, v_op);
            IF v_nr = 5 AND k = 7 THEN EXIT; END IF;  -- PS7 blijft open
            INSERT INTO grondstof_gebruik (stapregistratie_id, grondstof_id, partij, hoeveelheid, ingevoerd_door)
            SELECT v_reg, x.grondstof_id, 'LEV-' || g.code || '-2611-0' || (1 + v_nr % 2), 120, v_op
              FROM stap_grondstof x JOIN grondstof g ON g.id = x.grondstof_id JOIN processtap s ON s.id = x.processtap_id
             WHERE s.code = 'PS' || k AND x.actief;
            FOR v_veld IN SELECT v.* FROM veld v JOIN processtap s ON s.id = v.processtap_id
                          WHERE s.code = 'PS' || k AND v.actief LOOP
                INSERT INTO waarde (stapregistratie_id, veld_id, setting, gemeten, ingevoerd_door)
                VALUES (v_reg, v_veld.id,
                        CASE WHEN v_veld.soort = 'procesparameter' THEN
                             CASE v_veld.naam WHEN 'Temperatuur' THEN 80 WHEN 'Druk' THEN 5 ELSE 800 END END,
                        CASE v_veld.naam
                             WHEN 'Temperatuur' THEN 80 + ((v_nr * 7 + k * 3) % 9) - 4
                             WHEN 'Gewicht' THEN 400 + ((v_nr * 11 + k * 5) % 30)
                             WHEN 'Druk' THEN 5.1
                             WHEN 'Toerental' THEN 810
                             ELSE 3 END,
                        v_op);
            END LOOP;
            PERFORM rond_stap_af(v_reg);
        END LOOP;
    END LOOP;
END $$;

-- Planning (sinds 0.9.0).
DO $$
DECLARE
    v_planner uuid := (SELECT id FROM fabriek.gebruiker WHERE gebruikersnaam = 'planner1');
BEGIN
    SET LOCAL search_path = fabriek, public;
    PERFORM plan_batches(2, current_date, (SELECT id FROM product WHERE code = 'PRD-A'), NULL, v_planner);
    PERFORM bewaar_lot_voorstel(NULL,
        ARRAY(SELECT id FROM batch WHERE batchnummer IN ('B-2026-0001','B-2026-0002','B-2026-0003','B-2026-0005')), NULL, v_planner);
    INSERT INTO stapplanning (dag, processtap_id, batch_id, volgorde, opmerking, aangemaakt_door)
    SELECT current_date, (SELECT id FROM processtap WHERE code = 'PS1'), b.id, v.n, v.opm, v_planner
      FROM (VALUES ('B-2026-0008', 1, 'Spoed: eerst deze'), ('B-2026-0007', 2, NULL)) v(nr, n, opm)
      JOIN batch b ON b.batchnummer = v.nr;
END $$;
