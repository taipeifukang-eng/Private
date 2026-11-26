-- 唯讀驗證 08_legacy_qr_revoke_trigger.sql（只有 SELECT）。套用後每列 ok 都應為 true；rollback 後應為 false。
SELECT 'function:ga_revoke_asset_qr_on_terminal_status()' AS item,
  to_regprocedure('public.ga_revoke_asset_qr_on_terminal_status()') IS NOT NULL AS ok
UNION ALL
SELECT 'function_not_security_definer_search_path',
  EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.ga_revoke_asset_qr_on_terminal_status()')
          AND NOT p.prosecdef AND p.proconfig @> ARRAY['search_path=public, pg_temp'])
UNION ALL
SELECT 'trigger:'||g.tg||' on '||g.tbl||'（BEFORE INSERT OR UPDATE，每列，欄位 status／deleted_at／qr_token_revoked_at）',
  EXISTS (
    SELECT 1 FROM pg_trigger x
    WHERE x.tgname = g.tg AND x.tgrelid = to_regclass('public.'||g.tbl) AND NOT x.tgisinternal AND x.tgenabled <> 'D'
      AND x.tgfoid = to_regprocedure('public.ga_revoke_asset_qr_on_terminal_status()')
      AND (x.tgtype & 1) = 1      -- FOR EACH ROW
      AND (x.tgtype & 2) = 2      -- BEFORE
      AND (x.tgtype & 4) = 4      -- INSERT
      AND (x.tgtype & 16) = 16    -- UPDATE
      AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM unnest(x.tgattr) k JOIN pg_attribute a ON a.attrelid = x.tgrelid AND a.attnum = k)
          = ARRAY['deleted_at','qr_token_revoked_at','status'])
FROM (VALUES ('trg_ga_equipment_qr_auto_revoke','ga_equipment'),('trg_ga_facilities_qr_auto_revoke','ga_facilities')) g(tg, tbl)
UNION ALL
SELECT 'column:'||c.t||'.'||c.col,
  EXISTS (SELECT 1 FROM information_schema.columns i WHERE i.table_schema='public' AND i.table_name=c.t AND i.column_name=c.col)
FROM (VALUES ('ga_equipment','status'),('ga_equipment','deleted_at'),('ga_equipment','qr_token_revoked_at'),
             ('ga_facilities','status'),('ga_facilities','deleted_at'),('ga_facilities','qr_token_revoked_at')) c(t, col)
UNION ALL
-- 與步驟「進行中轉移單擋報廢」的觸發器名稱不同、互不衝突（資訊用：有裝才會出現）
SELECT 'info:同表其他 BEFORE 觸發器數量（供參考，不影響結果）='||count(*)::text, true
FROM pg_trigger x WHERE NOT x.tgisinternal AND x.tgrelid IN (to_regclass('public.ga_equipment'), to_regclass('public.ga_facilities'))
  AND x.tgname NOT IN ('trg_ga_equipment_qr_auto_revoke','trg_ga_facilities_qr_auto_revoke')
ORDER BY 1;
