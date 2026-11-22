-- 【正式區草稿，尚未套用】撤回 24：移除觸發器與函式，不影響任何資料。
-- 還原 20261110130000_m7m8_b9_block_terminal_with_open_transfer.sql：移除兩個觸發器與函式（不影響任何資料）。
DROP TRIGGER IF EXISTS trg_ga_equipment_block_terminal_open_transfer ON public.ga_equipment;
DROP TRIGGER IF EXISTS trg_ga_facilities_block_terminal_open_transfer ON public.ga_facilities;
DROP FUNCTION IF EXISTS public.ga_block_terminal_status_with_open_transfer();
NOTIFY pgrst, 'reload schema';
