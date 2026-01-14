# 協作功能資料庫遷移指南

## 步驟 1：登入 Supabase Dashboard

1. 前往 https://supabase.com/dashboard
2. 選擇您的專案

## 步驟 2：執行 SQL 遷移

1. 在左側選單點擊 **SQL Editor**
2. 點擊 **New Query**
3. 複製並貼上以下 SQL 腳本：

```sql
-- Migration: Add support for collaborative assignments
-- This allows multiple users to work on the same assignment

-- 1. Create assignment_collaborators junction table
CREATE TABLE IF NOT EXISTS assignment_collaborators (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  assignment_id UUID REFERENCES assignments(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(assignment_id, user_id)
);

-- 2. Add index for performance
CREATE INDEX IF NOT EXISTS idx_assignment_collaborators_assignment 
  ON assignment_collaborators(assignment_id);
CREATE INDEX IF NOT EXISTS idx_assignment_collaborators_user 
  ON assignment_collaborators(user_id);

-- 3. Migrate existing assignments to collaborators table
INSERT INTO assignment_collaborators (assignment_id, user_id)
SELECT id, assigned_to 
FROM assignments 
WHERE assigned_to IS NOT NULL
ON CONFLICT (assignment_id, user_id) DO NOTHING;

-- 4. Enable RLS
ALTER TABLE assignment_collaborators ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies
-- Users can view their own collaborations
CREATE POLICY "Users can view their collaborations" 
  ON assignment_collaborators
  FOR SELECT 
  USING (auth.uid() = user_id);

-- Admins can view all collaborations
CREATE POLICY "Admins can view all collaborations" 
  ON assignment_collaborators
  FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role IN ('admin', 'manager')
    )
  );

-- Admins can insert collaborations
CREATE POLICY "Admins can insert collaborations" 
  ON assignment_collaborators
  FOR INSERT 
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role IN ('admin', 'manager')
    )
  );

-- Admins can delete collaborations
CREATE POLICY "Admins can delete collaborations" 
  ON assignment_collaborators
  FOR DELETE 
  USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role IN ('admin', 'manager')
    )
  );
```

4. 點擊 **Run** 按鈕執行腳本
5. 確認顯示 "Success" 訊息

## 步驟 3：驗證遷移

執行以下查詢來確認資料表已建立：

```sql
SELECT * FROM assignment_collaborators LIMIT 10;
```

## 完成！

資料庫遷移完成後，返回 VS Code 告知我，我會繼續完成程式碼的修改。
