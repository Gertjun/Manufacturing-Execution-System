# Rollen en processen

D89 P01–P15. Persoonlijk account met meerdere rollen, concrete permissions, scope en geldige kwalificaties. Vierogen en functiescheiding, geen ongecontroleerde zelftoekenning. Herbevestig identiteit bij MBR-goedkeuring/vrijgave, CR-revisie, kwaliteitsvrijgave/intrekking en kritische rechten; bind besluit aan exacte inhoud. Technische superuser-risico beperken via aparte accounts, gecontroleerd beheer en audit/back-up. Geen claim gekwalificeerde handtekening.

| Rol | Verantwoordelijkheid |
|---|---|
| Operator | Uitvoeren en registreren binnen scope en kwalificatie |
| Shift Supervisor | Werkvrijgave, operationele correcties en blokkades |
| Manufacturing Manager | Uitvoering, prestaties en operationele verantwoordelijkheid |
| Production Planner | Orders, planning en gedelegeerde werkvrijgave |
| Process Engineer | MBR-concepten, parameters, MOC en CR-wijzigingsvoorstellen |
| Engineering Approver | Onafhankelijke inhoudelijke beoordeling |
| Quality Technician | Keuringen en blokkades, geen definitieve vrijgave |
| Quality Approver | Specificaties, afwijkingsbesluiten, vrijgave en intrekking |
| Maintenance Technician | Technische beschikbaarheid en blokkades |
| System Administrator | Accounts, server, herstel; geen automatische inhoudelijke rechten |
| Security Administrator | Rechten met onafhankelijke goedkeuring |
| Analyst / Management | Raadplegen binnen privacy en scope |
| Display / Integration Account | Alleen specifieke machinefunctie |

Normale keten: MBR opstellen → MOC/impactanalyse → onafhankelijk beoordelen → goedkeuren/vrijgeven → productieorder → planning → dispatch + CR → uitvoeren → tussenkeuring → batch afronden → lotvorming/lotuitvoering → eindkeuring → EBR review → expliciete quality release → CoA → order afsluiten/analyse. MOC externe veiligheidsbeoordeling waar vereist; HAZOP niet vervangen. Planning mag voorlopige niet-beschikbare middelen inplannen, dispatch en start toetsen vereisten. Statusmodel MES: idle/running/paused/held/complete/stopped/aborted; geen fysieke commando's. Volledige overgangen later specificeren. Onafhankelijke operationele, equipment, quality, recipe en material holds; één opheffen heft andere niet op. Herbewerking aparte job order; FPY blijft historisch. Offline beperkte tijdgebonden uitvoeringsrechten, geen nieuwe onbekende opdracht, goedkeuring of vrijgave. Exacte rollenmatrix, MOC-classificatie, offline duur en fabriekskwalificaties nog valideren met organisatie. Privacybesluiten #8/#63/#79 blijven open.

Technische deelimplementatie PR #6: `api/src/modules/authorization/policy.ts` beoordeelt een activiteit op basis van één geldige grant met passend recht én alle opgegeven scopedimensies; kwalificaties worden afzonderlijk getoetst. Technische/security-rollen en displayrollen worden niet gecombineerd met inhoudelijke rollen. De module is nog niet verbonden met de bestaande routes; opslag, vertrouwde doelcontext en volledige handhaving volgen binnen fase 1.

D92: gebruikersaccounts worden niet via Excel geïmporteerd; andere Excel-functies blijven per domein beschikbaar.

Fase 1: migratie 0038 legt exacte roltoekenningsaanvragen en afzonderlijke besluiten vast. Onafhankelijke beoordelaar, geen zelftoekenning, geen tweede besluit, geldigheid en functiescheiding worden in de eigenaar-only procedure gecontroleerd. Dit is nog geen operationeel beheerkanaal: de identiteit wordt nog niet persoonlijk herbevestigd en de procedures zijn niet beschikbaar voor mes_app. Geen automatische security-grants.

Migratie 0039: kritische security-identiteiten worden beschermd tegen directe accountwijzigingen via de gewone app-login. De eigenaar-only bevestigde besluitfunctie controleert het huidige wachtwoord via de bestaande inlogprocedure en beslist in dezelfde aanroep over de specifieke aanvraag. Onjuist wachtwoord geeft een status zodat de mislukte poging bij commit behouden blijft. Dit is nog geen compleet veilig beheerkanaal: wachtwoordhash-toegang, gecontroleerd herstel, intrekking, het eigenaar-only pad zonder herbevestiging en API/UI-integratie moeten nog worden afgeschermd of uitgewerkt.

0040: tabelbrede leestoegang tot gebruiker vervangen door expliciete niet-geheime kolommen voor beide applicatielogins. Login en eigen wachtwoordwijziging gebruiken afgeschermde databasefuncties; demo-indicatie retourneert alleen namen uit een vaste lijst. De oude accountupdate leest de hash niet meer. Nog geen acceptatiebewijs: alle overige hash-afhankelijkheden, privileges, SECURITY DEFINER zoekpaden, tijdelijke wachtwoorden en gecontroleerd herstel moeten worden getest voordat de besluitfuncties voor de applicatie worden geopend.

0041: intrekking van een specifieke grant met persoonlijke herbevestiging, reden en auditspoor; aanvraag, besluit en intrekkingsrecord hebben update/delete-bescherming. Intrekking is een beperkende maatregel, niet een nieuwe toekenning; het kanaal is eigenaar-only. Geen formele conformiteitsclaim. De veilige zoekpaden van afgeschermde functies zijn expliciet na schema-normalisatie hersteld. Operationele recovery en API/UI nog open.

0043: stabiele Engelse role codes voor de dertien ontworpen MES-rollen. Security Administrator krijgt uitsluitend request/approve/revoke-permissions; overige concrete permissions volgen per activiteit. Demo-bootstrap heeft aparte security-identiteiten en één supervisor met meerdere rollen. Legacy-rolveld blijft tijdelijk aanwezig; nog geen claim dat legacy-routes functiescheiding afdwingen.

0044: concrete technische, engineering- en security-leesrechten. Beheerroutes gebruiken actuele authorization_permits via de gedeelde API-module; een begrensde grant mag geen globale wijziging uitvoeren. De oude legacy-beheerdersrol verleent op deze routes geen toegang meer. Productgebonden wijzigingen zijn voorlopig bewust globaal beperkt; vertrouwde doelcontext voor fijnmazige scopes volgt. Andere legacy-routes en gebruikersinterface nog niet omgeschakeld; geen algemene functiescheidingsclaim.

0045: schrijfroutes /registraties controleren actuele MES-permissions in de schrijftransactie. Productcontext komt uit batch, lotleden of stapregistratie. Area/equipment ontbreken nog als betrouwbare productiecontext; scoped grants daarop worden geweigerd. Legacy DB-regels blijven aanvullend actief tot omschakeling. Leesroutes en overige uitvoeringsroutes nog open.

0046: registratie- en keuringsleesroutes filteren op server-afgeleide productscope; technische/security-rollen krijgen geen impliciet leesrecht. Quality Approver heeft afzonderlijk inspection.decide; technician niet. Bestaande keuring is nog geen definitieve MES-quality-release; persoonlijke herbevestiging en DB-handhaving moeten vóór operationele acceptatie worden aangesloten. De voorspelling van toekomstige keuringen is uit de basis-MES verwijderd (D96/#88); actuele keuringen blijven beschikbaar.
