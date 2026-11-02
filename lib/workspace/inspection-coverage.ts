type Store = {
  id: string;
  store_name: string;
  source_store_id?: string | null;
};
type History = { store_id: string; store?: { store_name: string } | null };
export function inspectionCoverage<T extends Store>(
  assigned: T[],
  history: History[],
  lineage: { id: string; source_store_id: string | null }[],
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
  const roots = new Set(history.map((r) => root(r.store_id)));
  const names = new Set(
    history.map((r) => normalize(r.store?.store_name || "")).filter(Boolean),
  );
  const counts = new Map<string, number>();
  for (const s of assigned) {
    const n = normalize(s.store_name);
    counts.set(n, (counts.get(n) || 0) + 1);
  }
  const visited = (s: T) =>
    roots.has(root(s.id)) ||
    (!!normalize(s.store_name) &&
      counts.get(normalize(s.store_name)) === 1 &&
      names.has(normalize(s.store_name)));
  return {
    visited: assigned.filter(visited),
    unvisited: assigned.filter((s) => !visited(s)),
  };
}
