# M6 第二批：各頁可見角色清單（Z3）與驗收備註

範圍：W27 商品主檔、W28 Excel 匯入（W29 缺貨回報尚未做）。資料來自 DEV 實測（`tests/integration/M6-W27.products-master-roles.spec.ts`、`tests/e2e/M6-W27.products-master-journey.e2e.spec.ts`），角色帳號為 `tests/fixtures/role-matrix.json` 的既有帳號，加上測試期間臨時建立的 `m6-test-pm-manage`、`m6-test-pm-plain`（角色代碼 `m6_test_pm_*`，測完即刪）。

## 商品主檔（`/cross-dept/products-master`，工作台「商品主檔」）

| 角色（帳號） | 導覽入口 | 清單與搜尋 | 新增、編輯 | 停用、重新啟用 | Excel 匯入（預覽、確認） | 商品搜尋（缺貨回報用） |
|---|---|---|---|---|---|---|
| 管理員（admin） | 有 | 有 | 有 | 有 | 有 | 有 |
| 只有商品主檔管理權限（臨時帳號 `m6_test_pm_manage`，非 admin） | 有 | 有 | 有 | 有 | 有 | 有 |
| 其他全部角色（店長、督導、盤點組、員工、無權限等） | 無 | 403 | 403 | 403 | 403 | 有（登入即可） |

- 未登入：所有 API 回 401；寫入類 API 檢查 Origin（錯誤回 403）。
- 導覽權限碼不變（`store.products_master.manage`）。「商品主檔」改為在工作頁內開啟；導覽與頁面都沒有併購相關項目。
- 權限採正式區 `has_permission` 語意（不檢查 `roles.is_active`、無 DB admin 繞過、只有 `profiles.role==='admin'` 應用層後備）。

## 驗收備註

- Z4：商品主檔樣本尚未提供；本批用自造 Excel（別名欄位、更新、停用商品、重複編號、缺欄位、1100 筆、5001 筆）驗證，**尚未用真實商品檔驗證**。
- 舊版匯入在 DEV 對所有測試帳號都回 403（見 m6-spec.md 第二批第 4 點），所以新舊對跑的「舊版」匯入以等價寫入替代；正式區未驗證。
- 資料庫：`products_master_operation_logs`（DEV：`supabase/workspace-dev/20261122100000_m6_products_master_logs.sql`，附 rollback；正式區草稿見 `m6-sql/`）。正式區上線前必須先建立此資料表，否則新版寫入類操作會回 503（搜尋、清單與舊頁不受影響）。
