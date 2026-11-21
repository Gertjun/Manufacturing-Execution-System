-- Migratie 0024 (versie 0.40.0): nainvoeren na papier (#75, D60).
-- Lag de invoer stil, dan registreert de ploeg op papier. Een ploegleider of beheerder voert de stap daarna in
-- met de tijden van het papier (tot 7 dagen terug), met een reden; zichtbaar als nageleverd en in het logboek.
-- Alleen nieuwe kolommen en een nieuwe functie: oudere invoerschermen merken er niets van.
SET search_path = fabriek, public;

ALTER TABLE stapregistratie ADD COLUMN nageleverd_door uuid REFERENCES gebruiker(id);
ALTER TABLE stapregistratie ADD COLUMN nageleverd_reden text;
ALTER TABLE stapregistratie ADD COLUMN nageleverd_op timestamptz;
ALTER TABLE stapregistratie ADD CHECK ((nageleverd_door IS NULL) = (nageleverd_reden IS NULL));

CREATE OR REPLACE VIEW lotpaspoort AS
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

-- Elke functie werkt in schema fabriek (zoals in 0001).
DO $$
DECLARE f record;
BEGIN
    FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'fabriek' LOOP
        EXECUTE format('ALTER FUNCTION %s SET search_path = fabriek, public', f.sig);
    END LOOP;
END $$;
