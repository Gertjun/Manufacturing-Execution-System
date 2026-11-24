-- Migratie 0047: planning en productdefinities gescheiden.
SET search_path = fabriek, public;
INSERT INTO authorization_permission(code,domain) VALUES
 ('planning.manage','operations'),
 ('engineering.product.manage','engineering');
INSERT INTO authorization_role_permission(role_code,permission_code) VALUES
 ('production_planner','planning.manage'),
 ('process_engineer','engineering.product.manage');
