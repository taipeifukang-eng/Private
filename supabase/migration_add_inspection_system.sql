-- =====================================================
-- 督導巡店系統 - 資料庫 Migration
-- =====================================================
-- 版本: v1.0
-- 日期: 2026-02-13
-- 說明: 建立督導巡店系統的完整資料庫結構
--      總分 220 分，等級 S/A/B/F
-- =====================================================

-- 確保必要的擴展功能已啟用
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- 1. 檢查項目範本表（題庫）
-- =====================================================
CREATE TABLE IF NOT EXISTS inspection_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- 分類資訊（五大區塊）
  section VARCHAR(50) NOT NULL, -- section_1 ~ section_5
  section_name VARCHAR(100) NOT NULL, -- 門市業績相關、區域環境相關等
  section_order INT NOT NULL CHECK (section_order BETWEEN 1 AND 5),
  
  -- 項目資訊
  item_name VARCHAR(200) NOT NULL, -- 項目名稱
  item_description TEXT, -- 檢查重點說明
  item_order INT NOT NULL, -- 項目在該區塊的排序
  
  -- 評分設定
  max_score DECIMAL(5,1) NOT NULL CHECK (max_score > 0), -- 滿分
  scoring_type VARCHAR(20) NOT NULL CHECK (scoring_type IN ('checklist', 'quantity')),
  
  -- Checklist 類型的扣分項目（JSONB 陣列）
  -- 格式: [{"label": "有紙屑", "deduction": 1}, {"label": "髒汙", "deduction": 5}]
  checklist_items JSONB,
  
  -- Quantity 類型的單位扣分
  quantity_deduction DECIMAL(5,1), -- 每次缺失扣多少分
  quantity_unit VARCHAR(50), -- 單位說明（如「個」、「張」、「次」）
  
  -- 狀態
  is_active BOOLEAN DEFAULT true,
  
  -- 審計欄位
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id),
  
  -- 約束
  CONSTRAINT chk_scoring_type_data CHECK (
    (scoring_type = 'checklist' AND checklist_items IS NOT NULL) OR
    (scoring_type = 'quantity' AND quantity_deduction IS NOT NULL)
  )
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_inspection_templates_section 
  ON inspection_templates(section, section_order);
CREATE INDEX IF NOT EXISTS idx_inspection_templates_order 
  ON inspection_templates(section_order, item_order);
CREATE INDEX IF NOT EXISTS idx_inspection_templates_active 
  ON inspection_templates(is_active);

-- 註解
COMMENT ON TABLE inspection_templates IS '督導巡店檢查項目題庫，總分 220 分，分為五大區塊';
COMMENT ON COLUMN inspection_templates.section IS '區塊代碼: section_1 ~ section_5';
COMMENT ON COLUMN inspection_templates.scoring_type IS '計分方式: checklist(複選扣分) 或 quantity(數量計數扣分)';
COMMENT ON COLUMN inspection_templates.checklist_items IS 'Checklist 扣分項目 JSON 陣列';
COMMENT ON COLUMN inspection_templates.quantity_deduction IS 'Quantity 類型的單位扣分';

-- =====================================================
-- 2. 巡店主記錄表
-- =====================================================
CREATE TABLE IF NOT EXISTS inspection_masters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- 基本資訊（整合現有 stores 和 profiles）
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  inspector_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  inspection_date DATE NOT NULL DEFAULT CURRENT_DATE,
  inspection_time TIME DEFAULT CURRENT_TIME,
  
  -- GPS 位置（督導簽到位置驗證）
  gps_latitude DECIMAL(10, 8), -- 緯度
  gps_longitude DECIMAL(11, 8), -- 經度
  gps_accuracy DECIMAL(10, 2), -- 精度（公尺）
  gps_timestamp TIMESTAMPTZ, -- GPS 記錄時間
  
  -- 評分結果
  total_score DECIMAL(6,1) DEFAULT 0 CHECK (total_score >= 0), -- 實得總分
  max_possible_score DECIMAL(6,1) DEFAULT 220, -- 滿分
  grade VARCHAR(2) CHECK (grade IN ('S', 'A', 'B', 'F')), -- 等級
  score_percentage DECIMAL(5,2), -- 分數百分比
  
  -- 區塊得分明細
  section_1_score DECIMAL(5,1) DEFAULT 0 CHECK (section_1_score >= 0), -- 門市業績相關（35分）
  section_2_score DECIMAL(5,1) DEFAULT 0 CHECK (section_2_score >= 0), -- 區域環境相關（44.5分）
  section_3_score DECIMAL(5,1) DEFAULT 0 CHECK (section_3_score >= 0), -- 櫃台三聯單（44.5分）
  section_4_score DECIMAL(5,1) DEFAULT 0 CHECK (section_4_score >= 0), -- 商品庫存管理（40.5分）
  section_5_score DECIMAL(5,1) DEFAULT 0 CHECK (section_5_score >= 0), -- 流程執行相關（55.5分）
  
  -- 督導建議與店長回饋
  supervisor_notes TEXT, -- 督導整體建議
  improvement_suggestions TEXT, -- 改善建議
  store_manager_response TEXT, -- 店長回應
  
  -- 結案流程
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'in_progress', 'completed', 'closed')),
  signature_photo_url TEXT, -- 店長簽名單照片 URL（Supabase Storage）
  signed_at TIMESTAMPTZ, -- 店長簽名時間
  closed_at TIMESTAMPTZ, -- 結案時間
  closed_by UUID REFERENCES profiles(id),
  
  -- 審計欄位
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_inspection_masters_store 
  ON inspection_masters(store_id);
CREATE INDEX IF NOT EXISTS idx_inspection_masters_inspector 
  ON inspection_masters(inspector_id);
CREATE INDEX IF NOT EXISTS idx_inspection_masters_date 
  ON inspection_masters(inspection_date DESC);
CREATE INDEX IF NOT EXISTS idx_inspection_masters_status 
  ON inspection_masters(status);
CREATE INDEX IF NOT EXISTS idx_inspection_masters_grade 
  ON inspection_masters(grade);
CREATE INDEX IF NOT EXISTS idx_inspection_masters_store_date 
  ON inspection_masters(store_id, inspection_date DESC);

-- 註解
COMMENT ON TABLE inspection_masters IS '督導巡店主記錄表，記錄每次巡店的基本資訊與總分';
COMMENT ON COLUMN inspection_masters.status IS '狀態: draft(草稿), in_progress(進行中), completed(完成), closed(已結案)';
COMMENT ON COLUMN inspection_masters.grade IS '等級: S(≥208分), A(196-207分), B(188-195分), F(<188分)';

-- =====================================================
-- 3. 各項目評分詳細記錄表
-- =====================================================
CREATE TABLE IF NOT EXISTS inspection_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- 關聯
  inspection_id UUID NOT NULL REFERENCES inspection_masters(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES inspection_templates(id) ON DELETE RESTRICT,
  
  -- 評分結果
  max_score DECIMAL(5,1) NOT NULL CHECK (max_score > 0), -- 該項目滿分（從 template 複製）
  given_score DECIMAL(5,1) NOT NULL DEFAULT 0 CHECK (given_score >= 0), -- 實得分數
  deduction_amount DECIMAL(5,1) DEFAULT 0 CHECK (deduction_amount >= 0), -- 扣除分數
  
  -- 改善標記（自動判定：given_score < max_score）
  is_improvement BOOLEAN DEFAULT false,
  
  -- Checklist 勾選項目（JSONB）
  -- 格式: [{"label": "有紙屑", "deduction": 1, "checked": true}]
  selected_items JSONB,
  
  -- Quantity 數量記錄
  quantity_count INT DEFAULT 0 CHECK (quantity_count >= 0), -- 缺失次數
  
  -- 備註與照片
  notes TEXT, -- 督導備註
  photo_urls JSONB, -- ["url1.webp", "url2.webp"] 多張照片
  
  -- 審計欄位
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- 約束
  CONSTRAINT chk_valid_score CHECK (given_score <= max_score),
  CONSTRAINT chk_deduction_calculation CHECK (deduction_amount = max_score - given_score),
  CONSTRAINT uq_inspection_template UNIQUE (inspection_id, template_id)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_inspection_results_inspection 
  ON inspection_results(inspection_id);
CREATE INDEX IF NOT EXISTS idx_inspection_results_template 
  ON inspection_results(template_id);
CREATE INDEX IF NOT EXISTS idx_inspection_results_improvement 
  ON inspection_results(is_improvement);

-- 註解
COMMENT ON TABLE inspection_results IS '督導巡店各項目的詳細評分記錄';
COMMENT ON COLUMN inspection_results.is_improvement IS '是否需要改善（given_score < max_score 自動判定）';
COMMENT ON COLUMN inspection_results.selected_items IS 'Checklist 類型的勾選項目 JSON';
COMMENT ON COLUMN inspection_results.quantity_count IS 'Quantity 類型的缺失次數';

-- =====================================================
-- 4. 自動更新 updated_at 的 Trigger Function
-- =====================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 套用到 inspection_templates
DROP TRIGGER IF EXISTS trigger_update_inspection_templates_updated_at ON inspection_templates;
CREATE TRIGGER trigger_update_inspection_templates_updated_at
  BEFORE UPDATE ON inspection_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 套用到 inspection_masters
DROP TRIGGER IF EXISTS trigger_update_inspection_masters_updated_at ON inspection_masters;
CREATE TRIGGER trigger_update_inspection_masters_updated_at
  BEFORE UPDATE ON inspection_masters
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 套用到 inspection_results
DROP TRIGGER IF EXISTS trigger_update_inspection_results_updated_at ON inspection_results;
CREATE TRIGGER trigger_update_inspection_results_updated_at
  BEFORE UPDATE ON inspection_results
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 5. 自動判定改善標記的 Trigger Function
-- =====================================================
CREATE OR REPLACE FUNCTION auto_set_improvement_flag()
RETURNS TRIGGER AS $$
BEGIN
  -- 當實得分數小於滿分時，自動設為需要改善
  NEW.is_improvement := (NEW.given_score < NEW.max_score);
  
  -- 計算扣除分數
  NEW.deduction_amount := NEW.max_score - NEW.given_score;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_auto_improvement_flag ON inspection_results;
CREATE TRIGGER trigger_auto_improvement_flag
  BEFORE INSERT OR UPDATE OF given_score, max_score
  ON inspection_results
  FOR EACH ROW
  EXECUTE FUNCTION auto_set_improvement_flag();

-- =====================================================
-- 6. 自動計算總分與等級的 Trigger Function
-- =====================================================
CREATE OR REPLACE FUNCTION auto_calculate_total_score()
RETURNS TRIGGER AS $$
DECLARE
  v_total_score DECIMAL(6,1);
  v_section_1 DECIMAL(5,1);
  v_section_2 DECIMAL(5,1);
  v_section_3 DECIMAL(5,1);
  v_section_4 DECIMAL(5,1);
  v_section_5 DECIMAL(5,1);
  v_grade VARCHAR(2);
BEGIN
  -- 計算各區塊得分
  SELECT 
    COALESCE(SUM(CASE WHEN t.section = 'section_1' THEN r.given_score ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN t.section = 'section_2' THEN r.given_score ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN t.section = 'section_3' THEN r.given_score ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN t.section = 'section_4' THEN r.given_score ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN t.section = 'section_5' THEN r.given_score ELSE 0 END), 0)
  INTO v_section_1, v_section_2, v_section_3, v_section_4, v_section_5
  FROM inspection_results r
  JOIN inspection_templates t ON r.template_id = t.id
  WHERE r.inspection_id = NEW.inspection_id;
  
  -- 計算總分
  v_total_score := v_section_1 + v_section_2 + v_section_3 + v_section_4 + v_section_5;
  
  -- 判定等級
  IF v_total_score >= 208 THEN
    v_grade := 'S';  -- S 級：≥ 208 分（94.5%）
  ELSIF v_total_score >= 196 THEN
    v_grade := 'A';  -- A 級：196-207 分（89.1%-94.1%）
  ELSIF v_total_score >= 188 THEN
    v_grade := 'B';  -- B 級：188-195 分（85.5%-88.6%）
  ELSE
    v_grade := 'F';  -- F 級：< 188 分（<85.5%）
  END IF;
  
  -- 更新 inspection_masters
  UPDATE inspection_masters
  SET 
    section_1_score = v_section_1,
    section_2_score = v_section_2,
    section_3_score = v_section_3,
    section_4_score = v_section_4,
    section_5_score = v_section_5,
    total_score = v_total_score,
    score_percentage = ROUND((v_total_score / max_possible_score) * 100, 2),
    grade = v_grade
  WHERE id = NEW.inspection_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 在 inspection_results 的 INSERT/UPDATE/DELETE 時自動重新計算總分
DROP TRIGGER IF EXISTS trigger_auto_calculate_total_score ON inspection_results;
CREATE TRIGGER trigger_auto_calculate_total_score
  AFTER INSERT OR UPDATE OR DELETE
  ON inspection_results
  FOR EACH ROW
  EXECUTE FUNCTION auto_calculate_total_score();

-- =====================================================
-- 7. 創建 Supabase Storage Bucket（需在 Supabase Dashboard 執行）
-- =====================================================
-- 注意：以下 SQL 僅作為參考，Storage Bucket 通常需要在 Supabase Dashboard 建立
-- 或使用 Supabase Management API

-- 建立 inspection-photos bucket（需要手動執行或透過 API）
-- Bucket 名稱: inspection-photos
-- Public: false（私有，需透過 RLS 控制）
-- File size limit: 5MB
-- Allowed MIME types: image/webp, image/jpeg, image/png

COMMENT ON TABLE inspection_templates IS '
督導巡店系統 - 檢查項目範本表
- 總分 220 分，分為五大區塊
- 支援兩種計分方式：Checklist（複選扣分）和 Quantity（數量計數扣分）
- 使用 JSONB 儲存彈性的檢查項目資料
';

COMMENT ON TABLE inspection_masters IS '
督導巡店系統 - 巡店主記錄表
- 記錄每次巡店的基本資訊、GPS 位置、總分與等級
- 等級判定：S (≥208分), A (196-207分), B (188-195分), F (<188分)
- 狀態流程：draft → in_progress → completed → closed
';

COMMENT ON TABLE inspection_results IS '
督導巡店系統 - 各項目評分詳細記錄表
- 記錄每個檢查項目的詳細評分、照片與備註
- 自動判定是否需要改善（given_score < max_score）
- 支援多張照片上傳（JSONB 陣列）
';

-- =====================================================
-- Migration 完成
-- =====================================================
-- 下一步：
-- 1. 執行 migration_add_inspection_permissions.sql（新增權限）
-- 2. 執行 seed_inspection_templates.sql（匯入 220 分題庫）
-- 3. 設定 RLS 策略（migration_add_inspection_rls.sql）
-- 4. 在 Supabase Dashboard 建立 Storage Bucket
-- =====================================================
