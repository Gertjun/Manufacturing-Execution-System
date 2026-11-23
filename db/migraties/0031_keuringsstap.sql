-- Migratie 0031 (versie 0.51.0): keuringsstappen en specificaties per product (#80, D73).
-- Een stap kan een keuringsstap zijn (tussenkeuring TK, eindkeuring EK): alleen Kwaliteit start hem, meet en
-- beslist; bij het starten is hij meteen afgerond en staat de keuring open (D58). Keuringsstappen horen bij de
-- route van een product, niet bij de standaardroute. Per product en keuringsstap een specificatie met versies:
-- concept, vastgesteld, vervallen. Metingen in een keuringsstap worden getoetst aan de geldige versie, die bij
-- de meting wordt bewaard. Processtappen en Kwaliteit-velden in een processtap blijven zoals ze zijn.
-- Oudere invoerschermen: alleen de lab-pc moet bijgewerkt zijn voordat er keuringsstappen in een route staan.
SET search_path = fabriek, public;

ALTER TABLE processtap ADD COLUMN soort text NOT NULL DEFAULT 'proces' CHECK (soort IN ('proces','keuring'));
ALTER TABLE processtap ADD CONSTRAINT processtap_keuring_geen_lotstap CHECK (NOT (soort = 'keuring' AND is_lot_stap));

-- Specificatie per product en keuringsstap (sinds 0.51.0, #80, D73): waar het product in een tussenkeuring (TK) of
-- de eindkeuring (EK) aan moet voldoen, met een versie. Een nieuwe versie begint als concept en geldt pas na
-- vaststellen; de vorige vervalt dan. Per product en stap hoogstens één concept en één geldige versie.
CREATE TABLE specificatie (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id        uuid NOT NULL REFERENCES product(id),
    processtap_id     uuid NOT NULL REFERENCES processtap(id),
    versie            int  NOT NULL CHECK (versie > 0),
    status            text NOT NULL DEFAULT 'concept' CHECK (status IN ('concept','vastgesteld','vervallen')),
    opmerking         text CHECK (opmerking IS NULL OR length(opmerking) <= 500),
    aangemaakt_door   uuid REFERENCES gebruiker(id),
    aangemaakt_op     timestamptz NOT NULL DEFAULT now(),
    vastgesteld_door  uuid REFERENCES gebruiker(id),
    vastgesteld_op    timestamptz,
    UNIQUE (product_id, processtap_id, versie),
    CHECK ((status = 'concept') = (vastgesteld_op IS NULL))
);
CREATE UNIQUE INDEX specificatie_een_geldig ON specificatie (product_id, processtap_id) WHERE status = 'vastgesteld';
CREATE UNIQUE INDEX specificatie_een_concept ON specificatie (product_id, processtap_id) WHERE status = 'concept';
CREATE TRIGGER specificatie_log BEFORE INSERT OR UPDATE OR DELETE ON specificatie
    FOR EACH ROW EXECUTE FUNCTION log_config();

-- Per veld van de keuringsstap het minimum en/of maximum.
CREATE TABLE specificatie_regel (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    specificatie_id  uuid NOT NULL REFERENCES specificatie(id) ON DELETE CASCADE,
    veld_id          uuid NOT NULL REFERENCES veld(id),
    grens_min        numeric,
    grens_max        numeric,
    UNIQUE (specificatie_id, veld_id),
    CHECK (grens_min IS NOT NULL OR grens_max IS NOT NULL),
    CHECK (grens_min IS NULL OR grens_max IS NULL OR grens_min <= grens_max)
);
CREATE TRIGGER specificatie_regel_log BEFORE INSERT OR UPDATE OR DELETE ON specificatie_regel
    FOR EACH ROW EXECUTE FUNCTION log_config();

-- Alleen voor een keuringsstap; product, stap en versie liggen vast; alleen concept → vastgesteld → vervallen;
-- alleen een concept mag weg.
CREATE FUNCTION bewaak_specificatie() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NOT EXISTS (SELECT 1 FROM processtap WHERE id = NEW.processtap_id AND soort = 'keuring') THEN
            RAISE EXCEPTION 'Een specificatie hoort bij een keuringsstap';
        END IF;
        IF NEW.status <> 'concept' AND NEW.vastgesteld_op IS NULL THEN
            RAISE EXCEPTION 'Een nieuwe specificatie begint als concept';
        END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN
        IF OLD.status <> 'concept' THEN
            RAISE EXCEPTION 'Alleen een concept kan weg; een vastgestelde specificatie blijft bewaard';
        END IF;
        RETURN OLD;
    END IF;
    IF (NEW.product_id, NEW.processtap_id, NEW.versie) IS DISTINCT FROM (OLD.product_id, OLD.processtap_id, OLD.versie) THEN
        RAISE EXCEPTION 'Product, stap en versie van een specificatie liggen vast';
    END IF;
    IF NEW.status <> OLD.status AND NOT ((OLD.status = 'concept' AND NEW.status = 'vastgesteld')
                                         OR (OLD.status = 'vastgesteld' AND NEW.status = 'vervallen')) THEN
        RAISE EXCEPTION 'Een specificatie gaat van concept naar vastgesteld naar vervallen';
    END IF;
    IF OLD.status <> 'concept' AND (NEW.opmerking IS DISTINCT FROM OLD.opmerking OR NEW.vastgesteld_op IS DISTINCT FROM OLD.vastgesteld_op
                                    OR NEW.vastgesteld_door IS DISTINCT FROM OLD.vastgesteld_door) THEN
        RAISE EXCEPTION 'Een vastgestelde specificatie verandert niet; maak een nieuwe versie';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER specificatie_bewaak BEFORE INSERT OR UPDATE OR DELETE ON specificatie
    FOR EACH ROW EXECUTE FUNCTION bewaak_specificatie();

-- Regels alleen in een concept, en alleen voor velden van die keuringsstap.
CREATE FUNCTION bewaak_specificatie_regel() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_spec specificatie%ROWTYPE;
BEGIN
    SELECT * INTO v_spec FROM specificatie WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.specificatie_id ELSE NEW.specificatie_id END;
    IF NOT FOUND THEN  -- het concept zelf gaat weg (ON DELETE CASCADE)
        RETURN OLD;
    END IF;
    IF v_spec.status <> 'concept' THEN
        RAISE EXCEPTION 'Een vastgestelde specificatie verandert niet; maak een nieuwe versie';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    IF NOT EXISTS (SELECT 1 FROM veld WHERE id = NEW.veld_id AND processtap_id = v_spec.processtap_id) THEN
        RAISE EXCEPTION 'Dit veld hoort niet bij de keuringsstap van de specificatie';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER specificatie_regel_bewaak BEFORE INSERT OR UPDATE OR DELETE ON specificatie_regel
    FOR EACH ROW EXECUTE FUNCTION bewaak_specificatie_regel();

-- Nieuwe versie als concept, met de regels van de geldige versie. Bestaat er al een concept, dan dat.
CREATE FUNCTION nieuwe_specificatie(p_product uuid, p_stap uuid, p_door uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
    v_id uuid;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM gebruiker WHERE id = p_door AND actief AND rol IN ('kwaliteit', 'beheerder')) THEN
        RAISE EXCEPTION 'Alleen Kwaliteit of de beheerder beheert specificaties';
    END IF;
    IF NOT in_route(p_product, p_stap) THEN
        RAISE EXCEPTION 'Deze keuringsstap hoort niet bij de route van het product';
    END IF;
    SELECT id INTO v_id FROM specificatie WHERE product_id = p_product AND processtap_id = p_stap AND status = 'concept';
    IF FOUND THEN RETURN v_id; END IF;
    INSERT INTO specificatie (product_id, processtap_id, versie, aangemaakt_door)
    VALUES (p_product, p_stap,
            coalesce((SELECT max(versie) FROM specificatie WHERE product_id = p_product AND processtap_id = p_stap), 0) + 1, p_door)
    RETURNING id INTO v_id;
    INSERT INTO specificatie_regel (specificatie_id, veld_id, grens_min, grens_max)
    SELECT v_id, r.veld_id, r.grens_min, r.grens_max
      FROM specificatie_regel r JOIN specificatie x ON x.id = r.specificatie_id JOIN veld v ON v.id = r.veld_id
     WHERE x.product_id = p_product AND x.processtap_id = p_stap AND x.status = 'vastgesteld' AND v.actief;
    RETURN v_id;
END $$;

-- Een concept vaststellen: geldt vanaf nu, de vorige versie vervalt.
CREATE FUNCTION stel_specificatie_vast(p_spec uuid, p_door uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_spec specificatie%ROWTYPE;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM gebruiker WHERE id = p_door AND actief AND rol IN ('kwaliteit', 'beheerder')) THEN
        RAISE EXCEPTION 'Alleen Kwaliteit of de beheerder beheert specificaties';
    END IF;
    SELECT * INTO v_spec FROM specificatie WHERE id = p_spec FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende specificatie'; END IF;
    IF v_spec.status <> 'concept' THEN RAISE EXCEPTION 'Alleen een concept kan worden vastgesteld'; END IF;
    IF NOT EXISTS (SELECT 1 FROM specificatie_regel WHERE specificatie_id = p_spec) THEN
        RAISE EXCEPTION 'Een specificatie heeft minstens één eigenschap met een minimum of maximum';
    END IF;
    UPDATE specificatie SET status = 'vervallen'
     WHERE product_id = v_spec.product_id AND processtap_id = v_spec.processtap_id AND status = 'vastgesteld';
    UPDATE specificatie SET status = 'vastgesteld', vastgesteld_door = p_door, vastgesteld_op = clock_timestamp() WHERE id = p_spec;
END $$;

-- De grenzen die voor een veld gelden bij een product (NULL = geen product: de grenzen van het veld).
-- Staat het veld in de geldige specificatie van het product (sinds 0.51.0, #80), dan gelden die grenzen, zonder tolerantie.
CREATE OR REPLACE FUNCTION grenzen_van(p_veld uuid, p_product uuid)
RETURNS TABLE (grens_min numeric, grens_max numeric, tolerantie numeric, tolerantie_soort text) LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN sp.veld_id IS NOT NULL THEN sp.grens_min WHEN vp.veld_id IS NULL THEN v.grens_min ELSE vp.grens_min END,
           CASE WHEN sp.veld_id IS NOT NULL THEN sp.grens_max WHEN vp.veld_id IS NULL THEN v.grens_max ELSE vp.grens_max END,
           CASE WHEN sp.veld_id IS NOT NULL THEN NULL WHEN vp.veld_id IS NULL THEN v.tolerantie ELSE vp.tolerantie END,
           CASE WHEN sp.veld_id IS NOT NULL THEN 'absoluut' WHEN vp.veld_id IS NULL THEN v.tolerantie_soort ELSE vp.tolerantie_soort END
      FROM veld v LEFT JOIN veld_product vp ON vp.veld_id = v.id AND vp.product_id = p_product
      LEFT JOIN LATERAL (SELECT r.veld_id, r.grens_min, r.grens_max FROM specificatie_regel r JOIN specificatie x ON x.id = r.specificatie_id
                          WHERE r.veld_id = v.id AND x.product_id = p_product AND x.status = 'vastgesteld') sp ON true
     WHERE v.id = p_veld
$$;

-- In een keuringsstap meet alleen Kwaliteit (#80).
CREATE FUNCTION controleer_keuringsveld() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.gemeten_door <> 'kwaliteit' AND EXISTS (SELECT 1 FROM processtap WHERE id = NEW.processtap_id AND soort = 'keuring') THEN
        RAISE EXCEPTION 'Veld % hoort bij een keuringsstap; dat meet Kwaliteit', NEW.code;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER veld_keuring BEFORE INSERT OR UPDATE ON veld
    FOR EACH ROW EXECUTE FUNCTION controleer_keuringsveld();
CREATE FUNCTION controleer_stapsoort() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.soort = 'keuring' AND EXISTS (SELECT 1 FROM veld WHERE processtap_id = NEW.id AND gemeten_door <> 'kwaliteit') THEN
        RAISE EXCEPTION 'Stap % heeft velden van Productie; een keuringsstap meet alleen Kwaliteit', NEW.code;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER processtap_soort BEFORE INSERT OR UPDATE ON processtap
    FOR EACH ROW EXECUTE FUNCTION controleer_stapsoort();


ALTER TABLE waarde ADD COLUMN specificatie_id uuid REFERENCES specificatie(id);
-- De view neemt de nieuwe kolom mee (w.* wordt bij het maken vastgelegd).
CREATE OR REPLACE VIEW waarde_actueel AS
SELECT w.* FROM waarde w
WHERE NOT EXISTS (SELECT 1 FROM waarde c WHERE c.vervangt_waarde_id = w.id);

CREATE OR REPLACE FUNCTION log_config() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_oud   jsonb;
    v_nieuw jsonb;
BEGIN
    IF TG_OP = 'DELETE' AND TG_TABLE_NAME NOT IN ('pc_stap', 'product_stap', 'veld_product', 'capaciteit_stap', 'specificatie', 'specificatie_regel') THEN
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

CREATE OR REPLACE FUNCTION route(p_product uuid) RETURNS TABLE (processtap_id uuid, plek int) LANGUAGE sql STABLE AS $$
    SELECT s.id, (row_number() OVER (ORDER BY coalesce(ps.plek, s.volgorde), s.volgorde))::int
      FROM processtap s
      LEFT JOIN product_stap ps ON ps.processtap_id = s.id AND ps.product_id = p_product
     WHERE s.actief
       AND (ps.product_id IS NOT NULL
            -- De standaardroute (product zonder eigen route) heeft geen keuringsstappen (#80): die horen bij een product.
            OR (NOT EXISTS (SELECT 1 FROM product_stap x WHERE x.product_id = p_product) AND s.soort = 'proces'))
$$;

CREATE OR REPLACE FUNCTION stap_meet_kwaliteit(p_stap uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM veld WHERE processtap_id = p_stap AND actief AND gemeten_door = 'kwaliteit')
        OR EXISTS (SELECT 1 FROM processtap WHERE id = p_stap AND soort = 'keuring')
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
    -- Een keuringsstap (sinds 0.51.0, #80) start alleen iemand van Kwaliteit.
    IF v_stap.soort = 'keuring' AND NOT EXISTS (SELECT 1 FROM operator o JOIN gebruiker g ON g.id = o.gebruiker_id
                                                 WHERE o.id = NEW.operator_id AND g.rol = 'kwaliteit') THEN
        RAISE EXCEPTION 'Stap % is een keuring; die doet Kwaliteit', v_stap.code;
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

    -- Wacht de batch of het lot op Kwaliteit, dan kan er niets starten (sinds 0022, #64).
    IF EXISTS (SELECT 1 FROM keuring k JOIN stapregistratie x ON x.id = k.stapregistratie_id
                WHERE k.status = 'open' AND (x.batch_id = NEW.batch_id OR x.lot_id = NEW.lot_id)) THEN
        RAISE EXCEPTION 'Wacht op Kwaliteit: eerst de keuring van stap %',
            (SELECT s.code FROM keuring k JOIN stapregistratie x ON x.id = k.stapregistratie_id JOIN processtap s ON s.id = x.processtap_id
              WHERE k.status = 'open' AND (x.batch_id = NEW.batch_id OR x.lot_id = NEW.lot_id) LIMIT 1);
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
        -- Met wie startte, waar en wanneer (sinds 0023, #55): meestal startte een andere pc hem, of een pc die
        -- offline was en zijn wachtrij later stuurde. Wie hem afmaakt, opent hem bij Bezig.
        RAISE EXCEPTION 'Stap % staat nog open: gestart door %. Open hem bij Bezig om hem af te maken.', v_stap.code,
            (SELECT format('%s op %s om %s', o.naam, p.naam, to_char(r.gestart_op, 'DD-MM-YYYY HH24:MI'))
               FROM stapregistratie r JOIN operator o ON o.id = r.operator_id JOIN pc p ON p.id = r.pc_id
              WHERE r.processtap_id = NEW.processtap_id AND (r.batch_id = NEW.batch_id OR r.lot_id = NEW.lot_id)
                AND r.status = 'open'
              LIMIT 1);
    END IF;

    -- Volgorde: de vorige stap van hetzelfde niveau in de route moet afgerond
    -- zijn, en nieuwer zijn dan de laatste registratie van deze stap
    -- (zo moet een lot na herbewerking alle volgende stappen opnieuw doen).
    v_vorige_id := route_vorige(v_product, v_stap.id);

    -- Batch (sinds 0021): de vorige stap gedaan en deze nog niet, met herbewerkingen meegerekend.
    IF NEW.batch_id IS NOT NULL THEN
        IF v_vorige_id IS NOT NULL AND NOT batch_stap_gedaan(NEW.batch_id, v_vorige_id) THEN
            IF EXISTS (SELECT 1 FROM keuring k JOIN stapregistratie x ON x.id = k.stapregistratie_id
                        WHERE x.batch_id = NEW.batch_id AND x.processtap_id = v_vorige_id AND k.status = 'open') THEN
                RAISE EXCEPTION 'Stap % wacht op Kwaliteit', (SELECT code FROM processtap WHERE id = v_vorige_id);
            END IF;
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
        -- Meet Kwaliteit in de vorige stap, dan eerst de vrijgave (sinds 0022).
        IF EXISTS (SELECT 1 FROM keuring k WHERE k.stapregistratie_id = v_vorige_reg.id AND k.status <> 'vrijgegeven') THEN
            RAISE EXCEPTION 'Stap % wacht op Kwaliteit', v_vorige.code;
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

CREATE OR REPLACE FUNCTION start_stap(p_stapcode text, p_batch uuid, p_lot uuid, p_pc uuid, p_operator uuid,
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

CREATE OR REPLACE FUNCTION lever_stap_na(p_stapcode text, p_nummer text, p_batches text[], p_pc uuid, p_operator uuid,
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

CREATE OR REPLACE FUNCTION verwerk_waarde() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_veld  veld%ROWTYPE;
    v_reg   stapregistratie%ROWTYPE;
    v_oud   waarde%ROWTYPE;
    v_rol   text;
    v_grens record;
BEGIN
    SELECT * INTO v_veld FROM veld WHERE id = NEW.veld_id;
    SELECT * INTO v_reg  FROM stapregistratie WHERE id = NEW.stapregistratie_id;

    IF v_veld.processtap_id <> v_reg.processtap_id THEN
        RAISE EXCEPTION 'Veld % hoort niet bij deze stap', v_veld.code;
    END IF;
    IF v_veld.soort = 'procesparameter' AND NEW.setting IS NULL THEN
        RAISE EXCEPTION 'Veld % is een procesparameter: setting is verplicht', v_veld.code;
    END IF;
    IF v_veld.soort <> 'procesparameter' AND NEW.setting IS NOT NULL THEN
        RAISE EXCEPTION 'Veld % heeft geen setting', v_veld.code;
    END IF;

    IF NEW.vervangt_waarde_id IS NULL THEN
        -- Een veld dat Kwaliteit meet (sinds 0022, #64): alleen door iemand van Kwaliteit, in een open stap
        -- of zolang de stap op Kwaliteit wacht.
        IF v_veld.gemeten_door = 'kwaliteit' THEN
            IF NOT EXISTS (SELECT 1 FROM operator o JOIN gebruiker g ON g.id = o.gebruiker_id
                            WHERE o.id = NEW.ingevoerd_door AND g.rol = 'kwaliteit') THEN
                RAISE EXCEPTION 'Veld % meet Kwaliteit', v_veld.code;
            END IF;
            IF v_reg.status <> 'open' AND NOT EXISTS (SELECT 1 FROM keuring k WHERE k.stapregistratie_id = v_reg.id AND k.status = 'open') THEN
                RAISE EXCEPTION 'Stap wacht niet meer op Kwaliteit; wijzigen kan alleen als correctie';
            END IF;
        -- Gewone invoer: alleen in een open stap, met actief veld.
        ELSIF v_reg.status <> 'open' THEN
            RAISE EXCEPTION 'Stap is al afgerond; wijzigen kan alleen als correctie door een ploegleider';
        END IF;
        IF NOT v_veld.actief THEN
            RAISE EXCEPTION 'Veld % is inactief', v_veld.code;
        END IF;
        -- Grenzen kopiëren zoals ze nu gelden, voor het product van de batch of het lot (sinds 0019).
        SELECT * INTO v_grens FROM grenzen_van(NEW.veld_id, v_reg.product_id);
        NEW.grens_min := v_grens.grens_min;  NEW.grens_max := v_grens.grens_max;
        NEW.tolerantie := v_grens.tolerantie; NEW.tolerantie_soort := v_grens.tolerantie_soort;
        NEW.specificatie_id := (SELECT x.id FROM specificatie x JOIN specificatie_regel r ON r.specificatie_id = x.id
                                 WHERE r.veld_id = NEW.veld_id AND x.product_id = v_reg.product_id AND x.status = 'vastgesteld');
    ELSE
        -- Correctie: ploegleider of hoger, zelfde registratie en veld,
        -- alleen de nieuwste waarde kan vervangen worden.
        SELECT rol INTO v_rol FROM gebruiker WHERE id = NEW.gecorrigeerd_door AND actief;
        IF v_rol IS NULL OR v_rol NOT IN ('ploegleider','beheerder') THEN
            RAISE EXCEPTION 'Alleen een ploegleider of hogere functie mag corrigeren';
        END IF;
        SELECT * INTO v_oud FROM waarde WHERE id = NEW.vervangt_waarde_id;
        IF v_oud.stapregistratie_id <> NEW.stapregistratie_id OR v_oud.veld_id <> NEW.veld_id THEN
            RAISE EXCEPTION 'Een correctie hoort bij dezelfde registratie en hetzelfde veld';
        END IF;
        -- Grenzen van de oorspronkelijke meting blijven gelden.
        NEW.grens_min := v_oud.grens_min;  NEW.grens_max := v_oud.grens_max;
        NEW.tolerantie := v_oud.tolerantie; NEW.tolerantie_soort := v_oud.tolerantie_soort;
        NEW.specificatie_id := v_oud.specificatie_id;
    END IF;

    NEW.markering := bereken_markering(NEW.setting, NEW.gemeten, NEW.grens_min, NEW.grens_max,
                                       NEW.tolerantie, NEW.tolerantie_soort);
    RETURN NEW;
END $$;

DO $$
DECLARE f record;
BEGIN
    FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'fabriek' LOOP
        EXECUTE format('ALTER FUNCTION %s SET search_path = fabriek, public', f.sig);
    END LOOP;
END $$;
