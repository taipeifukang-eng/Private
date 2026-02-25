-- =====================================================
-- 店長待改善事項上傳模組
-- 日期: 2026-02-24
-- 說明:
--   1. inspection_improvements 表 - 追蹤每個待改善項目
--   2. inspection_bonus_config 表 - 加分規則設定
--   3. inspection_masters 新增 improvement_bonus 欄位
--   4. DB Trigger: 巡店完成自動生成待改善紀錄
--   5. DB Trigger: 店長提交改善自動計算加分
--   6. RLS 策略
--   7. RBAC 權限
-- =====================================================

-- =====================================================
-- PART 1: 建立 inspection_bonus_config 表（加分規則）
-- =====================================================

CREATE TABLE IF NOT EXISTS inspection_bonus_config (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  day_from INT NOT NULL,                          -- 改善天數起始（含）
  day_to INT NOT NULL,                            -- 改善天數結束（含）
  bonus_score DECIMAL(5,1) NOT NULL,              -- 加分分數
  description VARCHAR(200),                       -- 規則說明
  sort_order INT DEFAULT 0,                       -- 排序
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES profiles(id),
  
  CONSTRAINT valid_day_range CHECK (day_from >= 0 AND day_to >= day_from),
  CONSTRAINT valid_bonus CHECK (bonus_score >= 0)
);

-- 預設加分規則
INSERT INTO inspection_bonus_config (day_from, day_to, bonus_score, description, sort_order) VALUES
  (0, 3, 5, '3天內改善 +5分', 1),
  (4, 5, 3, '4-5天改善 +3分', 2),
  (6, 7, 1, '6-7天改善 +1分', 3)
ON CONFLICT DO NOTHING;

-- =====================================================
-- PART 2: 建立 inspection_improvements 表（待改善追蹤）
-- =====================================================

CREATE TABLE IF NOT EXISTS inspection_improvements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- 關聯
  inspection_id UUID NOT NULL REFERENCES inspection_masters(id) ON DELETE CASCADE,
  inspection_result_id UUID REFERENCES inspection_results(id) ON DELETE SET NULL,
  template_id UUID NOT NULL REFERENCES inspection_templates(id),
  store_id UUID NOT NULL REFERENCES stores(id),
  
  -- 快取的項目資訊（從 template 複製，避免後續查詢）
  section_name VARCHAR(100) NOT NULL,
  item_name VARCHAR(200) NOT NULL,
  deduction_amount DECIMAL(5,1) DEFAULT 0,
  
  -- 問題資訊（從 inspection_result 複製）
  issue_description TEXT,                         -- 督導備註
  issue_photo_urls JSONB DEFAULT '[]'::jsonb,     -- 問題照片
  selected_items JSONB DEFAULT '[]'::jsonb,       -- 勾選的缺失項目
  
  -- 狀態管理
  status VARCHAR(20) DEFAULT 'pending'
    CHECK (status IN ('pending', 'improved', 'overdue')),
  deadline DATE NOT NULL,                         -- 改善期限
  
  -- 店長改善上傳
  improvement_description TEXT,                   -- 改善說明
  improvement_photo_urls JSONB DEFAULT '[]'::jsonb, -- 改善照片
  improved_by UUID REFERENCES profiles(id),       -- 上傳人
  improved_at TIMESTAMPTZ,                        -- 上傳時間
  days_taken INT,                                 -- 花了幾天改善
  bonus_score DECIMAL(5,1) DEFAULT 0,             -- 獲得的加分
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- 每次巡店的每個項目只產生一筆改善紀錄
  UNIQUE(inspection_id, template_id)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_improvements_store ON inspection_improvements(store_id);
CREATE INDEX IF NOT EXISTS idx_improvements_status ON inspection_improvements(status);
CREATE INDEX IF NOT EXISTS idx_improvements_deadline ON inspection_improvements(deadline);
CREATE INDEX IF NOT EXISTS idx_improvements_inspection ON inspection_improvements(inspection_id);

-- =====================================================
-- PART 3: inspection_masters 新增 improvement_bonus 欄位
-- =====================================================

ALTER TABLE inspection_masters
  ADD COLUMN IF NOT EXISTS improvement_bonus DECIMAL(5,1) DEFAULT 0;

-- =====================================================
-- PART 4: DB Trigger - 自動生成待改善紀錄
-- 
-- ⚠️ 時序問題：
--   新增巡店流程：先 INSERT masters(status=completed)，再 INSERT results
--   所以 masters 的 trigger 在 results 插入前就觸發了，找不到任何結果
--
-- 解決方案：
--   A) 保留 masters trigger（處理 edit 時 status 變更的情況）
--   B) 新增 results trigger（處理 results 插入後的情況）★主要
-- =====================================================

-- === A) Masters trigger: 處理 status 從非 completed 變為 completed 的情況 ===
-- 主要用途：編輯頁面把 draft → completed 時，舊 results 還存在
CREATE OR REPLACE FUNCTION generate_inspection_improvements()
RETURNS TRIGGER AS $$
DECLARE
  v_max_days INT;
  r RECORD;
BEGIN
  -- 只在督導巡店狀態變為 'completed' 時觸發（經理巡店是複檢模組，不產生改善紀錄）
  IF NEW.status = 'completed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'completed')
     AND (NEW.inspection_type IS NULL OR NEW.inspection_type = 'supervisor') THEN
    
    -- 從加分設定取得最大改善天數（取最大的 day_to，預設 7 天）
    SELECT COALESCE(MAX(day_to), 7) INTO v_max_days
    FROM inspection_bonus_config
    WHERE is_active = true;
    
    -- 為每個 is_improvement = true 的項目建立改善紀錄
    FOR r IN
      SELECT
        ir.id AS result_id,
        ir.template_id,
        it.section_name,
        it.item_name,
        ir.deduction_amount,
        ir.notes,
        ir.photo_urls,
        ir.selected_items
      FROM inspection_results ir
      JOIN inspection_templates it ON it.id = ir.template_id
      WHERE ir.inspection_id = NEW.id
        AND ir.is_improvement = true
    LOOP
      INSERT INTO inspection_improvements (
        inspection_id, inspection_result_id, template_id, store_id,
        section_name, item_name, deduction_amount,
        issue_description, issue_photo_urls, selected_items,
        deadline, status
      ) VALUES (
        NEW.id, r.result_id, r.template_id, NEW.store_id,
        r.section_name, r.item_name, r.deduction_amount,
        r.notes,
        COALESCE(r.photo_urls, '[]'::jsonb),
        COALESCE(r.selected_items, '[]'::jsonb),
        NEW.inspection_date + v_max_days,
        'pending'
      )
      ON CONFLICT (inspection_id, template_id) DO NOTHING;
    END LOOP;
    
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_generate_improvements ON inspection_masters;

CREATE TRIGGER trigger_generate_improvements
  AFTER INSERT OR UPDATE ON inspection_masters
  FOR EACH ROW
  EXECUTE FUNCTION generate_inspection_improvements();

-- === B) Results trigger: 每次插入扣分結果時，自動建立改善紀錄 ===★主要觸發點
CREATE OR REPLACE FUNCTION generate_improvement_from_result()
RETURNS TRIGGER AS $$
DECLARE
  v_max_days INT;
  v_master RECORD;
  v_template RECORD;
BEGIN
  -- 只處理有扣分的項目
  IF NEW.is_improvement = true THEN
    
    -- 檢查父 inspection 是否已 completed
    SELECT id, store_id, inspection_date, status, inspection_type
    INTO v_master
    FROM inspection_masters
    WHERE id = NEW.inspection_id;
    
    -- 只有督導巡店且 completed 狀態才產生改善紀錄（經理巡店是複檢模組，不需要改善）
    IF v_master.status = 'completed' AND (v_master.inspection_type IS NULL OR v_master.inspection_type = 'supervisor') THEN
      
      -- 取得模板資訊
      SELECT section_name, item_name
      INTO v_template
      FROM inspection_templates
      WHERE id = NEW.template_id;
      
      -- 取得最大改善天數
      SELECT COALESCE(MAX(day_to), 7) INTO v_max_days
      FROM inspection_bonus_config
      WHERE is_active = true;
      
      -- 建立改善紀錄
      INSERT INTO inspection_improvements (
        inspection_id, inspection_result_id, template_id, store_id,
        section_name, item_name, deduction_amount,
        issue_description, issue_photo_urls, selected_items,
        deadline, status
      ) VALUES (
        NEW.inspection_id, NEW.id, NEW.template_id, v_master.store_id,
        v_template.section_name, v_template.item_name, NEW.deduction_amount,
        NEW.notes,
        COALESCE(NEW.photo_urls, '[]'::jsonb),
        COALESCE(NEW.selected_items, '[]'::jsonb),
        v_master.inspection_date + v_max_days,
        'pending'
      )
      ON CONFLICT (inspection_id, template_id) DO NOTHING;
      
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_generate_improvement_from_result ON inspection_results;

CREATE TRIGGER trigger_generate_improvement_from_result
  AFTER INSERT ON inspection_results
  FOR EACH ROW
  EXECUTE FUNCTION generate_improvement_from_result();

-- =====================================================
-- PART 5: DB Trigger - 提交改善時自動計算加分
-- =====================================================

-- BEFORE trigger: 計算 days_taken 和 bonus_score
CREATE OR REPLACE FUNCTION calculate_improvement_bonus()
RETURNS TRIGGER AS $$
DECLARE
  v_inspection_date DATE;
  v_bonus DECIMAL(5,1);
BEGIN
  -- 只在狀態變為 'improved' 時計算
  IF NEW.status = 'improved' AND (OLD IS NULL OR OLD.status IS DISTINCT FROM 'improved') THEN
    
    -- 取得巡店日期
    SELECT inspection_date INTO v_inspection_date
    FROM inspection_masters
    WHERE id = NEW.inspection_id;
    
    -- 計算改善天數（提交日 - 巡店日）
    NEW.days_taken := GREATEST((NEW.improved_at::date - v_inspection_date), 0);
    
    -- 從加分設定查詢對應的加分
    SELECT COALESCE(bc.bonus_score, 0) INTO v_bonus
    FROM inspection_bonus_config bc
    WHERE bc.is_active = true
      AND NEW.days_taken BETWEEN bc.day_from AND bc.day_to
    ORDER BY bc.sort_order
    LIMIT 1;
    
    NEW.bonus_score := COALESCE(v_bonus, 0);
    
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_calculate_bonus ON inspection_improvements;

CREATE TRIGGER trigger_calculate_bonus
  BEFORE UPDATE ON inspection_improvements
  FOR EACH ROW
  EXECUTE FUNCTION calculate_improvement_bonus();

-- AFTER trigger: 更新 inspection_masters 的 improvement_bonus 總分、total_score 和 grade
CREATE OR REPLACE FUNCTION update_inspection_bonus_total()
RETURNS TRIGGER AS $$
DECLARE
  v_new_bonus DECIMAL(5,1);
  v_old_bonus DECIMAL(5,1);
  v_base_score INT;
  v_new_total INT;
  v_new_grade TEXT;
BEGIN
  -- 計算新的總加分
  SELECT COALESCE(SUM(bonus_score), 0) INTO v_new_bonus
  FROM inspection_improvements
  WHERE inspection_id = NEW.inspection_id
    AND status = 'improved';
  
  -- 取得目前的 improvement_bonus 和 total_score
  SELECT COALESCE(improvement_bonus, 0), COALESCE(total_score, 0)
  INTO v_old_bonus, v_base_score
  FROM inspection_masters
  WHERE id = NEW.inspection_id;
  
  -- 計算基礎分數（扣除舊的加分）
  v_base_score := v_base_score - v_old_bonus;
  -- 新總分 = 基礎分 + 新加分
  v_new_total := v_base_score + v_new_bonus;
  
  -- 重新計算 grade（與前端邏輯一致）
  IF v_new_total >= 220 THEN v_new_grade := '10';
  ELSIF v_new_total >= 215 THEN v_new_grade := '9';
  ELSIF v_new_total >= 191 THEN v_new_grade := '8';
  ELSIF v_new_total >= 181 THEN v_new_grade := '7';
  ELSIF v_new_total >= 171 THEN v_new_grade := '6';
  ELSIF v_new_total >= 161 THEN v_new_grade := '5';
  ELSIF v_new_total >= 151 THEN v_new_grade := '4';
  ELSIF v_new_total >= 141 THEN v_new_grade := '3';
  ELSIF v_new_total >= 131 THEN v_new_grade := '2';
  ELSIF v_new_total >= 121 THEN v_new_grade := '1';
  ELSE v_new_grade := '0';
  END IF;
  
  -- 更新 masters
  UPDATE inspection_masters
  SET improvement_bonus = v_new_bonus,
      total_score = v_new_total,
      grade = v_new_grade
  WHERE id = NEW.inspection_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_update_bonus_total ON inspection_improvements;

CREATE TRIGGER trigger_update_bonus_total
  AFTER UPDATE ON inspection_improvements
  FOR EACH ROW
  WHEN (NEW.status = 'improved' AND (OLD.status IS DISTINCT FROM 'improved'))
  EXECUTE FUNCTION update_inspection_bonus_total();

-- =====================================================
-- PART 5b: 編輯巡店時清理舊改善紀錄
-- 說明: 編輯頁面會先 DELETE 舊 results 再 INSERT 新 results
--       需要在 results 被刪時，清理尚未改善的 improvements
--       已改善的保留（避免店長已上傳的改善被刪除）
-- =====================================================

CREATE OR REPLACE FUNCTION cleanup_improvements_on_result_delete()
RETURNS TRIGGER AS $$
BEGIN
  -- 只刪除 pending 狀態的改善紀錄（已改善的保留）
  DELETE FROM inspection_improvements
  WHERE inspection_id = OLD.inspection_id
    AND template_id = OLD.template_id
    AND status = 'pending';
  
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_cleanup_improvements ON inspection_results;

CREATE TRIGGER trigger_cleanup_improvements
  AFTER DELETE ON inspection_results
  FOR EACH ROW
  EXECUTE FUNCTION cleanup_improvements_on_result_delete();

-- =====================================================
-- PART 6: RLS 策略
-- =====================================================

ALTER TABLE inspection_improvements ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_bonus_config ENABLE ROW LEVEL SECURITY;

-- === inspection_improvements RLS ===

-- SELECT: 店長看自己門市 / 有 view_all 權限 / 自己建立的巡店 / admin 兜底
CREATE POLICY "查看待改善事項"
ON inspection_improvements
FOR SELECT
TO authenticated
USING (
  -- 1. 自己門市的（店長）
  EXISTS (
    SELECT 1 FROM store_managers sm
    WHERE sm.store_id = inspection_improvements.store_id
    AND sm.user_id = auth.uid()
  )
  -- 2. 自己建立的巡店的
  OR EXISTS (
    SELECT 1 FROM inspection_masters im
    WHERE im.id = inspection_improvements.inspection_id
    AND im.inspector_id = auth.uid()
  )
  -- 3. RBAC: 查看所有待改善
  OR EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN role_permissions rp ON ur.role_id = rp.role_id
    JOIN permissions perm ON rp.permission_id = perm.id
    WHERE ur.user_id = auth.uid()
      AND ur.is_active = true
      AND rp.is_allowed = true
      AND perm.code = 'inspection.improvement.view_all'
  )
  -- 4. admin 兜底
  OR EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'
  )
);

-- UPDATE: 店長提交改善（自己門市） / 督導/admin 可修改
CREATE POLICY "更新待改善事項"
ON inspection_improvements
FOR UPDATE
TO authenticated
USING (
  -- 店長更新自己門市的
  EXISTS (
    SELECT 1 FROM store_managers sm
    WHERE sm.store_id = inspection_improvements.store_id
    AND sm.user_id = auth.uid()
  )
  -- 督導更新自己建立的巡店的
  OR EXISTS (
    SELECT 1 FROM inspection_masters im
    WHERE im.id = inspection_improvements.inspection_id
    AND im.inspector_id = auth.uid()
  )
  -- RBAC 管理權限
  OR EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN role_permissions rp ON ur.role_id = rp.role_id
    JOIN permissions perm ON rp.permission_id = perm.id
    WHERE ur.user_id = auth.uid()
      AND ur.is_active = true
      AND rp.is_allowed = true
      AND perm.code = 'inspection.improvement.manage'
  )
  -- admin 兜底
  OR EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'
  )
);

-- INSERT: 由 trigger（SECURITY DEFINER）執行，不需要一般用戶 INSERT
-- 但預留 admin 直接建立的權限
CREATE POLICY "建立待改善事項"
ON inspection_improvements
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'
  )
);

-- DELETE: 僅 admin
CREATE POLICY "刪除待改善事項"
ON inspection_improvements
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'
  )
);

-- === inspection_bonus_config RLS ===

-- SELECT: 所有已登入用戶可查看（顯示加分規則）
CREATE POLICY "查看加分規則"
ON inspection_bonus_config
FOR SELECT
TO authenticated
USING (true);

-- INSERT/UPDATE/DELETE: 僅有模板管理權限的人
CREATE POLICY "管理加分規則"
ON inspection_bonus_config
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN role_permissions rp ON ur.role_id = rp.role_id
    JOIN permissions perm ON rp.permission_id = perm.id
    WHERE ur.user_id = auth.uid()
      AND ur.is_active = true
      AND rp.is_allowed = true
      AND perm.code = 'inspection.template.manage'
  )
  OR EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'
  )
);

-- =====================================================
-- PART 7: RBAC 權限
-- =====================================================

INSERT INTO permissions (code, description, module, feature, action, is_active)
VALUES
  (
    'inspection.improvement.view_all',
    '查看所有待改善事項 - 允許查看全部門市的待改善事項',
    '督導巡店',
    'inspection_improvement',
    'view_all',
    true
  ),
  (
    'inspection.improvement.view_own_store',
    '查看門市待改善事項 - 允許店長查看自己門市的待改善事項',
    '督導巡店',
    'inspection_improvement',
    'view_own_store',
    true
  ),
  (
    'inspection.improvement.submit',
    '提交改善內容 - 允許店長上傳改善說明與照片',
    '督導巡店',
    'inspection_improvement',
    'submit',
    true
  ),
  (
    'inspection.improvement.manage',
    '管理待改善事項 - 允許管理（編輯/刪除）待改善事項',
    '督導巡店',
    'inspection_improvement',
    'manage',
    true
  )
ON CONFLICT (code)
DO UPDATE SET
  description = EXCLUDED.description,
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  action = EXCLUDED.action,
  is_active = EXCLUDED.is_active;

-- =====================================================
-- PART 8: 分配權限給角色
-- =====================================================

-- 管理員：全部權限
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.code = 'admin_role'
AND p.code IN (
  'inspection.improvement.view_all',
  'inspection.improvement.view_own_store',
  'inspection.improvement.submit',
  'inspection.improvement.manage'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 督導：查看所有 + 管理
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.code = 'supervisor_role'
AND p.code IN (
  'inspection.improvement.view_all',
  'inspection.improvement.manage'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 店長：查看自己門市 + 提交改善
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.code = 'store_manager_role'
AND p.code IN (
  'inspection.improvement.view_own_store',
  'inspection.improvement.submit'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- =====================================================
-- PART 9: 驗證
-- =====================================================

-- 驗證表格建立
SELECT 'inspection_improvements' AS table_name, COUNT(*) AS row_count
FROM inspection_improvements
UNION ALL
SELECT 'inspection_bonus_config', COUNT(*)
FROM inspection_bonus_config;

-- 驗證權限分配
SELECT p.code, p.description,
  ARRAY_AGG(r.code ORDER BY r.code) AS assigned_roles
FROM permissions p
LEFT JOIN role_permissions rp ON rp.permission_id = p.id
LEFT JOIN roles r ON r.id = rp.role_id
WHERE p.code LIKE 'inspection.improvement.%'
GROUP BY p.code, p.description
ORDER BY p.code;

-- 驗證加分規則
SELECT day_from, day_to, bonus_score, description
FROM inspection_bonus_config
WHERE is_active = true
ORDER BY sort_order;

-- 驗證 trigger
SELECT tgname, tgrelid::regclass, tgtype
FROM pg_trigger
WHERE tgname IN (
  'trigger_generate_improvements',
  'trigger_generate_improvement_from_result',
  'trigger_cleanup_improvements',
  'trigger_calculate_bonus',
  'trigger_update_bonus_total'
);
