# 藥師主檔權限 Migration 執行指南

## 問題說明

原始 migration 執行失敗，錯誤訊息：
```
ERROR: 23505: duplicate key value violates unique constraint "idx_permissions_module_feature_action"
```

**根本原因**：新權限的 (module, feature, action) 組合與既有權限衝突。
- 既有權限：(store, pharmacist_management, view/edit)
- 原始新權限：(store, pharmacist_management, master.view/master.edit) ❌ 衝突

## 解決方案

已修復 migration 檔案，改變 feature 為 `pharmacist_master`：
- 新權限：(store, pharmacist_master, view/edit) ✅ 無衝突

**檔案位置**：`supabase/migration_pharmacist_master_rbac.sql`

## 執行步驟

### 方法 1：在 Supabase Dashboard 中執行

1. 登入 [Supabase Dashboard](https://app.supabase.com)
2. 進入 SQL Editor
3. 打開新的查詢窗口
4. 複製以下內容到查詢框：

```sql
-- ============================================================
-- 藥師管理 - 藥師主檔子權限拆分
-- ============================================================

-- 1. 新增子權限代碼
INSERT INTO permissions (module, feature, code, action, description)
VALUES
  ('store', 'pharmacist_master', 'pharmacist.management.master.view', 'view', '藥師管理-主檔檢視：查看藥師基本資料與學位資訊'),
  ('store', 'pharmacist_master', 'pharmacist.management.master.edit', 'edit', '藥師管理-主檔編輯：可編輯藥師基本資料')
ON CONFLICT (code) DO UPDATE SET
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  action = EXCLUDED.action,
  description = EXCLUDED.description;

-- 2. 授予 business_manager：master.view + master.edit
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r
JOIN permissions p ON p.code IN ('pharmacist.management.master.view', 'pharmacist.management.master.edit')
WHERE r.code = 'business_manager'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.permission_id = p.id
  );

-- 3. 授予 supervisor_role：master.view
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r
JOIN permissions p ON p.code = 'pharmacist.management.master.view'
WHERE r.code = 'supervisor_role'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.permission_id = p.id
  );

-- 4. 授予 admin_role：master.view + master.edit
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r
JOIN permissions p ON p.code IN ('pharmacist.management.master.view', 'pharmacist.management.master.edit')
WHERE r.code = 'admin_role'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id
      AND rp.permission_id = p.id
  );

-- 5. 驗證
SELECT
  r.code AS role_code,
  p.code AS permission_code,
  rp.is_allowed
FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
JOIN permissions p ON p.id = rp.permission_id
WHERE p.code IN ('pharmacist.management.master.view', 'pharmacist.management.master.edit')
  AND r.code IN ('business_manager', 'supervisor_role', 'admin_role')
ORDER BY r.code, p.code;
```

5. 點擊 "Run" 執行查詢
6. 如果執行成功，應看到驗證查詢的結果顯示 6 筆記錄（每個角色對應的權限）

### 方法 2：使用 Supabase CLI

如果有本地 Supabase CLI 安裝：

```bash
# 登入 Supabase
supabase login

# 執行 migration
supabase db push
```

## 驗證執行成功

執行完成後，應看到類似的查詢結果：

| role_code | permission_code | is_allowed |
|-----------|-----------------|-----------|
| admin_role | pharmacist.management.master.edit | t |
| admin_role | pharmacist.management.master.view | t |
| business_manager | pharmacist.management.master.edit | t |
| business_manager | pharmacist.management.master.view | t |
| supervisor_role | pharmacist.management.master.view | t |

共 5 筆記錄（supervisor_role 無編輯權限）。

## 前端驗證

部署代碼後，檢查：
1. 業務經理和系統管理員可看到「藥師主檔」Tab
2. 監督員可看到「藥師主檔」Tab 但無法編輯
3. 無相應權限的用戶無法看到該 Tab

## 常見問題

### 問題：執行仍失敗並顯示約束錯誤

**原因**：可能是舊版本的 migration 仍在系統中
**解決**：
1. 確認刪除或註解掉舊的 migration 檔案內容
2. 確保使用修復後的版本（feature 為 'pharmacist_master'）

### 問題：權限無法生效

**原因**：可能需要重新登入或重新部署前端
**解決**：
1. 清除瀏覽器 cookie 後重新登入
2. 確認前端代碼已部署到最新版本（commit 2d47994 或更新）

## 相關檔案

- **Migration 檔案**：`supabase/migration_pharmacist_master_rbac.sql`
- **前端實現**：`app/admin/pharmacist-management/page.tsx`
- **變更文檔**：`PHARMACIST_MASTER_RBAC_SPLIT.md`

## Git 提交記錄

- **Commit 5724f2c**：初始實施（含原始 migration）
- **Commit 2d47994**：修復 migration（修正唯一約束衝突）

兩個 commit 都已推送至 main 分支。

---

如有任何問題或執行失敗，請檢查：
1. Supabase 項目 URL 和密鑰是否正確
2. 是否有適當的執行權限（通常需要 admin 或 service role）
3. permissions 表中是否已有相同代碼的紀錄（檢查是否已執行過）
