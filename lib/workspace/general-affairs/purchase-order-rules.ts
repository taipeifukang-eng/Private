// 總務採購單（M7/M8 第 4 批 G25）共用規則：純函式，無相依，單元測試直接引用，Next API 與 Vue 頁面共用同一份。
// 與資料庫函式（supabase/workspace-dev/20261112110000_m7m8_b4_purchase_orders.sql）的規則一致，改一邊要同步改另一邊。
// 涵蓋：狀態與合法流轉表、金額與稅額（四捨五入到整數元）、核准門檻（大於才需核准）、單號（台北日期流水）、需求量加總與超量、剩餘可收量、
//      歷史價篩選、abilities（按鈕與 API 預檢共用：三個權限缺哪個講清楚、核准人不可為開單人與最後送核准人）、帳務欄位遮蔽、輸入驗證。

export const PO_STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "ORDERED", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED", "CANCELED"] as const;
export type PoStatus = (typeof PO_STATUSES)[number];
export const PO_STATUS_LABEL: Record<PoStatus, string> = {
  DRAFT: "草稿", PENDING_APPROVAL: "待核准", APPROVED: "已核准待下訂", ORDERED: "已下訂", PARTIALLY_RECEIVED: "部分到貨", RECEIVED: "全部到貨", CLOSED: "已結案", CANCELED: "已取消",
};
/** 已下訂以上（歷史價只算這些狀態，D9）。 */
export const ORDERED_OR_BEYOND: readonly PoStatus[] = ["ORDERED", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED"];
/** 算入「需求量已被占用」的狀態：所有未取消（含草稿，D2、D4）。 */
export const ACTIVE_FOR_REQUEST: readonly PoStatus[] = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "ORDERED", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED"];
/** 下訂後品項、數量、單價、供應商鎖定（D10）：這些狀態只能改備註與預計到貨日。 */
export const LOCKED_AFTER_ORDER: readonly PoStatus[] = ["ORDERED", "PARTIALLY_RECEIVED", "RECEIVED"];
/** 完全不能改。 */
export const TERMINAL: readonly PoStatus[] = ["CLOSED", "CANCELED"];

export const PO_ACTIONS = ["submit", "withdraw", "approve", "reject", "revoke_approval", "place_order", "cancel", "short_close", "close"] as const;
export type PoAction = (typeof PO_ACTIONS)[number];
export const PO_ACTION_LABEL: Record<PoAction, string> = {
  submit: "送核准", withdraw: "撤回", approve: "核准", reject: "駁回", revoke_approval: "撤回核准", place_order: "下訂", cancel: "取消", short_close: "短收結案", close: "結案",
};

/** 合法流轉表：動作 → 允許的目前狀態。place_order 與 cancel 的結果狀態固定，其餘看 nextStatus。 */
export const ACTION_FROM: Record<PoAction, readonly PoStatus[]> = {
  submit: ["DRAFT"],
  withdraw: ["PENDING_APPROVAL"],
  approve: ["PENDING_APPROVAL"],
  reject: ["PENDING_APPROVAL"],
  revoke_approval: ["APPROVED"],
  place_order: ["DRAFT", "APPROVED"],
  cancel: ["DRAFT", "PENDING_APPROVAL", "APPROVED", "ORDERED"],
  short_close: ["PARTIALLY_RECEIVED"],
  close: ["RECEIVED"],
};
const ACTION_TO: Record<PoAction, PoStatus> = {
  submit: "PENDING_APPROVAL", withdraw: "DRAFT", approve: "APPROVED", reject: "DRAFT", revoke_approval: "DRAFT", place_order: "ORDERED", cancel: "CANCELED", short_close: "CLOSED", close: "CLOSED",
};
export const canTransition = (from: string, action: string): boolean => (PO_ACTIONS as readonly string[]).includes(action) && ACTION_FROM[action as PoAction].includes(from as PoStatus);
export const nextStatus = (from: string, action: string): PoStatus | null => (canTransition(from, action) ? ACTION_TO[action as PoAction] : null);
/** 動作要求填原因：駁回、撤回核准、短收結案一律；取消只有已下訂（尚未到貨）時必填。 */
export function reasonRequired(action: string, status: string): boolean {
  if (action === "reject" || action === "revoke_approval" || action === "short_close") return true;
  return action === "cancel" && status === "ORDERED";
}

// ---------------------------------------------------------------- 金額（D6、D7）
export const DEFAULT_APPROVAL_THRESHOLD = 5000;
export const DEFAULT_TAX_RATE = 0.05;
export const DEFAULT_PRICE_HISTORY_LIMIT = 5;
/** 四捨五入到整數元（與資料庫 round() 相同：.5 進位；金額不為負）。先轉成固定小數避免 1.005 這類浮點誤差。 */
export function roundYuan(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const v = Math.round((Math.abs(n) + Number.EPSILON) * 1e6) / 1e6;
  const r = Math.floor(v + 0.5);
  return n < 0 ? -r : r;
}
export const lineAmount = (quantity: number, unitPrice: number): number => roundYuan(quantity * unitPrice);
export type Totals = { subtotal: number; tax_amount: number; total_amount: number };
/** 未稅小計 = 各品項金額（各自四捨五入）加總；稅額 = 小計 × 稅率 四捨五入；含稅總額 = 小計 + 稅額。 */
export function computeTotals(items: { quantity: number; unit_price: number }[], taxRate: number = DEFAULT_TAX_RATE): Totals {
  const subtotal = items.reduce((s, i) => s + lineAmount(i.quantity, i.unit_price), 0);
  const tax = roundYuan(subtotal * taxRate);
  return { subtotal, tax_amount: tax, total_amount: subtotal + tax };
}
/** 含稅總額「大於」門檻才需核准（剛好等於門檻免核准）；未啟用核准一律免。 */
export const needsApproval = (totalAmount: number, threshold: number = DEFAULT_APPROVAL_THRESHOLD, enabled = true): boolean => enabled && totalAmount > threshold;

// ---------------------------------------------------------------- 單號 PO-YYYYMMDD-NNN（台北日期、每日流水歸零、滿 999 擴位）
/** 台北日期 YYYYMMDD（不受執行環境時區影響）。 */
export function taipeiDay(d: Date | string | number = new Date()): string {
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) throw new Error("日期格式錯誤");
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(t);
  const g = (k: string) => parts.find((p) => p.type === k)?.value || "";
  return `${g("year")}${g("month")}${g("day")}`;
}
export function formatPoNo(day: string, seq: number): string {
  if (!/^\d{8}$/.test(day)) throw new Error("日期必須是 YYYYMMDD");
  if (!Number.isInteger(seq) || seq < 1) throw new Error("流水號必須是正整數");
  return `PO-${day}-${String(seq).padStart(3, "0")}`;
}
/** 依當天已有的單號算下一個（只看同一天，其他天與格式不符的忽略）。 */
export function nextPoNo(day: string, existing: string[]): string {
  const re = new RegExp(`^PO-${day}-(\\d+)$`);
  let max = 0;
  for (const no of existing) {
    const m = re.exec(no);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return formatPoNo(day, max + 1);
}
export const PO_NO_RE = /^PO-\d{8}-\d{3,}$/;

// ---------------------------------------------------------------- 數量
/** 換算基本單位：用採購單位時乘換算率；單位不是料件的基本或採購單位就丟錯。自由品名（沒有料件）數量即基本量。 */
export function toBaseQty(quantity: number, unit: string, part?: { base_unit: string; purchase_unit?: string | null; purchase_to_base_rate?: number | null } | null): number {
  if (!part) return quantity;
  if (unit === part.base_unit) return quantity;
  if (part.purchase_unit && unit === part.purchase_unit && Number(part.purchase_to_base_rate) > 0) return Math.round(quantity * Number(part.purchase_to_base_rate) * 1e4) / 1e4;
  throw new Error(`單位只能是料件的基本單位「${part.base_unit}」${part.purchase_unit ? `或採購單位「${part.purchase_unit}」` : ""}`);
}
/** 需求單剩餘量（基本單位）：沒有需求量（null）代表不限制。 */
export function requestRemaining(requestedBase: number | null, committedBase: number): number | null {
  return requestedBase == null ? null : Math.max(0, requestedBase - committedBase);
}
/** D2、D3：本單加其他未取消採購單超過需求量，就要填超量原因（容許 0.00005 浮點誤差，與資料庫一致）。 */
export function isOverRequest(requestedBase: number | null, committedOthersBase: number, mineBase: number): boolean {
  return requestedBase != null && committedOthersBase + mineBase > requestedBase + 0.00005;
}
/** 超量時，哪些品項沒有填原因（回傳項次，從 1 起算）。 */
export function itemsMissingOverReason(items: { request_id?: string | null; over_request_reason?: string | null }[], requestId: string): number[] {
  return items.flatMap((i, idx) => (i.request_id === requestId && !String(i.over_request_reason ?? "").trim() ? [idx + 1] : []));
}
/** D13：到貨量不得超過剩餘可收量（訂購量減已驗入量）。 */
export const receivableRemaining = (orderedBase: number, receivedBase: number): number => Math.max(0, Math.round((orderedBase - receivedBase) * 1e4) / 1e4);

// ---------------------------------------------------------------- 歷史價（D9）
export type HistoryRow = { status: string; ordered_at?: string | null; part_id?: string | null; unit_price: number; vendor_name?: string | null; po_no: string; quantity: number };
/** 同料件最近 N 筆「已下訂以上」；草稿、待核准、已核准未下訂、已取消不算；依下訂時間新到舊。 */
export function priceHistory(rows: HistoryRow[], partId: string, limit: number = DEFAULT_PRICE_HISTORY_LIMIT): HistoryRow[] {
  const n = Math.min(Math.max(Math.trunc(limit) || DEFAULT_PRICE_HISTORY_LIMIT, 1), 20);
  return rows
    .filter((r) => r.part_id === partId && (ORDERED_OR_BEYOND as readonly string[]).includes(r.status) && r.ordered_at)
    .sort((a, b) => Date.parse(b.ordered_at as string) - Date.parse(a.ordered_at as string) || (b.po_no > a.po_no ? 1 : -1))
    .slice(0, n);
}

// ---------------------------------------------------------------- 權限與 abilities
export type PoWho = {
  /** 採購評估管理 */ reviewManage: boolean;
  /** 庫存交易管理 */ transactionManage: boolean;
  /** 料件查看 */ partView: boolean;
  /** 採購核准 */ approve: boolean;
  /** 廠商檢視或管理 */ vendorView: boolean;
  /** 採購評估檢視 */ reviewView?: boolean;
  userId: string;
};
export type PoLike = { status: string; created_by?: string | null; submitted_by?: string | null; received_qty_total?: number };
export function missingPermissions(w: Pick<PoWho, "reviewManage" | "transactionManage" | "partView">): string[] {
  const out: string[] = [];
  if (!w.reviewManage) out.push("採購評估管理");
  if (!w.transactionManage) out.push("庫存交易管理");
  if (!w.partView) out.push("料件查看");
  return out;
}
export function permissionProblem(w: Pick<PoWho, "reviewManage" | "transactionManage" | "partView">): string {
  const m = missingPermissions(w);
  return m.length ? `採購單需要「採購評估管理」、「庫存交易管理」與「料件查看」三個權限，您缺少：${m.join("、")}` : "";
}
/** 看得到採購單：採購評估檢視或管理，或有採購核准權限（核准人不需要三個採購權限）。 */
export const canViewPo = (w: Pick<PoWho, "reviewManage" | "approve" | "reviewView">): boolean => !!(w.reviewManage || w.reviewView || w.approve);
export const canSeePendingList = (w: Pick<PoWho, "approve">): boolean => w.approve;

/** 核准人限制（D6／D11）：不可是開單人，也不可是最後一次送核准的人；管理員不繞過。回傳空字串代表可以。 */
export function approverBlock(who: Pick<PoWho, "userId">, po: Pick<PoLike, "created_by" | "submitted_by">): string {
  if (po.created_by && po.created_by === who.userId) return "您是這張採購單的開單人，不能自己核准或駁回，請由其他持有「採購核准」權限的人處理";
  if (po.submitted_by && po.submitted_by === who.userId) return "您是這張採購單最後一次送核准的人，不能自己核准或駁回，請由其他持有「採購核准」權限的人處理";
  return "";
}

export type PoAbilities = Record<PoAction | "edit" | "editNotesOnly", boolean> & { problem: string; problemNotice: string; approveBlocked: string; showAmounts: boolean; showVendorBilling: boolean };
/**
 * 詳情視窗頂端要不要提示「缺哪些採購權限」（problem 仍照舊給 API 預檢用，不受影響）。
 * 只有「有部分採購權限、但缺其他」時才提示（他可能會試圖做需要三個權限的動作）；
 * 完全沒有這三個權限的人（只有檢視、或只有採購核准的核准人）不提示——核准不需要這些權限，提示只會誤導。
 * 另外能核准這張單的人也不提示。
 */
export function permissionNotice(who: Pick<PoWho, "reviewManage" | "transactionManage" | "partView">, canApproveThis: boolean): string {
  const has = [who.reviewManage, who.transactionManage, who.partView].filter(Boolean).length;
  if (has === 0 || has === 3 || canApproveThis) return "";
  return permissionProblem(who);
}
export function poAbilities(who: PoWho, po: PoLike): PoAbilities {
  const problem = permissionProblem(who);
  const writer = problem === "";
  const s = po.status as PoStatus;
  const received = (po.received_qty_total ?? 0) > 0;
  const block = who.approve ? approverBlock(who, po) : "";
  const can = (a: PoAction) => canTransition(s, a);
  return {
    submit: writer && can("submit"),
    withdraw: writer && can("withdraw"),
    approve: who.approve && can("approve") && block === "",
    reject: who.approve && can("reject") && block === "",
    revoke_approval: writer && can("revoke_approval"),
    place_order: writer && can("place_order"),
    // 已有到貨紀錄只能短收結案，不能取消（D10）。
    cancel: writer && can("cancel") && !(s === "ORDERED" && received),
    short_close: writer && can("short_close"),
    close: writer && can("close"),
    edit: writer && s === "DRAFT",
    editNotesOnly: writer && (LOCKED_AFTER_ORDER as readonly string[]).includes(s),
    problem,
    problemNotice: permissionNotice(who, who.approve && can("approve") && block === ""),
    approveBlocked: who.approve && canTransition(s, "approve") ? block : "",
    showAmounts: canViewPo(who),
    showVendorBilling: who.vendorView,
  };
}

/** 帳務欄位遮蔽（D8）：沒有廠商檢視或管理權限者，統編與付款條件（含快照）一律拿掉，只留供應商名稱。 */
export function maskVendorBilling<T extends Record<string, any>>(po: T, vendorView: boolean): T {
  if (vendorView) return po;
  const out: Record<string, any> = { ...po };
  for (const k of ["vendor_tax_id", "vendor_payment_terms", "vendor_tax_id_snapshot", "vendor_payment_terms_snapshot"]) if (k in out) out[k] = null;
  out.vendor_billing_visible = false;
  return out as T;
}

// ---------------------------------------------------------------- 輸入驗證（API 邊界；資料庫仍會再驗一次）
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text = (v: unknown) => String(v ?? "").trim();
const hasKey = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const NUM4 = /^\d+(\.\d{1,4})?$/;
export const FULFIL_MODES = ["STOCK", "DIRECT_ASSET", "NO_STOCK"] as const;
export type FulfilMode = (typeof FULFIL_MODES)[number];
export const FULFIL_LABEL: Record<FulfilMode, string> = { STOCK: "入總部庫存", DIRECT_ASSET: "到貨直接建設備", NO_STOCK: "只登錄到貨" };
export const MAX_ITEMS = 50;

export type PoItemInput = {
  part_id: string | null; item_name: string | null; spec: string | null; unit: string | null; quantity: number; unit_price: number; request_id: string | null;
  fulfil_mode: FulfilMode; target_store_id: string | null; equipment_template_id: string | null; over_request_reason: string | null; notes: string | null;
};
const ITEM_FIELDS = ["part_id", "item_name", "spec", "unit", "quantity", "unit_price", "request_id", "fulfil_mode", "target_store_id", "equipment_template_id", "over_request_reason", "notes"] as const;

function uuidOrNull(v: unknown, label: string): string | null {
  const s = text(v);
  if (!s) return null;
  if (!UUID.test(s)) throw new Error(`${label}格式錯誤`);
  return s;
}
function num(v: unknown, label: string, allowZero: boolean): number {
  const s = text(v).replace(/,/g, "");
  if (!NUM4.test(s)) throw new Error(`${label}必須是${allowZero ? "0 以上" : "大於 0"}的數字，最多 4 位小數`);
  const n = Number(s);
  if (!Number.isFinite(n) || (!allowZero && n <= 0) || n > 999_999_999) throw new Error(`${label}必須是${allowZero ? "0 以上" : "大於 0"}的數字，最多 4 位小數`);
  return n;
}

export function validateItems(input: unknown): PoItemInput[] {
  if (!Array.isArray(input)) throw new Error("品項必須是清單");
  if (input.length === 0) throw new Error("請至少加入一個品項");
  if (input.length > MAX_ITEMS) throw new Error(`一張採購單最多 ${MAX_ITEMS} 個品項`);
  return input.map((raw, idx) => {
    const n = idx + 1;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`第 ${n} 項格式錯誤`);
    const r = raw as Record<string, unknown>;
    for (const k of Object.keys(r)) if (!(ITEM_FIELDS as readonly string[]).includes(k)) throw new Error(`第 ${n} 項不支援的欄位：${k}`);
    const part = uuidOrNull(r.part_id, `第 ${n} 項的料件`);
    const name = text(r.item_name) || null;
    if (!part && !name) throw new Error(`第 ${n} 項請選擇料件或填寫品名`);
    if (name && name.length > 200) throw new Error(`第 ${n} 項品名不可超過 200 字`);
    const spec = text(r.spec) || null;
    if (spec && spec.length > 200) throw new Error(`第 ${n} 項規格不可超過 200 字`);
    const unit = text(r.unit) || null;
    if (unit && unit.length > 20) throw new Error(`第 ${n} 項單位不可超過 20 字`);
    const quantity = num(r.quantity, `第 ${n} 項數量`, false);
    const price = hasKey(r, "unit_price") && text(r.unit_price) !== "" ? num(r.unit_price, `第 ${n} 項單價`, true) : 0;
    const mode = (text(r.fulfil_mode).toUpperCase() || (part ? "STOCK" : "NO_STOCK")) as FulfilMode;
    if (!(FULFIL_MODES as readonly string[]).includes(mode)) throw new Error(`第 ${n} 項的處理方式錯誤`);
    if (mode === "STOCK" && !part) throw new Error(`第 ${n} 項要入總部庫存，必須選擇料件（自由品名請選「只登錄到貨」）`);
    const store = uuidOrNull(r.target_store_id, `第 ${n} 項的門市`);
    if (mode === "DIRECT_ASSET") {
      if (!store) throw new Error(`第 ${n} 項要直接建立設備，請選擇送往的門市`);
      if (!Number.isInteger(quantity) && !part) throw new Error(`第 ${n} 項要直接建立設備，數量必須是整數`);
    }
    const over = text(r.over_request_reason) || null;
    if (over && over.length > 200) throw new Error(`第 ${n} 項超量原因不可超過 200 字`);
    const notes = text(r.notes) || null;
    if (notes && notes.length > 500) throw new Error(`第 ${n} 項備註不可超過 500 字`);
    return {
      part_id: part, item_name: name, spec, unit, quantity, unit_price: price, request_id: uuidOrNull(r.request_id, `第 ${n} 項的需求單`), fulfil_mode: mode,
      target_store_id: mode === "DIRECT_ASSET" ? store : null, equipment_template_id: mode === "DIRECT_ASSET" ? uuidOrNull(r.equipment_template_id, `第 ${n} 項的設備型號`) : null,
      over_request_reason: over, notes,
    };
  });
}

export type PoHeaderInput = Partial<{ vendor_id: string | null; receiving_location_id: string | null; expected_delivery_date: string | null; notes: string | null }>;
const HEADER_FIELDS = ["vendor_id", "receiving_location_id", "expected_delivery_date", "notes"] as const;
/** 表頭只收出現的鍵（出現且空白代表清空）；預計到貨日必須是有效日期。 */
export function validateHeader(input: unknown): PoHeaderInput {
  if (input == null) return {};
  if (typeof input !== "object" || Array.isArray(input)) throw new Error("採購單內容格式錯誤");
  const raw = input as Record<string, unknown>;
  for (const k of Object.keys(raw)) if (!(HEADER_FIELDS as readonly string[]).includes(k)) throw new Error(`不支援的欄位：${k}`);
  const out: PoHeaderInput = {};
  if (hasKey(raw, "vendor_id")) out.vendor_id = uuidOrNull(raw.vendor_id, "供應商");
  if (hasKey(raw, "receiving_location_id")) out.receiving_location_id = uuidOrNull(raw.receiving_location_id, "收貨位置");
  if (hasKey(raw, "expected_delivery_date")) {
    const s = text(raw.expected_delivery_date);
    if (s) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`)) || new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) !== s) throw new Error("預計到貨日不是有效的日期（YYYY-MM-DD）");
    }
    out.expected_delivery_date = s || null;
  }
  if (hasKey(raw, "notes")) {
    const s = text(raw.notes);
    if (s.length > 1000) throw new Error("備註不可超過 1000 字");
    out.notes = s || null;
  }
  return out;
}

export function validateCreatePayload(input: unknown): { header: PoHeaderInput; items: PoItemInput[]; idempotency_key: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("送出的內容格式錯誤");
  const raw = input as Record<string, unknown>;
  for (const k of Object.keys(raw)) if (!["header", "items", "idempotency_key"].includes(k)) throw new Error(`不支援的欄位：${k}`);
  const key = text(raw.idempotency_key);
  if (!key) throw new Error("缺少防重複識別碼，請重新整理畫面後再送出");
  if (key.length > 60) throw new Error("防重複識別碼過長");
  return { header: validateHeader(raw.header), items: validateItems(raw.items), idempotency_key: key };
}

export function validateActionPayload(input: unknown, status?: string): { action: PoAction; expected_updated_at: string; note: string | null } {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("送出的內容格式錯誤");
  const raw = input as Record<string, unknown>;
  for (const k of Object.keys(raw)) if (!["action", "expected_updated_at", "note"].includes(k)) throw new Error(`不支援的欄位：${k}`);
  const action = text(raw.action);
  if (!(PO_ACTIONS as readonly string[]).includes(action)) throw new Error("不支援的動作");
  const expected = text(raw.expected_updated_at);
  if (!expected) throw new Error("缺少版本資訊（expected_updated_at），請重新載入畫面");
  if (Number.isNaN(Date.parse(expected))) throw new Error("版本資訊格式錯誤，請重新載入畫面");
  const note = text(raw.note) || null;
  if (note && note.length > 500) throw new Error("備註或原因不可超過 500 字");
  if (status !== undefined && reasonRequired(action, status) && !note) {
    throw new Error(action === "reject" ? "駁回必須填寫原因" : action === "revoke_approval" ? "撤回核准必須填寫原因" : action === "short_close" ? "短收結案必須填寫原因" : "已下訂的採購單取消必須填寫原因");
  }
  return { action: action as PoAction, expected_updated_at: expected, note };
}

/** 設定（門檻、稅率、歷史價筆數、啟用核准）：只收白名單鍵，數值範圍與資料庫一致。 */
export function validateSettingsPayload(input: unknown): { values: Partial<{ approval_enabled: boolean; approval_threshold: number; tax_rate: number; price_history_limit: number }>; expected_updated_at: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("送出的內容格式錯誤");
  const raw = input as Record<string, unknown>;
  const allowed = ["approval_enabled", "approval_threshold", "tax_rate", "price_history_limit", "expected_updated_at"];
  for (const k of Object.keys(raw)) if (!allowed.includes(k)) throw new Error(`不支援的設定：${k}`);
  const expected = text(raw.expected_updated_at);
  if (!expected || Number.isNaN(Date.parse(expected))) throw new Error("缺少版本資訊（expected_updated_at），請重新載入畫面");
  const values: Partial<{ approval_enabled: boolean; approval_threshold: number; tax_rate: number; price_history_limit: number }> = {};
  if (hasKey(raw, "approval_enabled")) {
    if (typeof raw.approval_enabled !== "boolean") throw new Error("「啟用核准」必須是是或否");
    values.approval_enabled = raw.approval_enabled;
  }
  if (hasKey(raw, "approval_threshold")) {
    const n = num(raw.approval_threshold, "核准門檻", true);
    if (n > 99_999_999) throw new Error("核准門檻不可超過 99,999,999 元");
    values.approval_threshold = n;
  }
  if (hasKey(raw, "tax_rate")) {
    const n = num(raw.tax_rate, "稅率", true);
    if (n > 0.3) throw new Error("稅率必須在 0 到 0.3 之間（例如 0.05 代表 5%）");
    values.tax_rate = n;
  }
  if (hasKey(raw, "price_history_limit")) {
    const n = num(raw.price_history_limit, "歷史價筆數", false);
    if (!Number.isInteger(n) || n > 20) throw new Error("歷史價筆數必須是 1 到 20 的整數");
    values.price_history_limit = n;
  }
  if (Object.keys(values).length === 0) throw new Error("沒有要調整的設定");
  return { values, expected_updated_at: expected };
}

/** 清單篩選參數：伺服端白名單，頁面共用（每頁最多 100）。 */
export function normalizePage(page: unknown, pageSize: unknown): { page: number; pageSize: number } {
  const p = Math.trunc(Number(text(page)));
  const s = Math.trunc(Number(text(pageSize)));
  return { page: Number.isFinite(p) && p >= 1 ? p : 1, pageSize: Number.isFinite(s) && s >= 1 ? Math.min(s, 100) : 20 };
}
/** LIKE 搜尋跳脫（與資料庫 ga_po_like_escape 相同：反斜線、百分比、底線）。 */
export const likeEscape = (v: string): string => v.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
/** 逾期未到貨：已下訂或部分到貨，預計到貨日（台北日期）早於今天。 */
export function isPoOverdue(po: { status: string; expected_delivery_date?: string | null }, today: string = `${taipeiDay().slice(0, 4)}-${taipeiDay().slice(4, 6)}-${taipeiDay().slice(6, 8)}`): boolean {
  return (po.status === "ORDERED" || po.status === "PARTIALLY_RECEIVED") && !!po.expected_delivery_date && po.expected_delivery_date < today;
}
