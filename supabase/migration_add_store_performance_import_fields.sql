-- =====================================================
-- 擴充門市業績匯入欄位
-- 日期: 2026-04-15
-- 說明:
--   支援新版業績匯入格式中的系統營業額、自費月藥營業額、
--   真實毛利、長照毛利與各式毛利回補/扣減欄位。
-- =====================================================

ALTER TABLE store_performance
ADD COLUMN IF NOT EXISTS system_monthly_revenue BIGINT,
ADD COLUMN IF NOT EXISTS self_pay_monthly_revenue BIGINT,
ADD COLUMN IF NOT EXISTS monthly_true_gross_profit BIGINT,
ADD COLUMN IF NOT EXISTS system_monthly_gross_profit BIGINT,
ADD COLUMN IF NOT EXISTS monthly_long_term_care_gross_profit BIGINT,
ADD COLUMN IF NOT EXISTS monthly_rx_addon_makeup_gross_profit BIGINT,
ADD COLUMN IF NOT EXISTS monthly_theft_compensation_makeup_gross_profit BIGINT,
ADD COLUMN IF NOT EXISTS monthly_kamedis_deduction_gross_profit BIGINT;

COMMENT ON COLUMN store_performance.system_monthly_revenue IS '系統月營業額';
COMMENT ON COLUMN store_performance.self_pay_monthly_revenue IS '自費月藥營業額';
COMMENT ON COLUMN store_performance.monthly_true_gross_profit IS '月真實毛利額';
COMMENT ON COLUMN store_performance.system_monthly_gross_profit IS '系統月毛利額';
COMMENT ON COLUMN store_performance.monthly_long_term_care_gross_profit IS '月長照毛利額';
COMMENT ON COLUMN store_performance.monthly_rx_addon_makeup_gross_profit IS '處方加購回補月毛利額';
COMMENT ON COLUMN store_performance.monthly_theft_compensation_makeup_gross_profit IS '小偷賠償回補月毛利';
COMMENT ON COLUMN store_performance.monthly_kamedis_deduction_gross_profit IS 'Kamedis業績扣月毛利額';