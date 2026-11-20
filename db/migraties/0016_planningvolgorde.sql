-- Migratie 0016 (versie 0.26.0): waarschuwing als je een stap plant vóór de vorige stap (D52).
-- Alleen een functie erbij; niets aan bestaande tabellen.
SET search_path = fabriek, public;

-- Hoe staat de vorige stap ervoor als je een batch of lot op een dag in een stap plant? (sinds migratie 0016)
-- De planning blijft een richtlijn (D29): de schermen waarschuwen hiermee, er wordt niets geweigerd (D52).
-- stand: 'eerste'       geen vorige stap
--        'klaar'        vorige stap afgerond (de laatste poging)
--        'bezig'        vorige stap staat open
--        'vandaag'      vorige stap gepland op dezelfde dag (nr = plek in de volgorde van die dag)
--        'eerder'       vorige stap gepland op een eerdere dag die nog moet komen (of vandaag is): in orde
--        'achter'       vorige stap gepland op een dag die al voorbij is, en nog niet klaar
--        'later'        vorige stap pas op een latere dag gepland
--        'niet_gepland' vorige stap niet gepland en niet gedaan
-- De startdag van een geplande batch (Planning → Per week) telt als planning van de eerste batchstap.
CREATE FUNCTION planning_vorige_stap(p_stap_id uuid, p_batch_id uuid, p_lot_id uuid, p_dag date)
RETURNS TABLE (stand text, vorige text, dag date, nr int) LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_stap    processtap%ROWTYPE;
    v_vorige  processtap%ROWTYPE;
    v_status  text;
    v_vandaag date := (now() AT TIME ZONE fabriekstijdzone())::date;
BEGIN
    SELECT * INTO v_stap FROM processtap WHERE id = p_stap_id;
    SELECT * INTO v_vorige FROM processtap
     WHERE actief AND niveau = v_stap.niveau AND volgorde < v_stap.volgorde
     ORDER BY volgorde DESC LIMIT 1;
    IF NOT FOUND THEN
        RETURN QUERY SELECT 'eerste'::text, NULL::text, NULL::date, NULL::int; RETURN;
    END IF;
    -- Een lot bestaat pas na de lotstap: die is dan altijd gedaan.
    IF v_vorige.is_lot_stap THEN
        RETURN QUERY SELECT 'klaar'::text, v_vorige.code, NULL::date, NULL::int; RETURN;
    END IF;
    SELECT r.status INTO v_status FROM stapregistratie r
     WHERE r.processtap_id = v_vorige.id
       AND (r.batch_id = p_batch_id OR r.lot_id = p_lot_id)
       AND r.status <> 'afgebroken'
     ORDER BY r.poging DESC LIMIT 1;
    IF v_status = 'afgerond' THEN
        RETURN QUERY SELECT 'klaar'::text, v_vorige.code, NULL::date, NULL::int; RETURN;
    ELSIF v_status = 'open' THEN
        RETURN QUERY SELECT 'bezig'::text, v_vorige.code, NULL::date, NULL::int; RETURN;
    END IF;
    RETURN QUERY
    WITH plan AS (
        SELECT sp.dag, sp.volgorde FROM stapplanning sp
         WHERE sp.processtap_id = v_vorige.id
           AND (sp.batch_id = p_batch_id OR sp.lot_id = p_lot_id)
        UNION ALL
        SELECT b.geplande_dag, b.volgorde FROM batch b
         WHERE b.id = p_batch_id AND b.geplande_dag IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM processtap s WHERE s.actief AND s.niveau = 'batch' AND s.volgorde < v_vorige.volgorde)
    )
    SELECT CASE
             WHEN EXISTS (SELECT 1 FROM plan WHERE plan.dag = p_dag) THEN 'vandaag'
             WHEN EXISTS (SELECT 1 FROM plan WHERE plan.dag < p_dag AND plan.dag >= v_vandaag) THEN 'eerder'
             WHEN EXISTS (SELECT 1 FROM plan WHERE plan.dag < p_dag) THEN 'achter'
             WHEN EXISTS (SELECT 1 FROM plan) THEN 'later'
             ELSE 'niet_gepland'
           END,
           v_vorige.code,
           coalesce((SELECT max(plan.dag) FROM plan WHERE plan.dag <= p_dag), (SELECT min(plan.dag) FROM plan)),
           (SELECT min(plan.volgorde) FROM plan WHERE plan.dag = p_dag);
END $$;
ALTER FUNCTION planning_vorige_stap(uuid, uuid, uuid, date) SET search_path = fabriek, public;
