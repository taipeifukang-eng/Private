# Current DEV Status

最後更新：2026-08-15

## 目前階段

督導管理日誌：SML-VOICE-1「口述記錄 MVP UI / API 實作」已完成第一版。

目前已可在 `/supervisor-management-log` 透過快速口述入口建立待確認草稿；AI / 本機規則只產生草稿，不會自動建立案件、結案或寫入正式紀錄。

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
