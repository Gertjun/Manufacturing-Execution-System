-- Migratie 0036 (versie 0.63.0): routeversies en historische herleidbaarheid (D85).
-- Dit is een veilige eerste fase: bestaande batch- en lotroutes worden NIET gegokt of automatisch gekoppeld.
SET search_path = fabriek, public;

CREATE TABLE product_route_versie (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id uuid NOT NULL REFERENCES product(id),
    versie int NOT NULL CHECK (versie > 0),
    status text NOT NULL DEFAULT 'concept' CHECK (status IN ('concept','vastgesteld','vervallen')),
    bron text NOT NULL CHECK (bron IN ('migratie','seed','beheer')),
    toelichting text,
    aangemaakt_op timestamptz NOT NULL DEFAULT now(),
    vastgesteld_op timestamptz,
    vastgesteld_door uuid REFERENCES gebruiker(id),
    UNIQUE (product_id, versie),
    CHECK ((status = 'concept' AND vastgesteld_op IS NULL) OR
           (status IN ('vastgesteld','vervallen') AND vastgesteld_op IS NOT NULL))
);

CREATE TABLE product_route_versie_stap (
    route_versie_id uuid NOT NULL REFERENCES product_route_versie(id),
    processtap_id uuid NOT NULL REFERENCES processtap(id),
    plek int NOT NULL CHECK (plek > 0),
    stap_code text NOT NULL,
    stap_naam text NOT NULL,
    niveau text NOT NULL CHECK (niveau IN ('batch','lot')),
    is_lot_stap boolean NOT NULL,
    PRIMARY KEY (route_versie_id, processtap_id),
    UNIQUE (route_versie_id, plek)
);

CREATE FUNCTION bescherm_product_route_versie() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status <> 'concept' THEN RAISE EXCEPTION 'Een vastgestelde routeversie kan niet worden verwijderd'; END IF;
        RETURN OLD;
    END IF;
    IF OLD.status = 'vastgesteld' THEN
        IF NEW.status = 'vervallen' AND (to_jsonb(NEW) - 'status') = (to_jsonb(OLD) - 'status') THEN RETURN NEW; END IF;
        RAISE EXCEPTION 'Een vastgestelde routeversie is onveranderlijk';
    END IF;
    IF OLD.status = 'vervallen' THEN RAISE EXCEPTION 'Een vervallen routeversie kan niet worden gewijzigd'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER product_route_versie_vast BEFORE UPDATE OR DELETE ON product_route_versie
    FOR EACH ROW EXECUTE FUNCTION bescherm_product_route_versie();

CREATE FUNCTION bescherm_product_route_versie_stap() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
    v_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.route_versie_id ELSE NEW.route_versie_id END;
    IF EXISTS (SELECT 1 FROM product_route_versie WHERE id = v_id AND status <> 'concept') THEN
        RAISE EXCEPTION 'Stappen van een vastgestelde routeversie zijn onveranderlijk';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.route_versie_id IS DISTINCT FROM NEW.route_versie_id
       AND EXISTS (SELECT 1 FROM product_route_versie WHERE id = OLD.route_versie_id AND status <> 'concept') THEN
        RAISE EXCEPTION 'Stappen van een vastgestelde routeversie zijn onveranderlijk';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER product_route_versie_stap_vast BEFORE INSERT OR UPDATE OR DELETE ON product_route_versie_stap
    FOR EACH ROW EXECUTE FUNCTION bescherm_product_route_versie_stap();

CREATE FUNCTION leg_routeversie_vast(p_product uuid, p_bron text DEFAULT 'beheer',
                                      p_toelichting text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_versie int; v_id uuid; v_batchstappen int; v_lotstappen int;
BEGIN
    PERFORM 1 FROM product WHERE id = p_product FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Onbekend product'; END IF;
    IF p_bron NOT IN ('migratie','seed','beheer') THEN RAISE EXCEPTION 'Onbekende bron voor routeversie'; END IF;
    PERFORM controleer_route(p_product);
    SELECT count(*) FILTER (WHERE s.niveau = 'batch'),
           count(*) FILTER (WHERE s.niveau = 'lot' AND s.is_lot_stap)
      INTO v_batchstappen, v_lotstappen
      FROM route(p_product) r JOIN processtap s ON s.id = r.processtap_id;
    IF v_batchstappen < 1 OR v_lotstappen <> 1 THEN
        RAISE EXCEPTION 'De route van product % moet batchstappen en precies één lotstap bevatten',
                        (SELECT code FROM product WHERE id = p_product);
    END IF;
    SELECT coalesce(max(versie), 0) + 1 INTO v_versie FROM product_route_versie WHERE product_id = p_product;
    INSERT INTO product_route_versie (product_id, versie, status, bron, toelichting)
    VALUES (p_product, v_versie, 'concept', p_bron, p_toelichting) RETURNING id INTO v_id;
    INSERT INTO product_route_versie_stap (route_versie_id, processtap_id, plek, stap_code, stap_naam, niveau, is_lot_stap)
    SELECT v_id, s.id, r.plek, s.code, s.naam, s.niveau, s.is_lot_stap
      FROM route(p_product) r JOIN processtap s ON s.id = r.processtap_id ORDER BY r.plek;
    UPDATE product_route_versie SET status = 'vastgesteld', vastgesteld_op = clock_timestamp() WHERE id = v_id;
    RETURN v_id;
END $$;

ALTER FUNCTION bescherm_product_route_versie() SET search_path = fabriek, public;
ALTER FUNCTION bescherm_product_route_versie_stap() SET search_path = fabriek, public;
ALTER FUNCTION leg_routeversie_vast(uuid, text, text) SET search_path = fabriek, public;

ALTER TABLE batch
    ADD COLUMN route_versie_id uuid REFERENCES product_route_versie(id),
    ADD COLUMN route_historie_status text NOT NULL DEFAULT 'historisch_onbekend'
        CHECK (route_historie_status IN ('historisch_onbekend','vastgelegd','gereconstrueerd','handmatig_beoordeeld')),
    ADD CONSTRAINT batch_route_historie_consistent
        CHECK ((route_versie_id IS NULL) = (route_historie_status = 'historisch_onbekend'));

ALTER TABLE lot
    ADD COLUMN route_versie_id uuid REFERENCES product_route_versie(id),
    ADD COLUMN route_historie_status text NOT NULL DEFAULT 'historisch_onbekend'
        CHECK (route_historie_status IN ('historisch_onbekend','vastgelegd','gereconstrueerd','handmatig_beoordeeld')),
    ADD CONSTRAINT lot_route_historie_consistent
        CHECK ((route_versie_id IS NULL) = (route_historie_status = 'historisch_onbekend'));

DO $$
DECLARE r record;
BEGIN
    FOR r IN SELECT id FROM product ORDER BY code LOOP
        PERFORM leg_routeversie_vast(r.id, 'migratie',
            'Momentopname bij migratie 0036; bewijst niet welke routeversie historische batches of lots hebben doorlopen.');
    END LOOP;
END $$;

CREATE VIEW route_historie_rapport AS
SELECT 'batch'::text AS object_type, b.id AS object_id, b.batchnummer AS object_nummer,
       b.product_id, b.gestart_op AS moment, b.route_versie_id,
       (SELECT v.id FROM product_route_versie v WHERE v.product_id = b.product_id ORDER BY v.versie DESC LIMIT 1) AS kandidaat_route_versie_id,
       b.route_historie_status AS status,
       CASE WHEN b.product_id IS NULL THEN 'Batch heeft geen product; route kan niet worden bepaald.'
            ELSE 'Historische route niet automatisch gekoppeld; beoordeel de configuratiehistorie.' END AS reden
  FROM batch b WHERE b.route_historie_status = 'historisch_onbekend'
UNION ALL
SELECT 'lot'::text, l.id, l.lotnummer,
       (SELECT b.product_id FROM batch b WHERE b.lot_id = l.id ORDER BY b.product_id LIMIT 1),
       l.aangemaakt_op, l.route_versie_id,
       (SELECT v.id FROM product_route_versie v WHERE v.product_id = (SELECT b.product_id FROM batch b WHERE b.lot_id = l.id ORDER BY b.product_id LIMIT 1)
         ORDER BY v.versie DESC LIMIT 1),
       l.route_historie_status, 'Historische lotroute niet automatisch gekoppeld; beoordeel de configuratiehistorie.'
  FROM lot l WHERE l.route_historie_status = 'historisch_onbekend';
