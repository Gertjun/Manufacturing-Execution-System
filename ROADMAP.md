# Roadmap – in welke volgorde en wanneer

> **Dit bestand:** de volgorde van het werk, de fasen, de poorten die we per fase moeten halen, en een globale planning.
> **Niet hier:** wat een punt precies inhoudt → [`WISHLIST.md`](WISHLIST.md) (de nummers hieronder verwijzen daarheen); wat al gebouwd is → [`CHANGELOG.md`](CHANGELOG.md).

Bijgewerkt: 19 november 2026 · huidige versie 0.19.0

De data zijn een schatting, geen belofte. De software is zelden het knelpunt; de tijd zit in de punten waar Geert, IT of de fabriek aan zet zijn (gemarkeerd met *Geert* of *IT*). Schuift zo'n punt, dan schuift alles erna mee.

## In één oogopslag

```mermaid
gantt
    title Batch input GUI – roadmap
    dateFormat YYYY-MM-DD
    axisFormat %d %b
    todayMarker on

    section A Software
    0.20 tijd en wachtrij (23 24 25 26)      :a1, 2026-11-23, 7d
    0.20 regelkaart en lijsten (29)          :a2, after a1, 3d
    0.21 inloggen beveiligen (28)            :a3, after a2, 4d
    Schermtests op GitHub, draaiboek (27)    :a4, after a1, 7d
    0.22 velden importeren uit Excel (35)    :a5, after a3, 5d

    section B Praktijk
    PoC laten zien, Geert (11)               :b1, 2026-11-30, 21d
    Praktijktests (33)                       :b2, 2026-12-07, 28d

    section C Configuratie
    Echte velden aanleveren, Geert (2)       :c1, 2026-12-07, 35d
    Inrichten en controleren                 :c2, after c1, 7d

    section D Server
    Advies bespreken, IT (10)                :d1, 2026-12-14, 14d
    Server inrichten en offline-proef, IT    :d2, 2027-01-11, 21d

    section E Pilot
    Training en handleiding (36)             :e0, 2027-01-25, 10d
    Poort naar de pilot                      :milestone, m1, 2027-02-08, 0d
    Pilot hal 1, met papier ernaast          :e1, 2027-02-08, 14d
    Pilot hal 1, alleen systeem              :e2, after e1, 42d
    Evaluatie                                :milestone, m2, 2027-04-05, 0d

    section F Verbeteren
    1.1 afkeur en maatregel (30)             :f1, 2027-02-22, 21d
    1.2 storing afsluiten, kwaliteit (31 32) :f2, after f1, 10d
    1.3 OEE compleet (22)                    :f3, after f2, 21d

    section G Uitbreiden
    Uitrol alle hallen                       :g1, 2027-04-12, 42d
    Exact, mail of Teams, apps (6 21 7)      :g2, 2027-05-24, 60d
```

## Fasen

### A. Pilotklaar maken (software) — eind november tot half december 2026
De fouten uit de doorlichting oplossen die ongemerkt verkeerde tijden of namen opleveren. Elk punt een eigen versie.

| Versie | Punten | Wat |
| --- | --- | --- |
| 0.20.0 | #23, #24 | Tijdstip en operator gaan mee met elke actie in de wachtrij |
| 0.20.1 | #25, #26 | Tijdzone vast, nachtploeg rond de klokwissel |
| 0.20.2 | #29 | Regelkaart "voorlopig" bij weinig metingen, afgekapte lijsten melden |
| 0.21.0 | #28 | Inloggen beveiligen |
| 0.21.1 | #27 | Schermtests op GitHub, draaiboek bijwerken, back-up vóór database-update |
| 0.22.0 | #35 | Velden per stap importeren uit een Excel-sjabloon (maakt #2 makkelijker) |

**Poort A:** alle punten gebouwd, alle tests groen op GitHub, nieuw laptoppakket bij Geert.

### B. Proof of concept en praktijk — december 2026
Geert laat het laptoppakket zien (#11) en we testen wat nog nooit echt is getest (#33): handscanner, etiketprinter, tv, een fabrieks-pc die offline gaat, twee pc's op dezelfde stap, Windows. Bevindingen worden nieuwe wishlistpunten.

**Poort B:** elke praktijktest heeft een uitkomst; wat misging is opgelost of bewust geaccepteerd.

### C. Echte configuratie — december 2026 tot half januari 2027
Geert levert per stap de echte velden aan, met eenheid, decimalen, setting, grenzen en "op het certificaat" (#2). Ook ploegtijden, oorzaken van stilstand, grondstoffen, producten, operators en pc's. Inrichten via het sjabloon (#35) en samen controleren in een lege fabriek.

**Poort C:** alle 18 stappen ingericht en door een ploegleider op de laptop doorlopen met een proefbatch.

### D. Fabrieksserver — half december 2026 tot eind januari 2027
Geert bespreekt het advies met IT en beantwoordt de open vragen (#10). IT richt de server in volgens `docs/SERVER.md`; samen een proef met back-up, hersteltest en een pc die offline gaat.

**Poort D:** server draait met https, back-ups lopen, hersteltest geslaagd, de pc's in hal 1 bereiken hem.

### E. Pilot 1.0 — februari tot april 2027
Training en een korte handleiding voor operators en ploegleiders (#36). Daarna versie 1.0.0 in één hal: de eerste twee weken met de papieren registratie ernaast, dan alleen het systeem (#3).

**Poort naar de pilot:** poorten A tot en met D gehaald, operators getraind, terugvalplan op papier afgesproken.

**Evaluatie na 8 weken:** zijn alle batches in het systeem terug te vinden, kloppen de cijfers met het papier, hoe vaak lag het systeem eruit, wat vinden operators en Kwaliteit ervan? Op basis daarvan: uitrollen, of eerst verbeteren.

### F. Verbeteren tijdens de pilot — februari tot april 2027
Wat Kwaliteit en Productie het meest helpt zodra er echte data is: afkeur met omvang, herhaling en maatregel (#30), notitie bij het einde van een storing (#31), kwaliteit "in één keer goed" (#32), en OEE compleet met normtijden (#22). De volgorde kan na de eerste pilotweken veranderen.

### G. Uitbreiden na de pilot — vanaf april 2027
Uitrol naar alle hallen. Daarna, als het nodig blijkt: koppeling met Exact (#6), meldingen per mail of Teams (#21), installeerbare apps (#7). Open besluiten (#8, #9, #34) neemt Geert vóór of tijdens de pilot; uitkomsten komen hier in de planning.

## Hoe we deze roadmap bijhouden
- Bijwerken als een fase klaar is, een poort niet gehaald wordt, of de volgorde verandert. Niet bij elke versie.
- Nieuwe punten komen eerst in de wishlist; hier alleen het nummer en de plek in de volgorde.
