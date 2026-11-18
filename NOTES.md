# NOTES – Batch input GUI

De **actuele stand**: versie, open punten en sessielog. Werk dit bij aan het eind van elke sessie (zie `CLAUDE.md`). Besluiten staan in `DECISIONS.md`, wensen in `WISHLIST.md`.

Laatst bijgewerkt: 18 november 2026 · versie **0.6.0**

---

## Actuele stand – 18 november 2026

- Fase 0–4 klaar. Fase 5 klaar aan de kant van de software: laptoppakket, browserdemo, advies fabrieksserver, draaiboek (`docs/SERVER.md`), serverpakket, back-ups, hersteltest, herstel, database-updates, https, beperkte databasegebruiker en Beheer → Server.
- Volgende: de fabrieksserver met IT inrichten (WISHLIST #10) en de echte velden per stap (WISHLIST #2), dan de pilot (1.0.0).
- Alle gegevens zijn fictief (D1).
- Code in `Gertjun/batch-input-gui` (privé). Tests en releases lopen automatisch via GitHub Actions (`tests.yml`, `release.yml`).
- Links: browserdemo https://claude.ai/artifact/AvBGewCSnACg6h6CeUKZQN · advies fabrieksserver https://claude.ai/artifact/XbFZ7nQRDn18zSS5tnQhUf · Whiteboard https://claude.ai/artifact/Nm9L5rFHZY6Dtgk2JMncnF · projectdocument in de Claude-Project: `claude/architectuur-en-besluiten.md`.

## Tests

| Wat | Hoe | Laatste resultaat |
| --- | --- | --- |
| Databaseregels | `python3 tests/test_regels.py "<verbinding>"` | 60/60 |
| API | `cd api && npm test` (`TEST_DATABASE_URL`, en `TEST_APP_DATABASE_URL` voor `batchgui_app`) | 32/32 |
| Schema en migraties gelijk | `tests/test_migraties.sh` | geslaagd |
| Beheertools | `tests/test_tools.sh` | geslaagd |
| Opruimschema back-ups | `node --test tests/rotatie.test.mjs` | 5/5 |
| Invoerscherm in Chrome | `invoer/e2e/flow.mjs` | 20/20 |
| Portalen in Chrome | `portaal/e2e/portaal.mjs`, `productie.mjs`, `beheer.mjs` | 15, 10, 21 |
| Browserdemo | `portaal/e2e/demo.mjs` | 11/11 |
| Laptoppakket | schone installatie, en update van een 0.5-database | geslaagd |
| Serverpakket | schone installatie op Linux met https, back-up en hersteltest | geslaagd |

Op GitHub draaien automatisch (Node.js 22 en 26): databaseregels, migraties, API met `batchgui_app`, opruimschema, beheertools, en controle en bouw van de schermen. De schermtests in Chrome draaien alleen lokaal.

**Niet uitgevoerd in de praktijk:** serverpakket en draaiboek op een echte Windows Server (WinSW, Taakplanner, junction, pfx-certificaat), laptoppakket op een echte Windows-laptop, browserdemo op claude.ai zelf (alleen lokaal in Chrome), invoerscherm offline op een fabrieks-pc via https, tablet via het netwerk.

## Open punten
- Geert: advies fabrieksserver met IT bespreken; de vier vragen onder "Nog te besluiten" in het advies beantwoorden.
- Geert: echte velden per stap aanleveren (WISHLIST #2); besluiten over analyses per operator (#8) en andere afdelingen (#9).
- Geert: laptoppakket 0.6.0 en de browserdemo proberen; bevindingen terugmelden.
- Let op bij het opnieuw maken van `tools/pakket/testdata.sql`: neem `schema_versie` en `onderhoud_log` niet mee in de dump (`--exclude-table`), anders botst het laden met `schema.sql`.

## Sessielog (nieuwste bovenaan)
- **18 nov 2026 · 0.6.0** — Advies fabrieksserver (document) en draaiboek; serverpakket; back-up, hersteltest en herstel; migraties met schemaversie; `batchgui_app` met beperkte rechten; https; Beheer → Server; laptoppakket werkt database bij; tests op Node.js 22 en 26.
- **18 nov 2026 · 0.5.1** — Werkafspraken uit Geerts andere projecten overgenomen (CLAUDE, NOTES, DECISIONS D1–D20, WISHLIST), changelog in gewone taal, automatische tests en releases op GitHub; handleiding laptoppakket heet nu README.md.
- **18 nov 2026 · 0.5.0** — Laptoppakket, browserdemo, versienummering, GitHub-repository aangemaakt.
- **18 nov 2026 · 0.4.0** — Portalen Kwaliteit, Productie en Beheer.
