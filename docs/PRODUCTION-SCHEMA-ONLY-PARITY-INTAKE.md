# Production Schema-only Parity Intake

最後更新：2026-07-23

## 1. Purpose

本文件定義 P1-A「Production Schema-only Parity Intake」流程。

目標是參考正式區 Supabase 的 schema 結構，讓 DEV 逐步補齊與正式區一致的功能模組、資料表欄位、constraints、functions、RLS、grants 與 permission reference。

這不是資料搬移。正式區已寫入的營運資料不得複製到 DEV。

## 2. Allowed And Forbidden

允許：

- Production schema-only SQL。
- Production Storage bucket / policy 結構資訊。
- Production Auth config / schema 結構資訊，但不得包含 Auth users rows。
- 非敏感 system reference，例如 permission code 定義。
- DEV 假資料、假門市、假員工、假角色、假工單、假庫存交易。

禁止：

- Production data rows。
- `auth.users` 帳號資料。
- password、JWT、access token、refresh token、anon key、service role key、connection string。
- Storage object rows、照片、附件、signed URL。
- 正式員工個資、正式門市營運資料、工單、盤點、庫存、銷售、績效、獎金、audit logs。
- 直接把 Production dump 套到 DEV。
- 在 Codex 對話中貼正式區密碼或 key。

## 3. Where To Put Local Dumps

建議把 schema-only 檔案放在 repo root 的本機忽略目錄：

```text
schema-intake/
  production-public.schema-only.sql
  production-storage.schema-only.sql
  production-auth-structure.schema-only.sql
```

`.gitignore` 已排除：

- `schema-intake/*`
- `*.schema-only.sql`
- `*.schema.sql`
- `*.schema-diff.json`

仍請人工確認 `git status`，不可 commit schema dump 或任何 secret。

## 4. Recommended Production Export

只可在使用者自己的 Terminal 執行，密碼只能互動輸入或使用安全方式暫時設定，不能寫入命令列、`.env` 或 Git。

概念命令如下，實際連線字串由使用者在本機安全取得，不貼到對話：

```powershell
pg_dump --schema-only --schema=public --no-owner --no-privileges --file schema-intake/production-public.schema-only.sql "<PRODUCTION_DATABASE_URL>"
```

若需要比對 grants，可另做一份保留 ACL 的 schema-only 檔，但仍不得包含資料：

```powershell
pg_dump --schema-only --schema=public --no-owner --file schema-intake/production-public-with-grants.schema-only.sql "<PRODUCTION_DATABASE_URL>"
```

注意：

- 不使用 `--data-only`。
- 不匯出資料列。
- 不匯出 `auth.users` rows。
- 不匯出 `storage.objects` rows。
- 不將連線字串貼到對話。
- 不要求 Codex 連 Production。

## 5. Local Comparison Command

Production schema-only 檔案準備好後，可用本機腳本比對目前 DEV migrations：

```powershell
node scripts/compare-schema-only-parity.js --production schema-intake/production-public.schema-only.sql --dev supabase/migrations
```

腳本特性：

- 只讀本機檔案。
- 不連 Supabase。
- 檢查輸入是否疑似含 `INSERT`、`COPY`、`auth.users`、`storage.objects`、password/token/key/project ref。
- 輸出 table、column、function、trigger、policy、constraint、index、grant 的差異摘要。

若腳本偵測到資料列或敏感標記，會停止並回報，不會輸出 secret 值。

## 6. Interpretation Rules

比對結果分類：

| State | Meaning | Action |
| --- | --- | --- |
| MATCH | DEV 與 Production 結構一致 | 不處理 |
| DEV_MISSING | Production 有、DEV 缺 | 依依賴順序設計 DEV parity migration |
| DEV_EXTRA | DEV 有、Production 缺 | 判斷是否為 DEV-only seed/test artifact 或尚未推 Production 的新功能 |
| COLUMN_DIFF | 同名 table 欄位不同 | 不直接改，先分析型別/default/nullability/constraint 影響 |
| GRANT_DIFF | grants 不一致 | 檢查是否為 Supabase 平台差異或實際安全 gap |
| UNKNOWN | 無法從 schema-only 判斷 | 需要 RLS/policy/function/config 證據 |

## 7. DEV Migration Strategy

正式區 schema-only 只作為參考，不直接套用。

每個補齊階段需：

1. 產出設計與 SQL 草案。
2. 確認不包含 Production data。
3. 確認不修改已套用 migrations。
4. 建立新的 forward migration。
5. DEV guard + CLI guard。
6. `migration list`。
7. `db push --dry-run`。
8. 使用者批准。
9. `db push` 到 DEV。
10. DB test SQL / RLS / API / UI 驗收。
11. 文件更新。

## 8. First Recommended Phase

第一個最小階段仍是：

**P1 Core Reference / RBAC / Store Compatibility schema parity 設計**

原因：

- Navbar 是否顯示門市管理、每月人員狀態、督導巡店、跨部門管理，首先取決於 effective permissions。
- 使用者管理與角色指派需要 `profiles`、`user_roles`、`role_permissions`、`permissions` 與 `store_employees` / employee code 相容。
- 若不先補 permission reference 與 store/personnel compatibility，即使把頁面入口打開，也會出現權限錯誤或缺表錯誤。

本階段不處理：

- Task 1C-3。
- Production data copy。
- 直接恢復所有 legacy modules。
- 直接修改 remote schema。

## 9. Completion Criteria

P1-A 完成時需回報：

- Production schema-only 檔案是否已安全放在 ignored path。
- 敏感資訊掃描是否通過。
- Production vs DEV tables 差異。
- Production vs DEV columns 差異。
- functions / triggers / policies / grants 差異。
- 優先補齊順序。
- 哪些差異需要人工判斷。
- 下一個可審查 migration 設計範圍。

## 10. Current Intake Result

狀態：**已完成 Production public schema-only 本機取得與初步 parity scan。**

Production schema-only 檔案：

- Path：`schema-intake/production-public.schema-only.sql`
- Size：385,733 bytes
- SHA-256：`CF52046B1E63F02FD0EE181CF3E78A18B76D1B237B6974455B85EB5F59B912DE`
- Git 狀態：位於 `.gitignore` 排除路徑，不得 commit。

執行指令：

```powershell
node --check scripts/compare-schema-only-parity.js
node scripts/compare-schema-only-parity.js --production schema-intake/production-public.schema-only.sql --dev supabase/migrations
```

結果：

- `node --check`：通過。
- schema-only parity scan：通過，未發現 top-level data dump 或 secret marker 阻擋項。
- Production public schema-only：83 tables、33 functions、220 policies、38 triggers、165 indexes、339 constraints、370 grants。
- DEV migrations：19 tables、40 functions、42 policies、15 triggers、78 indexes、128 constraints、156 grants。
- DEV missing Production tables：76。
- DEV extra tables：12，主要是 DEV-first 總務 1B / 1C 新模組。
- 同名 table column diff：7 tables。

下一步：

**P1-B Production / DEV schema diff 解讀與 Core Reference / RBAC / Store Compatibility schema parity 設計。**

P1-B 仍需先設計，不得直接套 Production dump，不得複製 Production data，不得修改已套用 migrations。
