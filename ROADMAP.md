# Roadmap – wat moet er nog gebeuren, in welke volgorde en wanneer

> **Dit bestand (toekomst):** alles wat nog moet of kan gebeuren: functies, verbeteringen, praktijktests, acties van Geert en IT, en open besluiten, geordend in fasen met poorten en een globale planning. Het is de enige takenlijst.
> **Niet hier:** wat al gebouwd is → [`CHANGELOG.md`](CHANGELOG.md) (verleden); waarom iets zo is gekozen → [`DECISIONS.md`](DECISIONS.md) (verleden); de stand van nu en hoe het werkt → [`README.md`](README.md) (heden).

Bijgewerkt: 21 november 2026 · huidige versie 0.38.0

Elk punt heeft een vast nummer (#n). Is een punt gebouwd, dan verdwijnt het hier en staat het nummer in de changelog achter de versie. De data zijn een schatting, geen belofte. De software is zelden het knelpunt; de tijd zit in de punten waar Geert, IT of de fabriek aan zet zijn (gemarkeerd met *Geert* of *IT*). Schuift zo'n punt, dan schuift alles erna mee.

## In één oogopslag

```mermaid
gantt
    title Batch input GUI – roadmap
    dateFormat YYYY-MM-DD
    axisFormat %d %b
    todayMarker on

    section A Software
    Gebouwd in 0.20 tot en met 0.26          :done, a1, 2026-11-19, 2d

    section A2 Uit de eerste demo
    Gebouwd in 0.27 tot en met 0.37          :done, a2, 2026-11-20, 2d

    section A3 Vóór de pilot
    Nainvoeren na papier (75)                :a3a, 2026-11-23, 10d
    Accounts, melden, storing (76 78 31)     :a3b, after a3a, 7d
    Pilotoverzicht, analyses (77 32 66)      :a3c, after a3b, 14d

    section B Praktijk
    PoC laten zien, Geert (11)               :b1, 2026-11-30, 21d
    Praktijktests (33)                       :b2, 2026-12-07, 28d

    section C Configuratie
    Routes per product aanleveren, Geert     :c0, 2026-11-30, 14d
    Echte velden aanleveren, Geert (2)       :c1, 2026-11-30, 35d
    Inrichten en controleren                 :c2, after c1, 7d

    section D Server
    Advies bespreken, IT (10)                :d1, 2026-12-14, 14d
    Server inrichten en offline-proef, IT    :d2, 2027-01-11, 21d

    section E Pilot
    Training en ondernemingsraad (74 79)     :e0, 2027-02-08, 10d
    Poort naar de pilot (datum: 70)          :milestone, m1, 2027-02-22, 0d
    Pilot hal 1, met papier ernaast          :e1, 2027-02-22, 14d
    Pilot hal 1, alleen systeem              :e2, after e1, 42d
    Evaluatie                                :milestone, m2, 2027-04-19, 0d

    section F Verbeteren
    1.1 afkeur en maatregel (30)             :f1, 2027-03-08, 21d
    1.2 OEE compleet (22)                    :f2, after f1, 21d

    section G Uitbreiden
    Uitrol alle hallen                       :g1, 2027-04-26, 42d
    Exact, mail of Teams, apps (6 21 7)      :g2, 2027-06-07, 60d
```

## Fasen

### A. Pilotklaar maken (software) — gebouwd
Alle punten zijn gebouwd in 0.20.0 tot en met 0.23.0, sneller dan gepland (wat er per versie veranderde: changelog). In de software staat niets meer open vóór de pilot.

Daarna, uit de UI/UX-review van 20 november 2026 (D50): #41–#44 zijn gebouwd in 0.23.2 tot en met 0.25.0.

**Poort A:** gehaald zodra Geert het laptoppakket van de nieuwste versie draait.

### A2. Uit de eerste demo — gebouwd
Geerts lijst met 21 ideeën na het bekijken van de demo (20 november 2026). Eigen inlog en routes per product komen vóór de pilot (D53, D55); daardoor schuift de pilot naar schatting twee weken op (#70). Volgorde: eerst inlog en startpagina, dan producten, dan de kleine punten. Alles uit deze fase is gebouwd (0.27.0 tot en met 0.37.0, wat er per versie veranderde: changelog); de metingen van Kwaliteit (#64) kwamen er op Geerts keuze ook vóór de pilot bij (#71, D58). Over: #55 (later).

**Poort A2:** #49–#53 gebouwd (#49 en #50 in 0.27.0, #51 in 0.28.0, #52 in 0.29.0, #53 in 0.30.0) en door Geert in de demo bekeken; de routes per product staan erin (fictief).


### A3. Vóór de pilot (software) — december 2026 tot januari 2027
Geerts keuze na de vraag "wat kan nog beter vóór de pilot" (21 november 2026): alles hieronder komt vóór de pilot. Volgorde: eerst wat in de eerste pilotweek al nodig is (#55 gebouwd in 0.39.0, #75), dan het inrichten (#76), dan wat helpt de pilot te beoordelen. Keuzes van Geert voor #75: ploegleider en beheerder mogen nainvoeren, tot 7 dagen terug, ook het samenstellen van een lot (D60).
- #75 **Nainvoeren na papier** (middel) — Als de server en een pc tegelijk niet werken, registreert de ploeg op papier (terugvalplan). Daarna voert de ploegleider of beheerder de stap in met de echte begin- en eindtijd en een reden; zichtbaar als "nageleverd" en in het logboek. Met een afdrukbaar leeg formulier per stap, met dezelfde velden als het scherm.
- #76 **Accounts in één keer aanmaken** (klein) — Accounts en namen via een Excel-sjabloon in Beheer, met controle vooraf, en een tijdelijk wachtwoord dat bij de eerste inlog gewijzigd moet worden.
- #78 **"Iets melden" in de schermen** (klein) — Operators en anderen typen kort wat misgaat of beter kan; met tijd, pc, stap en naam in een lijst bij de beheerder, die er roadmappunten van kan maken.
- #31 **Notitie bij het einde van een storing** (klein) — Bij Stilstand beëindigen: wat was het en wat is er gedaan. Zichtbaar bij Stilstand in Productieanalyse.
- #77 **Pilotoverzicht** (middel) — In Beheer per dag en per pc: hoeveel stappen ingevoerd, hoe laat na het werk, hoe lang offline, wat geweigerd werd, welke velden vaak leeg blijven of gecorrigeerd worden, en de meldingen uit #78. Voor de evaluatie na 8 weken.
- #32 **Kwaliteit "in één keer goed"** (klein) — Herbewerkingen tellen niet als goed; stilstand per oorzaak als paretodiagram, op minuten en op aantal.
- #66 **Procesbewaking: tijdig signaleren** (middel) — Een signaal van een regelkaart of een trend meteen als melding in de portalen en op het wandscherm, niet alleen achteraf in het scherm Regelkaarten. Drempels pas instellen met echte data (#2); vóór de pilot alleen de werking.

**Poort A3:** alle punten hierboven gebouwd en door Geert in de demo bekeken.

### B. Proof of concept en praktijk — december 2026
- #11 **Proof of concept laten zien** (klein, *Geert*) — Laptoppakket van de nieuwste versie draaien en laten zien; bevindingen worden nieuwe punten op deze roadmap.
- #33 **Praktijktests** (middel) — Nog nooit echt getest: handscanner, etiketprinter, tv als wandscherm, invoerscherm offline op een fabrieks-pc via https, tablet via het netwerk, twee pc's op dezelfde stap, nachtploeg rond de klokwissel. Op Windows nog niet: versies 0.8–0.23 op de laptop, Ctrl+C en venster sluiten, back-up terugzetten, serverpakket en draaiboek op een echte Windows Server. Hoe en wanneer goed: [`docs/PRAKTIJKTESTS.md`](docs/PRAKTIJKTESTS.md) (0.38.0). Per test vastleggen wie, wanneer en de uitkomst, in het invulblad dat daar genoemd staat.

- #48 **Kiezen: Dagoverzicht of Batchroute** (klein, *Geert*) — Beide staan als proef in Planning (0.26.0, D52). Geert bekijkt ze in de demo of op de laptop en kiest er één; de andere gaat eruit en "(proef)" verdwijnt uit het menu.

**Poort B:** elke praktijktest heeft een uitkomst; wat misging is opgelost of bewust geaccepteerd.

### C. Echte configuratie — december 2026 tot half januari 2027
- #2 **Echte velden per stap** (middel, *Geert*) — De velden en grenzen kunnen nu per product (D55), ook via het sjabloon (blad "Grenzen per product"). Per processtap de echte invoervelden aanleveren, het liefst in het sjabloon uit Beheer → Stappen en velden: veld, soort, eenheid, verplicht, tolerantie, grenzen, decimalen, op het certificaat. Ook de echte ploegtijden, oorzaken van stilstand, grondstoffen, producten met hun route (welke stappen, in welke volgorde; D55), operators en pc's. Daarna samen inrichten via het sjabloon en controleren in een lege fabriek.

**Poort C:** alle 18 stappen ingericht en door een ploegleider op de laptop doorlopen met een proefbatch.

### D. Fabrieksserver — half december 2026 tot eind januari 2027
- #10 **Fabrieksserver installeren met IT** (middel, *Geert*, *IT*, D26) — Geert bespreekt het advies met IT en beantwoordt de vier vragen onder "Nog te besluiten" in het advies. IT richt de server in volgens `docs/SERVER.md`; eerste keer samen op een testmachine, met back-up, hersteltest en een pc die offline gaat.

**Poort D:** server draait met https, back-ups lopen, hersteltest geslaagd, de pc's in hal 1 bereiken hem.

### E. Pilot 1.0 — eind februari tot april 2027 (datum: #70)
- #74 **Training** (klein, *Geert*) — Een trainingsmoment per rol vóór de pilot, met de laptop of de server en fictieve data. De hulp per rol staat in de schermen en is als A4 af te drukken (0.38.0, #36, D59). Afspreken wat de ploeg doet als een pc bij het begin van een dienst offline is (praktijktest V3).
- #79 **Ondernemingsraad en privacy** (klein, *Geert*) — Het systeem legt per persoon vast wie wat invoert (nodig om terug te zoeken). Vóór de pilot met de ondernemingsraad bespreken wat er wordt vastgelegd, wie het mag zien en hoe lang het bewaard blijft; raakt ook #8 en #63 (D12).
- #3 **Pilot met echte data** (groot) — Versie 1.0.0 in één hal: de eerste twee weken met de papieren registratie ernaast, dan alleen het systeem.

**Poort naar de pilot:** poorten A tot en met D gehaald (ook A3), operators getraind, terugvalplan op papier afgesproken (met het formulier uit #75), ondernemingsraad gehoord (#79).

**Evaluatie na 8 weken:** zijn alle batches in het systeem terug te vinden, kloppen de cijfers met het papier, hoe vaak lag het systeem eruit, wat vinden operators en Kwaliteit ervan? Op basis daarvan: uitrollen, of eerst verbeteren.

### F. Verbeteren tijdens de pilot — maart tot april 2027
Wat Kwaliteit en Productie het meest helpt zodra er echte data is. De volgorde kan na de eerste pilotweken veranderen.
- #30 **Afkeur met omvang, herhaling en maatregel** (middel) — Bij afkeur de geschonden grens tonen, verdachte batches (zelfde grondstofpartij, dag of lot) en eerdere afwijkingen van hetzelfde veld. Daarna een eenvoudige maatregel: wat, wie, wanneer klaar, na 30 dagen controleren of het hielp.
- #22 **OEE compleet** (middel) — Normtijden per stap vastleggen, zodat ook de prestatie (snelheid) en de volledige OEE berekend kunnen worden.
- #67 **Productieoptimalisatie** (middel) — Knelpunten, doorlooptijden en stilstand bestaan al, en capaciteit per stap en product (D55); erbij: hoe vol elke stap werkelijk was (benutting), en welke stap de doorstroom bepaalt.

### G. Uitbreiden na de pilot — vanaf eind april 2027
Uitrol naar alle hallen. Daarna, als het nodig blijkt:
- #6 **Koppeling met Exact** (groot) — Gegevens uitwisselen met Exact.
- #21 **Meldingen per mail of Teams** (klein) — Kan pas als de server bij een mailserver of Teams mag; nu bewust alleen in de schermen (D33).
- #7 **Installeerbare apps** (groot) — Invoerscherm en portalen als installeerbare applicaties op dezelfde server en API.
- #45 **Talenkeuze** (middel) — De schermen in meer talen, met een keuze per gebruiker of per pc. Vraagt dat alle schermteksten uit de code naar taalbestanden gaan; de woordenlijst van D51 is daarvoor de basis.
- #46 **Donkere modus** (klein) — Voor invoer en portalen, via de gedeelde tokens (#42). Bewust later (D50).
- #65 **Producteigenschap tegen procesparameter** (middel) — Verband zien tussen bijvoorbeeld een producteigenschap en de temperatuur in PS1 van dezelfde batch (spreidingsdiagram en correlatie). Vraagt #64.
- #68 **Kwaliteitsanalyse: verbanden** (groot) — Verbanden tussen grondstofpartijen, procesparameters, ploegen en afwijkingen. Per operator alleen na besluit #8 (D12).
- #69 **Volledig digitaal productiedossier** (middel) — Lotpaspoort en certificaat bestaan al; erbij: één dossier per lot met alle metingen, grondstoffen, wie wat deed, stilstand, beoordelingen en herbewerkingen, om te bewaren of te versturen.
- #47 **Invoer via telefoon of tablet** (middel) — Portalen of schermen waarmee ook op een telefoon of tablet wordt ingevoerd. Dan gelden de richtlijnen voor smalle schermen en de safe-area (notch) wél (D50, afwijking E).

## Te besluiten (*Geert*)
Vóór of tijdens de pilot; de uitkomst wordt een punt in een fase of een besluit in `DECISIONS.md`.
- #8 **Analyses per operator** — Bijvoorbeeld afwijkingen per persoon. Bewust niet gebouwd (D12).
- #9 **Portalen voor andere afdelingen** — Welke afdelingen hebben nog een portaal nodig?
- #63 **Productiviteit per ploeg** — Punt 15 uit Geerts lijst. Per ploeg is minder gevoelig dan per persoon, maar bij kleine ploegen herken je toch personen; raakt D12 en mogelijk de ondernemingsraad. Wat telt als productiviteit: batches, stappen of uren per ploeg?
- #70 **Nieuwe pilotdatum** — Door #49–#53 vóór de pilot schuift de poort naar schatting van 8 naar 22 februari 2027; met de metingen van Kwaliteit (#64, D58) mogelijk iets later. Geert bevestigt de datum.
- #72 **Naam "Productieanalyse"** — Het portaal Productie heet nu Productieanalyse (D54). Geert bevestigt de naam of kiest een andere.
- #34 **Open vragen planning** — Moet de planner ook ploegen of pc's toewijzen? Mag een operator een lotvoorstel zelf aanpassen? Is "per stap per dag" zo bruikbaar?

## Hoe we deze roadmap bijhouden
- Nieuwe taken, adviezen, open vragen en praktijktests komen hier met het volgende vrije nummer (nu #72), in de fase waar ze horen.
- Is een punt gebouwd, dan haal je het hier weg en zet je het nummer in de changelog achter de versie.
- De tijdlijn en de fasen pas je aan als een fase klaar is, een poort niet gehaald wordt of de volgorde verandert.
- Rapporten op claude.ai zijn momentopnamen; wat eruit volgt komt hier als punt.
