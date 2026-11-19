-- Migratie 0013 (versie 0.21.0): inloggen beveiligen.
-- * Gebruikersnamen zijn hoofdletterongevoelig: "Jan" en "jan" zijn hetzelfde account.
-- * Elke inlogpoging wordt vastgelegd (zonder wachtwoord). Na 5 mislukte pogingen voor dezelfde
--   gebruikersnaam binnen 15 minuten moet je 1 minuut wachten.
-- * Nieuwe wachtwoorden worden sterker versleuteld (bcrypt sterkte 11 in plaats van 6). Bestaande
--   wachtwoorden blijven werken en worden sterker zodra ze opnieuw worden ingesteld.
SET search_path = fabriek, public;

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM gebruiker GROUP BY lower(gebruikersnaam) HAVING count(*) > 1) THEN
        RAISE EXCEPTION 'Er zijn accounts die alleen in hoofdletters verschillen (%); hernoem of zet er een uit en probeer opnieuw',
            (SELECT string_agg(gebruikersnaam, ', ') FROM gebruiker g
              WHERE (SELECT count(*) FROM gebruiker x WHERE lower(x.gebruikersnaam) = lower(g.gebruikersnaam)) > 1);
    END IF;
END $$;
CREATE UNIQUE INDEX gebruiker_naam_klein ON gebruiker (lower(gebruikersnaam));

CREATE TABLE inlogpoging (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    gebruikersnaam  text NOT NULL,
    pc              text,
    uitkomst        text NOT NULL CHECK (uitkomst IN ('gelukt','mislukt','geblokkeerd')),
    op              timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX inlogpoging_naam ON inlogpoging (lower(gebruikersnaam), op);
CREATE INDEX inlogpoging_op ON inlogpoging (op);

-- Pogingen worden niet gewijzigd of verwijderd (opruimen doet het onderhoud, niet de applicatie).
CREATE FUNCTION inlogpoging_vast() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Inlogpogingen worden niet gewijzigd';
END $$;
CREATE TRIGGER inlogpoging_vast BEFORE UPDATE ON inlogpoging
    FOR EACH ROW EXECUTE FUNCTION inlogpoging_vast();

-- Hash voor een nieuw wachtwoord.
CREATE FUNCTION wachtwoord_hash(p_wachtwoord text) RETURNS text LANGUAGE sql VOLATILE AS $$
    SELECT public.crypt(p_wachtwoord, public.gen_salt('bf', 11))
$$;

-- Inloggen: controleert de wachttijd, het wachtwoord en legt de poging vast.
-- Geeft één regel: bij succes id, rol en de gebruikersnaam zoals opgeslagen; bij te veel
-- pogingen alleen wacht_seconden; bij een fout wachtwoord niets.
CREATE FUNCTION inloggen(p_naam text, p_wachtwoord text, p_pc text DEFAULT NULL)
RETURNS TABLE (id uuid, rol text, gebruikersnaam text, wacht_seconden int) LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    v_mislukt   int;
    v_laatste   timestamptz;
    v_gebruiker gebruiker%ROWTYPE;
BEGIN
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
     WHERE lower(g.gebruikersnaam) = lower(p_naam) AND g.actief
       AND g.wachtwoord_hash = public.crypt(p_wachtwoord, g.wachtwoord_hash);
    IF NOT FOUND THEN
        INSERT INTO inlogpoging (gebruikersnaam, pc, uitkomst) VALUES (left(p_naam, 100), left(p_pc, 100), 'mislukt');
        RETURN;
    END IF;
    INSERT INTO inlogpoging (gebruikersnaam, pc, uitkomst) VALUES (v_gebruiker.gebruikersnaam, left(p_pc, 100), 'gelukt');
    RETURN QUERY SELECT v_gebruiker.id, v_gebruiker.rol, v_gebruiker.gebruikersnaam, NULL::int;
END $$;

ALTER FUNCTION inlogpoging_vast() SET search_path = fabriek, public;
ALTER FUNCTION wachtwoord_hash(text) SET search_path = fabriek, public;
ALTER FUNCTION inloggen(text, text, text) SET search_path = fabriek, public;
