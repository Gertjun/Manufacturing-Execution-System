-- Migratie 0146: interne werkstation-middelenkoppeling (#115.4b).
SET search_path = fabriek, public;

CREATE TABLE equipment_workstation (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pc_id uuid NOT NULL REFERENCES pc(id),
    equipment_id uuid NOT NULL REFERENCES equipment(id),
    opened_by uuid NOT NULL REFERENCES gebruiker(id),
    opened_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(opened_at)),
    open_reason text NOT NULL CHECK (open_reason ~ '[^[:space:]]' AND length(open_reason)<=2000),
    closed_by uuid REFERENCES gebruiker(id),
    closed_at timestamptz,
    close_reason text,
    CHECK (
        (closed_by IS NULL AND closed_at IS NULL AND close_reason IS NULL)
        OR (closed_by IS NOT NULL AND closed_at IS NOT NULL AND close_reason IS NOT NULL
            AND isfinite(closed_at) AND closed_at>=opened_at
            AND close_reason ~ '[^[:space:]]' AND length(close_reason)<=2000)
    )
);
CREATE UNIQUE INDEX equipment_workstation_active_pair
    ON equipment_workstation(pc_id,equipment_id) WHERE closed_at IS NULL;
CREATE INDEX equipment_workstation_pc_history_idx ON equipment_workstation(pc_id,equipment_id,opened_at);
CREATE INDEX equipment_workstation_equipment_idx ON equipment_workstation(equipment_id);

CREATE FUNCTION equipment_workstation_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_active boolean; v_latest_close timestamptz;
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION 'Werkstationhistorie mag niet worden verwijderd' USING ERRCODE='55000';
    END IF;
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'Werkstationkoppeling vereist read committed' USING ERRCODE='25001';
    END IF;
    IF TG_OP='UPDATE' THEN
        IF (NEW.id,NEW.pc_id,NEW.equipment_id,NEW.opened_by,NEW.opened_at,NEW.open_reason)
            IS DISTINCT FROM (OLD.id,OLD.pc_id,OLD.equipment_id,OLD.opened_by,OLD.opened_at,OLD.open_reason)
            OR OLD.closed_at IS NOT NULL OR NEW.closed_at IS NULL THEN
            RAISE EXCEPTION 'Werkstationkoppeling mag uitsluitend eenmaal worden afgesloten' USING ERRCODE='55000';
        END IF;
    END IF;
    SELECT actief INTO v_active FROM pc WHERE id=NEW.pc_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Onbekend werkstation' USING ERRCODE='23503';
    END IF;
    IF TG_OP='INSERT' THEN
        IF NOT v_active THEN
            RAISE EXCEPTION 'Inactief werkstation kan niet worden gekoppeld' USING ERRCODE='23514';
        END IF;
        IF NEW.closed_by IS NOT NULL OR NEW.closed_at IS NOT NULL OR NEW.close_reason IS NOT NULL THEN
            RAISE EXCEPTION 'Nieuwe werkstationkoppeling moet open zijn' USING ERRCODE='23514';
        END IF;
        NEW.opened_at:=clock_timestamp();
        SELECT max(closed_at) INTO v_latest_close FROM equipment_workstation
            WHERE pc_id=NEW.pc_id AND equipment_id=NEW.equipment_id;
        IF v_latest_close IS NOT NULL AND NEW.opened_at<v_latest_close THEN
            RAISE EXCEPTION 'Serverklok ligt voor laatste afsluiting' USING ERRCODE='23514';
        END IF;
    ELSE
        NEW.closed_at:=clock_timestamp();
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER equipment_workstation_guard
    BEFORE INSERT OR UPDATE OR DELETE ON equipment_workstation
    FOR EACH ROW EXECUTE FUNCTION equipment_workstation_guard();

REVOKE ALL ON equipment_workstation FROM PUBLIC;
REVOKE ALL ON FUNCTION equipment_workstation_guard() FROM PUBLIC;
