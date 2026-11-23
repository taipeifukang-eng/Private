-- M9 F01S（2026-11-23 上線準備問卷 N2）：逐頁「回舊版」備援開關（DEV）。
--   workspace_page_fallbacks         每個頁面種類（kind）一列：use_legacy = true 代表該頁暫時切回舊版（選單改開舊網址、不提供新版頁籤）
--   workspace_page_fallback_events   每次切換的稽核紀錄（只新增、不修改）：誰、何時、切到哪裡、原因
--   workspace_set_page_fallback(...) 同一交易內寫入目前狀態與稽核紀錄
-- 皆啟用 RLS 且不開放任何政策（anon、authenticated 無法讀寫），只有 service_role（workspace API）使用。舊版資料表與函式不動。可重複執行。還原：.rollback.sql。
DO $$
BEGIN
  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: profiles 不存在';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.workspace_page_fallbacks (
  kind        text PRIMARY KEY CHECK (kind ~ '^[a-z][a-z0-9-]{0,63}$'),
  use_legacy  boolean NOT NULL DEFAULT false,
  reason      text CHECK (reason IS NULL OR char_length(reason) <= 200),
  updated_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.workspace_page_fallback_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind ~ '^[a-z][a-z0-9-]{0,63}$'),
  use_legacy  boolean NOT NULL,
  reason      text CHECK (reason IS NULL OR char_length(reason) <= 200),
  actor_id    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_workspace_page_fallback_events_kind ON public.workspace_page_fallback_events (kind, created_at DESC);

ALTER TABLE public.workspace_page_fallbacks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_page_fallback_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_page_fallbacks, public.workspace_page_fallback_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.workspace_page_fallbacks, public.workspace_page_fallback_events TO service_role;

-- 切換：寫入（或更新）目前狀態，並在同一交易新增一筆稽核紀錄。回傳更新後的那一列。
CREATE OR REPLACE FUNCTION public.workspace_set_page_fallback(
  p_kind text, p_use_legacy boolean, p_reason text, p_actor uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $f$
DECLARE
  v_row public.workspace_page_fallbacks;
BEGIN
  IF p_kind IS NULL OR p_kind !~ '^[a-z][a-z0-9-]{0,63}$' THEN RAISE EXCEPTION 'WORKSPACE_FALLBACK_BAD_KIND'; END IF;
  IF p_use_legacy IS NULL THEN RAISE EXCEPTION 'WORKSPACE_FALLBACK_BAD_VALUE'; END IF;
  INSERT INTO public.workspace_page_fallbacks AS f (kind, use_legacy, reason, updated_by, updated_at)
  VALUES (p_kind, p_use_legacy, NULLIF(btrim(p_reason), ''), p_actor, now())
  ON CONFLICT (kind) DO UPDATE
    SET use_legacy = EXCLUDED.use_legacy, reason = EXCLUDED.reason, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at
  RETURNING * INTO v_row;
  INSERT INTO public.workspace_page_fallback_events (kind, use_legacy, reason, actor_id)
  VALUES (p_kind, p_use_legacy, NULLIF(btrim(p_reason), ''), p_actor);
  RETURN jsonb_build_object('kind', v_row.kind, 'use_legacy', v_row.use_legacy, 'reason', v_row.reason, 'updated_by', v_row.updated_by, 'updated_at', v_row.updated_at);
END;
$f$;

REVOKE ALL ON FUNCTION public.workspace_set_page_fallback(text, boolean, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_set_page_fallback(text, boolean, text, uuid) TO service_role;
NOTIFY pgrst, 'reload schema';
