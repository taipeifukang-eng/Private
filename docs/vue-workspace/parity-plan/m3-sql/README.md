# M3 正式區 SQL 草稿（尚未執行，僅供使用者審閱）

對應規格 m3-spec.md A.4（已封存任務頁維持「身分加 task.view_archived」，上線前把現有能進舊版封存頁的主管角色補授權）。

舊版 /admin/archived 的進入條件是 profiles.role 為 admin 或 manager；新版另外要求 task.view_archived。所以只要有主管（profiles.role = manager）
沒有這個權限碼，切到新版後就看不到已封存任務頁。

執行順序（每個檔案都單獨貼上執行，不要整份連續貼）：

1. `grant_task_view_archived_A_preview.sql`：只讀。列出哪些主管目前缺權限、他們持有哪些角色、各角色另有多少非主管成員。
2. `grant_task_view_archived_B_grant.sql`：以 BEGIN 開頭，不會自動提交。只補給「所有有效成員都是主管或管理員」的角色；有一般員工混在內的角色一律略過並列出，交給使用者決定。執行後看筆數，再另外執行 COMMIT; 或 ROLLBACK;。
3. `grant_task_view_archived_C_rollback.sql`：若上線後要撤回，依備份表只刪除步驟 B 新增的授權。

這些檔案不得在 DEV 以外的環境由 Claude 執行；由使用者在正式區 SQL editor 自行審閱後執行。

## B.1／F1 營業主管開啟他人任務：新舊名單比對與補授權 task.manage

使用者已於 survey/m3f F1 核可：新版開啟他人任務需要「任務管理權限」（系統管理員，或 profiles.role = manager 且有 task.manage）。舊版只看 profiles.role 是 admin 或 manager。上線前請依下列順序處理（以下檔案不得由 Claude 在 DEV 以外執行，由使用者在正式區 SQL editor 單獨貼上執行）：

1. `compare_task_proxy_access.sql`：只讀。列出「舊版可、新版不可」的人（含 user id、員工編號、目前持有的角色），以及反向異常。判定依 `lib/workspace/permission-semantics.ts` 的正式區語意：不檢查 roles.is_active，並把管理員類角色（admin、system_admin 等）視為系統管理員。
2. 從結果挑出要補授權的人，把員工編號（profiles.employee_code）或 user id 填進下面兩個檔案的 `target` 清單（兩個檔案填同一份）：
   - `grant_task_manage_A_preview.sql`：只讀預覽。逐人顯示將補授權，或略過原因（找不到、身分不是 manager、已有權限）。
   - `grant_task_manage_B_grant.sql`：以 BEGIN 開頭，不自動提交。只建立專用角色 `task_proxy_manager`（含 task.manage 與 task.view_own，新版 taskDetail 兩者都要），並把名單中的 manager 加進去；不改現有角色，所以不會連帶讓同角色的其他人也拿到權限。備份表 `m3_task_manage_grants` 已開啟 RLS 並收回 anon／authenticated 權限（避免被 PostgREST 竄改後讓撤回誤刪），記錄新增的角色、授權與人員。執行後核對回傳，再另外執行 COMMIT; 或 ROLLBACK;。
   - `grant_task_manage_C_rollback.sql`：上線後要撤回時，依備份表只刪除步驟 B 新增的項目。
3. 沒有補授權的主管，切到新版後打開別人的任務會看到「找不到指派給你的任務」，這是已核可的差異。

task.manage 只對 profiles.role = manager（或 admin）有意義（見 `taskManagementScope`），所以步驟 B 會略過其他身分。

## B.1／F2 管理者代為勾選的資料庫變更

- 新版的資料庫變更目前只在 DEV：`supabase/workspace-dev/20261107130000_m3_task_proxy.sql`（`logs.proxy` 欄位與 `workspace_save_task_v2`）與 `20261107150000_m3f2_task_proxy_per_action.sql`（F2：每筆勾選各自標記是否代做，讓「參與者兼管理者」同一次儲存可混合自己與他區段）。兩者都附 `.rollback.sql`，套用腳本為 `scripts/apply-workspace-m3b-dev.cjs`（加 `--rollback` 還原）。正式區切換前需另外核准後套用。
