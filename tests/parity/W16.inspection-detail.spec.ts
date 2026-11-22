import fs from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { apiAs, loginAs } from '../support/auth';
import { assertNoUnlistedDiffs, loadMap, ParityRecorder, valueDiffsToDiffs } from '../support/parity';
import { diffNormalized } from '../support/normalize';
import { M4B_MONTH, deleteRunMasters, patchImprovement, seedFollowupInspection, seedMaster, seedResults, activeTemplates } from '../support/m4b-fixtures';
import { adminDb, readMaster, runIdOrThrow } from '../support/m4-fixtures';
import { openInspectionDetail, openPrintPreview } from '../support/m4b-ui';

// W16 對等層（M4 Q20、Q21、Q22）：
//  print-layout：同一張巡店單，舊版 PrintInspectionReport 與新版報表預覽，在「列印媒體」下逐項對照；
//     與舊版不同的只有已核可的三項（Q21 流程第 1 點改印系統期限日期、Q20 已改善項目多印回報結果、分數並列一行）。
//  detail-facts：詳情頁畫面上的事實逐項對照。
//  delete-scope：同一個「有刪除權限但沒有經理巡店權限」的帳號刪經理巡店單，舊版成功、新版 403（Q22 已核可）。

const map = loadMap('inspection-detail');
const recorder = new ParityRecorder('inspection-detail');
const find = (id: string) => map.entries.find((e) => e.id === id)!;
const DATE = `${M4B_MONTH.detail}-20`;

let seeded: Awaited<ReturnType<typeof seedFollowupInspection>>;
test.beforeAll(async () => {
  runIdOrThrow();
  seeded = await seedFollowupInspection({ store: 'ZT01', inspector: 'admin', date: DATE, tag: 'w16-par', count: 2, deduction: 6, total: 200 });
  await adminDb().from('inspection_on_duty_staff').insert([
    { inspection_id: seeded.id, employee_code: 'ZT-W16-P1', employee_name: '[自動測試]甲', position: '店長', is_duty_supervisor: true },
    { inspection_id: seeded.id, employee_code: 'ZT-W16-P2', employee_name: '[自動測試]乙', position: '藥師', is_duty_supervisor: false },
  ]);
  await adminDb().from('inspection_masters').update({ indoor_temperature: 25.5 }).eq('id', seeded.id);
  // 第一項已改善（Q20 新版多印回報結果）；第二項維持待改善
  await patchImprovement(seeded.improvements[0].id, { status: 'improved', improved_at: new Date().toISOString(), improvement_description: '已改善（自動測試）', improvement_photo_urls: [] });
});
test.afterAll(async () => {
  await deleteRunMasters();
});

function report(entry: string, title: string, legacy: unknown, native: unknown, role = 'admin') {
  const e = find(entry);
  assertNoUnlistedDiffs(
    recorder.record({
      entry,
      mechanism: e.mechanism,
      role,
      title,
      legacy: { endpoint: e.legacy.source || e.legacy.ui?.route || '' },
      native: { endpoint: e.native.source || '' },
      compared: legacy as any,
      diffs: valueDiffsToDiffs(diffNormalized(legacy, native)),
    }),
  );
}

type PrintFacts = {
  headings: string[];
  fields: Record<string, string>;
  score: { total: string; max: string; rate: string; grade: string };
  issues: { title: string; deduction: string; note: string }[];
  handwritingBoxes: number;
  followupBlocks: number;
  scoreTrio: string;
  flow: string[];
  storeSignDate: string;
  unsignedInspectorName: string;
  footerLead: string;
};

/** 兩邊共用的擷取：在列印媒體下，從報表容器取出事實（各自用自己的 DOM 結構）。 */
async function extractPrint(page: Page, side: 'legacy' | 'native'): Promise<PrintFacts> {
  return page.evaluate((s) => {
    const root = (s === 'legacy' ? document.getElementById('print-content') : document.querySelector('.inspection-print-output .inspection-report')) as HTMLElement;
    const txt = (el: Element | null | undefined) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
    const innerText = root.innerText;
    const vocabulary = ['門市巡店檢核報告', '評分總覽', '此次巡店督導其他建議', '待改善項目彙整', '回饋與簽名確認', '督導建議流程：'];
    const headings = vocabulary.map((h) => ({ h, i: innerText.indexOf(h) })).filter((x) => x.i >= 0).sort((a, b) => a.i - b.i).map((x) => x.h);
    const ps = [...root.querySelectorAll('p')];
    const fields: Record<string, string> = {};
    for (const label of ['店鋪名稱：', '店鋪代碼：', '店鋪地址：', '檢核日期：', '督導人員：', '室內溫度：']) {
      const p = ps.find((x) => txt(x).startsWith(label));
      fields[label.replace('：', '')] = p ? txt(p).slice(label.length).trim() : '';
    }
    const reportNo = ps.find((x) => txt(x).startsWith('報告編號：'));
    fields['報告編號'] = reportNo ? txt(reportNo).slice(5).trim() : '';
    let score = { total: '', max: '', rate: '', grade: '' };
    if (s === 'legacy') {
      const val = (label: string) => txt(ps.find((x) => txt(x) === label)?.nextElementSibling);
      score = { total: val('總得分'), max: val('總分'), rate: val('得分率'), grade: val('評級') };
    } else {
      const cells = [...root.querySelectorAll('[data-testid=report-score] td')].map(txt);
      score = { total: cells[0], max: cells[1], rate: cells[2], grade: cells[3] };
    }
    let issues: { title: string; deduction: string; note: string }[] = [];
    if (s === 'legacy') {
      issues = [...root.querySelectorAll('div.avoid-break.border-red-200')].map((d) => ({
        title: txt(d.querySelector('h3')),
        deduction: txt(d.querySelector('p.text-red-700 span')),
        note: txt(d.querySelector('.bg-white.border-red-200 p.text-sm')),
      }));
    } else {
      issues = [...root.querySelectorAll('[data-testid=report-issue]')].map((d) => ({
        title: txt(d.querySelector('h3')).replace(/^\d+\s*/, ''),
        deduction: txt(d.querySelector('p.report-red strong')),
        note: txt(d.querySelector('.report-box .report-note')),
      }));
    }
    const flowItems = [...root.querySelectorAll(s === 'legacy' ? 'ol li' : '[data-testid=flow-note] li')].map(txt);
    const signDate = s === 'legacy' ? txt(ps.find((x) => txt(x).startsWith('簽名日期：'))) : txt(root.querySelector('[data-testid=store-sign-date]'));
    const inspectorName = s === 'legacy' ? txt(root.querySelector('p.text-sm.text-gray-700.pb-1')) : txt(root.querySelector('[data-testid=inspector-name]'));
    const footer = txt([...root.querySelectorAll('p')].find((x) => txt(x).startsWith('本報告由系統自動生成')));
    return {
      headings,
      fields,
      score,
      issues,
      handwritingBoxes: s === 'legacy' ? root.querySelectorAll('.border-dashed').length : root.querySelectorAll('.report-handwriting').length,
      followupBlocks: s === 'legacy' ? 0 : root.querySelectorAll('[data-testid=report-followup]').length,
      scoreTrio: s === 'legacy' ? '' : txt(root.querySelector('[data-testid=score-trio]')),
      flow: flowItems,
      storeSignDate: signDate,
      unsignedInspectorName: inspectorName,
      footerLead: footer.split('|')[0].trim(),
    };
  }, side);
}

const pdfFacts = (pdf: Buffer) => {
  const text = pdf.toString('latin1');
  const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(text);
  return { paper: box ? `${Number(box[1]).toFixed(0)}x${Number(box[2]).toFixed(0)}` : '', pages: (text.match(/\/Type\s*\/Page[^s]/g) || []).length };
};

test('print-layout：舊版 PrintInspectionReport 與新版報表預覽（列印媒體）逐項對照，只有 Q20、Q21 已核可的差異', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const ctx = await loginAs(browser, 'admin');
  try {
    const legacyPage = await ctx.newPage();
    await legacyPage.goto(`/inspection/${seeded.id}`, { waitUntil: 'networkidle' });
    await legacyPage.waitForSelector('#print-content', { state: 'attached', timeout: 30_000 });
    await legacyPage.emulateMedia({ media: 'print' });
    const legacy = await extractPrint(legacyPage, 'legacy');
    const legacyPdf = pdfFacts(await legacyPage.pdf({ preferCSSPageSize: true, printBackground: true }));
    await legacyPage.screenshot({ path: testInfo.outputPath('legacy-print.png'), fullPage: true });
    await legacyPage.close();

    const nativePage = await ctx.newPage();
    await openInspectionDetail(nativePage, { month: M4B_MONTH.detail, store: 'ZT01', date: DATE });
    await openPrintPreview(nativePage);
    await nativePage.emulateMedia({ media: 'print' });
    const native = await extractPrint(nativePage, 'native');
    const nativePdfBuffer = await nativePage.pdf({ preferCSSPageSize: true, printBackground: true });
    const nativePdf = pdfFacts(nativePdfBuffer);
    fs.writeFileSync(testInfo.outputPath('native-print.pdf'), nativePdfBuffer);
    await nativePage.screenshot({ path: testInfo.outputPath('native-print.png'), fullPage: true });

    // 把 Q20（已改善項目回報）與 Q21（流程第 1 點）之外的事實逐項比對
    report('print-layout', 'A4 列印報表（列印媒體）：區塊、欄位、分數卡、待改善項目、手寫空格、簽名區', legacy, native);
    report('print-paper', 'A4 紙張與頁數', legacyPdf, nativePdf);
    expect(legacy.headings.length, '舊版應該抓得到區塊').toBeGreaterThanOrEqual(5);
    expect(legacy.issues).toHaveLength(2);
    expect(native.issues).toHaveLength(2);
  } finally {
    await ctx.close();
  }
});

test('detail-facts：詳情頁畫面上的事實逐項對照（單號、門市、督導、分數、評級、溫度、當班人員、備註、需改善項目與扣分）', async ({ browser }) => {
  test.setTimeout(300_000);
  const ctx = await loginAs(browser, 'admin');
  try {
    const master = await readMaster(seeded.id);
    const facts = [
      `流水號/單號 ${master.inspection_no}`,
      '門市 ZT01',
      '督導 測試系統管理員',
      `評級 ${master.grade}`,
      '室內溫度 25.5',
      '當班 [自動測試]甲',
      '當班 [自動測試]乙',
      '備註',
      ...seeded.templates.map((t) => `需改善 ${t.item_name}`),
    ];
    const needle: Record<string, string> = {
      [facts[0]]: master.inspection_no,
      [facts[1]]: 'ZT01',
      [facts[2]]: '測試系統管理員',
      [facts[3]]: `${master.grade}`,
      [facts[4]]: '25.5',
      [facts[5]]: '[自動測試]甲',
      [facts[6]]: '[自動測試]乙',
      [facts[7]]: master.supervisor_notes,
      ...Object.fromEntries(seeded.templates.map((t) => [`需改善 ${t.item_name}`, t.item_name])),
    };
    const presentOn = (text: string) => Object.fromEntries(facts.map((f) => [f, text.includes(needle[f])]));
    const legacyPage = await ctx.newPage();
    await legacyPage.goto(`/inspection/${seeded.id}`, { waitUntil: 'networkidle' });
    await legacyPage.waitForSelector('h1', { timeout: 30_000 });
    const legacyText = await legacyPage.evaluate(() => (document.querySelector('main') || document.body).textContent || '');
    await legacyPage.close();
    const nativePage = await ctx.newPage();
    await openInspectionDetail(nativePage, { month: M4B_MONTH.detail, store: 'ZT01', date: DATE });
    await expect(nativePage.getByTestId('detail-score')).toBeVisible();
    const nativeText = await nativePage.locator('section.work-page:visible').textContent();
    // 新舊都要看得到的事實：新版把未扣分項目收折，但本案 2 項都是有扣分，應全部可見
    report('detail-facts', '詳情頁畫面事實', presentOn(legacyText), presentOn(nativeText || ''));
    for (const v of Object.values(presentOn(nativeText || ''))) expect(v).toBe(true);
  } finally {
    await ctx.close();
  }
});

test('delete-scope：有刪除權限但沒有經理巡店權限者刪經理巡店單 —— 舊版成功、新版擋下（Q22 已核可）；一般督導單兩邊都能刪', async () => {
  test.setTimeout(300_000);
  runIdOrThrow();
  const mk = async (type: 'supervisor' | 'manager', tag: string, day: number) => {
    const id = await seedMaster({ store: 'ZT03', inspector: type === 'manager' ? 'ops_manager' : 'supervisor', date: `${M4B_MONTH.detail}-${day}`, status: 'completed', total: 200, type, tag });
    await seedResults(id, (await activeTemplates(1)).map((template) => ({ template, deduction: 0 })));
    return id;
  };
  const api = await apiAs('inspection_delete');
  const exists = async (id: string) => ((await adminDb().from('inspection_masters').select('id', { count: 'exact', head: true }).eq('id', id)).count || 0) > 0;
  try {
    const result = async (type: 'supervisor' | 'manager') => {
      const legacyId = await mk(type, `w16-del-legacy-${type}`, type === 'manager' ? 21 : 22);
      const nativeId = await mk(type, `w16-del-native-${type}`, type === 'manager' ? 23 : 24);
      const lRes = await api.delete(`/api/inspection/${legacyId}`);
      const nRes = await api.delete('/api/workspace/inspection-detail', { data: { id: nativeId, version: (await readMaster(nativeId)).workspace_version } });
      return {
        legacy: { status: lRes.status(), deleted: !(await exists(legacyId)) },
        native: { status: nRes.status(), deleted: !(await exists(nativeId)) },
      };
    };
    const sup = await result('supervisor');
    report('delete-scope-supervisor', '督導巡店單：有刪除權限者可刪', sup.legacy, sup.native, 'inspection_delete');
    expect(sup.legacy.deleted).toBe(true);
    const mgr = await result('manager');
    expect(mgr.legacy.deleted, '舊版：沒有經理權限也刪得掉經理單').toBe(true);
    expect(mgr.native.deleted, '新版：擋下').toBe(false);
    report('delete-scope', '經理巡店單：沒有經理巡店權限者刪除', mgr.legacy, mgr.native, 'inspection_delete');
  } finally {
    await api.dispose();
  }
});
