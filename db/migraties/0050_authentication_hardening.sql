-- Migratie 0050: één begrensde wachtwoordcontrole (D94/D99).
SET search_path = fabriek, public;
CREATE OR REPLACE FUNCTION inloggen(p_naam text, p_wachtwoord text, p_pc text DEFAULT NULL)
RETURNS TABLE (id uuid, rol text, gebruikersnaam text, wacht_seconden int) LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog,fabriek,public,pg_temp AS $$
DECLARE
    v_mislukt   int;
    v_laatste   timestamptz;
    v_gebruiker gebruiker%ROWTYPE;
BEGIN
    PERFORM 1 FROM gebruiker g WHERE lower(g.gebruikersnaam)=lower(p_naam) FOR UPDATE;
    SELECT count(*), max(p.op) INTO v_mislukt, v_laatste
      FROM inlogpoging p
     WHERE lower(p.gebruikersnaam) = lower(p_naam) AND p.uitkomst = 'mislukt'
       AND p.op > clock_timestamp() - interval '15 minutes'
       AND p.op > coalesce((SELECT max(x.op) FROM inlogpoging x
                             WHERE lower(x.gebruikersnaam) = lower(p_naam) AND x.uitkomst = 'gelukt'), '-infinity');
    IF v_mislukt >= 5 AND v_laatste > clock_timestamp() - interval '1 minute' THEN
        INSERT INTO inlogpoging (gebruikersnaam, pc, uitkomst) VALUES (left(p_naam, 100), left(p_pc, 100), 'geblokkeerd');
        RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::text,
            greatest(1, ceil(extract(epoch FROM v_laatste + interval '1 minute' - clock_timestamp()))::int);
        RETURN;
    END IF;
    SELECT g.* INTO v_gebruiker FROM gebruiker g
     WHERE lower(g.gebruikersnaam) = lower(p_naam) AND g.actief AND NOT g.gedeeld
       AND g.wachtwoord_hash = public.crypt(p_wachtwoord, g.wachtwoord_hash);
    IF NOT FOUND THEN
        INSERT INTO inlogpoging (gebruikersnaam, pc, uitkomst) VALUES (left(p_naam, 100), left(p_pc, 100), 'mislukt');
        RETURN;
    END IF;
    INSERT INTO inlogpoging (gebruikersnaam, pc, uitkomst) VALUES (v_gebruiker.gebruikersnaam, left(p_pc, 100), 'gelukt');
    RETURN QUERY SELECT v_gebruiker.id, v_gebruiker.rol, v_gebruiker.gebruikersnaam, NULL::int;
END $$;

-- Foutieve authenticatie retourneert status zodat de audit bij commit behouden blijft.
CREATE FUNCTION change_password_confirmed(p_user uuid,p_current text,p_new text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,fabriek,public,pg_temp AS $$
DECLARE v_name text; v_login record;
BEGIN
    IF length(coalesce(p_new,'')) < 8 OR p_new = p_current THEN
      RAISE EXCEPTION 'Kies een ander wachtwoord van minstens 8 tekens';
    END IF;
    SELECT gebruikersnaam INTO v_name FROM gebruiker
      WHERE id=p_user AND actief AND NOT gedeeld FOR UPDATE;
    IF NOT FOUND THEN RETURN 'denied'; END IF;
    SELECT * INTO v_login FROM inloggen(v_name,p_current,NULL);
    IF v_login.wacht_seconden IS NOT NULL THEN RETURN 'locked'; END IF;
    IF v_login.id IS DISTINCT FROM p_user THEN RETURN 'denied'; END IF;
    UPDATE gebruiker SET wachtwoord_hash=wachtwoord_hash(p_new),wachtwoord_wijzigen=false WHERE id=p_user;
    RETURN 'changed';
END $$;
REVOKE EXECUTE ON FUNCTION change_password_confirmed(uuid,text,text),inloggen(text,text,text),wijzig_eigen_wachtwoord(uuid,text,text),controleer_login(text,text) FROM PUBLIC;
-- De oude controle en wachtwoordfunctie blijven alleen voor eigenaar/migratietests.
