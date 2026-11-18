-- 處方箋 Google Sheet 匯入：門市簡稱對照表 + 整批原子匯入函式。
-- 1. public.prescription_store_aliases：簡稱（已正規化：去空白、全形轉半形）對應一家門市。簡稱唯一；一家門市可有多個簡稱。
--    只有 service_role 能讀寫（和 monthly_prescription_reports 一樣，由 API 檢查 performance.edit 後用 service role 操作）。
-- 2. public.import_prescription_report_batch(...)：同一個交易內先存簡稱對照、再 upsert 處方箋月報，任何一步失敗整批還原。
-- 冪等：可重複執行。rollback 見 supabase/rollback_prescription_store_aliases.sql。

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.monthly_prescription_reports') IS NULL
     OR to_regclass('public.stores') IS NULL
     OR to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite tables for prescription store aliases migration';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.prescription_store_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alias text NOT NULL
    CHECK (alias = btrim(alias) AND alias <> '' AND char_length(alias) <= 40),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prescription_store_aliases_alias_key UNIQUE (alias)
);

CREATE INDEX IF NOT EXISTS idx_prescription_store_aliases_store_id
  ON public.prescription_store_aliases (store_id);

COMMENT ON TABLE public.prescription_store_aliases IS
  'Google Sheet prescription import: store short name (normalized) to store mapping. One alias maps to exactly one store.';

ALTER TABLE public.prescription_store_aliases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.prescription_store_aliases FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.prescription_store_aliases TO service_role;

CREATE OR REPLACE FUNCTION public.import_prescription_report_batch(
  p_year_month text,
  p_reports jsonb,
  p_aliases jsonb,
  p_user uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_year_month IS NULL OR p_year_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'invalid year_month %', p_year_month USING ERRCODE = '22023';
  END IF;
  IF p_reports IS NULL OR jsonb_typeof(p_reports) <> 'array' OR jsonb_array_length(p_reports) = 0 THEN
    RAISE EXCEPTION 'no reports to import' USING ERRCODE = '22023';
  END IF;

  IF p_aliases IS NOT NULL AND jsonb_typeof(p_aliases) = 'array' AND jsonb_array_length(p_aliases) > 0 THEN
    INSERT INTO public.prescription_store_aliases (alias, store_id, created_by)
    SELECT a.alias, a.store_id, p_user
    FROM jsonb_to_recordset(p_aliases) AS a(alias text, store_id uuid)
    ON CONFLICT (alias) DO UPDATE
      SET store_id = EXCLUDED.store_id, updated_at = now();
  END IF;

  INSERT INTO public.monthly_prescription_reports (
    year_month, store_id,
    regular_prescription_count, regular_prescription_point_value,
    chronic_prescription_count, chronic_prescription_point_value,
    prescription_data_updated_at, prescription_data_updated_by, updated_at
  )
  SELECT
    p_year_month, r.store_id,
    r.regular_prescription_count, r.regular_prescription_point_value,
    r.chronic_prescription_count, r.chronic_prescription_point_value,
    now(), p_user, now()
  FROM jsonb_to_recordset(p_reports) AS r(
    store_id uuid,
    regular_prescription_count integer,
    regular_prescription_point_value numeric,
    chronic_prescription_count integer,
    chronic_prescription_point_value numeric
  )
  ON CONFLICT (year_month, store_id) DO UPDATE SET
    regular_prescription_count = EXCLUDED.regular_prescription_count,
    regular_prescription_point_value = EXCLUDED.regular_prescription_point_value,
    chronic_prescription_count = EXCLUDED.chronic_prescription_count,
    chronic_prescription_point_value = EXCLUDED.chronic_prescription_point_value,
    prescription_data_updated_at = EXCLUDED.prescription_data_updated_at,
    prescription_data_updated_by = EXCLUDED.prescription_data_updated_by,
    updated_at = EXCLUDED.updated_at;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.import_prescription_report_batch(text, jsonb, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_prescription_report_batch(text, jsonb, jsonb, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
