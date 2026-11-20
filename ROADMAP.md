# Roadmap – wat moet er nog gebeuren, in welke volgorde en wanneer

> **Dit bestand (toekomst):** alles wat nog moet of kan gebeuren: functies, verbeteringen, praktijktests, acties van Geert en IT, en open besluiten, geordend in fasen met poorten en een globale planning. Het is de enige takenlijst.
> **Niet hier:** wat al gebouwd is → [`CHANGELOG.md`](CHANGELOG.md) (verleden); waarom iets zo is gekozen → [`DECISIONS.md`](DECISIONS.md) (verleden); de stand van nu en hoe het werkt → [`README.md`](README.md) (heden).

Bijgewerkt: 20 november 2026 · huidige versie 0.26.1

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
    Eigen inlog en startpagina (49 50)       :a2a, 2026-11-23, 10d
    Routes en analyses per product (51-53)   :a2b, after a2a, 21d
    Kleine verbeteringen (56-62)             :a2c, after a2b, 7d

    section B Praktijk
    PoC laten zien, Geert (11)               :b1, 2026-11-30, 21d
    Praktijktests (33)                       :b2, 2026-12-07, 28d

    section C Configuratie
    Routes per product aanleveren, Geert     :c0, 2026-11-30, 14d
    Echte velden aanleveren, Geert (2)       :c1, after a2b, 35d
    Inrichten en controleren                 :c2, after c1, 7d

    section D Server
    Advies bespreken, IT (10)                :d1, 2026-12-14, 14d
    Server inrichten en offline-proef, IT    :d2, 2027-01-11, 21d

    section E Pilot
    Training en handleiding (36)             :e0, 2027-02-08, 10d
    Poort naar de pilot (datum: 70)          :milestone, m1, 2027-02-22, 0d
    Pilot hal 1, met papier ernaast          :e1, 2027-02-22, 14d
    Pilot hal 1, alleen systeem              :e2, after e1, 42d
    Evaluatie                                :milestone, m2, 2027-04-19, 0d

    section F Verbeteren
    1.1 afkeur en maatregel (30)             :f1, 2027-03-08, 21d
    1.2 storing afsluiten, kwaliteit (31 32) :f2, after f1, 10d
    1.3 OEE compleet (22)                    :f3, after f2, 21d

    section G Uitbreiden
    Uitrol alle hallen                       :g1, 2027-04-26, 42d
    Exact, mail of Teams, apps (6 21 7)      :g2, 2027-06-07, 60d
```

## Fasen

### A. Pilotklaar maken (software) — gebouwd
Alle punten zijn gebouwd in 0.20.0 tot en met 0.23.0, sneller dan gepland (wat er per versie veranderde: changelog). In de software staat niets meer open vóór de pilot.

Daarna, uit de UI/UX-review van 20 november 2026 (D50): #41–#44 zijn gebouwd in 0.23.2 tot en met 0.25.0.

**Poort A:** gehaald zodra Geert het laptoppakket van de nieuwste versie draait.

### A2. Uit de eerste demo — eind november 2026 tot januari 2027
Geerts lijst met 21 ideeën na het bekijken van de demo (20 november 2026). Eigen inlog en routes per product komen vóór de pilot (D53, D55); daardoor schuift de pilot naar schatting twee weken op (#70). Volgorde: eerst inlog en startpagina, dan producten, dan de kleine punten.
- #49 **Eigen inlog per persoon** (groot, D53) — Iedereen logt in met eigen naam en wachtwoord; de beheerder maakt de accounts en kent de rollen toe. Vervangt het gedeelde operatoraccount met naam kiezen (D6). Inloggen gaat via de server; wie al ingelogd is, kan offline doorwerken. Ook: wat gebeurt er met operators die nu alleen een naam zijn (omzetten naar accounts), en wissel van persoon op dezelfde pc midden in een dienst.
- #50 **Eén app met een startpagina** (middel, D54) — Na het openen eerst inloggen, daarna de portalen waar jouw account toegang toe heeft. Het invoerscherm en het wandscherm (punt 5) worden portalen. Het portaal Productie wordt "Productieanalyse" (naam door Geert te bevestigen).
- #54 **Wandscherm per processtap** (klein) — Een wandscherm instellen voor één of enkele stappen, zodat je alleen de planning en het werk van die stap ziet.
- #51 **Eigen route per product** (groot, D55) — Per product welke stappen het doorloopt en in welke volgorde; stappen kunnen door meerdere producten gedeeld worden. De batch kent zijn product, dus het invoerscherm, de werkvoorraad, de planningswaarschuwing (D52) en de lotstap volgen de route van dat product. Vraagt van Geert per product de lijst met stappen (fictief tot de pilot).
- #52 **Productkiezer en grenzen per product** (groot, D55) — Bovenin de portalen een productkiezer die onthouden wordt (ook "Alle producten"). Toleranties en grenzen per veld per product, zodat Kwaliteit (overzicht, trends, regelkaarten, afwijkingen) per product klopt, ook als producten door elkaar draaien.
- #53 **Capaciteit per stap en product** (middel) — Bijvoorbeeld PS1: 8 batches per dag van product A, of 3 van product B. Planning waarschuwt dan per stap, niet alleen per dag.
- #56 **Lotpaspoort: klik op een afwijking** (klein) — Bij "Buiten tolerantie" of "Buiten grens" de meting zien, en of er een beoordeling en keurresultaat met reden is.
- #57 **Uitleg meting en signaal bij de regelkaarten** (klein) — Wat een signaal is en de vier regels, bij het scherm zelf.
- #58 **Resolutie en afgelopen jaar** (middel) — Naast Periode een keuze per dag, per week of per maand voor alle grafieken met tijd; periode "Afgelopen jaar" erbij.
- #59 **Afwijkingen per week: klik op een staaf** (klein) — Lijst met batch, product, stap, veld en waarde achter die staaf.
- #60 **Batches gestart per week** (klein) — Dezelfde grafiek als "Lots gereed per week" in Productie per week.
- #61 **Herbewerkingen met stand** (middel) — Kolom met de stand van de herbewerking (nog te plannen, gepland, bezig, klaar), en ook herbewerkingen die nog niet gestart zijn.
- #62 **Ploegoverdracht: afgerond van gepland** (klein) — "28 / 32 stappen afgerond".
- #64 **Invoer voor Kwaliteit en soort meting** (groot) — Een invoerscherm voor de metingen van Kwaliteit, en per veld wie meet (Productie of Kwaliteit) en wat het is (procesparameter of producteigenschap). Een meting kan leiden tot vrijgave voor de volgende stap, herbewerking of afkeur (bouwt voort op D7). Vóór of na de pilot: zie #71.

**Poort A2:** #49–#53 gebouwd en door Geert in de demo bekeken; de routes per product staan erin (fictief).


### B. Proof of concept en praktijk — december 2026
- #11 **Proof of concept laten zien** (klein, *Geert*) — Laptoppakket van de nieuwste versie (nu 0.26.1) draaien en laten zien; bevindingen worden nieuwe punten op deze roadmap.
- #33 **Praktijktests** (middel) — Nog nooit echt getest: handscanner, etiketprinter, tv als wandscherm, invoerscherm offline op een fabrieks-pc via https, tablet via het netwerk, twee pc's op dezelfde stap, nachtploeg rond de klokwissel. Op Windows nog niet: versies 0.8–0.23 op de laptop, Ctrl+C en venster sluiten, back-up terugzetten, serverpakket en draaiboek op een echte Windows Server. Per test vastleggen: wie, wanneer, uitkomst.

- #48 **Kiezen: Dagoverzicht of Batchroute** (klein, *Geert*) — Beide staan als proef in Planning (0.26.0, D52). Geert bekijkt ze in de demo of op de laptop en kiest er één; de andere gaat eruit en "(proef)" verdwijnt uit het menu.

**Poort B:** elke praktijktest heeft een uitkomst; wat misging is opgelost of bewust geaccepteerd.

### C. Echte configuratie — december 2026 tot half januari 2027
- #2 **Echte velden per stap** (middel, *Geert*) — Pas na #51 en #52: de velden en grenzen gelden dan per product. Per processtap de echte invoervelden aanleveren, het liefst in het sjabloon uit Beheer → Stappen en velden: veld, soort, eenheid, verplicht, tolerantie, grenzen, decimalen, op het certificaat. Ook de echte ploegtijden, oorzaken van stilstand, grondstoffen, producten, operators en pc's. Daarna samen inrichten via het sjabloon en controleren in een lege fabriek.

**Poort C:** alle 18 stappen ingericht en door een ploegleider op de laptop doorlopen met een proefbatch.

### D. Fabrieksserver — half december 2026 tot eind januari 2027
- #10 **Fabrieksserver installeren met IT** (middel, *Geert*, *IT*, D26) — Geert bespreekt het advies met IT en beantwoordt de vier vragen onder "Nog te besluiten" in het advies. IT richt de server in volgens `docs/SERVER.md`; eerste keer samen op een testmachine, met back-up, hersteltest en een pc die offline gaat.

**Poort D:** server draait met https, back-ups lopen, hersteltest geslaagd, de pc's in hal 1 bereiken hem.

### E. Pilot 1.0 — eind februari tot april 2027 (datum: #70)
- #36 **Training en handleiding** (klein) — Korte handleiding per rol (operator, ploegleider, Kwaliteit, planner, beheerder) en een trainingsmoment vóór de pilot, met de laptop of de server en fictieve data.
- #3 **Pilot met echte data** (groot) — Versie 1.0.0 in één hal: de eerste twee weken met de papieren registratie ernaast, dan alleen het systeem.

**Poort naar de pilot:** poorten A tot en met D gehaald, operators getraind, terugvalplan op papier afgesproken.

**Evaluatie na 8 weken:** zijn alle batches in het systeem terug te vinden, kloppen de cijfers met het papier, hoe vaak lag het systeem eruit, wat vinden operators en Kwaliteit ervan? Op basis daarvan: uitrollen, of eerst verbeteren.

### F. Verbeteren tijdens de pilot — maart tot april 2027
Wat Kwaliteit en Productie het meest helpt zodra er echte data is. De volgorde kan na de eerste pilotweken veranderen.
- #30 **Afkeur met omvang, herhaling en maatregel** (middel) — Bij afkeur de geschonden grens tonen, verdachte batches (zelfde grondstofpartij, dag of lot) en eerdere afwijkingen van hetzelfde veld. Daarna een eenvoudige maatregel: wat, wie, wanneer klaar, na 30 dagen controleren of het hielp.
- #31 **Notitie bij het einde van een storing** (klein) — Wat was het en wat is er gedaan.
- #32 **Kwaliteit "in één keer goed"** (klein) — Herbewerkingen tellen niet als goed; stilstand per oorzaak als paretodiagram, op minuten en op aantal.
- #22 **OEE compleet** (middel) — Normtijden per stap vastleggen, zodat ook de prestatie (snelheid) en de volledige OEE berekend kunnen worden.
- #55 **Een gestarte stap overnemen** (klein) — Operator B kon een stap die operator H startte niet overnemen. Na #49 opnieuw bekijken: wat moet er gebeuren als iemand anders een stap afmaakt? (Geert: later oppakken.)
- #66 **Procesbewaking: tijdig signaleren** (middel) — Een signaal van een regelkaart of een trend meteen als melding in de portalen en op het wandscherm, niet alleen achteraf in het scherm Regelkaarten.
- #67 **Productieoptimalisatie** (middel) — Knelpunten, doorlooptijden en stilstand bestaan al; erbij: benutting van de capaciteit per stap en product (#53), en welke stap de doorstroom bepaalt.

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
- #70 **Nieuwe pilotdatum** — Door #49–#53 vóór de pilot schuift de poort naar schatting van 8 naar 22 februari 2027. Geert bevestigt de datum.
- #71 **Invoer voor Kwaliteit vóór of na de pilot?** — Moeten de metingen van Kwaliteit (#64) in de pilot al in het systeem, of blijft dat voorlopig op papier?
- #34 **Open vragen planning** — Moet de planner ook ploegen of pc's toewijzen? Mag een operator een lotvoorstel zelf aanpassen? Is "per stap per dag" zo bruikbaar?

## Hoe we deze roadmap bijhouden
- Nieuwe taken, adviezen, open vragen en praktijktests komen hier met het volgende vrije nummer (nu #72), in de fase waar ze horen.
- Is een punt gebouwd, dan haal je het hier weg en zet je het nummer in de changelog achter de versie.
- De tijdlijn en de fasen pas je aan als een fase klaar is, een poort niet gehaald wordt of de volgorde verandert.
- Rapporten op claude.ai zijn momentopnamen; wat eruit volgt komt hier als punt.
