import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { apiAs, TEST_ORIGIN } from '../support/auth';

type Account = {
  key: string;
  kind: 'role' | 'module';
  permissions: string[] | 'ALL';
  expected: {
    capabilities: Record<string, boolean>;
    navigationHrefs: string[];
    permissionCount: number;
  };
};

const fixture = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', 'fixtures', 'role-matrix.json'), 'utf8'),
) as { accounts: Account[] };

test.describe('角色矩陣：每個帳號都能登入且 session 與 role-matrix.json 一致', () => {
  test('未登入 session 為 401（不是 503）', async ({ request }) => {
    const res = await request.get(`${TEST_ORIGIN}/api/workspace/session`);
    expect(res.status()).toBe(401);
  });

  for (const account of fixture.accounts) {
    test(`${account.key}`, async () => {
      const api = await apiAs(account.key);
      try {
        const res = await api.get('/api/workspace/session');
        expect(res.status()).toBe(200);
        const body = await res.json();
        const hrefs: string[] = body.navigation
          .flatMap((g: { items: { href: string }[] }) => g.items.map((i) => i.href))
          .sort();

        expect(body.environment).toBe('DEV');
        // 權限碼：與 fixture 宣告完全一致（ALL 則以數量比對）。
        if (account.permissions === 'ALL') {
          expect(body.permissions.length).toBe(account.expected.permissionCount);
        } else {
          expect([...body.permissions].sort()).toEqual([...account.permissions].sort());
        }
        expect(body.capabilities).toEqual(account.expected.capabilities);
        expect(hrefs).toEqual(account.expected.navigationHrefs);

        // 與實作無關的不變式。
        const caps = Object.values(body.capabilities as Record<string, boolean>);
        if (account.key === 'admin') expect(caps.every(Boolean)).toBe(true);
        if (account.key === 'denied') expect(caps.some(Boolean)).toBe(false);
      } finally {
        await api.dispose();
      }
    });
  }

  test('編輯類細分帳號的 session 權限包含對應 view 權限（累加）', async () => {
    const view = fixture.accounts.find((a) => a.key === 'role_mgmt_view')!;
    const edit = fixture.accounts.find((a) => a.key === 'role_mgmt_edit')!;
    for (const code of view.permissions as string[]) expect(edit.permissions).toContain(code);
    expect(edit.expected.permissionCount).toBeGreaterThan(view.expected.permissionCount);
  });
});
