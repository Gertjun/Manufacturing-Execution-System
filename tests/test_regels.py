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
        return con.execute(sql, p).fetchone()

    def val(sql, p=()):
        return one(sql, p)[0]

    def faalt(naam, sql, p=(), bevat=""):
        try:
            con.execute(sql, p)
        except psycopg.Error as e:
            msg = str(e).splitlines()[0]
            check(naam, bevat.lower() in msg.lower(), msg)
            return
        check(naam, False, "geen foutmelding")

    print("\\nMES autorisaties (uitbreidingsmodel)")
    con.execute((ROOT / "db/rechten.sql").read_text())
    auth_user = val("SELECT id FROM gebruiker WHERE gebruikersnaam = 'ploegleider1'")
    check("Geen automatische MES-bevoegdheid", not val("SELECT authorization_permits(%s,'execution.record',NULL,NULL,NULL)", (auth_user,)))
    con.execute("INSERT INTO authorization_role VALUES ('test_operator','operations'), ('test_technical','technical')")
    con.execute("INSERT INTO authorization_permission VALUES ('execution.record','operations')")
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
        faalt("Security-wachtwoordreset geblokkeerd", "UPDATE gebruiker SET wachtwoord_hash=wachtwoord_hash('nieuw-test') WHERE id=%s", (sec_a,), "Kritisch account")
        faalt("Security-rolwijziging geblokkeerd", "UPDATE gebruiker SET rol='analist' WHERE id=%s", (sec_a,), "Kritisch account")
        faalt("Security-account hernoemen geblokkeerd", "UPDATE gebruiker SET gebruikersnaam='andere-naam' WHERE id=%s", (sec_a,), "Kritisch account")
        faalt("App mag bevestigde besluitfunctie niet uitvoeren", "SELECT * FROM authorization_decide_confirmed(%s,%s,true,'Test','demo')", (sec_b,req), "permission denied")
    finally:
        con.execute("RESET ROLE")
    confirm_req = val(submit, (sec_a,target))
    check("Onjuist wachtwoord verleent geen bevoegdheid",
          val("SELECT status FROM authorization_decide_confirmed(%s,%s,true,'Test','onjuist')", (sec_b,confirm_req)) == "denied")
    check("Mislukte herbevestiging heeft geen besluit",
          val("SELECT count(*) FROM authorization_decision WHERE request_id=%s", (confirm_req,)) == 0)
    check("Persoonlijke herbevestiging beslist exacte aanvraag",
          val("SELECT status FROM authorization_decide_confirmed(%s,%s,true,'Test','demo')", (sec_b,confirm_req)) == "decided")
    check("Bevestigd besluit bewaard", val("SELECT count(*) FROM authorization_decision WHERE request_id=%s AND decided_by=%s", (confirm_req,sec_b)) == 1)
    # Ruim testgrants niet op: trek ze in zodat bestaande regressies niet door
    # fictieve security-rechten worden beïnvloed en het testspoor bewaard blijft.
    con.execute("UPDATE authorization_grant SET revoked_at=now() WHERE role_code='test_security'")

    pc = val("SELECT id FROM pc WHERE naam = 'PC-01'")
    op = val("SELECT id FROM operator WHERE naam = 'Operator A'")
    pl = val("SELECT id FROM gebruiker WHERE gebruikersnaam = 'ploegleider1'")
    op_account = val("SELECT id FROM gebruiker WHERE gebruikersnaam = 'operator'")
    kw = val("SELECT id FROM gebruiker WHERE gebruikersnaam = 'kwaliteit1'")
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
          (reg, gs["GS-A"], gid, kw), "ploegleider")
    con.execute("INSERT INTO grondstof_gebruik (stapregistratie_id, grondstof_id, partij, vervangt_id, correctie_reden, gecorrigeerd_door) VALUES (%s,%s,'P-3',%s,'tikfout',%s)",
                (reg, gs["GS-A"], gid, pl))
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
          (b[4], op_account), "of Kwaliteit mag een batch in beoordeling")
    faalt("Keurresultaat zonder eerst in beoordeling",
          "INSERT INTO batch_besluit (batch_id, besluit, reden, besloten_door) VALUES (%s,'afgekeurd','x',%s)",
          (b[4], kw), "in beoordeling")
    con.execute("INSERT INTO batch_besluit (batch_id, besluit, reden, besloten_door) VALUES (%s,'in_beoordeling','kleur wijkt af',%s)", (b[4], pl))
    faalt("Batch in beoordeling kan niet in een lot",
          "SELECT maak_lot('L-2026-0001', %s, %s, %s)", ([b[0], b[1], b[2], b[4]], pc, op), "status in_beoordeling")
    faalt("Ploegleider mag geen keurresultaat invoeren",
          "INSERT INTO batch_besluit (batch_id, besluit, reden, besloten_door) VALUES (%s,'afgekeurd','x',%s)",
          (b[4], pl), "Alleen Kwaliteit")
    faalt("Beheerder mag geen keurresultaat invoeren",
          "INSERT INTO batch_besluit (batch_id, besluit, reden, besloten_door) VALUES (%s,'vrijgegeven','x',%s)",
          (b[4], bh), "Alleen Kwaliteit")
    con.execute("INSERT INTO batch_besluit (batch_id, besluit, reden, besloten_door) VALUES (%s,'afgekeurd','NOK: afvoeren',%s)", (b[4], kw))
    check("Afgekeurde batch heeft status afgekeurd", val("SELECT status FROM batch WHERE id=%s", (b[4],)) == "afgekeurd")
    faalt("Afgekeurde batch kan niet meer vrijgegeven worden",
          "INSERT INTO batch_besluit (batch_id, besluit, reden, besloten_door) VALUES (%s,'vrijgegeven','x',%s)",
          (b[4], kw), "geen besluit meer")
    # Kwaliteit mag ook in beoordeling zetten; OK geeft de batch weer vrij.
    doorloop(b[5], 1, 1)
    con.execute("INSERT INTO batch_besluit (batch_id, besluit, reden, besloten_door) VALUES (%s,'in_beoordeling','steekproef',%s)", (b[5], kw))
    faalt("Batch in beoordeling kan niet naar de volgende stap", "SELECT start_stap('PS2', %s, NULL, %s, %s)", (b[5], pc, op), "in_beoordeling")
    con.execute("INSERT INTO batch_besluit (batch_id, besluit, reden, besloten_door) VALUES (%s,'vrijgegeven','OK',%s)", (b[5], kw))
    check("Keurresultaat OK: batch weer in productie", val("SELECT status FROM batch WHERE id=%s", (b[5],)) == "in_productie")
    reg2 = val("SELECT start_stap('PS2', %s, NULL, %s, %s)", (b[5], pc, op))
    check("Na OK kan de batch door naar de volgende stap", reg2 is not None)
    # NOK terwijl PS2 open staat: die stap wordt afgebroken.
    con.execute("INSERT INTO batch_besluit (batch_id, besluit, reden, besloten_door) VALUES (%s,'in_beoordeling','tweede steekproef',%s)", (b[5], pl))
    con.execute("INSERT INTO batch_besluit (batch_id, besluit, reden, besloten_door) VALUES (%s,'afgekeurd','vervuild',%s)", (b[5], kw))
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
    h17 = val("SELECT start_herbewerking(%s, 'PS17', 'te nat na verpakken', %s, %s)", (lot, pc, op))
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
          (h18, veld["S18.2"], w_oud, op_account), "ploegleider")
    faalt("Correctie zonder reden",
          "INSERT INTO waarde (stapregistratie_id, veld_id, gemeten, vervangt_waarde_id, correctie_reden, gecorrigeerd_door) VALUES (%s,%s,1650,%s,'',%s)",
          (h18, veld["S18.2"], w_oud, pl), "check")
    con.execute("INSERT INTO waarde (stapregistratie_id, veld_id, gemeten, vervangt_waarde_id, correctie_reden, gecorrigeerd_door) VALUES (%s,%s,1650,%s,'tikfout',%s)",
                (h18, veld["S18.2"], w_oud, pl))
    check("Actuele waarde is de correctie", val("SELECT gemeten FROM waarde_actueel WHERE stapregistratie_id=%s AND veld_id=%s", (h18, veld["S18.2"])) == 1650)
    check("Origineel blijft opvraagbaar", val("SELECT gemeten FROM waarde WHERE id=%s", (w_oud,)) == 1640)

    print("\nConfiguratie")
    faalt("Veldcode kan niet veranderen", "UPDATE veld SET code='S1.9' WHERE code='S1.1'", (), "mag niet veranderen")
    faalt("Veld verwijderen kan niet", "DELETE FROM veld WHERE code='S1.1'", (), "inactief")
    con.execute("SELECT set_config('fabriek.gebruiker', 'beheerder1', false)")
    con.execute("UPDATE veld SET tolerantie = 8 WHERE code='S1.1'")
    check("Grenswijziging staat in het logboek",
          val("SELECT count(*) FROM config_log WHERE actie='UPDATE' AND gewijzigd_door='beheerder1'") == 1)
    check("Oude meting houdt de tolerantie van toen (5)",
          val("SELECT tolerantie FROM waarde WHERE veld_id=%s ORDER BY ingevoerd_op LIMIT 1", (veld["S1.1"],)) == 5)

    print("\nBeheer en logboek")
    con.execute("UPDATE gebruiker SET wachtwoord_hash = public.crypt('nieuw-ww', public.gen_salt('bf')) WHERE gebruikersnaam = 'analist1'")
    log = one("SELECT nieuw FROM config_log WHERE tabel = 'gebruiker' ORDER BY id DESC LIMIT 1")[0]
    check("Wachtwoordwijziging gelogd zonder hash", log.get("wachtwoord") == "gewijzigd" and "wachtwoord_hash" not in log)
    faalt("Laatste beheerder kan niet weg", "UPDATE gebruiker SET actief = false WHERE gebruikersnaam = 'beheerder1'", (), "minstens één actieve beheerder")
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
                (pl, reg5a, veld["S5.1"]))
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
    pm = val("SELECT id FROM gebruiker WHERE gebruikersnaam = 'productiemanager1'")
    hb = batch_met("B-2026-0801", prd["PRD-A"])
    for k in range(1, 7):
        doe(hb, f"PS{k}")
    faalt("Ploegleider maakt geen herbewerking aan", "SELECT maak_herbewerking('B-2026-0801', 'PS3', 'kleur', %s)", (pl,), "Kwaliteit of de productiemanager")
    faalt("Herbewerking naar een stap die nog niet doorlopen is", "SELECT maak_herbewerking('B-2026-0801', 'PS8', 'x', %s)", (pm,), "nog niet doorlopen")
    faalt("Batch naar een lotstap", "SELECT maak_herbewerking('B-2026-0801', 'PS17', 'x', %s)", (pm,), "geen batchstap")
    faalt("Herbewerking zonder reden", "SELECT maak_herbewerking('B-2026-0801', 'PS3', '  ', %s)", (pm,), "reden")
    h = val("SELECT maak_herbewerking('B-2026-0801', 'PS3', 'kleur wijkt af na PS6', %s)", (pm,))
    stand = lambda: val("SELECT stand FROM herbewerking_stand WHERE id = %s", (h,))
    check("Nieuwe herbewerking: te plannen", stand() == "te_plannen", stand())
    check("Melding voor vloer, planner, Kwaliteit en productiemanager",
          val("SELECT voor_rollen FROM melding WHERE bron_id = %s", (h,)) == ["ploegleider", "planner", "kwaliteit", "productiemanager"])
    faalt("Tweede open herbewerking voor dezelfde batch", "SELECT maak_herbewerking('B-2026-0801', 'PS4', 'x', %s)", (kw,), "al een herbewerking")
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
    faalt("Batch in beoordeling: productiemanager beslist niet", "SELECT maak_herbewerking('B-2026-0802', 'PS2', 'x', %s)", (pm,), "alleen Kwaliteit")
    h2 = val("SELECT maak_herbewerking('B-2026-0802', 'PS2', 'opnieuw mengen', %s)", (kw,))
    check("Kwaliteit: keurresultaat herbewerken, batch weer in productie",
          val("SELECT besluit FROM batch_besluit WHERE batch_id = %s ORDER BY besloten_op DESC LIMIT 1", (hb2,)) == "herbewerken"
          and val("SELECT status FROM batch WHERE id = %s", (hb2,)) == "in_productie")
    faalt("Intrekken zonder reden", "SELECT trek_herbewerking_in(%s, '', %s)", (h2, kw), "reden")
    con.execute("SELECT trek_herbewerking_in(%s, 'toch niet nodig', %s)", (h2, kw))
    check("Ingetrokken: batch gaat gewoon verder met PS4", val("SELECT stand FROM herbewerking_stand WHERE id = %s", (h2,)) == "ingetrokken" and "B-2026-0802" in voorraad("PS4"))
    faalt("Intrekken kan maar één keer", "SELECT trek_herbewerking_in(%s, 'x', %s)", (h2, kw), "al gestart of ingetrokken")
    h3 = val("SELECT maak_herbewerking('B-2026-0802', 'PS1', 'grondstof verkeerd', %s)", (pm,))
    con.execute("INSERT INTO batch_besluit (batch_id, besluit, reden, besloten_door) VALUES (%s,'in_beoordeling','toch afkeuren',%s)", (hb2, kw))
    con.execute("INSERT INTO batch_besluit (batch_id, besluit, reden, besloten_door) VALUES (%s,'afgekeurd','afvoeren',%s)", (hb2, kw))
    check("Batch afgekeurd: open herbewerking vervalt", val("SELECT stand FROM herbewerking_stand WHERE id = %s", (h3,)) == "ingetrokken")
    # Lot: opdracht vooraf; de oude functie zonder opdracht blijft werken (oudere invoerschermen, D18).
    faalt("Batch die in een lot zit", "SELECT maak_herbewerking((SELECT batchnummer FROM batch WHERE lot_id = %s LIMIT 1), 'PS3', 'x', %s)", (lot, kw), "zit al in een lot")
    hl = val("SELECT maak_herbewerking((SELECT lotnummer FROM lot WHERE id = %s), 'PS17', 'opnieuw drogen', %s)", (lot, kw))
    check("Lot: herbewerking te plannen, lot staat in de werkvoorraad van PS17", val("SELECT stand FROM herbewerking_stand WHERE id = %s", (hl,)) == "te_plannen"
          and val("SELECT lotnummer FROM lot WHERE id = %s", (lot,)) in voorraad("PS17"))
    rl = val("SELECT start_herbewerking(%s, 'PS17', 'opnieuw drogen', %s, %s)", (lot, pc, op))
    check("Start via de oude functie koppelt aan de opdracht", val("SELECT stapregistratie_id FROM herbewerking WHERE id = %s", (hl,)) == rl)
    check("Herbewerkingen zonder opdracht (van vóór #61) staan er ook in, zonder aanmaker",
          val("SELECT count(*) FROM herbewerking_stand WHERE lot_id = %s AND door IS NULL", (lot,)) >= 1)

    print("\nKeuring door Kwaliteit (#64)")
    con.execute("UPDATE veld SET gemeten_door = 'kwaliteit' WHERE code IN ('S18.3', 'S5.2')")
    kw_op = val("SELECT operator_van_account(%s)", (kw,))
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
    faalt("Vrijgeven zonder meting", "SELECT beslis_keuring(%s, 'vrijgegeven', NULL, %s)", (k5, kw), "Nog niet gemeten: S5.2")
    faalt("Ploegleider beslist niet over een keuring", "SELECT beslis_keuring(%s, 'vrijgegeven', NULL, %s)", (k5, pl), "Alleen Kwaliteit")
    con.execute("INSERT INTO waarde (stapregistratie_id, veld_id, gemeten, ingevoerd_door) VALUES (%s,%s,412,%s)", (r5, veld["S5.2"], kw_op))
    check("Kwaliteit meet na het afronden", val("SELECT count(*) FROM waarde WHERE stapregistratie_id = %s AND veld_id = %s", (r5, veld["S5.2"])) == 1)
    con.execute("SELECT beslis_keuring(%s, 'vrijgegeven', NULL, %s)", (k5, kw))
    con.execute("SELECT beslis_keuring(%s, 'vrijgegeven', NULL, %s)", (k5, kw))
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
    faalt("Herbewerken zonder reden", "SELECT beslis_keuring(%s, 'herbewerken', '', %s)", (k5b, kw), "reden")
    con.execute("SELECT beslis_keuring(%s, 'herbewerken', 'te zwaar', %s, 'PS5')", (k5b, kw))
    check("Herbewerken: opdracht terug naar PS5, batch staat daar klaar",
          val("SELECT stand FROM herbewerking_stand WHERE id = (SELECT herbewerking_id FROM keuring WHERE id = %s)", (k5b,)) == "te_plannen"
          and "B-2026-0972" in voorraad("PS5") and "B-2026-0972" not in voorraad("PS6"))
    r5c = val("SELECT start_stap('PS5', %s, NULL, %s, %s)", (kb2, pc, op))
    con.execute("INSERT INTO waarde (stapregistratie_id, veld_id, setting, gemeten, ingevoerd_door) VALUES (%s,%s,80,80.5,%s)", (r5c, veld["S5.1"], op))
    con.execute("SELECT rond_stap_af(%s)", (r5c,))
    k5c = val("SELECT id FROM keuring WHERE stapregistratie_id = %s", (r5c,))
    check("De herbewerkte stap wacht opnieuw op Kwaliteit", k5c is not None and k5c != k5b)
    # Afkeuren: keurresultaat NOK.
    con.execute("SELECT beslis_keuring(%s, 'afgekeurd', 'veel te zwaar', %s)", (k5c, kw))
    check("Afkeuren: batch afgekeurd, met in beoordeling ervoor",
          val("SELECT status FROM batch WHERE id = %s", (kb2,)) == "afgekeurd"
          and [r[0] for r in con.execute("SELECT besluit FROM batch_besluit WHERE batch_id = %s ORDER BY besloten_op", (kb2,))][-2:] == ["in_beoordeling", "afgekeurd"])
    # Lot: na PS18 pas gereed na de vrijgave.
    lots = {r[0]: r[1] for r in con.execute("SELECT lotnummer, id FROM lot WHERE status = 'gereed'")}
    lk = next(iter(lots.values()))
    hk = val("SELECT maak_herbewerking((SELECT lotnummer FROM lot WHERE id = %s), 'PS18', 'opnieuw meten', %s)", (lk, kw))
    r18k = val("SELECT start_stap('PS18', NULL, %s, %s, %s)", (lk, pc, op))
    for code in ("S18.1", "S18.2"):
        con.execute("INSERT INTO waarde (stapregistratie_id, veld_id, setting, gemeten, ingevoerd_door) VALUES (%s,%s,%s,%s,%s)",
                    (r18k, veld[code], 80 if soort[code] == "procesparameter" else None, 81 if code.endswith(".1") else 1640, op))
    con.execute("SELECT rond_stap_af(%s)", (r18k,))
    check("Lot na PS18 nog niet gereed: wacht op Kwaliteit", val("SELECT status FROM lot WHERE id = %s", (lk,)) == "in_productie")
    k18 = val("SELECT id FROM keuring WHERE stapregistratie_id = %s", (r18k,))
    con.execute("INSERT INTO waarde (stapregistratie_id, veld_id, gemeten, ingevoerd_door) VALUES (%s,%s,3.1,%s)", (r18k, veld["S18.3"], kw_op))
    con.execute("SELECT beslis_keuring(%s, 'vrijgegeven', 'droog genoeg', %s)", (k18, kw))
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
          ("PS1", "B-2026-0974", pc, op, nu - dt.timedelta(hours=3), nu - dt.timedelta(hours=2), "storing", opa, w1, g1), "ploegleider of beheerder")
    faalt("Zonder reden kan niet", na,
          ("PS1", "B-2026-0974", pc, op, nu - dt.timedelta(hours=3), nu - dt.timedelta(hours=2), "  ", pl, w1, g1), "reden")
    faalt("Meer dan 7 dagen terug kan niet", na,
          ("PS1", "B-2026-0974", pc, op, nu - dt.timedelta(days=8), nu - dt.timedelta(days=8, hours=-1), "storing", pl, w1, g1), "7 dagen")
    faalt("Einde in de toekomst kan niet", na,
          ("PS1", "B-2026-0974", pc, op, nu - dt.timedelta(hours=1), nu + dt.timedelta(hours=1), "storing", pl, w1, g1), "toekomst")
    faalt("Einde vóór het begin kan niet", na,
          ("PS1", "B-2026-0974", pc, op, nu - dt.timedelta(hours=1), nu - dt.timedelta(hours=2), "storing", pl, w1, g1), "na het begin")
    rn = val(na, ("PS1", "B-2026-0974", pc, op, nu - dt.timedelta(hours=3), nu - dt.timedelta(hours=2), "server en pc uit", pl, w1, g1))
    r = con.execute("""SELECT status, gestart_op, afgerond_op, nageleverd_door, nageleverd_reden, afgerond_door,
                              (SELECT count(*) FROM waarde w WHERE w.stapregistratie_id = r.id AND w.ingevoerd_op = r.afgerond_op)
                         FROM stapregistratie r WHERE id = %s""", (rn,)).fetchone()
    check("Nageleverd: afgerond met de tijden van het papier, waarden op het einde",
          r[0] == "afgerond" and r[1] == nu - dt.timedelta(hours=3) and r[2] == nu - dt.timedelta(hours=2) and r[6] == 2, str(r))
    check("Nageleverd: wie, waarom, en de operator van het papier", r[3] == pl and r[4] == "server en pc uit" and r[5] == op)
    check("Nageleverd: in het logboek",
          val("SELECT count(*) FROM config_log WHERE tabel = 'nalevering' AND record_id = %s", (rn,)) == 1)
    w2 = json.dumps([{"veldcode": c, "setting": 80 if soort[c] == "procesparameter" else None, "gemeten": 81 if c.endswith(".1") else 410}
                     for c in sorted(veld) if c.startswith("S2.")])
    faalt("Begin vóór het einde van de vorige stap kan niet", na,
          ("PS2", "B-2026-0974", pc, op, nu - dt.timedelta(hours=2, minutes=30), nu - dt.timedelta(hours=1), "storing", pl, w2, "[]"), "vóór het einde van de vorige stap")
    faalt("Gewone regels gelden: verplicht veld ontbreekt", na,
          ("PS2", "B-2026-0974", pc, op, nu - dt.timedelta(hours=2), nu - dt.timedelta(hours=1), "storing", pl, "[]", "[]"), "Nog niet ingevuld")
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
             ([f"B-2026-097{i}" for i in range(5, 9)], pc, op, begin, eind, "lot op papier samengesteld", pl, w16))
    lr = con.execute("""SELECT l.aangemaakt_op, r.gestart_op, r.afgerond_op, r.status, (SELECT count(*) FROM batch b WHERE b.lot_id = l.id)
                          FROM stapregistratie r JOIN lot l ON l.id = r.lot_id WHERE r.id = %s""", (rl,)).fetchone()
    check("Lot nageleverd: 4 batches, met de tijden van het papier",
          lr[0] == begin and lr[1] == begin and lr[2] == eind and lr[3] == "afgerond" and lr[4] == 4, str(lr))

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
    kw_op = val("SELECT operator_van_account(%s)", (kw,))
    tk = batch_met("B-2026-0980", prd["PRD-C"])
    for code in ["PS1", "PS2", "PS3"]:
        doe(tk, code)
    check("Werkvoorraad TK1 toont de batch na PS3", "B-2026-0980" in voorraad("TK1"))
    faalt("Een operator start geen keuringsstap", "SELECT start_stap('TK1', %s, NULL, %s, %s)", (tk, pc, op), "is een keuring")
    faalt("Nainvoeren van een keuring kan niet", "SELECT lever_stap_na('TK1', 'B-2026-0980', NULL, %s, %s, now() - interval '2 hours', now() - interval '1 hour', 'papier', %s, '[]', '[]')",
          (pc, kw_op, pl), "is een keuring")
    rtk = val("SELECT start_stap('TK1', %s, NULL, %s, %s)", (tk, pc, kw_op))
    check("Kwaliteit start TK1: meteen afgerond, keuring open",
          one("SELECT r.status, k.status FROM stapregistratie r JOIN keuring k ON k.stapregistratie_id = r.id WHERE r.id = %s", (rtk,)) == ("afgerond", "open"))
    faalt("PS4 wacht op de keuring", "SELECT start_stap('PS4', %s, NULL, %s, %s)", (tk, pc, op), "wacht op Kwaliteit")
    veld_tk = {c: i for c, i in con.execute("SELECT code, id FROM veld WHERE code LIKE 'TK%%' OR code LIKE 'EK%%'")}
    spec_tk1 = val("SELECT id FROM specificatie WHERE processtap_id = %s AND status = 'vastgesteld'", (sid["TK1"],))
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
    con.execute("SELECT beslis_keuring((SELECT id FROM keuring WHERE stapregistratie_id = %s), 'vrijgegeven', NULL, %s)", (rtk, kw))
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
    faalt("Een operator lost geen conflict op", "SELECT los_invoerconflict_op(%s, 'nieuw', %s)", (cid, op_account), "Alleen een ploegleider")
    faalt("Kwaliteit lost een conflict in een veld van Productie niet op", "SELECT los_invoerconflict_op(%s, 'nieuw', %s)", (cid, kw), "Alleen een ploegleider")
    faalt("Een conflict wijzig je niet zomaar", "UPDATE invoerconflict SET gemeten = 1 WHERE id = %s", (cid,), "niet gewijzigd")
    con.execute("SELECT los_invoerconflict_op(%s, 'nieuw', %s, 'weegschaal B is geijkt')", (cid, pl))
    w = one("SELECT gemeten::float, vervangt_waarde_id IS NOT NULL, correctie_reden FROM waarde_actueel WHERE stapregistratie_id = %s AND veld_id = %s", (rc, veld["S1.1"]))
    check("Kiezen voor de tweede: correctie met reden, origineel bewaard",
          w[0] == 83 and w[1] and "Operator B" in w[2] and "geijkt" in w[2]
          and val("SELECT count(*) FROM waarde WHERE stapregistratie_id = %s AND veld_id = %s", (rc, veld["S1.1"])) == 2)
    con.execute("SELECT los_invoerconflict_op(%s, 'nieuw', %s)", (cid, pl))
    check("Hetzelfde besluit opnieuw versturen verandert niets",
          val("SELECT count(*) FROM waarde WHERE stapregistratie_id = %s AND veld_id = %s", (rc, veld["S1.1"])) == 2)
    faalt("Een opgelost conflict kies je niet opnieuw", "SELECT los_invoerconflict_op(%s, 'bestaand', %s)", (cid, bh), "al opgelost door ploegleider1")
    con.execute("INSERT INTO grondstof_gebruik (stapregistratie_id, grondstof_id, partij, ingevoerd_door) VALUES (%s,%s,'LEV-1',%s)", (rc, gs["GS-A"], op))
    check("Zelfde partij (andere hoofdletters) is geen conflict",
          val("SELECT leg_grondstofconflict_vast(%s, %s, ' lev-1', NULL, %s, %s)", (rc, gs["GS-A"], op_b, pc)) == "zelfde")
    check("Andere partij is een conflict",
          val("SELECT leg_grondstofconflict_vast(%s, %s, 'LEV-2', NULL, %s, %s)", (rc, gs["GS-A"], op_b, pc)) == "conflict")
    gcid = val("SELECT id FROM invoerconflict WHERE stapregistratie_id = %s AND grondstof_id IS NOT NULL", (rc,))
    con.execute("SELECT los_invoerconflict_op(%s, 'bestaand', %s)", (gcid, pl))
    check("Kiezen voor de eerste: partij blijft, conflict gesloten",
          val("SELECT partij FROM grondstof_gebruik_actueel WHERE stapregistratie_id = %s AND grondstof_id = %s", (rc, gs["GS-A"])) == "LEV-1"
          and val("SELECT status FROM invoerconflict WHERE id = %s", (gcid,)) == "bestaand")
    con.execute("UPDATE veld SET gemeten_door = 'kwaliteit' WHERE code = 'S1.2'")
    kw_op1 = val("SELECT operator_van_account(%s)", (kw,))
    con.execute("INSERT INTO waarde (stapregistratie_id, veld_id, gemeten, ingevoerd_door) VALUES (%s,%s,410,%s)", (rc, veld["S1.2"], kw_op1))
    val("SELECT leg_invoerconflict_vast(%s, %s, NULL, 415, %s, %s)", (rc, veld["S1.2"], kw_op1, pc))
    kcid = val("SELECT id FROM invoerconflict WHERE stapregistratie_id = %s AND veld_id = %s", (rc, veld["S1.2"]))
    check("Conflict in een veld van Kwaliteit: melding voor Kwaliteit",
          val("SELECT voor_rollen FROM melding WHERE bron_id = %s", (kcid,)) == ["kwaliteit", "beheerder"])
    faalt("Een ploegleider lost een conflict van Kwaliteit niet op", "SELECT los_invoerconflict_op(%s, 'nieuw', %s)", (kcid, pl), "Alleen Kwaliteit")
    con.execute("SELECT los_invoerconflict_op(%s, 'nieuw', %s)", (kcid, kw))
    check("Kwaliteit kiest de tweede meting",
          val("SELECT gemeten::float FROM waarde_actueel WHERE stapregistratie_id = %s AND veld_id = %s", (rc, veld["S1.2"])) == 415)
    faalt("Kwaliteit corrigeert verder niet zelf",
          "INSERT INTO waarde (stapregistratie_id, veld_id, gemeten, vervangt_waarde_id, correctie_reden, gecorrigeerd_door) "
          "SELECT stapregistratie_id, veld_id, 1, id, 'x', %s FROM waarde_actueel WHERE stapregistratie_id = %s AND veld_id = %s",
          (kw, rc, veld["S1.2"]), "ploegleider")
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

    fout = [r for r in resultaten if not r[1]]
    print(f"\n{len(resultaten) - len(fout)} van {len(resultaten)} controles geslaagd")
    sys.exit(1 if fout else 0)


if __name__ == "__main__":
    main()
