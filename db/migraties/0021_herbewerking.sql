-- Migratie 0021 (versie 0.35.0): rol productiemanager en herbewerkingen met opdracht en stand (#61, D57).
-- Kwaliteit of de productiemanager maakt een herbewerking aan voor een batch (nog niet in een lot) of een lot;
-- de operator start hem in die stap. Oudere invoerschermen blijven werken: hun gewone start wordt de
-- herbewerking, en een herbewerking zonder opdracht wordt alsnog vastgelegd. Er hoeft niemand iets te doen.
SET search_path = fabriek, public;

ALTER TABLE gebruiker DROP CONSTRAINT gebruiker_rol_check;
ALTER TABLE gebruiker ADD CONSTRAINT gebruiker_rol_check
    CHECK (rol IN ('operator','ploegleider','kwaliteit','beheerder','analist','planner','scherm','productiemanager'));
ALTER TABLE batch_besluit DROP CONSTRAINT batch_besluit_besluit_check;
ALTER TABLE batch_besluit ADD CONSTRAINT batch_besluit_besluit_check
    CHECK (besluit IN ('in_beoordeling','vrijgegeven','afgekeurd','herbewerken'));
ALTER TABLE melding DROP CONSTRAINT melding_soort_check;
ALTER TABLE melding ADD CONSTRAINT melding_soort_check
    CHECK (soort IN ('buiten_grens','beoordeling','vrijgegeven','afgekeurd','lot_afgeweken','storing','herbewerking'));

-- Herbewerkingen (sinds migratie 0021, #61): Kwaliteit of de productiemanager besluit dat een batch of lot
-- terug moet naar een eerdere stap. De operator start de opdracht in die stap; daarna doorloopt de batch
-- of het lot alle volgende stappen opnieuw. aangemaakt_door leeg = zonder opdracht gestart (een ouder
-- invoerscherm, of van vóór 0021).
CREATE TABLE herbewerking (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id            uuid REFERENCES batch(id),
    lot_id              uuid REFERENCES lot(id),
    processtap_id       uuid NOT NULL REFERENCES processtap(id),
    reden               text NOT NULL CHECK (length(trim(reden)) > 0),
    status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open','gestart','ingetrokken')),
    aangemaakt_door     uuid REFERENCES gebruiker(id),
    aangemaakt_op       timestamptz NOT NULL DEFAULT now(),
    stapregistratie_id  uuid UNIQUE REFERENCES stapregistratie(id),
    ingetrokken_door    uuid REFERENCES gebruiker(id),
    ingetrokken_op      timestamptz,
    ingetrokken_reden   text,
    CHECK ((batch_id IS NULL) <> (lot_id IS NULL)),
    CHECK ((status = 'gestart') = (stapregistratie_id IS NOT NULL)),
    CHECK ((status = 'ingetrokken') = (ingetrokken_reden IS NOT NULL))
);
-- Per batch of lot hoogstens één opdracht die nog niet gestart is.
CREATE UNIQUE INDEX herbewerking_open_batch ON herbewerking (batch_id) WHERE status = 'open' AND batch_id IS NOT NULL;
CREATE UNIQUE INDEX herbewerking_open_lot   ON herbewerking (lot_id)   WHERE status = 'open' AND lot_id IS NOT NULL;
CREATE INDEX herbewerking_tijd ON herbewerking (aangemaakt_op);

-- Is deze batchstap gedaan (sinds migratie 0021)? Er is een afgeronde registratie, en geen herbewerking
-- die daarna begon bij deze stap of eerder in de route. Volgorde op de aankomst op de server, zodat
-- verschillende klokken op de pc's niet meetellen (ouder dan 0011: het moment op het apparaat).
CREATE FUNCTION batch_stap_gedaan(p_batch uuid, p_stap uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    WITH rt AS (SELECT r.processtap_id, r.plek FROM batch b CROSS JOIN LATERAL route(b.product_id) r WHERE b.id = p_batch)
    SELECT EXISTS (
        SELECT 1 FROM stapregistratie x
         WHERE x.batch_id = p_batch AND x.processtap_id = p_stap AND x.status = 'afgerond'
           AND NOT EXISTS (
               SELECT 1 FROM stapregistratie h JOIN rt ON rt.processtap_id = h.processtap_id
                WHERE h.batch_id = p_batch AND h.herbewerking_start AND h.id <> x.id
                  AND rt.plek <= (SELECT plek FROM rt WHERE processtap_id = p_stap)
                  AND coalesce(h.gestart_ontvangen_op, h.gestart_op) > coalesce(x.gestart_ontvangen_op, x.gestart_op)))
$$;

CREATE OR REPLACE FUNCTION batch_klaar_voor_lot(p_batch uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT NOT EXISTS (
        SELECT 1 FROM batch b
          CROSS JOIN LATERAL route(b.product_id) r
          JOIN processtap s ON s.id = r.processtap_id AND s.niveau = 'batch'
         WHERE b.id = p_batch
           AND NOT batch_stap_gedaan(b.id, s.id))
       AND NOT EXISTS (SELECT 1 FROM herbewerking h WHERE h.batch_id = p_batch AND h.status = 'open')
$$;

CREATE OR REPLACE FUNCTION controleer_stapregistratie() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_stap        processtap%ROWTYPE;
    v_vorige      processtap%ROWTYPE;
    v_status      text;
    v_vorige_reg  stapregistratie%ROWTYPE;
    v_deze_laatst stapregistratie%ROWTYPE;
    v_max_poging  int;
    v_product     uuid;
    v_vorige_id   uuid;
    v_opdracht    herbewerking%ROWTYPE;
BEGIN
    SELECT * INTO v_stap FROM processtap WHERE id = NEW.processtap_id;
    IF NOT v_stap.actief THEN
        RAISE EXCEPTION 'Stap % is inactief', v_stap.code;
    END IF;

    -- Niveau moet kloppen.
    IF v_stap.niveau = 'batch' AND NEW.batch_id IS NULL THEN
        RAISE EXCEPTION 'Stap % wordt per batch geregistreerd', v_stap.code;
    END IF;
    IF v_stap.niveau = 'lot' AND NEW.lot_id IS NULL THEN
        RAISE EXCEPTION 'Stap % wordt per lot geregistreerd', v_stap.code;
    END IF;

    -- Route: de stap moet bij het product van de batch of het lot horen (D55).
    v_product := CASE WHEN NEW.batch_id IS NOT NULL THEN (SELECT product_id FROM batch WHERE id = NEW.batch_id)
                      ELSE lot_product(NEW.lot_id) END;
    IF NOT in_route(v_product, v_stap.id) THEN
        RAISE EXCEPTION 'Stap % hoort niet bij de route van product %', v_stap.code, (SELECT code FROM product WHERE id = v_product);
    END IF;
    NEW.product_id := v_product;   -- vastgelegd voor grenzen en analyses per product (sinds 0019)

    -- Batchstatus.
    IF NEW.batch_id IS NOT NULL THEN
        SELECT status INTO v_status FROM batch WHERE id = NEW.batch_id;
        IF v_status <> 'in_productie' THEN
            RAISE EXCEPTION 'Batch heeft status % en kan niet verder', v_status;
        END IF;
    END IF;

    -- De lot-stap wordt alleen via maak_lot() aangemaakt (poging 1).
    IF v_stap.is_lot_stap AND NEW.poging = 1 AND current_setting('fabriek.maak_lot', true) IS DISTINCT FROM 'aan' THEN
        RAISE EXCEPTION 'Gebruik maak_lot() om een lot samen te stellen';
    END IF;

    -- Volgnummer van de poging.
    IF NEW.batch_id IS NOT NULL THEN
        SELECT max(poging) INTO v_max_poging FROM stapregistratie
         WHERE processtap_id = NEW.processtap_id AND batch_id = NEW.batch_id;
    ELSE
        SELECT max(poging) INTO v_max_poging FROM stapregistratie
         WHERE processtap_id = NEW.processtap_id AND lot_id = NEW.lot_id;
    END IF;
    IF NEW.poging <> coalesce(v_max_poging, 0) + 1 THEN
        RAISE EXCEPTION 'Poging moet % zijn', coalesce(v_max_poging, 0) + 1;
    END IF;

    -- Een herbewerking die nog niet gestart is (sinds 0021): de batch of het lot kan alleen die stap
    -- starten, en die start is dan de herbewerking (ook vanaf een ouder invoerscherm).
    SELECT * INTO v_opdracht FROM herbewerking
     WHERE status = 'open' AND (batch_id = NEW.batch_id OR lot_id = NEW.lot_id);
    IF FOUND THEN
        IF v_opdracht.processtap_id <> NEW.processtap_id THEN
            RAISE EXCEPTION 'Er staat een herbewerking open: eerst terug naar stap %',
                (SELECT code FROM processtap WHERE id = v_opdracht.processtap_id);
        END IF;
        IF NOT NEW.herbewerking_start THEN
            NEW.herbewerking_start := true;
            NEW.reden := v_opdracht.reden;
        END IF;
    END IF;

    -- Herbewerking: een stap die al eens doorlopen is, zonder open stap (batch sinds 0021, D4).
    IF NEW.herbewerking_start THEN
        IF v_max_poging IS NULL THEN
            RAISE EXCEPTION 'Stap % is voor % nog niet doorlopen; geen herbewerking mogelijk', v_stap.code,
                CASE WHEN NEW.lot_id IS NULL THEN 'deze batch' ELSE 'dit lot' END;
        END IF;
        IF EXISTS (SELECT 1 FROM stapregistratie WHERE (batch_id = NEW.batch_id OR lot_id = NEW.lot_id) AND status = 'open') THEN
            RAISE EXCEPTION '% heeft nog een open stap; rond die eerst af', CASE WHEN NEW.lot_id IS NULL THEN 'Batch' ELSE 'Lot' END;
        END IF;
        RETURN NEW;
    END IF;

    -- Niets openzetten als dezelfde stap nog open staat.
    IF EXISTS (SELECT 1 FROM stapregistratie
                WHERE processtap_id = NEW.processtap_id
                  AND (batch_id = NEW.batch_id OR lot_id = NEW.lot_id) AND status = 'open') THEN
        RAISE EXCEPTION 'Stap % staat nog open', v_stap.code;
    END IF;

    -- Volgorde: de vorige stap van hetzelfde niveau in de route moet afgerond
    -- zijn, en nieuwer zijn dan de laatste registratie van deze stap
    -- (zo moet een lot na herbewerking alle volgende stappen opnieuw doen).
    v_vorige_id := route_vorige(v_product, v_stap.id);

    -- Batch (sinds 0021): de vorige stap gedaan en deze nog niet, met herbewerkingen meegerekend.
    IF NEW.batch_id IS NOT NULL THEN
        IF v_vorige_id IS NOT NULL AND NOT batch_stap_gedaan(NEW.batch_id, v_vorige_id) THEN
            RAISE EXCEPTION 'Stap % moet eerst afgerond zijn', (SELECT code FROM processtap WHERE id = v_vorige_id);
        END IF;
        IF batch_stap_gedaan(NEW.batch_id, v_stap.id) THEN
            RAISE EXCEPTION 'Stap % is al doorlopen; herhalen kan alleen via herbewerking', v_stap.code;
        END IF;
        RETURN NEW;
    END IF;

    IF v_vorige_id IS NOT NULL THEN
        SELECT * INTO v_vorige FROM processtap WHERE id = v_vorige_id;
        SELECT * INTO v_vorige_reg FROM stapregistratie
         WHERE processtap_id = v_vorige.id
           AND (batch_id = NEW.batch_id OR lot_id = NEW.lot_id)
         ORDER BY poging DESC LIMIT 1;
        IF NOT FOUND OR v_vorige_reg.status <> 'afgerond' THEN
            RAISE EXCEPTION 'Stap % moet eerst afgerond zijn', v_vorige.code;
        END IF;

        SELECT * INTO v_deze_laatst FROM stapregistratie
         WHERE processtap_id = NEW.processtap_id
           AND (batch_id = NEW.batch_id OR lot_id = NEW.lot_id)
         ORDER BY poging DESC LIMIT 1;
        IF FOUND AND v_vorige_reg.afgerond_op <= v_deze_laatst.gestart_op THEN
            RAISE EXCEPTION 'Stap % is al doorlopen; herhalen kan alleen via herbewerking', v_stap.code;
        END IF;
    ELSIF v_max_poging IS NOT NULL THEN
        -- Eerste stap van dit niveau: herhalen kan alleen via herbewerking.
        RAISE EXCEPTION 'Stap % is al doorlopen; herhalen kan alleen via herbewerking', v_stap.code;
    END IF;

    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION maak_lot(p_lotnummer text, p_batches uuid[], p_pc uuid, p_operator uuid,
                         p_lot_id uuid DEFAULT NULL, p_registratie_id uuid DEFAULT NULL,
                         p_afwijking_reden text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_lot       uuid;
    v_lotstap   processtap%ROWTYPE;
    v_probleem  text;
    v_voorstel  record;
    v_reden     text := nullif(btrim(p_afwijking_reden), '');
BEGIN
    IF cardinality(p_batches) <> 4 OR (SELECT count(DISTINCT b) FROM unnest(p_batches) b) <> 4 THEN
        RAISE EXCEPTION 'Een lot bestaat uit precies 4 verschillende batches';
    END IF;

    SELECT * INTO v_lotstap FROM processtap WHERE is_lot_stap AND actief;

    -- Lock de batches zodat ze niet tegelijk in twee lots komen.
    PERFORM 1 FROM batch WHERE id = ANY(p_batches) FOR UPDATE;

    -- Eén product per lot (D55).
    IF (SELECT count(DISTINCT product_id) + max(CASE WHEN product_id IS NULL THEN 1 ELSE 0 END)
          FROM batch WHERE id = ANY(p_batches)) > 1 THEN
        RAISE EXCEPTION 'Een lot bestaat uit batches van hetzelfde product (nu: %)',
            (SELECT string_agg(DISTINCT coalesce(p.code, 'geen product'), ', ')
               FROM batch b LEFT JOIN product p ON p.id = b.product_id WHERE b.id = ANY(p_batches));
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

    INSERT INTO lot (id, lotnummer) VALUES (coalesce(p_lot_id, gen_random_uuid()), p_lotnummer) RETURNING id INTO v_lot;
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

CREATE OR REPLACE FUNCTION werkvoorraad(p_stapcode text)
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

CREATE OR REPLACE FUNCTION verwerk_batch_besluit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_rol    text;
    v_status text;
BEGIN
    SELECT rol INTO v_rol FROM gebruiker WHERE id = NEW.besloten_door AND actief;
    IF NEW.besluit = 'in_beoordeling' AND (v_rol IS NULL OR v_rol NOT IN ('ploegleider','kwaliteit','productiemanager')) THEN
        RAISE EXCEPTION 'Alleen een ploegleider, de productiemanager of Kwaliteit mag een batch in beoordeling zetten';
    END IF;
    -- herbewerken (sinds 0021): het derde keurresultaat; maak_herbewerking() legt het vast.
    IF NEW.besluit IN ('vrijgegeven','afgekeurd','herbewerken') AND (v_rol IS NULL OR v_rol <> 'kwaliteit') THEN
        RAISE EXCEPTION 'Alleen Kwaliteit mag het keurresultaat (OK/NOK) invoeren';
    END IF;

    SELECT status INTO v_status FROM batch WHERE id = NEW.batch_id FOR UPDATE;
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
        -- Een herbewerking die nog niet gestart is, vervalt (sinds 0021).
        UPDATE herbewerking
           SET status = 'ingetrokken', ingetrokken_door = NEW.besloten_door, ingetrokken_op = now(),
               ingetrokken_reden = 'Batch afgekeurd: ' || NEW.reden
         WHERE batch_id = NEW.batch_id AND status = 'open';
    END IF;
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION meld_besluit() RETURNS trigger LANGUAGE plpgsql AS $$
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

-- Herbewerkingen van vóór deze migratie: gestart zonder opdracht.
INSERT INTO herbewerking (batch_id, lot_id, processtap_id, reden, status, aangemaakt_op, stapregistratie_id)
SELECT batch_id, lot_id, processtap_id, reden, 'gestart', gestart_op, id
  FROM stapregistratie WHERE herbewerking_start;

-- Een herbewerking koppelen aan de registratie die hem start (sinds 0021). Zonder opdracht (een ouder
-- invoerscherm, of de functie start_herbewerking) wordt hij hier alsnog vastgelegd, zonder aanmaker.
CREATE FUNCTION koppel_herbewerking() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT NEW.herbewerking_start THEN RETURN NULL; END IF;
    UPDATE herbewerking SET status = 'gestart', stapregistratie_id = NEW.id
     WHERE status = 'open' AND processtap_id = NEW.processtap_id
       AND (batch_id = NEW.batch_id OR lot_id = NEW.lot_id);
    IF NOT FOUND THEN
        INSERT INTO herbewerking (batch_id, lot_id, processtap_id, reden, status, aangemaakt_op, stapregistratie_id)
        VALUES (NEW.batch_id, NEW.lot_id, NEW.processtap_id, NEW.reden, 'gestart', NEW.gestart_op, NEW.id);
    END IF;
    RETURN NULL;
END $$;
CREATE TRIGGER stapregistratie_herbewerking AFTER INSERT ON stapregistratie
    FOR EACH ROW EXECUTE FUNCTION koppel_herbewerking();

-- Een herbewerking aanmaken (sinds 0021, #61): Kwaliteit of de productiemanager. Een batch die nog niet in
-- een lot zit, of een lot; terug naar een stap van hetzelfde niveau die al doorlopen is. Een batch in
-- beoordeling: alleen Kwaliteit, en dat is dan het keurresultaat "herbewerken" (D7).
CREATE FUNCTION maak_herbewerking(p_nummer text, p_stapcode text, p_reden text, p_door uuid, p_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
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
            IF v_rol <> 'kwaliteit' THEN
                RAISE EXCEPTION 'Batch % is in beoordeling; alleen Kwaliteit beslist dan over herbewerken', p_nummer;
            END IF;
            INSERT INTO batch_besluit (batch_id, besluit, reden, besloten_door)
            VALUES (v_batch.id, 'herbewerken', 'Terug naar ' || p_stapcode || ': ' || p_reden, p_door);
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

-- Een herbewerking die nog niet gestart is, intrekken (sinds 0021).
CREATE FUNCTION trek_herbewerking_in(p_id uuid, p_reden text, p_door uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_rol text;
BEGIN
    SELECT rol INTO v_rol FROM gebruiker WHERE id = p_door AND actief;
    IF v_rol IS NULL OR v_rol NOT IN ('kwaliteit', 'productiemanager') THEN
        RAISE EXCEPTION 'Alleen Kwaliteit of de productiemanager trekt een herbewerking in';
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

-- Een nieuwe herbewerking is een melding waard: de vloer moet hem doen, de planner hem plannen.
CREATE FUNCTION meld_herbewerking() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_nr   text;
    v_door text;
BEGIN
    IF NEW.aangemaakt_door IS NULL THEN RETURN NULL; END IF;
    SELECT coalesce(b.batchnummer, l.lotnummer) INTO v_nr
      FROM (SELECT NEW.batch_id AS b, NEW.lot_id AS l) x LEFT JOIN batch b ON b.id = x.b LEFT JOIN lot l ON l.id = x.l;
    SELECT gebruikersnaam INTO v_door FROM gebruiker WHERE id = NEW.aangemaakt_door;
    INSERT INTO melding (soort, ernst, tekst, batchnummer, lotnummer, voor_rollen, bron_id)
    VALUES ('herbewerking', 'let_op',
            format('%s terug naar %s (herbewerking) door %s: %s', v_nr, (SELECT code FROM processtap WHERE id = NEW.processtap_id), v_door, NEW.reden),
            CASE WHEN NEW.batch_id IS NOT NULL THEN v_nr END, CASE WHEN NEW.lot_id IS NOT NULL THEN v_nr END,
            ARRAY['ploegleider','planner','kwaliteit','productiemanager'], NEW.id);
    RETURN NULL;
END $$;
CREATE TRIGGER herbewerking_melding AFTER INSERT ON herbewerking FOR EACH ROW EXECUTE FUNCTION meld_herbewerking();

-- De stand van een geplande stap (Planning per stap en de ploegoverdracht, sinds 0021): gepland, bezig of
-- gedaan. Een herbewerking die nog niet gestart is, staat op gepland; een batchstap telt met herbewerkingen mee.
CREATE FUNCTION plan_stand(p_plan uuid) RETURNS text LANGUAGE sql STABLE AS $$
    SELECT CASE
             WHEN sp.voorstel_id IS NOT NULL THEN
               CASE WHEN (SELECT v.status FROM lot_voorstel v WHERE v.id = sp.voorstel_id) IN ('gebruikt','afgeweken') THEN 'gedaan' ELSE 'gepland' END
             WHEN EXISTS (SELECT 1 FROM herbewerking h WHERE h.status = 'open' AND h.processtap_id = sp.processtap_id
                           AND (h.batch_id = sp.batch_id OR h.lot_id = sp.lot_id)) THEN 'gepland'
             WHEN EXISTS (SELECT 1 FROM stapregistratie r WHERE r.processtap_id = sp.processtap_id
                           AND (r.batch_id = sp.batch_id OR r.lot_id = sp.lot_id) AND r.status = 'open') THEN 'bezig'
             WHEN sp.batch_id IS NOT NULL THEN CASE WHEN batch_stap_gedaan(sp.batch_id, sp.processtap_id) THEN 'gedaan' ELSE 'gepland' END
             ELSE coalesce((SELECT CASE r.status WHEN 'afgerond' THEN 'gedaan' ELSE 'gepland' END
                              FROM stapregistratie r
                             WHERE r.processtap_id = sp.processtap_id AND r.lot_id = sp.lot_id AND r.status <> 'afgebroken'
                             ORDER BY r.poging DESC LIMIT 1), 'gepland')
           END
      FROM stapplanning sp WHERE sp.id = p_plan
$$;

-- Herbewerkingen met hun stand (sinds 0021, #61): te plannen, gepland, bezig, klaar, gestopt (batch
-- afgekeurd) of ingetrokken.
CREATE VIEW herbewerking_stand AS
SELECT h.id, h.batch_id, h.lot_id,
       CASE WHEN h.batch_id IS NOT NULL THEN 'batch' ELSE 'lot' END AS soort,
       coalesce(b.batchnummer, l.lotnummer) AS nummer,
       coalesce(b.product_id, lot_product(h.lot_id)) AS product_id,
       s.code AS stap, s.naam AS stapnaam, h.reden,
       g.gebruikersnaam AS door, h.aangemaakt_op,
       p.dag AS gepland_op, r.gestart_op,
       CASE
         WHEN h.status = 'ingetrokken' THEN 'ingetrokken'
         WHEN h.status = 'open' THEN CASE WHEN p.dag IS NULL THEN 'te_plannen' ELSE 'gepland' END
         WHEN h.batch_id IS NOT NULL AND b.status = 'afgekeurd' THEN 'gestopt'
         WHEN h.batch_id IS NOT NULL AND (b.status = 'in_lot' OR batch_klaar_voor_lot(b.id)) THEN 'klaar'
         WHEN h.lot_id IS NOT NULL AND l.status = 'gereed' THEN 'klaar'
         ELSE 'bezig'
       END AS stand,
       h.ingetrokken_reden, gi.gebruikersnaam AS ingetrokken_door, h.ingetrokken_op
  FROM herbewerking h
  JOIN processtap s ON s.id = h.processtap_id
  LEFT JOIN batch b ON b.id = h.batch_id
  LEFT JOIN lot l ON l.id = h.lot_id
  LEFT JOIN gebruiker g ON g.id = h.aangemaakt_door
  LEFT JOIN gebruiker gi ON gi.id = h.ingetrokken_door
  LEFT JOIN stapregistratie r ON r.id = h.stapregistratie_id
  LEFT JOIN LATERAL (SELECT min(sp.dag) AS dag FROM stapplanning sp
                      WHERE h.status = 'open' AND sp.processtap_id = h.processtap_id
                        AND (sp.batch_id = h.batch_id OR sp.lot_id = h.lot_id)
                        AND sp.dag >= (h.aangemaakt_op AT TIME ZONE fabriekstijdzone())::date) p ON true;

-- Elke functie werkt in schema fabriek (zoals in 0001).
DO $$
DECLARE f record;
BEGIN
    FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'fabriek' LOOP
        EXECUTE format('ALTER FUNCTION %s SET search_path = fabriek, public', f.sig);
    END LOOP;
END $$;
