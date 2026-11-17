-- ============================================================================
-- 每月人員狀態 vs 業績管理處方箋：一般箋/慢箋張數比對（純唯讀）
--
-- 用途：每月人員狀態「該月營業狀態」的一般箋、慢箋張數改顯示處方箋資料
--       (monthly_prescription_reports)；處方箋沒有該月該店資料時，退回顯示
--       monthly_store_summary 舊匯入值。這支 SQL 用來看兩邊歷史數字差多少。
--
-- 只讀：整份只有 SELECT，不含 INSERT / UPDATE / DELETE / DDL，不會改任何資料。
--       可直接貼到正式區 Supabase SQL Editor 執行（建議整份一起執行，會出三個結果）。
--
-- 對應鍵：(year_month, store_id)。總公司 0000 不在處方箋範圍，不列入比對。
-- ============================================================================

-- 結果 1：兩邊都有資料，但一般箋或慢箋張數不一致的明細
-- （處方箋該張數為 NULL 視為「處方箋尚未填」，不算不一致，列在結果 3 的摘要）
SELECT
  s.store_code                              AS 門市代號,
  s.store_name                              AS 門市名,
  m.year_month                              AS 月份,
  m.regular_prescription_count              AS 舊匯入_一般箋,
  r.regular_prescription_count              AS 處方箋_一般箋,
  m.chronic_prescription_count              AS 舊匯入_慢箋,
  r.chronic_prescription_count              AS 處方箋_慢箋
FROM public.monthly_store_summary m
JOIN public.monthly_prescription_reports r
  ON r.year_month = m.year_month AND r.store_id = m.store_id
JOIN public.stores s
  ON s.id = m.store_id
WHERE btrim(s.store_code) <> '0000'
  AND (
    (r.regular_prescription_count IS NOT NULL
      AND m.regular_prescription_count IS DISTINCT FROM r.regular_prescription_count)
    OR
    (r.chronic_prescription_count IS NOT NULL
      AND m.chronic_prescription_count IS DISTINCT FROM r.chronic_prescription_count)
  )
ORDER BY m.year_month DESC, s.store_code;

-- 結果 2：兩邊各自只有一方有資料的明細（月份、門市）
SELECT
  COALESCE(s1.store_code, s2.store_code)    AS 門市代號,
  COALESCE(s1.store_name, s2.store_name)    AS 門市名,
  COALESCE(m.year_month, r.year_month)      AS 月份,
  CASE WHEN r.store_id IS NULL THEN '只有月統計(舊匯入)' ELSE '只有處方箋' END AS 哪邊有,
  m.regular_prescription_count              AS 舊匯入_一般箋,
  m.chronic_prescription_count              AS 舊匯入_慢箋,
  r.regular_prescription_count              AS 處方箋_一般箋,
  r.chronic_prescription_count              AS 處方箋_慢箋
FROM public.monthly_store_summary m
FULL OUTER JOIN public.monthly_prescription_reports r
  ON r.year_month = m.year_month AND r.store_id = m.store_id
LEFT JOIN public.stores s1 ON s1.id = m.store_id
LEFT JOIN public.stores s2 ON s2.id = r.store_id
WHERE (m.store_id IS NULL OR r.store_id IS NULL)
  AND btrim(COALESCE(s1.store_code, s2.store_code, '')) <> '0000'
ORDER BY 3 DESC, 1;

-- 結果 3：筆數摘要
WITH paired AS (
  SELECT
    COALESCE(m.year_month, r.year_month) AS ym,
    COALESCE(m.store_id, r.store_id)     AS sid,
    (m.store_id IS NOT NULL)             AS has_summary,
    (r.store_id IS NOT NULL)             AS has_rx,
    m.regular_prescription_count         AS m_reg,
    m.chronic_prescription_count         AS m_chr,
    r.regular_prescription_count         AS r_reg,
    r.chronic_prescription_count         AS r_chr
  FROM public.monthly_store_summary m
  FULL OUTER JOIN public.monthly_prescription_reports r
    ON r.year_month = m.year_month AND r.store_id = m.store_id
  JOIN public.stores s ON s.id = COALESCE(m.store_id, r.store_id)
  WHERE btrim(s.store_code) <> '0000'
)
SELECT '兩邊都有資料'                                   AS 項目, count(*) AS 筆數 FROM paired WHERE has_summary AND has_rx
UNION ALL
SELECT '  其中一般箋或慢箋不一致（處方箋有值才比）',    count(*) FROM paired
  WHERE has_summary AND has_rx
    AND ((r_reg IS NOT NULL AND m_reg IS DISTINCT FROM r_reg) OR (r_chr IS NOT NULL AND m_chr IS DISTINCT FROM r_chr))
UNION ALL
SELECT '  其中處方箋張數有 NULL（會退回舊匯入值）',     count(*) FROM paired
  WHERE has_summary AND has_rx AND (r_reg IS NULL OR r_chr IS NULL)
UNION ALL
SELECT '只有月統計(舊匯入)有資料（會退回舊匯入值）',     count(*) FROM paired WHERE has_summary AND NOT has_rx
UNION ALL
SELECT '只有處方箋有資料',                               count(*) FROM paired WHERE has_rx AND NOT has_summary;
