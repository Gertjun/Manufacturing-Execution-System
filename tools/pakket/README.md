# Batch input GUI – proof of concept op je laptop

Dit pakket draait het hele platform op één Windows-laptop: invoerscherm, portalen Kwaliteit, Productie, Planning en Beheer, het wandscherm, de server en de database. **Je hoeft niets te installeren en geen beheerdersrechten te hebben**: Node.js en PostgreSQL zitten in het pakket. Er is geen internet nodig.

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
| `operator.a`, `operator.b` | Invoerscherm, met een eigen account (daarna de pc kiezen) |
| `operator` | Het oude gedeelde account: invoerscherm, daarna pc en naam kiezen |
| `ploegleider1`, `ploegleider2` | Invoerscherm en de portalen Productieanalyse, Kwaliteit en Planning |
| `kwaliteit1` | Portaal Kwaliteit, en het invoerscherm op de lab-pc (metingen en keuring) |
| `productiemanager1` | Portalen Productieanalyse, Kwaliteit en Planning; herbewerkingen |
| `planner1` | Portaal Planning |
| `scherm1` | Wandscherm (voor een tv in de hal) |
| `beheerder1` | Portaal Beheer |
| `analist1` | Portalen, alleen lezen |

Hulp per rol staat in de schermen onder **Hulp**, en is per rol af te drukken op één A4.

## Wat je kunt uitproberen

- **Invoerscherm:** log in als `operator.a`, kies bijvoorbeeld PC-01, start een stap voor een batch, vul waarden in (probeer een waarde buiten de grens) en rond af.
- **Offline:** stop de applicatie terwijl het invoerscherm open is. Het invoerscherm blijft werken en verstuurt alles zodra je START.bat weer start.
- **Kwaliteit:** de batches die op een keurresultaat wachten, de trend van S5.1 die langzaam oploopt, het lotpaspoort.
- **Productie:** werkvoorraad, doorlooptijden en de correcties.
- **Planning:** log in als `planner1`, plan batches voor de komende dagen, bekijk de planning per stap en de lotvoorstellen.
- **Wandscherm:** log in als `scherm1` voor het overzicht dat later op een tv in de hal komt.
- **Beheer:** wijzig een grens of koppel een stap aan een pc en kijk wat er in het invoerscherm en het logboek verandert. Onder **Server** zie je de versie en de laatste back-up.

## Je eigen proces inrichten

**LEGE FABRIEK.bat** maakt een lege fictieve fabriek met configuratie en zonder testaccounts. De gecontroleerde MES-bootstrap vraagt een reden en drie verschillende persoonlijke identiteiten: een System Administrator en twee Security Administrators. Iedere accounthouder kiest zelf zijn wachtwoord. Technische en inhoudelijke bevoegdheden worden niet automatisch gecombineerd.

## Wachtwoord vergeten

**BEHEERDER HERSTELLEN.bat** biedt op een bestaande identiteitsadministratie uitsluitend een hersteldiagnose; de oude directe wachtwoordreset is geblokkeerd. Gecontroleerd herstel vereist de afzonderlijke procedure in `tools/beheerder.mjs --herstel-account` en onafhankelijke persoonlijke bevestigingen. Een uitzonderlijk noodherstel vereist organisatorische escalatie.

## Databasebeveiliging

De ingebouwde PostgreSQL gebruikt afzonderlijke willekeurige wachtwoorden voor `mes_app` (applicatie) en `postgres` (technisch onderhoud), met SCRAM-SHA-256. De API weigert een verhoogde runtime-identiteit. Oude ingebouwde trust-configuraties worden offline omgezet; bij een fout stopt de starter. Bewaar de databasemap en instellingen altijd samen. Externe databases vereisen vooraf ingerichte afzonderlijke verbindingen (`db` en `beheerDb`); IT beheert authenticatie en toegangsrechten.

**PoC-grens:** de instellingen bevatten lokale databasegeheimen. Beveilig de volledige pakketmap, instellingen en back-ups met passende Windows-bestandsrechten. Deze lokale onderhoudsgrens biedt geen isolatie tegen een beheerder van de laptop of een proces met dezelfde bestandsrechten. Gebruik uitsluitend fictieve gegevens. Deel instellingen of onbeoordeelde logboeken niet.

## Back-ups

- Bij **elke start** maakt het pakket eerst een back-up van de database in `data\backups`. De laatste 5 blijven bewaard (samen ongeveer 400 MB).
- **Terugzetten:** dubbelklik op **`BACKUP TERUGZETTEN.bat`** en kies een nummer. De database van daarvoor blijft bewaard in de map `data`.
- Wil je de gegevens veilig stellen of meenemen? Stop de applicatie en kopieer de hele map `data` én het bijbehorende bestand `instellingen.json` naar een afgeschermde locatie.

## Opnieuw beginnen

- **`TESTDATA OPNIEUW.bat`**: verse fictieve testdata (90 dagen).
- **`LEGE FABRIEK.bat`**: alleen de configuratie, geen batches en geen testaccounts; je doorloopt de gecontroleerde bootstrap met drie persoonlijke beheeridentiteiten.

Bij beide wordt eerst een back-up gemaakt van wat er nu in staat.

## Nieuwe versie

Pak de nieuwe zip uit naar een **nieuwe map** en kopieer uit de oude map de map **`data`** en het bestand **`instellingen.json`** mee. Bij het starten wordt de database automatisch bijgewerkt; je gegevens blijven staan. Bewaar de oude map totdat de upgrade en het gegevensbehoud zijn gecontroleerd. Oude trust-back-ups worden bij herstel opnieuw beveiligd. Een al beveiligde back-up met andere beheercredentials vereist de bijbehorende instellingen; bij een mismatch stopt de starter zonder trust-fallback.

## Laten meekijken vanaf een tablet of andere pc

Standaard is alles alleen op de laptop zelf bereikbaar. Om in hetzelfde netwerk mee te laten kijken:

1. Stop de applicatie. Open `instellingen.json` in Kladblok en verander `"adres": "127.0.0.1"` in `"adres": "0.0.0.0"`.
2. Start opnieuw. Het venster toont het adres voor andere apparaten, bijvoorbeeld `http://192.168.1.23:3000/`.
3. Windows vraagt of Node.js het netwerk mag gebruiken: kies alleen **Privénetwerken**. Mag dat op een bedrijfslaptop niet, dan blijft het bij de laptop zelf.

Offline werken kan de browser alleen toestaan op de laptop zelf of via https. Op een ander apparaat werkt het invoerscherm dus wel, maar niet offline. Dat regelen we bij de echte server.

## Problemen

| Melding | Oplossing |
| --- | --- |
| De ingebouwde database start niet | Draait de applicatie al in een ander venster? Sluit alle vensters en start opnieuw. Anders: poort 54329 is bezet; stel dezelfde vrije poort in onder `db.port` en `beheerDb.port` in `instellingen.json`. |
| Poort 3000 is al in gebruik | De applicatie draait al, of een ander programma gebruikt 3000; kies een andere `"poort"` in `instellingen.json`. |
| De database reageert niet | Sluit alle vensters van de applicatie, wacht even en start opnieuw. |
| Melding over OneDrive | Verplaats de map naar bijvoorbeeld `C:\batch-gui`. |

Lukt het niet, deel uitsluitend gecontroleerde en zo nodig geanonimiseerde foutmeldingen; deel geen wachtwoorden of instellingen.json.

## Wat zit erin

| Map of bestand | Inhoud |
| --- | --- |
| `START.bat` | Starten |
| `LEGE FABRIEK.bat`, `TESTDATA OPNIEUW.bat`, `BACKUP TERUGZETTEN.bat` | Opnieuw beginnen of terugzetten |
| `BEHEERDER HERSTELLEN.bat` | Gecontroleerde bootstrap of alleen-lezen hersteldiagnose |
| `opstarten.mjs` | Start de database, maakt back-ups, start de applicatie |
| `runtime\` | Node.js 26 LTS (officiële versie) |
| `postgres\` | PostgreSQL 18, alleen bereikbaar op deze laptop |
| `server\`, `web\` | De applicatie: server, invoerscherm en portalen |
| `db\`, `tools\` | Databaseschema, updates en fictieve testdata |
| `data\` | Wordt bij de eerste start gemaakt: jouw database, back-ups en logboek |
| `instellingen.json` | Wordt bij de eerste start gemaakt: poorten, databasegeheimen en geheime sleutel voor het inloggen |
