# 總務服務中心（二）：首頁、庫存、申請、回報、零件申請與出貨、工單、廠商、水電網費

## 領域共用缺口

- 整個領域在 Vue 工作台完全沒有原生復刻：vue-workspace/src/main.ts 路由只有 / 與 /work/:id；vue-workspace/src/pages 無 general-affairs 相關檔；僅 App.vue 把 /general-affairs 當 legacyQuick 連結（非整合模式指向 http://localhost:3002）。docs/vue-workspace/full-migration-checklist.md 這些列仍為『待逐項盤點』，與程式碼一致。
- app/api/workspace/** 沒有任何 general-affairs 端點；lib/workspace/modules.ts 只有 inventory（門市盤點，權限 inventory.*），與總務庫存（ga_inventory_*、general_affairs.inventory_*）是不同模組，請勿混用。需新增 general_affairs 模組權限守門與 workspace 代理／重寫 API。
- 需要建立的 workspace API 清單（對應舊 API）：access、inventory（options／balances／holding／transactions／post／locations／location parts／transfers／actions）、requests（列表／詳情／comments／comments read／store-actions／stock-issue／purchase-review／purchase-receipt）、request-targets、part-fulfillments（含 decision／store-confirmation／exception／documents）、purchase-reviews/cost-summary、utility-bills（含 report）、attachments、assets/scan、maintenance-requests／maintenance-updates／maintenance-photos／maintenance-progress-stages（工單）、user/managed-stores、vendors／service-categories／service-regions（目前舊版靠瀏覽器 supabase client 直連，沒有 API）。
- 共用 Vue 元件缺口：總務外殼與頁首（GeneralAffairsShell／PageHeader／PageState）、ResourceAttachmentPanel 附件上傳與預覽（含相機拍照、10 檔／20MB／圖片與 PDF 限制）、圖片燈箱、留言面板、事件時間軸、分頁表格、狀態徽章、列印版面（廠商填寫表、工單列印）。
- DEV 專用 SQL：supabase/workspace-dev/ 目前依 scripts/apply-workspace-*-dev.cjs 命名，未見總務庫存／需求單／廠商／水電費相關 apply 腳本；舊版總務 migration 已在 supabase/migrations（如 20260925103000_general_affairs_utility_bills.sql、20260824090000_general_affairs_vendor_permissions_rls.sql、20260724011554_production_legacy_general_affairs_maintenance_compatibility.sql）。復刻時需確認 DEV 庫已有 ga_* 表與 RLS，缺漏要補 DEV 專用 SQL。
- 權限／導覽：lib/workspace/navigation.ts 的『總務服務中心』群組只有『服務中心首頁』與『庫存管理』兩項且連回舊站；Vue 需補齊 reports/new、reports/mine、requests、work-orders、part-fulfillments、vendors 五子頁、utility-bills 兩頁的導覽項與可見性規則（沿用 GA_MAINTENANCE_MODULE_CODES／GA_WORK_ORDER_MODULE_CODES／vendor 相關代碼、storeManager 例外）。
- 舊版 Next.js 的 query 參數契約需保留：inventory/transfers 的 fromRequestId／requestNo／partId／quantity／sourceLocationId／destinationStoreId／reason／notes；reports/new 的 assetToken；reports/mine 的 status／requestId；part-fulfillments 的 fulfillmentId。Vue 使用 hash history（createWebHashHistory），需決定對應 hash 路由格式。
- 跨領域相依：設備／設施／料件主檔（另一領域『總務服務中心（一）』）提供需求單標的、料件目錄與 QR 掃描；本領域的需求單／庫存／料件處理／工單彼此相依，建議復刻順序：共用外殼與附件元件 → 位置與料件設定 → 庫存交易與餘額 → 調撥 → 需求單建立／我的追蹤 → 需求單工作台 → 料件處理中心 → 工單中心 → 廠商五頁 → 水電費兩頁 → 首頁（最後整合 KPI／待辦）。
- 測試現況：舊版有 scripts/test-general-affairs-*.js（單元／靜態與 DEV 整合，涵蓋庫存、調撥、需求單、採購評估、附件、水電費、廠商列印、角色矩陣），但沒有任何 Python Playwright 的 test-workspace-* 腳本涵蓋本領域；scripts/test-workspace-integration.py 只驗證導覽與另開舊頁。Vue 版需新建冒煙、單元、整合、e2e 與『舊新版一致性比對』測試。
- 一致性風險：需求單與工單有雙向同步（ga_service_requests ↔ maintenance_requests／maintenance_updates／maintenance_ticket_events，見 requests/[id]/route.ts 與 store-actions/route.ts），任何 Vue 版寫入必須走相同伺服端邏輯，不可只改單表。GeneralAffairsServiceCenterClient.tsx 同檔還含舊維修回報（maintenance）與 equipment／facilities／parts 區塊，不屬本領域，但與工單區共用 state 與函式，拆分時需小心。

## /general-affairs

- 狀態：**missing**（M）— vue-workspace/src 內沒有任何 general-affairs 頁面；main.ts 路由只有 / 與 /work/:id；App.vue 的 legacyQuick 僅把 /general-affairs 當連結導回舊站（非整合時指向 localhost:3002）。lib/workspace/navigation.ts 只放「服務中心首頁」入口，指向舊站頁面。scripts/test-workspace-integration.py 也只驗證『另開原總務頁』。
- 舊版：`app/general-affairs/page.tsx -> components/general-affairs/dashboard/GeneralAffairsHomeClient.tsx + GeneralAffairsDashboardClient.tsx（外層 app/general-affairs/layout.tsx 使用 GeneralAffairsShell／Sidebar）`
- Vue：（無）
- 權限：general_affairs.service_center.access、general_affairs.inventory_balance.view、general_affairs.inventory_transaction.view/manage、general_affairs.inventory_location.view/manage、general_affairs.equipment.view/manage、general_affairs.facility.view/manage、general_affairs.part.view/manage、general_affairs.vendor.view/manage、service_category.view/manage、service_region.view/manage、cooperation_record.view、general_affairs.maintenance_request.create/view_all/update、work_order.*、service_center.force_close、general_affairs.request.create/view_own_store/view_all/manage（待辦資料）
- 相依：總務共用外殼（Shell／側欄／PageHeader／狀態元件的 Vue 版）、庫存餘額／流水 workspace API、需求單列表 workspace API

**舊版功能**

- 載入 /api/user/profile 與 /api/permissions/user，未登入或缺 general_affairs.service_center.access 顯示無權限頁
- 庫存摘要 KPI：庫存餘額項目數、近 7 日庫存異動、可用位置料件、負庫存項目（各自可連到庫存／位置頁）
- 可用功能入口卡片（依權限顯示）：新增需求、我的追蹤、總務需求工作台、庫存管理、庫存位置、設備管理、設施管理、料件管理、廠商資料、工單中心
- 我的待辦：呼叫 /api/general-affairs/requests 取待門市確認／待補資料等項目，連到 /reports/mine?status=&requestId=
- 庫存待辦（負庫存等）與無待辦空狀態、部分資料載入失敗提示、載入／錯誤狀態元件
- 小型庫存餘額／流水預覽（呼叫 inventory/balances、transactions、options）

**缺少或不同**

- 整頁尚無 Vue 版（vue-workspace/src/pages 下無對應檔，grep general 只命中 App.vue 與 Users.vue 權限標籤）
- 沒有 app/api/workspace/** 的 general-affairs 端點；lib/workspace/modules.ts 只有 inventory（門市盤點，不同模組）而無 general_affairs 模組
- navigation.ts 的 ga.items[0].allowed 包含 storeManager 與 maintenance/work-order/service_category/service_region/cooperation_record 等代碼，Vue 首頁需沿用相同可見性規則
- 舊版首頁『廠商資料』連結 href 是 /general-affairs?section=vendors，但 app/general-affairs/page.tsx 並未讀取 section 參數（可能是舊站既有不一致，uncertain，復刻時需決定導向 /vendors）

**業務規則**

- 缺 service_center.access 一律顯示無權限（即使有其他總務權限）
- 入口卡片是否顯示取決於 hasAnyPermission 組合（見 GeneralAffairsHomeClient canAccess* 計算）
- 門市待辦依狀態導向 /reports/mine 的 status 篩選

**API**：舊 /api/user/profile、/api/permissions/user、/api/general-affairs/requests、/api/general-affairs/inventory/balances、/api/general-affairs/inventory/transactions、/api/general-affairs/inventory/options、/api/general-affairs/access；新 —

**資料表**：ga_inventory_balances、ga_inventory_transactions、ga_inventory_locations、ga_service_requests、profiles

**既有測試**：scripts/test-general-affairs-dashboard-ui.js、scripts/test-general-affairs-availability.js、scripts/test-general-affairs-ui-foundation.js、scripts/test-workspace-integration.py（僅驗證導覽與另開舊頁）

**待確認**

- 舊版 Shell 的側欄導覽內容（components/general-affairs/GeneralAffairsSidebar.tsx、navigation.tsx）未逐行比對，Vue 是否要保留二層側欄待決定

### 測試案例

**冒煙**

- ga_admin 開 #/general-affairs：200、無 console error/pageerror，四張 KPI（庫存餘額項目數、近 7 日異動、可用位置料件、負庫存項目）皆顯示數字非 NaN/空白
- ga_no_access（有 inventory_balance.view 但缺 service_center.access）開啟：顯示無權限頁，不呼叫 inventory/requests API（攔截 network 斷言 0 次）
- plain_staff：Vue 側欄不顯示『總務服務中心』群組；store_mgr_A：側欄顯示『服務中心首頁』（navigation.ts ga.items 對 storeManager 的例外）
- 入口卡片依權限顯示：ga_viewer 看得到庫存管理/庫存位置/廠商資料、看不到『新增需求』（無 request.create）；store_mgr_A 看得到新增需求、我的追蹤
- 資料部分失敗：攔截 inventory/transactions 回 500，頁面仍渲染其他區塊並顯示『部分資料載入失敗』提示

**單元**

- 抽出 GeneralAffairsHomeClient 的 canAccess* 計算為 lib/workspace/general-affairs/home.ts:computeHomeEntryVisibility(permissionSet, isStoreManager)，以 8 組權限組合（ga_admin、ga_viewer、store_mgr、ga_no_access、僅 vendor.view、僅 work_order.view_own_store、僅 cross_dept.maintenance.view_all、空集合）斷言 10 張卡片顯示布林值與舊版逐一相同
- KPI 彙總函式 summarizeInventoryKpis(balances, transactions, now)：近 7 日邊界（第 7 天 00:00 台北時區含/不含）、負庫存只計 quantity_base<0、可用位置料件計數
- 待辦導向 buildMyTodoLink(request)：WAITING_STORE_CONFIRMATION / WAITING_STORE_SUPPLEMENT 產生 /reports/mine?status=&requestId= 的 Vue hash 等價網址，參數編碼一致
- 廠商卡片連結：決策後固定導向 vendors 頁（舊版 ?section=vendors 未被 page.tsx 讀取），單元斷言新 href

**整合**

- GET /api/workspace/general-affairs/access 角色矩陣：ga_admin 200 且 serviceCenterAccess=true；ga_no_access 200 且 false 或 403（需與舊 /api/general-affairs/access 相同）；未登入 401
- 首頁彙總 API（或前端並行呼叫 balances/transactions/requests）對 store_mgr_A 只回門市 A 的待辦，store_mgr_B 看不到 A 的 QA-GA2 需求單（跨門市隔離）
- ga_viewer 呼叫首頁所需 API 全 200，但任何寫入端點 403
- DEV 缺表模擬不可做（只讀規則），改為：攔截回應錯誤碼 PGRST205 時 UI 顯示的訊息與舊版相同（以 route mock 驗證）

**E2E**

- store_mgr_A 登入 → 首頁 → 我的待辦列出 QA-GA2 待確認單 → 點擊進入 #/general-affairs/reports/mine?status=WAITING_STORE_CONFIRMATION&requestId=<id> 且詳情自動展開該單
- ga_admin 首頁 → 點『負庫存項目』KPI → 進入庫存頁且已套負庫存篩選 → 返回首頁 KPI 不變
- ga_admin 依序點擊每一張入口卡片，確認都導到對應 Vue 路由（非舊站 localhost:3002）且頁面標題正確

**對等驗證**

- 同帳號（ga_admin、store_mgr_A）分別開舊 /general-affairs 與 Vue 首頁，抽取四個 KPI 數字、入口卡片標題清單、我的待辦清單（單號序列）逐一相等
- 權限矩陣 11 個角色 × 首頁可見性（顯示無權限/顯示卡片集合）舊新一致，結果輸出 .tmp-check/ga2-home-parity.json

**測試資料**

- 門市 A、B 各 1 個 STORE 位置；中央總倉 1 個
- 至少 1 筆負庫存餘額（位置 allow_negative_stock=true）與 7 日內 3 筆、8 日前 1 筆交易（驗證 7 日邊界）
- store_mgr_A 的 2 筆需求單：WAITING_STORE_CONFIRMATION、WAITING_STORE_SUPPLEMENT；門市 B 1 筆同狀態（隔離用）
- 角色帳號：ga_admin、ga_viewer、ga_no_access、store_mgr_A、store_mgr_B、plain_staff

**風險**

- 首頁依賴幾乎所有子領域 API，應最後完成，否則測試只能 mock
- 舊版廠商卡片 href 不一致，parity 比對需排除此差異並記錄決策

## /general-affairs/inventory

- 狀態：**missing**（L）— 沒有對應 Vue 頁。vue-workspace/src/pages/Inventory.vue 與 app/api/workspace/inventory/route.ts 是『門市盤點（inventory.* 權限，代理 /api/inventory/result-analysis）』模組，與總務庫存（ga_inventory_*）完全不同，不可視為已復刻。
- 舊版：`app/general-affairs/inventory/page.tsx -> components/general-affairs/inventory/InventoryTransactionsClient.tsx`
- Vue：（無）
- 權限：general_affairs.inventory_balance.view、general_affairs.inventory_transaction.view、general_affairs.inventory_transaction.manage（過帳）、general_affairs.part.view（交易需讀料件目錄）、可見範圍受管理門市限制（UI 文案：只能查看所管理門市範圍內資料）
- 相依：總務共用外殼、workspace 庫存餘額／交易／持有狀態 API、位置與料件設定（供選單）

**舊版功能**

- 四張摘要卡：可見庫存位置、可交易料件、目前餘額筆數、負庫存筆數（紅底警示）
- 料件持有狀態區：實際持有／使用中／閒置可調撥／待確認 彙總與 Top3 可調撥，按鈕篩選 IN_USE／IDLE／UNCLASSIFIED，清除篩選，連到建立調撥
- 庫存餘額表：搜尋位置或料件、分頁、持有狀態欄、每列『調整料件狀態』（使用中／閒置數量＋備註，PATCH balances/{id}/holding）
- 新增庫存交易表單：交易類型 RECEIPT（入庫）／ISSUE（出庫）／ADJUST_IN／ADJUST_OUT，選位置→選料件→數量→單位（基本／採購）→原因（必填）→備註；idempotencyKey 防重送；顯示所選料件目前餘額
- 庫存流水表：交易類型篩選、料件篩選（受位置篩選連動）、流水號／類型／位置料件／異動（正綠負紅）／庫存前後／原因／時間，顯示總筆數與最新一筆
- 重新整理按鈕；子頁籤『庫存交易與餘額』『位置與料件設定』
- 無餘額查看權限提示、partCatalogAccess=false（無 part.view）時禁止交易、錯誤／成功訊息

**缺少或不同**

- 整頁缺 Vue 版與 workspace API（app/api/workspace 下無 general-affairs 或 ga 端點）
- lib/workspace/navigation.ts 的『庫存管理』項目指向舊站 /general-affairs/inventory

**業務規則**

- 交易過帳走 /inventory/transactions/post，使用 idempotencyKey 防止重複
- 負庫存是否允許取決於位置的 allow_negative_stock
- 持有狀態拆分：in_use／idle／unclassified，僅對 quantity_base>0 的列計入
- 基本單位與採購單位換算（purchase_to_base_rate）
- 出庫類型時需有 part.view 才可提交（canSubmit 需 partCatalogAccess）

**API**：舊 /api/general-affairs/inventory/options、/api/general-affairs/inventory/balances、/api/general-affairs/inventory/balances/[id]/holding、/api/general-affairs/inventory/transactions、/api/general-affairs/inventory/transactions/post；新 —

**資料表**：ga_inventory_balances、ga_inventory_transactions、ga_inventory_locations、ga_inventory_location_parts、ga_inventory_holding_allocations、ga_parts

**既有測試**：scripts/test-general-affairs-inventory-ui.js、scripts/test-general-affairs-inventory-transactions-foundation.js、scripts/test-general-affairs-inventory-transactions-dev.js、scripts/test-general-affairs-inventory-transactions-api-dev.js、scripts/test-general-affairs-part-holding-status.js

**待確認**

- 餘額 API 的分頁／排序參數完整清單未全部讀完（balances/route.ts 149 行）

### 測試案例

**冒煙**

- ga_inventory_clerk 開 #/general-affairs/inventory：四張摘要卡、持有狀態區、餘額表、交易表單、流水表皆渲染，無 console error
- 負庫存摘要卡在有負庫存時為紅底警示 class
- ga_viewer：交易表單不可提交（無 transaction.manage），餘額表無『調整料件狀態』按鈕
- ga_no_part：交易表單停用並顯示需料件目錄權限提示（partCatalogAccess=false）
- 無 inventory_balance.view 的帳號顯示無餘額查看權限提示

**單元**

- 直接 import lib/general-affairs/inventory/transactions/validation.ts:validateInventoryTransactionPostPayload：RECEIPT/ISSUE/ADJUST_IN/ADJUST_OUT 合法；未知類型、quantity<=0、缺 reason、非 UUID location/part、缺 idempotencyKey 各拋錯，錯誤訊息與舊版相同
- getPagination(searchParams)：page/pageSize 缺省、負數、超大值的夾限結果
- validateDateParam / parseBooleanParam / validateOptionalUuidParam 邊界值
- 抽出持有狀態彙總 summarizeHolding(balances)：只計 quantity_base>0、in_use+idle+unclassified 拆分、Top3 可調撥排序（idle 由大到小，同值依名稱）
- 單位換算 toBaseQuantity(qty, unitType, part)：PURCHASE 乘 purchase_to_base_rate、缺 rate 時拋錯；顯示用 numberText 小數位
- lib/general-affairs/inventory/transactions/api.ts:maskIdempotencyKey 與 extractInventoryError 將 RPC 錯誤碼（如負庫存不足）映射為相同 HTTP status 與訊息

**整合**

- POST /api/workspace/general-affairs/inventory/transactions/post（RECEIPT 10）→ DB：ga_inventory_transactions 新增 1 筆、balances.quantity_base +10、quantity_before/after 正確
- 同一 idempotencyKey 連續送 2 次（並行 Promise.all）：只產生 1 筆交易，第二次回傳同一交易（冪等）
- ISSUE 超過餘額：位置 allow_negative_stock=false → 4xx 且餘額不變；=true → 成功且餘額為負
- PATCH balances/{id}/holding：in_use+idle 超過 quantity_base → 4xx；合法值寫入 ga_inventory_holding_allocations
- 角色矩陣：ga_inventory_clerk 200；ga_viewer 讀 200/寫 403；ga_no_part 寫 403；store_mgr_A 只看得到門市 A 位置的餘額，帶門市 B locationId 查詢回空或 403（與舊 API 相同）；未登入 401
- 流水篩選：transactionType + partId + locationId 組合結果筆數與舊 API 相同

**E2E**

- ga_inventory_clerk：選位置→選料件（顯示目前餘額）→ RECEIPT 數量 5 基本單位、原因 QA-GA2 入庫 → 送出 → 成功訊息 → 流水表第一列為新交易（綠色 +5）→ 摘要卡數字更新
- 同流程用採購單位（rate=12）入庫 1 → 流水顯示 +12 基本單位
- 餘額表搜尋料件名 → 點『調整料件狀態』設使用中 3、閒置 2 → 持有狀態區數字更新 → 點『閒置可調撥』篩選 → 只剩 idle>0 列 → 清除篩選
- 快速雙擊送出按鈕：DB 只增加 1 筆交易
- 持有狀態區點『建立調撥』導向 #/general-affairs/inventory/transfers 並帶 partId/sourceLocationId

**對等驗證**

- 同帳號呼叫舊 /api/general-affairs/inventory/{options,balances,transactions} 與 workspace 版，正規化後 deep-equal（含分頁 meta.total）
- 寫入 parity：L/V 兩份相同位置料件各執行 RECEIPT 10 → ISSUE 3 → ADJUST_OUT 1 → holding(in_use 2, idle 4)，比對兩邊交易序列（type、delta、before、after）與 holding 列完全相同
- 畫面 parity：四張摘要卡數字、持有狀態四項彙總、流水表前 20 列（類型、位置料件、異動、前後量）文字一致

**測試資料**

- 位置：QA-GA2-STORE-A（allow_negative_stock=false）、QA-GA2-CW（中央總倉，allow_negative_stock=true）
- 料件 2 種：基本單位『個』；其中 1 種 purchase_unit『箱』purchase_to_base_rate=12；兩位置皆已設定 location_parts
- 初始餘額：STORE-A 料件1 = 20、CW 料件2 = 0
- 角色：ga_inventory_clerk、ga_viewer、ga_no_part、store_mgr_A、store_mgr_B

**風險**

- 必須經 RPC ga_post_inventory_transaction，Vue API 若自行 update 餘額會破壞前後量與冪等
- balances 分頁/排序參數未完整盤點（uncertain），parity 比對前先讀完 balances/route.ts

## /general-affairs/inventory/locations

- 狀態：**missing**（L）— 無 Vue 頁與 workspace API。
- 舊版：`app/general-affairs/inventory/locations/page.tsx -> components/general-affairs/inventory/InventoryLocationsClient.tsx`
- Vue：（無）
- 權限：general_affairs.inventory_location.view、general_affairs.inventory_location.manage
- 相依：料件主檔讀取 API（/parts，屬另一領域『料件管理』）、門市清單 API

**舊版功能**

- 位置清單：搜尋（名稱／代碼／描述）、類型標籤（中央總倉／門市／辦公室／暫存／其他）、啟用狀態、預設、允許負庫存標示、分頁
- 新增／編輯位置對話框：類型、名稱*、代碼、門市（僅 STORE 類型，必選）、啟用、預設位置（僅啟用且 STORE／CENTRAL_WAREHOUSE 可勾）、允許負庫存、描述
- 軟刪除位置（需 manage 權限）
- 位置料件設定（編輯時顯示）：列出料件、安全庫存／補貨點／最高庫存、偏好領用單位（基本／採購）與解析後單位、啟用狀態、新增／編輯／軟刪除位置料件
- 未儲存變更離開確認（confirm）
- 無權限畫面，只讀模式（無 manage 時欄位 disabled、隱藏操作欄）
- 權限檢查呼叫 /api/permissions/check（inventory_location.manage），門市／料件清單取用 supabase client 與 /api/general-affairs/parts

**缺少或不同**

- 整頁缺 Vue 版與 workspace API
- 舊版直接用瀏覽器端 supabase client 讀 stores，Vue 版需改由 workspace API 提供

**業務規則**

- STORE 類型必須指定門市，canSubmit = name 且（非 STORE 或有 store_id）
- 預設位置限制為啟用且類型 STORE／CENTRAL_WAREHOUSE
- 刪除為 soft delete
- 安全／補貨／最高庫存為非負數，step 0.0001

**API**：舊 /api/general-affairs/inventory/locations、/api/general-affairs/inventory/locations/[id]、/api/general-affairs/inventory/locations/[id]/parts、/api/general-affairs/inventory/locations/[id]/parts/[locationPartId]、/api/general-affairs/parts、/api/permissions/check；新 —

**資料表**：ga_inventory_locations、ga_inventory_location_parts、ga_parts、stores

**既有測試**：scripts/test-general-affairs-inventory-locations.js、scripts/test-general-affairs-inventory-locations-dev.js、scripts/test-general-affairs-inventory-ui.js

**待確認**

- 列表是否有類型／狀態篩選下拉未全部確認（已見搜尋框）

### 測試案例

**冒煙**

- ga_inventory_clerk 開 #/general-affairs/inventory/locations：清單、搜尋框、分頁顯示，類型標籤中文正確
- ga_viewer：唯讀模式，對話框欄位 disabled、無操作欄、無新增按鈕
- 無 inventory_location.view：顯示無權限畫面
- 開啟編輯對話框時下方載入位置料件設定區

**單元**

- lib/general-affairs/inventory/locations/validation.ts:validateInventoryLocationPayload：STORE 類型缺 store_id 拋錯；is_default=true 但 is_active=false 或類型 OFFICE 拋錯；partial 模式只驗傳入欄位
- validateInventoryLocationPartPayload：safety/reorder/max 負數拋錯、0.0001 精度接受、preferred unit 只允許 BASE/PURCHASE
- validateDeletionReason：空字串、超長
- 抽出前端 canSubmit(form)=name && (type!=='STORE' || store_id) 與 canSetDefault(form) 並對照舊元件行為
- resolvePreferredUnit(locationPart, part)：PURCHASE 但料件無 purchase_unit 時回退基本單位的顯示文字

**整合**

- POST locations（STORE + 門市 A）→ 201 並寫 ga_inventory_locations；STORE 無 store_id → 400
- PATCH locations/{id} 設 is_default=true：同門市原預設位置被取消（若舊 RPC/trigger 如此，需先讀確認）
- DELETE locations/{id}：經 ga_soft_delete_inventory_location，deleted_at 有值，列表不再出現；有餘額時的錯誤行為與舊 API 相同
- location parts CRUD：新增、更新安全庫存、軟刪除；重複新增同料件 → 與舊版相同錯誤碼
- 角色矩陣：manage 200；view 寫入 403；無權 403；未登入 401；store_mgr 是否可讀需與舊 API 結果一致
- 門市清單改由 workspace API 提供：結果與舊版 supabase client 查 stores（is_active）相同

**E2E**

- 新增 STORE 位置：選類型門市 → 不選門市時送出鈕 disabled → 選門市 A → 勾預設 → 儲存 → 清單出現且有『預設』標示
- 編輯位置 → 新增位置料件（安全 5、補貨 8、最高 20、偏好採購單位）→ 儲存 → 重開對話框數值保留
- 修改欄位後按關閉 → 出現未儲存確認 → 取消停留 / 確認離開
- 軟刪除位置料件與位置 → 清單消失，搜尋不到

**對等驗證**

- 舊 /api/general-affairs/inventory/locations 與 workspace 版列表（含搜尋 q、分頁）正規化比對
- L/V 各建立相同位置與 2 筆位置料件、各刪 1 筆，比對 DB 欄位（type、store_id、is_default、allow_negative_stock、safety/reorder/max、deleted_at 是否有值）
- 角色矩陣 HTTP status 舊新一致

**測試資料**

- 門市 A、B（stores.is_active=true）；QA-GA2 料件 3 種（1 種有採購單位）
- 既有位置：門市 A 預設 STORE 位置 1 個、OFFICE 1 個
- 角色：ga_inventory_clerk、ga_viewer、plain_staff、store_mgr_A

**風險**

- 舊版前端直接以 supabase client 讀 stores，Vue 版改 API 後可見範圍可能因 RLS 差異而不同

## /general-affairs/inventory/transfers

- 狀態：**missing**（L）— 無 Vue 頁與 workspace API。lib/workspace/transfers.ts 與 Vue 的 Transfer*.vue 是『人員調店』模組，與庫存調撥無關。
- 舊版：`app/general-affairs/inventory/transfers/page.tsx（讀取 query: fromRequestId/requestNo/partId/quantity/sourceLocationId/destinationStoreId/reason/notes 作為預填）-> components/general-affairs/inventory/InventoryTransfersClient.tsx`
- Vue：（無）
- 權限：general_affairs.inventory_transfer.view/manage、general_affairs.inventory_transaction.view/manage（亦被視為可讀／可管理）、general_affairs.inventory_balance.view、general_affairs.part.view（建立調撥必要，缺少時 API 403）
- 相依：位置與料件設定頁、庫存交易（過帳）共用邏輯、需求單工作台（轉調撥來源）

**舊版功能**

- 建立調撥單表單：來源位置*、目的位置*（不可同來源）、調撥料件*（依來源位置的料件）、顯示來源目前庫存、目的位置未啟用此料件時紅色警示、數量*、單位（基本／採購）、調撥原因*、運送方式（未定／總務配送／門市人員帶回／物流寄送／廠商直送）、備註
- URL 預填（來自需求單『轉調撥』：fromRequestId、requestNo、partId、quantity、sourceLocationId、destinationStoreId、reason、notes）
- 狀態卡片摘要（待來源確認／已交出／運送中／已收貨／已取消或異常）可點擊篩選，狀態下拉，搜尋（調撥單號等）
- 調撥單列表卡：下一步提示（確認交出／運送中或確認收貨／確認收貨／完成／異常／取消）
- 動作：CONFIRM_SOURCE（確認交出，扣來源庫存）、MARK_IN_TRANSIT、RECEIVE（確認收貨，需 confirm，增加目的庫存）、CANCEL（prompt 取消原因）
- 異常登記（少收等 TRANSFER_EXCEPTION_TYPES＋備註，以 cancel_reason『調撥異常：類型｜備註』儲存）
- 調撥明細表：已扣庫存／待交出、已入庫／待收貨
- 重新整理、連到庫存總覽與位置設定

**缺少或不同**

- 整頁缺 Vue 版與 workspace API
- 需求單→調撥的 query 預填契約需在 Vue 路由保留

**業務規則**

- 狀態流：REQUESTED → SOURCE_CONFIRMED（扣來源庫存）→ IN_TRANSIT → RECEIVED（目的入庫）；可 CANCEL
- 目的庫存只在收貨時增加
- 異常以 cancel_reason 前綴『調撥異常：』編碼，前端解析
- 目的位置必須已設定該料件
- 單位換算：採購單位需 purchase_unit 與 purchase_to_base_rate

**API**：舊 /api/general-affairs/inventory/options、/api/general-affairs/inventory/transfers、/api/general-affairs/inventory/transfers/[id]/actions；新 —

**資料表**：ga_inventory_transfers、ga_inventory_transfer_items、ga_inventory_locations、ga_inventory_location_parts、ga_inventory_balances、ga_inventory_transactions、ga_parts

**既有測試**：scripts/test-general-affairs-inventory-transfers.js、scripts/test-general-affairs-inventory-ui.js

**待確認**

- actions/route.ts 的各動作權限細節與冪等處理（230 行）未逐行確認

### 測試案例

**冒煙**

- ga_inventory_clerk 開 #/general-affairs/inventory/transfers：狀態卡片、列表、建立表單渲染
- 帶完整 query 預填（fromRequestId、requestNo、partId、quantity、sourceLocationId、destinationStoreId、reason、notes）開啟，表單欄位已預填
- ga_no_part：建立表單停用（API 會 403）；ga_viewer：無動作按鈕

**單元**

- lib/general-affairs/inventory/transfers/validation.ts:validateInventoryTransferCreatePayload：來源=目的拋錯、quantity<=0、缺 reason、delivery_method 非列舉
- validateInventoryTransferActionPayload：CONFIRM_SOURCE/MARK_IN_TRANSIT/RECEIVE/CANCEL，CANCEL 缺 reason 拋錯
- 抽出 parseTransferException(cancelReason)（InventoryTransfersClient.tsx 225 行）：'調撥異常：少收｜備註｜含分隔' → type 少收、note 保留後段分隔符；未知類型→'取消'；非前綴→null
- transferStep(transfer) 各狀態下一步文字與 action 與舊版相同
- parseTransferPrefillQuery(hashQuery)：Vue hash 路由 query 解析結果等同舊 searchParams，含中文 reason 編碼
- statusSummary(transfers)：五類卡片計數（取消與異常合併規則）

**整合**

- 建立調撥（REQUESTED）→ CONFIRM_SOURCE：來源 ga_inventory_transactions 出現扣庫交易、來源餘額減少、目的不變
- MARK_IN_TRANSIT → RECEIVE：目的入庫交易、目的餘額增加；transfer_items 已扣/已入數量更新
- 非法轉移：REQUESTED 直接 RECEIVE、RECEIVED 後 CANCEL → 4xx 且庫存不變（以舊 API 行為為準）
- 並行：兩個 context 同時 CONFIRM_SOURCE 同一張 → 只扣一次庫存
- 目的位置未設定該料件 → 建立被拒（與舊 API 相同錯誤）
- 角色矩陣：inventory_transfer.manage 200；inventory_transaction.manage 亦可管理；view 寫 403；缺 part.view 建立 403；未登入 401

**E2E**

- 從需求單工作台『轉調撥』按鈕進入（或直接帶 query）→ 預填檢查 → 送出 → 列表出現新單，狀態待來源確認
- 點『確認交出』→ 狀態已交出 → 『運送中』→ 『確認收貨』（confirm 對話框接受）→ 已收貨；前往庫存頁確認兩位置餘額變化
- 另一張單登記異常『少收』+ 備註 → 卡片顯示『異常：少收』與備註
- 取消調撥（prompt 填原因）→ 狀態已取消；點狀態卡片篩選只顯示對應狀態

**對等驗證**

- L/V 兩份相同 seed 各跑 建立→CONFIRM_SOURCE→IN_TRANSIT→RECEIVE，比對 transfer 狀態序列、transfer_items 數量、兩筆庫存交易（type/delta/before/after）
- 異常/取消的 cancel_reason 字串逐字相同
- 列表 API 與狀態卡片計數舊新一致

**測試資料**

- 來源 QA-GA2-CW 料件1 餘額 50；目的門市 A 位置已設定料件1；門市 B 位置未設定料件1（警示用）
- 1 筆 QA-GA2 需求單（PURCHASE_SUPPLEMENT，part_id=料件1，desired_quantity=3）作為預填來源
- 角色：ga_inventory_clerk、ga_viewer、ga_no_part、只有 inventory_transaction.manage 的帳號

**風險**

- actions/route.ts 各動作權限與冪等未逐行確認（uncertain），先讀再寫斷言
- hash 路由下 query 參數格式需與工作台、料件中心產生的連結一致

## /general-affairs/requests

- 狀態：**missing**（XL）— 無 Vue 頁、無 workspace API。
- 舊版：`app/general-affairs/requests/page.tsx -> components/general-affairs/requests/ServiceRequestIntakeClient.tsx（3448 行）+ PartFulfillmentRequestBridge.tsx + PartFulfillmentExecutionPanel.tsx`
- Vue：（無）
- 權限：general_affairs.request.view_all / manage（工作台）、general_affairs.request.view_own_store、comment_own_store、confirm_own_store（門市端）、general_affairs.purchase_review.view/manage（採購評估）、general_affairs.inventory_transaction.manage（出庫、到貨入庫）、general_affairs.inventory_transfer.manage（轉調撥）、general_affairs.part_fulfillment.view/manage（料件處理橋接）、導覽可見性：maintenance_request.* 與 work_order.*（GA_MAINTENANCE_MODULE_CODES）
- 相依：附件面板／圖片燈箱共用元件、庫存位置與餘額 API、廠商讀取、料件處理中心、工單中心（維修派工交接）、設備／設施主檔（屬其他領域）

**舊版功能**

- 需求單工作台列表：狀態篩選（待受理／待總務複核／待補資料／已受理／處理中／待門市確認／已完成／已駁回／已取消／全部）、焦點篩選（需受理／門市回覆／料件處理／待確認）、搜尋、分頁，列表含設備入帳複核任務（equipment onboarding review）
- 需求類型標籤：REPAIR 維修、PURCHASE_SUPPLEMENT 添購補充、ASSIGNED_RESPONSE 總務要求回覆；資源類型 設備／設施／料件／庶務用品／未建主檔物品
- 詳情側欄：門市友善摘要（現場描述、問題類型、位置、影響、暫時處理方式）、附件預覽、公開／內部留言（新增、編輯、刪除需確認、已讀標記、附件上傳）、事件時間軸
- 受理（受理給總務／工務，選處理路徑：維修派工／添購採購評估／庫存出庫／調撥處理／資產異動）、駁回（原因下拉：不屬範圍／資料不足／重複／不符條件／已有替代／其他＋說明）、補資料（類型：照片不清楚／缺照片／描述不足／設備選擇錯誤／數量規格不足／其他）、轉派（assign，註明保留未來串接）、更新處理中、送門市確認
- 庫存出庫（stock-issue）：選來源位置、數量不得超過剩餘需求量、冪等 key
- 採購評估（purchase-review）：決策 進入採購／改庫存出庫／改調撥／改用替代品／駁回；記錄供應商、報價（多筆 quotes）、議價、核准數量、到貨方式、預估金額、預計到貨日
- 採購到貨入庫（purchase-receipt）：選入庫位置、數量，入庫後送門市確認
- 維修派工受理後交接至工單中心（shouldHandOffToWorkOrderCenter）
- 建立調撥預填連結（buildTransferPrefillUrl）導向庫存調撥頁
- 料件後續處理橋接：建立料件處理單（交給料件處理中心）、顯示處理進度與連結單據（出庫單／調撥單／採購單）、前往料件處理中心
- 設備入帳複核（POST equipment/{id}/onboarding-review）
- 金額／百分比格式化、成本摘要

**缺少或不同**

- 整頁缺 Vue 版與 workspace API
- 需求單相關 11 支 API route（requests、[id]、comments、comments/read、comments/[commentId]、store-actions、stock-issue、purchase-review、purchase-receipt）皆無 workspace 版

**業務規則**

- ACTIVE_ACTIONS_BY_STATUS：PENDING_INTAKE／WAITING_GA_REVIEW 可 受理／駁回／補資料／轉派；ACCEPTED／IN_PROGRESS 可 更新處理中／送門市確認／補資料／轉派；WAITING_STORE_SUPPLEMENT 僅轉派；WAITING_STORE_CONFIRMATION 可更新處理中／轉派
- 駁回必須選原因，補資料必須選類型並說明
- 維修派工受理後進入 maintenance_requests 工單流（API 508 行附近會 sync maintenance）
- 庫存出庫與到貨入庫數量不得超過剩餘需求量
- stock-issue／purchase-receipt 使用 idempotency key
- 留言可見性 PUBLIC／INTERNAL，門市留言與總務回覆有已讀／回覆狀態推導（enrichReplyState）

**API**：舊 /api/general-affairs/requests、/api/general-affairs/requests/[id]、/api/general-affairs/requests/[id]/comments、/api/general-affairs/requests/[id]/comments/read、/api/general-affairs/requests/[id]/comments/[commentId]、/api/general-affairs/requests/[id]/stock-issue、/api/general-affairs/requests/[id]/purchase-review、/api/general-affairs/requests/[id]/purchase-receipt、/api/general-affairs/attachments、/api/general-affairs/equipment/onboarding-review-tasks、/api/general-affairs/equipment/[id]/onboarding-review、/api/general-affairs/inventory/options、/api/general-affairs/part-fulfillments；新 —

**資料表**：ga_service_requests、ga_service_request_events、ga_service_request_comments、ga_resource_attachments、ga_purchase_reviews、ga_purchase_review_quotes、ga_vendors、ga_part_fulfillments、ga_part_fulfillment_documents、ga_inventory_*、ga_equipment、ga_facilities、maintenance_requests、maintenance_updates、maintenance_ticket_events、store_managers、profiles

**既有測試**：scripts/test-general-affairs-service-requests-foundation.js、scripts/test-general-affairs-request-stock-issue.js、scripts/test-general-affairs-purchase-reviews.js、scripts/test-general-affairs-resource-attachments.js、scripts/test-general-affairs-maintenance-ui.js、scripts/test-general-affairs-maintenance-views.js、scripts/test-general-affairs-role-matrix-dev.js

**待確認**

- intake 詳情內各子面板（設備入帳複核 UI、成本摘要百分比）逐欄位未全部閱讀
- assign 動作標註『保留給未來資訊平台串接』，實際是否有效需確認 requests/[id]/route.ts

### 測試案例

**冒煙**

- ga_admin 開 #/general-affairs/requests：列表、狀態篩選、焦點篩選、搜尋、分頁渲染，無 console error
- 點一筆開啟詳情側欄：摘要、附件、留言、時間軸皆載入
- ga_viewer（request.view_all 無 manage）：無受理/駁回等動作按鈕
- store_mgr_A 開工作台：無權限或導向我的追蹤（與舊版一致）

**單元**

- lib/general-affairs/service-requests/validation.ts:validateServiceRequestActionPayload：reject 缺原因、request_supplement 缺類型或說明、accept 缺處理路徑皆拋錯
- lib/general-affairs/purchase-reviews/validation.ts:validatePurchaseReviewPayload：五種 decision、quotes 陣列、金額負數、核准數量>需求量
- 抽出 ACTIVE_ACTIONS_BY_STATUS 與 shouldHandOffToWorkOrderCenter（ServiceRequestIntakeClient.tsx 338/347 行）到 lib/workspace/general-affairs/requests.ts，逐狀態斷言
- buildTransferPrefillUrl(request, workspace)（420 行）：輸出 Vue hash 路徑，參數集合與舊版相同；無 part_id/desired_quantity 時不帶該參數
- getRequestFriendlySnapshot / stripSceneDescription / requestListTitle：以含重複標籤的描述文字快照比對
- currencyText、percentText、numberText 格式（zh-TW、千分位、小數）
- remainingQuantity(request, documents) 用於出庫/入庫上限

**整合**

- accept（維修派工）→ ga_service_requests ACCEPTED + 建立/同步 maintenance_requests，並寫 ga_service_request_events
- reject、request_supplement → 狀態 REJECTED / WAITING_STORE_SUPPLEMENT，事件與原因欄位正確；WAITING_STORE_SUPPLEMENT 狀態下 accept → 4xx
- stock-issue：數量超過剩餘需求 → 4xx；同 idempotency key 並行 2 次只過帳 1 次；成功後庫存 ISSUE 交易
- purchase-review PURCHASE → 產生 ga_next_purchase_order_no 單號與 quotes；purchase-receipt 入庫後狀態 WAITING_STORE_CONFIRMATION
- comments：INTERNAL 留言 store_mgr_A 讀不到；編輯/刪除他人留言 403；comments/read 寫已讀事件
- 角色矩陣：ga_admin 全 200；ga_viewer 讀 200/動作 403；ga_purchaser 只能 purchase-review；ga_inventory_clerk 可 stock-issue 但不可 reject（依舊 API 結果）；store_mgr_B 讀門市 A 單 403/404

**E2E**

- 維修單：受理（維修派工）→ 詳情出現『已交接工單中心』連結 → 點擊進入工單中心並選中該單
- 添購單：受理（庫存出庫）→ 選來源位置、數量 2 → 送出 → 庫存流水出現 ISSUE → 送門市確認
- 添購單：採購評估填 2 筆報價、選供應商、核准數量 → 到貨入庫 → 狀態待門市確認
- 駁回：不選原因時送出 disabled；選『重複』+ 說明 → 已駁回
- 留言：新增 INTERNAL 與 PUBLIC 留言含附件 → 編輯 → 刪除確認；store_mgr_A 在我的追蹤只看到 PUBLIC
- 建立料件處理單 → 跳至料件處理中心 ?fulfillmentId=

**對等驗證**

- L/V 各一組相同需求單走：accept(維修)、reject、supplement、stock-issue、purchase-review+receipt 五條路徑，比對 ga_service_requests 終態欄位、events 的 event_type 序列、maintenance_requests/updates/ticket_events 同步列、庫存交易
- 列表 API 每個 status 篩選＋焦點篩選的回傳 id 集合舊新一致
- 詳情 API（含 comments 可見性 per 角色）正規化比對

**測試資料**

- 門市 A：需求單 PENDING_INTAKE（REPAIR, equipment）、WAITING_GA_REVIEW（PURCHASE_SUPPLEMENT, part, qty 5）、ACCEPTED、WAITING_STORE_CONFIRMATION 各 1；門市 B 1 筆
- QA-GA2 廠商 2 家（採購報價用）；中央總倉料件餘額 20
- 1 筆設備入帳複核任務
- 角色：ga_admin、ga_viewer、ga_purchaser、ga_inventory_clerk、store_mgr_A、store_mgr_B

**風險**

- XL 頁面且與 maintenance_* 雙向同步，Vue API 必須呼叫同一伺服端邏輯，建議 workspace route 直接重用舊 handler
- assign 動作是否實際生效 uncertain，需先讀 requests/[id]/route.ts

## /general-affairs/reports/new

- 狀態：**missing**（L）— 無 Vue 頁與 workspace API。
- 舊版：`app/general-affairs/reports/new/page.tsx -> components/general-affairs/requests/ServiceRequestCreateClient.tsx（1357 行）`
- Vue：（無）
- 權限：general_affairs.request.create、可為任一門市建立：GA_REQUEST_CREATE_ANY_STORE_PERMISSIONS（canCreateServiceRequestForAnyStore）、門市店長（isStoreManagerForStore）只能為所管門市建立
- 相依：附件上傳元件、門市範圍 API、設備／設施標的查詢 API

**舊版功能**

- 選需求類型：維修／現場狀況回報（REPAIR）或庶務／料件添購補充（PURCHASE_SUPPLEMENT）
- 先確認門市：載入 /api/user/managed-stores（scope managed／all）
- 維修：問題類型（設備故障／店內設施環境問題／不確定交總務判斷）、狀況類型、發生位置、影響程度（多選）、設備或設施標的選擇（/request-targets?storeId=）、暫時處理方式、聯絡人、照片上傳
- QR Code 預填：?assetToken= 呼叫 assets/scan/{token} 預填設備／設施與門市，並驗證類型必須為 EQUIPMENT／FACILITY
- 添購補充：公司既有品項（料件目錄搜尋，帶出單位）或建議採購新品（情境、使用位置、希望規格）、使用對象（設備／設施）、數量、單位、影響說明
- 自動組標題與描述文字（autoRepairTitle／autoPurchaseTitle，限 120 字）
- 附件上傳（resource_type=SERVICE_REQUEST，purpose ISSUE_PHOTO 或 REFERENCE_IMAGE）
- 送出成功畫面：單號、公開進度、前往我的追蹤、再新增一筆
- canSubmit 必填驗證

**缺少或不同**

- 整頁缺 Vue 版與 workspace API
- 需 workspace 版 managed-stores、request-targets、assets/scan、parts 目錄、attachments 上傳端點

**業務規則**

- 建立後狀態為 PENDING_INTAKE
- 附件上傳失敗與需求建立是兩步驟（先建單再傳附件）
- 資源類型與標的欄位互斥：維修用 equipment_id／facility_id，添購用 part_id
- validateServiceRequestPayload 於伺服端驗證

**API**：舊 /api/user/managed-stores、/api/general-affairs/requests (POST)、/api/general-affairs/request-targets、/api/general-affairs/assets/scan/[token]、/api/general-affairs/parts、/api/general-affairs/attachments (POST)；新 —

**資料表**：ga_service_requests、ga_resource_attachments、ga_parts、ga_equipment、ga_facilities、stores、store_managers

**既有測試**：scripts/test-general-affairs-service-requests-foundation.js、scripts/test-general-affairs-resource-attachments.js

**待確認**

- REPAIR_SITUATION_OPTIONS、REPAIR_IMPACT_OPTIONS 完整選項文字未逐一抄錄

### 測試案例

**冒煙**

- store_mgr_A 開 #/general-affairs/reports/new：需求類型選擇、門市選擇（只有門市 A）渲染
- ga_admin：門市下拉含全部啟用門市（canCreateServiceRequestForAnyStore）
- 無 request.create：顯示無權限
- 舊網址 #/general-affairs/part-requests/new 重導到 reports/new（exclude 頁的重導檢查）

**單元**

- lib/general-affairs/service-requests/validation.ts:validateServiceRequestPayload：REPAIR 缺 equipment/facility 時規則、PURCHASE_SUPPLEMENT 需 part_id 或建議新品欄位、quantity<=0、標題超 120 字
- 抽出 autoRepairTitle / autoPurchaseTitle 與描述組字：截斷 120 字、選項文字拼接順序快照比對
- canSubmit(form) 各類型必填組合
- targetSearchText / partSearchText 搜尋比對（料號、名稱、別名）
- QR 預填 applyAssetScan(result)：非 EQUIPMENT/FACILITY 類型拒絕

**整合**

- POST /api/workspace/general-affairs/requests：store_mgr_A 建門市 A → 201、狀態 PENDING_INTAKE；建門市 B → 403
- ga_admin 為任一門市建立 → 201
- assets/scan/{token}：有效 token 回設備+門市；無效 404；跨門市 token 由 store_mgr_B 掃 → 與舊版相同結果
- attachments POST（SERVICE_REQUEST/ISSUE_PHOTO）：超過 20MB、非圖片/PDF → 4xx；建單成功但附件失敗時需求單仍存在
- managed-stores scope=managed/all 結果與舊 /api/user/managed-stores 相同

**E2E**

- store_mgr_A：選維修 → 問題類型設備故障 → 選狀況、位置、影響多選 → 選設備 → 上傳照片 → 送出 → 成功畫面顯示單號 → 點『前往我的追蹤』出現該單
- 添購：搜尋既有料件帶出單位 → 數量 3 → 送出；再新增一筆按鈕重置表單
- 建議新品路徑：填情境、規格 → 送出 → DB part_id 為 null 且描述含規格
- 以 ?assetToken= 開啟 → 自動帶入門市與設備

**對等驗證**

- L/V 用相同表單輸入各建 1 單（REPAIR、PURCHASE_SUPPLEMENT 既有品、建議新品三種），比對 ga_service_requests 的 title、description、request_type、resource_type、equipment_id/facility_id/part_id、desired_quantity/unit、status 完全相同
- 附件列 resource_type/purpose/檔名一致
- request-targets 與 parts 目錄 API 回應舊新一致

**測試資料**

- 門市 A：設備 1 台（含 asset token）、設施 1 個；料件 2 種
- store_mgr_A、store_mgr_B、ga_admin、plain_staff
- 測試圖檔 1 張 jpg、1 個 pdf、1 個 21MB 檔、1 個 .exe

**風險**

- 建單與附件兩步驟，e2e 需驗證附件失敗時的警告訊息與舊版相同

## /general-affairs/reports/mine

- 狀態：**missing**（XL）— 無 Vue 頁與 workspace API。
- 舊版：`app/general-affairs/reports/mine/page.tsx -> components/general-affairs/requests/ServiceRequestMyReportsClient.tsx（2057 行）`
- Vue：（無）
- 權限：general_affairs.request.view_own_store、general_affairs.request.comment_own_store、general_affairs.request.confirm_own_store、general_affairs.request.view_all（可看全部）
- 相依：reports/new（建單）、附件元件、需求單工作台共用 API、設備入帳任務（設備領域）

**舊版功能**

- 我的追蹤列表：狀態篩選（待我確認／待我處理／待受理／待總務複核／已受理／總務準備中／已完成／已駁回／全部），可由 URL ?status=&requestId= 帶入
- 現在等你／現在等總務狀態提示，進度步驟條（送出→總務接手→準備中→門市確認→完成）
- 詳情：公開留言（新增、編輯、刪除需確認）、附件（含留言附件）、事件時間軸、料件處理進度
- 門市動作 store-actions：submit_supplement（補充資料，必填說明）、confirm_complete（確認完成）、report_problem（回報有問題，必填原因，退回總務處理）
- 設備入帳任務（store-onboarding-tasks）：設備照片、貼標照片、總務複核、完成步驟，門市上傳並回報
- 重新整理、請求載入失敗處理

**缺少或不同**

- 整頁缺 Vue 版與 workspace API

**業務規則**

- submit_supplement 要求狀態 WAITING_STORE_SUPPLEMENT → 轉 WAITING_GA_REVIEW
- confirm_complete 要求狀態 WAITING_STORE_CONFIRMATION → COMPLETED，並同步 maintenance_requests（STORE_CONFIRM_COMPLETE）
- report_problem 要求 WAITING_STORE_CONFIRMATION → IN_PROGRESS，並同步 maintenance（REPORT_UNRESOLVED，maintenance 狀態 PROCESSING）
- 門市留言與已讀事件 STORE_COMMENT_READ 的推導

**API**：舊 /api/general-affairs/requests、/api/general-affairs/requests/[id]、/api/general-affairs/requests/[id]/comments、/api/general-affairs/requests/[id]/comments/[commentId]、/api/general-affairs/requests/[id]/store-actions、/api/general-affairs/attachments、/api/general-affairs/equipment/store-onboarding-tasks；新 —

**資料表**：ga_service_requests、ga_service_request_events、ga_service_request_comments、ga_resource_attachments、maintenance_requests、maintenance_updates、maintenance_ticket_events、store_managers

**既有測試**：scripts/test-general-affairs-service-requests-foundation.js、scripts/test-general-affairs-maintenance-ui.js、scripts/test-general-affairs-maintenance-views.js、scripts/test-general-affairs-role-matrix-dev.js

**待確認**

- store-onboarding-tasks 的完整步驟 UI 與設備領域重疊，歸屬待與設備領域協調

### 測試案例

**冒煙**

- store_mgr_A 開 #/general-affairs/reports/mine：列表、狀態篩選、進度條渲染
- 帶 ?status=WAITING_STORE_CONFIRMATION&requestId=<id> 開啟：篩選已套用、詳情展開
- 舊網址 #/general-affairs/part-requests 重導至此（exclude 頁重導檢查）
- 無 view_own_store：顯示無權限

**單元**

- 抽出 getProgressInfo / PROGRESS_INDEX：每個狀態對應步驟索引
- storeFacingStatusLabel、storeFacingProgressText、hasInternalProgressTerms：內部用語不外露
- storeResponsibilitySummary（現在等你/等總務）各狀態文字快照
- assetTaskActionTitle/Description 與 ASSET_TASK_PROGRESS

**整合**

- store-actions submit_supplement：WAITING_STORE_SUPPLEMENT → WAITING_GA_REVIEW；其他狀態 4xx；說明空白 4xx
- confirm_complete：WAITING_STORE_CONFIRMATION → COMPLETED，關聯 maintenance_requests 同步完成並寫 STORE_CONFIRM_COMPLETE
- report_problem：→ IN_PROGRESS，maintenance 狀態 PROCESSING、REPORT_UNRESOLVED 事件；原因空白 4xx
- store_mgr_B 對門市 A 單執行 store-actions → 403/404；ga_viewer 無 confirm_own_store → 403
- 並行：同時 confirm_complete 與 report_problem → 只有一個成功
- 留言：門市新增 PUBLIC 留言、編輯、刪除；無 comment_own_store 403

**E2E**

- store_mgr_A：待我確認篩選 → 開單 → 確認完成 → 狀態已完成、進度條最後一格
- 另一單回報有問題 → 填原因 → 狀態回總務處理中；在工單中心（ga_maint_staff）看到門市退回焦點
- 補充資料：輸入說明＋上傳附件 → 狀態待總務複核
- 設備入帳任務：上傳設備照片與貼標照片 → 回報 → 任務進度前進

**對等驗證**

- L/V 各準備 3 筆相同狀態需求單，分別執行三種 store-actions，比對需求單狀態、events、maintenance_requests/updates/ticket_events 結果
- 列表 API 每個狀態篩選的回傳 id 集合 per 角色舊新一致
- 畫面：狀態標籤、現在等誰提示文字逐字一致

**測試資料**

- 門市 A：WAITING_STORE_CONFIRMATION×2（其一關聯 maintenance_request）、WAITING_STORE_SUPPLEMENT×1、COMPLETED×1；門市 B 1 筆
- 1 筆門市 A 設備入帳任務
- 角色：store_mgr_A、store_mgr_B、ga_viewer、ga_admin

**風險**

- 設備入帳任務屬設備領域，需協調避免重複測試
- 與工單同步邏輯若在 Vue API 重寫極易不一致

## /general-affairs/part-requests

- 狀態：**exclude**（S）— 檔案內容只有 redirect('/general-affairs/reports/mine')，無獨立 UI。Vue 只需在路由層保留舊網址對應到 reports/mine。
- 舊版：`app/general-affairs/part-requests/page.tsx`
- Vue：（無）
- 權限：同 reports/mine
- 相依：reports/mine

**舊版功能**

- 伺服端 redirect 到 /general-affairs/reports/mine

**缺少或不同**

- Vue 路由需加舊網址重導（/part-requests → 我的追蹤）以保持兩版連結一致

**業務規則**

- （無）

**API**：舊 —；新 —

**資料表**：—

**既有測試**：—

**待確認**

- GeneralAffairsServiceCenterClient 內仍有 part-requests section（renderPartRequestRecords = renderMyReports）屬死碼或舊入口，未確認是否仍有路由使用

## /general-affairs/part-requests/new

- 狀態：**exclude**（S）— 檔案內容只有 redirect('/general-affairs/reports/new')，無獨立 UI。
- 舊版：`app/general-affairs/part-requests/new/page.tsx`
- Vue：（無）
- 權限：同 reports/new
- 相依：reports/new

**舊版功能**

- 伺服端 redirect 到 /general-affairs/reports/new

**缺少或不同**

- Vue 路由需加舊網址重導（/part-requests/new → 新增需求）

**業務規則**

- （無）

**API**：舊 —；新 —

**資料表**：—

**既有測試**：—

## /general-affairs/part-fulfillments

- 狀態：**missing**（L）— 無 Vue 頁與 workspace API。
- 舊版：`app/general-affairs/part-fulfillments/page.tsx -> components/general-affairs/parts/PartFulfillmentCenterClient.tsx + PartFulfillmentExecutionPanel.tsx + LinkedPartDocumentDrawer.tsx`
- Vue：（無）
- 權限：general_affairs.part_fulfillment.view/manage、general_affairs.inventory_transaction.manage（出庫）、general_affairs.inventory_transfer.manage（調撥）、general_affairs.purchase_review.manage（採購／到貨）
- 相依：庫存／調撥／採購 API 的 workspace 版、需求單工作台（橋接元件）

**舊版功能**

- 料件處理中心列表：統計（全部／待決定／處理中／等門市確認／異常／已完成）、篩選（預設 ACTIVE）、搜尋（處理單號、需求單號、標題、門市、料號、料名）、依狀態優先度與更新時間排序
- 狀態：待決定、出庫中、調撥中、採購中、等待到貨、等待門市確認、異常、已完成、已取消
- 詳情抽屜：需求資訊、數量進度（需求／已完成／已承諾／剩餘）、下一步提示、事件時間軸
- 決策按鈕：出庫／調撥／採購（POST decision）
- 執行面板：建立出庫單（選位置、數量，不得超過剩餘）、採購資料（供應商、預估金額、預計到貨日）、採購到貨入庫（選位置，入庫後送門市確認）
- 調撥單建立導向調撥頁；連結單據（出庫單／調撥單／採購單）點開 LinkedPartDocumentDrawer 看單據
- 送門市確認（POST store-confirmation）
- 登記異常（exception：少收等類型＋備註）
- ?fulfillmentId= 深連結開啟、視窗聚焦自動重新整理
- 依 capabilities（manage／stockIssue／transfer／purchase／purchaseReceipt）顯示可用動作

**缺少或不同**

- 整頁缺 Vue 版與 workspace API

**業務規則**

- 每個動作能力由 API 回傳 capabilities，前端據此顯示
- 數量承諾 = 非取消單據數量加總與已完成數量取大者
- 全部完成後才可送門市確認（fulfilled >= requested）
- 異常由門市回報處理

**API**：舊 /api/general-affairs/part-fulfillments、/api/general-affairs/part-fulfillments/[id]/decision、/api/general-affairs/part-fulfillments/[id]/store-confirmation、/api/general-affairs/part-fulfillments/[id]/exception、/api/general-affairs/part-fulfillments/documents/[type]/[id]、/api/general-affairs/requests/[id]/stock-issue、/api/general-affairs/requests/[id]/purchase-review、/api/general-affairs/requests/[id]/purchase-receipt、/api/general-affairs/inventory/options；新 —

**資料表**：ga_part_fulfillments、ga_part_fulfillment_documents、ga_part_fulfillment_events、ga_service_requests、ga_inventory_transfers、ga_purchase_reviews、ga_inventory_locations、ga_inventory_location_parts

**既有測試**：scripts/test-general-affairs-request-stock-issue.js、scripts/test-general-affairs-purchase-reviews.js、scripts/test-general-affairs-part-holding-status.js（相關，非直接）

**待確認**

- 未找到專屬於 part-fulfillments 的測試腳本

### 測試案例

**冒煙**

- ga_purchaser 開 #/general-affairs/part-fulfillments：統計卡、預設 ACTIVE 篩選、列表渲染
- ?fulfillmentId=<id> 開啟詳情抽屜
- 無 part_fulfillment.view：無權限畫面；ga_viewer 只讀無動作按鈕（依 capabilities）

**單元**

- 抽出 quantityProgress(row)（PartFulfillmentCenterClient.tsx 50 行）：committed = max(非 CANCELED 單據數量和, fulfilled)、remaining 不小於 0
- nextAction(row)（39 行）每個狀態與 STOCK_ISSUE 三種子情境文字
- 排序函式：狀態優先度 + updated_at desc
- 搜尋比對（處理單號、需求單號、標題、門市、料號、料名）
- capabilities → 可見按鈕對照表

**整合**

- POST {id}/decision STOCK_ISSUE/TRANSFER/PURCHASE → 狀態轉換與 events
- 建立出庫單數量 > remaining → 4xx；成功後 documents 新增、fulfilled 更新
- store-confirmation：fulfilled < requested → 4xx；足量 → WAITING_STORE_CONFIRMATION
- exception 登記 → EXCEPTION 狀態
- documents/[type]/[id] 讀取出庫/調撥/採購單內容
- 角色矩陣：part_fulfillment.manage 但無 inventory_transaction.manage → capabilities.stockIssue=false 且出庫 403；ga_purchaser 可採購/到貨；ga_viewer 全寫 403

**E2E**

- 待決定單 → 選出庫 → 建出庫單（位置、數量 2/需求 5）→ 進度 2/5 → 再出 3 → 送門市確認 → 狀態等待門市確認
- 選調撥 → 導向調撥頁預填 → 建立後回中心看到連結單據
- 選採購 → 填供應商、預估金額、到貨日 → 到貨入庫 → 送門市確認
- 點連結單據開 LinkedPartDocumentDrawer 顯示單據明細

**對等驗證**

- 列表 API（含 capabilities）per 角色舊新一致
- L/V 各一張相同處理單走出庫兩次＋送確認，比對 fulfillment 狀態、documents、events、庫存交易
- 統計卡六項數字一致

**測試資料**

- 由 QA-GA2 需求單產生的 part_fulfillment：PENDING_DECISION×2、STOCK_ISSUE（已有 1 張出庫單）×1、WAITING_ARRIVAL×1、EXCEPTION×1
- 料件餘額足夠的中央總倉位置
- 角色：ga_purchaser、ga_inventory_clerk、ga_viewer、ga_admin

**風險**

- 目前無專屬舊測試腳本，parity 基準需先用舊 API 錄製快照

## /general-affairs/work-orders

- 狀態：**missing**（XL）— 無 Vue 頁與 workspace API。工單資料來自舊式 /api/maintenance-requests、maintenance-updates、maintenance-photos、maintenance-progress-stages，這些皆無 workspace 版。
- 舊版：`app/general-affairs/work-orders/page.tsx -> components/general-affairs/service-center/GeneralAffairsServiceCenterClient.tsx（6030 行，initialView.section='work-orders'）`
- Vue：（無）
- 權限：general_affairs.work_order.view_own_store / view_all / update / manage、general_affairs.maintenance_request.view_all / update、general_affairs.service_center.force_close（強制結案入口）、相容舊權限 cross_dept.maintenance.*（SHARED_MAINTENANCE_* 代碼組，見 lib/general-affairs/maintenance-permissions.ts）
- 相依：需求單工作台（受理派工後產生工單）、附件／圖片燈箱元件、門市範圍 API

**舊版功能**

- 工單中心列表：門市下拉（有 view_all 才有『全部門市』）、狀態下拉（全部／已受理／處理中／已完成，附計數）、搜尋（工單、設備名稱、問題描述）、預設顯示近期工單不受日期篩選
- 『今天先處理什麼』焦點卡：全部、門市退回、待安排、廠商／施工、維修待料件、等門市確認，清除焦點
- 左側待處理工單清單（標題、門市、狀態標籤、下一步、照片數、最新進度）
- 右側詳情：下一步引導、門市／發生位置／問題類型／聯絡窗口／門市描述、現場照片燈箱（看全部）、資源資訊（類別／來源／位置）、共用附件、處理時間軸、門市回覆結果（確認完成／仍有問題）
- 快速動作：出庫、調撥、採購、派工、補資料、駁回（各自預設 progressStage 與 handlingMethod）
- 更新進度表單：動作（SAVE_PROGRESS／REQUEST_COMPLETION／FORCE_CLOSE 等）、進度階段（含 WAITING_PARTS、PARTS_IN_TRANSIT、WAITING_INTERNAL_APPROVAL、WAITING_VENDOR_VISIT、WAITING_VENDOR_QUOTE、WAITING_STORE_INFO、WAITING_STORE_CONFIRMATION 等）、可見性 PUBLIC／INTERNAL、進度日期、承辦人、處理方式、處理內容（必填）、駁回／不處理原因（FORCE_CLOSE 必填）、進階選項
- 送門市確認（REQUEST_COMPLETION，強制 PUBLIC 與 WAITING_STORE_CONFIRMATION）；門市代表確認完成／回報仍有問題（prompt 填原因）
- 列印（window.print）、重新整理、無更新權限提示橫幅

**缺少或不同**

- 整頁缺 Vue 版與 workspace API
- 工單圖片需簽名 URL（maintenance-photos signed_url）流程要重做

**業務規則**

- 狀態機 UNACCEPTED／ACCEPTED／PROCESSING／COMPLETED（MAINTENANCE_STATUS_STEPS）
- 送門市確認時強制公開並設 WAITING_STORE_CONFIRMATION
- FORCE_CLOSE 必須填原因
- 處理內容必填
- 門市確認完成 → 工單 COMPLETED；回報仍有問題 → 回 PROCESSING，並同步 ga_service_requests（見 store-actions）
- 列表預設近期工單，不受日期篩選

**API**：舊 /api/maintenance-requests、/api/maintenance-updates、/api/maintenance-photos、/api/maintenance-progress-stages、/api/general-affairs/attachments、/api/general-affairs/requests/[id]、/api/user/managed-stores、/api/general-affairs/access；新 —

**資料表**：maintenance_requests、maintenance_updates、maintenance_update_photos / maintenance_photos、maintenance_ticket_events、maintenance_progress_stages（API 名稱，表名 uncertain）、ga_service_requests、ga_resource_attachments、stores

**既有測試**：scripts/test-general-affairs-maintenance-ui.js、scripts/test-general-affairs-maintenance-views.js、scripts/test-production-legacy-general-affairs-maintenance-compatibility.js、scripts/test-general-affairs-role-matrix-dev.js

**待確認**

- GeneralAffairsServiceCenterClient 同檔還含 home／maintenance（維修回報）／part-requests／equipment／facilities 等 section，其中 maintenance 區（renderNewReport／renderMyReports）屬本領域範圍外的舊維修回報流程，是否仍有入口需另核對
- maintenance_progress_stages 表名未確認

### 測試案例

**冒煙**

- ga_maint_staff 開 #/general-affairs/work-orders：門市下拉含『全部門市』、狀態下拉附計數、焦點卡、左右清單詳情渲染
- store_mgr_A（work_order.view_own_store）：門市下拉只有門市 A、無『全部門市』、顯示無更新權限橫幅
- ga_legacy_maint（只有 cross_dept.maintenance.*）仍可進入並看到工單（相容權限）
- 照片縮圖以 signed URL 載入，無 403 圖片錯誤

**單元**

- lib/general-affairs/maintenance-permissions.ts 的權限組（GA_WORK_ORDER_VIEW_CODES、SHARED_MAINTENANCE_REQUEST_UPDATE_CODES 等）解析 hasWorkOrderAccess(permSet) 對 8 種角色結果
- 抽出焦點分類 classifyWorkOrderFocus(order)：門市退回、待安排、廠商/施工、待料件、等門市確認
- quickActionDefaults(action) 出庫/調撥/採購/派工/補資料/駁回對應 progressStage 與 handlingMethod
- validateProgressUpdate(form)：處理內容必填；FORCE_CLOSE 需原因；REQUEST_COMPLETION 強制 PUBLIC + WAITING_STORE_CONFIRMATION
- MAINTENANCE_STATUS_STEPS 狀態步驟索引

**整合**

- POST maintenance-updates SAVE_PROGRESS → maintenance_updates 新增、狀態 PROCESSING、ticket_events
- REQUEST_COMPLETION → visibility 被強制 PUBLIC、同步 ga_service_requests WAITING_STORE_CONFIRMATION
- FORCE_CLOSE 無 service_center.force_close → 403；有但無原因 → 400
- store_mgr_A 讀門市 B 工單 → 403/空；更新任何工單 → 403
- maintenance-photos 取 signed_url：跨門市 403
- 並行兩位承辦同時 SAVE_PROGRESS → 兩筆 updates 皆保存、狀態一致

**E2E**

- ga_maint_staff：點焦點『待安排』→ 選工單 → 快速動作『派工』預填 → 填處理內容 → 儲存 → 時間軸新增
- 送門市確認 → store_mgr_A 在我的追蹤確認完成 → 回工單中心狀態已完成
- 門市回報仍有問題 → 工單回處理中並出現在『門市退回』焦點
- 照片燈箱：看全部、切換
- 列印按鈕觸發 window.print（攔截 print 呼叫）

**對等驗證**

- /api/maintenance-requests 與 workspace 版 per 角色（門市、狀態篩選）回傳 id 集合與計數一致
- L/V 各一張工單走 SAVE_PROGRESS→REQUEST_COMPLETION→門市確認，比對 maintenance_requests、updates、ticket_events、ga_service_requests 終態
- 焦點卡六項計數一致

**測試資料**

- 門市 A：UNACCEPTED、ACCEPTED、PROCESSING（WAITING_PARTS）、PROCESSING（門市退回）、WAITING_STORE_CONFIRMATION 各 1 工單，部分附照片；門市 B 1 筆
- 角色：ga_maint_staff、ga_legacy_maint、store_mgr_A、store_mgr_B、ga_admin（含 force_close）

**風險**

- GeneralAffairsServiceCenterClient 6030 行共用 state，拆分時易漏行為
- maintenance_progress_stages 表名 uncertain

## /general-affairs/vendors

- 狀態：**missing**（XL）— 無 Vue 頁與 workspace API。
- 舊版：`app/general-affairs/vendors/page.tsx -> GeneralAffairsServiceCenterClient（section='vendors', vendorView='list'）+ components/general-affairs/vendors/VendorInformationPrintForm.tsx`
- Vue：（無）
- 權限：general_affairs.vendor.view / manage、general_affairs.service_category.view/manage、general_affairs.service_region.view/manage、general_affairs.cooperation_record.view、RLS migration：20260824090000_general_affairs_vendor_permissions_rls.sql；相容 migration 20260724011554_production_legacy_general_affairs_maintenance_compatibility.sql
- 相依：vendors/categories 與 vendors/regions（供表單多選）、列印樣式 ga-vendor-print-*

**舊版功能**

- 廠商分頁籤：廠商列表／採購分析／服務分類管理／服務區域管理／合作記錄統計
- 統計卡：全部廠商、合作中、暫停合作、已停用（含百分比）
- 搜尋（名稱／聯絡人／電話）、服務分類篩選、服務區域篩選、合作狀態篩選（全部／合作中／暫停合作／已停用）
- 廠商表：名稱（別名或統編）、服務分類（前 2 個）、服務區域（前 2 個）、聯絡人／手機、合作狀態、近期工單（總數與本月）、評價、操作
- 選取廠商看右側詳情：簡介、類型（公司／工作室／個人工作室）、統編、聯絡人、電話、電子郵件、服務分類／區域／熟悉品牌
- 新增廠商五步驟表單：基本資料（名稱*、類型、統編、別名、成立日、狀態、電話、傳真、網站、地址、服務地址同登記地址）、服務項目與區域（分類／區域多選、品牌、設備類型）、聯絡人與帳務（聯絡人、手機、LINE、Email、抬頭、帳務地址、發票類型、付款條件與方式、帳務備註）、合作與備註（合作起日、合約到期、需合約、優先廠商、備註、標籤）、附件檔案（僅存檔名 attachment_names）
- 匯出廠商填寫表（window.print 列印 VendorInformationPrintForm，列出啟用分類與縣市區域）

**缺少或不同**

- 整頁缺 Vue 版與 workspace API
- 舊版直接以瀏覽器 supabase client 讀寫 ga_vendors／ga_service_categories／ga_service_regions（RLS 控管），Vue 版需改為 workspace API 或確保相同 RLS
- 舊版廠商只有『新增』(insert)，saveVendor 無更新／刪除；檢視為唯讀詳情。Vue 版為『功能一致』也不應多加編輯（除非另行決策）
- 表單附件只存 attachment_names 檔名陣列，並非真實檔案上傳（uncertain 是否預期如此）
- rating／review_count／work_order_count／monthly_order_count 新增時固定為 0，績效數字來源不明（uncertain）

**業務規則**

- 廠商名稱必填
- 服務地址可勾選同登記地址
- tags 以逗號分隔轉陣列
- DEV schema 缺表時顯示『此功能尚未在目前測試環境開放』

**API**：舊 supabase client 直連 ga_vendors / ga_service_categories / ga_service_regions（無 /api 路由）；新 —

**資料表**：ga_vendors、ga_service_categories、ga_service_regions

**既有測試**：scripts/test-general-affairs-vendor-print-form.js、scripts/test-general-affairs-categories.js（服務分類相關，uncertain 是否涵蓋此頁）

**待確認**

- vendors 目錄下沒有專屬 API route，權限完全靠 RLS，Vue 版 workspace API 要如何對齊 RLS 需另行驗證
- app/api/general-affairs/categories 路由用途（78 行）是否與廠商服務分類有關未確認（可能是設備／設施分類）

### 測試案例

**冒煙**

- ga_admin 開 #/general-affairs/vendors：五個分頁籤、四張統計卡、篩選、廠商表渲染
- 只有 vendor.view：無新增按鈕；無 vendor.view：無權限
- DEV 缺表時訊息『此功能尚未在目前測試環境開放』（以 route mock 驗證）

**單元**

- 抽出 vendorStats(vendors)（GeneralAffairsServiceCenterClient.tsx 876 行）：active/paused/inactive 計數；completedWorkOrders = round(total*0.86)（照抄既有邏輯）；avgRating/avgDays 只計 rating>0
- 統計卡百分比：vendors 為空時 '0%'
- buildVendorPayload(form)：tags 逗號切分 trim 去空、服務地址同登記地址、新增時 rating/review_count/work_order_count/monthly_order_count=0、attachment_names 只存檔名
- filterVendors(vendors, {q, category, region, status})：名稱/聯絡人/電話搜尋

**整合**

- workspace vendors API 與『anon key + 使用者 JWT 直查 ga_vendors』結果 per 角色一致（RLS 對齊）
- POST 新增廠商：vendor.manage 201；vendor.view 403；名稱空 400
- 不提供更新/刪除端點（功能一致），PATCH/DELETE 應 404/405
- 角色矩陣含 store_mgr_A 與 plain_staff 讀取結果與 RLS 一致

**E2E**

- 新增廠商五步驟：每步填寫、上一步保留資料、最後送出 → 列表出現並可選取看詳情
- 分類與區域篩選組合 → 筆數正確 → 清除
- 匯出廠商填寫表：攔截 window.print，列印區包含啟用分類與縣市區域

**對等驗證**

- L（舊頁 supabase insert）/V 用相同輸入新增廠商，比對 ga_vendors 全欄位（排除 id/時間）
- 統計卡四項、表格前 20 列（名稱、分類前 2、區域前 2、狀態）舊新一致

**測試資料**

- QA-GA2 廠商 5 家：active×3（rating 4.5、0、3）、paused×1、inactive×1，不同 work_order_count
- 服務分類 3（含上下層）、區域：1 縣市含 2 行政區
- 角色：ga_admin、vendor.view 帳號、plain_staff、store_mgr_A

**風險**

- completedWorkOrders 為寫死估算，需業務決策是否保留
- 舊版無 API，權限全靠 RLS，Vue API 若用 service role 會繞過 RLS

## /general-affairs/vendors/categories

- 狀態：**missing**（M）— 無 Vue 頁與 workspace API。
- 舊版：`app/general-affairs/vendors/categories/page.tsx -> GeneralAffairsServiceCenterClient（vendorView='categories'）renderVendorCategories / renderCategoryFormPanel / saveVendorCategory`
- Vue：（無）
- 權限：general_affairs.service_category.view/manage
- 相依：廠商共用外殼與分頁籤

**舊版功能**

- 統計卡：全部分類、啟用中、停用中、近期新增
- 分類列表（含上下層 parent）
- 新增／編輯分類（唯一有編輯功能）：名稱*、代碼*（轉大寫）、上層分類、描述、圖示 icon_key、狀態、排序 sort_order（預設 10）、常用項目 common_items（逗號分隔）

**缺少或不同**

- 整頁缺 Vue 版與 workspace API
- 舊版刪除分類功能未見（uncertain）

**業務規則**

- 名稱與代碼必填
- 代碼自動 upper-case
- 編輯用 update，新增用 insert

**API**：舊 supabase client 直連 ga_service_categories；新 —

**資料表**：ga_service_categories

**既有測試**：scripts/test-general-affairs-categories.js（uncertain）

**待確認**

- 分類狀態值名稱（active／inactive）依 vendor 狀態推測，未逐一確認

### 測試案例

**冒煙**

- service_category.view 帳號開 #/general-affairs/vendors/categories：四統計卡、分類列表（含上層）
- 無 manage 時無新增/編輯按鈕

**單元**

- buildCategoryPayload(form)：code 轉大寫、common_items 逗號切分、sort_order 預設 10、名稱/代碼必填
- categoryStats(categories)：active/inactive；recent = sort_order<=2（照抄既有邏輯）

**整合**

- 新增（insert）與編輯（update）：manage 200；view 403；代碼重複 → 與舊版相同錯誤
- RLS 對齊：workspace 結果與使用者 JWT 直查 ga_service_categories 一致

**E2E**

- 新增分類（小寫代碼 → 存成大寫）→ 列表出現 → 編輯描述與排序 → 重新整理後保留
- 設定上層分類 → 列表顯示階層

**對等驗證**

- L/V 相同輸入新增與編輯，比對 ga_service_categories 欄位
- 統計卡數字舊新一致

**測試資料**

- QA-GA2 分類：active×2（sort_order 1、10）、inactive×1、子分類×1
- 角色：service_category.manage、service_category.view、plain_staff

**風險**

- 狀態值 active/inactive 未逐一確認（uncertain）
- app/api/general-affairs/categories 可能是設備分類，勿混用

## /general-affairs/vendors/regions

- 狀態：**missing**（M）— 無 Vue 頁與 workspace API。
- 舊版：`app/general-affairs/vendors/regions/page.tsx -> GeneralAffairsServiceCenterClient（vendorView='regions'）renderVendorRegions / renderVendorRegionTree / renderRegionFormPanel / saveVendorRegion`
- Vue：（無）
- 權限：general_affairs.service_region.view/manage
- 相依：廠商共用外殼與分頁籤

**舊版功能**

- 區域樹狀顯示（縣市／行政區 region_type、可展開收合 toggleExpandedRegion）
- 新增區域：名稱*、代碼*（轉大寫）、上層區域、類型、描述、狀態、排序、涵蓋地點 included_locations（逗號分隔）
- 勾選區域供廠商表單使用（toggleVendorRegionSelection）

**缺少或不同**

- 整頁缺 Vue 版與 workspace API
- 舊版區域僅新增，無編輯／刪除（saveVendorRegion 只 insert）

**業務規則**

- 名稱與代碼必填
- 代碼 upper-case

**API**：舊 supabase client 直連 ga_service_regions；新 —

**資料表**：ga_service_regions

**既有測試**：—

**待確認**

- region_type 完整值（至少含 city）

### 測試案例

**冒煙**

- service_region.view 帳號開 #/general-affairs/vendors/regions：區域樹渲染、可展開收合
- 無 manage 無新增按鈕

**單元**

- buildRegionTree(regions)：依 parent 組樹、排序 sort_order
- buildRegionPayload(form)：code 大寫、included_locations 逗號切分、名稱/代碼必填

**整合**

- 新增區域 manage 201；view 403；不提供編輯/刪除（功能一致）
- RLS 對齊：workspace 結果與 JWT 直查 ga_service_regions 一致

**E2E**

- 新增縣市 → 在其下新增行政區 → 樹狀展開看到子節點 → 收合
- 廠商新增表單中勾選新區域可用

**對等驗證**

- L/V 相同輸入新增 2 層區域，比對 ga_service_regions 欄位
- 樹狀結構節點順序舊新一致

**測試資料**

- QA-GA2 縣市 1、行政區 2；角色：service_region.manage、service_region.view、plain_staff

**風險**

- region_type 完整值 uncertain

## /general-affairs/vendors/stats

- 狀態：**missing**（M）— 無 Vue 頁與 workspace API。
- 舊版：`app/general-affairs/vendors/stats/page.tsx -> GeneralAffairsServiceCenterClient（vendorView='stats'）renderVendorStats`
- Vue：（無）
- 權限：general_affairs.cooperation_record.view、general_affairs.vendor.view
- 相依：vendors 列表資料載入

**舊版功能**

- 六張統計卡：合作廠商總數（合作中／暫停）、工單總數、已完成工單（完成率）、總維修金額、平均處理天數、滿意度平均分數（x/5）
- 廠商合作績效排名表（排名、名稱、…、平均天數）與空狀態『尚無合作統計資料』
- 服務分類統計、服務區域統計

**缺少或不同**

- 整頁缺 Vue 版與 workspace API
- 統計皆由 ga_vendors 欄位（work_order_count、avg_days、rating 等）在前端彙總，欄位來源與更新機制不明（uncertain）

**業務規則**

- 前端 vendorStats 由 vendors 陣列計算：active／paused／inactive、totalWorkOrders、completedWorkOrders、totalAmount、avgDays、avgRating

**API**：舊 supabase client 直連 ga_vendors 等；新 —

**資料表**：ga_vendors、ga_service_categories、ga_service_regions

**既有測試**：—

**待確認**

- completed_work_orders／total_amount／avg_days 等欄位是否真的存在於 ga_vendors（vendorStats 計算式未逐行讀）

### 測試案例

**冒煙**

- cooperation_record.view 帳號開 #/general-affairs/vendors/stats：六統計卡、排名表、分類與區域統計
- 無資料時顯示『尚無合作統計資料』

**單元**

- vendorStats 六卡數值（同 vendors 頁函式）：完成率 = completed/total 四捨五入、total=0 時 0%
- 排名排序規則（以舊版 renderVendorStats 為準，實作前先讀確認）
- avgDays toFixed(1)、avgRating x/5 格式

**整合**

- 統計所需資料 API per 角色與 RLS 直查一致；無 cooperation_record.view 時 403 或空（依舊版）

**E2E**

- 開啟統計頁 → 六卡數字與 seed 計算期望值相同 → 排名表第一名為預期廠商

**對等驗證**

- 同帳號舊新頁六卡與排名表全列文字一致
- 以 seed 手算期望值（含 0.86 估算）斷言兩版皆相同

**測試資料**

- 沿用 vendors 頁 5 家 QA-GA2 廠商，需設定 total_amount/avg_days（若欄位存在）

**風險**

- ga_vendors 是否有 total_amount/avg_days 欄位 uncertain，若不存在兩版皆顯示 0

## /general-affairs/vendors/purchases

- 狀態：**missing**（M）— 無 Vue 頁與 workspace API。
- 舊版：`app/general-affairs/vendors/purchases/page.tsx -> GeneralAffairsServiceCenterClient（vendorView='purchases'）renderPurchaseAnalysis + app/api/general-affairs/purchase-reviews/cost-summary/route.ts`
- Vue：（無）
- 權限：general_affairs.purchase_review.view/manage 或 request.view_all／manage（canReadPurchaseReviews）、導覽可見性另含 vendor.view 等
- 相依：廠商共用外殼與分頁籤

**舊版功能**

- 年月選擇＋查詢
- 三張卡：採購總額、採購筆數、金額完整度（未填金額筆數警示）
- 門市採購金額排行、廠商採購金額排行（含筆數與占比）
- 空狀態『這個月份尚無資料』、載入／錯誤狀態

**缺少或不同**

- 整頁缺 Vue 版與 workspace API

**業務規則**

- 金額完整度 = 有填金額筆數占比
- 占比以 totalAmount 計算
- 採購資料來自 ga_purchase_reviews（join ga_vendors）

**API**：舊 /api/general-affairs/purchase-reviews/cost-summary?yearMonth=；新 —

**資料表**：ga_purchase_reviews、ga_vendors、ga_service_requests、stores

**既有測試**：scripts/test-general-affairs-purchase-reviews.js

### 測試案例

**冒煙**

- ga_purchaser 開 #/general-affairs/vendors/purchases：年月選擇、三卡、兩排行渲染
- 無資料月份顯示『這個月份尚無資料』

**單元**

- summarizeCostSummary(rows)：總額、筆數、金額完整度（有金額筆數占比）、門市/廠商排行占比以 totalAmount 計、totalAmount=0 時占比 0

**整合**

- GET purchase-reviews/cost-summary?yearMonth=：與舊 API deep-equal；yearMonth 格式錯誤 400
- 角色：purchase_review.view/manage、request.view_all/manage 皆 200；plain_staff 403；未登入 401

**E2E**

- 選擇有資料月份 → 查詢 → 三卡與排行數字符合 seed → 切換到空月份 → 空狀態

**對等驗證**

- 同月份舊新 API 回應正規化比對；畫面三卡與排行列文字一致

**測試資料**

- 某月 QA-GA2 採購評估 4 筆：門市 A×3、B×1，2 家廠商，其中 1 筆無金額
- 角色：ga_purchaser、ga_viewer（request.view_all）、plain_staff

## /general-affairs/utility-bills

- 狀態：**missing**（L）— 無 Vue 頁與 workspace API。
- 舊版：`app/general-affairs/utility-bills/page.tsx -> components/general-affairs/expenses/UtilityBillsClient.tsx + attachments/ResourceAttachmentPanel.tsx`
- Vue：（無）
- 權限：general_affairs.utility_bill.view（查看，manage 也可看）、general_affairs.utility_bill.manage（新增、標記繳費、刪除、附件管理）
- 相依：附件上傳與預覽元件（Vue）、門市清單 API

**舊版功能**

- 三張摘要：本月費用、待繳費金額、已逾期筆數（未繳且 due_date 早於台北今日）
- 篩選：月份（month input）、據點、費用類型（水／電／電話／網路）
- 帳單表：據點（含服務標籤）、類型、供應商、金額、繳費期限、繳費狀態、操作（標記已繳／改回待繳、刪除需確認、附件）
- 新增帳單對話框：據點（門市或其他據點）、據點名稱、費用類型、帳單月份、供應商、線路／數據機名稱（網路）、服務識別號（電號／水號／電話／電路編號，依類型換標籤）、客戶帳號、網路設備序號、金額、用電度數（電費）、繳費期限、繳費日期、銷帳編號、備註
- 新增時可同時選檔或直接拍照上傳帳單附件（最多 10 個，圖片與 PDF，單檔 ≤ 20MB）
- 帳單掃描檔與照片面板：選費用紀錄後以 ResourceAttachmentPanel（UTILITY_BILL／BILL_DOCUMENT）管理附件
- 連到費用報表頁

**缺少或不同**

- 整頁缺 Vue 版與 workspace API

**業務規則**

- 費用類型限 WATER／ELECTRICITY／PHONE／INTERNET
- 金額 ≥ 0；用電度數僅電費有效且 ≥ 0
- 據點名稱必填；store_id 須為 UUID
- 非網路費必須填服務識別號；網路費至少填電路編號或設備序號
- 帳單月份存成當月 1 日，唯讀欄 limit 500 筆
- 刪除為軟刪除（deleted_at／deleted_by）
- PATCH 只允許更新 paid_at（標記繳費／取消）
- 附件上傳失敗不影響帳單建立，只顯示警告

**API**：舊 /api/general-affairs/utility-bills (GET/POST)、/api/general-affairs/utility-bills/[id] (PATCH/DELETE)、/api/general-affairs/attachments、/api/general-affairs/attachments/[id]；新 —

**資料表**：ga_utility_bills、ga_resource_attachments、stores

**既有測試**：scripts/test-general-affairs-utility-bills.js、scripts/test-general-affairs-resource-attachments.js

**待確認**

- migration 20260925103000_general_affairs_utility_bills.sql 的 RLS 細節未讀

### 測試案例

**冒煙**

- utility_bill.manage 帳號開 #/general-affairs/utility-bills：三摘要、篩選、帳單表、新增按鈕
- utility_bill.view：無新增、標記繳費、刪除、附件管理
- 無權限：403 畫面

**單元**

- 抽出 app/api/general-affairs/utility-bills/route.ts 的 payloadOf 到 lib：類型限 WATER/ELECTRICITY/PHONE/INTERNET；billing_month 非 YYYY-MM 拋錯並轉成 -01；amount<0 拋錯；kwh 僅電費保留；store_id 非 UUID 拋錯；INTERNET 需電路編號或設備序號；其他類型需服務識別號；text() 截斷長度
- identifierLabel(type)（UtilityBillsClient.tsx 38 行）各類型標籤
- summarizeBills(bills, todayTaipei)：本月費用、待繳金額、已逾期（未繳且 due_date < 台北今日，跨日邊界 UTC 16:00）
- 附件檢查：最多 10 個、≤20MB、圖片與 PDF

**整合**

- POST 合法電費 201；各非法 payload 400 且訊息與舊版相同
- PATCH 只能改 paid_at；嘗試改 amount 被忽略或 400（依舊版）
- DELETE 軟刪除：deleted_at/deleted_by 有值，GET 不再回傳
- GET 篩選 month/type/storeId 結果與舊 API 相同；limit 500
- 角色矩陣：manage 全 200；view 讀 200 寫 403；無權 403；未登入 401
- 附件 UTILITY_BILL/BILL_DOCUMENT 上傳與刪除（ga_soft_delete_resource_attachment）

**E2E**

- 新增網路費：只填設備序號 → 成功；新增水費不填識別號 → 錯誤訊息
- 新增電費同時上傳 2 張照片 → 帳單列出 → 附件面板顯示 2 檔
- 標記已繳 → 待繳金額下降 → 改回待繳
- 刪除（confirm）→ 消失；切換月份/據點/類型篩選
- 前往費用報表連結

**對等驗證**

- L/V 相同輸入新增 4 類帳單、標記繳費、刪除 1 筆，比對 ga_utility_bills 欄位
- GET 回應正規化比對；三摘要數字一致

**測試資料**

- 門市 A、B 及非門市據點『QA-GA2 總部』；當月與前月帳單各類型 1 筆，含逾期未繳 1 筆
- 角色：utility_bill.manage、utility_bill.view、plain_staff
- 測試 jpg、pdf、21MB 檔

**風險**

- 逾期判斷依台北日期，CI 時區需固定

## /general-affairs/utility-bills/report

- 狀態：**missing**（M）— 無 Vue 頁與 workspace API。
- 舊版：`app/general-affairs/utility-bills/report/page.tsx -> components/general-affairs/expenses/UtilityBillsReportClient.tsx + app/api/general-affairs/utility-bills/report/route.ts`
- Vue：（無）
- 權限：general_affairs.utility_bill.view 或 manage（canViewUtilityBills）
- 相依：utility-bills 帳單頁（共用外殼）

**舊版功能**

- 期間模式切換：月／季／年，年度輸入（2000–2100）、季度選擇、月份選擇
- 期間總額橫幅：期間總支出與水／電／電話／網路各項合計
- 各據點費用明細表（sticky 首欄）與全據點合計列；無帳單時顯示啟用據點金額 0 並提示
- 載入／錯誤重試、說明『依帳單月份加總，含已繳與未繳，已刪除不列入』
- 返回帳單連結

**缺少或不同**

- 整頁缺 Vue 版與 workspace API

**業務規則**

- month 模式 period 必須符合 YYYY-MM 且年份一致；quarter／year 的日期區間由 dateRange 計算
- 報表包含啟用據點，即使無帳單也列出
- bill_count 以未刪除帳單計

**API**：舊 /api/general-affairs/utility-bills/report?mode=&year=&period=；新 —

**資料表**：ga_utility_bills、stores

**既有測試**：scripts/test-general-affairs-utility-bills.js

**待確認**

- report/route.ts 在範圍內只讀了前 30 行（日期區間與型別），季度與彙總邏輯細節未讀

### 測試案例

**冒煙**

- utility_bill.view 帳號開 #/general-affairs/utility-bills/report：月/季/年切換、總額橫幅、據點明細表與合計列
- 錯誤時重試按鈕可用

**單元**

- 抽出 dateRange(params)（report/route.ts 19 行）：month 12 月跨年 end=次年-01-01；period 年份不符拋錯；quarter 1–4 起訖；year；year<2000 或 >2100 拋錯；未知 mode 拋錯
- 彙總函式：各據點四類合計、全據點合計、無帳單的啟用據點列 0、已刪除不列入、bill_count

**整合**

- GET report?mode=month|quarter|year 與舊 API deep-equal
- 非法參數 400 訊息一致；無權 403；未登入 401

**E2E**

- 切換月 → 季 → 年，總額橫幅與明細合計列數字相符 seed 期望值；無帳單期間顯示 0 與提示

**對等驗證**

- 三種模式各 2 個期間舊新 API 回應比對；畫面合計列一致

**測試資料**

- 沿用 utility-bills seed，另加 12 月與次年 1 月帳單驗證跨年、1 筆已刪除帳單

**風險**

- 季度彙總細節未全讀（uncertain）

## 領域測試備註

【全域測試規範（各頁共用，Sonnet 實作前必讀）】
1. 環境與安全閘：DEV 連線資訊在 .env.development.local（NEXT_PUBLIC_SUPABASE_URL／SUPABASE_SERVICE_ROLE_KEY／EXPECTED_SUPABASE_PROJECT_REF／ALLOW_DEV_DATABASE_OPERATIONS）。所有會寫 DB 的 seed／integration／e2e 腳本開頭必須斷言 URL 內含 EXPECTED_SUPABASE_PROJECT_REF 且 ALLOW_DEV_DATABASE_OPERATIONS=true，否則 exit 1（沿用 scripts/test-general-affairs-*-dev.js 既有做法）。伺服器基準 http://localhost:3002，Vue 版以 hash 路由（createWebHashHistory）開啟；workspace API 登入沿用 scripts/test-workspace-employee-create-api.py 的模式：讀 .tmp-check/workspace-accounts.json，POST /api/workspace/login 取得 cookie context，Origin header 必帶。
2. 測試資料命名：所有 seed 資料以前綴 QA-GA2- 命名（名稱、代碼、request title、vendor name、bill notes），fixture 輸出到 .tmp-check/ga2-<page>-fixture.json，每支腳本結束只清除自己建立、帶前綴的資料（軟刪除表用 deleted_at，或 service role 硬刪測試列），不得動到非前綴資料。
3. 角色帳號矩陣（建議新增到 workspace-accounts.json，key 固定）：ga_admin（全部 general_affairs.* 含 service_center.access/force_close）、ga_viewer（service_center.access + 各 *.view，無 manage/update）、ga_inventory_clerk（inventory_* view/manage + part.view，無 request.manage）、ga_no_part（inventory_transaction.manage 但無 part.view）、ga_purchaser（purchase_review.view/manage + part_fulfillment.view/manage）、ga_maint_staff（work_order.view_all/update、maintenance_request.update）、ga_legacy_maint（僅 cross_dept.maintenance.view_all/update 相容舊權限）、store_mgr_A（store_managers 綁門市 A，request.create/view_own_store/comment_own_store/confirm_own_store、work_order.view_own_store）、store_mgr_B（綁門市 B，同權限）、ga_no_access（擁有 inventory_balance.view 等但缺 service_center.access）、plain_staff（無任何 general_affairs 權限）。
4. 測試層定義：unit = 把舊版 component/route 內的純函式抽到 lib/workspace/general-affairs/*.ts（或直接 import lib/general-affairs/**/validation.ts），用 node 腳本 scripts/test-workspace-ga2-<page>.cjs 斷言輸入輸出，且同一組輸入要同時餵舊函式（必要時以 TS 轉譯或複製快照）與新函式比對結果相同；integration = scripts/test-workspace-ga2-<page>-api.py 打 /api/workspace/general-affairs/**（並對照舊 /api/general-affairs/**）＋ service role 查 DB 驗證寫入；e2e = scripts/test-workspace-ga2-<page>-ui.py（Python Playwright, 1920x1080，收 console error 與 pageerror，截圖存 .tmp-check/ga2-<page>-*.png）。
5. 一致性（parity）通則：(a) 讀取比對：同帳號 cookie 分別呼叫舊 API 與 workspace API，對回應做正規化（移除 created_at/updated_at 毫秒差、依 id 排序、忽略 meta.timing）後 deep-equal；(b) 寫入比對：同一 seed 複製兩份（QA-GA2-L-* 給舊版、QA-GA2-V-* 給 Vue），各自走一次完整流程後，查 DB 比對「狀態欄、數量欄、產生的 event_type 序列、ga_inventory_transactions 的 transaction_type/quantity_delta/before/after、maintenance_* 同步列」，排除 id、單號流水號、時間；(c) 畫面比對：同帳號開舊頁與 Vue 頁，抽取 KPI 數字、列表筆數、前 N 列關鍵欄位文字比對；(d) 權限比對：角色矩陣每格對舊 API 與 workspace API 的 HTTP status 必須相同（200/401/403/404）。
6. 已確認的重要舊版事實（測試需依此斷言，不可「修正」）：庫存／調撥／出庫／到貨入庫全部經 RPC ga_post_inventory_transaction（app/api/general-affairs/inventory/transactions/post/route.ts、transfers/[id]/actions/route.ts 124/186 行、requests/[id]/stock-issue 107 行、purchase-receipt 128 行）；持有狀態走 RPC ga_set_inventory_holding_allocation；位置／位置料件刪除走 ga_soft_delete_inventory_location(_part)；採購單號 ga_next_purchase_order_no。廠商統計 vendorStats（GeneralAffairsServiceCenterClient.tsx 876 行）的 completedWorkOrders = Math.round(totalWorkOrders * 0.86) 是寫死估算，avgDays/avgRating 只取 rating>0 的廠商平均，categoryStats.recent = sort_order<=2 筆數（並非真的『近期』）——功能一致要求 Vue 照抄，並在報告標註為既有不合理邏輯待業務決定。
7. 尚未存在的東西：目前沒有任何 workspace general-affairs API 與 Vue 頁，所有 integration/e2e 案例以「預計路徑」撰寫：API 前綴建議 /api/workspace/general-affairs/...，Vue 路由建議 #/general-affairs/...；實作時若路徑不同需同步修改測試。廠商三頁舊版靠瀏覽器 supabase client + RLS（migration 20260824090000_general_affairs_vendor_permissions_rls.sql），權限 parity 需以 anon key + 使用者 JWT 直接查表對照 workspace API 結果。
8. 建議測試執行順序同復刻順序：位置→庫存交易→調撥→reports/new→reports/mine→requests→part-fulfillments→work-orders→vendors 五頁→utility-bills 兩頁→首頁；part-requests 與 part-requests/new 為 exclude，只需在 reports/* 的 smoke 加一條舊網址重導檢查。
9. uncertain：maintenance_progress_stages 實際表名、ga_vendors 是否有 total_amount/avg_days 欄位、ga_service_categories 狀態值、region_type 完整值、assign 動作是否真的寫 DB，Sonnet 實作前需先以 service role 查 information_schema 與讀對應 route 確認，再固定斷言。
