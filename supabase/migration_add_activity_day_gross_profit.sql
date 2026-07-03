-- =====================================================
-- 業績管理：活動當日毛利
-- 日期: 2026-07-03
-- 說明:
--   用於月團體獎金計算。若扣除活動當日毛利後的其他營業日
--   平均毛利未達第一檻日毛利目標，當月團體獎金折減為 80%。
-- =====================================================

ALTER TABLE store_performance
ADD COLUMN IF NOT EXISTS activity_day_gross_profit BIGINT;

COMMENT ON COLUMN store_performance.activity_day_gross_profit IS '活動當日毛利，用於判斷扣除活動日後的月團體獎金80%折減';
