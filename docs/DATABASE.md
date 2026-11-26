# Database – tabellen en verbanden

> **Dit bestand:** een plaatje van de database, **automatisch gemaakt** uit `db/schema.sql` met
> `tools/schema_plaatje.py` (#100, D84). Niet met de hand wijzigen: `tests/test_schema_plaatje.sh` faalt als het niet bij is.
> Opnieuw maken: `python3 tools/schema_plaatje.py "host=localhost user=postgres"`.
> **Niet hier:** de regels in de database en waarom → `db/schema.sql` en [`DECISIONS.md`](../DECISIONS.md).

Schema `fabriek`: 94 tabellen en 203 verbanden.

## Overzicht

Een lijn loopt van de tabel waarnaar verwezen wordt naar de tabel met de verwijzing, met de kolom erbij. `||` = altijd ingevuld, `|o` = mag leeg zijn, `o{` = nul of meer, `o|` = hoogstens één. De Mermaid-bron hieronder bevat alle foreign keys, inclusief verwijzingen naar `gebruiker`, `operator` en `pc`.

Legenda B+: structuur (blauw), uitvoering en besluiten (oranje), technische ondersteuning (grijs). Alle relaties zijn fysieke FK-verwijzingen, geen procespijlen. Kleur is aanvullend; de tabelnamen en relatiekolommen blijven bepalend.

[Open het fysieke overzicht met alle tabellen](diagrams/rendered/physical-erd.svg). Het overzicht laat de meeste verwijzingen naar gebruikers, operators en werkstations weg voor de leesbaarheid.

### Fysieke domeindiagrammen

De zes diagrammen tonen samen alle foreign keys. Elke relatie staat bij de tabel die de foreign key bevat. Gestippelde lijnen en blokken markeren een verwijzing naar een tabel in een ander domein. Open een SVG op volledig formaat om de labels te lezen.

- [Autorisaties en identiteit](diagrams/rendered/physical-identity.svg)
- [Master Data en Recipe Management](diagrams/rendered/physical-master-data.svg)
- [Productie-uitvoering](diagrams/rendered/physical-execution.svg)
- [Planning en lotvorming](diagrams/rendered/physical-planning.svg)
- [Kwaliteit en metingen](diagrams/rendered/physical-quality.svg)
- [Technische ondersteuning](diagrams/rendered/physical-support.svg)

<details>
<summary>Mermaid-bron met alle foreign keys</summary>

```mermaid
%%{init: {"theme":"base","themeVariables":{"lineColor":"#6B7785","primaryTextColor":"#1B2430","fontFamily":"Arial, sans-serif"}}}%%
erDiagram
    activity_qualification
    authorization_bootstrap
    authorization_channel_identity
    authorization_channel_identity_revocation
    authorization_decision
    authorization_grant
    authorization_legacy_snapshot
    authorization_permission
    authorization_personnel_link
    authorization_recovery
    authorization_request
    authorization_revocation
    authorization_role
    authorization_role_permission
    batch
    batch_besluit
    capaciteit_afwijking
    capaciteit_stap
    certificaat
    config_log
    execution_session
    gebruiker
    geweigerde_invoer
    grondstof
    grondstof_gebruik
    herbewerking
    inlogpoging
    instelling
    invoerconflict
    keuring
    lot
    lot_voorstel
    lot_voorstel_batch
    master_recipe
    master_recipe_version
    material_class
    material_definition
    material_definition_version
    measurement_unit
    melding
    melding_gelezen
    onderhoud_log
    operator
    overdracht
    pc
    pc_stap
    personnel_qualification
    ploeg
    processtap
    product
    product_stap
    qualification
    qualification_issue
    qualification_revocation
    quantity_dimension
    quantity_kind
    recipe_change_impact
    recipe_change_request
    recipe_compatibility_rule
    recipe_dependency
    recipe_equipment_requirement
    recipe_formula
    recipe_instruction
    recipe_lot_rule
    recipe_material_requirement
    recipe_parameter
    recipe_parameter_limit
    recipe_personnel_requirement
    recipe_procedural_element
    recipe_release
    recipe_release_withdrawal
    recipe_review_decision
    recipe_review_round
    recipe_scaling_binding
    recipe_scaling_expression
    recipe_scaling_input
    recipe_scaling_rule
    recipe_specification_link
    rooster
    rooster_ploeg
    schema_versie
    specificatie
    specificatie_regel
    stap_grondstof
    stapplanning
    stapregistratie
    stilstand
    stilstand_oorzaak
    terugmelding
    unit_conversion
    unit_conversion_version
    veld
    veld_product
    waarde
    authorization_channel_identity ||--o| authorization_channel_identity_revocation : "database_role_oid"
    authorization_grant |o--o| authorization_decision : "grant_id"
    authorization_grant ||--o| authorization_revocation : "grant_id"
    authorization_permission ||--o{ activity_qualification : "permission_code"
    authorization_permission ||--o{ authorization_role_permission : "permission_code"
    authorization_request ||--o| authorization_decision : "request_id"
    authorization_role ||--o{ authorization_grant : "role_code"
    authorization_role ||--o{ authorization_request : "role_code"
    authorization_role ||--o{ authorization_role_permission : "role_code"
    batch ||--o{ batch_besluit : "batch_id"
    batch |o--o{ herbewerking : "batch_id"
    batch ||--o{ lot_voorstel_batch : "batch_id"
    batch |o--o{ stapplanning : "batch_id"
    batch |o--o{ stapregistratie : "batch_id"
    gebruiker ||--o{ authorization_bootstrap : "security_user_a"
    gebruiker ||--o{ authorization_bootstrap : "security_user_b"
    gebruiker ||--o{ authorization_bootstrap : "system_user_id"
    gebruiker ||--o{ authorization_channel_identity : "user_id"
    gebruiker ||--o{ authorization_decision : "decided_by"
    gebruiker ||--o{ authorization_grant : "user_id"
    gebruiker ||--o| authorization_legacy_snapshot : "user_id"
    gebruiker ||--o{ authorization_personnel_link : "approved_by"
    gebruiker ||--o{ authorization_personnel_link : "requested_by"
    gebruiker ||--o| authorization_personnel_link : "user_id"
    gebruiker ||--o{ authorization_recovery : "approved_by"
    gebruiker ||--o{ authorization_recovery : "requested_by"
    gebruiker ||--o{ authorization_recovery : "user_id"
    gebruiker ||--o{ authorization_request : "requested_by"
    gebruiker ||--o{ authorization_request : "user_id"
    gebruiker ||--o{ authorization_revocation : "revoked_by"
    gebruiker |o--o{ batch : "gepland_door"
    gebruiker ||--o{ batch_besluit : "besloten_door"
    gebruiker ||--o{ certificaat : "uitgegeven_door"
    gebruiker |o--o{ config_log : "actor_user_id"
    gebruiker ||--o{ execution_session : "user_id"
    gebruiker |o--o{ geweigerde_invoer : "gebruiker_id"
    gebruiker |o--o{ grondstof_gebruik : "gecorrigeerd_door"
    gebruiker |o--o{ herbewerking : "aangemaakt_door"
    gebruiker |o--o{ herbewerking : "ingetrokken_door"
    gebruiker |o--o{ invoerconflict : "opgelost_door"
    gebruiker |o--o{ keuring : "besloten_door"
    gebruiker ||--o{ lot_voorstel : "aangemaakt_door"
    gebruiker ||--o{ master_recipe : "created_by"
    gebruiker ||--o{ master_recipe_version : "created_by"
    gebruiker ||--o{ material_definition_version : "created_by"
    gebruiker ||--o{ melding_gelezen : "gebruiker_id"
    gebruiker |o--o| operator : "gebruiker_id"
    gebruiker ||--o{ overdracht : "gebruiker_id"
    gebruiker ||--o{ personnel_qualification : "user_id"
    gebruiker ||--o{ qualification_issue : "approved_by"
    gebruiker ||--o{ qualification_issue : "requested_by"
    gebruiker ||--o{ qualification_revocation : "revoked_by"
    gebruiker ||--o{ recipe_change_request : "created_by"
    gebruiker ||--o{ recipe_release : "released_by"
    gebruiker ||--o{ recipe_release_withdrawal : "withdrawn_by"
    gebruiker ||--o{ recipe_review_decision : "reviewer_id"
    gebruiker ||--o{ recipe_review_round : "created_by"
    gebruiker |o--o{ specificatie : "aangemaakt_door"
    gebruiker |o--o{ specificatie : "vastgesteld_door"
    gebruiker ||--o{ stapplanning : "aangemaakt_door"
    gebruiker |o--o{ stapregistratie : "nageleverd_door"
    gebruiker ||--o{ stilstand : "gemeld_door"
    gebruiker |o--o{ terugmelding : "afgehandeld_door"
    gebruiker ||--o{ terugmelding : "gebruiker_id"
    gebruiker ||--o{ unit_conversion_version : "created_by"
    gebruiker |o--o{ waarde : "gecorrigeerd_door"
    grondstof ||--o{ grondstof_gebruik : "grondstof_id"
    grondstof |o--o{ invoerconflict : "grondstof_id"
    grondstof |o--o| material_definition : "raw_material_id"
    grondstof ||--o{ stap_grondstof : "grondstof_id"
    grondstof_gebruik |o--o| grondstof_gebruik : "vervangt_id"
    grondstof_gebruik |o--o{ invoerconflict : "bestaand_gebruik_id"
    herbewerking |o--o{ keuring : "herbewerking_id"
    lot |o--o{ batch : "lot_id"
    lot ||--o{ certificaat : "lot_id"
    lot |o--o{ herbewerking : "lot_id"
    lot |o--o{ lot_voorstel : "lot_id"
    lot |o--o{ stapplanning : "lot_id"
    lot |o--o{ stapregistratie : "lot_id"
    lot_voorstel ||--o{ lot_voorstel_batch : "voorstel_id"
    lot_voorstel |o--o{ stapplanning : "voorstel_id"
    master_recipe ||--o{ master_recipe_version : "master_recipe_id"
    master_recipe ||--o{ recipe_release : "master_recipe_id"
    master_recipe_version |o--o{ recipe_change_request : "baseline_version_id"
    master_recipe_version ||--o| recipe_change_request : "recipe_version_id"
    master_recipe_version ||--o{ recipe_compatibility_rule : "other_recipe_version_id"
    master_recipe_version ||--o{ recipe_compatibility_rule : "recipe_version_id"
    master_recipe_version ||--o{ recipe_dependency : "recipe_version_id"
    master_recipe_version ||--o{ recipe_equipment_requirement : "recipe_version_id"
    master_recipe_version ||--o| recipe_formula : "recipe_version_id"
    master_recipe_version ||--o{ recipe_instruction : "recipe_version_id"
    master_recipe_version ||--o| recipe_lot_rule : "recipe_version_id"
    master_recipe_version ||--o{ recipe_parameter : "recipe_version_id"
    master_recipe_version ||--o{ recipe_personnel_requirement : "recipe_version_id"
    master_recipe_version ||--o{ recipe_procedural_element : "recipe_version_id"
    master_recipe_version ||--o| recipe_release : "recipe_version_id"
    master_recipe_version |o--o{ recipe_review_round : "baseline_version_id"
    master_recipe_version ||--o{ recipe_review_round : "recipe_version_id"
    master_recipe_version ||--o{ recipe_scaling_rule : "recipe_version_id"
    master_recipe_version ||--o{ recipe_specification_link : "recipe_version_id"
    material_class |o--o{ material_definition_version : "material_class_id"
    material_definition ||--o{ material_definition_version : "material_definition_id"
    material_definition_version ||--o{ recipe_material_requirement : "material_version_id"
    measurement_unit |o--o{ material_definition_version : "measurement_unit_id"
    measurement_unit |o--o{ recipe_equipment_requirement : "capacity_unit_id"
    measurement_unit |o--o{ recipe_formula : "reference_unit_id"
    measurement_unit |o--o{ recipe_material_requirement : "measurement_unit_id"
    measurement_unit |o--o{ recipe_parameter : "measurement_unit_id"
    measurement_unit ||--o{ recipe_scaling_input : "unit_id"
    measurement_unit ||--o{ recipe_scaling_rule : "output_unit_id"
    measurement_unit ||--o{ unit_conversion : "quantity_kind_id, from_unit_id"
    measurement_unit ||--o{ unit_conversion : "quantity_kind_id, to_unit_id"
    melding ||--o{ melding_gelezen : "melding_id"
    operator ||--o| authorization_personnel_link : "personnel_id"
    operator |o--o{ batch : "aangemaakt_door"
    operator |o--o{ geweigerde_invoer : "operator_id"
    operator |o--o{ grondstof_gebruik : "ingevoerd_door"
    operator ||--o{ invoerconflict : "ingevoerd_door"
    operator |o--o{ overdracht : "operator_id"
    operator |o--o{ stapregistratie : "afgerond_door"
    operator ||--o{ stapregistratie : "operator_id"
    operator |o--o{ stilstand : "beeindigd_door"
    operator |o--o{ stilstand : "operator_id"
    operator |o--o{ terugmelding : "operator_id"
    operator |o--o{ waarde : "ingevoerd_door"
    pc |o--o{ geweigerde_invoer : "pc_id"
    pc |o--o{ invoerconflict : "pc_id"
    pc |o--o{ overdracht : "pc_id"
    pc ||--o{ pc_stap : "pc_id"
    pc |o--o{ stapregistratie : "afgerond_pc_id"
    pc ||--o{ stapregistratie : "pc_id"
    pc |o--o{ stilstand : "pc_id"
    pc |o--o{ terugmelding : "pc_id"
    personnel_qualification ||--o| qualification_issue : "qualification_id"
    personnel_qualification ||--o| qualification_revocation : "qualification_id"
    ploeg ||--o{ overdracht : "ploeg_id"
    processtap |o--o{ capaciteit_afwijking : "processtap_id"
    processtap ||--o{ capaciteit_stap : "processtap_id"
    processtap ||--o{ herbewerking : "processtap_id"
    processtap ||--o{ pc_stap : "processtap_id"
    processtap ||--o{ product_stap : "processtap_id"
    processtap ||--o{ specificatie : "processtap_id"
    processtap ||--o{ stap_grondstof : "processtap_id"
    processtap ||--o{ stapplanning : "processtap_id"
    processtap ||--o{ stapregistratie : "processtap_id"
    processtap ||--o{ stilstand : "processtap_id"
    processtap ||--o{ veld : "processtap_id"
    product |o--o{ authorization_grant : "product_id"
    product |o--o{ authorization_request : "product_id"
    product |o--o{ batch : "product_id"
    product |o--o{ capaciteit_afwijking : "product_id"
    product ||--o{ capaciteit_stap : "product_id"
    product ||--o{ master_recipe : "product_id"
    product |o--o| material_definition : "product_id"
    product ||--o{ product_stap : "product_id"
    product ||--o{ specificatie : "product_id"
    product |o--o{ stapregistratie : "product_id"
    product ||--o{ veld_product : "product_id"
    qualification ||--o{ activity_qualification : "qualification_code"
    qualification ||--o{ personnel_qualification : "qualification_code"
    qualification ||--o{ recipe_personnel_requirement : "qualification_code"
    quantity_dimension ||--o{ quantity_kind : "dimension_id"
    quantity_kind ||--o{ measurement_unit : "quantity_kind_id"
    quantity_kind ||--o{ unit_conversion : "quantity_kind_id"
    quantity_kind ||--o{ unit_conversion_version : "quantity_kind_id, value_semantics"
    recipe_change_request ||--o{ recipe_change_impact : "recipe_version_id, request_id"
    recipe_formula ||--o{ recipe_material_requirement : "recipe_version_id, formula_id"
    recipe_material_requirement |o--o| recipe_scaling_binding : "recipe_version_id, material_requirement_id"
    recipe_parameter ||--o{ recipe_parameter_limit : "recipe_version_id, parameter_id, data_type"
    recipe_parameter |o--o{ recipe_scaling_input : "recipe_version_id, parameter_id"
    recipe_parameter_limit |o--o| recipe_scaling_binding : "recipe_version_id, parameter_limit_id"
    recipe_parameter_limit ||--o| recipe_specification_link : "recipe_version_id, parameter_limit_id"
    recipe_procedural_element ||--o{ recipe_dependency : "recipe_version_id, predecessor_id"
    recipe_procedural_element ||--o{ recipe_dependency : "recipe_version_id, successor_id"
    recipe_procedural_element ||--o{ recipe_equipment_requirement : "recipe_version_id, procedural_element_id"
    recipe_procedural_element ||--o{ recipe_instruction : "recipe_version_id, procedural_element_id"
    recipe_procedural_element |o--o{ recipe_material_requirement : "recipe_version_id, procedural_element_id"
    recipe_procedural_element ||--o{ recipe_parameter : "recipe_version_id, procedural_element_id"
    recipe_procedural_element ||--o{ recipe_personnel_requirement : "recipe_version_id, procedural_element_id"
    recipe_procedural_element |o--o{ recipe_procedural_element : "recipe_version_id, parent_id, parent_kind"
    recipe_release ||--o| recipe_release_withdrawal : "release_id"
    recipe_review_round ||--o{ recipe_release : "recipe_version_id, round_id"
    recipe_review_round ||--o{ recipe_review_decision : "round_id"
    recipe_scaling_rule ||--o{ recipe_scaling_binding : "recipe_version_id, rule_id"
    recipe_scaling_rule ||--o| recipe_scaling_expression : "recipe_version_id, rule_id"
    recipe_scaling_rule ||--o{ recipe_scaling_input : "recipe_version_id, rule_id"
    rooster_ploeg |o--o{ operator : "ploeg_id"
    specificatie ||--o{ specificatie_regel : "specificatie_id"
    specificatie |o--o{ waarde : "specificatie_id"
    stapregistratie ||--o{ grondstof_gebruik : "stapregistratie_id"
    stapregistratie |o--o| herbewerking : "stapregistratie_id"
    stapregistratie ||--o{ invoerconflict : "stapregistratie_id"
    stapregistratie ||--o| keuring : "stapregistratie_id"
    stapregistratie ||--o{ waarde : "stapregistratie_id"
    stilstand_oorzaak ||--o{ stilstand : "oorzaak_id"
    unit_conversion ||--o{ unit_conversion_version : "conversion_id, quantity_kind_id"
    unit_conversion_version |o--o{ recipe_scaling_input : "conversion_version_id"
    veld |o--o{ invoerconflict : "veld_id"
    veld ||--o{ specificatie_regel : "veld_id"
    veld ||--o{ veld_product : "veld_id"
    veld ||--o{ waarde : "veld_id"
    waarde |o--o{ invoerconflict : "bestaand_waarde_id"
    waarde |o--o| waarde : "vervangt_waarde_id"
    classDef structuur fill:#E7EEF6,stroke:#0B2E59,color:#0B2E59
    classDef uitvoering fill:#FDEBD9,stroke:#B45309,color:#1B2430
    classDef ondersteuning fill:#F4F7F9,stroke:#6B7785,color:#1B2430
    class activity_qualification,authorization_permission,authorization_role,authorization_role_permission,capaciteit_stap,gebruiker,grondstof,instelling,master_recipe,master_recipe_version,material_class,material_definition,material_definition_version,measurement_unit,operator,pc,pc_stap,ploeg,processtap,product,product_stap,qualification,quantity_dimension,quantity_kind,recipe_compatibility_rule,recipe_dependency,recipe_equipment_requirement,recipe_formula,recipe_instruction,recipe_lot_rule,recipe_material_requirement,recipe_parameter,recipe_parameter_limit,recipe_personnel_requirement,recipe_procedural_element,recipe_scaling_binding,recipe_scaling_expression,recipe_scaling_input,recipe_scaling_rule,recipe_specification_link,rooster,rooster_ploeg,specificatie,specificatie_regel,stap_grondstof,stilstand_oorzaak,unit_conversion,unit_conversion_version,veld,veld_product structuur
    class authorization_decision,authorization_grant,authorization_personnel_link,authorization_request,authorization_revocation,batch,batch_besluit,capaciteit_afwijking,certificaat,execution_session,geweigerde_invoer,grondstof_gebruik,herbewerking,invoerconflict,keuring,lot,lot_voorstel,lot_voorstel_batch,melding,melding_gelezen,overdracht,personnel_qualification,qualification_issue,qualification_revocation,recipe_change_impact,recipe_change_request,recipe_release,recipe_release_withdrawal,recipe_review_decision,recipe_review_round,stapplanning,stapregistratie,stilstand,terugmelding,waarde uitvoering
    class authorization_bootstrap,authorization_channel_identity,authorization_channel_identity_revocation,authorization_legacy_snapshot,authorization_recovery,config_log,inlogpoging,onderhoud_log,schema_versie ondersteuning
```

</details>

## Tabellen

| Tabel | Kolommen | Verwijst naar | Uitleg (uit `schema.sql`) |
| --- | ---: | --- | --- |
| [`activity_qualification`](#activity_qualification) | 2 | `authorization_permission`, `qualification` | Verplichte kwalificatie voor een concrete activiteit. |
| [`authorization_bootstrap`](#authorization_bootstrap) | 7 | `gebruiker` |  |
| [`authorization_channel_identity`](#authorization_channel_identity) | 6 | `gebruiker` |  |
| [`authorization_channel_identity_revocation`](#authorization_channel_identity_revocation) | 4 | `authorization_channel_identity` |  |
| [`authorization_decision`](#authorization_decision) | 6 | `authorization_grant`, `authorization_request`, `gebruiker` | Een besluit per aanvraag; inhoud blijft in de oorspronkelijke aanvraag. |
| [`authorization_grant`](#authorization_grant) | 9 | `authorization_role`, `gebruiker`, `product` | Persoonlijke roltoekenning met geldigheid en begrensde scope. |
| [`authorization_legacy_snapshot`](#authorization_legacy_snapshot) | 3 | `gebruiker` | Momentopname van de oude rol bij migratie, zonder extra rechten. |
| [`authorization_permission`](#authorization_permission) | 2 |  | Concrete bevoegdheden binnen een domein. |
| [`authorization_personnel_link`](#authorization_personnel_link) | 6 | `gebruiker`, `operator` |  |
| [`authorization_recovery`](#authorization_recovery) | 6 | `gebruiker` |  |
| [`authorization_request`](#authorization_request) | 11 | `authorization_role`, `gebruiker`, `product` | Vastgelegde aanvraag met exacte inhoud en onafhankelijke beoordelaar. |
| [`authorization_revocation`](#authorization_revocation) | 4 | `authorization_grant`, `gebruiker` | Een intrekking bewaart de grant en de identiteit en motivatie van de beslisser. |
| [`authorization_role`](#authorization_role) | 2 |  | MES-rollen met gescheiden verantwoordelijkheidsdomeinen. |
| [`authorization_role_permission`](#authorization_role_permission) | 2 | `authorization_permission`, `authorization_role` | Koppeling tussen rollen en concrete bevoegdheden. |
| [`batch`](#batch) | 14 | `gebruiker`, `lot`, `operator`, `product` |  |
| [`batch_besluit`](#batch_besluit) | 6 | `batch`, `gebruiker` | Besluiten over een batch: in_beoordeling – ploegleider of kwaliteit; de batch kan dan niet verder vrijgegeven – keurresultaat OK, alleen kwaliteit; door… |
| [`capaciteit_afwijking`](#capaciteit_afwijking) | 8 | `processtap`, `product` | Afwijkende capaciteit (sinds 0.48.0, D69): in een periode kan een stap en/of product minder aan. |
| [`capaciteit_stap`](#capaciteit_stap) | 5 | `processtap`, `product` | Capaciteit per stap en product (sinds migratie 0020, D55): hoeveel items een stap per dag aankan. |
| [`certificaat`](#certificaat) | 6 | `gebruiker`, `lot` |  |
| [`config_log`](#config_log) | 10 | `gebruiker` | Wijzigingslogboek voor configuratie. |
| [`execution_session`](#execution_session) | 5 | `gebruiker` |  |
| [`gebruiker`](#gebruiker) | 8 |  | Persoonlijke accounts (ploegleider, beheerder, analist, planner) en het ene gedeelde operator-account. |
| [`geweigerde_invoer`](#geweigerde_invoer) | 10 | `gebruiker`, `operator`, `pc` | Geweigerde invoer van een pc (#77, D66): de server legt vast wat hij weigerde, zodat het pilotoverzicht kan laten zien wat er misging. |
| [`grondstof`](#grondstof) | 5 |  | Grondstoffen per batch (sinds migratie 0005, versie 0.11.0) Grondstoffen (configuratie, door de beheerder beheerd). |
| [`grondstof_gebruik`](#grondstof_gebruik) | 11 | `gebruiker`, `grondstof`, `operator`, `stapregistratie` | Gebruik: per registratie en grondstof één oorspronkelijke regel; correcties vervangen hem (zoals bij waarden). |
| [`herbewerking`](#herbewerking) | 12 | `batch`, `gebruiker`, `lot`, `processtap`, `stapregistratie` | Herbewerkingen (sinds migratie 0021, #61): Kwaliteit of de productiemanager besluit dat een batch of lot terug moet naar een eerdere stap. |
| [`inlogpoging`](#inlogpoging) | 5 |  |  |
| [`instelling`](#instelling) | 3 |  | Certificaat per lot (sinds migratie 0010, versie 0.17.0) |
| [`invoerconflict`](#invoerconflict) | 19 | `gebruiker`, `grondstof`, `grondstof_gebruik`, `operator`, `pc`, `stapregistratie`, `veld`, `waarde` | Conflicten bij gelijktijdige invoer (sinds 0032, #85, D75): vullen twee mensen hetzelfde veld of dezelfde grondstof van een stap in, dan blijft de eerste… |
| [`keuring`](#keuring) | 8 | `gebruiker`, `herbewerking`, `stapregistratie` | Keuring door Kwaliteit (sinds migratie 0022, #64): een stap met velden die Kwaliteit meet. |
| [`lot`](#lot) | 4 |  |  |
| [`lot_voorstel`](#lot_voorstel) | 9 | `gebruiker`, `lot` |  |
| [`lot_voorstel_batch`](#lot_voorstel_batch) | 2 | `batch`, `lot_voorstel` |  |
| [`master_recipe`](#master_recipe) | 5 | `gebruiker`, `product` | Eén product kan meerdere stabiele receptidentiteiten hebben. |
| [`master_recipe_version`](#master_recipe_version) | 9 | `gebruiker`, `master_recipe` | Conceptversie; inhoud en gecontroleerde statusovergangen volgen in fase 2. |
| [`material_class`](#material_class) | 3 |  | Stabiele materiaalclassificatie; geen automatisch afgeleide classificaties. |
| [`material_definition`](#material_definition) | 4 | `grondstof`, `product` | Materiaalidentiteit met expliciete koppelingen naar behouden PoC-identiteiten. |
| [`material_definition_version`](#material_definition_version) | 9 | `gebruiker`, `material_class`, `material_definition`, `measurement_unit` | Onveranderlijke materiaalversie; ontbrekende classificatie of eenheid blijft onbekend. |
| [`measurement_unit`](#measurement_unit) | 5 | `quantity_kind` |  |
| [`melding`](#melding) | 10 |  | Meldingen (sinds migratie 0007, versie 0.13.0) |
| [`melding_gelezen`](#melding_gelezen) | 3 | `gebruiker`, `melding` |  |
| [`onderhoud_log`](#onderhoud_log) | 9 |  |  |
| [`operator`](#operator) | 5 | `gebruiker`, `rooster_ploeg` | Namenlijst waaruit operators na het inloggen kiezen. |
| [`overdracht`](#overdracht) | 10 | `gebruiker`, `operator`, `pc`, `ploeg` |  |
| [`pc`](#pc) | 4 |  |  |
| [`pc_stap`](#pc_stap) | 2 | `pc`, `processtap` | Optioneel: welke stappen in de keuzelijst van een pc staan. |
| [`personnel_qualification`](#personnel_qualification) | 6 | `gebruiker`, `qualification` | Persoonlijke kwalificatie met geldigheid en intrekking. |
| [`ploeg`](#ploeg) | 6 |  | Ploegoverdracht (sinds migratie 0006, versie 0.12.0) |
| [`processtap`](#processtap) | 8 |  |  |
| [`product`](#product) | 5 |  | Producten (configuratie, door de planner beheerd; sinds migratie 0003) |
| [`product_stap`](#product_stap) | 3 | `processtap`, `product` | Route per product (sinds migratie 0018, D55): welke stappen een product doorloopt, in welke volgorde. |
| [`qualification`](#qualification) | 2 |  | Definitie van een personeelskwalificatie. |
| [`qualification_issue`](#qualification_issue) | 5 | `gebruiker`, `personnel_qualification` |  |
| [`qualification_revocation`](#qualification_revocation) | 4 | `gebruiker`, `personnel_qualification` |  |
| [`quantity_dimension`](#quantity_dimension) | 8 |  | SI-basisdimensies: lengte, massa, tijd, stroom, temperatuur, hoeveelheid stof en lichtsterkte. |
| [`quantity_kind`](#quantity_kind) | 5 | `quantity_dimension` |  |
| [`recipe_change_impact`](#recipe_change_impact) | 5 | `recipe_change_request` |  |
| [`recipe_change_request`](#recipe_change_request) | 8 | `gebruiker`, `master_recipe_version` | Eén wijzigingsdossier per versie. |
| [`recipe_compatibility_rule`](#recipe_compatibility_rule) | 4 | `master_recipe_version` | Incompatibiliteit is een verbod vanuit één exacte MBR-revisie naar een andere. |
| [`recipe_dependency`](#recipe_dependency) | 4 | `master_recipe_version`, `recipe_procedural_element` | Expliciete voorganger/opvolger; voorlopig alleen binnen dezelfde siblinggroep. |
| [`recipe_equipment_requirement`](#recipe_equipment_requirement) | 9 | `master_recipe_version`, `measurement_unit`, `recipe_procedural_element` | Voorlopig expliciete equipmentklasse-eis; definitieve resourcecatalogus en fysieke toewijzing volgen fase 4. |
| [`recipe_formula`](#recipe_formula) | 5 | `master_recipe_version`, `measurement_unit` |  |
| [`recipe_instruction`](#recipe_instruction) | 7 | `master_recipe_version`, `recipe_procedural_element` |  |
| [`recipe_lot_rule`](#recipe_lot_rule) | 5 | `master_recipe_version` | Geen standaard vier batches. |
| [`recipe_material_requirement`](#recipe_material_requirement) | 11 | `material_definition_version`, `measurement_unit`, `recipe_formula`, `recipe_procedural_element` |  |
| [`recipe_parameter`](#recipe_parameter) | 12 | `master_recipe_version`, `measurement_unit`, `recipe_procedural_element` |  |
| [`recipe_parameter_limit`](#recipe_parameter_limit) | 9 | `recipe_parameter` | Doelwaarde is een afzonderlijk getal, niet een impliciete onder-/bovengrens. |
| [`recipe_personnel_requirement`](#recipe_personnel_requirement) | 7 | `master_recipe_version`, `qualification`, `recipe_procedural_element` | Een kwalificatie-eis is geen toekenning van een kwalificatie of permission. |
| [`recipe_procedural_element`](#recipe_procedural_element) | 9 | `master_recipe_version` | Een concept mag nog onvolledig zijn; volledigheid is een latere vrijgave-eis. |
| [`recipe_release`](#recipe_release) | 8 | `gebruiker`, `master_recipe`, `master_recipe_version`, `recipe_review_round` | Formele vrijgave en ingangsdatum zijn afzonderlijke feiten. |
| [`recipe_release_withdrawal`](#recipe_release_withdrawal) | 5 | `gebruiker`, `recipe_release` |  |
| [`recipe_review_decision`](#recipe_review_decision) | 7 | `gebruiker`, `recipe_review_round` | Een besluit kan later uitsluitend aan een exacte ronde worden gekoppeld. |
| [`recipe_review_round`](#recipe_review_round) | 12 | `gebruiker`, `master_recipe_version` | Ronde is historisch bewijs; nog geen statusovergang of beslisfunctie. |
| [`recipe_scaling_binding`](#recipe_scaling_binding) | 5 | `recipe_material_requirement`, `recipe_parameter_limit`, `recipe_scaling_rule` | Voorbereide uitgaande koppeling. |
| [`recipe_scaling_expression`](#recipe_scaling_expression) | 5 | `recipe_scaling_rule` | Postfix-notatie (RPN), grammatica v1. |
| [`recipe_scaling_input`](#recipe_scaling_input) | 10 | `measurement_unit`, `recipe_parameter`, `recipe_scaling_rule`, `unit_conversion_version` | Getypeerde invoerbronnen. |
| [`recipe_scaling_rule`](#recipe_scaling_rule) | 8 | `master_recipe_version`, `measurement_unit` | Een regel is een conceptdefinitie binnen één MBR-revisie. |
| [`recipe_specification_link`](#recipe_specification_link) | 5 | `master_recipe_version`, `recipe_parameter_limit` | Kwaliteitseis verwijst naar de exacte versiegebonden specificatiegrens binnen het MBR, niet naar een dynamische 'laatste' PoC-specificatie. |
| [`rooster`](#rooster) | 3 |  | Ploegen en rooster (sinds 0033, #86, D76). |
| [`rooster_ploeg`](#rooster_ploeg) | 6 |  |  |
| [`schema_versie`](#schema_versie) | 3 |  |  |
| [`specificatie`](#specificatie) | 10 | `gebruiker`, `processtap`, `product` | Specificatie per product en keuringsstap (sinds 0.51.0, #80, D73): waar het product in een tussenkeuring (TK) of de eindkeuring (EK) aan moet voldoen, met… |
| [`specificatie_regel`](#specificatie_regel) | 5 | `specificatie`, `veld` | Per veld van de keuringsstap het minimum en/of maximum. |
| [`stap_grondstof`](#stap_grondstof) | 5 | `grondstof`, `processtap` | In welke stap welke grondstof wordt ingevoerd, en of dat verplicht is. |
| [`stapplanning`](#stapplanning) | 10 | `batch`, `gebruiker`, `lot`, `lot_voorstel`, `processtap` |  |
| [`stapregistratie`](#stapregistratie) | 20 | `batch`, `gebruiker`, `lot`, `operator`, `pc`, `processtap`, `product` |  |
| [`stilstand`](#stilstand) | 11 | `gebruiker`, `operator`, `pc`, `processtap`, `stilstand_oorzaak` |  |
| [`stilstand_oorzaak`](#stilstand_oorzaak) | 5 |  | Storingen en stilstand (sinds migratie 0008, versie 0.14.0) |
| [`terugmelding`](#terugmelding) | 12 | `gebruiker`, `operator`, `pc` | "Iets melden" (sinds migratie 0026, #78, D62): gebruikers typen kort wat misgaat of beter kan. |
| [`unit_conversion`](#unit_conversion) | 4 | `measurement_unit`, `quantity_kind` |  |
| [`unit_conversion_version`](#unit_conversion_version) | 11 | `gebruiker`, `quantity_kind`, `unit_conversion` |  |
| [`veld`](#veld) | 16 | `processtap` |  |
| [`veld_product`](#veld_product) | 6 | `product`, `veld` | Grenzen en tolerantie per product (sinds migratie 0019, D55). |
| [`waarde`](#waarde) | 17 | `gebruiker`, `operator`, `specificatie`, `stapregistratie`, `veld` |  |

## Kolommen per tabel

PK = sleutel, FK = verwijst naar een andere tabel, UK = uniek. Zonder "leeg" is de kolom altijd ingevuld.

### activity_qualification

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `permission_code` | text | PK FK | `authorization_permission` |
| `qualification_code` | text | PK FK | `qualification` |

### authorization_bootstrap

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `singleton` | bool | PK |  |
| `system_user_id` | uuid | FK | `gebruiker` |
| `security_user_a` | uuid | FK | `gebruiker` |
| `security_user_b` | uuid | FK | `gebruiker` |
| `created_at` | timestamptz |  |  |
| `database_actor` | text |  |  |
| `reason` | text |  |  |

### authorization_channel_identity

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `database_role_oid` | oid | PK |  |
| `database_role_name` | name | UK |  |
| `user_id` | uuid | FK | `gebruiker` |
| `registered_at` | timestamptz |  |  |
| `registered_by` | name |  |  |
| `reason` | text |  |  |

### authorization_channel_identity_revocation

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `database_role_oid` | oid | PK FK | `authorization_channel_identity` |
| `revoked_at` | timestamptz |  |  |
| `revoked_by` | name |  |  |
| `reason` | text |  |  |

### authorization_decision

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `request_id` | uuid | PK FK | `authorization_request` |
| `decided_by` | uuid | FK | `gebruiker` |
| `approved` | bool |  |  |
| `reason` | text |  |  |
| `decided_at` | timestamptz |  |  |
| `grant_id` | uuid | FK UK leeg | `authorization_grant` |

### authorization_grant

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `user_id` | uuid | FK | `gebruiker` |
| `role_code` | text | FK | `authorization_role` |
| `area_code` | text | leeg |  |
| `product_id` | uuid | FK leeg | `product` |
| `equipment_code` | text | leeg |  |
| `valid_from` | timestamptz |  |  |
| `valid_until` | timestamptz | leeg |  |
| `revoked_at` | timestamptz | leeg |  |

### authorization_legacy_snapshot

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `user_id` | uuid | PK FK | `gebruiker` |
| `legacy_role` | text |  |  |
| `captured_at` | timestamptz |  |  |

### authorization_permission

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `code` | text | PK |  |
| `domain` | text |  |  |

### authorization_personnel_link

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `personnel_id` | uuid | PK FK | `operator` |
| `user_id` | uuid | FK UK | `gebruiker` |
| `requested_by` | uuid | FK | `gebruiker` |
| `approved_by` | uuid | FK | `gebruiker` |
| `reason` | text |  |  |
| `linked_at` | timestamptz |  |  |

### authorization_recovery

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `user_id` | uuid | FK | `gebruiker` |
| `requested_by` | uuid | FK | `gebruiker` |
| `approved_by` | uuid | FK | `gebruiker` |
| `reason` | text |  |  |
| `recovered_at` | timestamptz |  |  |

### authorization_request

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `requested_by` | uuid | FK | `gebruiker` |
| `user_id` | uuid | FK | `gebruiker` |
| `role_code` | text | FK | `authorization_role` |
| `area_code` | text | leeg |  |
| `product_id` | uuid | FK leeg | `product` |
| `equipment_code` | text | leeg |  |
| `valid_from` | timestamptz |  |  |
| `valid_until` | timestamptz | leeg |  |
| `reason` | text |  |  |
| `requested_at` | timestamptz |  |  |

### authorization_revocation

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `grant_id` | uuid | PK FK | `authorization_grant` |
| `revoked_by` | uuid | FK | `gebruiker` |
| `reason` | text |  |  |
| `revoked_at` | timestamptz |  |  |

### authorization_role

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `code` | text | PK |  |
| `domain` | text |  |  |

### authorization_role_permission

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `role_code` | text | PK FK | `authorization_role` |
| `permission_code` | text | PK FK | `authorization_permission` |

### batch

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `batchnummer` | text | UK |  |
| `bron` | text |  |  |
| `status` | text |  |  |
| `lot_id` | uuid | FK leeg | `lot` |
| `aangemaakt_op` | timestamptz |  |  |
| `aangemaakt_door` | uuid | FK leeg | `operator` |
| `geplande_dag` | date | leeg |  |
| `volgorde` | int | leeg |  |
| `product_id` | uuid | FK leeg | `product` |
| `opmerking` | text | leeg |  |
| `gepland_door` | uuid | FK leeg | `gebruiker` |
| `gestart_op` | timestamptz | leeg |  |
| `vervallen_reden` | text | leeg |  |

### batch_besluit

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `batch_id` | uuid | FK | `batch` |
| `besluit` | text |  |  |
| `reden` | text |  |  |
| `besloten_door` | uuid | FK | `gebruiker` |
| `besloten_op` | timestamptz |  |  |

### capaciteit_afwijking

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `van` | date |  |  |
| `tot` | date |  |  |
| `processtap_id` | uuid | FK leeg | `processtap` |
| `product_id` | uuid | FK leeg | `product` |
| `procent` | int |  |  |
| `reden` | text |  |  |
| `actief` | bool |  |  |

### capaciteit_stap

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `processtap_id` | uuid | FK | `processtap` |
| `product_id` | uuid | FK | `product` |
| `max_per_dag` | int | leeg |  |
| `kg_per_dag` | numeric | leeg |  |

### certificaat

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `nummer` | int | UK |  |
| `lot_id` | uuid | FK | `lot` |
| `inhoud` | jsonb |  |  |
| `uitgegeven_door` | uuid | FK | `gebruiker` |
| `uitgegeven_op` | timestamptz |  |  |

### config_log

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | bigint | PK |  |
| `tabel` | text |  |  |
| `record_id` | uuid |  |  |
| `actie` | text |  |  |
| `oud` | jsonb | leeg |  |
| `nieuw` | jsonb | leeg |  |
| `gewijzigd_door` | text |  |  |
| `gewijzigd_op` | timestamptz |  |  |
| `actor_user_id` | uuid | FK leeg | `gebruiker` |
| `actor_origin` | text |  |  |

### execution_session

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `proof_hash` | bytea | PK |  |
| `user_id` | uuid | FK | `gebruiker` |
| `session_version` | bigint |  |  |
| `issued_at` | timestamptz |  |  |
| `expires_at` | timestamptz |  |  |

### gebruiker

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `gebruikersnaam` | text | UK |  |
| `rol` | text |  |  |
| `wachtwoord_hash` | text | leeg |  |
| `actief` | bool |  |  |
| `gedeeld` | bool |  |  |
| `wachtwoord_wijzigen` | bool |  |  |
| `session_version` | bigint |  |  |

### geweigerde_invoer

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | bigint | PK |  |
| `op` | timestamptz |  |  |
| `pc_id` | uuid | FK leeg | `pc` |
| `gebruiker_id` | uuid | FK leeg | `gebruiker` |
| `operator_id` | uuid | FK leeg | `operator` |
| `pad` | text |  |  |
| `status` | int |  |  |
| `fout` | text | leeg |  |
| `stapcode` | text | leeg |  |
| `batchnummer` | text | leeg |  |

### grondstof

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `code` | text | UK |  |
| `naam` | text |  |  |
| `eenheid` | text | leeg |  |
| `actief` | bool |  |  |

### grondstof_gebruik

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `stapregistratie_id` | uuid | FK | `stapregistratie` |
| `grondstof_id` | uuid | FK | `grondstof` |
| `partij` | text |  |  |
| `hoeveelheid` | numeric | leeg |  |
| `vervangt_id` | uuid | FK UK leeg | `grondstof_gebruik` |
| `correctie_reden` | text | leeg |  |
| `ingevoerd_door` | uuid | FK leeg | `operator` |
| `gecorrigeerd_door` | uuid | FK leeg | `gebruiker` |
| `ingevoerd_op` | timestamptz |  |  |
| `ontvangen_op` | timestamptz | leeg |  |

### herbewerking

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `batch_id` | uuid | FK leeg | `batch` |
| `lot_id` | uuid | FK leeg | `lot` |
| `processtap_id` | uuid | FK | `processtap` |
| `reden` | text |  |  |
| `status` | text |  |  |
| `aangemaakt_door` | uuid | FK leeg | `gebruiker` |
| `aangemaakt_op` | timestamptz |  |  |
| `stapregistratie_id` | uuid | FK UK leeg | `stapregistratie` |
| `ingetrokken_door` | uuid | FK leeg | `gebruiker` |
| `ingetrokken_op` | timestamptz | leeg |  |
| `ingetrokken_reden` | text | leeg |  |

### inlogpoging

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `gebruikersnaam` | text |  |  |
| `pc` | text | leeg |  |
| `uitkomst` | text |  |  |
| `op` | timestamptz |  |  |

### instelling

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `sleutel` | text | UK |  |
| `waarde` | text |  |  |

### invoerconflict

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `invoer_id` | uuid | UK leeg |  |
| `stapregistratie_id` | uuid | FK | `stapregistratie` |
| `veld_id` | uuid | FK leeg | `veld` |
| `grondstof_id` | uuid | FK leeg | `grondstof` |
| `bestaand_waarde_id` | uuid | FK leeg | `waarde` |
| `bestaand_gebruik_id` | uuid | FK leeg | `grondstof_gebruik` |
| `setting` | numeric | leeg |  |
| `gemeten` | numeric | leeg |  |
| `partij` | text | leeg |  |
| `hoeveelheid` | numeric | leeg |  |
| `ingevoerd_door` | uuid | FK | `operator` |
| `pc_id` | uuid | FK leeg | `pc` |
| `ingevoerd_op` | timestamptz |  |  |
| `ontvangen_op` | timestamptz |  |  |
| `status` | text |  |  |
| `opgelost_door` | uuid | FK leeg | `gebruiker` |
| `opgelost_op` | timestamptz | leeg |  |
| `reden` | text | leeg |  |

### keuring

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `stapregistratie_id` | uuid | FK UK | `stapregistratie` |
| `status` | text |  |  |
| `aangemaakt_op` | timestamptz |  |  |
| `besloten_door` | uuid | FK leeg | `gebruiker` |
| `besloten_op` | timestamptz | leeg |  |
| `reden` | text | leeg |  |
| `herbewerking_id` | uuid | FK leeg | `herbewerking` |

### lot

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `lotnummer` | text | UK |  |
| `status` | text |  |  |
| `aangemaakt_op` | timestamptz |  |  |

### lot_voorstel

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `nummer` | int | UK |  |
| `status` | text |  |  |
| `opmerking` | text | leeg |  |
| `aangemaakt_door` | uuid | FK | `gebruiker` |
| `aangemaakt_op` | timestamptz |  |  |
| `lot_id` | uuid | FK leeg | `lot` |
| `afwijking_reden` | text | leeg |  |
| `afgesloten_op` | timestamptz | leeg |  |

### lot_voorstel_batch

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `voorstel_id` | uuid | PK FK | `lot_voorstel` |
| `batch_id` | uuid | PK FK | `batch` |

### master_recipe

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `product_id` | uuid | FK | `product` |
| `code` | text |  |  |
| `created_at` | timestamptz |  |  |
| `created_by` | uuid | FK | `gebruiker` |

### master_recipe_version

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `master_recipe_id` | uuid | FK | `master_recipe` |
| `revision` | int |  |  |
| `name` | text |  |  |
| `description` | text |  |  |
| `created_at` | timestamptz |  |  |
| `created_by` | uuid | FK | `gebruiker` |
| `change_no` | int |  |  |
| `lifecycle_status` | text |  |  |

### material_class

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `code` | text | UK |  |
| `name` | text |  |  |

### material_definition

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `code` | text | UK |  |
| `product_id` | uuid | FK UK leeg | `product` |
| `raw_material_id` | uuid | FK UK leeg | `grondstof` |

### material_definition_version

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `material_definition_id` | uuid | FK | `material_definition` |
| `revision` | int |  |  |
| `name` | text |  |  |
| `material_class_id` | uuid | FK leeg | `material_class` |
| `unit` | text | leeg |  |
| `created_at` | timestamptz |  |  |
| `created_by` | uuid | FK | `gebruiker` |
| `measurement_unit_id` | uuid | FK leeg | `measurement_unit` |

### measurement_unit

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `quantity_kind_id` | uuid | FK | `quantity_kind` |
| `code` | text | UK |  |
| `symbol` | text |  |  |
| `name` | text |  |  |

### melding

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `soort` | text |  |  |
| `ernst` | text |  |  |
| `tekst` | text |  |  |
| `batchnummer` | text | leeg |  |
| `lotnummer` | text | leeg |  |
| `hal` | text | leeg |  |
| `voor_rollen` | text[] |  |  |
| `bron_id` | uuid | leeg |  |
| `aangemaakt_op` | timestamptz |  |  |

### melding_gelezen

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `melding_id` | uuid | PK FK | `melding` |
| `gebruiker_id` | uuid | PK FK | `gebruiker` |
| `gelezen_op` | timestamptz |  |  |

### onderhoud_log

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | bigint | PK |  |
| `soort` | text |  |  |
| `gestart_op` | timestamptz |  |  |
| `klaar_op` | timestamptz |  |  |
| `gelukt` | bool |  |  |
| `bestand` | text | leeg |  |
| `grootte_bytes` | bigint | leeg |  |
| `versie` | text | leeg |  |
| `melding` | text | leeg |  |

### operator

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `naam` | text | UK |  |
| `actief` | bool |  |  |
| `gebruiker_id` | uuid | FK UK leeg | `gebruiker` |
| `ploeg_id` | uuid | FK leeg | `rooster_ploeg` |

### overdracht

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `dag` | date |  |  |
| `ploeg_id` | uuid | FK | `ploeg` |
| `hal` | text | leeg |  |
| `bijzonderheden` | text | leeg |  |
| `aandachtspunten` | text | leeg |  |
| `gebruiker_id` | uuid | FK | `gebruiker` |
| `operator_id` | uuid | FK leeg | `operator` |
| `pc_id` | uuid | FK leeg | `pc` |
| `geschreven_op` | timestamptz |  |  |

### pc

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `naam` | text | UK |  |
| `locatie` | text | leeg |  |
| `actief` | bool |  |  |

### pc_stap

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `pc_id` | uuid | PK FK | `pc` |
| `processtap_id` | uuid | PK FK | `processtap` |

### personnel_qualification

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `user_id` | uuid | FK | `gebruiker` |
| `qualification_code` | text | FK | `qualification` |
| `valid_from` | timestamptz |  |  |
| `valid_until` | timestamptz | leeg |  |
| `revoked_at` | timestamptz | leeg |  |

### ploeg

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `code` | text | UK |  |
| `naam` | text |  |  |
| `begint` | time |  |  |
| `eindigt` | time |  |  |
| `actief` | bool |  |  |

### processtap

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `code` | text | UK |  |
| `naam` | text |  |  |
| `volgorde` | int | UK |  |
| `niveau` | text |  |  |
| `is_lot_stap` | bool |  |  |
| `actief` | bool |  |  |
| `soort` | text |  |  |

### product

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `code` | text | UK |  |
| `naam` | text |  |  |
| `actief` | bool |  |  |
| `batchgewicht_kg` | numeric | leeg |  |

### product_stap

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `product_id` | uuid | PK FK | `product` |
| `processtap_id` | uuid | PK FK | `processtap` |
| `plek` | int |  |  |

### qualification

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `code` | text | PK |  |
| `description` | text |  |  |

### qualification_issue

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `qualification_id` | uuid | PK FK | `personnel_qualification` |
| `requested_by` | uuid | FK | `gebruiker` |
| `approved_by` | uuid | FK | `gebruiker` |
| `evidence` | text |  |  |
| `issued_at` | timestamptz |  |  |

### qualification_revocation

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `qualification_id` | uuid | PK FK | `personnel_qualification` |
| `revoked_by` | uuid | FK | `gebruiker` |
| `reason` | text |  |  |
| `revoked_at` | timestamptz |  |  |

### quantity_dimension

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `length_exp` | smallint |  |  |
| `mass_exp` | smallint |  |  |
| `time_exp` | smallint |  |  |
| `current_exp` | smallint |  |  |
| `temperature_exp` | smallint |  |  |
| `amount_exp` | smallint |  |  |
| `luminous_exp` | smallint |  |  |

### quantity_kind

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `dimension_id` | uuid | FK | `quantity_dimension` |
| `code` | text | UK |  |
| `name` | text |  |  |
| `value_semantics` | text |  |  |

### recipe_change_impact

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `recipe_version_id` | uuid | FK | `recipe_change_request` |
| `request_id` | uuid | FK | `recipe_change_request` |
| `area` | text |  |  |
| `explanation` | text |  |  |

### recipe_change_request

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `recipe_version_id` | uuid | FK UK | `master_recipe_version` |
| `baseline_version_id` | uuid | FK leeg | `master_recipe_version` |
| `change_kind` | text |  |  |
| `reason` | text |  |  |
| `impact_description` | text |  |  |
| `created_by` | uuid | FK | `gebruiker` |
| `created_at` | timestamptz |  |  |

### recipe_compatibility_rule

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `recipe_version_id` | uuid | FK | `master_recipe_version` |
| `other_recipe_version_id` | uuid | FK | `master_recipe_version` |
| `reason` | text |  |  |

### recipe_dependency

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `recipe_version_id` | uuid | FK | `recipe_procedural_element` |
| `predecessor_id` | uuid | FK | `recipe_procedural_element` |
| `successor_id` | uuid | FK | `recipe_procedural_element` |

### recipe_equipment_requirement

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `recipe_version_id` | uuid | FK | `recipe_procedural_element` |
| `procedural_element_id` | uuid | FK | `recipe_procedural_element` |
| `code` | text |  |  |
| `equipment_class_code` | text |  |  |
| `description` | text |  |  |
| `required_count` | int |  |  |
| `minimum_capacity` | numeric | leeg |  |
| `capacity_unit_id` | uuid | FK leeg | `measurement_unit` |

### recipe_formula

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `recipe_version_id` | uuid | FK UK | `master_recipe_version` |
| `reference_quantity` | numeric |  |  |
| `reference_unit` | text |  |  |
| `reference_unit_id` | uuid | FK leeg | `measurement_unit` |

### recipe_instruction

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `recipe_version_id` | uuid | FK | `recipe_procedural_element` |
| `procedural_element_id` | uuid | FK | `recipe_procedural_element` |
| `code` | text |  |  |
| `position` | int |  |  |
| `instruction_text` | text |  |  |
| `confirmation_required` | bool |  |  |

### recipe_lot_rule

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `recipe_version_id` | uuid | FK UK | `master_recipe_version` |
| `nominal_batch_count` | int |  |  |
| `deviation_approval_required` | bool |  |  |
| `deviation_reason_required` | bool |  |  |

### recipe_material_requirement

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `recipe_version_id` | uuid | FK | `recipe_procedural_element` |
| `formula_id` | uuid | FK | `recipe_formula` |
| `procedural_element_id` | uuid | FK leeg | `recipe_procedural_element` |
| `material_version_id` | uuid | FK | `material_definition_version` |
| `code` | text |  |  |
| `direction` | text |  |  |
| `quantity` | numeric |  |  |
| `unit` | text |  |  |
| `scaling` | text |  |  |
| `measurement_unit_id` | uuid | FK leeg | `measurement_unit` |

### recipe_parameter

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `recipe_version_id` | uuid | FK | `recipe_procedural_element` |
| `procedural_element_id` | uuid | FK | `recipe_procedural_element` |
| `code` | text |  |  |
| `name` | text |  |  |
| `data_type` | text |  |  |
| `unit` | text | leeg |  |
| `frequency` | text |  |  |
| `required` | bool |  |  |
| `responsible_activity` | text |  |  |
| `critical` | bool |  |  |
| `measurement_unit_id` | uuid | FK leeg | `measurement_unit` |

### recipe_parameter_limit

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `recipe_version_id` | uuid | FK | `recipe_parameter` |
| `parameter_id` | uuid | FK | `recipe_parameter` |
| `data_type` | text | FK | `recipe_parameter` |
| `category` | text |  |  |
| `target_value` | numeric | leeg |  |
| `lower_value` | numeric | leeg |  |
| `upper_value` | numeric | leeg |  |
| `scaling` | text |  |  |

### recipe_personnel_requirement

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `recipe_version_id` | uuid | FK | `recipe_procedural_element` |
| `procedural_element_id` | uuid | FK | `recipe_procedural_element` |
| `code` | text |  |  |
| `qualification_code` | text | FK | `qualification` |
| `qualification_description` | text |  |  |
| `required_count` | int |  |  |

### recipe_procedural_element

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `recipe_version_id` | uuid | FK | `recipe_procedural_element` |
| `parent_id` | uuid | FK leeg | `recipe_procedural_element` |
| `parent_kind` | text | FK leeg | `recipe_procedural_element` |
| `kind` | text |  |  |
| `code` | text |  |  |
| `name` | text |  |  |
| `position` | int |  |  |
| `required` | bool |  |  |

### recipe_release

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `master_recipe_id` | uuid | FK | `master_recipe` |
| `recipe_version_id` | uuid | FK UK | `recipe_review_round` |
| `round_id` | uuid | FK UK | `recipe_review_round` |
| `effective_from` | timestamptz |  |  |
| `released_at` | timestamptz |  |  |
| `released_by` | uuid | FK | `gebruiker` |
| `reason` | text |  |  |

### recipe_release_withdrawal

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `release_id` | uuid | FK UK | `recipe_release` |
| `withdrawn_at` | timestamptz |  |  |
| `withdrawn_by` | uuid | FK | `gebruiker` |
| `reason` | text |  |  |

### recipe_review_decision

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `round_id` | uuid | FK | `recipe_review_round` |
| `domain` | text |  |  |
| `decision` | text |  |  |
| `reason` | text |  |  |
| `reviewer_id` | uuid | FK | `gebruiker` |
| `decided_at` | timestamptz |  |  |

### recipe_review_round

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `recipe_version_id` | uuid | FK | `master_recipe_version` |
| `round_no` | int |  |  |
| `change_no` | int |  |  |
| `baseline_version_id` | uuid | FK leeg | `master_recipe_version` |
| `baseline_change_no` | int | leeg |  |
| `matrix_version` | int |  |  |
| `snapshot` | jsonb |  |  |
| `required_reviews` | text[] |  |  |
| `contributors` | uuid[] |  |  |
| `created_by` | uuid | FK | `gebruiker` |
| `created_at` | timestamptz |  |  |

### recipe_scaling_binding

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `recipe_version_id` | uuid | FK | `recipe_scaling_rule` |
| `rule_id` | uuid | FK | `recipe_scaling_rule` |
| `parameter_limit_id` | uuid | FK leeg | `recipe_parameter_limit` |
| `material_requirement_id` | uuid | FK leeg | `recipe_material_requirement` |

### recipe_scaling_expression

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `recipe_version_id` | uuid | FK | `recipe_scaling_rule` |
| `rule_id` | uuid | FK | `recipe_scaling_rule` |
| `grammar_version` | int |  |  |
| `tokens` | jsonb |  |  |

### recipe_scaling_input

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `recipe_version_id` | uuid | FK | `recipe_scaling_rule` |
| `rule_id` | uuid | FK | `recipe_scaling_rule` |
| `code` | text |  |  |
| `source_kind` | text |  |  |
| `parameter_id` | uuid | FK leeg | `recipe_parameter` |
| `equipment_property` | text | leeg |  |
| `constant_value` | numeric | leeg |  |
| `unit_id` | uuid | FK | `measurement_unit` |
| `conversion_version_id` | uuid | FK leeg | `unit_conversion_version` |

### recipe_scaling_rule

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `recipe_version_id` | uuid | FK | `master_recipe_version` |
| `code` | text |  |  |
| `description` | text |  |  |
| `rule_kind` | text |  |  |
| `output_unit_id` | uuid | FK | `measurement_unit` |
| `source_reference` | text |  |  |
| `applicability` | text |  |  |

### recipe_specification_link

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `recipe_version_id` | uuid | FK | `recipe_parameter_limit` |
| `parameter_limit_id` | uuid | FK | `recipe_parameter_limit` |
| `code` | text |  |  |
| `description` | text |  |  |

### rooster

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `enkel` | bool | UK |  |
| `patroon` | text[] |  |  |

### rooster_ploeg

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `letter` | text |  |  |
| `divisie` | int |  |  |
| `code` | text | UK leeg |  |
| `cyclus_start` | date |  |  |
| `actief` | bool |  |  |

### schema_versie

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `nummer` | int | PK |  |
| `naam` | text |  |  |
| `uitgevoerd_op` | timestamptz |  |  |

### specificatie

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `product_id` | uuid | FK | `product` |
| `processtap_id` | uuid | FK | `processtap` |
| `versie` | int |  |  |
| `status` | text |  |  |
| `opmerking` | text | leeg |  |
| `aangemaakt_door` | uuid | FK leeg | `gebruiker` |
| `aangemaakt_op` | timestamptz |  |  |
| `vastgesteld_door` | uuid | FK leeg | `gebruiker` |
| `vastgesteld_op` | timestamptz | leeg |  |

### specificatie_regel

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `specificatie_id` | uuid | FK | `specificatie` |
| `veld_id` | uuid | FK | `veld` |
| `grens_min` | numeric | leeg |  |
| `grens_max` | numeric | leeg |  |

### stap_grondstof

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `processtap_id` | uuid | FK | `processtap` |
| `grondstof_id` | uuid | FK | `grondstof` |
| `verplicht` | bool |  |  |
| `actief` | bool |  |  |

### stapplanning

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `dag` | date |  |  |
| `processtap_id` | uuid | FK | `processtap` |
| `batch_id` | uuid | FK leeg | `batch` |
| `lot_id` | uuid | FK leeg | `lot` |
| `voorstel_id` | uuid | FK leeg | `lot_voorstel` |
| `volgorde` | int |  |  |
| `opmerking` | text | leeg |  |
| `aangemaakt_door` | uuid | FK | `gebruiker` |
| `aangemaakt_op` | timestamptz |  |  |

### stapregistratie

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `processtap_id` | uuid | FK | `processtap` |
| `batch_id` | uuid | FK leeg | `batch` |
| `lot_id` | uuid | FK leeg | `lot` |
| `poging` | int |  |  |
| `herbewerking_start` | bool |  |  |
| `reden` | text | leeg |  |
| `pc_id` | uuid | FK | `pc` |
| `operator_id` | uuid | FK | `operator` |
| `gestart_op` | timestamptz |  |  |
| `afgerond_op` | timestamptz | leeg |  |
| `status` | text |  |  |
| `gestart_ontvangen_op` | timestamptz | leeg |  |
| `afgerond_ontvangen_op` | timestamptz | leeg |  |
| `product_id` | uuid | FK leeg | `product` |
| `afgerond_door` | uuid | FK leeg | `operator` |
| `afgerond_pc_id` | uuid | FK leeg | `pc` |
| `nageleverd_door` | uuid | FK leeg | `gebruiker` |
| `nageleverd_reden` | text | leeg |  |
| `nageleverd_op` | timestamptz | leeg |  |

### stilstand

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `processtap_id` | uuid | FK | `processtap` |
| `oorzaak_id` | uuid | FK | `stilstand_oorzaak` |
| `toelichting` | text | leeg |  |
| `begin_op` | timestamptz |  |  |
| `eind_op` | timestamptz | leeg |  |
| `pc_id` | uuid | FK leeg | `pc` |
| `operator_id` | uuid | FK leeg | `operator` |
| `gemeld_door` | uuid | FK | `gebruiker` |
| `beeindigd_door` | uuid | FK leeg | `operator` |
| `eind_notitie` | text | leeg |  |

### stilstand_oorzaak

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `code` | text | UK |  |
| `naam` | text |  |  |
| `categorie` | text |  |  |
| `actief` | bool |  |  |

### terugmelding

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `gemeld_op` | timestamptz |  |  |
| `gebruiker_id` | uuid | FK | `gebruiker` |
| `operator_id` | uuid | FK leeg | `operator` |
| `pc_id` | uuid | FK leeg | `pc` |
| `stapcode` | text | leeg |  |
| `scherm` | text | leeg |  |
| `tekst` | text |  |  |
| `status` | text |  |  |
| `afgehandeld_door` | uuid | FK leeg | `gebruiker` |
| `afgehandeld_op` | timestamptz | leeg |  |
| `notitie` | text | leeg |  |

### unit_conversion

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `quantity_kind_id` | uuid | FK | `quantity_kind` |
| `from_unit_id` | uuid | FK | `measurement_unit` |
| `to_unit_id` | uuid | FK | `measurement_unit` |

### unit_conversion_version

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `conversion_id` | uuid | FK | `unit_conversion` |
| `quantity_kind_id` | uuid | FK | `unit_conversion` |
| `value_semantics` | text | FK | `quantity_kind` |
| `revision` | int |  |  |
| `factor_numerator` | numeric |  |  |
| `factor_denominator` | numeric |  |  |
| `additive_offset` | numeric |  |  |
| `source_reference` | text |  |  |
| `created_by` | uuid | FK | `gebruiker` |
| `created_at` | timestamptz |  |  |

### veld

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `processtap_id` | uuid | FK | `processtap` |
| `code` | text | UK |  |
| `naam` | text |  |  |
| `soort` | text |  |  |
| `eenheid` | text | leeg |  |
| `grens_min` | numeric | leeg |  |
| `grens_max` | numeric | leeg |  |
| `tolerantie` | numeric | leeg |  |
| `tolerantie_soort` | text |  |  |
| `volgnummer` | int |  |  |
| `verplicht` | bool |  |  |
| `actief` | bool |  |  |
| `op_certificaat` | bool |  |  |
| `decimalen` | smallint | leeg |  |
| `gemeten_door` | text |  |  |

### veld_product

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `veld_id` | uuid | PK FK | `veld` |
| `product_id` | uuid | PK FK | `product` |
| `grens_min` | numeric | leeg |  |
| `grens_max` | numeric | leeg |  |
| `tolerantie` | numeric | leeg |  |
| `tolerantie_soort` | text |  |  |

### waarde

| Kolom | Type | | Verwijst naar |
| --- | --- | --- | --- |
| `id` | uuid | PK |  |
| `stapregistratie_id` | uuid | FK | `stapregistratie` |
| `veld_id` | uuid | FK | `veld` |
| `setting` | numeric | leeg |  |
| `gemeten` | numeric |  |  |
| `grens_min` | numeric | leeg |  |
| `grens_max` | numeric | leeg |  |
| `tolerantie` | numeric | leeg |  |
| `tolerantie_soort` | text | leeg |  |
| `markering` | text |  |  |
| `vervangt_waarde_id` | uuid | FK UK leeg | `waarde` |
| `correctie_reden` | text | leeg |  |
| `ingevoerd_door` | uuid | FK leeg | `operator` |
| `gecorrigeerd_door` | uuid | FK leeg | `gebruiker` |
| `ingevoerd_op` | timestamptz |  |  |
| `ontvangen_op` | timestamptz | leeg |  |
| `specificatie_id` | uuid | FK leeg | `specificatie` |
