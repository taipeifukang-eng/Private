import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// ga-ub-scan-upload：SQL 檔靜態檢查。正式區草稿與 DEV 實測檔內容相同（只差註解）；權杖只存雜湊；資料表不給匿名與登入者；公開用的函式只給 service_role；verify 只有 SELECT。
const ROOT = path.resolve(__dirname, '..', '..', '..');
const DEV = path.join(ROOT, 'supabase', 'workspace-dev', '20261127120000_ga_ub_scan_upload');
const PROD_DIR = path.join(ROOT, 'docs', 'vue-workspace', 'parity-plan', 'ga-utility-journey-sql');
const PROD = path.join(PROD_DIR, '03-ga-ub-scan-upload');
const read = (f: string) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const code = (sql: string) => sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').trim();
const WRITE = /\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|GRANT|REVOKE|TRUNCATE|COPY|DO|CALL|EXECUTE)\b/i;

describe('ga-ub-scan-upload SQL', () => {
  it('正式區 .sql 與 .rollback.sql 和 DEV 檔內容相同（只差註解）', () => {
    expect(code(read(`${PROD}.sql`))).toBe(code(read(`${DEV}.sql`)));
    expect(code(read(`${PROD}.rollback.sql`))).toBe(code(read(`${DEV}.rollback.sql`)));
  });
  it('檔案齊全，README 有 03 的白話段落，不改 supabase/migrations', () => {
    for (const f of [`${DEV}.sql`, `${DEV}.rollback.sql`, `${PROD}.sql`, `${PROD}.rollback.sql`, `${PROD}.verify.sql`, path.join(PROD_DIR, 'README.md')]) expect(fs.existsSync(f)).toBe(true);
    expect(read(path.join(PROD_DIR, 'README.md'))).toContain('03 水電帳單手機掃 QR 拍照上傳');
    expect(fs.readdirSync(path.join(ROOT, 'supabase', 'migrations')).some((f) => /scan_upload/.test(f))).toBe(false);
  });
  it('權杖只存雜湊（64 位十六進位檢查），沒有存明文權杖的欄位', () => {
    const sql = read(`${DEV}.sql`);
    expect(sql).toContain("CHECK (token_hash ~ '^[0-9a-f]{64}$')");
    expect(sql).not.toMatch(/\btoken\s+text/i);
    expect(sql).toContain('token_hash text NOT NULL UNIQUE');
  });
  it('15 分鐘、10 張的規則寫在資料庫（建立時 15 分鐘、檢查最長 1 小時、張數 1～10）', () => {
    const sql = read(`${DEV}.sql`);
    expect(sql).toContain("now() + interval '15 minutes'");
    expect(sql).toContain('max_files BETWEEN 1 AND 10');
    expect(sql).toContain('used_count <= max_files');
    expect(sql).toContain('t.used_count + v_n > t.max_files');
    expect(sql).toContain('t.expires_at <= now()');
    expect(sql).toContain('FOR UPDATE');
  });
  it('資料表開 RLS、無政策、不授權匿名與登入者', () => {
    const sql = code(read(`${DEV}.sql`));
    expect(sql).toContain('ALTER TABLE public.ga_ub_scan_tokens ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain('REVOKE ALL ON public.ga_ub_scan_tokens FROM PUBLIC, anon, authenticated;');
    expect(sql).not.toMatch(/CREATE POLICY/i);
  });
  it('寫入只能到這張帳單的 BILL_DOCUMENT（路徑前綴檢查）、以發出者身分寫入並還原', () => {
    const sql = read(`${DEV}.sql`);
    expect(sql).toContain("'utility_bill/' || t.bill_id::text || '/bill_document/'");
    expect(sql).toContain("'UTILITY_BILL', t.bill_id, 'BILL_DOCUMENT'");
    expect(sql).toContain("set_config('request.jwt.claim.sub', t.issued_by::text, true)");
    expect(sql).toContain("set_config('request.jwt.claim.sub', COALESCE(v_old_sub, ''), true)");
  });
  it('帳單鎖定＝已刪除或在已送出／已付款的請款單內', () => {
    const sql = read(`${DEV}.sql`);
    expect(sql).toContain("q.status IN ('SUBMITTED', 'PAID')");
    expect(sql).toContain("<> 'OK' THEN RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'BILL_LOCKED')");
  });
  it('發 QR 只給登入者；查詢與寫入函式只給 service_role', () => {
    const sql = code(read(`${DEV}.sql`));
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.ga_ws_ub_scan_token_create(uuid, text) FROM PUBLIC, anon;');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.ga_ws_ub_scan_token_create(uuid, text) TO authenticated, service_role;');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.ga_ub_scan_token_status(text) FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.ga_ub_scan_token_commit(text, jsonb) FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('TO service_role;');
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.ga_ub_scan_token_(status|commit)[^;]*authenticated/);
  });
  it('rollback 移除資料表與四支函式，不碰附件資料', () => {
    const sql = code(read(`${DEV}.rollback.sql`));
    for (const f of ['ga_ub_scan_token_commit(text, jsonb)', 'ga_ub_scan_token_status(text)', 'ga_ws_ub_scan_token_create(uuid, text)', 'ga_ub_scan_bill_state(uuid)']) expect(sql).toContain(`DROP FUNCTION IF EXISTS public.${f};`);
    expect(sql).toContain('DROP TABLE IF EXISTS public.ga_ub_scan_tokens;');
    expect(sql).not.toMatch(/ga_resource_attachments/);
  });
  it('verify 只有 SELECT，沒有寫入', () => {
    const sql = code(read(`${PROD}.verify.sql`));
    expect(sql).toMatch(/^SELECT/);
    expect(sql.replace(/'[^']*'/g, "''")).not.toMatch(WRITE);
  });
});
