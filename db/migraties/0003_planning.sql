-- Migratie 0003 (versie 0.9.0): Portaal Planning.
-- Producten, batches plannen (nummers door het systeem), dagplanning per stap, lotvoorstellen.
SET search_path = fabriek, public;

-- ---------------------------------------------------------------------
-- Producten (configuratie, door de planner beheerd)
-- ---------------------------------------------------------------------
CREATE TABLE product (
    id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code    text NOT NULL UNIQUE CHECK (code ~ '^[A-Za-z0-9._-]{1,20}$'),
    naam    text NOT NULL,
    actief  boolean NOT NULL DEFAULT true
);
CREATE TRIGGER product_log BEFORE INSERT OR UPDATE OR DELETE ON product
    FOR EACH ROW EXECUTE FUNCTION log_config();

-- ---------------------------------------------------------------------
-- Batches: planningsgegevens en de status "vervallen"
-- ---------------------------------------------------------------------
ALTER TABLE batch
    ADD COLUMN geplande_dag  date,
    ADD COLUMN volgorde      int CHECK (volgorde > 0),
    ADD COLUMN product_id    uuid REFERENCES product(id),
    ADD COLUMN opmerking     text,
    ADD COLUMN gepland_door  uuid REFERENCES gebruiker(id),
    ADD COLUMN gestart_op    timestamptz,
    ADD COLUMN vervallen_reden text;
ALTER TABLE batch DROP CONSTRAINT batch_status_check;
ALTER TABLE batch ADD CONSTRAINT batch_status_check
    CHECK (status IN ('gepland','in_productie','in_beoordeling','in_lot','afgekeurd','vervallen'));
ALTER TABLE batch ADD CONSTRAINT batch_gepland_door_planner
    CHECK (status NOT IN ('gepland','vervallen') OR bron = 'planner');
ALTER TABLE batch ADD CONSTRAINT batch_planner_heeft_dag
    CHECK (bron <> 'planner' OR geplande_dag IS NOT NULL);
ALTER TABLE batch ADD CONSTRAINT batch_vervallen_reden
    CHECK ((status = 'vervallen') = (vervallen_reden IS NOT NULL));
CREATE INDEX batch_geplande_dag ON batch (geplande_dag);

-- Gestart = moment van de eerste stap (voor analyses; aangemaakt_op is bij planning eerder).
UPDATE batch b SET gestart_op = (SELECT min(r.gestart_op) FROM stapregistratie r WHERE r.batch_id = b.id);

-- Batches plannen: het systeem geeft de volgende vrije nummers (B-jjjj-nnnn, per jaar doorlopend).
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
        SELECT id INTO v_eerste FROM processtap WHERE actief AND niveau = 'batch' ORDER BY volgorde LIMIT 1;
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
    RETURN NEW;
END $$;
CREATE TRIGGER batch_planning_bewaak BEFORE UPDATE ON batch
    FOR EACH ROW EXECUTE FUNCTION bewaak_batchplanning();

-- Werkvoorraad: geplande batches van vandaag (en eerder) staan klaar voor de eerste stap.
CREATE OR REPLACE FUNCTION werkvoorraad(p_stapcode text)
RETURNS TABLE (soort text, nummer text, sinds timestamptz) LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_stap    processtap%ROWTYPE;
    v_vorige  processtap%ROWTYPE;
BEGIN
    SELECT * INTO v_stap FROM processtap WHERE code = p_stapcode AND actief;
    IF NOT FOUND THEN RETURN; END IF;
    SELECT * INTO v_vorige FROM processtap
     WHERE actief AND niveau = v_stap.niveau AND volgorde < v_stap.volgorde
     ORDER BY volgorde DESC LIMIT 1;

    IF v_stap.is_lot_stap THEN
        -- Batches die alle batchstappen afrondden en in productie zijn.
        RETURN QUERY
        SELECT 'batch', b.batchnummer,
               (SELECT max(r.afgerond_op) FROM stapregistratie r WHERE r.batch_id = b.id)
          FROM batch b
         WHERE b.status = 'in_productie'
           AND NOT EXISTS (SELECT 1 FROM processtap s WHERE s.actief AND s.niveau = 'batch'
                             AND NOT EXISTS (SELECT 1 FROM stapregistratie r
                                              WHERE r.batch_id = b.id AND r.processtap_id = s.id AND r.status = 'afgerond'))
         ORDER BY 3;
    ELSIF v_stap.niveau = 'batch' THEN
        RETURN QUERY
        SELECT 'batch', b.batchnummer,
               coalesce((SELECT max(r.afgerond_op) FROM stapregistratie r
                          WHERE r.batch_id = b.id AND r.processtap_id = v_vorige.id),
                        CASE WHEN b.status = 'gepland' THEN greatest(b.aangemaakt_op, b.geplande_dag::timestamptz) ELSE b.aangemaakt_op END)
          FROM batch b
         WHERE (b.status = 'in_productie'
                OR (v_vorige.id IS NULL AND b.status = 'gepland' AND b.geplande_dag <= current_date))
           AND NOT EXISTS (SELECT 1 FROM stapregistratie r WHERE r.batch_id = b.id AND r.processtap_id = v_stap.id)
           AND (v_vorige.id IS NULL OR EXISTS (SELECT 1 FROM stapregistratie r
                 WHERE r.batch_id = b.id AND r.processtap_id = v_vorige.id AND r.status = 'afgerond'))
         ORDER BY 3;
    ELSE
        -- Lotstap na de lot-stap: vorige stap (laatste poging) afgerond en
        -- deze stap sindsdien nog niet gestart.
        RETURN QUERY
        SELECT 'lot', l.lotnummer, vr.afgerond_op
          FROM lot l
          JOIN LATERAL (SELECT r.* FROM stapregistratie r WHERE r.lot_id = l.id AND r.processtap_id = v_vorige.id
                         ORDER BY r.poging DESC LIMIT 1) vr ON vr.status = 'afgerond'
          LEFT JOIN LATERAL (SELECT r.* FROM stapregistratie r WHERE r.lot_id = l.id AND r.processtap_id = v_stap.id
                              ORDER BY r.poging DESC LIMIT 1) dr ON true
         WHERE dr.id IS NULL OR dr.gestart_op < vr.afgerond_op
         ORDER BY 3;
    END IF;
END $$;

-- ---------------------------------------------------------------------
-- Lotvoorstellen: de planner stelt 4 batches voor; de operator mag bij de
-- lot-stap afwijken, maar alleen met een reden.
-- ---------------------------------------------------------------------
CREATE TABLE lot_voorstel (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nummer           int GENERATED ALWAYS AS IDENTITY UNIQUE,
    status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open','gebruikt','afgeweken','vervallen')),
    opmerking        text,
    aangemaakt_door  uuid NOT NULL REFERENCES gebruiker(id),
    aangemaakt_op    timestamptz NOT NULL DEFAULT now(),
    lot_id           uuid REFERENCES lot(id),
    afwijking_reden  text,
    afgesloten_op    timestamptz,
    CHECK ((status IN ('gebruikt','afgeweken')) = (lot_id IS NOT NULL)),
    CHECK ((status = 'afgeweken') = (afwijking_reden IS NOT NULL))
);
CREATE TABLE lot_voorstel_batch (
    voorstel_id  uuid NOT NULL REFERENCES lot_voorstel(id),
    batch_id     uuid NOT NULL REFERENCES batch(id),
    PRIMARY KEY (voorstel_id, batch_id)
);
CREATE INDEX lot_voorstel_batch_batch ON lot_voorstel_batch (batch_id);

-- Een batch staat in hoogstens één open voorstel; een voorstel heeft 4 batches.
CREATE FUNCTION controleer_lot_voorstel(p_voorstel uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_dubbel text;
BEGIN
    IF (SELECT status FROM lot_voorstel WHERE id = p_voorstel) <> 'open' THEN RETURN; END IF;
    IF (SELECT count(*) FROM lot_voorstel_batch WHERE voorstel_id = p_voorstel) <> 4 THEN
        RAISE EXCEPTION 'Een lotvoorstel bestaat uit precies 4 batches';
    END IF;
    SELECT string_agg(b.batchnummer || ' (voorstel ' || v2.nummer || ')', ', ') INTO v_dubbel
      FROM lot_voorstel_batch x
      JOIN lot_voorstel_batch y ON y.batch_id = x.batch_id AND y.voorstel_id <> x.voorstel_id
      JOIN lot_voorstel v2 ON v2.id = y.voorstel_id AND v2.status = 'open'
      JOIN batch b ON b.id = x.batch_id
     WHERE x.voorstel_id = p_voorstel;
    IF v_dubbel IS NOT NULL THEN
        RAISE EXCEPTION 'Deze batches staan al in een ander open voorstel: %', v_dubbel;
    END IF;
    IF EXISTS (SELECT 1 FROM lot_voorstel_batch x JOIN batch b ON b.id = x.batch_id
                WHERE x.voorstel_id = p_voorstel AND b.status NOT IN ('gepland','in_productie','in_beoordeling')) THEN
        RAISE EXCEPTION 'Een lotvoorstel kan alleen batches bevatten die nog niet in een lot zitten, niet afgekeurd en niet vervallen';
    END IF;
END $$;

-- Lotvoorstel opslaan (nieuw of batches vervangen); controleert alles in één keer.
CREATE FUNCTION bewaar_lot_voorstel(p_id uuid, p_batches uuid[], p_opmerking text, p_door uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_id uuid := p_id;
BEGIN
    IF cardinality(p_batches) <> 4 OR (SELECT count(DISTINCT b) FROM unnest(p_batches) b) <> 4 THEN
        RAISE EXCEPTION 'Een lotvoorstel bestaat uit precies 4 verschillende batches';
    END IF;
    IF v_id IS NULL THEN
        INSERT INTO lot_voorstel (opmerking, aangemaakt_door) VALUES (nullif(btrim(p_opmerking), ''), p_door) RETURNING id INTO v_id;
    ELSE
        IF (SELECT status FROM lot_voorstel WHERE id = v_id) IS DISTINCT FROM 'open' THEN
            RAISE EXCEPTION 'Alleen een open voorstel kan worden gewijzigd';
        END IF;
        UPDATE lot_voorstel SET opmerking = nullif(btrim(p_opmerking), '') WHERE id = v_id;
        DELETE FROM lot_voorstel_batch WHERE voorstel_id = v_id;
    END IF;
    INSERT INTO lot_voorstel_batch (voorstel_id, batch_id) SELECT v_id, unnest(p_batches);
    PERFORM controleer_lot_voorstel(v_id);
    RETURN v_id;
END $$;

-- maak_lot krijgt een reden voor afwijken van een voorstel.
DROP FUNCTION maak_lot(text, uuid[], uuid, uuid, uuid, uuid);
CREATE FUNCTION maak_lot(p_lotnummer text, p_batches uuid[], p_pc uuid, p_operator uuid,
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

    -- Elke batch: in productie, en alle actieve batchstappen afgerond.
    SELECT string_agg(probleem, '; ') INTO v_probleem FROM (
        SELECT b.batchnummer || ' heeft status ' || b.status AS probleem
          FROM batch b WHERE b.id = ANY(p_batches) AND b.status <> 'in_productie'
        UNION ALL
        SELECT b.batchnummer || ': ' || s.code || ' niet afgerond'
          FROM batch b
          CROSS JOIN processtap s
         WHERE b.id = ANY(p_batches) AND s.actief AND s.niveau = 'batch'
           AND NOT EXISTS (SELECT 1 FROM stapregistratie r
                            WHERE r.batch_id = b.id AND r.processtap_id = s.id AND r.status = 'afgerond')
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

-- ---------------------------------------------------------------------
-- Dagplanning per stap: welke batch (of lot, of lotvoorstel) op welke dag in welke stap
-- ---------------------------------------------------------------------
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

ALTER FUNCTION plan_batches(int, date, uuid, text, uuid) SET search_path = fabriek, public;
ALTER FUNCTION start_geplande_batch() SET search_path = fabriek, public;
ALTER FUNCTION bewaak_batchplanning() SET search_path = fabriek, public;
ALTER FUNCTION werkvoorraad(text) SET search_path = fabriek, public;
ALTER FUNCTION controleer_lot_voorstel(uuid) SET search_path = fabriek, public;
ALTER FUNCTION bewaar_lot_voorstel(uuid, uuid[], text, uuid) SET search_path = fabriek, public;
ALTER FUNCTION maak_lot(text, uuid[], uuid, uuid, uuid, uuid, text) SET search_path = fabriek, public;
ALTER FUNCTION controleer_stapplanning() SET search_path = fabriek, public;
