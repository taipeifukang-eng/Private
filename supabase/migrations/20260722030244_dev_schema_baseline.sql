


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."ga_category_kind" AS ENUM (
    'equipment',
    'facility',
    'part'
);


ALTER TYPE "public"."ga_category_kind" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_has_permission"("p_permission_code" character varying) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT public.has_permission(auth.uid(), p_permission_code);
$$;


ALTER FUNCTION "public"."current_user_has_permission"("p_permission_code" character varying) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_is_store_manager"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM store_managers sm
    WHERE sm.user_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."current_user_is_store_manager"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dev_bootstrap_touch_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."dev_bootstrap_touch_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ga_active_category_path"("p_kind" "public"."ga_category_kind", "p_category_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_table TEXT := ga_category_table_name(p_kind);
  v_path JSONB;
BEGIN
  IF NOT ga_category_has_active_path(p_kind, p_category_id) THEN
    RETURN '[]'::jsonb;
  END IF;

  EXECUTE format($sql$
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id, name, code, 1 AS depth, ARRAY[id] AS path
      FROM %I
      WHERE id = $1
      UNION ALL
      SELECT p.id, p.parent_id, p.name, p.code, a.depth + 1, a.path || p.id
      FROM %I p
      JOIN ancestors a ON a.parent_id = p.id
      WHERE NOT p.id = ANY(a.path)
    )
    SELECT COALESCE(
      jsonb_agg(jsonb_build_object('id', id, 'name', name, 'code', code) ORDER BY depth DESC),
      '[]'::jsonb
    )
    FROM ancestors
  $sql$, v_table, v_table)
  INTO v_path
  USING p_category_id;

  RETURN COALESCE(v_path, '[]'::jsonb);
END;
$_$;


ALTER FUNCTION "public"."ga_active_category_path"("p_kind" "public"."ga_category_kind", "p_category_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ga_category_before_write"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_kind ga_category_kind;
BEGIN
  IF TG_TABLE_NAME = 'ga_equipment_categories' THEN
    v_kind := 'equipment';
  ELSIF TG_TABLE_NAME = 'ga_facility_categories' THEN
    v_kind := 'facility';
  ELSIF TG_TABLE_NAME = 'ga_part_categories' THEN
    v_kind := 'part';
  ELSE
    RAISE EXCEPTION 'Unsupported category trigger table: %', TG_TABLE_NAME;
  END IF;

  NEW.name := btrim(NEW.name);
  NEW.code := upper(btrim(NEW.code));

  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := NOW();
  END IF;

  IF TG_OP = 'INSERT' OR NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
    PERFORM ga_validate_category_tree(v_kind, NEW.id, NEW.parent_id);
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."ga_category_before_write"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ga_category_depth"("p_kind" "public"."ga_category_kind", "p_category_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_table TEXT := ga_category_table_name(p_kind);
  v_depth INTEGER;
BEGIN
  EXECUTE format($sql$
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id, 1 AS depth, ARRAY[id] AS path
      FROM %I
      WHERE id = $1
      UNION ALL
      SELECT p.id, p.parent_id, a.depth + 1, a.path || p.id
      FROM %I p
      JOIN ancestors a ON a.parent_id = p.id
      WHERE NOT p.id = ANY(a.path)
    )
    SELECT max(depth) FROM ancestors
  $sql$, v_table, v_table)
  INTO v_depth
  USING p_category_id;

  RETURN COALESCE(v_depth, 0);
END;
$_$;


ALTER FUNCTION "public"."ga_category_depth"("p_kind" "public"."ga_category_kind", "p_category_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ga_category_has_active_path"("p_kind" "public"."ga_category_kind", "p_category_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_table TEXT := ga_category_table_name(p_kind);
  v_is_valid BOOLEAN;
BEGIN
  EXECUTE format($sql$
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id, is_active, deleted_at, ARRAY[id] AS path
      FROM %I
      WHERE id = $1
      UNION ALL
      SELECT p.id, p.parent_id, p.is_active, p.deleted_at, a.path || p.id
      FROM %I p
      JOIN ancestors a ON a.parent_id = p.id
      WHERE NOT p.id = ANY(a.path)
    )
    SELECT
      count(*) > 0
      AND bool_and(is_active = true)
      AND bool_and(deleted_at IS NULL)
    FROM ancestors
  $sql$, v_table, v_table)
  INTO v_is_valid
  USING p_category_id;

  RETURN COALESCE(v_is_valid, false);
END;
$_$;


ALTER FUNCTION "public"."ga_category_has_active_path"("p_kind" "public"."ga_category_kind", "p_category_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ga_category_table_name"("p_kind" "public"."ga_category_kind") RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
BEGIN
  CASE p_kind
    WHEN 'equipment' THEN RETURN 'ga_equipment_categories';
    WHEN 'facility' THEN RETURN 'ga_facility_categories';
    WHEN 'part' THEN RETURN 'ga_part_categories';
    ELSE RAISE EXCEPTION 'Unsupported general affairs category kind: %', p_kind;
  END CASE;
END;
$$;


ALTER FUNCTION "public"."ga_category_table_name"("p_kind" "public"."ga_category_kind") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ga_is_active_equipment_category"("p_category_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM ga_equipment_categories c
    WHERE c.id = p_category_id
      AND c.deleted_at IS NULL
      AND c.is_active = true
      AND ga_category_has_active_path('equipment', c.id)
  );
$$;


ALTER FUNCTION "public"."ga_is_active_equipment_category"("p_category_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ga_is_active_facility_category"("p_category_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM ga_facility_categories c
    WHERE c.id = p_category_id
      AND c.deleted_at IS NULL
      AND c.is_active = true
      AND ga_category_has_active_path('facility', c.id)
  );
$$;


ALTER FUNCTION "public"."ga_is_active_facility_category"("p_category_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ga_is_active_part_category"("p_category_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM ga_part_categories c
    WHERE c.id = p_category_id
      AND c.deleted_at IS NULL
      AND c.is_active = true
      AND ga_category_has_active_path('part', c.id)
  );
$$;


ALTER FUNCTION "public"."ga_is_active_part_category"("p_category_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ga_is_store_active"("p_store_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM stores s
    WHERE s.id = p_store_id
      AND COALESCE(s.is_active, true) = true
      AND (to_jsonb(s) ->> 'deleted_at') IS NULL
  );
$$;


ALTER FUNCTION "public"."ga_is_store_active"("p_store_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ga_normalize_optional_text"("p_value" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  SELECT NULLIF(btrim(p_value), '');
$$;


ALTER FUNCTION "public"."ga_normalize_optional_text"("p_value" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ga_part_is_visible"("p_part_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM ga_parts p
    WHERE p.id = p_part_id
      AND p.deleted_at IS NULL
      AND (
        (
          p.is_active = true
          AND (
            current_user_has_permission('general_affairs.part.view')
            OR current_user_has_permission('general_affairs.part.manage')
            OR current_user_is_store_manager()
          )
        )
        OR current_user_has_permission('general_affairs.part.manage')
      )
  );
$$;


ALTER FUNCTION "public"."ga_part_is_visible"("p_part_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ga_soft_delete_category"("p_kind" "public"."ga_category_kind", "p_category_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_table TEXT;
  v_permission TEXT;
  v_user_id UUID;
  v_child_count INTEGER := 0;
  v_updated_count INTEGER := 0;
  v_deleted_at TIMESTAMPTZ := NOW();
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'status', 401,
      'error', '未登入'
    );
  END IF;

  v_table := ga_category_table_name(p_kind);
  v_permission := CASE p_kind
    WHEN 'equipment' THEN 'general_affairs.equipment_category.manage'
    WHEN 'facility' THEN 'general_affairs.facility_category.manage'
    WHEN 'part' THEN 'general_affairs.part_category.manage'
  END;

  IF NOT has_permission(v_user_id, v_permission) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'status', 403,
      'error', '沒有分類管理權限'
    );
  END IF;

  EXECUTE format(
    'SELECT count(*)::integer FROM %I WHERE parent_id = $1 AND deleted_at IS NULL',
    v_table
  )
  INTO v_child_count
  USING p_category_id;

  IF v_child_count > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'status', 409,
      'error', '此分類仍有未刪除子分類，請先移除或刪除子分類後再刪除',
      'active_children_count', v_child_count
    );
  END IF;

  EXECUTE format($sql$
    UPDATE %I
    SET
      is_active = false,
      deleted_at = $2,
      deleted_by = $3,
      updated_by = $3
    WHERE id = $1
      AND deleted_at IS NULL
  $sql$, v_table)
  USING p_category_id, v_deleted_at, v_user_id;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count = 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'status', 404,
      'error', '找不到可刪除的分類'
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 200,
    'data', jsonb_build_object(
      'id', p_category_id,
      'is_active', false,
      'deleted_at', v_deleted_at,
      'deleted_by', v_user_id,
      'updated_by', v_user_id
    )
  );
END;
$_$;


ALTER FUNCTION "public"."ga_soft_delete_category"("p_kind" "public"."ga_category_kind", "p_category_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ga_soft_delete_equipment"("p_equipment_id" "uuid", "p_deletion_reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_reason TEXT := ga_normalize_optional_text(p_deletion_reason);
  v_deleted_at TIMESTAMPTZ := NOW();
  v_updated_count INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入');
  END IF;

  IF NOT current_user_has_permission('general_affairs.equipment.manage') THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有設備管理權限');
  END IF;

  IF v_reason IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '請輸入刪除原因');
  END IF;

  UPDATE ga_equipment
  SET
    deleted_at = v_deleted_at,
    deleted_by = v_user_id,
    deletion_reason = v_reason,
    updated_by = v_user_id
  WHERE id = p_equipment_id
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'status', 404, 'error', '找不到可刪除的設備');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 200,
    'data', jsonb_build_object(
      'id', p_equipment_id,
      'deleted_at', v_deleted_at,
      'deleted_by', v_user_id,
      'deletion_reason', v_reason
    )
  );
END;
$$;


ALTER FUNCTION "public"."ga_soft_delete_equipment"("p_equipment_id" "uuid", "p_deletion_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ga_soft_delete_equipment_template"("p_template_id" "uuid", "p_deletion_reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_reason TEXT := ga_normalize_optional_text(p_deletion_reason);
  v_deleted_at TIMESTAMPTZ := NOW();
  v_updated_count INTEGER := 0;
  v_related_count INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入');
  END IF;

  IF NOT current_user_has_permission('general_affairs.equipment_template.manage') THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有設備範本管理權限');
  END IF;

  IF v_reason IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '請輸入刪除原因');
  END IF;

  SELECT count(*)::integer
  INTO v_related_count
  FROM ga_equipment
  WHERE template_id = p_template_id
    AND deleted_at IS NULL;

  UPDATE ga_equipment_templates
  SET
    is_active = false,
    deleted_at = v_deleted_at,
    deleted_by = v_user_id,
    deletion_reason = v_reason,
    updated_by = v_user_id
  WHERE id = p_template_id
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'status', 404, 'error', '找不到可刪除的設備範本');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 200,
    'data', jsonb_build_object(
      'id', p_template_id,
      'is_active', false,
      'deleted_at', v_deleted_at,
      'deleted_by', v_user_id,
      'deletion_reason', v_reason
    ),
    'warning', CASE
      WHEN v_related_count > 0 THEN jsonb_build_object(
        'code', 'TEMPLATE_HAS_EQUIPMENT_RELATIONS',
        'message', '此範本已有門市設備歷史關聯，系統會保留既有設備 template_id。',
        'related_equipment_count', v_related_count
      )
      ELSE NULL
    END
  );
END;
$$;


ALTER FUNCTION "public"."ga_soft_delete_equipment_template"("p_template_id" "uuid", "p_deletion_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ga_soft_delete_facility"("p_facility_id" "uuid", "p_reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_reason TEXT := ga_normalize_optional_text(p_reason);
  v_deleted_at TIMESTAMPTZ := NOW();
  v_updated_count INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入');
  END IF;

  IF NOT current_user_has_permission('general_affairs.facility.manage') THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有設施管理權限');
  END IF;

  IF v_reason IS NULL OR char_length(v_reason) < 2 THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '請輸入至少 2 個字的刪除原因');
  END IF;

  PERFORM set_config('app.ga_soft_delete_facility', 'true', true);

  UPDATE ga_facilities
  SET
    deleted_at = v_deleted_at,
    deleted_by = v_user_id,
    deletion_reason = v_reason,
    updated_by = v_user_id
  WHERE id = p_facility_id
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count = 0 THEN
    IF EXISTS (SELECT 1 FROM ga_facilities WHERE id = p_facility_id AND deleted_at IS NOT NULL) THEN
      RETURN jsonb_build_object('ok', false, 'status', 409, 'error', '此設施已被刪除');
    END IF;
    RETURN jsonb_build_object('ok', false, 'status', 404, 'error', '找不到設施');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 200,
    'data', jsonb_build_object(
      'id', p_facility_id,
      'deleted_at', v_deleted_at,
      'deleted_by', v_user_id,
      'deletion_reason', v_reason
    )
  );
END;
$$;


ALTER FUNCTION "public"."ga_soft_delete_facility"("p_facility_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ga_soft_delete_part"("p_part_id" "uuid", "p_reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_reason TEXT := ga_normalize_optional_text(p_reason);
  v_deleted_at TIMESTAMPTZ := NOW();
  v_updated_count INTEGER := 0;
  v_child_count INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入');
  END IF;

  IF NOT current_user_has_permission('general_affairs.part.manage') THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有料件管理權限');
  END IF;

  IF v_reason IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '請輸入刪除原因');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM ga_parts WHERE id = p_part_id) THEN
    RETURN jsonb_build_object('ok', false, 'status', 404, 'error', '找不到料件');
  END IF;

  IF EXISTS (SELECT 1 FROM ga_parts WHERE id = p_part_id AND deleted_at IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'error', '此料件已被刪除');
  END IF;

  PERFORM set_config('app.ga_soft_delete_part_compatibility', 'true', true);
  UPDATE ga_part_compatibilities
  SET
    deleted_at = v_deleted_at,
    deleted_by = v_user_id,
    deletion_reason = '父料件刪除衍生：' || v_reason,
    updated_by = v_user_id
  WHERE part_id = p_part_id
    AND deleted_at IS NULL;
  GET DIAGNOSTICS v_child_count = ROW_COUNT;

  PERFORM set_config('app.ga_soft_delete_part', 'true', true);
  UPDATE ga_parts
  SET
    is_active = false,
    deleted_at = v_deleted_at,
    deleted_by = v_user_id,
    deletion_reason = v_reason,
    updated_by = v_user_id
  WHERE id = p_part_id
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count = 0 THEN
    RAISE EXCEPTION '料件 soft delete 失敗，交易已中止';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 200,
    'data', jsonb_build_object(
      'id', p_part_id,
      'is_active', false,
      'deleted_at', v_deleted_at,
      'deleted_by', v_user_id,
      'deletion_reason', v_reason,
      'deleted_compatibilities', v_child_count
    )
  );
END;
$$;


ALTER FUNCTION "public"."ga_soft_delete_part"("p_part_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ga_soft_delete_part_compatibility"("p_compatibility_id" "uuid", "p_reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_reason TEXT := ga_normalize_optional_text(p_reason);
  v_deleted_at TIMESTAMPTZ := NOW();
  v_updated_count INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入');
  END IF;

  IF NOT current_user_has_permission('general_affairs.part.manage') THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有料件管理權限');
  END IF;

  IF v_reason IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '請輸入刪除原因');
  END IF;

  PERFORM set_config('app.ga_soft_delete_part_compatibility', 'true', true);

  UPDATE ga_part_compatibilities
  SET
    deleted_at = v_deleted_at,
    deleted_by = v_user_id,
    deletion_reason = v_reason,
    updated_by = v_user_id
  WHERE id = p_compatibility_id
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count = 0 THEN
    IF EXISTS (SELECT 1 FROM ga_part_compatibilities WHERE id = p_compatibility_id AND deleted_at IS NOT NULL) THEN
      RETURN jsonb_build_object('ok', false, 'status', 409, 'error', '此相容性資料已被刪除');
    END IF;
    RETURN jsonb_build_object('ok', false, 'status', 404, 'error', '找不到相容性資料');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 200,
    'data', jsonb_build_object(
      'id', p_compatibility_id,
      'deleted_at', v_deleted_at,
      'deleted_by', v_user_id,
      'deletion_reason', v_reason
    )
  );
END;
$$;


ALTER FUNCTION "public"."ga_soft_delete_part_compatibility"("p_compatibility_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ga_validate_category_tree"("p_kind" "public"."ga_category_kind", "p_category_id" "uuid", "p_parent_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_table TEXT := ga_category_table_name(p_kind);
  v_parent_exists BOOLEAN;
  v_parent_depth INTEGER := 0;
  v_descendant_depth INTEGER := 1;
  v_parent_is_descendant BOOLEAN := false;
BEGIN
  IF p_parent_id IS NULL THEN
    v_parent_depth := 0;
  ELSE
    IF p_parent_id = p_category_id THEN
      RAISE EXCEPTION '分類不可將自己設為父分類';
    END IF;

    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE id = $1 AND deleted_at IS NULL)', v_table)
    INTO v_parent_exists
    USING p_parent_id;

    IF NOT COALESCE(v_parent_exists, false) THEN
      RAISE EXCEPTION '父分類不存在或已刪除';
    END IF;

    v_parent_depth := ga_category_depth(p_kind, p_parent_id);
    IF v_parent_depth <= 0 THEN
      RAISE EXCEPTION '父分類層級無法判定';
    END IF;

    EXECUTE format($sql$
      WITH RECURSIVE descendants AS (
        SELECT id, parent_id, ARRAY[id] AS path
        FROM %I
        WHERE parent_id = $1
        UNION ALL
        SELECT c.id, c.parent_id, d.path || c.id
        FROM %I c
        JOIN descendants d ON c.parent_id = d.id
        WHERE NOT c.id = ANY(d.path)
      )
      SELECT EXISTS (SELECT 1 FROM descendants WHERE id = $2)
    $sql$, v_table, v_table)
    INTO v_parent_is_descendant
    USING p_category_id, p_parent_id;

    IF COALESCE(v_parent_is_descendant, false) THEN
      RAISE EXCEPTION '分類不可移動到自己的子分類底下';
    END IF;
  END IF;

  EXECUTE format($sql$
    WITH RECURSIVE descendants AS (
      SELECT id, parent_id, 1 AS depth, ARRAY[id] AS path
      FROM %I
      WHERE id = $1
      UNION ALL
      SELECT c.id, c.parent_id, d.depth + 1, d.path || c.id
      FROM %I c
      JOIN descendants d ON c.parent_id = d.id
      WHERE NOT c.id = ANY(d.path)
    )
    SELECT COALESCE(max(depth), 1) FROM descendants
  $sql$, v_table, v_table)
  INTO v_descendant_depth
  USING p_category_id;

  IF (v_parent_depth + v_descendant_depth) > 3 THEN
    RAISE EXCEPTION '分類最多只能建立三層';
  END IF;
END;
$_$;


ALTER FUNCTION "public"."ga_validate_category_tree"("p_kind" "public"."ga_category_kind", "p_category_id" "uuid", "p_parent_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ga_validate_equipment"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_category ga_equipment_categories%ROWTYPE;
  v_template RECORD;
  v_template_changed BOOLEAN := false;
BEGIN
  NEW.name := btrim(NEW.name);
  NEW.asset_code := ga_normalize_optional_text(NEW.asset_code);
  NEW.barcode := ga_normalize_optional_text(NEW.barcode);
  NEW.brand := ga_normalize_optional_text(NEW.brand);
  NEW.model := ga_normalize_optional_text(NEW.model);
  NEW.serial_number := ga_normalize_optional_text(NEW.serial_number);
  NEW.area := ga_normalize_optional_text(NEW.area);
  NEW.location_detail := ga_normalize_optional_text(NEW.location_detail);
  NEW.purpose := ga_normalize_optional_text(NEW.purpose);
  NEW.notes := ga_normalize_optional_text(NEW.notes);
  NEW.image_path := ga_normalize_optional_text(NEW.image_path);
  NEW.deletion_reason := ga_normalize_optional_text(NEW.deletion_reason);

  IF NEW.name IS NULL OR NEW.name = '' THEN
    RAISE EXCEPTION '請輸入設備名稱';
  END IF;

  IF NOT ga_is_store_active(NEW.store_id) THEN
    RAISE EXCEPTION '設備所屬門市必須存在且啟用';
  END IF;

  SELECT *
  INTO v_category
  FROM ga_equipment_categories
  WHERE id = NEW.category_id
    AND deleted_at IS NULL
    AND is_active = true;

  IF NOT FOUND OR NOT ga_category_has_active_path('equipment', NEW.category_id) THEN
    RAISE EXCEPTION '設備分類必須啟用、未刪除且祖先路徑有效';
  END IF;

  IF NEW.template_id IS NOT NULL THEN
    SELECT id, category_id, is_active, deleted_at
    INTO v_template
    FROM ga_equipment_templates
    WHERE id = NEW.template_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION '設備範本不存在';
    END IF;

    IF v_template.category_id IS DISTINCT FROM NEW.category_id THEN
      RAISE EXCEPTION '設備範本分類必須與設備分類一致';
    END IF;

    v_template_changed := TG_OP = 'INSERT' OR NEW.template_id IS DISTINCT FROM OLD.template_id;
    IF v_template_changed AND (v_template.deleted_at IS NOT NULL OR v_template.is_active = false) THEN
      RAISE EXCEPTION '新增或更換設備範本時，範本必須啟用且未刪除';
    END IF;
  END IF;

  IF v_category.requires_brand AND NEW.brand IS NULL THEN
    RAISE EXCEPTION '此設備分類要求填寫品牌';
  END IF;

  IF v_category.requires_model AND NEW.model IS NULL THEN
    RAISE EXCEPTION '此設備分類要求填寫型號';
  END IF;

  IF v_category.requires_serial_number AND NEW.serial_number IS NULL THEN
    RAISE EXCEPTION '此設備分類要求填寫序號';
  END IF;

  IF NEW.purchase_amount IS NOT NULL AND NEW.purchase_amount < 0 THEN
    RAISE EXCEPTION '購買金額不可為負數';
  END IF;

  IF jsonb_typeof(NEW.specs) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION '設備 specs 必須是 JSON object';
  END IF;

  IF NEW.has_warranty = false AND NEW.warranty_end_date IS NOT NULL THEN
    RAISE EXCEPTION '無保固時 warranty_end_date 必須為 NULL';
  END IF;

  IF NEW.image_path IS NOT NULL AND (
    NEW.image_path ~* '^[a-z][a-z0-9+.-]*:'
    OR NEW.image_path ~ E'\\\\'
    OR NEW.image_path ~ '(^|/)\.\.(/|$)'
    OR NEW.image_path ~ '^/'
  ) THEN
    RAISE EXCEPTION '設備 image_path 僅可保存安全的相對 Storage Path';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.updated_by := auth.uid();
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.created_at := OLD.created_at;
    NEW.created_by := OLD.created_by;
    NEW.updated_at := NOW();
    NEW.updated_by := auth.uid();
  END IF;

  RETURN NEW;
END;
$_$;


ALTER FUNCTION "public"."ga_validate_equipment"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ga_validate_equipment_template"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
BEGIN
  NEW.name := btrim(NEW.name);
  NEW.brand := ga_normalize_optional_text(NEW.brand);
  NEW.model := ga_normalize_optional_text(NEW.model);
  NEW.description := ga_normalize_optional_text(NEW.description);
  NEW.image_path := ga_normalize_optional_text(NEW.image_path);
  NEW.deletion_reason := ga_normalize_optional_text(NEW.deletion_reason);

  IF NEW.name IS NULL OR NEW.name = '' THEN
    RAISE EXCEPTION '請輸入設備範本名稱';
  END IF;

  IF NOT ga_is_active_equipment_category(NEW.category_id) THEN
    RAISE EXCEPTION '設備範本分類必須啟用、未刪除且祖先路徑有效';
  END IF;

  IF jsonb_typeof(NEW.specs) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION '設備範本 specs 必須是 JSON object';
  END IF;

  IF jsonb_typeof(NEW.default_fields) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION '設備範本 default_fields 必須是 JSON object';
  END IF;

  IF NEW.default_warranty_months IS NOT NULL AND NEW.default_warranty_months < 0 THEN
    RAISE EXCEPTION '設備範本預設保固月數不可為負數';
  END IF;

  IF NEW.image_path IS NOT NULL AND (
    NEW.image_path ~* '^[a-z][a-z0-9+.-]*:'
    OR NEW.image_path ~ E'\\\\'
    OR NEW.image_path ~ '(^|/)\.\.(/|$)'
    OR NEW.image_path ~ '^/'
  ) THEN
    RAISE EXCEPTION '設備範本 image_path 僅可保存安全的相對 Storage Path';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.updated_by := auth.uid();
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.created_at := OLD.created_at;
    NEW.created_by := OLD.created_by;
    NEW.updated_at := NOW();
    NEW.updated_by := auth.uid();
  END IF;

  RETURN NEW;
END;
$_$;


ALTER FUNCTION "public"."ga_validate_equipment_template"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ga_validate_facility"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_is_soft_delete BOOLEAN := COALESCE(current_setting('app.ga_soft_delete_facility', true), '') = 'true';
BEGIN
  NEW.name := btrim(NEW.name);
  NEW.facility_code := upper(ga_normalize_optional_text(NEW.facility_code));
  NEW.area := ga_normalize_optional_text(NEW.area);
  NEW.location_detail := ga_normalize_optional_text(NEW.location_detail);
  NEW.unit := ga_normalize_optional_text(NEW.unit);
  NEW.description := ga_normalize_optional_text(NEW.description);
  NEW.image_path := ga_normalize_optional_text(NEW.image_path);
  NEW.notes := ga_normalize_optional_text(NEW.notes);

  IF NEW.name IS NULL OR NEW.name = '' THEN
    RAISE EXCEPTION '請輸入設施名稱';
  END IF;

  IF NOT ga_is_store_active(NEW.store_id) THEN
    RAISE EXCEPTION '設施所屬門市必須存在且啟用';
  END IF;

  IF NOT ga_is_active_facility_category(NEW.category_id) THEN
    RAISE EXCEPTION '設施分類必須啟用、未刪除且祖先路徑有效';
  END IF;

  IF jsonb_typeof(NEW.specs) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION '設施 specs 必須是 JSON object';
  END IF;

  IF (NEW.quantity IS NULL AND NEW.unit IS NOT NULL)
    OR (NEW.quantity IS NOT NULL AND (NEW.quantity <= 0 OR NEW.unit IS NULL)) THEN
    RAISE EXCEPTION 'quantity 與 unit 必須一起填寫，且 quantity 必須大於 0';
  END IF;

  IF NEW.image_path IS NOT NULL AND (
    NEW.image_path ~* '^[a-z][a-z0-9+.-]*:'
    OR NEW.image_path ~ E'\\\\'
    OR NEW.image_path ~ '(^|/)\.\.(/|$)'
    OR NEW.image_path ~ '^/'
  ) THEN
    RAISE EXCEPTION '設施 image_path 僅可保存安全的相對 Storage Path';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_at := NOW();
    NEW.created_by := auth.uid();
    NEW.updated_at := NOW();
    NEW.updated_by := auth.uid();
    NEW.deleted_at := NULL;
    NEW.deleted_by := NULL;
    NEW.deletion_reason := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.created_at := OLD.created_at;
    NEW.created_by := OLD.created_by;
    NEW.updated_at := NOW();
    NEW.updated_by := auth.uid();

    IF v_is_soft_delete THEN
      IF OLD.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION '此設施已被刪除';
      END IF;
      IF NEW.deleted_at IS NULL OR NEW.deleted_by IS NULL OR NEW.deletion_reason IS NULL THEN
        RAISE EXCEPTION 'soft delete 必須設定 deleted_at、deleted_by 與 deletion_reason';
      END IF;
    ELSIF OLD.deleted_at IS NULL THEN
      NEW.deleted_at := NULL;
      NEW.deleted_by := NULL;
      NEW.deletion_reason := NULL;
    ELSE
      NEW.deleted_at := OLD.deleted_at;
      NEW.deleted_by := OLD.deleted_by;
      NEW.deletion_reason := OLD.deletion_reason;
    END IF;
  END IF;

  RETURN NEW;
END;
$_$;


ALTER FUNCTION "public"."ga_validate_facility"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ga_validate_part"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_is_soft_delete BOOLEAN := COALESCE(current_setting('app.ga_soft_delete_part', true), '') = 'true';
BEGIN
  NEW.name := btrim(NEW.name);
  NEW.part_code := upper(ga_normalize_optional_text(NEW.part_code));
  NEW.barcode := ga_normalize_optional_text(NEW.barcode);
  NEW.brand := ga_normalize_optional_text(NEW.brand);
  NEW.model := ga_normalize_optional_text(NEW.model);
  NEW.specification := ga_normalize_optional_text(NEW.specification);
  NEW.description := ga_normalize_optional_text(NEW.description);
  NEW.base_unit := btrim(NEW.base_unit);
  NEW.purchase_unit := ga_normalize_optional_text(NEW.purchase_unit);
  NEW.image_path := ga_normalize_optional_text(NEW.image_path);
  NEW.notes := ga_normalize_optional_text(NEW.notes);

  IF NEW.name IS NULL OR NEW.name = '' THEN
    RAISE EXCEPTION '請輸入料件名稱';
  END IF;

  IF NEW.base_unit IS NULL OR NEW.base_unit = '' THEN
    RAISE EXCEPTION '請輸入基本庫存單位';
  END IF;

  IF NOT ga_is_active_part_category(NEW.category_id) THEN
    RAISE EXCEPTION '料件分類必須啟用、未刪除且祖先路徑有效';
  END IF;

  IF jsonb_typeof(NEW.specs) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION '料件 specs 必須是 JSON object';
  END IF;

  IF NEW.purchase_unit IS NULL AND NEW.purchase_to_base_rate IS NOT NULL THEN
    RAISE EXCEPTION '未填採購單位時，purchase_to_base_rate 必須為 NULL';
  END IF;

  IF NEW.purchase_unit IS NOT NULL THEN
    IF upper(NEW.purchase_unit) = upper(NEW.base_unit) THEN
      NEW.purchase_to_base_rate := 1;
    ELSIF NEW.purchase_to_base_rate IS NULL OR NEW.purchase_to_base_rate <= 0 THEN
      RAISE EXCEPTION '填寫採購單位時，purchase_to_base_rate 必須大於 0';
    END IF;
  END IF;

  IF NEW.minimum_issue_qty <= 0 THEN
    RAISE EXCEPTION '最小領用量必須大於 0';
  END IF;

  IF NEW.allow_fractional_issue = false AND trunc(NEW.minimum_issue_qty) <> NEW.minimum_issue_qty THEN
    RAISE EXCEPTION '不允許小數領用時，最小領用量必須為整數';
  END IF;

  IF NEW.image_path IS NOT NULL AND (
    NEW.image_path ~* '^[a-z][a-z0-9+.-]*:'
    OR NEW.image_path ~ E'\\\\'
    OR NEW.image_path ~ '(^|/)\.\.(/|$)'
    OR NEW.image_path ~ '^/'
  ) THEN
    RAISE EXCEPTION '料件 image_path 僅可保存安全的相對 Storage Path';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_at := NOW();
    NEW.created_by := auth.uid();
    NEW.updated_at := NOW();
    NEW.updated_by := auth.uid();
    NEW.deleted_at := NULL;
    NEW.deleted_by := NULL;
    NEW.deletion_reason := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.created_at := OLD.created_at;
    NEW.created_by := OLD.created_by;
    NEW.updated_at := NOW();
    NEW.updated_by := auth.uid();

    IF v_is_soft_delete THEN
      IF OLD.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION '此料件已被刪除';
      END IF;
      IF NEW.deleted_at IS NULL OR NEW.deleted_by IS NULL OR NEW.deletion_reason IS NULL THEN
        RAISE EXCEPTION 'soft delete 必須設定 deleted_at、deleted_by 與 deletion_reason';
      END IF;
      NEW.is_active := false;
    ELSIF OLD.deleted_at IS NULL THEN
      NEW.deleted_at := NULL;
      NEW.deleted_by := NULL;
      NEW.deletion_reason := NULL;
    ELSE
      NEW.deleted_at := OLD.deleted_at;
      NEW.deleted_by := OLD.deleted_by;
      NEW.deletion_reason := OLD.deletion_reason;
    END IF;
  END IF;

  RETURN NEW;
END;
$_$;


ALTER FUNCTION "public"."ga_validate_part"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ga_validate_part_compatibility"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_is_soft_delete BOOLEAN := COALESCE(current_setting('app.ga_soft_delete_part_compatibility', true), '') = 'true';
  v_template RECORD;
  v_template_changed BOOLEAN := false;
BEGIN
  NEW.compatibility_type := upper(btrim(NEW.compatibility_type));
  NEW.vendor_name := ga_normalize_optional_text(NEW.vendor_name);
  NEW.series_name := ga_normalize_optional_text(NEW.series_name);
  NEW.brand := ga_normalize_optional_text(NEW.brand);
  NEW.model := ga_normalize_optional_text(NEW.model);
  NEW.notes := ga_normalize_optional_text(NEW.notes);

  IF NOT EXISTS (
    SELECT 1
    FROM ga_parts p
    WHERE p.id = NEW.part_id
      AND p.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION '相容性所屬料件必須存在且未刪除';
  END IF;

  IF NEW.compatibility_type = 'EQUIPMENT_TEMPLATE' THEN
    IF NEW.equipment_template_id IS NULL THEN
      RAISE EXCEPTION '設備範本相容性必須選擇設備範本';
    END IF;
    IF NEW.vendor_name IS NOT NULL OR NEW.series_name IS NOT NULL OR NEW.brand IS NOT NULL OR NEW.model IS NOT NULL THEN
      RAISE EXCEPTION '設備範本相容性不可填寫廠商、系列、品牌或型號欄位';
    END IF;

    SELECT id, is_active, deleted_at
    INTO v_template
    FROM ga_equipment_templates
    WHERE id = NEW.equipment_template_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION '相容設備範本不存在';
    END IF;

    v_template_changed := TG_OP = 'INSERT' OR NEW.equipment_template_id IS DISTINCT FROM OLD.equipment_template_id;
    IF v_template_changed AND (v_template.deleted_at IS NOT NULL OR v_template.is_active = false) THEN
      RAISE EXCEPTION '新增或更換相容設備範本時，範本必須啟用且未刪除';
    END IF;
  ELSIF NEW.compatibility_type = 'VENDOR_SERIES' THEN
    IF NEW.vendor_name IS NULL THEN
      RAISE EXCEPTION '廠商系列相容性必須填寫廠商名稱';
    END IF;
    IF NEW.equipment_template_id IS NOT NULL OR NEW.brand IS NOT NULL OR NEW.model IS NOT NULL THEN
      RAISE EXCEPTION '廠商系列相容性不可填寫設備範本、品牌或型號欄位';
    END IF;
  ELSIF NEW.compatibility_type = 'BRAND_MODEL' THEN
    IF NEW.brand IS NULL THEN
      RAISE EXCEPTION '品牌型號相容性必須填寫品牌';
    END IF;
    IF NEW.equipment_template_id IS NOT NULL OR NEW.vendor_name IS NOT NULL OR NEW.series_name IS NOT NULL THEN
      RAISE EXCEPTION '品牌型號相容性不可填寫設備範本、廠商或系列欄位';
    END IF;
  ELSE
    RAISE EXCEPTION '相容性類型錯誤';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_at := NOW();
    NEW.created_by := auth.uid();
    NEW.updated_at := NOW();
    NEW.updated_by := auth.uid();
    NEW.deleted_at := NULL;
    NEW.deleted_by := NULL;
    NEW.deletion_reason := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.created_at := OLD.created_at;
    NEW.created_by := OLD.created_by;
    NEW.updated_at := NOW();
    NEW.updated_by := auth.uid();

    IF v_is_soft_delete THEN
      IF OLD.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION '此相容性資料已被刪除';
      END IF;
      IF NEW.deleted_at IS NULL OR NEW.deleted_by IS NULL OR NEW.deletion_reason IS NULL THEN
        RAISE EXCEPTION 'soft delete 必須設定 deleted_at、deleted_by 與 deletion_reason';
      END IF;
    ELSIF OLD.deleted_at IS NULL THEN
      NEW.deleted_at := NULL;
      NEW.deleted_by := NULL;
      NEW.deletion_reason := NULL;
    ELSE
      NEW.deleted_at := OLD.deleted_at;
      NEW.deleted_by := OLD.deleted_by;
      NEW.deletion_reason := OLD.deletion_reason;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."ga_validate_part_compatibility"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_permissions"("p_user_id" "uuid") RETURNS TABLE("permission_code" character varying)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF p_user_id IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT DISTINCT p.code::VARCHAR
  FROM public.user_roles ur
  JOIN public.roles r ON r.id = ur.role_id
  JOIN public.role_permissions rp ON rp.role_id = ur.role_id
  JOIN public.permissions p ON p.id = rp.permission_id
  WHERE ur.user_id = p_user_id
    AND ur.is_active = true
    AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
    AND r.is_active = true
    AND rp.is_allowed = true
    AND p.is_active = true
  ORDER BY p.code;
END;
$$;


ALTER FUNCTION "public"."get_user_permissions"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(public.profiles.full_name, EXCLUDED.full_name);

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_permission"("p_user_id" "uuid", "p_permission_code" character varying) RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_has_permission BOOLEAN := false;
BEGIN
  IF p_user_id IS NULL OR p_permission_code IS NULL OR btrim(p_permission_code) = '' THEN
    RETURN false;
  END IF;

  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
    RETURN false;
  END IF;

  -- Admin bypass is RBAC-based only. No email whitelist and no profiles.role trust.
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = p_user_id
      AND ur.is_active = true
      AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
      AND r.is_active = true
      AND r.code = 'admin'
  ) INTO v_has_permission;

  IF v_has_permission THEN
    RETURN true;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    JOIN public.role_permissions rp ON rp.role_id = ur.role_id
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = p_user_id
      AND ur.is_active = true
      AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
      AND r.is_active = true
      AND rp.is_allowed = true
      AND p.is_active = true
      AND p.code = p_permission_code
  ) INTO v_has_permission;

  RETURN COALESCE(v_has_permission, false);
END;
$$;


ALTER FUNCTION "public"."has_permission"("p_user_id" "uuid", "p_permission_code" character varying) OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."ga_equipment" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "store_id" "uuid" NOT NULL,
    "category_id" "uuid" NOT NULL,
    "template_id" "uuid",
    "name" "text" NOT NULL,
    "asset_code" "text",
    "barcode" "text",
    "brand" "text",
    "model" "text",
    "serial_number" "text",
    "status" "text" DEFAULT 'ACTIVE'::"text" NOT NULL,
    "criticality" "text" DEFAULT 'NORMAL'::"text" NOT NULL,
    "area" "text",
    "location_detail" "text",
    "purpose" "text",
    "installed_at" "date",
    "purchased_at" "date",
    "activated_at" "date",
    "purchase_amount" numeric(12,2),
    "specs" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "tags" "text"[] DEFAULT ARRAY[]::"text"[] NOT NULL,
    "notes" "text",
    "has_warranty" boolean DEFAULT false NOT NULL,
    "warranty_end_date" "date",
    "image_path" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid",
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "deletion_reason" "text",
    CONSTRAINT "ga_equipment_criticality_check" CHECK (("criticality" = ANY (ARRAY['LOW'::"text", 'NORMAL'::"text", 'HIGH'::"text", 'CRITICAL'::"text"]))),
    CONSTRAINT "ga_equipment_image_path_relative" CHECK ((("image_path" IS NULL) OR (("image_path" = "btrim"("image_path")) AND ("image_path" !~* '^[a-z][a-z0-9+.-]*:'::"text") AND ("image_path" !~ '\\'::"text") AND ("image_path" !~ '(^|/)\.\.(/|$)'::"text") AND ("image_path" !~ '^/'::"text")))),
    CONSTRAINT "ga_equipment_name_check" CHECK (("btrim"("name") <> ''::"text")),
    CONSTRAINT "ga_equipment_purchase_amount_nonnegative" CHECK ((("purchase_amount" IS NULL) OR ("purchase_amount" >= (0)::numeric))),
    CONSTRAINT "ga_equipment_specs_object" CHECK (("jsonb_typeof"("specs") = 'object'::"text")),
    CONSTRAINT "ga_equipment_status_check" CHECK (("status" = ANY (ARRAY['ACTIVE'::"text", 'TEMPORARILY_STOPPED'::"text", 'SPARE'::"text", 'RETIRED'::"text", 'SCRAPPED'::"text"]))),
    CONSTRAINT "ga_equipment_warranty_date_rule" CHECK ((("has_warranty" = true) OR ("warranty_end_date" IS NULL)))
);


ALTER TABLE "public"."ga_equipment" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ga_equipment_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "parent_id" "uuid",
    "name" "text" NOT NULL,
    "code" "text" NOT NULL,
    "description" "text",
    "icon_key" "text",
    "sort_order" integer DEFAULT 10 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid",
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "requires_brand" boolean DEFAULT false NOT NULL,
    "requires_model" boolean DEFAULT false NOT NULL,
    "requires_serial_number" boolean DEFAULT false NOT NULL,
    "requires_warranty" boolean DEFAULT false NOT NULL,
    "default_fields" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "ga_equipment_categories_code_check" CHECK ((("btrim"("code") <> ''::"text") AND ("code" = "upper"("btrim"("code"))))),
    CONSTRAINT "ga_equipment_categories_default_fields_object" CHECK (("jsonb_typeof"("default_fields") = 'object'::"text")),
    CONSTRAINT "ga_equipment_categories_name_check" CHECK (("btrim"("name") <> ''::"text"))
);


ALTER TABLE "public"."ga_equipment_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ga_equipment_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "category_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "brand" "text",
    "model" "text",
    "description" "text",
    "specs" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "default_fields" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "default_warranty_months" integer,
    "image_path" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid",
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "deletion_reason" "text",
    CONSTRAINT "ga_equipment_templates_default_fields_object" CHECK (("jsonb_typeof"("default_fields") = 'object'::"text")),
    CONSTRAINT "ga_equipment_templates_image_path_relative" CHECK ((("image_path" IS NULL) OR (("image_path" = "btrim"("image_path")) AND ("image_path" !~* '^[a-z][a-z0-9+.-]*:'::"text") AND ("image_path" !~ '\\'::"text") AND ("image_path" !~ '(^|/)\.\.(/|$)'::"text") AND ("image_path" !~ '^/'::"text")))),
    CONSTRAINT "ga_equipment_templates_name_check" CHECK (("btrim"("name") <> ''::"text")),
    CONSTRAINT "ga_equipment_templates_specs_object" CHECK (("jsonb_typeof"("specs") = 'object'::"text")),
    CONSTRAINT "ga_equipment_templates_warranty_months_nonnegative" CHECK ((("default_warranty_months" IS NULL) OR ("default_warranty_months" >= 0)))
);


ALTER TABLE "public"."ga_equipment_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ga_facilities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "store_id" "uuid" NOT NULL,
    "category_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "facility_code" "text",
    "status" "text" DEFAULT 'ACTIVE'::"text" NOT NULL,
    "criticality" "text" DEFAULT 'NORMAL'::"text" NOT NULL,
    "area" "text",
    "location_detail" "text",
    "quantity" numeric(12,3),
    "unit" "text",
    "is_fixed_asset" boolean DEFAULT true NOT NULL,
    "installed_at" "date",
    "last_renovated_at" "date",
    "description" "text",
    "specs" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "tags" "text"[] DEFAULT ARRAY[]::"text"[] NOT NULL,
    "image_path" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid",
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "deletion_reason" "text",
    CONSTRAINT "ga_facilities_criticality_check" CHECK (("criticality" = ANY (ARRAY['LOW'::"text", 'NORMAL'::"text", 'HIGH'::"text", 'CRITICAL'::"text"]))),
    CONSTRAINT "ga_facilities_image_path_relative" CHECK ((("image_path" IS NULL) OR (("image_path" = "btrim"("image_path")) AND ("image_path" !~* '^[a-z][a-z0-9+.-]*:'::"text") AND ("image_path" !~ '\\'::"text") AND ("image_path" !~ '(^|/)\.\.(/|$)'::"text") AND ("image_path" !~ '^/'::"text")))),
    CONSTRAINT "ga_facilities_name_check" CHECK (("btrim"("name") <> ''::"text")),
    CONSTRAINT "ga_facilities_quantity_unit_pair" CHECK (((("quantity" IS NULL) AND ("unit" IS NULL)) OR (("quantity" > (0)::numeric) AND ("unit" IS NOT NULL) AND ("btrim"("unit") <> ''::"text")))),
    CONSTRAINT "ga_facilities_specs_object" CHECK (("jsonb_typeof"("specs") = 'object'::"text")),
    CONSTRAINT "ga_facilities_status_check" CHECK (("status" = ANY (ARRAY['ACTIVE'::"text", 'PARTIALLY_DAMAGED'::"text", 'OUT_OF_SERVICE'::"text", 'UNDER_RENOVATION'::"text", 'RETIRED'::"text"])))
);


ALTER TABLE "public"."ga_facilities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ga_facility_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "parent_id" "uuid",
    "name" "text" NOT NULL,
    "code" "text" NOT NULL,
    "description" "text",
    "icon_key" "text",
    "sort_order" integer DEFAULT 10 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid",
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "default_issue_fields" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "ga_facility_categories_code_check" CHECK ((("btrim"("code") <> ''::"text") AND ("code" = "upper"("btrim"("code"))))),
    CONSTRAINT "ga_facility_categories_default_issue_fields_object" CHECK (("jsonb_typeof"("default_issue_fields") = 'object'::"text")),
    CONSTRAINT "ga_facility_categories_name_check" CHECK (("btrim"("name") <> ''::"text"))
);


ALTER TABLE "public"."ga_facility_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ga_part_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "parent_id" "uuid",
    "name" "text" NOT NULL,
    "code" "text" NOT NULL,
    "description" "text",
    "icon_key" "text",
    "sort_order" integer DEFAULT 10 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid",
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "spec_schema" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "default_base_unit" "text",
    "is_recyclable_default" boolean DEFAULT false NOT NULL,
    "manage_compatibility" boolean DEFAULT false NOT NULL,
    CONSTRAINT "ga_part_categories_code_check" CHECK ((("btrim"("code") <> ''::"text") AND ("code" = "upper"("btrim"("code"))))),
    CONSTRAINT "ga_part_categories_name_check" CHECK (("btrim"("name") <> ''::"text")),
    CONSTRAINT "ga_part_categories_spec_schema_array" CHECK (("jsonb_typeof"("spec_schema") = 'array'::"text"))
);


ALTER TABLE "public"."ga_part_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ga_part_compatibilities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "part_id" "uuid" NOT NULL,
    "compatibility_type" "text" NOT NULL,
    "equipment_template_id" "uuid",
    "vendor_name" "text",
    "series_name" "text",
    "brand" "text",
    "model" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid",
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "deletion_reason" "text",
    CONSTRAINT "ga_part_compatibilities_type_check" CHECK (("compatibility_type" = ANY (ARRAY['EQUIPMENT_TEMPLATE'::"text", 'VENDOR_SERIES'::"text", 'BRAND_MODEL'::"text"])))
);


ALTER TABLE "public"."ga_part_compatibilities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ga_parts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "category_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "part_code" "text",
    "barcode" "text",
    "brand" "text",
    "model" "text",
    "specification" "text",
    "description" "text",
    "base_unit" "text" NOT NULL,
    "purchase_unit" "text",
    "purchase_to_base_rate" numeric(12,4),
    "minimum_issue_qty" numeric(12,4) DEFAULT 1 NOT NULL,
    "allow_fractional_issue" boolean DEFAULT false NOT NULL,
    "allow_unpacking" boolean DEFAULT false NOT NULL,
    "image_path" "text",
    "specs" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "tags" "text"[] DEFAULT ARRAY[]::"text"[] NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid",
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "deletion_reason" "text",
    CONSTRAINT "ga_parts_base_unit_check" CHECK (("btrim"("base_unit") <> ''::"text")),
    CONSTRAINT "ga_parts_image_path_relative" CHECK ((("image_path" IS NULL) OR (("image_path" = "btrim"("image_path")) AND ("image_path" !~* '^[a-z][a-z0-9+.-]*:'::"text") AND ("image_path" !~ '\\'::"text") AND ("image_path" !~ '(^|/)\.\.(/|$)'::"text") AND ("image_path" !~ '^/'::"text")))),
    CONSTRAINT "ga_parts_minimum_issue_qty_integer_when_required" CHECK ((("allow_fractional_issue" = true) OR ("trunc"("minimum_issue_qty") = "minimum_issue_qty"))),
    CONSTRAINT "ga_parts_minimum_issue_qty_positive" CHECK (("minimum_issue_qty" > (0)::numeric)),
    CONSTRAINT "ga_parts_name_check" CHECK (("btrim"("name") <> ''::"text")),
    CONSTRAINT "ga_parts_purchase_unit_rate_pair" CHECK (((("purchase_unit" IS NULL) AND ("purchase_to_base_rate" IS NULL)) OR (("purchase_unit" IS NOT NULL) AND ("btrim"("purchase_unit") <> ''::"text") AND ("purchase_to_base_rate" > (0)::numeric)))),
    CONSTRAINT "ga_parts_specs_object" CHECK (("jsonb_typeof"("specs") = 'object'::"text"))
);


ALTER TABLE "public"."ga_parts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."permissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "module" character varying(50) NOT NULL,
    "feature" character varying(100) NOT NULL,
    "code" character varying(100) NOT NULL,
    "action" character varying(50) NOT NULL,
    "description" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "email" "text",
    "full_name" "text",
    "role" "text" DEFAULT 'member'::"text",
    "department" "text",
    "job_title" "text",
    "employee_code" character varying(20),
    "avatar_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."role_permissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "role_id" "uuid" NOT NULL,
    "permission_id" "uuid" NOT NULL,
    "is_allowed" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid"
);


ALTER TABLE "public"."role_permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" character varying(100) NOT NULL,
    "code" character varying(50) NOT NULL,
    "description" "text",
    "is_system" boolean DEFAULT false NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid"
);


ALTER TABLE "public"."roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."store_managers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "store_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role_type" character varying(20) NOT NULL,
    "is_primary" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "store_managers_role_type_check" CHECK ((("role_type")::"text" = ANY ((ARRAY['store_manager'::character varying, 'supervisor'::character varying, 'area_manager'::character varying])::"text"[])))
);


ALTER TABLE "public"."store_managers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stores" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "store_code" character varying(20) NOT NULL,
    "store_name" character varying(100) NOT NULL,
    "address" "text",
    "phone" character varying(20),
    "is_active" boolean DEFAULT true NOT NULL,
    "short_name" "text",
    "hr_store_code" "text",
    "manager_name" "text",
    "is_franchise" boolean DEFAULT false NOT NULL,
    "source_store_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."stores" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role_id" "uuid" NOT NULL,
    "employee_code" character varying(20),
    "is_active" boolean DEFAULT true NOT NULL,
    "assigned_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "assigned_by" "uuid",
    "expires_at" timestamp with time zone
);


ALTER TABLE "public"."user_roles" OWNER TO "postgres";


ALTER TABLE ONLY "public"."ga_equipment_categories"
    ADD CONSTRAINT "ga_equipment_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ga_equipment"
    ADD CONSTRAINT "ga_equipment_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ga_equipment_templates"
    ADD CONSTRAINT "ga_equipment_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ga_facilities"
    ADD CONSTRAINT "ga_facilities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ga_facility_categories"
    ADD CONSTRAINT "ga_facility_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ga_part_categories"
    ADD CONSTRAINT "ga_part_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ga_part_compatibilities"
    ADD CONSTRAINT "ga_part_compatibilities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ga_parts"
    ADD CONSTRAINT "ga_parts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."permissions"
    ADD CONSTRAINT "permissions_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."permissions"
    ADD CONSTRAINT "permissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_role_id_permission_id_key" UNIQUE ("role_id", "permission_id");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."store_managers"
    ADD CONSTRAINT "store_managers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."store_managers"
    ADD CONSTRAINT "store_managers_store_id_user_id_role_type_key" UNIQUE ("store_id", "user_id", "role_type");



ALTER TABLE ONLY "public"."stores"
    ADD CONSTRAINT "stores_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stores"
    ADD CONSTRAINT "stores_store_code_key" UNIQUE ("store_code");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_role_id_key" UNIQUE ("user_id", "role_id");



CREATE INDEX "idx_ga_equipment_categories_active_sort" ON "public"."ga_equipment_categories" USING "btree" ("is_active", "sort_order", "name");



CREATE INDEX "idx_ga_equipment_categories_deleted" ON "public"."ga_equipment_categories" USING "btree" ("deleted_at");



CREATE INDEX "idx_ga_equipment_categories_parent" ON "public"."ga_equipment_categories" USING "btree" ("parent_id");



CREATE INDEX "idx_ga_equipment_category" ON "public"."ga_equipment" USING "btree" ("category_id");



CREATE INDEX "idx_ga_equipment_search" ON "public"."ga_equipment" USING "btree" ("upper"("name"), "upper"(COALESCE("brand", ''::"text")), "upper"(COALESCE("model", ''::"text")), "upper"(COALESCE("asset_code", ''::"text")), "upper"(COALESCE("barcode", ''::"text")), "upper"(COALESCE("serial_number", ''::"text")));



CREATE INDEX "idx_ga_equipment_status" ON "public"."ga_equipment" USING "btree" ("status", "deleted_at");



CREATE INDEX "idx_ga_equipment_store" ON "public"."ga_equipment" USING "btree" ("store_id");



CREATE INDEX "idx_ga_equipment_template" ON "public"."ga_equipment" USING "btree" ("template_id");



CREATE INDEX "idx_ga_equipment_templates_active" ON "public"."ga_equipment_templates" USING "btree" ("is_active", "deleted_at", "name");



CREATE INDEX "idx_ga_equipment_templates_category" ON "public"."ga_equipment_templates" USING "btree" ("category_id");



CREATE INDEX "idx_ga_equipment_templates_search" ON "public"."ga_equipment_templates" USING "btree" ("upper"("name"), "upper"(COALESCE("brand", ''::"text")), "upper"(COALESCE("model", ''::"text")));



CREATE INDEX "idx_ga_facilities_area" ON "public"."ga_facilities" USING "btree" ("upper"(COALESCE("area", ''::"text"))) WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_ga_facilities_category" ON "public"."ga_facilities" USING "btree" ("category_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_ga_facilities_duplicate_hint" ON "public"."ga_facilities" USING "btree" ("store_id", "category_id", "upper"("btrim"("name")), "upper"(COALESCE("area", ''::"text")), "upper"(COALESCE("location_detail", ''::"text"))) WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_ga_facilities_search" ON "public"."ga_facilities" USING "btree" ("upper"("name"), "upper"(COALESCE("facility_code", ''::"text")), "upper"(COALESCE("area", ''::"text")), "upper"(COALESCE("location_detail", ''::"text"))) WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_ga_facilities_status" ON "public"."ga_facilities" USING "btree" ("status") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_ga_facilities_store" ON "public"."ga_facilities" USING "btree" ("store_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_ga_facility_categories_active_sort" ON "public"."ga_facility_categories" USING "btree" ("is_active", "sort_order", "name");



CREATE INDEX "idx_ga_facility_categories_deleted" ON "public"."ga_facility_categories" USING "btree" ("deleted_at");



CREATE INDEX "idx_ga_facility_categories_parent" ON "public"."ga_facility_categories" USING "btree" ("parent_id");



CREATE INDEX "idx_ga_part_categories_active_sort" ON "public"."ga_part_categories" USING "btree" ("is_active", "sort_order", "name");



CREATE INDEX "idx_ga_part_categories_deleted" ON "public"."ga_part_categories" USING "btree" ("deleted_at");



CREATE INDEX "idx_ga_part_categories_parent" ON "public"."ga_part_categories" USING "btree" ("parent_id");



CREATE INDEX "idx_ga_part_compatibilities_part" ON "public"."ga_part_compatibilities" USING "btree" ("part_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_ga_parts_active" ON "public"."ga_parts" USING "btree" ("is_active", "deleted_at", "name");



CREATE INDEX "idx_ga_parts_brand" ON "public"."ga_parts" USING "btree" ("upper"(COALESCE("brand", ''::"text"))) WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_ga_parts_category" ON "public"."ga_parts" USING "btree" ("category_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_ga_parts_duplicate_hint" ON "public"."ga_parts" USING "btree" ("upper"(COALESCE("brand", ''::"text")), "upper"(COALESCE("model", ''::"text")), "upper"(COALESCE("specification", ''::"text"))) WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_ga_parts_search" ON "public"."ga_parts" USING "btree" ("upper"("name"), "upper"(COALESCE("part_code", ''::"text")), "upper"(COALESCE("barcode", ''::"text")), "upper"(COALESCE("brand", ''::"text")), "upper"(COALESCE("model", ''::"text")), "upper"(COALESCE("specification", ''::"text"))) WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_permissions_code" ON "public"."permissions" USING "btree" ("code");



CREATE INDEX "idx_permissions_module_feature_action" ON "public"."permissions" USING "btree" ("module", "feature", "action");



CREATE INDEX "idx_profiles_department" ON "public"."profiles" USING "btree" ("department");



CREATE INDEX "idx_profiles_employee_code" ON "public"."profiles" USING "btree" ("employee_code");



CREATE INDEX "idx_role_permissions_permission" ON "public"."role_permissions" USING "btree" ("permission_id");



CREATE INDEX "idx_role_permissions_role" ON "public"."role_permissions" USING "btree" ("role_id");



CREATE INDEX "idx_roles_active" ON "public"."roles" USING "btree" ("is_active");



CREATE INDEX "idx_roles_code" ON "public"."roles" USING "btree" ("code");



CREATE INDEX "idx_store_managers_role_type" ON "public"."store_managers" USING "btree" ("role_type");



CREATE INDEX "idx_store_managers_store_id" ON "public"."store_managers" USING "btree" ("store_id");



CREATE INDEX "idx_store_managers_user_id" ON "public"."store_managers" USING "btree" ("user_id");



CREATE INDEX "idx_stores_active_code" ON "public"."stores" USING "btree" ("is_active", "store_code");



CREATE INDEX "idx_stores_hr_store_code" ON "public"."stores" USING "btree" ("hr_store_code") WHERE ("hr_store_code" IS NOT NULL);



CREATE INDEX "idx_stores_is_franchise" ON "public"."stores" USING "btree" ("is_franchise");



CREATE INDEX "idx_stores_manager_name" ON "public"."stores" USING "btree" ("manager_name");



CREATE INDEX "idx_stores_source_store_id" ON "public"."stores" USING "btree" ("source_store_id");



CREATE INDEX "idx_user_roles_role" ON "public"."user_roles" USING "btree" ("role_id");



CREATE INDEX "idx_user_roles_user_active" ON "public"."user_roles" USING "btree" ("user_id", "is_active");



CREATE UNIQUE INDEX "uq_ga_equipment_asset_code_active" ON "public"."ga_equipment" USING "btree" ("upper"("btrim"("asset_code"))) WHERE (("deleted_at" IS NULL) AND ("asset_code" IS NOT NULL));



CREATE UNIQUE INDEX "uq_ga_equipment_barcode_active" ON "public"."ga_equipment" USING "btree" ("upper"("btrim"("barcode"))) WHERE (("deleted_at" IS NULL) AND ("barcode" IS NOT NULL));



CREATE UNIQUE INDEX "uq_ga_equipment_categories_code_active" ON "public"."ga_equipment_categories" USING "btree" ("code") WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "uq_ga_equipment_templates_identity_active" ON "public"."ga_equipment_templates" USING "btree" ("category_id", "upper"("btrim"("name")), "upper"("btrim"(COALESCE("brand", ''::"text"))), "upper"("btrim"(COALESCE("model", ''::"text")))) WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "uq_ga_facilities_code_active" ON "public"."ga_facilities" USING "btree" ("upper"("btrim"("facility_code"))) WHERE (("deleted_at" IS NULL) AND ("facility_code" IS NOT NULL));



CREATE UNIQUE INDEX "uq_ga_facility_categories_code_active" ON "public"."ga_facility_categories" USING "btree" ("code") WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "uq_ga_part_categories_code_active" ON "public"."ga_part_categories" USING "btree" ("code") WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "uq_ga_part_compat_brand_model_active" ON "public"."ga_part_compatibilities" USING "btree" ("part_id", "upper"("btrim"("brand")), "upper"("btrim"(COALESCE("model", ''::"text")))) WHERE (("deleted_at" IS NULL) AND ("compatibility_type" = 'BRAND_MODEL'::"text"));



CREATE UNIQUE INDEX "uq_ga_part_compat_template_active" ON "public"."ga_part_compatibilities" USING "btree" ("part_id", "equipment_template_id") WHERE (("deleted_at" IS NULL) AND ("compatibility_type" = 'EQUIPMENT_TEMPLATE'::"text"));



CREATE UNIQUE INDEX "uq_ga_part_compat_vendor_series_active" ON "public"."ga_part_compatibilities" USING "btree" ("part_id", "upper"("btrim"("vendor_name")), "upper"("btrim"(COALESCE("series_name", ''::"text")))) WHERE (("deleted_at" IS NULL) AND ("compatibility_type" = 'VENDOR_SERIES'::"text"));



CREATE UNIQUE INDEX "uq_ga_parts_barcode_active" ON "public"."ga_parts" USING "btree" ("btrim"("barcode")) WHERE (("deleted_at" IS NULL) AND ("barcode" IS NOT NULL));



CREATE UNIQUE INDEX "uq_ga_parts_part_code_active" ON "public"."ga_parts" USING "btree" ("upper"("btrim"("part_code"))) WHERE (("deleted_at" IS NULL) AND ("part_code" IS NOT NULL));



CREATE OR REPLACE TRIGGER "trg_ga_equipment_before_write" BEFORE INSERT OR UPDATE ON "public"."ga_equipment" FOR EACH ROW EXECUTE FUNCTION "public"."ga_validate_equipment"();



CREATE OR REPLACE TRIGGER "trg_ga_equipment_categories_before_write" BEFORE INSERT OR UPDATE ON "public"."ga_equipment_categories" FOR EACH ROW EXECUTE FUNCTION "public"."ga_category_before_write"();



CREATE OR REPLACE TRIGGER "trg_ga_equipment_templates_before_write" BEFORE INSERT OR UPDATE ON "public"."ga_equipment_templates" FOR EACH ROW EXECUTE FUNCTION "public"."ga_validate_equipment_template"();



CREATE OR REPLACE TRIGGER "trg_ga_facilities_before_write" BEFORE INSERT OR UPDATE ON "public"."ga_facilities" FOR EACH ROW EXECUTE FUNCTION "public"."ga_validate_facility"();



CREATE OR REPLACE TRIGGER "trg_ga_facility_categories_before_write" BEFORE INSERT OR UPDATE ON "public"."ga_facility_categories" FOR EACH ROW EXECUTE FUNCTION "public"."ga_category_before_write"();



CREATE OR REPLACE TRIGGER "trg_ga_part_categories_before_write" BEFORE INSERT OR UPDATE ON "public"."ga_part_categories" FOR EACH ROW EXECUTE FUNCTION "public"."ga_category_before_write"();



CREATE OR REPLACE TRIGGER "trg_ga_part_compatibilities_before_write" BEFORE INSERT OR UPDATE ON "public"."ga_part_compatibilities" FOR EACH ROW EXECUTE FUNCTION "public"."ga_validate_part_compatibility"();



CREATE OR REPLACE TRIGGER "trg_ga_parts_before_write" BEFORE INSERT OR UPDATE ON "public"."ga_parts" FOR EACH ROW EXECUTE FUNCTION "public"."ga_validate_part"();



CREATE OR REPLACE TRIGGER "trg_profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."dev_bootstrap_touch_updated_at"();



CREATE OR REPLACE TRIGGER "trg_roles_updated_at" BEFORE UPDATE ON "public"."roles" FOR EACH ROW EXECUTE FUNCTION "public"."dev_bootstrap_touch_updated_at"();



CREATE OR REPLACE TRIGGER "trg_stores_updated_at" BEFORE UPDATE ON "public"."stores" FOR EACH ROW EXECUTE FUNCTION "public"."dev_bootstrap_touch_updated_at"();



ALTER TABLE ONLY "public"."ga_equipment_categories"
    ADD CONSTRAINT "ga_equipment_categories_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ga_equipment_categories"
    ADD CONSTRAINT "ga_equipment_categories_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ga_equipment_categories"
    ADD CONSTRAINT "ga_equipment_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."ga_equipment_categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ga_equipment_categories"
    ADD CONSTRAINT "ga_equipment_categories_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ga_equipment"
    ADD CONSTRAINT "ga_equipment_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."ga_equipment_categories"("id");



ALTER TABLE ONLY "public"."ga_equipment"
    ADD CONSTRAINT "ga_equipment_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ga_equipment"
    ADD CONSTRAINT "ga_equipment_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ga_equipment"
    ADD CONSTRAINT "ga_equipment_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id");



ALTER TABLE ONLY "public"."ga_equipment"
    ADD CONSTRAINT "ga_equipment_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."ga_equipment_templates"("id");



ALTER TABLE ONLY "public"."ga_equipment_templates"
    ADD CONSTRAINT "ga_equipment_templates_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."ga_equipment_categories"("id");



ALTER TABLE ONLY "public"."ga_equipment_templates"
    ADD CONSTRAINT "ga_equipment_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ga_equipment_templates"
    ADD CONSTRAINT "ga_equipment_templates_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ga_equipment_templates"
    ADD CONSTRAINT "ga_equipment_templates_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ga_equipment"
    ADD CONSTRAINT "ga_equipment_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ga_facilities"
    ADD CONSTRAINT "ga_facilities_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."ga_facility_categories"("id");



ALTER TABLE ONLY "public"."ga_facilities"
    ADD CONSTRAINT "ga_facilities_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ga_facilities"
    ADD CONSTRAINT "ga_facilities_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ga_facilities"
    ADD CONSTRAINT "ga_facilities_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id");



ALTER TABLE ONLY "public"."ga_facilities"
    ADD CONSTRAINT "ga_facilities_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ga_facility_categories"
    ADD CONSTRAINT "ga_facility_categories_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ga_facility_categories"
    ADD CONSTRAINT "ga_facility_categories_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ga_facility_categories"
    ADD CONSTRAINT "ga_facility_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."ga_facility_categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ga_facility_categories"
    ADD CONSTRAINT "ga_facility_categories_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ga_part_categories"
    ADD CONSTRAINT "ga_part_categories_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ga_part_categories"
    ADD CONSTRAINT "ga_part_categories_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ga_part_categories"
    ADD CONSTRAINT "ga_part_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."ga_part_categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ga_part_categories"
    ADD CONSTRAINT "ga_part_categories_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ga_part_compatibilities"
    ADD CONSTRAINT "ga_part_compatibilities_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ga_part_compatibilities"
    ADD CONSTRAINT "ga_part_compatibilities_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ga_part_compatibilities"
    ADD CONSTRAINT "ga_part_compatibilities_equipment_template_id_fkey" FOREIGN KEY ("equipment_template_id") REFERENCES "public"."ga_equipment_templates"("id");



ALTER TABLE ONLY "public"."ga_part_compatibilities"
    ADD CONSTRAINT "ga_part_compatibilities_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "public"."ga_parts"("id");



ALTER TABLE ONLY "public"."ga_part_compatibilities"
    ADD CONSTRAINT "ga_part_compatibilities_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ga_parts"
    ADD CONSTRAINT "ga_parts_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."ga_part_categories"("id");



ALTER TABLE ONLY "public"."ga_parts"
    ADD CONSTRAINT "ga_parts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ga_parts"
    ADD CONSTRAINT "ga_parts_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ga_parts"
    ADD CONSTRAINT "ga_parts_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."store_managers"
    ADD CONSTRAINT "store_managers_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."store_managers"
    ADD CONSTRAINT "store_managers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."stores"
    ADD CONSTRAINT "stores_source_store_id_fkey" FOREIGN KEY ("source_store_id") REFERENCES "public"."stores"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "dev_profiles_select_self" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("id" = "auth"."uid"()));



CREATE POLICY "dev_store_managers_select_self" ON "public"."store_managers" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "dev_stores_select_ga_access" ON "public"."stores" FOR SELECT TO "authenticated" USING ((("is_active" = true) AND "public"."has_permission"("auth"."uid"(), 'general_affairs.service_center.access'::character varying)));



CREATE POLICY "dev_stores_select_managed" ON "public"."stores" FOR SELECT TO "authenticated" USING ((("is_active" = true) AND (EXISTS ( SELECT 1
   FROM "public"."store_managers" "sm"
  WHERE (("sm"."store_id" = "stores"."id") AND ("sm"."user_id" = "auth"."uid"()))))));



ALTER TABLE "public"."ga_equipment" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ga_equipment_categories" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ga_equipment_categories_general_read" ON "public"."ga_equipment_categories" FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) AND ("is_active" = true) AND "public"."ga_category_has_active_path"('equipment'::"public"."ga_category_kind", "id") AND ("public"."has_permission"("auth"."uid"(), 'general_affairs.service_center.access'::character varying) OR "public"."has_permission"("auth"."uid"(), 'general_affairs.equipment_category.view'::character varying))));



CREATE POLICY "ga_equipment_categories_insert" ON "public"."ga_equipment_categories" FOR INSERT TO "authenticated" WITH CHECK ("public"."has_permission"("auth"."uid"(), 'general_affairs.equipment_category.manage'::character varying));



CREATE POLICY "ga_equipment_categories_manage_read" ON "public"."ga_equipment_categories" FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."has_permission"("auth"."uid"(), 'general_affairs.equipment_category.manage'::character varying)));



CREATE POLICY "ga_equipment_categories_update" ON "public"."ga_equipment_categories" FOR UPDATE TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."has_permission"("auth"."uid"(), 'general_affairs.equipment_category.manage'::character varying))) WITH CHECK ("public"."has_permission"("auth"."uid"(), 'general_affairs.equipment_category.manage'::character varying));



CREATE POLICY "ga_equipment_insert" ON "public"."ga_equipment" FOR INSERT TO "authenticated" WITH CHECK ("public"."current_user_has_permission"('general_affairs.equipment.manage'::character varying));



CREATE POLICY "ga_equipment_scope_read" ON "public"."ga_equipment" FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) AND ("public"."current_user_has_permission"('general_affairs.equipment.view'::character varying) OR "public"."current_user_has_permission"('general_affairs.equipment.manage'::character varying) OR (EXISTS ( SELECT 1
   FROM "public"."store_managers" "sm"
  WHERE (("sm"."store_id" = "ga_equipment"."store_id") AND ("sm"."user_id" = "auth"."uid"())))))));



ALTER TABLE "public"."ga_equipment_templates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ga_equipment_templates_general_read" ON "public"."ga_equipment_templates" FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) AND ("is_active" = true) AND "public"."ga_is_active_equipment_category"("category_id") AND ("public"."current_user_has_permission"('general_affairs.equipment_template.view'::character varying) OR "public"."current_user_has_permission"('general_affairs.equipment_template.manage'::character varying))));



CREATE POLICY "ga_equipment_templates_insert" ON "public"."ga_equipment_templates" FOR INSERT TO "authenticated" WITH CHECK ("public"."current_user_has_permission"('general_affairs.equipment_template.manage'::character varying));



CREATE POLICY "ga_equipment_templates_manage_read" ON "public"."ga_equipment_templates" FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."current_user_has_permission"('general_affairs.equipment_template.manage'::character varying)));



CREATE POLICY "ga_equipment_templates_update" ON "public"."ga_equipment_templates" FOR UPDATE TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."current_user_has_permission"('general_affairs.equipment_template.manage'::character varying))) WITH CHECK ("public"."current_user_has_permission"('general_affairs.equipment_template.manage'::character varying));



CREATE POLICY "ga_equipment_update" ON "public"."ga_equipment" FOR UPDATE TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."current_user_has_permission"('general_affairs.equipment.manage'::character varying))) WITH CHECK ("public"."current_user_has_permission"('general_affairs.equipment.manage'::character varying));



ALTER TABLE "public"."ga_facilities" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ga_facilities_insert" ON "public"."ga_facilities" FOR INSERT TO "authenticated" WITH CHECK ("public"."current_user_has_permission"('general_affairs.facility.manage'::character varying));



CREATE POLICY "ga_facilities_scope_read" ON "public"."ga_facilities" FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) AND ("public"."current_user_has_permission"('general_affairs.facility.view'::character varying) OR "public"."current_user_has_permission"('general_affairs.facility.manage'::character varying) OR (EXISTS ( SELECT 1
   FROM "public"."store_managers" "sm"
  WHERE (("sm"."store_id" = "ga_facilities"."store_id") AND ("sm"."user_id" = "auth"."uid"())))))));



CREATE POLICY "ga_facilities_update" ON "public"."ga_facilities" FOR UPDATE TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."current_user_has_permission"('general_affairs.facility.manage'::character varying))) WITH CHECK ("public"."current_user_has_permission"('general_affairs.facility.manage'::character varying));



ALTER TABLE "public"."ga_facility_categories" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ga_facility_categories_general_read" ON "public"."ga_facility_categories" FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) AND ("is_active" = true) AND "public"."ga_category_has_active_path"('facility'::"public"."ga_category_kind", "id") AND ("public"."has_permission"("auth"."uid"(), 'general_affairs.service_center.access'::character varying) OR "public"."has_permission"("auth"."uid"(), 'general_affairs.facility_category.view'::character varying))));



CREATE POLICY "ga_facility_categories_insert" ON "public"."ga_facility_categories" FOR INSERT TO "authenticated" WITH CHECK ("public"."has_permission"("auth"."uid"(), 'general_affairs.facility_category.manage'::character varying));



CREATE POLICY "ga_facility_categories_manage_read" ON "public"."ga_facility_categories" FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."has_permission"("auth"."uid"(), 'general_affairs.facility_category.manage'::character varying)));



CREATE POLICY "ga_facility_categories_update" ON "public"."ga_facility_categories" FOR UPDATE TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."has_permission"("auth"."uid"(), 'general_affairs.facility_category.manage'::character varying))) WITH CHECK ("public"."has_permission"("auth"."uid"(), 'general_affairs.facility_category.manage'::character varying));



ALTER TABLE "public"."ga_part_categories" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ga_part_categories_general_read" ON "public"."ga_part_categories" FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) AND ("is_active" = true) AND "public"."ga_category_has_active_path"('part'::"public"."ga_category_kind", "id") AND ("public"."has_permission"("auth"."uid"(), 'general_affairs.service_center.access'::character varying) OR "public"."has_permission"("auth"."uid"(), 'general_affairs.part_category.view'::character varying))));



CREATE POLICY "ga_part_categories_insert" ON "public"."ga_part_categories" FOR INSERT TO "authenticated" WITH CHECK ("public"."has_permission"("auth"."uid"(), 'general_affairs.part_category.manage'::character varying));



CREATE POLICY "ga_part_categories_manage_read" ON "public"."ga_part_categories" FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."has_permission"("auth"."uid"(), 'general_affairs.part_category.manage'::character varying)));



CREATE POLICY "ga_part_categories_update" ON "public"."ga_part_categories" FOR UPDATE TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."has_permission"("auth"."uid"(), 'general_affairs.part_category.manage'::character varying))) WITH CHECK ("public"."has_permission"("auth"."uid"(), 'general_affairs.part_category.manage'::character varying));



ALTER TABLE "public"."ga_part_compatibilities" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ga_part_compatibilities_insert" ON "public"."ga_part_compatibilities" FOR INSERT TO "authenticated" WITH CHECK ("public"."current_user_has_permission"('general_affairs.part.manage'::character varying));



CREATE POLICY "ga_part_compatibilities_read_via_part" ON "public"."ga_part_compatibilities" FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."ga_part_is_visible"("part_id")));



CREATE POLICY "ga_part_compatibilities_update" ON "public"."ga_part_compatibilities" FOR UPDATE TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."current_user_has_permission"('general_affairs.part.manage'::character varying))) WITH CHECK ("public"."current_user_has_permission"('general_affairs.part.manage'::character varying));



ALTER TABLE "public"."ga_parts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ga_parts_general_read" ON "public"."ga_parts" FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) AND ("is_active" = true) AND ("public"."current_user_has_permission"('general_affairs.part.view'::character varying) OR "public"."current_user_has_permission"('general_affairs.part.manage'::character varying) OR "public"."current_user_is_store_manager"())));



CREATE POLICY "ga_parts_insert" ON "public"."ga_parts" FOR INSERT TO "authenticated" WITH CHECK ("public"."current_user_has_permission"('general_affairs.part.manage'::character varying));



CREATE POLICY "ga_parts_manage_read" ON "public"."ga_parts" FOR SELECT TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."current_user_has_permission"('general_affairs.part.manage'::character varying)));



CREATE POLICY "ga_parts_update" ON "public"."ga_parts" FOR UPDATE TO "authenticated" USING ((("deleted_at" IS NULL) AND "public"."current_user_has_permission"('general_affairs.part.manage'::character varying))) WITH CHECK ("public"."current_user_has_permission"('general_affairs.part.manage'::character varying));



ALTER TABLE "public"."permissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."role_permissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."store_managers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."stores" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_roles" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































GRANT ALL ON FUNCTION "public"."current_user_has_permission"("p_permission_code" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."current_user_has_permission"("p_permission_code" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_has_permission"("p_permission_code" character varying) TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_user_is_store_manager"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_user_is_store_manager"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_user_is_store_manager"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_is_store_manager"() TO "service_role";



GRANT ALL ON FUNCTION "public"."dev_bootstrap_touch_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."dev_bootstrap_touch_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."dev_bootstrap_touch_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."ga_active_category_path"("p_kind" "public"."ga_category_kind", "p_category_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."ga_active_category_path"("p_kind" "public"."ga_category_kind", "p_category_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ga_active_category_path"("p_kind" "public"."ga_category_kind", "p_category_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."ga_category_before_write"() TO "anon";
GRANT ALL ON FUNCTION "public"."ga_category_before_write"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ga_category_before_write"() TO "service_role";



GRANT ALL ON FUNCTION "public"."ga_category_depth"("p_kind" "public"."ga_category_kind", "p_category_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."ga_category_depth"("p_kind" "public"."ga_category_kind", "p_category_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ga_category_depth"("p_kind" "public"."ga_category_kind", "p_category_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."ga_category_has_active_path"("p_kind" "public"."ga_category_kind", "p_category_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."ga_category_has_active_path"("p_kind" "public"."ga_category_kind", "p_category_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ga_category_has_active_path"("p_kind" "public"."ga_category_kind", "p_category_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."ga_category_table_name"("p_kind" "public"."ga_category_kind") TO "anon";
GRANT ALL ON FUNCTION "public"."ga_category_table_name"("p_kind" "public"."ga_category_kind") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ga_category_table_name"("p_kind" "public"."ga_category_kind") TO "service_role";



GRANT ALL ON FUNCTION "public"."ga_is_active_equipment_category"("p_category_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."ga_is_active_equipment_category"("p_category_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ga_is_active_equipment_category"("p_category_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."ga_is_active_facility_category"("p_category_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."ga_is_active_facility_category"("p_category_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ga_is_active_facility_category"("p_category_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."ga_is_active_part_category"("p_category_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."ga_is_active_part_category"("p_category_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ga_is_active_part_category"("p_category_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."ga_is_store_active"("p_store_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."ga_is_store_active"("p_store_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ga_is_store_active"("p_store_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."ga_normalize_optional_text"("p_value" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."ga_normalize_optional_text"("p_value" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ga_normalize_optional_text"("p_value" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."ga_part_is_visible"("p_part_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."ga_part_is_visible"("p_part_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ga_part_is_visible"("p_part_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ga_soft_delete_category"("p_kind" "public"."ga_category_kind", "p_category_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ga_soft_delete_category"("p_kind" "public"."ga_category_kind", "p_category_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."ga_soft_delete_category"("p_kind" "public"."ga_category_kind", "p_category_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ga_soft_delete_category"("p_kind" "public"."ga_category_kind", "p_category_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ga_soft_delete_equipment"("p_equipment_id" "uuid", "p_deletion_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ga_soft_delete_equipment"("p_equipment_id" "uuid", "p_deletion_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."ga_soft_delete_equipment"("p_equipment_id" "uuid", "p_deletion_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ga_soft_delete_equipment"("p_equipment_id" "uuid", "p_deletion_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ga_soft_delete_equipment_template"("p_template_id" "uuid", "p_deletion_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ga_soft_delete_equipment_template"("p_template_id" "uuid", "p_deletion_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."ga_soft_delete_equipment_template"("p_template_id" "uuid", "p_deletion_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ga_soft_delete_equipment_template"("p_template_id" "uuid", "p_deletion_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ga_soft_delete_facility"("p_facility_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ga_soft_delete_facility"("p_facility_id" "uuid", "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."ga_soft_delete_facility"("p_facility_id" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ga_soft_delete_facility"("p_facility_id" "uuid", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ga_soft_delete_part"("p_part_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ga_soft_delete_part"("p_part_id" "uuid", "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."ga_soft_delete_part"("p_part_id" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ga_soft_delete_part"("p_part_id" "uuid", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ga_soft_delete_part_compatibility"("p_compatibility_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ga_soft_delete_part_compatibility"("p_compatibility_id" "uuid", "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."ga_soft_delete_part_compatibility"("p_compatibility_id" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ga_soft_delete_part_compatibility"("p_compatibility_id" "uuid", "p_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."ga_validate_category_tree"("p_kind" "public"."ga_category_kind", "p_category_id" "uuid", "p_parent_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."ga_validate_category_tree"("p_kind" "public"."ga_category_kind", "p_category_id" "uuid", "p_parent_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ga_validate_category_tree"("p_kind" "public"."ga_category_kind", "p_category_id" "uuid", "p_parent_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."ga_validate_equipment"() TO "anon";
GRANT ALL ON FUNCTION "public"."ga_validate_equipment"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ga_validate_equipment"() TO "service_role";



GRANT ALL ON FUNCTION "public"."ga_validate_equipment_template"() TO "anon";
GRANT ALL ON FUNCTION "public"."ga_validate_equipment_template"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ga_validate_equipment_template"() TO "service_role";



GRANT ALL ON FUNCTION "public"."ga_validate_facility"() TO "anon";
GRANT ALL ON FUNCTION "public"."ga_validate_facility"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ga_validate_facility"() TO "service_role";



GRANT ALL ON FUNCTION "public"."ga_validate_part"() TO "anon";
GRANT ALL ON FUNCTION "public"."ga_validate_part"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ga_validate_part"() TO "service_role";



GRANT ALL ON FUNCTION "public"."ga_validate_part_compatibility"() TO "anon";
GRANT ALL ON FUNCTION "public"."ga_validate_part_compatibility"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ga_validate_part_compatibility"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_permissions"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_permissions"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_permissions"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."has_permission"("p_user_id" "uuid", "p_permission_code" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."has_permission"("p_user_id" "uuid", "p_permission_code" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_permission"("p_user_id" "uuid", "p_permission_code" character varying) TO "service_role";


















GRANT ALL ON TABLE "public"."ga_equipment" TO "anon";
GRANT ALL ON TABLE "public"."ga_equipment" TO "authenticated";
GRANT ALL ON TABLE "public"."ga_equipment" TO "service_role";



GRANT ALL ON TABLE "public"."ga_equipment_categories" TO "anon";
GRANT ALL ON TABLE "public"."ga_equipment_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."ga_equipment_categories" TO "service_role";



GRANT ALL ON TABLE "public"."ga_equipment_templates" TO "anon";
GRANT ALL ON TABLE "public"."ga_equipment_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."ga_equipment_templates" TO "service_role";



GRANT ALL ON TABLE "public"."ga_facilities" TO "anon";
GRANT ALL ON TABLE "public"."ga_facilities" TO "authenticated";
GRANT ALL ON TABLE "public"."ga_facilities" TO "service_role";



GRANT ALL ON TABLE "public"."ga_facility_categories" TO "anon";
GRANT ALL ON TABLE "public"."ga_facility_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."ga_facility_categories" TO "service_role";



GRANT ALL ON TABLE "public"."ga_part_categories" TO "anon";
GRANT ALL ON TABLE "public"."ga_part_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."ga_part_categories" TO "service_role";



GRANT ALL ON TABLE "public"."ga_part_compatibilities" TO "anon";
GRANT ALL ON TABLE "public"."ga_part_compatibilities" TO "authenticated";
GRANT ALL ON TABLE "public"."ga_part_compatibilities" TO "service_role";



GRANT ALL ON TABLE "public"."ga_parts" TO "anon";
GRANT ALL ON TABLE "public"."ga_parts" TO "authenticated";
GRANT ALL ON TABLE "public"."ga_parts" TO "service_role";



GRANT ALL ON TABLE "public"."permissions" TO "anon";
GRANT ALL ON TABLE "public"."permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."permissions" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."role_permissions" TO "anon";
GRANT ALL ON TABLE "public"."role_permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."role_permissions" TO "service_role";



GRANT ALL ON TABLE "public"."roles" TO "anon";
GRANT ALL ON TABLE "public"."roles" TO "authenticated";
GRANT ALL ON TABLE "public"."roles" TO "service_role";



GRANT ALL ON TABLE "public"."store_managers" TO "anon";
GRANT ALL ON TABLE "public"."store_managers" TO "authenticated";
GRANT ALL ON TABLE "public"."store_managers" TO "service_role";



GRANT ALL ON TABLE "public"."stores" TO "anon";
GRANT ALL ON TABLE "public"."stores" TO "authenticated";
GRANT ALL ON TABLE "public"."stores" TO "service_role";



GRANT ALL ON TABLE "public"."user_roles" TO "anon";
GRANT ALL ON TABLE "public"."user_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_roles" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































drop extension if exists "pg_net";

alter table "public"."store_managers" drop constraint "store_managers_role_type_check";

alter table "public"."store_managers" add constraint "store_managers_role_type_check" CHECK (((role_type)::text = ANY ((ARRAY['store_manager'::character varying, 'supervisor'::character varying, 'area_manager'::character varying])::text[]))) not valid;

alter table "public"."store_managers" validate constraint "store_managers_role_type_check";

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


