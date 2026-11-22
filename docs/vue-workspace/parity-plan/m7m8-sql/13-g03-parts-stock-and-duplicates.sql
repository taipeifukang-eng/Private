-- 13-g03-parts-stock-and-duplicates.sql
-- M7/M8 第 1 批（G03 料件主檔，Q6）：新版「單位鎖定、不能刪除、重複確認」會影響到哪些既有料件的唯讀名單。
-- 純唯讀：只有 SELECT，沒有任何 INSERT/UPDATE/DELETE/DDL，正式區與 DEV 都可整份貼上執行。
-- 單一結果集，欄位：section（區段）、item（項目）、value（數字或名稱）、detail（補充說明）。
--
-- A 摘要
--   A1 料件總數（未刪除）／啟用中
--   A2 目前有庫存的料件數：庫存不為 0 的位置至少一個（新版：基本單位、採購單位、換算率鎖定，不能刪除）
--   A3 曾有庫存交易的料件數：交易紀錄至少一筆（新版：單位欄位鎖定；沒有庫存且沒有未結單時仍可刪除）
--   A4 單位已鎖定的料件數：A2 或 A3 任一成立（與新版 ga_ws_part_usage 的 unit_locked 規則相同）
--   A5 被未結單引用、新版不能刪除的料件數（需求單、調撥單、料件處理單未結案）
--   A6 完全重複的料件組數與涉及料件數：品牌、型號、規格三欄都有值且完全相同（與新版新增時的偵測一致，舊版後端同樣會偵測但畫面沒顯示）
-- B 完全重複的料件（每一列一個料件；同一組的 group_no 相同）
--   看庫存分散在哪幾筆、哪一筆有交易紀錄，供總務決定要不要合併（新版不會自動合併）。
-- C 單位已鎖定的料件（有庫存或有交易），最多列 200 筆，依庫存位置數、交易數排序
--
-- 完全重複的比對方式：去掉前後空白後，品牌、型號、規格三欄「完全相同」（大小寫視為不同，與新版偵測一致）。
-- 只比對未刪除的料件；已停用但未刪除的也列入，因為仍會分散庫存與適用對照。

with p as (
  select id, name, part_code, brand, model, specification, base_unit, is_active
  from ga_parts where deleted_at is null
),
stock as (
  select part_id, count(*) filter (where quantity_base <> 0) as stock_locations, coalesce(sum(quantity_base), 0) as stock_total
  from ga_inventory_balances group by part_id
),
tx as (select part_id, count(*) as tx_count from ga_inventory_transactions group by part_id),
usage as (
  select p.*, coalesce(s.stock_locations, 0) as stock_locations, coalesce(s.stock_total, 0) as stock_total, coalesce(t.tx_count, 0) as tx_count
  from p left join stock s on s.part_id = p.id left join tx t on t.part_id = p.id
),
open_parts as (
  select part_id from ga_service_requests where part_id is not null and deleted_at is null and main_status not in ('COMPLETED','REJECTED','CANCELED')
  union
  select i.part_id from ga_inventory_transfer_items i join ga_inventory_transfers t on t.id = i.transfer_id
    where t.deleted_at is null and t.status in ('REQUESTED','SOURCE_CONFIRMED','IN_TRANSIT')
  union
  select r.part_id from ga_part_fulfillments f join ga_service_requests r on r.id = f.request_id
    where r.part_id is not null and f.deleted_at is null and f.status not in ('COMPLETED','CANCELED')
),
keyed as (
  select u.*, btrim(brand) as k_brand, btrim(model) as k_model, btrim(specification) as k_spec
  from usage u
  where nullif(btrim(coalesce(brand, '')), '') is not null
    and nullif(btrim(coalesce(model, '')), '') is not null
    and nullif(btrim(coalesce(specification, '')), '') is not null
),
dup as (
  select k.*, dense_rank() over (order by k_brand, k_model, k_spec) as group_no,
         count(*) over (partition by k_brand, k_model, k_spec) as group_size
  from keyed k
),
dup_only as (select * from dup where group_size > 1),
locked as (select * from usage where stock_locations > 0 or tx_count > 0)
select section, item, value, detail from (
  select 'A 摘要' as section, 1 as ord1, 0::bigint as ord2, 'A1 料件總數（未刪除）／啟用中' as item,
         (select count(*) from p)::text || ' ／ ' || (select count(*) from p where is_active)::text as value, '' as detail
  union all
  select 'A 摘要', 2, 0, 'A2 目前有庫存的料件數', (select count(*) from usage where stock_locations > 0)::text,
         '庫存不為 0 的位置合計 ' || (select coalesce(sum(stock_locations), 0) from usage)::text || ' 個；新版：單位鎖定、不能刪除（請先把庫存調為 0，或改用停用）'
  union all
  select 'A 摘要', 3, 0, 'A3 曾有庫存交易的料件數', (select count(*) from usage where tx_count > 0)::text, '新版：單位欄位鎖定；沒有庫存且沒有未結單時仍可刪除'
  union all
  select 'A 摘要', 4, 0, 'A4 單位已鎖定的料件數（有庫存或有交易）', (select count(*) from locked)::text, '新版編輯這些料件時，基本單位、採購單位、換算率不能改；要改單位請新增另一個料件'
  union all
  select 'A 摘要', 5, 0, 'A5 被未結單引用、不能刪除的料件數', (select count(*) from usage where id in (select part_id from open_parts))::text, '需求單、調撥單、料件處理單尚未結案；結案或取消後才能刪，或改用停用'
  union all
  select 'A 摘要', 6, 0, 'A6 完全重複的料件組數／涉及料件數', (select count(distinct group_no) from dup_only)::text || ' ／ ' || (select count(*) from dup_only)::text,
         '品牌＋型號＋規格完全相同；詳見 B 區。大於 0 代表舊版曾讓重複料件建立成功，庫存與適用對照被拆開；新版不會自動合併'
  union all
  -- B：完全重複的料件
  select 'B 完全重複', 10, group_no * 1000 + row_number() over (partition by group_no order by stock_locations desc, tx_count desc, name, id),
         '第 ' || group_no || ' 組（共 ' || group_size || ' 筆）：' || name,
         coalesce(part_code, '（無代碼）') || '｜' || k_brand || ' / ' || k_model || ' / ' || k_spec,
         '單位 ' || base_unit || '｜' || (case when is_active then '啟用中' else '已停用' end)
           || '｜有庫存位置 ' || stock_locations || ' 個（合計 ' || stock_total || '）｜交易 ' || tx_count || ' 筆｜id ' || id::text
  from dup_only
  union all
  select 'B 完全重複', 10, 0, '（沒有完全重複的料件）', '0', '' where not exists (select 1 from dup_only)
  union all
  -- C：單位已鎖定的料件（最多 200 筆）
  select 'C 單位已鎖定', 20, rn, name, coalesce(part_code, '（無代碼）'),
         '單位 ' || base_unit || '｜有庫存位置 ' || stock_locations || ' 個（合計 ' || stock_total || '）｜交易 ' || tx_count || ' 筆｜' || (case when is_active then '啟用中' else '已停用' end) || '｜id ' || id::text
  from (select l.*, row_number() over (order by stock_locations desc, tx_count desc, name, id) as rn from locked l) l
  where rn <= 200
  union all
  select 'C 單位已鎖定', 20, 0, '（沒有有庫存或交易的料件）', '0', '' where not exists (select 1 from locked)
) r
order by ord1, ord2, item;
