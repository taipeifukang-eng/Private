-- ============================================================
-- Task 1C-2B 人工驗收 SQL（請在 DEV 測試環境執行）
-- 會建立 DEV-1C-2B-* 測試資料；不得在 Production 執行。
-- 清理方式見檔案底部「J. DEV 測試資料清理」。
--
-- 注意：併發驗收需以獨立動態測試執行，本 SQL 只驗證單連線 DB 約束與 RPC 行為。
-- ============================================================

-- A. 權限碼確認
SELECT code, module, feature, action, is_active
FROM permissions
WHERE code IN (
  'general_affairs.inventory_balance.view',
  'general_affairs.inventory_transaction.view',
  'general_affairs.inventory_transaction.manage'
)
ORDER BY code;

-- B. 資料表 / RLS / 無直接寫入 policy
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('ga_inventory_balances', 'ga_inventory_transactions')
ORDER BY tablename;

SELECT schemaname, tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('ga_inventory_balances', 'ga_inventory_transactions')
ORDER BY tablename, policyname;

SELECT count(*) AS direct_write_policy_count
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('ga_inventory_balances', 'ga_inventory_transactions')
  AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL');

-- C. Functions are SECURITY DEFINER and search_path pinned
SELECT
  p.proname,
  p.prosecdef,
  p.proconfig
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'ga_next_inventory_transaction_no',
    'ga_inventory_balance_is_visible',
    'ga_inventory_transaction_is_visible',
    'ga_prevent_inventory_transaction_mutation',
    'ga_post_inventory_transaction'
  )
ORDER BY p.proname;

-- D. Constraints / indexes summary
SELECT conrelid::regclass AS table_name, conname, contype
FROM pg_constraint
WHERE conrelid IN ('public.ga_inventory_balances'::regclass, 'public.ga_inventory_transactions'::regclass)
ORDER BY 1, conname;

SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('ga_inventory_balances', 'ga_inventory_transactions')
ORDER BY indexname;

-- E. DEV test context setup
CREATE TEMP TABLE IF NOT EXISTS ga_inventory_1c2b_context (
  key TEXT PRIMARY KEY,
  value UUID
) ON COMMIT DROP;

CREATE TEMP TABLE IF NOT EXISTS ga_inventory_1c2b_results (
  case_name TEXT PRIMARY KEY,
  result TEXT NOT NULL DEFAULT 'PASS',
  detail TEXT
) ON COMMIT DROP;

DO $$
DECLARE
  v_run_id TEXT := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  v_user_id UUID;
  v_role_id UUID;
  v_store_id UUID;
  v_location_id UUID;
  v_negative_location_id UUID;
  v_deleted_location_id UUID;
  v_part_id UUID;
  v_part_category_id UUID;
  v_purchase_part_id UUID;
  v_no_purchase_part_id UUID;
  v_fractional_part_id UUID;
  v_pack_part_id UUID;
  v_inactive_part_id UUID;
  v_deleted_part_id UUID;
  v_deleted_location_part_only_part_id UUID;
  v_location_part_id UUID;
  v_deleted_location_part_id UUID;
BEGIN
  SELECT id INTO v_user_id FROM profiles WHERE email = 'dev-ga-manage@example.test' LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'DEV 測試使用者 dev-ga-manage@example.test 不存在，請先完成 DEV seed';
  END IF;

  INSERT INTO roles (code, name, description, is_active)
  VALUES ('dev_inventory_transaction_sql_tester', 'DEV 庫存交易 SQL 測試角色', 'DEV Task 1C-2B test role', true)
  ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_active = true
  RETURNING id INTO v_role_id;

  INSERT INTO role_permissions (role_id, permission_id)
  SELECT v_role_id, p.id
  FROM permissions p
  WHERE p.code IN (
    'general_affairs.part.view',
    'general_affairs.inventory_balance.view',
    'general_affairs.inventory_transaction.view',
    'general_affairs.inventory_transaction.manage'
  )
  ON CONFLICT DO NOTHING;

  INSERT INTO user_roles (user_id, role_id)
  VALUES (v_user_id, v_role_id)
  ON CONFLICT DO NOTHING;

  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

  SELECT id INTO v_store_id FROM stores WHERE store_code = 'DEV001' LIMIT 1;
  SELECT id INTO v_part_id FROM ga_parts WHERE part_code = 'DEV-1B-3-PART-CODE' AND deleted_at IS NULL LIMIT 1;
  SELECT category_id INTO v_part_category_id FROM ga_parts WHERE id = v_part_id;

  IF v_store_id IS NULL OR v_part_id IS NULL OR v_part_category_id IS NULL THEN
    RAISE EXCEPTION '缺少 DEV001 或 DEV-1B-3-PART-CODE 測試資料';
  END IF;

  INSERT INTO ga_inventory_locations(code, name, location_type, store_id, allow_negative_stock)
  VALUES ('DEV-1C-2B-' || v_run_id || '-LOC', 'DEV 1C-2B 庫存交易位置', 'STORE', v_store_id, false)
  RETURNING id INTO v_location_id;

  INSERT INTO ga_inventory_locations(code, name, location_type, store_id, allow_negative_stock)
  VALUES ('DEV-1C-2B-' || v_run_id || '-NEG', 'DEV 1C-2B 負庫存位置', 'STORE', v_store_id, true)
  RETURNING id INTO v_negative_location_id;

  INSERT INTO ga_inventory_locations(code, name, location_type, store_id, allow_negative_stock, deleted_at, deleted_by, deletion_reason)
  VALUES ('DEV-1C-2B-' || v_run_id || '-DELLOC', 'DEV 1C-2B 已刪除位置', 'STORE', v_store_id, false, now(), v_user_id, 'DEV deleted location fixture')
  RETURNING id INTO v_deleted_location_id;

  INSERT INTO ga_parts(category_id, name, part_code, base_unit, purchase_unit, purchase_to_base_rate, minimum_issue_qty, allow_fractional_issue, allow_unpacking, is_active)
  VALUES (v_part_category_id, 'DEV 1C-2B 採購換算料件', 'DEV-1C-2B-' || v_run_id || '-PUR', '個', '箱', 12, 1, false, true, true)
  RETURNING id INTO v_purchase_part_id;

  INSERT INTO ga_parts(category_id, name, part_code, base_unit, minimum_issue_qty, allow_fractional_issue, allow_unpacking, is_active)
  VALUES (v_part_category_id, 'DEV 1C-2B 無採購單位料件', 'DEV-1C-2B-' || v_run_id || '-NOPUR', '個', 1, false, true, true)
  RETURNING id INTO v_no_purchase_part_id;

  INSERT INTO ga_parts(category_id, name, part_code, base_unit, purchase_unit, purchase_to_base_rate, minimum_issue_qty, allow_fractional_issue, allow_unpacking, is_active)
  VALUES (v_part_category_id, 'DEV 1C-2B 小數料件', 'DEV-1C-2B-' || v_run_id || '-FRAC', '公斤', '包', 0.5, 0.1, true, true, true)
  RETURNING id INTO v_fractional_part_id;

  INSERT INTO ga_parts(category_id, name, part_code, base_unit, purchase_unit, purchase_to_base_rate, minimum_issue_qty, allow_fractional_issue, allow_unpacking, is_active)
  VALUES (v_part_category_id, 'DEV 1C-2B 不拆包料件', 'DEV-1C-2B-' || v_run_id || '-PACK', '個', '箱', 12, 1, false, false, true)
  RETURNING id INTO v_pack_part_id;

  INSERT INTO ga_parts(category_id, name, part_code, base_unit, minimum_issue_qty, allow_fractional_issue, allow_unpacking, is_active)
  VALUES (v_part_category_id, 'DEV 1C-2B 停用料件', 'DEV-1C-2B-' || v_run_id || '-INACTIVE', '個', 1, false, true, false)
  RETURNING id INTO v_inactive_part_id;

  INSERT INTO ga_parts(category_id, name, part_code, base_unit, minimum_issue_qty, allow_fractional_issue, allow_unpacking, is_active, deleted_at, deleted_by, deletion_reason)
  VALUES (v_part_category_id, 'DEV 1C-2B 已刪除料件', 'DEV-1C-2B-' || v_run_id || '-DELPART', '個', 1, false, true, false, now(), v_user_id, 'DEV deleted part fixture')
  RETURNING id INTO v_deleted_part_id;

  INSERT INTO ga_parts(category_id, name, part_code, base_unit, minimum_issue_qty, allow_fractional_issue, allow_unpacking, is_active)
  VALUES (v_part_category_id, 'DEV 1C-2B 已刪除位置料件設定料件', 'DEV-1C-2B-' || v_run_id || '-DELLP', '個', 1, false, true, true)
  RETURNING id INTO v_deleted_location_part_only_part_id;

  INSERT INTO ga_inventory_location_parts(location_id, part_id, safety_stock_qty, reorder_point_qty, maximum_stock_qty)
  VALUES (v_location_id, v_part_id, 5, 10, 100)
  RETURNING id INTO v_location_part_id;

  INSERT INTO ga_inventory_location_parts(location_id, part_id, safety_stock_qty, reorder_point_qty, maximum_stock_qty)
  VALUES (v_negative_location_id, v_part_id, 5, 10, 100);

  INSERT INTO ga_inventory_location_parts(location_id, part_id)
  VALUES
    (v_location_id, v_purchase_part_id),
    (v_location_id, v_no_purchase_part_id),
    (v_location_id, v_fractional_part_id),
    (v_location_id, v_pack_part_id);

  INSERT INTO ga_inventory_location_parts(location_id, part_id, is_active, deleted_at, deleted_by, deletion_reason)
  VALUES (v_location_id, v_deleted_location_part_only_part_id, false, now(), v_user_id, 'DEV deleted location part fixture')
  RETURNING id INTO v_deleted_location_part_id;

  INSERT INTO ga_inventory_1c2b_context(key, value) VALUES
    ('user_id', v_user_id),
    ('role_id', v_role_id),
    ('location_id', v_location_id),
    ('negative_location_id', v_negative_location_id),
    ('deleted_location_id', v_deleted_location_id),
    ('part_id', v_part_id),
    ('purchase_part_id', v_purchase_part_id),
    ('no_purchase_part_id', v_no_purchase_part_id),
    ('fractional_part_id', v_fractional_part_id),
    ('pack_part_id', v_pack_part_id),
    ('inactive_part_id', v_inactive_part_id),
    ('deleted_part_id', v_deleted_part_id),
    ('deleted_location_part_only_part_id', v_deleted_location_part_only_part_id),
    ('location_part_id', v_location_part_id),
    ('deleted_location_part_id', v_deleted_location_part_id)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

  INSERT INTO ga_inventory_1c2b_results(case_name, detail) VALUES
    ('setup unique run fixtures', v_run_id),
    ('schema fixture parts prepared', 'purchase/no-purchase/fractional/pack/inactive/deleted')
  ON CONFLICT DO NOTHING;
END $$;

-- F. RPC happy path / balance consistency
DO $$
DECLARE
  v_user_id UUID := (SELECT value FROM ga_inventory_1c2b_context WHERE key = 'user_id');
  v_location_id UUID := (SELECT value FROM ga_inventory_1c2b_context WHERE key = 'location_id');
  v_negative_location_id UUID := (SELECT value FROM ga_inventory_1c2b_context WHERE key = 'negative_location_id');
  v_part_id UUID := (SELECT value FROM ga_inventory_1c2b_context WHERE key = 'part_id');
  v_tx RECORD;
  v_tx2 RECORD;
  v_idempotency_key TEXT;
  v_before_count INTEGER;
  v_after_count INTEGER;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);
  v_idempotency_key := 'DEV-IDEMPOTENCY-RECEIPT-' || replace(v_location_id::text, '-', '');

  SELECT count(*) INTO v_before_count FROM ga_inventory_transactions;

  SELECT * INTO v_tx
  FROM ga_post_inventory_transaction('RECEIPT', v_location_id, v_part_id, 10, 'BASE', 'DEV 1C-2B receipt', NULL, NULL, NULL, v_idempotency_key, NULL, '{}'::jsonb);

  IF v_tx.balance_before <> 0 OR v_tx.balance_after <> 10 OR v_tx.balance_version <> 1 THEN
    RAISE EXCEPTION '入庫首次建立 balance/version 失敗';
  END IF;

  SELECT * INTO v_tx2
  FROM ga_post_inventory_transaction('RECEIPT', v_location_id, v_part_id, 10, 'BASE', 'DEV 1C-2B receipt', NULL, NULL, NULL, v_idempotency_key, NULL, '{}'::jsonb);

  SELECT count(*) INTO v_after_count FROM ga_inventory_transactions;
  IF v_tx2.idempotent_replay IS DISTINCT FROM true OR v_after_count <> v_before_count + 1 THEN
    RAISE EXCEPTION 'idempotency 同 key 同 payload 不應重複入帳';
  END IF;

  BEGIN
    PERFORM *
    FROM ga_post_inventory_transaction('RECEIPT', v_location_id, v_part_id, 11, 'BASE', 'DEV 1C-2B receipt changed', NULL, NULL, NULL, v_idempotency_key, NULL, '{}'::jsonb);
    RAISE EXCEPTION 'FAIL: idempotency 不同 payload 未被拒絕';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;

  SELECT * INTO v_tx
  FROM ga_post_inventory_transaction('RECEIPT', v_location_id, v_part_id, 2, 'BASE', 'DEV second receipt');
  IF v_tx.balance_before <> 10 OR v_tx.balance_after <> 12 OR v_tx.balance_version <> 2 THEN
    RAISE EXCEPTION '第二次入庫更新 balance/version 失敗';
  END IF;

  SELECT * INTO v_tx
  FROM ga_post_inventory_transaction('ISSUE', v_location_id, v_part_id, 1, 'BASE', 'DEV issue');
  IF v_tx.quantity_base <> -1 OR v_tx.balance_after <> 11 THEN
    RAISE EXCEPTION 'ISSUE 扣減失敗';
  END IF;

  SELECT * INTO v_tx
  FROM ga_post_inventory_transaction('ADJUST_IN', v_location_id, v_part_id, 1, 'BASE', 'DEV adjust in');
  IF v_tx.quantity_base <> 1 OR v_tx.balance_after <> 12 THEN
    RAISE EXCEPTION 'ADJUST_IN 失敗';
  END IF;

  SELECT * INTO v_tx
  FROM ga_post_inventory_transaction('ADJUST_OUT', v_location_id, v_part_id, 1, 'BASE', 'DEV adjust out');
  IF v_tx.quantity_base <> -1 OR v_tx.balance_after <> 11 THEN
    RAISE EXCEPTION 'ADJUST_OUT 失敗';
  END IF;

  BEGIN
    PERFORM * FROM ga_post_inventory_transaction('ISSUE', v_location_id, v_part_id, 9999, 'BASE', 'DEV insufficient stock');
    RAISE EXCEPTION 'FAIL: 不允許負庫存位置未拒絕出庫';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;

  SELECT * INTO v_tx
  FROM ga_post_inventory_transaction('ISSUE', v_negative_location_id, v_part_id, 1, 'BASE', 'DEV negative allowed');
  IF v_tx.balance_after <> -1 THEN
    RAISE EXCEPTION 'allow_negative_stock=true 應允許負庫存';
  END IF;

  INSERT INTO ga_inventory_1c2b_results(case_name) VALUES
    ('receipt creates balance'),
    ('idempotency replay no duplicate'),
    ('idempotency conflict rejected'),
    ('second receipt accumulates'),
    ('issue deducts'),
    ('adjust in increases'),
    ('adjust out deducts'),
    ('negative stock blocked'),
    ('negative stock allowed')
  ON CONFLICT DO NOTHING;
END $$;

-- F2. Unit conversion / fractional / minimum issue / unpacking coverage
DO $$
DECLARE
  v_user_id UUID := (SELECT value FROM ga_inventory_1c2b_context WHERE key = 'user_id');
  v_location_id UUID := (SELECT value FROM ga_inventory_1c2b_context WHERE key = 'location_id');
  v_purchase_part_id UUID := (SELECT value FROM ga_inventory_1c2b_context WHERE key = 'purchase_part_id');
  v_no_purchase_part_id UUID := (SELECT value FROM ga_inventory_1c2b_context WHERE key = 'no_purchase_part_id');
  v_fractional_part_id UUID := (SELECT value FROM ga_inventory_1c2b_context WHERE key = 'fractional_part_id');
  v_pack_part_id UUID := (SELECT value FROM ga_inventory_1c2b_context WHERE key = 'pack_part_id');
  v_tx RECORD;
  v_before_count INTEGER;
  v_after_count INTEGER;
  v_before_balance NUMERIC;
  v_after_balance NUMERIC;
  v_before_version BIGINT;
  v_after_version BIGINT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

  SELECT * INTO v_tx
  FROM ga_post_inventory_transaction('RECEIPT', v_location_id, v_purchase_part_id, 2, 'PURCHASE', 'DEV purchase receipt rate 12');
  IF v_tx.quantity_input <> 2 OR v_tx.input_unit_type <> 'PURCHASE' OR v_tx.unit_conversion_rate <> 12 OR v_tx.quantity_base <> 24 OR v_tx.balance_after <> 24 THEN
    RAISE EXCEPTION 'PURCHASE RECEIPT 換算失敗';
  END IF;

  SELECT * INTO v_tx
  FROM ga_post_inventory_transaction('ISSUE', v_location_id, v_purchase_part_id, 1, 'PURCHASE', 'DEV purchase issue rate 12');
  IF v_tx.quantity_base <> -12 OR v_tx.balance_after <> 12 THEN
    RAISE EXCEPTION 'PURCHASE ISSUE 換算失敗';
  END IF;

  SELECT * INTO v_tx
  FROM ga_post_inventory_transaction('RECEIPT', v_location_id, v_purchase_part_id, 1, 'BASE', 'DEV base rate fixed');
  IF v_tx.unit_conversion_rate <> 1 OR v_tx.quantity_base <> 1 OR v_tx.balance_after <> 13 THEN
    RAISE EXCEPTION 'BASE rate = 1 驗證失敗';
  END IF;

  SELECT count(*), COALESCE(max(b.quantity_base), 0), COALESCE(max(b.version), 0)
    INTO v_before_count, v_before_balance, v_before_version
  FROM ga_inventory_transactions t
  RIGHT JOIN ga_inventory_balances b ON b.location_id = v_location_id AND b.part_id = v_no_purchase_part_id
  WHERE t.location_id IS NULL OR true;

  BEGIN
    PERFORM * FROM ga_post_inventory_transaction('RECEIPT', v_location_id, v_no_purchase_part_id, 1, 'PURCHASE', 'DEV no purchase unit');
    RAISE EXCEPTION 'FAIL: 無 purchase_unit 時 PURCHASE 未被拒絕';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%INVALID_PURCHASE_UNIT%' THEN RAISE EXCEPTION '無 purchase_unit 錯誤碼不符合預期: %', SQLERRM; END IF;
  END;

  SELECT count(*) INTO v_after_count FROM ga_inventory_transactions WHERE location_id = v_location_id AND part_id = v_no_purchase_part_id;
  IF v_after_count <> 0 THEN
    RAISE EXCEPTION '無 purchase_unit 失敗後不應新增 transaction';
  END IF;

  SELECT * INTO v_tx
  FROM ga_post_inventory_transaction('RECEIPT', v_location_id, v_fractional_part_id, 1.25, 'BASE', 'DEV fractional base receipt');
  IF v_tx.quantity_base <> 1.25 OR v_tx.balance_after <> 1.25 THEN
    RAISE EXCEPTION 'allow_fractional_issue=true 合法小數應成功';
  END IF;

  BEGIN
    PERFORM * FROM ga_post_inventory_transaction('ISSUE', v_location_id, v_purchase_part_id, 0.5, 'BASE', 'DEV fractional issue blocked');
    RAISE EXCEPTION 'FAIL: allow_fractional_issue=false 小數未被拒絕';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%FRACTIONAL_NOT_ALLOWED%' THEN RAISE EXCEPTION '小數領用錯誤碼不符合預期: %', SQLERRM; END IF;
  END;

  BEGIN
    PERFORM * FROM ga_post_inventory_transaction('ISSUE', v_location_id, v_fractional_part_id, 0.05, 'BASE', 'DEV minimum issue blocked');
    RAISE EXCEPTION 'FAIL: minimum_issue_qty 小於門檻未被拒絕';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%MINIMUM_ISSUE_NOT_MET%' THEN RAISE EXCEPTION 'minimum_issue_qty 錯誤碼不符合預期: %', SQLERRM; END IF;
  END;

  SELECT * INTO v_tx
  FROM ga_post_inventory_transaction('ISSUE', v_location_id, v_fractional_part_id, 0.1, 'BASE', 'DEV minimum issue equals threshold');
  IF v_tx.quantity_base <> -0.1 THEN
    RAISE EXCEPTION 'minimum_issue_qty 等於門檻應成功';
  END IF;

  SELECT * INTO v_tx
  FROM ga_post_inventory_transaction('RECEIPT', v_location_id, v_pack_part_id, 3, 'PURCHASE', 'DEV pack receipt');
  IF v_tx.quantity_base <> 36 THEN
    RAISE EXCEPTION '不拆包料件入庫換算失敗';
  END IF;

  SELECT * INTO v_tx
  FROM ga_post_inventory_transaction('ISSUE', v_location_id, v_pack_part_id, 12, 'BASE', 'DEV pack issue 12 base');
  IF v_tx.quantity_base <> -12 THEN
    RAISE EXCEPTION 'allow_unpacking=false ISSUE 12 BASE 應成功';
  END IF;

  SELECT * INTO v_tx
  FROM ga_post_inventory_transaction('ISSUE', v_location_id, v_pack_part_id, 1, 'PURCHASE', 'DEV pack issue 1 purchase');
  IF v_tx.quantity_base <> -12 THEN
    RAISE EXCEPTION 'allow_unpacking=false ISSUE 1 PURCHASE 應成功';
  END IF;

  BEGIN
    PERFORM * FROM ga_post_inventory_transaction('ISSUE', v_location_id, v_pack_part_id, 1, 'BASE', 'DEV unpacking blocked 1');
    RAISE EXCEPTION 'FAIL: allow_unpacking=false ISSUE 1 BASE 未被拒絕';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%UNPACKING_NOT_ALLOWED%' THEN RAISE EXCEPTION 'allow_unpacking 錯誤碼不符合預期: %', SQLERRM; END IF;
  END;

  BEGIN
    PERFORM * FROM ga_post_inventory_transaction('ADJUST_OUT', v_location_id, v_pack_part_id, 13, 'BASE', 'DEV unpacking blocked 13');
    RAISE EXCEPTION 'FAIL: allow_unpacking=false ADJUST_OUT 13 BASE 未被拒絕';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%UNPACKING_NOT_ALLOWED%' THEN RAISE EXCEPTION 'ADJUST_OUT allow_unpacking 錯誤碼不符合預期: %', SQLERRM; END IF;
  END;

  INSERT INTO ga_inventory_1c2b_results(case_name) VALUES
    ('purchase receipt converts to base'),
    ('purchase issue converts to base'),
    ('base unit rate fixed at one'),
    ('purchase without unit rejected'),
    ('fractional issue false rejected'),
    ('fractional issue true allowed'),
    ('minimum issue below threshold rejected'),
    ('minimum issue equals threshold allowed'),
    ('allow unpacking false package multiples allowed'),
    ('allow unpacking false partial package rejected')
  ON CONFLICT DO NOTHING;
END $$;

-- F3. Fixture constraints for invalid purchase settings
DO $$
DECLARE
  v_part_category_id UUID;
BEGIN
  SELECT category_id INTO v_part_category_id
  FROM ga_parts
  WHERE id = (SELECT value FROM ga_inventory_1c2b_context WHERE key = 'part_id');

  BEGIN
    INSERT INTO ga_parts(category_id, name, part_code, base_unit, purchase_to_base_rate)
    VALUES (v_part_category_id, 'DEV invalid purchase rate without unit', 'DEV-1C-2B-BAD-RATE-NO-UNIT', '個', 12);
    RAISE EXCEPTION 'FAIL: purchase_to_base_rate without purchase_unit 未被 constraint 拒絕';
  EXCEPTION WHEN others THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;

  BEGIN
    INSERT INTO ga_parts(category_id, name, part_code, base_unit, purchase_unit, purchase_to_base_rate)
    VALUES (v_part_category_id, 'DEV invalid purchase null rate', 'DEV-1C-2B-BAD-RATE-NULL', '個', '箱', NULL);
    RAISE EXCEPTION 'FAIL: purchase_unit with NULL rate 未被 constraint/trigger 拒絕';
  EXCEPTION WHEN others THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;

  BEGIN
    INSERT INTO ga_parts(category_id, name, part_code, base_unit, purchase_unit, purchase_to_base_rate)
    VALUES (v_part_category_id, 'DEV invalid purchase zero rate', 'DEV-1C-2B-BAD-RATE-ZERO', '個', '箱', 0);
    RAISE EXCEPTION 'FAIL: purchase_unit with zero rate 未被 constraint/trigger 拒絕';
  EXCEPTION WHEN others THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;

  INSERT INTO ga_inventory_1c2b_results(case_name) VALUES
    ('purchase rate without unit rejected by constraints'),
    ('purchase unit null rate rejected by constraints'),
    ('purchase unit zero rate rejected by constraints')
  ON CONFLICT DO NOTHING;
END $$;

-- G. Validation failures
DO $$
DECLARE
  v_user_id UUID := (SELECT value FROM ga_inventory_1c2b_context WHERE key = 'user_id');
  v_location_id UUID := (SELECT value FROM ga_inventory_1c2b_context WHERE key = 'location_id');
  v_negative_location_id UUID := (SELECT value FROM ga_inventory_1c2b_context WHERE key = 'negative_location_id');
  v_deleted_location_id UUID := (SELECT value FROM ga_inventory_1c2b_context WHERE key = 'deleted_location_id');
  v_part_id UUID := (SELECT value FROM ga_inventory_1c2b_context WHERE key = 'part_id');
  v_inactive_part_id UUID := (SELECT value FROM ga_inventory_1c2b_context WHERE key = 'inactive_part_id');
  v_deleted_part_id UUID := (SELECT value FROM ga_inventory_1c2b_context WHERE key = 'deleted_part_id');
  v_deleted_location_part_only_part_id UUID := (SELECT value FROM ga_inventory_1c2b_context WHERE key = 'deleted_location_part_only_part_id');
  v_fractional_part_id UUID := (SELECT value FROM ga_inventory_1c2b_context WHERE key = 'fractional_part_id');
  v_inactive_location_id UUID;
  v_before_count INTEGER;
  v_after_count INTEGER;
  v_before_balance NUMERIC;
  v_after_balance NUMERIC;
  v_before_version BIGINT;
  v_after_version BIGINT;
  v_tx RECORD;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

  BEGIN
    PERFORM * FROM ga_post_inventory_transaction('BAD', v_location_id, v_part_id, 1, 'BASE', 'DEV invalid type');
    RAISE EXCEPTION 'FAIL: invalid transaction type 未被拒絕';
  EXCEPTION WHEN others THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;

  BEGIN
    PERFORM * FROM ga_post_inventory_transaction('RECEIPT', v_location_id, v_part_id, 1, 'BAD', 'DEV invalid unit');
    RAISE EXCEPTION 'FAIL: invalid input unit 未被拒絕';
  EXCEPTION WHEN others THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;

  BEGIN
    PERFORM * FROM ga_post_inventory_transaction('RECEIPT', v_location_id, v_part_id, 0, 'BASE', 'DEV invalid qty');
    RAISE EXCEPTION 'FAIL: invalid quantity 未被拒絕';
  EXCEPTION WHEN others THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;

  BEGIN
    PERFORM * FROM ga_post_inventory_transaction('RECEIPT', v_location_id, v_part_id, -1, 'BASE', 'DEV negative qty');
    RAISE EXCEPTION 'FAIL: negative quantity 未被拒絕';
  EXCEPTION WHEN others THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;

  BEGIN
    PERFORM * FROM ga_post_inventory_transaction('RECEIPT', v_location_id, v_part_id, NULL, 'BASE', 'DEV null qty');
    RAISE EXCEPTION 'FAIL: NULL quantity 未被拒絕';
  EXCEPTION WHEN others THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;

  BEGIN
    PERFORM * FROM ga_post_inventory_transaction('RECEIPT', v_location_id, v_part_id, 1, 'BASE', NULL);
    RAISE EXCEPTION 'FAIL: NULL reason 未被拒絕';
  EXCEPTION WHEN others THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;

  BEGIN
    PERFORM * FROM ga_post_inventory_transaction('RECEIPT', v_location_id, v_part_id, 1, 'BASE', '   ');
    RAISE EXCEPTION 'FAIL: blank reason 未被拒絕';
  EXCEPTION WHEN others THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;

  BEGIN
    PERFORM * FROM ga_post_inventory_transaction('RECEIPT', v_location_id, v_part_id, 1, 'BASE', 'DEV metadata array', NULL, NULL, NULL, NULL, NULL, '[]'::jsonb);
    RAISE EXCEPTION 'FAIL: metadata 非 object 未被拒絕';
  EXCEPTION WHEN others THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;

  BEGIN
    PERFORM * FROM ga_post_inventory_transaction('RECEIPT', v_location_id, v_part_id, 1, 'BASE', 'DEV metadata string', NULL, NULL, NULL, NULL, NULL, '"bad"'::jsonb);
    RAISE EXCEPTION 'FAIL: metadata string 未被拒絕';
  EXCEPTION WHEN others THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;

  BEGIN
    PERFORM * FROM ga_post_inventory_transaction('RECEIPT', v_location_id, v_part_id, 1, 'BASE', 'DEV metadata number', NULL, NULL, NULL, NULL, NULL, '1'::jsonb);
    RAISE EXCEPTION 'FAIL: metadata number 未被拒絕';
  EXCEPTION WHEN others THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;

  SELECT * INTO v_tx
  FROM ga_post_inventory_transaction('RECEIPT', v_location_id, v_part_id, 1, 'BASE', 'DEV metadata object ok', NULL, NULL, NULL, NULL, NULL, '{"ok":true}'::jsonb);
  IF v_tx.quantity_base <> 1 THEN
    RAISE EXCEPTION 'metadata object 應成功';
  END IF;

  BEGIN
    PERFORM * FROM ga_post_inventory_transaction('RECEIPT', v_location_id, v_part_id, 1, 'BASE', 'DEV reference missing type', NULL, NULL, gen_random_uuid(), NULL, NULL, '{}'::jsonb);
    RAISE EXCEPTION 'FAIL: reference_id 有值但 reference_type NULL 未被拒絕';
  EXCEPTION WHEN others THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;

  BEGIN
    PERFORM * FROM ga_post_inventory_transaction('RECEIPT', v_location_id, v_part_id, 1, 'BASE', 'DEV reference blank type', NULL, '   ', gen_random_uuid(), NULL, NULL, '{}'::jsonb);
    RAISE EXCEPTION 'FAIL: reference_id 有值但 reference_type blank 未被拒絕';
  EXCEPTION WHEN others THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;

  SELECT * INTO v_tx
  FROM ga_post_inventory_transaction('RECEIPT', v_location_id, v_part_id, 1, 'BASE', 'DEV reference type without id ok', NULL, 'manual', NULL, NULL, NULL, '{}'::jsonb);
  IF v_tx.quantity_base <> 1 THEN
    RAISE EXCEPTION 'reference_type 有值但 reference_id NULL 的目前規格應成功';
  END IF;

  SELECT count(*) INTO v_before_count
  FROM ga_inventory_transactions
  WHERE location_id = v_location_id AND part_id = v_part_id;
  SELECT * INTO v_tx
  FROM ga_post_inventory_transaction('RECEIPT', v_location_id, v_part_id, 1, 'BASE', 'DEV blank idempotency key normalized', NULL, NULL, NULL, '   ', NULL, '{}'::jsonb);
  SELECT count(*) INTO v_after_count
  FROM ga_inventory_transactions
  WHERE location_id = v_location_id AND part_id = v_part_id;
  IF v_after_count <> v_before_count + 1 THEN
    RAISE EXCEPTION 'blank idempotency key 應正規化為 NULL 並建立一般交易';
  END IF;

  SELECT * INTO v_tx
  FROM ga_post_inventory_transaction('RECEIPT', v_location_id, v_part_id, 1, 'BASE', 'DEV notes reference normalization', '', '', NULL, NULL, NULL, '{}'::jsonb);
  IF EXISTS (
    SELECT 1
    FROM ga_inventory_transactions
    WHERE id = v_tx.transaction_id
      AND (notes IS NOT NULL OR reference_type IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'notes/reference_type 空字串應正規化為 NULL';
  END IF;

  UPDATE ga_inventory_locations SET is_active = false WHERE id = v_location_id RETURNING id INTO v_inactive_location_id;
  BEGIN
    PERFORM * FROM ga_post_inventory_transaction('RECEIPT', v_inactive_location_id, v_part_id, 1, 'BASE', 'DEV inactive location');
    RAISE EXCEPTION 'FAIL: inactive location 未被拒絕';
  EXCEPTION WHEN others THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;
  UPDATE ga_inventory_locations SET is_active = true WHERE id = v_location_id;

  BEGIN
    PERFORM * FROM ga_post_inventory_transaction('RECEIPT', v_deleted_location_id, v_part_id, 1, 'BASE', 'DEV deleted location');
    RAISE EXCEPTION 'FAIL: soft-deleted location 未被拒絕';
  EXCEPTION WHEN others THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;

  BEGIN
    PERFORM * FROM ga_post_inventory_transaction('RECEIPT', v_location_id, v_inactive_part_id, 1, 'BASE', 'DEV inactive part');
    RAISE EXCEPTION 'FAIL: inactive part 未被拒絕';
  EXCEPTION WHEN others THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;

  BEGIN
    PERFORM * FROM ga_post_inventory_transaction('RECEIPT', v_location_id, v_deleted_part_id, 1, 'BASE', 'DEV deleted part');
    RAISE EXCEPTION 'FAIL: soft-deleted part 未被拒絕';
  EXCEPTION WHEN others THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;

  BEGIN
    PERFORM * FROM ga_post_inventory_transaction('RECEIPT', v_negative_location_id, v_fractional_part_id, 1, 'BASE', 'DEV location part missing');
    RAISE EXCEPTION 'FAIL: location-part 不存在未被拒絕';
  EXCEPTION WHEN others THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;

  BEGIN
    PERFORM * FROM ga_post_inventory_transaction('RECEIPT', v_location_id, v_deleted_location_part_only_part_id, 1, 'BASE', 'DEV deleted location part only');
    RAISE EXCEPTION 'FAIL: soft-deleted location-part 未被拒絕';
  EXCEPTION WHEN others THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;

  UPDATE ga_inventory_location_parts SET is_active = false WHERE location_id = v_location_id AND part_id = v_part_id;
  BEGIN
    PERFORM * FROM ga_post_inventory_transaction('RECEIPT', v_location_id, v_part_id, 1, 'BASE', 'DEV inactive location part');
    RAISE EXCEPTION 'FAIL: inactive location part 未被拒絕';
  EXCEPTION WHEN others THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;
  UPDATE ga_inventory_location_parts SET is_active = true WHERE location_id = v_location_id AND part_id = v_part_id;

  SELECT count(*), COALESCE(max(b.quantity_base), 0), COALESCE(max(b.version), 0)
    INTO v_before_count, v_before_balance, v_before_version
  FROM ga_inventory_transactions t
  RIGHT JOIN ga_inventory_balances b ON b.location_id = v_location_id AND b.part_id = v_fractional_part_id
  WHERE t.location_id IS NULL OR true;

  BEGIN
    PERFORM * FROM ga_post_inventory_transaction('RECEIPT', v_location_id, v_fractional_part_id, 0.00001, 'BASE', 'DEV numeric precision overflow');
    RAISE EXCEPTION 'FAIL: 超過 4 位小數未被拒絕';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%4 位小數%' THEN RAISE EXCEPTION 'numeric precision 錯誤碼不符合預期: %', SQLERRM; END IF;
  END;

  SELECT count(*), COALESCE(max(b.quantity_base), 0), COALESCE(max(b.version), 0)
    INTO v_after_count, v_after_balance, v_after_version
  FROM ga_inventory_transactions t
  RIGHT JOIN ga_inventory_balances b ON b.location_id = v_location_id AND b.part_id = v_fractional_part_id
  WHERE t.location_id IS NULL OR true;
  IF v_after_balance <> v_before_balance OR v_after_version <> v_before_version THEN
    RAISE EXCEPTION 'numeric precision 失敗後 balance/version 不應改變';
  END IF;

  INSERT INTO ga_inventory_1c2b_results(case_name) VALUES
    ('invalid transaction type rejected'),
    ('invalid input unit type rejected'),
    ('zero quantity rejected'),
    ('negative quantity rejected'),
    ('null quantity rejected'),
    ('null reason rejected'),
    ('blank reason rejected'),
    ('metadata array rejected'),
    ('metadata string rejected'),
    ('metadata number rejected'),
    ('metadata object allowed'),
    ('reference id without type rejected'),
    ('blank reference type rejected'),
    ('reference type without id allowed'),
    ('blank idempotency key normalized'),
    ('notes and reference type blank normalized'),
    ('inactive location rejected'),
    ('deleted location rejected'),
    ('inactive part rejected'),
    ('deleted part rejected'),
    ('missing location part rejected'),
    ('deleted location part rejected'),
    ('inactive location part rejected'),
    ('numeric precision overflow rejected')
  ON CONFLICT DO NOTHING;
END $$;

-- H. Append-only and consistency
DO $$
DECLARE
  v_tx_id UUID;
BEGIN
  SELECT id INTO v_tx_id
  FROM ga_inventory_transactions
  WHERE reason LIKE 'DEV%'
  LIMIT 1;

  IF v_tx_id IS NULL THEN
    RAISE EXCEPTION '缺少 DEV transaction 測試資料';
  END IF;

  BEGIN
    UPDATE ga_inventory_transactions SET notes = 'SHOULD FAIL' WHERE id = v_tx_id;
    RAISE EXCEPTION 'FAIL: transaction UPDATE 未被 append-only trigger 拒絕';
  EXCEPTION WHEN others THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;

  BEGIN
    DELETE FROM ga_inventory_transactions WHERE id = v_tx_id;
    RAISE EXCEPTION 'FAIL: transaction DELETE 未被 append-only trigger 拒絕';
  EXCEPTION WHEN others THEN IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF; END;

  IF EXISTS (
    SELECT 1
    FROM ga_inventory_transactions
    WHERE balance_after <> balance_before + quantity_base
  ) THEN
    RAISE EXCEPTION 'transaction/balance math 不一致';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM ga_inventory_balances b
    WHERE b.last_transaction_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM ga_inventory_transactions t
        WHERE t.id = b.last_transaction_id
          AND t.location_id = b.location_id
          AND t.part_id = b.part_id
          AND t.balance_after = b.quantity_base
      )
  ) THEN
    RAISE EXCEPTION 'balance last_transaction_id 不正確';
  END IF;

  INSERT INTO ga_inventory_1c2b_results(case_name) VALUES
    ('transaction update blocked by append-only trigger'),
    ('transaction delete blocked by append-only trigger'),
    ('transaction balance math consistent'),
    ('balance last transaction id consistent')
  ON CONFLICT DO NOTHING;
END $$;

-- I. Direct write / system field protection by catalog
DO $$
DECLARE
  v_direct_write_policy_count INTEGER;
  v_unsafe_table_grant_count INTEGER;
  v_rpc_system_field_param_count INTEGER;
BEGIN
  SELECT count(*) INTO v_direct_write_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('ga_inventory_balances', 'ga_inventory_transactions')
    AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL');

  IF v_direct_write_policy_count <> 0 THEN
    RAISE EXCEPTION 'direct write policy count should be 0, got %', v_direct_write_policy_count;
  END IF;

  SELECT count(*) INTO v_unsafe_table_grant_count
  FROM information_schema.table_privileges
  WHERE table_schema = 'public'
    AND table_name IN ('ga_inventory_balances', 'ga_inventory_transactions')
    AND grantee IN ('anon', 'authenticated')
    AND privilege_type <> 'SELECT';

  IF v_unsafe_table_grant_count <> 0 THEN
    RAISE EXCEPTION 'anon/authenticated 不應有 balances/transactions 直接寫入 grant';
  END IF;

  SELECT count(*) INTO v_rpc_system_field_param_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL unnest(string_to_array(pg_get_function_identity_arguments(p.oid), ', ')) AS arg(arg_text)
  WHERE n.nspname = 'public'
    AND p.proname = 'ga_post_inventory_transaction'
    AND arg.arg_text ~* '(transaction_no|quantity_base|balance_before|balance_after|created_by|created_at|last_transaction_id|version)';

  IF v_rpc_system_field_param_count <> 0 THEN
    RAISE EXCEPTION 'RPC signature 不應接受 system fields';
  END IF;

  INSERT INTO ga_inventory_1c2b_results(case_name) VALUES
    ('direct write policies absent'),
    ('anon authenticated write grants absent'),
    ('rpc signature rejects system fields')
  ON CONFLICT DO NOTHING;
END $$;

-- J. 結果摘要
SELECT result, case_name, detail
FROM ga_inventory_1c2b_results
ORDER BY case_name;

SELECT
  b.location_id,
  b.part_id,
  b.quantity_base,
  b.version,
  b.last_transaction_id,
  b.last_transaction_at
FROM ga_inventory_balances b
JOIN ga_inventory_locations l ON l.id = b.location_id
WHERE l.code LIKE 'DEV-1C-2B-%'
ORDER BY l.code;

SELECT
  transaction_no,
  transaction_type,
  quantity_input,
  input_unit_type,
  unit_conversion_rate,
  quantity_base,
  balance_before,
  balance_after,
  reason
FROM ga_inventory_transactions
WHERE reason LIKE 'DEV%'
ORDER BY created_at;

-- K. DEV 測試資料清理（驗收完成後如需清理，請在 DEV 手動執行）
-- 本段只標記測試資料，不硬刪。
-- UPDATE ga_inventory_location_parts
-- SET deleted_at = COALESCE(deleted_at, now()),
--     is_active = false,
--     deletion_reason = COALESCE(deletion_reason, 'DEV Task 1C-2B cleanup')
-- WHERE location_id IN (
--   SELECT id FROM ga_inventory_locations WHERE code LIKE 'DEV-1C-2B-%'
-- );
--
-- UPDATE ga_inventory_locations
-- SET deleted_at = COALESCE(deleted_at, now()),
--     is_active = false,
--     is_default = false,
--     deletion_reason = COALESCE(deletion_reason, 'DEV Task 1C-2B cleanup')
-- WHERE code LIKE 'DEV-1C-2B-%';
