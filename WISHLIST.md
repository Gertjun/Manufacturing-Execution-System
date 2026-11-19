# Wishlist

Ideeën en geplande onderdelen voor volgende versies van de Batch input GUI. Deze lijst wordt bij elke versie bijgewerkt: wat gebouwd is, verhuist naar Gerealiseerd en staat in de changelog. Elk punt houdt zijn nummer, ook als andere punten klaar zijn.

Laatst bijgewerkt: versie 0.9.0, 19 november 2026

## Gepland
- #11 **Proof of concept laten zien** (klein) — Geert draait het laptoppakket en laat het zien; bevindingen worden nieuwe punten op deze lijst.
- #10 **Fabrieksserver installeren met IT** (middel, na de proof of concept, D26) — IT richt de server in volgens het advies en `docs/SERVER.md`; eerste keer samen doorlopen op een testmachine, inclusief een proef met een pc die offline gaat.
- #2 **Echte velden per stap** (middel) — Geert levert per processtap de echte invoervelden aan (setting, gemeten waarde, gewichten, grenzen). Nodig voor de pilot.
- #3 **Pilot met echte data** (groot) — Versie 1.0.0: eerste stappen in de fabriek met echte batches.
- #5 **Barcodes** (middel) — Batch- en lotnummers scannen in plaats van typen.
- #6 **Koppeling met Exact** (groot) — Gegevens uitwisselen met Exact.
- #7 **Installeerbare apps** (groot) — Invoerscherm en portalen als installeerbare applicaties op dezelfde server en API.

## Te besluiten
- #8 **Analyses per operator** — Bijvoorbeeld afwijkingen per persoon. Bewust niet gebouwd (D12); Geert beslist of dit gewenst is.
- #9 **Portalen voor andere afdelingen** — Geert meldt welke afdelingen nog een portaal nodig hebben.

## Gerealiseerd
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
