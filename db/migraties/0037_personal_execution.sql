-- D93/D94: geen gedeelde login en geen overdracht van invoerrechten via eerdere login.
SET search_path = fabriek, public;
CREATE OR REPLACE FUNCTION mag_invoeren_namens(p_gebruiker uuid, p_operator uuid, p_pc uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = fabriek, public AS $$
    SELECT EXISTS (SELECT 1 FROM operator o JOIN gebruiker g ON g.id = o.gebruiker_id
      JOIN pc ON pc.id = p_pc AND pc.actief
      WHERE o.id = p_operator AND o.actief AND g.id = p_gebruiker
        AND g.actief AND NOT g.gedeeld AND NOT g.wachtwoord_wijzigen)
$$;
