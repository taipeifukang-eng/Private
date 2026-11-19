// M7/M8 第 6 批 G22／G24：總務首頁「待我處理」九項、導覽徽章、績效與採購分析參數規則（純函式，無相依；Vue、API、單元測試共用）。
// 第 4.5 批新增「待請款採購單」「待付款請款單」兩項（需請款檢視／管理；與 ga_hm_counts 的 pay_unclaimed、pay_submitted 對齊），共十一項。
// 九項的計數與列表篩選共用資料庫述詞（ga_att_*、ga_ub_is_overdue、ga_vd_contract_due、ga_wo_focus 等，見 20261118120000_m7m8_b6_stats_home.sql）；
// 這裡的常數與 SQL 逐條對齊，單元測試會比對 SQL 檔內容。
import type { WorkTabKind } from "../page-kinds";

/** 九項待辦的鍵（與 ga_hm_counts 回傳的鍵相同）。 */
export const HOME_ITEM_KEYS = [
  "request_intake", "bill_overdue", "contract_due", "transfer_overdue", "store_wait", "po_pending", "po_overdue", "wo_store_rejected", "onboarding_review", "pay_unclaimed", "pay_submitted",
] as const;
export type HomeItemKey = (typeof HOME_ITEM_KEYS)[number];

/** 選單徽章的位置（ga_ws_home_badges 回傳的 menu 鍵）。 */
export const BADGE_MENUS = ["requests", "my_reports", "purchase_orders", "purchase_approvals", "work_orders", "vendors", "utility_bills", "transfers", "onboarding", "payment_requests"] as const;
export type BadgeMenu = (typeof BADGE_MENUS)[number];

export type HomeItemDef = {
  label: string;
  /** 顯示在哪個選單（徽章位置）。 */
  menu: BadgeMenu;
  /** 看得到的權限（任一，資料庫語意；store_wait 另需門市名單身分與查看權限，由資料庫判斷）。 */
  perms: readonly string[];
  /** 點進去開哪一頁與帶什麼篩選（頁面列表總筆數必須等於徽章數字）。 */
  kind: WorkTabKind;
  payload?: Record<string, unknown>;
};

const GA = "general_affairs.";
export const HOME_ITEMS: Record<HomeItemKey, HomeItemDef> = {
  request_intake: { label: "待受理需求單", menu: "requests", perms: [GA + "request.manage"], kind: "ga-requests", payload: { attention: "1" } },
  bill_overdue: { label: "逾期未繳帳單", menu: "utility_bills", perms: [GA + "utility_bill.view", GA + "utility_bill.manage"], kind: "ga-utility-bills", payload: { overdue: true } },
  contract_due: { label: "30 天內到期合約（含已過期）", menu: "vendors", perms: [GA + "vendor.view", GA + "vendor.manage"], kind: "ga-vendors", payload: { contract_due: true } },
  transfer_overdue: { label: "逾期未收調撥單", menu: "transfers", perms: [GA + "inventory_transfer.view", GA + "inventory_transfer.manage"], kind: "ga-inventory-transfers", payload: { overdue: true } },
  store_wait: { label: "待我的門市確認或補資料", menu: "my_reports", perms: [GA + "request.confirm_own_store", GA + "request.comment_own_store"], kind: "ga-my-reports", payload: { attention: "1" } },
  po_pending: { label: "待核准採購單", menu: "purchase_approvals", perms: [GA + "purchase_order.approve"], kind: "ga-purchase-approvals" },
  po_overdue: { label: "逾期未到貨採購單", menu: "purchase_orders", perms: [GA + "purchase_review.view", GA + "purchase_review.manage", GA + "purchase_order.approve"], kind: "ga-purchase-orders", payload: { overdue: true } },
  wo_store_rejected: { label: "門市退回的工單", menu: "work_orders", perms: [GA + "work_order.update", GA + "work_order.manage"], kind: "ga-work-orders", payload: { attention: "store_rejected" } },
  onboarding_review: { label: "貼標待複核", menu: "onboarding", perms: [GA + "equipment.manage", GA + "facility.manage"], kind: "ga-onboarding-review" },
  // 第 4.5 批：待請款採購單（驗入含稅額減有效請款累計大於尾差）與待付款請款單（SUBMITTED）；需請款檢視或管理（待請款另需能看採購單，由資料庫判斷）。
  pay_unclaimed: { label: "待請款採購單", menu: "purchase_orders", perms: [GA + "purchase_payment.view", GA + "purchase_payment.manage"], kind: "ga-purchase-orders", payload: { payUnclaimed: "1" } },
  pay_submitted: { label: "待付款請款單", menu: "payment_requests", perms: [GA + "purchase_payment.view", GA + "purchase_payment.manage"], kind: "ga-payment-requests", payload: { status: "SUBMITTED" } },
};

/** 每個選單鍵對應的頁面 kind（側欄項目以 kind 比對）。 */
export const BADGE_MENU_KIND: Record<BadgeMenu, WorkTabKind> = {
  requests: "ga-requests", my_reports: "ga-my-reports", purchase_orders: "ga-purchase-orders", purchase_approvals: "ga-purchase-approvals", work_orders: "ga-work-orders",
  vendors: "ga-vendors", utility_bills: "ga-utility-bills", transfers: "ga-inventory-transfers", onboarding: "ga-onboarding-review", payment_requests: "ga-payment-requests",
};
/** 選單點進去的篩選：採購單選單是待核准與逾期的聯集（依呼叫者有的權限各自成立）。 */
export const MENU_PAYLOAD: Partial<Record<BadgeMenu, Record<string, unknown>>> = {
  requests: { attention: "1" }, my_reports: { attention: "1" }, purchase_orders: { attention: "1" }, work_orders: { attention: "store_rejected" },
  vendors: { contract_due: true }, utility_bills: { overdue: true }, transfers: { overdue: true }, payment_requests: { status: "SUBMITTED" },
};

/** 待辦條件常數（與資料庫 ga_att_* 對齊）。 */
export const ATTENTION = {
  requestIntakeStatus: "PENDING_INTAKE",
  storeWaitStatuses: ["WAITING_STORE_CONFIRMATION", "WAITING_STORE_SUPPLEMENT"] as readonly string[],
  poPendingStatus: "PENDING_APPROVAL",
  poOverdueStatuses: ["ORDERED", "PARTIALLY_RECEIVED"] as readonly string[],
  /** 合約到期提醒天數（含已過期）。 */
  contractDueDays: 30,
  woFocus: "store_rejected",
  transferAwaitingStatuses: ["SOURCE_CONFIRMED", "IN_TRANSIT"] as readonly string[],
} as const;

/** 列表的 attention 參數：1 或 true 才算開啟。 */
export const attentionOn = (v: string | null | undefined) => v === "1" || v === "true";
/** 工單 attention 參數只接受 store_rejected。 */
export const workOrderAttention = (v: string | null | undefined): "store_rejected" | null => (v === "store_rejected" ? "store_rejected" : null);

/** 徽章顯示：0 不顯示、最多 99+。 */
export function capBadge(n: number | null | undefined): string {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0) return "";
  return v > 99 ? "99+" : String(v);
}

/** 首頁合計：各項加總（po_menu 是聯集，不重複加；待請款與待付款是第 4.5 批新增的兩項）。 */
export function homeTotal(items: Partial<Record<string, number>>): number {
  return HOME_ITEM_KEYS.reduce((sum, k) => sum + (Number(items[k]) || 0), 0);
}

// ---------------------------------------------------------------- 績效與採購分析參數
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export const isMonthText = (v: string) => MONTH.test(v);
export class StatsInputError extends Error {}
const bad = (m: string): never => { throw new StatsInputError(m); };

/** 績效區間：from、to 為 YYYY-MM；沒帶就由資料庫預設近 12 個月；最長 36 個月。 */
export function parsePerfRange(p: URLSearchParams): { from: string | null; to: string | null } {
  const from = (p.get("from") || "").trim();
  const to = (p.get("to") || "").trim();
  if (from && !isMonthText(from)) bad("起始月份格式錯誤（YYYY-MM）");
  if (to && !isMonthText(to)) bad("結束月份格式錯誤（YYYY-MM）");
  if (from && to) {
    if (from > to) bad("起始月份不能晚於結束月份");
    const months = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5)) - Number(from.slice(5));
    if (months > 35) bad("統計區間最長 36 個月");
  }
  return { from: from || null, to: to || null };
}

export function parseAnalysisMonth(p: URLSearchParams): string | null {
  const v = (p.get("yearMonth") || p.get("month") || "").trim();
  if (v && !isMonthText(v)) bad("月份格式錯誤（YYYY-MM）");
  return v || null;
}

/** 績效儲存格文字：沒有工單或沒有可算的樣本時顯示「資料累積中」，不顯示 0。 */
export function avgDaysText(row: { wo_count: number; avg_days: number | null }): string {
  if (!row.wo_count || row.avg_days === null || row.avg_days === undefined) return "資料累積中";
  return `${row.avg_days} 天`;
}

/**
 * 選單群組的徽章加總（審查 B3）：群組數字＝底下各項的數字相加，但「採購單」選單（待核准加逾期的聯集）
 * 與「待簽核採購單」選單（只有待核准）同在一個群組時，待核准會被算兩次，要扣掉一份，群組數字才不會大於實際待辦。
 * 只有核准人兩個入口都看得到時才會同時出現；沒有核准權限者「待簽核採購單」的數字是 0，不受影響。
 */
export function groupBadgeTotal(leaves: ReadonlyArray<{ kind?: string | null; count: number }>): number {
  let n = leaves.reduce((s, l) => s + Math.max(0, Number(l.count) || 0), 0);
  const orders = leaves.some((l) => l.kind === "ga-purchase-orders");
  if (orders) n -= leaves.filter((l) => l.kind === "ga-purchase-approvals").reduce((s, l) => s + Math.max(0, Number(l.count) || 0), 0);
  return Math.max(0, n);
}
