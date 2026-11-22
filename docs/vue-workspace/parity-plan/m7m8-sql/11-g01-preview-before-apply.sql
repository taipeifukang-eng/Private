-- 11-g01-preview-before-apply.sql
-- M7/M8 第 1 批（G02-G05）上線前的現況檢查。純唯讀：只有 SELECT，沒有任何 INSERT/UPDATE/DELETE/DDL。正式區與 DEV 都可以整份執行。
-- 目的：(1) 確認 10-g01-catalog-rules.sql 套用前還沒有 ga_ws_ 函式；(2) 看新版規則（Q3～Q7）上線後會「擋下」或「影響」多少現有資料，讓你有心理準備。
-- 結果欄位：section（區塊）、item（項目）、value（數字或狀態）、detail（說明）。
-- 區塊 A 先決條件；B 分類（Q4）；C 料件（Q5、Q6）；D 型號與架型（Q7）；E 附件（Q3）；F 舊版缺陷確認。
-- 區塊 F 說明：DEV 實測舊版「適用料件整批取代」在要移除舊對照時會失敗（HTTP 500）——對照表的讀取規則只允許未刪除的列，舊版直接把列改成已刪除時被規則擋下。
--   正式區若這張表的 SELECT 規則同樣是 deleted_at IS NULL（下面 F 區列出），舊版也會有同樣問題，新版用資料庫函式繞開了它，不需要你處理。
-- 看不懂的數字不用處理：這份只是現況，不是錯誤清單。真正需要處理的會在 detail 寫「建議處理」。

with
a_fn as (
  select 'A 先決條件' as section, 'ga_ws_ 函式數量（套用前應為 0，套用後應為 10）' as item,
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'ga\_ws\_%')::text as value,
         '0 代表還沒套用 10-g01-catalog-rules.sql；10 代表已套用' as detail
),
a_tables as (
  select 'A 先決條件', '缺少的資料表', coalesce(string_agg(t, '、'), '無'), '有缺就不要套用 10-g01'
  from unnest(array['ga_parts','ga_part_categories','ga_equipment_categories','ga_facility_categories','ga_equipment_templates','ga_facility_templates','ga_equipment','ga_facilities','ga_part_target_compatibilities','ga_part_compatibilities','ga_inventory_balances','ga_inventory_transactions','ga_inventory_transfers','ga_inventory_transfer_items','ga_inventory_location_parts','ga_service_requests','ga_part_fulfillments']) t
  where to_regclass('public.' || t) is null
),
b_cat as (
  select 'B 分類（Q4）', k.kind || ' 分類總數／啟用中／已刪除', k.total || ' ／ ' || k.active || ' ／ ' || k.deleted, '新版停用與刪除會先看底下的精確筆數'
  from (
    select 'part' as kind, count(*) filter (where deleted_at is null) as total, count(*) filter (where deleted_at is null and is_active) as active, count(*) filter (where deleted_at is not null) as deleted from ga_part_categories
    union all select 'equipment', count(*) filter (where deleted_at is null), count(*) filter (where deleted_at is null and is_active), count(*) filter (where deleted_at is not null) from ga_equipment_categories
    union all select 'facility', count(*) filter (where deleted_at is null), count(*) filter (where deleted_at is null and is_active), count(*) filter (where deleted_at is not null) from ga_facility_categories
  ) k
),
b_inactive_with_items as (
  select 'B 分類（Q4）', '已停用、但底下仍有啟用中項目的分類（舊版停用的後遺症）',
         (select count(*) from ga_part_categories c where c.deleted_at is null and not c.is_active and exists (select 1 from ga_parts p where p.category_id = c.id and p.deleted_at is null and p.is_active))::text
         || ' ／ ' || (select count(*) from ga_equipment_categories c where c.deleted_at is null and not c.is_active and exists (select 1 from ga_equipment e where e.category_id = c.id and e.deleted_at is null))::text
         || ' ／ ' || (select count(*) from ga_facility_categories c where c.deleted_at is null and not c.is_active and exists (select 1 from ga_facilities f where f.category_id = c.id and f.deleted_at is null))::text,
         '依序為 料件 ／ 設備 ／ 設施。大於 0 代表舊版允許了「分類停用、底下還在用」；新版不會再產生，現有的不會被改動，建議處理：到分類頁逐一確認'
),
c_parts as (
  select 'C 料件（Q5、Q6）', '料件總數／啟用中／已刪除', count(*) filter (where deleted_at is null)::text || ' ／ ' || count(*) filter (where deleted_at is null and is_active)::text || ' ／ ' || count(*) filter (where deleted_at is not null)::text, ''
  from ga_parts
),
c_notes as (
  select 'C 料件（Q5、Q6）', '有填內部備註的啟用料件（舊版店長看得到、新版店長看不到）', count(*)::text, 'Q5：新版店長只看基本欄位；備註只給有料件查看權限者'
  from ga_parts where deleted_at is null and is_active and nullif(btrim(coalesce(notes, '')), '') is not null
),
c_stock as (
  select 'C 料件（Q5、Q6）', '目前有庫存的料件數（新版：單位鎖定、不能刪除）', count(distinct part_id)::text, '庫存不為 0 的位置數：' || count(*)::text
  from ga_inventory_balances where quantity_base <> 0
),
c_tx as (
  select 'C 料件（Q5、Q6）', '曾有庫存交易的料件數（新版：單位欄位鎖定）', count(distinct part_id)::text, ''
  from ga_inventory_transactions
),
c_open as (
  select 'C 料件（Q5、Q6）', '被未結需求單／調撥單／料件處理單引用的料件數（新版：不能刪除）',
    (select count(distinct part_id) from (
       select part_id from ga_service_requests where part_id is not null and deleted_at is null and main_status not in ('COMPLETED','REJECTED','CANCELED')
       union select i.part_id from ga_inventory_transfer_items i join ga_inventory_transfers t on t.id = i.transfer_id where t.deleted_at is null and t.status in ('REQUESTED','SOURCE_CONFIRMED','IN_TRANSIT')
       union select r.part_id from ga_part_fulfillments f join ga_service_requests r on r.id = f.request_id where r.part_id is not null and f.deleted_at is null and f.status not in ('COMPLETED','CANCELED')
     ) u)::text, ''
),
c_dup as (
  select 'C 料件（Q5、Q6）', '品牌＋型號＋規格重複的料件組數（新增時新版會先跳確認）', count(*)::text, '建議處理：總務確認是否要合併（新版不會自動動它們）'
  from (select 1 from ga_parts where deleted_at is null and nullif(btrim(coalesce(brand,'')),'') is not null and nullif(btrim(coalesce(model,'')),'') is not null and nullif(btrim(coalesce(specification,'')),'') is not null
        group by brand, model, specification having count(*) > 1) d
),
c_sm as (
  select 'C 料件（Q5、Q6）', '店長角色帳號數（新版只看得到料件基本欄位）', count(distinct ur.user_id)::text, '角色代碼 store_manager 與 store_manager_role'
  from user_roles ur join roles r on r.id = ur.role_id where ur.is_active and r.code in ('store_manager','store_manager_role')
),
d_eqt as (
  select 'D 型號與架型（Q7）', '設備型號總數／使用中（有設備）／沒人用', count(*)::text || ' ／ ' || count(*) filter (where u.n > 0)::text || ' ／ ' || count(*) filter (where coalesce(u.n,0) = 0)::text, '有設備在用的型號新版只能停用，沒人用才能刪'
  from ga_equipment_templates t left join (select template_id, count(*) n from ga_equipment where deleted_at is null group by 1) u on u.template_id = t.id where t.deleted_at is null
),
d_fact as (
  select 'D 型號與架型（Q7）', '設施架型總數／使用中（有設施）／沒人用', count(*)::text || ' ／ ' || count(*) filter (where u.n > 0)::text || ' ／ ' || count(*) filter (where coalesce(u.n,0) = 0)::text, '新版補上架型刪除（舊版沒有）'
  from ga_facility_templates t left join (select facility_template_id, count(*) n from ga_facilities where deleted_at is null group by 1) u on u.facility_template_id = t.id where t.deleted_at is null
),
d_orphan as (
  select 'D 型號與架型（Q7）', '設備仍指向「已刪除型號」的筆數（舊版刪用中型號的後遺症）',
         (select count(*) from ga_equipment e join ga_equipment_templates t on t.id = e.template_id where e.deleted_at is null and t.deleted_at is not null)::text
         || ' ／ ' || (select count(*) from ga_facilities f join ga_facility_templates t on t.id = f.facility_template_id where f.deleted_at is null and t.deleted_at is not null)::text,
         '依序為 設備 ／ 設施。大於 0 代表舊版刪了用中的型號；建議處理：總務確認這些設備要歸到哪個型號'
),
d_unlinked as (
  select 'D 型號與架型（Q7）', '還沒歸戶到任何型號的設備數（「整理既有設備歸戶」的候選）', count(*)::text, '新版歸戶前會逐台顯示原值→新值，確認後才改，改了不能還原'
  from ga_equipment where deleted_at is null and template_id is null
),
e_att as (
  select 'E 附件（Q3）', '附件總數（未刪除）／已標記刪除', count(*) filter (where deleted_at is null)::text || ' ／ ' || count(*) filter (where deleted_at is not null)::text, ''
  from ga_resource_attachments
),
e_big as (
  select 'E 附件（Q3）', '超過 4MB 的未刪除附件數（新版：已存在的照常能看，新上傳超過 4MB 會被擋）', count(*)::text, '最大單檔 MB：' || coalesce(round(max(size_bytes) / 1048576.0, 1)::text, '0')
  from ga_resource_attachments where deleted_at is null and size_bytes > 4 * 1048576
),
e_type as (
  select 'E 附件（Q3）', '未刪除附件的格式分佈', coalesce(string_agg(content_type || '=' || n, '、' order by n desc), '無'), 'HEIC／HEIF 在多數電腦不能預覽，新版改顯示檔名與下載連結'
  from (select content_type, count(*) n from ga_resource_attachments where deleted_at is null group by 1) x
),
e_kept as (
  select 'E 附件（Q3）', '已標記刪除、但實體檔還在儲存空間的附件數（新版刪除只標記；舊版會永久刪檔）',
         (select count(*) from ga_resource_attachments a where a.deleted_at is not null and exists (select 1 from storage.objects o where o.bucket_id = a.storage_bucket and o.name = a.storage_path))::text,
         '舊版刪除會連檔一起刪，所以舊資料通常是 0；上線後這個數字會隨新版刪除增加，是刻意保留（可找回）'
),
f_policy as (
  select 'F 舊版缺陷確認（適用料件整批取代）', '適用料件對照表的資料庫規則（' || polname || '）',
         case polcmd when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE' when 'd' then 'DELETE' else 'ALL' end,
         coalesce(pg_get_expr(polqual, polrelid), '（無）')
  from pg_policy where polrelid = 'public.ga_part_target_compatibilities'::regclass
)
select * from a_fn
union all select * from a_tables
union all select * from b_cat
union all select * from b_inactive_with_items
union all select * from c_parts
union all select * from c_notes
union all select * from c_stock
union all select * from c_tx
union all select * from c_open
union all select * from c_dup
union all select * from c_sm
union all select * from d_eqt
union all select * from d_fact
union all select * from d_orphan
union all select * from d_unlinked
union all select * from e_att
union all select * from e_big
union all select * from e_type
union all select * from e_kept
union all select * from f_policy
order by 1, 2;
