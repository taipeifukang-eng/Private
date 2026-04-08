-- ============================================
-- 每月獎金批量 upsert 函數
-- 2026-04-09
-- ============================================

-- 刪除此函數舊版本（如果存在）
DROP FUNCTION IF EXISTS upsert_monthly_bonus_records(JSONB);

CREATE OR REPLACE FUNCTION upsert_monthly_bonus_records(records JSONB)
RETURNS TABLE(
  imported_count INT,
  deleted_count INT,
  message TEXT
) AS $$
DECLARE
  v_record JSONB;
  v_total INT := 0;
  v_success INT := 0;
  v_deleted INT := 0;
  v_year_months TEXT[];
  v_store_ids UUID[];
BEGIN
  -- 先收集所有要匯入的年月和門市
  v_year_months := ARRAY(SELECT DISTINCT jsonb_build_object('year_month', "value"->>'year_month')->>'year_month' FROM jsonb_array_elements(records));
  v_store_ids := ARRAY(SELECT DISTINCT ("value"->>'store_id')::UUID FROM jsonb_array_elements(records));

  -- 一次性刪除既有記錄
  DELETE FROM monthly_bonus_records 
  WHERE year_month = ANY(v_year_months) 
    AND store_id = ANY(v_store_ids);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- 逐筆插入新記錄
  FOR v_record IN SELECT * FROM jsonb_array_elements(records)
  LOOP
    v_total := v_total + 1;
    BEGIN
      INSERT INTO monthly_bonus_records (
        store_id, year_month, employee_code, employee_name,
        group_bonus, hr_subsidy_bonus, single_item_bonus,
        inventory_diff_penalty, talent_bonus, transport_fee,
        inventory_bonus, rx_incentive_bonus, quarterly_makeup_bonus,
        meal_allowance, spring_festival_bonus, pharmacist_guarantee,
        owner_rx_makeup, sales_competition_bonus, owner_signing_bonus
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
        (COALESCE(v_record->>'owner_signing_bonus', '0'))::NUMERIC
      );
      
      v_success := v_success + 1;
    EXCEPTION WHEN OTHERS THEN
      -- 忽略插入失敗，繼續下一筆
      CONTINUE;
    END;
  END LOOP;

  RETURN QUERY SELECT v_success, v_deleted, 'Deleted ' || v_deleted || ' old records, imported ' || v_success || ' new records';
END;
$$ LANGUAGE plpgsql;
