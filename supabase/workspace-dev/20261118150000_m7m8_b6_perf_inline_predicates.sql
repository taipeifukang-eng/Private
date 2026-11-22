-- M7/M8 第 6 批 十萬級實測效能修正（DEV）：待我處理述詞函式改為可內嵌（RESET search_path）。對應正式區草稿 49。
-- 2026-11-18 十萬級假資料實測（DEV）：首頁摘要 14.8 秒、徽章 3.5 秒、水電帳單逾期篩選 1.1 秒、採購單待我處理篩選逾時；主因是這些「待我處理」述詞函式帶 SET search_path，
-- 無法被規劃器內嵌，每一列都要呼叫函式（內層還再呼叫 ga_po_today）。函式本體都是只用內建運算子與 public.ga_po_today() 的單一運算式，
-- 拿掉函式層級 search_path（ga_vd_contract_due 不動：G20-G21 函式目錄測試規定 ga_vd_* 固定 search_path，且只掃廠商表，實測 63 ms） 設定（RESET）後可內嵌，首頁摘要降到 0.45 秒、徽章 0.12 秒。函式本體與回傳值完全不變；不新增索引、不改資料。
-- 必須在 46（ga_att_*）、45（ga_ub_is_overdue）、47（ga_wo_focus）與第 4 批 33（ga_po_today）之後套用；若之後重跑 46、45、44、47，要再重跑本檔。
BEGIN;
DO $$
BEGIN
  IF to_regprocedure('public.ga_po_today()') IS NULL THEN RAISE EXCEPTION '缺少函式 public.ga_po_today()，請先套用 44、45、46、47 與第 4 批 33'; END IF;
  IF to_regprocedure('public.ga_att_request_intake(text)') IS NULL THEN RAISE EXCEPTION '缺少函式 public.ga_att_request_intake(text)，請先套用 44、45、46、47 與第 4 批 33'; END IF;
  IF to_regprocedure('public.ga_att_store_wait(text)') IS NULL THEN RAISE EXCEPTION '缺少函式 public.ga_att_store_wait(text)，請先套用 44、45、46、47 與第 4 批 33'; END IF;
  IF to_regprocedure('public.ga_att_po_overdue(text,date)') IS NULL THEN RAISE EXCEPTION '缺少函式 public.ga_att_po_overdue(text,date)，請先套用 44、45、46、47 與第 4 批 33'; END IF;
  IF to_regprocedure('public.ga_att_po(text,date,boolean)') IS NULL THEN RAISE EXCEPTION '缺少函式 public.ga_att_po(text,date,boolean)，請先套用 44、45、46、47 與第 4 批 33'; END IF;
  IF to_regprocedure('public.ga_att_transfer_overdue(text,timestamp with time zone,integer)') IS NULL THEN RAISE EXCEPTION '缺少函式 public.ga_att_transfer_overdue(text,timestamptz,integer)，請先套用 44、45、46、47 與第 4 批 33'; END IF;
  IF to_regprocedure('public.ga_ub_is_overdue(date,date,timestamp with time zone)') IS NULL THEN RAISE EXCEPTION '缺少函式 public.ga_ub_is_overdue(date,date,timestamptz)，請先套用 44、45、46、47 與第 4 批 33'; END IF;
  IF to_regprocedure('public.ga_wo_focus(text,text)') IS NULL THEN RAISE EXCEPTION '缺少函式 public.ga_wo_focus(text,text)，請先套用 44、45、46、47 與第 4 批 33'; END IF;
END $$;
ALTER FUNCTION public.ga_po_today() RESET search_path;
ALTER FUNCTION public.ga_att_request_intake(text) RESET search_path;
ALTER FUNCTION public.ga_att_store_wait(text) RESET search_path;
ALTER FUNCTION public.ga_att_po_overdue(text,date) RESET search_path;
ALTER FUNCTION public.ga_att_po(text,date,boolean) RESET search_path;
ALTER FUNCTION public.ga_att_transfer_overdue(text,timestamp with time zone,integer) RESET search_path;
ALTER FUNCTION public.ga_ub_is_overdue(date,date,timestamp with time zone) RESET search_path;
ALTER FUNCTION public.ga_wo_focus(text,text) RESET search_path;
COMMIT;
