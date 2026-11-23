-- Migratie 0035 (versie 0.57.0): capaciteit in kilogram (#90, D80).
-- Elk product krijgt een gewicht per batch (een lot = 4 batches); de capaciteit per stap staat in kg per dag.
-- Bestaande regels in stuks blijven gelden tot ze in kilogram zijn ingevuld. Oudere invoerschermen: niets nodig.
SET search_path = fabriek, public;

-- Capaciteit in kilogram (sinds 0035, #90, D80). Een product heeft een vast gewicht per batch (voor de pilot;
-- later mogelijk per batch); een lot weegt 4 batches. De capaciteit per stap staat in kg per dag; per uur en per
-- maand worden ervan afgeleid met de uren van de diensten en het gemiddelde aantal dagen in een maand.
ALTER TABLE product ADD COLUMN batchgewicht_kg numeric CHECK (batchgewicht_kg > 0 AND batchgewicht_kg <= 100000);
ALTER TABLE capaciteit_stap ADD COLUMN kg_per_dag numeric CHECK (kg_per_dag > 0 AND kg_per_dag <= 100000000);
ALTER TABLE capaciteit_stap ALTER COLUMN max_per_dag DROP NOT NULL;
ALTER TABLE capaciteit_stap ADD CONSTRAINT capaciteit_stap_ingevuld CHECK (kg_per_dag IS NOT NULL OR max_per_dag IS NOT NULL);

-- Gewicht van één item in een stap: een batch, of een lot (4 batches). NULL = gewicht nog niet ingevuld.
CREATE FUNCTION gewicht_per_item(p_product uuid, p_stap uuid) RETURNS numeric LANGUAGE sql STABLE AS $$
    SELECT p.batchgewicht_kg * CASE WHEN s.niveau = 'lot' THEN 4 ELSE 1 END
      FROM product p, processtap s WHERE p.id = p_product AND s.id = p_stap
$$;

-- Productie-uren per dag: de actieve diensten samen (standaard 24).
CREATE FUNCTION productie_uren_per_dag() RETURNS numeric LANGUAGE sql STABLE AS $$
    SELECT coalesce((SELECT sum(extract(epoch FROM CASE WHEN eindigt > begint THEN eindigt - begint
                                                        ELSE eindigt - begint + interval '24 hours' END)) / 3600
                       FROM ploeg WHERE actief), 24)::numeric
$$;

CREATE OR REPLACE FUNCTION capaciteit_stap_voor(p_stap uuid, p_product uuid) RETURNS int LANGUAGE sql STABLE AS $$
    -- Sinds 0035 (#90, D80) in kilogram: hoeveel batches of lots per dag passen, met het gewicht per batch van
    -- het product (een lot = 4 batches). Minstens 1; NULL als het gewicht nog niet is ingevuld. Een oude
    -- regel zonder kilogram (van vóór 0035) telt nog in stuks.
    SELECT CASE WHEN c.kg_per_dag IS NULL THEN c.max_per_dag
                WHEN gewicht_per_item(p_product, p_stap) IS NULL THEN NULL
                ELSE greatest(1, floor(c.kg_per_dag / gewicht_per_item(p_product, p_stap)))::int END
      FROM capaciteit_stap c WHERE c.processtap_id = p_stap AND c.product_id = p_product
$$;

CREATE OR REPLACE VIEW capaciteit_route AS
SELECT p.id AS product_id, r.processtap_id, r.plek, capaciteit_stap_voor(r.processtap_id, p.id) AS max_per_dag,
       c.kg_per_dag, c.max_per_dag AS stuks_per_dag
  FROM product p
 CROSS JOIN LATERAL route(p.id) r
  LEFT JOIN capaciteit_stap c ON c.processtap_id = r.processtap_id AND c.product_id = p.id
 WHERE p.actief;

DO $$
DECLARE f record;
BEGIN
    FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'fabriek' LOOP
        EXECUTE format('ALTER FUNCTION %s SET search_path = fabriek, public', f.sig);
    END LOOP;
END $$;
