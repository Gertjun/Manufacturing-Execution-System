# Batch input GUI – testen op je laptop

Dit pakket draait het hele platform op één laptop: invoerscherm, portalen Kwaliteit, Productie en Beheer, en de server. Alle gegevens zijn fictief. Er is geen internet nodig zodra alles is geïnstalleerd.

## Eenmalig installeren (Windows)

Je hebt twee programma's nodig. Op een bedrijfslaptop heb je daar soms beheerdersrechten voor nodig; vraag dan IT.

1. **Node.js 22 LTS**: download de *Windows Installer (.msi)* van https://nodejs.org en installeer met de standaardkeuzes.
2. **PostgreSQL 17** (16 kan ook): download de installer van https://www.postgresql.org/download/windows/ (EDB-installer).
   - Kies een wachtwoord voor de gebruiker `postgres` en **onthoud het**; het opstartscript vraagt erom.
   - Laat de poort op 5432 staan. Stack Builder aan het eind is niet nodig.
3. **Pak deze zip uit** naar een vaste map, bijvoorbeeld `C:\batch-gui`. Start niet vanuit het zip-venster zelf.

## Starten

Dubbelklik op **START.bat**.

- De eerste keer stelt het een paar vragen (Enter = standaard). Alleen het PostgreSQL-wachtwoord moet je invullen.
- Daarna maakt het de database `batchgui` aan en laadt 90 dagen fictieve productie (ongeveer 540 batches). Dat duurt minder dan een minuut. De tijdstippen worden verschoven zodat de gegevens tot vandaag lopen.
- De browser opent vanzelf op http://localhost:3000/ met links naar het invoerscherm, de portalen en de API-documentatie.

Krijg je een blauwe Windows-melding ("Windows heeft uw pc beschermd")? Kies *Meer informatie* → *Toch uitvoeren*.

**Stoppen:** sluit het zwarte venster. De gegevens blijven bewaard; de volgende keer start het direct.

## Testaccounts

Wachtwoord is steeds `demo`.

| Account | Komt in |
| --- | --- |
| `operator` | Invoerscherm (daarna pc en naam kiezen) |
| `ploegleider1` | Invoerscherm en Portaal Productie |
| `kwaliteit1` | Portaal Kwaliteit |
| `beheerder1` | Portaal Beheer |
| `analist1` | Portalen, alleen lezen |

## Wat je kunt uitproberen

- **Invoerscherm:** log in als `operator`, kies bijvoorbeeld PC-01 en een naam, start een stap voor een batch, vul waarden in (probeer een waarde buiten de grens) en rond af.
- **Offline:** zet tijdens het invoeren de server uit (venster sluiten). Het invoerscherm blijft werken en verstuurt alles zodra je START.bat weer start.
- **Kwaliteit:** de twee batches die op een keurresultaat wachten, de trend van S5.1 die langzaam oploopt, het lotpaspoort.
- **Productie:** werkvoorraad, doorlooptijden en de zes correcties.
- **Beheer:** wijzig een grens of koppel een stap aan een pc en kijk wat er in het invoerscherm en het logboek verandert.

## Opnieuw beginnen

- **TESTDATA OPNIEUW.bat**: maakt de database leeg en laadt verse testdata.
- Lege fabriek, alleen de configuratie: open een opdrachtprompt in deze map en typ `node opstarten.mjs --leeg`.

## Testen vanaf een tablet of andere pc

Standaard is alles alleen op de laptop zelf bereikbaar. Wil je vanaf een ander apparaat in hetzelfde netwerk testen:
1. Open `instellingen.json` in Kladblok en verander `"adres": "127.0.0.1"` in `"adres": "0.0.0.0"`.
2. Start opnieuw. Het venster toont het adres voor andere apparaten, bijvoorbeeld `http://192.168.1.23:3000/`.
3. Windows vraagt of Node.js het netwerk mag gebruiken: kies alleen **Privénetwerken**.

Let op: offline werken van het invoerscherm kan de browser alleen toestaan op `localhost` of via een beveiligde verbinding (https). Vanaf een ander apparaat werkt het invoerscherm dus wel, maar niet offline. Voor de echte server in de fabriek regelen we https.

## Problemen

| Melding | Oplossing |
| --- | --- |
| Node.js is niet gevonden | Installeer Node.js en start de laptop opnieuw op, of open START.bat opnieuw |
| PostgreSQL is niet bereikbaar | Controleer in *Services* dat `postgresql-x64-17` draait |
| Het wachtwoord klopt niet | Verwijder `instellingen.json` en start opnieuw |
| Poort 3000 is al in gebruik | De applicatie draait al in een ander venster, of kies een andere `"poort"` in `instellingen.json` |

## Mac of Linux

Installeer Node.js en PostgreSQL (bijvoorbeeld met Homebrew: `brew install node postgresql@17`) en start met `./start.sh` in deze map.

## Wat zit erin

| Map of bestand | Inhoud |
| --- | --- |
| `START.bat`, `start.sh` | Starten |
| `opstarten.mjs` | Maakt de database aan, laadt testdata en start de server |
| `server/` | De voorgebouwde server (API) |
| `web/` | Invoerscherm en portalen |
| `db/` | Databaseschema, configuratie en fictieve testdata |
| `instellingen.json` | Wordt bij de eerste start gemaakt; bevat het PostgreSQL-wachtwoord, dus niet delen |
