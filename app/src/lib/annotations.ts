import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { useAccount } from "./account";

export type IpTag = "mine" | "not-mine" | "unsure";

/** User notes stored in the vault (e.g. which IPs are yours). */
export function useAnnotations(kind: string) {
  const { accountId } = useAccount();
  const [map, setMap] = useState<Record<string, string>>({});
  useEffect(() => {
    setMap({});
    if (accountId == null) return;
    let live = true;
    api.annotations(accountId, kind).then((m) => live && setMap(m)).catch(() => {});
    return () => {
      live = false;
    };
  }, [accountId, kind]);
  const set = useCallback(
    (key: string, value: string | null) => {
      if (accountId == null) return;
      setMap((m) => {
        const n = { ...m };
        if (value) n[key] = value;
        else delete n[key];
        return n;
      });
      api.setAnnotation(accountId, kind, key, value).catch(() => {});
    },
    [accountId, kind],
  );
  const setMany = useCallback(
    (items: Record<string, string | null>) => {
      if (accountId == null) return;
      setMap((m) => {
        const n = { ...m };
        for (const [k, v] of Object.entries(items)) {
          if (v) n[k] = v;
          else delete n[k];
        }
        return n;
      });
      api.setAnnotations(accountId, kind, items).catch(() => {});
    },
    [accountId, kind],
  );
  return { map, set, setMany };
}
