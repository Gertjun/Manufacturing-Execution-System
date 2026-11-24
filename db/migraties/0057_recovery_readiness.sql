-- Migratie 0057: diagnose voor noodherstel, geen automatische bevoegdheidstoekenning.
SET search_path = fabriek, public;

-- Een bevoegd account is niet noodzakelijk beschikbaar: dit is uitsluitend
-- een technische bovengrens, geen bewijs van aanwezigheid of wachtwoordbezit.
CREATE FUNCTION authorization_recovery_readiness(p_target uuid)
RETURNS TABLE(eligible_requesters bigint,eligible_approvers bigint,independent_pairs bigint)
LANGUAGE sql STABLE SET search_path = pg_catalog,fabriek,pg_temp AS $$
    WITH candidates AS (
      SELECT id,
        authorization_permits(id,'authorization.request',NULL,NULL,NULL) AS can_request,
        authorization_permits(id,'authorization.approve',NULL,NULL,NULL) AS can_approve
      FROM gebruiker WHERE id <> p_target AND actief AND NOT gedeeld AND NOT wachtwoord_wijzigen
    )
    SELECT (SELECT count(*) FROM candidates WHERE can_request),
           (SELECT count(*) FROM candidates WHERE can_approve),
           (SELECT count(*) FROM candidates a CROSS JOIN candidates b
              WHERE a.id<>b.id AND a.can_request AND b.can_approve)
$$;
REVOKE EXECUTE ON FUNCTION authorization_recovery_readiness(uuid) FROM PUBLIC;
