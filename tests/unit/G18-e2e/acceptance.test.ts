import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadAllowlist, loadMap, validateAllowlist } from '../../support/parity';

// 第 5 批 G18-e2e（驗收層）靜態檢查：測試編號對應的檔案都在、parity map 與 allowlist 合法且互相對得上、
// 每支寫入端點的對等項目都有、核可欄位只有兩種值、Definition of Done 的名單與預覽（Q20、W9、36 號）與套用順序都寫進文件。
const root = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p: string) => fs.existsSync(path.join(root, p));
const APPROVED = 'user (2026-11-16 batch 5 spec survey)';

describe('G18-e2e 測試編號與檔案', () => {
  const files: Record<string, string> = {
    'G18.rls': 'tests/integration/G18-e2e.rls.spec.ts',
    'G18.parity': 'tests/parity/G18-e2e.ga-work-orders.spec.ts',
    'G18.journey-repair': 'tests/e2e/G18-e2e.journey-repair.e2e.spec.ts',
    'G18.journey-exceptions': 'tests/e2e/G18-e2e.journey-exceptions.e2e.spec.ts',
    'G19.journey-legacy': 'tests/e2e/G18-e2e.journey-legacy.e2e.spec.ts',
    'G28.supplement-roundtrip': 'tests/e2e/G18-e2e.g28-supplement-roundtrip.e2e.spec.ts',
    'G18.print.e2e': 'tests/e2e/G18-e2e.print.e2e.spec.ts',
    'G18.layout.e2e（前一階段）': 'tests/e2e/G18-ui.layout.e2e.spec.ts',
    'G18.smoke（前一階段）': 'tests/smoke/G18-ui.pages.spec.ts',
    'G18.integration（API）': 'tests/integration/G18-api.work-orders-api.spec.ts',
    'G19.integration（API）': 'tests/integration/G18-api.cross-dept-api.spec.ts',
    'G18.integration（DB）': 'tests/integration/G18-db.work-orders-rpc.spec.ts',
  };
  for (const [id, f] of Object.entries(files)) it(`${id} 的檔案存在`, () => expect(exists(f), f).toBe(true));
  it('角色劇本只在桌機 project 跑一次（避免重複建立資料），且每支都有循序與清除自己的資料', () => {
    for (const f of Object.values(files).filter((x) => /journey|g28|print/.test(x))) {
      const s = read(f);
      expect(s, f).toContain("test.describe.configure({ mode: 'serial' })");
      expect(s, f).toContain("testInfo.project.name !== 'desktop-1440'");
      expect(s, f).toContain('cleanupM7M8()');
    }
  });
  it('本階段的測試只用 VW／ZT 測試門市，不連正式區、不讀密碼金鑰', () => {
    for (const f of Object.values(files).filter((x) => /G18-e2e/.test(x))) {
      const s = read(f);
      expect(s, f).not.toMatch(/odvk/i);
      expect(s, f).not.toMatch(/\.env\.local|\.env\.production|SERVICE_ROLE|service_role_key/i);
      for (const m of s.matchAll(/'(VW\d+|ZT\d+)'/g)) expect(['VW001', 'ZT01'], `${f} ${m[1]}`).toContain(m[1]);
    }
  });
});

describe('G18-e2e 對等（parity）map 與 allowlist', () => {
  const list = loadAllowlist();
  const b5 = list.filter((e) => e.id.startsWith('m7m8-b5-'));
  it('map 都合法，且每個寫入與讀取端點都有對等項目', () => {
    const wo = loadMap('ga-work-orders');
    const cd = loadMap('cross-dept-maintenance');
    expect(wo.entries.map((e) => e.id)).toEqual(['wo-list-read', 'wo-detail-read', 'wo-summary-read', 'wo-progress-write-readback', 'wo-completion-write-readback', 'wo-force-close-write-readback', 'wo-category-write-readback']);
    expect(cd.entries.map((e) => e.id)).toEqual(['legacy-create-write-readback', 'legacy-confirm-write-readback', 'legacy-unresolved-write-readback', 'legacy-delete-write-readback', 'category-list-read', 'category-write-readback']);
    for (const e of [...wo.entries, ...cd.entries]) {
      expect(e.legacy.api?.path, e.id).toMatch(/^\/api\/(?!workspace)/);
      expect(e.native.api?.path, e.id).toMatch(/^\/api\/workspace\/general-affairs\//);
    }
  });
  it('新版端點都在 router 登錄（work-orders、cross-dept-maintenance、maintenance-categories）', () => {
    const router = read('lib/workspace/general-affairs/router.ts');
    for (const seg of ['work-orders', 'cross-dept-maintenance', 'maintenance-categories']) expect(router, seg).toContain(`"${seg}"`);
  });
  it('allowlist 整份通過驗證器；m7m8-b5 條目的核可欄位只有「問卷核可」或 null；decision 為 fix 的維持 null', () => {
    expect(validateAllowlist(list)).toEqual([]);
    expect(b5.length).toBeGreaterThan(60);
    for (const e of b5) {
      expect([APPROVED, null], e.id).toContain(e.approvedBy);
      if (e.decision === 'fix') expect(e.approvedBy, e.id).toBeNull();
      expect(['ga-work-orders', 'cross-dept-maintenance', 'ga-cross-dept-maintenance'], e.id).toContain(e.page);
    }
  });
  it('對等比對用的差異條目都有 match（才會自動套用）、page 對應已有 parity map、match 範圍不會過大', () => {
    const maps = new Set(['ga-work-orders', 'cross-dept-maintenance']);
    const par = b5.filter((e) => e.id.startsWith('m7m8-b5-par-'));
    expect(par.length).toBeGreaterThan(40);
    for (const e of par) {
      expect(maps.has(e.page), e.id).toBe(true);
      expect(e.match?.mechanism, e.id).toBeTruthy();
      expect(e.match?.kind, e.id).toBeTruthy();
      expect(e.match?.key, e.id).toBeTruthy();
    }
  });
  it('缺陷修正與實作取捨（待使用者確認）一律 null；問卷核可的項目才有核可欄位', () => {
    for (const id of ['m7m8-b5-wo-progress-keep-fields', 'm7m8-b5-wo-delete-no-audit-event', 'm7m8-b5-wo-state-blocks', 'm7m8-b5-wo-completion-note-optional', 'm7m8-b5-api-category-name-rules', 'm7m8-b5-api-attachment-reporter-scope',
      'm7m8-b5-par-progress-keep-assignee', 'm7m8-b5-par-progress-keep-handling', 'm7m8-b5-par-display-columns-focus', 'm7m8-b5-par-location-from-request-equipment-id']) {
      expect(b5.find((e) => e.id === id)?.approvedBy, id).toBeNull();
    }
    for (const id of ['m7m8-b5-par-legacy-delete-silent', 'm7m8-b5-par-legacy-confirm-guard', 'm7m8-b5-par-progress-completed-blocked']) expect(b5.find((e) => e.id === id)?.approvedBy, id).toBe(APPROVED);
  });
});

describe('G18-e2e 驗收文件（Definition of Done）', () => {
  const design = read('docs/vue-workspace/parity-plan/m7m8-batch5-design.md');
  const readme = read('docs/vue-workspace/parity-plan/m7m8-sql/README.md');
  it('設計文件有驗收章節：DoD 清單、Q20 名單、W9 名單、bucket、36 號預覽、測試編號', () => {
    expect(design).toContain('### 11.5');
    for (const key of ['Definition of Done', 'Q20 名單', 'W9 名單', 'maintenance-photos', '36-b5-preview-before-apply', 'G18.rls', 'G18.parity', 'G28']) expect(design, key).toContain(key);
  });
  it('SQL README 的第 5 批章節有套用順序 36→37→38→39→40、「40 要等名單確認」與驗收清單', () => {
    expect(readme).toContain('第 5 批');
    expect(readme).toMatch(/36.*37.*38.*39.*40/s);
    expect(readme).toMatch(/40[^\n]*(名單|確認)/);
    expect(readme).toContain('驗收');
  });
  it('正式區草稿 36 是唯讀預覽（沒有寫入語句）、37 至 40 各有 rollback', () => {
    const dir = 'docs/vue-workspace/parity-plan/m7m8-sql';
    const sql36 = read(`${dir}/36-b5-preview-before-apply.sql`).split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(sql36).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|DROP\s+|ALTER\s+|CREATE\s+(TABLE|FUNCTION|POLICY))/i);
    for (const n of ['37-b5-work-order-rules', '38-b5-request-supplement-sync', '39-b5-work-order-parts', '40-b5-work-order-rls']) {
      expect(exists(`${dir}/${n}.sql`), n).toBe(true);
      expect(exists(`${dir}/${n}-rollback.sql`), `${n}-rollback`).toBe(true);
    }
  });
  it('本批 DEV SQL 都在 supabase/workspace-dev 且各附 rollback，沒有放進 supabase/migrations', () => {
    const dev = fs.readdirSync(path.join(root, 'supabase', 'workspace-dev')).filter((f) => f.includes('m7m8_b5'));
    expect(dev.length).toBeGreaterThanOrEqual(10);
    for (const f of dev.filter((x) => x.endsWith('.sql') && !x.endsWith('.rollback.sql'))) expect(exists(`supabase/workspace-dev/${f.replace(/\.sql$/, '.rollback.sql')}`), f).toBe(true);
    const mig = exists('supabase/migrations') ? fs.readdirSync(path.join(root, 'supabase', 'migrations')).filter((f) => f.includes('m7m8_b5')) : [];
    expect(mig).toEqual([]);
  });
});
