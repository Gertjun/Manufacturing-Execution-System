# NOTES – Batch input GUI

De **actuele stand**: versie, open punten en sessielog. Werk dit bij aan het eind van elke sessie (zie `CLAUDE.md`). Besluiten staan in `DECISIONS.md`, wensen in `WISHLIST.md`.

Laatst bijgewerkt: 18 november 2026 · versie **0.5.1**

---

## Actuele stand – 18 november 2026

- Fase 0–4 klaar: datamodel en databaseregels, API, invoerscherm (offline), lot samenstellen, portalen Kwaliteit, Productie en Beheer.
- Fase 5 bezig: laptoppakket en browserdemo klaar; serveradvies, back-ups, updates uitrollen en https volgen (WISHLIST #1).
- Alle gegevens zijn fictief (D1). Er zijn nog geen echte velden per stap (WISHLIST #2).
- Code in `Gertjun/batch-input-gui` (privé). Tests en releases lopen automatisch via GitHub Actions (`tests.yml`, `release.yml`).
- Browserdemo: https://claude.ai/artifact/AvBGewCSnACg6h6CeUKZQN (privé). Whiteboard: https://claude.ai/artifact/Nm9L5rFHZY6Dtgk2JMncnF. Projectdocument in de Claude-Project: `claude/architectuur-en-besluiten.md`.

## Tests

| Wat | Hoe | Laatste resultaat |
| --- | --- | --- |
| Databaseregels | `python3 tests/test_regels.py "<verbinding>"` | 60/60 |
| API | `cd api && npm test` (database in `TEST_DATABASE_URL`) | 26/26 |
| Invoerscherm in Chrome | `invoer/e2e/flow.mjs` | 20/20 |
| Portalen in Chrome | `portaal/e2e/portaal.mjs`, `productie.mjs`, `beheer.mjs` | 15, 10, 17 |
| Browserdemo | `portaal/e2e/demo.mjs` | 10/10 |
| Laptoppakket | schone installatie met lege PostgreSQL | geslaagd |

Op GitHub draaien automatisch de databaseregels, de API-tests en de controle en bouw van de schermen. De schermtests in Chrome draaien (nog) alleen lokaal.

**Niet uitgevoerd in de praktijk:** laptoppakket op een echte Windows-laptop, browserdemo op claude.ai zelf (alleen lokaal in Chrome getest), invoerscherm offline op een echte fabrieks-pc, gebruik op tablet via het netwerk.

## Open punten
- Geert: laptoppakket op de eigen laptop proberen en de browserdemo openen; bevindingen terugmelden.
- Geert: echte velden per stap aanleveren (WISHLIST #2).
- Geert: besluiten over analyses per operator (WISHLIST #8) en andere afdelingen (WISHLIST #9).
- Claude: advies fabrieksserver (WISHLIST #1).
- Tag `v0.5.0` wordt door `release.yml` alsnog gemaakt bij de eerste run; daarna controleren dat beide releases er staan.

## Sessielog (nieuwste bovenaan)
- **18 nov 2026 · 0.5.1** — Werkafspraken uit Geerts andere projecten overgenomen (CLAUDE, NOTES, DECISIONS D1–D20, WISHLIST), changelog in gewone taal, automatische tests en releases op GitHub; handleiding laptoppakket heet nu README.md.
- **18 nov 2026 · 0.5.0** — Laptoppakket, browserdemo, versienummering, GitHub-repository aangemaakt.
- **18 nov 2026 · 0.4.0** — Portalen Kwaliteit, Productie en Beheer.
