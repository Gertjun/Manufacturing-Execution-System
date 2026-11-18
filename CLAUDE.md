# CLAUDE.md – werkafspraken voor Claude

Dit zijn de afspraken uit Geerts andere projecten (Vaste Lasten, Cryptotracker, PWA-Core en de andere apps), aangepast aan dit fabrieksplatform. Bij twijfel gaan de besluiten in `DECISIONS.md` voor.

## Aan het begin van een sessie
1. Lees **`NOTES.md`** (stand en open punten), **`DECISIONS.md`** (eerdere besluiten) en alleen de bovenste paar versies van **`CHANGELOG.md`**. Lees niet de volledige chatgeschiedenis.
2. Lees daarna alleen de code die je nodig hebt (`README.md` beschrijft de opbouw).
3. Koppel de GitHub-repository `Gertjun/batch-input-gui` met schrijfrechten en haal de laatste versie op (`git fetch origin main`). Kijk of de laatste testrun op GitHub groen is.

## Tijdens het werk
- **Taal en uitleg:** Nederlands, kort en zonder vakjargon. Alle teksten in de schermen zijn ook Nederlands.
- **"Hoe zou je…" of "nog niet bouwen":** eerst uitleggen en wachten op akkoord.
- **Alleen fictieve gegevens.** Nooit echte fabrieksgegevens, wachtwoorden of tokens in code, tests, logs of commits. Testdata komt uit `tools/genereer_testdata.py`.
- **Elke wijziging is een eigen versie** (`MAJOR.MINOR.PATCH`), zie D17:
  - MAJOR als iemand iets moet doen buiten de schermen om: alle pc's tegelijk bijwerken, een database-omzetting met stilstand, opnieuw instellen. Versie 1.0.0 is de start van de pilot met echte data.
  - MINOR voor een nieuwe functie, ook als de database erbij verandert zonder dat iemand iets hoeft te doen.
  - PATCH voor een kleine verbetering of foutoplossing.
  - **Versie op alle plekken gelijk ophogen** met `tools/zet_versie.sh <versie>` (`VERSIE`, alle `package.json`'s, `api/src/versie.ts`, `gedeeld/versie.ts`).
  - **`CHANGELOG.md`** bijwerken in gewone taal, en **`WISHLIST.md`**: wat gebouwd is, gaat van Gepland naar Gerealiseerd.
  - Een download of pakket draagt het versienummer in de bestandsnaam (`batch-gui-laptop-0.5.1.zip`).
- **Oudere invoerschermen blijven werken.** Een pc kan offline zijn en een wachtrij hebben uit een oudere versie. Een wijziging aan de API moet die oudere invoer nog accepteren, of het is een MAJOR-versie met de melding "werk alle pc's bij" (D18).
- **Regels horen in de database**, niet in de schermen (D9).
- **Databasewijziging = migratie** (D23): nieuw bestand `db/migraties/NNNN_naam.sql`, dezelfde wijziging in `db/schema.sql` plus de regel in `schema_versie`, en `tests/test_migraties.sh` moet slagen. Migraties nooit achteraf aanpassen.
- **Beperkte databasegebruiker** (D24): de applicatie draait als `batchgui_app`. Heeft een nieuwe functie extra rechten nodig, pas dan `db/rechten.sql` aan; de API-tests draaien met die gebruiker.
- **Testen vóór elke push:** databaseregels (`tests/test_regels.py`), API (`api: npm test`, met `TEST_APP_DATABASE_URL` voor `batchgui_app`), migraties (`tests/test_migraties.sh`), beheertools (`tests/test_tools.sh`), opruimschema (`node --test tests/rotatie.test.mjs`), en de schermtests in Chrome (`invoer/e2e`, `portaal/e2e`) voor wat je hebt veranderd. Daarna rechtstreeks naar `main` (geen force-push, geschiedenis niet herschrijven). Gaat er iets mis: `git revert` en pushen.
- **Groen op GitHub is niet alles.** De automatische tests bewijzen niet dat offline werken, een echte Windows-pc of het netwerk in de fabriek werkt. Noem praktijktests die niet zijn uitgevoerd altijd expliciet.
- **Release-tags worden nooit achteraf gewijzigd.** Tags en GitHub Releases maakt de workflow `release.yml` automatisch voor elke nieuwe versie op `main`.
- Ga je in tegen een besluit uit `DECISIONS.md`? Zeg dat en vraag het eerst.
- Het `README.md` heet altijd `README.md` (niet `LEESMIJ.md`).
- Pin externe GitHub Actions op een vaste commit-SHA.

## Aan het eind van een sessie (altijd)
1. **`NOTES.md`**: versie en datum bovenaan, stand en open punten bijwerken, één of twee regels in het sessielog (nieuwste bovenaan).
2. **`DECISIONS.md`**: een nieuw `D<n>`-besluit voor elke keuze die een volgende sessie moet kennen. Oude besluiten pas je niet aan; een nieuw besluit vervangt een oud ("vervangt D3").
3. Werk ook het projectdocument in de Claude-Project bij (`claude/architectuur-en-besluiten.md`) en het Whiteboard als de fase of opbouw verandert.
4. Push naar `main` en controleer dat de testrun groen wordt.
