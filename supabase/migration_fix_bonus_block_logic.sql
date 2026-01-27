-- 修正獎金區塊計算邏輯
-- 根據新的規則：
-- 區塊1: 正職整月 + 督導(代理店長)
-- 區塊2: 督導卡班
-- 區塊3: 非整月正職 + 店長-雙 + 代理店長-雙
-- 區塊4: 特殊時數 (督導(代理店長)-雙)
-- 區塊5: 兼職藥師
-- 區塊6: 兼職一般人

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
  
  -- 區塊 1：督導(代理店長) - 不是雙職務的情況
  IF p_position LIKE '%督導%' 
     AND p_position LIKE '%代理店長%' 
     AND NOT p_is_dual_position THEN
    RETURN 1;
  END IF;
  
  -- 預設返回 0 (未分類)
  RETURN 0;
END;
$$ LANGUAGE plpgsql;

-- 說明：
-- 1. 督導(代理店長) → 區塊1
-- 2. 督導(代理店長)-雙 → 區塊4
-- 3. 店長-雙、代理店長-雙（不含督導） → 區塊3
-- 4. 正職非整月（新進、離職等） → 區塊3
-- 5. 正職整月 → 區塊1
