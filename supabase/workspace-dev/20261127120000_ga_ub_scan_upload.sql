-- 水電帳單「手機掃 QR 拍照上傳」（ga-ub-scan-upload）。
--   1. 新資料表 ga_ub_scan_tokens：一次性、短效（15 分鐘）、只綁一張帳單與發出者的上傳權杖；只存權杖的 SHA-256 雜湊（64 位十六進位），不存權杖本身；
--      每個權杖最多 10 張（max_files、used_count）。資料表開 RLS、不給任何政策，也不授權給 anon／authenticated，只有下面的函式（SECURITY DEFINER）與 service_role 碰得到。
--   2. ga_ws_ub_scan_token_create(帳單, 雜湊)：登入者呼叫；檢查水電網費管理權限、帳單存在未刪除且沒有被請款單鎖定；同一人對同一張帳單發新 QR 時舊的自動作廢；同一人同時有效的權杖最多 20 個；順手清掉超過 1 天的過期權杖。
--   2b. ga_ws_ub_scan_token_revoke(帳單)：登入者關閉手機上傳視窗時，把自己對這張帳單發出的有效 QR 全部作廢。
--   3. ga_ub_scan_token_status(雜湊)：只給 service_role（公開上傳 API 用）；回有效與否、剩餘張數、到期時間；找不到、過期、已作廢一律回同一個「無效」，不洩漏差別，也不回帳單資料。
--   4. ga_ub_scan_token_commit(雜湊, 檔案清單)：只給 service_role；鎖權杖列、重新檢查到期、張數上限與帳單鎖定，
--      以「發出者」身分（交易內暫時設定 auth.uid()，結束後還原）寫入附件，所以附件寫入觸發器照常檢查「發出者現在還有水電網費管理權限」、上傳者記為發出者；用途固定 BILL_DOCUMENT、路徑必須在這張帳單底下。
-- 「帳單鎖定」＝帳單已刪除，或帳單在已送出／已付款的請款單內（與水電請款的 D7 鎖定同一個定義）；鎖定的帳單不能用手機補傳（桌機要先把請款單退回）。
-- 不新增權限碼、不授權給任何角色、不改任何既有函式或觸發器。可重複執行。
-- 還原：20261127120000_ga_ub_scan_upload.rollback.sql（把資料表與函式丟掉；已上傳的附件紀錄與檔案不受影響）。
DO $$
BEGIN
  IF to_regclass('public.ga_utility_bills') IS NULL
     OR to_regclass('public.ga_resource_attachments') IS NULL
     OR to_regclass('public.ga_payment_request_bill_lines') IS NULL
     OR to_regprocedure('public.ga_ub_can_manage(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: 請先套用水電網費、附件與水電請款（ga_ub_can_manage、ga_payment_request_bill_lines）';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.ga_ub_scan_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  bill_id uuid NOT NULL REFERENCES public.ga_utility_bills(id) ON DELETE CASCADE,
  issued_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  max_files integer NOT NULL DEFAULT 10,
  used_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT ga_ub_scan_tokens_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ga_ub_scan_tokens_max_check CHECK (max_files BETWEEN 1 AND 10),
  CONSTRAINT ga_ub_scan_tokens_used_check CHECK (used_count >= 0 AND used_count <= max_files),
  CONSTRAINT ga_ub_scan_tokens_expiry_check CHECK (expires_at > created_at AND expires_at <= created_at + interval '1 hour')
);
CREATE INDEX IF NOT EXISTS idx_ga_ub_scan_tokens_bill ON public.ga_ub_scan_tokens (bill_id);
CREATE INDEX IF NOT EXISTS idx_ga_ub_scan_tokens_issuer ON public.ga_ub_scan_tokens (issued_by, expires_at);
ALTER TABLE public.ga_ub_scan_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ga_ub_scan_tokens FROM PUBLIC, anon, authenticated;

-- 帳單狀態：OK／NOT_FOUND（不存在或已刪除）／LOCKED（在已送出或已付款的請款單內）
CREATE OR REPLACE FUNCTION public.ga_ub_scan_bill_state(p_bill uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM public.ga_utility_bills b WHERE b.id = p_bill AND b.deleted_at IS NULL) THEN 'NOT_FOUND'
    WHEN EXISTS (SELECT 1 FROM public.ga_payment_request_bill_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id
                  WHERE l.bill_id = p_bill AND l.active AND q.status IN ('SUBMITTED', 'PAID')) THEN 'LOCKED'
    ELSE 'OK' END;
$$;

CREATE OR REPLACE FUNCTION public.ga_ws_ub_scan_token_create(p_bill_id uuid, p_token_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_state text;
  v_exp timestamptz := now() + interval '15 minutes';
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '請先登入'); END IF;
  IF NOT public.ga_ub_can_manage(v_uid) THEN RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有費用附件管理權限'); END IF;
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '權杖格式錯誤'); END IF;
  v_state := public.ga_ub_scan_bill_state(p_bill_id);
  IF v_state = 'NOT_FOUND' THEN RETURN jsonb_build_object('ok', false, 'status', 404, 'error', '找不到費用紀錄'); END IF;
  IF v_state = 'LOCKED' THEN RETURN jsonb_build_object('ok', false, 'status', 409, 'error', '這筆帳單已在送出或已付款的請款單內，已鎖定；請先將請款單退回再用手機上傳', 'code', 'BILL_LOCKED'); END IF;
  DELETE FROM public.ga_ub_scan_tokens WHERE expires_at < now() - interval '1 day';
  -- 同一人對同一張帳單產生新 QR 時，舊的 QR 立刻作廢（避免舊 QR 被拍到後還能用）
  UPDATE public.ga_ub_scan_tokens SET revoked_at = now() WHERE issued_by = v_uid AND bill_id = p_bill_id AND revoked_at IS NULL AND expires_at > now();
  IF (SELECT count(*) FROM public.ga_ub_scan_tokens WHERE issued_by = v_uid AND revoked_at IS NULL AND expires_at > now()) >= 20 THEN
    RETURN jsonb_build_object('ok', false, 'status', 429, 'error', '短時間內產生太多 QR，請稍後再試', 'code', 'TOO_MANY_TOKENS');
  END IF;
  INSERT INTO public.ga_ub_scan_tokens (token_hash, bill_id, issued_by, expires_at) VALUES (p_token_hash, p_bill_id, v_uid, v_exp);
  RETURN jsonb_build_object('ok', true, 'status', 201, 'data', jsonb_build_object('expires_at', v_exp, 'max_files', 10));
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'status', 409, 'error', '權杖重複，請重試');
END;
$$;

-- 作廢：登入者關閉手機上傳視窗時，把自己對這張帳單發出的有效 QR 全部作廢。
CREATE OR REPLACE FUNCTION public.ga_ws_ub_scan_token_revoke(p_bill_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_n integer;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '請先登入'); END IF;
  IF NOT public.ga_ub_can_manage(v_uid) THEN RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有費用附件管理權限'); END IF;
  UPDATE public.ga_ub_scan_tokens SET revoked_at = now() WHERE issued_by = v_uid AND bill_id = p_bill_id AND revoked_at IS NULL AND expires_at > now();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('revoked', v_n));
END;
$$;

CREATE OR REPLACE FUNCTION public.ga_ub_scan_token_status(p_token_hash text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  t public.ga_ub_scan_tokens;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('ok', false, 'status', 403, 'code', 'INVALID'); END IF;
  SELECT * INTO t FROM public.ga_ub_scan_tokens WHERE token_hash = p_token_hash;
  IF NOT FOUND OR t.revoked_at IS NOT NULL OR t.expires_at <= now() THEN RETURN jsonb_build_object('ok', false, 'status', 403, 'code', 'INVALID'); END IF;
  IF public.ga_ub_scan_bill_state(t.bill_id) <> 'OK' THEN RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'BILL_LOCKED'); END IF;
  IF t.used_count >= t.max_files THEN RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'FULL'); END IF;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('expires_at', t.expires_at, 'remaining', t.max_files - t.used_count, 'max_files', t.max_files, 'bill_id', t.bill_id));
END;
$$;

CREATE OR REPLACE FUNCTION public.ga_ub_scan_token_commit(p_token_hash text, p_records jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  t public.ga_ub_scan_tokens;
  v_n integer;
  v_prefix text;
  v_bad integer;
  v_old_sub text := current_setting('request.jwt.claim.sub', true);
  v_old_claims text := current_setting('request.jwt.claims', true);
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN RETURN jsonb_build_object('ok', false, 'status', 403, 'code', 'INVALID'); END IF;
  IF p_records IS NULL OR jsonb_typeof(p_records) <> 'array' THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '檔案清單格式錯誤'); END IF;
  v_n := jsonb_array_length(p_records);
  IF v_n < 1 OR v_n > 10 THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '一次請傳 1～10 張'); END IF;
  SELECT * INTO t FROM public.ga_ub_scan_tokens WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND OR t.revoked_at IS NOT NULL OR t.expires_at <= now() THEN RETURN jsonb_build_object('ok', false, 'status', 403, 'code', 'INVALID'); END IF;
  IF public.ga_ub_scan_bill_state(t.bill_id) <> 'OK' THEN RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'BILL_LOCKED'); END IF;
  IF t.used_count + v_n > t.max_files THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'FULL', 'remaining', t.max_files - t.used_count);
  END IF;
  v_prefix := 'utility_bill/' || t.bill_id::text || '/bill_document/';
  SELECT count(*) INTO v_bad FROM jsonb_to_recordset(p_records) AS r(storage_path text) WHERE r.storage_path IS NULL OR left(r.storage_path, length(v_prefix)) <> v_prefix;
  IF v_bad > 0 THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '檔案路徑不屬於這張帳單'); END IF;

  -- 以發出者身分寫入：附件寫入觸發器用 auth.uid() 檢查水電網費管理權限並記錄上傳者（交易內暫時設定，寫完還原）
  PERFORM set_config('request.jwt.claim.sub', t.issued_by::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', t.issued_by::text, 'role', 'authenticated')::text, true);
  INSERT INTO public.ga_resource_attachments (resource_type, resource_id, purpose, storage_bucket, storage_path, file_name, content_type, size_bytes, is_primary, metadata)
  SELECT 'UTILITY_BILL', t.bill_id, 'BILL_DOCUMENT', 'general-affairs-attachments', r.storage_path,
         COALESCE(NULLIF(left(btrim(r.file_name), 200), ''), 'photo'), r.content_type, r.size_bytes, false, jsonb_build_object('via', 'phone_scan')
    FROM jsonb_to_recordset(p_records) AS r(storage_path text, file_name text, content_type text, size_bytes bigint);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(v_old_sub, ''), true);
  PERFORM set_config('request.jwt.claims', COALESCE(v_old_claims, ''), true);

  UPDATE public.ga_ub_scan_tokens SET used_count = used_count + v_n, last_used_at = now() WHERE id = t.id;
  RETURN jsonb_build_object('ok', true, 'status', 201, 'data', jsonb_build_object('added', v_n, 'remaining', t.max_files - t.used_count - v_n));
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE '%PERMISSION_DENIED%' THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '發出 QR 的使用者已沒有費用附件管理權限，請重新由有權限的人產生 QR');
  END IF;
  RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '檔案資料不符合規則，上傳未完成');
END;
$$;

REVOKE ALL ON FUNCTION public.ga_ub_scan_bill_state(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_ws_ub_scan_token_create(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_ub_scan_token_revoke(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ga_ws_ub_scan_token_revoke(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.ga_ub_scan_token_status(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_ub_scan_token_commit(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_ub_scan_token_create(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ga_ub_scan_bill_state(uuid), public.ga_ub_scan_token_status(text), public.ga_ub_scan_token_commit(text, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
