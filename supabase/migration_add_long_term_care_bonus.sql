-- =====================================================
-- 新增長照獎金欄位
-- 日期: 2026-04-15
-- 說明:
--   1) monthly_bonus_records.long_term_care_bonus 新增欄位
--   2) 更新 upsert_monthly_bonus_records 函數以支持新欄位
-- =====================================================

-- STEP 1: 在 monthly_bonus_records 表新增長照獎金欄位
ALTER TABLE monthly_bonus_records
ADD COLUMN IF NOT EXISTS long_term_care_bonus NUMERIC(12,2) DEFAULT 0;

-- STEP 2: 更新 upsert_monthly_bonus_records 函數以支持長照獎金
DROP FUNCTION IF EXISTS upsert_monthly_bonus_records(JSONB);

CREATE OR REPLACE FUNCTION upsert_monthly_bonus_records(records JSONB)
RETURNS TABLE(success BOOLEAN, message TEXT) AS $$
DECLARE
  v_record JSONB;
  v_count INT := 0;
BEGIN
  -- 1. 刪除本月份既有記錄（重新匯入覆蓋）
  DELETE FROM monthly_bonus_records 
  WHERE year_month = (records->0->>'year_month')
    AND store_id = (records->0->>'store_id')::UUID;

  -- 2. 逐筆插入新資料
  FOR v_record IN SELECT jsonb_array_elements(records) LOOP
    INSERT INTO monthly_bonus_records (
      store_id, year_month, employee_code, employee_name,
      group_bonus, hr_subsidy_bonus, single_item_bonus,
      inventory_diff_penalty, talent_bonus, transport_fee,
      inventory_bonus, rx_incentive_bonus, quarterly_makeup_bonus,
      meal_allowance, spring_festival_bonus, pharmacist_guarantee,
      owner_rx_makeup, sales_competition_bonus, owner_signing_bonus,
      long_term_care_bonus
    ) VALUES (
      (v_record->>'store_id')::UUID,
      v_record->>'year_month',
      v_record->>'employee_code',
      v_record->>'employee_name',
      (COALESCE(v_record->>'group_bonus', '0'))::NUMERIC,
      (COALESCE(v_record->>'hr_subsidy_bonus', '0'))::NUMERIC,
      (COALESCE(v_record->>'single_item_bonus', '0'))::NUMERIC,
      (COALESCE(v_record->>'inventory_diff_penalty', '0'))::NUMERIC,
      (COALESCE(v_record->>'talent_bonus', '0'))::NUMERIC,
      (COALESCE(v_record->>'transport_fee', '0'))::NUMERIC,
      (COALESCE(v_record->>'inventory_bonus', '0'))::NUMERIC,
      (COALESCE(v_record->>'rx_incentive_bonus', '0'))::NUMERIC,
      (COALESCE(v_record->>'quarterly_makeup_bonus', '0'))::NUMERIC,
      (COALESCE(v_record->>'meal_allowance', '0'))::NUMERIC,
      (COALESCE(v_record->>'spring_festival_bonus', '0'))::NUMERIC,
      (COALESCE(v_record->>'pharmacist_guarantee', '0'))::NUMERIC,
      (COALESCE(v_record->>'owner_rx_makeup', '0'))::NUMERIC,
      (COALESCE(v_record->>'sales_competition_bonus', '0'))::NUMERIC,
      (COALESCE(v_record->>'owner_signing_bonus', '0'))::NUMERIC,
      (COALESCE(v_record->>'long_term_care_bonus', '0'))::NUMERIC
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN QUERY SELECT true::BOOLEAN, format('成功匯入 %s 筆獎金記錄', v_count)::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT false::BOOLEAN, SQLERRM::TEXT;
END;
$$ LANGUAGE plpgsql;

-- STEP 3: 添加資料表註解
COMMENT ON COLUMN monthly_bonus_records.long_term_care_bonus IS '長照獎金';
