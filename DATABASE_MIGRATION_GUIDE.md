# 修復刪除功能 - 數據庫 Migration 指南

## 問題說明
刪除任務時出現錯誤：`update or delete on table "assignments" violates foreign key constraint "logs_assignment_id_fkey" on table "logs"`

這是因為數據庫外鍵約束沒有設置級聯刪除 (CASCADE DELETE)。

## 解決方案
在 Supabase 中執行 SQL migration 來修復外鍵約束。

## 執行步驟

### 方法 1：通過 Supabase Dashboard（推薦）

1. 訪問 https://supabase.com/dashboard
2. 選擇您的專案
3. 點擊左側選單的 **SQL Editor**
4. 點擊 **New query**
5. 複製並貼上以下 SQL 代碼：

```sql
-- Fix foreign key constraints for cascade delete
ALTER TABLE logs
DROP CONSTRAINT IF EXISTS logs_assignment_id_fkey,
ADD CONSTRAINT logs_assignment_id_fkey 
  FOREIGN KEY (assignment_id) 
  REFERENCES assignments(id) 
  ON DELETE CASCADE;

ALTER TABLE assignment_collaborators
DROP CONSTRAINT IF EXISTS assignment_collaborators_assignment_id_fkey,
ADD CONSTRAINT assignment_collaborators_assignment_id_fkey 
  FOREIGN KEY (assignment_id) 
  REFERENCES assignments(id) 
  ON DELETE CASCADE;

ALTER TABLE assignments
DROP CONSTRAINT IF EXISTS assignments_template_id_fkey,
ADD CONSTRAINT assignments_template_id_fkey 
  FOREIGN KEY (template_id) 
  REFERENCES templates(id) 
  ON DELETE CASCADE;
```

6. 點擊 **Run** 按鈕執行
7. 確認顯示 "Success. No rows returned"

### 方法 2：使用 Supabase CLI（如果已安裝）

如果您已安裝 Supabase CLI，可以運行：

```bash
supabase db push
```

## 驗證修復

執行完 migration 後，可以運行以下 SQL 來驗證約束已正確設置：

```sql
SELECT 
  tc.table_name, 
  tc.constraint_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  rc.delete_rule
FROM information_schema.table_constraints AS tc 
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
LEFT JOIN information_schema.referential_constraints AS rc
  ON tc.constraint_name = rc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY' 
  AND tc.table_name IN ('logs', 'assignments', 'assignment_collaborators')
ORDER BY tc.table_name;
```

確認 `delete_rule` 欄位顯示為 `CASCADE`。

## 測試刪除功能

1. 訪問 https://private-iota-silk.vercel.app/admin/templates
2. 找到有已完成任務的流程卡片
3. 點擊右上角的三個點選單
4. 點擊刪除按鈕
5. 確認刪除成功

## 注意事項

執行此 migration 後：
- 刪除 assignment 時會自動刪除相關的 logs 和 collaborators
- 刪除 template 時會自動刪除相關的 assignments（及其 logs 和 collaborators）
- 此操作不可逆，請確保在生產環境中謹慎使用
