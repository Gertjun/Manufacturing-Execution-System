"""Genereert maanden aan fictieve productie, met bewust ingebouwde afwijkingen.

Alles loopt via de functies en regels van de database (start_stap, maak_lot,
rond_stap_af, batch_besluit ...), dus de data voldoet aan dezelfde regels als echte
invoer. Daarna worden de tijdstippen teruggezet naar de gesimuleerde datum.

Gebruik (op een database met schema.sql + seed_config.sql + seed_accounts_demo.sql, zonder productie):
    python3 tools/genereer_testdata.py "host=localhost user=postgres dbname=batchgui" --dagen 90

Ingebouwde patronen (zodat de analyses iets te vinden hebben):
  * S5.1 Temperatuur loopt de laatste 30 dagen langzaam op: steeds vaker buiten tolerantie.
  * Operator F weegt in een periode van twee weken in PS9 structureel te zwaar.
  * Een "natte week": vochtgehalte S18.3 te hoog, lots gaan terug naar PS17.
  * Ongeveer 2% van de batches gaat in beoordeling; ongeveer een derde daarvan wordt afgekeurd.

Planning (sinds 0.9.0): bijna alle batches zijn door planner1 gepland, met een product;
ongeveer 5% is als uitzondering door een operator aangemaakt. Elk lot heeft een
lotvoorstel; af en toe wijkt de operator af (met reden). Voor de komende werkdagen
staan batches gepland, en voor vandaag een dagplanning per stap.
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
producten = [r[0] for r in con.execute("SELECT id FROM product WHERE actief ORDER BY code")]
stap_grondstoffen: dict = {}
for stap, gid, gcode, eenheid in con.execute(
    """SELECT s.code, g.id, g.code, g.eenheid FROM stap_grondstof x JOIN processtap s ON s.id = x.processtap_id
        JOIN grondstof g ON g.id = x.grondstof_id WHERE x.actief AND g.actief"""):
    stap_grondstoffen.setdefault(stap, []).append((gid, gcode, eenheid))
planner = gebruiker["planner1"]
batchstappen = [s for s in stappen if s[2] == "batch"]
lotstappen = [s for s in stappen if s[2] == "lot"]
# Route per product (D55): batchstappen en lotstappen na de lotstap, in de volgorde van de route.
route_van: dict = {}
for pid in producten + [None]:
    codes = con.execute("""SELECT s.code, s.niveau, s.is_lot_stap FROM route(%s) r JOIN processtap s ON s.id = r.processtap_id
                            ORDER BY r.plek""", (pid,)).fetchall()
    route_van[pid] = ([c for c, n, _ in codes if n == "batch"], [c for c, n, l in codes if n == "lot" and not l])

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
tijd_voorstel: list = []  # (voorstel-id, gemaakt, afgesloten)
tijd_grondstof: list = []  # (registratie-id, tijd)


def partij_voor(gcode, moment):
    """Een nieuwe leverancierspartij ongeveer elke 4 dagen (fictieve nummers)."""
    n = (moment - begin).days // 4 + 1
    return f"LEV-{gcode}-{moment:%y%m}-{n:02d}"
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
    for gid, gcode, eenheid in stap_grondstoffen.get(stapcode, []):
        con.execute("INSERT INTO grondstof_gebruik (stapregistratie_id, grondstof_id, partij, hoeveelheid, ingevoerd_door) VALUES (%s,%s,%s,%s,%s)",
                    (reg, gid, partij_voor(gcode, moment), round(rnd.gauss(120, 4), 1) if eenheid == "kg" else None, oid))
        tijd_grondstof.append((reg, moment + duur * 0.3))
    con.execute("SELECT rond_stap_af(%s)", (reg,))
    tijd_reg[reg] = (moment, moment + duur)
    return reg, moment + duur + dt.timedelta(minutes=rnd.randint(5, 90))


def besluit(batch_id, soort, reden, door, moment):
    bid = con.execute(
        "INSERT INTO batch_besluit (batch_id, besluit, reden, besloten_door) VALUES (%s,%s,%s,%s) RETURNING id",
        (batch_id, soort, reden, gebruiker[door]),
    ).fetchone()[0]
    tijd_besluit.append((bid, moment))


wachtrij_lot: dict = {}  # product -> [(batch_id, klaar_op)]; een lot heeft batches van één product (D55)
def maak_lots(lot_prod, wachtrij):
    route_l = route_van[lot_prod][1]
    while len(wachtrij) >= 4:
        groep, wachtrij = wachtrij[:4], wachtrij[4:]
        moment = max(t for _, t in groep) + dt.timedelta(minutes=rnd.randint(10, 120))
        if moment >= eind:
            wachtrij = groep + wachtrij
            break
        operator = rnd.choice(opnamen)
        lotnr = volgnummer("lot", moment.year)
        # De planner stelde het lot voor; soms wijkt de operator af (met reden).
        afwijken = rnd.random() < 0.08 and wachtrij
        voorstel = [b for b, _ in groep[:3]] + [wachtrij[0][0] if afwijken else groep[3][0]]
        vid = con.execute("SELECT bewaar_lot_voorstel(NULL, %s, NULL, %s)", (voorstel, planner)).fetchone()[0]
        reden = rnd.choice(["batch nog niet klaar", "batch eerst nagekeken", "volgorde in de droger anders"]) if afwijken else None
        lot = con.execute("SELECT maak_lot(%s, %s, %s, %s, NULL, NULL, %s)",
                          (lotnr, [b for b, _ in groep], pcs[15], operators[operator], reden)).fetchone()[0]
        tijd_voorstel.append((vid, moment - dt.timedelta(hours=rnd.uniform(4, 30)), moment))
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
        if moment >= eind - dt.timedelta(hours=2):
            continue  # lot staat klaar voor de eerste lotstap
        for code in route_l:
            _, moment = doe_stap(code, moment, rnd.choice(opnamen), lot_id=lot, nat=nat and code == "PS18")
        vocht = con.execute(
            """SELECT w.gemeten FROM waarde_actueel w JOIN veld v ON v.id = w.veld_id JOIN stapregistratie r ON r.id = w.stapregistratie_id
                WHERE r.lot_id = %s AND v.code = 'S18.3' ORDER BY w.ingevoerd_op DESC LIMIT 1""", (lot,)).fetchone()
        if vocht and vocht[0] > 4.0 and moment < eind - dt.timedelta(hours=2):
            stats["herbewerkingen"] += 1
            moment += dt.timedelta(hours=rnd.uniform(1, 6))
            _, moment = doe_stap(route_l[0], moment, rnd.choice(opnamen), lot_id=lot, herbewerking="te nat na verpakken")
            for code in route_l[1:]:
                _, moment = doe_stap(code, moment, rnd.choice(opnamen), lot_id=lot)
    return wachtrij


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
        if rnd.random() < 0.05:  # uitzondering: ongeplande batch, door de operator aangemaakt
            product = None
            bid = con.execute("INSERT INTO batch (batchnummer, aangemaakt_door) VALUES (%s,%s) RETURNING id", (nummer, operators[operator])).fetchone()[0]
        else:
            product = rnd.choice(producten) if producten else None
            bid = con.execute(
                """INSERT INTO batch (batchnummer, bron, status, geplande_dag, volgorde, product_id, gepland_door)
                   VALUES (%s, 'planner', 'gepland', %s, %s, %s, %s) RETURNING id""",
                (nummer, start.date(), i + 1, product, planner)).fetchone()[0]
        route_b = route_van[product][0]
        tijd_batch[bid] = start
        stats["batches"] += 1
        # Batches van de laatste dag zijn nog onderweg.
        tot = len(route_b) if start < laatste_dag else rnd.randint(0, len(route_b) - 1)
        moment = start
        afgekeurd = False
        beoordeel_bij = rnd.randint(2, len(route_b) - 1) if rnd.random() < 0.02 and tot == len(route_b) else None
        for n, code in enumerate(route_b[:tot], start=1):
            if moment >= eind - dt.timedelta(hours=1):  # niets na het eind van de gesimuleerde periode
                tot = n - 1
                break
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
        if not afgekeurd and tot == len(route_b):
            wachtrij_lot.setdefault(product, []).append((bid, moment))
        elif not afgekeurd and tot < len(route_b) and rnd.random() < 0.5 and moment < eind:
            # Laatste dag: de helft van de lopende batches staat midden in een stap.
            code = route_b[tot]
            pc = pcs[(int(code[2:]) - 1) % len(pcs)]
            reg = con.execute("SELECT start_stap(%s, %s, NULL, %s, %s)", (code, bid, pc, operators[rnd.choice(opnamen)])).fetchone()[0]
            tijd_reg[reg] = (min(moment, eind - dt.timedelta(minutes=10)), None)

    # Lots maken van batches die klaar zijn, per product.
    for lot_prod in list(wachtrij_lot):
        wachtrij_lot[lot_prod] = maak_lots(lot_prod, sorted(wachtrij_lot[lot_prod], key=lambda x: x[1]))
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
        c.executemany("UPDATE grondstof_gebruik SET ingevoerd_op = %s WHERE stapregistratie_id = %s", [(t, r) for r, t in tijd_grondstof])
        c.executemany("UPDATE lot_voorstel SET aangemaakt_op = %s, afgesloten_op = %s WHERE id = %s", [(g, a, v) for v, g, a in tijd_voorstel])
    # Gestart = begin van de eerste stap.
    con.execute("""UPDATE batch b SET gestart_op = r.t
                     FROM (SELECT batch_id, min(gestart_op) AS t FROM stapregistratie WHERE batch_id IS NOT NULL GROUP BY batch_id) r
                    WHERE r.batch_id = b.id""")
    # Aankomst op de server = moment van invoer (testdata is niet offline ingevoerd).
    con.execute("UPDATE stapregistratie SET gestart_ontvangen_op = gestart_op, afgerond_ontvangen_op = afgerond_op")
    con.execute("UPDATE waarde SET ontvangen_op = ingevoerd_op")
    con.execute("UPDATE grondstof_gebruik SET ontvangen_op = ingevoerd_op")
    # Afgebroken stappen (NOK tijdens een open stap) krijgen de tijd van het besluit.
    con.execute("""UPDATE stapregistratie r SET afgerond_op = d.besloten_op
                     FROM batch_besluit d WHERE d.batch_id = r.batch_id AND d.besluit = 'afgekeurd' AND r.status = 'afgebroken'""")
    con.execute("UPDATE stapregistratie SET afgerond_ontvangen_op = afgerond_op WHERE status = 'afgebroken'")

# Twee lopende batches wachten op een keurresultaat (voor "Te beoordelen").
for (bid,) in con.execute("SELECT id FROM batch WHERE status = 'in_productie' ORDER BY aangemaakt_op LIMIT 2").fetchall():
    besluit(bid, "in_beoordeling", rnd.choice(["kleur wijkt af", "afwijkende geur"]), "ploegleider1", eind - dt.timedelta(hours=1))
    with con.transaction():
        con.execute("SET LOCAL session_replication_role = replica")
        con.execute("UPDATE batch_besluit SET besloten_op = %s WHERE id = %s", tijd_besluit[-1][::-1])
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
        con.execute("UPDATE waarde SET ingevoerd_op = %s, ontvangen_op = %s WHERE id = %s", (moment, moment, nid))
    stats["correcties"] = stats.get("correcties", 0) + 1

# ---------- Ploegoverdracht ----------
# De meeste ploegen schrijven een korte overdracht vlak voor het eind (fictieve teksten).
BIJZ = ["Rustige ploeg, alles volgens planning.", "Menger 2 gaf een foutmelding, na herstart weer in orde.",
        "Weegschaal PS9 opnieuw gekalibreerd.", "Grondstof A nieuwe partij aangebroken.", "Twee batches iets later gestart door wachten op grondstof.",
        "Droger had een storing van een half uur.", "Nieuwe collega ingewerkt op PS3.", "Schoonmaak van lijn 1 gedaan."]
AANDACHT = [None, None, "Let op temperatuur in PS5, loopt wat op.", "Filter PS7 moet morgen vervangen worden.",
            "Batch in beoordeling: niet verder zonder akkoord Kwaliteit.", "Voorraad hulpstof C bijna op.", "Monster voor Kwaliteit staat klaar bij PS18."]
n_overdracht = 0
operator_account = gebruiker["operator"]
ploeg_rijen = con.execute("SELECT id, begint, eindigt FROM ploeg WHERE actief").fetchall()
dag = begin.date()
while dag <= eind.date():
    for pid, b, e in ploeg_rijen:
        start = dt.datetime.combine(dag, b)
        stop = dt.datetime.combine(dag if e > b else dag + dt.timedelta(days=1), e)
        moment = stop - dt.timedelta(minutes=rnd.randint(5, 25))
        if moment >= eind or start < begin or rnd.random() > 0.75:
            continue
        con.execute("""INSERT INTO overdracht (dag, ploeg_id, bijzonderheden, aandachtspunten, gebruiker_id, operator_id, geschreven_op)
                       VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                    (dag, pid, rnd.choice(BIJZ), rnd.choice(AANDACHT), operator_account, operators[rnd.choice(opnamen)], moment.astimezone()))
        n_overdracht += 1
    dag += dt.timedelta(days=1)

# ---------- Planning vooruit ----------
# Planner1 plant de komende 5 werkdagen, maakt lotvoorstellen voor wat klaarstaat
# en zet voor vandaag per stap de volgorde.
vandaag = dt.date.today()
# Een dag met minder capaciteit (onderhoud) over een paar dagen; de planner heeft er toch 6 op gezet.
con.execute("INSERT INTO capaciteit_dag (dag, max_batches, reden) VALUES (%s, 4, 'gepland onderhoud lijn 1')", (vandaag + dt.timedelta(days=3),))
plan_dag, gepland_vooruit = vandaag, 0
for _ in range(5):
    plan_dag += dt.timedelta(days=1)
    while plan_dag.weekday() >= 5:
        plan_dag += dt.timedelta(days=1)
    gepland_vooruit += len(con.execute("SELECT plan_batches(%s, %s, %s, NULL, %s)",
                                       (args.per_dag, plan_dag, rnd.choice(producten) if producten else None, planner)).fetchall())
open_batches = con.execute(
    """SELECT b.id, b.product_id FROM batch b WHERE b.status IN ('in_productie', 'gepland')
        ORDER BY (SELECT count(*) FROM stapregistratie r WHERE r.batch_id = b.id AND r.status = 'afgerond') DESC, b.batchnummer""").fetchall()
# Lotvoorstellen per product (D55): de verste batches eerst, hoogstens 3 voorstellen.
per_product: dict = {}
for bid, pid in open_batches:
    per_product.setdefault(pid, []).append(bid)
n_voorstellen = 0
for bid, pid in open_batches:
    groep = per_product[pid]
    if n_voorstellen < 3 and len(groep) >= 4 and groep[0] == bid:
        con.execute("SELECT bewaar_lot_voorstel(NULL, %s, NULL, %s)", (groep[:4], planner))
        per_product[pid] = groep[4:]
        n_voorstellen += 1
# Dagplanning voor vandaag: elke lopende batch in zijn volgende stap.
volgende = con.execute(
    """SELECT b.id, (SELECT s.id FROM route(b.product_id) rt JOIN processtap s ON s.id = rt.processtap_id
                      WHERE s.niveau = 'batch'
                        AND NOT EXISTS (SELECT 1 FROM stapregistratie r WHERE r.batch_id = b.id AND r.processtap_id = s.id AND r.status = 'afgerond')
                      ORDER BY rt.plek LIMIT 1) AS stap
         FROM batch b WHERE b.status IN ('in_productie', 'gepland') AND (b.geplande_dag IS NULL OR b.geplande_dag <= %s)
        ORDER BY b.batchnummer""", (vandaag,)).fetchall()
plek: dict = {}
for bid, stap in volgende:
    if stap is None:
        continue
    plek[stap] = plek.get(stap, 0) + 1
    con.execute("INSERT INTO stapplanning (dag, processtap_id, batch_id, volgorde, aangemaakt_door) VALUES (%s,%s,%s,%s,%s)",
                (vandaag, stap, bid, plek[stap], planner))
# Planning is gemaakt vóór de laatste invoer, niet "nu", en de configuratie vóór de eerste batch.
# Zo is de laatste invoer het laatste tijdstip, en schuift het laptoppakket alles goed naar vandaag.
with con.transaction():
    con.execute("SET LOCAL session_replication_role = replica")
    con.execute("UPDATE config_log SET gewijzigd_op = %s WHERE gewijzigd_op > %s", (begin - dt.timedelta(days=1), begin))
    con.execute("UPDATE batch SET aangemaakt_op = %s WHERE aangemaakt_op > %s", (eind - dt.timedelta(hours=3), eind))
    con.execute("UPDATE lot_voorstel SET aangemaakt_op = %s WHERE aangemaakt_op > %s", (eind - dt.timedelta(hours=3), eind))
    con.execute("UPDATE stapplanning SET aangemaakt_op = %s", (eind - dt.timedelta(hours=3),))
print(f"Planning: {gepland_vooruit} batches gepland voor de komende werkdagen, {n_voorstellen} open lotvoorstellen. Overdrachten: {n_overdracht}.")

# ---------- Stilstand ----------
# Dagelijks schoonmaken aan het eind van de middag, af en toe omstellen, storingen en wachten (fictief).
oorzaak = {c: i for c, i in con.execute("SELECT code, id FROM stilstand_oorzaak")}
stap_id = {c: i for c, i in con.execute("SELECT code, id FROM processtap")}
pc_van_stap = {code: pcs[(int(code[2:]) - 1) % len(pcs)] for code, *_ in stappen}
TOELICHTING = {"STOR-MACH": ["lager maakt lawaai", "transportband loopt vast", "sensor geeft foutmelding", None],
               "STOR-ELEK": ["zekering eruit", "besturing herstart", None], "WACHT-GS": ["grondstof B nog niet geleverd", "pallet nog in ontvangst", None],
               "WACHT-KW": ["wachten op vrijgave monster", None], "OMSTEL": [None], "SCHOON": [None], "ONDERH": ["preventief onderhoud", None], "OVERIG": ["overleg", None]}
n_stil = 0


def stil(code, oz, start, minuten_duur, open_laten=False):
    global n_stil
    eind_stil = None if open_laten else start + dt.timedelta(minutes=minuten_duur)
    con.execute("""INSERT INTO stilstand (processtap_id, oorzaak_id, toelichting, begin_op, eind_op, pc_id, operator_id, gemeld_door)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
                (stap_id[code], oorzaak[oz], rnd.choice(TOELICHTING[oz]), start.astimezone(), eind_stil.astimezone() if eind_stil else None,
                 pc_van_stap[code], operators[rnd.choice(opnamen)], operator_account))
    n_stil += 1


dag = begin
while dag + dt.timedelta(days=1) < eind:
    for code in ("PS3", "PS9", "PS17"):
        stil(code, "SCHOON", dag.replace(hour=21, minute=rnd.randint(0, 20)), rnd.randint(20, 40))
    if dag.weekday() == 0:
        stil("PS5", "ONDERH", dag.replace(hour=6, minute=0), rnd.randint(60, 120))
    for code, *_ in batchstappen + lotstappen:
        # Storingen: PS7 vaker (oude machine), de rest af en toe.
        kans = 0.12 if code == "PS7" else 0.025
        if rnd.random() < kans:
            stil(code, rnd.choice(["STOR-MACH", "STOR-MACH", "STOR-ELEK"]), dag.replace(hour=rnd.randint(7, 19), minute=rnd.randint(0, 59)), rnd.randint(10, 90))
        if rnd.random() < 0.02:
            stil(code, rnd.choice(["WACHT-GS", "WACHT-KW", "OVERIG"]), dag.replace(hour=rnd.randint(7, 19), minute=rnd.randint(0, 59)), rnd.randint(10, 60))
        if rnd.random() < 0.03:
            stil(code, "OMSTEL", dag.replace(hour=rnd.randint(7, 19), minute=rnd.randint(0, 59)), rnd.randint(15, 45))
    dag += dt.timedelta(days=1)
# Een storing die nu nog loopt.
stil("PS7", "STOR-MACH", eind - dt.timedelta(minutes=35), 0, open_laten=True)
print(f"Stilstand: {n_stil} keer.")

# Meldingen krijgen het tijdstip van de gebeurtenis; oudere meldingen zijn al gelezen.
with con.transaction():
    con.execute("SET LOCAL session_replication_role = replica")
    con.execute("""UPDATE melding m SET aangemaakt_op = coalesce(
                       (SELECT ingevoerd_op FROM waarde WHERE id = m.bron_id),
                       (SELECT besloten_op FROM batch_besluit WHERE id = m.bron_id),
                       (SELECT afgesloten_op FROM lot_voorstel WHERE id = m.bron_id),
                       (SELECT begin_op FROM stilstand WHERE id = m.bron_id), m.aangemaakt_op)""")
con.execute("""INSERT INTO melding_gelezen (melding_id, gebruiker_id, gelezen_op)
               SELECT m.id, g.id, m.aangemaakt_op + interval '2 hours' FROM melding m JOIN gebruiker g ON g.rol = ANY(m.voor_rollen)
                WHERE m.aangemaakt_op < %s""", (eind - dt.timedelta(days=1),))

n_waarden = con.execute("SELECT count(*) FROM waarde").fetchone()[0]
n_afw = con.execute("SELECT count(*) FROM waarde_actueel WHERE markering <> 'ok'").fetchone()[0]
print(f"Klaar: {stats['batches']} batches, {stats['lots']} lots, {n_waarden} waarden ({n_afw} afwijkend), "
      f"{stats['herbewerkingen']} herbewerkingen, {stats['beoordeling']} in beoordeling waarvan {stats['afgekeurd']} afgekeurd, "
      f"{stats.get('correcties', 0)} correcties.")
