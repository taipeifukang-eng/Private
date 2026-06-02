-- 新增門市加盟店註記欄位
ALTER TABLE stores
ADD COLUMN IF NOT EXISTS is_franchise BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN stores.is_franchise IS '是否為加盟店';

CREATE INDEX IF NOT EXISTS idx_stores_is_franchise ON stores(is_franchise);
