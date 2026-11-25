-- Migratie 0113: statische fysische validatie van schaalformules (D106/#141).
SET search_path = fabriek, public;

-- Dimensies worden afgeleid, niet door de client aangeleverd. Exacte
-- eenheidsidentiteit blijft behouden voor add/subtract. Afgeleide
-- producten/quotiënten/machten zijn uitsluitend dimensioneel bewezen;
-- eenhedenfactoren en afgeleide grootheidsemantiek vergen een aparte
-- vrijgavepoort. Geen numerieke evaluatie of impliciete conversie.
CREATE FUNCTION recipe_scaling_expression_physical_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE
 token jsonb; op text; inp record; outp record;
 stack jsonb[]:=ARRAY[]::jsonb[]; n integer:=0;
 a jsonb; b jsonb; result jsonb; dims integer[]; exponent numeric;
 j integer; da integer; db integer;
BEGIN
 -- De eerdere structuurtrigger draait alfabetisch vóór deze trigger.
 FOR token IN SELECT value FROM jsonb_array_elements(NEW.tokens) LOOP
   op:=token->>'op';
   IF op='input' THEN
     SELECT u.id AS unit_id,u.symbol,k.value_semantics,
       ARRAY[d.length_exp,d.mass_exp,d.time_exp,d.current_exp,d.temperature_exp,d.amount_exp,d.luminous_exp]::integer[] AS dims,
       i.source_kind,i.constant_value
     INTO STRICT inp FROM recipe_scaling_input i
     JOIN measurement_unit u ON u.id=i.unit_id
     JOIN quantity_kind k ON k.id=u.quantity_kind_id
     JOIN quantity_dimension d ON d.id=k.dimension_id
     WHERE i.id=(token->>'id')::uuid AND i.recipe_version_id=NEW.recipe_version_id AND i.rule_id=NEW.rule_id;
     n:=n+1;
     stack[n]:=jsonb_build_object('dims',inp.dims,'unit',inp.unit_id,'semantics',inp.value_semantics,
       'exponent',CASE WHEN inp.source_kind='constant' AND inp.value_semantics='ratio'
         AND inp.dims=ARRAY[0,0,0,0,0,0,0] AND inp.symbol='1' THEN inp.constant_value END);
   ELSE
     a:=stack[n-1]; b:=stack[n]; dims:=ARRAY[]::integer[];
     IF a->>'semantics'='absolute' OR b->>'semantics'='absolute' THEN
       RAISE EXCEPTION 'Absolute grootheden vereisen expliciete rekenregels' USING ERRCODE='23514';
     END IF;
     IF op IN ('add','subtract') THEN
       IF a->'dims' IS DISTINCT FROM b->'dims' OR a->>'unit' IS NULL
          OR a->>'unit' IS DISTINCT FROM b->>'unit' OR a->>'semantics' IS DISTINCT FROM b->>'semantics' THEN
         RAISE EXCEPTION 'Optellen/aftrekken vereist dezelfde bewezen eenheid en grootheid' USING ERRCODE='23514';
       END IF;
       result:=a-'exponent';
     ELSE
       IF a->>'semantics' <> 'ratio' OR b->>'semantics' <> 'ratio' THEN
         RAISE EXCEPTION 'Product, quotient of macht vereist ratio-grootheden' USING ERRCODE='23514';
       END IF;
       IF op='power' THEN
         exponent:=(b->>'exponent')::numeric;
         IF exponent IS NULL OR exponent<>trunc(exponent) OR exponent NOT BETWEEN -16 AND 16 THEN
           RAISE EXCEPTION 'Macht vereist een expliciete dimensieloze gehele constante in eenheid 1 (-16..16)' USING ERRCODE='23514';
         END IF;
       END IF;
       FOR j IN 0..6 LOOP
         da:=(a->'dims'->>j)::integer; db:=(b->'dims'->>j)::integer;
         IF op='multiply' THEN dims:=array_append(dims,da+db);
         ELSIF op='divide' THEN dims:=array_append(dims,da-db);
         ELSIF op='power' THEN dims:=array_append(dims,da*exponent::integer);
         ELSE RAISE EXCEPTION 'Onbekende fysische operator' USING ERRCODE='23514';
         END IF;
         IF dims[j+1] NOT BETWEEN -32768 AND 32767 THEN
           RAISE EXCEPTION 'Afgeleide dimensie buiten catalogusbereik' USING ERRCODE='23514';
         END IF;
       END LOOP;
       result:=jsonb_build_object('dims',dims,'unit',NULL::uuid,'semantics','ratio');
     END IF;
     n:=n-1;
     stack[n]:=result;
   END IF;
 END LOOP;
 SELECT u.id AS unit_id,k.value_semantics,
   ARRAY[d.length_exp,d.mass_exp,d.time_exp,d.current_exp,d.temperature_exp,d.amount_exp,d.luminous_exp]::integer[] AS dims
 INTO STRICT outp FROM recipe_scaling_rule r
 JOIN measurement_unit u ON u.id=r.output_unit_id
 JOIN quantity_kind k ON k.id=u.quantity_kind_id
 JOIN quantity_dimension d ON d.id=k.dimension_id
 WHERE r.recipe_version_id=NEW.recipe_version_id AND r.id=NEW.rule_id;
 result:=stack[1];
 IF result->'dims' IS DISTINCT FROM to_jsonb(outp.dims)
   OR result->>'semantics' IS DISTINCT FROM outp.value_semantics
   OR (result->>'unit' IS NOT NULL AND (result->>'unit')::uuid IS DISTINCT FROM outp.unit_id) THEN
   RAISE EXCEPTION 'Schaalformule past niet bij dimensie, semantiek of exacte uitvoereenheid' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recipe_scaling_expression_physical_guard BEFORE INSERT OR UPDATE ON recipe_scaling_expression
 FOR EACH ROW EXECUTE FUNCTION recipe_scaling_expression_physical_guard();

-- Bestaande concepten worden niet stilzwijgend als fysisch gevalideerd beschouwd.
-- Vóór pilot is geen migratie van formuleconcepten voorzien; blokkeer
-- een niet-lege installatie voor gecontroleerde herbeoordeling.
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM recipe_scaling_expression) THEN
   RAISE EXCEPTION 'Bestaande schaalformules vereisen gecontroleerde herbeoordeling vóór 0113' USING ERRCODE='55000';
 END IF;
END $$;
REVOKE ALL ON FUNCTION recipe_scaling_expression_physical_guard() FROM PUBLIC;
