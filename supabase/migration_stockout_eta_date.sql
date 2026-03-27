-- 缺貨回覆新增 ETA（預計到貨日）欄位
ALTER TABLE IF EXISTS stockout_product_responses
ADD COLUMN IF NOT EXISTS eta_date DATE;

-- 便於查詢近期到貨日/過期狀態
CREATE INDEX IF NOT EXISTS idx_stockout_product_responses_eta_date
ON stockout_product_responses (eta_date);
