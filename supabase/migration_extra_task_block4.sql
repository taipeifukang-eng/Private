-- 更新獎金區塊計算邏輯：長照外務/診所業務歸類到區塊4
-- 執行日期: 2026-01-28

-- 更新 calculate_bonus_block 函數，加入 p_extra_tasks 參數
CREATE OR REPLACE FUNCTION calculate_bonus_block(
  p_employment_type VARCHAR,
  p_monthly_status VARCHAR,
  p_is_pharmacist BOOLEAN,
  p_position VARCHAR,
  p_is_dual_position BOOLEAN,
  p_is_supervisor_rotation BOOLEAN,
  p_work_days NUMERIC DEFAULT NULL,
  p_extra_tasks TEXT[] DEFAULT NULL
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
  
  -- 區塊 4：特殊時數 (督導(代理店長)-雙 或 長照外務/診所業務)
  -- 1. 檢查職位中同時包含「督導」和「代理店長」且標記為雙職務
  IF p_position LIKE '%督導%' 
     AND p_position LIKE '%代理店長%' 
     AND p_is_dual_position THEN
    RETURN 4;
  END IF;
  
  -- 2. 檢查是否有長照外務或診所業務
  IF p_extra_tasks IS NOT NULL 
     AND (
       '長照外務' = ANY(p_extra_tasks) 
       OR '診所業務' = ANY(p_extra_tasks)
     ) THEN
    RETURN 4;
  END IF;
  
  -- 區塊 3：店長-雙、代理店長-雙（不包含督導）
  IF p_is_dual_position 
     AND (p_position LIKE '%店長%' OR p_position LIKE '%代理店長%')
     AND p_position NOT LIKE '%督導%' THEN
    RETURN 3;
  END IF;
  
  -- 區塊 3：非整月正職 或 上班天數為0的正職
  IF p_employment_type = 'full_time' 
     AND (p_monthly_status != 'full_month' OR p_work_days = 0) THEN
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

-- 更新觸發器函數，傳入 extra_tasks 參數
CREATE OR REPLACE FUNCTION update_calculated_block()
RETURNS TRIGGER AS $$
BEGIN
  NEW.calculated_block := calculate_bonus_block(
    NEW.employment_type,
    NEW.monthly_status,
    NEW.is_pharmacist,
    NEW.position,
    NEW.is_dual_position,
    NEW.is_supervisor_rotation,
    NEW.work_days,
    NEW.extra_tasks
  );
  NEW.updated_at := TIMEZONE('utc', NOW());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 更新現有資料的 calculated_block（有長照外務或診所業務的人員）
UPDATE monthly_staff_status
SET calculated_block = 4,
    updated_at = TIMEZONE('utc', NOW())
WHERE extra_tasks IS NOT NULL
  AND (
    '長照外務' = ANY(extra_tasks)
    OR '診所業務' = ANY(extra_tasks)
  )
  AND calculated_block != 4;
