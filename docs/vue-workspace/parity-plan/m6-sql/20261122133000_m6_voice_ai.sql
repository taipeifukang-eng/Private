-- M6 第 3 批 3b W33（2026-11-22）：督導語音與 AI 摘要的資料表與函式（DEV）。
--   workspace_ai_settings                    每月 OpenAI 費用上限（美元；老闆 2026-11-22 問卷決定預設 30），只有一列（scope = 'supervisor_voice'）
--   workspace_ai_usage_ledger                每次呼叫「事前估算」的費用（micro-USD 整數，無條件進位）；不存音檔、不存 OpenAI 原始回應與標頭
--   workspace_ai_alerts                      每月第一次達 80%／100% 的紀錄（首頁只給系統管理員看的提醒用）
--   workspace_ai_consents                    語音／AI 告知的同意紀錄（E5）：誰、哪一版告知、何時
--   workspace_supervisor_voice_transcripts   逐字稿（E6：只有建立者與管理者看得到；只由 workspace API 以 service_role 存取）
--   workspace_ai_reserve(...)                同一交易內加鎖、檢查月額度、寫入估算費用（並行呼叫不會超過上限太多）
--   workspace_ai_month_spent(month)          某月累計估算費用
-- 皆啟用 RLS 且不開放任何政策（anon、authenticated 無法讀寫），只有 service_role 使用。舊版資料表與函式不動。可重複執行。還原：.rollback.sql。
DO $$
BEGIN
  IF to_regclass('public.supervisor_management_records') IS NULL OR to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: supervisor_management_records 或 profiles 不存在';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.workspace_ai_settings (
  scope           text PRIMARY KEY,
  monthly_cap_usd numeric(10,2) NOT NULL DEFAULT 30 CHECK (monthly_cap_usd >= 0 AND monthly_cap_usd <= 10000),
  updated_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.workspace_ai_settings (scope, monthly_cap_usd) VALUES ('supervisor_voice', 30) ON CONFLICT (scope) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.workspace_ai_usage_ledger (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope               text NOT NULL DEFAULT 'supervisor_voice',
  month_key           text NOT NULL CHECK (month_key ~ '^[0-9]{4}-[0-9]{2}$'),
  kind                text NOT NULL CHECK (kind IN ('transcribe', 'draft')),
  model               text,
  est_cost_micro_usd  bigint NOT NULL CHECK (est_cost_micro_usd >= 0),
  audio_seconds       integer,
  input_tokens_est    integer,
  output_tokens_est   integer,
  user_id             uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_workspace_ai_ledger_month ON public.workspace_ai_usage_ledger (scope, month_key);

CREATE TABLE IF NOT EXISTS public.workspace_ai_alerts (
  scope              text NOT NULL DEFAULT 'supervisor_voice',
  month_key          text NOT NULL CHECK (month_key ~ '^[0-9]{4}-[0-9]{2}$'),
  level              text NOT NULL CHECK (level IN ('warn80', 'cap100')),
  spent_micro_usd    bigint NOT NULL,
  cap_usd            numeric(10,2) NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, month_key, level)
);

CREATE TABLE IF NOT EXISTS public.workspace_ai_consents (
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  notice_version  text NOT NULL,
  consented_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, notice_version)
);

CREATE TABLE IF NOT EXISTS public.workspace_supervisor_voice_transcripts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id    uuid NOT NULL UNIQUE REFERENCES public.supervisor_management_records(id) ON DELETE CASCADE,
  case_id      uuid NOT NULL,
  created_by   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  transcript   text NOT NULL CHECK (char_length(transcript) <= 6000),
  source       text NOT NULL CHECK (source IN ('AI', 'MANUAL')),
  ai_provider  text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_workspace_voice_transcripts_case ON public.workspace_supervisor_voice_transcripts (case_id);

ALTER TABLE public.workspace_ai_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_ai_usage_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_ai_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_ai_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_supervisor_voice_transcripts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_ai_settings, public.workspace_ai_usage_ledger, public.workspace_ai_alerts, public.workspace_ai_consents, public.workspace_supervisor_voice_transcripts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.workspace_ai_settings, public.workspace_ai_usage_ledger, public.workspace_ai_alerts, public.workspace_ai_consents, public.workspace_supervisor_voice_transcripts TO service_role;

-- 預約額度：同一個月份加鎖後讀目前累計；已達上限就拒絕，否則寫入這次的估算費用並回傳前後累計。
-- 累計達 80%／100% 時順手寫入 workspace_ai_alerts（每月每個層級只有第一次；已存在就略過）。
CREATE OR REPLACE FUNCTION public.workspace_ai_reserve(
  p_month_key text, p_kind text, p_model text, p_cost_micro bigint, p_user uuid,
  p_audio_seconds integer, p_input_tokens integer, p_output_tokens integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $f$
DECLARE
  v_cap numeric(10,2);
  v_cap_micro bigint;
  v_before bigint;
  v_after bigint;
  v_id uuid;
BEGIN
  IF p_cost_micro IS NULL OR p_cost_micro < 0 THEN RAISE EXCEPTION 'WORKSPACE_AI_BAD_COST'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('workspace_ai_reserve:' || p_month_key));
  SELECT monthly_cap_usd INTO v_cap FROM public.workspace_ai_settings WHERE scope = 'supervisor_voice';
  v_cap := COALESCE(v_cap, 30);
  v_cap_micro := round(v_cap * 1000000)::bigint;
  SELECT COALESCE(sum(est_cost_micro_usd), 0)::bigint INTO v_before
    FROM public.workspace_ai_usage_ledger WHERE scope = 'supervisor_voice' AND month_key = p_month_key;
  IF v_before >= v_cap_micro THEN
    INSERT INTO public.workspace_ai_alerts (scope, month_key, level, spent_micro_usd, cap_usd)
    VALUES ('supervisor_voice', p_month_key, 'cap100', v_before, v_cap) ON CONFLICT DO NOTHING;
    RETURN jsonb_build_object('ok', false, 'reason', 'CAP_REACHED', 'spent_micro_usd', v_before, 'cap_usd', v_cap);
  END IF;
  INSERT INTO public.workspace_ai_usage_ledger (scope, month_key, kind, model, est_cost_micro_usd, audio_seconds, input_tokens_est, output_tokens_est, user_id)
  VALUES ('supervisor_voice', p_month_key, p_kind, p_model, p_cost_micro, p_audio_seconds, p_input_tokens, p_output_tokens, p_user)
  RETURNING id INTO v_id;
  v_after := v_before + p_cost_micro;
  IF v_after * 10 >= v_cap_micro * 8 THEN
    INSERT INTO public.workspace_ai_alerts (scope, month_key, level, spent_micro_usd, cap_usd)
    VALUES ('supervisor_voice', p_month_key, 'warn80', v_after, v_cap) ON CONFLICT DO NOTHING;
  END IF;
  IF v_after >= v_cap_micro THEN
    INSERT INTO public.workspace_ai_alerts (scope, month_key, level, spent_micro_usd, cap_usd)
    VALUES ('supervisor_voice', p_month_key, 'cap100', v_after, v_cap) ON CONFLICT DO NOTHING;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'spent_before_micro_usd', v_before, 'spent_after_micro_usd', v_after, 'cap_usd', v_cap);
END;
$f$;

CREATE OR REPLACE FUNCTION public.workspace_ai_month_spent(p_month_key text) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $f$
  SELECT COALESCE(sum(est_cost_micro_usd), 0)::bigint FROM public.workspace_ai_usage_ledger
   WHERE scope = 'supervisor_voice' AND month_key = p_month_key;
$f$;

REVOKE ALL ON FUNCTION public.workspace_ai_reserve(text, text, text, bigint, uuid, integer, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.workspace_ai_month_spent(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_ai_reserve(text, text, text, bigint, uuid, integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.workspace_ai_month_spent(text) TO service_role;
NOTIFY pgrst, 'reload schema';
