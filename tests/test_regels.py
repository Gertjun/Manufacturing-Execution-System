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

    print("\nEigen inlog per persoon (D53)")
    gedeeld = val("SELECT id FROM gebruiker WHERE gebruikersnaam = 'operator'")
    acc_a = val("SELECT id FROM gebruiker WHERE gebruikersnaam = 'operator.a'")
    acc_b = val("SELECT id FROM gebruiker WHERE gebruikersnaam = 'operator.b'")
    op_a = val("SELECT id FROM operator WHERE naam = 'Operator A'")
    op_b = val("SELECT id FROM operator WHERE naam = 'Operator B'")
    op_c = val("SELECT id FROM operator WHERE naam = 'Operator C'")
    pc1 = val("SELECT id FROM pc WHERE naam = 'PC-01'")
    pc2 = val("SELECT id FROM pc WHERE naam = 'PC-02'")
    check("Gedeeld account heeft geen eigen naam (kiest er een)", val("SELECT operator_van_account(%s)", (gedeeld,)) is None)
    check("Eigen account geeft zijn gekoppelde naam", val("SELECT operator_van_account(%s)", (acc_a,)) == op_a)
    pl_op = val("SELECT operator_van_account(%s)", (pl,))
    check("Ploegleider zonder naam krijgt er een, met de gebruikersnaam",
          val("SELECT naam FROM operator WHERE id = %s", (pl_op,)) == "ploegleider1")
    check("Daarna steeds dezelfde naam", val("SELECT operator_van_account(%s)", (pl,)) == pl_op)
    check("Tweede keer dezelfde naam, geen nieuwe", val("SELECT count(*) FROM operator WHERE gebruiker_id = %s", (pl,)) == 1)
    check("Kwaliteit heeft geen operatornaam", val("SELECT operator_van_account(%s)", (kw,)) is None)
    check("Eigen naam: mag", val("SELECT mag_invoeren_namens(%s, %s, %s)", (acc_a, op_a, pc1)))
    check("Naam van een ander zonder inlog op deze pc: mag niet", not val("SELECT mag_invoeren_namens(%s, %s, %s)", (acc_a, op_b, pc1)))
    con.execute("SELECT * FROM inloggen('operator.b', 'demo', 'PC-01')")
    check("Wachtrij na persoonswissel: B logde op deze pc in, A verstuurt: mag", val("SELECT mag_invoeren_namens(%s, %s, %s)", (acc_a, op_b, pc1)))
    check("Maar niet vanaf een andere pc", not val("SELECT mag_invoeren_namens(%s, %s, %s)", (acc_a, op_b, pc2)))
    check("Gedeeld account mag elke naam (zoals voorheen)", val("SELECT mag_invoeren_namens(%s, %s, %s)", (gedeeld, op_c, pc2)))
    check("Naam zonder account, geen gedeeld account op deze pc: mag niet", not val("SELECT mag_invoeren_namens(%s, %s, %s)", (acc_a, op_c, pc2)))
    con.execute("SELECT * FROM inloggen('operator', 'demo', 'PC-02')")
    check("Naam zonder account, gedeeld account logde op deze pc in (oude wachtrij): mag",
          val("SELECT mag_invoeren_namens(%s, %s, %s)", (acc_a, op_c, pc2)))
    con.execute("UPDATE gebruiker SET actief = false WHERE id = %s", (acc_b,))
    check("Uitgezet account heeft geen naam meer", val("SELECT operator_van_account(%s)", (acc_b,)) is None)
    con.execute("UPDATE gebruiker SET actief = true WHERE id = %s", (acc_b,))

    print("\nRoute per product (D55)")
    prd = {c: i for c, i in con.execute("SELECT code, id FROM product")}
    sid = {c: i for c, i in con.execute("SELECT code, id FROM processtap")}

    def routecodes(p):
        return [r[0] for r in con.execute(
            "SELECT s.code FROM route(%s) r JOIN processtap s ON s.id = r.processtap_id ORDER BY r.plek", (p,))]
    check("Zonder product: alle 18 stappen", routecodes(None) == [f"PS{i}" for i in range(1, 19)])
    check("PRD-A zonder eigen route volgt de standaardroute", routecodes(prd["PRD-A"]) == routecodes(None))
    route_c = ["PS1", "PS2", "PS3", "PS4", "PS5", "PS7", "PS8", "PS9", "PS11", "PS10", "PS12", "PS13", "PS15", "PS16", "PS18"]
    check("PRD-C: eigen volgorde (PS11 vóór PS10), zonder PS6, PS14 en PS17", routecodes(prd["PRD-C"]) == route_c, routecodes(prd["PRD-C"]))
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
    check("PS1: 8 per dag voor alle producten, 3 voor PRD-B",
          val("SELECT capaciteit_stap_voor(%s, %s)", (sid["PS1"], prd["PRD-A"])) == 8 and val("SELECT capaciteit_stap_voor(%s, %s)", (sid["PS1"], prd["PRD-B"])) == 3)
    check("PS2: niet ingesteld", val("SELECT capaciteit_stap_voor(%s, %s)", (sid["PS2"], prd["PRD-A"])) is None)
    faalt("Twee regels voor alle producten in één stap", "INSERT INTO capaciteit_stap (processtap_id, max_per_dag) VALUES (%s, 5)", (sid["PS1"],), "unique")
    faalt("Capaciteit 0", "INSERT INTO capaciteit_stap (processtap_id, max_per_dag) VALUES (%s, 0)", (sid["PS2"],), "check")
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

    fout = [r for r in resultaten if not r[1]]
    print(f"\n{len(resultaten) - len(fout)} van {len(resultaten)} controles geslaagd")
    sys.exit(1 if fout else 0)


if __name__ == "__main__":
    main()
