# Changelog

Eén versienummer voor het hele platform (`MAJOR.MINOR.PATCH`, zie D17 in `DECISIONS.md`). Alle gegevens zijn fictief.

## 0.5.1 — 18 november 2026
- Technisch: werkafspraken overgenomen uit de andere projecten: `CLAUDE.md`, `NOTES.md`, `DECISIONS.md` (D1–D20) en `WISHLIST.md`.
- Technisch: bij elke push draaien op GitHub automatisch de databaseregels, de API-tests en de controle en bouw van de schermen.
- Technisch: voor elke nieuwe versie maakt GitHub automatisch een tag en een release met de tekst uit deze changelog.
- Verbeterd: de handleiding in het laptoppakket heet nu `README.md`.

## 0.5.0 — 18 november 2026
- Nieuw: laptoppakket. Met `START.bat` maak je de database aan, laad je 90 dagen fictieve productie (tot vandaag) en start je alles op http://localhost:3000/.
- Nieuw: browserdemo. Het hele platform draait in de browser, zonder server, als privépagina. Invoerscherm en portalen ook naast elkaar.
- Nieuw: startpagina met links naar invoerscherm, portalen en API-documentatie.
- Nieuw: versienummer zichtbaar op de startpagina en in de portalen.
- Opgelost: de server vond de schermen niet op Windows.

## 0.4.0 — 18 november 2026
- Nieuw: Portaal Beheer: stappen en velden, accounts, operators, pc's met hun stappen, logboek van elke wijziging.
- Nieuw: Portaal Productie: werkvoorraad, doorlooptijden, productie per week, correcties.
- Nieuw: Portaal Kwaliteit: overzicht, te beoordelen (OK/NOK), lotpaspoort, afwijkingen, trend per veld, herbewerkingen en afkeur.
- Nieuw: een ploegleider of Kwaliteit zet een batch in beoordeling; alleen Kwaliteit keurt. Bij NOK worden open stappen afgebroken.
- Nieuw: generator voor fictieve testdata met ingebouwde patronen.

## 0.3.0 — november 2026
- Nieuw: lot samenstellen in PS16 (4 batches, geen open stappen), lotstappen PS17–18 en herbewerking van een lot.

## 0.2.0 — november 2026
- Nieuw: invoerscherm dat offline blijft werken, met pc- en naamkeuze, waarschuwing bij afwijkende waarden en correcties door de ploegleider.

## 0.1.0 — november 2026
- Nieuw: datamodel en databaseregels, API met beschrijving van alle functies.
