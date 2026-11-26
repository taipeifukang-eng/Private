import { expect, test } from '@playwright/test';
import { comparePriceFile, compareClaimFile, findSamples, SAMPLE_DIR } from './clinic-selfpay-real-sample';

/**
 * M6 W30 真實樣本對等（Z4）：診所價格檔與診所檔的去識別真實樣本放進「盤點測試檔」資料夾後，
 * 以舊版原始碼與新共用解析函式各解析一次，結果必須完全相同。找不到樣本時略過（目前尚未提供）。
 * 只輸出筆數與健保碼；不輸出檔名、藥名、價格或任何病患資料。邏輯見 clinic-selfpay-real-sample.ts。
 */
const samples = findSamples();
const SHOW = 40; // 健保碼最多印出幾個

test.describe('真實樣本：診所價格檔與診所檔（舊版解析 vs 新共用解析）', () => {
  test('診所價格檔', () => {
    test.skip(samples.price.length === 0, `盤點測試檔 資料夾沒有符合 *診所*價格*.xls* 的樣本（資料夾：${SAMPLE_DIR}），略過；樣本到位後自動執行`);
    samples.price.forEach((file, i) => {
      const r = comparePriceFile(file);
      console.log(`[real-sample] 價格檔 #${i + 1}：工作表 ${r.sheets}、列數 ${r.rows}、可用紀錄 ${r.records}、去重後 ${r.afterDedupe}、健保碼 ${r.codes.length} 個：${r.codes.slice(0, SHOW).join(',')}${r.codes.length > SHOW ? ',…' : ''}`);
      expect(r.same, `價格檔 #${i + 1} 新舊解析不一致，第一個差異位置：${r.diffAt}`).toBe(true);
    });
  });

  test('診所檔', () => {
    test.skip(samples.claim.length === 0, `盤點測試檔 資料夾沒有符合 *診所*.xls* 的診所檔樣本（資料夾：${SAMPLE_DIR}），略過；樣本到位後自動執行`);
    samples.claim.forEach((file, i) => {
      const r = compareClaimFile(file);
      console.log(`[real-sample] 診所檔 #${i + 1}：明細 ${r.items} 筆（接受 ${r.accepted}）、略過統計 ${JSON.stringify(r.skipped)}、健保碼 ${r.codes.length} 個：${r.codes.slice(0, SHOW).join(',')}${r.codes.length > SHOW ? ',…' : ''}`);
      expect(r.same, `診所檔 #${i + 1} 新舊解析不一致，第一個差異位置：${r.diffAt}`).toBe(true);
    });
  });
});
