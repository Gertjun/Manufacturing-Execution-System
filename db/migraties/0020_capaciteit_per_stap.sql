-- Migratie 0020 (versie 0.30.0): capaciteit per stap en product (D55, #53).
-- Alleen nieuwe tabel en functies; er hoeft niemand iets te doen.
SET search_path = fabriek, public;

-- Capaciteit per stap en product (sinds migratie 0020, D55): hoeveel items een stap per dag aankan.
-- Een regel zonder product geldt voor elk product zonder eigen regel. Bij gemengde producten telt elk item
-- voor zijn deel: 6 van A (max 8) en 1 van B (max 3) = 6/8 + 1/3 = 108 %.
CREATE TABLE capaciteit_stap (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    processtap_id  uuid NOT NULL REFERENCES processtap(id),
    product_id     uuid REFERENCES product(id),
    max_per_dag    int  NOT NULL CHECK (max_per_dag BETWEEN 1 AND 500),
    UNIQUE NULLS NOT DISTINCT (processtap_id, product_id)
);
CREATE TRIGGER capaciteit_stap_log BEFORE INSERT OR UPDATE OR DELETE ON capaciteit_stap
    FOR EACH ROW EXECUTE FUNCTION log_config();

-- De capaciteit van een stap voor een product: eigen regel, anders de regel voor alle producten (NULL = niet ingesteld).
CREATE FUNCTION capaciteit_stap_voor(p_stap uuid, p_product uuid) RETURNS int LANGUAGE sql STABLE AS $$
    SELECT coalesce((SELECT max_per_dag FROM capaciteit_stap WHERE processtap_id = p_stap AND product_id = p_product),
                    (SELECT max_per_dag FROM capaciteit_stap WHERE processtap_id = p_stap AND product_id IS NULL))
$$;

-- Wat er op een dag in een stap gepland is, per product, met de capaciteit. Telt de Planning per stap, plus
-- de batches die die dag starten volgens de weekplanning als dit hun eerste stap is (en ze niet al in deze stap
-- gepland staan). 'van_week' = hoeveel daarvan uit de weekplanning komen.
CREATE FUNCTION stap_belasting(p_stap uuid, p_dag date)
RETURNS TABLE (product_id uuid, aantal int, van_week int, max_per_dag int) LANGUAGE sql STABLE AS $$
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
    SELECT i.product_id, count(*)::int, count(*) FILTER (WHERE i.van_week)::int, capaciteit_stap_voor(p_stap, i.product_id)
      FROM items i GROUP BY i.product_id
$$;

CREATE OR REPLACE FUNCTION log_config() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_oud   jsonb;
    v_nieuw jsonb;
BEGIN
    IF TG_OP = 'DELETE' AND TG_TABLE_NAME NOT IN ('pc_stap', 'product_stap', 'veld_product', 'capaciteit_stap') THEN
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

-- Elke functie werkt in schema fabriek (zoals in 0001).
DO $$
DECLARE f record;
BEGIN
    FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'fabriek' LOOP
        EXECUTE format('ALTER FUNCTION %s SET search_path = fabriek, public', f.sig);
    END LOOP;
END $$;
