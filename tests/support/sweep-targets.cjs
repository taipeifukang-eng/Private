'use strict';
/**
 * sweeper 的標記掃描目標。後續工作項（T01 之後）可在此追加。
 * action:
 *   delete  命中即刪除（僅限單次 fixture 才會使用的標記）
 *   report  只回報孤兒數，不刪除（長駐資料或需要連帶清 auth 的資料）
 * pattern 使用 SQL LIKE；runId 格式 T<yyyymmdd>-xxxx，員編為 ZT + runId，所以前綴為 ZTT。
 */
const MARKER_TARGETS = [
  { table: 'store_transfer_requests', column: 'employee_code', pattern: 'ZTT%', action: 'delete' },
  { table: 'profiles', column: 'employee_code', pattern: 'ZTT%', action: 'report' },
  // M0：關係會員 e2e 建立的申請資料（姓名帶 ZT + runId 前綴）。
  { table: 'relationship_members', column: 'member_name', pattern: 'ZTT%', action: 'delete' },
];

/** 保留月份 2099-xx：測試門市的列屬單次 fixture，會被自動清除；非測試門市的列一律不動並中止（2026-11-02 裁定）。*/
const RESERVED_MONTH_TABLES = [
  'monthly_store_summary',
  'monthly_staff_status',
  'support_staff_bonus',
  'talent_cultivation_bonus',
  'spring_festival_bonus',
  'meal_allowance_records',
];
const RESERVED_MONTH_PATTERN = '2099-%';

/**
 * 保留年份（W03）：績效資料的保留年度為 2038。
 *  - store_performance.year = 2038、monthly_prescription_reports / monthly_bonus_records 的 year_month 為 2038-xx：
 *    測試門市的列屬單次 fixture，sweeper 會清除；出現非測試門市的列則整體中止（與 2099 相同規則）。
 *  - 注意：「2038」本身仍是長駐基準年度，不得出現在 created.json 的 values（evaluateEntry 會拒絕）；
 *    清除一律走這裡的「保留年份」機制，不走登錄表。
 */
const RESERVED_PERFORMANCE_YEAR = 2038;
const RESERVED_YEAR_TABLES = [
  { table: 'store_performance', column: 'year', op: 'eq', value: RESERVED_PERFORMANCE_YEAR },
  { table: 'monthly_prescription_reports', column: 'year_month', op: 'like', value: `${RESERVED_PERFORMANCE_YEAR}-%` },
  { table: 'monthly_bonus_records', column: 'year_month', op: 'like', value: `${RESERVED_PERFORMANCE_YEAR}-%` },
];

/**
 * 測試門市專屬設定表：沒有年份欄位。測試門市（ZT/VW）的列一律視為測試殘留並清除（還原為系統預設閾值）；
 * 非測試門市的真實設定完全不碰，也不算 foreign。
 */
const TEST_STORE_SETTING_TABLES = [{ table: 'store_performance_thresholds' }];

/** 長駐基準資料：任何情況都不得被 sweeper 刪除。 */
const BASELINE_VALUES = ['VW001', 'VW002', 'ZT01', 'ZT02', 'ZT03', 'ZT04', 'ZT05'];

/** 測試門市代碼（stores.store_code）；等同長駐基準門市。 */
const TEST_STORE_CODES = BASELINE_VALUES.slice();

/**
 * created.json 登錄項目允許刪除的「表 → 欄位」白名單（D05/D15：只限單次 fixture）。
 * profiles、roles、role_permissions、user_roles 等永遠不在此列，不得由 service role 依登錄刪除。
 * registry.record 與 sweeper.evaluateEntry 共同檢查。
 */
const DELETABLE_TABLES = {
  store_transfer_requests: ['id', 'employee_code'],
  relationship_members: ['id'],
  monthly_store_summary: ['id'],
  monthly_staff_status: ['id'],
  support_staff_bonus: ['id'],
  talent_cultivation_bonus: ['id'],
  spring_festival_bonus: ['id'],
  meal_allowance_records: ['id'],
  // W03：績效（2038 年）。monthly_prescription_reports 沒有 id 欄，只由保留年份機制清除。
  store_performance: ['id'],
  store_performance_thresholds: ['id'],
  monthly_bonus_records: ['id'],
};

function isDeletableTarget(table, column) {
  return Object.prototype.hasOwnProperty.call(DELETABLE_TABLES, table) && DELETABLE_TABLES[table].includes(column);
}

module.exports = { RESERVED_PERFORMANCE_YEAR, RESERVED_YEAR_TABLES, TEST_STORE_SETTING_TABLES, DELETABLE_TABLES, isDeletableTarget, TEST_STORE_CODES, MARKER_TARGETS, RESERVED_MONTH_TABLES, RESERVED_MONTH_PATTERN, BASELINE_VALUES };
