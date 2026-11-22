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
