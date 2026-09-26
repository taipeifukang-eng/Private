# DEV RBAC / General Affairs Handoff

本文件供後續 AI 開發代理接手使用。請先讀完本文件與 `.github/copilot-instructions.md`，再進行任何實作或資料庫操作。

## 最新小任務：新增設施正式 4 Step 表單重構

完成狀態：**本機實作、靜態測試、TypeScript、build 與 diff check 通過，待人工 UI 複驗。**

更新時間：2026-08-10

任務背景：

- 使用者確認「新增設施」應依正式 UX 方向重構，不應只是既有簡單單頁表單。
- 正式流程為：
  1. 基本資訊
  2. 位置資訊
  3. 維護與保固資訊
  4. 確認建立
- 設施可能有保固，不能因為 `resource_type = facility` 就假設沒有保固。
- 不得新增不存在的 DB 欄位後直接送 API；若 schema 不足，先用已存在欄位收斂 UI 並記錄缺口。

修改檔案：

- `components/general-affairs/facilities/FacilityCreatePageClient.tsx`
- `scripts/test-general-affairs-facility-form-ui.js`
- `scripts/test-general-affairs-asset-form-validation.js`
- `scripts/test-general-affairs-asset-management-ui.js`
- `scripts/test-general-affairs-role-matrix-dev.js`
- `scripts/test-general-affairs-maintenance-ui.js`
- `scripts/test-general-affairs-maintenance-views.js`
- `scripts/test-general-affairs-dashboard-ui.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

ga_facilities 現有欄位盤點：

| 欄位 | UI 需要 | DB 存在 | API 支援 | 本輪處理 |
| --- | --- | --- | --- | --- |
| `name` | 是 | 是 | 是 | Step 1 必填 |
| `category_id` | 是 | 是 | 是 | Step 1 必填，三層分類選擇 |
| `store_id` | 是 | 是 | 是 | Step 2 必填，依 stores RLS / scope |
| `area` | 是 | 是 | 是 | Step 2 必填，使用標準選項 + 自由輸入 |
| `location_detail` | 是 | 是 | 是 | Step 2 必填 |
| `status` | 是 | 是 | 是 | 使用既有 `FACILITY_STATUSES` |
| `criticality` | 是 | 是 | 是 | 重要程度沿用 `FACILITY_CRITICALITIES` |
| `description` | 是 | 是 | 是 | Step 1 非必填 |
| `tags` | 是 | 是 | 是 | Step 1 非必填 |
| `brand` | 視分類需要 | 否 | 可透過 `specs` | Step 1 optional，保存為 `facility_brand` |
| `model` | 視分類需要 | 否 | 可透過 `specs` | Step 1 optional，保存為 `facility_model` |
| `installed_at` | 是 | 是 | 是 | Step 3 建置／啟用日期 |
| `last_renovated_at` | 是 | 是 | 是 | Step 3 最近整修日期 |
| `has_warranty` | 是 | 否 | 可透過 `specs` | Step 3 required choice，保存為 `facility_has_warranty` |
| `warranty_start_date` | 有保固時需要 | 否 | 可透過 `specs` | 保存為 `facility_warranty_start_date` |
| `warranty_end_date` | 有保固時需要 | 否 | 可透過 `specs` | 保存為 `facility_warranty_end_date` |
| `warranty_description` | 是 | 否 | 可透過 `specs` | 保存為 `facility_warranty_description` |
| `notes` | 是 | 是 | 是 | Step 3 非必填 |
| `image_path` | 設施圖片 | 是但本輪不直接送 | API 支援相對 path | 本輪使用正式 attachment API，不寫 fake image_path |
| `quantity` / `unit` | 本輪不需要 | 是 | 是 | 新增設施表單不顯示 |
| `is_fixed_asset` | 本輪不需使用者選 | 是 | 是 | 建立時固定送 `true` |

UI / API / DB 影響：

- UI：
  - `/general-affairs/facilities/new` 改為 4-step 表單。
  - 使用 `GeneralAffairsPageHeader` 與 `GeneralAffairsFormPage`。
  - Desktop Stepper 水平顯示；Mobile 顯示 `x / 4` 與進度條。
  - 設施分類使用逐層分類選擇，不使用單一下拉。
  - Store area 使用 datalist 標準選項，但仍送既有 `area` text 欄位，不建立 fake `store_area_id`。
  - `是否全店共用設施` 尚無正式欄位，本輪不顯示 checkbox、不送 API。
  - 品牌 / 型號 optional，不要求所有設施必填。
  - 保固支援「無保固 / 有保固」切換。
  - 有保固時必填保固開始與到期日期。
  - 無保固時會清除隱藏保固欄位，避免殘留資料送出。
  - 設施圖片與保固文件可先選檔；建立設施成功取得 id 後才上傳。
  - 建立成功後導向 `/general-affairs/facilities?createdFacilityId=<id>`。
- API：
  - 使用既有 `POST /api/general-affairs/facilities`。
  - 使用既有 `POST /api/general-affairs/attachments`。
  - 未修改 API contract。
- DB / RLS / RPC：
  - 未新增或修改 migration。
  - 未修改 DB schema、RLS、RPC、grants。
  - 未執行 db push、repair、reset、rollback 或 Production 操作。

保固欄位策略：

- 本輪沒有建立正式保固欄位。
- 暫時保存於 `ga_facilities.specs`：
  - `facility_brand`
  - `facility_model`
  - `facility_floor_area_description`
  - `facility_has_warranty`
  - `facility_warranty_start_date`
  - `facility_warranty_end_date`
  - `facility_warranty_claim_method`
  - `facility_warranty_description`
  - `facility_warranty_claim_notes`
- 若未來要正式升級，需要最小 forward migration 草案：
  - 加入 `brand text null`
  - 加入 `model text null`
  - 加入 `has_warranty boolean not null default false`
  - 加入 `warranty_start_date date null`
  - 加入 `warranty_end_date date null`
  - 加入 `warranty_description text null`
  - CHECK：`has_warranty = false` 時日期可為 null；`has_warranty = true` 時 start / end 需有值且 `start <= end`
  - 同步 API validation、catalog test、dynamic test
  - 不改 RLS scope

驗證 UX：

- 每個 Step 只驗證目前 Step。
- 確認建立時驗證所有 Step。
- Validation Summary 顯示中文錯誤。
- 錯誤會自動切換到對應 Step。
- 錯誤欄位會 `scrollIntoView` 並 `focus()`。
- `saving` 中阻止 double click 重複建立。
- API failure 保留輸入內容。
- 附件 failure 不會覆蓋「設施已建立」事實，訊息顯示為：`設施已新增，但附件上傳失敗：...`

測試與 build 結果：

- `node --check scripts/test-general-affairs-facility-form-ui.js`：passed。
- `node scripts/test-general-affairs-facility-form-ui.js`：passed。
- `node scripts/test-general-affairs-asset-form-validation.js`：passed。
- `node scripts/test-general-affairs-asset-management-ui.js`：passed。
- `node scripts/test-general-affairs-role-matrix-dev.js`：passed。
- `node scripts/test-general-affairs-maintenance-ui.js`：passed。
- `node scripts/test-general-affairs-maintenance-views.js`：passed。
- `node scripts/test-general-affairs-ui-foundation.js`：passed。
- `node scripts/test-general-affairs-dashboard-ui.js`：passed。
- `npx tsc --noEmit --pretty false`：passed。
- `npm run build`：passed。
  - 仍有既有 Dynamic server usage 訊息，但不是 build failure。
- `git diff --check`：passed，只有既有 LF/CRLF warning。

發現問題：

- `scripts/test-general-affairs-asset-form-validation.js` 原本不存在；本輪新增為共通資產表單靜態驗證。
- 多個舊回歸測試仍保留上一版 IA 或附件假流程限制：
  - `inventory` 舊 id 已改為 `inventory-overview`。
  - Sidebar 已允許 `新增料件申請` / `我的料件申請` compatibility entries，但不建立獨立 material table。
  - 維修 UI 已可使用正式 `ResourceAttachmentPanel`，不再把「共用附件」視為假流程。
  - Dashboard 不再要求 `canAccessEquipmentTemplates` 作為首頁快捷權限。
  - 已同步測試，不改 DB 或 API。

尚未完成事項：

- 尚未人工 UI 複驗 `/general-affairs/facilities/new`。
- 尚未將保固欄位升級為正式 DB 欄位；目前是 `specs` 相容保存。
- 尚未執行 `supabase/test_general_affairs_resource_attachments.sql`。
- 尚未做附件 authenticated 動態驗收與 Storage policy 驗收。

下一個最小任務：

**人工複驗新增設施 4 Step 表單。**

人工驗收清單：

- 一般設施：調劑區天花板，不填品牌 / 型號、無保固，可建立。
- 有保固設施：門市正門鐵捲門，填品牌 / 型號 / 建置日期 / 保固起訖 / 附件，可建立。
- 驗證缺設施名稱、缺分類、缺門市、缺門市區域、缺詳細位置。
- 驗證有保固但缺日期、保固開始晚於到期。
- 驗證錯誤會切到對應 Step、scroll、focus 並顯示中文錯誤。
- 驗證 Desktop / Tablet / Mobile 無水平 overflow。

禁止事項：

- 不得把 `specs` 相容保存誤稱為正式 DB 欄位。
- 不得修改已套用 migration。
- 不得執行 db push、repair、reset、rollback。
- 不得連 Production。
- 不得開始正式料件申請、調撥、盤點、採購或工單扣料，除非使用者明確批准。

## 最新小任務：總務服務中心左側 Sidebar IA 收斂

完成狀態：**本機實作、靜態測試與 TypeScript 通過，待人工 UI 複驗。**

更新時間：2026-08-10

任務背景：

- 使用者要求左側 Sidebar 依正式業務邏輯重新整理為：
  - `工作台`
  - `我的申請`
  - `作業管理`
  - `資產與庫存`
  - `合作廠商`
- 目標是讓總務服務中心的入口更接近正式業務流程，而不是把設備、設施、料件、庫存與廠商散落在同一層。
- 本輪只調整導覽與已存在的頁面入口，不建立未完成業務流程的假頁面。

修改檔案：

- `components/general-affairs/navigation.tsx`
- `components/general-affairs/features.ts`
- `components/general-affairs/GeneralAffairsSidebar.tsx`
- `components/general-affairs/assets/AssetCategoryManagementClient.tsx`
- `components/general-affairs/service-center/GeneralAffairsServiceCenterClient.tsx`
- `app/general-affairs/parts/categories/page.tsx`
- `scripts/test-general-affairs-ui-foundation.js`
- `scripts/test-general-affairs-asset-management-ui.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

新 Sidebar 結構：

- `工作台`
  - `服務首頁`
- `我的申請`
  - `新增回報`
  - `我的回報`
  - `新增料件申請`
  - `我的料件申請`
- `作業管理`
  - `工單中心`
  - `料件申請審核`
  - `調撥與收貨`
  - `盤點作業`
- `資產與庫存`
  - `設備管理`
    - `設備列表`
    - `設備分類`
    - `新增設備`
    - `設備範本`
    - `保固管理`
    - `維修紀錄`
  - `設施管理`
    - `設施列表`
    - `設施分類`
    - `新增設施`
    - `維修紀錄`
  - `料件管理`
    - `料件列表`
    - `料件分類`
    - `新增料件`
    - `相容性管理`
    - `使用紀錄`
  - `庫存管理`
    - `庫存總覽`
    - `庫存位置`
    - `庫存流水`
    - `盤點`
- `合作廠商`
  - `廠商資料`
  - `服務分類`
  - `服務區域`
  - `合作紀錄`

API / UI / DB 影響：

- UI：
  - 沿用既有 `GENERAL_AFFAIRS_NAV_GROUPS` 與 `GeneralAffairsSidebar`。
  - 父項目只負責展開 / 收合，沒有 standalone href。
  - 已建置 route 保持可點擊。
  - 尚未完成流程以 feature availability 顯示為規劃中或未開放，不可點擊。
  - Sidebar disabled leaf item 顯示 `規劃中` 或 `未開放` 小標籤。
  - `新增料件申請` 暫行導向既有維修回報表單，並預設 `resource_type = material`。
  - `我的料件申請` 保留相容入口，實際仍走「我的回報」並套用料件 / 耗材 filter。
- API：
  - 未新增或修改 API contract。
  - 未放寬既有 route / API 權限。
- DB / RLS / RPC：
  - 未新增或修改 migration。
  - 未修改 DB schema、RLS、RPC、grants。
  - 未執行 db push、repair、reset、rollback 或 Production 操作。

Feature availability：

- 新增或調整 feature key：
  - `part_request_create`
  - `inventory_overview`
  - `part_categories`
  - `part_new`
  - `part_usage_history`
- `新增料件`、`使用紀錄`、`盤點`、`料件申請審核`、`調撥與收貨` 等未完成流程不可點擊。
- `相容性管理` 目前暫不開放為獨立頁面；不可顯示成可操作流程。

測試與檢查結果：

- `node --check scripts/test-general-affairs-ui-foundation.js`：passed。
- `node scripts/test-general-affairs-ui-foundation.js`：passed。
- `node --check scripts/test-general-affairs-asset-management-ui.js`：passed。
- `node scripts/test-general-affairs-asset-management-ui.js`：passed。
- `npx tsc --noEmit --pretty false`：passed。
- 本輪尚未重新執行 `npm run build`。

發現問題與修正：

- `scripts/test-general-affairs-ui-foundation.js` 原先保留舊 IA 預期：
  - 認為 `新增設備` 與 `設備範本` 不應出現在 Sidebar。
  - 認為 inventory active item id 為舊的 `inventory`。
  - 已改為新 IA：`equipment-new`、`equipment-templates` 可見，`inventory-overview` 作為庫存總覽 active item。
- 測試 helper 原先會把 child href 誤算進 parent item block，造成「父項目不應導航」誤判；已改為只檢查 parent header block。

尚未完成事項：

- 尚未人工 UI 複驗新版 Sidebar：
  - 群組順序。
  - 展開 / 收合。
  - planned / unavailable 不可點擊。
  - Desktop / Mobile 一致。
  - 權限過濾仍符合 effective permissions。
- 正式料件申請、料件申請審核、調撥與收貨、盤點、料件使用紀錄仍未完成。

下一個最小任務：

**人工複驗新版總務左側 Sidebar IA。**

禁止事項：

- 不得因 Sidebar 有 planned 項目就建立空白頁或假流程。
- 不得修改已套用 migration。
- 不得執行 db push、repair、reset、rollback。
- 不得連 Production。
- 不得開始正式料件申請、調撥、盤點、採購或工單扣料，除非使用者明確批准。

## 最新小任務：料件列表 Client restored / 本機 type-check 阻擋解除

完成狀態：**本機實作、靜態測試、TypeScript、build 與頁面 200 驗證完成。**

更新時間：2026-08-10

任務背景：

- `/general-affairs/parts` 對應的 `components/general-affairs/parts/PartsClient.tsx` 在本機為 0-byte 空檔。
- `app/general-affairs/parts/page.tsx` 匯入該檔後，`npx tsc --noEmit --pretty false` 會失敗：
  - `File ... PartsClient.tsx is not a module.`
- 這會阻擋後續任何總務服務中心小任務的可靠驗證。

修改檔案：

- `components/general-affairs/parts/PartsClient.tsx`
- `scripts/test-general-affairs-asset-management-ui.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

UI / API / DB 影響：

- 補回可用的料件列表 Client。
- 使用既有 API：
  - `GET /api/general-affairs/parts`
- 未新增或修改 API contract。
- 未新增或修改 DB schema、migration、RLS、RPC 或 grants。
- 未執行 db push、repair、reset、rollback 或 Production 操作。

料件列表 Client 內容：

- 使用 `GeneralAffairsPageHeader`。
- 顯示 Breadcrumb：
  - `首頁 / 總務服務中心 / 料件管理 / 料件列表`
- 顯示：
  - 料件列表標題與說明。
  - 到 `庫存管理`、`庫存位置` 的入口。
  - 搜尋欄。
  - 啟用 / 停用狀態篩選。
  - KPI 摘要。
  - Desktop 表格。
  - Mobile 卡片。
  - 分頁。
- 權限不足時不放寬安全控制，只顯示 API 回傳的權限錯誤與明確提示。
- 不顯示假料件、假庫存、假數字或 hardcoded business data。

靜態測試更新：

- `scripts/test-general-affairs-asset-management-ui.js` 新增 `parts list client restored` 驗證：
  - `app/general-affairs/parts/page.tsx` 必須匯入 `PartsClient`。
  - `PartsClient.tsx` 必須是 client component。
  - 必須串接 `/api/general-affairs/parts?`。
  - 必須使用 `GeneralAffairsPageHeader`。
  - 必須有 `料件列表`、`庫存管理`、`庫存位置`。
  - 必須保留 `沒有料件查看權限` 提示。
  - 不得使用 `Math.random`、`db push` 等假資料或 DB 操作。

測試與 build 結果：

- `node scripts/test-general-affairs-resource-attachments.js`：passed。
- `node --check scripts/test-general-affairs-ui-foundation.js`：passed。
- `node scripts/test-general-affairs-ui-foundation.js`：passed。
- `node --check scripts/test-general-affairs-asset-management-ui.js`：passed。
- `node scripts/test-general-affairs-asset-management-ui.js`：passed。
- `npx tsc --noEmit --pretty false`：passed。
- `git diff --check -- components/general-affairs/parts/PartsClient.tsx scripts/test-general-affairs-asset-management-ui.js`：passed。
- `/general-affairs/parts`：本機 dev server 回應 200。
- `npm run build`：passed。
  - 仍有既有 Dynamic server usage 訊息，但不是 build failure。

發現問題：

- `node --check` 不能直接檢查 `.tsx` 檔，會回 `ERR_UNKNOWN_FILE_EXTENSION`；TSX 語法與型別應以 `tsc` / `next build` 驗證。
- 第一次 `npm run build` 因本專案 dev server 仍佔用 `.next/trace` 而出現 `EPERM`；停止本專案 Next dev 程序後重跑 build 即通過。

尚未完成事項：

- 尚未執行 `supabase/test_general_affairs_resource_attachments.sql`。
- 尚未做附件 authenticated dynamic verification。
- 尚未人工 UI 驗收設備、設施、維修回報附件上傳 / 預覽 / 刪除。
- 尚未人工複驗 `/general-affairs/parts` 料件列表畫面細節。

下一個最小任務：

**附件基礎 catalog SQL 與 DEV 動態 / 人工 UI 驗收。**

禁止事項：

- 不得連 Production。
- 不得修改已套用 migration。
- 不得執行 repair / reset / rollback。
- 不得使用 service role 繞過 authenticated API / RLS 驗收。
- 不得開始 UI-5、正式料件申請、採購、調撥、盤點、工單扣料，除非使用者明確批准。

## 最新小任務：Task UI-3B 我的回報與工單中心單一資料來源及介面收斂

完成狀態：**本機實作完成，靜態測試、TypeScript、build 與 diff check 通過，待人工 UI 驗收。**

更新時間：2026-07-27

任務背景：

- UI-3 / UI-3A 驗收發現資訊架構重複：
  - 「我的回報」應讓店長 / 督導追蹤自己或所屬門市提出的設備、設施、料件／耗材回報。
  - 「料件／耗材回報紀錄」被做成獨立入口，實際只是在查 `maintenance_requests.resource_type = material`。
  - 店長若要看設備 / 設施進度，容易被迫進入「工單中心」。
- 最新產品決策：
  - 「我的回報」是 requester / 店長 / 督導唯一追蹤入口。
  - 「工單中心」是總務端處理入口。
  - 兩者共用同一份 maintenance request 主資料、status mapping、updates 與 progress stages。
  - material 只是 resource type filter，不是獨立追蹤流程。

修改檔案：

- `components/general-affairs/service-center/GeneralAffairsServiceCenterClient.tsx`
- `components/general-affairs/navigation.tsx`
- `scripts/test-general-affairs-maintenance-views.js`
- `scripts/test-general-affairs-maintenance-ui.js`
- `scripts/test-general-affairs-availability.js`
- `scripts/test-general-affairs-role-matrix-dev.js`
- `scripts/test-general-affairs-dashboard-ui.js`
- `docs/GENERAL-AFFAIRS-UX-BLUEPRINT.md`
- `docs/DEV-RBAC-HANDOFF.md`
- `docs/CURRENT-DEV-STATUS.md`
- `.github/copilot-instructions.md`

資料來源矩陣：

| 頁面 | API | Table / View | Filter | 使用者範圍 | 是否重複 |
| --- | --- | --- | --- | --- | --- |
| 新增維修回報 | `POST /api/maintenance-requests`、`POST /api/maintenance-photos` | `maintenance_requests`、maintenance photos | `resource_type` 由表單送出 | API guard + RLS / store scope | 否 |
| 我的回報 | `GET /api/maintenance-requests`、`GET /api/maintenance-updates`、`GET /api/maintenance-progress-stages`、`GET /api/maintenance-photos` | `maintenance_requests` + updates / stages / photos | 日期、status、resource_type、store、keyword | requester / store_manager / supervisor scope 由 API / RLS 控制 | 否 |
| 舊料件／耗材紀錄 | 同「我的回報」 | 同「我的回報」 | 相容套用 `resource_type = material` | 同「我的回報」 | 不再作為獨立主流程 |
| 工單中心 | `GET /api/maintenance-requests`、`POST /api/maintenance-updates`、photos / stages APIs | 同一批 `maintenance_requests` + updates | 日期、status、store、keyword | work-order permissions + API / RLS scope | 否 |
| 工單詳情 | 同頁內 detail drawer 讀同一批 requests / updates / photos | 同一資料來源 | selected request id | 不擴大前端 scope | 否 |

API / UI / DB 影響：

- API：
  - 未新增 API。
  - 未修改 `/api/maintenance-requests`、`/api/maintenance-updates`、`/api/maintenance-progress-stages`、`/api/maintenance-photos` contract。
- UI：
  - 移除 Sidebar 中獨立「料件／耗材回報紀錄」nav item。
  - 舊 `section=part-requests` 保留相容，但自動切回 `maintenance` / `mine` 並套用 `reportResourceFilter = material`。
  - `renderPartRequestRecords()` 不再保有獨立列表邏輯，只回用 `renderMyReports()`。
  - 「我的回報」重構為正式工單追蹤介面：
    - breadcrumb
    - page header
    - 狀態頁籤
    - KPI 摘要卡
    - 篩選工具列
    - 桌面表格
    - mobile card list
    - 分頁
    - detail drawer
  - 移除假未來進度節點「等待廠商到場」，避免前端虛構尚未支援的派工事件。
- DB / RLS / RPC：
  - 未新增或修改 migration。
  - 未修改 DB schema、RLS、RPC、grants。
  - 未執行 `db push`、`repair`、`reset`、rollback。

我的回報 UI 規則：

- Header 文案：`查看您或所屬門市提出的設備、設施與料件／耗材回報及處理進度`。
- 狀態與顏色使用 `components/general-affairs/maintenance/status.ts`。
- KPI 數字由目前可見且查詢成功的 requests 計算，不使用假數字。
- API failure 不顯示為 0；仍走 shared error state。
- Store scope 只依 API / RLS 回傳，不由前端自行擴大。
- 詳情只顯示公開更新紀錄；店長 / 督導不得看到總務內部管理欄位。
- Mobile 改為卡片，不使用超寬表格。

測試與檢查結果：

```powershell
node --check scripts/test-general-affairs-maintenance-views.js
node scripts/test-general-affairs-maintenance-views.js
node scripts/test-general-affairs-role-matrix-dev.js
node scripts/test-general-affairs-maintenance-ui.js
node scripts/test-general-affairs-ui-foundation.js
node scripts/test-general-affairs-dashboard-ui.js
npx tsc --noEmit --pretty false
npm run build
git diff --check
```

結果：

- `node --check scripts/test-general-affairs-maintenance-views.js`：通過。
- `node scripts/test-general-affairs-maintenance-views.js`：通過。
- `node scripts/test-general-affairs-role-matrix-dev.js`：通過。
- `node scripts/test-general-affairs-maintenance-ui.js`：通過。
- `node scripts/test-general-affairs-ui-foundation.js`：通過。
- `node scripts/test-general-affairs-dashboard-ui.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過；仍有既有 `DYNAMIC_SERVER_USAGE` 訊息，非本輪 failure。
- `git diff --check`：通過；只有既有 CRLF warning。

發現問題：

- 歷史文件中仍保留先前「申請料件入口可見性修正」與「料件/耗材回報紀錄」歷史紀錄。那是過往狀態，不代表目前產品決策。
- 正式料件申請 DB / API / UI 仍未建立；在正式流程批准前，不得把 material 回報再拆回獨立追蹤主流程。

尚未完成事項：

- 需要人工 UI 驗收：
  - 店長 / 督導只透過「我的回報」追蹤設備、設施、料件／耗材。
  - 可用資源類型篩選切換 material，不需進另一頁。
  - 工單中心更新狀態後，我的回報同步顯示。
  - 店長 / 督導不顯示工單中心，除非具備正式 work-order 權限。
  - Desktop 1440px 可理解完整資訊密度；Mobile 無水平 overflow。
  - 無假 KPI、假進度、假預計完成。

下一個最小任務：

**人工驗收 Task UI-3B：我的回報與工單中心 IA / UI 收斂。**

禁止事項：

- 不得開始 UI-4。
- 不得建立正式料件申請資料表或 API，除非使用者另行批准。
- 不得修改已套用 migration。
- 不得連 Production。
- 不得用 email、role name、職稱文字或 `profiles.role` 判斷可見性。

## 前一小任務：測試區門市管理儲存修正

完成狀態：**本機實作完成，靜態測試、TypeScript 與 build 通過，待人工 UI 複驗。**

更新時間：2026-07-27

任務背景：

- 使用者回報測試區「門市管理」仍無法真正編輯成功並儲存成想要的內容。
- 檢查後確認 DEV `stores` schema 已包含正式區核心欄位：`store_code`、`store_name`、`short_name`、`hr_store_code`、`manager_name`、`address`、`phone`、`is_active`、`is_franchise`、`source_store_id`。
- 因此本次問題不是欄位缺失，而是 server action 使用 authenticated user client 直接更新 `stores` 時會被 DEV RLS 擋住。

修改檔案：

- `app/store/actions.ts`
- `scripts/test-store-scope-management-rbac.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

API / UI / DB 影響：

- API / Server Action：
  - `getStoreForAdminEdit()`：登入與 RBAC 檢查仍使用使用者 session；通過後用 `createAdminClient()` 讀取單一門市。
  - `createStore()`：登入與 `store.store.create` / `store.manage` RBAC guard 通過後，用 `createAdminClient()` 建立門市。
  - `updateStore()`：登入與 `store.store.edit` / `store.manage` RBAC guard 通過後，用 `createAdminClient()` 更新門市。
- UI：
  - 未改表單欄位與操作流程。
  - 修正後 `/admin/stores/[id]/edit` 的儲存應可寫入 DEV `stores`。
- DB：
  - 未新增 migration。
  - 未修改 DB schema、RLS、RPC、grants。
  - 未執行 `db push`、`repair`、`reset`、rollback。

安全模型：

- 前端仍不直接寫 `stores`。
- `createAdminClient()` 只在 server action 內、RBAC guard 通過後使用。
- 這是後台管理寫入的 server-side escalation，不等於用 service role 繞過 UI / API / RLS 驗收。
- 無 `store.store.create` / `store.store.edit` / `store.manage` 的帳號仍會被 server action 擋住。

驗證結果：

```powershell
node --check scripts/test-store-scope-management-rbac.js
node scripts/test-store-scope-management-rbac.js
npx tsc --noEmit --pretty false
npm run build
```

結果：

- `node --check scripts/test-store-scope-management-rbac.js`：通過。
- `node scripts/test-store-scope-management-rbac.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過；仍有既有 `DYNAMIC_SERVER_USAGE` 訊息，非本輪 failure。

尚未完成事項：

- 需要人工 UI 複驗：
  - full admin 或具 `store.store.edit` / `store.manage` 的帳號可編輯門市並成功儲存。
  - 儲存後回列表，再進編輯頁可看到剛才更新的內容。
  - 無門市管理權限帳號不可新增 / 編輯。

下一個最小任務：

**人工複驗測試區門市管理新增 / 編輯儲存。**

禁止事項：

- 不得為此修正新增 stores migration；目前欄位已齊。
- 不得改成前端 Supabase client 直接更新 `stores`。
- 不得用 `profiles.role` 取代正式 RBAC guard。
- 不得連 Production。

## 前一小任務：總務服務中心料件/耗材入口收斂

完成狀態：**本機實作完成，靜態測試、TypeScript 與 build 通過，待人工 UI 複驗。**

更新時間：2026-07-27

任務背景：

- 使用者確認目前「維修回報」與「新增料件申請」頁面是一模一樣。
- 產品決策：只保留「維修回報」作為新增入口；若需求是料件或耗材，在維修回報基本資訊中選擇資源類型「料件 / 耗材」即可。
- 「料件申請紀錄」不再代表獨立申請流程，改為 maintenance-backed 的料件/耗材回報紀錄檢視。

修改檔案：

- `components/general-affairs/navigation.tsx`
- `components/general-affairs/service-center/GeneralAffairsServiceCenterClient.tsx`
- `scripts/test-general-affairs-availability.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

API / UI / DB 影響：

- API：
  - 未新增或修改 API contract。
  - 仍使用既有 `/api/maintenance-requests`、`/api/maintenance-photos` 及維修相關 API。
- UI：
  - 移除 Navbar / 總務導覽中的獨立「新增料件申請」入口。
  - 移除 `/general-affairs?section=part-requests&action=new` 作為新增入口的導流。
  - 總務首頁與快速操作不再顯示「申請料件」。
  - 新增需求統一從「維修回報」進入。
  - 維修回報表單保留資源類型「料件 / 耗材」選項。
  - 原「料件申請紀錄」改名為「料件/耗材回報紀錄」，用於彙整 `maintenance_requests.resource_type = material` 的既有回報。
- DB：
  - 未新增 migration。
  - 未修改 DB schema、RLS、RPC、grants。
  - 未執行 `db push`、`repair`、`reset`、rollback。

驗證結果：

```powershell
node --check scripts/test-general-affairs-availability.js
node scripts/test-general-affairs-availability.js
npx tsc --noEmit --pretty false
npm run build
```

結果：

- `node --check scripts/test-general-affairs-availability.js`：通過。
- `node scripts/test-general-affairs-availability.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過；仍有既有 `DYNAMIC_SERVER_USAGE` 訊息，非本輪 failure。

發現問題：

- handoff 歷史中保留了先前「申請料件入口補強」紀錄；那是歷史狀態，不代表最新產品決策。
- 目前正式料件申請 DB / API / UI 尚未建立；在正式流程建立前，不應再恢復獨立新增料件申請入口。

尚未完成事項：

- 需要人工 UI 複驗：
  - Navbar / Sidebar 不再看到「新增料件申請」或「申請料件」。
  - 點「維修回報」可新增回報，且資源類型可選「料件 / 耗材」。
  - 「料件/耗材回報紀錄」仍能查看 material 回報紀錄。
  - 權限不足帳號仍由 route / API / RLS 阻擋或顯示權限提示。

下一個最小任務：

**人工複驗總務服務中心 lazy-load 與料件/耗材入口收斂後的互動。**

禁止事項：

- 不得把「新增料件申請」作為獨立入口加回來，除非後續正式料件申請流程已批准並建立 DB / API / UI。
- 不得用料件主檔頁冒充料件申請流程。
- 不得為暫行紀錄頁新增正式料件申請資料表。
- 不得修改已套用 migration。
- 不得連 Production。

## 前一小任務：總務服務中心本機 dev 效能修正

完成狀態：**本機實作完成，TypeScript 與 build 通過，待人工 UI 複驗。**

更新時間：2026-07-27

任務背景：

- 使用者回報本機 `npm run dev -- -p 3002` 後開啟測試區很不順，甚至 `localhost:3002` 一度無法正常回應。
- 實測發現 dev server 熱機後一般 route 可在 100ms 內回應，但冷編譯與 hot reload 狀態下 `/general-affairs` 曾出現 200 秒以上編譯時間。
- 終端 log 顯示：
  - `/general-affairs` 編譯約 `211.8s`，單頁約 4,393 行、893 modules。
  - `/api/permissions/user` 出現 `42P10`：`for SELECT DISTINCT, ORDER BY expressions must appear in select list`。

修改檔案：

- `app/general-affairs/page.tsx`
- `components/general-affairs/service-center/GeneralAffairsServiceCenterClient.tsx`
- `lib/permissions/check.ts`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

API / UI / DB 影響：

- API：
  - `getUserPermissions()` 不再先呼叫環境內有 SQL 錯誤的 legacy `get_user_permissions` RPC。
  - 改由 server-side admin client 直接讀正式 RBAC 來源表：`permissions`、`user_roles`、`roles`、`role_permissions`。
  - 保留 admin-like bypass 取得所有 active permission codes 的行為。
- UI：
  - `/general-affairs` route 改成薄 route shell。
  - 原大型總務服務中心 client 搬到 `components/general-affairs/service-center/GeneralAffairsServiceCenterClient.tsx`。
  - route 使用 dynamic import lazy load client，先快速顯示「載入總務服務中心...」。
- DB：
  - 未新增 migration。
  - 未執行 `db push`、`repair`、`reset`、rollback。
  - 未修改 RLS / RPC / grants / remote schema。

驗證結果：

```powershell
npx tsc --noEmit --pretty false
npm run build
curl.exe -s -o NUL -w "...timing..." http://localhost:3002/general-affairs
curl.exe -s -o - -w "...timing..." http://localhost:3002/api/permissions/user
```

結果：

- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過；仍有既有 `DYNAMIC_SERVER_USAGE` 訊息，非本輪 failure。
- build route summary 顯示 `/general-affairs` 約 `1.31 kB`，不再是大型 route page bundle。
- `/general-affairs` hot reload 後首次約 `10.33s`；熱機後約 `0.074s`。
- `/api/permissions/user` 未登入回 `401`，約 `0.156s`。
- 未再看到 `42P10` response path 錯誤。

發現問題：

- `app/general-affairs/page.tsx` 原本累積過大，維修、工單、廠商、料件申請暫行紀錄都在同一個 client file 中，造成本機 dev 初次編譯非常慢。
- 本輪做的是 route shell / lazy load 的第一層修正，尚未把維修、工單、廠商等區塊拆成獨立小元件。

尚未完成事項：

- 需要人工 UI 複驗 `/general-affairs` lazy load 後所有原互動仍正常：
  - 首頁工作台。
  - 維修回報。
  - 我的回報。
  - 工單中心。
  - 廠商管理。
  - 料件申請紀錄。
- 後續若仍覺得 dev 編譯慢，下一步應拆分 `GeneralAffairsServiceCenterClient.tsx` 內的維修、工單、廠商與料件申請區塊。

下一個最小任務：

**人工複驗總務服務中心 lazy-load 後的互動。**

禁止事項：

- 不得為效能修正修改 DB migration。
- 不得直接改 remote schema。
- 不得用 Production 做效能驗證。
- 不得把尚未拆完的總務業務流程改成假資料或假入口。

## 1. 專案環境

- 專案名稱：富康菁英業務網
- 技術架構：
  - Next.js 14 App Router
  - TypeScript
  - React Client / Server Components
  - Supabase Auth、Postgres、RLS、RPC
  - Supabase CLI migrations
  - Tailwind CSS / lucide-react
- 目前 DEV Supabase Project Ref：`mjpd...mtqr`
- Production 候選 Project Ref：`odvksgucvfoaqrumpran`
- 任何遠端 DB 操作前都必須確認沒有命中 Production 候選 Project Ref。

### Guards

每次遠端 DB 操作前都必須先跑：

```powershell
node scripts/verify-dev-supabase-environment.js
node scripts/verify-dev-supabase-cli-environment.js
npx supabase migration list
```

通過條件：

- App Guard 顯示 `Environment guard passed`
- CLI Guard 顯示 `Supabase CLI environment guard passed`
- URL Project Ref 與 CLI Project Ref 都是 DEV：`mjpd...mtqr`
- Project Ref 不得等於 `odvksgucvfoaqrumpran`
- `ALLOW_DEV_DATABASE_OPERATIONS=true`
- `ALLOW_SUPABASE_CLI_REMOTE_OPERATIONS=true`
- `NODE_ENV` 不得為 `production`

### 必要環境變數

本機 DEV 應由 `.env.development.local` 或 Next.js development 載入順序提供：

```env
NEXT_PUBLIC_SUPABASE_URL=https://<DEV_PROJECT_REF>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<DEV_ANON_KEY>
SUPABASE_SERVICE_ROLE_KEY=<DEV_SERVICE_ROLE_KEY>
EXPECTED_SUPABASE_PROJECT_REF=<DEV_PROJECT_REF>
ALLOW_DEV_DATABASE_OPERATIONS=true
ALLOW_SUPABASE_CLI_REMOTE_OPERATIONS=true
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

不得把真實 key、JWT、DB password、connection string 寫進 Git、文件或對話。

### SUPABASE_DB_PASSWORD 使用方式

如果 Supabase CLI 需要 DEV DB password，只能在本機 Terminal 隱藏輸入，或用 PowerShell `SecureString` 暫時設定 `SUPABASE_DB_PASSWORD`。完成後必須清除：

```powershell
$ErrorActionPreference = 'Stop'
$secure = Read-Host 'Enter DEV Supabase DB password' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  $env:SUPABASE_DB_PASSWORD = $plain

  node scripts/verify-dev-supabase-environment.js
  node scripts/verify-dev-supabase-cli-environment.js
  npx supabase migration list
  npx supabase db push --dry-run
  # Only after explicit approval:
  # npx supabase db push
}
finally {
  Remove-Item Env:\SUPABASE_DB_PASSWORD -ErrorAction SilentlyContinue
  if ($bstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
  Write-Host ('SUPABASE_DB_PASSWORD cleared: ' + (-not (Test-Path Env:\SUPABASE_DB_PASSWORD)))
}
```

密碼不得出現在命令列參數、`.env`、console output、Git 或對話中。

## 2. Migration 狀態

目前 `supabase/migrations/` 已由 DEV schema baseline 導入並對齊 remote history。以下 migration 已套用 DEV，且 local / remote aligned：

| Timestamp | File | 狀態 |
| --- | --- | --- |
| `20260722030244` | `20260722030244_dev_schema_baseline.sql` | 已套用 DEV |
| `20260722032048` | `20260722032048_general_affairs_inventory_locations.sql` | 已套用 DEV |
| `20260722055852` | `20260722055852_fix_inventory_location_cascade_deletion_reason.sql` | 已套用 DEV |
| `20260722065952` | `20260722065952_general_affairs_inventory_transactions_foundation.sql` | 已套用 DEV |
| `20260722091526` | `20260722091526_revoke_inventory_transaction_sequence_grants.sql` | 已套用 DEV |
| `20260722092849` | `20260722092849_restrict_inventory_transaction_function_execute_grants.sql` | 已套用 DEV |
| `20260722094917` | `20260722094917_fix_inventory_balance_upsert_conflict_ambiguity.sql` | 已套用 DEV |
| `20260724002545` | `20260724002545_production_core_compatibility.sql` | 已套用 DEV |
| `20260724011554` | `20260724011554_production_legacy_general_affairs_maintenance_compatibility.sql` | 已套用 DEV |
| `20260724025452` | `20260724025452_production_legacy_inventory_inspection_monthly_compatibility.sql` | 已套用 DEV |
| `20260724035445` | `20260724035445_production_legacy_product_relationship_clinic_performance_compatibility.sql` | 已套用 DEV |
| `20260724040838` | `20260724040838_production_legacy_campaign_pharmacist_remaining_compatibility.sql` | 已套用 DEV |
| `20260724042430` | `20260724042430_production_legacy_rbac_rpc_compatibility.sql` | 已套用 DEV |

重要規則：

- 不得修改任何已套用 migration。
- 發現 DB 問題只能建立新的 forward fix migration。
- 不得自行執行 `migration repair`、`db reset`、rollback 或手動修改 migration history。
- `db push` 前必須先 `db push --dry-run`，且 dry-run 只能列出本輪批准的 migration。
- 不得把 test SQL、rollback SQL、DEV seed 放進標準 migrations。

## 3. Task 1C-1 狀態：庫存位置與位置料件設定

Task 1C-1 已正式 Completed。

完成內容：

- `ga_inventory_locations`
- `ga_inventory_location_parts`
- 權限：
  - `general_affairs.inventory_location.view`
  - `general_affairs.inventory_location.manage`
- RLS：
  - manage/view 依權限讀取
  - store manager 只能讀自己門市 STORE location 與其 location parts
  - 不建立 DELETE policy
- API：
  - `/api/general-affairs/inventory/locations`
  - `/api/general-affairs/inventory/locations/[id]`
  - `/api/general-affairs/inventory/locations/[id]/parts`
  - `/api/general-affairs/inventory/locations/[id]/parts/[locationPartId]`
- UI：
  - `/general-affairs/inventory/locations`
- 測試狀態：
  - DB constraints 通過
  - Trigger 通過
  - system fields 防偽通過
  - RLS/API 動態驗收通過
  - soft delete cascade forward fix 已套用並通過
  - UI 人工驗收完成
  - `npx tsc --noEmit --pretty false` 通過
  - `npm run build` 通過

重要檔案：

- `supabase/migration_general_affairs_inventory_locations.sql`
- `supabase/test_general_affairs_inventory_locations.sql`
- `supabase/rollback_general_affairs_inventory_locations.sql`
- `supabase/migrations/20260722032048_general_affairs_inventory_locations.sql`
- `supabase/migrations/20260722055852_fix_inventory_location_cascade_deletion_reason.sql`
- `scripts/test-general-affairs-inventory-locations.js`
- `scripts/test-general-affairs-inventory-locations-dev.js`
- `app/api/general-affairs/inventory/locations/`
- `app/general-affairs/inventory/locations/`
- `lib/general-affairs/inventory/`
- `components/general-affairs/`

已知技術債：

- `npm run build` 會出現既有 `DYNAMIC_SERVER_USAGE` 訊息，需要區分 warning 與真正 build failure。
- `npm audit` vulnerabilities 尚未在此階段處理。
- 舊 DEV 測試資料 `DEV-1C-1-SCRIPT-STORE` 待人工透過既有 soft delete 流程清理，不得硬刪。

## 4. Task 1C-2B 狀態：庫存流水與庫存餘額 DB Core

目前正式標記：

**Task 1C-2B DB Core Verified**

完成內容：

- `ga_inventory_balances`
- `ga_inventory_transactions`
- `ga_inventory_transaction_no_seq`
- `ga_next_inventory_transaction_no()`
- `ga_post_inventory_transaction(...)`
- append-only trigger function
- idempotency key partial unique index
- balance `location_id + part_id` unique constraint
- RLS：兩表只有 SELECT policy，client 不能直接 INSERT / UPDATE / DELETE
- grants：
  - sequence 不授權 PUBLIC / anon / authenticated direct usage
  - transaction number helper 不授權 PUBLIC / anon / authenticated EXECUTE
  - posting RPC 只授權 authenticated EXECUTE
- RPC 核心邏輯：
  - `auth.uid()`
  - `general_affairs.inventory_transaction.manage`
  - `general_affairs.part.view` / `general_affairs.part.manage`
  - advisory lock
  - `SELECT ... FOR UPDATE`
  - idempotency replay / conflict
  - negative stock validation
  - base / purchase unit conversion
  - transaction insert
  - balance update

### 測試覆蓋

已完成並通過：

- DB schema / constraints / indexes
- RLS catalog
- grants catalog
- append-only
- idempotency
- unit conversion
- negative stock
- direct write rejection
- concurrency
- DB Test SQL Coverage
- Dynamic Verification A
- Dynamic Verification B

重要檔案：

- `supabase/migration_general_affairs_inventory_transactions_foundation.sql`
- `supabase/test_general_affairs_inventory_transactions_foundation.sql`
- `supabase/verify_general_affairs_inventory_transactions_catalog.sql`
- `supabase/rollback_general_affairs_inventory_transactions_foundation.sql`
- `supabase/migrations/20260722065952_general_affairs_inventory_transactions_foundation.sql`
- `scripts/test-general-affairs-inventory-transactions-foundation.js`
- `scripts/test-general-affairs-inventory-transactions-dev.js`
- `scripts/test-general-affairs-inventory-transactions-api-dev.js`

### Forward fixes

1. `20260722091526_revoke_inventory_transaction_sequence_grants.sql`
   - 原因：`public.ga_inventory_transaction_no_seq` 曾有 anon/authenticated direct USAGE grant。
   - 結果：PUBLIC / anon / authenticated 無 sequence USAGE，transaction no 只能由 helper/RPC 受控產生。

2. `20260722092849_restrict_inventory_transaction_function_execute_grants.sql`
   - 原因：helper / RPC EXECUTE grants 需要收斂。
   - 結果：
     - `ga_next_inventory_transaction_no()` 無 PUBLIC / anon / authenticated EXECUTE。
     - `ga_post_inventory_transaction(...)` 無 PUBLIC / anon EXECUTE，authenticated 有 EXECUTE。

3. `20260722094917_fix_inventory_balance_upsert_conflict_ambiguity.sql`
   - 原因：RPC balance UPSERT 使用 `ON CONFLICT (location_id, part_id)` 造成 ambiguity。
   - 結果：已改為 `ON CONFLICT ON CONSTRAINT ga_inventory_balances_location_part_unique DO NOTHING`。

## 5. Task 1C-2C 狀態：庫存管理 API / UI

已建立：

- API routes：
  - `/api/general-affairs/inventory/balances`
  - `/api/general-affairs/inventory/transactions`
  - `/api/general-affairs/inventory/transactions/post`
  - `/api/general-affairs/inventory/options`
- UI route：
  - `/general-affairs/inventory`
- 導覽入口：
  - 上方導覽已補「總務服務中心 / 庫存管理」入口。
  - 顯示條件依 inventory balance / transaction 權限與 store manager scope。
  - no_access 不應顯示入口；直接輸入 URL 仍由頁面/API/RLS 擋。
- 權限補充：
  - `inventory_transaction.manage` 但缺 `part.view/manage` 時，頁面需顯示明確缺少 `general_affairs.part.view` 提示。
  - 不得用 service role 繞過 `ga_parts` RLS 取得料件目錄。

驗收狀態：

- API dynamic tests 已完成並通過。
- `npx tsc --noEmit --pretty false` 已通過。
- `npm run build` 已通過。
- 總務導覽收斂完成。
- 未建置模組 availability guard 完成。
- 人工 UI 複驗已完成並通過。
- 入庫 / 出庫 / 調增 / 調減人工複驗通過。
- 不再出現 schema cache 原始錯誤。
- 不再出現 maintenance migration 原始錯誤。

是否可標記 Completed：

- **Task 1C-2C Completed。**
- 不得自行開始 Task 1C-3。

## 6. DEV RBAC 正式化狀態

盤點結論：

- DEV 與正式區共用同一套 RBAC schema。
- 核心資料表：
  - `profiles`
  - `roles`
  - `permissions`
  - `role_permissions`
  - `user_roles`
  - `store_managers`
- 相關 RPC / function：
  - `has_permission(user_id, permission_code)`
  - `current_user_has_permission(permission_code)`
  - `get_user_permissions(user_id)`：只允許目前 `auth.uid()` 查自己，不可拿來讓一般 authenticated user 查別人。
- `profiles.role` 仍保留作舊程式相容與顯示用途，新功能不得只靠它授權。
- 正式 RBAC 來源是 `roles`、`permissions`、`role_permissions`、`user_roles`。

重要檔案：

- 角色管理頁：
  - `app/admin/roles/page.tsx`
  - `app/admin/roles/RoleListClient.tsx`
  - `app/admin/roles/[id]/page.tsx`
  - `app/admin/roles/[id]/RoleEditClient.tsx`
- 使用者管理頁：
  - `app/admin/users/page.tsx`
  - `components/admin/UserManagementTable.tsx`
- Navbar / permission config：
  - `components/Navbar.tsx`
  - `hooks/useNavbarPermissions.ts`
  - `lib/permissions/check.ts`
  - `lib/permissions/rbac-management.ts`
- 角色 API：
  - `app/api/roles/route.ts`
  - `app/api/roles/[id]/route.ts`
  - `app/api/roles/[id]/permissions/route.ts`
  - `app/api/roles/[id]/users/route.ts`
  - `app/api/roles/[id]/users/[userId]/route.ts`
- 使用者 RBAC read-only API：
  - `app/api/admin/users/[id]/rbac/route.ts`
- 使用者 RBAC 彙整 helper：
  - `lib/admin/user-rbac-view.ts`

目前階段：

- 第一階段盤點完成。
- DEV Full Admin 已透過 `profiles.role=admin` 與 active `admin` RBAC role 取得管理介面入口。
- 完整 RBAC 管理正式化尚未全部完成；目前已補上「使用者角色與有效權限唯讀詳細檢視」的程式碼，但仍需人工 UI 驗收與 DEV dynamic script 實跑確認。
- 這次補強不是新增使用者功能、不是角色 CRUD 重寫、不是 migration。

四個人工驗收帳號：

- `dev-ga-access@example.test`
- `dev-ga-manage@example.test`
- `dev-ga-view@example.test`
- `dev-no-ga@example.test`

接手時應確認：

- 使用者管理列表看得到上述四個 DEV 帳號。
- 列表能看到 active RBAC roles、effective permission count、store scope count。
- 點「查看角色與權限」能看到 permission codes、來源角色與 store manager scope。
- DEV 測試帳號 badge 只作顯示，不作授權依據。
- Admin compatibility bypass 顯示為 compatibility source，不可偽裝成 role_permissions 來源。

## 7. 已完成測試腳本與 SQL

### Guards

- `scripts/verify-dev-supabase-environment.js`
  - 用途：確認 App env 指向 DEV，拒絕 Production 候選。
  - 執行：`node scripts/verify-dev-supabase-environment.js`
- `scripts/verify-dev-supabase-cli-environment.js`
  - 用途：確認 Supabase CLI link 與 App env 都指向 DEV。
  - 執行：`node scripts/verify-dev-supabase-cli-environment.js`

### Task 1A / 1B

- `scripts/test-general-affairs-categories.js`
  - 用途：分類基礎靜態/API 測試。
- `scripts/test-task1a-rls.js`
  - 用途：Task 1A RLS direct tests。
- `scripts/test-task1a-category-api.js`
  - 用途：Task 1A category API tests。
- `scripts/test-general-affairs-equipment-master.js`
  - 用途：設備範本與設備主檔靜態測試。
- `scripts/test-general-affairs-facility-master.js`
  - 用途：設施主檔靜態測試。
- `scripts/test-general-affairs-part-master.js`
  - 用途：料件主檔與相容性靜態測試。

### Task 1C-1

- `scripts/test-general-affairs-inventory-locations.js`
  - 用途：庫存位置與位置料件設定靜態測試。
  - 執行：`node scripts/test-general-affairs-inventory-locations.js`
- `scripts/test-general-affairs-inventory-locations-dev.js`
  - 用途：DEV RLS / API dynamic tests。
  - 執行前需 dev server ready：`npm run dev -- -p 3002`
  - 執行：`node scripts/test-general-affairs-inventory-locations-dev.js`
  - 密碼只能在 Terminal 隱藏輸入。
- `supabase/test_general_affairs_inventory_locations.sql`
  - 用途：DB constraints / trigger / RLS catalog 驗收。

### Task 1C-2B / 1C-2C

- `supabase/verify_general_affairs_inventory_transactions_catalog.sql`
  - 用途：唯讀 catalog 驗收 sequence grants、function grants、RLS、policies、append-only trigger。
- `supabase/test_general_affairs_inventory_transactions_foundation.sql`
  - 用途：DB test SQL coverage，涵蓋 schema/security、基本交易、單位換算、負庫存、idempotency、append-only、validation。
- `scripts/test-general-affairs-inventory-transactions-foundation.js`
  - 用途：inventory transaction foundation 靜態測試。
  - 執行：`node scripts/test-general-affairs-inventory-transactions-foundation.js`
- `scripts/test-general-affairs-inventory-transactions-dev.js`
  - 用途：DEV dynamic DB/RLS/RPC 驗收。
- `scripts/test-general-affairs-inventory-transactions-api-dev.js`
  - 用途：庫存交易 API dynamic tests。

### RBAC

- `scripts/test-rbac-navbar-permissions-dev.js`
  - 用途：RBAC Navbar / role page / API guard DEV 動態測試。
  - 需要 hidden password，不得輸出 token。
- `scripts/test-rbac-user-permissions-view-dev.js`
  - 用途：使用者 RBAC read-only detail API 驗收。
  - 執行前需 dev server ready：`npm run dev -- -p 3002`
  - 執行：`node scripts/test-rbac-user-permissions-view-dev.js`
  - 需要在 Terminal 隱藏輸入 `dev-full-admin@example.test` 與 `dev-no-ga@example.test` 密碼。
  - 尚需接手者實際跑一次並回報結果。

通用檢查：

```powershell
node --check <script>
npx tsc --noEmit --pretty false
npm run build
```

## 8. 禁止事項

- 不連 Production。
- 不命中 Project Ref `odvksgucvfoaqrumpran`。
- 不修改已套用 migrations。
- 不直接改 remote schema。
- 不使用 `migration repair`、`db reset`、rollback 或手動修改 migration history，除非使用者在新回合明確批准。
- 不使用 service role 代替 authenticated user 驗證 RLS / RPC。
- 不輸出 password、JWT、access token、refresh token、service role key、anon key、DB password、connection string。
- 不建立第二套 RBAC。
- 不用 `profiles.role` 取代 `user_roles` / `role_permissions` / `permissions` 新架構。
- 不刪除 DEV temporary roles。
- 不自行開始下一個 Task。
- 不因前端隱藏選單就視為完成安全控制；API / Server Action / RLS 必須各自防守。

## 9. 下一個最小任務

任務名稱：

**新增使用者 RBAC 唯讀詳細檢視**

目前程式碼已建立初版，接手者應先驗收，再視結果修正。任務範圍：

- 使用者列表顯示 active roles。
- 使用者列表顯示 effective permission count。
- 使用者列表顯示 store manager scope count。
- 新增或確認「查看角色與權限」詳細資料。
- 詳細資料顯示 permission code。
- 詳細資料顯示權限來源角色。
- 詳細資料顯示 store manager scope。
- 只讀。
- 不修改角色。
- 不新增使用者。
- 不改 migration。
- 不改 DB schema / RLS。

目前相關新增檔案：

- `lib/admin/user-rbac-view.ts`
- `app/api/admin/users/[id]/rbac/route.ts`
- `scripts/test-rbac-user-permissions-view-dev.js`

目前相關修改檔案：

- `app/auth/actions.ts`
- `components/admin/UserManagementTable.tsx`

## 10. 完成判定

下一位代理完成「新增使用者 RBAC 唯讀詳細檢視」後，必須回報：

- 修改檔案。
- API path。
- permission guard。
- 四個帳號的實際 roles。
- 四個帳號的 effective permission codes。
- 四個帳號的 store scope。
- dynamic test 結果。
- `node --check scripts/test-rbac-user-permissions-view-dev.js` 結果。
- `npx tsc --noEmit --pretty false` 結果。
- `npm run build` 結果。
- 人工 UI 驗收結果。
- 是否有敏感資訊外洩風險。
- 是否仍需手動輸入網址。
- 是否仍有阻擋。

完成後停止，等待使用者確認，不得自行進入下一階段。

## 11. 最新 DEV 狀態更新規則

自 2026-07-23 起，後續每個 DEV 開發小任務完成後，都必須同步維護交接文件：

- `docs/DEV-RBAC-HANDOFF.md`
  - 保留重要歷史，不得只覆蓋成最新摘要。
  - 每個小任務完成後追加或更新：任務名稱、完成狀態、修改檔案、API / UI / DB 影響、測試與 build 結果、發現問題、尚未完成事項、下一個最小任務、禁止事項、migration 狀態。
- `docs/CURRENT-DEV-STATUS.md`
  - 維持短版，覆寫為目前最新狀態。
  - 只保留：目前階段、最新已完成項目、阻擋、下一個最小任務、migration local / remote 狀態、最近 guard / tsc / build / dynamic test 結果、禁止操作。
- `.github/copilot-instructions.md`
  - 只在出現永久開發規則時更新。
  - 不大量寫入一次性測試輸出、暫時錯誤、單一帳號驗收結果或短期任務進度。

## 12. 人員異動編輯與月度人員狀態同步

更新時間：2026-07-27

完成狀態：**本機程式修正、靜態測試、TypeScript、build 與 diff check 通過；待人工 UI / 正式案例複驗。**

任務背景：

- 正式區人員異動建立後，若發現資料錯誤，例如姓名打錯、升職職位或生效日期登錯，原本缺少直接編輯入口。
- 過去若升職紀錄修正後，已建立的每月人員狀態可能仍保留舊職位，需要靠人工 SQL 修補，例如 FK0979 案例。
- 本輪目標是讓「人員異動管理」能編輯既有人員異動，並在升職資料更正後同步影響生效月份後的月度資料。

修改檔案：

- `lib/monthly-staff/promotion-position-sync.ts`
- `app/api/employee-movements/[id]/route.ts`
- `app/admin/promotion-management/page.tsx`
- `scripts/test-promotion-monthly-position-sync.js`
- `docs/DEV-RBAC-HANDOFF.md`
- `docs/CURRENT-DEV-STATUS.md`
- `.github/copilot-instructions.md`

API / UI / DB 影響：

- API：
  - `/api/employee-movements/[id]` 新增 `PATCH`。
  - 權限允許：
    - `employee.movement.manage`
    - `employee.manage`
    - `employee.promotion.batch`（保留既有可進人員異動管理者的相容操作能力）
  - 不新增 permission code。
  - 不修改既有 `DELETE` contract。
- UI：
  - `app/admin/promotion-management/page.tsx` 的歷史記錄表格新增「編輯」按鈕。
  - 新增「編輯人員異動」彈窗。
  - 可修正姓名、生效日期、備註。
  - 升職異動可修正新職位與新人 / 行政階級。
  - 儲存前會提醒：升職異動會從受影響月份開始重算後續每月人員狀態職位。
  - 修正歷史表格欄位順序，避免「操作 / 備註」內容與表頭錯位。
- DB：
  - 未新增 migration。
  - 未修改已套用 migration。
  - 未執行 `db push`、`repair`、`reset`、rollback 或 Production 操作。

同步邏輯：

- 新增 `syncEmployeePromotionTimelineToMonthlyStaffStatus()`：
  - 依同一員工所有 `employee_movement_history.movement_type = 'promotion'` 紀錄建立升職時間線。
  - 從原生效日與新生效日中較早的月份開始重算。
  - 每一段月份套用對應 promotion 的 `new_value`。
  - 若第一筆受影響 promotion 被改到較晚月份，會用該 promotion 的 `old_value` 回填受影響起點到新 promotion 生效月之前，避免舊職位殘留。
  - 若有下一筆升職，更新範圍會停在下一筆升職月份前，不會覆蓋後續升職結果。
- 新增 `syncMovementEmployeeNameToMonthlyStaffStatus()`：
  - 姓名更正會同步 `monthly_staff_status.employee_name`，從受影響月份開始往後更新。
  - 同時更新 `store_employees.employee_name`，讓員工主檔與月度資料一致。
- 行政 / 新人階級：
  - 仍利用既有 `notes` 中的 `行政階級:` / `新人等級:` 標記保存。
  - 同步月度資料時會把 `newbie_level` 套到 `新人` / `行政` 職位。

測試與檢查結果：

```powershell
node --check scripts/test-promotion-monthly-position-sync.js
node scripts/test-promotion-monthly-position-sync.js
npx tsc --noEmit --pretty false
npm run build
git diff --check
```

結果：

- `node --check scripts/test-promotion-monthly-position-sync.js`：通過。
- `node scripts/test-promotion-monthly-position-sync.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過；仍有既有 `DYNAMIC_SERVER_USAGE` 訊息，非本輪 failure。
- `git diff --check`：通過；只有既有 CRLF warning。

發現問題與處理：

- 原歷史記錄表格表頭順序為「備註、操作」，列內容卻先顯示操作再顯示備註；本輪一併修正。
- 原升職同步 helper 只適合新增升職，無法處理「生效日或職位被編輯」後的舊月份區間回復；本輪新增完整時間線重算 helper。

尚未完成事項：

- 尚未人工複驗人員異動管理的編輯彈窗。
- 尚未用正式案例或 DEV 假案例確認：
  - 修正姓名會同步月度姓名。
  - 修正升職職位會同步生效月份後的月度職位。
  - 修正升職生效日期會從較早受影響月份重算。
  - 若後面還有另一筆升職，不會覆蓋下一筆升職月份後的職位。
- 本輪未處理刪除升職紀錄後的自動回算；現有刪除提示仍保留「刪除後不會自動回復員工狀態」語意。

下一個最小任務：

**人工複驗人員異動編輯與月度同步。**

建議驗收步驟：

1. 進入「人員異動管理 / 歷史記錄」。
2. 找一筆 promotion 測試紀錄，點編輯。
3. 修正姓名、職位或生效日期。
4. 儲存後確認顯示成功。
5. 回到每月人員狀態，檢查生效月份後職位已同步。
6. 如該員工後續還有另一筆升職，確認同步沒有越過下一筆升職月份。

禁止事項：

- 不得為本輪功能修改已套用 migration。
- 不得直接用 SQL 修正式資料當作功能完成。
- 不得開始刪除自動回算、調店編輯完整重算或月度鎖定覆寫策略，除非使用者另行批准。

## 12. Task 1C-2B DB Core Verified

任務名稱：Task 1C-2B「庫存流水與庫存餘額 DB Core」

完成狀態：**DB Core Verified**

目前已完成：

- `ga_inventory_balances`
- `ga_inventory_transactions`
- transaction number sequence 與 helper
- `ga_post_inventory_transaction(...)` RPC
- sequence direct grants forward fix
- function EXECUTE grants forward fix
- balance UPSERT ambiguity forward fix
- append-only trigger
- RLS catalog 驗收
- DB Test SQL Coverage Completion
- Dynamic Verification A
- Dynamic Verification B
- concurrency / idempotency / unit conversion / negative stock / append-only 驗收

已套用且 local / remote aligned 的 Task 1C-2B 相關 migrations：

- `20260722065952_general_affairs_inventory_transactions_foundation.sql`
- `20260722091526_revoke_inventory_transaction_sequence_grants.sql`
- `20260722092849_restrict_inventory_transaction_function_execute_grants.sql`
- `20260722094917_fix_inventory_balance_upsert_conflict_ambiguity.sql`

Forward fixes 原因與結果：

- `20260722091526`
  - 原因：`public.ga_inventory_transaction_no_seq` 曾對 `anon` / `authenticated` 有 direct `USAGE` grant，違反規格。
  - 結果：撤銷 `PUBLIC`、`anon`、`authenticated` sequence grants，transaction number 只由 SECURITY DEFINER helper / RPC 內部產生。
- `20260722092849`
  - 原因：helper / RPC EXECUTE grants 需要限制。
  - 結果：`ga_next_inventory_transaction_no()` 不對 `PUBLIC` / `anon` / `authenticated` 開放；`ga_post_inventory_transaction(...)` 只對 `authenticated` 開放 EXECUTE。
- `20260722094917`
  - 原因：balance UPSERT 使用 `ON CONFLICT (location_id, part_id)` 造成 ambiguity。
  - 結果：改為 `ON CONFLICT ON CONSTRAINT ga_inventory_balances_location_part_unique DO NOTHING`。

測試與驗收：

- `supabase/verify_general_affairs_inventory_transactions_catalog.sql`：通過。
- `supabase/test_general_affairs_inventory_transactions_foundation.sql`：完整通過。
- `scripts/test-general-affairs-inventory-transactions-foundation.js`：通過。
- `scripts/test-general-affairs-inventory-transactions-dev.js`：通過。
- `scripts/test-general-affairs-inventory-transactions-api-dev.js`：通過。

尚未完成事項：

- Task 1C-3 尚未開始。
- 不得因 Task 1C-2B 已完成而自行新增庫存 UI 新階段。

## 13. Task 1C-2C API / UI 狀態

任務名稱：Task 1C-2C「庫存 API 與庫存管理 UI」

完成狀態：**Task 1C-2C Completed。**

目前已完成：

- 庫存餘額 API
- 庫存流水 API
- 交易過帳 API
- 庫存 options API
- `/general-affairs/inventory`
- 庫存導覽入口
- API dynamic tests
- `npx tsc --noEmit --pretty false`
- `npm run build`
- 總務導覽收斂
- 未建置模組 availability guard
- 人工 UI 複驗

人工 UI 驗收發現：

- `dev-no-ga@example.test` 看不到總務服務中心，符合預期。
- 具總務入口權限的帳號可看到總務服務中心，但人工驗收發現總務服務中心內部顯示超出 DEV 已完成 DB 模組範圍。
- `ga_vendors`、`ga_service_categories`、`ga_service_regions` 目前不存在。
- 維修模組所需資料表尚未建置到 DEV。
- 未建置模組曾顯示可操作入口，導致 schema cache / table not found 類錯誤。

人工 UI 複驗結果：

- `dev-no-ga@example.test`：符合預期，看不到總務服務中心。
- `dev-ga-access@example.test`：可進總務服務中心；進入庫存管理時顯示沒有庫存管理查看權限，符合實際 permission 配置。
- `dev-ga-view@example.test`：目前沒有下列權限，因此看不到完整庫存管理是核准結果：
  - `general_affairs.inventory_balance.view`
  - `general_affairs.inventory_transaction.view`
  - `general_affairs.inventory_transaction.manage`
- `dev-ga-view@example.test`：無法看到庫存位置、看不到新增或儲存按鈕、沒有原始資料庫錯誤，符合目前實際 permission 配置。
- `dev-ga-manage@example.test`：符合預期。
- `dev-full-admin@example.test`：符合預期。
- 未開放 routes：全部顯示安全未開放提示。
- 庫存功能複驗：入庫、出庫、調增、調減均通過。
- 不再出現 schema cache 原始錯誤。
- 不再出現 maintenance migration 原始錯誤。

不得為了完成 Task 1C-2C 臨時建立以下 migration：

- 維修模組
- 廠商模組
- 服務分類 / 服務區域 DB
- 設備 / 設施完整模組
- 工單流程
- 料件申請流程

## 14. 總務服務中心導覽收斂與未建置模組防護

任務名稱：總務服務中心導覽收斂與未建置模組防護

完成狀態：**已完成，人工 UI 複驗通過。**

修改檔案：

- `app/general-affairs/page.tsx`
- `app/general-affairs/equipment/page.tsx`
- `app/general-affairs/equipment/templates/page.tsx`
- `app/general-affairs/facilities/page.tsx`
- `app/general-affairs/parts/page.tsx`
- `components/general-affairs/ModuleUnavailablePage.tsx`
- `scripts/test-general-affairs-availability.js`

UI 影響：

- `/general-affairs` 首頁改為目前 DEV 可用功能模式。
- 保留庫存管理入口。
- 移除「建立工單 / 新增維修回報 / 新增料件 / 新增設備 / 申請料件」等未完成操作入口。
- 「申請料件」不再錯誤導向料件主檔。
- 未建置模組直接 route 改顯示安全提示：「此功能尚未在目前測試環境開放。」
- 不再自動查詢 `ga_vendors`、`ga_service_categories`、`ga_service_regions`。

API / DB 影響：

- 未修改 API。
- 未修改 DB schema。
- 未建立 migration。
- 未執行 db push、repair、reset、rollback。

測試與 build 結果：

- `node --check scripts/test-general-affairs-availability.js`：通過。
- `node scripts/test-general-affairs-availability.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過。
- build 仍有既有 `DYNAMIC_SERVER_USAGE` 訊息，但 exit code 0。

發現問題：

- DEV Full Admin 與總務入口帳號原本可看到尚未建置模組入口。
- 未建置模組缺表錯誤曾直接暴露 table name / schema cache message。

尚未完成事項：

- Task 1C-2C 目前沒有阻擋。
- Task 1C-3 尚未開始，需使用者明確批准後才可進入。

下一個最小任務：

**等待使用者批准後，才開始 Task 1C-3。**

禁止事項：

- 不得為未建置模組補 migration。
- 不得開始 Task 1C-3。
- 不得連 Production。
- 不得修改已套用 migration。
- 不得 repair / reset / rollback。

Migration 狀態：

- 目前 7 筆 migration local / remote aligned：
  - `20260722030244`
  - `20260722032048`
  - `20260722055852`
  - `20260722065952`
  - `20260722091526`
  - `20260722092849`
  - `20260722094917`

## 14A. 店長 / 督導 / 經理 / 門市管理 RBAC 權限修正

任務名稱：店長 / 督導 / 經理 / 門市管理改用正式 RBAC 權限碼

完成狀態：**程式修正、靜態測試、TypeScript、build 與 diff check 通過，等待 DEV UI 人工複驗。**

更新時間：2026-07-27

背景：

- 使用者回報 DEV 測試區的「督導/經理管理」無法真正使用。
- 舊 UI 提示「請先在使用者管理中將使用者設定為主管角色」，但後端 API 實際只接受 `profiles.role === 'admin'`。
- 這和目前正式化 RBAC 原則不一致：`profiles.role` 只能作為舊相容與顯示欄位，不得作為新功能唯一授權來源。
- 店長指派 API 也存在缺少 authenticated user / RBAC permission guard 的舊邏輯風險。
- 使用者接續回報「門市管理也無法真正變更儲存」；檢查後發現 `/admin/stores/[id]/edit` 直接由 client Supabase 對 `stores` 做 `.update()`，沒有走 server action 與 RBAC guard，容易被 RLS / table grants 擋住。
- `/admin/stores` 列表頁也仍以營業部門 + `profiles.role` 推斷可進入與可顯示新增/編輯/搬遷按鈕。

修改檔案：

- `lib/admin/store-management-access.ts`
- `app/api/supervisors/users/route.ts`
- `app/api/supervisors/stores/route.ts`
- `app/api/supervisors/assignments/route.ts`
- `app/api/supervisors/assign/route.ts`
- `app/api/store-managers/users/route.ts`
- `app/api/store-managers/stores/route.ts`
- `app/api/store-managers/assignments/route.ts`
- `app/api/store-managers/assign/route.ts`
- `app/admin/supervisors/page.tsx`
- `app/admin/stores/page.tsx`
- `app/admin/stores/[id]/edit/page.tsx`
- `app/store/actions.ts`
- `scripts/test-store-scope-management-rbac.js`
- `.github/copilot-instructions.md`
- `docs/DEV-RBAC-HANDOFF.md`
- `docs/CURRENT-DEV-STATUS.md`

API / UI / DB 影響：

- API：店長、督導、經理管理 route 改用 server-side RBAC guard。
- Server Action：新增 `getStoreForAdminEdit()` 與 `updateStore()`，門市編輯改由 server-side RBAC guard 後讀取/更新。
- UI：修正「只要設定主管角色」的誤導提示，改提醒需設定基本資料與 RBAC 指派權限。
- UI：移除 `app/admin/supervisors/page.tsx` 內的 `[DEBUG ...]` console log。
- UI：`/admin/stores` 改依 RBAC 權限顯示新增、編輯、搬遷與顯示已停用門市。
- UI：`/admin/stores/[id]/edit` 不再由 client 直接 `.from('stores').update()`。
- DB：未新增或修改 migration。
- RLS / RPC：未修改。

權限規則：

- 店長指派讀寫：需要 `store.manager.assign` 或 `store.manage`。
- 督導指派讀寫：需要 `store.supervisor.assign` 或 `store.manage`。
- 督導/經理管理共用讀取 API：接受 `store.manager.assign`、`store.supervisor.assign` 或 `store.manage` 任一權限。
- `hasPermission` / `hasAnyPermission` 仍保留 admin-like compatibility bypass，因此 Full Admin 類角色可通過。
- 不依 email、role name、單純 `profiles.role` 或職稱文字放行。
- 門市列表：需要 `store.store.view` 或 `store.manage`，但具備 create / edit / clone 其中一種管理權限者也可進入管理頁。
- 新增門市：需要 `store.store.create` 或 `store.manage`。
- 編輯門市：需要 `store.store.edit` 或 `store.manage`。
- 複製/搬遷門市：需要 `store.store.clone` 或 `store.manage`。
- 顯示已停用門市：需要 `store.store.view_inactive` 或 `store.manage`。

測試與 build 結果：

- `node --check scripts/test-store-scope-management-rbac.js`：通過。
- `node scripts/test-store-scope-management-rbac.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過，exit code 0；仍有既有 `DYNAMIC_SERVER_USAGE` 訊息，非本輪 failure。
- `git diff --check`：通過；只有既有 CRLF warning。

尚未完成事項：

- 待使用者以具備 `store.manager.assign`、`store.supervisor.assign` 或 `store.manage` 的帳號人工複驗。
- 待人工確認可搜尋督導/經理、勾選門市、儲存後出現在現有指派清單。
- 待人工確認 `/admin/stores` 可新增門市、編輯門市並保存欄位、停用/啟用狀態可正確更新。

下一個最小任務：

**人工複驗 `/admin/supervisors`、`/admin/store-managers` 與 `/admin/stores`。通過後再回到原本的 Task UI-3 人工驗收或下一個已批准任務。**

禁止事項：

- 不得為此問題修改 DB schema 或補 migration。
- 不得把 `profiles.role` 恢復成唯一權限來源。
- 不得用 service role 繞過 authenticated API 驗收。

## 15. DEV 使用者刪除流程修正

任務名稱：使用者管理測試帳號刪除修正

完成狀態：**程式修正完成，等待 DEV UI 人工複驗。**

背景：

- 使用者管理頁面可看到許多開發期間建立的測試使用者。
- 既有刪除流程只刪除 `public.profiles` 與部分關聯資料，沒有刪除 Supabase Auth 的 `auth.users`。
- 因 `getAllUsers()` 會補齊 Auth-only 使用者，單純刪 `profiles` 會導致帳號仍留在列表中，看起來像「無法刪除」。
- 既有刪除權限檢查曾使用 `profiles.role === 'admin'`，不符合新 RBAC 規則。

修改檔案：

- `app/auth/actions.ts`
- `scripts/test-admin-user-delete-action.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`
- `.github/copilot-instructions.md`

API / UI / DB 影響：

- 未新增 API route。
- 未修改 UI component。
- 未修改 DB schema。
- 未建立或修改 migration。
- 未執行 db push、repair、reset、rollback。
- `components/admin/UserManagementTable.tsx` 仍呼叫既有 `deleteUser(userId)` server action。

刪除流程現況：

- `deleteUser()` 先取得目前登入使用者。
- 禁止刪除目前登入中的使用者。
- 使用 `hasPermission(currentUserId, 'user.user.delete')` 檢查正式 RBAC 權限。
- 不再使用 `profiles.role` 作為刪除授權依據。
- 使用 server-only `createAdminClient()`。
- 刪除 Auth user 前清理：
  - `store_managers`
  - `store_employees`
  - `user_roles`
  - `collaborators`
- 若 Supabase Auth user 存在，透過 `adminSupabase.auth.admin.deleteUser(userId)` 刪除。
- 若只有 profile 殘留、Auth user 已不存在，允許清除 profile。
- 成功後 revalidate：
  - `/admin/users`
  - `/admin/roles`

安全限制：

- 不刪除目前登入者。
- 不在 client component 使用 service role。
- 不把 service role key、JWT、password 或 token 輸出到 console 或 UI。
- 不直接用 SQL 或 service role 手動硬刪測試使用者作為驗收方式。
- 若要大量清理 DEV 測試帳號，需另開受控任務，明確定義刪除範圍、帳號 pattern、人工確認與 audit 回報。

測試與 build 結果：

- `node --check scripts/test-admin-user-delete-action.js`：通過。
- `node scripts/test-admin-user-delete-action.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過，exit code 0。
- build 仍有既有 `DYNAMIC_SERVER_USAGE` 訊息，未造成 failure。

新增靜態測試覆蓋：

- `deleteUser()` 必須檢查 `user.user.delete`。
- `deleteUser()` 不得用 `profiles.role` 授權。
- `deleteUser()` 必須阻擋刪除目前登入者。
- `deleteUser()` 必須查詢並刪除 Supabase Auth user。
- `deleteUser()` 必須清理 `user_roles` 與 `store_managers`。
- `deleteUser()` 必須 revalidate `/admin/users`。

發現問題：

- 使用者清單能顯示 Auth-only 帳號是必要行為，否則 DEV Dashboard 建立但尚未觸發 profile 的測試帳號會不可見。
- 但刪除流程也必須同步刪 Auth user，否則帳號會重新出現在列表。

尚未完成事項：

- 尚未由 DEV Full Admin 實際在 UI 刪除一筆測試帳號並確認列表更新。
- 尚未建立批次清理測試使用者功能；目前不建議在未定義範圍前做大量刪除。

下一個最小任務：

**人工複驗使用者管理刪除 DEV 測試帳號。**

建議人工驗收方式：

1. 使用 `dev-full-admin@example.test` 登入 DEV。
2. 進入 `/admin/users`。
3. 選擇確定可刪除的測試帳號，不要選目前登入者。
4. 點擊刪除。
5. 確認顯示刪除成功。
6. 重新整理後確認該帳號不再出現在使用者列表。
7. 若帳號仍出現，需回報錯誤訊息與該帳號是否仍存在於 Supabase Auth Dashboard；不得貼 key、JWT 或 password。

禁止事項：

- 不得為此修改 migration。
- 不得連 Production。
- 不得直接 SQL hard delete Auth / RBAC / profile 資料。
- 不得用 `profiles.role` 取代 RBAC 權限。
- 不得開始 Task 1C-3。

## 16. DEV RBAC 管理流程對齊正式區

任務名稱：DEV RBAC 管理流程對齊正式區

完成狀態：**程式修正完成，等待 DEV UI 人工複驗。**

正式流程目標：

1. 使用者先自行註冊或由既有註冊流程建立 Auth user。
2. 系統管理員到「使用者管理」編輯使用者基本資料：
   - 姓名
   - 員編
   - 部門
   - 職稱
   - 角色相容欄位
3. 系統管理員到「角色權限管理」新增角色。
4. 編輯角色可使用的 permission code。
5. 在角色編輯頁用員工編號批次指派使用者。

修改檔案：

- `app/auth/actions.ts`
- `app/api/roles/[id]/users/route.ts`
- `scripts/test-rbac-formal-management-flow.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`
- `.github/copilot-instructions.md`

API / UI / DB 影響：

- 未新增 DB migration。
- 未修改已套用 migration。
- 未執行 db push、repair、reset、rollback。
- 未建立第二套 RBAC。
- 使用者管理 UI 仍沿用既有 `UserManagementTable`。
- 角色管理 UI 仍沿用既有 `RoleListClient` / `RoleEditClient`。
- 角色指派 API 仍為 `POST /api/roles/[id]/users`，payload 使用 `employee_codes`。

使用者基本資料編輯修正：

- `updateUserProfile()` 不再使用 `profiles.role === 'admin'` 作為授權。
- 編輯姓名、員編、部門、職稱需 `user.user.edit`。
- 編輯相容角色欄位需 `user.user.change_role`。
- 禁止修改目前登入使用者自己的相容角色欄位。
- `employee_code` 會 trim 並 uppercase。
- `employee_code` 不可空白。
- `employee_code` 更新前會檢查是否已被其他 `profiles` 使用。
- `profiles.role` 仍只作為舊程式相容與顯示用途，不是新 RBAC 權限來源。

角色使用者指派修正：

- `POST /api/roles/[id]/users` 保持正式邏輯：以員工編號批次指派角色。
- DEV / RBAC 測試帳號可只存在 `profiles.employee_code`。
- 正式區若有 `store_employees`，仍可作為相容補充來源。
- DEV baseline 缺 `store_employees` 時，API 會安全略過此 optional table。
- 不再因 `public.store_employees` 缺表而回傳 schema cache 原始錯誤。
- `GET /api/roles/[id]/users` 同樣會在 DEV 缺 `store_employees` 時改用 `profiles` 顯示姓名與員編。

安全設計：

- 寫入仍由 server-side API / server action 檢查 RBAC 權限後使用 server-only admin client。
- service role 不進 client component。
- 前端顯示或隱藏按鈕不取代 server-side permission guard。
- 不使用帳號名稱、email 或 role name 猜測權限。

測試與 build 結果：

- `node --check scripts/test-rbac-formal-management-flow.js`：通過。
- `node scripts/test-rbac-formal-management-flow.js`：通過。
- `node scripts/test-admin-user-delete-action.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過，exit code 0。
- build 仍有既有 `DYNAMIC_SERVER_USAGE` 訊息，未造成 failure。

新增靜態測試覆蓋：

- `updateUserProfile()` 必須使用 `user.user.edit`。
- `updateUserProfile()` 編輯相容角色時必須使用 `user.user.change_role`。
- `updateUserProfile()` 不得透過 `profiles.role` 授權。
- `employee_code` 必須 uppercase normalize。
- `employee_code` 必須檢查重複。
- 角色指派必須查詢 `profiles.employee_code`。
- `store_employees` 只能是 optional compatibility source。
- 角色編輯 UI 必須用 `employee_codes` 指派使用者。

尚未完成事項：

- 尚未由 DEV Full Admin 實際人工複驗完整流程。
- 尚未建立批次清理 DEV 測試使用者功能。
- 尚未開始 Task 1C-3。

下一個最小任務：

**人工複驗 DEV RBAC 正式流程。**

建議人工驗收清單：

1. 建立或選擇一個測試 Auth 使用者。
2. 使用 DEV Full Admin 到 `/admin/users`。
3. 編輯該使用者：
   - 姓名
   - 員編
   - 部門
   - 職稱
   - 相容角色欄位
4. 確認更新後列表顯示新的員編。
5. 到 `/admin/roles` 新增一個測試角色。
6. 進入角色編輯頁。
7. 在權限設定分頁勾選測試所需 permission code 並儲存。
8. 切換到使用者管理分頁。
9. 用剛才設定的員編指派使用者。
10. 確認角色使用者列表顯示該使用者、姓名與員編。
11. 回到使用者管理，確認該使用者的 active roles / effective permission count 有更新。

禁止事項：

- 不得為此建立新 migration。
- 不得直接修改 remote schema。
- 不得直接 SQL 寫入 `user_roles` 作為人工驗收捷徑。
- 不得用 `profiles.role` 取代正式 `user_roles` / `role_permissions`。
- 不得開始 Task 1C-3。

## 18. 正式區使用者刪除：歷史資料 FK 保護

任務名稱：正式區使用者刪除遇到歷史引用時改為停用登入與撤權

完成狀態：**程式修正完成，靜態測試、TypeScript 與 build 通過；尚未在正式區執行任何資料庫操作。**

問題背景：

- 正式區刪除使用者時曾出現：
  - `update or delete on table "profiles" violates foreign key constraint "inspection_improvements_improved_by_fkey" on table "inspection_improvements"`
- 根因是 `inspection_improvements.improved_by` 等歷史業務資料仍引用 `profiles.id`。
- 這類使用者不可強制硬刪 `profiles`，否則會破壞盤點改善紀錄、歷史稽核與人員責任歸屬。

本輪決策：

- 若使用者沒有歷史引用，仍可走原本安全刪除流程。
- 若刪除 `auth.users` 或 `profiles` 時遇到歷史 FK 錯誤，改採「保留 profile、停用登入、撤除角色與管理範圍」。
- 不修改正式資料庫 FK。
- 不建立 migration。
- 不直接改 remote schema。
- 不為了刪除使用者硬刪歷史資料。

修改檔案：

- `app/auth/actions.ts`
- `components/admin/UserManagementTable.tsx`
- `scripts/test-admin-user-delete-action.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`
- `.github/copilot-instructions.md`

API / UI / DB 影響：

- DB schema：無異動。
- migration：無新增、無修改、無 push。
- 使用者刪除 Server Action 仍先檢查 `user.user.delete`。
- 刪除前仍清理：
  - `store_managers`
  - optional `store_employees`
  - `user_roles`
  - `collaborators`
- 若碰到歷史 FK：
  - 保留 `profiles`。
  - 透過 server-only Supabase Auth Admin API 將 Auth user 設定長期 ban。
  - 回傳明確訊息，告知使用者已保留歷史資料並停用登入。
- 若 Supabase Auth Admin API 只回傳籠統的 `Database error deleting user`，也視為可能存在資料庫歷史引用，採同一套保留 profile + 停用登入 fallback。
- 使用者管理 UI 成功訊息改讀取 server action 回傳的 `message`，避免將 fallback 誤顯示為單純刪除成功。
- `getAllUsers()` 會依 Supabase Auth `banned_until` 回填 `is_disabled`，供後續 UI 顯示停用狀態使用。

測試與 build 結果：

- `node --check scripts/test-admin-user-delete-action.js`：通過。
- `node scripts/test-admin-user-delete-action.js`：通過。
- `node scripts/test-rbac-formal-management-flow.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過，exit code 0。

發現問題：

- build 前曾有本機 `next dev -p 3002` 殘留程序造成 `.next` 產物干擾；已只停止本專案佔用 3002 的 node / next dev 程序後重新 build。
- 未刪除 `.next`、`node_modules`、lockfile、migration 或 env 檔。

尚未完成事項：

- 尚未在正式區實際操作刪除該名有歷史引用的使用者。
- UI 若要更完整，後續可加上「已停用登入」標籤與篩選。
- 後續若要真正永久清除帳號，必須先設計歷史資料匿名化或引用保留策略，不可直接硬刪。

下一個最小任務：

**在正式區用系統管理員操作一次有歷史引用的使用者刪除，確認畫面顯示「保留歷史資料並停用登入」且該帳號無法再登入。**

禁止事項：

- 不得為了刪除使用者修改 `inspection_improvements` 歷史資料。
- 不得把相關 FK 改成 `ON DELETE CASCADE`。
- 不得直接硬刪 `profiles` 或 `auth.users` 繞過應用程式流程。
- 不得用 service role 在 SQL Editor 手動刪資料作為正式操作捷徑。
- 不得開始 Task 1C-3。

## 19. Task 1C-P0：DEV / Production 功能與 Schema 差異盤點

任務名稱：Task 1C-P0「DEV / Production 功能與 Schema 差異盤點」

完成狀態：**盤點文件已建立；Production schema-only 證據仍需使用者提供。**

背景：

- 使用者確認 DEV 測試區不應只覆蓋總務服務中心，而應逐步復刻正式菁英網的所有功能與操作。
- DEV 可以建立正式區相同的 schema、API、UI、RLS、grants、reference data 與 workflow。
- DEV 不得複製正式區已寫入的營運資料、員工個資、Auth 使用者、密碼、token、附件、工單、庫存、盤點、銷售或獎金資料。
- 後續測試資料應在 DEV 重新輸入或用 fake seed 產生，並存到 DEV Supabase。

本輪新增檔案：

- `docs/DEV-PRODUCTION-PARITY-AUDIT.md`

本輪更新檔案：

- `docs/DEV-RBAC-HANDOFF.md`
- `docs/CURRENT-DEV-STATUS.md`
- `.github/copilot-instructions.md`

執行過的安全檢查：

- App DEV Guard：passed，Project Ref `mjpd...mtqr`。
- CLI DEV Guard：passed，Project Ref `mjpd...mtqr`。
- `npx supabase migration list`：7 筆 migration local / remote aligned。
- Production 候選 `odvksgucvfoaqrumpran` 未命中。

Migration 狀態：

- 未建立 migration。
- 未修改 migration。
- 未執行 db push。
- 未執行 repair / reset / rollback。
- 未開始 Task 1C-3。

Repository 盤點結果：

- `app/**/page.tsx`：65 個 page routes。
- `app/**/route.ts`：146 個 API routes。
- 程式碼 `.from()` 依賴約 92 個 table / bucket 名稱。
- 程式碼 `.rpc()` 依賴 15 個 RPC。
- Supabase SQL 檔 246 個。

DEV 實際 public schema 目前包含：

- RBAC / profile / store baseline：
  - `profiles`
  - `roles`
  - `permissions`
  - `role_permissions`
  - `user_roles`
  - `stores`
  - `store_managers`
- 總務分類與主檔：
  - `ga_equipment_categories`
  - `ga_facility_categories`
  - `ga_part_categories`
  - `ga_equipment_templates`
  - `ga_equipment`
  - `ga_facilities`
  - `ga_parts`
  - `ga_part_compatibilities`
- 庫存：
  - `ga_inventory_locations`
  - `ga_inventory_location_parts`
  - `ga_inventory_balances`
  - `ga_inventory_transactions`

重要發現：

- DEV 目前不是正式菁英網完整結構復刻；它目前是 RBAC + stores + 總務 1A-1C 已完成部分。
- DEV active `permissions` 目前只有 20 個，全部集中在總務 1A-1C；repository 內可辨識的正式網 permission-like codes 約 165 個，扣除非權限字串後約 145 個正式功能 permission reference 尚未 seed 到 DEV。
- 缺少的 permission reference 涵蓋 `role.*`、`user.*`、`store.*`、`task.*`、`inventory.*`、`monthly.*`、`inspection.*`、`activity.*`、`employee.*`、`cross_dept.*`、`pharmacist.*` 等正式功能。
- Repository 內正式網既有功能仍依賴大量 DEV 不存在的 legacy tables，例如：
  - 任務派發：`templates`、`assignments`、`assignment_collaborators`、`logs`
  - 使用者 / 門市相容：`store_employees`
  - 維修：`maintenance_*`
  - 盤點：`inspection_*`
  - 盤點結果分析：`inventory_result_*`
  - 月狀態 / 績效 / 獎金：`monthly_*`、`store_performance*`
  - 藥師、活動、商品主檔、關係會員、缺貨、人事異動等 legacy tables。
- 已知總務缺口：
  - `ga_vendors`
  - `ga_service_categories`
  - `ga_service_regions`
  - 維修模組 tables
- 這些缺口應用分階段 schema parity 補齊，不能為了畫面可點臨時建空表或複製 Production 資料。

Auth / Storage 盤點：

- `public` schema-only dump 成功，未讀取資料列。
- `storage` schema-only dump 成功，未讀取 object rows。
- `auth` schema dump 因 Supabase CLI 臨時登入角色認證失敗而停止；未重試、未要求密碼、未讀取 Auth 資料。
- 若要完整 parity，需使用者提供不含資料列與秘密的 Auth / Storage / Production schema-only 證據。

新增永久規則：

- DEV 目標是復刻 Production 的結構與功能，不是複製 Production 業務資料。
- Schema migration 必須與 DEV demo seed 分離。
- DEV-only seed 不得套用到 Production。
- 正式資料不得因「測試真實感」而直接倒入 DEV。

建議下一個最小任務：

**P1 Core Reference / RBAC / Store Compatibility schema parity 設計。**

建議任務範圍：

- 先設計，不直接 migration。
- 先補正式權限 reference 設計：`permissions`、system roles、role_permissions baseline。
- 盤點 `store_employees`、任務派發 core tables 與 RBAC / store compatibility 的最小 schema。
- 定義 system reference seed 與 DEV fake demo seed。
- 不複製 Production rows。
- 不開始 Task 1C-3。

詳細內容請見：

- `docs/DEV-PRODUCTION-PARITY-AUDIT.md`

## 20. Project P0：DEV / Production 全系統功能與 Schema Parity Audit

任務名稱：Project P0「DEV / Production 全系統功能與 Schema Parity Audit」

完成狀態：**已完成文件化；未建立 migration、未修改 DB、未操作 Production、未開始 Task 1C-3。**

背景修正：

- 使用者進一步澄清，「正式區 / 測試區功能一致」不是只針對總務服務中心或 inventory / maintenance，而是整個富康菁英業務網。
- DEV 的正確方向是復刻 Production 的完整功能與 schema 結構，讓後續所有新功能都先在 DEV 開發與驗收，再推進 Production。
- DEV 仍不得複製 Production 已寫入的正式資料；DEV 測試資料應重新輸入或用 fake seed 產生。

新增文件：

- `docs/DEV-PRODUCTION-FULL-SYSTEM-PARITY-AUDIT.md`

同步更新文件：

- `docs/DEV-RBAC-HANDOFF.md`
- `docs/CURRENT-DEV-STATUS.md`
- `.github/copilot-instructions.md`

API / UI / DB 影響：

- API：無程式碼異動。
- UI：無程式碼異動。
- DB：無 schema 異動、無 migration、無 push、無 repair/reset/rollback。
- Production：未連線、未操作。

盤點證據：

- `app/**/page.tsx`：65 個 page routes。
- `app/**/route.ts`：146 個 API route files。
- `.from()` 依賴：92 個 table / bucket 名稱。
- `.rpc()` 依賴：15 個 RPC 名稱。
- Supabase SQL 檔：246 個。
- DEV active permissions：20 個，全部集中在 General Affairs 1A-1C。
- Repository 仍有大量正式網 permission references 尚未 seed 到 DEV，例如：
  - `role.*`
  - `user.*`
  - `store.*`
  - `task.*`
  - `inventory.*`
  - `monthly.*`
  - `inspection.*`
  - `activity.*`
  - `employee.*`
  - `cross_dept.*`
  - `pharmacist.*`

核心發現：

- DEV 目前不是正式菁英網完整結構復刻。
- DEV 目前完整覆蓋的是：
  - RBAC / profiles / stores baseline
  - Task 1A categories
  - Task 1B equipment/facility/part masters
  - Task 1C-1 inventory locations/location-parts
  - Task 1C-2B inventory balances/transactions DB core
  - Task 1C-2C inventory API/UI
- Repository 內正式功能仍依賴 DEV 未建置 schema：
  - 任務派發：`templates`、`assignments`、`assignment_collaborators`、`logs`
  - 使用者 / 門市相容：`store_employees`
  - 維修：`maintenance_*`
  - 盤點：`inspection_*`
  - 盤點結果分析：`inventory_result_*`
  - 月狀態 / 績效 / 獎金：`monthly_*`、`store_performance*`
  - 總務尚未建置：`ga_vendors`、`ga_service_categories`、`ga_service_regions`
  - 其他：`campaign_*`、`pharmacist_*`、`clinic_selfpay_*`、`products_master`、`relationship_*`、`stockout_*`

測試與 build 結果：

- 本輪只做盤點與文件。
- 未執行 tsc / build，因沒有程式碼或 SQL 邏輯變更。
- 未執行 dynamic test。

發現問題：

- 先前總務 availability guard 是必要暫時防護，但不是 parity complete。
- Production schema 目前不能只靠 repo 完整還原；repo SQL 有多個歷史 / 修補 / 手動執行檔，且 Production 可能存在手動 schema 差異。
- `auth` / `storage` / Production exact grants / policies / manual functions 需要 schema-only 或 config-only 證據才能精準比對。
- 多處 legacy 程式仍有 `profiles.role` 判斷，後續 parity 應逐步改為 RBAC/effective permissions，但不能一次性大改造成新風險。

尚未完成事項：

- 尚未取得 Production schema-only dump。
- 尚未設計 P1 Core Reference / RBAC / Store Compatibility migration。
- 尚未恢復 DEV 中任務、門市人員、盤點、月狀態、維修、報表、活動、藥師、商品與關係會員等完整正式功能 schema。
- Task 1C-3 尚未開始。

下一個最小任務：

**P1 Core Reference / RBAC / Store Compatibility schema parity 設計。**

建議範圍：

- 設計正式 permission reference seed 與 system roles。
- 補齊 `role_permissions` baseline 的策略。
- 設計 `store_employees` 相容 schema。
- 釐清使用者以員編管理、角色指派、門市 scope 與正式區一致的最小結構。
- 定義 system reference seed 與 DEV fake demo seed 的分離。
- 只做設計與可審查 SQL 草案，不直接 migration。

禁止事項：

- 不得開始 Task 1C-3。
- 不得複製 Production 業務資料到 DEV。
- 不得把 Production Auth users、員工個資、工單、盤點、庫存、銷售、附件或 audit logs 匯入 DEV。
- 不得修改已套用 migrations。
- 不得直接改 remote schema。
- 不得執行 repair/reset/rollback。
- 不得建立 DEV-only 分岐行為來替代 Production parity。

## 21. P1-A：Production Schema-only Parity Intake 與初步比對

任務名稱：P1-A「Production Schema-only Parity Intake」

完成狀態：**已完成。Production public schema-only 檔案已由使用者在本機安全產生，已放入 gitignored path，並完成本機 schema-only parity scan。未連線 Production、未複製資料、未建立 migration。**

背景：

- 使用者確認 DEV 應參考正式區 Supabase 各模組實際會用到的欄位名稱與結構。
- 差異只在資料列：正式區有正式資料，測試區不複製正式資料，而是重新輸入假資料。
- 因此下一步是 schema-only parity，不是 data copy。

新增檔案：

- `docs/PRODUCTION-SCHEMA-ONLY-PARITY-INTAKE.md`
- `scripts/compare-schema-only-parity.js`

修改檔案：

- `.gitignore`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`
- `.github/copilot-instructions.md`

API / UI / DB 影響：

- API：無異動。
- UI：無異動。
- DB：無 schema 異動、無 migration、無 push、無 repair/reset/rollback。
- Production：未連線、未操作、未要求任何密碼或 key。

新增安全措施：

- `.gitignore` 已排除：
  - `schema-intake/*`
  - `*.schema-only.sql`
  - `*.schema.sql`
  - `*.schema-diff.json`
- Production schema-only dump 應放在 `schema-intake/`，不可 commit。
- 正式區 DB password / connection string 不得貼到對話、不得寫入 Git、不得放進命令列參數。

Production schema-only 輸入：

- 檔案：`schema-intake/production-public.schema-only.sql`
- 檔案大小：385,733 bytes
- SHA-256：`CF52046B1E63F02FD0EE181CF3E78A18B76D1B237B6974455B85EB5F59B912DE`
- 來源：使用者本機以 Docker / `pg_dump --schema-only --schema public --no-owner` 產生。
- 密碼已由使用者確認清除；未寫入 repo、`.env`、命令列參數或對話。

新增本機比對工具：

```powershell
node scripts/compare-schema-only-parity.js --production schema-intake/production-public.schema-only.sql --dev supabase/migrations
```

腳本用途：

- 只讀本機檔案，不連 Supabase。
- 比對 Production schema-only SQL 與 DEV migrations。
- 輸出 table、column、sequence、function、trigger、policy、index、constraint、grant 差異摘要。
- 若輸入檔疑似包含 `INSERT`、`COPY`、`auth.users`、`storage.objects`、password/token/key/project ref 或 connection string，會停止。

測試結果：

- `node --check scripts/compare-schema-only-parity.js`：通過。
- `node scripts/compare-schema-only-parity.js --production schema-intake/production-public.schema-only.sql --dev supabase/migrations`：通過。
- Production schema-only 掃描未發現 top-level `INSERT` / `COPY` data dump、`auth.users` data export、`storage.objects` data export、Project Ref、password、JWT、token、key 或 connection string 阻擋項。
- 本輪未執行 tsc / build，因只新增與修正本機 Node 腳本與文件。

比對摘要：

- Production public schema-only：
  - tables：83
  - functions：33
  - policies：220
  - triggers：38
  - indexes：165
  - constraints：339
  - grants：370
- DEV migrations：
  - tables：19
  - functions：40
  - policies：42
  - triggers：15
  - indexes：78
  - constraints：128
  - grants：156
- DEV missing：
  - Production tables：76
  - Production functions：30
  - Production policies：220
  - Production triggers：38
  - Production indexes：155
  - Production constraints：313
  - Production grants：370
  - 同名 table column diff：7 tables
- DEV extra：
  - tables：12
  - functions：37
  - policies / triggers / indexes / constraints / grants 主要來自 DEV 已完成但尚未進 Production 的總務 1B / 1C 新模組。

代表性 DEV missing Production tables：

- `store_employees`
- `assignments`
- `assignment_collaborators`
- `campaigns`
- `campaign_schedules`
- `ga_service_categories`
- `ga_service_regions`
- `ga_vendors`
- `inspection_improvements`
- `inspection_masters`
- `monthly_*`
- `products_master`
- 以及其他正式網既有任務、盤點、月狀態、活動、商品、藥師與人事異動相關 tables。

代表性 DEV extra tables：

- `ga_equipment`
- `ga_equipment_categories`
- `ga_equipment_templates`
- `ga_facilities`
- `ga_facility_categories`
- `ga_inventory_balances`
- `ga_inventory_location_parts`
- `ga_inventory_locations`
- `ga_inventory_transactions`
- `ga_part_categories`
- `ga_part_compatibilities`
- `ga_parts`

解讀：

- Production schema-only 已證明 DEV 尚未復刻正式菁英網完整 public schema。
- DEV extra tables 多數是本輪 DEV-first 總務模組成果，不能視為錯誤；後續若要上 Production，仍需依正式部署流程處理。
- Production missing in DEV 的 76 張 tables 才是「測試區看不到正式區功能與子模組」的主要結構原因。
- 不能直接把 Production schema dump 套到 DEV；下一步必須先設計最小依賴順序與 forward migrations。

尚未完成事項：

- 尚未逐表解讀 Production vs DEV schema diff。
- 尚未依 diff 產出 P1 Core Reference / RBAC / Store Compatibility SQL 草案。
- 尚未建立任何 parity migration。

下一個最小任務：

**P1-B Production / DEV schema diff 解讀與 Core Reference / RBAC / Store Compatibility schema parity 設計。**

建議先處理：

- 正式 permission reference / system roles / role_permissions baseline。
- `store_employees` 與員編、門市、使用者管理相容結構。
- Navbar 入口所需 effective permissions。
- 任務派發與門市管理最小相依 tables。
- System reference seed 與 DEV fake demo seed 分離策略。

禁止事項：

- 不得複製 Production data rows。
- 不得匯出或貼上 Auth users、password、JWT、token、key、connection string。
- 不得把 schema dump commit。
- 不得直接將 Production dump 套到 DEV。
- 不得修改已套用 migrations。
- 不得開始 Task 1C-3。

## 22. P1-B：Schema Diff 解讀與 Core Reference / RBAC / Store Compatibility 設計

任務名稱：P1-B「Production / DEV schema diff 解讀與 Core Reference / RBAC / Store Compatibility parity 設計」

完成狀態：**已完成文件化；未建立 migration、未執行 DB push、未連 Production、未開始 Task 1C-3。**

新增文件：

- `docs/P1B-SCHEMA-PARITY-DESIGN.md`

設計結論：

- DEV 與 Production 的共用核心 RBAC / stores 表欄位集合大致一致：
  - `profiles`
  - `permissions`
  - `roles`
  - `role_permissions`
  - `user_roles`
  - `store_managers`
  - `stores`
- 這些同名表的差異主要是 default 表示法、quoted type、部分 `NOT NULL` 嚴格度與 timestamp default 寫法；目前不建議先動已運作中的 DEV baseline。
- 真正阻擋正式區功能復刻的是 DEV 缺少 76 張 Production legacy tables。
- `store_employees` 是下一階段最關鍵橋接表，支撐正式區「Auth 註冊後，由系統管理員用員編編輯使用者基本資料與角色」的操作邏輯。
- `ga_vendors`、`ga_service_categories`、`ga_service_regions` 是先前總務 UI schema cache error 的直接 schema 缺口，但不應在 P1-B-1 和 RBAC reference 混在一起處理。

建議分階段：

1. P1-B-1 RBAC Reference Seed
   - 補正式 permission reference。
   - 補 system roles / role_permissions baseline。
   - DEV Full Admin role_permissions 全開。
   - 不建立 Auth users，不複製 Production data。

2. P1-B-2 Store / Employee Compatibility
   - 建立 `store_employees`。
   - 對齊正式區欄位與員編管理流程。
   - RLS 使用目前 DEV 安全標準，不照搬 Production 中過寬 grants。

3. P1-B-3 DEV Fake Store / Employee Seed
   - 建立 fake 門市與 fake 員工資料。
   - seed 與 schema migration 分離。
   - 不使用正式門市地址、電話、主管姓名或正式員工資料。

API / UI / DB 影響：

- API：無程式碼異動。
- UI：無程式碼異動。
- DB：無 schema 異動、無 migration、無 push、無 repair/reset/rollback。
- Production：未連線、未操作。

測試與 build 結果：

- 本輪只新增文件，未執行 tsc / build。
- `node --check scripts/compare-schema-only-parity.js` 先前已通過。
- schema-only parity scan 先前已通過。

下一個最小任務：

**P1-B-1 RBAC Reference Seed Design Review / SQL 草案。**

建議產出：

- `supabase/migration_rbac_reference_parity_seed.sql`
- `supabase/test_rbac_reference_parity_seed.sql`
- `supabase/rollback_rbac_reference_parity_seed.sql`

P1-B-1 限制：

- 不直接 push。
- 不建立 Auth users。
- 不新增正式資料。
- 不用 `profiles.role` 取代 RBAC。
- 不修改已套用 migrations。
- 不開始 Task 1C-3。

## 23. P1-C：Production Core Compatibility Schema 草案

任務名稱：P1-C「Production Core Compatibility Schema Draft」

完成狀態：**本機草案、標準 CLI migration、hash 比對、靜態測試、dry-run、正式 DEV db push 與 DB test SQL 驗收已完成。**

新增檔案：

- `supabase/migration_production_core_compatibility.sql`
- `supabase/test_production_core_compatibility.sql`
- `supabase/rollback_production_core_compatibility.sql`
- `scripts/test-production-core-compatibility.js`
- `supabase/migrations/20260724002545_production_core_compatibility.sql`

修改檔案：

- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

Migration 草案內容：

- 補正式區常用 permission reference：
  - `role.*`
  - `user.*`
  - `store.*`
  - `task.*`
  - `employee.*`
  - `monthly.*`
  - `inspection.*`
  - `inventory.*`
  - `activity.*`
  - `cross_dept.*`
  - `performance.*`
  - `pharmacist.*`
  - `relationship_member.*`
  - `dashboard.view`
  - `general_affairs.service_center.force_close`
- 建立 / upsert system roles：
  - `admin`
  - `manager`
  - `member`
  - `dev_full_admin`
- 將 `admin` 與 `dev_full_admin` 授予所有 active permissions。
- 建立 Production core compatibility tables：
  - `permission_logs`
  - `store_employees`
  - `employee_movement_history`
  - `store_relocation_history`
  - `store_transfer_requests`
  - `templates`
  - `assignments`
  - `assignment_collaborators`
  - `logs`
- 建立必要 indexes、constraints、updated_at triggers。
- 建立 `p1c_touch_updated_at()` 與 `p1c_assignment_is_visible(uuid)`。

RLS / grants 設計：

- 所有新表啟用 RLS。
- 不照搬 Production schema-only 中過寬的 `GRANT ALL TO anon/authenticated`。
- `anon` 無 table grants。
- `authenticated` 只取得必要 table privileges，實際可見與可寫仍由 RLS 控制。
- 授權來源使用：
  - `current_user_has_permission()`
  - `auth.uid()`
  - `store_managers`
- 不使用 `profiles.role` 作新授權依據。
- 任務與協作者表避免 RLS recursion，透過 `SECURITY DEFINER` helper `p1c_assignment_is_visible(uuid)` 判斷可見性。

Test SQL 草案：

- 檢查 9 張 core compatibility tables 存在。
- 檢查必要 permission reference 存在。
- 檢查 RLS enabled。
- 檢查 `anon` 無 table grants。
- 檢查 helper functions 為 `SECURITY DEFINER` 且固定 `search_path = public, pg_temp`。
- 檢查 updated_at triggers。
- 檢查 `admin` / `dev_full_admin` 取得所有 active permissions。

Rollback 草案：

- 反向 drop 本批新增 tables。
- drop P1-C helper functions。
- 刪除本批新增 permission reference 與相關 role_permissions。
- 僅在沒有 user_roles 指向時移除 `dev_full_admin` role。
- 不碰已套用 migrations。

靜態測試：

```powershell
node --check scripts/test-production-core-compatibility.js
node scripts/test-production-core-compatibility.js
```

結果：**通過。**

靜態測試確認：

- migration 包含 P1-C 預期 tables。
- RLS enable 存在。
- 必要 permission codes 存在。
- helper functions 使用 `SECURITY DEFINER` 與固定 search_path。
- 不含 Project Ref、password、JWT、token、key、Auth users insert 或 COPY dump。
- 不含 CLI push / repair / reset 指令。
- 不授權 `anon` table privileges。
- 已套用 7 筆 migrations 未修改，並輸出 SHA-256 作為本機證據。

標準 migration / dry-run：

- 標準 migration：`supabase/migrations/20260724002545_production_core_compatibility.sql`
- 來源草案 SHA-256：`6342AD0D28A621F0E9DDB8BB8604C54A284D932FE5621354C22EAA5FAD450966`
- 標準 migration SHA-256：`6342AD0D28A621F0E9DDB8BB8604C54A284D932FE5621354C22EAA5FAD450966`
- hash 比對：一致。
- App DEV Guard：passed。
- CLI DEV Guard：passed。
- `npx supabase migration list`：7 筆既有 migrations local / remote aligned，`20260724002545` 是唯一 local-only migration。
- `npx supabase db push --dry-run`：通過，只列 `20260724002545_production_core_compatibility.sql`。
- `npx supabase db push`：成功套用 `20260724002545_production_core_compatibility.sql`。
- Push 後 `npx supabase migration list`：8 筆 migrations local / remote aligned。
- PostgreSQL NOTICE：僅 `DROP TRIGGER IF EXISTS` / `DROP POLICY IF EXISTS` 找不到舊物件的正常 skipping 訊息。
- `SUPABASE_DB_PASSWORD`：目前 Terminal 未設定。

DB test SQL：

```powershell
npx supabase db query --linked --file supabase/test_production_core_compatibility.sql
```

結果：**全部 PASS。**

- `tables`：PASS
- `permission_reference`：PASS
- `rls_enabled`：PASS
- `no_anon_table_grants`：PASS，details `0`
- `helper_security`：PASS，details `safe=2, total=2`
- `updated_at_triggers`：PASS，details `2`
- `admin_full_permissions`：PASS

未完成事項：

- 尚未做 RLS / API / UI 動態驗收。
- 尚未建立 DEV fake store / employee seed。

下一個最小任務：

**P1-D DEV Fake Store / Employee Seed 草案。**

建議下一步建立 DEV-only seed 草案，不直接套 Production data：

- fake stores
- fake employees
- `store_employees` mapping
- `store_managers` scope
- DEV role / user_role mapping

P1-D 仍不得新增正式 Auth users，不得複製 Production 門市、正式員工、地址、電話或營運資料。

禁止事項：

- 不直接套 Production dump。
- 不複製 Production data。
- 不新增 Auth users。
- 不修改已套用 migrations。
- 不執行 repair/reset/rollback。
- 不開始 Task 1C-3。

## 24. P1-D：DEV Fake Store / Employee Seed

任務名稱：P1-D「DEV Fake Store / Employee Seed」

完成狀態：**DEV-only 假門市、假員工、`store_employees`、`store_managers` scope 與 full admin 權限刷新已建立、套用 DEV 並完成唯讀驗收。**

新增檔案：

- `supabase/seed_dev_store_employee_compatibility.sql`
- `supabase/test_dev_store_employee_compatibility.sql`
- `supabase/cleanup_dev_store_employee_compatibility.sql`
- `scripts/test-dev-store-employee-compatibility.js`

修改檔案：

- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

DB / API / UI 影響：

- DB schema：無異動，未建立 migration。
- DEV data：新增 / 更新 DEV-only fake store、fake employee 與 scope seed。
- API：無程式碼異動。
- UI：無程式碼異動。
- Production：未連線、未操作、未複製任何 Production data。

Seed 內容：

- Fake stores：
  - `DEV001`
  - `DEV002`
  - `DEV003`
  - `DEV004`
  - `DEVHQ`
- Fake Auth user prerequisites：
  - `dev-no-ga@example.test`
  - `dev-ga-access@example.test`
  - `dev-ga-view@example.test`
  - `dev-ga-manage@example.test`
  - `dev-full-admin@example.test`
- Fake profile / employee codes：
  - `DEV0001`
  - `DEV0002`
  - `DEV0003`
  - `DEV0004`
  - `DEV9999`
- `store_employees`：
  - 依 `employee_code` 做 update-then-insert。
  - 不依賴 `id` 衝突，因此可重跑且不會重複建立 DEV 員工。
- `employee_movement_history`：
  - 建立 onboarding fake movement。
  - 使用 `DEV fake seed onboarding record` 標記。
- `store_managers` scope：
  - `dev-ga-access@example.test`：`DEV001` / `store_manager`
  - `dev-ga-view@example.test`：`DEV001`、`DEV002`、`DEV003` / `supervisor`
  - `dev-ga-manage@example.test`：`DEVHQ` / `area_manager`
  - `dev-full-admin@example.test`：`DEVHQ` / `area_manager`
- `admin` 與 `dev_full_admin`：
  - refresh role_permissions，授予所有 active permissions。

執行前安全檢查：

```powershell
node scripts/verify-dev-supabase-environment.js
node scripts/verify-dev-supabase-cli-environment.js
npx supabase migration list
```

結果：

- App DEV Guard：passed，Project Ref `mjpd...mtqr`。
- CLI DEV Guard：passed，Project Ref `mjpd...mtqr`。
- `npx supabase migration list`：8 筆 migrations local / remote aligned。
- 未命中 Production 候選 `odvksgucvfoaqrumpran`。

靜態測試：

```powershell
node --check scripts/test-dev-store-employee-compatibility.js
node scripts/test-dev-store-employee-compatibility.js
```

結果：**通過。**

靜態測試確認：

- seed / test / cleanup 檔案存在且非空。
- seed 檢查 P1-C prerequisite tables。
- seed 檢查五個 DEV Auth users 已存在，但不建立 Auth users。
- `store_employees` 以 `employee_code` update-then-insert，避免重跑重複。
- `store_managers` 以 `(store_id, user_id, role_type)` idempotent upsert。
- cleanup 不刪 Auth users、profiles、roles、permissions、role_permissions。
- cleanup 不刪 baseline store `DEV001` / `DEV002`。
- 不含 Production Project Ref、DEV Project Ref、password、JWT、token、key、connection string。
- 不含 `COPY` dump 或 `INSERT INTO auth.users`。

DEV seed 執行：

```powershell
npx supabase db query --linked --file supabase/seed_dev_store_employee_compatibility.sql
```

結果：**成功。**

- `dev_store_count`：5
- `dev_employee_count`：5
- `dev_scope_count`：6

DEV 唯讀驗收：

```powershell
npx supabase db query --linked --file supabase/test_dev_store_employee_compatibility.sql
```

結果：**全部 PASS。**

- `stores`：PASS，expected 5 / actual 5
- `profiles`：PASS，expected 5 / actual 5
- `store_employees`：PASS，expected 5 / actual 5
- `store_employee_no_duplicates`：PASS，duplicate_employee_codes 0
- `store_manager_scopes`：PASS，expected 6 / actual 6
- `movement_history`：PASS，expected 5 / actual 5
- `permission_references`：PASS，expected 7 / actual 7
- `dev_full_admin_permissions`：PASS，active_permissions 123 / dev_full_admin_allowed 123

清理方式：

```powershell
npx supabase db query --linked --file supabase/cleanup_dev_store_employee_compatibility.sql
```

清理 SQL 只處理 P1-D fake seed records：

- 刪除預期 fake `store_managers` scopes。
- 刪除 `employee_movement_history` 中 notes 為 `DEV fake seed onboarding record` 的 DEV rows。
- 刪除 `store_employees` 中 `DEV0001`、`DEV0002`、`DEV0003`、`DEV0004`、`DEV9999`。
- 刪除額外 fake stores：`DEV003`、`DEV004`、`DEVHQ`。
- 不刪 `DEV001` / `DEV002` baseline stores。
- 不刪 Auth users、profiles、roles、permissions、role_permissions。

發現與修正：

- 初版 seed 曾使用 `store_managers.role_type = general_affairs / admin`，被既有 constraint 擋下。
- 既有合法值為 `store_manager`、`supervisor`、`area_manager`。
- 已修正為 `area_manager`，不修改 DB constraint。
- 初版 `store_employees` insert 曾有依賴 random `id` conflict 的可重跑風險，已改為 `employee_code` update-then-insert。

未完成事項：

- 尚未對 UI 進行 P1-D 後人工複驗。
- 尚未建立其他 Production legacy modules schema。
- 尚未開始 Task 1C-3。

下一個最小任務：

**P1-E Production Legacy Module Schema Compatibility 下一批草案。**

建議繼續依 Production schema-only 建立下一批 schema-only compatibility migration 草案，目標是讓 DEV 測試區逐步具備正式區功能模組需要的表與欄位，但仍不匯入正式資料。

禁止事項：

- 不複製 Production 業務資料。
- 不建立 Production Auth users。
- 不使用正式門市地址、電話、主管姓名或員工資料。
- 不修改已套用 migrations。
- 不執行 repair/reset/rollback。
- 不開始 Task 1C-3，除非使用者明確批准。

## 25. P1-E：Production Legacy General Affairs / Maintenance Compatibility

任務名稱：P1-E「Production Legacy General Affairs / Maintenance Compatibility」

完成狀態：**本機 SQL 草案、標準 CLI migration、hash 比對、靜態測試、Guard、dry-run、正式 DEV db push 與 catalog test SQL 驗收已完成。**

新增檔案：

- `supabase/migration_production_legacy_general_affairs_maintenance_compatibility.sql`
- `supabase/test_production_legacy_general_affairs_maintenance_compatibility.sql`
- `supabase/rollback_production_legacy_general_affairs_maintenance_compatibility.sql`
- `scripts/test-production-legacy-general-affairs-maintenance-compatibility.js`
- `supabase/migrations/20260724011554_production_legacy_general_affairs_maintenance_compatibility.sql`

修改檔案：

- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

目的：

- 讓 DEV 測試區先補齊正式總務服務中心 legacy 子功能最常撞到的 schema 缺口。
- 消除人工驗收曾遇到的原始 schema cache 錯誤來源：
  - `public.ga_vendors`
  - `public.ga_service_categories`
  - `public.ga_service_regions`
  - 維修模組 tables
- 本批仍只做 schema compatibility，不匯入 Production business rows。

Migration 範圍：

- General Affairs legacy references：
  - `ga_service_categories`
  - `ga_service_regions`
  - `ga_vendors`
- Maintenance foundation：
  - `maintenance_categories`
  - `maintenance_progress_stages`
  - `maintenance_requests`
  - `maintenance_photos`
  - `maintenance_updates`
  - `maintenance_update_photos`
  - `maintenance_ticket_events`
- Shared helper：
  - `update_updated_at_column()`

主要欄位來源：

- 欄位依本機 schema-only 檔 `schema-intake/production-public.schema-only.sql` 抽取。
- 只使用 schema-only evidence，不使用 Production data rows。
- Production schema-only SHA-256：
  - `CF52046B1E63F02FD0EE181CF3E78A18B76D1B237B6974455B85EB5F59B912DE`

RLS / grants：

- 所有新增表啟用 RLS。
- 不照搬 Production schema-only 中維修表的 `USING true` 寬鬆 policy。
- `anon` 無 table grants。
- `authenticated` 有表層 SELECT / INSERT / UPDATE / DELETE grants，但實際讀寫由 RLS 控制。
- `service_role` 有 ALL grants。
- 授權來源使用：
  - `current_user_has_permission()`
  - `auth.uid()`
  - `store_managers`
- General Affairs legacy refs：
  - 需要 `general_affairs.service_center.access`。
- Maintenance categories / stages：
  - 讀取需要 submit / view_all / update / category.edit 任一維修權限。
  - 寫入需要 `cross_dept.maintenance.category.edit`。
- Maintenance requests：
  - view_all 可看全部。
  - 回報者可看自己的。
  - store_manager 可看自己管理門市。
  - insert 需要 submit 且限管理門市，或 view_all。
  - update 需要 view_all 或 update。
  - delete 允許 view_all / update / reported_by，對齊既有 API 的硬刪行為。
- Photos / updates / ticket events：
  - 依 request/update 可見性、操作者或 maintenance update 權限控制。

靜態測試：

```powershell
node --check scripts/test-production-legacy-general-affairs-maintenance-compatibility.js
node scripts/test-production-legacy-general-affairs-maintenance-compatibility.js
```

結果：**通過。**

靜態測試確認：

- migration 只包含 P1-E 10 張表。
- 未建立 inventory result、inspection、monthly、products、campaign、pharmacist、relationship member 或 Task 1C-3 內容。
- 每張表 RLS enabled。
- 具備預期 policies、indexes、triggers。
- helper 固定 `search_path = public, pg_temp`。
- 不含 `USING (true)` / `WITH CHECK (true)` 過寬 policy。
- 不 grant table privileges 給 `anon`。
- 不含 seed `INSERT`、`COPY` dump、Auth users insert。
- 不含 Project Ref、password、JWT、token、key 或 connection string。
- 不含 CLI push / repair / reset 指令。

標準 migration / hash：

- 標準 migration：
  - `supabase/migrations/20260724011554_production_legacy_general_affairs_maintenance_compatibility.sql`
- 來源草案 SHA-256：
  - `526C8588C77CE2BE6EE7AAFE7E7DFFA2539234D4643A3D1BF208A6B354E402AC`
- 標準 migration SHA-256：
  - `526C8588C77CE2BE6EE7AAFE7E7DFFA2539234D4643A3D1BF208A6B354E402AC`
- hash 比對：一致。

Guard / migration list / dry-run / push：

```powershell
node scripts/verify-dev-supabase-environment.js
node scripts/verify-dev-supabase-cli-environment.js
npx supabase migration list
npx supabase db push --dry-run
npx supabase db push
```

結果：

- App DEV Guard：passed，Project Ref `mjpd...mtqr`。
- CLI DEV Guard：passed，Project Ref `mjpd...mtqr`。
- Production 候選 `odvksgucvfoaqrumpran` 未命中。
- `npx supabase migration list`：
  - 8 筆既有 migrations local / remote aligned。
  - `20260724011554` 是唯一 local-only migration。
- `npx supabase db push --dry-run`：
  - 通過。
  - 只列 `20260724011554_production_legacy_general_affairs_maintenance_compatibility.sql`。
  - 未列 baseline、P1-C、test SQL、rollback 或 seed。
- `npx supabase db push`：
  - 成功套用 `20260724011554_production_legacy_general_affairs_maintenance_compatibility.sql`。
  - PostgreSQL NOTICE 皆為 `DROP TRIGGER IF EXISTS` / `DROP POLICY IF EXISTS` 找不到舊物件的正常 skipping 訊息。
- Push 後 `npx supabase migration list`：
  - 曾因 `SUPABASE_DB_PASSWORD` 未設定與 Supabase pooler temporary auth retry / circuit breaker 失敗。
  - 未重試轟炸。
  - 改用 `npx supabase db query --linked "select version from supabase_migrations.schema_migrations order by version;"` 做唯讀確認。
  - 遠端 migration history 回傳 9 筆版本，包含 `20260724011554`。
- `SUPABASE_DB_PASSWORD`：
  - 目前 Terminal 未設定。

Test SQL：

- `supabase/test_production_legacy_general_affairs_maintenance_compatibility.sql`
- 已在 DEV 執行：

```powershell
npx supabase db query --linked --file supabase/test_production_legacy_general_affairs_maintenance_compatibility.sql
```

結果：**全部 PASS。**

- `tables`：PASS，expected 10 / actual 10
- `columns`：PASS，expected 11 / actual 11
- `rls_enabled`：PASS，expected 10 / actual 10
- `policies`：PASS，expected 22 / actual 22
- `triggers`：PASS，expected 6 / actual 6
- `indexes`：PASS，expected 8 / actual 8
- `no_anon_table_grants`：PASS，details `0`
- `helper_security`：PASS，`security_definer=f search_path=search_path=public, pg_temp`

Rollback：

- `supabase/rollback_production_legacy_general_affairs_maintenance_compatibility.sql`
- 僅供 DEV 明確批准時使用。
- 會 drop P1-E 10 張表。
- 保留 `update_updated_at_column()`，因其他 legacy parity batch 可能共用。

未完成事項：

- 尚未做 API / UI 人工複驗。
- 尚未建立維修 demo seed。
- 尚未處理盤點、月狀態、藥師、活動、商品主檔、關係會員等其他正式 legacy modules。
- 尚未開始 Task 1C-3。

下一個最小任務：

**P1-F Production Legacy Inventory Result / Inspection / Monthly Schema Compatibility 草案。**

建議下一批優先：

- 盤點結果分析。
- 督導巡店。
- 每月人員狀態。

仍採 schema-only compatibility；不得匯入 Production business rows。

禁止事項：

- 不得複製 Production business data。
- 不得建立 Production Auth users。
- 不得修改已套用 migrations。
- 不得 repair/reset/rollback。
- 不得開始 Task 1C-3。

## 27. P1-G：Production Legacy Product / Relationship / Clinic / Performance Compatibility

任務名稱：P1-G「Production Legacy Product / Relationship Member / Clinic Self-pay / Performance Schema Compatibility」

完成狀態：**本機 SQL 草案、標準 CLI migration、hash 比對、靜態測試、Guard、dry-run、正式 DEV db push 與 catalog test SQL 驗收已完成。**

新增檔案：

- `supabase/migration_production_legacy_product_relationship_clinic_performance_compatibility.sql`
- `supabase/test_production_legacy_product_relationship_clinic_performance_compatibility.sql`
- `supabase/rollback_production_legacy_product_relationship_clinic_performance_compatibility.sql`
- `scripts/test-production-legacy-product-relationship-clinic-performance-compatibility.js`
- `supabase/migrations/20260724035445_production_legacy_product_relationship_clinic_performance_compatibility.sql`

修改檔案：

- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

Migration 範圍：

- 商品主檔 / 建檔掃描：
  - `products_master`
  - `product_barcodes`
  - `acquisition_scans`
  - `acquisition_unmatched`
- 關係會員：
  - `relationship_members`
  - `relationship_sales_imports`
  - `relationship_sales_details`
- 診所自費：
  - `clinic_selfpay_price_entries`
  - `clinic_selfpay_price_month_closures`
  - `clinic_selfpay_claim_batches`
  - `clinic_selfpay_claim_items`
- 績效：
  - `store_performance_thresholds`
  - `monthly_performance_details`

API / UI / DB 影響：

- API：本輪未修改。
- UI：本輪未修改。
- DB：只新增 schema-only compatibility 草案與一筆標準 local-only migration。
- Production：未連線、未操作、未複製 Production business rows。
- P1-G 的 RLS 原則：
  - 商品主檔與藥品建檔掃描使用 `store.products_master.manage`。
  - 關係會員使用 `relationship_member.*`。
  - 診所自費使用 `store.clinic_selfpay.*` 與 `store_managers` 門市 scope。
  - 績效資料使用 `performance.*`、`monthly.status.view_performance` 與 `store_managers` scope。
  - 不使用 `profiles.role` 作為授權依據。
  - 不建立 `USING (true)` / `WITH CHECK (true)` 寬鬆 policy。
  - 不授權 `anon` table privileges。

靜態測試：

```powershell
node --check scripts/test-production-legacy-product-relationship-clinic-performance-compatibility.js
node scripts/test-production-legacy-product-relationship-clinic-performance-compatibility.js
```

結果：

- `node --check`：通過。
- 靜態測試：通過。
- 確認 migration 只包含 P1-G 13 張表。
- 確認未建立 campaign、pharmacist、maintenance、P1-F、inventory transaction 或 Task 1C-3 內容。
- 確認沒有 `INSERT INTO` / `COPY` / Auth users / Project Ref / secrets / CLI repair/reset/push 指令。

標準 migration / hash：

- 標準 migration：
  - `supabase/migrations/20260724035445_production_legacy_product_relationship_clinic_performance_compatibility.sql`
- 來源草案 SHA-256：
  - `2D2CF68C1083BEDAC41336576A2B2EF9596437839B87B085055F919B170F970E`
- 標準 migration SHA-256：
  - `2D2CF68C1083BEDAC41336576A2B2EF9596437839B87B085055F919B170F970E`
- hash 比對：一致。

Guard / migration list / dry-run：

```powershell
node scripts/verify-dev-supabase-environment.js
node scripts/verify-dev-supabase-cli-environment.js
npx supabase migration list
npx supabase db push --dry-run
```

結果：

- App DEV Guard：passed，Project Ref `mjpd...mtqr`。
- CLI DEV Guard：passed，Project Ref `mjpd...mtqr`。
- Production 候選 `odvksgucvfoaqrumpran` 未命中。
- `npx supabase migration list`：
  - push 前 10 筆既有 migrations local / remote aligned。
  - push 前 `20260724035445` 是唯一 local-only migration。
- `npx supabase db push --dry-run`：
  - 通過。
  - 只列 `20260724035445_production_legacy_product_relationship_clinic_performance_compatibility.sql`。
  - 未列 baseline、P1-C、P1-E、P1-F、test SQL、rollback 或 seed。
- `npx supabase db push`：
  - 成功套用 `20260724035445_production_legacy_product_relationship_clinic_performance_compatibility.sql`。
  - PostgreSQL NOTICE 皆為 `DROP TRIGGER IF EXISTS` / `DROP POLICY IF EXISTS` 找不到舊物件的正常 skipping 訊息。
- Push 後 `npx supabase migration list`：
  - 曾因 `SUPABASE_DB_PASSWORD` 未設定與 CLI login role password authentication failed。
  - 未重試轟炸。
  - 改用 `npx supabase db query --linked "select version from supabase_migrations.schema_migrations order by version;"` 做唯讀確認。
  - 遠端 migration history 回傳 11 筆版本，包含 `20260724035445`。

Test SQL：

```powershell
npx supabase db query --linked --file supabase/test_production_legacy_product_relationship_clinic_performance_compatibility.sql
```

結果全部 PASS：

- `columns`：PASS，13 / 13。
- `indexes`：PASS，11 / 11。
- `no_anon_table_grants`：PASS，0。
- `no_using_true_policies`：PASS，0。
- `policies`：PASS，28 / 28。
- `rls_enabled`：PASS，13 / 13。
- `tables`：PASS，13 / 13。
- `triggers`：PASS，5 / 5。

Rollback：

- `supabase/rollback_production_legacy_product_relationship_clinic_performance_compatibility.sql`
- 僅供 DEV 明確批准時使用。
- 會 drop P1-G 13 張 compatibility tables。
- 保留 `update_updated_at_column()`，因 legacy parity batches 共用。

尚未完成事項：

- 尚未做 API / UI 人工複驗。
- 尚未開始 Task 1C-3。
- DEV 仍非正式區完整 schema parity，後續需繼續分批處理其他 legacy modules。

下一個最小任務：

**P1-H Production Legacy Campaign / Pharmacist / Remaining Schema Compatibility 草案。**

建議下一批依 Production schema-only 與正式導覽優先處理：

- 活動 / 促銷 campaign tables。
- 藥師管理 pharmacist tables。
- 剩餘 relationship / stockout / clinic / support tables。

下一批仍須只做 schema-only compatibility，不得匯入正式資料。

禁止事項：

- 不得複製 Production business data。
- 不得建立 Production Auth users。
- 不得修改已套用 migrations。
- 不得 repair/reset/rollback。
- 不得開始 Task 1C-3。

## 26. P1-F：Production Legacy Inventory Result / Inspection / Monthly Compatibility

任務名稱：P1-F「Production Legacy Inventory Result / Inspection / Monthly Schema Compatibility」

完成狀態：**本機 SQL 草案、標準 CLI migration、hash 比對、靜態測試、Guard、dry-run、正式 DEV db push 與 catalog test SQL 驗收已完成。**

新增檔案：

- `supabase/migration_production_legacy_inventory_inspection_monthly_compatibility.sql`
- `supabase/test_production_legacy_inventory_inspection_monthly_compatibility.sql`
- `supabase/rollback_production_legacy_inventory_inspection_monthly_compatibility.sql`
- `scripts/test-production-legacy-inventory-inspection-monthly-compatibility.js`
- `supabase/migrations/20260724025452_production_legacy_inventory_inspection_monthly_compatibility.sql`

修改檔案：

- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

Migration 範圍：

- 盤點結果分析：
  - `inventory_result_batches`
  - `inventory_result_items`
  - `inventory_result_settings`
- 督導巡店：
  - `inspection_templates`
  - `inspection_masters`
  - `inspection_results`
  - `inspection_improvements`
  - `inspection_on_duty_staff`
  - `inspection_bonus_config`
  - `inspection_grade_mapping`
- 每月人員狀態 / 獎金摘要：
  - `monthly_staff_status`
  - `monthly_store_summary`
  - `monthly_bonus_records`

API / UI / DB 影響：

- API：本輪未修改。
- UI：本輪未修改。
- DB：只新增 schema-only compatibility 草案與一筆標準 local-only migration。
- Production：未連線、未操作、未複製 Production business rows。
- P1-F 的 RLS 原則：
  - 盤點結果分析使用 `inventory.result_analysis.*` 權限與 `store_managers` 門市 scope。
  - 督導巡店使用 `inspection.*` 權限、`auth.uid()` 與 `store_managers` scope。
  - 每月人員狀態使用 `monthly.status.*` 權限、本人資料與 `store_managers` scope。
  - 不使用 `profiles.role` 作為授權依據。
  - 不建立 `USING (true)` / `WITH CHECK (true)` 寬鬆 policy。
  - 不授權 `anon` table privileges。

靜態測試：

```powershell
node --check scripts/test-production-legacy-inventory-inspection-monthly-compatibility.js
node scripts/test-production-legacy-inventory-inspection-monthly-compatibility.js
```

結果：

- `node --check`：通過。
- 靜態測試：通過。
- 確認 migration 只包含 P1-F 13 張表。
- 確認未建立 `ga_inventory_transactions`、`ga_inventory_balances`、`ga_vendors`、maintenance tables、products、campaigns、pharmacist、relationship member 或 Task 1C-3 內容。
- 確認沒有 `INSERT INTO` / `COPY` / Auth users / Project Ref / secrets / CLI repair/reset/push 指令。

標準 migration / hash：

- 標準 migration：
  - `supabase/migrations/20260724025452_production_legacy_inventory_inspection_monthly_compatibility.sql`
- 來源草案 SHA-256：
  - `B9749FB15D37B5D291987C870C2A1B7EAD9B92E6C640F55B5CBA939C202B50AA`
- 標準 migration SHA-256：
  - `B9749FB15D37B5D291987C870C2A1B7EAD9B92E6C640F55B5CBA939C202B50AA`
- hash 比對：一致。

修正紀錄：

- 首次正式 push 時，migration 第 0 段 prerequisite check 使用 `current_user_has_permission(text)`，但 DEV baseline 實際函式簽名為 `current_user_has_permission(character varying)`。
- 該 migration 尚未成功套用，因此允許修正 local-only migration 與平放來源 SQL 的 prerequisite check。
- 修正後重新執行靜態測試、hash 比對與 dry-run，全部通過。

Guard / migration list / dry-run：

```powershell
node scripts/verify-dev-supabase-environment.js
node scripts/verify-dev-supabase-cli-environment.js
npx supabase migration list
npx supabase db push --dry-run
```

結果：

- App DEV Guard：passed，Project Ref `mjpd...mtqr`。
- CLI DEV Guard：passed，Project Ref `mjpd...mtqr`。
- Production 候選 `odvksgucvfoaqrumpran` 未命中。
- `npx supabase migration list`：
  - push 前 9 筆既有 migrations local / remote aligned。
  - push 前 `20260724025452` 是唯一 local-only migration。
- `npx supabase db push --dry-run`：
  - 通過。
  - 只列 `20260724025452_production_legacy_inventory_inspection_monthly_compatibility.sql`。
  - 未列 baseline、P1-C、P1-E、test SQL、rollback 或 seed。
- `npx supabase db push`：
  - 成功套用 `20260724025452_production_legacy_inventory_inspection_monthly_compatibility.sql`。
  - PostgreSQL NOTICE 皆為 `DROP TRIGGER IF EXISTS` / `DROP POLICY IF EXISTS` 找不到舊物件的正常 skipping 訊息。
- Push 後 `npx supabase migration list`：
  - 曾因 `SUPABASE_DB_PASSWORD` 未設定與 CLI login role password authentication failed。
  - 未重試轟炸。
  - 改用 `npx supabase db query --linked "select version from supabase_migrations.schema_migrations order by version;"` 做唯讀確認。
  - 遠端 migration history 回傳 10 筆版本，包含 `20260724025452`。

Test SQL：

```powershell
npx supabase db query --linked --file supabase/test_production_legacy_inventory_inspection_monthly_compatibility.sql
```

結果全部 PASS：

- `columns`：PASS，14 / 14。
- `indexes`：PASS，9 / 9。
- `no_anon_table_grants`：PASS，0。
- `no_using_true_policies`：PASS，0。
- `policies`：PASS，26 / 26。
- `rls_enabled`：PASS，13 / 13。
- `tables`：PASS，13 / 13。
- `triggers`：PASS，10 / 10。

Rollback：

- `supabase/rollback_production_legacy_inventory_inspection_monthly_compatibility.sql`
- 僅供 DEV 明確批准時使用。
- 會 drop P1-F 13 張 compatibility tables。
- 保留 `update_updated_at_column()`，因 P1-E 與後續 legacy parity batch 可能共用。

尚未完成事項：

- 尚未做 API / UI 人工複驗。
- 尚未開始 Task 1C-3。
- DEV 仍非正式區完整 schema parity，後續需繼續分批處理其他 legacy modules。

下一個最小任務：

**P1-G Production Legacy 下一批 schema compatibility 草案。**

建議下一批依 Production schema-only 與正式導覽優先處理：

- 商品主檔 / 商品相關 reference。
- 活動 / 促銷。
- 藥師 / 績效 / 關係會員等正式區仍缺 schema。

下一批仍須只做 schema-only compatibility，不得匯入正式資料。

禁止事項：

- 不得複製 Production business data。
- 不得建立 Production Auth users。
- 不得修改已套用 migrations。
- 不得 repair/reset/rollback。
- 不得開始 Task 1C-3。

## 28. P1-H：Production Legacy Campaign / Pharmacist / Stockout / Bonus Compatibility

任務名稱：P1-H「Production Legacy Campaign / Pharmacist / Stockout / Bonus / Remaining Schema Compatibility」

完成狀態：**本機 SQL 草案、標準 CLI migration、hash 比對、靜態測試、Guard、dry-run、正式 DEV db push 與 catalog test SQL 驗收已完成。**

新增檔案：

- `supabase/migration_production_legacy_campaign_pharmacist_remaining_compatibility.sql`
- `supabase/test_production_legacy_campaign_pharmacist_remaining_compatibility.sql`
- `supabase/rollback_production_legacy_campaign_pharmacist_remaining_compatibility.sql`
- `scripts/test-production-legacy-campaign-pharmacist-remaining-compatibility.js`
- `supabase/migrations/20260724040838_production_legacy_campaign_pharmacist_remaining_compatibility.sql`

修改檔案：

- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

Migration 範圍：

- 活動 / 促銷：
  - `campaigns`
  - `campaign_schedules`
  - `campaign_store_details`
  - `campaign_store_headcount`
  - `campaign_store_own_staff`
  - `campaign_support_requests`
  - `campaign_support_staff`
  - `campaign_equipment_trips`
  - `campaign_checklist_items`
  - `campaign_checklist_completions`
  - `campaign_department_publish`
  - `event_dates`
  - `store_activity_settings`
- 藥師：
  - `pharmacist_profiles`
  - `pharmacist_annual_master`
  - `pharmacist_annual_fees`
  - `pharmacist_annual_master_locks`
  - `pharmacist_annual_master_sync_log`
  - `pharmacist_monthly_snapshot`
  - `pharmacist_monthly_snapshot_sync_log`
  - `pharmacist_snapshot_locks`
- 缺貨 / 跨部門商品回覆：
  - `stockout_reports`
  - `stockout_product_responses`
  - `stockout_product_response_history`
- 津貼 / 獎金 / 績效：
  - `meal_allowance_records`
  - `spring_festival_bonus`
  - `support_staff_bonus`
  - `talent_cultivation_bonus`
  - `store_performance`

明確排除：

- Production backup tables：
  - `assignment_cleanup_backup_20260401`
  - `maintenance_status_migration_backup`
- P1-C 已建立：
  - `store_transfer_requests`
- 已完成批次：
  - P1-E maintenance / vendors / service category / service region
  - P1-F inventory result / inspection / monthly status
  - P1-G product / relationship / clinic self-pay / performance detail
- Task 1C-3、正式資料、Auth users、Storage object rows。

API / UI / DB 影響：

- API：本輪未修改。
- UI：本輪未修改。
- DB：新增 schema-only compatibility migration，已正式套用 DEV。
- Production：未連線、未操作、未複製 Production business rows。
- RLS 原則：
  - 活動使用 `activity.*` 權限與 `store_managers` 門市 scope。
  - 藥師使用 `pharmacist.management.*` 權限；月快照對應 store scope 可讀。
  - 缺貨使用 `cross_dept.stockout.*` 權限與 `store_managers` 門市 scope。
  - 津貼 / 獎金 / 績效使用 `monthly.allowance.*`、`performance.*` 權限與 `store_managers` scope。
  - 不使用 `profiles.role` 作為授權依據。
  - 不建立 `USING (true)` / `WITH CHECK (true)` 寬鬆 policy。
  - 不授權 `anon` table privileges。

靜態測試：

```powershell
node --check scripts/test-production-legacy-campaign-pharmacist-remaining-compatibility.js
node scripts/test-production-legacy-campaign-pharmacist-remaining-compatibility.js
```

結果：

- `node --check`：通過。
- 靜態測試：通過。
- 確認 migration 只包含 P1-H 29 張表。
- 確認未建立 backup tables、`store_transfer_requests`、P1-E、P1-F、P1-G、inventory transaction 或 Task 1C-3 內容。
- 確認沒有 `INSERT INTO` / `COPY` / Auth users / Project Ref / secrets / CLI repair/reset/push 指令。

標準 migration / hash：

- 標準 migration：
  - `supabase/migrations/20260724040838_production_legacy_campaign_pharmacist_remaining_compatibility.sql`
- 來源草案 SHA-256：
  - `4FCBF36CBA845E04384E1E26BBFF02F65F0EBB186519B07669B5C37215ABF840`
- 標準 migration SHA-256：
  - `4FCBF36CBA845E04384E1E26BBFF02F65F0EBB186519B07669B5C37215ABF840`
- hash 比對：一致。

Guard / migration list / dry-run：

```powershell
node scripts/verify-dev-supabase-environment.js
node scripts/verify-dev-supabase-cli-environment.js
npx supabase migration list
npx supabase db push --dry-run
```

結果：

- App DEV Guard：passed，Project Ref `mjpd...mtqr`。
- CLI DEV Guard：passed，Project Ref `mjpd...mtqr`。
- Production 候選 `odvksgucvfoaqrumpran` 未命中。
- `npx supabase migration list`：
  - 11 筆既有 migrations local / remote aligned。
  - `20260724040838` 是唯一 local-only migration。
- `npx supabase db push --dry-run`：
  - 通過。
  - 只列 `20260724040838_production_legacy_campaign_pharmacist_remaining_compatibility.sql`。
  - 未列 baseline、P1-C、P1-E、P1-F、P1-G、test SQL、rollback 或 seed。
- `npx supabase db push`：
  - 成功套用 `20260724040838_production_legacy_campaign_pharmacist_remaining_compatibility.sql`。
  - PostgreSQL NOTICE 皆為 `DROP TRIGGER IF EXISTS` / `DROP POLICY IF EXISTS` 找不到舊物件的正常 skipping 訊息。
- Push 後 `npx supabase migration list` / migration history read-only query：
  - 曾遇到 Supabase pooler `ECIRCUITBREAKER` / `cli_login_postgres` password authentication failure。
  - 已停止重試，避免造成更多 temporary auth failures。
  - P1-H catalog test SQL 隨後能成功查到 P1-H objects 並全部 PASS，因此 P1-H schema 已套用。

Test SQL：

```powershell
npx supabase db query --linked --file supabase/test_production_legacy_campaign_pharmacist_remaining_compatibility.sql
```

結果全部 PASS：

- `columns`：PASS，10 / 10。
- `indexes`：PASS，10 / 10。
- `no_anon_table_grants`：PASS，0。
- `no_using_true_policies`：PASS，0。
- `policies`：PASS，12 / 12。
- `rls_enabled`：PASS，29 / 29。
- `tables`：PASS，29 / 29。
- `triggers`：PASS，12 / 12。

尚未完成事項：

- 尚未做 API / UI 人工複驗。
- 尚未開始 Task 1C-3。
- DEV 仍需後續確認是否還有 Production schema-only 中未復刻、但非 backup 的表或 functions。

下一個最小任務：

**P1-I：Production schema-only remaining objects / functions / policies parity scan。**

建議下一輪順序：

1. 重新執行本機 schema-only parity scan。
2. 列出 Production schema-only 中仍未被 DEV migrations 覆蓋、且不是 backup table 的 objects。
3. 只建立下一批 schema-only compatibility 草案。
4. 不匯入 Production data。

禁止事項：

- 不得複製 Production business data。
- 不得建立 Production Auth users。
- 不得修改已套用 migrations。
- 不得 repair/reset/rollback。
- 不得開始 Task 1C-3。

## 29. P1-I：Production Schema-only Remaining Objects Scan

任務名稱：P1-I「Production schema-only remaining objects / functions / policies parity scan」

完成狀態：**本機掃描完成；未建立 migration、未連線 Production、未操作遠端 DB。**

執行命令：

```powershell
node scripts/compare-schema-only-parity.js --production schema-intake/production-public.schema-only.sql --dev supabase/migrations
```

補充精準 business table scan：

- Production public schema-only tables：83。
- DEV migrations tables：78。
- 排除 Production backup tables：
  - `assignment_cleanup_backup_20260401`
  - `maintenance_status_migration_backup`
- 排除已知核心 baseline tables：
  - `profiles`
  - `roles`
  - `permissions`
  - `role_permissions`
  - `user_roles`
  - `stores`
  - `store_managers`
- 結果：
  - `missingBusinessTables = 0`
  - `missingBusinessTablesList = []`

重要解讀：

- 以目前 Production schema-only 檔案為依據，DEV 已經補齊非 backup、非核心已知的 business table skeleton。
- `compare-schema-only-parity.js` 仍顯示大量 functions / policies / constraints / grants / columnDiffTables 差異，原因包含：
  - DEV 使用較安全的 compatibility RLS policy names 與 policy bodies，沒有直接照搬 Production policy。
  - DEV 沒有照搬 Production schema-only 中對 `anon` / `authenticated` 的過寬 grants。
  - DEV 有 Task 1B / 1C 新總務庫存 tables，是 Production schema-only 沒有的 DEV extra objects。
  - 部分 Production functions 仍未完整復刻，尤其：
    - inspection / monthly bonus calculation functions
    - employee movement functions
    - relationship updated_at helper
    - pharmacist legacy helper names
    - stockout legacy helper names
  - 部分差異是「功能相容骨架足夠」但不是 byte-for-byte schema parity。

目前仍需注意的 Production-only backup tables：

- `assignment_cleanup_backup_20260401`
- `maintenance_status_migration_backup`

不建議自動搬入 DEV，除非使用者明確要求備份表相容。

下一個最小任務：

**P1-J：正式功能 API/UI parity 複驗與 remaining legacy functions 風險盤點。**

建議下一輪：

1. 不再盲目新增 schema tables，先用正式導覽與 API routes 驗證 DEV 是否還有 schema cache errors。
2. 若 API 因缺 function 失敗，再依錯誤建立最小 forward migration。
3. 對 `compare-schema-only-parity.js` 顯示的 missing functions 做風險分級：
   - 直接被現有 API route 呼叫者優先。
   - 只屬 Production old trigger/helper 且 DEV 已用安全替代 helper 者可記錄為非阻擋。
4. 不匯入 Production data。
5. 不開始 Task 1C-3。

## 30. P1-J：Production Legacy RBAC RPC Compatibility

任務名稱：P1-J「Production Legacy RBAC RPC Compatibility」

完成狀態：**本機 SQL 草案、標準 CLI migration、API/schema audit、hash 比對、靜態測試、dry-run、正式 DEV db push 與 catalog test SQL 驗收已完成。**

背景：

- P1-I 後，本機 API/schema audit 發現所有 table references 已可由 DEV migrations 覆蓋。
- 剩餘實際 RPC 缺口只有：
  - `check_user_permission`
  - `get_all_employees_for_rbac`
- 兩者都被現有正式功能 API route 直接引用：
  - `app/api/products-master/route.ts`
  - `app/api/users/search/route.ts`
- `get_all_employees_for_rbac()` 會影響角色權限管理中依員編、姓名或 email 搜尋使用者的流程，與目前 DEV RBAC 操作體驗問題相關。

新增檔案：

- `supabase/migration_production_legacy_rbac_rpc_compatibility.sql`
- `supabase/test_production_legacy_rbac_rpc_compatibility.sql`
- `supabase/rollback_production_legacy_rbac_rpc_compatibility.sql`
- `scripts/test-production-legacy-rbac-rpc-compatibility.js`
- `supabase/migrations/20260724042430_production_legacy_rbac_rpc_compatibility.sql`
- `docs/P1-J-API-SCHEMA-PARITY-AUDIT.json`

修改檔案：

- `scripts/audit-dev-api-schema-parity.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

Migration 範圍：

- 新增 `public.check_user_permission(uuid, varchar)`
  - `SECURITY DEFINER`
  - `SET search_path = public, pg_temp`
  - 僅允許查目前 `auth.uid()` 自己的權限。
  - 委派到既有 `public.has_permission(p_user_id, p_permission_code)`。
  - 不允許一般 authenticated 使用者查任意其他 user id。
- 新增 `public.get_all_employees_for_rbac()`
  - `SECURITY DEFINER`
  - `SET search_path = public, pg_temp`
  - 只在目前登入者具備使用者/角色管理相關 effective permissions 時回傳資料。
  - 使用 `current_user_has_permission()` 檢查：
    - `user.user.view`
    - `user.user.edit`
    - `user.user.create`
    - `user.user.delete`
    - `user.user.change_role`
    - `role.user_role.view`
    - `role.user_role.assign`
    - `role.user_role.revoke`
    - `role.role.view`
  - 優先回傳 `profiles` 的員編、姓名、email；若 `store_employees` 存在，也合併其資料。
  - 不使用 legacy profile display fields 作為授權依據。
- Function grants：
  - `PUBLIC`：無 EXECUTE。
  - `anon`：無 EXECUTE。
  - `authenticated`：有 EXECUTE，但 function 內仍做 RBAC 檢查。

明確排除：

- 不建立資料表。
- 不新增正式資料、DEV seed 或 Auth users。
- 不修改 API / UI。
- 不修改已套用 migration。
- 不修改 RBAC tables、RLS policies、grants 或角色資料。
- 不開始 Task 1C-3。

API / UI / DB 影響：

- API：
  - 本輪未改 API route。
  - 補齊現有 API 已引用但 DEV schema 缺少的 RPC。
- UI：
  - 本輪未改 UI。
  - 預期正式 DEV push 後，使用者/角色指派搜尋流程不再因缺 RPC 而出現 500。
- DB：
  - 新增兩個相容 RPC，已正式套用 DEV。
- Production：
  - 未連線、未操作、未複製 Production business rows。

本機 API/schema audit：

```powershell
node scripts/audit-dev-api-schema-parity.js
```

修正：

- `scripts/audit-dev-api-schema-parity.js` 已支援 Supabase dump 中的 quoted schema object 格式，例如 `"public"."profiles"`。

結果：

- `missingInDev.tables = []`
- `missingInDev.rpcs = []`
- audit 結果寫入：
  - `docs/P1-J-API-SCHEMA-PARITY-AUDIT.json`

靜態測試：

```powershell
node --check scripts/audit-dev-api-schema-parity.js
node --check scripts/test-production-legacy-rbac-rpc-compatibility.js
node scripts/test-production-legacy-rbac-rpc-compatibility.js
```

結果：

- `node --check scripts/audit-dev-api-schema-parity.js`：通過。
- `node --check scripts/test-production-legacy-rbac-rpc-compatibility.js`：通過。
- `node scripts/test-production-legacy-rbac-rpc-compatibility.js`：通過。
- P1-J source / standard migration SHA-256 一致：
  - `E3144AA7784033EC647E5AE2B427046B558722D35B736181392A7272231322C9`

Guard / migration list / dry-run：

```powershell
node scripts/verify-dev-supabase-environment.js
node scripts/verify-dev-supabase-cli-environment.js
npx supabase migration list
npx supabase db push --dry-run
```

結果：

- App DEV Guard：passed，Project Ref `mjpd...mtqr`。
- CLI DEV Guard：passed，Project Ref `mjpd...mtqr`。
- Production 候選 `odvksgucvfoaqrumpran` 未命中。
- `npx supabase migration list`：
  - 12 筆既有 migrations local / remote aligned。
  - `20260724042430` 是唯一 local-only migration。
- `npx supabase db push --dry-run`：
  - 通過。
  - 只列 `20260724042430_production_legacy_rbac_rpc_compatibility.sql`。
  - 未列 baseline、P1-C 到 P1-H、test SQL、rollback 或 seed。
- `npx supabase db push`：
  - 成功套用 `20260724042430_production_legacy_rbac_rpc_compatibility.sql`。
  - 無 PostgreSQL error。
- Push 後 `npx supabase migration list`：
  - 曾因 CLI temp role / `SUPABASE_DB_PASSWORD` authentication failure 失敗。
  - 已停止重試，避免 temporary auth failure 擴大。
  - 改用 `npx supabase db query --linked "select version from supabase_migrations.schema_migrations order by version;"` 做唯讀確認。
  - 遠端 migration history 回傳 13 筆版本，包含 `20260724042430`。

Test SQL：

```powershell
npx supabase db query --linked --file supabase/test_production_legacy_rbac_rpc_compatibility.sql
```

結果全部 PASS：

- `functions_exist`：PASS，2 / 2。
- `security_definer`：PASS，2 / 2。
- `search_path_public_pg_temp`：PASS，2 / 2。
- `authenticated_execute_grants`：PASS，2 / 2。
- `anon_no_execute_grants`：PASS，0。
- `public_no_execute_grants`：PASS，0。
- `check_user_permission_uses_has_permission`：PASS，1 / 1。
- `get_all_employees_for_rbac_has_rbac_guard`：PASS，1 / 1。

尚未完成事項：

- 尚未複驗 RBAC 使用者搜尋 / 角色指派 UI。

### P1-J 後續補強：RBAC User Search API Guard

完成狀態：**程式碼已完成，靜態檢查、tsc、build 與未登入 smoke test 已通過；需要使用者輸入 DEV 密碼後執行 dynamic test。**

修改檔案：

- `app/api/users/search/route.ts`
- `scripts/test-rbac-formal-management-flow.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

新增檔案：

- `scripts/test-rbac-user-search-dev.js`
- `scripts/test-rbac-admin-routes-smoke.js`

API / UI / DB 影響：

- API：
  - `/api/users/search` 已新增 server-side permission guard。
  - 使用 `hasAnyPermission()` 檢查：
    - `USER_MANAGEMENT_NAV_PERMISSION_CODES`
    - `ROLE_LIST_PAGE_PERMISSION_CODES`
  - 未登入回 401。
  - 無權限回 403：`沒有搜尋使用者的權限`。
  - 有權限者才會呼叫 `get_all_employees_for_rbac()`。
- UI：
  - 本輪未修改 UI。
  - 角色編輯目前仍採批次輸入員編指派使用者。
  - 本機 smoke 已確認 `/admin/users` 與 `/admin/roles` 在未登入狀態不再回 500，會正常回登入頁。
- DB：
  - 本輪未修改 DB。
  - 未新增 migration，未執行 db push。

測試結果：

```powershell
node --check scripts/test-rbac-user-search-dev.js
node --check scripts/test-rbac-user-permissions-view-dev.js
node --check scripts/test-rbac-admin-routes-smoke.js
node scripts/test-rbac-formal-management-flow.js
node scripts/test-rbac-admin-routes-smoke.js
npx tsc --noEmit --pretty false
npm run build
```

結果：

- `node --check scripts/test-rbac-user-search-dev.js`：通過。
- `node --check scripts/test-rbac-user-permissions-view-dev.js`：通過。
- `node --check scripts/test-rbac-admin-routes-smoke.js`：通過。
- `node scripts/test-rbac-formal-management-flow.js`：通過，已包含 `/api/users/search` API-level guard 靜態檢查。
- `node scripts/test-rbac-admin-routes-smoke.js`：通過。
  - `/admin/users`：未登入回登入頁，沒有 500。
  - `/admin/roles`：未登入回登入頁，沒有 500。
  - `/api/users/search?q=dev-ga`：未登入回 401。
- `/api/users/search?q=dev-ga` 未登入 smoke test：401，`{"error":"未登入"}`。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過；仍有既有 `DYNAMIC_SERVER_USAGE` 訊息，非 build failure。

尚未完成事項：

- 尚未執行 `node scripts/test-rbac-user-search-dev.js`，因需要使用者在 Terminal 隱藏輸入 DEV 密碼。
- 尚未人工複驗角色權限管理 UI 的使用者搜尋 / 員編指派流程。

下一個最小任務：

**執行 RBAC user search dynamic test 與 UI 複驗。**

建議順序：

1. 確認 dev server 在 `localhost:3002` ready。
2. 執行 `node scripts/test-rbac-user-search-dev.js`。
3. 由使用者在 Terminal 隱藏輸入 `dev-full-admin@example.test` 與 `dev-no-ga@example.test` 密碼。
4. 預期：
   - unauthenticated search：401。
   - no_access search：403。
   - full admin search：200，包含 `dev-ga-access@example.test` 與 `dev-ga-manage@example.test`。
5. 再人工登入 `dev-full-admin@example.test`，複驗角色權限管理使用者指派流程。
6. 若再次出現角色/使用者管理頁 500，先重新跑 `node scripts/test-rbac-admin-routes-smoke.js` 判斷是否為 dev server 暫態編譯問題，再看 terminal stack。

禁止事項：

- 不得把 P1-J test SQL、rollback 或 seed 放進 migrations。
- 不得使用 legacy profile display fields 作為新功能授權依據。
- 不得授權 `anon` 執行這兩個 RPC。
- 不得複製 Production data。
- 不得開始 Task 1C-3。

### P1-J 後續補強：RBAC Role Management UI Permission Gating

完成狀態：**本機實作完成，靜態檢查、route smoke、tsc 與 build 通過；仍需 `dev-full-admin@example.test` 人工 UI 複驗。**

背景：

- 使用者回報 DEV 角色權限管理雖然能看到許多角色，但不清楚如何進入查看權限、編輯、刪除，且操作方式與正式區體感落差大。
- API 層已具備 server-side RBAC guard；本輪聚焦 UI 操作顯示與權限能力對齊，避免無權限操作仍出現在畫面上造成誤判。

修改檔案：

- `lib/permissions/rbac-management.ts`
- `app/admin/roles/page.tsx`
- `app/admin/roles/RoleListClient.tsx`
- `app/admin/roles/[id]/page.tsx`
- `app/admin/roles/[id]/RoleEditClient.tsx`
- `scripts/test-rbac-formal-management-flow.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

API / UI / DB 影響：

- API：
  - 未修改 role API route。
  - 既有 `/api/roles`、`/api/roles/[id]`、`/api/roles/[id]/permissions`、`/api/roles/[id]/users`、`/api/roles/[id]/users/[userId]` 後端 RBAC guard 保留。
- UI：
  - `RolesPage` 會傳入 `canCreate`、`canEdit`、`canDelete`。
  - `RoleListClient`：
    - 有 `role.role.edit` 時連結顯示「編輯」，否則顯示「查看」。
    - `role.role.edit` 控制停用 / 啟用按鈕。
    - `role.role.delete` 控制刪除按鈕。
  - `RoleEditPage` 會傳入：
    - `canViewPermissions`
    - `canAssignPermissions`
    - `canViewUsers`
    - `canAssignUsers`
    - `canRevokeUsers`
  - `RoleEditClient`：
    - 缺 `role.permission.view` 時顯示明確缺權限提示，不呼叫權限清單 API。
    - 缺 `role.user_role.view` 時顯示明確缺權限提示，不呼叫角色使用者 API。
    - `role.user_role.assign` 控制「新增使用者」。
    - `role.user_role.revoke` 控制「移除」。
  - `ROLE_EDIT_PAGE_PERMISSION_CODES` 已加入 `role.role.view`，讓只有查看角色權限的使用者也能進入詳情頁以查看允許看到的內容。
- DB：
  - 未修改 DB。
  - 未新增 migration。
  - 未執行遠端操作。

測試結果：

```powershell
node --check scripts/test-rbac-formal-management-flow.js
node scripts/test-rbac-formal-management-flow.js
node --check scripts/test-rbac-admin-routes-smoke.js
node scripts/test-rbac-admin-routes-smoke.js
npx tsc --noEmit --pretty false
npm run build
```

結果：

- `node --check scripts/test-rbac-formal-management-flow.js`：通過。
- `node scripts/test-rbac-formal-management-flow.js`：通過，已加入角色列表/詳情 UI 權限呈現靜態檢查。
- `node --check scripts/test-rbac-admin-routes-smoke.js`：通過。
- `node scripts/test-rbac-admin-routes-smoke.js`：通過。
  - `/admin/users` 未登入：正常回登入頁，沒有 500。
  - `/admin/roles` 未登入：正常回登入頁，沒有 500。
  - `/api/users/search?q=dev-ga` 未登入：401。
  - `/api/admin/users/[id]/rbac` 未登入：401。
  - `/api/roles` GET / POST 未登入：401。
  - `/api/roles/[id]` GET / PATCH / DELETE 未登入：401。
  - `/api/roles/[id]/permissions` GET / POST 未登入：401。
  - `/api/roles/[id]/users` GET / POST 未登入：401。
  - `/api/roles/[id]/users/[userId]` DELETE 未登入：401。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過；仍有既有 `DYNAMIC_SERVER_USAGE` 訊息，非 build failure。

注意事項：

- `npm run build` 會重寫 `.next` 輸出；若同時有 `next dev` 在 `3002` 運行，build 後需重啟 dev server。
- 若未重啟，dev route 可能暫時出現 `Cannot find module './xxxx.js'` 的 chunk missing 500，這不是 RBAC API 邏輯錯誤。
- `scripts/test-rbac-admin-routes-smoke.js` 內建短暫 5xx retry，但若仍失敗，先重啟 `next dev -p 3002` 再判斷程式錯誤。

尚未完成事項：

- 尚未執行需要密碼的 dynamic scripts：
  - `node scripts/test-rbac-user-search-dev.js`
  - `node scripts/test-rbac-user-permissions-view-dev.js`
- 尚未由使用者登入 `dev-full-admin@example.test` 人工複驗：
  - 角色列表操作顯示。
  - 角色詳情權限分頁。
  - 角色使用者分頁。
  - 以員編批次指派角色。
  - 移除角色指派。
  - no_access 無入口 / API 403。

下一個最小任務：

**執行 RBAC user search / user permissions dynamic test 與角色管理 UI 人工複驗。**

### P1-J 後續補強：RBAC User Permissions Dynamic Test 不使用 Service Role

完成狀態：**本機腳本安全化完成，語法檢查、靜態檢查、smoke 與 tsc 通過；仍需使用者在 Terminal 隱藏輸入 DEV 密碼後實跑 dynamic test。**

背景：

- `scripts/test-rbac-user-permissions-view-dev.js` 原本使用 service role 先查 `profiles` 取得四個 DEV 目標帳號 id。
- 為了讓驗收更貼近正式操作與 RBAC 安全邊界，本輪改成用 `dev-full-admin` 的 authenticated session 呼叫正式 API 找人。
- 這避免 service role 參與 dynamic 驗收，也能同時驗證 `/api/users/search` 與 `get_all_employees_for_rbac()` 的實際流程。

修改檔案：

- `scripts/test-rbac-user-permissions-view-dev.js`
- `scripts/test-rbac-formal-management-flow.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

API / UI / DB 影響：

- API：
  - 未修改 API route。
  - dynamic script 現在先用 authenticated full admin cookie 呼叫 `/api/users/search?q=<email>` 找四個 DEV 目標帳號。
  - 再呼叫 `/api/admin/users/[id]/rbac` 驗證角色、effective permissions、permission source roles 與 store scope。
- UI：
  - 未修改 UI。
- DB：
  - 未修改 DB。
  - 未新增 migration。
  - 未執行遠端操作。
- 測試安全：
  - `scripts/test-rbac-user-permissions-view-dev.js` 不再讀取 `SUPABASE_SERVICE_ROLE_KEY`。
  - 不使用 service role 或 admin client。
  - 密碼仍只能在 Terminal 隱藏輸入。
  - 不輸出 JWT、refresh token、cookie、key 或 password。

測試結果：

```powershell
node --check scripts/test-rbac-user-permissions-view-dev.js
node --check scripts/test-rbac-formal-management-flow.js
node scripts/test-rbac-formal-management-flow.js
node --check scripts/test-rbac-admin-routes-smoke.js
node scripts/test-rbac-admin-routes-smoke.js
npx tsc --noEmit --pretty false
npm run build
git diff --check
```

結果：

- `node --check scripts/test-rbac-user-permissions-view-dev.js`：通過。
- `node --check scripts/test-rbac-formal-management-flow.js`：通過。
- `node scripts/test-rbac-formal-management-flow.js`：通過，已新增「user permissions dynamic test 不得使用 service role」靜態檢查。
- `node --check scripts/test-rbac-admin-routes-smoke.js`：通過。
- `node scripts/test-rbac-admin-routes-smoke.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。

尚未完成事項：

- 尚未實跑 `node scripts/test-rbac-user-permissions-view-dev.js`，因需要使用者輸入：
  - `dev-full-admin@example.test` 密碼
  - `dev-no-ga@example.test` 密碼
- 尚未人工複驗 `/admin/users` 與 `/admin/roles` 的完整互動。

下一個最小任務：

**由使用者在 Terminal 隱藏輸入 DEV 密碼，執行 RBAC user search / user permissions dynamic scripts。**

### P1-J 後續補強：RBAC User Management Read-only Detail UI Static Guard

完成狀態：**本機靜態守門完成，語法檢查、RBAC formal flow static test、admin route smoke 與 tsc 通過；仍需使用者在 UI 人工複驗。**

背景：

- 使用者先前回報 DEV 使用者管理看不到四個 DEV 驗收帳號的角色、權限與 scope，不清楚「誰扮演了這個角色」。
- 程式碼中 `components/admin/UserManagementTable.tsx` 已實作使用者 RBAC read-only detail modal，但靜態測試尚未把這個 UI contract 固定住。
- 本輪補上靜態守門，避免後續改版退化成只能看到使用者列表，卻看不到 active roles、effective permission codes、source roles 與 store scope。

修改檔案：

- `scripts/test-rbac-formal-management-flow.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

API / UI / DB 影響：

- API：
  - 未修改 API route。
  - 繼續使用既有 `/api/admin/users/[id]/rbac`。
  - `/api/admin/users/[id]/rbac` 仍需 server-side RBAC guard，不得以前端隱藏代替。
- UI：
  - 未修改 `UserManagementTable` 業務邏輯。
  - 靜態守門確認使用者列表顯示：
    - `RBAC角色`
    - `有效權限`
    - `門市範圍`
  - 靜態守門確認使用者列提供「查看角色與權限」操作。
  - 靜態守門確認 detail modal 顯示：
    - 基本資料
    - 已指派角色
    - 有效權限代碼
    - 權限來源角色
    - store manager scope
    - `舊 profiles.role` 與 `Admin compatibility` 的相容資訊，且與正式 RBAC 來源分開標示。
- DB：
  - 未修改 DB。
  - 未新增 migration。
  - 未執行遠端操作。

測試結果：

```powershell
node --check scripts/test-rbac-formal-management-flow.js
node --check scripts/test-rbac-user-permissions-view-dev.js
node --check scripts/test-rbac-admin-routes-smoke.js
node scripts/test-rbac-formal-management-flow.js
node scripts/test-rbac-admin-routes-smoke.js
npx tsc --noEmit --pretty false
```

結果：

- `node --check scripts/test-rbac-formal-management-flow.js`：通過。
- `node --check scripts/test-rbac-user-permissions-view-dev.js`：通過。
- `node --check scripts/test-rbac-admin-routes-smoke.js`：通過。
- `node scripts/test-rbac-formal-management-flow.js`：通過，已新增使用者 RBAC read-only detail UI 靜態檢查。
- `node scripts/test-rbac-admin-routes-smoke.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。

尚未完成事項：

- 尚未由使用者在 Terminal 隱藏輸入 DEV 密碼執行：
  - `node scripts/test-rbac-user-search-dev.js`
  - `node scripts/test-rbac-user-permissions-view-dev.js`
- 尚未人工登入 `dev-full-admin@example.test` 複驗：
  - 使用者管理列表可看到四個 DEV 驗收帳號。
  - 每個帳號可開啟「查看角色與權限」。
  - detail modal 可看到 active roles、effective permission codes、source roles 與 store scope。
  - 角色權限管理詳情頁可查看允許的權限與使用者分頁。

下一個最小任務：

**由使用者在 Terminal 隱藏輸入 DEV 密碼，執行 RBAC user search / user permissions dynamic scripts，並以 `dev-full-admin@example.test` 人工複驗使用者與角色管理 UI。**

### P1-J 後續補強：DEV Home / User Management SSR Link Hook Fix

完成狀態：**完成。首頁未登入、使用者管理未登入、角色管理未登入 smoke test 通過；tsc 通過。**

背景：

- 使用者先前遇到 `Cannot read properties of null (reading 'useContext')`，點選角色權限管理時可能出現 Next.js server error。
- 本輪重啟 `localhost:3002` 後，未登入請求 `/` 可重現 500。
- dev server terminal 顯示真正錯誤點是 `next/link` 的 `LinkComponent` 在 server render 時觸發 invalid hook call。
- `admin` smoke 先前只驗證 `/admin/users` / `/admin/roles` 未登入 redirect 不會 500，未覆蓋首頁 landing。

修改檔案：

- `app/page.tsx`
- `app/admin/users/page.tsx`
- `scripts/test-rbac-admin-routes-smoke.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

API / UI / DB 影響：

- API：
  - 未修改 API。
- UI：
  - `app/page.tsx` 是 server component；其中的首頁導覽連結改用原生 `<a>`。
  - `app/admin/users/page.tsx` 是 server component；頁首與權限不足區塊連結改用原生 `<a>`。
  - Client components 內既有 `next/link` 保留。
  - 連結目的地未改變：
    - `/login`
    - `/register`
    - `/dashboard`
    - `/admin/roles`
- DB：
  - 未修改 DB。
  - 未新增 migration。
  - 未執行遠端操作。

測試結果：

```powershell
node --check scripts/test-rbac-admin-routes-smoke.js
node scripts/test-rbac-admin-routes-smoke.js
node scripts/test-rbac-formal-management-flow.js
npx tsc --noEmit --pretty false
npm run build
```

結果：

- `node --check scripts/test-rbac-admin-routes-smoke.js`：通過。
- `node scripts/test-rbac-admin-routes-smoke.js`：通過。
  - `/` 未登入：200，不再出現 hook null error。
  - `/admin/users` 未登入：307 redirect，沒有 500。
  - `/admin/roles` 未登入：307 redirect，沒有 500。
  - `/api/users/search` 未登入：401。
  - `/api/admin/users/[id]/rbac` 未登入：401。
  - `/api/roles` 管理 API 未登入：401。
- `node scripts/test-rbac-formal-management-flow.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過；仍有既有 `DYNAMIC_SERVER_USAGE` 訊息，非 build failure。
- Build 後已重新啟動 dev server 到 `localhost:3002`。
- Build 後 `node scripts/test-rbac-admin-routes-smoke.js` 再次通過，首頁 `/` 回 200。

尚未完成事項：

- 仍需使用者登入 `dev-full-admin@example.test` 人工複驗角色權限管理與使用者管理完整互動。
- 仍需執行需要 Terminal 隱藏輸入密碼的 dynamic scripts。

下一個最小任務：

**由使用者在 Terminal 隱藏輸入 DEV 密碼，執行 RBAC user search / user permissions dynamic scripts，並以 `dev-full-admin@example.test` 人工複驗使用者與角色管理 UI。**

### P1-J 後續補強：RBAC Dynamic Scripts Preflight

完成狀態：**完成。兩支 RBAC dynamic scripts 語法檢查通過，未登入 smoke 通過，dev server 目前在 `localhost:3002` 監聽。**

背景：

- 下一步需要實跑：
  - `node scripts/test-rbac-user-search-dev.js`
  - `node scripts/test-rbac-user-permissions-view-dev.js`
- 兩支腳本都需要使用者在 Terminal 隱藏輸入 DEV 測試帳號密碼。
- Codex 不得要求使用者把密碼貼到對話，也不得把 password / JWT / refresh token / cookie / key 寫入檔案或 console。

修改檔案：

- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

API / UI / DB 影響：

- API：未修改。
- UI：未修改。
- DB：未修改、未新增 migration、未執行遠端操作。

檢查結果：

```powershell
node --check scripts/test-rbac-user-search-dev.js
node --check scripts/test-rbac-user-permissions-view-dev.js
node scripts/test-rbac-admin-routes-smoke.js
Get-NetTCPConnection -LocalPort 3002 -ErrorAction SilentlyContinue
```

結果：

- `node --check scripts/test-rbac-user-search-dev.js`：通過。
- `node --check scripts/test-rbac-user-permissions-view-dev.js`：通過。
- `node scripts/test-rbac-admin-routes-smoke.js`：通過。
  - `/` 未登入：200。
  - `/admin/users` 未登入：307 redirect，沒有 500。
  - `/admin/roles` 未登入：307 redirect，沒有 500。
  - `/api/users/search` 未登入：401。
  - `/api/admin/users/[id]/rbac` 未登入：401。
  - `/api/roles` 管理 API 未登入：401。
- `localhost:3002`：有 node process 監聽。

腳本安全性：

- `scripts/test-rbac-user-search-dev.js`：
  - 使用 hidden prompt 讀取 `dev-full-admin@example.test` 與 `dev-no-ga@example.test` 密碼。
  - 以 authenticated cookie 呼叫 `/api/users/search`。
  - 已有敏感欄位遮罩，不輸出 password、access token、refresh token、cookie 或 key。
- `scripts/test-rbac-user-permissions-view-dev.js`：
  - 使用 hidden prompt 讀取 `dev-full-admin@example.test` 與 `dev-no-ga@example.test` 密碼。
  - 不使用 service role。
  - 以 full admin authenticated API 查找 DEV users，並驗證 `/api/admin/users/[id]/rbac`。
  - 已有敏感欄位遮罩，不輸出 password、access token、refresh token、cookie 或 key。
- `scripts/test-rbac-navbar-permissions-dev.js`：
  - 語法檢查通過。
  - 這是較重的 DEV RBAC navbar/page/API 驗收腳本，會使用 service role 建立或更新 DEV-only Auth users、temporary roles、role_permissions 與 user_roles。
  - 不得把它當成一般 read-only dynamic test 執行；只有在使用者明確批准「建立/更新 DEV RBAC temporary users and roles」時才可執行。
  - 目前下一個最小任務仍以 `test-rbac-user-search-dev.js` 與 `test-rbac-user-permissions-view-dev.js` 為主。

尚未完成事項：

- 尚未實跑兩支 dynamic scripts，因需要使用者在本機 Terminal 隱藏輸入 DEV 密碼。
- 尚未人工複驗：
  - 使用者管理列表可看到四個 DEV 驗收帳號。
  - 使用者管理 detail modal 可看到 active roles、effective permission codes、source roles 與 store scope。
  - 角色權限管理詳情頁可查看允許的權限與使用者分頁。
  - no_access 仍無管理入口。

下一個最小任務：

**由使用者在 Terminal 隱藏輸入 DEV 密碼，執行 RBAC user search / user permissions dynamic scripts，並以 `dev-full-admin@example.test` 人工複驗使用者與角色管理 UI。**

### P1-J 後續補強：RBAC Preflight Quality Gate Re-run

完成狀態：**完成。RBAC 靜態守門、admin route smoke、production build 與單獨 tsc 均通過。**

背景：

- 使用者持續要求「繼續」，但真正的 RBAC dynamic scripts 仍需使用者在本機 Terminal 隱藏輸入 DEV 密碼。
- 本輪先補強可由代理自行執行的品質閘門，確認目前工作樹沒有因上一輪修正造成編譯或基本路由退化。

修改檔案：

- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

API / UI / DB 影響：

- API：未修改。
- UI：未修改。
- DB：未修改、未新增 migration、未執行遠端操作。

執行命令：

```powershell
node scripts/test-rbac-formal-management-flow.js
node scripts/test-rbac-admin-routes-smoke.js
node --check scripts/test-rbac-user-search-dev.js
node --check scripts/test-rbac-user-permissions-view-dev.js
npm run build
npx tsc --noEmit --pretty false
```

結果：

- `node scripts/test-rbac-formal-management-flow.js`：通過。
- `node scripts/test-rbac-admin-routes-smoke.js`：通過。
- `node --check scripts/test-rbac-user-search-dev.js`：通過。
- `node --check scripts/test-rbac-user-permissions-view-dev.js`：通過。
- `node --check scripts/test-rbac-navbar-permissions-dev.js`：通過；但該腳本會寫入 DEV temporary RBAC users/roles，未執行。
- `npm run build`：通過；仍有既有 `DYNAMIC_SERVER_USAGE` 訊息，非 build failure。
- `npx tsc --noEmit --pretty false`：單獨重跑通過。

注意事項：

- 本輪一開始曾將 `npx tsc --noEmit --pretty false` 與 `npm run build` 並行執行，`tsc` 暫時出現 TS6053，原因是 `.next/types` 正在被 build 重建。
- `npm run build` 完成後單獨重跑 `npx tsc --noEmit --pretty false` 已通過；後續驗收應避免讓 `tsc` 與 `next build` 並行。

尚未完成事項：

- 尚未實跑：
  - `node scripts/test-rbac-user-search-dev.js`
  - `node scripts/test-rbac-user-permissions-view-dev.js`
- 尚未人工複驗：
  - `dev-full-admin@example.test` 使用者管理與角色權限管理完整互動。
  - no_access 無管理入口。

下一個最小任務：

**由使用者在 Terminal 隱藏輸入 DEV 密碼，執行 RBAC user search / user permissions dynamic scripts，並以 `dev-full-admin@example.test` 人工複驗使用者與角色管理 UI。**

### P1-J 後續補強：RBAC Safe Preflight Wrapper

完成狀態：**完成。新增不需密碼、不使用 service role、不寫 DEV 資料的 RBAC safe preflight。**

背景：

- 前面多輪都需要先跑一組固定的 RBAC 靜態與未登入 smoke 檢查。
- `scripts/test-rbac-navbar-permissions-dev.js` 雖然語法通過，但會使用 service role 建立或更新 DEV-only users / roles / role_permissions / user_roles，不能被誤包進一般一鍵檢查。
- 本輪新增一個明確安全的 wrapper，只執行 read-only/static/smoke 類檢查，並在輸出中提醒下一步仍需使用者於 Terminal 隱藏輸入密碼。
- 後續補強：wrapper 現在會先確認 dev server reachable 且不是 500，並檢查自身 command list，避免把會寫 DEV 資料或需要密碼的 dynamic scripts 誤加入 safe preflight。`test-rbac-user-management-dev.js` 只允許以 `--check` 語法檢查形式出現在 safe preflight，不允許完整實跑被包入 safe preflight。

修改檔案：

- `scripts/test-rbac-safe-preflight.js`
- `package.json`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

API / UI / DB 影響：

- API：未修改。
- UI：未修改。
- DB：未修改、未新增 migration、未執行遠端操作。
- NPM：
  - 新增 `test:rbac-safe-preflight` script。

新增指令：

```powershell
npm run test:rbac-safe-preflight
```

此指令只執行：

- `GET http://localhost:3002` ready check，確認 dev server reachable 且 response status 小於 500。
- `node --check scripts/test-rbac-user-search-dev.js`
- `node --check scripts/test-rbac-user-permissions-view-dev.js`
- `node scripts/test-rbac-formal-management-flow.js`
- `node scripts/test-rbac-admin-routes-smoke.js`

此指令明確不執行：

- `node scripts/test-rbac-user-search-dev.js`
- `node scripts/test-rbac-user-permissions-view-dev.js`
- `node scripts/test-rbac-navbar-permissions-dev.js`
- 任何 DB migration / push / repair / reset / rollback
- 任何 service role 寫入測試

測試結果：

```powershell
node --check scripts/test-rbac-safe-preflight.js
npm run test:rbac-safe-preflight
npx tsc --noEmit --pretty false
```

結果：

- `node --check scripts/test-rbac-safe-preflight.js`：通過。
- `npm run test:rbac-safe-preflight`：通過，dev server ready check 回 200。
- safe preflight 防呆清單已包含：
  - `scripts/test-rbac-navbar-permissions-dev.js`
  - `scripts/test-rbac-user-search-dev.js`
  - `scripts/test-rbac-user-permissions-view-dev.js`
  - `scripts/test-rbac-user-management-dev.js`
  - `supabase`
- `npx tsc --noEmit --pretty false`：通過。

尚未完成事項：

- 尚未實跑需要密碼的 authenticated dynamic scripts：
  - `node scripts/test-rbac-user-search-dev.js`
  - `node scripts/test-rbac-user-permissions-view-dev.js`
- 尚未人工複驗：
  - `dev-full-admin@example.test` 使用者管理與角色權限管理完整互動。
  - no_access 無管理入口。

下一個最小任務：

**先執行 `npm run test:rbac-safe-preflight`，再由使用者在 Terminal 隱藏輸入 DEV 密碼執行兩支 RBAC dynamic scripts，並人工複驗使用者與角色管理 UI。**

### P1-J 後續補強：RBAC User Search Dynamic Coverage

完成狀態：**完成。`test-rbac-user-search-dev.js` 已固定四個人工 DEV 驗收帳號都必須可被 full admin 搜尋到。**

背景：

- 使用者先前明確要求使用者管理應出現四個 DEV 驗收帳號：
  - `dev-ga-access@example.test`
  - `dev-ga-manage@example.test`
  - `dev-ga-view@example.test`
  - `dev-no-ga@example.test`
- `scripts/test-rbac-user-permissions-view-dev.js` 已逐一搜尋四個帳號並驗證 RBAC detail。
- `scripts/test-rbac-user-search-dev.js` 原本只在 `q=dev-ga` 案例中硬性確認 `dev-ga-access` 與 `dev-ga-manage`，對 `dev-ga-view` 與 `dev-no-ga` 的搜尋覆蓋不完整。

修改檔案：

- `scripts/test-rbac-user-search-dev.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

API / UI / DB 影響：

- API：未修改。
- UI：未修改。
- DB：未修改、未新增 migration、未執行遠端操作。
- 測試：
  - 新增 `TARGET_USERS`。
  - `full admin can search DEV users` 現在也要求 `dev-ga-view@example.test`。
  - 新增 `full admin can search all manual DEV verification accounts`，逐一用完整 email 搜尋四個人工驗收帳號。
  - 仍檢查 response 不含敏感 auth 欄位。

測試結果：

```powershell
node --check scripts/test-rbac-user-search-dev.js
npm run test:rbac-safe-preflight
npx tsc --noEmit --pretty false
```

結果：

- `node --check scripts/test-rbac-user-search-dev.js`：通過。
- `npm run test:rbac-safe-preflight`：通過。
- `npx tsc --noEmit --pretty false`：通過。

尚未完成事項：

- 尚未實跑 `node scripts/test-rbac-user-search-dev.js`，因需要使用者在 Terminal 隱藏輸入 DEV 密碼。
- 尚未實跑 `node scripts/test-rbac-user-permissions-view-dev.js`。
- 尚未人工複驗使用者管理 UI 是否顯示四個帳號與其 RBAC detail。

下一個最小任務：

**由使用者在 Terminal 隱藏輸入 DEV 密碼，執行 `node scripts/test-rbac-user-search-dev.js` 與 `node scripts/test-rbac-user-permissions-view-dev.js`，再人工複驗使用者與角色管理 UI。**

### P1-J 後續補強：RBAC User Management Combined Dynamic Wrapper

完成狀態：**完成。新增合併式 authenticated dynamic 驗收腳本，讓使用者只需輸入一次 DEV 密碼即可驗證 user search 與 user RBAC detail。**

背景：

- 原本下一步要分別執行：
  - `node scripts/test-rbac-user-search-dev.js`
  - `node scripts/test-rbac-user-permissions-view-dev.js`
- 兩支都需要使用者在 Terminal hidden prompt 輸入 `dev-full-admin@example.test` 與 `dev-no-ga@example.test` 密碼。
- 為降低人工驗收摩擦，本輪新增合併版，但保留原本兩支作為 fallback / 分段排查用。

修改檔案：

- `scripts/test-rbac-user-management-dev.js`
- `scripts/test-rbac-safe-preflight.js`
- `package.json`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

API / UI / DB 影響：

- API：未修改。
- UI：未修改。
- DB：未修改、未新增 migration、未執行遠端操作。
- NPM：
  - 新增 `test:rbac-user-management-dev` script。
  - `test:rbac-safe-preflight` 已加入合併版 script 的 syntax check。

新增指令：

```powershell
npm run test:rbac-user-management-dev
```

此指令會：

- 執行 App DEV Guard 與 CLI DEV Guard。
- 使用 hidden prompt 讀取：
  - `dev-full-admin@example.test`
  - `dev-no-ga@example.test`
- 使用 authenticated Supabase session，不使用 service role。
- 驗證：
  - 未登入 `/api/users/search` 回 401。
  - `dev-no-ga` 搜尋使用者回 403。
  - `dev-full-admin` 可搜尋四個人工 DEV 驗收帳號。
  - 短查詢回空陣列。
  - `dev-full-admin` 可查四個帳號的 `/api/admin/users/[id]/rbac` detail。
  - `dev-no-ga` 不可查其他使用者 RBAC detail。
  - effective permission codes、source roles、store scopes、DEV test account indicator 與 admin compatibility 標示符合預期。
- 不輸出 password、JWT、refresh token、cookie 或 Supabase keys。

測試結果：

```powershell
node --check scripts/test-rbac-user-management-dev.js
npm run test:rbac-safe-preflight
npx tsc --noEmit --pretty false
```

結果：

- `node --check scripts/test-rbac-user-management-dev.js`：通過。
- `npm run test:rbac-safe-preflight`：通過，且已包含合併版 script syntax check。
- `npx tsc --noEmit --pretty false`：通過。

尚未完成事項：

- 尚未實跑 `npm run test:rbac-user-management-dev`，因需要使用者在 Terminal 隱藏輸入 DEV 密碼。
- 尚未人工複驗使用者與角色管理 UI。

下一個最小任務：

**先執行 `npm run test:rbac-safe-preflight`，再執行 `npm run test:rbac-user-management-dev`，最後以 `dev-full-admin@example.test` 人工複驗使用者與角色管理 UI。**

### P1-J 後續補強：RBAC Management Verification Checklist

完成狀態：**完成。新增 RBAC 動態驗收與使用者/角色管理 UI 人工複驗操作清單。**

更新時間：2026-07-24

背景：

- 真正的 RBAC dynamic test 需要使用者在本機 Terminal hidden prompt 輸入 DEV 密碼，代理不能代跑或要求貼密碼。
- 為避免下一位代理或人工驗收時漏掉搜尋、RBAC detail、source roles、store scope 與 no_access 行為，本輪新增獨立驗收清單。

新增檔案：

- `docs/RBAC-MANAGEMENT-VERIFY.md`

API / UI / DB 影響：

- API：未修改。
- UI：未修改。
- DB：未修改、未新增 migration、未執行遠端操作。

文件內容：

- 執行前條件：dev server ready、DEV Guard 指向 `mjpd...mtqr`、不得命中 Production 候選。
- 安全預檢：`npm run test:rbac-safe-preflight`。
- Authenticated dynamic test：`npm run test:rbac-user-management-dev`。
- 四個人工 DEV 帳號：
  - `dev-ga-access@example.test`
  - `dev-ga-manage@example.test`
  - `dev-ga-view@example.test`
  - `dev-no-ga@example.test`
- 使用者管理 UI 人工複驗表格。
- 角色權限管理 UI 人工複驗表格。
- no_access 驗證表格。
- 禁止事項：不得誤跑 service-role navbar script、不得 DB migration / repair / reset / rollback、不得開始 Task 1C-3。

尚未完成事項：

- 尚未實跑 `npm run test:rbac-user-management-dev`。
- 尚未由使用者人工複驗 UI。

下一個最小任務：

**依 `docs/RBAC-MANAGEMENT-VERIFY.md` 執行 RBAC dynamic test 與 UI 人工複驗。**

### P1-J 後續補強：RBAC Verification Checklist Static Guard

完成狀態：**完成。RBAC formal static guard 已納入 `docs/RBAC-MANAGEMENT-VERIFY.md` 的內容檢查。**

更新時間：2026-07-24

背景：

- 已建立 `docs/RBAC-MANAGEMENT-VERIFY.md` 後，需要防止後續修改不小心刪掉關鍵驗收命令、四個人工 DEV 帳號或禁止事項。
- 本輪只修改本機靜態測試與文件，不改 API、UI、DB 或 migration。

修改檔案：

- `scripts/test-rbac-formal-management-flow.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

API / UI / DB 影響：

- API：未修改。
- UI：未修改。
- DB：未修改、未新增 migration、未執行遠端操作。
- 測試：
  - `scripts/test-rbac-formal-management-flow.js` 現在會讀取 `docs/RBAC-MANAGEMENT-VERIFY.md`。
  - 檢查文件包含：
    - `npm run test:rbac-safe-preflight`
    - `npm run test:rbac-user-management-dev`
    - 四個人工 DEV 驗收帳號
    - 使用者管理、角色權限管理、no_access 人工檢查
    - 禁止執行 service-role navbar 重型寫入腳本
    - 禁止 DB migration / push / repair / reset / rollback

測試結果：

```powershell
node --check scripts/test-rbac-formal-management-flow.js
node scripts/test-rbac-formal-management-flow.js
npx tsc --noEmit --pretty false
npm run test:rbac-safe-preflight
```

結果：

- `node --check scripts/test-rbac-formal-management-flow.js`：通過。
- `node scripts/test-rbac-formal-management-flow.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run test:rbac-safe-preflight`：通過。

尚未完成事項：

- 尚未實跑 `npm run test:rbac-user-management-dev`，因需要使用者在 Terminal 隱藏輸入 DEV 密碼。
- 尚未人工複驗使用者管理與角色權限管理 UI。
- 未開始 Task 1C-3。

下一個最小任務：

**依 `docs/RBAC-MANAGEMENT-VERIFY.md` 執行 `npm run test:rbac-user-management-dev` 與 UI 人工複驗。**

### P1-J 後續補強：RBAC Dynamic Test Non-sensitive Summary Output

完成狀態：**完成。`test-rbac-user-management-dev.js` 成功時會輸出四個 DEV 帳號的非敏感 RBAC 摘要。**

更新時間：2026-07-24

背景：

- 後續結案需要回報四個 DEV 帳號的實際 roles、effective permission codes 與 store scope。
- 原 dynamic script 只輸出 PASS，使用者跑完後仍需要手動整理權限資訊。
- 本輪讓腳本在所有 assertion 通過後輸出可直接貼回的 `RBAC user management verification summary`。

修改檔案：

- `scripts/test-rbac-user-management-dev.js`
- `scripts/test-rbac-formal-management-flow.js`
- `docs/RBAC-MANAGEMENT-VERIFY.md`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

API / UI / DB 影響：

- API：未修改。
- UI：未修改。
- DB：未修改、未新增 migration、未執行遠端操作。
- 測試：
  - dynamic script 成功時輸出 email、role code/name、effective permission codes、store code/name 與 legacy compatibility 標示。
  - 不輸出 user id、JWT、refresh token、cookie、password 或 Supabase keys。
  - formal static guard 已檢查此摘要輸出不能退化。

尚未完成事項：

- 尚未實跑 `npm run test:rbac-user-management-dev`，因需要使用者在 Terminal 隱藏輸入 DEV 密碼。
- 尚未人工複驗使用者管理與角色權限管理 UI。
- 未開始 Task 1C-3。

下一個最小任務：

**執行 `npm run test:rbac-user-management-dev`，貼回 PASS / FAIL 與 `RBAC user management verification summary`，再依 `docs/RBAC-MANAGEMENT-VERIFY.md` 做 UI 人工複驗。**

### P1-J 後續補強：RBAC Dynamic Test Info-only Mode

完成狀態：**完成。`test-rbac-user-management-dev.js` 已新增 `--help` / `--list-cases`，且 `package.json` 提供 `npm run test:rbac-user-management-cases` 短指令，可在不登入、不要求密碼、不打 API 的情況下查看測試範圍。**

更新時間：2026-07-24

背景：

- 真正 dynamic test 仍需要使用者在 Terminal hidden prompt 輸入 DEV 密碼。
- 為了讓使用者與下一位代理能先確認測試範圍，本輪加入資訊模式；它會在 guard、login、API test 之前返回。

修改檔案：

- `scripts/test-rbac-user-management-dev.js`
- `scripts/test-rbac-formal-management-flow.js`
- `package.json`
- `docs/RBAC-MANAGEMENT-VERIFY.md`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

API / UI / DB 影響：

- API：未修改。
- UI：未修改。
- DB：未修改、未新增 migration、未執行遠端操作。
- 測試：
  - 新增 `--help` 與 `--list-cases` 資訊模式。
  - 新增 `test:rbac-user-management-cases` npm script。
  - formal static guard 已檢查資訊模式存在且在 guard / login / API tests 前返回。
  - formal static guard 已檢查 `test:rbac-user-management-cases` npm script 存在。

可執行指令：

```powershell
npm run test:rbac-user-management-cases
```

此指令只列：

- 測試案例
- 四個人工 DEV 驗收帳號
- 安全注意事項

它不會要求密碼、不會登入、不會呼叫 API、不會連 DB。

尚未完成事項：

- 尚未實跑 `npm run test:rbac-user-management-dev`。
- 尚未人工複驗使用者管理與角色權限管理 UI。
- 未開始 Task 1C-3。

下一個最小任務：

**可先執行 `npm run test:rbac-user-management-cases` 確認範圍，再執行 `npm run test:rbac-user-management-dev` 完成 authenticated dynamic test。**

### P1-J 後續補強：Copilot RBAC Cases Script Rule

完成狀態：**完成。Copilot repository instructions 已同步 `test:rbac-user-management-cases` 使用規則。**

更新時間：2026-07-24

背景：

- 已新增 `npm run test:rbac-user-management-cases` 後，後續代理應先用它確認測試範圍，再要求使用者在 Terminal hidden prompt 輸入 DEV 密碼。
- 本輪只更新 repository-level instruction 與狀態文件，不修改 API、UI、DB 或 migration。

修改檔案：

- `.github/copilot-instructions.md`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

API / UI / DB 影響：

- API：未修改。
- UI：未修改。
- DB：未修改、未新增 migration、未執行遠端操作。

新增永久規則：

- 在要求使用者輸入 DEV 密碼前，可先執行 `npm run test:rbac-user-management-cases` 確認 RBAC dynamic test 範圍。
- `test:rbac-user-management-cases` 不得登入、不得呼叫 API、不得連 DB。

尚未完成事項：

- 尚未實跑 `npm run test:rbac-user-management-dev`。
- 尚未人工複驗使用者管理與角色權限管理 UI。
- 未開始 Task 1C-3。

下一個最小任務：

**先執行 `npm run test:rbac-local-ready`，再由使用者 hidden prompt 執行 `npm run test:rbac-user-management-dev`。**

### P1-J 後續補強：RBAC Local Ready NPM Script

完成狀態：**完成。新增 `npm run test:rbac-local-ready`，整合測試範圍清單與 safe preflight。**

更新時間：2026-07-24

背景：

- 下一輪 authenticated dynamic test 前，固定需要先確認測試案例與 safe preflight。
- 原本要分別跑 `npm run test:rbac-user-management-cases` 與 `npm run test:rbac-safe-preflight`。
- 本輪新增一個無密碼、不登入、不碰 DB 的整合指令，降低人工操作與交接成本。

修改檔案：

- `package.json`
- `scripts/test-rbac-formal-management-flow.js`
- `.github/copilot-instructions.md`
- `docs/RBAC-MANAGEMENT-VERIFY.md`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

API / UI / DB 影響：

- API：未修改。
- UI：未修改。
- DB：未修改、未新增 migration、未執行遠端操作。
- NPM：
  - 新增 `test:rbac-local-ready` script。
- 測試：
  - formal static guard 已檢查 `test:rbac-local-ready` npm script 存在。

新增指令：

```powershell
npm run test:rbac-local-ready
```

此指令會執行：

- `npm run test:rbac-user-management-cases`
- `npm run test:rbac-safe-preflight`

此指令不會：

- 要求密碼
- 登入
- 呼叫 authenticated API
- 連 DB
- 執行 Supabase CLI

尚未完成事項：

- 尚未實跑 `npm run test:rbac-user-management-dev`。
- 尚未人工複驗使用者管理與角色權限管理 UI。
- 未開始 Task 1C-3。

下一個最小任務：

**執行 `npm run test:rbac-local-ready`，確認通過後執行 `npm run test:rbac-user-management-dev`。**

### P1-J 後續補強：Post-build Dev Server Sanity Check

完成狀態：**完成。production build 通過後，確認目前 `localhost:3002` dev server 仍可用，RBAC admin route smoke 無 500 / chunk missing。**

更新時間：2026-07-24

背景：

- `npm run build` 會重寫 `.next` 輸出；若 `next dev` 同時在跑，可能短暫造成 dev route chunk missing。
- 本輪只做本機 dev server sanity check 與文件更新，不改 API、UI、DB 或 migration。

修改檔案：

- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

API / UI / DB 影響：

- API：未修改。
- UI：未修改。
- DB：未修改、未新增 migration、未執行遠端操作。

檢查結果：

```powershell
npm run build
Get-NetTCPConnection -LocalPort 3002 -ErrorAction SilentlyContinue
Invoke-WebRequest -Uri http://localhost:3002 -UseBasicParsing -TimeoutSec 10
node scripts/test-rbac-admin-routes-smoke.js
```

結果：

- `npm run build`：通過，exit code 0；仍有既有 `DYNAMIC_SERVER_USAGE` 訊息，非 build failure。
- port 3002：有 node process listening。
- `GET http://localhost:3002`：200。
- `node scripts/test-rbac-admin-routes-smoke.js`：通過。
- 未發現首頁、使用者管理、角色管理或 RBAC 管理 API 未登入 smoke 發生 500 / chunk missing。

尚未完成事項：

- 尚未實跑 `npm run test:rbac-user-management-dev`。
- 尚未人工複驗使用者管理與角色權限管理 UI。
- 未開始 Task 1C-3。

下一個最小任務：

**執行 `npm run test:rbac-user-management-dev`，貼回 PASS / FAIL 與 `RBAC user management verification summary`。**

### P1-J 後續補強：Copilot RBAC Safe Preflight Permanent Rule

完成狀態：**完成。Repository-level Copilot instructions 已補上 RBAC safe preflight、合併 dynamic wrapper 與 navbar 重型寫入腳本的永久規則。**

更新時間：2026-07-24 13:35:45

背景：

- 前面已新增 `npm run test:rbac-safe-preflight` 與 `npm run test:rbac-user-management-dev`。
- 但 `.github/copilot-instructions.md` 的下一步仍偏向舊的分段腳本與單一 smoke test，容易讓後續代理漏跑 safe preflight 或誤跑 service-role 寫入型 navbar dynamic script。
- 本輪只更新文件與永久規則，不修改 API、UI、DB、migration 或測試邏輯。

修改檔案：

- `.github/copilot-instructions.md`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

API / UI / DB 影響：

- API：未修改。
- UI：未修改。
- DB：未修改、未新增 migration、未執行遠端操作。
- 測試：未新增或修改測試腳本。

新增或明確化的永久規則：

- RBAC 管理、使用者搜尋、角色權限或 navbar 權限相關修改完成後，先執行 `npm run test:rbac-safe-preflight`。
- `test:rbac-safe-preflight` 只能包含不需密碼、不使用 service role、不寫 DEV 資料的語法、靜態與未登入 smoke 檢查。
- authenticated DEV RBAC 動態驗收優先使用 `npm run test:rbac-user-management-dev`，由使用者在 Terminal hidden prompt 輸入 DEV 密碼。
- `scripts/test-rbac-navbar-permissions-dev.js` 會使用 service role 建立或更新 DEV-only Auth users / roles / role_permissions / user_roles，屬於重型寫入驗收；未經使用者明確批准不得執行。
- safe preflight 不得完整實跑 password-based dynamic scripts，也不得執行任何 `supabase` CLI 指令；這些腳本最多只能以 `node --check` 形式納入 preflight。

測試結果：

本輪為文件與 permanent instruction 更新，未修改 TypeScript / JavaScript runtime 邏輯。更新後執行：

```powershell
npm run test:rbac-safe-preflight
npx tsc --noEmit --pretty false
```

結果：

- `npm run test:rbac-safe-preflight`：通過，dev server ready check 回 200，RBAC formal static guard 與 unauthenticated route smoke 全部 PASS。
- `npx tsc --noEmit --pretty false`：通過。

尚未完成事項：

- 尚未實跑 `npm run test:rbac-user-management-dev`，因需要使用者在 Terminal 隱藏輸入 DEV 密碼。
- 尚未人工複驗使用者管理與角色權限管理 UI。
- 未開始 Task 1C-3。

下一個最小任務：

**先執行 `npm run test:rbac-safe-preflight`，再執行 `npm run test:rbac-user-management-dev`，最後以 `dev-full-admin@example.test` 人工複驗使用者與角色管理 UI。**

### P1-J 後續補強：RBAC Safe Preflight Static Guard

完成狀態：**完成。`test-rbac-formal-management-flow.js` 已納入 safe preflight 與 combined dynamic wrapper 的退化防線。**

背景：

- 新增 `npm run test:rbac-safe-preflight` 與 `npm run test:rbac-user-management-dev` 後，需要避免後續改版把需要密碼或會寫資料的 dynamic script 誤放入 safe preflight。
- 這類規則比文件提醒更適合進入靜態守門，讓本機檢查能直接抓到退化。

修改檔案：

- `scripts/test-rbac-formal-management-flow.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

API / UI / DB 影響：

- API：未修改。
- UI：未修改。
- DB：未修改、未新增 migration、未執行遠端操作。
- 測試：
  - formal static guard 會讀取 `package.json` 與 `scripts/test-rbac-safe-preflight.js`。
  - 檢查 `test:rbac-safe-preflight` 與 `test:rbac-user-management-dev` npm scripts 是否存在。
  - 檢查 safe preflight 是否有 dev server ready check。
  - 檢查 combined dynamic script 只以 `--check` 出現在 safe preflight。
  - 檢查 unsafe command 防呆清單包含 navbar script、password-based dynamic scripts、combined dynamic script 與 `supabase`。
  - 檢查 combined dynamic script 不使用 service role、`createAdminClient` 或 Auth Admin API。
  - 檢查 combined dynamic script 會執行 App DEV Guard 與 CLI DEV Guard。
  - 檢查 combined dynamic script 覆蓋四個人工 DEV 帳號、`/api/users/search`、`/api/admin/users/[id]/rbac` 與 no_access denial。
  - 檢查 combined dynamic script 保留敏感資訊遮罩檢查。

測試結果：

```powershell
node --check scripts/test-rbac-formal-management-flow.js
node scripts/test-rbac-formal-management-flow.js
npm run test:rbac-safe-preflight
npx tsc --noEmit --pretty false
```

結果：

- `node --check scripts/test-rbac-formal-management-flow.js`：通過。
- `node scripts/test-rbac-formal-management-flow.js`：通過。
- `npm run test:rbac-safe-preflight`：通過。
- `npx tsc --noEmit --pretty false`：通過。

尚未完成事項：

- 尚未實跑 `npm run test:rbac-user-management-dev`，因需要使用者在 Terminal 隱藏輸入 DEV 密碼。
- 尚未人工複驗使用者與角色管理 UI。

下一個最小任務：

**先執行 `npm run test:rbac-safe-preflight`，再執行 `npm run test:rbac-user-management-dev`，最後以 `dev-full-admin@example.test` 人工複驗使用者與角色管理 UI。**

### P1-J 後續補強：RBAC Dynamic Auth Cookie 格式修正

完成狀態：**完成本機修正與靜態守門；尚待使用者重新輸入 DEV 密碼實跑 dynamic test。**

更新時間：2026-07-24

背景：

- 使用者執行 `npm run test:rbac-user-management-dev` 後：
  - `unauthenticated search is 401` 通過。
  - `no_access search is 403` 失敗，實際回 401 `未登入`。
- 這代表 no_access 使用者已經由測試腳本登入 Supabase，但 Next API 沒有從測試 cookie 還原 session。
- 本機套件為 `@supabase/ssr` 0.5.2，server client 預設使用 `base64url` cookie encoding。
- RBAC dynamic scripts 仍使用舊的 JSON array cookie value，會導致 server-side Supabase client 讀不到 session。

修改檔案：

- `scripts/test-rbac-user-management-dev.js`
- `scripts/test-rbac-user-search-dev.js`
- `scripts/test-rbac-user-permissions-view-dev.js`
- `scripts/test-rbac-navbar-permissions-dev.js`
- `scripts/test-rbac-formal-management-flow.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`
- `docs/RBAC-MANAGEMENT-VERIFY.md`

API / UI / DB 影響：

- API：未修改。
- UI：未修改。
- DB：未修改、未新增 migration、未執行遠端操作。
- 測試：
  - RBAC dynamic scripts 已改為 `base64-${Buffer.from(JSON.stringify(session), 'utf8').toString('base64url')}`。
  - sign-in 後新增 session 存在性檢查。
  - formal static guard 已檢查 RBAC dynamic scripts 不得退回 `JSON.stringify([session.access_token, ...])` 舊格式。

發現問題：

- 此問題不是 RBAC 權限 API 或 RLS 失敗，而是測試腳本 cookie 格式與目前 `@supabase/ssr` server client 不相容。
- 修正後仍需使用者重新執行 password-based dynamic test，才能標記 RBAC dynamic test 通過。

尚未完成事項：

- 尚未重新實跑 `npm run test:rbac-user-management-dev`。
- 尚未人工複驗使用者管理與角色權限管理 UI。
- 未開始 Task 1C-3。

下一個最小任務：

**重新執行 `npm run test:rbac-user-management-dev`，貼回 PASS / FAIL 與 `RBAC user management verification summary`。**

禁止事項：

- 不得要求使用者在對話貼密碼。
- 不得輸出 JWT、refresh token、cookie 或 Supabase key。
- 不得用 service role 替代 authenticated API 驗收。
- 不得修改 API、RLS、DB schema 或已套用 migration 來處理這個測試 cookie 問題。

Migration 狀態：

- 本輪未新增 migration。
- 本輪未執行 `db push`、`repair`、`reset` 或 rollback。

### P1-J 後續補強：Navbar Admin Compatibility 全功能入口修正

完成狀態：**完成本機修正與靜態守門；尚待 full admin 人工複驗導覽列。**

更新時間：2026-07-24

背景：

- 使用者確認 `dev-full-admin@example.test` / 系統管理者角色權限已全開，但 navbar 仍未顯示正式區同樣的功能入口。
- 檢查後發現 `hooks/useNavbarPermissions.ts` 只有使用者管理、角色管理與部分總務庫存入口套用 admin-like 相容判斷。
- 門市管理、每月人員狀態、督導巡店、跨部門管理等入口仍直接檢查 `permissionSet.has(...)`。
- 若 client-side 直接查 RBAC 表受 RLS 或資料讀取時序影響，會造成 server-side 已視為 admin，但 navbar 不顯示完整入口。

修改檔案：

- `hooks/useNavbarPermissions.ts`
- `scripts/test-rbac-formal-management-flow.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

API / UI / DB 影響：

- API：未修改。
- UI：navbar 權限計算更新，admin-like 使用者會顯示所有 permission-gated 導覽入口。
- DB：未修改、未新增 migration、未執行遠端操作。
- 測試：formal static guard 已檢查 navbar 權限 hook 必須對主要導覽入口使用 admin-compatible helper。

實際修正：

- 新增：
  - `hasPermissionCode(code)`
  - `hasAnyPermissionCode(codes)`
- 這兩個 helper 都先判斷 `isAdminLike`，再查 `permissionSet`。
- 已套用到：
  - 任務管理
  - 門市管理
  - 每月人員狀態
  - 督導巡店
  - 跨部門管理
  - 舊盤點 / 業績 / 藥師 / 關係會員 / 商品主檔等入口

尚未完成事項：

- 尚待 full admin 人工重新整理頁面，確認正式區主要 navbar 入口顯示。
- 尚待 RBAC 使用者 / 角色管理 UI 複驗。
- 未開始 Task 1C-3。

下一個最小任務：

**以 `dev-full-admin@example.test` 重新整理頁面，複驗 navbar 是否顯示門市管理、每月人員狀態、督導巡店、跨部門管理、使用者管理、角色權限管理與總務服務中心。**

禁止事項：

- 不得用帳號 email 硬編碼顯示入口。
- 不得只靠前端隱藏/顯示取代 server-side API / RLS 權限。
- 不得修改 DB migration 或 remote schema。

Migration 狀態：

- 本輪未新增 migration。
- 本輪未執行 `db push`、`repair`、`reset` 或 rollback。

### Task 1C-3：庫存管理 UI 工作台收斂

完成狀態：**本機實作與靜態 / TypeScript / build 驗證完成；待使用者以 DEV 帳號做最後人工 UI 複驗後，可正式標記 Completed。**

更新時間：2026-07-24

任務目的：

- 延續 Task 1C-1「庫存位置與位置料件設定」與 Task 1C-2B / 1C-2C「庫存流水、餘額、API 與交易 UI」。
- 讓 `/general-affairs/inventory` 與 `/general-affairs/inventory/locations` 形成同一個庫存管理工作台，不需要手動輸入子頁網址。
- 保留現有總務服務中心工作台風格，不建立第二套導覽或第二套庫存 UI。

修改檔案：

- `components/general-affairs/inventory/InventoryTransactionsClient.tsx`
- `components/general-affairs/inventory/InventoryLocationsClient.tsx`
- `scripts/test-general-affairs-inventory-ui.js`
- `package.json`
- `docs/DEV-RBAC-HANDOFF.md`
- `docs/CURRENT-DEV-STATUS.md`

API / UI / DB 影響：

- API：未修改。
- DB：未修改，未新增 migration，未執行 `db push` / `repair` / `reset` / rollback。
- UI：
  - `/general-affairs/inventory` 新增庫存子頁導覽：
    - 庫存交易與餘額
    - 位置與料件設定
  - `/general-affairs/inventory/locations` 新增同一組子頁導覽與 breadcrumb。
  - 庫存交易頁新增摘要資訊：
    - 可見庫存位置
    - 可交易料件
    - 目前餘額筆數
    - 負庫存筆數
  - 庫存流水新增料件篩選。
  - 庫存位置頁新增摘要資訊：
    - 可見位置
    - 啟用位置
    - 門市 / 總倉
    - 預設位置
  - 保留 `general_affairs.part.view` 缺權限提示與未儲存離開提醒。
- 測試：
  - 新增 `scripts/test-general-affairs-inventory-ui.js`。
  - 新增 npm script：`npm run test:general-affairs-inventory-ui`。
  - 靜態守門檢查庫存子導覽、active 狀態、權限提示、navbar 權限入口與禁止 service role / migration 操作字串。

測試結果：

```powershell
node --check scripts/test-general-affairs-inventory-ui.js
node scripts/test-general-affairs-inventory-ui.js
node scripts/test-general-affairs-availability.js
npx tsc --noEmit --pretty false
npm run build
```

結果：

- `node --check scripts/test-general-affairs-inventory-ui.js`：通過。
- `node scripts/test-general-affairs-inventory-ui.js`：通過，輸出 `General affairs inventory UI static tests passed`。
- `node scripts/test-general-affairs-availability.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過，exit code 0。
- Build 仍有既有 `DYNAMIC_SERVER_USAGE` 訊息，屬現有專案 API route build warning，不是本輪庫存 UI failure。

發現問題：

- 本輪沒有發現 DB、RLS 或 API 新問題。
- 未做 authenticated browser automation；仍需使用者以 DEV 帳號人工複驗實際操作畫面。

尚未完成事項：

- 尚待人工 UI 複驗：
  - `dev-full-admin@example.test` 可直接從總務服務中心進入庫存管理。
  - 庫存交易與餘額頁可切到位置與料件設定。
  - 位置與料件設定頁可切回庫存交易與餘額。
  - 入庫 / 出庫 / 調增 / 調減仍可操作。
  - 缺 `part.view` 角色仍顯示明確提示。
  - no_access 仍看不到總務服務中心或被 route/API 阻擋。
  - 手機寬度子導覽不水平溢出。

下一個最小任務：

**以 DEV 帳號人工複驗 Task 1C-3 庫存 UI。通過後再由使用者批准開始剩餘總務服務中心模組，不要自行跳到 Task 1C-4 或維修 / 廠商 / 工單。**

禁止事項：

- 不得修改已套用 migration。
- 不得執行 `db push`、`migration repair`、`db reset`、rollback。
- 不得把 service role 帶入 client 或用 service role 取代 authenticated UI / API 驗收。
- 不得建立未批准的總務新模組頁面、DB 表或 fake route。
- 不得連 Production。

Migration 狀態：

- 本輪未新增 migration。
- 本輪唯讀確認 `npx supabase migration list`：13 筆 local / remote aligned。
- 目前沒有已知 local-only / remote-only / unknown migration。

### 總務服務中心：已完成主檔入口恢復

完成狀態：**本機實作、靜態測試、TypeScript 與 build 驗證完成；待人工 UI 複驗。**

更新時間：2026-07-24

任務目的：

- 使用者確認可繼續總務服務中心開發後，先恢復已具備 DEV schema / API / Client UI 的主檔功能。
- 避免再次開啟未完成 legacy 區塊造成 schema cache 原始錯誤。
- 不碰 DB、不新增 migration、不開工單 / 維修 / 廠商大型流程。

修改檔案：

- `hooks/useNavbarPermissions.ts`
- `components/Navbar.tsx`
- `app/general-affairs/page.tsx`
- `app/general-affairs/equipment/page.tsx`
- `app/general-affairs/equipment/templates/page.tsx`
- `app/general-affairs/facilities/page.tsx`
- `app/general-affairs/parts/page.tsx`
- `scripts/test-general-affairs-availability.js`
- `docs/DEV-RBAC-HANDOFF.md`
- `docs/CURRENT-DEV-STATUS.md`

API / UI / DB 影響：

- API：未修改。
- DB：未修改，未新增 migration，未執行 `db push` / `repair` / `reset` / rollback。
- UI：
  - Navbar 的「總務服務中心」dropdown 新增已完成主檔入口：
    - 設備管理：`/general-affairs/equipment`
    - 設備範本：`/general-affairs/equipment/templates`
    - 設施管理：`/general-affairs/facilities`
    - 料件中心：`/general-affairs/parts`
  - Direct routes 已從 `ModuleUnavailablePage` 改回既有 Client：
    - `EquipmentManagementClient`
    - `EquipmentTemplatesClient`
    - `FacilitiesClient`
    - `PartsClient`
  - 總務服務中心首頁新增「已開放主檔」區塊。
  - 未開放清單保留：
    - 維修回報與工單中心
    - 廠商管理
    - 服務分類 / 服務區域
    - 料件申請流程
- 權限入口：
  - 設備管理：`general_affairs.equipment.view` / `general_affairs.equipment.manage` / store manager / admin-like。
  - 設備範本：`general_affairs.equipment_template.view` / `general_affairs.equipment_template.manage` / admin-like。
  - 設施管理：`general_affairs.facility.view` / `general_affairs.facility.manage` / store manager / admin-like。
  - 料件中心：`general_affairs.part.view` / `general_affairs.part.manage` / store manager / admin-like。
  - 前端入口只改善 UX；API/RLS 仍是安全來源。

測試結果：

```powershell
node --check scripts/test-general-affairs-availability.js
node scripts/test-general-affairs-availability.js
node scripts/test-general-affairs-inventory-ui.js
npx tsc --noEmit --pretty false
```

結果：

- `node --check scripts/test-general-affairs-availability.js`：通過。
- `node scripts/test-general-affairs-availability.js`：通過。
- `node scripts/test-general-affairs-inventory-ui.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過，exit code 0。
- Build 仍有既有 `DYNAMIC_SERVER_USAGE` 訊息，非本輪 failure。

發現問題：

- 無 DB / RLS / API 新問題。
- 尚未做 browser / DEV 帳號人工互動複驗。

尚未完成事項：

- 尚待人工複驗：
  - full admin 可在 navbar 與總務首頁看到設備、設備範本、設施、料件入口。
  - no_access 不顯示總務服務中心或被安全阻擋。
  - `dev-ga-view` / `dev-ga-manage` 依目前實際 permission 配置顯示對應主檔入口。
  - 直接輸入四個主檔 route 時，頁面/API 仍依權限安全顯示資料或提示。

下一個最小任務：

**完成本輪 build 與人工 UI 複驗。通過後，再評估下一個總務模組：優先在維修/工單或廠商管理中選一個，不要一次打開兩個大型流程。**

禁止事項：

- 不得為了恢復入口臨時建立 DB 表。
- 不得打開會查 `ga_vendors`、`ga_service_categories`、`ga_service_regions` 的舊廠商管理 UI，除非該模組進入正式任務。
- 不得打開維修 / 工單提交流程，除非該模組進入正式任務。
- 不得修改已套用 migration。
- 不得連 Production。

Migration 狀態：

- 本輪未新增 migration。
- 本輪未執行遠端 DB 操作。

### 總務服務中心：廠商管理 / 服務分類 / 服務區域入口恢復

完成狀態：**本機實作、靜態測試、TypeScript、build 與本機 Playwright 可達性驗證完成；人工 UI 複驗待完成。**

更新時間：2026-07-24

任務目的：

- 使用者要求接下一個總務服務中心模組後，恢復已具備 DEV schema compatibility 的廠商管理區塊。
- 此模組使用已套用的 `20260724011554_production_legacy_general_affairs_maintenance_compatibility.sql` 中建立的：
  - `public.ga_vendors`
  - `public.ga_service_categories`
  - `public.ga_service_regions`
- 不新增 DB 表，不修改已套用 migration，不執行遠端 DB 操作。

修改檔案：

- `hooks/useNavbarPermissions.ts`
- `components/Navbar.tsx`
- `app/general-affairs/page.tsx`
- `scripts/test-general-affairs-availability.js`
- `docs/DEV-RBAC-HANDOFF.md`
- `docs/CURRENT-DEV-STATUS.md`

API / UI / DB 影響：

- API：未修改。廠商管理目前沿用既有 client-side Supabase 查詢與 RLS。
- DB：未修改，未新增 migration，未執行 `db push` / `repair` / `reset` / rollback。
- UI：
  - Navbar 的「總務服務中心」dropdown 新增：
    - 廠商管理：`/general-affairs?section=vendors`
  - 總務服務中心內部側邊導覽恢復：
    - 廠商管理
  - `?section=vendors` 會在頁面載入後切換到廠商管理。
  - 廠商管理內含既有 tabs：
    - 廠商列表
    - 服務分類管理
    - 服務區域管理
    - 合作記錄統計
  - 總務服務中心首頁新增廠商管理卡片。
  - 料件申請流程仍保持安全未開放。
- 權限入口：
  - `canAccessGeneralAffairsVendors` 依 admin-like、`/api/general-affairs/access` 或 `general_affairs.service_center.access` 判斷。
  - `ga_vendors`、`ga_service_categories`、`ga_service_regions` 的 RLS policy 目前同樣使用 `current_user_has_permission('general_affairs.service_center.access')`。
  - 前端入口只改善 UX；RLS 仍是資料安全來源。

測試結果：

```powershell
node --check scripts/test-general-affairs-availability.js
node scripts/test-general-affairs-availability.js
npx tsc --noEmit --pretty false
npm run build
```

結果：

- `node --check scripts/test-general-affairs-availability.js`：通過。
- `node scripts/test-general-affairs-availability.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過；僅出現既有 `DYNAMIC_SERVER_USAGE` 訊息。
- 本機 Playwright 可達性檢查：`/general-affairs?section=vendors` 回 200，無 Next error overlay。

發現問題：

- 本輪沒有發現 DB / RLS / API 新問題。
- 廠商管理目前仍是 legacy client-side Supabase UI，不是新式 REST API route；後續若要正式化，可另開 Task 將廠商管理改為 server-side API guard。

尚未完成事項：

- 尚待人工 UI 複驗：
  - full admin 可從 Navbar 與總務首頁進入廠商管理。
  - 具備 `general_affairs.service_center.access` 的帳號可看到廠商管理入口。
  - 廠商列表、服務分類管理、服務區域管理、合作記錄統計可切換。
  - 新增廠商 / 分類 / 區域不再出現 schema cache 原始錯誤。
  - no_access 不顯示總務服務中心或被安全阻擋。

下一個最小任務：

**由使用者人工 UI 複驗廠商管理 / 服務分類 / 服務區域。通過後，再由使用者決定是否處理料件申請流程或正式化廠商 API。**

禁止事項：

- 不得為了廠商管理再臨時建立 DB 表。
- 不得修改已套用 migration。
- 不得連 Production。
- 不得用 service role 繞過 authenticated / RLS 做 UI 驗收。

Migration 狀態：

- 本輪未新增 migration。
- 本輪未執行遠端 DB 操作。

### 總務服務中心：維修回報 / 工單中心入口恢復

完成狀態：**本機實作、靜態測試、TypeScript、build 與本機 Playwright 可達性驗證完成；人工 UI 複驗待完成。**

更新時間：2026-07-24

任務目的：

- 使用者確認可繼續下一個總務服務中心模組後，先恢復已存在 schema / API / 舊 UI 骨架的維修回報與工單中心。
- 不建立新 DB 表，不修改既有 migration，不打開尚未建置的廠商、服務分類、服務區域或料件申請流程。
- 維持「導覽顯示依 effective permissions，安全仍由 API / RLS 控制」的原則。

修改檔案：

- `hooks/useNavbarPermissions.ts`
- `components/Navbar.tsx`
- `app/general-affairs/page.tsx`
- `scripts/test-general-affairs-availability.js`
- `docs/DEV-RBAC-HANDOFF.md`
- `docs/CURRENT-DEV-STATUS.md`

API / UI / DB 影響：

- API：未修改。
- DB：未修改，未新增 migration，未執行 `db push` / `repair` / `reset` / rollback。
- UI：
  - Navbar 的「總務服務中心」dropdown 新增：
    - 維修回報：`/general-affairs?section=maintenance`
    - 工單中心：`/general-affairs?section=work-orders`
  - 總務服務中心內部側邊導覽恢復：
    - 維修回報
    - 工單中心
  - `?section=maintenance` / `?section=work-orders` 會在頁面載入後切換到對應分頁。
  - 總務服務中心首頁新增維修回報與工單中心卡片。
  - 廠商管理、服務分類 / 服務區域、料件申請流程仍保持安全未開放。
- 權限入口：
  - 維修回報與工單中心入口依 `cross_dept.maintenance.submit`、`cross_dept.maintenance.view_all`、`cross_dept.maintenance.update` 或 admin-like 判斷。
  - 維修回報中，具備 submit 時顯示新增回報；沒有 submit 但具備查看/更新時顯示我的回報。
  - 工單中心可進入查看；更新進度仍依既有 `canUpdateWorkOrders` 控制。
  - 前端入口只改善 UX；API / RLS 仍是安全來源。

測試結果：

```powershell
node --check scripts/test-general-affairs-availability.js
node scripts/test-general-affairs-availability.js
node scripts/verify-dev-supabase-environment.js
node scripts/verify-dev-supabase-cli-environment.js
npx tsc --noEmit --pretty false
npm run build
npx supabase migration list
```

結果：

- `node --check scripts/test-general-affairs-availability.js`：通過。
- `node scripts/test-general-affairs-availability.js`：通過。
- App DEV Guard：通過，Project Ref `mjpd...mtqr`。
- CLI DEV Guard：通過，Project Ref `mjpd...mtqr`。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過，exit code 0；仍有既有 `DYNAMIC_SERVER_USAGE` 訊息，非 build failure。
- `npx supabase migration list`：13 筆 local / remote aligned。
- Playwright 輕量可達性：使用臨時檢查腳本驗證 `/general-affairs?section=maintenance` 與 `/general-affairs?section=work-orders` 均回 200，無 Next error overlay。
- Playwright 臨時檢查檔已刪除，沒有保留在 repository。

發現問題：

- 本輪沒有發現 DB / RLS / API 新問題。
- 尚未以 DEV 帳號實際操作維修送出或工單更新。
- 若維修 API 回傳權限不足，應先確認 RBAC permission 配置，不可用 service role 繞過。

尚未完成事項：

- 尚待人工 UI 複驗：
  - full admin 可從 Navbar 與總務首頁進入維修回報、工單中心。
  - 有 `cross_dept.maintenance.submit` 的帳號可看到新增維修回報。
  - 有 `cross_dept.maintenance.view_all` 或 `cross_dept.maintenance.update` 的帳號可看工單中心。
  - 無維修權限但有總務服務中心入口的帳號不顯示維修 / 工單可操作入口。
  - no_access 不顯示總務服務中心或被安全阻擋。

下一個最小任務：

**人工 UI 複驗維修回報 / 工單中心。通過後，再由使用者決定下一個總務模組；廠商管理、服務分類 / 區域、料件申請流程不可未批准先打開。**

禁止事項：

- 不得新增維修相關 migration，除非後續驗收證實 schema 缺口且使用者批准 forward migration。
- 不得開啟 `ga_vendors`、`ga_service_categories`、`ga_service_regions` 的可操作 UI。
- 不得修改已套用 migration。
- 不得連 Production。

Migration 狀態：

- 本輪未新增 migration。
- 本輪未執行遠端 DB 操作。

### 總務服務中心：新增廠商欄位相容性 Forward Migration

完成狀態：**正式 DEV `db push` 完成，migration local / remote aligned；待使用者複驗新增廠商。**

更新時間：2026-07-24

任務目的：

- 使用者人工複驗廠商管理時，發現可以進入廠商管理，但無法順利新增廠商。
- 靜態比對後確認 `app/general-affairs/page.tsx` 的五段式廠商表單會寫入服務能力、帳務、合作與附件欄位。
- DEV 已套用的 `public.ga_vendors` compatibility schema 尚未包含這批表單欄位，因此 insert 會失敗。
- repo 內已有平放來源 SQL：`supabase/migration_general_affairs_vendor_form_sections.sql`，用於補齊這批欄位。

新增檔案：

- `supabase/migrations/20260724092830_general_affairs_vendor_form_sections.sql`

修改檔案：

- `scripts/test-general-affairs-availability.js`
- `docs/DEV-RBAC-HANDOFF.md`
- `docs/CURRENT-DEV-STATUS.md`

Migration 內容：

- 只對 `public.ga_vendors` 執行 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`。
- 新增欄位：
  - `service_capability_note`
  - `billing_title`
  - `billing_address`
  - `invoice_type`
  - `payment_terms`
  - `payment_methods`
  - `accounting_notes`
  - `cooperation_start_date`
  - `contract_end_date`
  - `contract_required`
  - `preferred_vendor`
  - `cooperation_notes`
  - `attachment_names`
- 不新增 table，不刪 table，不修改 RLS / grants / policies / RPC。
- 不包含 test SQL、seed、rollback、Production Project Ref、secret、password、JWT 或 connection string。

測試、dry-run 與正式推送：

```powershell
node --check scripts/test-general-affairs-availability.js
node scripts/test-general-affairs-availability.js
npx supabase migration list
npx supabase db push --dry-run
npx supabase db push
```

結果：

- `node --check scripts/test-general-affairs-availability.js`：通過。
- `node scripts/test-general-affairs-availability.js`：通過。
- 平放來源 SQL 與標準 migration 內容一致。
- `npx supabase migration list`：推送前既有 13 筆 migrations local / remote aligned，只有 `20260724092830` local-only。
- `npx supabase db push --dry-run`：通過，只列 `20260724092830_general_affairs_vendor_form_sections.sql`。
- `npx supabase db push`：通過，只推送 `20260724092830_general_affairs_vendor_form_sections.sql`。
- 推送後 `npx supabase migration list`：14 筆 migrations local / remote aligned。
- 唯讀 schema dump 確認 `ga_vendors` 已存在 13 個新增欄位；臨時 dump 檔已刪除。

發現問題：

- 新增廠商失敗不是 Navbar 或 RLS 問題，而是 `ga_vendors` 缺少表單會寫入的欄位。
- DEV DB 已補欄位；使用者已回報新增廠商、服務分類與服務區域都可以成功新增。

下一個最小任務：

**由使用者決定下一個總務服務中心模組；目前最小候選是料件申請流程，或正式化廠商 API。**

禁止事項：

- 不得修改已套用 migration。
- 不得將此修正合併回已 applied 的 `20260724011554` migration。
- 不得執行 `migration repair` / `db reset` / rollback。
- 不得連 Production。
- 不得將 Production 資料帶入 DEV。

### 總務服務中心：料件申請流程安全導流

完成狀態：**本機實作、靜態測試、TypeScript、build 與本機 Playwright 可達性驗證完成；人工 UI 複驗待完成。**

更新時間：2026-07-24

任務目的：

- 使用者要求接下一步後，處理總務服務中心目前仍未完成的料件申請流程。
- 盤點確認目前 repository / DEV schema 沒有正式料件申請 DB / API 基礎。
- 原本「申請料件」與「料件申請紀錄」會導向 `parts`，造成使用者進入料件主檔，語意錯誤。
- 本輪不建立假流程、不新增 DB、不建立 migration，只修正入口導流到安全未開放說明。

修改檔案：

- `app/general-affairs/page.tsx`
- `scripts/test-general-affairs-availability.js`
- `docs/DEV-RBAC-HANDOFF.md`
- `docs/CURRENT-DEV-STATUS.md`

API / UI / DB 影響：

- API：未新增、未修改。
- DB：未新增 migration，未執行 `db push` / `repair` / `reset` / rollback。
- UI：
  - 新增內部 section：`part-requests`。
  - 門市 / 一般使用者的「申請料件」與「料件申請紀錄」改為顯示 `料件申請流程` 的安全未開放說明。
  - 總務管理者的「新增料件」仍導向已完成的料件主檔 `/general-affairs/parts`。
  - 「料件申請流程」不再誤導到料件主檔。

測試結果：

```powershell
node --check scripts/test-general-affairs-availability.js
node scripts/test-general-affairs-availability.js
npx tsc --noEmit --pretty false
npm run build
```

結果：

- `node --check scripts/test-general-affairs-availability.js`：通過。
- `node scripts/test-general-affairs-availability.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過；僅出現既有 `DYNAMIC_SERVER_USAGE` 訊息，非 build failure。
- Playwright 輕量可達性：`/general-affairs` 回 200，無 Next error overlay，無 schema cache 原始錯誤。
- Playwright 臨時檢查檔已刪除。

發現問題：

- 目前尚無料件申請正式 schema / API，因此不能宣稱流程完成。
- 本輪修正的是 UX 與安全導流，避免未建置流程誤導到料件主檔。

下一個最小任務：

**人工 UI 複驗「申請料件 / 料件申請紀錄」顯示安全未開放說明。通過後，再由使用者決定是否正式設計並建立料件申請流程 DB / API。**

禁止事項：

- 不得為了料件申請流程臨時建立假表或假 API。
- 不得修改已套用 migration。
- 不得連 Production。
- 不得用 `parts` 主檔頁冒充料件申請流程。

### 總務服務中心：新增回報照片選擇修正

完成狀態：**本機實作、靜態測試、TypeScript 與 build 完成；待使用者人工複驗。**

更新時間：2026-07-24

任務目的：

- 使用者目前以「新增回報」的基本資訊資源類型選擇「料件 / 耗材」來暫時模擬料件申請。
- 在補充資料步驟點選照片時，無法順利選擇照片。
- 本輪只修正既有新增回報 UI 的照片選擇器，不新增料件申請 DB / API，不修改 maintenance API，不修改 migration。

修改檔案：

- `app/general-affairs/page.tsx`
- `scripts/test-general-affairs-availability.js`
- `docs/DEV-RBAC-HANDOFF.md`
- `docs/CURRENT-DEV-STATUS.md`

API / UI / DB 影響：

- API：未新增、未修改。
- DB：未新增 migration，未執行 `db push` / `repair` / `reset` / rollback。
- UI：
  - 新增回報補充資料的照片選擇器改用原生 `label` + `file input`。
  - file input 使用固定 id：`maintenance-report-photo-input`。
  - 支援 `image/*,.heic,.heif`，可選 JPG / PNG / HEIC / HEIF 等圖片。
  - 選檔後會清空 input value，允許使用者重選同一張照片仍觸發 change。
  - 保留最多 5 張照片限制。
  - 非圖片檔會被擋下並顯示安全提示。

測試結果：

```powershell
node --check scripts/test-general-affairs-availability.js
node scripts/test-general-affairs-availability.js
npx tsc --noEmit --pretty false
npm run build
```

結果：

- `node --check scripts/test-general-affairs-availability.js`：通過。
- `node scripts/test-general-affairs-availability.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過；僅出現既有 `DYNAMIC_SERVER_USAGE` 訊息，非 build failure。

發現問題：

- 原本的 hidden input 透過 `ref.current?.click()` 觸發，在部分瀏覽器 / 行動裝置環境可能不穩定。
- 原本 `accept="image/*"` 對 HEIC / HEIF 照片選擇不夠明確。
- 原本雖已清空 input value，但缺少靜態測試鎖住此行為。

尚未完成事項：

- 需要使用者人工複驗：
  - 進入總務服務中心。
  - 點「新增回報」。
  - 基本資訊資源類型選「料件 / 耗材」。
  - 到補充資料步驟點「新增照片」。
  - 確認可選 JPG / PNG / HEIC 圖片。
  - 確認同一張照片可重新選取。

下一個最小任務：

**人工複驗新增回報照片選擇器。若仍無法選擇，下一步需回報使用裝置、瀏覽器、檔案格式與是否有檔案選擇視窗出現。**

禁止事項：

- 不得為此修正建立 DB migration。
- 不得修改已套用 migration。
- 不得把料件主檔頁當成正式料件申請流程。
- 不得連 Production。

### 總務服務中心：料件申請紀錄暫行檢視

完成狀態：**本機實作、靜態測試、TypeScript 與 build 完成；待使用者人工複驗。**

更新時間：2026-07-24

任務目的：

- 使用者詢問目前以「新增回報」資源類型選「料件 / 耗材」模擬料件申請後，不知道要到哪裡查看料件申請紀錄。
- 正式料件申請流程尚未建置 DB / API，因此本輪不建立新表、不建立假流程。
- 以既有 `maintenance_requests.resource_type = material` 作為暫行紀錄來源，讓使用者可在總務服務中心內直接查看目前模擬料件申請的回報紀錄。

修改檔案：

- `app/general-affairs/page.tsx`
- `scripts/test-general-affairs-availability.js`
- `docs/DEV-RBAC-HANDOFF.md`
- `docs/CURRENT-DEV-STATUS.md`

API / UI / DB 影響：

- API：未新增、未修改。仍使用既有 `/api/maintenance-requests` 與 `/api/maintenance-photos`。
- DB：未新增 migration，未執行 `db push` / `repair` / `reset` / rollback。
- UI：
  - `part-requests` section 改為 `renderPartRequestRecords()`。
  - 「料件申請紀錄」顯示新增回報中 `resource_type === 'material'` 的資料。
  - 頁面標示這是正式料件申請流程建置前的暫行紀錄。
  - 可搜尋、狀態篩選、日期篩選。
  - 可展開查看需求描述與附件。
  - 具備新增回報權限時，提供「新增料件申請」按鈕，會切到新增回報並預選「料件 / 耗材」。
  - 不再讓使用者只能看到未開放說明，也不導向料件主檔。

測試結果：

```powershell
node --check scripts/test-general-affairs-availability.js
node scripts/test-general-affairs-availability.js
npx tsc --noEmit --pretty false
npm run build
```

結果：

- `node --check scripts/test-general-affairs-availability.js`：通過。
- `node scripts/test-general-affairs-availability.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過；僅出現既有 `DYNAMIC_SERVER_USAGE` 訊息，非 build failure。

發現問題：

- 目前尚無正式料件申請 schema，因此此頁不是最終料件申請模組。
- 目前紀錄依賴 `maintenance_requests.resource_type = material`；若送出時因舊欄位 fallback 未寫入 `resource_type`，該筆舊資料不會被納入此暫行紀錄。

尚未完成事項：

- 需要使用者人工複驗：
  - 點「申請料件」後可在料件申請紀錄頁看到「新增料件申請」入口。
  - 新增回報選「料件 / 耗材」送出後，該筆資料出現在「料件申請紀錄」。
  - 展開紀錄可查看描述與照片附件。

下一個最小任務：

**人工複驗料件申請紀錄暫行檢視。通過後，再由使用者決定是否正式設計料件申請 DB / API / UI 流程。**

禁止事項：

- 不得用 `parts` 主檔頁冒充料件申請流程。
- 不得為了暫行紀錄建立新 DB table。
- 不得修改已套用 migration。
- 不得連 Production。

### 總務服務中心：料件申請紀錄入口補強

完成狀態：**本機實作、靜態測試、TypeScript 與 build 完成；待使用者人工複驗。**

更新時間：2026-07-25

任務目的：

- 使用者回報仍不知道如何找到料件申請紀錄。
- 前一輪已建立 `part-requests` 暫行紀錄頁，但沒有出現在總務服務中心主要導覽中，入口不夠明確。
- 本輪只補 UI 入口，不修改 DB / API / migration。

修改檔案：

- `app/general-affairs/page.tsx`
- `scripts/test-general-affairs-availability.js`
- `docs/DEV-RBAC-HANDOFF.md`
- `docs/CURRENT-DEV-STATUS.md`

API / UI / DB 影響：

- API：未新增、未修改。
- DB：未新增 migration，未執行 `db push` / `repair` / `reset` / rollback。
- UI：
  - `serviceNavItems` 新增 `料件申請紀錄`，key 為 `part-requests`。
  - Desktop 左側導覽可直接點「料件申請紀錄」。
  - Mobile 橫向導覽同步可看到「料件申請紀錄」。
  - 總務服務中心首頁新增「料件申請紀錄」卡片與「查看料件申請紀錄」按鈕。
  - 原「尚未開放模組」不再列出料件申請流程，避免與暫行紀錄頁矛盾。

測試結果：

```powershell
node --check scripts/test-general-affairs-availability.js
node scripts/test-general-affairs-availability.js
npx tsc --noEmit --pretty false
npm run build
```

結果：

- `node --check scripts/test-general-affairs-availability.js`：通過。
- `node scripts/test-general-affairs-availability.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過；僅出現既有 `DYNAMIC_SERVER_USAGE` 訊息，非 build failure。

尚未完成事項：

- 需要使用者人工複驗：
  - 總務服務中心左側導覽可看到「料件申請紀錄」。
  - 手機導覽可看到「料件申請紀錄」。
  - 服務首頁可看到「料件申請紀錄」卡片。
  - 點擊後進入暫行紀錄頁，顯示 `resource_type = material` 的回報紀錄。

下一個最小任務：

**人工複驗料件申請紀錄入口是否足夠清楚。若通過，再由使用者決定是否正式設計料件申請流程。**

禁止事項：

- 不得為入口補強新增 DB table。
- 不得修改已套用 migration。
- 不得連 Production。

### 總務服務中心：申請料件快速入口補強

完成狀態：**本機實作、靜態測試、TypeScript 與 build 完成；待使用者人工複驗。**

更新時間：2026-07-26

任務目的：

- 使用者回報仍不知道要去哪裡查看料件申請紀錄。
- 前一輪已補上「料件申請紀錄」頁面與導覽入口；本輪進一步讓「申請料件」快速入口直接開啟料件申請表單，而不是讓使用者自己切換資源類型。
- 此為正式料件申請 DB / API 建置前的暫行流程，不新增資料表、不修改 migration。

修改檔案：

- `app/general-affairs/page.tsx`
- `scripts/test-general-affairs-availability.js`
- `docs/DEV-RBAC-HANDOFF.md`
- `docs/CURRENT-DEV-STATUS.md`

API / UI / DB 影響：

- API：未新增、未修改。仍使用既有 `/api/maintenance-requests` 建立回報，照片仍透過 `/api/maintenance-photos` 上傳。
- DB：未新增 migration，未執行 `db push` / `repair` / `reset` / rollback。
- UI：
  - 總務服務中心首頁「申請料件」快速入口會直接切到新增表單。
  - 表單標題改為「新增料件申請」。
  - 資源類型預選「料件 / 耗材」。
  - 需求名稱欄位顯示為「料件 / 需求名稱」。
  - 補充描述提示改為描述用途、需求數量、目前庫存狀況與急迫性。
  - 送出按鈕顯示「送出料件申請」。
  - 送出成功提示顯示「料件申請已送出」。
  - 送出後回到「料件申請紀錄」。
  - 非料件回報仍維持原有維修回報文案與流程。

測試結果：

```powershell
node --check scripts/test-general-affairs-availability.js
node scripts/test-general-affairs-availability.js
npx tsc --noEmit --pretty false
npm run build
```

結果：

- `node --check scripts/test-general-affairs-availability.js`：通過。
- `node scripts/test-general-affairs-availability.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過；僅出現既有 `DYNAMIC_SERVER_USAGE` 訊息，非 build failure。

發現問題：

- 暫行料件申請仍依賴 `maintenance_requests.resource_type = material`，不是最終料件申請模組。
- 目前只能讓使用者更容易建立與找到暫行紀錄，尚未提供正式的料件申請審核、領用、庫存扣減或工單串接流程。

尚未完成事項：

- 需要使用者人工複驗：
  - 點「申請料件」後直接看到「新增料件申請」。
  - 資源類型已預選「料件 / 耗材」。
  - 補充資料可選照片。
  - 送出後看到「料件申請已送出」。
  - 送出後回到「料件申請紀錄」，並可看到該筆 `resource_type = material` 的紀錄。

下一個最小任務：

**人工複驗「申請料件」快速入口與「料件申請紀錄」暫行流程。通過後，再由使用者批准是否進入正式料件申請 DB / API / UI 設計。**

禁止事項：

- 不得用料件主檔頁冒充料件申請流程。
- 不得為暫行入口新增正式料件申請資料表。
- 不得修改已套用 migration。
- 不得連 Production。

### 總務服務中心：附件基礎本機實作

完成狀態：**本機實作、靜態測試、TypeScript、build 與 DEV db push 完成；待 catalog SQL / 動態驗收 / 人工 UI 複驗。**

更新時間：2026-07-29

任務目的：

- 補齊總務共用附件基礎，不再讓設備圖片維持「尚未開放上傳」。
- 建立設備、設施、維修回報與維修更新可共用的附件資料模型、Storage path 規則、upload / signed URL / soft delete API 與 UI 面板。
- 保留既有維修照片流程，不在本輪重寫 `maintenance_photos` / `maintenance_update_photos`，而是新增共用附件基礎供後續逐步收斂。

修改檔案：

- `supabase/migrations/20260729125755_general_affairs_resource_attachments.sql`
- `supabase/migration_general_affairs_resource_attachments.sql`
- `supabase/rollback_general_affairs_resource_attachments.sql`
- `supabase/test_general_affairs_resource_attachments.sql`
- `app/api/general-affairs/attachments/route.ts`
- `app/api/general-affairs/attachments/[id]/route.ts`
- `components/general-affairs/attachments/ResourceAttachmentPanel.tsx`
- `components/general-affairs/equipment/EquipmentCreatePageClient.tsx`
- `components/general-affairs/equipment/EquipmentManagementClient.tsx`
- `components/general-affairs/facilities/FacilitiesClient.tsx`
- `components/general-affairs/service-center/GeneralAffairsServiceCenterClient.tsx`
- `scripts/test-general-affairs-resource-attachments.js`
- `scripts/test-general-affairs-asset-management-ui.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

DB / Storage 設計：

- 新增 `public.ga_resource_attachments`。
- Prerequisite check：
  - `current_user_has_permission` 在 DEV baseline 的實際簽名為 `public.current_user_has_permission(character varying)`。
  - 附件 migration 必須檢查 `character varying`，不得使用 `text` 簽名，否則 DEV 會誤判缺少 RBAC helper。
- 支援 `resource_type`：
  - `EQUIPMENT`
  - `FACILITY`
  - `MAINTENANCE_REQUEST`
  - `MAINTENANCE_UPDATE`
- 新增 private Supabase Storage bucket：
  - `general-affairs-attachments`
- Storage path 規則：
  - `{resource_type_lower}/{resource_id}/{purpose_lower}/{timestamp}-{uuid}.{ext}`
  - 必須是安全相對路徑。
  - 不允許 scheme、反斜線、`..` 或開頭 `/`。
- 檔案限制：
  - JPG / PNG / WebP / HEIC / HEIF / PDF。
  - 單檔 20MB。
- Metadata 必須是 JSON object。
- 未刪除資料中 `storage_bucket + storage_path` 唯一。
- 同一 `resource_type + resource_id + purpose` 只允許一筆 active primary 附件。
- 不建立 hard DELETE policy。
- soft delete 必須走 `ga_soft_delete_resource_attachment(UUID, TEXT)`。

RLS / Security：

- `ga_resource_attachment_can_read(TEXT, UUID)`：
  - 設備：`general_affairs.equipment.view/manage` 或該門市 store manager 可讀。
  - 設施：`general_affairs.facility.view/manage` 或該門市 store manager 可讀。
  - 維修回報：總務維修 / 工單權限、legacy cross-dept 相容碼、回報人本人、或具備門市 scope 的店長可讀。
  - 維修更新：公開更新或工單 / 維修管理權限可讀。
- `ga_resource_attachment_can_manage(TEXT, UUID)`：
  - 設備需 `general_affairs.equipment.manage`。
  - 設施需 `general_affairs.facility.manage`。
  - 維修回報允許總務工單更新者、回報人本人或具備門市 scope 的回報權限角色。
  - 維修更新允許工單更新者或該更新建立者。
- 所有 helper / trigger / RPC 使用 `SECURITY DEFINER` 與 `SET search_path = public, pg_temp`。
- Client 不可偽造 uploaded / updated / deleted system fields。
- Storage objects 只建立 service_role policy；一般 authenticated 使用者不直接操作 Storage，而是透過 server API 受控上傳、簽名 URL 與刪除。

API：

- `GET /api/general-affairs/attachments?resourceType=<TYPE>&resourceId=<UUID>`
  - 需登入。
  - 透過 authenticated Supabase client 查 `ga_resource_attachments`，保留 RLS。
  - 使用 server admin storage client 產生 24 小時 signed URL。
  - 回傳 `signed_url` 與遮罩後的 `storage_path_display`。
- `POST /api/general-affairs/attachments`
  - 需登入。
  - FormData 欄位：`resource_type`、`resource_id`、`purpose`、`is_primary`、`files`。
  - 使用 admin storage client 上傳檔案，再用 authenticated client 寫 metadata，保留 RLS / trigger permission check。
  - 若 metadata 寫入失敗，清理本次已上傳 Storage object。
  - 若 Storage bucket 尚未建置，API 會將 `Bucket not found` 轉成「總務附件儲存空間尚未建置到目前環境，請先完成附件基礎 Storage 設定。」並回 503，不直接暴露原始 bucket 錯誤。
- `DELETE /api/general-affairs/attachments/[id]`
  - 需登入。
  - Body 必填 `deletion_reason`。
  - 呼叫 `ga_soft_delete_resource_attachment`。
  - soft delete 成功後再用 admin storage client 移除物件；Storage 清理失敗時回 warning，不覆蓋 DB soft delete 成功。

UI：

- 新增 `ResourceAttachmentPanel`：
  - 載入附件。
  - signed URL 預覽圖片 / PDF。
  - 上傳圖片或 PDF。
  - 檔案格式與 20MB 錯誤提示。
  - soft delete 時要求輸入原因。
  - 已無 manage 權限時只顯示查看模式與明確提示。
  - 安全解析附件 API 回應；非 JSON 或未建置 Storage 錯誤不會造成前端二次錯誤。
- 設備新增：
  - 新增「設備圖片與附件」區塊。
  - 建立設備主檔成功後才上傳附件。
  - 若附件失敗，明確顯示「設備已新增，但附件上傳失敗」，讓使用者可之後到設備詳情補傳。
- 設備重新編輯：
  - 既有設備的編輯彈窗已新增「設備圖片與附件」區塊。
  - 使用 `ResourceAttachmentPanel resourceType="EQUIPMENT"` 與目前 `editing.id`，可再次補傳圖片或 PDF。
  - 新增設備尚未取得 `id` 前不顯示此面板，避免附件缺少主檔關聯。
- 設備詳情：
  - 接入 `ResourceAttachmentPanel resourceType="EQUIPMENT"`。
- 設施詳情：
  - 接入 `ResourceAttachmentPanel resourceType="FACILITY"`。
- 我的回報詳情與工單中心詳情：
  - 接入 `ResourceAttachmentPanel resourceType="MAINTENANCE_REQUEST"`。
  - 既有維修照片 strip 保留，避免破壞已存在的維修照片流程。

測試與檢查結果：

```powershell
node --check scripts/test-general-affairs-resource-attachments.js
node scripts/test-general-affairs-resource-attachments.js
node --check scripts/test-general-affairs-asset-management-ui.js
node scripts/test-general-affairs-asset-management-ui.js
node scripts/test-general-affairs-ui-foundation.js
npx tsc --noEmit --pretty false
npm run build
git diff --check -- <本輪相關檔案>
```

結果：

- `node --check scripts/test-general-affairs-resource-attachments.js`：通過。
- `node scripts/test-general-affairs-resource-attachments.js`：通過。
- `node --check scripts/test-general-affairs-asset-management-ui.js`：通過。
- `node scripts/test-general-affairs-asset-management-ui.js`：通過。
- `node scripts/test-general-affairs-ui-foundation.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過；仍有既有 `DYNAMIC_SERVER_USAGE` 訊息與本機 webpack cache restore warning，非 build failure。
- `git diff --check`（本輪相關檔案）：通過。

Migration 狀態：

- 既有 17 筆 DEV migrations local / remote aligned。
- `20260729125755_general_affairs_resource_attachments.sql` 已正式推送 DEV。
- 推送前曾因 prerequisite check 使用 `current_user_has_permission(text)` 而誤判失敗；已修正為 `current_user_has_permission(character varying)` 後重新 dry-run / push 成功。
- 本輪未執行 repair、reset、rollback 或 Production 操作。
- 不得修改已套用 migration；若附件 DB 問題在 DEV 驗收中出現，必須建立 forward fix。

尚未完成事項：

- 尚未執行 `supabase/test_general_affairs_resource_attachments.sql`。
- 尚未做 authenticated dynamic verification：
  - manage 可上傳。
  - view 可預覽 signed URL。
  - non-manage 不可上傳 / soft delete。
  - soft delete reason 必填。
  - unsafe path / unsupported MIME / oversized file 拒絕。
  - Storage policy 不允許 client direct access。
- 尚未做人工 UI 複驗：
  - 設備新增附圖。
  - 設備詳情上傳 / 預覽 / 刪除。
  - 設施詳情上傳 / 預覽 / 刪除。
  - 我的回報 / 工單中心附件區。
  - mobile 不水平 overflow。

下一個最小任務：

**附件基礎 catalog SQL 與 DEV 動態 / 人工 UI 驗收。**

建議順序：

1. App DEV Guard。
2. CLI DEV Guard。
3. `npx supabase migration list`，確認 17 筆 local / remote aligned。
4. 執行 `supabase/test_general_affairs_resource_attachments.sql` catalog 驗收。
5. 執行 authenticated 動態驗收：上傳、signed URL、soft delete、non-manage 拒絕與 Storage policy。
6. 人工 UI 驗收設備、設施、維修回報附件流程。

禁止事項：

- 不得正式 push 未 dry-run 的 migration。
- 不得修改已套用 migration。
- 不得執行 repair / reset / rollback。
- 不得將 Storage bucket 設成 public。
- 不得讓 client 直接使用 service role 或直接繞過 RLS 寫附件 metadata。
- 不得把維修舊照片流程直接刪除或重寫。
- 不得開始正式料件申請、採購、調撥、盤點、工單扣料或 Production 操作，除非使用者明確批准。

### Task UI-4A 補充修正：設備／設施分類上層選擇器逐層展開

完成狀態：**本機修正完成；待人工 UI 複驗。**

更新時間：2026-07-29

任務目的：

- 使用者回報新增分類時，「上層分類」原本是把所有分類攤平成單一下拉選單；分類名稱越來越多後會很亂。
- 正確操作應先顯示第 1 層分類，點選某分類後再顯示該層的下層列表，依此類推。
- 本輪只修正設備／設施分類管理 UI，不修改 DB、migration、API contract、RLS 或 RPC。

修改檔案：

- `components/general-affairs/assets/AssetCategoryManagementClient.tsx`
- `scripts/test-general-affairs-asset-management-ui.js`
- `docs/GENERAL-AFFAIRS-UX-BLUEPRINT.md`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

UI / API / DB 影響：

- UI：
  - 新增 `CategoryParentPicker`。
  - 「上層分類」由 flat `<select>` 改為逐層選取器。
  - 預設可按「設為第一層分類」建立 root category。
  - 先顯示「第 1 層」，選取後才顯示下一層。
  - 顯示「目前上層路徑」，讓使用者確認分類會建立在哪個節點下。
  - 保留最多三層、防止選自己或子分類作為上層分類的既有驗證。
- API：未新增、未修改，仍使用既有 `/api/general-affairs/categories`。
- DB：未新增 migration，未執行 `db push`、`repair`、`reset` 或 rollback。

測試結果：

```powershell
node --check scripts/test-general-affairs-asset-management-ui.js
node scripts/test-general-affairs-asset-management-ui.js
node scripts/test-general-affairs-ui-foundation.js
npx tsc --noEmit --pretty false
```

結果：

- `node --check scripts/test-general-affairs-asset-management-ui.js`：通過。
- `node scripts/test-general-affairs-asset-management-ui.js`：通過。
- `node scripts/test-general-affairs-ui-foundation.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。

發現問題：

- 本輪未重跑 `npm run build`；前一輪 build 曾出現 Next build 卡住／stale `.next` 相關問題，需在下一個較大收斂節點再次確認。

尚未完成事項：

- 需要人工複驗設備分類與設施分類：
  - 新增分類時不再看到所有分類攤平成一長串下拉。
  - 可先選第 1 層，再選第 2 層。
  - 若已有第 3 層，不應允許繼續建立第 4 層。
  - 編輯分類時不可選自己或自己的子分類。

下一個最小任務：

**人工複驗 Task UI-4A：設備／設施分類上層選擇器與設備／設施子模組導覽。**

禁止事項：

- 不得為此 UI 修正修改分類資料表或 API contract。
- 不得修改已套用 migration。
- 不得連 Production。

### Task UI-4A 補充修正：資產編號正式規格改為第二層分類 code 4 碼

完成狀態：**本機規格與 UI 預覽修正完成；尚未建立 asset code RPC / sequence / migration。**

更新時間：2026-07-29

任務目的：

- 使用者確認設備與設施分類採三層 code：
  - 第一層：2 碼，例如 `IC`、`AS`。
  - 第二層：4 碼，例如 `IC01`、`AS01`。
  - 第三層：6 碼，例如 `IC0101`、`AS0101`。
- 資產編號不得取第一層 2 碼，也不得取第三層 6 碼。
- 正式規格為 `{LEVEL_2_CATEGORY_CODE}{PURCHASE_DATE_YYYYMMDD}{SEQUENCE_3_DIGITS}`。
- 流水號以「同一第二層分類、同一購買日期」作為分組範圍。

修改檔案：

- `components/general-affairs/equipment/EquipmentCreatePageClient.tsx`
- `components/general-affairs/assets/AssetCategoryManagementClient.tsx`
- `scripts/test-general-affairs-asset-management-ui.js`
- `docs/GENERAL-AFFAIRS-UX-BLUEPRINT.md`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

UI / API / DB 影響：

- UI：
  - 新增設備頁的只讀資產編號預覽改為追溯所選分類的第二層分類 code。
  - 若只選第一層，提示需選第二層或其下層。
  - 若第二層 code 不符合 4 碼格式，例如 `IC01` / `AS01`，顯示明確提示。
  - 分類管理提示文字同步註記第二層 4 碼規格。
- API：
  - 未修改 equipment / facilities / categories API contract。
  - `asset_code` 仍送 `null`，不由前端產生正式流水號。
- DB：
  - 未新增 migration。
  - 未建立 asset code RPC / sequence。
  - 未執行 `db push`、`repair`、`reset` 或 rollback。

正式資產編號規格：

```text
{LEVEL_2_CATEGORY_CODE}{PURCHASE_DATE_YYYYMMDD}{SEQUENCE_3_DIGITS}
```

範例：

- 設備第三層「桌上型電腦」code = `IC0101`，其第二層「電腦設備」code = `IC01`；購買日期 `2026-07-29` 時，預覽為 `IC0120260729###`。
- 設施第三層「大門」code = `AS0101`，其第二層「門窗設施」code = `AS01`；購買日期 `2026-07-29` 時，預覽為 `AS0120260729###`。

測試結果：

```powershell
node --check scripts/test-general-affairs-asset-management-ui.js
node scripts/test-general-affairs-asset-management-ui.js
node scripts/test-general-affairs-ui-foundation.js
npx tsc --noEmit --pretty false
```

結果：

- `node --check scripts/test-general-affairs-asset-management-ui.js`：通過。
- `node scripts/test-general-affairs-asset-management-ui.js`：通過。
- `node scripts/test-general-affairs-ui-foundation.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。

尚未完成事項：

- 後續若要真正寫入正式 `asset_code`，仍需建立 forward migration：
  - 安全產號 RPC / helper。
  - 依第二層分類 code + date 分組的 3 碼流水。
  - 併發安全鎖定與 unique constraint。
  - 設備與設施是否共用同一產號 helper 仍需設計。

禁止事項：

- 不得再新增 `asset_code_prefix` 取代既有第二層分類 code，除非使用者重新批准改規格。
- 不得在前端直接產生並送出正式 `asset_code`。
- 不得修改已套用 migration。
- 不得連 Production。

### Task UI-4A 補充修正：新增設備分類選擇改為逐層選取

完成狀態：**本機 UI 修正完成；待人工 UI 複驗。**

更新時間：2026-07-29

任務目的：

- 使用者回報新增設備時，設備分類下拉列表因分類越來越多而難以選取。
- 本輪將新增設備表單的設備分類欄位由 flat select 改為逐層分類選取器。
- 本輪不修改 DB、migration、API contract、RLS 或 RPC。

修改檔案：

- `components/general-affairs/equipment/EquipmentCreatePageClient.tsx`
- `scripts/test-general-affairs-asset-management-ui.js`
- `docs/GENERAL-AFFAIRS-UX-BLUEPRINT.md`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

UI / API / DB 影響：

- UI：
  - 新增 `EquipmentCategoryPicker`。
  - 設備分類欄位先顯示第 1 層分類，選取後才顯示下一層。
  - 顯示「目前分類路徑」，降低使用者選錯分類的機率。
  - 支援「清除分類」回到未選狀態。
  - Template 選擇仍可自動帶入分類，選取器會依該分類顯示對應路徑。
- API：
  - 未修改 `/api/general-affairs/equipment` 或 categories API contract。
  - 仍送出既有 `category_id` 欄位。
- DB：
  - 未新增 migration。
  - 未執行 `db push`、`repair`、`reset` 或 rollback。

測試結果：

```powershell
node --check scripts/test-general-affairs-asset-management-ui.js
node scripts/test-general-affairs-asset-management-ui.js
node scripts/test-general-affairs-ui-foundation.js
npx tsc --noEmit --pretty false
```

結果：

- `node --check scripts/test-general-affairs-asset-management-ui.js`：通過。
- `node scripts/test-general-affairs-asset-management-ui.js`：通過。
- `node scripts/test-general-affairs-ui-foundation.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。

人工複驗重點：

- `/general-affairs/equipment/new` 基本資訊中的「設備分類」不應再是一長串下拉。
- 應先看到第 1 層分類。
- 點選第 1 層後，才看到第 2 層。
- 點選第 2 層後，才看到第 3 層。
- 目前分類路徑應顯示完整中文名稱與 code。
- 資產編號預覽仍依第二層分類 code 4 碼顯示。

禁止事項：

- 不得為此 UI 修正修改 equipment/category API contract。
- 不得修改已套用 migration。
- 不得連 Production。

### Task UI-4A：設備／設施子模組導覽、正式新增表單、圖片能力、資產編號與表單驗證收斂

完成狀態：**本機修正完成；待人工 UI 複驗。尚未標記 Task UI-4 Completed。**

更新時間：2026-07-29

任務背景：

- Task UI-4 人工驗收指出設備與設施管理仍把列表、分類、保固與維修紀錄塞在同一頁 tabs，未符合正式資訊架構。
- 新增設備需要獨立正式多步驟表單。
- 資產編號需由後端依分類與購置日期安全產生，不得在前端自行產生可能重複的流水號。
- 圖片上傳若缺 attachment / Storage / upload API，不得顯示假成功。

執行前安全狀態：

- `node scripts/verify-dev-supabase-environment.js`：passed，Project Ref `mjpd...mtqr`。
- `node scripts/verify-dev-supabase-cli-environment.js`：passed，Project Ref `mjpd...mtqr`。
- `npx supabase migration list`：16 筆 migration local / remote aligned，沒有 local-only、remote-only 或 unknown migration。
- 未執行 `db push`、`repair`、`reset`、rollback 或 Production 操作。

現況矩陣：

| 需求 | 現有 UI | 現有 API | 現有 DB 支援 | 本輪處理 | Migration |
| --- | --- | --- | --- | --- | --- |
| 設備子模組 routes | 原本在設備頁 tabs | equipment / categories / templates / maintenance API 可讀 | 既有設備主檔 | 已拆 route 與 sidebar children | 不需 |
| 設施子模組 routes | 原本在設施頁 tabs | facilities / categories / maintenance API 可讀 | 既有設施主檔 | 已拆 route 與 sidebar children | 不需 |
| 設備分類 CRUD | 原本只做分類視圖 | categories GET/POST/PATCH/DELETE | `ga_equipment_categories` | 已做分類樹 CRUD UI | 不需 |
| 設施分類 CRUD | 原本只做分類視圖 | categories GET/POST/PATCH/DELETE | `ga_facility_categories` | 已做分類樹 CRUD UI | 不需 |
| 設備圖片 | 只有 image_path 欄位/placeholder | 未找到正式 upload API | 未找到完整 attachment/storage 能力 | 顯示安全未開放 | 需要後續 forward migration / Storage setup |
| 資產編號自動產生 | 可手填或空值 | 無安全產號 RPC/helper | `asset_code` nullable + unique | 僅顯示後端產號預覽，不前端產號；預覽取第二層分類 code 4 碼 | 需要後續產號 RPC / sequence |
| 標籤列印預留 | 未收斂 | 無列印 API | 依賴正式 asset_code | disabled placeholder | asset_code 完成後再接 |
| 購買金額 | 欄位已存在 | equipment API 支援 | `purchase_amount` 已存在 | 新表單格式化顯示 | 不需 |
| 表單錯誤定位 | 分散 | 既有 validation | 不需 DB | 新增設備/設施表單已加入 | 不需 |

修改檔案：

- `components/general-affairs/navigation.tsx`
- `components/general-affairs/features.ts`
- `components/general-affairs/assets/AssetCategoryManagementClient.tsx`
- `components/general-affairs/assets/AssetMaintenanceHistoryClient.tsx`
- `components/general-affairs/equipment/EquipmentManagementClient.tsx`
- `components/general-affairs/equipment/EquipmentCreatePageClient.tsx`
- `components/general-affairs/equipment/EquipmentWarrantyClient.tsx`
- `components/general-affairs/facilities/FacilitiesClient.tsx`
- `components/general-affairs/facilities/FacilityCreatePageClient.tsx`
- `app/general-affairs/equipment/categories/page.tsx`
- `app/general-affairs/equipment/new/page.tsx`
- `app/general-affairs/equipment/warranties/page.tsx`
- `app/general-affairs/equipment/maintenance-history/page.tsx`
- `app/general-affairs/facilities/categories/page.tsx`
- `app/general-affairs/facilities/new/page.tsx`
- `app/general-affairs/facilities/maintenance-history/page.tsx`
- `scripts/test-general-affairs-asset-management-ui.js`
- `docs/GENERAL-AFFAIRS-UX-BLUEPRINT.md`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`
- `.github/copilot-instructions.md`
- `.gitignore`

UI 影響：

- 上方全站 Navbar：
  - 「總務服務中心」改為單一 `/general-affairs` 首頁入口。
  - 不再顯示所有總務功能 dropdown；進入總務服務中心後，使用內頁左側 Sidebar 選擇功能。
- 設備管理左側子模組：
  - 設備列表：`/general-affairs/equipment`
  - 設備分類：`/general-affairs/equipment/categories`
  - 保固管理：`/general-affairs/equipment/warranties`
  - 維修紀錄：`/general-affairs/equipment/maintenance-history`
- 設備管理父項目不直接導頁；點擊只展開上述四個子項目。
- 新增設備保留為設備列表頁主要操作，導向 `/general-affairs/equipment/new`，不放入 Sidebar。
- 設備範本已從 UI-4A 設備管理 Sidebar、設備列表頁 header、總務首頁與工作台快速入口移除；既有 route/API 檔案未刪除。
- 設施管理左側子模組：
  - 設施列表：`/general-affairs/facilities`
  - 設施分類：`/general-affairs/facilities/categories`
  - 維修紀錄：`/general-affairs/facilities/maintenance-history`
- 設施管理父項目不直接導頁；點擊只展開上述三個子項目。
- 新增設施保留為設施列表頁主要操作，導向 `/general-affairs/facilities/new`，不放入 Sidebar。
- 設備管理 / 設施管理父項目視覺應與普通 sidebar 項目同一行高與左側對齊；只以文字旁 `>` / 展開箭頭提示有子項目，不使用突兀的全寬父按鈕樣式。
- 設備與設施列表頁不再顯示分類 / 保固 / 維修主功能 tabs。
- 新增設備改為五階段正式表單：基本資訊、安裝資訊、保固資訊、其他資訊、完成確認。
- 新增設備表單包含欄位錯誤定位、購買金額格式化、未儲存離開提醒、圖片上傳未開放提示、資產編號後端產號預覽與標籤列印 placeholder。
- 分類管理頁提供 KPI、分類樹、展開收合、新增/編輯、啟用/停用、分類資產數、三層與防循環檢查。
- 保固管理只使用 `has_warranty` / `warranty_end_date`。
- 維修紀錄只讀既有 `/api/maintenance-requests`，並依 `equipment_id` 或 `facility_id` 篩選。

API / DB / RLS 影響：

- API contract：未修改。
- DB schema：未修改。
- Migration：未新增、未修改。
- RLS / RPC：未修改。
- Production：未操作。

測試結果：

```powershell
node --check scripts/test-general-affairs-asset-management-ui.js
node scripts/test-general-affairs-asset-management-ui.js
node scripts/test-general-affairs-ui-foundation.js
node scripts/test-general-affairs-role-matrix-dev.js
node scripts/test-general-affairs-maintenance-views.js
node scripts/test-general-affairs-maintenance-ui.js
npx tsc --noEmit --pretty false
npm run build
git diff --check
```

結果：

- `node --check scripts/test-general-affairs-asset-management-ui.js`：通過。
- `node scripts/test-general-affairs-asset-management-ui.js`：通過。
- `node scripts/test-general-affairs-ui-foundation.js`：通過。
- `node scripts/test-general-affairs-role-matrix-dev.js`：通過。
- `node scripts/test-general-affairs-maintenance-views.js`：通過。
- `node scripts/test-general-affairs-maintenance-ui.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過。過程中曾因 stale `.next` route manifest 出現 `PageNotFoundError`，已隔離舊 `.next` 後重跑通過；仍有既有 `DYNAMIC_SERVER_USAGE` 訊息，非本輪 failure。
- `git diff --check`：通過；只有既有 CRLF warning。

發現問題：

- `ga_resource_attachments` / Storage bucket / upload API / attachment policy 尚未完整可用，設備圖片不能在本輪完成正式上傳。
- 資產編號自動產生的前綴規格已定案為實際第二層分類 code 4 碼；仍缺安全產號 RPC / sequence 與併發控制。
- `scripts/test-general-affairs-work-order-center-ui.js` 仍不存在，無法執行該指定 regression。
- Build 會重建 `.next`；若 `next dev` 同時在跑，build 後需要重啟 dev server，避免 dev route 暫時 chunk missing。

尚未完成事項：

- Task UI-4A 需要人工 UI 複驗。
- 尚未建立 asset code forward migration。
- 尚未建立附件 / Storage forward migration。
- 尚未開始 UI-5。

下一個最小任務：

**人工複驗 Task UI-4A：設備／設施子模組導覽與正式新增表單。**

人工複驗重點：

- 設備管理左側點擊後只展開設備列表、設備分類、保固管理、維修紀錄。
- 設備管理父項目視覺需與其他功能名稱對齊，只顯示展開箭頭。
- `/general-affairs/equipment` 不再顯示分類 / 保固 / 維修 tabs。
- 設備列表頁可用「新增設備」進入 `/general-affairs/equipment/new`；五階段表單可用，圖片上傳與資產流水顯示安全未開放。
- 設備分類與設施分類能新增、編輯、啟用/停用，且分類樹正確。
- 設施管理左側點擊後只展開設施列表、設施分類、維修紀錄。
- 設施管理父項目視覺需與其他功能名稱對齊，只顯示展開箭頭。
- view-only 不顯示新增入口；manage 顯示新增/編輯/停用。
- desktop / mobile active state 仍只會有一個 nav item active。

禁止事項：

- 不得標記 Task UI-4 Completed，直到人工複驗通過。
- 不得開始 UI-5。
- 不得新增或修改 migration。
- 不得 db push、repair、reset、rollback。
- 不得操作 Production。
- 不得在前端自行產生正式 asset_code 流水號。
- 不得顯示假圖片上傳成功。

### Task UI-4：設備與設施管理 UI / 資訊架構重構

完成狀態：**本機實作與技術驗證完成；待人工 UI 驗收，尚未標記 Completed。**

更新時間：2026-07-29

任務目的：

- 測試區設備管理與設施管理原本只有可用但偏簡單的主檔列表與新增 Drawer，資訊架構與正式總務資產管理頁面差距較大。
- 本輪先把設備與設施頁升級為一致的正式資產管理 UI：KPI、頁籤、分類視圖、保固 / 維修視圖、詳情面板、桌面表格與 mobile 卡片。
- 本輪不得修改 DB、migration、RLS、RPC 或 API contract；所有畫面只能讀既有 API 與既有欄位，不得顯示假資料或未建置流程的可操作入口。

修改檔案：

- `components/general-affairs/assets/AssetManagementUI.tsx`
- `components/general-affairs/equipment/EquipmentManagementClient.tsx`
- `components/general-affairs/facilities/FacilitiesClient.tsx`
- `components/general-affairs/navigation.tsx`
- `scripts/test-general-affairs-asset-management-ui.js`
- `docs/GENERAL-AFFAIRS-UX-BLUEPRINT.md`
- `docs/DEV-RBAC-HANDOFF.md`
- `docs/CURRENT-DEV-STATUS.md`
- `.github/copilot-instructions.md`

UI 影響：

- `/general-affairs/equipment`
  - 使用 `GeneralAffairsPageHeader`、`GeneralAffairsListPage` 與新的 shared asset UI。
  - 新增 KPI：設備總數、使用中、需留意狀態、保固需確認。
  - 新增頁籤：設備列表、分類視圖、保固追蹤、維修歷程。
  - 篩選列支援搜尋、門市、分類、狀態與保固篩選。
  - 桌面版顯示密集設備表格；mobile 顯示設備卡片。
  - 右側詳情面板顯示設備基本資料、保固摘要與維修歷程。
  - 新增 / 編輯設備表單改為分段式正式表單，仍呼叫既有 equipment API。
  - 設備範本入口仍指向既有 `/general-affairs/equipment/templates`。
- `/general-affairs/facilities`
  - 使用同一套 shared asset UI。
  - 新增 KPI：設施總數、使用中、需處理、固定資產、高重要度。
  - 新增頁籤：設施列表、分類視圖、維修歷程。
  - 篩選列支援搜尋、門市、分類、狀態與區域。
  - 桌面版顯示密集設施表格；mobile 顯示設施卡片。
  - 右側詳情面板顯示設施基本資料、狀態摘要與維修歷程。
  - 新增 / 編輯設施表單改為分段式正式表單，仍呼叫既有 facilities API。
- `components/general-affairs/navigation.tsx`
  - 保留「新增回報」在「我的回報」前方。
  - 將「我的回報」nav id 回復為 `maintenance`，以符合角色矩陣測試與維修模組 canonical permission contract。

API / DB / RLS 影響：

- API：未新增、未修改 contract。
- DB：未新增 migration，未執行 `db push`、`migration repair`、`db reset` 或 rollback。
- RLS / RPC：未修改。
- Production：未操作。
- 維修歷程只讀既有 `/api/maintenance-requests?store_id=...&pageSize=100`，並只用 `equipment_id` / `facility_id` 關聯。若 API 或欄位不可讀，顯示安全不可讀訊息，不顯示假維修紀錄。
- 設備保固只用 `has_warranty` 與 `warranty_end_date`；不顯示尚未建置的保固文件、供應商、採購或附件流程。
- 設施頁不顯示尚未建置的巡檢、保養排程、廠商、費用、附件或維修合約流程。

測試與檢查結果：

```powershell
node --check scripts/test-general-affairs-asset-management-ui.js
node scripts/test-general-affairs-asset-management-ui.js
node scripts/test-general-affairs-ui-foundation.js
node scripts/test-general-affairs-maintenance-views.js
node scripts/test-general-affairs-maintenance-ui.js
node scripts/test-general-affairs-dashboard-ui.js
node scripts/test-general-affairs-role-matrix-dev.js
npx tsc --noEmit --pretty false
```

結果：

- UI-4 asset management static test：通過。
- UI foundation regression：通過。
- Maintenance views regression：通過。
- Maintenance UI regression：通過。
- Dashboard regression：通過。
- Role matrix regression：通過。
- TypeScript：通過。
- Build：通過；仍有既有 `DYNAMIC_SERVER_USAGE` 訊息，非本輪 failure。
- `git diff --check`：通過；只有既有 CRLF warning。
- `scripts/test-general-affairs-work-order-center-ui.js`：repo 目前不存在，因此未執行。
- 人工 UI 驗收尚待執行。

人工 UI 驗收建議：

- 設備管理：
  - 可看到 Breadcrumb、Page Header、KPI、頁籤、篩選列、設備表格與右側詳情。
  - 設備列表、分類視圖、保固追蹤、維修歷程切換正常。
  - 新增 / 編輯設備仍可儲存。
  - soft delete 仍要求原因。
  - 保固追蹤只顯示真實主檔欄位，不顯示未建置的保固文件或廠商流程。
  - mobile 以卡片呈現，不產生水平 overflow。
- 設施管理：
  - 可看到 Breadcrumb、Page Header、KPI、頁籤、篩選列、設施表格與右側詳情。
  - 設施列表、分類視圖、維修歷程切換正常。
  - 新增 / 編輯設施仍可儲存。
  - soft delete 仍要求原因。
  - 不顯示未建置的巡檢、保養排程、廠商、費用或附件流程。
  - mobile 以卡片呈現，不產生水平 overflow。

發現問題：

- 維修歷程依賴 `maintenance_requests` 是否回傳 `equipment_id` / `facility_id`。若現有資料尚未填這些欄位，頁面會顯示沒有已連結紀錄，而不會用標題或描述猜測。
- 本輪只重構設備與設施；料件與庫存已保留既有頁面，後續若要完全統一四組主檔與庫存語言，可再進一步收斂 parts / inventory 表格與表單。

下一個最小任務：

**人工驗收 Task UI-4：設備管理與設施管理 UI / IA 重構。**

通過後才能由使用者決定是否正式標記 Task UI-4 Completed，或進入 UI-5 / 料件正式流程。

禁止事項：

- 不得修改已套用 migration。
- 不得為 UI-4 補任何 DB schema、RLS、RPC 或 API contract。
- 不得顯示假保固、假維修紀錄、假巡檢、假保養或假廠商流程。
- 不得開始 UI-5、正式料件申請、附件、採購、調撥、盤點或工單扣料，除非使用者明確批准。

### Task UI-3B Follow-up：店長視角「我的回報」導覽入口修正

完成狀態：**本機實作、靜態測試、TypeScript 與 build 完成；待使用者人工複驗。**

更新時間：2026-07-28

任務目的：

- 人工驗收回報測試區店長視角看不到明確的「我的回報」入口。
- 根因是總務 Sidebar 只有「維修回報」入口，且 `/general-affairs?section=maintenance` 對具備 create permission 的帳號會預設開啟新增回報表單。
- 店長需要能直接進入「我的回報」工單追蹤列表，新增回報則應是另一個明確入口。

修改檔案：

- `components/general-affairs/navigation.tsx`
- `components/general-affairs/service-center/GeneralAffairsServiceCenterClient.tsx`
- `scripts/test-general-affairs-maintenance-views.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

API / UI / DB 影響：

- DB：未修改 schema、migration、RLS、RPC；未執行 `db push`、repair、reset 或 rollback。
- API：未修改 API contract。
- UI：
  - Sidebar「我的申請」新增明確 `我的回報` 入口。
  - `我的回報` href 為 `/general-affairs?section=maintenance&view=mine`。
  - `新增回報` href 為 `/general-affairs?section=maintenance&view=new`。
  - `/general-affairs` 服務中心已支援 `view=mine` query；有新增權限的帳號點「我的回報」時會進入追蹤列表，不再被預設帶到新增表單。
  - 沒有新增權限的帳號進入 `section=maintenance` 仍會落在 `mine`，不會看到不可用的新增表單。

權限與安全：

- 導覽仍使用 effective permissions 與既有 `GA_MAINTENANCE_MODULE_CODES` / `GA_MAINTENANCE_REQUEST_CREATE_CODES`。
- 前端入口只改善 UX，不取代 `/api/maintenance-requests` 的 server-side permission guard、store scope 與 RLS。
- 未使用 email、role name、職稱或 `profiles.role` 判斷店長視角。

測試結果：

```powershell
node --check scripts/test-general-affairs-maintenance-views.js
node scripts/test-general-affairs-maintenance-views.js
node scripts/test-general-affairs-ui-foundation.js
npx tsc --noEmit --pretty false
npm run build
git diff --check -- components/general-affairs/navigation.tsx components/general-affairs/service-center/GeneralAffairsServiceCenterClient.tsx scripts/test-general-affairs-maintenance-views.js
```

結果：

- `node --check scripts/test-general-affairs-maintenance-views.js`：通過。
- `node scripts/test-general-affairs-maintenance-views.js`：通過。
- `node scripts/test-general-affairs-ui-foundation.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過；仍有既有 `DYNAMIC_SERVER_USAGE` 訊息，非 build failure。
- `git diff --check`：通過。

尚未完成事項：

- 待人工複驗：店長 / 督導登入後，Sidebar「我的申請」可看到「我的回報」，點擊後直接進入我的回報列表。
- 待人工複驗：具備新增權限者仍可點「新增回報」進入新增表單。
- Task UI-3 尚未正式 Completed。

下一個最小任務：

**人工複驗店長視角「我的回報」入口。通過後，再判定 Task UI-3B 是否可進入結案或下一個 UI-3 收斂項目。**

禁止事項：

- 不得為入口修正新增 migration。
- 不得改 API / RLS 來取代導覽修正。
- 不得開始正式料件申請、附件或工單扣料流程，除非使用者明確批准。

### GA-RBAC-1：總務維修回報 / 工單中心權限代碼拆分

完成狀態：**已正式推送 DEV；靜態測試、TypeScript 與 build 通過；待動態 / 人工複驗。**

更新時間：2026-07-27

任務目的：

- 使用者確認總務服務中心不應共用跨部門管理的 `cross_dept.maintenance.*` 權限碼。
- 將總務維修回報、暫行料件申請與工單中心入口改為使用總務專用 permission codes。
- 保留跨部門維修頁自身的 `cross_dept.maintenance.*` 權限，不破壞既有正式跨部門維修功能。
- 因目前維修 / 工單仍使用 legacy `maintenance_*` 共用資料表，API 與 RLS 需在 shared legacy 層同時接受總務新碼與跨部門舊碼。

新增 / 使用的總務專用 permission codes：

- `general_affairs.maintenance_request.create`
- `general_affairs.maintenance_request.view_own_store`
- `general_affairs.maintenance_request.view_all`
- `general_affairs.maintenance_request.update`
- `general_affairs.work_order.view_own_store`
- `general_affairs.work_order.view_all`
- `general_affairs.work_order.update`
- `general_affairs.work_order.manage`

修改檔案：

- `lib/general-affairs/maintenance-permissions.ts`
- `hooks/useNavbarPermissions.ts`
- `components/general-affairs/navigation.tsx`
- `app/general-affairs/page.tsx`
- `app/api/maintenance-requests/route.ts`
- `app/api/maintenance-requests/summary/route.ts`
- `app/api/maintenance-photos/route.ts`
- `app/api/maintenance-updates/route.ts`
- `app/api/maintenance-update-photos/route.ts`
- `app/api/maintenance-ticket-events/route.ts`
- `app/api/maintenance-categories/route.ts`
- `app/api/maintenance-progress-stages/route.ts`
- `lib/maintenance/status-service.ts`
- `scripts/test-general-affairs-role-matrix-dev.js`
- `scripts/test-general-affairs-maintenance-ui.js`
- `scripts/test-general-affairs-availability.js`
- `supabase/migrations/20260727015132_dev_general_affairs_role_matrix_permissions.sql`（已推送 DEV）
- `supabase/migrations/20260727021000_general_affairs_maintenance_work_order_permission_split.sql`（已推送 DEV）
- `docs/DEV-RBAC-HANDOFF.md`
- `docs/CURRENT-DEV-STATUS.md`
- `.github/copilot-instructions.md`

API / UI / DB 影響：

- UI：
  - 總務服務中心維修回報、我的料件申請、暫行新增料件申請與工單中心導覽，改吃 `general_affairs.maintenance_request.*` / `general_affairs.work_order.*`。
  - `/general-affairs` 頁面自己的 `checkPermission()` 已不再直接檢查 `cross_dept.maintenance.*`。
  - `useNavbarPermissions` 的 `canAccessGeneralAffairsMaintenance` / `canAccessGeneralAffairsWorkOrders` 改為 server-side effective permissions 集合中的總務新碼。
- API：
  - legacy `/api/maintenance-*` route guard 增加總務新碼相容。
  - 跨部門維修頁仍可用舊 `cross_dept.maintenance.*` 呼叫 shared legacy APIs。
  - 維修分類 / 進度階段的讀取允許總務新碼；分類 / 階段管理仍保留既有 category edit 權限，未在本輪擴大。
- DB：
  - 新增並已推送 forward migration `20260727021000_general_affairs_maintenance_work_order_permission_split.sql`。
  - 該 migration 只建立 permission reference data 並刷新 legacy maintenance RLS policy，讓 shared legacy tables 同時接受總務新碼與跨部門舊碼。
  - 不建立新業務表、不修改欄位、不修改 RPC、不修改已套用 migration。
- DEV role seed：
  - `20260727015132_dev_general_affairs_role_matrix_permissions.sql` 已推送，已同步改為指派總務新碼。
  - 這支 DEV-only seed 不依 email、不建立 Auth users、不授予 vendor 權限、不再給總務 DEV 角色 `cross_dept.maintenance.*`。

測試與 build 結果：

```powershell
node --check scripts/test-general-affairs-role-matrix-dev.js
node --check scripts/test-general-affairs-maintenance-ui.js
node --check scripts/test-general-affairs-availability.js
node scripts/test-general-affairs-role-matrix-dev.js
node scripts/test-general-affairs-maintenance-ui.js
node scripts/test-general-affairs-availability.js
npx tsc --noEmit --pretty false
npm run build
git diff --check
```

結果：

- 三個 `node --check`：通過。
- `node scripts/test-general-affairs-role-matrix-dev.js`：通過。
- `node scripts/test-general-affairs-maintenance-ui.js`：通過。
- `node scripts/test-general-affairs-availability.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過；只有既有 `DYNAMIC_SERVER_USAGE` 訊息，非本輪 failure。
- `git diff --check`：通過；只有既有 CRLF warning。
- App DEV Guard：通過。
- CLI DEV Guard：通過。
- Push 前 `npx supabase migration list`：14 筆已對齊，只有 `20260727015132` 與 `20260727021000` local-only。
- `npx supabase db push --dry-run`：只列 `20260727015132_dev_general_affairs_role_matrix_permissions.sql` 與 `20260727021000_general_affairs_maintenance_work_order_permission_split.sql`。
- `npx supabase db push`：成功套用上述兩筆。
- Push 後 `npx supabase migration list`：16 筆 local / remote aligned。
- `SUPABASE_DB_PASSWORD`：未設定 / 無殘留。

發現問題：

- 維修 / 工單底層仍是 legacy `maintenance_*` 共用表；因此 RLS 需同時支援跨部門舊碼與總務新碼。
- 正式料件申請流程尚未獨立，目前 `part_requests_temporary` 仍是 maintenance-backed 暫行流程。
- `20260727015132` 與 `20260727021000` 已套用 DEV；尚未做瀏覽器人工複驗。

尚未完成事項：

- 尚未執行 GA-RBAC-1 migration 後的動態 RLS / API / UI 複驗。
- 尚未把四個人工 DEV 角色實際調整到新碼後做瀏覽器人工驗收。
- 尚未開始正式料件申請 DB / API / UI。

下一個最小任務：

**GA-RBAC-1 動態與人工複驗。**

建議複驗：

1. 角色權限管理可看到 `general_affairs.maintenance_request.*` 與 `general_affairs.work_order.*`。
2. `dev-ga-access@example.test` / 店長可看到總務維修回報與暫行料件申請入口，但不可看到全域工單管理能力。
3. `dev-ga-view@example.test` / 督導可看到總務維修回報與暫行料件申請入口，資料範圍仍依 `store_managers` / API / RLS。
4. `dev-ga-manage@example.test` / 總務可看到維修回報、工單中心與相關管理操作。
5. 跨部門維修頁仍可使用 `cross_dept.maintenance.*`。
6. GA 頁面與導覽不得因舊 `cross_dept.maintenance.*` 指派而顯示總務維修 / 工單入口。

禁止事項：

- 不得修改已套用 migration。
- 不得 repair / reset / rollback。
- 不得連 Production。
- 不得用 `cross_dept.maintenance.*` 當作總務角色配置來源。
- 不得為了完成本輪臨時建立正式料件申請表。

### RBAC 角色頁使用者清單：姓名來源一致性修正

完成狀態：**本機實作、靜態測試完成；待使用者人工複驗。**

更新時間：2026-07-27

任務目的：

- 使用者回報：在「角色權限管理 / 角色詳情 / 使用者管理」中，`dev-ga-access@example.test` 已在使用者管理編輯為姓名 `門市店長`、部門 `營業部`、職稱 `店長`、帳號身分 `主管`，但角色頁仍顯示舊姓名 `DEV 總務入口使用者`。
- 根因：角色頁 GET API 在合併 `profiles` 與 `store_employees` 時，曾優先使用 `store_employees.employee_name`；新增角色使用者搜尋 API 也直接顯示 `get_all_employees_for_rbac()` 回傳的 `employee_name`。在正式相容資料存在時，舊員工姓名可能覆蓋使用者管理維護的 `profiles.full_name`。
- 正式規則：使用者管理維護的 `profiles.full_name` 是 RBAC 管理介面顯示姓名第一順位；`store_employees.employee_name` 只能作為正式相容 / 舊資料備援。

修改檔案：

- `app/api/roles/[id]/users/route.ts`
- `app/api/users/search/route.ts`
- `scripts/test-rbac-role-user-assignment-display.js`
- `scripts/test-rbac-formal-management-flow.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

API / UI / DB 影響：

- API：
  - `GET /api/roles/[id]/users` 的 `users[].name` 改為優先使用 `profiles.full_name`，再 fallback 至 `store_employees.employee_name`。
  - `POST /api/roles/[id]/users` 的重複/跳過提示中，使用者名稱也改為優先使用 `profiles.full_name`。
  - `GET /api/users/search` 仍使用 `get_all_employees_for_rbac()` 做授權後員工搜尋，但會再以 server admin client 讀取對應 `profiles.full_name`，搜尋結果 `name` 優先顯示使用者管理姓名。
- UI：
  - 不需改動角色頁表格 component；資料來源修正後，現有 `name` 欄位即可顯示正確姓名。
- DB：
  - 無 migration。
  - 無 DB schema / RLS / RPC / grants 變更。
  - 無 `db push`、repair、reset、rollback。

測試與檢查結果：

```powershell
node --check scripts/test-rbac-role-user-assignment-display.js
node scripts/test-rbac-role-user-assignment-display.js
node --check scripts/test-rbac-formal-management-flow.js
node scripts/test-rbac-formal-management-flow.js
```

結果：

- `node --check scripts/test-rbac-role-user-assignment-display.js`：通過。
- `node scripts/test-rbac-role-user-assignment-display.js`：通過。
- `node --check scripts/test-rbac-formal-management-flow.js`：通過。
- `node scripts/test-rbac-formal-management-flow.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過；首次 build 遇到本機 `.next` generated 產物殘留造成 `/_document` 找不到，清除本專案 `.next` 後重跑通過。仍有既有 `DYNAMIC_SERVER_USAGE` 訊息，非本輪 failure。
- `git diff --check`：通過；只有既有 CRLF warning。

人工複驗重點：

- 進入角色權限管理某角色的「使用者管理」分頁。
- 找到 FK002 / `dev-ga-access@example.test`。
- 預期顯示：
  - 姓名：`門市店長`
  - 部門：`營業部`
  - 職稱：`店長`
  - 帳號身分：`主管`
  - 角色狀態：`啟用`
- 點擊「新增使用者」並搜尋 FK002 或該帳號時，搜尋結果也應顯示 `門市店長`，不得顯示舊的 `DEV 總務入口使用者`。

發現問題：

- `store_employees` 是正式相容資料表，仍可支援舊正式流程，但不應蓋掉 RBAC 使用者管理維護的姓名。
- `profiles.role` 仍只作為相容帳號身分顯示，不可作為新功能唯一權限來源。

尚未完成事項：

- 需要使用者人工複驗角色頁與新增使用者搜尋結果。
- Task UI-3A role matrix migration `20260727015132_dev_general_affairs_role_matrix_permissions.sql` 仍是 local-only，尚未批准 push。

下一個最小任務：

**人工複驗角色頁與新增使用者搜尋結果的姓名是否都以使用者管理欄位為準。複驗通過後，再回到原本關鍵節點：批准正式 DEV push，只推送 `20260727015132_dev_general_affairs_role_matrix_permissions.sql`。**

禁止事項：

- 不得為顯示姓名修正建立 migration。
- 不得修改已套用 migration。
- 不得直接改 remote schema。
- 不得用 email、role name 或職稱文字硬判斷權限。
- 不得連 Production。

### Navbar 每月人員狀態 effective permission 顯示修正

完成狀態：**本機實作、靜態測試完成；待使用者人工複驗。**

更新時間：2026-07-27

任務目的：

- 使用者回報：已在角色權限管理勾選門市店長角色的 `monthly.status.view_own`、`monthly.status.view_all` 等每月人員狀態權限，但 `dev-ga-access@example.test` 登入後仍看不到「每月人員狀態」模組。
- 既有 Navbar 判斷條件已包含 `monthly.status.view_own` 與 `monthly.status.view_all`，但 `useNavbarPermissions` 主要依賴瀏覽器端直接查 `user_roles -> role_permissions -> permissions`。若受 RLS、join shape 或 legacy RPC 回空影響，導覽可能漏掉已指派的 effective permissions。

修改檔案：

- `hooks/useNavbarPermissions.ts`
- `lib/permissions/check.ts`
- `scripts/test-rbac-formal-management-flow.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

API / UI / DB 影響：

- API：
  - `/api/permissions/user` 沿用既有 route，但底層 `getUserPermissions()` 補上 server-side formal RBAC fallback。
  - 若 legacy `get_user_permissions` RPC 回傳空或失敗，server 端會以 admin client 從 `user_roles -> roles -> role_permissions -> permissions` 計算 effective permission codes。
  - admin-like 使用者會回傳 active permissions 作為相容全權限清單。
- UI：
  - `useNavbarPermissions` 仍保留原本 direct RBAC 查詢取得 role code 相容資訊。
  - 新增合併 `/api/permissions/user` 的 server-side effective permission codes 到同一個 `permissionSet`。
  - `canViewMonthlyStatus` 仍由 `monthly.status.view_own` 或 `monthly.status.view_all` 控制。
- DB：
  - 無 migration。
  - 無 DB schema / RLS / RPC / grants 變更。
  - 無 `db push`、repair、reset、rollback。

測試與檢查結果：

```powershell
node --check scripts/test-rbac-formal-management-flow.js
node scripts/test-rbac-formal-management-flow.js
node --check scripts/test-rbac-role-user-assignment-display.js
node scripts/test-rbac-role-user-assignment-display.js
```

結果：

- `node --check scripts/test-rbac-formal-management-flow.js`：通過。
- `node scripts/test-rbac-formal-management-flow.js`：通過。
- `node --check scripts/test-rbac-role-user-assignment-display.js`：通過。
- `node scripts/test-rbac-role-user-assignment-display.js`：通過。
- `npm run test:rbac-safe-preflight`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過；仍有既有 `DYNAMIC_SERVER_USAGE` 訊息，非本輪 failure。
- `git diff --check`：通過；只有既有 CRLF warning。

人工複驗重點：

- 確認門市店長角色或 `dev-ga-access@example.test` 的有效權限包含下列任一：
  - `monthly.status.view_own`
  - `monthly.status.view_all`
- 以 `dev-ga-access@example.test` 登入 DEV。
- 預期上方導覽顯示「每月人員狀態」模組。
- 點入 `/monthly-status` 後，資料範圍仍由原有 page action / API / RBAC 控制；Navbar 顯示不可取代後端安全。

發現問題：

- Navbar 權限過去有部分 direct client RBAC join，容易和正式 server-side RBAC 計算來源不一致。
- 之後新增導覽入口時，應優先使用 server-side effective permissions 或既有 permission check API，不應只靠 client direct table join。

尚未完成事項：

- 需要使用者人工複驗 dev-ga-access 的「每月人員狀態」導覽入口。
- Task UI-3A role matrix migration `20260727015132_dev_general_affairs_role_matrix_permissions.sql` 仍是 local-only，尚未批准 push。

下一個最小任務：

**人工複驗 `dev-ga-access@example.test` 登入後是否可看到「每月人員狀態」。若通過，再回到原本關鍵節點：批准正式 DEV push，只推送 `20260727015132_dev_general_affairs_role_matrix_permissions.sql`。**

禁止事項：

- 不得為 Navbar 權限顯示修正建立 migration。
- 不得修改已套用 migration。
- 不得直接改 remote schema。
- 不得用 email、role name 或職稱文字硬判斷權限。
- 不得連 Production。

### RBAC 角色頁使用者清單：Profile 基本資料顯示修正

完成狀態：**本機實作、靜態測試、TypeScript 與 build 完成；待使用者人工複驗。**

更新時間：2026-07-27

任務目的：

- 使用者在測試區角色權限管理中，將 `dev-ga-access@example.test` / `FK002` 指派到角色後，角色詳情頁的「使用者管理」分頁只顯示 Email、姓名、員工編號、角色指派狀態與指派日期。
- 但同一位使用者在「使用者管理」已維護為：部門 `營業部`、職稱 `店長`、帳號身分 `主管`。
- 原因是 `/api/roles/[id]/users` 只讀取 `profiles.id/email/full_name/employee_code`，角色頁表格也沒有顯示 `department`、`job_title`、`profiles.role`。

修改檔案：

- `app/api/roles/[id]/users/route.ts`
- `app/admin/roles/[id]/RoleEditClient.tsx`
- `scripts/test-rbac-role-user-assignment-display.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

API / UI / DB 影響：

- API：
  - `/api/roles/[id]/users` 的 GET 回傳新增：
    - `department`
    - `job_title`
    - `profile_role`
  - 資料來源仍為既有 `profiles`，沒有新增資料表或改 schema。
  - 角色指派與移除 API contract 不變。
- UI：
  - `/admin/roles/[id]` 的「使用者管理」表格新增：
    - 部門
    - 職稱
    - 帳號身分
    - 角色狀態
  - 原本「狀態」欄改成「角色狀態」，明確表示這是 `user_roles.is_active`。
  - `profiles.role = manager` 會顯示為 `主管`，避免與角色指派狀態混淆。
- DB：
  - 未新增 migration。
  - 未執行 `db push`、`migration repair`、`db reset` 或 rollback。

測試與 build 結果：

```powershell
node --check scripts/test-rbac-role-user-assignment-display.js
node scripts/test-rbac-role-user-assignment-display.js
npx tsc --noEmit --pretty false
npm run build
git diff --check
```

結果：

- `node --check scripts/test-rbac-role-user-assignment-display.js`：通過。
- `node scripts/test-rbac-role-user-assignment-display.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過；仍有既有 `DYNAMIC_SERVER_USAGE` 訊息，非 build failure。
- `git diff --check`：通過；只有既有 CRLF warning。

發現問題：

- 角色頁先前把「角色指派狀態」呈現為「狀態」，容易讓使用者以為那是帳號身分。
- `profiles.role` 仍是 legacy compatibility 欄位；正式 RBAC 權限來源仍應以 `user_roles` / `role_permissions` / `permissions` 為準。

尚未完成事項：

- 需要人工複驗：
  - 進入角色權限管理。
  - 開啟含 FK002 的角色。
  - 到「使用者管理」分頁。
  - 確認 `dev-ga-access@example.test` 顯示：
    - 員工編號：`FK002`
    - 部門：`營業部`
    - 職稱：`店長`
    - 帳號身分：`主管`
    - 角色狀態：`啟用`

下一個最小任務：

**人工複驗角色頁使用者清單顯示是否與使用者管理一致。**

通過後再回到原本關鍵節點：批准正式 DEV push，只推送 `20260727015132_dev_general_affairs_role_matrix_permissions.sql`。

禁止事項：

- 不得用 `profiles.role` 取代正式 RBAC 權限來源。
- 不得新增第二套角色 / 權限資料表。
- 不得修改已套用 migration。
- 不得直接操作 Production。

### Task UI-3A：一般人員、店長、督導、總務角色權限與導覽收斂

完成狀態：**部分完成，尚未 Completed。**

更新時間：2026-07-27

任務背景：

- Task UI-3 人工驗收期間發現角色與權限矩陣尚未正式收斂。
- 需要先釐清一般人員、店長、督導、總務四種業務角色在總務服務中心的功能入口、API guard 與 store scope。
- 本輪不允許用 email、角色名稱、職稱文字或 `profiles.role` 當作新權限來源，也不允許修改已套用 migration 或直接改 remote schema。

執行前安全狀態：

- App DEV Guard：passed，Project Ref `mjpd...mtqr`。
- CLI DEV Guard：passed，Project Ref `mjpd...mtqr`。
- `npx supabase migration list`：14 筆 migration local / remote aligned，沒有 local-only、remote-only 或 unknown migration。
- 本輪未設定 `SUPABASE_DB_PASSWORD`，未執行 `db push`、`migration repair`、`db reset`、rollback 或 Production 操作。

修改檔案：

- `components/general-affairs/navigation.tsx`
- `hooks/useNavbarPermissions.ts`
- `app/general-affairs/page.tsx`
- `scripts/test-general-affairs-role-matrix-dev.js`
- `docs/DEV-RBAC-HANDOFF.md`
- `docs/CURRENT-DEV-STATUS.md`

已完成修正：

- 維修回報、我的料件申請暫行入口、工單中心改用 `cross_dept.maintenance.submit`、`cross_dept.maintenance.view_all`、`cross_dept.maintenance.update` 等正式維修權限碼，不再只靠 `general_affairs.service_center.access`。
- 暫行料件申請仍明確標示為 maintenance-backed flow，會導向 `resource_type = material` 的維修回報流程；本輪沒有新增正式 `general_affairs.part_request.*` 權限碼或資料表。
- 廠商列表、服務分類、服務區域與合作統計入口已從 `general_affairs.service_center.access` 拆開，改為期待正式廠商相關 permission codes。
- `hooks/useNavbarPermissions.ts` 的 `canAccessGeneralAffairsVendors` 不再由 service center access 或 general affairs service flag 推導。
- `/general-affairs` 舊首頁新增 `canAccessVendors` 狀態與查詢條件，廠商區塊不再被 service access 帶開。
- `/general-affairs` 舊首頁的設備、設備範本、設施、料件、庫存入口改回各自正式 permission codes，不再被維修 `view_all` 或 `update` 權限帶開。
- `scripts/test-general-affairs-role-matrix-dev.js` 建立 UI-3A 靜態驗證，固定檢查 role matrix fixture、maintenance API guard、part request 暫行語意、vendor 導覽、store scope、planned feature 不可點與 no email / role-name authorization。

目前四種業務角色目標矩陣：

- 一般人員：不應看到總務服務中心；沒有總務有效權限。
- 店長：可進總務服務中心，可新增維修 / 暫行料件申請；資料範圍依 `store_managers` 自己門市；不可管理廠商、庫存交易或全域工單。
- 督導：可進總務服務中心，可查看自己管理區 / 指派門市範圍的設備、設施、庫存與相關維修資料；不可管理廠商、庫存交易或全域工單。
- 總務：可進總務服務中心，可管理維修工單、設備、設施、料件、庫存與廠商；不等同 full admin，不應自動取得 RBAC 管理、強制結案或系統管理權限。

已知 DEV 帳號與目前狀態：

- `dev-no-ga@example.test`：預期一般人員，無總務 effective permission。
- `dev-ga-access@example.test`：目前只有 `general_affairs.service_center.access` 與門市 scope；若要扮演店長，仍需補正式維修 submit 權限與 store scope 驗證。
- `dev-ga-view@example.test`：目前有部分 category / inventory location view 權限與多門市 scope；若要扮演督導，仍需補維修 submit、設備 / 設施 / 庫存 read 權限矩陣。
- `dev-ga-manage@example.test`：目前已有多項總務主檔 / 庫存權限；若要扮演總務，仍需補正式廠商權限碼與維修 view/update 權限矩陣。

阻擋與分類：

- **missing permission code**：目前 SQL 中尚未找到 `general_affairs.vendor.view`、`general_affairs.vendor.manage`、`general_affairs.service_category.view`、`general_affairs.service_category.manage`、`general_affairs.service_region.view`、`general_affairs.service_region.manage`、`general_affairs.cooperation_record.view`。
- **RLS mismatch**：`ga_vendors`、`ga_service_categories`、`ga_service_regions` 的既有 RLS 仍使用 `current_user_has_permission('general_affairs.service_center.access')`，會讓只具總務入口權限的帳號看到或操作尚未授權的廠商資料。
- **role permission seed pending**：店長、督導、總務 DEV 測試角色的 `role_permissions` 尚未依批准矩陣更新。
- **dynamic validation pending**：四個 DEV 帳號的密碼式動態驗收尚未在 UI-3A 後重跑。

下一個最小任務：

**批准建立 UI-3A forward migration。**

建議內容：

- 新增正式廠商相關 permission codes。
- 將 `ga_vendors`、`ga_service_categories`、`ga_service_regions` RLS 從 `general_affairs.service_center.access` 收斂到正式 vendor / service category / service region permission codes。
- 保持已套用 migration 不變，以新的 forward migration 套用。
- forward migration 通過 dry-run 與 DEV push 後，再用 idempotent seed 套 DEV-only 測試角色 `role_permissions`。

測試結果：

```powershell
node --check scripts/test-general-affairs-role-matrix-dev.js
node scripts/test-general-affairs-role-matrix-dev.js
node scripts/test-general-affairs-maintenance-ui.js
node scripts/test-general-affairs-ui-foundation.js
node scripts/test-general-affairs-dashboard-ui.js
npx tsc --noEmit --pretty false
npm run build
git diff --check
```

結果：

- `node --check scripts/test-general-affairs-role-matrix-dev.js`：通過。
- `node scripts/test-general-affairs-role-matrix-dev.js`：通過，並明確輸出 vendor permission forward-migration blocker。
- `node scripts/test-general-affairs-maintenance-ui.js`：通過。
- `node scripts/test-general-affairs-ui-foundation.js`：通過。
- `node scripts/test-general-affairs-dashboard-ui.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過；仍有既有 `DYNAMIC_SERVER_USAGE` 訊息，非本輪 failure。
- `git diff --check`：通過；只有既有 CRLF warning。

禁止事項：

- 不得用 `general_affairs.service_center.access` 當廠商、服務分類、服務區域的管理權限。
- 不得新增正式料件申請 permission code，除非進入正式料件申請資料模型設計。
- 不得用 DEV email、role name、職稱文字或 `profiles.role` 取代 `permissions` / `role_permissions` / `user_roles`。
- 不得修改已套用 migration；DB 修正必須 forward migration。
- 不得開始 UI-4 或回報 UI-3 Completed，直到 UI-3A 完成並通過人工 / 動態驗收。

### Task UI-3A-1：General Affairs Sidebar 權限 Regression Audit & Fix

完成狀態：**本機修正與 migration 草案完成；尚未正式 push，尚未 Completed。**

更新時間：2026-07-27

人工複驗問題：

- `dev-ga-access@example.test`、`dev-ga-view@example.test`、`dev-ga-manage@example.test` 登入後，General Affairs Sidebar 幾乎只剩「服務首頁」。
- 這不符合已核准角色矩陣：店長 / 督導應至少能看到維修回報、自己的回報 / 管轄回報、暫行料件申請與核准的資產 / 庫存查看入口；總務應看到維修 / 工單、設備、設施、料件、庫存、庫存位置等 available 功能。

根本原因：

- UI-3A 前一輪把 Sidebar 改成與 API guard 一致，維修功能使用 `cross_dept.maintenance.submit`、`cross_dept.maintenance.view_all`、`cross_dept.maintenance.update`。
- 但 DEV 測試角色 `dev_ga_access_only`、`dev_ga_category_view`、`dev_ga_category_manage` 的 `role_permissions` 尚未同步補上這些 API 實際使用的 canonical permission codes。
- 因此不是 Sidebar filter 壞掉，而是導覽改正後揭露了 RBAC reference data 缺口。

本輪修正 / 新增檔案：

- `supabase/migrations/20260727015132_dev_general_affairs_role_matrix_permissions.sql`
- `scripts/test-general-affairs-role-matrix-dev.js`
- `docs/DEV-RBAC-HANDOFF.md`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/GENERAL-AFFAIRS-UX-BLUEPRINT.md`

Migration 草案內容：

- `20260727015132_dev_general_affairs_role_matrix_permissions.sql` 是 DEV-only idempotent role permission seed。
- 只用 role code + permission code 指派，不依 email。
- 不建立 Auth users、profiles、stores 或 store scopes。
- 不修改 RLS、RPC、tables、indexes 或 API contract。
- 不授予 vendor / service category / service region / cooperation record 權限。
- 不修改任何已套用 migration。

補權限矩陣：

- `dev_ga_access_only`（店長 DEV 測試角色）：
  - `general_affairs.service_center.access`
  - `cross_dept.maintenance.submit`
  - `general_affairs.equipment.view`
  - `general_affairs.facility.view`
  - `general_affairs.part.view`
  - `general_affairs.inventory_location.view`
  - `general_affairs.inventory_balance.view`
  - `general_affairs.inventory_transaction.view`
- `dev_ga_category_view`（督導 DEV 測試角色）：
  - `general_affairs.service_center.access`
  - `cross_dept.maintenance.submit`
  - `general_affairs.equipment.view`
  - `general_affairs.facility.view`
  - `general_affairs.part.view`
  - `general_affairs.inventory_location.view`
  - `general_affairs.inventory_balance.view`
  - `general_affairs.inventory_transaction.view`
- `dev_ga_category_manage`（總務 DEV 測試角色）：
  - `general_affairs.service_center.access`
  - `cross_dept.maintenance.submit`
  - `cross_dept.maintenance.view_all`
  - `cross_dept.maintenance.update`
  - `general_affairs.equipment.manage`
  - `general_affairs.equipment_template.manage`
  - `general_affairs.facility.manage`
  - `general_affairs.part.view`
  - `general_affairs.part.manage`
  - `general_affairs.inventory_location.manage`
  - `general_affairs.inventory_balance.view`
  - `general_affairs.inventory_transaction.view`
  - `general_affairs.inventory_transaction.manage`

Canonical maintenance permission semantics：

- 新增維修回報 / 暫行料件申請建立：`cross_dept.maintenance.submit`
- 查看全部 / 工單中心全域檢視：`cross_dept.maintenance.view_all`
- 工單進度更新：`cross_dept.maintenance.update`
- 強制結案：`general_affairs.service_center.force_close`
- `general_affairs.service_center.access` 僅代表進入總務服務中心，不代表維修、工單、廠商或資產庫存操作權。

料件申請分類：

- 目前分類為 `REAL_TEMPORARY_FLOW`。
- 暫行流程使用既有 `maintenance_requests.resource_type = material`，可建立、可查詢、可追蹤。
- 正式料件申請 DB / API / UI 尚未建立；不得新增 `general_affairs.part_request.*` 權限碼，也不得把暫行流程視為正式料件申請 Completed。

Store scope 結果：

- 店長 / 督導資料範圍仍依 `store_managers` 與既有 API / RLS 控制。
- 前端只顯示有權限的入口，不自行擴大門市 scope。
- 督導多店 scope 若資料未設定，屬於測試資料 blocker，不可用前端硬編碼補。

Dry-run：

- `npx supabase db push --dry-run`：通過。
- 只列出 `20260727015132_dev_general_affairs_role_matrix_permissions.sql`。
- 未列 baseline、其他已套用 migration、seed、rollback 或 test SQL。
- 本輪未正式 push。

測試結果：

```powershell
node --check scripts/test-general-affairs-role-matrix-dev.js
node scripts/test-general-affairs-role-matrix-dev.js
node scripts/test-general-affairs-maintenance-ui.js
node scripts/test-general-affairs-ui-foundation.js
node scripts/test-general-affairs-dashboard-ui.js
npx tsc --noEmit --pretty false
npm run build
git diff --check
npx supabase db push --dry-run
```

結果：

- 全部通過。
- `npm run build` 仍有既有 `DYNAMIC_SERVER_USAGE` 訊息，但 exit 0，非本輪 failure。
- `git diff --check` 只有既有 CRLF warning。

仍存在 blocker：

- `20260727015132` 尚未正式 DEV push，因此三個 DEV 帳號實際 Sidebar 尚未恢復。
- Vendor permission / RLS blocker 仍存在，留給 UI-3A-2：新增 vendor / service category / service region / cooperation record 正式 permission codes，並收斂 `ga_vendors`、`ga_service_categories`、`ga_service_regions` RLS。

下一個最小任務：

**使用者批准正式 DEV push，只推 `20260727015132_dev_general_affairs_role_matrix_permissions.sql`。**

推送後人工複驗：

- `dev-ga-access@example.test`：Sidebar 不只服務首頁，應看到維修回報、料件申請暫行入口、資產 / 庫存查看入口，不看合作廠商。
- `dev-ga-view@example.test`：Sidebar 不只服務首頁，應看到維修回報、管轄回報、料件申請暫行入口、資產 / 庫存查看入口，不看合作廠商。
- `dev-ga-manage@example.test`：應看到維修 / 工單、設備、設施、料件、庫存、庫存位置與設定相關 available 功能；合作廠商可暫時隱藏。

### Task UI-3：維修回報、我的回報與工單中心介面重構

完成狀態：**本機實作完成（Guard、migration list、靜態測試、UI-1/UI-2 regression、TypeScript、build 與 diff check 通過；待人工 UI 驗收後才能標記 Completed）。**

更新時間：2026-07-26

任務目的：

- 重構總務服務中心內既有維修回報、我的回報與工單中心 UI。
- 使用 UI-1 共用 `GeneralAffairsPageHeader`、Page State 與 Page Templates。
- 保留現有 maintenance API、資料來源、狀態碼與流程語意。
- 不新增 DB 流程，不修改 migration / RLS / RPC / API contract。

現況矩陣：

| 頁面 | Route | 主要角色 | 目前資料來源 | 現有問題 | 本輪處理 |
|---|---|---|---|---|---|
| 新增維修回報 | `/general-affairs?section=maintenance` + `maintenanceView=new` | 門市人員、店長、總務 | `/api/maintenance-requests`、`/api/maintenance-photos` | 舊表單未接 UI-1 Page Header / Form template，附件語意容易被誤認正式附件模組 | 接入 `GeneralAffairsFormPage` / `GeneralAffairsPageHeader`，保留既有照片 API，不新增正式附件流程 |
| 我的回報 | `/general-affairs?section=maintenance` + `maintenanceView=mine` | 門市人員、店長、督導、總務 | `/api/maintenance-requests`、`/api/maintenance-updates`、`/api/maintenance-photos` | 列表與錯誤狀態未完全套共用 Page State | 接入 `GeneralAffairsListPage` / `GeneralAffairsPageHeader` / `GeneralAffairsErrorState` |
| 工單中心 | `/general-affairs?section=work-orders` | 總務承辦、總務主管、Full Admin，可讀者 | `/api/maintenance-requests`、`/api/maintenance-updates`、`/api/maintenance-progress-stages`、`/api/maintenance-photos` | 詳情區仍有 planned 假入口，強制結案前端顯示缺少獨立 permission gate | 接入 `GeneralAffairsListPage` / `GeneralAffairsPageHeader`，移除假設備詳情按鈕，強制結案改由 `general_affairs.service_center.force_close` 控制 |

修改檔案：

- `app/general-affairs/page.tsx`
- `components/general-affairs/maintenance/status.ts`
- `scripts/test-general-affairs-maintenance-ui.js`
- `docs/GENERAL-AFFAIRS-UX-BLUEPRINT.md`
- `docs/DEV-RBAC-HANDOFF.md`
- `docs/CURRENT-DEV-STATUS.md`
- `.github/copilot-instructions.md`

Status mapping：

- 新增 `components/general-affairs/maintenance/status.ts`。
- `MAINTENANCE_STATUS_DEFINITIONS` 統一：
  - `UNACCEPTED`：未受理
  - `ACCEPTED`：已受理
  - `PROCESSING`：處理中
  - `COMPLETED`：已完成
- Status definition 包含 semantic tone、dot、icon key、terminal flag、目前支援的 manage actions。
- `app/general-affairs/page.tsx` 由集中式 mapping 產生 `statusMeta` 與 `progressSteps`。
- 不修改 DB status code。

新增維修回報 UI：

- 接入 `GeneralAffairsFormPage` 與 `GeneralAffairsPageHeader`。
- 保留原有四步驟表單：基本資訊、問題描述、補充資料、確認送出。
- 保留現有 `resource_type` / `issue_type` / `contact_name` / `contact_phone` 與 `maintenance_requests` payload。
- 照片仍使用既有 `/api/maintenance-photos`，未建立正式附件模組，也未顯示「正式附件上傳成功」語意。
- 成功 / 失敗 / 重複送出防護沿用現有流程。

我的回報列表與詳情：

- 接入 `GeneralAffairsListPage` 與 `GeneralAffairsPageHeader`。
- 錯誤顯示改用 `GeneralAffairsErrorState`，避免 raw DB diagnostics 直接出現在 UI。
- 保留狀態卡、門市篩選、日期篩選、關鍵字搜尋與展開詳情。
- 詳情仍只顯示現有 request / update / photo API 可取得資料，不偽造 timeline table。
- 門市範圍仍由 API / RLS / `store_managers` 控制。

工單中心與詳情：

- 接入 `GeneralAffairsListPage` 與 `GeneralAffairsPageHeader`。
- 保留列表、狀態篩選、門市篩選、關鍵字搜尋與右側詳情區。
- 工單更新仍使用既有 `/api/maintenance-updates` 與 `transitionMaintenanceTicket`。
- 移除沒有實際 route/API 行為的「查看設備詳情」假按鈕，改為 planned 提示文字。
- 強制結案下拉選項與送出按鈕額外受 `canForceCloseWorkOrders` 控制；server-side `general_affairs.service_center.force_close` guard 不變。

權限行為：

- 不依 email、role name 或 `profiles.role` 判斷。
- `cross_dept.maintenance.submit`：可新增回報 / 查看自己或門市範圍回報。
- `cross_dept.maintenance.view_all`：可全域查看維修回報與工單。
- `cross_dept.maintenance.update`：可顯示現有工單更新操作。
- `general_affairs.service_center.force_close`：才顯示強制結案。
- no-access 與無總務入口仍使用 shared permission denied state。
- 前端顯示不取代 API / RLS / transition service 權限檢查。

Planned 未實作項目：

- 不顯示為可操作：派工流程、廠商報價、費用 / 請款、正式附件模組、工單扣料、料件申請關聯、通知、SLA、自動逾期、新工單狀態。
- 現有維修照片 API 可保留；不得把它包裝成正式共用附件模組。

測試與檢查結果：

```powershell
node scripts/verify-dev-supabase-environment.js
node scripts/verify-dev-supabase-cli-environment.js
npx supabase migration list
node --check scripts/test-general-affairs-maintenance-ui.js
node scripts/test-general-affairs-maintenance-ui.js
node scripts/test-general-affairs-ui-foundation.js
node scripts/test-general-affairs-dashboard-ui.js
npx tsc --noEmit --pretty false
npm run build
git diff --check
```

目前結果：

- App DEV Guard：passed，Project Ref `mjpd...mtqr`。
- CLI DEV Guard：passed，Project Ref `mjpd...mtqr`。
- `npx supabase migration list`：14 筆 migration local / remote aligned。
- `node --check scripts/test-general-affairs-maintenance-ui.js`：通過。
- `node scripts/test-general-affairs-maintenance-ui.js`：通過。
- `node scripts/test-general-affairs-ui-foundation.js`：通過。
- `node scripts/test-general-affairs-dashboard-ui.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過；既有 `DYNAMIC_SERVER_USAGE` 訊息仍會出現，但不是 build failure。
- `git diff --check`：通過；只有既有 CRLF warning。

API / UI / DB 影響：

- API：未新增、未修改 contract。
- DB：未新增或修改 migration，未執行 `db push`、`repair`、`reset` 或 rollback。
- RLS / RPC：未修改。
- UI：維修回報、我的回報與工單中心套用共用總務 UI 基礎，並移除 planned 假操作。

尚未完成事項：

- 尚未由使用者完成人工 UI 驗收。
- 尚未正式標記 Task UI-3 Completed。
- 正式料件申請、附件、採購、調撥、盤點、工單扣料尚未開始資料模型與 API 實作。

人工 UI 驗收清單：

- dev-no-ga：看不到維修 / 工單入口；直輸路由仍安全阻擋。
- dev-ga-access：沒有維修查看 / 更新權限時不載入列表，顯示明確缺權限狀態。
- dev-ga-view：依目前實際維修 view permissions 顯示，不出現 manage actions。
- dev-ga-manage：可新增回報、看我的回報與現有可管理工單操作；沒有 force close 權限時不顯示強制結案。
- dev-full-admin：可看 available 操作，但不看到 planned 流程的可操作入口。
- Desktop / Tablet / Mobile：表單、列表、工單詳情、filter、drawer 區域無水平 overflow。
- Regression：Sidebar active state、Dashboard、Inventory、未開放 route、Navbar。

下一個最小任務：

**交由使用者執行 Task UI-3 人工 UI 驗收。通過後才能標記 UI-3 Completed；不得自行開始 UI-4。**

禁止事項：

- 不得為 UI-3 補 migration 或修改 maintenance API contract。
- 不得開始 UI-4，除非使用者明確批准。
- 不得把尚未完成的派工、報價、請款、正式附件、工單扣料、料件申請關聯顯示為可操作流程。

### Task UI-2：總務服務首頁工作台改版

完成狀態：**Completed（靜態測試、TypeScript、build、diff check 與人工 UI 驗收全部通過）。**

更新時間：2026-07-26

任務目的：

- 將 `/general-affairs` 從功能介紹首頁改成工作待辦首頁。
- 依 effective permissions 顯示 KPI、待辦、異常提醒、快速操作與最近活動。
- 只使用現有真實 API / data source，不顯示假 KPI 或未完成流程入口。
- 本輪不改 DB / migration / RLS / RPC / API contract。

修改檔案：

- `app/general-affairs/page.tsx`
- `components/general-affairs/dashboard/GeneralAffairsDashboardClient.tsx`
- `scripts/test-general-affairs-dashboard-ui.js`
- `docs/GENERAL-AFFAIRS-UX-BLUEPRINT.md`
- `docs/DEV-RBAC-HANDOFF.md`
- `docs/CURRENT-DEV-STATUS.md`

Dashboard sections：

- Page Header：使用 `GeneralAffairsPageHeader`。
- KPI 摘要：只顯示已完成資料來源的庫存 KPI。
- 我的待辦：目前只顯示低庫存待辦；沒有可靠資料來源時顯示空狀態。
- 異常提醒：目前只顯示負庫存與低庫存。
- 快速操作：只顯示 available route 且使用者具備 effective permission 的入口。
- 最近活動：顯示近 7 日庫存流水；無資料則顯示空狀態。

真實資料來源：

- `/api/general-affairs/inventory/balances`
  - 用於庫存餘額項目、負庫存提醒。
- `/api/general-affairs/inventory/transactions`
  - 用於近 7 日庫存異動 KPI 與最近庫存活動。
- `/api/general-affairs/inventory/options`
  - 用於位置料件設定、低庫存判斷、可用位置料件數。

本輪顯示的 KPI：

- 庫存餘額項目。
- 近 7 日庫存異動。
- 可用位置料件。
- 負庫存項目。

KPI 計算口徑：

- 庫存餘額項目：使用 `/api/general-affairs/inventory/balances` 回傳的 `meta.total`，API 失敗時顯示區塊錯誤，不轉成 0。
- 近 7 日庫存異動：使用 `/api/general-affairs/inventory/transactions` 搭配 7 日日期條件的 `meta.total`，只計算 RLS 可見資料。
- 可用位置料件：使用 `/api/general-affairs/inventory/options` 的位置料件設定，依可見資料去重計算；沒有 `canAccessInventoryLocations` 時不提供庫存位置連結。
- 負庫存項目：由目前可見的庫存餘額資料即時計算 `quantity_on_hand < 0`。
- 沒有資料、仍在載入、API 失敗三種狀態必須分開顯示。

未顯示的 planned / unavailable KPI：

- 待審申請：正式料件申請審核流程尚未建立。
- 待收貨：調撥/收貨流程尚未建立。
- 盤點作業：盤點流程尚未建立。
- 工單扣料：工單扣料流程尚未建立。
- 待廠商回覆 / 待補資料：目前維修與工單流程尚未完成 UI-3 收斂，本輪不拿 skeleton 當正式 KPI。

權限行為：

- Dashboard 不依 email、測試帳號名稱、role name 或 `profiles.role` 判斷。
- Inventory API 只有在 `canAccessInventory` 為 true 時才呼叫。
- 庫存位置快速入口需要 `canAccessInventoryLocations`。
- 設備、設備範本、設施、料件、廠商快速入口依各自 effective permission flag 顯示。
- planned / temporarily unavailable 功能不做成可點擊 action。
- route / API / RLS 既有 server-side guard 不變。
- Dashboard 區塊同時受 permission 與 feature availability 控制。
- Full Admin 也不得看到 planned 功能的可操作 KPI 或快捷按鈕。

Store scope：

- 本輪不自行計算 store scope；庫存資料完全由現有 API 與 RLS 回傳，依 authenticated user 的可見範圍顯示。
- 前端不得自行擴大 store scope；若要顯示 store 範圍，必須來自 server API / RLS 後的結果。

API / UI / DB 影響：

- API：未新增、未修改 contract。
- DB：未新增或修改 migration，未執行 `db push`、`repair`、`reset` 或 rollback。
- RLS / RPC：未修改。
- UI：`/general-affairs` 首頁改用 `GeneralAffairsDashboardClient`；既有維修、工單、廠商、料件申請暫行 section 保留。

測試與檢查結果：

```powershell
node scripts/verify-dev-supabase-environment.js
node scripts/verify-dev-supabase-cli-environment.js
npx supabase migration list
node --check scripts/test-general-affairs-dashboard-ui.js
node scripts/test-general-affairs-dashboard-ui.js
node scripts/test-general-affairs-ui-foundation.js
npx tsc --noEmit --pretty false
npm run build
git diff --check
```

結果：

- App DEV Guard：passed，Project Ref `mjpd...mtqr`。
- CLI DEV Guard：passed，Project Ref `mjpd...mtqr`。
- `npx supabase migration list`：14 筆 migration local / remote aligned。
- `node --check scripts/test-general-affairs-dashboard-ui.js`：通過。
- `node scripts/test-general-affairs-dashboard-ui.js`：通過。
- `node scripts/test-general-affairs-ui-foundation.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過；既有 `DYNAMIC_SERVER_USAGE` 訊息仍會出現，但不是 build failure。
- `git diff --check`：通過；只有既有 CRLF warning。

人工 UI 驗收結果：

- 五個 DEV 測試帳號的人工權限驗收全部通過。
- Desktop / Tablet / Mobile 人工驗收全部通過。
- Loading / Empty / 局部錯誤 / 安全錯誤顯示通過。
- 庫存頁與 UI-1 navigation regression 通過。
- Task UI-2 正式標記 Completed。

五個 DEV 帳號驗收摘要：

- dev-no-ga：看不到總務入口；直輸 `/general-affairs` 仍安全阻擋。
- dev-ga-access：可進總務首頁，但不看到庫存 KPI / 庫存操作。
- dev-ga-view：依實際 view permissions 顯示，不出現 manage actions。
- dev-ga-manage：可看到庫存相關 KPI、待辦、異常提醒、快速入口與最近活動。
- dev-full-admin：可看到所有 available dashboard sections，不看到 planned / temporarily unavailable 可操作入口。

下一個最小任務：

**UI-3：維修回報、我的回報與工單中心介面重構。必須等待使用者明確批准後才開始。**

禁止事項：

- 不得為 UI-2 補 migration 或 dashboard aggregate API。
- 不得開始 UI-3，除非使用者明確批准。
- 不得把尚未完成的料件申請、調撥、盤點、工單扣料顯示為可操作流程。

### Task UI-1：General Affairs Layout、Sidebar、Navigation Definition、Page Header 與 Common Templates

完成狀態：**Completed（本機實作、靜態測試、TypeScript、build 與人工 UI 驗收全部通過）。**

更新時間：2026-07-26

任務目的：

- 依 `docs/GENERAL-AFFAIRS-UX-BLUEPRINT.md` 建立總務服務中心第一層 UI 基礎工程。
- 收斂 Navbar、總務內部導覽、頁首、Loading / Empty / Error / Permission denied / Module unavailable states 與頁面模板。
- 本輪只做 migration-free UI foundation，不改 DB、RLS、RPC、API contract 或已套用 migration。

修改檔案：

- `app/general-affairs/layout.tsx`
- `app/general-affairs/page.tsx`
- `components/Navbar.tsx`
- `components/general-affairs/features.ts`
- `components/general-affairs/navigation.tsx`
- `components/general-affairs/GeneralAffairsShell.tsx`
- `components/general-affairs/GeneralAffairsSidebar.tsx`
- `components/general-affairs/GeneralAffairsPageHeader.tsx`
- `components/general-affairs/GeneralAffairsPageState.tsx`
- `components/general-affairs/GeneralAffairsPageTemplates.tsx`
- `components/general-affairs/inventory/InventoryTransactionsClient.tsx`
- `hooks/useNavbarPermissions.ts`
- `scripts/test-general-affairs-ui-foundation.js`
- `docs/DEV-RBAC-HANDOFF.md`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/GENERAL-AFFAIRS-UX-BLUEPRINT.md`

API / UI / DB 影響：

- API：未新增、未修改 API contract。
- DB：未新增 migration，未執行 `db push`、`migration repair`、`db reset` 或 rollback。
- RLS / RPC：未修改。
- UI：
  - 新增 `app/general-affairs/layout.tsx`，在總務 routes 外層加入 `GeneralAffairsShell`。
  - 新增集中式 `GENERAL_AFFAIRS_NAV_GROUPS` 與 feature availability registry。
  - Navbar「總務服務中心」與總務內部 sidebar 改用同一份導覽定義。
  - Desktop sidebar 支援展開/收合，mobile 使用 drawer。
  - Planned / temporarily unavailable 功能不產生可點擊入口。
  - `/general-affairs` 舊單頁內容移除內建重複導覽，改由 layout sidebar 控制。
  - `/general-affairs` query link 會同步切換 `section` / vendor `tab`。
  - `/general-affairs/inventory` 套用共用 `GeneralAffairsPageHeader`。

權限與可見性原則：

- 導覽顯示依 effective permissions / `useNavbarPermissions` 結果，不依 email、角色名稱或 `profiles.role` 猜測。
- 前端隱藏只作為 UX；頁面、API、RLS 的既有 server-side guard 仍是安全來源。
- `store manager` 類可見性沿用既有 navbar permission flags 與 RLS/API 行為。
- 無任何可見總務權限時，總務 sidebar 顯示「目前帳號沒有可顯示的總務功能。」

測試與檢查結果：

```powershell
node scripts/verify-dev-supabase-environment.js
node scripts/verify-dev-supabase-cli-environment.js
npx supabase migration list
node --check scripts/test-general-affairs-ui-foundation.js
node scripts/test-general-affairs-ui-foundation.js
npx tsc --noEmit --pretty false
npm run build
```

結果：

- App DEV Guard：passed，Project Ref `mjpd...mtqr`。
- CLI DEV Guard：passed，Project Ref `mjpd...mtqr`。
- `npx supabase migration list`：14 筆 migration local / remote aligned，沒有 local-only、remote-only 或 unknown migration。
- `node --check scripts/test-general-affairs-ui-foundation.js`：通過。
- `node scripts/test-general-affairs-ui-foundation.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過；既有 `DYNAMIC_SERVER_USAGE` 訊息仍會出現，但不是 build failure。本輪已修正 `/general-affairs` 使用 `useSearchParams` 時需要 Suspense 的 build failure。

發現與修正問題：

- 原 `/general-affairs` 只在初次讀取 `window.location.search`，外部導覽點擊同一路由 query 時可能不切換內容；已改為 `useSearchParams` 並包在 Suspense 下。
- Navbar 原本維護一份硬編碼總務子選單；已改為引用共用 navigation definition。
- 直接頁面與總務首頁原本沒有共用 page header / state / template；本輪已建立基礎 component，後續 UI-2 到 UI-7 可逐步套用。

尚未完成事項：

- 尚未全面改寫設備、設施、料件、庫存位置等頁面使用共用 template；本輪只先套用庫存管理頁首與建立基礎。
- 尚未拆分 `app/general-affairs/page.tsx` 的大型業務內容。
- 正式料件申請、附件、採購、調撥、盤點、工單扣料尚未開始資料模型與 API 實作。

人工 UI 驗收結果：

- DEV Full Admin 可看到總務服務中心 sidebar 與 Navbar dropdown。
- no_access 不顯示可操作總務入口，直輸網址仍被頁面/API/RLS 阻擋。
- 具備總務相關 effective permission 的帳號只看到已開放且有權限的入口。
- Desktop sidebar 展開/收合可用，localStorage 保存通過。
- Mobile drawer 可用、點擊後收合、不產生水平 overflow。
- `/general-affairs`、`/general-affairs?section=vendors&tab=categories` 等 query 導覽可驅動既有內容。
- `/general-affairs/inventory` 只亮「庫存管理」。
- `/general-affairs/inventory/locations` 只亮「庫存位置」，「庫存管理」不再同時 active。
- `/general-affairs/equipment` 只亮「設備管理」。
- 其他 UI-1 驗收項目皆通過。

下一個最小任務：

**UI-2：總務服務首頁工作台。必須等待使用者明確批准後才開始。**

禁止事項：

- 不得為 UI-1 補 migration。
- 不得開始 UI-2，除非使用者明確批准。
- 不得用未完成頁面或假頁面補入口。
- 不得連 Production。

### Task UI-1 Active State Fix：總務 Sidebar 最具體路由高亮

完成狀態：**Completed（本機實作、靜態測試、TypeScript、build、diff check 與人工 UI 複驗通過）。**

更新時間：2026-07-26

問題：

- `/general-affairs/inventory` 會正確亮起「庫存管理」。
- 進入 `/general-affairs/inventory/locations` 時，「庫存位置」會亮起，但「庫存管理」也因 prefix match 同時亮起。
- 根因是 `GeneralAffairsSidebar` 原本在每個 nav item 內各自執行 `pathname.startsWith(item.href)`，且 parent item 會透過 active child 被標成 active，沒有「最具體匹配優先」規則。

修改檔案：

- `components/general-affairs/navigation.tsx`
- `components/general-affairs/GeneralAffairsSidebar.tsx`
- `scripts/test-general-affairs-ui-foundation.js`
- `docs/DEV-RBAC-HANDOFF.md`
- `docs/CURRENT-DEV-STATUS.md`

API / UI / DB 影響：

- API：未修改。
- DB：未新增或修改 migration，未執行 `db push`、`repair`、`reset` 或 rollback。
- RLS / RPC：未修改。
- UI：只修正總務 sidebar active state 計算。

修正內容：

- 新增 `getActiveGeneralAffairsNavItemId(pathname, currentPath, groups)`。
- active 判斷改成：
  - 先找 exact match。
  - 沒有 exact match 時，再找 prefix match。
  - prefix match 依 href / active path 最具體路徑優先，只回傳一個 active item id。
- `GeneralAffairsSidebar` desktop 與 mobile 共用同一個 `activeItemId`。
- 移除 sidebar item 各自判斷 active child 導致 parent 同亮的行為。
- 新增 `activePaths`，用於支援未來正式 route 例如 `/general-affairs/vendors` 的 active 判斷；不因此建立不存在的可點擊假 route。

自動測試新增案例：

- `PASS inventory exact active`
- `PASS inventory location longest match`
- `PASS single active item`
- `PASS equipment active`
- `PASS nested fallback active`

測試與檢查結果：

```powershell
node --check scripts/test-general-affairs-ui-foundation.js
node scripts/test-general-affairs-ui-foundation.js
npx tsc --noEmit --pretty false
npm run build
git diff --check
```

結果：

- `node --check scripts/test-general-affairs-ui-foundation.js`：通過。
- `node scripts/test-general-affairs-ui-foundation.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過。
- `git diff --check`：通過；只有既有 CRLF warning。

人工複驗步驟：

- 進入 `/general-affairs/inventory`，只應亮起「庫存管理」。
- 進入 `/general-affairs/inventory/locations`，只應亮起「庫存位置」，「庫存管理」不得同時亮。
- 進入 `/general-affairs/equipment`，只應亮起「設備管理」。
- 進入 `/general-affairs/equipment/templates`，只應亮起「設備範本」，「設備管理」不得同時亮。
- desktop sidebar 與 mobile drawer 應呈現一致 active state。

尚未完成事項：

- 尚未開始 UI-2。

禁止事項：

- 不得為 active state fix 修改 migration 或 API。
- 不得開始 UI-2，除非使用者明確批准。

### Task UI-0：總務服務中心 UX、資訊架構與介面系統設計

完成狀態：**Completed（文件與設計完成，尚未開始 UI-1 實作）。**

更新時間：2026-07-26

任務目的：

- 在繼續補維修、料件申請、廠商、附件、採購、調撥、盤點與工單扣料之前，先整理總務服務中心的 UX、資訊架構、角色旅程、導覽樹與分階段 UI 重構順序。
- 避免後續直接在大型 `app/general-affairs/page.tsx` 內堆功能，導致導覽、權限提示、未建置模組防護與 mobile UX 持續分散。
- 本輪只做盤點與設計，不做 runtime UI、API、DB 或 migration 變更。

修改檔案：

- `docs/GENERAL-AFFAIRS-UX-BLUEPRINT.md`
- `docs/DEV-RBAC-HANDOFF.md`
- `docs/CURRENT-DEV-STATUS.md`
- `.github/copilot-instructions.md`

API / UI / DB 影響：

- API：未新增、未修改。
- DB：未新增 migration，未執行 `db push`、`migration repair`、`db reset` 或 rollback。
- UI：未修改 runtime component；本輪只產出後續 UI-1 到 UI-7 的設計與實作順序。
- Documentation：新增完整總務 UX blueprint，並同步 CURRENT / Copilot 永久規則。

盤點結果：

- 現有總務 routes / pages：
  - `/general-affairs`
  - `/general-affairs?section=maintenance`
  - `/general-affairs?section=work-orders`
  - `/general-affairs?section=part-requests`
  - `/general-affairs?section=vendors`
  - `/general-affairs/equipment`
  - `/general-affairs/equipment/templates`
  - `/general-affairs/facilities`
  - `/general-affairs/parts`
  - `/general-affairs/inventory`
  - `/general-affairs/inventory/locations`
- 現有總務主要元件：
  - `app/general-affairs/page.tsx`
  - `components/Navbar.tsx`
  - `hooks/useNavbarPermissions.ts`
  - `components/general-affairs/ModuleUnavailablePage.tsx`
  - `components/general-affairs/equipment/*`
  - `components/general-affairs/facilities/*`
  - `components/general-affairs/parts/*`
  - `components/general-affairs/inventory/*`
- 目前找不到 repo 內獨立總務 screenshot / Figma 參考；藍圖依現有程式、正式區畫面回饋與已完成 DEV 驗收整理。

測試與檢查結果：

```powershell
node scripts/verify-dev-supabase-environment.js
node scripts/verify-dev-supabase-cli-environment.js
npx supabase migration list
```

結果：

- App DEV Guard：passed，Project Ref `mjpd...mtqr`。
- CLI DEV Guard：passed，Project Ref `mjpd...mtqr`。
- `npx supabase migration list`：14 筆 migration local / remote aligned，沒有 local-only、remote-only 或 unknown migration。
- 本輪為 docs-only，不執行 `npx tsc --noEmit --pretty false` 或 `npm run build`；沒有 runtime code 變更。

Task UI-0 產出重點：

- 設計目標與目前問題。
- 使用者角色與角色旅程。
- 總務資訊架構與導覽樹。
- Dashboard、維修回報、工單中心、料件申請、廠商、庫存 wireframe。
- 共用 page template、shared components、視覺規則、mobile rules、權限呈現與 loading / empty / error states。
- Migration-free UI implementation plan。
- UI-1 到 UI-7 分階段重構順序。

新增永久規則：

- 新功能必須優先使用共用 page template 與集中式 navigation definition。
- UI 不得依 DEV / Production 分支成不同業務流程。
- Permission denied 必須在導覽層與 action 層收斂呈現；前端隱藏仍不可取代 server/API/RLS 權限。
- 正式業務流程進入實作前必須先有 UX spec / blueprint。

尚未完成事項：

- 尚未開始 UI-1。
- 尚未拆分 `app/general-affairs/page.tsx`。
- 尚未建立共用總務 shell、page header、state component 或 centralized navigation config。
- 正式料件申請、附件、採購、調撥、盤點、工單扣料仍未進入資料模型與 API 實作。

下一個最小任務：

**UI-1：Layout、Sidebar、Navigation Definition、Page Header、Common Templates。**

UI-1 應只做 migration-free UI 基礎工程，預期優先處理：

- 建立 `lib/general-affairs/navigation.ts`。
- 建立或收斂 `GeneralAffairsShell`、`GeneralAffairsPageHeader`、`GeneralAffairsState`。
- 讓 `components/Navbar.tsx` 與 `/general-affairs` 內部導覽逐步使用同一份導覽定義。
- 保留現有 API / RLS / route 安全，不改 DB。

禁止事項：

- 不得開始 UI-1 之外的正式流程。
- 不得修改 migration、db push、repair、reset、rollback。
- 不得連 Production。
- 不得為了 UX 重構臨時建立其他總務模組資料表。

### 總務服務中心：申請料件入口可見性修正

完成狀態：**本機實作、靜態測試、TypeScript 與 build 完成；待使用者人工複驗。**

更新時間：2026-07-26

任務目的：

- 使用者回報目前仍沒有看到「申請料件」入口，只能在「新增回報」中手動選擇「料件 / 耗材」。
- 根因是前一輪主要補了「料件申請紀錄」入口，以及非總務視角的舊快速入口；full admin / 總務管理視角仍容易看到「新增料件」並被導向料件主檔，缺少清楚的「申請料件」入口。
- 本輪補上明確入口，不修改 DB / API / migration。

修改檔案：

- `app/general-affairs/page.tsx`
- `components/Navbar.tsx`
- `scripts/test-general-affairs-availability.js`
- `docs/DEV-RBAC-HANDOFF.md`
- `docs/CURRENT-DEV-STATUS.md`

API / UI / DB 影響：

- API：未新增、未修改。仍使用既有 `/api/maintenance-requests` 與 `/api/maintenance-photos`。
- DB：未新增 migration，未執行 `db push` / `repair` / `reset` / rollback。
- UI：
  - Navbar「總務服務中心」下拉選單新增「申請料件」。
  - Navbar 入口連到 `/general-affairs?section=part-requests&action=new`。
  - 總務服務中心頁面會解析 `section=part-requests&action=new`；若帳號可新增回報，直接開啟預選「料件 / 耗材」的新增料件申請表單。
  - 總務服務中心首頁右上方新增「申請料件」按鈕。
  - 「料件申請紀錄」卡片新增「申請料件」主按鈕，並保留「查看料件申請紀錄」。
  - 「料件中心 / 新增料件」仍代表料件主檔管理，不再作為料件申請入口。

測試結果：

```powershell
node --check scripts/test-general-affairs-availability.js
node scripts/test-general-affairs-availability.js
npx tsc --noEmit --pretty false
npm run build
```

結果：

- `node --check scripts/test-general-affairs-availability.js`：通過。
- `node scripts/test-general-affairs-availability.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過；僅出現既有 `DYNAMIC_SERVER_USAGE` 訊息，非 build failure。

發現問題：

- 暫行料件申請仍是用維修回報底層資料流；正式料件申請 DB / API / UI 尚未設計。
- 權限不足、沒有新增回報能力的帳號即使從 Navbar 進入，也不會直接開新增表單，會留在紀錄頁或權限提示。

尚未完成事項：

- 需要使用者人工複驗：
  - Navbar「總務服務中心」下拉選單可看到「申請料件」。
  - 點「申請料件」後直接看到「新增料件申請」。
  - 總務服務中心首頁右上方可看到「申請料件」。
  - 「料件申請紀錄」卡片內可看到「申請料件」與「查看料件申請紀錄」。
  - 送出後回到「料件申請紀錄」，可看到該筆 `resource_type = material` 的紀錄。

下一個最小任務：

**人工複驗「申請料件」入口是否已在 Navbar 與總務服務中心首頁清楚可見。通過後，再由使用者批准是否進入正式料件申請流程設計。**

禁止事項：

- 不得用料件主檔頁冒充料件申請流程。
- 不得為暫行入口新增正式料件申請資料表。
- 不得修改已套用 migration。
- 不得連 Production。

### 設備資產編號自動流水 Forward Fix

完成狀態：**DEV db push 已完成，DB 驗收 SQL 通過；尚待人工新增設備複驗。**

更新時間：2026-07-30

任務目的：

- 使用者回報新增設備時資產編號流水號沒有產生。
- 盤點確認目前前端只顯示預覽 `第二層分類代碼 + 購買日期 + ###`，API payload 仍送 `asset_code: null`，DB `ga_validate_equipment()` 也沒有產號邏輯。
- 正式規格為 `{LEVEL_2_CATEGORY_CODE}{PURCHASE_DATE_YYYYMMDD}{SEQUENCE_3_DIGITS}`，其中 `LEVEL_2_CATEGORY_CODE` 必須為實際第二層設備分類 code 4 碼，例如 `IC01`；不得取第一層 2 碼或第三層 6 碼。

修改檔案：

- `supabase/migrations/20260730002830_generate_equipment_asset_code_sequence.sql`（已推送 DEV）
- `supabase/migration_general_affairs_equipment_master.sql`
- `supabase/rollback_general_affairs_equipment_master.sql`
- `supabase/test_general_affairs_equipment_asset_code_sequence.sql`
- `components/general-affairs/equipment/EquipmentCreatePageClient.tsx`
- `scripts/test-general-affairs-equipment-master.js`
- `scripts/test-general-affairs-asset-management-ui.js`
- `docs/GENERAL-AFFAIRS-UX-BLUEPRINT.md`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

API / UI / DB 影響：

- API：未修改 route contract。新增設備仍可送 `asset_code: null`，由 DB trigger 產生正式資產編號。
- DB：新增 forward migration，已推送 DEV。
  - 新增內部表 `public.ga_asset_code_sequences`，以 `(resource_type, level2_category_code, purchase_date)` 作為主鍵，保存最後流水號。
  - 撤銷 `PUBLIC`、`anon`、`authenticated` 對 `ga_asset_code_sequences` 的直接存取。
  - 新增 `public.ga_equipment_level2_category_code(uuid)`，由所選分類追溯實際第二層分類 code 4 碼。
  - 新增 `public.ga_next_equipment_asset_code(uuid, date)`，用 `ON CONFLICT` 安全累加流水，並參考既有 active asset_code 的最大流水避免撞舊資料。
  - 重新定義 `public.ga_validate_equipment()`：新增設備且 `asset_code IS NULL`、`purchased_at IS NOT NULL` 時，自動呼叫 `ga_next_equipment_asset_code()`。
- UI：新增設備頁仍顯示只讀預覽，不在前端自行產號；提示文字改為「儲存時由後端安全產生」。

重要設計：

- 只處理設備 `EQUIPMENT` 資產編號，不處理設施資產編號與標籤列印。
- 不修改已套用 migration；本次為 forward fix。
- 若新增設備未填購置日期，仍不硬產生假資產編號。
- 若舊資料或舊流程已手填 `asset_code`，本輪不強制覆寫，避免破壞相容性。
- 產號在 DB trigger 內完成，不得搬到前端以免併發撞號。

測試規劃與結果：

- 新增並已執行通過 `supabase/test_general_affairs_equipment_asset_code_sequence.sql`，用於驗證：
  - helper / sequence table 存在。
  - 選第三層分類時仍使用第二層 code。
  - 第一筆與第二筆同分類同購置日期流水連續遞增。
  - 測試資料以 soft cleanup 標記，不硬刪。
- 本輪已完成 dry-run、正式 DEV db push 與 DB 驗收；尚未人工新增設備複驗。

尚未完成事項：

- 已執行 App DEV Guard、CLI DEV Guard 與 `npx supabase migration list`。
- 已執行 `npx supabase db push --dry-run`，只列 `20260730002830_generate_equipment_asset_code_sequence.sql`。
- 已依使用者批准正式 DEV `db push`。
- 已執行 `supabase/test_general_affairs_equipment_asset_code_sequence.sql` 並通過。
- 人工複驗新增設備後是否產生完整資產編號。

下一個最小任務：

**人工複驗新增設備資產編號自動流水。**

禁止事項：

- 不得修改已套用 migration。
- 不得在前端自行產生正式 asset_code。
- 不得未經 dry-run 與使用者批准就 db push。
- 不得連 Production。
- 不得開始 UI-5 或其他總務流程。

### 新增設備保固資訊與供應商欄位調整

完成狀態：**本機 UI 實作完成；靜態測試、TypeScript、build 通過。附件 visibility helper grant forward fix 已正式推送 DEV，待人工重新複驗上傳。**

更新時間：2026-07-30

任務背景：

- 使用者要求新增設備在填寫保固資訊時可附加文件。
- 使用者要求「廠牌／廠商」欄位改為「購買途徑／供應商」。
- 使用者詢問此欄位後續是否會串到廠商資料。

修改檔案：

- `components/general-affairs/equipment/EquipmentCreatePageClient.tsx`
- `scripts/test-general-affairs-asset-management-ui.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

API / UI / DB 影響：

- DB：本輪不新增 migration、不修改 schema。
- API：未修改 API contract；新增設備仍呼叫既有 `/api/general-affairs/equipment` 與 `/api/general-affairs/attachments`。
- UI：
  - 新增設備基本資訊中，「廠牌／廠商」改為「購買途徑／供應商」。
  - 「品牌」欄位保留，用於設備識別與品牌 / 型號查詢。
  - 「購買途徑／供應商」目前先保存到 `ga_equipment.specs.purchase_source_supplier`。
  - 保固資訊新增「申請保固方式」下拉選單，目前保存到 `ga_equipment.specs.warranty_claim_method`。
  - 申請保固方式選擇「其他方式」時，顯示「其他保固方式備註」，目前保存到 `ga_equipment.specs.warranty_claim_notes`。
  - 申請保固方式選項包含：
    - 保留購買方發票／收據
    - 上網登錄保固
    - 序號登錄保固
    - 供應商／原廠保固卡
    - 合約／報價單約定
    - 免單據，依序號或購買紀錄
    - 其他方式
  - 新增設備流程的待上傳附件分成兩種 purpose：
    - `PRIMARY_IMAGE`：設備圖片與一般附件。
    - `WARRANTY_DOCUMENT`：保固文件附件。
  - 送出前完成確認頁已顯示「購買途徑／供應商」、「申請保固方式」與其他保固方式備註。

後續廠商串接規劃：

- 是，這個欄位後續應串到廠商資料。
- 目前先以文字寫入 `specs`，避免在廠商流程尚未完全收斂時新增錯誤 FK 或欄位。
- 後續廠商主檔與採購 / 保固流程完成後，建議新增正式欄位或關聯：
  - `vendor_id` / `supplier_id` 指向正式廠商主檔。
  - 保留 `purchase_source_supplier` 作為舊資料相容或自由文字補充。
  - 保固方式可依正式流程評估是否升級為 enum 欄位或保固附件 metadata。

最新附件權限狀態：

- DEV forward migration 已正式推送：
  - `20260730010048_grant_resource_attachment_visibility_helpers.sql`
- 該 migration 用於補上 `ga_resource_attachment_can_read/manage` 對 authenticated 的 EXECUTE grant。
- `npx supabase migration list` 已確認 `20260730010048` local / remote aligned。
- 仍需人工重新複驗設備圖片與保固文件上傳，確認不再出現：
  - `permission denied for function ga_resource_attachment_can_manage`

測試結果：

- `node --check scripts/test-general-affairs-asset-management-ui.js`：通過。
- `node scripts/test-general-affairs-asset-management-ui.js`：通過。
- `node --check scripts/test-general-affairs-resource-attachments.js`：通過。
- `node scripts/test-general-affairs-resource-attachments.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過；仍有既有 `DYNAMIC_SERVER_USAGE` 與 webpack cache warning，非 build failure。

下一個最小任務：

**重新複驗新增設備的設備圖片與保固文件附件上傳。**

### 設備列表圖片縮圖接入

完成狀態：**本機 UI 實作完成；靜態測試與 TypeScript 通過。**

更新時間：2026-07-30

任務背景：

- 使用者確認設備圖片已可上傳成功，但設備列表名稱前方仍只顯示 placeholder，沒有顯示已上傳圖片縮圖。

修改檔案：

- `components/general-affairs/equipment/EquipmentManagementClient.tsx`
- `scripts/test-general-affairs-asset-management-ui.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

實作摘要：

- 設備列表載入設備後，透過既有附件 API：
  - `GET /api/general-affairs/attachments?resourceType=EQUIPMENT&resourceId=<equipment_id>`
- 優先選取：
  - `purpose = PRIMARY_IMAGE`
  - `is_primary = true`
  - `content_type` 為 image
  - 且有 `signed_url`
- 若沒有 primary image，退回第一張 `PRIMARY_IMAGE` 圖片，再退回任一圖片附件。
- 桌面表格與 mobile 卡片共用 `EquipmentThumbnail`。
- 沒有圖片時保留原本 `AssetPlaceholder`，不顯示破圖。

限制與後續：

- 本輪不新增 batch thumbnail API，因此目前列表會對目前載入的設備逐筆查附件；若設備筆數大幅增加，後續可補 server-side batch thumbnail API。
- 未修改 DB schema、RLS、RPC、migration 或 API contract。

測試結果：

- `node --check scripts/test-general-affairs-asset-management-ui.js`：通過。
- `node scripts/test-general-affairs-asset-management-ui.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。

### 保固管理顯示保固方式與文件附件

完成狀態：**本機 UI 實作完成；靜態測試與 TypeScript 通過。**

更新時間：2026-07-30

任務背景：

- 使用者指出保固管理頁應顯示新增設備時填寫的保固資訊：
  - 申請保固方式
  - 可檢視附件單據 / 圖片 / 文件
- 原頁面仍只顯示 `has_warranty` / `warranty_end_date`，且文案表示保固文件尚未建置，已不符合附件基礎完成後的狀態。

修改檔案：

- `components/general-affairs/equipment/EquipmentWarrantyClient.tsx`
- `scripts/test-general-affairs-asset-management-ui.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

實作摘要：

- 保固管理頁讀取設備主檔 `specs`：
  - `warranty_claim_method`
  - `warranty_claim_notes`
- 以集中 mapping 顯示常見申請保固方式中文：
  - 保留購買方發票／收據
  - 上網登錄保固
  - 序號登錄保固
  - 供應商／原廠保固卡
  - 合約／報價單約定
  - 免單據，依序號或購買紀錄
  - 其他方式
- 透過既有附件 API 讀取設備附件：
  - `GET /api/general-affairs/attachments?resourceType=EQUIPMENT&resourceId=<equipment_id>`
- 只在保固管理頁顯示 `purpose = WARRANTY_DOCUMENT` 的附件。
- 桌面表格新增：
  - `申請保固方式`
  - `文件 / 單據`
- Mobile 卡片同步顯示申請方式、備註與文件連結。
- 移除過時文案：`保固廠商、文件與自動通知尚未建置`。

限制與後續：

- 本輪不新增 DB 欄位、不修改 API contract、不新增 migration。
- 目前仍逐筆查附件；若保固資料筆數增加，後續可補 batch attachment summary API。
- 供應商主檔正式串接仍待後續廠商 / 採購 / 保固流程收斂。

測試結果：

- `node --check scripts/test-general-affairs-asset-management-ui.js`：通過。
- `node scripts/test-general-affairs-asset-management-ui.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。

### 設施保固管理接入

完成狀態：**本機 UI 實作完成；靜態測試通過；未修改 DB / migration。**

更新時間：2026-07-30

任務背景：

- 使用者指出設施管理也需要保固管理，因部分設施更換、裝修或維修後同樣會有保固。
- `ga_facilities` 目前沒有設備那樣的 `has_warranty` / `warranty_end_date` 獨立欄位。
- 本輪為避免直接修改 DB schema，先沿用既有 `ga_facilities.specs jsonb` 保存設施保固資訊。

修改檔案：

- `components/general-affairs/facilities/FacilityCreatePageClient.tsx`
- `components/general-affairs/facilities/FacilitiesClient.tsx`
- `components/general-affairs/facilities/FacilityWarrantyClient.tsx`
- `app/general-affairs/facilities/warranties/page.tsx`
- `components/general-affairs/features.ts`
- `components/general-affairs/navigation.tsx`
- `scripts/test-general-affairs-asset-management-ui.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

實作摘要：

- 新增設施表單加入「保固資訊」區塊：
  - 有保固
  - 保固到期日
  - 申請保固方式
  - 其他保固方式備註
- 設施列表 / 編輯彈窗 / 詳情抽屜可顯示與維護保固資料。
- 新增設施保固管理頁：
  - `/general-affairs/facilities/warranties`
- 左側導覽「設施管理」新增子項目：
  - `保固管理`
- Feature availability 新增：
  - `facility_warranties`
- 設施保固資料目前寫入 `ga_facilities.specs`：
  - `facility_has_warranty`
  - `facility_warranty_end_date`
  - `facility_warranty_claim_method`
  - `facility_warranty_claim_notes`
- 設施保固管理頁只讀既有 API：
  - `GET /api/general-affairs/facilities?pageSize=100&sortBy=updated_at&sortOrder=desc`
  - `GET /api/general-affairs/attachments?resourceType=FACILITY&resourceId=<facility_id>`
- 本輪未新增或修改：
  - DB migration
  - RLS
  - RPC
  - API contract
  - Storage policy

限制與後續：

- 設施保固目前是 `specs` 暫存設計；若未來需要 DB constraint、排序、報表或到期提醒，應建立正式 forward migration 升級欄位。
- 設施附件目前仍透過一般 `ResourceAttachmentPanel` 上傳，panel 固定使用 `purpose = GENERAL`；保固管理頁會顯示設施附件，但尚未強制區分 `WARRANTY_DOCUMENT`。
- 若要讓設施保固文件與設備保固文件一樣可明確分類，後續應擴充 `ResourceAttachmentPanel` 支援可指定 purpose。

測試結果：

- `node --check scripts/test-general-affairs-asset-management-ui.js`：通過。
- `node scripts/test-general-affairs-asset-management-ui.js`：通過。
- `git diff --check`（本輪設施保固相關檔案）：通過。
- `npx tsc --noEmit --pretty false`：本輪超過 180 秒未完成並已停止，未見 TypeScript error 輸出。
- `npm run build`：production compile 已顯示 `Compiled successfully`，但卡在 `Linting and checking validity of types ...` 超過 3 分鐘後停止；需另立全專案 type-check 效能診斷。

下一個最小任務：

**人工複驗設施保固管理。**

驗收重點：

- `/general-affairs/facilities/new` 可新增含保固資訊的設施。
- `/general-affairs/facilities` 詳情與編輯彈窗可顯示 / 修改保固資訊。
- `/general-affairs/facilities/warranties` 可看到設施保固狀態、申請方式、備註與設施附件。
- 左側導覽「設施管理」底下可看到「保固管理」。
- 無權限使用者仍受原頁面 / API / RLS 控制。

### 料件管理與庫存導覽收斂

完成狀態：**本機 UI 導覽調整完成；靜態測試通過；未修改 DB / API / RLS。**

更新時間：2026-07-30

任務背景：

- 使用者確認「庫存管理」與「庫存位置」目前是管理料件 / 耗材庫存，而不是設備或設施本體。
- 因此獨立放在 `資產與庫存` 同層會讓資訊架構不夠直覺。
- 本輪將庫存相關入口收斂到 `料件管理` 底下。

修改檔案：

- `components/general-affairs/navigation.tsx`
- `scripts/test-general-affairs-ui-foundation.js`
- `scripts/test-general-affairs-asset-management-ui.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

實作摘要：

- `料件管理` 改為可展開父項目，不再直接導向頁面。
- `料件管理` 底下新增 / 保留三個子項目：
  - `料件列表`：`/general-affairs/parts`
  - `庫存管理`：`/general-affairs/inventory`
  - `庫存位置`：`/general-affairs/inventory/locations`
- 原路由保持不變，因此不影響既有 deep link 或 API。
- 權限條件未放寬：
  - 料件列表仍依 `general_affairs.part.view/manage`
  - 庫存管理仍依 `general_affairs.inventory_balance.view`、`general_affairs.inventory_transaction.view/manage`
  - 庫存位置仍依 `general_affairs.inventory_location.view/manage`
- Active state 延續 UI-1 規則：
  - exact match 優先
  - 最長 prefix match 次之
  - 同一時間只會有一個 active nav item
  - 父項目展開狀態與 active item 分離

測試結果：

- `node --check scripts/test-general-affairs-ui-foundation.js`：通過。
- `node scripts/test-general-affairs-ui-foundation.js`：通過。
- `node --check scripts/test-general-affairs-asset-management-ui.js`：通過。
- `node scripts/test-general-affairs-asset-management-ui.js`：通過。

限制與後續：

- 本輪未執行 `tsc` / build，因目前全專案 type-check 階段已知偏慢，需另立效能診斷。
- 本輪未修改 DB migration、API contract、RLS、RPC 或 Production。

下一個最小任務：

**人工複驗總務側邊導覽。**

驗收重點：

- 左側 `料件管理` 可展開。
- 子項目順序為：
  - 料件列表
  - 庫存管理
  - 庫存位置
- 點擊後仍進入原路由。
- Active state 只亮目前所在子項目。
- 無對應權限的帳號仍不顯示或進入後被原頁面 / API / RLS 阻擋。

### 新增料件正式 5 Step 表單

完成狀態：**本機 UI 實作完成；靜態測試、TypeScript 與 build 通過；待人工 UI 複驗。**

更新時間：2026-08-10

任務名稱：Task UI-4B 新增料件正式介面設計。

修改檔案：

- `app/general-affairs/parts/new/page.tsx`
- `components/general-affairs/parts/PartCreatePageClient.tsx`
- `components/general-affairs/parts/PartsClient.tsx`
- `components/general-affairs/navigation.tsx`
- `components/general-affairs/features.ts`
- `scripts/test-general-affairs-part-form-ui.js`
- `scripts/test-general-affairs-ui-foundation.js`
- `docs/GENERAL-AFFAIRS-UX-BLUEPRINT.md`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`
- `.github/copilot-instructions.md`

UI 影響：

- 新增 `/general-affairs/parts/new`。
- `料件管理 > 新增料件` 從 planned placeholder 改為可點擊 route。
- `part_new` feature availability 改為 `available`。
- 料件列表頁 primary action 改為 `新增料件`，庫存管理與庫存位置保留為 secondary actions。
- 新增料件頁使用既有 `GeneralAffairsPageHeader`、`GeneralAffairsFormPage`、`AssetFormSection` 與總務 Sidebar 架構。

表單流程：

1. 基本資訊：
   - 料件名稱、料件分類、啟用狀態、料號、品牌、型號、規格、條碼、描述。
   - 料件分類使用三層逐層選擇器，避免分類多時單一下拉過長。
   - 料件圖片目前顯示安全未開放提示。
2. 用途與相容性：
   - 用途類型：`REPAIR_PART`、`CONSUMABLE`、`SPARE_PART`、`GENERAL_SUPPLY`。
   - 相容性範圍：`UNIVERSAL`、`RESTRICTED`。
   - 限制相容時，沿用既有 `ga_part_compatibilities`：
     - `EQUIPMENT_TEMPLATE`
     - `BRAND_MODEL`
     - `VENDOR_SERIES`
3. 單位與包裝：
   - `base_unit`
   - `purchase_unit`
   - `purchase_to_base_rate`
   - `minimum_issue_qty`
   - `allow_unpacking`
   - `allow_fractional_issue`
4. 庫存設定與其他資訊：
   - 明確提示「本頁不輸入初始庫存」。
   - 提供建立後前往庫存位置設定的入口。
   - 維護 tags / notes。
5. 確認建立：
   - 顯示完整摘要。
   - 再次提醒庫存數量必須透過庫存交易建立。

API / DB 影響：

- 本輪沒有新增 DB migration。
- 本輪沒有修改 RLS / RPC / API contract。
- 建立料件仍使用既有：
  - `POST /api/general-affairs/parts`
  - `POST /api/general-affairs/parts/[id]/compatibilities`
- Client 仍不能指定 `created_by`、`updated_by`、`deleted_by` 等 system fields，沿用既有 validation。

已知 schema 缺口：

- `ga_parts` 目前沒有正式欄位：
  - `usage_type`
  - `compatibility_scope`
- 本輪暫以 `ga_parts.specs` 保存：
  - `part_usage_type`
  - `part_compatibility_scope`
  - `part_schema_note`
- 若要正式查詢、約束或報表，需另開最小 forward migration。
- `ga_resource_attachments` / attachment API 目前不支援 `resource_type = PART`，因此料件圖片不做假上傳。
- `ga_part_compatibilities` 目前不支援 facility compatibility，本頁未顯示假的設施相容性。

測試與 build：

- `node --check scripts/test-general-affairs-part-form-ui.js`：通過。
- `node scripts/test-general-affairs-part-form-ui.js`：通過。
- `node scripts/test-general-affairs-ui-foundation.js`：通過。
- `node scripts/test-general-affairs-asset-management-ui.js`：通過。
- `node scripts/test-general-affairs-asset-form-validation.js`：通過。
- `node scripts/test-general-affairs-role-matrix-dev.js`：通過。
- `node scripts/test-general-affairs-dashboard-ui.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過。第一次因既有 dev server 佔用 `.next/trace` 出現 `EPERM`，停止本專案 3002 dev server 後重新 build 通過。

發現問題：

- 新增料件正式規格需要 `usage_type` / `compatibility_scope` 正式欄位，但目前 DB 尚未提供。
- 料件圖片上傳需要附件基礎支援 `PART` resource type。
- 設施相容性需要另行設計 schema，不得在目前 `ga_part_compatibilities` 上假造欄位。

下一個最小任務：

**人工複驗 `/general-affairs/parts/new` 新增料件 5 Step 表單。**

禁止事項：

- 人工複驗前不得直接標記 UI-4 Completed。
- 不得為了本頁臨時修改已套用 migration。
- 不得在未批准時新增或推送 `usage_type` / `compatibility_scope` forward migration。
- 不得把料件圖片假裝上傳成功。

### Sidebar 點擊後收合其他功能群組

完成狀態：**本機互動修正完成；靜態測試、TypeScript 與 build 通過；待人工 UI 複驗。**

更新時間：2026-08-10

任務背景：

- 使用者希望點擊任何左側功能模組後，原本展開的其他功能模組都自動收合。
- 原本 `expandedGroups` 只會累積展開項目，路由切換時只把 active 父群組加進去，不會移除舊群組。

修改檔案：

- `components/general-affairs/GeneralAffairsSidebar.tsx`
- `scripts/test-general-affairs-ui-foundation.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`
- `.github/copilot-instructions.md`

實作摘要：

- 新增 `handleNavigate()`，所有可點擊 nav link 都統一經過這個 handler。
- 點擊任何子項目或沒有父項目的連結時：
  - `expandedGroups` 一律重設為空集合。
  - 所有父功能模組都會收合，不保留目前子項目的父層展開。
- Mobile 既有 `onNavigate` 關閉 drawer 行為保留。
- Active item 邏輯未變，仍由 `getActiveGeneralAffairsNavItemId` 控制，避免同時多個 active。

測試與 build：

- `node --check scripts/test-general-affairs-ui-foundation.js`：通過。
- `node scripts/test-general-affairs-ui-foundation.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過。仍有既有 Dynamic server usage 訊息，但不是 build failure。

API / DB / Migration 影響：

- 無 DB migration。
- 無 db push。
- 無 API contract 變更。
- 無 RLS / RPC 變更。

下一個最小任務：

**人工複驗總務 Sidebar 點擊後收合其他功能群組。**

驗收重點：

- 手動展開多個父群組後，點擊任一子功能，其他父群組收合。
- 點擊子功能後，所有父群組都收合。
- 點擊沒有父群組的功能時，所有父群組收合。
- Mobile 點擊功能後 drawer 仍關閉。
- Active state 仍只亮一個目前項目。

### 料件圖片上傳與分類搜尋

完成狀態：**本機實作完成；靜態測試、TypeScript 與 build 通過；local-only forward migration 待使用者批准 dry-run / DEV push。**

更新時間：2026-08-10

任務名稱：總務料件圖片上傳與資產分類搜尋。

修改檔案：

- `components/general-affairs/assets/AssetCategoryPicker.tsx`
- `components/general-affairs/equipment/EquipmentCreatePageClient.tsx`
- `components/general-affairs/facilities/FacilityCreatePageClient.tsx`
- `components/general-affairs/parts/PartCreatePageClient.tsx`
- `app/api/general-affairs/attachments/route.ts`
- `components/general-affairs/attachments/ResourceAttachmentPanel.tsx`
- `supabase/migration_general_affairs_resource_attachments.sql`
- `supabase/migrations/20260810090000_allow_part_resource_attachments.sql`
- `scripts/test-general-affairs-part-form-ui.js`
- `scripts/test-general-affairs-resource-attachments.js`
- `scripts/test-general-affairs-asset-management-ui.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`
- `.github/copilot-instructions.md`

UI 影響：

- 新增共用分類選擇器 `AssetCategoryPicker`。
- 新增設備、設施、料件時，分類選擇同時支援：
  - 逐層點擊選擇第 1 / 第 2 / 第 3 層分類。
  - 以關鍵字搜尋分類名稱、分類 code 與完整分類路徑。
- 料件新增頁的圖片區從「尚未開放上傳」改為正式上傳 UI：
  - 支援 JPG、PNG、WebP、HEIC / HEIF 與 PDF。
  - 單檔上限 20MB。
  - 可預覽圖片縮圖，PDF 顯示一致 placeholder。
  - 可在送出前移除待上傳檔案。
  - 料件建立成功後才呼叫附件 API 關聯 `resource_type = PART`。
- 若料件已建立但圖片上傳失敗，頁面會保留明確訊息：`料件已新增，但圖片上傳失敗：...`，不會假裝附件成功。

API / DB 影響：

- Attachment API `RESOURCE_TYPES` 已加入 `PART`。
- `ResourceAttachmentPanel` 型別已加入 `PART`。
- 新增 local-only forward migration：
  - `20260810090000_allow_part_resource_attachments.sql`
- Forward migration 只做：
  - 重建 `ga_resource_attachments_resource_type_check`，允許 `PART`。
  - 更新 `ga_resource_attachment_can_read(TEXT, UUID)`，讓 `part.view`、`part.manage` 或 store manager 可讀符合規則的 active part attachments。
  - 更新 `ga_resource_attachment_can_manage(TEXT, UUID)`，要求 `general_affairs.part.manage` 才可管理 part attachments。
  - 保留 helper `SECURITY DEFINER` 與 `search_path = public, pg_temp`。
  - 保留 authenticated helper grants，不授權 anon。
- 平放來源 SQL `supabase/migration_general_affairs_resource_attachments.sql` 已同步，讓未來乾淨環境直接建置時也包含 `PART`。
- 已套用 migration `20260729125755_general_affairs_resource_attachments.sql` 未修改。

測試與 build：

- `node --check scripts/test-general-affairs-part-form-ui.js`：通過。
- `node scripts/test-general-affairs-part-form-ui.js`：通過。
- `node --check scripts/test-general-affairs-resource-attachments.js`：通過。
- `node scripts/test-general-affairs-resource-attachments.js`：通過。
- `node --check scripts/test-general-affairs-asset-management-ui.js`：通過。
- `node scripts/test-general-affairs-asset-management-ui.js`：通過。
- `git diff --check`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過。仍有既有 Dynamic server usage 訊息，但不是 build failure。

發現問題 / 尚未完成：

- `20260810090000_allow_part_resource_attachments.sql` 尚未推送 DEV，因此目前 DEV DB 可能仍不接受 `resource_type = PART`。
- 尚未執行 `npx supabase db push --dry-run`，因本輪未被批准遠端 DB 操作。
- 尚未執行附件 catalog SQL 或 authenticated 動態驗收。
- 尚未人工複驗料件圖片上傳、分類搜尋、料件列表縮圖是否符合使用情境。

下一個最小任務：

**批准後執行 `20260810090000_allow_part_resource_attachments.sql` 的 DEV dry-run 與正式 push。**

建議安全順序：

1. `node scripts/verify-dev-supabase-environment.js`
2. `node scripts/verify-dev-supabase-cli-environment.js`
3. `npx supabase migration list`
4. `npx supabase db push --dry-run`
5. 確認 dry-run 只列 `20260810090000_allow_part_resource_attachments.sql`
6. 使用者批准後正式 `npx supabase db push`
7. Push 後重新確認 migration local / remote aligned
8. 執行附件 catalog / 動態上傳 / 人工 UI 驗收

禁止事項：

- 不得修改已套用 migration。
- 不得在未 dry-run 並經使用者批准前正式 db push。
- 不得用 service role 繞過 authenticated attachment API / RLS 驗收。
- 不得顯示假附件成功。
- 不得將 DEV 假資料或測試附件帶入 Production。

### DEV 測試料件清理腳本

完成狀態：**本機清理 SQL 已建立；尚未執行 DEV 遠端資料清理。**

更新時間：2026-08-10

任務名稱：清理 DEV 已建立的測試料件內容。

新增檔案：

- `supabase/cleanup_dev_general_affairs_test_parts.sql`

清理方式：

- 僅 soft delete，不 hard delete。
- 候選料件條件：
  - `part_code` / `barcode` 以 `DEV-` 或 `TEST-` 開頭。
  - `name` 以 `DEV ` 開頭或包含 `測試`。
  - `created_by` / `updated_by` 屬於 DEV 測試帳號，例如 `dev-%@example.test`。
- 同步 soft delete：
  - `ga_resource_attachments` 中 `resource_type = 'PART'` 的附件 metadata。
  - `ga_inventory_location_parts` 中關聯該料件的位置料件設定。
  - `ga_part_compatibilities` 中關聯該料件的相容性設定。
  - `ga_parts` 本體。
- 不刪除：
  - `ga_inventory_transactions`
  - `ga_inventory_balances`
  - 任何 hard delete 或 migration history。

安全限制：

- 必須只在 DEV `mjpd...mtqr` 執行。
- 不得在 Production 執行。
- 不得使用 `DELETE FROM ga_parts` 硬刪。
- 若要執行，先跑 App / CLI DEV Guard，或由使用者確認已在 DEV Supabase SQL Editor。

下一步：

- 使用者在 DEV Supabase SQL Editor 執行 `supabase/cleanup_dev_general_affairs_test_parts.sql`。
- 執行後回報 `remaining_active_test_part_count`。

### 總務「我的申請」四入口獨立頁面收斂

完成狀態：**本機實作完成；靜態測試、TypeScript 與 build 通過；等待人工 UI 複驗。**

更新時間：2026-08-12

任務名稱：總務服務中心我的申請入口 route-level page 收斂。

背景：

- 使用者確認左側 `我的申請` 底下的四個功能應各自有明確介面：
  - 新增回報
  - 我的回報
  - 新增料件申請
  - 我的料件申請
- 修正前 Sidebar 以 `/general-affairs?section=...` query string 切換舊服務中心狀態；目前 `/general-affairs` 已是工作台首頁，因此使用者實際點擊後看起來不像四個獨立功能。

修改檔案：

- `components/general-affairs/service-center/GeneralAffairsServiceCenterClient.tsx`
- `components/general-affairs/navigation.tsx`
- `app/general-affairs/reports/new/page.tsx`
- `app/general-affairs/reports/mine/page.tsx`
- `app/general-affairs/part-requests/new/page.tsx`
- `app/general-affairs/part-requests/page.tsx`
- `scripts/test-general-affairs-maintenance-views.js`
- `scripts/test-general-affairs-ui-foundation.js`
- `scripts/test-general-affairs-availability.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`
- `.github/copilot-instructions.md`

UI 影響：

- 新增回報入口改為：`/general-affairs/reports/new`。
- 我的回報入口改為：`/general-affairs/reports/mine`。
- 新增料件申請入口改為：`/general-affairs/part-requests/new`。
- 我的料件申請入口改為：`/general-affairs/part-requests`。
- Sidebar 四個入口不再使用 `/general-affairs?section=maintenance...` 或 `/general-affairs?section=part-requests...`。
- `GeneralAffairsServiceCenterClient` 新增 `initialView` route 初始化參數，使 route page 可明確開啟：
  - maintenance + new
  - maintenance + mine
  - part-requests + new + material
  - part-requests + mine + material
- 新增料件申請頁的標題、breadcrumb、說明與送出按鈕文案已切換為料件申請語意。
- 我的料件申請頁固定以 `resource_type = material` 篩選既有維修回報資料。

API / DB / Migration 影響：

- 無 DB schema 變更。
- 無 migration 變更。
- 無 db push。
- 無 RLS / RPC 變更。
- 無 API contract 變更。
- 料件申請仍沿用既有 `maintenance_requests`、`maintenance_updates` 與附件資料流；未建立 `ga_material_requests` 或其他第二套資料來源。

測試與 build：

- `node --check scripts/test-general-affairs-maintenance-views.js`：通過。
- `node --check scripts/test-general-affairs-ui-foundation.js`：通過。
- `node --check scripts/test-general-affairs-availability.js`：通過。
- `node scripts/test-general-affairs-maintenance-views.js`：通過。
- `node scripts/test-general-affairs-ui-foundation.js`：通過。
- `node scripts/test-general-affairs-availability.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過。仍有既有 Dynamic server usage 訊息，但不是 build failure。

發現問題 / 注意事項：

- Build 第一次因本專案 `next dev -p 3002` 鎖住 `.next/trace` 而失敗；已只停止本專案 dev process 後重跑 build，最終通過。
- 工作區目前有多個既有 dirty changes，本輪未 revert 或整理無關檔案。
- 正式料件申請流程尚未建立獨立 DB / API / 審核 / 庫存串接；目前是維修回報 material 類型的 route-level 正式入口。

下一個最小任務：

**人工複驗四個我的申請入口。**

驗收重點：

- 左側點擊 `新增回報` 進入 `/general-affairs/reports/new`。
- 左側點擊 `我的回報` 進入 `/general-affairs/reports/mine`。
- 左側點擊 `新增料件申請` 進入 `/general-affairs/part-requests/new`。
- 左側點擊 `我的料件申請` 進入 `/general-affairs/part-requests`。
- 四個頁面標題與按鈕文案各自正確。
- 我的料件申請只顯示料件 / 耗材。
- 無權限帳號仍由既有 permission / API / RLS 安全阻擋。

禁止事項：

- 不得因為有四個入口而建立未批准的第二套料件申請資料表。
- 不得用 query-string pseudo page 取代已確認需要獨立介面的 Sidebar 功能入口。
- 不得修改已套用 migration。
- 不得執行 db push / repair / reset / rollback。
- 不得操作 Production。

### 督導管理日誌測試區入口與前端骨架

完成狀態：**本機實作完成；靜態測試、TypeScript 與 build 通過；等待人工 UI 複驗。**

更新時間：2026-08-12

任務名稱：督導管理日誌 SML-0A：測試區獨立 Navbar 入口與模組首頁骨架。

背景：

- 使用者確認「督導管理日誌」應先在測試區建立，並在上方 Bar 獨立出一個功能區塊。
- 此模組不是督導巡店，也不是一般工作日誌 CRUD。
- 本輪只做可見入口與安全的前端骨架，不建立 DB / API / migration。

修改檔案：

- `components/Navbar.tsx`
- `hooks/useNavbarPermissions.ts`
- `app/supervisor-management-log/page.tsx`
- `scripts/test-supervisor-management-log-ui.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`
- `.github/copilot-instructions.md`

UI 影響：

- 上方 Bar 新增獨立入口：`督導管理日誌`。
- 新增 route：`/supervisor-management-log`。
- Desktop Navbar 與 Mobile menu 使用同一 permission flag。
- Active state 使用 `pathname.startsWith('/supervisor-management-log')`。
- 頁面內容採測試區基底語意：
  - 顯示 Product Principle：發現、判斷、管理動作、追蹤結果。
  - 顯示「今日待追蹤 / 進行中案件 / 本週完成 / 逾期追蹤」卡片，但 value 為 `-`，不顯示假數字。
  - 顯示預計流程：新增管理紀錄、快速口述紀錄、案件 Timeline、主管管理總覽。
  - 明確標示目前尚未建立 DB foundation，不寫入資料庫。

RBAC 影響：

- `NavbarPermissions` 新增：
  - `canAccessSupervisorManagementLog`
- 預留正式 permission codes：
  - `supervisor.management_log.view_own`
  - `supervisor.management_log.view_team`
  - `supervisor.management_log.create`
  - `supervisor.management_log.follow_up`
  - `supervisor.management_log.manage`
- Full Admin / admin compatibility 會因既有 `hasPermissionCode` / `hasAnyPermissionCode` 邏輯顯示入口。
- 一般使用者需等後續 DB reference data migration 建立 permission code 並指派角色後才會顯示入口。

API / DB / Migration 影響：

- 無 DB schema 變更。
- 無 migration。
- 無 db push。
- 無 RLS / RPC。
- 無 API contract 變更。
- 未建立 `supervisor_management_cases`、`supervisor_management_records` 或 `supervisor_management_followups`。

測試與 build：

- `node --check scripts/test-supervisor-management-log-ui.js`：通過。
- `node scripts/test-supervisor-management-log-ui.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過。仍有既有 Dynamic server usage 訊息，但不是 build failure。

發現問題 / 尚未完成：

- 尚未建立正式 RBAC permission reference data。
- 尚未設計 / 建立 DB foundation migration。
- 尚未設計 RLS scope：督導本人、經理 / 區主管、Full Admin。
- 尚未建立任何 API 或資料寫入流程。
- 尚未做 Speech-to-Text / AI 結構化；AI 必須等人工確認後才可儲存。

下一個最小任務：

**人工複驗上方 Bar `督導管理日誌` 入口。**

複驗通過後，下一個可批准任務：

**SML-1：督導管理日誌 DB / RBAC / RLS Foundation 設計與 migration 建立。**

SML-1 應至少規劃：

- `supervisor_management_categories`
- `supervisor_management_cases`
- `supervisor_management_records`
- `supervisor_management_followups`
- `supervisor_management_case_events`
- permission reference data
- RLS helper / policies
- test SQL

禁止事項：

- 不得把此模組併入 `inspection` 或 `cross_dept` 既有功能碼。
- 不得用記錄數當作督導績效。
- 不得顯示假案件、假 KPI、假 AI 摘要。
- 不得讓 AI 直接寫入正式 Management Record，必須先進確認畫面。
- 不得修改已套用 migration。
- 不得操作 Production。

### 督導管理日誌 DB / RBAC / RLS Foundation

完成狀態：**本機 migration / rollback / test SQL / 靜態測試完成；尚未 dry-run、尚未 DEV db push。**

最新狀態補充（2026-08-12）：**已正式推送 DEV；local / remote aligned；尚未執行 DB test SQL。**

更新時間：2026-08-12

任務名稱：SML-1：督導管理日誌 DB / RBAC / RLS Foundation。

背景：

- 使用者確認「督導管理日誌」要先在測試區建立，並以獨立上方 Bar 功能區塊進入。
- SML-0A 已完成前端入口與不顯示假資料的首頁骨架。
- 本輪建立資料庫 foundation，但不執行遠端操作，不推送 DEV，不操作 Production。

修改檔案：

- `supabase/migration_supervisor_management_log_foundation.sql`
- `supabase/migrations/20260812093000_supervisor_management_log_foundation.sql`
- `supabase/rollback_supervisor_management_log_foundation.sql`
- `supabase/test_supervisor_management_log_foundation.sql`
- `scripts/test-supervisor-management-log-foundation.js`
- `hooks/useNavbarPermissions.ts`
- `scripts/test-supervisor-management-log-ui.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

DB / Migration 影響：

- 新增 local-only migration：
  - `20260812093000_supervisor_management_log_foundation.sql`
- 平放來源 SQL 與標準 migration 內容一致。
- SHA-256：
  - `DDC1C84874CF980BEBD44E3FE6F535E2F4BCBFF6BDED195B412F72A9AE92BE1F`
- 已套用 migrations 未修改。
- 未執行 `db push`。
- 未執行 `migration repair`。
- 未執行 `db reset`。
- 未執行 rollback。

新增 RBAC permission reference data：

- `supervisor.management_log.view_own`
- `supervisor.management_log.view_team`
- `supervisor.management_log.create`
- `supervisor.management_log.update_own`
- `supervisor.management_log.follow_up`
- `supervisor.management_log.manage`
- `supervisor.management_category.manage`

Navbar 權限同步：

- `canAccessSupervisorManagementLog` 已納入 `update_own`，避免使用者只有「編輯自己日誌」權限時看不到入口。
- 仍使用 effective permissions，不使用 email、職稱、role name 或 `profiles.role` 硬判斷。

新增資料表：

- `supervisor_management_categories`
- `supervisor_management_cases`
- `supervisor_management_records`
- `supervisor_management_followups`
- `supervisor_management_case_events`

設計重點：

- `supervisor_management_cases` 表示管理案件，保存：
  - owner / assigned user
  - target type
  - store scope
  - employee link
  - target snapshot
  - status / priority / follow-up date
- `supervisor_management_records` 表示一次正式管理紀錄，保存：
  - 發現 / 觀察
  - 判斷
  - 管理動作
  - 追蹤需求
  - AI 產生與人工確認欄位
- `supervisor_management_followups` 表示追蹤結果。
- `supervisor_management_case_events` 表示 timeline / audit event。
- 人員目標使用既有 `store_employees`，並用 `target_name_snapshot` 保留歷史上下文。
- 門市範圍使用既有 `store_managers`，不建立第二套主管 scope。

RLS / Scope：

- 所有督導管理日誌資料表均啟用 RLS。
- 不建立 DELETE policy。
- `view_own` 可看自己建立或指派給自己的案件。
- `view_team` 可看自己 `store_managers` 管轄門市範圍內的案件。
- `manage` 可管理全部案件與分類。
- records / followups / events 讀取範圍依 parent case visibility helper。
- helper 使用 `SECURITY DEFINER` 與 `search_path = public, pg_temp`。

Soft delete：

- 新增：
  - `supervisor_management_soft_delete_case(uuid, text)`
  - `supervisor_management_soft_delete_record(uuid, text)`
- Case soft delete 會同步 soft delete 未刪除的 records / followups。
- 已刪除資料不重寫。
- 不提供 hard delete policy。

API / UI 影響：

- 本輪未新增 API route。
- 本輪未新增資料寫入 UI。
- 本輪只同步 Navbar permission gate 的 `update_own`。
- 既有 `/supervisor-management-log` 首頁仍為安全骨架，不顯示假 KPI 或假案件。

測試：

- `node --check scripts/test-supervisor-management-log-foundation.js`：通過。
- `node scripts/test-supervisor-management-log-foundation.js`：通過。
- `node --check scripts/test-supervisor-management-log-ui.js`：通過。
- `node scripts/test-supervisor-management-log-ui.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `git diff --check`：通過，只有既有 LF / CRLF 提醒。
- `npm run build`：通過。第一次因本專案 Next dev server 鎖住 `.next/trace` 造成 `EPERM`，停止佔用 3002 的本專案 process 後重跑成功。仍有既有 Dynamic server usage 訊息，但不是 build failure。

測試保護內容：

- source SQL 與標準 migration 全文一致。
- migration timestamp 晚於 `20260810090000`。
- migration 只包含督導管理日誌 foundation scope。
- 不耦合 `inspection`、`cross_dept`、`general_affairs` 或 `maintenance` 模組資料表。
- RLS enabled。
- 無 DELETE policy。
- anon 無 table grants。
- store scope 使用既有 `store_managers`。
- employee target 使用既有 `store_employees`。
- rollback 只移除督導管理日誌物件與本模組 permission codes。

發現問題 / 尚未完成：

- `20260812093000_supervisor_management_log_foundation.sql` 已由使用者完成 dry-run 與正式 DEV db push。
- 最近一次 migration list 顯示 `20260812093000 / 20260812093000` local / remote aligned。
- 尚未執行 DB test SQL。
- 尚未建立 API。
- 尚未建立正式列表、案件、紀錄、追蹤 UI。
- 尚未建立 AI 語音整理草稿 / 人工確認流程。

下一個最小任務：

**SML-1 DB test SQL 驗證。**

建議流程：

1. 執行 App Guard。
2. 執行 CLI Guard。
3. 執行 `npx supabase migration list`。
4. 確認所有 migrations local / remote aligned，沒有 local-only 或 unknown migration。
5. 在 DEV 執行 `supabase/test_supervisor_management_log_foundation.sql`。
6. 確認 permissions、tables、functions、RLS、grants、no DELETE policy 都通過。
7. 停止，等待使用者批准下一階段 API / UI。

禁止事項：

- 不得修改已套用 migration。
- 不得 repair / reset / rollback。
- 不得操作 Production。
- 不得開始督導管理日誌 API / 寫入 UI。
- 不得顯示假案件、假 KPI、假 AI 結果。

#### SML-1 DEV Push 結果

使用者回報：

- `npx supabase db push --dry-run` 第二次只列：
  - `20260812093000_supervisor_management_log_foundation.sql`
- `20260812093000_supervisor_management_log_foundation.sql` 已正式推送 DEV。
- `npx supabase migration list` 顯示：
  - `20260810090000 | 20260810090000`
  - `20260812093000 | 20260812093000`
- 目前沒有 SML-1 local-only migration。

尚未執行：

- `supabase/test_supervisor_management_log_foundation.sql`
- API / UI 寫入流程
- 動態 RLS 測試

### 前置附件相容 Migration 單獨推送

完成狀態：**已正式推送 DEV；local / remote aligned。**

更新時間：2026-08-12

任務名稱：隔離並推送前置 pending migration `20260810090000_allow_part_resource_attachments.sql`。

背景：

- 使用者準備 dry-run 督導管理日誌 `20260812093000_supervisor_management_log_foundation.sql` 時，CLI dry-run 同時列出：
  - `20260810090000_allow_part_resource_attachments.sql`
  - `20260812093000_supervisor_management_log_foundation.sql`
- 使用者確認 `20260810090000` 未曾手動套用。
- 使用者批准先處理 `20260810090000`。

操作摘要：

- 執行 App DEV Guard：通過。
- 執行 CLI DEV Guard：通過。
- 將 `20260812093000_supervisor_management_log_foundation.sql` 暫時移至 `.tmp-migration-hold`，使 CLI 只看到 `20260810090000`。
- 暫存前 `20260812093000` SHA-256：
  - `1BF84BF8DB2EE3CD87038C2696278D5C3536C46B6D5684678AD717CC1CD6369D`
- 執行 `npx supabase migration list`：
  - 只有 `20260810090000` local-only。
- 執行 `npx supabase db push --dry-run`：
  - 只列 `20260810090000_allow_part_resource_attachments.sql`。
- 執行 `npx supabase db push`：
  - `20260810090000_allow_part_resource_attachments.sql` 推送成功。
- Push 後 `npx supabase migration list`：
  - `20260810090000 / 20260810090000` aligned。
- 將 `20260812093000_supervisor_management_log_foundation.sql` 放回 `supabase/migrations`。
- 恢復後 SHA-256 仍為：
  - `1BF84BF8DB2EE3CD87038C2696278D5C3536C46B6D5684678AD717CC1CD6369D`

目前 migration 狀態：

- `20260810090000_allow_part_resource_attachments.sql`：local / remote aligned。
- `20260812093000_supervisor_management_log_foundation.sql`：唯一 local-only migration。

未執行事項：

- 未推送 `20260812093000`。
- 未執行督導管理日誌 dry-run。
- 未執行督導管理日誌 DB test SQL。
- 未操作 Production。
- 未 repair / reset / rollback。

下一個最小任務：

**SML-1 DEV dry-run 驗證。**

下一輪應確認 dry-run 只列：

- `20260812093000_supervisor_management_log_foundation.sql`

### 督導管理日誌 SML-2：API 與第一版作業 UI

完成狀態：**本機實作與靜態驗證完成；尚未做 DEV 動態 API / UI 人工驗收。**

更新時間：2026-08-12

任務名稱：SML-2 Supervisor Management Log API / UI Foundation。

範圍：

- 沿用 SML-1 已建立的 DB / RBAC / RLS foundation。
- 建立督導管理日誌 server API。
- 將 `/supervisor-management-log` 從安全骨架改為第一版可操作工作台。
- 不建立 AI 語音整理流程。
- 不修改 DB schema、migration、RLS、RPC 或 grants。

修改檔案：

- `lib/supervisor-management-log/access.ts`
- `lib/supervisor-management-log/validation.ts`
- `app/api/supervisor-management-log/categories/route.ts`
- `app/api/supervisor-management-log/options/route.ts`
- `app/api/supervisor-management-log/cases/route.ts`
- `app/api/supervisor-management-log/cases/[id]/route.ts`
- `app/api/supervisor-management-log/cases/[id]/records/route.ts`
- `app/api/supervisor-management-log/cases/[id]/followups/route.ts`
- `app/supervisor-management-log/page.tsx`
- `scripts/test-supervisor-management-log-ui.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

API routes：

- `GET /api/supervisor-management-log/categories`
  - 讀取啟用分類。
  - 需登入與督導管理日誌讀取權限。
- `GET /api/supervisor-management-log/options`
  - 讀取可見分類、門市與人員選項。
  - 使用 authenticated Supabase client，資料範圍依 RLS / API 權限。
- `GET /api/supervisor-management-log/cases`
  - 支援 `page`、`pageSize`、`status`、`targetType`、`storeId`、`search`、`sortBy`、`sortOrder`。
  - 只回傳未 soft deleted cases。
- `POST /api/supervisor-management-log/cases`
  - 建立 Management Case。
  - `owner_user_id` 由 server 端 `auth.uid()` 對應 user id 決定，不接受 client 偽造 system fields。
- `GET /api/supervisor-management-log/cases/[id]`
  - 讀取案件詳情與 records / followups / events。
- `PATCH /api/supervisor-management-log/cases/[id]`
  - 更新案件可編輯欄位。
  - 不接受 system fields。
- `DELETE /api/supervisor-management-log/cases/[id]`
  - 呼叫 `supervisor_management_soft_delete_case(uuid, text)`。
  - 不提供 hard delete。
- `GET / POST /api/supervisor-management-log/cases/[id]/records`
  - 讀取與新增 Management Record。
- `GET / POST /api/supervisor-management-log/cases/[id]/followups`
  - 讀取與新增 Follow-up。

Permission guard：

- `canViewSupervisorManagementLog(userId)`：
  - `supervisor.management_log.view_own`
  - `supervisor.management_log.view_team`
  - `supervisor.management_log.manage`
- `canCreateSupervisorManagementLog(userId)`：
  - `supervisor.management_log.create`
  - `supervisor.management_log.manage`
- `canUpdateSupervisorManagementLog(userId)`：
  - `supervisor.management_log.update_own`
  - `supervisor.management_log.follow_up`
  - `supervisor.management_log.manage`
- `canManageSupervisorManagementLog(userId)`：
  - `supervisor.management_log.manage`

Validation：

- UUID 格式檢查。
- system fields 防偽：
  - `id`
  - `created_at`
  - `created_by`
  - `updated_at`
  - `updated_by`
  - `deleted_at`
  - `deleted_by`
  - `deletion_reason`
- case target type、status、priority enum 驗證。
- record type / follow-up status 驗證。
- deletion reason trim 與必填驗證。

UI：

- `/supervisor-management-log` 已改為第一版作業工作台。
- 顯示內容：
  - 案件 KPI。
  - status / target type / keyword 篩選。
  - 分頁案件列表。
  - 建立管理案件表單。
  - 選取案件詳情。
  - 新增管理紀錄。
  - 新增追蹤紀錄。
- UI 不顯示假案件、假 KPI、假追蹤或假 AI 結果。
- AI / 語音整理尚未開始；若未來實作，仍必須先產生待確認草稿，經人工確認後才可寫入正式紀錄。

Security / RLS 原則：

- API 全部使用 authenticated Supabase client。
- 不使用 `createAdminClient` 繞過受測 RLS。
- 前端顯示與 action 入口只改善 UX；API、RPC、RLS 仍是正式安全邊界。
- store scope 不由前端推算或擴大。

測試：

- `node --check scripts/test-supervisor-management-log-ui.js`：通過。
- `node scripts/test-supervisor-management-log-ui.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過，exit code 0。

測試覆蓋摘要：

- Navbar / mobile entry 保留督導管理日誌獨立入口。
- Permission code references 存在。
- `/supervisor-management-log` 使用真實 API，不顯示假作業資料。
- SML-2 API routes 存在並使用 authenticated user 與 permission guard。
- API routes 不使用 `createAdminClient`。
- validation helper 阻擋 system fields 偽造。

DB / Migration 影響：

- 本任務未新增 migration。
- 本任務未修改任何已套用 migration。
- 本任務未執行 `db push`、`repair`、`reset` 或 rollback。
- 若後續發現 DB / RPC 問題，只能建立新的 forward migration。

發現問題 / 尚未完成：

- 尚未執行 DEV authenticated 動態 API 驗收。
- 尚未執行人工 UI 驗收。
- 尚未驗證各角色實際 store scope 顯示。
- 尚未建立 AI 語音整理草稿 / 人工確認流程。

下一個最小任務：

**SML-2 DEV API / UI 動態驗收。**

建議驗收：

1. 執行 App Guard、CLI Guard、migration list。
2. 確認所有 migrations local / remote aligned。
3. 啟動 `npm run dev -- -p 3002`。
4. 以有權限 DEV 使用者驗證：
   - list cases
   - create case
   - add management record
   - add follow-up
   - detail view
5. 以無權限 DEV 使用者驗證：
   - API 403
   - UI permission denied
6. 驗證 store scope 只依 API / RLS。
7. 驗證 UI 不顯示假資料或未完成 AI 功能。

禁止事項：

- 不得操作 Production。
- 不得修改已套用 migration。
- 不得 repair / reset / rollback。
- 不得用 service role 代替 authenticated user 驗證。
- 不得自行開始 AI 語音整理或下一階段。

### 督導管理日誌 SML-2A：RLS Helper EXECUTE Grants Forward Fix

完成狀態：**已正式推送 DEV；local / remote aligned；等待 DB test SQL 與 SML-2 動態驗收。**

更新時間：2026-08-12

問題：

- 使用者進入或讀取督導管理日誌時出現：
  - `permission denied for function supervisor_management_case_is_visible`
- 根因是 SML-1 migration 中 RLS policies 直接呼叫：
  - `supervisor_management_case_is_visible(uuid)`
  - `supervisor_management_case_is_manageable(uuid)`
  - `supervisor_management_current_user_manages_store(uuid)`
- 但 grants 區塊先對這些 helper 執行：
  - `REVOKE ALL ... FROM PUBLIC, anon, authenticated`
- PostgreSQL policy expression 執行時，authenticated 角色仍需要 function EXECUTE privilege，因此 PostgREST 查表會被擋。

修正方式：

- 不修改已套用 migration `20260812093000_supervisor_management_log_foundation.sql`。
- 新增 forward fix migration：
  - `supabase/migrations/20260812153524_grant_supervisor_management_rls_helper_execute.sql`
- Migration 只包含：
  - 對三個 RLS helper 確認 PUBLIC / anon 無 EXECUTE。
  - 對三個 RLS helper 授權 authenticated EXECUTE。
  - `NOTIFY pgrst, 'reload schema';`
- 不修改 tables、RLS policies、RPC 邏輯、constraints、indexes 或資料。

實際 SQL 摘要：

- `REVOKE ALL ON FUNCTION public.supervisor_management_current_user_manages_store(uuid) FROM PUBLIC, anon;`
- `REVOKE ALL ON FUNCTION public.supervisor_management_case_is_visible(uuid) FROM PUBLIC, anon;`
- `REVOKE ALL ON FUNCTION public.supervisor_management_case_is_manageable(uuid) FROM PUBLIC, anon;`
- `GRANT EXECUTE ON FUNCTION public.supervisor_management_current_user_manages_store(uuid) TO authenticated;`
- `GRANT EXECUTE ON FUNCTION public.supervisor_management_case_is_visible(uuid) TO authenticated;`
- `GRANT EXECUTE ON FUNCTION public.supervisor_management_case_is_manageable(uuid) TO authenticated;`

同步來源 SQL：

- 已同步：
  - `supabase/migration_supervisor_management_log_foundation.sql`
- 已套用 migration 保持不變：
  - `supabase/migrations/20260812093000_supervisor_management_log_foundation.sql`
- 已套用 migration SHA-256 仍為：
  - `DDC1C84874CF980BEBD44E3FE6F535E2F4BCBFF6BDED195B412F72A9AE92BE1F`

測試更新：

- `supabase/test_supervisor_management_log_foundation.sql`
  - 新增 authenticated 必須具備三個 RLS helper EXECUTE 的 catalog check。
  - 新增 PUBLIC / anon 不得具備三個 RLS helper EXECUTE 的 catalog check。
- `scripts/test-supervisor-management-log-foundation.js`
  - 改為檢查已套用 migration hash 不變。
  - 檢查平放來源 SQL 已包含 helper grants。
  - 檢查 forward fix 只包含 function grant 變更。

本機與 DEV 推送驗證：

- `node --check scripts/test-supervisor-management-log-foundation.js`：通過。
- `node scripts/test-supervisor-management-log-foundation.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- App DEV Guard：通過。
- CLI DEV Guard：通過。
- Push 前 `npx supabase migration list`：
  - 只有 `20260812153524` local-only。
- Push 前 `npx supabase db push --dry-run`：
  - 只列 `20260812153524_grant_supervisor_management_rls_helper_execute.sql`。
- `npx supabase db push`：
  - 成功套用 `20260812153524_grant_supervisor_management_rls_helper_execute.sql`。
- Push 後 `npx supabase migration list`：
  - `20260812153524 / 20260812153524` local / remote aligned。

尚未執行：

- 尚未執行 DB test SQL。
- 尚未重跑 SML-2 dynamic API / UI 驗收。

下一個最小任務：

**SML-2A 後續驗證：DB test SQL 與 SML-2 DEV API / UI 動態驗收。**

建議流程：

1. App Guard。
2. CLI Guard。
3. `npx supabase migration list`，確認所有 migrations local / remote aligned。
4. 執行 `supabase/test_supervisor_management_log_foundation.sql`。
5. 驗證 RLS helper grants：
   - authenticated 可 EXECUTE 三個 RLS helper。
   - anon / PUBLIC 不可 EXECUTE 三個 RLS helper。
6. 啟動 `npm run dev -- -p 3002`。
7. 回到 SML-2 dynamic API / UI 驗收。

禁止事項：

- 不得修改已套用 migration。
- 不得 repair / reset / rollback。
- 不得操作 Production。
- 不得把 helper EXECUTE 授權給 anon 或 PUBLIC。
- 不得用 service role 代替 authenticated user 驗證 RLS。

### 督導管理日誌 SML-2B：Module-local Permission Helper Forward Fix

完成狀態：**已正式推送 DEV；local / remote aligned；等待 DB test SQL 與 SML-2 動態驗收。**

更新時間：2026-08-12

問題：

- SML-2A 後，function EXECUTE 權限已正常。
- 使用者接著建立督導管理案件時出現：
  - `new row violates row-level security policy for table "supervisor_management_cases"`
- 判斷：
  - 這不是 helper EXECUTE grant 問題。
  - 這是 API server-side permission guard 與 DB RLS permission helper 判斷不一致。
  - API 使用 `has_permission(p_user_id, ...)` 與 admin-like compatibility fallback。
  - SML RLS / trigger 仍直接呼叫 legacy `current_user_has_permission(...)`。
  - Full Admin 或部分正式 RBAC 使用者可能 API guard 通過，但 DB RLS `WITH CHECK` 回 false。

修正方式：

- 不修改已套用 migration。
- 新增 forward fix migration：
  - `supabase/migrations/20260812154708_fix_supervisor_management_permission_helper.sql`
- 新增本模組 DB helper：
  - `supervisor_management_current_user_has_permission(text)`
- helper 使用：
  - `profiles.role = 'admin'` compatibility。
  - admin-like role codes：
    - `admin`
    - `system_admin`
    - `admin_role`
    - `full_admin`
    - `full_admin_role`
    - `dev_full_admin`
    - `owner`
    - `owner_role`
  - 正式 RBAC tables：
    - `user_roles`
    - `roles`
    - `role_permissions`
    - `permissions`
- 重建 SML 範圍內的 helper / trigger functions / policies，改用：
  - `public.supervisor_management_current_user_has_permission(...)`
- 不改：
  - tables
  - constraints
  - indexes
  - data
  - general affairs
  - maintenance
  - inventory
  - inspection

同步來源與測試：

- 已同步：
  - `supabase/migration_supervisor_management_log_foundation.sql`
- 已更新 rollback：
  - `supabase/rollback_supervisor_management_log_foundation.sql`
- 已更新 catalog test：
  - `supabase/test_supervisor_management_log_foundation.sql`
- 已更新靜態測試：
  - `scripts/test-supervisor-management-log-foundation.js`

本機與 DEV 推送驗證：

- `node --check scripts/test-supervisor-management-log-foundation.js`：通過。
- `node scripts/test-supervisor-management-log-foundation.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- App DEV Guard：通過。
- CLI DEV Guard：通過。
- Push 前 `npx supabase migration list`：
  - `20260812153524 / 20260812153524` aligned。
  - 只有 `20260812154708` local-only。
- Push 前 `npx supabase db push --dry-run`：
  - 只列 `20260812154708_fix_supervisor_management_permission_helper.sql`。
- `npx supabase db push`：
  - 成功套用 `20260812154708_fix_supervisor_management_permission_helper.sql`。
- Push 後 `npx supabase migration list`：
  - `20260812154708 / 20260812154708` local / remote aligned。

尚未執行：

- 尚未重跑 DB test SQL。
- 尚未重跑 SML-2 dynamic API / UI 驗收。

下一個最小任務：

**SML-2B 後續驗證：DB test SQL 與 SML-2 DEV API / UI 動態驗收。**

建議流程：

1. App Guard。
2. CLI Guard。
3. `npx supabase migration list`，確認所有 migrations local / remote aligned。
4. 執行 `supabase/test_supervisor_management_log_foundation.sql`。
5. 啟動 `npm run dev -- -p 3002`。
6. 回到 SML-2 dynamic API / UI 驗收。

禁止事項：

- 不得修改已套用 migration。
- 不得 repair / reset / rollback。
- 不得操作 Production。
- 不得放寬 RLS。
- 不得讓 anon / PUBLIC 取得不必要 function EXECUTE。
- 不得用 service role 代替 authenticated user 驗證。

### 督導管理日誌 SML-2C：Case Insert Visibility / Owner Guard Forward Fix

完成狀態：**已正式推送 DEV；local / remote aligned；等待 DB test SQL 與 SML-2 動態驗收。**

更新時間：2026-08-12

問題：

- SML-2B 後，使用者仍回報：
  - `new row violates row-level security policy for table "supervisor_management_cases"`
- 進一步判斷：
  - `POST /api/supervisor-management-log/cases` 使用 `.insert(payload).select('*').single()`。
  - PostgREST 的 `INSERT ... RETURNING` 需要新 row 通過 SELECT RLS。
  - API 的 `canViewSupervisorManagementLog` 已允許：
    - `view_own`
    - `view_team`
    - `create`
    - `update_own`
    - `follow_up`
    - `manage`
  - DB 的 `supervisor_management_case_is_visible` 仍只允許：
    - `view_own`
    - `view_team`
    - `manage`
  - 因此 create-only 使用者可以通過 API create guard 與 INSERT policy，但可能無法 RETURNING 自己剛建立的案件。

修正方式：

- 不修改已套用 migration。
- 新增 forward fix migration：
  - `supabase/migrations/20260812155612_fix_supervisor_management_case_insert_visibility.sql`
- 重建：
  - `supervisor_management_case_is_visible(uuid)`
  - `supervisor_management_validate_case()`
  - `supervisor_management_cases_insert` policy

新 visibility 規則：

- `manage`：可讀全部可見案件。
- `view_own` 或 `create`：可讀 owner 或 assigned 為自己的案件。
- `update_own`：可讀 owner 為自己的案件。
- `follow_up`：可讀 assigned 為自己，或自己管轄門市的案件。
- `view_team`：可讀自己管轄門市案件。

新增 direct INSERT 防線：

- `manage` 可建立案件。
- `create` 可建立案件，但 `owner_user_id` 必須等於 `auth.uid()`。
- `supervisor_management_validate_case()` 也會拒絕 non-manage 使用者偽造 `owner_user_id`。

同步來源與測試：

- 已同步：
  - `supabase/migration_supervisor_management_log_foundation.sql`
- 已更新靜態測試：
  - `scripts/test-supervisor-management-log-foundation.js`

本機與 DEV 推送驗證：

- `node --check scripts/test-supervisor-management-log-foundation.js`：通過。
- `node scripts/test-supervisor-management-log-foundation.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- App DEV Guard：通過。
- CLI DEV Guard：通過。
- Push 前 `npx supabase migration list`：
  - `20260812154708 / 20260812154708` aligned。
  - 只有 `20260812155612` local-only。
- Push 前 `npx supabase db push --dry-run`：
  - 只列 `20260812155612_fix_supervisor_management_case_insert_visibility.sql`。
- `npx supabase db push`：
  - 成功套用 `20260812155612_fix_supervisor_management_case_insert_visibility.sql`。
- Push 後 `npx supabase migration list`：
  - `20260812155612 / 20260812155612` local / remote aligned。

尚未執行：

- 尚未重跑 DB test SQL。
- 尚未重跑 SML-2 dynamic API / UI 驗收。

下一個最小任務：

**SML-2C 後續驗證：DB test SQL 與 SML-2 DEV API / UI 動態驗收。**

建議流程：

1. App Guard。
2. CLI Guard。
3. `npx supabase migration list`，確認所有 migrations local / remote aligned。
4. 執行 `supabase/test_supervisor_management_log_foundation.sql`。
5. 啟動 `npm run dev -- -p 3002`。
6. 回到 SML-2 dynamic API / UI 驗收。

禁止事項：

- 不得修改已套用 migration。
- 不得 repair / reset / rollback。
- 不得操作 Production。
- 不得放寬 direct INSERT owner guard。
- 不得用 service role 代替 authenticated user 驗證。

### 督導管理日誌 SML-2D：Create API Minimal Return Fix

完成狀態：**本機 API 修正、靜態測試、TypeScript 與 build 通過；等待人工複驗。**

更新時間：2026-08-13

問題：

- SML-2C forward migration 已推送後，使用者仍回報：
  - `new row violates row-level security policy for table "supervisor_management_cases"`
- 進一步檢查 API 發現：
  - `POST /api/supervisor-management-log/cases` 使用 `.insert(payload).select('*').single()`。
  - UI 建立案件後只需要重新載入列表，不需要 POST 回傳完整 row。
  - `select('*')` 會讓 PostgREST 執行 `INSERT ... RETURNING`，多觸發 SELECT RLS。

修正方式：

- 修改：
  - `app/api/supervisor-management-log/cases/route.ts`
- 將建立案件 API 改為：
  - `.insert(payload)`
  - 回傳 `{ success: true, data: null }`
- INSERT 本身仍受以下 DB 安全控制：
  - RLS INSERT policy。
  - `supervisor_management_validate_case()` trigger。
  - non-manage 使用者 `owner_user_id = auth.uid()` owner guard。
- 沒有使用 service role。
- 沒有修改 DB / migration / RLS / RPC。

測試：

- `scripts/test-supervisor-management-log-ui.js` 新增檢查：
  - case POST 必須 insert validated payload。
  - case POST 不得在 insert 後 chain `select()`，避免 INSERT RETURNING SELECT RLS trap。
  - case POST 應回傳 minimal success。
- `node --check scripts/test-supervisor-management-log-ui.js`：通過。
- `node scripts/test-supervisor-management-log-ui.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過，exit code 0。

Build 注意：

- 第一次 build 因本專案 3002 Next dev server 鎖定 `.next/trace` 出現 `EPERM`。
- 已只停止本專案 3002 Next process，未停止其他 node。
- 重跑 build 成功。
- 因 dev server 已被停止，人工複驗前需重新啟動：
  - `npm run dev -- -p 3002`

尚未完成：

- 尚未重啟 dev server 後複驗建立案件。
- 尚未執行 SML-2 DEV API / UI dynamic verification。
- 尚未執行 `supabase/test_supervisor_management_log_foundation.sql`。

下一個最小任務：

**重新啟動 dev server 後，人工複驗建立督導管理案件。**

若仍失敗，下一步不應再直接猜 migration；應先取得：

- HTTP status。
- response body。
- Supabase error code / details / hint。
- 使用者 effective permission codes。
- 該次 POST payload 的非敏感欄位。

禁止事項：

- 不得操作 Production。
- 不得修改已套用 migration。
- 不得用 service role 代替 authenticated user 建立案件。
- 不得為了通過 UI 暫時關閉 RLS 或放寬 owner guard。

### 督導管理日誌 SML-2E：Case Detail / Records / Followups Workbench

完成狀態：**本機實作、靜態測試、TypeScript 與 build 通過；等待 SML-2F 動態角色矩陣驗收。**

更新時間：2026-08-13

背景：

- SML-2D 修正後，使用者回報「成功建立」督導管理案件。
- 代表 `POST /api/supervisor-management-log/cases` minimal return fix 有效。
- 進一步盤點第一版 UI 發現：
  - 左側案件列表可查詢。
  - 右側可新增管理紀錄與追蹤結果。
  - 但點選案件時只使用列表摘要，沒有呼叫單筆詳情 API。
  - 現有 records / followups / events 沒有顯示，容易變成「只會寫入、不好追蹤」。
  - records / followups POST 仍使用 `.insert(payload).select('*').single()`，存在與 SML-2D 相同的 `INSERT ... RETURNING` SELECT RLS 風險。

修改檔案：

- `app/supervisor-management-log/page.tsx`
- `app/api/supervisor-management-log/cases/[id]/records/route.ts`
- `app/api/supervisor-management-log/cases/[id]/followups/route.ts`
- `scripts/test-supervisor-management-log-ui.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

API 影響：

- `POST /api/supervisor-management-log/cases/[id]/records`
  - 改為 `.insert(payload)`。
  - 回傳 `{ success: true, data: null }`。
  - 不再在 insert 後 chain `select()`。
- `POST /api/supervisor-management-log/cases/[id]/followups`
  - 改為 `.insert(payload)`。
  - 回傳 `{ success: true, data: null }`。
  - 不再在 insert 後 chain `select()`。
- Server-side permission guard、authenticated Supabase client、RLS、trigger、validation 均保留。
- 未修改 API route path 或 request payload contract。

UI 影響：

- `/supervisor-management-log` 選取案件時改為呼叫：
  - `GET /api/supervisor-management-log/cases/[id]`
- 新增 `detailLoading` 狀態，避免列表 loading 與詳情 loading 混在一起。
- 右側「案件後續紀錄」現在顯示：
  - 案件基本資料。
  - 案件狀態、目標類型、優先程度。
  - 門市、開案日、下次追蹤日、更新時間。
  - 管理紀錄。
  - 追蹤結果。
  - 事件時間線。
- 新增管理紀錄後：
  - 重新載入列表。
  - 重新抓取選取案件詳情。
- 新增追蹤結果後：
  - 重新載入列表。
  - 重新抓取選取案件詳情。
- UI 不顯示假紀錄、假追蹤或假事件。

DB / migration / RLS 影響：

- 無 DB schema 變更。
- 無 migration 變更。
- 無 RLS / RPC 變更。
- 無 Production 操作。
- 無 db push / repair / reset / rollback。

測試：

- `scripts/test-supervisor-management-log-ui.js` 新增檢查：
  - records / followups POST 不得在 insert 後 chain `select()`。
  - records / followups POST 應回傳 minimal success。
  - 頁面必須有 `loadCaseDetail`。
  - 頁面必須使用單筆案件詳情 API。
  - 頁面必須顯示管理紀錄、追蹤結果與事件時間線。
  - 頁面必須使用 `selectedCase.records`、`selectedCase.followups`、`selectedCase.events`。
- `node --check scripts/test-supervisor-management-log-ui.js`：通過。
- `node scripts/test-supervisor-management-log-ui.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過，exit code 0。

Build 注意：

- 第一次 build 因本專案 3002 dev server 鎖定 `.next/trace` 出現 `EPERM`。
- 已只停止本專案 3002 Next process，未停止其他專案 node process。
- 重跑 build 成功。
- Build 仍有既有 Dynamic server usage 訊息，非本輪 SML 變更造成 failure。

尚未完成：

- 尚未執行 `supabase/test_supervisor_management_log_foundation.sql`。
- 尚未執行 SML-2 DEV dynamic API / UI 驗收。
- 尚未人工複驗新增管理紀錄、追蹤結果、詳情時間線。
- 尚未驗證不同角色矩陣：
  - 無權限。
  - view_own。
  - view_team。
  - create。
  - update_own。
  - follow_up。
  - manage。

下一個最小任務：

**SML-2F：DEV 動態 API / UI 角色矩陣驗收。**

建議驗收：

1. 重新啟動 `npm run dev -- -p 3002`。
2. 有權限帳號進入 `/supervisor-management-log`。
3. 點選案件，確認右側詳情顯示管理紀錄、追蹤結果與事件時間線。
4. 新增管理紀錄，確認右側詳情刷新。
5. 新增追蹤結果，確認右側詳情刷新。
6. 無權限帳號不得看到入口，直接進入 route / API 也應被阻擋。
7. 督導 / 店長 / manager-like 帳號的可見範圍不得超過 API / RLS scope。

禁止事項：

- 不得操作 Production。
- 不得修改已套用 migration。
- 不得用 service role 代替 authenticated user 驗證。
- 不得為了 UI 顯示假資料。
- 不得直接關閉 RLS 或放寬 owner / store scope。
- 不得開始 AI / 語音整理流程，直到 SML-2 dynamic verification 通過。

### 督導管理日誌 SML-2F：Final Workbench Operations Before Manual QA

完成狀態：**本機實作、靜態測試、TypeScript 與 build 通過；等待使用者人工總驗收。**

更新時間：2026-08-13

任務目的：

- 使用者表示不需要再拆太細，希望直接做到日誌程式設計最後，再由使用者做驗收。
- 本輪將 SML 工作台補到可整體操作的驗收狀態。

修改檔案：

- `app/supervisor-management-log/page.tsx`
- `app/api/supervisor-management-log/cases/[id]/route.ts`
- `scripts/test-supervisor-management-log-ui.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

已完成 UI / API 功能：

- `/supervisor-management-log` 支援：
  - KPI 摘要。
  - 狀態 / 目標類型 / 關鍵字篩選。
  - 分頁案件列表。
  - 新增管理案件。
  - 點選案件讀取單筆詳情。
  - 顯示案件基本資料。
  - 顯示管理紀錄。
  - 顯示追蹤結果。
  - 顯示事件時間線。
  - 新增管理紀錄。
  - 新增追蹤結果。
  - 編輯案件。
  - soft delete 案件並要求刪除原因。
- 案件編輯欄位：
  - title
  - category_id
  - status
  - priority
  - next_follow_up_at
  - summary
- 新增管理紀錄與追蹤結果後，會重新載入列表與案件詳情。
- soft delete 成功後清除目前選取案件並重新載入列表。

RLS / API safety：

- `PATCH /api/supervisor-management-log/cases/[id]` 已改為 `.update(payload)` minimal success。
- 不再使用 `.update(payload).select('*').single()`，避免 `UPDATE ... RETURNING` 觸發額外 SELECT RLS。
- 以下 API 均已採 minimal return：
  - `POST /api/supervisor-management-log/cases`
  - `PATCH /api/supervisor-management-log/cases/[id]`
  - `POST /api/supervisor-management-log/cases/[id]/records`
  - `POST /api/supervisor-management-log/cases/[id]/followups`
- DELETE 仍使用既有 `supervisor_management_soft_delete_case(uuid, text)` RPC。
- 未使用 service role。
- 未放寬 RLS。
- 未修改 DB / migration / RPC。

測試：

- `scripts/test-supervisor-management-log-ui.js` 新增檢查：
  - case PATCH 不得 chain `select()`。
  - case PATCH 回傳 minimal success。
  - UI 必須有案件編輯入口。
  - UI 必須有 soft delete 入口。
  - soft delete 必須送出 `deletion_reason`。
  - delete action 必須提示輸入刪除原因。
- `node --check scripts/test-supervisor-management-log-ui.js`：通過。
- `node scripts/test-supervisor-management-log-ui.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過，exit code 0。

Build 注意：

- 第一次 build 出現 `.next` / dev server 狀態相關錯誤。
- 已只停止本專案 3002 Next process。
- 重跑 build 成功。
- 既有 Dynamic server usage 訊息仍存在，但不是 SML 變更造成 build failure。

未執行：

- 未執行 `supabase/test_supervisor_management_log_foundation.sql`。
- 未執行 DB 遠端操作。
- 未執行 db push。
- 未執行 repair / reset / rollback。
- 未操作 Production。

下一個最小任務：

**SML 人工總驗收。**

建議人工驗收：

1. 重新啟動 `npm run dev -- -p 3002`。
2. 進入 `/supervisor-management-log`。
3. 建立案件。
4. 點選案件後確認右側詳情顯示。
5. 編輯案件狀態 / 優先度 / 追蹤日 / 摘要。
6. 新增管理紀錄。
7. 新增追蹤結果。
8. 確認事件時間線與紀錄區塊有同步刷新。
9. soft delete 測試案件並輸入刪除原因。
10. 以無權限帳號確認入口、route、API 被阻擋。

禁止事項：

- 不得修改已套用 migration。
- 不得用 service role 代替 authenticated user 驗證。
- 不得為了通過 UI 顯示假資料。
- 不得直接關閉 RLS 或放寬 owner / store scope。
- 不得開始 AI / 語音整理流程，直到人工總驗收通過。

### 督導管理日誌 SML-2F：本機自動驗收與 smoke test

完成狀態：**本機自動驗收、TypeScript、build 與未登入 API smoke test 通過；等待使用者以實際 DEV 帳號做最後人工 UI / 角色矩陣驗收。**

更新時間：2026-08-13

任務背景：

- 使用者表示本次設計範疇不需要過多中途確認，可直接做到督導管理日誌程式設計的最後，再由使用者做人工驗收。
- 本輪未新增功能需求，重點是把 SML-2E 後的可驗收狀態重新確認到底。
- 因實際登入帳號密碼不可由代理輸入或保存，本輪只做本機自動驗證與未登入 smoke test；有權限角色矩陣仍需使用者人工登入驗收。

驗證範圍：

- DB / migration：
  - 未新增或修改 migration。
  - 未執行 db push、repair、reset、rollback。
  - 未操作 Production。
- API：
  - `GET /api/supervisor-management-log/cases` 未登入回 401。
  - `GET /api/supervisor-management-log/options` 未登入回 401。
  - API routes 仍使用 authenticated Supabase client 與 server-side permission guards。
  - 未使用 service role 代替受測 RLS。
- UI：
  - `/supervisor-management-log` 本機 smoke test 回 200。
  - 頁面仍使用真實 SML API，不顯示假案件、假 KPI、假紀錄、假 AI 結果。
  - Navbar / mobile entry 仍指向獨立 `/supervisor-management-log`。

執行結果：

- `node --check scripts/test-supervisor-management-log-foundation.js`：通過。
- `node scripts/test-supervisor-management-log-foundation.js`：通過。
- `node --check scripts/test-supervisor-management-log-ui.js`：通過。
- `node scripts/test-supervisor-management-log-ui.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過，exit code 0。
- Build 仍有既有 Dynamic server usage 訊息，非 SML failure。
- 本機 dev server smoke test：
  - `GET /supervisor-management-log`：200。
  - 未登入 `GET /api/supervisor-management-log/cases`：401。
  - 未登入 `GET /api/supervisor-management-log/options`：401。
- Smoke test 結束時確認 3002 沒有 Listen，未留下本輪 dev server。

尚未完成：

- 尚未由使用者以實際 DEV 帳號人工複驗：
  - 進入 `/supervisor-management-log`。
  - 案件列表與篩選。
  - 點選案件後右側詳情。
  - 管理紀錄。
  - 追蹤結果。
  - 事件時間線。
  - 新增管理紀錄後即時刷新。
  - 新增追蹤結果後即時刷新。
- 尚未完整人工驗證角色矩陣：
  - no access。
  - `supervisor.management_log.view_own`。
  - `supervisor.management_log.view_team`。
  - `supervisor.management_log.create`。
  - `supervisor.management_log.update_own`。
  - `supervisor.management_log.follow_up`。
  - `supervisor.management_log.manage`。
- 尚未重跑 `supabase/test_supervisor_management_log_foundation.sql`。
- 尚未開始 AI 語音整理草稿 / 人工確認流程。

下一個最小任務：

**SML-2F 人工驗收收尾。**

人工驗收建議：

1. 啟動 `npm run dev -- -p 3002`。
2. 使用有 SML 權限的 DEV 帳號登入。
3. 進入 `/supervisor-management-log`。
4. 確認列表、KPI、篩選、分頁使用真實資料。
5. 點選案件，確認右側顯示基本資料、管理紀錄、追蹤結果與事件時間線。
6. 新增管理紀錄，確認 API 成功且詳情刷新。
7. 新增追蹤結果，確認 API 成功且詳情刷新。
8. 使用無權限帳號確認 Navbar、route、API 均被擋。
9. 使用不同 SML 權限帳號確認可見範圍未超過 API / RLS scope。

禁止事項：

- 不得操作 Production。
- 不得修改已套用 migration。
- 不得用 service role 代替 authenticated user 驗證。
- 不得為 SML 顯示假資料或假 AI 結果。
- 不得開始 AI / 語音整理流程，直到 SML-2F 人工角色矩陣驗收通過。

### 督導管理日誌 SML-2G：Operational Log Form Completion

完成狀態：**本機實作、靜態測試、TypeScript、build 與 smoke test 通過；等待使用者人工總驗收。**

更新時間：2026-08-13

任務背景：

- 使用者詢問督導管理日誌是否已完成整個設計，並要求若尚未完成就直接完成到最後，再由使用者驗收。
- 經檢查，SML-2F 已具備案件、詳情、管理紀錄、追蹤結果與事件時間線，但前端尚未完整露出 DB / validation 已支援的正式日誌欄位。
- 本輪只補 UI 與靜態測試，不修改 API contract、DB schema、migration、RLS 或 RPC。

修改檔案：

- `app/supervisor-management-log/page.tsx`
- `scripts/test-supervisor-management-log-ui.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

已完成 UI 功能：

- 管理紀錄表單新增：
  - `record_type`：紀錄類型，使用集中式 `RECORD_TYPE` label。
  - `record_date`：紀錄日期。
  - `action_options`：管理動作項目，可多選。
  - `follow_up_method`：追蹤方式，僅在需要追蹤時顯示。
- 管理紀錄詳情新增顯示：
  - 中文紀錄類型。
  - 管理動作項目。
  - 追蹤方式。
- 追蹤結果表單新增：
  - `source_record_id`：可關聯來源管理紀錄。
  - `follow_up_date`：實際追蹤日期。
  - 集中式 `FOLLOWUP_STATUS` 狀態選項。
- 追蹤結果詳情新增顯示：
  - 關聯來源管理紀錄摘要。
- KPI 語意修正：
  - 全部案件卡使用 API `meta.total`，代表目前查詢範圍總量。
  - 狀態卡使用目前頁資料統計，helper 改為「目前頁資料」，避免誤認為全資料總量。

資料與安全：

- 沒有新增假案件、假 KPI、假紀錄或假 AI 結果。
- 表單欄位都送到既有 validation / API 已支援的欄位。
- 未新增 API route。
- 未修改 API contract。
- 未使用 service role。
- 未修改 RLS / RPC。
- 未新增或修改 migration。
- 未執行 db push、repair、reset、rollback。
- 未操作 Production。

測試：

- `node --check scripts/test-supervisor-management-log-ui.js`：通過。
- `node scripts/test-supervisor-management-log-ui.js`：通過。
- `node --check scripts/test-supervisor-management-log-foundation.js`：通過。
- `node scripts/test-supervisor-management-log-foundation.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過，exit code 0。
- `git diff --check -- app/supervisor-management-log/page.tsx scripts/test-supervisor-management-log-ui.js docs/CURRENT-DEV-STATUS.md docs/DEV-RBAC-HANDOFF.md`：通過；docs 仍有既有 LF/CRLF warning。
- 本機 dev server smoke test：
  - `GET /supervisor-management-log`：200。
  - 未登入 `GET /api/supervisor-management-log/cases`：401。
  - smoke test 結束後確認 3002 未留下本輪 Listen。

Build 注意：

- Build 仍有既有 Dynamic server usage 訊息，非 SML-2G 變更造成 failure。

尚未完成：

- 尚未由使用者以實際 DEV 帳號人工總驗收。
- 尚未人工驗證完整角色矩陣：
  - 無權限。
  - `supervisor.management_log.view_own`。
  - `supervisor.management_log.view_team`。
  - `supervisor.management_log.create`。
  - `supervisor.management_log.update_own`。
  - `supervisor.management_log.follow_up`。
  - `supervisor.management_log.manage`。
- 尚未重跑 `supabase/test_supervisor_management_log_foundation.sql`。
- 尚未開始 AI 語音整理草稿 / 人工確認流程。

下一個最小任務：

**SML 人工總驗收。**

人工驗收建議：

1. 啟動 `npm run dev -- -p 3002`。
2. 使用有 SML 權限的 DEV 帳號登入。
3. 進入 `/supervisor-management-log`。
4. 確認案件列表、KPI、篩選、分頁使用真實資料。
5. 建立案件並點選案件。
6. 新增管理紀錄，確認紀錄類型、日期、管理動作項目、追蹤方式與預期改善結果可保存並顯示。
7. 新增追蹤結果，確認可關聯來源管理紀錄、填寫追蹤日期、結果狀態與下次追蹤日期。
8. 確認新增後右側詳情與事件時間線同步刷新。
9. 編輯案件狀態 / 優先度 / 追蹤日 / 摘要。
10. soft delete 測試案件並輸入刪除原因。
11. 以無權限帳號確認入口、route、API 均被阻擋。

禁止事項：

- 不得操作 Production。
- 不得修改已套用 migration。
- 不得用 service role 代替 authenticated user 驗證。
- 不得為 SML 顯示假資料或假 AI 結果。
- 不得直接關閉 RLS 或放寬 owner / store scope。
- 不得開始 AI / 語音整理流程，直到 SML 人工總驗收通過。

### 督導管理日誌 UX Phase 1：UX / Architecture Review

完成狀態：**已完成 review 文件；未修改 DB / migration / RLS / API contract；下一步為 SML-UX-2A。**

更新時間：2026-08-13

任務背景：

- 使用者提供「督導管理日誌 UX 重構 Prompt」。
- 核心產品定位改為「督導每日管理工作台」。
- 核心心智模型改為「Record First, Case Behind the Scenes」。
- 使用者明確要求本次先做 Phase 1：UX / Architecture Review，不要一次全部實作。

新增文件：

- `docs/SUPERVISOR-MANAGEMENT-LOG-UX-ARCHITECTURE-REVIEW.md`

Review 結論：

- 現有 Management Case / Record / Follow-up foundation 可以保留。
- 目前 UI 雖可操作，但仍偏後台 CRUD：
  - 首屏以案件列表與新增案件表單為中心。
  - 使用者必須先理解 Case，再新增 Record / Follow-up。
  - 今日待追蹤、今日管理與快速紀錄尚未成為主流程。
- 新 UX 應改為：
  - 今日管理工作台。
  - 快速口述 / 新增管理紀錄作為主 CTA。
  - 管理案件降為第二層功能。
  - 案件詳情改為 timeline-first。
  - Follow-up 改成「立即追蹤」的大按鈕流程。
  - Mobile 以現場快速記錄與追蹤為主，不只是桌面縮小版。

架構判斷：

- 純前端可先做：
  - `/supervisor-management-log` tabbed IA。
  - 今日工作台。
  - 現有案件列表移到管理案件 tab。
  - 現有詳情改為 timeline-first。
  - 新增管理紀錄 3+1 guided flow。
  - 快速口述安全入口。
- 真正 Record First 需要最小 API / DB 設計：
  - 目前 `supervisor_management_records.case_id` 不可為 NULL。
  - 目前 `POST /cases` 回傳 minimal `data: null`，無法可靠由前端建立 case 後取得 case id。
  - 建議下一階段新增 `quick-create` API 或 RPC，在同一 transaction 建立 / 關聯 Case 與 Record。
- 今日待追蹤需要專門 read API：
  - 建議新增 `GET /api/supervisor-management-log/today`。
  - 回傳今日概況、逾期、今日到期、即將到期、近期管理紀錄。
- 今日管理規劃需要新資料表：
  - 建議未來新增 `supervisor_management_daily_plans`。
- AI / 語音需分期：
  - Transcript only。
  - AI structuring draft。
  - Review and confirm。
  - AI 不得直接寫正式紀錄。

下一個最小任務：

**SML-UX-2A：督導管理日誌 IA / Layout 重構。**

建議 SML-UX-2A 範圍：

1. 不改 DB。
2. 不改 migration。
3. 不改 RLS。
4. 不改 API contract。
5. `/supervisor-management-log` 改為：
   - 今日。
   - 管理案件。
   - 門市。
   - 人員。
   - 管理歷程。
6. 今日 tab 顯示：
   - 我的今日管理 header。
   - 快速口述入口。
   - 新增管理紀錄入口。
   - 今日待追蹤安全空狀態或現有資料可支援的簡版。
   - 近期管理紀錄。
7. 管理案件 tab 承接現有案件列表、篩選、分頁與 detail。
8. 新增管理紀錄改為 3+1 guided flow，但儲存仍使用既有 case-scoped record API。
9. 快速口述先做安全入口，不呼叫 AI、不寫 DB、不顯示假 AI 結果。

禁止事項：

- 不得操作 Production。
- 不得修改已套用 migration。
- 不得為 UX 關閉或放寬 RLS。
- 不得用 service role 代替 authenticated user 驗證。
- 不得顯示假案件、假 KPI、假待追蹤、假 AI 結果。
- 不得讓 AI 直接寫入正式紀錄。
- 不得自動合併 management case。
- 不得以前端 store / role 判斷取代 server API / RLS scope。

### 督導管理日誌 SML-UX-2A：IA / Layout 重構

完成狀態：**本機實作、靜態測試、TypeScript、build 與 smoke test 通過；等待使用者人工 UI 驗收。**

更新時間：2026-08-13

任務背景：

- 接續 `docs/SUPERVISOR-MANAGEMENT-LOG-UX-ARCHITECTURE-REVIEW.md`。
- 目標是先以不改 DB / migration / RLS / API contract 的方式，將 `/supervisor-management-log` 從 CRUD 工作台改為督導每日管理工作台。

修改檔案：

- `app/supervisor-management-log/page.tsx`
- `scripts/test-supervisor-management-log-ui.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

UI / IA 變更：

- 新增模組內分頁：
  - 今日。
  - 管理案件。
  - 門市。
  - 人員。
  - 管理歷程。
- 預設分頁改為「今日」。
- 今日分頁新增：
  - 我的今日管理 header。
  - 今日日期。
  - Primary CTA：快速口述。
  - Secondary CTA：新增管理紀錄。
  - 次要入口：建立管理案件。
  - 今日管理概況。
  - 今日待追蹤。
  - 今日 / 近期管理。
- 原本案件 KPI、篩選、列表、分頁、新增案件、案件詳情、編輯、soft delete、管理紀錄與追蹤結果保留，但移到「管理案件」分頁。
- 門市 / 人員 / 管理歷程分頁先建立安全空狀態：
  - 不顯示假資料。
  - 不前端推算授權資料範圍。
  - 文件明確註記後續需 today / history API。

安全與限制：

- 快速口述目前只顯示安全提示：
  - 不寫 DB。
  - 不呼叫 AI。
  - 不顯示假 AI Review。
- 今日待追蹤只使用目前 API / RLS 可見案件的 `next_follow_up_at`。
- 今日 / 近期管理只使用目前選取案件的 records，不假造跨案件 history。
- 無 DB schema 變更。
- 無 migration 修改。
- 無 API contract 變更。
- 無 RLS / RPC 變更。
- 無 Production 操作。

測試：

- `node --check scripts/test-supervisor-management-log-ui.js`：通過。
- `node scripts/test-supervisor-management-log-ui.js`：通過。
- `node scripts/test-supervisor-management-log-foundation.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過，exit code 0。
- 第一次 build 因本專案 3002 dev server 鎖住 `.next/trace` 出現 `EPERM`；已只停止佔用 3002 的本專案 process，重跑 build 成功。
- Build 仍有既有 Dynamic server usage 訊息，非本輪 SML-UX-2A 變更造成 failure。
- 本機 dev server smoke test：
  - `GET /supervisor-management-log`：200。
  - 未登入 `GET /api/supervisor-management-log/cases`：401。
  - smoke test 後 3002 已停止。

尚未完成：

- 尚未由使用者人工 UI 驗收。
- 尚未完成真正 Record First 儲存 API。
- 尚未新增 `GET /api/supervisor-management-log/today`。
- 尚未新增 daily plans。
- 尚未開始 voice transcript / AI structuring draft。

下一個最小任務：

**SML-UX-2A 人工 UI 驗收。**

人工驗收建議：

1. 啟動 `npm run dev -- -p 3002`。
2. 進入 `/supervisor-management-log`。
3. 確認預設為「今日」分頁。
4. 確認快速口述為主要 CTA，且目前不寫 DB、不假造 AI。
5. 確認新增管理紀錄入口可導向管理案件分頁。
6. 確認管理案件分頁完整保留原可操作功能。
7. 確認門市 / 人員 / 管理歷程為安全空狀態。
8. 以無權限帳號確認 route / API 仍被阻擋。

後續建議：

- SML-UX-2B：新增 record-first quick-create API / RPC。
- SML-UX-2C：新增 today API。
- SML-UX-2D：Follow-up Flow 重構。
- SML-UX-3：今日管理規劃。
- SML-VOICE-1：Transcript-only voice entry。

### 督導管理日誌：今日管理工作台重構前置判定

完成狀態：**Architecture / Migration Proposal 完成；未進入 UI 實作。**

更新時間：2026-08-13

新增文件：

- `docs/SUPERVISOR-MANAGEMENT-LOG-TODAY-WORKSPACE-PROPOSAL.md`

檢查結果：

- 現有 DB / API 只有：
  - `supervisor_management_categories`
  - `supervisor_management_cases`
  - `supervisor_management_records`
  - `supervisor_management_followups`
  - `supervisor_management_case_events`
- 現有程式沒有 `daily_plan`、`today_plan`、`management_plan` 或 `plan_date` 的正式資料結構。
- `supervisor_management_records.case_id` 為 NOT NULL，所以無法在不建立或關聯 case 的情況下寫入真正 record-first 管理紀錄。

重要判定：

- 今日管理工作台需求中的「今日管理規劃」是新 domain entity。
- 不可用 `supervisor_management_cases` 假裝今日計畫，因為案件代表持續管理問題。
- 不可用 `supervisor_management_records` 假裝今日計畫，因為紀錄代表已實際發生的管理行為。
- 應明確拆分：
  - Management Plan：今天預計做什麼。
  - Management Record：今天實際做了什麼。
  - Management Case：需要持續管理的問題。
  - Follow-up：後續確認結果。

本輪未做：

- 未修改 DB。
- 未建立 migration。
- 未執行 db push。
- 未修改 API contract。
- 未修改 RLS / RPC。
- 未修改 `/supervisor-management-log` UI。
- 未操作 Production。

建議下一個最小任務：

**SML-UX-2B：今日管理規劃 Foundation 設計與 migration 建立。**

建議範圍：

- 新增 `supervisor_management_daily_plans`。
- 欄位至少包含：
  - `plan_date`
  - `owner_user_id`
  - `target_type`
  - `store_id`
  - `employee_id`
  - `target_name_snapshot`
  - `category_id`
  - `title`
  - `status`
  - `started_at`
  - `completed_at`
  - `linked_case_id`
  - `linked_record_id`
  - `notes`
  - `metadata`
  - system fields
  - soft delete fields
- 沿用既有 `supervisor.management_log.*` permissions，先不新增過度細碎權限碼。
- 建立 RLS、validation trigger、soft delete RPC。
- 建立 `GET/POST /api/supervisor-management-log/daily-plans` 與 `[id]` update / soft delete API。
- 建立 `GET /api/supervisor-management-log/today` read model，回傳 plans、follow-up queue、today records 與 summary。
- DB test SQL 與 dynamic API 驗證通過後，才進入正式今日工作台 UI 重構。

禁止事項：

- 不得把開發文字顯示給正式使用者，例如 `SML-UX-2A`、`today/history API`、`server API / RLS`。
- 不得顯示假今日規劃、假待追蹤、假 AI、假 KPI。
- 不得為了 UI 快速完成而混用 Plan / Record / Case / Follow-up。
- 不得修改已套用 migration；DB 問題只能 forward migration。

### 督導管理日誌 SML-UX-2B：今日管理規劃 Foundation 本機建立

完成狀態：**正式推送 DEV；migration history local / remote aligned；DB catalog test SQL 通過。**

更新時間：2026-08-13

任務背景：

- 使用者批准 SML-UX-2B。
- 依照前置判定，今日管理規劃不能用 `supervisor_management_cases` 或 `supervisor_management_records` 假裝完成，需新增正式 daily plan entity。

新增檔案：

- `supabase/migration_supervisor_management_daily_plans.sql`
- `supabase/migrations/20260813063209_supervisor_management_daily_plans.sql`
- `supabase/rollback_supervisor_management_daily_plans.sql`
- `supabase/test_supervisor_management_daily_plans.sql`
- `scripts/test-supervisor-management-daily-plans.js`

Migration 內容：

- 新增 `public.supervisor_management_daily_plans`。
- 欄位包含：
  - `plan_date`
  - `owner_user_id`
  - `target_type`
  - `store_id`
  - `employee_id`
  - `target_name_snapshot`
  - `category_id`
  - `title`
  - `status`
  - `started_at`
  - `completed_at`
  - `linked_case_id`
  - `linked_record_id`
  - `notes`
  - `metadata`
  - system fields
  - soft delete fields
- Constraints：
  - target type：`STORE / EMPLOYEE / AREA / CROSS_DEPARTMENT / OTHER`
  - status：`PLANNED / IN_PROGRESS / DONE / CANCELLED`
  - STORE 需 `store_id`
  - EMPLOYEE 需 `employee_id`
  - `metadata` 必須是 object
  - linked record 必須有 linked case
  - system soft delete 欄位成組
- Indexes：
  - owner + date
  - date + status
  - store + date
  - employee + date
  - linked case
  - linked record
- Helper functions：
  - `supervisor_management_daily_plan_is_visible(uuid)`
  - `supervisor_management_daily_plan_is_manageable(uuid)`
- Validation trigger：
  - `supervisor_management_validate_daily_plan()`
  - `trg_supervisor_management_daily_plans_validate`
- Soft delete RPC：
  - `supervisor_management_soft_delete_daily_plan(uuid, text)`
- RLS：
  - read / insert / update policies
  - no DELETE policy
- Grants：
  - authenticated table SELECT / INSERT / UPDATE
  - authenticated helper / RPC EXECUTE
  - no anon / PUBLIC grants

權限策略：

- 沿用既有 SML 權限碼，不新增過度細碎權限：
  - `supervisor.management_log.view_own`
  - `supervisor.management_log.view_team`
  - `supervisor.management_log.create`
  - `supervisor.management_log.update_own`
  - `supervisor.management_log.follow_up`
  - `supervisor.management_log.manage`
- `view_team` 仍透過既有 `supervisor_management_current_user_manages_store(uuid)` 控制門市 scope。
- route / API 尚未建立；後續 API 仍必須有 server-side permission guard。

測試結果：

- `node --check scripts/test-supervisor-management-daily-plans.js`：通過。
- `node scripts/test-supervisor-management-daily-plans.js`：通過。
- `node --check scripts/test-supervisor-management-log-foundation.js`：通過。
- `node scripts/test-supervisor-management-log-foundation.js`：通過。
- `npx supabase migration list`：通過，只有 `20260813063209` local-only。
- `npx supabase db push --dry-run`：通過，只列 `20260813063209_supervisor_management_daily_plans.sql`。
- `npx supabase db push`：成功，只套用 `20260813063209_supervisor_management_daily_plans.sql`。
- Push 後 `npx supabase migration list`：`20260813063209` local / remote aligned。
- `npx supabase db query --linked --file supabase/test_supervisor_management_daily_plans.sql`：通過，exit code 0。
- Daily plans source / standard migration SHA-256：
  - `3C1A9E92368CE1A7763BD980732CE7C74DCA943C9ADBDC143B02E11A971D7E11`
- 已套用 `20260812093000_supervisor_management_log_foundation.sql` hash 保持：
  - `DDC1C84874CF980BEBD44E3FE6F535E2F4BCBFF6BDED195B412F72A9AE92BE1F`

未做項目：

- 未建立 daily-plans API。
- 未建立 today read-model API。
- 未修改 `/supervisor-management-log` UI。
- 未開始 voice / AI。
- 未操作 Production。

下一個最小任務：

**SML-UX-2C：Daily Plans API 與 Today Read Model 設計 / 實作。**

安全順序：

1. 不改 DB / migration。
2. 先設計 daily plans API contract。
3. 建立 `GET/POST /api/supervisor-management-log/daily-plans`。
4. 建立 `PATCH/DELETE /api/supervisor-management-log/daily-plans/[id]`。
5. 建立 `GET /api/supervisor-management-log/today` read model，彙整 plans、follow-up queue、today records 與 summary。
6. 補 static / dynamic tests。
7. API 驗證後才重構今日工作台 UI。

禁止事項：

- 不得修改已套用 migration。
- 不得在未批准時新增下一筆 migration 或 db push。
- 不得 repair / reset / rollback。
- 不得把 cases / records 假裝為 daily plans。
- 不得繞過 RLS 或使用 service role 代替 authenticated 驗證。

### 督導管理日誌 SML-UX-2C：Daily Plans API 與 Today Read Model

完成狀態：**本機 API 實作、靜態測試、TypeScript、build 與未登入 smoke test 通過；尚未重構今日工作台 UI。**

更新時間：2026-08-13

任務背景：

- 接續 SML-UX-2B daily plans DB foundation。
- 本輪不改 DB / migration，專注建立 API contract 與 today read model。

修改檔案：

- `app/api/supervisor-management-log/daily-plans/route.ts`
- `app/api/supervisor-management-log/daily-plans/[id]/route.ts`
- `app/api/supervisor-management-log/today/route.ts`
- `lib/supervisor-management-log/validation.ts`
- `lib/supervisor-management-log/access.ts`
- `scripts/test-supervisor-management-daily-plans-api.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

API routes：

- `GET /api/supervisor-management-log/daily-plans`
  - filters：`date`、`status`、`targetType`、`storeId`、`employeeId`、`search`
  - pagination：`page`、`pageSize`
  - sort whitelist：`plan_date`、`updated_at`、`status`、`title`、`target_type`
- `POST /api/supervisor-management-log/daily-plans`
  - force `owner_user_id = auth user id`
  - avoid INSERT RETURNING RLS trap，不 chain `.select()`
- `GET /api/supervisor-management-log/daily-plans/[id]`
- `PATCH /api/supervisor-management-log/daily-plans/[id]`
  - avoid UPDATE RETURNING RLS trap，不 chain `.select()`
- `DELETE /api/supervisor-management-log/daily-plans/[id]`
  - 呼叫 `supervisor_management_soft_delete_daily_plan`
  - 必填 deletion reason
- `GET /api/supervisor-management-log/today`
  - 回傳 date、plans、followUpQueue、todayRecords、summary
  - follow-up queue 分為 overdue / today / upcoming
  - latest_record 來自真實 `supervisor_management_records`

安全策略：

- 所有 API 使用 `createClient` authenticated Supabase server client。
- 所有 API 都檢查 `supabase.auth.getUser()`。
- 未登入回 401。
- View 使用 `canViewSupervisorManagementLog`。
- Create 使用 `canCreateSupervisorManagementLog`。
- Update 使用 `canWriteSupervisorManagementDailyPlan`。
- Delete 使用 `canManageSupervisorManagementLog`。
- 未使用 service role。
- Today read model 只彙整 RLS 可見資料，不前端或 server 擴大 scope。
- 不顯示假 plans、假 follow-up、假 records、假 AI。

Validation / access：

- 新增 `validateDailyPlanPayload`：
  - reject system fields
  - validate target type
  - validate STORE / EMPLOYEE target pairing
  - validate status
  - validate linked case / record ids
  - validate metadata object
- 新增 `canWriteSupervisorManagementDailyPlan`：
  - `supervisor.management_log.create`
  - `supervisor.management_log.update_own`
  - `supervisor.management_log.follow_up`
  - `supervisor.management_log.manage`

測試：

- `node --check scripts/test-supervisor-management-daily-plans-api.js`：通過。
- `node scripts/test-supervisor-management-daily-plans-api.js`：通過。
- `node --check scripts/test-supervisor-management-daily-plans.js`：通過。
- `node scripts/test-supervisor-management-daily-plans.js`：通過。
- `node --check scripts/test-supervisor-management-log-ui.js`：通過。
- `node scripts/test-supervisor-management-log-ui.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過，exit code 0。
  - 第一次 build 因本專案 3002 dev server 鎖住 `.next/trace` 出現 EPERM；已只停止本專案 3002 process，重跑成功。
  - 仍有既有 Dynamic server usage warnings，非 SML-UX-2C failure。
- 未登入 smoke test：
  - `GET /api/supervisor-management-log/daily-plans`：401。
  - `GET /api/supervisor-management-log/today`：401。
  - smoke 後 3002 已停止。

未做項目：

- 尚未做 authenticated dynamic API / RLS 角色矩陣驗收。
- 尚未重構 `/supervisor-management-log` 今日工作台 UI。
- 尚未建立 voice / AI。
- 未新增或修改 migration。
- 未 db push。
- 未操作 Production。

下一個最小任務：

**SML-UX-2D：今日管理工作台 UI 重構。**

建議範圍：

1. 不改 DB / migration。
2. 今日分頁使用 `GET /api/supervisor-management-log/today`。
3. 今日頁面改成 4 區塊：
   - 今日管理規劃。
   - 今日待追蹤。
   - 快速新增管理紀錄。
   - 今日管理紀錄。
4. daily plan 新增 / 編輯 / 開始處理 / 完成，使用 daily-plans API。
5. 立即追蹤使用 existing follow-up API，但以 Drawer / Modal 呈現。
6. 移除正式 UI 中的開發語言。
7. Mobile 不塞寬表格，改用卡片 / sheet。

禁止事項：

- 不得把 cases / records 假裝為 daily plans。
- 不得顯示假 KPI / 假追蹤 / 假 AI。
- 不得改 DB / migration，除非使用者重新批准新 DB 任務。
- 不得用 service role 繞過 RLS。

### 督導管理日誌 SML-UX-2D：今日管理工作台 UI 重構

完成狀態：**本機 UI 實作、靜態測試、TypeScript 與 build 通過；等待使用者人工 UI 驗收。**

更新時間：2026-08-13

任務背景：

- 使用者要求「不管下面還有多少步驟都一次進行完」。
- 接續 SML-UX-2C 的 daily plans API 與 today read model，本輪完成 `/supervisor-management-log` 今日分頁正式 UI。
- 本輪不改 DB、不新增 migration、不操作 Production。

修改檔案：

- `app/supervisor-management-log/page.tsx`
- `app/api/supervisor-management-log/today/route.ts`
- `scripts/test-supervisor-management-log-ui.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

UI 完成項目：

- 今日分頁已由舊的選取案件推算畫面，改為正式「今日管理工作台」。
- 今日頁面包含 4 個主要區塊：
  - 今日管理規劃。
  - 今日待追蹤。
  - 快速新增管理紀錄。
  - 今日管理紀錄。
- KPI 摘要改由 `GET /api/supervisor-management-log/today` 回傳的真實 summary 顯示：
  - 今日規劃。
  - 處理中。
  - 待追蹤。
  - 逾期追蹤。
  - 今日紀錄。
- 今日管理規劃支援：
  - 新增。
  - 編輯。
  - 開始處理。
  - 完成。
  - soft delete，刪除前要求輸入原因。
- 今日待追蹤支援：
  - 顯示 overdue / today / upcoming。
  - 顯示最新管理紀錄的 expected result 或案件摘要。
  - 同頁開啟追蹤結果回填表單。
  - 可跳到管理案件詳情。
- 快速新增管理紀錄區塊明確說明管理紀錄需關聯案件，提供前往管理案件的正式入口。
- 今日管理紀錄只顯示 today read model 回傳的真實今日 records。
- 快速口述仍為安全未開放狀態，不呼叫 AI、不寫 DB、不顯示假 AI 結果。

正式 UI 文字收斂：

- 已移除正式畫面中的工程語言：
  - `Management Case / Record / Follow-up`
  - `SML-UX-2A`
  - `today / history API`
  - `server API / RLS`
- 門市、人員、管理歷程 tab 改為正式「此功能尚未開放」安全文案。
- 未完成 tab 不顯示假分析、假案例或未授權範圍。

API 修正：

- `app/api/supervisor-management-log/today/route.ts`
  - 修正 Supabase status filter：
    - from：`.not('status', 'in', '("CLOSED","CANCELLED")')`
    - to：`.not('status', 'in', '(CLOSED,CANCELLED)')`
  - 只修正 read model filter 語法，不改 API contract。

測試結果：

- `node --check scripts/test-supervisor-management-log-ui.js`：通過。
- `node scripts/test-supervisor-management-log-ui.js`：通過。
- `node --check scripts/test-supervisor-management-daily-plans-api.js`：通過。
- `node scripts/test-supervisor-management-daily-plans-api.js`：通過。
- `node scripts/test-supervisor-management-daily-plans.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過，exit code 0。
  - 第一次 build 因本專案 3002 dev server 鎖定 `.next/trace` 出現 EPERM。
  - 已只停止佔用 3002 的本專案 process，重跑 build 成功。
  - Build 仍有既有 Dynamic server usage 訊息，非本輪 SML-UX-2D failure。

未做項目：

- 尚未完成使用者人工 UI 驗收。
- 尚未做 authenticated dynamic API / RLS 角色矩陣驗收。
- 尚未重跑 `supabase/test_supervisor_management_log_foundation.sql`。
- 尚未建立 AI 語音整理草稿 / 人工確認流程。
- 門市、人員、管理歷程仍是安全未開放頁，不是完整功能。

下一個最小任務：

**SML-UX-2D 人工 UI 驗收。**

人工驗收重點：

1. 今日頁面為正式工作台，不再顯示工程文字。
2. 今日規劃可新增、編輯、開始、完成、soft delete。
3. 今日待追蹤可回填追蹤結果。
4. 今日紀錄只顯示真實資料。
5. 快速口述保持未開放，不假裝 AI。
6. 門市、人員、管理歷程顯示安全未開放狀態。
7. Desktop / mobile 版型可用。

禁止事項：

- 不得新增或修改 migration。
- 不得 db push / repair / reset / rollback。
- 不得顯示假 KPI、假追蹤、假 AI。
- 不得用 service role 繞過 RLS。
- 不得操作 Production。

### 督導管理日誌 SML-UX-2E：UX 架構第二次重構

完成狀態：**本機 UI 實作、靜態測試、TypeScript 與 build 通過；等待使用者人工 UI 驗收。**

更新時間：2026-08-13

任務背景：

- 使用者人工檢視後指出 SML 仍過度以「功能模組」為中心，而不是以「督導一天的管理工作」為中心。
- 本輪重新收斂 IA，不繼續填滿門市、人員、管理歷程三個低頻 tab。
- 本輪優先完成兩個高頻功能：
  - 今日工作台。
  - 管理案件。
- 本輪未新增 DB schema、未新增 migration、未操作 DEV / Production DB。

修改檔案：

- `app/supervisor-management-log/page.tsx`
- `scripts/test-supervisor-management-log-ui.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

Information Architecture 變更：

- 第一層 navigation 從五個等權重 tab：
  - 今日
  - 管理案件
  - 門市
  - 人員
  - 管理歷程
- 收斂為兩個主要入口：
  - 今日工作台
  - 管理案件
- 門市、人員、管理歷程不再以空白 placeholder 顯示。
- 這三個低頻需求歸入未來 Management Knowledge Base 階段，後續再設計：
  - 門市管理歷程。
  - 人員管理歷程。
  - 管理案例庫。
  - 實習督導學習。

今日工作台變更：

- 移除首屏大型 KPI cards。
- 改為 compact summary：
  - 規劃。
  - 完成。
  - 待追。
  - 逾期。
- 今日頁主順序改為：
  1. 我的今日管理。
  2. 今日管理規劃。
  3. 今日待追蹤。
  4. 新增管理結果。
  5. 今日管理紀錄。
- 快速口述仍保留為醒目入口，但顯示「尚未開放」，不假裝 AI 已可用。

今日規劃 Flow：

- 今日規劃仍使用 `supervisor_management_daily_plans` 與 daily-plans API。
- 每筆 plan 顯示：
  - 管理對象。
  - 今天想確認什麼。
  - 管理類型 / target type。
  - 是否關聯既有案件。
- 「開始處理」與「新增管理結果」會進入管理結果紀錄 flow。
- 若 plan 尚未關聯 Management Case，UI 明確提示需先關聯案件，不假裝可直接產生 Management Record。

管理結果 UX：

- 新增管理結果表單改成督導語言：
  - 今天看到什麼？
  - 你認為主要原因？
  - 你做了什麼？
  - 還要再看嗎？
- 管理動作用 chips 呈現：
  - 現場說明。
  - 主管約談。
  - 教育訓練。
  - 限期改善。
  - 跨部門協調。
  - 文件補正。
  - 持續追蹤。
- 仍寫入既有 Management Record 欄位：
  - observation。
  - judgment。
  - action_summary。
  - action_options。
  - follow-up fields。

Follow-up UX：

- 今日待追蹤不再只是 case list。
- 卡片以管理事情為核心，顯示：
  - 對象。
  - 案件標題。
  - 上次要求 / expected result / 摘要。
  - overdue / today / upcoming。
- 「立即追蹤」開啟快速追蹤結果回填。
- 追蹤結果改為快速選項：
  - 已改善。
  - 有進步，繼續追。
  - 沒有改善。
  - 尚無法判斷。
- 下次追蹤可快速選：
  - 明天。
  - 3 天後。
  - 下週。
  - 自選日期。

管理案件頁變更：

- 移除右側常駐「新增管理案件」表單。
- 改為右上角「建立管理案件」按鈕，點擊後才顯示建立表單。
- 移除大型 KPI cards。
- 改為 compact status filter：
  - 全部。
  - 待處理。
  - 待追蹤。
  - 改善中。
  - 已改善。
  - 已結案。
- 案件詳情標題改為「案件時間線」。
- 詳情區塊文案改為：
  - 發現、判斷與管理動作。
  - 追蹤與改善結果。
  - 系統紀錄。

測試結果：

- `node --check scripts/test-supervisor-management-log-ui.js`：通過。
- `node scripts/test-supervisor-management-log-ui.js`：通過。
- `node scripts/test-supervisor-management-daily-plans-api.js`：通過。
- `node scripts/test-supervisor-management-daily-plans.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過，exit code 0。
  - 第一次 build 因本專案 3002 dev server 鎖定 `.next/trace` 出現 EPERM。
  - 已只停止佔用 3002 的本專案 process，重跑 build 成功。
  - Build 仍有既有 Dynamic server usage 訊息，非本輪 SML-UX-2E failure。

Scenario 驗收判定：

- Scenario 1 早上規劃：可完成。使用「新增今日規劃」建立門市 / 人員 / 其他管理對象與今日事項。
- Scenario 2 巡店完成：部分完成。若 Today Plan 已關聯 Management Case，可由「開始處理 / 新增管理結果」進入 Management Record 並建立 Follow-up。若未關聯 Case，目前需先關聯案件；系統不假裝自動產生 Case。
- Scenario 3 下週一追蹤：可完成。今日待追蹤顯示 due follow-up，點「立即追蹤」可快速回填結果與下次追蹤日。
- Scenario 4 改善結案：部分完成。Follow-up 可記錄「已改善」；案件結案仍需在案件詳情中編輯狀態為已結案，尚未做「已改善後一鍵詢問是否結案」的專用 UX。

仍待 API / AI：

- 快速口述的 Speech / AI transcript / AI 整理 / 人工確認尚未實作。
- Today Plan 自動建立 / 關聯 Management Case 的專用 API flow 尚未實作。
- Follow-up 選「已改善」後詢問是否一鍵結案尚未實作。
- Management Knowledge Base（門市、人員、案例庫、實習督導學習）暫停到後續階段。

禁止事項：

- 不得為尚未實作的 AI / 自動建案 / 一鍵結案顯示假成功。
- 不得把未關聯的 Today Plan 假裝已能產生 Management Record。
- 不得新增或修改 migration，除非使用者批准 DB 任務。
- 不得操作 Production。

---

## 2026-08-14：SML-VOICE-0 口述記錄 AI 辨識功能設計

狀態：

- Completed。
- 本輪只完成設計文件，未開始程式實作。
- 未新增或修改 DB / migration / RLS / RPC / API contract。
- 未執行 db push / repair / reset / rollback。
- 未操作 Production。

設計文件：

- `docs/SUPERVISOR-MANAGEMENT-VOICE-AI-DESIGN.md`

設計目標：

- 讓督導能以口述方式快速留下管理結果。
- 流程不是單純語音轉文字，而是：
  1. 錄音。
  2. 轉文字稿。
  3. AI 整理成 Management Record 或 Follow-up 草稿。
  4. Application 執行正式主檔 Entity Matching。
  5. 使用者人工確認與修改。
  6. 確認後才寫入既有 SML 資料。
- 不建立第二套「AI 日誌」資料模型。
- 不讓 AI 直接寫正式紀錄。
- 不讓 LLM 產生任何正式 FK。

採用方向：

- MVP 採 file transcription：使用者錄完後上傳音檔，由 server API 呼叫 OpenAI transcription。
- 不做 realtime / streaming；若未來需要邊講邊顯示字幕，再切到 Realtime transcription。
- 前端不得取得 OpenAI key。
- 音檔 MVP 不永久保存，只在 request lifecycle 中處理。
- AI draft API 只回傳結構化 JSON 草稿，不直接寫 DB。
- AI 只能辨識 entity mention，例如「東門店」「小美」「王店長」。
- `store_id`、`employee_id`、`profile_id` 等正式 ID 必須由 application layer 根據登入者權限、store scope 與正式主檔資料 matching。
- Entity Matching 是必要功能，不是 optional enhancement。

官方文件依據：

- OpenAI Speech to Text / File transcription 文件。
- 文件中建議新的一般轉錄可從 `gpt-transcribe` 開始；即時麥克風 / media stream 場景應看 Realtime transcription。
- 文件也支援在完成錄音檔後，以 file transcription 流程取得轉錄內容。

MVP API 規劃：

- `POST /api/supervisor-management-log/voice/transcribe`
  - `multipart/form-data`
  - 欄位：audio file、mode。
  - server-side 檢查登入、SML 權限、檔案類型、大小與秒數。
  - 回傳 transcript、language、duration、warnings。
- `POST /api/supervisor-management-log/voice/draft`
  - JSON input：mode、transcript、daily_plan_id、case_id、followup_case_id。
  - server-side 讀取可見 context，不信任前端傳入的 scope。
  - 回傳 record draft 或 follow-up draft。

Record draft 結構：

- `mode`
- `confidence`
- `target_name_snapshot`
- `entity_mentions`
- `entity_matches`
- `category_hint`
- `observation`
- `judgment`
- `action_summary`
- `action_options`
- `requires_follow_up`
- `follow_up_method`
- `follow_up_date_text`
- `expected_result`
- `uncertain_fields`

Follow-up draft 結構：

- `mode`
- `confidence`
- `result_status`
- `result_notes`
- `next_follow_up_date_text`
- `next_action`
- `suggest_close_case`
- `uncertain_fields`

UI 規劃：

- 建立 Voice Sheet。
- 支援桌機與手機：
  - 錄音。
  - 暫停 / 停止 / 取消。
  - 播放確認。
  - 重新錄音。
  - 送出轉文字。
  - AI 草稿檢視。
  - 人工編輯。
  - 確認儲存。
- Today Plan 已關聯 Management Case 時，可從「開始處理 / 新增管理結果」進入口述紀錄。
- Follow-up 卡片可從「立即追蹤」進入口述追蹤結果。
- AI 草稿與正式儲存狀態必須清楚分離。
- Review UI 必須顯示正式 Entity，例如：
  - 門市名稱與門市代號。
  - 員工姓名、員編、職稱、所屬門市。
  - entity mention 來源文字。
  - match confidence 與是否需要確認。
- 同名人員或低信心 matching 必須要求使用者選擇，不得自動寫入正式 ID。

安全與隱私規則：

- OpenAI API key 只能存在 server-side。
- 不得在 console、error response、文件或測試輸出中記錄音檔、JWT、token、key、完整模型 response。
- AI 低信心或欄位不確定時，必須顯示待確認欄位。
- 日期推測只能先顯示給使用者確認，不得直接寫入。
- 使用者取消時不得建立正式紀錄。
- LLM 不得產生正式 ID；任何 ID 若出現在 AI output，server 必須忽略或拒絕。
- Matching context 不得無限制包含全公司個資，必須依權限與管理門市縮小候選。

Entity Matching 設計：

- Store matching signals：
  - `store_code`。
  - `store_name`。
  - `short_name`。
  - 口語簡稱。
  - normalized contains / fuzzy score。
  - 使用者 `store_managers` scope。
  - 既有 Case / Today Plan context。
- Employee matching signals：
  - `employee_code`。
  - `employee_name`。
  - `position` / `current_position` / `profiles.job_title`。
  - `store_id`。
  - 已辨識的 store。
  - 職稱詞，例如店長、副店長、主任、組長、專員、新人、督導。
  - 代名詞 context，例如「王店長」後面的「他」。
- Confidence：
  - HIGH：可預選但仍顯示。
  - MEDIUM：建議並標示請確認。
  - LOW：不得預選，必須由使用者選擇。
- 目前 `supervisor_management_records.employee_id` 只能保存一個主要人員；若口述涉及多人，Review UI 必須提示使用者選擇主要管理對象，其他人員只能保存於文字或 metadata，不得悄悄丟失。

下一個最小任務：

**SML-VOICE-1：口述記錄 MVP UI / API 實作，不新增 DB，包含正式主檔 Entity Matching。**

SML-VOICE-1 範圍：

- 建立 `voice/transcribe` API。
- 建立 `voice/draft` API。
- 建立 structured draft schema。
- 建立 store / employee Entity Matching helper。
- 建立 Voice Sheet component。
- 接 Management Record draft review。
- 接 Follow-up draft review。
- 使用者確認後才呼叫既有 record / follow-up API。

SML-VOICE-1 不做：

- Realtime transcription。
- Voice draft DB table。
- 音檔永久保存。
- 自動建立 Case。
- 自動結案。
- Production 操作。

---

## 2026-08-15：SML-VOICE-1 口述記錄 MVP UI / API 實作

狀態：

- Completed for MVP implementation。
- 尚未完成人工 UI 驗收與 authenticated dynamic API 驗收。
- 未新增或修改 DB / migration / RLS / RPC。
- 未執行 db push / repair / reset / rollback。
- 未操作 Production。

修改檔案：

- `lib/supervisor-management-log/voice.ts`
- `app/api/supervisor-management-log/voice/transcribe/route.ts`
- `app/api/supervisor-management-log/voice/draft/route.ts`
- `app/supervisor-management-log/page.tsx`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`

新增 API：

- `POST /api/supervisor-management-log/voice/transcribe`
  - `multipart/form-data`
  - 欄位：`audio`
  - 只允許登入且具備 SML create / update 能力的使用者。
  - 單檔上限 20MB。
  - 支援常見 audio mime type。
  - OpenAI key 只在 server-side 使用。
  - 若未設定 `OPENAI_API_KEY`，回 503 並提示使用手動文字稿。
  - 不永久保存音檔。
- `POST /api/supervisor-management-log/voice/draft`
  - JSON 欄位：`mode`、`transcript`
  - `mode` 支援 `RECORD_DRAFT` / `FOLLOWUP_DRAFT`
  - AI 可用時使用 OpenAI 產生 structured draft。
  - AI 不可用時使用本機規則 fallback 產生待確認草稿。
  - Server-side 執行正式主檔 Entity Matching。
  - 不寫入正式紀錄。

新增 helper：

- `normalizeTranscript`
- `buildLocalDraft`
- `parseDraftWithOpenAI`
- `extractEntityMentions`
- `matchEntities`
- `getBlockingFields`

Entity Matching 規則：

- AI 只能輸出 mention，不得產生正式 FK。
- Application layer 依 `stores` / `store_employees` 正式主檔候選比對。
- 目前支援：
  - 門市代碼 / 門市名稱 / 簡稱。
  - 員工編號 / 姓名 / 職稱 / 所屬門市。
- 回傳 `MATCHED` / `AMBIGUOUS` / `NOT_FOUND`，供使用者人工確認。
- 低信心或多候選不得自動寫正式 ID。

UI：

- `/supervisor-management-log` 今日工作台的「快速口述」按鈕已改為開啟 Voice Sheet。
- Voice Sheet 支援：
  - 開始 / 停止錄音。
  - 上傳音檔。
  - 手動輸入口述文字稿。
  - 產生待確認草稿。
  - 顯示 AI / 本機規則來源。
  - 顯示 warning、blocking fields、Entity Matching 結果。
  - 套用草稿到既有「新增管理紀錄」表單。
- 草稿套用後仍需人工確認並手動儲存。
- 若目前未選 Management Case，UI 會提示需先選擇案件，不能假裝已能自動建案。

安全規則：

- 不輸出 password / JWT / token / cookie / service role key / OpenAI key。
- 不讓前端取得 OpenAI key。
- AI response 不直接寫 DB。
- 音檔 MVP 不永久保存。
- API failure 不顯示假成功。
- OpenAI key 未設定時，轉文字不可假裝成功；draft 可用明確標示的本機規則 fallback。

驗證結果：

- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過，exit code 0。
- `git diff --check`（本任務相關檔案）：通過。
- Build 有既有 Dynamic server usage warning；未造成 build failure，且非本輪 voice routes 造成。

未完成事項：

- 尚未做人工 UI 驗收。
- 尚未做 authenticated dynamic API 測試。
- 尚未驗證 no-access / 無權限 voice API 矩陣。
- 尚未重跑 `supabase/test_supervisor_management_log_foundation.sql`。
- Follow-up 草稿目前主要完成 schema / API 模式，UI 仍以套用 Management Record 表單為主；完整 follow-up review 需另開小任務。
- Realtime transcription、voice draft DB table、永久音檔保存皆未做。

下一個最小任務：

**SML-VOICE-1 人工驗收與動態 API 驗證。**

必須確認：

- 有權限帳號可開 Voice Sheet。
- 手動文字稿可產生草稿。
- 若 `OPENAI_API_KEY` 已設定，音檔轉文字可用。
- Entity Matching 不會由 AI 直接產生正式 ID。
- 草稿套用後仍需人工確認才可儲存。
- no-access / 無權限使用者無法呼叫 voice API。
