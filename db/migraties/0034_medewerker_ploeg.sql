-- Migratie 0034 (versie 0.54.0): elke medewerker in een ploeg en divisie (#87, D77).
-- Een medewerker is een naam bij de invoer (tabel operator), met of zonder eigen account. De ploeg (A1 … E2,
-- D76) is leeg voor wie niet in het rooster werkt. Oudere invoerschermen: niets nodig.
SET search_path = fabriek, public;

ALTER TABLE operator ADD COLUMN ploeg_id uuid REFERENCES rooster_ploeg(id);
CREATE INDEX operator_ploeg ON operator (ploeg_id) WHERE ploeg_id IS NOT NULL;
