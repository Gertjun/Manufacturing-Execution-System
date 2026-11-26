-- Migratie 0110: persoonlijk beheer van de gedeelde eenhedencatalogus (D106/#141).
SET search_path = fabriek, public;

-- Gedeelde catalogus: hergebruik de bestaande globale materiaalbeheerbevoegdheid.
-- Productspecifieke grants geven geen schrijfrecht op gedeelde definities.
-- Geen impliciete conversie, vrijgave of rekenengine; bestaande records blijven onveranderlijk.

CREATE FUNCTION unit_catalog_list() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
 PERFORM material_manage_actor();
 RETURN jsonb_build_object(
 'dimensions',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM quantity_dimension x),'[]'::jsonb),
 'quantity_kinds',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.code) FROM quantity_kind x),'[]'::jsonb),
 'units',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.code) FROM measurement_unit x),'[]'::jsonb),
 'conversions',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM unit_conversion x),'[]'::jsonb),
 'versions',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.conversion_id,x.revision) FROM unit_conversion_version x),'[]'::jsonb));
END $$;

CREATE FUNCTION unit_catalog_create_dimension(p_length smallint,p_mass smallint,p_time smallint,p_current smallint,p_temperature smallint,p_amount smallint,p_luminous smallint) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE target uuid;
BEGIN
 PERFORM material_manage_actor();
 INSERT INTO quantity_dimension(length_exp,mass_exp,time_exp,current_exp,temperature_exp,amount_exp,luminous_exp)
 VALUES(p_length,p_mass,p_time,p_current,p_temperature,p_amount,p_luminous) RETURNING id INTO target;
 RETURN target;
END $$;

CREATE FUNCTION unit_catalog_create_kind(p_dimension uuid,p_code text,p_name text,p_semantics text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE target uuid;
BEGIN
 PERFORM material_manage_actor();
 INSERT INTO quantity_kind(dimension_id,code,name,value_semantics) VALUES(p_dimension,p_code,p_name,p_semantics) RETURNING id INTO target;
 RETURN target;
END $$;

CREATE FUNCTION unit_catalog_create_unit(p_kind uuid,p_code text,p_symbol text,p_name text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE target uuid;
BEGIN
 PERFORM material_manage_actor();
 INSERT INTO measurement_unit(quantity_kind_id,code,symbol,name) VALUES(p_kind,p_code,p_symbol,p_name) RETURNING id INTO target;
 RETURN target;
END $$;

CREATE FUNCTION unit_catalog_create_conversion(p_from uuid,p_to uuid,p_numerator numeric,p_denominator numeric,p_offset numeric,p_source text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; target uuid; kind uuid; semantics text;
BEGIN
 actor:=material_manage_actor();
 SELECT u.quantity_kind_id,k.value_semantics INTO kind,semantics FROM measurement_unit u JOIN quantity_kind k ON k.id=u.quantity_kind_id WHERE u.id=p_from;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende broneenheid' USING ERRCODE='23503'; END IF;
 INSERT INTO unit_conversion(quantity_kind_id,from_unit_id,to_unit_id) VALUES(kind,p_from,p_to) RETURNING id INTO target;
 INSERT INTO unit_conversion_version(conversion_id,quantity_kind_id,value_semantics,revision,factor_numerator,factor_denominator,additive_offset,source_reference,created_by)
 VALUES(target,kind,semantics,1,p_numerator,p_denominator,p_offset,p_source,actor);
 RETURN target;
END $$;

CREATE FUNCTION unit_catalog_append_conversion(p_conversion uuid,p_expected integer,p_numerator numeric,p_denominator numeric,p_offset numeric,p_source text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; target uuid; kind uuid; semantics text; current_revision integer;
BEGIN
 actor:=material_manage_actor();
 SELECT c.quantity_kind_id,k.value_semantics INTO kind,semantics FROM unit_conversion c JOIN quantity_kind k ON k.id=c.quantity_kind_id WHERE c.id=p_conversion FOR UPDATE OF c;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende conversie' USING ERRCODE='23503'; END IF;
 SELECT max(revision) INTO current_revision FROM unit_conversion_version WHERE conversion_id=p_conversion;
 IF current_revision IS NULL OR current_revision IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Conversierevisie is gewijzigd' USING ERRCODE='40001'; END IF;
 INSERT INTO unit_conversion_version(conversion_id,quantity_kind_id,value_semantics,revision,factor_numerator,factor_denominator,additive_offset,source_reference,created_by)
 VALUES(p_conversion,kind,semantics,current_revision+1,p_numerator,p_denominator,p_offset,p_source,actor) RETURNING id INTO target;
 RETURN target;
END $$;

REVOKE ALL ON FUNCTION unit_catalog_list(),
 unit_catalog_create_dimension(smallint,smallint,smallint,smallint,smallint,smallint,smallint),
 unit_catalog_create_kind(uuid,text,text,text),
 unit_catalog_create_unit(uuid,text,text,text),
 unit_catalog_create_conversion(uuid,uuid,numeric,numeric,numeric,text),
 unit_catalog_append_conversion(uuid,integer,numeric,numeric,numeric,text) FROM PUBLIC;
