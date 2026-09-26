INSERT INTO public.maintenance_progress_stages (code, name, sort_order, is_active)
VALUES
  ('INITIAL_REVIEW', '初步評估', 10, true),
  ('WAITING_STORE_INFO', '等待門市補充資料', 20, true),
  ('INTERNAL_HANDLING', '總務自行處理', 30, true),
  ('SEARCHING_VENDOR', '尋找廠商', 40, true),
  ('WAITING_VENDOR_REPLY', '等待廠商回覆', 50, true),
  ('WAITING_VENDOR_QUOTE', '等待廠商報價', 60, true),
  ('QUOTE_REVIEW', '報價確認中', 70, true),
  ('VENDOR_ASSIGNED', '已安排廠商', 80, true),
  ('WAITING_VENDOR_VISIT', '等待廠商到場', 90, true),
  ('VENDOR_WORKING', '廠商施工中', 100, true),
  ('WAITING_PARTS', '等待料件', 110, true),
  ('PARTS_IN_TRANSIT', '料件配送中', 120, true),
  ('WAITING_INTERNAL_APPROVAL', '等待內部確認', 130, true),
  ('WAITING_STORE_CONFIRMATION', '處理完成待門市確認', 140, true),
  ('REOPENED', '門市反映仍有問題', 150, true),
  ('OTHER', '其他', 990, true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active,
  updated_at = now();

NOTIFY pgrst, 'reload schema';
