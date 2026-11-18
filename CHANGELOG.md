# Wijzigingen

Eén versienummer voor het hele platform (server, invoerscherm, portalen). Zetten met `tools/zet_versie.sh`.
Tot de pilot met echte data blijven we onder 1.0; versie 1.0.0 is de start van de pilot.
Alle gegevens in deze repository zijn fictief.

Schema: `MAJOR.MINOR.PATCH`. MINOR voor nieuwe onderdelen of een databasewijziging, PATCH voor reparaties.

## 0.5.0 – 18-11-2026
- Laptoppakket: `START.bat` maakt de database aan, laadt 90 dagen fictieve testdata (verschoven naar vandaag) en start alles op http://localhost:3000/.
- Startpagina op `/` met links naar invoerscherm, portalen en API-documentatie, en het versienummer.
- Versienummer zichtbaar in de portalen en in `/gezondheid`.
- Reparatie: paden naar de schermen werken nu ook op Windows.
- Browserdemo (alles in de browser, PostgreSQL via PGlite) om te laten zien waar we staan.

## 0.4.0 – 18-11-2026
- Portaal Beheer: stappen en velden, accounts, operators, pc's met stapkoppeling, logboek.
- Logboek ook voor accounts, operators en pc's; wachtwoorden nooit in het logboek; altijd minstens één actieve beheerder.
- Portaal Productie: werkvoorraad, doorlooptijden, productie per week, correcties.
- Portaal Kwaliteit: overzicht, te beoordelen (OK/NOK), lotpaspoort, afwijkingen, trend, herbewerkingen, afkeur.
- Beoordeling: ploegleider of Kwaliteit zet in beoordeling, alleen Kwaliteit keurt; bij NOK worden open stappen afgebroken.
- Generator voor fictieve testdata (90 dagen met ingebouwde patronen).

## 0.3.0
- Lot samenstellen in PS16 (4 batches, geen open stappen), lotstappen PS17–18, herbewerking van een lot.

## 0.2.0
- Invoerscherm (PWA) met offline wachtrij, pc- en operatorkeuze, markering buiten tolerantie/grens, correcties door ploegleider.

## 0.1.0
- Datamodel en databaseregels (PostgreSQL), API met OpenAPI-beschrijving.
