-- Migratie 0130: intern middelenhiërarchiefundament (#114.2).
SET search_path = fabriek, public;

-- Stabiele functionele hiërarchieknooppunten; geen fysieke assetidentiteit.
CREATE TABLE equipment_hierarchy (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL UNIQUE CHECK (code = btrim(code) AND code ~ '[^[:space:]]'),
    name text NOT NULL CHECK (name ~ '[^[:space:]]'),
    level text NOT NULL CHECK (level IN ('enterprise','site','area','cell','unit')),
    parent_id uuid,
    parent_level text GENERATED ALWAYS AS (
        CASE level WHEN 'site' THEN 'enterprise' WHEN 'area' THEN 'site'
                   WHEN 'cell' THEN 'area' WHEN 'unit' THEN 'cell' END
    ) STORED,
    UNIQUE (id, level),
    CHECK ((level = 'enterprise') = (parent_id IS NULL)),
    FOREIGN KEY (parent_id, parent_level) REFERENCES equipment_hierarchy(id, level)
);
CREATE INDEX equipment_hierarchy_parent ON equipment_hierarchy(parent_id);

-- Geen hernummering, verplaatsing of verwijdering buiten een toekomstig
-- gecontroleerd lifecyclecontract; de eigenaar kan de naam corrigeren.
CREATE FUNCTION equipment_hierarchy_identity_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
    IF TG_OP='DELETE' THEN
        RAISE EXCEPTION 'Middelenhiërarchie mag niet worden verwijderd' USING ERRCODE='55000';
    END IF;
    IF (NEW.id,NEW.code,NEW.level,NEW.parent_id) IS DISTINCT FROM
       (OLD.id,OLD.code,OLD.level,OLD.parent_id) THEN
        RAISE EXCEPTION 'Middelenhiërarchie-identiteit en ouder zijn onveranderlijk' USING ERRCODE='55000';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER equipment_hierarchy_identity_guard
    BEFORE UPDATE OR DELETE ON equipment_hierarchy
    FOR EACH ROW EXECUTE FUNCTION equipment_hierarchy_identity_guard();

-- Geen applicatie-interface of automatische historische mapping.
-- De bestaande 0077/0078 ACL-allowlists kennen deze tabel geen rechten toe.
REVOKE ALL ON equipment_hierarchy FROM PUBLIC;
REVOKE ALL ON FUNCTION equipment_hierarchy_identity_guard() FROM PUBLIC;
