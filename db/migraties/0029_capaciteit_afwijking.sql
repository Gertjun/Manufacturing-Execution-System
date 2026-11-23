-- Migratie 0029 (versie 0.48.0): capaciteit alleen per stap en product, met afwijkende dagen (D69).
-- De capaciteit per weekdag voor de hele fabriek (0.16.0, D36) vervalt: bij verschillende producten
-- zegt één getal per dag weinig. Hoeveel batches van een product per dag kunnen starten, volgt uit de
-- capaciteit van de eerste stap van zijn route (capaciteit_stap, D55). Afwijkende dagen gelden nu voor
-- een product en/of een stap, als percentage van de gewone capaciteit.
-- Alleen de planning gebruikt dit; het invoerscherm (ook een ouder invoerscherm) merkt er niets van.
SET search_path = fabriek, public;

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
-- en de reden van een afwijking. Verder als in 0.30.0.
DROP FUNCTION stap_belasting(uuid, date);
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

-- Afwijkende dagen van vóór 0.48.0 overnemen, voor alle stappen en producten: het aantal batches van die dag
-- als percentage van de capaciteit op die weekdag (0 batches = 0 %, geen productie).
INSERT INTO capaciteit_afwijking (van, tot, procent, reden)
SELECT d.dag, d.dag,
       CASE WHEN d.max_batches = 0 OR coalesce(w.max_batches, 0) = 0 THEN 0
            ELSE least(100, round(100.0 * d.max_batches / w.max_batches))::int END,
       left(d.reden, 200)
  FROM capaciteit_dag d LEFT JOIN capaciteit w ON w.weekdag = extract(isodow FROM d.dag)::int
 WHERE d.actief AND length(btrim(d.reden)) >= 2;

-- De capaciteit per weekdag voor de hele fabriek vervalt. Het logboek houdt de oude wijzigingen.
DROP FUNCTION capaciteit_op(date);
DROP TABLE capaciteit_dag;
DROP TABLE capaciteit;

DO $$
DECLARE f record;
BEGIN
    FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'fabriek' LOOP
        EXECUTE format('ALTER FUNCTION %s SET search_path = fabriek, public', f.sig);
    END LOOP;
END $$;
