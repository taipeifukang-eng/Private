-- ============================================================================
-- 每月人員狀態 vs 業績管理處方箋：一般箋/慢箋張數比對（純唯讀）
--
-- 用途：每月人員狀態「該月營業狀態」的一般箋、慢箋張數改顯示處方箋資料
--       (monthly_prescription_reports)；處方箋沒有該月該店資料時，退回顯示
--       monthly_store_summary 舊匯入值。這支 SQL 用來看兩邊歷史數字差多少。
--
-- 只讀：整份只有一個 SELECT 查詢，不含 INSERT / UPDATE / DELETE / DDL，不會改任何資料。
--       可直接整份貼到正式區 Supabase SQL Editor 執行。
--       SQL Editor 只顯示最後一個結果，所以這裡刻意合併成「單一查詢」，
--       用第一欄「類別」區分：先是摘要筆數，再是各類明細（月份新到舊、門市代號排序）。
--
-- 對應鍵：(year_month, store_id)。monthly_store_summary 在此兩欄有唯一約束，
--         monthly_prescription_reports 主鍵即為此兩欄，因此 JOIN 不會重複計列。
-- 總公司 0000 不在處方箋範圍，不列入比對。
--
-- 類別說明：
--   摘要 1~7        各情況的筆數（放在「筆數」欄，其餘欄位為空）
--   明細-不一致     兩邊都有資料，但一般箋或慢箋張數不一致
--                   （處方箋該張數為 NULL 視為「處方箋尚未填」，不算不一致）
--   明細-只有月統計 只有舊匯入有資料（畫面會退回顯示舊匯入值）
--   明細-只有處方箋 只有處方箋有資料
--   摘要 5 的提醒：monthly_store_summary 這兩欄預設值是 0，「從沒匯入過、只被預設成 0」
--   的空列和「真的匯入 0」無法區分；摘要 5 單獨算出兩欄都是 0 的筆數，供判斷灌水程度。
-- ============================================================================

WITH paired AS (
  SELECT
    COALESCE(m.year_month, r.year_month)  AS ym,
    COALESCE(s.store_code, '')            AS store_code,
    s.store_name                          AS store_name,
    (m.store_id IS NOT NULL)              AS has_summary,
    (r.store_id IS NOT NULL)              AS has_rx,
    m.regular_prescription_count          AS m_reg,
    m.chronic_prescription_count          AS m_chr,
    r.regular_prescription_count          AS r_reg,
    r.chronic_prescription_count          AS r_chr
  FROM public.monthly_store_summary m
  FULL OUTER JOIN public.monthly_prescription_reports r
    ON r.year_month = m.year_month AND r.store_id = m.store_id
  LEFT JOIN public.stores s
    ON s.id = COALESCE(m.store_id, r.store_id)
  WHERE btrim(COALESCE(s.store_code, '')) <> '0000'
),
mismatch AS (
  SELECT * FROM paired
  WHERE has_summary AND has_rx
    AND (
      (r_reg IS NOT NULL AND m_reg IS DISTINCT FROM r_reg)
      OR
      (r_chr IS NOT NULL AND m_chr IS DISTINCT FROM r_chr)
    )
)
SELECT *
FROM (
  -- 摘要
  SELECT 1 AS ord, '摘要 1 兩邊都有資料'::text AS 類別, NULL::text AS 門市代號, NULL::text AS 門市名, NULL::text AS 月份,
         NULL::bigint AS 舊匯入_一般箋, NULL::bigint AS 舊匯入_慢箋, NULL::bigint AS 處方箋_一般箋, NULL::bigint AS 處方箋_慢箋,
         count(*)::bigint AS 筆數
    FROM paired WHERE has_summary AND has_rx
  UNION ALL
  SELECT 2, '摘要 2 其中一般箋或慢箋不一致（處方箋有值才比）', NULL, NULL, NULL, NULL, NULL, NULL, NULL, count(*)
    FROM mismatch
  UNION ALL
  SELECT 3, '摘要 3 其中處方箋張數有 NULL（該欄會退回舊匯入值）', NULL, NULL, NULL, NULL, NULL, NULL, NULL, count(*)
    FROM paired WHERE has_summary AND has_rx AND (r_reg IS NULL OR r_chr IS NULL)
  UNION ALL
  SELECT 4, '摘要 4 只有月統計(舊匯入)有資料（會退回舊匯入值）', NULL, NULL, NULL, NULL, NULL, NULL, NULL, count(*)
    FROM paired WHERE has_summary AND NOT has_rx
  UNION ALL
  SELECT 5, '摘要 5 其中兩欄皆為 0（可能只是預設值的空列）', NULL, NULL, NULL, NULL, NULL, NULL, NULL, count(*)
    FROM paired WHERE has_summary AND NOT has_rx AND m_reg = 0 AND m_chr = 0
  UNION ALL
  SELECT 6, '摘要 6 只有處方箋有資料', NULL, NULL, NULL, NULL, NULL, NULL, NULL, count(*)
    FROM paired WHERE has_rx AND NOT has_summary
  UNION ALL
  SELECT 7, '摘要 7 月統計舊匯入張數為 NULL（兩欄任一）', NULL, NULL, NULL, NULL, NULL, NULL, NULL, count(*)
    FROM paired WHERE has_summary AND (m_reg IS NULL OR m_chr IS NULL)

  UNION ALL
  -- 明細：兩邊都有但不一致
  SELECT 10, '明細-不一致', store_code, store_name, ym, m_reg, m_chr, r_reg, r_chr, NULL::bigint
    FROM mismatch

  UNION ALL
  -- 明細：只有月統計（舊匯入）
  SELECT 20, '明細-只有月統計', store_code, store_name, ym, m_reg, m_chr, NULL::bigint, NULL::bigint, NULL::bigint
    FROM paired WHERE has_summary AND NOT has_rx

  UNION ALL
  -- 明細：只有處方箋
  SELECT 30, '明細-只有處方箋', store_code, store_name, ym, NULL::bigint, NULL::bigint, r_reg, r_chr, NULL::bigint
    FROM paired WHERE has_rx AND NOT has_summary
) t
ORDER BY ord, 月份 DESC NULLS LAST, 門市代號;
