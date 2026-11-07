import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { apiAs } from '../support/auth';
import { assertNoUnlistedDiffs, loadMap, ParityRecorder, valueDiffsToDiffs } from '../support/parity';
import { diffNormalized } from '../support/normalize';
import { buildBody, deleteInspections, registerInspection, runIdOrThrow, storeIdByCode } from '../support/i01-fixtures';
import { adminDb } from '../support/m4-fixtures';
import { BLANK_WHITE, SIGNED } from '../support/png';
import { legacyEditPage, legacyNewPage, legacyScore, legacySignaturePad, readLegacy } from '../support/legacy-inspection';
import { DRAFT_TTL_DAYS, draftKey } from '../../lib/workspace/inspection-offline-policy';

// W14 對等層（M4 Q9–Q13、W15 Q14–Q16、追加的連續拍照）。
// 舊版是用戶端運算與用戶端畫面規則，所以：
//  - 影響評分、評級、獎金的項目（score-same-input、over-max）用「同輸入同輸出」：舊版算法逐行對照原始碼，
//    新版用真實 API 寫入 DEV 後回讀。
//  - 行為規則（簽名、範本變更、當班人員、離線暫存、照片、數量）：舊版事實由原始碼讀出，新版事實由 API 實測或原始碼讀出。
// 與舊版不同的項目（Q9、Q10、Q11、Q13 的確認、Q14、Q15、Q16）已列入 allowlist，approvedBy 為使用者問卷核可。

const map = loadMap('inspection-editor');
const recorder = new ParityRecorder('inspection-editor');
const find = (id: string) => map.entries.find((e) => e.id === id)!;
const created: string[] = [];
const DEFAULT_MIN: Record<number, number> = { 10: 220, 9: 215, 8: 191, 7: 181, 6: 171, 5: 161, 4: 151, 3: 141, 2: 131, 1: 121, 0: 0 };
const post = (api: any, data: unknown) => api.post('/api/workspace/inspection-form', { data });
const readSrc = (rel: string) => readLegacy(rel);

function report(entry: string, title: string, legacy: Record<string, unknown>, native: Record<string, unknown>) {
  const e = find(entry);
  assertNoUnlistedDiffs(
    recorder.record({
      entry,
      mechanism: 'write-readback',
      role: 'admin',
      title,
      legacy: { endpoint: e.legacy.source || '' },
      native: { endpoint: e.native.source || '' },
      compared: legacy,
      diffs: valueDiffsToDiffs(diffNormalized(legacy, native)),
    }),
  );
}

test.afterAll(async () => {
  await deleteInspections(created);
});

test('score-same-input：同一份勾選與數量，舊版算法與新版 API 回讀的總分、評級相同（含邊界）', async () => {
  test.setTimeout(240_000);
  runIdOrThrow();
  // 舊版評級門檻是寫死的預設值；DEV 的評級對照表可能被人改過（會讓新版評級不同，屬 Q5 已核可差異），
  // 所以這個對照暫時把 DEV 對照表設成預設值，結束後依備份逐列還原（同 W18 作法）。
  const db = adminDb();
  const backup = ((await db.from('inspection_grade_mapping').select('id,grade,min_score').order('grade')).data || []) as { id: string; grade: number; min_score: string }[];
  const admin = await apiAs('admin');
  try {
    for (const m of backup) {
      const u = await db.from('inspection_grade_mapping').update({ min_score: DEFAULT_MIN[m.grade] }).eq('id', m.id);
      if (u.error) throw new Error(`暫時設定預設評級門檻失敗：${u.error.message}`);
    }
    const store = await storeIdByCode(admin, 'ZT05');
    const form = await (await admin.get('/api/workspace/inspection-form', { params: { type: 'supervisor', store } })).json();
    const templates = form.templates as any[];
    let seed = 20261108;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    // 15 組輸入：全不勾（220 分）、每項全勾（受滿分限制時略過該選項）、隨機組合
    const sets: { template_id: string; checked_items: string[]; quantities: Record<string, number> }[][] = [];
    sets.push(templates.map((t) => ({ template_id: t.id, checked_items: [], quantities: {} })));
    for (let n = 0; n < 14; n++)
      sets.push(
        templates.map((t) => {
          const checked: string[] = [];
          const quantities: Record<string, number> = {};
          let deduction = 0;
          for (const o of t.checklist_items || []) {
            if (rnd() > (n === 1 ? 1 : 0.35)) continue;
            const qty = o.requires_quantity ? 1 + Math.floor(rnd() * 3) : 1;
            if (deduction + Number(o.deduction) * qty > Number(t.max_score)) continue;
            checked.push(o.label);
            if (o.requires_quantity) quantities[o.label] = qty;
            deduction += Number(o.deduction) * qty;
          }
          return { template_id: t.id, checked_items: checked, quantities };
        }),
      );
    const first = await post(admin, await buildBody(admin, store, 'par-score'));
    expect(first.status(), (await first.text()).slice(0, 200)).toBe(200);
    let rec = (await first.json()).record;
    await registerInspection(rec.id);
    created.push(rec.id);
    const legacy: Record<string, unknown> = {};
    const native: Record<string, unknown> = {};
    for (const [i, set] of sets.entries()) {
      const res = await post(admin, {
        id: rec.id, version: rec.workspace_version, writeId: randomUUID(), store, type: 'supervisor', status: 'draft', date: rec.inspection_date,
        temperature: 25, notes: rec.supervisor_notes, signature: '', supervisorSignature: '', staff: [], templateHash: form.templateHash,
        scores: set.map((s) => ({ ...s, notes: '', photos: [] })),
      });
      expect(res.status(), `第 ${i} 組：${(await res.text()).slice(0, 200)}`).toBe(200);
      rec = (await res.json()).record;
      const l = legacyScore(templates, set);
      legacy[`case${i}`] = { total: l.total, grade: l.grade };
      native[`case${i}`] = { total: Number(rec.total_score), grade: String(rec.grade) };
    }
    report('score-same-input', '同輸入同輸出（總分與評級）', legacy, native);
  } finally {
    for (const m of backup) await db.from('inspection_grade_mapping').update({ min_score: m.min_score }).eq('id', m.id);
    await admin.dispose();
  }
});

test('over-max：單項扣分超過該項滿分——舊版照存、新版擋下（Q11 已核可差異）', async () => {
  runIdOrThrow();
  const admin = await apiAs('admin');
  try {
    const store = await storeIdByCode(admin, 'VW001');
    const form = await (await admin.get('/api/workspace/inspection-form', { params: { type: 'supervisor', store } })).json();
    const t = (form.templates as any[]).find((x) => (x.checklist_items || []).some((o: any) => o.requires_quantity && Number(o.deduction) > 0));
    test.skip(!t, 'DEV 範本沒有需要數量的扣分項目');
    const o = t.checklist_items.find((x: any) => x.requires_quantity && Number(x.deduction) > 0);
    const qty = Math.ceil(Number(t.max_score) / Number(o.deduction)) + 1;
    const inputs = (form.templates as any[]).map((x) => ({ template_id: x.id, checked_items: x.id === t.id ? [o.label] : [], quantities: x.id === t.id ? { [o.label]: qty } : {} }));
    const l = legacyScore(form.templates, inputs);
    const body = await buildBody(admin, store, 'par-overmax');
    body.scores = body.scores.map((s: any) => ({ ...s, ...inputs.find((i) => i.template_id === s.template_id)! }));
    const res = await post(admin, body);
    report('over-max', '單項扣分超過該項滿分', { accepted: true, total: l.total }, { accepted: res.status() === 200, total: res.status() === 200 ? (await res.json()).record.total_score : null });
    expect(res.status()).toBe(400);
  } finally {
    await admin.dispose();
  }
});

test('edit-items：範本後來新增項目時編輯舊單——舊版載入全部啟用項目、新版只載入舊單當時有的（Q10 已核可差異）', async () => {
  runIdOrThrow();
  const admin = await apiAs('admin');
  try {
    const store = await storeIdByCode(admin, 'ZT04');
    const created1 = await post(admin, await buildBody(admin, store, 'par-edit-items'));
    expect(created1.status()).toBe(200);
    const rec = (await created1.json()).record;
    await registerInspection(rec.id);
    created.push(rec.id);
    const all = await (await admin.get('/api/workspace/inspection-form', { params: { type: 'supervisor', id: rec.id } })).json();
    const missing = all.templates[all.templates.length - 1].id as string;
    await adminDb().from('inspection_results').delete().eq('inspection_id', rec.id).eq('template_id', missing);
    const activeIds = ((await adminDb().from('inspection_templates').select('id').eq('is_active', true)).data as { id: string }[]).map((r) => r.id).sort();
    const nativeForm = await (await admin.get('/api/workspace/inspection-form', { params: { type: 'supervisor', id: rec.id } })).json();
    // 舊版編輯頁：載入目前啟用的全部項目（原始碼 .eq('is_active', true)），全部都要評
    expect(legacyEditPage()).toMatch(/\.eq\('is_active', true\)/);
    report(
      'edit-items',
      '編輯舊單載入的項目',
      { scoredTemplateIds: activeIds, newItemMustBeScored: true },
      { scoredTemplateIds: (nativeForm.templates as any[]).map((t) => t.id).sort(), newItemMustBeScored: (nativeForm.templates as any[]).some((t) => t.id === missing) },
    );
  } finally {
    await admin.dispose();
  }
});

test('signature：空白簽名不能確認、正式送出需要雙簽名——新舊相同（Q12）', async () => {
  runIdOrThrow();
  const admin = await apiAs('admin');
  try {
    const store = await storeIdByCode(admin, 'ZT05');
    const first = created[0];
    expect(first, 'score-same-input 先建立草稿').toBeTruthy();
    const form = await (await admin.get('/api/workspace/inspection-form', { params: { type: 'supervisor', id: first } })).json();
    const rec = (await adminDb().from('inspection_masters').select('*').eq('id', first).single()).data;
    const attempt = async (signature: string, supervisorSignature: string) => {
      const res = await post(admin, {
        id: first, version: rec.workspace_version, writeId: randomUUID(), store, type: 'supervisor', status: 'completed', date: rec.inspection_date,
        temperature: 25, notes: rec.supervisor_notes, signature, supervisorSignature, staff: [], templateHash: form.templateHash,
        scores: (form.templates as any[]).map((t) => ({ template_id: t.id, checked_items: [], quantities: {}, notes: '', photos: [] })),
      });
      return res.status() === 200;
    };
    const nativeEditor = readSrc('vue-workspace/src/pages/InspectionEditor.vue');
    const nativePad = readSrc('vue-workspace/src/components/SignatureInput.vue');
    const pad = legacySignaturePad();
    const newPage = legacyNewPage();
    const legacy = {
      blankCanBeConfirmed: !/disabled=\{!hasContent\}/.test(pad),
      completedWithOneSignatureAccepted: !/!signaturePhoto \|\| !supervisorSignature/.test(newPage),
      completedWithBlankSignatureAccepted: !/disabled=\{!hasContent\}/.test(pad),
      label: '店長/當班主管確認簽名',
    };
    const native = {
      blankCanBeConfirmed: !/:disabled="!hasInk"/.test(nativePad),
      completedWithOneSignatureAccepted: await attempt(SIGNED(), ''),
      completedWithBlankSignatureAccepted: await attempt(BLANK_WHITE(), SIGNED()),
      label: /label="([^"]*確認簽名)"/.exec(nativeEditor)![1].replace('／', '/'),
    };
    report('signature', '簽名規則', legacy, native);
    expect(await attempt(SIGNED(), SIGNED()), '兩個簽名都有筆跡可以正式送出').toBe(true);
  } finally {
    await admin.dispose();
  }
});

test('template-changed：填寫途中範本被改——舊版不檢查、新版擋下並保留對得上的內容（Q9 已核可差異）', async () => {
  runIdOrThrow();
  const admin = await apiAs('admin');
  try {
    const store = await storeIdByCode(admin, 'VW002');
    const stale = await post(admin, await buildBody(admin, store, 'par-template', { templateHash: 'stale' }));
    const editor = readSrc('vue-workspace/src/pages/InspectionEditor.vue');
    const legacy = { blocksSubmitWhenTemplateChanged: /templateHash|template_hash/.test(legacyNewPage()), keepsMatchingContentOnReload: false };
    const native = { blocksSubmitWhenTemplateChanged: stale.status() === 409, keepsMatchingContentOnReload: /carryOverScores\(/.test(editor) && /reloadTemplates\(\)/.test(editor) };
    report('template-changed', '範本變更時送出', legacy, native);
  } finally {
    await admin.dispose();
  }
});

test('duty-staff：選擇或更換門市自動帶入並整份換掉；新版有手動修改時先確認（Q13）', async () => {
  const src = legacyNewPage();
  const editor = readSrc('vue-workspace/src/pages/InspectionEditor.vue');
  const legacy = {
    autoLoadsOnStoreSelect: /fetchStaffForStore\(selectedStoreId\)/.test(src),
    replacesWholeList: /setOnDutyStaff\(staffList\)/.test(src),
    confirmsBeforeReplacingManualEdits: /confirm\([^)]*(人員|當班)/.test(src),
  };
  const native = {
    autoLoadsOnStoreSelect: /watch\(\s*\(\) => form\.value\.store/.test(editor) && /onStoreChanged\(/.test(editor),
    replacesWholeList: /form\.value\.staff = rosterToStaff\(c\.roster\)/.test(editor),
    confirmsBeforeReplacingManualEdits: /hasManualStaffEdits\(form\.value\.staff, autoRoster\)/.test(editor) && /staffConfirm\.value = /.test(editor),
  };
  report('duty-staff', '當班人員帶入規則', legacy, native);
});

test('offline-draft：離線暫存涵蓋頁面、帳號隔離、保留期限、不還原確認（Q14–Q16）', async () => {
  const src = legacyNewPage();
  const edit = legacyEditPage();
  const editor = readSrc('vue-workspace/src/pages/InspectionEditor.vue');
  const idb = readSrc('vue-workspace/src/inspection-offline.ts');
  const idFn = /function getInspectionDraftId[\s\S]*?\n}/.exec(src)![0];
  const legacy = {
    coversNewPage: /indexedDB\.open\(INSPECTION_DRAFT_DB_NAME/.test(src),
    coversEditPage: /indexedDB|InspectionDraft/.test(edit),
    storesPhotosAndSignatures: /signaturePhoto: string;/.test(src) && /photos/.test(src),
    keyedByUser: /user/i.test(idFn),
    retentionDays: /(expire|ttl|maxAge|retention)/i.test(src) ? 'set' : null,
    confirmsBeforeDiscard: (src.match(/window\.confirm\(/g) || []).length > 1,
    clearsAfterSubmit: /deleteInspectionDraft\(draftId\)/.test(src),
  };
  const native = {
    coversNewPage: draftKey('u', 'supervisor', null).endsWith('|new'),
    coversEditPage: draftKey('u', 'supervisor', 'rec-1').endsWith('|rec-1') && /draftKey\(userId\.value, form\.value\.type, props\.tab\.recordId\)/.test(editor),
    storesPhotosAndSignatures: /form: \{ \.\.\.form\.value, gps: null, date: null \}/.test(editor),
    keyedByUser: draftKey('u1', 'supervisor', null) !== draftKey('u2', 'supervisor', null) && /draftUsable\(draft, userId\)/.test(idb),
    retentionDays: DRAFT_TTL_DAYS === 15 ? 'set' : null,
    confirmsBeforeDiscard: /restoreDeleteConfirm/.test(editor) && /data-testid="restore-delete"/.test(editor),
    clearsAfterSubmit: /await clearDrafts\(wasRecord\)/.test(editor),
  };
  expect(DRAFT_TTL_DAYS).toBe(15);
  report('offline-draft', '離線暫存規則', legacy, native);
});

test('photo-capture：直接開後鏡頭、每項最多 5 張、長邊 800px、觸控區 96px——與舊版一致', async () => {
  const src = legacyNewPage();
  const comp = readSrc('vue-workspace/src/components/InspectionPhotoCapture.vue');
  const css = readSrc('vue-workspace/src/style.css');
  const legacyAttrs = /accept="([^"]+)"\s+capture="([^"]+)"/.exec(src)!;
  const nativeAttrs = /accept="([^"]+)"\s+capture="([^"]+)"/.exec(comp)!;
  const legacy = {
    accept: legacyAttrs[1],
    capture: legacyAttrs[2],
    maxPhotos: Number(/photos\.length < (\d+)/.exec(src)![1]),
    maxEdgePx: Number(/compressImage\(file, (\d+), /.exec(src)![1]),
    touchTargetPx: 96, // w-24 h-24
    inputResetAfterShot: /e\.target\.value = ''/.test(src),
  };
  expect(src).toMatch(/w-24 h-24/);
  const native = {
    accept: nativeAttrs[1],
    capture: nativeAttrs[2],
    maxPhotos: Number(/const MAX = (\d+)/.exec(comp)![1]),
    maxEdgePx: Number(/(\d+) \/ Math\.max\(bitmap\.width/.exec(comp)![1]),
    touchTargetPx: Number(/\.photo-capture-button\{[^}]*?[^-]width:(\d+)px/.exec(css)![1]),
    inputResetAfterShot: /input\.value = ""/.test(comp),
  };
  report('photo-capture', '拍照規格', legacy, native);
});

test('quantity-input：數量最小 1、空白或錯誤輸入回 1、取整數——與舊版一致', async () => {
  const src = legacyNewPage();
  const editor = readSrc('vue-workspace/src/pages/InspectionEditor.vue');
  const legacy = {
    minimum: /Math\.max\(1, quantity\)/.test(src) ? 1 : 0,
    invalidBecomes: /parseInt\(e\.target\.value\) \|\| 1/.test(src) ? 1 : 0,
    integerOnly: /parseInt\(e\.target\.value\)/.test(src),
  };
  const native = {
    minimum: /Number\.isFinite\(n\) && n >= 1 \? n : 1/.test(editor) ? 1 : 0,
    invalidBecomes: /Number\.isFinite\(n\) && n >= 1 \? n : 1/.test(editor) ? 1 : 0,
    integerOnly: /Math\.floor\(Number\(raw\)\)/.test(editor),
  };
  report('quantity-input', '數量輸入', legacy, native);
});
