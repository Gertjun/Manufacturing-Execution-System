-- Migratie 0153: beperkte middelenreferenties (#115.6c2a).
SET search_path = fabriek, public;

CREATE FUNCTION resource_property_references() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
    PERFORM resource_catalog_actor();
    RETURN jsonb_build_object(
        'quantity_kinds',coalesce((SELECT jsonb_agg(jsonb_build_object(
            'id',k.id,'code',k.code,'name',k.name,'value_semantics',k.value_semantics)
            ORDER BY k.code) FROM quantity_kind k),'[]'::jsonb),
        'units',coalesce((SELECT jsonb_agg(jsonb_build_object(
            'id',u.id,'quantity_kind_id',u.quantity_kind_id,'code',u.code,'symbol',u.symbol,'name',u.name)
            ORDER BY u.code) FROM measurement_unit u),'[]'::jsonb)
    );
END $$;

-- Alleen een menusignaal; elke lees- en schrijffunctie autoriseert opnieuw.
CREATE FUNCTION resource_status_access() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid;
BEGIN
    actor:=execution_transaction_actor();
    RETURN coalesce(authorization_permits(actor,'resource.status.manage',NULL,NULL,NULL),false)
        OR EXISTS(SELECT 1 FROM equipment e WHERE resource_status_visible(actor,e.id) IS TRUE);
END $$;

REVOKE ALL ON FUNCTION resource_property_references(),resource_status_access() FROM PUBLIC;
