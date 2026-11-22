# M6 正式區 SQL 草稿

這個資料夾只放「草稿」，**尚未套用到正式區**。DEV 版在 `supabase/workspace-dev/`（含 `.rollback.sql`），不碰 `supabase/migrations/`。
上線前要轉成正式 migration，並由人確認後才能套用；新版程式部署前，對應函式必須先存在。

| 檔案 | 用途 | 對應項目 |
|---|---|---|
| `20261121100000_m6_relationship_sales_import.sql` | `workspace_import_relationship_sales(text, uuid, jsonb)`：關係會員銷售明細匯入，內容完全相同的明細自動略過，同一交易內加鎖，並行匯入不會產生重複 | M6 第一批 P07 A7（allowlist：`m6-p07-a7-sales-import-dedupe`） |
| `20261121100000_m6_relationship_sales_import.rollback.sql` | 移除上述函式（不動資料） | 同上 |

注意事項

- 函式只授權給 `service_role`（workspace 匯入 handler 以 admin client 呼叫），`anon`、`authenticated` 不可執行。
- 沒有新增唯一索引：同一檔內允許出現相同列（正常交易可能重複），所以不能用唯一約束保證；改以交易加 advisory lock 序列化。
- 舊 `/api/relationship-sales/import` 不動；沒有此函式時，只有 workspace 匯入會失敗（回 500），舊頁照常。
- 正式區的 `has_permission` 語意與 DEV 不同（不檢查 `roles.is_active`），此函式不涉及權限判斷，權限仍在 handler 以 `relationship_member.edit` 檢查。

## 第二批（2026-11-22）

| 檔案 | 用途 | 對應項目 |
|---|---|---|
| `20261122100000_m6_products_master_logs.sql` | 新增 `products_master_operation_logs`：商品主檔操作紀錄（匯入幾筆、停用、重新啟用、新增、編輯；誰、何時）。啟用 RLS，只有 `store.products_master.manage` 可讀；只由 workspace API 以 `service_role` 寫入 | M6 第二批 W27/W28（allowlist：`m6-w27-operation-logs`） |
| `20261122100000_m6_products_master_logs.rollback.sql` | 移除上述資料表（`products_master` 不動） | 同上 |

注意事項

- `products_master`、`product_barcodes` 在 DEV 已存在（RLS：只有 `store.products_master.manage` 可讀寫，來自 `p1g_*` policy）。本批**不修改**這兩張表，也不碰 `acquisition_*`。正式區上線前需先確認正式區的 `products_master` 結構與 DEV 相同（`product_code` 唯一、`product_name`、`unit`、`is_active`、`updated_at`）。
- 新版 workspace API 以 admin client 存取 `products_master`（商品搜尋要對所有登入者開放，但資料表 RLS 只放行管理權限者），權限在 API 層以正式區 `has_permission` 語意判斷。
- 沒有此資料表時，只有新版寫入類操作（匯入、停用、重新啟用、新增、編輯）會失敗（503）；搜尋、清單與舊頁不受影響。

## 第二批 W29（2026-11-22）

| 檔案 | 用途 | 對應項目 |
|---|---|---|
| `20261122110000_m6_stockout_rpc.sql` | `workspace_stockout_respond(text, text, text, date, uuid)`：商品部回覆「以商品編號更新或新增目前回覆」與「寫入回覆歷程」在同一個交易；`workspace_stockout_delete_report(uuid, uuid, boolean)`：刪除回報，並在該商品已無任何回報時同一交易清掉目前回覆（歷程保留）。只授權 `service_role` | M6 第二批 W29（allowlist：`m6-w29-reply-transaction`） |
| `20261122110000_m6_stockout_rpc.rollback.sql` | 移除上述兩個函式（不動資料） | 同上 |

注意事項

- `stockout_reports`、`stockout_product_responses`、`stockout_product_response_history` 在 DEV 與正式區都已存在，本批**不修改**這三張表。函式檔頭先檢查三張表是否存在。
- 回覆函式用 `ON CONFLICT (product_code)`，要求 `stockout_product_responses.product_code` 有唯一約束（舊 migration 已有 `UNIQUE`）；上線前請確認正式區同樣有。
- 資料庫上有舊版就存在的觸發器 `sync_stockout_report_status`（回覆寫入時把同商品 pending 的回報改成 responded）。新版不依賴也不寫回報的 `status` 欄位，畫面狀態一律由目前有效回覆即時算出（C3）；觸發器維持不動，舊頁照舊使用。
- 沒有這兩個函式時，只有新版的「商品部回覆」與「刪除回報」會失敗（503／500）；清單、新增回報、回覆查詢與舊頁不受影響。

## 盤點權限分開（2026-11-22 問卷）

| 檔案 | 用途 |
|---|---|
| `inventory-perm-check.sql` | **唯讀**查詢（只有 SELECT）：列出角色（代碼、名稱、啟用）與各盤點權限的持有人數，並列出上線後會失去匯入或刪除的人。請老闆或 DBA 於正式區手動執行，不要自動跑。 |

- 本次沒有資料庫結構變更：匯入、刪除的權限判斷都在應用層（API 與按鈕旗標）。資料表 RLS 查證結果見 `m6-spec.md`「盤點權限分開」。

## 第三批 3b W32（2026-11-22）

| 檔案 | 用途 | 對應項目 |
|---|---|---|
| `20261122130000_m6_supervisor_log_rpc.sql` | `workspace_supervisor_soft_delete(text, uuid, text)`：督導管理日誌的案件、紀錄、追蹤軟刪除。以呼叫者身分（`auth.uid()`）執行，舊版驗證觸發器與 RLS 照常生效；管理者可刪全部，其他人只能刪自己建立的（案件需 `update_own` 且未結案或取消）；先軟刪紀錄與追蹤、最後才軟刪案件（舊版先軟刪案件，之後紀錄觸發器因案件已刪除而拒絕），並寫 `SOFT_DELETE`／`RECORD_SOFT_DELETE`／`FOLLOWUP_SOFT_DELETE` 時間線事件。授權 `authenticated`、`service_role` | M6 W32（E2；allowlist：`m6-w32-e2-*`） |
| `20261122130000_m6_supervisor_log_rpc.rollback.sql` | 移除上述函式（不動資料與舊版函式） | 同上 |

注意事項

- 本批**不新增資料表、不修改任何既有資料表與舊版函式**。函式檔頭先檢查 `supervisor_management_*` 資料表與 `supervisor_management_case_is_manageable` 是否存在。
- 新版寫入以登入者身分，所以正式區必須已有 `20260812093000`、`20260812154708`、`20260812155612`、`20260813063209` 四個舊 migration 的函式、觸發器與政策（DEV 已確認）。
- 沒有此函式時，只有新版的「刪除案件、紀錄、追蹤」會失敗（503）；其他功能、每日計畫刪除（沿用舊函式）與舊頁不受影響。
- DEV 的 `stores` 資料表政策（`dev_stores_select_managed`）是 DEV 專用；新版選項 API 的門市範圍（管理者全部、其他人只有管轄門市）是在應用層明確寫出，上線前請核對正式區 `stores` 政策。

## 第三批 3b W33（2026-11-22）

| 檔案 | 用途 | 對應項目 |
|---|---|---|
| `20261122133000_m6_voice_ai.sql` | 五張表：`workspace_ai_settings`（每月上限，預設 30 美元，只有一列）、`workspace_ai_usage_ledger`（每次呼叫的事前估算費用，micro-USD 整數）、`workspace_ai_alerts`（每月第一次達 80%／100%）、`workspace_ai_consents`（語音告知同意紀錄）、`workspace_supervisor_voice_transcripts`（逐字稿，每筆紀錄至多一筆）；兩個函式：`workspace_ai_reserve`（同一交易內加鎖、檢查月額度、寫入估算費用、記通知）、`workspace_ai_month_spent`。全部啟用 RLS、沒有任何登入者政策，並撤銷 anon／authenticated 權限，只授權 `service_role` | M6 W33（allowlist：`m6-w33-*`） |
| `20261122133000_m6_voice_ai.rollback.sql` | 移除上述函式與資料表（不動督導日誌資料表與資料） | 同上 |

注意事項

- 不修改任何舊版資料表與函式；`workspace_supervisor_voice_transcripts.record_id` 參照 `supervisor_management_records(id)`（ON DELETE CASCADE），函式檔頭先檢查前置資料表是否存在。
- 逐字稿只由 workspace API 以 `service_role` 讀寫，可見範圍（建立者與管理者）在應用層判斷；資料表本身沒有給登入者的政策，所以舊版 API 與直接以登入者身分查詢都讀不到。
- 沒有這些資料表與函式時，只有新版的語音（同意、轉文字、草稿、逐字稿、AI 用量）會失敗；督導日誌其他功能、首頁（提醒查詢失敗會被略過）與舊頁不受影響。
- 預設上限 30 美元寫在資料表預設值與初始列；正式區上線前請確認要不要用 30，之後由系統管理員在頁面調整。
- `OPENAI_API_KEY` 由 Vercel 管理，本次沒有動；沒設定時新版語音一律走手動文字稿與本機規則。
