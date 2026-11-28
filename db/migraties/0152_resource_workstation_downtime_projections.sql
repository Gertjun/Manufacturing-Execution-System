-- Migratie 0152: persoonlijke werkstation- en stilstandprojecties (#115.6b2).
SET search_path = fabriek, public;

CREATE FUNCTION resource_workstation_list() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
    PERFORM resource_catalog_actor();
    RETURN jsonb_build_object(
        'workstations',coalesce((SELECT jsonb_agg(jsonb_build_object(
            'id',p.id,'name',p.naam,'location',p.locatie,'active',p.actief) ORDER BY p.naam)
            FROM pc p),'[]'::jsonb),
        'equipment',coalesce((SELECT jsonb_agg(jsonb_build_object(
            'id',e.id,'code',e.code,'name',e.name) ORDER BY e.code)
            FROM equipment e),'[]'::jsonb),
        'assignments',coalesce((SELECT jsonb_agg(jsonb_build_object(
            'id',w.id,'pc_id',w.pc_id,'equipment_id',w.equipment_id,
            'opened_at',w.opened_at,'opened_by',w.opened_by,'opened_by_name',g.gebruikersnaam,
            'open_reason',w.open_reason,'closed_at',w.closed_at,'closed_by',w.closed_by,
            'closed_by_name',c.gebruikersnaam,'close_reason',w.close_reason)
            ORDER BY w.opened_at DESC,w.id)
            FROM equipment_workstation w JOIN gebruiker g ON g.id=w.opened_by
            LEFT JOIN gebruiker c ON c.id=w.closed_by),'[]'::jsonb)
    );
END $$;

-- Alleen actuele middelen op het expliciete werkstation van deze sessie.
-- Geen catalogusbeheerrecht of technische vrijgave afleiden uit de koppeling.
CREATE FUNCTION resource_downtime_choices(p_pc uuid,p_step uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; result jsonb;
BEGIN
    actor:=execution_transaction_actor();
    IF authorization_permits(actor,'downtime.record',NULL,NULL,NULL) IS NOT TRUE
       OR NOT EXISTS(SELECT 1 FROM operator WHERE gebruiker_id=actor AND actief) THEN
        RAISE EXCEPTION 'Geen actuele persoonlijke stilstandbevoegdheid' USING ERRCODE='42501';
    END IF;
    PERFORM execution_transaction_workstation(p_pc);
    IF NOT EXISTS(SELECT 1 FROM pc_stap x JOIN processtap s ON s.id=x.processtap_id
        WHERE x.pc_id=p_pc AND x.processtap_id=p_step AND s.actief AND s.soort='proces') THEN
        RAISE EXCEPTION 'Geen actuele werkstation-stapcontext' USING ERRCODE='42501';
    END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'code',e.code,'name',e.name,
        'open_downtime_id',d.id) ORDER BY e.code),'[]'::jsonb)
    INTO result
    FROM equipment_workstation w JOIN equipment e ON e.id=w.equipment_id
    LEFT JOIN stilstand d ON d.equipment_id=e.id AND d.eind_op IS NULL
    WHERE w.pc_id=p_pc AND w.closed_at IS NULL;
    RETURN result;
END $$;

-- Persoonlijke globale leesrechten, geen display-identiteit of catalogusrecht.
-- Actuele lijst, geen impliciete aggregatie van stap- en middelminuten.
CREATE FUNCTION resource_downtime_list() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; result jsonb;
BEGIN
    actor:=execution_transaction_actor();
    IF authorization_permits(actor,'downtime.read',NULL,NULL,NULL) IS NOT TRUE
       AND authorization_permits(actor,'maintenance.downtime.read',NULL,NULL,NULL) IS NOT TRUE THEN
        RAISE EXCEPTION 'Geen actuele globale stilstandleesbevoegdheid' USING ERRCODE='42501';
    END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id',d.id,'equipment_id',e.id,'equipment_code',e.code,'equipment_name',e.name,
        'step_code',s.code,'step_name',s.naam,'reason_code',o.code,'reason_name',o.naam,
        'category',o.categorie,'note',d.toelichting,'started_at',d.begin_op,
        'workstation',p.naam,'operator',op.naam) ORDER BY e.code,d.id),'[]'::jsonb)
    INTO result
    FROM stilstand d JOIN equipment e ON e.id=d.equipment_id
    JOIN processtap s ON s.id=d.processtap_id JOIN stilstand_oorzaak o ON o.id=d.oorzaak_id
    LEFT JOIN pc p ON p.id=d.pc_id LEFT JOIN operator op ON op.id=d.operator_id
    WHERE d.eind_op IS NULL;
    RETURN result;
END $$;

REVOKE ALL ON FUNCTION resource_workstation_list(),resource_downtime_choices(uuid,uuid),
    resource_downtime_list() FROM PUBLIC;
