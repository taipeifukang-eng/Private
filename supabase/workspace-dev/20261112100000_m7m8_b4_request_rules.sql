-- M7/M8 第 4 批 A（需求單與處理單規則的資料結構）：設定表、待交付、單據作廢、留言原文、事件代按標記、取消與重新開啟、報價歷史。
-- 內容（只新增資料表與欄位，全部可為空或有預設值，不改任何既有資料、不改任何舊版函式；舊版畫面與舊版 API 行為不變）：
--   1. ga_workflow_settings：總務流程設定（鍵值），第 4 批用到採購核准門檻、稅率、歷史價筆數、需求單逾期未確認天數。
--      只有 service_role 與 SECURITY DEFINER 函式能讀寫（登入者不能直接讀寫表）。
--   2. ga_workflow_setting_events：設定每次變更的紀錄（誰、舊值、新值）。
--   3. ga_part_fulfillments.ready_to_deliver_at（Q18「待交付」）；ga_part_fulfillment_documents.voided_at／void_reason／voided_by（Q18 逐筆作廢）。
--   4. ga_service_request_comments.original_body（Q16 留言被改或刪時保留原文，只給總務看）；
--      ga_service_request_events.proxy_for_store（Q16 總務代門市操作標記）。事件原本就有 visibility（PUBLIC／INTERNAL）可當時間軸公開事件，不另加 public_to_store。
--   5. ga_service_requests.cancel_reason／reopened_count（Q17 取消原因與重新開啟次數）。
--   6. ga_purchase_review_quotes.superseded_at（Q18 改採購決策時報價保留歷史，不刪除）。
-- 先決：第 4 批需要的既有資料表。還原：20261112100000_m7m8_b4_request_rules.rollback.sql。可重複執行。

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
