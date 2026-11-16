import type { Rec } from "./api";
import { auditInfo } from "./valorant";

export interface Incident {
  start: string;
  end: string;
  events: { r: Rec; label: string; level: number }[];
  newIps: { ip: string; t: string }[];
  severity: "alert" | "change";
}

/**
 * Group important security events (level ≥ 1) that happen within `gapMin` of each other into one incident,
 * and attach IPs that appeared for the first time ever from 6 h before to 6 h after it.
 */
export function buildIncidents(audit: Rec[], loginsAll: Rec[], gapMin = 120): Incident[] {
  const ev = audit
    .map((r) => ({ r, ...auditInfo(r) }))
    .filter((e) => e.level >= 1 && e.r._t && e.r.event_type !== "CREATED")
    .sort((a, b) => a.r._t!.localeCompare(b.r._t!));
  const first = new Map<string, string>();
  for (const l of loginsAll) if (l._t && l.ip_address && l.ip_address !== "Unknown" && !first.has(l.ip_address)) first.set(l.ip_address, l._t);
  const out: Incident[] = [];
  for (const e of ev) {
    const last = out[out.length - 1];
    if (last && Date.parse(e.r._t!) - Date.parse(last.end) <= gapMin * 60e3) {
      last.events.push(e);
      last.end = e.r._t!;
    } else out.push({ start: e.r._t!, end: e.r._t!, events: [e], newIps: [], severity: "change" });
  }
  for (const inc of out) {
    const a = Date.parse(inc.start) - 6 * 3600e3;
    const b = Date.parse(inc.end) + 6 * 3600e3;
    for (const [ip, t] of first) {
      const x = Date.parse(t);
      if (x >= a && x <= b) inc.newIps.push({ ip, t });
    }
    inc.newIps.sort((x, y) => x.t.localeCompare(y.t));
    if (inc.events.some((e) => e.level === 2)) inc.severity = "alert";
  }
  return out;
}
