/**
 * Privacy mode hides the account's creation date. Any event on that same day (a first login, a Riot ID set
 * during sign-up, a first purchase…) would give it away, so dates on the creation day are hidden too.
 */
import { useCallback, useMemo } from "react";
import { useAccount, useRecords } from "./account";
import { HIDDEN, usePrivacy } from "./privacy";
import { useSettings } from "./settings";
import { DS } from "./valorant";

/** The account's creation time: Riot's "account created" event, else the earliest record of any dataset. */
export function useCreated(): string | null {
  const { detail } = useAccount();
  const audit = useRecords(DS.audit, false);
  return useMemo(() => {
    const c = audit.all.find((r) => r.event_type === "CREATED");
    if (c?._t) return c._t;
    const firsts = (detail?.datasets.map((d) => d.first).filter(Boolean) as string[]) ?? [];
    return firsts.sort()[0] ?? null;
  }, [audit.all, detail]);
}

/** The account-creation IP: the very first login's (may be "Unknown"), or null without login history. */
export function useCreationIp(): string | null {
  const logins = useRecords(DS.logins, false);
  return useMemo(() => logins.all.find((l) => l._t)?.ip_address ?? null, [logins.all]);
}

/**
 * Masks an IP for display. The account-creation IP (the first login's) is fully hidden in privacy mode like
 * on Overview, wherever it shows up (tables, filter chips); every other IP keeps its first two parts.
 */
export function useMaskIp() {
  const pv = usePrivacy();
  const first = useCreationIp();
  return useCallback((ip: string | null | undefined) => (ip && ip === first && ip !== "Unknown" ? pv.secret(ip) : pv.ip(ip ?? "")), [first, pv]);
}

/**
 * `guard(iso, text)` returns `text` (the formatted date), or a fixed mask when privacy mode is on and `iso`
 * falls on the account's creation day.
 */
export function useDateGuard() {
  const { hidden } = usePrivacy();
  const { f } = useSettings();
  const created = useCreated();
  const day = created ? f.dayKey(created) : null;
  return useMemo(() => (iso: string | null | undefined, text: string) => (hidden && iso && day && f.dayKey(iso) === day ? HIDDEN : text), [hidden, day, f]);
}
