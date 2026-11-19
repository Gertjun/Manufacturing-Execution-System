-- Migratie 0006 (versie 0.12.0): ploegoverdracht.
-- Ploegen met begin- en eindtijd, en een overdrachtsnotitie per ploeg (bijzonderheden en aandachtspunten).
-- De cijfers van een ploeg (afgerond, gestart, afwijkingen, wat nog open staat) rekent de API uit.
SET search_path = fabriek, public;

CREATE TABLE ploeg (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code      text NOT NULL UNIQUE CHECK (code ~ '^[A-Za-z0-9._-]{1,20}$'),
    naam      text NOT NULL,
    begint    time NOT NULL,
    eindigt   time NOT NULL,
    actief    boolean NOT NULL DEFAULT true,
    CHECK (begint <> eindigt)
);
CREATE TRIGGER ploeg_log BEFORE INSERT OR UPDATE OR DELETE ON ploeg
    FOR EACH ROW EXECUTE FUNCTION log_config();

-- Welke ploeg werkt op moment p_t, en op welke dag die ploeg begon (een nachtploeg hoort bij de dag waarop hij begint).
CREATE FUNCTION ploeg_van(p_t timestamptz)
RETURNS TABLE (ploeg_id uuid, code text, naam text, dag date, begin_op timestamptz, eind_op timestamptz)
LANGUAGE sql STABLE AS $$
    SELECT p.id, p.code, p.naam, d.dag, (d.dag + p.begint)::timestamptz,
           (d.dag + p.begint)::timestamptz + CASE WHEN p.eindigt > p.begint THEN p.eindigt - p.begint
                                                ELSE p.eindigt - p.begint + interval '24 hours' END
      FROM ploeg p
      CROSS JOIN LATERAL (VALUES (p_t::date), (p_t::date - 1)) d(dag)
     WHERE p.actief
       AND p_t >= (d.dag + p.begint)::timestamptz
       AND p_t < (d.dag + p.begint)::timestamptz + CASE WHEN p.eindigt > p.begint THEN p.eindigt - p.begint
                                                       ELSE p.eindigt - p.begint + interval '24 hours' END
     ORDER BY (d.dag + p.begint) DESC
     LIMIT 1
$$;

CREATE TABLE overdracht (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dag              date NOT NULL,
    ploeg_id         uuid NOT NULL REFERENCES ploeg(id),
    hal              text,
    bijzonderheden   text,
    aandachtspunten  text,
    gebruiker_id     uuid NOT NULL REFERENCES gebruiker(id),
    operator_id      uuid REFERENCES operator(id),
    pc_id            uuid REFERENCES pc(id),
    geschreven_op    timestamptz NOT NULL DEFAULT now(),
    CHECK (length(btrim(coalesce(bijzonderheden, '') || coalesce(aandachtspunten, ''))) > 0)
);
CREATE INDEX overdracht_dag ON overdracht (dag, ploeg_id);

CREATE FUNCTION overdracht_onveranderlijk() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Een overdracht wordt niet gewijzigd of verwijderd; schrijf een nieuwe aanvulling';
END $$;
CREATE TRIGGER overdracht_vast BEFORE UPDATE OR DELETE ON overdracht
    FOR EACH ROW EXECUTE FUNCTION overdracht_onveranderlijk();

ALTER FUNCTION ploeg_van(timestamptz) SET search_path = fabriek, public;
ALTER FUNCTION overdracht_onveranderlijk() SET search_path = fabriek, public;
