# M6 第一批：各頁可見角色清單（Z3）與驗收備註

範圍：W25 門市盤點（離線工具與分析報表）、P07 關係會員。資料來自 DEV 實測（`tests/integration/M6-W25.inventory-roles.spec.ts`、`tests/integration/M6-P07.relationships-roles.spec.ts`、`tests/smoke/M6-*.spec.ts`），角色帳號為 `tests/fixtures/role-matrix.json` 的既有帳號，加上測試期間臨時建立的 `m6-test-*`（角色代碼 `m6_test_*`，測完即刪）。

## 盤點管理（`/inventory`，工作台「盤點管理」）

| 角色（帳號） | 導覽入口 | 離線盤點工具 | 匯入盤點 Excel | 刪除批次 | 調整盤差原因門檻 | 備註 |
|---|---|---|---|---|---|---|
| 管理員（admin） | 有 | 有 | 有 | 有 | 有 | 全部（應用層 profiles.role=admin 後備） |
| 盤點組（inventory_team） | 有 | 有 | 有（.import） | 有（.delete） | 有（inventory.manage） | 同時有匯入與刪除專屬權限 |
| 盤點編輯（inventory_edit） | 有 | 有 | 有（.import） | 無 | 無 | 只有匯入權限，刪除 403 |
| 盤點刪除（inventory_delete） | 有 | 有 | 無 | 有（.delete） | 無 | 只有刪除權限，匯入 403 |
| 只有檢視（inventory_view） | 有 | 有 | 無 | 無 | 無 | 2026-11-22 盤點權限問卷：檢視權限只能看，匯入、刪除 403 且按鈕隱藏（舊版同步收緊） |
| 店長／代理店長（store_manager、acting_manager） | 有 | 有 | 無 | 無 | 無 | 結果分析只看自己門市（scope: own）；只能看 |
| 全站導覽唯讀（navigation） | 有 | 有 | 無 | 無 | 無 | 檢視權限，只能看 |
| 只有 inventory.manage（臨時角色） | 有 | 有 | 無 | 無 | 有 | inventory.manage 不隱含匯入、刪除（問卷 P3） |
| 督導（supervisor） | 無 | 無 | 無 | 無 | 無 | 直接打 API 回 403 |
| 總務人員（ga_staff）、員工、無權限（denied） | 無 | 無 | 無 | 無 | 無 | 直接打 API 回 403；未登入 401 |

匯入、刪除只認專屬權限 `inventory.result_analysis.import`／`inventory.result_analysis.delete`（含應用層管理員後備）；沒有權限者新版 Vue 頁與舊版頁面都看不到匯入、刪除按鈕（隱藏，不是反灰），伺服端同樣回 403。

離線工具只在瀏覽器內處理檔案，不寫資料庫（e2e 驗證整個流程沒有任何非 GET 的 /api 請求）。

## 關係會員（`/store/relationship-members`，工作台「關係會員」）

| 角色（帳號） | 導覽入口 | 新增申請 | 搜尋與分頁 | 編輯 | 核可／駁回 | 刪除 | 銷售明細報表 | 匯入銷售明細／下載範本 |
|---|---|---|---|---|---|---|---|---|
| 管理員（admin） | 有 | 有 | 有 | 有 | 有 | 有 | 有 | 有 |
| 只能查看（relationship_view） | 有 | 有（view 即可申請） | 有 | 無 | 無 | 無 | 有 | 無 |
| 可編輯（relationship_edit、store_manager） | 有 | 有 | 有 | 有 | 無 | 無 | 有 | 有 |
| 可刪除（relationship_delete，含查看） | 有 | 有 | 有 | 無 | 無 | 有 | 有 | 無 |
| 只有核可（臨時帳號 m6_test_rel_approve） | 有 | 無 | 有 | 無 | 有 | 無 | 無 | 無 |
| 其他（denied、employee、督導等） | 無 | 無 | 無 | 無 | 無 | 無 | 無 | 無 |

刪除會員後銷售歷史明細保留。

## 驗收備註

- Z4 盤點樣本（1F 商品檔、外盤檔、FKS0701、預盤檔）尚未提供：本批新舊對跑一律使用 `tests/fixtures/m6/` 的自造檔（`node tests/fixtures/m6/build-fixtures.cjs` 可重新產生，全部是虛構品號與品名）。**尚未用真實樣本驗證**，樣本到位後把檔案放進同一組流程補跑（`tests/parity/M6-W25.inventory-offline.spec.ts` 與 `tests/unit/M6-W25/legacy-parity.test.ts` 改讀真實檔即可）。
- A7 已在 DEV 實測：舊 `/api/relationship-sales/import` 同一份檔連續匯入兩次共 4 筆，確認舊版不去重（程式碼與資料表皆無唯一約束）。
- 並行填寫會員編號：舊版兩個請求都回 200、後寫的覆蓋；新版 workspace 編輯改為單一條件更新，第二個回 409（連續 3 回合驗證）。
- 資料庫：`workspace_import_relationship_sales(text, uuid, jsonb)`（DEV：`supabase/workspace-dev/20261121100000_m6_relationship_sales_import.sql`，附 rollback；正式區草稿見 `m6-sql/`）。**正式區上線前必須先套用該函式**，否則新版匯入會回 500（舊頁不受影響）。
