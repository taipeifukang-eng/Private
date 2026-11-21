import { expect, test } from '@playwright/test';
import { loginAs } from '../support/auth';
import { fixtureFile } from '../support/m6-fixtures';
import { assertNoUnlistedDiffs, ParityRecorder, type Diff } from '../support/parity';
import { compareWorkbooks } from '../support/w02-xlsx';
import { LABEL, legacyGenerate, legacyModule, legacyUpload, nativeDownload, nativeGenerate, nativePick, nativeStep, openLegacyOffline, openNativeOffline, readDownload } from '../support/m6-inventory-ui';

/**
 * M6 第一批 W25 對等：同一組自造檔（tests/fixtures/m6），舊 /inventory 離線工具與新版離線工具各跑一遍，
 * 下載的 Excel 逐工作表、逐儲存格比對；已核可的差異（檔名日期橫線、衝突擋下、逐檔容錯畫面）列入 tests/parity/allowlist.json。
 * 1F 商品檔欄位辨識的邊角樣本（標題空白、空品號列、非數字庫存）也在這裡以畫面行為對跑，不一致處待使用者決定。
 */
const F = fixtureFile;
const recorder = new ParityRecorder('inventory-offline');
const sameName = (a: string, b: string) => a.replace(/\d{4}[/_-]\d{1,2}[/_-]\d{1,2}/, 'DATE') === b.replace(/\d{4}[/_-]\d{1,2}[/_-]\d{1,2}/, 'DATE');

function record(entry: string, title: string, diffs: Diff[], compared: Record<string, number | string | boolean>) {
  const result = recorder.record({ entry, mechanism: 'write-readback', role: 'inventory_team', title, legacy: { endpoint: '/inventory（舊頁離線工具）' }, native: { endpoint: '/workspace 盤點管理 離線盤點匯入匯出工具' }, compared, diffs });
  assertNoUnlistedDiffs(result);
  expect(['pass', 'allowed', 'pending-approval']).toContain(result.status);
  return result;
}

test('三個模組：同一組檔案，新舊輸出逐儲存格相同（檔名日期寫法除外）', async ({ browser }) => {
  test.setTimeout(420_000);
  const ctx = await loginAs(browser, 'inventory_team');
  try {
    // ---------------- 舊版
    const lp = await ctx.newPage();
    const L = await openLegacyOffline(lp);
    await legacyUpload(L, 0, F('base-1f.xlsx'));
    await legacyModule(L, 1);
    await legacyUpload(L, 1, F('external-original.xlsx'));
    await legacyUpload(L, 2, F('fks0701-module1.xlsx'));
    const [lm1] = await legacyGenerate(L, '產生外盤應複盤清單', 1);
    await legacyUpload(L, 1, F('external-clean.xlsx'));
    await legacyUpload(L, 2, F('fks0701.xlsx'));
    await legacyGenerate(L, '產生外盤應複盤清單', 0);
    const legacyEmptyMessage = L.dialogs[L.dialogs.length - 1];
    await legacyModule(L, 2);
    await legacyUpload(L, 1, [F('pre-1.xlsx'), F('pre-bad-columns.xlsx'), F('pre-2.xlsx')]);
    const legacyPreMessage = L.dialogs[L.dialogs.length - 1];
    await legacyUpload(L, 2, F('fks0701.xlsx'));
    const [lInternal, lMissing] = await legacyGenerate(L, '產生內部複盤資料與未盤點清單', 2);
    await legacyModule(L, 3);
    await legacyUpload(L, 1, F('internal-edited.xlsx'));
    await legacyUpload(L, 2, F('missing-edited.xlsx'));
    const [lFinal] = await legacyGenerate(L, '產生盤點結果檔（上傳 DPOS 用）', 1);
    await legacyUpload(L, 1, F('internal-conflict.xlsx'));
    await legacyUpload(L, 2, F('missing-conflict.xlsx'));
    const [lConflict] = await legacyGenerate(L, '產生盤點結果檔（上傳 DPOS 用）', 1);
    const legacy = { m1: await readDownload(lm1), internal: await readDownload(lInternal), missing: await readDownload(lMissing), final: await readDownload(lFinal), conflict: await readDownload(lConflict) };
    await lp.close();

    // ---------------- 新版
    const np = await ctx.newPage();
    await openNativeOffline(np);
    await nativePick(np, LABEL.base, F('base-1f.xlsx'));
    await nativeStep(np, 1);
    await nativePick(np, LABEL.external, F('external-original.xlsx'));
    await nativePick(np, LABEL.fks, F('fks0701-module1.xlsx'));
    await nativeGenerate(np);
    const nm1 = await readDownload(await nativeDownload(np, '下載外盤應複盤清單'));
    await nativePick(np, LABEL.external, F('external-clean.xlsx'));
    await nativePick(np, LABEL.fks, F('fks0701.xlsx'));
    await nativeGenerate(np);
    const nativeEmptyMessage = await np.getByTestId('offline-info').textContent();
    await nativeStep(np, 2);
    await nativePick(np, LABEL.pre, [F('pre-1.xlsx'), F('pre-bad-columns.xlsx'), F('pre-2.xlsx')]);
    const nativePreMessage = (await np.getByTestId('per-file-summary').textContent()) || '';
    await nativePick(np, LABEL.fks, F('fks0701.xlsx'));
    await nativeGenerate(np);
    const nInternal = await readDownload(await nativeDownload(np, /下載內部複盤/));
    const nMissing = await readDownload(await nativeDownload(np, /下載未盤表/));
    await nativeStep(np, 3);
    await nativePick(np, LABEL.internal, F('internal-edited.xlsx'));
    await nativePick(np, LABEL.missing, F('missing-edited.xlsx'));
    await nativeGenerate(np);
    const nFinal = await readDownload(await nativeDownload(np, '下載 DPOS 結果檔'));
    await nativePick(np, LABEL.internal, F('internal-conflict.xlsx'));
    await nativePick(np, LABEL.missing, F('missing-conflict.xlsx'));
    await nativeGenerate(np);
    const conflictShown = await np.getByTestId('final-conflicts').isVisible();
    const conflictDownloadable = await np.getByRole('button', { name: '下載 DPOS 結果檔' }).count();
    const conflictCount = await np.getByTestId('final-conflicts').locator('li').count();
    await np.close();

    // ---------------- 比對
    const pairs: [string, string, typeof legacy.m1, typeof legacy.m1][] = [
      ['module1-output', '模組一：外盤應複盤清單', legacy.m1, nm1],
      ['module2-internal', '模組二：內部盤點複盤資料', legacy.internal, nInternal],
      ['module2-missing', '模組二：系統有庫存但未盤點檔案', legacy.missing, nMissing],
      ['module3-result', '模組三：盤點結果檔（無衝突）', legacy.final, nFinal],
    ];
    for (const [entry, title, l, n] of pairs) {
      const { diffs, stats } = compareWorkbooks(l.buffer, n.buffer);
      const r = record(entry, `${title}：舊版與新版 Excel 逐儲存格`, diffs, { sheets: stats.sheets, cells: stats.cells, rows: stats.rows });
      expect(r.status, `${entry} 應完全一致`).toBe('pass');
    }
    // 檔名：日期以外相同；日期寫法不同（舊 2026/11/21 → 瀏覽器存成底線，新 2026-11-21）屬已核可差異
    const names: [string, string, string][] = [['externalRecount', legacy.m1.name, nm1.name], ['internalRecount', legacy.internal.name, nInternal.name], ['uninventoried', legacy.missing.name, nMissing.name], ['result', legacy.final.name, nFinal.name]];
    const nameDiffs: Diff[] = [];
    for (const [kind, l, n] of names) {
      if (kind === 'result') expect(n, '結果檔檔名維持舊寫法').toBe(l);
      else expect(sameName(l, n), `${kind}：舊 ${l} / 新 ${n} 日期以外必須相同`).toBe(true);
      if (l !== n) nameDiffs.push({ kind: 'changed', key: kind, legacy: l, native: n, detail: '日期寫法：舊版 YYYY/M/D（存檔時變底線），新版 YYYY-MM-DD' });
    }
    record('file-names', '下載檔名：舊版 vs 新版', nameDiffs, { files: names.length });

    // 提示訊息對等：無需複盤
    expect(legacyEmptyMessage).toContain('沒有需要複盤的品項');
    expect(nativeEmptyMessage).toBe('沒有需要複盤的品項');
    record('module1-empty-notice', '模組一無盤差提示文字相同', [], { legacy: legacyEmptyMessage.includes('沒有需要複盤的品項'), native: nativeEmptyMessage === '沒有需要複盤的品項' });

    // 預盤多檔：成功/失敗的檔案相同；顯示文字與「已成功的保留」是已核可差異
    const failedLegacy = /pre-bad-columns\.xlsx/.test(legacyPreMessage);
    const failedNative = /pre-bad-columns\.xlsx/.test(nativePreMessage);
    expect(failedLegacy && failedNative, '兩版都指出 pre-bad-columns.xlsx 失敗').toBe(true);
    expect(legacyPreMessage).toContain('2/3');
    expect(nativePreMessage).toContain('2/3');
    record('pre-multi-file', '預盤多檔：失敗檔案相同（壞檔跳過）；新版顯示原因與保留成功檔的方式不同', [{ kind: 'changed', key: 'summary-text', legacy: legacyPreMessage.replace(/\s+/g, ' ').slice(0, 160), native: nativePreMessage, detail: '提示文字格式不同；新版已成功的檔案保留，失敗檔可單獨重傳' }], { okFiles: 2, failedFiles: 1 });

    // A2：舊版對衝突資料仍產出檔案（直接累加），新版擋下並列出衝突
    expect(conflictShown).toBe(true);
    expect(conflictDownloadable).toBe(0);
    expect(conflictCount).toBe(3);
    const legacyRows = legacy.conflict.rows.length;
    record('module3-conflict', '模組三衝突資料：舊版直接累加產出檔案，新版擋下並列出衝突', [{ kind: 'changed', key: 'final-conflict-block', legacy: `產出 ${legacyRows} 筆（${legacy.conflict.name}）`, native: `不產出，列出 ${conflictCount} 項衝突`, detail: 'A2：擋下並一次列出全部衝突品號' }], { conflicts: conflictCount });
  } finally {
    await ctx.close();
  }
});

test('1F 商品檔邊角樣本：舊版與新版畫面行為對跑（不一致處待使用者決定）', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await loginAs(browser, 'inventory_team');
  try {
    const samples = ['base-1f-reordered.xlsx', 'base-1f-longnames.xlsx', 'base-1f-two-stock-cols.xlsx', 'base-1f-un-lowercase.xlsx', 'base-1f-header-row1.xlsx', 'base-1f-spaces.xlsx', 'base-1f-blank-code-row.xlsx', 'base-1f-nonnumeric-stock.xlsx'];
    const lp = await ctx.newPage();
    const L = await openLegacyOffline(lp);
    const legacyOut: Record<string, string> = {};
    for (const s of samples) {
      await legacyUpload(L, 0, F(s));
      const msg = L.dialogs[L.dialogs.length - 1];
      const m = msg.match(/已匯入 (\d+) 筆 1F當日商品資料/);
      legacyOut[s] = m ? `成功 ${m[1]} 筆` : '失敗';
    }
    await lp.close();
    const np = await ctx.newPage();
    await openNativeOffline(np);
    const nativeOut: Record<string, string> = {};
    for (const s of samples) {
      await nativePick(np, LABEL.base, F(s));
      const failed = await np.getByRole('alert').count();
      if (failed) nativeOut[s] = '失敗';
      else {
        const text = (await np.locator('.offline-inventory label.file-row', { hasText: LABEL.base }).textContent()) || '';
        nativeOut[s] = `成功 ${text.match(/·\s*(\d+)\s*筆/)?.[1]} 筆`;
      }
    }
    await np.close();
    const diffs: Diff[] = samples.filter((s) => legacyOut[s] !== nativeOut[s]).map((s) => ({ kind: 'changed', key: s, legacy: legacyOut[s], native: nativeOut[s], detail: '1F 商品檔欄位辨識結果不同' }));
    // 兩版一致的樣本：標題在第二列、順序不同、別名、較長欄名、含「庫存」的兩個欄位、小寫 un、標題在第一列（兩版都失敗）
    for (const s of ['base-1f-reordered.xlsx', 'base-1f-longnames.xlsx', 'base-1f-two-stock-cols.xlsx', 'base-1f-un-lowercase.xlsx', 'base-1f-header-row1.xlsx']) expect(nativeOut[s], s).toBe(legacyOut[s]);
    const expectedDiffs = ['base-1f-spaces.xlsx', 'base-1f-blank-code-row.xlsx', 'base-1f-nonnumeric-stock.xlsx'];
    expect(diffs.map((d) => d.key).sort(), '不一致清單（回報使用者）').toEqual(expectedDiffs.sort());
    record('base-1f-variants', '1F 商品檔邊角樣本：欄位辨識結果', diffs, { samples: samples.length, differing: diffs.length });
    // 預盤數量非數字：舊版收下（NaN），新版拒絕
    const lp2 = await ctx.newPage();
    const L2 = await openLegacyOffline(lp2);
    await legacyUpload(L2, 0, F('base-1f.xlsx'));
    await legacyModule(L2, 2);
    await legacyUpload(L2, 1, F('pre-nonnumeric.xlsx'));
    const legacyAccepts = /已匯入 1\/1 個預盤檔案/.test(L2.dialogs[L2.dialogs.length - 1]);
    await lp2.close();
    const np2 = await ctx.newPage();
    await openNativeOffline(np2);
    await nativePick(np2, LABEL.base, F('base-1f.xlsx'));
    await nativeStep(np2, 2);
    await nativePick(np2, LABEL.pre, F('pre-nonnumeric.xlsx'));
    const nativeRejects = (await np2.getByRole('alert').count()) > 0;
    await np2.close();
    expect(legacyAccepts).toBe(true);
    expect(nativeRejects).toBe(true);
    record('number-validation', '數量不是數字：舊版收下（變成 NaN），新版拒絕並指出數字不正確', [{ kind: 'changed', key: 'pre-nonnumeric.xlsx', legacy: '收下', native: '拒絕', detail: '預盤數量非數字' }], { samples: 1 });
  } finally {
    await ctx.close();
  }
});
