-- 在 monthly_staff_status 表新增兩個獎金欄位
-- 1. last_month_single_item_bonus: 上個月個人單品獎金
-- 2. talent_cultivation_bonus: 本月育才獎金
-- 3. talent_cultivation_target: 育才對象

-- 新增欄位
ALTER TABLE public.monthly_staff_status
ADD COLUMN IF NOT EXISTS last_month_single_item_bonus INTEGER DEFAULT NULL,
ADD COLUMN IF NOT EXISTS talent_cultivation_bonus INTEGER DEFAULT NULL,
ADD COLUMN IF NOT EXISTS talent_cultivation_target TEXT DEFAULT NULL;

-- 加上註解
COMMENT ON COLUMN public.monthly_staff_status.last_month_single_item_bonus IS '上個月個人單品獎金（元）';
COMMENT ON COLUMN public.monthly_staff_status.talent_cultivation_bonus IS '本月育才獎金（元）';
COMMENT ON COLUMN public.monthly_staff_status.talent_cultivation_target IS '育才對象';
