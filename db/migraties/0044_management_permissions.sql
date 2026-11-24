-- Migratie 0044: concrete beheertoegang; geen automatische grantmigratie.
SET search_path = fabriek, public;

INSERT INTO authorization_permission(code,domain) VALUES
 ('account.read','technical'),
 ('account.manage','technical'),
 ('workstation.manage','technical'),
 ('system.read','technical'),
 ('process.parameter.manage','engineering'),
 ('material.definition.manage','engineering'),
 ('authorization.read','security');

INSERT INTO authorization_role_permission(role_code,permission_code) VALUES
 ('system_administrator','account.read'),
 ('system_administrator','account.manage'),
 ('system_administrator','workstation.manage'),
 ('system_administrator','system.read'),
 ('process_engineer','process.parameter.manage'),
 ('process_engineer','material.definition.manage'),
 ('security_administrator','authorization.read');
