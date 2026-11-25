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
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lotnummer      text NOT NULL UNIQUE CHECK (lotnummer ~ '^L-[0-9]{4}-[0-9]{4}$'),
    status         text NOT NULL DEFAULT 'in_productie' CHECK (status IN ('in_productie','gereed','geblokkeerd')),
    aangemaakt_op  timestamptz NOT NULL DEFAULT now()
);

-- Producten (configuratie, door de planner beheerd; sinds migratie 0003)
CREATE TABLE product (
    id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code    text NOT NULL UNIQUE CHECK (code ~ '^[A-Za-z0-9._-]{1,20}$'),
    naam    text NOT NULL,
    actief  boolean NOT NULL DEFAULT true
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
    IF (SELECT count(DISTINCT b.product_id) + max(CASE WHEN b.product_id IS NULL THEN 1 ELSE 0 END)
          FROM lot_voorstel_batch x JOIN batch b ON b.id = x.batch_id WHERE x.voorstel_id = p_voorstel) > 1 THEN
        RAISE EXCEPTION 'Een lotvoorstel bestaat uit batches van hetzelfde product';
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
-- later mogelijk per batch); een lot weegt 4 batches. De capaciteit per stap staat in kg per dag; per uur en per
-- maand worden ervan afgeleid met de uren van de diensten en het gemiddelde aantal dagen in een maand.
ALTER TABLE product ADD COLUMN batchgewicht_kg numeric CHECK (batchgewicht_kg > 0 AND batchgewicht_kg <= 100000);
ALTER TABLE capaciteit_stap ADD COLUMN kg_per_dag numeric CHECK (kg_per_dag > 0 AND kg_per_dag <= 100000000);
ALTER TABLE capaciteit_stap ALTER COLUMN max_per_dag DROP NOT NULL;
ALTER TABLE capaciteit_stap ADD CONSTRAINT capaciteit_stap_ingevuld CHECK (kg_per_dag IS NOT NULL OR max_per_dag IS NOT NULL);

-- Gewicht van één item in een stap: een batch, of een lot (4 batches). NULL = gewicht nog niet ingevuld.
CREATE FUNCTION gewicht_per_item(p_product uuid, p_stap uuid) RETURNS numeric LANGUAGE sql STABLE AS $$
    SELECT p.batchgewicht_kg * CASE WHEN s.niveau = 'lot' THEN 4 ELSE 1 END
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
    -- het product (een lot = 4 batches). Minstens 1; NULL als het gewicht nog niet is ingevuld. Een oude
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

-- Migratie 0036: uitbreidingsmodel autorisaties en kwalificaties (D89 P01–P05, M08).
-- Nog geen omschakeling van bestaande routes en geen automatische nieuwe rechten.
SET search_path = fabriek, public;

-- MES-rollen met gescheiden verantwoordelijkheidsdomeinen.
CREATE TABLE authorization_role (
    code text PRIMARY KEY CHECK (btrim(code) <> ''),
    domain text NOT NULL CHECK (domain IN ('technical','security','operations','quality','engineering','maintenance','analysis','display'))
);

-- Concrete bevoegdheden binnen een domein.
CREATE TABLE authorization_permission (
    code text PRIMARY KEY CHECK (btrim(code) <> ''),
    domain text NOT NULL CHECK (domain IN ('technical','security','operations','quality','engineering','maintenance','analysis','display'))
);

-- Koppeling tussen rollen en concrete bevoegdheden.
CREATE TABLE authorization_role_permission (
    role_code text REFERENCES authorization_role(code),
    permission_code text REFERENCES authorization_permission(code),
    PRIMARY KEY (role_code, permission_code)
);

-- Persoonlijke roltoekenning met geldigheid en begrensde scope.
CREATE TABLE authorization_grant (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES gebruiker(id),
    role_code text NOT NULL REFERENCES authorization_role(code),
    area_code text CHECK (btrim(area_code) <> ''),
    product_id uuid REFERENCES product(id),
    equipment_code text CHECK (btrim(equipment_code) <> ''),
    valid_from timestamptz NOT NULL DEFAULT now(),
    valid_until timestamptz CHECK (valid_until > valid_from),
    revoked_at timestamptz
);

-- Definitie van een personeelskwalificatie.
CREATE TABLE qualification (
    code text PRIMARY KEY CHECK (btrim(code) <> ''),
    description text NOT NULL CHECK (btrim(description) <> '')
);

-- Persoonlijke kwalificatie met geldigheid en intrekking.
CREATE TABLE personnel_qualification (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES gebruiker(id),
    qualification_code text NOT NULL REFERENCES qualification(code),
    valid_from timestamptz NOT NULL DEFAULT now(),
    valid_until timestamptz CHECK (valid_until > valid_from),
    revoked_at timestamptz
);

-- Verplichte kwalificatie voor een concrete activiteit.
CREATE TABLE activity_qualification (
    permission_code text REFERENCES authorization_permission(code),
    qualification_code text REFERENCES qualification(code),
    PRIMARY KEY (permission_code, qualification_code)
);

-- Momentopname van de oude rol bij migratie, zonder extra rechten.
CREATE TABLE authorization_legacy_snapshot (
    user_id uuid PRIMARY KEY REFERENCES gebruiker(id),
    legacy_role text NOT NULL,
    captured_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO authorization_legacy_snapshot (user_id, legacy_role)
SELECT id, rol FROM gebruiker;

CREATE INDEX authorization_grant_user ON authorization_grant(user_id);
CREATE INDEX personnel_qualification_user ON personnel_qualification(user_id);

-- Alleen vertrouwde servercontext; NULL is geen match voor een begrensde scope.
-- Dezelfde grant moet de permission en alle scopevoorwaarden bevatten.
CREATE FUNCTION authorization_permits(p_user uuid, p_permission text, p_area text, p_product uuid, p_equipment text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = fabriek, public AS $$
    WITH grants AS (
      SELECT g.*, r.domain FROM authorization_grant g JOIN authorization_role r ON r.code = g.role_code
       WHERE g.user_id = p_user AND g.valid_from <= now()
         AND (g.valid_until IS NULL OR now() < g.valid_until) AND g.revoked_at IS NULL
    )
    SELECT EXISTS (SELECT 1 FROM gebruiker WHERE id = p_user AND actief AND NOT gedeeld AND NOT wachtwoord_wijzigen)
       AND NOT (EXISTS (SELECT 1 FROM grants WHERE domain IN ('technical','security'))
                AND EXISTS (SELECT 1 FROM grants WHERE domain NOT IN ('technical','security')))
       AND NOT (EXISTS (SELECT 1 FROM grants WHERE domain = 'display')
                AND EXISTS (SELECT 1 FROM grants WHERE domain <> 'display'))
       AND EXISTS (
         SELECT 1 FROM grants g JOIN authorization_role_permission rp ON rp.role_code = g.role_code
         JOIN authorization_permission p ON p.code = rp.permission_code AND p.domain = g.domain
         WHERE p.code = p_permission
           AND (g.area_code IS NULL OR g.area_code = p_area)
           AND (g.product_id IS NULL OR g.product_id = p_product)
           AND (g.equipment_code IS NULL OR g.equipment_code = p_equipment))
       AND NOT EXISTS (
         SELECT 1 FROM activity_qualification aq WHERE aq.permission_code = p_permission
           AND NOT EXISTS (SELECT 1 FROM personnel_qualification q WHERE q.user_id = p_user
             AND q.qualification_code = aq.qualification_code AND q.valid_from <= now()
             AND (q.valid_until IS NULL OR now() < q.valid_until) AND q.revoked_at IS NULL))
$$;

-- D93/D94: geen gedeelde login en geen overdracht van invoerrechten via eerdere login.
SET search_path = fabriek, public;
CREATE OR REPLACE FUNCTION mag_invoeren_namens(p_gebruiker uuid, p_operator uuid, p_pc uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = fabriek, public AS $$
    SELECT EXISTS (SELECT 1 FROM operator o JOIN gebruiker g ON g.id = o.gebruiker_id
      JOIN pc ON pc.id = p_pc AND pc.actief
      WHERE o.id = p_operator AND o.actief AND g.id = p_gebruiker
        AND g.actief AND NOT g.gedeeld AND NOT g.wachtwoord_wijzigen)
$$;

-- Migratie 0038: onafhankelijke beoordeling van roltoekenning (D89 P01-P05).
-- Uitbreidingsfase: uitsluitend database-eigenaar; geen toegang voor de applicatie.
SET search_path = fabriek, public;

-- Vastgelegde aanvraag met exacte inhoud en onafhankelijke beoordelaar.
CREATE TABLE authorization_request (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    requested_by uuid NOT NULL REFERENCES gebruiker(id),
    user_id uuid NOT NULL REFERENCES gebruiker(id),
    role_code text NOT NULL REFERENCES authorization_role(code),
    area_code text CHECK (btrim(area_code) <> ''),
    product_id uuid REFERENCES product(id),
    equipment_code text CHECK (btrim(equipment_code) <> ''),
    valid_from timestamptz NOT NULL,
    valid_until timestamptz CHECK (valid_until > valid_from),
    reason text NOT NULL CHECK (btrim(reason) <> ''),
    requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (requested_by <> user_id)
);

-- Een besluit per aanvraag; inhoud blijft in de oorspronkelijke aanvraag.
CREATE TABLE authorization_decision (
    request_id uuid PRIMARY KEY REFERENCES authorization_request(id),
    decided_by uuid NOT NULL REFERENCES gebruiker(id),
    approved boolean NOT NULL,
    reason text NOT NULL CHECK (btrim(reason) <> ''),
    decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    grant_id uuid UNIQUE REFERENCES authorization_grant(id),
    CHECK (approved = (grant_id IS NOT NULL))
);

-- Deze technische permissies worden niet automatisch aan bestaande accounts toegekend.
INSERT INTO authorization_permission (code, domain)
VALUES ('authorization.request','security'), ('authorization.approve','security');

-- De eigenaar moet deze functies via een gecontroleerd kanaal aanroepen.
-- Geen SECURITY DEFINER en geen vertrouwen in een vrij opgegeven actor vanuit de app.
CREATE FUNCTION authorization_submit(p_actor uuid, p_user uuid, p_role text,
    p_area text, p_product uuid, p_equipment text, p_from timestamptz,
    p_until timestamptz, p_reason text) RETURNS uuid
LANGUAGE plpgsql SET search_path = fabriek, public AS $$
DECLARE v_id uuid;
BEGIN
    IF p_actor IS NULL OR p_user IS NULL OR p_actor = p_user OR
       NOT authorization_permits(p_actor,'authorization.request',NULL,NULL,NULL) THEN
        RAISE EXCEPTION 'Geen bevoegdheid voor aanvraag';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM gebruiker WHERE id=p_user AND actief AND NOT gedeeld) THEN
        RAISE EXCEPTION 'Ongeldig persoonlijk doelaccount';
    END IF;
    IF p_until IS NOT NULL AND p_until <= clock_timestamp() THEN
        RAISE EXCEPTION 'Geldigheid is verlopen';
    END IF;
    INSERT INTO authorization_request (requested_by,user_id,role_code,area_code,product_id,equipment_code,valid_from,valid_until,reason)
    VALUES (p_actor,p_user,p_role,p_area,p_product,p_equipment,p_from,p_until,p_reason)
    RETURNING id INTO v_id;
    RETURN v_id;
END $$;

CREATE FUNCTION authorization_decide(p_actor uuid, p_request uuid, p_approved boolean, p_reason text)
RETURNS uuid LANGUAGE plpgsql SET search_path = fabriek, public AS $$
DECLARE v authorization_request%ROWTYPE; v_grant uuid; v_domain text;
BEGIN
    -- Serialiseer besluiten voor hetzelfde doelaccount, ook uit verschillende aanvragen.
    SELECT * INTO v FROM authorization_request WHERE id=p_request FOR UPDATE;
    IF NOT FOUND OR p_actor IS NULL OR p_approved IS NULL OR
       p_actor = v.requested_by OR p_actor = v.user_id OR
       NOT authorization_permits(p_actor,'authorization.approve',NULL,NULL,NULL) THEN
        RAISE EXCEPTION 'Onafhankelijke bevoegde beoordelaar vereist';
    END IF;
    IF EXISTS (SELECT 1 FROM authorization_decision WHERE request_id=p_request) THEN
        RAISE EXCEPTION 'Aanvraag is al beoordeeld';
    END IF;
    PERFORM 1 FROM gebruiker WHERE id=v.user_id FOR UPDATE;
    IF p_approved THEN
        IF NOT authorization_permits(v.requested_by,'authorization.request',NULL,NULL,NULL) THEN
            RAISE EXCEPTION 'Aanvrager is niet meer bevoegd';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM gebruiker WHERE id=v.user_id AND actief AND NOT gedeeld) THEN
            RAISE EXCEPTION 'Ongeldig persoonlijk doelaccount';
        END IF;
        IF v.valid_until IS NOT NULL AND v.valid_until <= clock_timestamp() THEN
            RAISE EXCEPTION 'Geldigheid is verlopen';
        END IF;
        SELECT domain INTO v_domain FROM authorization_role WHERE code=v.role_code;
        IF EXISTS (
            SELECT 1 FROM authorization_grant g JOIN authorization_role r ON r.code=g.role_code
            WHERE g.user_id=v.user_id AND g.revoked_at IS NULL
              AND tstzrange(g.valid_from,g.valid_until,'[)') && tstzrange(v.valid_from,v.valid_until,'[)')
              AND ((r.domain IN ('technical','security')) <> (v_domain IN ('technical','security'))
                OR (r.domain='display') <> (v_domain='display'))
        ) THEN RAISE EXCEPTION 'Functiescheiding verhindert toekenning'; END IF;
        INSERT INTO authorization_grant (user_id,role_code,area_code,product_id,equipment_code,valid_from,valid_until)
        VALUES (v.user_id,v.role_code,v.area_code,v.product_id,v.equipment_code,v.valid_from,v.valid_until)
        RETURNING id INTO v_grant;
    END IF;
    INSERT INTO authorization_decision (request_id,decided_by,approved,reason,grant_id)
    VALUES (v.id,p_actor,p_approved,p_reason,v_grant);
    RETURN v_grant;
END $$;

REVOKE ALL ON authorization_request, authorization_decision FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION authorization_submit(uuid,uuid,text,text,uuid,text,timestamptz,timestamptz,text),
    authorization_decide(uuid,uuid,boolean,text) FROM PUBLIC;

-- Migratie 0039: bescherming van security-identiteiten en besluitgebonden herbevestiging.
SET search_path = fabriek, public;

-- Ook toekomstige en verlopen, niet-ingetrokken security-grants beschermen:
-- herstel van een kritisch account vereist een afzonderlijk gecontroleerd kanaal.
CREATE FUNCTION authorization_protect_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = fabriek, public AS $$
BEGIN
    IF (EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('mes_app','batchgui_app')
                    AND pg_has_role(current_user, oid, 'MEMBER')))
       AND EXISTS (
           SELECT 1 FROM authorization_grant g JOIN authorization_role r ON r.code=g.role_code
           WHERE g.user_id=OLD.id AND g.revoked_at IS NULL AND r.domain='security')
       AND (NEW.wachtwoord_hash IS DISTINCT FROM OLD.wachtwoord_hash
         OR NEW.wachtwoord_wijzigen IS DISTINCT FROM OLD.wachtwoord_wijzigen
         OR NEW.rol IS DISTINCT FROM OLD.rol
         OR NEW.gebruikersnaam IS DISTINCT FROM OLD.gebruikersnaam
         OR NEW.gedeeld IS DISTINCT FROM OLD.gedeeld
         OR NEW.actief IS DISTINCT FROM OLD.actief) THEN
        RAISE EXCEPTION 'Kritisch account vereist gecontroleerd identiteitsbeheer';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER authorization_protect_identity BEFORE UPDATE ON gebruiker
    FOR EACH ROW EXECUTE FUNCTION authorization_protect_identity();

-- Een persoonlijke herbevestiging en het specifieke besluit in dezelfde aanroep.
-- Nog eigenaar-only. Een fout wachtwoord retourneert een status in plaats van
-- een exception, zodat de inlogpoging bij COMMIT behouden blijft.
CREATE FUNCTION authorization_decide_confirmed(p_actor uuid, p_request uuid,
    p_approved boolean, p_reason text, p_password text)
RETURNS TABLE (status text, grant_id uuid)
LANGUAGE plpgsql SET search_path = fabriek, public AS $$
DECLARE v_name text; v_login record; v_grant uuid;
BEGIN
    SELECT gebruikersnaam INTO v_name FROM gebruiker
      WHERE id=p_actor AND actief AND NOT gedeeld AND NOT wachtwoord_wijzigen
      FOR UPDATE;
    IF NOT FOUND THEN RETURN QUERY SELECT 'denied'::text, NULL::uuid; RETURN; END IF;
    SELECT * INTO v_login FROM inloggen(v_name,p_password,NULL);
    IF v_login.wacht_seconden IS NOT NULL THEN
        RETURN QUERY SELECT 'locked'::text, NULL::uuid; RETURN;
    END IF;
    IF v_login.id IS DISTINCT FROM p_actor THEN
        RETURN QUERY SELECT 'denied'::text, NULL::uuid; RETURN;
    END IF;
    v_grant := authorization_decide(p_actor,p_request,p_approved,p_reason);
    RETURN QUERY SELECT 'decided'::text, v_grant;
END $$;
REVOKE EXECUTE ON FUNCTION authorization_decide_confirmed(uuid,uuid,boolean,text,text) FROM PUBLIC;

-- Migratie 0040: afscherming wachtwoordhashes en gecontroleerde accountwijziging.
SET search_path = fabriek, public;

-- Alleen bestaande loginfuncties mogen hashes intern lezen.
ALTER FUNCTION inloggen(text,text,text) SECURITY DEFINER;
ALTER FUNCTION inloggen(text,text,text) SET search_path = pg_catalog,fabriek,public;
ALTER FUNCTION wijzig_eigen_wachtwoord(uuid,text,text) SECURITY DEFINER;
ALTER FUNCTION wijzig_eigen_wachtwoord(uuid,text,text) SET search_path = pg_catalog,fabriek,public;
-- Eigen wachtwoord wijzigen blijft mogelijk met het huidige wachtwoord; de
-- eigenaar-only triggerbescherming van 0039 blijft gelden voor directe resets.
REVOKE EXECUTE ON FUNCTION inloggen(text,text,text), wijzig_eigen_wachtwoord(uuid,text,text) FROM PUBLIC;

-- Alleen de demo-indicatie, nooit de hash. Beperkt tot expliciete demoaccounts.
CREATE FUNCTION demo_account_names(p_names text[]) RETURNS TABLE(gebruikersnaam text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog,fabriek,public AS $$
    SELECT g.gebruikersnaam FROM fabriek.gebruiker g
      WHERE g.actief AND NOT g.gedeeld AND lower(g.gebruikersnaam)=ANY(p_names)
        AND lower(g.gebruikersnaam) IN ('operator.a','operator.b','operator.c','operator.d','ploegleider1','kwaliteit1','planner1','beheerder1','analist1','scherm1')
        AND g.wachtwoord_hash=public.crypt('demo',g.wachtwoord_hash)
      ORDER BY g.gebruikersnaam
$$;
REVOKE EXECUTE ON FUNCTION demo_account_names(text[]) FROM PUBLIC;

-- Vervang de oude updatequery (die de hash moest lezen) door twee varianten
-- in de API: zonder wachtwoordwijziging en met een expliciete nieuwe hash.
-- Rechten worden bij iedere migratie opnieuw afgedwongen in rechten.sql.

-- Migratie 0041: gecontroleerde intrekking en auditspoor van bevoegdheden.
SET search_path = fabriek, public;

INSERT INTO authorization_permission(code,domain) VALUES ('authorization.revoke','security');

-- Een intrekking bewaart de grant en de identiteit en motivatie van de beslisser.
CREATE TABLE authorization_revocation (
    grant_id uuid PRIMARY KEY REFERENCES authorization_grant(id),
    revoked_by uuid NOT NULL REFERENCES gebruiker(id),
    reason text NOT NULL CHECK (btrim(reason) <> ''),
    revoked_at timestamptz NOT NULL
);

-- Intrekking is een beperkende maatregel, geen toekenning. Geen zelfintrekking
-- via dit kanaal; bevoegde collega bevestigt de exacte grant en reden.
-- Eigenaar-only tot het beveiligde beheerkanaal en de tests gereed zijn.
CREATE FUNCTION authorization_revoke_confirmed(p_actor uuid,p_grant uuid,p_reason text,p_password text)
RETURNS text LANGUAGE plpgsql SET search_path = pg_catalog,fabriek,public,pg_temp AS $$
DECLARE v_name text; v_login record; v_target uuid; v_revoked timestamptz; v_now timestamptz;
BEGIN
    IF p_actor IS NULL OR NOT authorization_permits(p_actor,'authorization.revoke',NULL,NULL,NULL) THEN
        RAISE EXCEPTION 'Geen bevoegdheid voor intrekking';
    END IF;
    SELECT gebruikersnaam INTO v_name FROM gebruiker
        WHERE id=p_actor AND actief AND NOT gedeeld AND NOT wachtwoord_wijzigen FOR UPDATE;
    IF NOT FOUND THEN RETURN 'denied'; END IF;
    SELECT * INTO v_login FROM inloggen(v_name,p_password,NULL);
    IF v_login.wacht_seconden IS NOT NULL THEN RETURN 'locked'; END IF;
    IF v_login.id IS DISTINCT FROM p_actor THEN RETURN 'denied'; END IF;
    SELECT user_id INTO v_target FROM authorization_grant WHERE id=p_grant;
    IF NOT FOUND OR v_target=p_actor THEN RAISE EXCEPTION 'Onafhankelijke intrekking vereist'; END IF;
    PERFORM 1 FROM gebruiker WHERE id=v_target FOR UPDATE;
    SELECT revoked_at INTO v_revoked FROM authorization_grant WHERE id=p_grant FOR UPDATE;
    IF v_revoked IS NOT NULL THEN RAISE EXCEPTION 'Bevoegdheid is al ingetrokken'; END IF;
    IF NOT authorization_permits(p_actor,'authorization.revoke',NULL,NULL,NULL) THEN
        RAISE EXCEPTION 'Beoordelaar is niet meer bevoegd';
    END IF;
    v_now := clock_timestamp();
    UPDATE authorization_grant SET revoked_at=v_now WHERE id=p_grant;
    INSERT INTO authorization_revocation(grant_id,revoked_by,reason,revoked_at)
    VALUES(p_grant,p_actor,p_reason,v_now);
    RETURN 'revoked';
END $$;

-- Onveranderlijke besluitregistraties; ook onderhoud kan ze niet per ongeluk wijzigen.
CREATE FUNCTION authorization_audit_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog,fabriek,pg_temp AS $$
BEGIN
    RAISE EXCEPTION 'Autorisatiebesluiten zijn onveranderlijk';
END $$;
CREATE TRIGGER authorization_request_immutable BEFORE UPDATE OR DELETE ON authorization_request
    FOR EACH ROW EXECUTE FUNCTION authorization_audit_immutable();
CREATE TRIGGER authorization_decision_immutable BEFORE UPDATE OR DELETE ON authorization_decision
    FOR EACH ROW EXECUTE FUNCTION authorization_audit_immutable();
CREATE TRIGGER authorization_revocation_immutable BEFORE UPDATE OR DELETE ON authorization_revocation
    FOR EACH ROW EXECUTE FUNCTION authorization_audit_immutable();
REVOKE ALL ON authorization_revocation FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION authorization_revoke_confirmed(uuid,uuid,text,text),authorization_audit_immutable() FROM PUBLIC;

-- Migratie 0042: operatoridentiteit zonder wachtwoordhash.
SET search_path = fabriek, public;
CREATE OR REPLACE FUNCTION operator_van_account(p_gebruiker uuid) RETURNS uuid LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    v_g     record;
    v_id    uuid;
    v_naam  text;
    v_n     int := 1;
BEGIN
    SELECT gebruikersnaam, gedeeld, rol INTO v_g FROM gebruiker WHERE id = p_gebruiker AND actief;
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
ALTER FUNCTION operator_van_account(uuid) SET search_path = fabriek, public;

-- Migratie 0043: MES-rollenregister (D89 P01–P05).
-- Alleen definities, geen automatische grants aan bestaande gebruikers.
SET search_path = fabriek, public;
INSERT INTO authorization_role(code,domain) VALUES
 ('operator','operations'),
 ('shift_supervisor','operations'),
 ('manufacturing_manager','operations'),
 ('production_planner','operations'),
 ('process_engineer','engineering'),
 ('engineering_approver','engineering'),
 ('quality_technician','quality'),
 ('quality_approver','quality'),
 ('maintenance_technician','maintenance'),
 ('system_administrator','technical'),
 ('security_administrator','security'),
 ('analyst_management','analysis'),
 ('display_integration','display');

-- Eerste concrete rechten voor het security-domein. De operationele matrix
-- wordt per activiteit geïmplementeerd; geen impliciete rechten uit rolnamen.
INSERT INTO authorization_role_permission(role_code,permission_code) VALUES
 ('security_administrator','authorization.request'),
 ('security_administrator','authorization.approve'),
 ('security_administrator','authorization.revoke');

-- Migratie 0044: concrete beheertoegang; geen automatische grantmigratie.
SET search_path = fabriek, public;

INSERT INTO authorization_permission(code,domain) VALUES
 ('account.read','technical'),
 ('account.manage','technical'),
 ('workstation.manage','technical'),
 ('system.read','technical'),
 ('process.parameter.manage','engineering'),
 ('material.definition.manage','engineering'),
 ('authorization.read','security');

INSERT INTO authorization_role_permission(role_code,permission_code) VALUES
 ('system_administrator','account.read'),
 ('system_administrator','account.manage'),
 ('system_administrator','workstation.manage'),
 ('system_administrator','system.read'),
 ('process_engineer','process.parameter.manage'),
 ('process_engineer','material.definition.manage'),
 ('security_administrator','authorization.read');

-- Migratie 0045: productgebonden uitvoering en correcties.
SET search_path = fabriek, public;
INSERT INTO authorization_permission(code,domain) VALUES
 ('execution.start','operations'), ('execution.record','operations'),
 ('execution.complete','operations'), ('execution.correct','operations'),
 ('inspection.start','quality'), ('inspection.record','quality');
INSERT INTO authorization_role_permission(role_code,permission_code) VALUES
 ('operator','execution.start'), ('operator','execution.record'), ('operator','execution.complete'),
 ('shift_supervisor','execution.start'), ('shift_supervisor','execution.record'),
 ('shift_supervisor','execution.complete'), ('shift_supervisor','execution.correct'),
 ('quality_technician','inspection.start'), ('quality_technician','inspection.record'),
 ('quality_approver','inspection.start'), ('quality_approver','inspection.record');

-- Migratie 0046: afzonderlijke leesrechten en kwaliteitsbesluit.
SET search_path = fabriek, public;
INSERT INTO authorization_permission(code,domain) VALUES
 ('execution.read','operations'), ('inspection.read','quality'),
 ('inspection.decide','quality'), ('engineering.execution.read','engineering'),
 ('analysis.execution.read','analysis');
INSERT INTO authorization_role_permission(role_code,permission_code) VALUES
 ('operator','execution.read'), ('shift_supervisor','execution.read'),
 ('manufacturing_manager','execution.read'), ('production_planner','execution.read'),
 ('quality_technician','inspection.read'), ('quality_approver','inspection.read'),
 ('quality_approver','inspection.decide'),
 ('process_engineer','engineering.execution.read'),
 ('engineering_approver','engineering.execution.read'),
 ('analyst_management','analysis.execution.read');

-- Eén concrete doelcontext, zonder de scopes van verschillende grants te combineren.
CREATE FUNCTION authorization_read_execution(p_user uuid,p_product uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = fabriek,public AS $$
 SELECT authorization_permits(p_user,'execution.read',NULL,p_product,NULL)
     OR authorization_permits(p_user,'inspection.read',NULL,p_product,NULL)
     OR authorization_permits(p_user,'engineering.execution.read',NULL,p_product,NULL)
     OR authorization_permits(p_user,'analysis.execution.read',NULL,p_product,NULL)
$$;

-- Migratie 0047: planning en productdefinities gescheiden.
SET search_path = fabriek, public;
INSERT INTO authorization_permission(code,domain) VALUES
 ('planning.manage','operations'),
 ('engineering.product.manage','engineering');
INSERT INTO authorization_role_permission(role_code,permission_code) VALUES
 ('production_planner','planning.manage'),
 ('process_engineer','engineering.product.manage');

-- Migratie 0048: operationele stilstand en overdracht.
SET search_path = fabriek, public;
INSERT INTO authorization_permission(code,domain) VALUES
 ('downtime.read','operations'),
 ('downtime.record','operations'),
 ('downtime.reason.manage','operations'),
 ('handover.read','operations'),
 ('handover.record','operations'),
 ('shift.manage','operations'),
 ('maintenance.downtime.read','maintenance'),
 ('display.downtime.read','display');
INSERT INTO authorization_role_permission(role_code,permission_code) VALUES
 ('operator','downtime.read'), ('operator','downtime.record'),
 ('operator','handover.read'), ('operator','handover.record'),
 ('shift_supervisor','downtime.read'), ('shift_supervisor','downtime.record'),
 ('shift_supervisor','handover.read'), ('shift_supervisor','handover.record'),
 ('manufacturing_manager','downtime.read'), ('manufacturing_manager','downtime.reason.manage'),
 ('manufacturing_manager','handover.read'), ('manufacturing_manager','shift.manage'),
 ('production_planner','handover.read'),
 ('maintenance_technician','maintenance.downtime.read'),
 ('display_integration','display.downtime.read');

-- Migratie 0049: batch-, lot- en herbewerkingsrechten.
SET search_path = fabriek, public;
INSERT INTO authorization_permission(code,domain) VALUES
 ('execution.batch.create','operations'), ('execution.lot.create','operations'),
 ('execution.hold','operations'), ('inspection.hold','quality'),
 ('inspection.batch.decide','quality'), ('execution.rework','operations'),
 ('inspection.rework.order','quality'), ('operations.rework.order','operations');
INSERT INTO authorization_role_permission(role_code,permission_code) VALUES
 ('operator','execution.batch.create'), ('shift_supervisor','execution.batch.create'),
 ('operator','execution.lot.create'), ('shift_supervisor','execution.lot.create'),
 ('shift_supervisor','execution.hold'), ('manufacturing_manager','execution.hold'),
 ('quality_technician','inspection.hold'), ('quality_approver','inspection.hold'),
 ('quality_approver','inspection.batch.decide'),
 ('operator','execution.rework'), ('shift_supervisor','execution.rework'),
 ('quality_approver','inspection.rework.order'), ('manufacturing_manager','operations.rework.order');

-- Een volledig lot mag alleen zichtbaar zijn wanneer alle leden binnen de
-- leesbevoegdheid vallen. Lege lots vereisen onbegrensde leesbevoegdheid.
CREATE FUNCTION authorization_read_lot(p_user uuid,p_lot uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = fabriek,public AS $$
 SELECT EXISTS (SELECT 1 FROM lot WHERE id=p_lot)
 AND CASE WHEN EXISTS (SELECT 1 FROM batch WHERE lot_id=p_lot)
 THEN NOT EXISTS (SELECT 1 FROM batch b WHERE b.lot_id=p_lot
                  AND NOT authorization_read_execution(p_user,b.product_id))
 ELSE authorization_read_execution(p_user,NULL) END
 AND NOT EXISTS (SELECT 1 FROM stapregistratie r WHERE r.lot_id=p_lot
                  AND NOT authorization_read_execution(p_user,r.product_id))
$$;

-- Migratie 0050: één begrensde wachtwoordcontrole (D94/D99).
SET search_path = fabriek, public;
CREATE OR REPLACE FUNCTION inloggen(p_naam text, p_wachtwoord text, p_pc text DEFAULT NULL)
RETURNS TABLE (id uuid, rol text, gebruikersnaam text, wacht_seconden int) LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog,fabriek,public,pg_temp AS $$
DECLARE
    v_mislukt   int;
    v_laatste   timestamptz;
    v_gebruiker gebruiker%ROWTYPE;
BEGIN
    PERFORM 1 FROM gebruiker g WHERE lower(g.gebruikersnaam)=lower(p_naam) FOR UPDATE;
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
     WHERE lower(g.gebruikersnaam) = lower(p_naam) AND g.actief AND NOT g.gedeeld
       AND g.wachtwoord_hash = public.crypt(p_wachtwoord, g.wachtwoord_hash);
    IF NOT FOUND THEN
        INSERT INTO inlogpoging (gebruikersnaam, pc, uitkomst) VALUES (left(p_naam, 100), left(p_pc, 100), 'mislukt');
        RETURN;
    END IF;
    INSERT INTO inlogpoging (gebruikersnaam, pc, uitkomst) VALUES (v_gebruiker.gebruikersnaam, left(p_pc, 100), 'gelukt');
    RETURN QUERY SELECT v_gebruiker.id, v_gebruiker.rol, v_gebruiker.gebruikersnaam, NULL::int;
END $$;

-- Foutieve authenticatie retourneert status zodat de audit bij commit behouden blijft.
CREATE FUNCTION change_password_confirmed(p_user uuid,p_current text,p_new text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,fabriek,public,pg_temp AS $$
DECLARE v_name text; v_login record;
BEGIN
    IF length(coalesce(p_new,'')) < 8 OR p_new = p_current THEN
      RAISE EXCEPTION 'Kies een ander wachtwoord van minstens 8 tekens';
    END IF;
    SELECT gebruikersnaam INTO v_name FROM gebruiker
      WHERE id=p_user AND actief AND NOT gedeeld FOR UPDATE;
    IF NOT FOUND THEN RETURN 'denied'; END IF;
    SELECT * INTO v_login FROM inloggen(v_name,p_current,NULL);
    IF v_login.wacht_seconden IS NOT NULL THEN RETURN 'locked'; END IF;
    IF v_login.id IS DISTINCT FROM p_user THEN RETURN 'denied'; END IF;
    UPDATE gebruiker SET wachtwoord_hash=wachtwoord_hash(p_new),wachtwoord_wijzigen=false WHERE id=p_user;
    RETURN 'changed';
END $$;
REVOKE EXECUTE ON FUNCTION change_password_confirmed(uuid,text,text),inloggen(text,text,text),wijzig_eigen_wachtwoord(uuid,text,text),controleer_login(text,text) FROM PUBLIC;
-- De oude controle en wachtwoordfunctie blijven alleen voor eigenaar/migratietests.

-- Migratie 0051: afzonderlijke technische en security-identiteiten (D89/D99).
SET search_path = fabriek, public;

CREATE OR REPLACE FUNCTION authorization_permits(p_user uuid, p_permission text, p_area text, p_product uuid, p_equipment text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = fabriek, public AS $$
    WITH grants AS (
      SELECT g.*, r.domain FROM authorization_grant g JOIN authorization_role r ON r.code = g.role_code
       WHERE g.user_id = p_user AND g.valid_from <= now()
         AND (g.valid_until IS NULL OR now() < g.valid_until) AND g.revoked_at IS NULL
    )
    SELECT EXISTS (SELECT 1 FROM gebruiker WHERE id = p_user AND actief AND NOT gedeeld AND NOT wachtwoord_wijzigen)
       AND NOT (EXISTS (SELECT 1 FROM grants WHERE domain IN ('technical','security'))
                AND EXISTS (SELECT 1 FROM grants WHERE domain NOT IN ('technical','security')))
       AND NOT (EXISTS (SELECT 1 FROM grants WHERE domain = 'technical')
                AND EXISTS (SELECT 1 FROM grants WHERE domain = 'security'))
       AND NOT (EXISTS (SELECT 1 FROM grants WHERE domain = 'display')
                AND EXISTS (SELECT 1 FROM grants WHERE domain <> 'display'))
       AND EXISTS (
         SELECT 1 FROM grants g JOIN authorization_role_permission rp ON rp.role_code = g.role_code
         JOIN authorization_permission p ON p.code = rp.permission_code AND p.domain = g.domain
         WHERE p.code = p_permission
           AND (g.area_code IS NULL OR g.area_code = p_area)
           AND (g.product_id IS NULL OR g.product_id = p_product)
           AND (g.equipment_code IS NULL OR g.equipment_code = p_equipment))
       AND NOT EXISTS (
         SELECT 1 FROM activity_qualification aq WHERE aq.permission_code = p_permission
           AND NOT EXISTS (SELECT 1 FROM personnel_qualification q WHERE q.user_id = p_user
             AND q.qualification_code = aq.qualification_code AND q.valid_from <= now()
             AND (q.valid_until IS NULL OR now() < q.valid_until) AND q.revoked_at IS NULL))
$$;

CREATE OR REPLACE FUNCTION authorization_decide(p_actor uuid, p_request uuid, p_approved boolean, p_reason text)
RETURNS uuid LANGUAGE plpgsql SET search_path = fabriek, public AS $$
DECLARE v authorization_request%ROWTYPE; v_grant uuid; v_domain text;
BEGIN
    -- Serialiseer besluiten voor hetzelfde doelaccount, ook uit verschillende aanvragen.
    SELECT * INTO v FROM authorization_request WHERE id=p_request FOR UPDATE;
    IF NOT FOUND OR p_actor IS NULL OR p_approved IS NULL OR
       p_actor = v.requested_by OR p_actor = v.user_id OR
       NOT authorization_permits(p_actor,'authorization.approve',NULL,NULL,NULL) THEN
        RAISE EXCEPTION 'Onafhankelijke bevoegde beoordelaar vereist';
    END IF;
    IF EXISTS (SELECT 1 FROM authorization_decision WHERE request_id=p_request) THEN
        RAISE EXCEPTION 'Aanvraag is al beoordeeld';
    END IF;
    PERFORM 1 FROM gebruiker WHERE id=v.user_id FOR UPDATE;
    IF p_approved THEN
        IF NOT authorization_permits(v.requested_by,'authorization.request',NULL,NULL,NULL) THEN
            RAISE EXCEPTION 'Aanvrager is niet meer bevoegd';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM gebruiker WHERE id=v.user_id AND actief AND NOT gedeeld) THEN
            RAISE EXCEPTION 'Ongeldig persoonlijk doelaccount';
        END IF;
        IF v.valid_until IS NOT NULL AND v.valid_until <= clock_timestamp() THEN
            RAISE EXCEPTION 'Geldigheid is verlopen';
        END IF;
        SELECT domain INTO v_domain FROM authorization_role WHERE code=v.role_code;
        IF EXISTS (
            SELECT 1 FROM authorization_grant g JOIN authorization_role r ON r.code=g.role_code
            WHERE g.user_id=v.user_id AND g.revoked_at IS NULL
              AND tstzrange(g.valid_from,g.valid_until,'[)') && tstzrange(v.valid_from,v.valid_until,'[)')
              AND ((r.domain IN ('technical','security')) <> (v_domain IN ('technical','security'))
                OR (r.domain='display') <> (v_domain='display')
                OR (r.domain IN ('technical','security') AND v_domain IN ('technical','security') AND r.domain <> v_domain))
        ) THEN RAISE EXCEPTION 'Functiescheiding verhindert toekenning'; END IF;
        INSERT INTO authorization_grant (user_id,role_code,area_code,product_id,equipment_code,valid_from,valid_until)
        VALUES (v.user_id,v.role_code,v.area_code,v.product_id,v.equipment_code,v.valid_from,v.valid_until)
        RETURNING id INTO v_grant;
    END IF;
    INSERT INTO authorization_decision (request_id,decided_by,approved,reason,grant_id)
    VALUES (v.id,p_actor,p_approved,p_reason,v_grant);
    RETURN v_grant;
END $$;

-- Migratie 0052: geen oude roltoekenning via de gewone applicatie (D99).
SET search_path = fabriek, public;

ALTER TABLE gebruiker DROP CONSTRAINT gebruiker_rol_check;
ALTER TABLE gebruiker ADD CONSTRAINT gebruiker_rol_check
    CHECK (rol IN ('pending','operator','ploegleider','kwaliteit','beheerder','analist','planner','scherm','productiemanager'));

CREATE FUNCTION authorization_guard_legacy_role() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog,fabriek,pg_temp AS $$
BEGIN
    IF NOT (current_user = pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID))) AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('mes_app','batchgui_app')
               AND pg_has_role(current_user,oid,'MEMBER')) THEN
        IF TG_OP = 'INSERT' THEN
            IF NEW.rol <> 'pending' OR NEW.gedeeld OR NOT NEW.wachtwoord_wijzigen THEN
                RAISE EXCEPTION 'Nieuw account vereist gecontroleerde roltoekenning';
            END IF;
        ELSE
            IF NEW.rol IS DISTINCT FROM OLD.rol OR NEW.gedeeld IS DISTINCT FROM OLD.gedeeld
               OR NEW.id IS DISTINCT FROM OLD.id THEN
                RAISE EXCEPTION 'Oude rol of identiteit mag niet rechtstreeks wijzigen';
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER authorization_guard_legacy_role BEFORE INSERT OR UPDATE ON gebruiker
    FOR EACH ROW EXECUTE FUNCTION authorization_guard_legacy_role();
REVOKE EXECUTE ON FUNCTION authorization_guard_legacy_role() FROM PUBLIC;

-- Migratie 0053: bescherm alle bevoegde identiteiten tegen gewone accountresets.
SET search_path = fabriek, public;

CREATE OR REPLACE FUNCTION authorization_protect_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog,fabriek,pg_temp AS $$
BEGIN
    -- Alleen de vertrouwde eigenaar (inclusief gecontroleerde SECURITY DEFINER
    -- wachtwoordwijziging) valt buiten de blokkade. Een gewone app-login niet.
    IF current_user <> pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID))
       AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('mes_app','batchgui_app')
                    AND pg_has_role(current_user, oid, 'MEMBER'))
       AND (
         OLD.rol <> 'pending'
         OR EXISTS (SELECT 1 FROM authorization_grant g
                    WHERE g.user_id=OLD.id AND g.revoked_at IS NULL)
       )
       AND (NEW.wachtwoord_hash IS DISTINCT FROM OLD.wachtwoord_hash
         OR NEW.wachtwoord_wijzigen IS DISTINCT FROM OLD.wachtwoord_wijzigen
         OR NEW.rol IS DISTINCT FROM OLD.rol
         OR NEW.gebruikersnaam IS DISTINCT FROM OLD.gebruikersnaam
         OR NEW.gedeeld IS DISTINCT FROM OLD.gedeeld
         OR (NEW.actief IS DISTINCT FROM OLD.actief AND
             (NEW.actief OR EXISTS (SELECT 1 FROM authorization_grant g
                JOIN authorization_role r ON r.code=g.role_code
                WHERE g.user_id=OLD.id AND g.revoked_at IS NULL AND r.domain IN ('technical','security'))))) THEN
        RAISE EXCEPTION 'Kritisch account vereist gecontroleerd identiteitsbeheer';
    END IF;
    RETURN NEW;
END $$;

-- Een account met een door technisch beheer gekozen tijdelijk wachtwoord
-- mag geen nieuwe bevoegdheden krijgen voordat het persoonlijk is ingericht.
CREATE OR REPLACE FUNCTION authorization_decide(p_actor uuid, p_request uuid, p_approved boolean, p_reason text)
RETURNS uuid LANGUAGE plpgsql SET search_path = fabriek, public AS $$
DECLARE v authorization_request%ROWTYPE; v_grant uuid; v_domain text;
BEGIN
    -- Serialiseer besluiten voor hetzelfde doelaccount, ook uit verschillende aanvragen.
    SELECT * INTO v FROM authorization_request WHERE id=p_request FOR UPDATE;
    IF NOT FOUND OR p_actor IS NULL OR p_approved IS NULL OR
       p_actor = v.requested_by OR p_actor = v.user_id OR
       NOT authorization_permits(p_actor,'authorization.approve',NULL,NULL,NULL) THEN
        RAISE EXCEPTION 'Onafhankelijke bevoegde beoordelaar vereist';
    END IF;
    IF EXISTS (SELECT 1 FROM authorization_decision WHERE request_id=p_request) THEN
        RAISE EXCEPTION 'Aanvraag is al beoordeeld';
    END IF;
    PERFORM 1 FROM gebruiker WHERE id=v.user_id FOR UPDATE;
    IF p_approved THEN
        IF NOT authorization_permits(v.requested_by,'authorization.request',NULL,NULL,NULL) THEN
            RAISE EXCEPTION 'Aanvrager is niet meer bevoegd';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM gebruiker WHERE id=v.user_id AND actief AND NOT gedeeld AND NOT wachtwoord_wijzigen) THEN
            RAISE EXCEPTION 'Ongeldig persoonlijk doelaccount';
        END IF;
        IF v.valid_until IS NOT NULL AND v.valid_until <= clock_timestamp() THEN
            RAISE EXCEPTION 'Geldigheid is verlopen';
        END IF;
        SELECT domain INTO v_domain FROM authorization_role WHERE code=v.role_code;
        IF EXISTS (
            SELECT 1 FROM authorization_grant g JOIN authorization_role r ON r.code=g.role_code
            WHERE g.user_id=v.user_id AND g.revoked_at IS NULL
              AND tstzrange(g.valid_from,g.valid_until,'[)') && tstzrange(v.valid_from,v.valid_until,'[)')
              AND ((r.domain IN ('technical','security')) <> (v_domain IN ('technical','security'))
                OR (r.domain='display') <> (v_domain='display')
                OR (r.domain IN ('technical','security') AND v_domain IN ('technical','security') AND r.domain <> v_domain))
        ) THEN RAISE EXCEPTION 'Functiescheiding verhindert toekenning'; END IF;
        INSERT INTO authorization_grant (user_id,role_code,area_code,product_id,equipment_code,valid_from,valid_until)
        VALUES (v.user_id,v.role_code,v.area_code,v.product_id,v.equipment_code,v.valid_from,v.valid_until)
        RETURNING id INTO v_grant;
    END IF;
    INSERT INTO authorization_decision (request_id,decided_by,approved,reason,grant_id)
    VALUES (v.id,p_actor,p_approved,p_reason,v_grant);
    RETURN v_grant;
END $$;

-- Migratie 0054: expliciete bootstrap uitsluitend op een lege identiteitsadministratie.
SET search_path = fabriek, public;

CREATE TABLE authorization_bootstrap (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    system_user_id uuid NOT NULL REFERENCES gebruiker(id),
    security_user_a uuid NOT NULL REFERENCES gebruiker(id),
    security_user_b uuid NOT NULL REFERENCES gebruiker(id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    database_actor text NOT NULL,
    reason text NOT NULL CHECK (btrim(reason) <> ''),
    CHECK (system_user_id <> security_user_a AND system_user_id <> security_user_b AND security_user_a <> security_user_b)
);

CREATE FUNCTION authorization_bootstrap_empty(p_system text,p_system_password text,
    p_a text,p_a_password text,p_b text,p_b_password text,p_reason text)
RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog,fabriek,public,pg_temp AS $$
DECLARE v_system uuid; v_a uuid; v_b uuid;
BEGIN
    IF current_user <> pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='fabriek.gebruiker'::regclass)) THEN
        RAISE EXCEPTION 'Bootstrap vereist database-eigenaar';
    END IF;
    LOCK TABLE gebruiker IN SHARE ROW EXCLUSIVE MODE;
    IF EXISTS (SELECT 1 FROM gebruiker) OR EXISTS (SELECT 1 FROM authorization_bootstrap) THEN
        RAISE EXCEPTION 'Bootstrap uitsluitend op lege identiteitsadministratie';
    END IF;
    IF p_system IS NULL OR p_a IS NULL OR p_b IS NULL
       OR p_system !~ '^[a-z0-9._-]{3,40}$' OR p_a !~ '^[a-z0-9._-]{3,40}$' OR p_b !~ '^[a-z0-9._-]{3,40}$'
       OR p_system=p_a OR p_system=p_b OR p_a=p_b
       OR length(coalesce(p_system_password,'')) < 8 OR length(coalesce(p_a_password,'')) < 8
       OR length(coalesce(p_b_password,'')) < 8
       OR p_system_password=p_a_password OR p_system_password=p_b_password OR p_a_password=p_b_password
       OR btrim(coalesce(p_reason,''))='' THEN
        RAISE EXCEPTION 'Drie afzonderlijke identiteiten, wachtwoorden en reden vereist';
    END IF;
    INSERT INTO gebruiker(gebruikersnaam,rol,wachtwoord_hash)
      VALUES(p_system,'beheerder',wachtwoord_hash(p_system_password)) RETURNING id INTO v_system;
    INSERT INTO gebruiker(gebruikersnaam,rol,wachtwoord_hash)
      VALUES(p_a,'pending',wachtwoord_hash(p_a_password)) RETURNING id INTO v_a;
    INSERT INTO gebruiker(gebruikersnaam,rol,wachtwoord_hash)
      VALUES(p_b,'pending',wachtwoord_hash(p_b_password)) RETURNING id INTO v_b;
    INSERT INTO authorization_grant(user_id,role_code) VALUES
      (v_system,'system_administrator'),(v_a,'security_administrator'),(v_b,'security_administrator');
    INSERT INTO authorization_bootstrap(system_user_id,security_user_a,security_user_b,database_actor,reason)
      VALUES(v_system,v_a,v_b,current_user,p_reason);
END $$;
CREATE TRIGGER authorization_bootstrap_immutable BEFORE UPDATE OR DELETE ON authorization_bootstrap
    FOR EACH ROW EXECUTE FUNCTION authorization_audit_immutable();
REVOKE ALL ON authorization_bootstrap FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION authorization_bootstrap_empty(text,text,text,text,text,text,text) FROM PUBLIC;

-- Migratie 0055: eigenaar-only herstel met twee persoonlijk bevestigde security-identiteiten.
SET search_path = fabriek, public;

CREATE TABLE authorization_recovery (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES gebruiker(id),
    requested_by uuid NOT NULL REFERENCES gebruiker(id),
    approved_by uuid NOT NULL REFERENCES gebruiker(id),
    reason text NOT NULL CHECK (btrim(reason) <> ''),
    recovered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (user_id <> requested_by AND user_id <> approved_by AND requested_by <> approved_by)
);
CREATE TRIGGER authorization_recovery_immutable BEFORE UPDATE OR DELETE ON authorization_recovery
    FOR EACH ROW EXECUTE FUNCTION authorization_audit_immutable();

-- Beide bevestigingen gelden voor dezelfde concrete herstelhandeling.
-- Geen automatisch activeren, geen nieuwe grants, geen herstel van gedeelde accounts.
-- De eigenaar begeleidt de persoonlijke overdracht; het wachtwoord wordt niet gelogd.
CREATE FUNCTION authorization_recover_confirmed(p_target uuid,p_requester uuid,p_approver uuid,
    p_reason text,p_requester_password text,p_approver_password text,p_new_password text)
RETURNS text LANGUAGE plpgsql SET search_path = pg_catalog,fabriek,public,pg_temp AS $$
DECLARE v_a text; v_b text; v_login record;
BEGIN
    IF current_user <> pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='fabriek.gebruiker'::regclass)) THEN
        RAISE EXCEPTION 'Herstel vereist database-eigenaar';
    END IF;
    IF p_target IS NULL OR p_requester IS NULL OR p_approver IS NULL
       OR p_target=p_requester OR p_target=p_approver OR p_requester=p_approver
       OR btrim(coalesce(p_reason,''))='' OR length(coalesce(p_new_password,''))<8 THEN
        RAISE EXCEPTION 'Onafhankelijke herstelidentiteiten, reden en wachtwoord vereist';
    END IF;
    -- Vaste vergrendelvolgorde voorkomt onderlinge blokkades bij gelijktijdig herstel.
    PERFORM id FROM gebruiker WHERE id IN (p_target,p_requester,p_approver) ORDER BY id FOR UPDATE;
    IF NOT EXISTS (SELECT 1 FROM gebruiker WHERE id=p_target AND actief AND NOT gedeeld)
       OR NOT authorization_permits(p_requester,'authorization.request',NULL,NULL,NULL)
       OR NOT authorization_permits(p_approver,'authorization.approve',NULL,NULL,NULL) THEN
        RAISE EXCEPTION 'Geen bevoegdheid voor gecontroleerd herstel';
    END IF;
    SELECT gebruikersnaam INTO v_a FROM gebruiker WHERE id=p_requester;
    SELECT gebruikersnaam INTO v_b FROM gebruiker WHERE id=p_approver;
    SELECT * INTO v_login FROM inloggen(v_a,p_requester_password,NULL);
    IF v_login.wacht_seconden IS NOT NULL THEN RETURN 'locked'; END IF;
    IF v_login.id IS DISTINCT FROM p_requester THEN RETURN 'denied'; END IF;
    SELECT * INTO v_login FROM inloggen(v_b,p_approver_password,NULL);
    IF v_login.wacht_seconden IS NOT NULL THEN RETURN 'locked'; END IF;
    IF v_login.id IS DISTINCT FROM p_approver THEN RETURN 'denied'; END IF;
    -- Herstel blokkeert normale toegang totdat de accounthouder het wachtwoord wijzigt.
    UPDATE gebruiker SET wachtwoord_hash=wachtwoord_hash(p_new_password),wachtwoord_wijzigen=true
      WHERE id=p_target;
    INSERT INTO authorization_recovery(user_id,requested_by,approved_by,reason)
      VALUES(p_target,p_requester,p_approver,p_reason);
    RETURN 'recovered';
END $$;
REVOKE ALL ON authorization_recovery FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION authorization_recover_confirmed(uuid,uuid,uuid,text,text,text,text) FROM PUBLIC;

-- Migratie 0056: sessiegeneratie bij identiteitswijzigingen.
SET search_path = fabriek, public;
ALTER TABLE gebruiker ADD COLUMN session_version bigint NOT NULL DEFAULT 1 CHECK (session_version > 0);
CREATE FUNCTION authorization_session_version() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog,fabriek,pg_temp AS $$
BEGIN
    IF TG_OP='INSERT' THEN
        NEW.session_version := 1;
    ELSIF NEW.wachtwoord_hash IS DISTINCT FROM OLD.wachtwoord_hash
       OR NEW.wachtwoord_wijzigen IS DISTINCT FROM OLD.wachtwoord_wijzigen
       OR NEW.actief IS DISTINCT FROM OLD.actief OR NEW.rol IS DISTINCT FROM OLD.rol
       OR NEW.gedeeld IS DISTINCT FROM OLD.gedeeld
       OR NEW.gebruikersnaam IS DISTINCT FROM OLD.gebruikersnaam THEN
        NEW.session_version := OLD.session_version + 1;
    ELSE
        NEW.session_version := OLD.session_version;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER authorization_session_version BEFORE INSERT OR UPDATE ON gebruiker
    FOR EACH ROW EXECUTE FUNCTION authorization_session_version();
REVOKE EXECUTE ON FUNCTION authorization_session_version() FROM PUBLIC;

-- Neem de generatie onder dezelfde accountlock als de wachtwoordcontrole op.
CREATE FUNCTION login_with_session(p_name text,p_password text,p_pc text)
RETURNS TABLE(id uuid,rol text,gebruikersnaam text,wacht_seconden int,session_version bigint,ww boolean)
LANGUAGE plpgsql SET search_path = pg_catalog,fabriek,public,pg_temp AS $$
DECLARE v record;
BEGIN
    SELECT * INTO v FROM inloggen(p_name,p_password,p_pc);
    IF v.id IS NULL THEN
        RETURN QUERY SELECT NULL::uuid,NULL::text,NULL::text,v.wacht_seconden,NULL::bigint,NULL::boolean;
    ELSE
        RETURN QUERY SELECT v.id,v.rol,v.gebruikersnaam,v.wacht_seconden,g.session_version,g.wachtwoord_wijzigen
            FROM gebruiker g WHERE g.id=v.id;
    END IF;
END $$;

-- De oude token-generatie moet ook binnen de wijzigingstransactie kloppen.
CREATE FUNCTION change_password_session(p_user uuid,p_version bigint,p_current text,p_new text)
RETURNS TABLE(status text,session_version bigint)
LANGUAGE plpgsql SET search_path = pg_catalog,fabriek,public,pg_temp AS $$
DECLARE v_status text;
BEGIN
    PERFORM 1 FROM gebruiker g WHERE g.id=p_user AND g.session_version=p_version FOR UPDATE;
    IF NOT FOUND THEN RETURN QUERY SELECT 'stale'::text,NULL::bigint; RETURN; END IF;
    v_status := change_password_confirmed(p_user,p_current,p_new);
    RETURN QUERY SELECT v_status,g.session_version FROM gebruiker g WHERE g.id=p_user;
END $$;
REVOKE EXECUTE ON FUNCTION login_with_session(text,text,text),change_password_session(uuid,bigint,text,text) FROM PUBLIC;

-- Migratie 0057: diagnose voor noodherstel, geen automatische bevoegdheidstoekenning.
SET search_path = fabriek, public;

-- Een bevoegd account is niet noodzakelijk beschikbaar: dit is uitsluitend
-- een technische bovengrens, geen bewijs van aanwezigheid of wachtwoordbezit.
CREATE FUNCTION authorization_recovery_readiness(p_target uuid)
RETURNS TABLE(eligible_requesters bigint,eligible_approvers bigint,independent_pairs bigint)
LANGUAGE sql STABLE SET search_path = pg_catalog,fabriek,pg_temp AS $$
    WITH candidates AS (
      SELECT id,
        authorization_permits(id,'authorization.request',NULL,NULL,NULL) AS can_request,
        authorization_permits(id,'authorization.approve',NULL,NULL,NULL) AS can_approve
      FROM gebruiker WHERE id <> p_target AND actief AND NOT gedeeld AND NOT wachtwoord_wijzigen
    )
    SELECT (SELECT count(*) FROM candidates WHERE can_request),
           (SELECT count(*) FROM candidates WHERE can_approve),
           (SELECT count(*) FROM candidates a CROSS JOIN candidates b
              WHERE a.id<>b.id AND a.can_request AND b.can_approve)
$$;
REVOKE EXECUTE ON FUNCTION authorization_recovery_readiness(uuid) FROM PUBLIC;

-- Migratie 0058: scheid operationeel personeelsbeheer en accountbeheer.
SET search_path = fabriek, public;
INSERT INTO authorization_permission(code,domain) VALUES
 ('personnel.read','operations'), ('personnel.manage','operations');
INSERT INTO authorization_role_permission(role_code,permission_code) VALUES
 ('manufacturing_manager','personnel.read'), ('manufacturing_manager','personnel.manage');

-- Alleen een bestaande actieve persoonlijke koppeling teruggeven.
-- Inloggen creëert nooit meer een personeelsidentiteit.
CREATE OR REPLACE FUNCTION operator_van_account(p_gebruiker uuid)
RETURNS uuid LANGUAGE sql STABLE SET search_path = pg_catalog,fabriek,pg_temp AS $$
    SELECT o.id FROM operator o JOIN gebruiker g ON g.id=o.gebruiker_id
    WHERE g.id=p_gebruiker AND g.actief AND NOT g.gedeeld AND o.actief
$$;

-- Historische koppelingen blijven intact; koppelen is een aparte gecontroleerde
-- handeling, voorlopig alleen door de vertrouwde eigenaar. Geen vrije app-write.
CREATE FUNCTION authorization_personnel_identity_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog,fabriek,pg_temp AS $$
BEGIN
    IF NOT (current_user = pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID))) AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('mes_app','batchgui_app')
               AND pg_has_role(current_user,oid,'MEMBER')) THEN
        IF TG_OP='INSERT' THEN
            IF NEW.gebruiker_id IS NOT NULL THEN
                RAISE EXCEPTION 'Personeelskoppeling vereist gecontroleerd identiteitsbeheer';
            END IF;
        ELSIF NEW.gebruiker_id IS DISTINCT FROM OLD.gebruiker_id OR NEW.id IS DISTINCT FROM OLD.id THEN
            RAISE EXCEPTION 'Personeelskoppeling vereist gecontroleerd identiteitsbeheer';
        END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER authorization_personnel_identity_guard BEFORE INSERT OR UPDATE ON operator
    FOR EACH ROW EXECUTE FUNCTION authorization_personnel_identity_guard();
REVOKE EXECUTE ON FUNCTION authorization_personnel_identity_guard() FROM PUBLIC;

-- Migratie 0059: persoonlijk bevestigd autorisatiekanaal, zonder eigenaarlogin.
SET search_path = fabriek, public;

-- Afzonderlijke NOLOGIN-groepsrol. IT maakt persoonlijke database-logins
-- uitsluitend na organisatorische goedkeuring; geen automatische leden.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mes_security_channel') THEN
        CREATE ROLE mes_security_channel NOLOGIN;
    END IF;
END $$;

-- Elke handeling verifieert opnieuw de persoonlijke MES-identiteit.
-- Onjuiste wachtwoorden retourneren status zodat de poging gecommit kan worden.
CREATE FUNCTION authorization_channel_submit(p_actor uuid,p_user uuid,p_role text,
    p_area text,p_product uuid,p_equipment text,p_from timestamptz,p_until timestamptz,
    p_reason text,p_password text)
RETURNS TABLE(status text,request_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,fabriek,public,pg_temp AS $$
DECLARE v_name text; v_login record; v_id uuid;
BEGIN
    SELECT gebruikersnaam INTO v_name FROM gebruiker
      WHERE id=p_actor AND actief AND NOT gedeeld AND NOT wachtwoord_wijzigen FOR UPDATE;
    IF NOT FOUND THEN RETURN QUERY SELECT 'denied'::text,NULL::uuid; RETURN; END IF;
    SELECT * INTO v_login FROM inloggen(v_name,p_password,NULL);
    IF v_login.wacht_seconden IS NOT NULL THEN RETURN QUERY SELECT 'locked'::text,NULL::uuid; RETURN; END IF;
    IF v_login.id IS DISTINCT FROM p_actor THEN RETURN QUERY SELECT 'denied'::text,NULL::uuid; RETURN; END IF;
    v_id := authorization_submit(p_actor,p_user,p_role,p_area,p_product,p_equipment,p_from,p_until,p_reason);
    RETURN QUERY SELECT 'submitted'::text,v_id;
END $$;

CREATE FUNCTION authorization_channel_decide(p_actor uuid,p_request uuid,p_approved boolean,p_reason text,p_password text)
RETURNS TABLE(status text,grant_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog,fabriek,public,pg_temp AS $$
    SELECT * FROM authorization_decide_confirmed(p_actor,p_request,p_approved,p_reason,p_password)
$$;
CREATE FUNCTION authorization_channel_revoke(p_actor uuid,p_grant uuid,p_reason text,p_password text)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog,fabriek,public,pg_temp AS $$
    SELECT authorization_revoke_confirmed(p_actor,p_grant,p_reason,p_password)
$$;

-- Alleen voor de aparte groepsrol; gewone applicatie en PUBLIC nooit.
REVOKE ALL ON FUNCTION authorization_channel_submit(uuid,uuid,text,text,uuid,text,timestamptz,timestamptz,text,text),
 authorization_channel_decide(uuid,uuid,boolean,text,text),
 authorization_channel_revoke(uuid,uuid,text,text) FROM PUBLIC;
GRANT USAGE ON SCHEMA fabriek TO mes_security_channel;
GRANT EXECUTE ON FUNCTION authorization_channel_submit(uuid,uuid,text,text,uuid,text,timestamptz,timestamptz,text,text),
 authorization_channel_decide(uuid,uuid,boolean,text,text),
 authorization_channel_revoke(uuid,uuid,text,text) TO mes_security_channel;

-- Migratie 0060: bind de persoonlijke PostgreSQL-login aan precies één MES-identiteit.
SET search_path = fabriek, public;
CREATE TABLE authorization_channel_identity (
    database_role_oid oid PRIMARY KEY,
    database_role_name name NOT NULL UNIQUE,
    user_id uuid NOT NULL UNIQUE REFERENCES gebruiker(id),
    registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    registered_by name NOT NULL DEFAULT session_user,
    reason text NOT NULL CHECK (btrim(reason)<>'')
);
REVOKE ALL ON authorization_channel_identity FROM PUBLIC;
CREATE TRIGGER authorization_channel_identity_immutable
    BEFORE UPDATE OR DELETE ON authorization_channel_identity
    FOR EACH ROW EXECUTE FUNCTION authorization_audit_immutable();

-- SESSION_USER blijft de oorspronkelijke database-login, ook in SECURITY DEFINER
-- en na SET ROLE. Een heraangemaakte rol met dezelfde naam heeft een andere OID.
CREATE FUNCTION authorization_channel_actor(p_permission text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog,fabriek,pg_temp AS $$
DECLARE v_actor uuid;
BEGIN
    SELECT i.user_id INTO v_actor
    FROM authorization_channel_identity i JOIN pg_roles r ON r.oid=i.database_role_oid
    WHERE r.rolname=session_user AND r.rolname=i.database_role_name
      AND r.rolcanlogin AND NOT r.rolsuper AND NOT r.rolcreaterole AND NOT r.rolcreatedb
      AND NOT r.rolreplication AND NOT r.rolbypassrls
      AND pg_has_role(r.oid,'mes_security_channel','MEMBER')
      AND NOT EXISTS (SELECT 1 FROM pg_roles a WHERE a.rolname IN ('mes_app','batchgui_app')
                     AND pg_has_role(r.oid,a.oid,'MEMBER'))
      AND authorization_permits(i.user_id,p_permission,NULL,NULL,NULL);
    IF v_actor IS NULL THEN RAISE EXCEPTION 'Geen gebonden bevoegde security-identiteit'; END IF;
    RETURN v_actor;
END $$;
REVOKE ALL ON FUNCTION authorization_channel_actor(text) FROM PUBLIC;

-- Geen vrije actoridentiteit meer in de publieke interface. Oude signatures
-- blijven eigenaar-only voor compatibiliteit van migratie/diagnose, niet voor kanaalleden.
REVOKE EXECUTE ON FUNCTION authorization_channel_submit(uuid,uuid,text,text,uuid,text,timestamptz,timestamptz,text,text),
 authorization_channel_decide(uuid,uuid,boolean,text,text), authorization_channel_revoke(uuid,uuid,text,text)
 FROM mes_security_channel;
CREATE FUNCTION authorization_channel_submit(p_user uuid,p_role text,p_area text,p_product uuid,p_equipment text,
 p_from timestamptz,p_until timestamptz,p_reason text,p_password text)
RETURNS TABLE(status text,request_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog,fabriek,public,pg_temp AS $$
 SELECT * FROM authorization_channel_submit(authorization_channel_actor('authorization.request'),
   p_user,p_role,p_area,p_product,p_equipment,p_from,p_until,p_reason,p_password)
$$;
CREATE FUNCTION authorization_channel_decide(p_request uuid,p_approved boolean,p_reason text,p_password text)
RETURNS TABLE(status text,grant_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog,fabriek,public,pg_temp AS $$
 SELECT * FROM authorization_channel_decide(authorization_channel_actor('authorization.approve'),
   p_request,p_approved,p_reason,p_password)
$$;
CREATE FUNCTION authorization_channel_revoke(p_grant uuid,p_reason text,p_password text)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog,fabriek,public,pg_temp AS $$
 SELECT authorization_channel_revoke(authorization_channel_actor('authorization.revoke'),p_grant,p_reason,p_password)
$$;

CREATE FUNCTION authorization_channel_requests()
RETURNS TABLE(request_id uuid,requested_by uuid,requester_name text,user_id uuid,user_name text,role_code text,
 area_code text,product_id uuid,equipment_code text,valid_from timestamptz,valid_until timestamptz,
 reason text,requested_at timestamptz,decided_by uuid,approved boolean,decision_reason text,decided_at timestamptz,grant_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog,fabriek,pg_temp AS $$
BEGIN
 PERFORM authorization_channel_actor('authorization.read');
 RETURN QUERY SELECT q.id,q.requested_by,a.gebruikersnaam,q.user_id,u.gebruikersnaam,q.role_code,
 q.area_code,q.product_id,q.equipment_code,q.valid_from,q.valid_until,q.reason,q.requested_at,
 d.decided_by,d.approved,d.reason,d.decided_at,d.grant_id
 FROM authorization_request q JOIN gebruiker a ON a.id=q.requested_by JOIN gebruiker u ON u.id=q.user_id
 LEFT JOIN authorization_decision d ON d.request_id=q.id ORDER BY q.requested_at DESC,q.id;
END $$;
CREATE FUNCTION authorization_channel_grants()
RETURNS TABLE(grant_id uuid,user_id uuid,user_name text,role_code text,area_code text,product_id uuid,equipment_code text,
 valid_from timestamptz,valid_until timestamptz,revoked_at timestamptz,revoked_by uuid,revocation_reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog,fabriek,pg_temp AS $$
BEGIN
 PERFORM authorization_channel_actor('authorization.read');
 RETURN QUERY SELECT g.id,g.user_id,u.gebruikersnaam,g.role_code,g.area_code,g.product_id,g.equipment_code,
 g.valid_from,g.valid_until,g.revoked_at,r.revoked_by,r.reason
 FROM authorization_grant g JOIN gebruiker u ON u.id=g.user_id
 LEFT JOIN authorization_revocation r ON r.grant_id=g.id ORDER BY g.valid_from DESC,g.id;
END $$;
REVOKE ALL ON FUNCTION authorization_channel_submit(uuid,text,text,uuid,text,timestamptz,timestamptz,text,text),
 authorization_channel_decide(uuid,boolean,text,text),authorization_channel_revoke(uuid,text,text),
 authorization_channel_requests(),authorization_channel_grants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authorization_channel_submit(uuid,text,text,uuid,text,timestamptz,timestamptz,text,text),
 authorization_channel_decide(uuid,boolean,text,text),authorization_channel_revoke(uuid,text,text),
 authorization_channel_requests(),authorization_channel_grants() TO mes_security_channel;

-- Migratie 0061: append-only levenscyclus van persoonlijke securitybindingen.
SET search_path = fabriek, public;

-- Een oude rol-OID en naam blijven gereserveerd; een vervangende login heeft
-- een nieuwe naam/OID. Een MES-account mag na intrekking opnieuw worden gebonden.
ALTER TABLE authorization_channel_identity DROP CONSTRAINT authorization_channel_identity_user_id_key;
CREATE TABLE authorization_channel_identity_revocation (
    database_role_oid oid PRIMARY KEY REFERENCES authorization_channel_identity(database_role_oid),
    revoked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    revoked_by name NOT NULL DEFAULT session_user,
    reason text NOT NULL CHECK (btrim(reason)<>'')
);
CREATE TRIGGER authorization_channel_identity_revocation_immutable BEFORE UPDATE OR DELETE
    ON authorization_channel_identity_revocation FOR EACH ROW EXECUTE FUNCTION authorization_audit_immutable();
REVOKE ALL ON authorization_channel_identity_revocation FROM PUBLIC;

-- Geen andere directe of indirecte groepsrollen, ook geen beheeroptie
-- op de toegestane groep. Rechtstreeks toegekende objectprivileges en
-- andere databases vallen buiten deze toets en vereisen IT-controle.
CREATE FUNCTION authorization_channel_role_safe(p_role oid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog,pg_temp AS $$
 SELECT EXISTS (SELECT 1 FROM pg_roles r WHERE r.oid=p_role AND r.rolcanlogin
    AND NOT r.rolsuper AND NOT r.rolcreaterole AND NOT r.rolcreatedb
    AND NOT r.rolreplication AND NOT r.rolbypassrls)
 AND pg_has_role(p_role,'mes_security_channel','MEMBER')
 AND NOT EXISTS (SELECT 1 FROM pg_roles r WHERE r.oid<>p_role AND r.rolname<>'mes_security_channel'
                 AND pg_has_role(p_role,r.oid,'MEMBER'))
 AND NOT EXISTS (SELECT 1 FROM pg_auth_members a WHERE a.member=p_role AND a.admin_option)
$$;

-- Eigenaar-only registratie van een reeds apart door IT ingerichte login.
-- Geen CREATE ROLE, wachtwoordbeheer of automatische MES-grants.
CREATE FUNCTION authorization_channel_bind(p_role name,p_user uuid,p_reason text)
RETURNS oid LANGUAGE plpgsql SET search_path = pg_catalog,fabriek,pg_temp AS $$
DECLARE v_oid oid;
BEGIN
 IF current_user <> pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='fabriek.authorization_channel_identity'::regclass)) THEN
    RAISE EXCEPTION 'Binding vereist database-eigenaar';
 END IF;
 IF btrim(coalesce(p_reason,''))='' THEN RAISE EXCEPTION 'Reden en goedkeuringsreferentie vereist'; END IF;
 SELECT oid INTO v_oid FROM pg_roles WHERE rolname=p_role;
 IF v_oid IS NULL OR NOT authorization_channel_role_safe(v_oid) THEN
    RAISE EXCEPTION 'Ongeschikte persoonlijke database-login';
 END IF;
 PERFORM 1 FROM gebruiker WHERE id=p_user FOR UPDATE;
 IF NOT FOUND OR NOT authorization_permits(p_user,'authorization.read',NULL,NULL,NULL) THEN
    RAISE EXCEPTION 'Geen bevoegde persoonlijke security-identiteit';
 END IF;
 IF EXISTS (SELECT 1 FROM authorization_channel_identity i WHERE i.user_id=p_user
     AND NOT EXISTS (SELECT 1 FROM authorization_channel_identity_revocation v WHERE v.database_role_oid=i.database_role_oid)) THEN
    RAISE EXCEPTION 'MES-identiteit heeft al een actieve binding';
 END IF;
 INSERT INTO authorization_channel_identity(database_role_oid,database_role_name,user_id,reason)
 VALUES(v_oid,p_role,p_user,p_reason);
 RETURN v_oid;
END $$;

CREATE FUNCTION authorization_channel_unbind(p_role name,p_reason text)
RETURNS oid LANGUAGE plpgsql SET search_path = pg_catalog,fabriek,pg_temp AS $$
DECLARE v_oid oid; v_user uuid;
BEGIN
 IF current_user <> pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='fabriek.authorization_channel_identity'::regclass)) THEN
    RAISE EXCEPTION 'Intrekking vereist database-eigenaar';
 END IF;
 IF btrim(coalesce(p_reason,''))='' THEN RAISE EXCEPTION 'Reden vereist'; END IF;
 SELECT database_role_oid,user_id INTO v_oid,v_user FROM authorization_channel_identity WHERE database_role_name=p_role;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende binding'; END IF;
 PERFORM 1 FROM gebruiker WHERE id=v_user FOR UPDATE;
 INSERT INTO authorization_channel_identity_revocation(database_role_oid,reason) VALUES(v_oid,p_reason);
 RETURN v_oid;
END $$;

CREATE OR REPLACE FUNCTION authorization_channel_actor(p_permission text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog,fabriek,pg_temp AS $$
DECLARE v_actor uuid;
BEGIN
    SELECT i.user_id INTO v_actor
    FROM authorization_channel_identity i JOIN pg_roles r ON r.oid=i.database_role_oid
    WHERE r.rolname=session_user AND r.rolname=i.database_role_name
      AND r.rolcanlogin AND NOT r.rolsuper AND NOT r.rolcreaterole AND NOT r.rolcreatedb
      AND NOT r.rolreplication AND NOT r.rolbypassrls
      AND pg_has_role(r.oid,'mes_security_channel','MEMBER')
      AND NOT EXISTS (SELECT 1 FROM pg_roles a WHERE a.rolname IN ('mes_app','batchgui_app')
                     AND pg_has_role(r.oid,a.oid,'MEMBER'))
      AND NOT EXISTS (SELECT 1 FROM authorization_channel_identity_revocation v WHERE v.database_role_oid=i.database_role_oid)
      AND authorization_channel_role_safe(r.oid)
      AND authorization_permits(i.user_id,p_permission,NULL,NULL,NULL);
    IF v_actor IS NULL THEN RAISE EXCEPTION 'Geen gebonden bevoegde security-identiteit'; END IF;
    RETURN v_actor;
END $$;

REVOKE ALL ON FUNCTION authorization_channel_role_safe(oid),authorization_channel_bind(name,uuid,text),
 authorization_channel_unbind(name,text) FROM PUBLIC;

-- Migratie 0062: persoonlijke bevestiging van tijdelijke legacy-kwaliteitsbesluiten.
SET search_path = fabriek, public;

-- De oude uitvoeringsfuncties blijven uitsluitend voor de eigenaar en de
-- bevestigde ingang beschikbaar. Een reguliere keuring is geen MES Quality Release.
CREATE FUNCTION quality_decision_confirmed(p_actor uuid,p_session bigint,p_kind text,
 p_target uuid,p_decision text,p_reason text,p_step text,p_password text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,fabriek,public,pg_temp AS $$
DECLARE v_name text; v_login record; v_product uuid; v_lot uuid;
BEGIN
 SELECT gebruikersnaam INTO v_name FROM gebruiker
 WHERE id=p_actor AND session_version=p_session AND actief AND NOT gedeeld AND NOT wachtwoord_wijzigen FOR UPDATE;
 IF NOT FOUND THEN RETURN 'denied'; END IF;
 IF p_decision IS NULL OR p_decision NOT IN ('vrijgegeven','afgekeurd') THEN
   RAISE EXCEPTION 'Alleen vrijgave of afkeuring; herbewerking vereist een afzonderlijke opdracht';
 END IF;
 IF p_kind='inspection' THEN
   SELECT r.product_id,r.lot_id INTO v_product,v_lot FROM keuring k
   JOIN stapregistratie r ON r.id=k.stapregistratie_id WHERE k.id=p_target FOR UPDATE OF k,r;
   IF NOT FOUND THEN RAISE EXCEPTION 'Keuring bestaat niet'; END IF;
   IF NOT authorization_permits(p_actor,'inspection.decide',NULL,v_product,NULL)
     OR (v_lot IS NOT NULL AND EXISTS (SELECT 1 FROM batch b WHERE b.lot_id=v_lot
         AND NOT authorization_permits(p_actor,'inspection.decide',NULL,b.product_id,NULL))) THEN
     RETURN 'denied';
   END IF;
 ELSIF p_kind='batch' THEN
   SELECT product_id INTO v_product FROM batch WHERE id=p_target FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Batch bestaat niet'; END IF;
   IF NOT authorization_permits(p_actor,'inspection.batch.decide',NULL,v_product,NULL) THEN RETURN 'denied'; END IF;
 ELSE RAISE EXCEPTION 'Onbekend besluitobject';
 END IF;
 SELECT * INTO v_login FROM inloggen(v_name,p_password,NULL);
 IF v_login.wacht_seconden IS NOT NULL THEN RETURN 'locked'; END IF;
 IF v_login.id IS DISTINCT FROM p_actor THEN RETURN 'denied'; END IF;
 IF p_kind='inspection' THEN
   IF EXISTS (SELECT 1 FROM keuring WHERE id=p_target AND status<>'open') THEN
     RAISE EXCEPTION 'Over deze stap is al beslist';
   END IF;
   PERFORM beslis_keuring(p_target,p_decision,p_reason,p_actor,NULL);
 ELSE
   INSERT INTO batch_besluit(batch_id,besluit,reden,besloten_door)
   VALUES(p_target,p_decision,p_reason,p_actor);
 END IF;
 RETURN 'decided';
END $$;
REVOKE ALL ON FUNCTION quality_decision_confirmed(uuid,bigint,text,uuid,text,text,text,text) FROM PUBLIC;

-- Bescherm besluiten ook wanneer een oude route rechtstreeks een tabel benadert.
CREATE FUNCTION quality_legacy_decision_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog,fabriek,pg_temp AS $$
BEGIN
 IF NOT (current_user = pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID))) AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('mes_app','batchgui_app')
            AND pg_has_role(current_user,oid,'MEMBER')) THEN
   IF TG_TABLE_NAME='batch_besluit' THEN
     IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Besluitregistratie is onveranderlijk'; END IF;
     IF NEW.besluit <> 'in_beoordeling' THEN RAISE EXCEPTION 'Persoonlijke kwaliteitsbevestiging vereist'; END IF;
   ELSE
     IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Persoonlijke kwaliteitsbevestiging vereist'; END IF;
     IF NEW.status <> 'open' OR NEW.besloten_door IS NOT NULL OR NEW.besloten_op IS NOT NULL THEN
       RAISE EXCEPTION 'Persoonlijke kwaliteitsbevestiging vereist';
     END IF;
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER quality_guard_batch BEFORE INSERT OR UPDATE ON batch_besluit
 FOR EACH ROW EXECUTE FUNCTION quality_legacy_decision_guard();
CREATE TRIGGER quality_guard_inspection BEFORE INSERT OR UPDATE ON keuring
 FOR EACH ROW EXECUTE FUNCTION quality_legacy_decision_guard();
REVOKE ALL ON FUNCTION quality_legacy_decision_guard(),beslis_keuring(uuid,text,text,uuid,text) FROM PUBLIC;

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

-- Migratie 0064: bevestigde tijdelijke herbewerkingsopdrachten.
SET search_path = fabriek, public;

CREATE FUNCTION rework_order_permission(p_actor uuid,p_batch uuid,p_lot uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog,fabriek,pg_temp AS $$
 SELECT CASE WHEN p_batch IS NOT NULL AND p_lot IS NULL THEN
   EXISTS (SELECT 1 FROM batch b WHERE b.id=p_batch AND
     (authorization_permits(p_actor,'inspection.rework.order',NULL,b.product_id,NULL)
      OR authorization_permits(p_actor,'operations.rework.order',NULL,b.product_id,NULL)))
 WHEN p_lot IS NOT NULL AND p_batch IS NULL THEN
   EXISTS (SELECT 1 FROM lot WHERE id=p_lot)
   AND (
     (authorization_permits(p_actor,'inspection.rework.order',NULL,lot_product(p_lot),NULL)
      AND NOT EXISTS (SELECT 1 FROM batch b WHERE b.lot_id=p_lot AND NOT authorization_permits(p_actor,'inspection.rework.order',NULL,b.product_id,NULL)))
     OR
     (authorization_permits(p_actor,'operations.rework.order',NULL,lot_product(p_lot),NULL)
      AND NOT EXISTS (SELECT 1 FROM batch b WHERE b.lot_id=p_lot AND NOT authorization_permits(p_actor,'operations.rework.order',NULL,b.product_id,NULL)))
   )
 ELSE false END
$$;

CREATE FUNCTION rework_order_confirmed(p_actor uuid,p_session bigint,p_number text,p_step text,p_reason text,p_id uuid,p_password text)
RETURNS TABLE(status text,order_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,fabriek,public,pg_temp AS $$
DECLARE v_name text; v_login record; v_batch uuid; v_lot uuid; v_id uuid;
BEGIN
 SELECT gebruikersnaam INTO v_name FROM gebruiker WHERE id=p_actor AND session_version=p_session
 AND actief AND NOT gedeeld AND NOT wachtwoord_wijzigen FOR UPDATE;
 IF NOT FOUND THEN RETURN QUERY SELECT 'denied'::text,NULL::uuid; RETURN; END IF;
 SELECT id INTO v_batch FROM batch WHERE batchnummer=p_number FOR UPDATE;
 IF NOT FOUND THEN SELECT id INTO v_lot FROM lot WHERE lotnummer=p_number FOR UPDATE; END IF;
 IF NOT rework_order_permission(p_actor,v_batch,v_lot) THEN RETURN QUERY SELECT 'denied'::text,NULL::uuid; RETURN; END IF;
 SELECT * INTO v_login FROM inloggen(v_name,p_password,NULL);
 IF v_login.wacht_seconden IS NOT NULL THEN RETURN QUERY SELECT 'locked'::text,NULL::uuid; RETURN; END IF;
 IF v_login.id IS DISTINCT FROM p_actor THEN RETURN QUERY SELECT 'denied'::text,NULL::uuid; RETURN; END IF;
 v_id:=maak_herbewerking(p_number,p_step,p_reason,p_actor,p_id);
 RETURN QUERY SELECT 'created'::text,v_id;
END $$;

CREATE FUNCTION rework_cancel_confirmed(p_actor uuid,p_session bigint,p_id uuid,p_reason text,p_password text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,fabriek,public,pg_temp AS $$
DECLARE v_name text; v_login record; v_order herbewerking%ROWTYPE;
BEGIN
 SELECT gebruikersnaam INTO v_name FROM gebruiker WHERE id=p_actor AND session_version=p_session
 AND actief AND NOT gedeeld AND NOT wachtwoord_wijzigen FOR UPDATE;
 IF NOT FOUND THEN RETURN 'denied'; END IF;
 SELECT * INTO v_order FROM herbewerking WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR NOT rework_order_permission(p_actor,v_order.batch_id,v_order.lot_id) THEN RETURN 'denied'; END IF;
 SELECT * INTO v_login FROM inloggen(v_name,p_password,NULL);
 IF v_login.wacht_seconden IS NOT NULL THEN RETURN 'locked'; END IF;
 IF v_login.id IS DISTINCT FROM p_actor THEN RETURN 'denied'; END IF;
 PERFORM trek_herbewerking_in(p_id,p_reason,p_actor);
 RETURN 'cancelled';
END $$;

-- De gecontroleerde koppeling vanuit een stapregistratie blijft functioneren
-- nadat directe schrijfrechten op opdrachten worden ingetrokken.
ALTER FUNCTION koppel_herbewerking() SECURITY DEFINER;
CREATE FUNCTION rework_history_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Herbewerkingshistorie blijft bewaard'; END IF;
 IF OLD.status<>'open' OR NEW.status NOT IN ('gestart','ingetrokken')
 OR (NEW.id,NEW.batch_id,NEW.lot_id,NEW.processtap_id,NEW.reden,NEW.aangemaakt_door,NEW.aangemaakt_op)
 IS DISTINCT FROM (OLD.id,OLD.batch_id,OLD.lot_id,OLD.processtap_id,OLD.reden,OLD.aangemaakt_door,OLD.aangemaakt_op) THEN
   RAISE EXCEPTION 'Herbewerkingsopdracht is onveranderlijk';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER rework_history_guard BEFORE UPDATE OR DELETE ON herbewerking
 FOR EACH ROW EXECUTE FUNCTION rework_history_guard();
REVOKE ALL ON FUNCTION maak_herbewerking(text,text,text,uuid,uuid),trek_herbewerking_in(uuid,text,uuid),
 koppel_herbewerking(),rework_history_guard(),rework_order_permission(uuid,uuid,uuid),
 rework_order_confirmed(uuid,bigint,text,text,text,uuid,text),rework_cancel_confirmed(uuid,bigint,uuid,text,text) FROM PUBLIC;

-- Migratie 0065: actuele uitvoeringsbevoegdheid bij consumptie van een legacy-herbewerkingsopdracht.
SET search_path = fabriek, public;

CREATE OR REPLACE FUNCTION koppel_herbewerking() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,fabriek,pg_temp AS $$
DECLARE v_id uuid; v_actor uuid; v_product uuid;
BEGIN
    IF NOT NEW.herbewerking_start THEN RETURN NULL; END IF;
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

    -- De gekoppelde medewerker moet actief en persoonlijk zijn. Het
    -- autorisatiefundament controleert ook geldigheid en kwalificaties.
    SELECT g.id INTO v_actor FROM operator o JOIN gebruiker g ON g.id=o.gebruiker_id
      WHERE o.id=NEW.operator_id AND o.actief AND g.actief
        AND NOT g.gedeeld AND NOT g.wachtwoord_wijzigen
      FOR SHARE OF o,g;
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Actieve persoonlijke operator vereist voor herbewerking';
    END IF;
    IF NEW.batch_id IS NOT NULL THEN
        SELECT product_id INTO v_product FROM batch WHERE id=NEW.batch_id;
    ELSE
        v_product:=lot_product(NEW.lot_id);
    END IF;
    IF NOT authorization_permits(v_actor,'execution.rework',NULL,v_product,NULL)
       OR (NEW.lot_id IS NOT NULL AND EXISTS (
           SELECT 1 FROM batch b WHERE b.lot_id=NEW.lot_id
             AND NOT authorization_permits(v_actor,'execution.rework',NULL,b.product_id,NULL))) THEN
        RAISE EXCEPTION 'Geen actuele uitvoeringsbevoegdheid voor herbewerking';
    END IF;
    UPDATE herbewerking SET status='gestart',stapregistratie_id=NEW.id WHERE id=v_id;
    RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION koppel_herbewerking() FROM PUBLIC;

-- Migratie 0066: database-uitgegeven persoonlijk sessiebewijs.
SET search_path = fabriek, public;

CREATE TABLE execution_session (
    proof_hash bytea PRIMARY KEY CHECK (octet_length(proof_hash)=32),
    user_id uuid NOT NULL REFERENCES gebruiker(id),
    session_version bigint NOT NULL,
    issued_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    CHECK (expires_at > issued_at AND expires_at <= issued_at + interval '12 hours')
);
CREATE INDEX execution_session_expiry ON execution_session(expires_at);
REVOKE ALL ON execution_session FROM PUBLIC;

-- Alleen na succesvolle wachtwoordauthenticatie; geen functie die een
-- sessiebewijs uitgeeft op basis van een los opgegeven gebruikers-ID.
CREATE FUNCTION execution_session_login(p_name text,p_password text,p_pc text)
RETURNS TABLE(id uuid,rol text,gebruikersnaam text,wacht_seconden int,session_version bigint,ww boolean,session_proof text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v record; v_proof text; v_now timestamptz:=clock_timestamp();
BEGIN
    SELECT * INTO v FROM login_with_session(p_name,p_password,p_pc);
    IF v.id IS NOT NULL AND NOT coalesce(v.ww,true) THEN
        PERFORM 1 FROM gebruiker g WHERE g.id=v.id AND g.session_version=v.session_version
            AND g.actief AND NOT g.gedeeld AND NOT g.wachtwoord_wijzigen AND g.rol<>'scherm' FOR SHARE;
        IF FOUND THEN
            v_proof:=encode(public.gen_random_bytes(32),'hex');
            INSERT INTO execution_session(proof_hash,user_id,session_version,issued_at,expires_at)
            VALUES(public.digest(v_proof,'sha256'),v.id,v.session_version,v_now,v_now+interval '12 hours');
        END IF;
    END IF;
    RETURN QUERY SELECT v.id,v.rol,v.gebruikersnaam,v.wacht_seconden,v.session_version,v.ww,v_proof;
END $$;

-- Een bewijs is een bearer credential. Geen gebruikers-ID vertrouwen uit
-- GUC, HTTP-header of functieargument zonder dit bewijs te valideren.
CREATE FUNCTION execution_session_actor(p_proof text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_actor uuid;
BEGIN
    IF p_proof IS NULL OR length(p_proof)<>64 OR p_proof !~ '^[0-9a-f]{64}$' THEN RETURN NULL; END IF;
    SELECT g.id INTO v_actor FROM execution_session s JOIN gebruiker g ON g.id=s.user_id
       WHERE s.proof_hash=public.digest(p_proof,'sha256')
         AND s.issued_at<=clock_timestamp() AND s.expires_at>clock_timestamp()
         AND s.session_version=g.session_version AND g.actief AND NOT g.gedeeld
         AND NOT g.wachtwoord_wijzigen AND g.rol<>'scherm'
       FOR SHARE OF g;
    RETURN v_actor;
END $$;

-- Alleen de eigenaar ruimt verlopen bewijzen op. Geen productiehistorie.
CREATE FUNCTION execution_session_cleanup() RETURNS bigint
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_count bigint;
BEGIN
    DELETE FROM execution_session WHERE expires_at<=clock_timestamp();
    GET DIAGNOSTICS v_count=ROW_COUNT;
    RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION execution_session_login(text,text,text),execution_session_actor(text),execution_session_cleanup() FROM PUBLIC;

-- Migratie 0067: nieuw uitvoeringsbewijs bij bevestigde wachtwoordwijziging.
SET search_path = fabriek, public;
CREATE FUNCTION execution_session_change_password(p_user uuid,p_version bigint,p_current text,p_new text)
RETURNS TABLE(status text,session_version bigint,session_proof text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v record; v_proof text; v_now timestamptz;
BEGIN
    SELECT * INTO v FROM change_password_session(p_user,p_version,p_current,p_new);
    IF v.status='changed' THEN
        PERFORM 1 FROM gebruiker g WHERE g.id=p_user AND g.session_version=v.session_version
            AND g.actief AND NOT g.gedeeld AND NOT g.wachtwoord_wijzigen AND g.rol<>'scherm' FOR SHARE;
        IF FOUND THEN
            v_now:=clock_timestamp();
            v_proof:=encode(public.gen_random_bytes(32),'hex');
            INSERT INTO execution_session(proof_hash,user_id,session_version,issued_at,expires_at)
            VALUES(public.digest(v_proof,'sha256'),p_user,v.session_version,v_now,v_now+interval '12 hours');
        END IF;
    END IF;
    RETURN QUERY SELECT v.status,v.session_version,v_proof;
END $$;
REVOKE ALL ON FUNCTION execution_session_change_password(uuid,bigint,text,text) FROM PUBLIC;

-- Migratie 0068: transactionele identiteitsbinding voor productie-invoer.
SET search_path = fabriek, public;

-- Een GUC bevat alleen het bewijs, nooit een vertrouwde actor-ID. Iedere
-- beschermde operatie valideert opnieuw het bewijs en de actuele koppeling.
CREATE FUNCTION execution_transaction_actor()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_actor uuid;
BEGIN
    v_actor:=execution_session_actor(current_setting('fabriek.execution_proof',true));
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Geldig persoonlijk uitvoeringsbewijs vereist' USING ERRCODE='42501';
    END IF;
    RETURN v_actor;
END $$;

CREATE FUNCTION execution_bind_transaction(p_proof text,p_expected uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_actor uuid;
BEGIN
    v_actor:=execution_session_actor(p_proof);
    IF v_actor IS NULL OR v_actor IS DISTINCT FROM p_expected THEN
        RAISE EXCEPTION 'Persoonlijke uitvoeringssessie ongeldig' USING ERRCODE='42501';
    END IF;
    PERFORM set_config('fabriek.execution_proof',p_proof,true);
    RETURN v_actor;
END $$;

-- Gebruik SESSION_USER niet als uitzondering: SET ROLE door een eigenaar
-- moet in regressietests dezelfde beperkingen ondervinden als de app.
-- De invoker-trigger ziet de effectieve rol vóór een SECURITY DEFINER call.
CREATE FUNCTION execution_registration_identity_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_actor uuid; v_operator uuid;
BEGIN
    IF current_user = pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID)) OR NOT pg_has_role(current_user,'mes_app','MEMBER') THEN RETURN NEW; END IF;
    v_actor:=execution_transaction_actor();
    IF TG_OP='INSERT' THEN
        v_operator:=NEW.operator_id;
    ELSE
        IF NEW.operator_id IS DISTINCT FROM OLD.operator_id THEN
            RAISE EXCEPTION 'Oorspronkelijke operator mag niet wijzigen' USING ERRCODE='42501';
        END IF;
        IF NEW.afgerond_door IS DISTINCT FROM OLD.afgerond_door THEN
            v_operator:=NEW.afgerond_door;
        END IF;
    END IF;
    IF (TG_OP='INSERT' OR v_operator IS NOT NULL) AND NOT EXISTS (
        SELECT 1 FROM operator o WHERE o.id=v_operator AND o.gebruiker_id=v_actor AND o.actief
    ) THEN
        RAISE EXCEPTION 'Operator komt niet overeen met bewezen identiteit' USING ERRCODE='42501';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER stapregistratie_00_identity BEFORE INSERT OR UPDATE ON stapregistratie
 FOR EACH ROW EXECUTE FUNCTION execution_registration_identity_guard();

REVOKE ALL ON FUNCTION execution_transaction_actor(),execution_bind_transaction(text,uuid),execution_registration_identity_guard() FROM PUBLIC;

-- Migratie 0069: identiteitsbinding bij metingen en grondstofverbruik.
SET search_path = fabriek, public;

CREATE FUNCTION execution_measurement_identity_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_actor uuid; v_reg stapregistratie%ROWTYPE; v_permission text; v_quality boolean; v_correction boolean;
BEGIN
    IF current_user = pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID)) OR NOT pg_has_role(current_user,'mes_app','MEMBER') THEN RETURN NEW; END IF;
    v_actor:=execution_transaction_actor();
    SELECT * INTO v_reg FROM stapregistratie WHERE id=NEW.stapregistratie_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende stapregistratie'; END IF;
    IF TG_TABLE_NAME='waarde' THEN
        SELECT gemeten_door='kwaliteit' INTO v_quality FROM veld WHERE id=NEW.veld_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'Onbekend meetveld'; END IF;
        v_correction:=NEW.vervangt_waarde_id IS NOT NULL;
    ELSE
        v_quality:=false;
        v_correction:=NEW.vervangt_id IS NOT NULL;
    END IF;
    IF v_correction THEN
        IF NEW.gecorrigeerd_door IS DISTINCT FROM v_actor THEN
            RAISE EXCEPTION 'Correctie komt niet overeen met bewezen identiteit' USING ERRCODE='42501';
        END IF;
        -- Kwaliteitsconflicten krijgen een afzonderlijk gecontroleerd pad;
        -- geen impliciet correctierecht op kwaliteitsmetingen.
        IF v_quality THEN
            RAISE EXCEPTION 'Kwaliteitscorrectie vereist gecontroleerde conflictafhandeling' USING ERRCODE='42501';
        END IF;
        v_permission:='execution.correct';
    ELSE
        IF NOT EXISTS (SELECT 1 FROM operator o WHERE o.id=NEW.ingevoerd_door AND o.gebruiker_id=v_actor AND o.actief) THEN
            RAISE EXCEPTION 'Invoerder komt niet overeen met bewezen identiteit' USING ERRCODE='42501';
        END IF;
        v_permission:=CASE WHEN v_quality THEN 'inspection.record' ELSE 'execution.record' END;
    END IF;
    IF NOT authorization_permits(v_actor,v_permission,NULL,v_reg.product_id,NULL)
       OR (v_reg.lot_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM batch b WHERE b.lot_id=v_reg.lot_id
           AND NOT authorization_permits(v_actor,v_permission,NULL,b.product_id,NULL))) THEN
        RAISE EXCEPTION 'Geen actuele meet- of correctiebevoegdheid' USING ERRCODE='42501';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER waarde_00_identity BEFORE INSERT ON waarde
 FOR EACH ROW EXECUTE FUNCTION execution_measurement_identity_guard();
CREATE TRIGGER grondstof_gebruik_00_identity BEFORE INSERT ON grondstof_gebruik
 FOR EACH ROW EXECUTE FUNCTION execution_measurement_identity_guard();
REVOKE ALL ON FUNCTION execution_measurement_identity_guard() FROM PUBLIC;

-- Migratie 0070: persoonlijk gebonden conflictregistratie en gecontroleerd besluit.
SET search_path = fabriek, public;

CREATE FUNCTION execution_conflict_insert_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_actor uuid; v_reg stapregistratie%ROWTYPE; v_permission text;
BEGIN
 IF current_user = pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID)) OR NOT pg_has_role(current_user,'mes_app','MEMBER') THEN RETURN NEW; END IF;
 v_actor:=execution_transaction_actor();
 IF NEW.status<>'open' OR NEW.opgelost_door IS NOT NULL OR NEW.opgelost_op IS NOT NULL OR NEW.reden IS NOT NULL
 OR NOT EXISTS (SELECT 1 FROM operator WHERE id=NEW.ingevoerd_door AND gebruiker_id=v_actor AND actief) THEN
   RAISE EXCEPTION 'Ongeldige persoonlijke conflictinvoer' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_reg FROM stapregistratie WHERE id=NEW.stapregistratie_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende stapregistratie'; END IF;
 IF NEW.veld_id IS NOT NULL THEN
   SELECT CASE WHEN gemeten_door='kwaliteit' THEN 'inspection.record' ELSE 'execution.record' END INTO v_permission
     FROM veld WHERE id=NEW.veld_id AND processtap_id=v_reg.processtap_id;
   IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM waarde WHERE id=NEW.bestaand_waarde_id AND stapregistratie_id=v_reg.id AND veld_id=NEW.veld_id) THEN
     RAISE EXCEPTION 'Conflict verwijst niet naar oorspronkelijke meetinvoer';
   END IF;
 ELSE
   v_permission:='execution.record';
   IF NOT EXISTS (SELECT 1 FROM grondstof_gebruik WHERE id=NEW.bestaand_gebruik_id AND stapregistratie_id=v_reg.id AND grondstof_id=NEW.grondstof_id) THEN
     RAISE EXCEPTION 'Conflict verwijst niet naar oorspronkelijk grondstofverbruik';
   END IF;
 END IF;
 IF NOT authorization_permits(v_actor,v_permission,NULL,v_reg.product_id,NULL)
 OR (v_reg.lot_id IS NOT NULL AND EXISTS (SELECT 1 FROM batch b WHERE b.lot_id=v_reg.lot_id
      AND NOT authorization_permits(v_actor,v_permission,NULL,b.product_id,NULL))) THEN
    RAISE EXCEPTION 'Geen actuele conflictinvoerbevoegdheid' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER invoerconflict_00_identity BEFORE INSERT ON invoerconflict
 FOR EACH ROW EXECUTE FUNCTION execution_conflict_insert_guard();

-- Een gecontroleerd besluit is geen vrijgave. Bewaar de oorspronkelijke
-- conflictgegevens en pas nooit een inmiddels vervangen waarde stilzwijgend aan.
CREATE FUNCTION execution_resolve_conflict(p_conflict uuid,p_choice text,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_actor uuid; v_c invoerconflict%ROWTYPE; v_reg stapregistratie%ROWTYPE; v_permission text;
BEGIN
 v_actor:=execution_transaction_actor();
 IF p_choice IS NULL OR p_choice NOT IN ('bestaand','nieuw') OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Keuze en motivatie vereist';
 END IF;
 SELECT * INTO v_c FROM invoerconflict WHERE id=p_conflict FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekend conflict'; END IF;
 SELECT * INTO v_reg FROM stapregistratie WHERE id=v_c.stapregistratie_id FOR UPDATE;
 v_permission:=CASE WHEN EXISTS (SELECT 1 FROM veld WHERE id=v_c.veld_id AND gemeten_door='kwaliteit')
                    THEN 'inspection.decide' ELSE 'execution.correct' END;
 IF NOT authorization_permits(v_actor,v_permission,NULL,v_reg.product_id,NULL)
 OR (v_reg.lot_id IS NOT NULL AND EXISTS (SELECT 1 FROM batch b WHERE b.lot_id=v_reg.lot_id
      AND NOT authorization_permits(v_actor,v_permission,NULL,b.product_id,NULL))) THEN
    RAISE EXCEPTION 'Geen actuele conflictbeslisbevoegdheid' USING ERRCODE='42501';
 END IF;
 IF v_c.status<>'open' THEN
    IF v_c.status=p_choice AND v_c.opgelost_door=v_actor AND v_c.reden=btrim(p_reason) THEN RETURN; END IF;
    RAISE EXCEPTION 'Conflict is al opgelost';
 END IF;
 IF v_c.veld_id IS NOT NULL THEN
   PERFORM 1 FROM waarde WHERE id=v_c.bestaand_waarde_id FOR UPDATE;
   IF NOT EXISTS (SELECT 1 FROM waarde_actueel WHERE id=v_c.bestaand_waarde_id) THEN
     RAISE EXCEPTION 'Oorspronkelijke waarde is intussen gewijzigd; herbeoordeling vereist';
   END IF;
 ELSE
   PERFORM 1 FROM grondstof_gebruik WHERE id=v_c.bestaand_gebruik_id FOR UPDATE;
   IF NOT EXISTS (SELECT 1 FROM grondstof_gebruik_actueel WHERE id=v_c.bestaand_gebruik_id) THEN
     RAISE EXCEPTION 'Oorspronkelijke grondstofregel is intussen gewijzigd; herbeoordeling vereist';
   END IF;
 END IF;
 PERFORM los_invoerconflict_op(p_conflict,p_choice,v_actor,btrim(p_reason));
END $$;
REVOKE ALL ON FUNCTION execution_conflict_insert_guard(),execution_resolve_conflict(uuid,text,text),los_invoerconflict_op(uuid,text,uuid,text) FROM PUBLIC;

-- Migratie 0071: gecontroleerde tijdelijke papieren nalevering.
SET search_path = fabriek, public;

CREATE FUNCTION execution_paper_entry(p_stapcode text,p_nummer text,p_batches text[],p_pc uuid,p_operator uuid,
 p_begin timestamptz,p_eind timestamptz,p_reden text,p_waarden jsonb,p_grondstoffen jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_actor uuid; v_stap processtap%ROWTYPE; v_batch batch%ROWTYPE; v_lot uuid;
 v_products uuid[]; v_product uuid; v_id uuid; v_old_actor text;
BEGIN
 v_actor:=execution_transaction_actor();
 IF length(btrim(coalesce(p_reden,''))) NOT BETWEEN 1 AND 500 THEN
   RAISE EXCEPTION 'Motivatie voor papieren nalevering vereist';
 END IF;
 SELECT * INTO v_stap FROM processtap WHERE code=p_stapcode AND actief;
 IF NOT FOUND OR v_stap.soort='keuring' THEN RAISE EXCEPTION 'Papieren nalevering alleen voor productiestappen'; END IF;
 IF NOT EXISTS (SELECT 1 FROM operator WHERE id=p_operator) OR NOT EXISTS (SELECT 1 FROM pc WHERE id=p_pc AND actief) THEN
   RAISE EXCEPTION 'Oorspronkelijke operator en actief werkstation vereist';
 END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p_waarden,'[]'::jsonb)) w
   JOIN veld f ON f.processtap_id=v_stap.id AND f.code=w->>'veldcode' WHERE f.gemeten_door='kwaliteit') THEN
   RAISE EXCEPTION 'Kwaliteitsmetingen niet via papieren productienalevering';
 END IF;
 IF v_stap.is_lot_stap THEN
   PERFORM 1 FROM batch WHERE batchnummer=ANY(p_batches) ORDER BY id FOR UPDATE;
   SELECT array_agg(product_id) INTO v_products FROM batch WHERE batchnummer=ANY(p_batches);
   IF coalesce(cardinality(v_products),0)=0 OR cardinality(v_products)<>cardinality(p_batches) THEN
      RAISE EXCEPTION 'Alle oorspronkelijke batches moeten bestaan';
   END IF;
 ELSIF v_stap.niveau='batch' THEN
   SELECT * INTO v_batch FROM batch WHERE batchnummer=p_nummer FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende batch'; END IF;
   v_products:=ARRAY[v_batch.product_id];
 ELSE
   SELECT id INTO v_lot FROM lot WHERE lotnummer=p_nummer FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Onbekend lot'; END IF;
   PERFORM 1 FROM batch WHERE lot_id=v_lot ORDER BY id FOR SHARE;
   SELECT array_agg(product_id) INTO v_products FROM batch WHERE lot_id=v_lot;
   IF coalesce(cardinality(v_products),0)=0 THEN RAISE EXCEPTION 'Lot zonder batchleden'; END IF;
 END IF;
 FOREACH v_product IN ARRAY v_products LOOP
   IF NOT authorization_permits(v_actor,'execution.correct',NULL,v_product,NULL)
      OR NOT authorization_permits(v_actor,'execution.start',NULL,v_product,NULL)
      OR NOT authorization_permits(v_actor,'execution.record',NULL,v_product,NULL)
      OR NOT authorization_permits(v_actor,'execution.complete',NULL,v_product,NULL)
      OR (v_stap.is_lot_stap AND NOT authorization_permits(v_actor,'execution.lot.create',NULL,v_product,NULL)) THEN
     RAISE EXCEPTION 'Geen actuele bevoegdheid voor papieren nalevering' USING ERRCODE='42501';
   END IF;
 END LOOP;
 -- Alleen de digitale transcribent is persoonlijk geauthenticeerd.
 -- De oorspronkelijke operator is een verklaring afkomstig van papier.
 v_old_actor:=current_setting('fabriek.gebruiker',true);
 PERFORM set_config('fabriek.gebruiker',(SELECT gebruikersnaam FROM gebruiker WHERE id=v_actor),true);
 v_id:=lever_stap_na(p_stapcode,p_nummer,p_batches,p_pc,p_operator,p_begin,p_eind,btrim(p_reden),v_actor,p_waarden,p_grondstoffen);
 IF EXISTS (SELECT 1 FROM stapregistratie WHERE id=v_id AND herbewerking_start) THEN
   RAISE EXCEPTION 'Herbewerking niet via gewone papieren nalevering';
 END IF;
 PERFORM set_config('fabriek.gebruiker',coalesce(v_old_actor,''),true);
 RETURN v_id;
END $$;

-- De gewone applicatierol mag geen papieren herkomst achteraf fabriceren.
CREATE FUNCTION execution_paper_metadata_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
 IF NOT (current_user = pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID))) AND pg_has_role(current_user,'mes_app','MEMBER') THEN
   IF TG_OP='INSERT' THEN
     IF NEW.nageleverd_door IS NOT NULL OR NEW.nageleverd_reden IS NOT NULL OR NEW.nageleverd_op IS NOT NULL THEN
       RAISE EXCEPTION 'Papieren herkomst uitsluitend via gecontroleerde nalevering' USING ERRCODE='42501';
     END IF;
   ELSIF (NEW.nageleverd_door,NEW.nageleverd_reden,NEW.nageleverd_op)
        IS DISTINCT FROM (OLD.nageleverd_door,OLD.nageleverd_reden,OLD.nageleverd_op) THEN
     RAISE EXCEPTION 'Papieren herkomst mag niet achteraf wijzigen' USING ERRCODE='42501';
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER stapregistratie_01_paper BEFORE INSERT OR UPDATE ON stapregistratie
 FOR EACH ROW EXECUTE FUNCTION execution_paper_metadata_guard();
REVOKE ALL ON FUNCTION execution_paper_entry(text,text,text[],uuid,uuid,timestamptz,timestamptz,text,jsonb,jsonb),
 execution_paper_metadata_guard(),lever_stap_na(text,text,text[],uuid,uuid,timestamptz,timestamptz,text,uuid,jsonb,jsonb) FROM PUBLIC;

-- Migratie 0072: begrens rechtstreekse statuswijzigingen.
SET search_path = fabriek, public;

-- Alleen gecontroleerde triggers/functies mogen de productie- of
-- kwaliteitsstatus veranderen. Planning krijgt een afzonderlijke overgang.
CREATE FUNCTION execution_object_status_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
 IF current_user = pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID)) OR NOT pg_has_role(current_user,'mes_app','MEMBER') THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='batch' THEN
   IF (NEW.status,NEW.lot_id,NEW.gestart_op,NEW.vervallen_reden)
      IS DISTINCT FROM (OLD.status,OLD.lot_id,OLD.gestart_op,OLD.vervallen_reden) THEN
      RAISE EXCEPTION 'Batchstatus uitsluitend via gecontroleerde overgang' USING ERRCODE='42501';
   END IF;
 ELSE
   IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Lotstatus uitsluitend via gecontroleerde overgang' USING ERRCODE='42501';
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER batch_00_status_guard BEFORE UPDATE ON batch
 FOR EACH ROW EXECUTE FUNCTION execution_object_status_guard();
CREATE TRIGGER lot_00_status_guard BEFORE UPDATE ON lot
 FOR EACH ROW EXECUTE FUNCTION execution_object_status_guard();

-- Deze triggers worden uitsluitend geactiveerd door registratie of besluit.
-- De bijbehorende registratieguard moet vóór de statusovergang uitvoeren.
ALTER FUNCTION start_geplande_batch() SECURITY DEFINER;
ALTER FUNCTION start_geplande_batch() SET search_path=pg_catalog,fabriek,pg_temp;
ALTER FUNCTION werk_lotstatus_bij() SECURITY DEFINER;
ALTER FUNCTION werk_lotstatus_bij() SET search_path=pg_catalog,fabriek,pg_temp;

CREATE FUNCTION execution_batch_hold(p_batch uuid,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_actor uuid; v_batch batch%ROWTYPE;
BEGIN
 v_actor:=execution_transaction_actor();
 SELECT * INTO v_batch FROM batch WHERE id=p_batch FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende batch'; END IF;
 IF length(btrim(coalesce(p_reason,'')))=0 THEN RAISE EXCEPTION 'Motivatie vereist'; END IF;
 IF NOT (authorization_permits(v_actor,'execution.hold',NULL,v_batch.product_id,NULL)
         OR authorization_permits(v_actor,'inspection.hold',NULL,v_batch.product_id,NULL)) THEN
    RAISE EXCEPTION 'Geen actuele blokkadebevoegdheid' USING ERRCODE='42501';
 END IF;
 INSERT INTO batch_besluit(batch_id,besluit,reden,besloten_door)
 VALUES(p_batch,'in_beoordeling',btrim(p_reason),v_actor);
END $$;

CREATE FUNCTION execution_cancel_planned_batch(p_number text,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_actor uuid; v_batch batch%ROWTYPE;
BEGIN
 v_actor:=execution_transaction_actor();
 SELECT * INTO v_batch FROM batch WHERE batchnummer=p_number FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF NOT authorization_permits(v_actor,'planning.manage',NULL,v_batch.product_id,NULL) THEN
   RAISE EXCEPTION 'Geen actuele planningsbevoegdheid' USING ERRCODE='42501';
 END IF;
 IF v_batch.status<>'gepland' OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 500 THEN
   RAISE EXCEPTION 'Alleen geplande batch met motivatie kan vervallen';
 END IF;
 UPDATE batch SET status='vervallen',vervallen_reden=btrim(p_reason) WHERE id=v_batch.id;
 RETURN v_batch.id;
END $$;

-- Lotsamenstelling via bestaande bedrijfsregels, maar alleen met een bewezen
-- persoonlijke actor en actuele bevoegdheid voor alle opgegeven batchleden.
CREATE FUNCTION execution_create_lot(p_number text,p_batches uuid[],p_pc uuid,p_operator uuid,
 p_lot_id uuid,p_registration_id uuid,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_actor uuid; v_batch batch%ROWTYPE; v_count int:=0;
BEGIN
 v_actor:=execution_transaction_actor();
 IF NOT EXISTS (SELECT 1 FROM operator WHERE id=p_operator AND gebruiker_id=v_actor AND actief)
 OR NOT EXISTS (SELECT 1 FROM pc WHERE id=p_pc AND actief) THEN
   RAISE EXCEPTION 'Persoonlijke operator en actief werkstation vereist' USING ERRCODE='42501';
 END IF;
 FOR v_batch IN SELECT * FROM batch WHERE id=ANY(p_batches) ORDER BY id FOR UPDATE LOOP
   v_count:=v_count+1;
   IF NOT authorization_permits(v_actor,'execution.lot.create',NULL,v_batch.product_id,NULL) THEN
     RAISE EXCEPTION 'Geen actuele lotsamenstellingsbevoegdheid' USING ERRCODE='42501';
   END IF;
 END LOOP;
 IF v_count=0 OR v_count<>cardinality(p_batches) THEN RAISE EXCEPTION 'Ongeldige batchleden'; END IF;
 RETURN maak_lot(p_number,p_batches,p_pc,p_operator,p_lot_id,p_registration_id,p_reason);
END $$;
REVOKE ALL ON FUNCTION execution_object_status_guard(),start_geplande_batch(),werk_lotstatus_bij(),
 execution_batch_hold(uuid,text),execution_cancel_planned_batch(text,text),execution_create_lot(text,uuid[],uuid,uuid,uuid,uuid,text),
 maak_lot(text,uuid[],uuid,uuid,uuid,uuid,text) FROM PUBLIC;

-- Migratie 0073: gecontroleerde tijdelijke batchcreatie (D98).
SET search_path = fabriek, public;

-- Tijdelijke PoC-route zonder productieopdracht of productspecificatie.
-- Geen extra planningsfunctionaliteit; vervalt bij de Job Order-integratie.
CREATE FUNCTION execution_create_legacy_batch(p_id uuid,p_number text,p_operator uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_actor uuid; v_id uuid; v_existing batch%ROWTYPE;
BEGIN
 v_actor:=execution_transaction_actor();
 IF NOT authorization_permits(v_actor,'execution.batch.create',NULL,NULL,NULL)
 OR NOT EXISTS (SELECT 1 FROM operator WHERE id=p_operator AND gebruiker_id=v_actor AND actief) THEN
   RAISE EXCEPTION 'Geen bevoegdheid voor tijdelijke batchcreatie' USING ERRCODE='42501';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtext('fabriek.batchnummer'));
 IF p_id IS NOT NULL THEN
   SELECT * INTO v_existing FROM batch WHERE id=p_id FOR UPDATE;
   IF FOUND THEN
     IF v_existing.batchnummer IS DISTINCT FROM p_number OR v_existing.bron<>'operator'
        OR v_existing.aangemaakt_door IS DISTINCT FROM p_operator THEN
        RAISE EXCEPTION 'Dit id hoort bij een andere batch';
     END IF;
     RETURN v_existing.id;
   END IF;
 END IF;
 INSERT INTO batch(id,batchnummer,bron,aangemaakt_door)
 VALUES(coalesce(p_id,gen_random_uuid()),p_number,'operator',p_operator) RETURNING id INTO v_id;
 RETURN v_id;
END $$;

CREATE FUNCTION execution_plan_legacy_batches(p_count int,p_day date,p_product uuid,p_note text)
RETURNS SETOF text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_actor uuid;
BEGIN
 v_actor:=execution_transaction_actor();
 IF NOT authorization_permits(v_actor,'planning.manage',NULL,p_product,NULL) THEN
   RAISE EXCEPTION 'Geen actuele planningsbevoegdheid' USING ERRCODE='42501';
 END IF;
 RETURN QUERY SELECT * FROM plan_batches(p_count,p_day,p_product,p_note,v_actor);
END $$;

-- Beperk directe wijziging van de herkomst en van planningscontext.
CREATE FUNCTION execution_batch_metadata_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_actor uuid;
BEGIN
 IF current_user = pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID)) OR NOT pg_has_role(current_user,'mes_app','MEMBER') THEN RETURN NEW; END IF;
 IF (NEW.id,NEW.batchnummer,NEW.bron,NEW.aangemaakt_op,NEW.aangemaakt_door,NEW.gepland_door)
 IS DISTINCT FROM (OLD.id,OLD.batchnummer,OLD.bron,OLD.aangemaakt_op,OLD.aangemaakt_door,OLD.gepland_door) THEN
   RAISE EXCEPTION 'Oorspronkelijke batchherkomst mag niet wijzigen' USING ERRCODE='42501';
 END IF;
 IF (NEW.geplande_dag,NEW.volgorde,NEW.product_id,NEW.opmerking)
 IS DISTINCT FROM (OLD.geplande_dag,OLD.volgorde,OLD.product_id,OLD.opmerking) THEN
   v_actor:=execution_transaction_actor();
   IF NOT authorization_permits(v_actor,'planning.manage',NULL,OLD.product_id,NULL)
      OR NOT authorization_permits(v_actor,'planning.manage',NULL,NEW.product_id,NULL) THEN
     RAISE EXCEPTION 'Geen actuele planningsbevoegdheid' USING ERRCODE='42501';
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER batch_01_metadata BEFORE UPDATE ON batch
 FOR EACH ROW EXECUTE FUNCTION execution_batch_metadata_guard();

REVOKE ALL ON FUNCTION execution_create_legacy_batch(uuid,text,uuid),execution_plan_legacy_batches(int,date,uuid,text),
 execution_batch_metadata_guard(),plan_batches(int,date,uuid,text,uuid) FROM PUBLIC;

-- Migratie 0074: gecontroleerde processtart en afronding.
SET search_path = fabriek, public;

CREATE FUNCTION execution_step_permission(p_actor uuid,p_batch uuid,p_lot uuid,p_permission text,p_completion boolean)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_batch batch%ROWTYPE; v_status text; v_count int:=0;
BEGIN
 IF (p_batch IS NULL)=(p_lot IS NULL) THEN RAISE EXCEPTION 'Kies batch of lot'; END IF;
 IF p_batch IS NOT NULL THEN
   SELECT * INTO v_batch FROM batch WHERE id=p_batch FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende batch'; END IF;
   IF v_batch.status NOT IN ('gepland','in_productie') OR (p_completion AND v_batch.status<>'in_productie') THEN
     RAISE EXCEPTION 'Batchstatus blokkeert proceshandeling';
   END IF;
   IF NOT authorization_permits(p_actor,p_permission,NULL,v_batch.product_id,NULL) THEN
     RAISE EXCEPTION 'Geen actuele procesbevoegdheid' USING ERRCODE='42501';
   END IF;
 ELSE
   SELECT status INTO v_status FROM lot WHERE id=p_lot FOR UPDATE;
   IF NOT FOUND OR v_status='geblokkeerd' OR (p_completion AND v_status<>'in_productie') THEN
     RAISE EXCEPTION 'Lotstatus blokkeert proceshandeling';
   END IF;
   FOR v_batch IN SELECT * FROM batch WHERE lot_id=p_lot ORDER BY id FOR SHARE LOOP
     v_count:=v_count+1;
     IF v_batch.status<>'in_lot' OR NOT authorization_permits(p_actor,p_permission,NULL,v_batch.product_id,NULL) THEN
       RAISE EXCEPTION 'Batchlid blokkeert proceshandeling of scope' USING ERRCODE='42501';
     END IF;
   END LOOP;
   IF v_count=0 THEN RAISE EXCEPTION 'Lot zonder batchleden'; END IF;
 END IF;
END $$;

CREATE FUNCTION execution_step_start(p_code text,p_batch uuid,p_lot uuid,p_pc uuid,p_operator uuid,p_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_actor uuid; v_stap processtap%ROWTYPE;
BEGIN
 v_actor:=execution_transaction_actor();
 IF NOT EXISTS (SELECT 1 FROM operator WHERE id=p_operator AND gebruiker_id=v_actor AND actief)
 OR NOT EXISTS (SELECT 1 FROM pc WHERE id=p_pc AND actief) THEN
   RAISE EXCEPTION 'Persoonlijke operator en actief werkstation vereist' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_stap FROM processtap WHERE code=p_code AND actief;
 IF NOT FOUND OR v_stap.is_lot_stap THEN RAISE EXCEPTION 'Onbekende stap of afzonderlijke lotsamenstelling vereist'; END IF;
 PERFORM execution_step_permission(v_actor,p_batch,p_lot,
    CASE WHEN v_stap.soort='keuring' THEN 'inspection.start' ELSE 'execution.start' END,false);
 RETURN start_stap(p_code,p_batch,p_lot,p_pc,p_operator,p_id);
END $$;

CREATE FUNCTION execution_step_complete(p_registration uuid,p_operator uuid,p_pc uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_actor uuid; v_reg stapregistratie%ROWTYPE;
BEGIN
 v_actor:=execution_transaction_actor();
 IF NOT EXISTS (SELECT 1 FROM operator WHERE id=p_operator AND gebruiker_id=v_actor AND actief)
 OR NOT EXISTS (SELECT 1 FROM pc WHERE id=p_pc AND actief) THEN
   RAISE EXCEPTION 'Persoonlijke operator en actief werkstation vereist' USING ERRCODE='42501';
 END IF;
 SELECT * INTO v_reg FROM stapregistratie WHERE id=p_registration FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende registratie'; END IF;
 PERFORM execution_step_permission(v_actor,v_reg.batch_id,v_reg.lot_id,'execution.complete',true);
 IF EXISTS (SELECT 1 FROM invoerconflict WHERE stapregistratie_id=p_registration AND status='open') THEN
   RAISE EXCEPTION 'Open invoerconflict blokkeert afronding';
 END IF;
 PERFORM rond_stap_af(p_registration,p_operator,p_pc);
END $$;

CREATE FUNCTION execution_step_rework(p_lot uuid,p_code text,p_reason text,p_pc uuid,p_operator uuid,p_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_actor uuid;
BEGIN
 v_actor:=execution_transaction_actor();
 IF NOT EXISTS (SELECT 1 FROM operator WHERE id=p_operator AND gebruiker_id=v_actor AND actief)
 OR NOT EXISTS (SELECT 1 FROM pc WHERE id=p_pc AND actief) THEN
   RAISE EXCEPTION 'Persoonlijke operator en actief werkstation vereist' USING ERRCODE='42501';
 END IF;
 PERFORM execution_step_permission(v_actor,NULL,p_lot,'execution.rework',false);
 RETURN start_herbewerking(p_lot,p_code,p_reason,p_pc,p_operator,p_id);
END $$;

REVOKE ALL ON FUNCTION execution_step_permission(uuid,uuid,uuid,text,boolean),
 execution_step_start(text,uuid,uuid,uuid,uuid,uuid),execution_step_complete(uuid,uuid,uuid),
 execution_step_rework(uuid,text,text,uuid,uuid,uuid),start_stap(text,uuid,uuid,uuid,uuid,uuid),
 rond_stap_af(uuid,uuid,uuid),start_herbewerking(uuid,text,text,uuid,uuid,uuid) FROM PUBLIC;

-- Migratie 0075: behoud expliciete zoekpaden en beperk oude authenticatie-ingangen.
SET search_path = fabriek, public;

-- Ook functies die door een SECURITY DEFINER worden aangeroepen mogen
-- geen impliciet voorrang gevend pg_temp-zoekpad hebben.
DO $$
DECLARE f record;
BEGIN
 FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
 JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='fabriek' AND p.prokind='f'
 AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig,ARRAY[]::text[])) c
                 WHERE c LIKE 'search_path=%' AND c LIKE '%pg_temp')
 LOOP
   EXECUTE format('ALTER FUNCTION %s SET search_path=pg_catalog,fabriek,public,pg_temp',f.sig);
 END LOOP;
END $$;

REVOKE EXECUTE ON FUNCTION inloggen(text,text,text),change_password_confirmed(uuid,text,text) FROM PUBLIC;

-- Migratie 0076: expliciete functie-interface.
SET search_path = fabriek, public;

-- Geen impliciete PUBLIC-uitvoering voor de functies in deze installatie.
-- De rechteninstallatie kent de expliciete applicatie-interface daarna toe.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA fabriek FROM PUBLIC;

-- Migratie 0078: expliciete leesinterface, ook oude kolomgrants intrekken.
SET search_path = fabriek, public;
REVOKE SELECT ON ALL TABLES IN SCHEMA fabriek FROM PUBLIC;

-- Migratie 0077: expliciete schrijfrechten voor de tijdelijke applicatie-interface.
SET search_path = fabriek, public;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON ALL TABLES IN SCHEMA fabriek FROM PUBLIC;
-- Bestaande directe app-grants worden bij db/rechten.sql vervangen door
-- een expliciete lijst. Leesrechten worden in een afzonderlijke stap beperkt.

-- Migratie 0079: alleen de configuratietrigger en gecontroleerde eigenaarpaden schrijven het logboek.
SET search_path = fabriek, public;
ALTER FUNCTION log_config() SECURITY DEFINER;
ALTER FUNCTION log_config() SET search_path = pg_catalog,fabriek,pg_temp;
REVOKE ALL ON FUNCTION log_config() FROM PUBLIC;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON fabriek.config_log FROM PUBLIC;

-- Migratie 0080: auditidentiteit uit gevalideerde persoonlijke sessie, nooit een vrije naam.
SET search_path = fabriek, public;
CREATE OR REPLACE FUNCTION log_config() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE
    v_oud   jsonb;
    v_nieuw jsonb;
    v_actor uuid;
    v_label text;
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
    v_actor := execution_session_actor(current_setting('fabriek.execution_proof', true));
    IF v_actor IS NOT NULL THEN
        SELECT gebruikersnaam INTO v_label FROM gebruiker WHERE id=v_actor;
    ELSE
        -- Een vrije GUC is geen bewijs. Ook eigenaar- en herstelpaden
        -- zonder persoonlijk bewijs krijgen geen verzonnen persoonsidentiteit.
        v_label := '[niet persoonlijk bewezen]';
    END IF;
    INSERT INTO config_log (tabel, record_id, actie, oud, nieuw, gewijzigd_door)
    VALUES (TG_TABLE_NAME,
            coalesce((coalesce(v_nieuw, v_oud) ->> 'id')::uuid, (coalesce(v_nieuw, v_oud) ->> 'pc_id')::uuid,
                     (coalesce(v_nieuw, v_oud) ->> 'product_id')::uuid),
            TG_OP, v_oud, v_nieuw,
            v_label);
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION log_config() FROM PUBLIC;

-- Migratie 0081: stabiele identiteit en expliciete bewijsstatus, geen historische reconstructie.
SET search_path = fabriek, public;
ALTER TABLE config_log ADD COLUMN actor_user_id uuid REFERENCES gebruiker(id);
ALTER TABLE config_log ADD COLUMN actor_origin text NOT NULL DEFAULT 'historical';
ALTER TABLE config_log ALTER COLUMN actor_origin SET DEFAULT 'unverified';
ALTER TABLE config_log ADD CONSTRAINT config_log_actor_origin_check CHECK (
 (actor_origin = 'personal' AND actor_user_id IS NOT NULL)
 OR (actor_origin IN ('historical','unverified') AND actor_user_id IS NULL)
);
CREATE OR REPLACE FUNCTION log_config() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE
    v_oud   jsonb;
    v_nieuw jsonb;
    v_actor uuid;
    v_label text;
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
    v_actor := execution_session_actor(current_setting('fabriek.execution_proof', true));
    IF v_actor IS NOT NULL THEN
        SELECT gebruikersnaam INTO v_label FROM gebruiker WHERE id=v_actor;
    ELSE
        -- Een vrije GUC is geen bewijs. Ook eigenaar- en herstelpaden
        -- zonder persoonlijk bewijs krijgen geen verzonnen persoonsidentiteit.
        v_label := '[niet persoonlijk bewezen]';
    END IF;
    INSERT INTO config_log (tabel, record_id, actie, oud, nieuw, gewijzigd_door, actor_user_id, actor_origin)
    VALUES (TG_TABLE_NAME,
            coalesce((coalesce(v_nieuw, v_oud) ->> 'id')::uuid, (coalesce(v_nieuw, v_oud) ->> 'pc_id')::uuid,
                     (coalesce(v_nieuw, v_oud) ->> 'product_id')::uuid),
            TG_OP, v_oud, v_nieuw,
            v_label, v_actor, CASE WHEN v_actor IS NULL THEN 'unverified' ELSE 'personal' END);
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION log_config() FROM PUBLIC;

-- D101: meldingen uit bestaande bedrijfsgebeurtenissen, geen oude accountrol.
SET search_path = fabriek, public;

-- Tijdelijke globale routering: historische ontvangerscategorieën zijn
-- berichtmetadata, nooit de rol van het ingelogde account. Hal is geen area.
CREATE FUNCTION notification_recipient(p_user uuid,p_roles text[])
RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,fabriek,pg_temp AS $$
 SELECT authorization_permits(p_user,'analysis.execution.read',NULL,NULL,NULL)
 OR ('ploegleider'=ANY(p_roles) AND authorization_permits(p_user,'execution.correct',NULL,NULL,NULL))
 OR ('kwaliteit'=ANY(p_roles) AND authorization_permits(p_user,'inspection.decide',NULL,NULL,NULL))
 OR ('planner'=ANY(p_roles) AND authorization_permits(p_user,'planning.manage',NULL,NULL,NULL))
 OR ('productiemanager'=ANY(p_roles) AND authorization_permits(p_user,'operations.rework.order',NULL,NULL,NULL))
$$;

CREATE FUNCTION notification_read_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid;
BEGIN
 IF current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID)) THEN RETURN NEW; END IF;
 actor:=execution_transaction_actor();
 IF NEW.gebruiker_id IS DISTINCT FROM actor OR NOT EXISTS (
    SELECT 1 FROM melding m WHERE m.id=NEW.melding_id
      AND m.aangemaakt_op>now()-interval '30 days' AND notification_recipient(actor,m.voor_rollen)
 ) THEN RAISE EXCEPTION 'Geen persoonlijke MES-meldingsbevoegdheid' USING ERRCODE='42501'; END IF;
 NEW.gelezen_op:=clock_timestamp();
 RETURN NEW;
END $$;
CREATE TRIGGER melding_gelezen_identity BEFORE INSERT ON melding_gelezen
 FOR EACH ROW EXECUTE FUNCTION notification_read_guard();

-- Alleen de vaste bestaande event-triggers mogen systeemmeldingen schrijven.
ALTER FUNCTION meld_waarde() SECURITY DEFINER;
ALTER FUNCTION meld_besluit() SECURITY DEFINER;
ALTER FUNCTION meld_lotvoorstel() SECURITY DEFINER;
ALTER FUNCTION meld_stilstand() SECURITY DEFINER;
ALTER FUNCTION meld_herbewerking() SECURITY DEFINER;
ALTER FUNCTION meld_keuring() SECURITY DEFINER;
ALTER FUNCTION meld_invoerconflict() SECURITY DEFINER;
ALTER FUNCTION meld_waarde() SET search_path=pg_catalog,fabriek,pg_temp;
ALTER FUNCTION meld_besluit() SET search_path=pg_catalog,fabriek,pg_temp;
ALTER FUNCTION meld_lotvoorstel() SET search_path=pg_catalog,fabriek,pg_temp;
ALTER FUNCTION meld_stilstand() SET search_path=pg_catalog,fabriek,pg_temp;
ALTER FUNCTION meld_herbewerking() SET search_path=pg_catalog,fabriek,pg_temp;
ALTER FUNCTION meld_keuring() SET search_path=pg_catalog,fabriek,pg_temp;
ALTER FUNCTION meld_invoerconflict() SET search_path=pg_catalog,fabriek,pg_temp;
REVOKE ALL ON FUNCTION notification_recipient(uuid,text[]),notification_read_guard(),
 meld_waarde(),meld_besluit(),meld_lotvoorstel(),meld_stilstand(),meld_herbewerking(),meld_keuring(),meld_invoerconflict() FROM PUBLIC;

-- Migratie 0083: configuratiewrites vereisen actuele persoonlijke MES-autorisatie (D100/D101).
SET search_path = fabriek, public;

-- Globale bevoegdheid conform de bestaande API-contracten. Geen scope
-- afleiden uit een clientwaarde. De eigenaar blijft voor gecontroleerd
-- onderhoud en bestaande SECURITY DEFINER-processen verantwoordelijk.
CREATE FUNCTION configuration_write_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_actor uuid;
BEGIN
 IF current_user <> pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID)) THEN
   v_actor:=execution_transaction_actor();
   IF NOT authorization_permits(v_actor,TG_ARGV[0],NULL,NULL,NULL) THEN
     RAISE EXCEPTION 'Geen actuele MES-configuratiebevoegdheid: %',TG_ARGV[0] USING ERRCODE='42501';
   END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION configuration_write_guard() FROM PUBLIC;

-- Na bestaande identiteitstriggers; vóór log_config en overige wijzigingen.
CREATE TRIGGER processtap_0_mes_permission BEFORE INSERT OR UPDATE OR DELETE ON processtap
 FOR EACH ROW EXECUTE FUNCTION configuration_write_guard('process.parameter.manage');
CREATE TRIGGER veld_0_mes_permission BEFORE INSERT OR UPDATE OR DELETE ON veld
 FOR EACH ROW EXECUTE FUNCTION configuration_write_guard('process.parameter.manage');
CREATE TRIGGER veld_product_0_mes_permission BEFORE INSERT OR UPDATE OR DELETE ON veld_product
 FOR EACH ROW EXECUTE FUNCTION configuration_write_guard('process.parameter.manage');
CREATE TRIGGER product_0_mes_permission BEFORE INSERT OR UPDATE OR DELETE ON product
 FOR EACH ROW EXECUTE FUNCTION configuration_write_guard('engineering.product.manage');
CREATE TRIGGER product_stap_0_mes_permission BEFORE INSERT OR UPDATE OR DELETE ON product_stap
 FOR EACH ROW EXECUTE FUNCTION configuration_write_guard('engineering.product.manage');
CREATE TRIGGER grondstof_0_mes_permission BEFORE INSERT OR UPDATE OR DELETE ON grondstof
 FOR EACH ROW EXECUTE FUNCTION configuration_write_guard('material.definition.manage');
CREATE TRIGGER stap_grondstof_0_mes_permission BEFORE INSERT OR UPDATE OR DELETE ON stap_grondstof
 FOR EACH ROW EXECUTE FUNCTION configuration_write_guard('material.definition.manage');
CREATE TRIGGER pc_0_mes_permission BEFORE INSERT OR UPDATE OR DELETE ON pc
 FOR EACH ROW EXECUTE FUNCTION configuration_write_guard('workstation.manage');
CREATE TRIGGER pc_stap_0_mes_permission BEFORE INSERT OR UPDATE OR DELETE ON pc_stap
 FOR EACH ROW EXECUTE FUNCTION configuration_write_guard('workstation.manage');
CREATE TRIGGER gebruiker_0_mes_permission BEFORE INSERT OR UPDATE OR DELETE ON gebruiker
 FOR EACH ROW EXECUTE FUNCTION configuration_write_guard('account.manage');
CREATE TRIGGER operator_0_mes_permission BEFORE INSERT OR UPDATE OR DELETE ON operator
 FOR EACH ROW EXECUTE FUNCTION configuration_write_guard('personnel.manage');
CREATE TRIGGER ploeg_0_mes_permission BEFORE INSERT OR UPDATE OR DELETE ON ploeg
 FOR EACH ROW EXECUTE FUNCTION configuration_write_guard('shift.manage');
CREATE TRIGGER rooster_0_mes_permission BEFORE INSERT OR UPDATE OR DELETE ON rooster
 FOR EACH ROW EXECUTE FUNCTION configuration_write_guard('shift.manage');
CREATE TRIGGER rooster_ploeg_0_mes_permission BEFORE INSERT OR UPDATE OR DELETE ON rooster_ploeg
 FOR EACH ROW EXECUTE FUNCTION configuration_write_guard('shift.manage');
CREATE TRIGGER stilstand_oorzaak_0_mes_permission BEFORE INSERT OR UPDATE OR DELETE ON stilstand_oorzaak
 FOR EACH ROW EXECUTE FUNCTION configuration_write_guard('downtime.reason.manage');
CREATE TRIGGER capaciteit_stap_0_mes_permission BEFORE INSERT OR UPDATE OR DELETE ON capaciteit_stap
 FOR EACH ROW EXECUTE FUNCTION configuration_write_guard('planning.manage');
CREATE TRIGGER capaciteit_afwijking_0_mes_permission BEFORE INSERT OR UPDATE OR DELETE ON capaciteit_afwijking
 FOR EACH ROW EXECUTE FUNCTION configuration_write_guard('planning.manage');

-- Migratie 0084: persoonlijke operationele wijzigingen (D100/D101).
SET search_path = fabriek, public;

CREATE FUNCTION operations_write_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid;
BEGIN
 IF current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID)) THEN
   IF TG_OP='DELETE' THEN RETURN OLD; END IF;
   RETURN NEW;
 END IF;
 actor:=execution_transaction_actor();
 IF NOT authorization_permits(actor,TG_ARGV[0],NULL,NULL,NULL) THEN
   RAISE EXCEPTION 'Geen actuele MES-operationele bevoegdheid: %',TG_ARGV[0] USING ERRCODE='42501';
 END IF;
 IF TG_TABLE_NAME='stilstand' THEN
   IF TG_OP='INSERT' THEN
     IF NEW.gemeld_door IS DISTINCT FROM actor OR NEW.eind_op IS NOT NULL OR NEW.beeindigd_door IS NOT NULL OR NEW.eind_notitie IS NOT NULL
       OR (NEW.operator_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM operator WHERE id=NEW.operator_id AND gebruiker_id=actor AND actief)) THEN
       RAISE EXCEPTION 'Ongeldige persoonlijke stilstandmelding' USING ERRCODE='42501';
     END IF;
   ELSIF TG_OP='UPDATE' THEN
     IF NEW.id IS DISTINCT FROM OLD.id OR NEW.eind_op IS NULL
       OR (NEW.beeindigd_door IS NOT NULL AND NOT EXISTS (SELECT 1 FROM operator WHERE id=NEW.beeindigd_door AND gebruiker_id=actor AND actief)) THEN
       RAISE EXCEPTION 'Ongeldige persoonlijke stilstandbeëindiging' USING ERRCODE='42501';
     END IF;
   END IF;
 ELSIF TG_TABLE_NAME='overdracht' AND TG_OP='INSERT' THEN
   IF NEW.gebruiker_id IS DISTINCT FROM actor
     OR (NEW.operator_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM operator WHERE id=NEW.operator_id AND gebruiker_id=actor AND actief)) THEN
     RAISE EXCEPTION 'Ongeldige persoonlijke overdracht' USING ERRCODE='42501';
   END IF;
 ELSIF TG_TABLE_NAME='stapplanning' AND TG_OP='INSERT' THEN
   IF NEW.aangemaakt_door IS DISTINCT FROM actor THEN
     RAISE EXCEPTION 'Ongeldige persoonlijke stapplanning' USING ERRCODE='42501';
   END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION operations_write_guard() FROM PUBLIC;
CREATE TRIGGER stilstand_0_mes_permission BEFORE INSERT OR UPDATE ON stilstand
 FOR EACH ROW EXECUTE FUNCTION operations_write_guard('downtime.record');
CREATE TRIGGER overdracht_0_mes_permission BEFORE INSERT ON overdracht
 FOR EACH ROW EXECUTE FUNCTION operations_write_guard('handover.record');
CREATE TRIGGER stapplanning_0_mes_permission BEFORE INSERT OR DELETE ON stapplanning
 FOR EACH ROW EXECUTE FUNCTION operations_write_guard('planning.manage');

-- Alleen de bestaande gecontroleerde opslagfunctie mag voorstelleden wijzigen.
-- Geen nieuw lotmodel: de bestaande PoC-regels blijven voorlopig gelden.
CREATE FUNCTION planning_save_legacy_proposal(p_id uuid,p_batches uuid[],p_note text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid;
BEGIN
 actor:=execution_transaction_actor();
 IF NOT authorization_permits(actor,'planning.manage',NULL,NULL,NULL) THEN
   RAISE EXCEPTION 'Geen actuele MES-planningsbevoegdheid' USING ERRCODE='42501';
 END IF;
 -- Serialiseer tijdelijke voorstelwijzigingen en vergrendel bestaande voorstellen.
 PERFORM pg_advisory_xact_lock(84001);
 IF p_id IS NOT NULL THEN
   PERFORM 1 FROM lot_voorstel WHERE id=p_id FOR UPDATE;
 END IF;
 PERFORM 1 FROM batch WHERE id=ANY(p_batches) ORDER BY id FOR UPDATE;
 RETURN bewaar_lot_voorstel(p_id,p_batches,p_note,actor);
END $$;

CREATE FUNCTION planning_cancel_legacy_proposal(p_number int)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; target uuid;
BEGIN
 actor:=execution_transaction_actor();
 IF NOT authorization_permits(actor,'planning.manage',NULL,NULL,NULL) THEN
   RAISE EXCEPTION 'Geen actuele MES-planningsbevoegdheid' USING ERRCODE='42501';
 END IF;
 PERFORM pg_advisory_xact_lock(84001);
 UPDATE lot_voorstel SET status='vervallen',afgesloten_op=now()
 WHERE nummer=p_number AND status='open' RETURNING id INTO target;
 IF target IS NOT NULL THEN DELETE FROM stapplanning WHERE voorstel_id=target; END IF;
 RETURN target;
END $$;
REVOKE ALL ON FUNCTION planning_save_legacy_proposal(uuid,uuid[],text),planning_cancel_legacy_proposal(int) FROM PUBLIC;

-- Lotvorming gebruikt dezelfde transactievergrendeling als voorstelbeheer.
CREATE OR REPLACE FUNCTION execution_create_lot(p_number text,p_batches uuid[],p_pc uuid,p_operator uuid,
 p_lot_id uuid,p_registration_id uuid,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_actor uuid; v_batch batch%ROWTYPE; v_count int:=0;
BEGIN
 v_actor:=execution_transaction_actor();
 PERFORM pg_advisory_xact_lock(84001);
 IF NOT EXISTS (SELECT 1 FROM operator WHERE id=p_operator AND gebruiker_id=v_actor AND actief)
 OR NOT EXISTS (SELECT 1 FROM pc WHERE id=p_pc AND actief) THEN
   RAISE EXCEPTION 'Persoonlijke operator en actief werkstation vereist' USING ERRCODE='42501';
 END IF;
 FOR v_batch IN SELECT * FROM batch WHERE id=ANY(p_batches) ORDER BY id FOR UPDATE LOOP
   v_count:=v_count+1;
   IF NOT authorization_permits(v_actor,'execution.lot.create',NULL,v_batch.product_id,NULL) THEN
     RAISE EXCEPTION 'Geen actuele lotsamenstellingsbevoegdheid' USING ERRCODE='42501';
   END IF;
 END LOOP;
 IF v_count=0 OR v_count<>cardinality(p_batches) THEN RAISE EXCEPTION 'Ongeldige batchleden'; END IF;
 RETURN maak_lot(p_number,p_batches,p_pc,p_operator,p_lot_id,p_registration_id,p_reason);
END $$;

-- Dit schema staat gelijk aan alle migraties hieronder (bij een nieuwe migratie een regel toevoegen).
-- Migratie 0085: uitsluitend eerste, onafhankelijk bevestigde personeelskoppeling.
SET search_path = fabriek, public;

CREATE TABLE authorization_personnel_link (
    personnel_id uuid PRIMARY KEY REFERENCES operator(id),
    user_id uuid NOT NULL UNIQUE REFERENCES gebruiker(id),
    requested_by uuid NOT NULL REFERENCES gebruiker(id),
    approved_by uuid NOT NULL REFERENCES gebruiker(id),
    reason text NOT NULL CHECK (btrim(reason)<>''),
    linked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (user_id<>requested_by AND user_id<>approved_by AND requested_by<>approved_by)
);
CREATE TRIGGER authorization_personnel_link_immutable BEFORE UPDATE OR DELETE ON authorization_personnel_link
    FOR EACH ROW EXECUTE FUNCTION authorization_audit_immutable();
REVOKE ALL ON authorization_personnel_link FROM PUBLIC;

-- Eigenaar faciliteert de handeling; twee actuele MES-permissions en twee
-- persoonlijke wachtwoordbevestigingen zijn vereist. Geen grants of historische
-- registraties wijzigen. De organisatie verifieert dat beide IDs dezelfde persoon betreffen.
CREATE FUNCTION authorization_link_personnel_confirmed(p_personnel uuid,p_user uuid,p_requester uuid,p_approver uuid,
    p_reason text,p_requester_password text,p_approver_password text)
RETURNS text LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_a text; v_b text; v_login record;
BEGIN
    IF current_user <> pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='fabriek.operator'::regclass)) THEN
        RAISE EXCEPTION 'Personeelskoppeling vereist database-eigenaar';
    END IF;
    IF p_personnel IS NULL OR p_user IS NULL OR p_requester IS NULL OR p_approver IS NULL
       OR p_user=p_requester OR p_user=p_approver OR p_requester=p_approver
       OR btrim(coalesce(p_reason,''))='' THEN
        RAISE EXCEPTION 'Onafhankelijke identiteiten en reden vereist';
    END IF;
    PERFORM id FROM gebruiker WHERE id IN (p_user,p_requester,p_approver) ORDER BY id FOR UPDATE;
    PERFORM id FROM operator WHERE id=p_personnel FOR UPDATE;
    IF NOT EXISTS (SELECT 1 FROM gebruiker WHERE id=p_user AND actief AND NOT gedeeld AND NOT wachtwoord_wijzigen)
       OR NOT EXISTS (SELECT 1 FROM operator WHERE id=p_personnel AND actief AND gebruiker_id IS NULL)
       OR EXISTS (SELECT 1 FROM operator WHERE gebruiker_id=p_user)
       OR EXISTS (SELECT 1 FROM authorization_personnel_link WHERE personnel_id=p_personnel OR user_id=p_user) THEN
        RAISE EXCEPTION 'Uitsluitend eerste koppeling van actieve persoonlijke identiteiten toegestaan';
    END IF;
    IF NOT authorization_permits(p_requester,'personnel.manage',NULL,NULL,NULL)
       OR NOT authorization_permits(p_approver,'authorization.approve',NULL,NULL,NULL) THEN
        RAISE EXCEPTION 'Onafhankelijke bevoegde personeelsbeheerder en securitybeoordelaar vereist';
    END IF;
    SELECT gebruikersnaam INTO v_a FROM gebruiker WHERE id=p_requester;
    SELECT gebruikersnaam INTO v_b FROM gebruiker WHERE id=p_approver;
    SELECT * INTO v_login FROM inloggen(v_a,p_requester_password,NULL);
    IF v_login.wacht_seconden IS NOT NULL THEN RETURN 'locked'; END IF;
    IF v_login.id IS DISTINCT FROM p_requester THEN RETURN 'denied'; END IF;
    SELECT * INTO v_login FROM inloggen(v_b,p_approver_password,NULL);
    IF v_login.wacht_seconden IS NOT NULL THEN RETURN 'locked'; END IF;
    IF v_login.id IS DISTINCT FROM p_approver THEN RETURN 'denied'; END IF;
    UPDATE operator SET gebruiker_id=p_user WHERE id=p_personnel;
    INSERT INTO authorization_personnel_link(personnel_id,user_id,requested_by,approved_by,reason)
      VALUES(p_personnel,p_user,p_requester,p_approver,p_reason);
    RETURN 'linked';
END $$;
REVOKE ALL ON FUNCTION authorization_link_personnel_confirmed(uuid,uuid,uuid,uuid,text,text,text) FROM PUBLIC;

-- Migratie 0086: begrensde operationele kwalificaties met onafhankelijk bewijs (D89 P02/P04/P05).
SET search_path = fabriek, public;

INSERT INTO authorization_permission(code,domain) VALUES
 ('qualification.issue','operations'),('qualification.approve','operations'),('qualification.revoke','operations');
INSERT INTO authorization_role_permission(role_code,permission_code) VALUES
 ('manufacturing_manager','qualification.issue'),('manufacturing_manager','qualification.approve'),
 ('manufacturing_manager','qualification.revoke');

CREATE TABLE qualification_issue (
    qualification_id uuid PRIMARY KEY REFERENCES personnel_qualification(id),
    requested_by uuid NOT NULL REFERENCES gebruiker(id),
    approved_by uuid NOT NULL REFERENCES gebruiker(id),
    evidence text NOT NULL CHECK (btrim(evidence)<>''),
    issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (requested_by<>approved_by)
);
CREATE TABLE qualification_revocation (
    qualification_id uuid PRIMARY KEY REFERENCES personnel_qualification(id),
    revoked_by uuid NOT NULL REFERENCES gebruiker(id),
    reason text NOT NULL CHECK (btrim(reason)<>''),
    revoked_at timestamptz NOT NULL
);
CREATE TRIGGER qualification_issue_immutable BEFORE UPDATE OR DELETE ON qualification_issue
 FOR EACH ROW EXECUTE FUNCTION authorization_audit_immutable();
CREATE TRIGGER qualification_revocation_immutable BEFORE UPDATE OR DELETE ON qualification_revocation
 FOR EACH ROW EXECUTE FUNCTION authorization_audit_immutable();
REVOKE ALL ON qualification_issue,qualification_revocation FROM PUBLIC;

-- Alleen expliciet aan operationele activiteiten gekoppelde definities.
-- Andere domeinen en niet-geclassificeerde kwalificaties blijven gesloten.
CREATE FUNCTION qualification_is_operations(p_code text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,fabriek,pg_temp AS $$
 SELECT EXISTS (SELECT 1 FROM activity_qualification WHERE qualification_code=p_code)
 AND NOT EXISTS (SELECT 1 FROM activity_qualification a JOIN authorization_permission p ON p.code=a.permission_code
   WHERE a.qualification_code=p_code AND p.domain<>'operations')
$$;

CREATE FUNCTION qualification_issue_confirmed(p_user uuid,p_code text,p_from timestamptz,p_until timestamptz,
 p_requester uuid,p_approver uuid,p_evidence text,p_requester_password text,p_approver_password text)
RETURNS TABLE(status text,qualification_id uuid)
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_name text; v_login record; v_id uuid;
BEGIN
 IF current_user<>pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='fabriek.personnel_qualification'::regclass)) THEN
   RAISE EXCEPTION 'Kwalificatietoekenning vereist database-eigenaar';
 END IF;
 IF p_user IS NULL OR p_requester IS NULL OR p_approver IS NULL
   OR p_user=p_requester OR p_user=p_approver OR p_requester=p_approver
   OR p_from IS NULL OR NOT isfinite(p_from) OR p_until IS NULL OR NOT isfinite(p_until)
   OR p_until<=p_from OR p_until<=clock_timestamp() OR btrim(coalesce(p_evidence,''))='' THEN
   RAISE EXCEPTION 'Onafhankelijke identiteiten, eindige geldigheid en bewijs vereist';
 END IF;
 PERFORM id FROM gebruiker WHERE id IN(p_user,p_requester,p_approver) ORDER BY id FOR UPDATE;
 LOCK TABLE activity_qualification IN SHARE MODE;
 PERFORM id FROM operator WHERE gebruiker_id=p_user AND actief FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM gebruiker WHERE id=p_user AND actief AND NOT gedeeld AND NOT wachtwoord_wijzigen) THEN
   RAISE EXCEPTION 'Actief persoonlijk gekoppeld doelaccount vereist';
 END IF;
 IF NOT qualification_is_operations(p_code) THEN RAISE EXCEPTION 'Geen geclassificeerde operationele kwalificatie'; END IF;
 IF NOT authorization_permits(p_requester,'qualification.issue',NULL,NULL,NULL)
   OR NOT authorization_permits(p_approver,'qualification.approve',NULL,NULL,NULL) THEN
   RAISE EXCEPTION 'Onafhankelijke inhoudelijk bevoegde beoordelaars vereist';
 END IF;
 IF EXISTS(SELECT 1 FROM personnel_qualification WHERE user_id=p_user AND qualification_code=p_code
   AND revoked_at IS NULL AND tstzrange(valid_from,valid_until,'[)') && tstzrange(p_from,p_until,'[)')) THEN
   RAISE EXCEPTION 'Overlappende kwalificatie';
 END IF;
 SELECT gebruikersnaam INTO v_name FROM gebruiker WHERE id=p_requester;
 SELECT * INTO v_login FROM inloggen(v_name,p_requester_password,NULL);
 IF v_login.wacht_seconden IS NOT NULL THEN RETURN QUERY SELECT 'locked'::text,NULL::uuid; RETURN; END IF;
 IF v_login.id IS DISTINCT FROM p_requester THEN RETURN QUERY SELECT 'denied'::text,NULL::uuid; RETURN; END IF;
 SELECT gebruikersnaam INTO v_name FROM gebruiker WHERE id=p_approver;
 SELECT * INTO v_login FROM inloggen(v_name,p_approver_password,NULL);
 IF v_login.wacht_seconden IS NOT NULL THEN RETURN QUERY SELECT 'locked'::text,NULL::uuid; RETURN; END IF;
 IF v_login.id IS DISTINCT FROM p_approver THEN RETURN QUERY SELECT 'denied'::text,NULL::uuid; RETURN; END IF;
 INSERT INTO personnel_qualification(user_id,qualification_code,valid_from,valid_until)
 VALUES(p_user,p_code,p_from,p_until) RETURNING id INTO v_id;
 INSERT INTO qualification_issue(qualification_id,requested_by,approved_by,evidence)
 VALUES(v_id,p_requester,p_approver,p_evidence);
 RETURN QUERY SELECT 'issued'::text,v_id;
END $$;

-- Beperkende maatregel: geen tweede bevestiging nodig om onveilige toegang te stoppen.
CREATE FUNCTION qualification_revoke_confirmed(p_id uuid,p_actor uuid,p_reason text,p_password text)
RETURNS text LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_target uuid; v_q personnel_qualification%ROWTYPE; v_name text; v_login record; v_now timestamptz;
BEGIN
 IF current_user<>pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='fabriek.personnel_qualification'::regclass)) THEN
   RAISE EXCEPTION 'Kwalificatie-intrekking vereist database-eigenaar';
 END IF;
 SELECT user_id INTO v_target FROM personnel_qualification WHERE id=p_id;
 IF NOT FOUND OR p_actor IS NULL OR v_target=p_actor OR btrim(coalesce(p_reason,''))='' THEN
   RAISE EXCEPTION 'Onafhankelijke intrekking en reden vereist';
 END IF;
 PERFORM id FROM gebruiker WHERE id IN(v_target,p_actor) ORDER BY id FOR UPDATE;
 LOCK TABLE activity_qualification IN SHARE MODE;
 SELECT * INTO v_q FROM personnel_qualification WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR v_q.user_id IS DISTINCT FROM v_target OR v_q.revoked_at IS NOT NULL
   OR NOT qualification_is_operations(v_q.qualification_code) THEN
   RAISE EXCEPTION 'Geen intrekbare operationele kwalificatie';
 END IF;
 IF NOT authorization_permits(p_actor,'qualification.revoke',NULL,NULL,NULL) THEN
   RAISE EXCEPTION 'Geen inhoudelijke intrekkingsbevoegdheid';
 END IF;
 SELECT gebruikersnaam INTO v_name FROM gebruiker WHERE id=p_actor;
 SELECT * INTO v_login FROM inloggen(v_name,p_password,NULL);
 IF v_login.wacht_seconden IS NOT NULL THEN RETURN 'locked'; END IF;
 IF v_login.id IS DISTINCT FROM p_actor THEN RETURN 'denied'; END IF;
 v_now:=clock_timestamp();
 UPDATE personnel_qualification SET revoked_at=v_now WHERE id=p_id;
 INSERT INTO qualification_revocation(qualification_id,revoked_by,reason,revoked_at)
 VALUES(p_id,p_actor,p_reason,v_now);
 RETURN 'revoked';
END $$;

REVOKE ALL ON FUNCTION qualification_is_operations(text),
 qualification_issue_confirmed(uuid,text,timestamptz,timestamptz,uuid,uuid,text,text,text),
 qualification_revoke_confirmed(uuid,uuid,text,text) FROM PUBLIC;

-- Migratie 0087: oude beheerdersrol is geen beschikbaarheidsvoorwaarde (D101).
SET search_path = fabriek, public;

-- Geen legacy-rol als voorwaarde voor accountdeactivering. De afzonderlijke
-- MES-guards voor kritieke identiteiten, grants en sessies blijven gelden.
CREATE OR REPLACE FUNCTION bewaak_beheerder() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
    IF NEW.gebruikersnaam <> OLD.gebruikersnaam THEN
        RAISE EXCEPTION 'Een gebruikersnaam verandert niet; maak een nieuw account';
    END IF;
    RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION bewaak_beheerder() FROM PUBLIC;

-- Migratie 0088: kwaliteitsuitvoering op actuele MES-permissions (D101).
SET search_path = fabriek, public;

CREATE OR REPLACE FUNCTION controleer_stapregistratie() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,public,pg_temp AS $$
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
    -- D101: actuele MES-grant en volledige productscope, geen legacy-rol.
    IF v_stap.soort = 'keuring' AND NOT EXISTS (
        SELECT 1 FROM operator o WHERE o.id=NEW.operator_id AND o.actief
          AND authorization_permits(o.gebruiker_id,'inspection.start',NULL,v_product,NULL)
          AND (NEW.lot_id IS NULL OR NOT EXISTS (
              SELECT 1 FROM batch b WHERE b.lot_id=NEW.lot_id
                AND NOT authorization_permits(o.gebruiker_id,'inspection.start',NULL,b.product_id,NULL)))
    ) THEN
        RAISE EXCEPTION 'Stap % is een keuring; actuele MES-keuringsbevoegdheid vereist', v_stap.code USING ERRCODE='42501';
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

CREATE OR REPLACE FUNCTION verwerk_waarde() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,public,pg_temp AS $$
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
            IF NOT EXISTS (
                SELECT 1 FROM operator o WHERE o.id=NEW.ingevoerd_door AND o.actief
                  AND authorization_permits(o.gebruiker_id,'inspection.record',NULL,v_reg.product_id,NULL)
                  AND (v_reg.lot_id IS NULL OR NOT EXISTS (
                      SELECT 1 FROM batch b WHERE b.lot_id=v_reg.lot_id
                        AND NOT authorization_permits(o.gebruiker_id,'inspection.record',NULL,b.product_id,NULL)))
            ) THEN
                RAISE EXCEPTION 'Veld % meet Kwaliteit; actuele MES-meetbevoegdheid vereist', v_veld.code USING ERRCODE='42501';
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

REVOKE EXECUTE ON FUNCTION controleer_stapregistratie(),verwerk_waarde() FROM PUBLIC;

-- Migratie 0089: correcties en conflictbesluiten onafhankelijk van legacy-rollen (D101).
SET search_path = fabriek, public;

CREATE OR REPLACE FUNCTION verwerk_waarde() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,public,pg_temp AS $$
DECLARE
    v_veld  veld%ROWTYPE;
    v_reg   stapregistratie%ROWTYPE;
    v_oud   waarde%ROWTYPE;
    v_permission text;
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
            IF NOT EXISTS (
                SELECT 1 FROM operator o WHERE o.id=NEW.ingevoerd_door AND o.actief
                  AND authorization_permits(o.gebruiker_id,'inspection.record',NULL,v_reg.product_id,NULL)
                  AND (v_reg.lot_id IS NULL OR NOT EXISTS (
                      SELECT 1 FROM batch b WHERE b.lot_id=v_reg.lot_id
                        AND NOT authorization_permits(o.gebruiker_id,'inspection.record',NULL,b.product_id,NULL)))
            ) THEN
                RAISE EXCEPTION 'Veld % meet Kwaliteit; actuele MES-meetbevoegdheid vereist', v_veld.code USING ERRCODE='42501';
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
        IF v_veld.gemeten_door='kwaliteit' THEN
            IF current_user <> pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID))
               OR current_setting('fabriek.conflict',true) IS DISTINCT FROM 'aan' THEN
                RAISE EXCEPTION 'Kwaliteitscorrectie vereist gecontroleerde conflictafhandeling' USING ERRCODE='42501';
            END IF;
            v_permission:='inspection.decide';
        ELSE
            v_permission:='execution.correct';
        END IF;
        IF NOT authorization_permits(NEW.gecorrigeerd_door,v_permission,NULL,v_reg.product_id,NULL)
           OR (v_reg.lot_id IS NOT NULL AND EXISTS (
               SELECT 1 FROM batch b WHERE b.lot_id=v_reg.lot_id
                 AND NOT authorization_permits(NEW.gecorrigeerd_door,v_permission,NULL,b.product_id,NULL))) THEN
            RAISE EXCEPTION 'Geen actuele MES-correctiebevoegdheid' USING ERRCODE='42501';
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

CREATE OR REPLACE FUNCTION verwerk_grondstof_gebruik() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,public,pg_temp AS $$
DECLARE
    v_reg  stapregistratie%ROWTYPE;
    v_oud  grondstof_gebruik%ROWTYPE;
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
        IF NOT authorization_permits(NEW.gecorrigeerd_door,'execution.correct',NULL,v_reg.product_id,NULL)
           OR (v_reg.lot_id IS NOT NULL AND EXISTS (
               SELECT 1 FROM batch b WHERE b.lot_id=v_reg.lot_id
                 AND NOT authorization_permits(NEW.gecorrigeerd_door,'execution.correct',NULL,b.product_id,NULL))) THEN
            RAISE EXCEPTION 'Geen actuele MES-correctiebevoegdheid' USING ERRCODE='42501';
        END IF;
    END IF;
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION los_invoerconflict_op(p_conflict uuid, p_keuze text, p_door uuid, p_reden text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,public,pg_temp AS $$
DECLARE
    v_c     invoerconflict%ROWTYPE;
    v_reg stapregistratie%ROWTYPE;
    v_permission text;
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
    SELECT * INTO STRICT v_reg FROM stapregistratie WHERE id=v_c.stapregistratie_id;
    v_permission:=CASE WHEN v_kw THEN 'inspection.decide' ELSE 'execution.correct' END;
    IF NOT authorization_permits(p_door,v_permission,NULL,v_reg.product_id,NULL)
           OR (v_reg.lot_id IS NOT NULL AND EXISTS (
               SELECT 1 FROM batch b WHERE b.lot_id=v_reg.lot_id
                 AND NOT authorization_permits(p_door,v_permission,NULL,b.product_id,NULL))) THEN
        RAISE EXCEPTION 'Geen actuele MES-conflictbeslisbevoegdheid' USING ERRCODE='42501';
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

REVOKE EXECUTE ON FUNCTION verwerk_waarde(),verwerk_grondstof_gebruik(),los_invoerconflict_op(uuid,text,uuid,text) FROM PUBLIC;

-- Migratie 0090: papieren nalevering zonder legacy-rol (D101).
SET search_path = fabriek, public;

CREATE OR REPLACE FUNCTION lever_stap_na(p_stapcode text, p_nummer text, p_batches text[], p_pc uuid, p_operator uuid,
                              p_begin timestamptz, p_eind timestamptz, p_reden text, p_gebruiker uuid,
                              p_waarden jsonb, p_grondstoffen jsonb)
RETURNS uuid LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,public,pg_temp AS $$
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
    v_products uuid[];
    v_product uuid;
BEGIN
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

    -- Ook het eigenaarspad controleert de inhoudelijke MES-bevoegdheden.
    -- De oorspronkelijke operator is een historische verklaring, niet de actor.
    IF v_stap.is_lot_stap THEN
        SELECT array_agg(product_id) INTO v_products FROM batch WHERE id=ANY(v_ids);
    ELSIF v_batch IS NOT NULL THEN
        SELECT ARRAY[product_id] INTO v_products FROM batch WHERE id=v_batch;
    ELSE
        SELECT array_agg(product_id) INTO v_products FROM batch WHERE lot_id=v_lot;
    END IF;
    IF coalesce(cardinality(v_products),0)=0 THEN
        RAISE EXCEPTION 'Geen batches voor papieren nalevering';
    END IF;
    FOREACH v_product IN ARRAY v_products LOOP
        IF NOT authorization_permits(p_gebruiker,'execution.correct',NULL,v_product,NULL)
           OR NOT authorization_permits(p_gebruiker,'execution.start',NULL,v_product,NULL)
           OR NOT authorization_permits(p_gebruiker,'execution.record',NULL,v_product,NULL)
           OR NOT authorization_permits(p_gebruiker,'execution.complete',NULL,v_product,NULL)
           OR (v_stap.is_lot_stap AND NOT authorization_permits(p_gebruiker,'execution.lot.create',NULL,v_product,NULL)) THEN
            RAISE EXCEPTION 'Geen actuele MES-bevoegdheid voor papieren nalevering' USING ERRCODE='42501';
        END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p_waarden,'[]'::jsonb)) w
        JOIN veld f ON f.processtap_id=v_stap.id AND f.code=w->>'veldcode'
        WHERE f.gemeten_door='kwaliteit') THEN
        RAISE EXCEPTION 'Kwaliteitsmetingen niet via papieren productienalevering';
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
REVOKE EXECUTE ON FUNCTION lever_stap_na(text,text,text[],uuid,uuid,timestamptz,timestamptz,text,uuid,jsonb,jsonb) FROM PUBLIC;

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

INSERT INTO schema_versie (nummer, naam) VALUES (1, 'basis'), (2, 'onderhoud'), (3, 'planning'), (4, 'wandscherm'), (5, 'grondstoffen'), (6, 'ploegoverdracht'), (7, 'meldingen'), (8, 'stilstand'), (9, 'capaciteit'), (10, 'certificaat'), (11, 'apparaattijd'), (12, 'tijdzone'), (13, 'inloggen'), (14, 'opruimen'), (15, 'decimalen'), (16, 'planningvolgorde'), (17, 'eigen_inlog'), (18, 'route_per_product'), (19, 'grenzen_per_product'), (20, 'capaciteit_per_stap'), (21, 'herbewerking'), (22, 'keuring'), (23, 'afgerond_door'), (24, 'nalevering'), (25, 'tijdelijk_wachtwoord'), (26, 'iets_melden'), (27, 'stilstand_notitie'), (28, 'pilotoverzicht'), (29, 'capaciteit_afwijking'), (30, 'capaciteit_route'), (31, 'keuringsstap'), (32, 'invoerconflict'), (33, 'ploegrooster'), (34, 'medewerker_ploeg'), (35, 'capaciteit_kg'), (36, 'authorization'), (37, 'personal_execution'), (38, 'authorization_approval'), (39, 'authorization_identity'), (40, 'credential_visibility'), (41, 'authorization_revocation'), (42, 'operator_identity_projection'), (43, 'mes_role_catalog'), (44, 'management_permissions'), (45, 'execution_permissions'), (46, 'execution_read_permissions'), (47, 'planning_permissions'), (48, 'operations_permissions'), (49, 'batch_lot_permissions'), (50, 'authentication_hardening'), (51, 'administrative_separation'), (52, 'legacy_role_guard'), (53, 'identity_reset_guard'), (54, 'controlled_bootstrap'), (55, 'controlled_recovery'), (56, 'session_version'), (57, 'recovery_readiness'), (58, 'personnel_separation'), (59, 'security_channel'), (60, 'security_identity_binding'), (61, 'security_binding_lifecycle'), (62, 'quality_confirmation'), (63, 'rework_order_required'), (64, 'rework_order_authorization'), (65, 'rework_execution_permission'), (66, 'execution_session_proof'), (67, 'execution_session_api'), (68, 'execution_transaction_identity'), (69, 'execution_measurement_identity'), (70, 'execution_conflict_identity'), (71, 'execution_paper_entry'), (72, 'execution_object_status'), (73, 'execution_legacy_batch_creation'), (74, 'execution_step_lifecycle'), (75, 'function_search_path_hardening'), (76, 'function_execute_allowlist'), (77, 'table_write_allowlist'), (78, 'table_read_allowlist'), (79, 'config_audit_write_guard'), (80, 'config_audit_actor'), (81, 'config_audit_identity'), (82, 'notification_authorization'), (83, 'configuration_authorization'), (84, 'operations_authorization'), (85, 'personnel_link'), (86, 'qualification_lifecycle'), (87, 'legacy_admin_retirement'), (88, 'inspection_permission_guards'), (89, 'correction_permission_guards'), (90, 'paper_entry_permissions'), (91, 'quality_rework_permissions'), (92, 'rework_search_path'), (93, 'security_channel_privileges'), (94, 'existing_identity_bootstrap'), (95, 'mes_demo_accounts'), (96, 'material_master'), (97, 'material_management'), (98, 'master_recipe'), (99, 'recipe_draft_edit'), (100, 'recipe_procedure'), (101, 'recipe_procedure_manage'), (102, 'recipe_parameters'), (103, 'recipe_formula'), (104, 'unit_catalog'), (105, 'recipe_scaling_rules'), (106, 'recipe_requirements'), (107, 'recipe_lot_rules'), (108, 'recipe_content_manage'), (109, 'recipe_requirements_manage'), (110, 'unit_catalog_manage'), (111, 'recipe_scaling_manage'), (112, 'recipe_scaling_expression'), (113, 'recipe_scaling_physical_validation'), (114, 'material_unit_mapping'), (115, 'recipe_lifecycle'), (116, 'recipe_change_request'), (117, 'recipe_comparison'), (118, 'recipe_review_matrix'), (119, 'recipe_review_round'), (120, 'recipe_review_workflow'), (121, 'recipe_release_validation'), (122, 'recipe_release_evidence'), (123, 'recipe_release_workflow'), (124, 'recipe_review_read'), (125, 'recipe_release_read');

-- ---------------------------------------------------------------------
-- Elke functie werkt in schema fabriek, ongeacht de instelling van wie hem aanroept.
-- ---------------------------------------------------------------------
DO $$
DECLARE f record;
BEGIN
    FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'fabriek' AND p.prokind='f' AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig,ARRAY[]::text[])) c WHERE c LIKE 'search_path=%') LOOP
        EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog,fabriek,public,pg_temp', f.sig);
    END LOOP;
END $$;

-- Afgeschermde functies houden pg_temp expliciet achter de vertrouwde schema's.
ALTER FUNCTION inloggen(text,text,text) SET search_path = pg_catalog,fabriek,public,pg_temp;
ALTER FUNCTION wijzig_eigen_wachtwoord(uuid,text,text) SET search_path = pg_catalog,fabriek,public,pg_temp;
ALTER FUNCTION demo_account_names(text[]) SET search_path = pg_catalog,fabriek,public,pg_temp;
ALTER FUNCTION authorization_revoke_confirmed(uuid,uuid,text,text) SET search_path = pg_catalog,fabriek,public,pg_temp;
ALTER FUNCTION authorization_audit_immutable() SET search_path = pg_catalog,fabriek,pg_temp;
ALTER FUNCTION change_password_confirmed(uuid,text,text) SET search_path = pg_catalog,fabriek,public,pg_temp;
ALTER FUNCTION authorization_guard_legacy_role() SET search_path = pg_catalog,fabriek,pg_temp;
ALTER FUNCTION authorization_protect_identity() SET search_path = pg_catalog,fabriek,pg_temp;
ALTER FUNCTION authorization_bootstrap_empty(text,text,text,text,text,text,text) SET search_path = pg_catalog,fabriek,public,pg_temp;
ALTER FUNCTION authorization_recover_confirmed(uuid,uuid,uuid,text,text,text,text) SET search_path = pg_catalog,fabriek,public,pg_temp;

ALTER FUNCTION authorization_session_version() SET search_path = pg_catalog,fabriek,pg_temp;
ALTER FUNCTION login_with_session(text,text,text) SET search_path = pg_catalog,fabriek,public,pg_temp;
ALTER FUNCTION change_password_session(uuid,bigint,text,text) SET search_path = pg_catalog,fabriek,public,pg_temp;
ALTER FUNCTION authorization_recovery_readiness(uuid) SET search_path = pg_catalog,fabriek,pg_temp;
ALTER FUNCTION operator_van_account(uuid) SET search_path = pg_catalog,fabriek,pg_temp;
ALTER FUNCTION authorization_personnel_identity_guard() SET search_path = pg_catalog,fabriek,pg_temp;
ALTER FUNCTION authorization_channel_submit(uuid,uuid,text,text,uuid,text,timestamptz,timestamptz,text,text) SET search_path = pg_catalog,fabriek,public,pg_temp;
ALTER FUNCTION authorization_channel_decide(uuid,uuid,boolean,text,text) SET search_path = pg_catalog,fabriek,public,pg_temp;
ALTER FUNCTION authorization_channel_revoke(uuid,uuid,text,text) SET search_path = pg_catalog,fabriek,public,pg_temp;

ALTER FUNCTION authorization_channel_actor(text) SET search_path = pg_catalog,fabriek,pg_temp;
ALTER FUNCTION authorization_channel_submit(uuid,text,text,uuid,text,timestamptz,timestamptz,text,text) SET search_path = pg_catalog,fabriek,public,pg_temp;
ALTER FUNCTION authorization_channel_decide(uuid,boolean,text,text) SET search_path = pg_catalog,fabriek,public,pg_temp;
ALTER FUNCTION authorization_channel_revoke(uuid,text,text) SET search_path = pg_catalog,fabriek,public,pg_temp;
ALTER FUNCTION authorization_channel_requests() SET search_path = pg_catalog,fabriek,pg_temp;
ALTER FUNCTION authorization_channel_grants() SET search_path = pg_catalog,fabriek,pg_temp;

ALTER FUNCTION authorization_channel_role_safe(oid) SET search_path = pg_catalog,pg_temp;
ALTER FUNCTION authorization_channel_bind(name,uuid,text) SET search_path = pg_catalog,fabriek,pg_temp;
ALTER FUNCTION authorization_channel_unbind(name,text) SET search_path = pg_catalog,fabriek,pg_temp;

ALTER FUNCTION quality_decision_confirmed(uuid,bigint,text,uuid,text,text,text,text) SET search_path = pg_catalog,fabriek,public,pg_temp;
ALTER FUNCTION quality_legacy_decision_guard() SET search_path = pg_catalog,fabriek,pg_temp;

ALTER FUNCTION koppel_herbewerking() SET search_path = pg_catalog,fabriek,pg_temp;
ALTER FUNCTION quality_rework_hold_guard() SET search_path = pg_catalog,fabriek,pg_temp;

ALTER FUNCTION maak_herbewerking(text,text,text,uuid,uuid) SET search_path = pg_catalog,fabriek,pg_temp;
ALTER FUNCTION rework_order_permission(uuid,uuid,uuid) SET search_path=pg_catalog,fabriek,pg_temp;
ALTER FUNCTION rework_order_confirmed(uuid,bigint,text,text,text,uuid,text) SET search_path=pg_catalog,fabriek,public,pg_temp;
ALTER FUNCTION rework_cancel_confirmed(uuid,bigint,uuid,text,text) SET search_path=pg_catalog,fabriek,public,pg_temp;
ALTER FUNCTION rework_history_guard() SET search_path=pg_catalog,fabriek,pg_temp;
ALTER FUNCTION start_geplande_batch() SET search_path=pg_catalog,fabriek,pg_temp;
ALTER FUNCTION werk_lotstatus_bij() SET search_path=pg_catalog,fabriek,pg_temp;
ALTER FUNCTION execution_step_permission(uuid,uuid,uuid,text,boolean) SET search_path=pg_catalog,fabriek,pg_temp;
ALTER FUNCTION execution_step_start(text,uuid,uuid,uuid,uuid,uuid) SET search_path=pg_catalog,fabriek,pg_temp;
ALTER FUNCTION execution_step_complete(uuid,uuid,uuid) SET search_path=pg_catalog,fabriek,pg_temp;
ALTER FUNCTION execution_step_rework(uuid,text,text,uuid,uuid,uuid) SET search_path=pg_catalog,fabriek,pg_temp;
-- Migratie 0093: toets effectieve persoonlijke rechten in de MES-database (D100).
CREATE OR REPLACE FUNCTION fabriek.authorization_channel_role_safe(p_role oid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog,pg_temp AS $$
 SELECT EXISTS (SELECT 1 FROM pg_roles r WHERE r.oid=p_role AND r.rolcanlogin
    AND NOT r.rolsuper AND NOT r.rolcreaterole AND NOT r.rolcreatedb
    AND NOT r.rolreplication AND NOT r.rolbypassrls)
 AND pg_has_role(p_role,'mes_security_channel','MEMBER')
 AND NOT EXISTS (SELECT 1 FROM pg_roles r WHERE r.oid<>p_role AND r.rolname<>'mes_security_channel'
                 AND pg_has_role(p_role,r.oid,'MEMBER'))
 AND NOT EXISTS (SELECT 1 FROM pg_auth_members a WHERE a.member=p_role AND a.admin_option)
 AND NOT EXISTS (
   SELECT 1 FROM pg_database d WHERE d.datname=current_database()
     AND (d.datdba=p_role OR has_database_privilege(p_role,d.oid,'CREATE'))
 )
 AND NOT EXISTS (
   SELECT 1 FROM pg_namespace n WHERE n.nspname IN ('fabriek','public')
     AND (n.nspowner=p_role OR has_schema_privilege(p_role,n.oid,'CREATE'))
 )
 AND NOT EXISTS (
   SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='fabriek' AND
     (c.relowner=p_role OR CASE
       WHEN c.relkind IN ('r','p','v','m','f') THEN
         has_any_column_privilege(p_role,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')
         OR has_table_privilege(p_role,c.oid,'DELETE,TRUNCATE,TRIGGER')
       WHEN c.relkind='S' THEN has_sequence_privilege(p_role,c.oid,'SELECT,USAGE,UPDATE')
       ELSE false END)
 )
 AND NOT EXISTS (
   SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='fabriek'
     AND (p.proowner=p_role
       OR has_function_privilege(p_role,p.oid,'EXECUTE WITH GRANT OPTION')
       OR (has_function_privilege(p_role,p.oid,'EXECUTE')
           AND NOT has_function_privilege('mes_security_channel',p.oid,'EXECUTE')))
 )
$$;

-- Migratie 0094: eenmalige gecontroleerde eerste MES-rechten op bestaande administratie.
SET search_path = fabriek, public;

-- Hergebruik het onveranderlijke singleton-bootstraprecord als permanente blokkade.
-- Geen automatische vertaling van legacy-rollen en geen wijziging van historische accounts.
CREATE FUNCTION authorization_bootstrap_existing(p_system uuid,p_system_password text,
    p_a uuid,p_a_password text,p_b uuid,p_b_password text,p_reason text)
RETURNS text LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v record; v_login record;
BEGIN
    IF current_user <> pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='fabriek.gebruiker'::regclass)) THEN
        RAISE EXCEPTION 'Overgang vereist database-eigenaar';
    END IF;
    LOCK TABLE gebruiker IN SHARE ROW EXCLUSIVE MODE;
    LOCK TABLE authorization_grant, authorization_bootstrap, authorization_request IN SHARE ROW EXCLUSIVE MODE;
    IF NOT EXISTS (SELECT 1 FROM gebruiker)
       OR EXISTS (SELECT 1 FROM authorization_bootstrap)
       OR EXISTS (SELECT 1 FROM authorization_grant)
       OR EXISTS (SELECT 1 FROM authorization_request) THEN
        RAISE EXCEPTION 'Overgang uitsluitend op bestaande administratie zonder MES-rechtenhistorie';
    END IF;
    IF p_system IS NULL OR p_a IS NULL OR p_b IS NULL
       OR p_system=p_a OR p_system=p_b OR p_a=p_b
       OR btrim(coalesce(p_reason,''))=''
       OR length(coalesce(p_system_password,''))=0 OR length(coalesce(p_a_password,''))=0
       OR length(coalesce(p_b_password,''))=0
       OR p_system_password=p_a_password OR p_system_password=p_b_password OR p_a_password=p_b_password THEN
        RAISE EXCEPTION 'Drie afzonderlijke persoonlijke identiteiten, bevestigingen en referentie vereist';
    END IF;
    IF (SELECT count(*) FROM gebruiker WHERE id IN (p_system,p_a,p_b)
        AND actief AND NOT gedeeld AND NOT wachtwoord_wijzigen AND rol<>'scherm'
        AND wachtwoord_hash IS NOT NULL) <> 3 THEN
        RAISE EXCEPTION 'Ongeschikte persoonlijke overgangsidentiteit';
    END IF;
    FOR v IN SELECT g.id,g.gebruikersnaam,CASE g.id WHEN p_system THEN p_system_password
        WHEN p_a THEN p_a_password ELSE p_b_password END AS wachtwoord
        FROM gebruiker g WHERE g.id IN (p_system,p_a,p_b) ORDER BY g.id
    LOOP
        SELECT * INTO v_login FROM inloggen(v.gebruikersnaam,v.wachtwoord,NULL);
        IF v_login.id IS DISTINCT FROM v.id THEN
            RETURN CASE WHEN coalesce(v_login.wacht_seconden,0)>0 THEN 'locked' ELSE 'denied' END;
        END IF;
    END LOOP;
    -- Bestaande sessies mogen de nieuwe bevoegdheden niet ongemerkt verkrijgen.
    UPDATE gebruiker SET session_version=session_version+1 WHERE id IN (p_system,p_a,p_b);
    INSERT INTO authorization_grant(user_id,role_code) VALUES
      (p_system,'system_administrator'),(p_a,'security_administrator'),(p_b,'security_administrator');
    INSERT INTO authorization_bootstrap(system_user_id,security_user_a,security_user_b,database_actor,reason)
      VALUES(p_system,p_a,p_b,current_user,'Gecontroleerde overgang bestaande administratie: '||p_reason);
    RETURN 'initialized';
END $$;
REVOKE ALL ON FUNCTION authorization_bootstrap_existing(uuid,text,uuid,text,uuid,text,text) FROM PUBLIC;

-- De vertrouwde eigenaar mag expliciet exact één sessiegeneratie verhogen.
-- Runtime kan deze kolom niet schrijven; gewone accountwijzigingen houden hun bestaande gedrag.
CREATE OR REPLACE FUNCTION authorization_session_version() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
    IF TG_OP='INSERT' THEN
        NEW.session_version := 1;
    ELSIF NEW.wachtwoord_hash IS DISTINCT FROM OLD.wachtwoord_hash
       OR NEW.wachtwoord_wijzigen IS DISTINCT FROM OLD.wachtwoord_wijzigen
       OR NEW.actief IS DISTINCT FROM OLD.actief OR NEW.rol IS DISTINCT FROM OLD.rol
       OR NEW.gedeeld IS DISTINCT FROM OLD.gedeeld
       OR NEW.gebruikersnaam IS DISTINCT FROM OLD.gebruikersnaam
       OR (current_user=pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=TG_RELID))
           AND NEW.session_version=OLD.session_version+1) THEN
        NEW.session_version := OLD.session_version + 1;
    ELSE
        NEW.session_version := OLD.session_version;
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION authorization_session_version() FROM PUBLIC;

COMMIT;

-- Migratie 0095: actuele demo-accountindicatie (D103).
BEGIN;
-- D103: toon uitsluitend actuele MES-demo-identiteiten, zonder accounts of grants te wijzigen.
SET search_path = fabriek, public;
CREATE OR REPLACE FUNCTION demo_account_names(p_names text[]) RETURNS TABLE(gebruikersnaam text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog,fabriek,public,pg_temp AS $$
    SELECT g.gebruikersnaam FROM fabriek.gebruiker g
      WHERE g.actief AND NOT g.gedeeld AND lower(g.gebruikersnaam)=ANY(p_names)
        AND lower(g.gebruikersnaam) IN ('mes.operator','mes.supervisor','mes.manager','mes.planner','mes.engineer','mes.eng.approver','mes.quality','mes.quality.approver','mes.maintenance','mes.system','mes.security.a','mes.security.b','mes.analyst','mes.display')
        AND g.wachtwoord_hash=public.crypt('demo',g.wachtwoord_hash)
      ORDER BY g.gebruikersnaam
$$;
REVOKE ALL ON FUNCTION demo_account_names(text[]) FROM PUBLIC;

COMMIT;

BEGIN;
-- Migratie 0096: relationeel materiaalstamdatafundament (D89 M01-M05).
SET search_path = fabriek, public;

-- Stabiele materiaalclassificatie; geen automatisch afgeleide classificaties.
CREATE TABLE material_class (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL UNIQUE CHECK (btrim(code) <> ''),
    name text NOT NULL CHECK (btrim(name) <> '')
);

-- Materiaalidentiteit met expliciete koppelingen naar behouden PoC-identiteiten.
CREATE TABLE material_definition (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL UNIQUE CHECK (btrim(code) <> ''),
    product_id uuid UNIQUE REFERENCES product(id),
    raw_material_id uuid UNIQUE REFERENCES grondstof(id)
);

-- Onveranderlijke materiaalversie; ontbrekende classificatie of eenheid blijft onbekend.
CREATE TABLE material_definition_version (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    material_definition_id uuid NOT NULL REFERENCES material_definition(id),
    revision integer NOT NULL CHECK (revision > 0),
    name text NOT NULL CHECK (btrim(name) <> ''),
    material_class_id uuid REFERENCES material_class(id),
    unit text CHECK (unit IS NULL OR btrim(unit) <> ''),
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by uuid NOT NULL REFERENCES gebruiker(id),
    UNIQUE (material_definition_id, revision)
);

CREATE FUNCTION material_version_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
    RAISE EXCEPTION 'Materiaalversie is onveranderlijk' USING ERRCODE='55000';
END $$;
CREATE TRIGGER material_version_immutable BEFORE UPDATE OR DELETE ON material_definition_version
 FOR EACH ROW EXECUTE FUNCTION material_version_immutable();
REVOKE ALL ON FUNCTION material_version_immutable() FROM PUBLIC;

-- Geen directe app-toegang. De bestaande ACL-allowlists verlenen geen
-- rechten aan deze tabellen. Gecontroleerde persoonlijke functies volgen
-- vóór de eerste API; migratie van brongegevens volgt onder #113.
REVOKE ALL ON material_class, material_definition, material_definition_version FROM PUBLIC;

COMMIT;

BEGIN;
-- Migratie 0097: persoonlijk geautoriseerde materiaalstamdata (#109).
SET search_path = fabriek, public;

-- Classificatie en bronkoppeling mogen een bestaande versie niet indirect wijzigen.
-- Correcties aan materiaalinhoud gebeuren met een nieuwe versie.
CREATE TRIGGER material_class_immutable BEFORE UPDATE OR DELETE ON material_class
 FOR EACH ROW EXECUTE FUNCTION material_version_immutable();
CREATE TRIGGER material_definition_immutable BEFORE UPDATE OR DELETE ON material_definition
 FOR EACH ROW EXECUTE FUNCTION material_version_immutable();

-- Een materiaal kan in meerdere producten gebruikt worden. Tot expliciete
-- materiaal-scope bestaat, vereist beheer een globale engineeringgrant.
CREATE FUNCTION material_manage_actor() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid;
BEGIN
 actor:=execution_transaction_actor();
 IF NOT authorization_permits(actor,'material.definition.manage',NULL,NULL,NULL) THEN
   RAISE EXCEPTION 'Geen actuele MES-materiaalbeheerbevoegdheid' USING ERRCODE='42501';
 END IF;
 RETURN actor;
END $$;

CREATE FUNCTION material_create_class(p_code text,p_name text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE target uuid;
BEGIN
 PERFORM material_manage_actor();
 INSERT INTO material_class(code,name) VALUES(p_code,p_name) RETURNING id INTO target;
 RETURN target;
END $$;

CREATE FUNCTION material_create_definition(p_code text,p_name text,p_class uuid,p_unit text,p_product uuid,p_raw_material uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; target uuid;
BEGIN
 actor:=material_manage_actor();
 INSERT INTO material_definition(code,product_id,raw_material_id)
 VALUES(p_code,p_product,p_raw_material) RETURNING id INTO target;
 INSERT INTO material_definition_version(material_definition_id,revision,name,material_class_id,unit,created_by)
 VALUES(target,1,p_name,p_class,p_unit,actor);
 RETURN target;
END $$;

-- Vergrendel de identiteit vóór de revisiebepaling; twee schrijvers kunnen
-- niet hetzelfde revisienummer krijgen. Verwachte revisie voorkomt verloren edits.
CREATE FUNCTION material_append_version(p_id uuid,p_expected_revision integer,p_name text,p_class uuid,p_unit text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; target uuid; current_revision integer;
BEGIN
 actor:=material_manage_actor();
 PERFORM 1 FROM material_definition WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende materiaalidentiteit'; END IF;
 SELECT max(revision) INTO current_revision FROM material_definition_version WHERE material_definition_id=p_id;
 IF current_revision IS NULL OR current_revision IS DISTINCT FROM p_expected_revision THEN
   RAISE EXCEPTION 'Materiaalrevisie is gewijzigd' USING ERRCODE='40001';
 END IF;
 INSERT INTO material_definition_version(material_definition_id,revision,name,material_class_id,unit,created_by)
 VALUES(p_id,current_revision+1,p_name,p_class,p_unit,actor) RETURNING id INTO target;
 RETURN target;
END $$;

CREATE FUNCTION material_list() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
 PERFORM material_manage_actor();
 RETURN jsonb_build_object(
   'classes',COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.code) FROM material_class c),'[]'::jsonb),
   'definitions',COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.code) FROM material_definition d),'[]'::jsonb),
   'versions',COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.material_definition_id,v.revision) FROM material_definition_version v),'[]'::jsonb)
 );
END $$;

REVOKE ALL ON FUNCTION material_manage_actor(),material_create_class(text,text),
 material_create_definition(text,text,uuid,text,uuid,uuid),
 material_append_version(uuid,integer,text,uuid,text),material_list() FROM PUBLIC;

COMMIT;

BEGIN;
-- Migratie 0098: MBR-identiteit en conceptversies (D89 R01-R05, #109-110).
SET search_path = fabriek, public;

-- Eén product kan meerdere stabiele receptidentiteiten hebben.
CREATE TABLE master_recipe (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id uuid NOT NULL REFERENCES product(id),
    code text NOT NULL CHECK (btrim(code) <> ''),
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by uuid NOT NULL REFERENCES gebruiker(id),
    UNIQUE (product_id, code)
);

-- Conceptversie; inhoud en gecontroleerde statusovergangen volgen in fase 2.
-- Geen vrijgavestatus zolang beoordeling en vrijgave nog niet bestaan.
CREATE TABLE master_recipe_version (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    master_recipe_id uuid NOT NULL REFERENCES master_recipe(id),
    revision integer NOT NULL CHECK (revision > 0),
    name text NOT NULL CHECK (btrim(name) <> ''),
    description text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by uuid NOT NULL REFERENCES gebruiker(id),
    UNIQUE (master_recipe_id, revision)
);

-- De identiteit en het product van een recept mogen niet wijzigen.
CREATE FUNCTION master_recipe_identity_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'MBR-identiteit is onveranderlijk' USING ERRCODE='55000';
END $$;
CREATE TRIGGER master_recipe_identity_guard BEFORE UPDATE OR DELETE ON master_recipe
 FOR EACH ROW EXECUTE FUNCTION master_recipe_identity_guard();

-- Revisie-identiteit en oorspronkelijke auteur blijven behouden.
-- Inhoudelijke conceptwijzigingen worden pas via een gecontroleerde functie geopend.
CREATE FUNCTION master_recipe_version_identity_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN
   RAISE EXCEPTION 'MBR-versie mag niet worden verwijderd' USING ERRCODE='55000';
 END IF;
 IF (NEW.id,NEW.master_recipe_id,NEW.revision,NEW.created_at,NEW.created_by)
    IS DISTINCT FROM (OLD.id,OLD.master_recipe_id,OLD.revision,OLD.created_at,OLD.created_by) THEN
   RAISE EXCEPTION 'MBR-versie-identiteit is onveranderlijk' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER master_recipe_version_identity_guard BEFORE UPDATE OR DELETE ON master_recipe_version
 FOR EACH ROW EXECUTE FUNCTION master_recipe_version_identity_guard();

REVOKE ALL ON master_recipe,master_recipe_version FROM PUBLIC;
REVOKE ALL ON FUNCTION master_recipe_identity_guard(),master_recipe_version_identity_guard() FROM PUBLIC;

-- Eigen domeinpermission; geen nieuwe persoonlijke grants.
INSERT INTO authorization_permission(code,domain) VALUES ('recipe.draft.manage','engineering');
INSERT INTO authorization_role_permission(role_code,permission_code) VALUES ('process_engineer','recipe.draft.manage');

-- Productcontext komt uit de receptidentiteit of uit de gevalideerde product-FK.
CREATE FUNCTION recipe_draft_actor(p_product uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid;
BEGIN
 actor:=execution_transaction_actor();
 IF p_product IS NULL OR NOT authorization_permits(actor,'recipe.draft.manage',NULL,p_product,NULL) THEN
   RAISE EXCEPTION 'Geen actuele MES-receptbevoegdheid' USING ERRCODE='42501';
 END IF;
 RETURN actor;
END $$;

CREATE FUNCTION recipe_create(p_product uuid,p_code text,p_name text,p_description text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; target uuid;
BEGIN
 actor:=recipe_draft_actor(p_product);
 INSERT INTO master_recipe(product_id,code,created_by)
 VALUES(p_product,p_code,actor) RETURNING id INTO target;
 INSERT INTO master_recipe_version(master_recipe_id,revision,name,description,created_by)
 VALUES(target,1,p_name,p_description,actor);
 RETURN target;
END $$;

-- Voorlopig uitsluitend lege conceptheaders. Kopiëren van volledige
-- receptinhoud volgt zodra alle versiegebonden kinderen bestaan.
CREATE FUNCTION recipe_create_next_version(p_recipe uuid,p_expected integer,p_name text,p_description text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; target uuid; product uuid; latest integer;
BEGIN
 SELECT product_id INTO product FROM master_recipe WHERE id=p_recipe;
 actor:=recipe_draft_actor(product);
 PERFORM 1 FROM master_recipe WHERE id=p_recipe FOR UPDATE;
 SELECT max(revision) INTO latest FROM master_recipe_version WHERE master_recipe_id=p_recipe;
 IF latest IS NULL OR latest IS DISTINCT FROM p_expected THEN
   RAISE EXCEPTION 'MBR-revisie is gewijzigd' USING ERRCODE='40001';
 END IF;
 INSERT INTO master_recipe_version(master_recipe_id,revision,name,description,created_by)
 VALUES(p_recipe,latest+1,p_name,p_description,actor) RETURNING id INTO target;
 RETURN target;
END $$;

CREATE FUNCTION recipe_list(p_product uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
 PERFORM recipe_draft_actor(p_product);
 RETURN COALESCE((SELECT jsonb_agg(to_jsonb(r)||jsonb_build_object('versions',
   COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.revision) FROM master_recipe_version v WHERE v.master_recipe_id=r.id),'[]'::jsonb))
   ORDER BY r.code) FROM master_recipe r WHERE r.product_id=p_product),'[]'::jsonb);
END $$;

REVOKE ALL ON FUNCTION recipe_draft_actor(uuid),recipe_create(uuid,text,text,text),
 recipe_create_next_version(uuid,integer,text,text),recipe_list(uuid) FROM PUBLIC;

COMMIT;

BEGIN;
-- Migratie 0099: gecontroleerde conceptwijzigingen en persoonlijk auditspoor (#110).
SET search_path = fabriek, public;

ALTER TABLE master_recipe_version ADD COLUMN change_no integer NOT NULL DEFAULT 0 CHECK (change_no >= 0);

-- Hergebruik het bestaande, afgeschermde configuratielogboek.
CREATE TRIGGER master_recipe_audit AFTER INSERT ON master_recipe
 FOR EACH ROW EXECUTE FUNCTION log_config();
CREATE TRIGGER master_recipe_version_audit AFTER INSERT OR UPDATE ON master_recipe_version
 FOR EACH ROW EXECUTE FUNCTION log_config();

CREATE OR REPLACE FUNCTION master_recipe_version_identity_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN
   RAISE EXCEPTION 'MBR-versie mag niet worden verwijderd' USING ERRCODE='55000';
 END IF;
 IF (NEW.id,NEW.master_recipe_id,NEW.revision,NEW.created_at,NEW.created_by)
    IS DISTINCT FROM (OLD.id,OLD.master_recipe_id,OLD.revision,OLD.created_at,OLD.created_by) THEN
   RAISE EXCEPTION 'MBR-versie-identiteit is onveranderlijk' USING ERRCODE='55000';
 END IF;
 IF NEW.change_no IS DISTINCT FROM OLD.change_no+1 THEN
   RAISE EXCEPTION 'MBR-wijzigingsteller moet precies één toenemen' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;

-- Alleen de conceptheader is nu bewerkbaar. De statusbeveiliging en
-- gezamenlijke inhoudsteller voor kinderen volgen vóór beoordeling/vrijgave.
CREATE FUNCTION recipe_update_draft(p_version uuid,p_expected integer,p_name text,p_description text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE product uuid; current_no integer; result_no integer;
BEGIN
 SELECT r.product_id INTO product FROM master_recipe_version v
 JOIN master_recipe r ON r.id=v.master_recipe_id WHERE v.id=p_version;
 PERFORM recipe_draft_actor(product);
 SELECT change_no INTO current_no FROM master_recipe_version WHERE id=p_version FOR UPDATE;
 IF current_no IS NULL OR current_no IS DISTINCT FROM p_expected THEN
   RAISE EXCEPTION 'MBR-concept is ondertussen gewijzigd' USING ERRCODE='40001';
 END IF;
 UPDATE master_recipe_version SET name=p_name,description=p_description,change_no=current_no+1
 WHERE id=p_version RETURNING change_no INTO result_no;
 RETURN result_no;
END $$;
REVOKE ALL ON FUNCTION recipe_update_draft(uuid,integer,text,text) FROM PUBLIC;

COMMIT;

BEGIN;
-- Migratie 0100: versiegebonden procedureboom en lineaire afhankelijkheden (#103/110).
SET search_path = fabriek, public;

-- Een concept mag nog onvolledig zijn; volledigheid is een latere vrijgave-eis.
-- Parenttype wordt relationeel afgedwongen, zonder recursieve parentmutaties.
CREATE TABLE recipe_procedural_element (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_version_id uuid NOT NULL REFERENCES master_recipe_version(id),
    parent_id uuid,
    parent_kind text,
    kind text NOT NULL CHECK (kind IN ('procedure','unit_procedure','operation','phase')),
    code text NOT NULL CHECK (btrim(code) <> ''),
    name text NOT NULL CHECK (btrim(name) <> ''),
    position integer NOT NULL CHECK (position > 0),
    required boolean NOT NULL DEFAULT true,
    UNIQUE (recipe_version_id,id),
    UNIQUE (recipe_version_id,id,kind),
    UNIQUE (recipe_version_id,code),
    UNIQUE NULLS NOT DISTINCT (recipe_version_id,parent_id,position),
    FOREIGN KEY (recipe_version_id,parent_id,parent_kind)
      REFERENCES recipe_procedural_element(recipe_version_id,id,kind) MATCH SIMPLE,
    CHECK (
      (kind='procedure' AND parent_id IS NULL AND parent_kind IS NULL)
      OR (parent_id IS NOT NULL AND parent_kind IS NOT NULL AND (
        (kind='unit_procedure' AND parent_kind='procedure')
        OR (kind='operation' AND parent_kind='unit_procedure')
        OR (kind='phase' AND parent_kind='operation')
      ))
    )
);
CREATE UNIQUE INDEX recipe_one_procedure_root ON recipe_procedural_element(recipe_version_id)
 WHERE kind='procedure';

-- Expliciete voorganger/opvolger; voorlopig alleen binnen dezelfde siblinggroep.
-- Geen uitvoering van conditionele/parallelle logica in deze migratie.
CREATE TABLE recipe_dependency (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_version_id uuid NOT NULL REFERENCES master_recipe_version(id),
    predecessor_id uuid NOT NULL,
    successor_id uuid NOT NULL,
    UNIQUE (recipe_version_id,predecessor_id,successor_id),
    FOREIGN KEY (recipe_version_id,predecessor_id) REFERENCES recipe_procedural_element(recipe_version_id,id),
    FOREIGN KEY (recipe_version_id,successor_id) REFERENCES recipe_procedural_element(recipe_version_id,id),
    CHECK (predecessor_id <> successor_id)
);

-- Serialiseer alle procedurewijzigingen per receptversie. Een afhankelijkheid
-- moet voorwaarts lopen binnen één siblinggroep; zo zijn cycli uitgesloten.
-- Ook wijziging van een positie/parent mag bestaande edges niet ongeldig maken.
CREATE FUNCTION recipe_procedure_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE version_id uuid; a recipe_procedural_element%ROWTYPE; b recipe_procedural_element%ROWTYPE;
BEGIN
 version_id:=CASE WHEN TG_OP='DELETE' THEN OLD.recipe_version_id ELSE NEW.recipe_version_id END;
 PERFORM 1 FROM master_recipe_version WHERE id=version_id FOR UPDATE;
 IF TG_OP='UPDATE' THEN
   IF NEW.id IS DISTINCT FROM OLD.id OR NEW.recipe_version_id IS DISTINCT FROM OLD.recipe_version_id THEN
     RAISE EXCEPTION 'Procedure-identiteit en versie zijn onveranderlijk' USING ERRCODE='55000';
   END IF;
 END IF;
 IF TG_TABLE_NAME='recipe_dependency' AND TG_OP<>'DELETE' THEN
   SELECT * INTO a FROM recipe_procedural_element WHERE recipe_version_id=version_id AND id=NEW.predecessor_id;
   SELECT * INTO b FROM recipe_procedural_element WHERE recipe_version_id=version_id AND id=NEW.successor_id;
   IF a.id IS NULL OR b.id IS NULL OR a.parent_id IS DISTINCT FROM b.parent_id OR a.position>=b.position THEN
     RAISE EXCEPTION 'Procedureafhankelijkheid moet voorwaarts binnen dezelfde groep lopen' USING ERRCODE='23514';
   END IF;
 ELSIF TG_TABLE_NAME='recipe_procedural_element' AND TG_OP='UPDATE' THEN
   IF EXISTS (
     SELECT 1 FROM recipe_dependency d JOIN recipe_procedural_element other
       ON other.recipe_version_id=d.recipe_version_id AND other.id=d.successor_id
     WHERE d.recipe_version_id=version_id AND d.predecessor_id=NEW.id
       AND (other.parent_id IS DISTINCT FROM NEW.parent_id OR other.position<=NEW.position)
   ) OR EXISTS (
     SELECT 1 FROM recipe_dependency d JOIN recipe_procedural_element other
       ON other.recipe_version_id=d.recipe_version_id AND other.id=d.predecessor_id
     WHERE d.recipe_version_id=version_id AND d.successor_id=NEW.id
       AND (other.parent_id IS DISTINCT FROM NEW.parent_id OR other.position>=NEW.position)
   ) THEN
     RAISE EXCEPTION 'Procedurewijziging maakt afhankelijkheid ongeldig' USING ERRCODE='23514';
   END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recipe_element_guard BEFORE INSERT OR UPDATE OR DELETE ON recipe_procedural_element
 FOR EACH ROW EXECUTE FUNCTION recipe_procedure_guard();
CREATE TRIGGER recipe_dependency_guard BEFORE INSERT OR UPDATE OR DELETE ON recipe_dependency
 FOR EACH ROW EXECUTE FUNCTION recipe_procedure_guard();
REVOKE ALL ON FUNCTION recipe_procedure_guard() FROM PUBLIC;
REVOKE ALL ON recipe_procedural_element,recipe_dependency FROM PUBLIC;

-- Nog geen runtimewrites of API: gecontroleerde gezamenlijke change_no,
-- persoonlijke audit en statuspoort volgen vóór opening van de interface.

COMMIT;

BEGIN;
-- Migratie 0101: persoonlijk procedurebeheer met gezamenlijke MBR-wijzigingsteller.
SET search_path = fabriek, public;

-- Eén lock en één verwachte teller voor alle conceptonderdelen.
-- De statuspoort wordt hier later centraal toegevoegd, vóór vrijgave mogelijk is.
CREATE FUNCTION recipe_lock_draft(p_version uuid,p_expected integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE product uuid; current_no integer;
BEGIN
 SELECT r.product_id INTO product FROM master_recipe_version v
 JOIN master_recipe r ON r.id=v.master_recipe_id WHERE v.id=p_version;
 PERFORM recipe_draft_actor(product);
 SELECT change_no INTO current_no FROM master_recipe_version WHERE id=p_version FOR UPDATE;
 IF current_no IS NULL OR current_no IS DISTINCT FROM p_expected THEN
   RAISE EXCEPTION 'MBR-concept is ondertussen gewijzigd' USING ERRCODE='40001';
 END IF;
 RETURN current_no;
END $$;

CREATE OR REPLACE FUNCTION recipe_update_draft(p_version uuid,p_expected integer,p_name text,p_description text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer; result_no integer;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 UPDATE master_recipe_version SET name=p_name,description=p_description,change_no=current_no+1
 WHERE id=p_version RETURNING change_no INTO result_no;
 RETURN result_no;
END $$;

-- Audit van conceptverwijderingen is toegestaan voor uitsluitend deze twee
-- tabellen. Het bestaande log_config blijft ongewijzigd voor andere domeinen.
CREATE FUNCTION recipe_procedure_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE old_data jsonb; new_data jsonb; actor uuid; label text;
BEGIN
 IF TG_OP<>'INSERT' THEN old_data:=to_jsonb(OLD); END IF;
 IF TG_OP<>'DELETE' THEN new_data:=to_jsonb(NEW); END IF;
 actor:=execution_session_actor(current_setting('fabriek.execution_proof',true));
 IF actor IS NOT NULL THEN
   SELECT gebruikersnaam INTO label FROM gebruiker WHERE id=actor;
 ELSE
   label:='[niet persoonlijk bewezen]';
 END IF;
 INSERT INTO config_log(tabel,record_id,actie,oud,nieuw,gewijzigd_door,actor_user_id,actor_origin)
 VALUES(TG_TABLE_NAME,(coalesce(new_data,old_data)->>'id')::uuid,TG_OP,old_data,new_data,label,
        actor,CASE WHEN actor IS NULL THEN 'unverified' ELSE 'personal' END);
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recipe_element_audit AFTER INSERT OR UPDATE OR DELETE ON recipe_procedural_element
 FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();
CREATE TRIGGER recipe_dependency_audit AFTER INSERT OR UPDATE OR DELETE ON recipe_dependency
 FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();

CREATE FUNCTION recipe_procedure_list(p_version uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE product uuid; result jsonb;
BEGIN
 SELECT r.product_id INTO product FROM master_recipe_version v
 JOIN master_recipe r ON r.id=v.master_recipe_id WHERE v.id=p_version;
 PERFORM recipe_draft_actor(product);
 -- Eén statement/snapshot voor teller en inhoud.
 SELECT jsonb_build_object('change_no',v.change_no,
   'elements',COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.parent_id NULLS FIRST,e.position)
     FROM recipe_procedural_element e WHERE e.recipe_version_id=v.id),'[]'::jsonb),
   'dependencies',COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.predecessor_id,d.successor_id)
     FROM recipe_dependency d WHERE d.recipe_version_id=v.id),'[]'::jsonb))
 INTO result FROM master_recipe_version v WHERE v.id=p_version;
 RETURN result;
END $$;

-- Eén expliciete bewerking per transactie; bij fout rollen teller, audit en
-- inhoud samen terug. Parentsoort komt uit een vertrouwd record.
CREATE FUNCTION recipe_save_element(p_version uuid,p_expected integer,p_id uuid,p_parent uuid,
 p_kind text,p_code text,p_name text,p_position integer,p_required boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer; target uuid; parent_type text;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 IF p_parent IS NOT NULL THEN
   SELECT kind INTO parent_type FROM recipe_procedural_element WHERE recipe_version_id=p_version AND id=p_parent;
   IF NOT FOUND THEN RAISE EXCEPTION 'Onbekend procedureparent binnen deze versie' USING ERRCODE='23503'; END IF;
 END IF;
 IF p_id IS NULL THEN
   INSERT INTO recipe_procedural_element(recipe_version_id,parent_id,parent_kind,kind,code,name,position,required)
   VALUES(p_version,p_parent,parent_type,p_kind,p_code,p_name,p_position,p_required) RETURNING id INTO target;
 ELSE
   UPDATE recipe_procedural_element SET parent_id=p_parent,parent_kind=parent_type,
      code=p_code,name=p_name,position=p_position,required=p_required
   WHERE id=p_id AND recipe_version_id=p_version AND kind=p_kind RETURNING id INTO target;
   IF NOT FOUND THEN RAISE EXCEPTION 'Onbekend procedure-element of gewijzigd type' USING ERRCODE='23503'; END IF;
 END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN jsonb_build_object('id',target,'change_no',current_no+1);
END $$;

CREATE FUNCTION recipe_delete_element(p_version uuid,p_expected integer,p_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 DELETE FROM recipe_procedural_element WHERE recipe_version_id=p_version AND id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekend procedure-element binnen deze versie' USING ERRCODE='23503'; END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN current_no+1;
END $$;

CREATE FUNCTION recipe_add_dependency(p_version uuid,p_expected integer,p_predecessor uuid,p_successor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer; target uuid;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 INSERT INTO recipe_dependency(recipe_version_id,predecessor_id,successor_id)
 VALUES(p_version,p_predecessor,p_successor) RETURNING id INTO target;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN jsonb_build_object('id',target,'change_no',current_no+1);
END $$;

CREATE FUNCTION recipe_delete_dependency(p_version uuid,p_expected integer,p_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 DELETE FROM recipe_dependency WHERE recipe_version_id=p_version AND id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende afhankelijkheid binnen deze versie' USING ERRCODE='23503'; END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN current_no+1;
END $$;

REVOKE ALL ON FUNCTION recipe_lock_draft(uuid,integer),recipe_procedure_audit(),
 recipe_procedure_list(uuid),recipe_save_element(uuid,integer,uuid,uuid,text,text,text,integer,boolean),
 recipe_delete_element(uuid,integer,uuid),recipe_add_dependency(uuid,integer,uuid,uuid),
 recipe_delete_dependency(uuid,integer,uuid) FROM PUBLIC;

COMMIT;

BEGIN;
-- Migratie 0102: versiegebonden parameters en vijf afzonderlijke voorwaarden (#111, D89 T09).
SET search_path = fabriek, public;

CREATE TABLE recipe_parameter (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_version_id uuid NOT NULL REFERENCES master_recipe_version(id),
    procedural_element_id uuid NOT NULL,
    code text NOT NULL CHECK (code ~ '[^[:space:]]' AND length(code)<=100),
    name text NOT NULL CHECK (name ~ '[^[:space:]]' AND length(name)<=250),
    data_type text NOT NULL CHECK (data_type IN ('decimal','integer','boolean','text')),
    unit text CHECK (unit IS NULL OR (unit ~ '[^[:space:]]' AND length(unit)<=40)),
    frequency text NOT NULL CHECK (frequency ~ '[^[:space:]]'),
    required boolean NOT NULL,
    responsible_activity text NOT NULL CHECK (responsible_activity ~ '[^[:space:]]'),
    critical boolean NOT NULL,
    UNIQUE (recipe_version_id,id),
    UNIQUE (recipe_version_id,id,data_type),
    UNIQUE (recipe_version_id,code),
    FOREIGN KEY (recipe_version_id,procedural_element_id)
      REFERENCES recipe_procedural_element(recipe_version_id,id),
    CHECK (data_type IN ('decimal','integer') OR unit IS NULL)
);

-- Doelwaarde is een afzonderlijk getal, niet een impliciete onder-/bovengrens.
-- De overige categorieën zijn onafhankelijk en mogen eenzijdig begrensd zijn.
-- Geen stilzwijgende omzetting naar procenten of afgeleide SPC-grenzen.
CREATE TABLE recipe_parameter_limit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_version_id uuid NOT NULL,
    parameter_id uuid NOT NULL,
    data_type text NOT NULL CHECK (data_type IN ('decimal','integer')),
    category text NOT NULL CHECK (category IN ('target','operating_tolerance','process_limit','specification_limit','statistical_control_limit')),
    target_value numeric,
    lower_value numeric,
    upper_value numeric,
    FOREIGN KEY (recipe_version_id,parameter_id,data_type)
      REFERENCES recipe_parameter(recipe_version_id,id,data_type),
    UNIQUE (recipe_version_id,parameter_id,category),
    CHECK (
      (category='target' AND target_value IS NOT NULL AND lower_value IS NULL AND upper_value IS NULL)
      OR
      (category<>'target' AND target_value IS NULL AND (lower_value IS NOT NULL OR upper_value IS NOT NULL))
    ),
    CHECK (lower_value IS NULL OR upper_value IS NULL OR lower_value<=upper_value),
    CHECK (target_value IS NULL OR target_value NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
    CHECK (lower_value IS NULL OR lower_value NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
    CHECK (upper_value IS NULL OR upper_value NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
    CHECK (data_type<>'integer' OR
      ((target_value IS NULL OR target_value=trunc(target_value)) AND
       (lower_value IS NULL OR lower_value=trunc(lower_value)) AND
       (upper_value IS NULL OR upper_value=trunc(upper_value))))
);

-- Serialiseer conceptinhoud per versie; bestaande procedureguard heeft
-- specifieke edge-logica en wordt daarom niet hergebruikt voor parameters.
CREATE FUNCTION recipe_parameter_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v uuid;
BEGIN
 v:=CASE WHEN TG_OP='DELETE' THEN OLD.recipe_version_id ELSE NEW.recipe_version_id END;
 PERFORM 1 FROM master_recipe_version WHERE id=v FOR UPDATE;
 IF TG_OP='UPDATE' THEN
   IF NEW.id IS DISTINCT FROM OLD.id OR NEW.recipe_version_id IS DISTINCT FROM OLD.recipe_version_id THEN
     RAISE EXCEPTION 'Parameteridentiteit en versie zijn onveranderlijk' USING ERRCODE='55000';
   END IF;
   -- Eenheidswijzigingen mogen bestaande numerieke voorwaarden niet
   -- stilzwijgend een andere betekenis geven.
   IF TG_TABLE_NAME='recipe_parameter' THEN
     IF NEW.unit IS DISTINCT FROM OLD.unit AND EXISTS (
       SELECT 1 FROM recipe_parameter_limit WHERE recipe_version_id=v AND parameter_id=OLD.id
     ) THEN
       RAISE EXCEPTION 'Verwijder of herdefinieer eerst de voorwaarden bij eenheidswijziging' USING ERRCODE='23514';
     END IF;
   END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recipe_parameter_guard BEFORE INSERT OR UPDATE OR DELETE ON recipe_parameter
 FOR EACH ROW EXECUTE FUNCTION recipe_parameter_guard();
CREATE TRIGGER recipe_parameter_limit_guard BEFORE INSERT OR UPDATE OR DELETE ON recipe_parameter_limit
 FOR EACH ROW EXECUTE FUNCTION recipe_parameter_guard();
CREATE TRIGGER recipe_parameter_audit AFTER INSERT OR UPDATE OR DELETE ON recipe_parameter
 FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();
CREATE TRIGGER recipe_parameter_limit_audit AFTER INSERT OR UPDATE OR DELETE ON recipe_parameter_limit
 FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();

REVOKE ALL ON FUNCTION recipe_parameter_guard() FROM PUBLIC;
REVOKE ALL ON recipe_parameter,recipe_parameter_limit FROM PUBLIC;
-- Nog geen runtimefuncties of tabeltoegang. Frequentie en verantwoordelijke
-- zijn voorlopig expliciete conceptlabels, geen uitgevoerde regels of grants.
-- Niet-numerieke voorwaarden, schaalbeleid en vrijgavevalidatie volgen.

COMMIT;

BEGIN;
-- Migratie 0103: referentieformule, materiaalversies en expliciet schaalbeleid (#111).
SET search_path = fabriek, public;

CREATE TABLE recipe_formula (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_version_id uuid NOT NULL UNIQUE REFERENCES master_recipe_version(id),
    reference_quantity numeric NOT NULL CHECK (reference_quantity>0 AND reference_quantity NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
    reference_unit text NOT NULL CHECK (reference_unit ~ '[^[:space:]]' AND length(reference_unit)<=40),
    UNIQUE (recipe_version_id,id)
);

CREATE TABLE recipe_material_requirement (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_version_id uuid NOT NULL,
    formula_id uuid NOT NULL,
    procedural_element_id uuid,
    material_version_id uuid NOT NULL REFERENCES material_definition_version(id),
    code text NOT NULL CHECK (code ~ '[^[:space:]]' AND length(code)<=100),
    direction text NOT NULL CHECK (direction IN ('input','output')),
    quantity numeric NOT NULL CHECK (quantity>0 AND quantity NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
    unit text NOT NULL CHECK (unit ~ '[^[:space:]]' AND length(unit)<=40),
    scaling text NOT NULL CHECK (scaling IN ('fixed','linear')),
    UNIQUE (recipe_version_id,code),
    FOREIGN KEY (recipe_version_id,formula_id) REFERENCES recipe_formula(recipe_version_id,id),
    FOREIGN KEY (recipe_version_id,procedural_element_id) REFERENCES recipe_procedural_element(recipe_version_id,id)
);

-- Een parameter is standaard vast. Alleen een expliciete schaalkeuze
-- kan een numerieke voorwaarde later laten schalen in de Control Recipe.
ALTER TABLE recipe_parameter_limit ADD COLUMN scaling text NOT NULL DEFAULT 'fixed'
 CHECK (scaling IN ('fixed','linear'));

CREATE FUNCTION recipe_formula_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v uuid; material_unit text;
BEGIN
 v:=CASE WHEN TG_OP='DELETE' THEN OLD.recipe_version_id ELSE NEW.recipe_version_id END;
 PERFORM 1 FROM master_recipe_version WHERE id=v FOR UPDATE;
 IF TG_OP='UPDATE' THEN
   IF NEW.id IS DISTINCT FROM OLD.id OR NEW.recipe_version_id IS DISTINCT FROM OLD.recipe_version_id THEN
     RAISE EXCEPTION 'Formule-identiteit en versie zijn onveranderlijk' USING ERRCODE='55000';
   END IF;
   IF TG_TABLE_NAME='recipe_formula' THEN
     IF (NEW.reference_quantity,NEW.reference_unit) IS DISTINCT FROM (OLD.reference_quantity,OLD.reference_unit)
        AND (EXISTS (SELECT 1 FROM recipe_material_requirement WHERE formula_id=OLD.id)
             OR EXISTS (SELECT 1 FROM recipe_parameter_limit WHERE recipe_version_id=v AND scaling='linear')) THEN
       RAISE EXCEPTION 'Herdefinieer eerst formulehoeveelheden en schaalbare voorwaarden bij wijziging referentiegrootte' USING ERRCODE='23514';
     END IF;
   END IF;
 END IF;
 IF TG_TABLE_NAME='recipe_material_requirement' AND TG_OP<>'DELETE' THEN
   SELECT unit INTO material_unit FROM material_definition_version WHERE id=NEW.material_version_id;
   IF NOT FOUND THEN
     RAISE EXCEPTION 'Onbekende materiaalversie' USING ERRCODE='23503';
   END IF;
   IF material_unit IS NULL OR material_unit IS DISTINCT FROM NEW.unit THEN
     RAISE EXCEPTION 'Materiaaleenheid ontbreekt of wijkt af; geen impliciete conversie' USING ERRCODE='23514';
   END IF;
 END IF;
 IF TG_TABLE_NAME='recipe_formula' AND TG_OP='DELETE' THEN
   IF EXISTS (SELECT 1 FROM recipe_parameter_limit WHERE recipe_version_id=v AND scaling='linear') THEN
     RAISE EXCEPTION 'Schaalbare voorwaarden vereisen een referentieformule' USING ERRCODE='23514';
   END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recipe_formula_guard BEFORE INSERT OR UPDATE OR DELETE ON recipe_formula
 FOR EACH ROW EXECUTE FUNCTION recipe_formula_guard();
CREATE TRIGGER recipe_material_requirement_guard BEFORE INSERT OR UPDATE OR DELETE ON recipe_material_requirement
 FOR EACH ROW EXECUTE FUNCTION recipe_formula_guard();

CREATE FUNCTION recipe_limit_scaling_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
 PERFORM 1 FROM master_recipe_version WHERE id=NEW.recipe_version_id FOR UPDATE;
 IF NEW.scaling='linear' AND NOT EXISTS (SELECT 1 FROM recipe_formula WHERE recipe_version_id=NEW.recipe_version_id) THEN
   RAISE EXCEPTION 'Schaalbare voorwaarden vereisen een referentieformule' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recipe_limit_scaling_guard BEFORE INSERT OR UPDATE ON recipe_parameter_limit
 FOR EACH ROW EXECUTE FUNCTION recipe_limit_scaling_guard();

CREATE TRIGGER recipe_formula_audit AFTER INSERT OR UPDATE OR DELETE ON recipe_formula
 FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();
CREATE TRIGGER recipe_material_requirement_audit AFTER INSERT OR UPDATE OR DELETE ON recipe_material_requirement
 FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();

REVOKE ALL ON FUNCTION recipe_formula_guard(),recipe_limit_scaling_guard() FROM PUBLIC;
REVOKE ALL ON recipe_formula,recipe_material_requirement FROM PUBLIC;
-- Geen automatisch schalen tijdens uitvoering, geen eenhedenconverter,
-- geen veronderstelde massabalans of verplichte opbrengst. Conceptbeheer volgt.

COMMIT;

BEGIN;
-- Migratie 0104: fysische dimensies, grootheden, eenheden en conversieversies (D106/#141).
SET search_path = fabriek, public;

-- SI-basisdimensies: lengte, massa, tijd, stroom, temperatuur,
-- hoeveelheid stof en lichtsterkte. Dimensionele gelijkheid alleen is
-- onvoldoende voor conversie (bv. energie/koppel of absolute/delta-temperatuur).
CREATE TABLE quantity_dimension (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    length_exp smallint NOT NULL,
    mass_exp smallint NOT NULL,
    time_exp smallint NOT NULL,
    current_exp smallint NOT NULL,
    temperature_exp smallint NOT NULL,
    amount_exp smallint NOT NULL,
    luminous_exp smallint NOT NULL,
    UNIQUE (length_exp,mass_exp,time_exp,current_exp,temperature_exp,amount_exp,luminous_exp)
);
CREATE TABLE quantity_kind (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dimension_id uuid NOT NULL REFERENCES quantity_dimension(id),
    code text NOT NULL UNIQUE CHECK (code ~ '[^[:space:]]' AND length(code)<=100),
    name text NOT NULL CHECK (name ~ '[^[:space:]]'),
    value_semantics text NOT NULL CHECK (value_semantics IN ('ratio','absolute','difference')),
    UNIQUE (id,value_semantics)
);
CREATE TABLE measurement_unit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    quantity_kind_id uuid NOT NULL REFERENCES quantity_kind(id),
    code text NOT NULL UNIQUE CHECK (code ~ '[^[:space:]]' AND length(code)<=100),
    symbol text NOT NULL CHECK (symbol ~ '[^[:space:]]' AND length(symbol)<=40),
    name text NOT NULL CHECK (name ~ '[^[:space:]]'),
    UNIQUE (quantity_kind_id,id)
);
CREATE TABLE unit_conversion (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    quantity_kind_id uuid NOT NULL REFERENCES quantity_kind(id),
    from_unit_id uuid NOT NULL,
    to_unit_id uuid NOT NULL,
    UNIQUE (from_unit_id,to_unit_id),
    UNIQUE (id,quantity_kind_id),
    FOREIGN KEY (quantity_kind_id,from_unit_id) REFERENCES measurement_unit(quantity_kind_id,id),
    FOREIGN KEY (quantity_kind_id,to_unit_id) REFERENCES measurement_unit(quantity_kind_id,id),
    CHECK (from_unit_id<>to_unit_id)
);
CREATE TABLE unit_conversion_version (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversion_id uuid NOT NULL,
    quantity_kind_id uuid NOT NULL,
    value_semantics text NOT NULL,
    revision integer NOT NULL CHECK (revision>0),
    factor_numerator numeric NOT NULL CHECK (factor_numerator>0 AND factor_numerator NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
    factor_denominator numeric NOT NULL CHECK (factor_denominator>0 AND factor_denominator NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
    additive_offset numeric NOT NULL CHECK (additive_offset NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
    source_reference text NOT NULL CHECK (source_reference ~ '[^[:space:]]'),
    created_by uuid NOT NULL REFERENCES gebruiker(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (conversion_id,quantity_kind_id) REFERENCES unit_conversion(id,quantity_kind_id),
    FOREIGN KEY (quantity_kind_id,value_semantics) REFERENCES quantity_kind(id,value_semantics),
    UNIQUE (conversion_id,revision),
    CHECK (value_semantics='absolute' OR additive_offset=0)
);

-- Catalogusidentiteiten zijn onveranderlijk; correctie vereist nieuwe
-- definitie of conversierevisie, nooit wijziging van een historisch record.
CREATE FUNCTION unit_catalog_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Eenhedencatalogus en conversieversies zijn onveranderlijk' USING ERRCODE='55000';
END $$;
CREATE TRIGGER quantity_dimension_immutable BEFORE UPDATE OR DELETE ON quantity_dimension
 FOR EACH ROW EXECUTE FUNCTION unit_catalog_immutable();
CREATE TRIGGER quantity_kind_immutable BEFORE UPDATE OR DELETE ON quantity_kind
 FOR EACH ROW EXECUTE FUNCTION unit_catalog_immutable();
CREATE TRIGGER measurement_unit_immutable BEFORE UPDATE OR DELETE ON measurement_unit
 FOR EACH ROW EXECUTE FUNCTION unit_catalog_immutable();
CREATE TRIGGER unit_conversion_immutable BEFORE UPDATE OR DELETE ON unit_conversion
 FOR EACH ROW EXECUTE FUNCTION unit_catalog_immutable();
CREATE TRIGGER unit_conversion_version_immutable BEFORE UPDATE OR DELETE ON unit_conversion_version
 FOR EACH ROW EXECUTE FUNCTION unit_catalog_immutable();

CREATE TRIGGER quantity_dimension_audit AFTER INSERT ON quantity_dimension FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();
CREATE TRIGGER quantity_kind_audit AFTER INSERT ON quantity_kind FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();
CREATE TRIGGER measurement_unit_audit AFTER INSERT ON measurement_unit FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();
CREATE TRIGGER unit_conversion_audit AFTER INSERT ON unit_conversion FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();
CREATE TRIGGER unit_conversion_version_audit AFTER INSERT ON unit_conversion_version FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();

-- Verbind de nieuwe catalogus expliciet met de bestaande conceptdefinities.
-- Onbekende legacy-eenheden worden niet automatisch op basis van tekst gekoppeld.
-- Tekst blijft tijdelijk behouden voor migratie en bestaande interfaces.
ALTER TABLE material_definition_version ADD COLUMN measurement_unit_id uuid REFERENCES measurement_unit(id);
ALTER TABLE recipe_parameter ADD COLUMN measurement_unit_id uuid REFERENCES measurement_unit(id);
ALTER TABLE recipe_parameter ADD CONSTRAINT recipe_parameter_numeric_unit
 CHECK (measurement_unit_id IS NULL OR data_type IN ('decimal','integer'));
ALTER TABLE recipe_formula ADD COLUMN reference_unit_id uuid REFERENCES measurement_unit(id);
ALTER TABLE recipe_material_requirement ADD COLUMN measurement_unit_id uuid REFERENCES measurement_unit(id);

-- Voorkom tegenstrijdige tekst en cataloguskoppeling. Bij materialen blijft
-- de exacte materiaalversie leidend; andere eenheid vereist later een
-- expliciete conversiedefinitie, niet een stilzwijgende aanpassing.
CREATE FUNCTION measurement_unit_link_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE uid uuid; label text; canonical text; material_uid uuid;
BEGIN
 IF TG_TABLE_NAME='recipe_formula' THEN
   uid:=NEW.reference_unit_id;
   label:=NEW.reference_unit;
   IF TG_OP='UPDATE' THEN
     IF NEW.reference_unit_id IS DISTINCT FROM OLD.reference_unit_id AND
        (EXISTS (SELECT 1 FROM recipe_material_requirement WHERE formula_id=OLD.id)
         OR EXISTS (SELECT 1 FROM recipe_parameter_limit WHERE recipe_version_id=OLD.recipe_version_id AND scaling='linear')) THEN
       RAISE EXCEPTION 'Herdefinieer eerst afhankelijke formulewaarden bij eenheidskoppeling' USING ERRCODE='23514';
     END IF;
   END IF;
 ELSE
   uid:=NEW.measurement_unit_id;
   label:=NEW.unit;
   IF TG_TABLE_NAME='recipe_parameter' AND TG_OP='UPDATE' THEN
     IF NEW.measurement_unit_id IS DISTINCT FROM OLD.measurement_unit_id AND
        EXISTS (SELECT 1 FROM recipe_parameter_limit WHERE recipe_version_id=OLD.recipe_version_id AND parameter_id=OLD.id) THEN
       RAISE EXCEPTION 'Herdefinieer eerst voorwaarden bij eenheidskoppeling' USING ERRCODE='23514';
     END IF;
   END IF;
 END IF;
 IF uid IS NOT NULL THEN
   SELECT symbol INTO canonical FROM measurement_unit WHERE id=uid;
   IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende eenheid' USING ERRCODE='23503'; END IF;
   IF canonical IS DISTINCT FROM label THEN
     RAISE EXCEPTION 'Eenheidstekst wijkt af van catalogusdefinitie' USING ERRCODE='23514';
   END IF;
 END IF;
 IF TG_TABLE_NAME='recipe_material_requirement' THEN
   SELECT measurement_unit_id INTO material_uid FROM material_definition_version WHERE id=NEW.material_version_id;
   IF material_uid IS DISTINCT FROM uid THEN
     RAISE EXCEPTION 'Materiaaleenheid vereist dezelfde cataloguskoppeling' USING ERRCODE='23514';
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER measurement_unit_link_guard BEFORE INSERT ON material_definition_version
 FOR EACH ROW EXECUTE FUNCTION measurement_unit_link_guard();
CREATE TRIGGER measurement_unit_link_guard BEFORE INSERT OR UPDATE ON recipe_parameter
 FOR EACH ROW EXECUTE FUNCTION measurement_unit_link_guard();
CREATE TRIGGER measurement_unit_link_guard BEFORE INSERT OR UPDATE ON recipe_formula
 FOR EACH ROW EXECUTE FUNCTION measurement_unit_link_guard();
CREATE TRIGGER measurement_unit_link_guard BEFORE INSERT OR UPDATE ON recipe_material_requirement
 FOR EACH ROW EXECUTE FUNCTION measurement_unit_link_guard();

REVOKE ALL ON FUNCTION unit_catalog_immutable(),measurement_unit_link_guard() FROM PUBLIC;
REVOKE ALL ON quantity_dimension,quantity_kind,measurement_unit,unit_conversion,unit_conversion_version FROM PUBLIC;

-- Geen standaardcatalogus, conversie-uitvoering of directe runtimewrites.
-- Persoonlijk beheer, versiecreatie, selectie van exacte conversieversies,
-- vrijgavecontrole en gecontroleerde bronmapping volgen binnen fase 2.
-- Contextafhankelijke conversies en de uitvoeringsengine volgen fase 6.

COMMIT;

BEGIN;
-- Migratie 0105: getypeerde, versiegebonden schaalregeldefinities (D106/#141).
SET search_path = fabriek, public;

-- Een regel is een conceptdefinitie binnen één MBR-revisie. Een gewijzigde
-- regel valt onder dezelfde MBR-wijzigingsteller en toekomstige vrijgavepoort.
-- Geen uitvoerbare tekst, SQL, scripts of impliciete formulekeuze.
CREATE TABLE recipe_scaling_rule (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 recipe_version_id uuid NOT NULL REFERENCES master_recipe_version(id),
 code text NOT NULL CHECK (code ~ '[^[:space:]]' AND length(code)<=100),
 description text NOT NULL CHECK (description ~ '[^[:space:]]'),
 rule_kind text NOT NULL CHECK (rule_kind IN ('nonlinear','parameter_dependent','equipment_dependent')),
 output_unit_id uuid NOT NULL REFERENCES measurement_unit(id),
 source_reference text NOT NULL CHECK (source_reference ~ '[^[:space:]]'),
 applicability text NOT NULL CHECK (applicability ~ '[^[:space:]]'),
 UNIQUE (recipe_version_id,id),
 UNIQUE (recipe_version_id,code)
);

ALTER TABLE recipe_parameter_limit ADD UNIQUE (recipe_version_id,id);
ALTER TABLE recipe_material_requirement ADD UNIQUE (recipe_version_id,id);

-- Getypeerde invoerbronnen. Een equipment-eigenschap is voorlopig een
-- expliciete vereiste, niet een verwijzing naar een nog niet bestaand asset.
CREATE TABLE recipe_scaling_input (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 recipe_version_id uuid NOT NULL,
 rule_id uuid NOT NULL,
 code text NOT NULL CHECK (code ~ '[^[:space:]]' AND length(code)<=100),
 source_kind text NOT NULL CHECK (source_kind IN ('batch_quantity','parameter','equipment_property','constant')),
 parameter_id uuid,
 equipment_property text,
 constant_value numeric,
 unit_id uuid NOT NULL REFERENCES measurement_unit(id),
 conversion_version_id uuid REFERENCES unit_conversion_version(id),
 FOREIGN KEY (recipe_version_id,rule_id) REFERENCES recipe_scaling_rule(recipe_version_id,id),
 FOREIGN KEY (recipe_version_id,parameter_id) REFERENCES recipe_parameter(recipe_version_id,id),
 UNIQUE (recipe_version_id,rule_id,code),
 CHECK (
   (source_kind='batch_quantity' AND parameter_id IS NULL AND equipment_property IS NULL AND constant_value IS NULL)
   OR (source_kind='parameter' AND parameter_id IS NOT NULL AND equipment_property IS NULL AND constant_value IS NULL)
   OR (source_kind='equipment_property' AND parameter_id IS NULL AND equipment_property IS NOT NULL AND equipment_property ~ '[^[:space:]]' AND constant_value IS NULL)
   OR (source_kind='constant' AND parameter_id IS NULL AND equipment_property IS NULL AND constant_value IS NOT NULL)
 ),
 CHECK (constant_value IS NULL OR constant_value NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric')),
 CHECK (source_kind NOT IN ('constant','equipment_property') OR conversion_version_id IS NULL)
);

-- Voorbereide uitgaande koppeling. Fixed/linear blijven de enige
-- uitvoerbare basiskeuzes; een complexe definitie mag niet stilzwijgend
-- als fixed/linear worden geïnterpreteerd. Vrijgavepoort volgt in 2.5.
CREATE TABLE recipe_scaling_binding (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 recipe_version_id uuid NOT NULL,
 rule_id uuid NOT NULL,
 parameter_limit_id uuid,
 material_requirement_id uuid,
 FOREIGN KEY (recipe_version_id,rule_id) REFERENCES recipe_scaling_rule(recipe_version_id,id),
 FOREIGN KEY (recipe_version_id,parameter_limit_id) REFERENCES recipe_parameter_limit(recipe_version_id,id),
 FOREIGN KEY (recipe_version_id,material_requirement_id) REFERENCES recipe_material_requirement(recipe_version_id,id),
 UNIQUE (recipe_version_id,parameter_limit_id),
 UNIQUE (recipe_version_id,material_requirement_id),
 CHECK ((parameter_limit_id IS NOT NULL)::integer+(material_requirement_id IS NOT NULL)::integer=1)
);

-- Alle schrijvers in deze conceptgrafiek worden per receptversie geserialiseerd.
-- De bestaande parameter/formuleguards blijven van kracht.
CREATE FUNCTION recipe_scaling_graph_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v uuid; source_unit uuid; output_unit uuid; conv_from uuid; conv_to uuid;
BEGIN
 v:=CASE WHEN TG_OP='DELETE' THEN OLD.recipe_version_id ELSE NEW.recipe_version_id END;
 PERFORM 1 FROM master_recipe_version WHERE id=v FOR UPDATE;
 IF TG_OP='UPDATE' THEN
   IF NEW.id IS DISTINCT FROM OLD.id OR NEW.recipe_version_id IS DISTINCT FROM OLD.recipe_version_id THEN
     RAISE EXCEPTION 'Schaalregelidentiteit en versie zijn onveranderlijk' USING ERRCODE='55000';
   END IF;
   IF TG_TABLE_NAME='recipe_scaling_rule' THEN
     IF NEW.output_unit_id IS DISTINCT FROM OLD.output_unit_id AND EXISTS (
       SELECT 1 FROM recipe_scaling_binding WHERE rule_id=OLD.id
     ) THEN
       RAISE EXCEPTION 'Verwijder eerst de uitvoerkoppelingen bij eenheidswijziging' USING ERRCODE='23514';
     END IF;
   END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF TG_TABLE_NAME='recipe_scaling_input' THEN
   IF NEW.source_kind='batch_quantity' THEN
     SELECT reference_unit_id INTO source_unit FROM recipe_formula WHERE recipe_version_id=v;
   ELSIF NEW.source_kind='parameter' THEN
     SELECT measurement_unit_id INTO source_unit FROM recipe_parameter
       WHERE recipe_version_id=v AND id=NEW.parameter_id AND data_type IN ('decimal','integer');
   ELSE
     source_unit:=NEW.unit_id;
   END IF;
   IF source_unit IS NULL THEN
     RAISE EXCEPTION 'Schaalinvoer vereist een bekende numerieke bron en cataloguseenheid' USING ERRCODE='23514';
   END IF;
   IF NEW.conversion_version_id IS NULL THEN
     IF source_unit IS DISTINCT FROM NEW.unit_id THEN
       RAISE EXCEPTION 'Expliciete conversieversie vereist voor schaalinvoer' USING ERRCODE='23514';
     END IF;
   ELSE
     SELECT c.from_unit_id,c.to_unit_id INTO conv_from,conv_to
       FROM unit_conversion_version cv JOIN unit_conversion c ON c.id=cv.conversion_id
       WHERE cv.id=NEW.conversion_version_id;
     IF conv_from IS DISTINCT FROM source_unit OR conv_to IS DISTINCT FROM NEW.unit_id THEN
       RAISE EXCEPTION 'Conversieversie past niet bij schaalinvoer' USING ERRCODE='23514';
     END IF;
   END IF;
 ELSIF TG_TABLE_NAME='recipe_scaling_binding' THEN
   SELECT output_unit_id INTO output_unit FROM recipe_scaling_rule WHERE recipe_version_id=v AND id=NEW.rule_id;
   IF NEW.parameter_limit_id IS NOT NULL THEN
     SELECT p.measurement_unit_id INTO source_unit FROM recipe_parameter_limit l JOIN recipe_parameter p
       ON p.recipe_version_id=l.recipe_version_id AND p.id=l.parameter_id
       WHERE l.recipe_version_id=v AND l.id=NEW.parameter_limit_id;
   ELSE
     SELECT measurement_unit_id INTO source_unit FROM recipe_material_requirement
       WHERE recipe_version_id=v AND id=NEW.material_requirement_id;
   END IF;
   IF source_unit IS NULL OR source_unit IS DISTINCT FROM output_unit THEN
     RAISE EXCEPTION 'Schaaluitvoer vereist dezelfde bekende cataloguseenheid als doel' USING ERRCODE='23514';
   END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE TRIGGER recipe_scaling_rule_guard BEFORE INSERT OR UPDATE OR DELETE ON recipe_scaling_rule
 FOR EACH ROW EXECUTE FUNCTION recipe_scaling_graph_guard();
CREATE TRIGGER recipe_scaling_input_guard BEFORE INSERT OR UPDATE OR DELETE ON recipe_scaling_input
 FOR EACH ROW EXECUTE FUNCTION recipe_scaling_graph_guard();
CREATE TRIGGER recipe_scaling_binding_guard BEFORE INSERT OR UPDATE OR DELETE ON recipe_scaling_binding
 FOR EACH ROW EXECUTE FUNCTION recipe_scaling_graph_guard();

-- Conservatief conceptmodel: voorkom zelfafhankelijkheid en cycli tussen
-- regeluitvoer (parameter) en andere parameterinvoer. Alleen structurele
-- validatie, geen berekening of evaluatie van gebruikersformules.
CREATE FUNCTION recipe_scaling_check_cycles() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v uuid;
BEGIN
 v:=CASE WHEN TG_OP='DELETE' THEN OLD.recipe_version_id ELSE NEW.recipe_version_id END;
 IF EXISTS (
   WITH RECURSIVE edges(a,b) AS (
     SELECT b.rule_id,i.rule_id
       FROM recipe_scaling_binding b
       JOIN recipe_parameter_limit l ON l.recipe_version_id=b.recipe_version_id AND l.id=b.parameter_limit_id
       JOIN recipe_scaling_input i ON i.recipe_version_id=b.recipe_version_id AND i.parameter_id=l.parameter_id
       WHERE b.recipe_version_id=v AND i.source_kind='parameter'
   ), reach(a,b) AS (
     SELECT a,b FROM edges UNION SELECT r.a,e.b FROM reach r JOIN edges e ON e.a=r.b
   ) SELECT 1 FROM reach WHERE a=b
 ) THEN
   RAISE EXCEPTION 'Circulaire afhankelijkheid in schaalregels' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recipe_scaling_input_cycles AFTER INSERT OR UPDATE ON recipe_scaling_input
 FOR EACH ROW EXECUTE FUNCTION recipe_scaling_check_cycles();
CREATE TRIGGER recipe_scaling_binding_cycles AFTER INSERT OR UPDATE ON recipe_scaling_binding
 FOR EACH ROW EXECUTE FUNCTION recipe_scaling_check_cycles();

-- Voorkom dat bestaande bronnen/targets hun fysische betekenis verliezen.
CREATE FUNCTION recipe_scaling_source_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v uuid;
BEGIN
 v:=OLD.recipe_version_id;
 PERFORM 1 FROM master_recipe_version WHERE id=v FOR UPDATE;
 IF TG_TABLE_NAME='recipe_formula' THEN
   IF EXISTS (SELECT 1 FROM recipe_scaling_input WHERE recipe_version_id=v AND source_kind='batch_quantity') THEN
     IF TG_OP='DELETE' THEN
       RAISE EXCEPTION 'Referentieformule is schaalinvoer' USING ERRCODE='23514';
     ELSIF (NEW.reference_quantity,NEW.reference_unit,NEW.reference_unit_id) IS DISTINCT FROM
       (OLD.reference_quantity,OLD.reference_unit,OLD.reference_unit_id) THEN
       RAISE EXCEPTION 'Herdefinieer eerst schaalinvoer bij wijziging referentieformule' USING ERRCODE='23514';
     END IF;
   END IF;
 ELSIF TG_TABLE_NAME='recipe_parameter' THEN
   IF (NEW.data_type,NEW.unit,NEW.measurement_unit_id) IS DISTINCT FROM
      (OLD.data_type,OLD.unit,OLD.measurement_unit_id) AND (
      EXISTS (SELECT 1 FROM recipe_scaling_input WHERE recipe_version_id=v AND parameter_id=OLD.id)
      OR EXISTS (SELECT 1 FROM recipe_scaling_binding b JOIN recipe_parameter_limit l
        ON l.recipe_version_id=b.recipe_version_id AND l.id=b.parameter_limit_id
        WHERE l.recipe_version_id=v AND l.parameter_id=OLD.id)
   ) THEN
     RAISE EXCEPTION 'Herdefinieer eerst gekoppelde schaalregels bij parameterwijziging' USING ERRCODE='23514';
   END IF;
 ELSIF TG_TABLE_NAME='recipe_parameter_limit' THEN
   IF NEW.parameter_id IS DISTINCT FROM OLD.parameter_id AND EXISTS (
     SELECT 1 FROM recipe_scaling_binding WHERE recipe_version_id=v AND parameter_limit_id=OLD.id
   ) THEN
     RAISE EXCEPTION 'Gekoppelde schaaluitvoer kan niet naar andere parameter' USING ERRCODE='23514';
   END IF;
 ELSIF TG_TABLE_NAME='recipe_material_requirement' THEN
   IF (NEW.unit,NEW.measurement_unit_id) IS DISTINCT FROM (OLD.unit,OLD.measurement_unit_id) AND EXISTS (
     SELECT 1 FROM recipe_scaling_binding WHERE recipe_version_id=v AND material_requirement_id=OLD.id
   ) THEN
     RAISE EXCEPTION 'Herdefinieer eerst gekoppelde schaaluitvoer bij materiaaleenheidswijziging' USING ERRCODE='23514';
   END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recipe_formula_scaling_source_guard BEFORE UPDATE OR DELETE ON recipe_formula
 FOR EACH ROW EXECUTE FUNCTION recipe_scaling_source_guard();
CREATE TRIGGER recipe_parameter_scaling_source_guard BEFORE UPDATE ON recipe_parameter
 FOR EACH ROW EXECUTE FUNCTION recipe_scaling_source_guard();
CREATE TRIGGER recipe_limit_scaling_source_guard BEFORE UPDATE ON recipe_parameter_limit
 FOR EACH ROW EXECUTE FUNCTION recipe_scaling_source_guard();
CREATE TRIGGER recipe_material_scaling_source_guard BEFORE UPDATE ON recipe_material_requirement
 FOR EACH ROW EXECUTE FUNCTION recipe_scaling_source_guard();

CREATE TRIGGER recipe_scaling_rule_audit AFTER INSERT OR UPDATE OR DELETE ON recipe_scaling_rule
 FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();
CREATE TRIGGER recipe_scaling_input_audit AFTER INSERT OR UPDATE OR DELETE ON recipe_scaling_input
 FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();
CREATE TRIGGER recipe_scaling_binding_audit AFTER INSERT OR UPDATE OR DELETE ON recipe_scaling_binding
 FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();

REVOKE ALL ON FUNCTION recipe_scaling_graph_guard(),recipe_scaling_check_cycles(),recipe_scaling_source_guard() FROM PUBLIC;
REVOKE ALL ON recipe_scaling_rule,recipe_scaling_input,recipe_scaling_binding FROM PUBLIC;
-- Complexe regels zijn hier uitsluitend conceptmetadata. De ontbrekende
-- getypeerde formuledefinitie, validatie en vrijgaveblokkade moeten vóór
-- formele fase-2-acceptatie worden ingevuld. Evaluatie pas in fase 6.

COMMIT;

BEGIN;
-- Migratie 0106: receptgebonden middelen-, personeels- en registratievereisten (#111).
SET search_path = fabriek, public;

-- Voorlopig expliciete equipmentklasse-eis; definitieve resourcecatalogus
-- en fysieke toewijzing volgen fase 4. Geen verwijzing naar een legacy-pc.
CREATE TABLE recipe_equipment_requirement (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 recipe_version_id uuid NOT NULL REFERENCES master_recipe_version(id),
 procedural_element_id uuid NOT NULL,
 code text NOT NULL CHECK (code ~ '[^[:space:]]'),
 equipment_class_code text NOT NULL CHECK (equipment_class_code ~ '[^[:space:]]'),
 description text NOT NULL CHECK (description ~ '[^[:space:]]'),
 required_count integer NOT NULL CHECK (required_count>0),
 minimum_capacity numeric,
 capacity_unit_id uuid REFERENCES measurement_unit(id),
 FOREIGN KEY (recipe_version_id,procedural_element_id) REFERENCES recipe_procedural_element(recipe_version_id,id),
 UNIQUE (recipe_version_id,code),
 CHECK ((minimum_capacity IS NULL)=(capacity_unit_id IS NULL)),
 CHECK (minimum_capacity IS NULL OR (minimum_capacity>0 AND minimum_capacity NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)))
);

-- Een kwalificatie-eis is geen toekenning van een kwalificatie of permission.
-- Bewaar de omschrijving bij de receptversie; definitieve kwalificatiecontrole
-- vindt plaats bij toewijzing en uitvoering.
CREATE TABLE recipe_personnel_requirement (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 recipe_version_id uuid NOT NULL REFERENCES master_recipe_version(id),
 procedural_element_id uuid NOT NULL,
 code text NOT NULL CHECK (code ~ '[^[:space:]]'),
 qualification_code text NOT NULL REFERENCES qualification(code),
 qualification_description text NOT NULL CHECK (qualification_description ~ '[^[:space:]]'),
 required_count integer NOT NULL CHECK (required_count>0),
 FOREIGN KEY (recipe_version_id,procedural_element_id) REFERENCES recipe_procedural_element(recipe_version_id,id),
 UNIQUE (recipe_version_id,code),
 UNIQUE (recipe_version_id,procedural_element_id,qualification_code)
);

CREATE TABLE recipe_instruction (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 recipe_version_id uuid NOT NULL REFERENCES master_recipe_version(id),
 procedural_element_id uuid NOT NULL,
 code text NOT NULL CHECK (code ~ '[^[:space:]]'),
 position integer NOT NULL CHECK (position>0),
 instruction_text text NOT NULL CHECK (instruction_text ~ '[^[:space:]]'),
 confirmation_required boolean NOT NULL,
 FOREIGN KEY (recipe_version_id,procedural_element_id) REFERENCES recipe_procedural_element(recipe_version_id,id),
 UNIQUE (recipe_version_id,code),
 UNIQUE (recipe_version_id,procedural_element_id,position)
);

-- Kwaliteitseis verwijst naar de exacte versiegebonden specificatiegrens
-- binnen het MBR, niet naar een dynamische 'laatste' PoC-specificatie.
-- Een afzonderlijke definitieve kwaliteitscatalogus volgt waar nodig;
-- bronmapping van oude specificaties onder #113, geen verzonnen historie.
CREATE TABLE recipe_specification_link (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 recipe_version_id uuid NOT NULL REFERENCES master_recipe_version(id),
 parameter_limit_id uuid NOT NULL,
 code text NOT NULL CHECK (code ~ '[^[:space:]]'),
 description text NOT NULL CHECK (description ~ '[^[:space:]]'),
 FOREIGN KEY (recipe_version_id,parameter_limit_id) REFERENCES recipe_parameter_limit(recipe_version_id,id),
 UNIQUE (recipe_version_id,code),
 UNIQUE (recipe_version_id,parameter_limit_id)
);

CREATE FUNCTION recipe_requirement_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v uuid; expected_description text;
BEGIN
 v:=CASE WHEN TG_OP='DELETE' THEN OLD.recipe_version_id ELSE NEW.recipe_version_id END;
 PERFORM 1 FROM master_recipe_version WHERE id=v FOR UPDATE;
 IF TG_OP='UPDATE' THEN
   IF NEW.id IS DISTINCT FROM OLD.id OR NEW.recipe_version_id IS DISTINCT FROM OLD.recipe_version_id THEN
     RAISE EXCEPTION 'Receptvereiste-identiteit en versie zijn onveranderlijk' USING ERRCODE='55000';
   END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF TG_TABLE_NAME='recipe_personnel_requirement' THEN
   SELECT description INTO expected_description FROM qualification WHERE code=NEW.qualification_code FOR SHARE;
   IF NOT FOUND OR expected_description IS DISTINCT FROM NEW.qualification_description THEN
     RAISE EXCEPTION 'Kwalificatie-eis vereist exacte bekende kwalificatieomschrijving' USING ERRCODE='23514';
   END IF;
 ELSIF TG_TABLE_NAME='recipe_specification_link' THEN
   IF NOT EXISTS (
     SELECT 1 FROM recipe_parameter_limit WHERE recipe_version_id=v AND id=NEW.parameter_limit_id AND category='specification_limit'
   ) THEN
     RAISE EXCEPTION 'Kwaliteitseis vereist een specificatiegrens in dezelfde receptversie' USING ERRCODE='23514';
   END IF;
 END IF;
 RETURN NEW;
END $$;

-- Een grens mag niet van categorie veranderen zolang een kwaliteitseis
-- naar die grens verwijst. Receptversie en scope worden elders beschermd.
CREATE FUNCTION recipe_specification_category_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
 PERFORM 1 FROM master_recipe_version WHERE id=OLD.recipe_version_id FOR UPDATE;
 IF NEW.category IS DISTINCT FROM OLD.category AND EXISTS (
   SELECT 1 FROM recipe_specification_link WHERE recipe_version_id=OLD.recipe_version_id AND parameter_limit_id=OLD.id
 ) THEN
   RAISE EXCEPTION 'Gekoppelde kwaliteitseis vereist specificatiegrens' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recipe_specification_category_guard BEFORE UPDATE ON recipe_parameter_limit
 FOR EACH ROW EXECUTE FUNCTION recipe_specification_category_guard();

CREATE TRIGGER recipe_equipment_requirement_guard BEFORE INSERT OR UPDATE OR DELETE ON recipe_equipment_requirement
 FOR EACH ROW EXECUTE FUNCTION recipe_requirement_guard();
CREATE TRIGGER recipe_equipment_requirement_audit AFTER INSERT OR UPDATE OR DELETE ON recipe_equipment_requirement
 FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();
CREATE TRIGGER recipe_personnel_requirement_guard BEFORE INSERT OR UPDATE OR DELETE ON recipe_personnel_requirement
 FOR EACH ROW EXECUTE FUNCTION recipe_requirement_guard();
CREATE TRIGGER recipe_personnel_requirement_audit AFTER INSERT OR UPDATE OR DELETE ON recipe_personnel_requirement
 FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();
CREATE TRIGGER recipe_instruction_guard BEFORE INSERT OR UPDATE OR DELETE ON recipe_instruction
 FOR EACH ROW EXECUTE FUNCTION recipe_requirement_guard();
CREATE TRIGGER recipe_instruction_audit AFTER INSERT OR UPDATE OR DELETE ON recipe_instruction
 FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();
CREATE TRIGGER recipe_specification_link_guard BEFORE INSERT OR UPDATE OR DELETE ON recipe_specification_link
 FOR EACH ROW EXECUTE FUNCTION recipe_requirement_guard();
CREATE TRIGGER recipe_specification_link_audit AFTER INSERT OR UPDATE OR DELETE ON recipe_specification_link
 FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();

REVOKE ALL ON FUNCTION recipe_requirement_guard(),recipe_specification_category_guard() FROM PUBLIC;
REVOKE ALL ON recipe_equipment_requirement,recipe_personnel_requirement,recipe_instruction,recipe_specification_link FROM PUBLIC;
-- Geen runtimewrites, fysieke toewijzingen, kwalificatietoekenning,
-- kwaliteitsvrijgave of uitvoeringsregistraties. Equipmentklasse en
-- kwalificatiebetekenis vereisen latere gecontroleerde resourcevalidatie.

COMMIT;

BEGIN;
-- Migratie 0107: versiegebonden lotnorm en expliciete incompatibiliteit (D89 R07/R08).
SET search_path = fabriek, public;

-- Geen standaard vier batches. De norm is expliciete receptinhoud.
-- Afwijkingsreden altijd verplicht bij uitvoering; deze vlag bepaalt
-- uitsluitend of daarnaast onafhankelijke goedkeuring vereist is.
CREATE TABLE recipe_lot_rule (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 recipe_version_id uuid NOT NULL UNIQUE REFERENCES master_recipe_version(id),
 nominal_batch_count integer NOT NULL CHECK (nominal_batch_count BETWEEN 1 AND 50),
 deviation_approval_required boolean NOT NULL,
 deviation_reason_required boolean NOT NULL DEFAULT true CHECK (deviation_reason_required)
);

-- Incompatibiliteit is een verbod vanuit één exacte MBR-revisie naar
-- een andere. Bij lotvorming geldt een verbod in ELKE richting.
-- De eigenaar van de regel is de eerste revisie; een nieuw concept kan
-- een oudere versie uitsluiten zonder die oudere versie te muteren.
CREATE TABLE recipe_compatibility_rule (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 recipe_version_id uuid NOT NULL REFERENCES master_recipe_version(id),
 other_recipe_version_id uuid NOT NULL REFERENCES master_recipe_version(id),
 reason text NOT NULL CHECK (reason ~ '[^[:space:]]'),
 UNIQUE (recipe_version_id,other_recipe_version_id),
 CHECK (recipe_version_id<>other_recipe_version_id)
);

CREATE FUNCTION recipe_lot_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v uuid; p uuid; other_p uuid;
BEGIN
 v:=CASE WHEN TG_OP='DELETE' THEN OLD.recipe_version_id ELSE NEW.recipe_version_id END;
 PERFORM 1 FROM master_recipe_version WHERE id=v FOR UPDATE;
 IF TG_OP='UPDATE' THEN
   IF NEW.id IS DISTINCT FROM OLD.id OR NEW.recipe_version_id IS DISTINCT FROM OLD.recipe_version_id THEN
     RAISE EXCEPTION 'Lotregelidentiteit en versie zijn onveranderlijk' USING ERRCODE='55000';
   END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF TG_TABLE_NAME='recipe_compatibility_rule' THEN
   SELECT r.product_id INTO p FROM master_recipe_version x JOIN master_recipe r ON r.id=x.master_recipe_id WHERE x.id=v;
   SELECT r.product_id INTO other_p FROM master_recipe_version x JOIN master_recipe r ON r.id=x.master_recipe_id WHERE x.id=NEW.other_recipe_version_id;
   IF p IS NULL OR other_p IS NULL OR p IS DISTINCT FROM other_p THEN
     RAISE EXCEPTION 'Incompatibiliteitsregel vereist twee receptversies van hetzelfde product' USING ERRCODE='23514';
   END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE TRIGGER recipe_lot_rule_guard BEFORE INSERT OR UPDATE OR DELETE ON recipe_lot_rule
 FOR EACH ROW EXECUTE FUNCTION recipe_lot_guard();
CREATE TRIGGER recipe_compatibility_rule_guard BEFORE INSERT OR UPDATE OR DELETE ON recipe_compatibility_rule
 FOR EACH ROW EXECUTE FUNCTION recipe_lot_guard();
CREATE TRIGGER recipe_lot_rule_audit AFTER INSERT OR UPDATE OR DELETE ON recipe_lot_rule
 FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();
CREATE TRIGGER recipe_compatibility_rule_audit AFTER INSERT OR UPDATE OR DELETE ON recipe_compatibility_rule
 FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();

REVOKE ALL ON FUNCTION recipe_lot_guard() FROM PUBLIC;
REVOKE ALL ON recipe_lot_rule,recipe_compatibility_rule FROM PUBLIC;

-- Geen lotcreatie, dispatch, goedkeuringshandeling of wijziging van
-- historische loten. Vrijgavepoort en persoonlijke conceptmutaties volgen.
-- Verschillende nominale normen bij gemengde revisies vereisen later
-- expliciete keuze en vastlegging in het lot-Control Recipe; geen
-- impliciete keuze voor de eerste, laatste of grootste norm.

COMMIT;

BEGIN;
-- Migratie 0108: persoonlijk, productgebonden parameter- en formulebeheer (#111/#141).
SET search_path = fabriek, public;

-- Alle conceptmutaties gebruiken dezelfde lock, actuele bevoegdheid en
-- verwachte change_no als procedure en header. Geen dynamische SQL.
CREATE OR REPLACE FUNCTION recipe_draft_actor(p_product uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid;
BEGIN
 actor:=execution_transaction_actor();
 IF p_product IS NULL OR authorization_permits(actor,'recipe.draft.manage',NULL,p_product,NULL) IS NOT TRUE THEN
   RAISE EXCEPTION 'Geen actuele MES-receptbevoegdheid' USING ERRCODE='42501';
 END IF;
 RETURN actor;
END $$;

CREATE FUNCTION recipe_content_list(p_version uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE product uuid; result jsonb;
BEGIN
 SELECT r.product_id INTO product FROM master_recipe_version v
 JOIN master_recipe r ON r.id=v.master_recipe_id WHERE v.id=p_version;
 PERFORM recipe_draft_actor(product);
 SELECT jsonb_build_object('change_no',v.change_no,
   'parameters',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_parameter x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
   'parameter_limits',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_parameter_limit x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
   'formulas',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_formula x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
   'material_requirements',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_material_requirement x WHERE x.recipe_version_id=v.id),'[]'::jsonb)
 ) INTO result FROM master_recipe_version v WHERE v.id=p_version;
 RETURN result;
END $$;

CREATE FUNCTION recipe_save_parameter(p_version uuid,p_expected integer,p_id uuid,p_procedural_element_id uuid,p_code text,p_name text,p_data_type text,p_unit text,p_frequency text,p_required boolean,p_responsible_activity text,p_critical boolean,p_measurement_unit_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer; target uuid;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 IF p_id IS NULL THEN
   INSERT INTO recipe_parameter(recipe_version_id,procedural_element_id,code,name,data_type,unit,frequency,required,responsible_activity,critical,measurement_unit_id)
   VALUES(p_version,p_procedural_element_id,p_code,p_name,p_data_type,p_unit,p_frequency,p_required,p_responsible_activity,p_critical,p_measurement_unit_id) RETURNING id INTO target;
 ELSE
   UPDATE recipe_parameter SET procedural_element_id=p_procedural_element_id,code=p_code,name=p_name,data_type=p_data_type,unit=p_unit,frequency=p_frequency,required=p_required,responsible_activity=p_responsible_activity,critical=p_critical,measurement_unit_id=p_measurement_unit_id
   WHERE recipe_version_id=p_version AND id=p_id RETURNING id INTO target;
   IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende receptinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN jsonb_build_object('id',target,'change_no',current_no+1);
END $$;

CREATE FUNCTION recipe_delete_parameter(p_version uuid,p_expected integer,p_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 DELETE FROM recipe_parameter WHERE recipe_version_id=p_version AND id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende receptinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN current_no+1;
END $$;

CREATE FUNCTION recipe_save_parameter_limit(p_version uuid,p_expected integer,p_id uuid,p_parameter_id uuid,p_data_type text,p_category text,p_target_value numeric,p_lower_value numeric,p_upper_value numeric,p_scaling text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer; target uuid;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 IF p_id IS NULL THEN
   INSERT INTO recipe_parameter_limit(recipe_version_id,parameter_id,data_type,category,target_value,lower_value,upper_value,scaling)
   VALUES(p_version,p_parameter_id,p_data_type,p_category,p_target_value,p_lower_value,p_upper_value,p_scaling) RETURNING id INTO target;
 ELSE
   UPDATE recipe_parameter_limit SET parameter_id=p_parameter_id,data_type=p_data_type,category=p_category,target_value=p_target_value,lower_value=p_lower_value,upper_value=p_upper_value,scaling=p_scaling
   WHERE recipe_version_id=p_version AND id=p_id RETURNING id INTO target;
   IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende receptinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN jsonb_build_object('id',target,'change_no',current_no+1);
END $$;

CREATE FUNCTION recipe_delete_parameter_limit(p_version uuid,p_expected integer,p_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 DELETE FROM recipe_parameter_limit WHERE recipe_version_id=p_version AND id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende receptinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN current_no+1;
END $$;

CREATE FUNCTION recipe_save_formula(p_version uuid,p_expected integer,p_id uuid,p_reference_quantity numeric,p_reference_unit text,p_reference_unit_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer; target uuid;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 IF p_id IS NULL THEN
   INSERT INTO recipe_formula(recipe_version_id,reference_quantity,reference_unit,reference_unit_id)
   VALUES(p_version,p_reference_quantity,p_reference_unit,p_reference_unit_id) RETURNING id INTO target;
 ELSE
   UPDATE recipe_formula SET reference_quantity=p_reference_quantity,reference_unit=p_reference_unit,reference_unit_id=p_reference_unit_id
   WHERE recipe_version_id=p_version AND id=p_id RETURNING id INTO target;
   IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende receptinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN jsonb_build_object('id',target,'change_no',current_no+1);
END $$;

CREATE FUNCTION recipe_delete_formula(p_version uuid,p_expected integer,p_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 DELETE FROM recipe_formula WHERE recipe_version_id=p_version AND id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende receptinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN current_no+1;
END $$;

CREATE FUNCTION recipe_save_material_requirement(p_version uuid,p_expected integer,p_id uuid,p_formula_id uuid,p_procedural_element_id uuid,p_material_version_id uuid,p_code text,p_direction text,p_quantity numeric,p_unit text,p_scaling text,p_measurement_unit_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer; target uuid;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 IF p_id IS NULL THEN
   INSERT INTO recipe_material_requirement(recipe_version_id,formula_id,procedural_element_id,material_version_id,code,direction,quantity,unit,scaling,measurement_unit_id)
   VALUES(p_version,p_formula_id,p_procedural_element_id,p_material_version_id,p_code,p_direction,p_quantity,p_unit,p_scaling,p_measurement_unit_id) RETURNING id INTO target;
 ELSE
   UPDATE recipe_material_requirement SET formula_id=p_formula_id,procedural_element_id=p_procedural_element_id,material_version_id=p_material_version_id,code=p_code,direction=p_direction,quantity=p_quantity,unit=p_unit,scaling=p_scaling,measurement_unit_id=p_measurement_unit_id
   WHERE recipe_version_id=p_version AND id=p_id RETURNING id INTO target;
   IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende receptinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN jsonb_build_object('id',target,'change_no',current_no+1);
END $$;

CREATE FUNCTION recipe_delete_material_requirement(p_version uuid,p_expected integer,p_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 DELETE FROM recipe_material_requirement WHERE recipe_version_id=p_version AND id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende receptinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN current_no+1;
END $$;

REVOKE ALL ON FUNCTION recipe_content_list(uuid),
 recipe_save_parameter(uuid,integer,uuid,uuid,text,text,text,text,text,boolean,text,boolean,uuid),
 recipe_delete_parameter(uuid,integer,uuid),
 recipe_save_parameter_limit(uuid,integer,uuid,uuid,text,text,numeric,numeric,numeric,text),
 recipe_delete_parameter_limit(uuid,integer,uuid),
 recipe_save_formula(uuid,integer,uuid,numeric,text,uuid),
 recipe_delete_formula(uuid,integer,uuid),
 recipe_save_material_requirement(uuid,integer,uuid,uuid,uuid,uuid,text,text,numeric,text,text,uuid),
 recipe_delete_material_requirement(uuid,integer,uuid) FROM PUBLIC;

COMMIT;

BEGIN;
-- Migratie 0109: persoonlijk conceptbeheer van receptvereisten en lotregels (#111).
SET search_path = fabriek, public;

CREATE FUNCTION recipe_requirements_list(p_version uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE product uuid; result jsonb;
BEGIN
 SELECT r.product_id INTO product FROM master_recipe_version v
 JOIN master_recipe r ON r.id=v.master_recipe_id WHERE v.id=p_version;
 PERFORM recipe_draft_actor(product);
 SELECT jsonb_build_object('change_no',v.change_no,
   'equipment_requirements',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_equipment_requirement x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
   'personnel_requirements',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_personnel_requirement x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
   'instructions',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_instruction x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
   'specification_links',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_specification_link x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
   'lot_rules',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_lot_rule x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
   'compatibility_rules',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_compatibility_rule x WHERE x.recipe_version_id=v.id),'[]'::jsonb)
 ) INTO result FROM master_recipe_version v WHERE v.id=p_version;
 RETURN result;
END $$;

CREATE FUNCTION recipe_save_equipment_requirement(p_version uuid,p_expected integer,p_id uuid,p_procedural_element_id uuid,p_code text,p_equipment_class_code text,p_description text,p_required_count integer,p_minimum_capacity numeric,p_capacity_unit_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer; target uuid;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 IF p_id IS NULL THEN
   INSERT INTO recipe_equipment_requirement(recipe_version_id,procedural_element_id,code,equipment_class_code,description,required_count,minimum_capacity,capacity_unit_id)
   VALUES(p_version,p_procedural_element_id,p_code,p_equipment_class_code,p_description,p_required_count,p_minimum_capacity,p_capacity_unit_id) RETURNING id INTO target;
 ELSE
   UPDATE recipe_equipment_requirement SET procedural_element_id=p_procedural_element_id,code=p_code,equipment_class_code=p_equipment_class_code,description=p_description,required_count=p_required_count,minimum_capacity=p_minimum_capacity,capacity_unit_id=p_capacity_unit_id
   WHERE recipe_version_id=p_version AND id=p_id RETURNING id INTO target;
   IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende receptinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN jsonb_build_object('id',target,'change_no',current_no+1);
END $$;

CREATE FUNCTION recipe_delete_equipment_requirement(p_version uuid,p_expected integer,p_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 DELETE FROM recipe_equipment_requirement WHERE recipe_version_id=p_version AND id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende receptinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN current_no+1;
END $$;

CREATE FUNCTION recipe_save_personnel_requirement(p_version uuid,p_expected integer,p_id uuid,p_procedural_element_id uuid,p_code text,p_qualification_code text,p_required_count integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer; target uuid; q_description text;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 SELECT description INTO q_description FROM qualification WHERE code=p_qualification_code FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende kwalificatie' USING ERRCODE='23503'; END IF;
 IF p_id IS NULL THEN
   INSERT INTO recipe_personnel_requirement(recipe_version_id,procedural_element_id,code,qualification_code,required_count,qualification_description)
   VALUES(p_version,p_procedural_element_id,p_code,p_qualification_code,p_required_count,q_description) RETURNING id INTO target;
 ELSE
   UPDATE recipe_personnel_requirement SET procedural_element_id=p_procedural_element_id,code=p_code,qualification_code=p_qualification_code,required_count=p_required_count,qualification_description=q_description
   WHERE recipe_version_id=p_version AND id=p_id RETURNING id INTO target;
   IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende receptinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN jsonb_build_object('id',target,'change_no',current_no+1);
END $$;

CREATE FUNCTION recipe_delete_personnel_requirement(p_version uuid,p_expected integer,p_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 DELETE FROM recipe_personnel_requirement WHERE recipe_version_id=p_version AND id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende receptinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN current_no+1;
END $$;

CREATE FUNCTION recipe_save_instruction(p_version uuid,p_expected integer,p_id uuid,p_procedural_element_id uuid,p_code text,p_position integer,p_instruction_text text,p_confirmation_required boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer; target uuid;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 IF p_id IS NULL THEN
   INSERT INTO recipe_instruction(recipe_version_id,procedural_element_id,code,position,instruction_text,confirmation_required)
   VALUES(p_version,p_procedural_element_id,p_code,p_position,p_instruction_text,p_confirmation_required) RETURNING id INTO target;
 ELSE
   UPDATE recipe_instruction SET procedural_element_id=p_procedural_element_id,code=p_code,position=p_position,instruction_text=p_instruction_text,confirmation_required=p_confirmation_required
   WHERE recipe_version_id=p_version AND id=p_id RETURNING id INTO target;
   IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende receptinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN jsonb_build_object('id',target,'change_no',current_no+1);
END $$;

CREATE FUNCTION recipe_delete_instruction(p_version uuid,p_expected integer,p_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 DELETE FROM recipe_instruction WHERE recipe_version_id=p_version AND id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende receptinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN current_no+1;
END $$;

CREATE FUNCTION recipe_save_specification_link(p_version uuid,p_expected integer,p_id uuid,p_parameter_limit_id uuid,p_code text,p_description text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer; target uuid;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 IF p_id IS NULL THEN
   INSERT INTO recipe_specification_link(recipe_version_id,parameter_limit_id,code,description)
   VALUES(p_version,p_parameter_limit_id,p_code,p_description) RETURNING id INTO target;
 ELSE
   UPDATE recipe_specification_link SET parameter_limit_id=p_parameter_limit_id,code=p_code,description=p_description
   WHERE recipe_version_id=p_version AND id=p_id RETURNING id INTO target;
   IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende receptinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN jsonb_build_object('id',target,'change_no',current_no+1);
END $$;

CREATE FUNCTION recipe_delete_specification_link(p_version uuid,p_expected integer,p_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 DELETE FROM recipe_specification_link WHERE recipe_version_id=p_version AND id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende receptinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN current_no+1;
END $$;

CREATE FUNCTION recipe_save_lot_rule(p_version uuid,p_expected integer,p_id uuid,p_nominal_batch_count integer,p_deviation_approval_required boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer; target uuid;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 IF p_id IS NULL THEN
   INSERT INTO recipe_lot_rule(recipe_version_id,nominal_batch_count,deviation_approval_required)
   VALUES(p_version,p_nominal_batch_count,p_deviation_approval_required) RETURNING id INTO target;
 ELSE
   UPDATE recipe_lot_rule SET nominal_batch_count=p_nominal_batch_count,deviation_approval_required=p_deviation_approval_required
   WHERE recipe_version_id=p_version AND id=p_id RETURNING id INTO target;
   IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende receptinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN jsonb_build_object('id',target,'change_no',current_no+1);
END $$;

CREATE FUNCTION recipe_delete_lot_rule(p_version uuid,p_expected integer,p_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 DELETE FROM recipe_lot_rule WHERE recipe_version_id=p_version AND id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende receptinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN current_no+1;
END $$;

CREATE FUNCTION recipe_save_compatibility_rule(p_version uuid,p_expected integer,p_id uuid,p_other_recipe_version_id uuid,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer; target uuid;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 IF p_id IS NULL THEN
   INSERT INTO recipe_compatibility_rule(recipe_version_id,other_recipe_version_id,reason)
   VALUES(p_version,p_other_recipe_version_id,p_reason) RETURNING id INTO target;
 ELSE
   UPDATE recipe_compatibility_rule SET other_recipe_version_id=p_other_recipe_version_id,reason=p_reason
   WHERE recipe_version_id=p_version AND id=p_id RETURNING id INTO target;
   IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende receptinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN jsonb_build_object('id',target,'change_no',current_no+1);
END $$;

CREATE FUNCTION recipe_delete_compatibility_rule(p_version uuid,p_expected integer,p_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 DELETE FROM recipe_compatibility_rule WHERE recipe_version_id=p_version AND id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende receptinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN current_no+1;
END $$;

REVOKE ALL ON FUNCTION recipe_requirements_list(uuid),
 recipe_save_equipment_requirement(uuid,integer,uuid,uuid,text,text,text,integer,numeric,uuid),
 recipe_delete_equipment_requirement(uuid,integer,uuid),
 recipe_save_personnel_requirement(uuid,integer,uuid,uuid,text,text,integer),
 recipe_delete_personnel_requirement(uuid,integer,uuid),
 recipe_save_instruction(uuid,integer,uuid,uuid,text,integer,text,boolean),
 recipe_delete_instruction(uuid,integer,uuid),
 recipe_save_specification_link(uuid,integer,uuid,uuid,text,text),
 recipe_delete_specification_link(uuid,integer,uuid),
 recipe_save_lot_rule(uuid,integer,uuid,integer,boolean),
 recipe_delete_lot_rule(uuid,integer,uuid),
 recipe_save_compatibility_rule(uuid,integer,uuid,uuid,text),
 recipe_delete_compatibility_rule(uuid,integer,uuid) FROM PUBLIC;

-- Migratie 0110: persoonlijk beheer van de gedeelde eenhedencatalogus (D106/#141).
SET search_path = fabriek, public;

-- Gedeelde catalogus: hergebruik de bestaande globale materiaalbeheerbevoegdheid.
-- Productspecifieke grants geven geen schrijfrecht op gedeelde definities.
-- Geen impliciete conversie, vrijgave of rekenengine; bestaande records blijven onveranderlijk.

CREATE FUNCTION unit_catalog_list() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $
BEGIN
 PERFORM material_manage_actor();
 RETURN jsonb_build_object(
 'dimensions',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM quantity_dimension x),'[]'::jsonb),
 'quantity_kinds',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.code) FROM quantity_kind x),'[]'::jsonb),
 'units',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.code) FROM measurement_unit x),'[]'::jsonb),
 'conversions',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM unit_conversion x),'[]'::jsonb),
 'versions',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.conversion_id,x.revision) FROM unit_conversion_version x),'[]'::jsonb));
END $;

CREATE FUNCTION unit_catalog_create_dimension(p_length smallint,p_mass smallint,p_time smallint,p_current smallint,p_temperature smallint,p_amount smallint,p_luminous smallint) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $
DECLARE target uuid;
BEGIN
 PERFORM material_manage_actor();
 INSERT INTO quantity_dimension(length_exp,mass_exp,time_exp,current_exp,temperature_exp,amount_exp,luminous_exp)
 VALUES(p_length,p_mass,p_time,p_current,p_temperature,p_amount,p_luminous) RETURNING id INTO target;
 RETURN target;
END $;

CREATE FUNCTION unit_catalog_create_kind(p_dimension uuid,p_code text,p_name text,p_semantics text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $
DECLARE target uuid;
BEGIN
 PERFORM material_manage_actor();
 INSERT INTO quantity_kind(dimension_id,code,name,value_semantics) VALUES(p_dimension,p_code,p_name,p_semantics) RETURNING id INTO target;
 RETURN target;
END $;

CREATE FUNCTION unit_catalog_create_unit(p_kind uuid,p_code text,p_symbol text,p_name text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $
DECLARE target uuid;
BEGIN
 PERFORM material_manage_actor();
 INSERT INTO measurement_unit(quantity_kind_id,code,symbol,name) VALUES(p_kind,p_code,p_symbol,p_name) RETURNING id INTO target;
 RETURN target;
END $;

CREATE FUNCTION unit_catalog_create_conversion(p_from uuid,p_to uuid,p_numerator numeric,p_denominator numeric,p_offset numeric,p_source text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $
DECLARE actor uuid; target uuid; kind uuid; semantics text;
BEGIN
 actor:=material_manage_actor();
 SELECT u.quantity_kind_id,k.value_semantics INTO kind,semantics FROM measurement_unit u JOIN quantity_kind k ON k.id=u.quantity_kind_id WHERE u.id=p_from;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende broneenheid' USING ERRCODE='23503'; END IF;
 INSERT INTO unit_conversion(quantity_kind_id,from_unit_id,to_unit_id) VALUES(kind,p_from,p_to) RETURNING id INTO target;
 INSERT INTO unit_conversion_version(conversion_id,quantity_kind_id,value_semantics,revision,factor_numerator,factor_denominator,additive_offset,source_reference,created_by)
 VALUES(target,kind,semantics,1,p_numerator,p_denominator,p_offset,p_source,actor);
 RETURN target;
END $;

CREATE FUNCTION unit_catalog_append_conversion(p_conversion uuid,p_expected integer,p_numerator numeric,p_denominator numeric,p_offset numeric,p_source text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $
DECLARE actor uuid; target uuid; kind uuid; semantics text; current_revision integer;
BEGIN
 actor:=material_manage_actor();
 SELECT c.quantity_kind_id,k.value_semantics INTO kind,semantics FROM unit_conversion c JOIN quantity_kind k ON k.id=c.quantity_kind_id WHERE c.id=p_conversion FOR UPDATE OF c;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende conversie' USING ERRCODE='23503'; END IF;
 SELECT max(revision) INTO current_revision FROM unit_conversion_version WHERE conversion_id=p_conversion;
 IF current_revision IS NULL OR current_revision IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Conversierevisie is gewijzigd' USING ERRCODE='40001'; END IF;
 INSERT INTO unit_conversion_version(conversion_id,quantity_kind_id,value_semantics,revision,factor_numerator,factor_denominator,additive_offset,source_reference,created_by)
 VALUES(p_conversion,kind,semantics,current_revision+1,p_numerator,p_denominator,p_offset,p_source,actor) RETURNING id INTO target;
 RETURN target;
END $;

REVOKE ALL ON FUNCTION unit_catalog_list(),
 unit_catalog_create_dimension(smallint,smallint,smallint,smallint,smallint,smallint,smallint),
 unit_catalog_create_kind(uuid,text,text,text),
 unit_catalog_create_unit(uuid,text,text,text),
 unit_catalog_create_conversion(uuid,uuid,numeric,numeric,numeric,text),
 unit_catalog_append_conversion(uuid,integer,numeric,numeric,numeric,text) FROM PUBLIC;

-- Migratie 0111: persoonlijk conceptbeheer van schaalregels (D106/#141).
SET search_path = fabriek, public;

-- Geen evaluatie of formule-engine. Alle wijzigingen vallen onder dezelfde
-- productscope, conceptlock en teller als de andere MBR-onderdelen.
CREATE FUNCTION recipe_scaling_list(p_version uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE product uuid; result jsonb;
BEGIN
 SELECT r.product_id INTO product FROM master_recipe_version v
 JOIN master_recipe r ON r.id=v.master_recipe_id WHERE v.id=p_version;
 PERFORM recipe_draft_actor(product);
 SELECT jsonb_build_object('change_no',v.change_no,
   'rules',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_scaling_rule x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
   'inputs',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_scaling_input x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
   'bindings',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_scaling_binding x WHERE x.recipe_version_id=v.id),'[]'::jsonb))
 INTO result FROM master_recipe_version v WHERE v.id=p_version;
 RETURN result;
END $$;

CREATE FUNCTION recipe_save_scaling_rule(p_version uuid,p_expected integer,p_id uuid,p_code text,p_description text,p_rule_kind text,p_output_unit_id uuid,p_source_reference text,p_applicability text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer; target uuid;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 IF p_id IS NULL THEN
   INSERT INTO recipe_scaling_rule(recipe_version_id,code,description,rule_kind,output_unit_id,source_reference,applicability)
   VALUES(p_version,p_code,p_description,p_rule_kind,p_output_unit_id,p_source_reference,p_applicability) RETURNING id INTO target;
 ELSE
   UPDATE recipe_scaling_rule SET code=p_code,description=p_description,rule_kind=p_rule_kind,output_unit_id=p_output_unit_id,source_reference=p_source_reference,applicability=p_applicability
   WHERE recipe_version_id=p_version AND id=p_id RETURNING id INTO target;
   IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende schaalregelinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN jsonb_build_object('id',target,'change_no',current_no+1);
END $$;

CREATE FUNCTION recipe_delete_scaling_rule(p_version uuid,p_expected integer,p_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 DELETE FROM recipe_scaling_rule WHERE recipe_version_id=p_version AND id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende schaalregelinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN current_no+1;
END $$;

CREATE FUNCTION recipe_save_scaling_input(p_version uuid,p_expected integer,p_id uuid,p_rule_id uuid,p_code text,p_source_kind text,p_parameter_id uuid,p_equipment_property text,p_constant_value numeric,p_unit_id uuid,p_conversion_version_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer; target uuid;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 IF p_id IS NULL THEN
   INSERT INTO recipe_scaling_input(recipe_version_id,rule_id,code,source_kind,parameter_id,equipment_property,constant_value,unit_id,conversion_version_id)
   VALUES(p_version,p_rule_id,p_code,p_source_kind,p_parameter_id,p_equipment_property,p_constant_value,p_unit_id,p_conversion_version_id) RETURNING id INTO target;
 ELSE
   UPDATE recipe_scaling_input SET rule_id=p_rule_id,code=p_code,source_kind=p_source_kind,parameter_id=p_parameter_id,equipment_property=p_equipment_property,constant_value=p_constant_value,unit_id=p_unit_id,conversion_version_id=p_conversion_version_id
   WHERE recipe_version_id=p_version AND id=p_id RETURNING id INTO target;
   IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende schaalregelinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN jsonb_build_object('id',target,'change_no',current_no+1);
END $$;

CREATE FUNCTION recipe_delete_scaling_input(p_version uuid,p_expected integer,p_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 DELETE FROM recipe_scaling_input WHERE recipe_version_id=p_version AND id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende schaalregelinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN current_no+1;
END $$;

CREATE FUNCTION recipe_save_scaling_binding(p_version uuid,p_expected integer,p_id uuid,p_rule_id uuid,p_parameter_limit_id uuid,p_material_requirement_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer; target uuid;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 IF p_id IS NULL THEN
   INSERT INTO recipe_scaling_binding(recipe_version_id,rule_id,parameter_limit_id,material_requirement_id)
   VALUES(p_version,p_rule_id,p_parameter_limit_id,p_material_requirement_id) RETURNING id INTO target;
 ELSE
   UPDATE recipe_scaling_binding SET rule_id=p_rule_id,parameter_limit_id=p_parameter_limit_id,material_requirement_id=p_material_requirement_id
   WHERE recipe_version_id=p_version AND id=p_id RETURNING id INTO target;
   IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende schaalregelinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN jsonb_build_object('id',target,'change_no',current_no+1);
END $$;

CREATE FUNCTION recipe_delete_scaling_binding(p_version uuid,p_expected integer,p_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 DELETE FROM recipe_scaling_binding WHERE recipe_version_id=p_version AND id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende schaalregelinhoud binnen deze versie' USING ERRCODE='23503'; END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN current_no+1;
END $$;

REVOKE ALL ON FUNCTION recipe_scaling_list(uuid),
 recipe_save_scaling_rule(uuid,integer,uuid,text,text,text,uuid,text,text),
 recipe_delete_scaling_rule(uuid,integer,uuid),
 recipe_save_scaling_input(uuid,integer,uuid,uuid,text,text,uuid,text,numeric,uuid,uuid),
 recipe_delete_scaling_input(uuid,integer,uuid),
 recipe_save_scaling_binding(uuid,integer,uuid,uuid,uuid,uuid),
 recipe_delete_scaling_binding(uuid,integer,uuid) FROM PUBLIC;

-- Migratie 0112: begrensde getypeerde schaalformuledefinities (D106/#141).
SET search_path = fabriek, public;

-- Postfix-notatie (RPN), grammatica v1. Alleen invoer-ID's en vaste
-- operatorcodes, nooit uitvoerbare tekst. Geen evaluatie in fase 2.
CREATE TABLE recipe_scaling_expression (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 recipe_version_id uuid NOT NULL,
 rule_id uuid NOT NULL,
 grammar_version integer NOT NULL DEFAULT 1 CHECK (grammar_version=1),
 tokens jsonb NOT NULL,
 UNIQUE(recipe_version_id,rule_id),
 FOREIGN KEY(recipe_version_id,rule_id) REFERENCES recipe_scaling_rule(recipe_version_id,id)
);

CREATE FUNCTION recipe_scaling_expression_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE token jsonb; op text; input_id uuid; depth integer:=0; v uuid;
BEGIN
 v:=CASE WHEN TG_OP='DELETE' THEN OLD.recipe_version_id ELSE NEW.recipe_version_id END;
 PERFORM 1 FROM master_recipe_version WHERE id=v FOR UPDATE;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF TG_OP='UPDATE' AND (NEW.id,NEW.recipe_version_id,NEW.rule_id) IS DISTINCT FROM (OLD.id,OLD.recipe_version_id,OLD.rule_id) THEN
   RAISE EXCEPTION 'Formule-identiteit is onveranderlijk' USING ERRCODE='55000';
 END IF;
 IF jsonb_typeof(NEW.tokens) IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'Schaalformule vereist een tokenlijst' USING ERRCODE='23514';
 END IF;
 IF jsonb_array_length(NEW.tokens) NOT BETWEEN 1 AND 128 THEN
   RAISE EXCEPTION 'Schaalformule vereist 1 tot 128 tokens' USING ERRCODE='23514';
 END IF;
 FOR token IN SELECT value FROM jsonb_array_elements(NEW.tokens) LOOP
   IF jsonb_typeof(token) IS DISTINCT FROM 'object' THEN
     RAISE EXCEPTION 'Ongeldig schaalformuletoken' USING ERRCODE='23514';
   END IF;
   op:=token->>'op';
   IF op='input' AND jsonb_typeof(token->'id')='string' AND token= jsonb_build_object('op','input','id',token->>'id') THEN
     BEGIN
       input_id:=(token->>'id')::uuid;
     EXCEPTION WHEN invalid_text_representation THEN
       RAISE EXCEPTION 'Ongeldige schaalinvoer-ID' USING ERRCODE='23514';
     END;
     IF NOT EXISTS (SELECT 1 FROM recipe_scaling_input i WHERE i.id=input_id AND i.recipe_version_id=v AND i.rule_id=NEW.rule_id) THEN
       RAISE EXCEPTION 'Schaalformule vereist invoer uit dezelfde regel' USING ERRCODE='23514';
     END IF;
     depth:=depth+1;
   ELSIF op IN ('add','subtract','multiply','divide','power') AND token=jsonb_build_object('op',op) THEN
     IF depth<2 THEN RAISE EXCEPTION 'Onvoldoende operanden in schaalformule' USING ERRCODE='23514'; END IF;
     depth:=depth-1;
   ELSE
     RAISE EXCEPTION 'Onbekend of ongeldig schaalformuletoken' USING ERRCODE='23514';
   END IF;
 END LOOP;
 IF depth<>1 THEN RAISE EXCEPTION 'Schaalformule vereist precies één resultaat' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recipe_scaling_expression_guard BEFORE INSERT OR UPDATE OR DELETE ON recipe_scaling_expression
 FOR EACH ROW EXECUTE FUNCTION recipe_scaling_expression_guard();
CREATE TRIGGER recipe_scaling_expression_audit AFTER INSERT OR UPDATE OR DELETE ON recipe_scaling_expression
 FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();

-- Voorkom stille herinterpretatie van bestaande formules. Verwijder
-- eerst de formule voordat invoer of uitvoereenheid wordt gewijzigd.
CREATE FUNCTION recipe_scaling_expression_dependency_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
 IF TG_TABLE_NAME='recipe_scaling_input' THEN
   PERFORM 1 FROM master_recipe_version WHERE id=OLD.recipe_version_id FOR UPDATE;
   IF EXISTS (SELECT 1 FROM recipe_scaling_expression e WHERE e.recipe_version_id=OLD.recipe_version_id AND e.rule_id=OLD.rule_id) THEN
     RAISE EXCEPTION 'Verwijder eerst de schaalformule bij wijziging van invoer' USING ERRCODE='23514';
   END IF;
 ELSE
   IF NEW.output_unit_id IS DISTINCT FROM OLD.output_unit_id AND EXISTS
     (SELECT 1 FROM recipe_scaling_expression e WHERE e.recipe_version_id=OLD.recipe_version_id AND e.rule_id=OLD.id) THEN
     RAISE EXCEPTION 'Verwijder eerst de schaalformule bij wijziging van uitvoereenheid' USING ERRCODE='23514';
   END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recipe_scaling_expression_input_guard BEFORE UPDATE OR DELETE ON recipe_scaling_input
 FOR EACH ROW EXECUTE FUNCTION recipe_scaling_expression_dependency_guard();
CREATE TRIGGER recipe_scaling_expression_output_guard BEFORE UPDATE ON recipe_scaling_rule
 FOR EACH ROW EXECUTE FUNCTION recipe_scaling_expression_dependency_guard();

CREATE FUNCTION recipe_save_scaling_expression(p_version uuid,p_expected integer,p_rule uuid,p_tokens jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer; target uuid;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 INSERT INTO recipe_scaling_expression(recipe_version_id,rule_id,tokens)
 VALUES(p_version,p_rule,p_tokens)
 ON CONFLICT(recipe_version_id,rule_id) DO UPDATE SET tokens=EXCLUDED.tokens RETURNING id INTO target;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN jsonb_build_object('id',target,'change_no',current_no+1);
END $$;
CREATE FUNCTION recipe_delete_scaling_expression(p_version uuid,p_expected integer,p_rule uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE current_no integer;
BEGIN
 current_no:=recipe_lock_draft(p_version,p_expected);
 DELETE FROM recipe_scaling_expression WHERE recipe_version_id=p_version AND rule_id=p_rule;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende schaalformule binnen deze versie' USING ERRCODE='23503'; END IF;
 UPDATE master_recipe_version SET change_no=current_no+1 WHERE id=p_version;
 RETURN current_no+1;
END $$;
CREATE OR REPLACE FUNCTION recipe_scaling_list(p_version uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE product uuid; result jsonb;
BEGIN
 SELECT r.product_id INTO product FROM master_recipe_version v
 JOIN master_recipe r ON r.id=v.master_recipe_id WHERE v.id=p_version;
 PERFORM recipe_draft_actor(product);
 SELECT jsonb_build_object('change_no',v.change_no,
   'rules',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_scaling_rule x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
   'inputs',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_scaling_input x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
   'bindings',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_scaling_binding x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
   'expressions',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_scaling_expression x WHERE x.recipe_version_id=v.id),'[]'::jsonb))
 INTO result FROM master_recipe_version v WHERE v.id=p_version;
 RETURN result;
END $$;
REVOKE ALL ON recipe_scaling_expression FROM PUBLIC;
REVOKE ALL ON FUNCTION recipe_scaling_expression_guard(),recipe_scaling_expression_dependency_guard(),
 recipe_save_scaling_expression(uuid,integer,uuid,jsonb),recipe_delete_scaling_expression(uuid,integer,uuid),
 recipe_scaling_list(uuid) FROM PUBLIC;
-- Alleen structurele validatie. Dimensionele/semantische formulevalidatie
-- en expliciete vrijgaveblokkade voor complexe regels blijven verplicht.

-- Migratie 0113: statische fysische validatie van schaalformules (D106/#141).
SET search_path = fabriek, public;

-- Dimensies worden afgeleid, niet door de client aangeleverd. Exacte
-- eenheidsidentiteit blijft behouden voor add/subtract. Afgeleide
-- producten/quotiënten/machten zijn uitsluitend dimensioneel bewezen;
-- eenhedenfactoren en afgeleide grootheidsemantiek vergen een aparte
-- vrijgavepoort. Geen numerieke evaluatie of impliciete conversie.
CREATE FUNCTION recipe_scaling_expression_physical_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE
 token jsonb; op text; inp record; outp record;
 stack jsonb[]:=ARRAY[]::jsonb[]; n integer:=0;
 a jsonb; b jsonb; result jsonb; dims integer[]; exponent numeric;
 j integer; da integer; db integer;
BEGIN
 -- De eerdere structuurtrigger draait alfabetisch vóór deze trigger.
 FOR token IN SELECT value FROM jsonb_array_elements(NEW.tokens) LOOP
   op:=token->>'op';
   IF op='input' THEN
     SELECT u.id AS unit_id,u.symbol,k.value_semantics,
       ARRAY[d.length_exp,d.mass_exp,d.time_exp,d.current_exp,d.temperature_exp,d.amount_exp,d.luminous_exp]::integer[] AS dims,
       i.source_kind,i.constant_value
     INTO STRICT inp FROM recipe_scaling_input i
     JOIN measurement_unit u ON u.id=i.unit_id
     JOIN quantity_kind k ON k.id=u.quantity_kind_id
     JOIN quantity_dimension d ON d.id=k.dimension_id
     WHERE i.id=(token->>'id')::uuid AND i.recipe_version_id=NEW.recipe_version_id AND i.rule_id=NEW.rule_id;
     n:=n+1;
     stack[n]:=jsonb_build_object('dims',inp.dims,'unit',inp.unit_id,'semantics',inp.value_semantics,
       'exponent',CASE WHEN inp.source_kind='constant' AND inp.value_semantics='ratio'
         AND inp.dims=ARRAY[0,0,0,0,0,0,0] AND inp.symbol='1' THEN inp.constant_value END);
   ELSE
     a:=stack[n-1]; b:=stack[n]; dims:=ARRAY[]::integer[];
     IF a->>'semantics'='absolute' OR b->>'semantics'='absolute' THEN
       RAISE EXCEPTION 'Absolute grootheden vereisen expliciete rekenregels' USING ERRCODE='23514';
     END IF;
     IF op IN ('add','subtract') THEN
       IF a->'dims' IS DISTINCT FROM b->'dims' OR a->>'unit' IS NULL
          OR a->>'unit' IS DISTINCT FROM b->>'unit' OR a->>'semantics' IS DISTINCT FROM b->>'semantics' THEN
         RAISE EXCEPTION 'Optellen/aftrekken vereist dezelfde bewezen eenheid en grootheid' USING ERRCODE='23514';
       END IF;
       result:=a-'exponent';
     ELSE
       IF a->>'semantics' <> 'ratio' OR b->>'semantics' <> 'ratio' THEN
         RAISE EXCEPTION 'Product, quotient of macht vereist ratio-grootheden' USING ERRCODE='23514';
       END IF;
       IF op='power' THEN
         exponent:=(b->>'exponent')::numeric;
         IF exponent IS NULL OR exponent<>trunc(exponent) OR exponent NOT BETWEEN -16 AND 16 THEN
           RAISE EXCEPTION 'Macht vereist een expliciete dimensieloze gehele constante in eenheid 1 (-16..16)' USING ERRCODE='23514';
         END IF;
       END IF;
       FOR j IN 0..6 LOOP
         da:=(a->'dims'->>j)::integer; db:=(b->'dims'->>j)::integer;
         IF op='multiply' THEN dims:=array_append(dims,da+db);
         ELSIF op='divide' THEN dims:=array_append(dims,da-db);
         ELSIF op='power' THEN dims:=array_append(dims,da*exponent::integer);
         ELSE RAISE EXCEPTION 'Onbekende fysische operator' USING ERRCODE='23514';
         END IF;
         IF dims[j+1] NOT BETWEEN -32768 AND 32767 THEN
           RAISE EXCEPTION 'Afgeleide dimensie buiten catalogusbereik' USING ERRCODE='23514';
         END IF;
       END LOOP;
       result:=jsonb_build_object('dims',dims,'unit',NULL::uuid,'semantics','ratio');
     END IF;
     n:=n-1;
     stack[n]:=result;
   END IF;
 END LOOP;
 SELECT u.id AS unit_id,k.value_semantics,
   ARRAY[d.length_exp,d.mass_exp,d.time_exp,d.current_exp,d.temperature_exp,d.amount_exp,d.luminous_exp]::integer[] AS dims
 INTO STRICT outp FROM recipe_scaling_rule r
 JOIN measurement_unit u ON u.id=r.output_unit_id
 JOIN quantity_kind k ON k.id=u.quantity_kind_id
 JOIN quantity_dimension d ON d.id=k.dimension_id
 WHERE r.recipe_version_id=NEW.recipe_version_id AND r.id=NEW.rule_id;
 result:=stack[1];
 IF result->'dims' IS DISTINCT FROM to_jsonb(outp.dims)
   OR result->>'semantics' IS DISTINCT FROM outp.value_semantics
   OR (result->>'unit' IS NOT NULL AND (result->>'unit')::uuid IS DISTINCT FROM outp.unit_id) THEN
   RAISE EXCEPTION 'Schaalformule past niet bij dimensie, semantiek of exacte uitvoereenheid' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recipe_scaling_expression_physical_guard BEFORE INSERT OR UPDATE ON recipe_scaling_expression
 FOR EACH ROW EXECUTE FUNCTION recipe_scaling_expression_physical_guard();

-- Bestaande concepten worden niet stilzwijgend als fysisch gevalideerd beschouwd.
-- Vóór pilot is geen migratie van formuleconcepten voorzien; blokkeer
-- een niet-lege installatie voor gecontroleerde herbeoordeling.
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM recipe_scaling_expression) THEN
   RAISE EXCEPTION 'Bestaande schaalformules vereisen gecontroleerde herbeoordeling vóór 0113' USING ERRCODE='55000';
 END IF;
END $$;
REVOKE ALL ON FUNCTION recipe_scaling_expression_physical_guard() FROM PUBLIC;

-- Migratie 0114: expliciete eenheidsselectie voor materiaalversies en receptconcepten.
SET search_path = fabriek, public;

-- Geselecteerde catalogus-ID is leidend; symbool wordt serverzijde afgeleid.
-- Geen automatische tekstmapping of retroactieve wijziging van materiaalversies.
CREATE FUNCTION material_create_definition_with_unit(p_code text,p_name text,p_class uuid,p_unit_id uuid,p_product uuid,p_raw_material uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; target uuid; symbol_value text;
BEGIN
 actor:=material_manage_actor();
 SELECT symbol INTO symbol_value FROM measurement_unit WHERE id=p_unit_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende cataloguseenheid' USING ERRCODE='23503'; END IF;
 INSERT INTO material_definition(code,product_id,raw_material_id)
 VALUES(p_code,p_product,p_raw_material) RETURNING id INTO target;
 INSERT INTO material_definition_version(material_definition_id,revision,name,material_class_id,unit,measurement_unit_id,created_by)
 VALUES(target,1,p_name,p_class,symbol_value,p_unit_id,actor);
 RETURN target;
END $$;

CREATE FUNCTION material_append_version_with_unit(p_id uuid,p_expected_revision integer,p_name text,p_class uuid,p_unit_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; target uuid; current_revision integer; symbol_value text;
BEGIN
 actor:=material_manage_actor();
 PERFORM 1 FROM material_definition WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende materiaalidentiteit' USING ERRCODE='23503'; END IF;
 SELECT max(revision) INTO current_revision FROM material_definition_version WHERE material_definition_id=p_id;
 IF current_revision IS NULL OR current_revision IS DISTINCT FROM p_expected_revision THEN
   RAISE EXCEPTION 'Materiaalrevisie is gewijzigd' USING ERRCODE='40001';
 END IF;
 SELECT symbol INTO symbol_value FROM measurement_unit WHERE id=p_unit_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende cataloguseenheid' USING ERRCODE='23503'; END IF;
 INSERT INTO material_definition_version(material_definition_id,revision,name,material_class_id,unit,measurement_unit_id,created_by)
 VALUES(p_id,current_revision+1,p_name,p_class,symbol_value,p_unit_id,actor) RETURNING id INTO target;
 RETURN target;
END $$;

-- Catalogusdefinities zijn gedeeld. Productgebonden conceptbeheer mag
-- deze gegevens uitsluitend lezen; de bestaande globale schrijfrechten blijven.
CREATE FUNCTION recipe_unit_catalog_list(p_product uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
 PERFORM recipe_draft_actor(p_product);
 RETURN jsonb_build_object(
 'dimensions',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM quantity_dimension x),'[]'::jsonb),
 'quantity_kinds',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.code) FROM quantity_kind x),'[]'::jsonb),
 'units',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.code) FROM measurement_unit x),'[]'::jsonb),
 'conversions',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM unit_conversion x),'[]'::jsonb),
 'versions',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.conversion_id,x.revision) FROM unit_conversion_version x),'[]'::jsonb));
END $$;

-- Een eenmaal expliciet gekoppelde materiaalidentiteit mag via de oude
-- tekstinterface geen volgende ongekoppelde revisie krijgen.
CREATE OR REPLACE FUNCTION material_append_version(p_id uuid,p_expected_revision integer,p_name text,p_class uuid,p_unit text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; target uuid; current_revision integer;
BEGIN
 actor:=material_manage_actor();
 PERFORM 1 FROM material_definition WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende materiaalidentiteit'; END IF;
 SELECT max(revision) INTO current_revision FROM material_definition_version WHERE material_definition_id=p_id;
 IF current_revision IS NULL OR current_revision IS DISTINCT FROM p_expected_revision THEN
   RAISE EXCEPTION 'Materiaalrevisie is gewijzigd' USING ERRCODE='40001';
 END IF;
 IF EXISTS (SELECT 1 FROM material_definition_version WHERE material_definition_id=p_id AND measurement_unit_id IS NOT NULL) THEN
   RAISE EXCEPTION 'Expliciete cataloguseenheid vereist voor nieuwe materiaalrevisie' USING ERRCODE='23514';
 END IF;
 INSERT INTO material_definition_version(material_definition_id,revision,name,material_class_id,unit,created_by)
 VALUES(p_id,current_revision+1,p_name,p_class,p_unit,actor) RETURNING id INTO target;
 RETURN target;
END $$;

REVOKE ALL ON FUNCTION material_create_definition_with_unit(text,text,uuid,uuid,uuid,uuid),
 material_append_version_with_unit(uuid,integer,text,uuid,uuid),recipe_unit_catalog_list(uuid),
 material_append_version(uuid,integer,text,uuid,text) FROM PUBLIC;

-- Migratie 0115: MBR-levenscyclus en inhoudsbeveiliging (#112, D89).
SET search_path = fabriek, public;

-- Bestaande versies zijn uitsluitend concepten. Geen impliciete vrijgave.
-- Status staat apart van inhoud; wijzigingsteller blijft inhoudsteller.
ALTER TABLE master_recipe_version ADD COLUMN lifecycle_status text NOT NULL DEFAULT 'draft'
 CHECK (lifecycle_status IN ('draft','in_review','approved','released','superseded','withdrawn'));

CREATE FUNCTION recipe_lifecycle_header_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN
   IF NEW.lifecycle_status IS DISTINCT FROM 'draft' THEN
     RAISE EXCEPTION 'Nieuwe MBR-versie moet een concept zijn' USING ERRCODE='55000';
   END IF;
   RETURN NEW;
 END IF;
 -- 0115 opent bewust nog geen enkele statusovergang.
 -- De latere gecontroleerde MOC-migratie vervangt deze statuspoort.
 IF NEW.lifecycle_status IS DISTINCT FROM OLD.lifecycle_status THEN
   RAISE EXCEPTION 'MBR-statusovergang nog niet beschikbaar' USING ERRCODE='55000';
 END IF;
 IF OLD.lifecycle_status IS DISTINCT FROM 'draft' THEN
   RAISE EXCEPTION 'MBR-inhoud is alleen wijzigbaar in conceptstatus' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER master_recipe_version_lifecycle_guard BEFORE INSERT OR UPDATE ON master_recipe_version
 FOR EACH ROW EXECUTE FUNCTION recipe_lifecycle_header_guard();

CREATE OR REPLACE FUNCTION recipe_lock_draft(p_version uuid,p_expected integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE product uuid; current_no integer; state text;
BEGIN
 SELECT r.product_id INTO product FROM master_recipe_version v
 JOIN master_recipe r ON r.id=v.master_recipe_id WHERE v.id=p_version;
 PERFORM recipe_draft_actor(product);
 SELECT change_no,lifecycle_status INTO current_no,state FROM master_recipe_version WHERE id=p_version FOR UPDATE;
 IF current_no IS NULL OR current_no IS DISTINCT FROM p_expected THEN
   RAISE EXCEPTION 'MBR-concept is ondertussen gewijzigd' USING ERRCODE='40001';
 END IF;
 IF state IS DISTINCT FROM 'draft' THEN
   RAISE EXCEPTION 'MBR-inhoud is alleen wijzigbaar in conceptstatus' USING ERRCODE='55000';
 END IF;
 RETURN current_no;
END $$;

-- Onafhankelijke databaseguard voor alle huidige versiegebonden inhoud.
-- De lock is dezelfde als voor de header en de toekomstige MOC-overgang.
CREATE FUNCTION recipe_lifecycle_content_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v uuid; state text;
BEGIN
 v:=CASE WHEN TG_OP='DELETE' THEN OLD.recipe_version_id ELSE NEW.recipe_version_id END;
 IF TG_OP='UPDATE' AND NEW.recipe_version_id IS DISTINCT FROM OLD.recipe_version_id THEN
   RAISE EXCEPTION 'MBR-inhoud kan niet naar een andere versie worden verplaatst' USING ERRCODE='55000';
 END IF;
 SELECT lifecycle_status INTO state FROM master_recipe_version WHERE id=v FOR UPDATE;
 IF state IS DISTINCT FROM 'draft' THEN
   RAISE EXCEPTION 'MBR-inhoud is alleen wijzigbaar in conceptstatus' USING ERRCODE='55000';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recipe_procedural_element_00_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON recipe_procedural_element
 FOR EACH ROW EXECUTE FUNCTION recipe_lifecycle_content_guard();
CREATE TRIGGER recipe_dependency_00_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON recipe_dependency
 FOR EACH ROW EXECUTE FUNCTION recipe_lifecycle_content_guard();
CREATE TRIGGER recipe_parameter_00_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON recipe_parameter
 FOR EACH ROW EXECUTE FUNCTION recipe_lifecycle_content_guard();
CREATE TRIGGER recipe_parameter_limit_00_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON recipe_parameter_limit
 FOR EACH ROW EXECUTE FUNCTION recipe_lifecycle_content_guard();
CREATE TRIGGER recipe_formula_00_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON recipe_formula
 FOR EACH ROW EXECUTE FUNCTION recipe_lifecycle_content_guard();
CREATE TRIGGER recipe_material_requirement_00_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON recipe_material_requirement
 FOR EACH ROW EXECUTE FUNCTION recipe_lifecycle_content_guard();
CREATE TRIGGER recipe_equipment_requirement_00_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON recipe_equipment_requirement
 FOR EACH ROW EXECUTE FUNCTION recipe_lifecycle_content_guard();
CREATE TRIGGER recipe_personnel_requirement_00_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON recipe_personnel_requirement
 FOR EACH ROW EXECUTE FUNCTION recipe_lifecycle_content_guard();
CREATE TRIGGER recipe_instruction_00_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON recipe_instruction
 FOR EACH ROW EXECUTE FUNCTION recipe_lifecycle_content_guard();
CREATE TRIGGER recipe_specification_link_00_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON recipe_specification_link
 FOR EACH ROW EXECUTE FUNCTION recipe_lifecycle_content_guard();
CREATE TRIGGER recipe_lot_rule_00_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON recipe_lot_rule
 FOR EACH ROW EXECUTE FUNCTION recipe_lifecycle_content_guard();
CREATE TRIGGER recipe_compatibility_rule_00_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON recipe_compatibility_rule
 FOR EACH ROW EXECUTE FUNCTION recipe_lifecycle_content_guard();
CREATE TRIGGER recipe_scaling_rule_00_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON recipe_scaling_rule
 FOR EACH ROW EXECUTE FUNCTION recipe_lifecycle_content_guard();
CREATE TRIGGER recipe_scaling_input_00_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON recipe_scaling_input
 FOR EACH ROW EXECUTE FUNCTION recipe_lifecycle_content_guard();
CREATE TRIGGER recipe_scaling_binding_00_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON recipe_scaling_binding
 FOR EACH ROW EXECUTE FUNCTION recipe_lifecycle_content_guard();
CREATE TRIGGER recipe_scaling_expression_00_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON recipe_scaling_expression
 FOR EACH ROW EXECUTE FUNCTION recipe_lifecycle_content_guard();
REVOKE ALL ON FUNCTION recipe_lifecycle_header_guard(),recipe_lifecycle_content_guard(),recipe_lock_draft(uuid,integer) FROM PUBLIC;
-- Geen statusovergang, goedkeuringsrecht, vrijgave of uitvoeringsrecht in 0115.

-- Migratie 0116: versiegebonden Management of Change-concept (#112, D89).
SET search_path = fabriek, public;

-- Eén wijzigingsdossier per versie. De referentieversie is expliciet,
-- behoort tot dezelfde receptidentiteit en heeft een lager revisienummer.
-- De voorlopige classificatie is beschrijvend, geen beoordelingsmatrix.
CREATE TABLE recipe_change_request (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 recipe_version_id uuid NOT NULL UNIQUE REFERENCES master_recipe_version(id),
 baseline_version_id uuid REFERENCES master_recipe_version(id),
 change_kind text NOT NULL CHECK (change_kind IN ('initial','revision')),
 reason text NOT NULL CHECK (reason ~ '[^[:space:]]'),
 impact_description text NOT NULL CHECK (impact_description ~ '[^[:space:]]'),
 created_by uuid NOT NULL REFERENCES gebruiker(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(recipe_version_id,id),
 CHECK ((change_kind='initial')=(baseline_version_id IS NULL))
);
CREATE TABLE recipe_change_impact (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 recipe_version_id uuid NOT NULL,
 request_id uuid NOT NULL,
 area text NOT NULL CHECK (area IN ('header','procedure','parameters','formula','materials','equipment','personnel','instructions','quality','lot','scaling','other')),
 explanation text NOT NULL CHECK (explanation ~ '[^[:space:]]'),
 FOREIGN KEY(recipe_version_id,request_id) REFERENCES recipe_change_request(recipe_version_id,id),
 UNIQUE(request_id,area)
);

CREATE FUNCTION recipe_change_request_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE recipe uuid; rev integer; baseline_recipe uuid; baseline_rev integer;
BEGIN
 IF TG_OP='DELETE' THEN
   RAISE EXCEPTION 'MOC-dossier mag niet worden verwijderd' USING ERRCODE='55000';
 END IF;
 IF TG_OP='UPDATE' AND (NEW.id,NEW.recipe_version_id,NEW.baseline_version_id,NEW.change_kind,NEW.created_by,NEW.created_at)
   IS DISTINCT FROM (OLD.id,OLD.recipe_version_id,OLD.baseline_version_id,OLD.change_kind,OLD.created_by,OLD.created_at) THEN
   RAISE EXCEPTION 'MOC-identiteit en referentie zijn onveranderlijk' USING ERRCODE='55000';
 END IF;
 SELECT master_recipe_id,revision INTO recipe,rev FROM master_recipe_version WHERE id=NEW.recipe_version_id;
 IF NEW.change_kind='initial' THEN
   IF rev IS DISTINCT FROM 1 THEN
     RAISE EXCEPTION 'Initiële MOC vereist eerste receptrevisie' USING ERRCODE='23514';
   END IF;
 ELSE
   SELECT master_recipe_id,revision INTO baseline_recipe,baseline_rev FROM master_recipe_version WHERE id=NEW.baseline_version_id;
   IF baseline_recipe IS NULL OR baseline_recipe IS DISTINCT FROM recipe OR baseline_rev>=rev THEN
     RAISE EXCEPTION 'MOC vereist eerdere revisie van dezelfde receptidentiteit' USING ERRCODE='23514';
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recipe_change_request_00_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON recipe_change_request
 FOR EACH ROW EXECUTE FUNCTION recipe_lifecycle_content_guard();
CREATE TRIGGER recipe_change_request_guard BEFORE INSERT OR UPDATE OR DELETE ON recipe_change_request
 FOR EACH ROW EXECUTE FUNCTION recipe_change_request_guard();
CREATE TRIGGER recipe_change_request_audit AFTER INSERT OR UPDATE ON recipe_change_request
 FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();
CREATE TRIGGER recipe_change_impact_00_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON recipe_change_impact
 FOR EACH ROW EXECUTE FUNCTION recipe_lifecycle_content_guard();
CREATE TRIGGER recipe_change_impact_audit AFTER INSERT OR UPDATE OR DELETE ON recipe_change_impact
 FOR EACH ROW EXECUTE FUNCTION recipe_procedure_audit();

CREATE FUNCTION recipe_change_list(p_version uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE product uuid; result jsonb;
BEGIN
 SELECT r.product_id INTO product FROM master_recipe_version v JOIN master_recipe r ON r.id=v.master_recipe_id WHERE v.id=p_version;
 PERFORM recipe_draft_actor(product);
 SELECT jsonb_build_object('change_no',v.change_no,'lifecycle_status',v.lifecycle_status,
   'request',(SELECT to_jsonb(c) FROM recipe_change_request c WHERE c.recipe_version_id=v.id),
   'impacts',COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.area) FROM recipe_change_impact i WHERE i.recipe_version_id=v.id),'[]'::jsonb))
 INTO result FROM master_recipe_version v WHERE v.id=p_version;
 RETURN result;
END $$;

CREATE FUNCTION recipe_create_change_request(p_version uuid,p_expected integer,p_baseline uuid,p_reason text,p_impact text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE n integer; actor uuid; target uuid;
BEGIN
 n:=recipe_lock_draft(p_version,p_expected);
 actor:=execution_transaction_actor();
 INSERT INTO recipe_change_request(recipe_version_id,baseline_version_id,change_kind,reason,impact_description,created_by)
 VALUES(p_version,p_baseline,CASE WHEN p_baseline IS NULL THEN 'initial' ELSE 'revision' END,p_reason,p_impact,actor)
 RETURNING id INTO target;
 UPDATE master_recipe_version SET change_no=n+1 WHERE id=p_version;
 RETURN jsonb_build_object('id',target,'change_no',n+1);
END $$;

CREATE FUNCTION recipe_update_change_request(p_version uuid,p_expected integer,p_id uuid,p_reason text,p_impact text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE n integer; target uuid;
BEGIN
 n:=recipe_lock_draft(p_version,p_expected);
 UPDATE recipe_change_request SET reason=p_reason,impact_description=p_impact
 WHERE recipe_version_id=p_version AND id=p_id RETURNING id INTO target;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekend MOC-dossier binnen deze versie' USING ERRCODE='23503'; END IF;
 UPDATE master_recipe_version SET change_no=n+1 WHERE id=p_version;
 RETURN jsonb_build_object('id',target,'change_no',n+1);
END $$;

CREATE FUNCTION recipe_save_change_impact(p_version uuid,p_expected integer,p_id uuid,p_request uuid,p_area text,p_explanation text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE n integer; target uuid;
BEGIN
 n:=recipe_lock_draft(p_version,p_expected);
 IF p_id IS NULL THEN
   INSERT INTO recipe_change_impact(recipe_version_id,request_id,area,explanation)
   VALUES(p_version,p_request,p_area,p_explanation) RETURNING id INTO target;
 ELSE
   UPDATE recipe_change_impact SET area=p_area,explanation=p_explanation
   WHERE recipe_version_id=p_version AND id=p_id AND request_id=p_request RETURNING id INTO target;
   IF NOT FOUND THEN RAISE EXCEPTION 'Onbekend MOC-impactrecord binnen dit dossier' USING ERRCODE='23503'; END IF;
 END IF;
 UPDATE master_recipe_version SET change_no=n+1 WHERE id=p_version;
 RETURN jsonb_build_object('id',target,'change_no',n+1);
END $$;

CREATE FUNCTION recipe_delete_change_impact(p_version uuid,p_expected integer,p_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE n integer;
BEGIN
 n:=recipe_lock_draft(p_version,p_expected);
 DELETE FROM recipe_change_impact WHERE recipe_version_id=p_version AND id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekend MOC-impactrecord binnen deze versie' USING ERRCODE='23503'; END IF;
 UPDATE master_recipe_version SET change_no=n+1 WHERE id=p_version;
 RETURN n+1;
END $$;

REVOKE ALL ON recipe_change_request,recipe_change_impact FROM PUBLIC;
REVOKE ALL ON FUNCTION recipe_change_request_guard(),recipe_change_list(uuid),
 recipe_create_change_request(uuid,integer,uuid,text,text),
 recipe_update_change_request(uuid,integer,uuid,text,text),
 recipe_save_change_impact(uuid,integer,uuid,uuid,text,text),
 recipe_delete_change_impact(uuid,integer,uuid) FROM PUBLIC;
-- Impactlabels vormen geen autorisatie of bewijs van volledigheid.
-- De beoordelingsmatrix en automatische vergelijking volgen; statuspoort blijft gesloten.

-- Migratie 0117: inhoudelijke MBR-versievergelijking (#112).
SET search_path = fabriek, public;

-- Interne projectie: stabiele codes voor lokale verwijzingen, exacte
-- externe revisie/catalogus-ID's behouden. Geen impliciete conversie.
-- MOC-metadata, status, auteurs en tellers zijn geen receptinhoud.
CREATE FUNCTION recipe_comparison_rows(p_version uuid)
RETURNS TABLE(area text, entity text, item_key text, content jsonb)
LANGUAGE sql STABLE SET search_path=pg_catalog,fabriek,pg_temp AS $$
 SELECT 'header'::text,'master_recipe_version'::text,'header'::text,jsonb_build_object('name',v.name,'description',v.description)
 FROM master_recipe_version v WHERE v.id=p_version
 UNION ALL
 SELECT 'procedure'::text,'recipe_procedural_element'::text,(x.code)::text,(to_jsonb(x)-ARRAY['id','recipe_version_id','parent_id']) || jsonb_build_object('parent_code',(SELECT code FROM recipe_procedural_element WHERE id=x.parent_id)) FROM recipe_procedural_element x WHERE x.recipe_version_id=p_version
 UNION ALL
 SELECT 'procedure'::text,'recipe_dependency'::text,(jsonb_build_array((SELECT code FROM recipe_procedural_element WHERE id=x.predecessor_id),(SELECT code FROM recipe_procedural_element WHERE id=x.successor_id))::text)::text,(to_jsonb(x)-ARRAY['id','recipe_version_id','predecessor_id','successor_id']) || jsonb_build_object('predecessor_code',(SELECT code FROM recipe_procedural_element WHERE id=x.predecessor_id),'successor_code',(SELECT code FROM recipe_procedural_element WHERE id=x.successor_id)) FROM recipe_dependency x WHERE x.recipe_version_id=p_version
 UNION ALL
 SELECT 'parameters'::text,'recipe_parameter'::text,(x.code)::text,(to_jsonb(x)-ARRAY['id','recipe_version_id','procedural_element_id']) || jsonb_build_object('element_code',(SELECT code FROM recipe_procedural_element WHERE id=x.procedural_element_id)) FROM recipe_parameter x WHERE x.recipe_version_id=p_version
 UNION ALL
 SELECT 'parameters'::text,'recipe_parameter_limit'::text,(jsonb_build_array((SELECT code FROM recipe_parameter WHERE id=x.parameter_id),x.category)::text)::text,(to_jsonb(x)-ARRAY['id','recipe_version_id','parameter_id']) || jsonb_build_object('parameter_code',(SELECT code FROM recipe_parameter WHERE id=x.parameter_id)) FROM recipe_parameter_limit x WHERE x.recipe_version_id=p_version
 UNION ALL
 SELECT 'formula'::text,'recipe_formula'::text,('reference')::text,(to_jsonb(x)-ARRAY['id','recipe_version_id']) FROM recipe_formula x WHERE x.recipe_version_id=p_version
 UNION ALL
 SELECT 'materials'::text,'recipe_material_requirement'::text,(x.code)::text,(to_jsonb(x)-ARRAY['id','recipe_version_id','formula_id','procedural_element_id']) || jsonb_build_object('element_code',(SELECT code FROM recipe_procedural_element WHERE id=x.procedural_element_id)) FROM recipe_material_requirement x WHERE x.recipe_version_id=p_version
 UNION ALL
 SELECT 'equipment'::text,'recipe_equipment_requirement'::text,(x.code)::text,(to_jsonb(x)-ARRAY['id','recipe_version_id','procedural_element_id']) || jsonb_build_object('element_code',(SELECT code FROM recipe_procedural_element WHERE id=x.procedural_element_id)) FROM recipe_equipment_requirement x WHERE x.recipe_version_id=p_version
 UNION ALL
 SELECT 'personnel'::text,'recipe_personnel_requirement'::text,(x.code)::text,(to_jsonb(x)-ARRAY['id','recipe_version_id','procedural_element_id']) || jsonb_build_object('element_code',(SELECT code FROM recipe_procedural_element WHERE id=x.procedural_element_id)) FROM recipe_personnel_requirement x WHERE x.recipe_version_id=p_version
 UNION ALL
 SELECT 'instructions'::text,'recipe_instruction'::text,(x.code)::text,(to_jsonb(x)-ARRAY['id','recipe_version_id','procedural_element_id']) || jsonb_build_object('element_code',(SELECT code FROM recipe_procedural_element WHERE id=x.procedural_element_id)) FROM recipe_instruction x WHERE x.recipe_version_id=p_version
 UNION ALL
 SELECT 'quality'::text,'recipe_specification_link'::text,(x.code)::text,(to_jsonb(x)-ARRAY['id','recipe_version_id','parameter_limit_id']) || jsonb_build_object('parameter_limit',(SELECT jsonb_build_array(p.code,l.category) FROM recipe_parameter_limit l JOIN recipe_parameter p ON p.id=l.parameter_id WHERE l.id=x.parameter_limit_id)) FROM recipe_specification_link x WHERE x.recipe_version_id=p_version
 UNION ALL
 SELECT 'lot'::text,'recipe_lot_rule'::text,('norm')::text,(to_jsonb(x)-ARRAY['id','recipe_version_id']) FROM recipe_lot_rule x WHERE x.recipe_version_id=p_version
 UNION ALL
 SELECT 'lot'::text,'recipe_compatibility_rule'::text,(x.other_recipe_version_id::text)::text,(to_jsonb(x)-ARRAY['id','recipe_version_id']) FROM recipe_compatibility_rule x WHERE x.recipe_version_id=p_version
 UNION ALL
 SELECT 'scaling'::text,'recipe_scaling_rule'::text,(x.code)::text,(to_jsonb(x)-ARRAY['id','recipe_version_id']) FROM recipe_scaling_rule x WHERE x.recipe_version_id=p_version
 UNION ALL
 SELECT 'scaling'::text,'recipe_scaling_input'::text,(jsonb_build_array((SELECT code FROM recipe_scaling_rule WHERE id=x.rule_id),x.code)::text)::text,(to_jsonb(x)-ARRAY['id','recipe_version_id','rule_id','parameter_id']) || jsonb_build_object('rule_code',(SELECT code FROM recipe_scaling_rule WHERE id=x.rule_id),'parameter_code',(SELECT code FROM recipe_parameter WHERE id=x.parameter_id)) FROM recipe_scaling_input x WHERE x.recipe_version_id=p_version
 UNION ALL
 SELECT 'scaling'::text,'recipe_scaling_binding'::text,(CASE WHEN x.parameter_limit_id IS NOT NULL THEN jsonb_build_array('parameter',(SELECT p.code FROM recipe_parameter_limit l JOIN recipe_parameter p ON p.id=l.parameter_id WHERE l.id=x.parameter_limit_id),(SELECT category FROM recipe_parameter_limit WHERE id=x.parameter_limit_id))::text ELSE jsonb_build_array('material',(SELECT code FROM recipe_material_requirement WHERE id=x.material_requirement_id))::text END)::text,(to_jsonb(x)-ARRAY['id','recipe_version_id','rule_id','parameter_limit_id','material_requirement_id']) || jsonb_build_object('rule_code',(SELECT code FROM recipe_scaling_rule WHERE id=x.rule_id)) FROM recipe_scaling_binding x WHERE x.recipe_version_id=p_version
 UNION ALL
 SELECT 'scaling'::text,'recipe_scaling_expression'::text,((SELECT code FROM recipe_scaling_rule WHERE id=x.rule_id))::text,(to_jsonb(x)-ARRAY['id','recipe_version_id','rule_id','tokens']) || jsonb_build_object('tokens',(SELECT jsonb_agg(CASE WHEN t.value->>'op'='input' THEN jsonb_build_object('op','input','code',(SELECT i.code FROM recipe_scaling_input i WHERE i.id=(t.value->>'id')::uuid AND i.rule_id=x.rule_id)) ELSE t.value END ORDER BY t.ordinality) FROM jsonb_array_elements(x.tokens) WITH ORDINALITY t(value,ordinality))) FROM recipe_scaling_expression x WHERE x.recipe_version_id=p_version
$$;

CREATE FUNCTION recipe_compare_change(p_version uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE product uuid; baseline uuid; baseline_no integer; current_no integer; result jsonb;
BEGIN
 SELECT r.product_id INTO product FROM master_recipe_version v JOIN master_recipe r ON r.id=v.master_recipe_id WHERE v.id=p_version;
 PERFORM recipe_draft_actor(product);
 -- Eén lockvolgorde voor beide versies, inclusief eerste lezing van
 -- onveranderlijke baselineverwijzing. Geen statusmutatie.
 SELECT baseline_version_id INTO baseline FROM recipe_change_request WHERE recipe_version_id=p_version;
 IF NOT FOUND THEN RAISE EXCEPTION 'MOC-dossier ontbreekt' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM master_recipe_version WHERE id=p_version OR id=baseline ORDER BY id FOR SHARE;
 SELECT change_no INTO current_no FROM master_recipe_version WHERE id=p_version;
 SELECT change_no INTO baseline_no FROM master_recipe_version WHERE id=baseline;
 WITH old_rows AS (SELECT * FROM recipe_comparison_rows(baseline)),
 new_rows AS (SELECT * FROM recipe_comparison_rows(p_version)),
 differences AS (
 SELECT COALESCE(n.area,o.area) AS area,COALESCE(n.entity,o.entity) AS entity,COALESCE(n.item_key,o.item_key) AS item_key,
 CASE WHEN o.item_key IS NULL THEN 'added' WHEN n.item_key IS NULL THEN 'removed' ELSE 'changed' END AS change,
 o.content AS before,n.content AS after
 FROM old_rows o FULL JOIN new_rows n USING(area,entity,item_key)
 WHERE o.content IS DISTINCT FROM n.content
 )
 SELECT jsonb_build_object('recipe_version_id',p_version,'change_no',current_no,'baseline_version_id',baseline,
 'baseline_change_no',baseline_no,'differences',COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.area,d.entity,d.item_key),'[]'::jsonb))
 INTO result FROM differences d;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION recipe_comparison_rows(uuid),recipe_compare_change(uuid) FROM PUBLIC;
-- Alleen vergelijking, geen goedkeuring, geen vrijgave of bewijs dat
-- handmatig opgegeven impact volledig is. Exacte snapshot volgt bij review.

-- Migratie 0118: D108 beoordelingsmatrix en onafhankelijke rollen (#112).
SET search_path = fabriek, public;

-- Nieuwe domeinpermissions; geen nieuwe persoonlijke grants.
INSERT INTO authorization_permission(code,domain) VALUES
 ('recipe.review.engineering','engineering'),
 ('recipe.review.production','operations'),
 ('recipe.review.quality','quality');
INSERT INTO authorization_role_permission(role_code,permission_code) VALUES
 ('engineering_approver','recipe.review.engineering'),
 ('manufacturing_manager','recipe.review.production'),
 ('quality_approver','recipe.review.quality');

-- Matrixversie 1 is een vaste, reproduceerbare projectregel. De unie
-- van opgegeven en afgeleide impactgebieden bepaalt alle vereisten.
-- Onbekende gebieden en initiële recepten vereisen alle drie domeinen.
CREATE FUNCTION recipe_review_matrix_v1(p_initial boolean,p_areas text[]) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,fabriek,pg_temp AS $$
 SELECT ARRAY['engineering']::text[]
 || CASE WHEN p_initial IS DISTINCT FROM false OR p_areas IS NULL OR EXISTS (
   SELECT 1 FROM unnest(p_areas) a WHERE a IS NULL OR a NOT IN ('header','quality')
 ) THEN ARRAY['production']::text[] ELSE ARRAY[]::text[] END
 || CASE WHEN p_initial IS DISTINCT FROM false OR p_areas IS NULL OR EXISTS (
   SELECT 1 FROM unnest(p_areas) a WHERE a IS NULL OR a NOT IN ('header','personnel')
 ) THEN ARRAY['quality']::text[] ELSE ARRAY[]::text[] END
$$;

CREATE FUNCTION recipe_review_requirements(p_version uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE diff jsonb; req recipe_change_request%ROWTYPE; areas text[]; reviewers text[];
BEGIN
 -- Vergelijkingsfunctie controleert persoonlijke productscope en neemt
 -- de gedeelde locks op huidige en referentierevisie.
 diff:=recipe_compare_change(p_version);
 SELECT * INTO STRICT req FROM recipe_change_request WHERE recipe_version_id=p_version;
 SELECT COALESCE(array_agg(a ORDER BY a),ARRAY[]::text[]) INTO areas FROM (
   SELECT area AS a FROM recipe_change_impact WHERE recipe_version_id=p_version
   UNION
   SELECT value->>'area' FROM jsonb_array_elements(diff->'differences')
 ) s;
 reviewers:=recipe_review_matrix_v1(req.change_kind='initial',areas);
 RETURN jsonb_build_object('matrix_version',1,'recipe_version_id',p_version,
   'change_no',diff->'change_no','baseline_version_id',diff->'baseline_version_id',
   'baseline_change_no',diff->'baseline_change_no','impact_areas',to_jsonb(areas),
   'required_reviews',to_jsonb(reviewers));
END $$;

-- Intern hulpmiddel voor latere persoonlijke reviewtransacties. Niet
-- uitvoerbaar voor mes_app. Werkelijke review vereist bovendien een
-- vastgezette beoordelingsronde, auteurscontrole en identiteitbevestiging.
CREATE FUNCTION recipe_review_actor(p_version uuid,p_domain text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; product uuid; permission_code text;
BEGIN
 actor:=execution_transaction_actor();
 permission_code:=CASE p_domain WHEN 'engineering' THEN 'recipe.review.engineering'
   WHEN 'production' THEN 'recipe.review.production' WHEN 'quality' THEN 'recipe.review.quality' ELSE NULL END;
 SELECT r.product_id INTO product FROM master_recipe_version v JOIN master_recipe r ON r.id=v.master_recipe_id WHERE v.id=p_version;
 IF permission_code IS NULL OR product IS NULL OR authorization_permits(actor,permission_code,NULL,product,NULL) IS NOT TRUE THEN
   RAISE EXCEPTION 'Geen actuele MES-receptbeoordelingsbevoegdheid' USING ERRCODE='42501';
 END IF;
 RETURN actor;
END $$;
REVOKE ALL ON FUNCTION recipe_review_matrix_v1(boolean,text[]),recipe_review_requirements(uuid),recipe_review_actor(uuid,text) FROM PUBLIC;
-- Geen statusovergang of registratie van een goedkeuringsbesluit.

-- Migratie 0119: onveranderlijke beoordelingsronde en bijdragers (#112/D108).
SET search_path = fabriek, public;

-- Ronde is historisch bewijs; nog geen statusovergang of beslisfunctie.
CREATE TABLE recipe_review_round (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 recipe_version_id uuid NOT NULL REFERENCES master_recipe_version(id),
 round_no integer NOT NULL CHECK(round_no>0),
 change_no integer NOT NULL CHECK(change_no>=0),
 baseline_version_id uuid REFERENCES master_recipe_version(id),
 baseline_change_no integer CHECK(baseline_change_no>=0),
 matrix_version integer NOT NULL CHECK(matrix_version=1),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 required_reviews text[] NOT NULL CHECK(cardinality(required_reviews) BETWEEN 1 AND 3 AND required_reviews @> ARRAY['engineering']::text[] AND required_reviews <@ ARRAY['engineering','production','quality']::text[] AND array_position(required_reviews,NULL) IS NULL),
 contributors uuid[] NOT NULL CHECK(cardinality(contributors)>0 AND array_position(contributors,NULL) IS NULL),
 created_by uuid NOT NULL REFERENCES gebruiker(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(recipe_version_id,round_no),
 UNIQUE(id,recipe_version_id),
 CHECK((baseline_version_id IS NULL)=(baseline_change_no IS NULL))
);

-- Een besluit kan later uitsluitend aan een exacte ronde worden gekoppeld.
-- Eén persoon kan nooit twee verplichte domeinen voor dezelfde ronde aftekenen.
CREATE TABLE recipe_review_decision (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 round_id uuid NOT NULL REFERENCES recipe_review_round(id),
 domain text NOT NULL CHECK(domain IN ('engineering','production','quality')),
 decision text NOT NULL CHECK(decision IN ('approve','reject')),
 reason text NOT NULL CHECK(reason ~ '[^[:space:]]'),
 reviewer_id uuid NOT NULL REFERENCES gebruiker(id),
 decided_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(round_id,domain),
 UNIQUE(round_id,reviewer_id)
);

CREATE FUNCTION recipe_review_evidence_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Beoordelingsbewijs is onveranderlijk' USING ERRCODE='55000';
END $$;
CREATE TRIGGER recipe_review_round_immutable BEFORE UPDATE OR DELETE ON recipe_review_round
 FOR EACH ROW EXECUTE FUNCTION recipe_review_evidence_immutable();
CREATE TRIGGER recipe_review_decision_immutable BEFORE UPDATE OR DELETE ON recipe_review_decision
 FOR EACH ROW EXECUTE FUNCTION recipe_review_evidence_immutable();

-- Neem alle persoonlijke mutaties mee, ook verwijderde inhoud en MOC.
-- Niet bewezen herkomst blokkeert beoordeling; geen verzonnen auteurs.
CREATE FUNCTION recipe_review_contributors(p_version uuid) RETURNS uuid[]
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE people uuid[]; unknown_count bigint;
BEGIN
 WITH entries AS (
 SELECT actor_user_id,actor_origin FROM config_log
 WHERE (tabel='master_recipe_version' AND record_id=p_version
   AND (actie='INSERT' OR (oud->>'name',oud->>'description') IS DISTINCT FROM (nieuw->>'name',nieuw->>'description')
      OR (oud->>'change_no') IS DISTINCT FROM (nieuw->>'change_no')))
 OR (tabel IN ('recipe_procedural_element','recipe_dependency','recipe_parameter','recipe_parameter_limit','recipe_formula','recipe_material_requirement','recipe_equipment_requirement','recipe_personnel_requirement','recipe_instruction','recipe_specification_link','recipe_lot_rule','recipe_compatibility_rule','recipe_scaling_rule','recipe_scaling_input','recipe_scaling_binding','recipe_scaling_expression','recipe_change_request','recipe_change_impact')
   AND COALESCE(nieuw->>'recipe_version_id',oud->>'recipe_version_id')=p_version::text)
 )
 SELECT count(*) FILTER (WHERE actor_origin IS DISTINCT FROM 'personal' OR actor_user_id IS NULL)
 INTO unknown_count FROM entries;
 IF unknown_count>0 THEN
   RAISE EXCEPTION 'MBR bevat niet persoonlijk bewezen wijzigingen' USING ERRCODE='23514';
 END IF;
 SELECT ARRAY(SELECT DISTINCT actor FROM (
 SELECT created_by AS actor FROM master_recipe_version WHERE id=p_version
 UNION ALL SELECT created_by FROM recipe_change_request WHERE recipe_version_id=p_version
 UNION ALL SELECT actor_user_id FROM config_log
 WHERE (tabel='master_recipe_version' AND record_id=p_version
   AND (actie='INSERT' OR (oud->>'name',oud->>'description') IS DISTINCT FROM (nieuw->>'name',nieuw->>'description')
      OR (oud->>'change_no') IS DISTINCT FROM (nieuw->>'change_no')))
 OR (tabel IN ('recipe_procedural_element','recipe_dependency','recipe_parameter','recipe_parameter_limit','recipe_formula','recipe_material_requirement','recipe_equipment_requirement','recipe_personnel_requirement','recipe_instruction','recipe_specification_link','recipe_lot_rule','recipe_compatibility_rule','recipe_scaling_rule','recipe_scaling_input','recipe_scaling_binding','recipe_scaling_expression','recipe_change_request','recipe_change_impact')
   AND COALESCE(nieuw->>'recipe_version_id',oud->>'recipe_version_id')=p_version::text)
 ) s WHERE actor IS NOT NULL ORDER BY actor) INTO people;
 RETURN people;
END $$;

-- Volledige exacte snapshot met lokale ID's (naast genormaliseerde diff).
-- Expliciete externe referenties worden behouden, geen afgeronde JS-getallen.
CREATE FUNCTION recipe_review_snapshot(p_version uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,fabriek,pg_temp AS $$
 SELECT jsonb_build_object('header',to_jsonb(v)-'lifecycle_status',
 'recipe_procedural_element',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_procedural_element x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_dependency',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_dependency x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_parameter',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_parameter x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_parameter_limit',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_parameter_limit x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_formula',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_formula x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_material_requirement',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_material_requirement x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_equipment_requirement',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_equipment_requirement x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_personnel_requirement',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_personnel_requirement x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_instruction',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_instruction x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_specification_link',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_specification_link x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_lot_rule',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_lot_rule x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_compatibility_rule',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_compatibility_rule x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_scaling_rule',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_scaling_rule x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_scaling_input',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_scaling_input x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_scaling_binding',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_scaling_binding x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_scaling_expression',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_scaling_expression x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_change_request',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_change_request x WHERE x.recipe_version_id=v.id),'[]'::jsonb),
 'recipe_change_impact',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM recipe_change_impact x WHERE x.recipe_version_id=v.id),'[]'::jsonb)
 ) FROM master_recipe_version v WHERE v.id=p_version
$$;

-- Intern; nog geen app-grant. Eerst identiteitbevestiging en statusworkflow.
-- Lock beide versies in vaste volgorde voordat inhoud wordt gelezen.
CREATE FUNCTION recipe_prepare_review_round(p_version uuid,p_expected integer,p_baseline_expected integer) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE baseline uuid; state text; baseline_state text; n integer; b integer; actor uuid; plan jsonb; diff jsonb; people uuid[]; required text[]; target uuid; seq integer;
BEGIN
 SELECT baseline_version_id INTO baseline FROM recipe_change_request WHERE recipe_version_id=p_version;
 IF NOT FOUND THEN RAISE EXCEPTION 'MOC-dossier ontbreekt' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM master_recipe_version WHERE id=p_version OR id=baseline ORDER BY id FOR UPDATE;
 n:=recipe_lock_draft(p_version,p_expected);
 actor:=execution_transaction_actor();
 SELECT change_no,lifecycle_status INTO b,baseline_state FROM master_recipe_version WHERE id=baseline;
 IF b IS DISTINCT FROM p_baseline_expected THEN
   RAISE EXCEPTION 'MBR-referentie is ondertussen gewijzigd' USING ERRCODE='40001';
 END IF;
 -- Een revisie mag de beoordelingsmatrix niet omzeilen via een willekeurig
 -- concept als referentie. Alleen eerder vrijgegeven historie is geldig.
 IF baseline IS NOT NULL AND baseline_state NOT IN ('released','superseded') THEN
   RAISE EXCEPTION 'Beoordeling vereist eerder vrijgegeven referentierevisie' USING ERRCODE='23514';
 END IF;
 plan:=recipe_review_requirements(p_version);
 diff:=recipe_compare_change(p_version);
 people:=recipe_review_contributors(p_version);
 SELECT ARRAY(SELECT DISTINCT x FROM unnest(people||ARRAY[actor]) x ORDER BY x) INTO people;
 SELECT ARRAY(SELECT jsonb_array_elements_text(plan->'required_reviews')) INTO required;
 SELECT COALESCE(max(round_no),0)+1 INTO seq FROM recipe_review_round WHERE recipe_version_id=p_version;
 INSERT INTO recipe_review_round(recipe_version_id,round_no,change_no,baseline_version_id,baseline_change_no,matrix_version,snapshot,required_reviews,contributors,created_by)
 VALUES(p_version,seq,n,baseline,b,1,jsonb_build_object('current',recipe_review_snapshot(p_version),'baseline',recipe_review_snapshot(baseline),'comparison',diff,'requirements',plan),required,people,actor)
 RETURNING id INTO target;
 RETURN target;
END $$;

-- Onafhankelijke relationele beveiliging voor toekomstige besluiten.
-- Tot de identiteitbevestiging bestaat, is elke INSERT expliciet geblokkeerd.
CREATE FUNCTION recipe_review_decision_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE r recipe_review_round%ROWTYPE;
BEGIN
 SELECT * INTO STRICT r FROM recipe_review_round WHERE id=NEW.round_id FOR SHARE;
 IF NEW.reviewer_id=ANY(r.contributors) THEN
   RAISE EXCEPTION 'Zelfgoedkeuring of beoordeling door bijdrager niet toegestaan' USING ERRCODE='42501';
 END IF;
 IF NOT (NEW.domain=ANY(r.required_reviews)) THEN
   RAISE EXCEPTION 'Beoordelingsdomein niet vereist voor deze ronde' USING ERRCODE='23514';
 END IF;
 RAISE EXCEPTION 'Beoordelingsbesluiten wachten op identiteitbevestiging' USING ERRCODE='55000';
END $$;
CREATE TRIGGER recipe_review_decision_guard BEFORE INSERT ON recipe_review_decision
 FOR EACH ROW EXECUTE FUNCTION recipe_review_decision_guard();
REVOKE ALL ON recipe_review_round,recipe_review_decision FROM PUBLIC;
REVOKE ALL ON FUNCTION recipe_review_evidence_immutable(),recipe_review_contributors(uuid),
 recipe_review_snapshot(uuid),recipe_prepare_review_round(uuid,integer,integer),recipe_review_decision_guard() FROM PUBLIC;

-- Migratie 0120: persoonlijke herbevestiging en gecontroleerde MBR-review (D108).
SET search_path = fabriek, public;

-- Statusovergangen veranderen de inhoudsteller niet. Identiteits- en
-- inhoudsmutaties blijven gescheiden. Vrijgave blijft gesloten.
CREATE OR REPLACE FUNCTION master_recipe_version_identity_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN
   RAISE EXCEPTION 'MBR-versie mag niet worden verwijderd' USING ERRCODE='55000';
 END IF;
 IF (NEW.id,NEW.master_recipe_id,NEW.revision,NEW.created_at,NEW.created_by)
    IS DISTINCT FROM (OLD.id,OLD.master_recipe_id,OLD.revision,OLD.created_at,OLD.created_by) THEN
   RAISE EXCEPTION 'MBR-versie-identiteit is onveranderlijk' USING ERRCODE='55000';
 END IF;
 IF NEW.lifecycle_status IS DISTINCT FROM OLD.lifecycle_status THEN
   IF (NEW.name,NEW.description,NEW.change_no) IS DISTINCT FROM (OLD.name,OLD.description,OLD.change_no) THEN
     RAISE EXCEPTION 'Statusovergang mag inhoud niet wijzigen' USING ERRCODE='55000';
   END IF;
 ELSIF NEW.change_no IS DISTINCT FROM OLD.change_no+1 THEN
   RAISE EXCEPTION 'MBR-wijzigingsteller moet precies één toenemen' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;

-- Geen vrijgave in deze migratie. Een ronde is exact gekoppeld aan de
-- huidige inhoud en blijft historisch behouden na terugkeer naar draft.
CREATE OR REPLACE FUNCTION recipe_lifecycle_header_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE r recipe_review_round%ROWTYPE;
BEGIN
 IF TG_OP='INSERT' THEN
   IF NEW.lifecycle_status IS DISTINCT FROM 'draft' THEN
     RAISE EXCEPTION 'Nieuwe MBR-versie moet een concept zijn' USING ERRCODE='55000';
   END IF;
   RETURN NEW;
 END IF;
 IF NEW.lifecycle_status IS NOT DISTINCT FROM OLD.lifecycle_status THEN
   IF OLD.lifecycle_status<>'draft' THEN
     RAISE EXCEPTION 'MBR-inhoud is alleen wijzigbaar in conceptstatus' USING ERRCODE='55000';
   END IF;
   RETURN NEW;
 END IF;
 SELECT * INTO r FROM recipe_review_round WHERE recipe_version_id=OLD.id ORDER BY round_no DESC LIMIT 1;
 IF NOT FOUND OR r.change_no IS DISTINCT FROM OLD.change_no OR r.snapshot->'current' IS DISTINCT FROM recipe_review_snapshot(OLD.id) THEN
   RAISE EXCEPTION 'Actuele exacte beoordelingsronde vereist' USING ERRCODE='55000';
 END IF;
 IF OLD.lifecycle_status='draft' AND NEW.lifecycle_status='in_review' THEN
   IF EXISTS (SELECT 1 FROM recipe_review_decision WHERE round_id=r.id) THEN
     RAISE EXCEPTION 'Nieuwe beoordelingsronde vereist' USING ERRCODE='55000';
   END IF;
 ELSIF OLD.lifecycle_status='in_review' AND NEW.lifecycle_status='approved' THEN
   IF EXISTS (SELECT 1 FROM unnest(r.required_reviews) d WHERE NOT EXISTS (
     SELECT 1 FROM recipe_review_decision x WHERE x.round_id=r.id AND x.domain=d AND x.decision='approve')) THEN
     RAISE EXCEPTION 'Niet alle verplichte beoordelingen zijn goedgekeurd' USING ERRCODE='55000';
   END IF;
 ELSIF OLD.lifecycle_status='in_review' AND NEW.lifecycle_status='draft' THEN
   IF NOT EXISTS (SELECT 1 FROM recipe_review_decision WHERE round_id=r.id AND decision='reject') THEN
     RAISE EXCEPTION 'Afwijzing vereist' USING ERRCODE='55000';
   END IF;
 ELSE
   RAISE EXCEPTION 'MBR-statusovergang nog niet beschikbaar' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;

-- De indiener en beoordelaar komen uitsluitend uit de persoonlijke sessie.
-- Lock het account vóór de receptlock; hergebruik begrensde logincontrole.
-- Retourneer denied/locked zonder uitzondering zodat de caller de
-- geregistreerde inlogpoging kan COMMITten; geen wachtwoord in bewijs.
CREATE FUNCTION recipe_submit_review_confirmed(p_version uuid,p_expected integer,p_baseline_expected integer,p_password text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; name text; login record; target uuid;
BEGIN
 actor:=execution_transaction_actor();
 SELECT gebruikersnaam INTO name FROM gebruiker WHERE id=actor AND actief AND NOT gedeeld AND NOT wachtwoord_wijzigen FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','denied'); END IF;
 IF execution_transaction_actor() IS DISTINCT FROM actor THEN RETURN jsonb_build_object('status','denied'); END IF;
 SELECT * INTO login FROM inloggen(name,p_password,NULL);
 IF login.wacht_seconden IS NOT NULL THEN RETURN jsonb_build_object('status','locked'); END IF;
 IF login.id IS DISTINCT FROM actor THEN RETURN jsonb_build_object('status','denied'); END IF;
 target:=recipe_prepare_review_round(p_version,p_expected,p_baseline_expected);
 UPDATE master_recipe_version SET lifecycle_status='in_review' WHERE id=p_version;
 RETURN jsonb_build_object('status','submitted','round_id',target);
END $$;

-- Interne controle onder receptlock. Status, laatste ronde, exacte
-- snapshot, beide tellers, vereiste domeinen en bijdragers blijven leidend.
CREATE OR REPLACE FUNCTION recipe_review_decision_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE r recipe_review_round%ROWTYPE; v master_recipe_version%ROWTYPE; actor uuid;
BEGIN
 SELECT * INTO STRICT r FROM recipe_review_round WHERE id=NEW.round_id;
 SELECT * INTO STRICT v FROM master_recipe_version WHERE id=r.recipe_version_id FOR UPDATE;
 IF NEW.reviewer_id=ANY(r.contributors) THEN
   RAISE EXCEPTION 'Zelfgoedkeuring of beoordeling door bijdrager niet toegestaan' USING ERRCODE='42501';
 END IF;
 IF NOT (NEW.domain=ANY(r.required_reviews)) THEN
   RAISE EXCEPTION 'Beoordelingsdomein niet vereist voor deze ronde' USING ERRCODE='23514';
 END IF;
 IF v.lifecycle_status<>'in_review' OR r.change_no<>v.change_no
   OR EXISTS (SELECT 1 FROM recipe_review_round x WHERE x.recipe_version_id=v.id AND x.round_no>r.round_no)
   OR r.snapshot->'current' IS DISTINCT FROM recipe_review_snapshot(v.id) THEN
   RAISE EXCEPTION 'Beoordelingsronde is niet actueel' USING ERRCODE='40001';
 END IF;
 actor:=recipe_review_actor(v.id,NEW.domain);
 IF actor IS DISTINCT FROM NEW.reviewer_id THEN
   RAISE EXCEPTION 'Persoonlijke beoordelaar vereist' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION recipe_decide_review_confirmed(p_round uuid,p_expected integer,p_domain text,p_decision text,p_reason text,p_password text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE r recipe_review_round%ROWTYPE; v master_recipe_version%ROWTYPE; actor uuid; name text; login record; target uuid; state text;
BEGIN
 actor:=execution_transaction_actor();
 SELECT gebruikersnaam INTO name FROM gebruiker WHERE id=actor AND actief AND NOT gedeeld AND NOT wachtwoord_wijzigen FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','denied'); END IF;
 IF execution_transaction_actor() IS DISTINCT FROM actor THEN RETURN jsonb_build_object('status','denied'); END IF;
 SELECT * INTO r FROM recipe_review_round WHERE id=p_round;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende beoordelingsronde' USING ERRCODE='23503'; END IF;
 PERFORM recipe_review_actor(r.recipe_version_id,p_domain);
 SELECT * INTO STRICT v FROM master_recipe_version WHERE id=r.recipe_version_id FOR UPDATE;
 IF v.lifecycle_status<>'in_review' OR p_expected IS DISTINCT FROM v.change_no OR r.change_no<>v.change_no
   OR EXISTS (SELECT 1 FROM recipe_review_round x WHERE x.recipe_version_id=v.id AND x.round_no>r.round_no)
   OR r.snapshot->'current' IS DISTINCT FROM recipe_review_snapshot(v.id) THEN
   RAISE EXCEPTION 'Beoordelingsronde is niet actueel' USING ERRCODE='40001';
 END IF;
 IF actor=ANY(r.contributors) THEN RAISE EXCEPTION 'Zelfgoedkeuring of beoordeling door bijdrager niet toegestaan' USING ERRCODE='42501'; END IF;
 IF p_domain IS NULL OR NOT (p_domain=ANY(r.required_reviews)) OR p_decision IS NULL OR p_decision NOT IN ('approve','reject')
   OR btrim(coalesce(p_reason,''))='' THEN
   RAISE EXCEPTION 'Geldig vereist domein, besluit en reden vereist' USING ERRCODE='23514';
 END IF;
 IF EXISTS (SELECT 1 FROM recipe_review_decision WHERE round_id=p_round AND (domain=p_domain OR reviewer_id=actor)) THEN
   RAISE EXCEPTION 'Domein of persoon heeft al beoordeeld' USING ERRCODE='23505';
 END IF;
 SELECT * INTO login FROM inloggen(name,p_password,NULL);
 IF login.wacht_seconden IS NOT NULL THEN RETURN jsonb_build_object('status','locked'); END IF;
 IF login.id IS DISTINCT FROM actor THEN RETURN jsonb_build_object('status','denied'); END IF;
 -- Hercontrole in de trigger; geen directe app-insert, geen vrije actor.
 INSERT INTO recipe_review_decision(round_id,domain,decision,reason,reviewer_id)
 VALUES(p_round,p_domain,p_decision,p_reason,actor) RETURNING id INTO target;
 state:='in_review';
 IF p_decision='reject' THEN
   state:='draft';
 ELSIF NOT EXISTS (SELECT 1 FROM unnest(r.required_reviews) d WHERE NOT EXISTS (
   SELECT 1 FROM recipe_review_decision x WHERE x.round_id=p_round AND x.domain=d AND x.decision='approve')) THEN
   state:='approved';
 END IF;
 IF state<>'in_review' THEN UPDATE master_recipe_version SET lifecycle_status=state WHERE id=v.id; END IF;
 RETURN jsonb_build_object('status','decided','decision_id',target,'lifecycle_status',state);
END $$;

-- Geen vrijgave of mutatie van goedgekeurde recepten. Intrekken van
-- goedkeuring en expliciete vrijgave volgen in afzonderlijke migratie.
REVOKE ALL ON FUNCTION recipe_submit_review_confirmed(uuid,integer,integer,text),
 recipe_decide_review_confirmed(uuid,integer,text,text,text,text) FROM PUBLIC;

-- Migratie 0121: conservatieve inhoudelijke vrijgavepoort (#112/#141).
SET search_path = fabriek, public;

-- Alleen vaste controles, geen uitvoeringsengine of impliciete conversie.
-- De database rapporteert alle bekende blokkades; een lege lijst is
-- noodzakelijk, maar op zichzelf geen vrijgavebesluit.
CREATE FUNCTION recipe_release_blockers(p_version uuid)
RETURNS TABLE(code text, record_id uuid, detail text)
LANGUAGE sql STABLE SET search_path=pg_catalog,fabriek,pg_temp AS $$
 SELECT 'missing_version'::text,p_version,'Onbekende receptversie'::text
 WHERE NOT EXISTS (SELECT 1 FROM master_recipe_version WHERE id=p_version)
 UNION ALL
 SELECT 'missing_moc',p_version,'MOC-dossier ontbreekt'
 WHERE NOT EXISTS (SELECT 1 FROM recipe_change_request WHERE recipe_version_id=p_version)
 UNION ALL
 SELECT 'missing_root',p_version,'Procedure-root ontbreekt'
 WHERE NOT EXISTS (SELECT 1 FROM recipe_procedural_element WHERE recipe_version_id=p_version AND kind='procedure')
 UNION ALL
 SELECT 'empty_procedure_branch',x.id,'Procedure-element heeft geen onderliggend element'
 FROM recipe_procedural_element x
 WHERE x.recipe_version_id=p_version AND x.kind<>'phase'
 AND NOT EXISTS (SELECT 1 FROM recipe_procedural_element c WHERE c.recipe_version_id=p_version AND c.parent_id=x.id)
 UNION ALL
 SELECT 'missing_formula',p_version,'Referentieformule ontbreekt'
 WHERE NOT EXISTS (SELECT 1 FROM recipe_formula WHERE recipe_version_id=p_version)
 UNION ALL
 SELECT 'unmapped_formula_unit',f.id,'Referentie-eenheid niet expliciet gekoppeld'
 FROM recipe_formula f WHERE f.recipe_version_id=p_version AND f.reference_unit_id IS NULL
 UNION ALL
 SELECT 'unmapped_material_unit',m.id,'Materiaaleenheid niet expliciet gekoppeld'
 FROM recipe_material_requirement m JOIN material_definition_version v ON v.id=m.material_version_id
 WHERE m.recipe_version_id=p_version AND (m.measurement_unit_id IS NULL OR v.measurement_unit_id IS DISTINCT FROM m.measurement_unit_id OR v.unit IS DISTINCT FROM m.unit)
 UNION ALL
 SELECT 'unmapped_parameter_unit',p.id,'Numerieke parametereenheid niet expliciet gekoppeld'
 FROM recipe_parameter p WHERE p.recipe_version_id=p_version AND p.data_type IN ('decimal','integer')
 AND p.measurement_unit_id IS NULL
 UNION ALL
 SELECT 'missing_lot_rule',p_version,'Expliciete lotnorm ontbreekt'
 WHERE NOT EXISTS (SELECT 1 FROM recipe_lot_rule WHERE recipe_version_id=p_version)
 UNION ALL
 SELECT 'unverified_linear_parameter',l.id,'Lineaire schaling vereist bewezen ratio-eenheid en gehele-waardebeleid'
 FROM recipe_parameter_limit l JOIN recipe_parameter p ON p.id=l.parameter_id
 LEFT JOIN measurement_unit u ON u.id=p.measurement_unit_id LEFT JOIN quantity_kind k ON k.id=u.quantity_kind_id
 WHERE l.recipe_version_id=p_version AND l.scaling='linear' AND (k.value_semantics IS DISTINCT FROM 'ratio' OR p.data_type='integer')
 UNION ALL
 SELECT 'unverified_linear_material',m.id,'Lineaire materiaalschaling vereist bewezen ratio-eenheid'
 FROM recipe_material_requirement m LEFT JOIN measurement_unit u ON u.id=m.measurement_unit_id LEFT JOIN quantity_kind k ON k.id=u.quantity_kind_id
 WHERE m.recipe_version_id=p_version AND m.scaling='linear' AND k.value_semantics IS DISTINCT FROM 'ratio'
 UNION ALL
 SELECT 'unverified_reference_scaling',f.id,'Referentiegrootte voor lineaire schaling vereist ratio-eenheid'
 FROM recipe_formula f LEFT JOIN measurement_unit u ON u.id=f.reference_unit_id LEFT JOIN quantity_kind k ON k.id=u.quantity_kind_id
 WHERE f.recipe_version_id=p_version AND k.value_semantics IS DISTINCT FROM 'ratio'
 AND (EXISTS (SELECT 1 FROM recipe_material_requirement m WHERE m.recipe_version_id=p_version AND m.scaling='linear')
 OR EXISTS (SELECT 1 FROM recipe_parameter_limit l WHERE l.recipe_version_id=p_version AND l.scaling='linear'))
 UNION ALL
 SELECT 'complex_scaling_unproven',r.id,'Complexe schaalregel nog niet aantoonbaar uitvoerbaar; geen fixed/linear fallback'
 FROM recipe_scaling_rule r WHERE r.recipe_version_id=p_version
 UNION ALL
 SELECT 'equipment_class_unverified',e.id,'Equipmentklasse en capaciteit vereisen gevalideerde resourcecatalogus'
 FROM recipe_equipment_requirement e WHERE e.recipe_version_id=p_version
 UNION ALL
 SELECT 'qualification_changed',p.id,'Kwalificatiebetekenis wijkt af van vastgelegde eis'
 FROM recipe_personnel_requirement p LEFT JOIN qualification q ON q.code=p.qualification_code
 WHERE p.recipe_version_id=p_version AND q.description IS DISTINCT FROM p.qualification_description
$$;

-- Preview voor de bestaande persoonlijke conceptscopecapability.
-- De toekomstige releasefunctie roept de interne poort opnieuw aan onder
-- dezelfde receptlock als de statusovergang, nooit op basis van clientdata.
CREATE FUNCTION recipe_release_validation(p_version uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE product uuid; n integer; state text; blockers jsonb;
BEGIN
 SELECT r.product_id INTO product FROM master_recipe_version v JOIN master_recipe r ON r.id=v.master_recipe_id WHERE v.id=p_version;
 PERFORM recipe_draft_actor(product);
 SELECT change_no,lifecycle_status INTO n,state FROM master_recipe_version WHERE id=p_version FOR SHARE;
 SELECT COALESCE(jsonb_agg(to_jsonb(b) ORDER BY b.code,b.record_id),'[]'::jsonb) INTO blockers FROM recipe_release_blockers(p_version) b;
 RETURN jsonb_build_object('recipe_version_id',p_version,'change_no',n,'lifecycle_status',state,
 'content_valid',jsonb_array_length(blockers)=0,'blockers',blockers);
END $$;

CREATE FUNCTION recipe_assert_release_content(p_version uuid) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE failure text;
BEGIN
 PERFORM 1 FROM master_recipe_version WHERE id=p_version FOR UPDATE;
 SELECT string_agg(DISTINCT code,', ' ORDER BY code) INTO failure FROM recipe_release_blockers(p_version);
 IF failure IS NOT NULL THEN
   RAISE EXCEPTION 'MBR-vrijgave geblokkeerd: %',failure USING ERRCODE='23514';
 END IF;
END $$;

REVOKE ALL ON FUNCTION recipe_release_blockers(uuid),recipe_release_validation(uuid),recipe_assert_release_content(uuid) FROM PUBLIC;
-- Geen statusovergang, vrijgavepermission of uitvoeringsrecht in 0121.
-- De projectkeuzes voor minimale receptstructuur, dimensieloze eenheden,
-- integerafronding en resourcevalidatie worden bij de integrale review getoetst.

-- Migratie 0122: historisch vrijgavebewijs en effectieve geldigheid (#112).
SET search_path = fabriek, public;

-- Formele vrijgave en ingangsdatum zijn afzonderlijke feiten.
-- De eindgrens volgt uit een volgende ingangsdatum of intrekking.
-- Nog geen runtime-insert: de vrijgavebevoegdheid is een open ontwerpkeuze.
CREATE TABLE recipe_release (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 master_recipe_id uuid NOT NULL REFERENCES master_recipe(id),
 recipe_version_id uuid NOT NULL UNIQUE REFERENCES master_recipe_version(id),
 round_id uuid NOT NULL UNIQUE,
 effective_from timestamptz NOT NULL,
 released_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 released_by uuid NOT NULL REFERENCES gebruiker(id),
 reason text NOT NULL CHECK(reason ~ '[^[:space:]]'),
 FOREIGN KEY(round_id,recipe_version_id) REFERENCES recipe_review_round(id,recipe_version_id),
 UNIQUE(master_recipe_id,effective_from),
 CHECK(isfinite(effective_from) AND isfinite(released_at) AND effective_from>=released_at)
);

CREATE TABLE recipe_release_withdrawal (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 release_id uuid NOT NULL UNIQUE REFERENCES recipe_release(id),
 withdrawn_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(withdrawn_at)),
 withdrawn_by uuid NOT NULL REFERENCES gebruiker(id),
 reason text NOT NULL CHECK(reason ~ '[^[:space:]]')
);
CREATE TRIGGER recipe_release_immutable BEFORE UPDATE OR DELETE ON recipe_release
 FOR EACH ROW EXECUTE FUNCTION recipe_review_evidence_immutable();
CREATE TRIGGER recipe_release_withdrawal_immutable BEFORE UPDATE OR DELETE ON recipe_release_withdrawal
 FOR EACH ROW EXECUTE FUNCTION recipe_review_evidence_immutable();

-- Intern selectiemodel. Neem de meest recente geplande ingangsdatum die
-- bereikt is, met expliciete kennisgrens: toekomstige besluiten mogen
-- geen historische selectie achteraf veranderen. Een ingetrokken versie
-- valt niet automatisch terug op een oudere versie.
CREATE FUNCTION recipe_effective_release(p_recipe uuid,p_at timestamptz,p_known_at timestamptz)
RETURNS uuid LANGUAGE sql STABLE SET search_path=pg_catalog,fabriek,pg_temp AS $$
 WITH candidate AS (
   SELECT r.id,r.recipe_version_id FROM recipe_release r
   WHERE r.master_recipe_id=p_recipe AND r.effective_from<=p_at AND r.released_at<=p_known_at
   ORDER BY r.effective_from DESC LIMIT 1
 )
 SELECT c.recipe_version_id FROM candidate c WHERE NOT EXISTS (
   SELECT 1 FROM recipe_release_withdrawal w WHERE w.release_id=c.id
   AND w.withdrawn_at<=p_at AND w.withdrawn_at<=p_known_at
 )
$$;

-- Historische intervallen worden afgeleid, nooit in oude bewijsrecords
-- overschreven. Intrekking voor geplande ingang geeft een leeg interval.
CREATE FUNCTION recipe_release_intervals(p_recipe uuid,p_known_at timestamptz)
RETURNS TABLE(release_id uuid,recipe_version_id uuid,valid_from timestamptz,valid_until timestamptz)
LANGUAGE sql STABLE SET search_path=pg_catalog,fabriek,pg_temp AS $$
 WITH schedule AS (
   SELECT r.id,r.recipe_version_id,r.effective_from,
          lead(r.effective_from) OVER (ORDER BY r.effective_from) AS next_from
   FROM recipe_release r WHERE r.master_recipe_id=p_recipe AND r.released_at<=p_known_at
 )
 SELECT s.id,s.recipe_version_id,s.effective_from,
   CASE WHEN s.next_from IS NULL AND w.withdrawn_at IS NULL THEN NULL::timestamptz
        ELSE greatest(s.effective_from,least(s.next_from,w.withdrawn_at)) END
 FROM schedule s LEFT JOIN recipe_release_withdrawal w ON w.release_id=s.id AND w.withdrawn_at<=p_known_at
$$;

-- Geen eigenaar- of approute openen voordat autorisatie en
-- besluitgebonden bevestiging zijn vastgesteld. Later vervangt de
-- gecontroleerde workflow deze guards; reguliere SQL kan niet vrijgeven.
CREATE FUNCTION recipe_release_closed_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Formele receptvrijgave en intrekking wachten op gecontroleerde besluitworkflow' USING ERRCODE='55000';
END $$;
CREATE TRIGGER recipe_release_closed BEFORE INSERT ON recipe_release
 FOR EACH ROW EXECUTE FUNCTION recipe_release_closed_guard();
CREATE TRIGGER recipe_release_withdrawal_closed BEFORE INSERT ON recipe_release_withdrawal
 FOR EACH ROW EXECUTE FUNCTION recipe_release_closed_guard();

REVOKE ALL ON recipe_release,recipe_release_withdrawal FROM PUBLIC;
REVOKE ALL ON FUNCTION recipe_effective_release(uuid,timestamptz,timestamptz),
 recipe_release_intervals(uuid,timestamptz),recipe_release_closed_guard() FROM PUBLIC;
-- Geen statusovergang, vrijgavepermission, automatische activering of
-- uitvoeringsrecht in 0122. Rollen en definitieve planning volgen.

-- Migratie 0123: D109 persoonlijke formele vrijgave en intrekking.
SET search_path = fabriek, public;

-- Afzonderlijke bevoegdheden in bestaande domeinen, geen persoonlijke grants.
INSERT INTO authorization_permission(code,domain) VALUES
 ('recipe.release','engineering'),
 ('recipe.withdraw.engineering','engineering'),
 ('recipe.withdraw.quality','quality');
INSERT INTO authorization_role_permission(role_code,permission_code) VALUES
 ('engineering_approver','recipe.release'),
 ('engineering_approver','recipe.withdraw.engineering'),
 ('quality_approver','recipe.withdraw.quality');

CREATE FUNCTION recipe_release_actor(p_product uuid,p_withdraw boolean) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; allowed boolean;
BEGIN
 actor:=execution_transaction_actor();
 allowed:=CASE WHEN p_withdraw THEN
   authorization_permits(actor,'recipe.withdraw.engineering',NULL,p_product,NULL)
   OR authorization_permits(actor,'recipe.withdraw.quality',NULL,p_product,NULL)
 ELSE authorization_permits(actor,'recipe.release',NULL,p_product,NULL) END;
 IF p_product IS NULL OR allowed IS NOT TRUE THEN
   RAISE EXCEPTION 'Geen actuele MES-vrijgave- of intrekkingsbevoegdheid' USING ERRCODE='42501';
 END IF;
 RETURN actor;
END $$;

-- Alle vrijgaven binnen dezelfde receptidentiteit worden geserialiseerd.
-- Conservatief: uitsluitend oplopende revisie/ingangsdatum, en referentie
-- moet de laatste vrijgegeven revisie zijn (ook bij intrekking).
CREATE FUNCTION recipe_release_insert_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v master_recipe_version%ROWTYPE; r recipe_review_round%ROWTYPE;
 product uuid; previous uuid; previous_revision integer; previous_from timestamptz; actor uuid;
BEGIN
 SELECT product_id INTO product FROM master_recipe WHERE id=NEW.master_recipe_id FOR UPDATE;
 actor:=recipe_release_actor(product,false);
 SELECT * INTO STRICT v FROM master_recipe_version WHERE id=NEW.recipe_version_id FOR UPDATE;
 SELECT * INTO STRICT r FROM recipe_review_round WHERE id=NEW.round_id;
 IF v.master_recipe_id<>NEW.master_recipe_id OR r.recipe_version_id<>v.id OR v.lifecycle_status<>'approved'
   OR r.change_no<>v.change_no OR r.snapshot->'current' IS DISTINCT FROM recipe_review_snapshot(v.id)
   OR EXISTS (SELECT 1 FROM recipe_review_round x WHERE x.recipe_version_id=v.id AND x.round_no>r.round_no) THEN
   RAISE EXCEPTION 'Actuele goedgekeurde MBR-ronde vereist' USING ERRCODE='40001';
 END IF;
 IF actor IS DISTINCT FROM NEW.released_by OR actor=ANY(r.contributors) THEN
   RAISE EXCEPTION 'Onafhankelijke persoonlijke vrijgever vereist' USING ERRCODE='42501';
 END IF;
 IF EXISTS (SELECT 1 FROM unnest(r.required_reviews) d WHERE NOT EXISTS (
   SELECT 1 FROM recipe_review_decision x WHERE x.round_id=r.id AND x.domain=d AND x.decision='approve'
 )) THEN RAISE EXCEPTION 'Niet alle verplichte beoordelingen zijn goedgekeurd' USING ERRCODE='23514'; END IF;
 SELECT z.recipe_version_id,p.revision,z.effective_from INTO previous,previous_revision,previous_from
 FROM recipe_release z JOIN master_recipe_version p ON p.id=z.recipe_version_id
 WHERE z.master_recipe_id=v.master_recipe_id ORDER BY z.effective_from DESC LIMIT 1;
 IF r.baseline_version_id IS DISTINCT FROM previous OR
    (previous IS NOT NULL AND (v.revision<=previous_revision OR NEW.effective_from<=previous_from)) THEN
   RAISE EXCEPTION 'Vrijgave vereist laatste vrijgegeven referentie en oplopende revisie en ingangsdatum' USING ERRCODE='23514';
 END IF;
 IF r.baseline_version_id IS NOT NULL AND
    r.snapshot->'baseline' IS DISTINCT FROM recipe_review_snapshot(r.baseline_version_id) THEN
   RAISE EXCEPTION 'Referentie-inhoud wijkt af' USING ERRCODE='40001';
 END IF;
 IF NEW.released_at IS NULL OR NEW.effective_from IS NULL OR NOT isfinite(NEW.effective_from)
   OR NEW.effective_from<NEW.released_at THEN
   RAISE EXCEPTION 'Geldige niet-teruggedateerde ingangsdatum vereist' USING ERRCODE='23514';
 END IF;
 PERFORM recipe_assert_release_content(v.id);
 RETURN NEW;
END $$;

CREATE FUNCTION recipe_withdrawal_insert_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE rel recipe_release%ROWTYPE; product uuid; actor uuid;
BEGIN
 SELECT * INTO STRICT rel FROM recipe_release WHERE id=NEW.release_id;
 SELECT product_id INTO product FROM master_recipe WHERE id=rel.master_recipe_id FOR UPDATE;
 PERFORM 1 FROM master_recipe_version WHERE id=rel.recipe_version_id FOR UPDATE;
 actor:=recipe_release_actor(product,true);
 IF actor IS DISTINCT FROM NEW.withdrawn_by OR NEW.withdrawn_at<rel.released_at THEN
   RAISE EXCEPTION 'Persoonlijk geldig intrekkingsbesluit vereist' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER recipe_release_closed ON recipe_release;
DROP TRIGGER recipe_release_withdrawal_closed ON recipe_release_withdrawal;
CREATE TRIGGER recipe_release_guard BEFORE INSERT ON recipe_release
 FOR EACH ROW EXECUTE FUNCTION recipe_release_insert_guard();
CREATE TRIGGER recipe_withdrawal_guard BEFORE INSERT ON recipe_release_withdrawal
 FOR EACH ROW EXECUTE FUNCTION recipe_withdrawal_insert_guard();

-- Status released betekent formeel vrijgegeven (eventueel toekomstig).
-- Effectieve vervanging wordt afgeleid uit het geldigheidsinterval;
-- geen timer, geen overschrijving van historische releasegegevens.
CREATE OR REPLACE FUNCTION recipe_lifecycle_header_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE r recipe_review_round%ROWTYPE;
BEGIN
 IF TG_OP='INSERT' THEN
   IF NEW.lifecycle_status IS DISTINCT FROM 'draft' THEN
     RAISE EXCEPTION 'Nieuwe MBR-versie moet een concept zijn' USING ERRCODE='55000';
   END IF;
   RETURN NEW;
 END IF;
 IF NEW.lifecycle_status IS NOT DISTINCT FROM OLD.lifecycle_status THEN
   IF OLD.lifecycle_status<>'draft' THEN
     RAISE EXCEPTION 'MBR-inhoud is alleen wijzigbaar in conceptstatus' USING ERRCODE='55000';
   END IF;
   RETURN NEW;
 END IF;
 SELECT * INTO r FROM recipe_review_round WHERE recipe_version_id=OLD.id ORDER BY round_no DESC LIMIT 1;
 IF NOT FOUND OR r.change_no IS DISTINCT FROM OLD.change_no OR r.snapshot->'current' IS DISTINCT FROM recipe_review_snapshot(OLD.id) THEN
   RAISE EXCEPTION 'Actuele exacte beoordelingsronde vereist' USING ERRCODE='55000';
 END IF;
 IF OLD.lifecycle_status='draft' AND NEW.lifecycle_status='in_review' THEN
   IF EXISTS (SELECT 1 FROM recipe_review_decision WHERE round_id=r.id) THEN
     RAISE EXCEPTION 'Nieuwe beoordelingsronde vereist' USING ERRCODE='55000';
   END IF;
 ELSIF OLD.lifecycle_status='in_review' AND NEW.lifecycle_status='approved' THEN
   IF EXISTS (SELECT 1 FROM unnest(r.required_reviews) d WHERE NOT EXISTS (
     SELECT 1 FROM recipe_review_decision x WHERE x.round_id=r.id AND x.domain=d AND x.decision='approve')) THEN
     RAISE EXCEPTION 'Niet alle verplichte beoordelingen zijn goedgekeurd' USING ERRCODE='55000';
   END IF;
 ELSIF OLD.lifecycle_status='in_review' AND NEW.lifecycle_status='draft' THEN
   IF NOT EXISTS (SELECT 1 FROM recipe_review_decision WHERE round_id=r.id AND decision='reject') THEN
     RAISE EXCEPTION 'Afwijzing vereist' USING ERRCODE='55000';
   END IF;
 ELSIF OLD.lifecycle_status='approved' AND NEW.lifecycle_status='released' THEN
   IF NOT EXISTS (SELECT 1 FROM recipe_release WHERE recipe_version_id=OLD.id AND round_id=r.id) THEN
     RAISE EXCEPTION 'Formeel vrijgavebewijs vereist' USING ERRCODE='55000';
   END IF;
 ELSIF OLD.lifecycle_status='released' AND NEW.lifecycle_status='withdrawn' THEN
   IF NOT EXISTS (SELECT 1 FROM recipe_release z JOIN recipe_release_withdrawal w ON w.release_id=z.id WHERE z.recipe_version_id=OLD.id) THEN
     RAISE EXCEPTION 'Formeel intrekkingsbewijs vereist' USING ERRCODE='55000';
   END IF;
 ELSE
   RAISE EXCEPTION 'MBR-statusovergang nog niet beschikbaar' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION recipe_release_confirmed(p_version uuid,p_round uuid,p_expected integer,p_effective timestamptz,p_reason text,p_password text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; name text; login record; recipe uuid; product uuid; v master_recipe_version%ROWTYPE; r recipe_review_round%ROWTYPE; target uuid; stamp timestamptz;
BEGIN
 actor:=execution_transaction_actor();
 SELECT gebruikersnaam INTO name FROM gebruiker WHERE id=actor AND actief AND NOT gedeeld AND NOT wachtwoord_wijzigen FOR UPDATE;
 IF NOT FOUND OR execution_transaction_actor() IS DISTINCT FROM actor THEN RETURN jsonb_build_object('status','denied'); END IF;
 SELECT m.id,m.product_id INTO recipe,product FROM master_recipe_version x JOIN master_recipe m ON m.id=x.master_recipe_id WHERE x.id=p_version;
 PERFORM recipe_release_actor(product,false);
 PERFORM 1 FROM master_recipe WHERE id=recipe FOR UPDATE;
 SELECT * INTO STRICT v FROM master_recipe_version WHERE id=p_version FOR UPDATE;
 SELECT * INTO r FROM recipe_review_round WHERE id=p_round AND recipe_version_id=p_version;
 IF NOT FOUND OR v.lifecycle_status<>'approved' OR v.change_no IS DISTINCT FROM p_expected OR r.change_no<>v.change_no THEN
   RAISE EXCEPTION 'Actuele goedgekeurde MBR-ronde vereist' USING ERRCODE='40001';
 END IF;
 IF actor=ANY(r.contributors) THEN RAISE EXCEPTION 'Onafhankelijke persoonlijke vrijgever vereist' USING ERRCODE='42501'; END IF;
 IF btrim(coalesce(p_reason,''))='' OR (p_effective IS NOT NULL AND (NOT isfinite(p_effective) OR p_effective<clock_timestamp())) THEN
   RAISE EXCEPTION 'Reden en niet-teruggedateerde ingangsdatum vereist' USING ERRCODE='23514';
 END IF;
 PERFORM recipe_assert_release_content(p_version);
 SELECT * INTO login FROM inloggen(name,p_password,NULL);
 IF login.wacht_seconden IS NOT NULL THEN RETURN jsonb_build_object('status','locked'); END IF;
 IF login.id IS DISTINCT FROM actor THEN RETURN jsonb_build_object('status','denied'); END IF;
 stamp:=clock_timestamp();
 INSERT INTO recipe_release(master_recipe_id,recipe_version_id,round_id,effective_from,released_at,released_by,reason)
 VALUES(recipe,p_version,p_round,coalesce(p_effective,stamp),stamp,actor,p_reason) RETURNING id INTO target;
 UPDATE master_recipe_version SET lifecycle_status='released' WHERE id=p_version;
 RETURN jsonb_build_object('status','released','release_id',target);
END $$;

CREATE FUNCTION recipe_withdraw_confirmed(p_release uuid,p_reason text,p_password text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; name text; login record; rel recipe_release%ROWTYPE; product uuid; target uuid;
BEGIN
 actor:=execution_transaction_actor();
 SELECT gebruikersnaam INTO name FROM gebruiker WHERE id=actor AND actief AND NOT gedeeld AND NOT wachtwoord_wijzigen FOR UPDATE;
 IF NOT FOUND OR execution_transaction_actor() IS DISTINCT FROM actor THEN RETURN jsonb_build_object('status','denied'); END IF;
 SELECT * INTO rel FROM recipe_release WHERE id=p_release;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende vrijgave' USING ERRCODE='23503'; END IF;
 SELECT product_id INTO product FROM master_recipe WHERE id=rel.master_recipe_id;
 PERFORM recipe_release_actor(product,true);
 PERFORM 1 FROM master_recipe WHERE id=rel.master_recipe_id FOR UPDATE;
 PERFORM 1 FROM master_recipe_version WHERE id=rel.recipe_version_id FOR UPDATE;
 IF EXISTS (SELECT 1 FROM recipe_release_withdrawal WHERE release_id=p_release) THEN
   RAISE EXCEPTION 'Vrijgave is al ingetrokken' USING ERRCODE='23505';
 END IF;
 IF btrim(coalesce(p_reason,''))='' THEN RAISE EXCEPTION 'Intrekkingsreden vereist' USING ERRCODE='23514'; END IF;
 SELECT * INTO login FROM inloggen(name,p_password,NULL);
 IF login.wacht_seconden IS NOT NULL THEN RETURN jsonb_build_object('status','locked'); END IF;
 IF login.id IS DISTINCT FROM actor THEN RETURN jsonb_build_object('status','denied'); END IF;
 INSERT INTO recipe_release_withdrawal(release_id,withdrawn_by,reason)
 VALUES(p_release,actor,p_reason) RETURNING id INTO target;
 UPDATE master_recipe_version SET lifecycle_status='withdrawn' WHERE id=rel.recipe_version_id;
 RETURN jsonb_build_object('status','withdrawn','withdrawal_id',target);
END $$;
REVOKE ALL ON FUNCTION recipe_release_actor(uuid,boolean),recipe_release_insert_guard(),recipe_withdrawal_insert_guard(),
 recipe_release_confirmed(uuid,uuid,integer,timestamptz,text,text),recipe_withdraw_confirmed(uuid,text,text) FROM PUBLIC;
-- De selector is nog intern; CR-koppeling volgt fase 6.

-- Migratie 0124: persoonlijke read-only toegang tot MBR-beoordelingsbewijs.
SET search_path = fabriek, public;

CREATE FUNCTION recipe_review_read_permitted(p_actor uuid,p_product uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,fabriek,pg_temp AS $$
 SELECT p_product IS NOT NULL AND EXISTS (
   SELECT 1 FROM unnest(ARRAY['recipe.draft.manage','recipe.review.engineering',
     'recipe.review.production','recipe.review.quality','recipe.release',
     'recipe.withdraw.engineering','recipe.withdraw.quality']) AS perm(code)
   WHERE authorization_permits(p_actor,perm.code,NULL,p_product,NULL) IS TRUE
 )
$$;

-- Geen algemene toegang tot concepten. Alleen versies waarvoor een
-- beoordelingsronde bestaat; actuele inhoud uitsluitend voor auteurs via
-- bestaande conceptinterface. Historische rondes blijven raadpleegbaar.
CREATE FUNCTION recipe_review_inbox(p_product uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; result jsonb;
BEGIN
 actor:=execution_transaction_actor();
 IF recipe_review_read_permitted(actor,p_product) IS NOT TRUE THEN
   RAISE EXCEPTION 'Geen actuele MES-beoordelingsleestoegang' USING ERRCODE='42501';
 END IF;
 SELECT COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.recipe_code,q.revision DESC),'[]'::jsonb) INTO result
 FROM (
 SELECT m.id AS master_recipe_id,m.code AS recipe_code,v.id AS recipe_version_id,v.revision,
 v.lifecycle_status,r.id AS round_id,r.round_no,r.change_no,
 r.snapshot->'current'->'header'->>'name' AS name,r.required_reviews,
 ARRAY(SELECT d.domain FROM recipe_review_decision d WHERE d.round_id=r.id AND d.decision='approve' ORDER BY d.domain) AS approved_domains,
 ARRAY(SELECT d FROM unnest(r.required_reviews) d
       WHERE v.lifecycle_status='in_review' AND actor<>ALL(r.contributors)
       AND authorization_permits(actor,'recipe.review.'||d,NULL,p_product,NULL) IS TRUE
       AND NOT EXISTS (SELECT 1 FROM recipe_review_decision x WHERE x.round_id=r.id AND (x.domain=d OR x.reviewer_id=actor))
       ORDER BY d) AS my_pending_domains
 FROM master_recipe m JOIN master_recipe_version v ON v.master_recipe_id=m.id
 JOIN LATERAL (SELECT rr.* FROM recipe_review_round rr WHERE rr.recipe_version_id=v.id ORDER BY rr.round_no DESC LIMIT 1) r ON true
 WHERE m.product_id=p_product
 ) q;
 RETURN result;
END $$;

-- Exacte snapshot als TEXT: de JSONB-getallen mogen niet ongemerkt door
-- JavaScript Number worden afgerond. HTTP retourneert deze tekst expliciet.
CREATE FUNCTION recipe_review_dossier(p_round uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; product uuid; r recipe_review_round%ROWTYPE; v master_recipe_version%ROWTYPE; result jsonb;
BEGIN
 actor:=execution_transaction_actor();
 SELECT m.product_id INTO product FROM recipe_review_round rr JOIN master_recipe_version x ON x.id=rr.recipe_version_id
 JOIN master_recipe m ON m.id=x.master_recipe_id WHERE rr.id=p_round;
 IF recipe_review_read_permitted(actor,product) IS NOT TRUE THEN
   RAISE EXCEPTION 'Geen actuele MES-beoordelingsleestoegang' USING ERRCODE='42501';
 END IF;
 SELECT * INTO STRICT r FROM recipe_review_round WHERE id=p_round;
 SELECT * INTO STRICT v FROM master_recipe_version WHERE id=r.recipe_version_id FOR SHARE;
 SELECT jsonb_build_object(
 'round', (to_jsonb(r)-'snapshot') || jsonb_build_object('snapshot_text',r.snapshot::text),
 'lifecycle_status',v.lifecycle_status,
 'is_current',v.lifecycle_status IN ('in_review','approved','released','withdrawn')
     AND v.change_no=r.change_no
     AND NOT EXISTS (SELECT 1 FROM recipe_review_round x WHERE x.recipe_version_id=v.id AND x.round_no>r.round_no),
 'decisions',COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.decided_at,d.id) FROM recipe_review_decision d WHERE d.round_id=r.id),'[]'::jsonb),
 'release',(SELECT to_jsonb(z) FROM recipe_release z WHERE z.round_id=r.id),
 'withdrawal',(SELECT to_jsonb(w) FROM recipe_release z JOIN recipe_release_withdrawal w ON w.release_id=z.id WHERE z.round_id=r.id)
 ) INTO result;
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION recipe_review_read_permitted(uuid,uuid),recipe_review_inbox(uuid),recipe_review_dossier(uuid) FROM PUBLIC;
-- Uitsluitend leestoegang; conceptmutaties en besluiten blijven onder de
-- bestaande afzonderlijke capabilities en herbevestiging.

-- Migratie 0125: vrijgavevalidatie voor bevoegde beoordelaars.
SET search_path = fabriek, public;

CREATE OR REPLACE FUNCTION recipe_release_validation(p_version uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE product uuid; actor uuid; n integer; state text; blockers jsonb;
BEGIN
 actor:=execution_transaction_actor();
 SELECT r.product_id INTO product FROM master_recipe_version v JOIN master_recipe r ON r.id=v.master_recipe_id WHERE v.id=p_version;
 IF product IS NULL THEN
   RAISE EXCEPTION 'Geen actuele MES-vrijgaveleestoegang' USING ERRCODE='42501';
 END IF;
 SELECT change_no,lifecycle_status INTO n,state FROM master_recipe_version WHERE id=p_version FOR SHARE;
 -- Geen leestoegang tot niet-ingediende of opnieuw geopende concepten
 -- voor beoordelaars; auteurs behouden hun bestaande conceptrecht.
 IF authorization_permits(actor,'recipe.draft.manage',NULL,product,NULL) IS NOT TRUE AND
   (state='draft' OR recipe_review_read_permitted(actor,product) IS NOT TRUE OR
    NOT EXISTS (SELECT 1 FROM recipe_review_round WHERE recipe_version_id=p_version)) THEN
   RAISE EXCEPTION 'Geen actuele MES-vrijgaveleestoegang' USING ERRCODE='42501';
 END IF;
 SELECT COALESCE(jsonb_agg(to_jsonb(b) ORDER BY b.code,b.record_id),'[]'::jsonb) INTO blockers FROM recipe_release_blockers(p_version) b;
 RETURN jsonb_build_object('recipe_version_id',p_version,'change_no',n,'lifecycle_status',state,
 'content_valid',jsonb_array_length(blockers)=0,'blockers',blockers);
END $$;
REVOKE ALL ON FUNCTION recipe_release_validation(uuid) FROM PUBLIC;
-- Bestaande mes_app-executerechten blijven behouden; geen nieuwe grants.

COMMIT;
