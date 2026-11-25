-- Migratie 0078: expliciete leesinterface, ook oude kolomgrants intrekken.
SET search_path = fabriek, public;
REVOKE SELECT ON ALL TABLES IN SCHEMA fabriek FROM PUBLIC;
