# 每月人員狀態加速：做法、數字與正式區 SQL 順序

規格：monthly-speed-spec.md（A 合併請求、B 減少往返、C 資料庫函式）。只動 DEV。

## 做法

- **A 合併請求：** `GET /api/workspace/monthly` 在有效門市時附上 `meta`（統計、capabilities、version、storeStatus），內容由 `lib/workspace/monthly-meta.ts` 的 `buildMonthlyMeta` 產生；`tools?op=meta` 也走同一支，兩邊不會分歧。欄位權限（`viewStats`、`viewSupport`）在 `buildMonthlyMeta` 內過濾。`MonthlyTools.vue` 收到 `meta` prop 就直接使用，不再另打 `op=meta`；沒收到（舊回應）時退回原本的 `load()`。儲存後 `emit('refresh')` 重讀名冊，meta 隨之更新；編輯統計／支援時數的版本衝突檢查仍在開窗時讀 `op=meta`，行為不變。
  - 活動檢視入口（`capabilities.activity`）原本每個權限碼各打 profiles、user_roles、rpc 三趟（三碼共 9 次）。現在用 context 已載入的角色權限判斷（有效指派、未過期、角色啟用、`is_allowed`、權限啟用，與 DEV `has_permission` 相同），`lib/campaign-access.ts` 新增 `canEnterCampaignViewWith`，原函式改為呼叫它，簽名不變。
- **B 減少往返：**
  - `context()`：getUser 之後 `user_roles`、`profiles`、以及呼叫端指定的預取查詢並行；`profile: false` 時不查 profiles（只有 session 路由用到 `ctx.profile`）。
  - 名冊頁在同一個並行波次預取「所有門市（含停止）」與「使用者的店長指派」，`moduleStores`、`isAssignedTo` 直接在記憶體依 `view_all`／指派過濾，結果與逐步查詢逐項相同（有效門市只留 `is_active=true` 且不帶 `is_active` 欄位，順序 `store_code`）。
  - `getMonthlyStaffStatus`、`getStoreMonthlySummary` 新增第三個選用參數 `caller = {}`：新版傳入已驗證的 `user` 與 `supabase`，省掉各自的 getUser；不傳就與以前完全一樣（舊版頁面不受影響）。名冊 helper 內原本循序的 4 個查詢（員工、單品獎金、加盟店清單、本店代碼）改並行。`caller.user` 只在同時有 server 端 `supabase` client 時才採信，Server Action 不能由瀏覽器偽造使用者。
  - 名冊、summary（總覽用）、recheck、adjustments、刪除權限全部並行。
- **C 資料庫函式：** `workspace_monthly_roster_page(p_store, p_month)` 一次回傳名冊（含 `user` 關聯、上月單品獎金、扣除其他加盟店後的業績）與該門市本月統計列；輔助函式 `workspace_extract_store_code`。
  - **偏離規格的一點：** 規格寫「REVOKE public/anon/authenticated、以 service 身分呼叫」。實測舊版這些查詢都是以使用者身分讀、受 RLS 限制：`support_staff_bonus` 無權限者看不到（上月單品獎金為 null）、`profiles` 只能讀自己、`stores` 影響加盟店清單、業績明細與統計各有權限條件。改用 service role 會讓沒權限的人看到上月單品獎金與他人 email（一致性測試也會失敗），在 SQL 內手寫複製 RLS 又會與政策漂移。因此函式是 `SECURITY INVOKER`，由使用者 session 呼叫，RLS 原封不動；REVOKE PUBLIC／anon，EXECUTE 給 authenticated 與 service_role。只有 service role 才讀得到的 `monthly_staff_recheck`、`monthly_staff_adjustment_log` 仍由 API 在確認門市權限後以 service role 讀，與 RPC 同時送出。
  - RPC 不存在或失敗時，API 自動退回並行的逐表查詢（結果相同、較慢），所以程式先上線、SQL 後執行都不會壞。
  - 檔案：`supabase/workspace-dev/20261107110000_monthly_roster_page.sql`、`.rollback.sql`、`scripts/apply-workspace-monthly-roster-page-dev.cjs`（加 `--rollback` 還原）。

## 量測（DEV，本機 next dev，每項取中位數）

整頁時間：Playwright 1920x1080，從點選單「每月人員狀態」起算，到名冊、統計、支援時數、需重新確認、近期調整全部出現且沒有任何「載入」狀態為止（`tests/perf/monthly-speed-page.cjs`，5 次）。

| 帳號 | 改前 | 改後 | 頁面 API 請求 |
| --- | --- | --- | --- |
| 店長（store_manager） | 3189 ms | 533 ms | 2 支循序 -> 1 支 |
| 督導（supervisor） | 3666 ms | 635 ms | 2 支循序 -> 1 支 |
| 單一權限（navigation，無統計權限） | 3177 ms | 504 ms | 2 支循序 -> 1 支 |

資料庫往返（伺服器對 Supabase 的請求數，`tests/perf/count-fetch.cjs` 計數）：

| 帳號 | 名冊 API 改前 -> 改後 | op=meta 改前 -> 改後 | 整頁合計 |
| --- | --- | --- | --- |
| 店長 | 15 -> 8 | 15 -> 5 | 30 -> 8 |
| 督導 | 16 -> 10 | 18 -> 7 | 34 -> 10 |
| 管理員 | 14 -> 8 | 9 -> 5 | 23 -> 8 |
| navigation | 15 -> 8 | 15 -> 5 | 30 -> 8 |

名冊 API 單支時間：店長 1739 -> 485 ms、督導 1870 -> 560 ms、管理員 1607 -> 486 ms。

## 一致性

`tests/perf/monthly-speed.cjs snapshot` 對 8 個帳號（admin、store_manager、supervisor、ops_manager、ops_assistant、navigation、monthly_view、pharmacist）、5 間門市（含無權限門市的 403）、多個月份、含預設門市共 80 組名冊回應與 72 組 `op=meta` 回應做改前改後 JSON 比對（鍵排序後完全相同，只允許新增 `meta` 欄位），並比對名冊內的 `meta` 與舊 `op=meta` 完全相同（30 組）：0 差異。

另以 ZT01 / 2099-07 搭配暫時把 ZT02 設為加盟店、塞入業績明細（含 0.1+0.2、0.005 的四捨五入）、單品獎金、`user_id`，比對「RPC 路徑」與「逐表查詢路徑（未改動的舊算法）」：0 差異；測後已清除這些資料並還原 ZT02。

## 正式區 SQL 執行順序（接在 M2 SQL 之後）

1. M2 既有清單（照原順序）：`20261105200000_w05_employee_id_rule.sql`、`20261105200100_w05_employee_edit_recheck.sql`、`20261106100000_w06_roster_recompute.sql`、`20261106110000_w06_c_movement_edit_delete.sql`、`20261106200000_p02_d_batch_transfer.sql`、`20261107100000_m2h_stage_and_transfer_confirm.sql`，再依 m2-sql 的 stage A -> B（預覽）-> C（回填）-> `check_position_mismatch.sql`。
2. **新增：** `20261107110000_monthly_roster_page.sql`（只建兩支函式與授權，不依賴上面任何一支，也不改資料；放最後即可）。出問題時執行 `20261107110000_monthly_roster_page.rollback.sql`，API 會自動退回逐表查詢。

## 重跑量測

```
node tests/perf/start-counted-server.cjs                                  # 另開 3022（有往返計數），PERF_FETCH_LOG 指定記錄檔
node tests/perf/monthly-speed.cjs snapshot --cases <cases.json> --out <snap.json> --base http://localhost:3022 --log <PERF_FETCH_LOG>
node tests/perf/monthly-speed.cjs compare before.json after.json
node tests/perf/monthly-speed-page.cjs --accounts store_manager,supervisor,navigation
```
