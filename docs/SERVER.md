# Draaiboek fabrieksserver – MES

Voor IT: installeren, back-ups, updates en herstel. Het advies waarom het zo is ingericht staat in het document "Advies fabrieksserver – Batch input GUI". Dit draaiboek is bijgewerkt tot versie 0.21.0. In de voorbeelden staat `0.21.0`; gebruik het versienummer van het pakket dat je installeert.

> **Let op:** de stappen voor Windows zijn opgesteld maar nog niet op een echte Windows Server uitgevoerd. De tools zelf (database-updates, back-up, hersteltest, herstel, https) zijn getest met PostgreSQL 16 op Linux. Loop de stappen de eerste keer samen met de leverancier van dit draaiboek door, op een testmachine.

## Wat je nodig hebt

| Onderdeel | Versie | Waar |
| --- | --- | --- |
| Windows Server 2025 (of 2022), of Ubuntu Server LTS | | |
| PostgreSQL | 18 | installer van EDB (Windows) of het PostgreSQL-pakket (Ubuntu) |
| Node.js | 26 LTS | nodejs.org |
| WinSW (alleen Windows) | 2.12 of nieuwer | github.com/winsw/winsw, bestand `WinSW-x64.exe` |
| Serverpakket | `batch-gui-server-<versie>.zip` | GitHub-release van `Gertjun/batch-input-gui` |
| Certificaat | `.pfx` (of `.crt` + `.key`) voor de servernaam | eigen certificaatdienst van IT |

## Mappen (Windows)

```
C:\batchgui\
  0.21.0\                uitgepakt serverpakket, per versie een eigen map
  huidig\                koppeling (junction) naar de versie die draait
  instellingen.json      instellingen, buiten de versiemappen
  certificaat\           batchgui.pfx
  logs\                  logboeken van de service
  batchgui-service.exe   WinSW
  batchgui-service.xml   configuratie van de service
D:\batchgui-backup\      back-ups (bij voorkeur een aparte schijf)
```

Alleen de beheerders en het serviceaccount mogen `C:\batchgui\instellingen.json` lezen: er staan wachtwoorden in.

## Eerste installatie (Windows)

1. **PostgreSQL 18 installeren** met de standaardkeuzes. Onthoud het wachtwoord van `postgres`. Stack Builder is niet nodig.
2. **Node.js 26 LTS installeren** met de standaardkeuzes.
3. **Serverpakket uitpakken** naar `C:\batchgui\0.21.0` en de koppeling maken:
   ```
   mklink /J C:\batchgui\huidig C:\batchgui\0.21.0
   ```
4. **Instellingen:** kopieer `C:\batchgui\huidig\service\instellingen.voorbeeld.json` naar `C:\batchgui\instellingen.json` en vul alles in waar `VUL-IN` staat. Voor `jwtGeheim` een willekeurige tekst van minstens 32 tekens, bijvoorbeeld de uitvoer van:
   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Zet daarna de omgevingsvariabele voor de beheertools (eenmalig, als beheerder):
   ```
   setx /M BATCHGUI_INSTELLINGEN C:\batchgui\instellingen.json
   ```
5. **Database aanmaken:** in een nieuw opdrachtvenster:
   ```
   cd C:\batchgui\huidig
   node tools\migreer.mjs
   ```
   Dit maakt de database `batchgui`, het schema en de gebruiker `mes_app` aan. Zet daarna het wachtwoord van die gebruiker (hetzelfde als in de instellingen):
   ```
   "C:\Program Files\PostgreSQL\18\bin\psql" -U postgres -d batchgui -c "ALTER ROLE mes_app PASSWORD 'het-wachtwoord'"
   ```
6. **Eerste beheerder en configuratie:**
   ```
   node tools\beheerder.mjs
   ```
   vraagt bij een lege identiteitsadministratie om drie afzonderlijke persoonlijke identiteiten (System Administrator en twee Security Administrators), eigen wachtwoorden en goedkeuringsreferentie. Technisch beheer en inhoudelijk beheer blijven gescheiden. Bij bestaande accounts biedt deze opdracht uitsluitend hersteldiagnose. Voor een test kan `db\seed_config.sql` (fictieve stappen, velden, operators en pc's, geen accounts). Laad `db\seed_accounts_demo.sql` (wachtwoord `demo`) nooit op een database met echte gegevens.
7. **Proefstart:** `node tools\start-server.mjs` en open `https://<servernaam>/gezondheid` op een pc. Verwacht: `{"status":"ok", ...}`. Stop met Ctrl+C.
8. **Windows-service:** zet `WinSW-x64.exe` als `C:\batchgui\batchgui-service.exe` neer en kopieer `C:\batchgui\huidig\service\batchgui-service.xml` naar `C:\batchgui\`. Controleer de paden (Node.js, PostgreSQL-servicenaam bij `depend`). Dan als beheerder:
   ```
   C:\batchgui\batchgui-service.exe install
   C:\batchgui\batchgui-service.exe start
   ```
   De service start automatisch na een herstart en na een fout. Standaard draait hij als LocalSystem; een eigen serviceaccount met leesrecht op `C:\batchgui` mag ook.
9. **Back-ups inplannen** (Taakplanner, als beheerder):
   ```
   schtasks /Create /TN "Batch input GUI\Back-up" /SC HOURLY /RU SYSTEM /TR "\"C:\Program Files\nodejs\node.exe\" C:\batchgui\huidig\tools\backup.mjs"
   schtasks /Create /TN "Batch input GUI\Hersteltest" /SC MONTHLY /D 1 /ST 03:30 /RU SYSTEM /TR "\"C:\Program Files\nodejs\node.exe\" C:\batchgui\huidig\tools\herstel.mjs --controle"
   ```
   Laat de NAS of de back-upsoftware van IT de map `D:\batchgui-backup` elk uur ophalen, en neem hem op in de nachtelijke kopie buiten het gebouw.
10. **Firewall:** poort 443 open vanaf het fabrieksnetwerk. PostgreSQL (5432) niet openzetten voor het fabrieksnetwerk; alleen afzonderlijk goedgekeurde persoonlijke securitybediening via een afgeschermd IT-beheerpunt.
    **Klok:** laat de server en de pc's hun tijd van dezelfde tijdserver halen (domeincontroller of NTP). De tijdzone van de server zelf maakt niet uit: `migreer.mjs` zet de database op de tijdzone van de fabriek (Europe/Amsterdam) en de applicatie rekent daarin. Dat lukt alleen als de gebruiker in `beheerDb` eigenaar van de database is (zoals `postgres`); anders zet de applicatie de tijdzone per verbinding.
11. **Controle:** log in met een persoonlijk account met system.read op `https://<servernaam>/portaal/` en open **Beheer → Server**. Na het eerste uur staat er een back-up; draai de hersteltest één keer met de hand (`node tools\herstel.mjs --controle`) zodat ook die er staat.

## Ubuntu Server (in het kort)

- Pakket uitpakken naar `/opt/batchgui/0.21.0`, `ln -sfn /opt/batchgui/0.21.0 /opt/batchgui/huidig`, instellingen in `/etc/batchgui/instellingen.json` (eigenaar root, groep batchgui, rechten 640). `pgBin` is alleen nodig als er meer PostgreSQL-versies op de server staan; zet hem dan op `/usr/lib/postgresql/18/bin`.
- Gebruiker: `useradd --system batchgui`. Database: `BATCHGUI_INSTELLINGEN=/etc/batchgui/instellingen.json node tools/migreer.mjs`.
- Service: `service/batchgui.service` naar `/etc/systemd/system/`, dan `systemctl enable --now batchgui`.
- Back-ups via cron, bijvoorbeeld `/etc/cron.d/batchgui`:
  ```
  BATCHGUI_INSTELLINGEN=/etc/batchgui/instellingen.json
  5 * * * *  batchgui  /usr/bin/node /opt/batchgui/huidig/tools/backup.mjs
  30 3 1 * * batchgui  /usr/bin/node /opt/batchgui/huidig/tools/herstel.mjs --controle
  ```

## Update naar een nieuwe versie

Lees eerst de changelog: staat er **MAJOR**, of "werk alle pc's bij", dan volgt daar wat extra nodig is. Anders:

1. Kies een moment buiten productietijd of tussen twee batches; meld het aan de ploegleider.
2. Pak de nieuwe versie uit naast de oude, bijvoorbeeld `C:\batchgui\0.22.0`.
3. Back-up: `node C:\batchgui\huidig\tools\backup.mjs`. (Sinds 0.21.0 maakt `migreer.mjs` zelf ook een back-up vóór een database-update, `batchgui_<datum_tijd>_voor-migratie-<nummer>.dump`; mislukt die, dan verandert er niets.)
4. Service stoppen: `C:\batchgui\batchgui-service.exe stop`
5. Koppeling omzetten en database bijwerken:
   ```
   rmdir C:\batchgui\huidig
   mklink /J C:\batchgui\huidig C:\batchgui\0.22.0
   cd C:\batchgui\huidig
   node tools\migreer.mjs
   ```
6. Service starten: `C:\batchgui\batchgui-service.exe start`
7. Controleer in **Beheer → Server** de versie, en voer op één pc een stap in.

**Terugdraaien:** service stoppen, koppeling terug naar de oude map. Heeft `migreer.mjs` de database bijgewerkt, zet dan ook de back-up van stap 3 (of de back-up `…_voor-migratie-….dump`) terug (zie hieronder). Een oudere versie start niet op een nieuwere database; dat voorkomt verkeerde invoer.

## Herstel na een storing

```
C:\batchgui\batchgui-service.exe stop
cd C:\batchgui\huidig
node tools\herstel.mjs D:\batchgui-backup\batchgui_<datum_tijd>_v<versie>.dump
node tools\migreer.mjs
C:\batchgui\batchgui-service.exe start
```

- Het herstel vraagt om `HERSTEL` te typen. De huidige database blijft bewaard als `batchgui_voor_herstel_<datum_tijd>`; ruim die pas op als alles weer goed draait.
- Mislukt het terugzetten halverwege, dan zet het script de oude database automatisch terug.
- Na het herstel sturen de invoerschermen hun wachtrij alsnog door. Wat na de gebruikte back-up is ingevoerd en al verstuurd was, moet opnieuw worden ingevoerd; vraag de ploegleiders dat na te lopen.

## Overzicht van de tools

| Opdracht | Wat | Wie |
| --- | --- | --- |
| `node tools/start-server.mjs` | start de applicatie (doet de service) | service |
| `node tools/migreer.mjs` | database aanmaken of bijwerken, rechten toepassen | IT, bij installatie en update |
| `node tools/migreer.mjs --status` | welke database-updates zijn uitgevoerd | IT |
| `node tools/backup.mjs` | back-up maken en oude opruimen (48 uur, 30 dagen, 12 maanden) | taakplanner, elk uur |
| `node tools/herstel.mjs --controle` | hersteltest in een tijdelijke database | taakplanner, elke maand |
| `node tools/herstel.mjs <bestand>` | echte herstel | IT, bij een storing |
| `node tools/beheerder.mjs` | bootstrap op lege administratie of alleen-lezen hersteldiagnose | IT of applicatiebeheerder, op de server zelf |

De back-up- en hersteltools moeten dezelfde PostgreSQL-versie gebruiken als de server; `herstel.mjs` controleert dat en stopt met uitleg als `pg_restore` nieuwer is.

Alle tools lezen `instellingen.json` (of het bestand in `BATCHGUI_INSTELLINGEN`, of `--instellingen <pad>`). Het resultaat van back-ups, hersteltests, herstel en updates staat in **Beheer → Server**.

## Monitoring

- `GET https://<servernaam>/gezondheid`: 200 met `{"status":"ok","versie":"…","database":"ok"}`, of 503 als de database niet bereikbaar is.
- **Beheer → Server** toont een waarschuwing als de laatste back-up ouder is dan 2 uur of mislukt, als de laatste hersteltest ouder is dan 35 dagen of mislukt, en bij 20 of meer mislukte inlogpogingen in 24 uur.
- Na 5 verkeerde wachtwoorden binnen 15 minuten wacht een gebruikersnaam 1 minuut. Alle pogingen staan in de tabel `fabriek.inlogpoging` (zonder wachtwoord); `backup.mjs` ruimt pogingen ouder dan 90 dagen op. Invoer van een pc die de server weigert, staat in `fabriek.geweigerde_invoer` (voor het pilotoverzicht); ook die ruimt `backup.mjs` na 90 dagen op.
- De pagina's worden geleverd met beveiligingskoppen (Content-Security-Policy, X-Frame-Options). Zet er geen proxy voor die deze koppen weghaalt.

### Overgang databaseaccount naar MES

Nieuwe installaties gebruiken `mes_app`. Bij bestaande installaties blijft `batchgui_app` tijdelijk bruikbaar via de rechten van `mes_app`; het bestaande wachtwoord blijft ongewijzigd. IT stelt een eigen wachtwoord voor `mes_app` in, wijzigt alleen de databasegebruikersnaam en het bijbehorende wachtwoord in de serverinstellingen en verifieert de verbinding. Pas na gecontroleerde omschakeling mag IT de oude login buiten gebruik stellen; controleer eerst andere databases in hetzelfde PostgreSQL-cluster. Databasenaam en schema blijven ongewijzigd. Beide accounts blijven tijdens de overgang beperkt; bij nieuwe beschermde tabellen worden eventuele directe oude grants eveneens ingetrokken.


## Persoonlijke securitybediening (D100/D101, fase 1)

D102/0094: goedgekeurde eenmalige initialisatie van bestaande persoonlijke identiteiten zonder MES-rechtenhistorie, via eigenaar en drie persoonlijke bevestigingen. Geen automatische legacy-grants; drie exact afgebakende grants, sessiegeneratie verhoogd, onveranderlijk bootstraprecord. Schone bootstrap blijft voorkeur voor fictieve pre-pilot. Gerichte DB- en toolregressies toegevoegd; uitvoeringsbewijs open.

Voor een bestaande administratie zonder MES-rechtenhistorie: eigenaar voert `node tools/beheerder.mjs --initialiseer-bestaand` interactief uit met drie persoonlijk aanwezige accounthouders en goedkeuringsreferentie. Daarna opnieuw inloggen en persoonlijke securitylogins afzonderlijk binden. Geen herhaling of gebruik als noodherstel.

- IT richt per bevoegde persoon een afzonderlijke PostgreSQL-login in, zonder beheerattributen of andere groepsrollen, uitsluitend met lidmaatschap van `mes_security_channel`. Geen rechtstreeks toegekende objectrechten of delegatie. Controleer ook andere databases in het cluster.
- Beperk toegang tot een beheerpunt; gebruik PostgreSQL-TLS met vertrouwde certificaatketen en passende hostnaam, SCRAM en passende pg_hba-regels. Geen trust of uitgeschakelde certificaatcontrole. `tools/security.mjs` vereist TLS-verificatie en interactieve persoonlijke credentials. Gebruik voor securitybediening een afzonderlijk instellingenbestand met uitsluitend host, port en database in `db`, zonder eigenaar-/runtimegeheimen.
- Database-eigenaar registreert de vooraf goedgekeurde login met `node tools/beheerder.mjs --security-binden`. Securitypersoon gebruikt `node tools/security.mjs aanvragen`, `grants`, `aanvragen-indienen`, `goedkeuren`, `afwijzen` of `intrekken`. Onafhankelijke beslisser en persoonlijke MES-herbevestiging verplicht voor toekenning.
- Bij incident: trek binding in via `--security-intrekken`, blokkeer de database-login en beëindig bestaande sessies; vervang met nieuwe naam/OID na goedkeuring. Na restore securitytoegang blokkeren totdat actuele rollen, bindingen, privileges en intrekkingen met de externe administratie zijn vergeleken. Geen automatische herbinding; oude snapshot kan ingetrokken rechten opnieuw bevatten.
- Personeelskoppeling: `--personeel-koppelen`; kwalificaties: `--kwalificatie-overzicht`, `--kwalificatie-toekennen`, `--kwalificatie-intrekken`; regulier herstel: `--herstel-account`. Eigenaar faciliteert; persoonlijke bevestigingen en onafhankelijke actoren volgens databaseprocedure. Bewaar geen wachtwoorden in bewijsstukken.
- Werkelijke TLS/terminalbediening en organisatorische verificatie zijn nog niet op de fabrieksserver getest. Zie PRAKTIJKTESTS.md. Geen productieomschakeling op basis van alleen CI.
