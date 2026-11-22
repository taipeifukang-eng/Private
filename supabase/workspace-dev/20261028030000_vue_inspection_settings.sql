-- DEV only: versioned inspection settings, no historical score recalculation.
BEGIN;
CREATE TABLE IF NOT EXISTS public.inspection_grade_mapping(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), grade integer NOT NULL UNIQUE CHECK(grade BETWEEN 0 AND 10), min_score numeric(6,1) NOT NULL CHECK(min_score>=0), updated_by uuid REFERENCES profiles(id), created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
ALTER TABLE public.inspection_grade_mapping ENABLE ROW LEVEL SECURITY;
INSERT INTO public.inspection_grade_mapping(grade,min_score)
SELECT * FROM (VALUES(10,220),(9,215),(8,191),(7,181),(6,171),(5,161),(4,151),(3,141),(2,131),(1,121),(0,0)) v WHERE NOT EXISTS(SELECT 1 FROM public.inspection_grade_mapping);
CREATE TABLE IF NOT EXISTS public.workspace_inspection_settings_revision(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),version bigint NOT NULL DEFAULT 1);
INSERT INTO public.workspace_inspection_settings_revision VALUES(true,1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.workspace_inspection_settings_writes(id uuid PRIMARY KEY, actor uuid NOT NULL, hash text NOT NULL, result jsonb NOT NULL,created_at timestamptz DEFAULT now());
ALTER TABLE public.workspace_inspection_settings_revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_inspection_settings_writes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_inspection_settings_revision,public.workspace_inspection_settings_writes FROM anon,authenticated;
GRANT ALL ON public.workspace_inspection_settings_revision,public.workspace_inspection_settings_writes TO service_role;
CREATE OR REPLACE FUNCTION public.workspace_bump_inspection_settings() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN UPDATE workspace_inspection_settings_revision SET version=version+1 WHERE singleton; RETURN NULL; END; $$;
DROP TRIGGER IF EXISTS workspace_settings_changed ON inspection_templates;
CREATE TRIGGER workspace_settings_changed AFTER INSERT OR UPDATE OR DELETE ON inspection_templates FOR EACH STATEMENT EXECUTE FUNCTION workspace_bump_inspection_settings();
DROP TRIGGER IF EXISTS workspace_settings_changed ON inspection_bonus_config;
CREATE TRIGGER workspace_settings_changed AFTER INSERT OR UPDATE OR DELETE ON inspection_bonus_config FOR EACH STATEMENT EXECUTE FUNCTION workspace_bump_inspection_settings();
DROP TRIGGER IF EXISTS workspace_settings_changed ON inspection_grade_mapping;
CREATE TRIGGER workspace_settings_changed AFTER INSERT OR UPDATE OR DELETE ON inspection_grade_mapping FOR EACH STATEMENT EXECUTE FUNCTION workspace_bump_inspection_settings();
CREATE OR REPLACE FUNCTION public.workspace_save_inspection_settings(p_actor uuid,p_version bigint,p_write uuid,p_hash text,p_kind text,p_id uuid,p_data jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v bigint; receipt record; result jsonb; row_id uuid;
BEGIN
 SELECT version INTO v FROM workspace_inspection_settings_revision WHERE singleton FOR UPDATE;
 SELECT * INTO receipt FROM workspace_inspection_settings_writes WHERE id=p_write;
 IF FOUND THEN IF receipt.actor<>p_actor OR receipt.hash<>p_hash THEN RAISE EXCEPTION 'WRITE_REPLAY_MISMATCH'; END IF; RETURN receipt.result; END IF;
 IF v<>p_version THEN RAISE EXCEPTION 'SETTINGS_CONFLICT'; END IF;
 IF p_kind='template' THEN
  IF p_id IS NULL THEN
   INSERT INTO inspection_templates(section,section_name,section_order,item_name,item_description,item_order,max_score,scoring_type,checklist_items,is_active,created_by)
   VALUES(p_data->>'section',p_data->>'section_name',(p_data->>'section_order')::int,p_data->>'item_name',p_data->>'item_description',(p_data->>'item_order')::int,(p_data->>'max_score')::numeric,'checklist',p_data->'checklist_items',(p_data->>'is_active')::boolean,p_actor) RETURNING id INTO row_id;
  ELSE
   UPDATE inspection_templates SET section=p_data->>'section',section_name=p_data->>'section_name',section_order=(p_data->>'section_order')::int,item_name=p_data->>'item_name',item_description=p_data->>'item_description',item_order=(p_data->>'item_order')::int,max_score=(p_data->>'max_score')::numeric,scoring_type='checklist',checklist_items=p_data->'checklist_items',is_active=(p_data->>'is_active')::boolean,updated_at=now() WHERE id=p_id RETURNING id INTO row_id;
  END IF;
  IF row_id IS NULL THEN RAISE EXCEPTION 'SETTING_NOT_FOUND'; END IF;
 ELSIF p_kind='bonus' THEN
  IF (p_data->>'is_active')::boolean AND EXISTS(SELECT 1 FROM inspection_bonus_config WHERE is_active AND (p_id IS NULL OR id<>p_id) AND day_from <= (p_data->>'day_to')::int AND day_to >= (p_data->>'day_from')::int) THEN RAISE EXCEPTION 'BONUS_OVERLAP'; END IF;
  IF p_id IS NULL THEN
   INSERT INTO inspection_bonus_config(day_from,day_to,bonus_score,description,sort_order,is_active,updated_by) VALUES((p_data->>'day_from')::int,(p_data->>'day_to')::int,(p_data->>'bonus_score')::numeric,p_data->>'description',(p_data->>'sort_order')::int,(p_data->>'is_active')::boolean,p_actor) RETURNING id INTO row_id;
  ELSE
   UPDATE inspection_bonus_config SET day_from=(p_data->>'day_from')::int,day_to=(p_data->>'day_to')::int,bonus_score=(p_data->>'bonus_score')::numeric,description=p_data->>'description',sort_order=(p_data->>'sort_order')::int,is_active=(p_data->>'is_active')::boolean,updated_by=p_actor,updated_at=now() WHERE id=p_id RETURNING id INTO row_id;
  END IF;
  IF row_id IS NULL THEN RAISE EXCEPTION 'SETTING_NOT_FOUND'; END IF;
 ELSIF p_kind='grades' THEN
  INSERT INTO inspection_grade_mapping(grade,min_score,updated_by,updated_at) SELECT (x->>'grade')::int,(x->>'min_score')::numeric,p_actor,now() FROM jsonb_array_elements(p_data) x ON CONFLICT(grade) DO UPDATE SET min_score=excluded.min_score,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
 ELSE RAISE EXCEPTION 'INVALID_SETTING_KIND'; END IF;
 result:=jsonb_build_object('id',row_id,'version',(SELECT version FROM workspace_inspection_settings_revision WHERE singleton));
 INSERT INTO workspace_inspection_settings_writes(id,actor,hash,result) VALUES(p_write,p_actor,p_hash,result);
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.workspace_save_inspection_settings(uuid,bigint,uuid,text,text,uuid,jsonb) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_save_inspection_settings(uuid,bigint,uuid,text,text,uuid,jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.workspace_grade_from_settings() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN SELECT g.grade::text INTO NEW.grade FROM inspection_grade_mapping g WHERE g.min_score<=NEW.total_score ORDER BY g.grade DESC LIMIT 1; NEW.grade:=coalesce(NEW.grade,'0'); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS workspace_grade_from_settings ON inspection_masters;
CREATE TRIGGER workspace_grade_from_settings BEFORE INSERT OR UPDATE OF total_score ON inspection_masters FOR EACH ROW EXECUTE FUNCTION workspace_grade_from_settings();
NOTIFY pgrst,'reload schema';
COMMIT;
