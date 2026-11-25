"""Test de regels van datamodel v1 tegen een lege database met fictieve configuratie.

Gebruik:  python3 tests/test_regels.py "host=/tmp port=5433 user=postgres dbname=batchgui"
Het script laadt schema.sql, seed_config.sql en seed_accounts_demo.sql opnieuw, dus de database wordt leeggemaakt.
"""
import pathlib
import sys

import datetime as dt
import psycopg

DSN = sys.argv[1] if len(sys.argv) > 1 else "host=/tmp port=5433 user=postgres dbname=batchgui"
ROOT = pathlib.Path(__file__).resolve().parent.parent

resultaten = []


def check(naam, ok, detail=""):
    resultaten.append((naam, ok, detail))
    print(("  OK   " if ok else "  FOUT ") + naam + (f"  [{detail}]" if detail and not ok else ""))


def main():
    with psycopg.connect(DSN, autocommit=True) as c:
        c.execute((ROOT / "db/schema.sql").read_text())
        c.execute((ROOT / "db/seed_config.sql").read_text())
        c.execute((ROOT / "db/seed_accounts_demo.sql").read_text())

    con = psycopg.connect(DSN, autocommit=True)
    con.execute("SET search_path = fabriek")
    # De meeste regels hieronder zijn van vóór de keuring (#64): daar meet de operator alles. De keuring zelf staat onderaan.
    con.execute("UPDATE veld SET gemeten_door = 'productie' WHERE processtap_id IN (SELECT id FROM processtap WHERE soort = 'proces')")

    def one(sql, p=()):
        return (con.execute(sql, p) if p else con.execute(sql)).fetchone()

    def val(sql, p=()):
        return one(sql, p)[0]

    def faalt(naam, sql, p=(), bevat=""):
        try:
            con.execute(sql, p) if p else con.execute(sql)
        except psycopg.Error as e:
            msg = str(e).splitlines()[0]
            check(naam, bevat.lower() in msg.lower(), msg)
            return
        check(naam, False, "geen foutmelding")

    con.execute((ROOT / "db/rechten.sql").read_text())
    print("\nD100 technische rollidmaatschappen")
    rechten_sql = (ROOT / "db/rechten.sql").read_text()
    # Gebruik de bestaande voorgedefinieerde rol zonder objecten of gegevens te wijzigen.
    for login in ("mes_app", "mes_security_channel"):
        con.execute(f"GRANT pg_read_all_data TO {login}")
        try:
            faalt(f"D100 {login}: ongewenst rollidmaatschap geweigerd",
                  rechten_sql, bevat="Onveilige technische MES-databaserol")
            check(f"D100 {login}: afwijking niet stilzwijgend verwijderd",
                  val("SELECT pg_has_role(%s,'pg_read_all_data','MEMBER')", (login,)))
        finally:
            con.execute(f"REVOKE pg_read_all_data FROM {login}")
    con.execute("ALTER ROLE mes_security_channel LOGIN")
    try:
        faalt("D100 securitykanaal mag geen login zijn", rechten_sql,
              bevat="Onveilige technische MES-databaserol")
    finally:
        con.execute("ALTER ROLE mes_security_channel NOLOGIN")
    con.execute(rechten_sql)
    check("D100 beperkte technische rollen geaccepteerd", True)
    print("\nD100 vertrouwd public-schema")
    con.execute("GRANT CREATE ON SCHEMA public TO PUBLIC")
    try:
        faalt("D100 public CREATE voor iedereen geweigerd", rechten_sql,
              bevat="Onvertrouwd public-schema")
    finally:
        con.execute("REVOKE CREATE ON SCHEMA public FROM PUBLIC")
    con.execute(rechten_sql)
    check("D100 vertrouwd public-schema geaccepteerd", True)
    print("\nD100 effectieve SECURITY DEFINER-eigenschappen")
    check("D100 alle definerfuncties hebben vertrouwd zoekpad",
          val("""SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname='fabriek' AND p.prosecdef AND NOT EXISTS
                 (SELECT 1 FROM unnest(coalesce(p.proconfig,ARRAY[]::text[])) c
                  WHERE replace(c,' ','') IN ('search_path=pg_catalog,fabriek,pg_temp',
                                              'search_path=pg_catalog,fabriek,public,pg_temp'))""")==0)
    check("D100 alle definerfuncties eigendom van schema-eigenaar",
          val("""SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname='fabriek' AND p.prosecdef AND p.proowner<>n.nspowner""")==0)
    check("D100 geen PUBLIC-uitvoering van definerfuncties",
          val("""SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
                 WHERE n.nspname='fabriek' AND p.prosecdef AND a.grantee=0 AND a.privilege_type='EXECUTE'""")==0)
    con.execute("ALTER FUNCTION fabriek.execution_session_actor(text) SET search_path=pg_temp,fabriek")
    try:
        faalt("D100 rechteninstallatie weigert onveilig definerzoekpad",
              (ROOT / "db/rechten.sql").read_text(),bevat="Onveilige SECURITY DEFINER-interface")
    finally:
        con.execute("ALTER FUNCTION fabriek.execution_session_actor(text) SET search_path=pg_catalog,fabriek,pg_temp")
    con.execute((ROOT / "db/rechten.sql").read_text())
    print("\nD100 historische functie- en schemarechten")
    con.execute("GRANT EXECUTE ON FUNCTION fabriek.maak_herbewerking(text,text,text,uuid,uuid) TO PUBLIC")
    con.execute("GRANT EXECUTE ON FUNCTION fabriek.authorization_channel_requests() TO mes_app WITH GRANT OPTION")
    con.execute("GRANT EXECUTE ON FUNCTION fabriek.execution_session_login(text,text,text) TO mes_security_channel")
    con.execute("GRANT CREATE ON SCHEMA fabriek TO PUBLIC")
    con.execute("GRANT USAGE,CREATE ON SCHEMA fabriek TO mes_app WITH GRANT OPTION")
    con.execute((ROOT / "db/rechten.sql").read_text())
    con.execute((ROOT / "db/rechten.sql").read_text())
    for login in ("mes_app","batchgui_app","mes_security_channel"):
        if val("SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=%s)",(login,)):
            check(f"D100 {login}: geen CREATE in fabriek",
                  not val("SELECT has_schema_privilege(%s,'fabriek','CREATE')",(login,)))
            check(f"D100 {login}: geen USAGE-delegatie",
                  not val("SELECT has_schema_privilege(%s,'fabriek','USAGE WITH GRANT OPTION')",(login,)))
            check(f"D100 {login}: geen functie-delegatie",
                  val("""SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                         WHERE n.nspname='fabriek' AND has_function_privilege(%s,p.oid,'EXECUTE WITH GRANT OPTION')""",(login,))==0)
            check(f"D100 {login}: oude herbewerkingsfunctie niet uitvoerbaar",
                  not val("SELECT has_function_privilege(%s,'fabriek.maak_herbewerking(text,text,text,uuid,uuid)','EXECUTE')",(login,)))
    check("D100 gewone runtime kan securitykanaal niet uitvoeren",
          not val("SELECT has_function_privilege('mes_app','fabriek.authorization_channel_requests()','EXECUTE')"))
    check("D100 securitykanaal kan runtime-login niet uitvoeren",
          not val("SELECT has_function_privilege('mes_security_channel','fabriek.execution_session_login(text,text,text)','EXECUTE')"))
    check("D100 exact vijf uitvoerbare securitykanaalfuncties",
          val("""SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname='fabriek' AND has_function_privilege('mes_security_channel',p.oid,'EXECUTE')""")==5)
    check("D100 persoonlijk gebonden security-aanvragen blijven toegankelijk",
          val("SELECT has_function_privilege('mes_security_channel','fabriek.authorization_channel_requests()','EXECUTE')"))
    check("D100 runtime-login blijft toegankelijk",
          val("SELECT has_function_privilege('mes_app','fabriek.execution_session_login(text,text,text)','EXECUTE')"))
    print("\nD100 historische tabel- en kolomgrants")
    con.execute("GRANT UPDATE(gemeten), REFERENCES(id) ON waarde TO mes_app WITH GRANT OPTION")
    con.execute("GRANT SELECT(proof_hash) ON execution_session TO PUBLIC")
    con.execute("GRANT SELECT(wachtwoord_hash) ON gebruiker TO mes_security_channel")
    con.execute("GRANT TRIGGER ON waarde TO mes_app")
    con.execute("GRANT INSERT(role_code) ON authorization_grant TO PUBLIC")
    con.execute((ROOT / "db/rechten.sql").read_text())
    con.execute((ROOT / "db/rechten.sql").read_text())
    for login in ("mes_app","batchgui_app","mes_security_channel"):
        if val("SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=%s)",(login,)):
            for tabel,kolom,recht in (("waarde","gemeten","UPDATE"),("waarde","id","REFERENCES"),
                                       ("execution_session","proof_hash","SELECT"),
                                       ("gebruiker","wachtwoord_hash","SELECT"),
                                       ("authorization_grant","role_code","INSERT")):
                check(f"D100 {login}: oude {tabel}.{kolom} {recht} ingetrokken",
                      not val("SELECT has_column_privilege(%s,%s,%s,%s)",(login,"fabriek."+tabel,kolom,recht)))
            check(f"D100 {login}: geen TRIGGER-rechten",
                  val("""SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                         WHERE n.nspname='fabriek' AND c.relkind IN ('r','p','v','m','f')
                           AND has_table_privilege(%s,c.oid,'TRIGGER')""",(login,))==0)
            check(f"D100 {login}: geen UPDATE-delegatie op waarde",
                  not val("SELECT has_column_privilege(%s,'fabriek.waarde','gemeten','UPDATE WITH GRANT OPTION')",(login,)))
    check("D100 toegestane meetinvoer blijft mogelijk",
          val("SELECT has_table_privilege('mes_app','fabriek.waarde','INSERT')"))
    check("D100 begrensde accountleesinterface behouden",
          val("SELECT has_column_privilege('mes_app','fabriek.gebruiker','gebruikersnaam','SELECT')"))
    print("\nD24/D100 effectieve sequencerechten")
    # Simuleer achtergebleven oude grants, inclusief PUBLIC en delegatie.
    con.execute("GRANT SELECT,USAGE,UPDATE ON ALL SEQUENCES IN SCHEMA fabriek TO PUBLIC")
    con.execute("GRANT SELECT,USAGE,UPDATE ON ALL SEQUENCES IN SCHEMA fabriek TO mes_app WITH GRANT OPTION")
    con.execute((ROOT / "db/rechten.sql").read_text())
    con.execute((ROOT / "db/rechten.sql").read_text())
    for login in ("mes_app","batchgui_app","mes_security_channel"):
        if val("SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=%s)",(login,)):
            for recht in ("SELECT","USAGE","UPDATE"):
                check(f"D100 {login}: geen effectief sequence-{recht}",
                      val("""SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                             WHERE n.nspname='fabriek' AND c.relkind='S'
                               AND CASE WHEN c.relkind='S' THEN has_sequence_privilege(%s,c.oid,%s) ELSE false END""",(login,recht))==0)
    con.execute("SET ROLE mes_app")
    try:
        faalt("D100 auditsequence niet rechtstreeks te verhogen",
              "SELECT nextval('fabriek.config_log_id_seq')",bevat="permission denied")
        faalt("D100 auditsequence niet rechtstreeks te wijzigen",
              "SELECT setval('fabriek.config_log_id_seq',1)",bevat="permission denied")
        faalt("D100 auditsequence niet rechtstreeks leesbaar",
              "SELECT last_value FROM fabriek.config_log_id_seq",bevat="permission denied")
    finally:
        con.execute("RESET ROLE")
    print("\nDatabase-uitgegeven sessiebewijs")
    con.execute("SET ROLE mes_app")
    try:
        faalt("Sessieregister niet leesbaar","SELECT proof_hash FROM execution_session",bevat="permission denied")
        faalt("Sessieregister niet schrijfbaar","UPDATE execution_session SET expires_at=now() WHERE false",bevat="permission denied")
        faalt("Sessieregister niet direct op te ruimen","SELECT execution_session_cleanup()",bevat="permission denied")
        check("Onbekend sessiebewijs geweigerd",val("SELECT execution_session_actor(%s)",("0"*64,)) is None)
        check("Leeg sessiebewijs geweigerd",val("SELECT execution_session_actor(NULL)") is None)
        faalt("Transactie zonder bewijs geweigerd","SELECT execution_transaction_actor()",bevat="Geldig persoonlijk")
        faalt("Vervalst bewijs bindt geen transactie","SELECT execution_bind_transaction(%s,NULL)",("0"*64,),bevat="ongeldig")
        con.execute("SELECT set_config('fabriek.execution_proof',%s,false)",("0"*64,))
        try:
            faalt("Zelf ingestelde GUC bewijst geen identiteit","SELECT execution_transaction_actor()",bevat="Geldig persoonlijk")
        finally:
            con.execute("RESET fabriek.execution_proof")
        faalt("Directe stapregistratie geweigerd","INSERT INTO stapregistratie DEFAULT VALUES",bevat="permission denied")
        faalt("Directe afronding geweigerd","UPDATE stapregistratie SET status='afgerond' WHERE false",bevat="permission denied")
        faalt("Oude startfunctie eigenaar-only","SELECT start_stap(NULL,NULL,NULL,NULL,NULL,NULL)",bevat="permission denied")
        faalt("Oude afrondfunctie eigenaar-only","SELECT rond_stap_af(NULL,NULL,NULL)",bevat="permission denied")
        faalt("Start zonder bewijs geweigerd","SELECT execution_step_start(NULL,NULL,NULL,NULL,NULL,NULL)",bevat="Geldig persoonlijk")
        faalt("Afronding zonder bewijs geweigerd","SELECT execution_step_complete(NULL,NULL,NULL)",bevat="Geldig persoonlijk")
        faalt("Herbewerking zonder bewijs geweigerd","SELECT execution_step_rework(NULL,NULL,NULL,NULL,NULL,NULL)",bevat="Geldig persoonlijk")
        faalt("Directe meetinvoer zonder bewijs geweigerd","INSERT INTO waarde DEFAULT VALUES",bevat="Geldig persoonlijk")
        faalt("Directe grondstofinvoer zonder bewijs geweigerd","INSERT INTO grondstof_gebruik DEFAULT VALUES",bevat="Geldig persoonlijk")
        faalt("Direct conflict zonder bewijs geweigerd","INSERT INTO invoerconflict DEFAULT VALUES",bevat="Geldig persoonlijk")
        faalt("Direct conflictbesluit geweigerd","UPDATE invoerconflict SET status='bestaand' WHERE false",bevat="permission denied")
        faalt("Oude conflictfunctie eigenaar-only","SELECT los_invoerconflict_op(NULL,'nieuw',NULL,'test')",bevat="permission denied")
        faalt("Conflictbesluit zonder sessiebewijs geweigerd","SELECT execution_resolve_conflict(NULL,'nieuw','test')",bevat="Geldig persoonlijk")
        faalt("Oude papieren naleverfunctie eigenaar-only","SELECT lever_stap_na(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)",bevat="permission denied")
        faalt("Papieren nalevering zonder bewijs geweigerd","SELECT execution_paper_entry(NULL,NULL,NULL,NULL,NULL,NULL,NULL,'test',NULL,NULL)",bevat="Geldig persoonlijk")
        faalt("Directe lotcreatie geweigerd","INSERT INTO lot DEFAULT VALUES",bevat="permission denied")
        faalt("Directe batchcreatie geweigerd","INSERT INTO batch DEFAULT VALUES",bevat="permission denied")
        faalt("Configuratie zonder sessiebewijs geweigerd","UPDATE veld SET naam=naam WHERE code='S1.1'",bevat="Geldig persoonlijk")
        for tabel in ("stilstand","overdracht","stapplanning"):
            faalt(f"D101 {tabel}: geen operationele insert zonder bewijs",f"INSERT INTO {tabel} DEFAULT VALUES",bevat="Geldig persoonlijk")
        for tabel in ("lot_voorstel","lot_voorstel_batch"):
            check(f"D101 {tabel}: geen directe insert",not val("SELECT has_any_column_privilege(current_user,%s,'INSERT')",("fabriek."+tabel,)))
            check(f"D101 {tabel}: geen directe update",not val("SELECT has_any_column_privilege(current_user,%s,'UPDATE')",("fabriek."+tabel,)))
            check(f"D101 {tabel}: geen directe delete",not val("SELECT has_table_privilege(current_user,%s,'DELETE')",("fabriek."+tabel,)))
        faalt("Oude lotvoorstelfunctie eigenaar-only","SELECT bewaar_lot_voorstel(NULL,NULL,NULL,NULL)",bevat="permission denied")
        faalt("Lotvoorstel opslaan zonder bewijs geweigerd","SELECT planning_save_legacy_proposal(NULL,NULL,NULL)",bevat="Geldig persoonlijk")
        faalt("Lotvoorstel annuleren zonder bewijs geweigerd","SELECT planning_cancel_legacy_proposal(1)",bevat="Geldig persoonlijk")
        proof = val("SELECT session_proof FROM execution_session_login('mes.operator','demo',NULL)")
        check("Persoonlijk operationeel bewijs beschikbaar",bool(proof))
        con.execute("SELECT set_config('fabriek.execution_proof',%s,false)",(proof,))
        try:
            faalt("Operator kan geen planning schrijven","INSERT INTO stapplanning DEFAULT VALUES",bevat="MES-operationele bevoegdheid")
            faalt("Operator kan geen lotvoorstel opslaan","SELECT planning_save_legacy_proposal(NULL,NULL,NULL)",bevat="MES-planningsbevoegdheid")
            faalt("Stilstand kan niet op andermans naam","INSERT INTO stilstand(gemeld_door) VALUES ((SELECT id FROM gebruiker WHERE gebruikersnaam='mes.system'))",bevat="Ongeldige persoonlijke")
            faalt("Overdracht kan niet op andermans naam","INSERT INTO overdracht(gebruiker_id) VALUES ((SELECT id FROM gebruiker WHERE gebruikersnaam='mes.system'))",bevat="Ongeldige persoonlijke")
        finally:
            con.execute("RESET fabriek.execution_proof")
        faalt("Directe systeemmelding geweigerd","INSERT INTO melding DEFAULT VALUES",bevat="permission denied")
        faalt("Leesregistratie zonder bewijs geweigerd","INSERT INTO melding_gelezen DEFAULT VALUES",bevat="Geldig persoonlijk")
        check("Geen directe meldingsinsert via kolomgrant",not val("SELECT has_any_column_privilege(current_user,'fabriek.melding','INSERT')"))
        check("Configuratieguard niet rechtstreeks uitvoerbaar",not val("SELECT has_function_privilege(current_user,'fabriek.configuration_write_guard()','EXECUTE')"))
        proof = val("SELECT session_proof FROM execution_session_login('mes.engineer','demo',NULL)")
        check("Persoonlijk engineeringbewijs beschikbaar",bool(proof))
        con.execute("SELECT set_config('fabriek.execution_proof',%s,false)",(proof,))
        try:
            con.execute("UPDATE veld SET naam=naam WHERE code='S1.1'")
            check("Engineeringwijziging persoonlijk geaudit",val("""SELECT actor_origin='personal' AND actor_user_id=(SELECT id FROM gebruiker WHERE gebruikersnaam='mes.engineer')
              FROM config_log WHERE tabel='veld' AND record_id=(SELECT id FROM veld WHERE code='S1.1') ORDER BY id DESC LIMIT 1"""))
            faalt("Engineer heeft geen accountbeheer","INSERT INTO gebruiker(gebruikersnaam,rol,wachtwoord_hash,wachtwoord_wijzigen) VALUES ('test-engineer-account','pending',wachtwoord_hash('demo-test'),true)",bevat="MES-configuratiebevoegdheid")
        finally:
            con.execute("RESET fabriek.execution_proof")
        for tabel in ("specificatie", "specificatie_regel", "certificaat", "instelling", "terugmelding"):
            for recht in ("INSERT", "UPDATE"):
                check(f"D101 {tabel}: geen {recht} via tabel- of kolomgrant",
                      not val("SELECT has_any_column_privilege(current_user,%s,%s)",("fabriek."+tabel,recht)))
            check(f"D101 {tabel}: geen DELETE",
                  not val("SELECT has_table_privilege(current_user,%s,'DELETE')",("fabriek."+tabel,)))
        faalt("Legacy-specificatiecreatie eigenaar-only","SELECT nieuwe_specificatie(NULL,NULL,NULL)",bevat="permission denied")
        faalt("Legacy-specificatievaststelling eigenaar-only","SELECT stel_specificatie_vast(NULL,NULL)",bevat="permission denied")
        faalt("Meetwaarden niet rechtstreeks wijzigbaar","UPDATE waarde SET gemeten=0 WHERE false",bevat="permission denied")
        faalt("Grondstofhistorie niet rechtstreeks wijzigbaar","UPDATE grondstof_gebruik SET partij='test' WHERE false",bevat="permission denied")
        faalt("Lotmetadata niet rechtstreeks wijzigbaar","UPDATE lot SET lotnummer='L-2000-0001' WHERE false",bevat="permission denied")
        faalt("Keuring niet rechtstreeks aanmaken","INSERT INTO keuring DEFAULT VALUES",bevat="permission denied")
        faalt("Auditregels niet rechtstreeks aanmaakbaar","INSERT INTO config_log (tabel,record_id,actie) VALUES ('test',gen_random_uuid(),'INSERT')",bevat="permission denied")
        check("Geen audit-insert via kolomgrant",not val("SELECT has_any_column_privilege(current_user,'fabriek.config_log','INSERT')"))
        check("Geen audit-update via kolomgrant",not val("SELECT has_any_column_privilege(current_user,'fabriek.config_log','UPDATE')"))
        check("Audittrigger niet rechtstreeks uitvoerbaar",not val("SELECT has_function_privilege(current_user,'fabriek.log_config()','EXECUTE')"))
        check("Audittrigger draait met eigenaarrechten",val("SELECT prosecdef FROM pg_proc WHERE oid='fabriek.log_config()'::regprocedure"))
        faalt("Auditregels niet rechtstreeks wijzigbaar","UPDATE config_log SET gewijzigd_door='test' WHERE false",bevat="permission denied")
        check("Persoonlijke sessiebewijzen niet leesbaar",not val("SELECT has_any_column_privilege(current_user,'fabriek.execution_session','SELECT')"))
        check("Securitybinding niet leesbaar",not val("SELECT has_any_column_privilege(current_user,'fabriek.authorization_channel_identity','SELECT')"))
        check("Intrekking securitybinding niet leesbaar",not val("SELECT has_any_column_privilege(current_user,'fabriek.authorization_channel_identity_revocation','SELECT')"))
        check("Wachtwoordhash niet leesbaar",not val("SELECT has_column_privilege(current_user,'fabriek.gebruiker','wachtwoord_hash','SELECT')"))
        check("Sessiegeneratie blijft leesbaar",val("SELECT has_column_privilege(current_user,'fabriek.gebruiker','session_version','SELECT')"))
        check("Actuele meetwaarden blijven leesbaar",val("SELECT has_table_privilege(current_user,'fabriek.waarde_actueel','SELECT')"))
        check("Meetinvoer blijft beschikbaar",val("SELECT has_table_privilege(current_user,'fabriek.waarde','INSERT')"))
        check("Geen rechtstreeks wijzigingsrecht op meldingen",not val("SELECT has_table_privilege(current_user,'fabriek.melding','UPDATE')"))
        faalt("Tijdelijke batchcreatie zonder bewijs geweigerd","SELECT execution_create_legacy_batch(NULL,NULL,NULL)",bevat="Geldig persoonlijk")
        faalt("Oude planningfunctie eigenaar-only","SELECT plan_batches(1,current_date,NULL,NULL,NULL)",bevat="permission denied")
        faalt("Batchplanning zonder bewijs geweigerd","SELECT execution_plan_legacy_batches(1,current_date,NULL,NULL)",bevat="Geldig persoonlijk")
        faalt("Direct batchbesluit geweigerd","INSERT INTO batch_besluit DEFAULT VALUES",bevat="permission denied")
        faalt("Oude lotsamenstelling eigenaar-only","SELECT maak_lot(NULL,NULL,NULL,NULL,NULL,NULL,NULL)",bevat="permission denied")
        faalt("Blokkade zonder bewijs geweigerd","SELECT execution_batch_hold(NULL,'test')",bevat="Geldig persoonlijk")
        faalt("Planning annuleren zonder bewijs geweigerd","SELECT execution_cancel_planned_batch(NULL,'test')",bevat="Geldig persoonlijk")
        faalt("Oude loginwrapper eigenaar-only","SELECT login_with_session(NULL,NULL,NULL)",bevat="permission denied")
        faalt("Oude login eigenaar-only","SELECT inloggen(NULL,NULL,NULL)",bevat="permission denied")
        check("Gecontroleerde startfunctie beschikbaar",val("SELECT has_function_privilege(current_user,'fabriek.execution_step_start(text,uuid,uuid,uuid,uuid,uuid)','EXECUTE')"))
        check("Geen impliciete PUBLIC-uitvoerrechten",val("""SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
          WHERE n.nspname='fabriek' AND a.grantee=0 AND a.privilege_type='EXECUTE'""")==0)
        faalt("Onderhoudsfunctie niet beschikbaar voor app","SELECT ruim_inlogpogingen_op()",bevat="permission denied")
        faalt("Oude wachtwoordbevestiging eigenaar-only","SELECT change_password_confirmed(NULL,NULL,NULL)",bevat="permission denied")
        check("Alle fabriekfuncties hebben expliciet veilig tijdelijk zoekpad",val("""SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='fabriek' AND p.prokind='f' AND NOT EXISTS
          (SELECT 1 FROM unnest(coalesce(p.proconfig,ARRAY[]::text[])) c WHERE c LIKE 'search_path=%' AND c LIKE '%pg_temp')""")==0)
        faalt("Oude wachtwoordwrapper eigenaar-only","SELECT change_password_session(NULL,1,NULL,NULL)",bevat="permission denied")
    finally:
        con.execute("RESET ROLE")
    print("\nMES rollenregister en demo-bootstrap (D95)")
    con.execute("SET ROLE mes_app")
    try:
        faalt("Oude kwaliteitsfunctie niet direct toegankelijk","SELECT beslis_keuring(NULL::uuid,'vrijgegeven',NULL,NULL::uuid,NULL)",bevat="permission denied")
        faalt("Directe keuringupdate geweigerd","UPDATE keuring SET status='vrijgegeven' WHERE false",bevat="permission denied")
        faalt("Directe besluitupdate geweigerd","UPDATE batch_besluit SET reden='test' WHERE false",bevat="permission denied")
        check("Onbekende actor kan geen kwaliteitsbesluit nemen",val("SELECT quality_decision_confirmed(NULL,1,'batch',NULL,'vrijgegeven','test',NULL,'demo')")=="denied")
    finally:
        con.execute("RESET ROLE")
    demo_operator = val("SELECT id FROM gebruiker WHERE gebruikersnaam='mes.operator'")
    con.execute((ROOT / "db/rechten.sql").read_text())
    con.execute("SET ROLE mes_app")
    try:
        faalt("Directe opdrachtinvoer geweigerd","INSERT INTO herbewerking(reden) VALUES ('test')",bevat="permission denied")
        faalt("Directe opdrachtwijziging geweigerd","UPDATE herbewerking SET reden='test' WHERE false",bevat="permission denied")
        faalt("Onbevestigde oude opdrachtfunctie geweigerd","SELECT maak_herbewerking('test','PS1','test',NULL::uuid)",bevat="permission denied")
        faalt("Onbevestigde oude intrekking geweigerd","SELECT trek_herbewerking_in(NULL::uuid,'test',NULL::uuid)",bevat="permission denied")
        check("Operator zonder opdrachtbevoegdheid geweigerd",one("SELECT * FROM rework_order_confirmed(%s,1,'test','PS1','test',NULL,'demo')",(demo_operator,))[0]=="denied")
    finally:
        con.execute("RESET ROLE")
    check("Operator heeft uitvoeringsrecht", val("SELECT authorization_permits(%s,'execution.record',NULL,NULL,NULL)", (demo_operator,)))
    check("Operator heeft geen correctierecht", not val("SELECT authorization_permits(%s,'execution.correct',NULL,NULL,NULL)", (demo_operator,)))

    check("Dertien MES-rollen gedefinieerd", val("SELECT count(*) FROM authorization_role") == 13)
    check("Twee persoonlijke security-identiteiten", val("SELECT count(DISTINCT g.user_id) FROM authorization_grant g JOIN gebruiker u ON u.id=g.user_id WHERE g.role_code='security_administrator' AND u.actief AND NOT u.gedeeld AND NOT u.wachtwoord_wijzigen") == 2)
    check("Security-identiteit heeft geen legacy beheerdersrol", val("SELECT count(*) FROM gebruiker WHERE gebruikersnaam IN ('mes.security.a','mes.security.b') AND rol='beheerder'") == 0)
    check("Supervisor met twee afzonderlijke grants", val("SELECT count(*) FROM authorization_grant g JOIN gebruiker u ON u.id=g.user_id WHERE u.gebruikersnaam='mes.supervisor'") == 2)
    sec_demo = val("SELECT id FROM gebruiker WHERE gebruikersnaam='mes.security.a'")
    check("Security heeft expliciet aanvraagrecht", val("SELECT authorization_permits(%s,'authorization.request',NULL,NULL,NULL)", (sec_demo,)))
    check("Security heeft geen onbekend productierecht", not val("SELECT authorization_permits(%s,'execution.record',NULL,NULL,NULL)", (sec_demo,)))
    # Simuleer een inconsistent gemigreerd account: beide beheerdomeinen weigeren.
    conflicting = val("INSERT INTO authorization_grant(user_id,role_code) VALUES (%s,'system_administrator') RETURNING id", (sec_demo,))
    check("Gemengd beheer weigert securityrecht", not val("SELECT authorization_permits(%s,'authorization.request',NULL,NULL,NULL)", (sec_demo,)))
    check("Gemengd beheer weigert technisch recht", not val("SELECT authorization_permits(%s,'account.manage',NULL,NULL,NULL)", (sec_demo,)))
    con.execute("DELETE FROM authorization_grant WHERE id=%s", (conflicting,))
    check("Afzonderlijk securityrecht blijft beschikbaar", val("SELECT authorization_permits(%s,'authorization.request',NULL,NULL,NULL)", (sec_demo,)))

    print("\\nMES autorisaties (uitbreidingsmodel)")
    con.execute((ROOT / "db/rechten.sql").read_text())
    con.execute("SET ROLE mes_app")
    try:
        faalt("App mag bootstrap niet uitvoeren", "SELECT authorization_bootstrap_empty('test.sys','test-pass1','test.sec.a','test-pass2','test.sec.b','test-pass3','test')", bevat="permission denied")
    finally:
        con.execute("RESET ROLE")
    faalt("Bootstrap op bestaande database geweigerd", "SELECT authorization_bootstrap_empty('test.sys','test-pass1','test.sec.a','test-pass2','test.sec.b','test-pass3','test')", bevat="lege identiteitsadministratie")
    auth_user = val("SELECT id FROM gebruiker WHERE gebruikersnaam = 'ploegleider1'")
    check("Geen automatische MES-bevoegdheid", not val("SELECT authorization_permits(%s,'execution.record',NULL,NULL,NULL)", (auth_user,)))
    con.execute("INSERT INTO authorization_role VALUES ('test_operator','operations'), ('test_technical','technical')")
    con.execute("INSERT INTO authorization_permission VALUES ('execution.record','operations') ON CONFLICT DO NOTHING")
    con.execute("INSERT INTO authorization_role_permission VALUES ('test_operator','execution.record')")
    con.execute("INSERT INTO authorization_grant (user_id,role_code,area_code) VALUES (%s,'test_operator','A')", (auth_user,))
    check("Recht binnen scope", val("SELECT authorization_permits(%s,'execution.record','A',NULL,NULL)", (auth_user,)))
    check("Recht buiten scope geweigerd", not val("SELECT authorization_permits(%s,'execution.record','B',NULL,NULL)", (auth_user,)))
    check("Ontbrekende scope geweigerd", not val("SELECT authorization_permits(%s,'execution.record',NULL,NULL,NULL)", (auth_user,)))
    con.execute("INSERT INTO qualification VALUES ('test_training','Fictieve training')")
    con.execute("INSERT INTO activity_qualification VALUES ('execution.record','test_training')")
    check("Ontbrekende kwalificatie geweigerd", not val("SELECT authorization_permits(%s,'execution.record','A',NULL,NULL)", (auth_user,)))
    con.execute("INSERT INTO personnel_qualification (user_id,qualification_code) VALUES (%s,'test_training')", (auth_user,))
    check("Geldige kwalificatie", val("SELECT authorization_permits(%s,'execution.record','A',NULL,NULL)", (auth_user,)))
    con.execute("INSERT INTO authorization_grant (user_id,role_code) VALUES (%s,'test_technical')", (auth_user,))
    check("Functiescheiding bij gecombineerde rollen", not val("SELECT authorization_permits(%s,'execution.record','A',NULL,NULL)", (auth_user,)))
    con.execute("SET ROLE mes_app")
    try:
        faalt("Applicatie kan geen oude rol bij accountcreatie toekennen", "INSERT INTO gebruiker(gebruikersnaam,rol,wachtwoord_wijzigen) VALUES ('test-legacy-role','beheerder',true)", bevat="gecontroleerde roltoekenning")
        faalt("Applicatie kan geen oude rol wijzigen", "UPDATE gebruiker SET rol='beheerder' WHERE id=%s", (auth_user,), "Oude rol")
        faalt("Applicatie kan account niet gedeeld maken", "UPDATE gebruiker SET gedeeld=true WHERE id=%s", (auth_user,), "Oude rol")
        check("Accountcreatie heeft begrensd kolomrecht", val("SELECT has_column_privilege(current_user,'fabriek.gebruiker','gebruikersnaam','INSERT')"))
        check("Geen tabelbreed accountschrijfrecht", not val("SELECT has_table_privilege(current_user,'fabriek.gebruiker','UPDATE')"))
        check("Sessiegeneratie niet direct schrijfbaar", not val("SELECT has_column_privilege(current_user,'fabriek.gebruiker','session_version','UPDATE')"))
        check("Personeelskoppeling niet direct schrijfbaar", not val("SELECT has_column_privilege(current_user,'fabriek.operator','gebruiker_id','UPDATE')"))
        faalt("Accountcreatie zonder persoonlijk bewijs geweigerd", "INSERT INTO gebruiker(gebruikersnaam,rol,wachtwoord_hash,wachtwoord_wijzigen) VALUES ('test-pending','pending',wachtwoord_hash('demo-test'),true)", bevat="Geldig persoonlijk")
        proof = val("SELECT session_proof FROM execution_session_login('mes.system','demo',NULL)")
        check("Persoonlijk technisch bewijs beschikbaar", bool(proof))
        con.execute("SELECT set_config('fabriek.execution_proof',%s,false)",(proof,))
        try:
            pending = val("INSERT INTO gebruiker(gebruikersnaam,rol,wachtwoord_hash,wachtwoord_wijzigen) VALUES ('test-pending','pending',wachtwoord_hash('demo-test'),true) RETURNING id")
            faalt("Technisch account heeft geen procesparameterbeheer","UPDATE veld SET naam=naam WHERE code='S1.1'",bevat="MES-configuratiebevoegdheid")
        finally:
            con.execute("RESET fabriek.execution_proof")
        check("Nieuw account heeft geen beheerrecht", not val("SELECT authorization_permits(%s,'account.manage',NULL,NULL,NULL)", (pending,)))
        faalt("Applicatie kan geen directe grant toevoegen", "INSERT INTO authorization_grant (user_id,role_code) VALUES (%s,'test_operator')", (auth_user,), "permission denied")
        faalt("Applicatie kan geen kwalificaties wijzigen", "UPDATE personnel_qualification SET revoked_at=now()", bevat="permission denied")
    finally:
        con.execute("RESET ROLE")

    print("\nMES vierogencontrole (eigenaar-only)")
    sec_a = val("SELECT id FROM gebruiker WHERE gebruikersnaam='beheerder1'")
    sec_b = val("SELECT id FROM gebruiker WHERE gebruikersnaam='planner1'")
    target = val("SELECT id FROM gebruiker WHERE gebruikersnaam='operator.a'")
    con.execute("INSERT INTO authorization_role VALUES ('test_security','security')")
    con.execute("INSERT INTO authorization_role_permission VALUES ('test_security','authorization.request'), ('test_security','authorization.approve')")
    con.execute("INSERT INTO authorization_grant (user_id,role_code) VALUES (%s,'test_security'),(%s,'test_security')", (sec_a,sec_b))
    submit = "SELECT authorization_submit(%s,%s,'test_operator','A',NULL,NULL,now(),NULL,'Testaanvraag')"
    decide = "SELECT authorization_decide(%s,%s,true,'Testbesluit')"
    faalt("Geen eigen bevoegdheid aanvragen", submit, (sec_a,sec_a), "Geen bevoegdheid")
    faalt("Onbevoegde aanvrager", submit, (target,sec_a), "Geen bevoegdheid")
    req = val(submit, (sec_a,target))
    faalt("Aanvrager mag niet zelf goedkeuren", decide, (sec_a,req), "Onafhankelijke")
    faalt("Doelaccount mag niet goedkeuren", decide, (target,req), "Onafhankelijke")
    con.execute("SET ROLE mes_app")
    try:
        faalt("App mag geen aanvraagfunctie uitvoeren", submit, (sec_a,target), "permission denied")
        faalt("App mag geen besluitfunctie uitvoeren", decide, (sec_b,req), "permission denied")
        faalt("App mag aanvraaginhoud niet wijzigen", "UPDATE authorization_request SET reason='gewijzigd'", bevat="permission denied")
    finally:
        con.execute("RESET ROLE")
    grant = val(decide, (sec_b,req))
    check("Onafhankelijk besluit verleent exacte aangevraagde rol en scope",
          val("SELECT count(*) FROM authorization_grant WHERE id=%s AND user_id=%s AND role_code='test_operator' AND area_code='A'", (grant,target)) == 1)
    check("Aanvraag en besluit zijn gekoppeld", val("SELECT grant_id FROM authorization_decision WHERE request_id=%s", (req,)) == grant)
    faalt("Geen tweede besluit", decide, (sec_b,req), "al beoordeeld")
    conflict = val(submit, (sec_a,sec_b))
    faalt("Functiescheiding: doelaccount kan niet goedkeuren", decide, (sec_b,conflict), "Onafhankelijke")
    denied = val(submit, (sec_a,target))
    check("Afwijzing maakt geen grant", val("SELECT authorization_decide(%s,%s,false,'Afgewezen')", (sec_b,denied)) is None)

    # D89: technische app-login mag security-identiteiten niet overnemen.
    con.execute("SET ROLE mes_app")
    try:
        faalt("Applicatie kan geen wachtwoordhash lezen", "SELECT wachtwoord_hash FROM gebruiker", bevat="permission denied")
        faalt("Productieaccount kan niet worden overgenomen", "UPDATE gebruiker SET wachtwoord_hash=wachtwoord_hash('nieuw-test') WHERE id=%s", (demo_operator,), "Kritisch account")
        faalt("Technisch account kan niet worden uitgezet", "UPDATE gebruiker SET actief=false WHERE gebruikersnaam='mes.system'", bevat="Kritisch account")
        faalt("Security-wachtwoordreset geblokkeerd", "UPDATE gebruiker SET wachtwoord_hash=wachtwoord_hash('nieuw-test') WHERE id=%s", (sec_a,), "Kritisch account")
        faalt("Security-rolwijziging geblokkeerd", "UPDATE gebruiker SET rol='analist' WHERE id=%s", (sec_a,), "Oude rol")
        faalt("Security-account hernoemen geblokkeerd", "UPDATE gebruiker SET gebruikersnaam='andere-naam' WHERE id=%s", (sec_a,), "Kritisch account")
        faalt("App mag bevestigde besluitfunctie niet uitvoeren", "SELECT * FROM authorization_decide_confirmed(%s,%s,true,'Test','demo')", (sec_b,req), "permission denied")
    finally:
        con.execute("RESET ROLE")
    channel_a = val("SELECT id FROM gebruiker WHERE gebruikersnaam='mes.security.a'")
    channel_b = val("SELECT id FROM gebruiker WHERE gebruikersnaam='mes.security.b'")
    channel_target = val("INSERT INTO gebruiker(gebruikersnaam,rol,wachtwoord_hash) VALUES ('test-channel','pending',wachtwoord_hash('demo-test')) RETURNING id")
    channel_submit = "SELECT * FROM authorization_channel_submit(%s,'operator',NULL,NULL,NULL,now(),NULL,'Testkanaal',%s)"
    con.execute("SET ROLE mes_app")
    try:
        faalt("Gewone app mag securitykanaal niet aanroepen",channel_submit,(channel_target,'demo'),"permission denied")
        faalt("Gewone app mag bindingen niet lezen","SELECT * FROM authorization_channel_identity",bevat="permission denied")
    finally:
        con.execute("RESET ROLE")
    con.execute("SET ROLE mes_security_channel")
    try:
        faalt("Groepsrol zonder persoonlijke login is onvoldoende",channel_submit,(channel_target,'demo'),"Geen gebonden")
        faalt("Securitykanaal mag geen directe grants schrijven","INSERT INTO authorization_grant(user_id,role_code) VALUES (%s,'operator')",(channel_target,),"permission denied")
        faalt("Securitykanaal mag geen actor opgeven","SELECT * FROM authorization_channel_submit(%s,%s,'operator',NULL,NULL,NULL,now(),NULL,'Test','demo')",(channel_a,channel_target),"permission denied")
    finally:
        con.execute("RESET ROLE")
    # Uitsluitend fictieve rollen; SET SESSION AUTHORIZATION simuleert de oorspronkelijke login.
    # De eigenaar is in deze tijdelijke testdatabase superuser.
    import uuid
    suffix = uuid.uuid4().hex[:12]
    role_a, role_b, role_c = "mes_test_sec_a_"+suffix, "mes_test_sec_b_"+suffix, "mes_test_sec_c_"+suffix
    try:
        for role, actor in [(role_a,channel_a),(role_b,channel_b)]:
            con.execute(f"CREATE ROLE {role} LOGIN IN ROLE mes_security_channel")
            val("SELECT authorization_channel_bind(%s::name,%s,'Fictieve test')",(role,actor))
        # D100: directe rechten die na binding ontstaan mogen niet ongemerkt blijven.
        for acl_grant_sql, acl_revoke_sql in (
            ("GRANT SELECT(wachtwoord_hash) ON fabriek.gebruiker TO", "REVOKE SELECT(wachtwoord_hash) ON fabriek.gebruiker FROM"),
            ("GRANT EXECUTE ON FUNCTION fabriek.execution_session_login(text,text,text) TO", "REVOKE EXECUTE ON FUNCTION fabriek.execution_session_login(text,text,text) FROM"),
            ("GRANT CREATE ON SCHEMA public TO", "REVOKE CREATE ON SCHEMA public FROM"),
        ):
            con.execute(f"{acl_grant_sql} {role_a}")
            try:
                faalt("D100 installatie weigert extra persoonlijk recht", rechten_sql,
                      bevat="Onveilige persoonlijke MES-databaserol")
                con.execute(f"SET SESSION AUTHORIZATION {role_a}")
                try:
                    faalt("D100 securitykanaal weigert extra persoonlijk recht",
                          "SELECT * FROM authorization_channel_requests()", bevat="Geen gebonden")
                finally:
                    con.execute("RESET SESSION AUTHORIZATION")
            finally:
                con.execute(f"{acl_revoke_sql} {role_a}")
        con.execute(rechten_sql)
        con.execute(f"SET SESSION AUTHORIZATION {role_a}")
        check("Onjuiste herbevestiging weigert aanvraag",one(channel_submit,(channel_target,'onjuist'))[0]=="denied")
        status, channel_request = one(channel_submit,(channel_target,'demo'))
        check("Bevestigde aanvraag via gebonden kanaal",status=="submitted")
        channel_decide = "SELECT * FROM authorization_channel_decide(%s,true,'Testbesluit',%s)"
        faalt("Geen eigen aanvraag goedkeuren",channel_decide,(channel_request,'demo'),"Onafhankelijke")
        con.execute("RESET SESSION AUTHORIZATION")
        con.execute(f"SET SESSION AUTHORIZATION {role_b}")
        check("Exacte aanvraag leesbaar",val("SELECT count(*) FROM authorization_channel_requests() WHERE request_id=%s AND requested_by=%s",(channel_request,channel_a))==1)
        status, channel_grant = one(channel_decide,(channel_request,'demo'))
        check("Onafhankelijk besluit via gebonden kanaal",status=="decided" and channel_grant is not None)
        check("Bevestigde intrekking via gebonden kanaal",val("SELECT authorization_channel_revoke(%s,'Testintrekking','demo')",(channel_grant,))=="revoked")
        check("Ingetrokken grant blijft leesbaar",val("SELECT count(*) FROM authorization_channel_grants() WHERE grant_id=%s AND revoked_at IS NOT NULL",(channel_grant,))==1)
        faalt("Kanaal mag eigen binding niet intrekken","SELECT authorization_channel_unbind(%s::name,'Test')",(role_b,),"permission denied")
        con.execute("RESET SESSION AUTHORIZATION")
        con.execute(f"CREATE ROLE {role_c} LOGIN IN ROLE mes_security_channel")
        faalt("Geen tweede actieve binding","SELECT authorization_channel_bind(%s::name,%s,'Fictieve test')",(role_c,channel_a),"actieve binding")
        val("SELECT authorization_channel_unbind(%s::name,'Fictieve intrekking')",(role_a,))
        con.execute(f"SET SESSION AUTHORIZATION {role_a}")
        faalt("Ingetrokken login kan niet meer lezen","SELECT * FROM authorization_channel_requests()",bevat="Geen gebonden")
        con.execute("RESET SESSION AUTHORIZATION")
        val("SELECT authorization_channel_bind(%s::name,%s,'Fictieve vervanging')",(role_c,channel_a))
        con.execute(f"SET SESSION AUTHORIZATION {role_c}")
        check("Vervangende login kan lezen",val("SELECT count(*) FROM authorization_channel_requests() WHERE request_id=%s",(channel_request,))==1)
        con.execute("RESET SESSION AUTHORIZATION")
        check("Historische binding en intrekking blijven bewaard",val("SELECT count(*) FROM authorization_channel_identity i JOIN authorization_channel_identity_revocation v USING(database_role_oid) WHERE i.user_id=%s",(channel_a,))==1)
    finally:
        con.execute("RESET SESSION AUTHORIZATION")
        con.execute(f"DROP ROLE IF EXISTS {role_a}")
        con.execute(f"DROP ROLE IF EXISTS {role_b}")
        con.execute(f"DROP ROLE IF EXISTS {role_c}")
    personnel_manager = val("SELECT id FROM gebruiker WHERE gebruikersnaam='mes.manager'")
    personnel_system = val("SELECT id FROM gebruiker WHERE gebruikersnaam='mes.system'")
    check("Manufacturing Manager heeft personeelsbeheer", val("SELECT authorization_permits(%s,'personnel.manage',NULL,NULL,NULL)",(personnel_manager,)))
    check("Technisch beheer heeft geen personeelsbeheer", not val("SELECT authorization_permits(%s,'personnel.manage',NULL,NULL,NULL)",(personnel_system,)))
    unlinked = val("INSERT INTO gebruiker(gebruikersnaam,rol,wachtwoord_hash) VALUES ('test-unlinked','operator',wachtwoord_hash('demo-test')) RETURNING id")
    check("Loginprojectie maakt geen persoon aan", val("SELECT operator_van_account(%s)",(unlinked,)) is None)
    check("Geen nieuwe personeelskoppeling", val("SELECT count(*) FROM operator WHERE gebruiker_id=%s",(unlinked,)) == 0)
    con.execute("SET ROLE mes_app")
    try:
        faalt("App mag personeelskoppeling niet wijzigen", "UPDATE operator SET gebruiker_id=%s WHERE gebruiker_id=%s",(unlinked,demo_operator),"permission denied")
        faalt("App mag gekoppelde persoon niet aanmaken", "INSERT INTO operator(naam,gebruiker_id) VALUES ('test-koppeling',%s)",(unlinked,),"permission denied")
    finally:
        con.execute("RESET ROLE")
    # 0085: eerste personeelskoppeling, onafhankelijke herbevestiging en audit.
    link_person = val("INSERT INTO operator(naam) VALUES ('Test persoonlijke koppeling 0085') RETURNING id")
    link_target = val("INSERT INTO gebruiker(gebruikersnaam,rol,wachtwoord_hash) VALUES ('test-link-target','pending',wachtwoord_hash('demo-test')) RETURNING id")
    link_manager = val("INSERT INTO gebruiker(gebruikersnaam,rol,wachtwoord_hash) VALUES ('test-link-manager','pending',wachtwoord_hash('demo-test')) RETURNING id")
    link_security = val("INSERT INTO gebruiker(gebruikersnaam,rol,wachtwoord_hash) VALUES ('test-link-security','pending',wachtwoord_hash('demo-test')) RETURNING id")
    con.execute("INSERT INTO authorization_grant(user_id,role_code) VALUES (%s,'manufacturing_manager'),(%s,'security_administrator')",(link_manager,link_security))
    link_sql = "SELECT authorization_link_personnel_confirmed(%s,%s,%s,%s,'Fictieve identiteitscontrole',%s,%s)"
    link_args = (link_person,link_target,link_manager,link_security,'demo-test','demo-test')
    con.execute("SET ROLE mes_app")
    try:
        faalt("App kan gecontroleerde koppeling niet aanroepen",link_sql,link_args,"permission denied")
        faalt("App kan geen koppelbewijs fabriceren","INSERT INTO authorization_personnel_link DEFAULT VALUES",bevat="permission denied")
    finally:
        con.execute("RESET ROLE")
    faalt("Personeelskoppeling vereist onafhankelijkheid",link_sql,(link_person,link_target,link_manager,link_manager,'demo-test','demo-test'),"Onafhankelijke")
    faalt("Securitybeheerder vervangt personeelsbeheerder niet",link_sql,(link_person,link_target,link_security,link_manager,'demo-test','demo-test'),"Onafhankelijke bevoegde")
    check("Verkeerde herbevestiging weigert koppeling",val(link_sql,(*link_args[:5],'onjuist'))=="denied")
    check("Geweigerde koppeling laat identiteit en audit intact",val("SELECT gebruiker_id FROM operator WHERE id=%s",(link_person,)) is None and val("SELECT count(*) FROM authorization_personnel_link WHERE personnel_id=%s",(link_person,))==0)
    check("Onafhankelijk bevestigde eerste koppeling slaagt",val(link_sql,link_args)=="linked")
    check("Loginprojectie gebruikt gekoppelde personeels-ID",val("SELECT operator_van_account(%s)",(link_target,))==link_person)
    check("Audit bewaart beide persoonlijke verantwoordelijken",val("SELECT count(*) FROM authorization_personnel_link WHERE personnel_id=%s AND user_id=%s AND requested_by=%s AND approved_by=%s",link_args[:4])==1)
    check("Koppeling verleent geen MES-grants",val("SELECT count(*) FROM authorization_grant WHERE user_id=%s",(link_target,))==0)
    faalt("Bestaande koppeling niet overschrijven",link_sql,link_args,"Uitsluitend eerste")
    faalt("Koppelbewijs onveranderlijk","UPDATE authorization_personnel_link SET reason='gewijzigd' WHERE personnel_id=%s",(link_person,),"onveranderlijk")

    # 0086: operationele kwalificatie, twee inhoudelijke beoordelaars, intrekking.
    qual_manager = val("INSERT INTO gebruiker(gebruikersnaam,rol,wachtwoord_hash) VALUES ('test-qual-manager','pending',wachtwoord_hash('demo-test')) RETURNING id")
    con.execute("INSERT INTO authorization_grant(user_id,role_code) VALUES (%s,'manufacturing_manager')",(qual_manager,))
    con.execute("INSERT INTO authorization_permission VALUES ('test.qualified.activity','operations')")
    con.execute("INSERT INTO authorization_role_permission VALUES ('test_operator','test.qualified.activity')")
    con.execute("INSERT INTO authorization_grant(user_id,role_code) VALUES (%s,'test_operator')",(link_target,))
    con.execute("INSERT INTO qualification VALUES ('test_0086','Fictieve kwalificatie 0086'),('test_0086_unknown','Niet geclassificeerd')")
    con.execute("INSERT INTO activity_qualification VALUES ('test.qualified.activity','test_0086')")
    issue_sql = "SELECT * FROM qualification_issue_confirmed(%s,%s,now()-interval '1 minute',now()+interval '1 day',%s,%s,'Fictief bewijs',%s,%s)"
    issue_args = (link_target,'test_0086',link_manager,qual_manager,'demo-test','demo-test')
    check("0086 Zonder kwalificatie geen activiteit",not val("SELECT authorization_permits(%s,'test.qualified.activity',NULL,NULL,NULL)",(link_target,)))
    con.execute("SET ROLE mes_app")
    try:
        faalt("0086 App mag kwalificatie niet toekennen",issue_sql,issue_args,"permission denied")
        faalt("0086 App mag geen bewijs fabriceren","INSERT INTO qualification_issue DEFAULT VALUES",bevat="permission denied")
    finally:
        con.execute("RESET ROLE")
    faalt("0086 Geen eigen of dubbele beoordeling",issue_sql,(link_target,'test_0086',link_manager,link_manager,'demo-test','demo-test'),"Onafhankelijke")
    faalt("0086 Security beoordeelt geen vakbekwaamheid",issue_sql,(link_target,'test_0086',link_manager,link_security,'demo-test','demo-test'),"inhoudelijk")
    faalt("0086 Ongeclassificeerde kwalificatie geweigerd",issue_sql,(link_target,'test_0086_unknown',link_manager,qual_manager,'demo-test','demo-test'),"geclassificeerde")
    check("0086 Onjuiste bevestiging geweigerd",one(issue_sql,(*issue_args[:5],'onjuist'))==('denied',None))
    check("0086 Geen kwalificatie na geweigerde bevestiging",val("SELECT count(*) FROM personnel_qualification WHERE user_id=%s AND qualification_code='test_0086'",(link_target,))==0)
    qual_status, qual_id=one(issue_sql,issue_args)
    check("0086 Onafhankelijke toekenning slaagt",qual_status=='issued' and qual_id is not None)
    check("0086 Kwalificatie geeft toegang uitsluitend met grant",val("SELECT authorization_permits(%s,'test.qualified.activity',NULL,NULL,NULL)",(link_target,)))
    check("0086 Bewijs koppelt beide beoordelaars",val("SELECT count(*) FROM qualification_issue WHERE qualification_id=%s AND requested_by=%s AND approved_by=%s",(qual_id,link_manager,qual_manager))==1)
    faalt("0086 Overlap geweigerd",issue_sql,issue_args,"Overlappende")
    revoke_q="SELECT qualification_revoke_confirmed(%s,%s,'Fictieve intrekking',%s)"
    faalt("0086 Geen zelfintrekking",revoke_q,(qual_id,link_target,'demo-test'),"Onafhankelijke")
    check("0086 Verkeerd wachtwoord trekt niet in",val(revoke_q,(qual_id,link_manager,'onjuist'))=='denied')
    check("0086 Intrekking slaagt",val(revoke_q,(qual_id,link_manager,'demo-test'))=='revoked')
    check("0086 Ingetrokken kwalificatie weigert activiteit",not val("SELECT authorization_permits(%s,'test.qualified.activity',NULL,NULL,NULL)",(link_target,)))
    check("0086 Intrekking bewaart oorspronkelijke kwalificatie",val("SELECT count(*) FROM personnel_qualification q JOIN qualification_revocation r ON r.qualification_id=q.id AND r.revoked_at=q.revoked_at WHERE q.id=%s",(qual_id,))==1)
    faalt("0086 Toekenningsbewijs onveranderlijk","UPDATE qualification_issue SET evidence='x' WHERE qualification_id=%s",(qual_id,),"onveranderlijk")
    faalt("0086 Intrekkingsbewijs onveranderlijk","DELETE FROM qualification_revocation WHERE qualification_id=%s",(qual_id,),"onveranderlijk")

    recovery_target = val("INSERT INTO gebruiker(gebruikersnaam,rol,wachtwoord_hash) VALUES ('test-recovery','pending',wachtwoord_hash('demo-test')) RETURNING id")
    recovery_a = val("SELECT id FROM gebruiker WHERE gebruikersnaam='mes.security.a'")
    recovery_b = val("SELECT id FROM gebruiker WHERE gebruikersnaam='mes.security.b'")
    check("Hersteldiagnose telt onafhankelijke paren", val("SELECT independent_pairs FROM authorization_recovery_readiness(%s)",(recovery_target,)) >= 2)
    check("Doelaccount uitgesloten bij hersteldiagnose", val("SELECT independent_pairs FROM authorization_recovery_readiness(%s)",(recovery_a,)) < val("SELECT independent_pairs FROM authorization_recovery_readiness(%s)",(recovery_target,)))
    con.execute("SET ROLE mes_app")
    try:
        faalt("Gewone app mag hersteldiagnose niet uitvoeren", "SELECT * FROM authorization_recovery_readiness(%s)",(recovery_target,),"permission denied")
    finally:
        con.execute("RESET ROLE")
    recover = "SELECT authorization_recover_confirmed(%s,%s,%s,'Fictief herstel',%s,%s,'tijdelijk-herstel')"
    faalt("Herstel vereist twee verschillende beoordelaars", recover, (recovery_target,recovery_a,recovery_a,'demo','demo'), "Onafhankelijke")
    faalt("Herstel vereist onafhankelijke doelidentiteit", recover, (recovery_a,recovery_a,recovery_b,'demo','demo'), "Onafhankelijke")
    con.execute("SET ROLE mes_app")
    try:
        faalt("App mag herstel niet uitvoeren", recover, (recovery_target,recovery_a,recovery_b,'demo','demo'), "permission denied")
    finally:
        con.execute("RESET ROLE")
    check("Verkeerde herbevestiging weigert herstel", val(recover,(recovery_target,recovery_a,recovery_b,'demo','onjuist')) == "denied")
    check("Geen herstelrecord bij geweigerde herbevestiging", val("SELECT count(*) FROM authorization_recovery WHERE user_id=%s",(recovery_target,)) == 0)
    before_recovery = val("SELECT session_version FROM gebruiker WHERE id=%s",(recovery_target,))
    check("Onafhankelijk herbevestigd herstel slaagt", val(recover,(recovery_target,recovery_a,recovery_b,'demo','demo')) == "recovered")
    check("Herstel trekt sessiegeneratie in", val("SELECT session_version FROM gebruiker WHERE id=%s",(recovery_target,)) == before_recovery+1)
    check("Oude generatie kan wachtwoord niet wijzigen", val("SELECT status FROM change_password_session(%s,%s,'tijdelijk-herstel','persoonlijk-test')",(recovery_target,before_recovery)) == "stale")
    con.execute("SET ROLE mes_app")
    try:
        faalt("Applicatie mag generatie niet terugzetten", "UPDATE gebruiker SET session_version=1 WHERE id=%s",(recovery_target,),"permission denied")
    finally:
        con.execute("RESET ROLE")
    check("Herstel vereist persoonlijk wachtwoord kiezen", val("SELECT wachtwoord_wijzigen FROM gebruiker WHERE id=%s",(recovery_target,)))
    check("Herstelrecord koppelt exacte identiteit en beoordelaars", val("SELECT count(*) FROM authorization_recovery WHERE user_id=%s AND requested_by=%s AND approved_by=%s",(recovery_target,recovery_a,recovery_b)) == 1)
    faalt("Herstelrecord onveranderlijk", "UPDATE authorization_recovery SET reason='gewijzigd' WHERE user_id=%s",(recovery_target,),"onveranderlijk")
    # Ook een nog niet geldige grant beschermt de identiteit.
    future_user = val("INSERT INTO gebruiker(gebruikersnaam,rol,wachtwoord_hash) VALUES ('test-future','pending',wachtwoord_hash('demo-test')) RETURNING id")
    con.execute("INSERT INTO authorization_grant(user_id,role_code,valid_from) VALUES (%s,'operator',now()+interval '1 day')", (future_user,))
    con.execute("SET ROLE mes_app")
    try:
        faalt("Toekomstige grant beschermt wachtwoord", "UPDATE gebruiker SET wachtwoord_hash=wachtwoord_hash('nieuw-test') WHERE id=%s", (future_user,), "Kritisch account")
        generation = val("SELECT session_version FROM gebruiker WHERE id=%s", (future_user,))
        check("Eigen bevestigde wachtwoordwijziging blijft mogelijk", val("SELECT status FROM execution_session_change_password(%s,%s,'demo-test','persoonlijk-test')", (future_user,generation)) == "changed")
    finally:
        con.execute("RESET ROLE")
    temporary_target = val("INSERT INTO gebruiker(gebruikersnaam,rol,wachtwoord_hash,wachtwoord_wijzigen) VALUES ('test-temp-grant','pending',wachtwoord_hash('demo-test'),true) RETURNING id")
    temporary_request = val(submit, (sec_a,temporary_target))
    faalt("Geen grant bij tijdelijk wachtwoord", decide, (sec_b,temporary_request), "Ongeldig persoonlijk doelaccount")
    confirm_req = val(submit, (sec_a,target))
    check("Onjuist wachtwoord verleent geen bevoegdheid",
          val("SELECT status FROM authorization_decide_confirmed(%s,%s,true,'Test','onjuist')", (sec_b,confirm_req)) == "denied")
    check("Mislukte herbevestiging heeft geen besluit",
          val("SELECT count(*) FROM authorization_decision WHERE request_id=%s", (confirm_req,)) == 0)
    check("Persoonlijke herbevestiging beslist exacte aanvraag",
          val("SELECT status FROM authorization_decide_confirmed(%s,%s,true,'Test','demo')", (sec_b,confirm_req)) == "decided")
    check("Bevestigd besluit bewaard", val("SELECT count(*) FROM authorization_decision WHERE request_id=%s AND decided_by=%s", (confirm_req,sec_b)) == 1)
    con.execute("INSERT INTO authorization_role_permission VALUES ('test_security','authorization.revoke')")
    revoke = "SELECT authorization_revoke_confirmed(%s,%s,'Testintrekking',%s)"
    faalt("Onbevoegde intrekking geweigerd", revoke, (target,grant,"demo"), "Geen bevoegdheid")
    check("Verkeerd wachtwoord trekt geen grant in", val(revoke,(sec_b,grant,"onjuist")) == "denied")
    check("Grant nog geldig na mislukte herbevestiging", val("SELECT revoked_at FROM authorization_grant WHERE id=%s",(grant,)) is None)
    con.execute("SET ROLE mes_app")
    try:
        faalt("App mag intrekking niet rechtstreeks uitvoeren", revoke,(sec_b,grant,"demo"),"permission denied")
    finally:
        con.execute("RESET ROLE")
    check("Bevestigde intrekking slaagt", val(revoke,(sec_b,grant,"demo")) == "revoked")
    check("Intrekking behoudt grant en auditspoor", val("SELECT count(*) FROM authorization_revocation r JOIN authorization_grant g ON g.id=r.grant_id AND g.revoked_at=r.revoked_at WHERE r.grant_id=%s AND r.revoked_by=%s",(grant,sec_b)) == 1)
    faalt("Dubbele intrekking geweigerd",revoke,(sec_b,grant,"demo"),"al ingetrokken")
    faalt("Besluit kan niet worden gewijzigd","UPDATE authorization_decision SET reason='gewijzigd' WHERE request_id=%s",(req,),"onveranderlijk")
    faalt("Aanvraag kan niet worden verwijderd","DELETE FROM authorization_request WHERE id=%s",(req,),"onveranderlijk")
    faalt("Intrekking kan niet worden gewijzigd","UPDATE authorization_revocation SET reason='gewijzigd' WHERE grant_id=%s",(grant,),"onveranderlijk")
    # Ruim testgrants niet op: trek ze in zodat bestaande regressies niet door
    # fictieve security-rechten worden beïnvloed en het testspoor bewaard blijft.
    con.execute("UPDATE authorization_grant SET revoked_at=now() WHERE role_code='test_security'")

    pc = val("SELECT id FROM pc WHERE naam = 'PC-01'")
    op = val("SELECT id FROM operator WHERE naam = 'Operator A'")
    pl = val("SELECT id FROM gebruiker WHERE gebruikersnaam = 'ploegleider1'")
    op_account = val("SELECT id FROM gebruiker WHERE gebruikersnaam = 'operator'")
    kw = val("SELECT id FROM gebruiker WHERE gebruikersnaam = 'kwaliteit1'")
    mes_corrector = val("SELECT id FROM gebruiker WHERE gebruikersnaam='mes.supervisor'")
    mes_quality_decider = val("SELECT id FROM gebruiker WHERE gebruikersnaam='mes.quality.approver'")

    bh = val("SELECT id FROM gebruiker WHERE gebruikersnaam = 'beheerder1'")
    veld = {code: vid for code, vid in con.execute("SELECT code, id FROM veld")}
    soort = {code: s for code, s in con.execute("SELECT code, soort FROM veld")}

    stap_gs = {s: g for s, g in con.execute(
        "SELECT p.code, x.grondstof_id FROM stap_grondstof x JOIN processtap p ON p.id = x.processtap_id WHERE x.verplicht")}

    def vul_in(reg, stapnr, afwijkend=None):
        """Vul alle velden (en verplichte grondstoffen) van een stap met normale fictieve waarden."""
        if f"PS{stapnr}" in stap_gs:
            con.execute("INSERT INTO grondstof_gebruik (stapregistratie_id, grondstof_id, partij, ingevoerd_door) VALUES (%s,%s,'LEV-TEST-01',%s)",
                        (reg, stap_gs[f"PS{stapnr}"], op))
        afwijkend = afwijkend or {}
        codes = [c for c in veld if c.startswith(f"S{stapnr}.")]
        for code in sorted(codes):
            if code in afwijkend:
                setting, gemeten = afwijkend[code]
            elif code.endswith(".1"):
                setting, gemeten = 80, 81.5
            elif code.endswith(".2"):
                setting, gemeten = None, (410 if stapnr < 16 else 1640)
            elif code == "S3.3":
                setting, gemeten = 5, 5.2
            elif code == "S7.3":
                setting, gemeten = 800, 812
            else:  # S18.3 vochtgehalte
                setting, gemeten = None, 3.2
            if soort[code] != "procesparameter":
                setting = None
            con.execute(
                "INSERT INTO waarde (stapregistratie_id, veld_id, setting, gemeten, ingevoerd_door) VALUES (%s,%s,%s,%s,%s)",
                (reg, veld[code], setting, gemeten, op),
            )

    def doorloop(batch_id, van=1, tot=15):
        for k in range(van, tot + 1):
            reg = val("SELECT start_stap(%s, %s, NULL, %s, %s)", (f"PS{k}", batch_id, pc, op))
            vul_in(reg, k)
            con.execute("SELECT rond_stap_af(%s)", (reg,))

    def nieuwe_batch(nr):
        return val("INSERT INTO batch (batchnummer, aangemaakt_door) VALUES (%s, %s) RETURNING id", (nr, op))

    print("\nBatchstappen")
    b = [nieuwe_batch(f"B-2026-000{i}") for i in range(1, 7)]
    faalt("Batchnummer moet het formaat B-JJJJ-nnnn hebben",
          "INSERT INTO batch (batchnummer) VALUES ('batch 7')", bevat="check")
    faalt("PS2 kan niet voor PS1", "SELECT start_stap('PS2', %s, NULL, %s, %s)", (b[0], pc, op), "PS1 moet eerst afgerond")
    faalt("Lotstap kan niet per batch", "SELECT start_stap('PS17', %s, NULL, %s, %s)", (b[0], pc, op), "per lot")

    reg = val("SELECT start_stap('PS1', %s, NULL, %s, %s)", (b[0], pc, op))
    faalt("Zelfde stap twee keer open", "SELECT start_stap('PS1', %s, NULL, %s, %s)", (b[0], pc, op), "staat nog open")
    faalt("Dubbel starten zegt wie startte, waar en wanneer (#55)", "SELECT start_stap('PS1', %s, NULL, %s, %s)", (b[0], pc, op),
          "gestart door Operator A op PC-01 om ")
    faalt("Afronden zonder verplichte velden en grondstof", "SELECT rond_stap_af(%s)", (reg,), "Nog niet ingevuld: S1.1, S1.2, grondstof GS-A")
    gs = {c: i for c, i in con.execute("SELECT code, id FROM grondstof")}
    faalt("Grondstof die niet bij de stap hoort",
          "INSERT INTO grondstof_gebruik (stapregistratie_id, grondstof_id, partij, ingevoerd_door) VALUES (%s,%s,'P-1',%s)",
          (reg, gs["GS-B"], op), "hoort niet bij deze stap")
    faalt("Partijnummer mag niet leeg zijn",
          "INSERT INTO grondstof_gebruik (stapregistratie_id, grondstof_id, partij, ingevoerd_door) VALUES (%s,%s,'  ',%s)",
          (reg, gs["GS-A"], op), "check")
    faalt("Procesparameter zonder setting",
          "INSERT INTO waarde (stapregistratie_id, veld_id, gemeten, ingevoerd_door) VALUES (%s,%s,81,%s)",
          (reg, veld["S1.1"], op), "setting is verplicht")
    faalt("Veld van een andere stap",
          "INSERT INTO waarde (stapregistratie_id, veld_id, setting, gemeten, ingevoerd_door) VALUES (%s,%s,80,81,%s)",
          (reg, veld["S2.1"], op), "hoort niet bij deze stap")
    vul_in(reg, 1, {"S1.1": (80, 86.0)})
    check("Markering: 86 bij setting 80 (tol 5) = buiten tolerantie",
          val("SELECT markering FROM waarde WHERE stapregistratie_id=%s AND veld_id=%s", (reg, veld["S1.1"])) == "buiten_tolerantie")
    con.execute("SELECT rond_stap_af(%s)", (reg,))
    check("Zonder naam: afgerond door wie startte, op dezelfde pc (#55)",
          con.execute("SELECT afgerond_door = operator_id AND afgerond_pc_id = pc_id FROM stapregistratie WHERE id = %s", (reg,)).fetchone()[0])
    faalt("Waarde toevoegen na afronden",
          "INSERT INTO waarde (stapregistratie_id, veld_id, setting, gemeten, ingevoerd_door) VALUES (%s,%s,80,81,%s)",
          (reg, veld["S1.1"], op), "al afgerond")
    faalt("Grondstof toevoegen na afronden",
          "INSERT INTO grondstof_gebruik (stapregistratie_id, grondstof_id, partij, ingevoerd_door) VALUES (%s,%s,'P-2',%s)",
          (reg, gs["GS-A"], op), "al afgerond")
    gid = val("SELECT id FROM grondstof_gebruik WHERE stapregistratie_id = %s", (reg,))
    faalt("Grondstofregel wijzigen kan niet", "UPDATE grondstof_gebruik SET partij = 'X' WHERE id = %s", (gid,), "niet gewijzigd")
    faalt("Correctie van een grondstof door kwaliteit kan niet",
          "INSERT INTO grondstof_gebruik (stapregistratie_id, grondstof_id, partij, vervangt_id, correctie_reden, gecorrigeerd_door) VALUES (%s,%s,'P-3',%s,'tikfout',%s)",
          (reg, gs["GS-A"], gid, kw), "MES-correctiebevoegdheid")
    faalt("D101 oude ploegleider zonder MES-grant corrigeert geen grondstof",
          "INSERT INTO grondstof_gebruik (stapregistratie_id, grondstof_id, partij, vervangt_id, correctie_reden, gecorrigeerd_door) VALUES (%s,%s,'P-3',%s,'tikfout',%s)",
          (reg, gs["GS-A"], gid, pl), "MES-correctiebevoegdheid")
    con.execute("UPDATE gebruiker SET rol='pending' WHERE id=%s", (mes_corrector,))
    con.execute("INSERT INTO grondstof_gebruik (stapregistratie_id, grondstof_id, partij, vervangt_id, correctie_reden, gecorrigeerd_door) VALUES (%s,%s,'P-3',%s,'tikfout',%s)",
                (reg, gs["GS-A"], gid, mes_corrector))
    check("Correctie door ploegleider: actuele partij is P-3",
          val("SELECT partij FROM grondstof_gebruik_actueel WHERE stapregistratie_id = %s", (reg,)) == "P-3")
    faalt("PS1 herhalen zonder herbewerking", "SELECT start_stap('PS1', %s, NULL, %s, %s)", (b[0], pc, op), "al doorlopen")

    doorloop(b[0], 2, 15)
    for x in b[1:3]:
        doorloop(x)
    # Batch 4 met een afwijkend gewicht en druk in PS3.
    doorloop(b[3], 1, 2)
    reg = val("SELECT start_stap('PS3', %s, NULL, %s, %s)", (b[3], pc, op))
    vul_in(reg, 3, {"S3.2": (None, 452), "S3.3": (5, 5.6)})
    con.execute("SELECT rond_stap_af(%s)", (reg,))
    check("Markering: gewicht 452 kg (max 440) = buiten grens",
          val("SELECT markering FROM waarde WHERE stapregistratie_id=%s AND veld_id=%s", (reg, veld["S3.2"])) == "buiten_grens")
    check("Markering: druk 5,6 bij setting 5 (tol 10%) = buiten tolerantie",
          val("SELECT markering FROM waarde WHERE stapregistratie_id=%s AND veld_id=%s", (reg, veld["S3.3"])) == "buiten_tolerantie")
    doorloop(b[3], 4, 14)  # PS15 nog niet gedaan

    print("\nLot samenstellen (PS16)")
    faalt("Lot met 3 batches", "SELECT maak_lot('L-2026-0001', %s, %s, %s)", (b[:3], pc, op), "precies 4")
    faalt("Lot met batch die PS15 nog niet afrondde",
          "SELECT maak_lot('L-2026-0001', %s, %s, %s)", (b[:4], pc, op), "B-2026-0004: PS15 niet afgerond")

    print("\nAfkeur")
    doorloop(b[4], 1, 15)
    faalt("Operator-account mag geen besluit vastleggen",
          "INSERT INTO batch_besluit (batch_id, besluit, reden, besloten_door) VALUES (%s,'in_beoordeling','twijfel',%s)",
          (b[4], op_account), "MES-blokkeerbevoegdheid")
    faalt("D101 oude kwaliteitsrol zonder grant mag geen batch blokkeren",
          "INSERT INTO batch_besluit(batch_id,besluit,reden,besloten_door) VALUES (%s,'in_beoordeling','test',%s)",
          (b[4],kw),"MES-blokkeerbevoegdheid")
    faalt("Keurresultaat zonder eerst in beoordeling",
          "INSERT INTO batch_besluit (batch_id, besluit, reden, besloten_door) VALUES (%s,'afgekeurd','x',%s)",
          (b[4], mes_quality_decider), "in beoordeling")
    con.execute("INSERT INTO batch_besluit (batch_id, besluit, reden, besloten_door) VALUES (%s,'in_beoordeling','kleur wijkt af',%s)", (b[4], mes_corrector))
    faalt("Batch in beoordeling kan niet in een lot",
          "SELECT maak_lot('L-2026-0001', %s, %s, %s)", ([b[0], b[1], b[2], b[4]], pc, op), "status in_beoordeling")
    faalt("Ploegleider mag geen keurresultaat invoeren",
          "INSERT INTO batch_besluit (batch_id, besluit, reden, besloten_door) VALUES (%s,'afgekeurd','x',%s)",
          (b[4], mes_corrector), "MES-batchbeslisbevoegdheid")
    faalt("Beheerder mag geen keurresultaat invoeren",
          "INSERT INTO batch_besluit (batch_id, besluit, reden, besloten_door) VALUES (%s,'vrijgegeven','x',%s)",
          (b[4], bh), "MES-batchbeslisbevoegdheid")
    con.execute("INSERT INTO batch_besluit (batch_id, besluit, reden, besloten_door) VALUES (%s,'afgekeurd','NOK: afvoeren',%s)", (b[4], mes_quality_decider))
    check("Afgekeurde batch heeft status afgekeurd", val("SELECT status FROM batch WHERE id=%s", (b[4],)) == "afgekeurd")
    faalt("Afgekeurde batch kan niet meer vrijgegeven worden",
          "INSERT INTO batch_besluit (batch_id, besluit, reden, besloten_door) VALUES (%s,'vrijgegeven','x',%s)",
          (b[4], mes_quality_decider), "geen besluit meer")
    # Kwaliteit mag ook in beoordeling zetten; OK geeft de batch weer vrij.
    doorloop(b[5], 1, 1)
    con.execute("INSERT INTO batch_besluit (batch_id, besluit, reden, besloten_door) VALUES (%s,'in_beoordeling','steekproef',%s)", (b[5], mes_quality_decider))
    faalt("Batch in beoordeling kan niet naar de volgende stap", "SELECT start_stap('PS2', %s, NULL, %s, %s)", (b[5], pc, op), "in_beoordeling")
    con.execute("INSERT INTO batch_besluit (batch_id, besluit, reden, besloten_door) VALUES (%s,'vrijgegeven','OK',%s)", (b[5], mes_quality_decider))
    check("Keurresultaat OK: batch weer in productie", val("SELECT status FROM batch WHERE id=%s", (b[5],)) == "in_productie")
    reg2 = val("SELECT start_stap('PS2', %s, NULL, %s, %s)", (b[5], pc, op))
    check("Na OK kan de batch door naar de volgende stap", reg2 is not None)
    # NOK terwijl PS2 open staat: die stap wordt afgebroken.
    con.execute("INSERT INTO batch_besluit (batch_id, besluit, reden, besloten_door) VALUES (%s,'in_beoordeling','tweede steekproef',%s)", (b[5], mes_corrector))
    con.execute("INSERT INTO batch_besluit (batch_id, besluit, reden, besloten_door) VALUES (%s,'afgekeurd','vervuild',%s)", (b[5], mes_quality_decider))
    st, reden, eind = one("SELECT status, reden, afgerond_op FROM stapregistratie WHERE id=%s", (reg2,))
    check("NOK sluit de open stap af als afgebroken", st == "afgebroken" and reden == "Batch afgekeurd: vervuild" and eind is not None, f"{st} {reden}")
    faalt("Afgebroken stap kan niet meer worden afgerond", "SELECT rond_stap_af(%s)", (reg2,), "al afgerond")
    faalt("Geen waarden in een afgebroken stap",
          "INSERT INTO waarde (stapregistratie_id, veld_id, setting, gemeten, ingevoerd_door) VALUES (%s,%s,80,81,%s)",
          (reg2, veld["S2.1"], op), "al afgerond")
    check("Gegevens afgekeurde batch blijven bewaard",
          val("SELECT count(*) FROM stapregistratie WHERE batch_id=%s", (b[4],)) == 15)

    print("\nLot en lotstappen")
    doorloop(b[3], 15, 15)
    lot = val("SELECT maak_lot('L-2026-0001', %s, %s, %s)", (b[:4], pc, op))
    check("4 batches staan in het lot", val("SELECT count(*) FROM batch WHERE lot_id=%s AND status='in_lot'", (lot,)) == 4)
    faalt("Batch kan niet in een tweede lot",
          "SELECT maak_lot('L-2026-0002', %s, %s, %s)", ([b[0], b[1], b[2], b[5]], pc, op), "status in_lot")
    faalt("Batch in lot kan geen batchstap meer doen",
          "SELECT start_stap('PS15', %s, NULL, %s, %s)", (b[0], pc, op), "status in_lot")
    ps16 = val("SELECT r.id FROM stapregistratie r JOIN processtap s ON s.id=r.processtap_id WHERE r.lot_id=%s AND s.code='PS16'", (lot,))
    faalt("PS16 kan niet nog eens handmatig gestart worden",
          "SELECT start_stap('PS16', NULL, %s, %s, %s)", (lot, pc, op), "staat nog open")
    faalt("PS17 voordat PS16 is afgerond", "SELECT start_stap('PS17', NULL, %s, %s, %s)", (lot, pc, op), "PS16 moet eerst afgerond")
    vul_in(ps16, 16)
    con.execute("SELECT rond_stap_af(%s)", (ps16,))
    r17 = val("SELECT start_stap('PS17', NULL, %s, %s, %s)", (lot, pc, op)); vul_in(r17, 17); con.execute("SELECT rond_stap_af(%s)", (r17,))
    r18 = val("SELECT start_stap('PS18', NULL, %s, %s, %s)", (lot, pc, op)); vul_in(r18, 18, {"S18.3": (None, 5.1)}); con.execute("SELECT rond_stap_af(%s)", (r18,))
    check("Lot is gereed na PS18", val("SELECT status FROM lot WHERE id=%s", (lot,)) == "gereed")
    check("Vochtgehalte 5,1% (max 4,0) = buiten grens",
          val("SELECT markering FROM waarde WHERE stapregistratie_id=%s AND veld_id=%s", (r18, veld["S18.3"])) == "buiten_grens")

    print("\nHerbewerking")
    faalt("PS18 herhalen zonder herbewerking", "SELECT start_stap('PS18', NULL, %s, %s, %s)", (lot, pc, op), "al doorlopen")
    faalt("Herbewerking zonder reden",
          "SELECT start_herbewerking(%s, 'PS17', '', %s, %s)", (lot, pc, op), "check")
    faalt("Herbewerking naar een batchstap", "SELECT start_herbewerking(%s, 'PS10', 'x', %s, %s)", (lot, pc, op), "lot-stap")
    faalt("Opdrachtloze herbewerking geweigerd","SELECT start_herbewerking(%s, 'PS17', 'te nat na verpakken', %s, %s)",(lot,pc,op),"Vooraf geregistreerde")
    check("Geweigerde herbewerking laat lot gereed",val("SELECT status FROM lot WHERE id=%s",(lot,))=="gereed")
    rework_approver = mes_quality_decider
    first_order = val("SELECT maak_herbewerking((SELECT lotnummer FROM lot WHERE id=%s),'PS17','te nat na verpakken',%s)",(lot,rework_approver))
    faalt("Afwijkende reden bij opdracht geweigerd","SELECT start_herbewerking(%s,'PS17','andere reden',%s,%s)",(lot,pc,op),"Vooraf geregistreerde")
    # De historische fictieve Operator A krijgt geen impliciete MES-rechten.
    faalt("Operator zonder actuele uitvoeringsbevoegdheid geweigerd",
          "SELECT start_herbewerking(%s,'PS17','te nat na verpakken',%s,%s)",(lot,pc,op),"uitvoeringsbevoegdheid")
    check("Geweigerde uitvoering consumeert opdracht niet",
          val("SELECT status FROM herbewerking WHERE id=%s",(first_order,))=="open")
    # Expliciete fixturegrant door eigenaar, uitsluitend voor deze fictieve test.
    rework_fixture_user = val("SELECT gebruiker_id FROM operator WHERE id=%s",(op,))
    con.execute("INSERT INTO authorization_grant(user_id,role_code) VALUES (%s,'operator')",(rework_fixture_user,))
    h17 = val("SELECT start_herbewerking(%s, 'PS17', 'te nat na verpakken', %s, %s)", (lot, pc, op))
    check("Vooraf bestaande opdracht gekoppeld",val("SELECT stapregistratie_id FROM herbewerking WHERE id=%s",(first_order,))==h17)
    check("Herbewerking zet het lot terug in productie", val("SELECT status FROM lot WHERE id=%s", (lot,)) == "in_productie")
    check("Herbewerking PS17 is poging 2", val("SELECT poging FROM stapregistratie WHERE id=%s", (h17,)) == 2)
    faalt("PS18 voordat herbewerkte PS17 is afgerond", "SELECT start_stap('PS18', NULL, %s, %s, %s)", (lot, pc, op), "PS17 moet eerst afgerond")
    vul_in(h17, 17, {"S17.1": (95, 94.2)}); con.execute("SELECT rond_stap_af(%s)", (h17,))
    h18 = val("SELECT start_stap('PS18', NULL, %s, %s, %s)", (lot, pc, op))
    check("Na herbewerking doorloopt het lot PS18 opnieuw (poging 2)", val("SELECT poging FROM stapregistratie WHERE id=%s", (h18,)) == 2)
    vul_in(h18, 18, {"S18.3": (None, 3.6)}); con.execute("SELECT rond_stap_af(%s)", (h18,))
    check("Na herbewerkte PS18 is het lot weer gereed", val("SELECT status FROM lot WHERE id=%s", (lot,)) == "gereed")

    print("\nCertificaat")
    faalt("Certificaat door een planner kan niet",
          "INSERT INTO certificaat (lot_id, inhoud, uitgegeven_door) VALUES (%s, '{}', (SELECT id FROM gebruiker WHERE gebruikersnaam = 'planner1'))",
          (lot,), "Alleen Kwaliteit")
    cid = val("INSERT INTO certificaat (lot_id, inhoud, uitgegeven_door) VALUES (%s, '{\"a\": 1}', %s) RETURNING id", (lot, kw))
    check("Certificaat door Kwaliteit voor een gereed lot", cid is not None)
    faalt("Certificaat wijzigen kan niet", "UPDATE certificaat SET inhoud = '{}' WHERE id = %s", (cid,), "niet gewijzigd")

    print("\nCorrecties")
    w_oud = val("SELECT id FROM waarde WHERE stapregistratie_id=%s AND veld_id=%s", (h18, veld["S18.2"]))
    faalt("Waarde wijzigen kan niet", "UPDATE waarde SET gemeten = 1 WHERE id=%s", (w_oud,), "correctie")
    faalt("Stapregistratie verwijderen kan niet", "DELETE FROM stapregistratie WHERE id=%s", (h18,), "niet verwijderd")
    faalt("Operator-account mag niet corrigeren",
          "INSERT INTO waarde (stapregistratie_id, veld_id, gemeten, vervangt_waarde_id, correctie_reden, gecorrigeerd_door) VALUES (%s,%s,1650,%s,'tikfout',%s)",
          (h18, veld["S18.2"], w_oud, op_account), "MES-correctiebevoegdheid")
    faalt("D101 oude beheerder zonder inhoudelijke MES-grant corrigeert niet",
          "INSERT INTO waarde (stapregistratie_id, veld_id, gemeten, vervangt_waarde_id, correctie_reden, gecorrigeerd_door) VALUES (%s,%s,1650,%s,'tikfout',%s)",
          (h18, veld["S18.2"], w_oud, bh), "MES-correctiebevoegdheid")
    faalt("Correctie zonder reden",
          "INSERT INTO waarde (stapregistratie_id, veld_id, gemeten, vervangt_waarde_id, correctie_reden, gecorrigeerd_door) VALUES (%s,%s,1650,%s,'',%s)",
          (h18, veld["S18.2"], w_oud, mes_corrector), "check")
    con.execute("INSERT INTO waarde (stapregistratie_id, veld_id, gemeten, vervangt_waarde_id, correctie_reden, gecorrigeerd_door) VALUES (%s,%s,1650,%s,'tikfout',%s)",
                (h18, veld["S18.2"], w_oud, mes_corrector))
    check("Actuele waarde is de correctie", val("SELECT gemeten FROM waarde_actueel WHERE stapregistratie_id=%s AND veld_id=%s", (h18, veld["S18.2"])) == 1650)
    check("Origineel blijft opvraagbaar", val("SELECT gemeten FROM waarde WHERE id=%s", (w_oud,)) == 1640)

    print("\nConfiguratie")
    faalt("Veldcode kan niet veranderen", "UPDATE veld SET code='S1.9' WHERE code='S1.1'", (), "mag niet veranderen")
    faalt("Veld verwijderen kan niet", "DELETE FROM veld WHERE code='S1.1'", (), "inactief")
    con.execute("SELECT set_config('fabriek.gebruiker', 'beheerder1', false)")
    con.execute("UPDATE veld SET tolerantie = 8 WHERE code='S1.1'")
    check("Grenswijziging staat in het logboek",
          val("SELECT gewijzigd_door FROM config_log WHERE tabel='veld' AND record_id=%s ORDER BY id DESC LIMIT 1", (veld["S1.1"],)) == "[niet persoonlijk bewezen]")
    check("Onbewezen audit heeft geen persoonlijke ID",
          one("SELECT actor_origin, actor_user_id FROM config_log WHERE tabel='veld' AND record_id=%s ORDER BY id DESC LIMIT 1", (veld["S1.1"],)) == ("unverified", None))
    faalt("Persoonlijke audit vereist een stabiele ID",
          "INSERT INTO config_log(tabel,record_id,actie,actor_origin) VALUES ('test',gen_random_uuid(),'INSERT','personal')", (), "config_log_actor_origin_check")
    check("Oude meting houdt de tolerantie van toen (5)",
          val("SELECT tolerantie FROM waarde WHERE veld_id=%s ORDER BY ingevoerd_op LIMIT 1", (veld["S1.1"],)) == 5)

    print("\nBeheer en logboek")
    con.execute("UPDATE gebruiker SET wachtwoord_hash = public.crypt('nieuw-ww', public.gen_salt('bf')) WHERE gebruikersnaam = 'analist1'")
    log = one("SELECT nieuw FROM config_log WHERE tabel = 'gebruiker' ORDER BY id DESC LIMIT 1")[0]
    check("Wachtwoordwijziging gelogd zonder hash", log.get("wachtwoord") == "gewijzigd" and "wachtwoord_hash" not in log)
    # D101: oude rol is geen beschikbaarheidsvoorwaarde. Eigenaar-fixture
    # deactiveert legacy-identiteiten zonder historische records te verwijderen.
    # MES-grant blijft onafhankelijk van legacy-rol; rollback bewaart fixtures.
    con.execute("BEGIN")
    try:
        con.execute("UPDATE gebruiker SET rol='pending' WHERE gebruikersnaam='mes.system'")
        check("System Administrator zonder legacy beheerdersrol behoudt expliciete MES-bevoegdheid",
              val("SELECT authorization_permits(id,'system.read',NULL,NULL,NULL) FROM gebruiker WHERE gebruikersnaam='mes.system'"))
        con.execute("UPDATE gebruiker SET actief=false WHERE rol='beheerder'")
        check("Geen actieve legacy-beheerder vereist",
              val("SELECT count(*) FROM gebruiker WHERE rol='beheerder' AND actief") == 0)
        check("Oude beheerdersidentiteit historisch behouden",
              val("SELECT count(*) FROM gebruiker WHERE gebruikersnaam='beheerder1'") == 1)
        check("MES-technische bevoegdheid blijft beschikbaar zonder legacy-beheerder",
              val("SELECT authorization_permits(id,'system.read',NULL,NULL,NULL) FROM gebruiker WHERE gebruikersnaam='mes.system'"))
    finally:
        con.execute("ROLLBACK")
    faalt("Gebruikersnaam verandert niet", "UPDATE gebruiker SET gebruikersnaam = 'x' WHERE gebruikersnaam = 'analist1'", (), "verandert niet")
    pc2 = val("SELECT id FROM pc WHERE naam = 'PC-02'")
    ps1 = val("SELECT id FROM processtap WHERE code = 'PS1'")
    con.execute("INSERT INTO pc_stap (pc_id, processtap_id) VALUES (%s, %s)", (pc2, ps1))
    con.execute("DELETE FROM pc_stap WHERE pc_id = %s", (pc2,))
    check("Koppeling pc en stap: toevoegen en verwijderen gelogd",
          val("SELECT count(*) FROM config_log WHERE tabel = 'pc_stap' AND record_id = %s", (pc2,)) == 2)
    faalt("Operator verwijderen kan niet", "DELETE FROM operator WHERE naam = 'Operator H'", (), "inactief")

    print("\nLotpaspoort")
    rijen = val("SELECT count(*) FROM lotpaspoort WHERE lotnummer='L-2026-0001'")
    # 4 batches x (15 stappen x 2 velden + S3.3 + S7.3); PS16-PS18 (2+2+3); herbewerkte PS17+PS18 (2+3)
    verwacht = 4 * (15 * 2 + 2) + (2 + 2 + 3) + (2 + 3)
    check(f"Lotpaspoort bevat alle actuele waarden ({rijen})", rijen == verwacht, f"verwacht {verwacht}")
    afw = con.execute("""SELECT batch_of_lot, stap, poging, veld, markering FROM lotpaspoort
                          WHERE lotnummer='L-2026-0001' AND markering <> 'ok' ORDER BY volgorde, batch_of_lot""").fetchall()
    for r in afw:
        print("       afwijking:", r)
    check("Lotpaspoort toont de 4 ingebouwde afwijkingen", len(afw) == 4, str(len(afw)))

    print("\nPloegen en overdracht")
    check("03:00 hoort bij de nachtploeg van de dag ervoor",
          one("SELECT code, dag::text FROM ploeg_van('2026-11-19 03:00')") == ("N", "2026-11-18"))
    check("14:00 is het begin van de middagploeg", val("SELECT code FROM ploeg_van('2026-11-19 14:00')") == "M")
    check("De database staat op de tijdzone van de fabriek",
          val("""SELECT EXISTS (SELECT 1 FROM unnest(s.setconfig) c WHERE lower(c) = lower('timezone=' || fabriekstijdzone())) FROM pg_db_role_setting s
                  JOIN pg_database d ON d.oid = s.setdatabase WHERE d.datname = current_database() AND s.setrole = 0""") is True)
    con.execute("SET timezone = 'UTC'")
    check("Ook met UTC begint de nachtploeg om 22:00 Nederlandse tijd",
          one("SELECT code, to_char(begin_op AT TIME ZONE 'Europe/Amsterdam', 'HH24:MI') FROM ploeg_van('2026-11-19 21:30+00')") == ("N", "22:00"))
    con.execute("SET timezone = 'Europe/Amsterdam'")
    check("Wintertijdnacht: 05:30 hoort bij de nachtploeg, die 9 uur duurt",
          one("SELECT code, extract(epoch FROM eind_op - begin_op)/3600 FROM ploeg_van('2026-10-25 05:30+01')") == ("N", 9))
    check("Zomertijdnacht: de nachtploeg duurt 7 uur en eindigt om 06:00",
          one("SELECT code, extract(epoch FROM eind_op - begin_op)/3600, to_char(eind_op, 'HH24:MI') FROM ploeg_van('2026-03-29 05:30+02')") == ("N", 7, "06:00"))
    check("Zomertijdnacht: 06:30 is de ochtendploeg", val("SELECT code FROM ploeg_van('2026-03-29 06:30+02')") == "O")
    ploeg = val("SELECT id FROM ploeg WHERE code = 'O'")
    faalt("Lege overdracht kan niet",
          "INSERT INTO overdracht (dag, ploeg_id, bijzonderheden, gebruiker_id) VALUES ('2026-11-19', %s, '  ', %s)", (ploeg, pl), "check")
    oid = val("INSERT INTO overdracht (dag, ploeg_id, aandachtspunten, gebruiker_id) VALUES ('2026-11-19', %s, 'Menger 2 trilt', %s) RETURNING id", (ploeg, pl))
    faalt("Overdracht wijzigen kan niet", "UPDATE overdracht SET aandachtspunten = 'x' WHERE id = %s", (oid,), "niet gewijzigd")

    print("\nStilstand")
    ps5 = val("SELECT id FROM processtap WHERE code = 'PS5'")
    mach = val("SELECT id FROM stilstand_oorzaak WHERE code = 'STOR-MACH'")
    sid = val("INSERT INTO stilstand (processtap_id, oorzaak_id, toelichting, pc_id, operator_id, gemeld_door) VALUES (%s,%s,'lager',%s,%s,%s) RETURNING id",
              (ps5, mach, pc, op, pl))
    check("Storing geeft een melding voor de ploegleider",
          val("SELECT voor_rollen FROM melding WHERE bron_id = %s", (sid,)) == ["ploegleider"])
    faalt("Tweede lopende stilstand in dezelfde stap",
          "INSERT INTO stilstand (processtap_id, oorzaak_id, gemeld_door) VALUES (%s,%s,%s)", (ps5, mach, pl), "stilstand_een_lopend")
    faalt("Oorzaak achteraf wijzigen kan niet", "UPDATE stilstand SET toelichting = 'x' WHERE id = %s", (sid,), "alleen het einde")
    faalt("Einde voor het begin kan niet", "UPDATE stilstand SET eind_op = begin_op - interval '1 minute' WHERE id = %s", (sid,), "check")
    faalt("Notitie zonder einde kan niet (#31)", "UPDATE stilstand SET eind_notitie = 'lager vervangen' WHERE id = %s", (sid,), "hoort bij het einde")
    faalt("Notitie met spaties eromheen kan niet", "UPDATE stilstand SET eind_op = now(), eind_notitie = ' x ' WHERE id = %s", (sid,), "check")
    faalt("Notitie langer dan 500 tekens kan niet", "UPDATE stilstand SET eind_op = now(), eind_notitie = repeat('x', 501) WHERE id = %s", (sid,), "check")
    con.execute("UPDATE stilstand SET eind_op = begin_op + interval '20 minutes', eind_notitie = 'lager vervangen' WHERE id = %s", (sid,))
    check("Notitie wordt samen met het einde bewaard", val("SELECT eind_notitie FROM stilstand WHERE id = %s", (sid,)) == "lager vervangen")
    faalt("Notitie achteraf wijzigen kan niet", "UPDATE stilstand SET eind_notitie = 'iets anders' WHERE id = %s", (sid,), "al beëindigd")
    faalt("Einde twee keer invullen kan niet", "UPDATE stilstand SET eind_op = now() WHERE id = %s", (sid,), "al beëindigd")
    faalt("Stilstand verwijderen kan niet", "DELETE FROM stilstand WHERE id = %s", (sid,), "niet verwijderd")

    print("\nGeweigerde invoer en instellingen van het pilotoverzicht (#77)")
    con.execute("SELECT leg_weigering_vast(%s, NULL, gen_random_uuid(), '', 999, repeat('x', 900), '  ', repeat('B', 60))", (pc,))
    g = con.execute("SELECT pc_id, operator_id, pad, status, char_length(fout), stapcode, char_length(batchnummer) FROM geweigerde_invoer ORDER BY id DESC LIMIT 1").fetchone()
    check("Vastleggen mislukt nooit: onbekende operator leeg, teksten ingekort, status begrensd",
          g[0] == pc and g[1] is None and g[2] == "?" and g[3] == 599 and g[4] == 500 and g[5] is None and g[6] == 40)
    faalt("Geweigerde invoer wijzigen kan niet", "UPDATE geweigerde_invoer SET fout = 'x'", (), "niet gewijzigd")
    faalt("Minder dan 30 dagen bewaren kan niet", "SELECT ruim_weigeringen_op(7)", (), "minstens 30 dagen")
    faalt("Te laat na 0 minuten kan niet", "INSERT INTO instelling (sleutel, waarde) VALUES ('te_laat_minuten', '0')", (), "instelling_pilot")
    faalt("Startdatum moet een datum zijn", "INSERT INTO instelling (sleutel, waarde) VALUES ('pilot_start', 'morgen')", (), "instelling_pilot")
    con.execute("INSERT INTO instelling (sleutel, waarde) VALUES ('pilot_start', '') ON CONFLICT (sleutel) DO UPDATE SET waarde = ''")
    check("Geen startdatum (leeg) mag", val("SELECT waarde FROM instelling WHERE sleutel = 'pilot_start'") == "")

    print("\nTijdstip van het apparaat (offline invoer)")
    def met_moment(moment, sql, p=()):
        """Voer sql uit zoals de API: in een transactie met fabriek.moment."""
        with con.transaction():
            con.execute("SELECT set_config('fabriek.moment', %s, true)", (moment,))
            r = con.execute(sql, p)
            return r.fetchone()[0] if r.description else None
    nu = val("SELECT clock_timestamp()")
    check("Zonder moment geldt de servertijd", abs((val("SELECT apparaat_moment()") - nu).total_seconds()) < 5)
    bid = val("INSERT INTO batch (batchnummer, aangemaakt_door) VALUES ('B-2026-9001', %s) RETURNING id", (op,))
    twee_uur = (nu - dt.timedelta(hours=2)).isoformat()
    reg = met_moment(twee_uur, "SELECT start_stap('PS1', %s, NULL, %s, %s)", (bid, pc, op))
    g, ontv = one("SELECT gestart_op, gestart_ontvangen_op FROM stapregistratie WHERE id = %s", (reg,))
    check("Start krijgt het moment van de pc (2 uur geleden)", abs((g - (nu - dt.timedelta(hours=2))).total_seconds()) < 1, str(g))
    check("Aankomst op de server apart bewaard", ontv - g > dt.timedelta(minutes=110), str(ontv))
    een_uur = (nu - dt.timedelta(hours=1)).isoformat()
    for code in sorted(c for c in veld if c.startswith("S1.")):
        setting, gemeten = (80, 81.5) if code.endswith(".1") else (None, 410)
        met_moment(een_uur, "INSERT INTO waarde (stapregistratie_id, veld_id, setting, gemeten, ingevoerd_door) VALUES (%s,%s,%s,%s,%s)",
                   (reg, veld[code], setting, gemeten, op))
    if "PS1" in stap_gs:
        met_moment(een_uur, "INSERT INTO grondstof_gebruik (stapregistratie_id, grondstof_id, partij, ingevoerd_door) VALUES (%s,%s,'LEV-TEST-01',%s)",
                   (reg, stap_gs["PS1"], op))
    check("Meetwaarde krijgt het moment van de pc",
          val("SELECT bool_and(abs(extract(epoch FROM ingevoerd_op - %s::timestamptz)) < 1) FROM waarde WHERE stapregistratie_id = %s", (een_uur, reg)))
    met_moment((nu - dt.timedelta(hours=3)).isoformat(), "SELECT rond_stap_af(%s)", (reg,))
    a_op, a_ontv = one("SELECT afgerond_op, afgerond_ontvangen_op FROM stapregistratie WHERE id = %s", (reg,))
    check("Afronden vóór het starten wordt het starttijdstip", a_op == g, str(a_op))
    check("Aankomst van het afronden bewaard", a_ontv is not None and a_ontv > a_op)
    reg2 = met_moment((nu - dt.timedelta(hours=5)).isoformat(), "SELECT start_stap('PS2', %s, NULL, %s, %s)", (bid, pc, op))
    check("Volgende stap start niet vóór het afronden van de vorige",
          val("SELECT gestart_op FROM stapregistratie WHERE id = %s", (reg2,)) == a_op)
    morgen = (nu + dt.timedelta(days=1)).isoformat()
    check("Een moment in de toekomst (klok vooruit) wordt de servertijd",
          abs((met_moment(morgen, "SELECT apparaat_moment()") - nu).total_seconds()) < 60)
    check("Een moment van meer dan 7 dagen geleden wordt de servertijd",
          abs((met_moment((nu - dt.timedelta(days=8)).isoformat(), "SELECT apparaat_moment()") - nu).total_seconds()) < 60)
    check("Een onleesbaar moment wordt de servertijd",
          abs((met_moment("gisteren", "SELECT apparaat_moment()") - nu).total_seconds()) < 60)

    print("\nPlanning: stand van de vorige stap (D52)")
    stap = {code: sid for code, sid in con.execute("SELECT code, id FROM processtap")}
    pl_acc = val("SELECT id FROM gebruiker WHERE gebruikersnaam = 'planner1'")
    vandaag = val("SELECT current_date")
    morgen_d, overmorgen_d = vandaag + dt.timedelta(days=1), vandaag + dt.timedelta(days=2)
    gisteren_d = vandaag - dt.timedelta(days=1)
    nr = val("SELECT plan_batches(1, %s, NULL, NULL, %s)", (morgen_d, pl_acc))
    pb = val("SELECT id FROM batch WHERE batchnummer = %s", (nr,))

    def vorige(code, dag, batch=None, lot=None):
        return one("SELECT stand, vorige, dag, nr FROM planning_vorige_stap(%s, %s, %s, %s)", (stap[code], batch or pb, lot, dag))

    check("Eerste stap heeft geen vorige stap", vorige("PS1", morgen_d)[0] == "eerste")
    r = vorige("PS2", morgen_d)
    check("PS2 op de startdag: vorige stap dezelfde dag (startdag uit de weekplanning)", r[0] == "vandaag" and r[1] == "PS1" and r[3] == 1, str(r))
    check("PS2 vóór de startdag: vorige stap pas later gepland", vorige("PS2", vandaag)[0] == "later")
    r = vorige("PS2", overmorgen_d)
    check("PS2 na de startdag die nog moet komen: in orde (eerder)", r[0] == "eerder" and r[2] == morgen_d, str(r))
    check("PS3 terwijl PS2 nergens gepland is: niet gepland", vorige("PS3", overmorgen_d)[0] == "niet_gepland")
    con.execute("INSERT INTO stapplanning (dag, processtap_id, batch_id, volgorde, aangemaakt_door) VALUES (%s,%s,%s,3,%s)",
                (overmorgen_d, stap["PS2"], pb, pl_acc))
    r = vorige("PS3", overmorgen_d)
    check("PS3 op dezelfde dag als de geplande PS2: vandaag, met de plek in de volgorde", r[0] == "vandaag" and r[3] == 3, str(r))
    con.execute("INSERT INTO stapplanning (dag, processtap_id, batch_id, volgorde, aangemaakt_door) VALUES (%s,%s,%s,1,%s)",
                (gisteren_d, stap["PS3"], pb, pl_acc))
    r = vorige("PS4", vandaag)
    check("PS4 vandaag terwijl PS3 gisteren gepland stond en niet klaar is: achter", r[0] == "achter" and r[2] == gisteren_d, str(r))
    los = nieuwe_batch("B-2026-0961")
    check("Ongeplande batch zonder PS1: niet gepland", vorige("PS2", vandaag, batch=los)[0] == "niet_gepland")
    reg = val("SELECT start_stap('PS1', %s, NULL, %s, %s)", (los, pc, op))
    check("PS1 staat open: bezig", vorige("PS2", vandaag, batch=los)[0] == "bezig")
    vul_in(reg, 1)
    con.execute("SELECT rond_stap_af(%s)", (reg,))
    check("PS1 afgerond: klaar", vorige("PS2", gisteren_d, batch=los)[0] == "klaar")
    lot_id = val("SELECT id FROM lot LIMIT 1")
    if lot_id:
        check("Eerste stap na het lot: vorige stap (lot samenstellen) is klaar", vorige("PS17", vandaag, batch=None, lot=lot_id)[0] == "klaar")
    con.execute("DELETE FROM stapplanning WHERE batch_id = %s", (pb,))

    print("\nEigen inlog per persoon (D53)")
    gedeeld = val("SELECT id FROM gebruiker WHERE gebruikersnaam = 'operator'")
    acc_a = val("SELECT id FROM gebruiker WHERE gebruikersnaam = 'operator.a'")
    acc_b = val("SELECT id FROM gebruiker WHERE gebruikersnaam = 'operator.b'")
    op_a = val("SELECT id FROM operator WHERE naam = 'Operator A'")
    op_b = val("SELECT id FROM operator WHERE naam = 'Operator B'")
    op_c = val("SELECT id FROM operator WHERE naam = 'Operator C'")
    pc1 = val("SELECT id FROM pc WHERE naam = 'PC-01'")
    pc2 = val("SELECT id FROM pc WHERE naam = 'PC-02'")
    check("Gedeeld account heeft geen eigen naam", val("SELECT operator_van_account(%s)", (gedeeld,)) is None)
    check("Eigen account geeft zijn gekoppelde naam", val("SELECT operator_van_account(%s)", (acc_a,)) == op_a)
    pl_op = val("SELECT operator_van_account(%s)", (pl,))
    check("Ploegleider zonder naam krijgt er een, met de gebruikersnaam",
          val("SELECT naam FROM operator WHERE id = %s", (pl_op,)) == "ploegleider1")
    check("Daarna steeds dezelfde naam", val("SELECT operator_van_account(%s)", (pl,)) == pl_op)
    check("Tweede keer dezelfde naam, geen nieuwe", val("SELECT count(*) FROM operator WHERE gebruiker_id = %s", (pl,)) == 1)
    check("Planner heeft geen operatornaam", val("SELECT operator_van_account((SELECT id FROM gebruiker WHERE gebruikersnaam = 'planner1'))") is None)
    check("Eigen naam: mag", val("SELECT mag_invoeren_namens(%s, %s, %s)", (acc_a, op_a, pc1)))
    check("Naam van een ander zonder inlog op deze pc: mag niet", not val("SELECT mag_invoeren_namens(%s, %s, %s)", (acc_a, op_b, pc1)))
    con.execute("SELECT * FROM inloggen('operator.b', 'demo', 'PC-01')")
    check("Eerdere login B geeft A geen bevoegdheid", not val("SELECT mag_invoeren_namens(%s, %s, %s)", (acc_a, op_b, pc1)))
    check("Maar niet vanaf een andere pc", not val("SELECT mag_invoeren_namens(%s, %s, %s)", (acc_a, op_b, pc2)))
    check("Gedeeld account mag geen naam gebruiken", not val("SELECT mag_invoeren_namens(%s, %s, %s)", (gedeeld, op_c, pc2)))
    check("Andere operator op deze pc: mag niet", not val("SELECT mag_invoeren_namens(%s, %s, %s)", (acc_a, op_c, pc2)))
    con.execute("SELECT * FROM inloggen('operator', 'demo', 'PC-02')")
    check("Gedeelde eerdere login verleent geen bevoegdheid",
          not val("SELECT mag_invoeren_namens(%s, %s, %s)", (acc_a, op_c, pc2)))
    con.execute("UPDATE gebruiker SET actief = false WHERE id = %s", (acc_b,))
    check("Uitgezet account heeft geen naam meer", val("SELECT operator_van_account(%s)", (acc_b,)) is None)
    con.execute("UPDATE gebruiker SET actief = true WHERE id = %s", (acc_b,))

    print("\nRoute per product (D55)")
    prd = {c: i for c, i in con.execute("SELECT code, id FROM product")}
    sid = {c: i for c, i in con.execute("SELECT code, id FROM processtap")}

    def routecodes(p):
        return [r[0] for r in con.execute(
            "SELECT s.code FROM route(%s) r JOIN processtap s ON s.id = r.processtap_id ORDER BY r.plek", (p,))]
    check("Zonder product: alle 18 processtappen, geen keuringsstappen (#80)", routecodes(None) == [f"PS{i}" for i in range(1, 19)])
    check("PRD-A zonder eigen route volgt de standaardroute", routecodes(prd["PRD-A"]) == routecodes(None))
    route_c = ["PS1", "PS2", "PS3", "PS4", "PS5", "PS7", "PS8", "PS9", "PS11", "PS10", "PS12", "PS13", "PS15", "PS16", "PS18"]
    route_c_keuring = route_c[:3] + ["TK1"] + route_c[3:8] + ["TK2"] + route_c[8:] + ["EK"]
    check("PRD-C: eigen volgorde (PS11 vóór PS10), zonder PS6, PS14 en PS17, met keuringsstappen", routecodes(prd["PRD-C"]) == route_c_keuring, routecodes(prd["PRD-C"]))
    # De regels hieronder zijn van vóór de keuringsstappen; die komen onderaan (#80).
    con.execute("SELECT zet_route(%s, %s)", (prd["PRD-C"], route_c))
    faalt("Route zonder lotstap", "SELECT zet_route(%s, ARRAY['PS1','PS2'])", (prd["PRD-A"],), "lotstap PS16")
    faalt("Route met de lotstap vóór een batchstap", "SELECT zet_route(%s, ARRAY['PS1','PS16','PS2'])", (prd["PRD-A"],), "eerst de batchstappen")
    faalt("Route met een lotstap vóór de lotstap", "SELECT zet_route(%s, ARRAY['PS1','PS17','PS16'])", (prd["PRD-A"],), "eerst de batchstappen")
    faalt("Route zonder batchstap", "SELECT zet_route(%s, ARRAY['PS16','PS17'])", (prd["PRD-A"],), "minstens één batchstap")
    faalt("Route met een onbekende stap", "SELECT zet_route(%s, ARRAY['PS1','PS99','PS16'])", (prd["PRD-A"],), "Onbekende")
    faalt("Route met een stap twee keer", "SELECT zet_route(%s, ARRAY['PS1','PS1','PS16'])", (prd["PRD-A"],), "twee keer")
    check("Na een geweigerde route nog steeds de standaardroute", routecodes(prd["PRD-A"]) == routecodes(None))

    def batch_met(nr, product):
        return val("INSERT INTO batch (batchnummer, aangemaakt_door, product_id) VALUES (%s, %s, %s) RETURNING id", (nr, op, product))

    def doe(b, code, lot=None):
        reg = val("SELECT start_stap(%s, %s, %s, %s, %s)", (code, b, lot, pc, op))
        vul_in(reg, int(code[2:]))
        con.execute("SELECT rond_stap_af(%s)", (reg,))

    def voorraad(code):
        return {r[0] for r in con.execute("SELECT nummer FROM werkvoorraad(%s)", (code,))}

    c = [batch_met(f"B-2026-07{i:02d}", prd["PRD-C"]) for i in range(1, 5)]
    for code in route_c[:8]:
        doe(c[0], code)
    faalt("PRD-C: PS6 hoort niet bij de route", "SELECT start_stap('PS6', %s, NULL, %s, %s)", (c[0], pc, op), "hoort niet bij de route van product PRD-C")
    faalt("PRD-C: PS10 kan niet vóór PS11", "SELECT start_stap('PS10', %s, NULL, %s, %s)", (c[0], pc, op), "PS11 moet eerst afgerond")
    check("Werkvoorraad PS11 volgt de route (na PS9)", "B-2026-0701" in voorraad("PS11") and "B-2026-0701" not in voorraad("PS10"))
    check("Werkvoorraad PS6 toont geen PRD-C-batches", not any(n.startswith("B-2026-07") for n in voorraad("PS6")))
    for code in route_c[8:13]:
        doe(c[0], code)
    check("Klaar voor een lot na de batchstappen van de eigen route", val("SELECT batch_klaar_voor_lot(%s)", (c[0],)))
    check("Werkvoorraad PS16 bevat de batch", "B-2026-0701" in voorraad("PS16"))
    v = one("SELECT stand, vorige FROM planning_vorige_stap(%s, %s, NULL, current_date)", (sid["PS6"], c[1]))
    check("Planning: PS6 voor een PRD-C-batch = niet in de route", v[0] == "niet_in_route" and v[1] == "PRD-C", v)
    v = one("SELECT stand, vorige FROM planning_vorige_stap(%s, %s, NULL, current_date)", (sid["PS10"], c[1]))
    check("Planning: de vorige stap van PS10 is bij PRD-C PS11", v[1] == "PS11", v)
    for b in c[1:]:
        for code in route_c[:13]:
            doe(b, code)
    zonder = batch_met("B-2026-0705", None)
    doorloop(zonder, 1, 15)
    faalt("Lot van verschillende producten", "SELECT maak_lot('L-2026-0701', %s, %s, %s)", (c[:3] + [zonder], pc, op), "hetzelfde product")
    lot_c = val("SELECT maak_lot('L-2026-0701', %s, %s, %s)", (c, pc, op))
    reg = val("SELECT id FROM stapregistratie WHERE lot_id = %s AND status = 'open'", (lot_c,))
    vul_in(reg, 16)
    con.execute("SELECT rond_stap_af(%s)", (reg,))
    check("Werkvoorraad: het lot slaat PS17 over", "L-2026-0701" not in voorraad("PS17") and "L-2026-0701" in voorraad("PS18"))
    faalt("PRD-C-lot: PS17 hoort niet bij de route", "SELECT start_stap('PS17', NULL, %s, %s, %s)", (lot_c, pc, op), "hoort niet bij de route")
    doe(None, "PS18", lot_c)
    check("Lot gereed na de laatste lotstap van zijn route (PS18)", val("SELECT status FROM lot WHERE id = %s", (lot_c,)) == "gereed")
    pl_acc2 = val("SELECT id FROM gebruiker WHERE gebruikersnaam = 'planner1'")
    nrs = [r[0] for r in con.execute("SELECT plan_batches(3, current_date + 5, %s, NULL, %s)", (prd["PRD-B"], pl_acc2))]
    gepl = [val("SELECT id FROM batch WHERE batchnummer = %s", (n,)) for n in nrs]
    nr_a = val("SELECT plan_batches(1, current_date + 5, %s, NULL, %s)", (prd["PRD-A"], pl_acc2))
    gepl_a = val("SELECT id FROM batch WHERE batchnummer = %s", (nr_a,))
    faalt("Lotvoorstel van verschillende producten", "SELECT bewaar_lot_voorstel(NULL, %s, NULL, %s)", (gepl + [gepl_a], pl_acc2), "hetzelfde product")
    con.execute("UPDATE batch SET product_id = %s WHERE id = %s", (prd["PRD-B"], gepl_a))
    con.execute("SELECT bewaar_lot_voorstel(NULL, %s, NULL, %s)", (gepl + [gepl_a], pl_acc2))
    faalt("Product wijzigen van een batch in een open lotvoorstel", "UPDATE batch SET product_id = %s WHERE id = %s",
          (prd["PRD-A"], gepl_a), "open lotvoorstel")
    con.execute("SELECT zet_route(%s, NULL)", (prd["PRD-C"],))
    check("Route leegmaken = standaardroute", routecodes(prd["PRD-C"]) == routecodes(None))
    check("Routewijzigingen staan in het logboek",
          val("SELECT count(*) FROM config_log WHERE tabel = 'product_stap' AND record_id = %s", (prd["PRD-C"],)) >= 15)

    print("\nGrenzen per product (D55)")
    def markering_van(reg, code):
        return one("""SELECT markering, grens_min::float, grens_max::float, tolerantie::float FROM waarde
                       WHERE stapregistratie_id = %s AND veld_id = %s""", (reg, veld[code]))
    con.execute("SELECT zet_route(%s, %s)", (prd["PRD-C"], route_c))  # weer de eigen route (hierboven leeggemaakt)
    gc = batch_met("B-2026-0711", prd["PRD-C"])
    for code in ["PS1", "PS2", "PS3", "PS4", "PS5", "PS7", "PS8"]:
        doe(gc, code)
    reg9 = val("SELECT start_stap('PS9', %s, NULL, %s, %s)", (gc, pc, op))
    check("Registratie onthoudt het product", val("SELECT product_id FROM stapregistratie WHERE id = %s", (reg9,)) == prd["PRD-C"])
    vul_in(reg9, 9, {"S9.2": (None, 455)})
    m = markering_van(reg9, "S9.2")
    check("PRD-C: 455 kg in PS9 is binnen de eigen grens (400-460)", m[0] == "ok" and m[1:3] == (400.0, 460.0), m)
    ga = batch_met("B-2026-0712", prd["PRD-A"])
    doorloop(ga, 1, 8)
    reg9a = val("SELECT start_stap('PS9', %s, NULL, %s, %s)", (ga, pc, op))
    vul_in(reg9a, 9, {"S9.2": (None, 455)})
    check("PRD-A: 455 kg is buiten de grens van het veld (380-440)", markering_van(reg9a, "S9.2")[0] == "buiten_grens")
    gb = batch_met("B-2026-0713", prd["PRD-B"])
    doorloop(gb, 1, 4)
    reg5b = val("SELECT start_stap('PS5', %s, NULL, %s, %s)", (gb, pc, op))
    vul_in(reg5b, 5, {"S5.1": (80, 84)})
    check("PRD-B: 4 graden verschil is buiten de eigen tolerantie (3)", markering_van(reg5b, "S5.1")[0] == "buiten_tolerantie")
    reg5a = val("SELECT id FROM stapregistratie WHERE batch_id = %s AND processtap_id = %s", (ga, sid["PS5"]))
    con.execute("""INSERT INTO waarde (stapregistratie_id, veld_id, setting, gemeten, vervangt_waarde_id, correctie_reden, gecorrigeerd_door)
                   SELECT stapregistratie_id, veld_id, 80, 84, id, 'tikfout', %s FROM waarde_actueel WHERE stapregistratie_id = %s AND veld_id = %s""",
                (mes_corrector, reg5a, veld["S5.1"]))
    check("PRD-A: 4 graden verschil is binnen de tolerantie van het veld (5)",
          val("SELECT markering FROM waarde_actueel WHERE stapregistratie_id = %s AND veld_id = %s", (reg5a, veld["S5.1"])) == "ok")
    faalt("Tolerantie per product bij een gewicht", "INSERT INTO veld_product (veld_id, product_id, tolerantie) VALUES (%s, %s, 1)",
          (veld["S9.2"], prd["PRD-A"]), "procesparameter")
    faalt("Ondergrens boven bovengrens per product", "INSERT INTO veld_product (veld_id, product_id, grens_min, grens_max) VALUES (%s, %s, 10, 5)",
          (veld["S9.2"], prd["PRD-A"]), "check")
    con.execute("UPDATE veld_product SET grens_max = 470 WHERE veld_id = %s AND product_id = %s", (veld["S9.2"], prd["PRD-C"]))
    check("Gewijzigde grens per product geldt niet voor eerdere metingen", markering_van(reg9, "S9.2")[2] == 460.0)
    con.execute("DELETE FROM veld_product WHERE veld_id = %s AND product_id = %s", (veld["S9.2"], prd["PRD-C"]))
    check("Weghalen: daarna gelden de grenzen van het veld",
          one("SELECT grens_min::float, grens_max::float FROM grenzen_van(%s, %s)", (veld["S9.2"], prd["PRD-C"])) == (380.0, 440.0))
    check("Grenzen per product staan in het logboek",
          val("SELECT count(*) FROM config_log WHERE tabel = 'veld_product' AND actie = 'DELETE'") == 1)

    print("\nCapaciteit per stap en product (D55)")
    check("PS1: 8 per dag voor PRD-A, 3 voor PRD-B",
          val("SELECT capaciteit_stap_voor(%s, %s)", (sid["PS1"], prd["PRD-A"])) == 8 and val("SELECT capaciteit_stap_voor(%s, %s)", (sid["PS1"], prd["PRD-B"])) == 3)
    check("PS2: nog niet ingevuld", val("SELECT capaciteit_stap_voor(%s, %s)", (sid["PS2"], prd["PRD-A"])) is None)
    faalt("Geen regel meer voor alle producten (D71)", "INSERT INTO capaciteit_stap (processtap_id, max_per_dag) VALUES (%s, 5)", (sid["PS2"],), "null")
    faalt("Twee regels voor hetzelfde product in één stap", "INSERT INTO capaciteit_stap (processtap_id, product_id, max_per_dag) VALUES (%s, %s, 5)", (sid["PS1"], prd["PRD-A"]), "unique")
    faalt("Capaciteit 0", "INSERT INTO capaciteit_stap (processtap_id, product_id, max_per_dag) VALUES (%s, %s, 0)", (sid["PS2"], prd["PRD-A"]), "check")
    check("Elke stap uit de route staat in capaciteit_route; PRD-B zonder PS12 (#81)",
          val("SELECT count(*) FROM capaciteit_route WHERE product_id = %s", (prd["PRD-A"],)) == val("SELECT count(*) FROM route(%s)", (prd["PRD-A"],))
          and val("SELECT count(*) FROM capaciteit_route WHERE product_id = %s AND processtap_id = %s", (prd["PRD-B"], sid["PS12"])) == 0)
    check("Zonder capaciteit: nog invullen (NULL)",
          val("SELECT max_per_dag FROM capaciteit_route WHERE product_id = %s AND processtap_id = %s", (prd["PRD-A"], sid["PS2"])) is None
          and val("SELECT max_per_dag FROM capaciteit_route WHERE product_id = %s AND processtap_id = %s", (prd["PRD-C"], sid["PS1"])) == 8)

    print("\nAfwijkende capaciteit per product en stap (D69)")
    afdag = val("SELECT current_date + 40")
    def cap_op(stap, product, dag=None):
        return val("SELECT capaciteit_stap_op(%s, %s, %s)", (sid[stap], prd[product] if product else None, dag or afdag))
    con.execute("INSERT INTO capaciteit_afwijking (van, tot, product_id, procent, reden) VALUES (%s, %s + 1, %s, 0, 'onderhoud lijn 2')", (afdag, afdag, prd["PRD-B"]))
    con.execute("INSERT INTO capaciteit_afwijking (van, tot, processtap_id, procent, reden) VALUES (%s, %s, %s, 50, 'korte dag')", (afdag, afdag, sid["PS1"]))
    check("PRD-B die dag dicht (0 %), ook in een stap zonder capaciteit", cap_op("PS1", "PRD-B") == 0 and cap_op("PS2", "PRD-B") == 0)
    check("PS1 voor PRD-A: 50 % van 8 = 4", cap_op("PS1", "PRD-A") == 4)
    check("Laagste percentage telt bij twee regels", val("SELECT procent FROM capaciteit_afwijking_voor(%s, %s, %s)", (sid["PS1"], prd["PRD-B"], afdag)) == 0)
    check("Stap zonder capaciteit en zonder dicht: niet ingesteld", cap_op("PS2", "PRD-A") is None)
    check("Dag erna: alleen PRD-B dicht, PS1 weer 8", cap_op("PS1", "PRD-A", val("SELECT current_date + 41")) == 8 and cap_op("PS1", "PRD-B", val("SELECT current_date + 41")) == 0)
    con.execute("INSERT INTO capaciteit_afwijking (van, tot, processtap_id, product_id, procent, reden) VALUES (current_date + 45, current_date + 45, %s, %s, 10, 'storing')", (sid["PS1"], prd["PRD-B"]))
    check("Naar beneden afgerond, maar minstens 1 (10 % van 3)", cap_op("PS1", "PRD-B", val("SELECT current_date + 45")) == 1)
    faalt("Tot vóór van", "INSERT INTO capaciteit_afwijking (van, tot, procent, reden) VALUES (%s, %s - 1, 0, 'fout')", (afdag, afdag), "check")
    faalt("Meer dan 100 %", "INSERT INTO capaciteit_afwijking (van, tot, procent, reden) VALUES (%s, %s, 120, 'fout')", (afdag, afdag), "check")
    faalt("Zonder reden", "INSERT INTO capaciteit_afwijking (van, tot, procent, reden) VALUES (%s, %s, 0, ' ')", (afdag, afdag), "check")
    faalt("Afwijking verwijderen kan niet (uitzetten wel)", "DELETE FROM capaciteit_afwijking", (), "inactief")
    con.execute("UPDATE capaciteit_afwijking SET actief = false")
    check("Uitgezet: weer de gewone capaciteit", cap_op("PS1", "PRD-B") == 3 and cap_op("PS1", "PRD-A") == 4 * 2)
    capdag = val("SELECT current_date + 20")
    na = [r[0] for r in con.execute("SELECT plan_batches(2, %s, %s, NULL, %s)", (capdag, prd["PRD-A"], pl_acc2))]
    nb = [r[0] for r in con.execute("SELECT plan_batches(1, %s, %s, NULL, %s)", (capdag, prd["PRD-B"], pl_acc2))]
    def belasting(stap, dag):
        return {r[0]: r[1:] for r in con.execute(
            "SELECT coalesce(p.code, '-'), aantal, van_week, max_per_dag FROM stap_belasting(%s, %s) b LEFT JOIN product p ON p.id = b.product_id",
            (sid[stap], dag))}
    check("Weekplanning telt mee in de eerste stap", belasting("PS1", capdag) == {"PRD-A": (2, 2, 8), "PRD-B": (1, 1, 3)}, belasting("PS1", capdag))
    con.execute("""INSERT INTO stapplanning (dag, processtap_id, batch_id, volgorde, aangemaakt_door)
                   SELECT %s, %s, id, 1, %s FROM batch WHERE batchnummer = %s""", (capdag, sid["PS1"], pl_acc2, nb[0]))
    check("Een batch die ook in de stapplanning staat, telt één keer", belasting("PS1", capdag)["PRD-B"] == (1, 0, 3))
    con.execute("""INSERT INTO stapplanning (dag, processtap_id, batch_id, volgorde, aangemaakt_door)
                   SELECT %s, %s, id, 1, %s FROM batch WHERE batchnummer = %s""", (capdag, sid["PS9"], pl_acc2, na[0]))
    check("Andere stap: alleen de stapplanning, met de regel voor alle producten", belasting("PS9", capdag) == {"PRD-A": (1, 0, 6)})
    check("Vervallen batch telt niet mee", (con.execute("UPDATE batch SET status = 'vervallen', vervallen_reden = 'test' WHERE batchnummer = %s", (na[1],)) and
          belasting("PS1", capdag)["PRD-A"] == (1, 1, 8)))

    print("\nHerbewerking met opdracht (#61)")
    pm = val("SELECT id FROM gebruiker WHERE gebruikersnaam = 'mes.manager'")
    hb = batch_met("B-2026-0801", prd["PRD-A"])
    for k in range(1, 7):
        doe(hb, f"PS{k}")
    faalt("Ploegleider maakt geen herbewerking aan", "SELECT maak_herbewerking('B-2026-0801', 'PS3', 'kleur', %s)", (pl,), "MES-herbewerkingsbevoegdheid")
    faalt("D101 oude productiemanager zonder grant maakt geen opdracht",
          "SELECT maak_herbewerking('B-2026-0801','PS3','test',%s)",
          (val("SELECT id FROM gebruiker WHERE gebruikersnaam='productiemanager1'"),),"MES-herbewerkingsbevoegdheid")
    faalt("Herbewerking naar een stap die nog niet doorlopen is", "SELECT maak_herbewerking('B-2026-0801', 'PS8', 'x', %s)", (pm,), "nog niet doorlopen")
    faalt("Batch naar een lotstap", "SELECT maak_herbewerking('B-2026-0801', 'PS17', 'x', %s)", (pm,), "geen batchstap")
    faalt("Herbewerking zonder reden", "SELECT maak_herbewerking('B-2026-0801', 'PS3', '  ', %s)", (pm,), "reden")
    h = val("SELECT maak_herbewerking('B-2026-0801', 'PS3', 'kleur wijkt af na PS6', %s)", (pm,))
    stand = lambda: val("SELECT stand FROM herbewerking_stand WHERE id = %s", (h,))
    check("Nieuwe herbewerking: te plannen", stand() == "te_plannen", stand())
    check("Melding voor vloer, planner, Kwaliteit en productiemanager",
          val("SELECT voor_rollen FROM melding WHERE bron_id = %s", (h,)) == ["ploegleider", "planner", "kwaliteit", "productiemanager"])
    faalt("Tweede open herbewerking voor dezelfde batch", "SELECT maak_herbewerking('B-2026-0801', 'PS4', 'x', %s)", (mes_quality_decider,), "al een herbewerking")
    check("Batch staat in de werkvoorraad van PS3", "B-2026-0801" in voorraad("PS3"))
    check("... en niet meer in die van PS7", "B-2026-0801" not in voorraad("PS7"))
    faalt("Een andere stap starten kan niet", "SELECT start_stap('PS7', %s, NULL, %s, %s)", (hb, pc, op), "eerst terug naar stap PS3")
    vandaag = val("SELECT current_date")
    con.execute("INSERT INTO stapplanning (dag, processtap_id, batch_id, volgorde, aangemaakt_door) VALUES (%s, %s, %s, 1, %s)",
                (vandaag, sid["PS3"], hb, pl_acc2))
    plan_id = val("SELECT id FROM stapplanning WHERE batch_id = %s AND processtap_id = %s", (hb, sid["PS3"]))
    check("Ingepland: stand gepland", stand() == "gepland")
    check("Planning per stap: gepland (niet 'gedaan' door de eerste keer PS3)", val("SELECT plan_stand(%s)", (plan_id,)) == "gepland")
    # De operator start gewoon PS3 (zoals een ouder invoerscherm): dat wordt de herbewerking.
    r3 = val("SELECT start_stap('PS3', %s, NULL, %s, %s)", (hb, pc, op))
    check("Gewone start wordt de herbewerking, met de reden", one("SELECT herbewerking_start, reden, poging FROM stapregistratie WHERE id = %s", (r3,)) == (True, "kleur wijkt af na PS6", 2))
    check("Herbewerking gestart: bezig", stand() == "bezig")
    check("Planning per stap: bezig", val("SELECT plan_stand(%s)", (plan_id,)) == "bezig")
    vul_in(r3, 3); con.execute("SELECT rond_stap_af(%s)", (r3,))
    check("Na PS3: PS4 opnieuw in de werkvoorraad", "B-2026-0801" in voorraad("PS4"))
    check("... en PS7 nog niet", "B-2026-0801" not in voorraad("PS7"))
    faalt("PS5 overslaan kan niet", "SELECT start_stap('PS5', %s, NULL, %s, %s)", (hb, pc, op), "PS4 moet eerst afgerond")
    for k in range(4, 7):
        doe(hb, f"PS{k}")
    check("Na PS4 t/m PS6 opnieuw: verder met PS7", "B-2026-0801" in voorraad("PS7"))
    for k in range(7, 16):
        doe(hb, f"PS{k}")
    check("Klaar met de batchstappen: herbewerking klaar en batch klaar voor een lot", stand() == "klaar" and val("SELECT batch_klaar_voor_lot(%s)", (hb,)))
    # Kwaliteit: herbewerken als keurresultaat van een batch in beoordeling.
    hb2 = batch_met("B-2026-0802", prd["PRD-A"])
    for k in range(1, 4):
        doe(hb2, f"PS{k}")
    con.execute("INSERT INTO batch_besluit (batch_id, besluit, reden, besloten_door) VALUES (%s,'in_beoordeling','druk te laag',%s)", (hb2, pm))
    faalt("Batch in beoordeling: productiemanager kan blokkade niet omzeilen", "SELECT maak_herbewerking('B-2026-0802', 'PS2', 'x', %s)", (pm,), "Kwaliteitsblokkade")
    faalt("Ook Kwaliteit kan blokkade niet via herbewerking opheffen", "SELECT maak_herbewerking('B-2026-0802', 'PS2', 'opnieuw mengen', %s)", (mes_quality_decider,), "Kwaliteitsblokkade")
    check("Blokkade en besluit blijven behouden",
          val("SELECT besluit FROM batch_besluit WHERE batch_id = %s ORDER BY besloten_op DESC LIMIT 1", (hb2,)) == "in_beoordeling"
          and val("SELECT status FROM batch WHERE id = %s", (hb2,)) == "in_beoordeling")
    check("Geen opdracht ontstaan tijdens blokkade", val("SELECT count(*) FROM herbewerking WHERE batch_id=%s",(hb2,)) == 0)
    # Afzonderlijk eigenaar-fixturebesluit; de bevestigde API-route wordt elders getest.
    con.execute("INSERT INTO batch_besluit(batch_id,besluit,reden,besloten_door) VALUES (%s,'vrijgegeven','afzonderlijk kwaliteitsbesluit',%s)",(hb2,mes_quality_decider))
    h2 = val("SELECT maak_herbewerking('B-2026-0802', 'PS2', 'opnieuw mengen', %s)", (mes_quality_decider,))
    faalt("Intrekken zonder reden", "SELECT trek_herbewerking_in(%s, '', %s)", (h2, mes_quality_decider), "reden")
    con.execute("SELECT trek_herbewerking_in(%s, 'toch niet nodig', %s)", (h2, mes_quality_decider))
    check("Ingetrokken: batch gaat gewoon verder met PS4", val("SELECT stand FROM herbewerking_stand WHERE id = %s", (h2,)) == "ingetrokken" and "B-2026-0802" in voorraad("PS4"))
    faalt("Intrekken kan maar één keer", "SELECT trek_herbewerking_in(%s, 'x', %s)", (h2, mes_quality_decider), "al gestart of ingetrokken")
    h3 = val("SELECT maak_herbewerking('B-2026-0802', 'PS1', 'grondstof verkeerd', %s)", (pm,))
    con.execute("INSERT INTO batch_besluit (batch_id, besluit, reden, besloten_door) VALUES (%s,'in_beoordeling','toch afkeuren',%s)", (hb2, mes_quality_decider))
    con.execute("INSERT INTO batch_besluit (batch_id, besluit, reden, besloten_door) VALUES (%s,'afgekeurd','afvoeren',%s)", (hb2, mes_quality_decider))
    check("Batch afgekeurd: open herbewerking vervalt", val("SELECT stand FROM herbewerking_stand WHERE id = %s", (h3,)) == "ingetrokken")
    # Lot: opdracht vooraf; de oude functie zonder opdracht blijft werken (oudere invoerschermen, D18).
    faalt("Batch die in een lot zit", "SELECT maak_herbewerking((SELECT batchnummer FROM batch WHERE lot_id = %s LIMIT 1), 'PS3', 'x', %s)", (lot, mes_quality_decider), "zit al in een lot")
    hl = val("SELECT maak_herbewerking((SELECT lotnummer FROM lot WHERE id = %s), 'PS17', 'opnieuw drogen', %s)", (lot, mes_quality_decider))
    check("Lot: herbewerking te plannen, lot staat in de werkvoorraad van PS17", val("SELECT stand FROM herbewerking_stand WHERE id = %s", (hl,)) == "te_plannen"
          and val("SELECT lotnummer FROM lot WHERE id = %s", (lot,)) in voorraad("PS17"))
    rl = val("SELECT start_herbewerking(%s, 'PS17', 'opnieuw drogen', %s, %s)", (lot, pc, op))
    check("Start via de oude functie koppelt aan de opdracht", val("SELECT stapregistratie_id FROM herbewerking WHERE id = %s", (hl,)) == rl)
    check("Geen nieuwe opdrachtloze herbewerking",
          val("SELECT count(*) FROM herbewerking_stand WHERE lot_id = %s AND door IS NULL", (lot,)) == 0)

    print("\nKeuring door Kwaliteit (#64)")
    con.execute("UPDATE veld SET gemeten_door = 'kwaliteit' WHERE code IN ('S18.3', 'S5.2')")
    kw_op = val("SELECT operator_van_account(id) FROM gebruiker WHERE gebruikersnaam='mes.quality'")
    check("Kwaliteit heeft een naam voor de invoer", kw_op is not None)
    kb = batch_met("B-2026-0971", prd["PRD-A"])
    for k in range(1, 5):
        doe(kb, f"PS{k}")
    r5 = val("SELECT start_stap('PS5', %s, NULL, %s, %s)", (kb, pc, op))
    faalt("Operator vult een veld van Kwaliteit niet in",
          "INSERT INTO waarde (stapregistratie_id, veld_id, gemeten, ingevoerd_door) VALUES (%s,%s,410,%s)", (r5, veld["S5.2"], op), "meet Kwaliteit")
    con.execute("INSERT INTO waarde (stapregistratie_id, veld_id, setting, gemeten, ingevoerd_door) VALUES (%s,%s,80,81,%s)", (r5, veld["S5.1"], op))
    con.execute("SELECT rond_stap_af(%s)", (r5,))
    check("Afronden kan zonder de meting van Kwaliteit", val("SELECT status FROM stapregistratie WHERE id = %s", (r5,)) == "afgerond")
    k5 = val("SELECT id FROM keuring WHERE stapregistratie_id = %s", (r5,))
    check("Na afronden wacht de stap op Kwaliteit, met een melding", k5 is not None
          and val("SELECT count(*) FROM melding WHERE bron_id = %s AND 'kwaliteit' = ANY(voor_rollen)", (k5,)) == 1)
    check("Volgende stap nog niet in de werkvoorraad", "B-2026-0971" not in voorraad("PS6"))
    check("... en PS5 ook niet opnieuw", "B-2026-0971" not in voorraad("PS5"))
    faalt("PS6 starten kan niet", "SELECT start_stap('PS6', %s, NULL, %s, %s)", (kb, pc, op), "Wacht op Kwaliteit")
    faalt("D101 oude kwaliteitsrol zonder grant beslist niet over keuring",
          "SELECT beslis_keuring(%s,'vrijgegeven',NULL,%s)",(k5,kw),"MES-keuringsbeslisbevoegdheid")
    faalt("Vrijgeven zonder meting", "SELECT beslis_keuring(%s, 'vrijgegeven', NULL, %s)", (k5, mes_quality_decider), "Nog niet gemeten: S5.2")
    faalt("Ploegleider beslist niet over een keuring", "SELECT beslis_keuring(%s, 'vrijgegeven', NULL, %s)", (k5, pl), "MES-keuringsbeslisbevoegdheid")
    con.execute("INSERT INTO waarde (stapregistratie_id, veld_id, gemeten, ingevoerd_door) VALUES (%s,%s,412,%s)", (r5, veld["S5.2"], kw_op))
    check("Kwaliteit meet na het afronden", val("SELECT count(*) FROM waarde WHERE stapregistratie_id = %s AND veld_id = %s", (r5, veld["S5.2"])) == 1)
    con.execute("SELECT beslis_keuring(%s, 'vrijgegeven', NULL, %s)", (k5, mes_quality_decider))
    con.execute("SELECT beslis_keuring(%s, 'vrijgegeven', NULL, %s)", (k5, mes_quality_decider))
    check("Vrijgegeven (twee keer versturen mag): PS6 in de werkvoorraad", "B-2026-0971" in voorraad("PS6"))
    faalt("Na de vrijgave meet Kwaliteit niet meer zonder correctie",
          "INSERT INTO waarde (stapregistratie_id, veld_id, gemeten, ingevoerd_door) VALUES (%s,%s,1,%s)", (r5, veld["S5.1"], kw_op), "")
    # Herbewerken: terug naar PS5.
    doe(kb, "PS6"); doe(kb, "PS7")
    kb2 = batch_met("B-2026-0972", prd["PRD-A"])
    for k in range(1, 5):
        doe(kb2, f"PS{k}")
    r5b = val("SELECT start_stap('PS5', %s, NULL, %s, %s)", (kb2, pc, op))
    con.execute("INSERT INTO waarde (stapregistratie_id, veld_id, setting, gemeten, ingevoerd_door) VALUES (%s,%s,80,81,%s)", (r5b, veld["S5.1"], op))
    con.execute("SELECT rond_stap_af(%s)", (r5b,))
    k5b = val("SELECT id FROM keuring WHERE stapregistratie_id = %s", (r5b,))
    con.execute("INSERT INTO waarde (stapregistratie_id, veld_id, gemeten, ingevoerd_door) VALUES (%s,%s,470,%s)", (r5b, veld["S5.2"], kw_op))
    faalt("Herbewerken zonder reden", "SELECT beslis_keuring(%s, 'herbewerken', '', %s)", (k5b, mes_quality_decider), "reden")
    con.execute("SELECT beslis_keuring(%s, 'herbewerken', 'te zwaar', %s, 'PS5')", (k5b, mes_quality_decider))
    check("Herbewerken: opdracht terug naar PS5, batch staat daar klaar",
          val("SELECT stand FROM herbewerking_stand WHERE id = (SELECT herbewerking_id FROM keuring WHERE id = %s)", (k5b,)) == "te_plannen"
          and "B-2026-0972" in voorraad("PS5") and "B-2026-0972" not in voorraad("PS6"))
    r5c = val("SELECT start_stap('PS5', %s, NULL, %s, %s)", (kb2, pc, op))
    con.execute("INSERT INTO waarde (stapregistratie_id, veld_id, setting, gemeten, ingevoerd_door) VALUES (%s,%s,80,80.5,%s)", (r5c, veld["S5.1"], op))
    con.execute("SELECT rond_stap_af(%s)", (r5c,))
    k5c = val("SELECT id FROM keuring WHERE stapregistratie_id = %s", (r5c,))
    check("De herbewerkte stap wacht opnieuw op Kwaliteit", k5c is not None and k5c != k5b)
    # Afkeuren: keurresultaat NOK.
    con.execute("SELECT beslis_keuring(%s, 'afgekeurd', 'veel te zwaar', %s)", (k5c, mes_quality_decider))
    check("Afkeuren: batch afgekeurd, met in beoordeling ervoor",
          val("SELECT status FROM batch WHERE id = %s", (kb2,)) == "afgekeurd"
          and [r[0] for r in con.execute("SELECT besluit FROM batch_besluit WHERE batch_id = %s ORDER BY besloten_op", (kb2,))][-2:] == ["in_beoordeling", "afgekeurd"])
    # Lot: na PS18 pas gereed na de vrijgave.
    lots = {r[0]: r[1] for r in con.execute("SELECT lotnummer, id FROM lot WHERE status = 'gereed'")}
    lk = next(iter(lots.values()))
    hk = val("SELECT maak_herbewerking((SELECT lotnummer FROM lot WHERE id = %s), 'PS18', 'opnieuw meten', %s)", (lk, mes_quality_decider))
    r18k = val("SELECT start_stap('PS18', NULL, %s, %s, %s)", (lk, pc, op))
    for code in ("S18.1", "S18.2"):
        con.execute("INSERT INTO waarde (stapregistratie_id, veld_id, setting, gemeten, ingevoerd_door) VALUES (%s,%s,%s,%s,%s)",
                    (r18k, veld[code], 80 if soort[code] == "procesparameter" else None, 81 if code.endswith(".1") else 1640, op))
    con.execute("SELECT rond_stap_af(%s)", (r18k,))
    check("Lot na PS18 nog niet gereed: wacht op Kwaliteit", val("SELECT status FROM lot WHERE id = %s", (lk,)) == "in_productie")
    k18 = val("SELECT id FROM keuring WHERE stapregistratie_id = %s", (r18k,))
    con.execute("INSERT INTO waarde (stapregistratie_id, veld_id, gemeten, ingevoerd_door) VALUES (%s,%s,3.1,%s)", (r18k, veld["S18.3"], kw_op))
    con.execute("SELECT beslis_keuring(%s, 'vrijgegeven', 'droog genoeg', %s)", (k18, mes_quality_decider))
    check("Na de vrijgave is het lot gereed", val("SELECT status FROM lot WHERE id = %s", (lk,)) == "gereed")

    print("\nEen gestarte stap overnemen (#55)")
    ob = val("SELECT id FROM operator WHERE naam = 'Operator B'")
    pc2 = val("SELECT id FROM pc WHERE naam = 'PC-02'")
    bo = nieuwe_batch("B-2026-0973")
    ro = val("SELECT start_stap('PS1', %s, NULL, %s, %s)", (bo, pc, op))
    vul_in(ro, 1)
    con.execute("SELECT rond_stap_af(%s, %s, %s)", (ro, ob, pc2))
    check("Operator B rondt op PC-02 af wat Operator A op PC-01 startte",
          con.execute("""SELECT r.status = 'afgerond' AND o.naam = 'Operator A' AND a.naam = 'Operator B' AND p.naam = 'PC-02'
                           FROM stapregistratie r JOIN operator o ON o.id = r.operator_id
                           JOIN operator a ON a.id = r.afgerond_door JOIN pc p ON p.id = r.afgerond_pc_id
                          WHERE r.id = %s""", (ro,)).fetchone()[0])
    faalt("Afgerond door kan daarna niet meer veranderen",
          "UPDATE stapregistratie SET afgerond_door = %s WHERE id = %s", (op, ro), "kan niet meer veranderen")

    print("\nNainvoeren na papier (#75)")
    import json
    con.execute("UPDATE veld SET gemeten_door = 'productie' WHERE processtap_id IN (SELECT id FROM processtap WHERE soort = 'proces')")   # de keuringstest hierboven zette velden op Kwaliteit
    pl = val("SELECT id FROM gebruiker WHERE gebruikersnaam = 'ploegleider1'")
    opa = val("SELECT id FROM gebruiker WHERE gebruikersnaam = 'operator.a'")
    bn = nieuwe_batch("B-2026-0974")
    nu = val("SELECT clock_timestamp()")
    w1 = json.dumps([{"veldcode": "S1.1", "setting": 80, "gemeten": 81}, {"veldcode": "S1.2", "gemeten": 410}])
    g1 = json.dumps([{"code": "GS-A", "partij": "LEV-PAPIER-01", "hoeveelheid": 120}])
    na = "SELECT lever_stap_na(%s, %s, NULL, %s, %s, %s, %s, %s, %s, %s, %s)"
    faalt("Een operator kan niet nainvoeren", na,
          ("PS1", "B-2026-0974", pc, op, nu - dt.timedelta(hours=3), nu - dt.timedelta(hours=2), "storing", opa, w1, g1), "MES-bevoegdheid")
    faalt("D101 oude ploegleider zonder grant kan niet nainvoeren", na,
          ("PS1", "B-2026-0974", pc, op, nu - dt.timedelta(hours=3), nu - dt.timedelta(hours=2), "storing", pl, w1, g1), "MES-bevoegdheid")
    faalt("D101 oude beheerder zonder grant kan niet nainvoeren", na,
          ("PS1", "B-2026-0974", pc, op, nu - dt.timedelta(hours=3), nu - dt.timedelta(hours=2), "storing", bh, w1, g1), "MES-bevoegdheid")
    faalt("Zonder reden kan niet", na,
          ("PS1", "B-2026-0974", pc, op, nu - dt.timedelta(hours=3), nu - dt.timedelta(hours=2), "  ", mes_corrector, w1, g1), "reden")
    faalt("Meer dan 7 dagen terug kan niet", na,
          ("PS1", "B-2026-0974", pc, op, nu - dt.timedelta(days=8), nu - dt.timedelta(days=8, hours=-1), "storing", mes_corrector, w1, g1), "7 dagen")
    faalt("Einde in de toekomst kan niet", na,
          ("PS1", "B-2026-0974", pc, op, nu - dt.timedelta(hours=1), nu + dt.timedelta(hours=1), "storing", mes_corrector, w1, g1), "toekomst")
    faalt("Einde vóór het begin kan niet", na,
          ("PS1", "B-2026-0974", pc, op, nu - dt.timedelta(hours=1), nu - dt.timedelta(hours=2), "storing", mes_corrector, w1, g1), "na het begin")
    # De eerdere kwalificatietest heeft voor execution.record een fictieve
    # opleiding verplicht gemaakt. Toets die eis ook bij papieren nalevering,
    # en geef uitsluitend deze testidentiteit de passende fictieve kwalificatie.
    check("D101 supervisor zonder vereiste kwalificatie mag niet registreren",
          not val("SELECT authorization_permits(%s,'execution.record',NULL,(SELECT product_id FROM batch WHERE id=%s),NULL)", (mes_corrector,bn)))
    faalt("D101 papieren nalevering zonder kwalificatie geweigerd", na,
          ("PS1", "B-2026-0974", pc, op, nu - dt.timedelta(hours=3), nu - dt.timedelta(hours=2), "storing", mes_corrector, w1, g1), "MES-bevoegdheid")
    con.execute("INSERT INTO personnel_qualification(user_id,qualification_code) VALUES (%s,'test_training')", (mes_corrector,))
    for permission in ("execution.correct","execution.start","execution.record","execution.complete","execution.lot.create"):
        check("D101 bevoegde gekwalificeerde supervisor: "+permission,
              val("SELECT authorization_permits(%s,%s,NULL,(SELECT product_id FROM batch WHERE id=%s),NULL)", (mes_corrector,permission,bn)))
    rn = val(na, ("PS1", "B-2026-0974", pc, op, nu - dt.timedelta(hours=3), nu - dt.timedelta(hours=2), "server en pc uit", mes_corrector, w1, g1))
    r = con.execute("""SELECT status, gestart_op, afgerond_op, nageleverd_door, nageleverd_reden, afgerond_door,
                              (SELECT count(*) FROM waarde w WHERE w.stapregistratie_id = r.id AND w.ingevoerd_op = r.afgerond_op)
                         FROM stapregistratie r WHERE id = %s""", (rn,)).fetchone()
    check("Nageleverd: afgerond met de tijden van het papier, waarden op het einde",
          r[0] == "afgerond" and r[1] == nu - dt.timedelta(hours=3) and r[2] == nu - dt.timedelta(hours=2) and r[6] == 2, str(r))
    check("Nageleverd: wie, waarom, en de operator van het papier", r[3] == mes_corrector and r[4] == "server en pc uit" and r[5] == op)
    check("Nageleverd: in het logboek",
          val("SELECT count(*) FROM config_log WHERE tabel = 'nalevering' AND record_id = %s", (rn,)) == 1)
    w2 = json.dumps([{"veldcode": c, "setting": 80 if soort[c] == "procesparameter" else None, "gemeten": 81 if c.endswith(".1") else 410}
                     for c in sorted(veld) if c.startswith("S2.")])
    faalt("Begin vóór het einde van de vorige stap kan niet", na,
          ("PS2", "B-2026-0974", pc, op, nu - dt.timedelta(hours=2, minutes=30), nu - dt.timedelta(hours=1), "storing", mes_corrector, w2, "[]"), "vóór het einde van de vorige stap")
    faalt("Gewone regels gelden: verplicht veld ontbreekt", na,
          ("PS2", "B-2026-0974", pc, op, nu - dt.timedelta(hours=2), nu - dt.timedelta(hours=1), "storing", mes_corrector, "[]", "[]"), "Nog niet ingevuld")
    check("Na een geweigerde nalevering staat er niets half",
          val("SELECT count(*) FROM stapregistratie r JOIN processtap s ON s.id = r.processtap_id WHERE r.batch_id = %s AND s.code = 'PS2'", (bn,)) == 0)
    # Lot samenstellen van papier: 4 batches door PS15, dan PS16 nainvoeren.
    lb = [nieuwe_batch(f"B-2026-097{i}") for i in range(5, 9)]
    for x in lb:
        doorloop(x, 1, 15)
    begin = val("SELECT max(afgerond_op) + interval '1 second' FROM stapregistratie WHERE batch_id = ANY(%s)", (lb,))
    con.execute("SELECT pg_sleep(1.2)")
    eind = val("SELECT clock_timestamp()")
    w16 = json.dumps([{"veldcode": c, "setting": 80 if soort[c] == "procesparameter" else None, "gemeten": 81 if c.endswith(".1") else 1640}
                      for c in sorted(veld) if c.startswith("S16.")])
    rl = val("SELECT lever_stap_na('PS16', 'L-2026-0975', %s, %s, %s, %s, %s, %s, %s, %s, '[]')",
             ([f"B-2026-097{i}" for i in range(5, 9)], pc, op, begin, eind, "lot op papier samengesteld", mes_corrector, w16))
    lr = con.execute("""SELECT l.aangemaakt_op, r.gestart_op, r.afgerond_op, r.status, (SELECT count(*) FROM batch b WHERE b.lot_id = l.id)
                          FROM stapregistratie r JOIN lot l ON l.id = r.lot_id WHERE r.id = %s""", (rl,)).fetchone()
    check("Lot nageleverd: 4 batches, met de tijden van het papier",
          lr[0] == begin and lr[1] == begin and lr[2] == eind and lr[3] == "afgerond" and lr[4] == 4, str(lr))

    print("\nBegrensde wachtwoordcontrole (D99)")
    check("Gedeeld account kan niet authenticeren", one("SELECT * FROM inloggen('operator','demo',NULL)") is None)
    auth_test = val("INSERT INTO gebruiker (gebruikersnaam,rol,wachtwoord_hash) VALUES ('mes.auth.test','planner',wachtwoord_hash('test-wachtwoord')) RETURNING id")
    for _ in range(5):
        check("Onjuiste herbevestiging geweigerd", val("SELECT change_password_confirmed(%s,'fout','nieuw-wachtwoord')",(auth_test,)) == "denied")
    check("Mislukte herbevestiging blijft geregistreerd", val("SELECT count(*) FROM inlogpoging WHERE gebruikersnaam='mes.auth.test' AND uitkomst='mislukt'") == 5)
    check("Ook juiste wachtwoordwijziging tijdelijk geblokkeerd", val("SELECT change_password_confirmed(%s,'test-wachtwoord','nieuw-wachtwoord')",(auth_test,)) == "locked")
    print("\nEigen wachtwoord na een tijdelijk wachtwoord (#76)")
    tg = val("INSERT INTO gebruiker (gebruikersnaam, rol, wachtwoord_hash, wachtwoord_wijzigen) VALUES ('tijdelijk.t', 'planner', wachtwoord_hash('tijdelijk-1'), true) RETURNING id")
    faalt("Huidig wachtwoord moet kloppen", "SELECT wijzig_eigen_wachtwoord(%s, 'fout', 'nieuw-wachtwoord')", (tg,), "klopt niet")
    faalt("Minstens 8 tekens", "SELECT wijzig_eigen_wachtwoord(%s, 'tijdelijk-1', 'kort')", (tg,), "minstens 8")
    faalt("Niet hetzelfde als het tijdelijke", "SELECT wijzig_eigen_wachtwoord(%s, 'tijdelijk-1', 'tijdelijk-1')", (tg,), "ander wachtwoord")
    con.execute("SELECT wijzig_eigen_wachtwoord(%s, 'tijdelijk-1', 'eigen-wachtwoord')", (tg,))
    check("Gewijzigd: niet meer tijdelijk, inloggen met het nieuwe",
          con.execute("SELECT NOT wachtwoord_wijzigen AND wachtwoord_hash = public.crypt('eigen-wachtwoord', wachtwoord_hash) FROM gebruiker WHERE id = %s", (tg,)).fetchone()[0])
    check("Wachtwoorden niet in het logboek",
          val("SELECT count(*) FROM config_log WHERE tabel = 'gebruiker' AND record_id = %s AND (nieuw ? 'wachtwoord_hash')", (tg,)) == 0)

    print("\nIets melden (#78)")
    import uuid
    mid = str(uuid.uuid4())
    faalt("Een melding van minder dan 3 tekens kan niet", "SELECT meld_iets(%s, %s, %s, %s, 'PS3', NULL, ' a ')", (mid, pl, op, pc), "minstens 3 tekens")
    con.execute("SELECT meld_iets(%s, %s, %s, %s, 'PS3', 'invoer: stap', 'Knop Opslaan staat te ver weg')", (mid, pl, op, pc))
    con.execute("SELECT meld_iets(%s, %s, %s, %s, 'PS3', 'invoer: stap', 'Knop Opslaan staat te ver weg')", (mid, pl, op, pc))
    check("Twee keer versturen (wachtrij) geeft één melding", val("SELECT count(*) FROM terugmelding WHERE id = %s", (mid,)) == 1)
    bh = val("SELECT id FROM gebruiker WHERE gebruikersnaam = 'beheerder1'")
    con.execute("SELECT handel_terugmelding_af(%s, %s, ' #80 ')", (mid, bh))
    check("Afgehandeld met notitie", con.execute("SELECT status = 'afgehandeld' AND notitie = '#80' AND afgehandeld_door = %s FROM terugmelding WHERE id = %s", (bh, mid)).fetchone()[0])
    faalt("Niet twee keer afhandelen", "SELECT handel_terugmelding_af(%s, %s, NULL)", (mid, bh), "al afgehandeld")

    print("\nKeuringsstappen en specificaties (#80, D73)")
    con.execute("SELECT zet_route(%s, %s)", (prd["PRD-C"], route_c_keuring))
    kw_op = val("SELECT operator_van_account(id) FROM gebruiker WHERE gebruikersnaam='mes.quality'")
    tk = batch_met("B-2026-0980", prd["PRD-C"])
    for code in ["PS1", "PS2", "PS3"]:
        doe(tk, code)
    check("Werkvoorraad TK1 toont de batch na PS3", "B-2026-0980" in voorraad("TK1"))
    faalt("Een operator start geen keuringsstap", "SELECT start_stap('TK1', %s, NULL, %s, %s)", (tk, pc, op), "is een keuring")
    faalt("Nainvoeren van een keuring kan niet", "SELECT lever_stap_na('TK1', 'B-2026-0980', NULL, %s, %s, now() - interval '2 hours', now() - interval '1 hour', 'papier', %s, '[]', '[]')",
          (pc, kw_op, pl), "is een keuring")
    legacy_kw_op = val("SELECT operator_van_account(%s)", (kw,))
    faalt("D101 oude kwaliteitsrol zonder grant start geen keuring",
          "SELECT start_stap('TK1', %s, NULL, %s, %s)", (tk, pc, legacy_kw_op), "MES-keuringsbevoegdheid")
    con.execute("UPDATE gebruiker SET rol='pending' WHERE gebruikersnaam='mes.quality'")
    check("D101 kwaliteitsidentiteit zonder legacyrol heeft startpermission",
          val("SELECT authorization_permits(id,'inspection.start',NULL,%s,NULL) FROM gebruiker WHERE gebruikersnaam='mes.quality'", (prd["PRD-C"],)))
    rtk = val("SELECT start_stap('TK1', %s, NULL, %s, %s)", (tk, pc, kw_op))
    check("Kwaliteit start TK1: meteen afgerond, keuring open",
          one("SELECT r.status, k.status FROM stapregistratie r JOIN keuring k ON k.stapregistratie_id = r.id WHERE r.id = %s", (rtk,)) == ("afgerond", "open"))
    faalt("PS4 wacht op de keuring", "SELECT start_stap('PS4', %s, NULL, %s, %s)", (tk, pc, op), "wacht op Kwaliteit")
    veld_tk = {c: i for c, i in con.execute("SELECT code, id FROM veld WHERE code LIKE 'TK%%' OR code LIKE 'EK%%'")}
    spec_tk1 = val("SELECT id FROM specificatie WHERE processtap_id = %s AND status = 'vastgesteld'", (sid["TK1"],))
    faalt("D101 oude kwaliteitsrol zonder grant meet niet",
          "INSERT INTO waarde(stapregistratie_id,veld_id,gemeten,ingevoerd_door) VALUES (%s,%s,4.4,%s)",
          (rtk,veld_tk["TK1.1"],legacy_kw_op),"MES-meetbevoegdheid")
    w = one("INSERT INTO waarde (stapregistratie_id, veld_id, gemeten, ingevoerd_door) VALUES (%s, %s, 4.4, %s) RETURNING markering, grens_max::float, specificatie_id",
            (rtk, veld_tk["TK1.1"], kw_op))
    check("Meting getoetst aan de specificatie: max 4,0, buiten grens, versie bewaard", w == ("buiten_grens", 4.0, spec_tk1), str(w))
    faalt("Een operator meet niet in een keuringsstap", "INSERT INTO waarde (stapregistratie_id, veld_id, gemeten, ingevoerd_door) VALUES (%s, %s, 250, %s)",
          (rtk, veld_tk["TK1.2"], op), "meet Kwaliteit")
    faalt("Een veld van Productie in een keuringsstap kan niet",
          "INSERT INTO veld (processtap_id, code, naam, soort, volgnummer, gemeten_door) VALUES (%s, 'TK1.9', 'Test', 'overig', 9, 'productie')", (sid["TK1"],), "meet Kwaliteit")
    faalt("Een processtap met velden van Productie wordt geen keuringsstap", "UPDATE processtap SET soort = 'keuring' WHERE code = 'PS4'", (), "velden van Productie")
    faalt("De lotstap wordt geen keuringsstap", "UPDATE processtap SET soort = 'keuring' WHERE code = 'PS16'", (), "")
    faalt("Een specificatie hoort bij een keuringsstap", "INSERT INTO specificatie (product_id, processtap_id, versie) VALUES (%s, %s, 1)", (prd["PRD-C"], sid["PS3"]), "keuringsstap")
    faalt("Een vastgestelde specificatie verandert niet", "UPDATE specificatie_regel SET grens_max = 5 WHERE specificatie_id = %s", (spec_tk1,), "verandert niet")
    faalt("Een vastgestelde specificatie gaat niet weg", "DELETE FROM specificatie WHERE id = %s", (spec_tk1,), "Alleen een concept")
    faalt("Een operator maakt geen specificatie", "SELECT nieuwe_specificatie(%s, %s, %s)", (prd["PRD-C"], sid["TK1"], acc_a), "Alleen Kwaliteit")
    faalt("Geen specificatie voor een keuringsstap buiten de route", "SELECT nieuwe_specificatie(%s, %s, %s)", (prd["PRD-A"], sid["TK1"], kw), "hoort niet bij de route")
    v2 = val("SELECT nieuwe_specificatie(%s, %s, %s)", (prd["PRD-C"], sid["TK1"], kw))
    check("Nieuwe versie: concept 2 met de regels van versie 1",
          one("SELECT versie, status FROM specificatie WHERE id = %s", (v2,)) == (2, "concept")
          and val("SELECT count(*) FROM specificatie_regel WHERE specificatie_id = %s", (v2,)) == 2)
    check("Nog een keer: hetzelfde concept", val("SELECT nieuwe_specificatie(%s, %s, %s)", (prd["PRD-C"], sid["TK1"], kw)) == v2)
    con.execute("UPDATE specificatie_regel SET grens_max = 4.5 WHERE specificatie_id = %s AND veld_id = %s", (v2, veld_tk["TK1.1"]))
    faalt("Een veld van een andere stap in de specificatie kan niet", "INSERT INTO specificatie_regel (specificatie_id, veld_id, grens_max) VALUES (%s, %s, 1)", (v2, veld_tk["EK.1"]), "hoort niet bij")
    faalt("Een regel zonder minimum en maximum kan niet", "INSERT INTO specificatie_regel (specificatie_id, veld_id) VALUES (%s, %s)", (v2, veld_tk["TK1.2"]), "check")
    check("Concept geldt nog niet", val("SELECT grens_max::float FROM grenzen_van(%s, %s)", (veld_tk["TK1.1"], prd["PRD-C"])) == 4.0)
    con.execute("SELECT stel_specificatie_vast(%s, %s)", (v2, kw))
    check("Vastgesteld: versie 2 geldt, versie 1 vervallen",
          val("SELECT grens_max::float FROM grenzen_van(%s, %s)", (veld_tk["TK1.1"], prd["PRD-C"])) == 4.5
          and val("SELECT status FROM specificatie WHERE id = %s", (spec_tk1,)) == "vervallen")
    check("De eerdere meting houdt de grens van versie 1", val("SELECT grens_max::float FROM waarde WHERE stapregistratie_id = %s AND veld_id = %s", (rtk, veld_tk["TK1.1"])) == 4.0)
    faalt("Een vastgesteld concept nog eens vaststellen kan niet", "SELECT stel_specificatie_vast(%s, %s)", (v2, kw), "Alleen een concept")
    v3 = val("SELECT nieuwe_specificatie(%s, %s, %s)", (prd["PRD-C"], sid["TK1"], kw))
    con.execute("DELETE FROM specificatie WHERE id = %s", (v3,))
    check("Een concept weggooien kan, met zijn regels", val("SELECT count(*) FROM specificatie WHERE id = %s", (v3,)) == 0
          and val("SELECT count(*) FROM specificatie_regel WHERE specificatie_id = %s", (v3,)) == 0)
    check("Specificaties staan in het logboek", val("SELECT count(*) FROM config_log WHERE tabel = 'specificatie'") >= 3)
    con.execute("INSERT INTO waarde (stapregistratie_id, veld_id, gemeten, ingevoerd_door) VALUES (%s, %s, 250, %s)", (rtk, veld_tk["TK1.2"], kw_op))
    con.execute("SELECT beslis_keuring((SELECT id FROM keuring WHERE stapregistratie_id = %s), 'vrijgegeven', NULL, %s)", (rtk, mes_quality_decider))
    r4 = val("SELECT start_stap('PS4', %s, NULL, %s, %s)", (tk, pc, op))
    check("Na de vrijgave gaat de batch verder met PS4", r4 is not None)

    print("\nConflicten bij gelijktijdige invoer (#85)")
    con.execute("UPDATE veld SET gemeten_door = 'productie' WHERE processtap_id = (SELECT id FROM processtap WHERE code = 'PS1')")
    bc = nieuwe_batch("B-2026-0991")
    rc = val("SELECT start_stap('PS1', %s, NULL, %s, %s)", (bc, pc, op))
    op_b = val("SELECT id FROM operator WHERE naam = 'Operator B'")
    con.execute("INSERT INTO waarde (stapregistratie_id, veld_id, setting, gemeten, ingevoerd_door) VALUES (%s,%s,80,81,%s)", (rc, veld["S1.1"], op))
    check("Dezelfde waarde nog eens is geen conflict",
          val("SELECT leg_invoerconflict_vast(%s, %s, 80, 81, %s, %s)", (rc, veld["S1.1"], op_b, pc)) == "zelfde"
          and val("SELECT count(*) FROM invoerconflict WHERE stapregistratie_id = %s", (rc,)) == 0)
    inv = "11111111-1111-4111-8111-111111111111"
    check("Een andere waarde is een conflict",
          val("SELECT leg_invoerconflict_vast(%s, %s, 80, 83, %s, %s, %s)", (rc, veld["S1.1"], op_b, pc, inv)) == "conflict")
    val("SELECT leg_invoerconflict_vast(%s, %s, 80, 83, %s, %s, %s)", (rc, veld["S1.1"], op_b, pc, inv))
    check("Opnieuw versturen (zelfde id) maakt geen tweede conflict",
          val("SELECT count(*) FROM invoerconflict WHERE stapregistratie_id = %s", (rc,)) == 1)
    cid = val("SELECT id FROM invoerconflict WHERE invoer_id = %s", (inv,))
    check("De eerste waarde blijft staan tot er gekozen is",
          val("SELECT gemeten::float FROM waarde_actueel WHERE stapregistratie_id = %s AND veld_id = %s", (rc, veld["S1.1"])) == 81)
    check("Melding voor ploegleider en beheerder, met beide waarden",
          one("SELECT voor_rollen, tekst LIKE '%%81 en 83%%' FROM melding WHERE bron_id = %s", (cid,)) == (["ploegleider", "beheerder"], True))
    faalt("Een operator lost geen conflict op", "SELECT los_invoerconflict_op(%s, 'nieuw', %s)", (cid, op_account), "MES-conflictbeslisbevoegdheid")
    faalt("Kwaliteit lost een conflict in een veld van Productie niet op", "SELECT los_invoerconflict_op(%s, 'nieuw', %s)", (cid, kw), "MES-conflictbeslisbevoegdheid")
    faalt("Een conflict wijzig je niet zomaar", "UPDATE invoerconflict SET gemeten = 1 WHERE id = %s", (cid,), "niet gewijzigd")
    con.execute("SELECT los_invoerconflict_op(%s, 'nieuw', %s, 'weegschaal B is geijkt')", (cid, mes_corrector))
    w = one("SELECT gemeten::float, vervangt_waarde_id IS NOT NULL, correctie_reden FROM waarde_actueel WHERE stapregistratie_id = %s AND veld_id = %s", (rc, veld["S1.1"]))
    check("Kiezen voor de tweede: correctie met reden, origineel bewaard",
          w[0] == 83 and w[1] and "Operator B" in w[2] and "geijkt" in w[2]
          and val("SELECT count(*) FROM waarde WHERE stapregistratie_id = %s AND veld_id = %s", (rc, veld["S1.1"])) == 2)
    con.execute("SELECT los_invoerconflict_op(%s, 'nieuw', %s)", (cid, mes_corrector))
    check("Hetzelfde besluit opnieuw versturen verandert niets",
          val("SELECT count(*) FROM waarde WHERE stapregistratie_id = %s AND veld_id = %s", (rc, veld["S1.1"])) == 2)
    faalt("Een opgelost conflict kies je niet opnieuw", "SELECT los_invoerconflict_op(%s, 'bestaand', %s)", (cid, bh), "al opgelost door mes.supervisor")
    con.execute("INSERT INTO grondstof_gebruik (stapregistratie_id, grondstof_id, partij, ingevoerd_door) VALUES (%s,%s,'LEV-1',%s)", (rc, gs["GS-A"], op))
    check("Zelfde partij (andere hoofdletters) is geen conflict",
          val("SELECT leg_grondstofconflict_vast(%s, %s, ' lev-1', NULL, %s, %s)", (rc, gs["GS-A"], op_b, pc)) == "zelfde")
    check("Andere partij is een conflict",
          val("SELECT leg_grondstofconflict_vast(%s, %s, 'LEV-2', NULL, %s, %s)", (rc, gs["GS-A"], op_b, pc)) == "conflict")
    gcid = val("SELECT id FROM invoerconflict WHERE stapregistratie_id = %s AND grondstof_id IS NOT NULL", (rc,))
    con.execute("SELECT los_invoerconflict_op(%s, 'bestaand', %s)", (gcid, mes_corrector))
    check("Kiezen voor de eerste: partij blijft, conflict gesloten",
          val("SELECT partij FROM grondstof_gebruik_actueel WHERE stapregistratie_id = %s AND grondstof_id = %s", (rc, gs["GS-A"])) == "LEV-1"
          and val("SELECT status FROM invoerconflict WHERE id = %s", (gcid,)) == "bestaand")
    con.execute("UPDATE veld SET gemeten_door = 'kwaliteit' WHERE code = 'S1.2'")
    kw_op1 = val("SELECT operator_van_account(id) FROM gebruiker WHERE gebruikersnaam='mes.quality'")
    con.execute("INSERT INTO waarde (stapregistratie_id, veld_id, gemeten, ingevoerd_door) VALUES (%s,%s,410,%s)", (rc, veld["S1.2"], kw_op1))
    val("SELECT leg_invoerconflict_vast(%s, %s, NULL, 415, %s, %s)", (rc, veld["S1.2"], kw_op1, pc))
    kcid = val("SELECT id FROM invoerconflict WHERE stapregistratie_id = %s AND veld_id = %s", (rc, veld["S1.2"]))
    check("Conflict in een veld van Kwaliteit: melding voor Kwaliteit",
          val("SELECT voor_rollen FROM melding WHERE bron_id = %s", (kcid,)) == ["kwaliteit", "beheerder"])
    faalt("Een ploegleider lost een conflict van Kwaliteit niet op", "SELECT los_invoerconflict_op(%s, 'nieuw', %s)", (kcid, mes_corrector), "MES-conflictbeslisbevoegdheid")
    faalt("D101 oude kwaliteitsrol zonder grant beslist niet",
          "SELECT los_invoerconflict_op(%s, 'nieuw', %s)", (kcid, kw), "MES-conflictbeslisbevoegdheid")
    con.execute("SELECT los_invoerconflict_op(%s, 'nieuw', %s)", (kcid, mes_quality_decider))
    check("Kwaliteit kiest de tweede meting",
          val("SELECT gemeten::float FROM waarde_actueel WHERE stapregistratie_id = %s AND veld_id = %s", (rc, veld["S1.2"])) == 415)
    faalt("Kwaliteit corrigeert verder niet zelf",
          "INSERT INTO waarde (stapregistratie_id, veld_id, gemeten, vervangt_waarde_id, correctie_reden, gecorrigeerd_door) "
          "SELECT stapregistratie_id, veld_id, 1, id, 'x', %s FROM waarde_actueel WHERE stapregistratie_id = %s AND veld_id = %s",
          (mes_quality_decider, rc, veld["S1.2"]), "gecontroleerde conflictafhandeling")
    con.execute("UPDATE veld SET gemeten_door = 'productie' WHERE code = 'S1.2'")

    print("\nPloegen en rooster (#86)")
    per_dienst = con.execute("""SELECT d::date, x.dienst, count(*), count(DISTINCT x.divisie)
                                  FROM generate_series(date '2025-12-20', date '2026-02-10', interval '1 day') d
                                  CROSS JOIN LATERAL rooster_op(d::date) x GROUP BY 1, 2""").fetchall()
    check("Elke dag en dienst: precies twee ploegen, één per divisie (ook vóór de startdag)",
          len(per_dienst) == 53 * 3 and all(r[2] == 2 and r[3] == 2 for r in per_dienst))
    check("Een ploeg werkt 6 van de 10 dagen: 2 ochtend, 2 middag, 2 nacht",
          con.execute("""SELECT array_agg(x.dienst ORDER BY d) FROM generate_series(date '2026-01-05', date '2026-01-14', interval '1 day') d
                          CROSS JOIN LATERAL rooster_op(d::date) x WHERE x.code = 'A1'""").fetchone()[0] == ["O", "O", "M", "M", "N", "N"])
    check("5 januari: A1 en A2 in de ochtend", val("SELECT ploegen_in_dienst('2026-01-05', 'O')") == ["A1", "A2"])
    check("7 januari: B in de ochtend, A in de middag",
          val("SELECT ploegen_in_dienst('2026-01-07', 'O')") == ["B1", "B2"] and val("SELECT ploegen_in_dienst('2026-01-07', 'M')") == ["A1", "A2"])
    faalt("Een onbekende dienst in het rooster kan niet", "UPDATE rooster SET patroon = ARRAY['O','X','-']", (), "Onbekende dienst in het rooster: X")
    faalt("Een rooster met alleen vrije dagen kan niet", "UPDATE rooster SET patroon = ARRAY['-','-']", (), "minstens één dienst")
    faalt("Er is maar één rooster", "INSERT INTO rooster (patroon) VALUES (ARRAY['O'])", (), "")
    faalt("Ploegletter is één hoofdletter", "INSERT INTO rooster_ploeg (letter, divisie, cyclus_start) VALUES ('AB', 1, '2026-01-01')", (), "check")
    faalt("Dezelfde ploeg twee keer kan niet", "INSERT INTO rooster_ploeg (letter, divisie, cyclus_start) VALUES ('A', 1, '2026-01-01')", (), "")
    con.execute("UPDATE rooster_ploeg SET actief = false WHERE code = 'A2'")
    check("Een ploeg die uit staat, telt niet mee", val("SELECT ploegen_in_dienst('2026-01-05', 'O')") == ["A1"])
    con.execute("UPDATE rooster_ploeg SET actief = true WHERE code = 'A2'")
    check("Rooster en ploegen staan in het logboek", val("SELECT count(*) FROM config_log WHERE tabel = 'rooster_ploeg'") >= 12)

    print("\nCapaciteit in kilogram (#90)")
    sidk = {c: i for c, i in con.execute("SELECT code, id FROM processtap")}
    prdk = {c: i for c, i in con.execute("SELECT code, id FROM product")}
    check("Seed: PS1 voor PRD-A 3280 kg per dag bij 410 kg per batch = 8 batches",
          one("SELECT kg_per_dag::int, capaciteit_stap_voor(%s, %s) FROM capaciteit_stap WHERE processtap_id = %s AND product_id = %s",
              (sidk["PS1"], prdk["PRD-A"], sidk["PS1"], prdk["PRD-A"])) == (3280, 8))
    check("Lotstap: 3280 kg per dag = 2 lots van 4 × 410 kg", val("SELECT capaciteit_stap_voor(%s, %s)", (sidk["PS16"], prdk["PRD-A"])) == 2)
    con.execute("UPDATE product SET batchgewicht_kg = 500 WHERE code = 'PRD-A'")
    check("Ander gewicht per batch: 3280 kg = 6 batches (naar beneden)", val("SELECT capaciteit_stap_voor(%s, %s)", (sidk["PS1"], prdk["PRD-A"])) == 6)
    con.execute("UPDATE product SET batchgewicht_kg = NULL WHERE code = 'PRD-A'")
    check("Zonder gewicht per batch: nog invullen", val("SELECT capaciteit_stap_voor(%s, %s)", (sidk["PS1"], prdk["PRD-A"])) is None
          and val("SELECT max_per_dag FROM capaciteit_route WHERE product_id = %s AND processtap_id = %s", (prdk["PRD-A"], sidk["PS1"])) is None)
    con.execute("UPDATE product SET batchgewicht_kg = 410 WHERE code = 'PRD-A'")
    check("Minder dan één batch per dag telt als 1", (con.execute("UPDATE capaciteit_stap SET kg_per_dag = 100 WHERE processtap_id = %s AND product_id = %s", (sidk["PS9"], prdk["PRD-A"])) and
          val("SELECT capaciteit_stap_voor(%s, %s)", (sidk["PS9"], prdk["PRD-A"])) == 1))
    con.execute("UPDATE capaciteit_stap SET kg_per_dag = 2460 WHERE processtap_id = %s AND product_id = %s", (sidk["PS9"], prdk["PRD-A"]))
    faalt("Een regel zonder kilogram en zonder stuks kan niet", "UPDATE capaciteit_stap SET kg_per_dag = NULL, max_per_dag = NULL WHERE processtap_id = %s AND product_id = %s",
          (sidk["PS9"], prdk["PRD-A"]), "capaciteit_stap_ingevuld")
    faalt("Een gewicht per batch van 0 kan niet", "UPDATE product SET batchgewicht_kg = 0 WHERE code = 'PRD-A'", (), "check")
    check("Productie-uren per dag: de drie diensten samen = 24", float(val("SELECT productie_uren_per_dag()")) == 24)

    print("\nFase 2: materiaalstamdatafundament (#109)")
    for tabel in ("material_class", "material_definition", "material_definition_version"):
        for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"):
            check(f"#109 {tabel}: geen directe app-{privilege}",
                  not val("SELECT has_table_privilege('mes_app',%s,%s)", ("fabriek."+tabel, privilege)))
    con.execute("BEGIN")
    try:
        mid = val("INSERT INTO material_definition(code,product_id) SELECT 'TEST-MAT',id FROM product ORDER BY id LIMIT 1 RETURNING id")
        cid = val("INSERT INTO material_class(code,name) VALUES ('TEST-CLASS','Fictieve klasse') RETURNING id")
        actor = val("SELECT id FROM gebruiker WHERE gebruikersnaam='mes.engineer'")
        vid = val("INSERT INTO material_definition_version(material_definition_id,revision,name,material_class_id,created_by) VALUES (%s,1,'Fictief',%s,%s) RETURNING id", (mid,cid,actor))
        con.execute("INSERT INTO material_definition_version(material_definition_id,revision,name,created_by) VALUES (%s,2,'Fictief revisie 2',%s)", (mid,actor))
        check("#109 twee versies naast elkaar", val("SELECT count(*) FROM material_definition_version WHERE material_definition_id=%s",(mid,)) == 2)
        for label, sql, params, msg in (
            ("dubbele identiteit","INSERT INTO material_definition(code) VALUES ('TEST-MAT')",(),"duplicate"),
            ("dubbele bronkoppeling","INSERT INTO material_definition(code,product_id) SELECT 'TEST-DUP',product_id FROM material_definition WHERE id=%s",(mid,),"duplicate"),
            ("dubbele revisie","INSERT INTO material_definition_version(material_definition_id,revision,name,created_by) VALUES (%s,1,'Dubbel',%s)",(mid,actor),"duplicate"),
            ("ongeldige revisie","INSERT INTO material_definition_version(material_definition_id,revision,name,created_by) VALUES (%s,0,'Ongeldig',%s)",(mid,actor),"check"),
            ("onbekende materiaalidentiteit","INSERT INTO material_definition_version(material_definition_id,revision,name,created_by) VALUES (gen_random_uuid(),1,'Onbekend',%s)",(actor,),"foreign key"),
            ("versie wijzigen","UPDATE material_definition_version SET name='Gewijzigd' WHERE id=%s",(vid,),"onveranderlijk"),
            ("versie verwijderen","DELETE FROM material_definition_version WHERE id=%s",(vid,),"onveranderlijk"),
        ):
            con.execute("SAVEPOINT material_test")
            faalt("#109 "+label,sql,params,msg)
            con.execute("ROLLBACK TO SAVEPOINT material_test")
            con.execute("RELEASE SAVEPOINT material_test")
    finally:
        con.execute("ROLLBACK")

    print("\n#109 persoonlijk materiaalbeheer")
    con.execute("BEGIN")
    try:
        # Afzonderlijke fictieve accounts; geen invloed van eerdere fixtures.
        for naam in ("mat.engineer","mat.operator","mat.system","mat.legacy","mat.scoped","mat.expired"):
            con.execute("INSERT INTO gebruiker(gebruikersnaam,rol,wachtwoord_hash) VALUES (%s,'pending',wachtwoord_hash('test-materiaal'))",(naam,))
        for naam, rol in (("mat.engineer","process_engineer"),("mat.operator","operator"),("mat.system","system_administrator")):
            con.execute("INSERT INTO authorization_grant(user_id,role_code) SELECT id,%s FROM gebruiker WHERE gebruikersnaam=%s",(rol,naam))
        con.execute("INSERT INTO authorization_grant(user_id,role_code,product_id) SELECT g.id,'process_engineer',p.id FROM gebruiker g CROSS JOIN (SELECT id FROM product ORDER BY id LIMIT 1) p WHERE g.gebruikersnaam='mat.scoped'")
        con.execute("INSERT INTO authorization_grant(user_id,role_code,valid_from,valid_until) SELECT id,'process_engineer',now()-interval '2 days',now()-interval '1 day' FROM gebruiker WHERE gebruikersnaam='mat.expired'")
        actor = val("SELECT id FROM gebruiker WHERE gebruikersnaam='mat.engineer'")
        con.execute("SET LOCAL ROLE mes_app")
        def mat_denied(label, sql, params=(), msg="MES-materiaalbeheerbevoegdheid"):
            con.execute("SAVEPOINT mat_guard")
            faalt(label,sql,params,msg)
            con.execute("ROLLBACK TO SAVEPOINT mat_guard")
            con.execute("RELEASE SAVEPOINT mat_guard")
        con.execute("SELECT set_config('fabriek.execution_proof','',true)")
        mat_denied("#109 geen sessiebewijs","SELECT material_list()",msg="Geldig persoonlijk")
        for naam in ("mat.operator","mat.system","mat.legacy","mat.scoped","mat.expired"):
            proof = val("SELECT session_proof FROM execution_session_login(%s,'test-materiaal',NULL)",(naam,))
            check("#109 persoonlijk bewijs "+naam,bool(proof))
            con.execute("SELECT set_config('fabriek.execution_proof',%s,true)",(proof,))
            mat_denied("#109 lezen geweigerd "+naam,"SELECT material_list()")
            mat_denied("#109 schrijven geweigerd "+naam,"SELECT material_create_class('NO','Geen')")
        proof = val("SELECT session_proof FROM execution_session_login('mat.engineer','test-materiaal',NULL)")
        con.execute("SELECT set_config('fabriek.execution_proof',%s,true)",(proof,))
        cid = val("SELECT material_create_class('MAT-C','Fictief')")
        mid = val("SELECT material_create_definition('MAT-D','Fictief',%s,'kg',NULL,NULL)",(cid,))
        vid = val("SELECT material_append_version(%s,1,'Fictief 2',%s,'kg')",(mid,cid))
        check("#109 persoonlijke versiecreatie",bool(vid))
        data = val("SELECT material_list()")
        versions = [v for v in data["versions"] if v["material_definition_id"] == str(mid)]
        check("#109 versiehistorie en persoonlijke actor",len(versions)==2 and all(v["created_by"]==str(actor) for v in versions))
        mat_denied("#109 oude verwachte revisie geweigerd","SELECT material_append_version(%s,1,'Oud',%s,'kg')",(mid,cid),"revisie is gewijzigd")
        mat_denied("#109 ongeldige eerste versie atomair","SELECT material_create_definition('MAT-BAD','',NULL,NULL,NULL,NULL)",msg="check")
        check("#109 geen halve identiteit",not any(d["code"]=="MAT-BAD" for d in val("SELECT material_list()")["definitions"]))
        mat_denied("#109 directe tabelwrite geweigerd","INSERT INTO material_class(code,name) VALUES ('DIRECT','Direct')",msg="permission denied")
        mat_denied("#109 interne helper geweigerd","SELECT material_manage_actor()",msg="permission denied")
        con.execute("RESET ROLE")
        mat_denied("#109 klasse onveranderlijk","UPDATE material_class SET name='Anders' WHERE id=%s",(cid,),"onveranderlijk")
        mat_denied("#109 identiteit onveranderlijk","UPDATE material_definition SET code='ANDERS' WHERE id=%s",(mid,),"onveranderlijk")
    finally:
        con.execute("ROLLBACK")
        con.execute("RESET ROLE")

    print("\n#109-110 MBR-identiteit en conceptversies")
    con.execute("BEGIN")
    try:
        pa = val("SELECT id FROM product WHERE code='PRD-A'")
        pb = val("SELECT id FROM product WHERE code='PRD-B'")
        con.execute("INSERT INTO gebruiker(gebruikersnaam,rol,wachtwoord_hash) VALUES ('mbr.scoped','analist',wachtwoord_hash('test-recept'))")
        actor = val("SELECT id FROM gebruiker WHERE gebruikersnaam='mbr.scoped'")
        con.execute("INSERT INTO authorization_grant(user_id,role_code,product_id) VALUES (%s,'process_engineer',%s)",(actor,pa))
        con.execute("SET LOCAL ROLE mes_app")
        def mbr_denied(label, sql, params=(), msg="MES-receptbevoegdheid"):
            con.execute("SAVEPOINT mbr_guard")
            faalt(label,sql,params,msg)
            con.execute("ROLLBACK TO SAVEPOINT mbr_guard")
            con.execute("RELEASE SAVEPOINT mbr_guard")
        con.execute("SELECT set_config('fabriek.execution_proof','',true)")
        mbr_denied("#110 recept zonder bewijs geweigerd","SELECT recipe_list(%s)",(pa,),"Geldig persoonlijk")
        proof = val("SELECT session_proof FROM execution_session_login('mbr.scoped','test-recept',NULL)")
        con.execute("SELECT set_config('fabriek.execution_proof',%s,true)",(proof,))
        ra = val("SELECT recipe_create(%s,'MBR-A','Fictief A','')",(pa,))
        rb = val("SELECT recipe_create(%s,'MBR-B','Fictief B','')",(pa,))
        v = val("SELECT recipe_create_next_version(%s,1,'Fictief A2','')",(ra,))
        data = val("SELECT recipe_list(%s)",(pa,))
        check("#110 meerdere MBR's per product",len(data)==2 and ra!=rb)
        versions = next(r["versions"] for r in data if r["id"]==str(ra))
        check("#110 gescheiden revisiehistorie en actor",[x["revision"] for x in versions]==[1,2] and all(x["created_by"]==str(actor) for x in versions) and versions[1]["id"]==str(v))
        mbr_denied("#110 andere productscope lezen","SELECT recipe_list(%s)",(pb,))
        mbr_denied("#110 andere productscope schrijven","SELECT recipe_create(%s,'NO','Geen','')",(pb,))
        mbr_denied("#110 dubbele receptcode","SELECT recipe_create(%s,'MBR-A','Dubbel','')",(pa,),"duplicate")
        mbr_denied("#110 stale revisie","SELECT recipe_create_next_version(%s,1,'Oud','')",(ra,),"revisie is gewijzigd")
        mbr_denied("#110 atomaire eerste versie","SELECT recipe_create(%s,'BAD','','')",(pa,),"check")
        check("#110 geen halve MBR",len(val("SELECT recipe_list(%s)",(pa,)))==2)
        check("#110 conceptwijziging telt op",val("SELECT recipe_update_draft(%s,0,'Fictief gewijzigd','Nieuwe inhoud')",(v,))==1)
        mbr_denied("#110 stale conceptwijziging","SELECT recipe_update_draft(%s,0,'Oud','')",(v,),"ondertussen gewijzigd")
        mbr_denied("#110 ongeldige conceptnaam","SELECT recipe_update_draft(%s,1,'','')",(v,),"check")
        versions = next(r["versions"] for r in val("SELECT recipe_list(%s)",(pa,)) if r["id"]==str(ra))
        check("#110 conceptinhoud en eerdere revisie behouden",versions[0]["name"]=="Fictief A" and versions[1]["name"]=="Fictief gewijzigd" and versions[1]["change_no"]==1)
        check("#110 persoonlijke audit voor conceptwijziging",val("SELECT count(*) FROM config_log WHERE tabel='master_recipe_version' AND record_id=%s AND actie='UPDATE' AND actor_origin='personal' AND actor_user_id=%s AND oud->>'name'='Fictief A2' AND nieuw->>'name'='Fictief gewijzigd'",(v,actor))==1)
        mbr_denied("#110 directe conceptwrite","UPDATE master_recipe_version SET name='Direct' WHERE false",msg="permission denied")
        mbr_denied("#110 directe tabelwrite","INSERT INTO master_recipe DEFAULT VALUES",msg="permission denied")
        mbr_denied("#110 interne helper","SELECT recipe_draft_actor(%s)",(pa,),"permission denied")
        con.execute("RESET ROLE")
        mbr_denied("#110 onveranderlijke productkoppeling","UPDATE master_recipe SET product_id=%s WHERE id=%s",(pb,ra),"onveranderlijk")
        mbr_denied("#110 onveranderlijke versie-identiteit","UPDATE master_recipe_version SET revision=5 WHERE id=%s",(v,),"onveranderlijk")
        mbr_denied("#110 versie verwijderen","DELETE FROM master_recipe_version WHERE id=%s",(v,),"niet worden verwijderd")
        for tabel in ("master_recipe","master_recipe_version"):
            for privilege in ("SELECT","INSERT","UPDATE","DELETE","TRUNCATE"):
                check(f"#110 {tabel}: geen directe app-{privilege}",not val("SELECT has_table_privilege('mes_app',%s,%s)",("fabriek."+tabel,privilege)))
    finally:
        con.execute("ROLLBACK")
        con.execute("RESET ROLE")

    print("\n#103/110 procedurehiërarchie en afhankelijkheden")
    con.execute("BEGIN")
    try:
        actor = val("SELECT id FROM gebruiker WHERE gebruikersnaam='mes.engineer'")
        pa = val("SELECT id FROM product WHERE code='PRD-A'")
        rid = val("INSERT INTO master_recipe(product_id,code,created_by) VALUES (%s,'PROC-TEST',%s) RETURNING id",(pa,actor))
        v1 = val("INSERT INTO master_recipe_version(master_recipe_id,revision,name,created_by) VALUES (%s,1,'Procedure test',%s) RETURNING id",(rid,actor))
        v2 = val("INSERT INTO master_recipe_version(master_recipe_id,revision,name,created_by) VALUES (%s,2,'Procedure test 2',%s) RETURNING id",(rid,actor))
        def elem(v, parent, pk, kind, code, pos, required=True):
            return val("INSERT INTO recipe_procedural_element(recipe_version_id,parent_id,parent_kind,kind,code,name,position,required) VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",(v,parent,pk,kind,code,code,pos,required))
        root = elem(v1,None,None,"procedure","ROOT",1)
        unit = elem(v1,root,"procedure","unit_procedure","UP",1)
        op = elem(v1,unit,"unit_procedure","operation","OP",1)
        p1 = elem(v1,op,"operation","phase","P1",1)
        p2 = elem(v1,op,"operation","phase","P2",2,False)
        root2 = elem(v2,None,None,"procedure","ROOT",1)
        dep = val("INSERT INTO recipe_dependency(recipe_version_id,predecessor_id,successor_id) VALUES (%s,%s,%s) RETURNING id",(v1,p1,p2))
        check("#110 geldige vierlaagse boom en optionele handeling",bool(dep) and val("SELECT required FROM recipe_procedural_element WHERE id=%s",(p2,)) is False)
        def proc_denied(label, sql, params=(), msg="check"):
            con.execute("SAVEPOINT proc_guard")
            faalt(label,sql,params,msg)
            con.execute("ROLLBACK TO SAVEPOINT proc_guard")
            con.execute("RELEASE SAVEPOINT proc_guard")
        proc_denied("#110 terugwaartse edge/cyclus geweigerd","INSERT INTO recipe_dependency(recipe_version_id,predecessor_id,successor_id) VALUES (%s,%s,%s)",(v1,p2,p1),"voorwaarts")
        proc_denied("#110 edge over versiegrens geweigerd","INSERT INTO recipe_dependency(recipe_version_id,predecessor_id,successor_id) VALUES (%s,%s,%s)",(v1,p1,root2),"voorwaarts")
        proc_denied("#110 edge over hiërarchiegroep geweigerd","INSERT INTO recipe_dependency(recipe_version_id,predecessor_id,successor_id) VALUES (%s,%s,%s)",(v1,unit,p2),"voorwaarts")
        proc_denied("#110 zelfverwijzing geweigerd","INSERT INTO recipe_dependency(recipe_version_id,predecessor_id,successor_id) VALUES (%s,%s,%s)",(v1,p1,p1),"voorwaarts")
        proc_denied("#110 positie maakt edge ongeldig","UPDATE recipe_procedural_element SET position=3 WHERE id=%s",(p1,),"afhankelijkheid ongeldig")
        proc_denied("#110 parent in andere versie","UPDATE recipe_procedural_element SET parent_id=%s WHERE id=%s",(root2,unit),"foreign key")
        # Isoleer de parenttypeconstraint: geen bestaande edge op deze fixture.
        standalone = elem(v1,op,"operation","phase","P3-PARENT-TEST",3)
        proc_denied("#110 verkeerde parentsoort","UPDATE recipe_procedural_element SET parent_id=%s,parent_kind='procedure' WHERE id=%s",(root,standalone),"check")
        check("#110 geweigerde parentwijziging behoudt oorspronkelijke relatie",val("SELECT parent_id FROM recipe_procedural_element WHERE id=%s",(standalone,))==op)
        proc_denied("#110 dubbele root","INSERT INTO recipe_procedural_element(recipe_version_id,kind,code,name,position) VALUES (%s,'procedure','ROOT2','Dubbel',2)",(v1,),"duplicate")
        proc_denied("#110 dubbele positie","UPDATE recipe_procedural_element SET position=1 WHERE id=%s",(p2,),"afhankelijkheid ongeldig")
        proc_denied("#110 versie van element onveranderlijk","UPDATE recipe_procedural_element SET recipe_version_id=%s WHERE id=%s",(v2,p1),"onveranderlijk")
        for tabel in ("recipe_procedural_element","recipe_dependency"):
            for privilege in ("SELECT","INSERT","UPDATE","DELETE","TRUNCATE"):
                check(f"#110 {tabel}: geen directe app-{privilege}",not val("SELECT has_table_privilege('mes_app',%s,%s)",("fabriek."+tabel,privilege)))
    finally:
        con.execute("ROLLBACK")

    print("\n#110 persoonlijk procedurebeheer en gezamenlijke teller")
    con.execute("BEGIN")
    try:
        pa = val("SELECT id FROM product WHERE code='PRD-A'")
        pb = val("SELECT id FROM product WHERE code='PRD-B'")
        con.execute("INSERT INTO gebruiker(gebruikersnaam,rol,wachtwoord_hash) VALUES ('proc.scoped','analist',wachtwoord_hash('test-proc'))")
        actor = val("SELECT id FROM gebruiker WHERE gebruikersnaam='proc.scoped'")
        con.execute("INSERT INTO authorization_grant(user_id,role_code,product_id) VALUES (%s,'process_engineer',%s)",(actor,pa))
        other = val("INSERT INTO master_recipe(product_id,code,created_by) VALUES (%s,'PROC-OTHER',%s) RETURNING id",(pb,actor))
        other_version = val("INSERT INTO master_recipe_version(master_recipe_id,revision,name,created_by) VALUES (%s,1,'Other',%s) RETURNING id",(other,actor))
        con.execute("SET LOCAL ROLE mes_app")
        proof = val("SELECT session_proof FROM execution_session_login('proc.scoped','test-proc',NULL)")
        con.execute("SELECT set_config('fabriek.execution_proof',%s,true)",(proof,))
        rid = val("SELECT recipe_create(%s,'PROC-MANAGE','Fictief','')",(pa,))
        version = next(r["versions"][0]["id"] for r in val("SELECT recipe_list(%s)",(pa,)) if r["id"]==str(rid))
        def denied(label,sql,params=(),msg="MES-receptbevoegdheid"):
            con.execute("SAVEPOINT proc_manage")
            faalt(label,sql,params,msg)
            con.execute("ROLLBACK TO SAVEPOINT proc_manage")
            con.execute("RELEASE SAVEPOINT proc_manage")
        def save(n,parent,kind,code,pos,required=True,element=None):
            return val("SELECT recipe_save_element(%s,%s,%s,%s,%s,%s,%s,%s,%s)",(version,n,element,parent,kind,code,code,pos,required))
        denied("#110 procedure andere productscope","SELECT recipe_procedure_list(%s)",(other_version,))
        denied("#110 procedurewrite andere productscope","SELECT recipe_save_element(%s,0,NULL,NULL,'procedure','NO','NO',1,true)",(other_version,))
        root = save(0,None,"procedure","ROOT",1)
        unit = save(1,root["id"],"unit_procedure","UP",1)
        op = save(2,unit["id"],"operation","OP",1)
        first = save(3,op["id"],"phase","P1",1)
        second = save(4,op["id"],"phase","P2",2,False)
        check("#110 procedurewijzigingen tellen gezamenlijk",second["change_no"]==5)
        denied("#110 stale header na kindwijziging","SELECT recipe_update_draft(%s,0,'Oud','')",(version,),"ondertussen gewijzigd")
        denied("#110 stale procedurewijziging","SELECT recipe_save_element(%s,4,NULL,NULL,'procedure','OLD','OLD',1,true)",(version,),"ondertussen gewijzigd")
        dep = val("SELECT recipe_add_dependency(%s,5,%s,%s)",(version,first["id"],second["id"]))
        check("#110 edge verhoogt teller",dep["change_no"]==6)
        denied("#110 ongeldige edge zonder tellerwijziging","SELECT recipe_add_dependency(%s,6,%s,%s)",(version,second["id"],first["id"]),"voorwaarts")
        denied("#110 element met edge niet verwijderen","SELECT recipe_delete_element(%s,6,%s)",(version,first["id"]),"foreign key")
        check("#110 mislukte operatie atomair",val("SELECT recipe_procedure_list(%s)",(version,))["change_no"]==6)
        changed = save(6,op["id"],"phase","P2-EDIT",2,False,second["id"])
        check("#110 stabiele identiteit bij edit",changed["id"]==second["id"] and changed["change_no"]==7)
        check("#110 edge verwijderen",val("SELECT recipe_delete_dependency(%s,7,%s)",(version,dep["id"]))==8)
        check("#110 element verwijderen",val("SELECT recipe_delete_element(%s,8,%s)",(version,second["id"]))==9)
        data=val("SELECT recipe_procedure_list(%s)",(version,))
        check("#110 consistente boom en teller",data["change_no"]==9 and len(data["elements"])==4 and not data["dependencies"])
        check("#110 persoonlijke delete-audit",val("SELECT count(*) FROM config_log WHERE tabel='recipe_procedural_element' AND record_id=%s AND actie='DELETE' AND actor_user_id=%s AND actor_origin='personal' AND oud->>'code'='P2-EDIT' AND nieuw IS NULL",(second["id"],actor))==1)
        denied("#110 interne lock niet uitvoerbaar","SELECT recipe_lock_draft(%s,9)",(version,),"permission denied")
        denied("#110 directe procedurewrite geweigerd","DELETE FROM recipe_procedural_element WHERE false",msg="permission denied")
    finally:
        con.execute("ROLLBACK")
        con.execute("RESET ROLE")

    print("\n#111 versiegebonden parameters en vijf voorwaarden")
    con.execute("BEGIN")
    try:
        actor = val("SELECT id FROM gebruiker WHERE gebruikersnaam='mes.engineer'")
        product = val("SELECT id FROM product WHERE code='PRD-A'")
        recipe = val("INSERT INTO master_recipe(product_id,code,created_by) VALUES (%s,'PARAM-TEST',%s) RETURNING id",(product,actor))
        def version(n):
            return val("INSERT INTO master_recipe_version(master_recipe_id,revision,name,created_by) VALUES (%s,%s,'Param test',%s) RETURNING id",(recipe,n,actor))
        v1,v2 = version(1),version(2)
        def root(v):
            return val("INSERT INTO recipe_procedural_element(recipe_version_id,kind,code,name,position) VALUES (%s,'procedure','ROOT','Root',1) RETURNING id",(v,))
        e1,e2 = root(v1),root(v2)
        def param(v,e,code,typ,unit=None):
            return val("INSERT INTO recipe_parameter(recipe_version_id,procedural_element_id,code,name,data_type,unit,frequency,required,responsible_activity,critical) VALUES (%s,%s,%s,%s,%s,%s,'per batch',true,'productie',true) RETURNING id",(v,e,code,code,typ,unit))
        p1=param(v1,e1,"TEMP","decimal","degC")
        p2=param(v2,e2,"TEMP","decimal","degC")
        pi=param(v1,e1,"COUNT","integer","count")
        pt=param(v1,e1,"NOTE","text")
        def limit(v,p,typ,cat,target=None,lo=None,hi=None):
            return val("INSERT INTO recipe_parameter_limit(recipe_version_id,parameter_id,data_type,category,target_value,lower_value,upper_value) VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING id",(v,p,typ,cat,target,lo,hi))
        limit(v1,p1,"decimal","target",90)
        limit(v1,p1,"decimal","operating_tolerance",None,88,92)
        limit(v1,p1,"decimal","process_limit",None,85,95)
        limit(v1,p1,"decimal","specification_limit",None,82,98)
        limit(v1,p1,"decimal","statistical_control_limit",None,87,93)
        limit(v2,p2,"decimal","target",92)
        limit(v1,pi,"integer","process_limit",None,0,None)
        check("#111 vijf onafhankelijke categorieën",val("SELECT count(*) FROM recipe_parameter_limit WHERE parameter_id=%s",(p1,))==5)
        check("#111 zelfde parametercode afzonderlijk per revisie",val("SELECT target_value FROM recipe_parameter_limit WHERE parameter_id=%s AND category='target'",(p2,))==92)
        check("#111 eenzijdige limiet",val("SELECT upper_value IS NULL FROM recipe_parameter_limit WHERE parameter_id=%s",(pi,)))
        def rejected(label,sql,params=(),msg="check"):
            con.execute("SAVEPOINT parameter_guard")
            faalt(label,sql,params,msg)
            con.execute("ROLLBACK TO SAVEPOINT parameter_guard")
            con.execute("RELEASE SAVEPOINT parameter_guard")
        insert_limit="INSERT INTO recipe_parameter_limit(recipe_version_id,parameter_id,data_type,category,target_value,lower_value,upper_value) VALUES (%s,%s,%s,%s,%s,%s,%s)"
        rejected("#111 verkeerde versiegrens",insert_limit,(v2,p1,"decimal","target",1,None,None),"foreign key")
        rejected("#111 tekstparameter geen numerieke grenzen",insert_limit,(v1,pt,"decimal","target",1,None,None),"foreign key")
        rejected("#111 integer geen fractioneel doel",insert_limit,(v1,pi,"integer","target",1.5,None,None))
        rejected("#111 doel vereist afzonderlijke waarde",insert_limit,(v1,pi,"integer","target",None,1,2))
        rejected("#111 lege grens",insert_limit,(v1,pi,"integer","specification_limit",None,None,None))
        rejected("#111 omgekeerde grenzen",insert_limit,(v1,pi,"integer","specification_limit",None,5,2))
        rejected("#111 niet-eindig getal",insert_limit,(v1,pi,"integer","target","NaN",None,None))
        rejected("#111 dubbele categorie",insert_limit,(v1,p1,"decimal","target",90,None,None),"duplicate")
        rejected("#111 procedure uit andere revisie","UPDATE recipe_parameter SET procedural_element_id=%s WHERE id=%s",(e2,p1),"foreign key")
        rejected("#111 eenheid niet stilzwijgend wijzigen","UPDATE recipe_parameter SET unit='K' WHERE id=%s",(p1,),"eenheidswijziging")
        rejected("#111 datatype niet stilzwijgend wijzigen","UPDATE recipe_parameter SET data_type='integer' WHERE id=%s",(p1,),"foreign key")
        rejected("#111 procedure met parameter niet verwijderen","DELETE FROM recipe_procedural_element WHERE id=%s",(e1,),"foreign key")
        rejected("#111 parameter met voorwaarden niet verwijderen","DELETE FROM recipe_parameter WHERE id=%s",(p1,),"foreign key")
        for tabel in ("recipe_parameter","recipe_parameter_limit"):
            for privilege in ("SELECT","INSERT","UPDATE","DELETE","TRUNCATE"):
                check(f"#111 {tabel}: geen directe app-{privilege}",not val("SELECT has_table_privilege('mes_app',%s,%s)",("fabriek."+tabel,privilege)))
    finally:
        con.execute("ROLLBACK")

    print("\n#111 referentieformule en expliciete schaalregels")
    con.execute("BEGIN")
    try:
        actor = val("SELECT id FROM gebruiker WHERE gebruikersnaam='mes.engineer'")
        product = val("SELECT id FROM product WHERE code='PRD-A'")
        recipe = val("INSERT INTO master_recipe(product_id,code,created_by) VALUES (%s,'FORMULA-TEST',%s) RETURNING id",(product,actor))
        def fv(n):
            return val("INSERT INTO master_recipe_version(master_recipe_id,revision,name,created_by) VALUES (%s,%s,'Formula test',%s) RETURNING id",(recipe,n,actor))
        v1,v2 = fv(1),fv(2)
        def fe(v):
            return val("INSERT INTO recipe_procedural_element(recipe_version_id,kind,code,name,position) VALUES (%s,'procedure','ROOT','Root',1) RETURNING id",(v,))
        e1,e2=fe(v1),fe(v2)
        mid=val("INSERT INTO material_definition(code) VALUES ('FORMULA-MAT') RETURNING id")
        mv=val("INSERT INTO material_definition_version(material_definition_id,revision,name,unit,created_by) VALUES (%s,1,'Fictief','kg',%s) RETURNING id",(mid,actor))
        unknown=val("INSERT INTO material_definition_version(material_definition_id,revision,name,created_by) VALUES (%s,2,'Onbekend',%s) RETURNING id",(mid,actor))
        form=val("INSERT INTO recipe_formula(recipe_version_id,reference_quantity,reference_unit) VALUES (%s,1000,'kg') RETURNING id",(v1,))
        form2=val("INSERT INTO recipe_formula(recipe_version_id,reference_quantity,reference_unit) VALUES (%s,2000,'kg') RETURNING id",(v2,))
        req_sql="INSERT INTO recipe_material_requirement(recipe_version_id,formula_id,procedural_element_id,material_version_id,code,direction,quantity,unit,scaling) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)"
        con.execute(req_sql,(v1,form,e1,mv,"INPUT","input",600,"kg","linear"))
        con.execute(req_sql,(v1,form,None,mv,"OUTPUT","output",500,"kg","fixed"))
        check("#111 vaste en lineaire hoeveelheden afzonderlijk",val("SELECT count(DISTINCT scaling) FROM recipe_material_requirement WHERE formula_id=%s",(form,))==2)
        check("#111 verwijzing naar exacte materiaalversie",val("SELECT count(*) FROM recipe_material_requirement WHERE formula_id=%s AND material_version_id=%s",(form,mv))==2)
        def fp(v,e):
            return val("INSERT INTO recipe_parameter(recipe_version_id,procedural_element_id,code,name,data_type,unit,frequency,required,responsible_activity,critical) VALUES (%s,%s,'TEMP','Temp','decimal','degC','per batch',true,'productie',true) RETURNING id",(v,e))
        p1,p2=fp(v1,e1),fp(v2,e2)
        target=val("INSERT INTO recipe_parameter_limit(recipe_version_id,parameter_id,data_type,category,target_value) VALUES (%s,%s,'decimal','target',90) RETURNING id",(v1,p1))
        check("#111 standaard vaste parameterwaarde",val("SELECT scaling FROM recipe_parameter_limit WHERE id=%s",(target,))=="fixed")
        con.execute("UPDATE recipe_parameter_limit SET scaling='linear' WHERE id=%s",(target,))
        check("#111 expliciete schaalkeuze",val("SELECT scaling FROM recipe_parameter_limit WHERE id=%s",(target,))=="linear")
        def denied(label,sql,params=(),msg="check"):
            con.execute("SAVEPOINT formula_guard")
            faalt(label,sql,params,msg)
            con.execute("ROLLBACK TO SAVEPOINT formula_guard")
            con.execute("RELEASE SAVEPOINT formula_guard")
        denied("#111 verkeerde formuleversie",req_sql,(v1,form2,e1,mv,"BAD1","input",1,"kg","fixed"),"foreign key")
        denied("#111 verkeerde procedureversie",req_sql,(v1,form,e2,mv,"BAD2","input",1,"kg","fixed"),"foreign key")
        denied("#111 verkeerde materiaaleenheid",req_sql,(v1,form,e1,mv,"BAD3","input",1,"g","fixed"),"Materiaaleenheid")
        denied("#111 onbekende materiaaleenheid",req_sql,(v1,form,e1,unknown,"BAD4","input",1,"kg","fixed"),"Materiaaleenheid")
        denied("#111 negatieve hoeveelheid",req_sql,(v1,form,e1,mv,"BAD5","input",-1,"kg","fixed"))
        denied("#111 niet-eindige hoeveelheid",req_sql,(v1,form,e1,mv,"BAD6","input","Infinity","kg","fixed"))
        denied("#111 onbekende schaalregel",req_sql,(v1,form,e1,mv,"BAD7","input",1,"kg","auto"))
        denied("#111 referentie niet stilzwijgend wijzigen","UPDATE recipe_formula SET reference_quantity=500 WHERE id=%s",(form,),"Herdefinieer eerst")
        denied("#111 referentie niet stilzwijgend hernoemen","UPDATE recipe_formula SET reference_unit='g' WHERE id=%s",(form,),"Herdefinieer eerst")
        denied("#111 dubbele formule","INSERT INTO recipe_formula(recipe_version_id,reference_quantity,reference_unit) VALUES (%s,100,'kg')",(v1,),"duplicate")
        denied("#111 negatieve referentie","UPDATE recipe_formula SET reference_quantity=-1 WHERE id=%s",(form2,))
        con.execute("DELETE FROM recipe_formula WHERE id=%s",(form2,))
        denied("#111 schalen zonder referentie","INSERT INTO recipe_parameter_limit(recipe_version_id,parameter_id,data_type,category,target_value,scaling) VALUES (%s,%s,'decimal','target',90,'linear')",(v2,p2),"referentieformule")
        denied("#111 formule met schaalvoorwaarde niet verwijderen","DELETE FROM recipe_formula WHERE id=%s",(form,),"referentieformule")
        for tabel in ("recipe_formula","recipe_material_requirement"):
            for privilege in ("SELECT","INSERT","UPDATE","DELETE","TRUNCATE"):
                check(f"#111 {tabel}: geen directe app-{privilege}",not val("SELECT has_table_privilege('mes_app',%s,%s)",("fabriek."+tabel,privilege)))
    finally:
        con.execute("ROLLBACK")

    print("\n#141 eenheden, dimensies en onveranderlijke conversieversies")
    con.execute("BEGIN")
    try:
        actor = val("SELECT id FROM gebruiker WHERE gebruikersnaam='mes.engineer'")
        mass = val("INSERT INTO quantity_dimension(length_exp,mass_exp,time_exp,current_exp,temperature_exp,amount_exp,luminous_exp) VALUES (0,1,0,0,0,0,0) RETURNING id")
        temp = val("INSERT INTO quantity_dimension(length_exp,mass_exp,time_exp,current_exp,temperature_exp,amount_exp,luminous_exp) VALUES (0,0,0,0,1,0,0) RETURNING id")
        def qkind(dim,code,sem):
            return val("INSERT INTO quantity_kind(dimension_id,code,name,value_semantics) VALUES (%s,%s,%s,%s) RETURNING id",(dim,code,code,sem))
        qm=qkind(mass,"MASS","ratio")
        qt=qkind(temp,"TEMP_ABS","absolute")
        qd=qkind(temp,"TEMP_DELTA","difference")
        def unit(q,code,symbol):
            return val("INSERT INTO measurement_unit(quantity_kind_id,code,symbol,name) VALUES (%s,%s,%s,%s) RETURNING id",(q,code,symbol,code))
        kg,g=unit(qm,"KG","kg"),unit(qm,"G","g")
        c,k=unit(qt,"CELSIUS_ABS","degC"),unit(qt,"KELVIN_ABS","K")
        dc,dk=unit(qd,"CELSIUS_DELTA","delta_degC"),unit(qd,"KELVIN_DELTA","delta_K")
        def conversion(q,a,b):
            return val("INSERT INTO unit_conversion(quantity_kind_id,from_unit_id,to_unit_id) VALUES (%s,%s,%s) RETURNING id",(q,a,b))
        cm,ct,cd=conversion(qm,kg,g),conversion(qt,c,k),conversion(qd,dc,dk)
        version_sql="INSERT INTO unit_conversion_version(conversion_id,quantity_kind_id,value_semantics,revision,factor_numerator,factor_denominator,additive_offset,source_reference,created_by) VALUES (%s,%s,%s,%s,%s,%s,%s,'fictieve testdefinitie',%s)"
        con.execute(version_sql,(cm,qm,"ratio",1,1000,1,0,actor))
        con.execute(version_sql,(ct,qt,"absolute",1,1,1,273.15,actor))
        con.execute(version_sql,(cd,qd,"difference",1,1,1,0,actor))
        con.execute(version_sql,(cm,qm,"ratio",2,1000,1,0,actor))
        check("#141 revisies naast elkaar behouden",val("SELECT count(*) FROM unit_conversion_version WHERE conversion_id=%s",(cm,))==2)
        check("#141 absolute en verschiltemperatuur zelfde dimensie, aparte grootheid",val("SELECT count(*) FROM quantity_kind WHERE dimension_id=%s",(temp,))==2)
        def denied(label,sql,params=(),msg="check"):
            con.execute("SAVEPOINT unit_guard")
            faalt(label,sql,params,msg)
            con.execute("ROLLBACK TO SAVEPOINT unit_guard")
            con.execute("RELEASE SAVEPOINT unit_guard")
        conv_sql="INSERT INTO unit_conversion(quantity_kind_id,from_unit_id,to_unit_id) VALUES (%s,%s,%s)"
        denied("#141 verschillende dimensies niet direct converteren",conv_sql,(qm,kg,k),"foreign key")
        denied("#141 absolute en verschiltemperatuur niet direct converteren",conv_sql,(qt,c,dk),"foreign key")
        denied("#141 offset bij verschiltemperatuur geweigerd",version_sql,(cd,qd,"difference",2,1,1,273.15,actor))
        denied("#141 offset bij ratio geweigerd",version_sql,(cm,qm,"ratio",3,1,1,1,actor))
        denied("#141 nulnoemer geweigerd",version_sql,(cm,qm,"ratio",3,1,0,0,actor))
        denied("#141 niet-eindige factor geweigerd",version_sql,(cm,qm,"ratio",3,"Infinity",1,0,actor))
        denied("#141 verkeerde semantiek geweigerd",version_sql,(cm,qm,"absolute",3,1,1,0,actor),"foreign key")
        denied("#141 dubbele revisie geweigerd",version_sql,(cm,qm,"ratio",1,1000,1,0,actor),"duplicate")
        denied("#141 conversieversie niet aanpassen","UPDATE unit_conversion_version SET factor_numerator=2 WHERE conversion_id=%s AND revision=1",(cm,),"onveranderlijk")
        denied("#141 eenheid niet aanpassen","UPDATE measurement_unit SET symbol='wrong' WHERE id=%s",(kg,),"onveranderlijk")
        denied("#141 grootheid niet verwijderen","DELETE FROM quantity_kind WHERE id=%s",(qt,),"onveranderlijk")
        mid=val("INSERT INTO material_definition(code) VALUES ('UNIT-MAT-TEST') RETURNING id")
        mv=val("INSERT INTO material_definition_version(material_definition_id,revision,name,unit,measurement_unit_id,created_by) VALUES (%s,1,'Fictief','kg',%s,%s) RETURNING id",(mid,kg,actor))
        denied("#141 afwijkende eenheidstekst","INSERT INTO material_definition_version(material_definition_id,revision,name,unit,measurement_unit_id,created_by) VALUES (%s,2,'Fictief','g',%s,%s)",(mid,kg,actor),"Eenheidstekst")
        check("#141 materiaalversie expliciet gekoppeld",val("SELECT measurement_unit_id FROM material_definition_version WHERE id=%s",(mv,))==kg)
        for tabel in ("quantity_dimension","quantity_kind","measurement_unit","unit_conversion","unit_conversion_version"):
            for privilege in ("SELECT","INSERT","UPDATE","DELETE","TRUNCATE"):
                check(f"#141 {tabel}: geen directe app-{privilege}",not val("SELECT has_table_privilege('mes_app',%s,%s)",("fabriek."+tabel,privilege)))
    finally:
        con.execute("ROLLBACK")

    fout = [r for r in resultaten if not r[1]]
    print(f"\n{len(resultaten) - len(fout)} van {len(resultaten)} controles geslaagd")
    sys.exit(1 if fout else 0)


if __name__ == "__main__":
    main()
