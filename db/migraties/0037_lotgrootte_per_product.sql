-- Migratie 0037 (0.64.0): lotgrootte per product (eerste databasefase van #104).
SET search_path = fabriek, public;
DO $mig$
BEGIN
    IF EXISTS (SELECT 1 FROM lot l WHERE (SELECT count(*) FROM batch b WHERE b.lot_id = l.id) <> 4) THEN
        RAISE EXCEPTION 'Migratie 0037 gestopt: een historisch lot bevat niet precies vier batches; beoordeel eerst de lot-batchkoppelingen';
    END IF;
END $mig$;
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
    -- Productloze batches zijn legacy: alleen als alle batches productloos zijn, behoud de oude norm 4.
    -- Gemengde productloze/productgekoppelde batches of meerdere producten blijven verboden.
    IF (SELECT count(DISTINCT product_id) FROM batch WHERE id = ANY(p_batches)) > 1
       OR (EXISTS (SELECT 1 FROM batch WHERE id = ANY(p_batches) AND product_id IS NULL)
           AND EXISTS (SELECT 1 FROM batch WHERE id = ANY(p_batches) AND product_id IS NOT NULL)) THEN
        RAISE EXCEPTION 'Een lot bestaat uit batches van hetzelfde product';
    END IF;
    SELECT product_id INTO v_product FROM batch WHERE id = ANY(p_batches) ORDER BY product_id NULLS LAST LIMIT 1;
    IF v_product IS NULL THEN
        v_norm := 4;
    ELSE
        SELECT batches_per_lot INTO v_norm FROM product WHERE id = v_product FOR UPDATE;
        IF v_norm IS NULL THEN RAISE EXCEPTION 'Het product heeft geen geldige lotgrootte'; END IF;
    END IF;
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

CREATE OR REPLACE FUNCTION controleer_lot_voorstel(p_voorstel uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_dubbel text; v_product uuid; v_norm int;
BEGIN
    IF (SELECT status FROM lot_voorstel WHERE id = p_voorstel) <> 'open' THEN RETURN; END IF;
    IF (SELECT count(DISTINCT b.product_id) FROM lot_voorstel_batch x JOIN batch b ON b.id = x.batch_id
           WHERE x.voorstel_id = p_voorstel) > 1
       OR (EXISTS (SELECT 1 FROM lot_voorstel_batch x JOIN batch b ON b.id = x.batch_id
                    WHERE x.voorstel_id = p_voorstel AND b.product_id IS NULL)
           AND EXISTS (SELECT 1 FROM lot_voorstel_batch x JOIN batch b ON b.id = x.batch_id
                    WHERE x.voorstel_id = p_voorstel AND b.product_id IS NOT NULL)) THEN
        RAISE EXCEPTION 'Een lotvoorstel bestaat uit batches van hetzelfde product';
    END IF;
    SELECT b.product_id INTO v_product FROM lot_voorstel_batch x JOIN batch b ON b.id = x.batch_id
     WHERE x.voorstel_id = p_voorstel ORDER BY b.product_id NULLS LAST LIMIT 1;
    IF v_product IS NULL THEN
        v_norm := 4;
    ELSE
        SELECT batches_per_lot INTO v_norm FROM product WHERE id = v_product;
        IF v_norm IS NULL THEN RAISE EXCEPTION 'Het product heeft geen geldige lotgrootte'; END IF;
    END IF;
    IF (SELECT batch_aantal_norm FROM lot_voorstel WHERE id = p_voorstel) <> v_norm THEN
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
    IF (SELECT count(DISTINCT product_id) FROM batch WHERE id = ANY(p_batches)) > 1
       OR (EXISTS (SELECT 1 FROM batch WHERE id = ANY(p_batches) AND product_id IS NULL)
           AND EXISTS (SELECT 1 FROM batch WHERE id = ANY(p_batches) AND product_id IS NOT NULL)) THEN
        RAISE EXCEPTION 'Een lotvoorstel bestaat uit batches van hetzelfde product';
    END IF;
    SELECT product_id INTO v_product FROM batch WHERE id = ANY(p_batches) ORDER BY product_id NULLS LAST LIMIT 1;
    IF v_product IS NULL THEN
        v_norm := 4;
    ELSE
        SELECT batches_per_lot INTO v_norm FROM product WHERE id = v_product FOR UPDATE;
        IF v_norm IS NULL THEN RAISE EXCEPTION 'Het product heeft geen geldige lotgrootte'; END IF;
    END IF;
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

CREATE OR REPLACE FUNCTION gewicht_per_item(p_product uuid, p_stap uuid) RETURNS numeric LANGUAGE sql STABLE AS $$
    SELECT p.batchgewicht_kg * CASE WHEN s.niveau = 'lot' THEN p.batches_per_lot ELSE 1 END
      FROM product p, processtap s WHERE p.id = p_product AND s.id = p_stap
$$;

CREATE OR REPLACE FUNCTION capaciteit_stap_voor(p_stap uuid, p_product uuid) RETURNS int LANGUAGE sql STABLE AS $body$
    -- Sinds 0035 (#90, D80) in kilogram: hoeveel batches of lots per dag passen, met het gewicht per batch van
    -- het product (een lot gebruikt de ingestelde lotgrootte). Minstens 1; NULL als het gewicht nog niet is ingevuld. Een oude
    -- regel zonder kilogram (van vóór 0035) telt nog in stuks.
    SELECT CASE WHEN c.kg_per_dag IS NULL THEN c.max_per_dag
                WHEN gewicht_per_item(p_product, p_stap) IS NULL THEN NULL
                ELSE greatest(1, floor(c.kg_per_dag / gewicht_per_item(p_product, p_stap)))::int END
      FROM capaciteit_stap c WHERE c.processtap_id = p_stap AND c.product_id = p_product
$body$;

ALTER FUNCTION verval_lotvoorstellen_bij_lotgrootte() SET search_path = fabriek, public;
ALTER FUNCTION maak_lot(text, uuid[], uuid, uuid, uuid, uuid, text) SET search_path = fabriek, public;
ALTER FUNCTION controleer_lot_voorstel(uuid) SET search_path = fabriek, public;
ALTER FUNCTION bewaar_lot_voorstel(uuid, uuid[], text, uuid) SET search_path = fabriek, public;
ALTER FUNCTION gewicht_per_item(uuid, uuid) SET search_path = fabriek, public;
ALTER FUNCTION capaciteit_stap_voor(uuid, uuid) SET search_path = fabriek, public;
