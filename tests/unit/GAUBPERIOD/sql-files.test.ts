import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// ga-ub-billing-period：SQL 檔靜態檢查。正式區草稿與 DEV 實測檔內容相同（只差註解）；欄位可空、CHECK、五支既有函式完整新版、rollback 還原原版、新函式唯讀且不給匿名、verify 只有 SELECT。
const ROOT = path.resolve(__dirname, '..', '..', '..');
const DEV = path.join(ROOT, 'supabase', 'workspace-dev', '20261127130000_ga_ub_billing_period');
const PROD_DIR = path.join(ROOT, 'docs', 'vue-workspace', 'parity-plan', 'ga-utility-journey-sql');
const PROD = path.join(PROD_DIR, '04-ga-ub-billing-period');
const read = (f: string) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const code = (sql: string) => sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').trim();
const WRITE = /\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|GRANT|REVOKE|TRUNCATE|COPY|DO|CALL|EXECUTE)\b/i;
/** 取某支函式的完整定義文字（CREATE OR REPLACE FUNCTION 名稱 … 到下一個 $function$; 或 $$;）。 */
const fnBody = (sql: string, name: string) => {
  const i = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(i, `找不到函式 ${name}`).toBeGreaterThanOrEqual(0);
  const j = sql.indexOf('$function$;', sql.indexOf('$function$', sql.indexOf('AS $function$', i) + 5));
  return sql.slice(i, j + 11);
};
const CHANGED = ['ga_ws_ub_save', 'ga_ub_json_ext', 'ga_pay_ub_apply_bills', 'ga_pay_ub_json_ext', 'ga_ws_pay_ub_candidates'];

describe('ga-ub-billing-period SQL', () => {
  it('正式區 .sql 與 .rollback.sql 和 DEV 檔內容相同（只差註解）', () => {
    expect(code(read(`${PROD}.sql`))).toBe(code(read(`${DEV}.sql`)));
    expect(code(read(`${PROD}.rollback.sql`))).toBe(code(read(`${DEV}.rollback.sql`)));
  });
  it('檔案齊全，README 有 04 的白話段落（含先決、套用順序、撤回、風險），不改 supabase/migrations', () => {
    for (const f of [`${DEV}.sql`, `${DEV}.rollback.sql`, `${PROD}.sql`, `${PROD}.rollback.sql`, `${PROD}.verify.sql`, path.join(PROD_DIR, 'README.md')]) expect(fs.existsSync(f)).toBe(true);
    const readme = read(path.join(PROD_DIR, 'README.md'));
    const sec = readme.slice(readme.indexOf('## 04 水電帳單計費期間'));
    expect(sec.length).toBeGreaterThan(200);
    for (const h of ['### 先決條件', '### 套用順序', '### 撤回', '### 風險', '### 設計判斷']) expect(sec).toContain(h);
    expect(sec).toContain('快照');
    expect(fs.readdirSync(path.join(ROOT, 'supabase', 'migrations')).some((f) => /billing_period/.test(f))).toBe(false);
  });
  it('四個新欄位都是 DATE、可空（沒有 NOT NULL），CHECK：都填且起 <= 迄，或都空', () => {
    const sql = code(read(`${DEV}.sql`));
    for (const t of ['ga_utility_bills', 'ga_payment_request_bill_lines']) {
      expect(sql).toContain(`ALTER TABLE public.${t} ADD COLUMN IF NOT EXISTS service_period_start date;`);
      expect(sql).toContain(`ALTER TABLE public.${t} ADD COLUMN IF NOT EXISTS service_period_end date;`);
    }
    expect(sql).not.toMatch(/service_period_(start|end) date NOT NULL/i);
    expect(sql).toContain('ga_utility_bills_service_period_check');
    expect(sql).toContain('(service_period_start IS NULL AND service_period_end IS NULL) OR (service_period_start IS NOT NULL AND service_period_end IS NOT NULL AND service_period_start <= service_period_end)');
  });
  it('不新增權限碼、不授權角色、不建新資料表', () => {
    const sql = code(read(`${DEV}.sql`));
    expect(sql).not.toMatch(/role_permissions|INSERT INTO public\.(permissions|role_permissions)|CREATE TABLE/i);
  });
  it('帳單儲存函式：水費電費必填、起迄一起填、迄不早於起、超過 70 天只回警示不擋、新增與更新都寫期間', () => {
    const sql = read(`${DEV}.sql`);
    const save = fnBody(sql, 'ga_ws_ub_save');
    expect(save).toContain("v_ps IS NULL AND v_type IN ('WATER', 'ELECTRICITY')");
    expect(save).toContain("'PERIOD_REQUIRED'");
    expect(save).toContain("'PERIOD_INCOMPLETE'");
    expect(save).toContain("'PERIOD_ORDER'");
    expect(save).toContain('(v_pe - v_ps + 1) > 70');
    expect(save).toContain("'PERIOD_LONG'");
    expect(save).not.toMatch(/ga_rq_err\(\d+, 'PERIOD_LONG'/); // 只是警示，不是錯誤
    expect(save).toContain('service_period_start = v_ps, service_period_end = v_pe');
    expect(save).toContain('v_notes, v_ps, v_pe) RETURNING');
    // 原有規則沒被拿掉
    for (const k of ['DUPLICATE_BILL', 'PAID_CHANGE_CONFIRM_REQUIRED', 'STALE', 'IDENT_REQUIRED', 'ga_ub_anomaly', 'GAUP-BEGIN']) expect(save).toContain(k);
  });
  it('請款明細快照：建立明細時複製帳單的期間；請款單 JSON 與候選帳單帶期間與天數', () => {
    const sql = read(`${DEV}.sql`);
    const apply = fnBody(sql, 'ga_pay_ub_apply_bills');
    expect(apply).toContain('due_date, service_period_start, service_period_end)');
    expect(apply).toContain('b.due_date, b.service_period_start, b.service_period_end)');
    expect(fnBody(sql, 'ga_pay_ub_json_ext')).toContain("'period_days'");
    expect(fnBody(sql, 'ga_ws_pay_ub_candidates')).toContain("'period_days'");
    expect(fnBody(sql, 'ga_ub_json_ext')).toContain("'period_days'");
  });
  it('請款單送出前檢查與帳單鎖定欄位沒有被改（舊帳單不鎖死）', () => {
    const sql = code(read(`${DEV}.sql`));
    expect(sql).not.toContain('ga_pay_ub_submit_check');
    expect(sql).not.toContain('ga_pay_ub_bill_lock_check');
  });
  it('只改這五支既有函式；每一支在 rollback 都有原版（CREATE OR REPLACE）', () => {
    const dev = read(`${DEV}.sql`);
    const rb = read(`${DEV}.rollback.sql`);
    const created = (dev.match(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g) || []).map((x) => x.replace(/CREATE OR REPLACE FUNCTION public\.|\(/g, ''));
    expect(created.slice().sort()).toEqual([...CHANGED, 'ga_ws_ub_prev_period', 'ga_ws_ub_report_details'].sort());
    for (const n of CHANGED) {
      expect(rb).toContain(`CREATE OR REPLACE FUNCTION public.${n}(`);
      // 原版不含期間字樣
      expect(fnBody(rb, n)).not.toContain('service_period');
    }
    expect(rb).not.toContain('PERIOD_REQUIRED');
  });
  it('新函式唯讀（STABLE）、SECURITY DEFINER、固定 search_path、檢查登入與水電檢視權限、不給匿名', () => {
    const sql = read(`${DEV}.sql`);
    for (const n of ['ga_ws_ub_prev_period', 'ga_ws_ub_report_details']) {
      const b = fnBody(sql, n);
      expect(b).toMatch(/STABLE SECURITY DEFINER/);
      expect(b).toContain("SET search_path TO 'public', 'pg_temp'");
      expect(b).toContain('public.ga_ub_can_view(v_uid)');
      expect(b).toContain('AUTH_REQUIRED');
      expect(b).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    }
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.ga_ws_ub_prev_period(jsonb, uuid) FROM PUBLIC, anon;');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.ga_ws_ub_prev_period(jsonb, uuid) TO authenticated;');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.ga_ws_ub_report_details(text, integer, text) FROM PUBLIC, anon;');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.ga_ws_ub_report_details(text, integer, text) TO authenticated;');
  });
  it('上一期：同門市或同據點名稱、同類型、同識別，未刪除、迄日最大者；明細頁依門市、類型、帳單月份排序且不含已刪除', () => {
    const sql = read(`${DEV}.sql`);
    const prev = fnBody(sql, 'ga_ws_ub_prev_period');
    expect(prev).toContain('d.deleted_at IS NULL AND d.service_period_end IS NOT NULL');
    expect(prev).toContain('ORDER BY d.service_period_end DESC');
    expect(prev).toContain('public.ga_ub_ident(d.service_identifier, d.equipment_serial, d.account_number) = v_ident');
    const det = fnBody(sql, 'ga_ws_ub_report_details');
    expect(det).toContain('b.deleted_at IS NULL AND b.billing_month >= v_start AND b.billing_month < v_end');
    expect(det).toContain("WHEN 'WATER' THEN 1 WHEN 'ELECTRICITY' THEN 2 WHEN 'PHONE' THEN 3 ELSE 4 END, t.billing_month");
  });
  it('rollback：移除新函式、CHECK 與四個新欄位', () => {
    const rb = code(read(`${DEV}.rollback.sql`));
    expect(rb).toContain('DROP FUNCTION IF EXISTS public.ga_ws_ub_prev_period(jsonb, uuid);');
    expect(rb).toContain('DROP FUNCTION IF EXISTS public.ga_ws_ub_report_details(text, integer, text);');
    expect(rb).toContain('DROP CONSTRAINT IF EXISTS ga_utility_bills_service_period_check');
    expect((rb.match(/DROP COLUMN IF EXISTS service_period_(start|end)/g) || []).length).toBe(4);
  });
  it('verify 只有 SELECT，沒有寫入', () => {
    const sql = code(read(`${PROD}.verify.sql`));
    expect(sql).toMatch(/^SELECT/);
    expect(sql.replace(/'[^']*'/g, "''")).not.toMatch(WRITE);
  });
  it('檔案用 LF、不含 NUL', () => {
    for (const f of [`${DEV}.sql`, `${DEV}.rollback.sql`, `${PROD}.sql`, `${PROD}.rollback.sql`, `${PROD}.verify.sql`, path.join(PROD_DIR, 'README.md')]) {
      const raw = fs.readFileSync(f, 'utf8');
      expect(raw.includes('\r'), f).toBe(false);
      expect(raw.includes('\u0000'), f).toBe(false);
    }
  });
});
