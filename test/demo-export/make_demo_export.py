#!/usr/bin/env python3
"""Build a fabricated Riot data export for demos and testing: Demo_Player-DEMO.zip.

Everything in it is invented. It follows the *format* of a real Riot export (file names, field
names, value shapes) but every value is generated here from a fixed random seed, so the file is
the same on every run. Nothing is copied from anyone's export:

  - the player is "Demo Player#DEMO" (EU realm, store in Germany, pays in EUR)
  - IP addresses come only from the ranges reserved for documentation (RFC 5737: 192.0.2.0/24,
    198.51.100.0/24, 203.0.113.0/24), which never belong to a real network
  - the email is @example.com (reserved for examples, RFC 2606); IDs are random UUIDs
  - skins are public VALORANT item names; prices follow the store's public price tiers

Usage:
  python3 test/demo-export/make_demo_export.py                       # writes the zip next to this file
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
import zipfile
from datetime import datetime, timedelta, timezone

SEED = 20261116
START = datetime(2023, 2, 10, tzinfo=timezone.utc)  # account created
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


# --------------------------------------------------------------------------- network
HOME_IPS = ["192.0.2.14", "192.0.2.87", "192.0.2.153", "192.0.2.201", "192.0.2.46"]  # the ISP reassigns now and then
TRAVEL_IPS = ["198.51.100.23", "198.51.100.140", "198.51.100.77"]  # phone hotspot, a friend's place, a trip
INTRUDER_IP = "203.0.113.66"


def home_ip(day: datetime) -> str:
    months = (day.year - START.year) * 12 + day.month - START.month
    return HOME_IPS[min(months // 9, len(HOME_IPS) - 1)]


# --------------------------------------------------------------------------- matches + logins
MODES = [  # (game_mode, game_type, weight, minutes)
    ("Matchmaking", "Ranked", 42, (28, 46)),
    ("Matchmaking", "Unrated", 9, (26, 44)),
    ("Matchmaking", "Swiftplay", 11, (11, 19)),
    ("Matchmaking", "Deathmatch", 9, (8, 10)),
    ("Matchmaking", "Hurm", 8, (9, 13)),
    ("Matchmaking", "Spike Rush", 6, (9, 15)),
    ("Matchmaking", "Skirmish2V2", 1.5, (6, 10)),
    ("Matchmaking", "Ggteam", 1, (14, 20)),
    ("ShootingRange", "Not Applicable", 5, (4, 15)),
    ("Custom Game", "Not Applicable", 3, (15, 40)),
]
BREAKS = [(datetime(2023, 8, 1, tzinfo=timezone.utc), datetime(2023, 8, 24, tzinfo=timezone.utc)),
          (datetime(2025, 5, 3, tzinfo=timezone.utc), datetime(2025, 7, 10, tzinfo=timezone.utc))]  # holidays, exams

matches, logins = [], []
win_streak_bias = 0.0
day = START + timedelta(days=1)
while day < END - timedelta(days=1):
    if any(a <= day < b for a, b in BREAKS):
        day += timedelta(days=1)
        continue
    weekend = day.weekday() >= 4
    if rng.random() < (0.36 if weekend else 0.19):
        travel = rng.random() < 0.05
        ip = rng.choice(TRAVEL_IPS) if travel else home_ip(day)
        t = day.replace(hour=rng.choice([16, 17, 17, 18, 18, 19, 19, 20, 21]), minute=rng.randrange(60), second=rng.randrange(60))
        logins += [
            {"event_time_utc": ts(t), "event_type": "Login", "ip_address": ip, "product": "riot_client"},
            {"event_time_utc": ts(t + secs(1, 4)), "event_type": "Authentication", "ip_address": ip, "product": "rso-authenticator-prod"},
        ]
        if rng.random() < 0.35:
            logins.append({"event_time_utc": ts(t + secs(3, 8)), "event_type": "Authentication", "ip_address": ip, "product": "rso-prod"})
        t += secs(40, 150)
        for _ in range(rng.choice([1, 1, 2, 2, 2, 3, 3, 4, 5])):
            mode, gtype, _, (lo, hi) = rng.choices(MODES, weights=[m[2] for m in MODES])[0]
            start = t + secs(30, 240)  # queue
            end = start + timedelta(minutes=rng.randint(lo, hi), seconds=rng.randrange(60))
            if end >= END:
                break
            if mode == "Matchmaking":
                win = rng.random() < 0.49 + win_streak_bias
                win_streak_bias = max(-0.08, min(0.08, win_streak_bias + (0.03 if win else -0.03)))
            else:
                win = False  # Riot records range and custom games as losses
            matches.append({"game_end_time_utc": ts(end), "game_id": uid(), "game_mode": mode, "game_outcome": "Win" if win else "Loss",
                            "game_start_time_utc": ts(start), "game_type": gtype, "realm_id": "eu"})
            for k in range(rng.randint(1, 3)):
                logins.append({"event_time_utc": ts(start + secs(5, 60) * (k + 1)), "event_type": "Connected", "ip_address": ip, "product": "VALORANT"})
            t = end
        logins.append({"event_time_utc": ts(t + secs(20, 200)), "event_type": "Closed", "ip_address": ip, "product": "VALORANT"})
        if rng.random() < 0.12:
            logins.append({"event_time_utc": ts(t + secs(300, 900)), "event_type": rng.choice(["Purged", "Expired"]), "ip_address": ip, "product": "VALORANT"})
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
logins.append({"event_time_utc": ts(START + timedelta(minutes=8)), "event_type": "Authentication", "ip_address": HOME_IPS[0], "product": "accountodactyl-prod"})
logins.sort(key=lambda r: r["event_time_utc"])
matches.sort(key=lambda r: r["game_start_time_utc"])

# --------------------------------------------------------------------------- money: VP top-ups
PACKS = [(499, 475), (999, 1000), (1999, 2050), (3499, 3650), (4999, 5350), (9999, 11000)]  # EUR cents -> VP
payments = []
pay_days = sorted(START + timedelta(days=rng.randint(3, (END - START).days - 3)) for _ in range(23))
for i, d in enumerate(pay_days):
    d = d.replace(hour=rng.randint(16, 22), minute=rng.randrange(60), second=rng.randrange(60))
    cents, vp = rng.choices(PACKS, weights=[3, 6, 5, 3, 2, 1])[0]
    if i == 6:
        cents, vp = PACKS[-1]  # one big top-up, spent on a full bundle
    payments.append({
        "country_code": "DE", "currency_code": "EUR", "game_currency_granted": vp, "game_currency_type": "VP",
        "payment_method": rng.choices(["adyencomponents-card", "paypalrest", "adyen"], weights=[6, 3, 1])[0],
        "payment_time_utc": ts(d),
        "player_facing_purchase_id": "".join(rng.choice("abcdefghjkmnpqrstuvwxyz23456789") for _ in range(12)),
        "real_currency_paid_x100": cents,
        "recipient_id": uid() if i == 9 else None,  # one top-up was a gift
    })

# --------------------------------------------------------------------------- store: what the VP bought
SKINS = [  # (public skin line + weapon, VP price, upgradable levels, variant colours)
    ("Sentinels of Light Vandal", 2175, 4, ["Blue", "Gold", "Black"]), ("Ruination Operator", 2175, 4, ["Teal", "Black", "Gold"]),
    ("Ruination Phantom", 2175, 4, ["Blue", "Red", "Gold"]), ("Glitchpop Phantom", 2175, 4, ["Blue", "Red", "Gold"]),
    ("Arcane Sheriff", 2175, 4, ["Blue", "Pink", "Gold"]), ("Elderflame Vandal", 2475, 4, ["Blue", "Green", "Purple"]),
    ("Singularity Phantom", 2175, 4, ["Black", "Teal", "Pink"]), ("Prelude to Chaos Vandal", 2475, 4, ["Teal", "Gold", "Red"]),
    ("Origin Ghost", 1775, 4, ["Green", "Gold", "White"]), ("Spline Spectre", 1775, 4, ["Blue", "Black", "Orange"]),
    ("Champions 2023 Vandal", 2175, 0, []), ("Araxys Operator", 2675, 4, ["Teal", "Gold", "Red"]),
    ("Gaia's Vengeance Ghost", 1775, 4, ["Purple", "Black", "Yellow"]), ("Magepunk Sheriff", 1775, 4, ["Red", "Green", "Gold"]),
    ("Sakura Stinger", 875, 0, []), ("Coalition Phantom", 875, 0, []), ("Striker Guardian", 875, 0, []),
    ("Kingdom Marshal", 875, 0, []), ("Polyfox Odin", 1275, 0, []), ("Spectrum Bulldog", 2175, 4, ["Pink", "Blue", "Gold"]),
    ("Xenohunter Judge", 1775, 4, ["Teal", "Red", "Black"]), ("Origin Bucky", 1775, 4, ["Green", "Gold", "White"]),
]
MELEE = [("Reaver Karambit", 4350), ("Prime Axe", 3550), ("Glitchpop Axe", 4350), ("Oni Claw", 4350), ("Neo Frontier Axe", 4350)]
ACCESSORIES = [("Spray: Nice Shot", 325), ("Buddy: Lucky Spike", 475), ("Card: Midnight Ascent", 375), ("Buddy: Tiny Turret", 475)]
ACTS = [("Ep6 Act1", "2023-01-10"), ("Ep6 Act2", "2023-03-07"), ("Ep6 Act3", "2023-04-25"), ("Ep7 Act1", "2023-06-27"),
        ("Ep7 Act2", "2023-08-29"), ("Ep8 Act1", "2024-01-09"), ("Ep8 Act3", "2024-04-30"), ("Ep9 Act1", "2024-06-25"),
        ("Ep9 Act3", "2024-10-22"), ("V25 Act2", "2025-03-04"), ("V25 Act5", "2025-08-19"), ("V26 Act1", "2026-01-07"),
        ("V26 Act3", "2026-04-28"), ("V26 Act5", "2026-08-18")]

purchases = []
owned: list[tuple[str, int, list[str], datetime]] = []


def buy(t: datetime, name: str, cost: int, source: str, item_type: str = "Item", currency: str = "VALORANT Points",
        transaction_type: str = "Purchase") -> None:
    purchases.append({"item_name": name, "item_type": item_type, "purchase_date": ts_us(t), "spent_currency_amount": cost,
                      "spent_currency_name": currency, "transaction_id": uid(), "transaction_source": source,
                      "transaction_type": transaction_type})


balance = 0
bought_bundle = False
events = sorted([(datetime.fromisoformat(p["payment_time_utc"]).replace(tzinfo=timezone.utc), "pay", p) for p in payments]
                + [(datetime.fromisoformat(d + "T00:00:00+00:00") + timedelta(days=rng.randint(1, 20), hours=rng.randint(17, 21)), "act", a)
                   for a, d in ACTS])
skins = rng.sample(SKINS, len(SKINS))
for when, kind, what in events:
    if when >= END:
        continue
    if kind == "pay":
        balance += what["game_currency_granted"]
    t = when + secs(120, 3 * 86400)
    if kind == "act" and balance >= 1000:
        acts = [a for a, _ in ACTS]
        src = f"{what} Battle Pass Unlock" if acts.index(what) != 4 else " Battle Pass Unlock"  # one act Riot left unnamed
        if rng.random() < 0.6:
            buy(t, "Premium BP Bundle", 1000, src, "BP Bundle", transaction_type="Unlock")
        else:
            buy(t, "Battlepass", 1000, src, "BP Item", transaction_type="Unlock")
        balance -= 1000
        continue
    # one full bundle, the first time there's enough VP for it
    if not bought_bundle and balance >= 7100:
        buy(t, "Xenohunter Collection", 7100, "Bundle", "Bundle")
        bought_bundle = True
        balance -= 7100
        t += secs(3600, 86400)
    # spend some of the new VP over the following days
    while balance > 300 and t < END:
        roll = rng.random()
        if roll < 0.08 and balance >= 3550:
            name, cost = rng.choice(MELEE)
            if not any(o[0] == name for o in owned):
                buy(t, name, cost, rng.choice(["Rotation", "Bundle Individual"]))
                owned.append((name, 0, [], t))
                balance -= cost
        elif roll < 0.30 and balance >= 900:  # a Night Market deal
            name, cost, lv, cols = rng.choice(skins)
            price = int(cost * rng.uniform(0.6, 0.78))
            if not any(o[0] == name for o in owned) and balance >= price:
                buy(t, name, price, "Bonus Shop")
                owned.append((name, lv, cols, t))
                balance -= price
        elif roll < 0.38:
            name, cost = rng.choice(ACCESSORIES)
            if balance >= cost:
                buy(t, name, cost, rng.choice(["Accessory", "13"]))
                balance -= cost
        elif skins:
            name, cost, lv, cols = skins[0]
            if balance < cost:
                break
            skins.pop(0)
            buy(t, name, cost, rng.choice(["Rotation", "Rotation", "Bundle Individual", "9"]))
            owned.append((name, lv, cols, t))
            balance -= cost
        else:
            break
        t += secs(3600, 6 * 86400)

# Radianite: level and colour-variant upgrades on owned premium skins
for name, levels, colours, bought in owned:
    if not levels:
        continue
    t = bought + secs(600, 30 * 86400)
    top = rng.choice([2, 3, 4, 4, 4])
    for lv in range(2, top + 1):
        if t >= END:
            break
        buy(t, f"{name} Level {lv}", 10, "Item Level Upgrade", currency="Radianite Points")
        t += secs(300, 20 * 86400)
    if top == 4:
        for n, col in enumerate(colours[: rng.randint(0, 3)], start=1):
            if t >= END:
                break
            buy(t, f"{name} Level 4\n(Variant {n} {col})", 15, "Item Variant Upgrade", currency="Radianite Points")
            t += secs(300, 25 * 86400)
for _ in range(5):
    buy(START + secs(10 * 86400, 1200 * 86400), "Unknown", rng.choice([20, 30]), "Item Level Upgrade", "Unknown", "Radianite Points")
buy(datetime(2026, 2, 3, 19, 5, tzinfo=timezone.utc), "Tactical Buddy Set", 4000, "Agentboardstatmodules", currency="Kingdom Credits")
buy(datetime(2026, 6, 14, 18, 40, tzinfo=timezone.utc), "Field Notes Card", 2500, "Character Level", currency="Kingdom Credits")
buy(datetime(2025, 1, 21, 20, 2, tzinfo=timezone.utc), "Waylay Recruitment Contract", 1, "Character Level", "Char Bundle", "Character Recruitment Token", "Unlock")
purchases.sort(key=lambda r: r["purchase_date"])
assert balance >= 0

# --------------------------------------------------------------------------- account security events
audit = []


def ev(t: datetime, kind: str, desc: str | None = None) -> None:
    audit.append({"description": desc, "event_date": ts(t), "event_type": kind})


ev(START, "CREATED")
ev(START + secs(200, 400), "EMAIL", "delivered")
ev(START + secs(500, 900), "EMAIL_VERIFIED")
ev(START + secs(1000, 1500), "DEVICE_TRUST")
ev(datetime(2023, 4, 2, 18, 12, tzinfo=timezone.utc), "FEDERATED_IDENTITY_CREATED")
ev(datetime(2023, 4, 2, 18, 13, tzinfo=timezone.utc), "LINKED_IDENTITY_CREATED")
ev(datetime(2023, 4, 2, 18, 13, 30, tzinfo=timezone.utc), "IDENTITY_LINK_SUCCESS")
seen = set()
for l in logins:
    if l["ip_address"] not in seen and l["ip_address"] != INTRUDER_IP:
        seen.add(l["ip_address"])
        ev(datetime.fromisoformat(l["event_time_utc"]).replace(tzinfo=timezone.utc) + secs(5, 40), "DEVICE_TRUST")
for p in payments:  # receipts
    ev(datetime.fromisoformat(p["payment_time_utc"]).replace(tzinfo=timezone.utc) + secs(20, 90), "EMAIL", "delivered")
alias_change = datetime(2024, 2, 19, 20, 31, tzinfo=timezone.utc)
ev(alias_change, "USER_FIELD_CHANGED", "alias")
ev(alias_change + secs(30, 60), "EMAIL", "delivered")
ev(datetime(2024, 9, 8, 17, 2, tzinfo=timezone.utc), "PASSWORD_CHANGE")
ev(datetime(2024, 9, 8, 17, 2, 5, tzinfo=timezone.utc), "USER_FIELD_CHANGED", "password")
# the incident: Riot flags it, the player resets the password, signs out everywhere, turns on 2FA
ev(INCIDENT + secs(20, 40), "ANOMALOUS_ACTIVITY")
ev(INCIDENT + secs(60, 90), "EMAIL", "delivered")
reset = INCIDENT + timedelta(hours=15, minutes=12)
ev(reset, "PASSWORD_RESET")
ev(reset + secs(5, 10), "USER_FIELD_CHANGED", "password")
ev(reset + secs(60, 120), "DEVICE_TRUST_PURGE_ALL")
ev(reset + secs(300, 400), "AUTH_FACTOR_CHANGE")
ev(reset + secs(410, 500), "USER_FIELD_CHANGED", "mfa preference updated")
ev(reset + secs(520, 600), "USER_FIELD_CHANGED", "active verified phone number")
ev(reset + secs(610, 700), "EMAIL", "delivered")
ev(datetime(2026, 1, 12, 19, 44, tzinfo=timezone.utc), "USER_FIELD_CHANGED", "emailAddress")
ev(datetime(2026, 1, 12, 19, 46, tzinfo=timezone.utc), "USER_FIELD_CHANGED", "emailStatus")
ev(datetime(2026, 1, 12, 19, 46, 30, tzinfo=timezone.utc), "EMAIL_VERIFIED")
audit.sort(key=lambda r: r["event_date"])

# --------------------------------------------------------------------------- conduct
penalties = []
for when, reason, status, kinds in [
    (datetime(2023, 11, 4, 21, 18, 40, tzinfo=timezone.utc), "DISRUPTIVE_COMMUNICATION", "LAPSED", ["CHAT_RESTRICTION", "VOICE_RESTRICTION"]),
    (datetime(2024, 6, 30, 19, 55, 2, tzinfo=timezone.utc), "DISRUPTIVE_GAMEPLAY", "LAPSED", ["PBE_LOGIN_RESTRICTION"]),
    (datetime(2025, 10, 9, 20, 7, 31, tzinfo=timezone.utc), "DISRUPTIVE_COMMUNICATION", "OVERTURNED", ["CHAT_RESTRICTION"]),
]:
    for k, kind in enumerate(kinds):
        penalties.append({"date_issued": (when + timedelta(seconds=k)).strftime("%Y-%m-%dT%H:%M:%SZ"), "is_manual": False,
                          "restriction_reason": reason, "restriction_type": kind, "scope": "VALORANT", "sentence": "TIMEOUT",
                          "status": status})

reports = {"reports_made": {"AFK": 2, "CHEATING": 4, "COMMS_ABUSE_TEXT": 1, "RANK_MANIPULATION": 3, "SABOTAGING_TEAM": 5},
           "reports_received": {"AFK": 1, "COMMS_ABUSE_VOICE": 1, "SABOTAGING_TEAM": 2}}

# --------------------------------------------------------------------------- voice transcripts (harmless, made up)
LINES = ["rotate b, they're stacking", "one in heaven, one tagged", "nice trade", "I'll smoke mid", "save this round",
         "spike down a site", "watch flank", "flash in three, two, one", "good half, let's go", "drop me a vandal?",
         "they always rush on eco", "nice clutch", "play retake", "one left, low", "gg, well played"]
transcripts = []
for m in rng.sample([m for m in matches if m["game_type"] == "Ranked"], 3):
    start = datetime.fromisoformat(m["game_start_time_utc"]).replace(tzinfo=timezone.utc)
    offs = sorted(rng.sample(range(20_000, 1_900_000), rng.randint(12, 24)))
    transcripts.append({"chat_lines": [{"time_start": str(o), "transcript": rng.choice(LINES)} for o in offs], "game_id": m["game_id"],
                        "product": "VALORANT", "transcript_created": str(int((start + timedelta(minutes=50)).timestamp() * 1000))})

# --------------------------------------------------------------------------- the export
account = {"date_of_birth": "2001-04-01", "email": "demo.player@example.com", "game_name": "Demo Player", "tagline": "DEMO",
           "username": "valosightdemo"}
EMPTY_LIST = ["2XKO/2xko_chat_logs_uc.json", "2XKO/2xko_game_inventory_uc.json", "2XKO/2xko_game_match_history_uc.json",
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


PLACEHOLDERS = {"Unknown", "Not Applicable"}  # Riot's own filler values, not data


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
                    if k not in ENUM_FIELDS and len(s) >= 4 and s not in PLACEHOLDERS:
                        real.add(s)
    demo_text = "\n".join(zipfile.ZipFile(io.BytesIO(demo)).read(n).decode() for n in zipfile.ZipFile(io.BytesIO(demo)).namelist())
    demo_values = set()
    with zipfile.ZipFile(io.BytesIO(demo)) as z:
        for n in z.namelist():
            if n.endswith(".json"):
                demo_values |= {s for _, s in strings(json.loads(z.read(n)))}
    exact = sorted(real & demo_values)
    # also catch real identifiers embedded inside longer demo strings
    embedded = sorted(s for s in real if len(s) >= 7 and not s.isdigit() and s in demo_text and s not in exact)
    print(f"Leak check against {os.path.basename(real_zip)}: {len(real)} real values compared.")
    if exact or embedded:
        print("  Values present in both:", exact[:40], embedded[:40])
    else:
        print("  No real value appears in the demo export.")
    return 1 if exact or embedded else 0


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
