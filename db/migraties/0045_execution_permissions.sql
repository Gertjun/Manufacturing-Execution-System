-- Migratie 0045: productgebonden uitvoering en correcties.
SET search_path = fabriek, public;
INSERT INTO authorization_permission(code,domain) VALUES
 ('execution.start','operations'), ('execution.record','operations'),
 ('execution.complete','operations'), ('execution.correct','operations'),
 ('inspection.start','quality'), ('inspection.record','quality');
INSERT INTO authorization_role_permission(role_code,permission_code) VALUES
 ('operator','execution.start'), ('operator','execution.record'), ('operator','execution.complete'),
 ('shift_supervisor','execution.start'), ('shift_supervisor','execution.record'),
 ('shift_supervisor','execution.complete'), ('shift_supervisor','execution.correct'),
 ('quality_technician','inspection.start'), ('quality_technician','inspection.record'),
 ('quality_approver','inspection.start'), ('quality_approver','inspection.record');
