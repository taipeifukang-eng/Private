import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// ga-pr-print：SQL 檔靜態檢查。正式區草稿與 DEV 實測檔內容相同；只加可空欄位與兩支新函式；不授權給角色、不新增權限碼、不改既有函式；verify 只有 SELECT。
const ROOT = path.resolve(__dirname, '..', '..', '..');
const DEV = path.join(ROOT, 'supabase', 'workspace-dev', '20261126110000_ga_pr_print_fields');
const PROD = path.join(ROOT, 'docs', 'vue-workspace', 'parity-plan', 'ga-print-sql', '01-ga-pr-print-fields');
const read = (f: string) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const stripComments = (sql: string) => sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').trim();

describe('ga-pr-print SQL', () => {
  it('正式區 .sql 與 .rollback.sql 與 DEV 檔內容相同', () => {
    expect(stripComments(read(`${PROD}.sql`))).toBe(stripComments(read(`${DEV}.sql`)));
    expect(stripComments(read(`${PROD}.rollback.sql`))).toBe(stripComments(read(`${DEV}.rollback.sql`)));
  });
  it('正式區草稿四個檔案都存在', () => {
    for (const f of [`${PROD}.sql`, `${PROD}.rollback.sql`, `${PROD}.verify.sql`, path.join(path.dirname(PROD), 'README.md')]) expect(fs.existsSync(f)).toBe(true);
  });
  it('新欄位全部可空（沒有 NOT NULL、沒有預設值）', () => {
    const sql = read(`${DEV}.sql`);
    const cols = sql.match(/ADD COLUMN IF NOT EXISTS (\w+) text(,|;)/g) || [];
    expect(cols).toHaveLength(4);
    expect(sql).not.toMatch(/ADD COLUMN[^;]*NOT NULL/);
    expect(sql).not.toMatch(/ADD COLUMN[^;]*DEFAULT/);
  });
  it('不授權給角色、不新增權限碼、不改既有請款單函式', () => {
    const sql = stripComments(read(`${DEV}.sql`));
    expect(sql).not.toMatch(/role_permissions|INSERT INTO public\.permissions/i);
    const created = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)/g)].map((m) => m[1]);
    expect(created.sort()).toEqual(['ga_ws_pay_request_print_extra', 'ga_ws_pay_request_print_fields_set']);
  });
  it('寫入函式需請款管理權限、作廢不能改、只寫操作紀錄 update 且不動 updated_at', () => {
    const sql = read(`${DEV}.sql`);
    expect(sql).toContain('ga_pay_can_manage(v_uid)');
    expect(sql).toContain("q.status = 'VOID'");
    expect(sql).toContain("ga_pay_event(q.id, 'update'");
    expect(sql).not.toMatch(/SET[^;]*updated_at/);
  });
  it('唯讀補充函式需請款檢視，帳單備註另需水電檢視', () => {
    const sql = read(`${DEV}.sql`);
    expect(sql).toContain('ga_pay_can_view(v_uid)');
    expect(sql).toContain('ga_ub_can_view(v_uid)');
  });
  it('兩支函式都收回匿名與 PUBLIC 的執行權限', () => {
    const sql = read(`${DEV}.sql`);
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.ga_ws_pay_request_print_fields_set(uuid, jsonb) FROM PUBLIC, anon');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.ga_ws_pay_request_print_extra(uuid) FROM PUBLIC, anon');
  });
  it('撤回前檢查已填資料；verify 只有 SELECT', () => {
    expect(read(`${DEV}.rollback.sql`)).toContain('不能撤回');
    const v = stripComments(read(`${PROD}.verify.sql`));
    expect(v).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|GRANT|REVOKE|TRUNCATE)\b/i);
    expect(v.startsWith('SELECT')).toBe(true);
  });
});

// 使用單位逐列可改（第 2 組）：正式區草稿與 DEV 檔相同；只加一個可空 jsonb 欄位、只換同一支函式；撤回成四欄位版本。
const DEV2 = path.join(ROOT, 'supabase', 'workspace-dev', '20261126130000_ga_pr_print_units');
const PROD2 = path.join(ROOT, 'docs', 'vue-workspace', 'parity-plan', 'ga-print-sql', '02-ga-pr-print-units');
describe('ga-pr-print-units SQL', () => {
  it('正式區 .sql 與 .rollback.sql 與 DEV 檔內容相同，四個檔案齊全', () => {
    expect(stripComments(read(`${PROD2}.sql`))).toBe(stripComments(read(`${DEV2}.sql`)));
    expect(stripComments(read(`${PROD2}.rollback.sql`))).toBe(stripComments(read(`${DEV2}.rollback.sql`)));
    for (const f of [`${PROD2}.verify.sql`, path.join(path.dirname(PROD2), 'README.md')]) expect(fs.existsSync(f)).toBe(true);
  });
  it('新欄位可空 jsonb、無預設值；只替換儲存列印欄位函式、不授權角色', () => {
    const sql = read(`${DEV2}.sql`);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS print_units jsonb;/);
    expect(sql).not.toMatch(/ADD COLUMN[^;]*(NOT NULL|DEFAULT)/);
    const s2 = stripComments(sql);
    expect([...s2.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)/g)].map((m) => m[1])).toEqual(['ga_ws_pay_request_print_fields_set']);
    expect(s2).not.toMatch(/role_permissions|INSERT INTO public\.permissions/i);
    expect(sql).toContain('ga_pay_can_manage(v_uid)');
    expect(sql).toContain("'print_units'::text");
    expect(sql).toContain('FROM PUBLIC, anon');
  });
  it('使用單位在資料庫端也驗證：40 字、50 列、型別', () => {
    const sql = read(`${DEV2}.sql`);
    expect(sql).toContain('> 40');
    expect(sql).toContain('> 50');
    expect(sql).toContain("jsonb_typeof(r.v) <> 'string'");
  });
  it('撤回前檢查已填資料、還原成四欄位版本；verify 只有 SELECT', () => {
    const rb = read(`${DEV2}.rollback.sql`);
    expect(rb).toContain('不能撤回');
    expect(rb).not.toContain("p ? 'units'");
    expect(rb).toContain('DROP COLUMN IF EXISTS print_units');
    const v = stripComments(read(`${PROD2}.verify.sql`));
    expect(v).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|GRANT|REVOKE|TRUNCATE)\b/i);
    expect(v.startsWith('SELECT')).toBe(true);
  });
});
