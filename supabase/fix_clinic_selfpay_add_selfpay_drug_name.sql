-- 補齊診所自費藥名稱欄位（既有環境）
alter table if exists public.clinic_selfpay_price_entries
  add column if not exists selfpay_drug_name text;
