# M5 正式區 SQL 草稿（尚未執行，僅供使用者審閱）

對應 m5-spec.md 的 W19 活動排程（Q1 到 Q5）。這些檔案不得由 Claude 在 DEV 以外的環境執行，由使用者在正式區 SQL editor 自行審閱後執行。
每個檔案都單獨貼上執行；唯讀檔案不會改任何資料。W20 到 W24、P06 的上線前名單（Q9、Q13、Q17 等）由各自的工作項補在這個資料夾。

## 上線前檢查（唯讀）

| 檔案 | 對應 | 看什麼 |
|---|---|---|
| `w19_q1_write_permission_diff.sql` | Q1 | 活動新增、修改、刪除、儲存排程的「新舊結果不同」帳號。舊版要同時過兩關（舊式身分是管理員或經理、資料庫要有活動編輯權），新版只看角色權限（管理員後備另計）。`NEW_ONLY` 是上線後會突然能改的人；`LEGACY_ONLY` 理論上沒有，出現請先回報。 |
| `w19_q2_inactive_campaigns.sql` | Q2 | 有沒有被誤設停用的活動。新版上線後停用的活動對督導、店長、活動檢視、門市端隱藏；舊版畫面沒有停用開關，理論上全部啟用。 |
| `w19_q4_out_of_range_schedules.sql` | Q4 | 排程日期落在活動期間外的既有資料（舊版改期後留下的隱形排程）。新版排程頁會顯示並提供「移回尚未安排」。 |
| `w19_q5_schedules_on_blocked_days.sql` | Q5 | 已排在禁止日或門市禁止星期的既有排程，僅供了解現況。 |

## 選用：把誤停用的活動改回啟用（需要寫入）

1. `w19_q2_B_reactivate.sql`：以 `BEGIN;` 開頭，不會自動提交。把要改回啟用的活動 id 填進暫存表，先預覽、備份到 `m5_w19_campaign_backup`、再改，最後一段核對（`still_inactive` 應為 0），確認後另外執行 `COMMIT;`，有疑慮執行 `ROLLBACK;`。
2. `w19_q2_C_rollback.sql`：上線後想撤回，依備份把啟用旗標還原。同樣以 `BEGIN;` 開頭。

## 備註

- 本批次 W19 沒有資料庫結構變更（沒有新欄位、沒有新函式），所以沒有 DEV 的 migration 與 apply 腳本；Q3 的筆數、Q4 的期間外門市都由 API 直接查詢。
- 實測發現（與 m5-spec 的背景描述不同，已寫進 allowlist 與完成報告）：舊版 `POST /api/campaigns` 在「舊式身分是經理、但角色沒有活動編輯權」時其實也寫不進去（資料庫 RLS 擋下，回 500），不是規格背景所說的「舊版放行」。所以 Q1 真正新舊不同的帳號只有「有活動編輯權、但舊式身分不是管理員或經理」（以及只靠管理員後備放行的人），這就是 `w19_q1_write_permission_diff.sql` 會列出的 `NEW_ONLY` 名單。
- 權限判定一律照正式區 has_permission：`user_roles.is_active` 且未過期、`role_permissions.is_allowed`、`permissions.is_active`，不檢查 `roles.is_active`，資料庫端沒有 admin 放行。
