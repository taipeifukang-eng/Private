import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// G46 水電話費請款：SQL 檔靜態檢查（DEV 檔與正式區草稿）。
//   每個 DEV 檔與正式區草稿都有 .rollback.sql；正式區每份有只有 SELECT 的 .verify.sql；00 預覽只有 SELECT；
//   正式區草稿與 DEV 實測檔的 SQL 內容相同（只差檔頭註解）；不授權給任何角色（沒有 role_permissions／permissions 的寫入）；
//   必要的守門都在（部分唯一索引、送出前缺附件、自動標記同步、來源隔離、撤回安全規則、加掛標記）；DEV 專用的角色與清除函式不進正式區草稿。
const ROOT = path.resolve(__dirname, '..', '..', '..');
const DEV = path.join(ROOT, 'supabase', 'workspace-dev');
const PROD = path.join(ROOT, 'docs', 'vue-workspace', 'parity-plan', 'ga-utility-payment-sql');
const read = (f: string) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
/** 去掉註解與字串內容，只看實際的 SQL 敘述。 */
const bare = (sql: string) =>
  sql
    .replace(/\$([a-z]*)\$[\s\S]*?\$\1\$/g, "''")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
const code = (sql: string) => sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').trim();

const STAGES = [
  { dev: '20261124100000_ga_utility_payment_schema', prod: '01-ga-utility-payment-schema' },
  { dev: '20261124110000_ga_utility_payment_bill_side', prod: '02-ga-utility-payment-bill-side' },
  { dev: '20261124120000_ga_utility_payment_request_core', prod: '03-ga-utility-payment-request-core' },
  { dev: '20261124130000_ga_utility_payment_request_hooks', prod: '04-ga-utility-payment-request-hooks' },
];
const WRITE = /\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|GRANT|REVOKE|TRUNCATE|COPY|DO|CALL|EXECUTE)\b/i;

describe('DEV 檔（supabase/workspace-dev）', () => {
  it.each([...STAGES.map((s) => s.dev), '20261124140000_ga_utility_payment_dev_seed'])('%s 與 .rollback.sql 都存在', (name) => {
    expect(fs.existsSync(path.join(DEV, `${name}.sql`))).toBe(true);
    expect(fs.existsSync(path.join(DEV, `${name}.rollback.sql`))).toBe(true);
  });
  it('DEV 專用角色與清除函式只在 140000（正式區草稿沒有）；角色代碼前綴 vue_workspace_gaup_', () => {
    const seed = read(path.join(DEV, '20261124140000_ga_utility_payment_dev_seed.sql'));
    expect(seed).toContain("'vue_workspace_gaup_clerk'");
    expect(seed).toContain('ga_dev_cleanup_ga_utility_payment');
    expect(seed).toMatch(/NOT LIKE 'vue\\_workspace\\_gaup\\_%'/);
    for (const f of fs.readdirSync(PROD)) {
      const t = read(path.join(PROD, f));
      expect(t, f).not.toContain('vue_workspace_gaup_');
      expect(t, f).not.toContain('ga_dev_cleanup');
    }
  });
});

describe('正式區草稿（docs/vue-workspace/parity-plan/ga-utility-payment-sql）', () => {
  it('檔案齊全：00 預覽、01 至 05 各有 .sql／.rollback.sql／.verify.sql、README', () => {
    expect(fs.existsSync(path.join(PROD, '00-preview-before-apply.sql'))).toBe(true);
    expect(fs.existsSync(path.join(PROD, 'README.md'))).toBe(true);
    for (const n of [...STAGES.map((s) => s.prod), '05-backfill-payee']) {
      for (const ext of ['.sql', '.rollback.sql', '.verify.sql']) expect(fs.existsSync(path.join(PROD, `${n}${ext}`)), `${n}${ext}`).toBe(true);
    }
  });
  it('00 預覽與每份 .verify.sql 只有 SELECT（沒有任何寫入、DDL、授權）', () => {
    const files = fs.readdirSync(PROD).filter((f) => f === '00-preview-before-apply.sql' || f.endsWith('.verify.sql'));
    expect(files.length).toBe(6);
    for (const f of files) {
      const s = bare(read(path.join(PROD, f)));
      expect(s, f).not.toMatch(WRITE);
      expect(s.trim().toUpperCase().startsWith('SELECT'), f).toBe(true);
    }
  });
  it('.verify.sql 回傳 pass／fail 列', () => {
    for (const f of fs.readdirSync(PROD).filter((x) => x.endsWith('.verify.sql'))) {
      const t = read(path.join(PROD, f));
      expect(t, f).toContain("'pass'");
      expect(t, f).toContain("'fail'");
    }
  });
  it('正式區 01 至 04 與 DEV 實測檔的 SQL 內容相同（只差檔頭註解與還原檔名）', () => {
    for (const s of STAGES) {
      for (const kind of ['', '.rollback']) {
        const dev = code(read(path.join(DEV, `${s.dev}${kind}.sql`)));
        const prod = code(read(path.join(PROD, `${s.prod}${kind}.sql`)));
        expect(prod, `${s.prod}${kind}`).toBe(dev);
      }
    }
  });
  it('不授權給任何角色：沒有寫入 role_permissions、permissions、user_roles；也沒有新增權限碼', () => {
    for (const f of fs.readdirSync(PROD).filter((x) => x.endsWith('.sql'))) {
      const s = bare(read(path.join(PROD, f)));
      expect(s, f).not.toMatch(/(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(public\.)?(role_permissions|permissions|user_roles|roles)\b/i);
    }
  });
  it('可重複執行：新增欄位、索引、表、觸發器都有 IF NOT EXISTS 或先 DROP IF EXISTS', () => {
    const t = read(path.join(PROD, '01-ga-utility-payment-schema.sql'));
    for (const m of t.matchAll(/ADD COLUMN\s+(IF NOT EXISTS\s+)?(\w+)/g)) expect(m[1], `ADD COLUMN ${m[2]}`).toBeTruthy();
    for (const m of t.matchAll(/CREATE (UNIQUE )?INDEX\s+(IF NOT EXISTS\s+)?(\w+)/g)) expect(m[2], `INDEX ${m[3]}`).toBeTruthy();
    for (const m of t.matchAll(/CREATE TABLE\s+(IF NOT EXISTS\s+)?([\w.]+)/g)) expect(m[1], `TABLE ${m[2]}`).toBeTruthy();
    for (const m of t.matchAll(/CREATE TRIGGER\s+(\w+)/g)) expect(t, `TRIGGER ${m[1]}`).toContain(`DROP TRIGGER IF EXISTS ${m[1]}`);
  });
});

describe('必要的守門都在', () => {
  const s1 = read(path.join(PROD, '01-ga-utility-payment-schema.sql'));
  const s2 = read(path.join(PROD, '02-ga-utility-payment-bill-side.sql'));
  const s3 = read(path.join(PROD, '03-ga-utility-payment-request-core.sql'));
  const s4 = read(path.join(PROD, '04-ga-utility-payment-request-hooks.sql'));
  it('01：新欄位有預設值（既有資料不重寫）、同一張帳單同時只能在一張有效請款單、水電明細表 RLS 全封', () => {
    expect(s1).toContain("source text NOT NULL DEFAULT 'PURCHASE'");
    expect(s1).toContain('auto_mark_paid boolean NOT NULL DEFAULT false');
    expect(s1).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS ga_payment_request_bill_lines_active_uidx ON public\.ga_payment_request_bill_lines \(bill_id\) WHERE active/);
    expect(s1).toContain('ALTER TABLE public.ga_payment_request_bill_lines ENABLE ROW LEVEL SECURITY');
    expect(s1).toMatch(/REVOKE ALL ON public\.ga_payment_request_bill_lines FROM PUBLIC, anon, authenticated/);
    expect(s1).toContain('SOURCE_MISMATCH');
    expect(s1).toContain('utility_payee_category_id');
  });
  it('02：帳單觸發器同步放行與鎖定、附件最後一個鎖、加掛標記', () => {
    expect(s2).toContain('ga.ub_sync_pr');
    expect(s2).toContain('BILL_IN_REQUEST');
    expect(s2).toContain('BILL_LAST_ATTACHMENT_LOCKED');
    expect(s2).toContain('-- GAUP-BEGIN');
    expect(s2).toContain('-- GAUP-END');
    expect(s2).toContain('GAUP-V2');
    expect(s2).toContain('ga_ub_check_payee(NEW.payee_vendor_id)');
    expect(s2).toContain('函式形狀與預期不符');
  });
  it('03：送出前檢查（兩個權限、缺附件整張擋下、金額快照）與狀態同步（只回復本單自動標記的帳單、作廢釋放）', () => {
    expect(s3).toContain('BILL_MISSING_ATTACHMENT');
    expect(s3).toContain('BILL_CHANGED');
    expect(s3).toContain('ga_ub_can_manage');
    expect(s3).toContain('paid_by_pr_id = NEW.id');
    expect(s3).toContain('SET active = false');
    expect(s3).toContain('NEW.status = \'VOID\'');
    expect(s3).toContain("'NO_BILLS'");
    expect(s3).toContain('pg_advisory_xact_lock');
    expect(s3).toMatch(/ORDER BY id FOR UPDATE/);
  });
  it('04：每處加掛都以來源為條件，採購函式 create／get／mark_paid 不動', () => {
    expect(s4).toContain("source = 'UTILITY'");
    expect(s4).toContain("'UTILITY'");
    for (const untouched of ['ga_ws_pay_request_create', 'ga_ws_pay_request_get', 'ga_pay_apply_lines', 'ga_pay_po_claimed']) {
      expect(bare(s4)).not.toContain(`'public.${untouched}(`);
    }
    expect(s4).toContain('函式形狀與預期不符');
  });
  it('撤回安全規則：已有非作廢水電請款單或自動標記的帳單時開頭就中止', () => {
    const rb = read(path.join(PROD, '01-ga-utility-payment-schema.rollback.sql'));
    expect(rb).toContain('不能撤回');
    expect(rb).toMatch(/source = 'UTILITY' AND status <> 'VOID'/);
    expect(rb).toContain('paid_by_pr_id IS NOT NULL');
    // 撤回 02、04 依標記移除加掛，不整支覆蓋
    for (const f of ['02-ga-utility-payment-bill-side.rollback.sql', '04-ga-utility-payment-request-hooks.rollback.sql']) expect(read(path.join(PROD, f)), f).toContain('ga_gaup_strip');
  });
  it('05 選用補填：先寫備份表、只在唯一對應時填、撤回依備份表清回空白', () => {
    const t = read(path.join(PROD, '05-backfill-payee.sql'));
    expect(t).toContain('ga_utility_bills_payee_backfill_bak');
    expect(t).toContain('HAVING count(*) = 1');
    expect(t).toContain('ga_vd_norm_name');
    expect(t).toContain('payee_vendor_id IS NULL');
    const rb = read(path.join(PROD, '05-backfill-payee.rollback.sql'));
    expect(rb).toContain('ga_utility_bills_payee_backfill_bak');
    expect(rb).toContain('SET payee_vendor_id = NULL');
  });
  it('README 寫明上線時間、不授權、撤回順序', () => {
    const r = read(path.join(PROD, 'README.md'));
    expect(r).toContain('12/8');
    expect(r).toContain('不授權');
    expect(r).toContain('04` → `03` → `02` → `01');
    expect(r).toContain('建議授權名單');
  });
});
