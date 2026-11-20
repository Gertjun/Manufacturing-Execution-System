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
          (b[4], op_account), "ploegleider of Kwaliteit")
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
    con.execute("UPDATE stilstand SET eind_op = begin_op + interval '20 minutes' WHERE id = %s", (sid,))
    faalt("Einde twee keer invullen kan niet", "UPDATE stilstand SET eind_op = now() WHERE id = %s", (sid,), "al beëindigd")
    faalt("Stilstand verwijderen kan niet", "DELETE FROM stilstand WHERE id = %s", (sid,), "niet verwijderd")

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
    los = nieuwe_batch("B-2026-0901")
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

    fout = [r for r in resultaten if not r[1]]
    print(f"\n{len(resultaten) - len(fout)} van {len(resultaten)} controles geslaagd")
    sys.exit(1 if fout else 0)


if __name__ == "__main__":
    main()
