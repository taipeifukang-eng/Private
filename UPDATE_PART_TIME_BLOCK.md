# 更新兼職專員區塊分配說明

## 問題
兼職藥師和兼職專員在編輯頁面預覽顯示區塊5，但儲存後在列表頁面仍顯示區塊6。

## 原因
資料庫中的 `calculate_bonus_block` 函數尚未更新為最新邏輯。

## 解決方案

### 步驟 1: 執行 SQL 更新腳本

在 Supabase SQL Editor 中執行以下文件：
```
supabase/update_bonus_block_logic.sql
```

或直接複製以下 SQL 執行：

```sql
-- 更新 calculate_bonus_block 函數
CREATE OR REPLACE FUNCTION calculate_bonus_block(
  p_employment_type VARCHAR,
  p_monthly_status VARCHAR,
  p_is_pharmacist BOOLEAN,
  p_position VARCHAR,
  p_is_dual_position BOOLEAN,
  p_is_supervisor_rotation BOOLEAN
) RETURNS INTEGER AS $$
BEGIN
  -- 區塊 2：督導卡班（最優先）
  IF p_is_supervisor_rotation THEN
    RETURN 2;
  END IF;
  
  -- 區塊 5：兼職藥師 和 兼職專員
  IF p_employment_type = 'part_time' AND (p_is_pharmacist OR p_position LIKE '%兼職專員%') THEN
    RETURN 5;
  END IF;
  
  -- 區塊 6：兼職一般人（兼職助理等）
  IF p_employment_type = 'part_time' THEN
    RETURN 6;
  END IF;
  
  -- 區塊 4：特殊時數 (督導(代理店長)-雙)
  IF p_position LIKE '%督導%' 
     AND p_position LIKE '%代理店長%' 
     AND p_is_dual_position THEN
    RETURN 4;
  END IF;
  
  -- 區塊 3：店長-雙、代理店長-雙（不包含督導）
  IF p_is_dual_position 
     AND (p_position LIKE '%店長%' OR p_position LIKE '%代理店長%')
     AND p_position NOT LIKE '%督導%' THEN
    RETURN 3;
  END IF;
  
  -- 區塊 3：非整月正職（新進、離職、留停等）
  IF p_employment_type = 'full_time' 
     AND p_monthly_status IN ('new_hire', 'resigned', 'leave_of_absence', 'transferred_in', 'transferred_out') THEN
    RETURN 3;
  END IF;
  
  -- 區塊 1：正職整月
  IF p_employment_type = 'full_time' AND p_monthly_status = 'full_month' THEN
    RETURN 1;
  END IF;
  
  RETURN 0;
END;
$$ LANGUAGE plpgsql;

-- 重新計算所有現有兼職專員的區塊
UPDATE monthly_staff_status
SET calculated_block = 5,
    updated_at = TIMEZONE('utc', NOW())
WHERE employment_type = 'part_time'
  AND position LIKE '%兼職專員%'
  AND calculated_block != 5;
```

### 步驟 2: 驗證更新

執行完成後，系統會自動：
1. ✅ 更新 `calculate_bonus_block` 函數邏輯
2. ✅ 將所有現有的兼職專員記錄從區塊6更新為區塊5
3. ✅ 之後新增或編輯的兼職專員/兼職藥師都會自動分配到區塊5

### 步驟 3: 測試

1. 重新載入頁面
2. 查看黃采淳 (FK0744) 的區塊，應該顯示「區塊 5」
3. 編輯並儲存該員工，區塊應該保持為「區塊 5」

## 區塊分配規則（更新後）

- **區塊 1**: 正職整月
- **區塊 2**: 督導卡班
- **區塊 3**: 非整月正職 / 店長-雙 / 代理店長-雙
- **區塊 4**: 督導(代理店長)-雙
- **區塊 5**: 兼職藥師 + **兼職專員**
- **區塊 6**: 其他兼職人員（兼職助理等）
