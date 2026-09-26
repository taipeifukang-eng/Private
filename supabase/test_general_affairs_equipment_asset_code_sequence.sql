-- ============================================================
-- General Affairs Equipment Asset Code Sequence Test SQL
-- Run only in confirmed DEV.
-- ============================================================

DO $$
DECLARE
  v_run TEXT := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  v_l1_code TEXT := 'Z' || chr(65 + floor(random() * 26)::INTEGER);
  v_l2_code TEXT;
  v_l3_code TEXT;
  v_store_id UUID;
  v_level1_id UUID;
  v_level2_id UUID;
  v_level3_id UUID;
  v_first_code TEXT;
  v_second_code TEXT;
BEGIN
  IF to_regclass('public.ga_asset_code_sequences') IS NULL THEN
    RAISE EXCEPTION 'FAIL asset code sequence table missing';
  END IF;

  IF to_regprocedure('public.ga_next_equipment_asset_code(uuid, date)') IS NULL THEN
    RAISE EXCEPTION 'FAIL asset code helper missing';
  END IF;

  SELECT id
  INTO v_store_id
  FROM stores
  WHERE COALESCE(is_active, true) = true
  ORDER BY store_code NULLS LAST, created_at
  LIMIT 1;

  IF v_store_id IS NULL THEN
    RAISE EXCEPTION 'FAIL no active store fixture';
  END IF;

  v_l2_code := v_l1_code || '01';
  v_l3_code := v_l2_code || '01';

  INSERT INTO ga_equipment_categories(name, code, is_active)
  VALUES ('DEV asset seq level1 ' || v_run, v_l1_code, true)
  RETURNING id INTO v_level1_id;

  INSERT INTO ga_equipment_categories(name, code, parent_id, is_active)
  VALUES ('DEV asset seq level2 ' || v_run, v_l2_code, v_level1_id, true)
  RETURNING id INTO v_level2_id;

  INSERT INTO ga_equipment_categories(name, code, parent_id, is_active)
  VALUES ('DEV asset seq level3 ' || v_run, v_l3_code, v_level2_id, true)
  RETURNING id INTO v_level3_id;

  INSERT INTO ga_equipment(
    store_id,
    category_id,
    name,
    asset_code,
    brand,
    purchased_at,
    specs
  )
  VALUES (
    v_store_id,
    v_level3_id,
    'DEV asset seq equipment first ' || v_run,
    NULL,
    'DEV',
    DATE '2026-07-30',
    '{}'::jsonb
  )
  RETURNING asset_code INTO v_first_code;

  IF v_first_code !~ ('^' || v_l2_code || '20260730[0-9]{3}$') THEN
    RAISE EXCEPTION 'FAIL first asset code should use level-2 code and date, got %', v_first_code;
  END IF;

  INSERT INTO ga_equipment(
    store_id,
    category_id,
    name,
    asset_code,
    brand,
    purchased_at,
    specs
  )
  VALUES (
    v_store_id,
    v_level3_id,
    'DEV asset seq equipment second ' || v_run,
    NULL,
    'DEV',
    DATE '2026-07-30',
    '{}'::jsonb
  )
  RETURNING asset_code INTO v_second_code;

  IF substring(v_second_code from 13 for 3)::INTEGER <> substring(v_first_code from 13 for 3)::INTEGER + 1 THEN
    RAISE EXCEPTION 'FAIL second asset sequence should increment, first %, second %', v_first_code, v_second_code;
  END IF;

  UPDATE ga_equipment
  SET deleted_at = NOW(),
      deletion_reason = 'DEV asset code sequence test cleanup'
  WHERE name IN (
    'DEV asset seq equipment first ' || v_run,
    'DEV asset seq equipment second ' || v_run
  );

  UPDATE ga_equipment_categories
  SET deleted_at = NOW()
  WHERE id IN (v_level1_id, v_level2_id, v_level3_id);

  RAISE NOTICE 'PASS equipment asset code sequence: %, %', v_first_code, v_second_code;
END $$;
