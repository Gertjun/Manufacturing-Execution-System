# Wishlist – wat moet er nog gebeuren

> **Dit bestand:** alles wat nog moet gebeuren: functies, verbeteringen, praktijktests, acties van Geert en open vragen. Het is de enige takenlijst.
> **Niet hier:** in welke volgorde en wanneer staat in [`ROADMAP.md`](ROADMAP.md); wat al gebouwd is in [`CHANGELOG.md`](CHANGELOG.md), waarom iets zo is gekozen in [`DECISIONS.md`](DECISIONS.md), de stand van nu in [`NOTES.md`](NOTES.md).

Elk punt houdt zijn nummer. Is een punt klaar, dan gaat het naar Gerealiseerd met alleen het versienummer; de uitleg staat in de changelog.

Laatst bijgewerkt: 19 november 2026

## Vóór de pilot
Uit de doorlichting van 19-11-2026 (rapport: "Batch input GUI – doorlichting en adviezen", https://claude.ai/artifact/6FL8onRKNHTbnqJWSF6U7i).
- #23 **Offline stappen krijgen het tijdstip van de pc** (middel) — Starten en afronden krijgen nu de tijd van versturen in plaats van invoeren. Tijdstip van het apparaat meesturen, met grenzen (niet in de toekomst, niet vóór de start, niet te oud); aankomsttijd apart bewaren. Oudere invoerschermen blijven werken (D18).
- #24 **Wachtrij onthoudt wie iets invoerde** (middel) — Operator, pc en tijdstip bij elke wachtende actie bewaren en meesturen. Waarschuwen bij afmelden met wachtende acties. Vaste opslag in de browser aanvragen.
- #25 **Tijdzone vast op Europe/Amsterdam** (klein) — Nu volgt de database de tijdzone van de computer; op een server met UTC schuiven de ploegen.
- #26 **Nachtploeg rond zomer- en wintertijd** (klein) — `ploeg_van()` vindt op 25-10-2026 om 05:30 geen ploeg; in maart overlappen nacht- en ochtendploeg.
- #27 **Schermtests in GitHub Actions** (klein, geen versie) — Verwachte aantallen uit de database lezen; `docs/SERVER.md` bijwerken tot database-update 10; `migreer.mjs` maakt eerst een back-up.
- #28 **Inloggen beveiligen** (klein) — Foute pogingen beperken en loggen, bcrypt sterkte 11–12, hoofdletters in gebruikersnamen negeren, Content-Security-Policy.
- #29 **Regelkaart en lijsten eerlijk tonen** (klein) — Onder 20 metingen "voorlopig" en geen Cpk; melden als een lijst is afgekapt (stilstand 200, grondstoffen 500).
- #33 **Praktijktests** (middel) — Nog nooit echt getest: handscanner, etiketprinter, tv als wandscherm, invoerscherm offline op een fabrieks-pc via https, tablet via het netwerk, twee pc's op dezelfde stap, nachtploeg rond de klokwissel. Op Windows nog niet: versies 0.8–0.19 op de laptop, Ctrl+C en venster sluiten, back-up terugzetten, serverpakket en draaiboek op een echte Windows Server. Per test vastleggen: wie, wanneer, uitkomst.
- #35 **Velden importeren uit een Excel-sjabloon** (klein) — Per stap een sjabloon met veld, eenheid, decimalen, setting, toleranties, grenzen en "op het certificaat"; inlezen in Beheer met een controle vooraf. Maakt het aanleveren van de echte velden (#2) makkelijker en minder foutgevoelig.
- #36 **Training en handleiding** (klein) — Korte handleiding per rol (operator, ploegleider, Kwaliteit, planner, beheerder) en een trainingsmoment vóór de pilot, met de laptop of de server en fictieve data.
- #11 **Proof of concept laten zien** (klein, Geert) — Laptoppakket 0.19.0 draaien en laten zien; bevindingen worden nieuwe punten op deze lijst.
- #2 **Echte velden per stap** (middel, Geert) — Per processtap de echte invoervelden aanleveren: veld, eenheid, decimalen, setting, grenzen, op het certificaat. Ook de echte ploegtijden, oorzaken van stilstand en grondstoffen. Nodig voor de pilot.
- #10 **Fabrieksserver installeren met IT** (middel, na de proof of concept, D26) — Geert bespreekt het advies met IT en beantwoordt de vier vragen onder "Nog te besluiten" in het advies. IT richt de server in volgens `docs/SERVER.md`; eerste keer samen op een testmachine, met een proef met een pc die offline gaat.
- #3 **Pilot met echte data** (groot) — Versie 1.0.0. Advies: één hal en een paar stappen, de eerste twee weken met de papieren registratie ernaast.

## Na de start van de pilot
- #30 **Afkeur met omvang, herhaling en maatregel** (middel) — Bij afkeur de geschonden grens tonen, verdachte batches (zelfde grondstofpartij, dag of lot) en eerdere afwijkingen van hetzelfde veld. Daarna een eenvoudige maatregel: wat, wie, wanneer klaar, na 30 dagen controleren of het hielp.
- #31 **Notitie bij het einde van een storing** (klein) — Wat was het en wat is er gedaan.
- #32 **Kwaliteit "in één keer goed"** (klein) — Herbewerkingen tellen niet als goed; stilstand per oorzaak als paretodiagram, op minuten en op aantal.
- #22 **OEE compleet** (middel) — Normtijden per stap vastleggen, zodat ook de prestatie (snelheid) en de volledige OEE berekend kunnen worden.
- #21 **Meldingen per mail of Teams** (klein) — Kan pas als de server bij een mailserver of Teams mag; nu bewust alleen in de schermen (D33).
- #6 **Koppeling met Exact** (groot) — Gegevens uitwisselen met Exact.
- #7 **Installeerbare apps** (groot) — Invoerscherm en portalen als installeerbare applicaties op dezelfde server en API.

## Te besluiten (Geert)
- #8 **Analyses per operator** — Bijvoorbeeld afwijkingen per persoon. Bewust niet gebouwd (D12).
- #9 **Portalen voor andere afdelingen** — Welke afdelingen hebben nog een portaal nodig?
- #34 **Open vragen planning** — Moet de planner ook ploegen of pc's toewijzen? Mag een operator een lotvoorstel zelf aanpassen? Is "per stap per dag" zo bruikbaar?

## Gerealiseerd
Details per versie staan in [`CHANGELOG.md`](CHANGELOG.md).
- #20 Export naar Excel — 0.19.0
- #19 Regelkaarten — 0.18.0
- #18 Certificaat per lot — 0.17.0
- #17 Capaciteit in de planning — 0.16.0
- #5 Etiketten en barcodes — 0.15.0
- #16 Storingen en stilstand — 0.14.0
- #15 Meldingen — 0.13.0
- #14 Ploegoverdracht — 0.12.0
- #13 Grondstoffen per batch — 0.11.0
- #12 Wandscherm — 0.10.0
- #4 Portaal Planning — 0.9.0
- #1 Advies en voorbereiding fabrieksserver — 0.6.0
