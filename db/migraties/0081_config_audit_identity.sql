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
