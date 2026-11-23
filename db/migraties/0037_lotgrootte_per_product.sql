-- Migratie 0037 (0.64.0): lotgrootte per product (eerste databasefase van #104).
SET search_path = fabriek, public;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM lot l WHERE (SELECT count(*) FROM batch b WHERE b.lot_id = l.id) NOT BETWEEN 1 AND 50) THEN
        RAISE EXCEPTION 'Migratie 0037 gestopt: een historisch lot heeft geen geldig aantal batches (1–50); beoordeel eerst de lot-batchkoppelingen';
    END IF;
END $$;
ALTER TABLE product ADD COLUMN batches_per_lot integer NOT NULL DEFAULT 4 CHECK (batches_per_lot BETWEEN 1 AND 50);
ALTER TABLE lot ADD COLUMN batch_aantal_norm integer, ADD COLUMN batch_aantal integer, ADD COLUMN afwijking_reden text;
UPDATE lot l SET batch_aantal_norm=4, batch_aantal=(SELECT count(*)::int FROM batch b WHERE b.lot_id=l.id),
 afwijking_reden=CASE WHEN (SELECT count(*) FROM batch b WHERE b.lot_id=l.id)=4 THEN NULL
 ELSE 'Historisch lot; aantal wijkt af van de toenmalige norm van vier.' END;
ALTER TABLE lot ALTER COLUMN batch_aantal_norm SET NOT NULL, ALTER COLUMN batch_aantal SET NOT NULL,
 ADD CONSTRAINT lot_batch_aantal_norm_geldig CHECK (batch_aantal_norm BETWEEN 1 AND 50),
 ADD CONSTRAINT lot_batch_aantal_geldig CHECK (batch_aantal BETWEEN 1 AND 50),
 ADD CONSTRAINT lot_batch_aantal_afwijking CHECK ((batch_aantal=batch_aantal_norm AND afwijking_reden IS NULL)
 OR (batch_aantal<>batch_aantal_norm AND length(btrim(afwijking_reden)) BETWEEN 3 AND 500));
ALTER TABLE lot_voorstel ADD COLUMN batch_aantal_norm integer NOT NULL DEFAULT 4 CHECK (batch_aantal_norm BETWEEN 1 AND 50);

CREATE FUNCTION verval_lotvoorstellen_bij_lotgrootte() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    UPDATE lot_voorstel v SET status = 'vervallen', afgesloten_op = clock_timestamp()
     WHERE v.status = 'open'
       AND EXISTS (SELECT 1 FROM lot_voorstel_batch x JOIN batch b ON b.id = x.batch_id
                    WHERE x.voorstel_id = v.id AND b.product_id = NEW.id);
    RETURN NEW;
END $$;
CREATE TRIGGER product_lotgrootte_verval_voorstellen
AFTER UPDATE OF batches_per_lot ON product
FOR EACH ROW WHEN (OLD.batches_per_lot IS DISTINCT FROM NEW.batches_per_lot)
EXECUTE FUNCTION verval_lotvoorstellen_bij_lotgrootte();

DROP FUNCTION IF EXISTS maak_lot(text, uuid[], uuid, uuid, uuid, uuid);
CREATE OR REPLACE FUNCTION maak_lot(p_lotnummer text, p_batches uuid[], p_pc uuid, p_operator uuid,
                         p_lot_id uuid DEFAULT NULL, p_registratie_id uuid DEFAULT NULL,
                         p_afwijking_reden text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_lot       uuid;
    v_lotstap   processtap%ROWTYPE;
    v_probleem  text;
    v_voorstel  record;
    v_reden text := nullif(btrim(p_afwijking_reden), '');
    v_product uuid;
    v_norm int;
    v_aantal int;
BEGIN
    IF coalesce(cardinality(p_batches), 0) NOT BETWEEN 1 AND 50
       OR (SELECT count(DISTINCT b) FROM unnest(coalesce(p_batches, '{}'::uuid[])) b) <> cardinality(p_batches) THEN
        RAISE EXCEPTION 'Een lot bestaat uit 1 tot 50 verschillende batches';
    END IF;

    SELECT * INTO v_lotstap FROM processtap WHERE is_lot_stap AND actief;

    -- Lock de batches zodat ze niet tegelijk in twee lots komen.
    PERFORM 1 FROM batch WHERE id = ANY(p_batches) FOR UPDATE;

    SELECT count(*) INTO v_aantal FROM batch WHERE id = ANY(p_batches);
    IF v_aantal <> cardinality(p_batches) THEN RAISE EXCEPTION 'Een of meer opgegeven batches bestaan niet'; END IF;
    IF EXISTS (SELECT 1 FROM batch WHERE id = ANY(p_batches) AND product_id IS NULL)
       OR (SELECT count(DISTINCT product_id) FROM batch WHERE id = ANY(p_batches)) <> 1 THEN
        RAISE EXCEPTION 'Een lot bestaat uit batches van hetzelfde product';
    END IF;
    SELECT product_id INTO v_product FROM batch WHERE id = ANY(p_batches) ORDER BY product_id LIMIT 1;
    SELECT batches_per_lot INTO v_norm FROM product WHERE id = v_product FOR UPDATE;
    IF v_norm IS NULL THEN RAISE EXCEPTION 'Het product heeft geen geldige lotgrootte'; END IF;
    IF cardinality(p_batches) <> v_norm AND v_reden IS NULL THEN
        RAISE EXCEPTION 'Een lot bestaat uit precies % batches voor dit product; geef een reden om hiervan af te wijken', v_norm;
    END IF;

    -- Elke batch: in productie, en alle batchstappen van zijn route afgerond.
    SELECT string_agg(probleem, '; ') INTO v_probleem FROM (
        SELECT b.batchnummer || ' heeft status ' || b.status AS probleem
          FROM batch b WHERE b.id = ANY(p_batches) AND b.status <> 'in_productie'
        UNION ALL
        SELECT b.batchnummer || ': ' || s.code || ' niet afgerond'
          FROM batch b
          CROSS JOIN LATERAL route(b.product_id) rt
          JOIN processtap s ON s.id = rt.processtap_id
         WHERE b.id = ANY(p_batches) AND s.niveau = 'batch'
           AND NOT batch_stap_gedaan(b.id, s.id)
        UNION ALL
        SELECT b.batchnummer || ': herbewerking naar ' || s.code || ' nog niet gestart'
          FROM herbewerking h JOIN batch b ON b.id = h.batch_id JOIN processtap s ON s.id = h.processtap_id
         WHERE h.batch_id = ANY(p_batches) AND h.status = 'open'
        UNION ALL
        SELECT 'onbekende batch ' || x::text FROM unnest(p_batches) x
         WHERE NOT EXISTS (SELECT 1 FROM batch WHERE id = x)
    ) p;
    IF v_probleem IS NOT NULL THEN
        RAISE EXCEPTION 'Lot kan niet worden aangemaakt: %', v_probleem;
    END IF;

    -- Open voorstellen waar een van deze batches in staat.
    FOR v_voorstel IN
        SELECT v.id, v.nummer,
               (SELECT array_agg(x.batch_id ORDER BY x.batch_id) FROM lot_voorstel_batch x WHERE x.voorstel_id = v.id) AS batches
          FROM lot_voorstel v
         WHERE v.status = 'open'
           AND EXISTS (SELECT 1 FROM lot_voorstel_batch x WHERE x.voorstel_id = v.id AND x.batch_id = ANY(p_batches))
         FOR UPDATE OF v
    LOOP
        IF v_voorstel.batches <> (SELECT array_agg(b ORDER BY b) FROM unnest(p_batches) b) AND v_reden IS NULL THEN
            RAISE EXCEPTION 'Deze samenstelling wijkt af van lotvoorstel %; geef een reden', v_voorstel.nummer;
        END IF;
    END LOOP;

    INSERT INTO lot (id, lotnummer, batch_aantal_norm, batch_aantal, afwijking_reden)
    VALUES (coalesce(p_lot_id, gen_random_uuid()), p_lotnummer, v_norm, cardinality(p_batches),
            CASE WHEN cardinality(p_batches) <> v_norm THEN v_reden ELSE NULL END)
    RETURNING id INTO v_lot;
    UPDATE batch SET status = 'in_lot', lot_id = v_lot WHERE id = ANY(p_batches);

    -- Voorstellen afsluiten: precies gevolgd = gebruikt, anders afgeweken (met reden).
    UPDATE lot_voorstel v
       SET status = CASE WHEN (SELECT array_agg(x.batch_id ORDER BY x.batch_id) FROM lot_voorstel_batch x WHERE x.voorstel_id = v.id)
                              = (SELECT array_agg(b ORDER BY b) FROM unnest(p_batches) b)
                         THEN 'gebruikt' ELSE 'afgeweken' END,
           afwijking_reden = CASE WHEN (SELECT array_agg(x.batch_id ORDER BY x.batch_id) FROM lot_voorstel_batch x WHERE x.voorstel_id = v.id)
                                       = (SELECT array_agg(b ORDER BY b) FROM unnest(p_batches) b)
                                  THEN NULL ELSE v_reden END,
           lot_id = v_lot,
           afgesloten_op = now()
     WHERE v.status = 'open'
       AND EXISTS (SELECT 1 FROM lot_voorstel_batch x WHERE x.voorstel_id = v.id AND x.batch_id = ANY(p_batches));

    PERFORM set_config('fabriek.maak_lot', 'aan', true);
    INSERT INTO stapregistratie (id, processtap_id, lot_id, poging, pc_id, operator_id)
    VALUES (coalesce(p_registratie_id, gen_random_uuid()), v_lotstap.id, v_lot, 1, p_pc, p_operator);
    PERFORM set_config('fabriek.maak_lot', 'uit', true);

    RETURN v_lot;
END $$;

-- Een lot terug laten gaan naar een eerdere lot-stap.
CREATE FUNCTION start_herbewerking(p_lot uuid, p_stapcode text, p_reden text, p_pc uuid, p_operator uuid,
                                   p_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_stap  processtap%ROWTYPE;
    v_reg   uuid;
BEGIN
    SELECT * INTO v_stap FROM processtap WHERE code = p_stapcode AND actief;
    IF NOT FOUND OR v_stap.niveau <> 'lot' THEN
        RAISE EXCEPTION 'Herbewerking kan alleen naar een actieve lot-stap';
    END IF;
    INSERT INTO stapregistratie (id, processtap_id, lot_id, poging, herbewerking_start, reden, pc_id, operator_id)
    VALUES (coalesce(p_id, gen_random_uuid()), v_stap.id, p_lot,
            (SELECT coalesce(max(poging),0) + 1 FROM stapregistratie WHERE processtap_id = v_stap.id AND lot_id = p_lot),
            true, p_reden, p_pc, p_operator)
    RETURNING id INTO v_reg;
    RETURN v_reg;
END $$;

-- Een stap starten voor een batch of lot; poging wordt bepaald.
CREATE FUNCTION start_stap(p_stapcode text, p_batch uuid, p_lot uuid, p_pc uuid, p_operator uuid,
                           p_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_stap  uuid;
    v_reg   uuid;
BEGIN
    SELECT id INTO v_stap FROM processtap WHERE code = p_stapcode;
    IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende stap %', p_stapcode; END IF;
    INSERT INTO stapregistratie (id, processtap_id, batch_id, lot_id, poging, pc_id, operator_id)
    VALUES (coalesce(p_id, gen_random_uuid()), v_stap, p_batch, p_lot,
            (SELECT coalesce(max(poging),0) + 1 FROM stapregistratie
              WHERE processtap_id = v_stap AND (batch_id = p_batch OR lot_id = p_lot)),
            p_pc, p_operator)
    RETURNING id INTO v_reg;
    -- Een keuringsstap (#80) heeft geen werk voor de vloer: meteen afgerond, dan staat de keuring open voor Kwaliteit.
    IF (SELECT soort FROM processtap WHERE id = v_stap) = 'keuring' THEN
        PERFORM rond_stap_af(v_reg, p_operator, p_pc);
    END IF;
    RETURN v_reg;
END $$;

-- Nainvoeren na papier (sinds migratie 0024, #75, D60). Lag de invoer stil (server en pc tegelijk), dan
-- registreerde de ploeg op papier. Een ploegleider of beheerder voert de stap daarna in met de tijden van
-- het papier, tot 7 dagen terug, met wie het deed, op welke pc, de waarden, de grondstoffen en een reden.
-- Alle gewone regels gelden (volgorde, route, grenzen, meldingen). In de lot-stap stelt dit ook het lot
-- samen (p_nummer is dan het lotnummer, p_batches de 4 batchnummers).
CREATE FUNCTION lever_stap_na(p_stapcode text, p_nummer text, p_batches text[], p_pc uuid, p_operator uuid,
                              p_begin timestamptz, p_eind timestamptz, p_reden text, p_gebruiker uuid,
                              p_waarden jsonb, p_grondstoffen jsonb)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_reden  text := nullif(btrim(p_reden), '');
    v_stap   processtap%ROWTYPE;
    v_batch  uuid;
    v_lot    uuid;
    v_ids    uuid[];
    v_vorige timestamptz;
    v_reg    uuid;
    v_oud    text := current_setting('fabriek.moment', true);
    v_w      jsonb;
    v_veld   uuid;
    v_gs     uuid;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM gebruiker WHERE id = p_gebruiker AND actief AND rol IN ('ploegleider', 'beheerder')) THEN
        RAISE EXCEPTION 'Alleen een ploegleider of beheerder kan nainvoeren';
    END IF;
    IF v_reden IS NULL THEN
        RAISE EXCEPTION 'Geef een reden voor het nainvoeren';
    END IF;
    IF p_begin IS NULL OR p_eind IS NULL OR p_eind <= p_begin THEN
        RAISE EXCEPTION 'Het einde moet na het begin liggen';
    END IF;
    IF p_eind > clock_timestamp() THEN
        RAISE EXCEPTION 'Het einde ligt in de toekomst';
    END IF;
    IF p_begin < clock_timestamp() - interval '7 days' THEN
        RAISE EXCEPTION 'Nainvoeren kan tot 7 dagen terug';
    END IF;
    SELECT * INTO v_stap FROM processtap WHERE code = p_stapcode AND actief;
    IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende stap %', p_stapcode; END IF;
    IF v_stap.soort = 'keuring' THEN
        RAISE EXCEPTION 'Stap % is een keuring; die doet Kwaliteit in het invoerscherm', p_stapcode;
    END IF;

    IF v_stap.is_lot_stap THEN
        SELECT array_agg(b.id), max((SELECT max(r.afgerond_op) FROM stapregistratie r WHERE r.batch_id = b.id))
          INTO v_ids, v_vorige
          FROM batch b WHERE b.batchnummer = ANY(p_batches);
        IF coalesce(cardinality(v_ids), 0) <> coalesce(cardinality(p_batches), 0) THEN
            RAISE EXCEPTION 'Onbekend batchnummer: %',
                (SELECT string_agg(x, ', ') FROM unnest(p_batches) x WHERE NOT EXISTS (SELECT 1 FROM batch WHERE batchnummer = x));
        END IF;
    ELSIF v_stap.niveau = 'batch' THEN
        SELECT id INTO v_batch FROM batch WHERE batchnummer = p_nummer;
        IF NOT FOUND THEN RAISE EXCEPTION 'Onbekend batchnummer %', p_nummer; END IF;
        SELECT max(afgerond_op) INTO v_vorige FROM stapregistratie WHERE batch_id = v_batch;
    ELSE
        SELECT id INTO v_lot FROM lot WHERE lotnummer = p_nummer;
        IF NOT FOUND THEN RAISE EXCEPTION 'Onbekend lotnummer %', p_nummer; END IF;
        SELECT max(r.afgerond_op) INTO v_vorige FROM stapregistratie r
         WHERE r.lot_id = v_lot OR r.batch_id IN (SELECT b.id FROM batch b WHERE b.lot_id = v_lot);
    END IF;
    IF v_vorige IS NOT NULL AND p_begin < v_vorige THEN
        RAISE EXCEPTION 'Het begin ligt vóór het einde van de vorige stap (%)', to_char(v_vorige, 'DD-MM-YYYY HH24:MI');
    END IF;

    -- Starten met de tijd van het papier (zie apparaat_moment).
    PERFORM set_config('fabriek.moment', p_begin::text, true);
    IF v_stap.is_lot_stap THEN
        v_lot := maak_lot(p_nummer, v_ids, p_pc, p_operator, NULL, NULL, 'Nageleverd van papier: ' || v_reden);
        UPDATE lot SET aangemaakt_op = p_begin WHERE id = v_lot;
        SELECT id INTO v_reg FROM stapregistratie WHERE lot_id = v_lot AND processtap_id = v_stap.id;
    ELSE
        v_reg := start_stap(p_stapcode, v_batch, v_lot, p_pc, p_operator);
    END IF;
    UPDATE stapregistratie SET nageleverd_door = p_gebruiker, nageleverd_reden = v_reden, nageleverd_op = clock_timestamp()
     WHERE id = v_reg;

    -- Waarden, grondstoffen en afronden met het einde van het papier.
    PERFORM set_config('fabriek.moment', p_eind::text, true);
    FOR v_w IN SELECT * FROM jsonb_array_elements(coalesce(p_waarden, '[]'::jsonb)) LOOP
        SELECT id INTO v_veld FROM veld WHERE processtap_id = v_stap.id AND code = v_w ->> 'veldcode' AND actief;
        IF NOT FOUND THEN RAISE EXCEPTION 'Veld % hoort niet bij stap %', v_w ->> 'veldcode', p_stapcode; END IF;
        INSERT INTO waarde (stapregistratie_id, veld_id, setting, gemeten, ingevoerd_door)
        VALUES (v_reg, v_veld, (v_w ->> 'setting')::numeric, (v_w ->> 'gemeten')::numeric, p_operator);
    END LOOP;
    FOR v_w IN SELECT * FROM jsonb_array_elements(coalesce(p_grondstoffen, '[]'::jsonb)) LOOP
        SELECT id INTO v_gs FROM grondstof WHERE code = v_w ->> 'code';
        IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende grondstof %', v_w ->> 'code'; END IF;
        INSERT INTO grondstof_gebruik (stapregistratie_id, grondstof_id, partij, hoeveelheid, ingevoerd_door)
        VALUES (v_reg, v_gs, v_w ->> 'partij', (v_w ->> 'hoeveelheid')::numeric, p_operator);
    END LOOP;
    PERFORM rond_stap_af(v_reg, p_operator, p_pc);

    INSERT INTO config_log (tabel, record_id, actie, nieuw)
    VALUES ('nalevering', v_reg, 'INSERT', jsonb_build_object(
        'stap', p_stapcode, 'nummer', p_nummer, 'batches', p_batches, 'begin', p_begin, 'eind', p_eind, 'reden', v_reden,
        'operator', (SELECT naam FROM operator WHERE id = p_operator), 'pc', (SELECT naam FROM pc WHERE id = p_pc)));
    PERFORM set_config('fabriek.moment', coalesce(v_oud, ''), true);
    RETURN v_reg;
END $$;

-- ---------------------------------------------------------------------
-- Werkvoorraad: welke batches of lots klaar staan voor een stap
-- ---------------------------------------------------------------------

CREATE FUNCTION werkvoorraad(p_stapcode text)
RETURNS TABLE (soort text, nummer text, sinds timestamptz) LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_stap    processtap%ROWTYPE;
BEGIN
    SELECT * INTO v_stap FROM processtap WHERE code = p_stapcode AND actief;
    IF NOT FOUND THEN RETURN; END IF;

    -- De vorige stap hangt af van de route van het product (D55).
    IF v_stap.is_lot_stap THEN
        -- Batches die alle batchstappen van hun route afrondden en in productie zijn.
        RETURN QUERY
        SELECT 'batch', b.batchnummer,
               (SELECT max(r.afgerond_op) FROM stapregistratie r WHERE r.batch_id = b.id)
          FROM batch b
         WHERE b.status = 'in_productie' AND batch_klaar_voor_lot(b.id)
         ORDER BY 3;
    ELSIF v_stap.niveau = 'batch' THEN
        -- Volgende stap volgens de route (met herbewerkingen meegerekend, sinds 0021), plus de batches
        -- met een herbewerking naar deze stap die nog niet gestart is.
        RETURN QUERY
        SELECT x.soort, x.nummer, x.sinds FROM (
            SELECT 'batch'::text AS soort, b.batchnummer AS nummer,
                   coalesce((SELECT max(r.afgerond_op) FROM stapregistratie r
                              WHERE r.batch_id = b.id AND r.processtap_id = v.vorige),
                            CASE WHEN b.status = 'gepland' THEN greatest(b.aangemaakt_op, b.geplande_dag::timestamptz) ELSE b.aangemaakt_op END) AS sinds
              FROM batch b
              CROSS JOIN LATERAL (SELECT route_vorige(b.product_id, v_stap.id) AS vorige) v
             WHERE b.status IN ('in_productie', 'gepland')
               AND (b.status = 'in_productie' OR (v.vorige IS NULL AND b.geplande_dag <= current_date))
               AND in_route(b.product_id, v_stap.id)
               AND NOT EXISTS (SELECT 1 FROM herbewerking h WHERE h.batch_id = b.id AND h.status = 'open')
               AND NOT EXISTS (SELECT 1 FROM keuring k JOIN stapregistratie r ON r.id = k.stapregistratie_id
                                WHERE r.batch_id = b.id AND k.status = 'open')   -- wacht op Kwaliteit (sinds 0022)
               AND NOT EXISTS (SELECT 1 FROM stapregistratie r WHERE r.batch_id = b.id AND r.processtap_id = v_stap.id AND r.status = 'open')
               AND NOT batch_stap_gedaan(b.id, v_stap.id)
               AND (v.vorige IS NULL OR batch_stap_gedaan(b.id, v.vorige))
            UNION ALL
            SELECT 'batch', b.batchnummer, h.aangemaakt_op
              FROM herbewerking h JOIN batch b ON b.id = h.batch_id
             WHERE h.status = 'open' AND h.processtap_id = v_stap.id AND b.status = 'in_productie'
               AND NOT EXISTS (SELECT 1 FROM stapregistratie r WHERE r.batch_id = b.id AND r.status = 'open')
        ) x
         ORDER BY 3;
    ELSE
        -- Lotstap na de lot-stap: vorige stap (laatste poging) afgerond en
        -- deze stap sindsdien nog niet gestart.
        -- Plus lots met een herbewerking naar deze stap die nog niet gestart is (sinds 0021).
        RETURN QUERY
        SELECT x.soort, x.nummer, x.sinds FROM (
            SELECT 'lot'::text AS soort, l.lotnummer AS nummer, vr.afgerond_op AS sinds
              FROM lot l
              CROSS JOIN LATERAL (SELECT route_vorige(lot_product(l.id), v_stap.id) AS vorige) v
              JOIN LATERAL (SELECT r.* FROM stapregistratie r WHERE r.lot_id = l.id AND r.processtap_id = v.vorige
                             ORDER BY r.poging DESC LIMIT 1) vr ON vr.status = 'afgerond'
                     AND NOT EXISTS (SELECT 1 FROM keuring k WHERE k.stapregistratie_id = vr.id AND k.status <> 'vrijgegeven')
              LEFT JOIN LATERAL (SELECT r.* FROM stapregistratie r WHERE r.lot_id = l.id AND r.processtap_id = v_stap.id
                                  ORDER BY r.poging DESC LIMIT 1) dr ON true
             WHERE l.status = 'in_productie'
               AND NOT EXISTS (SELECT 1 FROM herbewerking h WHERE h.lot_id = l.id AND h.status = 'open')
               AND (dr.id IS NULL OR dr.gestart_op < vr.afgerond_op)
            UNION ALL
            SELECT 'lot', l.lotnummer, h.aangemaakt_op
              FROM herbewerking h JOIN lot l ON l.id = h.lot_id
             WHERE h.status = 'open' AND h.processtap_id = v_stap.id AND l.status IN ('in_productie', 'gereed')
               AND NOT EXISTS (SELECT 1 FROM stapregistratie r WHERE r.lot_id = l.id AND r.status = 'open')
        ) x
         ORDER BY 3;
    END IF;
END $$;

-- ---------------------------------------------------------------------
-- Lotpaspoort: alle actuele waarden van een lot en zijn 4 batches
-- ---------------------------------------------------------------------

CREATE VIEW lotpaspoort AS
SELECT l.lotnummer,
       coalesce(b.batchnummer, l.lotnummer)  AS batch_of_lot,
       s.code      AS stap,
       s.volgorde,
       r.poging,
       r.herbewerking_start,
       r.reden     AS herbewerking_reden,
       v.code      AS veld,
       v.naam      AS veldnaam,
       v.eenheid,
       w.setting,
       w.gemeten,
       w.grens_min, w.grens_max, w.tolerantie, w.tolerantie_soort,
       w.markering,
       (w.vervangt_waarde_id IS NOT NULL) AS gecorrigeerd,
       o.naam      AS operator,
       p.naam      AS pc,
       r.afgerond_op,
       v.decimalen,   -- sinds migratie 0015
       (r.nageleverd_door IS NOT NULL) AS nageleverd   -- van papier, sinds migratie 0024
FROM lot l
JOIN stapregistratie r
  ON r.lot_id = l.id
  OR r.batch_id IN (SELECT id FROM batch WHERE lot_id = l.id)
LEFT JOIN batch b ON b.id = r.batch_id
JOIN processtap s ON s.id = r.processtap_id
JOIN waarde_actueel w ON w.stapregistratie_id = r.id
JOIN veld v ON v.id = w.veld_id
JOIN operator o ON o.id = r.operator_id
JOIN pc p ON p.id = r.pc_id;

-- ---------------------------------------------------------------------
-- Planning (sinds migratie 0003, versie 0.9.0)
-- ---------------------------------------------------------------------

CREATE FUNCTION plan_batches(p_aantal int, p_dag date, p_product uuid, p_opmerking text, p_door uuid)
RETURNS SETOF text LANGUAGE plpgsql AS $$
DECLARE
    v_jaar     text := to_char(current_date, 'YYYY');
    v_volgend  int;
    v_volgorde int;
    v_nummer   text;
BEGIN
    IF p_aantal IS NULL OR p_aantal < 1 OR p_aantal > 50 THEN
        RAISE EXCEPTION 'Plan 1 tot 50 batches tegelijk';
    END IF;
    IF p_dag IS NULL THEN RAISE EXCEPTION 'Kies een dag'; END IF;
    IF p_product IS NOT NULL AND NOT EXISTS (SELECT 1 FROM product WHERE id = p_product AND actief) THEN
        RAISE EXCEPTION 'Onbekend of uitgezet product';
    END IF;
    -- Eén planner tegelijk aan de nummers.
    PERFORM pg_advisory_xact_lock(hashtext('fabriek.batchnummer'));
    SELECT coalesce(max(substr(batchnummer, 8)::int), 0) + 1 INTO v_volgend
      FROM batch WHERE batchnummer LIKE 'B-' || v_jaar || '-%';
    SELECT coalesce(max(volgorde), 0) INTO v_volgorde FROM batch WHERE geplande_dag = p_dag;
    FOR i IN 1..p_aantal LOOP
        IF v_volgend > 9999 THEN RAISE EXCEPTION 'Batchnummers voor % zijn op', v_jaar; END IF;
        v_nummer := 'B-' || v_jaar || '-' || lpad(v_volgend::text, 4, '0');
        INSERT INTO batch (batchnummer, bron, status, geplande_dag, volgorde, product_id, opmerking, gepland_door)
        VALUES (v_nummer, 'planner', 'gepland', p_dag, v_volgorde + i, p_product, nullif(btrim(p_opmerking), ''), p_door);
        v_volgend := v_volgend + 1;
        RETURN NEXT v_nummer;
    END LOOP;
END $$;

-- Een geplande batch begint bij de eerste batchstap; daarmee gaat hij in productie.
-- (Loopt vóór stapregistratie_controle: triggers gaan op alfabetische naam.)
CREATE FUNCTION start_geplande_batch() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_status  text;
    v_eerste  uuid;
BEGIN
    IF NEW.batch_id IS NULL THEN RETURN NEW; END IF;
    SELECT status INTO v_status FROM batch WHERE id = NEW.batch_id FOR UPDATE;
    IF v_status = 'gepland' THEN
        v_eerste := route_eerste((SELECT product_id FROM batch WHERE id = NEW.batch_id), 'batch');
        IF NEW.processtap_id IS DISTINCT FROM v_eerste THEN
            RAISE EXCEPTION 'Deze batch is gepland en nog niet gestart; begin met %',
                (SELECT code FROM processtap WHERE id = v_eerste);
        END IF;
        UPDATE batch SET status = 'in_productie' WHERE id = NEW.batch_id;
    ELSIF v_status = 'vervallen' THEN
        RAISE EXCEPTION 'Deze batch is vervallen en kan niet starten';
    END IF;
    UPDATE batch SET gestart_op = coalesce(gestart_op, NEW.gestart_op) WHERE id = NEW.batch_id AND gestart_op IS NULL;
    RETURN NEW;
END $$;
CREATE TRIGGER stapregistratie_a_start BEFORE INSERT ON stapregistratie
    FOR EACH ROW EXECUTE FUNCTION start_geplande_batch();

-- Planningsgegevens alleen wijzigen zolang de batch gepland is (opmerking mag altijd).
CREATE FUNCTION bewaak_batchplanning() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status <> 'gepland' AND (NEW.geplande_dag IS DISTINCT FROM OLD.geplande_dag
        OR NEW.volgorde IS DISTINCT FROM OLD.volgorde OR NEW.product_id IS DISTINCT FROM OLD.product_id) THEN
        RAISE EXCEPTION 'Batch % is al gestart; dag, volgorde en product liggen vast', OLD.batchnummer;
    END IF;
    IF NEW.status = 'vervallen' AND OLD.status <> 'gepland' THEN
        RAISE EXCEPTION 'Alleen een geplande batch die nog niet gestart is kan vervallen';
    END IF;
    -- Een lotvoorstel heeft batches van één product (D55).
    IF NEW.product_id IS DISTINCT FROM OLD.product_id AND EXISTS (
        SELECT 1 FROM lot_voorstel_batch x JOIN lot_voorstel v ON v.id = x.voorstel_id
         WHERE x.batch_id = NEW.id AND v.status = 'open') THEN
        RAISE EXCEPTION 'Batch % staat in een open lotvoorstel; haal hem daar eerst uit voor je het product wijzigt', OLD.batchnummer;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER batch_planning_bewaak BEFORE UPDATE ON batch
    FOR EACH ROW EXECUTE FUNCTION bewaak_batchplanning();

CREATE TABLE lot_voorstel (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nummer int GENERATED ALWAYS AS IDENTITY UNIQUE,
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','gebruikt','afgeweken','vervallen')),
    opmerking text,
    aangemaakt_door uuid NOT NULL REFERENCES gebruiker(id),
    aangemaakt_op timestamptz NOT NULL DEFAULT now(),
    lot_id uuid REFERENCES lot(id),
    afwijking_reden text,
    afgesloten_op timestamptz,
    batch_aantal_norm int NOT NULL DEFAULT 4 CHECK (batch_aantal_norm BETWEEN 1 AND 50),
    CHECK ((status IN ('gebruikt','afgeweken')) = (lot_id IS NOT NULL)),
    CHECK ((status = 'afgeweken') = (afwijking_reden IS NOT NULL))
);
CREATE TABLE lot_voorstel_batch (
    voorstel_id  uuid NOT NULL REFERENCES lot_voorstel(id),
    batch_id     uuid NOT NULL REFERENCES batch(id),
    PRIMARY KEY (voorstel_id, batch_id)
);
CREATE INDEX lot_voorstel_batch_batch ON lot_voorstel_batch (batch_id);

-- Een batch staat in hoogstens één open voorstel; het voorstel volgt de ingestelde lotgrootte van het product.

CREATE OR REPLACE FUNCTION controleer_lot_voorstel(p_voorstel uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_dubbel text; v_product uuid; v_norm int;
BEGIN
    IF (SELECT status FROM lot_voorstel WHERE id = p_voorstel) <> 'open' THEN RETURN; END IF;
    SELECT b.product_id INTO v_product FROM lot_voorstel_batch x JOIN batch b ON b.id = x.batch_id
     WHERE x.voorstel_id = p_voorstel ORDER BY b.product_id LIMIT 1;
    IF v_product IS NULL OR EXISTS (SELECT 1 FROM lot_voorstel_batch x JOIN batch b ON b.id = x.batch_id
                                     WHERE x.voorstel_id = p_voorstel AND b.product_id IS DISTINCT FROM v_product) THEN
        RAISE EXCEPTION 'Een lotvoorstel bestaat uit batches van hetzelfde product';
    END IF;
    SELECT batches_per_lot INTO v_norm FROM product WHERE id = v_product;
    IF v_norm IS NULL OR (SELECT batch_aantal_norm FROM lot_voorstel WHERE id = p_voorstel) <> v_norm THEN
        RAISE EXCEPTION 'De lotgrootte is gewijzigd; bouw dit lotvoorstel opnieuw op';
    END IF;
    IF (SELECT count(*) FROM lot_voorstel_batch WHERE voorstel_id = p_voorstel) <> v_norm THEN
        RAISE EXCEPTION 'Een lotvoorstel voor dit product bestaat uit precies % batches', v_norm;
    END IF;
    SELECT string_agg(b.batchnummer || ' (voorstel ' || v2.nummer || ')', ', ') INTO v_dubbel
      FROM lot_voorstel_batch x JOIN lot_voorstel_batch y ON y.batch_id = x.batch_id AND y.voorstel_id <> x.voorstel_id
      JOIN lot_voorstel v2 ON v2.id = y.voorstel_id AND v2.status = 'open'
      JOIN batch b ON b.id = x.batch_id WHERE x.voorstel_id = p_voorstel;
    IF v_dubbel IS NOT NULL THEN RAISE EXCEPTION 'Deze batches staan al in een ander open voorstel: %', v_dubbel; END IF;
    IF EXISTS (SELECT 1 FROM lot_voorstel_batch x JOIN batch b ON b.id = x.batch_id
                WHERE x.voorstel_id = p_voorstel AND b.status NOT IN ('gepland','in_productie','in_beoordeling')) THEN
        RAISE EXCEPTION 'Een lotvoorstel kan alleen batches bevatten die nog niet in een lot zitten, niet afgekeurd en niet vervallen';
    END IF;
END $$;

-- Lotvoorstel opslaan (nieuw of batches vervangen); controleert alles in één keer.

CREATE OR REPLACE FUNCTION bewaar_lot_voorstel(p_id uuid, p_batches uuid[], p_opmerking text, p_door uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid := p_id; v_product uuid; v_norm int;
BEGIN
    IF coalesce(cardinality(p_batches), 0) NOT BETWEEN 1 AND 50
       OR (SELECT count(DISTINCT b) FROM unnest(coalesce(p_batches, '{}'::uuid[])) b) <> cardinality(p_batches) THEN
        RAISE EXCEPTION 'Een lotvoorstel bestaat uit 1 tot 50 verschillende batches';
    END IF;
    IF (SELECT count(*) FROM batch WHERE id = ANY(p_batches)) <> cardinality(p_batches) THEN
        RAISE EXCEPTION 'Een of meer opgegeven batches bestaan niet';
    END IF;
    IF EXISTS (SELECT 1 FROM batch WHERE id = ANY(p_batches) AND product_id IS NULL)
       OR (SELECT count(DISTINCT product_id) FROM batch WHERE id = ANY(p_batches)) <> 1 THEN
        RAISE EXCEPTION 'Een lotvoorstel bestaat uit batches van hetzelfde product';
    END IF;
    SELECT product_id INTO v_product FROM batch WHERE id = ANY(p_batches) ORDER BY product_id LIMIT 1;
    SELECT batches_per_lot INTO v_norm FROM product WHERE id = v_product FOR UPDATE;
    IF v_norm IS NULL THEN RAISE EXCEPTION 'Het product heeft geen geldige lotgrootte'; END IF;
    IF cardinality(p_batches) <> v_norm THEN
        RAISE EXCEPTION 'Een lotvoorstel voor dit product bestaat uit precies % batches', v_norm;
    END IF;
    IF v_id IS NULL THEN
        INSERT INTO lot_voorstel (opmerking, aangemaakt_door, batch_aantal_norm)
        VALUES (nullif(btrim(p_opmerking), ''), p_door, v_norm) RETURNING id INTO v_id;
    ELSE
        IF (SELECT status FROM lot_voorstel WHERE id = v_id) IS DISTINCT FROM 'open' THEN
            RAISE EXCEPTION 'Alleen een open voorstel kan worden gewijzigd';
        END IF;
        UPDATE lot_voorstel SET opmerking = nullif(btrim(p_opmerking), ''), batch_aantal_norm = v_norm WHERE id = v_id;
        DELETE FROM lot_voorstel_batch WHERE voorstel_id = v_id;
    END IF;
    INSERT INTO lot_voorstel_batch (voorstel_id, batch_id) SELECT v_id, unnest(p_batches);
    PERFORM controleer_lot_voorstel(v_id);
    RETURN v_id;
END $$;

CREATE TABLE stapplanning (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dag              date NOT NULL,
    processtap_id    uuid NOT NULL REFERENCES processtap(id),
    batch_id         uuid REFERENCES batch(id),
    lot_id           uuid REFERENCES lot(id),
    voorstel_id      uuid REFERENCES lot_voorstel(id),
    volgorde         int NOT NULL CHECK (volgorde > 0),
    opmerking        text,
    aangemaakt_door  uuid NOT NULL REFERENCES gebruiker(id),
    aangemaakt_op    timestamptz NOT NULL DEFAULT now(),
    CHECK (num_nonnulls(batch_id, lot_id, voorstel_id) = 1)
);
CREATE UNIQUE INDEX stapplanning_uniek ON stapplanning (dag, processtap_id, coalesce(batch_id, lot_id, voorstel_id));
CREATE INDEX stapplanning_dag ON stapplanning (dag);

-- Het soort item moet bij de stap passen.
CREATE FUNCTION controleer_stapplanning() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_stap processtap%ROWTYPE;
BEGIN
    SELECT * INTO v_stap FROM processtap WHERE id = NEW.processtap_id;
    IF v_stap.is_lot_stap AND NEW.voorstel_id IS NULL THEN
        RAISE EXCEPTION 'Voor % plan je een lotvoorstel', v_stap.code;
    ELSIF NOT v_stap.is_lot_stap AND v_stap.niveau = 'batch' AND NEW.batch_id IS NULL THEN
        RAISE EXCEPTION 'Voor % plan je een batch', v_stap.code;
    ELSIF NOT v_stap.is_lot_stap AND v_stap.niveau = 'lot' AND NEW.lot_id IS NULL THEN
        RAISE EXCEPTION 'Voor % plan je een lot', v_stap.code;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER stapplanning_controle BEFORE INSERT OR UPDATE ON stapplanning
    FOR EACH ROW EXECUTE FUNCTION controleer_stapplanning();

-- Hoe staat de vorige stap ervoor als je een batch of lot op een dag in een stap plant? (sinds migratie 0016)
-- De planning blijft een richtlijn (D29): de schermen waarschuwen hiermee, er wordt niets geweigerd (D52).
-- stand: 'eerste'       geen vorige stap
--        'klaar'        vorige stap afgerond (de laatste poging)
--        'bezig'        vorige stap staat open
--        'vandaag'      vorige stap gepland op dezelfde dag (nr = plek in de volgorde van die dag)
--        'eerder'       vorige stap gepland op een eerdere dag die nog moet komen (of vandaag is): in orde
--        'achter'       vorige stap gepland op een dag die al voorbij is, en nog niet klaar
--        'later'        vorige stap pas op een latere dag gepland
--        'niet_gepland' vorige stap niet gepland en niet gedaan
--        'niet_in_route' de stap hoort niet bij de route van het product (sinds migratie 0018, D55)
-- De startdag van een geplande batch (Planning → Per week) telt als planning van de eerste batchstap.
CREATE FUNCTION planning_vorige_stap(p_stap_id uuid, p_batch_id uuid, p_lot_id uuid, p_dag date)
RETURNS TABLE (stand text, vorige text, dag date, nr int) LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_stap    processtap%ROWTYPE;
    v_vorige  processtap%ROWTYPE;
    v_status  text;
    v_vandaag date := (now() AT TIME ZONE fabriekstijdzone())::date;
    v_product uuid;
BEGIN
    SELECT * INTO v_stap FROM processtap WHERE id = p_stap_id;
    v_product := coalesce((SELECT product_id FROM batch WHERE id = p_batch_id), lot_product(p_lot_id));
    IF NOT in_route(v_product, p_stap_id) THEN
        RETURN QUERY SELECT 'niet_in_route'::text, (SELECT code FROM product WHERE id = v_product), NULL::date, NULL::int; RETURN;
    END IF;
    SELECT * INTO v_vorige FROM processtap WHERE id = route_vorige(v_product, p_stap_id);
    IF NOT FOUND THEN
        RETURN QUERY SELECT 'eerste'::text, NULL::text, NULL::date, NULL::int; RETURN;
    END IF;
    -- Een lot bestaat pas na de lotstap: die is dan altijd gedaan.
    IF v_vorige.is_lot_stap THEN
        RETURN QUERY SELECT 'klaar'::text, v_vorige.code, NULL::date, NULL::int; RETURN;
    END IF;
    SELECT r.status INTO v_status FROM stapregistratie r
     WHERE r.processtap_id = v_vorige.id
       AND (r.batch_id = p_batch_id OR r.lot_id = p_lot_id)
       AND r.status <> 'afgebroken'
     ORDER BY r.poging DESC LIMIT 1;
    IF v_status = 'afgerond' THEN
        RETURN QUERY SELECT 'klaar'::text, v_vorige.code, NULL::date, NULL::int; RETURN;
    ELSIF v_status = 'open' THEN
        RETURN QUERY SELECT 'bezig'::text, v_vorige.code, NULL::date, NULL::int; RETURN;
    END IF;
    RETURN QUERY
    WITH plan AS (
        SELECT sp.dag, sp.volgorde FROM stapplanning sp
         WHERE sp.processtap_id = v_vorige.id
           AND (sp.batch_id = p_batch_id OR sp.lot_id = p_lot_id)
        UNION ALL
        SELECT b.geplande_dag, b.volgorde FROM batch b
         WHERE b.id = p_batch_id AND b.geplande_dag IS NOT NULL
           AND v_vorige.id = route_eerste(v_product, 'batch')
    )
    SELECT CASE
             WHEN EXISTS (SELECT 1 FROM plan WHERE plan.dag = p_dag) THEN 'vandaag'
             WHEN EXISTS (SELECT 1 FROM plan WHERE plan.dag < p_dag AND plan.dag >= v_vandaag) THEN 'eerder'
             WHEN EXISTS (SELECT 1 FROM plan WHERE plan.dag < p_dag) THEN 'achter'
             WHEN EXISTS (SELECT 1 FROM plan) THEN 'later'
             ELSE 'niet_gepland'
           END,
           v_vorige.code,
           coalesce((SELECT max(plan.dag) FROM plan WHERE plan.dag <= p_dag), (SELECT min(plan.dag) FROM plan)),
           (SELECT min(plan.volgorde) FROM plan WHERE plan.dag = p_dag);
END $$;

-- ---------------------------------------------------------------------
-- Grondstoffen per batch (sinds migratie 0005, versie 0.11.0)
-- ---------------------------------------------------------------------
-- Grondstoffen (configuratie, door de beheerder beheerd).
CREATE TABLE grondstof (
    id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code     text NOT NULL UNIQUE CHECK (code ~ '^[A-Za-z0-9._-]{1,20}$'),
    naam     text NOT NULL,
    eenheid  text,
    actief   boolean NOT NULL DEFAULT true
);
CREATE TRIGGER grondstof_log BEFORE INSERT OR UPDATE OR DELETE ON grondstof
    FOR EACH ROW EXECUTE FUNCTION log_config();

-- In welke stap welke grondstof wordt ingevoerd, en of dat verplicht is.
CREATE TABLE stap_grondstof (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    processtap_id  uuid NOT NULL REFERENCES processtap(id),
    grondstof_id   uuid NOT NULL REFERENCES grondstof(id),
    verplicht      boolean NOT NULL DEFAULT true,
    actief         boolean NOT NULL DEFAULT true,
    UNIQUE (processtap_id, grondstof_id)
);
CREATE TRIGGER stap_grondstof_log BEFORE INSERT OR UPDATE OR DELETE ON stap_grondstof
    FOR EACH ROW EXECUTE FUNCTION log_config();

-- Gebruik: per registratie en grondstof één oorspronkelijke regel; correcties vervangen hem (zoals bij waarden).
CREATE TABLE grondstof_gebruik (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    stapregistratie_id  uuid NOT NULL REFERENCES stapregistratie(id),
    grondstof_id        uuid NOT NULL REFERENCES grondstof(id),
    partij              text NOT NULL CHECK (length(btrim(partij)) BETWEEN 1 AND 60),
    hoeveelheid         numeric CHECK (hoeveelheid > 0),
    vervangt_id         uuid UNIQUE REFERENCES grondstof_gebruik(id),
    correctie_reden     text,
    ingevoerd_door      uuid REFERENCES operator(id),
    gecorrigeerd_door   uuid REFERENCES gebruiker(id),
    ingevoerd_op        timestamptz NOT NULL DEFAULT now(),
    ontvangen_op        timestamptz DEFAULT clock_timestamp(),   -- sinds migratie 0011
    CHECK ((vervangt_id IS NULL) = (gecorrigeerd_door IS NULL)),
    CHECK (vervangt_id IS NULL OR length(trim(coalesce(correctie_reden,''))) > 0),
    CHECK (vervangt_id IS NOT NULL OR ingevoerd_door IS NOT NULL)
);
CREATE UNIQUE INDEX grondstof_gebruik_een_origineel ON grondstof_gebruik (stapregistratie_id, grondstof_id) WHERE vervangt_id IS NULL;
CREATE INDEX grondstof_gebruik_partij ON grondstof_gebruik (lower(partij));

CREATE FUNCTION verwerk_grondstof_gebruik() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_reg  stapregistratie%ROWTYPE;
    v_oud  grondstof_gebruik%ROWTYPE;
    v_rol  text;
BEGIN
    SELECT * INTO v_reg FROM stapregistratie WHERE id = NEW.stapregistratie_id;
    NEW.partij := btrim(NEW.partij);
    IF NEW.vervangt_id IS NULL THEN
        IF v_reg.status <> 'open' THEN
            RAISE EXCEPTION 'Stap is al afgerond; wijzigen kan alleen als correctie door een ploegleider';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM stap_grondstof x JOIN grondstof g ON g.id = x.grondstof_id
                        WHERE x.processtap_id = v_reg.processtap_id AND x.grondstof_id = NEW.grondstof_id AND x.actief AND g.actief) THEN
            RAISE EXCEPTION 'Deze grondstof hoort niet bij deze stap';
        END IF;
    ELSE
        SELECT * INTO v_oud FROM grondstof_gebruik WHERE id = NEW.vervangt_id;
        IF v_oud.stapregistratie_id <> NEW.stapregistratie_id OR v_oud.grondstof_id <> NEW.grondstof_id THEN
            RAISE EXCEPTION 'Een correctie hoort bij dezelfde registratie en grondstof';
        END IF;
        IF EXISTS (SELECT 1 FROM grondstof_gebruik WHERE vervangt_id = v_oud.id) THEN
            RAISE EXCEPTION 'Deze regel is al gecorrigeerd';
        END IF;
        SELECT rol INTO v_rol FROM gebruiker WHERE id = NEW.gecorrigeerd_door AND actief;
        IF v_rol IS NULL OR v_rol NOT IN ('ploegleider','beheerder') THEN
            RAISE EXCEPTION 'Alleen een ploegleider of beheerder kan corrigeren';
        END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER grondstof_gebruik_controle BEFORE INSERT ON grondstof_gebruik
    FOR EACH ROW EXECUTE FUNCTION verwerk_grondstof_gebruik();

CREATE FUNCTION grondstof_gebruik_onveranderlijk() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Grondstofregels worden niet gewijzigd of verwijderd; leg een correctie vast';
END $$;
CREATE TRIGGER grondstof_gebruik_vast BEFORE UPDATE OR DELETE ON grondstof_gebruik
    FOR EACH ROW EXECUTE FUNCTION grondstof_gebruik_onveranderlijk();

CREATE VIEW grondstof_gebruik_actueel AS
SELECT g.* FROM grondstof_gebruik g
WHERE NOT EXISTS (SELECT 1 FROM grondstof_gebruik c WHERE c.vervangt_id = g.id);

-- ---------------------------------------------------------------------
-- Vaste tijdzone (sinds migratie 0012, versie 0.20.1)
-- ---------------------------------------------------------------------
-- De tijdzone van de fabriek. Op één plek, zodat hij later instelbaar kan worden.
CREATE FUNCTION fabriekstijdzone() RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'Europe/Amsterdam'::text $$;
ALTER FUNCTION fabriekstijdzone() SET search_path = fabriek, public;

-- Nieuwe verbindingen met deze database krijgen die tijdzone (de API zet hem ook per transactie).
DO $$ BEGIN
    EXECUTE format('ALTER DATABASE %I SET timezone = %L', current_database(), fabriek.fabriekstijdzone());
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'Tijdzone niet op de database gezet (geen eigenaar); de applicatie zet hem per transactie.';
END $$;

-- ---------------------------------------------------------------------
-- Ploegoverdracht (sinds migratie 0006, versie 0.12.0)
-- ---------------------------------------------------------------------
CREATE TABLE ploeg (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code      text NOT NULL UNIQUE CHECK (code ~ '^[A-Za-z0-9._-]{1,20}$'),
    naam      text NOT NULL,
    begint    time NOT NULL,
    eindigt   time NOT NULL,
    actief    boolean NOT NULL DEFAULT true,
    CHECK (begint <> eindigt)
);
CREATE TRIGGER ploeg_log BEFORE INSERT OR UPDATE OR DELETE ON ploeg
    FOR EACH ROW EXECUTE FUNCTION log_config();

-- Welke ploeg werkt op moment p_t, en op welke dag die ploeg begon (een nachtploeg hoort bij de dag waarop hij begint).
-- Begin en eind zijn kloktijden in de fabriek (sinds migratie 0012): een nachtploeg
-- van 22:00 tot 06:00 duurt in de nacht van de wintertijd 9 uur en in de nacht van de zomertijd 7 uur.
CREATE FUNCTION ploeg_van(p_t timestamptz)
RETURNS TABLE (ploeg_id uuid, code text, naam text, dag date, begin_op timestamptz, eind_op timestamptz)
LANGUAGE sql STABLE AS $$
    SELECT p.id, p.code, p.naam, d.dag, x.begin_op, x.eind_op
      FROM ploeg p
      CROSS JOIN LATERAL (VALUES ((p_t AT TIME ZONE fabriekstijdzone())::date),
                                 ((p_t AT TIME ZONE fabriekstijdzone())::date - 1)) d(dag)
      CROSS JOIN LATERAL (SELECT (d.dag + p.begint) AT TIME ZONE fabriekstijdzone() AS begin_op,
                                 ((d.dag + CASE WHEN p.eindigt > p.begint THEN 0 ELSE 1 END) + p.eindigt)
                                     AT TIME ZONE fabriekstijdzone() AS eind_op) x
     WHERE p.actief
       AND p_t >= x.begin_op
       AND p_t < x.eind_op
     ORDER BY x.begin_op DESC
     LIMIT 1
$$;

-- Ploegen en rooster (sinds 0033, #86, D76). De tabel ploeg bevat de diensten (ochtend, middag, nacht: begin- en
-- eindtijd); de naam is gebleven omdat de API en oudere invoerschermen hem zo kennen. De ploegen zelf (A tot en
-- met E, per divisie) staan in rooster_ploeg. Elke ploeg volgt hetzelfde roosterpatroon (een rij dienstcodes,
-- '-' = vrij), vanaf de eigen startdag van zijn cyclus. Zo zie je per dag en dienst welke ploegen werken.
CREATE TABLE rooster (
    id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    enkel    boolean NOT NULL DEFAULT true UNIQUE CHECK (enkel),   -- er is maar één rooster
    patroon  text[] NOT NULL CHECK (cardinality(patroon) BETWEEN 1 AND 56)
);
CREATE TRIGGER rooster_log BEFORE INSERT OR UPDATE OR DELETE ON rooster
    FOR EACH ROW EXECUTE FUNCTION log_config();

CREATE FUNCTION controleer_rooster() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_fout text;
BEGIN
    SELECT string_agg(DISTINCT x, ', ') INTO v_fout
      FROM unnest(NEW.patroon) x
     WHERE x <> '-' AND NOT EXISTS (SELECT 1 FROM ploeg p WHERE p.code = x);
    IF v_fout IS NOT NULL THEN
        RAISE EXCEPTION 'Onbekende dienst in het rooster: % (gebruik de codes van de diensten, of - voor vrij)', v_fout;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM unnest(NEW.patroon) x WHERE x <> '-') THEN
        RAISE EXCEPTION 'Een rooster heeft minstens één dienst';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER rooster_controle BEFORE INSERT OR UPDATE ON rooster
    FOR EACH ROW EXECUTE FUNCTION controleer_rooster();

CREATE TABLE rooster_ploeg (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    letter        text NOT NULL CHECK (letter ~ '^[A-Z]$'),
    divisie       int  NOT NULL CHECK (divisie BETWEEN 1 AND 9),
    code          text GENERATED ALWAYS AS (letter || divisie::text) STORED UNIQUE,
    cyclus_start  date NOT NULL,       -- dag waarop deze ploeg de eerste dag van het patroon draait
    actief        boolean NOT NULL DEFAULT true
);
CREATE TRIGGER rooster_ploeg_log BEFORE INSERT OR UPDATE OR DELETE ON rooster_ploeg
    FOR EACH ROW EXECUTE FUNCTION log_config();

-- Elke medewerker in een ploeg (sinds 0034, #87, D77); leeg voor wie niet in het rooster werkt.
ALTER TABLE operator ADD COLUMN ploeg_id uuid REFERENCES rooster_ploeg(id);
CREATE INDEX operator_ploeg ON operator (ploeg_id) WHERE ploeg_id IS NOT NULL;

-- Welke ploegen op een dag welke dienst hebben (alleen actieve ploegen; vrije dagen niet).
CREATE FUNCTION rooster_op(p_dag date)
RETURNS TABLE (code text, letter text, divisie int, dienst text)
LANGUAGE sql STABLE AS $$
    SELECT rp.code, rp.letter, rp.divisie, r.patroon[1 + (((p_dag - rp.cyclus_start) % n.n) + n.n) % n.n]
      FROM rooster r
      CROSS JOIN LATERAL (SELECT cardinality(r.patroon) AS n) n
      JOIN rooster_ploeg rp ON rp.actief
     WHERE r.patroon[1 + (((p_dag - rp.cyclus_start) % n.n) + n.n) % n.n] <> '-'
     ORDER BY rp.divisie, rp.letter
$$;

-- De ploegen (codes, zoals A1 en A2) die een dienst draaien op een dag.
CREATE FUNCTION ploegen_in_dienst(p_dag date, p_dienst text) RETURNS text[]
LANGUAGE sql STABLE AS $$
    SELECT coalesce(array_agg(code ORDER BY divisie, letter), '{}') FROM rooster_op(p_dag) WHERE dienst = p_dienst
$$;

CREATE TABLE overdracht (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dag              date NOT NULL,
    ploeg_id         uuid NOT NULL REFERENCES ploeg(id),
    hal              text,
    bijzonderheden   text,
    aandachtspunten  text,
    gebruiker_id     uuid NOT NULL REFERENCES gebruiker(id),
    operator_id      uuid REFERENCES operator(id),
    pc_id            uuid REFERENCES pc(id),
    geschreven_op    timestamptz NOT NULL DEFAULT now(),
    CHECK (length(btrim(coalesce(bijzonderheden, '') || coalesce(aandachtspunten, ''))) > 0)
);
CREATE INDEX overdracht_dag ON overdracht (dag, ploeg_id);

CREATE FUNCTION overdracht_onveranderlijk() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Een overdracht wordt niet gewijzigd of verwijderd; schrijf een nieuwe aanvulling';
END $$;
CREATE TRIGGER overdracht_vast BEFORE UPDATE OR DELETE ON overdracht
    FOR EACH ROW EXECUTE FUNCTION overdracht_onveranderlijk();

-- ---------------------------------------------------------------------
-- Meldingen (sinds migratie 0007, versie 0.13.0)
-- ---------------------------------------------------------------------
CREATE TABLE melding (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    soort          text NOT NULL CHECK (soort IN ('buiten_grens','beoordeling','vrijgegeven','afgekeurd','lot_afgeweken','storing','herbewerking','keuring','conflict')),
    ernst          text NOT NULL DEFAULT 'let_op' CHECK (ernst IN ('info','let_op','kritiek')),
    tekst          text NOT NULL,
    batchnummer    text,
    lotnummer      text,
    hal            text,
    voor_rollen    text[] NOT NULL,
    bron_id        uuid,
    aangemaakt_op  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX melding_tijd ON melding (aangemaakt_op DESC);

CREATE TABLE melding_gelezen (
    melding_id    uuid NOT NULL REFERENCES melding(id),
    gebruiker_id  uuid NOT NULL REFERENCES gebruiker(id),
    gelezen_op    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (melding_id, gebruiker_id)
);

-- Waarde buiten de grens (ook na een correctie).
CREATE FUNCTION meld_waarde() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v record;
BEGIN
    IF NEW.markering <> 'buiten_grens' THEN RETURN NULL; END IF;
    SELECT s.code AS stap, vd.code AS veld, vd.naam AS veldnaam, vd.eenheid, b.batchnummer, l.lotnummer, pc.locatie AS hal
      INTO v
      FROM stapregistratie r JOIN processtap s ON s.id = r.processtap_id JOIN veld vd ON vd.id = NEW.veld_id
      JOIN pc ON pc.id = r.pc_id
      LEFT JOIN batch b ON b.id = r.batch_id LEFT JOIN lot l ON l.id = r.lot_id
     WHERE r.id = NEW.stapregistratie_id;
    INSERT INTO melding (soort, ernst, tekst, batchnummer, lotnummer, hal, voor_rollen, bron_id)
    VALUES ('buiten_grens', 'kritiek',
            format('%s %s: %s %s buiten de grens (%s%s)%s', coalesce(v.batchnummer, v.lotnummer), v.stap, v.veld, v.veldnaam,
                   trim(to_char(NEW.gemeten, 'FM999999990.######')), coalesce(' ' || v.eenheid, ''),
                   CASE WHEN NEW.vervangt_waarde_id IS NOT NULL THEN ', na correctie' ELSE '' END),
            v.batchnummer, v.lotnummer, v.hal, ARRAY['ploegleider','kwaliteit'], NEW.id);
    RETURN NULL;
END $$;
CREATE TRIGGER waarde_melding AFTER INSERT ON waarde FOR EACH ROW EXECUTE FUNCTION meld_waarde();

-- Besluiten over een batch.
CREATE FUNCTION meld_besluit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_nr   text;
    v_door text;
BEGIN
    -- Herbewerken: de melding komt van de herbewerking zelf (meld_herbewerking).
    IF NEW.besluit = 'herbewerken' THEN RETURN NULL; END IF;
    SELECT batchnummer INTO v_nr FROM batch WHERE id = NEW.batch_id;
    SELECT gebruikersnaam INTO v_door FROM gebruiker WHERE id = NEW.besloten_door;
    INSERT INTO melding (soort, ernst, tekst, batchnummer, voor_rollen, bron_id)
    VALUES (CASE NEW.besluit WHEN 'in_beoordeling' THEN 'beoordeling' ELSE NEW.besluit END,
            CASE NEW.besluit WHEN 'afgekeurd' THEN 'kritiek' WHEN 'in_beoordeling' THEN 'let_op' ELSE 'info' END,
            format('%s %s door %s: %s', v_nr,
                   CASE NEW.besluit WHEN 'in_beoordeling' THEN 'in beoordeling gezet' WHEN 'vrijgegeven' THEN 'vrijgegeven (keurresultaat OK)'
                        ELSE 'afgekeurd (keurresultaat NOK)' END, v_door, NEW.reden),
            v_nr,
            CASE NEW.besluit WHEN 'in_beoordeling' THEN ARRAY['ploegleider','kwaliteit','productiemanager']
                             WHEN 'vrijgegeven' THEN ARRAY['ploegleider','productiemanager']
                             ELSE ARRAY['ploegleider','planner','productiemanager'] END,
            NEW.id);
    RETURN NULL;
END $$;
CREATE TRIGGER batch_besluit_melding AFTER INSERT ON batch_besluit FOR EACH ROW EXECUTE FUNCTION meld_besluit();

-- Lot samengesteld met een andere samenstelling dan het voorstel.
CREATE FUNCTION meld_lotvoorstel() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_lot text;
BEGIN
    IF NEW.status = 'afgeweken' AND OLD.status = 'open' THEN
        SELECT lotnummer INTO v_lot FROM lot WHERE id = NEW.lot_id;
        INSERT INTO melding (soort, ernst, tekst, lotnummer, voor_rollen, bron_id)
        VALUES ('lot_afgeweken', 'info', format('Lot %s wijkt af van lotvoorstel %s: %s', v_lot, NEW.nummer, NEW.afwijking_reden),
                v_lot, ARRAY['planner'], NEW.id);
    END IF;
    RETURN NULL;
END $$;
CREATE TRIGGER lot_voorstel_melding AFTER UPDATE ON lot_voorstel FOR EACH ROW EXECUTE FUNCTION meld_lotvoorstel();

CREATE FUNCTION melding_onveranderlijk() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Meldingen worden niet gewijzigd of verwijderd';
END $$;
CREATE TRIGGER melding_vast BEFORE UPDATE OR DELETE ON melding FOR EACH ROW EXECUTE FUNCTION melding_onveranderlijk();

-- ---------------------------------------------------------------------
-- Storingen en stilstand (sinds migratie 0008, versie 0.14.0)
-- ---------------------------------------------------------------------
CREATE TABLE stilstand_oorzaak (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code       text NOT NULL UNIQUE CHECK (code ~ '^[A-Za-z0-9._-]{1,20}$'),
    naam       text NOT NULL,
    categorie  text NOT NULL CHECK (categorie IN ('storing','gepland','wachten','overig')),
    actief     boolean NOT NULL DEFAULT true
);
CREATE TRIGGER stilstand_oorzaak_log BEFORE INSERT OR UPDATE OR DELETE ON stilstand_oorzaak
    FOR EACH ROW EXECUTE FUNCTION log_config();

CREATE TABLE stilstand (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    processtap_id  uuid NOT NULL REFERENCES processtap(id),
    oorzaak_id     uuid NOT NULL REFERENCES stilstand_oorzaak(id),
    toelichting    text,
    begin_op       timestamptz NOT NULL DEFAULT now(),
    eind_op        timestamptz,
    pc_id          uuid REFERENCES pc(id),
    operator_id    uuid REFERENCES operator(id),
    gemeld_door    uuid NOT NULL REFERENCES gebruiker(id),
    beeindigd_door uuid REFERENCES operator(id),
    -- Wat het was en wat er is gedaan, bij het einde (#31, D65).
    eind_notitie   text CHECK (eind_notitie IS NULL OR (eind_notitie = btrim(eind_notitie) AND char_length(eind_notitie) BETWEEN 1 AND 500)),
    CHECK (eind_op IS NULL OR eind_op >= begin_op)
);
-- Per stap kan er maar één stilstand tegelijk lopen.
CREATE UNIQUE INDEX stilstand_een_lopend ON stilstand (processtap_id) WHERE eind_op IS NULL;
CREATE INDEX stilstand_begin ON stilstand (begin_op);

-- Een stilstand ligt vast; alleen het einde mag één keer worden ingevuld.
CREATE FUNCTION bewaak_stilstand() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Een stilstand wordt niet verwijderd';
    END IF;
    IF OLD.eind_op IS NOT NULL THEN
        RAISE EXCEPTION 'Deze stilstand is al beëindigd';
    END IF;
    IF (NEW.processtap_id, NEW.oorzaak_id, NEW.begin_op, NEW.pc_id, NEW.operator_id, NEW.gemeld_door, NEW.toelichting)
       IS DISTINCT FROM (OLD.processtap_id, OLD.oorzaak_id, OLD.begin_op, OLD.pc_id, OLD.operator_id, OLD.gemeld_door, OLD.toelichting) THEN
        RAISE EXCEPTION 'Van een stilstand kan alleen het einde worden ingevuld';
    END IF;
    IF NEW.eind_notitie IS NOT NULL AND NEW.eind_op IS NULL THEN
        RAISE EXCEPTION 'Een notitie bij een stilstand hoort bij het einde';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER stilstand_bewaak BEFORE UPDATE OR DELETE ON stilstand FOR EACH ROW EXECUTE FUNCTION bewaak_stilstand();

-- Een storing is een melding waard voor de ploegleider.
CREATE FUNCTION meld_stilstand() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v record;
BEGIN
    SELECT s.code AS stap, s.naam AS stapnaam, o.naam AS oorzaak, o.categorie, pc.locatie AS hal
      INTO v
      FROM processtap s, stilstand_oorzaak o LEFT JOIN pc ON pc.id = NEW.pc_id
     WHERE s.id = NEW.processtap_id AND o.id = NEW.oorzaak_id;
    IF v.categorie = 'storing' THEN
        INSERT INTO melding (soort, ernst, tekst, hal, voor_rollen, bron_id)
        VALUES ('storing', 'kritiek', format('Stilstand %s %s: %s%s', v.stap, v.stapnaam, v.oorzaak, coalesce(' (' || NEW.toelichting || ')', '')),
                v.hal, ARRAY['ploegleider'], NEW.id);
    END IF;
    RETURN NULL;
END $$;
CREATE TRIGGER stilstand_melding AFTER INSERT ON stilstand FOR EACH ROW EXECUTE FUNCTION meld_stilstand();

-- ---------------------------------------------------------------------
-- Capaciteit in de planning: per stap en product (sinds migratie 0020, D55), met afwijkende dagen
-- (sinds migratie 0029, D69). De capaciteit per weekdag uit 0.16.0 (D36) is vervallen.
-- ---------------------------------------------------------------------

-- Capaciteit per stap en product (sinds migratie 0020, D55): hoeveel items een stap per dag aankan.
-- Een regel zonder product geldt voor elk product zonder eigen regel. Bij gemengde producten telt elk item
-- voor zijn deel: 6 van A (max 8) en 1 van B (max 3) = 6/8 + 1/3 = 108 %.
CREATE TABLE capaciteit_stap (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    processtap_id  uuid NOT NULL REFERENCES processtap(id),
    product_id     uuid NOT NULL REFERENCES product(id),
    max_per_dag    int  NOT NULL CHECK (max_per_dag BETWEEN 1 AND 500),
    UNIQUE NULLS NOT DISTINCT (processtap_id, product_id)
);
CREATE TRIGGER capaciteit_stap_log BEFORE INSERT OR UPDATE OR DELETE ON capaciteit_stap
    FOR EACH ROW EXECUTE FUNCTION log_config();

-- De capaciteit van een stap voor een product (NULL = nog niet ingevuld). Sinds 0.49.0 (D71) alleen per product.
-- Capaciteit in kilogram (sinds 0035, #90, D80). Een product heeft een vast gewicht per batch (voor de pilot;
-- later mogelijk per batch); een lot weegt het ingestelde aantal batches. De capaciteit per stap staat in kg per dag; per uur en per
-- maand worden ervan afgeleid met de uren van de diensten en het gemiddelde aantal dagen in een maand.
ALTER TABLE product ADD COLUMN batchgewicht_kg numeric CHECK (batchgewicht_kg > 0 AND batchgewicht_kg <= 100000);
ALTER TABLE capaciteit_stap ADD COLUMN kg_per_dag numeric CHECK (kg_per_dag > 0 AND kg_per_dag <= 100000000);
ALTER TABLE capaciteit_stap ALTER COLUMN max_per_dag DROP NOT NULL;
ALTER TABLE capaciteit_stap ADD CONSTRAINT capaciteit_stap_ingevuld CHECK (kg_per_dag IS NOT NULL OR max_per_dag IS NOT NULL);

-- Gewicht van één item in een stap: een batch, of een lot met de ingestelde lotgrootte.
-- NULL = gewicht nog niet ingevuld.

CREATE OR REPLACE FUNCTION gewicht_per_item(p_product uuid, p_stap uuid) RETURNS numeric LANGUAGE sql STABLE AS $$
    SELECT p.batchgewicht_kg * CASE WHEN s.niveau = 'lot' THEN p.batches_per_lot ELSE 1 END
      FROM product p, processtap s WHERE p.id = p_product AND s.id = p_stap
$$;

-- Productie-uren per dag: de actieve diensten samen (standaard 24).

ALTER FUNCTION verval_lotvoorstellen_bij_lotgrootte() SET search_path = fabriek, public;
ALTER FUNCTION maak_lot(text, uuid[], uuid, uuid, uuid, uuid, text) SET search_path = fabriek, public;
ALTER FUNCTION controleer_lot_voorstel(uuid) SET search_path = fabriek, public;
ALTER FUNCTION bewaar_lot_voorstel(uuid, uuid[], text, uuid) SET search_path = fabriek, public;
ALTER FUNCTION gewicht_per_item(uuid, uuid) SET search_path = fabriek, public;
