# 測試架構

# 復刻計畫測試架構

## 0. 原則
- **只碰 DEV**：所有 runner 第一步都執行環境守衛，失敗就立即結束（exit 2）。
- **同一份 fixture、同一個 server 程序比對新舊版**：使用 3002 integrated 模式，cookie 共用。
- **每完成一頁**都跑 `npm run test:page -- <workId>`，涵蓋冒煙、單元、整合、e2e、parity 五段，全部綠燈才算完成。
- **分工**：開發與測試資料建立由 Sonnet 子代理執行；本文件與差異白名單的核可權在使用者與 Opus 規劃者。

## 1. 工具（建議方案，待決策 D01、D02）
| 層 | 工具 | 說明 |
|---|---|---|
| 守衛 | `tests/support/env-guard.cjs`、`env_guard.py` | 只解析 `.env.development.local`，不讀 `.env.local`。檢查以下各項：<br>• URL ref 等於 EXPECTED 且等於 DEV_REF<br>• ref 不在 Production 清單<br>• `ALLOW_DEV_DATABASE_OPERATIONS=true`<br>• 兩把 JWT 的 role 與 ref claim 正確<br>• `/api/workspace/session` 不是 503<br>DEV 與 Prod ref 集中在 `tests/support/env-refs.cjs`。 |
| 單元 | Vitest、@vue/test-utils、happy-dom | `envDir` 指向空目錄，禁止載入 env。新舊純函式用同一張輸入表比對，例如 `lib/performance/bonus-calc.ts` 對新版、`inspection-scoring`、`campaign-scheduling`、`task-state`。既有 16 支 transpileModule `.cjs` 逐步遷移。 |
| 冒煙 | @playwright/test，project `smoke` | 每頁以授權角色登入後檢查：導覽進入、標題可見、主要 API 200、沒有 pageerror、390px 寬度下沒有水平溢出、對應舊路由 200。檢查清單由 `tests/fixtures/route-map.json` 產生。 |
| 整合 | Playwright APIRequestContext，加上 `scripts/sql/*.sql`（BEGIN…ROLLBACK，透過 `supabase db query --linked`） | 依角色驗證 200、401、403，以及 Origin 拒絕、400 驗證、409 版本衝突、重送冪等。寫入後用 service role 回讀 DB。 |
| E2E | @playwright/test，chromium，`desktop-1440` 與 `mobile-390` 兩個 project | 每頁至少一條完整路徑：入口、讀取、操作、寫入或下載、回讀、重新開啟。保留 trace、截圖與 video-on-failure。 |
| 對等 | `tests/parity/`、`tests/support/normalize.ts` | 見第 5 節。 |

## 2. 目錄
```
tests/
  support/        env-guard.cjs env_guard.py env-refs.cjs normalize.ts auth.ts(storageState) fixtures.ts sweeper.cjs registry.cjs
  fixtures/       role-matrix.json route-map.json  <workId>/seed.cjs
  unit/           <workId>/*.test.ts
  smoke/          <workId>.smoke.spec.ts
  integration/    <workId>.api.spec.ts   (SQL 交易測試仍放 scripts/sql/test-workspace-*.sql，由 runner 呼叫)
  e2e/            <workId>.e2e.spec.ts
  parity/         map/<workId>.json  allowlist.json  <workId>.parity.spec.ts
  reports/<runId>/ summary.json junit.xml playwright-report/ parity-report.json created.json screenshots/
playwright.config.ts   vitest.config.ts   tests/run-all.cjs
```

## 3. 執行指令
- `npm run test:guard`：只跑守衛。
- `npm run test:unit`（Vitest）、`test:smoke`、`test:integration`、`test:e2e`、`test:parity`。
- `npm run test:page -- W06`：依序執行以下步驟。
  1. 守衛
  2. 確認 3002 伺服器
  3. sweeper(pre)
  4. seed
  5. unit
  6. smoke
  7. integration（含 SQL）
  8. e2e
  9. parity
  10. sweeper(post)
  11. 彙總
- `npm run test:all`：全頁回歸，在每個里程碑結束時執行。
- 前置固定檢查：`node --check`、`vue-tsc --noEmit`、`npx tsc --noEmit`、`npm --prefix vue-workspace run build` 並同步到 `public/workspace`。
- 伺服器啟動方式見 D10。建議由 runner 自動以 `workspace-backend.cjs --integrated` 啟動、測完關閉；若偵測到已在執行，先做 preflight 再沿用。

## 4. 資料隔離與清理
- **runId**：每次執行產生，格式 `T<yyyymmdd>-<4碼>`。所有建立的資料都要帶標記：
  - 門市碼 `ZT…`
  - 員編 `ZT<runId>…`
  - 名稱前綴「[自動測試]」
  - 月份 `2099-01..12`
  - 績效年度 `2038`
- **長駐基準資料**（idempotent upsert，不刪除）：
  - 測試門市 VW001、VW002、ZT01–ZT05
  - 角色矩陣帳號與 vue_workspace_* 角色
- **單次 fixture**：setup 建立，並登錄到 `reports/<runId>/created.json`；teardown 以 try/finally 刪除。
- **SQL 交易測試**：一律 ROLLBACK，並禁止 `ORDER BY id LIMIT 1` 取用既有資料，actor 與 store 一律由 seed 產生。
- **sweeper**：run 開始與結束各執行一次，依前綴、runId、保留月份清掉孤兒資料；保留月份不是空的就中止，沿用 monthly-fixtures check 模式。
- **並行**：DEV 是共享環境，涉及調店、升遷、並行寫入的測試一律 `workers=1` 並序列化。
- **憑證**：由 seed 產生隨機密碼，只寫入 gitignored 的 `.tmp-check/test-credentials.json`（或依 D04 改用 Credential Manager）。日誌一律遮罩 cookie、JWT 與密碼，登入狀態用 storageState 快取。

## 5. 角色帳號（tests/fixtures/role-matrix.json）
| key | 角色 | 範圍 |
|---|---|---|
| admin | 系統管理員 | 全部 |
| navigation | 全站導覽 | 唯讀全部 |
| ops_manager | 營業部主管或經理 | — |
| ops_assistant | 營業助理 | — |
| supervisor | 督導 | 多店（ZT01–03） |
| store_manager | 店長 | 單店 ZT01 |
| acting_manager | 代理店長 | — |
| pharmacist | 藥師 | — |
| inventory_team | 盤點組 | — |
| ga_staff | 總務 | — |
| ga_vendor_manager | 總務廠商管理 | — |
| employee | 一般員工 | — |
| denied | 無權限 | — |

- 各模組依需要補 `<module>_view`、`<module>_edit`、`<module>_delete` 細分帳號。
- 每個角色都要列出「預期可見頁面」與「預期 API 狀態」，同時作為 smoke 與權限測試的 oracle。
- 所有權限一律走 roles、role_permissions、user_roles，不使用 profiles.role 捷徑（舊版依 profiles.role 判斷的頁面除外，這類帳號兩者都要設）。

## 6. 對等驗證機制
1. **API 讀取對等**：`map/<workId>.json` 記錄以下內容：
   - 舊 API 與 workspace API
   - query 參數
   - 正規化規則：欄位改名、排序鍵、忽略欄位（updated_at、workspace_version）、數值精度、日期格式

   每個角色比對三件事：HTTP 狀態類別、正規化後的資料集合（deep equal）、筆數。
2. **寫入對等**：準備相同的 fixture A 和 B，舊版寫 A（舊 API，或用 UI 觸發 server action），新版寫 B。之後用 service role 回讀，比對業務欄位與副作用表（employee_movement_history、monthly_staff_status、improvements、ga_*、maintenance_* 等）。
3. **計算對等**：在單元層把同一張輸入表餵給新舊兩套函式，含邊界值。
4. **UI 與匯出對等**：舊頁和新頁套用相同篩選後，擷取關鍵欄位或合計值做比對。Excel 以 xlsx 解析後逐欄比對；PDF 與列印用截圖做像素容差比對，並人工抽檢。
5. **導覽可見性對等**：依角色比對舊 Navbar 入口集合與 `/api/workspace/session` navigation 集合。
6. **白名單**：`allowlist.json` 每筆差異都要寫明原因、核可人與日期。未列入白名單的差異一律判 FAIL；舊版 bug 是否修正依 D07 決定。

輸出 `parity-report.json`，內容包含已比對端點數、差異、白名單引用與覆蓋率。

## 7. 報表
- 每次執行輸出到 `tests/reports/<runId>/`：
  - `summary.json`：每層 pass、fail、skip 數，以及耗時
  - `junit.xml`
  - Playwright HTML report
  - `parity-report.json`
  - 截圖
- 每完成一個工作項，就把 summary 路徑與結論寫入 `docs/vue-workspace/verification.md` 與 `docs/CURRENT-DEV-STATUS.md`。
- 若要接 CI，只放不碰 DB 的項目：Vitest、tsc、build。

## 8. 完成定義
見 definitionOfDone，每個工作項都必須全部符合。

---

## 附：測試基礎調查

### 測試資料庫與守衛

【連線來源（只列變數名稱）】
- .env.development.local：NEXT_PUBLIC_SUPABASE_URL、NEXT_PUBLIC_SUPABASE_ANON_KEY、SUPABASE_SERVICE_ROLE_KEY、EXPECTED_SUPABASE_PROJECT_REF、ALLOW_DEV_DATABASE_OPERATIONS、NEXT_PUBLIC_SITE_URL、ALLOW_SUPABASE_CLI_REMOTE_OPERATIONS。只比對 project ref 分類、不輸出值，結果是它指向 DEV（mjpd...mtqr）。這就是測試專用的 DB 連線。
- .env.local：NEXT_PUBLIC_SUPABASE_URL、NEXT_PUBLIC_SUPABASE_ANON_KEY、SUPABASE_SERVICE_ROLE_KEY、VITE_GOOGLE_MAPS_API_KEY。分類結果指向 Production 候選 ref（odvksgucvfoaqrumpran）。
- .env.production.local：變數組合與 development.local 相同，但分類結果指向 DEV，命名和內容相反，用意 uncertain。
- 三個檔都被 .gitignore 的 `.env*.local` 排除。
- Next 的 loadEnvConfig(dev=true) 先讀 .env.development.local、後讀 .env.local，同名變數以前者為準，所以 `npm run dev` 和 workspace 腳本都會連到 DEV。

【守衛機制】
1. scripts/verify-dev-supabase-environment.js（不連線）檢查以下條件，全部通過才放行：
   - URL 必須是 *.supabase.co，且 ref 等於 EXPECTED_SUPABASE_PROJECT_REF。
   - ref 不能在 Production 候選清單內（目前只有 1 個）。
   - ALLOW_DEV_DATABASE_OPERATIONS 必須嚴格等於 'true'。
   - NODE_ENV 不能是 production。
   - anon / service_role 兩把 JWT 的 role claim 要正確。
   - 輸出只顯示遮罩後的 ref。
2. lib/workspace/server.ts 的 assertWorkspace()：
   - DEV_REF 寫死為 mjpdfpxqttbhzeimmtqr。
   - 要求 WORKSPACE_DEV_ENABLED==='true'。
   - 要求 URL ref、EXPECTED_SUPABASE_PROJECT_REF 都等於 DEV_REF。
   - 兩把 JWT 的 claims.ref 和 role 都要相符，不符回 503。
   - sessionClient()、adminClient() 每次呼叫都會先執行它，所以 app/api/workspace/** 全部受保護。
   - checkOrigin() 要求 Origin 等於 WORKSPACE_ORIGIN，預設 http://localhost:5173。
3. scripts/workspace-backend.cjs：
   - 檢查 URL ref 和 EXPECTED 都等於 DEV ref，否則拒絕啟動。
   - 子程序注入 WORKSPACE_DEV_ENABLED=true。
   - `--integrated` 模式跑在 3002 埠，WORKSPACE_ORIGIN=http://localhost:3002，WORKSPACE_USE_EXISTING_SESSION=true（與舊站共用 Supabase cookie）。
   - 非 integrated 模式跑在 3100 埠，搭配 Vite 5173 proxy，使用獨立 HttpOnly cookie `fk-vue-dev-auth`。
   - `--build` 輸出到 .next-workspace-build。
4. scripts/start-workspace-preview.ps1：先跑 verify-dev-supabase-environment.js，再 build Vue、複製到 public/workspace，最後以 `--integrated` 啟動。
5. 各腳本內嵌守衛：
   - seed-workspace-dev.cjs 檢查 hostname、EXPECTED、ALLOW 旗標。
   - *-dev.cjs SQL 測試另外比對 supabase/.temp/project-ref，並先串跑 verify-dev-supabase-environment.js 和 verify-dev-supabase-cli-environment.js，再執行 `supabase db query --linked --file scripts/sql/*.sql`（BEGIN…ROLLBACK）。
6. .github/copilot-instructions.md 規範：
   - 禁止連線或操作 Production。
   - guard 必須 passed。
   - 密碼只能在 Terminal 隱藏輸入。
   - 不得輸出 JWT、cookie、key。
   - DEV seed 不得放進 supabase/migrations。
   - 重型 RBAC 寫入（test-rbac-navbar-permissions-dev.js）需要使用者批准。

【哪些腳本會檢查】
- workspace API：全部（assertWorkspace）。
- 有 service role 的 *.cjs：多數用 hostname 加 ALLOW 旗標檢查；其中 18 支沒有檢查 EXPECTED_SUPABASE_PROJECT_REF，但 hostname 本身是 allowlist，風險低。
- Python Playwright 測試：完全沒有環境守衛，直接打 localhost:3002。
- 舊版 app/api/**：沒有 DEV 斷言。

### 守衛缺口

- 根目錄 .env.local 指向 Production 候選 ref。只要工具沒照 Next 的優先順序讀檔（dotenv 預設讀法、Vite loadEnv 在 mode=test 也會讀 .env.local、手動 source、某些 IDE 測試外掛），就會直接連到 Production。這是新測試框架最大的風險，runner 必須明確只載入 .env.development.local，並在連線前跑守衛。
- .env.production.local 實際指向 DEV，命名和內容相反（uncertain：可能是刻意設計，讓本機 next start 也走 DEV）。容易誤導，也讓『看 NODE_ENV 判斷環境』這個做法失效。
- 舊版 Next API（app/api/** 非 workspace）沒有任何 DEV 斷言。雙版本對等測試打舊 API 時，只能靠『同一個 server 程序』間接保證。測試 runner 應先呼叫 /api/workspace/session（同一程序會跑 assertWorkspace），確認回 200 或 401 而不是 503，才能打舊 API。
- Python Playwright 測試（約 80 支）本身沒有環境 preflight，只假設 3002 埠上就是 DEV 伺服器。如果 3002 埠被用其他環境變數啟動的舊站占用（例如 next start 在缺少 production.local 的情況下），測試會打到錯的環境。
- DEV/Prod ref 寫死在很多地方：lib/workspace/server.ts、workspace-backend.cjs、seed-workspace-dev.cjs，以及約 38 支 scripts/*.cjs 以 hostname 字串比對。verify-dev-supabase-environment.js 只列 1 個 Production 候選，也不檢查 JWT 的 ref claim（assertWorkspace 有檢查），兩者不一致。
- 測試帳號密碼以明碼存在 .tmp-check/workspace-accounts.json、.tmp-check/測試登入資料.txt、.tmp-check/新版全站測試登入資料.txt（都被 gitignore，但仍是明碼）。這和 copilot-instructions『密碼只能 Terminal 隱藏輸入』不一致。administrator 帳號改用環境變數 WORKSPACE_TEST_PASSWORD。
- 測試資料清理不一致：test-workspace-transfers-dev.cjs、test-workspace-store-managers-transaction.cjs 用 try/finally 刪除；monthly 用保留月份 2099-11 搭配 check/clean 子命令；performance 用 2038 年和 VW001 寫入閾值，沒看到還原步驟（uncertain）；seed 以 upsert 建立的長駐資料沒有 sweeper。沒有統一的 run-id 標記或清理登錄。
- SQL 交易測試是資料依賴的，例如 scripts/sql/test-workspace-employee-create.sql 用 `SELECT id FROM profiles ORDER BY id LIMIT 1` 和 `stores ORDER BY id LIMIT 1` 取 actor/store；test-workspace-transfers-dev.cjs 取『前兩間 active 門市』。DEV 資料一變，結果就可能不同。
- DEV 是共享的遠端 Supabase，沒有 per-run schema 或 branch 隔離。手動操作和測試同時寫入時可能互相干擾，transfer/promotion concurrency 類測試尤其明顯。
- 沒有統一 runner、exit code 彙總、JUnit 報表或測試清單登錄。.tmp-check 已累積 445 個檔案，結果、fixture、截圖和憑證混放。
- integration 測試使用的 `navigation` 帳號 key 存在 workspace-accounts.json，但 seed-workspace-dev.cjs 的 definitions 只建立 editor/viewer/denied。建立 navigation 帳號的腳本沒找到（uncertain），角色矩陣無法一鍵重建。

### 現有測試工具

【規模】
- 舊版：app/**/page.tsx 共 100 頁，非 workspace 的 app/api route.ts 共 213 支。
- 新版：app/api/workspace route.ts 共 54 支，vue-workspace/src/pages 有 57 個檔案。
- 測試腳本：scripts/test-workspace-* 共 132 支。

【工具可用性】
- 根目錄和 vue-workspace 的 package.json 都沒有 vitest、jest、@playwright/test。
- node_modules/.bin 和 vue-workspace/node_modules/.bin 也找不到這些工具。
- Python 的 playwright 可以 import；pytest 未安裝。
- 根目錄 npm scripts 只有 test:rbac-* 等少數 node 腳本，沒有 test 總入口。

【共用模式（抽樣：integration.py、performance-parity.py、permissions-parity.py、employee-create-api.py、tasks.py、inventory.py、transfers-dev.cjs、promotions-transaction.cjs、employee-create-dev.cjs、monthly-fixtures.cjs、store-managers-transaction.cjs、movement-locations.cjs、promotion-import.cjs、seed-workspace-dev.cjs）】
1. 登入：
   - 用 Playwright sync API 的 request context 呼叫 POST /api/workspace/login，帶 {email,password}，headers 帶 Origin=http://localhost:3002。
   - integrated 模式下 cookie 和舊站共用，所以同一個 context 也能打舊版 API（例如 /api/user/profile、/api/roles/{id}/permissions）。
   - 舊式 RBAC 腳本（test-rbac-user-management-dev.js）用 readline 隱藏輸入密碼，自組 `base64-` 加 base64url 的 @supabase/ssr cookie。
2. 帳號來源：
   - .tmp-check/workspace-accounts.json 的 accounts[key]，key 有 editor、viewer、denied、navigation。
   - administrator 帳號用環境變數 WORKSPACE_TEST_PASSWORD。
   - 各 seed-workspace-*-dev.cjs 用 service role 建立 vue-workspace-*@example.test 帳號、vue_workspace_* 角色和 role_permissions/user_roles；密碼隨機產生後只存本機，不會重設。
3. Fixture：
   - 由 *-dev.cjs 用 service role 建立帶前綴或標記的資料，例如 VW001/VW002 門市、VW-INS-*、[Vue 測試] 活動、VTR+隨機前綴、2099-11 月份、2038 年。
   - fixture 寫入 .tmp-check/*-fixture.json，再用 spawnSync 呼叫對應的 .py，最後在 finally 刪除。
   - SQL 層用 scripts/sql/test-workspace-*.sql（11 支），以 BEGIN…ROLLBACK 加 RAISE EXCEPTION 斷言，透過 `supabase db query --linked` 執行。
4. 純邏輯單元測試：
   - 有 16 支 *.cjs，用 `require.extensions['.ts']` 加 typescript.transpileModule 直接載入 lib/workspace/*.ts，再用 node:assert/strict 斷言。
   - 例如 movement-locations、promotion-import、transfer-months、task-schedule。
5. UI：
   - chromium headless，viewport 1440/1500/1600 並補一次 390×844 手機版。
   - 監聽 page.on('pageerror') 收集錯誤。
   - 檢查 `document.documentElement.scrollWidth<=innerWidth`。
   - 用 page.route 攔截寫入做 UI-only 測試。
   - 截圖存成 .tmp-check/*.png。
6. 輸出：
   - stdout 印 'PASS ...'，用 bare assert 判定失敗。
   - 部分腳本把結果寫入 .tmp-check/*-results.json。
   - 沒有統一彙總。
7. 啟動伺服器：
   - 先跑 powershell scripts/start-workspace-preview.ps1，或 `npm --prefix vue-workspace run build` 加 `node scripts/workspace-backend.cjs --integrated`。
   - 入口是 http://localhost:3002/workspace/index.html。
   - 測試本身不負責啟停伺服器。
8. 已有的雙版本對等先例：
   - test-workspace-permissions-parity.py 直接比對舊 API /api/roles/{id}/permissions 和新 API /api/workspace/roles/{id}/permissions 的 JSON 是否相等。
   - test-workspace-monthly-activity.py 驗證時和『舊 reader 比對一致』。
   - test-workspace-movement-history-dev.cjs 把 Excel 解析結果和 API 逐欄比較。

### 建議工具

| 層 | 工具 | 理由 | 替代 |
|---|---|---|---|
| 環境守衛（所有層共用） | tests/support/env-guard.cjs（共用模組）加 Python 版 tests/support/env_guard.py | 只用 @next/env 的 loadEnvConfig(dev=true) 載入 .env.development.local，或明確 parse 該檔。內容做三件事：沿用 verify-dev-supabase-environment.js 的檢查，加上 JWT claims.ref 檢查；DEV/Prod ref 集中成一個常數檔；伺服器 preflight 先打 /api/workspace/session，確認不是 503 才開始測試。每個 runner 的第一行都要呼叫它。 | 直接在每個測試前 spawn verify-dev-supabase-environment.js（現行做法，但容易漏掉） |
| 單元測試 | Vitest（新增到 vue-workspace devDependencies，同時供根目錄 lib/workspace 使用）加 @vue/test-utils 和 happy-dom | 現在用 transpileModule hack 跑 16 支 .cjs 單元測試，不能 watch，也沒有報表。Vitest 能原生跑 TS、Vue SFC，也能跑根目錄 lib/workspace 和舊版 lib/**（例如 lib/performance/bonus-calc.ts）。重點是用同一組輸入同時餵新舊兩套純函式，當作對等的最小單位。設定上要寫 `envDir` 指向不存在的目錄，或關閉 env 載入，避免 Vite 在 mode=test 讀進 .env.local（Production）。 | 維持 node:test 加 tsx（不用額外裝 Vue 測試工具），或沿用現行 .cjs 形式 |
| 冒煙測試 | @playwright/test（Node）的 project 'smoke'，或保留 Python Playwright 寫成一支 smoke_runner.py | 每頁 1 到 3 個檢查：以授權角色登入、從導覽進入新頁、標題可見、主要清單 API 回 200、沒有 pageerror、手機無水平溢出；同時打開對應的舊版路由確認 200。由 route-inventory.json 的 legacyRoute→apis 自動產生檢查清單，跑完約數分鐘，適合每完成一頁就跑。 | 純 HTTP 版 smoke（只打 API 不開瀏覽器），速度更快 |
| 整合測試（API＋DB） | @playwright/test 的 APIRequestContext（或 Python requests context），加上既有 scripts/sql/*.sql BEGIN/ROLLBACK 交易測試 | 以每個角色分別打 workspace API，驗證權限矩陣（200/403/401）、Origin 檢查、400 驗證、409 版本衝突、重送冪等，並用 service role 回讀 DB 確認。RPC 原子性繼續用 SQL 交易測試，執行時 ROLLBACK，不留資料。 | pytest 加 playwright.sync_api（需安裝 pytest），可沿用現有 Python 寫法 |
| E2E | @playwright/test（chromium，桌機 1440 和手機 390 兩個 project）；若使用者偏好 Python，則用 pytest-playwright | 完整走一次『入口 → 讀取 → 操作 → 寫入或下載 → 回讀 → 重開』，也就是 feature-parity-review.md 定義的驗收單位。內建 trace、截圖、retry 和 HTML/JUnit 報表，可以用 fixtures 管理登入 storageState 和測試資料生命週期。Python Playwright 雖然已可用，但缺少 runner、報表和平行化。 | 繼續用 Python sync Playwright 加 pytest-playwright 外掛（和既有 80 支腳本同語言，遷移成本低） |
| 雙版本對等 | tests/parity/（Playwright test）加上正規化比對器 tests/support/normalize.ts | 同一份 fixture、同一個角色、同一個 server 程序（3002 integrated，cookie 共用）分別打舊 API 和 workspace API，正規化後做深度比對（例如排序鍵、忽略 updated_at 等）。寫入類操作改成兩邊分別寫入專屬 fixture 後回讀 DB 比對；UI 層則抽出兩邊表格的數值或匯出 Excel 再比對。 | 只做 UI 擷取比對（較脆弱） |
| 一鍵執行與報表 | 根目錄 package.json scripts：test:unit、test:smoke、test:integration、test:e2e、test:parity、test:page -- <pageId>，以及一個 tests/run-all.cjs | 依序執行：守衛 → 確認伺服器 → seed → 四層測試 → cleanup sweeper → 彙總成 tests/reports/<runId>/summary.json 和 JUnit。結果不再散落在 .tmp-check。 | PowerShell 腳本串接 |

### 測試資料策略

1. 隔離與標記：
   - 每次執行產生 runId（例如 T20261102-xxxx）。
   - 所有測試建立的資料都要帶可辨識標記：門市碼前綴 ZT/VW、員編前綴 ZT+runId、名稱前綴「[自動測試]」。
   - 年月固定使用保留區間，例如 2099-xx 或 2038，避免撞到真實 DEV 資料。
   - 不再以 `ORDER BY id LIMIT 1` 取用既有資料；actor 和 store 一律由 seed 產生後寫入 fixture。
2. 分層資料：
   - (a) 長駐基準資料：測試門市 VW001/VW002/ZT 系列、角色帳號矩陣、權限 role。以 idempotent seed（upsert by code）建立，跨 run 共用、不刪除。
   - (b) 單次 fixture：每個測試的 setup 建立、teardown 用 try/finally 刪除，並登錄到 tests/reports/<runId>/created.json。
   - (c) SQL 層：一律 BEGIN…ROLLBACK。
3. 清理：
   - 新增 sweeper，依標記前綴和 runId 清掉孤兒資料，在 run 開始和結束時各跑一次。
   - 長駐資料只做檢查，不刪除。
   - 開始前檢查保留月份是否為空，沿用 monthly-fixtures 的 check 模式。
4. 角色帳號矩陣：
   - 每個角色對應一個 DEV 帳號，權限透過 roles/role_permissions/user_roles 正式指派，不能走 profiles.role 捷徑。
   - 至少需要：系統管理員、全站導覽、營業部主管或經理、督導（多店）、店長（單店 scope）、代理店長、一般員工、藥師、盤點組、總務、無權限。
   - 每個模組另外補該模組的 view/edit/delete 細分角色。
   - 帳號清單和預期可見頁面寫成 tests/fixtures/role-matrix.json，作為 smoke 和權限測試的資料來源。
5. 憑證：
   - 統一由 seed 產生隨機密碼，只寫入 gitignored 的單一檔案（建議 .tmp-check/test-credentials.json，或改用 Windows Credential Manager）。
   - 測試輸出不得印出密碼或 cookie。
   - 用 Playwright storageState 快取登入狀態，減少重複登入。
6. 舊版和新版共用同一份 fixture，雙版本比對才有意義。

### 雙版本對等機制

【前提】
- 用 integrated 模式（3002 埠，WORKSPACE_USE_EXISTING_SESSION=true）。同一個 Next 程序同時提供舊版 app/api/** 和 /api/workspace/**，同一個登入 cookie 兩邊都能用（test-workspace-integration.py 已驗證 /api/user/profile 可用）。
- 先打 /api/workspace/session，確認 assertWorkspace 通過，間接保證舊 API 也在 DEV。

【機制一：API 讀取對等（主力）】
- 以 docs/vue-workspace/route-inventory.json 的 legacyRoute→apis 為起點，人工補上每頁的對照表 tests/parity/map/<page>.json。內容包含：
  - 舊 API（方法、路徑、query）
  - 新 workspace API
  - 正規化規則：欄位重新命名、排序鍵、忽略欄位（updated_at、workspace_version）、數值精度、日期格式
- 對角色矩陣的每個角色，在同一組 fixture 下呼叫兩邊。比對三件事：
  - HTTP 狀態類別：200/403/401 必須一致，或差異已列入白名單並說明。
  - 正規化後的資料集合：deep equal。
  - 筆數。
- 先例是 test-workspace-permissions-parity.py 的 `legacy==native`。
- 注意：舊版很多頁面直接在 client 端用 Supabase 查詢或 server action（app/store/actions.ts、app/auth/actions.ts），沒有 REST API。這類頁面改走機制三，或對 DB 直接查詢做比對（uncertain：每頁需逐一確認）。

【機制二：寫入對等】
- 建兩份相同的 fixture A 和 B，舊版和新版各寫一份。可透過舊 API，或用 Playwright 操作舊頁面；server action 只能從 UI 觸發。
- 寫完後用 service role 回讀 DB，正規化後比對兩份的業務欄位，並比對附帶的副作用，例如 employee_movement_history、monthly_staff_status、audit/log。
- 計算類（獎金、門檻、季回補）在單元層同時呼叫舊 lib（例如 lib/performance/bonus-calc.ts）和新 lib/workspace，以 property 或表格驅動輸入比對輸出。

【機制三：UI 擷取或匯出對等】
- 同一角色分別開啟舊頁和新頁，套用相同篩選條件，擷取表格的關鍵欄位或合計值做比對。
- 有下載功能的，比對兩邊的 Excel/CSV。可沿用 verification.md 記載的標準庫 ZIP/XML 解析法，或使用根目錄已有的 xlsx 套件。

【機制四：權限可見性對等】
- 舊版 Navbar 依權限顯示的入口，和 /api/workspace/session navigation 的 href 集合，依角色逐一比對。

【產出】
- 每頁產生 parity-report.json，內容包含已比對端點、差異、白名單理由。
- 任何未列白名單的差異都視為 FAIL。
- 差異白名單需要使用者核可，例如舊版已知 bug 不要照抄。

### 角色帳號

- vue-workspace-editor@example.test（key=editor，角色 vue_workspace_editor）：權限 inspection.view_all、inspection.manager_tab、activity.campaign.view_all、activity.campaign.edit。來源 scripts/seed-workspace-dev.cjs。
- vue-workspace-viewer@example.test（key=viewer）：權限 inspection.view_store、activity.campaign.view，並以 store_managers 綁定 VW001 店長 scope。來源 seed-workspace-dev.cjs。
- vue-workspace-denied@example.test（key=denied）：沒有任何權限。來源 seed-workspace-dev.cjs。
- key=navigation（全站導覽或管理用帳號）：存在 .tmp-check/workspace-accounts.json，大部分 Python 測試都以它作為主要操作帳號。建立它的 seed 腳本沒找到，uncertain。
- administrator（以使用者名稱登入，透過 lib/auth/dev-login 的 resolveLoginEmail）：密碼由環境變數 WORKSPACE_TEST_PASSWORD 提供，用於 permissions-parity 和 inventory 等測試。
- 模組專屬臨時帳號：seed-workspace-improvement-scope-dev.cjs（.tmp-check/improvement-manager-account.json）、seed-workspace-task-*-dev.cjs、test-workspace-supervisors.py 提到的 supervisor-only 和 manager-only 角色、users-api 的隔離臨時帳號。
- 舊版 RBAC 腳本帳號：test-rbac-*-dev.js、test-general-affairs-role-matrix-dev.js 使用的 *@example.test 帳號，屬重型寫入，需要使用者批准。

### CI 與報表

【報表】
- 目前沒有 CI 設定（.github 只有 copilot-instructions.md；沒看到 workflows，uncertain）。
- 測試依賴本機 DEV 金鑰和遠端 DEV Supabase，建議先做本機一鍵執行：`npm run test:page -- <pageId>` 跑該頁的四層測試，`npm run test:all` 跑全部。
- 輸出到 tests/reports/<runId>/，內容包含 JUnit XML、Playwright HTML report、parity-report.json、截圖與 trace、summary.json。
- 每完成一頁的驗收紀錄要附上 summary 路徑。依 copilot-instructions，結果要同步記到 docs/CURRENT-DEV-STATUS.md、docs/DEV-RBAC-HANDOFF.md、docs/vue-workspace/verification.md。

【前置固定步驟】
1. node --check 和 vue-tsc。
2. npx tsc --noEmit。
3. Vue build 並同步到 public/workspace。
4. 執行守衛。

【若要上 CI】
- 只能放不碰 DB 的單元測試和靜態檢查，例如 Vitest、tsc、build。
- DB 和 E2E 不建議在 CI 跑，除非另建 CI 專用 DEV 專案或 branch。
