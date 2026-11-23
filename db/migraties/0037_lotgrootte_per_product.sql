-- Migratie 0037 (0.64.0): lotgrootte per product (eerste databasefase van #104).
SET search_path = fabriek, public;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM lot l WHERE (SELECT count(*) FROM batch b WHERE b.lot_id = l.id) NOT BETWEEN 1 AND 50) THEN
        RAISE EXCEPTION 'Migratie 0037 gestopt: een historisch lot heeft geen geldig aantal batches (1–50); beoordeel eerst de lot-batchkoppelingen';
    END IF;
END $$;
ALTER TABLE product ADD COLUMN batches_per_lot integer NOT NULL DEFAULT 4 CHECK (batches_per_lot BETWEEN 1 AND 50);
ALTER TABLE lot ADD COLUMN batch_aantal_norm integer, ADD COLUMN batch_aantal integer, ADD COLUMN afwijking_reden text;
UPDATE lot l SET batch_aantal_norm=4, batch_aantal=(SELECT count(*)::int FROM batch b WHERE b.lot_id=l.id),
 afwijking_reden=CASE WHEN (SELECT count(*) FROM batch b WHERE b.lot_id=l.id)=4 THEN NULL
 ELSE 'Historisch lot; aantal wijkt af van de toenmalige norm van vier.' END;
ALTER TABLE lot ALTER COLUMN batch_aantal_norm SET NOT NULL, ALTER COLUMN batch_aantal SET NOT NULL,
 ADD CONSTRAINT lot_batch_aantal_norm_geldig CHECK (batch_aantal_norm BETWEEN 1 AND 50),
 ADD CONSTRAINT lot_batch_aantal_geldig CHECK (batch_aantal BETWEEN 1 AND 50),
 ADD CONSTRAINT lot_batch_aantal_afwijking CHECK ((batch_aantal=batch_aantal_norm AND afwijking_reden IS NULL)
 OR (batch_aantal<>batch_aantal_norm AND length(btrim(afwijking_reden)) BETWEEN 3 AND 500));
ALTER TABLE lot_voorstel ADD COLUMN batch_aantal_norm integer NOT NULL DEFAULT 4 CHECK (batch_aantal_norm BETWEEN 1 AND 50);

CREATE FUNCTION verval_lotvoorstellen_bij_lotgrootte() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.batches_per_lot IS DISTINCT FROM OLD.batches_per_lot THEN
  UPDATE lot_voorstel v SET status='vervallen', afgesloten_op=clock_timestamp()
   WHERE v.status='open' AND EXISTS (SELECT 1 FROM lot_voorstel_batch x JOIN batch b ON b.id=x.batch_id
                                    WHERE x.voorstel_id=v.id AND b.product_id=NEW.id);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER product_lotgrootte_verval AFTER UPDATE OF batches_per_lot ON product
 FOR EACH ROW EXECUTE FUNCTION verval_lotvoorstellen_bij_lotgrootte();

CREATE OR REPLACE FUNCTION maak_lot(p_lotnummer text,p_batches uuid[],p_pc uuid,p_operator uuid,
 p_lot_id uuid DEFAULT NULL,p_registratie_id uuid DEFAULT NULL,p_afwijking_reden text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_lot uuid; v_lotstap processtap%ROWTYPE; v_probleem text; v_voorstel record;
 v_reden text:=nullif(btrim(p_afwijking_reden),''); v_product uuid; v_norm int; v_aantal int; v_uniek int;
BEGIN
 IF p_batches IS NULL OR cardinality(p_batches) NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Een lot bevat 1 tot 50 batches'; END IF;
 PERFORM 1 FROM batch WHERE id=ANY(p_batches) FOR UPDATE;
 SELECT count(*)::int,count(DISTINCT id)::int INTO v_aantal,v_uniek FROM batch WHERE id=ANY(p_batches);
 IF v_aantal<>cardinality(p_batches) OR v_uniek<>v_aantal THEN RAISE EXCEPTION 'Een lot bevat alleen bestaande, verschillende batches'; END IF;
 IF (SELECT count(DISTINCT product_id) FROM batch WHERE id=ANY(p_batches))<>1
    OR EXISTS(SELECT 1 FROM batch WHERE id=ANY(p_batches) AND product_id IS NULL) THEN
  RAISE EXCEPTION 'Een lot bestaat uit batches van hetzelfde product';
 END IF;
 SELECT product_id INTO v_product FROM batch WHERE id=p_batches[1];
 SELECT batches_per_lot INTO v_norm FROM product WHERE id=v_product;
 IF v_norm IS NULL THEN RAISE EXCEPTION 'Het product heeft geen geldige lotgrootte'; END IF;
 IF v_aantal<>v_norm AND v_reden IS NULL THEN
  RAISE EXCEPTION 'Dit product vereist % batches per lot; geef een reden voor een afwijkend aantal',v_norm;
 END IF;
 SELECT * INTO v_lotstap FROM processtap WHERE is_lot_stap AND actief;
 IF NOT FOUND THEN RAISE EXCEPTION 'Er is geen actieve lotstap'; END IF;
 SELECT string_agg(probleem,'; ') INTO v_probleem FROM (
  SELECT b.batchnummer||' heeft status '||b.status AS probleem FROM batch b WHERE b.id=ANY(p_batches) AND b.status<>'in_productie'
  UNION ALL SELECT b.batchnummer||': '||s.code||' niet afgerond' FROM batch b
   CROSS JOIN LATERAL route(b.product_id) rt JOIN processtap s ON s.id=rt.processtap_id
   WHERE b.id=ANY(p_batches) AND s.niveau='batch' AND NOT batch_stap_gedaan(b.id,s.id)
  UNION ALL SELECT b.batchnummer||': herbewerking naar '||s.code||' nog niet gestart FROM herbewerking h
   JOIN batch b ON b.id=h.batch_id JOIN processtap s ON s.id=h.processtap_id
   WHERE h.batch_id=ANY(p_batches) AND h.status='open'
  UNION ALL SELECT 'onbekende batch '||x::text FROM unnest(p_batches) x WHERE NOT EXISTS(SELECT 1 FROM batch WHERE id=x)
 ) p;
 IF v_probleem IS NOT NULL THEN RAISE EXCEPTION 'Lot kan niet worden aangemaakt: %',v_probleem; END IF;
 FOR v_voorstel IN SELECT v.id,v.nummer,
  (SELECT array_agg(x.batch_id ORDER BY x.batch_id) FROM lot_voorstel_batch x WHERE x.voorstel_id=v.id) AS batches
  FROM lot_voorstel v WHERE v.status='open' AND EXISTS(
   SELECT 1 FROM lot_voorstel_batch x WHERE x.voorstel_id=v.id AND x.batch_id=ANY(p_batches)) FOR UPDATE OF v
 LOOP
  IF v_voorstel.batches<>(SELECT array_agg(b ORDER BY b) FROM unnest(p_batches) b) AND v_reden IS NULL THEN
   RAISE EXCEPTION 'Deze samenstelling wijkt af van lotvoorstel %; geef een reden',v_voorstel.nummer;
  END IF;
 END LOOP;
 INSERT INTO lot(id,lotnummer,batch_aantal_norm,batch_aantal,afwijking_reden)
 VALUES(coalesce(p_lot_id,gen_random_uuid()),p_lotnummer,v_norm,v_aantal,CASE WHEN v_aantal=v_norm THEN NULL ELSE v_reden END)
 RETURNING id INTO v_lot;
 UPDATE batch SET status='in_lot',lot_id=v_lot WHERE id=ANY(p_batches);
 UPDATE lot_voorstel v SET
  status=CASE WHEN (SELECT array_agg(x.batch_id ORDER BY x.batch_id) FROM lot_voorstel_batch x WHERE x.voorstel_id=v.id)
                   =(SELECT array_agg(b ORDER BY b) FROM unnest(p_batches) b) THEN 'gebruikt' ELSE 'afgeweken' END,
  afwijking_reden=CASE WHEN (SELECT array_agg(x.batch_id ORDER BY x.batch_id) FROM lot_voorstel_batch x WHERE x.voorstel_id=v.id)
                            =(SELECT array_agg(b ORDER BY b) FROM unnest(p_batches) b) THEN NULL ELSE v_reden END,
  lot_id=v_lot,afgesloten_op=now()
 WHERE v.status='open' AND EXISTS(SELECT 1 FROM lot_voorstel_batch x WHERE x.voorstel_id=v.id AND x.batch_id=ANY(p_batches));
 PERFORM set_config('fabriek.maak_lot','aan',true);
 INSERT INTO stapregistratie(id,processtap_id,lot_id,poging,pc_id,operator_id)
 VALUES(coalesce(p_registratie_id,gen_random_uuid()),v_lotstap.id,v_lot,1,p_pc,p_operator);
 PERFORM set_config('fabriek.maak_lot','uit',true);
 RETURN v_lot;
END $$;

CREATE OR REPLACE FUNCTION controleer_lot_voorstel(p_voorstel uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_dubbel text; v_norm int; v_product uuid;
BEGIN
 IF (SELECT status FROM lot_voorstel WHERE id=p_voorstel)<>'open' THEN RETURN; END IF;
 SELECT batch_aantal_norm INTO v_norm FROM lot_voorstel WHERE id=p_voorstel;
 IF (SELECT count(*) FROM lot_voorstel_batch WHERE voorstel_id=p_voorstel)<>v_norm THEN
  RAISE EXCEPTION 'Dit lotvoorstel moet precies % batches bevatten',v_norm;
 END IF;
 SELECT b.product_id INTO v_product FROM lot_voorstel_batch x JOIN batch b ON b.id=x.batch_id
  WHERE x.voorstel_id=p_voorstel LIMIT 1;
 IF v_product IS NULL OR EXISTS(SELECT 1 FROM lot_voorstel_batch x JOIN batch b ON b.id=x.batch_id
   WHERE x.voorstel_id=p_voorstel AND b.product_id IS DISTINCT FROM v_product) THEN
  RAISE EXCEPTION 'Een lotvoorstel bestaat uit batches van hetzelfde product';
 END IF;
 IF (SELECT batches_per_lot FROM product WHERE id=v_product) IS DISTINCT FROM v_norm THEN
  RAISE EXCEPTION 'De lotgrootte van het product is gewijzigd; bouw het voorstel opnieuw op';
 END IF;
 SELECT string_agg(b.batchnummer||' (voorstel '||v2.nummer||')',', ') INTO v_dubbel
  FROM lot_voorstel_batch x JOIN lot_voorstel_batch y ON y.batch_id=x.batch_id AND y.voorstel_id<>x.voorstel_id
  JOIN lot_voorstel v2 ON v2.id=y.voorstel_id AND v2.status='open' JOIN batch b ON b.id=x.batch_id
  WHERE x.voorstel_id=p_voorstel;
 IF v_dubbel IS NOT NULL THEN RAISE EXCEPTION 'Deze batches staan al in een ander open voorstel: %',v_dubbel; END IF;
 IF EXISTS(SELECT 1 FROM lot_voorstel_batch x JOIN batch b ON b.id=x.batch_id
  WHERE x.voorstel_id=p_voorstel AND b.status NOT IN ('gepland','in_productie','in_beoordeling')) THEN
  RAISE EXCEPTION 'Een lotvoorstel kan alleen batches bevatten die nog niet in een lot zitten, niet afgekeurd en niet vervallen';
 END IF;
END $$;

CREATE OR REPLACE FUNCTION bewaar_lot_voorstel(p_id uuid,p_batches uuid[],p_opmerking text,p_door uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid:=p_id; v_product uuid; v_norm int;
BEGIN
 IF p_batches IS NULL OR cardinality(p_batches) NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Een lotvoorstel bevat 1 tot 50 batches'; END IF;
 IF (SELECT count(DISTINCT b) FROM unnest(p_batches) b)<>cardinality(p_batches) THEN RAISE EXCEPTION 'Een lotvoorstel bevat geen dubbele batches'; END IF;
 SELECT b.product_id,p.batches_per_lot INTO v_product,v_norm FROM batch b JOIN product p ON p.id=b.product_id WHERE b.id=p_batches[1];
 IF v_product IS NULL THEN RAISE EXCEPTION 'Een lotvoorstel vereist batches met een product'; END IF;
 IF cardinality(p_batches)<>v_norm THEN RAISE EXCEPTION 'Dit product vereist % batches per lotvoorstel',v_norm; END IF;
 IF v_id IS NULL THEN
  INSERT INTO lot_voorstel(opmerking,aangemaakt_door,batch_aantal_norm)
  VALUES(nullif(btrim(p_opmerking),''),p_door,v_norm) RETURNING id INTO v_id;
 ELSE
  IF (SELECT status FROM lot_voorstel WHERE id=v_id) IS DISTINCT FROM 'open' THEN RAISE EXCEPTION 'Alleen een open voorstel kan worden gewijzigd'; END IF;
  UPDATE lot_voorstel SET opmerking=nullif(btrim(p_opmerking),''),batch_aantal_norm=v_norm WHERE id=v_id;
  DELETE FROM lot_voorstel_batch WHERE voorstel_id=v_id;
 END IF;
 INSERT INTO lot_voorstel_batch(voorstel_id,batch_id) SELECT v_id,unnest(p_batches);
 PERFORM controleer_lot_voorstel(v_id);
 RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION gewicht_per_item(p_product uuid,p_stap uuid) RETURNS numeric LANGUAGE sql STABLE AS $$
 SELECT p.batchgewicht_kg*CASE WHEN s.niveau='lot' THEN p.batches_per_lot ELSE 1 END
 FROM product p,processtap s WHERE p.id=p_product AND s.id=p_stap
$$;
ALTER FUNCTION verval_lotvoorstellen_bij_lotgrootte() SET search_path=fabriek,public;
ALTER FUNCTION maak_lot(text,uuid[],uuid,uuid,uuid,uuid,text) SET search_path=fabriek,public;
ALTER FUNCTION controleer_lot_voorstel(uuid) SET search_path=fabriek,public;
ALTER FUNCTION bewaar_lot_voorstel(uuid,uuid[],text,uuid) SET search_path=fabriek,public;
ALTER FUNCTION gewicht_per_item(uuid,uuid) SET search_path=fabriek,public;
