// Q29 Excel 匯入既有設備與設施的 API。
// 流程：下載範本 -> 上傳（伺服端用 xlsx 解析，限 2MB、500 列）-> 逐列預檢（check）-> 確認後整批寫入（commit，全成或全不變）。
// 預檢與寫入都呼叫 ga_ws_import_assets（同一段資料庫程式，預檢會真的嘗試寫入再撤回，所以資料庫所有規則都會在預檢回報）；
// commit 會重新讀取檔案並重新檢查，不信任預檢結果。匯入後的設備／設施依資料庫預設進入「待上傳照片」貼標待辦（設施比照設備，解讀 (b)）。
import { NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { adminClient } from "../server";
import { dbCan, GA } from "./access";
import {
  CRITICALITY_BY_LABEL, EQUIPMENT_STATUS_BY_LABEL, FACILITY_STATUS_BY_LABEL, IMPORT_COLUMNS, IMPORT_SHEET_NAME, ImportFileError, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS,
  mapImportRows, parseImportWorkbook, type MappedRow,
} from "./import-columns";
import { findPossibleDuplicates, type DupResult, type ExistingAsset } from "./import-duplicates";
import { GaError, must, respond, rpc, type Context } from "./server";

const KEY_RE = /^[A-Za-z0-9_-]{8,80}$/;
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function assetImportApi(ctx: Context, request: NextRequest, rest: string[]) {
  const [head] = rest;
  const m = request.method;
  requireImportPermission(ctx);
  if (head === "reference" && m === "GET") return reference();
  if (head === "template" && m === "GET") return template();
  if (head === "check" && m === "POST") return run(ctx, request, true);
  if (head === "commit" && m === "POST") return run(ctx, request, false);
  throw new GaError(404, "找不到這個功能");
}

/** 設備或設施管理權限（資料庫語意）才能進匯入；各類型的權限由資料庫函式再依資料列檢查（只有設施管理權限者不能匯入設備）。 */
function requireImportPermission(ctx: Context) {
  if (!dbCan(ctx.permissions, GA.equipmentManage, GA.facilityManage)) throw new GaError(403, "沒有匯入設備或設施的權限");
}

async function loadReference() {
  const admin: any = adminClient();
  const [stores, eq, fac] = await Promise.all([
    must(admin.from("stores").select("store_code,store_name,short_name").eq("is_active", true).order("store_code").limit(2000)),
    must(admin.from("ga_equipment_categories").select("code,name").is("deleted_at", null).eq("is_active", true).order("code").limit(2000)),
    must(admin.from("ga_facility_categories").select("code,name").is("deleted_at", null).eq("is_active", true).order("code").limit(2000)),
  ]);
  return { stores: (stores as any[]) || [], equipmentCategories: (eq as any[]) || [], facilityCategories: (fac as any[]) || [] };
}

async function reference() {
  const ref = await loadReference();
  return respond({
    ...ref,
    columns: IMPORT_COLUMNS.map((c) => ({ header: c.header, required: !!c.required, hint: c.hint })),
    equipmentStatuses: Object.keys(EQUIPMENT_STATUS_BY_LABEL),
    facilityStatuses: Object.keys(FACILITY_STATUS_BY_LABEL),
    criticalities: Object.keys(CRITICALITY_BY_LABEL),
    limits: { maxRows: MAX_IMPORT_ROWS, maxBytes: MAX_IMPORT_BYTES },
  });
}

async function template() {
  const ref = await loadReference();
  const wb = XLSX.utils.book_new();
  // 第一個工作表就是上傳時讀取的資料表：只有表頭；代碼、編號欄預先設成文字格式，避免 Excel 把 001 變成 1。
  const sheet: XLSX.WorkSheet = {};
  IMPORT_COLUMNS.forEach((c, i) => {
    sheet[XLSX.utils.encode_cell({ r: 0, c: i })] = { t: "s", v: c.header };
    if (c.text) for (let r = 1; r <= MAX_IMPORT_ROWS; r++) sheet[XLSX.utils.encode_cell({ r, c: i })] = { t: "s", v: "", z: "@" };
  });
  sheet["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: MAX_IMPORT_ROWS, c: IMPORT_COLUMNS.length - 1 } });
  sheet["!cols"] = IMPORT_COLUMNS.map((c) => ({ wch: Math.max(10, c.header.length * 2 + 2) }));
  XLSX.utils.book_append_sheet(wb, sheet, IMPORT_SHEET_NAME);
  const guide = [["欄位", "是否必填", "說明"], ...IMPORT_COLUMNS.map((c) => [c.header, c.required ? "必填" : "選填", c.hint]),
    [], ["注意"], [`1. 只讀取第一個工作表「${IMPORT_SHEET_NAME}」，第一列是欄位標題，第二列起填資料；單次最多 ${MAX_IMPORT_ROWS} 列。`],
    ["2. 任何一列有錯，整批都不會匯入；先在畫面上看預檢結果、改好再上傳。"],
    ["3. 匯入後每台設備與設施都會進入「貼標待辦」，由店長上傳照片與貼標位置照片，再由總務複核。"]];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(guide), "填寫說明");
  const codes: string[][] = [["門市代碼", "門市名稱"], ...ref.stores.map((s) => [s.store_code, s.short_name || s.store_name]), [],
    ["設備分類代碼", "設備分類名稱"], ...ref.equipmentCategories.map((c) => [c.code, c.name]), [],
    ["設施分類代碼", "設施分類名稱"], ...ref.facilityCategories.map((c) => [c.code, c.name])];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(codes), "代碼對照");
  const buffer: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": XLSX_TYPE,
      "Content-Disposition": "attachment; filename=asset-import-template.xlsx; filename*=UTF-8''%E8%A8%AD%E5%82%99%E8%A8%AD%E6%96%BD%E5%8C%AF%E5%85%A5%E7%AF%84%E6%9C%AC.xlsx",
      "Cache-Control": "no-store",
    },
  });
}

async function readUpload(request: NextRequest) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new GaError(400, "上傳內容格式錯誤，或檔案太大（上限 2MB）");
  }
  const file = form.get("file");
  if (!file || typeof file !== "object" || !("arrayBuffer" in file)) throw new GaError(400, "請選擇要匯入的 Excel 檔");
  const f = file as File;
  if (!/\.xlsx$/i.test(f.name)) throw new GaError(400, "只收 Excel（.xlsx）檔，請使用下載的範本");
  if (f.size <= 0) throw new GaError(400, "檔案是空的");
  if (f.size > MAX_IMPORT_BYTES) throw new GaError(400, "檔案太大，上限 2MB");
  return { form, name: f.name.slice(0, 200), buffer: Buffer.from(await f.arrayBuffer()) };
}

async function run(ctx: Context, request: NextRequest, dryRun: boolean) {
  const { form, name, buffer } = await readUpload(request);
  let key = "";
  if (!dryRun) {
    key = String(form.get("idempotencyKey") || "").trim();
    if (!KEY_RE.test(key)) throw new GaError(400, "缺少或錯誤的防重複識別碼");
  }
  let mapped: MappedRow[];
  try {
    mapped = mapImportRows(parseImportWorkbook(buffer));
  } catch (e) {
    if (e instanceof ImportFileError) throw new GaError(400, e.message);
    throw e;
  }
  const good = mapped.filter((r) => r.row);
  const formatErrors = mapped.length - good.length;
  type DbResult = { committed: boolean; total?: number; equipment_count?: number; facility_count?: number; already_imported?: boolean; batch_id?: string | null; store_count: number; errors: { row_no: number; error: string }[]; rows: { row_no: number; code?: string | null }[] };
  let db: DbResult = { committed: false, store_count: 0, errors: [], rows: [] };
  // 格式有錯時，寫入一律不執行；預檢仍把格式沒問題的列交給資料庫，讓使用者一次看到所有問題。
  if (good.length && (dryRun || !formatErrors)) {
    const r = await rpc(ctx, "ga_ws_import_assets", { p_rows: good.map((g) => g.row), p_file_name: name, p_idempotency_key: key || null, p_dry_run: dryRun });
    db = r.data as DbResult;
  }
  if (db.already_imported) {
    return respond({ dryRun, committed: true, alreadyImported: true, batchId: db.batch_id ?? null, fileName: name, canCommit: false, summary: { total: db.total ?? 0, okCount: db.total ?? 0, errorCount: 0, equipmentCount: db.equipment_count ?? 0, facilityCount: db.facility_count ?? 0, storeCount: db.store_count }, rows: [] });
  }
  const dbErrors = new Map<number, string>(db.errors.map((e) => [e.row_no, e.error]));
  const dbRows = new Map<number, { code?: string | null }>(db.rows.map((x) => [x.row_no, x]));
  // B10：沒填編號且「同類型＋同門市＋名稱」與既有資料或同檔其他列相同 -> 可能重複提醒（只提醒，不擋；只在預檢計算）。
  let dups = new Map<number, DupResult>();
  if (dryRun) {
    const dupRows = good.map((g) => ({ row_no: g.row_no, kind: g.kind as "EQUIPMENT" | "FACILITY", store_code: g.store_code, name: g.name, hasCode: !!(g.row && (g.kind === "EQUIPMENT" ? g.row.asset_code : g.row.facility_code)) }));
    dups = findPossibleDuplicates(dupRows, await loadExistingForDuplicates(dupRows));
  }
  const rows = mapped.map((r) => {
    const errors = r.row ? (dbErrors.has(r.row_no) ? [dbErrors.get(r.row_no)!] : []) : r.errors;
    const duplicate = dups.get(r.row_no) ?? null;
    return { row_no: r.row_no, kind: r.kind, store_code: r.store_code, category_code: r.category_code, name: r.name, code: dbRows.get(r.row_no)?.code ?? null, ok: !errors.length, errors, warnings: duplicate ? [duplicate.message] : [], duplicate };
  });
  const summary = summarize(rows);
  return respond({
    dryRun, committed: !!db.committed, alreadyImported: false, batchId: db.batch_id ?? null, fileName: name,
    canCommit: dryRun && summary.errorCount === 0 && summary.total > 0, summary, rows,
  });
}

/** B10：讀出相關門市的既有（未刪除）設備與設施，供「可能重複」比對（分頁讀完，不受單次 1000 筆上限影響）。 */
async function loadExistingForDuplicates(rows: { kind: string; store_code: string }[]): Promise<ExistingAsset[]> {
  const admin: any = adminClient();
  const codes = Array.from(new Set(rows.map((r) => r.store_code.trim().toUpperCase())));
  if (!codes.length) return [];
  const stores = ((await must(admin.from("stores").select("id,store_code").limit(5000))) as any[]) || [];
  const byId = new Map<string, string>();
  for (const st of stores) if (codes.includes(String(st.store_code).toUpperCase())) byId.set(st.id, String(st.store_code).toUpperCase());
  if (!byId.size) return [];
  const ids = Array.from(byId.keys());
  const out: ExistingAsset[] = [];
  for (const [kind, table, codeCol] of [["EQUIPMENT", "ga_equipment", "asset_code"], ["FACILITY", "ga_facilities", "facility_code"]] as const) {
    if (!rows.some((r) => r.kind === kind)) continue;
    for (let from = 0; ; from += 1000) {
      const page = ((await must(admin.from(table).select(`id,store_id,name,${codeCol},created_at`).in("store_id", ids).is("deleted_at", null).order("created_at").order("id").range(from, from + 999))) as any[]) || [];
      for (const a of page) out.push({ kind, store_code: byId.get(a.store_id) || "", name: String(a.name || ""), code: a[codeCol] || null, created_at: a.created_at || null });
      if (page.length < 1000) break;
    }
  }
  return out;
}

function summarize(rows: { ok: boolean; kind: string | null; store_code: string; duplicate?: DupResult | null }[]) {
  const errorCount = rows.filter((r) => !r.ok).length;
  return {
    total: rows.length, okCount: rows.length - errorCount, errorCount,
    equipmentCount: rows.filter((r) => r.kind === "EQUIPMENT").length, facilityCount: rows.filter((r) => r.kind === "FACILITY").length,
    storeCount: new Set(rows.map((r) => r.store_code.trim().toUpperCase())).size,
    duplicateCount: rows.filter((r) => r.duplicate).length,
  };
}
