# 總務服務中心 UX Blueprint

最後更新：2026-07-27

本文件是 Task UI-0「總務服務中心 UX、資訊架構與介面系統設計」產出。此階段只做盤點與設計，不修改 DB schema、RLS、RPC、API contract，也不開始 UI-1。

## 1. 設計目標

- 讓總務服務中心從「功能清單」變成「工作台」：每個角色進來後能直接看到自己下一步要做什麼。
- 延續正式菁英網現有導覽、RBAC 與資料表欄位，不建立第二套總務系統。
- 總務功能採「換內容不換皮」原則：DEV 與 Production 使用同一套 UI/API/schema，差異只在資料內容。
- 每個入口都要有清楚權限狀態：看不到入口、可進但只能看提示、可讀、可操作，要一致呈現。
- 已完成模組可操作；未建置模組顯示安全 availability 頁面，不顯示 schema cache 或 PostgreSQL 原始錯誤。
- 行動版要能完成查詢、申請、回報、查看進度與基本操作，不要求完整桌面密度。

## 2. 目前問題

- `/general-affairs` 是大型 client component，混合首頁、維修回報、工單中心、料件申請暫行紀錄、廠商管理與局部導覽，後續維護成本高。
- 上方 Navbar、總務內部側邊導覽、首頁卡片與 direct pages 的入口規則分散，容易出現「功能存在但找不到」或「未建置卻可操作」。
- 主檔頁面（設備、設施、料件、庫存）各自有列表、篩選、表單與權限提示，但版型與資訊密度尚未完全一致。
- 料件申請目前是暫行流程，透過 `maintenance_requests.resource_type = material` 模擬，尚未有正式申請單、審核、領用與庫存串接。
- 維修回報、工單、附件、廠商、庫存交易之間尚未形成一致的流程視圖。
- 權限不足、未建置、空資料、API 錯誤的呈現語氣與位置尚未統一。
- 手機導覽目前能進入，但未形成適合現場店長使用的底部/分組操作節奏。

## 3. 使用者與角色

| 使用者類型 | 典型權限來源 | 主要任務 | UX 重點 |
| --- | --- | --- | --- |
| 無總務權限使用者 | 無 `general_affairs.*` effective permissions | 不應進入總務功能 | Navbar 不顯示總務入口，直輸網址顯示權限不足 |
| 門市人員 / 店長 | `service_center.access`、store scope、未來工單/申請權限 | 提出維修、申請料件、查看自己門市進度 | 首頁要突出「新增回報」「申請料件」「我的紀錄」 |
| 督導 / 區域管理 | store scope 或巡店/管理權限 | 查看管轄門市問題與狀態 | 門市篩選、狀態彙總、跨店比較 |
| 總務承辦 | 工單處理、廠商、庫存相關權限 | 受理、分派、更新工單、調整庫存 | 工作佇列、批次處理、明細抽屜 |
| 總務主管 / 系統管理者 | manage 權限或 admin compatibility | 管理主檔、庫存、廠商、權限與流程例外 | 完整入口、稽核資訊、設定入口 |

## 4. 角色旅程

### 門市提出維修

1. 從 Navbar 進入「總務服務中心」。
2. 首頁看到「新增維修回報」主動作。
3. 選擇門市、資源類型、問題分類、描述與附件。
4. 送出後進入「我的回報」，看到狀態、受理人、進度、附件。
5. 工單完成時可查看完成說明與照片。

### 門市申請料件

1. 從 Navbar 或首頁點「申請料件」。
2. 選擇料件、需求數量、用途、急迫性、門市與附件。
3. 送出後進入「料件申請紀錄」。
4. 申請被核准後，未來可串接庫存出庫或調撥。

### 總務處理工單

1. 進入「工單中心」看到待受理、處理中、待確認佇列。
2. 點工單開啟右側明細抽屜。
3. 更新狀態、負責人、處理方式、附件與廠商資訊。
4. 若需要料件，從工單建立料件申請或扣料。
5. 完成後留下歷程與附件。

### 總務維護主檔

1. 從「資產與庫存」進入設備、設施、料件、庫存。
2. 使用相同列表模板：搜尋、篩選、分頁、排序、狀態。
3. 透過右側表單或 modal 新增/編輯。
4. soft delete 必須輸入原因。

### 系統管理者配置總務

1. 使用 RBAC 角色權限管理設定 permission codes。
2. 進入總務設定區管理範本、分類、庫存位置、廠商分類與區域。
3. 不透過帳號名稱或 `profiles.role` 猜測權限。

## 5. 資訊架構

總務服務中心建議分成五個穩定區域：

1. 工作台：首頁 dashboard、待辦、快捷操作。
2. 申請與回報：維修回報、我的回報、料件申請、申請紀錄。
3. 工單作業：工單中心、進度更新、派工、完成確認。
4. 資產與庫存：設備、設施、料件、庫存、庫存位置。
5. 廠商與設定：廠商、服務分類、服務區域、合作統計、分類設定。

## 6. 導覽樹

```text
總務服務中心
  工作台
    服務首頁                       /general-affairs
  申請與回報
    維修回報                       /general-affairs?section=maintenance
      新增回報
      我的回報
    申請料件                       /general-affairs?section=part-requests&action=new
    料件申請紀錄                   /general-affairs?section=part-requests
  工單作業
    工單中心                       /general-affairs?section=work-orders
  資產與庫存
    庫存管理                       /general-affairs/inventory
    庫存位置                       /general-affairs/inventory/locations
    設備管理                       展開群組，不直接導頁
      設備列表                     /general-affairs/equipment
      設備分類                     /general-affairs/equipment/categories
      保固管理                     /general-affairs/equipment/warranties
      維修紀錄                     /general-affairs/equipment/maintenance-history
    設施管理                       /general-affairs/facilities
      設施列表                     /general-affairs/facilities
      設施分類                     /general-affairs/facilities/categories
      維修紀錄                     /general-affairs/facilities/maintenance-history
    料件中心                       /general-affairs/parts
  廠商與服務設定
    廠商管理                       /general-affairs?section=vendors
      廠商列表
      服務分類管理
      服務區域管理
      合作記錄統計
```

尚未建置的採購、調撥、盤點、工單扣料、附件中心，不應出現在可操作入口。若 direct route 已存在但後端未完成，必須顯示 availability guard。

上方全站 Navbar 的「總務服務中心」只作為 `/general-affairs` 首頁入口，不顯示所有總務功能下拉清單；功能選擇統一交給總務內頁左側 Sidebar。

有子項目的父項目應與普通 sidebar 項目同一行高、同一左側對齊，只在文字旁顯示展開箭頭；不得做成突兀的全寬父按鈕。

## 7. 現有 Route / Page 盤點

| 路徑 | 目前用途 | 狀態 | 主要檔案 |
| --- | --- | --- | --- |
| `/general-affairs` | 服務首頁、維修、工單、料件申請暫行紀錄、廠商 tabs | 已可用但需拆分模板 | `app/general-affairs/page.tsx` |
| `/general-affairs?section=maintenance` | 新增回報 / 我的回報 | 暫以既有維修資料流運作 | `app/general-affairs/page.tsx` |
| `/general-affairs?section=work-orders` | 工單中心 | 已恢復入口，流程待完整收斂 | `app/general-affairs/page.tsx` |
| `/general-affairs?section=part-requests` | 料件申請暫行紀錄 | 暫用 `maintenance_requests.resource_type = material` | `app/general-affairs/page.tsx` |
| `/general-affairs?section=vendors` | 廠商 / 分類 / 區域 / 統計 | 已可新增廠商、分類、區域 | `app/general-affairs/page.tsx` |
| `/general-affairs/equipment` | 設備管理 | 已完成主檔 UI/API | `components/general-affairs/equipment/EquipmentManagementClient.tsx` |
| `/general-affairs/equipment/templates` | 設備範本 | 既有 route 保留，但已從 UI-4A 設備管理導覽與列表頁入口移除 | `components/general-affairs/equipment/EquipmentTemplatesClient.tsx` |
| `/general-affairs/facilities` | 設施管理 | 已完成主檔 UI/API | `components/general-affairs/facilities/FacilitiesClient.tsx` |
| `/general-affairs/parts` | 料件中心 | 已完成主檔與相容性 UI/API | `components/general-affairs/parts/PartsClient.tsx` |
| `/general-affairs/inventory` | 庫存管理 | Task 1C-2C Completed | `components/general-affairs/inventory/InventoryTransactionsClient.tsx` |
| `/general-affairs/inventory/locations` | 庫存位置與位置料件 | Task 1C-1 Completed | `components/general-affairs/inventory/InventoryLocationsClient.tsx` |

目前未找到 repo 內可直接作為總務新 UI 的 screenshot / Figma 參考；僅有既有系統畫面、正式區截圖與程式樣式可作為設計依據。

## 8. Page Template

### 8.1 Dashboard Template

- Header：breadcrumb、頁面標題、角色範圍提示、主要 CTA。
- KPI strip：最多 4 個，顯示待處理、進行中、今日新增、異常。
- Work queue：依角色顯示我的申請、待受理、待出庫、待補件。
- Quick actions：新增回報、申請料件、入庫、出庫。
- Recent activity：最新工單/申請/庫存異動。

### 8.2 List Template

- Header：標題、說明、主要 CTA。
- Filter bar：搜尋、狀態、門市、分類、日期、更多篩選。
- Table：固定欄位順序、狀態 badge、操作列。
- Empty：提供下一步，避免空白畫面。
- Permission denied：說明缺少哪個 permission code。
- Mobile：改為 card list，保留搜尋與主要篩選。

### 8.3 Detail Template

- 左側：核心資料與歷程。
- 右側：狀態、附件、關聯資源、可用動作。
- 動作不可用時顯示原因，不用直接隱藏所有脈絡。

### 8.4 Form Template

- 用 stepper 處理多段資料，如廠商與正式料件申請。
- 每步只放同一決策脈絡的欄位。
- 儲存前驗證與 API 錯誤顯示在欄位附近。
- 離開前提醒未儲存變更。

## 9. Dashboard Wireframe

```text
首頁 / 總務服務中心

總務服務中心                         [新增維修回報] [申請料件]
依你的權限顯示可處理的總務工作

[待受理 12] [處理中 8] [待出庫 3] [本週完成 21]

待辦工作
┌ 狀態 ┬ 類型 ┬ 門市 ┬ 標題 ┬ 負責人 ┬ 更新時間 ┬ 動作 ┐
│ 待受理 │ 維修 │ DEV001 │ 冷氣不冷 │ - │ 10:25 │ 查看 │

常用入口
[維修回報] [工單中心] [申請料件] [庫存管理]
[設備管理] [設施管理] [料件中心] [廠商管理]

最新動態
- 10:25 DEV001 新增維修回報
- 09:40 總部完成調減
```

手機版順序：主要 CTA、待辦、常用入口、KPI、最新動態。

## 10. Maintenance Wireframe

```text
首頁 / 總務服務中心 / 維修回報

維修回報                              [新增回報]
[新增回報] [我的回報]

新增回報 Step 1 基本資訊
門市 / 資源類型 / 問題分類 / 需求名稱

Step 2 補充資料
描述 / 聯絡人 / 電話 / 附件

Step 3 確認送出
摘要 / 附件預覽 / 送出
```

維修回報清單使用狀態 tabs：全部、未受理、已受理、處理中、已完成。

## 11. Work Order Wireframe

```text
首頁 / 總務服務中心 / 工單中心

工單中心                              [匯出] [新增工單]
[待受理] [處理中] [待完成確認] [已完成]

左：工單列表
右：工單明細抽屜
  - 基本資料
  - 狀態歷程
  - 附件
  - 使用料件
  - 廠商協作
  - 更新狀態表單
```

工單中心不應只是一張列表；總務承辦需要佇列與明細並排，減少跳頁。

## 12. Part Request Wireframe

```text
首頁 / 總務服務中心 / 料件申請

料件申請                              [新增申請]
[我的申請] [待審核] [待出庫] [已完成]

新增申請
Step 1 門市與用途
Step 2 選料件與數量
Step 3 附件與備註
Step 4 確認
```

正式料件申請未建立前，不得用料件主檔頁冒充。暫行紀錄頁須標示資料來源是回報中的料件/耗材類型。

## 13. Vendor Wireframe

```text
首頁 / 總務服務中心 / 廠商管理

廠商管理                              [新增廠商]
[廠商列表] [服務分類] [服務區域] [合作統計]

廠商列表
搜尋 / 狀態 / 分類 / 區域
表格：廠商、服務、聯絡、區域、狀態、評分、操作

新增廠商 Stepper
基本資料 -> 服務項目與區域 -> 聯絡與帳務 -> 合作與備註 -> 附件
```

廠商附件在正式附件模組前，只能保留安全欄位或顯示未開放提示，不得接受任意外部 URL。

## 14. Inventory Wireframe

```text
首頁 / 總務服務中心 / 庫存管理

庫存管理                              [入庫] [出庫] [調增] [調減]
[庫存餘額] [交易流水] [庫存位置]

庫存餘額
搜尋 / 門市 / 位置 / 料件分類 / 低庫存
表格：位置、料件、現存、基礎單位、最後異動、操作

交易流水
交易單號、類型、數量、原因、建立人、時間

表單
位置 / 料件 / 單位 / 數量 / 原因 / idempotency key
```

庫存頁應保留目前已驗收的 API / RPC / RLS 行為，不因 UI 改版改動交易語意。

## 15. Shared Components

建議 UI-1 建立或收斂以下共用元件：

- `GeneralAffairsShell`：總務內頁布局、sidebar、mobile nav、breadcrumb。
- `GeneralAffairsPageHeader`：標題、說明、breadcrumb、actions。
- `GeneralAffairsSectionTabs`：tabs 與 active 狀態。
- `GeneralAffairsFilterBar`：搜尋、篩選、排序、清除。
- `GeneralAffairsDataTable`：密集表格與 mobile card fallback。
- `GeneralAffairsState`：loading、empty、error、permission denied、module unavailable。
- `GeneralAffairsFormDrawer`：右側表單/明細抽屜。
- `PermissionHint`：缺權限提示，顯示必要 permission code。
- `SoftDeleteDialog`：要求刪除原因。
- `AttachmentPicker`：安全檔案選擇與預覽。

## 16. 視覺規則

- 操作型後台採安靜、密集、可掃描的設計，不做大型行銷 hero。
- 主色沿用總務目前橘色系作 active / CTA，系統全域 Navbar 可保留藍色 active。
- 卡片 radius 不超過 8px；避免卡片包卡片。
- 表格列高保持可掃描，狀態使用小 badge。
- 主要 CTA 每頁最多 1-2 個，其餘放更多選單。
- lucide icons 優先使用既有圖示。
- 不使用一整頁單色漸層或裝飾性背景。
- 表單欄位錯誤顯示在欄位附近，頁面頂部可顯示總錯誤。

## 17. Mobile Rules

- 手機版總務 sidebar 改為橫向 tabs 或 drawer，不造成水平 overflow。
- 長表單用 stepper，每步只顯示必要欄位。
- 表格切換為 card list，卡片需顯示狀態、門市、主題、時間與主要動作。
- 主要 CTA 固定在 header 或底部 action bar，但不要遮住內容。
- modal 在手機應全螢幕或接近全螢幕。
- 未儲存離開提醒在手機也必須生效。

## 18. 權限呈現

- Navbar：只顯示使用者具備 effective permission 且模組已完成/可安全進入的入口。
- 頁面：直輸網址仍必須做 server/API/RLS 權限檢查。
- 行為按鈕：如果使用者可看但不可操作，按鈕隱藏或 disabled 並顯示原因；管理者缺關聯權限時要明確列 permission code。
- 權限不足訊息格式：
  - 標題：目前帳號沒有此功能權限。
  - 內容：缺少 `permission.code`。
  - 動作：回總務服務中心或聯絡系統管理員。
- admin compatibility 必須標示為相容來源，不假裝是角色授權。

## 19. Loading / Empty / Error States

- Loading：骨架或 spinner 加上具體文案，例如「載入庫存位置」。
- Empty：說明目前沒有資料，若有管理權限提供新增 CTA。
- Error：使用者友善訊息，不顯示 table name、schema cache、SQL、stack trace。
- Permission denied：顯示缺少權限，不顯示新增/儲存/刪除按鈕。
- Module unavailable：顯示「此功能尚未在目前測試環境開放」，並提供返回服務首頁。
- Partial permission：例如有 inventory manage 但缺 part.view，顯示「缺少 `general_affairs.part.view`，因此無法新增位置料件設定」。

## 20. Migration-free UI Implementation Plan

UI-1 到 UI-7 前半段應先做到 migration-free：

- 不新增資料表。
- 不改 RPC/RLS/API contract。
- 不改已套用 migration。
- 優先抽共用 layout、navigation config、state components。
- 原本可操作的 API 行為維持不變。
- 未完成正式 DB 的流程顯示 availability 或暫行流程標示。

## 21. 分階段 Redesign Order

### UI-1：Layout、Sidebar、Navigation Definition、Page Header、Common Templates

目標：建立單一總務導覽定義與頁面模板，不改業務流程。

狀態：**Completed（2026-07-26，本機實作、靜態測試、TypeScript、build 與人工 UI 驗收全部通過）。**

預期檔案：

- `components/general-affairs/navigation.tsx`
- `components/general-affairs/features.ts`
- `components/general-affairs/GeneralAffairsShell.tsx`
- `components/general-affairs/GeneralAffairsPageHeader.tsx`
- `components/general-affairs/GeneralAffairsPageState.tsx`
- `components/general-affairs/GeneralAffairsPageTemplates.tsx`
- `components/general-affairs/GeneralAffairsSidebar.tsx`
- `app/general-affairs/layout.tsx`
- `components/Navbar.tsx`
- `app/general-affairs/page.tsx`
- 相關靜態測試

驗收：

- Navbar 與總務內部導覽來源一致。
- desktop/mobile active 狀態正確。
- 無權限/未建置不顯示可操作入口。

實作結果：

- General Affairs Layout 已完成。
- 集中式 Navigation Definition 已完成。
- Feature Availability 定義已完成。
- Navbar 與總務 sidebar 已共用 `GENERAL_AFFAIRS_NAV_GROUPS`。
- Desktop sidebar 支援展開/收合；mobile 使用 drawer。
- Sidebar 展開/收合狀態以 localStorage 保存，人工驗收通過。
- Mobile Drawer 已完成並通過人工驗收。
- effective permissions 導覽過濾已通過。
- Planned / temporarily unavailable 功能不產生可點擊入口。
- available / planned / temporarily_unavailable 顯示規則已通過。
- `/general-affairs` query 導覽已支援外部 link 驅動既有內容切換。
- `GeneralAffairsPageHeader`、`GeneralAffairsPageState`、`GeneralAffairsPageTemplates` 已建立，後續頁面可逐步套用。
- Loading / Empty / Error / Permission denied / Module unavailable states 已完成。
- List / Dashboard / Form templates 已完成。
- `/general-affairs/inventory` 接入共用 Page Header 後 regression 通過。
- Active state 已改為最具體路徑優先：exact match 優先、最長 prefix match 次之，單一時間只會有一個 active nav item。
- UI-1 人工驗收全部通過。

### UI-2：Service Homepage Dashboard

目標：把服務首頁改成角色化工作台。

狀態：**Completed（2026-07-26，靜態測試、TypeScript、build 與人工 UI 驗收全部通過）。**

預期檔案：

- `components/general-affairs/dashboard/*`
- `app/general-affairs/page.tsx`

驗收：

- 門市角色看到申請/回報入口與自己的紀錄。
- 總務角色看到待受理/待處理/庫存快捷。
- 無權限被安全阻擋。

本輪實作結果：

- `/general-affairs` 已由功能介紹首頁改為工作待辦首頁。
- 首頁使用 `GeneralAffairsPageHeader`、`GeneralAffairsDashboardPage` 與 UI-1 Page State components。
- KPI 只使用現有真實 API：
  - `/api/general-affairs/inventory/balances`
  - `/api/general-affairs/inventory/transactions`
  - `/api/general-affairs/inventory/options`
- 目前顯示的 KPI 僅限已完成後端資料來源的庫存項目：庫存餘額項目、近 7 日庫存異動、可用位置料件、負庫存項目。
- 待審申請、待收貨、調撥、盤點、工單扣料等尚未完成正式後端流程的 KPI 不顯示假數字。
- 我的待辦目前只顯示由庫存位置料件設定與餘額可安全判定的低庫存項目；沒有可靠資料來源時顯示空狀態。
- 異常提醒目前只顯示負庫存與低庫存，皆由現有庫存 API 回傳資料計算。
- 快速操作只顯示 available route 與使用者具備 effective permission 的入口。
- 最近活動顯示近 7 日庫存流水；若無資料或無權限則不顯示假活動。
- 每個 dashboard 區塊可局部 loading / error，不因單一 API 失敗拖垮整頁。
- API failure 不會被當成 KPI 0；沒有資料與載入失敗會分開呈現。
- Store scope 完全依現有 API / RLS 回傳範圍，不由前端自行推算或擴大。
- 五個 DEV 測試帳號的人工權限驗收全部通過。
- Desktop、Tablet、Mobile 人工驗收全部通過。
- Loading、Empty、局部錯誤與安全錯誤顯示通過。
- 庫存頁與 UI-1 navigation regression 通過。
- Task UI-2 正式 Completed。

### UI-3：Maintenance / My Reports / Work Orders

目標：把維修回報與工單中心收斂成一致流程。

狀態：**本機實作完成（2026-07-26，靜態測試、UI-1 / UI-2 regression、TypeScript、build 與 diff check 通過；待人工 UI 驗收後才能標記 Completed）。**

預期檔案：

- `components/general-affairs/maintenance/*`
- `app/general-affairs/page.tsx`

驗收：

- 新增回報、我的回報、工單明細、狀態更新一致。
- 附件狀態清楚。
- 權限不足不顯示操作。

本輪實作結果：

- `components/general-affairs/maintenance/status.ts` 已建立維修 status UI definition，統一 status code、中文 label、semantic tone、terminal flag 與目前支援的 manage actions。
- `/general-affairs?section=maintenance` 的新增維修回報已接入 `GeneralAffairsFormPage` 與 `GeneralAffairsPageHeader`。
- `/general-affairs?section=maintenance` 的我的回報已接入 `GeneralAffairsListPage`、`GeneralAffairsPageHeader` 與 shared Page State。
- `/general-affairs?section=work-orders` 的工單中心已接入 `GeneralAffairsListPage`、`GeneralAffairsPageHeader` 與 shared Page State。
- 工單中心保留現有 `/api/maintenance-requests`、`/api/maintenance-updates`、`/api/maintenance-photos`、`/api/maintenance-progress-stages` 資料來源與流程語意。
- Store scope 完全依既有 API / RLS 與 `store_managers` 範圍，不由前端自行擴大。
- 強制結案操作已額外受 `general_affairs.service_center.force_close` 控制；後端原有 transition permission guard 不變。
- 未完成的設備詳情、報價、派工、請款、正式附件、工單扣料與 SLA 流程不顯示為可操作按鈕。
- API error 透過 shared Page State 呈現，不直接顯示 schema cache、table name、SQLSTATE、migration filename 或 stack trace。
- 本輪未新增 DB schema、migration、RLS、RPC 或 API contract。
- 技術驗證已通過：`node scripts/test-general-affairs-maintenance-ui.js`、`node scripts/test-general-affairs-ui-foundation.js`、`node scripts/test-general-affairs-dashboard-ui.js`、`npx tsc --noEmit --pretty false`、`npm run build`、`git diff --check`。
- `npm run build` 仍會出現既有 `DYNAMIC_SERVER_USAGE` 訊息，但 exit 0，非 UI-3 build failure。
- 人工 UI 驗收尚未完成；通過後才能正式標記 Task UI-3 Completed。

### UI-3A：角色權限矩陣與導覽收斂插單

狀態：**部分完成，尚未 Completed（2026-07-27）。**

插入原因：

- UI-3 人工驗收期間發現一般人員、店長、督導、總務四種角色在總務服務中心的導覽與權限矩陣尚未正式收斂。
- 不能只依 `general_affairs.service_center.access` 顯示所有總務子功能，也不能用 email、role name、職稱文字或 `profiles.role` 判斷新功能權限。

本輪已完成：

- 維修回報、我的料件申請暫行入口、工單中心改用 `cross_dept.maintenance.*` 權限語意。
- 暫行料件申請保留為 maintenance-backed flow，不新增正式 `general_affairs.part_request.*` 權限碼。
- 廠商入口已從 service center access 拆出，前端期待正式 vendor / service category / service region / cooperation record permission codes。
- 舊總務首頁的設備、設備範本、設施、料件、庫存入口改回各自正式 permission codes，不再被維修 `view_all` / `update` 權限帶開。
- 新增 `scripts/test-general-affairs-role-matrix-dev.js`，覆蓋角色矩陣 fixture、維修 API guard、暫行料件申請、廠商導覽、store scope、planned feature 與 no email / role-name authorization。

UI-3A-1 regression audit：

- 人工複驗發現店長、督導、總務三個 DEV 帳號 Sidebar 幾乎只剩「服務首頁」。
- 根因是前一輪導覽改為與 API guard 一致後，DEV 測試角色尚未補上 `cross_dept.maintenance.*` 與資產 / 庫存 view/manage role_permissions。
- 已建立 local-only migration 草案：`20260727015132_dev_general_affairs_role_matrix_permissions.sql`。
- 該草案只補 DEV 測試角色 `role_permissions`，不依 email，不新增使用者，不授予 vendor 權限，不修改 RLS / RPC / API contract。
- `npx supabase db push --dry-run` 已通過，只列出 `20260727015132_dev_general_affairs_role_matrix_permissions.sql`。

目前阻擋：

- `20260727015132` 尚未正式 DEV push，因此實際 Sidebar regression 尚未在 DEV DB 中修復。
- DEV schema 目前尚未具備正式廠商相關 permission codes：`general_affairs.vendor.view`、`general_affairs.vendor.manage`、`general_affairs.service_category.view`、`general_affairs.service_category.manage`、`general_affairs.service_region.view`、`general_affairs.service_region.manage`、`general_affairs.cooperation_record.view`。
- `ga_vendors`、`ga_service_categories`、`ga_service_regions` 的 RLS 仍使用 `general_affairs.service_center.access`，需要 approved forward migration 收斂。

下一步：

- 先批准正式 DEV push，只推 `20260727015132_dev_general_affairs_role_matrix_permissions.sql`。
- 推送後人工複驗店長、督導、總務 Sidebar 是否恢復。
- 再進入 UI-3A-2：新增廠商相關 permission codes 並收斂 RLS。
- 最後重跑 UI-3A 動態驗收與 UI-3 人工 UI 驗收。

### UI-3B：我的回報與工單中心單一資料來源及介面收斂

狀態：**本機實作完成（2026-07-27，靜態測試、TypeScript、build 與 diff check 通過；待人工 UI 驗收後才能標記 Completed）。**

最新資訊架構決策：

- 「我的回報」是店長 / 督導 / requester 追蹤設備、設施、料件／耗材回報的唯一入口。
- 「工單中心」是總務端處理同一批 maintenance requests 的入口。
- 料件／耗材不再是獨立追蹤流程；它只是 `maintenance_requests.resource_type = material` 的資源類型篩選。
- 舊 `section=part-requests` query 僅保留相容策略：自動回到「維修回報 / 我的回報」，並套用 material filter；Sidebar 不再顯示獨立「料件／耗材回報紀錄」。
- 新增料件／耗材需求仍從「新增回報」進入，於基本資訊選擇「料件／耗材」。

我的回報新版版型：

- Breadcrumb：`首頁 / 總務服務中心 / 維修回報 / 我的回報`。
- Page Header：標題 `我的回報`，說明為「查看您或所屬門市提出的設備、設施與料件／耗材回報及處理進度」。
- 狀態頁籤：使用既有 maintenance status mapping，不新增 DB status。
- KPI 摘要卡：全部、未受理、已受理、處理中、已完成；數字由目前查詢成功的真實 requests 計算，不使用假數字。
- 篩選工具列：回報日期區間、資源類型、狀態、門市、關鍵字、查詢、清除條件。
- 桌面版：密集工單追蹤表格，包含工單編號、資源／項目、問題描述、緊急程度、狀態、處理進度、建立時間、預計完成、操作。
- Mobile：改為工單卡片，不使用寬表格。
- 詳情：使用右側 detail drawer 顯示基本資料、資源資料、問題描述、狀態、處理進度、附件與公開更新紀錄。

資料與權限規則：

- 「我的回報」與「工單中心」共用 `/api/maintenance-requests`、`/api/maintenance-updates`、`/api/maintenance-progress-stages` 與 `/api/maintenance-photos`。
- Store scope 完全依 API / RLS / `store_managers`，前端只做顯示與篩選，不擴大範圍。
- 狀態與進度共用 `components/general-affairs/maintenance/status.ts` 與既有 updates / progress stages。
- 不顯示後端尚未支援的假派工、報價、請款、預計完成或假進度事件。
- 店長 / 督導不需進入工單中心即可追蹤自己或管轄門市的處理進度。
- 本輪未修改 DB、migration、RLS、RPC 或 API contract。

技術驗證：

- `node --check scripts/test-general-affairs-maintenance-views.js`：通過。
- `node scripts/test-general-affairs-maintenance-views.js`：通過。
- `node scripts/test-general-affairs-role-matrix-dev.js`：通過。
- `node scripts/test-general-affairs-maintenance-ui.js`：通過。
- `node scripts/test-general-affairs-ui-foundation.js`：通過。
- `node scripts/test-general-affairs-dashboard-ui.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過；仍有既有 `DYNAMIC_SERVER_USAGE` 訊息，非本輪 failure。
- `git diff --check`：通過；只有既有 CRLF warning。

人工驗收重點：

- 「我的回報」同一列表可看到設備、設施、料件／耗材回報。
- 可依資源類型切換，不需進入另一頁。
- 工單中心更新後，「我的回報」讀同一主資料與更新紀錄。
- 店長 / 督導不顯示工單中心，除非具備正式工單中心權限。
- Desktop 1440px 需能理解頁面結構：狀態頁籤、KPI、篩選列、表格、進度、分頁。
- Mobile 需顯示卡片版，不產生水平 overflow。
- 不得出現假 KPI、假進度或假預計完成日期。

### UI-4：Equipment / Facilities / Parts / Inventory Uniformity

目標：主檔與庫存頁共用列表、篩選、表單與刪除模式。

狀態：**設備與設施管理 UI 本機實作完成（2026-07-29，靜態測試、角色矩陣 regression、TypeScript 通過；待人工 UI 驗收後才能標記 Completed）。**

本輪完成範圍：

- 新增 `components/general-affairs/assets/AssetManagementUI.tsx`，集中 KPI、頁籤、狀態 badge、placeholder、詳情面板、維修歷程與表單 section。
- `/general-affairs/equipment` 作為設備管理下的「設備列表」頁：
  - Breadcrumb / Page Header。
  - KPI 摘要：設備總數、使用中、需留意狀態、保固需確認。
  - 不再承載分類、保固、維修歷程 tabs；這些能力改由左側設備管理展開子項進入。
  - 篩選：搜尋、門市、分類、狀態、保固。
  - 桌面密集表格與 mobile 卡片。
  - 右側設備詳情面板。
  - 新增 / 編輯設備表單改為分段式正式表單。
  - 設備範本不再作為設備管理、總務首頁或工作台的可見入口。
- `/general-affairs/facilities` 從單純設施列表升級為正式設施管理介面：
  - Breadcrumb / Page Header。
  - KPI 摘要：設施總數、使用中、需處理、固定資產、高重要度。
  - 頁籤：設施列表、分類視圖、維修歷程。
  - 篩選：搜尋、門市、分類、狀態、區域。
  - 桌面密集表格與 mobile 卡片。
  - 右側設施詳情面板。
  - 新增 / 編輯設施表單改為分段式正式表單。
- 維修歷程只讀取既有 `/api/maintenance-requests`，並以 `equipment_id` / `facility_id` 連結；若 API 或欄位不可讀，顯示安全訊息，不顯示假紀錄。
- 設備保固只使用既有 `has_warranty`、`warranty_end_date`；不顯示尚未建置的保固文件、廠商或採購流程。
- 設施頁不顯示尚未建置的巡檢、保養排程、廠商、費用或附件流程。
- 未新增 DB schema、migration、RLS、RPC 或 API contract。
- 導覽 regression 修正：`我的回報` nav id 回復為 `maintenance`，保留「新增回報」在「我的回報」前方，讓角色矩陣仍可驗證維修模組權限。

預期檔案：

- `components/general-affairs/equipment/*`
- `components/general-affairs/facilities/*`
- `components/general-affairs/parts/*`
- `components/general-affairs/inventory/*`
- shared components

驗收：

- 四組主檔與庫存頁操作語言一致。
- mobile card fallback 可用。
- soft delete reason 一致。

本輪已通過的技術驗證：

- `node --check scripts/test-general-affairs-asset-management-ui.js`
- `node scripts/test-general-affairs-asset-management-ui.js`
- `node scripts/test-general-affairs-ui-foundation.js`
- `node scripts/test-general-affairs-maintenance-views.js`
- `node scripts/test-general-affairs-maintenance-ui.js`
- `node scripts/test-general-affairs-dashboard-ui.js`
- `node scripts/test-general-affairs-role-matrix-dev.js`
- `npx tsc --noEmit --pretty false`

尚待人工驗收：

- 設備管理：列表、分類視圖、保固追蹤、維修歷程、右側詳情、新增 / 編輯 / soft delete、mobile 卡片。
- 設施管理：列表、分類視圖、維修歷程、右側詳情、新增 / 編輯 / soft delete、mobile 卡片。
- 確認未支援的保固文件、巡檢、保養排程、廠商、費用與附件不被顯示為可操作功能。

#### UI-4A 插單修正：設備／設施子模組導覽、正式新增表單、圖片能力與資產編號收斂

狀態：**本機修正完成（2026-07-29，靜態測試、TypeScript、build 與 diff check 通過；待人工 UI 複驗後才能重新判定 UI-4）。**

人工驗收回饋：

- 設備與設施管理不應把列表、分類、保固與維修歷程全部塞在同一頁 tabs。
- 新增設備應改為正式多步驟建檔頁，而不是承載在簡單 drawer。
- 資產編號需依實際第二層分類 code 4 碼、購買日期與流水號由後端安全產生，不得在前端自行產生可能重複的流水號。
- 圖片上傳若缺 Storage / attachment 後端能力，不得顯示假成功。

本輪已完成：

- Sidebar 導覽已改為設備／設施子模組 routes：
  - `/general-affairs/equipment`
  - `/general-affairs/equipment/categories`
  - `/general-affairs/equipment/new`
  - `/general-affairs/equipment/templates`
  - `/general-affairs/equipment/warranties`
  - `/general-affairs/equipment/maintenance-history`
  - `/general-affairs/facilities`
  - `/general-affairs/facilities/categories`
  - `/general-affairs/facilities/new`
  - `/general-affairs/facilities/maintenance-history`
- 設備與設施列表頁已移除主功能 tabs，只保留列表、KPI、篩選、詳情面板、編輯與 soft delete。
- 設備分類與設施分類建立共用分類樹頁，使用既有 `ga_equipment_categories` / `ga_facility_categories` 與 categories API。
- 分類頁支援 KPI、三層分類樹、展開收合、新增／編輯、啟用／停用、分類資產數、前端防循環與第四層提示。
- 分類新增／編輯的「上層分類」不得使用所有分類攤平的單一下拉選單；已改為第 1 層開始的逐層選取器，選取某層後才顯示下一層，並顯示目前上層路徑。
- 新增設備改為 `/general-affairs/equipment/new` 五階段表單：基本資訊、安裝資訊、保固資訊、其他資訊、完成確認。
- 新增設備表單支援必填驗證、欄位錯誤定位、未儲存離開提醒與購買金額格式化。
- 新增設備表單的設備分類選擇也不得使用所有分類攤平的單一下拉；已改成逐層分類選取器並顯示目前分類路徑。
- 設備圖片與附件基礎已補上本機實作：`ga_resource_attachments`、private Storage bucket 規劃、upload API、signed URL API、soft delete API 與共用附件 UI；尚待 DEV dry-run / db push / catalog SQL / 人工 UI 複驗後才能正式標記完成。
- 資產編號在 UI 中只顯示後端產號預覽，不送出前端產生的流水號；正式自動產生需要後續 forward migration。
- 資產編號正式格式為 `{LEVEL_2_CATEGORY_CODE}{PURCHASE_DATE_YYYYMMDD}{SEQUENCE_3_DIGITS}`，其中 `LEVEL_2_CATEGORY_CODE` 必須取實際第二層分類 code 4 碼，例如設備 `IC01`、設施 `AS01`；不得取第一層 2 碼，也不得取第三層 6 碼。
- 流水號範圍為同一第二層分類、同一購買日期各自獨立遞增 3 碼。
- 標籤列印已預留 disabled placeholder，待正式 asset code helper 啟用後再接。
- 保固管理獨立為 `/general-affairs/equipment/warranties`，只使用 `has_warranty` / `warranty_end_date` 真實欄位。
- 設備／設施維修紀錄獨立子頁只讀既有 `/api/maintenance-requests` 並依 `equipment_id` / `facility_id` 篩選。

現況矩陣：

| 需求 | 現有 UI | 現有 API | 現有 DB 支援 | 本輪可直接完成 | 是否需 Migration |
|---|---|---|---|---|---|
| 設備子模組 routes | 原先集中於 tabs | 既有 equipment / templates / maintenance API | 既有設備主檔 | 已完成 route 拆分 | 否 |
| 設施子模組 routes | 原先集中於 tabs | 既有 facilities / maintenance API | 既有設施主檔 | 已完成 route 拆分 | 否 |
| 設備分類 CRUD | 原先只是分類視圖 | categories GET/POST/PATCH/DELETE | `ga_equipment_categories` | 已完成分類樹 UI | 否 |
| 設施分類 CRUD | 原先只是分類視圖 | categories GET/POST/PATCH/DELETE | `ga_facility_categories` | 已完成分類樹 UI | 否 |
| 設備圖片 / 共用附件 | 原先只有 `image_path` 顯示能力 | 已本機新增 `/api/general-affairs/attachments` 與 `/api/general-affairs/attachments/[id]` | 已本機新增 `ga_resource_attachments` / Storage bucket migration，尚未套用 DEV | 設備、設施、維修回報已接入共用附件 UI | 是，需推送 `20260729125755_general_affairs_resource_attachments.sql` |
| 資產編號自動產生 | 原先可手填 | 已新增安全產號 helper / trigger 並推送 DEV | `asset_code` nullable + unique；新增 `ga_asset_code_sequences` | 顯示只讀預覽，不前端產號；預覽取第二層分類 code 4 碼，儲存時由後端產生 | 是，需人工新增設備複驗 |
| 標籤列印預留 | 未正式收斂 | 無列印 API | 依賴正式 asset code | disabled placeholder | 待 asset code 完成後評估 |
| 購買金額 | 既有欄位局部顯示 | equipment API 支援 | `purchase_amount` 已存在 | 新表單格式化顯示 | 否 |
| 表單錯誤定位 | 分散 | 既有 API validation | 無 DB 變更 | 新增設備／設施表單已加入 | 否 |

資產編號後續建議：

- 使用既有三層分類 code 中的「實際第二層 code 4 碼」作為資產編號前綴，例如 `IC01`、`AS01`。
- Forward migration `20260730002830_generate_equipment_asset_code_sequence.sql` 已推送 DEV，後端 helper / trigger 會產生 `{第二層分類code4碼}{購買日期YYYYMMDD}{3碼流水號}`。
- 正式產號在 DB trigger 內完成，避免多使用者同時新增造成重複；前端仍只送 `asset_code: null`。
- `supabase/test_general_affairs_equipment_asset_code_sequence.sql` 已通過；尚需人工新增設備複驗。

本輪未做：

- 本輪已新增並推送 forward migration。
- 未建立 Storage bucket / policy。
- 已建立設備 asset code helper / 內部 sequence table，並完成 DEV DB 驗收；尚未人工 UI 複驗。
- 未修改 API contract、RLS 或 RPC。
- 未開始 UI-5。

### UI-5：Vendor Management

目標：將廠商五段式表單、分類、區域、統計拆成可維護元件。

預期檔案：

- `components/general-affairs/vendors/*`
- `app/general-affairs/page.tsx`

驗收：

- 新增/編輯廠商、分類、區域操作一致。
- 未建置附件不顯示假上傳成功。

#### UI-4B 插單修正：新增料件正式 5 Step 表單

狀態：**本機 UI 實作完成（2026-08-10，靜態測試、TypeScript、build 與 regression 通過；待人工 UI 複驗後才能重新判定 UI-4）。**

任務背景：

- 使用者確認料件管理的核心概念：
  - 料件管理 = 管理「這是什麼料件」。
  - 庫存管理 = 管理「料件在哪裡、有多少」。
  - 料件申請 = 使用者提出「我需要什麼」。
- 新增料件頁不得輸入初始庫存、庫存位置數量或任何假交易。

本輪已完成：

- 新增正式路由：
  - `/general-affairs/parts/new`
- 新增 client：
  - `components/general-affairs/parts/PartCreatePageClient.tsx`
- Sidebar `料件管理 > 新增料件` 已改為可點擊入口。
- 料件列表頁主要操作改為 `新增料件`，並保留庫存管理與庫存位置次要入口。
- 表單改為 5 Step：
  1. 基本資訊
  2. 用途與相容性
  3. 單位與包裝
  4. 庫存設定與其他資訊
  5. 確認建立
- Step 1 包含：
  - 料件名稱
  - 三層料件分類選擇
  - 啟用 / 停用
  - 料號
  - 廠牌 / 品牌
  - 型號
  - 規格
  - 條碼
  - 描述
  - 料件圖片能力提示
- Step 2 包含：
  - 用途類型：維修零件、消耗品、備品、通用耗材。
  - 相容性範圍：通用料件、限制相容。
  - 限制相容時可新增既有 schema 支援的三種相容條件：
    - 設備範本
    - 品牌型號
    - 廠商系列
- Step 3 包含：
  - 基本庫存單位
  - 採購單位
  - 採購換算率
  - 最小領用量
  - 允許拆包
  - 允許小數領用
  - 即時單位摘要
- Step 4 明確提示：
  - 本頁不輸入初始庫存。
  - 料件建立後，再到庫存位置設定位置是否管理此料件。
  - 實際數量必須由庫存交易建立。
  - 可維護標籤與備註。
- Step 5 顯示完整確認摘要與庫存建立提示。
- 表單 UX 已加入：
  - validation summary
  - 跨 step 錯誤定位
  - scroll / focus 第一個錯誤欄位
  - 未儲存離開提醒
  - double click 防護
  - API failure 保留輸入內容
- 目前附件 API 尚未支援 `resource_type = PART`，因此料件圖片區不顯示假上傳成功，只顯示明確未開放提示。
- 目前 `ga_part_compatibilities` 不支援設施相容性，因此本頁不顯示假的設施相容性欄位。

現有 schema 缺口：

- `ga_parts` 目前沒有獨立欄位：
  - `usage_type`
  - `compatibility_scope`
- 本輪為了不修改 DB schema，暫以 `ga_parts.specs` 相容保存：
  - `part_usage_type`
  - `part_compatibility_scope`
  - `part_schema_note`
- 若要讓上述欄位成為正式可查詢、可約束與可報表的欄位，後續需另開最小 forward migration，不得修改已套用 migration。
- 料件圖片若要正式支援，後續需擴充附件 schema / API / policy，讓 `ga_resource_attachments.resource_type` 與 upload API 支援 `PART`。

本輪未做：

- 未新增 DB migration。
- 未執行 db push。
- 未修改 RLS / RPC / API contract。
- 未建立料件申請流程。
- 未建立工單扣料、採購、盤點、調撥或庫存交易新功能。

本輪技術驗證：

- `node --check scripts/test-general-affairs-part-form-ui.js`：通過。
- `node scripts/test-general-affairs-part-form-ui.js`：通過。
- `node scripts/test-general-affairs-ui-foundation.js`：通過。
- `node scripts/test-general-affairs-asset-management-ui.js`：通過。
- `node scripts/test-general-affairs-asset-form-validation.js`：通過。
- `node scripts/test-general-affairs-role-matrix-dev.js`：通過。
- `node scripts/test-general-affairs-dashboard-ui.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過。仍有既有 Dynamic server usage 訊息，但不是 build failure。

下一個最小任務：

**人工複驗 `/general-affairs/parts/new` 新增料件 5 Step 表單。**

驗收重點：

- 料件管理 Sidebar 可看到並進入「新增料件」。
- `part.manage` 使用者可建立料件。
- 無 `part.manage` 使用者不可看到或不可操作新增入口，直接輸入網址仍需由 API 阻擋。
- 通用料件可建立。
- 限制相容料件可新增設備範本、品牌型號、廠商系列相容條件。
- 缺料件名稱、缺分類、缺基本庫存單位、採購單位與換算率不一致時會顯示中文錯誤並跳到對應 step。
- 不會要求輸入初始庫存。
- 料件圖片只顯示未開放提示，不顯示假上傳成功。
- Mobile 無水平 overflow。

### UI-6：Formal Part Request UI

目標：在正式 DB/API 設計完成後，建立真正料件申請流程 UI。

前置：

- 必須先有料件申請 UX spec 與 DB/API 設計批准。

驗收：

- 不再依賴維修回報 resource_type 模擬。
- 可審核、可關聯庫存、可查看申請紀錄。

### UI-7：Mobile / Accessibility / Manual UI Acceptance

目標：完成跨角色、手機、鍵盤、錯誤狀態與人工驗收。

驗收：

- 桌面與手機導覽可用。
- 主要流程鍵盤可操作。
- 權限與未建置狀態不外洩原始錯誤。
- 使用 DEV 驗收帳號逐項確認。

## 22. API / DB 影響

本藍圖階段無 API / DB / migration 影響。後續 UI-1 到 UI-5 應優先維持 migration-free；只有正式料件申請、附件、採購、調撥、盤點與工單扣料進入資料模型階段時，才另行設計 migration。

## 23. 需要使用者決策

- 總務首頁已採左側固定 sidebar；上方 Navbar 只保留總務首頁入口，不再承載總務功能 dropdown。
- 正式料件申請要獨立資料表，或繼續與維修/工單共表但增加類型與流程欄位。建議獨立資料表，再用關聯欄位串接工單與庫存。
- 附件模組先做通用 `attachments`，或維修/料件/廠商各自欄位。建議通用附件模組，但需獨立設計 Storage policy。
- 工單是否允許直接扣料，或必須先建立料件申請再由庫存出庫。建議 MVP 先由工單建立料件申請，庫存出庫保留審核節點。
- Dashboard 第一批 KPI 要以維修工單、料件申請、庫存異常或廠商合作為主。
