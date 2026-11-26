-- 還原 20261126110000_ga_pr_print_fields.sql（請款單紙本格式列印欄位）。
-- 安全規則：已有請款單填了列印欄位就中止（請先確認這些資料可以丟掉；測試資料請先清除）。可重複執行。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_payment_requests' AND column_name = 'applicant_name') THEN
    IF EXISTS (SELECT 1 FROM public.ga_payment_requests WHERE applicant_name IS NOT NULL OR applicant_dept IS NOT NULL OR attach_docs IS NOT NULL OR reason_override IS NOT NULL) THEN
      RAISE EXCEPTION '不能撤回：還有請款單填了申請人／申請部門／檢附單據／申請事由。';
    END IF;
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.ga_ws_pay_request_print_fields_set(uuid, jsonb);
DROP FUNCTION IF EXISTS public.ga_ws_pay_request_print_extra(uuid);
ALTER TABLE public.ga_payment_requests DROP CONSTRAINT IF EXISTS ga_pr_print_fields_len;
ALTER TABLE public.ga_payment_requests
  DROP COLUMN IF EXISTS applicant_name,
  DROP COLUMN IF EXISTS applicant_dept,
  DROP COLUMN IF EXISTS attach_docs,
  DROP COLUMN IF EXISTS reason_override;
NOTIFY pgrst, 'reload schema';
