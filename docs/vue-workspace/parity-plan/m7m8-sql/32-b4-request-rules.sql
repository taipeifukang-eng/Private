-- 32-b4-request-rules.sql
-- 正式區草稿（尚未執行，僅供使用者審閱）。內容與 DEV 已測過的 supabase/workspace-dev/20261112100000_m7m8_b4_request_rules.sql 相同。
-- 第 4 批 A（需求單與處理單規則的資料結構）（2026-11-12 第 4 批問卷 D1 至 D21）。
-- 性質：會寫入，但只新增 2 張表（流程設定、設定變更紀錄）與 9 個可為空或有預設值的欄位（處理單待交付時間、單據作廢 3 欄、留言原文、事件代按標記、需求單取消原因與重新開啟次數、報價作廢標記），不改任何既有資料、函式與觸發器；舊版畫面完全不受影響。
-- 設定表預設值：採購核准啟用、核准門檻 5000 元（含稅總額大於才需核准）、稅率 0.05、需求單待門市確認逾期天數 7、歷史價筆數 5。登入者不能直接讀寫設定表，只有 33 的函式（SECURITY DEFINER）與 service_role 能存取。
-- 先決條件：需求單、處理單、單據、留言、事件、採購評估報價、profiles 資料表已存在（先跑 31 確認）。
-- 檔案自己 BEGIN ... COMMIT，一次 Run 即可，任何一句出錯整份不生效。撤回：32-b4-request-rules-rollback.sql。套用前先跑 31-b4-preview-before-apply.sql，備份後經使用者核可才執行。
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.ga_service_requests') IS NULL OR to_regclass('public.ga_service_request_comments') IS NULL
     OR to_regclass('public.ga_service_request_events') IS NULL OR to_regclass('public.ga_part_fulfillments') IS NULL
     OR to_regclass('public.ga_part_fulfillment_documents') IS NULL OR to_regclass('public.ga_purchase_review_quotes') IS NULL
     OR to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: 需求單／處理單／採購評估相關資料表';
  END IF;
END $$;

-- ---------------------------------------------------------------- 1. 設定表
CREATE TABLE IF NOT EXISTS public.ga_workflow_settings (
  key text PRIMARY KEY,
  value_num numeric,
  value_text text,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ga_workflow_settings_key_format CHECK (key ~ '^[a-z][a-z0-9_]{0,59}$')
);
INSERT INTO public.ga_workflow_settings (key, value_num) VALUES
  ('po_approval_enabled', 1),
  ('po_approval_threshold', 5000),
  ('po_tax_rate', 0.05),
  ('request_overdue_confirm_days', 7),
  ('po_price_history_limit', 5)
ON CONFLICT (key) DO NOTHING;
ALTER TABLE public.ga_workflow_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ga_workflow_settings FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.ga_workflow_settings TO service_role;

-- ---------------------------------------------------------------- 2. 設定變更紀錄
CREATE TABLE IF NOT EXISTS public.ga_workflow_setting_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key text NOT NULL,
  old_value_num numeric,
  new_value_num numeric,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ga_workflow_setting_events_key ON public.ga_workflow_setting_events (setting_key, created_at DESC);
ALTER TABLE public.ga_workflow_setting_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ga_workflow_setting_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.ga_workflow_setting_events TO service_role;

-- ---------------------------------------------------------------- 3. 處理單與單據
ALTER TABLE public.ga_part_fulfillments ADD COLUMN IF NOT EXISTS ready_to_deliver_at timestamptz;
ALTER TABLE public.ga_part_fulfillment_documents
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS void_reason text,
  ADD COLUMN IF NOT EXISTS voided_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------- 4. 留言與事件
ALTER TABLE public.ga_service_request_comments ADD COLUMN IF NOT EXISTS original_body text;
ALTER TABLE public.ga_service_request_events ADD COLUMN IF NOT EXISTS proxy_for_store boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------- 5. 需求單
ALTER TABLE public.ga_service_requests
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS reopened_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.ga_service_requests DROP CONSTRAINT IF EXISTS ga_service_requests_reopened_count_check;
ALTER TABLE public.ga_service_requests ADD CONSTRAINT ga_service_requests_reopened_count_check CHECK (reopened_count >= 0);

-- ---------------------------------------------------------------- 6. 報價歷史
ALTER TABLE public.ga_purchase_review_quotes ADD COLUMN IF NOT EXISTS superseded_at timestamptz;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- 核對
SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND (table_name, column_name) IN (('ga_part_fulfillments', 'ready_to_deliver_at'), ('ga_part_fulfillment_documents', 'voided_at'), ('ga_part_fulfillment_documents', 'void_reason'), ('ga_part_fulfillment_documents', 'voided_by'), ('ga_service_request_comments', 'original_body'), ('ga_service_request_events', 'proxy_for_store'), ('ga_service_requests', 'cancel_reason'), ('ga_service_requests', 'reopened_count'), ('ga_purchase_review_quotes', 'superseded_at')) ORDER BY 1, 2;
-- 核對：應列出 9 個欄位；設定表應有 5 列
SELECT key, value_num FROM public.ga_workflow_settings ORDER BY key;
