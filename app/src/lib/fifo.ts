import type { Rec } from "./api";
import { amountPaid, classifyAllVP, type VPItem } from "./valorant";

/** One slice of a VP purchase paid for by one payment (or by VP that has no recorded payment). */
export interface Allocation {
  item: VPItem;
  vp: number;
  payment: Rec | null; // null = VP from an unknown source (free VP, rewards, gifts…)
  money: number; // real money for this slice (0 when payment is null)
}

export interface FifoResult {
  byPayment: Map<Rec, Allocation[]>;
  byItem: Map<VPItem, Allocation[]>;
  unfundedVP: number;
  leftoverVP: number;
}

/**
 * Spend VP oldest-first: each VP purchase uses the earliest top-up that still has VP left.
 * Riot's export doesn't say which VP paid for what, so this is an estimate; VP that can't be
 * traced to a payment (free VP, rewards) is reported separately.
 */
export function allocateVP(payments: Rec[], store: Rec[]): FifoResult {
  const lots = payments
    .filter((p) => p._t && /^VP$/i.test(p.game_currency_type ?? "VP"))
    .map((p) => ({ p, left: Number(p.game_currency_granted) || 0, perVP: (Number(p.game_currency_granted) || 0) > 0 ? amountPaid(p) / Number(p.game_currency_granted) : 0 }))
    .sort((a, b) => a.p._t!.localeCompare(b.p._t!));
  const items = classifyAllVP(store).filter((x) => x.t).sort((a, b) => a.t.localeCompare(b.t));
  const byPayment = new Map<Rec, Allocation[]>();
  const byItem = new Map<VPItem, Allocation[]>();
  let unfunded = 0;
  for (const item of items) {
    let need = item.cost;
    const out: Allocation[] = [];
    for (const lot of lots) {
      if (need <= 0) break;
      if (lot.left <= 0 || lot.p._t! > item.t) continue;
      const use = Math.min(need, lot.left);
      lot.left -= use;
      need -= use;
      const a = { item, vp: use, payment: lot.p, money: use * lot.perVP };
      out.push(a);
      byPayment.set(lot.p, [...(byPayment.get(lot.p) ?? []), a]);
    }
    if (need > 0) {
      unfunded += need;
      out.push({ item, vp: need, payment: null, money: 0 });
    }
    byItem.set(item, out);
  }
  return { byPayment, byItem, unfundedVP: unfunded, leftoverVP: lots.reduce((a, l) => a + l.left, 0) };
}
