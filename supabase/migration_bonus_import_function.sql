-- ============================================
-- 每月獎金批量 upsert 函數
-- 2026-04-09
-- ============================================

CREATE OR REPLACE FUNCTION upsert_monthly_bonus_records(records JSONB)
RETURNS TABLE(
  imported_count INT,
  failed_count INT,
  message TEXT
) AS $$
DECLARE
  v_record JSONB;
  v_total INT := 0;
  v_success INT := 0;
  v_failed INT := 0;
BEGIN
  -- 遍歷 JSON 陣列，逐筆執行 INSERT ... ON CONFLICT
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
        (v_record->>'group_bonus')::NUMERIC,
        (v_record->>'hr_subsidy_bonus')::NUMERIC,
        (v_record->>'single_item_bonus')::NUMERIC,
        (v_record->>'inventory_diff_penalty')::NUMERIC,
        (v_record->>'talent_bonus')::NUMERIC,
        (v_record->>'transport_fee')::NUMERIC,
        (v_record->>'inventory_bonus')::NUMERIC,
        (v_record->>'rx_incentive_bonus')::NUMERIC,
        (v_record->>'quarterly_makeup_bonus')::NUMERIC,
        (v_record->>'meal_allowance')::NUMERIC,
        (v_record->>'spring_festival_bonus')::NUMERIC,
        (v_record->>'pharmacist_guarantee')::NUMERIC,
        (v_record->>'owner_rx_makeup')::NUMERIC,
        (v_record->>'sales_competition_bonus')::NUMERIC,
        (v_record->>'owner_signing_bonus')::NUMERIC
      )
      ON CONFLICT (store_id, year_month, employee_code)
      DO UPDATE SET
        employee_name = EXCLUDED.employee_name,
        group_bonus = EXCLUDED.group_bonus,
        hr_subsidy_bonus = EXCLUDED.hr_subsidy_bonus,
        single_item_bonus = EXCLUDED.single_item_bonus,
        inventory_diff_penalty = EXCLUDED.inventory_diff_penalty,
        talent_bonus = EXCLUDED.talent_bonus,
        transport_fee = EXCLUDED.transport_fee,
        inventory_bonus = EXCLUDED.inventory_bonus,
        rx_incentive_bonus = EXCLUDED.rx_incentive_bonus,
        quarterly_makeup_bonus = EXCLUDED.quarterly_makeup_bonus,
        meal_allowance = EXCLUDED.meal_allowance,
        spring_festival_bonus = EXCLUDED.spring_festival_bonus,
        pharmacist_guarantee = EXCLUDED.pharmacist_guarantee,
        owner_rx_makeup = EXCLUDED.owner_rx_makeup,
        sales_competition_bonus = EXCLUDED.sales_competition_bonus,
        owner_signing_bonus = EXCLUDED.owner_signing_bonus;
      
      v_success := v_success + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
    END;
  END LOOP;

  RETURN QUERY SELECT v_success, v_failed, 'Imported ' || v_success || ' records, failed ' || v_failed;
END;
$$ LANGUAGE plpgsql;
