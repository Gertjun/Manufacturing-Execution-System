-- Migratie 0063: geen uitvoering van herbewerking zonder vooraf bestaande opdracht.
SET search_path = fabriek, public;

CREATE OR REPLACE FUNCTION koppel_herbewerking() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog,fabriek,pg_temp AS $$
DECLARE v_id uuid;
BEGIN
    IF NOT NEW.herbewerking_start THEN RETURN NULL; END IF;
    -- Vergrendel en consumeer uitsluitend een passende, vooraf geregistreerde opdracht.
    SELECT h.id INTO v_id FROM herbewerking h
      WHERE h.status='open' AND h.processtap_id=NEW.processtap_id
        AND h.batch_id IS NOT DISTINCT FROM NEW.batch_id
        AND h.lot_id IS NOT DISTINCT FROM NEW.lot_id
        AND h.aangemaakt_door IS NOT NULL
        AND btrim(h.reden)=btrim(NEW.reden)
      FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Vooraf geregistreerde herbewerkingsopdracht vereist';
    END IF;
    UPDATE herbewerking SET status='gestart',stapregistratie_id=NEW.id WHERE id=v_id;
    RETURN NULL;
END $$;

-- Een legacy-opdracht mag niet worden aangemaakt vanuit een batch in
-- beoordeling: dat zou de onafhankelijke kwaliteitsblokkade opheffen.
CREATE FUNCTION quality_rework_hold_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog,fabriek,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' AND NEW.batch_id IS NOT NULL AND EXISTS
    (SELECT 1 FROM batch WHERE id=NEW.batch_id AND status='in_beoordeling') THEN
    RAISE EXCEPTION 'Kwaliteitsblokkade blijft onafhankelijk van herbewerking';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER quality_rework_hold BEFORE INSERT ON herbewerking
 FOR EACH ROW EXECUTE FUNCTION quality_rework_hold_guard();
REVOKE ALL ON FUNCTION quality_rework_hold_guard() FROM PUBLIC;

CREATE OR REPLACE FUNCTION maak_herbewerking(p_nummer text, p_stapcode text, p_reden text, p_door uuid, p_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SET search_path = pg_catalog,fabriek,pg_temp AS $$
DECLARE
    v_rol    text;
    v_batch  batch%ROWTYPE;
    v_lot    lot%ROWTYPE;
    v_stap   processtap%ROWTYPE;
    v_id     uuid;
BEGIN
    SELECT rol INTO v_rol FROM gebruiker WHERE id = p_door AND actief;
    IF v_rol IS NULL OR v_rol NOT IN ('kwaliteit', 'productiemanager') THEN
        RAISE EXCEPTION 'Alleen Kwaliteit of de productiemanager maakt een herbewerking aan';
    END IF;
    IF length(trim(coalesce(p_reden, ''))) = 0 THEN
        RAISE EXCEPTION 'Geef de reden van de herbewerking';
    END IF;
    SELECT * INTO v_stap FROM processtap WHERE code = p_stapcode AND actief;
    IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende stap %', p_stapcode; END IF;

    SELECT * INTO v_batch FROM batch WHERE batchnummer = p_nummer FOR UPDATE;
    IF FOUND THEN
        IF v_batch.status = 'in_lot' THEN
            RAISE EXCEPTION 'Batch % zit al in een lot; maak de herbewerking voor het lot', p_nummer;
        END IF;
        IF v_batch.status NOT IN ('in_productie', 'in_beoordeling') THEN
            RAISE EXCEPTION 'Batch % heeft status %; geen herbewerking mogelijk', p_nummer, v_batch.status;
        END IF;
        IF v_stap.niveau <> 'batch' OR NOT in_route(v_batch.product_id, v_stap.id) THEN
            RAISE EXCEPTION 'Stap % is geen batchstap in de route van deze batch', p_stapcode;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM stapregistratie WHERE batch_id = v_batch.id AND processtap_id = v_stap.id AND status = 'afgerond') THEN
            RAISE EXCEPTION 'Stap % is voor deze batch nog niet doorlopen; geen herbewerking mogelijk', p_stapcode;
        END IF;
        IF EXISTS (SELECT 1 FROM herbewerking WHERE batch_id = v_batch.id AND status = 'open') THEN
            RAISE EXCEPTION 'Voor batch % staat al een herbewerking klaar die nog niet gestart is', p_nummer;
        END IF;
        IF v_batch.status = 'in_beoordeling' THEN
            RAISE EXCEPTION 'Kwaliteitsblokkade blijft onafhankelijk van herbewerking';
        END IF;
        INSERT INTO herbewerking (id, batch_id, processtap_id, reden, aangemaakt_door)
        VALUES (coalesce(p_id, gen_random_uuid()), v_batch.id, v_stap.id, trim(p_reden), p_door) RETURNING id INTO v_id;
        RETURN v_id;
    END IF;

    SELECT * INTO v_lot FROM lot WHERE lotnummer = p_nummer FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende batch of lot %', p_nummer; END IF;
    IF v_lot.status NOT IN ('in_productie', 'gereed') THEN
        RAISE EXCEPTION 'Lot % heeft status %; geen herbewerking mogelijk', p_nummer, v_lot.status;
    END IF;
    IF v_stap.niveau <> 'lot' OR NOT in_route(lot_product(v_lot.id), v_stap.id) THEN
        RAISE EXCEPTION 'Stap % is geen lotstap in de route van dit lot', p_stapcode;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM stapregistratie WHERE lot_id = v_lot.id AND processtap_id = v_stap.id AND status = 'afgerond') THEN
        RAISE EXCEPTION 'Stap % is voor dit lot nog niet doorlopen; geen herbewerking mogelijk', p_stapcode;
    END IF;
    IF EXISTS (SELECT 1 FROM herbewerking WHERE lot_id = v_lot.id AND status = 'open') THEN
        RAISE EXCEPTION 'Voor lot % staat al een herbewerking klaar die nog niet gestart is', p_nummer;
    END IF;
    INSERT INTO herbewerking (id, lot_id, processtap_id, reden, aangemaakt_door)
    VALUES (coalesce(p_id, gen_random_uuid()), v_lot.id, v_stap.id, trim(p_reden), p_door) RETURNING id INTO v_id;
    RETURN v_id;
END $$;
