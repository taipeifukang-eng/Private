type Store = {
  id: string;
  store_name: string;
  source_store_id?: string | null;
};
type History = {
  store_id: string;
  status?: string | null;
  store?: { store_name: string } | null;
};
const FINISHED = ["completed", "closed"];
/**
 * 已巡店／尚未巡店名單（沿用舊版以門市歷史沿革追溯與同名備援比對）。
 * M4 Q2：只有已完成（含已結案）的巡店單才算已巡店；只有草稿、進行中的門市留在「尚未巡店」並標 has_draft（有草稿未送出）。
 * includeDrafts=true 為舊版口徑（任何狀態都算已巡店），僅供新舊對照測試。
 */
export function inspectionCoverage<T extends Store>(
  assigned: T[],
  history: History[],
  lineage: { id: string; source_store_id: string | null }[],
  includeDrafts = false,
) {
  const source = new Map(lineage.map((s) => [s.id, s.source_store_id]));
  const root = (id: string) => {
    const seen = new Set<string>();
    while (source.get(id) && !seen.has(id)) {
      seen.add(id);
      id = source.get(id)!;
    }
    return id;
  };
  const normalize = (name: string) =>
    name?.trim().replace(/\s+/g, "").toLocaleLowerCase("zh-TW") || "";
  const counted = history.filter(
    (r) => includeDrafts || FINISHED.includes(r.status || ""),
  );
  const pending = history.filter(
    (r) => !includeDrafts && !FINISHED.includes(r.status || ""),
  );
  const keys = (rows: History[]) => ({
    roots: new Set(rows.map((r) => root(r.store_id))),
    names: new Set(
      rows.map((r) => normalize(r.store?.store_name || "")).filter(Boolean),
    ),
  });
  const done = keys(counted);
  const drafts = keys(pending);
  const counts = new Map<string, number>();
  for (const s of assigned) {
    const n = normalize(s.store_name);
    counts.set(n, (counts.get(n) || 0) + 1);
  }
  const match = (k: ReturnType<typeof keys>, s: T) =>
    k.roots.has(root(s.id)) ||
    (!!normalize(s.store_name) &&
      counts.get(normalize(s.store_name)) === 1 &&
      k.names.has(normalize(s.store_name)));
  return {
    visited: assigned.filter((s) => match(done, s)),
    unvisited: assigned
      .filter((s) => !match(done, s))
      .map((s) => ({ ...s, has_draft: match(drafts, s) })),
  };
}
