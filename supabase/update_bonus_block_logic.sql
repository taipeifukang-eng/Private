-- 更新獎金區塊計算邏輯：兼職專員歸類到區塊5
-- 執行日期: 2026-01-26

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
  -- 檢查職位中同時包含「督導」和「代理店長」且標記為雙職務
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
  
  -- 區塊 3：非整月正職（所有非full_month的正職）
  IF p_employment_type = 'full_time' 
     AND p_monthly_status != 'full_month' THEN
    RETURN 3;
  END IF;
  
  -- 區塊 1：正職整月（包含督導(代理店長)但不是雙職務）
  IF p_employment_type = 'full_time' AND p_monthly_status = 'full_month' THEN
    RETURN 1;
  END IF;
  
  -- 預設返回 0 (未分類)
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

-- 顯示更新結果
SELECT 
  COUNT(*) as updated_count,
  '兼職專員已更新為區塊5' as message
FROM monthly_staff_status
WHERE employment_type = 'part_time'
  AND position LIKE '%兼職專員%'
  AND calculated_block = 5;
