-- Migratie 0048: operationele stilstand en overdracht.
SET search_path = fabriek, public;
INSERT INTO authorization_permission(code,domain) VALUES
 ('downtime.read','operations'),
 ('downtime.record','operations'),
 ('downtime.reason.manage','operations'),
 ('handover.read','operations'),
 ('handover.record','operations'),
 ('shift.manage','operations'),
 ('maintenance.downtime.read','maintenance'),
 ('display.downtime.read','display');
INSERT INTO authorization_role_permission(role_code,permission_code) VALUES
 ('operator','downtime.read'), ('operator','downtime.record'),
 ('operator','handover.read'), ('operator','handover.record'),
 ('shift_supervisor','downtime.read'), ('shift_supervisor','downtime.record'),
 ('shift_supervisor','handover.read'), ('shift_supervisor','handover.record'),
 ('manufacturing_manager','downtime.read'), ('manufacturing_manager','downtime.reason.manage'),
 ('manufacturing_manager','handover.read'), ('manufacturing_manager','shift.manage'),
 ('production_planner','handover.read'),
 ('maintenance_technician','maintenance.downtime.read'),
 ('display_integration','display.downtime.read');
