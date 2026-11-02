BEGIN;
-- User confirmed parity: future effective dates are allowed. Keep all other
-- transaction, authorization and snapshot checks in the installed functions.
DO $$
DECLARE signature text; definition text; updated text;
BEGIN
 FOREACH signature IN ARRAY ARRAY['public.workspace_transfer_confirm(uuid,uuid,date,text)','public.workspace_transfer_correct(uuid,uuid,date,text,text,uuid)'] LOOP
  definition:=pg_get_functiondef(signature::regprocedure);
  updated:=regexp_replace(definition,'IF p_date>\(now\(\) AT TIME ZONE ''Asia/Taipei''\)::date THEN RAISE EXCEPTION ''WORKSPACE_FUTURE_POLICY_PENDING'';[ ]*END IF;','','g');
  IF updated=definition AND position('WORKSPACE_FUTURE_POLICY_PENDING' in definition)>0 THEN RAISE EXCEPTION 'Unexpected future guard format: %',signature; END IF;
  IF position('WORKSPACE_FUTURE_POLICY_PENDING' in updated)>0 THEN RAISE EXCEPTION 'Future guard remains: %',signature; END IF;
  EXECUTE updated;
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
