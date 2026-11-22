// B10：Excel 匯入預覽的「可能重複」提醒（不擋匯入）。
// 規則：沒填資產編號（設備）或設施代碼（設施）的列，若「同類型＋同門市＋名稱」與既有未刪除資產、或同檔其他列相同，就標記提醒。
// 名稱比對：NFKC 正規化（全形轉半形、全形空白轉一般空白）、連續空白併成一個、去頭尾空白、大小寫不敏感。

export type ImportKind = "EQUIPMENT" | "FACILITY";

/** 名稱正規化（比對用）。 */
export function normalizeAssetName(value: unknown): string {
  return String(value ?? "").normalize("NFKC").replace(/[\s　]+/g, " ").trim().toLowerCase();
}

export type DupInputRow = { row_no: number; kind: ImportKind; store_code: string; name: string; hasCode: boolean };
export type ExistingAsset = { kind: ImportKind; store_code: string; name: string; code: string | null; created_at: string | null };
export type DupResult =
  | { type: "existing"; count: number; name: string; code: string | null; createdDate: string | null; message: string }
  | { type: "file"; otherRowNo: number; message: string };

const keyOf = (kind: string, storeCode: string, name: string) => `${kind}|${storeCode.trim().toUpperCase()}|${normalizeAssetName(name)}`;

/** 取日期（台北時間）YYYY-MM-DD。 */
export function taipeiDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t + 8 * 3600_000).toISOString().slice(0, 10);
}

/**
 * 回傳 row_no -> 提醒。同時符合既有資料與同檔其他列時，以既有資料為主。
 * 同檔比對包含「有填編號」的其他列（名稱相同就算），但只有「沒填編號」的列會被標記。
 */
export function findPossibleDuplicates(rows: DupInputRow[], existing: ExistingAsset[]): Map<number, DupResult> {
  const out = new Map<number, DupResult>();
  const existingBy = new Map<string, ExistingAsset[]>();
  for (const e of existing) {
    const k = keyOf(e.kind, e.store_code, e.name);
    const list = existingBy.get(k);
    if (list) list.push(e);
    else existingBy.set(k, [e]);
  }
  existingBy.forEach((list) => list.sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || ""))));
  const fileBy = new Map<string, number[]>();
  for (const r of rows) {
    const k = keyOf(r.kind, r.store_code, r.name);
    const list = fileBy.get(k);
    if (list) list.push(r.row_no);
    else fileBy.set(k, [r.row_no]);
  }
  for (const r of rows) {
    if (r.hasCode) continue;
    if (!normalizeAssetName(r.name)) continue;
    const k = keyOf(r.kind, r.store_code, r.name);
    const ex = existingBy.get(k);
    if (ex?.length) {
      const first = ex[0];
      const createdDate = taipeiDate(first.created_at);
      const label = `「${first.name.trim()}」（${first.code ? `編號 ${first.code}` : "尚無編號"}${createdDate ? `，建立 ${createdDate}` : ""}）`;
      out.set(r.row_no, { type: "existing", count: ex.length, name: first.name, code: first.code, createdDate, message: `可能重複：與既有${label}同名${ex.length > 1 ? `（共 ${ex.length} 筆）` : ""}` });
      continue;
    }
    const others = (fileBy.get(k) || []).filter((n) => n !== r.row_no);
    if (others.length) out.set(r.row_no, { type: "file", otherRowNo: others[0], message: `可能重複：與第 ${others[0]} 列同名` });
  }
  return out;
}
