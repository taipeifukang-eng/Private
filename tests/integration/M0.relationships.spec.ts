import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { apiAs, TEST_ORIGIN } from '../support/auth';

// M0 樣本頁「關係會員」整合層：/api/workspace/relationships 的角色權限矩陣與 Origin 檢查。
// 只讀取與「必然被拒絕或驗證失敗」的請求（不存在的 UUID、空內容），不會寫入任何資料。

type Account = { key: string; permissions: string[] | 'ALL'; expected: { capabilities: Record<string, boolean> } };
const accounts = (JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'fixtures', 'role-matrix.json'), 'utf8')) as { accounts: Account[] }).accounts;

const MISSING_ID = '00000000-0000-4000-8000-000000000000';
const has = (a: Account, code: string) => a.permissions === 'ALL' || a.permissions.includes(code);
const anyOf = (a: Account, codes: string[]) => codes.some((c) => has(a, c));
const ANY = ['relationship_member.view', 'relationship_member.edit', 'relationship_member.delete', 'relationship_member.approve'];

test('未登入：列表、銷售、寫入皆為 401', async ({ request }) => {
  for (const p of ['/api/workspace/relationships', '/api/workspace/relationships/sales']) {
    expect((await request.get(`${TEST_ORIGIN}${p}`)).status(), p).toBe(401);
  }
  const res = await request.post(`${TEST_ORIGIN}/api/workspace/relationships`, { data: {}, headers: { Origin: TEST_ORIGIN } });
  expect(res.status()).toBe(401);
});

for (const account of accounts) {
  test(`權限矩陣 ${account.key}`, async () => {
    const api = await apiAs(account.key);
    try {
      const list = await api.get('/api/workspace/relationships');
      const allowed = anyOf(account, ANY);
      // 與 session capabilities 一致
      expect(allowed).toBe(account.expected.capabilities.relationships);
      if (!allowed) {
        expect(list.status()).toBe(403);
        for (const [method, p] of [['GET', '/sales'], ['POST', ''], ['PATCH', `/${MISSING_ID}`], ['DELETE', `/${MISSING_ID}`], ['POST', `/${MISSING_ID}/approve`]] as const) {
          const r = await api.fetch(`/api/workspace/relationships${p}`, { method, data: method === 'GET' ? undefined : {} });
          expect(r.status(), `${method} ${p}`).toBe(403);
        }
        return;
      }
      expect(list.status()).toBe(200);
      const body = await list.json();
      expect(Array.isArray(body.members)).toBe(true);
      const view = has(account, 'relationship_member.view');
      const edit = has(account, 'relationship_member.edit');
      expect(body.capabilities).toEqual({
        submit: view || edit,
        sales: view || edit,
        edit,
        delete: has(account, 'relationship_member.delete'),
        approve: has(account, 'relationship_member.approve'),
      });

      // 銷售明細：舊 API 規則為 view 或 edit。
      const sales = await api.get('/api/workspace/relationships/sales', { params: { member_number: 'ZTT-NO-SUCH-MEMBER' } });
      expect(sales.status()).toBe(view || edit ? 200 : 403);
      if (view || edit) expect((await sales.json()).sales).toEqual([]);

      // 新增（空內容 -> 驗證 400；沒有 view/edit 則 403）
      const create = await api.post('/api/workspace/relationships', { data: {} });
      expect(create.status()).toBe(view || edit ? 400 : 403);
      // 編輯 / 刪除 / 核可 / 駁回：不存在的 id，只有具權限者能走到 404
      const patch = await api.patch(`/api/workspace/relationships/${MISSING_ID}`, { data: { member_name: 'x', phone: '1', relationship: 'x' } });
      expect(patch.status()).toBe(edit ? 404 : 403);
      const del = await api.delete(`/api/workspace/relationships/${MISSING_ID}`);
      expect(del.status()).toBe(has(account, 'relationship_member.delete') ? 404 : 403);
      const approve = await api.post(`/api/workspace/relationships/${MISSING_ID}/approve`);
      expect(approve.status()).toBe(has(account, 'relationship_member.approve') ? 404 : 403);
      const reject = await api.post(`/api/workspace/relationships/${MISSING_ID}/reject`, { data: { rejection_reason: '整合測試' } });
      expect(reject.status()).toBe(has(account, 'relationship_member.approve') ? 404 : 403);
    } finally {
      await api.dispose();
    }
  });
}

test.describe('Origin 與輸入驗證（admin）', () => {
  test('寫入要求 Origin 為測試站；錯誤 Origin 一律 403', async () => {
    const api = await apiAs('admin');
    try {
      const bad = { Origin: 'http://invalid.test' };
      for (const [method, p] of [['POST', ''], ['PATCH', `/${MISSING_ID}`], ['DELETE', `/${MISSING_ID}`], ['POST', `/${MISSING_ID}/approve`], ['POST', `/${MISSING_ID}/reject`], ['POST', '/sales/import']] as const) {
        const r = await api.fetch(`/api/workspace/relationships${p}`, { method, data: {}, headers: bad });
        expect(r.status(), `${method} ${p}`).toBe(403);
      }
      // 讀取不檢查 Origin
      expect((await api.get('/api/workspace/relationships', { headers: bad })).status()).toBe(200);
    } finally {
      await api.dispose();
    }
  });

  test('輸入驗證：400 / 404', async () => {
    const api = await apiAs('admin');
    try {
      expect((await api.post('/api/workspace/relationships', { data: { member_name: 'x', phone: ' ', relationship: 'x' } })).status()).toBe(400);
      expect((await api.patch('/api/workspace/relationships/not-a-uuid', { data: {} })).status()).toBe(400);
      expect((await api.delete('/api/workspace/relationships/not-a-uuid')).status()).toBe(400);
      expect((await api.post(`/api/workspace/relationships/${MISSING_ID}/reject`, { data: {} })).status()).toBe(400);
      expect((await api.get(`/api/workspace/relationships/${MISSING_ID}`)).status()).toBe(404);
      expect((await api.patch(`/api/workspace/relationships/${MISSING_ID}`, { data: {} })).status()).toBe(400);
    } finally {
      await api.dispose();
    }
  });
});
