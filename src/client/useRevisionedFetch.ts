import { useCallback, useEffect, useRef } from 'react';

/**
 * Keep a fetched view in step with the live socket's revision counter without over-fetching.
 * `load` runs once on mount (or when it changes identity) and again only when the socket
 * announces a revision the last response didn't carry. Never more than one request in flight:
 * a revision announced mid-request is re-checked when it resolves — which is what collapses
 * "fetch on mount" + "fetch on first socket state" into a single request. `load` resolves to
 * the revision its data was built at (null when unknown or failed).
 *
 * Returns `refetch(force?)`; `force` bypasses the comparison for actions whose effect the socket
 * may not announce (joining while the socket is down, an admin action while offline).
 */
export function useRevisionedFetch(load: () => Promise<number | null>, announced: number | undefined, enabled = true) {
  const want = useRef(announced);
  want.current = announced;
  const loadRef = useRef(load);
  loadRef.current = load;
  const have = useRef<number | null>(null);
  const inflight = useRef(false);
  const again = useRef(false);

  const refetch = useCallback((force = false) => {
    if (inflight.current) {
      if (force) again.current = true;
      return;
    }
    if (!force && have.current != null && have.current === want.current) return;
    inflight.current = true;
    void (async () => {
      try {
        for (;;) {
          const target = want.current;
          again.current = false;
          const got = await loadRef.current().catch(() => null);
          if (got != null) have.current = got;
          if (again.current) continue;
          if (want.current === target || have.current === want.current) break;
        }
      } finally {
        inflight.current = false;
      }
    })();
  }, []);

  // A different `load` (other session / other viewer) invalidates what we hold. Compared by
  // identity so StrictMode's replayed mount effects don't count as a change.
  const prevLoad = useRef(load);
  useEffect(() => {
    if (prevLoad.current === load) return;
    prevLoad.current = load;
    have.current = null;
    if (inflight.current) again.current = true;
  }, [load]);
  useEffect(() => {
    if (enabled) refetch();
  }, [enabled, refetch, load, announced]);

  return refetch;
}
