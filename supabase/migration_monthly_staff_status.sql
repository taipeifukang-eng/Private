-- =====================================================
-- 富康內部業務管理系統 - 每月人員狀態確認功能
-- =====================================================

-- 1. 門市資料表 (stores)
-- 儲存所有門市資訊
CREATE TABLE IF NOT EXISTS stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_code VARCHAR(20) UNIQUE NOT NULL,  -- 門市代碼 (如: F001, F002)
  store_name VARCHAR(100) NOT NULL,         -- 門市名稱
  address TEXT,                              -- 門市地址
  phone VARCHAR(20),                         -- 門市電話
  is_active BOOLEAN DEFAULT true,            -- 是否營運中
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- 2. 門市管理關聯表 (store_managers)
-- 記錄誰是哪間門市的店長/督導
CREATE TABLE IF NOT EXISTS store_managers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role_type VARCHAR(20) NOT NULL CHECK (role_type IN ('store_manager', 'supervisor', 'area_manager')),
  -- store_manager: 店長
  -- supervisor: 督導 (可管理多間門市)
  -- area_manager: 區經理 (可管理所有門市)
  is_primary BOOLEAN DEFAULT false,  -- 是否為主要負責人
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE(store_id, user_id, role_type)
);

-- 3. 員工門市歸屬表 (store_employees)
-- 記錄每位員工屬於哪間門市
CREATE TABLE IF NOT EXISTS store_employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  employee_code VARCHAR(20),              -- 員工代號
  position VARCHAR(50),                   -- 職位 (店長/代理店長/正職/兼職藥師/兼職一般)
  employment_type VARCHAR(20) NOT NULL CHECK (employment_type IN ('full_time', 'part_time')),
  -- full_time: 正職
  -- part_time: 兼職
  is_pharmacist BOOLEAN DEFAULT false,    -- 是否為藥師
  is_active BOOLEAN DEFAULT true,
  start_date DATE,                        -- 到職日
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE(store_id, user_id)
);

-- 4. 每月人員狀態表 (monthly_staff_status)
-- 記錄每月每位員工的狀態，用於獎金計算
CREATE TABLE IF NOT EXISTS monthly_staff_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- 基本資訊
  year_month VARCHAR(7) NOT NULL,           -- 年月 (如: 2026-01)
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  
  -- 人員基本資訊快照 (當月記錄時的狀態)
  employee_code VARCHAR(20),                -- 員工代號
  employee_name VARCHAR(100),               -- 員工姓名
  position VARCHAR(50),                     -- 職位
  employment_type VARCHAR(20) NOT NULL,     -- 正職/兼職
  is_pharmacist BOOLEAN DEFAULT false,      -- 是否為藥師
  
  -- 本月狀態 (必選)
  monthly_status VARCHAR(30) NOT NULL CHECK (monthly_status IN (
    'full_month',        -- 整月在職
    'new_hire',          -- 到職 (本月新進)
    'resigned',          -- 離職
    'leave_of_absence',  -- 留停
    'transferred_in',    -- 調入
    'transferred_out',   -- 調出
    'promoted',          -- 升職
    'support_rotation'   -- 支援卡班
  )),
  
  -- 天數/時數相關
  work_days INTEGER,                        -- 本月工作天數 (正職用)
  total_days_in_month INTEGER DEFAULT 30,   -- 本月總天數
  work_hours DECIMAL(6,2),                  -- 本月工作時數 (兼職用)
  
  -- 特殊標記
  is_dual_position BOOLEAN DEFAULT false,   -- 是否為「雙」職務 (如: 店長-雙、代理店長-雙)
  has_manager_bonus BOOLEAN DEFAULT false,  -- 是否有店長/代理加成資格
  is_supervisor_rotation BOOLEAN DEFAULT false, -- 是否為督導卡班
  
  -- 系統自動計算的區塊 (根據以上條件自動判定)
  calculated_block INTEGER,                 -- 自動計算的獎金區塊 (1-6)
  
  -- 審核相關
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'confirmed')),
  -- draft: 草稿
  -- submitted: 已提交 (等待審核)
  -- confirmed: 已確認
  
  submitted_at TIMESTAMP WITH TIME ZONE,    -- 提交時間
  submitted_by UUID REFERENCES profiles(id),
  confirmed_at TIMESTAMP WITH TIME ZONE,    -- 確認時間
  confirmed_by UUID REFERENCES profiles(id),
  
  -- 備註
  notes TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  
  UNIQUE(year_month, store_id, user_id)
);

-- 5. 每月門市狀態摘要表 (monthly_store_summary)
-- 記錄每月每間門市的狀態確認進度
CREATE TABLE IF NOT EXISTS monthly_store_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year_month VARCHAR(7) NOT NULL,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  
  total_employees INTEGER DEFAULT 0,        -- 總人數
  confirmed_count INTEGER DEFAULT 0,        -- 已確認人數
  
  store_status VARCHAR(20) DEFAULT 'pending' CHECK (store_status IN (
    'pending',     -- 待填寫
    'in_progress', -- 填寫中
    'submitted',   -- 已提交
    'confirmed'    -- 已確認
  )),
  
  submitted_at TIMESTAMP WITH TIME ZONE,
  submitted_by UUID REFERENCES profiles(id),
  confirmed_at TIMESTAMP WITH TIME ZONE,
  confirmed_by UUID REFERENCES profiles(id),
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  
  UNIQUE(year_month, store_id)
);

-- =====================================================
-- 索引優化
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_store_managers_user_id ON store_managers(user_id);
CREATE INDEX IF NOT EXISTS idx_store_managers_store_id ON store_managers(store_id);
CREATE INDEX IF NOT EXISTS idx_store_employees_user_id ON store_employees(user_id);
CREATE INDEX IF NOT EXISTS idx_store_employees_store_id ON store_employees(store_id);
CREATE INDEX IF NOT EXISTS idx_monthly_staff_status_year_month ON monthly_staff_status(year_month);
CREATE INDEX IF NOT EXISTS idx_monthly_staff_status_store_id ON monthly_staff_status(store_id);
CREATE INDEX IF NOT EXISTS idx_monthly_staff_status_user_id ON monthly_staff_status(user_id);
CREATE INDEX IF NOT EXISTS idx_monthly_store_summary_year_month ON monthly_store_summary(year_month);

-- =====================================================
-- RLS 策略 (Row Level Security)
-- =====================================================

ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_managers ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_staff_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_store_summary ENABLE ROW LEVEL SECURITY;

-- Stores: 所有人可讀，管理員可寫
CREATE POLICY "Anyone can view stores" ON stores FOR SELECT USING (true);
CREATE POLICY "Admins can manage stores" ON stores FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Store Managers: 相關人員可讀，管理員可寫
CREATE POLICY "Users can view their store management" ON store_managers FOR SELECT USING (
  user_id = auth.uid() OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'manager'))
);
CREATE POLICY "Admins can manage store managers" ON store_managers FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Store Employees: 相關門市人員可讀，管理員/店長可寫
CREATE POLICY "Users can view store employees" ON store_employees FOR SELECT USING (
  user_id = auth.uid() OR
  EXISTS (SELECT 1 FROM store_managers WHERE user_id = auth.uid() AND store_id = store_employees.store_id) OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'manager'))
);
CREATE POLICY "Managers can manage store employees" ON store_employees FOR ALL USING (
  EXISTS (SELECT 1 FROM store_managers WHERE user_id = auth.uid() AND store_id = store_employees.store_id) OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Monthly Staff Status: 相關門市人員可讀，店長可編輯草稿，督導/經理可確認
CREATE POLICY "Users can view monthly staff status" ON monthly_staff_status FOR SELECT USING (
  user_id = auth.uid() OR
  EXISTS (SELECT 1 FROM store_managers WHERE user_id = auth.uid() AND store_id = monthly_staff_status.store_id) OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'manager'))
);
CREATE POLICY "Store managers can edit monthly status" ON monthly_staff_status FOR ALL USING (
  EXISTS (SELECT 1 FROM store_managers WHERE user_id = auth.uid() AND store_id = monthly_staff_status.store_id) OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'manager'))
);

-- Monthly Store Summary: 相關門市人員可讀，店長/督導/經理可寫
CREATE POLICY "Users can view monthly store summary" ON monthly_store_summary FOR SELECT USING (
  EXISTS (SELECT 1 FROM store_managers WHERE user_id = auth.uid() AND store_id = monthly_store_summary.store_id) OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'manager'))
);
CREATE POLICY "Managers can manage monthly store summary" ON monthly_store_summary FOR ALL USING (
  EXISTS (SELECT 1 FROM store_managers WHERE user_id = auth.uid() AND store_id = monthly_store_summary.store_id) OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'manager'))
);

-- =====================================================
-- 輔助函數：自動計算獎金區塊
-- =====================================================

CREATE OR REPLACE FUNCTION calculate_bonus_block(
  p_employment_type VARCHAR,
  p_monthly_status VARCHAR,
  p_is_pharmacist BOOLEAN,
  p_position VARCHAR,
  p_is_dual_position BOOLEAN,
  p_is_supervisor_rotation BOOLEAN
) RETURNS INTEGER AS $$
BEGIN
  -- 區塊 2：督導卡班
  IF p_is_supervisor_rotation THEN
    RETURN 2;
  END IF;
  
  -- 區塊 6：兼職一般人
  IF p_employment_type = 'part_time' AND NOT p_is_pharmacist THEN
    RETURN 6;
  END IF;
  
  -- 區塊 5：兼職藥師
  IF p_employment_type = 'part_time' AND p_is_pharmacist THEN
    RETURN 5;
  END IF;
  
  -- 區塊 4：特殊時數 (督導(代理店長)-雙)
  IF p_position LIKE '%督導%' AND p_position LIKE '%代理店長%' AND p_is_dual_position THEN
    RETURN 4;
  END IF;
  
  -- 區塊 3：非整月正職 (但店長-雙、代理店長-雙也在這)
  IF p_employment_type = 'full_time' AND p_monthly_status != 'full_month' THEN
    RETURN 3;
  END IF;
  
  -- 區塊 3：店長-雙、代理店長-雙
  IF p_is_dual_position AND (p_position LIKE '%店長%' OR p_position LIKE '%代理店長%') THEN
    RETURN 3;
  END IF;
  
  -- 區塊 1：正職整月
  IF p_employment_type = 'full_time' AND p_monthly_status = 'full_month' THEN
    RETURN 1;
  END IF;
  
  -- 預設返回 0 (未分類)
  RETURN 0;
END;
$$ LANGUAGE plpgsql;

-- 觸發器：在插入/更新時自動計算區塊
CREATE OR REPLACE FUNCTION update_calculated_block()
RETURNS TRIGGER AS $$
BEGIN
  NEW.calculated_block := calculate_bonus_block(
    NEW.employment_type,
    NEW.monthly_status,
    NEW.is_pharmacist,
    NEW.position,
    NEW.is_dual_position,
    NEW.is_supervisor_rotation
  );
  NEW.updated_at := TIMEZONE('utc', NOW());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_calculated_block
  BEFORE INSERT OR UPDATE ON monthly_staff_status
  FOR EACH ROW
  EXECUTE FUNCTION update_calculated_block();

-- =====================================================
-- 範例資料 (可選)
-- =====================================================

-- 插入範例門市
-- INSERT INTO stores (store_code, store_name) VALUES
-- ('F001', '富康藥局 中正店'),
-- ('F002', '富康藥局 信義店'),
-- ('F003', '富康藥局 大安店');
