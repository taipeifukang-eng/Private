DO $$
DECLARE
  v_function_oid OID;
  v_function_sql TEXT;
  v_updated_sql TEXT;
  v_ambiguous_clause TEXT := 'ON CONFLICT (' || 'location_id, part_id' || ') DO NOTHING;';
  v_constraint_clause TEXT := 'ON CONFLICT ON CONSTRAINT ga_inventory_balances_location_part_unique DO NOTHING;';
BEGIN
  SELECT to_regprocedure(
    'public.ga_post_inventory_transaction(text, uuid, uuid, numeric, text, text, text, text, uuid, text, timestamp with time zone, jsonb)'
  ) INTO v_function_oid;

  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'Task 1C-2B fix prerequisite missing: public.ga_post_inventory_transaction exact signature';
  END IF;

  v_function_sql := pg_get_functiondef(v_function_oid);
  v_updated_sql := replace(
    v_function_sql,
    v_ambiguous_clause,
    v_constraint_clause
  );

  IF v_updated_sql = v_function_sql THEN
    RAISE EXCEPTION 'Task 1C-2B fix expected ambiguous ON CONFLICT clause was not found';
  END IF;

  IF v_updated_sql LIKE '%' || v_ambiguous_clause || '%' THEN
    RAISE EXCEPTION 'Task 1C-2B fix failed to replace ambiguous ON CONFLICT clause';
  END IF;

  EXECUTE v_updated_sql;
END;
$$;

REVOKE ALL ON FUNCTION public.ga_post_inventory_transaction(TEXT, UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ga_post_inventory_transaction(TEXT, UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.ga_post_inventory_transaction(TEXT, UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ga_post_inventory_transaction(TEXT, UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ, JSONB) TO authenticated;
