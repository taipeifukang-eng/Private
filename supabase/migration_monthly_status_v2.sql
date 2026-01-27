-- Migration: 每月人員狀態功能擴展 v2
-- 日期: 2026-01-24
-- 說明: 新增新人階級、未上滿整月原因、督導卡班資訊、特殊身分等欄位

-- =====================================================
-- Part 1: 擴展 monthly_staff_status 表
-- =====================================================

-- 1. 新人階級
ALTER TABLE monthly_staff_status ADD COLUMN IF NOT EXISTS newbie_level VARCHAR(20);
-- 值: '未過階新人' | '一階新人' | '二階新人' | null

-- 2. 未上滿整月相關
ALTER TABLE monthly_staff_status ADD COLUMN IF NOT EXISTS partial_month_reason VARCHAR(50);
-- 值: '復職' | '調入店' | '調出店' | '離職' | '留職停薪' | '店長-雙' | '代理店長-雙' | null

ALTER TABLE monthly_staff_status ADD COLUMN IF NOT EXISTS partial_month_days INTEGER;
-- 實際排班天數

ALTER TABLE monthly_staff_status ADD COLUMN IF NOT EXISTS partial_month_notes TEXT;
-- 備註說明

-- 3. 督導卡班相關（記錄來店支援的督導資訊）
ALTER TABLE monthly_staff_status ADD COLUMN IF NOT EXISTS supervisor_shift_hours DECIMAL(5,2);
-- 卡班時數

ALTER TABLE monthly_staff_status ADD COLUMN IF NOT EXISTS supervisor_employee_code VARCHAR(20);
-- 督導員編

ALTER TABLE monthly_staff_status ADD COLUMN IF NOT EXISTS supervisor_name VARCHAR(100);
-- 督導姓名

ALTER TABLE monthly_staff_status ADD COLUMN IF NOT EXISTS supervisor_position VARCHAR(50);
-- 督導職位

-- 4. 特殊身分相關
ALTER TABLE monthly_staff_status ADD COLUMN IF NOT EXISTS is_dual_store_manager BOOLEAN DEFAULT false;
-- 是否擔任雙店長

ALTER TABLE monthly_staff_status ADD COLUMN IF NOT EXISTS special_role VARCHAR(100);
-- 特殊身分，如 '督導(代理店長)'

ALTER TABLE monthly_staff_status ADD COLUMN IF NOT EXISTS extra_tasks TEXT[];
-- 額外任務，如 ARRAY['長照外務', '診所業務']

-- 5. 標記是否為手動新增的人員
ALTER TABLE monthly_staff_status ADD COLUMN IF NOT EXISTS is_manually_added BOOLEAN DEFAULT false;

-- =====================================================
-- Part 2: 建立督導卡班記錄表（一個門市可能有多個督導來卡班）
-- =====================================================

CREATE TABLE IF NOT EXISTS monthly_supervisor_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year_month VARCHAR(7) NOT NULL,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  
  -- 督導資訊
  supervisor_employee_code VARCHAR(20),
  supervisor_name VARCHAR(100) NOT NULL,
  supervisor_position VARCHAR(50),
  
  -- 卡班資訊
  shift_hours DECIMAL(5,2) NOT NULL DEFAULT 0,
  shift_days INTEGER,
  notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(year_month, store_id, supervisor_employee_code)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_supervisor_shifts_year_month ON monthly_supervisor_shifts(year_month);
CREATE INDEX IF NOT EXISTS idx_supervisor_shifts_store ON monthly_supervisor_shifts(store_id);

-- =====================================================
-- Part 3: 確保 user_id 可為 null（支援不需系統帳號的員工）
-- =====================================================

ALTER TABLE monthly_staff_status ALTER COLUMN user_id DROP NOT NULL;

-- =====================================================
-- Part 4: 新增註解說明
-- =====================================================

COMMENT ON COLUMN monthly_staff_status.newbie_level IS '新人階級: 未過階新人|一階新人|二階新人';
COMMENT ON COLUMN monthly_staff_status.partial_month_reason IS '未上滿整月原因: 復職|調入店|調出店|離職|留職停薪|店長-雙|代理店長-雙';
COMMENT ON COLUMN monthly_staff_status.partial_month_days IS '未上滿整月時的實際排班天數';
COMMENT ON COLUMN monthly_staff_status.partial_month_notes IS '未上滿整月的備註說明';
COMMENT ON COLUMN monthly_staff_status.is_dual_store_manager IS '是否擔任雙店長';
COMMENT ON COLUMN monthly_staff_status.special_role IS '特殊身分如督導(代理店長)';
COMMENT ON COLUMN monthly_staff_status.extra_tasks IS '額外任務陣列如長照外務、診所業務';
COMMENT ON COLUMN monthly_staff_status.is_manually_added IS '是否為手動新增的人員';

COMMENT ON TABLE monthly_supervisor_shifts IS '每月督導卡班記錄';
