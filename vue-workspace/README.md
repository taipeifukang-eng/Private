# 菁英 Vue 測試工作台

Vue 3 / Vite / Pinia / Vue Router，多頁籤人員狀態、巡店、活動、業績與盤點核心操作。
產品定義：`../docs/vue-workspace/product.md`。

## 啟動

在原菁英業務網工作目錄根目錄執行：

```powershell
powershell -NoProfile -File scripts/start-workspace-preview.ps1
```

入口為 http://localhost:3002/workspace/index.html，也可由原總務測試站 Navbar 的「新版工作台」進入。腳本建置 Vue 靜態資產並啟動原測試站；全站側欄依帳號權限顯示。五個優先模組使用原生 Vue 頁面，不使用 iframe；其餘非優先功能另開原測試頁。
請使用 `localhost` 入口，寫入要求 Origin 必須相符；不開放跨來源或區網。
後端強制驗證 DEV 專案與金鑰專案識別，未設定 WORKSPACE_DEV_ENABLED 即拒絕服務。
整合模式使用 WORKSPACE_USE_EXISTING_SESSION=true，共用原站 Supabase 登入；登出也會同步登出原站。獨立 5173/3100 開發模式才使用獨立 HttpOnly Cookie。
這是本機測試配置，正式部署需另定同源代理、HTTPS、登入與環境檢查策略。

首次準備需安裝根目錄依賴與 `npm install --prefix vue-workspace`。
本工作目錄的 vue-workspace/node_modules 目前連到先前 Vue worktree 的依賴；搬移工作目錄時請自行 npm ci。
可沿用原測試帳號；專用測試帳號位於根目錄 `.tmp-check/新版全站測試登入資料.txt`，不提交版本控制。全站導覽管理員可檢視完整選單，其他測試角色只顯示獲授權功能。

## 資料庫

`scripts/apply-workspace-dev.cjs` 僅可對 allowlist DEV 執行 `supabase/workspace-dev/20261027120000_vue_workspace_phase1.sql`。
此 SQL 已在本次 DEV 實作套用，新增巡店識別欄位與活動版本／重送識別，沒有刪除業務資料。
因既有 migration 編號重複及遠端落後，本次是獨立 DEV 增補，不改寫 Supabase migration history；正式整合前須與歷史 migration 對帳。
`scripts/seed-workspace-dev.cjs` 建立專屬假資料與三個測試角色：編輯員、單店唯讀、無權限。
seed 不重設既有帳號密碼。不要刪除本機憑證後重跑以期重設密碼。

## 驗證

```powershell
npm --prefix vue-workspace run build
node scripts/workspace-backend.cjs --integrated --build
python scripts/test-workspace-integration.py
python scripts/test-workspace-five-modules.py
python scripts/test-workspace-five-recovery.py
```

後端 build 使用獨立 `.next-workspace-build`，避免影響執行中的開發伺服器。
動態測試使用專用 DEV 帳號並建立標記為 Vue 測試的活動；不接觸正式資料。
測試結果與截圖置於 `.tmp-check`。不以 admin 查詢成功當作角色矩陣通過。
整合測試在 3002 執行，共 9 項；先前的 test-vue-workspace.py 與 test-vue-workspace-recovery.py 在獨立 5173 模式執行，分別 15 與 11 項。

## 工作頁與權限

每頁以 UUID 識別，掛載實例在切換時保留，關閉即卸載。草稿只在記憶體，不寫 localStorage。
只有主題偏好使用 localStorage。全站門市只在新開巡店列表時複製。
活動是公司檔期，不綁定全站門市。
後端每次讀寫重查有效角色與權限；不使用舊 profiles.role 作為新工作台的管理員捷徑。
列表只提供有相應查看能力的人；巡店 own/store/all 範圍在後端組合。
活動更新以 workspace_version 在同一 UPDATE 條件比對，trigger 遞增版本；過期版本回 409。
人員資料及業績以 updated_at 在同一 UPDATE 比對；已送審的人員資料不能透過新版編輯覆寫。業績新增使用唯一約束防止兩頁同時建立同一月份資料。
新增使用 UUID 重送識別與唯一索引，即使回應遺失，重試也不建立另一筆。

盤點複盤欄位已透過 `scripts/apply-workspace-inventory-dev.cjs` 對 DEV 補齊，來源為既有 20260817 migration；僅補這項結構，不整批同步 migration history。人員與業績沿用現有資料表，盤點沿用既有匯入、複盤及門市範圍規則。

框架參考：[Vite proxy](https://vite.dev/config/server-options#server-proxy)、[Vue component state lifecycle](https://vuejs.org/guide/built-ins/keep-alive.html)。

