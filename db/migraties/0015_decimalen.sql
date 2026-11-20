-- Migratie 0015 (versie 0.23.0): aantal decimalen per veld.
-- Leeg = zoals voorheen (het scherm toont tot 3 decimalen). Met een getal tonen invoerscherm,
-- lotpaspoort, certificaat en regelkaart de waarden met precies zoveel decimalen. De opgeslagen
-- meetwaarde verandert niet.
SET search_path = fabriek, public;
ALTER TABLE veld ADD COLUMN decimalen smallint CHECK (decimalen BETWEEN 0 AND 6);

-- Het lotpaspoort toont de decimalen van het veld (kolom achteraan).
CREATE OR REPLACE VIEW lotpaspoort AS
SELECT l.lotnummer,
       coalesce(b.batchnummer, l.lotnummer)  AS batch_of_lot,
       s.code      AS stap,
       s.volgorde,
       r.poging,
       r.herbewerking_start,
       r.reden     AS herbewerking_reden,
       v.code      AS veld,
       v.naam      AS veldnaam,
       v.eenheid,
       w.setting,
       w.gemeten,
       w.grens_min, w.grens_max, w.tolerantie, w.tolerantie_soort,
       w.markering,
       (w.vervangt_waarde_id IS NOT NULL) AS gecorrigeerd,
       o.naam      AS operator,
       p.naam      AS pc,
       r.afgerond_op,
       v.decimalen   -- sinds migratie 0015
FROM lot l
JOIN stapregistratie r
  ON r.lot_id = l.id
  OR r.batch_id IN (SELECT id FROM batch WHERE lot_id = l.id)
LEFT JOIN batch b ON b.id = r.batch_id
JOIN processtap s ON s.id = r.processtap_id
JOIN waarde_actueel w ON w.stapregistratie_id = r.id
JOIN veld v ON v.id = w.veld_id
JOIN operator o ON o.id = r.operator_id
JOIN pc p ON p.id = r.pc_id;
