import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { apiAs } from '../support/auth';
import {
  buildBody,
  deleteRunInspections,
  findMasterByNotes,
  marker,
  registerInspection,
  runIdOrThrow,
  storeIdByCode,
  readMaster,
} from '../support/i01-fixtures';
import { adminDb } from '../support/m4-fixtures';
import { BLANK_TRANSPARENT, BLANK_WHITE, SIGNED } from '../support/png';
import { scoreInspection } from '../../lib/workspace/inspection-scoring';

// W14 整合層（M4 Q9–Q12、W15 重送）：
//  Q12 正式送出後端檢查雙簽名與非空白，草稿不限；Q10 編輯舊單只評舊單當時就有的項目；
//  Q9 範本雜湊不符 → 409 擋下且不寫入；Q11 單項扣分超過滿分 → 400；
//  網路中斷後手動重送：同 writeId 同內容回傳同一筆（不重複建立）。
// 測試資料只用測試門市，備註帶 ZT<runId> 標記，結束時只刪自己建立的列。

const post = (api: any, data: unknown) => api.post('/api/workspace/inspection-form', { data });

test.afterAll(async () => {
  await deleteRunInspections();
});

test.describe('Q12 簽名（後端）', () => {
  test('正式送出：缺簽名、空白簽名一律 400 且不寫入；兩個都有筆跡才成功', async () => {
    runIdOrThrow();
    const admin = await apiAs('admin');
    try {
      const store = await storeIdByCode(admin, 'ZT01');
      const tag = 'w14-sign-completed';
      const cases: [string, string, string, RegExp][] = [
        ['兩個都沒簽', '', '', /兩個簽名/],
        ['只有店長簽', SIGNED(), '', /兩個簽名/],
        ['只有督導簽', '', SIGNED(), /兩個簽名/],
        ['店長簽名空白（全白）', BLANK_WHITE(), SIGNED(), /空白/],
        ['督導簽名空白（全透明）', SIGNED(), BLANK_TRANSPARENT(), /空白/],
        ['兩個都空白', BLANK_WHITE(), BLANK_WHITE(), /空白/],
      ];
      for (const [name, a, b, message] of cases) {
        const body = await buildBody(admin, store, tag, { status: 'completed', signature: a, supervisorSignature: b });
        const res = await post(admin, body);
        const json = await res.json();
        expect(res.status(), `${name}：${JSON.stringify(json).slice(0, 200)}`).toBe(400);
        expect(json.error, name).toMatch(message);
      }
      expect(await findMasterByNotes(marker(tag)), '被擋下的送出不得寫入').toHaveLength(0);
      const ok = await buildBody(admin, store, tag, { status: 'completed', signature: SIGNED(), supervisorSignature: SIGNED() });
      const res = await post(admin, ok);
      expect(res.status(), (await res.text()).slice(0, 200)).toBe(200);
      const id = (await res.json()).record.id;
      await registerInspection(id);
      const row = await readMaster(id);
      expect(row?.status).toBe('completed');
      expect(row?.signature_photo_url).toBeTruthy();
      expect(row?.supervisor_signature_url).toBeTruthy();
    } finally {
      await admin.dispose();
    }
  });

  test('草稿可以不簽，也可以帶空白圖片（D09：草稿不限）', async () => {
    runIdOrThrow();
    const admin = await apiAs('admin');
    try {
      const store = await storeIdByCode(admin, 'ZT02');
      const body = await buildBody(admin, store, 'w14-sign-draft', { status: 'draft', signature: BLANK_WHITE(), supervisorSignature: '' });
      const res = await post(admin, body);
      expect(res.status(), (await res.text()).slice(0, 200)).toBe(200);
      await registerInspection((await res.json()).record.id);
    } finally {
      await admin.dispose();
    }
  });

  test('草稿改成正式送出時同樣檢查簽名（編輯路徑）', async () => {
    runIdOrThrow();
    const admin = await apiAs('admin');
    try {
      const store = await storeIdByCode(admin, 'ZT03');
      const draft = await post(admin, await buildBody(admin, store, 'w14-sign-edit'));
      expect(draft.status()).toBe(200);
      const rec = (await draft.json()).record;
      await registerInspection(rec.id);
      const form = await (await admin.get('/api/workspace/inspection-form', { params: { type: 'supervisor', id: rec.id } })).json();
      const base = {
        id: rec.id,
        version: rec.workspace_version,
        writeId: randomUUID(),
        store,
        type: 'supervisor',
        date: rec.inspection_date,
        temperature: 25,
        notes: marker('w14-sign-edit'),
        staff: [],
        templateHash: form.templateHash,
        scores: (form.templates as { id: string }[]).map((t) => ({ template_id: t.id, checked_items: [], quantities: {}, notes: '', photos: [] })),
      };
      const bad = await post(admin, { ...base, status: 'completed', signature: BLANK_WHITE(), supervisorSignature: SIGNED() });
      expect(bad.status()).toBe(400);
      expect((await bad.json()).error).toMatch(/空白/);
      expect((await readMaster(rec.id))?.status).toBe('draft');
      const good = await post(admin, { ...base, writeId: randomUUID(), status: 'completed', signature: SIGNED(), supervisorSignature: SIGNED() });
      expect(good.status(), (await good.text()).slice(0, 200)).toBe(200);
      expect((await readMaster(rec.id))?.status).toBe('completed');
    } finally {
      await admin.dispose();
    }
  });
});

test.describe('Q10 編輯只評舊單當時就有的項目', () => {
  test('舊單缺一個項目（之後範本才新增）：編輯表單不含它、儲存不補、不要求補評', async () => {
    runIdOrThrow();
    const admin = await apiAs('admin');
    try {
      const store = await storeIdByCode(admin, 'ZT04');
      const created = await post(admin, await buildBody(admin, store, 'w14-q10'));
      expect(created.status()).toBe(200);
      const rec = (await created.json()).record;
      await registerInspection(rec.id);
      const before = await (await admin.get('/api/workspace/inspection-form', { params: { type: 'supervisor', id: rec.id } })).json();
      expect(before.templates.length).toBeGreaterThan(1);
      // 模擬「範本後來才新增了這個項目」：把自己這張單上的一筆明細拿掉（只動自己的資料）。
      const missing = before.templates[before.templates.length - 1].id as string;
      const del = await adminDb().from('inspection_results').delete().eq('inspection_id', rec.id).eq('template_id', missing);
      expect(del.error).toBeNull();

      const form = await (await admin.get('/api/workspace/inspection-form', { params: { type: 'supervisor', id: rec.id } })).json();
      expect(form.templates.map((t: any) => t.id)).not.toContain(missing);
      expect(form.templates).toHaveLength(before.templates.length - 1);
      expect(form.results).toHaveLength(before.templates.length - 1);

      const scores = (form.templates as { id: string }[]).map((t) => ({ template_id: t.id, checked_items: [], quantities: {}, notes: '', photos: [] }));
      const base = { id: rec.id, version: rec.workspace_version, store, type: 'supervisor', status: 'draft', date: rec.inspection_date, temperature: 24, notes: marker('w14-q10'), signature: '', supervisorSignature: '', staff: [], templateHash: form.templateHash };
      // 若硬把「後來新增」的項目補評，伺服器要求項目與舊單一致（不能補評）
      const withExtra = await post(admin, { ...base, writeId: randomUUID(), scores: [...scores, { template_id: missing, checked_items: [], quantities: {}, notes: '', photos: [] }] });
      expect(withExtra.status()).toBe(400);
      const res = await post(admin, { ...base, writeId: randomUUID(), scores });
      expect(res.status(), (await res.text()).slice(0, 200)).toBe(200);
      const rows = await adminDb().from('inspection_results').select('template_id').eq('inspection_id', rec.id);
      expect(rows.data).toHaveLength(before.templates.length - 1);
      expect(rows.data.map((r: any) => r.template_id)).not.toContain(missing);
    } finally {
      await admin.dispose();
    }
  });

  test('新增表單載入全部啟用項目（沒有既有明細）', async () => {
    const admin = await apiAs('admin');
    try {
      const form = await (await admin.get('/api/workspace/inspection-form', { params: { type: 'supervisor' } })).json();
      const active = await adminDb().from('inspection_templates').select('id', { count: 'exact', head: true }).eq('is_active', true);
      expect(form.templates).toHaveLength(active.count);
      expect(form.templates.every((t: any) => t.is_active !== false)).toBe(true);
    } finally {
      await admin.dispose();
    }
  });
});

test.describe('Q9 範本變更擋下送出、Q11 超過滿分擋下', () => {
  test('範本雜湊不符：409 中文訊息，沒有寫入；重新載入後雜湊一致可儲存', async () => {
    runIdOrThrow();
    const admin = await apiAs('admin');
    try {
      const store = await storeIdByCode(admin, 'ZT05');
      const stale = await post(admin, await buildBody(admin, store, 'w14-q9', { templateHash: 'stale-hash' }));
      expect(stale.status()).toBe(409);
      expect((await stale.json()).error).toContain('巡店範本已更新，請保留草稿並重新載入');
      expect(await findMasterByNotes(marker('w14-q9'))).toHaveLength(0);
      const fresh = await post(admin, await buildBody(admin, store, 'w14-q9'));
      expect(fresh.status()).toBe(200);
      await registerInspection((await fresh.json()).record.id);
    } finally {
      await admin.dispose();
    }
  });

  test('單項扣分超過該項滿分：400 並指出項目與數字，沒有寫入（與舊版不同，Q11）', async () => {
    runIdOrThrow();
    const admin = await apiAs('admin');
    try {
      const store = await storeIdByCode(admin, 'VW001');
      const form = await (await admin.get('/api/workspace/inspection-form', { params: { type: 'supervisor', store } })).json();
      const t = (form.templates as any[]).find((x) => (x.checklist_items || []).some((o: any) => o.requires_quantity && Number(o.deduction) > 0));
      test.skip(!t, 'DEV 範本沒有需要數量的扣分項目');
      const option = t.checklist_items.find((o: any) => o.requires_quantity && Number(o.deduction) > 0);
      const qty = Math.ceil(Number(t.max_score) / Number(option.deduction)) + 1;
      const body = await buildBody(admin, store, 'w14-q11');
      body.scores = body.scores.map((s: any) => (s.template_id === t.id ? { ...s, checked_items: [option.label], quantities: { [option.label]: qty } } : s));
      const res = await post(admin, body);
      expect(res.status()).toBe(400);
      expect((await res.json()).error).toMatch(/超過該項滿分/);
      expect(await findMasterByNotes(marker('w14-q11'))).toHaveLength(0);
      // 剛好等於或低於滿分可以存（新舊分數一致：伺服端結果等於 scoreInspection）
      const okQty = Math.max(1, Math.floor(Number(t.max_score) / Number(option.deduction)));
      const okBody = await buildBody(admin, store, 'w14-q11');
      okBody.scores = okBody.scores.map((s: any) => (s.template_id === t.id ? { ...s, checked_items: [option.label], quantities: { [option.label]: okQty } } : s));
      const expected = scoreInspection(form.templates, okBody.scores, form.grades);
      const ok = await post(admin, okBody);
      expect(ok.status(), (await ok.text()).slice(0, 200)).toBe(200);
      const rec = (await ok.json()).record;
      await registerInspection(rec.id);
      expect(Number(rec.total_score)).toBe(expected.total);
      expect(String(rec.grade)).toBe(expected.grade);
    } finally {
      await admin.dispose();
    }
  });

  test('照片超過 5 張、非圖片格式：400', async () => {
    const admin = await apiAs('admin');
    try {
      const store = await storeIdByCode(admin, 'VW002');
      const tiny = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
      const body = await buildBody(admin, store, 'w14-photos');
      body.scores[0].photos = Array.from({ length: 6 }, () => tiny);
      expect((await post(admin, body)).status()).toBe(400);
      const bad = await buildBody(admin, store, 'w14-photos');
      bad.scores[0].photos = ['javascript:alert(1)'];
      expect((await post(admin, bad)).status()).toBe(400);
      expect(await findMasterByNotes(marker('w14-photos'))).toHaveLength(0);
    } finally {
      await admin.dispose();
    }
  });
});

test.describe('W15 網路中斷後手動重送', () => {
  test('同一個 writeId、同樣內容重送：回傳同一筆，不重複建立', async () => {
    runIdOrThrow();
    const admin = await apiAs('admin');
    try {
      const store = await storeIdByCode(admin, 'ZT03');
      // 同店同日同類型只能有一筆：先清掉本次 run 前面測試建立的單（只刪帶本次標記的列）。
      await deleteRunInspections();
      const body = await buildBody(admin, store, 'w14-resend');
      const first = await post(admin, body);
      expect(first.status(), (await first.text()).slice(0, 200)).toBe(200);
      const a = (await first.json()).record;
      await registerInspection(a.id);
      const second = await post(admin, body);
      expect(second.status()).toBe(200);
      const b = await second.json();
      expect(b.replayed).toBe(true);
      expect(b.record.id).toBe(a.id);
      expect(await findMasterByNotes(marker('w14-resend'))).toHaveLength(1);
      // 內容不同但同 writeId：拒絕（不能偷換內容）
      const tampered = await post(admin, { ...body, temperature: 30 });
      expect(tampered.status()).toBe(409);
    } finally {
      await admin.dispose();
    }
  });
});
