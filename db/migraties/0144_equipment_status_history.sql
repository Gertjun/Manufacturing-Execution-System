-- Migratie 0144: interne technische middelenstatus (#115.3b).
SET search_path = fabriek, public;

CREATE TABLE equipment_status_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    equipment_id uuid NOT NULL REFERENCES equipment(id),
    revision integer NOT NULL CHECK (revision>0),
    status text NOT NULL CHECK (status IN ('blocked','available')),
    reason text NOT NULL CHECK (reason ~ '[^[:space:]]' AND length(reason)<=2000),
    created_by uuid NOT NULL REFERENCES gebruiker(id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(created_at)),
    UNIQUE (equipment_id,revision)
);

-- Dezelfde middelrij serialiseert alle statusovergangen.
CREATE FUNCTION equipment_status_history_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE previous_revision integer; previous_status text;
BEGIN
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'Middelenstatus vereist read committed' USING ERRCODE='25001';
    END IF;
    PERFORM id FROM equipment WHERE id=NEW.equipment_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Onbekend middel' USING ERRCODE='23503';
    END IF;
    SELECT revision,status INTO previous_revision,previous_status
        FROM equipment_status_history WHERE equipment_id=NEW.equipment_id
        ORDER BY revision DESC LIMIT 1;
    IF NEW.revision::bigint IS DISTINCT FROM coalesce(previous_revision,0)::bigint+1 THEN
        RAISE EXCEPTION 'Ongeldige of verouderde statusrevisie' USING ERRCODE='40001';
    END IF;
    IF previous_status IS NOT NULL AND NEW.status=previous_status THEN
        RAISE EXCEPTION 'Middelenstatus is al geregistreerd' USING ERRCODE='23514';
    END IF;
    NEW.created_at:=clock_timestamp();
    RETURN NEW;
END $$;
CREATE FUNCTION equipment_status_history_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
    RAISE EXCEPTION 'Middelenstatushistorie is onveranderlijk' USING ERRCODE='55000';
END $$;
CREATE TRIGGER equipment_status_history_guard BEFORE INSERT ON equipment_status_history
    FOR EACH ROW EXECUTE FUNCTION equipment_status_history_guard();
CREATE TRIGGER equipment_status_history_immutable BEFORE UPDATE OR DELETE ON equipment_status_history
    FOR EACH ROW EXECUTE FUNCTION equipment_status_history_immutable();

REVOKE ALL ON equipment_status_history FROM PUBLIC;
REVOKE ALL ON FUNCTION equipment_status_history_guard(),equipment_status_history_immutable() FROM PUBLIC;
