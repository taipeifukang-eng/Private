# Current DEV Status

最後更新：2026-11-24

## 目前階段

督導管理日誌：SML-VOICE-1「口述記錄 MVP UI / API 實作」已完成第一版。

目前已可在 `/supervisor-management-log` 透過快速口述入口建立待確認草稿；AI / 本機規則只產生草稿，不會自動建立案件、結案或寫入正式紀錄。

## M9 F01 全站回歸（2026-11-24，DEV）

完整一輪（每個頁面編號 × 角色矩陣 83 帳號，`--enforce-fix all`）已在 DEV 跑完並處理失敗：vue-tsc 與 tsc 0 錯誤；單元 2606、冒煙 547、整合 1334、e2e 627、對等 655 全部通過（略過皆為測試內標註）。失敗原因：角色矩陣快照過期（已更新）、獨立測試套件被主 runner 誤撿而殘留測試資料（已排除並清掉）、少數環境暫時性（重跑通過）。新發現 4 項未登記差異依規則登記為待核可、未改行為：診所自費選單導覽面、管理員請款權限碼（2 筆）、新版巡店缺舊版新加的「定位例外」（2026-11-26 已補做並移除登記，見 `verification.md`「巡店定位例外補做」）。`nav-archived-feature-gate` 已確認修正。DEV 孤兒 0、2099 保留月份未動。詳見 `docs/vue-workspace/verification.md`「F01 全站回歸」；路由狀態見 `route-inventory.json`（95 通過、5 exclude）。分支 `feature/vue-parity`，未 push。

## M9 F01S 回舊版連結與逐頁備援開關（2026-11-23，DEV）

2026-11-23 上線準備問卷 C2／N2 已在 DEV 實作，分支 `feature/vue-parity`，未 push。每個新版頁籤列有「回舊版」連結（舊版沒有對應的新功能不顯示）；系統管理員可在「角色權限管理 > 頁面回舊版設定」把某一頁單獨切回舊版（選單改開舊版路由），不需重新部署，最慢 60 秒生效。規格見 `docs/vue-workspace/parity-plan/m9-fallback-spec.md`，演練紀錄見 `m9-fallback-drill.md`，正式區 SQL 草稿在 `parity-plan/m9-sql/`（尚未套用）。

## M7/M8 總務工作台第 4 批（2026-11-13，DEV）

第 4 批（回報、需求單、料件處理中心、採購單與核准、到貨即驗入、配發轉設備、設備換店單子跟著走）已在 DEV 完成並驗收，分支 `feature/vue-parity`，未 push。正式區 SQL 草稿在 `docs/vue-workspace/parity-plan/m7m8-sql/`（31 唯讀預覽，32 至 35 各附撤回檔），套用順序與核准人指派步驟見該資料夾 README。待使用者確認的新發現見 `docs/vue-workspace/parity-plan/m7m8-batch4-design.md` 12.6。第 4.5 批（進貨單憑證、發票、請款）已於 2026-11-20 完成，見下一節。

## M7/M8 總務工作台第 4.5 批（2026-11-20，DEV）

第 4.5 批（進貨單憑證、進貨發票、請款單與付款標記、廠商銀行資料、作廢進貨、請款統計與徽章）已在 DEV 完成並驗收，分支 `feature/vue-parity`，未 push。舊版沒有這些功能，是新功能。規格見 `docs/vue-workspace/parity-plan/m7m8-batch4-5-design.md`，驗收見 `docs/vue-workspace/verification.md`。正式區 SQL 草稿在 `docs/vue-workspace/parity-plan/m7m8-sql/`（50 唯讀預覽，51 至 58 各附撤回檔），套用順序與上線檢查見該資料夾 README「第 4.5 批」。權限碼 `general_affairs.purchase_payment.view`／`manage` 只新增、不自動授權，角色授權由使用者決定。待使用者確認 5 筆差異（approvedBy 為 null），見設計文件 §13.2。

## M6 第 1 批（2026-11-21，DEV）

W25 門市盤點缺口與 P07 關係會員對等已在 DEV 實作，分支 `feature/vue-parity`，未 push。內容：離線盤點工具檔名帶台北時間日期、Sheet1、衝突擋下並列清單、預盤逐檔容錯、CSV 品號保留前導零與舊版提示補回；關係會員姓名電話兩欄、銷售明細重複匯入略過（DEV 資料庫函式 `workspace_import_relationship_sales`，正式區草稿在 `docs/vue-workspace/parity-plan/m6-sql/`，上線前須先套用）、並行填寫會員編號 409。測試頁 ID：`M6-W25`、`M6-P07`（`node tests/run-all.cjs --layers all --page <id> --no-sweep`）。規格與判斷見 `docs/vue-workspace/parity-plan/m6-spec.md`，各頁可見角色清單見 `m6-batch1-roles.md`。尚未用真實盤點樣本驗證。

## 最新已完成項目

- SML-UX-2B：`supervisor_management_daily_plans` DB foundation 已正式推送 DEV 並通過 DB catalog test。
- SML-UX-2C：Daily Plans API 與 Today Read Model 已完成：
  - `GET /api/supervisor-management-log/daily-plans`
  - `POST /api/supervisor-management-log/daily-plans`
  - `GET /api/supervisor-management-log/daily-plans/[id]`
  - `PATCH /api/supervisor-management-log/daily-plans/[id]`
  - `DELETE /api/supervisor-management-log/daily-plans/[id]`
  - `GET /api/supervisor-management-log/today`
- SML-UX-2D：`/supervisor-management-log` 今日分頁已改成正式工作台。
- SML-UX-2E：第二次 UX 架構收斂已完成技術驗證：
  - 第一層 navigation 只保留「今日工作台」與「管理案件」。
  - 門市、人員、管理歷程暫停到未來 Management Knowledge Base 階段。
  - 今日工作台依序呈現今日管理規劃、今日待追蹤、管理結果紀錄與今日紀錄。
  - 管理結果表單改成督導語言。
  - Follow-up flow 改為結果優先。
  - 管理案件頁移除大型 KPI 與常駐右側表單。
- SML-VOICE-0：口述記錄 AI 辨識設計已完成：
  - 設計文件：`docs/SUPERVISOR-MANAGEMENT-VOICE-AI-DESIGN.md`
  - MVP 採「錄音完成後上傳轉文字」，不做 realtime。
  - AI 只產生 Management Record / Follow-up 草稿，不直接寫入 DB。
  - AI 只能輸出 entity mention，不得產生 `store_id`、`employee_id`、`profile_id` 或任何正式 FK。
  - 正式 Entity Matching 必須由 application layer 根據登入者權限、store scope 與正式 stores / store_employees / profiles 候選處理。
  - 使用者必須人工確認後才可儲存正式紀錄。
  - MVP 不新增 DB table，不永久保存音檔。
  - 下一步實作需建立 server-side transcribe / draft API 與 Voice Sheet UI。
- SML-VOICE-1：口述記錄 MVP UI / API 已完成：
  - `POST /api/supervisor-management-log/voice/transcribe`
  - `POST /api/supervisor-management-log/voice/draft`
  - `lib/supervisor-management-log/voice.ts`
  - `/supervisor-management-log` Voice Sheet UI
  - 支援錄音、音檔上傳、手動文字稿、草稿產生、正式主檔 Entity Matching、草稿審核與套用到新增管理紀錄。
  - 若未設定 `OPENAI_API_KEY`，轉文字 API 會安全回 503；文字稿仍可用本機規則 fallback 產生待確認草稿。

## 目前阻擋 / 缺口

- SML-VOICE-1 尚未做人工 UI 驗收與 authenticated dynamic API 驗收。
- OpenAI 轉文字需要 server-side `OPENAI_API_KEY`；未設定時不得顯示假轉文字成功。
- 目前 MVP 不永久保存音檔，也不建立 voice draft DB table。
- Follow-up 草稿目前已納入 schema / mode，但 UI 主要先套到 Management Record 新增表單；後續若要完整 follow-up review 需另開小任務。
- 尚未做 authenticated dynamic API / RLS 角色矩陣驗收。
- 尚未重跑 `supabase/test_supervisor_management_log_foundation.sql`。
- Today Plan 若未關聯 Management Case，目前無法直接建立 Management Record；系統不得假裝已能自動建案。
- 門市、人員、管理歷程暫停到未來 Management Knowledge Base 階段。

## 下一個最小任務

**SML-VOICE-1 人工驗收與動態 API 驗證。**

範圍：

1. 使用可建立 SML 紀錄的 DEV 帳號開啟 `/supervisor-management-log`。
2. 驗證快速口述 Voice Sheet。
3. 驗證手動文字稿可產生本機規則草稿。
4. 若已設定 `OPENAI_API_KEY`，驗證音檔轉文字與 AI draft。
5. 驗證 Entity Matching 不會由 AI 直接產生正式 ID。
6. 驗證套用草稿後仍需人工確認才可儲存。
7. 驗證 no-access / 無權限使用者無法呼叫 voice API。

不做：

- Realtime transcription。
- Voice draft DB table。
- 音檔永久保存。
- 自動建立 Case。
- 自動結案。
- Production 操作。

## Migration Local / Remote 狀態

- `20260813063209_supervisor_management_daily_plans.sql` 已正式推送 DEV，local / remote aligned。
- SML-VOICE-0 / SML-VOICE-1 未新增 migration。
- 本輪未執行 db push / repair / reset / rollback。
- 不得修改已套用 migration。
- 若後續 DB 問題需要修正，只能建立 forward migration，且需使用者批准。

## 最近一次檢查結果

- SML-VOICE-1：MVP UI / API 實作完成。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過，exit code 0。
- `git diff --check`（本任務相關檔案）：通過。
- Build 仍有既有 Dynamic server usage warning，非本輪 voice routes 導致 build failure。
- 最近一次 SML-UX-2E 技術驗證紀錄：
  - `node --check scripts/test-supervisor-management-log-ui.js`：通過。
  - `node scripts/test-supervisor-management-log-ui.js`：通過。
  - `node --check scripts/test-supervisor-management-daily-plans-api.js`：通過。
  - `node scripts/test-supervisor-management-daily-plans-api.js`：通過。
  - `node scripts/test-supervisor-management-daily-plans.js`：通過。
  - `npx tsc --noEmit --pretty false`：通過。
  - `npm run build`：通過，exit code 0。

## 禁止操作

- 不得連 Production。
- 不得命中 Production 候選 Project Ref `odvksgucvfoaqrumpran`。
- 不得修改已套用 migration。
- 不得 repair / reset / rollback。
- 不得 db push，除非使用者明確批准該輪遠端操作。
- 不得輸出 password、JWT、token、cookie、service role key 或 connection string。
- 不得為督導管理日誌顯示假案件、假 KPI、假追蹤、假 AI 結果。
- 不得讓 AI 或語音辨識結果直接寫入正式紀錄；必須先產生草稿並由使用者確認。
- 不得讓 LLM 自行產生正式資料 ID；正式 ID 必須由 application layer matching 並由使用者確認。
- 不得用 `supervisor_management_cases` 或 `supervisor_management_records` 假裝今日管理規劃。

### 第 4 批審查後補強（2026-11-16）

兩份審查共 30 項已逐條處理（修 17、不屬實 1、其餘待使用者決定），DEV 已重新套用資料庫補強，正式區草稿 32 至 34 已重新產生（32 與 33 必須連續套用）。細節見 `docs/vue-workspace/parity-plan/m7m8-batch4-design.md` 12.7。

## M6 第 2 批（2026-11-22，DEV）：W26 縮小版、W27 商品主檔、W28 Excel 匯入

商品主檔頁（`ProductsMaster.vue`）與 `app/api/workspace/products-master/**` 已在 DEV 實作，分支 `feature/vue-parity`，未 push。內容：登入即可搜尋、清單分頁與「顯示已停用」、單筆新增與編輯（編號不可改）、停用與重新啟用（管理權限）、Excel 匯入先預覽再確認（欄位別名沿用舊版、單次 5000 筆、500 筆一批）、操作紀錄（新資料表 `products_master_operation_logs`，正式區上線前須先建立）；共用 `vue-workspace/src/lib/xlsx.ts`。不含併購藥局商品整理（B5）。細節與待確認項目見 `docs/vue-workspace/parity-plan/m6-spec.md` 第二批實作結果與 `m6-batch2-roles.md`。W29 缺貨回報尚未開始。

## M6 第 2 批 W29（2026-11-22，DEV）：商品部缺貨回報

缺貨回報頁（`Merchandise.vue`）與 `app/api/workspace/stockout/**` 已在 DEV 實作，分支 `feature/vue-parity`，未 push。內容：店長回報（伺服端檢查門市範圍、7 天內重複要確認）、商品部回覆（回覆與歷程同一交易）、狀態與統計由目前有效回覆即時算出（15 天有效、30 天提醒，照舊）、近 30 天與歷史月份（台北時間）、回覆歷程、刪除規則與舊版對等。正式區上線前須先建立 `m6-sql/20261122110000_m6_stockout_rpc.sql` 的兩個函式。細節與待確認項目見 `m6-spec.md` 第三輪補充與白名單 `m6-w29-*`。

## M6 第 3 批 3b W32（2026-11-22，DEV）：督導管理日誌

督導管理日誌頁（`SupervisorLog.vue`）與 `app/api/workspace/supervisor-management/**` 已在 DEV 實作，分支 `feature/vue-parity`，未 push。內容：今日工作台（每日計畫、追蹤佇列、今日紀錄）、案件建立與修改、管理紀錄、追蹤、時間線、軟刪除（本人與管理者，留事件）、選項與分類；可見範圍三層（E1）。沿用舊版資料表與權限碼，新增一個 DEV 函式 `workspace_supervisor_soft_delete`（已套用 DEV，正式區草稿在 `docs/vue-workspace/parity-plan/m6-sql/`）。W33 語音另案。細節與判斷見 `docs/vue-workspace/parity-plan/m6-spec.md` 第三批 3b。測試：`node tests/run-all.cjs --layers all --page M6-W32 --no-sweep`。

## M6 第 3 批 3b W33（2026-11-22，DEV）：督導語音與 AI 摘要

案件詳情的「語音口述」（`VoiceDraftFlow.vue`、`VoiceRecorder.vue`、`lib/voice-upload.ts`）與 `app/api/workspace/supervisor-management/voice/**`、`ai-usage`、`ai-settings` 已在 DEV 實作，分支 `feature/vue-parity`，未 push。內容：首次使用先看告知並同意（E5）、錄音（試聽、重新錄音、失敗重試、10 分鐘或 10MB 上限）、AI 草稿審核（只帶進紀錄表單，仍要人工儲存）、逐字稿只有建立者與管理者看得到（E6）、AI 失敗或額度用完退回手動文字稿與本機規則並標示「這份草稿未經 AI 整理」（E7）、每月 OpenAI 上限 30 美元（事前保守估算，80% 與 100% 只通知系統管理員的首頁提醒，100% 自動停用，每月 1 日台北時間歸零，系統管理員可在「AI 用量」調整）。細節與判斷見 `parity-plan/m6-spec.md` 的 W33 一節。

- 資料庫：五張表與兩個函式（DEV：`supabase/workspace-dev/20261122133000_m6_voice_ai.sql`，附 rollback，`scripts/apply-workspace-m6-dev.cjs` 已套用；正式區草稿見 `m6-sql/`）。正式區上線前必須先建立。
- 測試站一律用假的 OpenAI（`WORKSPACE_OPENAI_MOCK=true`，同時清掉 `OPENAI_API_KEY`）；沒有呼叫真實 OpenAI，也沒有動 Vercel 的金鑰設定。
- 測試：`node tests/run-all.cjs --layers all --page M6-W33 --no-sweep`（單元 57、整合 15、e2e 桌機與手機各 3、對等 4 全過）；M6-W32、W11（首頁）、T03 回歸全過。
- 待決定：Vercel 請求大小與逾時未實測、價格表寫死、白名單 5 項 approvedBy 為 null（`m6-w33-record-ai-flag`、`m6-w33-record-voice-meta`、`m6-w33-entity-scope`、`m6-w33-ui-voice-flow`、`m6-w33-draft-too-long-status`）。

## M6 第 3 批 3b 最終驗證（2026-11-23，DEV）

W32 督導管理日誌與 W33 語音 AI 完成最終驗證（commit d3066003、5b6e29ee、16f0d903，另加 tsc 修正與文件整理），未 push。`vue-tsc --noEmit` 與根目錄 `tsc --noEmit` 皆 0 錯誤。各頁 `--layers all --no-sweep`（通過/失敗/略過）：

| 頁面 | unit | smoke | integration | e2e | parity |
| --- | --- | --- | --- | --- | --- |
| M6-W32 | 32/0/0 | 0 | 19/0/0 | 2/0/0 | 12/0/0 |
| M6-W33 | 57/0/0 | 0 | 15/0/0 | 6/0/0 | 4/0/0 |
| M6-W29 | 25/0/0 | 0 | 18/0/0 | 2/0/0 | 10/0/0 |
| M6-W27 | 28/0/0 | 0 | 7/0/0 | 2/0/0 | 5/0/0 |
| M6-W25 | 62/0/1 | 14/0/0 | 7/0/0 | 6/0/0 | 2/0/0 |
| M6-P07 | 37/0/0 | 14/0/0 | 6/0/0 | 2/0/0 | 2/0/0 |
| W11 | 37/0/0 | 6/0/0 | 10/0/0 | 4/0/0 | 9/0/0 |
| M0 | 10/0/0 | 64/0/0 | 86/0/0 | 2/0/0 | 167/0/0 |

全專案 unit 層：2517 通過、0 失敗、1 略過。W25 第一次完整跑時整合層有 1 項失敗（該檔約 5.6 分鐘，疑為負載逾時），單獨重跑整合層 7/7 通過，再完整重跑全過；未改任何程式。DEV 殘留檢查全為 0（督導案件、紀錄、追蹤、事件、規劃、分類、逐字稿、AI 費用列、通知、同意、m6-test 帳號與 m6_test 角色），語音每月上限仍為 30。

## M6 第 3 批 3a 最終驗證（2026-11-23，DEV）：W30 診所自費藥毛利、W31 截圖與 PDF

W30（價格檔匯入與毛利計算）與 W31（多張截圖、檢視器、圖片式請款 PDF 不含成本毛利）完成最終驗證（commit 3ef8a575、a7a387ed，另加文件整理），未 push。`vue-tsc --noEmit`（在 `vue-workspace/` 內執行）與根目錄 `tsc --noEmit` 皆 0 錯誤。各頁 `--layers all --no-sweep`（通過/失敗/略過）：

| 頁面 | unit | smoke | integration | e2e | parity |
| --- | --- | --- | --- | --- | --- |
| M6-W30 | 49/0/0 | 0 | 17/0/0 | 2/0/0 | 12/0/2 |
| M6-W31 | 17/0/0 | 0 | 6/0/0 | 2/0/0 | 2/0/0 |
| M6-W32 | 32/0/0 | 0 | 19/0/0 | 2/0/0 | 12/0/0 |
| M6-W33 | 57/0/0 | 0 | 15/0/0 | 6/0/0 | 4/0/0 |
| M6-W29 | 25/0/0 | 0 | 18/0/0 | 2/0/0 | 10/0/0 |
| M6-W27 | 28/0/0 | 0 | 7/0/0 | 2/0/0 | 5/0/0 |
| M6-W25 | 62/0/1 | 14/0/0 | 7/0/0 | 6/0/0 | 2/0/0 |
| M6-P07 | 37/0/0 | 14/0/0 | 6/0/0 | 2/0/0 | 2/0/0 |
| W11 | 37/0/0 | 6/0/0 | 10/0/0 | 4/0/0 | 9/0/0 |
| M0 | 10/0/0 | 64/0/0 | 86/0/0 | 2/0/0 | 167/0/0 |

全專案 unit 層：2583 通過、0 失敗、1 略過（154 檔通過、1 檔略過）。W30 parity 的 2 項略過是真實樣本比對。W25 的 1 項略過是真實盤點樣本。

非程式問題的失敗（已重跑確認）：(1) W30 第一次跑，手機 e2e 的 worker 程序異常結束（exit code 3221225794，系統層級），單獨重跑 W30 全過（31 通過、2 略過）；(2) W33 第一次跑 4 項失敗，原因是前一個代理程式留下的測試站（port 3002，沒開假的 OpenAI）被重複使用，W33 的守衛正確地拒絕執行；以 PID 停掉殘留站後重跑 W33 全過（25 通過）。未改任何程式碼。

自造測試檔（`tests/fixtures/clinic-selfpay/make-fixtures.cjs` 產生：假診所、假健保碼、VW／ZT 測試門市、2038 年）。真實診所樣本（Z4）仍未提供：樣本放進 `盤點測試檔/` 後執行 `node tests/run-all.cjs --layers parity --page M6-W30 --no-sweep`，會自動跑真實樣本比對（舊版解析器對新共用解析器，只印筆數與健保碼）。各角色可見範圍見 `docs/vue-workspace/parity-plan/m6-batch3a-roles.md`。

DEV 殘留檢查：`clinic_selfpay_claim_batches`、`clinic_selfpay_price_entries`、`clinic_selfpay_price_month_closures` 皆 0 列，私有桶 `clinic-selfpay-screenshots` 0 個物件（含截圖腳本跑完之後再查一次）。1920x1080 與手機 390 截圖無主控台錯誤、無橫向溢出。