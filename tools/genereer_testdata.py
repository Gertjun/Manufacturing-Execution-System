"""Genereert maanden aan fictieve productie, met bewust ingebouwde afwijkingen.

Alles loopt via de functies en regels van de database (start_stap, maak_lot,
rond_stap_af, batch_besluit ...), dus de data voldoet aan dezelfde regels als echte
invoer. Daarna worden de tijdstippen teruggezet naar de gesimuleerde datum.

Gebruik (op een database met schema.sql + seed_config.sql, zonder productie):
    python3 tools/genereer_testdata.py "host=localhost user=postgres dbname=batchgui" --dagen 90

Ingebouwde patronen (zodat de analyses iets te vinden hebben):
  * S5.1 Temperatuur loopt de laatste 30 dagen langzaam op: steeds vaker buiten tolerantie.
  * Operator F weegt in een periode van twee weken in PS9 structureel te zwaar.
  * Een "natte week": vochtgehalte S18.3 te hoog, lots gaan terug naar PS17.
  * Ongeveer 2% van de batches gaat in beoordeling; ongeveer een derde daarvan wordt afgekeurd.
"""
import argparse
import datetime as dt
import random
import sys

import psycopg

p = argparse.ArgumentParser()
p.add_argument("dsn", nargs="?", default="host=/tmp port=5433 user=postgres dbname=batchgui")
p.add_argument("--dagen", type=int, default=90)
p.add_argument("--per-dag", type=int, default=6)
p.add_argument("--seed", type=int, default=42)
p.add_argument("--forceer", action="store_true", help="ook als er al productie in de database staat")
args = p.parse_args()

rnd = random.Random(args.seed)
con = psycopg.connect(args.dsn, autocommit=True)
con.execute("SET search_path = fabriek, public")

if not args.forceer and con.execute("SELECT count(*) FROM batch").fetchone()[0] > 0:
    sys.exit("Er staan al batches in de database. Laad schema.sql + seed_config.sql opnieuw, of gebruik --forceer.")

# ---------- configuratie ophalen ----------
stappen = con.execute("SELECT code, volgorde, niveau, is_lot_stap FROM processtap WHERE actief ORDER BY volgorde").fetchall()
velden = {}
for code, vid, naam, soort, stap in con.execute(
    "SELECT v.code, v.id, v.naam, v.soort, s.code FROM veld v JOIN processtap s ON s.id = v.processtap_id WHERE v.actief ORDER BY v.volgnummer"
):
    velden.setdefault(stap, []).append((code, vid, naam, soort))
pcs = [r[0] for r in con.execute("SELECT id FROM pc ORDER BY naam")]
operators = {naam: oid for oid, naam in con.execute("SELECT id, naam FROM operator ORDER BY naam")}
opnamen = sorted(operators)
gebruiker = {n: i for i, n in con.execute("SELECT id, gebruikersnaam FROM gebruiker")}
batchstappen = [s for s in stappen if s[2] == "batch"]
lotstappen = [s for s in stappen if s[2] == "lot"]

eind = dt.datetime.now().replace(minute=0, second=0, microsecond=0) - dt.timedelta(hours=2)
begin = (eind - dt.timedelta(days=args.dagen)).replace(hour=6)
natte_week = (begin + dt.timedelta(days=int(args.dagen * 0.45)), begin + dt.timedelta(days=int(args.dagen * 0.45) + 7))
zware_periode = (begin + dt.timedelta(days=int(args.dagen * 0.6)), begin + dt.timedelta(days=int(args.dagen * 0.6) + 14))

# Tijdstippen die na afloop worden teruggezet.
tijd_reg: dict = {}      # registratie-id -> (gestart, afgerond|None)
tijd_waarde: list = []   # (registratie-id, tijd)
tijd_batch: dict = {}
tijd_lot: dict = {}
tijd_besluit: list = []  # (besluit-id, tijd)
teller = {"batch": {}, "lot": {}}
stats = {"batches": 0, "lots": 0, "herbewerkingen": 0, "beoordeling": 0, "afgekeurd": 0}


def volgnummer(soort, jaar):
    teller[soort][jaar] = teller[soort].get(jaar, 0) + 1
    return f"{'B' if soort == 'batch' else 'L'}-{jaar}-{teller[soort][jaar]:04d}"


def waarde_voor(stapcode, veldcode, naam, soort, moment, operator, nat=False):
    """Fictieve meting met ruis en de ingebouwde patronen."""
    fractie = (moment - begin) / (eind - begin)
    if naam == "Temperatuur":
        setting = 95 if stapcode in ("PS17",) else 80
        gemeten = rnd.gauss(setting, 1.6)
        if veldcode == "S5.1" and fractie > 1 - 30 / args.dagen:
            gemeten += 7.5 * (fractie - (1 - 30 / args.dagen)) / (30 / args.dagen)  # sluipende stijging
        return setting, round(gemeten, 1)
    if naam == "Gewicht":
        if stapcode in ("PS16", "PS17", "PS18"):
            return None, round(rnd.gauss(1640, 22), 1)
        g = rnd.gauss(410, 7)
        if stapcode == "PS9" and operator == "Operator F" and zware_periode[0] <= moment < zware_periode[1]:
            g += rnd.gauss(28, 4)
        return None, round(g, 1)
    if naam == "Druk":
        return 5, round(rnd.gauss(5, 0.17), 2)
    if naam == "Toerental":
        return 800, round(rnd.gauss(800, 16))
    if naam == "Vochtgehalte":
        return None, round(max(1.5, rnd.gauss(4.7 if nat else 3.0, 0.45 if nat else 0.35)), 2)
    return None, round(rnd.uniform(1, 10), 2)


def doe_stap(stapcode, moment, operator, batch_id=None, lot_id=None, herbewerking=None, nat=False):
    pc = pcs[(int(stapcode[2:]) - 1) % len(pcs)]
    oid = operators[operator]
    if herbewerking:
        reg = con.execute("SELECT start_herbewerking(%s, %s, %s, %s, %s)", (lot_id, stapcode, herbewerking, pc, oid)).fetchone()[0]
    else:
        reg = con.execute("SELECT start_stap(%s, %s, %s, %s, %s)", (stapcode, batch_id, lot_id, pc, oid)).fetchone()[0]
    duur = dt.timedelta(minutes=rnd.randint(20, 70))
    for code, vid, naam, soort in velden.get(stapcode, []):
        setting, gemeten = waarde_voor(stapcode, code, naam, soort, moment, operator, nat)
        con.execute(
            "INSERT INTO waarde (stapregistratie_id, veld_id, setting, gemeten, ingevoerd_door) VALUES (%s,%s,%s,%s,%s)",
            (reg, vid, setting if soort == "procesparameter" else None, gemeten, oid),
        )
        tijd_waarde.append((reg, moment + duur * 0.8))
    con.execute("SELECT rond_stap_af(%s)", (reg,))
    tijd_reg[reg] = (moment, moment + duur)
    return reg, moment + duur + dt.timedelta(minutes=rnd.randint(5, 90))


def besluit(batch_id, soort, reden, door, moment):
    bid = con.execute(
        "INSERT INTO batch_besluit (batch_id, besluit, reden, besloten_door) VALUES (%s,%s,%s,%s) RETURNING id",
        (batch_id, soort, reden, gebruiker[door]),
    ).fetchone()[0]
    tijd_besluit.append((bid, moment))


wachtrij_lot = []  # (batch_id, klaar_op)
dag = begin
laatste_dag = eind - dt.timedelta(days=1)
print(f"Genereren van {args.dagen} dagen vanaf {begin:%d-%m-%Y} ...")
while dag < eind:
    for i in range(args.per_dag):
        start = dag + dt.timedelta(hours=i * 2.5 + rnd.uniform(0, 1))
        if start >= eind:
            break
        nummer = volgnummer("batch", start.year)
        operator = rnd.choice(opnamen)
        bid = con.execute("INSERT INTO batch (batchnummer, aangemaakt_door) VALUES (%s,%s) RETURNING id", (nummer, operators[operator])).fetchone()[0]
        tijd_batch[bid] = start
        stats["batches"] += 1
        # Batches van de laatste dag zijn nog onderweg.
        tot = len(batchstappen) if start < laatste_dag else rnd.randint(0, len(batchstappen) - 1)
        moment = start
        afgekeurd = False
        beoordeel_bij = rnd.randint(2, 14) if rnd.random() < 0.02 and tot == len(batchstappen) else None
        for n, (code, *_rest) in enumerate(batchstappen[:tot], start=1):
            operator = rnd.choice(opnamen)
            _, moment = doe_stap(code, moment, operator, batch_id=bid)
            if beoordeel_bij == n:
                stats["beoordeling"] += 1
                besluit(bid, "in_beoordeling", rnd.choice(["kleur wijkt af", "steekproef", "afwijkende geur", "visuele afwijking"]), "ploegleider1", moment)
                moment += dt.timedelta(hours=rnd.uniform(2, 20))
                if rnd.random() < 0.35:
                    besluit(bid, "afgekeurd", rnd.choice(["buiten specificatie", "vervuiling", "kleur buiten specificatie"]), "kwaliteit1", moment)
                    stats["afgekeurd"] += 1
                    afgekeurd = True
                    break
                besluit(bid, "vrijgegeven", "binnen specificatie", "kwaliteit1", moment)
        if not afgekeurd and tot == len(batchstappen):
            wachtrij_lot.append((bid, moment))
        elif not afgekeurd and tot < len(batchstappen) and rnd.random() < 0.5 and moment < eind:
            # Laatste dag: de helft van de lopende batches staat midden in een stap.
            code = batchstappen[tot][0]
            pc = pcs[(int(code[2:]) - 1) % len(pcs)]
            reg = con.execute("SELECT start_stap(%s, %s, NULL, %s, %s)", (code, bid, pc, operators[rnd.choice(opnamen)])).fetchone()[0]
            tijd_reg[reg] = (min(moment, eind - dt.timedelta(minutes=10)), None)

    # Lots maken van batches die klaar zijn.
    wachtrij_lot.sort(key=lambda x: x[1])
    while len(wachtrij_lot) >= 4:
        groep, wachtrij_lot = wachtrij_lot[:4], wachtrij_lot[4:]
        moment = max(t for _, t in groep) + dt.timedelta(minutes=rnd.randint(10, 120))
        if moment >= eind:
            wachtrij_lot = groep + wachtrij_lot
            break
        operator = rnd.choice(opnamen)
        lotnr = volgnummer("lot", moment.year)
        lot = con.execute("SELECT maak_lot(%s, %s, %s, %s)", (lotnr, [b for b, _ in groep], pcs[15], operators[operator])).fetchone()[0]
        tijd_lot[lot] = moment
        stats["lots"] += 1
        ps16 = con.execute("SELECT r.id FROM stapregistratie r WHERE r.lot_id = %s", (lot,)).fetchone()[0]
        duur = dt.timedelta(minutes=rnd.randint(30, 60))
        for code, vid, naam, soort in velden.get("PS16", []):
            setting, gemeten = waarde_voor("PS16", code, naam, soort, moment, operator)
            con.execute("INSERT INTO waarde (stapregistratie_id, veld_id, setting, gemeten, ingevoerd_door) VALUES (%s,%s,%s,%s,%s)",
                        (ps16, vid, setting if soort == "procesparameter" else None, gemeten, operators[operator]))
            tijd_waarde.append((ps16, moment + duur * 0.8))
        con.execute("SELECT rond_stap_af(%s)", (ps16,))
        tijd_reg[ps16] = (moment, moment + duur)
        moment += duur + dt.timedelta(minutes=rnd.randint(10, 60))
        nat = natte_week[0] <= moment < natte_week[1]
        _, moment = doe_stap("PS17", moment, rnd.choice(opnamen), lot_id=lot)
        _, moment = doe_stap("PS18", moment, rnd.choice(opnamen), lot_id=lot, nat=nat)
        vocht = con.execute(
            """SELECT w.gemeten FROM waarde_actueel w JOIN veld v ON v.id = w.veld_id JOIN stapregistratie r ON r.id = w.stapregistratie_id
                WHERE r.lot_id = %s AND v.code = 'S18.3' ORDER BY w.ingevoerd_op DESC LIMIT 1""", (lot,)).fetchone()
        if vocht and vocht[0] > 4.0:
            stats["herbewerkingen"] += 1
            moment += dt.timedelta(hours=rnd.uniform(1, 6))
            _, moment = doe_stap("PS17", moment, rnd.choice(opnamen), lot_id=lot, herbewerking="te nat na verpakken")
            _, moment = doe_stap("PS18", moment, rnd.choice(opnamen), lot_id=lot)
    dag += dt.timedelta(days=1)

# ---------- tijdstippen terugzetten ----------
print("Tijdstippen terugzetten ...")
with con.transaction():
    con.execute("SET LOCAL session_replication_role = replica")  # regels en logboek tijdelijk uit
    with con.cursor() as c:
        c.executemany("UPDATE stapregistratie SET gestart_op = %s, afgerond_op = CASE WHEN afgerond_op IS NULL THEN NULL ELSE %s::timestamptz END WHERE id = %s",
                      [(g, a, r) for r, (g, a) in tijd_reg.items()])
        c.executemany("UPDATE waarde SET ingevoerd_op = %s WHERE stapregistratie_id = %s", [(t, r) for r, t in tijd_waarde])
        c.executemany("UPDATE batch SET aangemaakt_op = %s WHERE id = %s", [(t, b) for b, t in tijd_batch.items()])
        c.executemany("UPDATE lot SET aangemaakt_op = %s WHERE id = %s", [(t, l) for l, t in tijd_lot.items()])
        c.executemany("UPDATE batch_besluit SET besloten_op = %s WHERE id = %s", [(t, b) for b, t in tijd_besluit])
    # Afgebroken stappen (NOK tijdens een open stap) krijgen de tijd van het besluit.
    con.execute("""UPDATE stapregistratie r SET afgerond_op = d.besloten_op
                     FROM batch_besluit d WHERE d.batch_id = r.batch_id AND d.besluit = 'afgekeurd' AND r.status = 'afgebroken'""")

# Twee lopende batches wachten op een keurresultaat (voor "Te beoordelen").
for (bid,) in con.execute("SELECT id FROM batch WHERE status = 'in_productie' ORDER BY aangemaakt_op LIMIT 2").fetchall():
    con.execute("INSERT INTO batch_besluit (batch_id, besluit, reden, besloten_door) VALUES (%s,'in_beoordeling',%s,%s)",
                (bid, rnd.choice(["kleur wijkt af", "afwijkende geur"]), gebruiker["ploegleider1"]))
    stats["beoordeling"] += 1

# Enkele correcties door ploegleiders (tikfouten en verkeerd afgelezen waarden).
kandidaten = con.execute("""SELECT w.id, w.setting, w.gemeten, w.ingevoerd_op, v.naam FROM waarde_actueel w JOIN veld v ON v.id = w.veld_id
                             WHERE w.markering <> 'ok' AND v.naam IN ('Temperatuur', 'Gewicht') ORDER BY w.ingevoerd_op""").fetchall()
for wid, setting, gemeten, op, naam in rnd.sample(kandidaten, min(6, len(kandidaten))):
    nieuw = round(float(setting) + rnd.uniform(-1.5, 1.5), 1) if naam == "Temperatuur" else round(rnd.gauss(410, 5), 1)
    reden = rnd.choice(["tikfout", "verkeerd afgelezen"] + (["weegschaal niet op nul gezet"] if naam == "Gewicht" else ["sensor afgelezen in plaats van display"]))
    door = rnd.choice(["ploegleider1", "ploegleider2"])
    nid = con.execute("""INSERT INTO waarde (stapregistratie_id, veld_id, setting, gemeten, vervangt_waarde_id, correctie_reden, gecorrigeerd_door)
                          SELECT stapregistratie_id, veld_id, setting, %s, id, %s, %s FROM waarde WHERE id = %s RETURNING id""",
                       (nieuw, reden, gebruiker[door], wid)).fetchone()[0]
    with con.transaction():
        con.execute("SET LOCAL session_replication_role = replica")
        moment = min(op + dt.timedelta(hours=rnd.uniform(1, 8)), eind.astimezone())  # nooit in de toekomst
        con.execute("UPDATE waarde SET ingevoerd_op = %s WHERE id = %s", (moment, nid))
    stats["correcties"] = stats.get("correcties", 0) + 1

n_waarden = con.execute("SELECT count(*) FROM waarde").fetchone()[0]
n_afw = con.execute("SELECT count(*) FROM waarde_actueel WHERE markering <> 'ok'").fetchone()[0]
print(f"Klaar: {stats['batches']} batches, {stats['lots']} lots, {n_waarden} waarden ({n_afw} afwijkend), "
      f"{stats['herbewerkingen']} herbewerkingen, {stats['beoordeling']} in beoordeling waarvan {stats['afgekeurd']} afgekeurd, "
      f"{stats.get('correcties', 0)} correcties.")
