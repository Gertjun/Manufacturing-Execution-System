-- Migratie 0030 (versie 0.49.0): capaciteit alleen per product, uit de route (D71, #81).
-- Elke stap uit de route van een actief product hoort een eigen capaciteit te hebben; een stap zonder
-- capaciteit staat in Planning → Capaciteit als "nog invullen". De regel "voor alle producten" vervalt:
-- die schatte de capaciteit voor producten waarvoor niemand iets had ingevuld. Bestaande regels voor alle
-- producten worden een regel per product (alleen voor producten met die stap in hun route en zonder eigen regel).
-- Alleen de planning gebruikt dit; het invoerscherm (ook een ouder invoerscherm) merkt er niets van.
SET search_path = fabriek, public;

INSERT INTO capaciteit_stap (processtap_id, product_id, max_per_dag)
SELECT c.processtap_id, p.id, c.max_per_dag
  FROM capaciteit_stap c CROSS JOIN product p
 WHERE c.product_id IS NULL AND p.actief AND in_route(p.id, c.processtap_id)
   AND NOT EXISTS (SELECT 1 FROM capaciteit_stap x WHERE x.processtap_id = c.processtap_id AND x.product_id = p.id);
DELETE FROM capaciteit_stap WHERE product_id IS NULL;
ALTER TABLE capaciteit_stap ALTER COLUMN product_id SET NOT NULL;

-- De capaciteit van een stap voor een product (NULL = nog niet ingevuld).
CREATE OR REPLACE FUNCTION capaciteit_stap_voor(p_stap uuid, p_product uuid) RETURNS int LANGUAGE sql STABLE AS $$
    SELECT max_per_dag FROM capaciteit_stap WHERE processtap_id = p_stap AND product_id = p_product
$$;

-- Per actief product elke stap van zijn route met de capaciteit; max_per_dag NULL = nog invullen (#81).
CREATE VIEW capaciteit_route AS
SELECT p.id AS product_id, r.processtap_id, r.plek, c.max_per_dag
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
