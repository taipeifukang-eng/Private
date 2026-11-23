# M9 正式區 SQL 草稿

這個資料夾只放「草稿」，**尚未套用到正式區**。DEV 版在 `supabase/workspace-dev/`（含 `.rollback.sql`），不碰 `supabase/migrations/`。
上線前要轉成正式 migration，並由人確認後才能套用。

| 檔案 | 用途 | 對應項目 |
|---|---|---|
| `20261123150000_m9_page_fallbacks.sql` | 新增 `workspace_page_fallbacks`（逐頁「回舊版」開關，每個頁面種類一列）、`workspace_page_fallback_events`（切換稽核紀錄，只新增）、`workspace_set_page_fallback(text, boolean, text, uuid)`（同一交易寫入目前狀態與稽核紀錄） | M9 F01S，2026-11-23 上線準備問卷 N2 |
| `20261123150000_m9_page_fallbacks.rollback.sql` | 移除上述函式與兩張資料表 | 同上 |

注意事項

- 兩張表都啟用 RLS 且沒有任何政策，`anon`、`authenticated` 不可讀寫；只由 workspace API 以 `service_role` 存取。函式只授權給 `service_role`。
- 新版程式部署時若表還不存在：session 讀不到備援表就視為「沒有任何頁面切回舊版」（選單全部開新版），不會讓整個工作台壞掉；只有「頁面回舊版設定」管理頁的儲存會失敗（503）。所以順序不拘，但要用開關前必須先套用本檔。
- 還原後（執行 rollback）所有頁面回到「開新版」，舊版頁面與資料不受影響。
- 不涉及權限碼：管理頁與 API 只認系統管理員（`profiles.role = 'admin'` 或管理員類角色，應用層判斷，與 AI 用量設定相同），沒有新增 `permissions` 資料。
- 正式區 `has_permission` 語意與 DEV 不同（不檢查 `roles.is_active`），本檔不涉及權限判斷。
