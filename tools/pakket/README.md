# Batch input GUI – proof of concept op je laptop

Dit pakket draait het hele platform op één Windows-laptop: invoerscherm, portalen Kwaliteit, Productie en Beheer, de server en de database. **Je hoeft niets te installeren en geen beheerdersrechten te hebben**: Node.js en PostgreSQL zitten in het pakket. Er is geen internet nodig.

Bij de start staan er 90 dagen fictieve productie in. Je kunt ook met een lege fabriek beginnen en zelf stappen en velden inrichten.

## Starten

1. **Pak de zip uit** naar een vaste map, bijvoorbeeld `C:\batch-gui`. Niet in OneDrive (Bureaublad en Documenten worden vaak gesynchroniseerd) en niet vanuit het zip-venster zelf starten.
2. **Dubbelklik op `START.bat`.** De eerste keer maakt hij de database aan en laadt de testdata; dat duurt minder dan een minuut.
3. De browser opent vanzelf op http://localhost:3000/ met links naar het invoerscherm, de portalen en de API-documentatie.

Krijg je een blauwe Windows-melding ("Windows heeft uw pc beschermd")? Kies *Meer informatie* → *Toch uitvoeren*.

**Stoppen:** druk **Ctrl+C** in het zwarte venster en beantwoord de vraag "Batchtaak beëindigen (J/N)?" met **J** (of sluit gewoon het venster). De database wordt netjes afgesloten; je gegevens blijven bewaard en de volgende keer start alles direct.

## Testaccounts

Met de fictieve testdata zijn er testaccounts; het wachtwoord is steeds `demo`. Wijzig of vervang ze in Portaal Beheer (Accounts) als je anderen laat meekijken.

| Account | Komt in |
| --- | --- |
| `operator` | Invoerscherm (daarna pc en naam kiezen) |
| `ploegleider1` | Invoerscherm en Portaal Productie |
| `kwaliteit1` | Portaal Kwaliteit |
| `planner1` | Portaal Planning |
| `beheerder1` | Portaal Beheer |
| `analist1` | Portalen, alleen lezen |

## Wat je kunt uitproberen

- **Invoerscherm:** log in als `operator`, kies bijvoorbeeld PC-01 en een naam, start een stap voor een batch, vul waarden in (probeer een waarde buiten de grens) en rond af.
- **Offline:** stop de applicatie terwijl het invoerscherm open is. Het invoerscherm blijft werken en verstuurt alles zodra je START.bat weer start.
- **Kwaliteit:** de batches die op een keurresultaat wachten, de trend van S5.1 die langzaam oploopt, het lotpaspoort.
- **Productie:** werkvoorraad, doorlooptijden en de correcties.
- **Beheer:** wijzig een grens of koppel een stap aan een pc en kijk wat er in het invoerscherm en het logboek verandert. Onder **Server** zie je de versie en de laatste back-up.

## Je eigen proces inrichten

Dubbelklik op **`LEGE FABRIEK.bat`**: dan blijven alleen de stappen, velden, operators en pc's over, zonder batches en **zonder testaccounts**. Het zwarte venster vraagt je dan om **de eerste beheerder**: kies een gebruikersnaam (bijvoorbeeld je voornaam) en een wachtwoord van minstens 8 tekens. Daarmee log je in op Portaal Beheer en maak je de andere accounts aan (bijvoorbeeld het gedeelde account voor operators), en pas je de stapnamen en velden aan je eigen proces aan.

## Wachtwoord van de beheerder vergeten

Dubbelklik op **`BEHEERDER HERSTELLEN.bat`**. Je kiest een beheerder en geeft die een nieuw wachtwoord (een uitgezette beheerder gaat daarbij weer aan), of je maakt een nieuwe beheerder. Dat kan alleen op deze laptop zelf, en het komt in het logboek van Portaal Beheer.

Let op: dit is een proof of concept. Gebruik geen gegevens die vertrouwelijk zijn zolang de laptop niet daarvoor is ingericht.

## Back-ups

- Bij **elke start** maakt het pakket eerst een back-up van de database in `data\backups`. De laatste 5 blijven bewaard (samen ongeveer 400 MB).
- **Terugzetten:** dubbelklik op **`BACKUP TERUGZETTEN.bat`** en kies een nummer. De database van daarvoor blijft bewaard in de map `data`.
- Wil je de gegevens veilig stellen of meenemen? Stop de applicatie en kopieer de hele map `data` (bijvoorbeeld naar een USB-stick).

## Opnieuw beginnen

- **`TESTDATA OPNIEUW.bat`**: verse fictieve testdata (90 dagen).
- **`LEGE FABRIEK.bat`**: alleen de configuratie, geen batches en geen testaccounts; je maakt zelf de eerste beheerder aan.

Bij beide wordt eerst een back-up gemaakt van wat er nu in staat.

## Nieuwe versie

Pak de nieuwe zip uit naar een **nieuwe map** en kopieer uit de oude map de map **`data`** en het bestand **`instellingen.json`** mee. Bij het starten wordt de database automatisch bijgewerkt; je gegevens blijven staan. De oude map kun je daarna weggooien.

## Laten meekijken vanaf een tablet of andere pc

Standaard is alles alleen op de laptop zelf bereikbaar. Om in hetzelfde netwerk mee te laten kijken:

1. Stop de applicatie. Open `instellingen.json` in Kladblok en verander `"adres": "127.0.0.1"` in `"adres": "0.0.0.0"`.
2. Start opnieuw. Het venster toont het adres voor andere apparaten, bijvoorbeeld `http://192.168.1.23:3000/`.
3. Windows vraagt of Node.js het netwerk mag gebruiken: kies alleen **Privénetwerken**. Mag dat op een bedrijfslaptop niet, dan blijft het bij de laptop zelf.

Offline werken kan de browser alleen toestaan op de laptop zelf of via https. Op een ander apparaat werkt het invoerscherm dus wel, maar niet offline. Dat regelen we bij de echte server.

## Problemen

| Melding | Oplossing |
| --- | --- |
| De ingebouwde database start niet | Draait de applicatie al in een ander venster? Sluit alle vensters en start opnieuw. Anders: poort 54329 is bezet; kies een andere `"port"` onder `"db"` in `instellingen.json`. |
| Poort 3000 is al in gebruik | De applicatie draait al, of een ander programma gebruikt 3000; kies een andere `"poort"` in `instellingen.json`. |
| De database reageert niet | Sluit alle vensters van de applicatie, wacht even en start opnieuw. |
| Melding over OneDrive | Verplaats de map naar bijvoorbeeld `C:\batch-gui`. |

Lukt het niet, stuur dan de inhoud van `data\postgres.log` en een foto van het zwarte venster mee.

## Wat zit erin

| Map of bestand | Inhoud |
| --- | --- |
| `START.bat` | Starten |
| `LEGE FABRIEK.bat`, `TESTDATA OPNIEUW.bat`, `BACKUP TERUGZETTEN.bat` | Opnieuw beginnen of terugzetten |
| `BEHEERDER HERSTELLEN.bat` | Nieuw wachtwoord voor een beheerder, of een nieuwe beheerder |
| `opstarten.mjs` | Start de database, maakt back-ups, start de applicatie |
| `runtime\` | Node.js 26 LTS (officiële versie) |
| `postgres\` | PostgreSQL 18, alleen bereikbaar op deze laptop |
| `server\`, `web\` | De applicatie: server, invoerscherm en portalen |
| `db\`, `tools\` | Databaseschema, updates en fictieve testdata |
| `data\` | Wordt bij de eerste start gemaakt: jouw database, back-ups en logboek |
| `instellingen.json` | Wordt bij de eerste start gemaakt: poorten en een geheime sleutel voor het inloggen |
