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
