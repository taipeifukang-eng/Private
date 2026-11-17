import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadAllowlist, validateAllowlist } from '../../support/parity';

// 第 6 批 G20-G24-accept（驗收層）靜態檢查：測試編號對應的檔案都在、allowlist 合法、核可欄位只有兩種值、
// 正式區草稿 41 唯讀、42 至 47 各有 rollback、套用順序與「43 最後套」寫進 README、設計文件有驗收章節。
const root = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p: string) => fs.existsSync(path.join(root, p));
const APPROVED = 'user (2026-11-17 batch 6 spec survey)';

describe('G20-G24 測試編號與檔案', () => {
  const files: Record<string, string> = {
    'G20-G21.db（資料庫函式）': 'tests/integration/G20-G21-db-api.vendor-rpc.spec.ts',
    'G20-G21.api': 'tests/integration/G20-G21-db-api.vendors-api.spec.ts',
    'G21.rls': 'tests/integration/G20-G21-db-api.rls.spec.ts',
    'G20-G21.smoke': 'tests/smoke/G20-G21-ui.pages.spec.ts',
    'G20-G21.layout.e2e': 'tests/e2e/G20-G21-ui.layout.e2e.spec.ts',
    'G20-G21.parity': 'tests/parity/G20-G21-ui.ga-vendors.spec.ts',
    'G21.journey-vendor-chain.e2e': 'tests/e2e/G21.journey-vendor-chain.e2e.spec.ts',
    'G22-G24.rpc': 'tests/integration/G22-G24.stats-home-rpc.spec.ts',
    'G22-G24.api': 'tests/integration/G22-G24.stats-home-api.spec.ts',
    'G22-G24.smoke': 'tests/smoke/G22-G24.pages.spec.ts',
    'G22-G24.layout.e2e': 'tests/e2e/G22-G24.layout.e2e.spec.ts',
    'G22.parity': 'tests/parity/G22-G24.ga-purchase-analysis.spec.ts',
    'G24.journey-store-blocked.e2e': 'tests/e2e/G24.journey-store-blocked.e2e.spec.ts',
    'G24.journey-home.e2e': 'tests/e2e/G24.journey-home.e2e.spec.ts',
    'G23.rpc': 'tests/integration/G23.rpc.spec.ts',
    'G23.api': 'tests/integration/G23.api.spec.ts',
    'G23.rls': 'tests/integration/G23.rls.spec.ts',
    'G23.smoke': 'tests/smoke/G23.pages.spec.ts',
    'G23.layout.e2e': 'tests/e2e/G23.layout.e2e.spec.ts',
    'G23.parity': 'tests/parity/G23.ga-utility-bills.spec.ts',
    'G23.journey-utility-bill.e2e': 'tests/e2e/G23.journey-utility-bill.e2e.spec.ts',
  };
  for (const [id, f] of Object.entries(files)) it(`${id} 的檔案存在`, () => expect(exists(f), f).toBe(true));
  it('四支角色接力劇本循序執行並清除自己的資料', () => {
    for (const f of Object.values(files).filter((x) => /journey/.test(x))) {
      const s = read(f);
      expect(s, f).toContain("test.describe.configure({ mode: 'serial' })");
      expect(s, f).toContain('cleanupM7M8(');
    }
  });
  it('第 6 批測試不連正式區、不讀密碼金鑰；用到的門市代碼只有 VW／ZT 測試門市', () => {
    for (const f of Object.values(files)) {
      const s = read(f);
      expect(s, f).not.toMatch(/odvk/i);
      expect(s, f).not.toMatch(/\.env\.local|\.env\.production|service_role_key/i);
      for (const m of s.matchAll(/'((?:VW|ZT)\d+)'/g)) expect(m[1], f).toMatch(/^(VW|ZT)\d+$/);
    }
  });
});

describe('G20-G24 對等 allowlist', () => {
  const list = loadAllowlist();
  const b6 = list.filter((e) => e.id.startsWith('m7m8-b6-'));
  it('整份通過驗證器；m7m8-b6 條目的核可欄位只有「問卷核可」或 null；decision 為 fix 的維持 null', () => {
    expect(validateAllowlist(list)).toEqual([]);
    expect(b6.length).toBeGreaterThan(50);
    for (const e of b6) {
      expect([APPROVED, null], e.id).toContain(e.approvedBy);
      if (e.decision === 'fix') expect(e.approvedBy, e.id).toBeNull();
    }
  });
  it('已核可與待確認兩種都存在（待確認項目要回報使用者）', () => {
    expect(b6.some((e) => e.approvedBy === APPROVED)).toBe(true);
    expect(b6.some((e) => e.approvedBy === null)).toBe(true);
  });
});

describe('G20-G24 驗收文件與正式區草稿', () => {
  const design = read('docs/vue-workspace/parity-plan/m7m8-batch6-design.md');
  const readme = read('docs/vue-workspace/parity-plan/m7m8-sql/README.md');
  const dir = 'docs/vue-workspace/parity-plan/m7m8-sql';
  it('設計文件有驗收章節：DoD 清單、上線前名單、41 預覽、設計 §9 備註三點、測試編號', () => {
    expect(design).toContain('### 11.5');
    for (const key of ['Definition of Done', '上線前名單', '41-b6-preview-before-apply', 'WAITING_GA_REVIEW', 'REOPENED', '聯集', 'G21.rls', 'G23.rls', 'G24.journey-home', 'G21.journey-vendor-chain']) expect(design, key).toContain(key);
  });
  it('SQL README 第 6 批章節有套用順序 41→42→44→47→45→46→43、43 最後套與驗收', () => {
    const sec = readme.slice(readme.indexOf('## 第 6 批'));
    expect(sec).toMatch(/41.*42.*44.*47.*45.*46.*43/s);
    expect(sec).toMatch(/43[^\n]*(最後|名單)/);
    expect(sec).toContain('驗收');
    expect(sec).not.toContain('編號 46 先保留');
  });
  it('正式區草稿 41 是唯讀預覽（沒有寫入語句）、42 至 47 各有 rollback', () => {
    const sql41 = read(`${dir}/41-b6-preview-before-apply.sql`).split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(sql41).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|DROP\s+|ALTER\s+|CREATE\s+(TABLE|FUNCTION|POLICY))/i);
    for (const n of ['42-b6-vendor-columns', '43-b6-vendor-rls', '44-b6-vendor-functions', '45-b6-utility-bills', '46-b6-stats-home', '47-b6-work-order-vendor-check']) {
      expect(exists(`${dir}/${n}.sql`), n).toBe(true);
      expect(exists(`${dir}/${n}-rollback.sql`), `${n}-rollback`).toBe(true);
    }
  });
  it('DEV SQL 在 supabase/workspace-dev 且各附 rollback，沒有放進 supabase/migrations', () => {
    const dev = fs.readdirSync(path.join(root, 'supabase', 'workspace-dev')).filter((f) => /^20261118/.test(f) && f.includes('m7m8_b6'));
    expect(dev.length).toBeGreaterThanOrEqual(12);
    for (const f of dev.filter((x) => x.endsWith('.sql') && !x.endsWith('.rollback.sql'))) expect(exists(`supabase/workspace-dev/${f.replace(/\.sql$/, '.rollback.sql')}`), f).toBe(true);
    const mig = exists('supabase/migrations') ? fs.readdirSync(path.join(root, 'supabase', 'migrations')).filter((f) => f.includes('m7m8_b6')) : [];
    expect(mig).toEqual([]);
  });
});
