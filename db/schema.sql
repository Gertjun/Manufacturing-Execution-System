-- =====================================================================
-- Batch input GUI — volledig schema (PostgreSQL 16 of nieuwer)
-- Dit is altijd het schema na de laatste migratie in db/migraties/. Wijzig je het schema,
-- voeg dan ook een migratie toe; de test controleert dat beide hetzelfde opleveren.
-- Alle namen en waarden zijn fictief.
-- Uitgangspunt: niets wordt overschreven of verwijderd; correcties,
-- herbewerkingen en besluiten zijn nieuwe regels.
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;  -- wachtwoord-hashes

DROP SCHEMA IF EXISTS fabriek CASCADE;
CREATE SCHEMA fabriek;
SET search_path = fabriek;

-- ---------------------------------------------------------------------
-- Gebruikers, operators, pc's
-- ---------------------------------------------------------------------

-- Persoonlijke accounts (ploegleider, beheerder, analist, planner) en
-- het ene gedeelde operator-account.
CREATE TABLE gebruiker (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    gebruikersnaam  text NOT NULL UNIQUE,
    rol             text NOT NULL CHECK (rol IN ('operator','ploegleider','kwaliteit','beheerder','analist','planner','scherm','productiemanager')),
    wachtwoord_hash text,                      -- bcrypt via pgcrypto
    actief          boolean NOT NULL DEFAULT true,
    gedeeld         boolean NOT NULL DEFAULT false,  -- het oude gedeelde operatoraccount: kiest een naam (D6, vervalt met D53)
    -- Het wachtwoord is tijdelijk (gekozen door de beheerder): bij de volgende inlog eerst een eigen
    -- wachtwoord kiezen (sinds migratie 0025, #76, D61).
    wachtwoord_wijzigen boolean NOT NULL DEFAULT false
);

-- Controleert een login; geeft id en rol terug, of niets.
CREATE FUNCTION controleer_login(p_naam text, p_wachtwoord text)
RETURNS TABLE (id uuid, rol text) LANGUAGE sql STABLE AS $$
    SELECT g.id, g.rol FROM fabriek.gebruiker g
     WHERE g.gebruikersnaam = p_naam AND g.actief
       AND g.wachtwoord_hash = public.crypt(p_wachtwoord, g.wachtwoord_hash)
$$;

-- Namenlijst waaruit operators na het inloggen kiezen.
CREATE TABLE operator (
    id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    naam    text NOT NULL UNIQUE,
    actief  boolean NOT NULL DEFAULT true,
    gebruiker_id uuid UNIQUE REFERENCES gebruiker(id)  -- eigen account van deze persoon (D53); leeg = alleen een naam
);

CREATE TABLE pc (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    naam      text NOT NULL UNIQUE,          -- bv. PC-07
    locatie   text,
    actief    boolean NOT NULL DEFAULT true
);

-- ---------------------------------------------------------------------
-- Configuratie: processtappen en velden
-- ---------------------------------------------------------------------

CREATE TABLE processtap (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code         text NOT NULL UNIQUE,         -- PS1 .. PS18
    naam         text NOT NULL,                -- Process Step 1 ..
    volgorde     int  NOT NULL UNIQUE CHECK (volgorde > 0),
    niveau       text NOT NULL CHECK (niveau IN ('batch','lot')),
    is_lot_stap  boolean NOT NULL DEFAULT false,
    actief       boolean NOT NULL DEFAULT true,
    -- Keuringsstap (sinds 0.51.0, #80): tussenkeuring (TK) of eindkeuring (EK), alleen Kwaliteit meet en beslist.
    soort        text NOT NULL DEFAULT 'proces' CHECK (soort IN ('proces','keuring')),
    CHECK (NOT is_lot_stap OR niveau = 'lot'),
    CONSTRAINT processtap_keuring_geen_lotstap CHECK (NOT (soort = 'keuring' AND is_lot_stap))
);
-- Precies één (actieve) lot-stap.
CREATE UNIQUE INDEX processtap_een_lot_stap ON processtap (is_lot_stap) WHERE is_lot_stap AND actief;

-- Optioneel: welke stappen in de keuzelijst van een pc staan.
CREATE TABLE pc_stap (
    pc_id          uuid NOT NULL REFERENCES pc(id),
    processtap_id  uuid NOT NULL REFERENCES processtap(id),
    PRIMARY KEY (pc_id, processtap_id)
);

CREATE TABLE veld (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    processtap_id     uuid NOT NULL REFERENCES processtap(id),
    code              text NOT NULL UNIQUE,     -- S3.2; nooit hergebruikt
    naam              text NOT NULL,
    soort             text NOT NULL CHECK (soort IN ('procesparameter','gewicht','overig')),
    eenheid           text,
    grens_min         numeric,
    grens_max         numeric,
    tolerantie        numeric CHECK (tolerantie IS NULL OR tolerantie >= 0),
    tolerantie_soort  text NOT NULL DEFAULT 'absoluut' CHECK (tolerantie_soort IN ('absoluut','procent')),
    volgnummer        int  NOT NULL,
    verplicht         boolean NOT NULL DEFAULT true,
    actief            boolean NOT NULL DEFAULT true,
    op_certificaat    boolean NOT NULL DEFAULT false,   -- sinds migratie 0010
    decimalen         smallint CHECK (decimalen BETWEEN 0 AND 6),   -- sinds migratie 0015; leeg = automatisch
    -- Wie meet (sinds migratie 0022, #64): de operator, of Kwaliteit na het afronden van de stap.
    gemeten_door      text NOT NULL DEFAULT 'productie' CHECK (gemeten_door IN ('productie','kwaliteit')),
    UNIQUE (processtap_id, volgnummer),
    CHECK (grens_min IS NULL OR grens_max IS NULL OR grens_min <= grens_max),
    CHECK (tolerantie IS NULL OR soort = 'procesparameter')
);

-- Wijzigingslogboek voor configuratie.
CREATE TABLE config_log (
    id          bigserial PRIMARY KEY,
    tabel       text NOT NULL,
    record_id   uuid NOT NULL,
    actie       text NOT NULL,
    oud         jsonb,
    nieuw       jsonb,
    gewijzigd_door text NOT NULL DEFAULT coalesce(current_setting('fabriek.gebruiker', true), 'onbekend'),
    gewijzigd_op   timestamptz NOT NULL DEFAULT now()
);

-- Logt elke wijziging in de configuratie: stappen, velden, accounts, operators,
-- pc's en welke stappen een pc bedient. Wachtwoord-hashes komen nooit in het logboek.
CREATE FUNCTION log_config() RETURNS trigger LANGUAGE plpgsql AS $$
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

CREATE TRIGGER processtap_log BEFORE INSERT OR UPDATE OR DELETE ON processtap
    FOR EACH ROW EXECUTE FUNCTION log_config();
CREATE TRIGGER veld_log BEFORE INSERT OR UPDATE OR DELETE ON veld
    FOR EACH ROW EXECUTE FUNCTION log_config();
CREATE TRIGGER gebruiker_log BEFORE INSERT OR UPDATE OR DELETE ON gebruiker
    FOR EACH ROW EXECUTE FUNCTION log_config();
CREATE TRIGGER operator_log BEFORE INSERT OR UPDATE OR DELETE ON operator
    FOR EACH ROW EXECUTE FUNCTION log_config();
CREATE TRIGGER pc_log BEFORE INSERT OR UPDATE OR DELETE ON pc
    FOR EACH ROW EXECUTE FUNCTION log_config();
CREATE TRIGGER pc_stap_log BEFORE INSERT OR DELETE ON pc_stap
    FOR EACH ROW EXECUTE FUNCTION log_config();

-- Er blijft altijd minstens één actieve beheerder over.
CREATE FUNCTION bewaak_beheerder() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.rol = 'beheerder' AND OLD.actief AND (NEW.rol <> 'beheerder' OR NOT NEW.actief)
       AND NOT EXISTS (SELECT 1 FROM gebruiker WHERE rol = 'beheerder' AND actief AND id <> OLD.id) THEN
        RAISE EXCEPTION 'Er moet minstens één actieve beheerder overblijven';
    END IF;
    IF NEW.gebruikersnaam <> OLD.gebruikersnaam THEN
        RAISE EXCEPTION 'Een gebruikersnaam verandert niet; maak een nieuw account';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER gebruiker_beheerder BEFORE UPDATE ON gebruiker
    FOR EACH ROW EXECUTE FUNCTION bewaak_beheerder();

-- Codes zijn vast: een veld of stap krijgt nooit een andere code.
CREATE FUNCTION code_vast() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.code <> OLD.code THEN
        RAISE EXCEPTION 'Code % mag niet veranderen', OLD.code;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER processtap_code_vast BEFORE UPDATE ON processtap FOR EACH ROW EXECUTE FUNCTION code_vast();
CREATE TRIGGER veld_code_vast       BEFORE UPDATE ON veld       FOR EACH ROW EXECUTE FUNCTION code_vast();

-- ---------------------------------------------------------------------
-- Productie: batches en lots
-- ---------------------------------------------------------------------

CREATE TABLE lot (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lotnummer text NOT NULL UNIQUE CHECK (lotnummer ~ '^L-[0-9]{4}-[0-9]{4}$'),
    status text NOT NULL DEFAULT 'in_productie' CHECK (status IN ('in_productie','gereed','geblokkeerd')),
    aangemaakt_op timestamptz NOT NULL DEFAULT now()
);

-- Producten (configuratie, door de planner beheerd; sinds migratie 0003)
CREATE TABLE product (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL UNIQUE CHECK (code ~ '^[A-Za-z0-9._-]{1,20}$'),
    naam text NOT NULL,
    actief boolean NOT NULL DEFAULT true
);
CREATE TRIGGER product_log BEFORE INSERT OR UPDATE OR DELETE ON product
    FOR EACH ROW EXECUTE FUNCTION log_config();
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

-- Vastgestelde, onveranderlijke momentopnames van een productroute (D85).
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
    CHECK ((status = 'concept' AND vastgesteld_op IS NULL) OR (status IN ('vastgesteld','vervallen') AND vastgesteld_op IS NOT NULL))
);
-- Stappen en snapshotgegevens die bij één vastgestelde productroute horen.
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


CREATE TABLE batch (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    batchnummer      text NOT NULL UNIQUE CHECK (batchnummer ~ '^B-[0-9]{4}-[0-9]{4}$'),
    bron             text NOT NULL DEFAULT 'operator' CHECK (bron IN ('operator','planner')),
    status           text NOT NULL DEFAULT 'in_productie'
                     CHECK (status IN ('gepland','in_productie','in_beoordeling','in_lot','afgekeurd','vervallen')),
    lot_id           uuid REFERENCES lot(id),
    aangemaakt_op    timestamptz NOT NULL DEFAULT now(),
    aangemaakt_door  uuid REFERENCES operator(id),
    geplande_dag     date,
    volgorde         int CHECK (volgorde > 0),
    product_id       uuid REFERENCES product(id),
    opmerking        text,
    gepland_door     uuid REFERENCES gebruiker(id),
    gestart_op       timestamptz,
    vervallen_reden  text,
    CHECK ((status = 'in_lot') = (lot_id IS NOT NULL)),
    CONSTRAINT batch_gepland_door_planner CHECK (status NOT IN ('gepland','vervallen') OR bron = 'planner'),
    CONSTRAINT batch_planner_heeft_dag CHECK (bron <> 'planner' OR geplande_dag IS NOT NULL),
    CONSTRAINT batch_vervallen_reden CHECK ((status = 'vervallen') = (vervallen_reden IS NOT NULL))
);
CREATE INDEX batch_lot ON batch (lot_id);
CREATE INDEX batch_status ON batch (status);
CREATE INDEX batch_geplande_dag ON batch (geplande_dag);

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
ALTER TABLE lot
    ADD COLUMN batch_aantal_norm int NOT NULL,
    ADD COLUMN batch_aantal int NOT NULL,
    ADD COLUMN afwijking_reden text,
    ADD CONSTRAINT lot_batch_aantal_norm_geldig CHECK (batch_aantal_norm BETWEEN 1 AND 50),
    ADD CONSTRAINT lot_batch_aantal_geldig CHECK (batch_aantal BETWEEN 1 AND 50),
    ADD CONSTRAINT lot_batch_aantal_afwijking CHECK (
        (batch_aantal = batch_aantal_norm AND afwijking_reden IS NULL)
        OR (batch_aantal <> batch_aantal_norm AND length(btrim(afwijking_reden)) BETWEEN 3 AND 500));
CREATE VIEW route_historie_rapport AS
SELECT 'batch'::text AS object_type, b.id AS object_id, b.batchnummer AS object_nummer,
       b.product_id, b.gestart_op AS moment, b.route_versie_id,
       (SELECT v.id FROM product_route_versie v WHERE v.product_id = b.product_id ORDER BY v.versie DESC LIMIT 1) AS kandidaat_route_versie_id,
       b.route_historie_status AS status,
       CASE WHEN b.product_id IS NULL THEN 'Batch heeft geen product; route kan niet worden bepaald.'
            ELSE 'Historische route niet automatisch gekoppeld; beoordeel de configuratiehistorie.' END AS reden
  FROM batch b WHERE b.route_historie_status = 'historisch_onbekend'
UNION ALL
SELECT 'lot'::text, l.id, l.lotnummer, (SELECT b.product_id FROM batch b WHERE b.lot_id = l.id ORDER BY b.product_id LIMIT 1),
       l.aangemaakt_op, l.route_versie_id,
       (SELECT v.id FROM product_route_versie v WHERE v.product_id = (SELECT b.product_id FROM batch b WHERE b.lot_id = l.id ORDER BY b.product_id LIMIT 1) ORDER BY v.versie DESC LIMIT 1),
       l.route_historie_status, 'Historische lotroute niet automatisch gekoppeld; beoordeel de configuratiehistorie.'
  FROM lot l WHERE l.route_historie_status = 'historisch_onbekend';


-- Besluiten over een batch:
--   in_beoordeling – ploegleider of kwaliteit; de batch kan dan niet verder
--   vrijgegeven    – keurresultaat OK, alleen kwaliteit; door naar de volgende stap
--   afgekeurd      – keurresultaat NOK, alleen kwaliteit; batch wordt afgevoerd
--   herbewerken    – keurresultaat herbewerken, alleen kwaliteit; terug naar een eerdere stap (sinds 0021)
CREATE TABLE batch_besluit (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id       uuid NOT NULL REFERENCES batch(id),
    besluit        text NOT NULL CHECK (besluit IN ('in_beoordeling','vrijgegeven','afgekeurd','herbewerken')),
    reden          text NOT NULL CHECK (length(trim(reden)) > 0),
    besloten_door  uuid NOT NULL REFERENCES gebruiker(id),
    besloten_op    timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION verwerk_batch_besluit() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER batch_besluit_verwerk BEFORE INSERT ON batch_besluit
    FOR EACH ROW EXECUTE FUNCTION verwerk_batch_besluit();

-- Grenzen en tolerantie per product (sinds migratie 0019, D55). Een regel hier vervangt voor dat product
-- alle vier de waarden van het veld (leeg = geen grens). Zonder regel gelden de grenzen van het veld.
CREATE TABLE veld_product (
    veld_id           uuid NOT NULL REFERENCES veld(id),
    product_id        uuid NOT NULL REFERENCES product(id),
    grens_min         numeric,
    grens_max         numeric,
    tolerantie        numeric CHECK (tolerantie IS NULL OR tolerantie >= 0),
    tolerantie_soort  text NOT NULL DEFAULT 'absoluut' CHECK (tolerantie_soort IN ('absoluut','procent')),
    PRIMARY KEY (veld_id, product_id),
    CHECK (grens_min IS NULL OR grens_max IS NULL OR grens_min <= grens_max)
);
CREATE INDEX veld_product_product ON veld_product (product_id);
CREATE TRIGGER veld_product_log BEFORE INSERT OR UPDATE OR DELETE ON veld_product
    FOR EACH ROW EXECUTE FUNCTION log_config();
CREATE FUNCTION controleer_veld_product() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.tolerantie IS NOT NULL AND (SELECT soort FROM veld WHERE id = NEW.veld_id) <> 'procesparameter' THEN
        RAISE EXCEPTION 'Alleen een procesparameter heeft een tolerantie';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER veld_product_controle BEFORE INSERT OR UPDATE ON veld_product
    FOR EACH ROW EXECUTE FUNCTION controleer_veld_product();

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
CREATE FUNCTION grenzen_van(p_veld uuid, p_product uuid)
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

-- ---------------------------------------------------------------------
-- Stapregistraties
-- ---------------------------------------------------------------------

CREATE TABLE stapregistratie (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    processtap_id       uuid NOT NULL REFERENCES processtap(id),
    batch_id            uuid REFERENCES batch(id),
    lot_id              uuid REFERENCES lot(id),
    poging              int  NOT NULL CHECK (poging >= 1),
    herbewerking_start  boolean NOT NULL DEFAULT false,
    reden               text,
    pc_id               uuid NOT NULL REFERENCES pc(id),
    operator_id         uuid NOT NULL REFERENCES operator(id),
    gestart_op          timestamptz NOT NULL DEFAULT clock_timestamp(),
    afgerond_op         timestamptz,
    -- afgebroken: de batch werd afgekeurd terwijl deze stap open stond
    status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open','afgerond','afgebroken')),
    -- Aankomst op de server (sinds migratie 0011; leeg bij oudere regels). gestart_op en afgerond_op
    -- zijn het moment op het apparaat.
    gestart_ontvangen_op  timestamptz DEFAULT clock_timestamp(),
    afgerond_ontvangen_op timestamptz,
    -- Product van de batch of het lot bij de start (sinds migratie 0019, D55): voor grenzen en analyses per product.
    product_id          uuid REFERENCES product(id),
    -- Wie de stap afrondde en op welke pc (sinds migratie 0023, #55): kan een ander zijn dan wie startte
    -- (ploegwissel). Leeg bij stappen van vóór 0023 en bij open stappen.
    afgerond_door       uuid REFERENCES operator(id),
    afgerond_pc_id      uuid REFERENCES pc(id),
    -- Nageleverd van papier (sinds migratie 0024, #75, D60): wie het nainvoerde, waarom en wanneer.
    -- gestart_op en afgerond_op zijn dan de tijden van het papier.
    nageleverd_door     uuid REFERENCES gebruiker(id),
    nageleverd_reden    text,
    nageleverd_op       timestamptz,
    CHECK ((batch_id IS NULL) <> (lot_id IS NULL)),
    CHECK (NOT herbewerking_start OR length(trim(coalesce(reden,''))) > 0),
    CHECK ((status <> 'open') = (afgerond_op IS NOT NULL)),
    CHECK ((nageleverd_door IS NULL) = (nageleverd_reden IS NULL))
);
CREATE UNIQUE INDEX stapreg_uniek_batch ON stapregistratie (processtap_id, batch_id, poging) WHERE batch_id IS NOT NULL;
CREATE UNIQUE INDEX stapreg_uniek_lot   ON stapregistratie (processtap_id, lot_id, poging)   WHERE lot_id IS NOT NULL;
-- Voor de geschiedenis van een batch of lot, de werkvoorraad en de doorlooptijden.
CREATE INDEX stapreg_batch ON stapregistratie (batch_id, afgerond_op) WHERE batch_id IS NOT NULL;
CREATE INDEX stapreg_lot   ON stapregistratie (lot_id, afgerond_op)   WHERE lot_id IS NOT NULL;

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

-- Keuring door Kwaliteit (sinds migratie 0022, #64): een stap met velden die Kwaliteit meet. Na het afronden
-- door de operator wacht de batch of het lot op Kwaliteit: meten en dan vrijgeven, herbewerken of afkeuren.
-- Pas na de vrijgave telt de stap als gedaan en kan de volgende stap starten.
CREATE TABLE keuring (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    stapregistratie_id  uuid NOT NULL UNIQUE REFERENCES stapregistratie(id),
    status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open','vrijgegeven','herbewerken','afgekeurd')),
    aangemaakt_op       timestamptz NOT NULL DEFAULT now(),
    besloten_door       uuid REFERENCES gebruiker(id),
    besloten_op         timestamptz,
    reden               text,
    herbewerking_id     uuid REFERENCES herbewerking(id),
    CHECK ((status = 'open') = (besloten_op IS NULL)),
    CHECK (status NOT IN ('herbewerken','afgekeurd') OR length(trim(coalesce(reden, ''))) > 0)
);
CREATE INDEX keuring_open ON keuring (aangemaakt_op) WHERE status = 'open';

-- Meet Kwaliteit iets in deze stap (sinds 0022)?
CREATE FUNCTION stap_meet_kwaliteit(p_stap uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM veld WHERE processtap_id = p_stap AND actief AND gemeten_door = 'kwaliteit')
        OR EXISTS (SELECT 1 FROM processtap WHERE id = p_stap AND soort = 'keuring')
$$;
CREATE INDEX stapreg_open  ON stapregistratie (processtap_id)         WHERE status = 'open';
CREATE INDEX stapreg_afgerond ON stapregistratie (afgerond_op);
CREATE INDEX stapreg_product ON stapregistratie (product_id);

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
       AND (ps.product_id IS NOT NULL
            -- De standaardroute (product zonder eigen route) heeft geen keuringsstappen (#80): die horen bij een product.
            OR (NOT EXISTS (SELECT 1 FROM product_stap x WHERE x.product_id = p_product) AND s.soort = 'proces'))
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

-- Is deze batchstap gedaan (sinds migratie 0021)? Er is een afgeronde registratie, en geen herbewerking
-- die daarna begon bij deze stap of eerder in de route. Volgorde op de aankomst op de server, zodat
-- verschillende klokken op de pc's niet meetellen (ouder dan 0011: het moment op het apparaat).
CREATE FUNCTION batch_stap_gedaan(p_batch uuid, p_stap uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    WITH rt AS (SELECT r.processtap_id, r.plek FROM batch b CROSS JOIN LATERAL route(b.product_id) r WHERE b.id = p_batch)
    SELECT EXISTS (
        SELECT 1 FROM stapregistratie x
         WHERE x.batch_id = p_batch AND x.processtap_id = p_stap AND x.status = 'afgerond'
           AND NOT EXISTS (SELECT 1 FROM keuring k WHERE k.stapregistratie_id = x.id AND k.status <> 'vrijgegeven')   -- sinds 0022
           AND NOT EXISTS (
               SELECT 1 FROM stapregistratie h JOIN rt ON rt.processtap_id = h.processtap_id
                WHERE h.batch_id = p_batch AND h.herbewerking_start AND h.id <> x.id
                  AND rt.plek <= (SELECT plek FROM rt WHERE processtap_id = p_stap)
                  AND coalesce(h.gestart_ontvangen_op, h.gestart_op) > coalesce(x.gestart_ontvangen_op, x.gestart_op)))
$$;

-- Heeft de batch alle batchstappen van zijn route gedaan, zonder herbewerking die nog moet starten? (De status controleert de aanroeper.)
CREATE FUNCTION batch_klaar_voor_lot(p_batch uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT NOT EXISTS (
        SELECT 1 FROM batch b
          CROSS JOIN LATERAL route(b.product_id) r
          JOIN processtap s ON s.id = r.processtap_id AND s.niveau = 'batch'
         WHERE b.id = p_batch
           AND NOT batch_stap_gedaan(b.id, s.id))
       AND NOT EXISTS (SELECT 1 FROM herbewerking h WHERE h.batch_id = p_batch AND h.status = 'open')
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

-- Controleert niveau, status van batch/lot, de route en de volgorde van stappen.
CREATE FUNCTION controleer_stapregistratie() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER stapregistratie_controle BEFORE INSERT ON stapregistratie
    FOR EACH ROW EXECUTE FUNCTION controleer_stapregistratie();

-- Registraties worden niet verwijderd en alleen afgerond.
CREATE FUNCTION bewaak_stapregistratie() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Stapregistraties worden niet verwijderd';
    END IF;
    IF OLD.status <> 'open' THEN
        RAISE EXCEPTION 'Een afgeronde of afgebroken stap kan niet meer veranderen';
    END IF;
    IF (NEW.processtap_id, NEW.batch_id, NEW.lot_id, NEW.poging) IS DISTINCT FROM
       (OLD.processtap_id, OLD.batch_id, OLD.lot_id, OLD.poging) THEN
        RAISE EXCEPTION 'Alleen afronden is toegestaan';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER stapregistratie_bewaak BEFORE UPDATE OR DELETE ON stapregistratie
    FOR EACH ROW EXECUTE FUNCTION bewaak_stapregistratie();

-- Lotstatus volgt de registraties: gereed zodra de laatste lotstap is
-- afgerond, terug in productie zodra een herbewerking start.
CREATE FUNCTION werk_lotstatus_bij() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_laatste uuid;
BEGIN
    IF NEW.lot_id IS NULL THEN RETURN NEW; END IF;
    IF TG_OP = 'INSERT' AND NEW.herbewerking_start THEN
        UPDATE lot SET status = 'in_productie' WHERE id = NEW.lot_id AND status = 'gereed';
    ELSIF TG_OP = 'UPDATE' AND NEW.status = 'afgerond' AND OLD.status = 'open' THEN
        v_laatste := route_laatste(lot_product(NEW.lot_id), 'lot');
        -- Meet Kwaliteit in die stap, dan pas gereed na de vrijgave (beslis_keuring, sinds 0022).
        IF NEW.processtap_id = v_laatste AND NOT stap_meet_kwaliteit(NEW.processtap_id) THEN
            UPDATE lot SET status = 'gereed' WHERE id = NEW.lot_id;
        END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER stapregistratie_lotstatus AFTER INSERT OR UPDATE ON stapregistratie
    FOR EACH ROW EXECUTE FUNCTION werk_lotstatus_bij();

-- ---------------------------------------------------------------------
-- Waarden
-- ---------------------------------------------------------------------

CREATE TABLE waarde (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    stapregistratie_id  uuid NOT NULL REFERENCES stapregistratie(id),
    veld_id             uuid NOT NULL REFERENCES veld(id),
    setting             numeric,
    gemeten             numeric NOT NULL,
    -- Kopie van de grenzen op het moment van invoer:
    grens_min           numeric,
    grens_max           numeric,
    tolerantie          numeric,
    tolerantie_soort    text,
    markering           text NOT NULL CHECK (markering IN ('ok','buiten_tolerantie','buiten_grens')),
    vervangt_waarde_id  uuid UNIQUE REFERENCES waarde(id),
    correctie_reden     text,
    ingevoerd_door      uuid REFERENCES operator(id),
    gecorrigeerd_door   uuid REFERENCES gebruiker(id),
    ingevoerd_op        timestamptz NOT NULL DEFAULT now(),
    ontvangen_op        timestamptz DEFAULT clock_timestamp(),   -- sinds migratie 0011
    specificatie_id     uuid REFERENCES specificatie(id),        -- sinds 0.51.0 (#80): getoetst aan deze specificatie
    CHECK ((vervangt_waarde_id IS NULL) = (gecorrigeerd_door IS NULL)),
    CHECK (vervangt_waarde_id IS NULL OR length(trim(coalesce(correctie_reden,''))) > 0),
    CHECK (vervangt_waarde_id IS NOT NULL OR ingevoerd_door IS NOT NULL)
);
-- Per registratie en veld maar één oorspronkelijke waarde.
CREATE UNIQUE INDEX waarde_een_origineel ON waarde (stapregistratie_id, veld_id) WHERE vervangt_waarde_id IS NULL;
CREATE INDEX waarde_tijd ON waarde (ingevoerd_op);
CREATE INDEX waarde_veld ON waarde (veld_id, ingevoerd_op);

CREATE FUNCTION bereken_markering(p_setting numeric, p_gemeten numeric, p_min numeric, p_max numeric,
                                  p_tol numeric, p_tol_soort text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN (p_min IS NOT NULL AND p_gemeten < p_min) OR (p_max IS NOT NULL AND p_gemeten > p_max)
            THEN 'buiten_grens'
        WHEN p_tol IS NOT NULL AND p_setting IS NOT NULL AND
             abs(p_gemeten - p_setting) > CASE WHEN p_tol_soort = 'procent'
                                               THEN abs(p_setting) * p_tol / 100 ELSE p_tol END
            THEN 'buiten_tolerantie'
        ELSE 'ok' END
$$;

CREATE FUNCTION verwerk_waarde() RETURNS trigger LANGUAGE plpgsql AS $$
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
        -- alleen de nieuwste waarde kan vervangen worden. Kwaliteit lost een conflict op in een veld dat
        -- Kwaliteit meet (sinds 0032, #85): alleen via los_invoerconflict_op.
        SELECT rol INTO v_rol FROM gebruiker WHERE id = NEW.gecorrigeerd_door AND actief;
        IF v_rol IS NULL OR NOT (v_rol IN ('ploegleider','beheerder')
                                 OR (v_rol = 'kwaliteit' AND v_veld.gemeten_door = 'kwaliteit'
                                     AND current_setting('fabriek.conflict', true) = 'aan')) THEN
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
CREATE TRIGGER waarde_verwerk BEFORE INSERT ON waarde
    FOR EACH ROW EXECUTE FUNCTION verwerk_waarde();

CREATE FUNCTION waarde_onveranderlijk() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Waarden worden niet gewijzigd of verwijderd; leg een correctie vast';
END $$;
CREATE TRIGGER waarde_vast BEFORE UPDATE OR DELETE ON waarde
    FOR EACH ROW EXECUTE FUNCTION waarde_onveranderlijk();

-- Actuele waarde = de waarde die door niets vervangen is.
CREATE VIEW waarde_actueel AS
SELECT w.* FROM waarde w
WHERE NOT EXISTS (SELECT 1 FROM waarde c WHERE c.vervangt_waarde_id = w.id);

-- ---------------------------------------------------------------------
-- Acties
-- ---------------------------------------------------------------------

-- Een stap afronden: alle verplichte actieve velden moeten ingevuld zijn. Met wie afrondt en op welke pc (sinds 0023).
CREATE FUNCTION rond_stap_af(p_registratie uuid, p_operator uuid DEFAULT NULL, p_pc uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_ontbreekt text;
    v_status    text;
BEGIN
    SELECT status INTO v_status FROM stapregistratie WHERE id = p_registratie FOR UPDATE;
    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Registratie bestaat niet';
    ELSIF v_status <> 'open' THEN
        RAISE EXCEPTION 'Deze stap is al afgerond of afgebroken';
    END IF;
    SELECT string_agg(x, ', ' ORDER BY n, v, x) INTO v_ontbreekt FROM (
        SELECT v.code AS x, 1 AS n, v.volgnummer AS v
          FROM stapregistratie r
          JOIN veld v ON v.processtap_id = r.processtap_id AND v.actief AND v.verplicht
                      AND v.gemeten_door = 'productie'   -- wat Kwaliteit meet, komt na het afronden (sinds 0022)
         WHERE r.id = p_registratie
           AND NOT EXISTS (SELECT 1 FROM waarde w WHERE w.stapregistratie_id = r.id AND w.veld_id = v.id)
        UNION ALL
        SELECT 'grondstof ' || g.code, 2, 0
          FROM stapregistratie r
          JOIN stap_grondstof sg ON sg.processtap_id = r.processtap_id AND sg.actief AND sg.verplicht
          JOIN grondstof g ON g.id = sg.grondstof_id AND g.actief
         WHERE r.id = p_registratie
           AND NOT EXISTS (SELECT 1 FROM grondstof_gebruik u WHERE u.stapregistratie_id = r.id AND u.grondstof_id = g.id)
    ) o;
    IF v_ontbreekt IS NOT NULL THEN
        RAISE EXCEPTION 'Nog niet ingevuld: %', v_ontbreekt;
    END IF;
    -- Wie afrondt kan een ander zijn dan wie startte (ploegwissel, #55). Zonder naam: wie startte.
    UPDATE stapregistratie SET status = 'afgerond', afgerond_op = apparaat_moment(gestart_op),
           afgerond_door = coalesce(p_operator, operator_id), afgerond_pc_id = coalesce(p_pc, pc_id)
     WHERE id = p_registratie AND status = 'open';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Registratie bestaat niet of is al afgerond';
    END IF;
END $$;

-- Stel een lot samen uit precies 4 batches en open de lot-stap.
CREATE FUNCTION maak_lot(p_lotnummer text, p_batches uuid[], p_pc uuid, p_operator uuid,
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
CREATE FUNCTION controleer_lot_voorstel(p_voorstel uuid) RETURNS void LANGUAGE plpgsql AS $$
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
CREATE FUNCTION bewaar_lot_voorstel(p_id uuid, p_batches uuid[], p_opmerking text, p_door uuid)
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
ALTER TABLE product ADD COLUMN batches_per_lot int NOT NULL DEFAULT 4 CHECK (batches_per_lot BETWEEN 1 AND 50);

CREATE FUNCTION verval_lotvoorstellen_bij_lotgrootte() RETURNS trigger LANGUAGE plpgsql AS $
BEGIN
    UPDATE lot_voorstel v SET status = 'vervallen', afgesloten_op = clock_timestamp()
     WHERE v.status = 'open'
       AND EXISTS (SELECT 1 FROM lot_voorstel_batch x JOIN batch b ON b.id = x.batch_id
                    WHERE x.voorstel_id = v.id AND b.product_id = NEW.id);
    RETURN NEW;
END $;
CREATE TRIGGER product_lotgrootte_verval_voorstellen
AFTER UPDATE OF batches_per_lot ON product
FOR EACH ROW WHEN (OLD.batches_per_lot IS DISTINCT FROM NEW.batches_per_lot)
EXECUTE FUNCTION verval_lotvoorstellen_bij_lotgrootte();
ALTER TABLE capaciteit_stap ADD COLUMN kg_per_dag numeric CHECK (kg_per_dag > 0 AND kg_per_dag <= 100000000);
ALTER TABLE capaciteit_stap ALTER COLUMN max_per_dag DROP NOT NULL;
ALTER TABLE capaciteit_stap ADD CONSTRAINT capaciteit_stap_ingevuld CHECK (kg_per_dag IS NOT NULL OR max_per_dag IS NOT NULL);

-- Gewicht van één item in een stap: een batch, of een lot met de ingestelde lotgrootte.
-- NULL = gewicht nog niet ingevuld.
CREATE FUNCTION gewicht_per_item(p_product uuid, p_stap uuid) RETURNS numeric LANGUAGE sql STABLE AS $$
    SELECT p.batchgewicht_kg * CASE WHEN s.niveau = 'lot' THEN p.batches_per_lot ELSE 1 END
      FROM product p, processtap s WHERE p.id = p_product AND s.id = p_stap
$$;

-- Productie-uren per dag: de actieve diensten samen (standaard 24).
CREATE FUNCTION productie_uren_per_dag() RETURNS numeric LANGUAGE sql STABLE AS $$
    SELECT coalesce((SELECT sum(extract(epoch FROM CASE WHEN eindigt > begint THEN eindigt - begint
                                                        ELSE eindigt - begint + interval '24 hours' END)) / 3600
                       FROM ploeg WHERE actief), 24)::numeric
$$;

CREATE FUNCTION capaciteit_stap_voor(p_stap uuid, p_product uuid) RETURNS int LANGUAGE sql STABLE AS $$
    -- Sinds 0035 (#90, D80) in kilogram: hoeveel batches of lots per dag passen, met het gewicht per batch van
    -- het product (een lot gebruikt de ingestelde lotgrootte). Minstens 1; NULL als het gewicht nog niet is ingevuld. Een oude
    -- regel zonder kilogram (van vóór 0035) telt nog in stuks.
    SELECT CASE WHEN c.kg_per_dag IS NULL THEN c.max_per_dag
                WHEN gewicht_per_item(p_product, p_stap) IS NULL THEN NULL
                ELSE greatest(1, floor(c.kg_per_dag / gewicht_per_item(p_product, p_stap)))::int END
      FROM capaciteit_stap c WHERE c.processtap_id = p_stap AND c.product_id = p_product
$$;

-- Per actief product elke stap van zijn route met de capaciteit; max_per_dag NULL = nog invullen (#81, sinds 0.49.0).
CREATE VIEW capaciteit_route AS
SELECT p.id AS product_id, r.processtap_id, r.plek, capaciteit_stap_voor(r.processtap_id, p.id) AS max_per_dag,
       c.kg_per_dag, c.max_per_dag AS stuks_per_dag
  FROM product p
 CROSS JOIN LATERAL route(p.id) r
  LEFT JOIN capaciteit_stap c ON c.processtap_id = r.processtap_id AND c.product_id = p.id
 WHERE p.actief;

-- Afwijkende capaciteit (sinds 0.48.0, D69): in een periode kan een stap en/of product minder aan.
-- Stap leeg = alle stappen, product leeg = alle producten. 0 % = geen productie.
-- Gelden er meer regels tegelijk, dan telt het laagste percentage.
CREATE TABLE capaciteit_afwijking (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    van            date NOT NULL,
    tot            date NOT NULL,
    processtap_id  uuid REFERENCES processtap(id),
    product_id     uuid REFERENCES product(id),
    procent        int  NOT NULL CHECK (procent BETWEEN 0 AND 100),
    reden          text NOT NULL CHECK (length(btrim(reden)) BETWEEN 2 AND 200),
    actief         boolean NOT NULL DEFAULT true,
    CONSTRAINT capaciteit_afwijking_periode CHECK (tot >= van AND tot - van <= 366)
);
CREATE INDEX capaciteit_afwijking_tot ON capaciteit_afwijking (tot) WHERE actief;
CREATE TRIGGER capaciteit_afwijking_log BEFORE INSERT OR UPDATE OR DELETE ON capaciteit_afwijking
    FOR EACH ROW EXECUTE FUNCTION log_config();

-- De afwijking die op een dag voor een stap en product geldt: het laagste percentage (NULL = geen).
CREATE FUNCTION capaciteit_afwijking_voor(p_stap uuid, p_product uuid, p_dag date)
RETURNS TABLE (procent int, reden text) LANGUAGE sql STABLE AS $$
    SELECT a.procent, a.reden FROM capaciteit_afwijking a
     WHERE a.actief AND p_dag BETWEEN a.van AND a.tot
       AND (a.processtap_id IS NULL OR a.processtap_id = p_stap)
       AND (a.product_id IS NULL OR a.product_id = p_product)
     ORDER BY a.procent, a.van, a.reden LIMIT 1
$$;

-- De capaciteit van een stap voor een product op een dag: de gewone capaciteit (capaciteit_stap_voor)
-- maal het percentage van een afwijking, naar beneden afgerond maar minstens 1. 0 % = 0, ook als er geen
-- gewone capaciteit is ingesteld (dan is de stap die dag dicht). NULL = niet ingesteld.
CREATE FUNCTION capaciteit_stap_op(p_stap uuid, p_product uuid, p_dag date) RETURNS int LANGUAGE sql STABLE AS $$
    SELECT CASE
             WHEN a.procent = 0 THEN 0
             WHEN g.max IS NULL THEN NULL
             WHEN a.procent IS NULL THEN g.max
             ELSE greatest(1, floor(g.max * a.procent / 100.0))::int
           END
      FROM (SELECT capaciteit_stap_voor(p_stap, p_product) AS max) g
      LEFT JOIN capaciteit_afwijking_voor(p_stap, p_product, p_dag) a ON true
$$;

-- Wat er op een dag in een stap gepland is, per product, met de capaciteit van die dag (nu met afwijkingen)
-- en de reden van een afwijking. Telt de Planning per stap, plus de batches die die dag starten volgens
-- Batches plannen als dit hun eerste stap is (en ze niet al in deze stap gepland staan).
-- 'van_week' = hoeveel daarvan uit Batches plannen komen.
CREATE FUNCTION stap_belasting(p_stap uuid, p_dag date)
RETURNS TABLE (product_id uuid, aantal int, van_week int, max_per_dag int, reden text) LANGUAGE sql STABLE AS $$
    WITH items AS (
        SELECT coalesce(b.product_id, lot_product(sp.lot_id),
                        (SELECT vb.product_id FROM lot_voorstel_batch x JOIN batch vb ON vb.id = x.batch_id
                          WHERE x.voorstel_id = sp.voorstel_id ORDER BY vb.batchnummer LIMIT 1)) AS product_id,
               false AS van_week
          FROM stapplanning sp LEFT JOIN batch b ON b.id = sp.batch_id
         WHERE sp.processtap_id = p_stap AND sp.dag = p_dag
        UNION ALL
        SELECT b.product_id, true FROM batch b
         WHERE b.geplande_dag = p_dag AND b.status <> 'vervallen'
           AND route_eerste(b.product_id, 'batch') = p_stap
           AND NOT EXISTS (SELECT 1 FROM stapplanning sp WHERE sp.batch_id = b.id AND sp.processtap_id = p_stap))
    SELECT i.product_id, count(*)::int, count(*) FILTER (WHERE i.van_week)::int,
           capaciteit_stap_op(p_stap, i.product_id, p_dag),
           (SELECT a.reden FROM capaciteit_afwijking_voor(p_stap, i.product_id, p_dag) a)
      FROM items i GROUP BY i.product_id
$$;

-- ---------------------------------------------------------------------
-- Certificaat per lot (sinds migratie 0010, versie 0.17.0)
-- ---------------------------------------------------------------------
CREATE TABLE instelling (
    id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sleutel  text NOT NULL UNIQUE CHECK (sleutel ~ '^[a-z_]{1,40}$'),
    waarde   text NOT NULL,
    -- Pilotoverzicht (sinds migratie 0028, #77): startdatum van de pilot en de grens voor "te laat".
    CONSTRAINT instelling_pilot CHECK (
        (sleutel <> 'pilot_start' OR waarde = '' OR waarde ~ '^\d{4}-\d{2}-\d{2}$')
        AND (sleutel <> 'te_laat_minuten' OR (waarde ~ '^\d{1,3}$' AND waarde::int BETWEEN 1 AND 720)))
);
CREATE TRIGGER instelling_log BEFORE INSERT OR UPDATE OR DELETE ON instelling
    FOR EACH ROW EXECUTE FUNCTION log_config();

CREATE TABLE certificaat (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nummer           int GENERATED ALWAYS AS IDENTITY UNIQUE,
    lot_id           uuid NOT NULL REFERENCES lot(id),
    inhoud           jsonb NOT NULL,
    uitgegeven_door  uuid NOT NULL REFERENCES gebruiker(id),
    uitgegeven_op    timestamptz NOT NULL DEFAULT now()
);

-- Alleen Kwaliteit (of de beheerder) geeft een certificaat uit, en alleen voor een lot dat gereed is.
CREATE FUNCTION controleer_certificaat() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_status text;
    v_rol    text;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Een uitgegeven certificaat wordt niet gewijzigd of verwijderd';
    END IF;
    SELECT status INTO v_status FROM lot WHERE id = NEW.lot_id;
    IF v_status <> 'gereed' THEN
        RAISE EXCEPTION 'Een certificaat kan pas als het lot gereed is (nu: %)', v_status;
    END IF;
    SELECT rol INTO v_rol FROM gebruiker WHERE id = NEW.uitgegeven_door AND actief;
    IF v_rol IS NULL OR v_rol NOT IN ('kwaliteit','beheerder') THEN
        RAISE EXCEPTION 'Alleen Kwaliteit geeft een certificaat uit';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER certificaat_controle BEFORE INSERT OR UPDATE OR DELETE ON certificaat
    FOR EACH ROW EXECUTE FUNCTION controleer_certificaat();

-- ---------------------------------------------------------------------
-- Tijdstip van het apparaat (sinds migratie 0011, versie 0.20.0)
-- ---------------------------------------------------------------------
-- De API zet het moment van invoer op de pc in `fabriek.moment` (alleen binnen de transactie).
-- Zonder dat moment (oudere invoerschermen, tools) geldt de servertijd.
-- Het moment van het apparaat, begrensd. Zonder moment: de servertijd.
CREATE FUNCTION apparaat_moment(p_ondergrens timestamptz DEFAULT NULL) RETURNS timestamptz LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    v_nu    timestamptz := clock_timestamp();
    v_tekst text := nullif(current_setting('fabriek.moment', true), '');
    v_t     timestamptz;
BEGIN
    IF v_tekst IS NULL THEN
        RETURN v_nu;
    END IF;
    BEGIN
        v_t := v_tekst::timestamptz;
    EXCEPTION WHEN others THEN
        RETURN v_nu;
    END;
    -- Klok vooruit, of zo lang offline dat het moment niet meer te vertrouwen is: servertijd.
    IF v_t > v_nu OR v_t < v_nu - interval '7 days' THEN
        RETURN v_nu;
    END IF;
    IF p_ondergrens IS NOT NULL AND v_t < p_ondergrens THEN
        v_t := least(p_ondergrens, v_nu);
    END IF;
    RETURN v_t;
END $$;

CREATE FUNCTION heeft_apparaat_moment() RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('fabriek.moment', true), '') IS NOT NULL
$$;

-- Starten: niet eerder dan de laatst afgeronde stap van dezelfde batch of hetzelfde lot
-- (bij een lot ook de stappen van zijn batches).
CREATE FUNCTION zet_moment_start() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_vorige timestamptz;
BEGIN
    IF heeft_apparaat_moment() THEN
        SELECT max(r.afgerond_op) INTO v_vorige FROM stapregistratie r
         WHERE (NEW.batch_id IS NOT NULL AND r.batch_id = NEW.batch_id)
            OR (NEW.lot_id IS NOT NULL AND (r.lot_id = NEW.lot_id
                                            OR r.batch_id IN (SELECT b.id FROM batch b WHERE b.lot_id = NEW.lot_id)));
        NEW.gestart_op := apparaat_moment(v_vorige);
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER stapregistratie_0_moment BEFORE INSERT ON stapregistratie
    FOR EACH ROW EXECUTE FUNCTION zet_moment_start();

-- Afronden of afbreken: aankomst op de server vastleggen.
CREATE FUNCTION zet_ontvangen_afronden() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.afgerond_op IS NOT NULL AND OLD.afgerond_op IS NULL THEN
        NEW.afgerond_ontvangen_op := clock_timestamp();
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER stapregistratie_ontvangen BEFORE UPDATE ON stapregistratie
    FOR EACH ROW EXECUTE FUNCTION zet_ontvangen_afronden();

-- Meetwaarde of grondstof: niet eerder dan het starten van de stap.
CREATE FUNCTION zet_moment_invoer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF heeft_apparaat_moment() THEN
        NEW.ingevoerd_op := apparaat_moment((SELECT r.gestart_op FROM stapregistratie r WHERE r.id = NEW.stapregistratie_id));
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER waarde_0_moment BEFORE INSERT ON waarde
    FOR EACH ROW EXECUTE FUNCTION zet_moment_invoer();
CREATE TRIGGER grondstof_gebruik_0_moment BEFORE INSERT ON grondstof_gebruik
    FOR EACH ROW EXECUTE FUNCTION zet_moment_invoer();

ALTER FUNCTION apparaat_moment(timestamptz) SET search_path = fabriek, public;
ALTER FUNCTION heeft_apparaat_moment() SET search_path = fabriek, public;
ALTER FUNCTION zet_moment_start() SET search_path = fabriek, public;
ALTER FUNCTION zet_ontvangen_afronden() SET search_path = fabriek, public;
ALTER FUNCTION zet_moment_invoer() SET search_path = fabriek, public;

-- ---------------------------------------------------------------------
-- Inloggen beveiligen (sinds migratie 0013, versie 0.21.0)
-- ---------------------------------------------------------------------
-- Gebruikersnamen zijn hoofdletterongevoelig; elke inlogpoging wordt vastgelegd (zonder wachtwoord);
-- na 5 mislukte pogingen binnen 15 minuten 1 minuut wachten; nieuwe wachtwoorden met bcrypt sterkte 11.
CREATE UNIQUE INDEX gebruiker_naam_klein ON gebruiker (lower(gebruikersnaam));

CREATE TABLE inlogpoging (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    gebruikersnaam  text NOT NULL,
    pc              text,
    uitkomst        text NOT NULL CHECK (uitkomst IN ('gelukt','mislukt','geblokkeerd')),
    op              timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX inlogpoging_naam ON inlogpoging (lower(gebruikersnaam), op);
CREATE INDEX inlogpoging_op ON inlogpoging (op);

-- Pogingen worden niet gewijzigd of verwijderd (opruimen doet het onderhoud, niet de applicatie).
CREATE FUNCTION inlogpoging_vast() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Inlogpogingen worden niet gewijzigd';
END $$;
CREATE TRIGGER inlogpoging_vast BEFORE UPDATE ON inlogpoging
    FOR EACH ROW EXECUTE FUNCTION inlogpoging_vast();

-- Hash voor een nieuw wachtwoord.
CREATE FUNCTION wachtwoord_hash(p_wachtwoord text) RETURNS text LANGUAGE sql VOLATILE AS $$
    SELECT public.crypt(p_wachtwoord, public.gen_salt('bf', 11))
$$;

-- Eigen wachtwoord wijzigen (sinds migratie 0025, #76, D61): met het huidige wachtwoord, minstens 8 tekens,
-- en niet gelijk aan het huidige. Daarna is het wachtwoord niet meer tijdelijk.
CREATE FUNCTION wijzig_eigen_wachtwoord(p_gebruiker uuid, p_huidig text, p_nieuw text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM gebruiker WHERE id = p_gebruiker AND actief
                      AND wachtwoord_hash = public.crypt(p_huidig, wachtwoord_hash)) THEN
        RAISE EXCEPTION 'Het huidige wachtwoord klopt niet';
    END IF;
    IF length(coalesce(p_nieuw, '')) < 8 THEN
        RAISE EXCEPTION 'Het nieuwe wachtwoord moet minstens 8 tekens hebben';
    END IF;
    IF p_nieuw = p_huidig THEN
        RAISE EXCEPTION 'Kies een ander wachtwoord dan het tijdelijke';
    END IF;
    UPDATE gebruiker SET wachtwoord_hash = wachtwoord_hash(p_nieuw), wachtwoord_wijzigen = false WHERE id = p_gebruiker;
END $$;

-- Inloggen: controleert de wachttijd, het wachtwoord en legt de poging vast.
-- Geeft één regel: bij succes id, rol en de gebruikersnaam zoals opgeslagen; bij te veel
-- pogingen alleen wacht_seconden; bij een fout wachtwoord niets.
CREATE FUNCTION inloggen(p_naam text, p_wachtwoord text, p_pc text DEFAULT NULL)
RETURNS TABLE (id uuid, rol text, gebruikersnaam text, wacht_seconden int) LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    v_mislukt   int;
    v_laatste   timestamptz;
    v_gebruiker gebruiker%ROWTYPE;
BEGIN
    SELECT count(*), max(p.op) INTO v_mislukt, v_laatste
      FROM inlogpoging p
     WHERE lower(p.gebruikersnaam) = lower(p_naam) AND p.uitkomst = 'mislukt'
       AND p.op > clock_timestamp() - interval '15 minutes'
       AND p.op > coalesce((SELECT max(x.op) FROM inlogpoging x
                             WHERE lower(x.gebruikersnaam) = lower(p_naam) AND x.uitkomst = 'gelukt'), '-infinity');
    IF v_mislukt >= 5 AND v_laatste > clock_timestamp() - interval '1 minute' THEN
        INSERT INTO inlogpoging (gebruikersnaam, pc, uitkomst) VALUES (left(p_naam, 100), left(p_pc, 100), 'geblokkeerd');
        RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::text,
            greatest(1, ceil(extract(epoch FROM v_laatste + interval '1 minute' - clock_timestamp()))::int);
        RETURN;
    END IF;
    SELECT g.* INTO v_gebruiker FROM gebruiker g
     WHERE lower(g.gebruikersnaam) = lower(p_naam) AND g.actief
       AND g.wachtwoord_hash = public.crypt(p_wachtwoord, g.wachtwoord_hash);
    IF NOT FOUND THEN
        INSERT INTO inlogpoging (gebruikersnaam, pc, uitkomst) VALUES (left(p_naam, 100), left(p_pc, 100), 'mislukt');
        RETURN;
    END IF;
    INSERT INTO inlogpoging (gebruikersnaam, pc, uitkomst) VALUES (v_gebruiker.gebruikersnaam, left(p_pc, 100), 'gelukt');
    RETURN QUERY SELECT v_gebruiker.id, v_gebruiker.rol, v_gebruiker.gebruikersnaam, NULL::int;
END $$;

ALTER FUNCTION inlogpoging_vast() SET search_path = fabriek, public;
ALTER FUNCTION wachtwoord_hash(text) SET search_path = fabriek, public;
ALTER FUNCTION inloggen(text, text, text) SET search_path = fabriek, public;

-- Eigen inlog per persoon (sinds migratie 0017, D53). Een invoeraccount (operator of ploegleider) is
-- gekoppeld aan één naam uit de namenlijst; die naam komt bij alles wat het account invoert.
-- Een gedeeld account (het oude operatoraccount, D6) kiest nog een naam tot de beheerder het uitzet.
CREATE FUNCTION operator_van_account(p_gebruiker uuid) RETURNS uuid LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    v_g     gebruiker%ROWTYPE;
    v_id    uuid;
    v_naam  text;
    v_n     int := 1;
BEGIN
    SELECT * INTO v_g FROM gebruiker WHERE id = p_gebruiker AND actief;
    IF NOT FOUND OR v_g.gedeeld OR v_g.rol NOT IN ('operator', 'ploegleider', 'kwaliteit') THEN RETURN NULL; END IF;
    SELECT id INTO v_id FROM operator WHERE gebruiker_id = p_gebruiker;
    IF FOUND THEN RETURN v_id; END IF;
    -- Nog geen naam: maak er een met de gebruikersnaam (de beheerder kan hem later wijzigen).
    v_naam := v_g.gebruikersnaam;
    WHILE EXISTS (SELECT 1 FROM operator WHERE lower(naam) = lower(v_naam)) LOOP
        v_n := v_n + 1;
        v_naam := v_g.gebruikersnaam || ' (' || v_n || ')';
    END LOOP;
    INSERT INTO operator (naam, gebruiker_id) VALUES (v_naam, p_gebruiker) RETURNING id INTO v_id;
    RETURN v_id;
END $$;

-- Mag dit account invoer versturen op naam van deze operator? (D53)
-- Ja als het de eigen naam is; als het account gedeeld is (naam kiezen, zoals voorheen); of als het
-- invoer uit de wachtrij van deze pc is: de persoon van die naam logde de laatste 7 dagen op deze pc in,
-- of het is een naam zonder account en er was de laatste 7 dagen een gedeeld account op deze pc.
CREATE FUNCTION mag_invoeren_namens(p_gebruiker uuid, p_operator uuid, p_pc uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM gebruiker g WHERE g.id = p_gebruiker AND g.gedeeld)
        OR EXISTS (SELECT 1 FROM operator o WHERE o.id = p_operator AND o.gebruiker_id = p_gebruiker)
        OR EXISTS (SELECT 1 FROM operator o
                     JOIN gebruiker g ON g.id = o.gebruiker_id
                     JOIN inlogpoging p ON lower(p.gebruikersnaam) = lower(g.gebruikersnaam)
                     JOIN pc ON pc.naam = p.pc
                    WHERE o.id = p_operator AND pc.id = p_pc AND p.uitkomst = 'gelukt'
                      AND p.op > clock_timestamp() - interval '7 days')
        OR EXISTS (SELECT 1 FROM operator o
                    WHERE o.id = p_operator AND o.gebruiker_id IS NULL
                      AND EXISTS (SELECT 1 FROM inlogpoging p
                                    JOIN gebruiker g ON lower(g.gebruikersnaam) = lower(p.gebruikersnaam) AND g.gedeeld
                                    JOIN pc ON pc.naam = p.pc
                                   WHERE pc.id = p_pc AND p.uitkomst = 'gelukt'
                                     AND p.op > clock_timestamp() - interval '7 days'))
$$;
ALTER FUNCTION operator_van_account(uuid) SET search_path = fabriek, public;
ALTER FUNCTION mag_invoeren_namens(uuid, uuid, uuid) SET search_path = fabriek, public;

-- Oude inlogpogingen opruimen (sinds migratie 0014, versie 0.22.2): 90 dagen bewaren; het onderhoud
-- (back-up op de server, opstarten van de laptop) roept dit aan, de applicatie zelf niet.
CREATE FUNCTION ruim_inlogpogingen_op(p_dagen int DEFAULT 90) RETURNS int LANGUAGE plpgsql AS $$
DECLARE
    v_aantal int;
BEGIN
    IF p_dagen < 30 THEN
        RAISE EXCEPTION 'Inlogpogingen worden minstens 30 dagen bewaard';
    END IF;
    DELETE FROM inlogpoging WHERE op < clock_timestamp() - make_interval(days => p_dagen);
    GET DIAGNOSTICS v_aantal = ROW_COUNT;
    RETURN v_aantal;
END $$;
ALTER FUNCTION ruim_inlogpogingen_op(int) SET search_path = fabriek, public;
REVOKE EXECUTE ON FUNCTION ruim_inlogpogingen_op(int) FROM PUBLIC;

-- ---------------------------------------------------------------------
-- Herbewerkingen met opdracht (sinds migratie 0021, #61)
-- ---------------------------------------------------------------------
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
             ELSE coalesce((SELECT CASE WHEN r.status = 'afgerond'
                                         AND NOT EXISTS (SELECT 1 FROM keuring k WHERE k.stapregistratie_id = r.id AND k.status <> 'vrijgegeven')
                                        THEN 'gedaan' WHEN r.status = 'afgerond' THEN 'bezig' ELSE 'gepland' END
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

-- ---------------------------------------------------------------------
-- Keuring door Kwaliteit (sinds migratie 0022, #64)
-- ---------------------------------------------------------------------
-- Een afgeronde stap waarin Kwaliteit meet, wacht op Kwaliteit (sinds 0022, #64).
CREATE FUNCTION maak_keuring() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status = 'afgerond' AND OLD.status = 'open' AND stap_meet_kwaliteit(NEW.processtap_id) THEN
        INSERT INTO keuring (stapregistratie_id) VALUES (NEW.id) ON CONFLICT (stapregistratie_id) DO NOTHING;
    END IF;
    RETURN NULL;
END $$;
CREATE TRIGGER stapregistratie_keuring AFTER UPDATE ON stapregistratie
    FOR EACH ROW EXECUTE FUNCTION maak_keuring();

-- Kwaliteit beslist (sinds 0022, #64): vrijgeven (alle verplichte metingen van Kwaliteit ingevuld), herbewerken
-- (terug naar deze of een eerdere stap, D57) of afkeuren (batch: keurresultaat NOK, D7; lot: geblokkeerd).
-- Nog een keer hetzelfde besluit versturen (offline wachtrij) doet niets.
CREATE FUNCTION beslis_keuring(p_keuring uuid, p_besluit text, p_reden text, p_door uuid, p_stapcode text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_k        keuring%ROWTYPE;
    v_reg      stapregistratie%ROWTYPE;
    v_stap     processtap%ROWTYPE;
    v_rol      text;
    v_nummer   text;
    v_status   text;
    v_mist     text;
    v_h        uuid;
BEGIN
    SELECT rol INTO v_rol FROM gebruiker WHERE id = p_door AND actief;
    IF v_rol IS DISTINCT FROM 'kwaliteit' THEN
        RAISE EXCEPTION 'Alleen Kwaliteit beslist over een keuring';
    END IF;
    IF p_besluit NOT IN ('vrijgegeven', 'herbewerken', 'afgekeurd') THEN
        RAISE EXCEPTION 'Onbekend besluit %', p_besluit;
    END IF;
    SELECT * INTO v_k FROM keuring WHERE id = p_keuring FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Keuring bestaat niet'; END IF;
    IF v_k.status = p_besluit THEN RETURN; END IF;
    IF v_k.status <> 'open' THEN
        RAISE EXCEPTION 'Over deze stap is al beslist';
    END IF;
    SELECT * INTO v_reg FROM stapregistratie WHERE id = v_k.stapregistratie_id;
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

-- Kwaliteit krijgt een melding als er iets op een meting wacht.
CREATE FUNCTION meld_keuring() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v record;
BEGIN
    SELECT s.code AS stap, b.batchnummer, l.lotnummer, pc.locatie AS hal INTO v
      FROM stapregistratie r JOIN processtap s ON s.id = r.processtap_id JOIN pc ON pc.id = r.pc_id
      LEFT JOIN batch b ON b.id = r.batch_id LEFT JOIN lot l ON l.id = r.lot_id
     WHERE r.id = NEW.stapregistratie_id;
    INSERT INTO melding (soort, ernst, tekst, batchnummer, lotnummer, hal, voor_rollen, bron_id)
    VALUES ('keuring', 'let_op', format('%s %s wacht op meting van Kwaliteit', coalesce(v.batchnummer, v.lotnummer), v.stap),
            v.batchnummer, v.lotnummer, v.hal, ARRAY['kwaliteit'], NEW.id);
    RETURN NULL;
END $$;
CREATE TRIGGER keuring_melding AFTER INSERT ON keuring FOR EACH ROW EXECUTE FUNCTION meld_keuring();

-- ---------------------------------------------------------------------
-- Onderhoud (sinds migratie 0002, versie 0.6.0)
-- ---------------------------------------------------------------------
-- Welke migraties zijn uitgevoerd. Wordt bijgewerkt door tools/migreer.mjs.
CREATE TABLE IF NOT EXISTS schema_versie (
  nummer        integer PRIMARY KEY,
  naam          text NOT NULL,
  uitgevoerd_op timestamptz NOT NULL DEFAULT now()
);

-- Back-ups, hersteltests en migraties, geschreven door de beheertools in tools/.
CREATE TABLE IF NOT EXISTS onderhoud_log (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  soort         text NOT NULL CHECK (soort IN ('backup', 'hersteltest', 'herstel', 'migratie')),
  gestart_op    timestamptz NOT NULL,
  klaar_op      timestamptz NOT NULL DEFAULT now(),
  gelukt        boolean NOT NULL,
  bestand       text,
  grootte_bytes bigint,
  versie        text,
  melding       text
);
CREATE INDEX IF NOT EXISTS onderhoud_log_soort ON onderhoud_log (soort, klaar_op DESC);

-- ---------------------------------------------------------------------
-- "Iets melden" (sinds migratie 0026, #78, D62): gebruikers typen kort wat misgaat of beter kan.
-- Het id komt van het apparaat (de wachtrij van het invoerscherm): opnieuw versturen maakt nooit een dubbele.
-- De beheerder handelt ze af, met een notitie (bijvoorbeeld het roadmapnummer).
-- ---------------------------------------------------------------------
CREATE TABLE terugmelding (
    id               uuid PRIMARY KEY,
    gemeld_op        timestamptz NOT NULL DEFAULT clock_timestamp(),
    gebruiker_id     uuid NOT NULL REFERENCES gebruiker(id),
    operator_id      uuid REFERENCES operator(id),
    pc_id            uuid REFERENCES pc(id),
    stapcode         text,
    scherm           text,
    tekst            text NOT NULL CHECK (length(btrim(tekst)) BETWEEN 3 AND 1000),
    status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'afgehandeld')),
    afgehandeld_door uuid REFERENCES gebruiker(id),
    afgehandeld_op   timestamptz,
    notitie          text,
    CHECK ((status = 'afgehandeld') = (afgehandeld_op IS NOT NULL))
);
CREATE INDEX terugmelding_open ON terugmelding (status, gemeld_op DESC);

CREATE FUNCTION meld_iets(p_id uuid, p_gebruiker uuid, p_operator uuid, p_pc uuid, p_stapcode text, p_scherm text, p_tekst text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF length(btrim(coalesce(p_tekst, ''))) < 3 THEN
        RAISE EXCEPTION 'Schrijf kort wat er is (minstens 3 tekens)';
    END IF;
    INSERT INTO terugmelding (id, gemeld_op, gebruiker_id, operator_id, pc_id, stapcode, scherm, tekst)
    VALUES (p_id, apparaat_moment(), p_gebruiker, p_operator, p_pc, nullif(btrim(p_stapcode), ''), nullif(btrim(p_scherm), ''), btrim(p_tekst))
    ON CONFLICT (id) DO NOTHING;
END $$;

CREATE FUNCTION handel_terugmelding_af(p_id uuid, p_gebruiker uuid, p_notitie text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    UPDATE terugmelding SET status = 'afgehandeld', afgehandeld_door = p_gebruiker, afgehandeld_op = clock_timestamp(),
                            notitie = nullif(btrim(p_notitie), '')
     WHERE id = p_id AND status = 'open';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Deze melding bestaat niet of is al afgehandeld';
    END IF;
END $$;

-- Geweigerde invoer van een pc (#77, D66): de server legt vast wat hij weigerde, zodat het pilotoverzicht
-- kan laten zien wat er misging. Vastgelegd door de API buiten de transactie van de invoer zelf.
CREATE TABLE geweigerde_invoer (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    op            timestamptz NOT NULL DEFAULT clock_timestamp(),
    pc_id         uuid REFERENCES pc(id),
    gebruiker_id  uuid REFERENCES gebruiker(id),
    operator_id   uuid REFERENCES operator(id),
    pad           text NOT NULL CHECK (char_length(pad) BETWEEN 1 AND 200),
    status        int  NOT NULL CHECK (status BETWEEN 400 AND 599),
    fout          text CHECK (char_length(fout) <= 500),
    stapcode      text CHECK (char_length(stapcode) <= 20),
    batchnummer   text CHECK (char_length(batchnummer) <= 40)
);
CREATE INDEX geweigerde_invoer_op ON geweigerde_invoer (op);

CREATE FUNCTION geweigerde_invoer_vast() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Geweigerde invoer wordt niet gewijzigd';
END $$;
CREATE TRIGGER geweigerde_invoer_vast BEFORE UPDATE ON geweigerde_invoer
    FOR EACH ROW EXECUTE FUNCTION geweigerde_invoer_vast();

-- Vastleggen; onbekende pc, gebruiker of operator blijft leeg in plaats van een fout te geven,
-- en te lange teksten worden ingekort: het vastleggen zelf mag nooit mislukken.
CREATE FUNCTION leg_weigering_vast(p_pc uuid, p_gebruiker uuid, p_operator uuid, p_pad text, p_status int,
                                   p_fout text, p_stapcode text, p_batchnummer text) RETURNS void LANGUAGE sql AS $$
    INSERT INTO geweigerde_invoer (pc_id, gebruiker_id, operator_id, pad, status, fout, stapcode, batchnummer)
    VALUES ((SELECT id FROM pc WHERE id = p_pc), (SELECT id FROM gebruiker WHERE id = p_gebruiker),
            (SELECT id FROM operator WHERE id = p_operator), left(coalesce(nullif(p_pad, ''), '?'), 200),
            least(greatest(p_status, 400), 599), left(p_fout, 500), left(nullif(btrim(p_stapcode), ''), 20),
            left(nullif(btrim(p_batchnummer), ''), 40));
$$;

-- 90 dagen bewaren, zoals de inlogpogingen; het onderhoud roept dit aan (back-up, opstarten van de laptop).
CREATE FUNCTION ruim_weigeringen_op(p_dagen int DEFAULT 90) RETURNS int LANGUAGE plpgsql AS $$
DECLARE
    v_aantal int;
BEGIN
    IF p_dagen < 30 THEN
        RAISE EXCEPTION 'Geweigerde invoer wordt minstens 30 dagen bewaard';
    END IF;
    DELETE FROM geweigerde_invoer WHERE op < clock_timestamp() - make_interval(days => p_dagen);
    GET DIAGNOSTICS v_aantal = ROW_COUNT;
    RETURN v_aantal;
END $$;
REVOKE EXECUTE ON FUNCTION ruim_weigeringen_op(int) FROM PUBLIC;

-- Conflicten bij gelijktijdige invoer (sinds 0032, #85, D75): vullen twee mensen hetzelfde veld of dezelfde
-- grondstof van een stap in, dan blijft de eerste staan en wordt de tweede hier bewaard in plaats van geweigerd.
-- Een ploegleider (of Kwaliteit, bij een veld dat Kwaliteit meet) kiest welke blijft; kiest hij de tweede, dan
-- wordt dat een gewone correctie met de reden erbij. Dezelfde waarde nog eens invoeren is geen conflict.
CREATE TABLE invoerconflict (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    invoer_id            uuid UNIQUE,                                   -- id van het apparaat: opnieuw versturen maakt geen tweede conflict
    stapregistratie_id   uuid NOT NULL REFERENCES stapregistratie(id),
    veld_id              uuid REFERENCES veld(id),
    grondstof_id         uuid REFERENCES grondstof(id),
    bestaand_waarde_id   uuid REFERENCES waarde(id),                    -- wat er stond toen de tweede invoer binnenkwam
    bestaand_gebruik_id  uuid REFERENCES grondstof_gebruik(id),
    setting              numeric,
    gemeten              numeric,
    partij               text CHECK (partij IS NULL OR length(btrim(partij)) BETWEEN 1 AND 60),
    hoeveelheid          numeric CHECK (hoeveelheid > 0),
    ingevoerd_door       uuid NOT NULL REFERENCES operator(id),
    pc_id                uuid REFERENCES pc(id),
    ingevoerd_op         timestamptz NOT NULL,
    ontvangen_op         timestamptz NOT NULL DEFAULT clock_timestamp(),
    status               text NOT NULL DEFAULT 'open' CHECK (status IN ('open','bestaand','nieuw')),
    opgelost_door        uuid REFERENCES gebruiker(id),
    opgelost_op          timestamptz,
    reden                text CHECK (char_length(reden) <= 500),
    CHECK ((veld_id IS NULL) <> (grondstof_id IS NULL)),
    CHECK (veld_id IS NULL OR (gemeten IS NOT NULL AND bestaand_waarde_id IS NOT NULL AND partij IS NULL)),
    CHECK (grondstof_id IS NULL OR (partij IS NOT NULL AND bestaand_gebruik_id IS NOT NULL AND gemeten IS NULL)),
    CHECK ((status = 'open') = (opgelost_op IS NULL)),
    CHECK ((status = 'open') = (opgelost_door IS NULL))
);
CREATE INDEX invoerconflict_open ON invoerconflict (stapregistratie_id) WHERE status = 'open';

-- Melding bij een nieuw conflict, voor wie het mag oplossen.
CREATE FUNCTION meld_invoerconflict() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_reg    stapregistratie%ROWTYPE;
    v_stap   text;
    v_wat    text;
    v_oud    text;
    v_nieuw  text;
    v_rollen text[] := ARRAY['ploegleider','beheerder'];
BEGIN
    SELECT * INTO v_reg FROM stapregistratie WHERE id = NEW.stapregistratie_id;
    SELECT code INTO v_stap FROM processtap WHERE id = v_reg.processtap_id;
    IF NEW.veld_id IS NOT NULL THEN
        SELECT 'veld ' || v.code, CASE WHEN v.gemeten_door = 'kwaliteit' THEN ARRAY['kwaliteit','beheerder'] ELSE v_rollen END
          INTO v_wat, v_rollen FROM veld v WHERE v.id = NEW.veld_id;
        SELECT w.gemeten::text INTO v_oud FROM waarde w WHERE w.id = NEW.bestaand_waarde_id;
        v_nieuw := NEW.gemeten::text;
    ELSE
        SELECT 'grondstof ' || g.code INTO v_wat FROM grondstof g WHERE g.id = NEW.grondstof_id;
        SELECT u.partij INTO v_oud FROM grondstof_gebruik u WHERE u.id = NEW.bestaand_gebruik_id;
        v_nieuw := NEW.partij;
    END IF;
    INSERT INTO melding (soort, ernst, tekst, batchnummer, lotnummer, voor_rollen, bron_id)
    VALUES ('conflict', 'let_op',
            format('%s %s, %s: twee keer ingevuld (%s en %s, door %s). Kies in het invoerscherm welke blijft.',
                   v_stap, coalesce((SELECT batchnummer FROM batch WHERE id = v_reg.batch_id),
                                    (SELECT lotnummer FROM lot WHERE id = v_reg.lot_id)),
                   v_wat, v_oud, v_nieuw, (SELECT naam FROM operator WHERE id = NEW.ingevoerd_door)),
            (SELECT batchnummer FROM batch WHERE id = v_reg.batch_id),
            (SELECT lotnummer FROM lot WHERE id = v_reg.lot_id),
            v_rollen, NEW.id);
    RETURN NEW;
END $$;
CREATE TRIGGER invoerconflict_melding AFTER INSERT ON invoerconflict
    FOR EACH ROW EXECUTE FUNCTION meld_invoerconflict();

-- Tweede invoer van een veld dat al is ingevuld. Geeft 'zelfde' (dezelfde waarde: niets te doen) of 'conflict'.
CREATE FUNCTION leg_invoerconflict_vast(p_registratie uuid, p_veld uuid, p_setting numeric, p_gemeten numeric,
                                        p_operator uuid, p_pc uuid, p_invoer_id uuid DEFAULT NULL) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
    v_w waarde%ROWTYPE;
BEGIN
    SELECT * INTO v_w FROM waarde_actueel WHERE stapregistratie_id = p_registratie AND veld_id = p_veld;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Dit veld is nog niet ingevuld';
    END IF;
    IF v_w.gemeten = p_gemeten AND v_w.setting IS NOT DISTINCT FROM p_setting THEN
        RETURN 'zelfde';
    END IF;
    INSERT INTO invoerconflict (invoer_id, stapregistratie_id, veld_id, bestaand_waarde_id, setting, gemeten,
                                ingevoerd_door, pc_id, ingevoerd_op)
    VALUES (p_invoer_id, p_registratie, p_veld, v_w.id, p_setting, p_gemeten, p_operator,
            (SELECT id FROM pc WHERE id = p_pc), apparaat_moment())
    ON CONFLICT (invoer_id) DO NOTHING;
    RETURN 'conflict';
END $$;

-- Hetzelfde voor een grondstof: een andere partij of hoeveelheid is een conflict.
CREATE FUNCTION leg_grondstofconflict_vast(p_registratie uuid, p_grondstof uuid, p_partij text, p_hoeveelheid numeric,
                                           p_operator uuid, p_pc uuid, p_invoer_id uuid DEFAULT NULL) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
    v_u grondstof_gebruik%ROWTYPE;
BEGIN
    SELECT * INTO v_u FROM grondstof_gebruik_actueel WHERE stapregistratie_id = p_registratie AND grondstof_id = p_grondstof;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Deze grondstof is nog niet ingevuld';
    END IF;
    IF lower(btrim(v_u.partij)) = lower(btrim(p_partij)) AND v_u.hoeveelheid IS NOT DISTINCT FROM p_hoeveelheid THEN
        RETURN 'zelfde';
    END IF;
    INSERT INTO invoerconflict (invoer_id, stapregistratie_id, grondstof_id, bestaand_gebruik_id, partij, hoeveelheid,
                                ingevoerd_door, pc_id, ingevoerd_op)
    VALUES (p_invoer_id, p_registratie, p_grondstof, v_u.id, btrim(p_partij), p_hoeveelheid, p_operator,
            (SELECT id FROM pc WHERE id = p_pc), apparaat_moment())
    ON CONFLICT (invoer_id) DO NOTHING;
    RETURN 'conflict';
END $$;

-- Oplossen: 'bestaand' laat staan wat er staat, 'nieuw' zet de tweede invoer als correctie (het origineel blijft
-- bewaard). Ploegleider of beheerder; bij een veld dat Kwaliteit meet Kwaliteit of de beheerder.
CREATE FUNCTION los_invoerconflict_op(p_conflict uuid, p_keuze text, p_door uuid, p_reden text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_c     invoerconflict%ROWTYPE;
    v_rol   text;
    v_kw    boolean := false;
    v_naam  text;
    v_door  text;
    v_reden text;
BEGIN
    IF p_keuze NOT IN ('bestaand', 'nieuw') THEN
        RAISE EXCEPTION 'Kies bestaand of nieuw';
    END IF;
    SELECT * INTO v_c FROM invoerconflict WHERE id = p_conflict FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Dit conflict bestaat niet'; END IF;
    IF v_c.status = p_keuze THEN RETURN; END IF;   -- opnieuw verstuurd
    IF v_c.status <> 'open' THEN
        SELECT gebruikersnaam INTO v_door FROM gebruiker WHERE id = v_c.opgelost_door;
        RAISE EXCEPTION 'Dit conflict is al opgelost door %', v_door;
    END IF;
    IF v_c.veld_id IS NOT NULL THEN
        v_kw := (SELECT gemeten_door = 'kwaliteit' FROM veld WHERE id = v_c.veld_id);
    END IF;
    SELECT rol INTO v_rol FROM gebruiker WHERE id = p_door AND actief;
    IF v_rol IS NULL OR NOT (v_rol = 'beheerder' OR v_rol = CASE WHEN v_kw THEN 'kwaliteit' ELSE 'ploegleider' END) THEN
        RAISE EXCEPTION '%', CASE WHEN v_kw THEN 'Alleen Kwaliteit of de beheerder lost dit conflict op'
                                ELSE 'Alleen een ploegleider of de beheerder lost dit conflict op' END;
    END IF;
    IF p_keuze = 'nieuw' THEN
        SELECT naam INTO v_naam FROM operator WHERE id = v_c.ingevoerd_door;
        v_reden := 'Twee keer ingevuld, gekozen voor de invoer van ' || v_naam
                   || coalesce(': ' || nullif(btrim(p_reden), ''), '');
        IF v_c.veld_id IS NOT NULL THEN
            PERFORM set_config('fabriek.conflict', 'aan', true);
            INSERT INTO waarde (stapregistratie_id, veld_id, setting, gemeten, vervangt_waarde_id, correctie_reden, gecorrigeerd_door)
            SELECT v_c.stapregistratie_id, v_c.veld_id, v_c.setting, v_c.gemeten, w.id, v_reden, p_door
              FROM waarde_actueel w WHERE w.stapregistratie_id = v_c.stapregistratie_id AND w.veld_id = v_c.veld_id;
            PERFORM set_config('fabriek.conflict', 'uit', true);
        ELSE
            INSERT INTO grondstof_gebruik (stapregistratie_id, grondstof_id, partij, hoeveelheid, vervangt_id, correctie_reden, gecorrigeerd_door)
            SELECT v_c.stapregistratie_id, v_c.grondstof_id, v_c.partij, v_c.hoeveelheid, u.id, v_reden, p_door
              FROM grondstof_gebruik_actueel u WHERE u.stapregistratie_id = v_c.stapregistratie_id AND u.grondstof_id = v_c.grondstof_id;
        END IF;
    END IF;
    UPDATE invoerconflict SET status = p_keuze, opgelost_door = p_door, opgelost_op = now(),
                              reden = left(nullif(btrim(p_reden), ''), 500)
     WHERE id = p_conflict;
END $$;

-- Een conflict wordt alleen opgelost, verder niet gewijzigd of verwijderd.
CREATE FUNCTION invoerconflict_vast() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' OR OLD.status <> 'open' OR NEW.id <> OLD.id OR NEW.stapregistratie_id <> OLD.stapregistratie_id
       OR NEW.gemeten IS DISTINCT FROM OLD.gemeten OR NEW.setting IS DISTINCT FROM OLD.setting
       OR NEW.partij IS DISTINCT FROM OLD.partij OR NEW.hoeveelheid IS DISTINCT FROM OLD.hoeveelheid
       OR NEW.ingevoerd_door <> OLD.ingevoerd_door THEN
        RAISE EXCEPTION 'Een conflict wordt alleen opgelost, niet gewijzigd';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER invoerconflict_vast BEFORE UPDATE OR DELETE ON invoerconflict
    FOR EACH ROW EXECUTE FUNCTION invoerconflict_vast();

-- Dit schema staat gelijk aan alle migraties hieronder (bij een nieuwe migratie een regel toevoegen).
INSERT INTO schema_versie (nummer, naam) VALUES (1, 'basis'), (2, 'onderhoud'), (3, 'planning'), (4, 'wandscherm'), (5, 'grondstoffen'), (6, 'ploegoverdracht'), (7, 'meldingen'), (8, 'stilstand'), (9, 'capaciteit'), (10, 'certificaat'), (11, 'apparaattijd'), (12, 'tijdzone'), (13, 'inloggen'), (14, 'opruimen'), (15, 'decimalen'), (16, 'planningvolgorde'), (17, 'eigen_inlog'), (18, 'route_per_product'), (19, 'grenzen_per_product'), (20, 'capaciteit_per_stap'), (21, 'herbewerking'), (22, 'keuring'), (23, 'afgerond_door'), (24, 'nalevering'), (25, 'tijdelijk_wachtwoord'), (26, 'iets_melden'), (27, 'stilstand_notitie'), (28, 'pilotoverzicht'), (29, 'capaciteit_afwijking'), (30, 'capaciteit_route'), (31, 'keuringsstap'), (32, 'invoerconflict'), (33, 'ploegrooster'), (34, 'medewerker_ploeg'), (35, 'capaciteit_kg'), (36, 'routeversies'), (37, 'lotgrootte_per_product');

-- ---------------------------------------------------------------------
-- Elke functie werkt in schema fabriek, ongeacht de instelling van wie hem aanroept.
-- ---------------------------------------------------------------------
DO $$
DECLARE f record;
BEGIN
    FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'fabriek' LOOP
        EXECUTE format('ALTER FUNCTION %s SET search_path = fabriek, public', f.sig);
    END LOOP;
END $$;

COMMIT;
