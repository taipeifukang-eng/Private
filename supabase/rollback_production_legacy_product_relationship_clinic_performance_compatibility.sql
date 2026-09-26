-- Rollback P1-G Production legacy product / relationship member / clinic self-pay / performance compatibility schema.
-- DEV-only rollback. Do not run in Production.

DROP TABLE IF EXISTS public.monthly_performance_details;
DROP TABLE IF EXISTS public.store_performance_thresholds;
DROP TABLE IF EXISTS public.clinic_selfpay_claim_items;
DROP TABLE IF EXISTS public.clinic_selfpay_claim_batches;
DROP TABLE IF EXISTS public.clinic_selfpay_price_month_closures;
DROP TABLE IF EXISTS public.clinic_selfpay_price_entries;
DROP TABLE IF EXISTS public.relationship_sales_details;
DROP TABLE IF EXISTS public.relationship_sales_imports;
DROP TABLE IF EXISTS public.relationship_members;
DROP TABLE IF EXISTS public.acquisition_unmatched;
DROP TABLE IF EXISTS public.acquisition_scans;
DROP TABLE IF EXISTS public.product_barcodes;
DROP TABLE IF EXISTS public.products_master;

-- Keep public.update_updated_at_column(); it is shared by legacy parity batches.
