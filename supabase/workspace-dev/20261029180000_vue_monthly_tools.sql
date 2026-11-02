-- DEV only. Atomic allowance replacement and scoped summary updates.
begin;
create or replace function public.workspace_save_monthly_allowance(p_actor uuid,p_store uuid,p_month text,p_kind text,p_rows jsonb,p_expected jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare t text; current_rows jsonb; r jsonb; n integer;
begin
  t := case p_kind when 'support' then 'support_staff_bonus' when 'transport' then 'monthly_staff_status' when 'talent' then 'talent_cultivation_bonus' when 'spring' then 'spring_festival_bonus' when 'meal' then 'meal_allowance_records' end;
  if t is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows)>1500 then raise exception 'invalid rows'; end if;
  -- Shared order with summary saving; also blocks legacy status updates during commit.
  lock table monthly_store_summary in share row exclusive mode;
  lock table monthly_staff_status in share row exclusive mode;
  execute format('lock table %I in share row exclusive mode',t);
  if exists(select 1 from monthly_store_summary where store_id=p_store and year_month=p_month and store_status in ('submitted','confirmed'))
     or exists(select 1 from monthly_staff_status where store_id=p_store and year_month=p_month and status in ('submitted','confirmed')) then raise exception 'month locked'; end if;
  execute format('select coalesce(jsonb_agg(to_jsonb(x) order by id),''[]''::jsonb) from %I x where store_id=$1 and year_month=$2',t) into current_rows using p_store,p_month;
  if current_rows is distinct from p_expected then raise exception 'data changed'; end if;
  if p_kind='transport' then
    for r in select value from jsonb_array_elements(p_rows) loop
      update monthly_staff_status set monthly_transport_expense=(r->>'monthly_transport_expense')::numeric,transport_expense_notes=r->>'transport_expense_notes',updated_at=now()
      where store_id=p_store and year_month=p_month and employee_code=r->>'employee_code';
      get diagnostics n=row_count;
      if n<>1 then raise exception 'employee missing or duplicated'; end if;
    end loop;
  else
    execute format('delete from %I where store_id=$1 and year_month=$2',t) using p_store,p_month;
    for r in select value from jsonb_array_elements(p_rows) loop
      if p_kind='support' then
        insert into support_staff_bonus(year_month,store_id,employee_code,employee_name,bonus_amount,created_by)
        values(p_month,p_store,r->>'employee_code',r->>'employee_name',(r->>'bonus_amount')::numeric,p_actor);
      elsif p_kind='talent' then
        insert into talent_cultivation_bonus(year_month,store_id,employee_code,employee_name,cultivation_bonus,cultivation_target,created_by)
        values(p_month,p_store,r->>'employee_code',r->>'employee_name',(r->>'cultivation_bonus')::integer,r->>'cultivation_target',p_actor);
      elsif p_kind='spring' then
        insert into spring_festival_bonus(year_month,store_id,employee_code,employee_name,attendance_date,category,bonus_amount,created_by)
        values(p_month,p_store,r->>'employee_code',r->>'employee_name',(r->>'attendance_date')::date,r->>'category',(r->>'bonus_amount')::integer,p_actor);
      else
        insert into meal_allowance_records(year_month,store_id,employee_code,employee_name,record_date,work_hours,meal_period,employee_type)
        values(p_month,p_store,r->>'employee_code',r->>'employee_name',r->>'record_date',r->>'work_hours',r->>'meal_period',r->>'employee_type');
      end if;
    end loop;
  end if;
end $$;
revoke all on function public.workspace_save_monthly_allowance(uuid,uuid,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.workspace_save_monthly_allowance(uuid,uuid,text,text,jsonb,jsonb) to service_role;

create or replace function public.workspace_save_monthly_summary(p_store uuid,p_month text,p_updates jsonb,p_version timestamptz)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare before_row monthly_store_summary; k text; v jsonb;
begin
  lock table monthly_store_summary in share row exclusive mode;
  lock table monthly_staff_status in share row exclusive mode;
  select * into before_row from monthly_store_summary where store_id=p_store and year_month=p_month;
  if before_row.updated_at is distinct from p_version then raise exception 'data changed'; end if;
  if before_row.store_status in ('submitted','confirmed') or exists(select 1 from monthly_staff_status where store_id=p_store and year_month=p_month and status in ('submitted','confirmed')) then raise exception 'month locked'; end if;
  if before_row.id is null then
    insert into monthly_store_summary(year_month,store_id,total_employees,confirmed_count,store_status) values(p_month,p_store,0,0,'in_progress') returning * into before_row;
  end if;
  for k,v in select * from jsonb_each(p_updates) loop
    if not (k=any(array['total_staff_count','admin_staff_count','newbie_count','business_days','total_gross_profit','total_customer_count','prescription_addon_only_count','regular_prescription_count','chronic_prescription_count','support_to_other_stores_hours','support_from_other_stores_hours'])) or jsonb_typeof(v)<>'number' or v::text::numeric<0 then raise exception 'invalid field'; end if;
    execute format('update monthly_store_summary set %I=$1,updated_at=now() where id=$2',k) using v::text::numeric,before_row.id;
  end loop;
end $$;
revoke all on function public.workspace_save_monthly_summary(uuid,text,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.workspace_save_monthly_summary(uuid,text,jsonb,timestamptz) to service_role;
create or replace function public.workspace_add_monthly_employee(p_store uuid,p_month text,p_id uuid,p_employee jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare existing monthly_staff_status; result monthly_staff_status; start_day date;
begin
  lock table monthly_store_summary in share row exclusive mode;
  lock table monthly_staff_status in share row exclusive mode;
  select * into existing from monthly_staff_status where id=p_id;
  if existing.id is not null then
    if existing.store_id<>p_store or existing.year_month<>p_month or not existing.is_manually_added or existing.employee_name<>p_employee->>'employee_name' or coalesce(existing.employee_code,'')<>coalesce(p_employee->>'employee_code','') then raise exception 'request changed'; end if;
    return to_jsonb(existing);
  end if;
  if exists(select 1 from monthly_store_summary where store_id=p_store and year_month=p_month and store_status in ('submitted','confirmed')) or exists(select 1 from monthly_staff_status where store_id=p_store and year_month=p_month and status in ('submitted','confirmed')) then raise exception 'month locked'; end if;
  if nullif(p_employee->>'employee_code','') is not null and exists(select 1 from monthly_staff_status where store_id=p_store and year_month=p_month and upper(employee_code)=upper(p_employee->>'employee_code')) then raise exception 'employee duplicated'; end if;
  select start_date into start_day from store_employees where employee_code=p_employee->>'employee_code' order by (store_id=p_store) desc,start_date limit 1;
  insert into monthly_staff_status(id,year_month,store_id,user_id,employee_code,employee_name,position,employment_type,is_pharmacist,monthly_status,work_days,work_hours,total_days_in_month,notes,status,is_manually_added,newbie_level,start_date,created_at,updated_at)
  values(p_id,p_month,p_store,null,nullif(p_employee->>'employee_code',''),p_employee->>'employee_name',p_employee->>'position',p_employee->>'employment_type',(p_employee->>'is_pharmacist')::boolean,p_employee->>'monthly_status',(p_employee->>'work_days')::numeric,(p_employee->>'work_hours')::numeric,extract(day from (to_date(p_month||'-01','YYYY-MM-DD')+interval '1 month - 1 day')),nullif(p_employee->>'notes',''),'draft',true,nullif(p_employee->>'newbie_level',''),start_day,now(),now()) returning * into result;
  return to_jsonb(result);
end $$;
revoke all on function public.workspace_add_monthly_employee(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.workspace_add_monthly_employee(uuid,text,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
