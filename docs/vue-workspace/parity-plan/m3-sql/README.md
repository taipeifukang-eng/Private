# M3 正式區 SQL 草稿（尚未執行，僅供使用者審閱）

對應規格 m3-spec.md A.4（已封存任務頁維持「身分加 task.view_archived」，上線前把現有能進舊版封存頁的主管角色補授權）。

舊版 /admin/archived 的進入條件是 profiles.role 為 admin 或 manager；新版另外要求 task.view_archived。所以只要有主管（profiles.role = manager）
沒有這個權限碼，切到新版後就看不到已封存任務頁。

執行順序（每個檔案都單獨貼上執行，不要整份連續貼）：

1. `grant_task_view_archived_A_preview.sql`：只讀。列出哪些主管目前缺權限、他們持有哪些角色、各角色另有多少非主管成員。
2. `grant_task_view_archived_B_grant.sql`：以 BEGIN 開頭，不會自動提交。只補給「所有有效成員都是主管或管理員」的角色；有一般員工混在內的角色一律略過並列出，交給使用者決定。執行後看筆數，再另外執行 COMMIT; 或 ROLLBACK;。
3. `grant_task_view_archived_C_rollback.sql`：若上線後要撤回，依備份表只刪除步驟 B 新增的授權。

這些檔案不得在 DEV 以外的環境由 Claude 執行；由使用者在正式區 SQL editor 自行審閱後執行。

## B.1 管理者代為勾選：舊版 admin／manager 名單與新版比對

- `compare_task_proxy_access.sql`：只讀。列出舊版能打開別人任務、新版打不開的人（以及反向的異常）。上線前請使用者看結果：有出入的人要決定補授權 `task.manage` 或接受打不開。
- 新版的資料庫變更（`logs.proxy` 欄位與 `workspace_save_task_v2`）目前只在 DEV（`supabase/workspace-dev/20261107130000_m3_task_proxy.sql`，附 rollback）；正式區切換前需另外核准後套用。
