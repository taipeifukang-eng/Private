# M9 F01S 規格：「回舊版」連結（C2）與逐頁備援開關（N2）

2026-11-23 上線準備問卷決定：C2 選單預設開新版，且工作台內每個頁面都要有看得到的「回舊版」連結；N2 系統管理員可以逐頁把某一頁切回舊版（切換後該頁選單改開舊版路由），不需重新部署，並要先在 DEV 演練。

## 1. 唯一來源：kind 對應舊版路由

程式：`lib/workspace/legacy-routes.ts`（`LEGACY_ROUTE_MAP`、`NO_LEGACY_REASON`、`FALLBACK_SWITCHABLE_KINDS`）。導覽（`lib/workspace/navigation.ts` 項目的 `href`）、總務側欄（`lib/workspace/general-affairs/nav.ts` 的舊網址對照）與這張表由單元測試（`tests/unit/M9-F01S/legacy-routes.test.ts`）逐項比對，不會各說各話。

規則：
- 每個頁面種類都必須在表內；沒有舊版對應填 `null` 並寫原因（測試強制，清單固定）。
- 舊版路由必須在 `app/` 底下真的有 `page.tsx`（測試強制）。
- 需要 id 或一次性代碼的舊版明細頁（`/inspection/[id]`、`/assignment/[id]`、`/general-affairs/assets/scan/[token]`）一律連到它的清單頁或入口頁，因為新版紀錄編號與舊版不同，硬接會連到錯的資料（allowlist：`m9-c2-link-detail-to-list`，待使用者確認）。

| 頁面種類（kind） | 類型 | 舊版路由 |
|---|---|---|
| `transfers` | 選單頁 | `/admin/promotion-management` |
| `movement-management` | 選單頁 | `/admin/promotion-management` |
| `movement-draft` | 選單頁 | `/admin/promotion-management` |
| `movement-history` | 選單頁 | `/admin/promotion-management` |
| `employees` | 選單頁 | `/admin/employee-management` |
| `employee-history` | 明細頁 | `/admin/employee-management` |
| `employee-create` | 選單頁 | `/admin/employee-management` |
| `employee-birthdays` | 選單頁 | `/admin/employee-management` |
| `employee-import` | 選單頁 | `/admin/import-employees` |
| `departments` | 選單頁 | `/admin/departments` |
| `department-detail` | 明細頁 | `/admin/departments` |
| `department-work-editor` | 明細頁 | `/admin/departments` |
| `organization` | 選單頁 | `/admin/organization` |
| `organization-editor` | 明細頁 | `/admin/organization` |
| `calendar` | 選單頁 | `/organization/calendar` |
| `stores` | 選單頁 | `/admin/stores` |
| `store-map` | 明細頁 | `/admin/stores/map` |
| `store-promotions` | 明細頁 | `/admin/stores` |
| `store-personnel` | 明細頁 | `/admin/stores` |
| `store-personnel-history` | 明細頁 | `/admin/stores` |
| `store-employees` | 明細頁 | `/admin/stores` |
| `store-editor` | 明細頁 | `/admin/stores` |
| `store-relocation` | 明細頁 | `/admin/stores` |
| `store-history-editor` | 明細頁 | `/admin/stores` |
| `supervisors` | 選單頁 | `/admin/supervisors` |
| `supervisor-edit` | 明細頁 | `/admin/supervisors` |
| `store-managers` | 選單頁 | `/admin/store-managers` |
| `store-manager-edit` | 明細頁 | `/admin/store-managers` |
| `task-management` | 選單頁 | `/admin/templates` |
| `task-copy` | 明細頁 | `/admin/templates` |
| `task-assign` | 明細頁 | `/admin/templates` |
| `task-template-editor` | 明細頁 | `/admin/templates` |
| `task-management-detail` | 明細頁 | `/admin/templates` |
| `task-archive` | 選單頁 | `/admin/archived` |
| `task-archive-detail` | 明細頁 | `/admin/archived` |
| `my-tasks` | 選單頁 | `/my-tasks` |
| `task-runner` | 明細頁 | `/my-tasks` |
| `dashboard` | 選單頁 | `/dashboard` |
| `inspections` | 選單頁 | `/inspection` |
| `inspection-editor` | 明細頁 | `/inspection/new` |
| `inspection-detail` | 明細頁 | `/inspection` |
| `inspection-print` | 明細頁 | `/inspection` |
| `inspection-compare` | 選單頁 | `/inspection/compare` |
| `inspection-settings` | 選單頁 | `/admin/inspection-templates` |
| `inspection-setting-edit` | 明細頁 | `/admin/inspection-templates` |
| `improvements` | 選單頁 | `/inspection/improvements` |
| `improvement-detail` | 明細頁 | `/inspection/improvements` |
| `supervisor-log` | 選單頁 | `/supervisor-management-log` |
| `campaigns` | 選單頁 | `/admin/activity-management` |
| `campaign-edit` | 明細頁 | `/admin/activity-management` |
| `campaign-schedule` | 明細頁 | `/admin/activity-management` |
| `activity-view` | 選單頁 | `/activity-management` |
| `activity-view-detail` | 明細頁 | `/activity-management` |
| `monthly` | 選單頁 | `/monthly-status` |
| `monthly-edit` | 明細頁 | `/monthly-status` |
| `monthly-export` | 選單頁 | `/admin/export-monthly-status` |
| `monthly-release` | 選單頁 | `/monthly-release` |
| `performance` | 選單頁 | `/admin/performance` |
| `performance-edit` | 明細頁 | `/admin/performance` |
| `performance-thresholds` | 明細頁 | `/admin/performance` |
| `performance-prescription` | 明細頁 | `/admin/performance` |
| `performance-bonus` | 明細頁 | `/admin/performance` |
| `inventory` | 選單頁 | `/inventory` |
| `employee-purchases` | 選單頁 | `/admin/employee-purchases` |
| `pharmacists` | 選單頁 | `/admin/pharmacist-management` |
| `relationships` | 選單頁 | `/store/relationship-members` |
| `products-master` | 選單頁 | `/cross-dept/products-master` |
| `merchandise` | 選單頁 | `/cross-dept/merchandise` |
| `clinic-selfpay` | 選單頁 | `/store/clinic-selfpay-margin` |
| `cross-dept-maintenance` | 選單頁 | `/cross-dept/maintenance` |
| `roles` | 選單頁 | `/admin/roles` |
| `users` | 選單頁 | `/admin/users` |
| `ga-center` | 選單頁 | `/general-affairs` |
| `ga-equipment-categories` | 明細頁 | `/general-affairs/equipment/categories` |
| `ga-facility-categories` | 明細頁 | `/general-affairs/facilities/categories` |
| `ga-part-categories` | 明細頁 | `/general-affairs/parts/categories` |
| `ga-parts` | 明細頁 | `/general-affairs/parts` |
| `ga-part-create` | 明細頁 | `/general-affairs/parts/new` |
| `ga-part-compat` | 明細頁 | `/general-affairs/parts/compatibilities` |
| `ga-equipment-templates` | 明細頁 | `/general-affairs/equipment/templates` |
| `ga-facility-templates` | 明細頁 | `/general-affairs/facilities/templates` |
| `ga-equipment` | 明細頁 | `/general-affairs/equipment` |
| `ga-equipment-create` | 明細頁 | `/general-affairs/equipment/new` |
| `ga-facilities` | 明細頁 | `/general-affairs/facilities` |
| `ga-facility-create` | 明細頁 | `/general-affairs/facilities/new` |
| `ga-equipment-warranties` | 明細頁 | `/general-affairs/equipment/warranties` |
| `ga-facility-warranties` | 明細頁 | `/general-affairs/facilities/warranties` |
| `ga-equipment-history` | 明細頁 | `/general-affairs/equipment/maintenance-history` |
| `ga-facility-history` | 明細頁 | `/general-affairs/facilities/maintenance-history` |
| `ga-equipment-labels` | 明細頁 | `/general-affairs/equipment/labels` |
| `ga-inventory-locations` | 明細頁 | `/general-affairs/inventory/locations` |
| `ga-inventory` | 明細頁 | `/general-affairs/inventory` |
| `ga-inventory-transfers` | 明細頁 | `/general-affairs/inventory/transfers` |
| `ga-report-create` | 明細頁 | `/general-affairs/reports/new` |
| `ga-my-reports` | 明細頁 | `/general-affairs/reports/mine` |
| `ga-requests` | 明細頁 | `/general-affairs/requests` |
| `ga-part-fulfillments` | 明細頁 | `/general-affairs/part-fulfillments` |
| `ga-work-orders` | 明細頁 | `/general-affairs/work-orders` |
| `ga-vendors` | 明細頁 | `/general-affairs/vendors` |
| `ga-vendor-categories` | 明細頁 | `/general-affairs/vendors/categories` |
| `ga-vendor-regions` | 明細頁 | `/general-affairs/vendors/regions` |
| `ga-vendor-stats` | 明細頁 | `/general-affairs/vendors/stats` |
| `ga-purchase-analysis` | 明細頁 | `/general-affairs/vendors/purchases` |
| `ga-utility-bills` | 明細頁 | `/general-affairs/utility-bills` |
| `ga-utility-bills-report` | 明細頁 | `/general-affairs/utility-bills/report` |
| `ga-facility-labels` | 明細頁 | 無（新功能／新版專屬） |
| `ga-asset-scan` | 明細頁 | 無（新功能／新版專屬） |
| `ga-transfers` | 明細頁 | 無（新功能／新版專屬） |
| `ga-onboarding-tasks` | 明細頁 | 無（新功能／新版專屬） |
| `ga-onboarding-review` | 明細頁 | 無（新功能／新版專屬） |
| `ga-onboarding-progress` | 明細頁 | 無（新功能／新版專屬） |
| `ga-asset-import` | 明細頁 | 無（新功能／新版專屬） |
| `ga-purchase-orders` | 明細頁 | 無（新功能／新版專屬） |
| `ga-purchase-order-edit` | 明細頁 | 無（新功能／新版專屬） |
| `ga-purchase-approvals` | 明細頁 | 無（新功能／新版專屬） |
| `ga-purchase-invoices` | 明細頁 | 無（新功能／新版專屬） |
| `ga-purchase-invoice-edit` | 明細頁 | 無（新功能／新版專屬） |
| `ga-payment-requests` | 明細頁 | 無（新功能／新版專屬） |
| `ga-payment-request-edit` | 明細頁 | 無（新功能／新版專屬） |
| `ga-payment-request-print` | 明細頁 | 無（新功能／新版專屬） |
| `page-fallbacks` | 明細頁 | 無（新功能／新版專屬） |

沒有舊版對應的頁面共 16 個（不顯示「回舊版」、不能切回舊版）：`ga-facility-labels`（舊版只有設備標籤）、`ga-asset-scan`（舊版掃描網址含一次性代碼）、`ga-transfers`、`ga-onboarding-tasks`、`ga-onboarding-review`、`ga-onboarding-progress`、`ga-asset-import`、`ga-purchase-orders`、`ga-purchase-order-edit`、`ga-purchase-approvals`、`ga-purchase-invoices`、`ga-purchase-invoice-edit`、`ga-payment-requests`、`ga-payment-request-edit`、`ga-payment-request-print`（以上為新功能，舊版沒有），以及 `page-fallbacks`（新版專屬的管理工具）。

## 2. C2「回舊版」連結

- 位置：新版頁籤列右側、「頁籤管理」按鈕旁，單一元件（`App.vue`，`data-testid="back-to-legacy"`），只對目前使用中的頁籤顯示；所有頁面一致，不需要逐頁修改。小字、次要色、有外框，不搶頁籤的位置。
- 行為：另開新分頁（`target="_blank" rel="noopener"`）。理由：舊版選單中原本就連到舊頁面的項目與「返回原測試站」都是另開分頁，一致；而且不會取代目前的新版畫面，頁籤內尚未儲存的內容不會因為點到而遺失。缺點是多一個瀏覽器分頁（allowlist `m9-c2-link-new-tab` 待使用者確認）。
- 手機（390）：連結在頁籤列內不換行、不超出視窗，點擊區高度 44px（e2e 驗證沒有水平溢出）。
- 舊版網址：整合模式（3002）用同網域路徑；獨立預覽模式（5173）指向 `http://localhost:3002`，與選單中既有舊頁連結相同（`vue-workspace/src/legacy-link.ts`）。

## 3. N2 逐頁備援開關

### 資料
- DEV：`supabase/workspace-dev/20261123150000_m9_page_fallbacks.sql`（還原：`.rollback.sql`），套用：`node scripts/apply-workspace-m9-dev.cjs`（`--rollback` 還原）。正式區草稿與說明：`docs/vue-workspace/parity-plan/m9-sql/`。
- `workspace_page_fallbacks(kind pk, use_legacy, reason, updated_by, updated_at)`：目前狀態，每個頁面種類一列。
- `workspace_page_fallback_events`：只新增的稽核紀錄（誰、何時、切到哪、原因）。
- `workspace_set_page_fallback(kind, use_legacy, reason, actor)`：同一交易寫入目前狀態與稽核紀錄。
- 兩張表啟用 RLS、沒有政策，只由 workspace API 以 service_role 存取。

### API（`app/api/workspace/page-fallbacks/route.ts`，邏輯在 `lib/workspace/page-fallbacks.ts`）
- `GET`：清單（可切換的 1 個頁面、舊版路由、目前狀態、最後修改者／時間／原因）。
- `PUT { kind, useLegacy, reason }`：切換；切回舊版必填原因（最多 200 字）；只接受「選單頁面且有舊版對應」的 kind；檢查 Origin。
- 權限：**只有系統管理員**（`ctx.isAdmin`：`profiles.role = 'admin'` 或管理員類角色，應用層判斷，與 AI 用量設定相同；不新增權限碼），其他人一律 403。
- `GET /api/workspace/session` 新增 `pageFallbacks`（切回舊版的頁面）與 `capabilities.pageFallbackAdmin`；導覽中被切回舊版的項目拿掉 `kind`、標 `fallback: true`（名稱、位置、`href` 不變），所以前端自然把它當作舊版連結開啟。

### 生效與快取（明確）
- 伺服端：session 每次請求直接讀資料庫，`Cache-Control: no-store`，**沒有任何伺服端快取**；儲存成功後下一個請求就看到。
- 前端：每 60 秒、視窗取得焦點、開啟選單時重新讀取 session。最慢 60 秒內生效，不需重新部署。
- 備援表不存在或讀取失敗：視為沒有任何頁面切回舊版，不讓工作台壞掉。

### 舊版選單也讀同一份備援集合（上線 WP5）
- 舊版 Navbar 的連結由 `app/layout.tsx`（伺服端）計算：閘門開啟、使用者在開放對象內、且該頁不在備援集合時，才把舊版路徑換成 `/workspace/index.html#/open/<kind>`；其餘一律維持舊版連結（閘門關閉時選單輸出與改版前完全相同）。
- 備援集合與「是否管理員」在伺服端各有 30 秒記憶體快取（`lib/workspace/legacy-menu-server.ts`），加上最長 30 秒，舊版選單最慢約 30 秒內反映切換，仍在上述 60 秒承諾內。讀取失敗一律視為「不換連結」。
- 備援不是安全邊界：真正的把關是 API（`assertWorkspace` 與 `context()` 的開放對象檢查）。

### 前端行為
- 選單：被切回舊版的項目改為舊版連結（另開分頁，標示「暫時使用舊版」）。
- 工作台內任何其他入口要開這個頁面（首頁卡片、深連結等）：統一由 `useWorkspace().open()` 攔截，不開新版頁籤，改顯示一則附舊版連結的通知。
- 已經開著的新版頁籤：顯示「已暫時切回舊版」通知與連結並隱藏內容；若該頁籤有尚未儲存的內容則保留內容，不丟資料。
- 管理介面：`角色權限管理` 頁右上角「頁面回舊版設定」按鈕（只有系統管理員看得到）開啟 `page-fallbacks` 頁：每頁一列，狀態、舊版路由、最後修改者／時間／原因、原因欄位與切換按鈕。它是新版專屬頁面，不在選單、不能被切回舊版，選單項目數不變，因此 T03 導覽基準不需更新。

### 範圍限制（allowlist `m9-n2-switch-scope-menu-pages` 待使用者確認）
只能切選單頁面（共 40 個，都有舊版對應）；明細頁由清單頁帶出、不單獨切；總務服務中心只能整個切（`ga-center`），不能切側欄內單一子頁。這是備援開關，不是安全開關：新版 API 與頁面權限不受影響，只是導覽改道。

## 4. 測試

| 層 | 檔案 | 內容 |
|---|---|---|
| 單元 | `tests/unit/M9-F01S/legacy-routes.test.ts` | 對照表完整（每個 kind 有舊版或在明確的無舊版清單）、舊版路由存在、導覽與總務側欄一致、備援導覽行為、前端純函式 |
| 單元 | `tests/unit/M9-F01S/page-fallbacks-api.test.ts` | 權限、驗證、讀不到即視為沒有、SQL 檔契約 |
| 整合 | `tests/integration/M9-F01S.page-fallbacks.spec.ts` | 管理員清單與切換、非管理員 403、未登入 401、驗證、session 同一請求後反映、稽核、冪等、rollback 後 session 不壞、再套用恢復 |
| e2e | `tests/e2e/M9-F01S.fallback-journey.e2e.spec.ts` | 多角色劇本（管理員、店長），桌機 1440 與手機 390 |

DEV 演練紀錄：`docs/vue-workspace/parity-plan/m9-fallback-drill.md`（由 `node scripts/m9-write-drill-log.cjs` 依 e2e 結果產生）。
