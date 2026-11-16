import type { Rec } from "./api";

export interface Session {
  start: string;
  end: string;
  games: Rec[];
  minutes: number;
}

const ts = (s?: string | null) => (s ? Date.parse(s.includes("T") ? s : s.replace(" ", "T") + "Z") : NaN);

/** Matches separated by more than `gapMin` minutes (end → next start) start a new session. */
export function buildSessions(matches: Rec[], gapMin = 30): Session[] {
  const sorted = [...matches].filter((m) => m._t).sort((a, b) => a._t!.localeCompare(b._t!));
  const out: Session[] = [];
  let cur: Session | null = null;
  let lastEnd = 0;
  for (const m of sorted) {
    const st = ts(m._t);
    const en = ts(m.game_end_time_utc) || st;
    if (!cur || st - lastEnd > gapMin * 60e3) {
      cur = { start: m._t!, end: m._t!, games: [], minutes: 0 };
      out.push(cur);
    }
    cur.games.push(m);
    lastEnd = Math.max(lastEnd, en);
    cur.end = new Date(lastEnd).toISOString();
    cur.minutes = (lastEnd - ts(cur.start)) / 60e3;
  }
  return out;
}

/** Win rate of the next decided game after a win / after a loss / after 2+ losses in a row (within a session). */
export function tilt(sessions: Session[]) {
  const acc = { afterWin: [0, 0], afterLoss: [0, 0], after2Loss: [0, 0], first: [0, 0] };
  const add = (k: keyof typeof acc, win: boolean) => {
    acc[k][1]++;
    if (win) acc[k][0]++;
  };
  for (const s of sessions) {
    const g = s.games.filter((m) => m.game_outcome === "Win" || m.game_outcome === "Loss");
    let lossRun = 0;
    g.forEach((m, i) => {
      const win = m.game_outcome === "Win";
      if (i === 0) add("first", win);
      else {
        add(g[i - 1].game_outcome === "Win" ? "afterWin" : "afterLoss", win);
        if (lossRun >= 2) add("after2Loss", win);
      }
      lossRun = win ? 0 : lossRun + 1;
    });
  }
  const pct = ([w, n]: number[]) => ({ rate: n ? (w / n) * 100 : null, n });
  return { afterWin: pct(acc.afterWin), afterLoss: pct(acc.afterLoss), after2Loss: pct(acc.after2Loss), first: pct(acc.first) };
}
