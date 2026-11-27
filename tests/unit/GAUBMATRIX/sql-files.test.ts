import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// ga-ub-year-matrix：SQL 檔靜態檢查。正式區草稿與 DEV 實測檔內容相同（只差註解）；唯讀函式、只給登入者、沿用水電檢視權限；verify 只有 SELECT。
const ROOT = path.resolve(__dirname, '..', '..', '..');
const DEV = path.join(ROOT, 'supabase', 'workspace-dev', '20261127110000_ga_ub_year_matrix');
const PROD_DIR = path.join(ROOT, 'docs', 'vue-workspace', 'parity-plan', 'ga-utility-journey-sql');
const PROD = path.join(PROD_DIR, '02-ga-ub-year-matrix');
const read = (f: string) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const code = (sql: string) => sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').trim();
const WRITE = /\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|GRANT|REVOKE|TRUNCATE|COPY|DO|CALL|EXECUTE)\b/i;

describe('ga-ub-year-matrix SQL', () => {
  it('正式區 .sql 與 .rollback.sql 和 DEV 檔內容相同（只差註解）', () => {
    expect(code(read(`${PROD}.sql`))).toBe(code(read(`${DEV}.sql`)));
    expect(code(read(`${PROD}.rollback.sql`))).toBe(code(read(`${DEV}.rollback.sql`)));
  });
  it('檔案齊全，README 有 02 的白話段落', () => {
    for (const f of [`${DEV}.sql`, `${DEV}.rollback.sql`, `${PROD}.sql`, `${PROD}.rollback.sql`, `${PROD}.verify.sql`, path.join(PROD_DIR, 'README.md')]) expect(fs.existsSync(f)).toBe(true);
    expect(read(path.join(PROD_DIR, 'README.md'))).toContain('02 水電話費總表年度逐月');
  });
  it('不改 supabase/migrations、不新增權限碼、不授權角色、不建表不加欄位', () => {
    const sql = code(read(`${DEV}.sql`));
    expect(sql).not.toMatch(/role_permissions|INSERT INTO|CREATE TABLE|ALTER TABLE/i);
    expect(fs.readdirSync(path.join(ROOT, 'supabase', 'migrations')).some((f) => /year_matrix/.test(f))).toBe(false);
  });
  it('函式唯讀（STABLE）、SECURITY DEFINER、固定 search_path，沿用水電檢視權限與登入檢查', () => {
    const sql = read(`${DEV}.sql`);
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.ga_ws_ub_year_matrix(p_year integer)');
    expect(sql).toMatch(/LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'/);
    expect(sql).toContain('public.ga_ub_can_view(v_uid)');
    expect(sql).toContain("AUTH_REQUIRED");
    expect(sql).toContain("BAD_YEAR");
  });
  it('依帳單月份歸月、不含已刪除、啟用門市都列、口徑與月報表相同', () => {
    const sql = read(`${DEV}.sql`);
    expect(sql).toContain('b.deleted_at IS NULL AND b.billing_month >= v_start AND b.billing_month < v_end');
    expect(sql).toContain('extract(month FROM b.billing_month)');
    expect(sql).toContain('is_active IS TRUE');
    expect(sql).toContain("NFKC");
  });
  it('只開放給登入者，不給匿名', () => {
    const sql = read(`${DEV}.sql`);
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.ga_ws_ub_year_matrix(integer) FROM PUBLIC, anon;');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.ga_ws_ub_year_matrix(integer) TO authenticated;');
  });
  it('rollback 只移除這支函式', () => {
    const sql = code(read(`${DEV}.rollback.sql`));
    expect(sql).toContain('DROP FUNCTION IF EXISTS public.ga_ws_ub_year_matrix(integer);');
    expect(sql).not.toMatch(/DROP (TABLE|COLUMN)|DELETE/i);
  });
  it('verify 只有 SELECT，沒有寫入', () => {
    const sql = code(read(`${PROD}.verify.sql`));
    expect(sql).toMatch(/^SELECT/);
    expect(sql.replace(/'[^']*'/g, "''")).not.toMatch(WRITE);
  });
});
