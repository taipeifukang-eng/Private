-- 藥師月份快照關帳表
-- 關帳後 ensureSnapshotForMonth 會跳過該月份，不再自動異動已確認的快照資料
create table if not exists public.pharmacist_snapshot_locks (
  year_month text primary key check (year_month ~ '^\d{4}-\d{2}$'),
  locked_at  timestamptz not null default now(),
  locked_by  text        not null default ''
);

comment on table public.pharmacist_snapshot_locks is
  '藥師月份快照關帳紀錄：關帳後該月快照不再被程式自動修改';
