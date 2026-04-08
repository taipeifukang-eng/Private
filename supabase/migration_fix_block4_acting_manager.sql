-- 修正獎金區塊計算邏輯：督導+雙職務+擔任代理店長 → 區塊4
-- 問題：職位為「督導」且勾選「是否擔任代理店長」與「雙職務」時，
--       因 position 欄位不含「代理店長」字串，導致被誤判為區塊3
-- 修正：在區塊4條件加入 p_is_acting_manager 參數
-- 執行日期: 2026-04-08

-- 更新 calculate_bonus_block 函數，加入 p_is_acting_manager 參數
CREATE OR REPLACE FUNCTION calculate_bonus_block(
  p_employment_type VARCHAR,
  p_monthly_status VARCHAR,
  p_is_pharmacist BOOLEAN,
  p_position VARCHAR,
  p_is_dual_position BOOLEAN,
  p_is_supervisor_rotation BOOLEAN,
  p_work_days NUMERIC DEFAULT NULL,
  p_extra_tasks TEXT[] DEFAULT NULL,
  p_is_acting_manager BOOLEAN DEFAULT FALSE
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

  -- 區塊 4：特殊時數
  -- 條件1：督導 + 雙職務 + (職位含「代理店長」 OR 勾選擔任代理店長)
  IF p_position LIKE '%督導%'
     AND p_is_dual_position
     AND (p_position LIKE '%代理店長%' OR p_is_acting_manager) THEN
    RETURN 4;
  END IF;

  -- 條件2：長照外務 或 診所業務
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

  -- 區塊 1：正職整月
  IF p_employment_type = 'full_time' AND p_monthly_status = 'full_month' THEN
    RETURN 1;
  END IF;

  -- 預設返回 0 (未分類)
  RETURN 0;
END;
$$ LANGUAGE plpgsql;

-- 更新觸發器函數，傳入 is_acting_manager 參數
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
    NEW.extra_tasks,
    NEW.is_acting_manager
  );
  NEW.updated_at := TIMEZONE('utc', NOW());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 重新計算現有資料中 督導+雙職務+擔任代理店長 但被誤判為區塊3的紀錄
UPDATE monthly_staff_status
SET updated_at = TIMEZONE('utc', NOW())  -- 觸發 BEFORE UPDATE trigger 重算 calculated_block
WHERE position LIKE '%督導%'
  AND is_dual_position = TRUE
  AND is_acting_manager = TRUE
  AND calculated_block = 3;
