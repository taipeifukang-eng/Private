import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(__dirname, '..', '..');
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/role-matrix.json'), 'utf8'));
const { validateFixture, parseLegacyFile } = require(path.join(root, 'scripts/seed-workspace-role-matrix-dev.cjs'));

const REQUIRED_ROLE_KEYS = [
  'admin', 'navigation', 'ops_manager', 'ops_assistant', 'supervisor', 'store_manager', 'acting_manager',
  'pharmacist', 'inventory_team', 'ga_staff', 'ga_vendor_manager', 'employee', 'denied',
  // M7/M8 第 1 批準備：工務（Q25，與總務同權限）與綁 VW001 的第二位店長（別間門市看不到的測試）
  'ga_works', 'ga_store_manager_b',
  // M7/M8 第 3 批 G11：庫存位置只有查看／管理（沒有料件查看）的測試帳號（記帳與調撥的 *_only 帳號在下面的單一權限清單）
  'ga_inv_location_view', 'ga_inv_location_edit',
];

describe('T01 role-matrix.json', () => {
  it('包含 D06 的 13 個角色，加上 M7/M8 的工務與第二位店長', () => {
    const keys = fixture.accounts.filter((a: { kind: string; key: string }) => a.kind === 'role' && !a.key.endsWith('_only')).map((a: { key: string }) => a.key);
    expect(keys).toEqual(REQUIRED_ROLE_KEYS);
  });

  it('單一權限帳號（*_only）各自只持有一個權限（W06 異動、第 3 批庫存記帳與調撥）', () => {
    const single = Object.fromEntries(
      fixture.accounts.filter((a: { key: string }) => a.key.endsWith('_only')).map((a: { key: string; permissions: string[] }) => [a.key, a.permissions]),
    );
    expect(single).toEqual({
      movement_manage_only: ['employee.movement.manage'],
      employee_manage_only: ['employee.manage'],
      promotion_batch_only: ['employee.promotion.batch'],
      promotion_delete_only: ['employee.promotion.delete'],
      ga_inv_txn_only: ['general_affairs.inventory_transaction.manage'],
      ga_inv_transfer_only: ['general_affairs.inventory_transfer.manage'],
    });
  });

  it('通過 seed 的安全邊界驗證（@example.test、vue_workspace_*、VW/ZT 門市）', () => {
    expect(validateFixture(fixture)).toEqual([]);
  });

  it('validateFixture 會擋下非測試網域、非 vue_workspace 角色與非測試門市', () => {
    const bad = JSON.parse(JSON.stringify(fixture));
    bad.accounts[0].email = 'someone@real-company.com';
    bad.accounts[1].roleCode = 'manager';
    bad.accounts[2].systemRoles = ['dev_full_admin'];
    bad.stores.push({ store_code: '0002', store_name: 'x' });
    const errors = validateFixture(bad).join('\n');
    expect(errors).toContain('email 網域');
    expect(errors).toContain('roleCode 不是');
    expect(errors).toContain('不允許掛系統角色');
    expect(errors).toContain('不是 VW*/ZT* 測試門市');
  });

  it('module 細分帳號採累加權限，且至少有 view 帳號', () => {
    for (const m of fixture.modules) {
      const view = fixture.accounts.find((a: { key: string }) => a.key === `${m.key}_view`);
      expect(view, `${m.key}_view`).toBeTruthy();
      const edit = fixture.accounts.find((a: { key: string }) => a.key === `${m.key}_edit`);
      if (edit) for (const c of m.view) expect(edit.permissions).toContain(c);
    }
  });

  it('只有 admin 帳號掛系統角色 admin', () => {
    const withSystem = fixture.accounts.filter((a: { systemRoles: string[] }) => a.systemRoles.length);
    expect(withSystem.map((a: { key: string }) => a.key)).toEqual(['admin']);
  });

  it('缺漏的權限碼已列出（不硬造）', () => {
    expect(Array.isArray(fixture.missingPermissions)).toBe(true);
    const all = new Set(fixture.accounts.flatMap((a: { permissions: string[] | string }) => (a.permissions === 'ALL' ? [] : a.permissions)));
    for (const c of fixture.missingPermissions) expect(all.has(c)).toBe(false);
  });
});

describe('T01 舊明碼檔解析（不過濾網域，由整併流程分類報告）', () => {
  it('回傳檔內全部帳號，不在解析階段丟棄', () => {
    const dir = fs.mkdtempSync(path.join(root, 'tests', 'reports', '.t01-'));
    try {
      const f = path.join(dir, 'x.txt');
      fs.writeFileSync(f, 'editor\n帳號：a@example.test\n密碼：pw1\n\nother\n帳號：b@real.com\n密碼：pw2\n');
      expect(parseLegacyFile(f)).toEqual([
        { email: 'a@example.test', password: 'pw1' },
        { email: 'b@real.com', password: 'pw2' },
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
