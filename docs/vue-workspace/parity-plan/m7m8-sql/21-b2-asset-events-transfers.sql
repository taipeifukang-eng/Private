-- 21-b2-asset-events-transfers.sql
-- M7/M8 第 2 批（G06-G10）A：資產異動紀錄、設備／設施轉移單、更正所屬門市、恢復 QR、有未結案單禁止刪除（草稿，尚未在正式區執行；會寫入，請使用者審閱後自行執行）。
-- 內容與 DEV 已套用並測過的 supabase/workspace-dev/20261110100000_m7m8_b2_asset_events_transfers.sql 相同（DEV 資料庫函式整合測試全綠）。
-- 會新增：3 張資料表（ga_asset_transfers 轉移單、ga_asset_transfer_photos 轉移照片、ga_asset_events 異動紀錄）、1 個序號、ga_ws_ 開頭與 ga_asset_events_immutable 函式。
-- 不會改：任何既有資料表欄位、既有資料、既有觸發器、舊版函式（ga_soft_delete_* 等）。舊版 /api/general-affairs 與舊版畫面行為不變。
-- 為什麼需要：Q8 誤報廢可恢復並沿用原 QR；Q10 有未結案單禁止刪除、更正所屬門市要原因並留紀錄；Q28 設備搬店要「總務發起 → A 店店長確認交出 → B 店店長確認收到才換店」，全程留紀錄。
-- 備份：只新增物件，沒有改動任何既有資料，所以沒有資料要備份。
-- 已套用後想撤掉：21-b2-asset-events-transfers-rollback.sql（會刪除這 3 張表的所有紀錄，請先確認）。
-- 用法：
--   1. 先跑 20-b2-preview-before-apply.sql（唯讀），確認先決條件與現況。
--   2. 整份貼上、一次 Run。檔案自己 BEGIN ... COMMIT：先決條件檢查失敗或任何一句出錯，整份不生效（交易自動撤回）；全部成功才在檔案內 COMMIT。
--      （不需要、也不要再另外執行 COMMIT; —— SQL 編輯器每次 Run 不保證沿用同一個交易，所以交易與 COMMIT 都寫在同一份檔案裡。）
--   3. 最後的核對查詢（在 COMMIT 之後）請對照檔案註解的預期結果。
--   4. 套用順序固定：21 → 22 → 23（後面的檔案會檢查前面的已套用）。

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.ga_equipment') IS NULL OR to_regclass('public.ga_facilities') IS NULL
     OR to_regclass('public.ga_service_requests') IS NULL OR to_regclass('public.maintenance_requests') IS NULL
     OR to_regclass('public.store_managers') IS NULL OR to_regclass('public.stores') IS NULL OR to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table (ga_equipment / ga_facilities / ga_service_requests / maintenance_requests / store_managers / stores / profiles)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'has_permission')
     OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'ga_is_store_active')
     OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'ga_soft_delete_equipment')
     OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'ga_soft_delete_facility') THEN
    RAISE EXCEPTION 'Missing prerequisite function (has_permission / ga_is_store_active / ga_soft_delete_equipment / ga_soft_delete_facility)';
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------
-- 資料表
-- ---------------------------------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS public.ga_asset_transfer_no_seq;

CREATE TABLE IF NOT EXISTS public.ga_asset_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_no text NOT NULL,
  asset_type text NOT NULL CHECK (asset_type IN ('EQUIPMENT', 'FACILITY')),
  asset_id uuid NOT NULL,
  asset_name text NOT NULL,
  asset_code text,
  from_store_id uuid NOT NULL REFERENCES public.stores(id),
  to_store_id uuid NOT NULL REFERENCES public.stores(id),
  status text NOT NULL DEFAULT 'PENDING_HANDOVER'
    CHECK (status IN ('PENDING_HANDOVER', 'PENDING_RECEIVE', 'COMPLETED', 'CANCELLED')),
  reason text NOT NULL CHECK (btrim(reason) <> '' AND char_length(reason) <= 200),
  note text,
  open_request_count integer NOT NULL DEFAULT 0,
  requested_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  requested_by_name text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  handover_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  handover_by_name text,
  handover_at timestamptz,
  handover_note text,
  received_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  received_by_name text,
  received_at timestamptz,
  receive_note text,
  cancelled_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  cancelled_by_name text,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ga_asset_transfers_stores_differ CHECK (from_store_id <> to_store_id),
  CONSTRAINT ga_asset_transfers_no_key UNIQUE (transfer_no)
);

-- 同一個設備／設施同時只能有一張進行中的轉移單
CREATE UNIQUE INDEX IF NOT EXISTS uq_ga_asset_transfers_open_asset
  ON public.ga_asset_transfers (asset_type, asset_id) WHERE status IN ('PENDING_HANDOVER', 'PENDING_RECEIVE');
CREATE INDEX IF NOT EXISTS idx_ga_asset_transfers_from_store ON public.ga_asset_transfers (from_store_id, status);
CREATE INDEX IF NOT EXISTS idx_ga_asset_transfers_to_store ON public.ga_asset_transfers (to_store_id, status);
CREATE INDEX IF NOT EXISTS idx_ga_asset_transfers_asset ON public.ga_asset_transfers (asset_type, asset_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.ga_asset_transfer_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES public.ga_asset_transfers(id) ON DELETE CASCADE,
  step text NOT NULL CHECK (step IN ('HANDOVER', 'RECEIVE')),
  storage_bucket text NOT NULL DEFAULT 'general-affairs-attachments' CHECK (storage_bucket = 'general-affairs-attachments'),
  storage_path text NOT NULL CHECK (storage_path !~ '(^|/)\.\.(/|$)' AND storage_path !~ '^/' AND storage_path !~ '\\'),
  file_name text NOT NULL,
  content_type text NOT NULL CHECK (content_type LIKE 'image/%'),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 20971520),
  uploaded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ga_asset_transfer_photos_transfer ON public.ga_asset_transfer_photos (transfer_id, step);

CREATE TABLE IF NOT EXISTS public.ga_asset_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_type text NOT NULL CHECK (asset_type IN ('EQUIPMENT', 'FACILITY')),
  asset_id uuid NOT NULL,
  asset_name text,
  asset_code text,
  event_type text NOT NULL CHECK (event_type IN (
    'TRANSFER_REQUESTED', 'TRANSFER_HANDED_OVER', 'STORE_TRANSFER', 'TRANSFER_CANCELLED', 'STORE_CORRECTION', 'QR_RESTORED')),
  from_store_id uuid REFERENCES public.stores(id),
  to_store_id uuid REFERENCES public.stores(id),
  transfer_id uuid REFERENCES public.ga_asset_transfers(id),
  reason text,
  note text,
  open_request_count integer,
  actor_id uuid,
  actor_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ga_asset_events_asset ON public.ga_asset_events (asset_type, asset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ga_asset_events_transfer ON public.ga_asset_events (transfer_id) WHERE transfer_id IS NOT NULL;

-- 異動紀錄不可修改；一般使用者也不可刪除（更正要新增一筆，不改舊的）。只有後台維護身分（service_role／資料庫管理者）能刪，供測試資料清理與資料修復用。
-- actor_id 刻意不設外鍵：刪除使用者時不能因為「把紀錄裡的人改成空白」而去修改異動紀錄。
CREATE OR REPLACE FUNCTION public.ga_asset_events_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_user IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '資產異動紀錄不可修改或刪除';
END;
$$;
DROP TRIGGER IF EXISTS trg_ga_asset_events_immutable ON public.ga_asset_events;
CREATE TRIGGER trg_ga_asset_events_immutable BEFORE UPDATE OR DELETE ON public.ga_asset_events
  FOR EACH ROW EXECUTE FUNCTION public.ga_asset_events_immutable();

ALTER TABLE public.ga_asset_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ga_asset_transfer_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ga_asset_events ENABLE ROW LEVEL SECURITY;

-- 讀取：有該類設備／設施查看或管理權限，或是轉出／轉入門市的店長。沒有任何寫入政策：寫入只走下面的函式。
DROP POLICY IF EXISTS ga_asset_transfers_read ON public.ga_asset_transfers;
CREATE POLICY ga_asset_transfers_read ON public.ga_asset_transfers FOR SELECT USING (
  (asset_type = 'EQUIPMENT' AND (public.current_user_has_permission('general_affairs.equipment.view') OR public.current_user_has_permission('general_affairs.equipment.manage')))
  OR (asset_type = 'FACILITY' AND (public.current_user_has_permission('general_affairs.facility.view') OR public.current_user_has_permission('general_affairs.facility.manage')))
  OR EXISTS (SELECT 1 FROM public.store_managers sm WHERE sm.user_id = auth.uid() AND sm.role_type = 'store_manager' AND sm.store_id IN (ga_asset_transfers.from_store_id, ga_asset_transfers.to_store_id))
);
DROP POLICY IF EXISTS ga_asset_transfer_photos_read ON public.ga_asset_transfer_photos;
CREATE POLICY ga_asset_transfer_photos_read ON public.ga_asset_transfer_photos FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.ga_asset_transfers t WHERE t.id = ga_asset_transfer_photos.transfer_id)
);
DROP POLICY IF EXISTS ga_asset_events_read ON public.ga_asset_events;
CREATE POLICY ga_asset_events_read ON public.ga_asset_events FOR SELECT USING (
  (asset_type = 'EQUIPMENT' AND (public.current_user_has_permission('general_affairs.equipment.view') OR public.current_user_has_permission('general_affairs.equipment.manage')))
  OR (asset_type = 'FACILITY' AND (public.current_user_has_permission('general_affairs.facility.view') OR public.current_user_has_permission('general_affairs.facility.manage')))
  OR EXISTS (SELECT 1 FROM public.store_managers sm WHERE sm.user_id = auth.uid() AND sm.role_type = 'store_manager' AND sm.store_id IN (ga_asset_events.from_store_id, ga_asset_events.to_store_id))
);
REVOKE ALL ON public.ga_asset_transfers, public.ga_asset_transfer_photos, public.ga_asset_events FROM PUBLIC, anon;
GRANT SELECT ON public.ga_asset_transfers, public.ga_asset_transfer_photos, public.ga_asset_events TO authenticated;
REVOKE ALL ON SEQUENCE public.ga_asset_transfer_no_seq FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 內部小工具（只給下面的函式用，不開放給前端）
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ga_ws_actor_name(p_user uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$ SELECT COALESCE((SELECT NULLIF(btrim(full_name), '') FROM profiles WHERE id = p_user), '') $$;

-- 鎖定並讀出設備／設施一列（FOR UPDATE）。查不到回 NULL。
CREATE OR REPLACE FUNCTION public.ga_ws_lock_asset(p_type text, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  r jsonb;
BEGIN
  IF p_type = 'EQUIPMENT' THEN
    SELECT jsonb_build_object('store_id', store_id, 'name', name, 'code', asset_code, 'status', status,
             'deleted_at', deleted_at, 'updated_at', updated_at, 'qr_revoked_at', qr_token_revoked_at)
      INTO r FROM ga_equipment WHERE id = p_id FOR UPDATE;
  ELSIF p_type = 'FACILITY' THEN
    SELECT jsonb_build_object('store_id', store_id, 'name', name, 'code', facility_code, 'status', status,
             'deleted_at', deleted_at, 'updated_at', updated_at, 'qr_revoked_at', qr_token_revoked_at)
      INTO r FROM ga_facilities WHERE id = p_id FOR UPDATE;
  END IF;
  RETURN r;
END;
$$;

-- 未結案單張數：需求單（主狀態不是已完成／退回／取消）或其工單（狀態不是已完成）任一還開著，算一張。
CREATE OR REPLACE FUNCTION public.ga_ws_open_order_count(p_type text, p_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object(
    'open_count', COALESCE(count(*) FILTER (WHERE t.open_sr OR t.open_wo), 0),
    'open_requests', COALESCE(count(*) FILTER (WHERE t.open_sr), 0),
    'open_work_orders', COALESCE(count(*) FILTER (WHERE t.open_wo), 0))
  FROM (
    SELECT sr.main_status NOT IN ('COMPLETED', 'REJECTED', 'CANCELED') AS open_sr,
           COALESCE(mr.status <> 'COMPLETED', false) AS open_wo
      FROM ga_service_requests sr
      LEFT JOIN maintenance_requests mr ON mr.id = sr.maintenance_request_id
     WHERE sr.deleted_at IS NULL
       AND ((p_type = 'EQUIPMENT' AND sr.equipment_id = p_id) OR (p_type = 'FACILITY' AND sr.facility_id = p_id))
  ) t
$$;

CREATE OR REPLACE FUNCTION public.ga_ws_asset_manage_code(p_type text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_type WHEN 'EQUIPMENT' THEN 'general_affairs.equipment.manage' WHEN 'FACILITY' THEN 'general_affairs.facility.manage' END
$$;
CREATE OR REPLACE FUNCTION public.ga_ws_asset_view_code(p_type text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_type WHEN 'EQUIPMENT' THEN 'general_affairs.equipment.view' WHEN 'FACILITY' THEN 'general_affairs.facility.view' END
$$;

-- ---------------------------------------------------------------------------------------------
-- 前端可呼叫的函式
-- ---------------------------------------------------------------------------------------------

-- 預覽：這個設備／設施目前有幾張未結案單、有沒有進行中的轉移單（刪除與更正門市的確認畫面用）。
CREATE OR REPLACE FUNCTION public.ga_ws_asset_open_orders(p_type text, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_counts jsonb;
  v_open_transfer uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入'); END IF;
  IF p_type NOT IN ('EQUIPMENT', 'FACILITY') THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '資產類型錯誤'); END IF;
  IF NOT (has_permission(v_uid, ga_ws_asset_manage_code(p_type)) OR has_permission(v_uid, ga_ws_asset_view_code(p_type))) THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有查看權限');
  END IF;
  v_counts := ga_ws_open_order_count(p_type, p_id);
  SELECT id INTO v_open_transfer FROM ga_asset_transfers
   WHERE asset_type = p_type AND asset_id = p_id AND status IN ('PENDING_HANDOVER', 'PENDING_RECEIVE');
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', v_counts || jsonb_build_object('open_transfer_id', v_open_transfer));
END;
$$;

-- 更正所屬門市（建檔錯誤用，不是搬遷；搬遷要走轉移單）：必填原因、寫異動紀錄、有進行中轉移單時不可做。
CREATE OR REPLACE FUNCTION public.ga_ws_correct_asset_store(
  p_type text, p_id uuid, p_to_store_id uuid, p_reason text, p_expected_updated_at timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_a jsonb;
  v_from uuid;
  v_counts jsonb;
  v_updated timestamptz;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入'); END IF;
  IF p_type NOT IN ('EQUIPMENT', 'FACILITY') THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '資產類型錯誤'); END IF;
  IF NOT has_permission(v_uid, ga_ws_asset_manage_code(p_type)) THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', CASE p_type WHEN 'EQUIPMENT' THEN '沒有設備管理權限' ELSE '沒有設施管理權限' END);
  END IF;
  IF v_reason IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '請輸入更正原因'); END IF;
  IF char_length(v_reason) > 200 THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '更正原因不可超過 200 字'); END IF;
  v_a := ga_ws_lock_asset(p_type, p_id);
  IF v_a IS NULL OR (v_a->>'deleted_at') IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'status', 404, 'error', '找不到資料'); END IF;
  IF p_expected_updated_at IS NOT NULL AND (v_a->>'updated_at')::timestamptz IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'STALE', 'error', '這筆資料已被其他人修改，請重新載入後再操作');
  END IF;
  v_from := (v_a->>'store_id')::uuid;
  IF p_to_store_id IS NULL OR NOT ga_is_store_active(p_to_store_id) THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '請選擇啟用中的門市');
  END IF;
  IF p_to_store_id = v_from THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '新門市與目前所屬門市相同'); END IF;
  IF EXISTS (SELECT 1 FROM ga_asset_transfers WHERE asset_type = p_type AND asset_id = p_id AND status IN ('PENDING_HANDOVER', 'PENDING_RECEIVE')) THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'error', '這項資產有進行中的轉移單，請先完成或取消轉移單');
  END IF;
  v_counts := ga_ws_open_order_count(p_type, p_id);

  IF p_type = 'EQUIPMENT' THEN
    UPDATE ga_equipment SET store_id = p_to_store_id WHERE id = p_id RETURNING updated_at INTO v_updated;
  ELSE
    UPDATE ga_facilities SET store_id = p_to_store_id WHERE id = p_id RETURNING updated_at INTO v_updated;
  END IF;
  INSERT INTO ga_asset_events (asset_type, asset_id, asset_name, asset_code, event_type, from_store_id, to_store_id, reason, open_request_count, actor_id, actor_name)
  VALUES (p_type, p_id, v_a->>'name', v_a->>'code', 'STORE_CORRECTION', v_from, p_to_store_id, v_reason, (v_counts->>'open_count')::integer, v_uid, ga_ws_actor_name(v_uid));
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object(
    'from_store_id', v_from, 'to_store_id', p_to_store_id, 'open_count', (v_counts->>'open_count')::integer, 'updated_at', v_updated));
END;
$$;

-- 刪除設備／設施：有未結案單或進行中轉移單就擋下並回張數（可改報廢）；其餘沿用舊版軟刪除函式。
CREATE OR REPLACE FUNCTION public.ga_ws_delete_asset(
  p_type text, p_id uuid, p_reason text, p_expected_updated_at timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_a jsonb;
  v_counts jsonb;
  v_n integer;
  v_res jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入'); END IF;
  IF p_type NOT IN ('EQUIPMENT', 'FACILITY') THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '資產類型錯誤'); END IF;
  IF NOT has_permission(v_uid, ga_ws_asset_manage_code(p_type)) THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', CASE p_type WHEN 'EQUIPMENT' THEN '沒有設備管理權限' ELSE '沒有設施管理權限' END);
  END IF;
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '請輸入刪除原因'); END IF;
  IF char_length(btrim(p_reason)) > 200 THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '刪除原因不可超過 200 字'); END IF;
  v_a := ga_ws_lock_asset(p_type, p_id);
  IF v_a IS NULL OR (v_a->>'deleted_at') IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'status', 404, 'error', '找不到資料'); END IF;
  IF p_expected_updated_at IS NOT NULL AND (v_a->>'updated_at')::timestamptz IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'STALE', 'error', '這筆資料已被其他人修改，請重新載入後再操作');
  END IF;
  IF EXISTS (SELECT 1 FROM ga_asset_transfers WHERE asset_type = p_type AND asset_id = p_id AND status IN ('PENDING_HANDOVER', 'PENDING_RECEIVE')) THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'OPEN_TRANSFER', 'error', '這項資產有進行中的轉移單，請先完成或取消轉移單再刪除');
  END IF;
  v_counts := ga_ws_open_order_count(p_type, p_id);
  v_n := (v_counts->>'open_count')::integer;
  IF v_n > 0 THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'OPEN_ORDERS', 'open_count', v_n,
      'error', format('還有 %s 張未結案單，不能刪除（可改為「報廢」）', v_n));
  END IF;
  IF p_type = 'EQUIPMENT' THEN v_res := ga_soft_delete_equipment(p_id, btrim(p_reason));
  ELSE v_res := ga_soft_delete_facility(p_id, btrim(p_reason)); END IF;
  RETURN v_res;
END;
$$;

-- 恢復使用並重新啟用 QR：設備「報廢」、設施「退役」會自動作廢 QR；誤操作時由總務恢復，token 不變（原標籤繼續可用）。
-- 設備退役不會作廢 QR（舊版規則），不需要恢復。已刪除的資產不可恢復。
CREATE OR REPLACE FUNCTION public.ga_ws_restore_asset(
  p_type text, p_id uuid, p_reason text, p_expected_updated_at timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_a jsonb;
  v_updated timestamptz;
  v_terminal text := CASE p_type WHEN 'EQUIPMENT' THEN 'SCRAPPED' ELSE 'RETIRED' END;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入'); END IF;
  IF p_type NOT IN ('EQUIPMENT', 'FACILITY') THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '資產類型錯誤'); END IF;
  IF NOT has_permission(v_uid, ga_ws_asset_manage_code(p_type)) THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', CASE p_type WHEN 'EQUIPMENT' THEN '沒有設備管理權限' ELSE '沒有設施管理權限' END);
  END IF;
  IF v_reason IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '請輸入恢復原因'); END IF;
  IF char_length(v_reason) > 200 THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '恢復原因不可超過 200 字'); END IF;
  v_a := ga_ws_lock_asset(p_type, p_id);
  IF v_a IS NULL OR (v_a->>'deleted_at') IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'status', 404, 'error', '找不到資料，或已刪除（已刪除的資產不能恢復）'); END IF;
  IF p_expected_updated_at IS NOT NULL AND (v_a->>'updated_at')::timestamptz IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'STALE', 'error', '這筆資料已被其他人修改，請重新載入後再操作');
  END IF;
  IF v_a->>'status' <> v_terminal AND (v_a->>'qr_revoked_at') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'error', '這項資產目前不需要恢復（QR 仍有效）');
  END IF;
  IF p_type = 'EQUIPMENT' THEN
    UPDATE ga_equipment SET status = 'ACTIVE', qr_token_revoked_at = NULL WHERE id = p_id RETURNING updated_at INTO v_updated;
  ELSE
    UPDATE ga_facilities SET status = 'ACTIVE', qr_token_revoked_at = NULL WHERE id = p_id RETURNING updated_at INTO v_updated;
  END IF;
  INSERT INTO ga_asset_events (asset_type, asset_id, asset_name, asset_code, event_type, from_store_id, to_store_id, reason, note, actor_id, actor_name)
  VALUES (p_type, p_id, v_a->>'name', v_a->>'code', 'QR_RESTORED', (v_a->>'store_id')::uuid, (v_a->>'store_id')::uuid, v_reason,
          '原狀態 ' || (v_a->>'status') || ' 改為 ACTIVE，QR 沿用原標籤', v_uid, ga_ws_actor_name(v_uid));
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('status', 'ACTIVE', 'updated_at', v_updated));
END;
$$;

-- 轉移單照片登錄（交出、收到共用；路徑必須在 asset-transfers/{transferId}/{step}/ 底下，最多 3 張，只收圖片）。
CREATE OR REPLACE FUNCTION public.ga_ws_transfer_add_photos(p_transfer_id uuid, p_step text, p_photos jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  p jsonb;
  v_prefix text := 'asset-transfers/' || p_transfer_id::text || '/' || lower(p_step) || '/';
BEGIN
  IF p_photos IS NULL OR jsonb_typeof(p_photos) <> 'array' OR jsonb_array_length(p_photos) = 0 THEN RETURN; END IF;
  IF jsonb_array_length(p_photos) > 3 THEN RAISE EXCEPTION '照片最多 3 張'; END IF;
  FOR p IN SELECT * FROM jsonb_array_elements(p_photos) LOOP
    IF left(COALESCE(p->>'path', ''), length(v_prefix)) <> v_prefix THEN RAISE EXCEPTION '照片路徑不符'; END IF;
    INSERT INTO ga_asset_transfer_photos (transfer_id, step, storage_path, file_name, content_type, size_bytes, uploaded_by)
    VALUES (p_transfer_id, p_step, p->>'path', left(COALESCE(NULLIF(btrim(p->>'file_name'), ''), 'photo'), 200),
            COALESCE(p->>'content_type', ''), COALESCE((p->>'size_bytes')::bigint, 0), auth.uid());
  END LOOP;
END;
$$;

-- 發起轉移單（總務）：只建單，不換店。
CREATE OR REPLACE FUNCTION public.ga_ws_transfer_create(
  p_type text, p_asset_id uuid, p_to_store_id uuid, p_reason text, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_a jsonb;
  v_from uuid;
  v_counts jsonb;
  v_id uuid := gen_random_uuid();
  v_no text;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入'); END IF;
  IF p_type NOT IN ('EQUIPMENT', 'FACILITY') THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '資產類型錯誤'); END IF;
  IF NOT has_permission(v_uid, ga_ws_asset_manage_code(p_type)) THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', CASE p_type WHEN 'EQUIPMENT' THEN '沒有設備管理權限' ELSE '沒有設施管理權限' END);
  END IF;
  IF v_reason IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '請輸入轉移原因'); END IF;
  IF char_length(v_reason) > 200 OR char_length(COALESCE(v_note, '')) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '轉移原因不可超過 200 字、備註不可超過 500 字');
  END IF;
  v_a := ga_ws_lock_asset(p_type, p_asset_id);
  IF v_a IS NULL OR (v_a->>'deleted_at') IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'status', 404, 'error', '找不到資料'); END IF;
  v_status := v_a->>'status';
  IF (p_type = 'EQUIPMENT' AND v_status = 'SCRAPPED') OR (p_type = 'FACILITY' AND v_status = 'RETIRED') OR (v_a->>'qr_revoked_at') IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'error', '已報廢或已作廢 QR 的資產不能轉移，請先恢復使用');
  END IF;
  v_from := (v_a->>'store_id')::uuid;
  IF p_to_store_id IS NULL OR NOT ga_is_store_active(p_to_store_id) THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '請選擇啟用中的門市'); END IF;
  IF p_to_store_id = v_from THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '轉入門市與目前所屬門市相同'); END IF;
  IF EXISTS (SELECT 1 FROM ga_asset_transfers WHERE asset_type = p_type AND asset_id = p_asset_id AND status IN ('PENDING_HANDOVER', 'PENDING_RECEIVE')) THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'OPEN_TRANSFER', 'error', '這項資產已有進行中的轉移單');
  END IF;
  v_counts := ga_ws_open_order_count(p_type, p_asset_id);
  v_no := 'AT' || to_char(now() AT TIME ZONE 'Asia/Taipei', 'YYYYMMDD') || '-' || lpad(nextval('ga_asset_transfer_no_seq')::text, 4, '0');
  INSERT INTO ga_asset_transfers (id, transfer_no, asset_type, asset_id, asset_name, asset_code, from_store_id, to_store_id, reason, note,
                                  open_request_count, requested_by, requested_by_name)
  VALUES (v_id, v_no, p_type, p_asset_id, v_a->>'name', v_a->>'code', v_from, p_to_store_id, v_reason, v_note,
          (v_counts->>'open_count')::integer, v_uid, ga_ws_actor_name(v_uid));
  INSERT INTO ga_asset_events (asset_type, asset_id, asset_name, asset_code, event_type, from_store_id, to_store_id, transfer_id, reason, note,
                               open_request_count, actor_id, actor_name)
  VALUES (p_type, p_asset_id, v_a->>'name', v_a->>'code', 'TRANSFER_REQUESTED', v_from, p_to_store_id, v_id, v_reason, v_note,
          (v_counts->>'open_count')::integer, v_uid, ga_ws_actor_name(v_uid));
  RETURN jsonb_build_object('ok', true, 'status', 201, 'data', jsonb_build_object(
    'id', v_id, 'transfer_no', v_no, 'status', 'PENDING_HANDOVER', 'open_count', (v_counts->>'open_count')::integer));
END;
$$;

-- A 店店長確認交出
CREATE OR REPLACE FUNCTION public.ga_ws_transfer_confirm_handover(p_transfer_id uuid, p_note text DEFAULT NULL, p_photos jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  t ga_asset_transfers%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入'); END IF;
  IF char_length(COALESCE(v_note, '')) > 500 THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '備註不可超過 500 字'); END IF;
  SELECT * INTO t FROM ga_asset_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'status', 404, 'error', '找不到轉移單'); END IF;
  IF NOT EXISTS (SELECT 1 FROM store_managers WHERE user_id = v_uid AND role_type = 'store_manager' AND store_id = t.from_store_id) THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '只有轉出門市的店長可以確認交出');
  END IF;
  IF t.status <> 'PENDING_HANDOVER' THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'STALE', 'error', '這張轉移單目前不是「待交出」狀態，請重新載入');
  END IF;
  UPDATE ga_asset_transfers SET status = 'PENDING_RECEIVE', handover_by = v_uid, handover_by_name = ga_ws_actor_name(v_uid),
         handover_at = now(), handover_note = v_note, updated_at = now() WHERE id = p_transfer_id;
  PERFORM ga_ws_transfer_add_photos(p_transfer_id, 'HANDOVER', p_photos);
  INSERT INTO ga_asset_events (asset_type, asset_id, asset_name, asset_code, event_type, from_store_id, to_store_id, transfer_id, note, actor_id, actor_name)
  VALUES (t.asset_type, t.asset_id, t.asset_name, t.asset_code, 'TRANSFER_HANDED_OVER', t.from_store_id, t.to_store_id, t.id, v_note, v_uid, ga_ws_actor_name(v_uid));
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('id', t.id, 'status', 'PENDING_RECEIVE'));
END;
$$;

-- B 店店長確認收到：這一步才真的換店（同一個交易內更新資產所屬門市）。QR token 完全不動。
CREATE OR REPLACE FUNCTION public.ga_ws_transfer_confirm_receive(p_transfer_id uuid, p_note text DEFAULT NULL, p_photos jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  t ga_asset_transfers%ROWTYPE;
  v_a jsonb;
  v_counts jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入'); END IF;
  IF char_length(COALESCE(v_note, '')) > 500 THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '備註不可超過 500 字'); END IF;
  SELECT * INTO t FROM ga_asset_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'status', 404, 'error', '找不到轉移單'); END IF;
  IF NOT EXISTS (SELECT 1 FROM store_managers WHERE user_id = v_uid AND role_type = 'store_manager' AND store_id = t.to_store_id) THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '只有轉入門市的店長可以確認收到');
  END IF;
  IF t.status <> 'PENDING_RECEIVE' THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'STALE', 'error', '這張轉移單目前不是「待收到」狀態（A 店還沒確認交出，或已處理過），請重新載入');
  END IF;
  v_a := ga_ws_lock_asset(t.asset_type, t.asset_id);
  IF v_a IS NULL OR (v_a->>'deleted_at') IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'error', '這項資產已被刪除，請通知總務取消轉移單');
  END IF;
  IF (v_a->>'store_id')::uuid <> t.from_store_id THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'error', '這項資產的所屬門市已被更正，請通知總務取消並重新發起');
  END IF;
  IF NOT ga_is_store_active(t.to_store_id) THEN RETURN jsonb_build_object('ok', false, 'status', 409, 'error', '轉入門市已停用'); END IF;
  IF (v_a->>'qr_revoked_at') IS NOT NULL OR (t.asset_type = 'EQUIPMENT' AND v_a->>'status' = 'SCRAPPED') OR (t.asset_type = 'FACILITY' AND v_a->>'status' = 'RETIRED') THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'error', '這項資產已報廢／作廢，不能再轉移，請通知總務取消轉移單');
  END IF;
  v_counts := ga_ws_open_order_count(t.asset_type, t.asset_id);
  IF t.asset_type = 'EQUIPMENT' THEN UPDATE ga_equipment SET store_id = t.to_store_id WHERE id = t.asset_id;
  ELSE UPDATE ga_facilities SET store_id = t.to_store_id WHERE id = t.asset_id; END IF;
  UPDATE ga_asset_transfers SET status = 'COMPLETED', received_by = v_uid, received_by_name = ga_ws_actor_name(v_uid),
         received_at = now(), receive_note = v_note, updated_at = now() WHERE id = p_transfer_id;
  PERFORM ga_ws_transfer_add_photos(p_transfer_id, 'RECEIVE', p_photos);
  INSERT INTO ga_asset_events (asset_type, asset_id, asset_name, asset_code, event_type, from_store_id, to_store_id, transfer_id, reason, note, open_request_count, actor_id, actor_name)
  VALUES (t.asset_type, t.asset_id, t.asset_name, t.asset_code, 'STORE_TRANSFER', t.from_store_id, t.to_store_id, t.id, t.reason, v_note,
          (v_counts->>'open_count')::integer, v_uid, ga_ws_actor_name(v_uid));
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('id', t.id, 'status', 'COMPLETED', 'to_store_id', t.to_store_id));
END;
$$;

-- 取消轉移單（總務；只能取消還沒完成的）。資產不動。
CREATE OR REPLACE FUNCTION public.ga_ws_transfer_cancel(p_transfer_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  t ga_asset_transfers%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入'); END IF;
  IF v_reason IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '請輸入取消原因'); END IF;
  IF char_length(v_reason) > 200 THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '取消原因不可超過 200 字'); END IF;
  SELECT * INTO t FROM ga_asset_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'status', 404, 'error', '找不到轉移單'); END IF;
  IF NOT has_permission(v_uid, ga_ws_asset_manage_code(t.asset_type)) THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有取消轉移單的權限');
  END IF;
  IF t.status NOT IN ('PENDING_HANDOVER', 'PENDING_RECEIVE') THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'STALE', 'error', '這張轉移單已完成或已取消，請重新載入');
  END IF;
  UPDATE ga_asset_transfers SET status = 'CANCELLED', cancelled_by = v_uid, cancelled_by_name = ga_ws_actor_name(v_uid),
         cancelled_at = now(), cancel_reason = v_reason, updated_at = now() WHERE id = p_transfer_id;
  INSERT INTO ga_asset_events (asset_type, asset_id, asset_name, asset_code, event_type, from_store_id, to_store_id, transfer_id, reason, actor_id, actor_name)
  VALUES (t.asset_type, t.asset_id, t.asset_name, t.asset_code, 'TRANSFER_CANCELLED', t.from_store_id, t.to_store_id, t.id, v_reason, v_uid, ga_ws_actor_name(v_uid));
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('id', t.id, 'status', 'CANCELLED'));
END;
$$;

-- 權限：內部小工具不開放給前端；前端函式只給登入者
REVOKE ALL ON FUNCTION public.ga_asset_events_immutable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_ws_actor_name(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_ws_lock_asset(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_ws_open_order_count(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_ws_asset_manage_code(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_ws_asset_view_code(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_ws_transfer_add_photos(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_ws_asset_open_orders(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_correct_asset_store(text, uuid, uuid, text, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_delete_asset(text, uuid, text, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_restore_asset(text, uuid, text, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_transfer_create(text, uuid, uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_transfer_confirm_handover(uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_transfer_confirm_receive(uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_transfer_cancel(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ga_ws_asset_open_orders(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_correct_asset_store(text, uuid, uuid, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_delete_asset(text, uuid, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_restore_asset(text, uuid, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_transfer_create(text, uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_transfer_confirm_handover(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_transfer_confirm_receive(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_transfer_cancel(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- 核對 1：應列出 3 列，rls_enabled 全為 true
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('ga_asset_transfers', 'ga_asset_transfer_photos', 'ga_asset_events')
ORDER BY c.relname;

-- 核對 2：應列出 8 個前端函式，anon_can_execute 全為 false、authenticated_can_execute 全為 true
SELECT p.proname AS function_name,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('ga_ws_asset_open_orders', 'ga_ws_correct_asset_store', 'ga_ws_delete_asset', 'ga_ws_restore_asset',
                    'ga_ws_transfer_create', 'ga_ws_transfer_confirm_handover', 'ga_ws_transfer_confirm_receive', 'ga_ws_transfer_cancel')
ORDER BY p.proname;
