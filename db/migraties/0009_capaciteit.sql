-- Migratie 0009 (versie 0.16.0): capaciteit in de planning.
-- Hoeveel batches de fabriek per dag aankan: per weekdag, met uitzonderingen voor een bepaalde datum.
-- Plannen boven de capaciteit kan wel, maar de planner krijgt een waarschuwing.
SET search_path = fabriek, public;

CREATE TABLE capaciteit (
    weekdag      int PRIMARY KEY CHECK (weekdag BETWEEN 1 AND 7),  -- 1 = maandag (ISO)
    max_batches  int NOT NULL CHECK (max_batches BETWEEN 0 AND 500),
    id           uuid NOT NULL UNIQUE DEFAULT gen_random_uuid()
);
CREATE TRIGGER capaciteit_log BEFORE INSERT OR UPDATE OR DELETE ON capaciteit
    FOR EACH ROW EXECUTE FUNCTION log_config();

CREATE TABLE capaciteit_dag (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dag          date NOT NULL UNIQUE,
    max_batches  int NOT NULL CHECK (max_batches BETWEEN 0 AND 500),
    reden        text NOT NULL CHECK (length(btrim(reden)) > 0),
    actief       boolean NOT NULL DEFAULT true
);
CREATE TRIGGER capaciteit_dag_log BEFORE INSERT OR UPDATE OR DELETE ON capaciteit_dag
    FOR EACH ROW EXECUTE FUNCTION log_config();

-- Capaciteit op een dag: de uitzondering als die er is, anders die van de weekdag (NULL = niet ingesteld).
CREATE FUNCTION capaciteit_op(p_dag date) RETURNS int LANGUAGE sql STABLE AS $$
    SELECT coalesce((SELECT max_batches FROM capaciteit_dag WHERE dag = p_dag AND actief),
                    (SELECT max_batches FROM capaciteit WHERE weekdag = extract(isodow FROM p_dag)::int))
$$;

ALTER FUNCTION capaciteit_op(date) SET search_path = fabriek, public;
