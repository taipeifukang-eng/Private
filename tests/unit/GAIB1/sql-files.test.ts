import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// ga-improve-b1：SQL 檔靜態檢查（DEV 檔與正式區草稿）。
//   每個 DEV 檔都有 .rollback.sql；正式區 01 至 05 各有 .sql／.rollback.sql／.verify.sql，00 預覽與 verify 只有 SELECT；
//   正式區與 DEV 實測檔的 SQL 內容相同（只差檔頭註解）；不授權給任何角色（沒有 role_permissions／permissions 的 INSERT 或權限碼）；
//   既有函式加掛都有 GAIB1-Sn 標記、撤回逐字還原用的反向替換都在、暫時替換函式用完即刪；新資料表全部 RLS 全封；DEV 專用的清除函式不進正式區；
//   階段 5 用「預付餘額帳」事件式（沒有 UPDATE 金額、只回復）；新增欄位都有預設值或可為空（既有資料不需回填）。
const ROOT = path.resolve(__dirname, '..', '..', '..');
const DEV = path.join(ROOT, 'supabase', 'workspace-dev');
const PROD = path.join(ROOT, 'docs', 'vue-workspace', 'parity-plan', 'ga-improve-b1-sql');
const read = (f: string) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const bare = (sql: string) =>
  sql
    .replace(/\$([a-z0-9]*)\$[\s\S]*?\$\1\$/g, "''")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
const code = (sql: string) => sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').trim();
const WRITE = /\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|GRANT|REVOKE|TRUNCATE|COPY|DO|CALL|EXECUTE)\b/i;

const STAGES = [
  { dev: '20261125100000_ga_improve_b1_buyer_companies', prod: '01-ga-improve-b1-buyer-companies', tag: 'S2' },
  { dev: '20261125110000_ga_improve_b1_po_tax_adjust', prod: '02-ga-improve-b1-po-tax-adjust', tag: 'S3' },
  { dev: '20261125120000_ga_improve_b1_pay_methods_payee', prod: '03-ga-improve-b1-pay-methods-payee', tag: 'S4' },
  { dev: '20261125130000_ga_improve_b1_prepay', prod: '04-ga-improve-b1-prepay', tag: 'S5' },
  { dev: '20261125090000_ga_improve_b1_perm_label', prod: '05-ga-improve-b1-permission-label', tag: null },
];

describe('DEV 檔（supabase/workspace-dev）', () => {
  it.each([...STAGES.map((s) => s.dev), '20261125140000_ga_improve_b1_dev_seed'])('%s 與 .rollback.sql 都存在', (name) => {
    expect(fs.existsSync(path.join(DEV, `${name}.sql`))).toBe(true);
    expect(fs.existsSync(path.join(DEV, `${name}.rollback.sql`))).toBe(true);
  });
  it('DEV 專用清除函式只在 140000 且只處理 QA-GAIB1- 標記（正式區草稿沒有）', () => {
    const seed = read(path.join(DEV, '20261125140000_ga_improve_b1_dev_seed.sql'));
    expect(seed).toContain('ga_dev_cleanup_ga_improve_b1');
    expect(seed).toContain("left(p_marker, 9) <> 'QA-GAIB1-'");
    expect(seed).toContain("left(p_email_like, 9) <> 'm7m8-test'");
    expect(seed).toContain('REVOKE ALL ON FUNCTION public.ga_dev_cleanup_ga_improve_b1');
    for (const f of fs.readdirSync(PROD)) expect(read(path.join(PROD, f)), f).not.toContain('ga_dev_cleanup');
  });
  it('套用腳本涵蓋全部六份並有環境守衛（只認 DEV mjpd）', () => {
    const s = read(path.join(ROOT, 'scripts', 'apply-workspace-ga-improve-b1-dev.cjs'));
    for (const n of [...STAGES.map((x) => x.dev), '20261125140000_ga_improve_b1_dev_seed']) expect(s).toContain(n);
    expect(s).toContain('startsWith("mjpd")');
    expect(s).toContain('assertDevEnvironment');
  });
});

describe('不授權、不新增權限碼', () => {
  it.each(STAGES.flatMap((s) => [`${s.dev}.sql`, `${s.dev}.rollback.sql`]))('%s 沒有寫 role_permissions／user_roles，也沒有新增權限碼', (file) => {
    const sql = bare(read(path.join(DEV, file)));
    expect(sql).not.toMatch(/\b(INSERT\s+INTO|DELETE\s+FROM)\s+public\.(role_permissions|user_roles|roles)\b/i);
    expect(sql).not.toMatch(/\bINSERT\s+INTO\s+public\.permissions\b/i);
    expect(sql).not.toMatch(/\bGRANT\b[\s\S]*?\bTO\s+(?!authenticated|service_role)\w+/i);
  });
  it('權限碼 general_affairs.utility_bill.manage 在 G12 只當條件用，不改碼', () => {
    const sql = read(path.join(DEV, '20261125090000_ga_improve_b1_perm_label.sql'));
    expect(sql).toContain("'general_affairs.utility_bill.manage'");
    expect(sql).not.toMatch(/SET\s+code\b/i);
  });
});

describe('正式區草稿（docs/vue-workspace/parity-plan/ga-improve-b1-sql）', () => {
  it('檔案齊全：00 預覽、01 至 05 各有 .sql／.rollback.sql／.verify.sql、README', () => {
    expect(fs.existsSync(path.join(PROD, '00-preview-before-apply.sql'))).toBe(true);
    expect(fs.existsSync(path.join(PROD, 'README.md'))).toBe(true);
    for (const s of STAGES) for (const ext of ['.sql', '.rollback.sql', '.verify.sql']) expect(fs.existsSync(path.join(PROD, `${s.prod}${ext}`)), `${s.prod}${ext}`).toBe(true);
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
  it('正式區 01 至 05 與 DEV 實測檔的 SQL 內容相同（只差檔頭註解）', () => {
    for (const s of STAGES) {
      for (const kind of ['', '.rollback']) {
        expect(code(read(path.join(PROD, `${s.prod}${kind}.sql`))), `${s.prod}${kind}`).toBe(code(read(path.join(DEV, `${s.dev}${kind}.sql`))));
      }
    }
  });
  it('README 寫了套用順序、先決條件、還原順序、驗證步驟、與 G46 的相依，並明說不授權任何角色', () => {
    const t = read(path.join(PROD, 'README.md'));
    for (const w of ['先決條件', '套用順序', '還原順序', '驗證步驟', 'ga-utility-payment-sql', '不新增任何權限碼，也不授權給任何角色']) expect(t).toContain(w);
    for (const s of STAGES) expect(t).toContain(s.prod);
  });
});

describe('既有函式加掛：標記、反向替換、暫時函式', () => {
  it.each(STAGES.filter((s) => s.tag))('$dev：每處加掛都有 GAIB1-$tag 標記，撤回有對應的反向替換並確認標記清乾淨', ({ dev, tag }) => {
    const fwd = read(path.join(DEV, `${dev}.sql`));
    const rb = read(path.join(DEV, `${dev}.rollback.sql`));
    expect(fwd).toContain(`GAIB1-${tag}`);
    const hooks = [...fwd.matchAll(/pg_get_functiondef\('([^']+)'::regprocedure\)/g)].map((m) => m[1]);
    expect(hooks.length).toBeGreaterThan(0);
    for (const sig of new Set(hooks)) {
      expect(rb, `${sig} 撤回`).toContain(`pg_get_functiondef('${sig}'::regprocedure)`);
      expect(rb, `${sig} 標記檢查`).toContain(`position('GAIB1-${tag}' IN v_new) > 0 THEN RAISE EXCEPTION`);
    }
    // 形狀不符就中止、已套用就略過
    expect(fwd).toContain('函式形狀與預期不符');
    expect(fwd).toMatch(/IF position\(public\.ga_ib1_nl\(v_def, \$ib1n\$[\s\S]*?\) IN v_new\) = 0 THEN/);
    // 暫時替換函式用完即刪（正向與撤回都刪）
    for (const t of [fwd, rb]) {
      expect(t).toContain('DROP FUNCTION IF EXISTS public.ga_ib1_swap(text, text, text, text);');
      expect(t).toContain('DROP FUNCTION IF EXISTS public.ga_ib1_nl(text, text);');
    }
    // 沒有整支覆蓋既有函式的 CREATE OR REPLACE（既有函式名稱只能走加掛）
    const existing = ['ga_ws_pay_request_action', 'ga_ws_pay_request_create', 'ga_ws_pay_request_update', 'ga_ws_pay_request_list', 'ga_ws_pay_export', 'ga_ws_po_receive', 'ga_ws_po_receipt_void', 'ga_ws_po_action',
      'ga_ws_po_list', 'ga_ws_pay_settings_get', 'ga_ws_pay_settings_set', 'ga_pay_apply_lines', 'ga_pay_check_live', 'ga_po_items_apply', 'ga_po_header_apply', 'ga_pay_request_json', 'ga_ws_home_summary'];
    for (const n of existing) expect(fwd, n).not.toMatch(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${n}\\(`));
  });
  it('階段 3 與階段 5 的整支本體替換（計算函式）也有標記並可逐字還原', () => {
    const s3 = read(path.join(DEV, STAGES[1].dev + '.sql'));
    for (const n of ['ga_po_refresh_totals', 'ga_pay_freeze_receipt_item_amount', 'ga_pay_receipt_untaxed', 'ga_pay_receipt_total', 'ga_pay_po_received', 'ga_pay_po_amounts', 'ga_pay_unclaimed_po_ids']) {
      expect(s3, n).toContain(`pg_get_functiondef('public.${n}(`);
    }
    const s5 = read(path.join(DEV, STAGES[3].dev + '.sql'));
    expect(s5).toContain("p_status IS NULL THEN public.ga_pay_po_offset(p_po)"); // 累計請款＝一般請款＋核銷（只有沒指定狀態時）
  });
  it('延伸點函式（階段 2 到 5 逐階段重新定義）撤回時還原成前一階段的版本', () => {
    for (const [dev, fn] of [[STAGES[1].dev, 'ga_ib1_po_header_ext'], [STAGES[1].dev, 'ga_ib1_po_data_ext'], [STAGES[2].dev, 'ga_ib1_pay_set_buyer'], [STAGES[3].dev, 'ga_ib1_receive_ext'], [STAGES[3].dev, 'ga_ib1_pay_json_ext'], [STAGES[3].dev, 'ga_ib1_export_enrich']] as const) {
      expect(read(path.join(DEV, `${dev}.rollback.sql`)), `${dev} ${fn}`).toContain(`CREATE OR REPLACE FUNCTION public.${fn}(`);
    }
  });
});

describe('資料表與欄位：RLS 全封、預設值、約束只放寬', () => {
  it('每張新資料表都開 RLS 並收回直接權限（只有 service_role）', () => {
    for (const s of STAGES.filter((x) => x.tag)) {
      const fwd = read(path.join(DEV, `${s.dev}.sql`));
      for (const m of fwd.matchAll(/CREATE TABLE IF NOT EXISTS public\.(\w+)/g)) {
        expect(fwd, m[1]).toContain(`ALTER TABLE public.${m[1]} ENABLE ROW LEVEL SECURITY;`);
        expect(fwd, m[1]).toMatch(new RegExp(`REVOKE ALL ON public\\.${m[1]} FROM PUBLIC, anon, authenticated;`));
      }
    }
  });
  it('既有資料表新增的欄位都有預設值或可為空（NOT NULL 必有 DEFAULT）', () => {
    for (const s of STAGES.filter((x) => x.tag)) {
      const fwd = bare(read(path.join(DEV, `${s.dev}.sql`)));
      for (const m of fwd.matchAll(/ADD COLUMN IF NOT EXISTS (\w+) ([^;]+);/g)) {
        if (/NOT NULL/i.test(m[2])) expect(m[2], `${s.dev} ${m[1]}`).toMatch(/DEFAULT/i);
      }
    }
  });
  it('pay_method 與事件類型約束只放寬成超集：舊值全部保留', () => {
    const s4 = read(path.join(DEV, STAGES[2].dev + '.sql'));
    for (const v of ["'TRANSFER'", "'CASH'", "'CHECK'", "'CREDIT_CARD'", "'ONLINE_PLATFORM'"]) expect(s4).toContain(v);
    const s5 = read(path.join(DEV, STAGES[3].dev + '.sql'));
    for (const v of ["'create'", "'update'", "'submit'", "'return'", "'mark_paid'", "'void'", "'note'", "'refresh_bank'", "'prepay_refund'"]) expect(s5).toContain(v);
    // 撤回把約束還原成原本的三個／八個值
    expect(read(path.join(DEV, STAGES[2].dev + '.rollback.sql'))).toContain("ARRAY['TRANSFER'::text, 'CASH'::text, 'CHECK'::text]");
    expect(read(path.join(DEV, STAGES[3].dev + '.rollback.sql'))).toContain("'refresh_bank'::text])");
  });
  it('撤回有安全規則：已有新功能資料時中止', () => {
    expect(read(path.join(DEV, STAGES[0].dev + '.rollback.sql'))).toContain('不能撤回');
    expect(read(path.join(DEV, STAGES[1].dev + '.rollback.sql'))).toContain('不能撤回');
    expect(read(path.join(DEV, STAGES[2].dev + '.rollback.sql'))).toContain('不能撤回');
    expect(read(path.join(DEV, STAGES[3].dev + '.rollback.sql'))).toContain('不能撤回');
  });
  it('預付餘額帳事件式：核銷與退款有約束；不提供直接修改金額的函式', () => {
    const s5 = read(path.join(DEV, STAGES[3].dev + '.sql'));
    expect(s5).toContain('ga_prepay_ledger_kind_check');
    expect(s5).toContain('ga_prepay_ledger_amount_check');
    expect(s5).not.toMatch(/UPDATE public\.ga_payment_prepay_ledger SET amount/);
    expect(s5).toMatch(/UPDATE public\.ga_payment_prepay_ledger SET reversed_at/);
  });
  it('事件表有不可修改刪除的觸發器（公司事件、同仁帳戶事件）', () => {
    expect(read(path.join(DEV, STAGES[0].dev + '.sql'))).toContain('trg_ga_buyer_company_events_immutable');
    expect(read(path.join(DEV, STAGES[2].dev + '.sql'))).toContain('trg_ga_employee_payout_account_events_immutable');
  });
  it('同仁帳戶事件不含帳號本文（只記欄位名稱與末四碼）', () => {
    const s4 = read(path.join(DEV, STAGES[2].dev + '.sql'));
    expect(s4).toMatch(/INSERT INTO public\.ga_employee_payout_account_events \(profile_id, actor_id, via, changed_fields, account_last4(, prev_last4)?\)/);
    expect(s4).not.toMatch(/ga_employee_payout_account_events[^;]*bank_account,/);
  });
});

describe('語意與守門', () => {
  it('新函式用 has_permission 語意的既有判斷（ga_pay_can_*、ga_po_can_*），不放行 admin', () => {
    for (const s of STAGES.filter((x) => x.tag)) {
      const fwd = bare(read(path.join(DEV, `${s.dev}.sql`)));
      expect(fwd, s.dev).not.toMatch(/role\s*=\s*'admin'/i);
      expect(fwd, s.dev).not.toMatch(/is_active.*roles/i);
    }
  });
  it('代墊守門：SELF_PAYEE、PAYEE_NO_ACCOUNT、付款方式限制都在觸發器裡', () => {
    const s4 = read(path.join(DEV, STAGES[2].dev + '.sql'));
    for (const w of ['SELF_PAYEE', 'PAYEE_NO_ACCOUNT', 'PAYEE_INACTIVE', 'PAY_FIELD_MISMATCH', 'CARD_LAST4']) expect(s4).toContain(w);
  });
  it('預付守門：結案守門、核銷重驗、上限、狀態都在', () => {
    const s5 = read(path.join(DEV, STAGES[3].dev + '.sql'));
    for (const w of ['PREPAY_BALANCE_OPEN', 'PREPAY_CHANGED', 'PREPAY_COVERED', 'OVER_PO_TOTAL', 'PREPAY_PO_STATE', 'OVER_BALANCE']) expect(s5).toContain(w);
  });
  it('G12：舊名稱只在被替換的字串裡出現，新名稱 水電話網費管理', () => {
    const sql = read(path.join(DEV, STAGES[4].dev + '.sql'));
    expect(sql).toContain('水電話網費管理');
    expect(bare(sql)).not.toContain('水電網費管理');
  });
});

describe('審查修正（SQL）', () => {
  const dev5 = read(path.join(DEV, STAGES[3].dev + '.sql'));
  const dev4 = read(path.join(DEV, STAGES[2].dev + '.sql'));
  const dev2 = read(path.join(DEV, STAGES[0].dev + '.sql'));
  it('預付階段有請款明細守門觸發器與調整列轉承接後的重新對帳，rollback 會移除，grant 清單有列入', () => {
    expect(dev5).toContain('trg_ga_ib1_prepay_lines_guard');
    expect(dev5).toContain('PREPAY_NO_LINES');
    expect(dev5).toContain('PREPAY_COVERED');
    expect(dev5).toMatch(/ga_pay_prepay_reconcile\(p_po\);\s+PERFORM public\.ga_pay_prepay_apply\(p_po\)/);
    const rb = read(path.join(DEV, STAGES[3].dev + '.rollback.sql'));
    expect(rb).toContain('DROP TRIGGER IF EXISTS trg_ga_ib1_prepay_lines_guard');
    expect(rb).toContain('DROP FUNCTION IF EXISTS public.ga_pay_prepay_reconcile(uuid)');
    expect(dev5).toContain("'ga_ib1_prepay_lines_guard', 'ga_pay_prepay_reconcile'");
  });
  it('送出代墊單時一律重抓同仁帳戶快照；帳戶事件記變更前末四碼並有查看稽核', () => {
    expect(dev4).toContain('NEW.payee_account_snapshot := public.ga_ib1_payee_account_snapshot(NEW.payee_profile_id);');
    expect(dev4).toContain("'VIEW'");
    expect(dev4).toContain('prev_last4');
  });
  it('買受人公司：送出時停用要擋、已下訂採購單用到的公司不能改名稱統編、儲存冪等比對內容', () => {
    expect(dev2).toContain('已停用，請重新選擇抬頭後再送出');
    expect(dev2).toContain('BUYER_IN_USE');
    expect(dev2).toContain("'hash', md5(p::text)");
  });
  it('正式區 verify 有新物件的檢查，README 記載撤回限制', () => {
    expect(read(path.join(PROD, '04-ga-improve-b1-prepay.verify.sql'))).toContain('trg_ga_ib1_prepay_lines_guard');
    expect(read(path.join(PROD, '03-ga-improve-b1-pay-methods-payee.verify.sql'))).toContain('prev_last4');
    const readme = read(path.join(PROD, 'README.md'));
    expect(readme).toContain('不要單獨重跑前面的階段');
    expect(readme).toContain('prepay_refund');
  });
});
