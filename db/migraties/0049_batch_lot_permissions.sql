-- Migratie 0049: batch-, lot- en herbewerkingsrechten.
SET search_path = fabriek, public;
INSERT INTO authorization_permission(code,domain) VALUES
 ('execution.batch.create','operations'), ('execution.lot.create','operations'),
 ('execution.hold','operations'), ('inspection.hold','quality'),
 ('inspection.batch.decide','quality'), ('execution.rework','operations'),
 ('inspection.rework.order','quality'), ('operations.rework.order','operations');
INSERT INTO authorization_role_permission(role_code,permission_code) VALUES
 ('operator','execution.batch.create'), ('shift_supervisor','execution.batch.create'),
 ('operator','execution.lot.create'), ('shift_supervisor','execution.lot.create'),
 ('shift_supervisor','execution.hold'), ('manufacturing_manager','execution.hold'),
 ('quality_technician','inspection.hold'), ('quality_approver','inspection.hold'),
 ('quality_approver','inspection.batch.decide'),
 ('operator','execution.rework'), ('shift_supervisor','execution.rework'),
 ('quality_approver','inspection.rework.order'), ('manufacturing_manager','operations.rework.order');

-- Een volledig lot mag alleen zichtbaar zijn wanneer alle leden binnen de
-- leesbevoegdheid vallen. Lege lots vereisen onbegrensde leesbevoegdheid.
CREATE FUNCTION authorization_read_lot(p_user uuid,p_lot uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = fabriek,public AS $$
 SELECT EXISTS (SELECT 1 FROM lot WHERE id=p_lot)
 AND CASE WHEN EXISTS (SELECT 1 FROM batch WHERE lot_id=p_lot)
 THEN NOT EXISTS (SELECT 1 FROM batch b WHERE b.lot_id=p_lot
                  AND NOT authorization_read_execution(p_user,b.product_id))
 ELSE authorization_read_execution(p_user,NULL) END
 AND NOT EXISTS (SELECT 1 FROM stapregistratie r WHERE r.lot_id=p_lot
                  AND NOT authorization_read_execution(p_user,r.product_id))
$$;
