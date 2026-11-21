export type Row = Record<string, any>;
export const code = (v: any) =>
  /^\d+$/.test(String(v ?? "").trim())
    ? String(v).trim().padStart(8, "0")
    : String(v ?? "").trim();

// ---------------------------------------------------------------- 檔名（A1）
export type InventoryFileKind =
  | "externalRecount"
  | "internalRecount"
  | "uninventoried"
  | "result";
/** 台北時間的年月日（不受使用者電腦時區影響）。 */
export function taipeiDateParts(date: Date = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day) };
}
/**
 * 離線盤點工具下載檔名。前三種帶 YYYY-MM-DD（台北時間、補零，不含斜線）；
 * 「M月D日盤點結果檔」維持舊版寫法（不補零、不含年份）。
 */
export function buildInventoryFileName(
  kind: InventoryFileKind,
  date: Date = new Date(),
): string {
  const { y, m, d } = taipeiDateParts(date);
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const base = {
    externalRecount: `外盤應複盤清單_${iso}`,
    internalRecount: `內部盤點複盤資料_${iso}`,
    uninventoried: `系統有庫存但未盤點檔案_${iso}`,
    result: `${m}月${d}日盤點結果檔`,
  }[kind];
  return `${base}.xlsx`;
}

// ---------------------------------------------------------------- 讀檔與欄位辨識
/** 把工作表轉成列物件；base 時第一列是空白合併儲存格、第二列才是標題（DPOS 1F 格式）。 */
export function sheetToRows(X: any, sheet: any, base = false): Row[] {
  if (!sheet) throw new Error("檔案沒有工作表");
  const rows = X.utils.sheet_to_json(sheet, {
    range: base ? 1 : 0,
    defval: "",
  }) as Row[];
  if (!rows.length) throw new Error("檔案沒有資料列");
  return rows;
}
export async function rowsFromBuffer(
  buffer: ArrayBuffer | Uint8Array,
  base = false,
): Promise<Row[]> {
  const X = await import("xlsx");
  const book = X.read(buffer, { type: "array" });
  return sheetToRows(X, book.Sheets[book.SheetNames[0]], base);
}
export async function readRows(file: File, base = false): Promise<Row[]> {
  return rowsFromBuffer(await file.arrayBuffer(), base);
}
/** 缺欄位訊息：沿用舊版文字（缺少的欄位、實際檔案中的欄位）。 */
export function missingColumnsMessage(
  fileType: string,
  missing: string[],
  actual: string[],
) {
  return `${fileType}缺少必要欄位！\n\n缺少的欄位：\n${missing.join("、")}\n\n實際檔案中的欄位：\n${actual.join("、")}\n\n請確認檔案格式是否正確。`;
}
/** 沒給 fileType 時維持短訊息（盤差原因匯入沿用）；給了就用舊版完整訊息。 */
export function validate(rows: Row[], headers: string[], fileType?: string) {
  const actual = Object.keys(rows[0] || {});
  const missing = headers.filter((h) => !actual.includes(h));
  if (missing.length)
    throw new Error(
      fileType
        ? missingColumnsMessage(fileType, missing, actual)
        : `缺少欄位：${missing.join("、")}`,
    );
  return rows;
}
export function num(v: any) {
  if (v === "" || v == null) return 0;
  const n = Number(String(v).replaceAll(",", ""));
  if (!Number.isFinite(n)) throw new Error(`數量不是有效數字：${v}`);
  return n;
}
const KIND_LABEL: Record<string, string> = {
  base: "1F當日商品資料",
  external: "外盤公司盤點檔",
  pre: "預盤資料",
  fks: "FKS0701",
  modified: "外盤公司盤點檔",
  internal: "內部複盤資料",
  missing: "未盤點檔案",
};
/** 外盤原始檔品號重複：訊息沿用舊版文字並列出全部重複品號。 */
export class DuplicateCodesError extends Error {
  codes: string[];
  constructor(codes: string[]) {
    super(
      `匯入失敗：外盤公司原始檔中發現重複品號！\n\n重複的品號有：\n${codes.join(", ")}\n\n系統已拒絕匯入此檔案。\n\n請聯繫外盤公司修正檔案後重新上傳，\n每個品號只能出現一次。`,
    );
    this.codes = codes;
  }
}
export function duplicateCodes(codes: string[]) {
  const seen = new Set<string>(),
    dup: string[] = [];
  for (const c of codes)
    if (c && seen.has(c)) {
      if (!dup.includes(c)) dup.push(c);
    } else seen.add(c);
  return dup;
}
export function normalize(rows: Row[], kind: string): Row[] {
  if (kind === "base") {
    const keys = Object.keys(rows[0] || {});
    // 檢查順序與舊版相同：儲位、庫存、其餘必要欄位。
    const loc = keys.find(
      (k) => k.includes("主要") && (k.includes("儲位") || k.includes("庫位")),
    );
    if (!loc)
      throw new Error(
        `1F當日商品資料缺少必要欄位！\n\n找不到「主要儲位」或「主要庫位」欄位\n\n實際檔案中的欄位：\n${keys.join("\n")}`,
      );
    const stock = keys.find((k) => k.includes("庫存") || k.includes("重存"));
    if (!stock) throw new Error("找不到「庫存」或「重存」欄位！");
    validate(rows, ["品號", "品名", "條碼"], KIND_LABEL.base);
    const unit = keys.find((k) => k.toUpperCase() === "UN" || k.includes("單位"));
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
    if (
      !keys.some((k) => k.includes("品號")) ||
      !keys.some((k) => k.includes("盤點數量"))
    )
      throw new Error(`找不到必要欄位！標題行內容：${keys.join(" | ")}`);
    rows = rows.map((r) =>
      Object.fromEntries(
        ["品號", "品名", "條碼", "盤點數量", "盤點儲位"].map((k) => [
          k,
          r[keys.find((h) => h.includes(k)) || k] ?? "",
        ]),
      ),
    );
  }
  const headers: Record<string, string[]> = {
    external: ["品號", "品名", "條碼", "盤點數量"],
    pre: ["品號", "盤點數量", "盤點儲位"],
    fks: ["品號", "盤點數量"],
    modified: ["貨號", "數量", "貨架", "棚板", "序號"],
    internal: ["品號", "庫存量", "該儲位盤點數量"],
    missing: ["品號", "庫存量", "盤點數量"],
  };
  validate(rows, headers[kind], KIND_LABEL[kind]);
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
          ? `外${String(r.貨架 ?? "").trim()}-${String(r.棚板 ?? "").trim()}`
          : String(r.盤點儲位 || ""),
      庫存量: num(r.庫存量),
    }));
  if (kind === "external") {
    const dup = duplicateCodes(result.map((r) => r.品號));
    if (dup.length) throw new DuplicateCodesError(dup);
  }
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

// ---------------------------------------------------------------- 預盤多檔逐檔容錯（A3）
export type FileFailure = { name: string; reason: string };
export type PerFileResult = {
  okFiles: { name: string; rows: Row[] }[];
  failedFiles: FileFailure[];
};
/** 簡短原因：缺欄位時帶上缺少的欄位，否則取訊息第一行。 */
export function shortReason(error: unknown) {
  const text = String((error as Error)?.message || error || "無法解析");
  const missing = text.match(/缺少的欄位：\n([^\n]+)/);
  if (missing) return `缺少欄位：${missing[1]}`;
  return text.split("\n")[0].slice(0, 80);
}
/** 每個檔案各自 try／catch：壞檔跳過並記錄原因，好檔照常收下。 */
export async function processFilesIndividually(
  files: { name: string; read: () => Promise<Row[]> | Row[] }[],
  kind: string,
): Promise<PerFileResult> {
  const okFiles: PerFileResult["okFiles"] = [],
    failedFiles: FileFailure[] = [];
  for (const f of files) {
    try {
      const rows = normalize(await f.read(), kind);
      if (!rows.length) {
        failedFiles.push({ name: f.name, reason: "無資料" });
        continue;
      }
      okFiles.push({ name: f.name, rows });
    } catch (error) {
      failedFiles.push({ name: f.name, reason: shortReason(error) });
    }
  }
  return { okFiles, failedFiles };
}
/** 「成功 N/M，失敗檔案：…」；全部失敗時 level 為 error。 */
export function summarizePerFile(r: PerFileResult) {
  const total = r.okFiles.length + r.failedFiles.length;
  const failed = r.failedFiles.length
    ? `，失敗檔案：${r.failedFiles.map((f) => `${f.name}（${f.reason}）`).join("、")}`
    : "";
  const level: "ok" | "warn" | "error" = r.okFiles.length
    ? r.failedFiles.length
      ? "warn"
      : "ok"
    : "error";
  return { level, text: `成功 ${r.okFiles.length}/${total}${failed}` };
}
/** 已成功的檔案留著，同名檔案以新的取代（重複上傳同一檔不會加倍）。 */
export function mergeOkFiles(
  existing: Record<string, Row[]>,
  incoming: PerFileResult["okFiles"],
) {
  const next = { ...existing };
  for (const f of incoming) next[f.name] = f.rows;
  return next;
}

// ---------------------------------------------------------------- 整合與最終檔
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
export type ConflictKind =
  | "zero-and-recount"
  | "stock-mismatch"
  | "duplicate-in-file";
export type Conflict = {
  code: string;
  kind: ConflictKind;
  /** 出現位置與各自的庫存量／盤點量。 */
  places: { source: string; stock?: number; qty?: number }[];
  detail: string;
};
export type FinalResult =
  | { ok: true; rows: Row[] }
  | { ok: false; conflicts: Conflict[] };
const SRC = {
  zero: "模組二保留的無盤差品項",
  internal: "修改後內部複盤資料",
  missing: "修改後未盤點檔案",
};
const KIND_ORDER: ConflictKind[] = [
  "zero-and-recount",
  "stock-mismatch",
  "duplicate-in-file",
];
/**
 * 合併無盤差、內部複盤、未盤點三份資料成 DPOS 結果檔。
 * 沒有衝突時輸出與舊版累加結果相同；有任何衝突就不產出，一次回報全部衝突（依品號、衝突類型排序，穩定）。
 * 衝突：(1) 同品號同時在無盤差與複盤資料；(2) 同品號在不同檔案或不同列的庫存量不一致；
 * (3) 同品號在「未盤點檔案」內重複（該檔每個品號只會有一列；內部複盤檔因多儲位本來就會有多列，不算）。
 */
export function finalRows(
  zero: Row[],
  internal: Row[],
  missing: Row[],
): FinalResult {
  const conflicts: Conflict[] = [];
  const zeroMap = new Map(zero.map((r) => [r.品號, r]));
  const tagged = [
    ...internal.map((r) => ({ r, source: SRC.internal })),
    ...missing.map((r) => ({ r, source: SRC.missing })),
  ];
  const byCode = new Map<string, typeof tagged>();
  for (const t of tagged) {
    const list = byCode.get(t.r.品號) || [];
    list.push(t);
    byCode.set(t.r.品號, list);
  }
  const place = (t: (typeof tagged)[number]) => ({
    source: t.source,
    stock: t.r.庫存量,
    qty: t.r.盤點數量,
  });
  for (const [c, list] of byCode) {
    if (zeroMap.has(c))
      conflicts.push({
        code: c,
        kind: "zero-and-recount",
        places: [
          { source: SRC.zero, stock: zeroMap.get(c)!.庫存量 },
          ...list.map(place),
        ],
        detail: "同時存在無盤差與複盤資料，請核對",
      });
    const stocks = new Set(list.map((t) => t.r.庫存量));
    if (stocks.size > 1)
      conflicts.push({
        code: c,
        kind: "stock-mismatch",
        places: list.map(place),
        detail: `庫存量不一致（${[...stocks].join("、")}）`,
      });
    const inMissing = list.filter((t) => t.source === SRC.missing);
    if (inMissing.length > 1)
      conflicts.push({
        code: c,
        kind: "duplicate-in-file",
        places: inMissing.map(place),
        detail: `在「${SRC.missing}」重複出現 ${inMissing.length} 次`,
      });
  }
  if (conflicts.length)
    return {
      ok: false,
      conflicts: conflicts.sort(
        (a, b) =>
          (a.code < b.code ? -1 : a.code > b.code ? 1 : 0) ||
          KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
      ),
    };
  const map = new Map<string, Row>(zero.map((r) => [r.品號, { ...r }]));
  for (const r of [...internal, ...missing]) {
    const p = map.get(r.品號) || { 品號: r.品號, 庫存量: r.庫存量, 實際量: 0 };
    p.實際量 += r.盤點數量;
    map.set(r.品號, p);
  }
  return {
    ok: true,
    rows: [...map.values()].map((r) => ({ ...r, 盤差量: r.實際量 - r.庫存量 })),
  };
}
export function conflictsToText(conflicts: Conflict[]) {
  return conflicts
    .map(
      (c) =>
        `${c.code}\t${c.detail}\t${c.places
          .map(
            (p) =>
              `${p.source}（庫存量 ${p.stock ?? "-"}${p.qty != null ? `、盤點量 ${p.qty}` : ""}）`,
          )
          .join("；")}`,
    )
    .join("\n");
}

// ---------------------------------------------------------------- 輸出
/** 活頁簿：工作表名稱預設 Sheet1（與舊版離線盤點工具輸出相同）。 */
export function buildWorkbook(X: any, rows: Row[], sheetName = "Sheet1") {
  const book = X.utils.book_new();
  X.utils.book_append_sheet(book, X.utils.json_to_sheet(rows), sheetName);
  return book;
}
export async function download(
  rows: Row[],
  name: string,
  sheetName = "Sheet1",
) {
  if (!rows.length) throw new Error("沒有可匯出的資料");
  const X = await import("xlsx"),
    book = buildWorkbook(X, rows, sheetName);
  X.writeFile(
    book,
    name.toLowerCase().endsWith(".xlsx") ? name : `${name}.xlsx`,
  );
}
/**
 * CSV：加 BOM；指定的純數字欄位（品號）以 ="…" 文字格式寫入，Excel 開啟時不會吃掉前導零。
 * 其他欄位以 ' 前綴擋掉試算表公式注入（=、+、@、-）。
 */
export function buildCsv(lines: any[][], textColumns: number[] = []) {
  const quote = (v: any, col: number) => {
    const s = String(v ?? "");
    if (textColumns.includes(col) && /^\d+$/.test(s)) return `"=""${s}"""`;
    return '"' + s.replace(/^[=+@\-]/, "'$&").replaceAll('"', '""') + '"';
  };
  return "﻿" + lines.map((r) => r.map(quote).join(",")).join("\r\n");
}
