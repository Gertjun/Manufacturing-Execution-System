# NOTES – Batch input GUI

De **actuele stand**: versie, open punten en sessielog. Werk dit bij aan het eind van elke sessie (zie `CLAUDE.md`). Besluiten staan in `DECISIONS.md`, wensen in `WISHLIST.md`.

Laatst bijgewerkt: 19 november 2026 · versie **0.18.0**

---

## Actuele stand – 19 november 2026

- **Nu: proof of concept op Geerts Windows-laptop (D26).** Het laptoppakket `batch-gui-laptop-0.9.0-windows.zip` brengt Node.js, PostgreSQL en de Visual C++-runtime zelf mee (D27): uitpakken en `START.bat`. De fabrieksserver volgt later met IT.

- Portaal Planning klaar (0.9.0, D29): batches plannen met doornummeren, planning per stap, lotvoorstellen, producten; zichtbaar in het invoerscherm.
- Fase 0–4 klaar. Fase 5 klaar aan de kant van de software: laptoppakket, browserdemo, advies fabrieksserver, draaiboek (`docs/SERVER.md`), serverpakket, back-ups, hersteltest, herstel, database-updates, https, beperkte databasegebruiker en Beheer → Server.
- Volgende: proof of concept laten zien (WISHLIST #11), daarna de fabrieksserver met IT (#10) en de echte velden per stap (#2), dan de pilot (1.0.0).
- Alle gegevens zijn fictief (D1).
- Code in `Gertjun/batch-input-gui` (privé). Tests en releases lopen automatisch via GitHub Actions (`tests.yml`, `release.yml`).
- Links: browserdemo https://claude.ai/artifact/AvBGewCSnACg6h6CeUKZQN · advies fabrieksserver https://claude.ai/artifact/XbFZ7nQRDn18zSS5tnQhUf · Whiteboard https://claude.ai/artifact/Nm9L5rFHZY6Dtgk2JMncnF · projectdocument in de Claude-Project: `claude/architectuur-en-besluiten.md`.

## Tests

| Wat | Hoe | Laatste resultaat |
| --- | --- | --- |
| Databaseregels | `python3 tests/test_regels.py "<verbinding>"` | 60/60 |
| API | `cd api && npm test` (`TEST_DATABASE_URL`, en `TEST_APP_DATABASE_URL` voor `batchgui_app`) | 42/42 |
| Schema en migraties gelijk | `tests/test_migraties.sh` | geslaagd |
| Beheertools | `tests/test_tools.sh` | geslaagd |
| Opruimschema back-ups | `node --test tests/rotatie.test.mjs` | 5/5 |
| Invoerscherm in Chrome | `invoer/e2e/flow.mjs` | 28/28 |
| Portalen in Chrome | `portaal/e2e/portaal.mjs`, `productie.mjs`, `beheer.mjs`, `planning.mjs`, `wandscherm.mjs` | alle geslaagd (wandscherm 9/9) |
| Browserdemo | `portaal/e2e/demo.mjs` | 12/12 |
| Laptoppakket (ingebouwde PostgreSQL) | `tests/test_laptoppakket.sh` (Linux-variant, als gewone gebruiker): eerste start, stoppen, back-up, harde stop, terugzetten, lege fabriek | geslaagd |
| Serverpakket | schone installatie op Linux met https, back-up en hersteltest | geslaagd |

Op GitHub draaien automatisch (Node.js 22 en 26): databaseregels, migraties, API met `batchgui_app`, opruimschema, beheertools, en controle en bouw van de schermen. De schermtests in Chrome draaien alleen lokaal.

**In de praktijk:** het Windows-laptoppakket 0.7.1 start op Geerts laptop. **Niet uitgevoerd in de praktijk:** op Windows nog niet gecontroleerd: Ctrl+C en venster sluiten, back-up terugzetten, sterretjes bij het wachtwoord (0.8.0), Portaal Planning en de planning in het invoerscherm op Windows (0.9.0), serverpakket en draaiboek op een echte Windows Server (WinSW, Taakplanner, junction, pfx-certificaat), browserdemo op claude.ai zelf (alleen lokaal in Chrome), invoerscherm offline op een fabrieks-pc via https, tablet via het netwerk.

## Open punten
- Geert: advies fabrieksserver met IT bespreken; de vier vragen onder "Nog te besluiten" in het advies beantwoorden.
- Geert: echte velden per stap aanleveren (WISHLIST #2); besluiten over analyses per operator (#8) en andere afdelingen (#9).
- Geert: laptoppakket 0.9.0 op de eigen laptop uitproberen met `planner1`; een bestaande database wordt bij de start bijgewerkt (database-update 3). Feedback op het plannen: is "per stap per dag" zo bruikbaar?
- Open vragen planning: moet de planner ook ploegen of pc's toewijzen? Mag een operator een lotvoorstel zelf aanpassen? Waarschuwing als een dag meer batches heeft dan de capaciteit?
- Let op bij het opnieuw maken van `tools/pakket/testdata.sql`: neem `schema_versie` en `onderhoud_log` niet mee in de dump (`--exclude-table`), anders botst het laden met `schema.sql`.

## Sessielog (nieuwste bovenaan)
- **19 nov 2026 · 0.18.0** — Regelkaarten (D38): I-kaart, Western Electric, Cpk, overzicht en detail in Kwaliteit.
- **19 nov 2026 · 0.17.0** — Certificaat per lot (D37): kenmerken op het certificaat, uitgeven door Kwaliteit met volgnummer, bedrijfsgegevens.
- **19 nov 2026 · 0.16.0** — Capaciteit in de planning (D36): per weekdag en afwijkende dagen, bezetting in de week, waarschuwing.
- **19 nov 2026 · 0.15.1** — Laptoppakket: testdata verschuiven per tabel in één keer (CI faalde op 0.14.0). Laptoppakkettest lokaal weer groen.
- **19 nov 2026 · 0.15.0** — Etiketten en barcodes (D35): Code 128, printer of A4, scannen in de invoer. Barcode gecontroleerd met een barcodelezer (zbar). Niet getest: een echte handscanner en etiketprinter.
- **19 nov 2026 · 0.14.0** — Storingen en stilstand (D34): melden/beëindigen in de invoer, melding, wandscherm, Productie → Stilstand met beschikbaarheid, Beheer → Oorzaken.
- **19 nov 2026 · 0.13.0** — Meldingen (D33): triggers in de database, gelezen per persoon, in portalen en voor de ploegleider in de invoer.
- **19 nov 2026 · 0.12.0** — Ploegoverdracht (D32): ploegen, overdracht schrijven in de invoer (offline), vorige ploeg bovenaan, Productie → Ploegoverdracht, Beheer → Ploegen.
- **19 nov 2026 · 0.11.0** — Grondstoffen per batch (D31): database-update 5, invoer, correctie, terugzoeken, lotpaspoort, beheer.
- **19 nov 2026 · 0.10.0** — Wandscherm voor een tv in de hal, rol `scherm` (D30). Geert wil daarna ook grondstoffen, ploegoverdracht, meldingen, stilstand, etiketten/barcodes, capaciteit, certificaat, regelkaarten en Excel-export, elk als eigen 0.x.0-versie.
- **19 nov 2026 · 0.9.0** — Portaal Planning (D29): database-update 3 (producten, geplande batches met doornummeren, lotvoorstellen, dagplanning per stap), API `/planning`, vier schermen, planning in het invoerscherm (PS1 geplande batches, PS16 voorstellen met reden bij afwijken). Generator maakt planning; testdata eindigt nu echt op de laatste invoer (er stonden tijden in de toekomst), datums schuiven mee.
- **19 nov 2026 · 0.8.0** — Geert draait de proof of concept op zijn laptop (0.7.1 werkt). Op zijn vraag: eerste beheerder bij een lege start, noodsleutel `BEHEERDER HERSTELLEN.bat` / `tools/beheerder.mjs`, lege fabriek zonder testaccounts (D28).
- **19 nov 2026 · 0.7.1** — Eerste echte Windows-start hing na het starten van de database: `spawnSync` wachtte op uitvoer die `postgres.exe` openhield. `pg_ctl start` nu zonder opgevangen uitvoer. Les: op Windows nooit uitvoer opvangen van een programma dat een achtergrondproces start.
- **19 nov 2026 · 0.7.0** — Proof of concept op de laptop eerst (D26). Laptoppakket met ingebouwde Node.js, PostgreSQL 18 en Visual C++-runtime (D27), back-up bij elke start, terugzetten, lege fabriek; test van het pakket op GitHub.
- **18 nov 2026 · 0.6.0** — Advies fabrieksserver (document) en draaiboek; serverpakket; back-up, hersteltest en herstel; migraties met schemaversie; `batchgui_app` met beperkte rechten; https; Beheer → Server; laptoppakket werkt database bij; tests op Node.js 22 en 26.
- **18 nov 2026 · 0.5.1** — Werkafspraken uit Geerts andere projecten overgenomen (CLAUDE, NOTES, DECISIONS D1–D20, WISHLIST), changelog in gewone taal, automatische tests en releases op GitHub; handleiding laptoppakket heet nu README.md.
- **18 nov 2026 · 0.5.0** — Laptoppakket, browserdemo, versienummering, GitHub-repository aangemaakt.
- **18 nov 2026 · 0.4.0** — Portalen Kwaliteit, Productie en Beheer.
