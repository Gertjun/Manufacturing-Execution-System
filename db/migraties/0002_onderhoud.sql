-- Migratie 0002 (versie 0.6.0): schemaversie en logboek voor back-ups en hersteltests.
SET search_path = fabriek, public;

-- Welke migraties zijn uitgevoerd. Wordt bijgewerkt door tools/migreer.mjs.
CREATE TABLE IF NOT EXISTS schema_versie (
  nummer        integer PRIMARY KEY,
  naam          text NOT NULL,
  uitgevoerd_op timestamptz NOT NULL DEFAULT now()
);

-- Back-ups, hersteltests en migraties, geschreven door de beheertools in tools/.
CREATE TABLE IF NOT EXISTS onderhoud_log (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  soort         text NOT NULL CHECK (soort IN ('backup', 'hersteltest', 'herstel', 'migratie')),
  gestart_op    timestamptz NOT NULL,
  klaar_op      timestamptz NOT NULL DEFAULT now(),
  gelukt        boolean NOT NULL,
  bestand       text,
  grootte_bytes bigint,
  versie        text,
  melding       text
);
CREATE INDEX IF NOT EXISTS onderhoud_log_soort ON onderhoud_log (soort, klaar_op DESC);
