-- Migratie 0018 (versie 0.28.0): route per product (D55, #51).
-- Een product zonder eigen route volgt de standaardroute (alle actieve stappen): bestaande gegevens
-- en batches zonder product blijven zich gedragen zoals voorheen.
SET search_path = fabriek, public;

-- Route per product (sinds migratie 0018, D55): welke stappen een product doorloopt, in welke volgorde.
-- Een product zonder regels hier volgt de standaardroute: alle actieve stappen.
CREATE TABLE product_stap (
    product_id     uuid NOT NULL REFERENCES product(id),
    processtap_id  uuid NOT NULL REFERENCES processtap(id),
    plek           int  NOT NULL CHECK (plek > 0),
    PRIMARY KEY (product_id, processtap_id),
    UNIQUE (product_id, plek)
);
CREATE TRIGGER product_stap_log BEFORE INSERT OR UPDATE OR DELETE ON product_stap
    FOR EACH ROW EXECUTE FUNCTION log_config();


CREATE OR REPLACE FUNCTION log_config() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_oud   jsonb;
    v_nieuw jsonb;
BEGIN
    IF TG_OP = 'DELETE' AND TG_TABLE_NAME NOT IN ('pc_stap', 'product_stap') THEN
        RAISE EXCEPTION 'Configuratie wordt niet verwijderd; zet % op inactief', TG_TABLE_NAME;
    END IF;
    IF TG_OP <> 'INSERT' THEN v_oud := to_jsonb(OLD) - 'wachtwoord_hash'; END IF;
    IF TG_OP <> 'DELETE' THEN v_nieuw := to_jsonb(NEW) - 'wachtwoord_hash'; END IF;
    IF TG_TABLE_NAME = 'gebruiker' AND TG_OP = 'UPDATE' THEN
        IF NEW.wachtwoord_hash IS DISTINCT FROM OLD.wachtwoord_hash THEN
            v_nieuw := v_nieuw || '{"wachtwoord": "gewijzigd"}';
        END IF;
    END IF;
    INSERT INTO config_log (tabel, record_id, actie, oud, nieuw, gewijzigd_door)
    VALUES (TG_TABLE_NAME,
            coalesce((coalesce(v_nieuw, v_oud) ->> 'id')::uuid, (coalesce(v_nieuw, v_oud) ->> 'pc_id')::uuid,
                     (coalesce(v_nieuw, v_oud) ->> 'product_id')::uuid),
            TG_OP, v_oud, v_nieuw,
            coalesce(current_setting('fabriek.gebruiker', true), 'onbekend'));
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$;

-- ---------------------------------------------------------------------
-- Route per product (sinds migratie 0018, D55)
-- ---------------------------------------------------------------------
-- De route van een product: de actieve stappen die het doorloopt, in volgorde (plek 1, 2, ...).
-- Zonder product, of bij een product zonder eigen route: alle actieve stappen (de standaardroute).
CREATE FUNCTION route(p_product uuid) RETURNS TABLE (processtap_id uuid, plek int) LANGUAGE sql STABLE AS $$
    SELECT s.id, (row_number() OVER (ORDER BY coalesce(ps.plek, s.volgorde), s.volgorde))::int
      FROM processtap s
      LEFT JOIN product_stap ps ON ps.processtap_id = s.id AND ps.product_id = p_product
     WHERE s.actief
       AND (ps.product_id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM product_stap x WHERE x.product_id = p_product))
$$;

-- Hoort de stap bij de route van het product?
CREATE FUNCTION in_route(p_product uuid, p_stap uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM route(p_product) r WHERE r.processtap_id = p_stap)
$$;

-- De vorige stap van hetzelfde niveau in de route (NULL bij de eerste).
CREATE FUNCTION route_vorige(p_product uuid, p_stap uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
    WITH r AS (SELECT r.processtap_id, r.plek, s.niveau FROM route(p_product) r JOIN processtap s ON s.id = r.processtap_id)
    SELECT v.processtap_id FROM r v JOIN r deze ON deze.processtap_id = p_stap
     WHERE v.niveau = deze.niveau AND v.plek < deze.plek
     ORDER BY v.plek DESC LIMIT 1
$$;

-- De eerste of laatste stap van een niveau ('batch' of 'lot') in de route.
CREATE FUNCTION route_eerste(p_product uuid, p_niveau text) RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT r.processtap_id FROM route(p_product) r JOIN processtap s ON s.id = r.processtap_id
     WHERE s.niveau = p_niveau ORDER BY r.plek LIMIT 1
$$;
CREATE FUNCTION route_laatste(p_product uuid, p_niveau text) RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT r.processtap_id FROM route(p_product) r JOIN processtap s ON s.id = r.processtap_id
     WHERE s.niveau = p_niveau ORDER BY r.plek DESC LIMIT 1
$$;

-- Het product van een lot: dat van zijn batches (een lot bestaat uit batches van één product).
CREATE FUNCTION lot_product(p_lot uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT product_id FROM batch WHERE lot_id = p_lot ORDER BY batchnummer LIMIT 1
$$;

-- Heeft de batch alle batchstappen van zijn route afgerond? (De status controleert de aanroeper.)
CREATE FUNCTION batch_klaar_voor_lot(p_batch uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT NOT EXISTS (
        SELECT 1 FROM batch b
          CROSS JOIN LATERAL route(b.product_id) r
          JOIN processtap s ON s.id = r.processtap_id AND s.niveau = 'batch'
         WHERE b.id = p_batch
           AND NOT EXISTS (SELECT 1 FROM stapregistratie x
                            WHERE x.batch_id = b.id AND x.processtap_id = s.id AND x.status = 'afgerond'))
$$;

-- Eerste en laatste stappen per product, voor de analyses (NULL = batches zonder product).
CREATE VIEW route_grenzen AS
SELECT p.id AS product_id,
       route_eerste(p.id, 'batch')  AS eerste_batchstap,
       route_laatste(p.id, 'batch') AS laatste_batchstap,
       route_laatste(p.id, 'lot')   AS laatste_lotstap
  FROM product p
UNION ALL
SELECT NULL, route_eerste(NULL, 'batch'), route_laatste(NULL, 'batch'), route_laatste(NULL, 'lot');

-- Een eigen route moet kloppen: minstens één batchstap, de lotstap erin, en eerst de batchstappen,
-- dan de lotstap, dan de lotstappen.
CREATE FUNCTION controleer_route(p_product uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_code     text := (SELECT code FROM product WHERE id = p_product);
    v_lotstap  processtap%ROWTYPE;
    v_plek     int;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM product_stap WHERE product_id = p_product) THEN RETURN; END IF;
    SELECT * INTO v_lotstap FROM processtap WHERE is_lot_stap AND actief;
    SELECT plek INTO v_plek FROM product_stap WHERE product_id = p_product AND processtap_id = v_lotstap.id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'De route van % moet de lotstap % bevatten', v_code, v_lotstap.code;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM product_stap ps JOIN processtap s ON s.id = ps.processtap_id
                    WHERE ps.product_id = p_product AND s.niveau = 'batch' AND s.actief) THEN
        RAISE EXCEPTION 'De route van % heeft minstens één batchstap nodig', v_code;
    END IF;
    IF EXISTS (SELECT 1 FROM product_stap ps JOIN processtap s ON s.id = ps.processtap_id
                WHERE ps.product_id = p_product
                  AND ((s.niveau = 'batch' AND ps.plek > v_plek) OR (s.niveau = 'lot' AND NOT s.is_lot_stap AND ps.plek < v_plek))) THEN
        RAISE EXCEPTION 'In de route van % komen eerst de batchstappen, dan de lotstap %, dan de lotstappen', v_code, v_lotstap.code;
    END IF;
END $$;

CREATE FUNCTION controleer_product_stap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM controleer_route(CASE WHEN TG_OP = 'DELETE' THEN OLD.product_id ELSE NEW.product_id END);
    RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER product_stap_controle AFTER INSERT OR UPDATE OR DELETE ON product_stap
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION controleer_product_stap();

-- Route van een product vastleggen: de stapcodes in volgorde. Leeg of NULL = de standaardroute (alle stappen).
CREATE FUNCTION zet_route(p_product uuid, p_stappen text[]) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_onbekend text;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM product WHERE id = p_product) THEN
        RAISE EXCEPTION 'Onbekend product';
    END IF;
    IF (SELECT count(DISTINCT x) FROM unnest(coalesce(p_stappen, '{}')) x) <> cardinality(coalesce(p_stappen, '{}')) THEN
        RAISE EXCEPTION 'Een stap staat twee keer in de route';
    END IF;
    SELECT string_agg(x, ', ') INTO v_onbekend FROM unnest(coalesce(p_stappen, '{}')) x
     WHERE NOT EXISTS (SELECT 1 FROM processtap WHERE code = x AND actief);
    IF v_onbekend IS NOT NULL THEN
        RAISE EXCEPTION 'Onbekende of uitgezette stap: %', v_onbekend;
    END IF;
    DELETE FROM product_stap WHERE product_id = p_product;
    INSERT INTO product_stap (product_id, processtap_id, plek)
    SELECT p_product, s.id, x.n FROM unnest(coalesce(p_stappen, '{}')) WITH ORDINALITY x(code, n) JOIN processtap s ON s.code = x.code;
END $$;


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

    -- Herbewerking: alleen voor lots, en alleen een stap die al eens doorlopen is.
    IF NEW.herbewerking_start THEN
        IF NEW.lot_id IS NULL THEN
            RAISE EXCEPTION 'Herbewerking geldt alleen voor lots';
        END IF;
        IF v_max_poging IS NULL THEN
            RAISE EXCEPTION 'Stap % is voor dit lot nog niet doorlopen; geen herbewerking mogelijk', v_stap.code;
        END IF;
        IF EXISTS (SELECT 1 FROM stapregistratie WHERE lot_id = NEW.lot_id AND status = 'open') THEN
            RAISE EXCEPTION 'Lot heeft nog een open stap; rond die eerst af';
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

CREATE OR REPLACE FUNCTION werk_lotstatus_bij() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_laatste uuid;
BEGIN
    IF NEW.lot_id IS NULL THEN RETURN NEW; END IF;
    IF TG_OP = 'INSERT' AND NEW.herbewerking_start THEN
        UPDATE lot SET status = 'in_productie' WHERE id = NEW.lot_id AND status = 'gereed';
    ELSIF TG_OP = 'UPDATE' AND NEW.status = 'afgerond' AND OLD.status = 'open' THEN
        v_laatste := route_laatste(lot_product(NEW.lot_id), 'lot');
        IF NEW.processtap_id = v_laatste THEN
            UPDATE lot SET status = 'gereed' WHERE id = NEW.lot_id;
        END IF;
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
        RETURN QUERY
        SELECT 'batch', b.batchnummer,
               coalesce((SELECT max(r.afgerond_op) FROM stapregistratie r
                          WHERE r.batch_id = b.id AND r.processtap_id = v.vorige),
                        CASE WHEN b.status = 'gepland' THEN greatest(b.aangemaakt_op, b.geplande_dag::timestamptz) ELSE b.aangemaakt_op END)
          FROM batch b
          CROSS JOIN LATERAL (SELECT route_vorige(b.product_id, v_stap.id) AS vorige) v
         WHERE b.status IN ('in_productie', 'gepland')
           AND (b.status = 'in_productie' OR (v.vorige IS NULL AND b.geplande_dag <= current_date))
           AND in_route(b.product_id, v_stap.id)
           AND NOT EXISTS (SELECT 1 FROM stapregistratie r WHERE r.batch_id = b.id AND r.processtap_id = v_stap.id)
           AND (v.vorige IS NULL OR EXISTS (SELECT 1 FROM stapregistratie r
                 WHERE r.batch_id = b.id AND r.processtap_id = v.vorige AND r.status = 'afgerond'))
         ORDER BY 3;
    ELSE
        -- Lotstap na de lot-stap: vorige stap (laatste poging) afgerond en
        -- deze stap sindsdien nog niet gestart.
        RETURN QUERY
        SELECT 'lot', l.lotnummer, vr.afgerond_op
          FROM lot l
          CROSS JOIN LATERAL (SELECT route_vorige(lot_product(l.id), v_stap.id) AS vorige) v
          JOIN LATERAL (SELECT r.* FROM stapregistratie r WHERE r.lot_id = l.id AND r.processtap_id = v.vorige
                         ORDER BY r.poging DESC LIMIT 1) vr ON vr.status = 'afgerond'
          LEFT JOIN LATERAL (SELECT r.* FROM stapregistratie r WHERE r.lot_id = l.id AND r.processtap_id = v_stap.id
                              ORDER BY r.poging DESC LIMIT 1) dr ON true
         WHERE l.status = 'in_productie'
           AND (dr.id IS NULL OR dr.gestart_op < vr.afgerond_op)
         ORDER BY 3;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION start_geplande_batch() RETURNS trigger LANGUAGE plpgsql AS $$
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

CREATE OR REPLACE FUNCTION bewaak_batchplanning() RETURNS trigger LANGUAGE plpgsql AS $$
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

CREATE OR REPLACE FUNCTION controleer_lot_voorstel(p_voorstel uuid) RETURNS void LANGUAGE plpgsql AS $$
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
    IF (SELECT count(DISTINCT b.product_id) + max(CASE WHEN b.product_id IS NULL THEN 1 ELSE 0 END)
          FROM lot_voorstel_batch x JOIN batch b ON b.id = x.batch_id WHERE x.voorstel_id = p_voorstel) > 1 THEN
        RAISE EXCEPTION 'Een lotvoorstel bestaat uit batches van hetzelfde product';
    END IF;
    IF EXISTS (SELECT 1 FROM lot_voorstel_batch x JOIN batch b ON b.id = x.batch_id
                WHERE x.voorstel_id = p_voorstel AND b.status NOT IN ('gepland','in_productie','in_beoordeling')) THEN
        RAISE EXCEPTION 'Een lotvoorstel kan alleen batches bevatten die nog niet in een lot zitten, niet afgekeurd en niet vervallen';
    END IF;
END $$;

CREATE OR REPLACE FUNCTION planning_vorige_stap(p_stap_id uuid, p_batch_id uuid, p_lot_id uuid, p_dag date)
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

-- Elke functie werkt in schema fabriek (zoals in 0001): ook de nieuwe en vervangen functies.
DO $$
DECLARE f record;
BEGIN
    FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'fabriek' LOOP
        EXECUTE format('ALTER FUNCTION %s SET search_path = fabriek, public', f.sig);
    END LOOP;
END $$;
