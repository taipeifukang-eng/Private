-- M7/M8 第 4.5 批 E（G45，P4）：請款權限碼，只新增兩個、不指派給任何角色（角色授權由使用者決定）。
--   general_affairs.purchase_payment.view   查看進貨發票、請款單、請款設定、對帳匯出與採購單的發票與請款分頁
--   general_affairs.purchase_payment.manage 新增與編輯發票、登錄進貨憑證、建立／送出／退回／標已付款／作廢請款單、調整尾差與買受人設定、上傳發票圖片（涵蓋 view 的讀取能力）
-- 不新增 approve、pay 權限碼（P3 請款不核准；P4 manage 一把抓，制衡靠不可改刪的操作紀錄）。
-- 還原：20261119140000_m7m8_b45_permissions.rollback.sql（連同角色對這兩個碼的授權一併移除）。可重複執行。
DO $$
BEGIN
  IF to_regclass('public.permissions') IS NULL THEN RAISE EXCEPTION 'Missing prerequisite table: permissions'; END IF;
END $$;

INSERT INTO public.permissions (module, feature, code, action, description, is_active)
VALUES ('general_affairs', 'purchase_payment', 'general_affairs.purchase_payment.view', 'view',
        '請款查看：查看進貨發票、請款單、請款設定與對帳匯出，以及採購單的「發票與請款」分頁（金額、統編與銀行資訊另需廠商查看權限）', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.permissions (module, feature, code, action, description, is_active)
VALUES ('general_affairs', 'purchase_payment', 'general_affairs.purchase_payment.manage', 'manage',
        '請款管理：登錄進貨憑證與發票、建立與送出請款單、退回、標已付款、作廢、調整尾差與買受人設定（申請人可自己標已付款；所有動作留不可修改的操作紀錄）', true)
ON CONFLICT (code) DO NOTHING;
