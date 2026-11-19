# Wishlist

Ideeën en geplande onderdelen voor volgende versies van de Batch input GUI. Deze lijst wordt bij elke versie bijgewerkt: wat gebouwd is, verhuist naar Gerealiseerd en staat in de changelog. Elk punt houdt zijn nummer, ook als andere punten klaar zijn.

Laatst bijgewerkt: versie 0.15.0, 19 november 2026

## Gepland
- #11 **Proof of concept laten zien** (klein) — Geert draait het laptoppakket en laat het zien; bevindingen worden nieuwe punten op deze lijst.
- #10 **Fabrieksserver installeren met IT** (middel, na de proof of concept, D26) — IT richt de server in volgens het advies en `docs/SERVER.md`; eerste keer samen doorlopen op een testmachine, inclusief een proef met een pc die offline gaat.
- #2 **Echte velden per stap** (middel) — Geert levert per processtap de echte invoervelden aan (setting, gemeten waarde, gewichten, grenzen). Nodig voor de pilot.
- #3 **Pilot met echte data** (groot) — Versie 1.0.0: eerste stappen in de fabriek met echte batches.
- #6 **Koppeling met Exact** (groot) — Gegevens uitwisselen met Exact.
- #7 **Installeerbare apps** (groot) — Invoerscherm en portalen als installeerbare applicaties op dezelfde server en API.
- #21 **Meldingen per mail of Teams** (klein, te besluiten) — Kan pas als de server bij een mailserver of Teams mag; nu bewust alleen in de schermen (D33).
- #22 **OEE compleet** (middel) — Normtijden per stap vastleggen, zodat ook de prestatie (snelheid) en daarmee de volledige OEE berekend kan worden.
- #17 **Capaciteit in de planning** (klein, 0.16.0) — Waarschuwing bij meer batches dan een dag aankan.
- #18 **Certificaat per lot** (klein, 0.17.0) — Lotpaspoort als nette pdf voor de klant.
- #19 **Regelkaarten** (middel, 0.18.0) — Voor Kwaliteit: afwijken zien aankomen vóór de grens.
- #20 **Export naar Excel** (klein, 0.19.0) — Elke tabel in de portalen naar Excel.

## Te besluiten
- #8 **Analyses per operator** — Bijvoorbeeld afwijkingen per persoon. Bewust niet gebouwd (D12); Geert beslist of dit gewenst is.
- #9 **Portalen voor andere afdelingen** — Geert meldt welke afdelingen nog een portaal nodig hebben.

## Gerealiseerd
- #5 **Etiketten en barcodes** — versie 0.15.0; Code 128 op etiketprinter of A4-vel, scannen met een handscanner in het invoerscherm.
- #16 **Storingen en stilstand** — versie 0.14.0; melden en beëindigen in de invoer (offline), melding bij storing, wandscherm, Productie → Stilstand met beschikbaarheid en kwaliteit, oorzaken in Beheer.
- #15 **Meldingen** — versie 0.13.0; door de database bij grenswaarden, beoordeling, keurresultaat en afwijkend lot; in de portalen en voor de ploegleider in het invoerscherm.
- #14 **Ploegoverdracht** — versie 0.12.0; cijfers per ploeg, overdracht schrijven in het invoerscherm (ook offline), vorige ploeg bovenaan, overzicht in Productie, ploegtijden in Beheer.
- #13 **Grondstoffen per batch** — versie 0.11.0; partijnummer en hoeveelheid per stap, verplicht of niet, terugzoeken en in het lotpaspoort.
- #12 **Wandscherm** — versie 0.10.0; tv in de hal met per stap bezig, klaar en gepland, kerncijfers, per hal, schermaccount.
- #4 **Portaal Planning** — versie 0.9.0; batches per dag met doornummeren, planning per stap, lotvoorstellen en producten; zichtbaar in het invoerscherm.
- **Eerste beheerder en noodsleutel** — versie 0.8.0; lege fabriek zonder testaccounts.
- **Proof of concept op de laptop zonder installaties** — versie 0.7.0; Node.js en PostgreSQL ingebouwd, back-up bij elke start, lege fabriek.
- #1 **Advies en voorbereiding fabrieksserver** — versie 0.6.0; adviesdocument, draaiboek, serverpakket, back-ups, hersteltest, database-updates, https en Portaal Beheer → Server.
- **Werkafspraken en automatische tests** — versie 0.5.1; dezelfde opzet als Geerts andere projecten, tests en releases automatisch op GitHub.
- **Browserdemo** — versie 0.5.0; het hele platform in de browser, als privépagina.
- **Laptoppakket** — versie 0.5.0; met `START.bat` alles op de eigen laptop testen.
- **Portaal Beheer** — versie 0.4.0.
- **Portaal Productie** — versie 0.4.0.
- **Portaal Kwaliteit** — versie 0.4.0.
- **Lot samenstellen en herbewerking** — versie 0.3.0.
- **Invoerscherm met offline wachtrij** — versie 0.2.0.
- **Datamodel, databaseregels en API** — versie 0.1.0.
