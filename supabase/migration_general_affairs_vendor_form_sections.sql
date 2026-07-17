-- ============================================================
-- 總務服務中心 - 廠商新增五段式表單欄位
-- 說明：
--   補齊新增廠商流程中的服務能力、帳務、合作與附件檔名欄位。
-- ============================================================

ALTER TABLE ga_vendors
  ADD COLUMN IF NOT EXISTS service_capability_note TEXT,
  ADD COLUMN IF NOT EXISTS billing_title TEXT,
  ADD COLUMN IF NOT EXISTS billing_address TEXT,
  ADD COLUMN IF NOT EXISTS invoice_type TEXT,
  ADD COLUMN IF NOT EXISTS payment_terms TEXT,
  ADD COLUMN IF NOT EXISTS payment_methods TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS accounting_notes TEXT,
  ADD COLUMN IF NOT EXISTS cooperation_start_date DATE,
  ADD COLUMN IF NOT EXISTS contract_end_date DATE,
  ADD COLUMN IF NOT EXISTS contract_required BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS preferred_vendor BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS cooperation_notes TEXT,
  ADD COLUMN IF NOT EXISTS attachment_names TEXT[] NOT NULL DEFAULT '{}';
