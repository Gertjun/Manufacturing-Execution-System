-- Migratie 0046: afzonderlijke leesrechten en kwaliteitsbesluit.
SET search_path = fabriek, public;
INSERT INTO authorization_permission(code,domain) VALUES
 ('execution.read','operations'), ('inspection.read','quality'),
 ('inspection.decide','quality'), ('engineering.execution.read','engineering'),
 ('analysis.execution.read','analysis');
INSERT INTO authorization_role_permission(role_code,permission_code) VALUES
 ('operator','execution.read'), ('shift_supervisor','execution.read'),
 ('manufacturing_manager','execution.read'), ('production_planner','execution.read'),
 ('quality_technician','inspection.read'), ('quality_approver','inspection.read'),
 ('quality_approver','inspection.decide'),
 ('process_engineer','engineering.execution.read'),
 ('engineering_approver','engineering.execution.read'),
 ('analyst_management','analysis.execution.read');

-- Eén concrete doelcontext, zonder de scopes van verschillende grants te combineren.
CREATE FUNCTION authorization_read_execution(p_user uuid,p_product uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = fabriek,public AS $$
 SELECT authorization_permits(p_user,'execution.read',NULL,p_product,NULL)
     OR authorization_permits(p_user,'inspection.read',NULL,p_product,NULL)
     OR authorization_permits(p_user,'engineering.execution.read',NULL,p_product,NULL)
     OR authorization_permits(p_user,'analysis.execution.read',NULL,p_product,NULL)
$$;
