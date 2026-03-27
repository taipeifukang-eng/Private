-- 缺貨商品回覆歷程（供前端收合展開查閱）
CREATE TABLE IF NOT EXISTS stockout_product_response_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id UUID NULL REFERENCES stockout_product_responses(id) ON DELETE SET NULL,
  product_code TEXT NOT NULL,
  product_name TEXT NOT NULL,
  response_content TEXT NOT NULL,
  eta_date DATE NULL,
  responded_by UUID NOT NULL,
  responded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stockout_response_history_product_code_time
  ON stockout_product_response_history(product_code, responded_at DESC);

CREATE INDEX IF NOT EXISTS idx_stockout_response_history_responded_at
  ON stockout_product_response_history(responded_at DESC);
