-- Migratie 0043: MES-rollenregister (D89 P01–P05).
-- Alleen definities, geen automatische grants aan bestaande gebruikers.
SET search_path = fabriek, public;
INSERT INTO authorization_role(code,domain) VALUES
 ('operator','operations'),
 ('shift_supervisor','operations'),
 ('manufacturing_manager','operations'),
 ('production_planner','operations'),
 ('process_engineer','engineering'),
 ('engineering_approver','engineering'),
 ('quality_technician','quality'),
 ('quality_approver','quality'),
 ('maintenance_technician','maintenance'),
 ('system_administrator','technical'),
 ('security_administrator','security'),
 ('analyst_management','analysis'),
 ('display_integration','display');

-- Eerste concrete rechten voor het security-domein. De operationele matrix
-- wordt per activiteit geïmplementeerd; geen impliciete rechten uit rolnamen.
INSERT INTO authorization_role_permission(role_code,permission_code) VALUES
 ('security_administrator','authorization.request'),
 ('security_administrator','authorization.approve'),
 ('security_administrator','authorization.revoke');
