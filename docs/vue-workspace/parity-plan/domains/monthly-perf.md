# 每月人員狀態、發放、匯出、業績獎金、處方箋、藥師、員購

> 2026-11-02 重跑盤點（第一次盤點回傳空白）。

## 領域共用缺口

- 導覽與 API 權限碼不一致：navigation.ts『資料匯出』用 monthly.status.export，但全部 /api/export-monthly-status/* 檢查 monthly.export.download；需統一並確認 DB 角色權限都有。
- monthly.status.add_employee、monthly.allowance.view_support_hours 在 .tmp-check/permissions-parity/apply.sql 舊快照中沒有，需確認 DB 實際已建立。
- 沒有 workspace 版跨門市匯出 API（app/api/workspace 下無 export-monthly-status 類資料夾），需新增包裝並共用檔案下載機制。
- 每月人員狀態缺少 workspace 版：門市彙總（getMonthlyStoreSummaries）、員工異動歷程、各門市業績明細（staff-performance-details）、刪除人員（deleteMonthlyStatusRecord）四個 API。
- 區塊判定（calculated_block）與新人升階規則在 legacy edit 頁，Vue 沒有共用函式，需抽到 lib 共用供 MonthlyEdit.vue 預覽與提醒使用。
- route-inventory.json 狀態欄過時：/admin/pharmacist-management、/admin/employee-purchases 與 /admin/export-monthly-status 都標『待逐項盤點』，實際前兩者已有 Vue 版；/monthly-release 也未登記狀態，需更新。
- Vue 工作台目前用 vue-workspace/src/main.ts 的空路由加 stores 開分頁，沒有獨立路由；各頁以 tab.kind 區分，新頁面需同步修改 stores.ts 與 App.vue 的分頁對照。
- Monthly.vue 用 tab.dirty／busy 鎖定查詢，新增總覽功能時需與此機制相容。

## /monthly-status

- 狀態：**partial**（L）— Vue 已原生化單店月份名冊、初始化／送審／確認／退回／取消確認、各式獎金津貼登記、統計與支援時數、業績與獎金明細、季彙總、匯入、Excel／PDF 匯出；但缺少多門市總覽（統計卡片、門市頁籤、自動跳下一間未確認）、員工異動歷程、展開各門市業績明細、刪除人員，以及送審前的檢查提示。
- 舊版：`app/monthly-status/page.tsx（4141 行，含 StoreStatusDetail、AddManualEmployeeModal、StoreMonthlyStatsForm、StoreSupportHoursForm、QuarterPerformanceDetail）＋ components/ImportPerformanceModal、ImportStoreStatsModal、MealAllowanceModal、SupportBonusModal、TransportExpenseModal、TalentCultivationModal、SpringFestivalBonusModal、SingleItemBonusPDF；server actions 在 app/store/actions.ts；API：/api/monthly-status/bonus-details、bonus-quarter-summary、/api/performance-data、/api/performance-thresholds、/api/staff-performance-details、/api/export-single-item-bonus-pdf`
- Vue：`vue-workspace/src/pages/Monthly.vue`、`vue-workspace/src/components/MonthlyTools.vue`、`vue-workspace/src/components/MonthlyQuarter.vue`、`vue-workspace/src/components/ActivityPlan.vue`
- 權限：monthly.status.view_own、monthly.status.view_all、monthly.status.edit、monthly.status.submit、monthly.status.confirm、monthly.status.revert、monthly.status.unconfirm、monthly.status.view_stats、monthly.status.view_performance、monthly.status.bonus_detail.view、monthly.status.add_employee、monthly.allowance.edit_support_bonus、monthly.allowance.edit_support_hours、monthly.allowance.view_support_hours、monthly.import.performance、monthly.import.store_stats、monthly.export.download、activity.management.access
- 相依：Vue 工作台共用元件 Modal、TopScrollTable、lib/workspace/modules.ts（moduleStores、requireStore）、MonthlyEdit.vue（人員編輯）、員工異動歷程 API（與人員異動領域共用）

**舊版功能**

- 年份／月份選擇器與 URL 參數 year_month（Vue 改為 month 輸入）
- 統計卡片：總門市數／已確認／已提交／待填寫（僅 canViewStats）
- 門市頁籤切換器，每間顯示狀態；單一門市時直接顯示詳情（店長視圖）
- 顯示已停止門市歷史的切換
- 確認後自動跳到下一間未確認門市（loadStoreSummaries moveToNext）
- 匯入業績資料（ImportPerformanceModal）與匯入門市統計（ImportStoreStatsModal），需 canViewStats
- 初始化本月資料（無資料時的空狀態按鈕）
- 人員清單表格：員工、職位、雇用類型、到職日、本月狀態、天數／時數、特殊標記（雙職務、店長加成、督導卡班、代理店長、藥師、手動新增、外務）、上月單品獎金、計算區塊、交易次數、銷售金額、毛利、毛利率、審核狀態
- 點員工姓名開啟異動歷程視窗（loadMovementHistory）
- 展開列：各門市業績明細（含處方加購回補標示）
- 每列編輯（跳 edit/[id]）與刪除（手動新增員工或移除，handleDeleteManual／deleteMonthlyStatusRecord）
- 手動新增員工 Modal（可搜尋既有員工、外務選項、自動算時數）
- 上個月單品獎金、交通費用、誤餐費登記、育才獎金、春節出勤獎金 各自 Modal
- 門市每月統計表單與門市支援時數表單（內嵌，含人力點值等推算）
- 每月人員各式獎金明細視窗（姓名篩選、動態欄位、查看 Qn 獎金總額）
- 該月業績狀況與該季業績狀況視窗（用 bonus-calc 與閾值）
- 匯出 Excel（exportMonthlyStatusForBonus，需已確認）與匯出當月獎金／津貼 PDF（single-item-bonus-pdf）
- 送出審核：兼職缺時數提醒、確認對話框、新人階段檢查（needNewbieCheck）二次確認
- 確認、退回草稿、取消確認，各自 confirm 對話框與權限
- 活動檢視入口（canAccessActivityManagement）

**缺少或不同**

- 缺少多門市總覽：無統計卡片、無門市狀態頁籤，只能下拉選門市（Monthly.vue 僅有 store select；API app/api/workspace/monthly/route.ts GET 不呼叫 getMonthlyStoreSummaries）
- 缺少已停止門市歷史切換（Monthly.vue 無此選項；moduleStores 是否含停用門市未確認）
- 缺少確認後自動跳到下一間未確認門市
- 缺少員工異動歷程視窗（Vue 全域搜尋無 movement history 呼叫）
- 缺少展開列的各門市業績明細（Monthly.vue 只顯示彙總欄位，沒有呼叫 staff-performance-details）
- 缺少刪除／移除人員（workspace/monthly/route.ts 只有 initialize、submit、confirm、revert、unconfirm、save，沒有 delete）
- 送出審核缺少兼職時數缺漏提醒與新人階段二次確認流程（Monthly.vue 只開通用確認視窗；API 回傳 needNewbieCheck 時只當錯誤字串）
- 列表缺少『手動新增』、『外務』、『督導卡班』細節標籤與新人等級顯示（Monthly.vue 特殊標記欄位僅藥師／店長加成／雙職／督導卡班）
- 匯出 Excel 為 workspace 專屬實作（monthly/tools op=excel），是否與 exportMonthlyStatusForBonus 欄位完全一致未逐欄比對
- PDF 匯出由前端 vue-workspace/src 內處理，是否與 components/SingleItemBonusPDF.tsx 版面一致需實測

**業務規則**

- 送審或確認後整月鎖定，不可再編輯各式津貼（lib/workspace/monthly-tools.ts editableMonth 回 409）
- 非管理員需為 store_managers 指派人員才可編輯該門市（workspace/monthly/route.ts POST）
- 確認／退回／取消確認需對應高階權限，與 edit／submit 分開判斷
- 育才與春節獎金金額須為整數；春節分類限藥師／主管／專員；誤餐時段限中餐／晚餐／晚晚餐，身分限藥師／非藥師；交通費大於 0 必須填原因
- 匯出 Excel 需狀態已確認（legacy 提示『需要已確認的狀態』）
- 人力點值＝門市人數＋行政×0.5＋新人×0.3（MonthlyTools.vue derived）
- 員工列依代理店長優先及職位排序顯示（Monthly.vue positionOrder）

**API**：舊 /api/monthly-status/bonus-details、/api/monthly-status/bonus-quarter-summary、/api/performance-data、/api/performance-thresholds、/api/staff-performance-details、/api/export-single-item-bonus-pdf、/api/import-performance、/api/import-store-stats、app/store/actions.ts 的 getMonthlyStaffStatus、getMonthlyStoreSummaries、initializeMonthlyStatus、submitStoreStatus、confirmStoreStatus、revertSubmitStatus、unconfirmStoreStatus、deleteMonthlyStatusRecord、exportMonthlyStatusForBonus；新 app/api/workspace/monthly/route.ts、app/api/workspace/monthly/tools/route.ts、lib/workspace/monthly-tools.ts、lib/workspace/monthly-quarter.ts、supabase/workspace-dev/20261029180000_vue_monthly_tools.sql

**資料表**：monthly_staff_status、monthly_store_summary、monthly_performance_details、support_staff_bonus、talent_cultivation_bonus、spring_festival_bonus、meal_allowance_records、store_managers、store_employees、employee_movement_history、stores、profiles

**既有測試**：scripts/test-workspace-monthly-activity.py、scripts/test-workspace-monthly-excel.cjs、scripts/test-workspace-monthly-fixtures.cjs、scripts/test-workspace-monthly-quarter-ui.py、scripts/test-workspace-monthly-review-ui.py、scripts/test-workspace-monthly-tools.py、scripts/test-monthly-quarter.cjs、scripts/test-monthly-registration-permissions.cjs、scripts/test-monthly-support-bonus-rbac.js、scripts/test-monthly-status-resignation-carry-forward.js、scripts/test-monthly-status-actual-staff-points-export.js

**待確認**

- legacy 頁面層級的角色判斷（needsAssignment、營業部經理主管）在 Vue 以 moduleStores 取代，範圍是否完全一致未驗證
- monthly.status.add_employee、monthly.allowance.view_support_hours 兩個權限碼在 .tmp-check/permissions-parity/apply.sql 舊快照中找不到，需確認 DB 實際已有
- legacy 提供的 exportMonthlyStatusForBonus Excel 與 Vue 版輸出欄位是否一致，沒有逐欄比對

### 測試案例

**冒煙**

- 以 R3 登入 Vue 工作台，開啟『每月人員狀態』分頁，選 2026-10 與 S1：名冊表格要載入且不能顯示錯誤提示，列數須等於 DEV 中 monthly_staff_status (S1, 2026-10) 的筆數
- GET /api/workspace/monthly?month=2026-10&store=S1 應回 200，capabilities 包含 canSubmit=true、canConfirm=false
- GET /api/workspace/monthly/tools?op=meta 應回 200；以 R3 呼叫時 stats 不可含 total_gross_profit 等 view_stats 欄位（R3 沒有 view_stats 時）
- 以 R2 開啟 S3（已確認），『匯出 Excel』與『PDF』兩個按鈕都可點，且能下載出非空檔案
- 開啟業績狀況、季業績狀況、各式獎金明細三個視窗，都不能出現 console error

**單元**

- lib/workspace/monthly-tools.ts validateAllowance：每種 kind 各寫一組 table-driven 測試。必測案例：spring 金額 1500.5 → 400『金額須為整數』；spring category='店長' → 『出勤分類不正確』；spring 日期 2026-11-01（月份為 2026-10）→ 『日期須在目前月份』；spring 日期 2026-02-30 → 擋下；meal 時段 '9:00-18:00' → 格式錯誤；meal record_date '10/32' → 擋下；meal 時段 '宵夜' → 擋下；transport 金額 100 且原因為空字串 → 『交通費須填寫原因』；transport 金額 0 且原因為空 → 通過；employee_code 'ab12' 輸出為 'AB12'；同一員工同日同時段的 meal 重複 → 『員工或出勤項目重複』；1501 列 → 『資料筆數不正確』；金額 -1 或 10000001 → 擋下
- lib/workspace/monthly-tools.ts toolFor：'support'、'transport'、'talent'、'spring'、'meal' 回傳正確的 table 與 permission；'__proto__'、'toString'、'' 一律丟 400
- lib/workspace/monthly-tools.ts editableMonth：用 stub ctx.admin 測四種組合：summary 為 draft 且無鎖定列 → 通過；summary 為 submitted → 409；summary 為 null 但有一列 confirmed → 409；summary 為 confirmed → 409
- lib/workspace/monthly-quarter.ts monthlyQuarterSummary：對 2026-10（Q4）餵入 3 個月的 records，驗證月合計、季應得、季回補＝max(0, 季應得−月合計)，以及閾值使用自訂值或預設 MONTHLY_THRESHOLDS 的結果；沿用並擴充 scripts/test-monthly-quarter.cjs
- Monthly.vue 的排序規則（建議抽成 vue-workspace/src/lib/monthly-sort.ts 再測）：is_acting_manager=true 的列要排在最前面，其餘依 positionOrder 排序；不在表中的職位要排在最後；『新人』與『行政』同為 19，排序須穩定
- MonthlyTools.vue 的 derived 人力點值（建議抽成純函式）：門市人數 10、行政 2、新人 3 → 10＋1＋0.9＝11.9；所有欄位為 null 時須顯示 '-' 而非 NaN
- workspace monthly route 的 save 驗證（建議抽成 validateMonthlySave(updates)）：work_days 31.5、32、-1 → 400；work_hours 745 → 400；null 允許；notes 長度 4001 → 400；行政未給 ADMIN_LEVEL → 400；start_date '2026-13-01' → 400；身分旗標傳字串 'true' → 400

**整合**

- 權限矩陣，POST /api/workspace/monthly 對 S1（draft）：save 只有 R1、R3 回 200，R4 回 403『只有指派人員可編輯此門市』，R5、R6 回 403；submit 只有 R1、R3 回 200；confirm、revert、unconfirm 只有 R1、R2 成功，R3 回 403。另外要驗證 R2 即使沒有 store_managers 指派也能 confirm（符合程式設計），並把這個行為記錄到報告
- 權限矩陣，GET op=excel 與 POST op=pdf：只有擁有 monthly.export.download 的 R1、R2、R5 成功，R3、R6 回 403；R4 讀 S1 時由 requireStore 擋下（記錄實際狀態碼）
- 權限矩陣，multipart 匯入：kind=performance 需同時有 monthly.import.performance 與 monthly.status.view_all。R2 成功；只有 import 權限、沒有 view_all 的帳號回 403；上傳 .csv 或 0 byte 或 21MB 檔案 → 400『請選擇 20MB 以內的 Excel 檔案』；kind=other → 400
- op=allowance 鎖定：S2（submitted）POST allowance → 409『此月份已送審或確認』；S1 先 submit 再 allowance → 409；revert 回草稿後再 allowance → 200
- 並行寫入，allowance：A、B 兩個 session 同時讀 expected，A 存檔成功後，B 用舊 expected 存檔 → 409『資料已由其他頁面更新』，DB 只能留下 A 的內容
- 並行寫入，stats：兩個 session 帶同一個 version，第二個要回 409；business_days=31 在 2026-11 → 400，在 2026-10 → 200
- 並行寫入，save 樂觀鎖：同一列兩個 session，第二個帶舊 updated_at → 409。在 submit 前 save 一筆，submit 後再 save → 409『此筆已送出或已變更』
- 冪等，op=manual：用同一個 requestId 送兩次，DB 只能多一筆；改用新的 requestId 但員編相同 → 409『此員工已在本月名冊』；行政未給階段 → 400；缺 requestId → 400
- op=employees 搜尋：q 帶 '%_,().' 時須去除字元而不能報錯；回傳最多 30 筆；回傳欄位只能有 employee_code、employee_name、position、is_pharmacist（不得外洩人事主檔欄位）
- 狀態流轉：S1 依序 draft→submit→confirm→unconfirm→revert，每一步都查 DB monthly_store_summary.store_status 與各列 status 是否與 legacy action（submitStoreStatus／confirmStoreStatus／unconfirmStoreStatus／revertSubmitStatus）在同一份資料上的結果一致
- 錯誤路徑：month='2026-13'、store 不屬於可見門市、op 不支援 → 400、403、400，且回應不可包含 stack trace
- 缺口確認（目前預期失敗，記錄為已知缺口）：workspace 沒有 delete action、沒有 store summaries、沒有 movement history、沒有 staff-performance-details。測試直接 POST action=delete 應回 400 或 403，確認不會誤刪資料

**E2E**

- 店長完整流程（R3、S1）：開啟分頁 → 手動新增外務員工 → 依序登記交通費（填原因）、誤餐費、育才獎金、春節獎金 → 填門市統計與支援時數 → 送出審核 → 確認對話框 → 狀態變為已送審 → 各登記按鈕變為停用或回 409 提示
- 主管流程（R2、S1 已送審）：開啟 → 確認 → 狀態變為已確認 → 匯出 Excel（檢查下載檔）→ 匯出 PDF（檢查下載檔）→ 取消確認 → 退回草稿 → R3 重新整理後又可以編輯
- 表單草稿保護：在誤餐 Modal 輸入資料但未存檔，切換門市時 tab.dirty 須跳出提醒，查詢要被鎖住
- 匯入流程（R2）：上傳 make-workspace-performance-test-files.cjs 產生的業績檔與門市統計檔 → 名冊的交易次數、銷售金額、毛利須更新
- 閱覽權限（R5）：可以看獎金明細與下載匯出檔，但所有編輯按鈕都要隱藏；用 DevTools 直接呼叫 save 須回 403
- 舊版功能缺口驗收清單（實作後才開啟）：多門市總覽卡片、門市頁籤、確認後自動跳下一間未確認門市、異動歷程視窗、展開列業績明細、刪除手動新增人員、兼職缺時數提醒、needNewbieCheck 二次確認

**對等驗證**

- 名冊對等：同一份 DEV fixture、同一角色（R2）、2026-10、S1。legacy 用 getMonthlyStaffStatus(yearMonth, storeId) 的結果，Vue 用 GET /api/workspace/monthly 的 records，以 employee_code 為鍵逐欄比對 position、employment_type、monthly_status、work_days、work_hours、calculated_block、is_* 旗標、transaction_count、sales_amount、gross_profit、gross_margin_rate、status，差異輸出到 .tmp-check/parity/monthly/roster-diff.json
- 單店 Excel 逐欄比對：在 S3（confirmed）上，legacy 用 exportMonthlyStatusForBonus(m, S3) 產生 CSV，Vue 用 op=excel 產生 xlsx，兩者都以 xlsx／csv 解析成陣列。比對表頭集合與順序（Object.keys 順序）、列數、每格的值。正規化規則：legacy 的 '' 對應 Vue 的 0、false、null，必須在報告中逐格列出。S2（submitted）時 legacy 應無資料而 Vue 有資料，此差異要明確列在報告中請使用者裁示
- PDF 對等：在同一份資料上分別從 legacy /api/export-single-item-bonus-pdf 與 workspace op=pdf 取得 JSON（staff、store_code、store_name、visible_columns），兩者須深度相等；再以 pdf 解析文字，比對每位員工的各獎金金額與合計
- 獎金明細對等：legacy /api/monthly-status/bonus-details 與 workspace op=bonuses 對同一門市、同一月份回應的 JSON 須深度相等（workspace 只是包裝）；quarterBonuses 也照同樣方式比對 bonus-quarter-summary
- 業績與季業績對等：legacy 頁面以 bonus-calc 計算的月獎金、季應得、回補，與 Vue op=performance／quarterPerformance 的數值逐月比對，容許誤差為 0 元
- 津貼寫入對等：分別用 legacy Modal（SupportBonusModal 等）與 Vue 寫入同一組資料到兩間對照門市，再比對 support_staff_bonus、talent_cultivation_bonus、spring_festival_bonus、meal_allowance_records 各列欄位（排除 id、時間戳、actor）

**測試資料**

- DEV 門市 S1（draft）、S2（submitted）、S3（confirmed）、S4（停用門市，含歷史 monthly 資料），月份 2026-10，另放一份 2026-09 供上月單品獎金使用
- 每間門市的員工組合：正職專員、兼職（work_hours 缺漏）、新人（到職 2026-09-05 / 2026-08-05 / 2026-04-05）、行政（過階）、督導(代理店長) 雙職、藥師、手動新增外務、代理店長
- store_managers：R3 對應 S1、R4 對應 S2
- monthly_store_summary 統計值：門市人數 10、行政 2、新人 3、business_days 31、毛利等，用來驗證人力點值與閾值
- store_performance_thresholds：S1 使用自訂閾值，S3 使用預設閾值
- 匯入測試檔：scripts/make-workspace-performance-test-files.cjs 產生的業績檔與門市統計檔，另備 0 byte、.csv、21MB 檔案
- 角色帳號 R1–R6（見 domainNotes）

**風險**

- Excel 匯出的資料範圍（含 submitted）與檔案格式（CSV 改為 XLSX）都和 legacy 不同，會計流程可能依賴 CSV
- confirm、revert、unconfirm 不檢查門市指派；只要有高階權限就能對任何可見門市操作，需確認這是預期行為
- 刪除人員缺少 workspace API，手動新增錯誤時 Vue 使用者無法自行修正
- monthly.status.add_employee、monthly.allowance.view_support_hours 兩個權限碼是否已存在於 DEV 與正式 DB 尚未確認

## /monthly-status/edit/[id]

- 狀態：**partial**（M）— Vue 已可編輯職位、任職類型、本月狀態、到職日、階段、未滿月原因、天數時數、支援督導、外務、備註與五個身分旗標並做樂觀鎖；缺少計算區塊預覽、新人升階提醒、時數自動換算，及已確認時的專屬提示。
- 舊版：`app/monthly-status/edit/[id]/page.tsx（954 行）`
- Vue：`vue-workspace/src/pages/MonthlyEdit.vue`
- 權限：monthly.status.edit、monthly.status.view_own、monthly.status.view_all
- 相依：/monthly-status（Monthly.vue 開啟）、lib/monthly-staff 的區塊判定邏輯需抽到共用

**舊版功能**

- 唯讀基本資訊：姓名、員工代號、手動新增標記
- 雇用類型（正職／兼職）、是否藥師、到職日期可改
- 職位下拉（含特殊角色）
- 新人等級（一階／二階／無已過階）僅新人或本月新進顯示
- 行政階級（過階／未過階），行政必填
- 本月狀態下拉
- 非整月在職：原因與說明
- 依職位切換天數或時數輸入；督導(代理店長)-雙 用時數，基準 160 小時
- 特殊標記：雙職務、店長加成、督導卡班、擔任代理店長
- 督導卡班資訊：員編、姓名、職位、時數
- 額外任務：長照外務、診所業務，自動計算規劃時數與外務時數
- 備註
- 系統自動計算區塊預覽（BONUS_BLOCK_DESCRIPTIONS）
- 儲存前新人升階檢查（滿 1、2 個月提示改一階／二階；滿 6 個月提示改專員）
- 已確認的資料顯示『此資料已確認，無法修改』並可返回

**缺少或不同**

- 缺少計算區塊預覽（MonthlyEdit.vue 無 previewBlock 與 BONUS_BLOCK_DESCRIPTIONS）
- 缺少新人升階提醒（legacy edit 頁 252–294 行邏輯在 Vue 與 workspace API 皆無）
- 缺少預設工作時數／規劃時數自動計算與提示（API 端有計算 extra_task_planned_hours，但前端沒有即時預覽）
- Vue 無『此資料已確認』專屬頁面，僅顯示一行唯讀提示，表單仍呈現
- 行政階段驗證在 API 做（職位為行政需行政階段），前端沒有即時必填標示
- legacy 可編輯是否藥師與到職日；Vue 到職日可編、藥師為勾選，待比對其他欄位權限

**業務規則**

- 只有 draft 狀態可儲存；已送出或已變更回 409（workspace/monthly/route.ts）
- 工作天數 0–31、工作時數 0–744
- 督導＋代理店長＋雙職務使用時數、其餘正職使用天數、兼職使用時數
- 督導卡班關閉時清空支援督導欄位
- 外務規劃時數：雙職務取工作時數；正職整月 160，否則 工作天數/5×32；兼職為空
- updated_at 作為樂觀鎖，衝突回 409

**API**：舊 app/store/actions.ts getMonthlyStaffStatusById、updateMonthlyStaffStatus；新 app/api/workspace/monthly/route.ts POST action=save

**資料表**：monthly_staff_status

**既有測試**：scripts/test-workspace-monthly-review-ui.py、scripts/test-promotion-monthly-position-sync.js

**待確認**

- legacy 新人升階提醒是否仍為現行業務要求需與使用者確認
- 區塊判定函式所在檔案未逐一追蹤

### 測試案例

**冒煙**

- 從 Monthly.vue 點 S1 某員工的『編輯』，MonthlyEdit 分頁要開啟並帶入 position、employment_type、monthly_status、start_date、newbie_level、work_days／work_hours、五個旗標、notes
- 對 S3（confirmed）開啟編輯：要顯示唯讀提示，『儲存』按鈕須停用

**單元**

- 新人升階提醒：從 app/monthly-status/edit/[id]/page.tsx 252–294 行抽出 newbiePromotionPrompt(startDate, yearMonth, position, monthlyStatus, newbieLevel) 到 lib/monthly-staff/newbie.ts。案例（yearMonth=2026-10）：到職 2026-09-15 且 level≠一階 → 提示改一階；到職 2026-08-01 且 level≠二階 → 提示改二階；到職 2026-04-01 且 position=新人 → 提示改專員；到職 2026-10-01 → 不提示；position=專員 → 不提示；跨年（到職 2025-12-01、月份 2026-01）→ monthsDiff=1
- 區塊預覽：從 edit 頁約 185–220 行的 setPreviewBlock 邏輯抽出 previewBonusBlock(form) 到 lib/monthly-staff/block.ts，以 table-driven 測試涵蓋區塊 1–6 的條件（雙職、督導卡班、兼職、work_days=0→3、外務→4、店長加成）
- 外務規劃時數 plannedExtraTaskHours(employment_type, is_dual_position, monthly_status, work_days, work_hours)：雙職 → 回傳 work_hours；正職整月 → 160；正職 work_days=10 → 10/5×32=64；兼職 → null。須與 workspace/monthly/route.ts 中計算 extra_task_planned_hours 的結果一致
- 輸入模式 inputMode(position, employment_type)：督導、代理店長、雙職務 → hours（督導(代理店長)-雙 基準 160）；其他正職 → days；兼職 → hours
- 督導卡班關閉時要清空 supervisor_employee_code、name、position、shift_hours（前端 reducer 與 API 都要測）

**整合**

- POST action=save 權限矩陣：R1、R3（S1）回 200；R4 改 S1 回 403；R2（無 edit）回 403；R5、R6 回 403
- save 驗證錯誤路徑：position 不在 POSITION_OPTIONS、employment_type='contract'、monthly_status 非法、newbie_level 非法、行政缺階段、partial_month_reason 非法、start_date='2026-02-30'（Date.parse 會通過，需記錄實際行為）、旗標非 boolean、supervisor_name 超過 1000 字、supervisor_shift_hours 為 745 → 每個都回 400 且 DB 不可變動
- 樂觀鎖：A、B 讀同一列，A 存檔後 B 用舊 updated_at 存檔 → 409；A 存檔後 S1 被 submit，A 再存檔 → 409
- 存檔後 DB trigger 重算的 calculated_block 必須等於 unit 測試中 previewBonusBlock 的結果（同一組輸入跑 20 組）
- id 屬於 S2 但 store 參數帶 S1 → 查無資料，回 409（不可跨店改資料）

**E2E**

- R3 編輯新人：把階段改為一階新人並改 work_days，存檔後回到 Monthly 列表，數值與區塊標籤都已更新
- 把職位改為行政但不選階段，存檔要看到錯誤訊息，表單保持原值
- 開啟督導卡班並填寫支援督導資訊後存檔；接著關閉卡班再存檔，DB 中支援欄位要被清空
- 兩個分頁同時編輯同一人：第二個分頁存檔要出現衝突提示，並保留草稿
- （缺口驗收）實作後再測區塊預覽即時變化，以及新人升階 confirm 對話框

**對等驗證**

- 同一列分別用 legacy updateStaffStatus 與 Vue save 寫入相同的輸入（兩間對照門市或先還原），比對 monthly_staff_status 寫入後的所有欄位（排除 updated_at、updated_by），重點是 calculated_block、extra_task_planned_hours、extra_task_external_hours、supervisor_* 清空行為
- 新人提醒的觸發條件：對 fixture 中三名新人分別記錄 legacy 頁是否跳出 confirm 及其訊息，與 Vue（實作後）逐案比對

**測試資料**

- S1 draft：新人三名（到職 1、2、6 個月前）、行政一名、督導(代理店長)雙職一名、兼職一名、外務一名
- S3 confirmed 任一列（用於唯讀測試）
- R1–R6 角色帳號

**風險**

- Vue 沒有新人升階提醒，可能導致新人階段漏改而影響獎金區塊
- 沒有前端區塊預覽，使用者無法在存檔前發現區塊判定錯誤
- start_date 只以 regex 加 Date.parse 驗證，2026-02-30 可能被接受（uncertain）

## /monthly-release

- 狀態：**missing**（S）— 沒有任何 Vue 頁面、路由或 workspace API 對應；此頁是靜態『每月版更內容』（目前僅 2026年3月一期），不是獎金發放功能。
- 舊版：`app/monthly-release/page.tsx（196 行，靜態版更公告，無資料庫、無權限）；入口為 app/page.tsx 第 915 行連結`
- Vue：（無）
- 權限：無（登入即可，頁面未做權限檢查）
- 相依：工作總覽首頁連結決策（app/page.tsx 第 915 行）

**舊版功能**

- 月份清單卡片（共 N 期，最新標記）
- 可摺疊的版更公告，最新一期預設展開
- 公告含重點更新、對使用者影響、提醒事項三段
- 返回首頁連結

**缺少或不同**

- Vue 沒有版更頁（vue-workspace/src/pages 無 MonthlyRelease，navigation.ts 無此項目）
- 內容是寫死在 page.tsx 的 monthlyReleases 陣列，需決定搬到 Vue 頁或工作總覽區塊

**業務規則**

- 內容為靜態資料，新增月份只需追加陣列

**API**：舊 —；新 —

**資料表**：—

**既有測試**：—

**待確認**

- 內容為舊系統 2026 年 3 月的更新說明，Vue 工作台是否需要沿用，或改寫成 Vue 版更說明，需使用者決定（可改判 exclude）

### 測試案例

**冒煙**

- 決策前：確認 Vue navigation.ts 沒有此項目、舊版首頁連結仍可用（只讀檢查）
- 若決定移植：在 Vue 開啟版更分頁，期數要等於 monthlyReleases 陣列長度，且最新一期預設展開

**單元**

- 若移植：把 app/monthly-release/page.tsx 的 monthlyReleases 抽成共用資料 lib/releases/monthly.ts，測試排序（最新在前）、最新標記只標第一筆、每筆都包含重點更新、影響、提醒三段

**整合**

- 無資料庫、無 API；只需驗證所有已登入角色（R1–R6）都能看到此頁，未登入時會被導向登入頁

**E2E**

- 點開與收合各期公告；返回工作總覽

**對等驗證**

- 渲染後的文字比對：legacy 頁與 Vue 頁各抓 innerText，依期別逐段比對，內容須完全相同

**測試資料**

- 不需要資料庫資料；R6 一般員工帳號即可

**風險**

- 是否移植還沒決定（可能改判 exclude），請先請使用者裁示再排入測試

## /admin/export-monthly-status

- 狀態：**missing**（L）— lib/workspace/navigation.ts 有『資料匯出』項目但沒有 feature key，沒有對應 Vue 頁，也沒有 workspace 匯出 API；Vue 只在每月人員狀態單店有『匯出 Excel』與『PDF』。
- 舊版：`app/admin/export-monthly-status/page.tsx（862 行）；API app/api/export-monthly-status/{stores,download,roster,actual-staff-points,transport,single-item-bonus,talent-cultivation-bonus,meal-allowance,spring-festival-bonus,support-hours}/route.ts`
- Vue：（無）
- 權限：monthly.export.download、monthly.status.export、monthly.export.stores、monthly.export.meal_allowance、monthly.export.support_hours
- 相依：新增 workspace 匯出 API（可用 app/api/workspace/performance-tools 的包裝既有 handler 做法）、共用檔案下載機制（api.ts blob 下載）、Monthly 頁狀態語意

**舊版功能**

- 年份／月份選擇
- 門市列表：全選／取消全選、顯示提交狀態徽章（未提交／已提交／已確認）與員工人數，未提交者標示『尚未提交，無法匯出』
- 統計資訊：總門市數、可匯出門市、已選擇、總員工數
- 下載整合 Excel（每月人員狀態_YYYY-MM_N間門市.xlsx）
- 匯出實際人力點值
- 預覽每月門市人員名冊（表格：月份、門市代號、名稱、員編、姓名、職稱）與匯出名冊 Excel
- 匯出交通費用、單品獎金、育才獎金、誤餐費、春節出勤獎金
- 匯出門市支援時數（全部門市）

**缺少或不同**

- 整頁沒有 Vue 版：vue-workspace/src/pages 無對應檔案，app/api/workspace 下無 export 相關資料夾
- 跨門市多選匯出在 Vue 不存在，單店 Excel 在 MonthlyTools.vue 的 excel()
- 名冊預覽表與匯出名冊無 Vue 版
- 實際人力點值、交通費、單品獎金、育才、誤餐、春節、支援時數 7 種獨立匯出皆無 Vue 版
- 導覽權限碼用 monthly.status.export，但所有 export API 檢查 monthly.export.download，兩者不一致

**業務規則**

- 只有已提交或已確認的門市可匯出
- 各匯出依選取門市彙整，支援時數匯出是全部門市
- 名冊以當月快照為準（roster route 讀 monthly_staff_status 與 store_relocation_history 對調店）
- 伺服器端統一用 requirePermission(monthly.export.download) 驗證

**API**：舊 /api/export-monthly-status/stores、/api/export-monthly-status/download、/api/export-monthly-status/roster（GET 預覽、POST 下載）、/api/export-monthly-status/actual-staff-points、/api/export-monthly-status/transport、/api/export-monthly-status/single-item-bonus、/api/export-monthly-status/talent-cultivation-bonus、/api/export-monthly-status/meal-allowance、/api/export-monthly-status/spring-festival-bonus、/api/export-monthly-status/support-hours；新 —

**資料表**：monthly_staff_status、monthly_store_summary、monthly_performance_details、support_staff_bonus、store_employees、store_managers、store_relocation_history、employee_movement_history、stores、profiles

**既有測試**：scripts/test-monthly-staff-roster-export.js、scripts/test-monthly-status-actual-staff-points-export.js

**待確認**

- legacy 頁面本身有沒有頁面層級權限守衛未確認（page.tsx 沒有看到檢查，只有 API 擋）
- monthly.status.export 與 monthly.export.download 哪個才是正確的導覽權限，需與使用者確認

### 測試案例

**冒煙**

- legacy 基準：以 R5 開啟 /admin/export-monthly-status，選 2026-10，門市列表要顯示未提交、已提交、已確認三種徽章，且未提交門市不能勾選
- Vue 版完成後：資料匯出分頁可開啟，統計資訊的四個數字與 legacy 相同

**單元**

- 抽出可匯出判斷 canExportStore(status)：只有 submitted 和 confirmed 回 true
- 匯出檔名格式 exportFileName('monthly', '2026-10', n) → 每月人員狀態_2026-10_N間門市.xlsx，各種匯出類型的檔名都要比照 legacy route 的 Content-Disposition
- 人力點值計算（legacy actual-staff-points route 內的公式抽成純函式），和 MonthlyTools.vue derived 的結果要一致

**整合**

- legacy API 基準權限矩陣：對 10 支 /api/export-monthly-status/* 端點逐一測試，R1、R2、R5（有 monthly.export.download）回 200，R3、R6 回 403。結果存成基準檔，供未來 workspace 包裝 API 對照
- Vue 實作後：workspace 匯出 API 必須使用同一個權限碼。也要驗證導覽權限：只有 monthly.status.export 而沒有 export.download 的帳號，導覽會顯示項目但 API 回 403。這是目前的不一致，要測出來並列入報告
- 選取門市包含 draft 門市時，API 必須拒絕或排除（記錄 legacy 的實際行為作為基準）
- roster GET 預覽：對調店員工要依 store_relocation_history 顯示當月快照的門市
- support-hours 匯出一律是全部門市，不受選取影響
- 大量資料：全部門市 × 2026-10 下載需在 120 秒內完成，檢查 maxDuration 設定

**E2E**

- R5 依序操作：選月份 → 全選 → 下載整合 Excel → 匯出實際人力點值 → 預覽名冊 → 匯出名冊 → 交通費 → 單品獎金 → 育才 → 誤餐 → 春節 → 支援時數，共 9 個檔案都要成功下載且非空
- R3 開啟頁面時，按鈕要隱藏或 API 回 403，畫面須顯示清楚的錯誤訊息

**對等驗證**

- Vue 版完成後，對 10 種匯出都做逐欄比對：同一份 DEV 資料、R5、2026-10、同一組選取門市（S2、S3）。用 Python openpyxl 讀 legacy 與 Vue 兩份檔，比對工作表名稱、表頭順序、列數，並以員編或門市代號為鍵逐格比對；數字容許 0 誤差，日期統一格式後比較。差異輸出到 .tmp-check/parity/export/<type>-diff.json
- Vue 版完成前：先跑一次 legacy 匯出並存成 golden 檔放在 .tmp-check/parity/export/golden/，同時沿用並擴充 scripts/test-monthly-staff-roster-export.js 與 test-monthly-status-actual-staff-points-export.js
- 名冊預覽的 JSON（legacy roster GET）與 Vue 預覽表的資料要深度相等

**測試資料**

- 2026-10 至少 4 間門市，狀態依序為 draft、submitted、confirmed、confirmed，且其中一間門市在當月有調店紀錄（store_relocation_history）
- 各種津貼資料：support_staff_bonus、talent_cultivation_bonus、spring_festival_bonus（建議改用 2026-02 春節月）、meal_allowance_records、交通費
- 權限設定：R5（export.download）；R5b 只有 monthly.status.export 沒有 export.download

**風險**

- 整頁尚未移植，屬於 L 級工作量，parity 需要先建立 golden 檔
- 導覽權限碼與 API 權限碼不一致，會出現『看得到、按了 403』的情況
- 匯出逾時：legacy 使用 serverless 函式，若 workspace 包裝沒有設定 maxDuration 可能失敗

## /admin/performance

- 狀態：**partial**（S）— 三個分頁（團體獎金、處方箋、匯入每月獎金）皆已有 Vue 版，月季獎金試算、閾值設定、處方箋匯入、獎金篩選／平均都已復刻；剩下操作方式改變與少數行為差異，需實測驗收。
- 舊版：`app/admin/performance/page.tsx（1899 行，含團體獎金、匯入每月獎金兩部分）＋ components/performance/PrescriptionTab.tsx（734 行）；API /api/performance-data（及 /import）、/api/performance-thresholds、/api/performance-bonus（及 /averages、/import）、/api/prescription-monthly（及 /template、/import）、/api/stores-with-supervisors`
- Vue：`vue-workspace/src/pages/Performance.vue`、`vue-workspace/src/pages/PerformanceGroup.vue`、`vue-workspace/src/pages/PerformanceThresholds.vue`、`vue-workspace/src/pages/PerformancePrescription.vue`、`vue-workspace/src/pages/PerformanceBonus.vue`、`vue-workspace/src/components/PerformanceSummary.vue`、`vue-workspace/src/performance-bonus-columns.ts`
- 權限：performance.view、performance.edit、performance.bonus.view、performance.bonus.import
- 相依：lib/performance/bonus-calc（Vue 直接 import）、Modal、TopScrollTable 共用元件、/monthly-status 的業績與獎金視窗共用 bonus-calc 與獎金欄位定義

**舊版功能**

- 分頁：團體獎金／處方箋（performance.view 或 edit）／匯入每月獎金（performance.bonus.view）
- 團體獎金：門市下拉、年度選擇、重新載入
- 業績 Excel 匯入，可不選門市，依 Excel『門市代號』欄位匯入
- 每人獎金閾值設定（月／季各 5 檻）、顯示『自訂閾值』標記、編輯與取消
- 月季計算規則說明（營業天數支援 0.5、活動日扣除後日均毛利低於第一檻則月獎金×80%）
- 季度卡片：毛利達成率、月合計、補差額、季營業天數、季毛利目標／實際、達標門檻、加權達成
- 逐月業績明細表：12 個月、直接於儲存格編輯、達成門檻徽章、獎金與『活動日折減80%』提示、逐列儲存
- 處方箋：單月／年度檢視、年月選擇、下載本月範本、匯入 Excel、手動修正、儲存變更、驗證非負整數與點值最多四位小數、資料狀態徽章（已完成／部分／未填／格式錯誤）、年度表可點月份開啟月報、未儲存切換確認
- 匯入每月獎金：年月、年季度、督導區、門市別、獎金名稱、員編篩選；欄位排序（左鍵排序右鍵取消）；動態獎金欄位；合計；季別合計；年度累積平均獎金（每月皆存在員工 vs 人月平均）、店長與專員團體獎金平均；匯入 Excel 與格式說明；180 秒逾時處理

**缺少或不同**

- 逐月明細從『儲存格直接編輯＋逐列儲存』改成『點月份開新分頁表單編輯』（PerformanceGroup.vue edit()），操作流程不同
- 業績 Excel 匯入在 Vue 必須先選門市並帶 store_id（PerformanceGroup.vue importData），legacy 可不選門市依 Excel 門市代號匯入
- legacy 對一般使用者以 profile.role 與 managed_stores 限制門市；Vue 改以 moduleStores／requireStore 判斷，行為需實測確認
- 處方箋 Vue 為草稿加整批儲存，驗證規則（四位小數）是否同 legacy 需比對 PerformancePrescription.vue 與 API
- 匯入獎金的『全 0 列自動隱藏』『季別加總』在 Vue 有，但排序右鍵取消排序的互動不同（改為三態按鈕）
- 獎金閾值需 performance.edit，Vue 閾值頁另開分頁（PerformanceThresholds.vue），儲存後年度頁需重新整理才套用

**業務規則**

- 月團體獎金：毛利 90％＋營業額 5％＋來客數 5％＋慢箋 10％；毛利未達第一檻獎金為 0
- 活動當日毛利有填寫，（整月毛利−活動日毛利）÷（營業天數−1）低於第一檻日毛利，月獎金×80％
- 月第二至第五檻每檻加 MONTHLY_DAILY_GP_STEP×營業天數
- 季回補＝max(0, 季應得 − 月獎金合計)
- 總慢箋張數＝一般箋÷4（四捨五入到小數 1 位）＋慢箋張數
- 年度累積平均只計入符合資格規則的正職專員以上；團體獎金＝團體＋季回補＋人力補貼
- 匯入獎金相同門市、年月、員工會合併，明確填入的 0 也更新

**API**：舊 /api/performance-data、/api/performance-data/import、/api/performance-thresholds、/api/performance-bonus、/api/performance-bonus/averages、/api/performance-bonus/import、/api/prescription-monthly、/api/prescription-monthly/template、/api/prescription-monthly/import、/api/stores-with-supervisors；新 app/api/workspace/performance/route.ts、app/api/workspace/performance-tools/[resource]/route.ts（thresholds、performance-import、prescription、prescription-template、prescription-import、bonus、bonus-averages、bonus-stores、bonus-import）、supabase/workspace-dev/20261028101000_vue_bonus_compatibility.sql

**資料表**：store_performance、store_performance_thresholds、monthly_bonus_records、monthly_prescription_reports、stores、profiles、store_managers

**既有測試**：scripts/test-workspace-performance-parity.py、scripts/test-workspace-performance-recovery.py、scripts/test-workspace-performance-sections.py、scripts/test-workspace-prescription-scroll.py、scripts/test-performance-brand-bonus-import.js、scripts/make-workspace-performance-test-files.cjs、scripts/apply-workspace-prescription-dev.cjs

**待確認**

- PerformancePrescription.vue 與 API 的驗證細節（四位小數、非負整數）未逐行比對
- legacy 不選門市匯入的行為是否有使用者仍需要
- PerformanceBonus 的 Excel 欄位名稱完全對應程度未逐欄比對

### 測試案例

**冒煙**

- 以 R2（performance.view）開啟 Performance 分頁，三個子分頁（團體獎金、處方箋、匯入每月獎金）都能載入
- 團體獎金：選 S1 與 2026 年，12 個月的列和季度卡片都要顯示
- GET /api/workspace/performance-tools/thresholds?store_id=S1 回 monthly 5 筆、quarterly 5 筆
- GET performance-tools/bonus?year_month=2026-10 回 200（需 performance.bonus.view）

**單元**

- lib/performance/bonus-calc.ts calcMonthlyBonus：毛利未達第一檻 → 0；剛好達第一檻；第二至第五檻每檻加 MONTHLY_DAILY_GP_STEP×營業天數；營業天數 30.5；活動日毛利有填寫，且（整月毛利−活動日毛利）÷（營業天數−1）低於第一檻日毛利 → ×0.8；營業天數=1 時的除以 0 邊界；權重 毛利 90%＋營業額 5%＋來客 5%＋慢箋 10%
- calcQuarterlyBonus：季應得、補差額＝max(0, 季應得−月合計)、加權達成率
- calcGpThresholdLevel／calcQuarterlyGpThresholdLevel：在每個邊界值的 ±1 測試
- getQuarter、getQuarterMonths：月份 1、3、4、12
- 總慢箋張數：一般箋 ÷ 4 四捨五入到小數 1 位，再加慢箋；一般箋 10 → 2.5，一般箋 7 → 1.8（若有實作函式就測該函式，否則先抽出）
- vue-workspace/src/performance-bonus-columns.ts：動態欄位排序、全 0 列隱藏、季別加總、三態排序（升冪、降冪、取消）

**整合**

- 權限矩陣：bonus*（bonus、bonus-averages、bonus-stores）只需 performance.bonus.view，沒有 performance.view 也能讀，要寫測試確認並記錄；bonus-import 需 performance.bonus.import；thresholds、performance-import、prescription 的 POST 需 performance.edit，只有 view 的帳號回 403
- thresholds POST 驗證：只給 4 檻、level 順序為 [1,3,2,4,5]、base_amount 為 1.5 或 -1 或 2147483648 → 400；store_id 不在可見門市 → 403
- performance-import：Vue 必帶 store_id；legacy 不帶門市時依 Excel 門市代號匯入。對 workspace 不帶 store_id 測試並記錄行為
- prescription POST：點值超過四位小數、張數為負數或非整數 → 400（對照 app/api/prescription-monthly/route.ts 第 20 行 Number.isInteger 檢查）
- bonus-import 合併規則：同門市、同年月、同員工匯入兩次，第二次明確填 0 的欄位要被更新為 0；匯入 180 秒逾時的錯誤訊息
- 並行：兩個分頁同時存同一門市的 thresholds，後寫入者覆蓋；記錄是否有版本檢查（uncertain）
- resource 不存在 → 404；POST 未通過 checkOrigin → 403

**E2E**

- R1 團體獎金：匯入業績 Excel（先選 S1）→ 點 10 月開啟編輯分頁 → 修改毛利並存檔 → 回到年度頁，季度卡片的金額要更新
- 閾值頁：修改月第一檻並存檔 → 年度頁重新整理後套用，且顯示『自訂閾值』標記
- 處方箋：下載範本 → 填寫後匯入 → 手動修正一格 → 未儲存就切月份要跳出確認 → 儲存後狀態徽章變為已完成
- 匯入每月獎金：選督導區、門市、員編篩選 → 排序 → 看季別合計與年度平均卡；匯入格式錯誤的檔案要出現錯誤訊息

**對等驗證**

- 月、季獎金逐月比對：同一份 store_performance 與 thresholds 資料（S1、S3 × 2026 全年），legacy /admin/performance 頁計算的每月獎金、活動日折減、季應得、回補，與 Vue PerformanceGroup 的結果逐格比對，容許誤差 0 元。資料抽取方式：兩邊都透過 Playwright 讀表格的 data 屬性，或直接以 Node import bonus-calc 對同一筆 API 回應計算
- legacy /api/performance-bonus 與 workspace performance-tools/bonus 對同一組參數（year_month、quarter、supervisor、store、bonus_name、employee_code）回應的 JSON 須深度相等；averages 也一樣比對
- 處方箋：legacy PrescriptionTab 與 PerformancePrescription.vue 對同一個月份的資料，比對每家門市各欄位與狀態徽章；兩邊匯入同一個 Excel 後，monthly_prescription_reports 的 DB 寫入要一致
- Excel 匯入欄位對應：用 scripts/make-workspace-performance-test-files.cjs 產生的檔案分別透過 legacy 與 Vue 匯入兩個對照環境（或先還原），逐列比對 store_performance、monthly_bonus_records
- 沿用並擴充 scripts/test-workspace-performance-parity.py，加入活動日折減與營業天數 0.5 的案例

**測試資料**

- store_performance：S1 全年 12 個月，其中 10 月有 activity_day_gross_profit（觸發 80% 折減）、11 月毛利剛好等於第一檻、12 月未達門檻
- S1 使用自訂閾值，S3 使用預設閾值
- monthly_bonus_records：同一員工跨三個月，其中一筆所有欄位為 0（測試隱藏），另一筆明確填 0
- monthly_prescription_reports：2026-10 每種狀態（已完成、部分、未填、格式錯誤）各一間
- 權限設定：R2（view）、R1（edit）、Rb1（只有 bonus.view）、Rb2（bonus.import）

**風險**

- bonus-calc 被 legacy 與 Vue 共用，改動會同時影響兩邊；parity 測試要防止只改到單邊
- Vue 匯入必須選門市，與 legacy 依 Excel 門市代號的批次匯入行為不同
- 閾值儲存後年度頁不會自動刷新，使用者可能看到舊的獎金金額

## /admin/pharmacist-management

- 狀態：**done**（S）— Vue 版涵蓋督導區總覽（篩選、月份關帳、摘要卡、門市藥師明細、補入藥師、離職藥師）與藥師主檔（年度同步、年度關帳、手動新增／刪除、編輯、年費紀錄與繳費證明），後端直接重用 legacy handler。仍需實測驗收細節。
- 舊版：`app/admin/pharmacist-management/page.tsx（1123 行，server component）＋ OverviewFilterForm.tsx、SummaryCards.tsx、PharmacistSupervisorCards.tsx、PharmacistManagementTable.tsx、PharmacistMasterList.tsx、PharmacistAnnualFeeModal.tsx`
- Vue：`vue-workspace/src/pages/Pharmacists.vue`、`vue-workspace/src/pharmacist-proof.ts`
- 權限：pharmacist.management.view、pharmacist.management.edit、pharmacist.management.master.view、pharmacist.management.master.edit、monthly.status.view_all、monthly.status.view_own
- 相依：monthly_staff_status 與人員異動歷程資料、Supabase Storage 繳費證明 bucket、pharmacist-overview 同時被工作總覽使用

**舊版功能**

- 兩個分頁：督導區總覽、藥師主檔（主檔需 master.view）
- 總覽：月份、督導區篩選、月份關帳／解除關帳（顯示關帳人與日期）
- 摘要卡：當月藥師總數、新增任職、門市／職級異動，點擊展開明細表
- 督導區卡片列門市與藥師數，只看離職切換，點門市展開藥師明細與變化備註
- 手動新增該月藥師：搜尋既有員工（至少 2 字）或自填員編姓名職級，寫入固定月快照
- 本月離職藥師列表（含離職日期）
- 變化類型判定：離職、新增任職、門市異動、職級異動、留職停薪、調店／升遷次月生效
- 藥師主檔：年度選擇、年度關帳／解除、自動同步人事異動（顯示同步時間）、手動加入主檔、搜尋、狀態篩選（在職／已離職／留停／全部）
- 主檔列：到職日與年資、畢業學校、學歷、負責藥師、執照更新日（逾期紅字）、常年會費
- 列內編輯與儲存、刪除手動新增資料
- 常年會費視窗：列表、新增（縣市公會、年度、繳費期間、證明照片或 PDF 10MB、備註）、刪除、查看證明、基隆市期間規則
- 僅檢視模式提示

**缺少或不同**

- Vue 版年費視窗是兩步（列表＋表單）並新增『編輯備註／證明』，legacy 無編輯功能，屬增強
- 上傳大小上限 Vue 為 3.5 MB（Pharmacists.vue 341 行），legacy 提示最大 10 MB 但前端壓縮建議 3.5 MB，需確認是否一致
- 主檔分頁（Vue 每頁固定筆數）與 legacy 全量列表不同
- legacy 督導區卡片中的 Debug 資訊面板在 Vue 沒有（可不復刻）

**業務規則**

- 已關帳月份不可手動補藥師（workspace route 回 409）
- 關帳後年度主檔不再自動同步人事異動
- 主檔刪除僅限手動新增資料
- 主檔編輯需 master.edit，總覽編輯需 management.edit
- 執照更新日逾期顯示紅色，年費藍底表示按規則判定具有效繳費紀錄

**API**：舊 /api/pharmacist-annual-master/sync、/api/pharmacist-annual-master/lock、/api/pharmacist-annual-master/manual-add、/api/pharmacist-snapshot-lock、/api/pharmacist-monthly-snapshot/manual-add、/api/pharmacist-profiles、/api/pharmacist-annual-fees、/api/pharmacist-annual-fees/upload、/api/monthly-staff-by-store/search；新 app/api/workspace/pharmacists/[action]/route.ts、lib/workspace/pharmacist-overview.ts、supabase/workspace-dev/pharmacist-storage.sql

**資料表**：pharmacist_profiles、pharmacist_annual_master、pharmacist_annual_master_locks、pharmacist_annual_master_sync_log、pharmacist_annual_fees、pharmacist_monthly_snapshot、pharmacist_snapshot_locks、employee_movement_history、monthly_staff_status、stores、profiles

**既有測試**：scripts/test-workspace-pharmacists.py、scripts/test-workspace-pharmacists-month.py、scripts/verify-workspace-pharmacists-copy.py、scripts/audit-workspace-pharmacists.cjs、scripts/copy-workspace-pharmacists-dev.cjs、scripts/test-pharmacist-snapshot-carry.cjs、scripts/test-pharmacist-transfer-reconciliation.cjs

**待確認**

- legacy 變化類型判定邏輯（page.tsx 800–900 行）與 lib/workspace/pharmacist-overview.ts 是否逐條一致，只看到有對應的 audit 腳本
- workspace route 對 overview 讀取只要 pharmacist.management.view，與 legacy 以 canViewAllMonthly／canViewOwnMonthly 縮小範圍的對應程度未逐行確認

### 測試案例

**冒煙**

- 以 R7 開啟藥師分頁，督導區總覽要載入 2026-10 的摘要卡與督導區卡片
- 以 R8 開啟藥師主檔分頁，2026 年度列表要載入並顯示同步時間
- POST /api/workspace/pharmacists/overview?year_month=2026-10&zone=all 回 200；year_month=2026-13 → 400

**單元**

- vue-workspace/src/pharmacist-proof.ts：檔案類型（jpg、png、pdf）與大小上限（目前 3.5MB）的判斷，以及壓縮後的大小
- 執照逾期判斷：今天、昨天、null 三種情況
- 基隆市年費期間規則（若有抽成函式則測該函式，否則建議從 PharmacistAnnualFeeModal 抽出）
- lib/workspace/pharmacist-overview.ts 的變化類型判定：用 fixture 測離職、新增任職、門市異動、職級異動、留停、調店次月生效、升遷次月生效各一筆；沿用 scripts/test-pharmacist-transfer-reconciliation.cjs 與 test-pharmacist-snapshot-carry.cjs

**整合**

- 權限矩陣：R6 對任何 action 都回 403；R7（view＋edit，沒有 master）讀 master、profiles 回 403『沒有藥師主檔查看權限』；只有 master.view 的帳號 PATCH profiles 回 403『沒有藥師主檔編輯權限』
- 重點風險測試：只有 pharmacist.management.view 的帳號（無 edit）對 month-lock POST、monthly-manual POST、fees POST/DELETE、proof POST 逐一呼叫，確認 legacy handler 會擋下；若回 200 就是安全缺口，必須報告
- 重點風險測試：只有 master.view（無 master.edit）的帳號 POST master（會轉成 legacy GET 並 reconcile snapshots），比對呼叫前後 pharmacist_annual_master 與 sync_log 是否有寫入，判斷唯讀角色能否觸發寫入
- 關帳：month-lock 關閉 2026-10 後，monthly-manual POST 回 409『此月份已關帳』；解除關帳後回 200
- 年度關帳後同步不得改變主檔資料（比對同步前後的 DB）
- 主檔 DELETE 非手動新增的列 → 被拒（記錄狀態碼）
- master GET → 405『請使用同步查詢』；未知 action → 404
- fees 上傳超過 3.5MB 以及介於 3.5–10MB 的檔案：記錄 workspace 與 legacy 各自的上限行為

**E2E**

- R8 主檔：年度同步 → 搜尋 → 篩選已離職 → 編輯畢業學校並存檔 → 開啟年費視窗 → 新增一筆基隆市年費（附 PDF）→ 查看證明 → 刪除
- R7 總覽：選督導區 → 點門市展開明細 → 只看離職 → 手動補入藥師（搜尋至少 2 字）→ 月份關帳 → 補入按鈕要停用或回 409
- 沿用 scripts/test-workspace-pharmacists.py 與 test-workspace-pharmacists-month.py，加入上述步驟

**對等驗證**

- 總覽對等：同一份 DEV 資料、2026-10、zone=all，比對 legacy page.tsx 伺服器端計算的摘要卡數字、督導區卡片門市數與藥師數、每位藥師的變化類型，與 pharmacistOverview() 回應，以員編為鍵深度比對。沿用 scripts/audit-workspace-pharmacists.cjs，並擴充 zone 逐區比對
- 主檔對等：legacy GET /api/pharmacist-annual-master/sync 與 workspace POST master 對同一年度的回應深度相等
- 寫入對等：同一筆 fees 新增分別透過 legacy 與 workspace 寫入，比對 pharmacist_annual_fees 列欄位與 storage 路徑格式

**測試資料**

- 2026-10 藥師快照，包含離職、新任、調店（次月生效）、升遷、留停各一名
- pharmacist_annual_master 2026 年度：手動新增一筆、自動同步多筆、執照逾期一筆
- 基隆市與台北市年費紀錄各一筆，證明檔 PDF 1MB 與 5MB 各一
- pharmacist_snapshot_locks：2026-09 已關帳
- 權限設定：R7、R8、Rp1（只有 view）、Rp2（只有 master.view）

**風險**

- workspace 外層只檢查 view，寫入權限完全依賴 legacy handler，未驗證前不能確定安全
- master POST 會觸發 reconcile 寫入，唯讀角色可能改動主檔
- 上傳上限 3.5MB 與 legacy 提示的 10MB 不一致

## /admin/employee-purchases

- 狀態：**done**（S）— Vue 版涵蓋月份查詢、POS Excel 匯入覆蓋、職稱彙總與篩選、員工消費彙總（搜尋、排序、分頁、收合）、員工購買明細、匯入警告，後端直接包裝 legacy handler。
- 舊版：`app/admin/employee-purchases/page.tsx（608 行）；API app/api/employee-purchases/route.ts、employee-details/route.ts、import/route.ts`
- Vue：`vue-workspace/src/pages/EmployeePurchases.vue`
- 權限：employee_purchase.view、employee_purchase.import
- 相依：monthly_staff_status 快照（比對員工職稱）、Modal 共用元件

**舊版功能**

- 月份查詢與重新整理
- 匯入 POS Excel（需 employee_purchase.import）：覆蓋該銷售月份資料、顯示歸屬月份、筆數、已比對、未比對、跳過、總金額
- 統計卡：月份與最後匯入時間、購物總金額、明細筆數、人員比對（未比對筆數）
- 職稱金額彙總卡，可點選職稱篩選，顯示同仁數、筆數、毛利
- 員工消費彙總表（認列門市、員編、姓名、職稱、消費筆數、消費總額，可排序、可收合）
- 點員工查看購買商品明細（購買門市、品號、品名、筆數、數量、毛利、金額，加總卡）
- 匯入警告提示

**缺少或不同**

- Vue 增加員工搜尋與分頁（每頁 50 筆），legacy 無，屬增強
- Vue 匯入前多一道確認勾選與放棄檔案確認（屬增強）
- legacy 明細可『回到員工列表選擇其他人』，Vue 以 Modal 開關取代（行為等價）

**業務規則**

- POS 檔第一列為 GridBand1，第二列為欄位名稱，需含門市代號、銷售日期、銷售序號、會員編號、會員名稱、品號、品名、數量、總金額等
- 匯入會覆蓋該銷售月份的既有資料
- 員工依當月人員快照比對職稱與認列門市；比對不到記為未比對
- 匯入逾時 180 秒

**API**：舊 /api/employee-purchases、/api/employee-purchases/employee-details、/api/employee-purchases/import、RPC employee_purchase_employee_summary、employee_purchase_month_stats、employee_purchase_position_summary；新 app/api/workspace/employee-purchases/[[...path]]/route.ts、supabase/workspace-dev/employee-purchases.sql

**資料表**：employee_purchase_import_batches、employee_purchase_sales、employee_movement_history、monthly_staff_status、store_employees、stores

**既有測試**：scripts/test-workspace-employee-purchases.py、scripts/test-employee-purchase-management.js、scripts/test-general-affairs-purchase-reviews.js

**待確認**

- legacy 匯入的銷售月份歸屬規則（跨月日期）與 Vue 沿用同一 handler，未逐行驗證規則細節

### 測試案例

**冒煙**

- 以 R9 開啟員購分頁，2026-10 要顯示統計卡、職稱彙總、員工彙總表
- GET /api/workspace/employee-purchases?year_month=2026-10 回 200，capabilities.import 為 false；以 R10 呼叫時為 true
- GET employee-purchases/employee-details?year_month=2026-10&employee_code=X 回明細

**單元**

- EmployeePurchases.vue 的搜尋、分頁（每頁 50 筆）、排序：建議抽成純函式 filterSortPage(rows, q, sortKey, dir, page)，測試邊界（第 51 筆、空搜尋、中文姓名）
- POS 檔標頭解析（legacy import route 的解析邏輯）：第一列為 GridBand1、第二列為欄位名；缺少必要欄位（例如『總金額』）時要擋下；跨月日期的歸屬規則（uncertain，先寫測試記錄現況）

**整合**

- 權限矩陣：R6 GET → 403；R9 GET → 200，POST import → 403；R10 POST import → 200
- year_month='2026-1' 或 '2026-13' → 400『月份格式錯誤』；未知路徑 GET 'foo' → 404；POST 'import/x' → 404；未通過 checkOrigin → 403
- 匯入覆蓋：同一個銷售月份匯入檔 A，再匯入檔 B，DB employee_purchase_sales 只能剩下 B 的資料，import_batches 新增一筆；統計卡的筆數、已比對、未比對、跳過、總金額要與 DB 計數一致
- 比對規則：員編存在於 2026-10 monthly_staff_status 快照時，要以快照的職稱與門市認列；不存在時要計入未比對
- 並行匯入：兩個請求同時匯入同一月份，最後 DB 資料要一致，不能是兩份混合（記錄實際行為）
- 大檔：接近逾時上限（180 秒）的檔案要回傳可讀的錯誤訊息

**E2E**

- R10：選擇 POS 檔 → 勾選確認 → 匯入 → 顯示歸屬月份與各項筆數 → 點職稱卡篩選 → 點員工開啟明細 Modal → 關閉 Modal → 搜尋 → 換頁
- 匯入警告：上傳含未比對員工的檔案，要顯示警告
- 沿用 scripts/test-workspace-employee-purchases.py

**對等驗證**

- 同一份 DEV 匯入資料、2026-10，比對 legacy /api/employee-purchases 與 workspace 回應（排除 capabilities 欄位）是否深度相等；employee-details 對 3 名員工逐一比對
- 同一個 POS 檔分別經 legacy 與 workspace 匯入（之間先清空該月），比對 employee_purchase_sales 全部列（排除 id、batch_id、時間戳）以及三個 RPC（employee_summary、month_stats、position_summary）的輸出
- 畫面數字：統計卡、職稱彙總卡、員工彙總前 50 列，legacy 與 Vue 用 Playwright 抓取後比對

**測試資料**

- POS 測試檔：一般檔、缺欄位檔、跨月日期檔、含未比對會員編號檔，以及 GridBand1 標頭格式
- 2026-10 monthly_staff_status 快照，需含調店員工（測試認列門市）
- 權限設定：R9、R10、R6

**風險**

- 匯入會覆蓋整月資料，並行或誤傳檔案可能清掉正確資料，目前只有前端的確認勾選保護
- 跨月日期的歸屬規則沒有逐行驗證

## 領域測試備註

【我實際讀過、規劃時要用到的程式碼事實】
1. 單店 Excel 的新舊行為不同：legacy 在 app/monthly-status/page.tsx 第 1303 行呼叫 exportMonthlyStatusForBonus(yearMonth, store.id)，只取 confirmed，輸出的是 CSV（含 BOM），寫法是 `"${row[h] || ''}"`，所以 0、false 都會變成空字串，檔名為 人員狀態_{門市名}_{月}.csv。Vue 走 app/api/workspace/monthly/tools/route.ts op=excel，呼叫 exportMonthlyStatusForBonus(month, store, true)，會把 submitted 也一起匯出；MonthlyTools.vue excel() 用 json_to_sheet 產生 xlsx，工作表名為『人員狀態』，檔名為 人員狀態_{月}.xlsx。比對時必須先正規化（0 與空字串、檔案格式），並請使用者決定「已送審可匯出」算增強還是偏差。
2. app/api/workspace/monthly/route.ts POST：confirm／revert／unconfirm 只檢查高階權限，不查 store_managers 指派；save／submit 要有 edit 或 submit 權限，非 admin 還必須是 store_managers 指派人員。save 只接受 status=draft，否則回 409。work_days 範圍 0–31、work_hours 0–744，notes 最多 4000 字；職位為行政時必須帶 ADMIN_LEVEL。
3. lib/workspace/monthly-tools.ts 的 editableMonth：monthly_store_summary.store_status 為 submitted／confirmed，或任一 monthly_staff_status 列為 submitted／confirmed，就回 409。validateAllowance 是純函式，很適合寫 unit test，規則包括：最多 1500 列；金額 0–1e7；talent／spring 金額須為整數；spring 分類限藥師、主管、專員，日期須在當月；meal 時段 HH:MM-HH:MM、日期 MM/DD、須在當月、時段與身分有列舉限制；transport 金額 >0 必須填原因；employee_code 會轉大寫；重複鍵會被擋。
4. tools POST 的 multipart 匯入（kind=performance/stats）不呼叫 requireStore（屬全公司匯入），但要求 monthly.import.* 加上 monthly.status.view_all；檔案上限 20MB、副檔名須為 .xls 或 .xlsx。op=stats 的 business_days 上限是當月天數。三支 RPC 是 workspace_save_monthly_allowance（p_expected 樂觀鎖）、workspace_save_monthly_summary（p_version）、workspace_add_monthly_employee（p_id 冪等，duplicated 時回 409），定義在 supabase/workspace-dev/20261029180000_vue_monthly_tools.sql。
5. calculated_block 由 DB trigger 計算（supabase/migration_monthly_staff_status.sql、migration_fix_bonus_block_logic.sql、migration_extra_task_block4.sql、migration_work_days_zero_block3.sql）。legacy 編輯頁的預覽寫在 app/monthly-status/edit/[id]/page.tsx 約 185–220 行的 setPreviewBlock，新人升階提醒在 252–294 行。BONUS_BLOCK_DESCRIPTIONS 定義在 types/workflow.ts:352。
6. app/api/workspace/performance-tools/[resource]/route.ts：bonus* 系列只用 context()，檢查 performance.bonus.view／import，不需要 performance.view；其他資源要 moduleContext('performance')，寫入時另需 performance.edit。thresholds 寫入規定每期 5 檻、level 必須依序為 1..5、base_amount 為非負整數。
7. app/api/workspace/pharmacists/[action]/route.ts：外層只檢查 pharmacist.management.view。master／annual-manual／annual-lock／profiles 需要 master.view，非 GET 另需 master.edit，但 master 例外：POST 會轉成 legacy GET 並「reconcile snapshots」。month-lock、monthly-manual、fees、proof 的寫入權限完全交給 legacy handler 判斷，必須用角色矩陣實測（uncertain）。
8. app/api/workspace/employee-purchases/[[...path]]/route.ts：GET 需 view 或 import，且 year_month 格式要正確；POST 只接受 path=import，需 employee_purchase.import 並通過 checkOrigin。
9. Vue 的獎金計算直接 import lib/performance/bonus-calc.ts（calcMonthlyBonus、calcQuarterlyBonus、calcGpThresholdLevel、calcQuarterlyGpThresholdLevel、MONTHLY_DAILY_GP_STEP=1000），季彙總在 lib/workspace/monthly-quarter.ts monthlyQuarterSummary。比對新舊獎金時，legacy 與 Vue 必須使用同一份 DEV 資料，並以 API JSON 數值比對為主，不能只看畫面。

【共用測試基礎建設建議】
- 角色帳號矩陣（DEV）：R1 admin；R2 營業部主管（monthly.status.view_all、confirm、revert、unconfirm、view_stats、bonus_detail.view、export.download、import.*）；R3 店長甲（view_own、edit、submit、add_employee、allowance.edit_support_bonus，在 store_managers 指派到門市 S1）；R4 店長乙（權限同 R3，但只指派 S2）；R5 會計（view_all、export.download、bonus_detail.view，沒有 edit）；R6 一般員工（無 monthly 權限）；R7 藥師管理員（pharmacist.management.view／edit，沒有 master.*）；R8 藥師主檔管理員（另加 master.view／master.edit）；R9 員購檢視者（employee_purchase.view）；R10 員購匯入者（employee_purchase.import）。
- Fixture：以 scripts/test-workspace-monthly-fixtures.cjs 為基礎，把 2026-10 設為測試月份。S1 為 draft，S2 為 submitted，S3 為 confirmed，S4 為停用門市（帶歷史資料）。每間門市放 1 名正職、1 名兼職、1 名新人（到職日分別落在 1、2、6 個月前）、1 名行政、1 名雙職督導（代理店長）、1 名藥師、1 名手動新增外務人員。
- 結果放在 .tmp-check/parity/<page>/，JSON 比對差異輸出為 diff.json。所有寫入測試都要在 DEV 執行，並在 teardown 還原（或使用固定 requestId，確保可以重跑）。
