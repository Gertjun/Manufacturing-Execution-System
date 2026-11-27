-- Migratie 0145: persoonlijke technische statusmutatie (#115.3c).
SET search_path = fabriek, public;

INSERT INTO authorization_role(code,domain) VALUES ('resource_status_manager','maintenance');
INSERT INTO authorization_permission(code,domain) VALUES ('resource.status.manage','maintenance');
INSERT INTO authorization_role_permission(role_code,permission_code)
VALUES ('resource_status_manager','resource.status.manage');

CREATE FUNCTION resource_status_set(p_equipment uuid,p_expected integer,p_status text,p_reason text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE actor uuid; v_hierarchy uuid; v_area text; v_equipment text;
    previous_revision integer; next_revision integer;
BEGIN
    actor:=execution_transaction_actor();
    SELECT hierarchy_id INTO v_hierarchy FROM equipment WHERE id=p_equipment;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Geen actuele statusbevoegdheid voor dit middel' USING ERRCODE='42501';
    END IF;
    SELECT equipment_code INTO v_equipment FROM resource_equipment_scope WHERE equipment_id=p_equipment;
    WITH RECURSIVE ancestors AS (
        SELECT id,parent_id,level FROM equipment_hierarchy WHERE id=v_hierarchy
        UNION ALL
        SELECT h.id,h.parent_id,h.level FROM equipment_hierarchy h JOIN ancestors a ON h.id=a.parent_id
    )
    SELECT s.area_code INTO v_area FROM ancestors a JOIN resource_area_scope s ON s.hierarchy_id=a.id
        WHERE a.level='area';
    IF authorization_permits(actor,'resource.status.manage',v_area,NULL,v_equipment) IS NOT TRUE THEN
        RAISE EXCEPTION 'Geen actuele statusbevoegdheid voor dit middel' USING ERRCODE='42501';
    END IF;
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'Middelenstatus vereist read committed' USING ERRCODE='25001';
    END IF;
    PERFORM id FROM equipment WHERE id=p_equipment FOR UPDATE;
    -- Controleer het persoonlijke bewijs opnieuw na eventueel wachten op de lock.
    IF execution_transaction_actor() IS DISTINCT FROM actor
       OR authorization_permits(actor,'resource.status.manage',v_area,NULL,v_equipment) IS NOT TRUE THEN
        RAISE EXCEPTION 'Geen actuele statusbevoegdheid voor dit middel' USING ERRCODE='42501';
    END IF;
    SELECT coalesce(max(revision),0) INTO previous_revision
        FROM equipment_status_history WHERE equipment_id=p_equipment;
    IF previous_revision IS DISTINCT FROM p_expected OR previous_revision=2147483647 THEN
        RAISE EXCEPTION 'Middelenstatus is gewijzigd; herlaad de actuele revisie' USING ERRCODE='40001';
    END IF;
    next_revision:=previous_revision+1;
    INSERT INTO equipment_status_history(equipment_id,revision,status,reason,created_by)
        VALUES (p_equipment,next_revision,p_status,p_reason,actor);
    RETURN next_revision;
END $$;

CREATE TRIGGER equipment_status_history_audit AFTER INSERT ON equipment_status_history
    FOR EACH ROW EXECUTE FUNCTION log_config();
REVOKE ALL ON FUNCTION resource_status_set(uuid,integer,text,text) FROM PUBLIC;
