-- Migratie 0071: gecontroleerde tijdelijke papieren nalevering.
SET search_path = fabriek, public;

CREATE FUNCTION execution_paper_entry(p_stapcode text,p_nummer text,p_batches text[],p_pc uuid,p_operator uuid,
 p_begin timestamptz,p_eind timestamptz,p_reden text,p_waarden jsonb,p_grondstoffen jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,fabriek,pg_temp AS $$
DECLARE v_actor uuid; v_stap processtap%ROWTYPE; v_batch batch%ROWTYPE; v_lot uuid;
 v_products uuid[]; v_product uuid; v_id uuid; v_old_actor text;
BEGIN
 v_actor:=execution_transaction_actor();
 IF length(btrim(coalesce(p_reden,''))) NOT BETWEEN 1 AND 500 THEN
   RAISE EXCEPTION 'Motivatie voor papieren nalevering vereist';
 END IF;
 SELECT * INTO v_stap FROM processtap WHERE code=p_stapcode AND actief;
 IF NOT FOUND OR v_stap.soort='keuring' THEN RAISE EXCEPTION 'Papieren nalevering alleen voor productiestappen'; END IF;
 IF NOT EXISTS (SELECT 1 FROM operator WHERE id=p_operator) OR NOT EXISTS (SELECT 1 FROM pc WHERE id=p_pc AND actief) THEN
   RAISE EXCEPTION 'Oorspronkelijke operator en actief werkstation vereist';
 END IF;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p_waarden,'[]'::jsonb)) w
   JOIN veld f ON f.processtap_id=v_stap.id AND f.code=w->>'veldcode' WHERE f.gemeten_door='kwaliteit') THEN
   RAISE EXCEPTION 'Kwaliteitsmetingen niet via papieren productienalevering';
 END IF;
 IF v_stap.is_lot_stap THEN
   PERFORM 1 FROM batch WHERE batchnummer=ANY(p_batches) ORDER BY id FOR UPDATE;
   SELECT array_agg(product_id) INTO v_products FROM batch WHERE batchnummer=ANY(p_batches);
   IF coalesce(cardinality(v_products),0)=0 OR cardinality(v_products)<>cardinality(p_batches) THEN
      RAISE EXCEPTION 'Alle oorspronkelijke batches moeten bestaan';
   END IF;
 ELSIF v_stap.niveau='batch' THEN
   SELECT * INTO v_batch FROM batch WHERE batchnummer=p_nummer FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Onbekende batch'; END IF;
   v_products:=ARRAY[v_batch.product_id];
 ELSE
   SELECT id INTO v_lot FROM lot WHERE lotnummer=p_nummer FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Onbekend lot'; END IF;
   PERFORM 1 FROM batch WHERE lot_id=v_lot ORDER BY id FOR SHARE;
   SELECT array_agg(product_id) INTO v_products FROM batch WHERE lot_id=v_lot;
   IF coalesce(cardinality(v_products),0)=0 THEN RAISE EXCEPTION 'Lot zonder batchleden'; END IF;
 END IF;
 FOREACH v_product IN ARRAY v_products LOOP
   IF NOT authorization_permits(v_actor,'execution.correct',NULL,v_product,NULL)
      OR NOT authorization_permits(v_actor,'execution.start',NULL,v_product,NULL)
      OR NOT authorization_permits(v_actor,'execution.record',NULL,v_product,NULL)
      OR NOT authorization_permits(v_actor,'execution.complete',NULL,v_product,NULL)
      OR (v_stap.is_lot_stap AND NOT authorization_permits(v_actor,'execution.lot.create',NULL,v_product,NULL)) THEN
     RAISE EXCEPTION 'Geen actuele bevoegdheid voor papieren nalevering' USING ERRCODE='42501';
   END IF;
 END LOOP;
 -- Alleen de digitale transcribent is persoonlijk geauthenticeerd.
 -- De oorspronkelijke operator is een verklaring afkomstig van papier.
 v_old_actor:=current_setting('fabriek.gebruiker',true);
 PERFORM set_config('fabriek.gebruiker',(SELECT gebruikersnaam FROM gebruiker WHERE id=v_actor),true);
 v_id:=lever_stap_na(p_stapcode,p_nummer,p_batches,p_pc,p_operator,p_begin,p_eind,btrim(p_reden),v_actor,p_waarden,p_grondstoffen);
 IF EXISTS (SELECT 1 FROM stapregistratie WHERE id=v_id AND herbewerking_start) THEN
   RAISE EXCEPTION 'Herbewerking niet via gewone papieren nalevering';
 END IF;
 PERFORM set_config('fabriek.gebruiker',coalesce(v_old_actor,''),true);
 RETURN v_id;
END $$;

-- De gewone applicatierol mag geen papieren herkomst achteraf fabriceren.
CREATE FUNCTION execution_paper_metadata_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,fabriek,pg_temp AS $$
BEGIN
 IF pg_has_role(current_user,'mes_app','MEMBER') THEN
   IF TG_OP='INSERT' THEN
     IF NEW.nageleverd_door IS NOT NULL OR NEW.nageleverd_reden IS NOT NULL OR NEW.nageleverd_op IS NOT NULL THEN
       RAISE EXCEPTION 'Papieren herkomst uitsluitend via gecontroleerde nalevering' USING ERRCODE='42501';
     END IF;
   ELSIF (NEW.nageleverd_door,NEW.nageleverd_reden,NEW.nageleverd_op)
        IS DISTINCT FROM (OLD.nageleverd_door,OLD.nageleverd_reden,OLD.nageleverd_op) THEN
     RAISE EXCEPTION 'Papieren herkomst mag niet achteraf wijzigen' USING ERRCODE='42501';
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER stapregistratie_01_paper BEFORE INSERT OR UPDATE ON stapregistratie
 FOR EACH ROW EXECUTE FUNCTION execution_paper_metadata_guard();
REVOKE ALL ON FUNCTION execution_paper_entry(text,text,text[],uuid,uuid,timestamptz,timestamptz,text,jsonb,jsonb),
 execution_paper_metadata_guard(),lever_stap_na(text,text,text[],uuid,uuid,timestamptz,timestamptz,text,uuid,jsonb,jsonb) FROM PUBLIC;
