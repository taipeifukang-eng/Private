import { expect, test, request as pwRequest, type APIRequestContext } from '@playwright/test';
import * as XLSX from 'xlsx';
import { apiAs, TEST_ORIGIN } from '../support/auth';
import { adminDb, apiForUser, cleanupM6Relationships, memberName, runIdOrThrow, salesFileName, setupM6Users, type M6User } from '../support/m6-fixtures';

/**
 * M6 第一批 P07 關係會員：角色矩陣（view／edit／approve／delete／無權限）、動作授權、並行填寫會員編號（一成功一個 409）、
 * 銷售明細重複匯入（舊版不去重；workspace 匯入略過已存在的相同明細）。
 * 資料：成員姓名 ZT<runId>-…、匯入檔名 m6p07-<runId>-…、銷售日期年度 2038、門市 VW001；只刪自己建立的資料。
 */
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const SALES_HEADER = ['門市代號', '銷售日期', '會員編號', '品號', '品名', '數量', '金額'];
type SaleRow = [string, string, string, string, string, number, number];
const row = (member: string, over: Partial<{ date: string; code: string; qty: number; amount: number }> = {}): SaleRow => ['VW001', over.date ?? '2038/03/01 14:30', member, over.code ?? 'P001', '測試商品', over.qty ?? 1, over.amount ?? 100];
function workbook(rows: SaleRow[]): Buffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([SALES_HEADER, ...rows]), '銷售');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
const upload = (api: APIRequestContext, url: string, name: string, buffer: Buffer) => api.post(url, { multipart: { file: { name, mimeType: XLSX_MIME, buffer } } });

let users: Record<string, M6User>;
let teardown: () => Promise<string[]>;
const apis: Record<string, APIRequestContext> = {};
const ROLES = ['admin', 'relationship_view', 'relationship_edit', 'relationship_delete', 'rel_approve', 'denied', 'employee'] as const;
type Role = (typeof ROLES)[number];

test.beforeAll(async () => {
  runIdOrThrow();
  ({ users, teardown } = await setupM6Users(['rel_approve']));
  for (const role of ROLES) apis[role] = role === 'rel_approve' ? await apiForUser(users.rel_approve) : await apiAs(role);
});
test.afterAll(async () => {
  for (const a of Object.values(apis)) await a.dispose();
  await cleanupM6Relationships();
  const left = await teardown();
  expect(left, `清除臨時帳號：${left.join('; ')}`).toEqual([]);
});

const CAPS: Record<Role, Record<string, boolean> | null> = {
  admin: { submit: true, sales: true, edit: true, delete: true, approve: true },
  relationship_view: { submit: true, sales: true, edit: false, delete: false, approve: false },
  relationship_edit: { submit: true, sales: true, edit: true, delete: false, approve: false },
  relationship_delete: { submit: true, sales: true, edit: false, delete: true, approve: false },
  rel_approve: { submit: false, sales: false, edit: false, delete: false, approve: true },
  denied: null,
  employee: null,
};

test('角色矩陣：capabilities 與導覽入口（view／edit／delete／approve 各一帳號，無權限被擋）', async () => {
  for (const role of ROLES) {
    const list = await apis[role].get('/api/workspace/relationships');
    const caps = CAPS[role];
    if (!caps) {
      expect(list.status(), `${role} 列表`).toBe(403);
    } else {
      expect(list.status(), `${role} 列表`).toBe(200);
      expect((await list.json()).capabilities, role).toEqual(caps);
    }
    const session = await (await apis[role].get('/api/workspace/session')).json();
    const hrefs: string[] = session.navigation.flatMap((g: { items: { href: string }[] }) => g.items.map((i) => i.href));
    expect(hrefs.includes('/store/relationship-members'), `${role} 導覽入口`).toBe(!!caps);
  }
  const anon = await pwRequest.newContext({ baseURL: TEST_ORIGIN });
  try {
    expect((await anon.get('/api/workspace/relationships')).status()).toBe(401);
    expect((await anon.get('/api/workspace/relationships/sales')).status()).toBe(401);
  } finally {
    await anon.dispose();
  }
});

test('動作授權：誰可以建立、編輯、核可、駁回、刪除、匯入、查銷售；刪除會員後銷售歷史保留', async () => {
  test.setTimeout(180_000);
  const name = memberName('rbac');
  const number = `M6RBAC${runIdOrThrow().replace('-', '')}`;
  const created = await apis.relationship_edit.post('/api/workspace/relationships', { data: { member_name: name, phone: '0900000000', relationship: '自動測試' } });
  expect(created.status()).toBe(201);
  const id: string = (await created.json()).id;
  const url = `/api/workspace/relationships/${id}`;
  const form = { member_name: name, phone: '0900000000', relationship: '自動測試編輯', member_number: number };

  // 建立：view 或 edit 即可（approve 單獨不行）
  for (const [role, status] of [['relationship_view', 201], ['relationship_delete', 201], ['rel_approve', 403]] as const) {
    const r = await apis[role].post('/api/workspace/relationships', { data: { member_name: memberName(`c-${role}`), phone: '0911', relationship: '自動測試' } });
    expect(r.status(), `建立 ${role}`).toBe(status);
  }
  // 編輯：只有 edit 能；其餘 403
  for (const role of ['relationship_view', 'relationship_delete', 'rel_approve', 'denied'] as Role[]) expect((await apis[role].patch(url, { data: form })).status(), `編輯 ${role}`).toBe(403);
  // 核可、駁回：只有 approve（與 admin）能
  for (const role of ['relationship_view', 'relationship_edit', 'relationship_delete', 'denied'] as Role[]) {
    expect((await apis[role].post(`${url}/approve`)).status(), `核可 ${role}`).toBe(403);
    expect((await apis[role].post(`${url}/reject`, { data: { rejection_reason: 'x' } })).status(), `駁回 ${role}`).toBe(403);
  }
  // 刪除：只有 delete 能
  for (const role of ['relationship_view', 'relationship_edit', 'rel_approve', 'denied'] as Role[]) expect((await apis[role].delete(url)).status(), `刪除 ${role}`).toBe(403);
  // 匯入：只有 edit 能
  const file = workbook([row(number, { code: 'RBAC1' })]);
  for (const role of ['relationship_view', 'relationship_delete', 'rel_approve', 'denied'] as Role[]) {
    expect((await upload(apis[role], '/api/workspace/relationships/sales/import', salesFileName(`deny-${role}`), file)).status(), `匯入 ${role}`).toBe(403);
  }
  // 查銷售：view 或 edit（approve 單獨不行）
  for (const [role, status] of [['relationship_view', 200], ['relationship_delete', 200], ['rel_approve', 403], ['denied', 403]] as const) expect((await apis[role].get('/api/workspace/relationships/sales', { params: { member_number: number } })).status(), `銷售 ${role}`).toBe(status);

  // 允許的動作逐一走完
  expect((await apis.relationship_edit.patch(url, { data: form })).status()).toBe(200);
  expect((await upload(apis.relationship_edit, '/api/workspace/relationships/sales/import', salesFileName('rbac'), file)).status()).toBe(200);
  expect((await apis.rel_approve.post(`${url}/reject`, { data: { rejection_reason: '自動測試退回' } })).status()).toBe(200);
  expect((await apis.rel_approve.post(`${url}/approve`)).status()).toBe(200);
  const mine = (await (await apis.relationship_view.get('/api/workspace/relationships')).json()).members.find((m: { id: string }) => m.id === id);
  expect(mine).toMatchObject({ is_approved: true, member_number: number, relationship: '自動測試編輯' });
  expect((await apis.relationship_delete.delete(url)).status()).toBe(200);
  const after = (await (await apis.admin.get('/api/workspace/relationships/sales', { params: { member_number: number } })).json()).sales;
  expect(after, '刪除會員後銷售歷史仍保留').toHaveLength(1);
});

test('並行填寫會員編號：兩個請求同時送，一個成功、一個 409（連續 3 回合）；填同一個編號則兩邊都成功', async () => {
  test.setTimeout(180_000);
  const second = await apiAs('relationship_edit', { force: true });
  try {
    for (let round = 0; round < 3; round += 1) {
      const name = memberName(`race${round}`);
      const created = await apis.relationship_edit.post('/api/workspace/relationships', { data: { member_name: name, phone: '0900000001', relationship: '自動測試' } });
      const id: string = (await created.json()).id;
      const body = (n: string) => ({ member_name: name, phone: '0900000001', relationship: '自動測試', member_number: n });
      const a = `M6RACE${round}A${Date.now()}`;
      const b = `M6RACE${round}B${Date.now()}`;
      const [x, y] = await Promise.all([apis.relationship_edit.patch(`/api/workspace/relationships/${id}`, { data: body(a) }), second.patch(`/api/workspace/relationships/${id}`, { data: body(b) })]);
      expect([x.status(), y.status()].sort(), `第 ${round + 1} 回合`).toEqual([200, 409]);
      const winner = x.status() === 200 ? a : b;
      const row = (await (await apis.admin.get('/api/workspace/relationships')).json()).members.find((m: { id: string }) => m.id === id);
      expect(row.member_number).toBe(winner);
      expect(((await (x.status() === 409 ? x : y).json()) as { error: string }).error).toBe('會員編號已建立，不可清空或再次修改');
      expect((await apis.admin.delete(`/api/workspace/relationships/${id}`)).status()).toBe(200);
    }
    const name = memberName('race-same');
    const id: string = (await (await apis.relationship_edit.post('/api/workspace/relationships', { data: { member_name: name, phone: '0900000002', relationship: '自動測試' } })).json()).id;
    const same = { member_name: name, phone: '0900000002', relationship: '自動測試', member_number: `M6SAME${Date.now()}` };
    const [p, q] = await Promise.all([apis.relationship_edit.patch(`/api/workspace/relationships/${id}`, { data: same }), second.patch(`/api/workspace/relationships/${id}`, { data: same })]);
    expect([p.status(), q.status()]).toEqual([200, 200]);
    expect((await apis.admin.delete(`/api/workspace/relationships/${id}`)).status()).toBe(200);
  } finally {
    await second.dispose();
  }
});

test('舊版 PATCH 規則仍成立：已建立的會員編號不可改（409）、他人已用的編號 409、必填 400', async () => {
  const name = memberName('lock');
  const id: string = (await (await apis.relationship_edit.post('/api/workspace/relationships', { data: { member_name: name, phone: '0900000003', relationship: '自動測試' } })).json()).id;
  const url = `/api/workspace/relationships/${id}`;
  const n1 = `M6LOCK${Date.now()}`;
  const form = { member_name: name, phone: '0900000003', relationship: '自動測試', member_number: n1 };
  try {
    expect((await apis.relationship_edit.patch(url, { data: { ...form, phone: '' } })).status()).toBe(400);
    expect((await apis.relationship_edit.patch(url, { data: form })).status()).toBe(200);
    expect((await apis.relationship_edit.patch(url, { data: { ...form, relationship: '改關係' } })).status()).toBe(200);
    expect((await apis.relationship_edit.patch(url, { data: { ...form, member_number: n1 + 'X' } })).status()).toBe(409);
    expect((await apis.relationship_edit.patch(url, { data: { ...form, member_number: '' } })).status()).toBe(409);
    const other: string = (await (await apis.relationship_edit.post('/api/workspace/relationships', { data: { member_name: memberName('lock2'), phone: '0900000004', relationship: '自動測試' } })).json()).id;
    const dup = await apis.relationship_edit.patch(`/api/workspace/relationships/${other}`, { data: { member_name: memberName('lock2'), phone: '0900000004', relationship: '自動測試', member_number: n1 } });
    expect(dup.status()).toBe(409);
    expect((await dup.json()).error).toBe('此會員編號已被其他關係會員使用');
    expect((await apis.admin.delete(`/api/workspace/relationships/${other}`)).status()).toBe(200);
    expect((await apis.relationship_edit.patch('/api/workspace/relationships/00000000-0000-4000-8000-000000000000', { data: form })).status()).toBe(404);
  } finally {
    await apis.admin.delete(url);
  }
});

test('銷售明細重複匯入：舊版不去重（照舊），workspace 匯入略過內容完全相同的明細', async () => {
  test.setTimeout(240_000);
  const db = adminDb();
  const stamp = runIdOrThrow().replace('-', '');
  const m1 = `M6IMP${stamp}A`;
  const m2 = `M6IMP${stamp}B`;
  const countRows = async (member: string) => ((await (await apis.admin.get('/api/workspace/relationships/sales', { params: { member_number: member } })).json()).sales as unknown[]).length;
  const batchCount = async (like: string) => (await db.from('relationship_sales_imports').select('id', { count: 'exact', head: true }).like('file_name', like)).count as number;
  const WS = '/api/workspace/relationships/sales/import';
  const edit = apis.relationship_edit;

  // 舊 route（不動）：同檔連續匯入兩次，兩次都新增（不去重），各建一個批次
  const legacyFile = workbook([row(m2, { code: 'L1' }), row(m2, { code: 'L2' })]);
  for (let i = 0; i < 2; i += 1) {
    const r = await upload(edit, '/api/relationship-sales/import', salesFileName('legacy'), legacyFile);
    expect(r.status()).toBe(200);
    expect(await r.json()).toEqual({ success: true, imported: 2 });
  }
  expect(await countRows(m2), '舊版連續匯入兩次後有 4 筆').toBe(4);
  expect(await batchCount(salesFileName('legacy'))).toBe(2);

  // 新版：首次匯入
  const file = workbook([row(m1, { code: 'P1' }), row(m1, { code: 'P2', qty: 2, amount: 250.5 })]);
  let r = await upload(edit, WS, salesFileName('first'), file);
  expect(r.status()).toBe(200);
  expect(await r.json()).toEqual({ success: true, imported: 2, skipped: 0 });
  expect(await countRows(m1)).toBe(2);
  // 同檔重傳：全部略過、不建空批次
  r = await upload(edit, WS, salesFileName('again'), file);
  expect(await r.json()).toEqual({ success: true, imported: 0, skipped: 2 });
  expect(await countRows(m1)).toBe(2);
  expect(await batchCount(salesFileName('again')), '全部重複時不建立空批次').toBe(0);
  // 部分重疊：1 筆已存在、1 筆新增
  r = await upload(edit, WS, salesFileName('partial'), workbook([row(m1, { code: 'P1' }), row(m1, { code: 'P3' })]));
  expect(await r.json()).toEqual({ success: true, imported: 1, skipped: 1 });
  expect(await countRows(m1)).toBe(3);
  // 數量或金額或時間不同就不是重複
  r = await upload(edit, WS, salesFileName('differs'), workbook([row(m1, { code: 'P1', qty: 2 }), row(m1, { code: 'P1', amount: 101 }), row(m1, { code: 'P1', date: '2038/03/01 14:31' })]));
  expect(await r.json()).toEqual({ success: true, imported: 3, skipped: 0 });
  // 同檔內本身相同的列：資料庫沒有時全部新增；重傳則全部略過
  const m3 = `M6IMP${stamp}C`;
  const twin = workbook([row(m3, { code: 'T1' }), row(m3, { code: 'T1' })]);
  r = await upload(edit, WS, salesFileName('twin'), twin);
  expect(await r.json()).toEqual({ success: true, imported: 2, skipped: 0 });
  r = await upload(edit, WS, salesFileName('twin2'), twin);
  expect(await r.json()).toEqual({ success: true, imported: 0, skipped: 2 });
  expect(await countRows(m3)).toBe(2);
  // 檔案與舊版匯入過的資料重疊也會略過（比對的是資料庫現有明細，不分批次）
  r = await upload(edit, WS, salesFileName('vs-legacy'), legacyFile);
  expect(await r.json()).toEqual({ success: true, imported: 0, skipped: 2 });
  expect(await countRows(m2)).toBe(4);

  // 並行匯入同一份新檔案：總共只會有 2 筆
  const m4 = `M6IMP${stamp}D`;
  const parallel = workbook([row(m4, { code: 'C1' }), row(m4, { code: 'C2' })]);
  const edit2 = await apiAs('relationship_edit', { force: true });
  try {
    const [a, b] = await Promise.all([upload(edit, WS, salesFileName('par1'), parallel), upload(edit2, WS, salesFileName('par2'), parallel)]);
    const results = [await a.json(), await b.json()];
    expect(results.map((x) => x.imported).sort()).toEqual([0, 2]);
    expect(results.map((x) => x.skipped).sort()).toEqual([0, 2]);
    expect(await countRows(m4), '並行匯入同一檔不產生重複').toBe(2);
  } finally {
    await edit2.dispose();
  }
});

test('匯入驗證：workspace 與舊 route 對同一份壞檔回應相同（狀態碼與訊息）；寫入走 Origin 檢查', async () => {
  const m = `M6BAD${runIdOrThrow().replace('-', '')}`;
  const bad = (rows: unknown[][], header = SALES_HEADER) => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([header, ...rows]), 's');
    return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  };
  const cases: [string, Buffer][] = [
    ['日期不存在', bad([['VW001', '2038/02/30 10:00', m, 'P1', 'n', 1, 1]])],
    ['日期格式錯', bad([['VW001', '2038-03-01 10:00', m, 'P1', 'n', 1, 1]])],
    ['數量非數字', bad([['VW001', '2038/03/01 10:00', m, 'P1', 'n', 'x', 1]])],
    ['缺欄位', bad([['VW001', '2038/03/01 10:00', m, 'P1', 'n', 1]], SALES_HEADER.slice(0, 6))],
    ['欄位順序錯', bad([[m, 'VW001', '2038/03/01 10:00', 'P1', 'n', 1, 1]], ['會員編號', '門市代號', '銷售日期', '品號', '品名', '數量', '金額'])],
    ['沒有資料', bad([])],
    ['第 2、4 列有誤', bad([['VW001', '2038/03/01 10:00', m, 'P1', 'n', 1, 1], ['', '2038/03/01 10:00', m, 'P1', 'n', 1, 1], ['VW001', '2038/03/01 10:00', m, 'P1', 'n', 1, 1], ['VW001', '2038/03/01 10:00', m, '', 'n', 1, 1]])],
  ];
  for (const [label, buffer] of cases) {
    const legacy = await upload(apis.relationship_edit, '/api/relationship-sales/import', salesFileName('bad'), buffer);
    const native = await upload(apis.relationship_edit, '/api/workspace/relationships/sales/import', salesFileName('bad'), buffer);
    expect(native.status(), label).toBe(legacy.status());
    expect(legacy.status(), label).toBe(400);
    expect(await native.json(), label).toEqual(await legacy.json());
  }
  const none = await apis.relationship_edit.post('/api/workspace/relationships/sales/import', { multipart: { other: 'x' } });
  expect(none.status()).toBe(400);
  expect((await upload(apis.relationship_edit, '/api/workspace/relationships/sales/import', 'x.csv', Buffer.from('a,b'))).status()).toBe(400);
  const noOrigin = await pwRequest.newContext({ baseURL: TEST_ORIGIN, storageState: await apis.relationship_edit.storageState(), extraHTTPHeaders: { Origin: 'http://invalid.test' } });
  try {
    expect((await upload(noOrigin, '/api/workspace/relationships/sales/import', salesFileName('origin'), workbook([row(m)]))).status()).toBe(403);
  } finally {
    await noOrigin.dispose();
  }
  expect(((await (await apis.admin.get('/api/workspace/relationships/sales', { params: { member_number: m } })).json()).sales as unknown[]).length, '壞檔不會寫入任何資料').toBe(0);
});
