import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { gaFlags } from '@/lib/workspace/general-affairs/access';
import { gaNavigation } from '@/lib/workspace/general-affairs/nav';
import { resolveAccess } from '@/lib/workspace/permission-semantics';

// 第 4 批審查後補強（2026-11-16）單元層：入口旗標的資料庫語意、SQL 補強內容（DEV 檔與正式區草稿一致）、設計文件與 allowlist 登記。
const ROOT = path.resolve(__dirname, '../../..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const DEV = 'supabase/workspace-dev/';
const SQL = 'docs/vue-workspace/parity-plan/m7m8-sql/';

const access = (codes: string[], profileRole?: string) =>
  resolveAccess([{ is_active: true, role: { code: 'x', role_permissions: codes.map((c) => ({ is_allowed: true, permission: { code: c, is_active: true } })) } }], profileRole);
const flatten = (groups: any[]): any[] => groups.flatMap((g) => g.items.flatMap((i: any) => [i, ...(i.children || [])]));
const dbHasOf = (a: ReturnType<typeof access>) => (...codes: string[]) => codes.some((c) => a.permissions.has(c));

describe('審查 M1：採購單入口只認資料庫語意（管理員沒勾也不給入口）', () => {
  it('profiles.role 是管理員、沒有採購權限：has 為 true，但採購單與待簽核入口為 false', () => {
    const a = access([], 'admin');
    expect(a.has('general_affairs.purchase_review.view')).toBe(true); // 應用層保底
    const f = gaFlags(a.has, false, false, false, dbHasOf(a));
    expect(f.gaPurchaseOrders).toBe(false);
    expect(f.gaPurchaseApprovals).toBe(false);
    const kinds = flatten(gaNavigation({ has: a.has, permissions: a.permissions as any, roleCodes: a.roleCodes, isAdmin: a.isAdmin })).map((i) => i.kind);
    expect(kinds).not.toContain('ga-purchase-orders');
    expect(kinds).not.toContain('ga-purchase-approvals');
  });
  it('管理員有勾採購檢視與核准時入口都有；一般帳號照權限', () => {
    const a = access(['general_affairs.purchase_review.view', 'general_affairs.purchase_order.approve'], 'admin');
    const f = gaFlags(a.has, false, false, false, dbHasOf(a));
    expect(f).toMatchObject({ gaPurchaseOrders: true, gaPurchaseApprovals: true });
    const v = access(['general_affairs.purchase_review.view']);
    expect(gaFlags(v.has, false, false, false, dbHasOf(v))).toMatchObject({ gaPurchaseOrders: true, gaPurchaseApprovals: false });
  });
  it('沒有傳資料庫語意時沿用 has（相容舊呼叫）', () => {
    const a = access([], 'admin');
    expect(gaFlags(a.has, false).gaPurchaseOrders).toBe(true);
  });
});

describe('審查：SQL 補強內容（DEV 檔與正式區草稿都有）', () => {
  const pairs: [string, string, string[]][] = [
    ['20261112100000_m7m8_b4_request_rules.sql', '32-b4-request-rules.sql', [
      'v_po := round(v_po / v_conv, 4)', // 4 單位統一
      "IF COALESCE(v_req.resource_type, '') <> 'PART' THEN RETURN; END IF;", // 16
      'OR DELETE ON public.ga_purchase_order_items', // 17
      "NOT (d.document_id = ANY (v_linked))", // 17
      'IF v_replay THEN', // 8
      'AND NOT v_replay',
    ]],
    ['20261112110000_m7m8_b4_purchase_orders.sql', '33-b4-purchase-orders.sql', [
      "WHEN o.status = 'CLOSED' THEN LEAST(i.quantity_base", // 1
      "status NOT IN ('CANCELED', 'CLOSED') ORDER BY created_at LIMIT 1", // 1
      'SERIAL_REQUIRED_DIRECT', // 5
      'o.source_request_id = (SELECT r.request_id FROM public.ga_purchase_reviews r', // 14
    ]],
    ['20261112120000_m7m8_b4_receipt_dispatch.sql', '34-b4-receipt-dispatch.sql', [
      "pg_advisory_xact_lock(hashtextextended('ga_serial:'", // 10
      "CASE v_utype WHEN 'PURCHASE' THEN v_rpart.purchase_to_base_rate ELSE 1 END", // 3
      'ASSET_QUANTITY_LIMIT', // 11
    ]],
  ];
  for (const [dev, draft, needles] of pairs) {
    it(`${dev} 與 ${draft} 都含補強內容`, () => {
      const d = read(DEV + dev);
      const p = read(SQL + draft);
      for (const n of needles) {
        expect(d, `DEV ${n}`).toContain(n);
        expect(p, `草稿 ${n}`).toContain(n);
      }
    });
  }
  it('32 與 33 必須連續套用的說明在草稿標頭與 README', () => {
    expect(read(SQL + '32-b4-request-rules.sql')).toMatch(/32 與 33 必須連續套用/);
    expect(read(SQL + 'README.md')).toMatch(/32` 與 `33` 必須連續套用/);
  });
});

describe('審查：伺服端修正在原始碼中', () => {
  it('需求單清單：逾期篩選與逾期統計只給總務', () => {
    const t = read('lib/workspace/general-affairs/requests.ts');
    expect(t).toContain('const overdueOnly = s.manage && FILTERS_BOOL(p.get("overdue")) === true;');
    expect(t).toContain('if (s.manage) stats.overdue =');
  });
  it('處理單單據明細：採購單只在處理單連著它時才讀', () => {
    const t = read('lib/workspace/general-affairs/part-fulfillments.ts');
    expect(t).toMatch(/ga_part_fulfillment_documents"\)\.select\("id"\)\.eq\("document_type", "PURCHASE"\)\.eq\("document_id", id\)/);
    expect(t).toContain('!linked.length ? null');
  });
});

describe('審查：allowlist 與設計文件登記', () => {
  const raw = JSON.parse(read('tests/parity/allowlist.json')) as any;
  const list: any[] = Array.isArray(raw) ? raw : raw.entries || raw.items || [];
  const ids = ['m7m8-b4-rv-po-short-close-releases', 'm7m8-b4-rv-po-direct-asset-serial-blocked', 'm7m8-b4-rv-po-direct-asset-limit-200', 'm7m8-b4-rv-po-nav-db-semantics', 'm7m8-b4-rv-ful-non-part-no-fulfillment', 'm7m8-b4-rv-legacy-receipt-block-by-request'];
  it('新發現的差異都登記為待確認（approvedBy 為 null）並列在設計文件 12.7', () => {
    const doc = read('docs/vue-workspace/parity-plan/m7m8-batch4-design.md');
    expect(doc).toContain('### 12.7');
    for (const id of ids) {
      const e = list.find((x) => x.id === id);
      expect(e, id).toBeTruthy();
      expect(e.approvedBy, id).toBeNull();
      expect(doc, id).toContain(id);
    }
  });
});
