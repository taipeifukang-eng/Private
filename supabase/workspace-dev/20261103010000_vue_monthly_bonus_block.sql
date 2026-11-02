-- W01b（DEV 專用）：補上 calculate_bonus_block 與重算觸發器。
-- 內容與 supabase/migration_fix_block4_acting_manager.sql（2026-04-08，目前最新版）相同，
-- DEV 資料庫沒有這個函式與觸發器（calculated_block 不會被重算），導致無法用 RPC 對照前端預覽。
-- 只能套用到 DEV；不得套用到 Production（Production 以既有 migration 為準）。
-- 不回填既有資料；只影響之後的 INSERT / UPDATE。

CREATE OR REPLACE FUNCTION public.calculate_bonus_block(
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

CREATE OR REPLACE FUNCTION public.update_calculated_block()
RETURNS TRIGGER AS $$
BEGIN
  NEW.calculated_block := public.calculate_bonus_block(
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

DROP TRIGGER IF EXISTS trigger_update_calculated_block ON public.monthly_staff_status;
CREATE TRIGGER trigger_update_calculated_block
  BEFORE INSERT OR UPDATE ON public.monthly_staff_status
  FOR EACH ROW
  EXECUTE FUNCTION public.update_calculated_block();

-- 純計算函式，無資料存取。觸發器以呼叫者身分執行，所以 authenticated 也要能執行；anon 不開放。
REVOKE ALL ON FUNCTION public.calculate_bonus_block(VARCHAR, VARCHAR, BOOLEAN, VARCHAR, BOOLEAN, BOOLEAN, NUMERIC, TEXT[], BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calculate_bonus_block(VARCHAR, VARCHAR, BOOLEAN, VARCHAR, BOOLEAN, BOOLEAN, NUMERIC, TEXT[], BOOLEAN) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
