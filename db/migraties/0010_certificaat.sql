-- Migratie 0010 (versie 0.17.0): certificaat per lot.
-- Velden die op het certificaat komen, bedrijfsgegevens voor de kop, en een register van uitgegeven
-- certificaten (genummerd, met de inhoud zoals die is uitgegeven, zodat een herdruk precies gelijk is).
SET search_path = fabriek, public;

ALTER TABLE veld ADD COLUMN op_certificaat boolean NOT NULL DEFAULT false;

CREATE TABLE instelling (
    id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sleutel  text NOT NULL UNIQUE CHECK (sleutel ~ '^[a-z_]{1,40}$'),
    waarde   text NOT NULL
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

ALTER FUNCTION controleer_certificaat() SET search_path = fabriek, public;
