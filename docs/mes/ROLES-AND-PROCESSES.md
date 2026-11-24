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
