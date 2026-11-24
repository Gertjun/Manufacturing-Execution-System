-- Migratie 0065: actuele uitvoeringsbevoegdheid bij consumptie van een legacy-herbewerkingsopdracht.
SET search_path = fabriek, public;

CREATE OR REPLACE FUNCTION koppel_herbewerking() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,fabriek,pg_temp AS $$
DECLARE v_id uuid; v_actor uuid; v_product uuid;
BEGIN
    IF NOT NEW.herbewerking_start THEN RETURN NULL; END IF;
    SELECT h.id INTO v_id FROM herbewerking h
      WHERE h.status='open' AND h.processtap_id=NEW.processtap_id
        AND h.batch_id IS NOT DISTINCT FROM NEW.batch_id
        AND h.lot_id IS NOT DISTINCT FROM NEW.lot_id
        AND h.aangemaakt_door IS NOT NULL
        AND btrim(h.reden)=btrim(NEW.reden)
      FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Vooraf geregistreerde herbewerkingsopdracht vereist';
    END IF;

    -- De gekoppelde medewerker moet actief en persoonlijk zijn. Het
    -- autorisatiefundament controleert ook geldigheid en kwalificaties.
    SELECT g.id INTO v_actor FROM operator o JOIN gebruiker g ON g.id=o.gebruiker_id
      WHERE o.id=NEW.operator_id AND o.actief AND g.actief
        AND NOT g.gedeeld AND NOT g.wachtwoord_wijzigen
      FOR SHARE OF o,g;
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Actieve persoonlijke operator vereist voor herbewerking';
    END IF;
    IF NEW.batch_id IS NOT NULL THEN
        SELECT product_id INTO v_product FROM batch WHERE id=NEW.batch_id;
    ELSE
        v_product:=lot_product(NEW.lot_id);
    END IF;
    IF NOT authorization_permits(v_actor,'execution.rework',NULL,v_product,NULL)
       OR (NEW.lot_id IS NOT NULL AND EXISTS (
           SELECT 1 FROM batch b WHERE b.lot_id=NEW.lot_id
             AND NOT authorization_permits(v_actor,'execution.rework',NULL,b.product_id,NULL))) THEN
        RAISE EXCEPTION 'Geen actuele uitvoeringsbevoegdheid voor herbewerking';
    END IF;
    UPDATE herbewerking SET status='gestart',stapregistratie_id=NEW.id WHERE id=v_id;
    RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION koppel_herbewerking() FROM PUBLIC;
