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
  // CV01：活動查看權限測試。活動名稱 CVP-<runId>-KEY（子表 ON DELETE CASCADE）；帳號由 fixture 自行清除，這裡只回報孤兒。
  { table: 'campaigns', column: 'name', pattern: 'CVP-T%', action: 'delete' },
  { table: 'profiles', column: 'email', pattern: 'cvp-test-%', action: 'report' },
  // I01：巡店（新增巡店強制定位）測試資料。巡店備註帶 ZT + runId 標記（子表 ON DELETE CASCADE）。
  { table: 'inspection_masters', column: 'supervisor_notes', pattern: 'ZTT%', action: 'delete' },
  // M3（W07/W09/P03）：任務範本標題「[自動測試]M3 <runId> …」。assignments 沒有 cascade，所以 sweeper 先刪 logs、協作者、指派再刪範本（cascade: task-template）。
  { table: 'templates', column: 'title', pattern: '[自動測試]M3 T%', action: 'delete', cascade: 'task-template' },
  // M3：刪除任務與模板的稽核紀錄（測試範本標題同上）。
  { table: 'workspace_task_delete_audit', column: 'template_title', pattern: '[自動測試]M3 T%', action: 'delete' },
  // M5（W19/P05 活動排程、列表、特殊日期）：活動名稱與特殊日期說明帶「[自動測試]M5 <runId>」（子表 ON DELETE CASCADE）。帳號由 fixture 自行清除，這裡只回報孤兒。
  { table: 'campaigns', column: 'name', pattern: '[自動測試]M5 T%', action: 'delete' },
  { table: 'event_dates', column: 'description', pattern: '[自動測試]M5 T%', action: 'delete' },
  { table: 'profiles', column: 'email', pattern: 'm5p-test-%', action: 'report' },
  // M5 W21（組織與部門）：組織單位代碼 M5W21-<RUNID>-…（fixture 自行依標記清除；有成員與職掌參照，這裡只回報孤兒）。
  { table: 'organization_units', column: 'code', pattern: 'M5W21-T%', action: 'report' },
];

// M5 W23／W24（年度行事曆）：標題與假日來源名稱帶「[自動測試]M5W23 」。公司行事有異動紀錄（event_id restrict），sweeper 先刪紀錄再刪行事。
// 個人行程刪除時分享紀錄 cascade。測試站的 mock 假日預覽來源名稱固定帶此標記（lib/workspace/calendar-mock.ts 啟用時才會）。
// Google 同步連結只有保留年度 2099 的假日（holiday:2099-…）與連線列（mock 帳號）屬於測試；公司行事的連結由測試依事件 id 自行刪除。
// 員工主檔測試列（離職對象搜尋）員編 ZTTW23…。
const CALENDAR_MARKER = '[自動測試]M5W23 %';
MARKER_TARGETS.push(
  { table: 'organization_calendar_events', column: 'title', pattern: CALENDAR_MARKER, action: 'delete', cascade: 'calendar-event' },
  { table: 'organization_personal_calendar_events', column: 'title', pattern: CALENDAR_MARKER, action: 'delete' },
  { table: 'organization_calendar_holiday_imports', column: 'source_name', pattern: CALENDAR_MARKER, action: 'delete' },
  { table: 'organization_calendar_google_event_links', column: 'source_key', pattern: 'holiday:2099-%', action: 'delete' },
  { table: 'organization_calendar_google_connections', column: 'google_account_email', pattern: 'mock-google@example.test', action: 'delete' },
  { table: 'store_employees', column: 'employee_code', pattern: 'ZTTW23%', action: 'delete' },
);

// M7/M8 第 1 批（G01-G05 總務資產主檔）：總務資料名稱帶「[自動測試]M7M8 <runId>」、分類與架型代碼帶 M7M8T<runId> 前綴。
// 總務表有軟刪除與多個關聯表，一律只回報孤兒（測試的 teardown 依標記自行清除；殘留時由人確認後處理）。帳號 m7m8-test-* 由 fixture 自行清除。
const M7M8_MARKER = '[自動測試]M7M8 T%';
MARKER_TARGETS.push(
  { table: 'ga_parts', column: 'name', pattern: M7M8_MARKER, action: 'report' },
  { table: 'ga_equipment_templates', column: 'name', pattern: M7M8_MARKER, action: 'report' },
  { table: 'ga_facility_templates', column: 'name', pattern: M7M8_MARKER, action: 'report' },
  { table: 'ga_equipment', column: 'name', pattern: M7M8_MARKER, action: 'report' },
  { table: 'ga_facilities', column: 'name', pattern: M7M8_MARKER, action: 'report' },
  { table: 'ga_inventory_locations', column: 'name', pattern: M7M8_MARKER, action: 'report' },
  { table: 'ga_service_requests', column: 'title', pattern: M7M8_MARKER, action: 'report' },
  { table: 'ga_equipment_categories', column: 'code', pattern: 'M7M8T%', action: 'report' },
  { table: 'ga_facility_categories', column: 'code', pattern: 'M7M8T%', action: 'report' },
  { table: 'ga_part_categories', column: 'code', pattern: 'M7M8T%', action: 'report' },
  { table: 'profiles', column: 'email', pattern: 'm7m8-test-%', action: 'report' },
  // 第 2 批：轉移單、異動紀錄（資產名稱快照帶標記）、匯入批次（檔名帶標記）。異動紀錄不可被一般身分刪除，清除一律由 service role 的 fixture 處理。
  { table: 'maintenance_requests', column: 'title', pattern: M7M8_MARKER, action: 'report' },
  { table: 'ga_asset_transfers', column: 'asset_name', pattern: M7M8_MARKER, action: 'report' },
  { table: 'ga_asset_events', column: 'asset_name', pattern: M7M8_MARKER, action: 'report' },
  { table: 'ga_asset_import_batches', column: 'file_name', pattern: M7M8_MARKER, action: 'report' },
);

/** 保留月份 2099-xx：測試門市的列屬單次 fixture，會被自動清除；非測試門市的列一律不動並中止（2026-11-02 裁定）。*/
const RESERVED_MONTH_TABLES = [
  'monthly_store_summary',
  'monthly_staff_status',
  'support_staff_bonus',
  'talent_cultivation_bonus',
  'spring_festival_bonus',
  'meal_allowance_records',
  // P01：員工購物 POS 匯入（銷售月份 2099-xx，門市只用 ZT/VW）與藥師月份名冊快照。
  'employee_purchase_sales',
  'pharmacist_monthly_snapshot',
  // W06：需重新確認清單與近期因異動自動調整紀錄（保留月份 2099-xx、測試門市）。
  'monthly_staff_recheck',
  'monthly_staff_adjustment_log',
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
  // P01：員購匯入批次與藥師月份關帳沒有 store_id，只能依登錄的 id 清除；銷售明細與月份名冊另有保留月份機制後備。
  employee_purchase_sales: ['id'],
  employee_purchase_import_batches: ['id'],
  pharmacist_monthly_snapshot: ['id'],
  pharmacist_snapshot_locks: ['year_month'],
  // CV01：活動（子表 cascade）與門市任命 fixture，只依 registry 登錄的 id 清除。
  campaigns: ['id'],
  // I01：巡店主表（子表 cascade），只依 registry 登錄的 id 清除。
  inspection_masters: ['id'],
  store_managers: ['id'],
  // W05：員工主檔（測試員編範圍 FK8xxx／FKF8xxxx／FKPT9xx）與「需重新確認」清單，只依 registry 登錄的 id 清除。
  store_employees: ['id'],
  monthly_staff_recheck: ['id'],
  // W06：異動歷史、近期因異動自動調整紀錄（測試員編範圍 FK7xxx／FKF7xxxx／FKPT8xx），只依 registry 登錄的 id 清除。
  employee_movement_history: ['id'],
  monthly_staff_adjustment_log: ['id'],
};

function isDeletableTarget(table, column) {
  return Object.prototype.hasOwnProperty.call(DELETABLE_TABLES, table) && DELETABLE_TABLES[table].includes(column);
}

module.exports = { RESERVED_PERFORMANCE_YEAR, RESERVED_YEAR_TABLES, TEST_STORE_SETTING_TABLES, DELETABLE_TABLES, isDeletableTarget, TEST_STORE_CODES, MARKER_TARGETS, RESERVED_MONTH_TABLES, RESERVED_MONTH_PATTERN, BASELINE_VALUES };
