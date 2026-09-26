# 督導管理日誌：AI 口述紀錄結構化與 Entity Matching 設計

最後更新：2026-08-14

## 1. 設計目標

督導可以像平常說話一樣描述剛剛的管理過程，由系統完成：

1. Speech-to-Text。
2. AI Semantic Parsing。
3. Structured Output。
4. 正式主檔 Entity Matching。
5. Validation。
6. User Review。
7. Confirm。
8. 寫入既有 Supervisor Management Log。

此功能的目的不是把口述「寫漂亮」，而是把自然口述轉成具有管理價值、可追蹤、可查詢、可回顧的結構化資料。

AI 永遠不能越過 User Review 直接寫入正式資料。

## 2. 目前專案現況

### 2.1 既有 SML Domain

目前已存在並應沿用：

- `supervisor_management_categories`
- `supervisor_management_cases`
- `supervisor_management_records`
- `supervisor_management_followups`
- `supervisor_management_case_events`
- `supervisor_management_daily_plans`

不得建立第二套「AI 日誌」或第二套「語音管理紀錄」主資料。

### 2.2 Case Schema 摘要

`supervisor_management_cases` 目前核心欄位：

- `title`
- `category_id`
- `owner_user_id`
- `assigned_user_id`
- `target_type`
- `store_id`
- `employee_id`
- `target_name_snapshot`
- `status`
- `priority`
- `next_follow_up_at`
- `summary`
- `metadata`

目前 target type enum：

- `STORE`
- `EMPLOYEE`
- `AREA`
- `CROSS_DEPARTMENT`
- `OTHER`

### 2.3 Record Schema 摘要

`supervisor_management_records` 目前核心欄位：

- `case_id`
- `record_type`
- `record_date`
- `store_id`
- `employee_id`
- `category_id`
- `target_name_snapshot`
- `observation`
- `judgment`
- `action_summary`
- `action_options`
- `requires_follow_up`
- `follow_up_date`
- `follow_up_owner_id`
- `expected_result`
- `follow_up_method`
- `ai_generated`
- `ai_confirmed_by`
- `metadata`

目前 record type enum：

- `MANAGEMENT`
- `FOLLOW_UP`
- `RESULT`
- `NOTE`

目前 `observation`、`judgment`、`action_summary` 皆為必填。AI 草稿若缺某一欄，Review UI 必須提示使用者補齊，不能自行腦補。

### 2.4 Follow-up Schema 摘要

`supervisor_management_followups` 目前核心欄位：

- `case_id`
- `source_record_id`
- `follow_up_date`
- `result_status`
- `result_notes`
- `next_follow_up_date`
- `metadata`

目前 follow-up result enum：

- `IMPROVED`
- `IMPROVING`
- `NOT_IMPROVED`
- `POSTPONED`
- `CLOSED`

### 2.5 Daily Plan Schema 摘要

`supervisor_management_daily_plans` 目前核心欄位：

- `plan_date`
- `owner_user_id`
- `target_type`
- `store_id`
- `employee_id`
- `target_name_snapshot`
- `category_id`
- `title`
- `status`
- `started_at`
- `completed_at`
- `linked_case_id`
- `linked_record_id`
- `notes`
- `metadata`

Today Plan 若未關聯 Management Case，目前不能直接建立 Management Record。SML-VOICE-1 不應假裝能自動建案。

### 2.6 目前 Store / Employee API

目前 `GET /api/supervisor-management-log/options` 回傳：

- categories
- stores
- employees

目前實作偏粗：

- stores 查 `stores(id, store_code, store_name, short_name)`，最多 200。
- employees 查 `store_employees(id, store_id, employee_code, employee_name, current_position, position, employment_status, is_active)`，最多 300。

SML-VOICE-1 不應把整個公司所有人員無限制丟給 AI。需要新增或調整 server-side matching context，依登入者權限與管理範圍縮小候選。

### 2.7 AI SDK / API 現況

目前 `package.json` 尚未安裝 OpenAI SDK，也未看到既有 OpenAI integration。

因此 SML-VOICE-1 有兩條可行路線：

1. 使用官方 `openai` SDK。
2. 使用 server-side `fetch` 呼叫 OpenAI API。

建議優先使用官方 SDK，並在 server route 中封裝，不讓前端看到 API key。

OpenAI Structured Outputs 可用 JSON Schema 約束輸出格式；官方文件說明 Structured Outputs 可讓模型回覆符合提供的 JSON Schema。這只能保證形狀，不代表語意一定正確，所以仍必須做 domain validation 與 User Review。

## 3. AI 角色與限制

AI 是：

> 督導管理紀錄整理助手

AI 只負責：

1. 理解督導自然口述。
2. 找出管理意義。
3. 分類。
4. 摘要。
5. 產生結構化草稿。
6. 標記不確定欄位。
7. 提供確認問題。

AI 不負責：

- 評價督導管理能力。
- 自行做管理決策。
- 自行增加督導沒有說過的原因。
- 自行產生不存在的數據。
- 自行指定正式責任人 ID。
- 自行決定模糊日期。
- 自行建立正式 Management Case。
- 自行儲存資料。
- 自行產生任何正式 FK。

## 4. 不得腦補規則

所有輸出必須能追溯到 transcript。

範例：

- 督導說「最近業績比較差」。
- AI 可整理「近期業績表現下降」。
- AI 不得整理「本月業績較目標落後 8%」，除非 transcript 明確提到 8%。

範例：

- 督導說「下禮拜再看」。
- AI 不得自行決定「下週一」。
- 應輸出 `follow_up.required = true`、`date = null`、`needs_confirmation = true`。

範例：

- 督導說「我有叫他注意一下」。
- 如果無法確認「他」是誰，不得指定 responsible person。
- 應列入 confirmation question。

## 5. 口述結構化核心

AI 必須盡量整理成 3+1：

### 5.1 observation

發現 / 看到什麼。

只描述客觀狀況。

### 5.2 judgment

督導怎麼判斷。

只有 transcript 中存在督導判斷時才能填寫。

如果沒有判斷：

- `judgment = null`
- Review UI 要提示使用者補充或確認是否留空。

但因目前 DB `judgment` 必填，確認儲存前仍需使用者補齊正式儲存欄位。

### 5.3 actions

督導做了什麼管理動作。

可多筆，例如：

- 與店長討論。
- 要求每日追蹤三位專員成交狀況。
- 安排店長陪同小王進行銷售訓練。

### 5.4 follow_up

之後是否需要再確認。

包含：

- `required`
- `date`
- `date_text`
- `expected_result`
- `method`
- `needs_confirmation`

相對日期必須以 transcript 發生當下 Asia/Taipei local date/time 解析。

## 6. AI Structured Parsing Schema

AI 回傳的是「語意草稿」，不是正式 DB payload。

正式建議 schema：

```json
{
  "schema_version": "sml_voice_draft_v1",
  "mode": "RECORD_DRAFT",
  "language": "zh-TW",
  "confidence": 0.86,
  "management_target": {
    "type": "STORE",
    "mention": "東門店",
    "confidence": 0.92,
    "needs_confirmation": false
  },
  "entity_mentions": [
    {
      "mention_id": "m1",
      "entity_type": "STORE",
      "mention": "東門店",
      "role_in_record": "MANAGEMENT_TARGET",
      "context": "今天去東門店看了一下",
      "confidence": 0.92
    },
    {
      "mention_id": "m2",
      "entity_type": "EMPLOYEE",
      "mention": "小美",
      "role_in_record": "MANAGEMENT_SUBJECT",
      "context": "小美最近保健品成交比較差",
      "confidence": 0.82
    },
    {
      "mention_id": "m3",
      "entity_type": "EMPLOYEE",
      "mention": "王店長",
      "role_in_record": "RESPONSIBLE_PERSON",
      "context": "我跟王店長討論後",
      "confidence": 0.84
    }
  ],
  "management_category": {
    "code": "SALES",
    "confidence": 0.78,
    "secondary_codes": ["TALENT_DEVELOPMENT"]
  },
  "observation": "李小美近期保健品成交表現仍未達預期。",
  "judgment": "商品知識並非主要問題，目前主要需要改善需求詢問能力。",
  "actions": [
    {
      "type": "DISCUSS_WITH_MANAGER",
      "description": "與王店長討論改善方式。"
    },
    {
      "type": "TRAINING",
      "description": "安排本週再進行 2 次陪練。"
    }
  ],
  "responsible_person_mention_id": "m3",
  "metrics": [
    {
      "label": "陪練次數",
      "value": 2,
      "unit": "次",
      "source_text": "陪她兩次"
    }
  ],
  "urgency": "NORMAL",
  "follow_up": {
    "required": true,
    "date": "2026-08-19",
    "date_text": "下週三",
    "timezone": "Asia/Taipei",
    "confidence": 0.88,
    "expected_result": "確認需求詢問能力與保健品成交是否改善。",
    "method": null,
    "needs_confirmation": true
  },
  "suggested_case_title": "東門店－小美保健品銷售改善",
  "case_recommendation": "CHECK_EXISTING",
  "needs_confirmation": ["follow_up.date"],
  "confirmation_questions": [
    "下週三追蹤日期是否正確？"
  ]
}
```

### 6.1 mode

可用值：

- `RECORD_DRAFT`
- `FOLLOWUP_DRAFT`

### 6.2 role_in_record

可用值：

- `MANAGEMENT_TARGET`
- `MANAGEMENT_SUBJECT`
- `RESPONSIBLE_PERSON`
- `MENTIONED_PERSON`
- `OTHER`

被提到的人不等於負責人，也不等於管理對象。

### 6.3 case_recommendation

可用值：

- `NONE`
- `CREATE`
- `CHECK_EXISTING`

AI 只能建議，不得自行建立或合併 Case。

### 6.4 urgency

可用值：

- `NORMAL`
- `IMPORTANT`
- `URGENT`

無法明確判斷時使用 `NORMAL`。不要因為「業績下降」自動判為 `URGENT`。

## 7. Entity Matching 是必要功能

Entity Matching 不是 Optional Enhancement。

正式環境有正式主檔：

- `stores.id`
- `stores.store_code`
- `stores.store_name`
- `stores.short_name`
- `store_employees.id`
- `store_employees.employee_code`
- `store_employees.employee_name`
- `store_employees.position`
- `store_employees.current_position`
- `store_employees.store_id`
- `profiles.id`
- `profiles.employee_code`
- `profiles.full_name`
- `store_managers.store_id`
- `store_managers.user_id`
- `store_managers.role_type`

AI 不得自行產生：

- `store_id`
- `employee_id`
- `profile_id`
- `department_id`
- 任何正式 FK

正式 ID 必須由 Application Layer 依資料庫與權限 scope matching 後取得。

## 8. Entity Matching Pipeline

正式流程：

1. Speech-to-Text。
2. Transcript。
3. AI Semantic Parsing。
4. AI 只輸出 entity mentions。
5. Application 取得目前使用者可見候選。
6. Store Matching。
7. Employee Matching。
8. Pronoun / role matching。
9. Candidate Ranking。
10. Review UI 顯示正式候選。
11. User Confirmation。
12. 取得正式 ID。
13. 組成 DB payload。

## 9. Matching Context Narrowing

不要把全公司所有個資塞進 Prompt。

候選資料縮小順序：

1. 使用者登入身份。
2. SML 權限。
3. `store_managers` 管理範圍。
4. 可見門市。
5. 已選 Today Plan / Case 的 store。
6. 已辨識 store mention。
7. 該 store 下有效人員。
8. 職稱 / 姓名 / 員編 / 代名詞 narrowing。

### 9.1 Manage / Full Admin

具 `supervisor.management_log.manage` 的使用者可看更大範圍，但 API 仍應限制候選筆數與查詢條件，不應無限制載入全部員工。

### 9.2 Team / Supervisor Scope

具 `view_team` 或 follow-up 權限者，候選門市應優先來自 `store_managers` scope。

### 9.3 Owner Scope

只看自己紀錄者，候選資料應以既有 Case / Plan / Record context 為主，不應給全公司人員。

## 10. Store Matching Strategy

門市 matching signals：

1. `store_code` exact，例如 `DEV012`、`012`。
2. `store_name` exact。
3. `short_name` exact。
4. 去除公司品牌詞後比對，例如 `富康台南東門店` vs `東門店`。
5. contains match。
6. normalized fuzzy score。
7. 已選 Case / Plan store context。
8. 使用者管理 scope。

建議 normalized tokens：

- 去空白。
- 全形半形正規化。
- 去除「富康」「藥局」「店」「門市」等可設定 suffix / prefix。
- 數字 code 正規化。

若未來正式資料需要更穩定別名，可評估 `store_aliases`，但 SML-VOICE-1 不新增 DB。

## 11. Employee Matching Strategy

人員 matching 不能只看姓名。

signals：

1. `employee_code` exact。
2. `employee_name` exact。
3. `employee_name` contains，例如「小美」。
4. `position` / `current_position` / `profiles.job_title`。
5. 所屬 `store_id`。
6. 已辨識 store mention。
7. responsible role phrase，例如「店長」「副店長」「主任」「組長」「專員」「新人」「督導」。
8. pronoun antecedent，例如「王店長」後面的「他」。

### 11.1 同名處理

若同一 scope 有多位同名或相近姓名：

- 不得自動選擇。
- Review UI 顯示候選列表。
- 使用者必須選擇。

### 11.2 只有職稱沒有姓名

範例：「我請店長這週陪小美兩次」。

若已確定 store：

- 查該 store `position/current_position/job_title` 為店長者。
- 單一候選可預選，但仍顯示。
- 多位候選需使用者確認。

### 11.3 Multiple People

範例：

「今天看小美跟小王的銷售，小美需求詢問比較弱，小王商品知識不足，我請王店長這週分別陪他們兩次。」

應分離：

- management subjects：小美、小王。
- responsible person：王店長。
- mentioned people：其他被提到但非主體 / 負責人。

目前 DB `supervisor_management_records.employee_id` 只能保存一個員工主體，因此 SML-VOICE-1 應：

- 若多個 management subject，Review UI 要提示「目前正式紀錄主體只能選一位或改成門市 / 其他目標」。
- 其餘人員可暫存在 `metadata.ai_entity_matches` 或 action text 中。
- 不得悄悄丟掉其他人。

## 12. Matching Confidence

建議分級：

### HIGH

條件例：

- exact store code。
- exact employee code。
- store + full name + job title 唯一。

行為：

- 可自動預選。
- Review UI 仍顯示正式資料。

### MEDIUM

條件例：

- store + short name 唯一。
- store + partial employee name 唯一。
- store + job title 唯一。

行為：

- 可建議。
- UI 標示「請確認」。

### LOW

條件例：

- 只有「小美」且多位候選。
- 只有「店長」但 store 不明。

行為：

- 不得預選正式 FK。
- UI 顯示候選問題。
- 使用者選擇後才可儲存。

## 13. Formal Matched Entity Shape

AI parsing 後 entity mention：

```json
{
  "mention_id": "m2",
  "entity_type": "EMPLOYEE",
  "mention": "小美",
  "role_in_record": "MANAGEMENT_SUBJECT",
  "confidence": 0.82
}
```

Application matching 後：

```json
{
  "mention_id": "m2",
  "entity_type": "EMPLOYEE",
  "mention": "小美",
  "role_in_record": "MANAGEMENT_SUBJECT",
  "match_status": "MATCHED",
  "match_confidence": "MEDIUM",
  "selected": {
    "employee_id": "uuid",
    "employee_code": "FK0001",
    "employee_name": "李小美",
    "job_title": "專員",
    "store_id": "uuid",
    "store_code": "012",
    "store_name": "台南東門店"
  },
  "candidates": [
    {
      "employee_id": "uuid",
      "employee_code": "FK0001",
      "employee_name": "李小美",
      "job_title": "專員",
      "store_name": "台南東門店",
      "score": 0.86,
      "reasons": ["store_context", "partial_name_unique"]
    }
  ],
  "needs_confirmation": true
}
```

## 14. Review UI

Review UI 不顯示 raw JSON。

應顯示：

### AI 幫你整理好了

門市：

- 台南東門店
- 門市代號：012
- 來源：「東門店」
- 信心：請確認

管理對象：

- 李小美
- FK0001
- 專員｜台南東門店
- 來源：「小美」
- 信心：請確認

負責人：

- 王XX
- 店長｜台南東門店
- 來源：「王店長 / 他」

發現：

- 李小美近期保健品成交表現仍未達預期。

判斷：

- 商品知識並非主要問題，目前主要需要改善需求詢問能力。

管理動作：

- 與王店長討論改善方式。
- 安排本週再進行 2 次陪練。

後續：

- 需要追蹤。
- 下週三（08/19）。
- 請確認日期。

操作：

- 修改。
- 重新口述。
- 選擇其他門市 / 人員。
- 確認儲存。

## 15. Record Mapping to Existing DB

確認後正式寫入 `supervisor_management_records`：

- `case_id`：使用者選定 / 既有 linked case。
- `record_type`：`MANAGEMENT`。
- `record_date`：今天或 UI 選擇日期。
- `store_id`：confirmed matched store id。
- `employee_id`：confirmed matched primary employee id，若無則 null。
- `category_id`：confirmed category。
- `target_name_snapshot`：正式顯示名稱，例如 `台南東門店` 或 `李小美｜台南東門店`。
- `observation`：review confirmed text。
- `judgment`：review confirmed text。
- `action_summary`：review confirmed text。
- `action_options`：review confirmed action type labels / codes。
- `requires_follow_up`：review confirmed。
- `follow_up_date`：review confirmed date。
- `follow_up_owner_id`：目前欄位 FK 到 `profiles.id`，不是 `store_employees.id`。如果 responsible person 只 match 到 `store_employees`，必須透過 employee_code / user_id 找 profile，找不到時不可填。
- `expected_result`：review confirmed。
- `follow_up_method`：review confirmed。
- `ai_generated`：true。
- `ai_confirmed_by`：目前登入 user id。
- `metadata`：可保存 transcript hash / selected mentions / candidate decisions / model version，但不得保存敏感 token。

## 16. Original Transcript 保存策略

需求上希望可追溯原始口述。

目前 MVP 不新增 DB，因此建議：

- SML-VOICE-1 可先在 `metadata.ai_voice.original_transcript` 保存文字稿。
- 不保存音檔。
- 不保存 raw model response。
- 不保存 OpenAI request headers / tokens。

若未來要做完整 audit，再建立 `supervisor_management_voice_drafts`：

- transcript
- structured draft
- entity matches
- accepted record id / follow-up id
- model name
- status
- error
- created_by
- soft delete

但這是 Phase 2，不屬於 SML-VOICE-1。

## 17. API Design

### 17.1 `POST /api/supervisor-management-log/voice/transcribe`

用途：

- 接收 audio file。
- server-side 呼叫 OpenAI transcription。
- 回傳 transcript。

Request：

- `multipart/form-data`
- `audio`
- `mode`
- optional `context_type`
- optional `case_id`
- optional `daily_plan_id`
- optional `followup_case_id`

Validation：

- 未登入 401。
- 無 SML create / follow-up / update / manage 權限 403。
- 檔案類型限制。
- 單檔大小限制。
- 秒數限制。
- 不支援格式回 400。

Response：

```json
{
  "success": true,
  "data": {
    "transcript": "...",
    "language": "zh-TW",
    "duration_seconds": 48,
    "warnings": []
  }
}
```

### 17.2 `POST /api/supervisor-management-log/voice/draft`

用途：

- 將 transcript 轉成 structured draft。
- 執行 application entity matching。
- 回傳 Review UI 可用資料。

Request：

```json
{
  "mode": "RECORD_DRAFT",
  "transcript": "...",
  "case_id": "uuid",
  "daily_plan_id": "uuid"
}
```

Server steps：

1. Auth。
2. Permission guard。
3. 讀取 visible case / daily plan context。
4. 依 user scope 取得 candidate stores / employees。
5. 呼叫 AI structured parsing。
6. 執行 application entity matching。
7. 回傳 draft + candidates + confirmation questions。

Response：

```json
{
  "success": true,
  "data": {
    "draft": {},
    "entity_matches": [],
    "review_required": true,
    "blocking_fields": [],
    "warnings": []
  }
}
```

### 17.3 不建議 MVP 做 combined endpoint

MVP 先拆成 transcribe 與 draft，方便：

- 重新轉 draft。
- 使用者修改 transcript 後再整理。
- 清楚分辨 transcription error 與 AI parsing error。

## 18. System Prompt 草案

System：

```text
你是督導管理紀錄整理助手。你的任務是把督導的中文口述轉成結構化管理紀錄草稿。

你必須遵守：
1. 所有內容必須可追溯到 transcript。
2. 不得補充 transcript 沒有說的數字、原因、日期、責任人或結論。
3. 不得產生 store_id、employee_id、profile_id 或任何正式資料庫 ID。
4. 只能輸出 entity mentions，正式 Entity Matching 由 application layer 完成。
5. 如果語意不確定，必須標記 needs_confirmation 並提出具體確認問題。
6. 文字要短、準、清楚，不要寫成冗長企業報告。
7. 不得自行建立 Management Case，不得自行結案，不得自行儲存。
8. 僅能使用系統提供的 enum 值。
```

## 19. User Prompt 草案

User payload 組成：

```text
Current local datetime: 2026-08-14T10:30:00+08:00
Timezone: Asia/Taipei
Mode: RECORD_DRAFT

Allowed target types:
- STORE
- EMPLOYEE
- AREA
- CROSS_DEPARTMENT
- OTHER

Allowed categories:
<server 提供目前 active supervisor_management_categories>

Allowed action types:
<server 提供目前正式 action options；若尚無 DB 主檔，使用 application constant>

Context:
- Current case title: ...
- Current case target: ...
- Today plan title: ...
- Known visible stores summary: only names/codes needed
- Known employee context if narrowed: store employees only

Transcript:
"""
...
"""

Return JSON only, matching the provided schema.
```

## 20. Structured Output 與 Validation

建議 SML-VOICE-1 使用 JSON Schema / Structured Outputs。

但要注意：

- Structured Output 只保證 shape。
- 不能取代 entity matching。
- 不能取代 permission / RLS。
- 不能取代 User Review。
- 不能取代 domain validation。

Server 必須在 AI 回傳後做：

1. JSON schema validation。
2. enum validation。
3. length validation。
4. no invented ID validation。
5. transcript faithfulness spot checks via source spans if feasible。
6. entity matching validation。
7. DB payload validation using existing validation helpers。

## 21. 日期解析

規則：

- 使用 request 當下 Asia/Taipei local date/time。
- AI 可輸出 `date_text` 與 parsed `date`。
- 相對日期若不明確，`date = null` 並要求確認。
- UI 顯示「下週三（08/19）」類型文字。
- 使用者確認後才寫入 `follow_up_date` 或 `next_follow_up_date`。

## 22. 錯誤與 Fallback

### 22.1 Microphone denied

- 顯示「瀏覽器未允許麥克風」。
- 提供手動輸入文字稿。

### 22.2 Transcription failed

- 不顯示假成功。
- 保留錄音檔於前端 session，允許重試或重新錄音。

### 22.3 AI parsing failed

- 顯示 transcript。
- 允許使用者手動填入紀錄。
- 不寫 DB。

### 22.4 Matching ambiguous

- 顯示候選。
- 要求使用者選擇。
- 不得自行選擇低信心候選。

### 22.5 Required DB fields incomplete

- 標記 blocking fields。
- 禁用「確認儲存」直到補齊。

### 22.6 Permission / RLS reject

- 顯示安全錯誤。
- 不暴露 SQL / schema / stack trace。

## 23. Phase Plan

### Phase 1：SML-VOICE-1 MVP，不新增 DB

完成：

- `voice/transcribe` API。
- `voice/draft` API。
- Application Entity Matching。
- Voice Sheet。
- Review UI。
- Confirm save to existing record / follow-up API。
- transcript 保存到 record metadata。
- tests / tsc / build。

不做：

- realtime。
- permanent audio storage。
- voice drafts table。
- auto create case。
- auto close case。
- Production 操作。

### Phase 2：Voice Draft Audit

如需要完整追溯：

- 新增 `supervisor_management_voice_drafts`。
- 保存 transcript / draft / match decisions。
- RLS / grants / tests。

### Phase 3：Realtime

若需要邊講邊看字幕：

- 使用 Realtime transcription。
- 支援 partial transcript。
- 支援中斷重連與 session 控制。

### Phase 4：Case Automation

- AI 建議建立 case。
- 使用者確認後才建立。
- Follow-up 已改善時詢問是否結案。
- 不自動結案。

## 24. 驗收標準

SML-VOICE-1 必須通過：

1. 未登入 voice API 回 401。
2. 無 SML 權限回 403。
3. 可錄音、重錄、取消。
4. 可轉文字。
5. AI draft 不會直接寫 DB。
6. AI 不產生正式 ID。
7. Application 可依 scope matching stores / employees。
8. 同名員工會要求人工選擇。
9. store / employee 正式資料會顯示在 Review UI。
10. 使用者可修改 draft。
11. required DB fields 未補齊時不可儲存。
12. 確認後可新增 Management Record。
13. 確認後可新增 Follow-up。
14. transcript 保存策略符合本設計。
15. 不顯示假 AI 成功。
16. 不輸出 key / token / raw model response。
17. `npx tsc --noEmit --pretty false` 通過。
18. `npm run build` 通過。

## 25. 下一個最小任務

**SML-VOICE-1：口述記錄 MVP UI / API 實作，不新增 DB。**

實作順序：

1. 建立 server-side AI client wrapper。
2. 建立 transcript API。
3. 建立 structured draft schema。
4. 建立 entity matching helper：
   - store matching。
   - employee matching。
   - confidence ranking。
5. 建立 draft API。
6. 建立 Voice Sheet UI。
7. 接 Today Plan / Follow-up entry。
8. 接既有 record / follow-up save API。
9. 建立 static / dynamic tests。
10. tsc / build。

禁止：

- 不新增 DB。
- 不建 voice draft table。
- 不保存音檔。
- 不自動建立 Case。
- 不自動結案。
- 不操作 Production。
