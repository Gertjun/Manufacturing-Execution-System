# MES visuele ontwerpstandaard — v0 (voorstel ter uitwerking)
 
Bron: D107, D50, D63, D64, D70 en D105/D111. ISA-88/95 en goedgekeurde architectuur blijven leidend; vormgeving wijzigt geen rechten, processen of fysieke relaties.

| Tokenconcept | Kleur | Betekenis |
|---|---|---|
| Structuur | #0B2E59 | Titels, definities, masterdata, recepten, specificaties, rollen |
| Uitvoering | #F28C28 | Actie, proces, batches, metingen, besluiten |
| Structuurvlak | #E7EEF6 | Structurele blokken |
| Uitvoeringsvlak | #FDEBD9 | Uitvoeringsblokken |
| Achtergrond | #F4F7F9 | Algemeen |

Grijs voor ondersteuning en databaserelaties; groen/rood uitsluitend expliciete status. Waarschuwingen onderscheiden van regulier oranje met tekst, symbool en eigen token. Planning: donkerblauw afgerond, oranje actief, lichtgrijs toekomstig, altijd tekststatus.

## UI
Uitgangspunt bestaande Atkinson Hyperlegible, 4/8-puntsraster, 44 px aanraakdoelen, bestaande D64-breekpunten. Centrale tokens in gedeeld/tokens.css; gedeelde helpers in gedeeld/ui.ts, knoppen en portaalstijl. Titel links, acties/filters rechts waar ruimte; op smalle schermen logisch stapelen. Tabellen behouden koppen, betekenis, leesvolgorde en eigen scrollvak waar nodig. Eén herkenbaar patroon voor formulieren, labels, foutmelding, bevestiging, leeg/laden, focus, selectie en status. Bekijken, wijzigen, beoordelen en vrijgeven duidelijk onderscheiden; historische revisies herkenbaar en niet stilzwijgend wijzigbaar. Datum, tijdzone, ingangsdatum en besluitmoment expliciet onderscheiden. Behoud toetsenbordbediening en veilige foutafhandeling. Contrast per combinatie toetsen; WCAG 2.2 AA voorgesteld als toetskader, toepasselijkheid nog vastleggen. Geen witte tekst op oranje zonder contrastbewijs; geen status alleen via kleur.

## Diagrammen en documenten
Masterdata blauw/lichtblauw; transacties oranje/lichtoranje. Oranje procespijlen, neutraal grijze FK-relaties; pijlen aan randen, geen overlap met tekst, legenda en korte Nederlandstalige functieomschrijving. SQL blijft bron voor fysieke ERD; generator en integriteitscontroles behouden. Voorbeeld goed: blauwe receptdefinitie naast oranje vrijgavebesluit, grijze FK en afzonderlijke procespijl. Ongewenst: willekeurig wisselende kleuren of FK als procesvolgorde. Naslagwerk afzonderlijk actualiseren na vaststelling.

## Borging
Inventariseer bestaande schermen, CSS, documenten en afwijkingen. Test contrast, focus, zes formaten, visuele regressies en consistente componenten. Geen nieuwe domeinfunctionaliteit. Dit document is ontwerpstart, geen bewijs van implementatie of acceptatie.
