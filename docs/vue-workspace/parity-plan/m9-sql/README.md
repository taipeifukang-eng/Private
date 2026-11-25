# M9 正式區 SQL 草稿

這個資料夾只放「草稿」，**尚未套用到正式區**。DEV 版在 `supabase/workspace-dev/`（含 `.rollback.sql`），不碰 `supabase/migrations/`。
上線前要轉成正式 migration，並由人確認後才能套用。

## 全部正式區執行順序總表（2026-11-24 審查後）

這是「整個正式區上線」的唯一順序依據：把既有 m2～m8、w03 草稿與 m9 新草稿排在一起。每一步先看「性質」：**唯讀** = 只有 SELECT；**新增** = 只建立新物件、不動既有資料；**新增＋改既有** = 建立新物件，同時覆蓋既有函式／約束／政策，或函式日後會改寫人員資料；**改既有資料** = 會改既有資料、函式或政策。所有 SQL 都由人在正式區 SQL Editor 單獨貼上執行，不由程式自動跑；m9 每份主檔都可重複執行。

順序規則（資料庫相依，不能換）：

- 55 → 90 → 50：55 與 90 都會替換 `update_inspection_bonus_total`，要先 55、再 90（評級改讀 snapshot）；50 的儲存函式會讀 90 建立的設定版本表。檔名序號是依 DEV 時間編的，**實際順序以本表為準**。
- 20 → 60：60 要改寫 20 建立的 `workspace_save_task_template`。
- m2 步驟 A → 15：15 開頭檢查 `store_employees.newbie_level` 必須已存在。
- 06（步驟 18）→ 07（步驟 38）→ 督導日誌軟刪除（步驟 39）→ 語音 AI（步驟 40）：07 的前置檢查要求 7 個督導日誌權限碼已由 06 建立；39 與 40 依賴 07 建的資料表（語音 AI 有外鍵參照 supervisor_management_records，所以還原時要先還原語音 AI 再還原 07）。
- 08（步驟 43，QR 作廢觸發器）要在總務第 2 批之前；它刻意不含舊版的回填 UPDATE，先跑 08 的 .preview.sql 看待回填筆數，由老闆決定要不要另外回填。
- 09（步驟 44，舊版庫存與附件補漏）要在總務第 2 批「設施上線貼標」（步驟 48，m7m8 22）之前：22 開頭有 md5 守衛，要求 ga_resource_attachment_can_manage 的內容 md5 = 41a29efc4e62b01a7ce8f7d0fce9eead，也就是 09 建立的版本；正式區現在是更舊的版本，不先做 09，22 會自己中止。庫存過帳函式的 ON CONFLICT 修正也要在總務第 3 批庫存過帳（步驟 54）實際使用之前完成，所以放在總務階段開頭、第 1 批之前。09 重跑時若函式已含後面步驟（22、水電帳單、附件類型）的內容會略過，不會蓋掉它們。
- 00b、00c、00d（步驟 15、16、17）是唯讀檢查，可以隨時重跑。**07、08、09（步驟 38、43、44）都做完後**再各跑一次，預期結果：00b 只剩選用的 pg_cron（pg_cron 啟用後就是全齊）；00c 的督導日誌（5 支）與 QR 作廢（1 支）整支沒套用的項目消失；00d 的 missing 從 18 項降到只剩 4 項（維修回報 p1e_ 政策 1 項，正式區是全開政策、不屬漏套用，待老闆決定；總務角色矩陣授權 3 項，由權限勾選頁與授權步驟決定），庫存 6 項、附件 2 項、督導日誌 6 項都應消失。00d 是 00c 的補充：00c 只能確認物件存在，查不出「只改函式內容、授權、約束、資料」的 32 支舊版 migration 有沒有套用，00d 對這些逐支挑記號比對；結果的 missing 裡 superseded_by 是 null 的項目才是真的沒套用，有寫 superseded_by 的是後面步驟會蓋掉、缺了無妨。
- 10、15、30、65 → 80：80 的前置檢查會逐一確認；65 在執行調店確認／更正時又會呼叫 80 的名冊重算，所以 65 與 80 要在 API 切到新版前一起套完。重跑 30 會把 `workspace_apply_due_promotions` 蓋回簡化版，重跑後要再跑一次 80。
- 備份檔緊貼著主檔前一刻執行（30、60、65、80 各有 `.backup.sql`；備份表名稱不同，不會互相覆蓋）。預覽檔（`.preview.sql`）同樣在套用前看。
- 還原順序與套用順序相反：80 → 65 → 30 → 15 → 50 → 90 → 55 → 60 → 20 → 40 → 70 → 10 → 備援開關。

| 步驟 | 檔案 | 做什麼 | 性質 | 需備份 | 對應 rollback | 對應 verify／預覽 |
|---|---|---|---|---|---|---|
| **階段 0　上線前唯讀檢查（只有 SELECT，可全部先跑）** | | | | | | |
| 1 | `m9-sql/05_legacy_covered_check.verify.sql` | DEV 有、但由舊版 migration 涵蓋的項目（盤點版本欄位、處方箋月報、獎金欄位、年度行事曆、組織表、權限碼、has_permission 語意）正式區是否都在 | 唯讀 | 否 | - | 本身就是檢查 |
| 2 | `m2-sql/check_position_mismatch.sql` | 員工主檔職位和最新升職異動不一致的名單 | 唯讀 | 否 | - | - |
| 3 | `m3-sql/compare_task_proxy_access.sql` | 開啟他人任務：舊版可、新版不可的人 | 唯讀 | 否 | - | - |
| 4 | `m3-sql/grant_task_view_archived_A_preview.sql` | 哪些主管缺 task.view_archived | 唯讀 | 否 | - | - |
| 5 | `m3-sql/grant_task_manage_A_preview.sql` | 要補 task.manage 的名單預覽（先在檔內填名單） | 唯讀 | 否 | - | - |
| 6 | `m4-sql/w17_A_preview.sql` | 改善回補函式現況與 UTC 少算一天筆數 | 唯讀 | 否 | - | - |
| 7 | `m4-sql/w18_A_preview.sql` | 評級對照與寫死值是否相同、範本總分 | 唯讀 | 否 | - | - |
| 8 | `m4-sql/w17_D_reporter_diff.sql` | 舊版能回報改善、新版不能的人 | 唯讀 | 否 | - | - |
| 9 | `m5-sql/` 15 份：w19_q1、w19_q2_inactive、w19_q4、w19_q5、w20_q7_entry_audit、w20_q7_buttons_preview、w21_q9、w21_q10_q11、p06_q12_q13_q14、w22_q15、w23_calendar_permission_holders、w23_calendar_schema_probe、w23_q21、w24、p06_q15 | 活動排程、活動檢視入口、部門入口、使用者與角色、註冊、年度行事曆與 Google 同步的上線前名單 | 唯讀 | 否 | - | - |
| 10 | `m6-sql/inventory-perm-check.sql` | 盤點各權限持有人數、上線後會失去匯入或刪除的人 | 唯讀 | 否 | - | - |
| 11 | `m7m8-sql/00-readiness-check.sql` | 總務上線準備度（資料表、RLS、函式、儲存空間） | 唯讀 | 否 | - | - |
| 12 | `m7m8-sql/11-g01-preview-before-apply.sql` | 第 1 批套用前現況 | 唯讀 | 否 | - | - |
| 13 | `m7m8-sql/12-g02-disabled-categories-with-active-items.sql` | 已停用但底下仍有啟用項目的分類名單 | 唯讀 | 否 | - | - |
| 14 | `m7m8-sql/13-g03-parts-stock-and-duplicates.sql` | 料件庫存與完全重複名單 | 唯讀 | 否 | - | - |
| 15 | `m9-sql/00b_prod_object_presence.readonly.sql` | 正式區「新版依賴、但步驟自己不會建」的 239 個物件逐一確認有沒有（缺什麼列什麼；pg_cron 為選用）。2026-11-25 老闆已跑過一次，缺 9 項，缺的由 38、43 補建與 pg_cron 啟用步驟處理 | 唯讀 | 否 | - | 本身就是檢查（結果貼回給 Claude） |
| 16 | `m9-sql/00c_prod_legacy_migration_coverage.readonly.sql` | 舊版 supabase/migrations 每一支 migration 建立的東西，正式區有沒有（依 migration 彙總「整支沒套用」或「只缺一部分」） | 唯讀 | 否 | - | 本身就是檢查（結果貼回給 Claude） |
| 17 | `m9-sql/00d_prod_legacy_content_markers.readonly.sql` | 00c 查不出的 32 支舊版 migration（只改函式內容、授權、約束、資料）逐支挑 1～3 個「套用後才會成立」的記號，比對正式區現況（函式內容、EXECUTE 授權、約束、欄位型別與註解、權限授與、種子資料）；缺的標明會被哪個後續步驟蓋掉。純資料修補（20261005120000）無法以唯讀判斷，改列還會被它改動的筆數 | 唯讀 | 否 | - | 本身就是檢查（結果貼回給 Claude） |
| **階段 1　M9 資料庫草稿（工作台新版 RPC）** | | | | | | |
| 18 | `m9-sql/06_missing_permission_codes.sql` | 補建 11 個權限碼（只建立、不授權）：inventory.result_analysis.delete、supervisor.management_log.* 6 碼、supervisor.management_category.manage、activity.support_request.edit、monthly.allowance.view_support_hours、store.clinic_selfpay.mapping.manage。正式區 permissions 表沒有、也沒有其他步驟會建；放在所有授權步驟之前。督導日誌 7 碼對應的資料表由步驟 38（07）補建 | 新增 | 否 | .rollback.sql（只刪本檔建立且沒有任何角色授權的碼） | .verify.sql |
| 19 | `m9-sql/20261123150000_m9_page_fallbacks.sql` | 逐頁「回舊版」備援開關（2 表＋1 函式）。緊接在權限碼補建之後套用，之後任何一頁出問題都能單頁切回舊版 | 新增 | 否 | .rollback.sql（會連稽核紀錄一起刪，要留請先備份稽核表） | .verify.sql（審查時補） |
| 20 | `m2-sql/backfill_employee_stage_A_add_column.sql` | store_employees 加「階段」欄位 newbie_level（可為空） | 新增 | 否 | 無檔（欄位可為空、留著無害；要移除請人工 DROP COLUMN） | 15 的前置檢查會確認欄位存在 |
| 21 | `m2-sql/backfill_employee_stage_B_preview.sql` | 回填階段的預覽 | 唯讀 | 否 | - | - |
| 22 | `m2-sql/backfill_employee_stage_C_backfill.sql` | 依升職異動回填員工階段（只填空值；與 65 的 F 段相同，二擇一即可） | 改既有資料 | 建議（先存 store_employees；可共用 65.backup.sql） | 交易內先 ROLLBACK；COMMIT 後用備份還原 newbie_level | 重跑步驟 B，待回填應為 0 |
| 23 | `m9-sql/10_organization_department.sql` | 組織與部門職掌：2 防重送表＋6 函式 | 新增 | 否 | .rollback.sql | .verify.sql |
| 24 | `m9-sql/70_stores_managers_supervisors.sql` | 門市／店長／督導：5 個 store.store.* 權限碼（只建立、不授權）、1 表、6 函式、停用門市讀取政策 | 新增 | 否 | .rollback.sql（不刪權限碼） | .verify.sql |
| 25 | `m9-sql/40_campaign_version_and_ops.sql` | 活動版本與營運：campaigns 加 2 欄＋版本觸發器、1 表、3 函式、私有 bucket | 新增 | 否 | .rollback.sql（刪欄位前自動備份兩欄；bucket 不用 SQL 刪） | .verify.sql |
| 26 | `m9-sql/20_task_core.sql` | 任務核心：版本欄位／觸發器、5 收據表、5 函式 | 新增 | 否（只加預設 0 的欄位） | .rollback.sql（若已套用 60，先還原 60） | .verify.sql |
| 27 | `m9-sql/60_task_delete_and_proxy.sql` | 任務刪除、協作代理、逐動作代理；字串替換 20 的 workspace_save_task_template（支援人員） | 新增＋改既有 | 是：.backup.sql（備份被改寫函式原文） | .rollback.sql（先把稽核與代做標記複製到備份表） | .verify.sql（前置：20） |
| 28 | `m9-sql/55_improvements_bonus.sql` | 改善加分：替換 5 個函式、重建 5 個觸發器（台灣日期、逾期回補 0、先鎖單、NUMERIC） | 新增＋改既有 | 是：檔內自動備份到 m9_improvements_backup | .rollback.sql（依備份還原） | .verify.sql。取代 m4 w17_B，二擇一 |
| 29 | `m9-sql/90_inspection_settings_grade_snapshot.sql` | 巡店設定版本表、評級門檻 snapshot、替換 update_inspection_bonus_total、回補既有已完成單的 snapshot | 新增＋改既有 | 是：檔內步驟 0 自動備份 | .rollback.sql（優先依備份還原函式；snapshot 會消失） | .verify.sql。取代 m4 w18_B；必須在 55 之後、50 之前 |
| 30 | `m9-sql/50_inspection_write_core.sql` | 巡店寫入核心：inspection_masters／results 加欄位、版本觸發器、workspace_save_inspection | 新增 | 選用（檔頭有備份 SQL） | .rollback.sql（欄位保留；刪欄位的備份與 DROP 以註解提供） | .verify.sql（前置：90） |
| 31 | `m9-sql/15_employee_management.sql` | 員工（生日匯入、新增、編輯、匯入、員編規則、月份需重新確認）：5 表、13 函式、2 個 INSERT 觸發器 | 新增＋改既有 | 否（但先看預覽） | .rollback.sql（空表才刪、共用函式被引用就保留） | .preview.sql（套用前）＋.verify.sql。前置：m2 步驟 A |
| 32 | `m9-sql/30_store_promotions_queue.sql` | 門市升遷申請與生效佇列：2 表、函式、觸發器、pg_cron 排程（有裝才建） | 新增＋改既有 | 是：.backup.sql（3 張人員表整張複製） | .rollback.sql（人員資料用備份手動還原） | .preview.sql（套用前）＋.verify.sql |
| 33 | `m9-sql/65_transfer_confirm_correct_batch.sql` | 調店確認／更正：申請表補欄位、newbie_level、確認紀錄表、更正紀錄表、3 函式、階段回填 | 新增＋改既有 | 是：.backup.sql（整列 jsonb，不覆蓋舊備份） | .rollback.sql（空表才刪；階段欄位依備份還原） | .verify.sql。執行確認／更正時需要 80 的函式 |
| 34 | `m9-sql/80_movement_batch_monthly_roster.sql` | 異動批次與每月人員狀態：月結工具、異動批次、名冊重算（單一真相）、修改刪除異動、名冊頁 RPC；放寬 valid_movement_type | 新增＋改既有 | 是：.backup.sql（4 張人員表＋函式／約束原文） | .rollback.sql（有資料的表與欄位不硬刪） | .preview.sql（套用前現況＋套用後必還原預覽）＋.verify.sql。前置：10、15、30、65 |
| **階段 2　M6（客務／商品／督導日誌／語音）與 W03 處方箋** | | | | | | |
| 35 | `m6-sql/20261121100000_m6_relationship_sales_import.sql` | 關係會員銷售匯入函式（內容相同的明細自動略過） | 新增 | 否 | .rollback.sql | m6 README 注意事項 |
| 36 | `m6-sql/20261122100000_m6_products_master_logs.sql` | 商品主檔操作紀錄表 | 新增 | 否 | .rollback.sql | 同上 |
| 37 | `m6-sql/20261122110000_m6_stockout_rpc.sql` | 缺貨回覆、刪除回報 2 函式 | 新增 | 否 | .rollback.sql | 同上 |
| 38 | `m9-sql/07_legacy_supervisor_management.sql` | 補建舊版督導管理日誌整組（5 支舊 migration 的最終狀態）：6 張表、14 個 supervisor_management_* 函式、5 個驗證觸發器、RLS 政策與 grant。正式區 00b 查出整組沒套用；不建權限碼（步驟 18 的 06 已建）、不授權任何角色。前置：舊版 current_user_has_permission(varchar)、store_managers 等舊表；放在 06 權限碼之後、督導日誌軟刪除與語音 AI 之前 | 新增 | 否（只新增物件，無資料） | .rollback.sql（只有 6 張表都是空的才刪；已套用語音 AI 要先還原語音） | .verify.sql |
| 39 | `m6-sql/20261122130000_m6_supervisor_log_rpc.sql` | 督導日誌軟刪除函式（以呼叫者身分執行，授權 authenticated、service_role） | 新增 | 否 | .rollback.sql | 同上；前置：4 支舊 migration |
| 40 | `m6-sql/20261122133000_m6_voice_ai.sql` | 語音／AI：5 表＋函式（每月上限預設 30 美元） | 新增 | 否 | .rollback.sql | 同上 |
| 41 | `m6-sql/20261123140000_m6_clinic_selfpay_bucket.sql` | 自費診所截圖私有 bucket（同名桶會被改回私有、10MB） | 新增＋改既有 | 先確認既有桶是否私有 | .rollback.sql（注意：用 SQL 刪 bucket 可能被 Storage 保護觸發器擋下，需改走 Dashboard） | 檔尾內建檢查 |
| 42 | `w03-rx-sql/01-prescription-aliases.sql` | 處方箋門市簡稱對照表＋整批匯入函式 | 新增 | 否 | 01-prescription-aliases-rollback.sql | README 套用順序（先套用再部署新版） |
| **階段 3　M7／M8 總務（依該 README 的批次順序；每批先跑預覽，撤回順序相反）** | | | | | | |
| 43 | `m9-sql/08_legacy_qr_revoke_trigger.sql` | 補建舊版「設備報廢／設施退役／刪除時自動作廢 QR」：1 個函式、2 個觸發器（trg_ga_equipment_qr_auto_revoke、trg_ga_facilities_qr_auto_revoke）。刻意不含舊版的回填 UPDATE（會改既有資料），先看預覽再由老闆決定。前置：ga_equipment／ga_facilities 的 status、deleted_at、qr_token_revoked_at 三欄 | 新增 | 否（只新增函式與觸發器） | .rollback.sql | .preview.sql（套用前，看待回填筆數）＋.verify.sql |
| 44 | `m9-sql/09_legacy_inventory_maintenance_attachment.sql` | 補舊版庫存與附件 4 組漏套用（00d 發現、沒有任何步驟會補）：①刪除庫存位置時下層明細原因（20260722055852）；②庫存過帳函式 ON CONFLICT 歧義（20260722094917，不修的話總務第 3 批過帳建第一筆餘額就報錯）；③庫存交易序號與取號、過帳函式的授權收回（20260722091526、20260722092849）；④附件管理判斷函式換成舊版最終版（20260826042500；總務第 2 批（步驟 48，22-b2-onboarding）開頭有 md5 守衛要求這個版本，沒做這步 22 會自己中止）。只改函式與授權，不碰資料、不碰 RLS 政策、不建也不授權權限碼；重跑時若函式已含後面步驟的內容會略過，不會蓋掉。**刻意不補**維修回報 20260727021000 的 p1e_maintenance_requests_read：正式區 maintenance_* 七張表是更早的全開政策（登入者皆可讀寫），改成 p1e_ 政策組會讓沒有總務權限碼的人立刻讀不到，要和授權一起由老闆決定。前置：庫存、設備、設施、需求單、維修回報等舊表（缺就中止） | 改既有資料 | 否（只改函式與授權；正式區現況原文在 .rollback.sql） | .rollback.sql（附件管理判斷只在仍是 09 的版本時才還原；已被後面步驟改過會中止） | .verify.sql |
| 45 | `m7m8-sql/10-g01-catalog-rules.sql` | 第 1 批：11 個 ga_ws_ 函式 | 新增 | 否 | 10-g01-catalog-rules-rollback.sql | 11 預覽＋00 準備度 |
| 46 | `m7m8-sql/20-b2-preview-before-apply.sql` | 第 2 批套用前預覽 | 唯讀 | 否 | - | - |
| 47 | `m7m8-sql/21-b2-asset-events-transfers.sql` | 第 2 批：異動紀錄、轉移單、明細（3 表、1 序號、函式） | 新增 | 否 | 21-…-rollback.sql | 20 預覽 |
| 48 | `m7m8-sql/22-b2-onboarding.sql` | 第 2 批：設施加 6 欄、重定義 1 函式（上線貼標） | 新增＋改既有 | 是（函式原文） | 22-…-rollback.sql | 20 預覽 |
| 49 | `m7m8-sql/23-b2-import-history.sql` | 第 2 批：Excel 匯入批次表與函式 | 新增 | 否 | 23-…-rollback.sql | 20 預覽 |
| 50 | `m7m8-sql/24-b9-block-terminal-with-open-transfer.sql` | 第 2 批：進行中轉移單時擋報廢（1 函式、2 觸發器） | 新增 | 否 | 24-…-rollback.sql | 20 預覽 |
| 51 | `m7m8-sql/25-b6-history-current-store.sql` | 第 2 批：重新定義 2 個函式（簽章不變） | 改既有資料 | 是（函式原文） | 25-…-rollback.sql | 20 預覽 |
| 52 | `m7m8-sql/26-b3-preview-before-apply.sql` | 第 3 批套用前預覽 | 唯讀 | 否 | - | - |
| 53 | `m7m8-sql/27-b3-inventory-rules.sql` | 第 3 批：庫存位置規則函式與觸發器 | 新增 | 否 | 27-…-rollback.sql | 26 預覽 |
| 54 | `m7m8-sql/28-b3-inventory-post.sql` | 第 3 批：過帳 4 函式 | 新增 | 否 | 28-…-rollback.sql | 26 預覽 |
| 55 | `m7m8-sql/29-b3-inventory-transfers.sql` | 第 3 批：調撥（單據加欄、2 表、8 函式） | 新增 | 否 | 29-…-rollback.sql（會刪調撥資料） | 26 預覽 |
| 56 | `m7m8-sql/30-b3-category-keep-inactive.sql` | 第 3 批：重新定義 2 個既有函式 | 改既有資料 | 是（函式原文） | 30-…-rollback.sql | 26 預覽 |
| 57 | `m7m8-sql/31-b4-preview-before-apply.sql` | 第 4 批套用前預覽 | 唯讀 | 否 | - | - |
| 58 | `m7m8-sql/32-b4-request-rules.sql` | 第 4 批：2 表、9 欄；覆蓋既有函式（32 與 33 必須連續套用） | 新增＋改既有 | 是（pg_get_functiondef 備份 4 個被覆蓋函式） | 32-…-rollback.sql | 31 預覽 |
| 59 | `m7m8-sql/33-b4-purchase-orders.sql` | 第 4 批：採購單、核准、11 函式、1 權限碼（只建立、不授權） | 新增 | 同 32 | 33-…-rollback.sql | 31 預覽 |
| 60 | `m7m8-sql/34-b4-receipt-dispatch.sql` | 第 4 批：到貨驗入與配發（4 表、欄位、函式；覆蓋 1 舊函式） | 新增＋改既有 | 是（函式原文） | 34-…-rollback.sql | 31 預覽 |
| 61 | `m7m8-sql/35-b4-asset-transfer-follow.sql` | 第 4 批：資產移轉搬單（1 表、4 函式；覆蓋 2 函式） | 新增＋改既有 | 是（函式原文） | 35-…-rollback.sql | 31 預覽 |
| 62 | `m7m8-sql/36-b5-preview-before-apply.sql` | 第 5 批套用前預覽（第 6、7 區名單要看） | 唯讀 | 否 | - | - |
| 63 | `m7m8-sql/37-b5-work-order-rules.sql` | 第 5 批：工單規則函式（不改表） | 新增 | 否 | 37-…-rollback.sql | 36 預覽 |
| 64 | `m7m8-sql/38-b5-request-supplement-sync.sql` | 第 5 批：覆蓋第 4 批 2 函式（檔頭有 md5 守衛） | 改既有資料 | 是（函式原文） | 38-…-rollback.sql | 36 預覽 |
| 65 | `m7m8-sql/39-b5-work-order-parts.sql` | 第 5 批：領用料件 1 函式 | 新增 | 否 | 39-…-rollback.sql | 36 預覽 |
| 66 | `m7m8-sql/40-b5-work-order-rls.sql` | 第 5 批：收緊 3 條 RLS 政策（驗收並補授權後才執行）。**正式區現況注意（2026-11-25 唯讀查證）**：正式區維修表的政策是更早的全開版（maintenance_requests_read／maintenance_requests_write，登入者皆可讀寫，沒有 p1e_ 前綴），這份只新增 p1e_ 的 update／delete／updates_write 政策，全開的 _write 政策仍在（政策是 OR 關係），所以**這步在正式區不會真的收緊**；要真的收緊，需另做「先授權、再撤掉全開政策」的一份，待老闆決定 | 改既有資料 | 是（先存三條政策現況） | 40-…-rollback.sql | 36 預覽第 6、7 區 |
| 67 | `m7m8-sql/41-b6-preview-before-apply.sql` | 第 6 批套用前預覽 | 唯讀 | 否 | - | - |
| 68 | `m7m8-sql/42-b6-vendor-columns.sql` | 第 6 批：廠商欄位與固定資料（既有廠商 contract_required 一次性改 false） | 新增＋改既有 | 建議（先備份 ga_vendors） | 42-…-rollback.sql | 41 預覽 |
| 69 | `m7m8-sql/44-b6-vendor-functions.sql` | 第 6 批：廠商相關函式（不改表） | 新增 | 否 | 44-…-rollback.sql | 41 預覽 |
| 70 | `m7m8-sql/48-b6-vendor-tax-unique.sql` | 第 6 批：統編唯一索引（有重複會中止） | 新增 | 否 | 48-…-rollback.sql | 41 第 3 區重複須為 0 |
| 71 | `m7m8-sql/47-b6-work-order-vendor-check.sql` | 第 6 批：覆蓋第 5 批 1 個內部函式 | 改既有資料 | 是（函式原文） | 47-…-rollback.sql | 41 預覽 |
| 72 | `m7m8-sql/45-b6-utility-bills.sql` | 第 6 批：水電帳單欄位／索引、改 1 條讀取政策 | 新增＋改既有 | 是（先存 41 第 10 區政策） | 45-…-rollback.sql | 41 預覽 |
| 73 | `m7m8-sql/46-b6-stats-home.sql` | 第 6 批：績效、首頁徽章；文字替換 ga_ws_po_list | 新增＋改既有 | 是（函式原文） | 46-…-rollback.sql | 41 預覽 |
| 74 | `m7m8-sql/49-b6-perf-inline-predicates.sql` | 第 6 批：8 個述詞函式移除 search_path 設定（效能） | 改既有資料 | 否（rollback 設回原值） | 49-…-rollback.sql | 41 預覽 |
| 75 | `m7m8-sql/43-b6-vendor-rls.sql` | 第 6 批：改 3 張表 RLS（最後套用；名單確認前不得套用） | 改既有資料 | 是（先存第 5 區政策） | 43-…-rollback.sql | 41 預覽第 6、7、8 區 |
| 76 | `m7m8-sql/50-b45-preview-before-apply.sql` | 第 4.5 批套用前預覽（沒有 rollback） | 唯讀 | 否 | - | - |
| 77 | `m7m8-sql/51-b45-receipt-voucher.sql` | 第 4.5 批：進貨明細回填未稅金額＋觸發器 | 改既有資料 | 是：zz_bak_b45_receipts／receipt_items（README 有 SQL） | 51-…-rollback.sql | 50 預覽第 2 區 |
| 78 | `m7m8-sql/52-b45-payment-requests.sql` | 第 4.5 批：請款單 3 表、取號函式、1 筆設定 | 新增 | 否 | 52-…-rollback.sql（會刪請款資料） | 50 預覽 |
| 79 | `m7m8-sql/53-b45-vendor-bank.sql` | 第 4.5 批：廠商銀行 4 欄 | 新增 | 否 | 53-…-rollback.sql | 50 預覽 |
| 80 | `m7m8-sql/54-b45-attachment-types.sql` | 第 4.5 批：重建 CHECK、改 2 個共用附件函式 | 改既有資料 | 是（先存 50 第 3 區兩函式全文） | 54-…-rollback.sql | 50 預覽 |
| 81 | `m7m8-sql/55-b45-permissions.sql` | 第 4.5 批：2 個權限碼（只建立、不授權） | 新增 | 否 | 55-…-rollback.sql | 50 預覽第 9 區 |
| 82 | `m7m8-sql/56-b45-functions.sql` | 第 4.5 批：函式（不動資料） | 新增＋改既有 | 否（DEV 已逐字比對） | 56-…-rollback.sql | 50 預覽 |
| 83 | `m7m8-sql/57-b45-analysis.sql` | 第 4.5 批：待請款／分析，文字替換 6 函式 | 新增＋改既有 | 否（rollback 反向替換） | 57-…-rollback.sql | 50 預覽 |
| 84 | `m7m8-sql/58-b45-receipt-void.sql` | 第 4.5 批：作廢進貨（欄位、唯一索引、函式、替換 2 個第 4 批函式） | 新增＋改既有 | 否（rollback 反向替換） | 58-…-rollback.sql | 50 預覽 |
| 85 | `m7m8-sql/59-b45f-vendor-bank-log.sql` | 第 4.5 批追加：廠商銀行異動紀錄（只新增不可改刪） | 新增 | 否 | 59-…-rollback.sql | 50 預覽 |
| 86 | `m7m8-sql/60-b45f-pay-rules.sql` | 第 4.5 批追加：請款規則，文字替換 3 函式 | 改既有資料 | 否（rollback 反向替換） | 60-…-rollback.sql | 50 預覽 |
| 87 | `m7m8-sql/61-b45f-stale-draft.sql` | 第 4.5 批追加：草稿過期，文字替換 3 函式 | 改既有資料 | 否（rollback 反向替換） | 61-…-rollback.sql | 50 預覽 |
| **階段 4　選用／授權類（老闆決定後才做）與「不要執行」的舊草稿** | | | | | | |
| 88 | `m5-sql/w19_q2_B_reactivate.sql` | 把誤停用的活動改回啟用（選用，先填 id；BEGIN 開頭，要另外 COMMIT） | 改既有資料 | 是：檔內備份到 m5_w19_campaign_backup | m5-sql/w19_q2_C_rollback.sql | 檔內最後一段核對 |
| 89 | `m3-sql/grant_task_view_archived_B_grant.sql` | 補授權 task.view_archived（授權類；新規則是授權改用勾選頁，這份由老闆決定要不要用） | 改既有資料 | 是：檔內記錄新增的授權列 | grant_task_view_archived_C_rollback.sql | A 預覽 |
| 90 | `m3-sql/grant_task_manage_B_grant.sql` | 建立 task_proxy_manager 角色並加入名單（授權類，同上） | 改既有資料 | 是：m3_task_manage_grants | grant_task_manage_C_rollback.sql | A 預覽 |
| 91 | `m4-sql/w17_B_apply.sql` | 【不要執行】已被 m9 的 55 取代 | 改既有資料 | - | m4-sql/w17_C_rollback.sql | - |
| 92 | `m4-sql/w18_B_apply.sql` | 【不要執行】已被 m9 的 90 取代 | 改既有資料 | - | m4-sql/w18_C_rollback.sql | - |

合計 **92 步**（唯讀 24、新增 32、改既有資料 18、新增＋改既有 18）。其中階段 1～3 真正會寫入的有 63 步；階段 4 的 5 步是選用或「不要執行」。

---

以下是各組草稿的細節說明。

| 檔案 | 用途 | 對應項目 |
|---|---|---|
| `06_missing_permission_codes.sql` | 補建 11 個權限碼（只 INSERT `permissions`，已存在不動；不授權給任何角色）：`inventory.result_analysis.delete`；督導管理日誌 `supervisor.management_log.{view_own,view_team,create,update_own,follow_up,manage}` 與 `supervisor.management_category.manage`；`activity.support_request.edit`、`monthly.allowance.view_support_hours`、`store.clinic_selfpay.mapping.manage`。這些碼 DEV 有、新版程式會檢查，正式區 permissions 表沒有（2026-11-24 角色盤點），舊版 migration 雖有建但正式區沒套用，總表其他步驟也不會建。督導日誌這 7 碼在舊版與 `supervisor_management_*` 資料表同一支 migration 建立；正式區連資料表都沒有（00b 查出），已由新增的 `07_legacy_supervisor_management.sql`（步驟 38）整組補建，所以步驟 39（督導日誌軟刪除）不會再因缺資料表而報 Missing prerequisite，原本「報錯就停下」的提醒不再需要。 | 2026-11-24 角色盤點補漏 |
| `06_missing_permission_codes.rollback.sql` | 只刪「code 與 description 都和本檔相同、且沒有任何 role_permissions 參照」的碼 | 同上 |
| `06_missing_permission_codes.verify.sql` | 唯讀驗證（只有 SELECT）：11 碼逐一 ok（存在、啟用、module／feature／action 與 DEV 相同） | 同上 |
| `00b_prod_object_presence.readonly.sql` | 上線前唯讀檢查（只有 SELECT）：新版依賴、但步驟自己不會建的 239 個物件（資料表、欄位、函式、觸發器、儲存空間、pg_cron）正式區有沒有。結果是一格 JSON，缺什麼列什麼 | 2026-11-25：老闆在正式區跑過，缺 9 項，查出舊版 migration 有些從沒套用 |
| `00c_prod_legacy_migration_coverage.readonly.sql` | 上線前唯讀檢查（只有 SELECT）：舊版 `supabase/migrations` 每一支建立的物件正式區有沒有，依 migration 彙總「整支沒套用」或「只缺一部分」 | 同上（00b 的延伸） |
| `00d_prod_legacy_content_markers.readonly.sql` | 上線前唯讀檢查（只有 SELECT）：00c 查不出的 32 支舊版 migration（只改函式內容、授權、約束、資料）逐支挑 1～3 個「套用後才會成立」的記號（61 個標記，標記清單人工逐支讀 migration 後寫在 `scripts/m9-coverage/markers.data.cjs`，由 `scripts/m9-coverage/markers.cjs` 產生）。結果列出缺的記號與 superseded_by（後面哪個步驟會蓋掉它）、無法以唯讀判斷的資料修補（20261005120000）及其還會改動的筆數 | 2026-11-25 00c 的延伸（00c 的 unchecked_migrations 32 支） |
| `07_legacy_supervisor_management.sql` | 督導管理日誌整組補建（5 支舊 migration 的最終狀態逐字合併）：6 表（categories、cases、records、followups、case_events、daily_plans）、14 個 `supervisor_management_*` 函式、5 個驗證觸發器、RLS 政策（無 DELETE）、grant。只新增物件、不寫資料；不建權限碼（06 已建）、不授權任何角色。權限語意沿用舊版（放行 admin 與管理員角色碼、檢查 roles.is_active），和正式區 has_permission 不同，需老闆知悉。可重複執行 | 2026-11-25 00b 缺 4 表 3 函式；舊版 20260812093000、153524、154708、155612、20260813063209 |
| `07_legacy_supervisor_management.rollback.sql` | 6 張表都是空的才刪表與 14 個函式，有任何資料就整份中止；已套用語音 AI 要先還原語音 AI | 同上 |
| `07_legacy_supervisor_management.verify.sql` | 唯讀驗證（只有 SELECT）：表、RLS、政策數、索引數、函式與執行權限、觸發器、最終版內容標記逐項 ok | 同上 |
| `08_legacy_qr_revoke_trigger.sql` | QR 作廢觸發器補建：函式 `ga_revoke_asset_qr_on_terminal_status()` 與 `trg_ga_equipment_qr_auto_revoke`、`trg_ga_facilities_qr_auto_revoke`。不含舊版的兩段回填 UPDATE（不改既有資料）；前置檢查 ga_equipment／ga_facilities 與三個欄位。可重複執行 | 2026-11-25 00b 缺 trigger；舊版 20260826030000 |
| `08_legacy_qr_revoke_trigger.preview.sql` | 套用前預覽（唯讀）：設備與設施已報廢、已退役或已刪除但 QR 尚未作廢的筆數；回填 SQL 以註解附在檔尾，由老闆決定 | 同上 |
| `08_legacy_qr_revoke_trigger.rollback.sql` | 移除 2 個觸發器與 1 個函式（不動資料） | 同上 |
| `08_legacy_qr_revoke_trigger.verify.sql` | 唯讀驗證（只有 SELECT）：函式、2 個觸發器（時機、事件、欄位）與前置欄位 | 同上 |
| `09_legacy_inventory_maintenance_attachment.sql` | 舊版庫存與附件補漏（4 組，2026-11-25 正式區 00d 發現沒套用）：刪除庫存位置下層明細原因、過帳函式 ON CONFLICT 改指定約束、庫存交易序號與取號／過帳函式授權收回、附件管理判斷換成舊版最終版（md5 = 41a29efc4e62b01a7ce8f7d0fce9eead，總務第 2 批 22 的守衛要求）。只改函式與授權；不改資料、不碰政策、不建也不授權權限碼；可重複執行，函式已含後面步驟內容時略過。不補維修回報 p1e_ 政策（正式區是全開政策，見步驟 66 的說明） | 2026-11-25 00d；舊版 20260722055852、20260722091526、20260722092849、20260722094917、20260826042500 |
| `09_legacy_inventory_maintenance_attachment.rollback.sql` | 還原成 2026-11-25 正式區唯讀查到的現況原文（函式、序號與函式授權）；附件管理判斷只在仍是 09 版本時才還原，被後面步驟改過會中止 | 同上 |
| `09_legacy_inventory_maintenance_attachment.verify.sql` | 唯讀驗證（只有 SELECT）：12 列（11 項 ok＋1 列參考資訊） | 同上 |
| `20261123150000_m9_page_fallbacks.sql` | 新增 `workspace_page_fallbacks`（逐頁「回舊版」開關，每個頁面種類一列）、`workspace_page_fallback_events`（切換稽核紀錄，只新增）、`workspace_set_page_fallback(text, boolean, text, uuid)`（同一交易寫入目前狀態與稽核紀錄） | M9 F01S，2026-11-23 上線準備問卷 N2 |
| `20261123150000_m9_page_fallbacks.rollback.sql` | 移除上述函式與兩張資料表 | 同上 |
| `20261123150000_m9_page_fallbacks.verify.sql` | 唯讀驗證（只有 SELECT）：RLS、無政策、稽核表只有 SELECT／INSERT、函式只給 service_role（2026-11-24 審查補上，主檔未動） | 同上 |
| `05_legacy_covered_check.verify.sql` | 上線前唯讀檢查：DEV 有、但由舊版 migration 涵蓋而不需新草稿的項目，正式區是否都在（盤點版本欄位、處方箋月報、獎金欄位、年度行事曆八表、組織表與權限碼、`has_permission` 語意） | 2026-11-24 審查補上 |
| `15_employee_management.sql` | 員工（生日匯入、新增、編輯、匯入、員編規則、月份需重新確認）：6 份 DEV 檔合併成最終狀態。新增 4 張請求去重回執表、`monthly_staff_recheck`、13 個函式，以及 `employee_movement_history`、`monthly_staff_status` 上的員編規則觸發器 | 員工群（DEV 20261029090000～20261105200100） |
| `15_employee_management.preview.sql` | 套用前預覽（唯讀）：既有不合規員編、舊版手動新增與入職異動近期受影響筆數、重複員編、同名物件 | 同上 |
| `15_employee_management.rollback.sql` | 移除觸發器與函式；資料表只有空表才移除，被其他函式引用的共用函式會保留 | 同上 |
| `15_employee_management.verify.sql` | 套用後驗證（唯讀） | 同上 |
| `50_inspection_write_core.sql` | 巡店寫入核心：inspection_masters 新增 workspace_version／workspace_write_id／workspace_write_hash、inspection_results 新增 workspace_quantities、版本觸發器 trg_workspace_inspection_version、`workspace_save_inspection(...)`（合併 DEV 20261028010000 與 20261105190000 最終狀態，含設定版本檢查與 GPS 寫入；只授權 service_role） | 巡店新版寫入。前置：20260911093000、20261105180000、巡店設定組（workspace_inspection_settings_revision） |
| `50_inspection_write_core.rollback.sql` | 移除函式與觸發器；欄位預設保留（刪欄位的備份與 DROP 以註解提供） | 同上 |
| `50_inspection_write_core.verify.sql` | 唯讀驗證（只有 SELECT） | 同上 |
| `40_campaign_version_and_ops.sql` | campaigns 加 workspace_version／workspace_request_id、唯一索引、版本觸發器；冪等紀錄表 workspace_campaign_requests；活動營運 3 個函式；私有 bucket campaign-department-assets | 組「活動版本與營運」（DEV：20261027120000 campaigns 部分、20261030000000）。不需備份，不新增也不授權權限碼 |
| `40_campaign_version_and_ops.rollback.sql` | 還原（刪欄位前先備份兩欄與請求表） | 同上 |
| `40_campaign_version_and_ops.verify.sql` | 唯讀驗證（只有 SELECT） | 同上 |

注意事項

- 兩張表都啟用 RLS 且沒有任何政策，`anon`、`authenticated` 不可讀寫；只由 workspace API 以 `service_role` 存取。函式只授權給 `service_role`。
- 新版程式部署時若表還不存在：session 讀不到備援表就視為「沒有任何頁面切回舊版」（選單全部開新版），不會讓整個工作台壞掉；只有「頁面回舊版設定」管理頁的儲存會失敗（503）。所以順序不拘，但要用開關前必須先套用本檔。
- 還原後（執行 rollback）所有頁面回到「開新版」，舊版頁面與資料不受影響。
- 不涉及權限碼：管理頁與 API 只認系統管理員（`profiles.role = 'admin'` 或管理員類角色，應用層判斷，與 AI 用量設定相同），沒有新增 `permissions` 資料。
- 正式區 `has_permission` 語意與 DEV 不同（不檢查 `roles.is_active`），本檔不涉及權限判斷。
- 稽核表 `workspace_page_fallback_events` 在資料庫層只授予 `service_role` 讀取與新增（SELECT、INSERT），沒有 UPDATE、DELETE，API 無法竄改切換歷史。注意：執行 rollback 會連同兩張表（含稽核紀錄）一起移除，還原前若要保留切換歷史，請先備份稽核表。

## 正式區草稿（兩位數序號，依 DEV 時間順序，間隔 10）

| 檔案 | 用途 | 需備份 |
|---|---|---|
| `20_task_core.sql` | 任務核心：assignments／templates 加 `workspace_version`、版本觸發器、5 張重送去重收據表、5 個 workspace_* 任務函式（存檔、複製封存、封存、存範本、派發）。合併 DEV 20261028050000～090000。不授權任何角色，無權限碼 | 否（只新增欄位預設 0，不改既有資料） |
| `20_task_core.rollback.sql` | 移除上述觸發器、函式、收據表、版本欄位 | - |
| `20_task_core.verify.sql` | 唯讀驗證（只有 SELECT） | - |

## 30_store_promotions_queue（門市升遷申請與生效佇列）

合併 DEV `20261028150000_vue_store_promotions` 與 `20261028160000_vue_promotion_activation`。會碰到既有人員資料（函式使用時更新 store_employees、monthly_staff_status），套用前先跑 `.backup.sql` 與 `.preview.sql`。檔案：`30_store_promotions_queue.sql`、`.backup.sql`、`.preview.sql`、`.rollback.sql`、`.verify.sql`。不授權任何角色；排程只在已安裝 pg_cron 時建立。

## 70_stores_managers_supervisors（門市、店長與督導）

合併 DEV `20261028120000_vue_store_managers`、`20261028130000_vue_supervisors`、`20261028140000_vue_stores`、`20261028170000_vue_store_map_inactive`、`20261029160000_vue_supervisor_primary_choice`。只新增物件，不改既有資料，不需備份。

| 檔案 | 用途 |
|---|---|
| `70_stores_managers_supervisors.sql` | 補 5 個 `store.store.*` 權限碼（只建立，不授權任何角色）、`workspace_store_requests` 冪等表、6 個 workspace 函式（門市清單／沿革／異動、店長指派、督導與代理、督導主責選擇）、`workspace_can_read_inactive_store()` 與 stores 的 `workspace_store_inactive_read` 政策 |
| `70_stores_managers_supervisors.rollback.sql` | 移除政策、函式、`workspace_store_requests`；不刪權限碼 |
| `70_stores_managers_supervisors.verify.sql` | 唯讀驗證（只有 SELECT） |

與 DEV 的差異：停用門市讀取只認 `has_permission(store.store.view_inactive)` 或 `store.manage`，不沿用 DEV 的「admin 角色代碼且 roles.is_active」繞過分支（正式區 has_permission 無 admin 繞過、不檢查 roles.is_active）。

## 10 組織與部門職掌（草稿，尚未套用）

| 檔案 | 用途 |
|---|---|
| `10_organization_department.sql` | 新增 `workspace_organization_requests`、`workspace_department_requests` 兩張防重送表（RLS 開、只給 service_role）與 6 個函式：`workspace_organization_snapshot／catalog／save`（save 為 M5 W21 最終版）、`workspace_department_version／catalog／save`。只新增物件，不動既有資料 |
| `10_organization_department.rollback.sql` | 移除上述 6 函式與 2 表（不動舊版組織／work_* 表與權限碼） |
| `10_organization_department.verify.sql` | 唯讀驗證（只有 SELECT） |

- 不需備份（只新增物件）。不新增權限碼（組織 8 碼、部門工作台 2 碼正式區舊版已有），也不授權給任何角色，授權之後用勾選頁決定。
- DEV 的 `workspace_organization_unit_sync_profiles` 觸發器已在 M5 W21 移除，最終狀態不存在，本草稿不建立（僅防禦性 DROP IF EXISTS）。
- 舊版組織／work_* 表在正式區 RLS 關閉、`anon`／`authenticated` 有授權（舊版設定），本草稿不更動；新函式一律只給 `service_role`。

## 60 任務 M3（刪除、協作代理、逐動作代理）

| 檔案 | 用途 | 需備份 |
|---|---|---|
| `60_task_delete_and_proxy.sql` | 任務 M3：刪除稽核表與 `workspace_assignment_progress_complete`／`workspace_delete_assignment`／`workspace_delete_template`；以字串替換方式讓 20_task_core 的 `workspace_save_task_template` 支援 `support_users` 跨部門支援人員；`logs.proxy` 欄位與 `workspace_save_task_v2`（逐動作代理）。合併 DEV 20261107120000～150000 的最終狀態。需先套用 20_task_core。不授權、不建權限碼（task.manage 等正式區已有） | 是（先跑 backup，備份被改寫函式原始碼） |
| `60_task_delete_and_proxy.backup.sql` | 把被改寫函式現行原始碼存入 `m9_backup_m3_functions` | - |
| `60_task_delete_and_proxy.rollback.sql` | 移除上述物件，並先把刪除稽核與代做標記複製到備份表；支援人員改寫還原回僅限所選部門 | - |
| `60_task_delete_and_proxy.verify.sql` | 唯讀驗證（只有 SELECT） | - |

## 55 巡店改善追蹤與加分

| 檔案 | 用途 | 需備份 |
|---|---|---|
| `55_improvements_bonus.sql` | 以正式區現行函式為基礎，替換 `calculate_improvement_bonus`（台灣日期算天數、回報日超過期限回補 0）、`update_inspection_bonus_total`（先鎖單、基礎分改 NUMERIC、門檻維持舊版寫死值），另外 3 個函式只加 `search_path`；5 個觸發器同交易內重建；`inspection_bonus_config` 僅在整張表為空時種入 3 條預設規則。合併 DEV 20261028020000＋20261108100000 的最終狀態，取代 `m4-sql/w17_B_apply.sql`（兩者擇一）。評級 snapshot（DEV 20261107160000）須排在本檔之後。不授權、不建權限碼 | 是（檔內自動備份到 `m9_improvements_backup`） |
| `55_improvements_bonus.rollback.sql` | 依備份還原 5 個函式與 5 個觸發器，刪除本檔當初種入的預設規則 | - |
| `55_improvements_bonus.verify.sql` | 唯讀驗證（只有 SELECT） | - |

## 90 巡店範本與評級設定（含評級門檻 snapshot）

| 檔案 | 用途 | 需備份 |
|---|---|---|
| `90_inspection_settings_grade_snapshot.sql` | 設定版本表與儲存收據表、`workspace_bump_inspection_settings`／`workspace_save_inspection_settings`、三張設定表的版本觸發器；`inspection_masters.grade_thresholds` 欄位與評級 snapshot 函式、兩個 BEFORE 觸發器；替換既有 `update_inspection_bonus_total`（評級改讀 snapshot）；回補既有已完成單的 snapshot；對照表／加分設定為空時才種入預設。合併 DEV 20261028030000、040000（設定版本表部分）、20261107160000。不授權、不建權限碼 | 是（檔內步驟 0 自動備份函式原文與兩張設定表到 `m9_inspection_settings_backup`） |
| `90_inspection_settings_grade_snapshot.rollback.sql` | 移除上述物件、還原舊版 `update_inspection_bonus_total`、移除 `grade_thresholds`（snapshot 會消失） | - |
| `90_inspection_settings_grade_snapshot.verify.sql` | 唯讀驗證（只有 SELECT） | - |

- 套用順序：必須在 `50_inspection_write_core` 之前（50 的儲存函式會讀本檔建立的設定版本表）。檔名序號依 DEV 時間編，實際套用順序請排成 90 -> 50。
- 風險：上線後任何寫入巡店單總分／狀態的路徑（含舊版網站）評級都以資料庫對照表為準；套用前先看 verify 第 6 項。

員工群（15_employee_management）注意事項

- 前置條件：`store_employees.newbie_level` 必須已存在（`m2-sql/backfill_employee_stage_A_add_column.sql`），缺少時主檔直接中止。
- 不需備份：沒有任何既有 `workspace_*` 函式會被覆蓋，也不改既有資料列。
- 風險：兩個觸發器（只管 INSERT）會讓舊版「入職異動」「每月人員狀態手動新增」在員編不合規（含 FKI、留空）時失敗，且手動新增列的 `employment_type` 會被強制依員編。套用前先跑 preview；若要先不擋，可單獨 DROP 兩個觸發器。
- 不新增權限碼、不授權給任何角色。

## 65_transfer_confirm_correct_batch（調店確認、更正與批次調店）

| 檔案 | 用途 | 對應項目 |
|---|---|---|
| `65_transfer_confirm_correct_batch.backup.sql` | 備份 `store_employees`、`store_transfer_requests`、`store_transfer_confirmations`（整列 jsonb，不覆蓋舊備份） | 套用主檔前先跑 |
| `65_transfer_confirm_correct_batch.sql` | 申請表補欄位、`store_employees.newbie_level`、`store_transfer_confirmations`（一申請一筆）、`workspace_transfer_corrections`、`workspace_transfer_snapshot`／`workspace_transfer_confirm`／`workspace_transfer_correct` 最終版、階段回填 | DEV 7 支（20261029110000～20261029220000、20261106200000 調店部分、20261107100000） |
| `65_transfer_confirm_correct_batch.rollback.sql` | 移除 3 支函式、還原階段欄位值、空的新表才移除 | 同上 |
| `65_transfer_confirm_correct_batch.verify.sql` | 唯讀驗證（只有 SELECT） | - |

- 需備份：會刪除（若已存在）重複的確認紀錄、回填 `newbie_level`。
- 權限：依正式區 `has_permission`（不看 `roles.is_active`、DB 端無 admin 放行）；確認／更正都要被授予既有的 `employee.store_transfer.confirm`，本檔不建立也不授權任何權限碼。
- 依賴：`workspace_acting_active`、`workspace_roster_recompute`（名冊重算草稿）須先套用，否則確認／更正執行時失敗。批次調店在 `workspace_movement_save`（異動批次草稿），本檔只提供它需要的欄位。
- 風險：管理員（`profiles.role='admin'`）若未被授予 `employee.store_transfer.confirm` 仍會被擋；不再有 DEV 的角色代碼白名單。

## 80 異動批次與每月人員狀態（草稿，尚未套用）

合併 DEV `20261029180000_vue_monthly_tools`、`20261029230000_vue_movement_batch`（最終版取 `20261106200000_p02_d_batch_transfer`）、`20261103010000_vue_monthly_bonus_block`（正式區已有等價版本，不替換）、`20261106100000_w06_roster_recompute`、`20261106110000_w06_c_movement_edit_delete`、`20261107110000_monthly_roster_page`。會碰到既有人員資料（函式使用時改寫每月人員名冊、員工主檔、異動歷史、調店申請），套用前先跑 `.backup.sql` 與 `.preview.sql`。

| 檔案 | 用途 | 需備份 |
|---|---|---|
| `80_movement_batch_monthly_roster.sql` | 月結工具 3 函式；異動批次（放寬 `valid_movement_type` 加入 `acting_manager`、`workspace_movement_requests`、snapshot／save／preview）；名冊重算（`movement_hint` 欄位、`monthly_staff_adjustment_log`、`workspace_roster_recompute` 等 9 個函式與到期升職套用）；修改／刪除異動 3 函式；名冊頁 RPC（SECURITY INVOKER）。不授權任何角色、不建權限碼 | 是 |
| `80_movement_batch_monthly_roster.backup.sql` | 備份 4 張人員表（＋需重新確認清單）與會被取代函式／約束的原始碼，內含還原範例（註解） | - |
| `80_movement_batch_monthly_roster.preview.sql` | 第一部分套用前現況（唯讀）；第二部分套用後預覽指定月份重算會改什麼（一律 RAISE EXCEPTION 還原，不寫入） | - |
| `80_movement_batch_monthly_roster.rollback.sql` | 移除函式；有資料的表與欄位不硬刪；約束還原成 7 種（已有 acting_manager 資料時保留） | - |
| `80_movement_batch_monthly_roster.verify.sql` | 唯讀驗證：物件與權限，以及逐月檢查（重複列、區塊、離職後仍在名冊、入職缺列、職位不一致） | - |

- 前置：10（組織表）、15（`monthly_staff_recheck`、`workspace_monthly_recheck_add`、`workspace_staff_month_locked`）、30（升遷 snapshot／save、`workspace_promotion_activation`）、65（調店欄位與確認／更正）。缺任何一項，檔首檢查會中止。
- 與其他草稿的重疊：`workspace_apply_due_promotions` 在 30 與 80 都有定義，80 的是最終版（走單一名冊重算），套用順序 30 → 80；重跑 30 後要再跑 80。`workspace_transfer_correct` 由 60 提供，80 不重複定義。
- 區塊計算：正式區 `calculate_bonus_block`（9 參數）、`update_calculated_block`、`trigger_update_calculated_block` 與 DEV 邏輯相同，80 不替換、不動其權限（正式區現行 anon 也有 EXECUTE，DEV 版會 REVOKE anon）。
- 權限語意依正式區 `has_permission`（不檢查 `roles.is_active`、DB 端無 admin 繞過）。所有 `workspace_*` 函式只給 `service_role`，只有 `workspace_monthly_roster_page` 為 SECURITY INVOKER 並給 `authenticated`（沿用呼叫者的 RLS，不放大權限）。

## 2026-11-24 審查紀錄（對照 `supabase/workspace-dev/` 與 `supabase/migrations/`、`schema-intake/production-public.schema-only.sql`）

審查範圍：本資料夾 13 組草稿（10、15、20、30、40、50、55、60、65、70、80、90、備援開關）的主檔、rollback、verify、backup、preview。全程只讀寫檔案，沒有連任何資料庫。

做了哪些比對

- **有沒有漏物件**：用腳本把每組對應的 DEV 檔「最後一次定義」的函式、資料表、索引、觸發器、政策、欄位逐一比對；函式本體標準化空白後逐字比對。結果：15、20、30、40、50、55、80（異動批次）逐字相同；10 只差 DEV 已移除的單位同步觸發器（本來就不該建）；60 的兩個刪除函式是「DEV 用字串替換、草稿直接寫最終版」，內容等價；65、70 只差刻意改成正式區權限語意的那一段。DEV 有而草稿沒有的物件，都已確認是正式區舊版 migration 已有（組織四表、work_* 三表、updated_at／防循環／同步部門觸發器、組織與部門職掌 10 個權限碼、`inspection_no`／`client_request_id` 與唯一索引、`inspection_grade_mapping`、`store.manage`、`employee.store_transfer.confirm`）。這些「前置物件」現在由 `05_legacy_covered_check.verify.sql` 一次檢查。
- **順序相依**：以函式／資料表互相引用做相依分析，只有 5 組跨檔相依（50→90、60→20、65↔80、80→15／30、10→舊版組織表），都已寫進總表的順序規則；另外補查出 55→90 的順序（見下）。
- **可重複執行**：所有頂層 CREATE／ALTER／INSERT 都是 IF NOT EXISTS、CREATE OR REPLACE、ON CONFLICT 或先 DROP 再建；掃描沒有例外。
- **verify 是否只有 SELECT**：所有 `.verify.sql` 與 `.preview.sql` 逐檔檢查，沒有寫入語句（80 的 preview 第二部分一律 RAISE EXCEPTION 還原）。
- **授權**：全部草稿只授權 `service_role`。僅有的例外是為了讓政策或 SECURITY INVOKER 函式能運作而給 `authenticated` 執行權：`workspace_can_read_inactive_store`（70）、`workspace_extract_store_code`、`workspace_monthly_roster_page`（80），都與 DEV 相同、沒有授權任何權限碼給任何角色。沒有任何草稿寫入 `role_permissions`、`roles`、`user_roles`；唯一新增的權限碼是 70 的 5 個 `store.store.*`（只建立）。
- **roles.is_active 與 admin 繞過**：資料庫函式裡沒有檢查 `roles.is_active`，也沒有以角色代碼放行；65 的權限段已改成只認 `employee.store_transfer.confirm`，70 的停用門市讀取已拿掉 DEV 的角色代碼分支。

發現並已修正

1. **40 rollback 會整個失敗**：原本用 `DELETE FROM storage.buckets` 刪 bucket，Supabase 的 Storage 保護觸發器不允許直接刪，整個還原交易會被擋下。已改成不刪 bucket（留著無害，只丟 NOTICE，要刪走 Dashboard／Storage API）。
2. **90 rollback 會洗掉 55 的改善**：原本還原 `update_inspection_bonus_total` 一律寫回「正式區最原始版本」；若照順序先套了 55，還原 90 後等於把 55 一併洗掉。已改成優先用備份表（那是套用 90 之前的版本），找不到備份才退回原始版本。
3. **55 與 90 的順序沒有說清楚**：兩份都會替換同一個函式，若先 90 再 55，評級 snapshot 會被蓋掉。已在 90 檔頭與本檔順序規則寫明 55 → 90 → 50，並註明 90 取代 m4 的 `w18_B_apply.sql`（與 55 取代 `w17_B_apply.sql` 一樣二擇一）。
4. **編號殘留**：80 的檔頭、前置說明、錯誤訊息與 rollback 仍寫「草稿 60」（調店草稿後來改為 65）；15 檔頭寫成「草稿 10」；65 rollback 引用不存在的 `60_..backup.sql`；80 檔頭與 rollback 說 30 會呼叫名冊重算（實際只有 65）；本檔 80 的前置寫「60」。全部改正。
5. **verify 缺漏**：20 的版本觸發器函式 `workspace_task_child_version` 等、80 的 `workspace_extract_store_code` 沒有驗證列；備援開關草稿根本沒有 verify。已補（備援開關主檔與 rollback 內容未動，新增獨立的 `.verify.sql`）。
6. **20 rollback 順序提醒**：若已套用 60，必須先還原 60（60 的 `workspace_save_task_v2` 要寫 20 的收據表）。已在檔頭補上。
7. **補一份前置檢查 `05_legacy_covered_check.verify.sql`**：DEV 有 5 支遷移（盤點再次報表版本、處方箋月報、獎金相容欄位、年度行事曆 W23／W24、個人行程讀取修正）不需新草稿，但要確認正式區真的已有；另外確認 `has_permission` 沒有 admin 繞過、不檢查 `roles.is_active`（草稿的共同假設）。

審查後仍保留、但要老闆知道的行為（不是錯誤）

- 65 的確認／更正：`profiles.role = 'admin'` 若沒被授予 `employee.store_transfer.confirm`，資料庫端會擋（DEV 對 `profiles.role = 'admin'` 是放行的）。通過權限後，管理員仍可「代確認」（留 `is_proxy` 紀錄）；這是範圍判斷，不是權限繞過。
- 15 的兩個 INSERT 觸發器會讓舊版「入職異動」「每月人員狀態手動新增」在員編不合規時失敗（先看 `.preview.sql`）。
- 90 上線後，任何寫入巡店總分／狀態的路徑（含舊版網站）評級都以資料庫對照表為準。
- 55 逾期回報回補 0、改按台灣日期算天數，是新行為。
- 30 的 pg_cron 排程只在已安裝時建立；沒裝就要手動呼叫 `workspace_apply_due_promotions()`。
- 既有 m6 草稿 `20261123140000_m6_clinic_selfpay_bucket.rollback.sql` 也是用 `DELETE FROM storage.buckets` 刪桶，同樣可能被 Storage 保護觸發器擋下（本次審查範圍是 m9，沒有動它；要用時請改走 Dashboard）。

## 需要老闆決定的事

1. **誰能確認／更正調店**：先用權限勾選頁把 `employee.store_transfer.confirm` 授權給管理員角色與督導角色，再開新版調店頁；否則管理員也會被擋（65）。
2. **誰能看停用門市、門市管理**：70 新建的 5 個 `store.store.*` 權限碼沒有授權任何人，要在勾選頁授權；管理員角色已有 `store.manage`，仍讀得到停用門市。
3. **15 的員編規則要不要先擋**：先跑 `.preview.sql`；若舊版近期仍有不合規員編的入職或手動新增，決定要不要先不裝那兩個觸發器。
4. **評級以誰為準（90）與逾期回補 0（55）**：上線當下對照表若與舊版寫死值不同，舊版新單的評級會跟著對照表走；看 90 verify 第 6 項再決定。
5. **要不要安裝 pg_cron（30）**：不裝就沒有自動生效的未來升遷，要人工呼叫。
6. **m3 的兩份補授權草稿**：新規則是「授權由勾選頁決定」，`grant_task_view_archived_B_grant.sql`、`grant_task_manage_B_grant.sql` 是舊的 SQL 補授權，請決定改用勾選頁或照舊執行。
7. **既有 m6 自費診所截圖桶**：套用前確認正式區那個桶是私有；改回私有後，用公開網址讀截圖的地方會失效（新舊版都用簽名網址不受影響）。
8. **維護窗口與備份**：30、65、80 各自備份 `store_employees` 等人員表（備份表不同名）。建議同一個窗口內依序執行，最後一次備份之後不要再有人員異動寫入；上線前確認 `05_legacy_covered_check.verify.sql` 全綠。
9. **舊草稿 w17_B／w18_B 不要再執行**：已由 55、90 取代；若老闆已經在正式區執行過其中一份，請先告知，再決定 55／90 是否要調整備份基準。

## 權限授權（95，2026-11-24 已決定）

- 檔案：`95_role_permission_grants.sql`（只開不關、可重複執行）、`.verify.sql`（33 列 ok 全 true）、`.rollback.sql`（依 `m9_role_grant_log` 只撤本檔新增或打開的列）。由 `scripts/m9-perm-checklist/grant.cjs` 依權限勾選頁答案產生；操作頁放在「切換開新版」前一步。
- 共 33 組：管理員 18、督導角色 7（調店確認、盤點分析看自己門市、督導管理日誌 5 碼含 view_own）、店長角色 1（盤點分析看自己門市）、盤點組 2、業務督導 3（盤點匯入、盤點分析、task.manage）、總務與商品助理 task.view_archived。
- 老闆決定（勾選頁＋對話確認）：**總務服務中心整組先只給管理員**，總務角色與店長角色 12/8 都不授權 `general_affairs.*`，之後要開放再另做授權；請款查看／管理給管理員；`cross_dept.maintenance.update` 只給管理員。
- `store.store.*` 5 碼不授權：選單與停用門市讀取都接受既有的 `store.manage`。
- 2026-11-24 已在 DEV 實跑：授權、重跑（冪等）、檢查、撤回後 `role_permissions` 雜湊與筆數和執行前一致（DEV 只有 admin 角色，其他角色顯示「找不到角色」屬預期）。
