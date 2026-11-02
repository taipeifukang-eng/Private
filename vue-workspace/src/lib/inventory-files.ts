export type Row = Record<string, any>;
export const code = (v: any) =>
  /^\d+$/.test(String(v ?? "").trim())
    ? String(v).trim().padStart(8, "0")
    : String(v ?? "").trim();
export async function readRows(file: File, base = false): Promise<Row[]> {
  const X = await import("xlsx");
  const book = X.read(await file.arrayBuffer(), { type: "array" });
  const sheet = book.Sheets[book.SheetNames[0]];
  if (!sheet) throw new Error("檔案沒有工作表");
  const rows = X.utils.sheet_to_json<Row>(sheet, {
    range: base ? 1 : 0,
    defval: "",
  });
  if (!rows.length) throw new Error("檔案沒有資料列");
  return rows;
}
export function validate(rows: Row[], headers: string[]) {
  for (const h of headers)
    if (!(h in rows[0])) throw new Error(`缺少欄位：${h}`);
  return rows;
}
export function num(v: any) {
  if (v === "" || v == null) return 0;
  const n = Number(String(v).replaceAll(",", ""));
  if (!Number.isFinite(n)) throw new Error(`數量不是有效數字：${v}`);
  return n;
}
export function normalize(rows: Row[], kind: string): Row[] {
  if (kind === "base") {
    validate(rows, ["品號", "品名", "條碼"]);
    const keys = Object.keys(rows[0]),
      stock = keys.find((k) => k.includes("庫存") || k.includes("重存")),
      loc = keys.find(
        (k) => k.includes("主要") && (k.includes("儲位") || k.includes("庫位")),
      ),
      unit = keys.find((k) => k.toUpperCase() === "UN" || k.includes("單位"));
    if (!stock || !loc) throw new Error("商品資料第二列需有庫存及主要儲位欄位");
    return rows
      .filter((r) => code(r.品號))
      .map((r) => ({
        ...r,
        品號: code(r.品號),
        庫存: num(r[stock]),
        主要儲位: r[loc],
        UN: unit ? r[unit] : "",
      }));
  }
  if (kind === "fks") {
    const keys = Object.keys(rows[0]);
    rows = rows.map((r) =>
      Object.fromEntries(
        ["品號", "品名", "條碼", "盤點數量", "盤點儲位"].map((k) => [
          k,
          r[keys.find((h) => h.includes(k)) || k] ?? "",
        ]),
      ),
    );
    if (
      !keys.some((k) => k.includes("品號")) ||
      !keys.some((k) => k.includes("盤點數量"))
    )
      throw new Error("FKS0701 缺少品號或盤點數量");
  }
  const headers: Record<string, string[]> = {
    external: ["品號", "品名", "條碼", "盤點數量"],
    pre: ["品號", "盤點數量", "盤點儲位"],
    fks: ["品號", "盤點數量"],
    modified: ["貨號", "數量", "貨架", "棚板", "序號"],
    internal: ["品號", "庫存量", "該儲位盤點數量"],
    missing: ["品號", "庫存量", "盤點數量"],
  };
  validate(rows, headers[kind]);
  const result = rows
    .filter((r) => code(r[kind === "modified" ? "貨號" : "品號"]))
    .map((r) => ({
      ...r,
      品號: code(r[kind === "modified" ? "貨號" : "品號"]),
      盤點數量: num(
        r[
          kind === "modified"
            ? "數量"
            : kind === "internal"
              ? "該儲位盤點數量"
              : "盤點數量"
        ],
      ),
      盤點儲位:
        kind === "modified"
          ? `外${r.貨架}-${r.棚板}`
          : String(r.盤點儲位 || ""),
      庫存量: num(r.庫存量),
    }));
  if (
    kind === "external" &&
    new Set(result.map((r) => r.品號)).size !== result.length
  )
    throw new Error("外盤原始檔品號重複，請先合併");
  if (kind === "modified") {
    const grouped = new Map<string, Row>();
    for (const r of result) {
      const key = JSON.stringify([r.品號, r.盤點儲位]);
      const old = grouped.get(key);
      if (old) old.盤點數量 += r.盤點數量;
      else grouped.set(key, { ...r });
    }
    return [...grouped.values()];
  }
  return result;
}
export function integrate(base: Row[], records: Row[]) {
  const products = new Map(base.map((r) => [r.品號, r])),
    totals = new Map<string, number>();
  records.forEach((r) =>
    totals.set(r.品號, (totals.get(r.品號) || 0) + r.盤點數量),
  );
  const full = records.map((r) => {
    const b = products.get(r.品號) || {};
    return {
      盤點儲位: r.盤點儲位,
      該儲位盤點數量: r.盤點數量,
      品號: r.品號,
      品名: b.品名 || "",
      UN: b.UN || "",
      條碼: b.條碼 || "",
      庫存量: b.庫存 || 0,
      各式盤點數量加總: totals.get(r.品號)!,
      盤差量: totals.get(r.品號)! - (b.庫存 || 0),
    };
  });
  return {
    diff: full
      .filter((r) => r.盤差量 !== 0)
      .sort((a, b) => a.盤點儲位.localeCompare(b.盤點儲位, "zh-TW")),
    zero: [...totals]
      .filter(([c, n]) => n === (products.get(c)?.庫存 || 0))
      .map(([c, n]) => ({
        品號: c,
        庫存量: products.get(c)?.庫存 || 0,
        實際量: n,
      })),
    missing: base
      .filter((r) => r.庫存 !== 0 && !totals.has(r.品號))
      .map((r) => ({
        品號: r.品號,
        品名: r.品名,
        UN: r.UN,
        條碼: r.條碼,
        庫存量: r.庫存,
        主要儲位: r.主要儲位,
        盤點數量: 0,
      })),
  };
}
export function finalRows(zero: Row[], internal: Row[], missing: Row[]) {
  const map = new Map<string, Row>(zero.map((r) => [r.品號, { ...r }]));
  for (const r of [...internal, ...missing]) {
    if (zero.some((z) => z.品號 === r.品號))
      throw new Error(`${r.品號} 同時存在無盤差與複盤資料，請核對`);
    const p = map.get(r.品號) || { 品號: r.品號, 庫存量: r.庫存量, 實際量: 0 };
    if (p.庫存量 !== r.庫存量) throw new Error(`${r.品號} 庫存量不一致`);
    p.實際量 += r.盤點數量;
    map.set(r.品號, p);
  }
  return [...map.values()].map((r) => ({ ...r, 盤差量: r.實際量 - r.庫存量 }));
}
export async function download(rows: Row[], name: string) {
  if (!rows.length) throw new Error("沒有可匯出的資料");
  const X = await import("xlsx"),
    book = X.utils.book_new();
  X.utils.book_append_sheet(book, X.utils.json_to_sheet(rows), "盤點資料");
  X.writeFile(book, `${name}.xlsx`);
}
