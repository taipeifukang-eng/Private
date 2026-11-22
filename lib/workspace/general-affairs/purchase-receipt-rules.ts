// 總務採購單到貨驗入與配發轉設備（M7/M8 第 4 批 G26）共用規則：純函式，無相依，單元測試直接引用，Next API 與 Vue 頁面共用同一份。
// 與資料庫函式（supabase/workspace-dev/20261112120000_m7m8_b4_receipt_dispatch.sql）的規則一致，改一邊要同步改另一邊。
// 涵蓋：剩餘可收量（以「已驗入量」計）、到貨明細驗證（超收、驗入不得大於到貨、破損或拒收須原因、改位置或改收替代料須變更原因）、
//      採購單到貨後的狀態、先進先出分配（配發跨進貨明細）、保固起算與到期日、單價換算每台購價、序號清單正規化與重複、型號決定（料件對應或手動並填原因）、
//      以及登錄到貨與配發的輸入驗證（與 Next API、資料庫共用同一套錯誤說明）。

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NUM4 = /^\d+(\.\d{1,4})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const text = (v: unknown) => String(v ?? "").trim();
const hasKey = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const r4 = (n: number) => Math.round((n + Number.EPSILON) * 1e4) / 1e4;

export const MAX_RECEIPT_LINES = 50;
export const MAX_DISPATCH_QTY = 200;
export const MAX_KEY_LENGTH = 64;
export const MAX_REASON = 200;

// ---------------------------------------------------------------- 數量（D12、D13）
/** 剩餘可收量：訂購量減「已驗入量」（破損、拒收的不算已收，供應商補送的可再收）。與資料庫相同，不為負。 */
export const remainingReceivable = (ordered: number, acceptedSoFar: number): number => Math.max(0, r4(ordered - acceptedSoFar));

export type ReceiptLineInput = { po_item_id: string; delivered_qty: number; accepted_qty: number; reason: string | null; location_id: string | null; received_part_id: string | null; change_reason: string | null };
export type ReceiptLineContext = { item_name: string; ordered_qty: number; received_qty: number; fulfil_mode: "STOCK" | "DIRECT_ASSET" | "NO_STOCK"; po_location_id: string | null; po_part_id: string | null };

/**
 * 單一品項到貨明細的規則檢查（回傳白話錯誤；沒有問題回 null）。順序與資料庫一致：
 * 1 超過剩餘可收量（D13 擋）→ 2 驗入量大於到貨量 → 3 原因（破損或拒收；分批到貨不用）→ 4 變更原因（改位置、改收替代料；只有入庫存的品項能改）。
 */
export function receiptLineProblem(line: ReceiptLineInput, ctx: ReceiptLineContext): { code: string; message: string } | null {
  if (!(line.delivered_qty > 0)) return { code: "INVALID_QUANTITY", message: `「${ctx.item_name}」的到貨量必須大於 0，最多 4 位小數` };
  if (line.accepted_qty < 0) return { code: "INVALID_QUANTITY", message: `「${ctx.item_name}」的驗入量必須是 0 以上的數字，最多 4 位小數` };
  if (line.accepted_qty > line.delivered_qty) return { code: "ACCEPTED_EXCEEDS_DELIVERED", message: `「${ctx.item_name}」的驗入量（${fmt(line.accepted_qty)}）不可大於到貨量（${fmt(line.delivered_qty)}）` };
  const remain = remainingReceivable(ctx.ordered_qty, ctx.received_qty);
  if (line.delivered_qty > remain + 1e-9) {
    return { code: "OVER_RECEIVE", message: `「${ctx.item_name}」的到貨量 ${fmt(line.delivered_qty)} 超過剩餘可收量 ${fmt(remain)}（訂購 ${fmt(ctx.ordered_qty)}、已驗入 ${fmt(ctx.received_qty)}）` };
  }
  if (ctx.fulfil_mode !== "STOCK" && (line.location_id || line.received_part_id)) {
    return { code: "LINE_INVALID", message: `「${ctx.item_name}」不入庫存，不能指定收貨位置或收到的料件` };
  }
  // 只有破損或拒收（驗入量小於到貨量）要原因；分批到貨（到貨量小於剩餘可收量）不用填（2026-11-16 驗收決定）。
  if (line.accepted_qty < line.delivered_qty && !line.reason) {
    return { code: "REASON_REQUIRED", message: `「${ctx.item_name}」有破損或拒收（驗入量小於到貨量），必須填寫原因` };
  }
  if (ctx.fulfil_mode === "STOCK") {
    const loc = line.location_id ?? ctx.po_location_id;
    if (loc !== ctx.po_location_id && !line.change_reason) return { code: "CHANGE_REASON_REQUIRED", message: `「${ctx.item_name}」改了收貨位置（與採購單不同），必須填寫變更原因` };
    const part = line.received_part_id ?? ctx.po_part_id;
    if (part !== ctx.po_part_id && !line.change_reason) return { code: "CHANGE_REASON_REQUIRED", message: `「${ctx.item_name}」改收了替代料件（與採購單不同），必須填寫變更原因` };
  }
  return null;
}

/** 到貨後的採購單狀態：全部品項驗入量都達訂購量 = RECEIVED；有任何驗入 = PARTIALLY_RECEIVED；都沒有驗入維持原狀態（例如整批拒收）。 */
export function statusAfterReceipt(current: string, items: { quantity: number; received_qty: number }[]): string {
  if (items.length > 0 && items.every((i) => i.received_qty >= i.quantity - 1e-9)) return "RECEIVED";
  if (items.some((i) => i.received_qty > 0)) return "PARTIALLY_RECEIVED";
  return current;
}

/** 品項數量（採購單位）換算基本單位的比例：quantity_base / quantity。 */
export const baseRatio = (quantity: number, quantityBase: number): number => (quantity > 0 ? quantityBase / quantity : 1);
/** 驗入量換算基本單位。 */
export const acceptedBase = (accepted: number, ratio: number): number => r4(accepted * ratio);
/** 直接建設備：驗入量換算基本單位後必須是整數（每台一筆）。 */
export const isWholeUnits = (base: number): boolean => Math.abs(base - Math.round(base)) < 1e-9;

// ---------------------------------------------------------------- 配發：先進先出（D15）
export type FifoCandidate = { id: string; received_date: string; created_at: string; available: number };
export type FifoAllocation = { id: string; received_date: string; quantity: number };
/** 依到貨日、登錄時間、id 由舊到新分配 n 台；回傳每個進貨明細分到幾台。可配發量不足回 null（整筆不配發）。 */
export function allocateFifo(candidates: FifoCandidate[], n: number): FifoAllocation[] | null {
  if (!Number.isInteger(n) || n < 1) return null;
  const sorted = candidates
    .filter((c) => c.available >= 1)
    .slice()
    .sort((a, b) => (a.received_date === b.received_date ? (a.created_at === b.created_at ? a.id.localeCompare(b.id) : a.created_at.localeCompare(b.created_at)) : a.received_date.localeCompare(b.received_date)));
  const out: FifoAllocation[] = [];
  let left = n;
  for (const c of sorted) {
    if (left <= 0) break;
    const take = Math.min(left, Math.floor(c.available + 1e-9));
    if (take <= 0) continue;
    out.push({ id: c.id, received_date: c.received_date, quantity: take });
    left -= take;
  }
  return left > 0 ? null : out;
}
export const dispatchableTotal = (candidates: { available: number }[]): number => r4(candidates.reduce((s, c) => s + Math.max(0, c.available), 0));

// ---------------------------------------------------------------- 保固與購價
/** 到期日 = 起算日加預設保固月數（月底日期取該月最後一天，與資料庫 interval 規則一致）；沒有月數（空或 0）就沒有保固。 */
export function warrantyEnd(startDate: string, months: number | null | undefined): string | null {
  if (!months || months <= 0) return null;
  if (!DATE.test(startDate)) throw new Error("保固起算日格式錯誤");
  const [y, m, d] = startDate.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const nd = Math.min(d, last);
  return `${String(ny).padStart(4, "0")}-${String(nm + 1).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}
export function warrantyFor(startDate: string, months: number | null | undefined): { has_warranty: boolean; warranty_start_date: string; warranty_end_date: string | null } {
  const end = warrantyEnd(startDate, months);
  return { has_warranty: end !== null, warranty_start_date: startDate, warranty_end_date: end };
}
/** 每台設備購價（未稅單價，換算成基本單位，取到分）：採購單位單價 ÷ 換算率。 */
export const unitPricePerBase = (unitPrice: number, ratio: number): number => Math.round((unitPrice / (ratio > 0 ? ratio : 1) + Number.EPSILON) * 100) / 100;

// ---------------------------------------------------------------- 序號與型號
/** 序號清單正規化：去頭尾空白、空字串與 null 視為「先不填」；最多 n 個。 */
export function normalizeSerials(input: unknown, n: number): (string | null)[] {
  if (input == null) return Array.from({ length: n }, () => null);
  if (!Array.isArray(input)) throw new Error("序號清單格式錯誤");
  if (input.length > n) throw new Error(`序號數量（${input.length}）不可超過配發數量（${n}）`);
  const out: (string | null)[] = Array.from({ length: n }, () => null);
  input.forEach((v, i) => {
    const s = v == null ? "" : text(v);
    if (s.length > 100) throw new Error("序號不可超過 100 字");
    out[i] = s || null;
  });
  return out;
}
/** 清單內（不分大小寫）重複的序號。 */
export function duplicateSerials(serials: (string | null)[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const s of serials) {
    if (!s) continue;
    const k = s.toUpperCase();
    if (seen.has(k)) dup.add(s);
    seen.add(k);
  }
  return Array.from(dup);
}
/** 型號決定：有手選就用手選（與料件對應不同、且料件有對應時要填原因）；沒手選就用料件對應；兩者都沒有要手選。 */
export function resolveTemplate(partMapped: string | null, chosen: string | null, reason: string | null): { template_id: string | null; error: { code: string; message: string } | null } {
  if (chosen) {
    if (partMapped && partMapped !== chosen && !reason) return { template_id: chosen, error: { code: "TEMPLATE_REASON_REQUIRED", message: "這個料件對應的設備型號與您選的不同，改型號必須填寫原因" } };
    return { template_id: chosen, error: null };
  }
  if (!partMapped) return { template_id: null, error: { code: "TEMPLATE_REQUIRED", message: "這個料件還沒有對應的設備型號，請選擇要建立的設備型號（也可先到料件頁設定對應）" } };
  return { template_id: partMapped, error: null };
}
/** 序號補填：已有序號且內容不同要填原因；相同內容不算變更。 */
export function serialChangeProblem(current: string | null, next: string, reason: string | null): { code: string; message: string } | null {
  const n = text(next);
  if (!n) return { code: "SERIAL_REQUIRED", message: "請輸入序號" };
  if (n.length > 100) return { code: "SERIAL_TOO_LONG", message: "序號不可超過 100 字" };
  if (current && current.trim().toUpperCase() !== n.toUpperCase() && !text(reason)) return { code: "REASON_REQUIRED", message: `這台設備已有序號（${current}），要修改必須填寫原因` };
  return null;
}
export const isSerialSame = (current: string | null, next: string): boolean => !!current && current.trim().toUpperCase() === text(next).toUpperCase();

// ---------------------------------------------------------------- 輸入驗證（登錄到貨、配發）
function uuidOrNull(v: unknown, label: string): string | null {
  const s = text(v);
  if (!s) return null;
  if (!UUID.test(s)) throw new Error(`${label}格式錯誤`);
  return s;
}
function qty(v: unknown, label: string, allowZero: boolean): number {
  const s = text(v).replace(/,/g, "");
  if (!NUM4.test(s)) throw new Error(`${label}必須是${allowZero ? "0 以上" : "大於 0"}的數字，最多 4 位小數`);
  const n = Number(s);
  if (!Number.isFinite(n) || (!allowZero && n <= 0) || n > 999_999_999) throw new Error(`${label}必須是${allowZero ? "0 以上" : "大於 0"}的數字，最多 4 位小數`);
  return n;
}
function reasonText(v: unknown, label: string): string | null {
  const s = text(v);
  if (s.length > MAX_REASON) throw new Error(`${label}不可超過 ${MAX_REASON} 字`);
  return s || null;
}
function validKey(v: unknown): string {
  const key = text(v);
  if (!key) throw new Error("缺少防重複識別碼，請重新整理畫面後再送出");
  if (key.length > MAX_KEY_LENGTH) throw new Error(`防重複識別碼過長（最多 ${MAX_KEY_LENGTH} 字）`);
  return key;
}
export const isValidDate = (s: string): boolean => DATE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

export type ReceiptPayload = { header: { received_date: string | null; delivery_note_no: string | null; notes: string | null }; lines: ReceiptLineInput[]; idempotency_key: string };
export function validateReceiptPayload(input: unknown, today?: string): ReceiptPayload {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("送出的內容格式錯誤");
  const raw = input as Record<string, unknown>;
  for (const k of Object.keys(raw)) if (!["header", "lines", "idempotency_key"].includes(k)) throw new Error(`不支援的欄位：${k}`);
  const key = validKey(raw.idempotency_key);
  const h = (raw.header ?? {}) as Record<string, unknown>;
  if (typeof h !== "object" || Array.isArray(h)) throw new Error("到貨資料格式錯誤");
  for (const k of Object.keys(h)) if (!["received_date", "delivery_note_no", "notes"].includes(k)) throw new Error(`不支援的欄位：header.${k}`);
  const date = text(h.received_date);
  if (date) {
    if (!isValidDate(date)) throw new Error("到貨日期不是有效的日期（YYYY-MM-DD）");
    if (today && date > today) throw new Error("到貨日期不可晚於今天");
  }
  const dn = text(h.delivery_note_no) || null;
  if (dn && dn.length > 60) throw new Error("送貨單號不可超過 60 字");
  const notes = text(h.notes) || null;
  if (notes && notes.length > 500) throw new Error("備註不可超過 500 字");
  if (!Array.isArray(raw.lines) || raw.lines.length === 0) throw new Error("請至少登錄一個品項的到貨");
  if (raw.lines.length > MAX_RECEIPT_LINES) throw new Error(`一次最多登錄 ${MAX_RECEIPT_LINES} 個品項`);
  const seen = new Set<string>();
  const lines = raw.lines.map((l, idx) => {
    const n = idx + 1;
    if (!l || typeof l !== "object" || Array.isArray(l)) throw new Error(`第 ${n} 列格式錯誤`);
    const r = l as Record<string, unknown>;
    for (const k of Object.keys(r)) if (!["po_item_id", "delivered_qty", "accepted_qty", "reason", "location_id", "received_part_id", "change_reason"].includes(k)) throw new Error(`第 ${n} 列不支援的欄位：${k}`);
    const itemId = uuidOrNull(r.po_item_id, `第 ${n} 列的品項`);
    if (!itemId) throw new Error(`第 ${n} 列缺少品項`);
    if (seen.has(itemId)) throw new Error("同一個品項在這次到貨中重複出現，請合併成一列");
    seen.add(itemId);
    const delivered = qty(r.delivered_qty, `第 ${n} 列的到貨量`, false);
    const accepted = hasKey(r, "accepted_qty") && text(r.accepted_qty) !== "" ? qty(r.accepted_qty, `第 ${n} 列的驗入量`, true) : delivered;
    if (accepted > delivered) throw new Error(`第 ${n} 列的驗入量（${fmt(accepted)}）不可大於到貨量（${fmt(delivered)}）`);
    return {
      po_item_id: itemId, delivered_qty: delivered, accepted_qty: accepted, reason: reasonText(r.reason, `第 ${n} 列的原因`), location_id: uuidOrNull(r.location_id, `第 ${n} 列的收貨位置`),
      received_part_id: uuidOrNull(r.received_part_id, `第 ${n} 列收到的料件`), change_reason: reasonText(r.change_reason, `第 ${n} 列的變更原因`),
    };
  });
  return { header: { received_date: date || null, delivery_note_no: dn, notes }, lines, idempotency_key: key };
}

/** 作廢進貨（第 4.5 批 P6）：原因必填（最多 200 字）、固定識別、版本（expected_updated_at）。 */
export type ReceiptVoidPayload = { reason: string; idempotency_key: string; expected_updated_at: string };
export function validateReceiptVoidPayload(input: unknown): ReceiptVoidPayload {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("送出的內容格式錯誤");
  const raw = input as Record<string, unknown>;
  for (const k of Object.keys(raw)) if (!["reason", "idempotency_key", "expected_updated_at"].includes(k)) throw new Error(`不支援的欄位：${k}`);
  const key = validKey(raw.idempotency_key);
  const reason = reasonText(raw.reason, "作廢原因");
  if (!reason) throw new Error("作廢進貨必須填寫原因");
  const expected = text(raw.expected_updated_at);
  if (!expected) throw new Error("缺少版本資訊（expected_updated_at），請重新載入畫面");
  if (Number.isNaN(Date.parse(expected))) throw new Error("版本資訊格式錯誤，請重新載入畫面");
  return { reason, idempotency_key: key, expected_updated_at: expected };
}

export type DispatchPayload = {
  po_item_id: string; store_id: string; quantity: number; equipment_template_id: string | null; template_change_reason: string | null;
  source_location_id: string | null; serials: (string | null)[]; notes: string | null; idempotency_key: string;
};
export function validateDispatchPayload(input: unknown): DispatchPayload {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("送出的內容格式錯誤");
  const raw = input as Record<string, unknown>;
  const allowed = ["po_item_id", "store_id", "quantity", "equipment_template_id", "template_change_reason", "source_location_id", "serials", "notes", "idempotency_key"];
  for (const k of Object.keys(raw)) if (!allowed.includes(k)) throw new Error(`不支援的欄位：${k}`);
  const key = validKey(raw.idempotency_key);
  const itemId = uuidOrNull(raw.po_item_id, "採購品項");
  if (!itemId) throw new Error("請指定採購品項");
  const storeId = uuidOrNull(raw.store_id, "門市");
  if (!storeId) throw new Error("請選擇配發的門市");
  const q = Number(text(raw.quantity));
  if (!Number.isInteger(q) || q < 1 || q > MAX_DISPATCH_QTY) throw new Error(`配發數量必須是 1 至 ${MAX_DISPATCH_QTY} 的整數（每台設備一筆）`);
  const notes = text(raw.notes) || null;
  if (notes && notes.length > 500) throw new Error("備註不可超過 500 字");
  return {
    po_item_id: itemId, store_id: storeId, quantity: q, equipment_template_id: uuidOrNull(raw.equipment_template_id, "設備型號"), template_change_reason: reasonText(raw.template_change_reason, "改型號原因"),
    source_location_id: uuidOrNull(raw.source_location_id, "來源位置"), serials: normalizeSerials(raw.serials, q), notes, idempotency_key: key,
  };
}
export function validateSerialPayload(input: unknown): { serial: string; reason: string | null } {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("送出的內容格式錯誤");
  const raw = input as Record<string, unknown>;
  for (const k of Object.keys(raw)) if (!["serial", "reason"].includes(k)) throw new Error(`不支援的欄位：${k}`);
  const serial = text(raw.serial);
  if (!serial) throw new Error("請輸入序號");
  if (serial.length > 100) throw new Error("序號不可超過 100 字");
  return { serial, reason: reasonText(raw.reason, "原因") };
}
/** 料件對應設備型號的欄位驗證（可清空）：空白 = 清空（null）；有值必須是 uuid。型號是否啟用由資料庫與 API 檢查。 */
export function normalizeEquipmentTemplateId(value: unknown): string | null {
  const s = text(value);
  if (!s) return null;
  if (!UUID.test(s)) throw new Error("設備型號 id 格式錯誤");
  return s;
}

function fmt(n: number): string {
  return String(r4(n));
}

// ---------------------------------------------------------------- 第 4.5 批 P6：作廢進貨的前端預判（資料庫 ga_ws_po_receipt_void 才是最終判斷；這裡只用來決定按鈕與提示）
export type ReceiptVoidFacts = { poStatus: string; voided: boolean; dispatchedQty?: number; directAssetAccepted?: boolean };
/** 回傳擋下原因（白話）；空字串代表前端沒看到阻擋條件（請款單、發票、庫存是否足夠由伺服端判斷）。 */
export function receiptVoidBlock(f: ReceiptVoidFacts): string {
  if (f.voided) return "這張進貨單已經作廢了";
  if (f.poStatus === "CLOSED") return "這張採購單已結案，不能作廢進貨；要更正請先請總務處理";
  if (f.poStatus === "CANCELED") return "這張採購單已取消，不能作廢進貨";
  if (!["ORDERED", "PARTIALLY_RECEIVED", "RECEIVED"].includes(f.poStatus)) return "這張採購單還沒有可作廢的進貨";
  if ((f.dispatchedQty ?? 0) > 0) return "這筆進貨已配發成設備，不能作廢，請走設備報廢";
  if (f.directAssetAccepted) return "這筆進貨在驗入時已直接建立設備，不能作廢，請走設備報廢";
  return "";
}
