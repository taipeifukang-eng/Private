# 全站 Vue 功能對等驗收

目標：全站既有功能改為原生 Vue 3，實際操作、權限與業務規則通過驗收。僅在原總務 DEV 測試環境實作。

## 驗收規則

- 舊版頁面、元件、彈窗與流程逐項盤點；路由存在不代表功能完成。
- 不以外連舊站、iframe、只有列表或簡化編輯器計為完成。
- 每項須驗證正常操作、權限/門市範圍、空資料、失敗復原與草稿關閉。
- 匯入、匯出、附件、簽名、審核、通知等均屬功能範圍；不可默默略過。
- 測試/診斷頁先盤點用途再決定 Vue 對應；不先排除。
- 已有部分 Vue 內容一律標為部分完成，完整對等及測試證據齊備後才標完成。

2026-10-28 使用者要求檢查所有已改模組後，已新增 [功能對等重查](feature-parity-review.md)，列明每月人員、業績、活動、盤點、巡店與任務的具體缺漏；以此作為子流程補齊清單，不以主入口完成推論整個模組完成。

## 首批：巡店完整流程

| 功能 | 原實作來源 | 狀態 |
| --- | --- | --- |
| 督導/經理列表、分店分月 | app/inspection/page.tsx | 部分原生化 |
| 已巡/未巡、搬店沿革認列 | components/InspectionOverview.tsx、InspectionStoreStatus.tsx | 已原生化；7 項整合與 5 個沿革案例驗證 |
| 月曆、前後月、今天、紀錄開啟 | components/InspectionCalendar.tsx | 已原生化；月曆整合測試通過，今天以台北日期計算 |
| 新增、範本、扣分數量、計分 | app/inspection/new/page.tsx | 已原生化；9 項瀏覽器操作及 7 項寫入整合驗證，仍待補經理權限與手機細節驗收 |
| 在班人員、手動新增、督導標記 | app/inspection/new/page.tsx | 已原生化；9 項瀏覽器操作及 7 項寫入整合驗證，仍待補經理權限與手機細節驗收 |
| GPS/時間、照片、簽名、溫度、備註 | app/inspection/new/page.tsx | 已原生化；9 項瀏覽器操作及 7 項寫入整合驗證，仍待補經理權限與手機細節驗收 |
| 草稿儲存、提交、重送防重複 | app/inspection/new/page.tsx | 已原生化；9 項瀏覽器操作及 7 項寫入整合驗證，仍待補經理權限與手機細節驗收 |
| 編輯與既有資料載入 | app/inspection/[id]/edit/page.tsx | 已接原生編輯與版本檢查；舊數量缺漏須補正，仍待舊資料完整回歸 |
| 明細、改善、列印、刪除 | app/inspection/[id]/page.tsx | 已原生化；列印／刪除 7 項整合驗證及 5 項資料庫連動檢查通過；其他角色與舊資料仍待驗收 |
| 當月得分匯出 | components/InspectionExportControls.tsx | 已接 Vue 下載；沿用後端 Excel 規則，下載及活頁內容驗證通過 |
| 督導與經理跨日期比較 | app/inspection/compare | 已原生化；6 項整合／瀏覽器驗證通過；附件及缺少明細分支仍待補測 |
| 改善追蹤與回報 | app/inspection/improvements | 已原生化；8 項整合／瀏覽器驗證通過，已補主管門市隔離、逾期與並行回報 5 項案例；其餘角色仍待驗收 |
| 範本、評級與改善回補設定 | app/admin/inspection-templates/page.tsx | 已原生化；版本檢查、防重送、評級實際套用及瀏覽器編輯驗證；完整分支仍待驗收 |

## 全站路由清單

共 100 個既有頁面入口。依賴與 API 索引見 route-inventory.json；此清單只作入口基線，仍需展開元件內的子功能。

| 既有路由 | 程式來源 | 狀態 |
| --- | --- | --- |
| `/activity-management` | `app/activity-management/page.tsx` | 已原生化（導覽「活動檢視」開新版列表頁籤）；M5 W20 完成：年度按鈕（預設今年）、狀態與發布對象標籤、未發布標籤、停用隱藏 Q2；舊網址自動轉新版 Q8（僅 DEV 工作台環境啟用，舊頁檔案保留）；已核可差異見 tests/parity/allowlist.json m5-w20-*
| `/activity-view/[id]` | `app/activity-view/[id]/page.tsx` | 已原生化（新版排程檢視頁籤，路徑 /api/workspace/activity-view）；M5 W20 完成：Q6 店長／督導填報（人力預估、本店人員、Check List 勾選與備註、支援指派）、Q7 三顆按鈕與管轄門市照舊版、A4 橫式 PDF 與舊檔名、總門市數／已排程數、?focus 直開行銷／商品部、無權限頁；舊網址自動轉新版 Q8
| `/admin/activity-management/events` | `app/admin/activity-management/events/page.tsx` | 已原生化（活動管理頁的「特殊日期」視窗）；M5 P05 對等驗收完成（依月份分組與星期、同日覆蓋前提醒；已核可差異見 tests/parity/allowlist.json m5-w19-*） |
| `/admin/activity-management` | `app/admin/activity-management/page.tsx` | 已原生化；M5 P05 對等驗收完成（列表狀態依日期、停用隱藏 Q2、刪除輸入名稱與筆數 Q3、改期移回尚未安排 Q4、寫入只看角色權限 Q1；已核可差異見 tests/parity/allowlist.json m5-w19-*） |
| `/admin/activity-management/schedule/[id]` | `app/admin/activity-management/schedule/[id]/page.tsx` | 已原生化；M5 W19 完成（七個分區、盤點類三分頁、週一為首月曆、督導區顏色、自動排程與舊版 200 組隨機資料同輸入同輸出、行銷圖片拖曳排序、Q5 三種提醒） |
| `/admin/activity-management/settings` | `app/admin/activity-management/settings/page.tsx` | 已原生化（活動管理頁的「門市設定」視窗）；M5 P05 對等驗收完成（允許與禁止星期重疊新版擋下，列入核可差異） |
| `/admin/archived` | `app/admin/archived/page.tsx` | 已原生化清單、唯讀明細、時間軌跡與複製；8 項整合及 3 項並行驗證；已接管理明細整批封存入口；範本其餘操作仍待遷移 |
| `/admin/assign/[id]` | `app/admin/assign/[id]/page.tsx` | 已原生化獨立派發／重新指派、人員搜尋及日期；整份流程範圍確認、草稿、重試及版本衝突通過；其餘舊資料分支待驗收 |
| `/admin/create` | `app/admin/create/page.tsx` | 已原生化範本／部門／人員／主子項／日期／原子指派；整合與復原驗證通過，舊資料及多區段完整驗收待補 |
| `/admin/departments` | `app/admin/departments/page.tsx` | 已原生化；M5 W21 完成：進入條件照舊版頁面（Q9）、停用部門仍可調整成員與主管（Q10）、改名／停用不同步人員資料部門文字（Q11，DEV 已移除同步 trigger）、成員表主責／協作／代理計數與人員職掌統計抽屜；已核可差異見 tests/parity/allowlist.json m5-w21-*；上線前名單見 parity-plan/m5-sql/w21_q9_department_gate_preview.sql |
| `/admin/edit/[id]` | `app/admin/edit/[id]/page.tsx` | 已原生化編輯、版本檢查、完成鎖定及協作同步；有紀錄區段刪除等分支仍待補 |
| `/admin/employee-management` | `app/admin/employee-management/page.tsx` | 待逐項盤點 |
| `/admin/employee-purchases` | `app/admin/employee-purchases/page.tsx` | 待逐項盤點 |
| `/admin/export-monthly-status` | `app/admin/export-monthly-status/page.tsx` | 待逐項盤點 |
| `/admin/import-employees` | `app/admin/import-employees/page.tsx` | 待逐項盤點 |
| `/admin/inspection-templates` | `app/admin/inspection-templates/page.tsx` | 已原生化；細項驗證與剩餘範圍見首批巡店表 |
| `/admin/organization` | `app/admin/organization/page.tsx` | 已原生化；M5 W21 完成：唯讀組織圖卡片模式（編輯仍只在樹狀）、人員職掌統計抽屜、停用部門仍可設定成員與主管；組織導覽器與工作交接分頁不復刻（已列差異）；已核可差異見 tests/parity/allowlist.json m5-w21-* |
| `/admin/performance` | `app/admin/performance/page.tsx` | 已補月季獎金、活動日折減、完整明細、閾值、Excel、處方箋與每月獎金；完整角色／舊資料及並行寫入驗收仍待補 |
| `/admin/pharmacist-management` | `app/admin/pharmacist-management/page.tsx` | 待逐項盤點 |
| `/admin/promotion-management` | `app/admin/promotion-management/page.tsx` | 待逐項盤點 |
| `/admin/roles/[id]` | `app/admin/roles/[id]/page.tsx` | 已整合同頁 Vue 角色設定跳窗；權限分組、變更確認與使用者指派／撤銷，DEV 驗證通過 |
| `/admin/roles` | `app/admin/roles/page.tsx` | 已原生化名冊、搜尋篩選、新增／編輯／刪除；沿舊 RBAC 與系統角色保護；M5 P06：「顯示 DEV 測試角色」開關（預設隱藏、提示隱藏數量、DEV測試標籤）、把人加進管理員等級角色前醒目確認（Q13，後端規則不變） |
| `/admin/store-managers` | `app/admin/store-managers/page.tsx` | 已原生化搜尋、多門市指派、單店／全部解除；交易回滾、衝突、權限及瀏覽器草稿／關閉驗證通過，見 verification.md；整組織範圍見 organization-migration.md |
| `/admin/stores/[id]/clone` | `app/admin/stores/[id]/clone/page.tsx` | 已原生化搬遷保留 ID、沿革補建／刪除／重填；交易回滾與瀏覽器驗證通過 |
| `/admin/stores/[id]/edit` | `app/admin/stores/[id]/edit/page.tsx` | 已原生化完整主檔、GPS、停用確認、版本衝突與草稿；驗證見 verification.md |
| `/admin/stores/[id]/employee-management` | `app/admin/stores/[id]/employee-management/page.tsx` | 已接原生主檔名單與獨立升遷／異動歷程；原頁唯讀範圍，權限、階級文字、空紀錄、重試與瀏覽器測試通過，見 verification.md |
| `/admin/stores/[id]/employees` | `app/admin/stores/[id]/employees/page.tsx` | 已接原生 StoreEmployees：歷史月份、排序、離職篩選、搜尋、藥師與狀態、每月人員入口；1105 筆讀取與 UI 驗證通過，見 verification.md |
| `/admin/stores/[id]/promotion-management` | `app/admin/stores/[id]/promotion-management/page.tsx` | 已接原生編輯／Excel／驗證／交易儲存／草稿關閉；回滾、並行、重送與 UI 測試通過。已補到期實際排程、營業部／職稱／RBAC／RLS 邊界及 500 筆 UI 儲存驗證，見 verification.md |
| `/admin/stores/create` | `app/admin/stores/create/page.tsx` | 已原生化完整主檔、GPS、裝置定位與防重送；專用角色及 UI 新增驗證通過 |
| `/admin/stores/map` | `app/admin/stores/map/page.tsx` | 原生多點地圖／搜尋／選取／資訊窗／外連／停用權限已接；1005 筆與 SDK 替身測試通過。Google 實際底圖 RefererNotAllowedMapError，待使用者完成 localhost 網站限制後驗收 |
| `/admin/stores` | `app/admin/stores/page.tsx` | 部分原生：列表／搜尋／停用切換／最新人員統計已驗證；月別員工與主檔歷程已補；整合地圖與批次升遷仍待補 |
| `/admin/supervisors` | `app/admin/supervisors/page.tsx` | 已原生化清單、搜尋、統計、多店、代理確認／主責補位及兼任店長；交易、衝突、角色權限及瀏覽器流程通過，見 verification.md |
| `/admin/template/[id]` | `app/admin/template/[id]/page.tsx` | 已接管理明細與實際進度、排程、歷史、封存、複製及重新指派；刪除待補 |
| `/admin/templates` | `app/admin/templates/page.tsx` | 部分原生化：現行範本清單、全指派明細與整批封存；已接建立／編輯／複製／獨立派發；刪除及完整對等驗收待補 |
| `/admin/users` | `app/admin/users/page.tsx` | 已原生化；M5 P06 完成：「新增使用者」連到公開註冊頁、管理員直接建立已移除（Q12）、改成管理員前醒目確認（Q13）、重置密碼維持只有舊式管理員（Q14）、「待開通 N 位」標籤與篩選（Q15）、停用判定改為封鎖時間未到期；已核可差異見 tests/parity/allowlist.json m5-p06-*；上線前名單見 parity-plan/m5-sql/p06_*.sql |
| `/assignment/[id]` | `app/assignment/[id]/page.tsx` | 已接本人任務的原生勾選／備註／儲存；9 項整合與 4 項交易驗證通過；週甘特、協作提示及失敗復原已補；管理者非本人入口與其他角色分支待補 |
| `/cross-dept/maintenance` | `app/cross-dept/maintenance/page.tsx` | 待逐項盤點 |
| `/cross-dept/merchandise` | `app/cross-dept/merchandise/page.tsx` | 待逐項盤點 |
| `/cross-dept/products-master` | `app/cross-dept/products-master/page.tsx` | 待逐項盤點 |
| `/dashboard` | `app/dashboard/page.tsx` | 待逐項盤點 |
| `/forgot-password` | `app/forgot-password/page.tsx` | 待逐項盤點 |
| `/general-affairs/assets/scan/[token]` | `app/general-affairs/assets/scan/[token]/page.tsx` | 待逐項盤點 |
| `/general-affairs/equipment/categories` | `app/general-affairs/equipment/categories/page.tsx` | 待逐項盤點 |
| `/general-affairs/equipment/labels` | `app/general-affairs/equipment/labels/page.tsx` | 待逐項盤點 |
| `/general-affairs/equipment/maintenance-history` | `app/general-affairs/equipment/maintenance-history/page.tsx` | 待逐項盤點 |
| `/general-affairs/equipment/new` | `app/general-affairs/equipment/new/page.tsx` | 待逐項盤點 |
| `/general-affairs/equipment` | `app/general-affairs/equipment/page.tsx` | 待逐項盤點 |
| `/general-affairs/equipment/templates` | `app/general-affairs/equipment/templates/page.tsx` | 待逐項盤點 |
| `/general-affairs/equipment/warranties` | `app/general-affairs/equipment/warranties/page.tsx` | 待逐項盤點 |
| `/general-affairs/facilities/categories` | `app/general-affairs/facilities/categories/page.tsx` | 待逐項盤點 |
| `/general-affairs/facilities/maintenance-history` | `app/general-affairs/facilities/maintenance-history/page.tsx` | 待逐項盤點 |
| `/general-affairs/facilities/new` | `app/general-affairs/facilities/new/page.tsx` | 待逐項盤點 |
| `/general-affairs/facilities` | `app/general-affairs/facilities/page.tsx` | 待逐項盤點 |
| `/general-affairs/facilities/templates` | `app/general-affairs/facilities/templates/page.tsx` | 待逐項盤點 |
| `/general-affairs/facilities/warranties` | `app/general-affairs/facilities/warranties/page.tsx` | 待逐項盤點 |
| `/general-affairs/inventory/locations` | `app/general-affairs/inventory/locations/page.tsx` | 待逐項盤點 |
| `/general-affairs/inventory` | `app/general-affairs/inventory/page.tsx` | 待逐項盤點 |
| `/general-affairs/inventory/transfers` | `app/general-affairs/inventory/transfers/page.tsx` | 待逐項盤點 |
| `/general-affairs` | `app/general-affairs/page.tsx` | 待逐項盤點 |
| `/general-affairs/part-fulfillments` | `app/general-affairs/part-fulfillments/page.tsx` | 待逐項盤點 |
| `/general-affairs/part-requests/new` | `app/general-affairs/part-requests/new/page.tsx` | 待逐項盤點 |
| `/general-affairs/part-requests` | `app/general-affairs/part-requests/page.tsx` | 待逐項盤點 |
| `/general-affairs/parts/categories` | `app/general-affairs/parts/categories/page.tsx` | 待逐項盤點 |
| `/general-affairs/parts/compatibilities` | `app/general-affairs/parts/compatibilities/page.tsx` | 待逐項盤點 |
| `/general-affairs/parts/new` | `app/general-affairs/parts/new/page.tsx` | 待逐項盤點 |
| `/general-affairs/parts` | `app/general-affairs/parts/page.tsx` | 待逐項盤點 |
| `/general-affairs/reports/mine` | `app/general-affairs/reports/mine/page.tsx` | 待逐項盤點 |
| `/general-affairs/reports/new` | `app/general-affairs/reports/new/page.tsx` | 待逐項盤點 |
| `/general-affairs/requests` | `app/general-affairs/requests/page.tsx` | 待逐項盤點 |
| `/general-affairs/utility-bills` | `app/general-affairs/utility-bills/page.tsx` | 待逐項盤點 |
| `/general-affairs/utility-bills/report` | `app/general-affairs/utility-bills/report/page.tsx` | 待逐項盤點 |
| `/general-affairs/vendors/categories` | `app/general-affairs/vendors/categories/page.tsx` | 待逐項盤點 |
| `/general-affairs/vendors` | `app/general-affairs/vendors/page.tsx` | 待逐項盤點 |
| `/general-affairs/vendors/purchases` | `app/general-affairs/vendors/purchases/page.tsx` | 待逐項盤點 |
| `/general-affairs/vendors/regions` | `app/general-affairs/vendors/regions/page.tsx` | 待逐項盤點 |
| `/general-affairs/vendors/stats` | `app/general-affairs/vendors/stats/page.tsx` | 待逐項盤點 |
| `/general-affairs/work-orders` | `app/general-affairs/work-orders/page.tsx` | 待逐項盤點 |
| `/inspection/[id]/edit` | `app/inspection/[id]/edit/page.tsx` | 已原生化；細項驗證與剩餘範圍見首批巡店表 |
| `/inspection/[id]` | `app/inspection/[id]/page.tsx` | 已原生化；M4 W16 對等驗收完成（詳情畫面事實、A4 列印報表對照舊版 PrintInspectionReport、刪除範圍；已核可差異見 tests/parity/allowlist.json Q20–Q22） |
| `/inspection/compare` | `app/inspection/compare/page.tsx` | 已原生化；M4 P04 對等驗收完成（差異判定新舊同輸入同輸出、權限與門市範圍 Q23） |
| `/inspection/debug` | `app/inspection/debug/page.tsx` | **exclude**：除錯頁不復刻（決策 D13，M4 P04 登錄；舊站保留，不進 Vue 工作台） |
| `/inspection/diagnostic` | `app/inspection/diagnostic/page.tsx` | **exclude**：除錯頁不復刻（決策 D13，M4 P04 登錄；舊站保留，不進 Vue 工作台） |
| `/inspection/improvements/[id]` | `app/inspection/improvements/[id]/page.tsx` | 已原生化；M4 W17 對等驗收完成（回補台灣日期 Q17、寫入資格 Q18、逾期補報 Q19） |
| `/inspection/improvements` | `app/inspection/improvements/page.tsx` | 已原生化；M4 W17 對等驗收完成（查看範圍角色矩陣等價、急迫標示、連結） |
| `/inspection/new` | `app/inspection/new/page.tsx` | 已原生化；細項驗證與剩餘範圍見首批巡店表 |
| `/inspection` | `app/inspection/page.tsx` | 部分原生化；未完成對等驗收 |
| `/inspection/test-debug` | `app/inspection/test-debug/page.tsx` | **exclude**：除錯頁不復刻（決策 D13，M4 P04 登錄；舊站保留，不進 Vue 工作台） |
| `/inventory` | `app/inventory/page.tsx` | 部分原生化；結果分析可操作，但離線三模組、原因 Excel 匯入及完整分析／匯出未對等，見重查表 |
| `/login` | `app/login/page.tsx` | 待逐項盤點 |
| `/monthly-release` | `app/monthly-release/page.tsx` | 待逐項盤點 |
| `/monthly-status/edit/[id]` | `app/monthly-status/edit/[id]/page.tsx` | 部分原生化；未完成對等驗收 |
| `/monthly-status` | `app/monthly-status/page.tsx` | 本輪已補新增人員、獎金津貼、匯入、統計／支援時數與匯出；異動歷程與完整進階對等仍待驗收，見文末本輪表 |
| `/my-tasks` | `app/my-tasks/page.tsx` | 已接原生列表及篩選；本人範圍與開啟操作驗證通過，尚待空資料／失敗分支驗收 |
| `/organization/calendar` | `app/organization/calendar/page.tsx` | 已原生化；M5 W23／W24 完成：所有登入者可看（Q17）、月檢視與全年清單、公司行事新增／修改／取消與異動紀錄、個人行程與分享（搜尋排除停用離職，Q18）、政府假日匯入（再匯入前顯示差異並二次確認，Q21）、Google 單向同步（取消時真的刪除並加註，Q19；頁頂警示待同步與授權失效，Q20）；舊網址在 DEV 工作台環境轉新版、OAuth 回調網址不變；Google 在測試全程 mock（D17）；已核可差異見 tests/parity/allowlist.json m5-w23-*、m5-w24-*（個人行程新增的 RLS 修正待核可） |
| `/` | `app/page.tsx` | 待逐項盤點 |
| `/register` | `app/register/page.tsx` | 待逐項盤點 |
| `/reset-password` | `app/reset-password/page.tsx` | 待逐項盤點 |
| `/store/clinic-selfpay-margin` | `app/store/clinic-selfpay-margin/page.tsx` | 待逐項盤點 |
| `/store/relationship-members` | `app/store/relationship-members/page.tsx` | 已原生化會員維護/審核、銷售查詢與xlsx匯入；DEV隔離資料完整流程驗證通過 |
| `/supervisor-management-log` | `app/supervisor-management-log/page.tsx` | 待逐項盤點 |

### 2026-10-29 每月人員狀態：本輪功能補齊

| 使用者提出項目 | 本輪實作與驗證 |
| --- | --- |
| 活動檢視 | 原生 Vue 活動年度清單、權限內門市排程、目前門市篩選；沿用發布對象檢查。活動頁內人員配置、前置清單及部門發布內容不在本輪完成範圍。 |
| 匯入業績資料 | 原生 Excel 選檔、必填業績毛利檔與選填銷售毛利檔、月份／跨門市範圍說明、結果與略過／失敗明細。沿用既有解析與計算。 |
| 匯入門市統計 | 原生選檔、年月確認、成功／失敗筆數及錯誤明細。 |
| 手動新增員工 | 搜尋暫時候選或手填、職位／階段／出勤／藥師／備註、資料庫交易、重送防重複。 |
| 上個月單品獎金 | 額外單品獎金原生登記，沿用 support_staff_bonus；原人員上月單品獎金繼續顯示並依既有 PDF 規則合併。 |
| 交通費用 | 本月人員金額與原因，零元可清除原金額，不更動其他人員欄位。 |
| 誤餐費登記 | 人員、MM/DD、上班區間、餐別與身分；依既有報表計算金額。 |
| 育才獎金 | 人員、金額與育才對象；新增／修改／移除整批儲存。 |
| 春節出勤獎金 | 人員、日期、對象分類與金額；藥師 2500／主管 2000／專員 1500 沿用舊版預設，可修改金額。 |
| 匯出當月獎金／津貼 PDF | 與舊版共用報表產生器，完成實際下載及渲染檢查。另補上已確認人員 Excel 匯出。 |
| 送出審核 | 明確顯示送出審核、角色權限檢查；沿用新人階段檢查及既有提交／確認／退回流程。 |
| 門市每月統計資料 | 人數、營業天數、毛利、客數、處方張數，衍生數值沿用舊版公式；具權限可編輯。 |
| 本月門市支援時數 | 支援分店／分店支援分開編輯，不覆寫其他統計；具版本衝突防護。 |

驗證：Vue build、根目錄 TypeScript、DEV 真實 API 寫入／兩種 Excel 匯入／送審、資料庫整批失敗回滾及僅 service_role 可執行、錯誤來源／無權門市阻擋、UI 載入／關閉／失敗保留草稿、桌機與窄螢幕、PDF 實際下載。詳見 verification.md。此表不代表整個每月人員、活動或全站功能已完成全面對等；異動歷程入口、員工跨店業績展開、季度摘要與活動進階細項仍需依舊版逐項驗收。

2026-10-29 季度查詢更新：每月人員各式獎金明細內 Qx 獎金總額、該月業績內該季業績狀況已原生化，包含跨店獎金歸集、季度門檻與補差額、實績截止月份。API／計算與 UI 驗證見 verification.md「月明細的季度查詢補齊」。

2026-10-29 活動檢視後續更新：已補原生 Vue 門市促銷／盤點配置、本店與支援人員、人力預估、前置工作清單完成／店長回報、設備車次、行銷／商品部規劃內容。送審及確認後保留入口，沿用活動發布對象權限。真實盤點配置比對及空資料分支通過，其他非空內容採瀏覽器模擬驗證；未寫入資料庫。活動管理編輯、活動行事曆視覺／督導圖例／活動排程 PDF、清單勾選寫入仍未在此月結唯讀入口完成；詳見 verification.md。

2026-10-29 人員異動管理整合：新增單一原生入口，批次輸入／歷史紀錄／調店登記確認同頁切換，匯入、八類填寫範例下載及草稿匯出集中。權限與草稿保留、Excel 往返及UI驗證完成。批次實際提交已於同日後續補齊，詳見下方驗證；調店既有提交／確認維持可用。

2026-10-29 批次異動寫入完成（DEV）：八類異動改為先完整試跑回滾查核，再同頁核對並整批提交。RPC 原子寫入歷程／主檔／相關月資料／總部任職；版本核對、請求收據防重送、失敗草稿保留。補齊 DEV acting_manager 約束，同批依日期與列序支援入職後升職及復職後調店；保留月資料手填內容。實際 DEV SQL 回滾測試覆蓋八類、月底資料、失敗回滾、重試、未來日期及組織任職；UI 真查核／模擬提交回應測試確認重試識別碼、成功收據與清空下一批。正式區未變更。


## 2026-10-30 活動管理操作補齊（DEV）
本次更新取代上方活動管理尚缺編輯功能的舊紀錄；不代表其他模組全站對等驗收完成。

| 舊版工作 | 新版入口與行為 |
| --- | --- |
| 活動新增／編輯／刪除 | 清單內跳窗、關閉草稿提醒、版本核對刪除 |
| 門市星期限制／特殊日期 | 活動管理內設定跳窗、保存與刪除 |
| 活動排程 | 月曆拖放、手動日期、自動排程、整批保存／取消；保留既有排程 ID |
| 發布 | 督導／店長／盤點組分別發布與撤回 |
| 門市配置 | 促銷／盤點欄位、人員搜尋、備註、清空與保存 |
| 活動人力 | 本店名單、月度重載、支援需求與指派、人數預估、保存／取消 |
| 工作清單 | 新增／修改／刪除、拖放與上下排序、完成回報及店長備註 |
| 設備車次 | 月曆／列表、新增／修改／刪除 |
| 行銷／商品規劃 | 文字、圖片、商品配量附件、移除／下載及發布 |
| 規劃預覽 | 門市配置總表及完整規劃內容、列印／匯出 PDF |

新增與編輯活動均不增加工作頁籤。完整規劃仍使用活動專屬工作頁，分區內保存草稿；沿用 granular RBAC，DEV API 同源檢查，批次替換採交易及重送收據。驗證範圍見 verification.md。


2026-10-30 月結活動檢視後續：補回週一首欄行事曆、督導圖例、特殊日期、當日設備車次、門市點選明細跳窗、人力／支援／工作總覽與行銷商品快捷跳窗，排程PDF實際下載及渲染驗證。原規劃配置／人員資料保留並與舊reader比對；活動發布對象授權不變。本輪仍為資訊唯讀入口，未擴充此入口之指派／清單寫入權限。

2026-10-30 批次匯入員工原生化：側欄employee.import入口已切Vue，提供xls/xlsx範本下載、五欄驗證／逐列預覽／確認視窗／整批新增／收據。既有員編拒絕覆寫，正職在職預設與舊版一致；新增current_position同步以符合新版名冊。取代舊版逐列部分成功，採整批交易及requestId重送保護。DEV驗證詳見verification.md。

### 2026-10-30 盤點離線／分析新版
離線三工具與分析報表操作已移植；檔案、算法、原 API 讀取、模擬寫入介面與桌機／手機驗證通過。沿舊版授權與計算，不修改正式環境。詳見 verification.md。

### 2026-10-30 使用者管理
原生名冊、統計搜尋、編輯／新增／相容角色變更／密碼重置／刪除、RBAC明細（角色／有效權限／門市範圍／檢核）已完成。DEV真實臨時帳號完整建立至刪除測試通過並清除，既有11位使用者保持不變。角色權限管理已於後續同日完成原生移植。詳見 verification.md。

### 2026-10-30 關係會員
會員申請/編輯/核可/駁回/刪除與銷售報表/匯入完整移植為同工作頁兩分頁，短操作使用Modal。DEV schema補既有駁回遷移，隔離資料測試並清除，正式區不變。驗證範圍見verification.md。

## 2026-10-30 藥師管理
- `/admin/pharmacist-management` 已接原生 Pharmacists：督導區總覽、藥師主檔、月／年度關帳、手動新增、學經歷、會費與證明維護；同頁分頁與跳窗，不再連回舊版。
- 既有 RBAC 與門市範圍沿用；DEV缺少繳費證明儲存空間已補齊。年度主檔尚無基礎資料，與月度總覽分開維護，沒有自行複製正式資料。驗證詳見 verification.md。
- 2026-10-30 後續已依使用者授權補入三間門市的正式2026年度主檔9筆、profile9筆、會費7筆與附件7個；空白資料限制已解除。來源只讀、DEV事前備份、逐欄及附件雜湊驗證通過。

## 2026-10-30 員工購物管理
- `/admin/employee-purchases` 已接原生 EmployeePurchases：POS匯入、月份統計、職稱篩選、員工彙總排序、購物商品明細跳窗；不再連回舊頁。DEV缺少統計RPC已補齊，資料本身尚無正式複製；實際臨時Excel匯入與覆蓋已驗證並清除。

## M4 P04 排除登錄（exclude）

使用者決策 D13（2026-11-02）：以下除錯用頁面與 API 不復刻到 Vue 工作台，標記為 **exclude**，不列入對等驗收也不計入未完成項目。

| 路由／API | 來源 | 狀態 |
|---|---|---|
| `/inspection/debug` | `app/inspection/debug/page.tsx` | exclude |
| `/inspection/diagnostic` | `app/inspection/diagnostic/page.tsx` | exclude |
| `/inspection/test-debug` | `app/inspection/test-debug/page.tsx` | exclude |
| `/api/inspection-debug` | `app/api/inspection-debug/` | exclude |
