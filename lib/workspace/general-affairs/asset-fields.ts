// 設備／設施欄位可見範圍（Q5）與保固狀態（台北時間）：純函式，伺服端與單元測試共用，無相依。
// Q5：門市負責人（店長）只看基本欄位（名稱、位置、狀態、保固、所屬門市等識別資訊）；金額、供應商、備註、序號、採購日、保固申請方式
//     只給有設備／設施查看或管理權限的人。由伺服端挑欄位（資料庫不改），清單、詳情、掃描頁、貼標任務都經過 pickAssetFields。

export type AssetKind = "equipment" | "facilities";
export type AssetLevel = "full" | "basic";
export const ASSET_TYPE: Record<AssetKind, "EQUIPMENT" | "FACILITY"> = { equipment: "EQUIPMENT", facilities: "FACILITY" };
export const ASSET_TABLE: Record<AssetKind, string> = { equipment: "ga_equipment", facilities: "ga_facilities" };

/** 基本欄位（資料庫實際欄位名）。設施的保固存在 specs，另外由 specs 取出，不整包回傳。 */
export const BASIC_COLUMNS: Record<AssetKind, readonly string[]> = {
  equipment: ["id", "store_id", "category_id", "name", "asset_code", "status", "area", "location_detail", "has_warranty", "warranty_end_date", "onboarding_status", "updated_at"],
  facilities: ["id", "store_id", "category_id", "name", "facility_code", "status", "area", "location_detail", "specs", "onboarding_status", "updated_at"],
};

/** 巢狀關聯（門市、分類）本身都是名稱類資料，兩種層級都可看。 */
export const RELATION_KEYS = ["store", "category"] as const;
const BASIC_EXTRA_KEYS = ["thumbnail_url", "open_transfer"] as const;

const FACILITY_WARRANTY_KEYS = { has: "facility_has_warranty", end: "facility_warranty_end_date" } as const;

// --------------------------------------------------------------------------- 台北日期
const TAIPEI = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" });
/** 台北時間今天的日期（YYYY-MM-DD）。 */
export function taipeiToday(now: Date = new Date()) {
  return TAIPEI.format(now);
}
const DAY_MS = 86_400_000;
const dayNumber = (date: string) => Math.floor(Date.parse(date + "T00:00:00Z") / DAY_MS);
export function addDays(date: string, days: number) {
  return new Date((dayNumber(date) + days) * DAY_MS).toISOString().slice(0, 10);
}

// --------------------------------------------------------------------------- 保固
export type WarrantyState = "none" | "missing" | "expired" | "expiring" | "active";
export type Warranty = { state: WarrantyState; days_left: number | null; label: string; tone: "slate" | "amber" | "red" | "green"; has_warranty: boolean; end_date: string | null };
/** 即將到期的門檻（含）。 */
export const WARRANTY_EXPIRING_DAYS = 30;

/** 保固狀態。到期日「當天結束」才算過期：台北時間今天 <= 到期日，仍在保固內（舊版用 UTC 時間差，到期日當天就被判過保）。 */
export function warrantyState(input: { has_warranty: boolean | null | undefined; end_date: string | null | undefined }, now: Date = new Date()): Warranty {
  const has = input.has_warranty === true;
  const end = input.end_date || null;
  if (!has) return { state: "none", days_left: null, label: "無保固", tone: "slate", has_warranty: false, end_date: end };
  if (!end) return { state: "missing", days_left: null, label: "保固日未填", tone: "amber", has_warranty: true, end_date: null };
  const days = dayNumber(end) - dayNumber(taipeiToday(now));
  if (days < 0) return { state: "expired", days_left: days, label: "已過保", tone: "red", has_warranty: true, end_date: end };
  if (days <= WARRANTY_EXPIRING_DAYS) return { state: "expiring", days_left: days, label: days === 0 ? "今天到期" : `${days} 天內到期`, tone: "amber", has_warranty: true, end_date: end };
  return { state: "active", days_left: days, label: end, tone: "green", has_warranty: true, end_date: end };
}

/** 取出保固輸入：設備在欄位，設施在 specs。 */
export function warrantyInput(kind: AssetKind, row: Record<string, any>) {
  if (kind === "equipment") return { has_warranty: row.has_warranty, end_date: row.warranty_end_date };
  const specs = row.specs && typeof row.specs === "object" ? row.specs : {};
  const end = specs[FACILITY_WARRANTY_KEYS.end];
  return { has_warranty: specs[FACILITY_WARRANTY_KEYS.has] === true, end_date: typeof end === "string" && end ? end : null };
}

/** 保固篩選對應的日期條件（台北今天為基準）。回傳給查詢組合器用，純資料。 */
export type WarrantyFilter = "none" | "missing" | "expired" | "expiring" | "active";
export const WARRANTY_FILTERS: readonly WarrantyFilter[] = ["none", "missing", "expired", "expiring", "active"];
export function warrantyRanges(now: Date = new Date()) {
  const today = taipeiToday(now);
  return { today, expiringEnd: addDays(today, WARRANTY_EXPIRING_DAYS) };
}

// --------------------------------------------------------------------------- 欄位挑選
/** 一般列（清單、詳情、掃描頁、貼標任務）依層級挑欄位。basic 一律不含金額、供應商、備註、序號、條碼、採購日、QR 與 specs 內容。 */
export function pickAssetFields(kind: AssetKind, row: Record<string, any>, level: AssetLevel, now: Date = new Date()) {
  const warranty = warrantyState(warrantyInput(kind, row), now);
  if (level === "full") {
    const out: Record<string, any> = { ...row, warranty };
    out.qr_scan_path = row.qr_token ? `/general-affairs/assets/scan/${row.qr_token}` : null;
    return out;
  }
  const out: Record<string, any> = {};
  for (const key of BASIC_COLUMNS[kind]) {
    if (key === "specs") continue; // 設施 specs 含保固申請方式等內部資料，只取保固
    if (key in row) out[key] = row[key];
  }
  for (const key of RELATION_KEYS) if (key in row) out[key] = row[key];
  for (const key of BASIC_EXTRA_KEYS) if (key in row) out[key] = row[key];
  if (kind === "facilities") {
    const w = warrantyInput(kind, row);
    out.has_warranty = w.has_warranty;
    out.warranty_end_date = w.end_date;
  }
  out.warranty = warranty;
  return out;
}

/** basic 層級實際查詢的欄位（資料庫端就不取回敏感欄位）。 */
export function basicSelect(kind: AssetKind) {
  return BASIC_COLUMNS[kind].join(",");
}

/** 判斷資料列是否還含有 basic 不該有的鍵（測試與防呆用）。 */
export const FULL_ONLY_KEYS: Record<AssetKind, readonly string[]> = {
  equipment: ["barcode", "brand", "model", "serial_number", "purchase_amount", "purchased_at", "installed_at", "activated_at", "notes", "specs", "tags", "purpose", "qr_token", "qr_scan_path", "template_id", "criticality", "template"],
  facilities: ["purchase_amount", "purchase_unit_amount", "purchased_at", "installed_at", "notes", "specs", "tags", "description", "qr_token", "qr_scan_path", "facility_template_id", "criticality", "quantity", "unit"],
};

// --------------------------------------------------------------------------- 編輯：只更新有改的欄位
const same = (a: unknown, b: unknown) => {
  if (a === b) return true;
  if ((a ?? null) === (b ?? null)) return true;
  if (a != null && b != null && typeof a !== "object" && typeof b !== "object") return String(a) === String(b) || (Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Number(a) === Number(b) && a !== "" && b !== "");
  if (typeof a === "object" && typeof b === "object" && a && b) return JSON.stringify(a) === JSON.stringify(b);
  return false;
};

/**
 * 部分更新：只留下與目前資料不同的欄位。specs 以「合併」處理（舊版編輯畫面整包送 `specs: {}` 會把「購買來源供應商」「保固申請方式」清空）：
 * patch.specs 內的鍵覆寫，沒提到的鍵保留；要清空某個鍵請明確送 null。
 */
export function diffAssetPatch(current: Record<string, any>, patch: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (key === "specs") {
      const base = current.specs && typeof current.specs === "object" ? current.specs : {};
      const merged = { ...base, ...(value && typeof value === "object" ? value : {}) };
      if (!same(base, merged)) out.specs = merged;
      continue;
    }
    if (!same(current[key], value)) out[key] = value;
  }
  return out;
}

/** 編輯畫面不再能直接改所屬門市（改走轉移單；建檔錯誤用「更正所屬門市」）。 */
export const STORE_ID_EDIT_MESSAGE = "不能直接修改所屬門市：平常換店請發起「轉移單」，建檔選錯門市請用「更正所屬門市」";
/** 已報廢（設備）或已退役（設施）會自動作廢 QR，狀態要恢復請用「恢復使用並重新啟用 QR」。 */
export const TERMINAL_STATUS: Record<AssetKind, string> = { equipment: "SCRAPPED", facilities: "RETIRED" };
export const RESTORE_REQUIRED_MESSAGE = "已報廢或已退役的資產要用「恢復使用並重新啟用 QR」，才能沿用原標籤";
/** B9：有進行中轉移單時不能改成的狀態（設備：退役、報廢；設施：退役）。與資料庫觸發器 ga_block_terminal_status_with_open_transfer 相同。 */
export const OPEN_TRANSFER_BLOCKED_STATUS: Record<AssetKind, string[]> = { equipment: ["RETIRED", "SCRAPPED"], facilities: ["RETIRED"] };
export function openTransferBlockMessage(kind: AssetKind, status: string, transferNo: string): string {
  const noun = kind === "equipment" ? "設備" : "設施";
  return `這台${noun}有進行中的轉移單 ${transferNo}，請先取消轉移單再${status === "SCRAPPED" ? "報廢" : "退役"}`;
}
export const LABEL_REPRINT_MESSAGE = "已修改資產編號：已印出的 QR 標籤上的編號要重新列印";

// --------------------------------------------------------------------------- 貼標進度
export const ONBOARDING_STATUSES = ["NEEDS_EQUIPMENT_PHOTO", "NEEDS_LABEL_PHOTO", "PENDING_GA_REVIEW", "COMPLETED"] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];
export const ONBOARDING_LABEL: Record<OnboardingStatus, { equipment: string; facility: string }> = {
  NEEDS_EQUIPMENT_PHOTO: { equipment: "待上傳設備照片", facility: "待上傳設施照片" },
  NEEDS_LABEL_PHOTO: { equipment: "待上傳貼標照片", facility: "待上傳貼標照片" },
  PENDING_GA_REVIEW: { equipment: "待總務複核", facility: "待總務複核" },
  COMPLETED: { equipment: "已完成", facility: "已完成" },
};
export const ONBOARDING_PERCENT: Record<OnboardingStatus, number> = { NEEDS_EQUIPMENT_PHOTO: 10, NEEDS_LABEL_PHOTO: 40, PENDING_GA_REVIEW: 75, COMPLETED: 100 };
export const PHOTO_PURPOSE_FOR_STATUS = { NEEDS_EQUIPMENT_PHOTO: "PRIMARY_IMAGE", NEEDS_LABEL_PHOTO: "LABEL_POSITION_IMAGE" } as const;
