-- Migratie 0091: kwaliteitsbesluiten en herbewerkingsopdrachten op MES-permissions (D101).
SET search_path = fabriek, public;

CREATE OR REPLACE FUNCTION verwerk_batch_besluit() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,public,pg_temp AS $$
DECLARE
    v_product uuid;
    v_status text;
BEGIN
    SELECT status,product_id INTO v_status,v_product FROM batch WHERE id=NEW.batch_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende batch'; END IF;
    IF NEW.besluit='in_beoordeling' AND NOT (
        authorization_permits(NEW.besloten_door,'execution.hold',NULL,v_product,NULL)
        OR authorization_permits(NEW.besloten_door,'inspection.hold',NULL,v_product,NULL)) THEN
        RAISE EXCEPTION 'Geen actuele MES-blokkeerbevoegdheid' USING ERRCODE='42501';
    END IF;
    IF NEW.besluit IN ('vrijgegeven','afgekeurd','herbewerken') AND NOT
        authorization_permits(NEW.besloten_door,'inspection.batch.decide',NULL,v_product,NULL) THEN
        RAISE EXCEPTION 'Geen actuele MES-batchbeslisbevoegdheid' USING ERRCODE='42501';
    END IF;
    IF v_status IN ('in_lot','afgekeurd') THEN
        RAISE EXCEPTION 'Batch heeft status %; geen besluit meer mogelijk', v_status;
    END IF;
    IF NEW.besluit = 'in_beoordeling' AND v_status <> 'in_productie' THEN
        RAISE EXCEPTION 'Alleen een batch in productie kan in beoordeling (nu: %)', v_status;
    END IF;
    IF NEW.besluit IN ('vrijgegeven','afgekeurd','herbewerken') AND v_status <> 'in_beoordeling' THEN
        RAISE EXCEPTION 'Een keurresultaat kan alleen na "in beoordeling" (nu: %)', v_status;
    END IF;

    UPDATE batch SET status = CASE NEW.besluit
        WHEN 'in_beoordeling' THEN 'in_beoordeling'
        WHEN 'vrijgegeven'    THEN 'in_productie'
        WHEN 'herbewerken'    THEN 'in_productie'
        WHEN 'afgekeurd'      THEN 'afgekeurd' END
    WHERE id = NEW.batch_id;

    -- NOK: een stap die nog open stond wordt afgebroken, met de reden erbij.
    IF NEW.besluit = 'afgekeurd' THEN
        UPDATE stapregistratie
           SET status = 'afgebroken', afgerond_op = clock_timestamp(),
               reden = 'Batch afgekeurd: ' || NEW.reden
         WHERE batch_id = NEW.batch_id AND status = 'open';
        -- Wat nog op Kwaliteit wachtte, is ook afgekeurd (sinds 0022).
        UPDATE keuring k SET status = 'afgekeurd', besloten_door = NEW.besloten_door, besloten_op = now(), reden = NEW.reden
          FROM stapregistratie r WHERE r.id = k.stapregistratie_id AND r.batch_id = NEW.batch_id AND k.status = 'open';
        -- Een herbewerking die nog niet gestart is, vervalt (sinds 0021).
        UPDATE herbewerking
           SET status = 'ingetrokken', ingetrokken_door = NEW.besloten_door, ingetrokken_op = now(),
               ingetrokken_reden = 'Batch afgekeurd: ' || NEW.reden
         WHERE batch_id = NEW.batch_id AND status = 'open';
    END IF;
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION beslis_keuring(p_keuring uuid, p_besluit text, p_reden text, p_door uuid, p_stapcode text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,public,pg_temp AS $$
DECLARE
    v_k        keuring%ROWTYPE;
    v_reg      stapregistratie%ROWTYPE;
    v_stap     processtap%ROWTYPE;
    v_nummer   text;
    v_status   text;
    v_mist     text;
    v_h        uuid;
BEGIN
    IF p_besluit NOT IN ('vrijgegeven', 'herbewerken', 'afgekeurd') THEN
        RAISE EXCEPTION 'Onbekend besluit %', p_besluit;
    END IF;
    SELECT * INTO v_k FROM keuring WHERE id = p_keuring FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Keuring bestaat niet'; END IF;
    SELECT * INTO v_reg FROM stapregistratie WHERE id = v_k.stapregistratie_id;
    IF NOT authorization_permits(p_door,'inspection.decide',NULL,v_reg.product_id,NULL)
       OR (v_reg.lot_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM batch b WHERE b.lot_id=v_reg.lot_id
            AND NOT authorization_permits(p_door,'inspection.decide',NULL,b.product_id,NULL))) THEN
        RAISE EXCEPTION 'Geen actuele MES-keuringsbeslisbevoegdheid' USING ERRCODE='42501';
    END IF;
    IF v_k.status = p_besluit THEN RETURN; END IF;
    IF v_k.status <> 'open' THEN RAISE EXCEPTION 'Over deze stap is al beslist'; END IF;
    SELECT * INTO v_stap FROM processtap WHERE id = v_reg.processtap_id;
    v_nummer := coalesce((SELECT batchnummer FROM batch WHERE id = v_reg.batch_id), (SELECT lotnummer FROM lot WHERE id = v_reg.lot_id));
    IF p_besluit <> 'vrijgegeven' AND length(trim(coalesce(p_reden, ''))) = 0 THEN
        RAISE EXCEPTION 'Geef de reden';
    END IF;

    IF p_besluit = 'vrijgegeven' THEN
        SELECT string_agg(v.code, ', ' ORDER BY v.volgnummer) INTO v_mist
          FROM veld v WHERE v.processtap_id = v_reg.processtap_id AND v.actief AND v.verplicht AND v.gemeten_door = 'kwaliteit'
           AND NOT EXISTS (SELECT 1 FROM waarde w WHERE w.stapregistratie_id = v_reg.id AND w.veld_id = v.id);
        IF v_mist IS NOT NULL THEN
            RAISE EXCEPTION 'Nog niet gemeten: %', v_mist;
        END IF;
        UPDATE keuring SET status = 'vrijgegeven', besloten_door = p_door, besloten_op = now(), reden = nullif(trim(coalesce(p_reden, '')), '')
         WHERE id = v_k.id;
        -- De laatste lotstap: nu is het lot gereed.
        IF v_reg.lot_id IS NOT NULL AND v_reg.processtap_id = route_laatste(lot_product(v_reg.lot_id), 'lot') THEN
            UPDATE lot SET status = 'gereed' WHERE id = v_reg.lot_id AND status = 'in_productie';
        END IF;
    ELSIF p_besluit = 'herbewerken' THEN
        v_h := maak_herbewerking(v_nummer, coalesce(p_stapcode, v_stap.code), p_reden, p_door);
        UPDATE keuring SET status = 'herbewerken', besloten_door = p_door, besloten_op = now(), reden = trim(p_reden), herbewerking_id = v_h
         WHERE id = v_k.id;
    ELSIF v_reg.batch_id IS NOT NULL THEN
        SELECT status INTO v_status FROM batch WHERE id = v_reg.batch_id;
        IF v_status = 'in_productie' THEN
            INSERT INTO batch_besluit (batch_id, besluit, reden, besloten_door)
            VALUES (v_reg.batch_id, 'in_beoordeling', 'Keuring ' || v_stap.code || ': ' || trim(p_reden), p_door);
        END IF;
        -- Het keurresultaat NOK zet ook deze keuring op afgekeurd (verwerk_batch_besluit).
        INSERT INTO batch_besluit (batch_id, besluit, reden, besloten_door) VALUES (v_reg.batch_id, 'afgekeurd', trim(p_reden), p_door);
        UPDATE keuring SET status = 'afgekeurd', besloten_door = p_door, besloten_op = now(), reden = trim(p_reden)
         WHERE id = v_k.id AND status = 'open';
    ELSE
        UPDATE lot SET status = 'geblokkeerd' WHERE id = v_reg.lot_id;
        UPDATE keuring SET status = 'afgekeurd', besloten_door = p_door, besloten_op = now(), reden = trim(p_reden) WHERE id = v_k.id;
        INSERT INTO melding (soort, ernst, tekst, lotnummer, voor_rollen, bron_id)
        VALUES ('afgekeurd', 'kritiek',
                format('Lot %s afgekeurd bij %s door %s: %s', v_nummer, v_stap.code, (SELECT gebruikersnaam FROM gebruiker WHERE id = p_door), trim(p_reden)),
                v_nummer, ARRAY['ploegleider','planner','productiemanager','kwaliteit'], v_k.id);
    END IF;
END $$;

CREATE OR REPLACE FUNCTION maak_herbewerking(p_nummer text, p_stapcode text, p_reden text, p_door uuid, p_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,public,pg_temp AS $$
DECLARE
    v_batch  batch%ROWTYPE;
    v_lot    lot%ROWTYPE;
    v_stap   processtap%ROWTYPE;
    v_id     uuid;
BEGIN
    IF length(trim(coalesce(p_reden, ''))) = 0 THEN
        RAISE EXCEPTION 'Geef de reden van de herbewerking';
    END IF;
    SELECT * INTO v_stap FROM processtap WHERE code = p_stapcode AND actief;
    IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende stap %', p_stapcode; END IF;

    SELECT * INTO v_batch FROM batch WHERE batchnummer = p_nummer FOR UPDATE;
    IF FOUND THEN
        IF NOT rework_order_permission(p_door,v_batch.id,NULL) THEN
            RAISE EXCEPTION 'Geen actuele MES-herbewerkingsbevoegdheid' USING ERRCODE='42501';
        END IF;
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
    IF NOT rework_order_permission(p_door,NULL,v_lot.id) THEN
        RAISE EXCEPTION 'Geen actuele MES-herbewerkingsbevoegdheid' USING ERRCODE='42501';
    END IF;
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

CREATE OR REPLACE FUNCTION trek_herbewerking_in(p_id uuid, p_reden text, p_door uuid) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,public,pg_temp AS $$
DECLARE
    v_order herbewerking%ROWTYPE;
BEGIN
    SELECT * INTO v_order FROM herbewerking WHERE id=p_id FOR UPDATE;
    IF NOT FOUND OR NOT rework_order_permission(p_door,v_order.batch_id,v_order.lot_id) THEN
        RAISE EXCEPTION 'Geen actuele MES-herbewerkingsbevoegdheid' USING ERRCODE='42501';
    END IF;
    IF length(trim(coalesce(p_reden, ''))) = 0 THEN
        RAISE EXCEPTION 'Geef de reden van het intrekken';
    END IF;
    UPDATE herbewerking SET status = 'ingetrokken', ingetrokken_door = p_door, ingetrokken_op = now(), ingetrokken_reden = trim(p_reden)
     WHERE id = p_id AND status = 'open';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Deze herbewerking is al gestart of ingetrokken';
    END IF;
END $$;

REVOKE EXECUTE ON FUNCTION verwerk_batch_besluit(),beslis_keuring(uuid,text,text,uuid,text),maak_herbewerking(text,text,text,uuid,uuid),trek_herbewerking_in(uuid,text,uuid) FROM PUBLIC;
