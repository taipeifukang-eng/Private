# M5 正式區 SQL 草稿（尚未執行，僅供使用者審閱）

對應 m5-spec.md 的 W19 活動排程（Q1 到 Q5）、W20、W21 組織與部門（Q9 到 Q11）、P06 使用者與角色（Q12 到 Q15）、W23／W24 年度行事曆與 Google 同步（Q17 到 Q21）。這些檔案不得由 Claude 在 DEV 以外的環境執行，由使用者在正式區 SQL editor 自行審閱後執行。
每個檔案都單獨貼上執行；唯讀檔案不會改任何資料。W20 到 W24、P06 的上線前名單（Q9、Q13、Q17 等）由各自的工作項補在這個資料夾。

## 上線前檢查（唯讀）

| 檔案 | 對應 | 看什麼 |
|---|---|---|
| `w19_q1_write_permission_diff.sql` | Q1 | 活動新增、修改、刪除、儲存排程的「新舊結果不同」帳號。舊版要同時過兩關（舊式身分是管理員或經理、資料庫要有活動編輯權），新版只看角色權限（管理員後備另計）。`NEW_ONLY` 是上線後會突然能改的人；`LEGACY_ONLY` 理論上沒有，出現請先回報。 |
| `w19_q2_inactive_campaigns.sql` | Q2 | 有沒有被誤設停用的活動。新版上線後停用的活動對督導、店長、活動檢視、門市端隱藏；舊版畫面沒有停用開關，理論上全部啟用。 |
| `w19_q4_out_of_range_schedules.sql` | Q4 | 排程日期落在活動期間外的既有資料（舊版改期後留下的隱形排程）。新版排程頁會顯示並提供「移回尚未安排」。 |
| `w19_q5_schedules_on_blocked_days.sql` | Q5 | 已排在禁止日或門市禁止星期的既有排程，僅供了解現況。 |

| `w20_q7_entry_audit.sql` | W20 | 活動檢視入口名單：有活動檢視權（查看自己的或全部）的人，哪些能進入、哪些「有權限但沒有任命也不是盤點組」而看不到入口（舊版已定規則，新舊相同）。由你決定誰要補門市任命。 |
| `w20_q7_buttons_preview.sql` | W20 Q7 | 每個人在活動排程檢視會看到哪幾顆按鈕（支援請求、活動人力查看、前置 Check List）與管轄門市數；特別標出「有權限但沒有任命，三顆按鈕都不出現」的人。 |
| `w21_q9_department_gate_preview.sql` | W21 Q9 | 部門管理入口新舊名單：`NEW_BLOCKED` 是 M5 之前的新版進得去、改回舊頁面條件後進不去的人（只有組織／成員／主管檢視類權限）；`MENU_BUT_BLOCKED` 是舊版選單看得到、點進去被導回儀表板的人。由你決定要不要幫這些角色補「部門檢視」或「部門工作檢視」。 |
| `w21_q10_q11_org_state.sql` | W21 Q10、Q11 | 兩段查詢（分別貼上執行）：停用單位底下還有成員或主管的單位；人員資料部門文字與目前主要部門名稱不一致的人（改名後殘留的舊名稱、停用部門仍有文字）。 |
| `p06_q12_q13_q14_admin_overview.sql` | P06 Q12、Q13、Q14 | 持有「建立使用者」（上線後只剩連到註冊頁）、「變更使用者角色」「指派使用者角色」（授予管理員前會有醒目確認）的人，以及舊式身分是管理員（唯一能重置密碼）和「角色是管理員等級但舊式身分不是管理員」（不能重置密碼）的人。 |
| `w22_q15_registration_overview.sql` | W22 Q15 | 三段唯讀查詢：帳號狀態總覽（信箱驗證、是否登入過、是否有角色）、沒有角色帳號的信箱網域分佈（看有沒有外部信箱）、註冊超過 7 天仍未驗證也沒登入的帳號。公開註冊保留後，用來了解現在有多少自己註冊的空帳號；不刪任何資料。 |
| `w23_calendar_permission_holders.sql` | W23 權限 | 三段唯讀查詢：四個行事曆權限（新增公司行事、修改／取消、匯入假日、Google 管理）的持有者；舊式身分是管理員卻沒被授予某權限的人（舊版畫面會顯示按鈕但儲存被資料庫擋下，新版不顯示）；四個權限碼是否存在。缺的直接在角色上授予，不改程式。 |
| `w23_calendar_schema_probe.sql` | W23 | 三段唯讀查詢：八張行事曆資料表是否都在、個人行程讀取規則與判斷函式的波動性、是否已有個人行程資料。用來判斷正式區「新增個人行程」是否和 DEV 一樣被 RLS 擋下（見下方備註）。 |
| `w23_q21_holiday_state.sql` | W23 Q21 | 各年度目前已發布的假日版本與筆數、被取代過的版本數。 |
| `w24_google_sync_state.sql` | W24 Q19、Q20 | Google 連線狀態（不讀授權金鑰）、連結成功與待重試筆數、尚未同步的有效公司行事與假日。上線後畫面頁頂的「N 筆待同步」應與第 3、4 段加上第 2 段錯誤筆數一致。 |
| `p06_q15_pending_users.sql` | P06 Q15 | 待開通名單（有登入帳號、沒有停用、沒有任何生效角色）。上線後使用者管理的「待開通 N 位」應等於這裡的筆數。 |

## 選用：把誤停用的活動改回啟用（需要寫入）

1. `w19_q2_B_reactivate.sql`：以 `BEGIN;` 開頭，不會自動提交。把要改回啟用的活動 id 填進暫存表，先預覽、備份到 `m5_w19_campaign_backup`、再改，最後一段核對（`still_inactive` 應為 0），確認後另外執行 `COMMIT;`，有疑慮執行 `ROLLBACK;`。
2. `w19_q2_C_rollback.sql`：上線後想撤回，依備份把啟用旗標還原。同樣以 `BEGIN;` 開頭。

## W22 上線前設定檢查（不是 SQL，在 Supabase 後台與主機環境確認）

1. 主機環境變數 `NEXT_PUBLIC_SITE_URL` 必須設定為正式網址（例如 https://xxx.com，不含路徑）。新版缺設定時忘記密碼會直接顯示「系統尚未設定網站網址」，不會再寄出 localhost 連結。
2. Supabase Authentication 的 Redirect URLs 要包含 `<網站>/auth/callback`（重設信連結路徑不變，後台設定不需更動，只需確認仍在清單內）。
3. Supabase Authentication 的最短密碼長度維持 6（Q16 照舊）；是否要求信箱驗證維持現狀。
4. 公開頁轉址目前只在 DEV 工作台環境啟用（middleware.ts 的 isDevWorkspace）；正式切換時才開，開之前舊頁維持不變。
5. 信件測試一律 mock：測試站以 `WORKSPACE_AUTH_MAIL_MOCK=true` 啟動（僅 tests/support/start-test-server.cjs 設定），只對 `@example.test` 信箱生效；正式環境不得設定這個旗標。

## 備註

- W23／W24 的 DEV 結構變更放在 supabase/workspace-dev/20261109110000_m5_w23_annual_calendar.sql、20261109110100_m5_w24_calendar_google_sync.sql（DEV 原本沒有這兩份 migration，內容與 supabase/migrations 的原檔相同）與 20261109110200_m5_w23_personal_event_owner_read.sql，三份都附 .rollback.sql，用 scripts/apply-workspace-m5-w23-calendar-dev.cjs 套用或加 --rollback 回復。正式區舊頁依賴前兩份，理論上已套用，先跑 `w23_calendar_schema_probe.sql` 確認。
- 實測發現（不在問卷範圍）：依舊 migration 建立的規則下，新增個人行程後的回讀會被 RLS 擋下（`new row violates row-level security policy`），新增存不進去；DEV 已用 20261109110200 修正（讀取規則加上「建立者本人一律可讀」）。正式區是否同樣有問題未查證：先跑 `w23_calendar_schema_probe.sql`，確認後才決定要不要套 `w23_personal_event_owner_read_fix.sql`（需寫入，含備份、預覽、BEGIN，另有 `w23_personal_event_owner_read_rollback.sql`）。這兩個檔案都沒有執行過。
- 年度行事曆權限：維持三個獨立權限，以資料庫規則為準。執行 `w23_calendar_permission_holders.sql` 後，缺權限的人由你決定在角色上補授予；程式不改。


- W20 同樣沒有資料庫結構變更，也沒有寫入型 SQL；兩份名單都是唯讀。
- W21、P06 的四份名單同樣全部唯讀（已在 DEV 資料庫跑過確認語法可執行，未在正式區執行）；沒有需要寫入正式區的 SQL。DEV 的結構變更放在 supabase/workspace-dev/20261109100000_m5_w21_org_inactive_members_no_unit_sync.sql（附 .rollback.sql，用 scripts/apply-workspace-m5-w21-org-dev.cjs 套用或 --rollback 回復）：Q10 停用單位仍可調整成員與主管、Q11 移除「部門改名／停用就改寫人員資料部門文字」的 trigger。正式區本來就沒有這個 trigger（規格 Q11 背景：只有成員異動才同步），所以正式區不需要任何對應的 SQL。
- 本批次 W19 沒有資料庫結構變更（沒有新欄位、沒有新函式），所以沒有 DEV 的 migration 與 apply 腳本；Q3 的筆數、Q4 的期間外門市都由 API 直接查詢。
- 實測發現（與 m5-spec 的背景描述不同，已寫進 allowlist 與完成報告）：舊版 `POST /api/campaigns` 在「舊式身分是經理、但角色沒有活動編輯權」時其實也寫不進去（資料庫 RLS 擋下，回 500），不是規格背景所說的「舊版放行」。所以 Q1 真正新舊不同的帳號只有「有活動編輯權、但舊式身分不是管理員或經理」（以及只靠管理員後備放行的人），這就是 `w19_q1_write_permission_diff.sql` 會列出的 `NEW_ONLY` 名單。
- 權限判定一律照正式區 has_permission：`user_roles.is_active` 且未過期、`role_permissions.is_allowed`、`permissions.is_active`，不檢查 `roles.is_active`，資料庫端沒有 admin 放行。
