-- 保護每月獎金跨批次匯入資料
-- 日期: 2026-07-07
-- 說明：後匯入檔案若某獎金欄位帶 0，不覆蓋資料庫既有非 0 金額。

CREATE OR REPLACE FUNCTION preserve_monthly_bonus_nonzero_values()
RETURNS TRIGGER AS $$
BEGIN
  IF COALESCE(OLD.group_bonus, 0) <> 0 AND COALESCE(NEW.group_bonus, 0) = 0 THEN NEW.group_bonus := OLD.group_bonus; END IF;
  IF COALESCE(OLD.hr_subsidy_bonus, 0) <> 0 AND COALESCE(NEW.hr_subsidy_bonus, 0) = 0 THEN NEW.hr_subsidy_bonus := OLD.hr_subsidy_bonus; END IF;
  IF COALESCE(OLD.single_item_bonus, 0) <> 0 AND COALESCE(NEW.single_item_bonus, 0) = 0 THEN NEW.single_item_bonus := OLD.single_item_bonus; END IF;
  IF COALESCE(OLD.inventory_diff_penalty, 0) <> 0 AND COALESCE(NEW.inventory_diff_penalty, 0) = 0 THEN NEW.inventory_diff_penalty := OLD.inventory_diff_penalty; END IF;
  IF COALESCE(OLD.talent_bonus, 0) <> 0 AND COALESCE(NEW.talent_bonus, 0) = 0 THEN NEW.talent_bonus := OLD.talent_bonus; END IF;
  IF COALESCE(OLD.transport_fee, 0) <> 0 AND COALESCE(NEW.transport_fee, 0) = 0 THEN NEW.transport_fee := OLD.transport_fee; END IF;
  IF COALESCE(OLD.inventory_bonus, 0) <> 0 AND COALESCE(NEW.inventory_bonus, 0) = 0 THEN NEW.inventory_bonus := OLD.inventory_bonus; END IF;
  IF COALESCE(OLD.rx_incentive_bonus, 0) <> 0 AND COALESCE(NEW.rx_incentive_bonus, 0) = 0 THEN NEW.rx_incentive_bonus := OLD.rx_incentive_bonus; END IF;
  IF COALESCE(OLD.quarterly_makeup_bonus, 0) <> 0 AND COALESCE(NEW.quarterly_makeup_bonus, 0) = 0 THEN NEW.quarterly_makeup_bonus := OLD.quarterly_makeup_bonus; END IF;
  IF COALESCE(OLD.meal_allowance, 0) <> 0 AND COALESCE(NEW.meal_allowance, 0) = 0 THEN NEW.meal_allowance := OLD.meal_allowance; END IF;
  IF COALESCE(OLD.spring_festival_bonus, 0) <> 0 AND COALESCE(NEW.spring_festival_bonus, 0) = 0 THEN NEW.spring_festival_bonus := OLD.spring_festival_bonus; END IF;
  IF COALESCE(OLD.pharmacist_guarantee, 0) <> 0 AND COALESCE(NEW.pharmacist_guarantee, 0) = 0 THEN NEW.pharmacist_guarantee := OLD.pharmacist_guarantee; END IF;
  IF COALESCE(OLD.owner_rx_makeup, 0) <> 0 AND COALESCE(NEW.owner_rx_makeup, 0) = 0 THEN NEW.owner_rx_makeup := OLD.owner_rx_makeup; END IF;
  IF COALESCE(OLD.sales_competition_bonus, 0) <> 0 AND COALESCE(NEW.sales_competition_bonus, 0) = 0 THEN NEW.sales_competition_bonus := OLD.sales_competition_bonus; END IF;
  IF COALESCE(OLD.owner_signing_bonus, 0) <> 0 AND COALESCE(NEW.owner_signing_bonus, 0) = 0 THEN NEW.owner_signing_bonus := OLD.owner_signing_bonus; END IF;
  IF COALESCE(OLD.long_term_care_bonus, 0) <> 0 AND COALESCE(NEW.long_term_care_bonus, 0) = 0 THEN NEW.long_term_care_bonus := OLD.long_term_care_bonus; END IF;
  IF COALESCE(OLD.manager_supervisor_quarterly_bonus, 0) <> 0 AND COALESCE(NEW.manager_supervisor_quarterly_bonus, 0) = 0 THEN NEW.manager_supervisor_quarterly_bonus := OLD.manager_supervisor_quarterly_bonus; END IF;
  IF COALESCE(OLD.opening_abnormal_responsibility_amount, 0) <> 0 AND COALESCE(NEW.opening_abnormal_responsibility_amount, 0) = 0 THEN NEW.opening_abnormal_responsibility_amount := OLD.opening_abnormal_responsibility_amount; END IF;
  IF COALESCE(OLD.bonus_difference_adjustment, 0) <> 0 AND COALESCE(NEW.bonus_difference_adjustment, 0) = 0 THEN NEW.bonus_difference_adjustment := OLD.bonus_difference_adjustment; END IF;
  IF COALESCE(OLD.other_bonus, 0) <> 0 AND COALESCE(NEW.other_bonus, 0) = 0 THEN
    NEW.other_bonus := OLD.other_bonus;
    NEW.other_bonus_note := OLD.other_bonus_note;
  END IF;

  IF COALESCE(NEW.other_bonus, 0) = 0 THEN
    NEW.other_bonus_note := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_preserve_monthly_bonus_nonzero_values ON monthly_bonus_records;
CREATE TRIGGER trg_preserve_monthly_bonus_nonzero_values
  BEFORE UPDATE ON monthly_bonus_records
  FOR EACH ROW EXECUTE FUNCTION preserve_monthly_bonus_nonzero_values();
