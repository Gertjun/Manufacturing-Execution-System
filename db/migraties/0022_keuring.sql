-- Migratie 0022 (versie 0.37.0): metingen van Kwaliteit en keuring (#64, D58).
-- Per veld wie meet: de operator (productie) of Kwaliteit. Een stap met velden van Kwaliteit wacht na het afronden
-- op Kwaliteit: meten, dan vrijgeven, herbewerken of afkeuren. Pas na de vrijgave gaat de batch of het lot verder.
-- Bestaande velden blijven 'productie'; er verandert niets tot de beheerder een veld op Kwaliteit zet.
SET search_path = fabriek, public;

ALTER TABLE veld ADD COLUMN gemeten_door text NOT NULL DEFAULT 'productie' CHECK (gemeten_door IN ('productie','kwaliteit'));
ALTER TABLE melding DROP CONSTRAINT melding_soort_check;
ALTER TABLE melding ADD CONSTRAINT melding_soort_check
    CHECK (soort IN ('buiten_grens','beoordeling','vrijgegeven','afgekeurd','lot_afgeweken','storing','herbewerking','keuring'));

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
$$;

CREATE OR REPLACE FUNCTION operator_van_account(p_gebruiker uuid) RETURNS uuid LANGUAGE plpgsql VOLATILE AS $$
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
    END IF;

    NEW.markering := bereken_markering(NEW.setting, NEW.gemeten, NEW.grens_min, NEW.grens_max,
                                       NEW.tolerantie, NEW.tolerantie_soort);
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION rond_stap_af(p_registratie uuid) RETURNS void LANGUAGE plpgsql AS $$
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
    UPDATE stapregistratie SET status = 'afgerond', afgerond_op = apparaat_moment(gestart_op)
     WHERE id = p_registratie AND status = 'open';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Registratie bestaat niet of is al afgerond';
    END IF;
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
        -- Meet Kwaliteit in die stap, dan pas gereed na de vrijgave (beslis_keuring, sinds 0022).
        IF NEW.processtap_id = v_laatste AND NOT stap_meet_kwaliteit(NEW.processtap_id) THEN
            UPDATE lot SET status = 'gereed' WHERE id = NEW.lot_id;
        END IF;
    END IF;
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION batch_stap_gedaan(p_batch uuid, p_stap uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
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
        RAISE EXCEPTION 'Stap % staat nog open', v_stap.code;
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

CREATE OR REPLACE FUNCTION plan_stand(p_plan uuid) RETURNS text LANGUAGE sql STABLE AS $$
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

-- Elke functie werkt in schema fabriek (zoals in 0001).
DO $$
DECLARE f record;
BEGIN
    FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'fabriek' LOOP
        EXECUTE format('ALTER FUNCTION %s SET search_path = fabriek, public', f.sig);
    END LOOP;
END $$;
