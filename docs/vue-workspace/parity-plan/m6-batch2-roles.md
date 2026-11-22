# M6 第二批：各頁可見角色清單（Z3）與驗收備註

範圍：W27 商品主檔、W28 Excel 匯入、W29 商品部缺貨回報。資料來自 DEV 實測（`tests/integration/M6-W27.products-master-roles.spec.ts`、`tests/e2e/M6-W27.products-master-journey.e2e.spec.ts`），角色帳號為 `tests/fixtures/role-matrix.json` 的既有帳號，加上測試期間臨時建立的 `m6-test-pm-manage`、`m6-test-pm-plain`（角色代碼 `m6_test_pm_*`，測完即刪）。

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

## 商品部缺貨回報（`/cross-dept/merchandise`，工作台「商品部」，W29）

資料來自 DEV 實測（`tests/integration/M6-W29.stockout-roles.spec.ts`、`tests/e2e/M6-W29.merchandise-journey.e2e.spec.ts`），臨時帳號 `m6-test-so-*`（角色代碼 `m6_test_so_*`，測完即刪；前綴已避開 role-matrix 與 roles 表既有代碼）。權限碼沿用 `cross_dept.stockout.submit／view_all／respond`。

| 角色 | 導覽入口 | 預設分頁 | 看哪些門市的回報 | 新增回報 | 回覆（新增、編輯） | 刪除回報 |
|---|---|---|---|---|---|---|
| 管理員（admin） | 有 | 全部門市 | 全部 | 任一門市 | 有 | 任意 |
| 只有查看全部（view_all） | 有 | 全部門市 | 全部 | 任一門市 | 有（view_all 可回覆，同舊版） | 任意 |
| 只有回覆（respond） | 有 | 全部門市 | 全部 | 任一門市 | 有 | 任意 |
| 店長（只有提交，有管轄門市） | 有 | 我的門市 | 只有自己管轄的門市（指定其他門市 403） | 只能替自己管轄的門市 | 無（403） | 只能刪自己的 |
| 只有提交、沒有管轄門市 | 有 | 我的門市 | 空清單 | 403 | 無 | 無自己的回報可刪 |
| 沒有任何缺貨權限（含一般店長、督導等） | 無 | - | 403 | 403 | 403 | 403 |

- 未登入：所有 API 回 401；寫入類 API 檢查 Origin（錯誤回 403）。
- 所有登入且有任一缺貨權限者都可查回覆與歷程；沒有權限者 403。
- 權限採正式區 `has_permission` 語意（不檢查 `roles.is_active`、無 DB admin 繞過、只有 `profiles.role==='admin'` 應用層後備）。
- 與舊版不同的是門市範圍：舊版任何有提交權限者可指定任一門市查看、也可替任一門市回報；新版限制為自己管轄的門市（白名單 `m6-w29-post-store-scope`、`m6-w29-list-store-scope`）。

## W29 驗收備註

- 沒有用真實缺貨資料驗證（測試資料皆為 `ZT2038-<runId>-…`，門市只用 VW001／VW002）。
- DEV 有舊版就存在的觸發器會在回覆寫入時改寫同商品 pending 回報的 `status`；新版畫面不依賴該欄位（C3）。正式區觸發器是否相同未驗證。
- 資料庫：兩個交易函式（DEV：`supabase/workspace-dev/20261122110000_m6_stockout_rpc.sql`，附 rollback；正式區草稿見 `m6-sql/`）。正式區上線前必須先建立，否則新版「商品部回覆」與「刪除回報」會失敗。

## 督導管理日誌（`/supervisor-management-log`，工作台「督導管理日誌」，第三批 3b W32）

資料來自 DEV 實測（`tests/integration/M6-W32.supervisor-log-roles.spec.ts`、`tests/e2e/M6-W32.supervisor-journey.e2e.spec.ts`），臨時帳號 `m6-test-sl-*`（角色代碼 `m6_test_sl_*`，測完刪除）。導覽權限碼不變：六個 `supervisor.management_log.*` 任一。角色矩陣（`role-matrix.json`）裡看得到入口的：admin（全部）、`vue_workspace_navigation`（view_own、view_team）、`vue_workspace_supervisor`（view_own、view_team、create、update_own、follow_up）。

| 權限組合 | 導覽入口 | 看得到的案件 | 建立案件、規劃 | 修改 | 新增紀錄 | 新增追蹤 | 刪除 |
|---|---|---|---|---|---|---|---|
| 管理（manage），或 admin | 有 | 全部 | 有 | 全部（含已結案） | 有 | 需另有 follow_up | 全部（要原因） |
| 看團隊（view_team） | 有 | 自己管轄門市的案件 | 無 | 無 | 無 | 無 | 無 |
| 督導（view_own、create、update_own、follow_up） | 有 | 自己建立或指派給自己的，加上管轄門市的（follow_up） | 有 | 自己建立且未結案的，加上管轄門市的（follow_up） | 有（可修改的案件） | 有 | 自己建立且未結案的案件、自己的紀錄與追蹤 |
| 只有看自己（view_own） | 有 | 指派給自己的 | 無 | 無 | 無 | 無 | 無 |
| 只有建立（create） | 有 | 自己建立的 | 有 | 無（沒有 update_own） | 無 | 無 | 無 |
| 看自己加追蹤（view_own、follow_up） | 有 | 被指派的與管轄門市的 | 無 | 管轄門市或被指派且未結案的 | 有 | 有 | 只有自己建立的紀錄與追蹤 |
| 沒有任何督導日誌權限 | 無 | 403 | 403 | 403 | 403 | 403 | 403 |

- 未登入所有 API 回 401；寫入類 API 檢查 Origin（錯誤回 403）。
- 讀取採正式區 `has_permission` 語意；寫入另受舊版資料表觸發器與 RLS 檢查（角色停用者可讀、不能寫）。
- 與舊版不同的是：本人可刪自己的案件、規劃、紀錄與追蹤（舊版只有管理者）；含紀錄的案件新版刪得掉（舊版 500）；結案欄位新版會寫入（舊版結不了案）。見白名單 `m6-w32-*`。

## 督導語音與 AI 摘要（督導管理日誌內的「語音口述」與「AI 用量」，第三批 3b W33）

資料來自 DEV 實測（`tests/integration/M6-W33.voice-ai.spec.ts`、`tests/e2e/M6-W33.voice-journey.e2e.spec.ts`）。語音沿用舊版的使用資格（建立或編輯權限任一，含管理），不新增也不收回。

| 權限組合 | 語音口述入口 | 逐字稿 | AI 用量頁籤與上限設定 | 首頁 AI 費用提醒 |
|---|---|---|---|---|
| 系統管理員（profiles.role 為 admin） | 有（可進案件即有） | 看得到（管理者） | 有 | 80% 與 100% 都收到 |
| 管理（manage） | 有 | 看得到全部 | 無（403） | 無 |
| 督導（create、update_own，可加 follow_up） | 有（案件可新增紀錄時） | 只看自己建立的 | 無 | 無 |
| 只有建立（create） | 有（但沒有案件可新增紀錄） | 只看自己建立的 | 無 | 無 |
| 看團隊（view_team）、只有看自己（view_own） | 無（403） | 看不到（紀錄看得到，逐字稿 403，也看不出有沒有） | 無 | 無 |
| 沒有任何督導日誌權限 | 無 | 無 | 無 | 無 |

- 第一次使用語音要先閱讀並勾選同意告知；額度用完時入口仍在，但只能手動文字稿與本機規則。
- 費用金額只有系統管理員看得到（用量 API、AI 用量頁籤、首頁提醒）；其他人只看得到「AI 目前可不可用」。
