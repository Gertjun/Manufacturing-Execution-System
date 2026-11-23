-- Migratie 0032 (versie 0.52.0): conflicten bij gelijktijdige invoer (#85, D75).
-- Vullen twee mensen hetzelfde veld of dezelfde grondstof van een stap in (op twee pc's, of later uit een offline
-- wachtrij), dan weigerde de server de tweede invoer. Nu blijft de eerste staan en wordt de tweede als conflict
-- bewaard, met een melding; een ploegleider (of Kwaliteit bij een veld van Kwaliteit) kiest welke blijft.
-- Dezelfde waarde nog eens invoeren is geen conflict. Oudere invoerschermen: niets nodig (de API antwoordt nu
-- met de stand van de stap in plaats van een weigering).
SET search_path = fabriek, public;

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

ALTER TABLE melding DROP CONSTRAINT melding_soort_check;
ALTER TABLE melding ADD CONSTRAINT melding_soort_check
    CHECK (soort IN ('buiten_grens','beoordeling','vrijgegeven','afgekeurd','lot_afgeweken','storing','herbewerking','keuring','conflict'));

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

DO $$
DECLARE f record;
BEGIN
    FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'fabriek' LOOP
        EXECUTE format('ALTER FUNCTION %s SET search_path = fabriek, public', f.sig);
    END LOOP;
END $$;
