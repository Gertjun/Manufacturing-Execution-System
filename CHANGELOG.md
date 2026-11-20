# Changelog – wat is er per versie veranderd

> **Dit bestand:** per versie wat er nieuw of anders is, in gewone taal. Het is de enige geschiedenis van het project.
> **Niet hier:** waarom iets zo is gekozen → [`DECISIONS.md`](DECISIONS.md); wat er nog komt → [`ROADMAP.md`](ROADMAP.md).

Eén versienummer voor het hele platform (`MAJOR.MINOR.PATCH`, D17). Achter de datum staan de nummers van de roadmappunten die in die versie zijn gebouwd. Alle gegevens zijn fictief.

## Zonder nieuwe versie (na 0.26.1)
- Geerts lijst met 21 ideeën na de eerste demo verwerkt in de roadmap: nieuwe fase A2 (#49–#62, #64) en punten in F, G en Te besluiten (#55, #63, #65–#71). Punt 13 (trend per veld) zat in 0.26.1. Besluiten D53 (eigen inlog), D54 (één app met startpagina) en D55 (route per product). De pilotdatum schuift naar schatting twee weken (#70).

## 0.26.1 — 20 november 2026
- Kwaliteit → Trend per veld: de waarde onder de muis klopt weer. De grafiek rekende de muispositie uit ten opzichte van een icoontje in de legenda, waardoor altijd de laatste meting verscheen. In dezelfde uitleg staat nu "instelling" in plaats van "setting" (D51). De schermtest controleert dit nu.

## 0.26.0 — 20 november 2026
- Nieuw: **Planning waarschuwt als de vorige stap niet op tijd is** (D52). Plannen mag nog steeds; je ziet alleen een ⚠ met uitleg, zoals "PS1 is nog niet gepland", "PS1 is pas gepland op ma 23-11" of "PS1 stond op do 19-11 en is nog niet klaar".
  - Bij Toevoegen in Per stap staat wat je kunt plannen in drie groepen: "Staat klaar", "Komt op tijd klaar" en "⚠ Vorige stap niet op tijd". De melding na het toevoegen zegt erbij als er iets met waarschuwing tussen zit.
  - In de lijst per stap staat de waarschuwing bij het item, en in de stappenlijst links een ⚠ bij stappen met zo'n item.
- Nieuw, als **proef** om te vergelijken (#48): **Dagoverzicht** (alle 18 stappen van één dag onder elkaar) en **Batchroute** (per batch die nog niet in een lot zit: per stap ✓ klaar, ▶ bezig of de geplande dag, met ⚠ en een filter "Met waarschuwing"). Klik op een stap of een geplande dag om die te wijzigen.
- Database: migratie 0016 voegt de functie `planning_vorige_stap` toe; er verandert niets aan bestaande gegevens. De API geeft bij geplande items en bij kandidaten een veld `vorige` mee; oudere invoerschermen negeren dat.

## Zonder nieuwe versie (na 0.25.0)
- Roadmap #11: verwijst naar het laptoppakket van de nieuwste versie in plaats van 0.23.0.
- Schermtest portaal: de controle "menu weer dicht na kiezen" wacht nu tot het menu opnieuw getekend is (faalde op GitHub doordat hij te vroeg keek).

## 0.25.0 — 20 november 2026 · #44
- Nieuw: **Ongedaan maken.** Na het uitzetten van een veld, grondstof, operator, ploeg, oorzaak van stilstand of pc staat in de melding een knop "Ongedaan maken" (6 seconden, langer zolang de muis erop staat). Velden en grondstoffen uitzetten vraagt daarom niet meer vooraf om bevestiging. Accounts uitzetten blijft wel vooraf bevestigen, net als alles wat daarna vastligt (D50).
- Nieuw: op een smal scherm of tablet staat het menu van de portalen dicht achter de knop "Menu", met de naam van het scherm waar je bent. De inhoud staat meteen bovenaan; Meldingen blijven altijd zichtbaar.
- De UI/UX-review is hiermee verwerkt (#41–#44). Nog niet in de praktijk getest: het menu en de knoppen op een echte tablet (#33).

## 0.24.1 — 20 november 2026 · #43
- Vaste woorden (D51): "Instelling" in plaats van "Setting" in het invoerscherm, de afwijkingen, het lotpaspoort en Beheer. In de database en de API blijft het `setting`.
- Foutmeldingen staan nu direct onder het veld, met ⚠ en een uitleg hoe je het oplost ("Vul een getal in, bijvoorbeeld 86,5"). Ze verschijnen pas als je de rij verlaat, niet tijdens het typen; de markering binnen of buiten tolerantie blijft wel direct zichtbaar (D50). Onderin staat ook waarom "Stap afronden" nog niet kan.
- Statuskleuren met één betekenis: "In beoordeling" is geel (wacht op Kwaliteit) in plaats van oranje, en "Nu stil" in Productie → Stilstand is rood, zoals in het invoerscherm en op het wandscherm.
- Tabellen: kolommen met alleen getallen (ook met eenheid of duur, zoals "2 u 51") staan rechts uitgelijnd, de kop erboven ook.
- Knoppen in de portalen: alle gewone knoppen hebben dezelfde rand; alleen de hoofdknop is gevuld.
- Stappen zonder werk zijn rustiger (in het invoerscherm en in Productie → Werkvoorraad), zodat stappen met werk opvallen.

## 0.24.0 — 20 november 2026 · #42
- Nieuw: één gedeeld bestand met alle kleuren, afstanden, tekstgroottes en rondingen (`gedeeld/tokens.css`) voor invoerscherm en portalen. Beide apps gebruiken alleen nog die waarden; afstanden liggen op een raster van 4 en 8 px. Kleine verschillen tussen de apps (twee grijzen voor randen) zijn weg.
- Knoppen die iets versturen zijn meteen niet nogmaals te klikken tot het antwoord er is; duurt het langer dan 0,4 s, dan verschijnt een draaiend rondje. Zo kan een dubbele klik geen dubbele invoer meer geven.
- Knoppen in de portalen zijn minstens 44 px hoog; kleine knoppen (zoals "Naar Excel" en de pijltjes in Planning) zijn 36 px om te zien, maar hun klikzone is 44 px. Menu-items in de portalen zijn ook 44 px hoog.
- De tekstgrootte volgt nu de instelling van de browser (bij de standaardinstelling blijft alles even groot). Titels in de portalen zijn iets kleiner (24 px), volgens de vaste tekstschaal.

## 0.23.2 — 20 november 2026 · #41
Eerste versie uit de UI/UX-review van 0.23.1. Alle schermen zijn nagelopen tegen de richtlijnen in het Claude-project; wat eruit volgde staat als #41–#44 in de roadmap, de bewuste afwijkingen in D50 en de vaste woorden in D51. Nieuwe roadmappunten voor later: talenkeuze (#45), donkere modus (#46) en invoer via telefoon of tablet (#47).
- Grafieken beter leesbaar: oranje, grijs en de rand van "Gepland" halen nu minstens 3 : 1 op wit. "Buiten grens" en "Storing" zijn rood met witte strepen, zodat ze ook zonder kleurenzien te onderscheiden zijn van oranje; "Gepland" is een open staaf. Afwijkingen per week toont het totaal boven elke staaf.
- Invoervelden in Planning → Capaciteit en Beheer → Bedrijfsgegevens, en het tekstvak van de ploegoverdracht, hebben dezelfde duidelijke rand als de andere velden. Stille knoppen hebben een donkerdere rand.
- Wandscherm: stappen zonder werk zijn rustig maar weer leesbaar (geen doorzichtigheid meer).
- Beheer → Stappen en velden: de knop "Sjabloon inlezen" staat recht.

## Zonder nieuwe versie (na 0.23.0)
- Handleiding van het laptoppakket noemt nu ook Portaal Planning en het wandscherm. Overbodige notitie `gedeeld/README.md` weggehaald (de README beschrijft de map al).
- Documenten opnieuw ingedeeld naar verleden, heden en toekomst (D48): de stand staat nu bovenaan de README (`NOTES.md` vervalt), de wishlist is opgegaan in de roadmap (`WISHLIST.md` vervalt), en de changelog noemt achter elke versie de nummers van de gebouwde punten. Nieuw roadmappunt #40: releases op GitHub weer laten werken.
- Releases op GitHub (#40): de workflow zet eerst de tag met git en maakt daarna de release, gaat na een mislukte versie door met de volgende en meldt aan het eind welke versies niet lukten. Hij gebruikt de eigen sleutel `RELEASE_TOKEN` als die als secret is ingesteld: de ingebouwde sleutel van GitHub mag geen tag zetten op een versie waarin de workflowbestanden anders zijn dan nu. Met die sleutel zijn de releases 0.21.1 tot en met 0.23.0 alsnog gemaakt.

## 0.23.1 — 20 november 2026
- **Opgelost:** de browserdemo startte niet meer ("File is corrupted"). De demo haalt de database nu in delen van hoogstens 4 MB op, controleert lengte en controlesom en pakt hem zelf uit; ook het pakket van de uitbreiding pgcrypto wordt eerst gecontroleerd. Lukt het toch niet, dan noemt de melding welke stap misging (downloaden, uitbreiding, openen of starten).
- Nieuw op GitHub: bij elke release hangt het laptoppakket voor Windows als bijlage (`batch-gui-laptop-<versie>-windows.zip`, onder "Assets"). De workflow Laptoppakket bouwt het na elke release, en heeft de pakketten van eerdere versies vanaf 0.7.0 alsnog gemaakt, behalve 0.14.0 en 0.15.0 (D49).

## 0.23.0 — 20 november 2026 · #39
- Nieuw: per veld het **aantal decimalen** (0 tot en met 6) in Beheer → Stappen en velden en in het Excel-sjabloon (kolom Decimalen). Het invoerscherm, het lotpaspoort, de afwijkingen, het certificaat en de regelkaart tonen de waarden dan met precies zoveel cijfers achter de komma; gemiddelde en spreiding op de regelkaart met één cijfer meer. Leeg = zoals voorheen. De opgeslagen meetwaarde verandert niet. In de fictieve configuratie hebben temperaturen 1 decimaal, druk en vochtgehalte 2 en het toerental 0.
- Een sjabloon zonder kolom Decimalen (van vóór deze versie) laat de decimalen ongemoeid.
- **Opgelost:** een 0 werd door de server soms als leeg opgeslagen, bijvoorbeeld een setting van 0, een ondergrens van 0 of decimalen 0. Elke 0 blijft nu een 0.
- Beheer → Server: actieve testaccounts met wachtwoord "demo" staan nu als opmerking onder de status en tellen niet meer als waarschuwing; met testdata blijft de status "In orde".
- Technisch: database-update 15 (`0015_decimalen`) wordt bij de start automatisch uitgevoerd.

## 0.22.2 — 20 november 2026 · #38
- Inlogpogingen worden 90 dagen bewaard. Oudere ruimt het onderhoud op: op de server de back-up (elk uur), op de laptop het opstarten. Het onderhoudslogboek in Beheer → Server noemt hoeveel er zijn opgeruimd.
- Technisch: database-update 14 (`0014_opruimen`) met de functie `ruim_inlogpogingen_op()`; alleen het onderhoud kan die aanroepen, de applicatie niet.

## 0.22.1 — 20 november 2026 · #37
- De startpagina (`/`) noemt "Testomgeving met fictieve gegevens" en de testaccounts alleen nog als die accounts er echt zijn. In een lege fabriek of een echte installatie staan alleen de applicaties en het versienummer.
- Beheer → Server waarschuwt als er testaccounts met wachtwoord "demo" actief zijn. Met testdata is dat normaal; in een echte installatie zet je ze uit.
- De startpagina noemt nu ook Planning, het wandscherm en de testaccounts planner1 en scherm1.

## 0.22.0 — 19 november 2026 · #35
- Nieuw in Beheer → Stappen en velden: **Sjabloon downloaden** geeft een Excel-bestand met alle velden van alle stappen (ook uitgezette). Daarin kun je velden aanpassen en nieuwe velden toevoegen (Code leeg laten).
- **Sjabloon inlezen** controleert het bestand eerst: per regel zie je of het een nieuw veld, een wijziging (met oud en nieuw) of ongewijzigd is, en welke regels een fout hebben. Er wordt pas iets opgeslagen als je op "wijzigingen opslaan" klikt, en alleen als geen enkele regel een fout heeft. Alles komt in het logboek.
- Een veld verandert niet van stap of soort via het sjabloon, en velden die niet in het bestand staan blijven zoals ze zijn. Nieuwe velden krijgen de volgende vrije code, zoals altijd.
- Technisch: geen database-update. De controle gebruikt de echte databaseregels in een transactie die wordt teruggedraaid (D46).

## 0.21.1 — 19 november 2026 · #27
- Voor IT: `migreer.mjs` maakt vóór een database-update eerst een back-up (`batchgui_<datum_tijd>_voor-migratie-<nummer>.dump`) als er een back-upmap is ingesteld. Mislukt die back-up, dan verandert er niets.
- Het draaiboek voor de fabrieksserver (`docs/SERVER.md`) is bijgewerkt tot deze versie, met de klok en tijdzone, de inlogbeveiliging en de beveiligingskoppen.
- De schermtests in Chrome (invoerscherm, alle portalen en de browserdemo) draaien nu ook automatisch op GitHub (`tests/test_schermen.sh`). Twee tests wachten nu tot het scherm klaar is in plaats van te snel te tellen.

## 0.21.0 — 19 november 2026 · #28
- Na 5 verkeerde wachtwoorden voor dezelfde gebruikersnaam binnen 15 minuten moet je 1 minuut wachten. Het scherm zegt hoe lang.
- Elke inlogpoging wordt vastgelegd (gebruikersnaam, pc, gelukt of niet; nooit het wachtwoord). Beheer → Server waarschuwt bij 20 of meer mislukte pogingen in 24 uur.
- Hoofdletters in de gebruikersnaam tellen niet meer mee: "Kwaliteit1" is hetzelfde account als "kwaliteit1".
- Nieuwe en opnieuw ingestelde wachtwoorden worden sterker versleuteld. Bestaande wachtwoorden blijven werken.
- De server stuurt beveiligingskoppen mee: pagina's laden alleen scripts en gegevens van de eigen server en kunnen niet in een andere site worden ingebed.
- Technisch: database-update 13 (`0013_inloggen`) wordt bij de start automatisch uitgevoerd (D45).

## 0.20.2 — 19 november 2026 · #29
- Een regelkaart met minder dan 20 metingen staat als "voorlopig": de grenzen en signalen zijn dan een eerste indruk en er staat geen Cpk. In het overzicht staat "nog te weinig metingen" in plaats van een Cpk.
- Lijsten die op hun maximale lengte zitten, zeggen dat nu: afwijkingen (500), trend per veld (5000), grondstoffen terugzoeken (1000), logboek (300) en meldingen (200). Ook in de Excel-export staan dan alleen die regels.
- De trend per veld toont bij heel veel metingen de nieuwste 5000 (eerst waren het de oudste).

## 0.20.1 — 19 november 2026 · #25, #26
- De tijdzone staat vast op die van de fabriek (Europe/Amsterdam). Ploegen, "vandaag" en de weekindeling volgden de tijdzone van de computer waarop de database draait; op een server met UTC schoven de ploegen een of twee uur.
- De nachtploeg rond de wisseling van zomer- en wintertijd klopt. In de nacht van de wintertijd duurt hij 9 uur (05:30 hoorde eerst bij geen enkele ploeg), in de nacht van de zomertijd 7 uur (eerst overlapte hij een uur met de ochtendploeg).
- De periodekeuze in de portalen (bijvoorbeeld "laatste 7 dagen") gaf tussen middernacht en 01:00 of 02:00 een dag te vroeg als begin.
- Technisch: database-update 12 (`0012_tijdzone`) wordt bij de start automatisch uitgevoerd; de opgeslagen tijden veranderen niet (D44).

## 0.20.0 — 19 november 2026 · #23, #24
- Wat offline is ingevoerd, krijgt nu het moment van invoer op de pc in plaats van het moment van versturen. Dat geldt voor het starten en afronden van een stap, meetwaarden en grondstoffen. Doorlooptijden, wachttijden en ploegcijfers kloppen daardoor ook na een periode zonder verbinding.
- Loopt de klok van een pc voor of achter, dan wordt dat gecorrigeerd. Een moment in de toekomst, of van meer dan 7 dagen geleden, wordt de servertijd. Een stap start nooit vóór het afronden van de vorige, en wordt nooit afgerond vóór hij gestart is.
- De wachtrij onthoudt wie iets invoerde. Logt operator A uit terwijl er nog acties wachten en logt B in, dan blijft het werk van A op naam van A. Het wachtrijscherm toont per actie de naam.
- Afmelden met wachtende acties vraagt eerst om bevestiging. De browser wordt gevraagd de wachtrij niet op te ruimen bij weinig schijfruimte.
- Technisch: database-update 11 (`0011_apparaattijd`) wordt bij de start automatisch uitgevoerd. Het moment van aankomst op de server wordt apart bewaard (leeg bij oudere regels). Oudere invoerschermen blijven werken: zonder de nieuwe gegevens geldt de servertijd, zoals voorheen (D18, D43).

## Zonder nieuwe versie (na 0.19.0)
- Werkafspraken: de skillpakketten coding-skills, data en claude-for-manufacturing horen bij het project (D40).
- Documenten opnieuw ingedeeld: elk onderwerp op één plek (D41). README begint met "Waar vind je wat"; open punten en praktijktests staan alleen nog in de wishlist; de notities tonen alleen de stand van nu. De adviezen uit de doorlichting van 19-11-2026 staan als #23–#33 in de wishlist.
- Roadmap toegevoegd (`ROADMAP.md`, D42): fasen A tot en met G met poorten en een globale planning tot na de pilot. Nieuwe wishlistpunten #35 (velden importeren uit Excel) en #36 (training en handleiding).
- Schermtests portaal en grondstoffen bijgewerkt; de browserdemo maakt zijn database opnieuw als schema of testdata nieuwer is.

## 0.19.0 — 19 november 2026 · #20
- Nieuw: boven elke tabel in de portalen staat de knop "Naar Excel". Die maakt direct een Excel-bestand (.xlsx) van de tabel zoals je hem ziet, met de kop van de pagina en de datum in de bestandsnaam.
- Aantallen en meetwaarden worden echte getallen in Excel (ook met een komma als decimaalteken), zodat je er meteen mee kunt rekenen of filteren. De kopregel staat vast en heeft een filter. Knoppen en lege kolommen gaan niet mee.
- Technisch: geen database-update en geen API-wijziging; het bestand wordt in de browser gemaakt en werkt dus ook offline (D39).

## 0.18.0 — 19 november 2026 · #19
- Nieuw: Portaal Kwaliteit → Regelkaarten. Het overzicht laat per veld zien hoeveel metingen en signalen er in de periode zijn, en hoeveel marge er is tot de specificatie (Cpk). Velden met signalen staan bovenaan.
- Per veld een regelkaart met de metingen, het gemiddelde, de regelgrenzen (3 sigma) en de zones van 1 en 2 sigma. Bij een procesparameter tekent de kaart het verschil tussen gemeten en setting; bij andere velden de gemeten waarde, met de specificatie erbij.
- Een signaal (rood ruitje) volgt de vier Western Electric-regels: één punt buiten 3 sigma; 2 van 3 punten buiten 2 sigma; 4 van 5 punten buiten 1 sigma; 8 punten op rij aan dezelfde kant. Een signaal betekent dat het proces verandert, vaak al vóórdat er een afwijking is. Onder de kaart staat een lijst met de signalen.
- Technisch: geen database-update; de berekening zit in de API (`api/src/regelkaart.ts`, met eigen tests).

## 0.17.0 — 19 november 2026 · #18
- Nieuw: certificaat per lot (analysecertificaat voor de klant). In het lotpaspoort staat "Certificaat". Daar zie je per kenmerk de specificatie, het resultaat (bij batchkenmerken van laag tot hoog, met het gemiddelde over de 4 batches) en of het lot voldoet. Ook staan erop: de batches, het product en de grondstofpartijen, en de verklaring van het bedrijf.
- Kwaliteit geeft het certificaat uit met "Uitgeven". Dat kan alleen als het lot gereed is, alle kenmerken gemeten zijn en binnen de specificatie vallen, en geen batch is afgekeurd. Het certificaat krijgt een volgnummer en wordt bewaard zoals het is uitgegeven, zodat een herdruk precies gelijk is. Tot het uitgeven staat er "CONCEPT" op.
- Afdrukken of als pdf bewaren gaat via de browser; er komt alleen het certificaat op papier.
- Nieuw in Portaal Beheer: bij elk veld kies je of het op het certificaat komt. Onder "Bedrijfsgegevens" stel je de bedrijfsnaam, het adres en de verklaring in. De fictieve configuratie zet druk (S3.3), toerental (S7.3), gewicht (S17.2, S18.2) en vochtgehalte (S18.3) op het certificaat.
- Technisch: database-update 10 (`0010_certificaat`).

## 0.16.0 — 19 november 2026 · #17
- Nieuw: capaciteit in de planning. In Portaal Planning → Capaciteit leg je per weekdag vast hoeveel batches de fabriek aankan. Daarnaast kun je afwijkende dagen vastleggen met een reden, zoals een feestdag of onderhoud.
- In de weekplanning staat per dag hoe vol hij is ("4 / 6" met een balk). Een dag met meer batches dan de capaciteit wordt geel met ⚠. Bovenaan zie je hoeveel ruimte er deze week nog is.
- Plannen boven de capaciteit kan nog steeds. Het scherm vraagt dan eerst of je het zeker weet, en meldt het daarna nog eens.
- Fictieve capaciteit: 6 batches per dag. In de testdata heeft een dag over drie dagen een lagere capaciteit (onderhoud) en is die dag te vol gepland.
- Technisch: database-update 9 (`0009_capaciteit`).

## 0.15.1 — 19 november 2026
- Opgelost: het laptoppakket startte sinds 0.14.0 niet bij de eerste start met testdata. Bij het verschuiven van de testdata naar vandaag lag het einde van een stilstand even vóór het begin. Nu schuiven alle tijden van een tabel tegelijk. De browserdemo had hetzelfde probleem.

## 0.15.0 — 19 november 2026 · #5
- Nieuw: etiketten met barcode (Code 128). In Portaal Planning staat bij elke dag "Etiketten" voor de geplande batches. In het lotpaspoort staat "Etiket" voor het lot. In het invoerscherm staat in elke registratie "Etiket printen".
- Twee formaten: een etiketprinter (100 × 50 mm, één etiket per pagina) of een A4-vel met 3 × 7 etiketten (63,5 × 38,1 mm). Afdrukken gaat via de browser, zonder extra software. Het invoerscherm onthoudt per pc welk formaat je gebruikt.
- Nieuw: scannen met een gewone handscanner (die werkt als toetsenbord). In een stap opent een scan de batch als die al bezig is, of start hem als hij klaarstaat. In de lot-stap vinkt een scan de batch aan. Op andere schermen zoekt een scan de batch of het lot op. Ook een partijnummer van een grondstof kun je in het invoerveld scannen.
- Verbeterd: een fout in de schermtest van het invoerscherm (0.14.0) is hersteld.

## 0.14.0 — 19 november 2026 · #16
- Nieuw: stilstand melden. In het invoerscherm staat bij elke stap "Stilstand melden": kies de oorzaak (storing, wachten, gepland of overig) en eventueel een toelichting. Een rode balk laat zien dat de stap stilligt, tot iemand op "Stilstand beëindigen" drukt. Dat werkt ook zonder verbinding.
- Bij een storing krijgt de ploegleider een melding. Op het wandscherm wordt de stap rood met ⛔.
- Nieuw: Portaal Productie → Stilstand. Je ziet wat nu stilligt, de stilstand per stap en per oorzaak, en de beschikbaarheid per stap. Daarnaast de kwaliteit: het deel van de gestarte batches dat niet is afgekeurd. Samen is dat het begin van OEE. Voor de prestatie (snelheid) zijn nog normtijden per stap nodig.
- Nieuw: Portaal Beheer → Oorzaken van stilstand. Een geplande oorzaak (omstellen, schoonmaken, onderhoud) telt niet mee als verlies.
- De testdata bevat fictieve stilstand: dagelijks schoonmaken, wekelijks onderhoud, en storingen (PS7 vaker). In PS7 loopt nu een storing.
- Technisch: database-update 8 (`0008_stilstand`).

## 0.13.0 — 19 november 2026 · #15
- Nieuw: meldingen. De database maakt zelf een melding als iemand iets moet weten:
  - een waarde buiten de grens (ook na een correctie): naar ploegleider en Kwaliteit;
  - een batch in beoordeling: naar ploegleider en Kwaliteit;
  - een keurresultaat: OK naar de ploegleider, NOK naar ploegleider en planner;
  - een lot dat afwijkt van het lotvoorstel: naar de planner.
- In de portalen staat "Meldingen" bovenaan het menu, met het aantal ongelezen. Een nieuwe melding verschijnt ook even onderin beeld. Met "Bekijken" open je de batch of het lot.
- In het invoerscherm ziet de ploegleider de meldingen onder "Meldingen" in de bovenbalk (alleen met verbinding).
- Gelezen is per persoon. Meldingen ouder dan 30 dagen verdwijnen uit de lijst (ze blijven wel bewaard).
- Meldingen gaan niet per mail of Teams: het platform werkt zonder internet (D33).
- Technisch: database-update 7 (`0007_meldingen`).

## 0.12.0 — 19 november 2026 · #14
- Nieuw: ploegoverdracht. In het invoerscherm staat onder "Overdracht" wat deze ploeg tot nu toe heeft gedaan: afgeronde stappen per stap, gestarte batches, lots, afwijkingen en wat nog open staat. Daar schrijf je de bijzonderheden van de ploeg en de aandachtspunten voor de volgende ploeg. Dat werkt ook zonder verbinding.
- Nieuw: bovenaan het stappenoverzicht staat de overdracht van de vorige ploeg, met de aandachtspunten vet. Met "Gelezen" klap je hem op deze pc in.
- Nieuw: Portaal Productie → Ploegoverdracht. Per dag de drie ploegen met hun cijfers, overdrachten en wat open bleef aan het eind.
- Nieuw: Portaal Beheer → Ploegen. Begin- en eindtijd en naam per ploeg. Een nachtploeg hoort bij de dag waarop hij begint.
- Een overdracht is na opslaan niet meer te wijzigen; schrijf een aanvulling.
- Fictieve ploegen: ochtend 06–14, middag 14–22, nacht 22–06. In de testdata schrijft ongeveer driekwart van de ploegen een overdracht.
- Technisch: database-update 6 (`0006_ploegoverdracht`).

## 0.11.0 — 19 november 2026 · #13
- Nieuw: grondstoffen per batch. In een stap voert de operator per grondstof het partijnummer van de leverancier in, en eventueel de hoeveelheid. Een verplichte grondstof moet zijn ingevuld voordat de stap kan worden afgerond. Een ploegleider kan een partijnummer achteraf corrigeren; het origineel blijft bewaard.
- Nieuw: Portaal Kwaliteit → Grondstoffen terugzoeken. Zoek op (een deel van) een partijnummer en zie in welke batches en lots die partij zit. Zonder zoekterm: de laatst gebruikte partijen.
- Nieuw: het lotpaspoort toont welke grondstofpartijen in het lot en zijn batches zitten.
- Nieuw: Portaal Beheer → Grondstoffen. Grondstoffen toevoegen, wijzigen of uitzetten, en per stap kiezen of de grondstof verplicht is of mag.
- De fictieve configuratie heeft drie grondstoffen: GS-A in PS1 en GS-B in PS3 (verplicht), HS-C in PS9 (mag). De testdata wisselt ongeveer elke 4 dagen van partij.
- Let op: een ouder invoerscherm (van vóór 0.11.0) kan geen grondstoffen invoeren. Werk alle pc's bij voordat je een grondstof verplicht maakt in een stap die al in gebruik is.
- Technisch: database-update 5 (`0005_grondstoffen`).

## 0.10.0 — 19 november 2026 · #12
- Nieuw: wandscherm voor een tv in de hal (`/portaal/#/wandscherm`). Per stap zie je wat bezig is (▶ blauw), wat klaarstaat (● wit) en wat gepland is maar nog niet klaar (○ grijs), in de volgorde van de planner. Een gele rand met ⚠ betekent: wacht of loopt langer dan normaal (langer dan 90% van de keren in de laatste 30 dagen). Bovenaan: batches gestart tegenover gepland, lots gereed en batches in beoordeling.
- Het wandscherm ververst elke 30 seconden. Valt de verbinding weg, dan blijft de laatste stand staan met de melding "Geen verbinding sinds …".
- Per hal: `#/wandscherm/Hal 1` toont alleen de stappen van de pc's in die hal.
- Nieuw: rol "Wandscherm" voor een account dat alleen het wandscherm mag zien (testaccount `scherm1`). De tv hoeft zo niet op naam van een persoon ingelogd te zijn. Het blijft 30 dagen ingelogd; zet je het account uit in Portaal Beheer, dan stopt het scherm meteen.
- Iedereen met een persoonlijk account opent het wandscherm via de link onder in het menu.
- Technisch: database-update 4 (`0004_wandscherm`): de nieuwe rol.

## 0.9.0 — 19 november 2026 · #4
- Nieuw: Portaal Planning voor de planner (account `planner1` in de testdata).
  - Per week: batches plannen per dag, met product en opmerking. Het systeem geeft de batchnummers uit (doornummeren per jaar). Volgorde op de dag aanpassen, verschuiven naar een andere dag, of laten vervallen met een reden. Geplande batches die niet op tijd gestart zijn, staan bovenaan.
  - Per stap: per dag en per stap welke batches of lots er gedaan moeten worden, in volgorde, met een opmerking voor de operator. Je ziet meteen wat gedaan, bezig of nog te doen is.
  - Lotvoorstellen: de planner stelt voor welke 4 batches samen een lot worden.
  - Producten: lijst van producten of recepten om bij een batch te kiezen.
- Nieuw in het invoerscherm:
  - Bovenaan elke stap "Gepland voor vandaag", in volgorde. Geplande batches staan ook bovenaan bij "Klaar om te starten".
  - In de eerste stap start de operator een geplande batch met één druk op Start. Een ongeplande batch aanmaken kan nog steeds, als uitzondering; de planner ziet die als "niet gepland".
  - Bij het samenstellen van een lot staan de lotvoorstellen bovenaan; "Dit voorstel kiezen" vinkt de 4 batches aan. Kies je een andere samenstelling, dan vraagt het scherm om een reden.
- Verbeterd: de ploegleider kan de planning bekijken (niet wijzigen).
- Verbeterd: "batches gestart" in de analyses telt vanaf de eerste stap, niet vanaf het plannen.
- Let op: een ouder invoerscherm dat een lot samenstelt dat afwijkt van een lotvoorstel, krijgt de melding dat er een reden nodig is. Werk die pc bij en stel het lot opnieuw samen.
- Technisch: database-update 3 (`0003_planning`): producten, planning per batch, lotvoorstellen en dagplanning per stap. Wordt bij de start automatisch uitgevoerd; bestaande gegevens blijven staan.
- Technisch: de fictieve testdata bevat nu planning (ca. 95% gepland, 5% ongepland, lotvoorstellen met af en toe een afwijking, planning voor de komende werkdagen). De testdata eindigt nu precies op het laatste moment van invoer, zodat het verschuiven naar vandaag klopt.

## 0.8.0 — 19 november 2026
- Nieuw: eerste beheerder. Begin je zonder testaccounts (lege fabriek, of een nieuwe server), dan vraagt het zwarte venster om een gebruikersnaam en wachtwoord voor de eerste beheerder.
- Nieuw: noodsleutel voor een vergeten wachtwoord. `BEHEERDER HERSTELLEN.bat` op de laptop (op de server: `node tools/beheerder.mjs`) geeft een beheerder een nieuw wachtwoord of maakt een nieuwe aan. Dat kan alleen op de computer zelf en komt in het logboek.
- Verbeterd: `LEGE FABRIEK.bat` begint echt leeg, zonder de bekende testaccounts met wachtwoord `demo`. De fictieve testdata houdt die accounts.
- Technisch: de testaccounts staan in een eigen bestand (`db/seed_accounts_demo.sql`), los van de configuratie (`db/seed_config.sql`).

## 0.7.1 — 19 november 2026
- Opgelost: op Windows bleef de eerste start hangen op "Eerste keer: database aanmaken …". De database was wel gestart, maar het startscript bleef wachten op een uitvoerverbinding die de database openhield.

## 0.7.0 — 19 november 2026
- Nieuw: het laptoppakket is een complete proof of concept. Node.js en PostgreSQL zitten erin: uitpakken, `START.bat` dubbelklikken, klaar. Niets installeren, geen beheerdersrechten, geen wachtwoord.
- Nieuw: bij elke start eerst een back-up (laatste 5 blijven bewaard). Terugzetten met `BACKUP TERUGZETTEN.bat`.
- Nieuw: `LEGE FABRIEK.bat` om met alleen de configuratie te beginnen en je eigen stappen en velden in te richten.
- Verbeterd: bij stoppen (Ctrl+C of venster sluiten) wordt de database netjes afgesloten. Na een harde stop pakt de volgende start de draaiende database gewoon op.
- Verbeterd: Beheer → Server geeft op de laptop geen onterechte waarschuwingen meer over uurlijkse back-ups en hersteltests.
- Verbeterd: waarschuwing als het pakket in OneDrive staat.
- Technisch: het pakket heet nu `batch-gui-laptop-<versie>-windows.zip`. De vingerafdrukken van Node.js en de Visual C++-runtime worden bij het bouwen gecontroleerd. GitHub test het pakket (Linux-variant) bij elke push.

## 0.6.0 — 18 november 2026 · #1
- Nieuw: advies voor de fabrieksserver (apart document) en een draaiboek voor IT in `docs/SERVER.md`: installeren op Windows Server of Ubuntu, als service, back-ups, updates en herstel.
- Nieuw: serverpakket `batch-gui-server-<versie>.zip` met de applicatie, de beheertools en voorbeeldbestanden voor de Windows-service en de instellingen.
- Nieuw: back-ups met `tools/backup.mjs`. Bewaart 48 uur elk uur, 30 dagen één per dag en 12 maanden één per maand, en ruimt de rest op.
- Nieuw: hersteltest met `tools/herstel.mjs --controle` en echt herstel met `tools/herstel.mjs <bestand>`. De huidige database blijft daarbij bewaard en komt terug als het herstel mislukt.
- Nieuw: database-updates met versienummer (`tools/migreer.mjs`, `db/migraties/`). Een nieuwe versie van de applicatie start niet op een database die nog niet is bijgewerkt.
- Nieuw: Portaal Beheer → Server met de versie, de laatste back-up en hersteltest, en een waarschuwing als een back-up ouder is dan 2 uur of mislukt.
- Nieuw: https met een certificaat van IT.
- Verbeterd: de applicatie werkt in de database met een eigen gebruiker die gegevens kan invoeren maar niets kan verwijderen of de opbouw kan wijzigen.
- Verbeterd: `/gezondheid` meldt ook of de database bereikbaar is (503 als dat niet zo is).
- Verbeterd: het laptoppakket werkt een bestaande database bij een nieuwe versie zelf bij; je gegevens blijven staan. Aanbevolen: Node.js 26 LTS en PostgreSQL 18.
- Verbeterd: `herstel.mjs` controleert vooraf of `pg_restore` bij de versie van de server past, en legt uit wat te doen als dat niet zo is.
- Technisch: de tests op GitHub draaien op PostgreSQL 18 en Node.js 22 en 26, met de beperkte databasegebruiker, en controleren de database-updates en de beheertools.

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
