-- =====================================================
-- 活動前置 Checklist 系統
--
-- 【功能概述】
-- 為促銷活動（母親節/周年慶等）建立前置準備事項檢查清單
-- 店長在活動檢視表點選門市色塊後可查看並逐項打勾確認
-- 活動組可在活動排程處編輯公版 checklist 模板
--
-- 【資料表設計】
-- ┌──────────────────────────────────────────────────┐
-- │  campaign_checklist_items (檢查項目)             │
-- │  → 儲存每個活動的 checklist 項目                 │
-- │  → 項目包含：事項、備註、安排人員、期限          │
-- └──────────────────────────────────────────────────┘
-- ┌──────────────────────────────────────────────────┐
-- │  campaign_checklist_completions (完成狀態)       │
-- │  → 記錄每個門市對每個項目的完成狀態              │
-- │  → 店長可打勾標記完成                            │
-- └──────────────────────────────────────────────────┘
-- =====================================================

-- 1. 建立 checklist 項目表
CREATE TABLE IF NOT EXISTS campaign_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  item_order INT NOT NULL DEFAULT 0,
  task_name TEXT NOT NULL,
  notes TEXT,
  assigned_person TEXT,
  deadline TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id),
  updated_by UUID REFERENCES profiles(id)
);

-- 2. 建立 checklist 完成狀態表
CREATE TABLE IF NOT EXISTS campaign_checklist_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_item_id UUID NOT NULL REFERENCES campaign_checklist_items(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  is_completed BOOLEAN DEFAULT FALSE,
  completed_by UUID REFERENCES profiles(id),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(checklist_item_id, store_id)
);

-- 3. 建立索引以提升查詢效能
CREATE INDEX IF NOT EXISTS idx_checklist_items_campaign_id ON campaign_checklist_items(campaign_id);
CREATE INDEX IF NOT EXISTS idx_checklist_items_order ON campaign_checklist_items(campaign_id, item_order);
CREATE INDEX IF NOT EXISTS idx_checklist_completions_item_id ON campaign_checklist_completions(checklist_item_id);
CREATE INDEX IF NOT EXISTS idx_checklist_completions_store_id ON campaign_checklist_completions(store_id);
CREATE INDEX IF NOT EXISTS idx_checklist_completions_lookup ON campaign_checklist_completions(checklist_item_id, store_id);

-- 4. 建立 updated_at 自動更新觸發器
CREATE OR REPLACE FUNCTION update_campaign_checklist_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_campaign_checklist_items_updated_at
BEFORE UPDATE ON campaign_checklist_items
FOR EACH ROW EXECUTE FUNCTION update_campaign_checklist_items_updated_at();

CREATE OR REPLACE FUNCTION update_campaign_checklist_completions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_campaign_checklist_completions_updated_at
BEFORE UPDATE ON campaign_checklist_completions
FOR EACH ROW EXECUTE FUNCTION update_campaign_checklist_completions_updated_at();

-- 5. 建立 RLS 政策

-- 啟用 RLS
ALTER TABLE campaign_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_checklist_completions ENABLE ROW LEVEL SECURITY;

-- checklist_items: 所有登入用戶可讀取
CREATE POLICY "Anyone can view checklist items"
  ON campaign_checklist_items FOR SELECT
  TO authenticated
  USING (true);

-- checklist_items: 有權限的用戶可新增/編輯/刪除（由 API 控制）
CREATE POLICY "Authorized users can manage checklist items"
  ON campaign_checklist_items FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- checklist_completions: 所有登入用戶可讀取
CREATE POLICY "Anyone can view checklist completions"
  ON campaign_checklist_completions FOR SELECT
  TO authenticated
  USING (true);

-- checklist_completions: 店長可更新自己門市的完成狀態（由 API 控制權限）
CREATE POLICY "Store managers can update completions"
  ON campaign_checklist_completions FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 6. 新增母親節/周年慶活動的預設 checklist 模板（範例）
-- 注意：這是範例資料，實際使用時需要替換 campaign_id

-- INSERT INTO campaign_checklist_items (campaign_id, item_order, task_name, notes, assigned_person, deadline) VALUES
--   ('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', 1, '淘前磨診珠刊版', '掛定位', '', ''),
--   ('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', 2, '宣委會大樓通知跑健申請', '', '', '前兩週'),
--   ('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', 3, '左右鄰居打招呼', '1.回郵督導過調送慈籤箱生紙\n(因占用到對方停車位)\n2.活動當天送蛋撻去左右鄰居\n(不管有沒有占用停車位)', '', '前一天'),
--   ('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', 4, 'FB活動文案', '事前幫好文案當天PO文', '', '前一天'),
--   ('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', 5, '商品備齊活動量', 'DM特價商品、主力保健、奶粉(下10備兩週)\n巡貨任區域檢身薦本、膠券店真備薦\n試飲耗牌：_____奶水', '', '前一週'),
--   ('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', 6, 'Call百大一個月內S級保單\一年內銷售毛利', '打電話、簡訊(大富發送平台)、發紅群', 'ALL', '前兩週'),
--   ('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', 7, '店內布置', '掛含訓調應(印堂已幫卡)\n滴函呷區(椎台+庫佔)\n無成本贈保送\n貝持宮區(製作庫佔卡)', '', '前一天'),
--   ('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', 8, '索方落檔作', '檔作到__月__號', 'ALL', '前一週'),
--   ('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', 9, '又具準備', 'memo紙、筆、塑膠袋、紙杯活動數量確認', '', '前一天');

-- 驗證資料表建立
SELECT 
  table_name,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = t.table_name) AS column_count
FROM information_schema.tables t
WHERE table_schema = 'public'
  AND table_name IN ('campaign_checklist_items', 'campaign_checklist_completions')
ORDER BY table_name;
