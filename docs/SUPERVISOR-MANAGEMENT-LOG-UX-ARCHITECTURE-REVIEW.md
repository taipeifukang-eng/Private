# 督導管理日誌 UX / Architecture Review

最後更新：2026-08-13

## 1. 現況

目前「督導管理日誌」已完成 DB / API / RLS / permission foundation，並已有第一版可操作頁面：

- Route：`/supervisor-management-log`
- Page：`app/supervisor-management-log/page.tsx`
- API：
  - `GET /api/supervisor-management-log/categories`
  - `GET /api/supervisor-management-log/options`
  - `GET / POST /api/supervisor-management-log/cases`
  - `GET / PATCH / DELETE /api/supervisor-management-log/cases/[id]`
  - `GET / POST /api/supervisor-management-log/cases/[id]/records`
  - `GET / POST /api/supervisor-management-log/cases/[id]/followups`
- Access helper：
  - `lib/supervisor-management-log/access.ts`
- Validation：
  - `lib/supervisor-management-log/validation.ts`
- DB foundation：
  - `supervisor_management_categories`
  - `supervisor_management_cases`
  - `supervisor_management_records`
  - `supervisor_management_followups`
  - `supervisor_management_case_events`

目前 UI 能操作：

- KPI 摘要。
- 案件列表。
- 狀態 / 目標類型 / 關鍵字篩選。
- 分頁。
- 新增管理案件。
- 點選案件查看詳情。
- 編輯案件。
- soft delete 案件並要求刪除原因。
- 新增管理紀錄。
- 新增追蹤結果。
- 顯示管理紀錄、追蹤結果與事件時間線。

目前權限與資料邊界：

- Navbar 入口依 effective permission 顯示。
- API routes 使用 authenticated Supabase server client。
- API routes 有 server-side permission guard。
- RLS 仍是最終資料邊界。
- 未使用 service role 繞過受測 RLS。
- 前端隱藏不作為安全控制。

## 2. 現有 Foundation 可保留

本次 UX 重構不應推翻既有 foundation。以下設計仍合理：

- `Management Case` 作為持續改善或需追蹤事項的容器。
- `Management Record` 作為一次正式管理紀錄。
- `Follow-up` 作為追蹤結果。
- `Case Event` 作為 timeline / audit event。
- `store_id` / `employee_id` / `target_type` 可支援門市、人員、區域、跨部門與其他對象。
- `next_follow_up_at` 與 `follow_up_date` 可支援基本追蹤。
- `action_options`、`follow_up_method`、`source_record_id` 已可支援較正式的日誌 UX。
- `metadata` 欄位可作為短期延伸，但不應長期承載核心流程資料。

## 3. 主要 UX 落差

目前畫面仍偏向「後台 CRUD 資料管理」：

- 首屏核心是案件列表與新增案件表單。
- 使用者心智模型是先建立 Case，再補 Record / Follow-up。
- 「新增管理案件」比「留下今天的管理紀錄」更像主要操作。
- 管理紀錄表單雖已補欄位，但仍位於案件詳情內，不符合督導日常的 Record First 工作流。
- 今日待追蹤沒有直接入口。
- Follow-up Flow 仍偏表單：status dropdown、文字、日期。
- Case Detail 仍是多區塊資料檢視，不是完整 timeline-first 體驗。
- Mobile 目前仍是桌面工作台縮小，尚未針對督導現場使用情境優化。
- 語音入口與 AI Review 尚未實作。
- 今日管理規劃尚未實作。

## 4. 產品定位修正

新的定位應是：

**督導每日管理工作台**

核心流程：

1. 今日規劃。
2. 實際管理。
3. 留下管理紀錄。
4. 建立或關聯管理案件。
5. 設定追蹤。
6. 提醒追蹤。
7. 回報結果。
8. 持續改善或結案。

產品心智模型應改為：

**Record First, Case Behind the Scenes**

也就是督導先記錄「今天發生的管理事情」，系統再協助判斷要建立新案件或關聯既有案件。

## 5. 建議資訊架構

建議保留單一上方入口「督導管理日誌」，進入後在模組內切分下列工作區：

- 今日
  - 我的今日管理。
  - 快速口述。
  - 新增管理紀錄。
  - 今日待追蹤。
  - 今日 / 近期管理。
- 管理案件
  - 案件列表。
  - 狀態篩選。
  - 搜尋與分頁。
  - 案件詳情 timeline。
- 門市
  - 門市管理歷程。
  - 門市相關案件與紀錄。
- 人員
  - 人員 / 店長管理歷程。
  - 人員相關案件與紀錄。
- 管理歷程
  - 依日期、門市、人員、分類查詢歷史紀錄。

第一階段可以在同一 route 內使用 tab / segmented control 完成，不必立即新增大量 route。

## 6. 首頁「我的今日管理」設計

首屏應回答：

**我今天有哪些管理事情需要做？**

建議結構：

1. Breadcrumb：首頁 / 督導管理日誌 / 今日。
2. Header：
   - 督導管理日誌。
   - 我的今日管理。
   - 今日日期與星期。
   - 說明：記錄今天的管理、追蹤尚未完成的事情。
3. Primary Action：
   - 快速口述。
   - 新增管理紀錄。
   - 建立管理案件作為次要入口。
4. 今日管理概況：
   - 今日管理門市數。
   - 今日管理人員數。
   - 今日管理紀錄數。
   - 今日完成追蹤數。
5. 今日待追蹤：
   - 逾期。
   - 今日到期。
   - 即將到期。
   - 每筆可直接進入 Follow-up Flow。
6. 今日 / 近期管理：
   - 時間。
   - 門市或人員。
   - 管理類型。
   - 摘要。
   - 目前追蹤狀態。

不得顯示假 KPI 或硬編碼營運數字。

## 7. Record First 新增管理紀錄 Flow

新增管理紀錄應改成 3+1 引導式流程。

### Step 1：今天發現什麼？

- 管理對象：
  - 門市。
  - 人員。
  - 區域。
  - 跨部門。
  - 其他。
- 實際對象：
  - 依 API / RLS 回傳範圍選擇。
- 管理類型：
  - 使用 `supervisor_management_categories`。
- 發現內容：
  - 支援文字。
  - 未來支援語音輸入。
  - placeholder 應使用業務語境範例。

### Step 2：你認為主要原因是什麼？

- 對應 `judgment`。
- 支援文字。
- 未來支援語音輸入。
- 使用引導式 placeholder。

### Step 3：你做了什麼？

- Quick Action Chips：
  - 與店長討論。
  - 現場指導。
  - 安排訓練。
  - 設定改善目標。
  - 要求改善。
  - 調整工作分配。
  - 跨部門協調。
  - 持續觀察。
  - 其他。
- 對應 `action_options`。
- 補充具體安排對應 `action_summary`。

### Step 4：需要再追嗎？

- 大型選項：
  - 不需要。
  - 需要追蹤。
- 若需要追蹤才顯示：
  - Quick Date：明天、3 天後、下週、自選日期。
  - 預期改善結果。
  - 追蹤方式。

## 8. Case Behind the Scenes

現有 DB 要求 `supervisor_management_records.case_id` 不可為 NULL，因此「純粹 record-only 不建立 case」目前無法成立。

可行方案分三層：

### 方案 A：不改 DB，前端降低 Case 感

- 使用者走新增管理紀錄 flow。
- 儲存時由前端產生建議案件標題。
- 前端先呼叫 `POST /cases` 建立最小 Case。
- 再呼叫 `POST /cases/[id]/records` 建立 Record。
- 如果需要追蹤，設定 Case `next_follow_up_at` 與 Record follow-up fields。

限制：

- 需要目前 `POST /cases` 回傳新 case id；但目前為 minimal return `data: null`，避免 INSERT RETURNING RLS trap。
- 若不改 API，前端只能建立 case 後重新查列表再猜新 case，這不可靠。

### 方案 B：新增受控 RPC / API

新增 server API：

- `POST /api/supervisor-management-log/records/quick-create`

由 server-side authenticated client 或 SECURITY DEFINER RPC 在同一 transaction：

1. 驗證權限。
2. 建立或關聯 Case。
3. 建立 Record。
4. 建立 Event。
5. 回傳安全 minimal result，例如 case id / record id。

這是最符合 Record First 的最小架構調整。

### 方案 C：允許 record standalone

將 `case_id` 改為 nullable，讓一般日常管理紀錄不一定隸屬 case。

不建議作為第一步，因為會影響 RLS、timeline、follow-up 與 existing APIs。

## 9. 今日待追蹤

現有資料可支援基本待追蹤：

- `supervisor_management_cases.next_follow_up_at`
- `supervisor_management_records.requires_follow_up`
- `supervisor_management_records.follow_up_date`
- `supervisor_management_followups.next_follow_up_date`

但現有 `GET /cases` 主要是列表 API，沒有專門的 due follow-up API。

建議新增：

- `GET /api/supervisor-management-log/today`

回傳：

- 今日統計。
- 逾期待追蹤。
- 今日到期待追蹤。
- 即將到期待追蹤。
- 近期管理紀錄。

注意：

- 必須沿用 RLS / permission scope。
- 前端不得自行擴大 store scope。
- API failure 不得顯示為 0。

## 10. Follow-up Flow

現有資料可支援：

- `source_record_id`
- `follow_up_date`
- `result_status`
- `result_notes`
- `next_follow_up_date`

UX 應改為：

1. 從今日待追蹤點「立即追蹤」。
2. 顯示大型結果按鈕：
   - 已改善。
   - 改善中。
   - 未改善。
   - 暫無法判斷。
3. 填寫結果說明。
4. 依結果 Progressive Disclosure：
   - 已改善：詢問結案或繼續觀察。
   - 其他：詢問下次追蹤日期。
5. 儲存後刷新今日待追蹤與 timeline。

目前 `FOLLOWUP_STATUSES` 沒有 `暫無法判斷` 對應值。可先對應到 `POSTPONED`，UI label 顯示「暫無法判斷 / 延後追蹤」，或下一輪用 migration 擴充 enum。

## 11. Case Detail Timeline

案件詳情應從表單區塊改為 timeline-first：

- Header：
  - 案件標題。
  - 管理類型。
  - 狀態 badge。
  - 下次追蹤日期。
- Timeline：
  - Management Record 顯示為「發現問題 / 現場管理 / 管理紀錄」。
  - Follow-up 顯示為「追蹤結果」。
  - Case Event 顯示為 audit event。
- 底部操作：
  - 新增管理紀錄。
  - 回報追蹤結果。
  - 編輯案件。
  - 刪除案件。

案件編輯仍應保留，但不要成為 detail 的主要視覺重心。

## 12. 今日管理規劃

今日管理規劃是新能力，現有 foundation 尚未直接支援。

建議新增資料表：

- `supervisor_management_daily_plans`

至少欄位：

- id
- plan_date
- owner_user_id
- target_type
- store_id
- employee_id
- target_name_snapshot
- category_id
- title
- notes
- status：PLANNED / DONE / CANCELLED
- linked_case_id
- linked_record_id
- created_at / created_by
- updated_at / updated_by
- deleted_at / deleted_by / deletion_reason

可先不做完整行程管理，只做每日 checklist。

## 13. 快速口述與 AI Review

語音 / AI 不應直接寫入正式紀錄。

建議分期：

### Phase Voice-1：Transcript Only

- 前端使用瀏覽器 Speech Recognition，若瀏覽器不支援則顯示文字輸入。
- 使用者確認 transcript。
- 不呼叫 AI。

### Phase AI-1：AI Structuring Draft

- 新增 server API：
  - `POST /api/supervisor-management-log/ai/structure-record`
- 輸入 transcript。
- 回傳 draft JSON。
- 未能辨識的欄位標記「需要確認」。
- 不直接寫 DB。

### Phase AI-2：Review and Confirm

- 使用者在 review screen 修改。
- 確認後才呼叫 quick-create API 寫入正式紀錄。

## 14. Desktop / Mobile 差異

Desktop：

- 今日工作台左側或上方顯示摘要與待追蹤。
- 右側顯示 timeline detail。
- 適合多案件比較與主管查看。

Mobile：

- 首屏只放：
  - 快速口述。
  - 新增管理紀錄。
  - 今日待追蹤。
  - 近期管理。
- 新增紀錄使用全畫面 flow 或 bottom sheet。
- Follow-up 使用大型按鈕。
- 避免寬表格與過多 dropdown。

## 15. 建議開發階段

### Phase 2A：純前端 IA 重構

不改 DB / API。

- 將 `/supervisor-management-log` 改為「今日」工作台。
- 將現有案件列表移到「管理案件」tab。
- 將 detail 改為 timeline-first。
- 將現有表單改為 drawer / sheet。
- 新增大型 CTA：
  - 快速口述：先顯示「語音整理尚未開放，請先使用新增管理紀錄」或 transcript-only shell。
  - 新增管理紀錄：使用 3+1 flow，但儲存前仍必須選擇或建立 case。
- 不顯示假資料。

### Phase 2B：新增 quick-create API

需要 API 變更，可能需要 RPC。

- 建立 record-first 儲存 API。
- 支援建立新 case + record。
- 支援加入既有 case + record。
- 回傳安全 id。
- 保留 RLS / permission guard。

### Phase 2C：今日 API

需要新增 read API。

- `GET /api/supervisor-management-log/today`
- 回傳今日概況、待追蹤與近期紀錄。
- 所有資料受 API / RLS scope 限制。

### Phase 2D：Follow-up Flow 重構

主要前端重構，可搭配 today API。

- 從待追蹤直接進入回報結果。
- 大型狀態按鈕。
- Progressive Disclosure。
- 更新後刷新 today / cases / timeline。

### Phase 3：今日管理規劃

需要 DB / API / RLS。

- 新增 daily plans foundation。
- 新增 checklist UI。
- 支援完成後建立紀錄。

### Phase 4：Voice / AI Draft

需要額外 API 與安全設計。

- Transcript-only。
- AI structure draft。
- Review screen。
- Confirm save。

## 16. 最小下一步建議

下一個最小任務建議為：

**SML-UX-2A：督導管理日誌 IA / Layout 重構**

範圍：

- 不改 DB。
- 不改 migration。
- 不改 RLS。
- 不改 API contract。
- `/supervisor-management-log` 改為 tabbed layout：
  - 今日。
  - 管理案件。
  - 門市。
  - 人員。
  - 管理歷程。
- 今日 tab 使用現有 `GET /cases` 與 `GET /options` 能取得的資料做安全顯示。
- 現有案件列表移到管理案件 tab。
- 詳情改為 timeline-first。
- 新增管理紀錄改為 3+1 guided flow，但儲存仍使用既有 case-scoped record API。
- 快速口述先做安全入口，不寫 DB、不呼叫 AI、不顯示假 AI 結果。

完成判定：

- 無 migration 修改。
- SML UI static tests 通過。
- `npx tsc --noEmit --pretty false` 通過。
- `npm run build` 通過。
- 手機版不出現寬表格 overflow。
- 無權限帳號仍無法透過 route / API 取得資料。

## 17. 禁止事項

- 不得操作 Production。
- 不得修改已套用 migration。
- 不得為了 UX 關閉或放寬 RLS。
- 不得用 service role 代替 authenticated user 驗證。
- 不得顯示假案件、假 KPI、假待追蹤、假 AI 結果。
- 不得讓 AI 直接寫入正式紀錄。
- 不得在沒有使用者確認前自動合併 case。
- 不得以前端 store / role 判斷取代 server API / RLS scope。
