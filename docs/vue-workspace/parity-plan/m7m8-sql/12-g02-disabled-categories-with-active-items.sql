-- 12-g02-disabled-categories-with-active-items.sql
-- M7/M8 第 1 批（G02 分類，Q4）：列出「已停用、但底下仍有啟用中資料」的分類名單。
-- 純唯讀：只有 SELECT，沒有任何 INSERT/UPDATE/DELETE/DDL，正式區與 DEV 都可整份貼上執行。
-- 為什麼要看：舊版允許停用分類時底下還有東西，且停用後底下每一筆資料都改不動（資料庫會擋）。新版不會再產生這種分類，
--   但既有的不會被自動改動，上線前請看一下這份名單，再到新版分類頁逐一處理（把底下資料搬走，或把分類重新啟用）。
-- 計算方式與新版「停用分類」檢查完全相同：底下指「這個分類與它所有子孫分類」。
--   啟用中的子分類 = 子孫分類 is_active = true 且未刪除
--   啟用中的項目：料件 = 啟用且未刪除的料件；設備 = 未刪除的設備 + 啟用且未刪除的設備型號；設施 = 未刪除的設施 + 啟用且未刪除的設施架型
-- 結果欄位：category_type（料件／設備／設施）、category_path（完整路徑）、code、active_children（啟用中子分類數）、
--   active_items（啟用中項目數）、active_items_detail（項目分項）。沒有資料列代表沒有這種分類。最後一列 section=總計 為各類型筆數。

with recursive
-- 料件
pc as (select id, parent_id, name, code, is_active from ga_part_categories where deleted_at is null),
pc_tree as (
  select id as root_id, id as node_id from pc
  union all
  select t.root_id, c.id from pc_tree t join pc c on c.parent_id = t.node_id
),
pc_path as (
  select id, parent_id, name::text as path from pc where parent_id is null
  union all
  select c.id, c.parent_id, p.path || ' / ' || c.name from pc c join pc_path p on c.parent_id = p.id
),
part_rows as (
  select '料件'::text as category_type, r.id, r.code, pp.path,
         (select count(*) from pc_tree t join pc d on d.id = t.node_id where t.root_id = r.id and t.node_id <> r.id and d.is_active) as active_children,
         (select count(*) from ga_parts x where x.category_id in (select node_id from pc_tree where root_id = r.id) and x.deleted_at is null and x.is_active) as n1,
         0::bigint as n2,
         '啟用料件'::text as l1, ''::text as l2
  from pc r left join pc_path pp on pp.id = r.id
  where not r.is_active
),
-- 設備
ec as (select id, parent_id, name, code, is_active from ga_equipment_categories where deleted_at is null),
ec_tree as (
  select id as root_id, id as node_id from ec
  union all
  select t.root_id, c.id from ec_tree t join ec c on c.parent_id = t.node_id
),
ec_path as (
  select id, parent_id, name::text as path from ec where parent_id is null
  union all
  select c.id, c.parent_id, p.path || ' / ' || c.name from ec c join ec_path p on c.parent_id = p.id
),
equipment_rows as (
  select '設備'::text, r.id, r.code, pp.path,
         (select count(*) from ec_tree t join ec d on d.id = t.node_id where t.root_id = r.id and t.node_id <> r.id and d.is_active),
         (select count(*) from ga_equipment x where x.category_id in (select node_id from ec_tree where root_id = r.id) and x.deleted_at is null),
         (select count(*) from ga_equipment_templates x where x.category_id in (select node_id from ec_tree where root_id = r.id) and x.deleted_at is null and x.is_active),
         '設備'::text, '啟用設備型號'::text
  from ec r left join ec_path pp on pp.id = r.id
  where not r.is_active
),
-- 設施
fc as (select id, parent_id, name, code, is_active from ga_facility_categories where deleted_at is null),
fc_tree as (
  select id as root_id, id as node_id from fc
  union all
  select t.root_id, c.id from fc_tree t join fc c on c.parent_id = t.node_id
),
fc_path as (
  select id, parent_id, name::text as path from fc where parent_id is null
  union all
  select c.id, c.parent_id, p.path || ' / ' || c.name from fc c join fc_path p on c.parent_id = p.id
),
facility_rows as (
  select '設施'::text, r.id, r.code, pp.path,
         (select count(*) from fc_tree t join fc d on d.id = t.node_id where t.root_id = r.id and t.node_id <> r.id and d.is_active),
         (select count(*) from ga_facilities x where x.category_id in (select node_id from fc_tree where root_id = r.id) and x.deleted_at is null),
         (select count(*) from ga_facility_templates x where x.category_id in (select node_id from fc_tree where root_id = r.id) and x.deleted_at is null and x.is_active),
         '設施'::text, '啟用設施架型'::text
  from fc r left join fc_path pp on pp.id = r.id
  where not r.is_active
),
all_rows as (
  select * from part_rows union all select * from equipment_rows union all select * from facility_rows
),
hits as (
  select category_type, path as category_path, code, active_children, (n1 + n2) as active_items,
         case when category_type = '料件' then l1 || ' ' || n1
              else l1 || ' ' || n1 || '、' || l2 || ' ' || n2 end as active_items_detail
  from all_rows
  where active_children > 0 or (n1 + n2) > 0
)
select '名單' as section, category_type, category_path, code, active_children, active_items, active_items_detail
from hits
union all
select '總計', t.category_type, '共 ' || count(h.code) || ' 個分類', null, coalesce(sum(h.active_children), 0), coalesce(sum(h.active_items), 0),
       '0 代表這一類沒有舊版留下的問題'
from (values ('料件'), ('設備'), ('設施')) t(category_type)
left join hits h on h.category_type = t.category_type
group by t.category_type
order by 1 desc, 2, 3;
