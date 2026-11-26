-- Migratie 0122: historisch vrijgavebewijs en effectieve geldigheid (#112).
SET search_path = fabriek, public;

-- Formele vrijgave en ingangsdatum zijn afzonderlijke feiten.
-- De eindgrens volgt uit een volgende ingangsdatum of intrekking.
-- Nog geen runtime-insert: de vrijgavebevoegdheid is een open ontwerpkeuze.
CREATE TABLE recipe_release (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 master_recipe_id uuid NOT NULL REFERENCES master_recipe(id),
 recipe_version_id uuid NOT NULL UNIQUE REFERENCES master_recipe_version(id),
 round_id uuid NOT NULL UNIQUE,
 effective_from timestamptz NOT NULL,
 released_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 released_by uuid NOT NULL REFERENCES gebruiker(id),
 reason text NOT NULL CHECK(reason ~ '[^[:space:]]'),
 FOREIGN KEY(round_id,recipe_version_id) REFERENCES recipe_review_round(id,recipe_version_id),
 UNIQUE(master_recipe_id,effective_from),
 CHECK(isfinite(effective_from) AND isfinite(released_at) AND effective_from>=released_at)
);

CREATE TABLE recipe_release_withdrawal (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 release_id uuid NOT NULL UNIQUE REFERENCES recipe_release(id),
 withdrawn_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(withdrawn_at)),
 withdrawn_by uuid NOT NULL REFERENCES gebruiker(id),
 reason text NOT NULL CHECK(reason ~ '[^[:space:]]')
);
CREATE TRIGGER recipe_release_immutable BEFORE UPDATE OR DELETE ON recipe_release
 FOR EACH ROW EXECUTE FUNCTION recipe_review_evidence_immutable();
CREATE TRIGGER recipe_release_withdrawal_immutable BEFORE UPDATE OR DELETE ON recipe_release_withdrawal
 FOR EACH ROW EXECUTE FUNCTION recipe_review_evidence_immutable();

-- Intern selectiemodel. Neem de meest recente geplande ingangsdatum die
-- bereikt is, met expliciete kennisgrens: toekomstige besluiten mogen
-- geen historische selectie achteraf veranderen. Een ingetrokken versie
-- valt niet automatisch terug op een oudere versie.
CREATE FUNCTION recipe_effective_release(p_recipe uuid,p_at timestamptz,p_known_at timestamptz)
RETURNS uuid LANGUAGE sql STABLE SET search_path=pg_catalog,fabriek,pg_temp AS $$
 WITH candidate AS (
   SELECT r.id,r.recipe_version_id FROM recipe_release r
   WHERE r.master_recipe_id=p_recipe AND r.effective_from<=p_at AND r.released_at<=p_known_at
   ORDER BY r.effective_from DESC LIMIT 1
 )
 SELECT c.recipe_version_id FROM candidate c WHERE NOT EXISTS (
   SELECT 1 FROM recipe_release_withdrawal w WHERE w.release_id=c.id
   AND w.withdrawn_at<=p_at AND w.withdrawn_at<=p_known_at
 )
$$;

-- Historische intervallen worden afgeleid, nooit in oude bewijsrecords
-- overschreven. Intrekking voor geplande ingang geeft een leeg interval.
CREATE FUNCTION recipe_release_intervals(p_recipe uuid,p_known_at timestamptz)
RETURNS TABLE(release_id uuid,recipe_version_id uuid,valid_from timestamptz,valid_until timestamptz)
LANGUAGE sql STABLE SET search_path=pg_catalog,fabriek,pg_temp AS $$
 WITH schedule AS (
   SELECT r.id,r.recipe_version_id,r.effective_from,
          lead(r.effective_from) OVER (ORDER BY r.effective_from) AS next_from
   FROM recipe_release r WHERE r.master_recipe_id=p_recipe AND r.released_at<=p_known_at
 )
 SELECT s.id,s.recipe_version_id,s.effective_from,
   CASE WHEN s.next_from IS NULL AND w.withdrawn_at IS NULL THEN NULL::timestamptz
        ELSE greatest(s.effective_from,least(s.next_from,w.withdrawn_at)) END
 FROM schedule s LEFT JOIN recipe_release_withdrawal w ON w.release_id=s.id AND w.withdrawn_at<=p_known_at
$$;

-- Geen eigenaar- of approute openen voordat autorisatie en
-- besluitgebonden bevestiging zijn vastgesteld. Later vervangt de
-- gecontroleerde workflow deze guards; reguliere SQL kan niet vrijgeven.
CREATE FUNCTION recipe_release_closed_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'Formele receptvrijgave en intrekking wachten op gecontroleerde besluitworkflow' USING ERRCODE='55000';
END $$;
CREATE TRIGGER recipe_release_closed BEFORE INSERT ON recipe_release
 FOR EACH ROW EXECUTE FUNCTION recipe_release_closed_guard();
CREATE TRIGGER recipe_release_withdrawal_closed BEFORE INSERT ON recipe_release_withdrawal
 FOR EACH ROW EXECUTE FUNCTION recipe_release_closed_guard();

REVOKE ALL ON recipe_release,recipe_release_withdrawal FROM PUBLIC;
REVOKE ALL ON FUNCTION recipe_effective_release(uuid,timestamptz,timestamptz),
 recipe_release_intervals(uuid,timestamptz),recipe_release_closed_guard() FROM PUBLIC;
-- Geen statusovergang, vrijgavepermission, automatische activering of
-- uitvoeringsrecht in 0122. Rollen en definitieve planning volgen.
