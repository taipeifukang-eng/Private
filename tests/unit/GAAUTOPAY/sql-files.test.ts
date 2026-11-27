import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// ga-auto-pay-due：SQL 檔靜態檢查。正式區草稿與 DEV 實測檔內容相同（只差檔頭註解）；不授權角色、不新增權限碼；
// 排程函式只給 service_role；守門旗標例外只有兩個；每天台北 00:05（UTC 16:05）排程；rollback 有安全中止；verify 只有 SELECT。
const ROOT = path.resolve(__dirname, '..', '..', '..');
const DEV = path.join(ROOT, 'supabase', 'workspace-dev', '20261127100000_ga_auto_pay_due');
const PROD_DIR = path.join(ROOT, 'docs', 'vue-workspace', 'parity-plan', 'ga-utility-journey-sql');
const PROD = path.join(PROD_DIR, '01-ga-auto-pay-due');
const read = (f: string) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const code = (sql: string) => sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').trim();
const WRITE = /\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|GRANT|REVOKE|TRUNCATE|COPY|DO|CALL|EXECUTE)\b/i;

describe('ga-auto-pay-due SQL', () => {
  it('正式區 .sql 與 .rollback.sql 和 DEV 檔內容相同（只差註解）', () => {
    expect(code(read(`${PROD}.sql`))).toBe(code(read(`${DEV}.sql`)));
    expect(code(read(`${PROD}.rollback.sql`))).toBe(code(read(`${DEV}.rollback.sql`)));
  });
  it('檔案齊全：DEV 兩檔、正式區草稿三檔加白話 README', () => {
    for (const f of [`${DEV}.sql`, `${DEV}.rollback.sql`, `${PROD}.sql`, `${PROD}.rollback.sql`, `${PROD}.verify.sql`, path.join(PROD_DIR, 'README.md')]) expect(fs.existsSync(f)).toBe(true);
  });
  it('不授權給任何角色、不新增權限碼、不動 supabase/migrations', () => {
    const sql = code(read(`${DEV}.sql`));
    expect(sql).not.toMatch(/role_permissions|INSERT INTO public\.permissions/i);
    expect(fs.readdirSync(path.join(ROOT, 'supabase', 'migrations')).some((f) => /auto_pay/.test(f))).toBe(false);
  });
  it('新欄位 paid_auto、auto_pay_off 預設 false 不可空', () => {
    const sql = read(`${DEV}.sql`);
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS paid_auto boolean NOT NULL DEFAULT false');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS auto_pay_off boolean NOT NULL DEFAULT false');
  });
  it('已付款必填只放寬 paid_by（自動標記才可空），事件類型多 cancel_auto_pay 且保留舊類型', () => {
    const sql = read(`${DEV}.sql`);
    expect(sql).toContain('(paid_by IS NOT NULL OR paid_auto)');
    for (const t of ['create', 'update', 'submit', 'return', 'mark_paid', 'void', 'note', 'refresh_bank', 'prepay_refund', 'cancel_auto_pay']) expect(sql).toContain(`'${t}'`);
  });
  it('守門只加兩個交易內旗標例外，原有訊息都在；paid_auto 只能由排程設定、由取消函式清除', () => {
    const sql = read(`${DEV}.sql`);
    expect(sql).toContain("current_setting('ga.pay_auto_mark', true)");
    expect(sql).toContain("current_setting('ga.pay_auto_cancel', true)");
    for (const m of ['已作廢的請款單不能再修改', '請款單狀態不能從 % 改成 %', '已送出或已付款的請款單，金額、廠商與銀行資料不能修改', '已付款的請款單，付款資訊不能修改']) expect(sql).toContain(m);
    expect(sql).toContain('只有付款日到期的自動排程可以標記自動付款');
    expect(sql).toContain('自動付款標記只能用「取消自動付款」清除');
    // 旗標用 set_config(..., true)（交易內有效），用完清空
    expect(sql).toContain("set_config('ga.pay_auto_mark', q.id::text, true)");
    expect(sql).toContain("set_config('ga.pay_auto_cancel', q.id::text, true)");
    expect(sql).not.toMatch(/set_config\('ga\.pay_auto_(mark|cancel)'[^)]*false\)/);
  });
  it('付款日規則：預計付款日優先；水電才用帳單最早繳費期限；只算有效明細', () => {
    const sql = read(`${DEV}.sql`);
    expect(sql).toContain('COALESCE(q.expected_pay_date,');
    expect(sql).toContain("WHEN q.source = 'UTILITY'");
    expect(sql).toContain('min(COALESCE(l.due_date, b.due_date))');
    expect(sql).toContain('l.active');
  });
  it('排程函式：只處理 SUBMITTED 且沒取消、付款日到期；paid_date 用付款日；預設 TRANSFER；每張單獨立子交易；單張失敗不影響其他張', () => {
    const sql = read(`${DEV}.sql`);
    expect(sql).toContain("WHERE status = 'SUBMITTED' AND NOT auto_pay_off");
    expect(sql).toContain('v_date > v_today THEN CONTINUE');
    expect(sql).toContain("COALESCE(q.pay_method, 'TRANSFER')");
    expect(sql).toContain('paid_date = v_date');
    expect(sql).toContain('paid_by = NULL');
    expect(sql).toContain('paid_auto = true');
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain('EXCEPTION WHEN OTHERS THEN');
    expect(sql).toContain('付款日到期，系統自動標記已付款');
    expect(sql).toContain("jsonb_build_object('auto', true,");
  });
  it('同仁代墊不自動、失敗留紀錄、退回草稿清取消旗標、付款日用明細快照', () => {
    const sql = read(`${DEV}.sql`);
    expect(sql).toContain("payee_type = 'VENDOR'");
    expect(sql).toContain("'auto_pay_failed', true");
    expect(sql).toContain("OLD.status = 'SUBMITTED' AND NEW.status = 'DRAFT' THEN NEW.auto_pay_off := false");
    expect(sql).toContain('min(COALESCE(l.due_date, b.due_date))');
    expect(sql).toContain("'date_before_created'");
  });
  it('取消函式：需請款管理、原因必填、版本檢查、只限 PAID 且 paid_auto、之後不再自動、寫 cancel_auto_pay 事件', () => {
    const sql = read(`${DEV}.sql`);
    expect(sql).toContain('ga_pay_can_manage(v_uid)');
    expect(sql).toContain("'REASON_REQUIRED'");
    expect(sql).toContain("'STALE'");
    expect(sql).toContain("q.status <> 'PAID'");
    expect(sql).toContain('NOT q.paid_auto');
    expect(sql).toContain("'NOT_AUTO_PAID'");
    expect(sql).toContain('paid_auto = false, auto_pay_off = true');
    expect(sql).toContain("ga_pay_event(q.id, 'cancel_auto_pay'");
  });
  it('排程函式只給 service_role；取消函式給登入者但收回匿名', () => {
    const sql = read(`${DEV}.sql`);
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.ga_apply_due_payment_requests(date, uuid[]) FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.ga_apply_due_payment_requests(date, uuid[]) TO service_role;');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.ga_ws_pay_request_cancel_auto_pay(uuid, text, text, timestamptz) FROM PUBLIC, anon;');
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.ga_apply_due_payment_requests[^;]*(authenticated|anon)/);
  });
  it('pg_cron：每天 UTC 16:05（台北 00:05）、同名先取消再建立、沒有 pg_cron 只 NOTICE', () => {
    const sql = read(`${DEV}.sql`);
    expect(sql).toContain("cron.schedule('ga-auto-pay-due-requests', '5 16 * * *'");
    expect(sql).toContain("cron.unschedule(jobid) FROM cron.job WHERE jobname = 'ga-auto-pay-due-requests'");
    expect(sql).toContain('RAISE NOTICE');
  });
  it('rollback：有自動標記或取消紀錄就中止；移除排程與函式；守門還原成原版', () => {
    const sql = read(`${DEV}.rollback.sql`);
    expect(sql).toContain('WHERE paid_auto OR auto_pay_off');
    expect(sql).toContain("event_type = 'cancel_auto_pay'");
    expect(sql).toContain('RAISE EXCEPTION');
    expect(sql).toContain("cron.unschedule(jobid) FROM cron.job WHERE jobname = 'ga-auto-pay-due-requests'");
    for (const fn of ['ga_ws_pay_request_cancel_auto_pay', 'ga_apply_due_payment_requests', 'ga_pay_auto_pay_date']) expect(sql).toContain(`DROP FUNCTION IF EXISTS public.${fn}`);
    expect(sql).not.toContain('ga.pay_auto_mark');
    expect(sql).toContain('DROP COLUMN IF EXISTS paid_auto');
  });
  it('verify 只有 SELECT（沒有寫入、DDL、授權）', () => {
    const v = code(read(`${PROD}.verify.sql`)).replace(/'(?:[^']|'')*'/g, "''");
    expect(v).toMatch(/^SELECT/);
    expect(v).not.toMatch(WRITE);
  });
  it('README 是白話中文且寫明草稿未在正式區執行、套用順序與撤回', () => {
    const r = read(path.join(PROD_DIR, 'README.md'));
    expect(r).toContain('沒有在正式區執行');
    expect(r).toContain('套用順序');
    expect(r).toContain('撤回');
    expect(r).toContain('取消自動付款');
  });
  it('檔案保持 LF、沒有 NUL', () => {
    for (const f of [`${DEV}.sql`, `${DEV}.rollback.sql`, `${PROD}.sql`, `${PROD}.rollback.sql`, `${PROD}.verify.sql`, path.join(PROD_DIR, 'README.md'), path.join(ROOT, 'lib/workspace/general-affairs/auto-pay-rules.ts')]) {
      const raw = fs.readFileSync(f, 'utf8');
      expect(raw.includes('\r')).toBe(false);
      expect(raw.includes('\0')).toBe(false);
    }
  });
});
