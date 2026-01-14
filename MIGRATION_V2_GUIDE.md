# 部門區塊式任務系統 V2 - Migration 指南

## 概述

此版本將任務系統升級為「部門區塊式」設計，讓每個任務可以包含多個部門區塊，每個區塊有自己的：
- 指定部門
- 指派人員（該部門的成員）
- 專屬步驟

用戶只會看到自己被指派的部門區塊中的步驟，而不是整個任務的所有步驟。

## 資料庫結構變更

### 1. templates 表格新增欄位

```sql
-- sections 欄位儲存部門區塊資訊
ALTER TABLE templates 
ADD COLUMN IF NOT EXISTS sections JSONB DEFAULT '[]'::jsonb;
```

**sections 結構範例：**
```json
[
  {
    "id": "section-1234567890",
    "department": "營業部",
    "assigned_users": ["user-id-1", "user-id-2"],
    "steps": [
      { "id": "1", "label": "確認開店準備", "required": true },
      { "id": "2", "label": "檢查庫存", "required": true }
    ]
  },
  {
    "id": "section-0987654321",
    "department": "行政部",
    "assigned_users": ["user-id-3"],
    "steps": [
      { "id": "3", "label": "更新報表", "required": true }
    ]
  }
]
```

### 2. assignment_collaborators 表格新增欄位

```sql
-- section_id 追蹤每個協作者被指派到哪個區塊
ALTER TABLE assignment_collaborators 
ADD COLUMN IF NOT EXISTS section_id TEXT;

CREATE INDEX IF NOT EXISTS idx_assignment_collaborators_section 
  ON assignment_collaborators(section_id);
```

## 執行 Migration

在 Supabase SQL Editor 中執行以下檔案：

```bash
supabase/migration_v2_department_sections.sql
```

或手動執行：

```sql
-- Part 1: templates 表格
ALTER TABLE templates 
ADD COLUMN IF NOT EXISTS sections JSONB DEFAULT '[]'::jsonb;

-- Part 2: assignment_collaborators 表格
ALTER TABLE assignment_collaborators 
ADD COLUMN IF NOT EXISTS section_id TEXT;

CREATE INDEX IF NOT EXISTS idx_assignment_collaborators_section 
  ON assignment_collaborators(section_id);
```

## 新功能說明

### 建立任務流程

1. 填寫任務標題和描述
2. 點擊「新增部門區塊」
3. 選擇部門（從已有用戶的部門自動取得）
4. 勾選該部門中要指派的人員
5. 為該部門區塊添加專屬的步驟
6. 重複步驟 2-5 添加更多部門區塊
7. 儲存任務

### 用戶視角

- 用戶只會看到自己被指派的部門區塊中的步驟
- 進度條只計算該用戶負責的步驟
- 顯示用戶所屬的部門名稱

### 後向相容性

- 舊的任務（沒有 sections）會繼續正常運作
- 新的任務會同時儲存 `steps_schema`（扁平化步驟列表）以確保相容性

## 檔案變更清單

### 類型定義
- `types/workflow.ts` - 新增 `DepartmentSection` interface

### Server Actions
- `app/actions.ts`
  - `createTemplateV2()` - 建立含部門區塊的任務
  - `updateTemplateV2()` - 更新含部門區塊的任務
  - `getAllDepartments()` - 取得所有部門列表
  - `getUsersByDepartment()` - 取得指定部門的用戶
  - `getAssignment()` - 修改為過濾用戶的部門步驟
  - `getAssignments()` - 修改為過濾用戶的部門步驟

### 元件
- `components/admin/WorkflowBuilderV2.tsx` - 新的 Tab 式部門區塊建立器
- `components/user/ChecklistRunner.tsx` - 顯示用戶的部門資訊

### 頁面
- `app/admin/create/page.tsx` - 使用 WorkflowBuilderV2

## 驗證 Migration

執行以下查詢確認欄位已新增：

```sql
-- 檢查 templates 表格
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'templates' AND column_name = 'sections';

-- 檢查 assignment_collaborators 表格
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'assignment_collaborators' AND column_name = 'section_id';
```
