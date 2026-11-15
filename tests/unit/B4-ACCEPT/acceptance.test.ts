import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// 第 4 批全批驗收（靜態檢查）：正式區 SQL 草稿 31–35 齊全、都有撤回檔、README 套用順序與核准人指派說明完整、
// 對等差異登記（allowlist）的核可欄位只有兩種寫法、待確認項都列在設計文件 12.6、劇本與頁面登錄沒有漏。
const ROOT = path.resolve(__dirname, '../../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SQL = 'docs/vue-workspace/parity-plan/m7m8-sql';
const raw = JSON.parse(read('tests/parity/allowlist.json')) as any;
const list: any[] = Array.isArray(raw) ? raw : raw.entries || raw.items || [];
const b4 = list.filter((e) => /^m7m8-b4-/.test(e.id));

describe('正式區 SQL 草稿 31–35', () => {
  const names: Record<string, string> = { 32: 'b4-request-rules', 33: 'b4-purchase-orders', 34: 'b4-receipt-dispatch', 35: 'b4-asset-transfer-follow' };
  it('31 只有 SELECT（唯讀預覽）', () => {
    const t = read(`${SQL}/31-b4-preview-before-apply.sql`);
    expect(t).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+public|DELETE\s+FROM|DROP\s+TABLE|ALTER\s+TABLE|CREATE\s+(OR\s+REPLACE\s+)?(FUNCTION|TABLE))/i);
  });
  for (const [n, name] of Object.entries(names)) {
    it(`${n} 與 ${n}-rollback 都存在、有 BEGIN 與 COMMIT`, () => {
      for (const f of [`${n}-${name}.sql`, `${n}-${name}-rollback.sql`]) {
        const t = read(`${SQL}/${f}`);
        expect(t.length, f).toBeGreaterThan(200);
        expect(t, f).toMatch(/BEGIN;/);
        expect(t, f).toMatch(/COMMIT;/);
      }
    });
  }
  it('草稿不含正式區專案代碼與密碼金鑰', () => {
    for (const n of [31, 32, 33, 34, 35]) {
      for (const x of fs.readdirSync(path.join(ROOT, SQL)).filter((y) => y.startsWith(`${n}-`))) {
        expect(read(`${SQL}/${x}`), x).not.toMatch(/odvk|eyJ[A-Za-z0-9_-]{20,}|service_role_key/i);
      }
    }
  });
  it('草稿 33 只新增權限碼、不指派給任何角色', () => {
    const t = read(`${SQL}/33-b4-purchase-orders.sql`);
    expect(t).toContain('general_affairs.purchase_order.approve');
    expect(t).not.toMatch(/INSERT\s+INTO\s+public\.role_permissions/i);
  });
  it('DEV 專用的清除函式與種子角色不在正式區草稿裡', () => {
    for (const n of [32, 33, 34, 35]) {
      for (const x of fs.readdirSync(path.join(ROOT, SQL)).filter((y) => y.startsWith(`${n}-`))) {
        const t = read(`${SQL}/${x}`);
        expect(t, x).not.toContain('ga_dev_cleanup_m7m8_purchasing');
        expect(t, x).not.toContain('vue_workspace_ga_po_approver');
      }
    }
  });
});

describe('README（第 4 批章節）', () => {
  const t = read(`${SQL}/README.md`);
  it('套用順序 31、32、33、34、35，撤回順序相反', () => {
    expect(t).toMatch(/`31`（唯讀）→[^\n]*`32` → `33` → `34` → `35`/);
    expect(t).toMatch(/`35` → `34` → `33` → `32`/);
  });
  it('每個草稿與撤回檔都列在表內', () => {
    for (const f of ['31-b4-preview-before-apply.sql', '32-b4-request-rules.sql', '32-b4-request-rules-rollback.sql', '33-b4-purchase-orders.sql', '33-b4-purchase-orders-rollback.sql', '34-b4-receipt-dispatch.sql', '34-b4-receipt-dispatch-rollback.sql', '35-b4-asset-transfer-follow.sql', '35-b4-asset-transfer-follow-rollback.sql']) expect(t, f).toContain(f);
  });
  it('有核准人指派步驟、核准人不可核准自己、至少兩位核准人、先建好供應商', () => {
    expect(t).toContain('general_affairs.purchase_order.approve');
    expect(t).toContain('角色權限頁');
    expect(t).toMatch(/不可核准自己/);
    expect(t).toMatch(/兩位/);
    expect(t).toMatch(/供應商/);
  });
});

describe('對等差異登記（allowlist）', () => {
  it('第 4 批差異有登記，核可欄位是「使用者問卷核可」或 null（待確認）', () => {
    expect(b4.length).toBeGreaterThanOrEqual(100);
    for (const e of b4) expect(e.approvedBy === null || (typeof e.approvedBy === 'string' && e.approvedBy.startsWith('user (')), e.id).toBe(true);
  });
  it('第 4 批問卷（2026-11-12）核可的有 50 筆以上', () => {
    expect(b4.filter((e) => e.approvedBy === 'user (2026-11-12 batch 4 spec survey)').length).toBeGreaterThanOrEqual(50);
  });
  it('每筆都有頁面與原因', () => {
    for (const e of b4) {
      expect(e.page, e.id).toBeTruthy();
      expect(String(e.reason || '').length, e.id).toBeGreaterThan(5);
    }
  });
  it('id 不重複', () => {
    const ids = list.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('待使用者確認的新發現（approvedBy 為 null）都列在設計文件 12.6', () => {
    const doc = read('docs/vue-workspace/parity-plan/m7m8-batch4-design.md');
    expect(doc).toContain('### 12.6');
    const pending = b4.filter((e) => e.approvedBy == null);
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.filter((e) => !doc.includes(e.id)).map((e) => e.id)).toEqual([]);
  });
});

describe('劇本與登錄', () => {
  it('四支角色劇本都存在，且各有「沒權限做不到」一段', () => {
    for (const f of ['G25.journey-printers', 'G16.journey-equipment-purchase', 'G17.journey-part-replenish', 'G27.journey-transfer-follow']) {
      expect(read(`tests/e2e/${f}.e2e.spec.ts`), f).toMatch(/沒權限做不到|沒有權限者做不到/);
    }
  });
  it('新頁面都存在，四個舊路由在 route-inventory 標為已原生化', () => {
    const inv = JSON.parse(read('docs/vue-workspace/route-inventory.json')) as any[];
    for (const r of ['/general-affairs/reports/new', '/general-affairs/reports/mine', '/general-affairs/requests', '/general-affairs/part-fulfillments']) {
      const row = inv.find((x) => x.legacyRoute === r);
      expect(row, r).toBeTruthy();
      expect(row.status, r).toMatch(/已原生化/);
    }
    for (const p of ['ReportCreate', 'MyReports', 'Requests', 'PartFulfillments', 'PurchaseOrders', 'PurchaseOrderEdit', 'PurchaseApprovals']) {
      expect(fs.existsSync(path.join(ROOT, `vue-workspace/src/pages/ga/${p}.vue`)), p).toBe(true);
    }
  });
  it('DEV SQL 都附 rollback（140000、150000 為 DEV 專用）', () => {
    const dir = path.join(ROOT, 'supabase/workspace-dev');
    for (const n of ['100000_m7m8_b4_request_rules', '110000_m7m8_b4_purchase_orders', '120000_m7m8_b4_receipt_dispatch', '130000_m7m8_b4_asset_transfer_follow', '140000_m7m8_b4_dev_test_cleanup', '150000_m7m8_b4_dev_roles']) {
      expect(fs.existsSync(path.join(dir, `20261112${n}.sql`)), n).toBe(true);
      expect(fs.existsSync(path.join(dir, `20261112${n}.rollback.sql`)), `${n} rollback`).toBe(true);
    }
  });
});
