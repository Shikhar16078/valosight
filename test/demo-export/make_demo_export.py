#!/usr/bin/env python3
"""Build a fabricated Riot data export for demos and testing: Demo_Player-DEMO.zip.

Everything in it is invented. It follows the *format* of a real Riot export (file names, field
names, value shapes) but every value is generated here from a fixed random seed, so the file is
the same on every run. Nothing is copied from anyone's export:

  - the player is "Demo Player#DEMO" (EU realm, store in Germany, pays in EUR)
  - IP addresses come only from the ranges reserved for documentation (RFC 5737: 192.0.2.0/24,
    198.51.100.0/24, 203.0.113.0/24), which never belong to a real network
  - the email is @example.com (reserved for examples, RFC 2606); IDs are random UUIDs
  - every item is a real, public VALORANT item (skins with their real levels and variants, bundles, battle
    passes on Riot's real act calendar, Kingdom Credits accessories), bought at store prices and never before it
    went on sale; Riot's own filler names ("Assorted BP Items", CatalogEntry_…) are copied as Riot writes them

Usage:
  python3 test/demo-export/make_demo_export.py                       # writes the zip next to this file
  python3 test/demo-export/make_demo_export.py --out /tmp/demo.zip  # writes it somewhere else (CI's freshness check)
  python3 test/demo-export/make_demo_export.py --check-against X.zip # also proves no value from a real
                                                                     # export X appears in the demo (read-only)
"""
from __future__ import annotations

import argparse
import io
import json
import os
import random
import sys
import uuid
from collections import Counter
import zipfile
from datetime import datetime, timedelta, timezone

SEED = 20261122
START = datetime(2022, 6, 14, 17, 21, 9, tzinfo=timezone.utc)  # account created (just before Episode 5)
END = datetime(2026, 10, 28, 21, 0, tzinfo=timezone.utc)  # data up to (the "export date")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Demo_Player-DEMO.zip")
ZIP_TIME = (2026, 10, 29, 9, 0, 0)  # fixed, so the zip is byte-identical on every run

rng = random.Random(SEED)


def uid() -> str:
    return str(uuid.UUID(int=rng.getrandbits(128), version=4))


def ts(d: datetime) -> str:  # "2024-03-05 19:22:41", Riot's usual format
    return d.strftime("%Y-%m-%d %H:%M:%S")


def ts_us(d: datetime) -> str:  # store purchases carry microseconds
    return d.strftime("%Y-%m-%d %H:%M:%S.") + f"{rng.randrange(1_000_000):06d}"


def secs(a: int, b: int) -> timedelta:
    return timedelta(seconds=rng.randint(a, b))


def day_of(s: str) -> datetime:
    return datetime.fromisoformat(s + "T00:00:00+00:00")


def evening(d: datetime) -> datetime:  # European evening, when people play and shop
    return d.replace(hour=rng.choice([16, 17, 18, 18, 19, 19, 20, 20, 21]), minute=rng.randrange(60), second=rng.randrange(60))


# --------------------------------------------------------------------------- network
# Only documentation ranges (RFC 5737). The home ISP hands out a new address every few weeks (like a real
# dynamic line); the phone hotspot, friends' places and trips use others; one address is an intruder.
HOME_POOL = [f"192.0.2.{n}" for n in range(10, 250)]
AWAY_POOL = [f"198.51.100.{n}" for n in range(5, 250)]
INTRUDER_IP = "203.0.113.66"
rng.shuffle(HOME_POOL)
rng.shuffle(AWAY_POOL)
AWAY_IPS = AWAY_POOL[:46]


def home_ip(day: datetime) -> str:
    return HOME_POOL[((day - START).days // 19) % len(HOME_POOL)]


# --------------------------------------------------------------------------- matches + logins
MODES = [  # (game_mode, game_type, weight, minutes, available from)
    ("Matchmaking", "Ranked", 49, (28, 47), None),
    ("Matchmaking", "Swiftplay", 11, (11, 19), "2022-07-12"),
    ("Matchmaking", "Deathmatch", 8, (8, 10), None),
    ("Matchmaking", "Hurm", 8, (9, 13), "2023-06-27"),  # Team Deathmatch
    ("Matchmaking", "Spike Rush", 5.6, (9, 15), None),
    ("ShootingRange", "Not Applicable", 5.5, (4, 15), None),
    ("Matchmaking", "Unrated", 5.4, (26, 44), None),
    ("Custom Game", "Not Applicable", 4.5, (15, 40), None),
    ("Matchmaking", "Skirmish2V2", 1.1, (6, 10), "2025-01-08"),
    ("Matchmaking", "Ggteam", 0.5, (14, 20), None),  # Escalation
    ("Matchmaking", "Unknown", 0.5, (10, 30), None),
    ("Matchmaking", "Abilitydraftarena", 0.5, (12, 20), "2026-03-18"),
    ("Matchmaking", "Newmap", 0.35, (26, 44), None),
    ("Matchmaking", "Skirmishascension2V2", 0.25, (6, 10), "2026-06-24"),
]
BREAKS = [(datetime(2023, 8, 1, tzinfo=timezone.utc), datetime(2023, 8, 24, tzinfo=timezone.utc)),   # summer holiday
          (datetime(2024, 12, 20, tzinfo=timezone.utc), datetime(2025, 1, 4, tzinfo=timezone.utc)),  # winter trip
          (datetime(2025, 5, 3, tzinfo=timezone.utc), datetime(2025, 7, 10, tzinfo=timezone.utc))]   # exams

matches, logins = [], []
win_streak_bias = 0.0
day = START
first = True
while day < END - timedelta(days=1):
    if any(a <= day < b for a, b in BREAKS):
        day += timedelta(days=1)
        continue
    weekend = day.weekday() >= 4
    if first or rng.random() < (0.66 if weekend else 0.42):
        away = rng.random() < 0.06
        ip = rng.choice(AWAY_IPS) if away else home_ip(day)
        t = START + secs(600, 900) if first else evening(day)
        logins += [
            {"event_time_utc": ts(t), "event_type": "Login", "ip_address": ip, "product": "riot_client"},
            {"event_time_utc": ts(t + secs(1, 4)), "event_type": "Authentication", "ip_address": ip, "product": "rso-authenticator-prod"},
        ]
        if rng.random() < 0.3:
            logins.append({"event_time_utc": ts(t + secs(3, 8)), "event_type": "Authentication", "ip_address": ip, "product": "rso-prod"})
        t += secs(40, 150)
        avail = [m for m in MODES if not m[4] or day >= day_of(m[4])]
        for k in range(1 if first else rng.choice([1, 1, 2, 2, 3, 3, 3, 4, 4, 5, 6])):
            if first:
                mode, gtype, lo, hi = "New Player Experience", "Not Applicable", 12, 18
            else:
                mode, gtype, _, (lo, hi), _ = rng.choices(avail, weights=[m[2] for m in avail])[0]
            start = t + secs(30, 240)  # queue
            end = start + timedelta(minutes=rng.randint(lo, hi), seconds=rng.randrange(60))
            if end >= END:
                break
            if mode == "Matchmaking":
                win = rng.random() < 0.49 + win_streak_bias
                win_streak_bias = max(-0.08, min(0.08, win_streak_bias + (0.03 if win else -0.03)))
            else:
                win = False  # Riot records range, custom and tutorial games as losses
            matches.append({"game_end_time_utc": ts(end), "game_id": uid(), "game_mode": mode, "game_outcome": "Win" if win else "Loss",
                            "game_start_time_utc": ts(start), "game_type": gtype, "realm_id": "eu"})
            for c in range(rng.choice([2, 3, 3, 4, 4, 5])):
                logins.append({"event_time_utc": ts(start + secs(5, 50) * (c + 1)), "event_type": "Connected", "ip_address": ip, "product": "VALORANT"})
            t = end
        first = False
        logins.append({"event_time_utc": ts(t + secs(20, 200)), "event_type": "Closed", "ip_address": ip, "product": "VALORANT"})
        if rng.random() < 0.62:
            logins.append({"event_time_utc": ts(t + secs(300, 900)), "event_type": "Purged", "ip_address": ip, "product": "VALORANT"})
        elif rng.random() < 0.3:
            logins.append({"event_time_utc": ts(t + secs(300, 900)), "event_type": "Expired", "ip_address": ip, "product": "VALORANT"})
        logins.append({"event_time_utc": ts(t + secs(210, 400)), "event_type": rng.choice(["Logout", "Logout", "Disconnect"]), "ip_address": ip, "product": "riot_client"})
    day += timedelta(days=1)

# The incident the Security page should surface: a night-time login from an unknown network.
INCIDENT = datetime(2025, 3, 18, 2, 47, 12, tzinfo=timezone.utc)
logins += [
    {"event_time_utc": ts(INCIDENT), "event_type": "Login", "ip_address": INTRUDER_IP, "product": "riot_client"},
    {"event_time_utc": ts(INCIDENT + secs(2, 3)), "event_type": "Authentication", "ip_address": INTRUDER_IP, "product": "rso-authenticator-prod"},
    {"event_time_utc": ts(INCIDENT + secs(90, 120)), "event_type": "Connected", "ip_address": INTRUDER_IP, "product": "VALORANT"},
    {"event_time_utc": ts(INCIDENT + secs(600, 700)), "event_type": "Session Kicked Out", "ip_address": INTRUDER_IP, "product": "riot_client"},
]
for k, d in enumerate([START, datetime(2023, 4, 2, 18, 12, tzinfo=timezone.utc), datetime(2024, 9, 8, 17, 1, tzinfo=timezone.utc),
                       INCIDENT + timedelta(hours=15, minutes=11)]):
    logins.append({"event_time_utc": ts(d + secs(60, 300)), "event_type": "Authentication", "ip_address": home_ip(d), "product": "accountodactyl-prod"})
logins.sort(key=lambda r: r["event_time_utc"])
matches.sort(key=lambda r: r["game_start_time_utc"])

# --------------------------------------------------------------------------- the store: real VALORANT items
# Public game data (valorant-api.com): real skin names, their editions' store prices, how many upgrade levels
# they have and their variants' names, and roughly when each went on sale (never bought before that).
SEL, DLX, PRM, EXC, ULT, CHMP = 875, 1275, 1775, 2175, 2475, 2675
V_PRIME = ["Orange", "Blue", "Yellow"]
V_REAVER = ["Red", "Black", "White"]
V_ONI = ["Kumo", "Hana", "Tsubame"]
V_SOV = ["Green", "Silver", "Purple"]
V_GAIA = ["Blue", "Green", "Orange"]
V_ORIGIN = ["Green", "Red", "White"]
V_GLITCH = ["Blue", "Red", "Gold"]
V_SPECTRUM = ["Black", "Red", "Purple/Pink"]
V_SING = ["Blue", "Red", "Purple"]
V_RGX = ["Red", "Blue", "Yellow"]
V_SOL = ["Pink", "Red/Green", "Blue/Purple"]
V_RUIN = ["Purple", "Red/Yellow", "Green"]
V_MYST = ["Blue", "Orange", "Purple"]
V_IMP = ["Ruby", "Pearl", "Obsidian"]
V_NEO = ["Gold", "Silver", "Copper"]
V_ELDER = ["Red", "Blue", "Dark"]
V_PROTO = ["White/Pink", "Red/Blue", "Green"]
V_ION = ["Green", "Yellow", "Blue"]
SKINS = [  # (name, VP price, upgrade levels, variant colours, on sale from)
    ("Glitchpop Judge", EXC, 4, V_GLITCH, "2020-09"), ("Prime Spectre", PRM, 4, V_PRIME, "2020-06"), ("Prime Classic", PRM, 4, V_PRIME, "2020-06"),
    ("Prime Guardian", PRM, 4, V_PRIME, "2020-06"), ("Reaver Vandal", PRM, 4, V_REAVER, "2020-10"), ("Reaver Phantom", PRM, 4, V_REAVER, "2023-02"),
    ("Reaver Sheriff", PRM, 4, V_REAVER, "2020-10"), ("Reaver Guardian", PRM, 4, V_REAVER, "2020-10"), ("Reaver Spectre", PRM, 4, V_REAVER, "2023-02"),
    ("Reaver Ghost", PRM, 4, V_REAVER, "2023-02"), ("Oni Bulldog", PRM, 4, V_ONI, "2020-07"), ("Oni Vandal", PRM, 4, V_ONI, "2023-09"),
    ("Oni Shorty", PRM, 4, V_ONI, "2020-07"), ("Oni Guardian", PRM, 4, V_ONI, "2020-07"), ("Ion Phantom", PRM, 4, [], "2020-12"),
    ("Ion Vandal", PRM, 4, V_ION, "2023-06"), ("Ion Operator", PRM, 4, [], "2020-12"), ("Ion Ares", PRM, 4, V_ION, "2023-06"),
    ("Magepunk Marshal", PRM, 4, ["Green", "Purple", "Orange"], "2021-08"), ("Magepunk Guardian", PRM, 4, ["Green", "Pink", "Orange"], "2021-08"), ("Magepunk Spectre", PRM, 4, ["Green", "Purple", "Orange"], "2021-08"),
    ("Gaia's Vengeance Phantom", PRM, 4, V_GAIA, "2022-01"), ("Gaia's Vengeance Ghost", PRM, 4, V_GAIA, "2022-01"),
    ("Magepunk Ghost", PRM, 4, ["Green", "Purple", "Orange"], "2021-08"), ("Magepunk Sheriff", PRM, 4, ["Green", "Pink", "Orange"], "2021-08"),
    ("Prime//2.0 Phantom", PRM, 4, ["Gold", "Green", "Orange"], "2022-03"), ("Forsaken Vandal", PRM, 4, ["Gold"], "2021-02"),
    ("Forsaken Spectre", PRM, 4, ["Gold"], "2021-02"), ("Recon Spectre", PRM, 4, ["Red Camo", "Blue Camo", "Green Camo"], "2021-05"),
    ("Recon Ghost", PRM, 3, [], "2021-05"), ("Origin Vandal", PRM, 4, V_ORIGIN, "2021-11"), ("Origin Bucky", PRM, 4, V_ORIGIN, "2021-11"),
    ("Valiant Hero Vandal", PRM, 4, ["Sunset", "Dusk", "Night"], "2024-02"), ("Doodle Buds Phantom", PRM, 2, [], "2022-09"),
    ("Xenohunter Phantom", PRM, 2, [], "2022-06"), ("Gravitational Uranium Neuroblaster Bucky", PRM, 2, [], "2023-03"),
    ("Ego Vandal", PRM, 1, [], "2021-09"), ("Tethered Realms Vandal", PRM, 1, [], "2021-12"), ("Spline Phantom", PRM, 1, [], "2021-04"),
    ("Glitchpop Phantom", EXC, 4, V_GLITCH, "2020-09"), ("Glitchpop Frenzy", EXC, 4, V_GLITCH, "2020-09"), ("Glitchpop Odin", EXC, 4, V_GLITCH, "2020-09"),
    ("Singularity Phantom", EXC, 4, V_SING, "2021-03"), ("Singularity Sheriff", EXC, 4, V_SING, "2021-03"),
    ("Spectrum Phantom", EXC, 4, V_SPECTRUM, "2021-09"), ("Spectrum Guardian", EXC, 4, V_SPECTRUM, "2021-09"), ("Spectrum Bulldog", EXC, 4, V_SPECTRUM, "2021-09"),
    ("RGX 11z Pro Operator", EXC, 5, V_RGX, "2021-03"), ("RGX 11z Pro Frenzy", EXC, 5, V_RGX, "2021-03"),
    ("Sentinels of Light Vandal", EXC, 4, V_SOL, "2021-06"), ("Sentinels of Light Sheriff", EXC, 4, V_SOL, "2021-06"),
    ("Ruination Phantom", EXC, 4, V_RUIN, "2021-07"), ("Ruination Ghost", EXC, 4, V_RUIN, "2021-07"), ("Ruination Guardian", EXC, 4, V_RUIN, "2021-07"),
    ("BlastX Odin", EXC, 4, ["Black", "Yellow", "Pink"], "2022-10"), ("BlastX Phantom", EXC, 4, ["Black", "Yellow", "Pink"], "2022-10"),
    ("ChronoVoid Phantom", EXC, 4, ["Purple", "Red", "Black"], "2022-12"), ("Neo Frontier Odin", EXC, 4, V_NEO, "2023-07"),
    ("ChronoVoid Sheriff", EXC, 4, ["Purple", "Red", "Black"], "2022-12"), ("RGX 11z Pro Phantom", EXC, 5, V_RGX, "2021-03"),
    ("Singularity Spectre", EXC, 4, V_SING, "2021-03"), 
    ("Champions 2022 Phantom", CHMP, 4, [], "2022-08"), ("Champions 2023 Vandal", CHMP, 4, [], "2023-08"),
    ("Champions 2024 Phantom", CHMP, 4, [], "2024-08"), ("Champions 2025 Vandal", CHMP, 4, [], "2025-09"),
    ("Elderflame Vandal", ULT, 4, V_ELDER, "2020-06"), ("Elderflame Operator", ULT, 4, V_ELDER, "2020-06"), ("Elderflame Judge", ULT, 4, V_ELDER, "2020-06"),
    ("Protocol 781-A Spectre", ULT, 5, V_PROTO, "2022-04"), ("Protocol 781-A Sheriff", ULT, 5, V_PROTO, "2022-04"),
    ("Radiant Entertainment System Ghost", ULT, 4, ["Dance Fever", "K.nock O.ut!!"], "2023-10"),
    ("Sakura Vandal", DLX, 1, [], "2021-03"), ("Sakura Stinger", DLX, 1, [], "2021-03"), ("Minima Phantom", DLX, 1, [], "2021-06"),
    ("Hivemind Vandal", DLX, 1, [], "2021-11"), ("Kingdom Phantom", DLX, 1, [], "2020-06"),
    ("Smite Vandal", SEL, 1, [], "2020-09"), ("Smite Ghost", SEL, 1, [], "2020-09"), ("Infantry Ghost", SEL, 1, [], "2020-06"),
    ("Striker Bulldog", SEL, 1, [], "2020-06"), ("Coalition: Cobra Odin", SEL, 1, [], "2020-08"), ("POLYfox Sheriff", SEL, 1, [], "2021-06"),
    ("Luxe Vandal", SEL, 1, [], "2020-06"),
]
MELEE = [  # (name, VP price, upgrade levels, variant colours, on sale from)
    ("Prime Axe", 4350, 2, [], "2020-06"), ("Reaver Karambit", 4350, 2, V_REAVER, "2020-10"), ("Elderflame Dagger", 4350, 2, [], "2020-06"),
    ("Oni Claw", 4350, 2, [], "2020-07"), ("Ion Energy Sword", 4350, 2, [], "2020-12"), ("RGX 11z Pro Firefly", 4350, 2, V_RGX, "2021-03"),
    ("Champions 2023 Kunai", 5350, 3, [], "2023-08"),
]
BUNDLES = [  # full bundles: (name as the store writes it, VP, the skins it gives, on sale from)
    ("Mystbloom Bundle", 8700, [("Mystbloom Vandal", 4, V_MYST), ("Mystbloom Phantom", 4, V_MYST), ("Mystbloom Sheriff", 4, V_MYST), ("Mystbloom Kunai", 2, V_MYST)], "2024-03-26"),
    ("Imperium Bundle", 7100, [("Imperium Vandal", 4, V_IMP), ("Imperium Judge", 4, V_IMP), ("Imperium Sheriff", 4, V_IMP), ("Imperium Operator", 4, V_IMP)], "2024-09-17"),
]
# Old battle-pass accessories the Kingdom Credits store sells (from mid-2024), at its prices.
KC_ITEMS = [("EZ Spray", 4000), ("Hershey Pup Spray", 4000), ("Glitch Out Chicken Spray", 4000), ("Faces in Places Spray", 4000),
            ("Tall Tales Buddy", 4000), ("Battle Crab Buddy", 4000), ("Lunar Firework Buddy", 4000),
            ("Infinity Card", 2500), ("Sproutling Card", 2500), ("Phantom Schema Card", 2500)]
# Riot's real act calendar. Passes before 2025 are recorded as "BP Bundle / Assorted BP Items", later ones as
# "BP Item / Unknown"; one act Riot left unnamed (" Battle Pass Unlock"), as happens in real exports.
ACTS = [("Ep5 Act1", "2022-06-21"), ("Ep5 Act2", "2022-08-23"), ("Ep5 Act3", "2022-10-18"), ("Ep6 Act1", "2023-01-10"),
        ("Ep6 Act3", "2023-04-25"), ("Ep7 Act1", "2023-06-27"), ("Ep7 Act2", "2023-08-29"), ("Ep7 Act3", "2023-10-31"),
        ("Ep8 Act1", "2024-01-09"), ("Ep8 Act2", "2024-03-05"), ("Ep9 Act1", "2024-06-26"), ("Ep9 Act2", "2024-08-28"),
        ("Ep9 Act3", "2024-10-23"), ("V25 Act1", "2025-01-08"), ("V25 Act3", "2025-04-30"), ("V25 Act4", "2025-06-25"),
        ("V25 Act6", "2025-10-15"), ("V26 Act1", "2026-01-07"), ("V26 Act2", "2026-03-18"), ("V26 Act4", "2026-06-24"),
        ("V26 Act5", "2026-08-19")]
UNNAMED_ACT = "V25 Act6"
# Every item name above is public game data (the leak check below allows these, and only these, to match).
PUBLIC_NAMES = ({n for n, *_ in SKINS} | {n for n, *_ in MELEE} | {n for n, _ in KC_ITEMS} | {b[0] for b in BUNDLES}
                | {s[0] for b in BUNDLES for s in b[2]})


def on_sale(month: str) -> datetime:
    return datetime.fromisoformat(f"{month}-01T00:00:00+00:00") if len(month) == 7 else day_of(month)


purchases = []


def buy(t: datetime, name: str, cost: int, source: str, item_type: str = "Item", currency: str = "VALORANT Points",
        transaction_type: str = "Purchase") -> dict:
    row = {"item_name": name, "item_type": item_type, "purchase_date": ts_us(t), "spent_currency_amount": cost,
           "spent_currency_name": currency, "transaction_id": uid(), "transaction_source": source, "transaction_type": transaction_type}
    purchases.append(row)
    return row


def on_break(d: datetime) -> bool:
    return any(a <= d < b for a, b in BREAKS)


def after_breaks(d: datetime) -> datetime:
    """d, or the first day after the break it falls in."""
    while on_break(d):
        d += timedelta(days=1)
    return d


def shopping_day(lo: datetime, hi: datetime) -> datetime:
    """An evening between lo and hi when the player is around (never on a break)."""
    for _ in range(50):
        d = lo + timedelta(days=rng.randint(0, max(0, (hi - lo).days)))
        if not on_break(d):
            return evening(d)
    return evening(after_breaks(lo))


# What the player spends VP on, planned first; top-ups are then made just before the VP runs out.
spends: list[tuple[datetime, int, dict]] = []  # (when, VP, purchase kwargs)
owned: list[tuple[str, int, list[str], datetime]] = []  # skins that can be upgraded with Radianite
SHOP_FROM = START + timedelta(days=4)
LAST = END - timedelta(days=2)

for act, d in ACTS:
    t = shopping_day(max(day_of(d), SHOP_FROM), day_of(d) + timedelta(days=rng.choice([0, 1, 2, 4, 9, 16, 24])))
    if act == UNNAMED_ACT:
        spends.append((t, 1000, dict(name="Unknown", source=" Battle Pass Unlock", item_type="BP Item", transaction_type="Unlock")))
    elif act.startswith("V"):
        spends.append((t, 1000, dict(name="Unknown", source=f"{act} Battle Pass Unlock", item_type="BP Item", transaction_type="Unlock")))
    else:
        spends.append((t, 1000, dict(name="Assorted BP Items", source=f"{act} Battle Pass Unlock", item_type="BP Bundle", transaction_type="Unlock")))

for name, cost, items, from_ in BUNDLES:  # bought the week they came out
    t = shopping_day(on_sale(from_), on_sale(from_) + timedelta(days=6))
    spends.append((t, cost, dict(name=name, source="Bundle", item_type="Bundle")))
    for s, lv, cols in items:
        owned.append((s, lv, cols, t))

skins = [x for x in SKINS if rng.random() < 0.86]  # most of the catalogue above, not all of it
# The Night Market opens a few weeks into some acts and runs about two weeks.
NIGHT_MARKETS = [w for w in (day_of(d) + timedelta(days=24) for _, d in ACTS[::2])
                 if w + timedelta(days=14) < LAST and not any(a <= w + timedelta(days=k) < b for a, b in BREAKS for k in range(14))]
nm_bought = Counter()
for name, cost, lv, cols, from_ in skins + [m for m in MELEE if rng.random() < 0.9]:
    avail = max(on_sale(from_), SHOP_FROM)
    released_while_playing = on_sale(from_) >= START
    roll = rng.random()
    if name.startswith("Champions"):  # limited: only on sale for the few weeks of its event
        if not released_while_playing:
            continue
        t, price, source = shopping_day(avail, avail + timedelta(days=20)), cost, "Bundle Individual"
    elif released_while_playing and roll < 0.3:  # bought from its bundle the week it came out
        t, price, source = shopping_day(avail, avail + timedelta(days=10)), cost, "Bundle Individual"
    elif (cost <= EXC and name not in {m[0] for m in MELEE} and roll < 0.42
          and any(w > avail + timedelta(days=200) and nm_bought[w] < 3 for w in NIGHT_MARKETS)):
        # a Night Market deal on an older skin, while one runs (two weeks, a few times a year; 3 deals at most)
        w = rng.choice([w for w in NIGHT_MARKETS if w > avail + timedelta(days=200) and nm_bought[w] < 3])
        nm_bought[w] += 1
        t, price, source = shopping_day(w, w + timedelta(days=13)), int(cost * rng.uniform(0.6, 0.85)), "Bonus Shop"
    else:
        t, price, source = shopping_day(avail, LAST), cost, rng.choice(["Rotation"] * 9 + ["9", "13"])
    spends.append((t, price, dict(name=name, source=source)))
    owned.append((name, lv, cols, t))
spends.sort(key=lambda x: x[0])

# --------------------------------------------------------------------------- money: VP top-ups (EUR store prices)
PACKS = [(499, 475), (999, 1000), (1999, 2050), (3499, 3650), (4999, 5350), (9999, 11000)]  # EUR cents -> VP
payments = []


def pay(t: datetime, cents: int, vp: int, gift: bool = False) -> None:
    payments.append({
        "country_code": "DE", "currency_code": "EUR", "game_currency_granted": vp, "game_currency_type": "VP",
        "payment_method": rng.choices(["adyencomponents-card", "paypalrest", "adyen"], weights=[6, 3, 2])[0],
        "payment_time_utc": ts(t),
        "player_facing_purchase_id": "".join(rng.choice("abcdefghjkmnpqrstuvwxyz23456789") for _ in range(12)),
        "real_currency_paid_x100": cents,
        "recipient_id": uid() if gift else None,
    })


balance = 0
for t, cost, kw in spends:
    if balance < cost:  # top up a little before buying, with a pack that covers it (often a bigger one)
        need = cost - balance
        i = next(k for k, (_, vp) in enumerate(PACKS) if vp >= need)
        i = min(len(PACKS) - 1, i + rng.choices([0, 1, 2, 3, 4], weights=[1, 2, 3, 3, 2])[0])
        cents, vp = PACKS[i]
        pay(t - secs(240, 2 * 3600), cents, vp)
        balance += vp
    buy(t, kw.pop("name"), cost, kw.pop("source"), **kw)
    balance -= cost
pay(datetime(2024, 12, 17, 18, 31, 4, tzinfo=timezone.utc), 999, 1000, gift=True)  # a gift for a friend
payments.sort(key=lambda r: r["payment_time_utc"])
assert balance >= 0

# --------------------------------------------------------------------------- Radianite upgrades on owned skins
for name, levels, colours, bought in sorted(owned, key=lambda o: o[3]):
    if levels < 2 or rng.random() < 0.12:
        continue
    def later(t: datetime, days: int) -> datetime:  # an evening a few days on, never during a break
        d = after_breaks(t + timedelta(days=rng.randint(0, days)))
        return max(t + secs(60, 900), evening(d))

    t = later(bought, 6)
    top = min(levels, rng.choice([2, 3, levels, levels, levels, levels]))
    for lv in range(2, top + 1):
        if t >= END:
            break
        buy(t, f"{name} Level {lv}", 10, rng.choice(["Item Level Upgrade"] * 14 + ["5"]), currency="Radianite Points")
        t = later(t, 14)
    if top == levels and colours:
        for n, col in enumerate(colours[: rng.choice([0, 1, 2, len(colours), len(colours)])], start=1):
            if t >= END:
                break
            buy(t, f"{name} Level {levels}\n(Variant {n} {col})", 15, "Item Variant Upgrade", currency="Radianite Points")
            t = later(t, 20)
for _ in range(9):  # upgrades Riot didn't name
    buy(shopping_day(SHOP_FROM, LAST), "Unknown", rng.choice([20, 20, 30]), "Item Level Upgrade", "Unknown", "Radianite Points")

# --------------------------------------------------------------------------- Kingdom Credits and agent tokens
for name, cost in rng.sample(KC_ITEMS, 7):  # the accessory store opened in mid-2024
    buy(shopping_day(datetime(2024, 7, 1, tzinfo=timezone.utc), LAST), name, cost, "Accessory", currency="Kingdom Credits")
for _ in range(3):  # agent gear: Riot records only a catalogue ID
    buy(shopping_day(datetime(2026, 3, 20, tzinfo=timezone.utc), LAST), f"CatalogEntry_{uid()}", 2500, "Agentboardstatmodules", currency="Kingdom Credits")
for d in ["2022-07-19", "2023-01-24", "2024-03-12"]:  # agents recruited with tokens
    buy(shopping_day(day_of(d), day_of(d) + timedelta(days=12)), "Assorted Char Items", 1, "Character Level", "Char Bundle",
        "Character Recruitment Token", "Unlock")
purchases.sort(key=lambda r: r["purchase_date"])

# --------------------------------------------------------------------------- account security events
audit = []


def ev(t: datetime, kind: str, desc: str | None = None) -> None:
    audit.append({"description": desc, "event_date": ts(t), "event_type": kind})


MFA_ON = INCIDENT + timedelta(hours=15, minutes=12, seconds=350)
ev(START, "CREATED")
ev(START + secs(200, 400), "EMAIL", "delivered")
ev(START + secs(500, 900), "EMAIL_VERIFIED")
ev(START + secs(1000, 1500), "DEVICE_TRUST")
ev(datetime(2023, 4, 2, 18, 12, tzinfo=timezone.utc), "FEDERATED_IDENTITY_CREATED")
ev(datetime(2023, 4, 2, 18, 13, tzinfo=timezone.utc), "LINKED_IDENTITY_CREATED")
ev(datetime(2023, 4, 2, 18, 13, 30, tzinfo=timezone.utc), "IDENTITY_LINK_SUCCESS")
seen = set()
for l in logins:  # a new address: a sign-in code by email, then the device is trusted; after 2FA, a factor check
    ip = l["ip_address"]
    if l["event_type"] != "Login" or ip in seen or ip == INTRUDER_IP:
        continue
    seen.add(ip)
    t = datetime.fromisoformat(l["event_time_utc"]).replace(tzinfo=timezone.utc)
    if rng.random() < 0.55:
        ev(t + secs(3, 20), "EMAIL", "delivered")
        ev(t + secs(30, 90), "DEVICE_TRUST")
        if t > MFA_ON and rng.random() < 0.6:
            ev(t + secs(20, 28), "AUTH_FACTOR_CHANGE")
for p in payments:  # receipts
    ev(datetime.fromisoformat(p["payment_time_utc"]).replace(tzinfo=timezone.utc) + secs(20, 90), "EMAIL", "delivered")
for when in [datetime(2023, 11, 20, 19, 2, tzinfo=timezone.utc), datetime(2025, 9, 2, 20, 41, tzinfo=timezone.utc)]:  # Riot ID changes
    ev(when, "USER_FIELD_CHANGED", "alias")
    ev(when + secs(30, 60), "EMAIL", "delivered")
for when in [datetime(2023, 2, 26, 18, 40, tzinfo=timezone.utc), datetime(2024, 9, 8, 17, 2, tzinfo=timezone.utc),
             datetime(2026, 5, 9, 20, 15, tzinfo=timezone.utc)]:  # routine password changes
    ev(when, "PASSWORD_CHANGE")
    ev(when + secs(3, 6), "USER_FIELD_CHANGED", "password")
    ev(when + secs(40, 80), "EMAIL", "delivered")
# a forgotten password, reset by email
forgot = datetime(2023, 9, 30, 16, 5, 41, tzinfo=timezone.utc)
ev(forgot - secs(120, 240), "EMAIL", "delivered")
ev(forgot, "PASSWORD_RESET")
ev(forgot + secs(3, 6), "USER_FIELD_CHANGED", "password")
# Riot flags sign-ins from a trip abroad (it was the player)
for when in [datetime(2024, 4, 13, 9, 22, tzinfo=timezone.utc), datetime(2026, 7, 30, 11, 5, tzinfo=timezone.utc)]:
    ev(when, "ANOMALOUS_ACTIVITY")
    ev(when + secs(40, 80), "EMAIL", "delivered")
# the incident: Riot flags it, the player resets the password, signs out everywhere, turns on 2FA
ev(INCIDENT + secs(20, 40), "ANOMALOUS_ACTIVITY")
ev(INCIDENT + secs(60, 90), "EMAIL", "delivered")
reset = INCIDENT + timedelta(hours=15, minutes=12)
ev(reset, "PASSWORD_RESET")
ev(reset + secs(5, 10), "USER_FIELD_CHANGED", "password")
ev(reset + secs(60, 120), "DEVICE_TRUST_PURGE_ALL")
ev(reset + secs(300, 340), "AUTH_FACTOR_CHANGE")
ev(reset + secs(410, 500), "USER_FIELD_CHANGED", "mfa preference updated")
ev(reset + secs(520, 600), "USER_FIELD_CHANGED", "active verified phone number")
ev(reset + secs(610, 700), "EMAIL", "delivered")
# a new phone, so 2FA moves to it
newphone = datetime(2026, 2, 11, 18, 33, tzinfo=timezone.utc)
ev(newphone, "AUTH_FACTOR_CHANGE")
ev(newphone + secs(30, 60), "USER_FIELD_CHANGED", "mfa preference updated")
ev(newphone + secs(70, 120), "DEVICE_TRUST_PURGE_ALL")
ev(newphone + secs(130, 200), "EMAIL", "delivered")
ev(datetime(2026, 1, 12, 19, 44, tzinfo=timezone.utc), "USER_FIELD_CHANGED", "emailAddress")
ev(datetime(2026, 1, 12, 19, 46, tzinfo=timezone.utc), "USER_FIELD_CHANGED", "emailStatus")
ev(datetime(2026, 1, 12, 19, 46, 30, tzinfo=timezone.utc), "EMAIL_VERIFIED")
audit.sort(key=lambda r: r["event_date"])

# --------------------------------------------------------------------------- conduct
penalties = []
for when, reason, status, kinds in [
    (datetime(2022, 9, 3, 20, 14, 2, tzinfo=timezone.utc), "DISRUPTIVE_GAMEPLAY", "LAPSED", ["PBE_LOGIN_RESTRICTION"]),
    (datetime(2022, 12, 17, 21, 40, 51, tzinfo=timezone.utc), "DISRUPTIVE_GAMEPLAY", "LAPSED", ["PBE_LOGIN_RESTRICTION"]),
    (datetime(2023, 3, 29, 19, 8, 33, tzinfo=timezone.utc), "DISRUPTIVE_GAMEPLAY", "OVERTURNED", ["PBE_LOGIN_RESTRICTION"]),
    (datetime(2023, 11, 4, 21, 18, 40, tzinfo=timezone.utc), "DISRUPTIVE_COMMUNICATION", "LAPSED", ["CHAT_RESTRICTION", "VOICE_RESTRICTION"]),
    (datetime(2024, 2, 10, 18, 2, 19, tzinfo=timezone.utc), "DISRUPTIVE_GAMEPLAY", "LAPSED", ["PBE_LOGIN_RESTRICTION"]),
    (datetime(2024, 6, 30, 19, 55, 2, tzinfo=timezone.utc), "DISRUPTIVE_GAMEPLAY", "LAPSED", ["PBE_LOGIN_RESTRICTION"]),
    (datetime(2024, 10, 12, 22, 7, 45, tzinfo=timezone.utc), "DISRUPTIVE_COMMUNICATION", "OVERTURNED", ["VOICE_RESTRICTION"]),
    (datetime(2025, 2, 1, 20, 33, 10, tzinfo=timezone.utc), "DISRUPTIVE_GAMEPLAY", "OVERTURNED", ["PBE_LOGIN_RESTRICTION"]),
    (datetime(2025, 8, 23, 19, 49, 5, tzinfo=timezone.utc), "DISRUPTIVE_GAMEPLAY", "LAPSED", ["PBE_LOGIN_RESTRICTION"]),
    (datetime(2025, 10, 9, 20, 7, 31, tzinfo=timezone.utc), "DISRUPTIVE_COMMUNICATION", "OVERTURNED", ["CHAT_RESTRICTION"]),
    (datetime(2026, 1, 25, 21, 12, 58, tzinfo=timezone.utc), "DISRUPTIVE_COMMUNICATION", "LAPSED", ["CHAT_RESTRICTION", "VOICE_RESTRICTION"]),
    (datetime(2026, 5, 16, 18, 26, 37, tzinfo=timezone.utc), "DISRUPTIVE_GAMEPLAY", "LAPSED", ["PBE_LOGIN_RESTRICTION"]),
    (datetime(2026, 9, 19, 20, 51, 14, tzinfo=timezone.utc), "DISRUPTIVE_GAMEPLAY", "LAPSED", ["PBE_LOGIN_RESTRICTION"]),
]:
    for k, kind in enumerate(kinds):
        penalties.append({"date_issued": (when + timedelta(seconds=k)).strftime("%Y-%m-%dT%H:%M:%SZ"), "is_manual": False,
                          "restriction_reason": reason, "restriction_type": kind, "scope": "VALORANT", "sentence": "TIMEOUT",
                          "status": status})

reports = {"reports_made": {"AFK": 7, "BOTTING": 2, "CHEATING": 12, "COMMS_ABUSE_TEXT": 6, "COMMS_ABUSE_VOICE": 9,
                            "INAPPROPRIATE_TEAM_NAME": 1, "OFFENSIVE_NAME": 3, "RANK_MANIPULATION": 6, "SABOTAGING_TEAM": 14},
           "reports_received": {"ABUSING_GLITCHES": 1, "AFK": 6, "CHEATING": 5, "COMMS_ABUSE_TEXT": 3, "COMMS_ABUSE_VOICE": 4,
                                "RANK_MANIPULATION": 3, "SABOTAGING_TEAM": 15}}

# --------------------------------------------------------------------------- voice transcripts (harmless, made up)
LINES = ["rotate b, they're stacking", "one in heaven, one tagged", "nice trade", "I'll smoke mid", "save this round",
         "spike down a site", "watch flank", "flash in three, two, one", "good half, let's go", "drop me a vandal?",
         "they always rush on eco", "nice clutch", "play retake", "one left, low", "gg, well played", "two hookah",
         "Jett dashed out", "full buy next round", "I've got op", "sage wall on main", "they're pushing long",
         "one short, one long", "I'm lurking mid", "planting for you", "defuse, I've got you covered", "don't peek",
         "jiggle it, he's holding", "they have an op on mid", "I'm flashing for you", "where's the spike?",
         "spike is b main", "trade me", "I'll entry", "hold your angles", "let's force buy", "I'm saving my vandal",
         "anyone need a sheriff?", "rotate, rotate", "they're fake", "stack a next round", "one lit for 100",
         "heal me please", "I'll drone", "Sova dart incoming", "ult is ready", "wait for my ult", "nice one",
         "unlucky", "it's fine, next round", "we've got this", "eco this round", "buy shields", "careful, Raze ult",
         "Killjoy lockdown, back off", "breach stun on site", "one on garage", "he's on site, low", "cypher cam on b",
         "go go go", "fall back", "play off the spike", "they're stalling", "last one, he's in the corner",
         "nice ace!", "who's got smokes?", "I'll take main", "push together", "spread out", "don't wide swing",
         "save, save", "thank you", "my bad"]
transcripts = []
for m in rng.sample([m for m in matches if m["game_type"] == "Ranked" and m["game_start_time_utc"] > "2023-01-01"], 6):
    start = datetime.fromisoformat(m["game_start_time_utc"]).replace(tzinfo=timezone.utc)
    length = int((datetime.fromisoformat(m["game_end_time_utc"]).replace(tzinfo=timezone.utc) - start).total_seconds() * 1000)
    offs = sorted(rng.sample(range(20_000, length - 30_000), rng.randint(70, 110)))  # within the match
    transcripts.append({"chat_lines": [{"time_start": str(o), "transcript": rng.choice(LINES)} for o in offs], "game_id": m["game_id"],
                        "product": "VALORANT", "transcript_created": str(int((start + timedelta(minutes=50)).timestamp() * 1000))})

# --------------------------------------------------------------------------- the export
account = {"date_of_birth": "2001-04-01", "email": "demo.player@example.com", "game_name": "Demo Player", "tagline": "DEMO",
           "username": "valosightdemo"}
EMPTY_LIST = ["2xko/2xko_audio_transcripts_uc.json", "2XKO/2xko_chat_logs_uc.json", "2XKO/2xko_game_inventory_uc.json", "2XKO/2xko_game_match_history_uc.json",
              "2XKO/2xko_payment_history_uc.json", "2XKO/2xko_purchase_history_uc.json", "2XKO/2xko_reward_history_uc.json",
              "alphi/alphi_chat.json", "leagueoflegends/rp_purchase_history_uc.json", "leagueoflegends/store_transactions_uc.json",
              "legendsofruneterra/lor_match_history_uc.json", "legendsofruneterra/lor_payment_history_event_uc.json",
              "legendsofruneterra/lor_purchase_history_event_uc.json", "riotAccount/account_audit_events_v1_uc.json",
              "wildrift/wildrift_match_history_uc.json", "wildrift/wildrift_payment_event_uc.json", "wildrift/wildrift_purchase_event_uc.json"]
EMPTY_OBJ = ["leagueoflegends/summoner.json", "wildrift/wildrift_currency.json", "wildrift/wildrift_inventory.json", "zendesk/zendesk_tickets.json"]
README = (
    "text\n"
    "README - Valosight demo export\n"
    "This is a FABRICATED Riot Games data export, made for trying out Valosight.\n"
    "Every value in it is invented: the player, IDs, IP addresses (documentation ranges), payments, matches and events.\n"
    "It does not describe any real person or account. Generated by test/demo-export/make_demo_export.py.\n"
)
files = {
    "riotAccount/account_info.json": account,
    "riotAccount/atlas_login_event_uc.json": logins,
    "riotAccount/account_audit_events_v2_uc.json": audit,
    "penalties/penalty_history.json": penalties,
    "valorant/valorant_match_history_uc.json": matches,
    "valorant/valorant_payment_event_uc.json": payments,
    "valorant/valorant_purchase_event_uc.json": purchases,
    "valorant/valorant_audio_transcripts_uc.json": transcripts,
    "valorant/valorant_grouped_reports.json": reports,
    "leagueoflegends/grouped_reports.json": {"reports_made": {}, "reports_received": {}},
    "teamfighttactics/tft_grouped_reports.json": {"reports_made": {}, "reports_received": {}},
    "leagueoflegends/clash.json": {"phone_number": "+00******0000"},
    **{p: [] for p in EMPTY_LIST},
    **{p: {} for p in EMPTY_OBJ},
}


def build() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for path in sorted(files):
            info = zipfile.ZipInfo(path, ZIP_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, json.dumps(files[path], ensure_ascii=False, separators=(",", ":")))
        info = zipfile.ZipInfo("readme.csv", ZIP_TIME)
        info.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(info, README)
    return buf.getvalue()


# --------------------------------------------------------------------------- leak check against a real export
ENUM_FIELDS = {"event_type", "product", "game_mode", "game_type", "game_outcome", "item_type", "transaction_type",
               "transaction_source", "spent_currency_name", "game_currency_type", "payment_method", "restriction_reason",
               "restriction_type", "scope", "sentence", "status", "description",
               # public store price tiers, the same for every player
               "spent_currency_amount", "game_currency_granted", "real_currency_paid_x100"}


PLACEHOLDERS = {"Unknown", "Not Applicable", "Assorted BP Items", "Assorted Char Items"}  # Riot's own filler values, not data


def public(s: str) -> bool:
    """A public game item name (a skin, its level or variant, a bundle, an accessory): the same for every player."""
    return any(s == n or s.startswith(n + " Level ") for n in PUBLIC_NAMES)


def strings(obj, key=""):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield from strings(v, k)
    elif isinstance(obj, list):
        for v in obj:
            yield from strings(v, key)
    elif isinstance(obj, (str, int)) and not isinstance(obj, bool):
        yield key, str(obj)


def check_against(real_zip: str, demo: bytes) -> int:
    """Every identifying value of the real export (IDs, IPs, times, names, chat, account fields) must be absent from the demo."""
    real = set()
    with zipfile.ZipFile(real_zip) as z:  # read-only, in memory
        for n in z.namelist():
            if n.lower().endswith(".json"):
                try:
                    data = json.loads(z.read(n).decode("utf-8-sig") or "null")
                except ValueError:
                    continue
                for k, s in strings(data):
                    if k not in ENUM_FIELDS and len(s) >= 4 and s not in PLACEHOLDERS and not public(s):
                        real.add(s)
    demo_text = "\n".join(zipfile.ZipFile(io.BytesIO(demo)).read(n).decode() for n in zipfile.ZipFile(io.BytesIO(demo)).namelist())
    demo_values = set()
    with zipfile.ZipFile(io.BytesIO(demo)) as z:
        for n in z.namelist():
            if n.endswith(".json"):
                demo_values |= {s for _, s in strings(json.loads(z.read(n)))}
    exact = sorted(real & demo_values)
    # Public item names may match, but the demo's collection mustn't mirror a real one (that would be personal by
    # inference): report how much of the real collection's item list the demo shares.
    def item_names(zf):
        out = set()
        for n in zf.namelist():
            if n.endswith("valorant_purchase_event_uc.json"):
                out |= {s for k, s in strings(json.loads(zf.read(n).decode("utf-8-sig") or "null")) if k == "item_name" and s not in PLACEHOLDERS}
        return out
    with zipfile.ZipFile(real_zip) as z:
        real_items = item_names(z)
    shared = len(real_items & item_names(zipfile.ZipFile(io.BytesIO(demo))))
    share = shared / len(real_items) if real_items else 0
    # also catch real identifiers embedded inside longer demo strings
    embedded = sorted(s for s in real if len(s) >= 7 and not s.isdigit() and s in demo_text and s not in exact)
    print(f"Leak check against {os.path.basename(real_zip)}: {len(real)} real values compared.")
    if exact or embedded:
        print("  Values present in both:", exact[:40], embedded[:40])
    else:
        print("  No real value appears in the demo export.")
    print(f"  Item names in common (public game items): {shared} of the real export's {len(real_items)} distinct ones ({share:.0%}).")
    if share > 0.5:
        print("  The demo shares most of the real collection: pick different items so it doesn't mirror a real player.")
    return 1 if exact or embedded or share > 0.5 else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check-against", metavar="REAL_EXPORT_ZIP", help="a real export to prove the demo shares no values with (read-only)")
    ap.add_argument("--out", default=OUT)
    a = ap.parse_args()
    data = build()
    with open(a.out, "wb") as fh:
        fh.write(data)
    vp_in = sum(p["game_currency_granted"] for p in payments)
    vp_out = sum(p["spent_currency_amount"] for p in purchases if p["spent_currency_name"] == "VALORANT Points")
    print(f"Wrote {a.out} ({len(data) // 1024} KB): {len(matches)} matches, {len(logins)} login events, {len(audit)} security events, "
          f"{len(payments)} payments (VP bought {vp_in}, spent {vp_out}), {len(purchases)} store transactions, {len(penalties)} penalties.")
    return check_against(a.check_against, data) if a.check_against else 0


if __name__ == "__main__":
    sys.exit(main())
