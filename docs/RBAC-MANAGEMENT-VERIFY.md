# RBAC Management Verification

最後更新：2026-07-24

本文件是 DEV 測試區「使用者管理 / 角色權限管理」下一輪驗收清單。它只描述驗收方式，不代表已完成 dynamic test 或人工 UI 複驗。

## 目標

確認 DEV 測試區 RBAC 管理流程接近正式區邏輯：

- 使用者先註冊或已存在於 Auth / profiles。
- 系統管理員可搜尋使用者。
- 使用者管理可查看 active roles、effective permission codes、permission source roles 與 store manager scope。
- 角色權限管理可依 effective permissions 顯示查看、編輯、停用、刪除、指派與移除操作。
- `dev-no-ga@example.test` 沒有管理權限。
- 驗收不得使用 service role 繞過 authenticated API。

## 執行前條件

- dev server 已在 `http://localhost:3002` ready。
- App DEV Guard 與 CLI DEV Guard 指向 DEV `mjpd...mtqr`。
- 不得命中 Production 候選 `odvksgucvfoaqrumpran`。
- 不得輸出或貼上 password、JWT、refresh token、cookie 或 Supabase key。

## 安全預檢

建議先執行本機 ready check，一次列出測試範圍並跑 safe preflight：

```powershell
npm run test:rbac-local-ready
```

或分開執行：

```powershell
npm run test:rbac-user-management-cases
npm run test:rbac-safe-preflight
```

預期：

- dev server ready check 回 200。
- dynamic scripts 只做 `node --check`。
- RBAC formal static guard 通過。
- admin / role / user RBAC API 未登入 smoke test 回 401 或頁面 redirect，不得 500。
- 不執行 service-role 寫入測試。
- 不執行 Supabase CLI。

## Authenticated Dynamic Test

可先查看測試範圍，不會登入、不會要求密碼、不會打 API：

```powershell
npm run test:rbac-user-management-cases
```

執行：

```powershell
npm run test:rbac-user-management-dev
```

腳本會要求在 Terminal hidden prompt 輸入：

- `dev-full-admin@example.test`
- `dev-no-ga@example.test`

不得把密碼貼到對話或寫入檔案。

預期 PASS：

- `unauthenticated search is 401`
- `no_access search is 403`
- `full admin can search all manual DEV verification accounts`
- `short query returns empty array`
- `DEV Full Admin can query user RBAC details`
- `no_access cannot query another user RBAC details`
- `role and effective permission sources are readable`
- `known DEV account permission expectations`
- `store manager scope is displayed separately`
- `DEV test account indicator is display-only`
- `admin compatibility is explicit and not a fake permission source`
- `RBAC user management dynamic tests passed`

若 `no_access search is 403` 回 401 `未登入`：

- 先確認腳本仍使用 `@supabase/ssr` 相容的 `base64url` session cookie。
- 不要把 401 直接判定為 RBAC 權限失敗。
- 不要為了讓測試通過而改 API 回應或降低 403 預期。

腳本成功時會輸出 `RBAC user management verification summary`，內容只包含非敏感資訊：

- email
- role code / name
- effective permission codes
- store code / store name
- legacy compatibility 顯示資訊

請將這段摘要連同 PASS / FAIL 結果貼回，不要貼任何密碼、JWT、refresh token、cookie 或 key。

四個人工 DEV 帳號必須可被 full admin 搜尋並取得 RBAC detail：

- `dev-ga-access@example.test`
- `dev-ga-manage@example.test`
- `dev-ga-view@example.test`
- `dev-no-ga@example.test`

## UI 人工複驗

使用 `dev-full-admin@example.test` 登入 `http://localhost:3002`。

### 使用者管理

| 操作 | 預期畫面 / 結果 | 通過 |
| --- | --- | --- |
| 進入使用者管理 | 頁面可載入，不出現 schema cache 或 500 錯誤 |  |
| 搜尋 `dev-ga-access@example.test` | 列表可找到該使用者 |  |
| 搜尋 `dev-ga-manage@example.test` | 列表可找到該使用者 |  |
| 搜尋 `dev-ga-view@example.test` | 列表可找到該使用者 |  |
| 搜尋 `dev-no-ga@example.test` | 列表可找到該使用者 |  |
| 查看列表欄位 | 可看到 RBAC 角色、有效權限數與門市範圍數 |  |
| 點擊「查看角色與權限」 | modal 顯示基本資料、active roles、effective permission codes、source roles、store manager scope |  |
| 查看 legacy compatibility | 舊 `profiles.role` / admin compatibility 與正式 RBAC source 分開標示 |  |

### 角色權限管理

| 操作 | 預期畫面 / 結果 | 通過 |
| --- | --- | --- |
| 進入角色權限管理 | 列表可載入，不出現 500 |  |
| 點擊可查看角色 | 可進入詳情頁 |  |
| 查看權限分頁 | 可看到 permission codes |  |
| 查看使用者分頁 | 可看到已指派使用者或空狀態 |  |
| 以員編搜尋使用者 | 可依 `profiles.employee_code` 搜尋 DEV 使用者 |  |
| 指派 / 移除角色 | 依 full admin effective permissions 顯示操作 |  |
| 缺權限操作 | UI 不顯示或 server-side API 回 403 |  |

### no_access 驗證

使用 `dev-no-ga@example.test` 登入。

| 操作 | 預期畫面 / 結果 | 通過 |
| --- | --- | --- |
| 查看導覽 | 不應看到使用者管理或角色權限管理入口 |  |
| 直接輸入 `/admin/users` | 不可取得管理資料 |  |
| 直接輸入 `/admin/roles` | 不可取得管理資料 |  |

## 禁止事項

- 不執行 `scripts/test-rbac-navbar-permissions-dev.js`，除非使用者明確批准 service-role 重型寫入驗收。
- 不執行 DB migration、push、repair、reset 或 rollback。
- 不用 service role 代替 authenticated API 驗證。
- 不修改已套用 migration。
- 不開始 Task 1C-3。

## 回報格式

完成後回報：

- `npm run test:rbac-safe-preflight` 結果。
- `npm run test:rbac-user-management-dev` 最終 PASS / FAIL。
- 若 FAIL，第一個失敗案例、HTTP status 與已遮罩錯誤。
- 四個 DEV 帳號的 roles、effective permission codes 與 store scope 是否可見。
- `RBAC user management verification summary` 的非敏感摘要。
- 使用者管理 UI 人工複驗結果。
- 角色權限管理 UI 人工複驗結果。
- no_access 驗證結果。
